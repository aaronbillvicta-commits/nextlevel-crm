module.exports = function handler(req, res) {
  // contactTo = set by make-call.js for click-to-call agent leg
  // falls back to body.To for other inbound uses
  const to   = req.query.contactTo || (req.body && req.body.To) || req.query.To || '';
  const from = process.env.SW_PHONE_NUMBER || '';

  res.setHeader('Content-Type', 'text/xml');

  if (!to) {
    return res.end('<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>');
  }

  res.end(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${from}" timeout="30" record="record-from-ringing">
    <Number>${to}</Number>
  </Dial>
</Response>`);
};
