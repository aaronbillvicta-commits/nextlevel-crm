// NLM CRM - active clients page (filtered view of contacts where status === 'done')
//
// MIGRATION NOTE (step 11 of the modular extraction):
// FIRST and ONLY file in src/clients/. Strangler-fig: this module duplicates
// the Active Clients block from index.html (renderClientsPage, editClientCell,
// saveClientField, ~3 functions). Nothing imports from it yet; the inline
// copies remain authoritative for every callsite (the navigate() dispatch,
// the HTML attribute strings on the Active Clients page, the save flow
// reachable from the Contact Detail drawer's Client Details card).
//
// This is a brand-new page (created 2026-05-17) rather than an extraction of
// pre-existing inline code, but it was written from the start to follow the
// modular shape so the additive copy lives here cleanly.
//
// ROADMAP POSITION:
//   8a-g.  contacts/         DONE
//   9a-c.  pipelines/        DONE
//   10.    conversations/    DONE
//   11.    clients/          <- this file (NEW page, was not on prior roadmap)
//   12.    settings/         NEXT
//   13.    calling/          LAST (deliberately deferred, stable after BUG-005/006/015)
//
// Three new contacts.* columns shipped alongside (Supabase migration
// `add_client_fields_to_contacts`, applied 2026-05-17):
//   - deposit numeric
//   - payment_structure text  (CHECK weekly | bi-weekly | monthly | NULL)
//   - assigned_va text
//
// SCOPE (3 functions verbatim-copied from index.html):
//
//   renderClientsPage          — table render, status === 'done' filter, search
//   editClientCell             — inline cell-edit lifecycle (swap-input/save/cancel)
//   saveClientField            — PATCH single field to public.contacts + in-memory update
//
// ADAPTATIONS from verbatim:
// - State vars via window.*: `contacts`, `sb` (both already bridged by the
//   state-mirror block at the end of the inline <script>).
// - Inline function refs via window.*: `showToast`, `logError`, `requirePerm`,
//   `getAv`, `initials`, `pName`, `pCompany`, `pEmail`, `pPhone`, `pTag`,
//   `fmtLastActivity`, `getCurrencySymbol`. None of these have module exports
//   yet (helpers extracted to src/contacts/helpers.js but module scope cannot
//   resolve cross-module exports without explicit imports — window.* resolves
//   to the inline copies which are authoritative).
// - Cross-module refs via window.*: `openContactDetail`, `openConvWithContact`
//   (from src/contacts/index.js and src/conversations/index.js respectively,
//   but inline is still authoritative everywhere).
//
// References inside HTML attribute strings (`renderClientsPage`,
// `editClientCell`, `openContactDetail`, `openConvWithContact`) are LEFT BARE
// because those strings are parsed at click-time/event-time and resolve via
// window from the inline hoisted-function declarations.
//
// Module-local refs called bare: `renderClientsPage`, `editClientCell`,
// `saveClientField` (same-module sibling calls — these resolve to the module
// copies inside the module scope, but no module imports it yet so the inline
// copies stay authoritative for every external callsite).
//
// VERIFICATION:
//   window.__nlmClientsLoaded === true  in DevTools after deploy
//   Active Clients page renders, search filters, deposit/payment/VA cells
//   click-to-edit, save commits to Supabase. All paths still use inline.

export function renderClientsPage(){
  const tbody = document.getElementById('clients-tbody'); if(!tbody) return;
  const q = (document.getElementById('clients-search')?.value || '').toLowerCase();
  const all = window.contacts.filter(c => c.status === 'done');
  const filtered = all.filter(c => !q
    || (c.name||'').toLowerCase().includes(q)
    || (c.company||'').toLowerCase().includes(q)
    || (c.email||'').toLowerCase().includes(q)
    || (c.phone||'').toLowerCase().includes(q)
    || (c.assigned_va||'').toLowerCase().includes(q)
  );
  const countEl = document.getElementById('clients-count-label');
  if(countEl) countEl.textContent = `(${filtered.length}${q ? ' of ' + all.length : ''})`;
  if(filtered.length === 0){
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--text3);padding:32px">${q ? 'No active clients match your search' : 'No active clients yet — mark a contact\'s status as "Client" to see them here.'}</td></tr>`;
    return;
  }
  const sym = (typeof window.getCurrencySymbol === 'function') ? window.getCurrencySymbol() : '$';
  tbody.innerHTML = filtered.map(c => {
    const depositTxt = (c.deposit != null && c.deposit !== '') ? `${sym}${Number(c.deposit).toLocaleString()}` : '<span style="opacity:.4">—</span>';
    const paymentTxt = c.payment_structure ? c.payment_structure.charAt(0).toUpperCase() + c.payment_structure.slice(1) : '<span style="opacity:.4">—</span>';
    const vaTxt = c.assigned_va ? c.assigned_va : '<span style="opacity:.4">—</span>';
    const lastAct = c.last_activity ? window.fmtLastActivity(c.last_activity) : '<span style="opacity:.4">—</span>';
    return `<tr>
      <td><div class="td-name" onclick="openContactDetail('${c.id}')" style="cursor:pointer"><div class="av-sm ${window.getAv(c.id)}">${window.initials(c.name)}</div><span style="color:var(--text);font-weight:500">${window.pName(c.name)}</span></div></td>
      <td style="color:var(--text2)">${c.company ? window.pCompany(c.company) : '-'}</td>
      <td><span style="color:var(--text3);font-family:'DM Mono',monospace;font-size:11px">${c.email ? window.pEmail(c.email) : '—'}</span></td>
      <td><span style="color:var(--text3);font-family:'DM Mono',monospace;font-size:11px">${c.phone ? window.pPhone(c.phone) : '—'}</span></td>
      <td><div class="tags-cell">${(c.tags||[]).map(t=>`<span class="tag ${t.cls}">${window.pTag(t.label)}</span>`).join('')}</div></td>
      <td onclick="editClientCell('${c.id}','deposit')" style="cursor:pointer;font-family:'DM Mono',monospace;font-size:12px" title="Click to edit deposit">${depositTxt}</td>
      <td onclick="editClientCell('${c.id}','payment_structure')" style="cursor:pointer;font-size:12px" title="Click to set payment cadence">${paymentTxt}</td>
      <td onclick="editClientCell('${c.id}','assigned_va')" style="cursor:pointer;font-size:12px" title="Click to assign VA">${vaTxt}</td>
      <td style="font-size:11px;color:var(--text3)">${lastAct}</td>
      <td style="white-space:nowrap"><button class="btn btn-sm" onclick="openContactDetail('${c.id}')">View</button> <button class="btn btn-sm" style="font-size:11px" onclick="openConvWithContact('${c.id}')">💬</button></td>
    </tr>`;
  }).join('');
}

export function editClientCell(contactId, field){
  if(typeof window.requirePerm === 'function' && !window.requirePerm('edit','You don\'t have permission to edit clients')) return;
  const c = window.contacts.find(x => x.id === contactId); if(!c) return;
  const tbody = document.getElementById('clients-tbody'); if(!tbody) return;
  const cell = [...tbody.querySelectorAll('td')].find(td =>
    td.getAttribute('onclick') === `editClientCell('${contactId}','${field}')`);
  if(!cell || cell.querySelector('input,select')) return;
  const current = c[field] != null ? c[field] : '';
  let input;
  if(field === 'payment_structure'){
    input = document.createElement('select');
    input.className = 'form-select';
    input.style.cssText = 'width:100%;padding:2px 4px;font-size:12px';
    input.innerHTML = `<option value="">—</option><option value="weekly">Weekly</option><option value="bi-weekly">Bi-weekly</option><option value="monthly">Monthly</option>`;
    input.value = current;
  } else {
    input = document.createElement('input');
    input.className = 'form-input';
    input.type = (field === 'deposit') ? 'number' : 'text';
    if(field === 'deposit'){ input.step = '0.01'; input.min = '0'; }
    input.style.cssText = 'width:100%;padding:2px 4px;font-size:12px';
    input.value = current;
  }
  const oldHTML = cell.innerHTML;
  const oldOnclick = cell.getAttribute('onclick');
  cell.removeAttribute('onclick');
  cell.innerHTML = '';
  cell.appendChild(input);
  input.focus();
  if(input.select) input.select();
  let finished = false;
  const commit = async () => {
    if(finished) return; finished = true;
    let val = input.value.trim();
    if(field === 'deposit') val = val === '' ? null : Number(val);
    if(field === 'payment_structure' && val === '') val = null;
    await saveClientField(contactId, field, val);
    renderClientsPage();
  };
  const cancel = () => {
    if(finished) return; finished = true;
    cell.innerHTML = oldHTML;
    if(oldOnclick) cell.setAttribute('onclick', oldOnclick);
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if(e.key === 'Enter'){ e.preventDefault(); input.blur(); }
    else if(e.key === 'Escape'){ e.preventDefault(); cancel(); }
  });
  if(field === 'payment_structure'){
    input.addEventListener('change', () => input.blur());
  }
}

export async function saveClientField(contactId, field, value){
  const c = window.contacts.find(x => x.id === contactId); if(!c) return;
  c[field] = value;
  try {
    await window.sb.patch('contacts', contactId, { [field]: value });
    window.showToast(`Saved`);
  } catch(e){
    window.logError('saveClientField', e.message, e.stack, { contactId, field });
    window.showToast(`Save failed: ${e.message || 'unknown'}`, 'error');
  }
}

window.__nlmClientsLoaded = true;
