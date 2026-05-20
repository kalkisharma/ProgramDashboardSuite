let toastTimer = null;
let toastHasUndo = false;

export function showToast(msg, undoFn, duration) {
  duration = duration || 5000;
  if (toastHasUndo && !undoFn) {
    const msgEl = document.getElementById('app-toast-msg');
    const toast = document.getElementById('app-toast');
    const prev = msgEl.textContent;
    msgEl.textContent = prev + '  ·  ' + msg;
    setTimeout(() => { if (toast.classList.contains('visible')) msgEl.textContent = prev; }, 3000);
    return;
  }
  const toast   = document.getElementById('app-toast');
  const msgEl   = document.getElementById('app-toast-msg');
  const undoBtn = document.getElementById('app-toast-undo');
  clearTimeout(toastTimer);
  toastHasUndo = !!undoFn;
  msgEl.textContent = msg;
  undoBtn.style.display = undoFn ? '' : 'none';
  undoBtn.onclick = undoFn ? () => { undoFn(); toast.classList.remove('visible'); toastHasUndo = false; } : null;
  toast.classList.add('visible');
  toastTimer = setTimeout(() => { toast.classList.remove('visible'); toastHasUndo = false; }, duration);
}

export function safeSetItem(key, val) {
  try { localStorage.setItem(key, val); } catch (e) {
    if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22) {
      showToast('⚠ Browser storage is full — preferences not saved. Export your project to preserve data.', null, 8000);
    }
  }
}

export function safeRender(fn, label) {
  try { fn(); } catch (e) {
    console.error('Render error [' + label + ']:', e);
    showToast('⚠ Error rendering ' + label + ' — try reloading the file', null, 6000);
  }
}
