// NLM CRM — Settings → readouts (storage stats / version history / audio devices)
//
// MIGRATION NOTE (step 12c of the modular extraction):
// THIRD and FINAL file in src/settings/. Strangler-fig: this module
// duplicates the three "readout" Settings cards from index.html — the
// Data Usage panel (Supabase row counts + growth + cleanup recommendation),
// the Version History list (reads window.APP_VERSIONS that
// src/version-history.js sets), and the Audio Devices picker. Nothing
// imports from it yet; inline copies remain authoritative for every
// callsite (the `onclick="loadStorageStats()"` Refresh button, the
// initial Version History render path from the navigate('settings')
// dispatch, the `onchange="applyAudioDevice('input')"` selects).
//
// SCOPE (9 functions verbatim-copied from index.html):
//   Version history:
//     renderVersionHistory       — reads window.APP_VERSIONS and renders
//                                  the list with commit-hash GitHub links
//   Storage stats (Data Usage panel):
//     fmtBytes                   — module-local byte formatter (B/KB/MB/GB)
//     loadStorageStats           — GET /api/storage-stats with operator JWT
//                                  (Authorization: Bearer from BUG-016 deploy)
//     saveUsageSnapshot          — write daily snapshot to localStorage
//                                  (90-day rolling window)
//     renderStorageStats         — headline + stacked bar + per-table rows
//                                  + growth stats; calls renderUsageRecommendation
//     renderUsageRecommendation  — usage-tier color, time-to-limit projection,
//                                  cleanup suggestion for biggest table,
//                                  upgrade hint past 60%
//   Audio devices:
//     toggleAudioSettings        — navigate('settings') + delayed
//                                  enumerateAudioDevices (used by the
//                                  ⚙ Audio button in the call widget)
//     enumerateAudioDevices      — populate <select>s with getUserMedia +
//                                  enumerateDevices output; pre-selects the
//                                  saved preferred input/output
//     applyAudioDevice           — onchange handler; persists to localStorage,
//                                  updates preferredInput/OutputDevice,
//                                  applies setSinkId() for output when supported
//
// ROADMAP POSITION:
//   12a foundation             DONE  (cosmetic + self-service)
//   12b users                  DONE  (team + permissions)
//   12c usage                  <- this file (readouts)
//   13.   calling/             LAST (deliberately deferred)
//
// STATE-MIRROR ENTRIES ADDED in this step:
//   - preferredInputDevice    (let, reassignable — written by applyAudioDevice,
//                              read by enumerateAudioDevices for pre-selection)
//   - preferredOutputDevice   (let, reassignable — written by applyAudioDevice,
//                              read by enumerateAudioDevices AND by the inline
//                              attachCallAudio at ~3926 which calls setSinkId
//                              on the <audio id="remote-audio"> for outbound
//                              call audio routing)
//
// ADAPTATIONS from verbatim:
// - State vars via window.*: `APP_VERSIONS` (set by src/version-history.js),
//   `authToken` (bridged in 12b — used by the Authorization header on
//   /api/storage-stats), `preferredInputDevice`, `preferredOutputDevice`.
// - Inline function refs via window.*: `showToast`, `logError`, `navigate`.
// - Module-local refs called bare: `fmtBytes` (used by loadStorageStats /
//   renderStorageStats / renderUsageRecommendation); `enumerateAudioDevices`
//   from toggleAudioSettings; `renderUsageRecommendation` from renderStorageStats;
//   `renderStorageStats` + `saveUsageSnapshot` from loadStorageStats.
//
// References inside HTML attribute strings (`loadStorageStats`,
// `applyAudioDevice`, `enumerateAudioDevices`) are LEFT BARE because those
// strings are parsed at click/change-time and resolve via window from the
// inline hoisted-function declarations.
//
// VERIFICATION:
//   window.__nlmSettingsUsageLoaded === true  in DevTools after deploy.
//   Settings → Data Usage Refresh button still fetches + renders; Version
//   History list still shows entries with GitHub commit links; Audio Devices
//   selects still enumerate + save preferences — all paths use inline copies.
//   With this deploy, src/settings/ extraction is COMPLETE. Remaining
//   roadmap item is src/calling/ (step 13, deliberately deferred).

// ─── VERSION HISTORY ──────────────────────────────────────────────────────

export function renderVersionHistory(){
  const el = document.getElementById('version-history-list');
  if(!el) return;
  const badge = document.getElementById('version-current-badge');
  if(badge && window.APP_VERSIONS[0]){
    badge.textContent = window.APP_VERSIONS[0].date + ' (latest)';
  }
  el.innerHTML = window.APP_VERSIONS.map((v, i) => {
    const isLatest = i === 0;
    const isHighlight = v.highlight;
    const commitDisplay = v.commit === 'pending'
      ? '<span style="color:var(--text3)" title="Not yet committed">pending</span>'
      : `<a href="https://github.com/aaronbillvicta-commits/nextlevel-crm/commit/${v.commit}" target="_blank" style="color:var(--text3);text-decoration:none;font-family:'DM Mono',monospace" title="View on GitHub">${v.commit}</a>`;
    const accentBorder = isHighlight ? 'border-left:3px solid var(--green)' : (isLatest ? 'border-left:3px solid var(--accent)' : '');
    return `
      <div style="display:flex;gap:12px;padding:12px 12px 12px 14px;border-bottom:1px solid var(--border);${accentBorder};background:${isLatest?'var(--bg3)':'transparent'};border-radius:${isLatest?'var(--radius)':'0'};margin-bottom:${isLatest?'8px':'0'}">
        <div style="width:80px;flex-shrink:0">
          <div style="font-size:11px;color:var(--text2);font-family:'DM Mono',monospace;font-weight:500">${v.date}</div>
          <div style="font-size:10px;color:var(--text3);font-family:'DM Mono',monospace;margin-top:1px">${v.time}</div>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:3px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            ${isLatest ? '<span style="background:var(--green-bg);color:var(--green);padding:1px 6px;border-radius:10px;font-size:9px;font-weight:700;letter-spacing:.04em">CURRENT</span>' : ''}
            <span>${v.name}</span>
          </div>
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">${v.area}</div>
          <div style="font-size:12px;color:var(--text2);line-height:1.55">${v.description}</div>
        </div>
        <div style="font-size:10px;align-self:flex-start;flex-shrink:0;padding-top:2px">${commitDisplay}</div>
      </div>
    `;
  }).join('');
}

// ─── DATA USAGE / STORAGE STATS ───────────────────────────────────────────

function fmtBytes(b){
  if(b < 1024) return b + ' B';
  if(b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
  if(b < 1024*1024*1024) return (b/(1024*1024)).toFixed(1) + ' MB';
  return (b/(1024*1024*1024)).toFixed(2) + ' GB';
}

export async function loadStorageStats(){
  const loadingEl = document.getElementById('usage-loading');
  const contentEl = document.getElementById('usage-content');
  const errorEl   = document.getElementById('usage-error');
  if(!loadingEl) return; // Settings card not in DOM yet
  loadingEl.style.display = 'block';
  contentEl.style.display = 'none';
  errorEl.style.display   = 'none';
  try {
    const r = await fetch('/api/storage-stats', {
      headers: { Authorization: 'Bearer ' + window.authToken },
    });
    const data = await r.json();
    if(!r.ok || data.error) throw new Error(data.error || 'Request failed');
    renderStorageStats(data);
    saveUsageSnapshot(data);
    loadingEl.style.display = 'none';
    contentEl.style.display = 'block';
  } catch(e){
    loadingEl.style.display = 'none';
    errorEl.style.display   = 'block';
    errorEl.textContent = 'Could not load usage: ' + e.message;
  }
}

export function saveUsageSnapshot(data){
  const history = JSON.parse(localStorage.getItem('crm-usage-history') || '[]');
  const today = new Date().toISOString().slice(0,10);
  const filtered = history.filter(h => h.date !== today);
  filtered.push({
    date: today,
    total_bytes: data.total_bytes,
    counts: Object.fromEntries(data.tables.map(t => [t.name, t.count])),
  });
  localStorage.setItem('crm-usage-history', JSON.stringify(filtered.slice(-90)));
}

export function renderStorageStats(data){
  // Headline
  document.getElementById('usage-used-label').textContent = fmtBytes(data.total_bytes);
  document.getElementById('usage-limit-label').textContent = fmtBytes(data.limit_bytes);
  document.getElementById('usage-pct-label').textContent = data.usage_pct.toFixed(2) + '%';
  document.getElementById('usage-remaining-label').textContent = fmtBytes(data.remaining_bytes) + ' remaining';

  // Color the % based on threshold
  const pctEl = document.getElementById('usage-pct-label');
  if(data.usage_pct >= 90) pctEl.style.color = 'var(--red)';
  else if(data.usage_pct >= 70) pctEl.style.color = 'var(--amber)';
  else pctEl.style.color = 'var(--accent2)';

  // Stacked bar — each table contributes its slice
  const bar = document.getElementById('usage-bar');
  bar.innerHTML = data.tables
    .filter(t => t.bytes > 0)
    .map(t => {
      const width = (t.bytes / data.limit_bytes * 100);
      return `<div style="width:${width}%;background:${t.color}" title="${t.label}: ${fmtBytes(t.bytes)}"></div>`;
    }).join('');

  // Per-table breakdown rows
  const list = document.getElementById('usage-tables-list');
  list.innerHTML = data.tables
    .sort((a,b) => b.bytes - a.bytes)
    .map(t => {
      const tablePct = (t.bytes / data.total_bytes * 100) || 0;
      return `
        <div style="display:flex;align-items:center;gap:10px;font-size:12px">
          <div style="width:18px;text-align:center;font-size:14px">${t.icon}</div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;justify-content:space-between;margin-bottom:3px">
              <span style="color:var(--text);font-weight:500">${t.label}</span>
              <span style="color:var(--text3)">${t.count.toLocaleString()} rows · ${fmtBytes(t.bytes)}</span>
            </div>
            <div style="height:5px;background:var(--bg3);border-radius:3px;overflow:hidden">
              <div style="height:100%;background:${t.color};width:${tablePct}%;transition:width .3s"></div>
            </div>
          </div>
        </div>
      `;
    }).join('');

  // Growth stats
  const perDay = data.growth.bytes_per_day_7d;
  document.getElementById('usage-per-day').textContent =
    perDay > 0 ? `+${fmtBytes(perDay)}` : '—';
  document.getElementById('usage-per-week').textContent =
    data.growth.rows_last_7d > 0
      ? `+${data.growth.rows_last_7d.toLocaleString()} rows · ${fmtBytes(perDay * 7)}`
      : '—';
  document.getElementById('usage-per-month').textContent =
    data.growth.rows_last_30d > 0
      ? `+${data.growth.rows_last_30d.toLocaleString()} rows · ${fmtBytes(data.growth.bytes_per_day_30d * 30)}`
      : '—';

  // Recommendation
  renderUsageRecommendation(data);
}

function renderUsageRecommendation(data){
  const el = document.getElementById('usage-recommendation');
  const used = data.total_bytes;
  const limit = data.limit_bytes;
  const remaining = limit - used;
  const perDay7 = data.growth.bytes_per_day_7d;
  const perDay30 = data.growth.bytes_per_day_30d;
  // Use the more responsive rate but fall back to 30d if 7d is zero
  const growthRate = perDay7 > 0 ? perDay7 : perDay30;

  const lines = [];

  // Find largest table — candidate for cleanup
  const biggest = [...data.tables].sort((a,b) => b.bytes - a.bytes)[0];

  if(data.usage_pct >= 90){
    lines.push('🚨 <strong>Critical:</strong> You\'re using over 90% of your free tier. Upgrade to Supabase Pro (8 GB DB) or clean up data.');
  } else if(data.usage_pct >= 70){
    lines.push('⚠️ <strong>Warning:</strong> You\'re past 70% of the free tier. Plan for an upgrade soon.');
  } else if(data.usage_pct >= 40){
    lines.push('📊 You\'re at a healthy ~' + Math.round(data.usage_pct) + '% — plenty of room.');
  } else {
    lines.push('✅ Storage is comfortable — using ' + data.usage_pct.toFixed(1) + '% of the free tier.');
  }

  // Project time to limit
  if(growthRate > 0 && remaining > 0){
    const daysToLimit = remaining / growthRate;
    let when;
    if(daysToLimit < 14) when = Math.round(daysToLimit) + ' days';
    else if(daysToLimit < 60) when = Math.round(daysToLimit/7) + ' weeks';
    else if(daysToLimit < 730) when = Math.round(daysToLimit/30) + ' months';
    else when = Math.round(daysToLimit/365) + ' years';
    lines.push(`At your current pace (~${fmtBytes(growthRate)}/day, ${data.growth.rows_last_7d} rows last week), you'll reach the 500 MB limit in <strong>${when}</strong>.`);
  } else if(data.growth.rows_last_30d === 0){
    lines.push('No new data added in the last 30 days — usage is stable.');
  }

  // Cleanup suggestion for the biggest table
  if(biggest && biggest.bytes > 1024*1024){ // >1MB
    if(biggest.name === 'error_logs'){
      lines.push(`💡 <strong>Cleanup tip:</strong> Error logs are your biggest table (${fmtBytes(biggest.bytes)}). Old logs are usually safe to delete — they help with active debugging only.`);
    } else if(biggest.name === 'conversations'){
      lines.push(`💡 <strong>Cleanup tip:</strong> Conversations take up ${fmtBytes(biggest.bytes)}. Old/archived threads can be exported and removed if needed.`);
    } else {
      lines.push(`💡 Largest table: <strong>${biggest.label}</strong> (${fmtBytes(biggest.bytes)}).`);
    }
  }

  // Upgrade hint
  if(data.usage_pct >= 60){
    lines.push('🔧 <strong>Upgrade path:</strong> Supabase Pro is $25/mo for 8 GB DB + 100 GB storage — 16× the free tier.');
  }

  el.innerHTML = lines.join('<br>');
}

// ─── AUDIO DEVICE SELECTION ───────────────────────────────────────────────

export async function toggleAudioSettings(){
  window.navigate('settings');
  setTimeout(() => enumerateAudioDevices(), 80);
}

export async function enumerateAudioDevices(){
  try {
    if(!navigator.mediaDevices?.enumerateDevices || !navigator.mediaDevices?.getUserMedia){
      window.showToast('Audio device selection is not supported in this browser', 'error');
      return;
    }
    // Trigger permission prompt so labels are populated
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inSel = document.getElementById('audio-input-select');
    const outSel = document.getElementById('audio-output-select');
    if(!inSel || !outSel) return;
    inSel.innerHTML = '<option value="">Default</option>';
    outSel.innerHTML = '<option value="">Default</option>';
    devices.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      if(d.kind === 'audioinput'){
        opt.textContent = d.label || `Microphone ${i+1}`;
        if(d.deviceId === window.preferredInputDevice) opt.selected = true;
        inSel.appendChild(opt);
      } else if(d.kind === 'audiooutput'){
        opt.textContent = d.label || `Speaker ${i+1}`;
        if(d.deviceId === window.preferredOutputDevice) opt.selected = true;
        outSel.appendChild(opt);
      }
    });
  } catch(e){
    window.showToast('Mic permission denied — grant access in browser settings', 'error');
    window.logError('enumerateAudioDevices', e.message, e.stack, {});
  }
}

export async function applyAudioDevice(type){
  const sel = document.getElementById(type === 'input' ? 'audio-input-select' : 'audio-output-select');
  if(!sel) return;
  const deviceId = sel.value;
  if(type === 'input'){
    window.preferredInputDevice = deviceId;
    localStorage.setItem('crm-audio-input', deviceId);
    window.showToast('🎙 Microphone updated — takes effect on next call');
  } else {
    window.preferredOutputDevice = deviceId;
    localStorage.setItem('crm-audio-output', deviceId);
    const audio = document.getElementById('remote-audio');
    if(audio && deviceId && audio.setSinkId) audio.setSinkId(deviceId).catch(() => {});
    window.showToast('🔊 Speaker updated');
  }
}

window.__nlmSettingsUsageLoaded = true;
