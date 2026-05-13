const crypto = require('crypto');

const SPACE   = process.env.SW_SPACE_URL;
const PROJECT = process.env.SW_PROJECT_ID;
const TOKEN   = process.env.SW_API_TOKEN;

function basicAuth() {
  return 'Basic ' + Buffer.from(`${PROJECT}:${TOKEN}`).toString('base64');
}

async function getOrCreateApp(baseUrl) {
  const listRes = await fetch(
    `${SPACE}/api/laml/2010-04-01/Accounts/${PROJECT}/Applications.json`,
    { headers: { Authorization: basicAuth(), Accept: 'application/json' } }
  );
  const list = await listRes.json();
  const apps = list.applications || [];
  const existing = apps.find(a => a.friendly_name === 'NLM-CRM-Voice');
  if (existing) return existing.sid;

  const createRes = await fetch(
    `${SPACE}/api/laml/2010-04-01/Accounts/${PROJECT}/Applications.json`,
    {
      method: 'POST',
      headers: {
        Authorization: basicAuth(),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        FriendlyName: 'NLM-CRM-Voice',
        VoiceUrl: `${baseUrl}/api/voice-twiml`,
        VoiceMethod: 'POST',
      }).toString(),
    }
  );
  const created = await createRes.json();
  if (!created.sid) throw new Error('Failed to create TwiML app: ' + JSON.stringify(created));
  return created.sid;
}

function makeCapabilityToken(appSid) {
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    jti: `${PROJECT}-${now}`,
    iss: PROJECT,
    sub: PROJECT,
    exp: now + 3600,
    grants: {
      identity: `crm-agent-${now}`,
      voice: {
        incoming: { allow: true },
        outgoing: { application_sid: appSid },
      },
    },
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!SPACE || !PROJECT || !TOKEN) {
    return res.status(500).json({ error: 'SignalWire env vars not set' });
  }

  try {
    const host    = req.headers.host || 'mynextlevel-crm.vercel.app';
    const baseUrl = `https://${host}`;
    const appSid  = await getOrCreateApp(baseUrl);
    const token   = makeCapabilityToken(appSid);
    res.json({ token });
  } catch (e) {
    console.error('call-token error:', e);
    res.status(500).json({ error: e.message });
  }
};
