// Returns row counts, growth rates, and estimated storage usage per Supabase table.
// Estimates are conservative — actual disk size includes indexes/overhead, so real usage may be ~1.5×.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = 'https://oipkvwdjlwienkphsivr.supabase.co';
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not set' });

  // Average bytes per row — calibrated for our schema. Conversations and pipelines store nested JSON.
  const tables = [
    { name: 'contacts',       avgRow: 800,  label: 'Contacts',       icon: '👤', color: '#00d2ff' },
    { name: 'conversations',  avgRow: 2500, label: 'Conversations',  icon: '💬', color: '#a259ff' },
    { name: 'pipelines',      avgRow: 1500, label: 'Pipelines & Deals', icon: '📊', color: '#00e5a0' },
    { name: 'workflows',      avgRow: 1200, label: 'Automations',    icon: '⚡', color: '#ffb830' },
    { name: 'integrations',   avgRow: 600,  label: 'Integrations',   icon: '🔗', color: '#ff2d78' },
    { name: 'email_accounts', avgRow: 500,  label: 'Email accounts', icon: '📧', color: '#38beff' },
    { name: 'custom_fields',  avgRow: 200,  label: 'Custom fields',  icon: '⚙',  color: '#8ca0c8' },
    { name: 'tags',           avgRow: 100,  label: 'Tags',           icon: '🏷', color: '#ff4d6d' },
    { name: 'error_logs',     avgRow: 1000, label: 'Error logs',     icon: '⚠',  color: '#ffb830' },
  ];

  const now = Date.now();
  const since7d  = new Date(now - 7  * 86400000).toISOString();
  const since30d = new Date(now - 30 * 86400000).toISOString();

  async function getCount(table, filter = '') {
    try {
      const url = `${SUPABASE_URL}/rest/v1/${table}?select=*${filter}&limit=1`;
      const r = await fetch(url, {
        method: 'HEAD',
        headers: {
          apikey: KEY,
          Authorization: 'Bearer ' + KEY,
          Prefer: 'count=exact',
        },
      });
      if (!r.ok) return 0;
      const contentRange = r.headers.get('content-range') || '*/0';
      return parseInt(contentRange.split('/')[1], 10) || 0;
    } catch (_) {
      return 0;
    }
  }

  try {
    const results = await Promise.all(
      tables.map(async t => {
        const [total, last7d, last30d] = await Promise.all([
          getCount(t.name),
          getCount(t.name, `&created_at=gte.${since7d}`),
          getCount(t.name, `&created_at=gte.${since30d}`),
        ]);
        return {
          name: t.name,
          label: t.label,
          icon: t.icon,
          color: t.color,
          count: total,
          last7d,
          last30d,
          bytes: total * t.avgRow,
          avgRow: t.avgRow,
        };
      })
    );

    const total_bytes = results.reduce((s, r) => s + r.bytes, 0);
    const limit_bytes = 500 * 1024 * 1024; // Supabase free tier: 500 MB

    // Growth across all tables (rows / day) — last 7 days is more responsive than 30
    const total7d  = results.reduce((s, r) => s + r.last7d, 0);
    const total30d = results.reduce((s, r) => s + r.last30d, 0);
    const bytes_per_day_7d  = results.reduce((s, r) => s + (r.last7d  * r.avgRow), 0) / 7;
    const bytes_per_day_30d = results.reduce((s, r) => s + (r.last30d * r.avgRow), 0) / 30;

    res.json({
      tables: results,
      total_bytes,
      limit_bytes,
      usage_pct: total_bytes / limit_bytes * 100,
      remaining_bytes: Math.max(0, limit_bytes - total_bytes),
      growth: {
        rows_last_7d:  total7d,
        rows_last_30d: total30d,
        bytes_per_day_7d,
        bytes_per_day_30d,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
