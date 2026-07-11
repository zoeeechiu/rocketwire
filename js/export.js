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
    await loadFromCloud(); // load cloud projects
    startPolling(); // keep in sync
  } else if (ST.isLoggedIn) {
    applyLogin();
  }

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

  // Seed demo on first launch
  if (!ST.projects.length) {
    const demo = {
      id: 'p_demo', name: '2025-2026 Launch Vehicle', desc: 'Demo project',
      systems: [
        {id:'s1',name:'AV Bay',x:80,y:140,w:260,h:100,systems:[{id:'s1a',name:'FWD Board',x:40,y:80,w:240,h:100,systems:[],connectors:[],wires:[],splices:[]}],connectors:[],wires:[],splices:[]},
        {id:'s2',name:'Flight Computer',x:440,y:110,w:270,h:100,systems:[],connectors:[],wires:[],splices:[]},
        {id:'s3',name:'Power Board',x:440,y:300,w:260,h:100,systems:[],connectors:[],wires:[],splices:[]},
        {id:'s4',name:'Pyro Board',x:800,y:200,w:250,h:100,systems:[],connectors:[],wires:[],splices:[]},
      ],
      connectors: [
        {id:'c1',systemId:'s1',type:'Amphenol 9-35',customName:'',pins:6,channels:['15V','GND','SIG1','SIG2','PWR','RTN'],colors:['red','black','yellow','yellow','red','black'],num:1},
        {id:'c2',systemId:'s2',type:'Amphenol 9-35',customName:'',pins:6,channels:['15V','GND','SIG1','SIG2','PWR','RTN'],colors:['red','black','yellow','yellow','red','black'],num:2},
        {id:'c3',systemId:'s3',type:'XT60',customName:'',pins:2,channels:['V+','GND'],colors:['red','black'],num:3},
        {id:'c4',systemId:'s2',type:'XT60',customName:'',pins:2,channels:['V+','GND'],colors:['red','black'],num:4},
        {id:'c5',systemId:'s2',type:'Molex',customName:'',pins:4,channels:['Fire1','Fire2','ARM','GND'],colors:['orange','orange','yellow','black'],num:5},
        {id:'c6',systemId:'s4',type:'Molex',customName:'',pins:4,channels:['Fire1','Fire2','ARM','GND'],colors:['orange','orange','yellow','black'],num:6},
      ],
      wires: [
        {id:'w1',fromConn:'c1',toConn:'c2',length:18},
        {id:'w2',fromConn:'c3',toConn:'c4',length:12},
        {id:'w3',fromConn:'c5',toConn:'c6',length:24},
      ],
      splices: []
    };
    ST.projects.push(demo); save(); renderHome();
  }
}
boot();
