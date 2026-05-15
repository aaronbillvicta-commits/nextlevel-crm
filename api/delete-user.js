// Removes a team member: deletes the public.users profile row AND the Supabase
// auth account, so login access is actually revoked (the old client-side flow
// only deleted the profile row, leaving an orphaned auth account behind).
// Only admins may call this.
const SUPABASE_URL = 'https://oipkvwdjlwienkphsivr.supabase.co';

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
      return res.status(403).json({ error: 'Only admins can remove team members' });
    }

    // ── Validate input ──────────────────────────────────────────────────
    const body = req.body || {};
    const id = (body.id || '').trim();
    const email = (body.email || '').trim().toLowerCase();
    if (!id || !email) return res.status(400).json({ error: 'id and email are required' });
    if (email === me.email) {
      return res.status(400).json({ error: "You can't remove your own account" });
    }

    // ── Delete the auth account ─────────────────────────────────────────
    // New users have public.users.id === auth.users.id, so try that first.
    let authDeleted = false;
    const directRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
      method: 'DELETE',
      headers: svcHeaders,
    });
    if (directRes.ok) {
      authDeleted = true;
    } else {
      // Older accounts: profile id and auth id differ — look up by email.
      const list = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/users?per_page=500`,
        { headers: svcHeaders }
      ).then(r => r.json());
      const match = (list.users || []).find(
        u => (u.email || '').toLowerCase() === email
      );
      if (match) {
        const byEmail = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${match.id}`, {
          method: 'DELETE',
          headers: svcHeaders,
        });
        authDeleted = byEmail.ok;
      }
    }

    // ── Delete the profile row ──────────────────────────────────────────
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(id)}`,
      { method: 'DELETE', headers: svcHeaders }
    );
    if (!profileRes.ok) {
      const txt = await profileRes.text();
      return res.status(400).json({ error: 'Could not remove user profile: ' + txt });
    }

    return res.status(200).json({ ok: true, authDeleted });
  } catch (e) {
    console.error('delete-user error:', e);
    return res.status(500).json({ error: e.message || 'Unexpected error' });
  }
};
