// Touch gestures for the installed app: pull down at the top of a screen to refresh, swipe a sheet down to close it.
import { dismissSheet } from './ui.js';

if ('ontouchstart' in window) {
  let y0 = null, pulling = false, tip;
  const ptr = () => tip ||= Object.assign(document.body.appendChild(document.createElement('div')), { id: 'ptr' });
  document.addEventListener('touchstart', (e) => {
    const sheetOpen = document.getElementById('sheet')?.open;
    y0 = !sheetOpen && window.scrollY <= 0 && !e.target.closest('input,textarea,select,.chart-wrap,.scroll-x') ? e.touches[0].clientY : null; pulling = false;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (y0 == null) return; const dy = e.touches[0].clientY - y0;
    pulling = dy > 90; const t = ptr(); t.textContent = pulling ? 'Release to refresh' : 'Pull to refresh'; t.classList.toggle('show', dy > 30);
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (y0 == null) return; y0 = null; const t = ptr();
    if (pulling) { t.textContent = 'Refreshing…'; setTimeout(() => location.reload(), 150); } else t.classList.remove('show');
  });

  // Sheets: drag down from the title row (or anywhere when scrolled to the top) to close.
  let s0 = null;
  document.addEventListener('touchstart', (e) => {
    const body = e.target.closest?.('#sheet-body'); s0 = body && body.scrollTop <= 0 && !e.target.closest('input,textarea,select,.keypad,.chips,.scroll-x') ? { y: e.touches[0].clientY, body } : null;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!s0) return; const dy = e.touches[0].clientY - s0.y; if (dy > 0) s0.body.parentElement.style.transform = `translateY(${Math.min(dy, 240) * 0.6}px)`;
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (!s0) return; const dy = (e.changedTouches[0]?.clientY ?? s0.y) - s0.y, d = s0.body.parentElement; s0 = null;
    d.style.transition = 'transform .18s'; d.style.transform = ''; setTimeout(() => { d.style.transition = ''; }, 200);
    if (dy > 120) dismissSheet();
  });
}
