const SUPABASE_URL = 'https://oipkvwdjlwienkphsivr.supabase.co';
const VALID_STATUSES = ['new', 'active', 'hot', 'cold', 'done'];

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

  // ── GET /api/v1/contacts ───────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { search, status, limit = '50', offset = '0' } = req.query;
    const lim = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const off = Math.max(parseInt(offset) || 0, 0);

    const fields = 'id,name,first_name,last_name,email,phone,company,source,status,tags,created_at,updated_at';
    let url = `${SUPABASE_URL}/rest/v1/contacts?select=${fields}&order=created_at.desc&limit=${lim}&offset=${off}`;

    if (search) {
      const q = encodeURIComponent(search.replace(/[*%]/g, ''));
      url += `&or=(name.ilike.*${q}*,email.ilike.*${q}*,phone.ilike.*${q}*)`;
    }
    if (status && VALID_STATUSES.includes(status)) {
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

  // ── POST /api/v1/contacts ──────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { name, email, phone, company, source, status } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const body = { name: String(name).trim() };
    if (email)   body.email   = String(email).trim();
    if (phone)   body.phone   = String(phone).trim();
    if (company) body.company = String(company).trim();
    if (source)  body.source  = String(source).trim();
    if (status)  body.status  = status;

    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/contacts`, {
        method: 'POST',
        headers: sbHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.message || 'Failed to create contact' });
      return res.status(201).json({ data: Array.isArray(data) ? data[0] : data });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
