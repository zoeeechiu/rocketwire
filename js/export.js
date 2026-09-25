function exportCSV(){
  const sc=scope();if(!sc)return;
  let csv='System,Connector #,Splice,Type,Pins,Pin,Channel,Color\n';
  sc.connectors.forEach(conn=>{
    const sys=conn.isSplice?null:sc.systems.find(s=>s.id===conn.systemId);
    conn.channels.slice(0,conn.pins).forEach((ch,i)=>{
      csv+=`"${sys?.name||'—'}",${conn.num},${conn.isSplice?'Yes':'No'},"${conn.customName||conn.type}",${conn.pins},${i+1},"${ch}","${conn.colors?.[i]||''}"\n`;
    });
  });
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download=(ST.projects.find(p=>p.id===activeProjId)?.name||'project').replace(/\s+/g,'_')+'_wiring.csv';
  a.click();notify('CSV exported','ok');
}
function exportPDF(){
  const sc=scope();if(!sc)return;
  const pname=ST.projects.find(p=>p.id===activeProjId)?.name||'Project';
  const rows=sc.connectors.map(conn=>{
    const sys=conn.isSplice?null:sc.systems.find(s=>s.id===conn.systemId);
    return conn.channels.slice(0,conn.pins).map((ch,i)=>
      `<tr><td>${sys?.name||'—'}</td><td>#${conn.num}</td><td>${conn.isSplice?'Splice':''}</td><td>${conn.customName||conn.type}</td><td>${i+1}</td><td>${ch}</td><td style="color:${WHX[conn.colors?.[i]]||'#c0392b'};font-weight:600">${conn.colors?.[i]||''}</td></tr>`
    ).join('');
  }).join('');
  const win=window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>${pname}</title><style>body{font-family:system-ui,sans-serif;padding:24px}h1{font-size:18px;margin-bottom:4px}p{font-size:12px;color:#aaa;margin-bottom:18px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #e2e5ea;padding:7px 10px;text-align:left}th{background:#f2f4f7;font-weight:600}</style></head><body><h1>${pname}</h1><p>Wiring report — ${new Date().toLocaleDateString()}</p><table><tr><th>System</th><th>Connector</th><th>Splice</th><th>Type</th><th>Pin</th><th>Channel</th><th>Color</th></tr>${rows}</table></body></html>`);
  win.print();notify('PDF ready','ok');
}

// ═══════════════════════════════════════════════════════
// RESIZE
// ═══════════════════════════════════════════════════════
window.addEventListener('resize',()=>{
  if(currentPage==='pg-canvas'&&cv){
    sizeCanvas();redraw();
  }
});

// ═══════════════════════════════════════════════════════
// DEMO PROJECT REMOVAL
// ═══════════════════════════════════════════════════════
// The old boot() seeded a demo project (id 'p_demo') on every browser that
// had never run RocketWire before. Deleting it on one device and pushing
// removed the cloud row, but:
//   1) each NEW device seeded a fresh copy locally on first launch, and
//   2) the next Push from any device uploaded its local copy again.
// Push re-uploads every local project, so a single device that still had
// the demo was enough to bring it back for everyone.
//
// Fix: never seed it (removed from boot below), and actively remove it,
// locally AND from the cloud, at boot and after every Sync / Push. The
// cleanup after Sync/Push covers teammates still running old cached code
// who push it back up once more. Only the exact id 'p_demo' is removed, so
// your real projects (including any Copy you made of the demo, which gets
// a new id) are never touched.
const DEMO_PROJECT_ID='p_demo';

async function purgeDemoProject(){
  const had=ST.projects.some(p=>p.id===DEMO_PROJECT_ID);
  if(had){
    ST.projects=ST.projects.filter(p=>p.id!==DEMO_PROJECT_ID);
    if(activeProjId===DEMO_PROJECT_ID){
      activeProjId=null;navStack=[];
      try{localStorage.removeItem('rw3_proj');}catch(e){}
      if(currentPage!=='pg-home')goPage('pg-home');
    }
    try{localStorage.setItem('rw3',JSON.stringify(ST));}catch(e){}
    if(currentPage==='pg-home')renderHome(document.getElementById('home-search')?.value||'');
  }
  // Delete the cloud row too; a no-op if it isn't there
  if(sbUser){
    try{await sb.from('projects').delete().eq('id',DEMO_PROJECT_ID);}
    catch(e){console.warn('Demo cloud cleanup failed:',e);}
  }
}

const _loadFromCloudKeepDemo=loadFromCloud;
loadFromCloud=async function(){
  const r=await _loadFromCloudKeepDemo.apply(this,arguments);
  await purgeDemoProject();
  return r;
};
const _pushChangesKeepDemo=pushChanges;
pushChanges=async function(){
  // Remove it BEFORE pushing so this device never uploads it…
  ST.projects=ST.projects.filter(p=>p.id!==DEMO_PROJECT_ID);
  const r=await _pushChangesKeepDemo.apply(this,arguments);
  // …and AFTER, because Push merges cloud rows back in (another device may
  // have just re-uploaded it) and then writes them all back up.
  await purgeDemoProject();
  return r;
};

// ═══════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════
async function boot() {
  load(); // load from localStorage first (instant)

  // Check if already signed in via Supabase session
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    sbUser = session.user;
    ST.isLoggedIn = true;
    applyLogin();
    // Keep the app stable: do not auto-pull remote state on every login.
    // Users explicitly push their final changes and can use Sync manually.
  } else if (ST.isLoggedIn) {
    applyLogin();
  }

  // Drop the old demo project, locally and from the cloud, before anything
  // below can reopen or render it.
  await purgeDemoProject();

  // Restore last page state — only reopen project if user was actually on canvas
  const savedPage = localStorage.getItem('rw3_page') || 'pg-home';
  if (savedPage === 'pg-canvas' && activeProjId && ST.projects.find(p => p.id === activeProjId)) {
    wireChVis = {};
    const p = ST.projects.find(x => x.id === activeProjId);
    navStack = [{ label: p.name, sysId: null, systems: p.systems, connectors: p.connectors, wires: p.wires, splices: p.splices || [] }];
    // Restore subsystem depth
    try {
      const savedNav = JSON.parse(localStorage.getItem('rw3_nav') || '[]');
      for (let i = 1; i < savedNav.length; i++) {
        const entry = savedNav[i];
        if (!entry.sysId) continue;
        const cur = navStack[navStack.length - 1];
        const sys = cur.systems ? cur.systems.find(s => s.id === entry.sysId) : null;
        if (sys) {
          navStack.push({
            label: sys.name, sysId: sys.id,
            systems: sys.systems, connectors: sys.connectors,
            wires: sys.wires, splices: sys.splices || [],
            parentSys: sys, parentScope: cur
          });
        }
      }
    } catch(e) {}
    goPage('pg-canvas');
  } else {
    goPage('pg-home');
  }
  renderHome();
  // (Demo project seeding removed: new devices now start with an empty
  // project list, or whatever Sync pulls from your account.)
}
boot();