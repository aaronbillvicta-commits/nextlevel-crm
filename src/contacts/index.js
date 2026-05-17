// NLM CRM - contacts main index (renderContacts + table + modals + cell-edit)
//
// MIGRATION NOTE (step 8g of the modular extraction):
// SEVENTH and FINAL file of src/contacts/. Strangler-fig: this module
// duplicates the central contacts UI surface from index.html (~lines 4534-5364,
// 10 functions). Nothing imports from it yet; the inline copies remain
// authoritative for every callsite. The "after" picture once 8g lands is:
// src/contacts/ contains the full ~75 functions verbatim-copied from
// index.html, ready for the callsite-migration phase that comes next.
//
// Roadmap (per saved memory `target-layout-decision` and CONTINUE-HERE):
//   8a-c.  helpers/notes/import-export   DONE
//   8d-prep. state mirror                DONE 21043c1
//   8d.    filters.js                    DONE 264e52c
//   8e.    selection.js                  DONE ba14361
//   8f.    column-customizer.js          DONE 9d3b701
//   8g.    index.js                      <- this file (last of src/contacts/)
//
// Four state-mirror entries added inline as part of this step:
// `contactCustomFields`, `TAG_COLORS`, `conversations`, `emailStore`.
//
// SCOPE (10 functions, verbatim-copied):
// - editCustomCell, saveCustomCell  (inline cell-edit on the contacts table)
// - renderContactTableHeader, clearAllContactFilters
// - renderContacts                  (main orchestrator; reads filters/sort/columns)
// - renderContactTable              (one-liner wrapper)
// - openContactModal                (new/edit contact modal, 3 tabs: info/tags/custom)
// - openContactSettingsModal        (Statuses & Sources admin)
// - openContactDetail               (right-side drawer with 4 tabs: info/pipeline/tags/activity)
// - addUnknownNumberToContacts      (shim: opens the contact modal pre-filled with a phone number)
//
// ADAPTATIONS FROM VERBATIM:
//
// State (via the window.* mirror; declared `let`/`const` inline so not on window
// automatically):
// - `contacts`, `pipelines`, `sb`, `masterTags`
// - `contactSources`, `contactStatuses`, `contactSort`
// - `customColumns`, `visibleColumns`, `selectedContactIds`
// - `activeContactTagFilters`, `activeSourceFilters`, `activePipelineFilter`
// - `contactCustomFields`, `TAG_COLORS`, `conversations`, `emailStore`
//
// Inline `function foo(){}` declarations resolve via the global object even
// from module scope, but the established pattern in this codebase is to
// prefix them with `window.*` for clarity and debugging. Functions used:
// - UI: `showToast`, `openModal`, `closeModal`, `closeModalForce`, `icon`,
//   `formatCurrency`, `getCurrencySymbol`, `getAv`, `initials`, `splitName`
// - Helpers: `requirePerm`, `getStatusMeta`, `fmtLastActivity`,
//   `getAllCols`, `getMasterTag`, `ensureMasterTag`, `sortContactList`,
//   `renderContactTagFilters`, `syncBulkActionBar`, `updateSourceLabel`,
//   `updatePipelineLabel`
// - Notes/calendar: `migrateContactNotes`, `renderContactNotes`,
//   `renderContactFollowupsHTML`
// - Calling: `cleanCallerNumber`, `closeDetail`
// - Settings rows: `csStatusRowHTML`, `csSourceRowHTML`
//
// References inside `onclick="..."` attribute strings (saveCustomCell,
// renderContacts, toggleSelectAllContacts, setContactSort, closeModalForce,
// removeTagFromContact, quickAddTagToContact, selectTagColor, addTagToContact,
// saveContact, closeModal, csAddStatus, csAddSource, csSaveSettings,
// addContactNote, saveContactDetail, openComposeEmail, openConvWithContact,
// closeDetail, initiateCall, updateDetailStages, addContactToPipeline,
// openFollowupModal, openContactDetail, openContactModal, editCustomCell,
// toggleContactSelection, clearAllContactFilters) are LEFT BARE - those
// strings are parsed at click-time by the HTML parser and resolve via window
// from the inline hoisted-function declarations.
//
// Module-local function refs (defined here, called bare from within the
// module): `renderContacts`, `renderContactTableHeader`, `openContactModal`,
// `openContactDetail`. The same names also exist inline; lookup in module
// scope resolves to the module's exports first, so module bodies stay
// self-consistent. Inline copies handle every HTML-attribute click-time
// resolution.

// ───────────────── INLINE CELL EDIT (custom columns on the contacts table) ─────────────────

export function editCustomCell(contactId, colId, currentVal, type, options){
  const c = window.contacts.find(x=>x.id===contactId); if(!c) return;
  if(!c.customFields) c.customFields={};

  let input;
  if(type==='select'){
    const opts = options.map(o=>`<option value="${o}" ${o===currentVal?'selected':''}>${o}</option>`).join('');
    input = `<select onchange="saveCustomCell('${contactId}','${colId}',this.value)" onblur="renderContacts()" style="background:var(--bg3);border:1px solid var(--accent);border-radius:4px;color:var(--text);padding:2px 6px;font-size:11px;font-family:inherit">
      <option value="">—</option>${opts}
    </select>`;
  } else if(type==='date'){
    input = `<input type="date" value="${currentVal||''}" onchange="saveCustomCell('${contactId}','${colId}',this.value)" onblur="renderContacts()" style="background:var(--bg3);border:1px solid var(--accent);border-radius:4px;color:var(--text);padding:2px 6px;font-size:11px;font-family:inherit"/>`;
  } else {
    input = `<input type="${type==='number'?'number':'text'}" value="${currentVal||''}" onchange="saveCustomCell('${contactId}','${colId}',this.value)" onblur="renderContacts()" onkeydown="if(event.key==='Enter')saveCustomCell('${contactId}','${colId}',this.value)" style="background:var(--bg3);border:1px solid var(--accent);border-radius:4px;color:var(--text);padding:2px 6px;font-size:11px;font-family:inherit;width:100px" autofocus/>`;
  }

  const cell = document.getElementById('custom-cell-'+contactId+'-'+colId);
  if(cell){ cell.innerHTML=input; cell.querySelector('input,select')?.focus(); }
}

export async function saveCustomCell(contactId, colId, value){
  const c = window.contacts.find(x=>x.id===contactId); if(!c) return;
  if(!c.customFields) c.customFields={};
  c.customFields[colId] = value;
  try { await window.sb.patch('contacts', contactId, {custom_fields: c.customFields}); }
  catch(e){ console.warn('Custom field save error',e); }
}

// ───────────────── TABLE HEADER WITH SORT ARROWS ─────────────────

export function renderContactTableHeader(){
  const tr = document.querySelector('#contacts-table thead tr'); if(!tr) return;
  const cols = window.getAllCols().filter(c=>c.required||window.visibleColumns.includes(c.id));
  const selectAllCell = `<th style="width:28px;padding-left:10px;padding-right:0">
    <input type="checkbox" id="contact-select-all" onchange="toggleSelectAllContacts(this.checked)" title="Select all visible" style="cursor:pointer"/>
  </th>`;
  tr.innerHTML = selectAllCell + cols.map(c=>{
    if(!c.sortable) return `<th>${c.label}</th>`;
    const isActive = window.contactSort.col===c.id;
    const arrow = isActive
      ? (window.contactSort.dir==='asc' ? '<span style="color:var(--accent2)">↑</span>' : '<span style="color:var(--accent2)">↓</span>')
      : '<span style="opacity:.25;font-size:10px">↕</span>';
    return `<th onclick="setContactSort('${c.id}')" style="cursor:pointer;user-select:none;white-space:nowrap">
      ${c.label} ${arrow}
    </th>`;
  }).join('') + '<th></th>';
}

export function clearAllContactFilters(){
  window.activeSourceFilters.clear(); window.activePipelineFilter=null; window.activeContactTagFilters.clear();
  const si=document.getElementById('contact-search'); if(si) si.value='';
  window.updateSourceLabel(); window.updatePipelineLabel(); window.renderContactTagFilters(); renderContacts();
}

// ───────────────── RENDER CONTACTS TABLE ─────────────────

export function renderContacts(){
  renderContactTableHeader();
  const tbody=document.getElementById("contacts-tbody");
  const q=(document.getElementById("contact-search")?.value||"").toLowerCase();
  const activeTags=[...window.activeContactTagFilters];
  let pipelineContactIds=null;
  if(window.activePipelineFilter){
    pipelineContactIds=new Set();
    const pl=window.pipelines.find(p=>p.id===window.activePipelineFilter.pipelineId);
    if(pl){pl.deals.filter(d=>d.stage===window.activePipelineFilter.stageId).forEach(d=>{
      if(d.contactId)pipelineContactIds.add(d.contactId);
      window.contacts.filter(c=>c.name===d.name||(c.company&&c.company===d.company)).forEach(c=>pipelineContactIds.add(c.id));
    });}
  }
  let filtered=window.contacts.filter(c=>{
    const ms=!q||(c.name||"").toLowerCase().includes(q)||(c.company||"").toLowerCase().includes(q)||(c.email||"").toLowerCase().includes(q)||(c.phone||"").toLowerCase().includes(q);
    const mt=activeTags.length===0||activeTags.every(tag=>(c.tags||[]).some(t=>t.label===tag));
    const msrc=window.activeSourceFilters.size===0||window.activeSourceFilters.has(c.source||"Other");
    const mp=!pipelineContactIds||pipelineContactIds.has(c.id);
    return ms&&mt&&msrc&&mp;
  });
  document.getElementById("contact-count-label").textContent=`(${window.contacts.length})`;
  const summaryEl=document.getElementById("contact-filter-summary");
  if(summaryEl){
    const parts=[];
    if(q)parts.push(`"${q}"`);
    if(activeTags.length)parts.push("tags: "+activeTags.join(", "));
    if(window.activeSourceFilters.size)parts.push("source: "+[...window.activeSourceFilters].join(", "));
    if(window.activePipelineFilter)parts.push("pipeline: "+window.activePipelineFilter.label);
    if(parts.length){summaryEl.style.display="block";summaryEl.innerHTML=`<strong>${filtered.length}</strong> of ${window.contacts.length} · ${parts.join(" · ")} <span onclick="clearAllContactFilters()" style="margin-left:8px;cursor:pointer;opacity:.7">✕ Clear all</span>`;}
    else summaryEl.style.display="none";
  }
  // Apply sort
  filtered = window.sortContactList(filtered);
  const cols = window.getAllCols().filter(c=>c.required||window.visibleColumns.includes(c.id)).map(c=>c.id);
  const totalCols=cols.length+2; // +1 actions column, +1 select column
  if(filtered.length===0){
    tbody.innerHTML=`<tr><td colspan="${totalCols}" style="text-align:center;color:var(--text3);padding:32px">${(q||activeTags.length||window.activeSourceFilters.size||window.activePipelineFilter)?"No contacts match your filters":"No contacts yet — add your first one!"}</td></tr>`;
    window.renderContactTagFilters();window.syncBulkActionBar();return;
  }
  // Track visible contact IDs for the select-all checkbox
  window._visibleContactIds = filtered.map(c=>c.id);
  tbody.innerHTML=filtered.map(c=>{
    const deals=[];
    window.pipelines.forEach(p=>{p.deals.filter(d=>d.name===c.name||(c.email&&d.company===c.company)||d.contactId===c.id).forEach(d=>{const stage=p.stages.find(s=>s.id===d.stage);deals.push({pName:p.name,sLabel:stage?.label||"—"});});});
    const pipelineCell=deals.length?`<div style="line-height:1.3"><div style="font-size:11px;font-weight:500;color:var(--accent2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px">${deals[0].sLabel}</div><div style="font-size:10px;color:var(--text3)">${deals[0].pName}</div></div>`:`<span style="font-size:11px;color:var(--text3)">—</span>`;
    const created=c.created_at?new Date(c.created_at).toLocaleDateString([],{month:"short",day:"numeric",year:"numeric"}):"-";
    const lastAct = c.last_activity ? window.fmtLastActivity(c.last_activity) : '<span style="opacity:.4">—</span>';
    const stMeta = window.getStatusMeta(c.status);
    // Build custom column cells
    const customCells={};
    window.customColumns.forEach(col=>{
      const val=(c.customFields||{})[col.id]||'';
      const optStr=col.options?JSON.stringify(col.options):'[]';
      customCells[col.id]=`<td id="custom-cell-${c.id}-${col.id}" onclick="editCustomCell('${c.id}','${col.id}','${val.replace(/'/g,"\\'")}','${col.type}',${optStr})" style="cursor:pointer;min-width:80px;color:${val?'var(--text2)':'var(--text3)'};font-size:12px" title="Click to edit">
        ${val||'<span style="opacity:.4">—</span>'}
      </td>`;
    });
    const cm={
      name:`<td><div class="td-name" onclick="openContactDetail('${c.id}')" style="cursor:pointer" title="View ${c.name}"><div class="av-sm ${window.getAv(c.id)}">${window.initials(c.name)}</div><span style="color:var(--text);font-weight:500">${c.name}</span></div></td>`,
      company:`<td style="color:var(--text2)">${c.company||"-"}</td>`,
      email:`<td><div style="display:flex;align-items:center;gap:5px"><span style="color:var(--text3);font-family:'DM Mono',monospace;font-size:11px">${c.email||'—'}</span>${c.email?`<button class="btn-email-inline" onclick="openComposeEmail('${c.id}')" title="Email ${c.name}"><svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></button>`:''}</div></td>`,
      phone:`<td><div style="display:flex;align-items:center;gap:5px"><span style="color:var(--text3);font-family:'DM Mono',monospace;font-size:11px">${c.phone||'—'}</span>${c.phone?`<button class="btn-call-inline" onclick="initiateCall('${c.id}','${c.phone.replace(/'/g,"\\'")}','${c.name.replace(/'/g,"\\'")}')"><svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.5a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2.69h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 10.09a16 16 0 0 0 6 6l1.46-1.46a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg></button>`:''}</div></td>`,
      source:`<td><span class="tag tag-blue" style="font-size:10px">${c.source||"Other"}</span></td>`,
      tags:`<td><div class="tags-cell">${(c.tags||[]).map(t=>`<span class="tag ${t.cls}">${t.label}</span>`).join("")}<span class="tag-add-inline" onclick="openContactModal('${c.id}','tags')">+</span></div></td>`,
      status:`<td><span class="pill ${stMeta.color}">${stMeta.label}</span></td>`,
      pipeline:`<td>${pipelineCell}</td>`,
      created:`<td style="font-size:11px;color:var(--text3)">${created}</td>`,
      lastActivity:`<td style="font-size:11px;color:var(--text3)">${lastAct}</td>`,
      ...customCells
    };
    const isSelected = window.selectedContactIds.has(c.id);
    const selCell = `<td style="width:28px;padding-left:10px;padding-right:0">
      <input type="checkbox" class="contact-row-checkbox" data-id="${c.id}" ${isSelected?'checked':''} onclick="event.stopPropagation()" onchange="toggleContactSelection('${c.id}', this.checked)" style="cursor:pointer"/>
    </td>`;
    return `<tr ${isSelected?'class="row-selected"':''}>${selCell}${cols.map(id=>cm[id]||"<td>—</td>").join("")}<td style="white-space:nowrap"><button class="btn btn-sm" onclick="openContactDetail('${c.id}')">View</button> <button class="btn btn-sm" style="font-size:11px" onclick="openConvWithContact('${c.id}')">💬</button></td></tr>`;
  }).join("");
  window.renderContactTagFilters();
  window.syncBulkActionBar();
}

export function renderContactTable(){renderContacts();}

// ───────────────── CONTACT MODAL (new / edit) ─────────────────

export function openContactModal(contactId=null, tab='info') {
  const isEdit = !!contactId;
  const c = isEdit ? window.contacts.find(x=>x.id===contactId) : {id:'',name:'',first_name:'',last_name:'',company:'',email:'',phone:'',source:(window.contactSources[0]||'Other'),status:(window.contactStatuses[0]?.value||'new'),tags:[],customFields:{}};
  if(!c) return;
  // Backfill first/last from legacy name field when editing an older contact
  if(isEdit && !c.first_name && !c.last_name && c.name){
    const sp = window.splitName(c.name);
    c.first_name = sp.first; c.last_name = sp.last;
  }

  const tabLabels = {info:'Info',tags:'Tags',custom:'Custom Fields'};
  const tabs = ['info','tags','custom'].map(t =>
    `<div class="modal-tab ${tab===t?'active':''}" onclick="openContactModal('${contactId||''}','${t}')">${tabLabels[t]}</div>`
  ).join('');

  let body = '';
  if(tab==='info') {
    body = `
      <div class="form-row">
        <div class="form-group"><label class="form-label">First Name</label><input class="form-input" id="cf-first-name" value="${(c.first_name||'').replace(/"/g,'&quot;')}" placeholder="Maria"/></div>
        <div class="form-group"><label class="form-label">Last Name</label><input class="form-input" id="cf-last-name" value="${(c.last_name||'').replace(/"/g,'&quot;')}" placeholder="Santos"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Company</label><input class="form-input" id="cf-company" value="${(c.company||'').replace(/"/g,'&quot;')}" placeholder="Santos Bakery"/></div>
        <div class="form-group"><label class="form-label">Phone</label><input class="form-input" id="cf-phone" value="${(c.phone||'').replace(/"/g,'&quot;')}" placeholder="+1 555 000 0000"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Email</label><input class="form-input" id="cf-email" type="email" value="${(c.email||'').replace(/"/g,'&quot;')}" placeholder="email@example.com"/></div>
        <div class="form-group"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Lead Source</label>
          <select class="form-select" id="cf-source">
            ${window.contactSources.map(s=>`<option ${c.source===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label class="form-label">Status</label>
          <select class="form-select" id="cf-status">
            ${window.contactStatuses.map(s=>`<option value="${s.value}" ${c.status===s.value?'selected':''}>${s.label}</option>`).join('')}
          </select>
        </div>
      </div>`;
  } else if(tab==='tags') {
    body = `
      <div class="modal-section">
        <div class="modal-section-title">Current Tags</div>
        <div class="tags-manager" id="tags-manager-box">
          ${(c.tags||[]).map((t,i)=>`<span class="tag ${t.cls}">${t.label}<span class="tag-remove" onclick="removeTagFromContact('${c.id}',${i})">×</span></span>`).join('')}
          ${(!c.tags||c.tags.length===0)?'<span style="font-size:12px;color:var(--text3)">No tags yet</span>':''}
        </div>
      </div>
      <div class="modal-section">
        <div class="modal-section-title">Add from existing tags</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px">
          ${window.masterTags.filter(mt=>!(c.tags||[]).some(t=>t.label===mt.label)).map(mt=>`
            <span class="tag ${mt.cls}" style="cursor:pointer;opacity:.7;transition:opacity .15s"
              onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='.7'"
              onclick="quickAddTagToContact('${c.id}','${mt.label}','${mt.cls}')">${mt.label} +</span>`).join('')}
          ${window.masterTags.filter(mt=>!(c.tags||[]).some(t=>t.label===mt.label)).length===0?'<span style="font-size:11px;color:var(--text3)">All tags already applied</span>':''}
        </div>
        <div class="modal-section-title">Or create new tag</div>
        <div class="tag-input-wrap">
          <input class="tag-input" id="new-tag-input" placeholder="New tag label…" onkeydown="if(event.key==='Enter')addTagToContact('${c.id}')"/>
          <button class="btn btn-sm btn-primary" onclick="addTagToContact('${c.id}')">Add</button>
        </div>
        <div class="tag-color-pick" id="tag-color-pick">
          ${window.TAG_COLORS.map((tc,i)=>`<div class="tag-color-dot ${i===0?'selected':''}" data-cls="${tc.cls}" onclick="selectTagColor(this)"></div>`).join('')}
        </div>
      </div>`;
  } else if(tab==='custom') {
    body = `<div class="modal-section">
      <div class="modal-section-title">Custom Fields</div>
      ${window.contactCustomFields.map(f=>`
        <div class="form-group"><label class="form-label">${f.name} <span style="color:var(--text3);font-weight:400">(${f.type})</span></label>
          ${f.type==='dropdown'
            ?`<select class="form-select" id="cfc-${f.id}"><option value="">— select —</option>${(f.options||[]).map(o=>`<option ${(c.customFields||{})[f.id]===o?'selected':''}>${o}</option>`).join('')}</select>`
            :`<input class="form-input" id="cfc-${f.id}" value="${(c.customFields||{})[f.id]||''}" placeholder="Enter ${f.name.toLowerCase()}…"/>`}
        </div>`).join('')}
      ${window.contactCustomFields.length===0?'<div style="font-size:13px;color:var(--text3)">No custom fields yet. Go to Custom Fields in the sidebar to add some.</div>':''}
    </div>`;
  }

  window.openModal(`
    <div class="modal-head">
      <div><div class="modal-title">${isEdit?'Edit: '+c.name:'Add New Contact'}</div>
      <div class="modal-tabs">${tabs}</div></div>
      <span class="modal-close" onclick="closeModalForce()" title="Close">×</span>
    </div>
    <div class="modal-body">${body}</div>
    <div class="modal-foot">
      ${isEdit?`<button class="btn btn-sm" onclick="saveContact('${c.id||''}','${tab}',true)" style="color:var(--green);border-color:rgba(0,229,160,.3);display:inline-flex;align-items:center;gap:6px">${window.icon('save')} Save &amp; Keep Open</button>`:''}
      <button class="btn" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" onclick="saveContact('${c.id||''}','${tab}')">${isEdit?'Save &amp; Close':'Add Contact'}</button>
    </div>`);

  // Lock modal — won't close on outside click when editing
  if(isEdit) window._modalLocked = true;

  // Set tag color dots
  if(tab==='tags') {
    const colorMap = {blue:'#4f7ef8',green:'#3ecf8e',amber:'#f59e3f',pink:'#d97bba',purple:'#a78bfa',teal:'#2dd4bf',red:'#f26b6b',gray:'#555a6e'};
    document.querySelectorAll('.tag-color-dot').forEach(dot => {
      const cls = dot.dataset.cls.replace('tag-','');
      dot.style.background = colorMap[cls]||'#888';
    });
  }
}

// ───────────────── CONTACT SETTINGS MODAL (Statuses & Sources admin) ─────────────────

export function openContactSettingsModal(){
  window.openModal(`
    <div class="modal-head">
      <div class="modal-title">Contact Settings</div>
      <span class="modal-close" onclick="closeModal()">×</span>
    </div>
    <div class="modal-body">
      <div class="modal-section-title">Statuses</div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:10px;line-height:1.5">Add, rename, recolor, or remove the status options shown in contact forms. Renaming keeps existing contacts' status intact.</div>
      <div id="cs-status-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px"></div>
      <button class="btn btn-sm" onclick="csAddStatus()">+ Add Status</button>

      <div class="modal-section-title" style="margin-top:22px">Sources</div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:10px;line-height:1.5">Lead source options shown in contact forms and the Source filter.</div>
      <div id="cs-source-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px"></div>
      <button class="btn btn-sm" onclick="csAddSource()">+ Add Source</button>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="csSaveSettings()">Save Settings</button>
    </div>
  `);
  document.getElementById('cs-status-list').innerHTML = window.contactStatuses.map(window.csStatusRowHTML).join('');
  document.getElementById('cs-source-list').innerHTML = window.contactSources.map(window.csSourceRowHTML).join('');
}

// ───────────────── CONTACT DETAIL DRAWER (right-side, 4 tabs) ─────────────────

export function openContactDetail(contactId, tab='info') {
  const c = window.contacts.find(x=>x.id===contactId); if(!c) return;
  const avCls = window.getAv(contactId);
  const avClr = {'av-pink':'var(--pink)','av-blue':'var(--accent2)','av-amber':'var(--amber)','av-green':'var(--green)','av-purple':'var(--purple)'}[avCls]||'var(--accent2)';
  const avBg  = {'av-pink':'var(--pink-bg)','av-blue':'var(--accent-bg)','av-amber':'var(--amber-bg)','av-green':'var(--green-bg)','av-purple':'var(--purple-bg)'}[avCls]||'var(--accent-bg)';

  // Tab content
  let body = '';

  if(tab==='info'){
    // Backfill first/last from legacy name when needed
    if(!c.first_name && !c.last_name && c.name){
      const sp = window.splitName(c.name);
      c.first_name = sp.first; c.last_name = sp.last;
    }
    window.migrateContactNotes(c);
    body = `
      <div class="form-row">
        <div class="form-group"><label class="form-label">First Name</label>
          <input class="form-input" id="cd-first-name" value="${(c.first_name||'').replace(/"/g,'&quot;')}" placeholder="Maria"/></div>
        <div class="form-group"><label class="form-label">Last Name</label>
          <input class="form-input" id="cd-last-name" value="${(c.last_name||'').replace(/"/g,'&quot;')}" placeholder="Santos"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Company</label>
          <input class="form-input" id="cd-company" value="${(c.company||'').replace(/"/g,'&quot;')}" placeholder="Santos Bakery"/></div>
        <div class="form-group"><label class="form-label">Phone</label>
          <input class="form-input" id="cd-phone" value="${(c.phone||'').replace(/"/g,'&quot;')}" placeholder="+63 912 000 0000"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Email</label>
          <input class="form-input" id="cd-email" type="email" value="${(c.email||'').replace(/"/g,'&quot;')}" placeholder="email@example.com"/></div>
        <div class="form-group"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Source</label>
          <select class="form-select" id="cd-source">
            ${window.contactSources.map(s=>`<option ${(c.source||'')==s?'selected':''}>${s}</option>`).join('')}
          </select></div>
        <div class="form-group"><label class="form-label">Status</label>
          <select class="form-select" id="cd-status">
            ${window.contactStatuses.map(s=>`<option value="${s.value}" ${c.status===s.value?'selected':''}>${s.label}</option>`).join('')}
          </select></div>
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <div style="display:flex;gap:6px;margin-bottom:10px;align-items:flex-start">
          <textarea class="form-input" id="cd-new-note" placeholder="Write a note… (2-3 sentences)" style="flex:1;min-height:54px;resize:vertical;font-family:inherit"></textarea>
          <button class="btn btn-primary btn-sm" onclick="addContactNote('${contactId}')" style="flex-shrink:0">+ Add Note</button>
        </div>
        <div id="cd-notes-list"></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="saveContactDetail('${contactId}')" style="display:inline-flex;align-items:center;gap:6px">${window.icon('save')} Save Changes</button>
        <button class="btn btn-sm" style="color:var(--green);display:inline-flex;align-items:center;gap:6px" onclick="openComposeEmail('${contactId}')">${window.icon('mail')} Email</button>
        <button class="btn btn-sm" style="color:var(--accent2);display:inline-flex;align-items:center;gap:6px" onclick="openConvWithContact('${contactId}');closeDetail()">${window.icon('message')} Message</button>
        ${c.phone?`<button class="btn btn-sm" style="color:var(--green);display:inline-flex;align-items:center;gap:6px" onclick="initiateCall('${contactId}','${c.phone.replace(/'/g,"\\'")}','${c.name.replace(/'/g,"\\'")}')">${window.icon('phone')} Call</button>`:''}
      </div>`;

  } else if(tab==='pipeline'){
    // Find existing deals for this contact
    const contactDeals = [];
    window.pipelines.forEach(p=>{
      p.deals.filter(d=>d.contactId===contactId||d.name===c.name||(c.company&&d.company===c.company)).forEach(d=>{
        const stage = p.stages.find(s=>s.id===d.stage);
        contactDeals.push({...d, pipelineName:p.name, stageName:stage?.label||'—', pipelineId:p.id});
      });
    });

    const pipelineOpts = window.pipelines.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
    const stageOpts = window.pipelines[0]?.stages.map(s=>`<option value="${s.id}">${s.label}</option>`).join('') || '';

    body = `
      <!-- Existing deals -->
      ${contactDeals.length ? `
        <div class="modal-section-title" style="margin-bottom:10px">Current Deals</div>
        ${contactDeals.map(d=>`
          <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:8px">
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:500;color:var(--text)">${d.name}</div>
              <div style="font-size:11px;color:var(--text3)">${d.pipelineName} → <span style="color:var(--accent2)">${d.stageName}</span></div>
            </div>
            <div style="font-size:12px;color:var(--green);font-weight:600">${window.formatCurrency(d.value||0)}</div>
          </div>`).join('')}
        <div style="border-top:1px solid var(--border);margin:14px 0"></div>
      ` : '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">No pipeline deals yet for this contact.</div>'}

      <!-- Add to pipeline -->
      <div class="modal-section-title" style="margin-bottom:10px">Add to Pipeline</div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Pipeline</label>
          <select class="form-select" id="cd-pipeline" onchange="updateDetailStages(this.value)">
            ${pipelineOpts||'<option value="">No pipelines yet</option>'}
          </select></div>
        <div class="form-group"><label class="form-label">Stage</label>
          <select class="form-select" id="cd-stage">${stageOpts}</select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Deal Name</label>
          <input class="form-input" id="cd-deal-name" value="${c.name}" placeholder="Deal name…"/></div>
        <div class="form-group"><label class="form-label">Value (${window.getCurrencySymbol()})</label>
          <input class="form-input" id="cd-deal-value" type="number" placeholder="0" value="0"/></div>
      </div>
      <button class="btn btn-primary" onclick="addContactToPipeline('${contactId}')">+ Add to Pipeline</button>`;

  } else if(tab==='tags'){
    body = `
      <div class="modal-section-title" style="margin-bottom:8px">Current Tags</div>
      <div class="tags-manager" id="cd-tags-box" style="min-height:36px;margin-bottom:16px">
        ${(c.tags||[]).map((t,i)=>`<span class="tag ${t.cls}">${t.label}<span class="tag-remove" onclick="removeTagFromContact('${contactId}',${i});openContactDetail('${contactId}','tags')">×</span></span>`).join('')}
        ${(!c.tags||!c.tags.length)?'<span style="font-size:12px;color:var(--text3)">No tags yet</span>':''}
      </div>
      <div class="modal-section-title" style="margin-bottom:8px">Add from master list</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">
        ${window.masterTags.filter(mt=>!(c.tags||[]).some(t=>t.label===mt.label)).map(mt=>`
          <span class="tag ${mt.cls}" style="cursor:pointer;opacity:.7;transition:opacity .15s"
            onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='.7'"
            onclick="quickAddTagToContact('${contactId}','${mt.label}','${mt.cls}');openContactDetail('${contactId}','tags')">${mt.label} +</span>`).join('')}
        ${window.masterTags.filter(mt=>!(c.tags||[]).some(t=>t.label===mt.label)).length===0?'<span style="font-size:11px;color:var(--text3)">All tags already applied</span>':''}
      </div>`;

  } else if(tab==='activity'){
    const conv = window.conversations.find(x=>x.contactId===contactId);
    const msgs = [...(conv?.messages||[])].reverse().slice(0,10);
    const sentEmails = window.emailStore.filter(e=>e.contactId===contactId||e.to===c.email).slice(0,5);
    body = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div class="modal-section-title" style="margin:0">Scheduled Follow-ups</div>
        <button class="btn btn-sm" style="font-size:11px;color:var(--accent2)" onclick="openFollowupModal('${contactId}')">+ Schedule follow-up</button>
      </div>
      <div id="cd-followups-list">${window.renderContactFollowupsHTML(contactId)}</div>
      <div style="border-top:1px solid var(--border);margin:16px 0"></div>
      <div class="modal-section-title" style="margin-bottom:10px">Recent Messages</div>
      ${msgs.length ? msgs.map(m=>{
        const d=new Date(m.ts);
        const timeStr=d.toLocaleDateString([],{month:'short',day:'numeric'})+' '+d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
        const icon = m.ch==='email'?'📧':'💬';
        const dir = m.dir==='inbound'?'←':'→';
        return `<div style="padding:8px 0;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:flex-start">
          <span style="font-size:14px;flex-shrink:0">${icon}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:11px;color:var(--text3)">${dir} ${timeStr} · <span style="color:var(--accent2)">${m.status||'sent'}</span></div>
            ${m.subject?`<div style="font-size:12px;font-weight:500;color:var(--text);margin-top:2px">${m.subject}</div>`:''}
            <div style="font-size:12px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${(m.body||'').slice(0,80)}</div>
          </div>
        </div>`;
      }).join('') : '<div style="font-size:12px;color:var(--text3)">No messages yet</div>'}
      <div style="margin-top:16px;display:flex;gap:8px">
        <button class="btn btn-sm btn-primary" onclick="openConvWithContact('${contactId}');closeDetail()">Open Conversation</button>
        <button class="btn btn-sm" onclick="openComposeEmail('${contactId}')">Compose Email</button>
      </div>`;
  }

  const tabs = [
    {id:'info',    label:`${window.icon('pencil')} Info`},
    {id:'pipeline',label:`${window.icon('pipeline')} Pipeline`},
    {id:'tags',    label:`${window.icon('tag')} Tags`},
    {id:'activity',label:`${window.icon('clock')} Activity`},
  ];

  document.getElementById('detail-drawer').innerHTML=`
    <div class="detail-head" style="flex-shrink:0">
      <div style="display:flex;align-items:center;gap:12px">
        <div class="detail-avatar" style="background:${avBg};color:${avClr}">${window.initials(c.name)}</div>
        <div>
          <div style="font-size:16px;font-weight:700;color:var(--text)">${c.name}</div>
          <div style="font-size:12px;color:var(--text3)">${c.company||''} ${c.source?'· '+c.source:''}</div>
        </div>
      </div>
      <span style="cursor:pointer;font-size:22px;color:var(--text3);line-height:1" onclick="closeDetail()">×</span>
    </div>
    <div style="display:flex;gap:0;border-bottom:1px solid var(--border);padding:0 16px;flex-shrink:0;overflow-x:auto">
      ${tabs.map(t=>`<div onclick="openContactDetail('${contactId}','${t.id}')"
        style="padding:10px 12px;font-size:12px;font-weight:500;cursor:pointer;border-bottom:2px solid ${tab===t.id?'var(--accent)':'transparent'};color:${tab===t.id?'var(--accent2)':'var(--text3)'};transition:all .15s;white-space:nowrap;flex-shrink:0">
        ${t.label}
      </div>`).join('')}
    </div>
    <div style="padding:16px;overflow-y:auto;flex:1;min-height:0">${body}</div>`;

  document.getElementById('detail-panel').classList.add('open');
  // Render the notes list (info tab only)
  if(tab==='info') window.renderContactNotes(contactId);
}

// ───────────────── ADD UNKNOWN NUMBER TO CONTACTS (shim) ─────────────────

export function addUnknownNumberToContacts(number){
  const clean = window.cleanCallerNumber(number);
  window.closeDetail();
  openContactModal();
  // Pre-fill the phone field once the modal is in the DOM
  setTimeout(()=>{
    const phoneInput = document.getElementById('cf-phone');
    if(phoneInput){ phoneInput.value = clean; phoneInput.focus(); }
    const firstNameInput = document.getElementById('cf-first-name');
    if(firstNameInput) firstNameInput.focus();
  }, 50);
}

window.__nlmContactsIndexLoaded = true;
