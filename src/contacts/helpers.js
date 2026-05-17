// NLM CRM - contacts helpers (pure lookups + CSV export)
//
// MIGRATION NOTE (step 8a of the modular extraction):
// First file in the new src/contacts/ subdirectory. Strangler-fig: this module
// duplicates four small helpers from index.html. Nothing imports from it yet;
// the inline copies are still authoritative for every callsite.
//
// Contacts extraction is split across multiple deploys because the inline
// contacts surface (~30 functions, render + filters + modals + import/export)
// is too big to do in a single pass. Roadmap:
//   8a. helpers.js     <- this file (pure lookups + CSV export)
//   8b. notes.js       (renderContactNotes, editContactNote, cancelContactNoteEdit, renderContactFollowupsHTML)
//   8c. import-export.js (openImportContacts + CSV import flow)
//   8d. index.js       (renderContacts + table + filters + sort + modals + state)
//
// ADAPTATIONS FROM VERBATIM (same scope-resolution pattern as calendar/datepicker.js):
// - `contacts`   -> `window.contacts`   (inline `let contacts = [];` at index.html:2696)
// - `sb`         -> `window.sb`         (Supabase wrapper, inline-scoped)
// - `showToast`  -> `window.showToast`  (inline-scoped, also exported by src/shared/toast.js)
//
// Inline globals referenced via `onclick="..."` strings stay BARE in those
// strings because the HTML parser resolves them at click time via window.

// Match a phone number (any format) against the contacts list.
// Last-10-digit suffix match handles formatting variance (e.g. "+1 (615) 972-9229" vs "6159729229").
export function findContactByPhone(number){
  if(!number) return null;
  const digits = number.replace(/\D/g,'');
  if(!digits) return null;
  return window.contacts.find(c => c.phone && c.phone.replace(/\D/g,'').endsWith(digits.slice(-10))) || null;
}

// Convert a legacy single-blob note (customFields.__notes__) into the array format.
// Idempotent: only migrates if c.notes is empty and a legacy blob exists.
export function migrateContactNotes(c){
  if(!Array.isArray(c.notes)) c.notes = [];
  const legacy = (c.customFields||{})['__notes__'];
  if(legacy && legacy.trim() && c.notes.length === 0){
    c.notes = [{
      id:'note_legacy_'+Date.now(),
      text: legacy.trim(),
      created_at: c.created_at || new Date().toISOString(),
      edited_at: null,
    }];
    if(c.customFields) delete c.customFields['__notes__'];
    try { window.sb.patch('contacts', c.id, { notes:c.notes, custom_fields:c.customFields||{} }); } catch(_){}
  }
}

// Serialize a contact list to CSV and trigger a browser download.
// Pure helper - no globals read, no side-effects beyond the download click.
export function contactsToCSV(list, filename){
  const headers = ['name','email','phone','company','source','status','tags'];
  const rows = list.map(c=>[
    c.name, c.email||'', c.phone||'', c.company||'',
    c.source||'', c.status||'new',
    (c.tags||[]).map(t=>t.label).join('|')
  ].map(v=>`"${String(v).replace(/"/g,'""')}"`));
  const csv = [headers.join(','), ...rows.map(r=>r.join(','))].join('\n');
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download=filename;
  a.click();
}

// Export the current full contacts list as CSV with today's date in the filename.
export function exportContactsCSV(){
  contactsToCSV(window.contacts, `contacts-${new Date().toISOString().slice(0,10)}.csv`);
  window.showToast(`Exported ${window.contacts.length} contacts`);
}

window.__nlmContactsHelpersLoaded = true;
