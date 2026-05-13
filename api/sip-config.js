module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const username = process.env.SW_SIP_USERNAME;
  const password = process.env.SW_SIP_PASSWORD;
  const domain   = process.env.SW_SIP_DOMAIN;

  if (!username || !password || !domain) {
    return res.status(500).json({ error: 'SIP env vars not set — add SW_SIP_USERNAME, SW_SIP_PASSWORD, SW_SIP_DOMAIN to Vercel' });
  }

  res.json({ username, password, domain });
};
