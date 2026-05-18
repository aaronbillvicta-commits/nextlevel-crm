const { applyCors, requireAuth } = require('./_auth');

const SPACE   = process.env.SW_SPACE_URL;
const PROJECT = process.env.SW_PROJECT_ID;
const TOKEN   = process.env.SW_API_TOKEN;

module.exports = async function handler(req, res) {
  applyCors(req, res, 'GET, OPTIONS');
  // CRITICAL: never cache token responses. A cached (stale) token causes
  // SignalWire's "authblock_is_expired" error even on a fresh fetch.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await requireAuth(req, res);
  if (!user) return;

  if (!SPACE || !PROJECT || !TOKEN) {
    return res.status(500).json({ error: 'SignalWire env vars not set' });
  }

  try {
    // Subscriber tokens default to 2h. Set 8h so a long session / long call
    // doesn't die mid-use; the frontend also auto-refreshes on expiry.
    const expireAt = Math.floor(Date.now() / 1000) + (8 * 60 * 60);
    const r = await fetch(`${SPACE}/api/fabric/subscribers/tokens`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${PROJECT}:${TOKEN}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reference: 'crm-user', expire_at: expireAt }),
    });
    const data = await r.json();
    if (!data.token) throw new Error(data.message || 'No token: ' + JSON.stringify(data));
    res.json({ token: data.token, expire_at: expireAt });
  } catch (e) {
    console.error('call-token error:', e);
    res.status(500).json({ error: e.message });
  }
};
