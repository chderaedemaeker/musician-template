// Send a note as a newsletter to everyone who subscribed via the footer form.
//
// Requires three environment variables (Netlify dashboard → Site settings →
// Environment variables):
//   NETLIFY_AUTH_TOKEN — personal access token, used to read the newsletter
//                        form's submissions (User settings → Applications)
//   RESEND_API_KEY     — API key from resend.com, used to send the emails
//   NEWSLETTER_FROM    — sender, e.g. "Veronique De Raedemaeker <notes@yourdomain.com>"
//                        (the domain must be verified in Resend)
//
// Only signed-in Netlify Identity users (i.e. the admin) can call this.

exports.handler = async (event, context) => {
  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Sign in required' }) };
  }

  // GET — the subscriber list, for the admin's newsletter builder
  if (event.httpMethod === 'GET') {
    const token = process.env.NETLIFY_AUTH_TOKEN;
    if (!token) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Set NETLIFY_AUTH_TOKEN in the environment variables to read the subscriber list.' }) };
    }
    try {
      const formsRes = await fetch(`https://api.netlify.com/api/v1/sites/${process.env.SITE_ID}/forms`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!formsRes.ok) throw new Error(`Could not list forms (${formsRes.status})`);
      const forms = await formsRes.json();
      const form = forms.find(f => f.name === 'newsletter');
      if (!form) return { statusCode: 200, body: JSON.stringify({ emails: [] }) };
      const subsRes = await fetch(`https://api.netlify.com/api/v1/forms/${form.id}/submissions?per_page=1000`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!subsRes.ok) throw new Error(`Could not read submissions (${subsRes.status})`);
      const submissions = await subsRes.json();
      const emails = [...new Set(
        submissions
          .map(s => (s.data && s.data.email ? String(s.data.email).trim().toLowerCase() : ''))
          .filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
      )];
      return { statusCode: 200, body: JSON.stringify({ emails }) };
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
    }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const token = process.env.NETLIFY_AUTH_TOKEN;
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.NEWSLETTER_FROM;
  if (!token || !resendKey || !from) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Newsletter is not configured yet — set NETLIFY_AUTH_TOKEN, RESEND_API_KEY and NEWSLETTER_FROM in the Netlify environment variables.' }),
    };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch (e) { payload = {}; }
  const { subject, html, text } = payload;
  if (!subject || !html) {
    return { statusCode: 400, body: JSON.stringify({ error: 'subject and html are required' }) };
  }

  try {
    // 1. Collect subscriber addresses from the Netlify "newsletter" form
    const siteId = process.env.SITE_ID;
    const formsRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/forms`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!formsRes.ok) throw new Error(`Could not list forms (${formsRes.status})`);
    const forms = await formsRes.json();
    const form = forms.find(f => f.name === 'newsletter');
    if (!form) throw new Error('No "newsletter" form found on this site');

    const subsRes = await fetch(`https://api.netlify.com/api/v1/forms/${form.id}/submissions?per_page=1000`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!subsRes.ok) throw new Error(`Could not read submissions (${subsRes.status})`);
    const submissions = await subsRes.json();
    const emails = [...new Set(
      submissions
        .map(s => (s.data && s.data.email ? String(s.data.email).trim().toLowerCase() : ''))
        .filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
    )];
    if (!emails.length) {
      return { statusCode: 200, body: JSON.stringify({ sent: 0, message: 'No subscribers yet' }) };
    }

    // 2. Send one email per subscriber (nobody sees anyone else's address),
    //    in batches of 100 via Resend's batch endpoint
    let sent = 0;
    for (let i = 0; i < emails.length; i += 100) {
      const batch = emails.slice(i, i + 100).map(to => ({
        from,
        to: [to],
        subject,
        html,
        text: text || undefined,
      }));
      const sendRes = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });
      if (!sendRes.ok) {
        const err = await sendRes.text();
        throw new Error(`Sending failed after ${sent} emails: ${err.slice(0, 300)}`);
      }
      sent += batch.length;
    }

    return { statusCode: 200, body: JSON.stringify({ sent }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
