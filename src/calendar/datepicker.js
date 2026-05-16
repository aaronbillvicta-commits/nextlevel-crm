// NLM CRM - custom date/time picker (used by Calendar + Dialer follow-up scheduler)
//
// MIGRATION NOTE (step 7b of the modular extraction):
// Second file in src/calendar/. Verbatim duplicate of the date-picker block in
// index.html (search for "function openDatePicker" near line ~8049). Strangler-fig:
// the inline copy is still authoritative for every existing callsite. Inline
// `onclick="dpSelectDay(...)" / "openDatePicker(...)" / "dpConfirm()"` etc. resolve
// via the hoisted-function-declaration globals from the inline <script>, NOT via
// this module. That's why this module does NOT do `window.openDatePicker = ...` -
// touching window here would silently swap the implementation while the inline
// `_dpState` stays separate, causing two pickers to diverge.
//
// Public entry points (currently re-declared inline, will be migrated callsites):
//   openDatePicker(targetId, initialVal, onConfirm)
//   closeDatePicker()
//
// Internal helpers exported so future modules can compose them:
//   positionDpPopup, dpOutsideClick, renderDatePickerPopup, dpChangeMonth,
//   dpSelectDay, dpSetHour12, dpSetPeriod, dpSetMin, dpConfirm
//
// Depends on (still inline globals today):
//   showToast()  - hoisted from inline <script>, also available as window.showToast
//   document, window  - browser
//   CSS classes  - .datepicker-popup, .dp-*, .btn, .btn-primary, .btn-sm (defined inline)
//
// Behavior is intentionally a verbatim copy - no refactors during extraction
// (per saved memory `target-layout-decision`). ONE adaptation: the inline `showToast`
// call in dpConfirm() is rewritten as `window.showToast` here, because modules cannot
// resolve a bare identifier defined in an inline <script> via lexical scope; the
// global object is reachable but only by explicit qualification. Same pattern as
// step 5 (permissions.js / window.currentUser).

let _dpState = { year: new Date().getFullYear(), month: new Date().getMonth(), selectedDate: null, selectedHour: new Date().getHours(), selectedMin: 0, targetId: null, onConfirm: null };

export function openDatePicker(targetId, initialVal, onConfirm){
  closeDatePicker();
  _dpState.targetId = targetId;
  _dpState.onConfirm = onConfirm;
  const now = new Date();
  if(initialVal){
    const d = new Date(initialVal);
    _dpState.year = d.getFullYear(); _dpState.month = d.getMonth();
    _dpState.selectedDate = d.getDate(); _dpState.selectedHour = d.getHours();
    _dpState.selectedMin = Math.round(d.getMinutes()/5)*5;
  } else {
    _dpState.year = now.getFullYear(); _dpState.month = now.getMonth();
    _dpState.selectedDate = now.getDate(); _dpState.selectedHour = now.getHours();
    _dpState.selectedMin = 0;
  }
  const anchor = document.getElementById(targetId); if(!anchor) return;
  const popup = document.createElement('div');
  popup.id = 'dp-popup';
  popup.className = 'datepicker-popup';
  // Append to body so the popup escapes any modal's overflow:auto clipping.
  document.body.appendChild(popup);
  renderDatePickerPopup();
  positionDpPopup();
  // Re-position when the user scrolls or resizes (e.g. modal body scroll)
  window.addEventListener('resize', positionDpPopup, true);
  window.addEventListener('scroll', positionDpPopup, true);
  anchor.classList.add('open');
  // Listen during the capture phase so the popup.contains(e.target) check
  // runs BEFORE inline onclick handlers (dpSelectDay etc.) re-render the
  // popup's innerHTML and detach the clicked node from the DOM.
  setTimeout(()=>document.addEventListener('click', dpOutsideClick, true), 10);
}

export function positionDpPopup(){
  const anchor = document.getElementById(_dpState.targetId||'');
  const popup = document.getElementById('dp-popup');
  if(!anchor || !popup) return;
  const rect = anchor.getBoundingClientRect();
  const vh = window.innerHeight, vw = window.innerWidth;
  const ph = popup.offsetHeight, pw = popup.offsetWidth;
  let top = rect.bottom + 6;
  if(top + ph > vh - 10) top = Math.max(10, rect.top - ph - 6);
  let left = rect.left;
  if(left + pw > vw - 10) left = Math.max(10, vw - pw - 10);
  popup.style.top  = top + 'px';
  popup.style.left = left + 'px';
}

export function dpOutsideClick(e){
  const popup = document.getElementById('dp-popup');
  if(!popup) return;
  if(popup.contains(e.target)) return;                       // inside the popup
  if(e.target.closest && e.target.closest('#dp-popup')) return;
  if(e.target.id === _dpState.targetId) return;              // re-click on the trigger
  if(e.target.closest && e.target.closest('.datepicker-display')) return;
  closeDatePicker();
}

export function closeDatePicker(){
  const popup = document.getElementById('dp-popup');
  if(popup) popup.remove();
  const anchor = document.getElementById(_dpState.targetId||'');
  if(anchor) anchor.classList.remove('open');
  document.removeEventListener('click', dpOutsideClick, true);
  window.removeEventListener('resize', positionDpPopup, true);
  window.removeEventListener('scroll', positionDpPopup, true);
}

export function renderDatePickerPopup(){
  const popup = document.getElementById('dp-popup'); if(!popup) return;
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dayNames = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  const {year, month, selectedDate, selectedHour, selectedMin} = _dpState;
  const firstDay = new Date(year,month,1).getDay();
  const daysInMonth = new Date(year,month+1,0).getDate();
  const prevDays = new Date(year,month,0).getDate();
  const today = new Date();

  // 12-hour clock - selectedHour is stored as 0-23 internally.
  const hours12 = [12,1,2,3,4,5,6,7,8,9,10,11];
  const mins    = [0,5,10,15,20,25,30,35,40,45,50,55];
  const period  = selectedHour >= 12 ? 'PM' : 'AM';
  const displayHour = (selectedHour % 12) === 0 ? 12 : (selectedHour % 12);

  let daysHtml = '';
  for(let i=firstDay-1;i>=0;i--) daysHtml+=`<div class="dp-day other-month">${prevDays-i}</div>`;
  for(let d=1;d<=daysInMonth;d++){
    const isToday = d===today.getDate()&&month===today.getMonth()&&year===today.getFullYear();
    const isSel = d===selectedDate;
    daysHtml+=`<div class="dp-day ${isToday?'today':''} ${isSel?'selected':''}" onclick="dpSelectDay(${d})">${d}</div>`;
  }
  const rem = 42-(firstDay+daysInMonth);
  for(let d=1;d<=rem;d++) daysHtml+=`<div class="dp-day other-month">${d}</div>`;

  popup.innerHTML=`
    <div class="dp-nav">
      <div class="dp-nav-btn" onclick="dpChangeMonth(-1)">‹</div>
      <div class="dp-month-label">${monthNames[month]} ${year}</div>
      <div class="dp-nav-btn" onclick="dpChangeMonth(1)">›</div>
    </div>
    <div class="dp-days-header">${dayNames.map(d=>`<div class="dp-day-hdr">${d}</div>`).join('')}</div>
    <div class="dp-days">${daysHtml}</div>
    <div class="dp-time-row">
      <span class="dp-time-label">Time</span>
      <select class="dp-time-select" id="dp-hour" onchange="dpSetHour12(this.value)" style="max-width:70px">
        ${hours12.map(h=>`<option value="${h}" ${h===displayHour?'selected':''}>${h}</option>`).join('')}
      </select>
      <span style="color:var(--text3)">:</span>
      <select class="dp-time-select" id="dp-min" onchange="dpSetMin(this.value)" style="max-width:70px">
        ${mins.map(m=>`<option value="${m}" ${m===selectedMin?'selected':''}>${String(m).padStart(2,'0')}</option>`).join('')}
      </select>
      <select class="dp-time-select" id="dp-period" onchange="dpSetPeriod(this.value)" style="max-width:70px">
        <option value="AM" ${period==='AM'?'selected':''}>AM</option>
        <option value="PM" ${period==='PM'?'selected':''}>PM</option>
      </select>
    </div>
    <div class="dp-confirm-row">
      <button class="btn btn-sm" onclick="closeDatePicker()">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="dpConfirm()">Confirm</button>
    </div>`;
  // Popup size may change between renders (e.g. month nav); reposition.
  positionDpPopup();
}

export function dpChangeMonth(dir){
  _dpState.month += dir;
  if(_dpState.month>11){_dpState.month=0;_dpState.year++;}
  if(_dpState.month<0){_dpState.month=11;_dpState.year--;}
  renderDatePickerPopup();
}
export function dpSelectDay(d){ _dpState.selectedDate=d; renderDatePickerPopup(); }
// 12-hour hour picker - keep the AM/PM half stable when the user changes the 12-hour digit.
export function dpSetHour12(v){
  const h12 = parseInt(v,10);                // 1..12 from the dropdown
  const isPM = _dpState.selectedHour >= 12;
  _dpState.selectedHour = (h12 % 12) + (isPM ? 12 : 0);  // 12 AM -> 0, 12 PM -> 12
}
export function dpSetPeriod(p){
  const cur = _dpState.selectedHour;
  if(p === 'AM' && cur >= 12) _dpState.selectedHour = cur - 12;
  if(p === 'PM' && cur < 12)  _dpState.selectedHour = cur + 12;
}
export function dpSetMin(v){ _dpState.selectedMin=parseInt(v); }
export function dpConfirm(){
  if(!_dpState.selectedDate){ window.showToast('Select a date first','error'); return; }
  const d = new Date(_dpState.year, _dpState.month, _dpState.selectedDate, _dpState.selectedHour, _dpState.selectedMin);
  const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  // Update display
  const anchor = document.getElementById(_dpState.targetId);
  if(anchor){
    anchor.dataset.value = iso;
    const span = anchor.querySelector('.dp-display-val');
    if(span) span.textContent = d.toLocaleString([],{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  }
  if(_dpState.onConfirm) _dpState.onConfirm(iso, d);
  closeDatePicker();
}

window.__nlmCalendarDatepickerLoaded = true;
