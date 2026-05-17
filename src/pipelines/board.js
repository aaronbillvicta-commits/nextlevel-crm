// NLM CRM - pipelines kanban board (render + deal cards + drag-and-drop)
//
// MIGRATION NOTE (step 9b of the modular extraction):
// SECOND file in src/pipelines/. Strangler-fig: this module duplicates the
// board-rendering + drag-and-drop block from index.html (~lines 5623-5743,
// 10 functions). Nothing imports from it yet; the inline copies remain
// authoritative for every callsite (the kanban DnD callbacks
// ondragstart/ondragend/ondragover/ondrop/ondragleave resolve via
// hoisted-function-declaration window globals from the inline <script>).
//
// Roadmap (per saved memory `target-layout-decision` and CONTINUE-HERE):
//   9a.  pipelines/index.js  (tabs + state)                  DONE 33cdf1a
//   9b.  pipelines/board.js  (kanban + DnD)                  <- this file
//   9c.  pipelines/admin.js  (pipeline/deal/stages CRUD)     NEXT
//
// No new state-mirror entries needed in this step. All inline state this
// module reads (pipelines, contacts, dealCustomFields) was already bridged.
//
// SCOPE (10 functions verbatim-copied from index.html ~lines 5623-5743):
// - renderBoard            renders all stage columns + their deal cards
// - renderDealCard         single-deal-card markup (contact badge + tags + value)
// - handleDealClick        opens deal detail if it wasn't a tag-remove click + not mid-drag
// - onDealDragStart        starts the drag; remembers the source card + column
// - onDealDragEnd          cleans up the drag classes + placeholder
// - onDragOver             handles drag-over on a column (placeholder + highlight)
// - onDragLeave            cleans up the column highlight when leaving
// - onDrop                 commits the drop: moves card DOM, persists stage_id to Supabase
// - getDragAfterElement    helper: which card the dragged-over Y position is above
// - removePlaceholder      helper: tear down the drop placeholder
// - updateAllColumns       helper: refresh the per-column count + total after a drop
//
// ADAPTATIONS FROM VERBATIM:
//
// State (via window.* mirror):
// - `pipelines`         -> `window.pipelines`         (already bridged)
// - `dealCustomFields`  -> `window.dealCustomFields`  (bridged in 9a)
// - `contacts`          -> `window.contacts`          (already bridged)
// - `sb`                -> `window.sb`                (already bridged)
//
// Inline function refs via window.* per the established pattern:
// - `formatCurrency`, `getAv`, `initials`, `showToast`
// - `getActivePipeline` (step 9a sibling — same function exists inline AND in
//   src/pipelines/index.js; module scope CAN'T see the cross-module export
//   without an explicit import, so we read it via window.* which resolves to
//   the inline copy. When callsite migration happens later, swap to a real
//   `import { getActivePipeline } from './index.js'`.)
// - `openDealDetail` (step 9c will extract; today it's the inline copy via window.*)
//
// Module-local refs called bare from within the module:
// - `renderDealCard`, `getDragAfterElement`, `removePlaceholder`, `updateAllColumns`
// - Module-local DnD state: `dealDragging`, `dealSourceCol`, `placeholder`.
//   The inline copies have their own state vars by the same names. They can't
//   collide because the HTML attribute strings (ondragstart="onDealDragStart...",
//   ondragover="onDragOver...", etc.) resolve to the inline functions at
//   event-time — so the module's state vars stay null and dormant. When
//   callsites migrate, both inline state and inline functions can be deleted
//   together.
//
// References inside `onclick="..."` / `ondrag*="..."` attribute strings
// (onDragOver, onDrop, onDragLeave, onDealDragStart, onDealDragEnd,
// handleDealClick) are LEFT BARE because those strings are parsed at
// event-time and resolve via window from the inline hoisted-function
// declarations.

// ───────────────── BOARD RENDER ─────────────────

export function renderBoard(){
  const pipeline = window.getActivePipeline(); if(!pipeline) return;
  const board = document.getElementById('pipeline-board');
  board.innerHTML = pipeline.stages.map(stage=>{
    const deals = (pipeline.deals||[]).filter(d=>d.stage===stage.id);
    const total = deals.reduce((s,d)=>s+d.value,0);
    return `
      <div class="col" data-stage="${stage.id}"
        ondragover="onDragOver(event)" ondrop="onDrop(event)" ondragleave="onDragLeave(event)">
        <div class="col-head">
          <span class="col-label">${stage.label}</span>
          <span class="col-cnt">${deals.length}</span>
        </div>
        <div class="deal-drop-zone">
          ${deals.map(deal=>renderDealCard(deal)).join('')}
        </div>
        <div class="col-total">${deals.length===0?'No deals yet':`Total · ${window.formatCurrency(total)}/mo`}</div>
      </div>`;
  }).join('');
}

export function renderDealCard(deal){
  const preview = window.dealCustomFields.slice(0,1).map(f=>`${f.name}: ${(deal.customFields||{})[f.id]||'—'}`).join(' · ');
  const linkedContact = deal.contactId ? window.contacts.find(c=>c.id===deal.contactId) : null;
  const contactBadge = linkedContact
    ? `<div style="display:flex;align-items:center;gap:5px;margin-top:4px">
        <div class="av-sm ${window.getAv(linkedContact.id)}" style="width:16px;height:16px;font-size:7px;flex-shrink:0">${window.initials(linkedContact.name)}</div>
        <span style="font-size:10px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${linkedContact.name}</span>
       </div>`
    : '';
  return `
    <div class="deal" draggable="true" data-id="${deal.id}" data-value="${deal.value}"
      ondragstart="onDealDragStart(event)" ondragend="onDealDragEnd(event)"
      onclick="handleDealClick(event,'${deal.id}')">
      <div class="deal-grip">⠿</div>
      <div class="deal-name">${deal.name}</div>
      <div class="deal-co">${deal.company||''}</div>
      ${contactBadge}
      <div class="deal-val">${window.formatCurrency(deal.value||0)}/mo</div>
      <div class="deal-tags">${(deal.tags||[]).map(t=>`<span class="tag ${t.cls}">${t.label}</span>`).join('')}</div>
      ${preview?`<div class="deal-custom-preview">${preview}</div>`:''}
    </div>`;
}

export function handleDealClick(e,dealId){
  if(!e.target.classList.contains('tag-remove') && !dealDragging) window.openDealDetail(dealId);
}

// ───────────────── DEAL DRAG-AND-DROP ─────────────────

let dealDragging = null, dealSourceCol = null, placeholder = null;

export function onDealDragStart(e){
  dealDragging = e.currentTarget;
  dealSourceCol = dealDragging.closest('.col');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dealDragging.dataset.id);
  setTimeout(()=>{ if(dealDragging) dealDragging.classList.add('dragging'); }, 0);
  e.stopPropagation();
}

export function onDealDragEnd(e){
  if(dealDragging) dealDragging.classList.remove('dragging');
  removePlaceholder();
  document.querySelectorAll('.col').forEach(c=>c.classList.remove('col-drag-over-stage'));
  dealDragging = null; dealSourceCol = null;
}

export function onDragOver(e){
  e.preventDefault();
  const col = e.currentTarget;
  if(dealDragging){
    col.classList.add('col-drag-over-stage');
    const zone = col.querySelector('.deal-drop-zone');
    removePlaceholder();
    placeholder = document.createElement('div');
    placeholder.className = 'drop-placeholder';
    placeholder.textContent = 'Drop here';
    const after = getDragAfterElement(zone, e.clientY);
    after ? zone.insertBefore(placeholder, after) : zone.appendChild(placeholder);
  }
}

export function onDragLeave(e){
  const col = e.currentTarget;
  if(!col.contains(e.relatedTarget)){ col.classList.remove('col-drag-over-stage'); removePlaceholder(); }
}

export async function onDrop(e){
  e.preventDefault();
  const col = e.currentTarget;
  col.classList.remove('col-drag-over-stage');
  removePlaceholder();
  const dealId = dealDragging ? dealDragging.dataset.id : e.dataTransfer.getData('text/plain');
  if(!dealId) return;
  const card = dealDragging || document.querySelector(`.deal[data-id="${dealId}"]`);
  if(!card) return;
  const zone = col.querySelector('.deal-drop-zone');
  const after = getDragAfterElement(zone, e.clientY);
  after ? zone.insertBefore(card, after) : zone.appendChild(card);
  const pipeline = window.getActivePipeline();
  const deal = pipeline.deals.find(d=>d.id===dealId);
  const fromStage = deal ? deal.stage : null;
  const newStage = col.dataset.stage;
  if(deal) deal.stage = newStage;
  updateAllColumns();
  if(fromStage !== newStage){
    window.showToast(`"${card.querySelector('.deal-name').textContent}" → ${col.querySelector('.col-label').textContent}`);
    try { await window.sb.patch('deals', dealId, {stage_id: newStage}); }
    catch(err){ window.showToast('Error saving stage change','error'); console.error(err); }
  }
  dealDragging = null; dealSourceCol = null;
}

function getDragAfterElement(container, y){
  return [...container.querySelectorAll('.deal:not(.dragging)')].reduce((closest, child)=>{
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height/2;
    return offset<0 && offset>closest.offset ? {offset, element:child} : closest;
  }, {offset: Number.NEGATIVE_INFINITY}).element;
}

function removePlaceholder(){
  if(placeholder && placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
  placeholder = null;
}

function updateAllColumns(){
  document.querySelectorAll('.col').forEach(col=>{
    const deals = col.querySelectorAll('.deal');
    const cnt = col.querySelector('.col-cnt');
    const total = col.querySelector('.col-total');
    if(cnt) cnt.textContent = deals.length;
    if(total){
      let sum = 0;
      deals.forEach(d=> sum += parseInt(d.dataset.value||0));
      total.textContent = deals.length===0 ? 'No deals yet' : `Total · ${window.formatCurrency(sum)}/mo`;
    }
  });
}

window.__nlmPipelinesBoardLoaded = true;
