// Consolidated admin / internal API. Routes:
//   POST /api/admin/create-user   — invite a team member (admin only)
//   POST /api/admin/delete-user   — remove a team member + revoke login (admin only)
//   POST /api/admin/ai            — Gemini helper (any signed-in user)
//
// Merged from the former api/create-user.js, api/delete-user.js and api/ai.js
// to stay within Vercel Hobby's 12-Serverless-Function cap (see BUGLOG BUG-021).
// Same pattern as api/forms/[...path].js: one function, many routes, action
// parsed off req.url (NOT req.query.path — that's unreliable for bare Vercel
// functions; see BUG-022).
const { applyCors, requireAuth } = require('../_auth');

const SUPABASE_URL = 'https://oipkvwdjlwienkphsivr.supabase.co';
const ROLES = ['admin', 'member', 'viewer'];
const PERM_KEYS = ['calling', 'edit', 'delete', 'settings'];

function svcHeaders() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) return null;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

// Verify the caller is a signed-in ADMIN. On success returns the caller's auth
// user object; on failure it has already sent the response and returns null.
async function requireAdmin(req, res, headers, key) {
  const callerToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!callerToken) { res.status(401).json({ error: 'Not authenticated' }); return null; }

  const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${callerToken}` },
  });
  const me = await meRes.json();
  if (!meRes.ok || !me.email) { res.status(401).json({ error: 'Invalid session' }); return null; }

  const callerRows = await fetch(
    `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(me.email)}&select=role`,
    { headers }
  ).then(r => r.json());
  if (!callerRows[0] || callerRows[0].role !== 'admin') {
    res.status(403).json({ error: 'Only admins can manage team members' });
    return null;
  }
  return me;
}

// ── POST /api/admin/create-user ───────────────────────────────────────────────
async function handleCreateUser(req, res) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  const headers = svcHeaders();
  if (!headers) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not set' });
  const me = await requireAdmin(req, res, headers, key);
  if (!me) return;

  const body = req.body || {};
  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const role = ROLES.includes(body.role) ? body.role : 'member';
  const permissions = {};
  if (body.permissions && typeof body.permissions === 'object') {
    for (const k of PERM_KEYS) {
      if (typeof body.permissions[k] === 'boolean') permissions[k] = body.permissions[k];
    }
  }

  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email is required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  // Create the auth account, pre-confirmed so they can log in immediately.
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name } }),
  });
  const authUser = await authRes.json();
  if (!authRes.ok || !authUser.id) {
    const msg = authUser.msg || authUser.error_description || authUser.error || 'Could not create login';
    return res.status(authRes.status === 422 ? 409 : 400).json({ error: msg });
  }

  // Create the profile row (id matches the auth user id).
  const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({ id: authUser.id, name, email, role, permissions }),
  });
  const profile = await profileRes.json();
  if (!profileRes.ok || !profile[0]) {
    // Roll back the auth account so we don't leave an orphan.
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${authUser.id}`, { method: 'DELETE', headers });
    const msg = (profile && profile.message) || 'Could not create user profile';
    return res.status(400).json({ error: msg });
  }

  return res.status(200).json({ user: profile[0] });
}

// ── POST /api/admin/delete-user ───────────────────────────────────────────────
async function handleDeleteUser(req, res) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  const headers = svcHeaders();
  if (!headers) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not set' });
  const me = await requireAdmin(req, res, headers, key);
  if (!me) return;

  const body = req.body || {};
  const id = (body.id || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  if (!id || !email) return res.status(400).json({ error: 'id and email are required' });
  if (email === me.email) return res.status(400).json({ error: "You can't remove your own account" });

  // Delete the auth account. New users have public.users.id === auth.users.id,
  // so try that first; older accounts differ, so fall back to a lookup by email.
  let authDeleted = false;
  const directRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers });
  if (directRes.ok) {
    authDeleted = true;
  } else {
    const list = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=500`, { headers }).then(r => r.json());
    const match = (list.users || []).find(u => (u.email || '').toLowerCase() === email);
    if (match) {
      const byEmail = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${match.id}`, { method: 'DELETE', headers });
      authDeleted = byEmail.ok;
    }
  }

  // Delete the profile row.
  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(id)}`,
    { method: 'DELETE', headers }
  );
  if (!profileRes.ok) {
    const txt = await profileRes.text();
    return res.status(400).json({ error: 'Could not remove user profile: ' + txt });
  }

  return res.status(200).json({ ok: true, authDeleted });
}

// ── POST /api/admin/ai ────────────────────────────────────────────────────────
async function handleAi(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;

  const { feature, context } = req.body || {};
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set in Vercel environment variables' });

  const prompts = {
    draft_reply: `You are an assistant for a digital marketing agency CRM. Draft a short, professional reply.
Channel: ${context?.channel || 'sms'}
Contact name: ${context?.contactName || 'the contact'}
Recent conversation:
${(context?.messages || []).slice(-4).map(m => `[${m.dir === 'outbound' ? 'Us' : 'Them'}]: ${m.body}`).join('\n')}
Write ONLY the reply message body. If SMS: keep under 160 characters. If email: 2-3 sentences max. No greeting, no sign-off.`,

    summarize_contact: `Summarize this contact's profile for a marketing agency sales rep. 2-3 sentences max.
Contact: ${JSON.stringify(context || {})}`,

    campaign_copy: `Write marketing copy for this campaign. Return valid JSON only.
Campaign: ${JSON.stringify(context || {})}
Return exactly: {"subject": "<email subject or empty string>", "body": "<message body using {{name}} placeholder>"}`
  };

  const prompt = prompts[feature];
  if (!prompt) return res.status(400).json({ error: 'Unknown feature: ' + feature });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 300, temperature: 0.7 }
      })
    }
  );
  if (!response.ok) {
    const err = await response.json();
    return res.status(502).json({ error: err.error?.message || 'Gemini request failed' });
  }
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  return res.status(200).json({ result: text });
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  applyCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Action = the path segment after /api/admin/. req.url is the source of truth
  // (the [...path] query param is unreliable for bare Vercel functions — BUG-022).
  const urlPath = (req.url || '').split('?')[0].replace(/\/+$/, '');
  const urlMatch = urlPath.match(/\/api\/admin\/([^/]+)/);
  const qp = Array.isArray(req.query.path) ? req.query.path[0] : req.query.path;
  const action = (urlMatch ? urlMatch[1] : qp) || '';

  try {
    if (action === 'create-user') return await handleCreateUser(req, res);
    if (action === 'delete-user') return await handleDeleteUser(req, res);
    if (action === 'ai')          return await handleAi(req, res);
    return res.status(404).json({ error: 'Not found' });
  } catch (e) {
    console.error('[admin]', action, e);
    return res.status(500).json({ error: e.message || 'Unexpected error' });
  }
};
