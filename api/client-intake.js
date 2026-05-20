const { applyCors } = require('./_auth');

const SUPABASE_URL = 'https://oipkvwdjlwienkphsivr.supabase.co';
const MAX_BODY_BYTES = 16 * 1024;
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
  'first_name', 'last_name', 'email', 'phone', 'company', 'industry',
  'english_level_required', 'role_description', 'additional_notes', 'how_did_you_hear',
];

const JSONB_ARRAY_FIELDS = ['required_skills', 'required_tools', 'timezone_preferences'];
const NUMERIC_FIELDS = ['budget_min', 'budget_max'];
const INT_FIELDS = ['hours_per_week'];
const DATE_FIELDS = ['start_date_preference'];

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

  for (const field of ['first_name', 'last_name', 'email']) {
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

  for (const f of DATE_FIELDS) {
    if (body[f] && /^\d{4}-\d{2}-\d{2}$/.test(body[f])) payload[f] = body[f];
  }

  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) return res.status(500).json({ error: 'Server configuration error' });

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/client_intakes`, {
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
      console.error('client-intake Supabase error:', await r.text());
      return res.status(500).json({ error: 'Failed to save intake form' });
    }

    res.status(200).json({ success: true });
  } catch (e) {
    console.error('client-intake error:', e);
    res.status(500).json({ error: 'Server error' });
  }
};
