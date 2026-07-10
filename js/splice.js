// ── SPLICE SYSTEM ────────────────────────────────────────

function editSplice(conn){
  // Open splice page pre-populated with existing splice data
  const sc=scope();
  spliceState={
    wireId:null, t:conn.t||0.5,
    fromConnId:conn.stemFromId||conn.id,
    isConnEdit:true, connId:conn.id,
    wireFromConn:null, wireToConn:null,
    editingExistingSplice:true, spliceConnId:conn.id
  };
  // Pre-populate spChMappings from existing channelMap
  spChMappings=conn.channelMap
    ? conn.channelMap.map(arr=>Array.isArray(arr)?arr.map(m=>({...m})):[{connId:'',chName:''}])
    : [];
  goPage('pg-splice');
}

function openSplicePage(wire, wx, wy, isConnEdit, connId){
  const sc=scope();
  if(isConnEdit){
    spliceState={wireId:null,t:0.5,fromConnId:connId,isConnEdit:true,connId,
      wireFromConn:null,wireToConn:null};
  } else {
    const cA=sc.connectors.find(c=>c.id===wire.fromConn);
    const cB=sc.connectors.find(c=>c.id===wire.toConn);
    const eA=connEdgePos(cA),eB=connEdgePos(cB);
    const {c1,c2}=bezierCPs(eA.x,eA.y,eA.edge,eB.x,eB.y,eB.edge,wire,1);
    let bestT=0.5,bestD=Infinity;
    for(let t=0;t<=1;t+=0.01){
      const bx=bpt(eA.x,c1.x,c2.x,eB.x,t),by=bpt(eA.y,c1.y,c2.y,eB.y,t);
      const d=Math.hypot(wx-bx,wy-by);
      if(d<bestD){bestD=d;bestT=t;}
    }
    // Store both wire endpoint IDs — user will choose which side to stem from
    spliceState={wireId:wire.id,t:Math.max(0.05,Math.min(0.95,bestT)),
      fromConnId:wire.fromConn,  // default: fromConn side
      isConnEdit:false,connId:null,
      wireFromConn:wire.fromConn,wireToConn:wire.toConn};
  }
  goPage('pg-splice');
}

function initSplicePage(){
  const sc=scope();
  if(!sc||!spliceState)return;
  const isEdit=spliceState.isConnEdit;
  document.getElementById('sp-title').textContent=isEdit?'Convert connector to splice':'Configure wire splice';
  document.getElementById('sp-subtitle').textContent=isEdit?'This connector will fan out to multiple children':'Choose which side the splice inherits its type from, then add children.';

  // "Stems from" row: only shown for wire-splice mode, hidden for connector-convert mode
  const fromRow=document.getElementById('sp-from-row');
  if(fromRow)fromRow.style.display=isEdit?'none':'block';

  const fromSel=document.getElementById('sp-from');
  if(isEdit){
    // Convert mode: stem is the connector itself — no choice
    fromSel.innerHTML=`<option value="${spliceState.fromConnId}" selected></option>`;
  } else {
    // Wire splice: only show the two connectors on this wire — user picks which side
    const wireConns=[spliceState.wireFromConn,spliceState.wireToConn].filter(Boolean);
    fromSel.innerHTML=wireConns.map(cid=>{
      const c=sc.connectors.find(x=>x.id===cid);if(!c)return'';
      const sys=sc.systems.find(s=>s.id===c.systemId);
      const sysName=sys?sys.name:(c.isSplice?'Splice':'?');
      return `<option value="${c.id}"${c.id===spliceState.fromConnId?' selected':''}>#${c.num} ${sysName} (${c.customName||c.type})</option>`;
    }).join('');
  }
  // If editing existing splice: pre-populate children count from existing branch wires
  if(spliceState.editingExistingSplice&&spliceState.spliceConnId){
    const existConn=sc.connectors.find(c=>c.id===spliceState.spliceConnId);
    const branchWires=sc.wires.filter(w=>w.fromConn===spliceState.spliceConnId&&w.isBranch);
    const nExist=Math.max(branchWires.length,1);
    document.getElementById('sp-nchildren').value=nExist;
    // spChMappings already set by editSplice()
    renderSpChildren(nExist);
    // Pre-select existing children in the dropdowns
    branchWires.forEach((w,i)=>{
      const childConn=sc.connectors.find(c=>c.id===w.toConn);
      if(!childConn)return;
      const sysSel=document.getElementById(`sp-child-sys-${i}`);
      const connSel=document.getElementById(`sp-child-conn-${i}`);
      if(sysSel&&childConn.systemId){
        sysSel.value=childConn.systemId;
        refreshSpChildConn(i);
      }
      if(connSel)connSel.value=w.toConn;
    });
    renderSpChannels();
  } else {
    document.getElementById('sp-nchildren').value=1;
    if(!spliceState.editingExistingSplice){spChMappings=[];spChildren=[];}
    renderSpChildren(1);
  }
  renderSpSVG();
}

function onSpFrom(){
  const val=document.getElementById('sp-from')?.value;
  if(val&&spliceState)spliceState.fromConnId=val;
  renderSpSVG();
}

function onSpNchildren(n){
  n=Math.max(1,Math.min(20,n||1));
  renderSpChildren(n);
  renderSpChannels();
  renderSpSVG();
}

function renderSpChildren(n){
  const sc=scope();
  const area=document.getElementById('sp-children-area');

  // Snapshot current selections before wiping DOM
  const prevLen=spChildren.length;
  for(let i=0;i<prevLen;i++){
    const sysSel=document.getElementById(`sp-child-sys-${i}`);
    const connSel=document.getElementById(`sp-child-conn-${i}`);
    if(sysSel)spChildren[i]={sysId:sysSel.value,connId:connSel?.value||''};
  }
  // Grow array if n is larger
  while(spChildren.length<n)spChildren.push({sysId:sc.systems[0]?.id||'',connId:''});
  // Trim if n is smaller
  spChildren=spChildren.slice(0,n);

  area.innerHTML='<div class="sp-sect-hdr">Children</div>';
  for(let i=0;i<n;i++){
    const row=document.createElement('div');row.className='sp-child-row';
    const saved=spChildren[i]||{};
    const sysOpts=sc.systems.map(s=>`<option value="${s.id}"${s.id===saved.sysId?' selected':''}>${s.name}</option>`).join('');
    row.innerHTML=`<label>Child ${i+1}</label><select id="sp-child-sys-${i}" onchange="onSpChildSys(${i})">${sysOpts}</select><select id="sp-child-conn-${i}" onchange="renderSpChannels()"></select>`;
    area.appendChild(row);
    refreshSpChildConn(i);
    // Restore saved connector selection
    const connSel=document.getElementById(`sp-child-conn-${i}`);
    if(connSel&&saved.connId){
      const opt=[...connSel.options].find(o=>o.value===saved.connId);
      if(opt)opt.selected=true;
    }
  }
  renderSpChannels();
}

function onSpChildSys(i){refreshSpChildConn(i);renderSpChannels();renderSpSVG();}

function refreshSpChildConn(i){
  const sc=scope();
  const sysSel=document.getElementById(`sp-child-sys-${i}`);
  const connSel=document.getElementById(`sp-child-conn-${i}`);
  if(!sysSel||!connSel)return;
  const sysId=sysSel.value;
  const conns=sc.connectors.filter(c=>!c.isSplice&&c.systemId===sysId);
  connSel.innerHTML=conns.map(c=>`<option value="${c.id}">#${c.num} (${c.customName||c.type})</option>`).join('');
}

// spChMappings[chIdx] = [{connId, chName}, ...] — multi-child per channel
let spChMappings = [];
let spChildren = []; // [{sysId, connId}] — persists across renderSpChildren calls

function renderSpChannels(){
  const sc=scope();
  const fromId=document.getElementById('sp-from')?.value;
  const fromConn=sc.connectors.find(c=>c.id===fromId);
  if(!fromConn)return;
  const n=fromConn.pins;
  const nChildren=+document.getElementById('sp-nchildren')?.value||1;
  const area=document.getElementById('sp-channels-area');
  area.innerHTML='';

  // Init mappings if needed
  if(spChMappings.length!==n){
    spChMappings=fromConn.channels.slice(0,n).map(()=>[{connId:'',chName:''}]);
  }

  const hdr=document.createElement('div');hdr.className='sp-sect-hdr';
  hdr.textContent=`Channel routing (${n} channels)`;
  area.appendChild(hdr);

  fromConn.channels.slice(0,n).forEach((ch,chIdx)=>{
    const block=document.createElement('div');
    block.style.cssText='background:#fafafa;border:1px solid #eee;border-radius:8px;padding:8px 10px;margin-bottom:8px';
    block.id=`sp-ch-block-${chIdx}`;

    const title=document.createElement('div');
    title.style.cssText='font-size:11px;font-weight:700;color:#c0392b;margin-bottom:6px';
    title.textContent=`Ch ${chIdx+1}: ${ch||'(unnamed)'}`;
    block.appendChild(title);

    // Render each mapping row for this channel
    function renderMappings(){
      // Clear existing mapping rows (not title)
      while(block.children.length>1)block.removeChild(block.lastChild);
      const mappings=spChMappings[chIdx];
      mappings.forEach((mapping,mIdx)=>{
        const row=document.createElement('div');
        row.style.cssText='display:flex;gap:5px;align-items:center;margin-bottom:4px;flex-wrap:wrap';

        // Child selector
        const childOpts=buildChildOpts(nChildren);
        const csel=document.createElement('select');
        csel.style.cssText='flex:1;min-width:90px;padding:4px 6px;border:1px solid #e2e5ea;border-radius:5px;font-size:10px;background:#fff';
        csel.innerHTML='<option value="">— child —</option>'+childOpts;
        if(mapping.connId){const opt=[...csel.options].find(o=>o.value===mapping.connId);if(opt)opt.selected=true;}
        csel.onchange=()=>{
          spChMappings[chIdx][mIdx].connId=csel.value;
          // Refresh chName selector
          refreshChNameSel(nsel,csel.value);
          renderSpSVG();renderSpChSummary();
        };

        // Channel name selector on child
        const nsel=document.createElement('select');
        nsel.style.cssText='flex:1;min-width:80px;padding:4px 6px;border:1px solid #e2e5ea;border-radius:5px;font-size:10px;background:#fff';
        nsel.innerHTML='<option value="">— pin —</option>';
        if(mapping.connId)refreshChNameSel(nsel,mapping.connId,mapping.chName);
        nsel.onchange=()=>{spChMappings[chIdx][mIdx].chName=nsel.value;renderSpChSummary();};

        // Remove button (only if >1 mapping)
        const rmBtn=document.createElement('button');
        rmBtn.textContent='✕';rmBtn.title='Remove';
        rmBtn.style.cssText='padding:2px 6px;border:1px solid #e2e5ea;border-radius:4px;background:#fff;cursor:pointer;font-size:10px;color:#aaa;flex-shrink:0';
        rmBtn.onclick=()=>{
          if(spChMappings[chIdx].length>1){spChMappings[chIdx].splice(mIdx,1);renderMappings();}
        };

        row.appendChild(csel);row.appendChild(nsel);row.appendChild(rmBtn);
        block.appendChild(row);
      });

      // Add child button
      const addBtn=document.createElement('button');
      addBtn.innerHTML='+ Add child';
      addBtn.style.cssText='font-size:10px;color:#c0392b;border:1px dashed #f5c6c3;background:#fceae8;border-radius:5px;padding:3px 8px;cursor:pointer;margin-top:2px';
      addBtn.onclick=()=>{spChMappings[chIdx].push({connId:'',chName:''});renderMappings();};
      block.appendChild(addBtn);
    }

    renderMappings();
    area.appendChild(block);
  });
  renderSpSVG();renderSpChSummary();
}

function buildChildOpts(nChildren){
  const sc=scope();
  let opts='';
  for(let i=0;i<nChildren;i++){
    const sysSel=document.getElementById(`sp-child-sys-${i}`);
    const connSel=document.getElementById(`sp-child-conn-${i}`);
    if(sysSel&&connSel&&connSel.value){
      const sys=sc.systems.find(s=>s.id===sysSel.value);
      opts+=`<option value="${connSel.value}">${sys?sys.name:'?'} #${connSel.value.slice(-4)}</option>`;
    }
  }
  return opts;
}

function refreshChNameSel(sel,connId,selectedName){
  const sc=scope();
  const conn=sc.connectors.find(c=>c.id===connId);
  sel.innerHTML='<option value="">— pin —</option>';
  if(conn&&conn.channels&&conn.channels.filter(Boolean).length){
    conn.channels.slice(0,conn.pins).forEach((c,idx)=>{
      const opt=document.createElement('option');
      opt.value=c;opt.textContent=`${idx+1}: ${c}`;
      if(c===selectedName)opt.selected=true;
      sel.appendChild(opt);
    });
  }
}

function renderSpChSummary(){
  const box=document.getElementById('sp-channel-summary');
  if(!box)return;
  const sc=scope();
  const fromId=document.getElementById('sp-from')?.value;
  const fromConn=sc.connectors.find(c=>c.id===fromId);
  if(!fromConn||!spChMappings.length){box.style.display='none';return;}
  const lines=spChMappings.map((mappings,i)=>{
    const ch=fromConn.channels[i]||`Ch${i+1}`;
    const targets=mappings.filter(m=>m.connId).map(m=>{
      const conn=sc.connectors.find(c=>c.id===m.connId);
      const sys=conn?sc.systems.find(s=>s.id===conn.systemId):null;
      return `${sys?sys.name:'?'}${m.chName?' → '+m.chName:''}`;
    });
    return `<div style="padding:3px 0;border-bottom:1px solid #f0f0f0"><b style="color:#c0392b">${ch}</b> → ${targets.length?targets.join(', '):'<span style="color:#bbb">unassigned</span>'}</div>`;
  }).join('');
  box.innerHTML='<div style="font-weight:600;margin-bottom:6px;font-size:11px">Channel summary</div>'+lines;
  box.style.display='block';
}

function onSpChChild(i){renderSpChannels();}

function refreshSpChName(i){
  // Legacy compat — now handled inside renderSpChannels
}

function renderSpSVG(){
  const sc=scope();
  const ns='http://www.w3.org/2000/svg';
  const svg=document.getElementById('sp-svg');
  if(!svg)return;
  svg.innerHTML='';
  const W=420,H=280,cy=H/2;
  const isEdit=spliceState&&spliceState.isConnEdit;
  const fromId=document.getElementById('sp-from')?.value;
  const fromConn=fromId?sc.connectors.find(c=>c.id===fromId):null;
  const nChildren=+document.getElementById('sp-nchildren')?.value||1;
  function el(tag,attrs,txt){
    const e=document.createElementNS(ns,tag);
    for(const k in attrs)e.setAttribute(k,attrs[k]);
    if(txt!==undefined)e.textContent=txt;
    return e;
  }
  const childSpacing=Math.min(50,(H-40)/Math.max(nChildren,1));
  const startY=cy-(nChildren-1)*childSpacing/2;

  if(isEdit){
    // Convert mode: show the connector being converted as the source (large dot, left)
    // No intermediate S dot — wires fan directly from it
    const fromSys=fromConn?sc.systems.find(s=>s.id===fromConn.systemId):null;
    const srcLabel=fromConn?`#${fromConn.num} ${fromSys?.name||''}`:'Connector';
    svg.appendChild(el('circle',{cx:90,cy,r:22,fill:'#c0392b',stroke:'#fff','stroke-width':2.5}));
    svg.appendChild(el('text',{x:90,y:cy,'text-anchor':'middle','dominant-baseline':'middle','font-size':10,'font-weight':'700',fill:'#fff'},`#${fromConn?.num||'?'}`));
    svg.appendChild(el('text',{x:90,y:cy+32,'text-anchor':'middle','font-size':9,fill:'#666'},srcLabel));
    // Fan lines directly from source dot to children
    for(let i=0;i<nChildren;i++){
      const ty=startY+i*childSpacing;
      const csel=document.getElementById(`sp-child-sys-${i}`);
      const sysName=csel?csel.options[csel.selectedIndex]?.text:`Child ${i+1}`;
      const path=`M 112 ${cy} C 200 ${cy} 230 ${ty} 300 ${ty}`;
      svg.appendChild(el('path',{d:path,stroke:'#c0392b','stroke-width':1.5,fill:'none'}));
      svg.appendChild(el('circle',{cx:300,cy:ty,r:10,fill:'#c0392b',stroke:'#fff','stroke-width':1.5}));
      svg.appendChild(el('text',{x:316,y:ty+1,'dominant-baseline':'middle','font-size':9,fill:'#444'},sysName));
    }
  } else {
    // Wire splice mode: source connector → S dot → fan to children
    const fromSys=fromConn?sc.systems.find(s=>s.id===fromConn.systemId):null;
    const srcLabel=fromConn?`#${fromConn.num} ${fromSys?.name||''}`:'Source';
    svg.appendChild(el('circle',{cx:70,cy,r:16,fill:'#c0392b',stroke:'#fff','stroke-width':2}));
    svg.appendChild(el('text',{x:70,y:cy+26,'text-anchor':'middle','font-size':9,fill:'#666'},srcLabel));
    // Line from source to S dot
    svg.appendChild(el('line',{x1:86,y1:cy,x2:178,y2:cy,stroke:'#c0392b','stroke-width':2}));
    // S splice dot
    svg.appendChild(el('circle',{cx:192,cy,r:14,fill:'#c0392b',stroke:'#fff','stroke-width':2}));
    svg.appendChild(el('text',{x:192,y:cy+1,'text-anchor':'middle','dominant-baseline':'middle','font-size':9,'font-weight':'700',fill:'#fff'},'S'));
    // Fan lines from S dot to children
    for(let i=0;i<nChildren;i++){
      const ty=startY+i*childSpacing;
      const csel=document.getElementById(`sp-child-sys-${i}`);
      const sysName=csel?csel.options[csel.selectedIndex]?.text:`Child ${i+1}`;
      const path=`M 206 ${cy} C 250 ${cy} 270 ${ty} 310 ${ty}`;
      svg.appendChild(el('path',{d:path,stroke:'#c0392b','stroke-width':1.5,fill:'none'}));
      svg.appendChild(el('circle',{cx:310,cy:ty,r:10,fill:'#c0392b',stroke:'#fff','stroke-width':1.5}));
      svg.appendChild(el('text',{x:326,y:ty+1,'dominant-baseline':'middle','font-size':9,fill:'#444'},sysName));
    }
  }
}

function commitSplice(){
  const sc=scope();
  if(!sc||!spliceState){notify('No splice state','err');return;}
  const fromId=document.getElementById('sp-from')?.value;
  const fromConn=sc.connectors.find(c=>c.id===fromId);
  if(!fromConn){notify('Select a source connector','err');return;}
  const nChildren=+document.getElementById('sp-nchildren')?.value||1;
  const channelMap=spChMappings.map(arr=>arr.map(m=>({...m})));

  if(spliceState.isConnEdit){
    if(spliceState.editingExistingSplice){
      // ── EDIT EXISTING SPLICE: update channelMap + refresh branch wires ──
      const spliceConn=sc.connectors.find(c=>c.id===spliceState.spliceConnId);
      if(!spliceConn){notify('Splice not found','err');return;}
      spliceConn.channelMap=channelMap;
      // Recompute usedChannelIndices
      const usedSet=new Set();
      channelMap.forEach((mappings,chIdx)=>{
        if(Array.isArray(mappings)?mappings.some(m=>m&&m.connId):false)usedSet.add(chIdx);
      });
      spliceConn.usedChannelIndices=[...usedSet];
      // Remove old branch wires only, keep stem wire intact
      const oldBranchIds=sc.wires.filter(w=>w.fromConn===spliceState.spliceConnId&&w.isBranch).map(w=>w.id);
      removeWhere(sc.wires,w=>w.fromConn===spliceState.spliceConnId&&w.isBranch);
      markDeleted(oldBranchIds);
      // Update stem wire usedChannelIndices
      const stemWire=sc.wires.find(w=>w.toConn===spliceState.spliceConnId||w.spliceConnId===spliceState.spliceConnId);
      if(stemWire)stemWire.usedChannelIndices=[...usedSet];
      // Add updated branch wires
      const added=new Set();
      for(let i=0;i<nChildren;i++){
        const cconn=document.getElementById(`sp-child-conn-${i}`);
        if(cconn?.value&&!added.has(cconn.value)){
          added.add(cconn.value);
          sc.wires.push({id:'w'+(Date.now()+i+1),fromConn:spliceState.spliceConnId,toConn:cconn.value,length:null,isBranch:true});
        }
      }
      spChMappings=[];
      save();notify('Splice updated','ok');
      goPage('pg-canvas');
      return;
    }
    // ── CONVERT mode: the existing connector BECOMES the splice ──
    fromConn.isSplice=true;
    fromConn.channelMap=channelMap;
    fromConn.stemFromId=fromId;
    // Remove the existing point-to-point wire on this connector
    const oldWireIds=sc.wires.filter(w=>w.fromConn===fromId||w.toConn===fromId).map(w=>w.id);
    removeWhere(sc.wires,w=>w.fromConn===fromId||w.toConn===fromId);
    markDeleted(oldWireIds);
    // Add branch wires from this connector to each child
    const added=new Set();
    for(let i=0;i<nChildren;i++){
      const cconn=document.getElementById(`sp-child-conn-${i}`);
      if(cconn?.value&&!added.has(cconn.value)){
        added.add(cconn.value);
        sc.wires.push({id:'w'+(Date.now()+i+1),fromConn:fromId,toConn:cconn.value,length:null,isBranch:true});
      }
    }
    spChMappings=[];
    save();notify('Connector converted to splice','ok');
    goPage('pg-canvas');
    return;
  }

  // ── WIRE SPLICE mode: create a new free-floating splice connector ──
  const wire=sc.wires.find(w=>w.id===spliceState.wireId);
  if(!wire){notify('Wire not found','err');return;}

  // Compute position at t along the wire
  const cA=sc.connectors.find(c=>c.id===wire.fromConn);
  const cB=sc.connectors.find(c=>c.id===wire.toConn);
  let spliceX=200,spliceY=200;
  if(cA&&cB){
    const eA=connEdgePos(cA),eB=connEdgePos(cB);
    const {c1,c2}=bezierCPs(eA.x,eA.y,eA.edge,eB.x,eB.y,eB.edge,wire,1);
    const t=spliceState.t||0.5;
    spliceX=bpt(eA.x,c1.x,c2.x,eB.x,t);
    spliceY=bpt(eA.y,c1.y,c2.y,eB.y,t);
  }

  // Compute which channel indices are actually needed by any child
  const usedChIndices=new Set();
  channelMap.forEach((mappings,chIdx)=>{
    const hasMapped=Array.isArray(mappings)?mappings.some(m=>m&&m.connId):false;
    if(hasMapped)usedChIndices.add(chIdx);
  });

  const spliceId='c'+Date.now();
  const num=sc.connectors.length+1;
  const splice={id:spliceId,isSplice:true,x:spliceX,y:spliceY,
    type:fromConn.type,customName:fromConn.customName||fromConn.type,
    pins:fromConn.pins,channels:[...fromConn.channels],colors:[...fromConn.colors],
    num,channelMap,stemFromId:fromId,
    usedChannelIndices:[...usedChIndices]};  // which channels flow into this splice
  sc.connectors.push(splice);

  // Remove original wire, replace with fromConn→splice
  // Stem wire carries only the used channels (stored on the wire for draw filtering)
  removeWhere(sc.wires,w=>w.id===wire.id);
  markDeleted([wire.id]);
  sc.wires.push({id:'w'+Date.now(),fromConn:wire.fromConn,toConn:spliceId,length:null,
    spliceConnId:spliceId,
    usedChannelIndices:[...usedChIndices]});  // draw loop uses this to filter channels

  // Branch wires from splice to each child
  const added=new Set();
  for(let i=0;i<nChildren;i++){
    const cconn=document.getElementById(`sp-child-conn-${i}`);
    if(cconn?.value&&!added.has(cconn.value)){
      added.add(cconn.value);
      sc.wires.push({id:'w'+(Date.now()+i+2),fromConn:spliceId,toConn:cconn.value,length:null,isBranch:true});
    }
  }

  spChMappings=[];spChildren=[];
  save();notify('Splice created — connector #'+num,'ok');
  goPage('pg-canvas');
}

function saveWireLen(){
  const v=parseFloat(document.getElementById('wl-val').value);
  if(!v||v<=0){notify('Enter a valid length','err');return;}
  const sc=scope();
  const wire=sc?.wires.find(w=>w.id===editWireId);
  if(wire){wire.length=v;save();redraw();notify('Wire length saved','ok');}
  closeM('m-wirelen');
}
