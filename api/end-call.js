module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { sid } = req.body || {};
  if (!sid) return res.status(400).json({ error: 'Missing sid' });

  const space   = process.env.SW_SPACE_URL;
  const project = process.env.SW_PROJECT_ID;
  const token   = process.env.SW_API_TOKEN;

  try {
    await fetch(
      `${space}/api/laml/2010-04-01/Accounts/${project}/Calls/${sid}.json`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${project}:${token}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ Status: 'completed' }).toString(),
      }
    );
    res.json({ success: true });
  } catch (e) {
    console.error('end-call error:', e);
    res.status(500).json({ error: e.message });
  }
};
