// Creates a team member: a pre-confirmed Supabase auth account + a public.users
// profile row. Uses the service_role key so invited users can log in immediately
// (no email confirmation step, no email rate limits). Only admins may call this.
const SUPABASE_URL = 'https://oipkvwdjlwienkphsivr.supabase.co';
const ROLES = ['admin', 'member', 'viewer'];
const PERM_KEYS = ['calling', 'edit', 'delete', 'settings'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not set' });

  const svcHeaders = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  try {
    // ── Guard: caller must be a signed-in admin ─────────────────────────
    const callerToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!callerToken) return res.status(401).json({ error: 'Not authenticated' });

    const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${callerToken}` },
    });
    const me = await meRes.json();
    if (!meRes.ok || !me.email) return res.status(401).json({ error: 'Invalid session' });

    const callerRows = await fetch(
      `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(me.email)}&select=role`,
      { headers: svcHeaders }
    ).then(r => r.json());
    if (!callerRows[0] || callerRows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can add team members' });
    }

    // ── Validate input ──────────────────────────────────────────────────
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

    // ── Create the auth account, pre-confirmed ──────────────────────────
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: svcHeaders,
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { name },
      }),
    });
    const authUser = await authRes.json();
    if (!authRes.ok || !authUser.id) {
      const msg = authUser.msg || authUser.error_description || authUser.error || 'Could not create login';
      return res.status(authRes.status === 422 ? 409 : 400).json({ error: msg });
    }

    // ── Create the profile row (id matches the auth user id) ────────────
    const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
      method: 'POST',
      headers: { ...svcHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({ id: authUser.id, name, email, role, permissions }),
    });
    const profile = await profileRes.json();
    if (!profileRes.ok || !profile[0]) {
      // Roll back the auth account so we don't leave an orphan
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${authUser.id}`, {
        method: 'DELETE',
        headers: svcHeaders,
      });
      const msg = (profile && profile.message) || 'Could not create user profile';
      return res.status(400).json({ error: msg });
    }

    return res.status(200).json({ user: profile[0] });
  } catch (e) {
    console.error('create-user error:', e);
    return res.status(500).json({ error: e.message || 'Unexpected error' });
  }
};
