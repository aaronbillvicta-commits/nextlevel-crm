// NLM CRM — Call-widget floating dialpad popover
//
// MIGRATION NOTE (step 13d of the modular extraction):
// FOURTH file in src/calling/. Strangler-fig: this module duplicates the
// floating dialpad widget — the small popover with number input, dialpad
// keypad, contact-match line, and the "From: caller number" picker that
// hangs off the call widget. Nothing imports from it yet; inline copies
// remain authoritative for every callsite (the call widget toggle button's
// `openDialpad()` onclick, the dialpad keypad buttons that call
// `dialpadPress('5')` etc., the in-call DTMF buttons that share the same
// keypad, the per-contact "Call" buttons everywhere that call `initiateCall`,
// and the dialer-page caller-picker that mirrors this widget's picker).
//
// SCOPE (10 functions verbatim-copied):
//   openDialpad                  — show the popover, restore saved position,
//                                  refresh the caller picker + call history.
//   closeDialpad                 — hide the popover.
//   dialpadPress(key)            — append a digit to the dial input;
//                                  re-run the contact match.
//   dialpadBackspace             — pop the last character.
//   matchDialpadContact(num)     — lookup `contacts` by digits-only match,
//                                  show the matched name above the input.
//   initiateCall(id, phone, name)— pre-fill the dialpad for a specific
//                                  contact, set activeCallContact, open
//                                  the dialpad, show the contact name.
//   fmtPhoneDisplay(raw)         — format a phone number for display
//                                  (1XXXYYYZZZZ → "(XXX) YYY-ZZZZ"). Used
//                                  here AND across the rest of the app.
//   renderDialpadCallerPicker    — render the "From: caller number" line +
//                                  multi-number dropdown. Single number =
//                                  static label, multiple = clickable
//                                  dropdown that shares state with the
//                                  dialer page's caller picker via
//                                  setDialerActiveNumber.
//   toggleDialpadCallerMenu      — open/close the multi-number dropdown.
//   dialpadSetCallerNumber(num)  — picker click handler: writes via
//                                  setDialerActiveNumber, re-renders the
//                                  picker, reflects into the in-call
//                                  "From:" line if a call is active.
//
// DELIBERATELY OUT-OF-SCOPE for this file:
//   - applyDialpadSavedPosition / _clampDialpadPos / resetDialpadPosition /
//     the initDialpadDrag IIFE — these are draggable-window infra that
//     registers DOM listeners at parse time. They're an inline boot
//     concern; not worth extracting under strangler-fig because they
//     don't fit the "purely additive" pattern cleanly (the IIFE has
//     parse-time side effects).
//   - The `document.addEventListener('click', ...)` outside-click handler
//     for the caller menu — also parse-time side effect; stays inline.
//
// ROADMAP POSITION:
//   13a. token + dial-retry        DONE (commit ed1a17c)
//   13b. outbound lifecycle        DONE (commit baa4e7f)
//   13c. inbound lifecycle         DONE (commit 5530c35)
//   13d. dialpad widget            <- this file
//   13e. dialer page core          NEXT  (renderDialerPage + queue +
//                                          now-calling + search results +
//                                          number picker)
//   13f. dialer history + report   AFTER (renderDialerHistory +
//                                          renderDialerReport + helpers)
//   13g. dialer disposition        LAST  (showDialerDisposition +
//                                          saveDialerDispoLog +
//                                          dialerCallTop autodial)
//
// STATE-MIRROR ENTRIES ADDED in this step:
//   - dialpadOpen   (let, reassignable — flipped by openDialpad/closeDialpad;
//                    read elsewhere to decide whether to render the picker)
//
// ADAPTATIONS from verbatim:
// - State vars via window.*: `dialpadOpen`, `activeCallContact` (13b),
//   `contacts`.
// - Inline function refs via window.*: `applyDialpadSavedPosition` (typeof
//   guard — drag infra stays inline), `renderCallHistory`, `getSwPhones`
//   (typeof guard — integrations helper), `getDialerActiveNumber` (typeof
//   guard — lands in 13e), `setDialerActiveNumber` (typeof guard — same),
//   `cleanCallerNumber`, `navigate`.
// - Module-local refs called bare: `renderDialpadCallerPicker` (from
//   openDialpad); `fmtPhoneDisplay` (from renderDialpadCallerPicker AND
//   from dialpadSetCallerNumber); `matchDialpadContact` (from dialpadPress
//   + dialpadBackspace); `openDialpad` (from initiateCall);
//   `toggleDialpadCallerMenu` + `dialpadSetCallerNumber` (HTML attr strings
//   in renderDialpadCallerPicker's markup).
//
// References inside HTML attribute strings (`closeDialpad`, `navigate`,
// `toggleDialpadCallerMenu`, `dialpadSetCallerNumber`) are LEFT BARE —
// resolve via window from the inline hoisted-function declarations because
// the dialpad DOM lives in the global document.
//
// VERIFICATION:
//   window.__nlmCallingDialpadLoaded === true  in DevTools after deploy.
//   The floating dialpad opens, closes, accepts keypresses, matches
//   contacts as you type, the caller-number picker dropdown works, and
//   initiateCall pre-fills correctly from contact rows everywhere.

export function openDialpad(){
  window.dialpadOpen = true;
  const pad = document.getElementById('dialpad-float');
  const btn = document.getElementById('call-toggle-btn');
  if(pad) pad.style.display = 'block';
  if(btn) btn.classList.add('active');
  if(typeof window.applyDialpadSavedPosition === 'function') window.applyDialpadSavedPosition();
  renderDialpadCallerPicker();
  if(typeof window.renderCallHistory === 'function') window.renderCallHistory();
}

export function closeDialpad(){
  window.dialpadOpen = false;
  const pad = document.getElementById('dialpad-float');
  const btn = document.getElementById('call-toggle-btn');
  if(pad) pad.style.display = 'none';
  if(btn) btn.classList.remove('active');
}

export function dialpadPress(key){
  const input = document.getElementById('call-dial-number'); if(!input) return;
  input.value += key;
  matchDialpadContact(input.value);
}

export function dialpadBackspace(){
  const input = document.getElementById('call-dial-number'); if(!input) return;
  input.value = input.value.slice(0, -1);
  matchDialpadContact(input.value);
}

export function matchDialpadContact(num){
  const el = document.getElementById('dialpad-contact-match'); if(!el) return;
  if(!num){ el.textContent = ''; return; }
  const match = window.contacts.find(c => c.phone && c.phone.replace(/\D/g,'').includes(num.replace(/\D/g,'')));
  el.textContent = match ? `📋 ${match.name}` : '';
}

export function initiateCall(contactId, phone, name){
  window.activeCallContact = { id: contactId, name, phone };
  const input = document.getElementById('call-dial-number');
  if(input) input.value = phone;
  openDialpad();
  const matchEl = document.getElementById('dialpad-contact-match');
  if(matchEl) matchEl.textContent = `📋 ${name}`;
}

// ─── "FROM" CALLER ID PICKER (floating dialpad) ───────────────────────────
// Shows the SignalWire number we'll dial from. Single number → static label.
// Multiple numbers → dropdown that re-uses dialerActiveNumber so the Dialer
// page's "Calling From" tile and this picker stay in sync.
//
// NOTE on actual caller ID: changing the picker updates what we PASS as
// `from` to swClient.dial(). For the receiving phone to actually display
// the chosen number, the SignalWire SWML outbound script ("Bill") needs to
// use `from: "%{call.from}"` instead of the hardcoded "+13058458883" — see
// BACKLOG "Per-number caller ID needs SWML update".

export function renderDialpadCallerPicker(){
  const el = document.getElementById('dialpad-caller-picker');
  if(!el) return;
  const phones = (typeof window.getSwPhones === 'function' ? window.getSwPhones() : []);
  if(!phones.length){
    el.innerHTML = `<div style="padding:6px 10px;border-bottom:1px solid var(--border);font-size:10px;color:var(--text3)">
      No SignalWire number — <span style="color:var(--accent2);cursor:pointer;text-decoration:underline" onclick="closeDialpad();navigate('integrations')">connect one</span>
    </div>`;
    return;
  }
  const activeNum = (typeof window.getDialerActiveNumber === 'function' ? window.getDialerActiveNumber() : (phones[0]?.number || ''));
  const active = phones.find(p => p.number === activeNum) || phones[0];
  const fmt = fmtPhoneDisplay(active.number);
  // Single number → static
  if(phones.length === 1){
    el.innerHTML = `<div style="padding:6px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
      <span style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">From</span>
      <span style="font-size:11px;color:var(--text2);font-family:'DM Mono',monospace">${fmt}</span>
      ${active.label?`<span style="font-size:9px;color:var(--text3);margin-left:auto">${(active.label||'').replace(/</g,'&lt;')}</span>`:''}
    </div>`;
    return;
  }
  // Multiple → clickable row with a dropdown
  el.innerHTML = `
    <div style="position:relative;border-bottom:1px solid var(--border)">
      <div onclick="toggleDialpadCallerMenu(event)" title="Change caller number" style="padding:6px 12px;display:flex;align-items:center;gap:8px;cursor:pointer">
        <span style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">From</span>
        <span style="font-size:11px;color:var(--text2);font-family:'DM Mono',monospace;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${fmt}</span>
        <span style="font-size:9px;color:var(--text3)">${(active.label||'').replace(/</g,'&lt;')}</span>
        <span style="font-size:10px;color:var(--text3);transition:transform .12s" id="dialpad-caller-chev">▾</span>
      </div>
      <div id="dialpad-caller-menu" style="display:none;position:absolute;left:6px;right:6px;top:100%;margin-top:2px;background:var(--bg2);border:1px solid var(--border2);border-radius:var(--radius);box-shadow:0 10px 28px rgba(0,0,0,.5);z-index:20;max-height:220px;overflow-y:auto">
        ${phones.map(p => {
          const isActive = p.number === active.number;
          const pFmt = fmtPhoneDisplay(p.number);
          return `<div onclick="dialpadSetCallerNumber('${p.number.replace(/'/g,"\\'")}')" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);${isActive?'background:var(--accent-bg)':''}">
            <div style="font-size:11px;color:var(--text);display:flex;align-items:center;gap:6px">
              <span>${(p.label||'Number').replace(/</g,'&lt;')}</span>
              ${p.primary?`<span style="font-size:8px;color:var(--text3);background:var(--bg3);padding:1px 5px;border-radius:8px">PRIMARY</span>`:''}
              ${isActive?`<span style="margin-left:auto;font-size:11px;color:var(--accent2)">✓</span>`:''}
            </div>
            <div style="font-size:10px;color:var(--text3);font-family:'DM Mono',monospace;margin-top:2px">${pFmt}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

export function toggleDialpadCallerMenu(ev){
  if(ev) ev.stopPropagation();
  const m = document.getElementById('dialpad-caller-menu');
  if(!m) return;
  const open = m.style.display === 'block';
  m.style.display = open ? 'none' : 'block';
  const chev = document.getElementById('dialpad-caller-chev');
  if(chev) chev.style.transform = open ? '' : 'rotate(180deg)';
}

export function dialpadSetCallerNumber(num){
  if(typeof window.setDialerActiveNumber === 'function') window.setDialerActiveNumber(num);
  const m = document.getElementById('dialpad-caller-menu');
  if(m) m.style.display = 'none';
  renderDialpadCallerPicker();
  // Reflect into in-call "From:" line if a call is active
  const fromEl = document.getElementById('dp-call-from');
  if(fromEl && fromEl.textContent){
    const fmt = fmtPhoneDisplay(num);
    fromEl.textContent = 'From: ' + fmt;
  }
}

// ─── PHONE-NUMBER FORMATTING ──────────────────────────────────────────────

export function fmtPhoneDisplay(raw){
  if(!raw) return '';
  const cleaned = (typeof window.cleanCallerNumber === 'function') ? window.cleanCallerNumber(raw) : String(raw);
  const digits = cleaned.replace(/\D/g,'');
  if(digits.length === 11 && digits.startsWith('1')){
    return `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
  }
  if(digits.length === 10){
    return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  }
  return cleaned || String(raw);
}

window.__nlmCallingDialpadLoaded = true;
