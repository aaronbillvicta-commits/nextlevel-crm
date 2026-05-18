// NLM CRM — SignalWire Call Fabric v3 outbound call lifecycle
//
// MIGRATION NOTE (step 13b of the modular extraction):
// SECOND file in src/calling/. Strangler-fig: this module duplicates the
// outbound-call lifecycle from index.html (~3921-4454) — attach the WebRTC
// audio stream to the <audio id="remote-audio"> element, attach the SDK
// terminal-state handlers, run the call start UI flow, run the in-call UI +
// timer, tear everything down on hangup (including the BUG-015 fix that
// forces hangup() over leave() for Call Fabric PSTN dials), mute/unmute,
// and send DTMF digits. Nothing imports from it yet; inline copies remain
// authoritative for every callsite (`onclick="startCall()"` on the green
// Call button, `onclick="endCall()"` on the red Drop button, the inline
// dialer flow that calls these as the user clicks queue rows, the mute +
// keypad buttons in the in-call UI).
//
// SCOPE (7 functions verbatim-copied):
//   attachCallAudio       — three-path audio attachment (already-available
//                           remoteStream, SDK-level call.on('track'),
//                           underlying RTCPeerConnection ontrack). The first
//                           one that fires wins; the others are no-ops.
//   attachCallTeardown    — terminal-state subscriber. Listens for `destroy`,
//                           `room.left`, `call.ended`, and a wider call.state
//                           terminal set (ended/ending/destroy/destroyed/done/
//                           hangup/terminated/completed/disconnected/gone/
//                           aborted — last 5 added defensively after seeing
//                           SDK variants that emit them).
//   startCall             — permission check, single-active-call guard, SignalWire
//                           connect check, in-call UI flip, dialWithAuthRetry,
//                           attachCallTeardown, in-conversation log entry.
//   setCallActive         — UI activation: hide idle widget, show active widget,
//                           start the seconds-counter interval (writes to two
//                           timer DOM elements).
//   endCall               — full teardown. The BUG-015 fix is critical: hangup()
//                           is preferred over leave() because Fabric PSTN dials
//                           need the explicit "end this call" verb (leave only
//                           signals the local subscriber departing the room).
//                           Also synchronously closes the RTCPeerConnection +
//                           detaches the audio element so local media dies
//                           instantly even if the SDK round-trip is slow.
//                           If this was a dialer-queue call, kicks off the
//                           disposition prompt.
//   toggleMute            — flips callMuted + drives swCall.audioMute/Unmute.
//   sendDTMF              — sends a single DTMF digit via swCall.sendDigits;
//                           appends to the in-call DTMF display.
//
// DELIBERATELY OUT-OF-SCOPE for this file (next sub-extractions):
//   - enableIncomingCalls / showIncomingCall / acceptIncoming / declineIncoming
//     (13c inbound)
//   - renderDialerPage / dialpad* / matchDialpadContact / initiateCall /
//     openDialpad / power-dialer queue + autodial (13d-e)
//   - showDialerDisposition (called from endCall — lands in 13f)
//
// ROADMAP POSITION:
//   13a. token + dial-retry        DONE (commit ed1a17c)
//   13b. outbound lifecycle        <- this file
//   13c. inbound                   NEXT
//   13d-e. dialer + power dialer   AFTER
//   13f. disposition               LAST in 13
//
// STATE-MIRROR ENTRIES ADDED in this step (7 total — mirror block 42 → 49):
//   - swCall                  (let, reassignable — the active SignalWire Call
//                              object; assigned by startCall, nulled by endCall
//                              and by attachCallTeardown via teardown())
//   - callTimer               (let, reassignable — setInterval ID; assigned by
//                              setCallActive, cleared by endCall)
//   - callSeconds             (let, reassignable — counter incremented by the
//                              callTimer interval, read by endCall for the
//                              duration string and call-history log)
//   - callMuted               (let, reassignable — toggled by toggleMute)
//   - activeCallContact       (let, reassignable — { id, name, phone } of the
//                              call peer; assigned by startCall from a contacts
//                              lookup OR from initiateCall before startCall is
//                              invoked; cleared by endCall)
//   - activeCallDirection     (let, reassignable — 'inbound' or 'outbound';
//                              read by endCall + logCall; defaults to outbound)
//   - dialerCallInProgress    (let, reassignable — true while a queue-initiated
//                              call is live; read by endCall to decide whether
//                              to fire the disposition prompt)
//
// ADAPTATIONS from verbatim:
// - State vars via window.*: `swCall`, `callTimer`, `callSeconds`, `callMuted`,
//   `activeCallContact`, `activeCallDirection`, `dialerCallInProgress`,
//   `contacts`, `conversations`, `preferredOutputDevice`, `swClient`,
//   `incomingCallsRegistered` (the last three bridged in 13a / 12c earlier).
// - Inline function refs via window.*: `requirePerm`, `showToast`, `openModal`,
//   `closeModal`, `navigate`, `getPrimarySwPhone`, `saveConversations`,
//   `openDialpad`, `logCall`, `logError`, `getDialerActiveNumber` (typeof
//   guard), `fmtPhoneDisplay` (typeof guard), `showDialerDisposition` (typeof
//   guard — lands in 13f).
// - Cross-module refs via window.*: `dialWithAuthRetry`, `isExpiredTokenError`,
//   `updateOnlineIndicator` (all from 13a; inline copies remain authoritative
//   so window.* resolves to those).
// - Inline helper refs via window.*: `_safeStringify` (used by the call.state
//   handler in attachCallTeardown to log the raw event payload if no state
//   string could be parsed).
// - Module-local refs called bare: `attachCallTeardown` (from startCall);
//   `attachCallAudio` (NOT called from inside this file — only from
//   dialWithAuthRetry in 13a which uses window.attachCallAudio via typeof
//   guard); `setCallActive` (from startCall); `endCall` (from both the
//   teardown lambda in attachCallTeardown AND from startCall's catch).
//
// References inside HTML attribute strings (`startCall`, `endCall`,
// `toggleMute`, `sendDTMF`) are LEFT BARE because those strings are parsed
// at click-time and resolve via window from the inline hoisted-function
// declarations.
//
// VERIFICATION:
//   window.__nlmCallingOutboundLoaded === true  in DevTools after deploy.
//   A real outbound call still works end-to-end (the BUG-015 hangup vs leave
//   path is the most fragile bit — verify Drop ends the call cleanly on the
//   remote PSTN side, not just locally). All paths use inline copies.

export function attachCallAudio(call){
  const audioEl = document.getElementById('remote-audio');
  if(!audioEl || !call) return;
  const attach = stream => {
    if(!stream) return;
    audioEl.srcObject = stream;
    audioEl.play().catch(e => window.logError('audio_play_failed', e.message, null, {}));
    if(window.preferredOutputDevice && audioEl.setSinkId)
      audioEl.setSinkId(window.preferredOutputDevice).catch(()=>{});
  };
  // 1. Already available (e.g. answered inbound call)
  if(call.remoteStream){ attach(call.remoteStream); return; }
  // 2. SDK-level track event
  if(typeof call.on === 'function'){
    call.on('track', ev => {
      const s = ev?.streams?.[0] || (ev?.track ? new MediaStream([ev.track]) : null);
      if(s) attach(s);
    });
  }
  // 3. Underlying RTCPeerConnection (SDK internals vary by version)
  const pc = call?.peer?.instance || call?.peer?.peerConnection || call?.peerConnection;
  if(pc?.addEventListener){
    pc.addEventListener('track', ev => {
      if(ev?.streams?.[0]) attach(ev.streams[0]);
    });
    // Tracks may already be there if we raced
    const tracks = (pc.getReceivers ? pc.getReceivers() : [])
      .filter(r => r.track?.kind === 'audio').map(r => r.track);
    if(tracks.length) attach(new MediaStream(tracks));
  }
}

export function attachCallTeardown(call){
  if(!call || !call.on) return;
  const teardown = (reason) => {
    if(window.swCall !== call) return; // a newer call has already taken over
    window.logError('sw_call_teardown', reason, null, {});
    window.swCall = null;
    if(window.callTimer) endCall();
  };
  call.on('destroy',    () => teardown('destroy'));
  call.on('room.left',  () => teardown('room.left'));
  call.on('call.ended', () => teardown('call.ended'));
  // Widened terminal-state set: covers SDK variants that emit `terminated`,
  // `completed`, `disconnected`, `destroyed`, `gone`, `aborted` instead of the
  // five originally matched. None of these are valid intermediate states, so
  // adding them is purely defensive — without them, those SDK paths leave the
  // "On Call" UI stuck until the user manually drops.
  const TERMINAL_CALL_STATES = new Set([
    'ended','ending','destroy','destroyed','done','hangup',
    'terminated','completed','disconnected','gone','aborted'
  ]);
  call.on('call.state', ev => {
    const state = String(ev?.call_state ?? ev?.state ?? '').toLowerCase();
    window.logError('sw_call_state', state || (typeof window._safeStringify === 'function' ? window._safeStringify(ev,300) : ''), null, {});
    if(TERMINAL_CALL_STATES.has(state)){
      teardown('call.state:'+state);
    }
  });
}

export async function startCall(){
  if(!window.requirePerm('calling','You don\'t have permission to make calls')) return;
  // Guard — only one call at a time
  if(window.swCall || window.callTimer){
    window.showToast('A call is already in progress','error');
    return;
  }

  const input = document.getElementById('call-dial-number');
  const number = input?.value.trim()||'';
  if(!number){ window.showToast('Enter a phone number to call','error'); return; }

  if(!window.activeCallContact){
    const match = window.contacts.find(c=>c.phone&&c.phone.replace(/\D/g,'')===number.replace(/\D/g,''));
    if(match) window.activeCallContact={id:match.id,name:match.name,phone:number};
  }

  const swPhone = window.getPrimarySwPhone();
  if(!swPhone){
    window.openModal(`
      <div class="modal-head"><div class="modal-title">Connect SignalWire to Make Calls</div><span class="modal-close" onclick="closeModal()">×</span></div>
      <div class="modal-body">
        <div style="text-align:center;padding:16px 0">
          <div style="font-size:40px;margin-bottom:12px">📞</div>
          <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:8px">SignalWire not connected</div>
          <div style="font-size:13px;color:var(--text3);line-height:1.7">Connect your SignalWire account in Integrations to make real phone calls.</div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="closeModal();navigate('integrations')">Go to Integrations →</button>
      </div>`);
    return;
  }

  const contactName = window.activeCallContact?.name||number;
  const dialTo = number.startsWith('+') ? number : '+1'+number.replace(/\D/g,'');

  // Show in-call UI immediately so drop button + keypad are visible during "Connecting…"
  window.activeCallDirection = 'outbound';
  window.openDialpad();
  setCallActive(contactName, number);

  try {
    window.showToast('📞 Connecting…');
    window.logError('startCall_step', '1_init_client', null, { to: dialTo });

    // Wrapper handles dial + start + expired-token refresh/retry
    window.swCall = await window.dialWithAuthRetry(dialTo);

    attachCallTeardown(window.swCall);

    if(window.activeCallContact?.id){
      let conv = window.conversations.find(c => c.contactId === window.activeCallContact.id);
      if(!conv){ conv = {id:'conv_'+Date.now(), contactId: window.activeCallContact.id, messages:[]}; window.conversations.push(conv); }
      conv.messages.push({id:'msg_'+Date.now(), ch:'sms', dir:'outbound', body:`📞 Outbound call to ${number}`, ts: new Date().toISOString(), status:'sent'});
      window.saveConversations();
    }
  } catch(e){
    if(window.swCall){ try{ await window.swCall.leave(); }catch(_){} window.swCall=null; }
    // If we somehow still got an auth error here (e.g. start() threw), force-refresh next time
    if(window.isExpiredTokenError(e)){ window.swClient = null; window.incomingCallsRegistered = false; window.updateOnlineIndicator(); }
    window.logCall('outbound', dialTo, window.activeCallContact?.name||'', 0, 'failed');
    window.showToast('Call failed: '+(e.message||'Unknown error'),'error');
    window.logError('startCall', e.message, e.stack, { to: dialTo, contact: window.activeCallContact?.name });
    // Reset the in-call UI we optimistically opened
    endCall();
  }
}

export function setCallActive(name, number){
  document.getElementById('call-widget-idle').style.display='none';
  document.getElementById('call-widget-active').style.display='flex';
  document.getElementById('call-active-name').textContent=name||number;
  window.callSeconds = 0; window.callMuted = false;
  document.getElementById('call-mute-btn')?.classList.remove('muted');
  document.getElementById('dialpad-incall').style.display='block';
  document.getElementById('dialpad-idle').style.display='none';
  document.getElementById('dp-call-name').textContent=name||number;
  // "From: (305) 845-8883" — show the SignalWire number we're calling from
  const fromEl = document.getElementById('dp-call-from');
  if(fromEl){
    const fromNum = (window.activeCallDirection === 'outbound' && typeof window.getDialerActiveNumber === 'function')
      ? window.getDialerActiveNumber() : '';
    fromEl.textContent = fromNum ? 'From: ' + (typeof window.fmtPhoneDisplay === 'function' ? window.fmtPhoneDisplay(fromNum) : fromNum) : '';
  }
  document.getElementById('dp-call-timer').textContent='00:00';
  document.getElementById('dp-mute-btn')?.classList.remove('muted');
  document.getElementById('dp-mute-label').textContent='Mute';
  document.getElementById('dialpad-head-label').textContent='On Call';
  clearInterval(window.callTimer);
  window.callTimer = setInterval(()=>{
    window.callSeconds++;
    const m=String(Math.floor(window.callSeconds/60)).padStart(2,'0');
    const s=String(window.callSeconds%60).padStart(2,'0');
    const t=document.getElementById('call-active-timer');
    if(t) t.textContent=`${m}:${s}`;
    const dp=document.getElementById('dp-call-timer');
    if(dp) dp.textContent=`${m}:${s}`;
  },1000);
}

export function endCall(){
  // Capture dialer context before activeCallContact is cleared below
  const _dialerCtx = window.dialerCallInProgress && window.activeCallContact
    ? { id: window.activeCallContact.id, name: window.activeCallContact.name, phone: window.activeCallContact.phone, seconds: window.callSeconds }
    : null;

  // Tear down the SignalWire call. Prefer hangup() — for Call Fabric v3 PSTN
  // dials, leave() only signals the local subscriber departing the room and
  // (depending on SWML / SDK build) does NOT terminate the remote leg, so the
  // PSTN call keeps ringing/talking after the user hits Drop. hangup() is the
  // explicit "end this call" verb. Fall back to leave() for older SDK builds.
  // We ALSO force-close the underlying RTCPeerConnection and detach the audio
  // element synchronously — that kills the local media path immediately so the
  // user never hears lingering audio even if the SDK's hangup is slow.
  if(window.swCall){
    const _call = window.swCall;
    window.swCall = null;
    // 1. Synchronous local teardown — don't wait on the SDK round-trip
    const audioEl = document.getElementById('remote-audio');
    if(audioEl){
      try { audioEl.pause(); } catch(_){}
      try { audioEl.srcObject = null; } catch(_){}
    }
    const pc = _call?.peer?.instance || _call?.peer?.peerConnection || _call?.peerConnection;
    if(pc && typeof pc.close === 'function'){
      try { pc.getSenders?.().forEach(s => { try{ s.track?.stop(); }catch(_){} }); } catch(_){}
      try { pc.getReceivers?.().forEach(r => { try{ r.track?.stop(); }catch(_){} }); } catch(_){}
      try { pc.close(); } catch(_){}
    }
    // 2. Tell SignalWire to end the call — hangup() first, leave() as fallback
    (async () => {
      try {
        if(typeof _call.hangup === 'function'){
          await _call.hangup();
          window.logError('sw_call_end_method','hangup',null,{});
        } else if(typeof _call.leave === 'function'){
          await _call.leave();
          window.logError('sw_call_end_method','leave',null,{});
        } else {
          window.logError('sw_call_end_method','none_available',null,{
            keys: Object.getOwnPropertyNames(Object.getPrototypeOf(_call)||{}).slice(0,40).join(',')
          });
        }
      } catch(e){ window.logError('sw_call_end_error', e.message, e.stack, {}); }
    })();
  }
  clearInterval(window.callTimer); window.callTimer = null;
  const m=String(Math.floor(window.callSeconds/60)).padStart(2,'0');
  const s=String(window.callSeconds%60).padStart(2,'0');
  // Log to call history
  const calledNumber = window.activeCallContact?.phone || document.getElementById('call-dial-number')?.value || '';
  const dir = window.activeCallDirection || 'outbound';
  window.logCall(dir, calledNumber, window.activeCallContact?.name||'', window.callSeconds, window.callSeconds>0?'completed':'missed');
  if(window.activeCallContact?.id){
    let conv = window.conversations.find(c => c.contactId === window.activeCallContact.id);
    if(conv){
      const last = conv.messages[conv.messages.length-1];
      if(last && last.body.startsWith('📞')) last.body += ` — Duration: ${m}:${s}`;
      window.saveConversations();
    }
  }
  document.getElementById('call-widget-idle').style.display='flex';
  document.getElementById('call-widget-active').style.display='none';
  const timerEl=document.getElementById('call-active-timer');
  if(timerEl) timerEl.textContent='00:00';
  const nameEl=document.getElementById('call-active-name');
  if(nameEl) nameEl.textContent='Calling…';
  document.getElementById('dialpad-incall').style.display='none';
  document.getElementById('dialpad-idle').style.display='block';
  document.getElementById('dp-call-timer').textContent='00:00';
  // Clear DTMF display for next call
  const dtmfDisp = document.getElementById('dtmf-display');
  if(dtmfDisp) dtmfDisp.innerHTML='&nbsp;';
  document.getElementById('dialpad-head-label').textContent='Dialer';
  const input=document.getElementById('call-dial-number');
  if(input) input.value='';
  window.activeCallContact = null;
  window.activeCallDirection = 'outbound';
  window.showToast(`Call ended — ${m}:${s}`);

  // Dialer: a queue call just ended — prompt for a disposition
  if(_dialerCtx){
    window.dialerCallInProgress = false;
    if(typeof window.showDialerDisposition === 'function') window.showDialerDisposition(_dialerCtx);
  }
}

export function toggleMute(){
  window.callMuted = !window.callMuted;
  if(window.swCall){
    if(window.callMuted) window.swCall.audioMute().catch(()=>{});
    else window.swCall.audioUnmute().catch(()=>{});
  }
  document.getElementById('call-mute-btn')?.classList.toggle('muted', window.callMuted);
  document.getElementById('dp-mute-btn')?.classList.toggle('muted', window.callMuted);
  document.getElementById('dp-mute-label').textContent = window.callMuted ? 'Unmute' : 'Mute';
  window.showToast(window.callMuted ? '🔇 Muted' : '🔊 Unmuted');
}

export function sendDTMF(digit){
  if(!window.swCall){ window.showToast('No active call','error'); return; }
  try {
    // SignalWire Call Fabric exposes sendDigits() on the Call object
    const ret = window.swCall.sendDigits(digit);
    if(ret && typeof ret.catch === 'function') ret.catch(e => window.logError('dtmf', e.message, e.stack, {digit}));
  } catch(e) {
    window.logError('dtmf', e.message, e.stack, {digit});
    window.showToast('DTMF failed: '+e.message,'error');
    return;
  }
  // Visual feedback — append digit to display (last 16 chars)
  const disp = document.getElementById('dtmf-display');
  if(disp){
    const cur = disp.textContent.trim();
    const next = (cur + digit).slice(-16);
    disp.textContent = next || ' ';
  }
}

window.__nlmCallingOutboundLoaded = true;
