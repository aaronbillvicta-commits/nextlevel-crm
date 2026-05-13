module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { to, body } = req.body || {};
  if (!to || !body) return res.status(400).json({ error: 'Missing to or body' });

  const space   = process.env.SW_SPACE_URL;
  const project = process.env.SW_PROJECT_ID;
  const token   = process.env.SW_API_TOKEN;
  const from    = process.env.SW_PHONE_NUMBER;

  if (!space || !project || !token || !from) {
    return res.status(500).json({ error: 'SignalWire env vars not set' });
  }

  try {
    const r = await fetch(
      `${space}/api/laml/2010-04-01/Accounts/${project}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${project}:${token}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          To: to, From: from, Body: body,
          StatusCallback: `https://${req.headers.host}/api/sms-status`,
          StatusCallbackMethod: 'POST',
        }).toString(),
      }
    );
    const data = await r.json();
    if (data.error_code) throw new Error(data.message || `SignalWire error ${data.error_code}`);
    res.json({ success: true, sid: data.sid });
  } catch (e) {
    console.error('sms error:', e);
    res.status(500).json({ error: e.message });
  }
};
