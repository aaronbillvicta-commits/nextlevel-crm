const SUPABASE_URL = 'https://oipkvwdjlwienkphsivr.supabase.co';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
}

function checkAuth(req, res) {
  const expected = process.env.CRM_API_KEY;
  if (!expected) { res.status(500).json({ error: 'CRM_API_KEY env var not configured on server' }); return false; }
  if (req.headers['x-api-key'] !== expected) { res.status(401).json({ error: 'Unauthorized: invalid or missing X-API-Key header' }); return false; }
  return true;
}

function sbHeaders(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra };
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkAuth(req, res)) return;

  // ── GET /api/v1/calls ─────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { direction, status, limit = '50', offset = '0' } = req.query;
    const lim = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const off = Math.max(parseInt(offset) || 0, 0);

    let url = `${SUPABASE_URL}/rest/v1/call_history?select=*&order=created_at.desc&limit=${lim}&offset=${off}`;

    if (direction && ['inbound', 'outbound'].includes(direction)) {
      url += `&direction=eq.${direction}`;
    }
    if (status && ['completed', 'missed', 'failed'].includes(status)) {
      url += `&status=eq.${status}`;
    }

    try {
      const r = await fetch(url, { headers: sbHeaders({ Prefer: 'count=exact' }) });
      const total = parseInt(r.headers.get('content-range')?.split('/')[1] ?? '0') || 0;
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.message || 'Supabase query failed' });
      return res.json({ data, total, limit: lim, offset: off });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
