// PAGE 3: CONNECTOR
// ═══════════════════════════════════════════════════════
function renderConnPage(){
  const sc=scope();if(!sc)return;
  const conn=sc.connectors.find(c=>c.id===activeConnId);if(!conn)return;
  if(!conn.channels)conn.channels=[];
  if(!conn.colors||conn.colors.length===0)conn.colors=[];
  while(conn.channels.length<conn.pins)conn.channels.push('');
  while(conn.colors.length<conn.pins)conn.colors.push('red');
  // Ensure colors array matches pin count exactly
  conn.colors=conn.colors.slice(0,conn.pins);
  while(conn.colors.length<conn.pins)conn.colors.push('red');
  // Create draft copy — edits go here, committed on Save
  draftConn={
    ...conn,
    channels:[...conn.channels],
    colors:[...conn.colors],
  };
  document.getElementById('ct-type').value=conn.type;
  document.getElementById('ct-pins').value=conn.pins;
  document.getElementById('ct-id').textContent='#'+conn.num;
  document.getElementById('ct-cname-wrap').style.display=conn.type==='Custom'?'block':'none';
  if(conn.type==='Custom')document.getElementById('ct-cname').value=conn.customName||'';
  const nameEl=document.getElementById('ct-name');if(nameEl)nameEl.value=conn.name||'';

  // Show pin count vs grid based on type
  const prow=document.getElementById('ct-pins-row');
  const grow=document.getElementById('ct-grid-row');
  const isGrid2=['Molex','JST','Custom'].includes(draftConn.type);
  if(prow)prow.style.display=FIXED_PINS.has(draftConn.type)?'none':(isGrid2?'none':'block');
  if(grow)grow.style.display=isGrid2?'block':'none';
  if(isGrid2){
    const ci=document.getElementById('ct-cols');const ri=document.getElementById('ct-rows');
    if(ci)ci.value=draftConn.cols||5;if(ri)ri.value=draftConn.rows||1;
  }
  renderConnSVG(draftConn);renderChList(draftConn);checkWarn(draftConn);renderCcSel(draftConn);
}

function renderConnSVG(conn){
  const area=document.getElementById('conn-svg-area');area.innerHTML='';
  const sc=scope();
  const row=document.createElement('div');row.className='conn-pair-row';
  const layout=PINOUTS[conn.type]||{shape:'rect',W:90,H:40,pins:[]};
  // Generate pins for custom pin counts
  let pins=[...layout.pins];
  while(pins.length<conn.pins){
    const i=pins.length;const angle=(i/conn.pins)*Math.PI*2-Math.PI/2;
    const R=(layout.R||50)*.75;
    pins.push({id:i+1,dx:Math.cos(angle)*R,dy:Math.sin(angle)*R});
  }
  pins=pins.slice(0,conn.pins);

  function buildSVG(alpha){
    const ns='http://www.w3.org/2000/svg';
    // Size SVG to fit the connector — DSUB connectors need extra width
    const sh=layout.shape;
    const svgW = (sh==='dsub_h'&&layout.W>=380)?layout.W+40
               : (sh==='dsub_h'&&layout.W>=180)?layout.W+40
               : 240;
    const svgH = (sh==='dsub_h'&&layout.W>=380)?layout.H+80
               : (sh==='dsub_h'&&layout.W>=180)?layout.H+60
               : 240;
    const size=svgW; const cx=svgW/2, cy=svgH/2;
    const svg=document.createElementNS(ns,'svg');
    svg.setAttribute('width',svgW);svg.setAttribute('height',svgH);
    svg.setAttribute('viewBox',`0 0 ${svgW} ${svgH}`);

    function el(tag,attrs,txt){
      const e=document.createElementNS(ns,tag);
      for(const k in attrs)e.setAttribute(k,attrs[k]);
      if(txt!==undefined)e.textContent=txt;
      return e;
    }

    // Build pin list: use layout pins if they match conn.pins, else auto-generate
    let pins=[...layout.pins];
    while(pins.length<conn.pins){
      const i=pins.length;
      const angle=(i/conn.pins)*Math.PI*2-Math.PI/2;
      const R=(layout.R||50)*.75;
      pins.push({id:i+1,dx:Math.cos(angle)*R,dy:Math.sin(angle)*R});
    }
    pins=pins.slice(0,conn.pins);

    const shape=layout.shape||'rect';

    // ── AMPHENOL (circular) ──
    if(shape==='amphenol'){
      const R=layout.R||56;
      svg.appendChild(el('circle',{cx,cy,r:R+12,fill:`rgba(160,175,185,${alpha})`,stroke:`rgba(110,125,135,${alpha})`,'stroke-width':2}));
      // Key notch top
      svg.appendChild(el('path',{d:`M ${cx-9} ${cy-R-12} A 9 9 0 0 1 ${cx+9} ${cy-R-12}`,fill:'none',stroke:`rgba(255,255,255,${alpha*.5})`,'stroke-width':3,'stroke-linecap':'round'}));
      svg.appendChild(el('circle',{cx,cy,r:R,fill:`rgba(210,218,225,${alpha})`}));
      pins.forEach(pin=>{
        const px=cx+pin.dx, py=cy+pin.dy;
        // Gold pin ring — clickable on male side
        const pinCircle=el('circle',{cx:px,cy:py,r:9,fill:`rgba(190,150,30,${alpha})`,stroke:`rgba(130,95,15,${alpha})`,'stroke-width':1.5});
        if(alpha===1){pinCircle.style.cursor='pointer';pinCircle.onclick=()=>promptPinNum(pin,conn,svg,alpha);}
        svg.appendChild(pinCircle);
        svg.appendChild(el('circle',{cx:px,cy:py,r:4,fill:`rgba(70,55,15,${alpha})`}));
        // Pin number — outside pin, bigger and dark, also clickable
        const ang=Math.atan2(pin.dy||0.001,pin.dx||0.001);
        const lr=18;
        const tx2=px+Math.cos(ang)*lr, ty2=py+Math.sin(ang)*lr;
        const numEl=el('text',{x:tx2,y:ty2,'font-size':12,'font-weight':'900',fill:`rgba(10,10,10,${alpha})`,'text-anchor':'middle','dominant-baseline':'central','font-family':'sans-serif'},String(pin.id));
        if(alpha===1){numEl.style.cursor='pointer';numEl.onclick=()=>promptPinNum(pin,conn,svg,alpha);}
        svg.appendChild(numEl);
      });
    }
    // ── DSUB horizontal ──
    else if(shape==='dsub_h'){
      const W=layout.W||160, H=layout.H||70;
      const lx=cx-W/2, ly=cy-H/2;
      // Scale pin size based on connector width: more pins = smaller
      const pinR=W>=450?5:W>=250?6:7;
      const fontSize=W>=450?8:W>=250?9:10;
      const stemLen=W>=450?8:W>=250?10:12;
      // Trapezoidal body
      const cornerR=W>=450?5:8;
      svg.appendChild(el('path',{d:`M ${lx-cornerR} ${ly+4} Q ${lx-cornerR} ${ly} ${lx} ${ly} L ${lx+W} ${ly} Q ${lx+W+cornerR} ${ly} ${lx+W+cornerR} ${ly+4} L ${lx+W+cornerR} ${ly+H-4} Q ${lx+W+cornerR} ${ly+H} ${lx+W} ${ly+H} L ${lx} ${ly+H} Q ${lx-cornerR} ${ly+H} ${lx-cornerR} ${ly+H-4} Z`,fill:`rgba(245,243,235,${alpha})`,stroke:`rgba(0,80,200,${alpha})`,'stroke-width':W>=450?1.5:2.5}));
      svg.appendChild(el('rect',{x:lx+2,y:ly+4,width:W-4,height:H-8,rx:2,fill:`rgba(235,230,215,${alpha})`}));
      pins.forEach(pin=>{
        const px=cx+pin.dx, py=cy+pin.dy;
        const stemY=cy+H/2+stemLen;
        svg.appendChild(el('line',{x1:px,y1:py,x2:px,y2:stemY,stroke:`rgba(0,0,0,${alpha})`,'stroke-width':W>=450?0.8:1.5}));
        svg.appendChild(el('circle',{cx:px,cy:py,r:pinR,fill:`rgba(30,80,200,${alpha})`,stroke:`rgba(0,50,160,${alpha})`,'stroke-width':W>=450?0.5:1}));
        // Pin number below, rotated -90deg, clickable
        const numY=stemY+3;
        const t2=document.createElementNS(ns,'text');
        t2.setAttribute('x',String(px));t2.setAttribute('y',String(numY));
        t2.setAttribute('font-size',String(fontSize));t2.setAttribute('font-weight','900');
        t2.setAttribute('fill',`rgba(10,10,10,${alpha})`);t2.setAttribute('text-anchor','middle');
        t2.setAttribute('font-family','sans-serif');
        // Plain horizontal pin number below the stem
        t2.setAttribute('text-anchor','middle');
        t2.setAttribute('dominant-baseline','hanging');
        t2.textContent=String(pin.id);
        if(alpha===1){
          t2.style.cursor='pointer';
          t2.onclick=()=>promptPinNum(pin,conn,svg,alpha);
        }
        svg.appendChild(t2);
      });
    }
    // ── RECT GRID (Molex, JST, Custom) ──
    else if(shape==='rect_grid'||shape==='rect'){
      const perRow=conn.cols||5;
      const rows=conn.rows||Math.ceil(conn.pins/perRow);
      const cols=Math.min(conn.pins,perRow);
      const pinSp=22, pinR=7;
      const bW=cols*pinSp+10, bH=rows*pinSp+10;
      const bx=cx-bW/2, by=cy-bH/2;
      svg.appendChild(el('rect',{x:bx,y:by,width:bW,height:bH,rx:5,fill:`rgba(40,40,40,${alpha})`,stroke:`rgba(10,10,10,${alpha*.5})`,'stroke-width':1.5}));
      svg.appendChild(el('rect',{x:bx+3,y:by+3,width:bW-6,height:bH-6,rx:3,fill:`rgba(195,190,175,${alpha})`}));
      for(let i=0;i<conn.pins;i++){
        const col=i%perRow, row=Math.floor(i/perRow);
        const px=bx+5+pinSp/2+col*pinSp;
        const py=by+5+pinSp/2+row*pinSp;
        const gc=el('circle',{cx:px,cy:py,r:pinR,fill:`rgba(160,150,115,${alpha})`,stroke:`rgba(90,80,50,${alpha})`,'stroke-width':1});
        if(alpha===1){gc.style.cursor='pointer';gc.onclick=(()=>{const p2={id:i+1,dx:0,dy:0};return()=>promptPinNum(p2,conn,svg,alpha);})();}
        svg.appendChild(gc);
        svg.appendChild(el('circle',{cx:px,cy:py,r:3,fill:`rgba(25,25,25,${alpha})`}));
        const gt=el('text',{x:px+pinR+3,y:py,'font-size':9,'font-weight':'900',fill:`rgba(10,10,10,${alpha})`,'dominant-baseline':'central','font-family':'sans-serif'},String(i+1));
        if(alpha===1){gt.style.cursor='pointer';gt.onclick=(()=>{const p2={id:i+1,dx:0,dy:0};return()=>promptPinNum(p2,conn,svg,alpha);})();}
        svg.appendChild(gt);
      }
    }
    // ── XT60 / XT30 ──
    else if(shape==='xt'){
      const W=layout.W||60, H=layout.H||44;
      svg.appendChild(el('rect',{x:cx-W/2,y:cy-H/2,width:W,height:H,rx:8,fill:`rgba(220,185,0,${alpha})`,stroke:`rgba(160,130,0,${alpha})`,'stroke-width':1.5}));
      pins.forEach(pin=>{
        const px=cx+pin.dx, py=cy+pin.dy;
        const col=pin.lbl==='+'?`rgba(180,30,30,${alpha})`:`rgba(30,30,30,${alpha})`;
        const xc=el('circle',{cx:px,cy:py,r:12,fill:col,stroke:`rgba(0,0,0,${alpha*.5})`,'stroke-width':1.5});
        if(alpha===1){xc.style.cursor='pointer';xc.onclick=()=>promptPinNum(pin,conn,svg,alpha);}
        svg.appendChild(xc);
        svg.appendChild(el('circle',{cx:px,cy:py,r:5,fill:`rgba(255,255,255,${alpha*.25})`}));
        const xt=el('text',{x:px,y:py,'font-size':14,'font-weight':'900',fill:`rgba(255,255,255,${alpha})`,'text-anchor':'middle','dominant-baseline':'central','font-family':'sans-serif'},pin.lbl||String(pin.id));
        if(alpha===1){xt.style.cursor='pointer';xt.onclick=()=>promptPinNum(pin,conn,svg,alpha);}
        svg.appendChild(xt);
        svg.appendChild(el('text',{x:px,y:py+20,'font-size':9,'font-weight':'700',fill:`rgba(200,200,200,${alpha})`,'text-anchor':'middle','font-family':'sans-serif'},String(pin.id)));
      });
    }
    return svg;
  }

  const sys=sc?.systems.find(s=>s.id===conn.systemId);
  const wire=sc?.wires.find(w=>w.fromConn===conn.id||w.toConn===conn.id);
  const othId=wire?(wire.fromConn===conn.id?wire.toConn:wire.fromConn):null;
  const oc=othId?sc.connectors.find(c=>c.id===othId):null;
  const os=oc&&!oc.isSplice?sc.systems.find(s=>s.id===oc.systemId):null;

  if(sys){const t=document.createElement('div');t.className='conn-vis-block';t.innerHTML=`<div class="conn-tag">↖ ${sys.name}</div><div style="font-size:10px;color:#bbb;margin-top:3px">male side</div>`;row.appendChild(t);}
  // Gender determines which side is the "active" (alpha=1) connector
  const isFemale=(conn.gender==='female');
  // Left connector = this connector being edited (always full opacity)
  // Right connector = the mated connector (dimmed, shows opposite gender)
  const mb=document.createElement('div');mb.className='conn-vis-block';
  // Gender dropdown above left connector
  const gSel=document.createElement('select');
  gSel.style.cssText='margin-bottom:6px;padding:4px 8px;border:1px solid #e2e5ea;border-radius:6px;font-size:12px;font-weight:600;color:#c0392b;background:#fceae8;cursor:pointer;outline:none;width:90px';
  gSel.innerHTML='<option value="male">MALE</option><option value="female">FEMALE</option>';
  gSel.value=conn.gender||'male';
  gSel.onchange=()=>onCtGender(gSel.value);
  mb.appendChild(gSel);
  mb.appendChild(buildSVG(1));
  row.appendChild(mb);
  const sep=document.createElement('div');sep.innerHTML='<div style="font-size:22px;color:#c0392b;align-self:center">↔</div>';row.appendChild(sep);
  const fb=document.createElement('div');fb.className='conn-vis-block';
  // Right side label shows opposite gender (auto-derived)
  const oppGender=isFemale?'MALE':'FEMALE';
  const fl=document.createElement('div');fl.className='vis-lbl';fl.textContent=oppGender;fl.style.cssText='font-size:11px;font-weight:700;color:#888;margin-bottom:6px';
  fb.appendChild(fl);fb.appendChild(buildSVG(0.5));row.appendChild(fb);
  const rt=document.createElement('div');rt.className='conn-vis-block';
  if(oc)rt.innerHTML=`<div class="conn-tag">#${oc.num}${os?' · '+os.name:''} ↗</div><div style="font-size:10px;color:#bbb;margin-top:3px">female side</div>`;
  else rt.innerHTML='<div style="font-size:11px;color:#bbb">Not mated</div>';
  row.appendChild(rt);
  area.appendChild(row);
}

function promptPinNum(pin, conn, svg, alpha){
  const cur=pin.id;
  const newId=prompt(`Change pin number (currently ${cur}):`, cur);
  if(!newId||isNaN(+newId)||+newId<1)return;
  const n=+newId;
  // Update the pin id in the layout — find it by current id
  const layout=PINOUTS[conn.type];
  if(layout&&layout.pins){
    const p=layout.pins.find(p=>p.id===cur);
    if(p)p.id=n;
  }
  // Also swap channel label in conn.channels if the pin was mapped
  // Channels are index-based (pin 1 = index 0), so reorder
  // We do a simple channel rename: swap channel[cur-1] <-> channel[n-1]
  if(conn.channels&&conn.channels[cur-1]!==undefined){
    const tmp=conn.channels[cur-1]||'';
    const tmpC=conn.colors?.[cur-1]||'red';
    if(conn.channels[n-1]!==undefined){
      conn.channels[cur-1]=conn.channels[n-1]||'';
      if(conn.colors)conn.colors[cur-1]=conn.colors[n-1]||'red';
    }
    conn.channels[n-1]=tmp;
    if(conn.colors)conn.colors[n-1]=tmpC;
  }
  save();
  renderConnPage(); // re-render whole page so table updates
}

function renderChList(conn){
  const list=document.getElementById('ch-list');list.innerHTML='';
  const n=conn.pins;
  // Ensure arrays are fully initialized before rendering
  if(!conn.colors)conn.colors=[];
  if(!conn.channels)conn.channels=[];
  while(conn.colors.length<n)conn.colors.push('red');
  while(conn.channels.length<n)conn.channels.push('');
  conn.colors=Array.from({length:n},(_,i)=>conn.colors[i]||'red');
  conn.channels=Array.from({length:n},(_,i)=>conn.channels[i]||'');
  conn.channels.slice(0,n).forEach((ch,i)=>{
    const row=document.createElement('div');row.className='ch-row';
    row.innerHTML=`<div class="pnum">${i+1}</div>
      <input class="chinp" value="${ch}" placeholder="e.g. GND" data-i="${i}">
      <select class="colsel" data-i="${i}">${WC.map(c=>`<option value="${c}"${conn.colors[i]===c?' selected':''} style="background:${WHX[c]||'#fff'};color:${['black','purple','blue'].includes(c)?'#fff':'#222'}">${c}</option>`).join('')}</select>`;
    row.querySelector('input').onchange=e=>{if(draftConn)draftConn.channels[+e.target.dataset.i]=e.target.value;checkWarn(draftConn||conn);};
    const sel=row.querySelector('select');
    // Set initial background color
    sel.style.background=WHX[conn.colors[i]]||'#fff';
    sel.style.color=(['black','purple','blue'].includes(conn.colors[i]))?'#fff':'#222';
    sel.onchange=e=>{
      const idx=+e.target.dataset.i, val=e.target.value;
      if(draftConn)draftConn.colors[idx]=val;
      e.target.style.background=WHX[val]||'#fff';
      e.target.style.color=(['black','purple','blue'].includes(val))?'#fff':'#222';
      redraw(); // preview — save on Save button
    };
    list.appendChild(row);
  });
}
function checkWarn(conn){
  const warns=[];
  const names=conn.channels.slice(0,conn.pins).filter(Boolean);
  const dups=[...new Set(names.filter((n,i)=>names.indexOf(n)!==i))];
  if(dups.length)warns.push('⚠ Duplicate channel names: '+dups.join(', '));
  const sc=scope();
  const wire=sc?.wires.find(w=>w.fromConn===conn.id||w.toConn===conn.id);
  if(wire){const oid=wire.fromConn===conn.id?wire.toConn:wire.fromConn;const oc=sc.connectors.find(c=>c.id===oid);
    if(oc&&oc.type!==conn.type)warns.push(`⚠ Type mismatch: ${conn.type} ↔ ${oc.type}`);
    if(oc&&oc.pins!==conn.pins)warns.push(`⚠ Pin count mismatch: ${conn.pins} ↔ ${oc.pins}`);
  }
  const box=document.getElementById('ct-warns');box.innerHTML='';
  warns.forEach(w=>{const d=document.createElement('div');d.className='warn-box';d.textContent=w;box.appendChild(d);});
}
function onCtType(val){
  if(!draftConn)return;
  draftConn.type=val;
  if(AUTO_PINS[val]!==undefined){draftConn.pins=AUTO_PINS[val];document.getElementById('ct-pins').value=draftConn.pins;}
  document.getElementById('ct-cname-wrap').style.display=val==='Custom'?'block':'none';
  const prow=document.getElementById('ct-pins-row');
  if(prow)prow.style.display=FIXED_PINS.has(val)?'none':'block';
  while(draftConn.channels.length<draftConn.pins)draftConn.channels.push('');
  while(draftConn.colors.length<draftConn.pins)draftConn.colors.push('red');
  renderConnSVG(draftConn);renderChList(draftConn);checkWarn(draftConn);
}
function onCtGrid(){
  if(!draftConn)return;
  const cols=Math.max(1,Math.min(32,+document.getElementById('ct-cols').value||5));
  const rows=Math.max(1,Math.min(32,+document.getElementById('ct-rows').value||1));
  draftConn.cols=cols;draftConn.rows=rows;draftConn.pins=cols*rows;
  document.getElementById('ct-pins').value=draftConn.pins;
  while(draftConn.channels.length<draftConn.pins)draftConn.channels.push('');
  while(draftConn.colors.length<draftConn.pins)draftConn.colors.push('red');
  renderConnSVG(draftConn);renderChList(draftConn);
}
function onCtPins(v){
  if(!draftConn)return;
  draftConn.pins=Math.max(1,Math.min(64,v||1));
  while(draftConn.channels.length<draftConn.pins)draftConn.channels.push('');
  while(draftConn.colors.length<draftConn.pins)draftConn.colors.push('red');
  renderConnSVG(draftConn);renderChList(draftConn);
}
function onCtCname(v){if(draftConn)draftConn.customName=v;}
function onCtGender(val){
  const sc=scope();
  const conn=sc?.connectors.find(c=>c.id===activeConnId);
  if(!conn)return;
  if(draftConn)draftConn.gender=val;
  // Re-render SVG preview only (not saved yet)
  if(draftConn)renderConnSVG(draftConn);
}
function onCtName(v){if(draftConn)draftConn.name=v;}
function renderCcSel(conn){
  const sc=scope();if(!sc)return;
  const sysSel=document.getElementById('cc-sys');
  const connSel=document.getElementById('cc-conn');
  if(!sysSel||!connSel)return;
  // Populate systems (exclude own system)
  sysSel.innerHTML=sc.systems.filter(s=>s.id!==conn.systemId).map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
  if(!sysSel.innerHTML){sysSel.innerHTML='<option value="">No other systems</option>';}
  onCcSys();
}
function onCcSys(){
  const sc=scope();
  const conn=sc?.connectors.find(c=>c.id===activeConnId);
  const sysSel=document.getElementById('cc-sys');
  const connSel=document.getElementById('cc-conn');
  if(!sysSel||!connSel||!conn)return;
  const sysId=sysSel.value;
  // Show unconnected connectors on that system (excluding self)
  const wireCount={};
  sc.wires.forEach(w=>{wireCount[w.fromConn]=(wireCount[w.fromConn]||0)+1;wireCount[w.toConn]=(wireCount[w.toConn]||0)+1;});
  const avail=sc.connectors.filter(c=>c.systemId===sysId&&c.id!==conn.id&&(wireCount[c.id]||0)<1);
  connSel.innerHTML=avail.map(c=>`<option value="${c.id}">#${c.num} ${c.name||c.customName||c.type}</option>`).join('')||'<option value="">None available</option>';
}
function connectToExisting(){
  const sc=scope();
  const conn=sc?.connectors.find(c=>c.id===activeConnId);
  const connSel=document.getElementById('cc-conn');
  const msg=document.getElementById('cc-msg');
  if(!conn||!connSel?.value){if(msg){msg.textContent='Select a connector first.';msg.style.display='block';}return;}
  // Check already wired
  const existing=sc.wires.find(w=>(w.fromConn===conn.id||w.toConn===conn.id));
  if(existing){if(msg){msg.textContent='This connector already has a wire. Delete it first.';msg.style.display='block';}return;}
  sc.wires.push({id:'w'+Date.now(),fromConn:conn.id,toConn:connSel.value,length:null});
  save();
  if(msg){msg.textContent='Connected!';msg.style.color='#0d7a5f';msg.style.display='block';}
  renderConnPage();notify('Connected','ok');
  setTimeout(()=>{if(msg)msg.style.display='none';},2000);
}
function saveConn(){
  const sc=scope();
  const conn=sc?.connectors.find(c=>c.id===activeConnId);
  if(conn&&draftConn){
    // Commit all draft fields back to the real connector
    conn.type=draftConn.type;
    conn.customName=draftConn.customName;
    conn.name=draftConn.name;
    conn.gender=draftConn.gender;
    conn.pins=draftConn.pins;
    conn.cols=draftConn.cols;
    conn.rows=draftConn.rows;
    // Sync colors and channels, trimmed to pin count
    conn.colors=Array.from({length:conn.pins},(_,i)=>draftConn.colors[i]||'red');
    conn.channels=Array.from({length:conn.pins},(_,i)=>draftConn.channels[i]||'');
    // Auto-flip mated connector gender
    if(conn.gender){
      const wire=sc.wires.find(w=>w.fromConn===conn.id||w.toConn===conn.id);
      if(wire){
        const othId=wire.fromConn===conn.id?wire.toConn:wire.fromConn;
        const other=sc.connectors.find(c=>c.id===othId);
        if(other)other.gender=conn.gender==='male'?'female':'male';
      }
    }
  }
  draftConn=null;
  save();notify('Connector saved','ok');goPage('pg-canvas');
}

// ═══════════════════════════════════════════════════════
