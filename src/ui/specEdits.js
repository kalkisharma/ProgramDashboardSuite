import { state } from '../state.js';
import { SPEC_COLORS } from '../colors.js';
import { renderSpecTable } from '../render/specs.js';
import { pushUndo } from '../core/undo.js';
import { showToast } from './toast.js';

function _refreshSpecPanel(s) {
  renderSpecTable();
  state.spCurrentType = null;
  if (state.handlers.openSpecPanel) state.handlers.openSpecPanel(s.id);
}

export function startSpecNameEdit(el, s) {
  if (el.querySelector('input')) return;
  const orig = s.name;
  const input = document.createElement('input');
  input.className = 'gantt-cell-input'; input.value = orig;
  el.textContent = ''; el.appendChild(input); input.focus(); input.select();
  const commit = () => {
    const v = input.value.trim();
    if (!v) { s.name = orig; _refreshSpecPanel(s); showToast('Spec name cannot be empty', null, 3500); }
    else if (v !== orig) { pushUndo('spec name change'); s.name = v; _refreshSpecPanel(s); showToast('Spec name changed', () => { if (state.handlers.applyUndo) state.handlers.applyUndo(); }, 5000); }
    else { _refreshSpecPanel(s); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { s.name = orig; _refreshSpecPanel(s); } });
  input.addEventListener('blur', commit);
}

export function startSpecCategoryEdit(el, s) {
  if (el.querySelector('select')) return;
  const orig = s.category;
  const cats = Object.keys(SPEC_COLORS);
  const sel = document.createElement('select');
  sel.className = 'gantt-cell-select';
  cats.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; if (c === s.category) o.selected = true; sel.appendChild(o); });
  el.textContent = ''; el.appendChild(sel); sel.focus();
  const commit = (save) => {
    if (save && sel.value !== orig) { pushUndo('spec category change'); s.category = sel.value; _refreshSpecPanel(s); showToast('Category changed', () => { if (state.handlers.applyUndo) state.handlers.applyUndo(); }, 5000); }
    else { s.category = orig; _refreshSpecPanel(s); }
  };
  sel.addEventListener('change', () => commit(true));
  sel.addEventListener('keydown', e => { if (e.key === 'Escape') commit(false); });
  sel.addEventListener('blur', () => { if (s.category === orig) commit(false); });
}

export function startSpecValueEdit(el, s) {
  if (el.querySelector('input')) return;
  const orig = s.value;
  const input = document.createElement('input');
  input.className = 'gantt-cell-input'; input.value = orig;
  el.textContent = ''; el.appendChild(input); input.focus(); input.select();
  const commit = () => {
    const v = input.value.trim();
    if (v !== String(orig)) { pushUndo('spec value change'); s.value = v; _refreshSpecPanel(s); showToast('Value changed', () => { if (state.handlers.applyUndo) state.handlers.applyUndo(); }, 5000); }
    else { _refreshSpecPanel(s); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { s.value = orig; _refreshSpecPanel(s); } });
  input.addEventListener('blur', commit);
}

export function startSpecUnitsEdit(el, s) {
  if (el.querySelector('input')) return;
  const orig = s.units;
  const input = document.createElement('input');
  input.className = 'gantt-cell-input'; input.value = orig;
  el.textContent = ''; el.appendChild(input); input.focus(); input.select();
  const commit = () => {
    const v = input.value.trim();
    if (v !== orig) { pushUndo('spec units change'); s.units = v; _refreshSpecPanel(s); showToast('Units changed', () => { if (state.handlers.applyUndo) state.handlers.applyUndo(); }, 5000); }
    else { _refreshSpecPanel(s); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { s.units = orig; _refreshSpecPanel(s); } });
  input.addEventListener('blur', commit);
}

export function startSpecGroupEdit(el, s) {
  if (el.querySelector('input')) return;
  const orig = s.group;
  const input = document.createElement('input');
  input.className = 'gantt-cell-input'; input.value = orig;
  el.textContent = ''; el.appendChild(input); input.focus(); input.select();
  const commit = () => {
    const v = input.value.trim();
    if (v !== orig) { pushUndo('spec group change'); s.group = v; _refreshSpecPanel(s); showToast('Group changed', () => { if (state.handlers.applyUndo) state.handlers.applyUndo(); }, 5000); }
    else { _refreshSpecPanel(s); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { s.group = orig; _refreshSpecPanel(s); } });
  input.addEventListener('blur', commit);
}

export function startSpecIdEdit(el, s) {
  if (el.querySelector('input')) return;
  const orig = s.id;
  const input = document.createElement('input');
  input.className = 'gantt-cell-input'; input.value = orig;
  el.textContent = ''; el.appendChild(input); input.focus(); input.select();
  const commit = () => {
    const v = input.value.trim();
    if (!v) {
      s.id = orig; _refreshSpecPanel(s); showToast('Spec ID cannot be empty', null, 3500);
    } else if (v !== orig && state.ProjectData.specs.some(x => x.id === v)) {
      s.id = orig; _refreshSpecPanel(s); showToast('Spec ID already in use', null, 3500);
    } else if (v !== orig) {
      pushUndo('spec ID change');
      s.id = v;
      state.spCurrentId = v;
      _refreshSpecPanel(s);
      showToast('Spec ID changed', () => { if (state.handlers.applyUndo) state.handlers.applyUndo(); }, 5000);
    } else {
      _refreshSpecPanel(s);
    }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { s.id = orig; _refreshSpecPanel(s); } });
  input.addEventListener('blur', commit);
}

export function startSpecNotesEdit(el, s) {
  if (el.querySelector('textarea')) return;
  const origNotes = s.notes;
  const origOpener = state.spOpener;
  el.innerHTML = '';
  el.removeAttribute('tabindex'); el.removeAttribute('role');
  const ta = document.createElement('textarea');
  ta.className = 'sp-notes-ta';
  ta.value = origNotes;
  ta.placeholder = 'Add notes…';
  el.appendChild(ta);
  const hint = document.createElement('div');
  hint.className = 'sp-hint';
  hint.textContent = 'Ctrl/Cmd+Enter to save · Esc to cancel';
  el.appendChild(hint);
  ta.focus();
  let done = false;
  const save = () => {
    if (done) return; done = true;
    if (ta.value !== origNotes) pushUndo('spec notes change');
    s.notes = ta.value;
    state.spOpener = origOpener;
    _refreshSpecPanel(s);
  };
  const cancel = () => {
    if (done) return; done = true;
    state.spOpener = origOpener;
    _refreshSpecPanel(s);
  };
  ta.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  ta.addEventListener('blur', save);
}
