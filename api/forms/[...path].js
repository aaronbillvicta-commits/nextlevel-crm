// Consolidated forms handler: GET /options, POST /va, POST /client, POST /embed
// Replaces 4 separate files to stay within Vercel Hobby's 12-function limit.
const { applyCors, requireAuth } = require('../_auth');

const SUPABASE_URL = 'https://oipkvwdjlwienkphsivr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pcGt2d2RqbHdpZW5rcGhzaXZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxMzk2NTUsImV4cCI6MjA5MTcxNTY1NX0.VAj_i2iCnvd3qz9Emhh-O_eBywrmxYH9U2vJPVFclT0';

// ── Rate limiter (shared across VA + client submissions) ──────────────────────
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const ipHits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    ipHits.set(ip, { windowStart: now, count: 1 });
    if (ipHits.size > 2000) {
      for (const [k, v] of ipHits) {
        if (now - v.windowStart > RATE_WINDOW_MS) ipHits.delete(k);
      }
    }
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

// ── VA Applicants field lists ─────────────────────────────────────────────────
const VA_TEXT = [
  'first_name', 'last_name', 'email', 'phone', 'facebook_url', 'linkedin_url',
  'portfolio_url', 'other_profile_url', 'country_city', 'timezone',
  'english_self_level', 'english_efset_score', 'english_efset_link',
  'experience_type', 'prior_company', 'prior_market', 'prior_industry', 'prior_years',
  'weekend_availability', 'applying_for',
  'years_experience', 'clients_worked_with', 'work_history_summary', 'best_result',
  'niche_specialization', 'cv_link', 'video_intro_link', 'references_available',
  'reference_links', 'other_tools', 'calls_per_day', 'appts_per_week',
  'highest_ticket_closed', 'close_rate', 'best_sales_result', 'voice_sample_link', 'live_sample_call_link',
  'current_employment_status', 'current_engagement_type', 'current_schedule',
  'current_client_aware', 'notice_period', 'commission_open', 'rate_negotiable',
  'preferred_hours', 'internet_speed', 'backup_internet', 'time_tracking_comfort',
  'id_verification_willing', 'management_style', 'response_time', 'enjoys_most',
  'wish_clients_knew', 'anything_else', 'direction_test_answer', 'disc_assessment',
];
const VA_JSONB = [
  'industries', 'roles', 'tools_selected', 'sales_roles', 'hire_arrangement',
  'timezone_overlap', 'time_tracking_tools', 'id_types_available',
  'working_style', 'preferred_client_type',
];
const VA_NUMERIC = ['hourly_rate', 'monthly_rate'];
const VA_INT    = ['current_hours_committed', 'hours_available_new', 'hours_per_week'];
const VA_BOOL   = ['is_sales_role'];
const VA_DATE   = ['start_date'];

// ── Client Intake field lists ─────────────────────────────────────────────────
const CI_TEXT = [
  'first_name', 'last_name', 'email', 'phone', 'company', 'industry',
  'english_level_required', 'role_description', 'additional_notes', 'how_did_you_hear',
];
const CI_JSONB   = ['required_skills', 'required_tools', 'timezone_preferences'];
const CI_NUMERIC = ['budget_min', 'budget_max'];
const CI_INT     = ['hours_per_week'];
const CI_DATE    = ['start_date_preference'];

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildPayload(body, textFields, jsonbFields, numericFields, intFields, boolFields, dateFields) {
  const p = {};
  for (const f of (textFields || [])) {
    if (body[f] != null) { const v = String(body[f]).slice(0, 4000).trim(); if (v) p[f] = v; }
  }
  for (const f of (jsonbFields || [])) {
    if (Array.isArray(body[f])) p[f] = body[f].slice(0, 100).map(v => String(v).slice(0, 200));
  }
  for (const f of (numericFields || [])) {
    const v = parseFloat(body[f]); if (!isNaN(v) && v >= 0) p[f] = v;
  }
  for (const f of (intFields || [])) {
    const v = parseInt(body[f], 10); if (!isNaN(v) && v >= 0) p[f] = v;
  }
  for (const f of (boolFields || [])) {
    if (typeof body[f] === 'boolean') p[f] = body[f];
  }
  for (const f of (dateFields || [])) {
    if (body[f] && /^\d{4}-\d{2}-\d{2}$/.test(body[f])) p[f] = body[f];
  }
  return p;
}

async function supabasePost(table, payload) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_KEY not set');
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(await r.text());
}

async function supabaseGetOne(table, id) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_KEY not set');
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=*`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw new Error(await r.text());
  const rows = await r.json();
  return rows[0] || null;
}

async function supabaseSelect(query) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_KEY not set');
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function supabasePatch(table, id, payload) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_KEY not set');
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(await r.text());
}

// ── Embedding: build a semantic text blob from a record, then call OpenAI ─────
function joinArr(v) { return Array.isArray(v) ? v.filter(Boolean).join(', ') : (v || ''); }

function vaEmbedText(v) {
  const lines = [
    ['Roles', joinArr(v.roles)],
    ['Industries', joinArr(v.industries)],
    ['Tools', [joinArr(v.tools_selected), v.other_tools].filter(Boolean).join(', ')],
    ['Specialization', v.niche_specialization],
    ['Years of experience', v.years_experience],
    ['Sales roles', joinArr(v.sales_roles)],
    ['Work history', v.work_history_summary],
    ['Best result', v.best_result],
    ['Clients worked with', v.clients_worked_with],
    ['Enjoys most', v.enjoys_most],
    ['Working style', joinArr(v.working_style)],
    ['Preferred client type', joinArr(v.preferred_client_type)],
    ['Management style', v.management_style],
    ['English level', v.english_self_level],
  ];
  return lines.filter(([, val]) => val && String(val).trim()).map(([k, val]) => `${k}: ${val}`).join('\n');
}

function ciEmbedText(c) {
  const lines = [
    ['Industry', c.industry],
    ['Role needed', c.role_description],
    ['Required skills', joinArr(c.required_skills)],
    ['Required tools', joinArr(c.required_tools)],
    ['English required', c.english_level_required],
    ['Additional notes', c.additional_notes],
  ];
  return lines.filter(([, val]) => val && String(val).trim()).map(([k, val]) => `${k}: ${val}`).join('\n');
}

async function openaiEmbed(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) { const e = new Error('OPENAI_API_KEY not set in Vercel environment variables'); e.code = 'NO_KEY'; throw e; }
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
  });
  if (!r.ok) { const e = new Error('OpenAI embeddings error: ' + (await r.text())); e.code = 'OPENAI'; throw e; }
  const data = await r.json();
  const vec = data.data && data.data[0] && data.data[0].embedding;
  if (!Array.isArray(vec) || vec.length !== 1536) throw new Error('Unexpected embedding shape');
  return vec;
}

// ── pgvector match RPC + rule-based hybrid scoring ────────────────────────────
async function supabaseRpc(fn, args) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_KEY not set');
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// Ordered English proficiency scale (higher = stronger).
const ENGLISH_RANK = {
  beginner_a1: 1, elementary_a2: 2, intermediate_b1: 3,
  upper_intermediate_b2: 4, advanced_c1: 5, proficient_c2: 6, native: 7,
};

function lowerSet(arr) {
  return new Set((Array.isArray(arr) ? arr : []).map(x => String(x).toLowerCase().trim()).filter(Boolean));
}
function overlap(clientArr, vaArr) {
  const want = lowerSet(clientArr);
  const have = lowerSet(vaArr);
  const matched = [...want].filter(x => have.has(x));
  return { matched, frac: want.size ? matched.length / want.size : null };
}
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

// Compare one VA row (from the RPC) against the client intake. Returns a 0..1
// rule score (or null if no structured signals are comparable) plus a
// human-readable breakdown for the UI and future GPT explanations.
function ruleScore(va, client) {
  const sigs = []; // { w, v }
  const detail = {};

  const roleO = overlap(client.required_skills, va.roles);
  if (roleO.frac != null && (va.roles || []).length) {
    sigs.push({ w: 0.35, v: roleO.frac });
    detail.roles = { matched: roleO.matched, required: client.required_skills || [] };
  }
  const toolO = overlap(client.required_tools, va.tools_selected);
  if (toolO.frac != null && (va.tools_selected || []).length) {
    sigs.push({ w: 0.25, v: toolO.frac });
    detail.tools = { matched: toolO.matched, required: client.required_tools || [] };
  }
  if (client.industry && (va.industries || []).length) {
    const ok = lowerSet(va.industries).has(String(client.industry).toLowerCase().trim());
    sigs.push({ w: 0.15, v: ok ? 1 : 0 });
    detail.industry = { required: client.industry, ok };
  }
  if (client.english_level_required && va.english_self_level) {
    const need = ENGLISH_RANK[client.english_level_required] || 0;
    const have = ENGLISH_RANK[va.english_self_level] || 0;
    const ok = have >= need;
    sigs.push({ w: 0.15, v: ok ? 1 : 0 });
    detail.english = { required: client.english_level_required, has: va.english_self_level, ok };
  }
  const cap = va.hours_available_new || va.hours_per_week || null;
  if (client.hours_per_week && cap) {
    const v = cap >= client.hours_per_week ? 1 : Math.max(0, cap / client.hours_per_week);
    sigs.push({ w: 0.10, v });
    detail.hours = { required: client.hours_per_week, available: cap, ok: cap >= client.hours_per_week };
  }
  if (client.budget_max != null && va.hourly_rate != null) {
    const ok = Number(va.hourly_rate) <= Number(client.budget_max);
    sigs.push({ w: 0.10, v: ok ? 1 : 0 });
    detail.budget = { max: client.budget_max, rate: va.hourly_rate, ok };
  }

  const totW = sigs.reduce((s, x) => s + x.w, 0);
  const score = totW ? sigs.reduce((s, x) => s + x.w * x.v, 0) / totW : null;
  return { score, detail };
}

// ── Route handlers ────────────────────────────────────────────────────────────
async function handleOptions(req, res) {
  const { form_type } = req.query;
  let url = `${SUPABASE_URL}/rest/v1/form_field_options`
    + `?active=eq.true&order=category.asc,sort_order.asc`
    + `&select=category,label,value,form_type`;
  if (form_type === 'va' || form_type === 'client') {
    url += `&or=(form_type.eq.both,form_type.eq.${form_type})`;
  }
  const r = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!r.ok) throw new Error('Supabase error: ' + r.status);
  const rows = await r.json();
  const grouped = {};
  for (const row of rows) {
    if (!grouped[row.category]) grouped[row.category] = [];
    grouped[row.category].push({ label: row.label, value: row.value });
  }
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(grouped);
}

async function handleVaApply(req, res, ip) {
  if (rateLimited(ip)) return res.status(429).json({ error: 'Too many submissions. Please try again later.' });
  const raw = JSON.stringify(req.body || {});
  if (raw.length > 32 * 1024) return res.status(413).json({ error: 'Request too large' });
  const body = req.body || {};
  for (const f of ['first_name', 'last_name', 'email', 'phone']) {
    if (!body[f] || typeof body[f] !== 'string' || !body[f].trim())
      return res.status(400).json({ error: `Missing required field: ${f}` });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))
    return res.status(400).json({ error: 'Invalid email address' });
  const payload = buildPayload(body, VA_TEXT, VA_JSONB, VA_NUMERIC, VA_INT, VA_BOOL, VA_DATE);
  await supabasePost('va_applicants', payload);
  res.status(200).json({ success: true });
}

async function handleClientIntake(req, res, ip) {
  if (rateLimited(ip)) return res.status(429).json({ error: 'Too many submissions. Please try again later.' });
  const raw = JSON.stringify(req.body || {});
  if (raw.length > 16 * 1024) return res.status(413).json({ error: 'Request too large' });
  const body = req.body || {};
  for (const f of ['first_name', 'last_name', 'email']) {
    if (!body[f] || typeof body[f] !== 'string' || !body[f].trim())
      return res.status(400).json({ error: `Missing required field: ${f}` });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))
    return res.status(400).json({ error: 'Invalid email address' });
  const payload = buildPayload(body, CI_TEXT, CI_JSONB, CI_NUMERIC, CI_INT, null, CI_DATE);
  await supabasePost('client_intakes', payload);
  res.status(200).json({ success: true });
}

// Auth-gated: generate an OpenAI embedding for a VA or client record and mark
// it activated for the matching pool. Triggered by the "Activate for Matching"
// button in the CRM.
async function handleEmbed(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return; // requireAuth already sent 401

  const body = req.body || {};
  const type = body.type;
  const id = body.id;
  if ((type !== 'va' && type !== 'client') || !id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Body must be { type: "va"|"client", id: "<uuid>" }' });
  }

  const table = type === 'va' ? 'va_applicants' : 'client_intakes';
  const rec = await supabaseGetOne(table, id);
  if (!rec) return res.status(404).json({ error: 'Record not found' });

  const text = type === 'va' ? vaEmbedText(rec) : ciEmbedText(rec);
  if (!text.trim()) return res.status(422).json({ error: 'Record has no matchable content to embed' });

  let vec;
  try {
    vec = await openaiEmbed(text);
  } catch (e) {
    if (e.code === 'NO_KEY') return res.status(503).json({ error: e.message });
    console.error('[forms/embed] openai', e);
    return res.status(502).json({ error: 'Embedding generation failed' });
  }

  const patch = { embedding: '[' + vec.join(',') + ']', activated_at: new Date().toISOString() };
  if (type === 'va') patch.review_status = 'shortlisted';
  await supabasePatch(table, id, patch);

  return res.status(200).json({ success: true, activated_at: patch.activated_at });
}

// Auth-gated: hybrid match — pgvector semantic similarity + rule-based scoring
// of activated VA applicants against one activated client intake. Triggered by
// the "Find Matches" button on a client intake in the CRM.
async function handleMatch(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return; // requireAuth already sent 401

  const body = req.body || {};
  const clientId = body.client_id;
  if (!clientId || typeof clientId !== 'string') {
    return res.status(400).json({ error: 'Body must be { client_id: "<uuid>" }' });
  }

  const client = await supabaseGetOne('client_intakes', clientId);
  if (!client) return res.status(404).json({ error: 'Client intake not found' });
  if (!client.activated_at) {
    return res.status(422).json({ error: 'This client intake is not activated yet. Click "Activate for Matching" first.' });
  }

  const limit = Math.min(Math.max(parseInt(body.limit, 10) || 20, 1), 50);
  let rows;
  try {
    rows = await supabaseRpc('match_vas_for_client', { p_client_id: clientId, match_count: limit });
  } catch (e) {
    console.error('[forms/match] rpc', e);
    return res.status(502).json({ error: 'Match query failed' });
  }
  if (!Array.isArray(rows)) rows = [];

  const SEMANTIC_W = 0.5, RULE_W = 0.5;
  const results = rows.map(va => {
    const semantic = typeof va.similarity === 'number' ? Math.max(0, Math.min(1, va.similarity)) : 0;
    const { score: rs, detail } = ruleScore(va, client);
    const rule = rs == null ? semantic : rs; // fall back to semantic when no structured data is comparable
    const match = SEMANTIC_W * semantic + RULE_W * rule;
    return {
      id: va.id,
      name: [va.first_name, va.last_name].filter(Boolean).join(' ').trim() || va.email,
      email: va.email,
      country_city: va.country_city,
      english_self_level: va.english_self_level,
      years_experience: va.years_experience,
      roles: va.roles || [],
      industries: va.industries || [],
      tools_selected: va.tools_selected || [],
      niche_specialization: va.niche_specialization,
      hourly_rate: va.hourly_rate,
      monthly_rate: va.monthly_rate,
      review_status: va.review_status,
      semantic_score: round3(semantic),
      rule_score: round3(rule),
      match_score: round3(match),
      detail,
    };
  }).sort((a, b) => b.match_score - a.match_score);

  return res.status(200).json({ client_id: clientId, count: results.length, results });
}

// ── Custom form builder: public render + submit ───────────────────────────────
// GET /api/forms/render?slug=<slug> — returns a PUBLISHED form definition (public).
async function handleFormRender(req, res) {
  const slug = (req.query.slug || '').toString().trim().toLowerCase();
  if (!slug) return res.status(400).json({ error: 'Missing slug' });
  const rows = await supabaseSelect(
    `forms?slug=eq.${encodeURIComponent(slug)}&status=eq.published`
    + `&select=id,name,description,fields,submit_message&limit=1`
  );
  const form = rows[0];
  if (!form) return res.status(404).json({ error: 'Form not found' });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(form);
}

// POST /api/forms/respond { slug, data } — stores a submission (public, rate-limited).
async function handleFormRespond(req, res, ip) {
  if (rateLimited(ip)) return res.status(429).json({ error: 'Too many submissions. Please try again later.' });
  const body = req.body || {};
  const slug = (body.slug || '').toString().trim().toLowerCase();
  const data = (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) ? body.data : null;
  if (!slug || !data) return res.status(400).json({ error: 'Body must be { slug, data }' });
  if (JSON.stringify(data).length > 64 * 1024) return res.status(413).json({ error: 'Response too large' });

  const rows = await supabaseSelect(
    `forms?slug=eq.${encodeURIComponent(slug)}&status=eq.published&select=id,fields&limit=1`
  );
  const form = rows[0];
  if (!form) return res.status(404).json({ error: 'Form not found' });

  const fields = Array.isArray(form.fields) ? form.fields : [];
  const clean = {};
  for (const f of fields) {
    if (!f || !f.key) continue;
    let v = data[f.key];
    if (Array.isArray(v)) v = v.slice(0, 100).map(x => String(x).slice(0, 500));
    else if (v != null) v = String(v).slice(0, 5000);
    else v = (f.type === 'checkbox') ? [] : '';
    const empty = Array.isArray(v) ? v.length === 0 : String(v).trim() === '';
    if (f.required && empty) return res.status(400).json({ error: `Missing required field: ${f.label || f.key}` });
    if (!empty) clean[f.key] = v;
  }

  await supabasePost('form_responses', { form_id: form.id, data: clean });
  return res.status(200).json({ success: true });
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  applyCors(req, res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Derive the action from the URL path. Don't rely on req.query.path —
  // Vercel's catch-all ([...path]) query population is unreliable for bare
  // (non-framework) serverless functions, so req.url is the source of truth.
  const urlPath = (req.url || '').split('?')[0].replace(/\/+$/, '');
  const urlMatch = urlPath.match(/\/api\/forms\/([^/]+)/);
  const qp = Array.isArray(req.query.path) ? req.query.path[0] : req.query.path;
  const action = (urlMatch ? urlMatch[1] : qp) || '';
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

  try {
    if (action === 'options' && req.method === 'GET') return await handleOptions(req, res);
    if (action === 'va'      && req.method === 'POST') return await handleVaApply(req, res, ip);
    if (action === 'client'  && req.method === 'POST') return await handleClientIntake(req, res, ip);
    if (action === 'embed'   && req.method === 'POST') return await handleEmbed(req, res);
    if (action === 'match'   && req.method === 'POST') return await handleMatch(req, res);
    if (action === 'render'  && req.method === 'GET')  return await handleFormRender(req, res);
    if (action === 'respond' && req.method === 'POST') return await handleFormRespond(req, res, ip);
    return res.status(404).json({ error: 'Not found' });
  } catch (err) {
    console.error('[forms]', action, err);
    return res.status(500).json({ error: 'Server error' });
  }
};
