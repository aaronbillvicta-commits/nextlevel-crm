// NLM CRM - pipelines foundation (tabs + active-pipeline state + header refresh)
//
// MIGRATION NOTE (step 9a of the modular extraction):
// FIRST file in src/pipelines/. Strangler-fig: this module duplicates the
// pipeline foundation block from index.html (~lines 5554-5755, 4 functions
// covering active-pipeline state + the left-panel tab list + the right-panel
// header). Nothing imports from it yet; the inline copies remain authoritative
// for every callsite.
//
// Roadmap (per saved memory `target-layout-decision` and CONTINUE-HERE):
//   8a-g.  contacts/  (helpers / notes / import-export / state-mirror / filters /
//          selection / column-customizer / index)            DONE
//   9a.    pipelines/index.js  (foundation: tabs + state)    <- this file
//   9b.    pipelines/board.js  (kanban view + DnD)           NEXT
//   9c.    pipelines/admin.js  (pipeline/deal/stages CRUD)   AFTER
//
// Two state-mirror entries added inline as part of this step:
// `activePipelineId` (let, reassignable), `dealCustomFields` (let, reassignable).
//
// SCOPE (4 functions verbatim-copied from index.html ~lines 5554-5755):
// - getActivePipeline      one-liner accessor
// - renderPipelineTabs     left panel: pipeline cards with stage chips
// - switchPipeline         right panel toggle + active-pipeline state set
// - refreshPipelineHeader  right panel: header name + stats (called after deal CRUD)
//
// ADAPTATIONS FROM VERBATIM:
//
// State (via window.* mirror; declared `let` inline so not on window
// automatically):
// - `pipelines`        -> `window.pipelines`        (already bridged)
// - `activePipelineId` -> `window.activePipelineId` (newly bridged in this step)
//
// Inline `function foo(){}` declarations resolve via the global object even
// from module scope, but the established pattern in this codebase is to
// prefix them with `window.*` for clarity and debugging.
// - `formatCurrency` -> `window.formatCurrency`
// - `renderBoard`    -> `window.renderBoard`        (step 9b will extract; today
//                                                    it's the inline copy)
//
// References inside `onclick="..."` attribute strings (openPipelineModal,
// switchPipeline, editPipelineModal, deletePipelineConfirm) are LEFT BARE
// because those strings are parsed at click-time and resolve via window from
// the inline hoisted-function declarations.
//
// Module-local refs called bare from within the module:
// - `getActivePipeline`, `renderPipelineTabs` (same-file sibling calls)

export function getActivePipeline(){ return window.pipelines.find(p=>p.id===window.activePipelineId); }

export function renderPipelineTabs(){
  // Render left panel pipeline list
  const listEl = document.getElementById('pl-pipeline-list');
  const countEl = document.getElementById('pl-pipeline-count');
  if(!listEl) return;

  if(countEl) countEl.textContent = `${window.pipelines.length} pipeline${window.pipelines.length!==1?'s':''}`;

  if(!window.pipelines.length){
    listEl.innerHTML=`<div style="text-align:center;padding:24px 12px;color:var(--text3);font-size:12px">
      No pipelines yet.<br><br>
      <button class="btn btn-primary btn-sm" onclick="openPipelineModal('new-pipeline')">+ Create First Pipeline</button>
    </div>`;
    return;
  }

  listEl.innerHTML = window.pipelines.map(p=>{
    const totalDeals = p.deals?.length||0;
    const totalValue = p.deals?.reduce((s,d)=>s+(d.value||0),0)||0;
    const isActive = p.id===window.activePipelineId;
    return `
    <div class="pl-pipeline-card ${isActive?'active':''}" onclick="switchPipeline('${p.id}')">
      <div style="flex:1;min-width:0">
        <div class="pl-pipeline-name">${p.name}</div>
        <div class="pl-pipeline-meta">
          ${p.stages?.length||0} stages &nbsp;·&nbsp; ${totalDeals} deal${totalDeals!==1?'s':''}
          ${totalValue>0?`<br>${window.formatCurrency(totalValue)} total`:''}
        </div>
        <!-- Stage progress pills -->
        <div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:6px">
          ${(p.stages||[]).map(s=>{
            const cnt = (p.deals||[]).filter(d=>d.stage===s.id).length;
            return `<span style="font-size:9px;padding:1px 6px;border-radius:10px;background:${isActive?'rgba(0,210,255,.15)':'var(--bg4)'};color:${isActive?'var(--accent2)':'var(--text3)'}">${s.label} (${cnt})</span>`;
          }).join('')}
        </div>
      </div>
      <div class="pl-pipeline-actions" onclick="event.stopPropagation()">
        <div class="pl-pipeline-action" onclick="editPipelineModal('${p.id}')" title="Edit pipeline">✏️</div>
        <div class="pl-pipeline-action danger" onclick="deletePipelineConfirm('${p.id}')" title="Delete pipeline">🗑</div>
      </div>
    </div>`;
  }).join('');
}

export function switchPipeline(id){
  window.activePipelineId = id;
  renderPipelineTabs();
  window.renderBoard();
  // Show right panel
  const emptyEl = document.getElementById('pl-empty-state');
  const boardWrap = document.getElementById('pl-board-wrap');
  const addBtn = document.getElementById('pl-add-deal-btn');
  const nameEl = document.getElementById('pl-active-name');
  const statsEl = document.getElementById('pl-active-stats');
  const pl = window.pipelines.find(p=>p.id===id);
  if(emptyEl) emptyEl.style.display='none';
  if(boardWrap) boardWrap.style.display='flex';
  if(addBtn) addBtn.style.display='inline-flex';
  const stagesBtn = document.getElementById('pl-stages-btn');
  if(stagesBtn) stagesBtn.style.display='inline-flex';
  if(pl && nameEl) nameEl.textContent = pl.name;
  if(pl && statsEl){
    const totalVal = pl.deals?.reduce((s,d)=>s+(d.value||0),0)||0;
    statsEl.textContent = `${pl.deals?.length||0} deals · ${window.formatCurrency(totalVal)} total value`;
  }
}

export function refreshPipelineHeader(){
  const pl = getActivePipeline(); if(!pl) return;
  const nameEl = document.getElementById('pl-active-name');
  const statsEl = document.getElementById('pl-active-stats');
  if(nameEl) nameEl.textContent = pl.name;
  if(statsEl){
    const totalVal = pl.deals?.reduce((s,d)=>s+(d.value||0),0)||0;
    statsEl.textContent = `${pl.deals?.length||0} deals · ${window.formatCurrency(totalVal)} total value`;
  }
  // Also refresh left panel counts
  renderPipelineTabs();
}

window.__nlmPipelinesIndexLoaded = true;
