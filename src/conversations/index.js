// NLM CRM - conversations / unified inbox (SMS + Email + Calls tab)
//
// MIGRATION NOTE (step 10 of the modular extraction):
// FIRST and ONLY file in src/conversations/. Strangler-fig: this module
// duplicates the whole CONVERSATIONS block from index.html (~lines
// 10083-10631, 16 functions). Nothing imports from it yet; the inline copies
// remain authoritative for every callsite (the Conversations page nav, the
// filter tabs onclick="setConvFilter(...)" strings, the conv-item onclick
// handlers, the compose-tab onclick, the send buttons, all resolve to the
// inline functions via window from the hoisted-function declarations).
//
// NAMING DEVIATION FROM target-layout-decision:
// The saved memory `target-layout-decision` planned the directory name as
// `sms/`. The actual code in index.html uses "CONVERSATIONS" throughout — the
// page id is `conversations`, the state var is `conversations`, the inbox
// renders both SMS and Email channels in the same thread, every function is
// `conv*` / `renderConvX` / `openConversation`. `conversations/` matches the
// code language and is a more accurate name for the unified-inbox surface.
// The saved memory has been updated to reflect this.
//
// Roadmap progression (per saved memory + CONTINUE-HERE):
//   8a-g.  contacts/         DONE
//   9a-c.  pipelines/        DONE
//   10.    conversations/    <- this file (was planned as sms/)
//   11.    settings/         NEXT
//   12.    calling/          LAST (deliberately deferred, stable)
//
// Six state-mirror entries added inline as part of this step:
// `activeConvContactId`, `convFilter`, `convSearchQ`, `convSort`,
// `composeChannel`, `callHistory`.
//
// SCOPE (16 functions verbatim-copied from index.html ~lines 10083-10631):
//
// List + state (8):
//   saveConversations, renderConversations, getConvLastMsg, renderConvList,
//   toggleConvSort, relativeTime, setConvFilter, filterConvList
//
// Thread + info panel (4):
//   openConversation, renderConvBubbles, renderConvInfoPanel,
//   startNewConvMessage
//
// Compose + send (4):
//   setComposeChannel, updateConvSmsCount, insertConvMerge, sendConvMessage
//
// Plus the navigation shim openConvWithContact (1, but listed under list
// for grouping).
//
// `findContactByPhone` already lives in src/contacts/helpers.js (step 8a)
// AND inline; the module reads it via window.* which resolves to the inline
// copy. No re-extraction needed here.
//
// ADAPTATIONS FROM VERBATIM:
//
// State (via window.* mirror; declared `let` inline so not on window
// automatically):
// - `conversations`         already bridged in 8d-prep
// - `activeConvContactId`   newly bridged
// - `convFilter`            newly bridged
// - `convSearchQ`           newly bridged
// - `convSort`              newly bridged
// - `composeChannel`        newly bridged
// - `callHistory`           newly bridged (used by the Calls tab branch
//                           of renderConvList)
// - `contacts`, `pipelines`, `sb`, `contactCustomFields` all already bridged
//
// Inline `function foo(){}` declarations resolve via the global object even
// from module scope, but the established pattern is to prefix with `window.*`
// for clarity:
// - UI: `showToast`, `getAv`, `initials`, `getStatusMeta`, `formatCurrency`
// - Helpers: `findContactByPhone`, `fmtDuration`, `touchContactActivity`,
//   `renderSwFromPicker`, `getPrimarySwPhone`, `getIntData`, `getIntSecret`,
//   `dialpadSetNumber`, `openDialpad`, `fireZapierEvent`
// - Cross-module: `openContactDetail`, `openContactModal`, `closeDetail`,
//   `openFollowupModal`, `openEventModal`, `navigate`
//
// References inside HTML attribute strings (setConvFilter, filterConvList,
// toggleConvSort, openConversation, openConvWithContact, openContactDetail,
// startNewConvMessage, openContactModal, navigate, openFollowupModal,
// openEventModal, setComposeChannel, updateConvSmsCount, insertConvMerge,
// sendConvMessage, dialpadSetNumber, openDialpad, closeDetail) are LEFT BARE
// because those strings are parsed at click-time / event-time and resolve
// via window from the inline hoisted-function declarations.
//
// Module-local refs called bare (same-module sibling calls):
// `saveConversations`, `renderConversations`, `renderConvList`,
// `getConvLastMsg`, `relativeTime`, `openConversation`, `renderConvBubbles`,
// `renderConvInfoPanel`, `updateConvSmsCount`, `startNewConvMessage`.

// ───────────────── PERSISTENCE ─────────────────

export async function saveConversations(){
  if(!window.conversations.length) return;
  try {
    await window.sb.upsert('conversations', window.conversations.map(c=>({
      id: c.id, contact_id: c.contactId||null, messages: c.messages||[]
    })), 'id');
  } catch(e){ console.error('saveConversations:', e); }
}

// ───────────────── LIST RENDER + SORT/FILTER/SEARCH ─────────────────

export function renderConversations(){
  renderConvList();
}

export function getConvLastMsg(conv){
  return [...conv.messages].sort((a,b)=>new Date(b.ts)-new Date(a.ts))[0];
}

export function renderConvList(){
  const el = document.getElementById('conv-contact-list'); if(!el) return;

  // ── CALLS TAB: render call history items, not conversation contacts ──
  if(window.convFilter === 'calls'){
    let calls = [...window.callHistory];
    if(window.convSearchQ){
      calls = calls.filter(c => {
        const contact = window.findContactByPhone(c.number);
        const name = (contact?.name || c.contactName || '').toLowerCase();
        return name.includes(window.convSearchQ) || (c.number||'').includes(window.convSearchQ);
      });
    }
    calls.sort((a,b) => {
      const ta = new Date(a.ts||0).getTime();
      const tb = new Date(b.ts||0).getTime();
      return window.convSort === 'oldest' ? ta - tb : tb - ta;
    });

    if(calls.length === 0){
      el.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text3);font-size:12px">${window.convSearchQ?'No calls match your search':'No call history yet'}</div>`;
      return;
    }

    el.innerHTML = calls.map(c => {
      const contact = window.findContactByPhone(c.number);
      const displayName = contact?.name || c.contactName || c.number;
      const avCls = contact ? window.getAv(contact.id) : 'av-blue';
      const avClr = {'av-pink':'var(--pink)','av-blue':'var(--accent2)','av-amber':'var(--amber)','av-green':'var(--green)','av-purple':'var(--purple)'}[avCls]||'var(--accent2)';
      const avBg  = {'av-pink':'var(--pink-bg)','av-blue':'var(--accent-bg)','av-amber':'var(--amber-bg)','av-green':'var(--green-bg)','av-purple':'var(--purple-bg)'}[avCls]||'var(--accent-bg)';
      const av    = contact ? window.initials(contact.name) : '☎';

      let icon, iconColor;
      if(c.direction === 'inbound'){
        if(c.status === 'missed'){ icon = '↙'; iconColor = 'var(--red)'; }
        else                      { icon = '↙'; iconColor = 'var(--green)'; }
      } else {
        if(c.status === 'failed') { icon = '↗'; iconColor = 'var(--red)'; }
        else                      { icon = '↗'; iconColor = 'var(--accent2)'; }
      }
      const statusText = c.status === 'missed' ? 'Missed call'
                       : c.status === 'failed' ? 'Failed'
                       : c.direction === 'inbound' ? `Incoming · ${window.fmtDuration(c.duration)}`
                       : `Outgoing · ${window.fmtDuration(c.duration)}`;
      const statusColor = (c.status==='missed'||c.status==='failed') ? 'var(--red)' : 'var(--text3)';
      const numberLine = contact
        ? `<span style="color:var(--text3)">${c.number}</span>`
        : `<span style="color:var(--amber);font-size:10px">Not in contacts</span>`;
      const onClick = contact
        ? `openConversation('${contact.id}')`
        : `dialpadSetNumber('${c.number}');openDialpad()`;

      return `<div class="conv-item" onclick="${onClick}" title="${contact?'Open conversation':'Redial '+c.number}">
        <div class="conv-item-av" style="background:${avBg};color:${avClr}">${av}</div>
        <div class="conv-item-info">
          <div class="conv-item-name">
            <span style="color:${iconColor};font-weight:700;margin-right:4px">${icon}</span>${displayName}
          </div>
          <div class="conv-item-preview" style="color:${statusColor}">${statusText} · ${numberLine}</div>
        </div>
        <div class="conv-item-meta">
          <span class="conv-item-time">${relativeTime(c.ts)}</span>
        </div>
      </div>`;
    }).join('');
    return;
  }

  // ── ALL / SMS / EMAIL / UNREAD: render conversation contacts ──
  let filtered = [...window.conversations];

  // Apply filter
  if(window.convFilter==='sms')    filtered = filtered.filter(c=>c.messages.some(m=>m.ch==='sms'));
  if(window.convFilter==='email')  filtered = filtered.filter(c=>c.messages.some(m=>m.ch==='email'));
  if(window.convFilter==='unread') filtered = filtered.filter(c=>c.messages.some(m=>m.dir==='inbound'&&m.status==='received'));

  // Apply search
  if(window.convSearchQ){
    filtered = filtered.filter(c=>{
      const contact = window.contacts.find(x=>x.id===c.contactId);
      const name = (contact?.name||'').toLowerCase();
      const lastMsg = getConvLastMsg(c)?.body||'';
      return name.includes(window.convSearchQ)||lastMsg.toLowerCase().includes(window.convSearchQ);
    });
  }

  // Sort by latest message — respect convSort direction
  filtered.sort((a,b)=>{
    const ta = new Date(getConvLastMsg(a)?.ts||0).getTime();
    const tb = new Date(getConvLastMsg(b)?.ts||0).getTime();
    return window.convSort === 'oldest' ? ta - tb : tb - ta;
  });

  if(filtered.length===0){
    el.innerHTML=`<div style="padding:24px;text-align:center;color:var(--text3);font-size:12px">${window.convSearchQ?'No conversations match your search':'No conversations yet'}</div>`;
    return;
  }

  el.innerHTML = filtered.map(conv=>{
    const contact  = window.contacts.find(x=>x.id===conv.contactId)||{name:'Unknown',id:conv.contactId};
    const lastMsg  = getConvLastMsg(conv);
    const hasUnread= conv.messages.some(m=>m.dir==='inbound'&&m.status==='received');
    const avCls    = window.getAv(contact.id);
    const avClr    = {'av-pink':'var(--pink)','av-blue':'var(--accent2)','av-amber':'var(--amber)','av-green':'var(--green)','av-purple':'var(--purple)'}[avCls]||'var(--accent2)';
    const avBg     = {'av-pink':'var(--pink-bg)','av-blue':'var(--accent-bg)','av-amber':'var(--amber-bg)','av-green':'var(--green-bg)','av-purple':'var(--purple-bg)'}[avCls]||'var(--accent-bg)';
    const chIcon   = lastMsg?.ch==='email'?'📧':'📱';
    const timeStr  = lastMsg ? relativeTime(lastMsg.ts) : '';
    const preview  = lastMsg ? (lastMsg.dir==='outbound'?'You: ':'')+lastMsg.body.slice(0,45)+(lastMsg.body.length>45?'…':'') : '';
    const isActive = conv.contactId===window.activeConvContactId;

    return `<div class="conv-item ${isActive?'active':''}" onclick="openConversation('${conv.contactId}')">
      <div class="conv-item-av" style="background:${avBg};color:${avClr}">${window.initials(contact.name)}</div>
      <div class="conv-item-info">
        <div class="conv-item-name">
          ${contact.name}
          <span class="conv-ch-icon">${chIcon}</span>
          ${hasUnread?'<span style="width:6px;height:6px;border-radius:50%;background:var(--accent);flex-shrink:0;display:inline-block"></span>':''}
        </div>
        <div class="conv-item-preview" style="${hasUnread?'color:var(--text);font-weight:500':''}">${preview}</div>
      </div>
      <div class="conv-item-meta">
        <span class="conv-item-time">${timeStr}</span>
        ${hasUnread?'<span class="conv-unread-dot"></span>':''}
      </div>
    </div>`;
  }).join('');
}

export function toggleConvSort(){
  window.convSort = window.convSort === 'newest' ? 'oldest' : 'newest';
  const btn = document.getElementById('conv-sort-btn');
  const icon = document.getElementById('conv-sort-icon');
  const label = document.getElementById('conv-sort-label');
  if(label) label.textContent = window.convSort === 'newest' ? 'New' : 'Old';
  if(btn) btn.title = window.convSort === 'newest' ? 'Sort: newest first (click for oldest)' : 'Sort: oldest first (click for newest)';
  // Flip the arrow icon
  if(icon){
    icon.innerHTML = window.convSort === 'newest'
      ? '<path d="M12 5v14"/><polyline points="19 12 12 19 5 12"/>'
      : '<path d="M12 19V5"/><polyline points="5 12 12 5 19 12"/>';
  }
  renderConvList();
}

export function relativeTime(isoStr){
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff/60000);
  if(mins<1) return 'now';
  if(mins<60) return mins+'m';
  const hrs = Math.floor(mins/60);
  if(hrs<24) return hrs+'h';
  const days = Math.floor(hrs/24);
  if(days<7) return days+'d';
  return new Date(isoStr).toLocaleDateString([],{month:'short',day:'numeric'});
}

export function setConvFilter(f, el){
  window.convFilter = f;
  document.querySelectorAll('.conv-filter-tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  renderConvList();
}

export function filterConvList(q){
  window.convSearchQ = q.toLowerCase();
  renderConvList();
}

// ───────────────── OPEN A CONVERSATION (thread view) ─────────────────

export function openConversation(contactId){
  window.activeConvContactId = contactId;
  renderConvList(); // re-render to highlight active

  // Show "From" picker if user has multiple SignalWire numbers
  window.renderSwFromPicker('conv-sms-from-picker');

  const conv    = window.conversations.find(c=>c.contactId===contactId);
  const contact = window.contacts.find(x=>x.id===contactId)||{name:'Unknown',id:contactId};
  const avCls   = window.getAv(contactId);
  const avClr   = {'av-pink':'var(--pink)','av-blue':'var(--accent2)','av-amber':'var(--amber)','av-green':'var(--green)','av-purple':'var(--purple)'}[avCls]||'var(--accent2)';
  const avBg    = {'av-pink':'var(--pink-bg)','av-blue':'var(--accent-bg)','av-amber':'var(--amber-bg)','av-green':'var(--green-bg)','av-purple':'var(--purple-bg)'}[avCls]||'var(--accent-bg)';

  // Mark inbound messages as read
  if(conv) conv.messages.forEach(m=>{ if(m.dir==='inbound'&&m.status==='received') m.status='read'; });
  saveConversations();

  // Show thread wrap, hide empty state
  document.getElementById('conv-empty-state').style.display='none';
  const threadWrap = document.getElementById('conv-thread-wrap');
  threadWrap.style.display='flex';

  // Thread header
  document.getElementById('conv-thread-head').innerHTML=`
    <div class="conv-thread-av" style="background:${avBg};color:${avClr}">${window.initials(contact.name)}</div>
    <div style="flex:1">
      <div class="conv-thread-name">${contact.name}</div>
      <div class="conv-thread-sub">${contact.company||''} ${contact.phone?'· '+contact.phone:''} ${contact.email?'· '+contact.email:''}</div>
    </div>
    <div style="display:flex;gap:6px">
      <button class="btn btn-sm" onclick="openContactDetail('${contactId}')">View Contact</button>
      <button class="btn btn-sm btn-primary" onclick="startNewConvMessage('${contactId}')">+ New Message</button>
    </div>`;

  // Render bubbles
  renderConvBubbles(conv, avBg, avClr);

  // Render right info panel
  renderConvInfoPanel(contact, conv);

  // Set up compose
  document.getElementById('compose-sms-body').value = '';
  document.getElementById('compose-email-body').value = '';
  document.getElementById('compose-email-subject').value = '';
}

export function renderConvBubbles(conv, avBg, avClr){
  const el = document.getElementById('conv-bubbles'); if(!el) return;
  if(!conv||!conv.messages.length){
    el.innerHTML=`<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:13px">No messages yet. Send one below!</div>`;
    return;
  }

  const sorted = [...conv.messages].sort((a,b)=>new Date(a.ts)-new Date(b.ts));
  let lastDay = '';
  let html = '';

  sorted.forEach(msg=>{
    const d = new Date(msg.ts);
    const dayStr = d.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'});
    if(dayStr!==lastDay){
      html+=`<div class="conv-day-divider"><span>${dayStr}</span></div>`;
      lastDay=dayStr;
    }

    const isOut = msg.dir==='outbound';
    const bubbleClass = `${isOut?'outbound':'inbound'}-${msg.ch}`;
    const timeStr = d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});

    // Status indicator for outbound
    let statusHtml='';
    if(isOut){
      const statusIcons={sending:'⌛ Sending',sent:'✓ Sent',delivered:'✓✓ Delivered',read:'✓✓ Read',failed:'✗ Failed',received:''};
      const statusClass={sent:'conv-status-sent',delivered:'conv-status-delivered',read:'conv-status-read',failed:'conv-status-failed'};
      if(statusIcons[msg.status]) statusHtml=`<div class="conv-bubble-status ${statusClass[msg.status]||''}">${statusIcons[msg.status]}</div>`;
    }

    const bodyHtml = msg.ch==='email'
      ? `${msg.subject?`<div class="conv-bubble-subject">📧 ${msg.subject}</div>`:''}${(msg.body||'').replace(/\n/g,'<br>')}`
      : msg.body;

    html+=`<div class="conv-bubble-wrap ${isOut?'outbound':'inbound'}">
      ${!isOut?`<div class="conv-bubble-av" style="background:${avBg};color:${avClr};font-size:8px">${window.initials(conv._contactName||'?')}</div>`:''}
      <div>
        <div class="conv-bubble ${bubbleClass}">${bodyHtml}<span class="conv-bubble-time">${timeStr}</span></div>
        ${statusHtml}
      </div>
      ${isOut?`<div class="conv-bubble-av" style="background:var(--accent-bg);color:var(--accent2);font-size:8px">ME</div>`:''}
    </div>`;
  });

  el.innerHTML = html;
  // Scroll to bottom
  el.scrollTop = el.scrollHeight;
}

export function renderConvInfoPanel(contact, conv){
  const el = document.getElementById('conv-info-content');
  const empty = document.getElementById('conv-info-empty');
  if(!el||!contact) return;
  empty.style.display='none';
  el.style.display='block';

  // Get contact's deals across all pipelines
  const deals = [];
  window.pipelines.forEach(p=>{
    p.deals.filter(d=>d.name===contact.name||d.company===contact.company).forEach(d=>{
      const stage = p.stages.find(s=>s.id===d.stage);
      deals.push({...d, pipelineName:p.name, stageName:stage?.label||'Unknown'});
    });
  });

  // Custom fields
  const cfRows = window.contactCustomFields.map(f=>`
    <div class="conv-info-row">
      <span class="conv-info-key">${f.name}</span>
      <span class="conv-info-val">${(contact.customFields||{})[f.id]||'—'}</span>
    </div>`).join('');

  // Message stats
  const msgs = conv?.messages||[];
  const smsCount   = msgs.filter(m=>m.ch==='sms').length;
  const emailCount = msgs.filter(m=>m.ch==='email').length;
  const lastMsgTime = msgs.length ? relativeTime(getConvLastMsg(conv).ts) : '—';

  const _stMeta = window.getStatusMeta(contact.status);

  el.innerHTML=`
    <!-- Contact summary -->
    <div class="conv-info-section">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <div class="conv-thread-av" style="width:42px;height:42px;background:${{'av-pink':'var(--pink-bg)','av-blue':'var(--accent-bg)','av-amber':'var(--amber-bg)','av-green':'var(--green-bg)','av-purple':'var(--purple-bg)'}[window.getAv(contact.id)]||'var(--accent-bg)'};color:${{'av-pink':'var(--pink)','av-blue':'var(--accent2)','av-amber':'var(--amber)','av-green':'var(--green)','av-purple':'var(--purple)'}[window.getAv(contact.id)]||'var(--accent2)'};font-size:13px">${window.initials(contact.name)}</div>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--text)">${contact.name}</div>
          <div style="font-size:11px;color:var(--text3)">${contact.company||'—'}</div>
        </div>
      </div>
      <span class="pill ${_stMeta.color}" style="margin-bottom:10px;display:inline-block">${_stMeta.label}</span>
      <div class="conv-info-row"><span class="conv-info-key">Email</span><span class="conv-info-val" style="font-family:'DM Mono',monospace;font-size:11px">${contact.email||'—'}</span></div>
      <div class="conv-info-row"><span class="conv-info-key">Phone</span><span class="conv-info-val" style="font-family:'DM Mono',monospace;font-size:11px">${contact.phone||'—'}</span></div>
      <div class="conv-info-row"><span class="conv-info-key">Source</span><span class="conv-info-val">${contact.source||'—'}</span></div>
    </div>

    <!-- Tags -->
    <div class="conv-info-section">
      <div class="conv-info-section-title">
        Tags
        <button class="btn btn-sm" style="font-size:10px;padding:2px 8px" onclick="closeDetail();openContactModal('${contact.id}','tags')">Manage</button>
      </div>
      <div class="conv-info-tags">
        ${(contact.tags||[]).map(t=>`<span class="tag ${t.cls}">${t.label}</span>`).join('')}
        ${(!contact.tags||contact.tags.length===0)?'<span style="font-size:11px;color:var(--text3)">No tags</span>':''}
      </div>
    </div>

    <!-- Pipeline deals -->
    <div class="conv-info-section">
      <div class="conv-info-section-title">
        Pipeline
        <button class="btn btn-sm" style="font-size:10px;padding:2px 8px" onclick="navigate('pipeline')">View All</button>
      </div>
      ${deals.length===0?'<div style="font-size:11px;color:var(--text3)">No deals found</div>'
        :deals.map(d=>`<div class="conv-deal-card" onclick="navigate('pipeline')">
          <div class="conv-deal-name">${d.name}</div>
          <div class="conv-deal-stage">${d.pipelineName} · ${d.stageName}</div>
          <div class="conv-deal-val">${window.formatCurrency(d.value||0)}/mo</div>
        </div>`).join('')}
    </div>

    <!-- Conversation stats -->
    <div class="conv-info-section">
      <div class="conv-info-section-title">Conversation Stats</div>
      <div class="conv-info-row"><span class="conv-info-key">SMS Messages</span><span class="conv-info-val">${smsCount}</span></div>
      <div class="conv-info-row"><span class="conv-info-key">Emails</span><span class="conv-info-val">${emailCount}</span></div>
      <div class="conv-info-row"><span class="conv-info-key">Last Message</span><span class="conv-info-val">${lastMsgTime}</span></div>
    </div>

    <!-- Custom fields -->
    ${window.contactCustomFields.length>0?`<div class="conv-info-section">
      <div class="conv-info-section-title">
        Custom Fields
        <button class="btn btn-sm" style="font-size:10px;padding:2px 8px" onclick="openContactModal('${contact.id}','custom')">Edit</button>
      </div>
      ${cfRows}
    </div>`:''}

    <!-- Quick actions -->
    <div class="conv-info-section">
      <div class="conv-info-section-title">Quick Actions</div>
      <div class="conv-action-btn" onclick="openContactDetail('${contact.id}')">👤 View Full Contact</div>
      <div class="conv-action-btn" onclick="openContactModal('${contact.id}','tags')">🏷 Manage Tags</div>
      <div class="conv-action-btn" onclick="navigate('pipeline')">📊 View Pipeline</div>
      <div class="conv-action-btn" onclick="openFollowupModal('${contact.id}')">📅 Schedule Follow-up</div>
      <div class="conv-action-btn" onclick="navigate('calendar');openEventModal(new Date())">📆 Schedule Meeting</div>
    </div>`;
}

// ───────────────── COMPOSE + SEND ─────────────────

export function setComposeChannel(ch, el){
  window.composeChannel = ch;
  document.querySelectorAll('.conv-compose-tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('compose-sms-panel').style.display  = ch==='sms'  ? 'block':'none';
  document.getElementById('compose-email-panel').style.display = ch==='email'? 'block':'none';
}

export function updateConvSmsCount(){
  const body = document.getElementById('compose-sms-body').value;
  const el   = document.getElementById('conv-sms-count');
  if(el){ el.textContent=`${body.length}/160`; el.style.color=body.length>160?'var(--red)':body.length>140?'var(--amber)':'var(--text3)'; }
}

export function insertConvMerge(ch){
  const contact = window.contacts.find(x=>x.id===window.activeConvContactId);
  const name = contact?.name?.split(' ')[0] || '{{name}}';
  const fieldId = ch==='sms' ? 'compose-sms-body' : 'compose-email-body';
  const el = document.getElementById(fieldId); if(!el) return;
  el.focus();
  const start = el.selectionStart, end = el.selectionEnd;
  el.value = el.value.slice(0,start) + name + el.value.slice(end);
  el.selectionStart = el.selectionEnd = start + name.length;
}

export async function sendConvMessage(ch){
  if(!window.activeConvContactId){ window.showToast('No conversation selected','error'); return; }
  const contact = window.contacts.find(x=>x.id===window.activeConvContactId);

  let body='', subject='';
  if(ch==='sms'){
    body = document.getElementById('compose-sms-body').value.trim();
    if(!body){ window.showToast('Write a message first','error'); return; }
  } else {
    subject = document.getElementById('compose-email-subject').value.trim();
    body    = document.getElementById('compose-email-body').value.trim();
    if(!body){ window.showToast('Write an email body first','error'); return; }
  }

  // Apply merge tags
  const applyMerge = str => str
    .replace(/\{\{name\}\}/gi, contact?.name?.split(' ')[0]||'there')
    .replace(/\{\{company\}\}/gi, contact?.company||'')
    .replace(/\{\{email\}\}/gi, contact?.email||'');

  const mergedBody    = applyMerge(body);
  const mergedSubject = applyMerge(subject);

  // Add message to conversation
  let conv = window.conversations.find(c=>c.contactId===window.activeConvContactId);
  if(!conv){
    conv = { id:'conv_'+Date.now(), contactId:window.activeConvContactId, messages:[] };
    window.conversations.push(conv);
  }

  const newMsg = {
    id:'msg_'+Date.now(), ch, dir:'outbound',
    body:mergedBody, subject:mergedSubject||undefined,
    ts:new Date().toISOString(), status:'sent'
  };
  conv.messages.push(newMsg);
  saveConversations();

  // Clear input
  if(ch==='sms'){ document.getElementById('compose-sms-body').value=''; updateConvSmsCount(); }
  else { document.getElementById('compose-email-body').value=''; document.getElementById('compose-email-subject').value=''; }

  // Re-render thread
  const avCls = window.getAv(window.activeConvContactId);
  const avBg  = {'av-pink':'var(--pink-bg)','av-blue':'var(--accent-bg)','av-amber':'var(--amber-bg)','av-green':'var(--green-bg)','av-purple':'var(--purple-bg)'}[avCls]||'var(--accent-bg)';
  const avClr = {'av-pink':'var(--pink)','av-blue':'var(--accent2)','av-amber':'var(--amber)','av-green':'var(--green)','av-purple':'var(--purple)'}[avCls]||'var(--accent2)';
  renderConvBubbles(conv, avBg, avClr);
  renderConvList();

  // Send via integration
  if(ch==='sms'){
    if(window.getPrimarySwPhone() && contact?.phone){
      newMsg.status='sending';
      renderConvBubbles(conv, avBg, avClr);
      // Use picker if multi-number, else primary
      const fromPicker = document.getElementById('conv-sms-from-picker-select');
      const fromNumber = (fromPicker && fromPicker.value) ? fromPicker.value : window.getPrimarySwPhone();
      try {
        const r = await fetch('/api/sms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:contact.phone,body:mergedBody,from:fromNumber})});
        const data = await r.json();
        if(data.error) throw new Error(data.error);
        newMsg.status='sent';
        if(data.sid) newMsg.sid=data.sid;
        saveConversations();
        window.touchContactActivity(contact.id, 'sms');
        renderConvBubbles(conv, avBg, avClr);
        window.showToast(`SMS sent to ${contact.phone} ✅`);
      } catch(e){
        newMsg.status='failed';
        saveConversations();
        renderConvBubbles(conv, avBg, avClr);
        window.showToast('SMS failed: '+e.message,'error');
      }
    } else {
      window.showToast('SMS logged (connect SignalWire in Integrations to send for real)');
    }
    if(typeof window.fireZapierEvent==='function') window.fireZapierEvent('sms_sent',{to:contact?.phone,body:mergedBody});
  } else {
    const fromAddr= window.getIntData('email')['email-from-addr']||'';
    if(fromAddr && contact?.email){
      const apiKey  = window.getIntSecret('email');
      const fromName= window.getIntData('email')['email-from-name']||'Next Level Marketing';
      const provider= window.getIntData('email')['email-provider']||'brevo';
      if(apiKey && fromAddr && provider==='brevo'){
        try {
          const res = await fetch('https://api.brevo.com/v3/smtp/email',{
            method:'POST',
            headers:{'api-key':apiKey,'Content-Type':'application/json'},
            body:JSON.stringify({sender:{name:fromName,email:fromAddr},to:[{email:contact.email}],subject:mergedSubject||'Message from Next Level Marketing',textContent:mergedBody})
          });
          if(res.ok||res.status===202){
            newMsg.status='delivered';
            saveConversations();
            renderConvBubbles(conv, avBg, avClr);
            window.showToast(`Email sent to ${contact.email} ✅`);
          } else { window.showToast('Email logged (check Brevo API key)'); }
        } catch(e){ window.showToast('Email logged (network error)'); }
      } else {
        window.showToast('Email logged (connect Email in Integrations to send for real)');
      }
    } else {
      window.showToast('Email logged (connect Email in Integrations to send for real)');
    }
  }
}

export function startNewConvMessage(contactId){
  // Just focus the compose box
  const el = document.getElementById('compose-sms-body');
  if(el) el.focus();
}

// ───────────────── START CONVERSATION FROM CONTACT ─────────────────

export function openConvWithContact(contactId){
  window.navigate('conversations');
  setTimeout(()=>openConversation(contactId), 100);
}

window.__nlmConversationsLoaded = true;
