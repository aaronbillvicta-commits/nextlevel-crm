// NLM CRM - contact notes CRUD + follow-ups list rendering
//
// MIGRATION NOTE (step 8b of the modular extraction):
// Second file in src/contacts/. Strangler-fig: this module duplicates seven
// notes-related functions from index.html (lines ~5404-5534). Nothing imports
// from it yet; the inline copies are still authoritative for every callsite.
//
// Roadmap (per saved memory `target-layout-decision` and CONTINUE-HERE):
//   8a. helpers.js        DONE 601d472 (findContactByPhone, migrateContactNotes, contactsToCSV, exportContactsCSV)
//   8b. notes.js          <- this file (renderContactFollowupsHTML + notes CRUD)
//   8c. import-export.js  (openImportContacts + CSV import flow)
//   8d. index.js          (renderContacts + table + filters + sort + modals + state)
//
// Scope of 8b: all seven notes-tab functions, kept together because the CRUD
// path (add/edit/save/delete) is too tightly coupled to renderContactNotes()
// to split sensibly. renderContactFollowupsHTML() also lives here because it
// renders the sibling section in the same contact-detail Activity tab.
//
// ADAPTATIONS FROM VERBATIM (every bare identifier in module scope that refers
// to an inline-only global — module scope cannot resolve them lexically):
// - `contacts`               -> `window.contacts`
// - `sb`                     -> `window.sb`
// - `showToast`              -> `window.showToast`
// - `requirePerm`            -> `window.requirePerm`
// - `touchContactActivity`   -> `window.touchContactActivity`
// - `fmtNoteTime`            -> `window.fmtNoteTime`
// - `_isFollowupAutoNote`    -> `window._isFollowupAutoNote`
// - `getFollowupsForContact` -> `window.getFollowupsForContact` (also guarded
//                              with `typeof window.getFollowupsForContact ===
//                              'function'` to preserve the original defensive
//                              check)
// - `followupTypeChip`       -> `window.followupTypeChip` (template expression)
//
// References inside `onclick="..."` attribute strings (openFollowupModal,
// saveContactNoteEdit, cancelContactNoteEdit, editContactNote,
// deleteContactNote) are LEFT BARE because those strings are parsed at
// click-time and resolve via window from the inline hoisted-function
// declarations. Future migration step: when callsites switch to imports, those
// onclick strings will need to be rewritten too (or the functions assigned to
// window from the module).

// Shared HTML for "Follow-ups" sections in the contact detail panel.
export function renderContactFollowupsHTML(contactId){
  const items = typeof window.getFollowupsForContact === 'function'
    ? window.getFollowupsForContact(contactId)
    : [];
  if(!items.length){
    return `<div style="font-size:12px;color:var(--text3);padding:6px 0">No upcoming follow-ups for this contact.</div>`;
  }
  return items.map(ev=>{
    const d = new Date(ev.start);
    const dateStr = d.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'});
    const timeStr = d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    const note = (ev.notes||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');
    return `<div onclick="openFollowupModal('${contactId}','${ev.id}')"
      style="display:flex;align-items:flex-start;gap:10px;padding:8px 10px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;margin-bottom:6px;transition:border-color .15s"
      onmouseenter="this.style.borderColor='var(--accent-border)'" onmouseleave="this.style.borderColor='var(--border)'">
      ${ev.followupType ? window.followupTypeChip(ev.followupType) : '<span style="font-size:14px;line-height:1.1;margin-top:1px">📅</span>'}
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:500;color:var(--text)">${dateStr} · ${timeStr}</div>
        ${note?`<div style="font-size:11px;color:var(--text3);margin-top:2px;white-space:pre-wrap">${note}</div>`:''}
      </div>
      <span style="font-size:10px;color:var(--accent2)">Edit →</span>
    </div>`;
  }).join('');
}

export function renderContactNotes(contactId){
  const el = document.getElementById('cd-notes-list');
  if(!el) return;
  const c = window.contacts.find(x=>x.id===contactId);
  if(!c) return;
  if(!Array.isArray(c.notes)) c.notes = [];
  // Hide legacy auto-notes ("📅 Follow-up …"). Follow-ups now live solely on
  // the Activity tab's Follow-ups section.
  const visibleNotes = c.notes.filter(n => !window._isFollowupAutoNote(n.text));
  if(visibleNotes.length === 0){
    el.innerHTML = '<div style="font-size:12px;color:var(--text3);padding:8px 0;text-align:center">No notes yet — add the first one above.</div>';
    return;
  }
  // Newest first
  const sorted = [...visibleNotes].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  el.innerHTML = sorted.map((n, i)=>{
    const safeText = (n.text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const isEditing = el.dataset.editing === n.id;
    const sep = i>0 ? 'border-top:1px solid var(--border);' : '';
    if(isEditing){
      return `<div style="${sep}padding:10px 0">
        <textarea class="form-input" id="cd-note-edit-${n.id}" style="width:100%;min-height:54px;resize:vertical;font-family:inherit">${safeText}</textarea>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button class="btn btn-primary btn-sm" onclick="saveContactNoteEdit('${contactId}','${n.id}')">Save</button>
          <button class="btn btn-sm" onclick="cancelContactNoteEdit('${contactId}')">Cancel</button>
        </div>
      </div>`;
    }
    return `<div style="${sep}padding:10px 0">
      <div style="font-size:13px;color:var(--text);line-height:1.55;white-space:pre-wrap;word-break:break-word">${safeText}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:5px;flex-wrap:wrap">
        <span style="font-size:10px;color:var(--text3)">🕐 Added ${window.fmtNoteTime(n.created_at)}</span>
        ${n.edited_at ? `<span style="font-size:10px;color:var(--amber)">✏️ Edited ${window.fmtNoteTime(n.edited_at)}</span>` : ''}
        <span style="flex:1"></span>
        <button class="btn btn-sm" style="font-size:10px;padding:2px 7px" onclick="editContactNote('${contactId}','${n.id}')">Edit</button>
        <button class="btn btn-sm" style="font-size:10px;padding:2px 7px;color:var(--red)" onclick="deleteContactNote('${contactId}','${n.id}')">Delete</button>
      </div>
    </div>`;
  }).join('');
}

export async function addContactNote(contactId){
  const ta = document.getElementById('cd-new-note');
  const text = (ta?.value || '').trim();
  if(!text){ window.showToast('Write something first','error'); return; }
  const c = window.contacts.find(x=>x.id===contactId); if(!c) return;
  if(!Array.isArray(c.notes)) c.notes = [];
  c.notes.push({
    id:'note_'+Date.now()+Math.random().toString(36).slice(2,6),
    text,
    created_at: new Date().toISOString(),
    edited_at: null,
  });
  if(ta) ta.value = '';
  renderContactNotes(contactId);
  try {
    await window.sb.patch('contacts', contactId, { notes:c.notes });
    window.touchContactActivity(contactId, 'update');
    window.showToast('Note added ✅');
  } catch(e){ window.showToast('Error saving note','error'); }
}

export function editContactNote(contactId, noteId){
  const el = document.getElementById('cd-notes-list');
  if(el) el.dataset.editing = noteId;
  renderContactNotes(contactId);
  setTimeout(()=>document.getElementById('cd-note-edit-'+noteId)?.focus(), 40);
}

export function cancelContactNoteEdit(contactId){
  const el = document.getElementById('cd-notes-list');
  if(el) delete el.dataset.editing;
  renderContactNotes(contactId);
}

export async function saveContactNoteEdit(contactId, noteId){
  if(!window.requirePerm('edit','You have view-only access — editing is disabled')) return;
  const ta = document.getElementById('cd-note-edit-'+noteId);
  const text = (ta?.value || '').trim();
  if(!text){ window.showToast('Note cannot be empty — use Delete instead','error'); return; }
  const c = window.contacts.find(x=>x.id===contactId); if(!c) return;
  const note = (c.notes||[]).find(n=>n.id===noteId); if(!note) return;
  note.text = text;
  note.edited_at = new Date().toISOString();
  const el = document.getElementById('cd-notes-list');
  if(el) delete el.dataset.editing;
  renderContactNotes(contactId);
  try {
    await window.sb.patch('contacts', contactId, { notes:c.notes });
    window.touchContactActivity(contactId, 'update');
    window.showToast('Note updated ✅');
  } catch(e){ window.showToast('Error saving note','error'); }
}

export async function deleteContactNote(contactId, noteId){
  if(!window.requirePerm('delete','You don\'t have permission to delete records')) return;
  const c = window.contacts.find(x=>x.id===contactId); if(!c) return;
  if(!confirm('Delete this note? This cannot be undone.')) return;
  c.notes = (c.notes||[]).filter(n=>n.id!==noteId);
  renderContactNotes(contactId);
  try {
    await window.sb.patch('contacts', contactId, { notes:c.notes });
    window.showToast('Note deleted');
  } catch(e){ window.showToast('Error deleting note','error'); }
}

window.__nlmContactsNotesLoaded = true;
