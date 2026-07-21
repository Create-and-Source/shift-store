// Stripe Connect OAuth landing: the platform's redirect URI. When the Shift
// Apparel LLC account approves the authorize link, Stripe redirects here with
// a single-use ?code= — exchanging it (with the platform key) is what
// actually creates the connection. Safe to keep deployed: codes are
// single-use, and an exchange can only complete a connection a Stripe user
// explicitly approved for THIS platform.
import Stripe from 'stripe'

const page = (title, body) => `<!doctype html><html><body style="font-family:Arial;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
<div style="text-align:center;max-width:480px;padding:24px;">
<div style="font-size:22px;font-weight:900;letter-spacing:0.28em;margin-bottom:18px;">SHIFT<span style="color:#E50000;">.</span></div>
<h1 style="font-size:18px;margin:0 0 10px;">${title}</h1>
<p style="font-size:13px;color:#aaa;line-height:1.6;">${body}</p>
</div></body></html>`

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')

  const { code, error, error_description } = req.query
  if (error) {
    return res.status(400).send(page('Connection was not completed', `${error}: ${error_description || ''}`))
  }
  if (!code) {
    return res.status(400).send(page('Nothing to do', 'This page completes a Stripe Connect authorization — open it via the authorize link.'))
  }
  if (!process.env.STRIPE_PLATFORM_KEY) {
    return res.status(500).send(page('Platform key missing', 'Set STRIPE_PLATFORM_KEY in Vercel, redeploy, then click the authorize link again.'))
  }

  try {
    const platform = new Stripe(process.env.STRIPE_PLATFORM_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
    })
    const resp = await platform.oauth.token({ grant_type: 'authorization_code', code })
    return res.status(200).send(page(
      'Connected ✓',
      `Stripe account <strong>${resp.stripe_user_id}</strong> is now connected to the Create &amp; Source platform. The payment split is live on the next checkout.`
    ))
  } catch (err) {
    return res.status(500).send(page('Exchange failed', err.message))
  }
}
