// NLM CRM — SignalWire Call Fabric v3 foundation (token + client + dial-retry)
//
// MIGRATION NOTE (step 13a of the modular extraction):
// FIRST file in src/calling/. **Calling was deliberately deferred to last** —
// see the saved memory `target-layout-decision` ("calling code is freshly
// stabilized after BUG-005/006/007 — must not be touched until the module
// pattern is proven on 5+ other features"). By now (2026-05-18) the pattern
// has shipped across calendar/contacts/pipelines/conversations/clients/
// settings, so the safety bar has been met and this strangler-fig copy
// can land.
//
// Strangler-fig: this module duplicates the calling-foundation block from
// index.html (~3795-3884). Nothing imports from it yet; inline copies remain
// authoritative for every callsite — `initSWClient()` from the call widget
// boot path AND from `dialWithAuthRetry` itself, `updateOnlineIndicator()`
// after subscriber online/offline transitions, `isExpiredTokenError()` from
// the retry-detection check inside the wrapper, and `dialWithAuthRetry()`
// from `startCall()` (still inline; lands in 13b alongside endCall +
// attachCallAudio).
//
// SCOPE (4 functions verbatim-copied from index.html ~3795-3884):
//   initSWClient(force = false)
//     — token-fetch + SignalWire client construct. If `force`, tears down
//       the cached client first so we don't leak its socket. Hits
//       /api/call-token with the operator JWT (BUG-016 deploy added the
//       Authorization header requirement). Re-registers the inbound handler
//       on every fresh client.
//   updateOnlineIndicator()
//     — tiny DOM helper that flips the green-dot status on the call widget
//       to reflect `incomingCallsRegistered`.
//   isExpiredTokenError(e)
//     — single-regex test that catches the SignalWire 401/422/auth-expired
//       error shapes, including BUG-014's "Requester validation failed"
//       (cached subscriber client invalidated mid-session). Used by the
//       retry detector inside `dialWithAuthRetry`.
//   dialWithAuthRetry(dialTo)
//     — wraps `swClient.dial()` + `call.start()` with a single retry on
//       expired-token errors. Both `dial()` and `start()` participate in
//       the SignalWire auth flow, so an expired token can surface from
//       EITHER — both must live inside the retry loop. Hints `from` to the
//       SDK based on `getDialerActiveNumber()` (if defined); whether the
//       outbound SWML actually honors it depends on whether that script
//       reads `%{call.from}` — see BACKLOG "Per-number caller ID needs
//       SWML update".
//
// DELIBERATELY OUT-OF-SCOPE for this file:
//   - startCall / endCall / attachCallAudio (outbound call lifecycle —
//     lands in 13b)
//   - enableIncomingCalls / showIncomingCall / acceptIncoming / declineIncoming
//     (inbound — lands in 13c)
//   - renderDialerPage / dialpad* / power dialer queue + autodial (lands
//     in 13d-13e)
//   - call disposition modal (lands in 13f)
//
// ROADMAP POSITION:
//   12. settings/                DONE
//   13. calling/                 <- this is 13a foundation; many sub-files
//                                   to follow (see DELIBERATELY OUT-OF-SCOPE)
//   14. callsite migration       After 13 wraps; flip inline callsites to
//                                imports + delete inline copies in tandem.
//
// STATE-MIRROR ENTRIES ADDED in this step:
//   - swClient                  (let, reassignable — the SignalWire client
//                                singleton; initSWClient writes it to null
//                                on force-teardown and to the new client on
//                                construct)
//   - incomingCallsRegistered   (let, reassignable — flipped to true by
//                                enableIncomingCalls after a successful
//                                client.online({...}); cleared by
//                                initSWClient(force=true). Read by
//                                updateOnlineIndicator + enableIncomingCalls)
//
// **IMPORTANT — saved memory `target-layout-decision`**: "swClient
// (SignalWire singleton) lives in exactly one file when calling is
// extracted. No other module touches the global." That rule kicks in
// during STEP 14 callsite migration. For now (strangler-fig phase) the
// inline copy is authoritative, the module's window.swClient bridge
// resolves to the SAME underlying binding (via Object.defineProperty
// getter/setter), so there's only one swClient in practice.
//
// ADAPTATIONS from verbatim:
// - State vars via window.*: `swClient`, `incomingCallsRegistered`,
//   `authToken` (already bridged in 12b).
// - Inline function refs via window.*: `enableIncomingCalls`,
//   `attachCallAudio`, `getDialerActiveNumber` (the latter is read inside
//   dialWithAuthRetry but may not be defined when calling code first runs;
//   the typeof guard preserves that behavior), `logError`.
// - Module-local refs called bare: `initSWClient` (recursive from
//   dialWithAuthRetry on retry); `isExpiredTokenError` (used by the retry
//   detector inside dialWithAuthRetry); `updateOnlineIndicator` (used by
//   initSWClient when forcing teardown).
//
// VERIFICATION:
//   window.__nlmCallingLoaded === true  in DevTools after deploy.
//   Calling stack still works because the inline copies remain
//   authoritative. To confirm the module is callable, in DevTools:
//   `typeof window.initSWClient === 'function'` should be true (resolves
//   to the inline copy via window — the module doesn't replace it, just
//   sits alongside).

// ─── INIT / TOKEN ─────────────────────────────────────────────────────────

export async function initSWClient(force = false){
  if(window.swClient && !force) return window.swClient;
  // Force = tear down the cached client so we don't leak its socket
  if(force && window.swClient){
    try { await window.swClient.disconnect?.(); } catch(_) {}
    window.swClient = null;
    window.incomingCallsRegistered = false;   // a new client = need to re-register inbound
    updateOnlineIndicator();
  }
  // Cache-buster + no-store so we never reuse a stale (expired) token
  const r = await fetch('/api/call-token?_=' + Date.now(), {
    cache: 'no-store',
    headers: { Authorization: 'Bearer ' + window.authToken },
  });
  const data = await r.json();
  if(!data.token) throw new Error(data.error || 'Failed to get call token');

  const SW = (window.SignalWire && window.SignalWire.SignalWire) || window.SignalWire;
  window.swClient = await SW({ token: data.token, logLevel: 'debug' });
  // BUG-020 follow-up: monkey-patch the SDK event emitter to log every event
  // the client emits. The SignalWire JS SDK does not document an "invite
  // cancelled" event, and our probe set in handleIncomingInvite didn't match
  // any of the names that actually fire. This instrumentation captures every
  // event so one cancelled-invite test surfaces the real name.
  try {
    const sw = window.swClient;
    const targets = [
      ['client', sw],
      ['emitter', sw?.eventEmitter],
      ['_emitter', sw?._emitter],
      ['_eventEmitter', sw?._eventEmitter],
    ].filter(([,t]) => t);
    for(const [label, t] of targets){
      if(typeof t.emit === 'function' && !t.__nlmEmitWrapped){
        const orig = t.emit.bind(t);
        t.emit = function(name, ...args){
          try {
            window.logError('sw_emit', String(name), null, {
              target: label,
              args: (typeof window._safeStringify === 'function' ? window._safeStringify(args, 280) : '')
            });
          } catch(_){}
          return orig(name, ...args);
        };
        t.__nlmEmitWrapped = true;
      }
    }
  } catch(e){ window.logError('sw_emit_wrap_failed', e.message, e.stack, {}); }
  // Re-register the inbound handler on every fresh client (silent if the user
  // doesn't have calling perm or hasn't connected SignalWire)
  if(typeof window.enableIncomingCalls === 'function'){
    window.enableIncomingCalls().catch(e => window.logError('sw_inbound_register', e.message, e.stack, {}));
  }
  return window.swClient;
}

export function updateOnlineIndicator(){
  const dot = document.getElementById('call-online-dot');
  if(!dot) return;
  dot.classList.toggle('online', window.incomingCallsRegistered);
  dot.title = window.incomingCallsRegistered ? 'SignalWire connected' : 'SignalWire not connected';
}

// ─── DIAL / TOKEN RETRY ───────────────────────────────────────────────────

export function isExpiredTokenError(e){
  const msg = String(e?.message || e);
  return /authblock_is_expired|authblock|expires_at|authentication|unauthorized|invalid_token|requester[\s_-]*validation[\s_-]*failed|401\b|422\b/i.test(msg);
}

export async function dialWithAuthRetry(dialTo){
  // Hint the desired caller ID to the SDK. Whether SignalWire actually uses
  // this on the PSTN leg depends on the outbound SWML script: it must read
  // "%{call.from}" for this to take effect. Otherwise the SWML's hardcoded
  // `from` wins. See BACKLOG "Per-number caller ID needs SWML update".
  const fromHint = (typeof window.getDialerActiveNumber === 'function' ? window.getDialerActiveNumber() : '') || '';
  for(let attempt = 0; attempt < 2; attempt++){
    let call = null;
    try {
      await initSWClient();
      window.logError('startCall_step', '2_dialing', null, { attempt, fromHint });
      const dialParams = {
        to: dialTo,
        rootElement: document.getElementById('sw-root-element'),
        audio: true,
        video: false,
      };
      if(fromHint) dialParams.from = fromHint;
      call = await window.swClient.dial(dialParams);
      window.logError('startCall_step', '3_call_object_created', null, { attempt });
      // start() is part of the same auth flow — must be inside the retry so
      // an expired token caught here triggers the refresh
      await call.start();
      if(typeof window.attachCallAudio === 'function') window.attachCallAudio(call);
      // Diagnostic: log call object shape so we can see what the SDK exposes
      try {
        const keys = Object.getOwnPropertyNames(Object.getPrototypeOf(call)||{}).concat(Object.keys(call||{}));
        window.logError('sw_call_keys', keys.slice(0,60).join(','), null, { hasRemoteStream: !!call.remoteStream, hasPeer: !!call.peer });
      } catch(_) {}
      window.logError('startCall_step', '4_call_started', null, { attempt });
      return call;
    } catch(e){
      // Tear down the half-created call before retrying
      if(call) { try { await call.leave(); } catch(_) {} }
      if(attempt === 0 && isExpiredTokenError(e)){
        window.logError('startCall_token_refresh', 'Detected expired auth — refreshing token', null, {});
        await initSWClient(true);   // force re-init with fresh JWT
        continue;
      }
      throw e;
    }
  }
  throw new Error('Call setup failed after token refresh');
}

window.__nlmCallingLoaded = true;
