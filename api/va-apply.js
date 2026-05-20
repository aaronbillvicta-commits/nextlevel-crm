const { applyCors } = require('./_auth');

const SUPABASE_URL = 'https://oipkvwdjlwienkphsivr.supabase.co';
const MAX_BODY_BYTES = 32 * 1024;
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

const TEXT_FIELDS = [
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

const JSONB_ARRAY_FIELDS = [
  'industries', 'roles', 'tools_selected', 'sales_roles', 'hire_arrangement',
  'timezone_overlap', 'time_tracking_tools', 'id_types_available',
  'working_style', 'preferred_client_type',
];

const NUMERIC_FIELDS = ['hourly_rate', 'monthly_rate'];
const INT_FIELDS = ['current_hours_committed', 'hours_available_new', 'hours_per_week'];
const BOOL_FIELDS = ['is_sales_role'];
const DATE_FIELDS = ['start_date'];

module.exports = async function handler(req, res) {
  applyCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Too many submissions. Please try again later.' });
  }

  const raw = JSON.stringify(req.body || {});
  if (raw.length > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Request too large' });
  }

  const body = req.body || {};

  for (const field of ['first_name', 'last_name', 'email', 'phone']) {
    if (!body[field] || typeof body[field] !== 'string' || !body[field].trim()) {
      return res.status(400).json({ error: `Missing required field: ${field}` });
    }
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  const payload = {};

  for (const f of TEXT_FIELDS) {
    if (body[f] != null) {
      const v = String(body[f]).slice(0, 4000).trim();
      if (v) payload[f] = v;
    }
  }

  for (const f of JSONB_ARRAY_FIELDS) {
    if (Array.isArray(body[f])) {
      payload[f] = body[f].slice(0, 100).map(v => String(v).slice(0, 200));
    }
  }

  for (const f of NUMERIC_FIELDS) {
    const v = parseFloat(body[f]);
    if (!isNaN(v) && v >= 0) payload[f] = v;
  }

  for (const f of INT_FIELDS) {
    const v = parseInt(body[f], 10);
    if (!isNaN(v) && v >= 0) payload[f] = v;
  }

  for (const f of BOOL_FIELDS) {
    if (typeof body[f] === 'boolean') payload[f] = body[f];
  }

  for (const f of DATE_FIELDS) {
    if (body[f] && /^\d{4}-\d{2}-\d{2}$/.test(body[f])) payload[f] = body[f];
  }

  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) return res.status(500).json({ error: 'Server configuration error' });

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/va_applicants`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      console.error('va-apply Supabase error:', await r.text());
      return res.status(500).json({ error: 'Failed to save application' });
    }

    res.status(200).json({ success: true });
  } catch (e) {
    console.error('va-apply error:', e);
    res.status(500).json({ error: 'Server error' });
  }
};
