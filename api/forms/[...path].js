// Consolidated forms handler: GET /options, POST /va, POST /client
// Replaces 3 separate files to stay within Vercel Hobby's 12-function limit.
const { applyCors } = require('../_auth');

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
  'years_experience', 'clients_worked_with', 'work_history_summary', 'best_result',
  'niche_specialization', 'cv_link', 'video_intro_link', 'references_available',
  'reference_links', 'other_tools', 'calls_per_day', 'appts_per_week',
  'highest_ticket_closed', 'close_rate', 'best_sales_result', 'voice_sample_link',
  'current_employment_status', 'current_engagement_type', 'current_schedule',
  'current_client_aware', 'notice_period', 'commission_open', 'rate_negotiable',
  'preferred_hours', 'internet_speed', 'backup_internet', 'time_tracking_comfort',
  'id_verification_willing', 'management_style', 'response_time', 'enjoys_most',
  'wish_clients_knew', 'anything_else', 'direction_test_answer',
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

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  applyCors(req, res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const pathParts = Array.isArray(req.query.path) ? req.query.path : [req.query.path].filter(Boolean);
  const action = pathParts[0] || '';
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

  try {
    if (action === 'options' && req.method === 'GET') return await handleOptions(req, res);
    if (action === 'va'      && req.method === 'POST') return await handleVaApply(req, res, ip);
    if (action === 'client'  && req.method === 'POST') return await handleClientIntake(req, res, ip);
    return res.status(404).json({ error: 'Not found' });
  } catch (err) {
    console.error('[forms]', action, err);
    return res.status(500).json({ error: 'Server error' });
  }
};
