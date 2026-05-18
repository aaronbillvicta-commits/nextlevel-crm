// NLM CRM - pipelines admin (pipeline CRUD + deal CRUD + stages settings)
//
// MIGRATION NOTE (step 9c of the modular extraction):
// THIRD and FINAL file in src/pipelines/. Strangler-fig: this module
// duplicates the largest block of pipeline-side modal/CRUD logic from
// index.html (~lines 5757-6181, 28 functions covering pipeline CRUD modals,
// deal CRUD with detail/tag/save/delete, deal-name autocomplete, and the
// stages settings modal with its own stage-row drag-and-drop). Nothing
// imports from it yet; the inline copies remain authoritative for every
// callsite. The "after" picture once 9c lands: src/pipelines/ contains the
// full ~40 pipeline-surface functions verbatim-copied from index.html,
// ready for callsite migration in the next phase.
//
// Roadmap (per saved memory `target-layout-decision` and CONTINUE-HERE):
//   9a.  pipelines/index.js  (tabs + state)                  DONE 33cdf1a
//   9b.  pipelines/board.js  (kanban + DnD)                  DONE fe0cd75
//   9c.  pipelines/admin.js  (pipeline/deal/stages CRUD)     <- this file
//
// No new state-mirror entries needed. All inline state this module reads
// (pipelines, contacts, sb, activePipelineId, dealCustomFields, TAG_COLORS)
// was already bridged in earlier passes.
//
// SCOPE (28 functions verbatim-copied from index.html ~lines 5757-6181):
//
// Pipeline CRUD modals (8):
//   openPipelineModal, addStageRow, delStageRow, createPipeline,
//   editPipelineModal, savePipelineEdit, addStageRowTo, deletePipelineConfirm
//
// Deal CRUD (6):
//   addDeal, openDealDetail, removeDealTag, addDealTag, saveDeal, deleteDeal
//
// Deal-name autocomplete in the Add-Deal modal (4 + 1 state var):
//   dealContactInput, dealContactKey, pickDealContact, closeDealAC
//   + module-local _dealACIndex
//
// Stages settings modal + per-pipeline stage management (6 + 1 state var):
//   openPipelineStagesModal, renderSettingsPipeline, switchSettingsPl,
//   settingsAddStage, settingsSaveStages, settingsDeleteStage
//   + module-local settingsActivePl
//
// Stage-row drag-and-drop inside the stages settings modal (4 + 1 state var):
//   stageDragStart, stageDragOver, stageDrop, stageDragEnd
//   + module-local stageDragEl
//
// ADAPTATIONS FROM VERBATIM:
//
// State (via window.* mirror; all already bridged):
// - `pipelines`, `contacts`, `sb`, `activePipelineId`, `dealCustomFields`,
//   `TAG_COLORS`
//
// Inline function refs via window.*:
// - UI: `showToast`, `openModal`, `closeModal`, `formatCurrency`,
//   `getCurrencySymbol`, `requirePerm`, `getAv`, `initials`, `navigate`
// - Cross-module (other pipelines modules) via window.* — same pattern as 9b
//   (no real `import` until callsite migration):
//   `getActivePipeline`, `renderPipelineTabs`, `renderBoard`,
//   `refreshPipelineHeader`, `switchPipeline`
// - Contacts: `openContactDetail`
//
// Module-local refs called bare (defined here, called from within the
// module): `addStageRow`, `delStageRow`, `addStageRowTo`, `renderSettingsPipeline`,
// `closeDealAC`, `openDealDetail` (recursive from saveDeal/addDealTag/removeDealTag),
// plus three module-local DnD/autocomplete state vars (_dealACIndex,
// settingsActivePl, stageDragEl). The inline copies have their own state vars
// by the same names; they cannot collide because every callsite resolves to
// inline via window.* at click-time/event-time, so the module's state vars
// stay dormant.
//
// References inside `onclick="..."` / `ondrag*="..."` / `onkeydown="..."` /
// `oninput="..."` / `onblur="..."` attribute strings (closeModal, addStageRow,
// delStageRow, addStageRowTo, createPipeline, editPipelineModal,
// savePipelineEdit, deletePipelineConfirm, dealContactInput, dealContactKey,
// closeDealAC, pickDealContact, addDeal, openDealDetail, openContactDetail,
// navigate, removeDealTag, addDealTag, saveDeal, deleteDeal,
// settingsAddStage, settingsSaveStages, settingsDeleteStage, switchSettingsPl,
// stageDragStart, stageDragOver, stageDrop, stageDragEnd) are LEFT BARE
// because those strings are parsed at event-time and resolve via window from
// the inline hoisted-function declarations.

// ───────────────── PIPELINE CRUD MODALS ─────────────────

export function openPipelineModal(type){
  const pipeline = window.getActivePipeline();
  if(type==='new-pipeline'){
    window.openModal(`
      <div class="modal-head"><div class="modal-title">Create New Pipeline</div><span class="modal-close" onclick="closeModal()">×</span></div>
      <div class="modal-body">
        <div class="form-group"><label class="form-label">Pipeline Name</label><input class="form-input" id="np-name" placeholder="e.g. Referral Pipeline"/></div>
        <div class="form-group"><label class="form-label">Stages</label>
          <div class="stage-list" id="new-stage-list">
            ${['New Lead','Qualified','Proposal Sent','Closed Won'].map(s=>`<div class="stage-row"><span class="stage-grip">⠿</span><input class="stage-name-input" value="${s}"/><span class="stage-del-btn" onclick="delStageRow(this)">×</span></div>`).join('')}
          </div>
          <button class="add-stage-btn" onclick="addStageRow()">+ Add Stage</button>
        </div>
      </div>
      <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="createPipeline()">Create Pipeline</button></div>`);
  } else if(type==='new-deal'){
    if(!pipeline) return;
    const stageOpts = pipeline.stages.map(s=>`<option value="${s.id}">${s.label}</option>`).join('');
    window.openModal(`
      <div class="modal-head"><div class="modal-title">Add New Deal</div><span class="modal-close" onclick="closeModal()">×</span></div>
      <div class="modal-body">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Contact Name</label>
            <div class="ac-wrap">
              <input class="form-input" id="nd-name" placeholder="e.g. Maria Santos" autocomplete="off"
                oninput="dealContactInput(this.value)"
                onkeydown="dealContactKey(event)"
                onblur="setTimeout(()=>closeDealAC(),200)"/>
              <div class="ac-list" id="nd-name-ac"></div>
            </div>
            <input type="hidden" id="nd-contact-id"/>
          </div>
          <div class="form-group"><label class="form-label">Company</label><input class="form-input" id="nd-company" placeholder="e.g. Santos Bakery"/></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Value ($/mo)</label><input class="form-input" id="nd-value" type="number" placeholder="5000"/></div>
          <div class="form-group"><label class="form-label">Stage</label><select class="form-select" id="nd-stage">${stageOpts}</select></div>
        </div>
        <div class="form-group"><label class="form-label">Tag</label>
          <select class="form-select" id="nd-tag">
            <option value="tag-blue">SMM</option><option value="tag-amber">Ads</option>
            <option value="tag-green">Full Service</option><option value="tag-pink">Web Design</option><option value="tag-purple">SEO</option>
          </select>
        </div>
        ${window.dealCustomFields.map(f=>`<div class="form-group"><label class="form-label">${f.name}</label>
          ${f.type==='dropdown'?`<select class="form-select" id="ndf-${f.id}"><option>— select —</option>${(f.options||[]).map(o=>`<option>${o}</option>`).join('')}</select>`
          :`<input class="form-input" id="ndf-${f.id}" placeholder="${f.name}…"/>`}</div>`).join('')}
      </div>
      <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="addDeal()">Add Deal</button></div>`, true);
  }
}

export function addStageRow(){
  addStageRowTo('new-stage-list');
}

export function delStageRow(btn){
  const row = btn.closest('.stage-row');
  const list = row?.parentElement;
  if(!list) return;
  const rows = list.querySelectorAll('.stage-row');
  if(rows.length<=1){ window.showToast('Need at least one stage','error'); return; }
  row.remove();
}

export async function createPipeline(){
  const name = document.getElementById('np-name').value.trim();
  if(!name){ window.showToast('Enter a pipeline name','error'); return; }
  const stages = [...document.querySelectorAll('#new-stage-list .stage-name-input')].map((inp,i)=>({id:'ns_'+Date.now()+'_'+i, label:inp.value.trim()||'Stage '+(i+1)}));
  try {
    const res = await window.sb.post('pipelines', {name, stages});
    window.pipelines.push({id:res[0].id, name, stages, deals:[]});
    window.activePipelineId = res[0].id;
    window.closeModal(); window.renderPipelineTabs(); window.switchPipeline(res[0].id);
    window.showToast(`Pipeline "${name}" created!`);
  } catch(e){ window.showToast('Error creating pipeline','error'); console.error(e); }
}

// ── EDIT PIPELINE ──
export function editPipelineModal(pipelineId){
  const pl = window.pipelines.find(p=>p.id===pipelineId); if(!pl) return;
  window.openModal(`
    <div class="modal-head">
      <div class="modal-title">Edit Pipeline</div>
      <span class="modal-close" onclick="closeModal()">×</span>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Pipeline Name</label>
        <input class="form-input" id="ep-name" value="${pl.name}" placeholder="Pipeline name…"/>
      </div>
      <div class="form-group">
        <label class="form-label">Stages</label>
        <div class="stage-list" id="edit-stage-list">
          ${pl.stages.map(s=>`<div class="stage-row" data-id="${s.id}">
            <span class="stage-grip">⠿</span>
            <input class="stage-name-input" value="${s.label}"/>
            <span class="stage-del-btn" onclick="delStageRow(this)">×</span>
          </div>`).join('')}
        </div>
        <button class="add-stage-btn" onclick="addStageRowTo('edit-stage-list')">+ Add Stage</button>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="savePipelineEdit('${pipelineId}')">Save Changes</button>
    </div>`);
}

export async function savePipelineEdit(pipelineId){
  if(!window.requirePerm('edit','You have view-only access — editing is disabled')) return;
  const pl = window.pipelines.find(p=>p.id===pipelineId); if(!pl) return;
  const name = document.getElementById('ep-name')?.value.trim();
  if(!name){ window.showToast('Enter a pipeline name','error'); return; }
  const rows = [...document.querySelectorAll('#edit-stage-list .stage-row')];
  const stages = rows.map(row=>{
    const existingId = row.dataset.id;
    const label = row.querySelector('.stage-name-input')?.value.trim()||'Stage';
    return { id: existingId||('ns_'+Date.now()+'_'+Math.random()), label };
  });
  try {
    await window.sb.patch('pipelines', pipelineId, {name, stages});
    pl.name = name;
    pl.stages = stages;
    window.closeModal();
    window.renderPipelineTabs();
    window.renderBoard();
    // Refresh right panel header
    const nameEl = document.getElementById('pl-active-name');
    if(nameEl && window.activePipelineId===pipelineId) nameEl.textContent = name;
    window.showToast(`Pipeline "${name}" updated!`);
  } catch(e){ window.showToast('Error saving pipeline','error'); console.error(e); }
}

export function addStageRowTo(listId){
  const list = document.getElementById(listId); if(!list) return;
  const row = document.createElement('div');
  row.className = 'stage-row';
  row.innerHTML = `<span class="stage-grip">⠿</span><input class="stage-name-input" placeholder="Stage name…"/><span class="stage-del-btn" onclick="delStageRow(this)">×</span>`;
  list.appendChild(row);
}

// ── DELETE PIPELINE ──
export async function deletePipelineConfirm(pipelineId){
  if(!window.requirePerm('delete','You don\'t have permission to delete records')) return;
  const pl = window.pipelines.find(p=>p.id===pipelineId); if(!pl) return;
  const dealCount = pl.deals?.length||0;
  const msg = dealCount>0
    ? `Delete pipeline "${pl.name}"? This will also delete ${dealCount} deal${dealCount!==1?'s':''} inside it. This cannot be undone.`
    : `Delete pipeline "${pl.name}"?`;
  if(!confirm(msg)) return;
  try {
    await window.sb.del('pipelines', pipelineId);
    window.pipelines = window.pipelines.filter(p=>p.id!==pipelineId);
    // Switch to another pipeline if this was active
    if(window.activePipelineId===pipelineId){
      window.activePipelineId = window.pipelines[0]?.id||null;
      const emptyEl = document.getElementById('pl-empty-state');
      const boardWrap = document.getElementById('pl-board-wrap');
      const addBtn = document.getElementById('pl-add-deal-btn');
      const nameEl = document.getElementById('pl-active-name');
      if(!window.pipelines.length){
        if(emptyEl) emptyEl.style.display='flex';
        if(boardWrap) boardWrap.style.display='none';
        if(addBtn) addBtn.style.display='none';
        const sBtn = document.getElementById('pl-stages-btn'); if(sBtn) sBtn.style.display='none';
        if(nameEl) nameEl.textContent='Select a pipeline';
      } else {
        window.switchPipeline(window.activePipelineId);
      }
    }
    window.renderPipelineTabs();
    window.showToast(`Pipeline "${pl.name}" deleted`);
  } catch(e){ window.showToast('Error deleting pipeline','error'); console.error(e); }
}

// ───────────────── DEAL-NAME AUTOCOMPLETE (in Add-Deal modal) ─────────────────

let _dealACIndex = -1;

export function dealContactInput(val){
  _dealACIndex = -1;
  document.getElementById('nd-contact-id').value = '';
  const ac = document.getElementById('nd-name-ac'); if(!ac) return;
  const q = val.trim().toLowerCase();
  if(!q){ ac.innerHTML=''; ac.classList.remove('open'); return; }
  const matches = window.contacts.filter(c => c.name.toLowerCase().includes(q)).slice(0,8);
  if(!matches.length){ ac.innerHTML=''; ac.classList.remove('open'); return; }
  ac.innerHTML = matches.map((c,i)=>
    `<div class="ac-item" data-id="${c.id}" data-name="${c.name}" data-company="${c.company||''}"
      onmousedown="pickDealContact('${c.id}','${c.name.replace(/'/g,"\\'")}','${(c.company||'').replace(/'/g,"\\'")}')">
      <span>${c.name}</span><small>${c.company||''}</small>
    </div>`).join('');
  ac.classList.add('open');
}

export function dealContactKey(e){
  const ac = document.getElementById('nd-name-ac');
  const items = ac?.querySelectorAll('.ac-item');
  if(!items?.length) return;
  if(e.key==='ArrowDown'){ e.preventDefault(); _dealACIndex = Math.min(_dealACIndex+1, items.length-1); }
  else if(e.key==='ArrowUp'){ e.preventDefault(); _dealACIndex = Math.max(_dealACIndex-1, 0); }
  else if(e.key==='Enter' && _dealACIndex>=0){ e.preventDefault(); items[_dealACIndex].dispatchEvent(new MouseEvent('mousedown')); return; }
  else if(e.key==='Escape'){ closeDealAC(); return; }
  items.forEach((el,i)=>el.classList.toggle('focused', i===_dealACIndex));
  if(_dealACIndex>=0) items[_dealACIndex].scrollIntoView({block:'nearest'});
}

export function pickDealContact(id, name, company){
  document.getElementById('nd-name').value = name;
  document.getElementById('nd-company').value = company;
  document.getElementById('nd-contact-id').value = id;
  closeDealAC();
}

export function closeDealAC(){
  const ac = document.getElementById('nd-name-ac');
  if(ac){ ac.innerHTML=''; ac.classList.remove('open'); }
}

// ───────────────── DEAL CRUD ─────────────────

export async function addDeal(){
  const name = document.getElementById('nd-name').value.trim();
  if(!name){ window.showToast('Enter a contact name','error'); return; }
  const contactId = document.getElementById('nd-contact-id').value||null;
  const tagSel = document.getElementById('nd-tag');
  const tagLabel = tagSel.options[tagSel.selectedIndex].text;
  const tagCls = tagSel.value;
  const stage = document.getElementById('nd-stage').value;
  const value = parseInt(document.getElementById('nd-value').value)||0;
  const pipeline = window.getActivePipeline();
  const cf = {};
  window.dealCustomFields.forEach(f=>{ const el=document.getElementById('ndf-'+f.id); if(el) cf[f.id]=el.value; });
  try {
    const res = await window.sb.post('deals', {
      pipeline_id: pipeline.id, stage_id: stage,
      name, company: document.getElementById('nd-company').value.trim()||'—',
      value, tags:[{label:tagLabel, cls:tagCls}], custom_fields: cf,
      ...(contactId ? {contact_id:contactId} : {})
    });
    const newDeal = {id:res[0].id, pipeline_id:pipeline.id, stage, name, company:res[0].company, value, tags:[{label:tagLabel, cls:tagCls}], customFields:cf, contactId};
    pipeline.deals.push(newDeal);
    window.closeModal(); window.renderBoard(); window.refreshPipelineHeader(); window.showToast(`Deal "${name}" added!`);
  } catch(e){ window.showToast('Error adding deal','error'); console.error(e); }
}

// ── DEAL DETAIL ──
export function openDealDetail(dealId){
  const pipeline = window.getActivePipeline();
  const deal = pipeline?.deals.find(d=>d.id===dealId); if(!deal) return;
  const stageOpts = pipeline.stages.map(s=>`<option value="${s.id}" ${s.id===deal.stage?'selected':''}>${s.label}</option>`).join('');
  const linkedContact = deal.contactId ? window.contacts.find(c=>c.id===deal.contactId) : null;
  const contactSection = linkedContact ? `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--accent-bg);border:1px solid var(--accent-border);border-radius:var(--radius);margin-bottom:14px">
      <div class="av-sm ${window.getAv(linkedContact.id)}">${window.initials(linkedContact.name)}</div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:600;color:var(--accent2)">${window.pName(linkedContact.name)}</div>
        <div style="font-size:11px;color:var(--text3)">${linkedContact.email?window.pEmail(linkedContact.email):''} ${linkedContact.phone?'· '+window.pPhone(linkedContact.phone):''}</div>
      </div>
      <button class="btn btn-sm" onclick="closeModal();openContactDetail('${linkedContact.id}')">View Contact</button>
    </div>` : `
    <div style="font-size:11px;color:var(--text3);margin-bottom:14px;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius)">
      No contact linked. <span onclick="closeModal();navigate('contacts')" style="color:var(--accent2);cursor:pointer">Link from Contacts →</span>
    </div>`;
  window.openModal(`
    <div class="modal-head"><div class="modal-title">Deal: ${window.pName(deal.name)}</div><span class="modal-close" onclick="closeModal()">×</span></div>
    <div class="modal-body">
      <div class="modal-section">
        <div class="modal-section-title">Linked Contact</div>
        ${contactSection}
        <div class="modal-section-title">Deal Info</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Deal Name</label><input class="form-input" id="dd-name" value="${deal.name}"/></div>
          <div class="form-group"><label class="form-label">Company</label><input class="form-input" id="dd-company" value="${deal.company||''}"/></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Value (${window.getCurrencySymbol()})</label><input class="form-input" id="dd-value" type="number" value="${deal.value}"/></div>
          <div class="form-group"><label class="form-label">Stage</label><select class="form-select" id="dd-stage">${stageOpts}</select></div>
        </div>
      </div>
      <div class="modal-section">
        <div class="modal-section-title">Tags</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
          ${(deal.tags||[]).map((t,i)=>`<span class="tag ${t.cls}">${window.pTag(t.label)}<span class="tag-remove" onclick="removeDealTag('${dealId}',${i})">×</span></span>`).join('')}
          ${!(deal.tags||[]).length?'<span style="font-size:12px;color:var(--text3)">No tags</span>':''}
        </div>
        <div class="tag-input-wrap">
          <input class="tag-input" id="deal-tag-input" placeholder="New tag…" onkeydown="if(event.key==='Enter')addDealTag('${dealId}')"/>
          <select class="form-select" id="deal-tag-color" style="width:auto;padding:7px 8px">
            ${window.TAG_COLORS.map(tc=>`<option value="${tc.cls}">${tc.label}</option>`).join('')}
          </select>
          <button class="btn btn-sm btn-primary" onclick="addDealTag('${dealId}')">Add</button>
        </div>
      </div>
      ${window.dealCustomFields.length?`<div class="modal-section">
        <div class="modal-section-title">Custom Fields</div>
        ${window.dealCustomFields.map(f=>`<div class="form-group"><label class="form-label">${f.name}</label>
          ${f.type==='dropdown'?`<select class="form-select" id="ddf-${f.id}"><option>— select —</option>${(f.options||[]).map(o=>`<option ${(deal.customFields||{})[f.id]===o?'selected':''}>${o}</option>`).join('')}</select>`
          :`<input class="form-input" id="ddf-${f.id}" value="${(deal.customFields||{})[f.id]||''}" placeholder="${f.name}…"/>`}</div>`).join('')}
      </div>`:''}
    </div>
    <div class="modal-foot">
      <button class="btn btn-sm" style="color:var(--red);margin-right:auto" onclick="deleteDeal('${dealId}')">Delete Deal</button>
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveDeal('${dealId}')">Save Changes</button>
    </div>`, true);
}

export async function removeDealTag(dealId, idx){
  const pipeline = window.getActivePipeline();
  const deal = pipeline.deals.find(d=>d.id===dealId); if(!deal) return;
  deal.tags = deal.tags.filter((_,i)=>i!==idx);
  try { await window.sb.patch('deals', dealId, {tags:deal.tags}); openDealDetail(dealId); }
  catch(e){ window.showToast('Error removing tag','error'); }
}

export async function addDealTag(dealId){
  const label = document.getElementById('deal-tag-input').value.trim(); if(!label) return;
  const cls = document.getElementById('deal-tag-color').value;
  const pipeline = window.getActivePipeline();
  const deal = pipeline.deals.find(d=>d.id===dealId); if(!deal) return;
  deal.tags = [...(deal.tags||[]), {label, cls}];
  try { await window.sb.patch('deals', dealId, {tags:deal.tags}); openDealDetail(dealId); window.showToast(`Tag "${label}" added`); }
  catch(e){ window.showToast('Error adding tag','error'); }
}

export async function saveDeal(dealId){
  if(!window.requirePerm('edit','You have view-only access — editing is disabled')) return;
  const pipeline = window.getActivePipeline();
  const deal = pipeline.deals.find(d=>d.id===dealId); if(!deal) return;
  const name = document.getElementById('dd-name').value.trim()||deal.name;
  const company = document.getElementById('dd-company').value.trim();
  const value = parseInt(document.getElementById('dd-value').value)||0;
  const stage = document.getElementById('dd-stage').value;
  const cf = {...(deal.customFields||{})};
  window.dealCustomFields.forEach(f=>{ const el=document.getElementById('ddf-'+f.id); if(el) cf[f.id]=el.value; });
  try {
    await window.sb.patch('deals', dealId, {name, company, value, stage_id:stage, custom_fields:cf});
    Object.assign(deal, {name, company, value, stage, customFields:cf});
    window.closeModal(); window.renderBoard(); window.refreshPipelineHeader(); window.showToast('Deal saved!');
  } catch(e){ window.showToast('Error saving deal','error'); console.error(e); }
}

export async function deleteDeal(dealId){
  if(!window.requirePerm('delete','You don\'t have permission to delete records')) return;
  if(!confirm('Delete this deal?')) return;
  const pipeline = window.getActivePipeline();
  try {
    await window.sb.del('deals', dealId);
    pipeline.deals = pipeline.deals.filter(d=>d.id!==dealId);
    window.closeModal(); window.renderBoard(); window.refreshPipelineHeader(); window.showToast('Deal deleted');
  } catch(e){ window.showToast('Error deleting deal','error'); }
}

// ───────────────── PIPELINE STAGES MODAL ─────────────────

let settingsActivePl = null;

export function openPipelineStagesModal(){
  if(!window.pipelines.length){ window.showToast('Create a pipeline first','error'); return; }
  // If a pipeline is currently active on the board, default the modal to it
  if(window.activePipelineId) settingsActivePl = window.activePipelineId;
  window.openModal(`
    <div class="modal-head">
      <div class="modal-title">Pipeline Stages</div>
      <span class="modal-close" onclick="closeModal()">×</span>
    </div>
    <div class="modal-body">
      <div style="font-size:12px;color:var(--text3);margin-bottom:12px">Add, rename, reorder, or remove stages. Drag rows by the ⠿ handle to reorder.</div>
      <div id="settings-pipeline-tabs" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px"></div>
      <div class="stage-list" id="settings-stage-list"></div>
      <button class="add-stage-btn" onclick="settingsAddStage()">+ Add Stage</button>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="settingsSaveStages();closeModal()">Save Stages</button>
    </div>
  `);
  renderSettingsPipeline();
}

export function renderSettingsPipeline(){
  if(!settingsActivePl && window.pipelines.length>0) settingsActivePl = window.pipelines[0].id;
  const tabs = document.getElementById('settings-pipeline-tabs');
  if(tabs) tabs.innerHTML = window.pipelines.map(p=>`<div class="settings-pl-tab ${p.id===settingsActivePl?'active':''}" onclick="switchSettingsPl('${p.id}')">${p.name}</div>`).join('');
  const pl = window.pipelines.find(p=>p.id===settingsActivePl);
  const list = document.getElementById('settings-stage-list');
  if(list && pl) list.innerHTML = pl.stages.map(s=>`
    <div class="stage-row" draggable="true" ondragstart="stageDragStart(event)" ondragover="stageDragOver(event)" ondrop="stageDrop(event)" ondragend="stageDragEnd(event)">
      <span class="stage-grip">⠿</span>
      <input class="stage-name-input" data-id="${s.id}" value="${s.label}"/>
      <span class="stage-del-btn" onclick="settingsDeleteStage('${s.id}')">×</span>
    </div>`).join('');
}

export function switchSettingsPl(id){ settingsActivePl = id; renderSettingsPipeline(); }

export function settingsAddStage(){
  const pl = window.pipelines.find(p=>p.id===settingsActivePl); if(!pl) return;
  pl.stages.push({id:'st_'+Date.now(), label:'New Stage'});
  renderSettingsPipeline();
  const inputs = document.querySelectorAll('#settings-stage-list .stage-name-input');
  if(inputs.length) inputs[inputs.length-1].focus();
}

export async function settingsSaveStages(){
  const pl = window.pipelines.find(p=>p.id===settingsActivePl); if(!pl) return;
  const rows = document.querySelectorAll('#settings-stage-list .stage-row');
  const newStages = [...rows].map((row,i)=>{
    const inp = row.querySelector('.stage-name-input');
    return {id: inp.dataset.id||'st_'+Date.now()+'_'+i, label: inp.value.trim()||'Stage '+(i+1)};
  });
  const keptIds = newStages.map(s=>s.id);
  pl.deals.forEach(d=>{ if(!keptIds.includes(d.stage)) d.stage = newStages[0]?.id||''; });
  pl.stages = newStages;
  try {
    await window.sb.patch('pipelines', pl.id, {stages:newStages});
    renderSettingsPipeline();
    if(document.getElementById('page-pipeline').classList.contains('active')){ window.renderPipelineTabs(); window.renderBoard(); }
    window.showToast('Stages saved!');
  } catch(e){ window.showToast('Error saving stages','error'); }
}

export async function settingsDeleteStage(stageId){
  const pl = window.pipelines.find(p=>p.id===settingsActivePl); if(!pl) return;
  if(pl.stages.length<=1){ window.showToast("Can't delete the only stage"); return; }
  const stage = pl.stages.find(s=>s.id===stageId);
  if(!confirm(`Delete stage "${stage.label}"?`)) return;
  const first = pl.stages.find(s=>s.id!==stageId);
  pl.deals.forEach(d=>{ if(d.stage===stageId) d.stage = first.id; });
  pl.stages = pl.stages.filter(s=>s.id!==stageId);
  try {
    await window.sb.patch('pipelines', pl.id, {stages:pl.stages});
    renderSettingsPipeline(); window.showToast(`Stage deleted`);
  } catch(e){ window.showToast('Error deleting stage','error'); }
}

// ───────────────── STAGE-ROW DnD (inside the stages settings modal) ─────────────────

let stageDragEl = null;

export function stageDragStart(e){
  stageDragEl = e.currentTarget;
  setTimeout(()=>stageDragEl?.classList.add('stage-dragging'), 0);
  e.dataTransfer.effectAllowed = 'move';
}

export function stageDragOver(e){
  e.preventDefault();
  const row = e.currentTarget;
  if(row !== stageDragEl) row.classList.add('stage-drag-over');
}

export function stageDrop(e){
  e.preventDefault();
  const target = e.currentTarget;
  target.classList.remove('stage-drag-over');
  if(!stageDragEl || stageDragEl===target) return;
  const list = target.parentNode;
  const rows = [...list.querySelectorAll('.stage-row')];
  const fromIdx = rows.indexOf(stageDragEl);
  const toIdx = rows.indexOf(target);
  if(fromIdx<toIdx) list.insertBefore(stageDragEl, target.nextSibling);
  else list.insertBefore(stageDragEl, target);
}

export function stageDragEnd(e){
  if(stageDragEl) stageDragEl.classList.remove('stage-dragging');
  document.querySelectorAll('.stage-row').forEach(r=>r.classList.remove('stage-drag-over'));
  stageDragEl = null;
}

window.__nlmPipelinesAdminLoaded = true;
