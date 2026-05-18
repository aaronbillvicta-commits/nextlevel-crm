// Shared auth + CORS helpers for serverless API routes.
//
// Background: see the security audit on 2026-05-18. Before this module
// existed, /api/sms, /api/call-token, /api/ai, and /api/storage-stats
// were all open to the internet with `Access-Control-Allow-Origin: *`
// and no auth, which meant a single curl loop could burn arbitrary
// SignalWire / Gemini credits on Aaron's account.
//
// `requireAuth(req, res)` verifies the caller's Supabase user JWT by
// hitting Supabase's /auth/v1/user endpoint. It rejects:
//   - missing or malformed Authorization header
//   - tokens that aren't user-session JWTs (role !== 'authenticated' —
//     blocks the public anon key, which would otherwise pass)
//   - expired / revoked sessions (Supabase returns non-200)
// On success it returns the user object; on failure it has already
// sent a 401 response, so callers should `if (!user) return;`.
//
// `applyCors(req, res)` writes the right CORS headers based on the
// Origin header. The allowlist covers the production Vercel URL,
// preview deploys (*.vercel.app), and localhost for dev. Anything
// else gets no Access-Control-Allow-Origin header at all, which
// blocks browsers cross-origin (curl can still hit the endpoint —
// CORS is a browser construct, not server auth, which is why
// requireAuth is the real defense).

const SUPABASE_URL = 'https://oipkvwdjlwienkphsivr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pcGt2d2RqbHdpZW5rcGhzaXZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxMzk2NTUsImV4cCI6MjA5MTcxNTY1NX0.VAj_i2iCnvd3qz9Emhh-O_eBywrmxYH9U2vJPVFclT0';

const ALLOWED_HOSTS = [
  'mynextlevel-crm.vercel.app',
  ...(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    if (ALLOWED_HOSTS.includes(u.hostname)) return true;
    // Vercel preview deploys: nextlevel-crm-<hash>-<scope>.vercel.app
    if (u.hostname.endsWith('.vercel.app')) return true;
    return false;
  } catch (_) {
    return false;
  }
}

function applyCors(req, res, methods = 'GET, POST, OPTIONS') {
  const origin = req.headers.origin || '';
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

async function requireAuth(req, res) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    res.status(401).json({ error: 'Missing Authorization bearer token' });
    return null;
  }
  const token = m[1].trim();

  // Pre-flight: reject the anon key (or any non-user JWT) before we
  // even round-trip to Supabase. /auth/v1/user accepts the anon key
  // (returning the unauthenticated anon user), so we must check the
  // role claim ourselves.
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      res.status(401).json({ error: 'Malformed token' });
      return null;
    }
    // base64url -> base64 padding
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    if (payload.role !== 'authenticated') {
      res.status(401).json({ error: 'Token is not a user session' });
      return null;
    }
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      res.status(401).json({ error: 'Session expired' });
      return null;
    }
  } catch (_) {
    res.status(401).json({ error: 'Malformed token' });
    return null;
  }

  // Confirm with Supabase that the token is still valid (not revoked
  // by a sign-out or password change since it was issued).
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!r.ok) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return null;
    }
    return await r.json();
  } catch (_) {
    res.status(503).json({ error: 'Auth check failed' });
    return null;
  }
}

module.exports = { applyCors, requireAuth, isAllowedOrigin };
