// ── CONNECTOR EDGE POSITION ──
function bestEdgeForConn(conn, sys, sc){
  // If user has pinned this connector to a specific edge, always use it
  if(conn._pinnedEdge){
    conn._edge=conn._pinnedEdge;
    return conn._pinnedEdge;
  }
  // Find all wires connected to this connector and their other endpoints
  const wires=sc.wires.filter(w=>w.fromConn===conn.id||w.toConn===conn.id);
  if(!wires.length){
    conn._edge=conn._edge||'right';
    return conn._edge;
  }

  // Collect target positions (world space) for each wire
  const targets=[];
  wires.forEach(w=>{
    const othId=w.fromConn===conn.id?w.toConn:w.fromConn;
    const oc=sc.connectors.find(c=>c.id===othId);
    if(!oc)return;
    if(oc.isSplice&&!oc.systemId){
      targets.push({x:oc.x||0,y:oc.y||0});
    } else {
      const ts=sc.systems.find(s=>s.id===oc.systemId);
      if(ts){targets.push({x:ts.x+ts.w/2,y:ts.y+ts.h/2});}
    }
  });
  if(!targets.length){conn._edge=conn._edge||'right';return conn._edge;}

  // For each candidate edge, compute the center point on that edge
  // then sum the straight-line distances to all targets + control point stub length.
  // Pick the edge that minimises total path length.
  const edges=['right','left','top','bottom'];
  const edgeCenters={
    right: {x:sys.x+sys.w, y:sys.y+sys.h/2},
    left:  {x:sys.x,        y:sys.y+sys.h/2},
    top:   {x:sys.x+sys.w/2, y:sys.y},
    bottom:{x:sys.x+sys.w/2, y:sys.y+sys.h},
  };

  let bestEdge=conn._edge||'right', bestCost=Infinity;
  edges.forEach(edge=>{
    const ep=edgeCenters[edge];
    let cost=0;
    targets.forEach(({x,y})=>{
      // Squared distance from this edge center to the actual target position
      // (no drag offset — edge is determined by where the other system IS, not wire shape)
      const dx=x-ep.x, dy=y-ep.y;
      cost+=dx*dx+dy*dy;
    });
    if(cost<bestCost){bestCost=cost;bestEdge=edge;}
  });

  conn._edge=bestEdge;
  return bestEdge;
}

function connEdgePos(conn){
  const sc=scope();if(!sc)return{x:0,y:0,edge:'right'};
  // Free-floating splice (from wire): use stored x/y
  if(conn.isSplice&&!conn.systemId){
    return{x:conn.x||0,y:conn.y||0,edge:'center'};
  }
  const sys=sc.systems.find(s=>s.id===conn.systemId);
  if(!sys)return{x:0,y:0,edge:'right'};

  const edge=bestEdgeForConn(conn,sys,sc);

  // All connectors on this system that land on the same edge — place them evenly
  const onEdge=sc.connectors.filter(c=>c.systemId===sys.id&&bestEdgeForConn(c,sys,sc)===edge);
  const idx=onEdge.indexOf(conn);
  const total=Math.max(onEdge.length,1);
  const t=(idx+1)/(total+1);

  // Use _edgeT if user has dragged connector along the edge, otherwise center among peers
  const edgeT=conn._edgeT!==undefined?conn._edgeT:t;
  if(edge==='right')  return{x:sys.x+sys.w,         y:sys.y+sys.h*edgeT,   edge};
  if(edge==='left')   return{x:sys.x,                y:sys.y+sys.h*edgeT,   edge};
  if(edge==='top')    return{x:sys.x+sys.w*edgeT,    y:sys.y,               edge};
  return                    {x:sys.x+sys.w*edgeT,    y:sys.y+sys.h,         edge};
}

function calcEdge(conn,sys,sc){
  if(conn.isSplice&&!conn.systemId)return'center';
  return bestEdgeForConn(conn,sys,sc);
}

// ── SMOOTH BEZIER ROUTER (obstacle-aware curve) ──
// Returns a smooth bezier path as a series of canvas draw calls via drawBezier()
function getEdgeCtrl(x, y, edge, dist) {
  const d = Math.max(dist, 50);
  if (edge === 'right')  return { x: x + d, y };
  if (edge === 'left')   return { x: x - d, y };
  if (edge === 'bottom') return { x, y: y + d };
  if (edge === 'top')    return { x, y: y - d };
  return { x: x + d, y }; // center/splice
}

function bpt(p0,p1,p2,p3,t){return (1-t)**3*p0+3*(1-t)**2*t*p1+3*(1-t)*t**2*p2+t**3*p3;}

// Returns {c1,c2} bezier control points for a wire from (ax,ay,edgeA) to (bx,by,edgeB)
function bezierCPs(ax,ay,eA,bx,by,eB,wire,scale){
  const s=scale||1;
  const rawDist=Math.hypot(bx-ax,by-ay);
  // Compute dist in world space so curve shape is zoom-independent
  const worldDist=rawDist/s;
  let dist=Math.max(70, worldDist*0.38) * s;
  // Same-edge: bigger loop
  const sameAxis=(eA===eB);
  if(sameAxis) dist=Math.max(dist, worldDist*0.65*s, 90*s);

  function ctrl(x,y,edge,ox,oy,d){
    if(edge==='center'){
      const ang=Math.atan2(oy-y,ox-x);
      return{x:x+Math.cos(ang)*d,y:y+Math.sin(ang)*d};
    }
    return getEdgeCtrl(x,y,edge,d);
  }
  const c1=ctrl(ax,ay,eA,bx,by,dist);
  const c2=ctrl(bx,by,eB,ax,ay,dist);

  // cpOx/cpOy stored in world space — multiply by s
  if(wire&&(wire.cpOx||wire.cpOy)){
    const ox=(wire.cpOx||0)*s, oy=(wire.cpOy||0)*s;
    return{c1:{x:c1.x+ox,y:c1.y+oy},c2:{x:c2.x+ox,y:c2.y+oy}};
  }
  return{c1,c2};
}

// Check if a bezier curve passes through a system box (world coords)
function bezierHitsBox(ax,ay,c1x,c1y,c2x,c2y,bx,by,box){
  const pad=10;
  const x1=box.x-pad,y1=box.y-pad,x2=box.x+box.w+pad,y2=box.y+box.h+pad;
  for(let t=0.1;t<=0.9;t+=0.05){
    const px=bpt(ax,c1x,c2x,bx,t),py=bpt(ay,c1y,c2y,by,t);
    if(px>x1&&px<x2&&py>y1&&py<y2)return true;
  }
  return false;
}
