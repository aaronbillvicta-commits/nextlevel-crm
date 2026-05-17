// NLM CRM - contact CSV import flow
//
// MIGRATION NOTE (step 8c of the modular extraction):
// Third file in src/contacts/. Strangler-fig: this module duplicates the three
// CSV import functions from index.html (lines ~11122, ~11202, ~11239) plus the
// module-scoped `_csvImportRows` staging variable. Nothing imports from it
// yet; the inline copies are still authoritative for every callsite.
//
// Roadmap (per saved memory `target-layout-decision` and CONTINUE-HERE):
//   8a. helpers.js        DONE 601d472
//   8b. notes.js          DONE 8697d85
//   8c. import-export.js  <- this file (openImportContacts + CSV import flow)
//   8d. index.js          (renderContacts + table + filters + sort + modals + state)
//
// Export side note: `exportContactsCSV` + `contactsToCSV` live in helpers.js
// (step 8a), NOT here. They were grouped with the other small pure helpers in
// 8a because they're tiny and have no dependencies; this file is reserved for
// the heavier import flow that mutates state and depends on bulk-action infra.
// "import-export" in the filename describes intent more than current contents.
//
// ADAPTATIONS FROM VERBATIM (every bare identifier in module scope that refers
// to an inline-only global):
// - `openModal`                 -> `window.openModal`
// - `closeModal`                -> `window.closeModal`
// - `showToast`                 -> `window.showToast`
// - `sanitizeText`              -> `window.sanitizeText`
// - `sanitizeHtml`              -> `window.sanitizeHtml`
// - `contacts`                  -> `window.contacts`
// - `sb`                        -> `window.sb`
// - `getMasterTag`              -> `window.getMasterTag`
// - `ensureMasterTag`           -> `window.ensureMasterTag`
// - `startBulkAction`           -> `window.startBulkAction`
// - `finishBulkAction`          -> `window.finishBulkAction`
// - `renderContacts`            -> `window.renderContacts`
// - `renderContactTagFilters`   -> `window.renderContactTagFilters`
// - `renderTagsPage`            -> `window.renderTagsPage`
//
// References inside `onclick="..."` attribute strings (closeModal,
// confirmCSVImport) are LEFT BARE because those strings are parsed at
// click-time by the HTML parser and resolve via window from the inline
// hoisted-function declarations.
//
// The hidden file input at index.html:1496 wires `onchange="handleCSVImport
// (event)"` to the INLINE handleCSVImport. So the module's handleCSVImport is
// dormant unless something explicitly calls it. Same with confirmCSVImport
// (wired via the import button's onclick string).
//
// STATE NOTE: `_csvImportRows` is module-scoped, separate from the inline
// `let _csvImportRows = []`. They cannot collide because nothing in the
// running app calls the module's handleCSVImport - the file input's onchange
// resolves to the inline one. When callsites migrate to import from this
// module, the inline copy can be deleted (and the inline _csvImportRows with
// it) without breaking anything.

let _csvImportRows = [];

export function openImportContacts(){
  window.openModal(`
    <div class="modal-head"><div class="modal-title">Import Contacts from CSV</div><span class="modal-close" onclick="closeModal()">×</span></div>
    <div class="modal-body">
      <div style="background:var(--accent-bg);border:1px solid var(--accent-border);border-radius:var(--radius);padding:14px;margin-bottom:16px;font-size:12px;color:var(--accent2);line-height:1.8">
        <strong>Required CSV columns:</strong> <code>name</code><br>
        <strong>Optional columns:</strong> <code>email, phone, company, source, status, tags</code><br>
        <strong>Tags column:</strong> separate multiple tags with a pipe <code>|</code> e.g. <code>VIP|Hot Lead</code><br>
        <strong>Status values:</strong> new, active, hot, cold, done
      </div>
      <div class="soc-image-drop" onclick="document.getElementById('csv-import-input').click()" style="margin-bottom:12px">
        📎 Click to select your CSV file
        <div style="font-size:11px;margin-top:4px;color:var(--text3)">.csv files only</div>
      </div>
      <div id="import-preview" style="display:none">
        <div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:8px" id="import-preview-title"></div>
        <div class="tbl-wrap" style="max-height:200px;overflow-y:auto" id="import-preview-table"></div>
      </div>
      <div style="margin-top:8px">
        <a href="data:text/csv;charset=utf-8,name,email,phone,company,source,status,tags%0AJuan dela Cruz,juan@example.com,+63 912 000 0000,Santos Bakery,Facebook,hot,VIP|Hot Lead" download="contacts-template.csv" style="font-size:11px;color:var(--accent2)">⬇ Download CSV template</a>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="import-confirm-btn" style="display:none" onclick="confirmCSVImport()">Import Contacts</button>
    </div>`);
  document.getElementById('csv-import-input').click();
}

export function handleCSVImport(e){
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ev=>{
    const text = ev.target.result;
    const rows = text.trim().split('\n').map(r=>r.split(',').map(c=>c.trim().replace(/^"|"$/g,'')));
    if(rows.length<2){ window.showToast('CSV is empty or invalid','error'); return; }
    const headers = rows[0].map(h=>h.toLowerCase().trim());
    const data = rows.slice(1).map(row=>{
      const obj={};
      headers.forEach((h,i)=>obj[h]=window.sanitizeText(row[i]||''));
      return obj;
    }).filter(r=>r.name);

    _csvImportRows = data;
    // Show preview
    const previewEl = document.getElementById('import-preview');
    const titleEl   = document.getElementById('import-preview-title');
    const tableEl   = document.getElementById('import-preview-table');
    const btnEl     = document.getElementById('import-confirm-btn');
    if(!previewEl||!titleEl||!tableEl) return;
    titleEl.textContent = `${data.length} contacts found in CSV`;
    previewEl.style.display='block';
    if(btnEl) btnEl.style.display='inline-flex';
    tableEl.innerHTML=`<table><thead><tr><th>Name</th><th>Email</th><th>Company</th><th>Tags</th><th>Status</th></tr></thead>
    <tbody>${data.slice(0,8).map(r=>`<tr>
      <td>${window.sanitizeHtml(r.name)}</td>
      <td style="font-size:11px;font-family:'DM Mono',monospace">${window.sanitizeHtml(r.email)||'—'}</td>
      <td>${window.sanitizeHtml(r.company)||'—'}</td>
      <td>${window.sanitizeHtml(r.tags)||'—'}</td>
      <td>${window.sanitizeHtml(r.status)||'new'}</td>
    </tr>`).join('')}${data.length>8?`<tr><td colspan="5" style="text-align:center;color:var(--text3);font-size:11px">…and ${data.length-8} more</td></tr>`:''}</tbody></table>`;
  };
  reader.readAsText(file);
  e.target.value=''; // reset so same file can be re-selected
}

export async function confirmCSVImport(){
  if(!_csvImportRows.length){ window.showToast('No data to import','error'); return; }
  const btn = document.getElementById('import-confirm-btn');
  if(btn){ btn.textContent='Importing…'; btn.disabled=true; }

  const _importEntry = window.startBulkAction('Import', `Import ${_csvImportRows.length} row${_csvImportRows.length>1?'s':''} from CSV`);
  let imported=0, skipped=0;
  const defaultCls = ['tag-blue','tag-green','tag-amber','tag-pink','tag-purple','tag-teal'];

  for(const row of _csvImportRows){
    // Skip if contact with same email already exists
    if(row.email && window.contacts.some(c=>c.email===row.email)){ skipped++; continue; }
    const tags = (row.tags||'').split('|').map(s=>s.trim()).filter(Boolean).map((label,i)=>{
      const existing = window.getMasterTag(label);
      const cls = existing?.cls || defaultCls[i%defaultCls.length];
      window.ensureMasterTag(label, cls);
      return { label, cls };
    });
    try {
      const res = await window.sb.post('contacts',{
        name:row.name, email:row.email||'', phone:row.phone||'',
        company:row.company||'', source:row.source||'Import',
        status:['new','active','hot','cold','done'].includes(row.status)?row.status:'new',
        tags, custom_fields:{}
      });
      window.contacts.unshift({...res[0], tags, customFields:{}});
      imported++;
    } catch(e){ skipped++; }
  }
  _csvImportRows=[];
  window.closeModal();
  window.renderContacts();
  window.renderContactTagFilters();
  window.renderTagsPage();
  window.finishBulkAction(_importEntry, skipped===0?'Complete':'Partial', `${imported} imported${skipped?`, ${skipped} skipped (duplicates)`:''}`);
  window.showToast(`✅ Imported ${imported} contacts${skipped?` (${skipped} skipped)`:''}`);
}

window.__nlmContactsImportExportLoaded = true;
