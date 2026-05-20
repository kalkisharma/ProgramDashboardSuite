import { state } from '../state.js';

export function showSidePanel() {
  document.getElementById('side-panel').classList.add('open');
  const onOrg   = document.getElementById('org-panel').classList.contains('active');
  const onGantt = document.getElementById('gantt-panel').classList.contains('active');
  document.getElementById('org-container').style.paddingRight  = onOrg   ? '440px' : '';
  document.getElementById('gantt-right-col').style.marginRight  = onGantt ? '440px' : '';
  requestAnimationFrame(() => {
    const panel = document.getElementById('side-panel');
    const first = panel.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (first) first.focus();
  });
}

export function closeSidePanel() {
  document.getElementById('side-panel').classList.remove('open');
  document.getElementById('org-container').style.paddingRight = '';
  document.getElementById('gantt-right-col').style.marginRight = '';
  state.spCurrentType = null;
  state.spCurrentId   = null;
  if (state.spOpener && typeof state.spOpener.focus === 'function') { state.spOpener.focus(); }
  state.spOpener = null;
}
