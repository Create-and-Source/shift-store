import { shopifyAdminEnabled, listShopifyWebhooks, createShopifyWebhook } from './_lib/shopify.js'
import { printifyEnabled, listPrintifyWebhooks, createPrintifyWebhook, deletePrintifyWebhook } from './_lib/printify.js'

// One-time (idempotent) registration of the real-time tracking webhooks with
// Printify + Shopify, pointing at this deployment. Admin-only; safe to re-run —
// it skips topics already registered to our callback URLs.
//
//   Shopify  : orders/fulfilled + fulfillments/update           -> /api/shopify-webhook
//   Printify : order:shipment:created + order:shipment:delivered -> /api/printify-webhook

const ADMIN_KEY = process.env.ADMIN_KEY || 'shift-admin-2026'

const SHOPIFY_TOPICS = ['ORDERS_FULFILLED', 'FULFILLMENTS_UPDATE']
const PRINTIFY_TOPICS = ['order:shipment:created', 'order:shipment:delivered']

export default async function handler(req, res) {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' })

  const host = req.headers['x-forwarded-host'] || req.headers.host
  const base = `https://${host}`
  // Append a secret ?token= so the receivers can authenticate the callback
  // without depending on each provider's (undocumented) signing scheme.
  const shTok = process.env.SHOPIFY_WEBHOOK_SECRET
  const pfTok = process.env.PRINTIFY_WEBHOOK_SECRET
  const shopifyUrl = `${base}/api/shopify-webhook${shTok ? `?token=${encodeURIComponent(shTok)}` : ''}`
  const printifyUrl = `${base}/api/printify-webhook${pfTok ? `?token=${encodeURIComponent(pfTok)}` : ''}`

  const out = { base, secured: { shopify: !!shTok, printify: !!pfTok }, shopify: [], printify: [] }

  // ── Shopify ──
  if (shopifyAdminEnabled()) {
    try {
      const existing = await listShopifyWebhooks()
      for (const topic of SHOPIFY_TOPICS) {
        try {
          if (existing.some(w => w.topic === topic && w.callbackUrl === shopifyUrl)) {
            out.shopify.push({ topic, status: 'already-registered' })
          } else {
            const sub = await createShopifyWebhook({ topic, callbackUrl: shopifyUrl })
            out.shopify.push({ topic, status: 'registered', id: sub?.id })
          }
        } catch (err) {
          out.shopify.push({ topic, status: 'error', error: err.message })
        }
      }
    } catch (err) {
      out.shopify.push({ status: 'error', error: err.message })
    }
  } else {
    out.shopify.push({ status: 'skipped', reason: 'Shopify admin not configured' })
  }

  // ── Printify ──
  // Delete any existing webhook pointing at our receiver (regardless of query
  // string), then create fresh so the current ?token= secret is applied.
  if (printifyEnabled()) {
    try {
      const existing = await listPrintifyWebhooks()
      const ours = (Array.isArray(existing) ? existing : []).filter(w => (w.url || '').includes('/api/printify-webhook'))
      for (const w of ours) { try { await deletePrintifyWebhook(w.id) } catch { /* ignore */ } }
      for (const topic of PRINTIFY_TOPICS) {
        try {
          const wh = await createPrintifyWebhook({ topic, url: printifyUrl, secret: pfTok })
          out.printify.push({ topic, status: 'registered', id: wh?.id, secured: !!pfTok })
        } catch (err) {
          out.printify.push({ topic, status: 'error', error: err.message })
        }
      }
    } catch (err) {
      out.printify.push({ status: 'error', error: err.message })
    }
  } else {
    out.printify.push({ status: 'skipped', reason: 'Printify not configured' })
  }

  return res.status(200).json({ ok: true, ...out })
}
