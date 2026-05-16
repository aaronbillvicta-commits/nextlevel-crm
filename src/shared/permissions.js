// NLM CRM — per-user feature access (role + per-permission toggles)
//
// MIGRATION NOTE (step 5 of the modular extraction):
// `PERMISSION_DEFS`, `PERMISSION_KEYS`, `PAGE_PERMISSION`, `rolePermDefaults`,
// `getUserPerms`, `can`, `requirePerm` are temporarily DUPLICATED here AND
// inline in index.html (search for "PERMISSIONS" anchor near line ~2697).
// Strangler-fig:
//   1. (this step) Add the module — nothing imports from it yet, the inline
//      block is still authoritative for every existing callsite.
//   2. (later) Switch new modules to `import { can, requirePerm, … } from
//      './shared/permissions.js'`.
//   3. (final) Once every inline callsite is migrated, delete the inline
//      PERMISSIONS block.
//
// IMPORTANT — `currentUser` wiring requirement (read before migrating any callsite):
//   The inline code declares `let currentUser = null` (index.html ~line 2695),
//   which is module-scoped to the inline script, NOT on `window`. This module's
//   `can()` therefore reads `window.currentUser` explicitly to avoid throwing a
//   ReferenceError when called from module scope. Today `window.currentUser` is
//   `undefined`, so the module's `can()` will always return `false` — that is
//   FINE because nothing imports it yet. Before any callsite migrates, either:
//     (a) the inline login/logout flow must mirror `window.currentUser = currentUser`
//         on every assignment, OR
//     (b) callers must pass the user in explicitly.
//   Until then, treat the exported `can` / `requirePerm` as shape-only.
//
// `showToast` is referenced bare — it's a hoisted `function` declaration in the
// inline script and so resolves via `window.showToast`. The toast.js module
// (step 4) is intentionally NOT imported here; relying on the inline global
// keeps this extraction purely additive with no transitive coupling.

export const PERMISSION_DEFS = [
  { key:'calling',  label:'Calling & SMS',         desc:'Dialer, click-to-call, send SMS' },
  { key:'edit',     label:'Edit contacts & deals', desc:'Create and edit records' },
  { key:'delete',   label:'Delete records',        desc:'Delete contacts, deals, pipelines' },
  { key:'settings', label:'Settings & team',       desc:'Settings, integrations, custom fields' },
];

export const PERMISSION_KEYS = PERMISSION_DEFS.map(p => p.key);

// Which page each permission gates (used by navigate() and nav hiding).
export const PAGE_PERMISSION = {
  dialer:'calling', conversations:'calling',
  settings:'settings', integrations:'settings', 'custom-fields':'settings',
};

export function rolePermDefaults(role) {
  if (role === 'admin')  return { calling:true,  edit:true,  delete:true,  settings:true  };
  if (role === 'viewer') return { calling:false, edit:false, delete:false, settings:false };
  return { calling:true, edit:true, delete:false, settings:false }; // member
}

export function getUserPerms(user) {
  const defaults = rolePermDefaults(user?.role || 'member');
  const stored = (user && user.permissions) || {};
  const out = {};
  for (const k of PERMISSION_KEYS) out[k] = (typeof stored[k] === 'boolean') ? stored[k] : defaults[k];
  return out;
}

// can(key) — does the CURRENT user have this permission? Admins always do.
// Reads window.currentUser; see migration note above.
export function can(key) {
  if (!window.currentUser) return false;
  if (window.currentUser.role === 'admin') return true;
  return getUserPerms(window.currentUser)[key] === true;
}

// requirePerm(key, msg) — guard for action functions; shows a toast if denied.
export function requirePerm(key, msg) {
  if (can(key)) return true;
  showToast(msg || "You don't have permission to do that", 'error');
  return false;
}

// Verification marker — `window.__nlmPermissionsLoaded` should be `true` in
// DevTools console after deploy. If undefined, the module didn't load (check
// path / cache-buster).
window.__nlmPermissionsLoaded = true;
