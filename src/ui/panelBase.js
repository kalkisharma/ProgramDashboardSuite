import { state } from '../state.js';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function trapFocus(e) {
  const panel = document.getElementById('side-panel');
  if (!panel.classList.contains('open')) return;
  const focusable = Array.from(panel.querySelectorAll(FOCUSABLE));
  if (!focusable.length) return;
  const first = focusable[0];
  const last  = focusable[focusable.length - 1];
  if (e.key === 'Tab') {
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}

function markFormDirty() { state.spFormDirty = true; }

export function showSidePanel() {
  const panel = document.getElementById('side-panel');
  panel.classList.add('open');
  const onOrg   = document.getElementById('org-panel').classList.contains('active');
  const onGantt = document.getElementById('gantt-panel').classList.contains('active');
  document.getElementById('org-container').style.paddingRight  = onOrg   ? '440px' : '';
  document.getElementById('gantt-right-col').style.marginRight  = onGantt ? '440px' : '';
  // A freshly (re)shown panel is pristine; flag it dirty only once the user changes a field.
  state.spFormDirty = false;
  panel.addEventListener('input', markFormDirty);
  panel.addEventListener('keydown', trapFocus);
  requestAnimationFrame(() => {
    const first = panel.querySelector(FOCUSABLE);
    if (first) first.focus();
  });
}

export function closeSidePanel() {
  const panel = document.getElementById('side-panel');
  panel.classList.remove('open');
  panel.removeEventListener('keydown', trapFocus);
  panel.removeEventListener('input', markFormDirty);
  state.spFormDirty = false;
  document.getElementById('org-container').style.paddingRight  = '';
  document.getElementById('gantt-right-col').style.marginRight = '';
  state.spCurrentType = null;
  state.spCurrentId   = null;
  if (state.spOpener && typeof state.spOpener.focus === 'function') { state.spOpener.focus(); }
  state.spOpener = null;
}
