// Shared checkbox multi-select dropdown — a toolbar button that opens a popover with
// Toggle All / Clear All and a checkbox per item. Used by the Status Report Phase, POC
// Team, Customer Team, and Columns controls. One popover instance is shared at a time.
//
// onChange receives the new selected values as an array and is expected to update state +
// re-render only what's needed (e.g. the table body), leaving the anchor button in place
// so the popover stays open during multi-select.
import { esc } from '../utils.js';

let _pop = null;
let _onOutside = null;
let _openForId = null;

function popEl() {
  if (!_pop) {
    _pop = document.createElement('div');
    _pop.className = 'cb-dd-pop';
    _pop.setAttribute('role', 'dialog');
    _pop.style.cssText =
      'display:none;position:fixed;z-index:500;background:var(--surface);' +
      'border:1px solid var(--border);border-radius:8px;padding:6px 0;' +
      'box-shadow:0 4px 16px rgba(0,0,0,0.3);min-width:170px;max-height:320px;overflow-y:auto';
    // Escape closes the popover and returns focus to its anchor button. Attached once
    // (the element persists across opens — innerHTML is replaced, not the node).
    _pop.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        const id = _openForId;
        closeCheckboxDropdown();
        if (id) document.getElementById(id)?.focus();
      }
    });
    document.body.appendChild(_pop);
  }
  return _pop;
}

export function closeCheckboxDropdown() {
  if (_pop) _pop.style.display = 'none';
  if (_openForId) {
    const b = document.getElementById(_openForId);
    if (b) b.setAttribute('aria-expanded', 'false');
  }
  _openForId = null;
  if (_onOutside) { document.removeEventListener('click', _onOutside); _onOutside = null; }
}

function openCheckboxDropdown(anchorBtn, { title, items, selected, onChange }) {
  const pop = popEl();
  const sel = new Set(selected);
  const itemRows = items.map(it => `
    <label style="display:flex;align-items:center;gap:7px;padding:4px 12px;cursor:pointer;
      font-size:0.8rem;color:var(--text);white-space:nowrap">
      <input type="checkbox" value="${esc(it.value)}" ${sel.has(it.value) ? 'checked' : ''} style="cursor:pointer">
      ${esc(it.label)}
    </label>`).join('');
  pop.innerHTML = `
    <div style="display:flex;gap:10px;padding:4px 12px 6px;border-bottom:1px solid var(--border);margin-bottom:4px">
      <button type="button" class="cb-dd-all" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:0.78rem;padding:0">Toggle All</button>
      <button type="button" class="cb-dd-clear" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:0.78rem;padding:0">Clear All</button>
    </div>
    ${title ? `<div style="padding:0 12px 4px;font-size:0.68rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">${esc(title)}</div>` : ''}
    ${itemRows}`;

  pop.style.display = 'block';
  const r = anchorBtn.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = r.left, top = r.bottom + 4;
  if (left + pw > window.innerWidth  - 8) left = window.innerWidth  - pw - 8;
  if (top  + ph > window.innerHeight - 8) top  = r.top - ph - 4;
  pop.style.left = Math.max(8, left) + 'px';
  pop.style.top  = Math.max(8, top)  + 'px';
  anchorBtn.setAttribute('aria-expanded', 'true');
  _openForId = anchorBtn.id;
  pop.querySelector('input[type=checkbox]')?.focus();  // move focus into the dialog

  const emit = () => onChange([...sel]);
  pop.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => { cb.checked ? sel.add(cb.value) : sel.delete(cb.value); emit(); });
  });
  pop.querySelector('.cb-dd-all').addEventListener('click', () => {
    items.forEach(it => sel.add(it.value));
    pop.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = true; });
    emit();
  });
  pop.querySelector('.cb-dd-clear').addEventListener('click', () => {
    sel.clear();
    pop.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = false; });
    emit();
  });

  if (_onOutside) document.removeEventListener('click', _onOutside);
  _onOutside = e => {
    if (!pop.contains(e.target) && e.target !== anchorBtn && !anchorBtn.contains(e.target)) closeCheckboxDropdown();
  };
  // Defer so the click that opened the popover doesn't immediately close it.
  setTimeout(() => { if (_onOutside) document.addEventListener('click', _onOutside); }, 0);
}

// Toggle the dropdown for an anchor button: closes if already open for it, else opens.
export function toggleCheckboxDropdown(anchorBtn, config) {
  const isOpen = _openForId === anchorBtn.id && _pop && _pop.style.display !== 'none';
  if (isOpen) closeCheckboxDropdown();
  else openCheckboxDropdown(anchorBtn, config);
}
