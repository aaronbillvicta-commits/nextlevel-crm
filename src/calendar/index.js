// NLM CRM - Calendar (render + CRUD + state) - step 7c, last of the src/calendar/ extraction
//
// MIGRATION NOTE (step 7c of the modular extraction):
// Third and final file in src/calendar/. Verbatim duplicate of the entire CALENDAR
// block from index.html (~lines 7627-8549) MINUS the parts already extracted in
// steps 7a (holidays helpers) and 7b (date picker, lines ~8047-8205). Strangler-fig:
// the inline copy is still authoritative for every existing callsite (contact card,
// dialer, conversations). The module is purely additive; nothing imports it yet.
//
// WHY this module does NOT do `window.X = X` for its functions:
//   The calendar HTML wires up clicks via inline `onclick="renderCalendar()"`,
//   `onclick="editCalEvent('${id}')"`, etc. These resolve via the hoisted-function
//   globals from the inline <script>. Assigning the module's verbatim copies to
//   window would silently swap implementations while module state stays separate
//   from inline state - two calendars diverging. Same discipline as step 7b.
//
// STATE coupling (option (a) from the planning conversation):
//   Aaron picked "window.* globals" semantically but per strict strangler-fig the
//   actual move to shared state happens later. For step 7c, both module and inline
//   keep their OWN copies of calView/calDate/calEvents/calSources. They don't
//   interact because nothing imports the module yet. Future migration step will
//   either (i) switch inline `let calX` to `window.calX = window.calX || ...` so
//   both scopes share state, or (ii) migrate all callsites at once.
//
// ADAPTATIONS from verbatim (every bare identifier in module scope that refers
// to an inline-only global - module scope cannot resolve them lexically):
//   showToast            -> window.showToast
//   openModal/closeModal -> window.openModal / window.closeModal
//   sb                   -> window.sb
//   contacts             -> window.contacts
//   gcalIsConnected      -> window.gcalIsConnected
//   gcalAccessToken      -> window.gcalAccessToken
//   getAv                -> window.getAv (used inside `${...}` template expr)
//   initials             -> window.initials (used inside `${...}` template expr)
//   followupTypeChip     -> window.followupTypeChip (used inside `${...}` template expr)
// References that live INSIDE onclick="..." attribute strings (renderCalendar,
// editCalEvent, openFollowupModal, etc.) are LEFT BARE because those strings are
// parsed at click-time and resolve via window from inline.
//
// US-HOLIDAY HELPERS (_nthWeekday/_lastWeekday/_ymd/getUsHolidaysForYear) are
// re-declared here verbatim instead of imported from ./holidays.js. Duplication is
// the strangler-fig cost; importing would create a coupling that nothing else uses
// yet, and we'd still have inline copies in index.html.
//
// Roadmap after this step:
//   - Migrate callsites one at a time (contact card -> import { saveCalEvents, openFollowupModal },
//     dialer follow-up flow -> ditto). Each migration is its own deploy.
//   - When all callsites use the module, delete the inline CALENDAR block.
//   - At that point unify state by switching to window.calX shared across modules.

// ═══════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════
let calView = 'month';
let calDate = new Date();
let calEvents = [];
let calSources = JSON.parse(localStorage.getItem('nlm_cal_sources')||'[{"id":"crm","name":"CRM Events","color":"#4f7ef8","active":true}]');
// Migrations for built-in calendar sources. Existing users may already have
// 'us-holidays' in localStorage but be missing 'followups', so check each.
{
  let _calSourcesChanged = false;
  if(!calSources.find(s=>s.id==='followups')){
    // Default destination for every scheduled follow-up. Keep it ABOVE crm in
    // the chip row so the green "Follow-ups" pill is easy to find.
    calSources.unshift({ id:'followups', name:'Follow-ups', color:'#3ecf8e', active:true, builtin:true });
    _calSourcesChanged = true;
  }
  if(!calSources.find(s=>s.id==='us-holidays')){
    calSources.push({ id:'us-holidays', name:'US Holidays', color:'#d97bba', active:true, builtin:true });
    _calSourcesChanged = true;
  }
  if(_calSourcesChanged) localStorage.setItem('nlm_cal_sources', JSON.stringify(calSources));
}

const CAL_COLORS = ['#4f7ef8','#3ecf8e','#f59e3f','#d97bba','#f26b6b','#2dd4bf','#a78bfa'];
const CAL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const CAL_DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// ═══════════════════════════════════════════════
// US FEDERAL HOLIDAYS (also live in ./holidays.js as a smaller pure-helpers
// module; re-declared here verbatim to keep this extraction additive only)
// ═══════════════════════════════════════════════
function _nthWeekday(year, month, weekday, n){
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (n-1)*7);
}
function _lastWeekday(year, month, weekday){
  const last = new Date(year, month+1, 0);
  const offset = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month, last.getDate() - offset);
}
function _ymd(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function getUsHolidaysForYear(year){
  return [
    { date: `${year}-01-01`,                   name: "New Year's Day" },
    { date: _ymd(_nthWeekday(year, 0, 1, 3)),  name: "Martin Luther King Jr. Day" },
    { date: _ymd(_nthWeekday(year, 1, 1, 3)),  name: "Presidents' Day" },
    { date: _ymd(_lastWeekday(year, 4, 1)),    name: "Memorial Day" },
    { date: `${year}-06-19`,                   name: "Juneteenth" },
    { date: `${year}-07-04`,                   name: "Independence Day" },
    { date: _ymd(_nthWeekday(year, 8, 1, 1)),  name: "Labor Day" },
    { date: _ymd(_nthWeekday(year, 9, 1, 2)),  name: "Columbus Day" },
    { date: `${year}-11-11`,                   name: "Veterans Day" },
    { date: _ymd(_nthWeekday(year, 10, 4, 4)), name: "Thanksgiving Day" },
    { date: `${year}-12-25`,                   name: "Christmas Day" },
  ];
}
function getUsHolidayEvents(){
  const src = calSources.find(s=>s.id==='us-holidays');
  if(!src || !src.active) return [];
  const thisYear = (new Date()).getFullYear();
  const out = [];
  for(let y=thisYear-1; y<=thisYear+2; y++){
    for(const h of getUsHolidaysForYear(y)){
      out.push({
        id: `hol_${h.date}`,
        title: h.name,
        start: `${h.date}T12:00:00`,
        end:   `${h.date}T13:00:00`,
        sourceId: 'us-holidays',
        notes: 'US federal holiday',
        contactId: null,
        isHoliday: true,
      });
    }
  }
  return out;
}

// Merged event source - real CRM events + virtual holiday events when active.
// Applies the active-calendar filter and (optionally) the contact filter.
export function getVisibleCalEvents({ applyContactFilter = true } = {}){
  const activeSourceIds = calSources.filter(s=>s.active).map(s=>s.id);
  const all = [...calEvents, ...getUsHolidayEvents()];
  return all.filter(ev=>{
    if(!activeSourceIds.includes(ev.sourceId||'crm')) return false;
    if(applyContactFilter && calContactFilter && !ev.isHoliday && ev.contactId!==calContactFilter) return false;
    return true;
  });
}

export async function saveCalEvents(){
  if(!calEvents.length) return;
  try {
    await window.sb.upsert('calendar_events', calEvents.map(e=>({
      id: e.id, title: e.title, start_time: e.start, end_time: e.end,
      source_id: e.sourceId||'crm', notes: e.notes||'',
      contact_id: e.contactId||null, gcal_id: e.gcalId||null,
      gcal_link: e.gcalLink||null, meet_link: e.meetLink||null,
      followup_type: e.followupType||null
    })), 'id');
  } catch(e){
    console.error('saveCalEvents:', e);
    // Surface the failure - this used to silently eat errors, which hid
    // a missing-table bug for weeks. If the save fails again, show it.
    const msg = (e && (e.message || e.error || e.code)) || 'unknown error';
    if(typeof window.showToast==='function') window.showToast(`Couldn't save calendar event: ${msg}`,'error');
  }
}
export function saveCalSources(){ localStorage.setItem('nlm_cal_sources', JSON.stringify(calSources)); }

// ═══════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════
export function renderCalendar(){
  renderCalSources();
  renderCalHeader();
  if(calView==='month') renderMonthGrid();
  else if(calView==='week') renderWeekGrid();
  else renderDayGrid();
  renderFollowupsList();
  renderUpcomingEvents();
}

function hexAlpha(hex,a){ return hex+'33'.slice(0,Math.round(a*255).toString(16).length+1); }

export function toggleCalSource(id){
  const s = calSources.find(x=>x.id===id);
  if(s){ s.active=!s.active; saveCalSources(); renderCalendar(); }
}

function renderCalHeader(){
  const el = document.getElementById('cal-header'); if(!el) return;
  let label = '';
  if(calView==='month') label = `${CAL_MONTHS[calDate.getMonth()]} ${calDate.getFullYear()}`;
  else if(calView==='week'){
    const start = new Date(calDate); start.setDate(calDate.getDate()-calDate.getDay());
    const end   = new Date(start); end.setDate(start.getDate()+6);
    label = `${CAL_MONTHS[start.getMonth()]} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
  } else {
    label = `${CAL_DAYS[calDate.getDay()]}, ${CAL_MONTHS[calDate.getMonth()]} ${calDate.getDate()}, ${calDate.getFullYear()}`;
  }
  el.textContent = label;
}

function renderMonthGrid(){
  const grid = document.getElementById('cal-grid'); if(!grid) return;
  const year = calDate.getFullYear(), month = calDate.getMonth();
  const firstDay = new Date(year,month,1).getDay();
  const daysInMonth = new Date(year,month+1,0).getDate();
  const today = new Date();
  const visible = getVisibleCalEvents();

  let html = `<div class="cal-day-headers">${CAL_DAYS.map(d=>`<div class="cal-day-hdr">${d}</div>`).join('')}</div><div class="cal-days">`;

  // Prev month padding
  const prevDays = new Date(year,month,0).getDate();
  for(let i=firstDay-1;i>=0;i--){
    html += `<div class="cal-cell other-month"><div class="cal-date">${prevDays-i}</div></div>`;
  }

  for(let d=1;d<=daysInMonth;d++){
    const isToday = d===today.getDate()&&month===today.getMonth()&&year===today.getFullYear();
    const dayEvents = visible.filter(ev=>{
      const ed = new Date(ev.start);
      return ed.getDate()===d&&ed.getMonth()===month&&ed.getFullYear()===year;
    });
    html += `<div class="cal-cell ${isToday?'today':''}" onclick="openEventModal(new Date(${year},${month},${d}))">
      <div class="cal-date">${d}</div>
      ${dayEvents.slice(0,3).map(ev=>{
        const src = calSources.find(s=>s.id===(ev.sourceId||'crm'));
        const color = src?.color || '#4f7ef8';
        const click = ev.isHoliday ? '' : `onclick="event.stopPropagation();editCalEvent('${ev.id}')"`;
        const style = `background:${color}22;color:${color};border-left:2px solid ${color}`;
        return `<div class="cal-event" style="${style}" ${click} title="${ev.title}">${ev.title}</div>`;
      }).join('')}
      ${dayEvents.length>3?`<div style="font-size:10px;color:var(--text3)">+${dayEvents.length-3} more</div>`:''}
    </div>`;
  }

  const remaining = 42-(firstDay+daysInMonth);
  for(let d=1;d<=remaining;d++){
    html += `<div class="cal-cell other-month"><div class="cal-date">${d}</div></div>`;
  }
  html += '</div>';
  grid.innerHTML = html;
}

function renderWeekGrid(){
  const grid = document.getElementById('cal-grid'); if(!grid) return;
  const start = new Date(calDate); start.setDate(calDate.getDate()-calDate.getDay());
  const today = new Date();
  const visible = getVisibleCalEvents();
  let html = `<div class="cal-day-headers">`;
  for(let i=0;i<7;i++){
    const d = new Date(start); d.setDate(start.getDate()+i);
    const isToday = d.toDateString()===today.toDateString();
    html += `<div class="cal-day-hdr" style="${isToday?'color:var(--accent2)':''}">${CAL_DAYS[d.getDay()]} ${d.getDate()}</div>`;
  }
  html += '</div><div class="cal-days">';
  for(let i=0;i<7;i++){
    const d = new Date(start); d.setDate(start.getDate()+i);
    const isToday = d.toDateString()===today.toDateString();
    const dayEvents = visible.filter(ev=>{
      const ed = new Date(ev.start);
      return ed.toDateString()===d.toDateString();
    });
    html += `<div class="cal-cell ${isToday?'today':''}" style="min-height:200px" onclick="openEventModal(new Date('${d.toISOString()}'))">
      ${dayEvents.map(ev=>{
        const src = calSources.find(s=>s.id===(ev.sourceId||'crm'));
        const color = src?.color || '#4f7ef8';
        const click = ev.isHoliday ? '' : `onclick="event.stopPropagation();editCalEvent('${ev.id}')"`;
        const style = `background:${color}22;color:${color};border-left:2px solid ${color}`;
        return `<div class="cal-event" style="${style}" ${click} title="${ev.title}">${ev.title}</div>`;
      }).join('')}
    </div>`;
  }
  html += '</div>';
  grid.innerHTML = html;
}

function renderDayGrid(){
  const grid = document.getElementById('cal-grid'); if(!grid) return;
  const dayEvents = getVisibleCalEvents().filter(ev=>{
    const ed = new Date(ev.start);
    return ed.toDateString()===calDate.toDateString();
  });
  grid.innerHTML = `<div style="padding:16px">
    ${dayEvents.length===0?'<div style="color:var(--text3);font-size:13px;text-align:center;padding:40px">No events today. Click + New Event to add one.</div>':''}
    ${dayEvents.map(ev=>{
      const src = calSources.find(s=>s.id===(ev.sourceId||'crm'));
      const color = src?.color || '#4f7ef8';
      const click = ev.isHoliday ? '' : `onclick="editCalEvent('${ev.id}')"`;
      const style = `background:${color}22;color:${color};border-left:3px solid ${color};padding:10px 14px;margin-bottom:8px;border-radius:var(--radius);font-size:13px`;
      return `<div class="cal-event" style="${style}" ${click}>
        <div style="font-weight:600;margin-bottom:2px">${ev.title}</div>
        <div style="font-size:11px;opacity:.7">${ev.isHoliday?'All day':(ev.start?new Date(ev.start).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'')} ${ev.notes?'· '+ev.notes:''}</div>
      </div>`;
    }).join('')}
  </div>`;
}

export function setCalView(v,btn){
  calView=v;
  document.querySelectorAll('.cal-view-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderCalendar();
}

export function calNavigate(dir){
  if(calView==='month'){ calDate=new Date(calDate.getFullYear(),calDate.getMonth()+dir,1); }
  else if(calView==='week'){ calDate=new Date(calDate); calDate.setDate(calDate.getDate()+dir*7); }
  else { calDate=new Date(calDate); calDate.setDate(calDate.getDate()+dir); }
  renderCalendar();
}

export function calToday(){ calDate=new Date(); renderCalendar(); }

// ── CONTACT FILTER FOR CALENDAR ──
let calContactFilter = null;

export function filterCalByContact(q){
  const listEl = document.getElementById('cal-contact-filter-list');
  if(!q.trim()){ listEl.style.display='none'; return; }
  const matches = window.contacts.filter(c=>(c.name||'').toLowerCase().includes(q.toLowerCase())).slice(0,6);
  if(!matches.length){ listEl.style.display='none'; return; }
  listEl.style.display='block';
  listEl.innerHTML = matches.map(c=>`
    <div onclick="setCalContactFilter('${c.id}')" style="padding:7px 10px;cursor:pointer;font-size:12px;color:var(--text);display:flex;align-items:center;gap:8px;transition:background .12s" onmouseenter="this.style.background='var(--bg4)'" onmouseleave="this.style.background=''">
      <div class="av-sm ${window.getAv(c.id)}" style="width:22px;height:22px;font-size:9px">${window.initials(c.name)}</div>
      <div><div style="font-weight:500">${c.name}</div><div style="font-size:10px;color:var(--text3)">${c.company||''}</div></div>
    </div>`).join('');
}

export function setCalContactFilter(id){
  calContactFilter = id;
  const c = window.contacts.find(x=>x.id===id);
  document.getElementById('cal-contact-filter').value = '';
  document.getElementById('cal-contact-filter-list').style.display='none';
  const activeEl = document.getElementById('cal-contact-filter-active');
  if(activeEl && c) activeEl.innerHTML=`<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:var(--accent-bg);border:1px solid var(--accent-border);border-radius:var(--radius);font-size:11px;color:var(--accent2)">
    Showing: <strong>${c.name}</strong>
    <span onclick="clearCalContactFilter()" style="cursor:pointer;margin-left:auto;color:var(--text3);font-size:14px;line-height:1">×</span>
  </div>`;
  renderCalendar();
}

export function clearCalContactFilter(){
  calContactFilter = null;
  document.getElementById('cal-contact-filter-active').innerHTML='';
  renderCalendar();
}

// Patch getFilteredCalEvents to use contact filter
export function getCalEventsForDay(year, month, d){
  return calEvents.filter(ev=>{
    const ed = new Date(ev.start);
    const matchDay = ed.getDate()===d && ed.getMonth()===month && ed.getFullYear()===year;
    const activeSourceIds = calSources.filter(s=>s.active).map(s=>s.id);
    const matchSource = activeSourceIds.includes(ev.sourceId||'crm');
    const matchContact = !calContactFilter || ev.contactId===calContactFilter;
    return matchDay && matchSource && matchContact;
  });
}

// ═══════════════════════════════════════════════
// UPCOMING EVENTS / FOLLOW-UPS LIST
// ═══════════════════════════════════════════════

// Shared filter: future, non-holiday, optionally follow-ups only.
function _getUpcomingFiltered(opts = {}){
  const now = new Date();
  let list = getVisibleCalEvents().filter(ev => !ev.isHoliday && new Date(ev.start) >= now);
  if(opts.followupsOnly){
    list = list.filter(ev => ev.sourceId === 'followups' || /^Follow-up:/i.test(ev.title||''));
  }
  return list.sort((a,b) => new Date(a.start) - new Date(b.start));
}

// Shared item rendering for both the sidebar panel and the "View all" modal.
function _eventItemHTML(ev){
  const src = calSources.find(s => s.id === (ev.sourceId||'crm'));
  const color = src?.color || 'var(--accent)';
  const d = new Date(ev.start);
  const dateStr = d.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'});
  const timeStr = d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  const contact = ev.contactId ? window.contacts.find(c => c.id === ev.contactId) : null;
  // Follow-ups open the dedicated follow-up scheduler (delete/reschedule).
  // Other events still go through the generic Event editor.
  const isFollowup = (ev.sourceId === 'followups' || /^Follow-up:/i.test(ev.title||'')) && ev.contactId;
  const click = isFollowup
    ? `openFollowupModal('${ev.contactId}','${ev.id}')`
    : `editCalEvent('${ev.id}')`;
  return `<div class="cal-upcoming-item" onclick="${click}">
    <div style="display:flex;gap:8px;align-items:flex-start">
      <div class="cal-upcoming-dot" style="background:${color};margin-top:4px"></div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px">
          <div class="cal-upcoming-title" style="margin-bottom:0">${ev.title}</div>
          ${ev.followupType?window.followupTypeChip(ev.followupType):''}
        </div>
        <div class="cal-upcoming-time" style="margin-top:3px">${dateStr} · ${timeStr}</div>
        ${contact?`<div style="font-size:10px;color:var(--text3);margin-top:2px">👤 ${contact.name}</div>`:''}
      </div>
    </div>
  </div>`;
}

// Render an in-panel list capped at 5 visible rows. The container itself
// is `overflow-y:auto` so item 6+ are reachable by scrolling, and the
// caller's "View all" button is shown/hidden based on the returned count.
function _renderEventsList(targetId, opts = {}){
  const el = document.getElementById(targetId); if(!el) return 0;
  const list = _getUpcomingFiltered(opts);

  if(!list.length){
    el.style.maxHeight = ''; el.style.overflowY = '';
    el.innerHTML = `<div style="font-size:12px;color:var(--text3);text-align:center;padding:12px 0">${opts.emptyMessage||'No upcoming events'}</div>`;
    return 0;
  }

  // ~5 items x ~56px each. The exact height isn't critical - overflow:auto
  // handles overflow regardless. The cap just keeps the sidebar tidy.
  el.style.maxHeight = '290px';
  el.style.overflowY = 'auto';
  el.innerHTML = list.map(_eventItemHTML).join('');
  return list.length;
}

// "View all" popup - same filter, no row cap, taller scroll area.
export function openEventsListModal(opts = {}){
  const list = _getUpcomingFiltered(opts);
  const title = opts.title || (opts.followupsOnly ? 'All Scheduled Follow-ups' : 'All Upcoming Events');
  const body = list.length
    ? `<div style="max-height:60vh;overflow-y:auto">${list.map(_eventItemHTML).join('')}</div>`
    : `<div style="font-size:13px;color:var(--text3);text-align:center;padding:28px 0">${opts.emptyMessage||'No upcoming events'}</div>`;
  window.openModal(`
    <div class="modal-head">
      <div>
        <div class="modal-title">${title}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">${list.length} item${list.length===1?'':'s'}</div>
      </div>
      <span class="modal-close" onclick="closeModal()">×</span>
    </div>
    <div class="modal-body" style="padding:14px 18px">${body}</div>
    <div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()">Done</button></div>
  `);
}

// Show/hide the "View all (N)" button in the sidebar based on the
// rendered list count. The button lives in a stable DOM node next to
// the scrollable list (see HTML in #page-calendar sidebar).
function _setViewAllVisibility(footerId, count){
  const f = document.getElementById(footerId);
  if(!f) return;
  if(count > 5){
    f.style.display = 'block';
    const btn = f.querySelector('button');
    if(btn){
      // Only the count text changes - re-grab to keep onclick attached.
      const txt = btn.querySelector('.vall-count');
      if(txt) txt.textContent = `(${count})`;
    }
  } else {
    f.style.display = 'none';
  }
}

export function renderUpcomingEvents(){
  const n = _renderEventsList('cal-upcoming-list', {});
  _setViewAllVisibility('cal-upcoming-viewall', n);
}

export function renderFollowupsList(){
  const n = _renderEventsList('cal-followups-list', {
    followupsOnly: true,
    emptyMessage: 'No follow-ups scheduled'
  });
  _setViewAllVisibility('cal-followups-viewall', n);
  const countEl = document.getElementById('cal-followups-count');
  if(countEl) countEl.textContent = n ? `(${n})` : '';
}

// ═══════════════════════════════════════════════
// NEW EVENT MODAL (fully synced to Google Calendar)
// ═══════════════════════════════════════════════
let _evGuests = []; // [{email, optional}]
let _evStartISO = null;

export function openEventModal(date){
  _evGuests = [];
  _evStartISO = null;
  const d = date||new Date();
  d.setMinutes(0,0,0);
  if(!date) d.setHours(d.getHours()+1);

  const sourceOpts = calSources.filter(s=>!s.builtin).map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
  const contactOpts = `<option value="">— none —</option>`+window.contacts.map(c=>`<option value="${c.id}" data-email="${c.email||''}">${c.name}</option>`).join('');
  const gcalConnected = window.gcalIsConnected();

  window.openModal(`
    <div class="modal-head">
      <div>
        <div class="modal-title">New Event</div>
        ${gcalConnected?`<div style="font-size:11px;color:var(--green);margin-top:2px">✓ Will sync to Google Calendar</div>`:
          `<div style="font-size:11px;color:var(--amber);margin-top:2px">⚠ Connect Google Calendar in Integrations to sync</div>`}
      </div>
      <span class="modal-close" onclick="closeModal()">×</span>
    </div>
    <div class="modal-body">

      <!-- Title -->
      <div class="form-group">
        <label class="form-label">Event Title</label>
        <input class="form-input" id="ev-title" placeholder="Discovery Call with Maria Santos…"/>
      </div>

      <!-- Date/Time picker -->
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Date & Time</label>
          <div class="datepicker-display" id="ev-start-picker" data-value="" onclick="openDatePicker('ev-start-picker','',function(iso){_evStartISO=iso;updateEvEndFromDuration();})">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span class="dp-display-val" style="color:var(--text3)">Pick date & time…</span>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Duration</label>
          <div style="display:flex;align-items:center;gap:6px">
            <input class="form-input" id="ev-duration" type="number" value="30" min="5" step="5" style="width:70px" oninput="updateEvEndFromDuration()"/>
            <span style="font-size:12px;color:var(--text3)">mins</span>
          </div>
          <div class="dur-presets">
            <div class="dur-preset-btn active" onclick="setEvDuration(30,this)">30 min</div>
            <div class="dur-preset-btn" onclick="setEvDuration(45,this)">45 min</div>
            <div class="dur-preset-btn" onclick="setEvDuration(60,this)">1 hour</div>
          </div>
        </div>
      </div>

      <!-- Source + Contact -->
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Calendar</label>
          <select class="form-select" id="ev-source">${sourceOpts}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Contact (auto-fills email)</label>
          <select class="form-select" id="ev-contact" onchange="evAutoFillGuest(this)">${contactOpts}</select>
        </div>
      </div>

      <!-- Guests / Recipients -->
      <div class="form-group">
        <label class="form-label">Guest Emails <span style="color:var(--text3);font-weight:400">(multiple supported)</span></label>
        <div style="display:flex;gap:6px;align-items:center">
          <input class="form-input" id="ev-guest-input" placeholder="guest@email.com" style="flex:1" onkeydown="if(event.key==='Enter'){event.preventDefault();addEvGuest()}"/>
          <select class="form-select" id="ev-guest-optional" style="width:auto;font-size:11px;padding:8px">
            <option value="no">Required</option>
            <option value="yes">Optional</option>
          </select>
          <button class="btn btn-sm" onclick="addEvGuest()">Add</button>
        </div>
        <div class="guest-list" id="ev-guest-list"></div>
      </div>

      <!-- Video conference -->
      <div class="form-group">
        <label class="form-label">Video Conference</label>
        <select class="form-select" id="ev-conference">
          <option value="none">No video link</option>
          <option value="meet">Google Meet</option>
        </select>
      </div>

      <!-- Notes -->
      <div class="form-group">
        <label class="form-label">Description / Agenda</label>
        <textarea class="form-textarea" id="ev-notes" placeholder="Meeting agenda, talking points…" style="min-height:70px"></textarea>
      </div>

    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveCalEvent()">
        ${gcalConnected?'Create Event & Sync to Google':'Save Event'}
      </button>
    </div>`, true);

  // Set initial date
  const initISO = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:00`;
  _evStartISO = initISO;
  const picker = document.getElementById('ev-start-picker');
  if(picker){
    picker.dataset.value = initISO;
    const span = picker.querySelector('.dp-display-val');
    if(span) span.textContent = d.toLocaleString([],{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    span.style.color = 'var(--text)';
  }
  // Re-bind picker with correct initial value
  picker.onclick = ()=>openDatePicker('ev-start-picker', initISO, (iso)=>{_evStartISO=iso; updateEvEndFromDuration(); const sp=picker.querySelector('.dp-display-val'); if(sp){sp.textContent=new Date(iso).toLocaleString([],{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});sp.style.color='var(--text)';}});
}

export function setEvDuration(mins, btn){
  document.getElementById('ev-duration').value = mins;
  document.querySelectorAll('.dur-preset-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  updateEvEndFromDuration();
}

export function updateEvEndFromDuration(){
  if(!_evStartISO) return;
  const dur = parseInt(document.getElementById('ev-duration')?.value)||30;
  const end = new Date(new Date(_evStartISO).getTime() + dur*60000);
  window._evEndISO = end.toISOString();
}

export function evAutoFillGuest(sel){
  const opt = sel.options[sel.selectedIndex];
  const email = opt?.dataset?.email;
  if(email && email.includes('@')){
    const input = document.getElementById('ev-guest-input');
    if(input) input.value = email;
  }
}

export function addEvGuest(){
  const input = document.getElementById('ev-guest-input');
  const optSel = document.getElementById('ev-guest-optional');
  const email = input?.value.trim().toLowerCase();
  if(!email||!email.includes('@')){ window.showToast('Enter a valid email','error'); return; }
  if(_evGuests.find(g=>g.email===email)){ window.showToast('Already added','error'); return; }
  _evGuests.push({ email, optional: optSel?.value==='yes' });
  input.value='';
  renderEvGuestList();
}

export function removeEvGuest(email){
  _evGuests = _evGuests.filter(g=>g.email!==email);
  renderEvGuestList();
}

function renderEvGuestList(){
  const el = document.getElementById('ev-guest-list'); if(!el) return;
  el.innerHTML = _evGuests.map(g=>`
    <div class="guest-row">
      <span class="guest-email">${g.email}</span>
      <span class="guest-optional ${g.optional?'guest-opt-yes':'guest-opt-no'}">${g.optional?'Optional':'Required'}</span>
      <span class="guest-del" onclick="removeEvGuest('${g.email}')">×</span>
    </div>`).join('');
}

export async function saveCalEvent(){
  const title    = document.getElementById('ev-title')?.value.trim();
  const src      = document.getElementById('ev-source')?.value;
  const notes    = document.getElementById('ev-notes')?.value.trim();
  const contactId= document.getElementById('ev-contact')?.value;
  const conf     = document.getElementById('ev-conference')?.value;
  const dur      = parseInt(document.getElementById('ev-duration')?.value)||30;

  if(!title){ window.showToast('Enter an event title','error'); return; }
  if(!_evStartISO){ window.showToast('Pick a date and time','error'); return; }

  const startISO = new Date(_evStartISO).toISOString();
  const endISO   = new Date(new Date(_evStartISO).getTime()+dur*60000).toISOString();

  // Save to CRM calendar
  const evId = 'ev_'+Date.now();
  calEvents.push({ id:evId, title, start:startISO, end:endISO, sourceId:src, notes, contactId });
  saveCalEvents();

  // Sync to Google Calendar if connected
  if(window.gcalIsConnected()){
    const btn = document.querySelector('.modal-foot .btn-primary');
    if(btn){ btn.textContent='Creating…'; btn.disabled=true; }
    try {
      const event = {
        summary: title,
        description: notes||'',
        start:{ dateTime: startISO, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        end:  { dateTime: endISO,   timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        attendees: _evGuests.map(g=>({ email:g.email, optional:g.optional })),
        sendUpdates: _evGuests.length?'all':'none',
      };
      if(conf==='meet'){
        event.conferenceData={ createRequest:{ requestId:'nlm-'+Date.now(), conferenceSolutionKey:{type:'hangoutsMeet'} }};
      }
      const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${conf==='meet'?'conferenceDataVersion=1&':''}sendUpdates=${_evGuests.length?'all':'none'}`;
      const r = await fetch(url,{
        method:'POST',
        headers:{'Authorization':'Bearer '+window.gcalAccessToken,'Content-Type':'application/json'},
        body: JSON.stringify(event)
      });
      const data = await r.json();
      if(r.ok){
        const meetLink = data.conferenceData?.entryPoints?.find(e=>e.entryPointType==='video')?.uri||'';
        // Update CRM event with Google link
        const ev = calEvents.find(e=>e.id===evId);
        if(ev){ ev.gcalId=data.id; ev.gcalLink=data.htmlLink; ev.meetLink=meetLink; saveCalEvents(); }
        window.closeModal();
        renderCalendar();
        renderUpcomingEvents();
        const guestNames = _evGuests.length ? ` · Invite sent to ${_evGuests.length} guest(s)` : '';
        window.showToast(`✅ Event synced to Google Calendar${guestNames}`);
      } else {
        window.closeModal(); renderCalendar(); renderUpcomingEvents();
        window.showToast('Saved locally (Google Calendar error: '+data.error?.message+')','error');
      }
    } catch(e){
      window.closeModal(); renderCalendar(); renderUpcomingEvents();
      window.showToast('Saved locally (network error)','error');
    }
  } else {
    window.closeModal();
    renderCalendar();
    renderUpcomingEvents();
    window.showToast('Event saved!');
  }
}

export function editCalEvent(id){
  const ev = calEvents.find(e=>e.id===id); if(!ev) return;
  window.openModal(`
    <div class="modal-head"><div class="modal-title">Edit Event</div><span class="modal-close" onclick="closeModal()">×</span></div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Title</label><input class="form-input" id="ev-title" value="${ev.title}"/></div>
      <div class="form-group"><label class="form-label">Date & Time</label>
        <div class="datepicker-display" id="ev-start-picker" data-value="${ev.start||''}" onclick="openDatePicker('ev-start-picker','${ev.start||''}',function(iso){_evStartISO=iso;const sp=document.getElementById('ev-start-picker').querySelector('.dp-display-val');if(sp){sp.textContent=new Date(iso).toLocaleString([],{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});sp.style.color='var(--text)';}})">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <span class="dp-display-val" style="color:var(--text)">${ev.start?new Date(ev.start).toLocaleString([],{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'Pick date…'}</span>
        </div>
      </div>
      <div class="form-group"><label class="form-label">Calendar</label>
        <select class="form-select" id="ev-source">${calSources.filter(s=>!s.builtin).map(s=>`<option value="${s.id}" ${s.id===ev.sourceId?'selected':''}>${s.name}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label class="form-label">Notes</label><textarea class="form-textarea" id="ev-notes">${ev.notes||''}</textarea></div>
      ${ev.gcalLink?`<div style="margin-top:8px"><a href="${ev.gcalLink}" target="_blank" class="btn btn-sm" style="color:var(--green)">Open in Google Calendar →</a>${ev.meetLink?` <a href="${ev.meetLink}" target="_blank" class="btn btn-sm" style="color:var(--accent2)">Join Meet →</a>`:''}</div>`:''}
    </div>
    <div class="modal-foot">
      <button class="btn btn-danger btn-sm" onclick="deleteCalEvent('${id}')">Delete</button>
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="updateCalEvent('${id}')">Save</button>
    </div>`);
  _evStartISO = ev.start||null;
}

export function updateCalEvent(id){
  const ev = calEvents.find(e=>e.id===id); if(!ev) return;
  ev.title    = document.getElementById('ev-title')?.value.trim()||ev.title;
  ev.start    = _evStartISO||ev.start;
  ev.sourceId = document.getElementById('ev-source')?.value;
  ev.notes    = document.getElementById('ev-notes')?.value.trim();
  saveCalEvents(); window.closeModal(); renderCalendar(); renderUpcomingEvents(); window.showToast('Event updated!');
}

export async function deleteCalEvent(id){
  if(!confirm('Delete this event?')) return;
  calEvents = calEvents.filter(e=>e.id!==id);
  try { await window.sb.del('calendar_events', id); } catch(e){}
  window.closeModal(); renderCalendar(); renderUpcomingEvents(); window.showToast('Event deleted');
}

// ═══════════════════════════════════════════════
// CALENDAR SOURCES (with remove option)
// ═══════════════════════════════════════════════
export function renderCalSources(){
  const el = document.getElementById('cal-sources'); if(!el) return;
  el.innerHTML = calSources.map(s=>`
    <div class="cal-source-chip ${s.active?'active':''}"
      style="background:${s.active?s.color+'20':'var(--bg3)'};color:${s.active?s.color:'var(--text3)'};border-color:${s.active?s.color+'44':'var(--border)'};display:inline-flex;align-items:center;gap:5px;padding:3px 8px 3px 10px;border-radius:20px;font-size:11px;font-weight:500;cursor:pointer;border:1px solid;transition:all .15s">
      <div class="cal-source-dot" style="background:${s.color};width:7px;height:7px;border-radius:50%;flex-shrink:0"></div>
      <span onclick="toggleCalSource('${s.id}')">${s.name}</span>
      <span onclick="removeCalSource('${s.id}')" title="Remove calendar" style="margin-left:2px;color:${s.active?s.color:'var(--text3)'};opacity:.6;font-size:14px;line-height:1;cursor:pointer;transition:opacity .12s" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='.6'">×</span>
    </div>`).join('');
}

export function removeCalSource(id){
  if(calSources.length<=1){ window.showToast("Can't remove the only calendar",'error'); return; }
  const src = calSources.find(s=>s.id===id);
  if(src?.builtin){ window.showToast(`"${src.name}" is built-in — toggle it off instead`,'error'); return; }
  if(!confirm(`Remove calendar "${src?.name}"?`)) return;
  calSources = calSources.filter(s=>s.id!==id);
  saveCalSources(); renderCalendar(); window.showToast(`Calendar removed`);
}

export function openCalSourceModal(){
  const gcalConnected = window.gcalIsConnected();
  const gcalEmail = localStorage.getItem('nlm_gcal_email')||'';
  window.openModal(`
    <div class="modal-head"><div class="modal-title">Add Calendar</div><span class="modal-close" onclick="closeModal()">×</span></div>
    <div class="modal-body">
      ${gcalConnected?`<div style="background:var(--green-bg);border:1px solid rgba(62,207,142,.2);border-radius:var(--radius);padding:10px 12px;margin-bottom:14px;display:flex;align-items:center;gap:10px;cursor:pointer" onclick="addGcalSource()">
        <span style="font-size:18px">📅</span>
        <div style="flex:1"><div style="font-size:13px;font-weight:500;color:var(--green)">Add Google Calendar</div><div style="font-size:11px;color:var(--text3)">${gcalEmail}</div></div>
        <button class="btn btn-sm" style="background:var(--green-bg);color:var(--green);border-color:rgba(62,207,142,.3)">Add</button>
      </div>`:''}
      <div class="form-group"><label class="form-label">Calendar Name</label><input class="form-input" id="cs-name" placeholder="e.g. Work, Personal, Client XYZ"/></div>
      <div class="form-group"><label class="form-label">Color</label>
        <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">
          ${CAL_COLORS.map((c,i)=>`<div onclick="selectCalColor(this)" data-color="${c}" style="width:26px;height:26px;border-radius:50%;background:${c};cursor:pointer;border:3px solid ${i===0?'#fff':'transparent'};transition:border-color .15s"></div>`).join('')}
        </div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="addCalSource()">Add Calendar</button></div>`);
}

export function addGcalSource(){
  const gcalEmail = localStorage.getItem('nlm_gcal_email')||'Google Calendar';
  const name = 'Google — '+gcalEmail.split('@')[0];
  if(calSources.find(s=>s.name.includes('Google'))){ window.showToast('Google Calendar already added'); window.closeModal(); return; }
  calSources.push({ id:'gcal_'+Date.now(), name, color:'#4285F4', active:true });
  saveCalSources(); window.closeModal(); renderCalendar(); window.showToast('Google Calendar added!');
}

export function selectCalColor(el){
  document.querySelectorAll('[data-color]').forEach(d=>d.style.borderColor='transparent');
  el.style.borderColor='#fff';
}

export function addCalSource(){
  const name = document.getElementById('cs-name')?.value.trim();
  const colorEl = document.querySelector('#dp-popup [data-color][style*="border-color: white"], [data-color][style*="white"]');
  const allColorEls = document.querySelectorAll('[data-color]');
  let color = CAL_COLORS[0];
  allColorEls.forEach(el=>{ if(el.style.borderColor==='white'||el.style.borderColor==='rgb(255, 255, 255)') color=el.dataset.color; });
  if(!name){ window.showToast('Enter a calendar name','error'); return; }
  calSources.push({ id:'cs_'+Date.now(), name, color, active:true });
  saveCalSources(); window.closeModal(); renderCalendar(); window.showToast(`"${name}" added!`);
}

window.__nlmCalendarLoaded = true;
