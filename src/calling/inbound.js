// NLM CRM — SignalWire Call Fabric v3 inbound call lifecycle
//
// MIGRATION NOTE (step 13c of the modular extraction):
// THIRD file in src/calling/. Strangler-fig: this module duplicates the
// inbound-call lifecycle from index.html (~3893-4235) — register the
// subscriber online (enableIncomingCalls), handle the invite arrival
// (handleIncomingInvite + showIncomingCallUI + WebAudio ringtone),
// answer the call (acceptIncomingCall — accepts the invite, attaches
// audio + teardown listeners, logs the inbound message), or decline
// (declineIncomingCall — rejects the invite, logs as missed). Nothing
// imports from it yet; inline copies remain authoritative.
//
// SCOPE (8 functions verbatim-copied):
//   enableIncomingCalls   — bring the subscriber online so SignalWire
//                            routes inbound calls (from the SWML handler
//                            bound to the PSTN number) here. Idempotent +
//                            best-effort: silent no-op if SignalWire
//                            isn't configured, the user lacks calling
//                            perm, or the SDK build doesn't expose
//                            online() (older builds).
//   handleIncomingInvite  — SDK callback when an invite arrives. Dumps
//                            the raw notification to error_logs for
//                            debugging (inbound invites are rare events).
//                            Probes every plausible field path for the
//                            caller number/name (SignalWire SDK has
//                            shipped multiple shapes over the years).
//                            Stashes the resolved metadata on the invite
//                            (some SDK builds clear .details after
//                            accept). Shows the incoming card + starts
//                            the ringtone.
//   showIncomingCallUI    — renders the floating incoming-call card
//                            top-center with Accept/Decline buttons.
//                            HTML-escapes name + number defensively.
//   hideIncomingCallUI    — hides the card.
//   acceptIncomingCall    — permission check (decline if denied),
//                            stops the ringtone, hides the card,
//                            resolves caller info from the stashed
//                            metadata (or re-derives), sets
//                            activeCallContact + direction='inbound',
//                            flips the in-call UI, awaits invite.accept,
//                            attaches audio + teardown, logs inbound
//                            message.
//   declineIncomingCall   — stops ringtone + hides card, calls
//                            invite.reject(), logs the call as 'missed'.
//   startRingtone         — WebAudio 480Hz sine, 1s on / 1s off,
//                            ~0.15 gain. Requires a prior user gesture
//                            (login click counts) before audio can play.
//                            Ringtone state vars are module-local —
//                            same name as inline but separate bindings
//                            (the module copies stay dormant in
//                            strangler-fig phase).
//   stopRingtone          — full cleanup: clear interval, stop +
//                            disconnect oscillator + gain, close audio
//                            context.
//
// DELIBERATELY OUT-OF-SCOPE for this file (next sub-extractions):
//   - renderDialerPage / dialpad* / matchDialpadContact / initiateCall /
//     openDialpad / power-dialer queue + autodial (13d-e)
//   - showDialerDisposition (13f)
//
// ROADMAP POSITION:
//   13a. token + dial-retry        DONE (commit ed1a17c)
//   13b. outbound lifecycle        DONE (commit baa4e7f)
//   13c. inbound lifecycle         <- this file
//   13d-e. dialer + power dialer   NEXT
//   13f. disposition               LAST in 13
//
// STATE-MIRROR ENTRIES ADDED in this step:
//   - pendingInvite       (let, reassignable — SignalWire Call Fabric
//                          invite object while the incoming-call UI is
//                          on screen; written by handleIncomingInvite,
//                          read+cleared by acceptIncomingCall AND
//                          declineIncomingCall).
//
//   NOT bridged: _ringCtx, _ringOsc, _ringGain, _ringInterval. These are
//   private to startRingtone+stopRingtone (paired callers). The module
//   keeps its own copies; the inline keeps its own copies. They never
//   need to cross — whichever code path starts the ringtone is the one
//   that stops it. In strangler-fig phase the inline path is exclusive
//   so the module copies stay dormant.
//
// ADAPTATIONS from verbatim:
// - State vars via window.*: `swClient`, `incomingCallsRegistered` (both
//   from 13a), `pendingInvite`, `activeCallContact`, `activeCallDirection`,
//   `swCall`, `conversations`.
// - Inline function refs via window.*: `getPrimarySwPhone`, `can`,
//   `logError`, `_safeStringify`, `cleanCallerNumber`, `findContactByPhone`
//   (typeof guard), `icon`, `requirePerm`, `showToast`, `openDialpad`,
//   `saveConversations`, `logCall`.
// - Cross-module refs via window.*: `updateOnlineIndicator` (from 13a),
//   `setCallActive` + `attachCallAudio` + `attachCallTeardown` + `endCall`
//   (all from 13b). Inline copies are authoritative so window.* resolves
//   to those.
// - Module-local refs called bare: `handleIncomingInvite` (passed as the
//   handler to swClient.online from enableIncomingCalls); `showIncomingCallUI`
//   + `startRingtone` (from handleIncomingInvite); `hideIncomingCallUI` +
//   `stopRingtone` (from accept + declineIncomingCall); `declineIncomingCall`
//   (from acceptIncomingCall's permission denial path).
//
// References inside HTML attribute strings (`acceptIncomingCall`,
// `declineIncomingCall`) inside the showIncomingCallUI markup are LEFT
// BARE — resolve via window from the inline hoisted-function declarations
// because the incoming-call card lives in the global DOM.
//
// VERIFICATION:
//   window.__nlmCallingInboundLoaded === true  in DevTools after deploy.
//   A real inbound call still rings + accepts cleanly. Calling subscriber
//   stays online across page reloads. Decline path logs the missed call.

// ─── INCOMING CALL HANDLING (SignalWire Call Fabric subscriber) ───────────
// Bring the subscriber online so SignalWire can route inbound calls (from the
// SWML handler bound to the PSTN number) here. Idempotent + best-effort: if
// SignalWire isn't configured, the user lacks calling perm, or the SDK build
// doesn't expose online(), this is a no-op.

export async function enableIncomingCalls(){
  if(!window.swClient) return;
  if(window.incomingCallsRegistered) return;
  if(typeof window.getPrimarySwPhone === 'function' && !window.getPrimarySwPhone()) return;
  if(typeof window.can === 'function' && !window.can('calling')) return;
  if(typeof window.swClient.online !== 'function') return; // older SDK build w/o subscriber registration
  try {
    await window.swClient.online({
      incomingCallHandlers: { all: handleIncomingInvite }
    });
    window.incomingCallsRegistered = true;
    if(typeof window.updateOnlineIndicator === 'function') window.updateOnlineIndicator();
    window.logError('sw_inbound_register','online() succeeded',null,{});
  } catch(e){
    window.logError('sw_inbound_register_failed', e.message, e.stack, {});
  }
}

export function handleIncomingInvite(notification){
  try {
    // Dump the raw notification once so we can see the actual field shape in
    // error_logs. Cheap insurance — invites are rare events.
    window.logError('sw_inbound_invite_raw', 'inbound invite received', null, {
      notificationKeys: Object.keys(notification||{}),
      inviteKeys: Object.keys(notification?.invite||{}),
      detailsKeys: Object.keys(notification?.invite?.details||notification?.details||{}),
      raw: (typeof window._safeStringify === 'function' ? window._safeStringify(notification, 3000) : '')
    });
    const invite = notification?.invite || notification;
    // Try every plausible path: top-level invite, nested invite, details, params
    const details = invite?.details || invite?.invite?.details || notification?.details || {};
    const params  = details?.params || invite?.params || {};
    const fromRaw =
      details.caller_id_number || details.from_number || details.from ||
      params.caller_id_number  || params.from_number  || params.from  ||
      invite.from              || invite.fromNumber   ||
      notification.from        || '';
    // Strip the SIP URI wrapper Fabric emits — sip:+18325832601@sip.signalwire.com → +18325832601
    const from = window.cleanCallerNumber(fromRaw);
    const callerName =
      details.caller_id_name || details.from_name ||
      params.caller_id_name  || params.from_name  ||
      invite.fromName        || '';
    const matched = (typeof window.findContactByPhone === 'function') ? window.findContactByPhone(from) : null;
    const displayName = (matched && matched.name) || callerName || from || 'Unknown caller';
    window.pendingInvite = invite;
    // Stash the resolved metadata on the invite so acceptIncomingCall() doesn't
    // have to re-derive (the SDK clears .details after accept on some builds)
    invite._resolvedFrom = from;
    invite._resolvedName = displayName;
    showIncomingCallUI(displayName, from, matched);
    startRingtone();
  } catch(e){
    window.logError('sw_inbound_handle', e.message, e.stack, {});
  }
}

export function showIncomingCallUI(name, number, matched){
  let host = document.getElementById('incoming-call-host');
  if(!host){
    host = document.createElement('div');
    host.id = 'incoming-call-host';
    host.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:99999;width:340px;max-width:calc(100vw - 32px);background:var(--bg1);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 56px rgba(0,0,0,.45);padding:18px;font-family:inherit';
    document.body.appendChild(host);
  }
  const safeName = String(name).replace(/[<>&"]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[s]));
  const safeNum  = String(number||'').replace(/[<>&"]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[s]));
  const subline  = matched ? (matched.company || safeNum || '') : safeNum;
  host.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <div style="width:40px;height:40px;border-radius:50%;background:var(--accent-bg);display:flex;align-items:center;justify-content:center;color:var(--accent2);animation:pulse 1s infinite;flex-shrink:0;box-shadow:0 0 16px rgba(79,126,248,.4)">${window.icon('phone',20)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">Incoming call</div>
        <div style="font-size:15px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${safeName}</div>
        ${subline ? `<div style="font-size:12px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${subline}</div>` : ''}
      </div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn" style="flex:1;background:var(--red);color:#fff;border-color:var(--red)" onclick="declineIncomingCall()">Decline</button>
      <button class="btn btn-primary" style="flex:1;background:var(--green);color:#fff;border-color:var(--green)" onclick="acceptIncomingCall()">Accept</button>
    </div>`;
  host.style.display = 'block';
}

export function hideIncomingCallUI(){
  const host = document.getElementById('incoming-call-host');
  if(host) host.style.display = 'none';
}

export async function acceptIncomingCall(){
  if(!window.requirePerm('calling','You don\'t have permission to take calls')){
    declineIncomingCall();
    return;
  }
  if(!window.pendingInvite){ hideIncomingCallUI(); stopRingtone(); return; }
  const invite = window.pendingInvite;
  window.pendingInvite = null;
  stopRingtone();
  hideIncomingCallUI();
  // Pull caller info before invite is consumed (prefer the resolved values we
  // stashed in handleIncomingInvite, which already tried every field shape)
  const details = invite?.details || {};
  const fromRaw = invite._resolvedFrom ||
    details.caller_id_number || details.from || details.from_number ||
    details.params?.caller_id_number || details.params?.from || '';
  const from = window.cleanCallerNumber(fromRaw);
  const matched = (typeof window.findContactByPhone === 'function') ? window.findContactByPhone(from) : null;
  const displayName = matched?.name || invite._resolvedName ||
    details.caller_id_name || details.params?.caller_id_name || from || 'Incoming';
  if(matched) window.activeCallContact = { id: matched.id, name: matched.name, phone: from };
  else window.activeCallContact = { id: null, name: displayName, phone: from };
  window.activeCallDirection = 'inbound';
  window.openDialpad();
  if(typeof window.setCallActive === 'function') window.setCallActive(displayName, from);
  try {
    window.showToast('📞 Connecting…');
    window.swCall = await invite.accept({
      rootElement: document.getElementById('sw-root-element'),
      audio: true, video: false
    });
    if(typeof window.attachCallAudio === 'function') window.attachCallAudio(window.swCall);
    if(typeof window.attachCallTeardown === 'function') window.attachCallTeardown(window.swCall);
    if(window.activeCallContact?.id){
      let conv = window.conversations.find(c => c.contactId === window.activeCallContact.id);
      if(!conv){ conv = {id:'conv_'+Date.now(), contactId: window.activeCallContact.id, messages:[]}; window.conversations.push(conv); }
      conv.messages.push({id:'msg_'+Date.now(), ch:'sms', dir:'inbound', body:`📞 Inbound call from ${from||'unknown'}`, ts: new Date().toISOString(), status:'received'});
      window.saveConversations();
    }
  } catch(e){
    window.logError('acceptIncomingCall', e.message, e.stack, { from });
    window.showToast('Could not connect call: '+(e.message||'unknown error'),'error');
    if(typeof window.endCall === 'function') window.endCall();
  }
}

export async function declineIncomingCall(){
  const invite = window.pendingInvite;
  window.pendingInvite = null;
  stopRingtone();
  hideIncomingCallUI();
  if(invite){
    try { await invite.reject(); } catch(e){ window.logError('declineIncomingCall', e.message, e.stack, {}); }
    const details = invite?.details || {};
    const fromRaw = invite._resolvedFrom ||
      details.caller_id_number || details.from || details.from_number || '';
    const from = window.cleanCallerNumber(fromRaw);
    const matched = (typeof window.findContactByPhone === 'function') ? window.findContactByPhone(from) : null;
    const displayName = matched?.name || invite._resolvedName ||
      details.caller_id_name || from || 'Unknown';
    window.logCall('inbound', from, displayName, 0, 'missed');
  }
}

// Simple WebAudio ringtone — 1s on / 1s off sine pattern. Quiet (~0.15 gain).
// Requires a prior user gesture (the login click counts) before audio can play.
// State is module-local on purpose — same names as inline but separate
// bindings. Whichever code path starts the ringtone is the one that stops it,
// so the two never need to cross.
let _ringCtx = null, _ringOsc = null, _ringGain = null, _ringInterval = null;

export function startRingtone(){
  if(_ringInterval) return;
  try {
    _ringCtx = new (window.AudioContext || window.webkitAudioContext)();
    _ringGain = _ringCtx.createGain();
    _ringGain.gain.value = 0.0;
    _ringGain.connect(_ringCtx.destination);
    _ringOsc = _ringCtx.createOscillator();
    _ringOsc.type = 'sine';
    _ringOsc.frequency.value = 480;
    _ringOsc.connect(_ringGain);
    _ringOsc.start();
    let on = false;
    const tick = () => {
      on = !on;
      if(!_ringGain) return;
      _ringGain.gain.cancelScheduledValues(_ringCtx.currentTime);
      _ringGain.gain.setValueAtTime(on ? 0.15 : 0.0, _ringCtx.currentTime);
    };
    tick();
    _ringInterval = setInterval(tick, 1000);
  } catch(e){ window.logError('ringtone_start', e.message, e.stack, {}); }
}

export function stopRingtone(){
  try {
    if(_ringInterval){ clearInterval(_ringInterval); _ringInterval = null; }
    if(_ringOsc){ try{ _ringOsc.stop(); }catch(_){}; try{ _ringOsc.disconnect(); }catch(_){}; _ringOsc = null; }
    if(_ringGain){ try{ _ringGain.disconnect(); }catch(_){}; _ringGain = null; }
    if(_ringCtx){ try{ _ringCtx.close(); }catch(_){}; _ringCtx = null; }
  } catch(_) {}
}

window.__nlmCallingInboundLoaded = true;
