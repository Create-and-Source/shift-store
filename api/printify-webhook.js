import { printifyEnabled, getPrintifyOrder, printifyTrackingFrom } from './_lib/printify.js'
import { readRawBody, webhookAuthorized, saveTrackingByColumn } from './_lib/tracking.js'

// Real-time tracking from Printify. Register `order:shipment:created` and
// `order:shipment:delivered` to point here (see /api/setup-webhooks).
//   shipment:created   → write tracking + mark shipped
//   shipment:delivered → mark delivered
// Best-effort + always 200 so Printify doesn't retry forever on an order we
// don't recognize.

export const config = { api: { bodyParser: false } }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const raw = await readRawBody(req)

  // Auth: ?token= on the callback URL (set at registration), or an HMAC
  // signature if Printify sends one. Open when no secret is configured.
  const signature = String(req.headers['x-pfy-signature'] || '').replace(/^sha256=/, '')
  if (!webhookAuthorized({ req, raw, secret: process.env.PRINTIFY_WEBHOOK_SECRET, signature, encoding: 'hex' })) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  let event = {}
  try { event = JSON.parse(raw.toString()) } catch { return res.status(400).json({ error: 'Bad JSON' }) }

  // Printify order id lives on resource.id (fallbacks for payload variants).
  const printifyOrderId = event?.resource?.id || event?.resource?.data?.id || event?.id
  if (!printifyOrderId || !printifyEnabled()) return res.status(200).json({ received: true, skipped: true })

  // e.g. "order:shipment:delivered" vs "order:shipment:created".
  const delivered = /deliver/i.test(event?.type || '')

  try {
    const tracking = printifyTrackingFrom(await getPrintifyOrder(String(printifyOrderId)))
    // A delivered event still advances status even if tracking is unchanged.
    if (!tracking && !delivered) return res.status(200).json({ received: true, noTracking: true })
    const result = await saveTrackingByColumn(
      'printify_order_id', String(printifyOrderId), tracking, delivered ? 'delivered' : 'shipped'
    )
    return res.status(200).json({ received: true, ...result })
  } catch (err) {
    console.error('Printify webhook error (non-fatal):', err.message)
    return res.status(200).json({ received: true, error: err.message })
  }
}
