const { applyCors } = require('./_auth');

const SUPABASE_URL = 'https://oipkvwdjlwienkphsivr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pcGt2d2RqbHdpZW5rcGhzaXZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxMzk2NTUsImV4cCI6MjA5MTcxNTY1NX0.VAj_i2iCnvd3qz9Emhh-O_eBywrmxYH9U2vJPVFclT0';

module.exports = async function handler(req, res) {
  applyCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { form_type } = req.query;

  try {
    let url = `${SUPABASE_URL}/rest/v1/form_field_options`
      + `?active=eq.true&order=category.asc,sort_order.asc`
      + `&select=category,label,value,form_type`;

    if (form_type === 'va' || form_type === 'client') {
      url += `&or=(form_type.eq.both,form_type.eq.${form_type})`;
    }

    const r = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!r.ok) throw new Error('Supabase error: ' + r.status);
    const rows = await r.json();

    // Group by category so the form can render each section
    const grouped = {};
    for (const row of rows) {
      if (!grouped[row.category]) grouped[row.category] = [];
      grouped[row.category].push({ label: row.label, value: row.value });
    }

    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(grouped);
  } catch (e) {
    console.error('form-options error:', e);
    res.status(500).json({ error: 'Failed to fetch options' });
  }
};
