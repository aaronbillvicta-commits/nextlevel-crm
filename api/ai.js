const { applyCors, requireAuth } = require('./_auth');

module.exports = async function handler(req, res) {
  applyCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  const { feature, context } = req.body || {};
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set in Vercel environment variables' });

  const prompts = {
    draft_reply: `You are an assistant for a digital marketing agency CRM. Draft a short, professional reply.
Channel: ${context?.channel || 'sms'}
Contact name: ${context?.contactName || 'the contact'}
Recent conversation:
${(context?.messages || []).slice(-4).map(m => `[${m.dir === 'outbound' ? 'Us' : 'Them'}]: ${m.body}`).join('\n')}
Write ONLY the reply message body. If SMS: keep under 160 characters. If email: 2-3 sentences max. No greeting, no sign-off.`,

    summarize_contact: `Summarize this contact's profile for a marketing agency sales rep. 2-3 sentences max.
Contact: ${JSON.stringify(context || {})}`,

    campaign_copy: `Write marketing copy for this campaign. Return valid JSON only.
Campaign: ${JSON.stringify(context || {})}
Return exactly: {"subject": "<email subject or empty string>", "body": "<message body using {{name}} placeholder>"}`
  };

  const prompt = prompts[feature];
  if (!prompt) return res.status(400).json({ error: 'Unknown feature: ' + feature });

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 300, temperature: 0.7 }
        })
      }
    );
    if (!response.ok) {
      const err = await response.json();
      return res.status(502).json({ error: err.error?.message || 'Gemini request failed' });
    }
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    return res.status(200).json({ result: text });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
