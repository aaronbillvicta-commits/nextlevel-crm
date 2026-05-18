// NLM CRM — Settings → Team Members (users + per-user permission toggles)
//
// MIGRATION NOTE (step 12b of the modular extraction):
// SECOND file in src/settings/. Strangler-fig: this module duplicates the
// "Team Members" Settings card from index.html — render the user rows + role
// dropdowns + per-permission toggles, the per-row Remove flow (with
// type-the-name confirmation), and the Invite User modal. Nothing imports
// from it yet; inline copies remain authoritative for every callsite
// (`onclick="openInviteUser()"`, the role `<select onchange>`, the per-toggle
// `onclick`, the Remove button, the confirmation input `oninput`, and the
// modal-footer Add User button).
//
// Security-sensitive surface — every code path here mutates `users` and/or
// calls /api/create-user|/api/delete-user with the operator's JWT, which is
// why I split it out into its own focused file rather than bundling with the
// 12a foundation block. See [BUG-008](BUGLOG.md) — permission enforcement is
// still UI-only; the actual auth boundary is the API endpoint JWT check from
// BUG-016 plus (eventually) per-row RLS rewrites.
//
// SCOPE (8 functions verbatim-copied from index.html ~6824-7022):
//   renderUsersList            — list render with role <select> + perm toggles
//   changeUserRole             — PATCH users.role + reset permissions to defaults
//   savePermission             — toggle one perm key on/off for one user
//   removeUser                 — opens the type-the-name confirmation modal
//   checkRemoveUserConfirm     — enables/disables the Remove button as the
//                                operator types
//   executeRemoveUser          — POST /api/delete-user; removes from `users`
//                                + closes modal
//   openInviteUser             — opens the Invite User modal
//   inviteUser                 — POST /api/create-user; pushes onto `users`
//
// ROADMAP POSITION:
//   12a foundation             DONE (cosmetic + self-service)
//   12b users                  <- this file
//   12c usage                  NEXT (storage + version history + audio)
//
// STATE-MIRROR ENTRIES ADDED in this step:
//   - users          (let, reassignable — both `users.push(...)` and
//                     `users = users.filter(...)` happen here; needs setter)
//   - PERMISSION_DEFS (const, getter only — module reads to enumerate the
//                     toggle definitions)
//   - authToken      (let, reassignable — bridged for the /api/create-user
//                     and /api/delete-user Authorization headers; also useful
//                     for future callers, since multiple other modules
//                     already call window.* for the bearer header pattern)
//
// ADAPTATIONS from verbatim:
// - State vars via window.*: `users`, `currentUser`, `sb`, `PERMISSION_DEFS`,
//   `authToken`.
// - Inline function refs via window.*: `showToast`, `openModal`, `closeModal`,
//   `rolePermDefaults`, `getUserPerms`. (`rolePermDefaults` + `getUserPerms`
//   live in the inline PERMISSIONS block at ~2914-2925; they were not
//   extracted to `src/shared/permissions.js` despite the script tag name —
//   that file only contains lightweight helpers. The inline copies stay
//   authoritative.)
// - Module-local refs called bare: `renderUsersList` (sibling call from
//   changeUserRole, executeRemoveUser, inviteUser); `getUserPerms` is
//   resolved via window.* because the inline copy is authoritative.
//
// References inside HTML attribute strings (`savePermission`,
// `changeUserRole`, `removeUser`, `checkRemoveUserConfirm`,
// `executeRemoveUser`, `closeModal`, `inviteUser`) are LEFT BARE because
// those strings are parsed at click/input-time and resolve via window from
// the inline hoisted-function declarations.
//
// VERIFICATION:
//   window.__nlmSettingsUsersLoaded === true  in DevTools after deploy.
//   Settings → Team Members renders rows + toggles, role dropdown PATCHes
//   role, per-toggle click PATCHes single perm, Remove opens type-the-name
//   modal then deletes via /api/delete-user, Invite User modal creates an
//   account via /api/create-user — all paths use inline.

export function renderUsersList(){
  const el = document.getElementById('users-list'); if(!el) return;
  const isAdmin = window.currentUser?.role === 'admin';
  el.innerHTML = window.users.map(u => {
    const isSelf = u.id === window.currentUser?.id;
    const isUserAdmin = u.role === 'admin';
    const perms = window.getUserPerms(u);
    // Admins always have full access; toggles are locked for admin rows,
    // and the whole permission UI is read-only unless YOU are an admin.
    const toggles = window.PERMISSION_DEFS.map(p => {
      const on = isUserAdmin ? true : perms[p.key] === true;
      const locked = isUserAdmin || !isAdmin;
      return `<div style="display:flex;align-items:center;gap:7px">
        <div class="toggle ${on?'on':''}" id="perm-${u.id}-${p.key}"
             style="${locked?'opacity:.55;cursor:not-allowed':''};transform:scale(.85)"
             ${locked?'':`onclick="savePermission('${u.id}','${p.key}')"`}
             title="${p.desc}"><div class="toggle-knob"></div></div>
        <span style="font-size:11px;color:var(--text2)">${p.label}</span>
      </div>`;
    }).join('');
    return `
    <div class="user-row-set">
      <div style="width:32px;height:32px;border-radius:50%;background:var(--accent-bg);border:1px solid var(--accent-border);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;color:var(--accent2);flex-shrink:0;font-family:'DM Mono',monospace">
        ${u.name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()}
      </div>
      <div class="user-row-info">
        <div class="user-row-name">${u.name} ${isSelf?'<span style="font-size:10px;color:var(--text3)">(you)</span>':''}</div>
        <div class="user-row-email">${u.email}</div>
      </div>
      <select class="form-select" style="width:auto;padding:5px 8px;font-size:11px" onchange="changeUserRole('${u.id}',this.value)" ${isSelf||!isAdmin?'disabled':''}>
        <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
        <option value="member" ${u.role==='member'?'selected':''}>Member</option>
        <option value="viewer" ${u.role==='viewer'?'selected':''}>Viewer</option>
      </select>
      ${!isSelf&&isAdmin?`<button class="btn btn-sm btn-danger" onclick="removeUser('${u.id}')">Remove</button>`:''}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:14px 20px;padding:2px 0 14px 44px;margin-top:-6px;border-bottom:1px solid var(--border);margin-bottom:12px">
      ${isUserAdmin?'<span style="font-size:11px;color:var(--text3)">Admins have full access to everything.</span>':toggles}
    </div>`;
  }).join('');
}

export async function changeUserRole(userId, role){
  try {
    await window.sb.patch('users', userId, {role});
    const u = window.users.find(x => x.id === userId);
    if(u){
      u.role = role;
      // Reset permissions to the new role's defaults so toggles reflect it
      u.permissions = window.rolePermDefaults(role);
      await window.sb.patch('users', userId, {permissions: u.permissions});
      window.showToast(`${u.name} is now ${role}`);
      renderUsersList();
    }
  } catch(e){ window.showToast('Error updating role', 'error'); }
}

export async function savePermission(userId, key){
  const u = window.users.find(x => x.id === userId); if(!u) return;
  const el = document.getElementById(`perm-${userId}-${key}`); if(!el) return;
  const newVal = !el.classList.contains('on');
  const perms = {...window.getUserPerms(u), [key]: newVal};
  try {
    await window.sb.patch('users', userId, {permissions: perms});
    u.permissions = perms;
    el.classList.toggle('on', newVal);
    const def = window.PERMISSION_DEFS.find(p => p.key === key);
    window.showToast(`${u.name}: ${def.label} ${newVal?'enabled':'disabled'}`);
  } catch(e){ window.showToast('Error updating permission', 'error'); }
}

export function removeUser(userId){
  const u = window.users.find(x => x.id === userId);
  if(!u) return;
  // Defensive: never allow removing the current logged-in user via this flow
  if(u.id === window.currentUser?.id){
    window.showToast("You can't remove your own account here", 'error');
    return;
  }
  const safeName = u.name.replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  const escapedName = u.name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
  window.openModal(`
    <div class="modal-head">
      <div class="modal-title" style="color:var(--red)">Remove Team Member?</div>
      <span class="modal-close" onclick="closeModal()">×</span>
    </div>
    <div class="modal-body">
      <div style="font-size:13px;color:var(--text);line-height:1.6;margin-bottom:14px">
        You're about to remove <strong>${safeName}</strong> (<span style="color:var(--text3)">${u.email}</span>) from your workspace.
      </div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:12px;font-size:12px;color:var(--text2);line-height:1.7;margin-bottom:14px">
        <strong style="color:var(--text)">This will:</strong>
        <ul style="margin:6px 0 0 18px;color:var(--text2)">
          <li>Revoke their login access immediately</li>
          <li>Remove them from the team members list</li>
          <li>Keep their assigned contacts and deals intact (just unassign)</li>
        </ul>
      </div>
      <div style="background:var(--red-bg);border:1px solid rgba(255,77,109,.25);border-radius:var(--radius);padding:10px;font-size:12px;color:var(--red);font-weight:500;margin-bottom:14px">
        ⚠️ This cannot be undone.
      </div>
      <div class="form-group">
        <label class="form-label">Type <strong style="color:var(--text)">${safeName}</strong> to confirm:</label>
        <input id="confirm-remove-input" class="form-input" placeholder="${safeName}" autocomplete="off" oninput="checkRemoveUserConfirm('${escapedName}')"/>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button id="confirm-remove-btn" class="btn btn-danger" disabled onclick="executeRemoveUser('${userId}')" style="opacity:.5;cursor:not-allowed">Remove ${safeName}</button>
    </div>
  `);
  // Focus the input so they can type immediately
  setTimeout(() => document.getElementById('confirm-remove-input')?.focus(), 60);
}

export function checkRemoveUserConfirm(expectedName){
  const input = document.getElementById('confirm-remove-input');
  const btn   = document.getElementById('confirm-remove-btn');
  if(!input || !btn) return;
  const match = input.value.trim() === expectedName;
  btn.disabled = !match;
  btn.style.opacity = match ? '1' : '.5';
  btn.style.cursor  = match ? 'pointer' : 'not-allowed';
}

export async function executeRemoveUser(userId){
  const u = window.users.find(x => x.id === userId);
  if(!u) return;
  const btn = document.getElementById('confirm-remove-btn');
  if(btn){ btn.disabled = true; btn.textContent = 'Removing…'; }
  try {
    // Server-side: deletes BOTH the profile row and the auth account, so
    // login access is genuinely revoked (no orphaned auth account).
    const r = await fetch('/api/delete-user', {
      method: 'POST',
      headers: {'Content-Type':'application/json', 'Authorization':`Bearer ${window.authToken}`},
      body: JSON.stringify({ id: userId, email: u.email })
    });
    const data = await r.json();
    if(!r.ok) throw new Error(data.error || 'unknown');
    window.users = window.users.filter(x => x.id !== userId);
    window.closeModal();
    renderUsersList();
    window.showToast(`${u.name} removed from workspace`);
  } catch(e){
    window.showToast('Error removing user: ' + (e.message || 'unknown'), 'error');
    if(btn){ btn.disabled = false; btn.textContent = 'Remove ' + u.name; }
  }
}

export function openInviteUser(){
  window.openModal(`
    <div class="modal-head"><div class="modal-title">Invite Team Member</div><span class="modal-close" onclick="closeModal()">×</span></div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Full Name</label><input class="form-input" id="inv-name" placeholder="Jane Cruz"/></div>
      <div class="form-group"><label class="form-label">Email Address</label><input class="form-input" id="inv-email" type="email" placeholder="jane@agency.com"/></div>
      <div class="form-group"><label class="form-label">Temporary Password</label><input class="form-input" id="inv-pw" type="password" placeholder="Min 6 characters"/></div>
      <div class="form-group"><label class="form-label">Role</label>
        <select class="form-select" id="inv-role">
          <option value="admin">Admin — full access</option>
          <option value="member" selected>Member — can view & edit</option>
          <option value="viewer">Viewer — read only</option>
        </select>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:4px;line-height:1.6">This creates a real, ready-to-use account — no confirmation email needed. They can log in immediately with these credentials. You can fine-tune their permissions in the team list after.</div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="inv-submit-btn" onclick="inviteUser()">Add User</button></div>`);
}

export async function inviteUser(){
  const name  = document.getElementById('inv-name').value.trim();
  const email = document.getElementById('inv-email').value.trim().toLowerCase();
  const pw    = document.getElementById('inv-pw').value;
  const role  = document.getElementById('inv-role').value;
  if(!name){ window.showToast('Enter a name', 'error'); return; }
  if(!email || !email.includes('@')){ window.showToast('Enter a valid email', 'error'); return; }
  if(!pw || pw.length < 6){ window.showToast('Password must be at least 6 characters', 'error'); return; }
  const btn = document.getElementById('inv-submit-btn');
  if(btn){ btn.disabled = true; btn.textContent = 'Adding…'; }
  try {
    // Server-side: creates a pre-confirmed auth account + profile via the
    // Supabase Admin API. The invited user can log in immediately.
    const r = await fetch('/api/create-user', {
      method: 'POST',
      headers: {'Content-Type':'application/json', 'Authorization':`Bearer ${window.authToken}`},
      body: JSON.stringify({name, email, password: pw, role, permissions: window.rolePermDefaults(role)})
    });
    const data = await r.json();
    if(!r.ok){
      window.showToast(data.error || 'Error creating account', 'error');
      if(btn){ btn.disabled = false; btn.textContent = 'Add User'; }
      return;
    }
    window.users.push({id: data.user.id, name: data.user.name, email: data.user.email, role: data.user.role, permissions: data.user.permissions || {}});
    window.closeModal();
    renderUsersList();
    window.showToast(`${name} added — they can log in right away!`);
  } catch(e){
    window.showToast('Error inviting user', 'error');
    console.error(e);
    if(btn){ btn.disabled = false; btn.textContent = 'Add User'; }
  }
}

window.__nlmSettingsUsersLoaded = true;
