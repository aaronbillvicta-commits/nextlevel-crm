// NLM CRM — toast notification (single bottom-right banner)
//
// MIGRATION NOTE (step 4 of the modular extraction):
// `showToast()` is temporarily DUPLICATED here AND inline in index.html
// (search for "TOAST" anchor near line ~2965). Strangler-fig:
//   1. (this step) Add the module — nothing imports from it yet, the inline
//      `function showToast(...)` declaration still wins because it creates a
//      true global and the module's export does not.
//   2. (later) Switch new modules to `import { showToast } from './shared/toast.js'`.
//   3. (final) Once no callsite in index.html depends on the inline copy at
//      parse time, delete the inline `let toastTimer` + `function showToast`
//      block.
//
// Behavior is intentionally a verbatim copy of the inline version — no
// refactors during extraction (per saved memory `target-layout-decision`).
// Depends on DOM: `#toast`, `#toast-msg`, `.toast-dot` (declared in index.html
// near line ~2586) and CSS vars `--red` / `--green`.

let toastTimer;

export function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  const dot = t.querySelector('.toast-dot');
  document.getElementById('toast-msg').textContent = msg;
  dot.style.background = type === 'error' ? 'var(--red)' : 'var(--green)';
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// Verification marker — `window.__nlmToastLoaded` should be `true` in DevTools
// console after deploy. If undefined, the module didn't load (check path /
// cache-buster).
window.__nlmToastLoaded = true;
