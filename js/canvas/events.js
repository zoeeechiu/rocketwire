// ── COLLISION PUSH ──
function pushBoxes(movedSys){
  const sc=scope();if(!sc)return;
  const maxIter=10;
  for(let iter=0;iter<maxIter;iter++){
    let pushed=false;
    sc.systems.forEach(other=>{
      if(other.id===movedSys.id)return;
      const overlap=boxOverlap(movedSys,other);
      if(overlap){
        pushApart(movedSys,other,overlap);
        pushed=true;
      }
    });
    if(!pushed)break;
  }
  // Clamp to positive coords
  // No boundary clamping — systems can be placed anywhere on infinite canvas
}
function boxOverlap(a,b){
  const aPad=PAD/2,bPad=PAD/2;
  const ax1=a.x-aPad,ay1=a.y-aPad,ax2=a.x+a.w+aPad,ay2=a.y+a.h+aPad;
  const bx1=b.x-bPad,by1=b.y-bPad,bx2=b.x+b.w+bPad,by2=b.y+b.h+bPad;
  if(ax1>=bx2||bx1>=ax2||ay1>=by2||by1>=ay2)return null;
  const ox=Math.min(ax2-bx1,bx2-ax1),oy=Math.min(ay2-by1,by2-ay1);
  return{ox,oy};
}
function pushApart(moved,other,ov){
  if(ov.ox<ov.oy){
    const sign=(moved.x+moved.w/2>other.x+other.w/2)?1:-1;
    other.x-=sign*(ov.ox/2+1);
    moved.x+=sign*(ov.ox/2+1);
  }else{
    const sign=(moved.y+moved.h/2>other.y+other.h/2)?1:-1;
    other.y-=sign*(ov.oy/2+1);
    moved.y+=sign*(ov.oy/2+1);
  }
}

// ── HIT TESTING ──
function hitConn(wx,wy){
  const sc=scope();if(!sc)return null;
  const thresh=10/cam.scale;
  for(const c of sc.connectors){
    const ep=connEdgePos(c);
    if(Math.hypot(wx-ep.x,wy-ep.y)<thresh)return c;
  }return null;
}
function hitSys(wx,wy){
  const sc=scope();if(!sc)return null;
  return sc.systems.find(s=>wx>=s.x&&wx<=s.x+s.w&&wy>=s.y&&wy<=s.y+s.h)||null;
}
function hitWire(wx,wy){
  const sc=scope();if(!sc)return null;
  const thresh=7/cam.scale;
  for(const wire of sc.wires){
    const cA=sc.connectors.find(c=>c.id===wire.fromConn);
    const cB=sc.connectors.find(c=>c.id===wire.toConn);
    if(!cA||!cB)continue;
    const eA=connEdgePos(cA),eB=connEdgePos(cB);
    const {c1,c2}=bezierCPs(eA.x,eA.y,eA.edge,eB.x,eB.y,eB.edge,wire,1);
    for(let t=0;t<=1;t+=0.03){
      const bx=bpt(eA.x,c1.x,c2.x,eB.x,t),by=bpt(eA.y,c1.y,c2.y,eB.y,t);
      if(Math.hypot(wx-bx,wy-by)<thresh)return wire;
    }
  }return null;
}
function ptSegDist(px,py,x1,y1,x2,y2){
  const dx=x2-x1,dy=y2-y1;const len2=dx*dx+dy*dy;
  if(len2===0)return Math.hypot(px-x1,py-y1);
  let t=((px-x1)*dx+(py-y1)*dy)/len2;t=Math.max(0,Math.min(1,t));
  return Math.hypot(px-x1-t*dx,py-y1-t*dy);
}

// ── CANVAS EVENTS ──
function onMD(e){
  hideCtx();
  const r=cv.getBoundingClientRect();
  const sx=e.clientX-r.left,sy=e.clientY-r.top;
  const w=s2w(sx,sy);
  if(e.button===1||(e.button===0&&e.altKey)){panSt={on:true,sx,sy,cx:cam.x,cy:cam.y};cv.style.cursor='grabbing';return;}
  if(e.button===0){
    const conn=hitConn(w.x,w.y);
    if(conn&&conn.isSplice&&!conn.systemId){
      if(!ST.isLoggedIn){reqAuth(()=>{});return;}
      drag={on:true,target:conn,isSplice:true,isWire:false,ox:w.x-(conn.x||0),oy:w.y-(conn.y||0)};
      cv.style.cursor='grabbing';
    } else if(conn&&conn.systemId){
      if(!ST.isLoggedIn){reqAuth(()=>{});return;}
      // Drag any system connector dot — pins it to closest edge and slides along it
      if(!conn._pinnedEdge){
        // Auto-pin to current edge on first drag
        const sc2=scope();
        const sys2=sc2?.systems.find(s=>s.id===conn.systemId);
        if(sys2)conn._pinnedEdge=bestEdgeForConn(conn,sys2,sc2)||'right';
      }
      drag={on:true,target:conn,isSplice:false,isWire:false,isConnDot:true,ox:w.x,oy:w.y};
      cv.style.cursor='grabbing';
    } else if(!conn){
      // Check if clicking near wire midpoint for dragging
      const sc2=scope();
      let hitW=null;
      if(sc2){
        for(const wire of sc2.wires){
          const cA2=sc2.connectors.find(c=>c.id===wire.fromConn);
          const cB2=sc2.connectors.find(c=>c.id===wire.toConn);
          if(!cA2||!cB2)continue;
          const eA2=connEdgePos(cA2),eB2=connEdgePos(cB2);
          const {c1:cc1,c2:cc2}=bezierCPs(eA2.x,eA2.y,eA2.edge,eB2.x,eB2.y,eB2.edge,wire,1);
          const mx=bpt(eA2.x,cc1.x,cc2.x,eB2.x,0.5),my=bpt(eA2.y,cc1.y,cc2.y,eB2.y,0.5);
          if(Math.hypot(w.x-mx,w.y-my)<12/cam.scale){hitW=wire;break;}
        }
      }
      if(hitW){
        if(!ST.isLoggedIn){reqAuth(()=>{});return;}
        drag={on:true,target:hitW,isSplice:false,isWire:true,ox:w.x,oy:w.y,
          startCpOx:hitW.cpOx||0,startCpOy:hitW.cpOy||0};
        cv.style.cursor='grabbing';
      } else {
        const sys=hitSys(w.x,w.y);
        if(sys){
          if(!ST.isLoggedIn){reqAuth(()=>{});return;}
          drag={on:true,target:sys,isSplice:false,isWire:false,ox:w.x-sys.x,oy:w.y-sys.y};cv.style.cursor='grabbing';
        }
      }
    }
  }
}
function onMM(e){
  const r=cv.getBoundingClientRect();
  const sx=e.clientX-r.left,sy=e.clientY-r.top;
  if(panSt.on){cam.x=panSt.cx+(sx-panSt.sx);cam.y=panSt.cy+(sy-panSt.sy);redraw();return;}
  if(drag.on&&drag.target){
    const w=s2w(sx,sy);
    if(drag.isSplice){
      drag.target.x=w.x-drag.ox;
      drag.target.y=w.y-drag.oy;
    } else if(drag.isConnDot){
      // Snap to nearest edge midpoint as user drags
      const conn2=drag.target;
      const sys2=scope()?.systems.find(s=>s.id===conn2.systemId);
      if(sys2){
        // Find which of the 4 edge midpoints is closest to the mouse
        const edgeMids=[
          {edge:'right',  x:sys2.x+sys2.w,     y:sys2.y+sys2.h/2},
          {edge:'left',   x:sys2.x,             y:sys2.y+sys2.h/2},
          {edge:'top',    x:sys2.x+sys2.w/2,    y:sys2.y},
          {edge:'bottom', x:sys2.x+sys2.w/2,    y:sys2.y+sys2.h},
        ];
        let nearest=edgeMids[0], nearestD=Infinity;
        edgeMids.forEach(em=>{
          const d=Math.hypot(w.x-em.x,w.y-em.y);
          if(d<nearestD){nearestD=d;nearest=em;}
        });
        // Snap to that edge center
        conn2._pinnedEdge=nearest.edge;
        conn2._edge=nearest.edge;
        conn2._edgeT=undefined; // always centered on the edge
      }
    } else if(drag.isWire){
      const dx=w.x-drag.ox, dy=w.y-drag.oy;
      drag.target.cpOx=(drag.startCpOx||0)+dx;
      drag.target.cpOy=(drag.startCpOy||0)+dy;
    } else {
      // Drag system box
      drag.target.x=w.x-drag.ox;drag.target.y=w.y-drag.oy;
      pushBoxes(drag.target);
    }
    redraw();
  }
}
function onMU(){if(drag.on||panSt.on)save();drag={on:false};panSt={on:false};cv.style.cursor='default';}
function onWheel(e){
  e.preventDefault();
  const r=cv.getBoundingClientRect();
  const mx=e.clientX-r.left,my=e.clientY-r.top;
  const w0=s2w(mx,my);
  cam.scale=Math.min(3,Math.max(.1,cam.scale*(e.deltaY<0?1.1:.91)));
  const w1=s2w(mx,my);
  cam.x+=(w1.x-w0.x)*cam.scale;cam.y+=(w1.y-w0.y)*cam.scale;
  updateZL();redraw();
}
function onDbl(e){
  const r=cv.getBoundingClientRect();
  const w=s2w(e.clientX-r.left,e.clientY-r.top);
  const conn=hitConn(w.x,w.y);
  if(conn){activeConnId=conn.id;goPage('pg-conn');return;}
  // Double-click wire midpoint to reset its shape
  const sc2=scope();
  if(sc2){
    for(const wire of sc2.wires){
      const cA2=sc2.connectors.find(c=>c.id===wire.fromConn);
      const cB2=sc2.connectors.find(c=>c.id===wire.toConn);
      if(!cA2||!cB2)continue;
      const eA2=connEdgePos(cA2),eB2=connEdgePos(cB2);
      const {c1:cc1,c2:cc2}=bezierCPs(eA2.x,eA2.y,eA2.edge,eB2.x,eB2.y,eB2.edge,wire,1);
      const mx=bpt(eA2.x,cc1.x,cc2.x,eB2.x,0.5),my=bpt(eA2.y,cc1.y,cc2.y,eB2.y,0.5);
      if(Math.hypot(w.x-mx,w.y-my)<12/cam.scale){reqAuth(()=>{wire.cpOx=0;wire.cpOy=0;save();redraw();});return;}
    }
  }
  const sys=hitSys(w.x,w.y);
  if(sys){enterSubsystem(sys);}
}
function enterSubsystem(sys){
  // Ensure sys has sub-scope arrays
  if(!sys.systems)sys.systems=[];
  if(!sys.connectors)sys.connectors=[];
  if(!sys.wires)sys.wires=[];
  if(!sys.splices)sys.splices=[];
  const sc=scope();
  // Merge: subsystem scope connectors may include pass-through connectors from parent
  navStack.push({
    label:sys.name,
    sysId:sys.id,
    systems:sys.systems,
    connectors:sys.connectors,
    wires:sys.wires,
    splices:sys.splices||[],
    parentSys:sys,
    parentScope:sc
  });
  save();goPage('pg-canvas');
}
function renameSystem(sys){
  const name=prompt('System name:',sys.name);
  if(name===null)return; // cancelled
  const trimmed=name.trim();
  if(!trimmed){notify('Name cannot be empty','err');return;}
  sys.name=trimmed;
  // Keep the box wide enough for the new label (same sizing rule used on creation)
  sys.w=Math.max(140,trimmed.length*8+20);
  // If we're currently inside this system's subsystem view, refresh the
  // breadcrumb entry so it doesn't show the stale name
  const liveEntry=navStack.find(n=>n.parentSys===sys);
  if(liveEntry)liveEntry.label=trimmed;
  save();redraw();buildBC(currentPage);notify('System renamed','ok');
}
function onCtx(e){
  e.preventDefault();
  const r=cv.getBoundingClientRect();
  const w=s2w(e.clientX-r.left,e.clientY-r.top);
  const sc=scope();if(!sc)return;
  const conn=hitConn(w.x,w.y);
  const wire=!conn&&hitWire(w.x,w.y);
  const sys=!conn&&!wire&&hitSys(w.x,w.y);

  if(conn){
    const items=[
      {header:(conn.isSplice?'Splice ':'Connector ')+'#'+conn.num+' · '+(conn.name||conn.customName||conn.type)},
      {label:'View / edit',icon:'🔌',fn:()=>{activeConnId=conn.id;goPage('pg-conn');}},
    ];
    if(conn.isSplice){
      items.push({label:'Edit splice',icon:'✂️',fn:()=>reqAuth(()=>editSplice(conn))});
    } else {
      items.push({label:'Convert to splice',icon:'✂️',fn:()=>reqAuth(()=>openSplicePage(null,0,0,true,conn.id))});
    }
    // Allow user to pin the connector to a specific edge
    const curEdge=conn._pinnedEdge||conn._edge||'auto';
    items.push({divider:true});
    items.push({header:'Pin to edge'});
    ['auto','right','left','top','bottom'].forEach(e=>{
      items.push({label:(e==='auto'?'Auto (shortest)':e.charAt(0).toUpperCase()+e.slice(1))+(curEdge===e?' ✓':''),icon:'',fn:()=>reqAuth(()=>{
        conn._pinnedEdge=(e==='auto'?null:e);
        conn._edge=(e==='auto'?null:e);
        save();redraw();
      })});
    });
    items.push({divider:true});
    items.push({label:'Delete connector',icon:'🗑',danger:true,fn:()=>reqAuth(()=>{
      const wireIds=sc.wires.filter(x=>x.fromConn===conn.id||x.toConn===conn.id).map(w=>w.id);
      removeWhere(sc.connectors,c=>c.id===conn.id);
      removeWhere(sc.wires,x=>x.fromConn===conn.id||x.toConn===conn.id);
      markDeleted([conn.id,...wireIds]);
      save();redraw();notify('Connector deleted');
    })});
    showCtx(e.clientX,e.clientY,items);return;
  }
  if(wire){
    const cA=sc.connectors.find(c=>c.id===wire.fromConn);
    const chStr=cA?.channels?.filter(Boolean).slice(0,cA.pins||99).join(', ')||'—';
    const chOn=wireChVis[wire.id];
    showCtx(e.clientX,e.clientY,[
      {header:'Wire'},
      {prop:'Length',val:wire.length?wire.length+' in':'Not set',editFn:()=>{editWireId=wire.id;document.getElementById('wl-val').value=wire.length||'';openM('m-wirelen');}},
      {prop:'Channels',val:chStr.length>26?chStr.slice(0,26)+'…':chStr},
      {label:chOn?'Hide channels':'Show channels',icon:chOn?'📦':'〰️',fn:()=>{wireChVis[wire.id]=!chOn;redraw();}},
      {label:'Splice wire',icon:'✂️',fn:()=>reqAuth(()=>openSplicePage(wire,w.x,w.y,false))},
      {label:'Edit connector',icon:'🔌',fn:()=>{if(cA){activeConnId=cA.id;goPage('pg-conn');}}},
      {divider:true},
      {label:'Delete wire',icon:'🗑',danger:true,fn:()=>reqAuth(()=>{removeWhere(sc.wires,x=>x.id===wire.id);markDeleted([wire.id]);save();redraw();notify('Wire deleted');})}
    ]);return;
  }
  if(sys){
    showCtx(e.clientX,e.clientY,[
      {header:sys.name},
      {label:'Enter subsystem view',icon:'🔍',fn:()=>enterSubsystem(sys)},
      {label:'Rename system',icon:'✏️',fn:()=>reqAuth(()=>renameSystem(sys))},
      {label:'Add connector',icon:'🔌',fn:()=>reqAuth(()=>{
        const num=sc.connectors.length+1;
        const cid='c'+Date.now();
        sc.connectors.push({id:cid,systemId:sys.id,type:'Amphenol 9-35',customName:'',pins:6,channels:Array(6).fill(''),colors:Array(6).fill('red'),num});
        save();redraw();activeConnId=cid;goPage('pg-conn');notify('Connector added');
      })},
      {divider:true},
      {label:'Delete system',icon:'🗑',danger:true,fn:()=>reqAuth(()=>{
        if(!confirm(`Delete "${sys.name}"?`))return;
        const connIds=sc.connectors.filter(c=>c.systemId===sys.id).map(c=>c.id);
        const wireIds=sc.wires.filter(w=>connIds.includes(w.fromConn)||connIds.includes(w.toConn)).map(w=>w.id);
        removeWhere(sc.systems,s=>s.id===sys.id);
        removeWhere(sc.connectors,c=>c.systemId===sys.id);
        removeWhere(sc.wires,w=>connIds.includes(w.fromConn)||connIds.includes(w.toConn));
        markDeleted([sys.id,...connIds,...wireIds]);
        save();redraw();notify('System deleted');
      })}
    ]);return;
  }
}
