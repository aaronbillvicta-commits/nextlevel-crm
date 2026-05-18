// NLM CRM — Settings page foundation (theme / currency / branding / workspace / account)
//
// MIGRATION NOTE (step 12 of the modular extraction):
// FIRST file in src/settings/. Strangler-fig: this module duplicates the
// "cosmetic + self-service" half of the Settings page from index.html.
// Nothing imports from it yet; inline copies remain authoritative for every
// callsite (the Settings card onclick handlers, the doLogin success path
// that calls updateSidebarUser, the setCurrency re-render fan-out across
// renderBoard/renderPipelineTabs/renderContacts/renderConversations/renderDashboard).
//
// SCOPE (13 functions verbatim-copied):
//   Branding:    handleLogoUpload, applyLogo, removeLogo,
//                handleFaviconUpload, applyFavicon, removeFavicon
//   Account:     saveAccount
//   Workspace:   saveWorkspace
//   Sidebar:     updateSidebarUser
//   Appearance:  setTheme
//   Currency:    getCurrencyCode, getCurrencySymbol, formatCurrency, setCurrency
//                (plus the CURRENCIES const — module-local copy, same shape as inline)
//
// DELIBERATELY OUT-OF-SCOPE for this file (next sub-extractions):
//   - Team members / permissions: renderUsersList, changeUserRole, savePermission,
//     removeUser, checkRemoveUserConfirm, executeRemoveUser, openInviteUser, inviteUser
//     (security-sensitive; lands in src/settings/users.js next)
//   - Storage stats + version history + audio devices: loadStorageStats,
//     renderStorageStats, saveUsageSnapshot, renderVersionHistory,
//     toggleAudioSettings, enumerateAudioDevices, applyAudioDevice
//     (readouts; lands in src/settings/usage.js after users.js)
//
// ROADMAP POSITION:
//   8a-g.  contacts/         DONE
//   9a-c.  pipelines/        DONE
//   10.    conversations/    DONE
//   11.    clients/          DONE
//   12.    settings/         <- this file is the FIRST of 3 (12a foundation,
//                                12b users, 12c usage)
//   13.    calling/          LAST
//
// ADAPTATIONS from verbatim:
// - State vars via window.*: `currentUser`, `sb` (both already bridged by the
//   state-mirror block at the end of the inline <script>).
// - Inline function refs via window.*: `showToast`, `renderUsersList`,
//   `renderBoard`, `renderPipelineTabs`, `renderContacts`,
//   `renderConversations`, `renderDashboard`, `renderSettingsPipeline`,
//   `openContactDetail`, `activeContactDetailId` (the last two are read
//   together inside setCurrency to refresh an open Pipeline tab on the
//   contact-detail drawer when the currency changes).
// - Module-local refs called bare: `applyLogo` from handleLogoUpload;
//   `applyFavicon` from handleFaviconUpload; `updateSidebarUser` from
//   saveAccount; `getCurrencyCode` from getCurrencySymbol; `getCurrencySymbol`
//   from formatCurrency. These resolve inside the module but the external
//   callsites still hit the inline copies via window from the hoisted-function
//   declarations.
//
// VERIFICATION:
//   window.__nlmSettingsLoaded === true  in DevTools after deploy.
//   Settings page (Branding logo/favicon upload, Account save, Workspace save,
//   Appearance theme picker, Currency picker) behaves identically because the
//   inline copies remain authoritative.

const CURRENCIES = {
  USD: { symbol: '$', label: 'US Dollar' },
  PHP: { symbol: '₱', label: 'Philippine Peso' },
  EUR: { symbol: '€', label: 'Euro' }
};

// ─── BRANDING ─────────────────────────────────────────────────────────────

export function handleLogoUpload(e) {
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    applyLogo(ev.target.result);
    localStorage.setItem('crm-logo', ev.target.result);
    window.showToast('Logo uploaded!');
  };
  reader.readAsDataURL(file);
}

export function applyLogo(src) {
  // Sidebar logo
  const img = document.getElementById('logo-img');
  const ini = document.getElementById('logo-initials');
  if(img){ img.src = src; img.style.display='block'; }
  if(ini) ini.style.display='none';
  // Settings preview
  const sImg = document.getElementById('settings-logo-img');
  const sFb  = document.getElementById('settings-logo-fallback');
  const sRm  = document.getElementById('settings-logo-remove');
  if(sImg){ sImg.src = src; sImg.style.display='block'; }
  if(sFb)  sFb.style.display='none';
  if(sRm)  sRm.style.display='inline-flex';
}

export function removeLogo(){
  localStorage.removeItem('crm-logo');
  const img = document.getElementById('logo-img');
  const ini = document.getElementById('logo-initials');
  if(img){ img.src=''; img.style.display='none'; }
  if(ini) ini.style.display='flex';
  const sImg = document.getElementById('settings-logo-img');
  const sFb  = document.getElementById('settings-logo-fallback');
  const sRm  = document.getElementById('settings-logo-remove');
  if(sImg){ sImg.src=''; sImg.style.display='none'; }
  if(sFb)  sFb.style.display='block';
  if(sRm)  sRm.style.display='none';
  window.showToast('Logo removed');
}

export function handleFaviconUpload(e){
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    applyFavicon(ev.target.result);
    localStorage.setItem('crm-favicon', ev.target.result);
    window.showToast('Favicon updated!');
  };
  reader.readAsDataURL(file);
}

export function applyFavicon(src){
  // Update <link rel="icon">
  const link = document.getElementById('app-favicon');
  if(link) link.href = src;
  // Settings preview
  const sImg = document.getElementById('settings-favicon-img');
  const sFb  = document.getElementById('settings-favicon-fallback');
  const sRm  = document.getElementById('settings-favicon-remove');
  if(sImg){ sImg.src = src; sImg.style.display='block'; }
  if(sFb)  sFb.style.display='none';
  if(sRm)  sRm.style.display='inline-flex';
}

export function removeFavicon(){
  localStorage.removeItem('crm-favicon');
  // Reset to default SVG favicon
  const link = document.getElementById('app-favicon');
  if(link) link.href = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%2300d2ff'/%3E%3Ctext x='50%25' y='55%25' text-anchor='middle' dominant-baseline='middle' fill='%230d1225' font-family='sans-serif' font-weight='700' font-size='14'%3ENL%3C/text%3E%3C/svg%3E";
  const sImg = document.getElementById('settings-favicon-img');
  const sFb  = document.getElementById('settings-favicon-fallback');
  const sRm  = document.getElementById('settings-favicon-remove');
  if(sImg){ sImg.src=''; sImg.style.display='none'; }
  if(sFb)  sFb.style.display='block';
  if(sRm)  sRm.style.display='none';
  window.showToast('Favicon reset');
}

// ─── ACCOUNT + WORKSPACE ──────────────────────────────────────────────────

export async function saveAccount(){
  const name=document.getElementById('acct-name').value.trim();
  const email=document.getElementById('acct-email').value.trim().toLowerCase();
  if(!name){window.showToast('Enter a name','error');return;}
  try {
    await window.sb.patch('users', window.currentUser.id, {name, email});
    window.currentUser.name=name; window.currentUser.email=email;
    updateSidebarUser();
    document.getElementById('acct-pw').value='';
    document.getElementById('acct-pw2').value='';
    window.showToast('Account updated!');
    if(typeof window.renderUsersList === 'function') window.renderUsersList();
  } catch(e){window.showToast('Error updating account','error');}
}

export function saveWorkspace(){
  const name=document.getElementById('ws-name').value.trim();
  if(!name){window.showToast('Enter a workspace name','error');return;}
  document.getElementById('sidebar-user-name').textContent=name;
  window.showToast('Workspace name updated!');
}

export function updateSidebarUser(){
  if(!window.currentUser) return;
  const ini=window.currentUser.name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
  document.getElementById('sidebar-avatar').textContent=ini;
  document.getElementById('sidebar-user-name').textContent=window.currentUser.name;
  document.getElementById('sidebar-user-role').textContent=window.currentUser.role.charAt(0).toUpperCase()+window.currentUser.role.slice(1);
}

// ─── APPEARANCE ───────────────────────────────────────────────────────────

export function setTheme(name){
  if(name !== 'default' && name !== 'light') name = 'default';
  document.body.classList.remove('theme-light');
  if(name === 'light') document.body.classList.add('theme-light');
  localStorage.setItem('crm-theme', name);
  ['default','light'].forEach(t => {
    const el = document.getElementById('theme-opt-'+t);
    if(el) el.classList.toggle('active', t === name);
  });
}

// ─── CURRENCY ─────────────────────────────────────────────────────────────

export function getCurrencyCode(){
  const c = localStorage.getItem('crm-currency') || 'PHP';
  return CURRENCIES[c] ? c : 'PHP';
}

export function getCurrencySymbol(){
  return CURRENCIES[getCurrencyCode()].symbol;
}

export function formatCurrency(value){
  const n = Number(value) || 0;
  return getCurrencySymbol() + n.toLocaleString();
}

export function setCurrency(code){
  if(!CURRENCIES[code]) code = 'PHP';
  localStorage.setItem('crm-currency', code);
  // Update the active state on the Settings buttons
  Object.keys(CURRENCIES).forEach(k => {
    const el = document.getElementById('currency-opt-'+k);
    if(el) el.classList.toggle('active', k === code);
  });
  // Re-render every surface that prints money so the change is instant
  try { if(typeof window.renderBoard === 'function') window.renderBoard(); } catch(_){}
  try { if(typeof window.renderPipelineTabs === 'function') window.renderPipelineTabs(); } catch(_){}
  try { if(typeof window.renderContacts === 'function') window.renderContacts(); } catch(_){}
  try { if(typeof window.renderConversations === 'function') window.renderConversations(); } catch(_){}
  try { if(typeof window.renderDashboard === 'function') window.renderDashboard(); } catch(_){}
  try { if(typeof window.renderSettingsPipeline === 'function') window.renderSettingsPipeline(); } catch(_){}
  // Refresh any open contact-detail Pipeline tab so the (currency) label updates
  const detailOpen = document.getElementById('detail-panel')?.classList.contains('open');
  if(detailOpen && typeof window.activeContactDetailId !== 'undefined' && window.activeContactDetailId && typeof window.openContactDetail === 'function'){
    window.openContactDetail(window.activeContactDetailId);
  }
}

window.__nlmSettingsLoaded = true;
