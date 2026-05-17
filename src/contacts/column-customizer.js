// NLM CRM - contacts column customizer (modal + drag-reorder + custom columns)
//
// MIGRATION NOTE (step 8f of the modular extraction):
// Sixth file in src/contacts/. Strangler-fig: this module duplicates the
// column-customizer block from index.html (~lines 4256-4530, 17 functions
// total). Nothing imports from it yet; the inline copies are still
// authoritative for every callsite.
//
// Roadmap (per saved memory `target-layout-decision` and CONTINUE-HERE):
//   8a-c.  helpers/notes/import-export   DONE
//   8d-prep. state mirror                DONE 21043c1
//   8d.    filters.js                    DONE 264e52c
//   8e.    selection.js                  DONE ba14361
//   8f.    column-customizer.js          <- this file
//   8g.    index.js                      (renderContacts + table + modals + cell-edit + state)
//
// One state-mirror entry added inline as part of this step: `ALL_COLUMNS`
// (the static `const` array of built-in column metadata).
//
// ADAPTATIONS FROM VERBATIM:
//
// State (via the window.* mirror):
// - `customColumns`  -> `window.customColumns`  (array, reassigned via setter)
// - `columnOrder`    -> `window.columnOrder`    (array | null, reassigned via setter)
// - `visibleColumns` -> `window.visibleColumns` (array, reassigned via setter)
// - `contacts`       -> `window.contacts`
// - `ALL_COLUMNS`    -> `window.ALL_COLUMNS`    (const, getter only)
//
// Function refs (inline `function foo(){}` -> on window automatically):
// - `showToast`        -> `window.showToast`
// - `openModal`        -> `window.openModal`
// - `closeModalForce`  -> `window.closeModalForce`
// - `renderContacts`   -> `window.renderContacts`
//
// Module-local refs (defined here, called bare from within the module):
// - `getAllCols`, `initColumnOrder`, `buildColList`, plus all the drag handlers
//   and persistence helpers. Module-local resolution keeps them isolated from
//   the inline copies even though both modules and inline use the same names.
//
// `_dragColIdx` is module-scoped state. The inline copy has its own; they
// can't collide because the HTML drag handlers (`ondragstart="colDragStart..."`)
// resolve to the inline functions at click-time, so the module's
// `_dragColIdx` stays null and dormant. When callsites migrate, both inline
// state and inline functions can be deleted together.
//
// References inside `onclick="..."` and `ondrag*="..."` attribute strings
// (resetColumns, addCustomColumn, applyColumns, deleteCustomColumn,
// toggleColumn, all the col-drag-* handlers) are LEFT BARE because those
// strings are parsed at event-time and resolve via window from the inline
// hoisted-function declarations.

// ───────────────── PERSISTENCE HELPERS ─────────────────

export function saveCustomColumns(){ localStorage.setItem('nlm_custom_cols', JSON.stringify(window.customColumns)); }
export function saveColumnOrder(){ localStorage.setItem('nlm_col_order', JSON.stringify(window.columnOrder)); }
export function saveVisibleColumns(){ localStorage.setItem('nlm_contact_cols', JSON.stringify(window.visibleColumns)); }

// ───────────────── DERIVED COLUMN ACCESSORS ─────────────────

// All columns combined (built-in + custom), sorted by columnOrder.
export function getAllCols(){
  const base = [...window.ALL_COLUMNS, ...window.customColumns.map(c=>({...c, required:false, sortable:true, custom:true}))];
  if(!window.columnOrder) return base;
  const ordered = window.columnOrder.map(id=>base.find(c=>c.id===id)).filter(Boolean);
  const remaining = base.filter(c=>!window.columnOrder.includes(c.id));
  return [...ordered, ...remaining];
}

// Initialize columnOrder from defaults if not set.
export function initColumnOrder(){
  if(!window.columnOrder){
    window.columnOrder = getAllCols().map(c=>c.id);
    saveColumnOrder();
  }
}

// ───────────────── MODAL ─────────────────

export function openColumnCustomizer(){
  initColumnOrder();
  window.openModal(`
    <div class="modal-head">
      <div class="modal-title">Customize Columns</div>
      <span class="modal-close" onclick="closeModal()">×</span>
    </div>
    <div class="modal-body" style="padding:0">

      <!-- Section: toggle + drag to reorder -->
      <div style="padding:8px 16px 6px;font-size:11px;color:var(--text3);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
        <span><strong>⠿ Drag</strong> to reorder &nbsp;·&nbsp; <strong>Click toggle</strong> to show/hide</span>
        <button class="btn btn-sm" style="font-size:10px" onclick="resetColumns()">Reset defaults</button>
      </div>
      <div id="col-customizer-list">${buildColList()}</div>

      <!-- Section: add new custom column -->
      <div style="padding:12px 16px;border-top:2px solid var(--border);background:var(--bg2)">
        <div style="font-size:11px;font-weight:600;color:var(--text);margin-bottom:10px">+ Add Custom Column</div>
        <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
          <div style="flex:2;min-width:120px">
            <label style="font-size:10px;color:var(--text3);display:block;margin-bottom:4px">Column Name</label>
            <input class="form-input" id="new-col-name" placeholder="e.g. Priority, Budget, Notes…" style="font-size:12px"/>
          </div>
          <div style="flex:1;min-width:100px">
            <label style="font-size:10px;color:var(--text3);display:block;margin-bottom:4px">Type</label>
            <select class="form-select" id="new-col-type" style="font-size:12px">
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
              <option value="select">Dropdown</option>
            </select>
          </div>
          <button class="btn btn-primary btn-sm" onclick="addCustomColumn()" style="flex-shrink:0;height:36px">Add Column</button>
        </div>
        <div id="new-col-select-opts" style="display:none;margin-top:8px">
          <label style="font-size:10px;color:var(--text3);display:block;margin-bottom:4px">Dropdown Options (comma-separated)</label>
          <input class="form-input" id="new-col-options" placeholder="Option 1, Option 2, Option 3" style="font-size:12px"/>
        </div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="applyColumns()">Apply &amp; Close</button>
    </div>`, true);

  // Show/hide dropdown options field
  document.getElementById('new-col-type')?.addEventListener('change', function(){
    document.getElementById('new-col-select-opts').style.display = this.value==='select'?'block':'none';
  });
}

export function buildColList(){
  const all = getAllCols();
  return all.map((col,idx)=>{
    const isOn = col.required || window.visibleColumns.includes(col.id);
    const deleteBtn = col.custom
      ? `<button onclick="event.stopPropagation();deleteCustomColumn('${col.id}')" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:16px;line-height:1;padding:2px 6px;opacity:.7;flex-shrink:0" title="Delete column">×</button>`
      : '';
    return `
    <div class="col-toggle-item col-drag-row"
      draggable="true"
      data-col-id="${col.id}"
      data-idx="${idx}"
      ondragstart="colDragStart(event,${idx})"
      ondragover="colDragOver(event)"
      ondrop="colDrop(event,${idx})"
      ondragleave="colDragLeave(event)"
      ondragend="colDragEnd(event)">
      <!-- Drag handle — separate from toggle click -->
      <div class="col-drag-handle" title="Drag to reorder" ondragstart="event.stopPropagation()" onclick="event.stopPropagation()" style="cursor:grab;padding:4px 6px;color:var(--text3);font-size:16px;flex-shrink:0;user-select:none">⠿</div>
      <!-- Toggle switch (separate click target) -->
      <div onclick="${col.required?'event.stopPropagation()':('event.stopPropagation();toggleColumn(\''+col.id+'\')')}" style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;cursor:${col.required?'default':'pointer'}">
        <div class="col-toggle-switch ${isOn?'on':'off'}" style="pointer-events:none;flex-shrink:0">
          <div class="col-toggle-knob"></div>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;color:${isOn?'var(--text)':'var(--text3)'};font-weight:${isOn?'500':'400'}">${col.label}
            ${col.custom?'<span style="font-size:9px;background:var(--purple-bg);color:var(--purple);padding:1px 6px;border-radius:10px;margin-left:5px">custom</span>':''}
            ${col.required?'<span style="font-size:9px;color:var(--text3);margin-left:4px">(required)</span>':''}
          </div>
          ${col.custom?`<div style="font-size:10px;color:var(--text3)">${col.type||'text'}</div>`:''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <span style="font-size:11px;color:${isOn?'var(--green)':'var(--text3)'}">
          ${isOn?'✓ Visible':'Hidden'}
        </span>
        ${deleteBtn}
      </div>
    </div>`;
  }).join('');
}

// ───────────────── DRAG REORDER ─────────────────

let _dragColIdx = null;

export function colDragStart(e, idx){
  _dragColIdx = idx;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.style.opacity = '0.4';
}

export function colDragEnd(e){
  e.currentTarget.style.opacity = '1';
  document.querySelectorAll('.col-drag-row').forEach(el=>{
    el.style.borderTop = '';
    el.style.borderBottom = '';
    el.style.background = '';
  });
}

export function colDragOver(e){
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.col-drag-row').forEach(el=>{ el.style.borderTop=''; el.style.borderBottom=''; });
  const rect = e.currentTarget.getBoundingClientRect();
  const midY = rect.top + rect.height/2;
  if(e.clientY < midY) e.currentTarget.style.borderTop = '2px solid var(--accent)';
  else e.currentTarget.style.borderBottom = '2px solid var(--accent)';
}

export function colDragLeave(e){
  e.currentTarget.style.borderTop = '';
  e.currentTarget.style.borderBottom = '';
}

export function colDrop(e, targetIdx){
  e.preventDefault();
  if(_dragColIdx === null || _dragColIdx === targetIdx) return;

  const cols = getAllCols();
  const fromId = cols[_dragColIdx]?.id;
  const toId   = cols[targetIdx]?.id;
  if(!fromId || !toId) return;

  // Build/refresh columnOrder from current getAllCols order
  window.columnOrder = cols.map(c=>c.id);

  const fromPos = window.columnOrder.indexOf(fromId);
  const toPos   = window.columnOrder.indexOf(toId);
  window.columnOrder.splice(fromPos, 1);

  const rect = e.currentTarget.getBoundingClientRect();
  const insertAfter = e.clientY > rect.top + rect.height/2;
  const insertAt = insertAfter ? toPos : toPos;
  window.columnOrder.splice(insertAt, 0, fromId);

  saveColumnOrder();
  _dragColIdx = null;

  const list = document.getElementById('col-customizer-list');
  if(list) list.innerHTML = buildColList();

  // Live preview - update contact table immediately
  window.renderContacts();
}

// ───────────────── COLUMN VISIBILITY + CUSTOM-COLUMN CRUD ─────────────────

export function toggleColumn(id){
  if(window.visibleColumns.includes(id)) window.visibleColumns = window.visibleColumns.filter(c=>c!==id);
  else window.visibleColumns.push(id);
  saveVisibleColumns();
  const list = document.getElementById('col-customizer-list');
  if(list) list.innerHTML = buildColList();
}

export function addCustomColumn(){
  const name = document.getElementById('new-col-name')?.value.trim();
  const type = document.getElementById('new-col-type')?.value || 'text';
  const optsRaw = document.getElementById('new-col-options')?.value || '';

  if(!name){ window.showToast('Enter a column name','error'); return; }
  if(getAllCols().some(c=>c.label.toLowerCase()===name.toLowerCase())){
    window.showToast('A column with that name already exists','error'); return;
  }

  const id = 'custom_'+Date.now();
  const col = { id, label:name, type, options: type==='select' ? optsRaw.split(',').map(s=>s.trim()).filter(Boolean) : [] };
  window.customColumns.push(col);
  saveCustomColumns();

  window.visibleColumns.push(id);
  saveVisibleColumns();

  const nameEl = document.getElementById('new-col-name');
  if(nameEl) nameEl.value='';

  const list = document.getElementById('col-customizer-list');
  if(list) list.innerHTML = buildColList();
  window.showToast(`Column "${name}" added!`);
}

export function deleteCustomColumn(id){
  const col = window.customColumns.find(c=>c.id===id);
  if(!confirm(`Delete column "${col?.label}"? This removes the column and all data stored in it.`)) return;
  window.customColumns = window.customColumns.filter(c=>c.id!==id);
  window.visibleColumns = window.visibleColumns.filter(c=>c!==id);
  saveCustomColumns();
  saveVisibleColumns();
  // Clear data from all contacts
  window.contacts.forEach(c=>{ if(c.customFields) delete c.customFields[id]; });
  const list = document.getElementById('col-customizer-list');
  if(list) list.innerHTML = buildColList();
  window.showToast(`Column deleted`);
}

export function resetColumns(){
  window.visibleColumns = ['name','company','email','phone','source','tags','status','pipeline',
    ...window.customColumns.map(c=>c.id)];
  window.columnOrder = null;
  localStorage.removeItem('nlm_col_order');
  saveVisibleColumns();
  const list = document.getElementById('col-customizer-list');
  if(list) list.innerHTML = buildColList();
}

export function applyColumns(){
  window._modalLocked = false;
  window.closeModalForce();
  window.renderContacts();
}

window.__nlmContactsColumnCustomizerLoaded = true;
