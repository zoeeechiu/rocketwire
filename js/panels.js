// ── PANEL TOGGLES ──
// Collapsing/expanding a side panel changes how much width is left for
// .cv-area, but <canvas> is a replaced element — it doesn't automatically
// resize itself when its container's size changes, unlike a plain <div>.
// Without an explicit resize, the canvas (and its coordinate mapping) stays
// pinned at its old size, leaving the newly-freed space visually dead.
function onPanelToggled(){
  setTimeout(()=>{
    if(currentPage==='pg-canvas'&&cv){
      sizeCanvas();
      redraw();
    }
  },220); // matches the CSS width transition duration
}
function toggleRp(){
  const p=document.getElementById('rp'),b=document.getElementById('rpb'),btn=document.getElementById('rpt-btn');
  const c=p.classList.toggle('col');b.style.display=c?'none':'';btn.textContent=c?'▶':'◀';
  onPanelToggled();
}
function toggleClp(){
  const p=document.getElementById('clp'),b=document.getElementById('clpb'),btn=document.getElementById('clpt-btn');
  const c=p.classList.toggle('col');b.style.display=c?'none':'';btn.textContent=c?'▶':'◀';
  onPanelToggled();
}

// ═══════════════════════════════════════════════════════
