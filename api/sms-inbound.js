const SUPABASE_URL = 'https://oipkvwdjlwienkphsivr.supabase.co';

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'text/xml');

  const from = (req.body?.From || '').replace(/\D/g, '').slice(-10);
  const body = req.body?.Body || '';

  if (!from || !body || !process.env.SUPABASE_SERVICE_KEY) {
    return res.end('<?xml version="1.0"?><Response></Response>');
  }

  try {
    // Find contact by last 10 digits of phone
    const cRes = await fetch(
      `${SUPABASE_URL}/rest/v1/contacts?phone=like.*${from}*&select=id,name,phone&limit=1`,
      { headers: sbHeaders() }
    );
    const contacts = await cRes.json();
    const contact = contacts?.[0];

    const newMsg = {
      id: 'msg_' + Date.now(),
      ch: 'sms',
      dir: 'inbound',
      body,
      ts: new Date().toISOString(),
      status: 'received',
    };

    if (contact) {
      // Find existing conversation for this contact
      const convRes = await fetch(
        `${SUPABASE_URL}/rest/v1/conversations?contact_id=eq.${contact.id}&limit=1`,
        { headers: sbHeaders() }
      );
      const convs = await convRes.json();

      if (convs?.[0]) {
        const messages = [...(convs[0].messages || []), newMsg];
        await fetch(
          `${SUPABASE_URL}/rest/v1/conversations?id=eq.${convs[0].id}`,
          {
            method: 'PATCH',
            headers: { ...sbHeaders(), Prefer: 'return=minimal' },
            body: JSON.stringify({ messages }),
          }
        );
      } else {
        await fetch(`${SUPABASE_URL}/rest/v1/conversations`, {
          method: 'POST',
          headers: { ...sbHeaders(), Prefer: 'return=minimal' },
          body: JSON.stringify({
            id: 'conv_' + Date.now(),
            contact_id: contact.id,
            messages: [newMsg],
          }),
        });
      }
    }
  } catch (e) {
    console.error('sms-inbound error:', e);
  }

  res.end('<?xml version="1.0"?><Response></Response>');
};
