module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { to } = req.body || {};
  if (!to) return res.status(400).json({ error: 'Missing to' });

  const space    = process.env.SW_SPACE_URL;
  const project  = process.env.SW_PROJECT_ID;
  const token    = process.env.SW_API_TOKEN;
  const from     = process.env.SW_PHONE_NUMBER;
  const sipUser  = process.env.SW_SIP_USERNAME;
  const sipDom   = process.env.SW_SIP_DOMAIN;

  if (!space || !project || !token || !from || !sipUser || !sipDom) {
    return res.status(500).json({ error: 'SignalWire env vars not set' });
  }

  const host      = req.headers.host || 'mynextlevel-crm.vercel.app';
  const contactTo = to.startsWith('+') ? to : '+1' + to.replace(/\D/g, '');
  // Dial the SIP credential (browser registered via JsSIP) — SignalWire generates
  // WebRTC-compatible SDP, browser auto-answers, TwiML bridges to contact.
  const sipUri    = `sip:${sipUser}@${sipDom}`;
  const twimlUrl  = `https://${host}/api/voice-twiml?contactTo=${encodeURIComponent(contactTo)}`;
  const statusUrl = `https://${host}/api/call-status`;

  try {
    const r = await fetch(
      `${space}/api/laml/2010-04-01/Accounts/${project}/Calls.json`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${project}:${token}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To:                   sipUri,
          From:                 from,
          Url:                  twimlUrl,
          Method:               'POST',
          StatusCallback:       statusUrl,
          StatusCallbackMethod: 'POST',
        }).toString(),
      }
    );
    const data = await r.json();
    if (data.error_code) throw new Error(data.message || `SignalWire error ${data.error_code}`);
    res.json({ success: true, sid: data.sid, status: data.status });
  } catch (e) {
    console.error('make-call error:', e);
    res.status(500).json({ error: e.message });
  }
};
