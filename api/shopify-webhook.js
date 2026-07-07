import { getShopifyOrderTracking } from './_lib/shopify.js'
import { readRawBody, verifyHmac, saveTrackingByColumn } from './_lib/tracking.js'

// Real-time tracking from Shopify. Register the `orders/fulfilled` topic to
// point here (see /api/setup-webhooks). The payload is the Order object, which
// carries its gid (admin_graphql_api_id) and fulfillments with tracking; we
// write that back onto the matching Supabase order. Best-effort + always 200.

export const config = { api: { bodyParser: false } }

// Pull the first tracking number/url out of an orders/fulfilled payload.
function trackingFromPayload(order) {
  for (const f of order?.fulfillments || []) {
    const number = f.tracking_number || (f.tracking_numbers || [])[0]
    if (number) {
      const url = f.tracking_url || (f.tracking_urls || [])[0] || ''
      return { number, url }
    }
  }
  return null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const raw = await readRawBody(req)

  // Shopify signs deliveries as base64 HMAC-SHA256 in x-shopify-hmac-sha256.
  const signature = req.headers['x-shopify-hmac-sha256'] || ''
  const verified = verifyHmac({ raw, signature, secret: process.env.SHOPIFY_WEBHOOK_SECRET, encoding: 'base64' })
  if (verified === false) return res.status(401).json({ error: 'Bad signature' })

  let order = {}
  try { order = JSON.parse(raw.toString()) } catch { return res.status(400).json({ error: 'Bad JSON' }) }

  // The gid we stored at order creation (gid://shopify/Order/123...).
  const gid = order.admin_graphql_api_id
  if (!gid) return res.status(200).json({ received: true, skipped: 'no order gid' })

  try {
    // Prefer tracking already in the payload; fall back to an Admin API lookup.
    let tracking = trackingFromPayload(order)
    if (!tracking) tracking = await getShopifyOrderTracking(gid)
    if (!tracking) return res.status(200).json({ received: true, noTracking: true })

    const result = await saveTrackingByColumn('shopify_order_id', gid, tracking)
    return res.status(200).json({ received: true, ...result })
  } catch (err) {
    console.error('Shopify webhook error (non-fatal):', err.message)
    return res.status(200).json({ received: true, error: err.message })
  }
}
