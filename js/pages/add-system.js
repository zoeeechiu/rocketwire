// PAGE 4: ADD SYSTEM
// ═══════════════════════════════════════════════════════
function initAdd(){
  addMode=null;newConnTemp=null;
  document.getElementById('ns-name').value='';
  document.getElementById('ob-ex').classList.remove('on');
  document.getElementById('ob-new').classList.remove('on');
  document.getElementById('add-form').innerHTML='';
  updPrev();
}
function updPrev(){
  const name=document.getElementById('ns-name').value||'New system';
  document.getElementById('prev-name').textContent=name;
  document.getElementById('prev-dots').innerHTML=newConnTemp?'<div class="cdot"></div>':'';
}
function setAddMode(mode){
  addMode=mode;
  document.getElementById('ob-ex').classList.toggle('on',mode==='existing');
  document.getElementById('ob-new').classList.toggle('on',mode==='new');
  renderAddForm();
}
function renderAddForm(){
  const form=document.getElementById('add-form');form.innerHTML='';
  const sc=scope();if(!sc)return;

  if(addMode==='existing'){
    // A connector is available if it has fewer than 2 wire connections
    // (each connector can connect to at most one other connector)
    const wireCount={};
    sc.wires.forEach(w=>{
      wireCount[w.fromConn]=(wireCount[w.fromConn]||0)+1;
      wireCount[w.toConn]=(wireCount[w.toConn]||0)+1;
    });
    const avail=sc.connectors.filter(c=>(wireCount[c.id]||0)<1);
    if(!avail.length){
      form.innerHTML='<div class="no-conn">No available connectors — all are already connected. Add a new connector or splice an existing wire.</div>';return;
    }
    // Group: system connectors and splice connectors
    const sysList=[...new Set(avail.filter(c=>!c.isSplice).map(c=>c.systemId))];
    const sysOpts=sysList.map(sid=>{const s=sc.systems.find(x=>x.id===sid);return s?`<option value="sys:${sid}">${s.name}</option>`:''}).join('');
    const spliceOpts=avail.filter(c=>c.isSplice).map(c=>`<option value="splice:${c.id}">Splice #${c.num} ${connTypeLabel(c)}</option>`).join('');
    const groupOpts=(sysOpts?`<optgroup label="System connectors">${sysOpts}</optgroup>`:'')+
                    (spliceOpts?`<optgroup label="Splice connectors">${spliceOpts}</optgroup>`:'');
    form.innerHTML=`
      <span class="sl">Select source</span>
      <select class="sel" id="ex-src" onchange="refreshExConn()">${groupOpts}</select>
      <span class="sl">Select connector</span>
      <select class="sel" id="ex-conn"></select>
    `;
    refreshExConn();
  }
  if(addMode==='new'){
    newConnTemp={type:'Amphenol 9-35',pins:6,channels:Array(6).fill(''),colors:Array(6).fill('red')};
    form.innerHTML=`
      <span class="sl">Connector type</span>
      <select class="sel" id="nc-type" onchange="onNcType(this.value)">
        <option value="Amphenol 9-35">Amphenol 9-35 (6-pin)</option>
        <option value="Amphenol 13-pin">Amphenol 13-pin</option>
        <option value="DSUB-9">D-SUB 9</option>
        <option value="DSUB-15">D-SUB 15</option>
        <option value="DSUB-37">D-SUB 37</option>
        <option value="Molex">Molex</option>
        <option value="XT60">XT60</option>
        <option value="XT30">XT30</option>
        <option value="JST">JST</option>
        <option value="Custom">Custom…</option>
      </select>
      <div id="nc-cname-wrap" style="display:none;margin-top:6px"><input class="inp" id="nc-cname" autocomplete="off" readonly onfocus="this.removeAttribute('readonly')" placeholder="Custom type name"></div>
      <span class="sl">Gender</span><select class="sel" id="nc-gender"><option>Male</option><option>Female</option></select>
      <div id="nc-pins-row"><span class="sl">Pin count</span><input class="inp" id="nc-pins" type="number" value="6" min="1" max="64" onchange="onNcPins(+this.value)"></div>
      <div id="nc-grid-row" style="display:none">
        <span class="sl">Columns</span>
        <input class="inp" id="nc-cols" type="number" min="1" max="32" value="5" onchange="onNcGrid()">
        <span class="sl">Rows</span>
        <input class="inp" id="nc-rows" type="number" min="1" max="32" value="1" onchange="onNcGrid()">
        <div style="font-size:10px;color:#aaa;margin-top:4px">Pin count = rows × columns</div>
      </div>
      <span class="sl">Channel names</span>
      <div id="nc-ch"></div>
    `;
    onNcType(newConnTemp.type);
  }
}
function refreshExConn(){
  const sc=scope();
  const wireCount={};
  sc.wires.forEach(w=>{wireCount[w.fromConn]=(wireCount[w.fromConn]||0)+1;wireCount[w.toConn]=(wireCount[w.toConn]||0)+1;});
  const src=document.getElementById('ex-src')?.value||'';
  let avail=[];
  if(src.startsWith('sys:')){
    const sid=src.slice(4);avail=sc.connectors.filter(c=>!c.isSplice&&c.systemId===sid&&(wireCount[c.id]||0)<1);
  } else if(src.startsWith('splice:')){
    const cid=src.slice(7);avail=sc.connectors.filter(c=>c.id===cid&&(wireCount[c.id]||0)<1);
  }
  const sel=document.getElementById('ex-conn');
  if(sel)sel.innerHTML=avail.map(c=>`<option value="${c.id}">#${c.num} ${connTypeLabel(c)}</option>`).join('');
}
function onNcType(val){
  if(!newConnTemp)return;newConnTemp.type=val;
  if(AUTO_PINS[val]!==undefined){newConnTemp.pins=AUTO_PINS[val];const e=document.getElementById('nc-pins');if(e)e.value=newConnTemp.pins;}
  document.getElementById('nc-cname-wrap').style.display=val==='Custom'?'block':'none';
  // Molex/JST/Custom use a rows×cols grid instead of a flat pin count
  const isGrid2=['Molex','JST','Custom'].includes(val);
  const pr=document.getElementById('nc-pins-row');if(pr)pr.style.display=FIXED_PINS.has(val)?'none':(isGrid2?'none':'block');
  const gr=document.getElementById('nc-grid-row');if(gr)gr.style.display=isGrid2?'block':'none';
  if(isGrid2){
    newConnTemp.cols=newConnTemp.cols||5;
    newConnTemp.rows=newConnTemp.rows||1;
    newConnTemp.pins=newConnTemp.cols*newConnTemp.rows;
    const ci=document.getElementById('nc-cols');const ri=document.getElementById('nc-rows');
    if(ci)ci.value=newConnTemp.cols;if(ri)ri.value=newConnTemp.rows;
    const pe=document.getElementById('nc-pins');if(pe)pe.value=newConnTemp.pins;
  }
  while(newConnTemp.channels.length<newConnTemp.pins)newConnTemp.channels.push('');
  while(newConnTemp.colors.length<newConnTemp.pins)newConnTemp.colors.push('red');
  renderNcCh();updPrev();
}
function onNcPins(v){if(!newConnTemp)return;newConnTemp.pins=Math.max(1,Math.min(64,v));renderNcCh();}
function onNcGrid(){
  if(!newConnTemp)return;
  const cols=Math.max(1,Math.min(32,+document.getElementById('nc-cols').value||5));
  const rows=Math.max(1,Math.min(32,+document.getElementById('nc-rows').value||1));
  newConnTemp.cols=cols;newConnTemp.rows=rows;newConnTemp.pins=cols*rows;
  const pe=document.getElementById('nc-pins');if(pe)pe.value=newConnTemp.pins;
  while(newConnTemp.channels.length<newConnTemp.pins)newConnTemp.channels.push('');
  while(newConnTemp.colors.length<newConnTemp.pins)newConnTemp.colors.push('red');
  renderNcCh();updPrev();
}
function renderNcCh(){
  const box=document.getElementById('nc-ch');if(!box||!newConnTemp)return;box.innerHTML='';
  Array.from({length:Math.min(newConnTemp.pins,24)},(_,i)=>{
    const row=document.createElement('div');row.className='chmini';
    row.innerHTML=`<span class="pb">${i+1}</span><input autocomplete="off" readonly onfocus="this.removeAttribute('readonly')" placeholder="e.g. GND" value="${newConnTemp.channels[i]||''}"><select>${WC.map(c=>`<option value="${c}"${newConnTemp.colors[i]===c?' selected':''}>${c}</option>`).join('')}</select>`;
    row.querySelector('input').onchange=e=>{newConnTemp.channels[i]=e.target.value;};
    row.querySelector('select').onchange=e=>{newConnTemp.colors[i]=e.target.value;};
    box.appendChild(row);
  });
}
function commitAdd(){
  if(!ST.isLoggedIn){reqAuth(commitAdd);return;}
  const name=document.getElementById('ns-name').value.trim();
  if(!name){notify('Enter a system name','err');return;}
  const sc=scope();
  // Place new system spaced out
  let x=100+(sc.systems.length%4)*200,y=100+Math.floor(sc.systems.length/4)*160;
  const sysId='s'+Date.now();
  const newSys={id:sysId,name,x,y,w:Math.max(140,name.length*8+20),h:60,systems:[],connectors:[],wires:[],splices:[]};
  sc.systems.push(newSys);

  if(addMode==='new'&&newConnTemp){
    const pins=+document.getElementById('nc-pins')?.value||newConnTemp.pins;
    const type=document.getElementById('nc-type')?.value||newConnTemp.type;
    const cname=document.getElementById('nc-cname')?.value||'';
    const channels=Array.from({length:Math.min(pins,24)},(_,i)=>{
      const inp=document.querySelector(`#nc-ch .chmini:nth-child(${i+1}) input`);
      return inp?inp.value:(newConnTemp.channels[i]||'');
    });
    const colors=Array.from({length:Math.min(pins,24)},(_,i)=>{
      const sel=document.querySelector(`#nc-ch .chmini:nth-child(${i+1}) select`);
      return sel?sel.value:(newConnTemp.colors[i]||'red');
    });
    const num=sc.connectors.length+1;
    const gender=(document.getElementById('nc-gender')?.value||'Male').toLowerCase();
    const newConn={id:'c'+Date.now(),systemId:sysId,type,customName:cname,pins,channels,colors,gender,num};
    if(['Molex','JST','Custom'].includes(type)){newConn.cols=newConnTemp.cols||5;newConn.rows=newConnTemp.rows||1;}
    sc.connectors.push(newConn);
    notify('System + connector added','ok');
  } else if(addMode==='existing'){
    const existId=document.getElementById('ex-conn')?.value;
    if(!existId){notify('Select a connector','err');return;}
    const ex=sc.connectors.find(c=>c.id===existId);
    const num=sc.connectors.length+1;
    const ncid='c'+Date.now();
    // Mating connector gets the opposite gender, matching how connecting two
    // connectors elsewhere in the app auto-flips gender for the mated pair
    const gender=ex?.gender?(ex.gender==='male'?'female':'male'):'male';
    const newConn={id:ncid,systemId:sysId,type:ex?.type||'Amphenol 9-35',customName:ex?.customName||'',pins:ex?.pins||6,channels:[...(ex?.channels||[])],colors:[...(ex?.colors||[])],gender,num};
    if(ex?.cols){newConn.cols=ex.cols;}
    if(ex?.rows){newConn.rows=ex.rows;}
    sc.connectors.push(newConn);
    sc.wires.push({id:'w'+Date.now(),fromConn:existId,toConn:ncid,length:null});
    notify('System connected','ok');
  } else {
    notify('System added','ok');
  }
  // Push apart if overlapping
  pushBoxes(newSys);
  save();goPage('pg-canvas');
}

// ═══════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════
