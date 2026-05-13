const SUPABASE_URL = 'https://oipkvwdjlwienkphsivr.supabase.co';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Always return 200 — never let error logging break the UI
  try {
    const { source, message, stack, context } = req.body || {};
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!key || !message) return res.status(200).end();

    await fetch(`${SUPABASE_URL}/rest/v1/error_logs`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ source, message, stack, context }),
    });
  } catch (e) {
    console.error('log-error handler failed:', e.message);
  }

  res.status(200).end();
};
