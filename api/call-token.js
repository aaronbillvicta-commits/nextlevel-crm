const SPACE   = process.env.SW_SPACE_URL;
const PROJECT = process.env.SW_PROJECT_ID;
const TOKEN   = process.env.SW_API_TOKEN;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SPACE || !PROJECT || !TOKEN) {
    return res.status(500).json({ error: 'SignalWire env vars not set' });
  }

  try {
    // RELAY Browser SDK v2 requires a JWT from /api/relay/rest/jwt
    const r = await fetch(`${SPACE}/api/relay/rest/jwt`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${PROJECT}:${TOKEN}`).toString('base64'),
        'Content-Type': 'application/json',
      },
    });
    const data = await r.json();
    if (!data.jwt_token) throw new Error(data.message || 'No JWT: ' + JSON.stringify(data));
    res.json({ token: data.jwt_token, project: PROJECT });
  } catch (e) {
    console.error('call-token error:', e);
    res.status(500).json({ error: e.message });
  }
};
