// NLM CRM — Invoice tool (Tools → Invoice)
//
// AUTHORITATIVE MODULE (not a shadow copy). This feature is brand-new, so unlike
// the extracted modules (contacts/, calling/, etc. — which are inert copies of
// inline code), THIS file is the only place the invoice logic lives and it is
// what actually runs in the app.
//
// How it wires in:
//   - index.html loads this via <script type="module" src="src/invoices/index.js?v=…">
//   - The inline Tools page (renderToolsPage) calls window.renderInvoiceTool(el)
//     when the "Invoice" tab is active.
//   - It reads live CRM state through the state-mirror bridge: window.contacts
//     (the loaded contact list) and window.sb (the REST wrapper). It also reuses
//     window.showToast / window.escapeHtml when present.
//
// Deploy 1 (this file): generator + CRM-client picker + auto-seed from a client's
// assigned VAs + print/Save-PDF. NO persistence yet — print only.
// Deploy 2 (planned): an `invoices` Supabase table for saved invoice numbers,
// paid/unpaid history, and a list view. See BACKLOG / CONTINUE-HERE.

(function () {
  'use strict';

  // ── small utilities ────────────────────────────────────────────────────────
  const esc = (s) => (window.escapeHtml ? window.escapeHtml(s) : String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const toast = (m, t) => { if (window.showToast) window.showToast(m, t); };
  const uid = () => 'li' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const fmt$ = (n) => '$' + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fmtDate = (s) => { if (!s) return ''; const d = new Date(s + 'T00:00:00'); return isNaN(d) ? '' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); };
  const isoDate = (d) => new Date(d).toISOString().split('T')[0];
  const initials = (name) => (name || 'NL').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const contactName = (c) => c ? (c.name || [c.first_name, c.last_name].filter(Boolean).join(' ') || '') : '';

  // ── module state ─────────────────────────────────────────────────────────────
  const TERMS = { due_on_receipt: 0, net7: 7, net15: 15, net30: 30, net60: 60 };
  const today = new Date();
  const state = {
    billTo: 'crm',            // 'crm' | 'manual'
    selectedContactId: null,
    lineItems: [],
    logoDataUrl: null,
  };

  // ── one-time scoped CSS (kept entirely in this module; index.html gets none) ──
  const CSS = `
  .invoice-tool { display:grid; grid-template-columns: 340px 1fr; gap:24px; align-items:start; }
  @media (max-width:1100px){ .invoice-tool { grid-template-columns:1fr; } }
  .invoice-tool .it-controls { display:flex; flex-direction:column; gap:18px; }
  .invoice-tool .it-group-label { font-size:11px; font-weight:800; letter-spacing:.07em; text-transform:uppercase; color:var(--accent2); margin-bottom:8px; }
  .invoice-tool label { display:block; font-size:11px; color:var(--text3); margin-bottom:3px; }
  .invoice-tool .it-field { margin-bottom:10px; }
  .invoice-tool .it-tabbar { display:flex; border:1px solid var(--border); border-radius:6px; overflow:hidden; margin-bottom:10px; }
  .invoice-tool .it-tab { flex:1; padding:6px 10px; font-size:12px; font-weight:600; cursor:pointer; border:none; background:transparent; color:var(--text3); }
  .invoice-tool .it-tab.active { background:var(--accent); color:#fff; }
  .invoice-tool .it-tab:not(.active):hover { background:var(--bg3,rgba(127,127,127,.1)); }
  .invoice-tool .it-line { display:grid; grid-template-columns:1fr 90px 56px 76px 26px; gap:6px; align-items:center; margin-bottom:6px; }
  .invoice-tool .it-line input { width:100%; }
  .invoice-tool .it-line-head { display:grid; grid-template-columns:1fr 90px 56px 76px 26px; gap:6px; margin-bottom:4px; }
  .invoice-tool .it-line-head span { font-size:10px; color:var(--text3); }
  .invoice-tool .it-remove { background:transparent; border:none; color:#dc2626; font-size:16px; line-height:1; cursor:pointer; padding:0; }
  .invoice-tool .it-remove:hover { opacity:.7; }

  /* The printable invoice itself (white, light, isolated from the CRM theme) */
  .inv-doc { background:#fff; color:#111; border-radius:10px; padding:44px; box-shadow:0 4px 24px rgba(0,0,0,.18); max-width:820px; }
  .inv-doc * { box-sizing:border-box; }
  .inv-doc .inv-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:34px; }
  .inv-doc .inv-agency { display:flex; align-items:center; gap:12px; }
  .inv-doc .inv-logo-img { width:52px; height:52px; border-radius:10px; object-fit:cover; }
  .inv-doc .inv-logo-ph { width:52px; height:52px; border-radius:10px; background:#0e7c8c; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:20px; color:#fff; }
  .inv-doc .inv-agency-name { font-weight:800; font-size:19px; color:#1a1a2e; }
  .inv-doc .inv-agency-sub { font-size:12px; color:#666; margin-top:2px; }
  .inv-doc .inv-meta { text-align:right; }
  .inv-doc .inv-label { font-size:34px; font-weight:900; color:#0e7c8c; letter-spacing:-1px; }
  .inv-doc .inv-number { font-size:13px; color:#555; margin-top:4px; }
  .inv-doc .inv-date-row { font-size:12px; color:#666; margin-top:2px; }
  .inv-doc .inv-divider { border:none; border-top:1px solid #eef0f4; margin:22px 0; }
  .inv-doc .inv-parties { display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-bottom:28px; }
  .inv-doc .inv-plabel { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:#999; margin-bottom:6px; }
  .inv-doc .inv-pname { font-weight:700; font-size:15px; color:#1a1a2e; }
  .inv-doc .inv-pdetail { font-size:12px; color:#555; margin-top:2px; line-height:1.5; }
  .inv-doc table.inv-table { width:100%; border-collapse:collapse; margin-bottom:22px; }
  .inv-doc .inv-table th { background:#f1fafb; color:#0e7c8c; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; padding:10px 12px; text-align:left; border-bottom:2px solid #cfeaee; }
  .inv-doc .inv-table th.r, .inv-doc .inv-table td.r { text-align:right; }
  .inv-doc .inv-table td { padding:10px 12px; font-size:13px; border-bottom:1px solid #f0f0f5; vertical-align:top; }
  .inv-doc .inv-table tr:last-child td { border-bottom:none; }
  .inv-doc .inv-totals { display:flex; justify-content:flex-end; margin-bottom:28px; }
  .inv-doc .inv-totals-box { min-width:240px; }
  .inv-doc .inv-trow { display:flex; justify-content:space-between; padding:6px 0; font-size:13px; color:#333; }
  .inv-doc .inv-trow.sub { border-bottom:1px solid #eee; }
  .inv-doc .inv-trow.total { font-weight:800; font-size:16px; color:#1a1a2e; border-top:2px solid #0e7c8c; padding-top:10px; margin-top:4px; }
  .inv-doc .inv-footer { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; }
  .inv-doc .inv-notes { font-size:11px; color:#888; max-width:58%; line-height:1.6; white-space:pre-wrap; }
  .inv-doc .inv-badge { padding:6px 14px; border-radius:20px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; }
  .inv-doc .inv-badge.unpaid { background:#fef3c7; color:#92400e; }
  .inv-doc .inv-badge.paid { background:#dcfce7; color:#166534; }
  `;
  function injectCSS() {
    if (document.getElementById('invoice-tool-css')) return;
    const s = document.createElement('style');
    s.id = 'invoice-tool-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ── controls (rendered once; inputs update the preview live) ─────────────────
  function controlsHTML() {
    const dueDefault = new Date(today); dueDefault.setDate(dueDefault.getDate() + 30);
    return `
    <div class="it-controls">
      <div>
        <div class="it-group-label">Agency Details</div>
        <div class="it-field"><label>Agency Name</label><input class="form-input" id="invt-agencyName" value="Next Level Marketing" oninput="invoiceTool.render()"/></div>
        <div class="it-field"><label>Email / Website</label><input class="form-input" id="invt-agencyEmail" placeholder="hello@agency.com" oninput="invoiceTool.render()"/></div>
        <div class="it-field"><label>Address</label><input class="form-input" id="invt-agencyAddress" placeholder="123 Main St, City, State" oninput="invoiceTool.render()"/></div>
        <div class="it-field"><label>Logo URL (or upload)</label>
          <input class="form-input" id="invt-logoUrl" placeholder="https://…  — blank = initials" oninput="invoiceTool.clearUpload();invoiceTool.render()"/>
          <input type="file" accept="image/*" style="margin-top:6px;font-size:11px;color:var(--text3)" onchange="invoiceTool.onLogoUpload(event)"/>
        </div>
      </div>

      <div>
        <div class="it-group-label">Bill To</div>
        <div class="it-tabbar">
          <button class="it-tab ${state.billTo === 'manual' ? 'active' : ''}" id="invt-tab-manual" onclick="invoiceTool.setBillTo('manual')">Manual</button>
          <button class="it-tab ${state.billTo === 'crm' ? 'active' : ''}" id="invt-tab-crm" onclick="invoiceTool.setBillTo('crm')">From CRM</button>
        </div>
        <div id="invt-billto-body">${billToBodyHTML()}</div>
      </div>

      <div>
        <div class="it-group-label">Invoice Settings</div>
        <div class="it-field"><label>Invoice #</label><input class="form-input" id="invt-number" value="INV-001" oninput="invoiceTool.render()"/></div>
        <div class="it-field"><label>Invoice Date</label><input class="form-input" id="invt-issueDate" type="date" value="${isoDate(today)}" onchange="invoiceTool.applyTerms()"/></div>
        <div class="it-field"><label>Due Date</label><input class="form-input" id="invt-dueDate" type="date" value="${isoDate(dueDefault)}" onchange="invoiceTool.render()"/></div>
        <div class="it-field"><label>Payment Terms</label>
          <select class="form-input" id="invt-terms" onchange="invoiceTool.applyTerms()">
            <option value="due_on_receipt">Due on Receipt</option>
            <option value="net7">Net 7</option>
            <option value="net15">Net 15</option>
            <option value="net30" selected>Net 30</option>
            <option value="net60">Net 60</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div class="it-field"><label>Tax Rate (%)</label><input class="form-input" id="invt-taxRate" type="number" value="0" min="0" max="100" step="0.5" oninput="invoiceTool.render()"/></div>
        <div class="it-field"><label>Status</label>
          <select class="form-input" id="invt-status" onchange="invoiceTool.render()">
            <option value="unpaid">Unpaid</option>
            <option value="paid">Paid</option>
          </select>
        </div>
        <div class="it-field"><label>Notes / Payment Instructions</label><textarea class="form-input" id="invt-notes" rows="3" oninput="invoiceTool.render()">Thank you for your business! Please make payment within the agreed terms.</textarea></div>
      </div>
    </div>`;
  }

  function billToBodyHTML() {
    if (state.billTo === 'manual') {
      return `
        <div class="it-field"><label>Client Name</label><input class="form-input" id="invt-mName" placeholder="Jane Smith" oninput="invoiceTool.render()"/></div>
        <div class="it-field"><label>Company</label><input class="form-input" id="invt-mCompany" placeholder="Acme Corp" oninput="invoiceTool.render()"/></div>
        <div class="it-field"><label>Email</label><input class="form-input" id="invt-mEmail" placeholder="jane@acme.com" oninput="invoiceTool.render()"/></div>
        <div class="it-field"><label>Phone</label><input class="form-input" id="invt-mPhone" placeholder="+1 (555) 000-0000" oninput="invoiceTool.render()"/></div>
        <div class="it-field"><label>Address</label><input class="form-input" id="invt-mAddress" placeholder="456 Client Ave, City" oninput="invoiceTool.render()"/></div>`;
    }
    const list = (window.contacts || []);
    if (!list.length) {
      return `<div style="font-size:12px;color:var(--text3);padding:8px 0">No contacts loaded yet. Open the Contacts page once, or use Manual entry.</div>`;
    }
    const opts = list.slice().sort((a, b) => contactName(a).localeCompare(contactName(b)))
      .map((c) => `<option value="${esc(c.id)}" ${state.selectedContactId === c.id ? 'selected' : ''}>${esc(contactName(c) || '(no name)')}${c.company ? ' — ' + esc(c.company) : ''}</option>`).join('');
    return `
      <div class="it-field"><label>Select Client</label>
        <select class="form-input" id="invt-crmClient" onchange="invoiceTool.selectClient(this.value)">
          <option value="">— Choose a contact —</option>${opts}
        </select>
      </div>
      <div style="font-size:11px;color:var(--text3)">Picking a client with assigned VAs auto-adds them as line items.</div>`;
  }

  // ── line items editor ────────────────────────────────────────────────────────
  function lineEditorHTML() {
    const rows = state.lineItems.map((li) => `
      <div class="it-line">
        <input class="form-input" type="text" placeholder="e.g. Social Media Management" value="${esc(li.desc)}" oninput="invoiceTool.updateItem('${li.id}','desc',this.value)"/>
        <input class="form-input" type="text" placeholder="VA Name" value="${esc(li.va || '')}" oninput="invoiceTool.updateItem('${li.id}','va',this.value)"/>
        <input class="form-input" type="number" placeholder="0" min="0" step="0.5" value="${li.hours}" oninput="invoiceTool.updateItem('${li.id}','hours',this.value)"/>
        <input class="form-input" type="number" placeholder="0.00" min="0" step="0.01" value="${li.rate}" oninput="invoiceTool.updateItem('${li.id}','rate',this.value)"/>
        <button class="it-remove" title="Remove" onclick="invoiceTool.removeItem('${li.id}')">&times;</button>
      </div>`).join('');
    return `
      <div class="it-group-label" style="display:flex;justify-content:space-between;align-items:center">
        <span>Line Items</span>
        <button class="btn btn-sm btn-primary" onclick="invoiceTool.addItem()">+ Add row</button>
      </div>
      <div class="it-line-head">
        <span>Description</span><span>VA Name</span><span>Hours</span><span>Rate $/hr</span><span></span>
      </div>
      <div id="invt-lines">${rows || '<div style="font-size:12px;color:var(--text3);padding:6px 0">No line items yet — click “+ Add row”.</div>'}</div>`;
  }

  // ── totals from current line items ───────────────────────────────────────────
  function totals() {
    const subtotal = state.lineItems.reduce((s, li) => s + (parseFloat(li.hours) || 0) * (parseFloat(li.rate) || 0), 0);
    const taxRate = parseFloat(val('invt-taxRate')) || 0;
    const tax = subtotal * taxRate / 100;
    return { subtotal, taxRate, tax, total: subtotal + tax };
  }

  // ── the invoice document (preview + print share this) ────────────────────────
  function logoSrc() {
    if (state.logoDataUrl) return state.logoDataUrl;
    const u = (val('invt-logoUrl') || '').trim();
    return u || null;
  }
  function billToParty() {
    if (state.billTo === 'manual') {
      const name = (val('invt-mName') || '').trim();
      const detail = [val('invt-mCompany'), val('invt-mEmail'), val('invt-mPhone'), val('invt-mAddress')]
        .map((x) => (x || '').trim()).filter(Boolean).map(esc).join('<br/>');
      return { name: name ? esc(name) : '—', detail: detail || '<span style="color:#bbb">Fill in client details</span>' };
    }
    const c = (window.contacts || []).find((x) => x.id === state.selectedContactId);
    if (!c) return { name: '—', detail: 'Select a client from the list' };
    const detail = [c.company, c.email, c.phone, c.address].filter(Boolean).map(esc).join('<br/>');
    return { name: esc(contactName(c)), detail: detail };
  }

  function invoiceDocHTML() {
    const agencyName = (val('invt-agencyName') || 'Next Level Marketing').trim();
    const agencyEmail = (val('invt-agencyEmail') || '').trim();
    const agencyAddress = (val('invt-agencyAddress') || '').trim();
    const num = (val('invt-number') || 'INV-001').trim();
    const issue = val('invt-issueDate');
    const due = val('invt-dueDate');
    const status = val('invt-status') || 'unpaid';
    const notes = val('invt-notes') || '';
    const t = totals();
    const src = logoSrc();
    const logoHTML = src
      ? `<img src="${esc(src)}" class="inv-logo-img" alt="logo"/>`
      : `<div class="inv-logo-ph">${esc(initials(agencyName))}</div>`;
    const agencySub = [agencyEmail, agencyAddress].filter(Boolean).map(esc).join(' · ');
    const fromDetail = [agencyEmail, agencyAddress].filter(Boolean).map(esc).join('<br/>');
    const dateRow = [issue ? 'Issued: ' + fmtDate(issue) : '', due ? 'Due: ' + fmtDate(due) : ''].filter(Boolean).join('  ·  ');
    const party = billToParty();

    let body;
    if (!state.lineItems.length) {
      body = '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:20px">No line items yet</td></tr>';
    } else {
      body = state.lineItems.map((li) => {
        const h = parseFloat(li.hours) || 0, r = parseFloat(li.rate) || 0, amt = h * r;
        return `<tr>
          <td>${esc(li.desc) || '<em style="color:#bbb">—</em>'}</td>
          <td style="color:#555">${esc(li.va || '') || '<em style="color:#ccc">—</em>'}</td>
          <td class="r">${h > 0 ? h : '—'}</td>
          <td class="r">${r > 0 ? fmt$(r) + '/hr' : '—'}</td>
          <td class="r" style="font-weight:600">${amt > 0 ? fmt$(amt) : '—'}</td>
        </tr>`;
      }).join('');
    }
    const taxRowHTML = t.taxRate > 0
      ? `<div class="inv-trow"><span>Tax (${t.taxRate}%)</span><span>${fmt$(t.tax)}</span></div>` : '';

    return `
    <div class="inv-doc" id="invt-doc">
      <div class="inv-header">
        <div class="inv-agency">
          ${logoHTML}
          <div>
            <div class="inv-agency-name">${esc(agencyName)}</div>
            <div class="inv-agency-sub">${agencySub}</div>
          </div>
        </div>
        <div class="inv-meta">
          <div class="inv-label">INVOICE</div>
          <div class="inv-number"># ${esc(num)}</div>
          <div class="inv-date-row">${dateRow}</div>
        </div>
      </div>
      <hr class="inv-divider"/>
      <div class="inv-parties">
        <div>
          <div class="inv-plabel">From</div>
          <div class="inv-pname">${esc(agencyName)}</div>
          <div class="inv-pdetail">${fromDetail}</div>
        </div>
        <div>
          <div class="inv-plabel">Bill To</div>
          <div class="inv-pname">${party.name}</div>
          <div class="inv-pdetail">${party.detail}</div>
        </div>
      </div>
      <table class="inv-table">
        <thead><tr>
          <th style="width:35%">Description</th>
          <th style="width:20%">VA Name</th>
          <th class="r" style="width:13%">Hours</th>
          <th class="r" style="width:17%">Rate</th>
          <th class="r" style="width:15%">Amount</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
      <div class="inv-totals"><div class="inv-totals-box">
        <div class="inv-trow sub"><span>Subtotal</span><span>${fmt$(t.subtotal)}</span></div>
        ${taxRowHTML}
        <div class="inv-trow total"><span>Total Due</span><span>${fmt$(t.total)}</span></div>
      </div></div>
      <hr class="inv-divider"/>
      <div class="inv-footer">
        <div class="inv-notes">${esc(notes)}</div>
        <span class="inv-badge ${status}">${esc(status.toUpperCase())}</span>
      </div>
    </div>`;
  }

  // ── DOM helpers ──────────────────────────────────────────────────────────────
  function val(id) { const e = document.getElementById(id); return e ? e.value : ''; }
  let rootEl = null;

  function renderPreview() {
    const wrap = document.getElementById('invt-preview');
    if (wrap) wrap.innerHTML = invoiceDocHTML();
  }
  function renderLines() {
    const c = document.getElementById('invt-lineeditor');
    if (c) c.innerHTML = lineEditorHTML();
    renderPreview();
  }

  // ── public API (referenced by inline onclick handlers) ───────────────────────
  const api = {
    render: renderPreview,
    clearUpload() { state.logoDataUrl = null; },
    onLogoUpload(e) {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = (ev) => { state.logoDataUrl = ev.target.result; const u = document.getElementById('invt-logoUrl'); if (u) u.value = ''; renderPreview(); };
      r.readAsDataURL(f);
    },
    setBillTo(tab) {
      state.billTo = tab;
      const tm = document.getElementById('invt-tab-manual'), tc = document.getElementById('invt-tab-crm');
      if (tm) tm.classList.toggle('active', tab === 'manual');
      if (tc) tc.classList.toggle('active', tab === 'crm');
      const body = document.getElementById('invt-billto-body');
      if (body) body.innerHTML = billToBodyHTML();
      renderPreview();
    },
    async selectClient(id) {
      state.selectedContactId = id || null;
      if (!id) { renderPreview(); return; }
      const c = (window.contacts || []).find((x) => x.id === id);
      // Auto-seed line items from this client's assigned VAs (Active VAs link).
      try {
        const vas = await window.sb.get('va_applicants',
          `?select=id,name,roles,active_rate,hourly_rate&assigned_to_contact_id=eq.${id}`);
        if (Array.isArray(vas) && vas.length) {
          vas.forEach((v) => {
            const rate = (c && c.va_rate != null && c.va_rate !== '') ? c.va_rate
              : (v.active_rate != null && v.active_rate !== '') ? v.active_rate
                : (v.hourly_rate != null ? v.hourly_rate : '');
            state.lineItems.push({ id: uid(), desc: 'VA Services', va: v.name || '', hours: '', rate: rate });
          });
          renderLines();
          toast(`Added ${vas.length} VA line item${vas.length === 1 ? '' : 's'} for ${contactName(c)}`);
        }
      } catch (err) { /* no VAs / not reachable — silent, manual lines still work */ }
      renderPreview();
    },
    applyTerms() {
      const sel = val('invt-terms');
      const base = new Date(val('invt-issueDate') || today);
      if (sel !== 'custom' && TERMS[sel] != null) {
        const d = new Date(base); d.setDate(d.getDate() + TERMS[sel]);
        const due = document.getElementById('invt-dueDate'); if (due) due.value = isoDate(d);
      }
      renderPreview();
    },
    addItem() { state.lineItems.push({ id: uid(), desc: '', va: '', hours: '', rate: '' }); renderLines(); },
    removeItem(id) { state.lineItems = state.lineItems.filter((li) => li.id !== id); renderLines(); },
    updateItem(id, field, value) { const li = state.lineItems.find((x) => x.id === id); if (li) { li[field] = value; renderPreview(); } },
    print() {
      const docHTML = invoiceDocHTML();
      const w = window.open('', '_blank', 'width=900,height=1100');
      if (!w) { toast('Pop-up blocked — allow pop-ups to print', 'error'); return; }
      w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${esc(val('invt-number') || 'Invoice')}</title>
        <style>${CSS}
        @page{margin:0}
        body{margin:0;background:#fff;font-family:'Segoe UI',system-ui,sans-serif;}
        .inv-doc{box-shadow:none;border-radius:0;max-width:100%;padding:40px 48px;}
        *{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
        </style></head><body>${docHTML}</body></html>`);
      w.document.close();
      w.focus();
      setTimeout(() => { w.print(); }, 250);
    },
  };

  // ── mount point (called by inline renderToolsPage when Invoice tab is active) ─
  window.renderInvoiceTool = function (container) {
    if (!container) return;
    injectCSS();
    rootEl = container;
    if (!state.lineItems.length) {
      state.lineItems = [
        { id: uid(), desc: 'Website Design', va: '', hours: 10, rate: 75 },
        { id: uid(), desc: 'SEO Strategy', va: '', hours: 5, rate: 75 },
      ];
    }
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px">
        <div style="font-size:12px;color:var(--text3)">Build an invoice, then Print / Save as PDF. Pick a CRM client to pull their details and assigned VAs.</div>
        <button class="btn btn-primary btn-sm" onclick="invoiceTool.print()">Print / Save PDF</button>
      </div>
      <div class="invoice-tool">
        <div>
          ${controlsHTML()}
          <div id="invt-lineeditor" style="margin-top:18px">${lineEditorHTML()}</div>
        </div>
        <div id="invt-preview">${invoiceDocHTML()}</div>
      </div>`;
  };
  window.invoiceTool = api;
  window.__nlmInvoiceToolLoaded = true;
})();
