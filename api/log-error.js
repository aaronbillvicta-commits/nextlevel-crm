// Error logging sink — intentionally unauthenticated because errors
// can fire before the user logs in (e.g. failures inside the auth
// flow itself) and we want those captured too. Hardening instead:
//   - CORS allowlist (browsers can't drive abuse cross-origin)
//   - body size cap (rejects bulk-flood writes)
//   - field whitelist + length cap (rejects garbage payloads)
//   - best-effort per-IP rate limit (catches dumb spammers; not a
//     real defense since Vercel cold-starts wipe the map — only
//     deters single-instance hammering)
const { applyCors } = require('./_auth');

const SUPABASE_URL = 'https://oipkvwdjlwienkphsivr.supabase.co';

const MAX_BODY_BYTES = 16 * 1024;     // 16 KB per request
const MAX_FIELD_LEN  = 4000;          // 4 KB per string field
const RATE_LIMIT     = 30;            // per IP
const RATE_WINDOW_MS = 60 * 1000;     // per minute

// In-memory counter — wiped on cold start, which is fine for this purpose.
// A determined attacker can defeat it; the size cap is the real shield.
const ipHits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    ipHits.set(ip, { windowStart: now, count: 1 });
    // Opportunistic GC so the map doesn't grow forever
    if (ipHits.size > 5000) {
      for (const [k, v] of ipHits) {
        if (now - v.windowStart > RATE_WINDOW_MS) ipHits.delete(k);
      }
    }
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

function trimString(v) {
  if (typeof v !== 'string') return null;
  return v.length > MAX_FIELD_LEN ? v.slice(0, MAX_FIELD_LEN) : v;
}

module.exports = async function handler(req, res) {
  applyCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Always return 200 — never let error logging break the UI
  try {
    // Vercel sets x-forwarded-for; fall back to a placeholder.
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    if (rateLimited(ip)) return res.status(200).end();

    // Size cap. req.body is already parsed by Vercel, so we re-serialize
    // to measure. This is conservative — actual wire size could differ.
    const raw = JSON.stringify(req.body || {});
    if (raw.length > MAX_BODY_BYTES) return res.status(200).end();

    const { source, message, stack, context } = req.body || {};
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!key || !message) return res.status(200).end();

    // Whitelist + length-cap every field. context can be an object;
    // collapse it to JSON so we can length-cap that too.
    const payload = {
      source:  trimString(source),
      message: trimString(message),
      stack:   trimString(stack),
      context: trimString(typeof context === 'string' ? context : JSON.stringify(context || {})),
    };
    if (!payload.message) return res.status(200).end();

    await fetch(`${SUPABASE_URL}/rest/v1/error_logs`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('log-error handler failed:', e.message);
  }

  res.status(200).end();
};
