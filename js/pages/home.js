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
  navStack=[{label:p.name,systems:p.systems,connectors:p.connectors,wires:p.wires,splices:p.splices||[]}];
  goPage('pg-canvas');
}
async function createProj(){
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
  const n=document.getElementById('rp-name').value.trim();if(!n)return;
  const p=ST.projects.find(x=>x.id===renameProjId);
  if(p){p.name=n;save();renderHome();buildBC(currentPage);}
  closeM('m-rename');notify('Renamed','ok');
}

// ═══════════════════════════════════════════════════════
// CANVAS ENGINE
// ═══════════════════════════════════════════════════════
function initCanvas(){
  cv=document.getElementById('cvs');
  const area=cv.parentElement;
  cv.width=area.clientWidth;cv.height=area.clientHeight;
  ctx=cv.getContext('2d');
  cv.onmousedown=onMD;cv.onmousemove=onMM;cv.onmouseup=onMU;
  cv.onwheel=onWheel;cv.oncontextmenu=onCtx;cv.ondblclick=onDbl;
  fitView();
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
