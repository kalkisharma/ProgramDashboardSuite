// In-place cell editing for flat HTML tables (Vehicle Specs, Weight Budget, Gantt list).
// Pairs a uniform interaction (single-click opens the panel, double-click / Enter edits in
// place) with a small input lifecycle. Derived/rolled-up cells must NOT be made editable.

// Replace `cell`'s contents with an input and manage its commit/cancel lifecycle.
//   value     current display value (string|number)
//   type      'text' | 'number'
//   step/min/max  number-input attributes
//   onCommit(rawValue, origValue)  — called only when the value actually changed; the caller
//     validates, mutates the model (pushUndo), and re-renders (which replaces this cell).
export function editCell(cell, { value, type = 'text', step, min, max, placeholder, onCommit }) {
  if (cell.querySelector('input')) return; // already editing
  const origStr = value == null ? '' : String(value);
  const prevHTML = cell.innerHTML;
  const input = document.createElement('input');
  input.className = 'inline-cell-input';
  input.type = type;
  if (step != null) input.step = step;
  if (min != null)  input.min = min;
  if (max != null)  input.max = max;
  if (placeholder)  input.placeholder = placeholder;
  input.value = origStr;
  cell.textContent = '';
  cell.appendChild(input);
  input.focus(); input.select();

  let settled = false;
  const cancel = () => { if (settled) return; settled = true; cell.innerHTML = prevHTML; };
  const commit = () => {
    if (settled) return; settled = true;
    const raw = input.value;
    if (raw.trim() === origStr.trim()) { cell.innerHTML = prevHTML; return; } // unchanged → restore
    onCommit(raw, value); // caller validates + mutates + re-renders (cell is replaced)
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')       { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    e.stopPropagation(); // keep edit keystrokes away from row keyboard-nav handlers
  });
  input.addEventListener('blur', commit);     // blur-commits (no separate dirty tracking)
  input.addEventListener('click', e => e.stopPropagation());
}

// Wire an editable cell: single-click opens the row's panel (after a short delay so a
// double-click doesn't flash it), double-click / Enter edits in place. Non-editable cells
// keep their immediate row click — only editable cells pay the disambiguation delay.
export function wireCellEdit(cell, openPanel, edit) {
  let timer = null;
  cell.addEventListener('click', e => {
    e.stopPropagation();
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; openPanel(); }, 200);
  });
  cell.addEventListener('dblclick', e => {
    e.stopPropagation(); e.preventDefault();
    clearTimeout(timer); timer = null;
    edit();
  });
  cell.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); edit(); }
  });
}
