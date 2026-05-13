const SUPABASE_URL = 'https://oipkvwdjlwienkphsivr.supabase.co';

module.exports = async function handler(req, res) {
  const sid    = req.body?.MessageSid || req.body?.SmsSid || '';
  const raw    = req.body?.MessageStatus || req.body?.SmsStatus || '';
  const status = { delivered: 'delivered', sent: 'sent', failed: 'failed', undelivered: 'failed' }[raw] || null;

  if (!sid || !status || !process.env.SUPABASE_SERVICE_KEY) return res.status(200).end();

  const key = process.env.SUPABASE_SERVICE_KEY;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/conversations?select=id,messages`, { headers });
    const convs = await r.json();

    for (const conv of convs || []) {
      const msgs = conv.messages || [];
      const idx  = msgs.findIndex(m => m.sid === sid);
      if (idx !== -1) {
        msgs[idx].status = status;
        await fetch(`${SUPABASE_URL}/rest/v1/conversations?id=eq.${conv.id}`, {
          method: 'PATCH',
          headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({ messages: msgs }),
        });
        break;
      }
    }
  } catch (e) {
    console.error('sms-status error:', e);
  }

  res.status(200).end();
};
