// ═══════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════
const CREDS = {user:'rocketteam',pass:'launch2026'};
// Email of a real Supabase user (Dashboard > Authentication > Users) that the
// shared "rocketteam" login signs in as, so that login can push/sync. Use the
// same password as CREDS.pass. Leave '' to keep rocketteam local-only.
const TEAM_SUPABASE_EMAIL = '';
const WC = ['red','black','yellow','blue','green','orange','gray','purple','white','brown','pink','cyan'];
const WHX = {red:'#e74c3c',black:'#2c2c2c',yellow:'#f1c40f',blue:'#2980b9',green:'#27ae60',orange:'#e67e22',gray:'#95a5a6',purple:'#8e44ad',white:'#bdc3c7',brown:'#795548',pink:'#e91e63',cyan:'#00bcd4'};
const AUTO_PINS = {'Amphenol 9-35':6,'Amphenol 13-pin':13,'Amphenol 9-98':3,'XT60':2,'XT30':2,'DSUB-9':9,'DSUB-15':15,'DSUB-37':37};
// Connectors where user cannot change pin count
const FIXED_PINS = new Set(['Amphenol 9-35','Amphenol 13-pin','Amphenol 9-98','XT60','XT30','DSUB-9','DSUB-15','DSUB-37']);
const PAD = 20; // collision padding around boxes
const GRID = 14; // routing grid cell size (world units)

// Display label for a connector in selection dropdowns: shows the
// user-given connector name if set (e.g. "J1", "Power Bus"), else the
// custom type label for Custom-type connectors, else the connector's
// type wrapped in parens (so a fallback type is visually distinct from
// an actual assigned name).
function connTypeLabel(c){
  if(c.name)return c.name;
  if(c.customName)return c.customName;
  return `(${c.type})`;
}

// Abbreviated labels for the on-canvas "Connector types" overlay (the
// v-ctype checkbox toggle) — the full Amphenol names are too long to sit
// next to a small connector dot on the canvas, so shorten just those.
// Every other type (DSUB-9, XT60, Molex, Custom, etc.) still shows as its
// normal `type` value. Note the underlying `type` values themselves are
// left unchanged everywhere else in the app (dropdowns, saved data, etc.)
// — this only affects this one canvas overlay.
const SHORT_TYPE_LABELS = {
  'Amphenol 9-35':'Amp 9-35',
  'Amphenol 13-pin':'Amp 11-35',
  'Amphenol 9-98':'Amp 9-98'
};
function shortTypeLabel(type){
  return SHORT_TYPE_LABELS[type] || type;
}

// Mutate array in-place (preserves references held by navStack/ST.projects)
function removeWhere(arr, fn){
  for(let i=arr.length-1;i>=0;i--){if(fn(arr[i]))arr.splice(i,1);}
}

// Walk a project's full system tree (including nested subsystems) and
// collect every connector, regardless of which scope it lives in.
function collectAllConnectors(node, out){
  out = out || [];
  if(!node) return out;
  (node.connectors||[]).forEach(c=>out.push(c));
  (node.systems||[]).forEach(s=>collectAllConnectors(s,out));
  return out;
}

// Work out where each OLD pin index went in the NEW channel list, matching
// by name, with support for DUPLICATE names (two "GND" pins, two "24V"...).
// Returns remap[oldIdx] = newIdx, or -1 if that channel no longer exists.
//
// The previous approach was `newIndexByName[name]` = FIRST index with that
// name. With duplicates, every "GND" mapped to the first GND pin, so two
// channelMap entries landed on the same slot, one overwrote the other,
// and that branch wire vanished, even on a save that only changed a color.
//
// Two passes, so a pin that didn't move can never be "stolen" by another:
//   1) A pin whose name is still at the same index stays put. This makes
//      a color-only save an exact identity mapping.
//   2) Remaining old pins claim the remaining new pins of the same name,
//      in order: the j-th leftover "GND" goes to the j-th free "GND".
function makeChannelRemap(oldChannels, newChannels){
  oldChannels=oldChannels||[];newChannels=newChannels||[];
  const remap=new Array(oldChannels.length).fill(-1);
  const claimed=new Set();
  oldChannels.forEach((name,i)=>{
    if(name&&newChannels[i]===name){remap[i]=i;claimed.add(i);}
  });
  const freeByName={};
  newChannels.forEach((name,i)=>{
    if(name&&!claimed.has(i))(freeByName[name]=freeByName[name]||[]).push(i);
  });
  oldChannels.forEach((name,i)=>{
    if(!name||remap[i]>=0)return;
    const q=freeByName[name];
    if(q&&q.length)remap[i]=q.shift();
  });
  return remap;
}

// Remap a splice's channelMap so each existing routing "follows" its channel
// by NAME rather than staying pinned to a now-stale index. Used whenever a
// splice's own channels array gets reordered (directly, or via stem mirror).
function remapChannelMapByName(splice, oldChannels, newChannels){
  if(!splice.channelMap)return;
  const remap=makeChannelRemap(oldChannels,newChannels);
  const newMap=Array.from({length:newChannels.length},()=>null);
  splice.channelMap.forEach((mappings,oldIdx)=>{
    if(!Array.isArray(mappings)||!mappings.some(m=>m&&m.connId))return;
    const targetIdx=remap[oldIdx]>=0?remap[oldIdx]:oldIdx;
    if(targetIdx<0||targetIdx>=newMap.length)return;
    const copy=mappings.map(m=>({...m}));
    // Never silently overwrite: if two routings end up on one pin (only
    // possible via the fallback path), keep both instead of dropping one.
    newMap[targetIdx]=newMap[targetIdx]?[...newMap[targetIdx],...copy]:copy;
  });
  for(let i=0;i<newMap.length;i++){if(!newMap[i])newMap[i]=[{connId:'',chName:''}];}
  splice.channelMap=newMap;
  const used=new Set();
  newMap.forEach((mappings,i)=>{if(mappings.some(m=>m&&m.connId))used.add(i);});
  splice.usedChannelIndices=[...used];
}

// When a connector is saved, keep any splice(s) stemming from it in sync:
// - Same-type splices (no stemChannelMap) always mirror the stem's full
//   pinout, so re-copy channels/colors and remap channelMap by name.
// - Custom-type splices (stemChannelMap set) only reference specific stem
//   channels by index; follow each one by name if the stem reordered.
// Also remaps the splice's own channelMap if the SAVED connector IS a
// splice being edited directly (e.g. via double-click, not the splice page).
function resyncSpliceRelationships(conn, oldChannels, oldColors){
  const sc=scope();if(!sc)return;
  // Duplicate-name-aware old→new pin index map for THIS connector
  const stemRemap=makeChannelRemap(oldChannels,conn.channels);
  const stemSplices=sc.connectors.filter(c=>c.isSplice&&c.stemFromId===conn.id);
  stemSplices.forEach(splice=>{
    const stemWire=sc.wires.find(w=>w.spliceConnId===splice.id);
    if(!splice.stemChannelMap){
      const oldSpliceChannels=[...(splice.channels||[])];
      splice.type=conn.type;splice.pins=conn.pins;
      splice.channels=[...conn.channels];splice.colors=[...conn.colors];
      remapChannelMapByName(splice,oldSpliceChannels,splice.channels);
      if(stemWire){
        const newUsed=new Set();
        (stemWire.usedChannelIndices||[]).forEach(oldIdx=>{
          const newIdx=stemRemap[oldIdx];
          if(newIdx!==undefined&&newIdx>=0)newUsed.add(newIdx);
        });
        stemWire.usedChannelIndices=[...newUsed];
      }
    } else {
      splice.stemChannelMap=splice.stemChannelMap.map((stemIdx,pinIdx)=>{
        if(stemIdx===null||stemIdx===undefined)return stemIdx;
        const newIdx=stemRemap[stemIdx];
        if(newIdx===undefined||newIdx<0)return stemIdx;
        splice.channels[pinIdx]=conn.channels[newIdx];
        splice.colors[pinIdx]=conn.colors[newIdx]||'red';
        return newIdx;
      });
      if(stemWire)stemWire.usedChannelIndices=[...new Set(splice.stemChannelMap.filter(v=>v!==null&&v!==undefined))];
    }
  });
  if(conn.isSplice)remapChannelMapByName(conn,oldChannels,conn.channels);

  // If `conn` is a CHILD referenced by some splice's channelMap in this
  // scope, refresh the stored chName so future branch-wire color/name
  // lookups don't drift if this save renamed the channel.
  sc.connectors.filter(c=>c.isSplice&&c.channelMap).forEach(splice=>{
    splice.channelMap.forEach(mappings=>{
      if(!Array.isArray(mappings))return;
      mappings.forEach(m=>{
        if(!m||m.connId!==conn.id)return;
        const oldIdx=oldChannels.indexOf(m.chName);
        if(oldIdx>=0&&conn.channels[oldIdx])m.chName=conn.channels[oldIdx];
      });
    });
  });
}

// Propagate a just-saved connector's channel colors to every other connector
// in the project that has a channel with the same name (same "net"),
// so a net's color stays consistent everywhere it appears.
function syncNetColors(conn){
  if(!activeProjId||!conn||!conn.channels) return;
  const proj=ST.projects.find(p=>p.id===activeProjId);
  if(!proj) return;
  const all=collectAllConnectors(proj);
  conn.channels.forEach((name,i)=>{
    const nm=(name||'').trim();
    if(!nm) return;
    const color=conn.colors[i]||'red';
    all.forEach(other=>{
      if(other===conn||!other.channels) return;
      other.channels.forEach((oname,oi)=>{
        if((oname||'').trim()===nm){
          if(!other.colors)other.colors=[];
          while(other.colors.length<=oi)other.colors.push('red');
          other.colors[oi]=color;
        }
      });
    });
  });
}

// Pinout layouts
const PINOUTS = {
  // Amphenol 9-35 (6-pin): from image — hexagonal ring + center
  // Top row: 5(left), 1(right)
  // Middle row: 4(far-left), 6(center), 2(far-right)
  // Bottom: 3(center-bottom)
  'Amphenol 9-35':{shape:'amphenol',R:54,fixedPins:6,pins:[
    {id:1, dx:28,  dy:-30},
    {id:2, dx:44,  dy:4},
    {id:3, dx:16,  dy:38},
    {id:4, dx:-44, dy:4},
    {id:5, dx:-28, dy:-30},
    {id:6, dx:0,   dy:4}
  ]},
  // Amphenol 13-pin: scattered irregular circular layout
  'Amphenol 13-pin':{shape:'amphenol',R:68,fixedPins:13,pins:[
    {id:1, dx:68,   dy:0},
    {id:2, dx:55,   dy:40},
    {id:3, dx:21,   dy:64.7},
    {id:4, dx:-21,  dy:64.7},
    {id:5, dx:-55,  dy:40},
    {id:6, dx:-68,  dy:0},
    {id:7, dx:-55,  dy:-40},
    {id:8, dx:-21,  dy:-64.7},
    {id:9, dx:21,   dy:-64.7},
    {id:10,dx:55,   dy:-40},
    {id:11,dx:26,   dy:0},
    {id:13,dx:-13,  dy:-22.5},
    {id:12,dx:-13,  dy:22.5},
    ]},
  // DSUB-9: horizontal, 2 staggered rows. Top row (5 pins): 1-5 right-to-left. Bottom (4 pins): 6-9 right-to-left
  // From image: top row pins right-to-left = 1,6,2,7,3,8,4,9,5 alternating?
  // Image shows bottom numbers: 5,9,4,8,3,7,2,6,1 left-to-right
  // So left-to-right bottom positions: 5(top),9(bot),4(top),8(bot),3(top),7(bot),2(top),6(bot),1(top)
  // Top row (pins 1,2,3,4,5): positions at x = 44,22,0,-22,-44 (right to left = 1..5)
  // Bottom row (pins 6,7,8,9): positions at x = 33,11,-11,-33
  'DSUB-9':{shape:'dsub_h',W:160,H:70,fixedPins:9,pins:[
    {id:1,dx:56,dy:-14},{id:2,dx:28,dy:-14},{id:3,dx:0,dy:-14},{id:4,dx:-28,dy:-14},{id:5,dx:-56,dy:-14},
    {id:6,dx:42,dy:14}, {id:7,dx:14,dy:14}, {id:8,dx:-14,dy:14},{id:9,dx:-42,dy:14}
  ]},
  // DSUB-15: larger layout for readability
  'DSUB-15':{shape:'dsub_h',W:300,H:72,fixedPins:15,pins:[
    {id:1,dx:112,dy:-16},{id:2,dx:80,dy:-16},{id:3,dx:48,dy:-16},{id:4,dx:16,dy:-16},
    {id:5,dx:-16,dy:-16},{id:6,dx:-48,dy:-16},{id:7,dx:-80,dy:-16},{id:8,dx:-112,dy:-16},
    {id:9,dx:96,dy:16},{id:10,dx:64,dy:16},{id:11,dx:32,dy:16},{id:12,dx:0,dy:16},
    {id:13,dx:-32,dy:16},{id:14,dx:-64,dy:16},{id:15,dx:-96,dy:16}
  ]},
  // DSUB-37: larger with clear 26px pin spacing
  'DSUB-37':{shape:'dsub_h',W:500,H:72,fixedPins:37,pins:(()=>{
    const p=[];
    const topN=19, botN=18, sp=26;
    const topSpan=(topN-1)*sp, botSpan=(botN-1)*sp;
    for(let i=0;i<topN;i++) p.push({id:i+1,    dx:-topSpan/2+i*sp, dy:-16});
    for(let i=0;i<botN;i++) p.push({id:i+topN+1,dx:-botSpan/2+i*sp, dy:16});
    return p;
  })()},
  // Amphenol 9-98 (3-pin): pins sit at the vertices of an equilateral
  // triangle — pin 1 at top, 2 and 3 at the bottom-right/bottom-left.
  'Amphenol 9-98':{shape:'amphenol',R:40,fixedPins:3,pins:[
    {id:1, dx:0,      dy:-40},
    {id:2, dx:34.64,  dy:20},
    {id:3, dx:-34.64, dy:20}
  ]},
  'Molex':{shape:'rect_grid',fixedPins:null,pins:[]},
  'XT60':{shape:'xt',W:60,H:44,fixedPins:2,pins:[{id:1,dx:-16,dy:0,lbl:'+'},{id:2,dx:16,dy:0,lbl:'−'}]},
  'XT30':{shape:'xt',W:48,H:36,fixedPins:2,pins:[{id:1,dx:-12,dy:0,lbl:'+'},{id:2,dx:12,dy:0,lbl:'−'}]},
  'JST':{shape:'rect_grid',fixedPins:null,pins:[]},
  'Custom':{shape:'rect_grid',fixedPins:null,pins:[]}
};

// ═══════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════