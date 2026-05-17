// NLM CRM - contacts filters + sort
//
// MIGRATION NOTE (step 8d of the modular extraction):
// Fourth file in src/contacts/. Strangler-fig: this module duplicates ~21
// filter/sort/dropdown functions from index.html (tag filters at lines
// ~3026-3118, source+pipeline filters at ~4161-4232, sort at ~4560-4598).
// Nothing imports from it yet; the inline copies are still authoritative
// for every callsite.
//
// Roadmap (per saved memory `target-layout-decision` and CONTINUE-HERE):
//   8a. helpers.js        DONE 601d472
//   8b. notes.js          DONE 8697d85
//   8c. import-export.js  DONE 176420e
//   8d-prep. STATE MIRROR DONE 21043c1 (Object.defineProperty bridges)
//   8d. filters.js        <- this file (filters + sort + dropdowns)
//   8e. selection.js      (bulk-select + view switcher)
//   8f. index.js          (renderContacts + table + state)
//
// ADAPTATIONS FROM VERBATIM (state vars via window.* thanks to the 8d-prep
// state mirror; function refs via window.* because module scope cannot
// resolve inline function declarations lexically):
//
// State (Object.defineProperty bridges from index.html):
// - `activeContactTagFilters` -> `window.activeContactTagFilters` (Set, mutated in place)
// - `activeSourceFilters`     -> `window.activeSourceFilters`     (Set, mutated in place)
// - `activePipelineFilter`    -> `window.activePipelineFilter`    (reassigned via setter)
// - `contactSort`             -> `window.contactSort`             (object, mutated in place)
// - `contactSources`          -> `window.contactSources`
// - `contacts`                -> `window.contacts`
// - `pipelines`               -> `window.pipelines`
// - `masterTags`              -> `window.masterTags`
// - `customColumns`           -> `window.customColumns`
//
// Function refs (inline `function foo(){}` is on window automatically):
// - `getMasterTag`            -> `window.getMasterTag`
// - `renderContacts`          -> `window.renderContacts`
//
// Module-local refs (defined in this file, called bare): every other helper
// in this module (renderContactTagFilters, renderTagFilterChips,
// closeAllContactDropdowns, updateSourceLabel, updatePipelineLabel,
// renderSourceDropdown, renderPipelineDropdown) is module-scoped and called
// without the window. prefix from within this module.
//
// References inside `onclick="..."` attribute strings (removeTagChip,
// selectTagFilter, clearSourceFilters, toggleSourceFilter, clearPipelineFilter,
// setPipelineFilter, setContactSort) are LEFT BARE because those strings are
// parsed at click-time by the HTML parser and resolve via window from the
// inline hoisted-function declarations.
//
// Two outside-click listeners (index.html ~3121 and ~4233) are NOT duplicated
// here. The inline copies remain the single source of click-outside handling;
// duplicating in the module would double-fire and waste cycles. When this
// module's callsites migrate, the inline listeners get deleted too.

// ───────────────── TAG FILTERS ─────────────────

export function renderContactTagFilters(){
  const clearBtn = document.getElementById('tag-filter-clear-btn');
  if(clearBtn) clearBtn.style.display = window.activeContactTagFilters.size>0 ? 'inline' : 'none';
  renderTagFilterChips();
}

export function renderTagFilterChips(){
  const el = document.getElementById('tag-filter-chips'); if(!el) return;
  el.innerHTML = [...window.activeContactTagFilters].map(label=>{
    const mt = window.getMasterTag(label);
    const cls = mt?.cls||'tag-blue';
    return `<span class="tag ${cls} tag-filter-chip">
      ${label}
      <span class="tag-filter-chip-x" onclick="event.stopPropagation();removeTagChip('${label.replace(/'/g,"\\'")}')">×</span>
    </span>`;
  }).join('');
  const input = document.getElementById('tag-filter-input');
  if(input) input.placeholder = window.activeContactTagFilters.size===0 ? 'Filter by tag…' : 'Add tag…';
}

export function removeTagChip(label){
  window.activeContactTagFilters.delete(label);
  renderContactTagFilters();
  window.renderContacts();
}

export function searchTagSuggestions(q){
  const dropdown = document.getElementById('tag-filter-dropdown'); if(!dropdown) return;
  const matches = window.masterTags.filter(t=>
    (q.trim()==='' || t.label.toLowerCase().includes(q.toLowerCase())) &&
    !window.activeContactTagFilters.has(t.label)
  );
  if(!matches.length){ dropdown.style.display='none'; return; }
  dropdown.style.display='block';
  dropdown.innerHTML = matches.slice(0,8).map(t=>{
    const escaped = t.label.replace(/'/g,"\\'");
    const highlighted = q.trim()
      ? t.label.replace(new RegExp('('+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')', 'gi'), '<strong style="color:var(--accent2)">$1</strong>')
      : t.label;
    return '<div class="tag-filter-option" onclick="selectTagFilter(\'' + escaped + '\')">'
      + '<span class="tag ' + t.cls + '" style="font-size:11px;padding:2px 8px">' + highlighted + '</span>'
      + '</div>';
  }).join('');
}

export function showAllTagSuggestions(){
  searchTagSuggestions('');
}

export function selectTagFilter(label){
  window.activeContactTagFilters.add(label);
  const input = document.getElementById('tag-filter-input');
  if(input) input.value='';
  const dropdown = document.getElementById('tag-filter-dropdown');
  if(dropdown) dropdown.style.display='none';
  renderContactTagFilters();
  window.renderContacts();
}

export function handleTagFilterKey(e){
  if(e.key==='Backspace' && !e.target.value && window.activeContactTagFilters.size>0){
    const last = [...window.activeContactTagFilters].pop();
    window.activeContactTagFilters.delete(last);
    renderContactTagFilters();
    window.renderContacts();
  }
  if(e.key==='Escape'){
    const dropdown = document.getElementById('tag-filter-dropdown');
    if(dropdown) dropdown.style.display='none';
  }
}

export function toggleContactTagFilter(label){
  if(window.activeContactTagFilters.has(label)) window.activeContactTagFilters.delete(label);
  else window.activeContactTagFilters.add(label);
  renderContactTagFilters();
  window.renderContacts();
}

export function clearContactTagFilters(){
  window.activeContactTagFilters.clear();
  const input = document.getElementById('tag-filter-input');
  if(input) input.value='';
  renderContactTagFilters();
  window.renderContacts();
}

// ───────────────── SOURCE FILTER ─────────────────

export function toggleSourceDropdown(){
  const dd=document.getElementById('source-filter-dropdown');
  const btn=document.getElementById('source-filter-btn');
  if(!dd) return;
  const isOpen=dd.style.display!=='none';
  closeAllContactDropdowns();
  if(!isOpen){dd.style.display='block';btn.classList.add('active');renderSourceDropdown();}
}

export function renderSourceDropdown(){
  const dd=document.getElementById('source-filter-dropdown');if(!dd)return;
  const usedSources=[...new Set(window.contacts.map(c=>c.source||'Other').filter(Boolean))].sort();
  const allSources=[...new Set([...usedSources,...window.contactSources])].sort();
  dd.innerHTML=`<div class="cf-filter-opt" onclick="clearSourceFilters()" style="border-bottom:1px solid var(--border);color:var(--text3);font-size:11px">All Sources</div>`+
    allSources.map(s=>`<div class="cf-filter-opt ${window.activeSourceFilters.has(s)?"selected":""}" onclick="toggleSourceFilter('${s}')">
      <div class="cf-filter-opt-check">${window.activeSourceFilters.has(s)?"✓":""}</div>
      ${s}
      <span style="margin-left:auto;font-size:10px;color:var(--text3)">${window.contacts.filter(c=>(c.source||"Other")===s).length}</span>
    </div>`).join("");
}

export function toggleSourceFilter(source){
  if(window.activeSourceFilters.has(source))window.activeSourceFilters.delete(source);
  else window.activeSourceFilters.add(source);
  updateSourceLabel();renderSourceDropdown();window.renderContacts();
}

export function clearSourceFilters(){window.activeSourceFilters.clear();updateSourceLabel();closeAllContactDropdowns();window.renderContacts();}

export function updateSourceLabel(){
  const el=document.getElementById("source-filter-label");
  const btn=document.getElementById("source-filter-btn");
  if(!el)return;
  if(window.activeSourceFilters.size===0){el.textContent="Source";el.style.color="var(--text3)";btn?.classList.remove("active");}
  else{el.textContent=window.activeSourceFilters.size===1?[...window.activeSourceFilters][0]:`${window.activeSourceFilters.size} sources`;el.style.color="var(--accent2)";btn?.classList.add("active");}
}

// ───────────────── PIPELINE FILTER ─────────────────

export function togglePipelineDropdown(){
  const dd=document.getElementById("pipeline-filter-dropdown");
  const btn=document.getElementById("pipeline-filter-btn");
  if(!dd)return;
  const isOpen=dd.style.display!=="none";
  closeAllContactDropdowns();
  if(!isOpen){dd.style.display="block";btn.classList.add("active");renderPipelineDropdown();}
}

export function renderPipelineDropdown(){
  const dd=document.getElementById("pipeline-filter-dropdown");if(!dd)return;
  let html=`<div class="cf-filter-opt" onclick="clearPipelineFilter()" style="border-bottom:1px solid var(--border);color:var(--text3);font-size:11px">All Pipelines</div>`;
  window.pipelines.forEach(p=>{
    html+=`<div style="padding:5px 12px 2px;font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">${p.name}</div>`;
    p.stages.forEach(s=>{
      const cnt=p.deals.filter(d=>d.stage===s.id).length;
      const isSel=window.activePipelineFilter?.stageId===s.id;
      html+=`<div class="cf-filter-opt ${isSel?"selected":""}" onclick="setPipelineFilter('${p.id}','${s.id}','${p.name} → ${s.label}')">
        <div class="cf-filter-opt-check">${isSel?"✓":""}</div>
        <span style="color:var(--accent2)">${s.label}</span>
        <span style="margin-left:auto;font-size:10px;color:var(--text3)">${cnt} deals</span>
      </div>`;
    });
  });
  if(!window.pipelines.length)html+=`<div class="cf-filter-opt" style="color:var(--text3)">No pipelines yet</div>`;
  dd.innerHTML=html;
}

export function setPipelineFilter(pipelineId,stageId,label){window.activePipelineFilter={pipelineId,stageId,label};updatePipelineLabel();closeAllContactDropdowns();window.renderContacts();}

export function clearPipelineFilter(){window.activePipelineFilter=null;updatePipelineLabel();closeAllContactDropdowns();window.renderContacts();}

export function updatePipelineLabel(){
  const el=document.getElementById("pipeline-filter-label");
  const btn=document.getElementById("pipeline-filter-btn");
  if(!el)return;
  if(!window.activePipelineFilter){el.textContent="Pipeline";el.style.color="var(--text3)";btn?.classList.remove("active");}
  else{el.textContent=window.activePipelineFilter.label;el.style.color="var(--accent2)";btn?.classList.add("active");}
}

export function closeAllContactDropdowns(){
  ["source-filter-dropdown","pipeline-filter-dropdown"].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display="none";});
  document.getElementById("source-filter-btn")?.classList.remove("active");
  document.getElementById("pipeline-filter-btn")?.classList.remove("active");
}

// ───────────────── SORT ─────────────────

export function setContactSort(col){
  if(window.contactSort.col===col) window.contactSort.dir = window.contactSort.dir==='asc'?'desc':'asc';
  else { window.contactSort.col=col; window.contactSort.dir='asc'; }
  window.renderContacts();
}

export function sortContactList(list){
  const {col, dir} = window.contactSort;
  const mul = dir==='asc' ? 1 : -1;
  return [...list].sort((a,b)=>{
    let av='', bv='';
    if(col==='name')    { av=a.name||''; bv=b.name||''; }
    if(col==='company') { av=a.company||''; bv=b.company||''; }
    if(col==='email')   { av=a.email||''; bv=b.email||''; }
    if(col==='source')  { av=a.source||''; bv=b.source||''; }
    if(col==='status')  { av=a.status||''; bv=b.status||''; }
    if(col==='created') { av=a.created_at||''; bv=b.created_at||''; }
    if(col==='lastActivity'){
      av=(a.last_activity&&a.last_activity.ts)||a.last_activity||'';
      bv=(b.last_activity&&b.last_activity.ts)||b.last_activity||'';
    }
    if(col==='pipeline'){
      const getStage=c=>{
        for(const p of window.pipelines){
          const d=p.deals.find(d=>d.name===c.name||(c.email&&d.company===c.company)||d.contactId===c.id);
          if(d){ const s=p.stages.find(s=>s.id===d.stage); return s?.label||''; }
        }
        return '';
      };
      av=getStage(a); bv=getStage(b);
    }
    const customCol = window.customColumns.find(c=>c.id===col);
    if(customCol){ av=(a.customFields||{})[col]||''; bv=(b.customFields||{})[col]||''; }
    if(av<bv) return -1*mul;
    if(av>bv) return  1*mul;
    return 0;
  });
}

window.__nlmContactsFiltersLoaded = true;
