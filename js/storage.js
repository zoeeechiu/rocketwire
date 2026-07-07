function save(){
  try{
    localStorage.setItem('rw3',JSON.stringify(ST));
    if(activeProjId)localStorage.setItem('rw3_proj',activeProjId);
  }catch(e){}
}
function load(){
  try{
    const d=JSON.parse(localStorage.getItem('rw3')||'null');
    if(d){ST.isLoggedIn=!!d.isLoggedIn;ST.projects=d.projects||[];}
    const savedProjId=localStorage.getItem('rw3_proj');
    if(savedProjId&&ST.projects.find(p=>p.id===savedProjId)){
      activeProjId=savedProjId;
    }
  }catch(e){}
}

// Current scope (top of nav for the canvas)
function scope(){return navStack[navStack.length-1]||null;}

// ═══════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════
let currentPage='pg-home';
function goPage(id){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  currentPage=id;
  buildBC(id);
  if(id==='pg-canvas'){setTimeout(initCanvas,30);}
  if(id==='pg-conn'){renderConnPage();}
  if(id==='pg-add'){initAdd();}
  if(id==='pg-splice'){initSplicePage();}
}

function buildBC(pageId){
  const bc=document.getElementById('bc'); bc.innerHTML='';
  if(pageId==='pg-home')return;
  const p=ST.projects.find(x=>x.id===activeProjId);

  function btn(label,isCur,fn){
    const b=document.createElement('button');
    b.className='bc-btn'+(isCur?' cur':'');
    b.textContent=label;
    if(!isCur&&fn)b.onclick=fn;
    return b;
  }
  const sep=()=>{const s=document.createElement('span');s.className='bc-sep';s.textContent='›';return s;};

  bc.appendChild(btn('Home',false,()=>{navStack=[];goPage('pg-home');}));

  if(p){
    bc.appendChild(sep());
    // Build breadcrumb from navStack
    if(pageId==='pg-canvas'){
      navStack.forEach((sc,i)=>{
        if(i>0)bc.appendChild(sep());
        const isCur=(i===navStack.length-1);
        bc.appendChild(btn(sc.label,isCur,isCur?null:()=>{
          navStack=navStack.slice(0,i+1);
          goPage('pg-canvas');
        }));
      });
    } else {
      navStack.forEach((sc,i)=>{
        bc.appendChild(sep());
        bc.appendChild(btn(sc.label,false,()=>{navStack=navStack.slice(0,i+1);goPage('pg-canvas');}));
      });
      bc.appendChild(sep());
      const labels={'pg-conn':'Connector','pg-add':'Add system','pg-splice':'Splice'};
      bc.appendChild(btn(labels[pageId]||pageId,true,null));
    }
  }
}

function goAdd(){
  goPage('pg-add');
}

// ═══════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════
function doLogin(){
  const u=document.getElementById('l-user').value.trim();
  const p=document.getElementById('l-pass').value;
  if(u===CREDS.user&&p===CREDS.pass){
    ST.isLoggedIn=true;save();applyLogin();
    closeM('m-login');notify('Logged in','ok');
    if(authCb){authCb();authCb=null;}
  }else{document.getElementById('l-err').style.display='block';}
}
function applyLogin(){
  document.getElementById('area-login').style.display='none';
  const ua=document.getElementById('area-user');ua.style.display='flex';ua.style.alignItems='center';
  document.getElementById('udisp').textContent=CREDS.user;
}
function doLogout(){ST.isLoggedIn=false;save();document.getElementById('area-login').style.display='flex';document.getElementById('area-user').style.display='none';notify('Logged out');}
function reqAuth(fn){if(ST.isLoggedIn){fn();return;}authCb=fn;openM('m-login');}

// ═══════════════════════════════════════════════════════
// MODAL / NOTIF / CTX
// ═══════════════════════════════════════════════════════
function openM(id){document.getElementById(id).style.display='flex';}
function closeM(id){document.getElementById(id).style.display='none';}
let _nt;
function notify(msg,type=''){const n=document.getElementById('notif');n.textContent=msg;n.className='notif show'+(type?' '+type:'');clearTimeout(_nt);_nt=setTimeout(()=>n.classList.remove('show'),2800);}
function showCtx(x,y,items){
  const m=document.getElementById('ctx');m.innerHTML='';
  items.forEach(it=>{
    if(it.header){const d=document.createElement('div');d.className='cx-hdr';d.textContent=it.header;m.appendChild(d);return;}
    if(it.divider){const d=document.createElement('div');d.className='cx-div';m.appendChild(d);return;}
    if(it.prop!==undefined){
      const d=document.createElement('div');d.className='cx-prop';
      const l=document.createElement('span');l.className='cx-pl';l.textContent=it.prop;
      const v=document.createElement('span');v.className='cx-pv';v.textContent=it.val||'—';
      if(it.editFn){const e=document.createElement('span');e.className='cx-ed';e.textContent='✏️';e.onclick=()=>{hideCtx();it.editFn();};v.appendChild(e);}
      d.appendChild(l);d.appendChild(v);m.appendChild(d);return;
    }
    const d=document.createElement('div');d.className='cx-it'+(it.danger?' danger':'');
    d.innerHTML=`<span class="cx-ico">${it.icon||''}</span>${it.label}`;
    d.onclick=()=>{hideCtx();it.fn();};m.appendChild(d);
  });
  m.style.display='block';
  const mw=190,mh=m.scrollHeight;
  m.style.left=Math.min(x,window.innerWidth-mw-8)+'px';
  m.style.top=Math.min(y,window.innerHeight-mh-8)+'px';
}
function hideCtx(){document.getElementById('ctx').style.display='none';}
document.addEventListener('click',e=>{if(!document.getElementById('ctx').contains(e.target))hideCtx();});

// ═══════════════════════════════════════════════════════
