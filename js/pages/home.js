// PAGE 1: HOME
// ═══════════════════════════════════════════════════════
function renderHome(filter=''){
  const grid=document.getElementById('pgrid');grid.innerHTML='';
  ST.projects.filter(p=>p.name.toLowerCase().includes(filter.toLowerCase())).forEach(p=>{
    const c=document.createElement('div');c.className='pcard';
    c.innerHTML=`<div class="pfolder">📁</div><div class="pname">${p.name}</div><div class="pmeta">${p.desc||'No description'}</div>`;
    c.onclick=()=>openProj(p.id);
    const kb=document.createElement('button');kb.className='pkb';kb.textContent='⋮';
    kb.onclick=e=>{e.stopPropagation();showProjMenu(e.clientX,e.clientY,p.id);};
    c.appendChild(kb);grid.appendChild(c);
  });
  const add=document.createElement('div');add.className='addcard';
  add.innerHTML='<div style="font-size:24px">+</div><div>New project</div>';
  add.onclick=()=>reqAuth(()=>openM('m-newproj'));
  grid.appendChild(add);
}
function openProj(id){
  activeProjId=id;wireChVis={};
  const p=ST.projects.find(x=>x.id===id);
  navStack=[{label:p.name,sysId:null,systems:p.systems,connectors:p.connectors,wires:p.wires,splices:p.splices||[]}];
  goPage('pg-canvas');
}
async function createProj(){
  if(!ST.isLoggedIn){reqAuth(createProj);return;}
  const name=document.getElementById('np-name').value.trim();
  if(!name){notify('Enter a project name','err');return;}
  const p={id:'p'+Date.now(),name,desc:document.getElementById('np-desc').value.trim(),
    systems:[],connectors:[],wires:[],splices:[]};
  ST.projects.push(p);
  // Save locally first
  try{localStorage.setItem('rw3',JSON.stringify(ST));}catch(e){}
  closeM('m-newproj');
  document.getElementById('np-name').value='';document.getElementById('np-desc').value='';
  renderHome();
  // Then save to cloud immediately and wait for it
  await saveToCloud();
  notify('Project created','ok');
}
function showProjMenu(x,y,id){
  const p=ST.projects.find(x=>x.id===id);
  showCtx(x,y,[
    {label:'Open',icon:'📂',fn:()=>openProj(id)},
    {label:'Rename',icon:'✏️',fn:()=>reqAuth(()=>{renameProjId=id;document.getElementById('rp-name').value=p.name;openM('m-rename');})},
    {label:'Copy',icon:'📄',fn:()=>reqAuth(()=>openCopyProj(id))},
    {divider:true},
    {label:'Delete project',icon:'🗑',danger:true,fn:()=>reqAuth(async()=>{
      if(!confirm(`Delete "${p.name}"?`))return;
      ST.projects=ST.projects.filter(x=>x.id!==id);
      try{localStorage.setItem('rw3',JSON.stringify(ST));}catch(e){}
      renderHome();notify('Deleted');
      // Delete from Supabase so it disappears for all users
      if(sbUser){
        try{await sb.from('projects').delete().eq('id',id);}catch(e){console.warn('Cloud delete failed:',e);}
      }
    })}
  ]);
}
function doRename(){
  if(!ST.isLoggedIn){reqAuth(doRename);return;}
  const n=document.getElementById('rp-name').value.trim();if(!n)return;
  const p=ST.projects.find(x=>x.id===renameProjId);
  if(p){p.name=n;save();renderHome();buildBC(currentPage);}
  closeM('m-rename');notify('Renamed','ok');
}

// ─── COPY PROJECT ──────────────────────────────────────
let copyProjId=null;

// "Copy of X", or "Copy of X (2)", "(3)"… if that name is already taken.
function uniqueCopyName(name){
  const taken=new Set(ST.projects.map(p=>p.name));
  const base=`Copy of ${name}`;
  if(!taken.has(base))return base;
  let i=2;while(taken.has(`${base} (${i})`))i++;
  return `${base} (${i})`;
}

function openCopyProj(id){
  const p=ST.projects.find(x=>x.id===id);if(!p)return;
  copyProjId=id;
  const nameEl=document.getElementById('cp-name');
  nameEl.value=uniqueCopyName(p.name);
  document.getElementById('cp-desc').value=p.desc||'';
  document.getElementById('cp-sub').textContent=`Duplicate everything in "${p.name}" into a new project.`;
  openM('m-copyproj');
  // Focus + select so the user can type a new name straight away
  // (focusing also clears the readonly anti-autofill attribute).
  setTimeout(()=>{nameEl.focus();nameEl.select();},0);
}

async function doCopyProj(){
  if(!ST.isLoggedIn){reqAuth(doCopyProj);return;}
  const src=ST.projects.find(x=>x.id===copyProjId);
  if(!src){closeM('m-copyproj');notify('Original project not found','err');return;}
  const name=document.getElementById('cp-name').value.trim();
  if(!name){notify('Enter a project name','err');return;}

  // Deep clone so the copy shares no object references with the original —
  // editing one must never mutate the other.
  const clone=JSON.parse(JSON.stringify(src));

  // Drop anything the original had tombstoned, then start the copy with a
  // clean deletion history (it's a brand-new project).
  const delSet=new Set((clone.deletedIds||[]).map(d=>d.id));
  if(delSet.size)pruneDeletedTree(clone,delSet);
  clone.deletedIds=[];
  delete clone.__remoteUpdatedAt;

  // New project identity. Inner system/connector/wire/splice ids are kept
  // as-is: they are only referenced within the same project, so keeping
  // them preserves every wire→connector and splice link without remapping.
  clone.id='p'+Date.now();
  clone.name=name;
  clone.desc=document.getElementById('cp-desc').value.trim();
  touchProjectTree(clone);

  ST.projects.push(clone);
  try{localStorage.setItem('rw3',JSON.stringify(ST));}catch(e){}
  closeM('m-copyproj');
  copyProjId=null;
  renderHome();
  await saveToCloud();
  notify('Project copied','ok');
}

// ═══════════════════════════════════════════════════════
// CANVAS ENGINE
// ═══════════════════════════════════════════════════════
function initCanvas(){
  cv=document.getElementById('cvs');
  sizeCanvas();
  cv.onmousedown=onMD;cv.onmousemove=onMM;cv.onmouseup=onMU;
  cv.onwheel=onWheel;cv.oncontextmenu=onCtx;cv.ondblclick=onDbl;
  fitView();
}
// Size the canvas backing store to the device's actual pixel density so
// strokes/text/curves render crisp (not blurry) at any zoom level, while
// all drawing code keeps working in CSS-pixel coordinates as before.
//
// IMPORTANT: <canvas> is a replaced element, so `position:absolute;inset:0`
// does NOT stretch it to fill its container the way it would a <div> —
// it falls back to its intrinsic size (the width/height attributes). So we
// must explicitly pin the displayed CSS size with style.width/height,
// separately from the (larger) backing-store resolution used for crispness.
function sizeCanvas(){
  if(!cv)return;
  const area=cv.parentElement;
  const dpr=window.devicePixelRatio||1;
  const cssW=area.clientWidth,cssH=area.clientHeight;
  cv.style.width=cssW+'px';
  cv.style.height=cssH+'px';
  cv.width=Math.round(cssW*dpr);
  cv.height=Math.round(cssH*dpr);
  ctx=cv.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
function w2s(wx,wy){return{x:wx*cam.scale+cam.x,y:wy*cam.scale+cam.y};}
function s2w(sx,sy){return{x:(sx-cam.x)/cam.scale,y:(sy-cam.y)/cam.scale};}
function updateZL(){const l=document.getElementById('zlbl');if(l)l.textContent=Math.round(cam.scale*100)+'%';}
function zoomBy(f){cam.scale=Math.min(3,Math.max(.1,cam.scale*f));updateZL();redraw();}
function fitView(){
  const sc=scope();
  const hint=document.getElementById('empty-hint');
  if(!sc||!sc.systems.length){cam={x:80,y:80,scale:1};updateZL();if(hint)hint.style.display='flex';redraw();return;}
  if(hint)hint.style.display='none';
  let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
  sc.systems.forEach(s=>{minX=Math.min(minX,s.x);minY=Math.min(minY,s.y);maxX=Math.max(maxX,s.x+s.w);maxY=Math.max(maxY,s.y+s.h);});
  const pad=80,cw=cv?cv.clientWidth:600,ch=cv?cv.clientHeight:400;
  const sx=(cw-pad*2)/Math.max(maxX-minX,1),sy=(ch-pad*2)/Math.max(maxY-minY,1);
  cam.scale=Math.min(sx,sy,1.4);
  cam.x=(cw-(maxX+minX)*cam.scale)/2;cam.y=(ch-(maxY+minY)*cam.scale)/2;
  updateZL();redraw();
}