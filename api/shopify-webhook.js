import { getShopifyOrderTracking } from './_lib/shopify.js'
import { readRawBody, webhookAuthorized, saveTrackingByColumn } from './_lib/tracking.js'

// Real-time tracking from Shopify. Register both topics to point here
// (see /api/setup-webhooks):
//   orders/fulfilled     → Order payload w/ tracking      → mark shipped
//   fulfillments/update  → Fulfillment payload w/ status  → mark delivered when
//                          shipment_status is "delivered"
// Best-effort + always 200 so Shopify doesn't retry on orders we don't know.

export const config = { api: { bodyParser: false } }

// First tracking number/url out of an Order payload's fulfillments.
function trackingFromOrder(order) {
  for (const f of order?.fulfillments || []) {
    const number = f.tracking_number || (f.tracking_numbers || [])[0]
    if (number) return { number, url: f.tracking_url || (f.tracking_urls || [])[0] || '' }
  }
  return null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const raw = await readRawBody(req)

  // Auth: ?token= on the callback URL, or Shopify's base64 HMAC-SHA256
  // (x-shopify-hmac-sha256, signed with the app secret). Open when unset.
  const signature = req.headers['x-shopify-hmac-sha256'] || ''
  if (!webhookAuthorized({ req, raw, secret: process.env.SHOPIFY_WEBHOOK_SECRET, signature, encoding: 'base64' })) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  let payload = {}
  try { payload = JSON.parse(raw.toString()) } catch { return res.status(400).json({ error: 'Bad JSON' }) }

  const topic = req.headers['x-shopify-topic'] || ''
  let gid, tracking = null, targetStatus = 'shipped'

  if (topic === 'fulfillments/update' || payload.shipment_status !== undefined) {
    // Fulfillment payload: carries order_id (numeric) + shipment_status.
    if (payload.order_id) gid = `gid://shopify/Order/${payload.order_id}`
    const number = payload.tracking_number || (payload.tracking_numbers || [])[0]
    if (number) tracking = { number, url: payload.tracking_url || (payload.tracking_urls || [])[0] || '' }
    if (payload.shipment_status === 'delivered') targetStatus = 'delivered'
  } else {
    // Order payload (orders/fulfilled): has the order gid + fulfillments.
    gid = payload.admin_graphql_api_id
    tracking = trackingFromOrder(payload)
  }

  if (!gid) return res.status(200).json({ received: true, skipped: 'no order gid' })

  try {
    // Fill in tracking from the Admin API if the payload didn't include it.
    if (!tracking) tracking = await getShopifyOrderTracking(gid)
    // A delivered event still advances status even without new tracking.
    if (!tracking && targetStatus !== 'delivered') return res.status(200).json({ received: true, noTracking: true })

    const result = await saveTrackingByColumn('shopify_order_id', gid, tracking, targetStatus)
    return res.status(200).json({ received: true, ...result })
  } catch (err) {
    console.error('Shopify webhook error (non-fatal):', err.message)
    return res.status(200).json({ received: true, error: err.message })
  }
}
