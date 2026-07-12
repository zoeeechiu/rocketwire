// ── DRAW ──
// ── DRAW ──
function redraw(){
  if(!cv||!ctx)return;
  const cw=cv.clientWidth,ch=cv.clientHeight;
  ctx.clearRect(0,0,cw,ch);
  // Grid dots
  ctx.save();ctx.fillStyle='#d8dbe0';
  const gs=28*cam.scale;
  const ox=((cam.x%gs)+gs)%gs,oy=((cam.y%gs)+gs)%gs;
  for(let gx=ox;gx<cw;gx+=gs)for(let gy=oy;gy<ch;gy+=gs)ctx.fillRect(gx-.5,gy-.5,1,1);
  ctx.restore();

  const sc=scope();if(!sc)return;
  const showCnum=document.getElementById('v-cnum')?.checked;
  const showCtype=document.getElementById('v-ctype')?.checked;
  const showWlen=document.getElementById('v-wlen')?.checked;
  const showAllCh=document.getElementById('v-ch')?.checked;

  // ── DRAW WIRES ──
  sc.wires.forEach(wire=>{
    const cA=sc.connectors.find(c=>c.id===wire.fromConn);
    const cB=sc.connectors.find(c=>c.id===wire.toConn);
    if(!cA||!cB)return;
    const eA=connEdgePos(cA),eB=connEdgePos(cB);
    const sA=w2s(eA.x,eA.y),sB=w2s(eB.x,eB.y);
    let {c1,c2}=bezierCPs(sA.x,sA.y,eA.edge,sB.x,sB.y,eB.edge,wire,cam.scale);
    // If wire passes through a box, push control points outward until clear
    if(!wire.cpOx&&!wire.cpOy){
      const excSysIds=new Set([
        sc.connectors.find(c=>c.id===wire.fromConn)?.systemId,
        sc.connectors.find(c=>c.id===wire.toConn)?.systemId
      ].filter(Boolean));
      const obstacles=sc.systems.filter(s=>!excSysIds.has(s.id));
      for(const box of obstacles){
        // Convert box to screen space
        const bsp=w2s(box.x,box.y);
        const sbox={x:bsp.x,y:bsp.y,w:box.w*cam.scale,h:box.h*cam.scale};
        if(bezierHitsBox(sA.x,sA.y,c1.x,c1.y,c2.x,c2.y,sB.x,sB.y,sbox)){
          // Push c1 and c2 further out (increase distance by 40% increments, up to 4x)
          const raw2=bezierCPs(sA.x,sA.y,eA.edge,sB.x,sB.y,eB.edge,{...wire,cpOx:0,cpOy:0},cam.scale);
          const ox1=c1.x-raw2.c1.x, oy1=c1.y-raw2.c1.y;
          const ox2=c2.x-raw2.c2.x, oy2=c2.y-raw2.c2.y;
          for(let boost=1.4;boost<=4;boost+=0.4){
            const tc1={x:raw2.c1.x+ox1*boost+(c1.x-raw2.c1.x)*(boost-1),y:raw2.c1.y+oy1*boost+(c1.y-raw2.c1.y)*(boost-1)};
            const tc2={x:raw2.c2.x+ox2*boost+(c2.x-raw2.c2.x)*(boost-1),y:raw2.c2.y+oy2*boost+(c2.y-raw2.c2.y)*(boost-1)};
            if(!bezierHitsBox(sA.x,sA.y,tc1.x,tc1.y,tc2.x,tc2.y,sB.x,sB.y,sbox)){
              c1=tc1;c2=tc2;break;
            }
          }
        }
      }
    }
    const showCh=wireChVis[wire.id]||showAllCh;

    // Pad both connectors' arrays
    if(!cA.colors)cA.colors=[];if(!cB.colors)cB.colors=[];
    if(!cA.channels)cA.channels=[];if(!cB.channels)cB.channels=[];
    const nPinsA=cA.pins||cA.channels.length||0;
    const nPinsB=cB.pins||cB.channels.length||0;
    while(cA.colors.length<nPinsA)cA.colors.push('red');
    while(cB.colors.length<nPinsB)cB.colors.push('red');

    // Build merged source: for each pin index, pick the connector that has
    // a named channel OR a non-red color. cA (fromConn) is the default.
    // This way EITHER connector's edits are always reflected.
    let cSrc,nPinsMerge;
    if(cB.isSplice&&Array.isArray(cB.stemChannelMap)){
      // Stem wire feeding a splice that uses a DIFFERENT connector type than
      // its stem: splice pin indices don't correspond 1:1 to stem pin
      // indices, so a by-index merge would combine unrelated channels.
      // wire.usedChannelIndices already references stem-side indices here
      // (set in commitSplice), so just show the stem's own data directly.
      nPinsMerge=nPinsA;
      cSrc={pins:nPinsA,channels:cA.channels,colors:cA.colors,
            isSplice:cA.isSplice,systemId:cA.systemId,channelMap:cA.channelMap};
    } else {
      nPinsMerge=Math.max(nPinsA,nPinsB,cA.pins||0,cB.pins||0);
      const mergedChannels=Array.from({length:nPinsMerge},(_,i)=>{
        const ca=cA.channels[i]||'', cb=cB.channels[i]||'';
        return ca||cb;
      });
      // For each pin: take cA color if set non-red, else cB color if set non-red, else red
      // Result: EITHER connector's color edits are always visible
      const mergedColors=Array.from({length:nPinsMerge},(_,i)=>{
        const ca=cA.colors[i]||'red';
        const cb=cB.colors[i]||'red';
        if(ca!=='red')return ca;
        if(cb!=='red')return cb;
        return 'red';
      });
      // cSrc is a virtual object with merged data
      cSrc={pins:nPinsMerge,channels:mergedChannels,colors:mergedColors,
            isSplice:cA.isSplice,systemId:cA.systemId,channelMap:cA.channelMap};
    }

    // Filter channels shown on this wire:
    let activeChIndices=null;
    let branchChansToDraw=null;
    if(wire.isBranch&&cA.isSplice&&cA.channelMap){
      // Branch wire (splice -> child): resolve each routed channel by NAME
      // against the CHILD's own channels/colors, rather than assuming the
      // splice's pin index lines up with the child's pin index. This way it
      // keeps working correctly even if the child's own pin arrangement
      // changes later — the wire "follows" the channel, not a raw index.
      branchChansToDraw=[];
      cA.channelMap.forEach((mappings,chIdx)=>{
        const mapped=Array.isArray(mappings)?mappings:[mappings];
        const m=mapped.find(mm=>mm&&mm.connId===cB.id);
        if(!m)return;
        const name=m.chName||cA.channels[chIdx]||'';
        if(!name)return;
        const childIdx=cB.channels.indexOf(name);
        const col=childIdx>=0?(cB.colors[childIdx]||'red'):(cA.colors[chIdx]||'red');
        branchChansToDraw.push({ch:name,col:WHX[col]||'#c0392b',i:chIdx});
      });
    } else if(wire.usedChannelIndices&&wire.usedChannelIndices.length>0){
      activeChIndices=wire.usedChannelIndices;
    }

    if(showCh&&nPinsMerge>0){
      const nPins=cSrc.pins||cSrc.channels.length;
      const allChans=Array.from({length:nPins},(_,i)=>cSrc.channels[i]||'');
      const activeIdxSet=activeChIndices?new Set(activeChIndices):null;
      const chansToDraw=branchChansToDraw!==null?branchChansToDraw:allChans.map((ch,i)=>({ch,col:WHX[cSrc.colors[i]]||'#c0392b',i}))
        .filter(({i})=>activeIdxSet===null||activeIdxSet.has(i));
      const n=chansToDraw.length;
      if(n===0){
        // Branch wire with no mapped channels — draw thin gray placeholder
        ctx.save();ctx.strokeStyle='#ddd';ctx.lineWidth=1*cam.scale;ctx.setLineDash([4*cam.scale,4*cam.scale]);
        ctx.beginPath();ctx.moveTo(sA.x,sA.y);ctx.bezierCurveTo(c1.x,c1.y,c2.x,c2.y,sB.x,sB.y);
        ctx.stroke();ctx.setLineDash([]);ctx.restore();
      } else {
      const chans=chansToDraw; // rename for loop below
      // Constant spacing in WORLD units — scales with zoom like everything else,
      // so relative spacing between channel wires is preserved exactly.
      const spreadW=18;
      // Perpendicular direction based on the overall wire direction
      const wireAngle=Math.atan2(sB.y-sA.y,sB.x-sA.x);
      const perpX=-Math.sin(wireAngle),perpY=Math.cos(wireAngle);
      // Midpoint of the base bezier (for label placement)
      const mx0=bpt(sA.x,c1.x,c2.x,sB.x,0.5),my0=bpt(sA.y,c1.y,c2.y,sB.y,0.5);
      const mx1=bpt(sA.x,c1.x,c2.x,sB.x,0.51),my1=bpt(sA.y,c1.y,c2.y,sB.y,0.51);
      const tangAngle=Math.atan2(my1-my0,mx1-mx0);

      chans.forEach(({ch,col,i},drawIdx)=>{
        const off=(drawIdx-(n-1)/2)*spreadW;
        const cpOx=perpX*off*cam.scale,cpOy=perpY*off*cam.scale;
        const unlabeled=!ch; // grey dashed if no channel name assigned
        ctx.save();
        ctx.strokeStyle=unlabeled?'#bbb':col;
        ctx.lineWidth=1.5*cam.scale;
        if(unlabeled)ctx.setLineDash([5*cam.scale,4*cam.scale]);
        ctx.beginPath();
        ctx.moveTo(sA.x,sA.y);
        ctx.bezierCurveTo(
          c1.x+cpOx, c1.y+cpOy,
          c2.x+cpOx, c2.y+cpOy,
          sB.x, sB.y
        );
        ctx.stroke();
        ctx.setLineDash([]);
        // Only show label if channel has a name
        if(ch){
          const lx=bpt(sA.x,c1.x+cpOx,c2.x+cpOx,sB.x,0.5);
          const ly=bpt(sA.y,c1.y+cpOy,c2.y+cpOy,sB.y,0.5);
          const fs=15*cam.scale;
          ctx.font=`600 ${fs}px -apple-system,sans-serif`;
          const tw=ctx.measureText(ch).width+4;
          let labelAngle=tangAngle;
          if(labelAngle>Math.PI/2||labelAngle<-Math.PI/2)labelAngle+=Math.PI;
          ctx.translate(lx,ly);ctx.rotate(labelAngle);
          ctx.fillStyle='rgba(255,255,255,.9)';
          ctx.fillRect(-tw/2,-fs/2-1,tw,fs+2);
          ctx.fillStyle=col;ctx.textAlign='center';ctx.textBaseline='middle';
          ctx.fillText(ch,0,0);
        }
        ctx.restore();
      });
      } // end n>0
    } else {
      // Bundled wire always red
      ctx.save();ctx.strokeStyle='#c0392b';ctx.lineWidth=2.5*cam.scale;
      ctx.beginPath();
      ctx.moveTo(sA.x,sA.y);
      ctx.bezierCurveTo(c1.x,c1.y,c2.x,c2.y,sB.x,sB.y);
      ctx.stroke();
      if(showWlen&&wire.length){
        const mx=bpt(sA.x,c1.x,c2.x,sB.x,0.5),my=bpt(sA.y,c1.y,c2.y,sB.y,0.5);
        const txt=wire.length+' in';
        ctx.font=`${10*cam.scale}px -apple-system,sans-serif`;
        const tw=ctx.measureText(txt).width+6;
        ctx.fillStyle='rgba(255,255,255,.92)';ctx.fillRect(mx-tw/2,my-8,tw,15);
        ctx.fillStyle='#c0392b';ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText(txt,mx,my);
      }
      ctx.restore();
    }
    // Draw draggable midpoint handle (always, so user knows they can drag)
    const mx=bpt(sA.x,c1.x,c2.x,sB.x,0.5),my=bpt(sA.y,c1.y,c2.y,sB.y,0.5);
    ctx.save();
    ctx.beginPath();ctx.arc(mx,my,4*cam.scale,0,Math.PI*2);
    ctx.fillStyle='rgba(192,57,43,0.3)';ctx.fill();
    ctx.restore();
  });

    // ── DRAW SYSTEMS ──
  sc.systems.forEach(sys=>{
    const sp=w2s(sys.x,sys.y);
    const sw=sys.w*cam.scale,sh=sys.h*cam.scale;
    ctx.save();
    ctx.shadowColor='rgba(0,0,0,.07)';ctx.shadowBlur=6;
    ctx.fillStyle='#fff';
    ctx.beginPath();
    if(ctx.roundRect)ctx.roundRect(sp.x,sp.y,sw,sh,5*cam.scale);
    else ctx.rect(sp.x,sp.y,sw,sh);
    ctx.fill();ctx.shadowColor='transparent';
    ctx.strokeStyle='#334155';ctx.lineWidth=1.5*cam.scale;ctx.stroke();
    // Name
    ctx.fillStyle='#1a1a2e';
    ctx.font=`500 ${13*cam.scale}px -apple-system,sans-serif`;
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(sys.name,sp.x+sw/2,sp.y+sh/2);
    // Subsystem indicator removed per user request
    ctx.restore();

    // ── CONNECTORS drawn in second pass below ──
  });

  // ── DRAW ALL CONNECTORS ON TOP (after all system boxes, labels never blocked) ──
  sc.connectors.filter(c=>!c.isSplice&&c.systemId).forEach(conn=>{
    drawConnectorDot(conn,sc,showCnum,showCtype);
  });
  sc.connectors.filter(c=>c.isSplice).forEach(conn=>{
    drawConnectorDot(conn,sc,showCnum,showCtype);
  });
}

function drawConnectorDot(conn,sc,showCnum,showCtype){
  const ep=connEdgePos(conn);
  const sp=w2s(ep.x,ep.y);
  const r=8*cam.scale;
  ctx.save();
  ctx.beginPath();ctx.arc(sp.x,sp.y,r,0,Math.PI*2);
  ctx.fillStyle='#c0392b';ctx.fill();
  ctx.strokeStyle='#fff';ctx.lineWidth=1.5*cam.scale;ctx.stroke();
  // Labels NEXT TO dot (not above), using a small offset to the side
  const edge=ep.edge;
  let lx=sp.x,ly=sp.y;
  const off=r+6*cam.scale;
  // Place label to the right by default, or below for top/bottom edges
  if(edge==='right'||edge==='center')     {lx=sp.x+off;ly=sp.y;}
  else if(edge==='left')  {lx=sp.x-off;ly=sp.y;}
  else if(edge==='bottom'){lx=sp.x;ly=sp.y+off;}
  else                    {lx=sp.x;ly=sp.y-off;}

  const fs=11*cam.scale;
  const showCname=document.getElementById('v-cname')?.checked;
  let line1='',line2='',line3='';
  if(showCnum)line1='#'+conn.num;
  if(showCtype)line2=conn.isSplice?conn.type:(conn.customName||conn.type);
  if(showCname&&conn.name)line3=conn.name;
  if(line1||line2||line3){
    const lines=[line1,line2,line3].filter(Boolean);
    const maxW=lines.reduce((m,l)=>{ctx.font=`700 ${fs}px -apple-system,sans-serif`;return Math.max(m,ctx.measureText(l).width);},0)+6;
    const totalH=lines.length*(fs+2)+4;
    let bgX=lx,bgY=ly-totalH/2;
    if(edge==='left')bgX=lx-maxW;
    // Draw pill background
    // Solid white background so text is never obscured by wires
    ctx.fillStyle='rgba(255,255,255,0.96)';ctx.beginPath();
    if(ctx.roundRect)ctx.roundRect(bgX-2,bgY-1,maxW+4,totalH+2,4);
    else ctx.rect(bgX-2,bgY-1,maxW+4,totalH+2);
    ctx.fill();
    // Subtle red tint border
    ctx.strokeStyle='rgba(192,57,43,.25)';ctx.lineWidth=0.8*cam.scale;ctx.stroke();
    lines.forEach((ln,i)=>{
      ctx.fillStyle='#c0392b';
      ctx.font=`700 ${fs}px -apple-system,sans-serif`;
      ctx.textAlign=edge==='left'?'right':'left';
      ctx.textBaseline='top';
      ctx.fillText(ln,edge==='left'?lx:lx+2,bgY+2+i*(fs+2));
    });
  }
  ctx.restore();
}

function drawPolyline(pts){
  if(pts.length<2)return;
  ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);
  for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i][0],pts[i][1]);
  ctx.stroke();
}
function midPt(pts){
  if(pts.length===0)return{x:0,y:0};
  if(pts.length===1)return{x:pts[0][0],y:pts[0][1]};
  // Find point at half total length
  let total=0;
  for(let i=1;i<pts.length;i++)total+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);
  let half=total/2,acc=0;
  for(let i=1;i<pts.length;i++){
    const seg=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);
    if(acc+seg>=half){const t=(half-acc)/seg;return{x:pts[i-1][0]+(pts[i][0]-pts[i-1][0])*t,y:pts[i-1][1]+(pts[i][1]-pts[i-1][1])*t};}
    acc+=seg;
  }
  return{x:pts[pts.length-1][0],y:pts[pts.length-1][1]};
}
