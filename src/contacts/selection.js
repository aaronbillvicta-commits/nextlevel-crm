// NLM CRM - contacts bulk selection + view switcher
//
// MIGRATION NOTE (step 8e of the modular extraction):
// Fifth file in src/contacts/. Strangler-fig: this module duplicates the
// bulk-selection block (index.html ~11303-11365) and the view switcher
// (~11405-11423). Nothing imports from it yet; the inline copies are still
// authoritative for every callsite.
//
// Roadmap (per saved memory `target-layout-decision` and CONTINUE-HERE):
//   8a-c. helpers/notes/import-export DONE
//   8d-prep. state mirror              DONE 21043c1
//   8d. filters.js                     DONE 264e52c
//   8e. selection.js                   <- this file
//   8f. index.js                       (renderContacts + table + state)
//
// One state var was added to the index.html mirror block as part of this
// step: `contactView`. The other state var this module touches,
// `selectedContactIds`, was already bridged in 8d-prep.
//
// ADAPTATIONS FROM VERBATIM:
//
// State (via the window.* mirror):
// - `selectedContactIds` -> `window.selectedContactIds` (Set, mutated in place)
// - `contactView`        -> `window.contactView`        (string, reassigned via setter)
// - `contacts`           -> `window.contacts`
//
// Plus one direct window property (NOT a mirrored let, just a transient cache
// the inline render writes):
// - `window._visibleContactIds` -> kept as-is (already a window property in
//   inline code; renderContacts sets it before the bulk bar reads it)
//
// Function refs (inline `function foo(){}` -> on window automatically):
// - `renderBulkActionLog` -> `window.renderBulkActionLog`
//
// Module-local refs: `syncBulkActionBar` is defined here and called by the
// other selection functions in this module without the window. prefix.
//
// References inside `onclick="..."` attribute strings (e.g.
// `toggleContactSelection`, `toggleSelectAllContacts`, `setContactView`) are
// LEFT BARE because those strings are parsed at click-time and resolve via
// window from the inline hoisted-function declarations.

// ───────────────── BULK SELECTION ─────────────────

export function toggleContactSelection(id, checked){
  if(checked) window.selectedContactIds.add(id);
  else window.selectedContactIds.delete(id);
  const cb = document.querySelector(`.contact-row-checkbox[data-id="${id}"]`);
  if(cb){
    const tr = cb.closest('tr');
    if(tr) tr.classList.toggle('row-selected', checked);
  }
  syncBulkActionBar();
}

export function toggleSelectAllContacts(checked){
  const visible = window._visibleContactIds || [];
  if(checked){
    visible.forEach(id => window.selectedContactIds.add(id));
  } else {
    visible.forEach(id => window.selectedContactIds.delete(id));
  }
  document.querySelectorAll('.contact-row-checkbox').forEach(cb => {
    cb.checked = checked;
    const tr = cb.closest('tr');
    if(tr) tr.classList.toggle('row-selected', checked);
  });
  syncBulkActionBar();
}

export function clearContactSelection(){
  window.selectedContactIds.clear();
  document.querySelectorAll('.contact-row-checkbox').forEach(cb => {
    cb.checked = false;
    const tr = cb.closest('tr');
    if(tr) tr.classList.remove('row-selected');
  });
  syncBulkActionBar();
}

export function syncBulkActionBar(){
  const bar  = document.getElementById('bulk-action-bar');
  const cnt  = document.getElementById('bulk-count');
  const all  = document.getElementById('contact-select-all');
  if(!bar) return;
  const n = window.selectedContactIds.size;
  bar.classList.toggle('active', n > 0);
  if(cnt) cnt.textContent = n;
  if(all){
    const visible = window._visibleContactIds || [];
    const visSelected = visible.filter(id => window.selectedContactIds.has(id)).length;
    if(visSelected === 0){
      all.checked = false; all.indeterminate = false;
    } else if(visSelected === visible.length){
      all.checked = true; all.indeterminate = false;
    } else {
      all.checked = false; all.indeterminate = true;
    }
  }
}

export function getSelectedContacts(){
  return window.contacts.filter(c => window.selectedContactIds.has(c.id));
}

// ───────────────── VIEW SWITCHER ─────────────────

export function setContactView(view){
  window.contactView = view;
  document.querySelectorAll('.contact-view-tab').forEach(t=>{
    t.classList.toggle('active', t.dataset.cview === view);
  });
  const mainView = document.getElementById('contacts-main-view');
  const logView  = document.getElementById('bulk-log-view');
  const headerActions = document.getElementById('contacts-header-actions');
  if(view === 'log'){
    if(mainView) mainView.style.display='none';
    if(logView)  logView.style.display='block';
    if(headerActions) headerActions.style.display='none';
    window.renderBulkActionLog();
  } else {
    if(mainView) mainView.style.display='block';
    if(logView)  logView.style.display='none';
    if(headerActions) headerActions.style.display='flex';
  }
}

window.__nlmContactsSelectionLoaded = true;
