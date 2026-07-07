// ── PANEL TOGGLES ──
function toggleRp(){
  const p=document.getElementById('rp'),b=document.getElementById('rpb'),btn=document.getElementById('rpt-btn');
  const c=p.classList.toggle('col');b.style.display=c?'none':'';btn.textContent=c?'▶':'◀';
  setTimeout(redraw,220);
}
function toggleClp(){
  const p=document.getElementById('clp'),b=document.getElementById('clpb'),btn=document.getElementById('clpt-btn');
  const c=p.classList.toggle('col');b.style.display=c?'none':'';btn.textContent=c?'▶':'◀';
}

// ═══════════════════════════════════════════════════════
