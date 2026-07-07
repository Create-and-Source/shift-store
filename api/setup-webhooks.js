import { shopifyAdminEnabled, listShopifyWebhooks, createShopifyWebhook } from './_lib/shopify.js'
import { printifyEnabled, listPrintifyWebhooks, createPrintifyWebhook } from './_lib/printify.js'

// One-time (idempotent) registration of the real-time tracking webhooks with
// Printify + Shopify, pointing at this deployment. Admin-only; safe to re-run —
// it skips topics already registered to our callback URLs.
//
//   Shopify  : orders/fulfilled          -> /api/shopify-webhook
//   Printify : order:shipment:created    -> /api/printify-webhook

const ADMIN_KEY = process.env.ADMIN_KEY || 'shift-admin-2026'

export default async function handler(req, res) {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' })

  const host = req.headers['x-forwarded-host'] || req.headers.host
  const base = `https://${host}`
  const shopifyUrl = `${base}/api/shopify-webhook`
  const printifyUrl = `${base}/api/printify-webhook`

  const out = { base, shopify: null, printify: null }

  // ── Shopify ──
  if (shopifyAdminEnabled()) {
    try {
      const existing = await listShopifyWebhooks()
      const has = existing.some(w => w.topic === 'ORDERS_FULFILLED' && w.callbackUrl === shopifyUrl)
      if (has) {
        out.shopify = { status: 'already-registered', topic: 'ORDERS_FULFILLED', url: shopifyUrl }
      } else {
        const sub = await createShopifyWebhook({ topic: 'ORDERS_FULFILLED', callbackUrl: shopifyUrl })
        out.shopify = { status: 'registered', topic: 'ORDERS_FULFILLED', url: shopifyUrl, id: sub?.id }
      }
    } catch (err) {
      out.shopify = { status: 'error', error: err.message }
    }
  } else {
    out.shopify = { status: 'skipped', reason: 'Shopify admin not configured' }
  }

  // ── Printify ──
  if (printifyEnabled()) {
    try {
      const existing = await listPrintifyWebhooks()
      const topic = 'order:shipment:created'
      const has = Array.isArray(existing) && existing.some(w => w.topic === topic && w.url === printifyUrl)
      if (has) {
        out.printify = { status: 'already-registered', topic, url: printifyUrl }
      } else {
        const wh = await createPrintifyWebhook({ topic, url: printifyUrl, secret: process.env.PRINTIFY_WEBHOOK_SECRET })
        out.printify = { status: 'registered', topic, url: printifyUrl, id: wh?.id }
      }
    } catch (err) {
      out.printify = { status: 'error', error: err.message }
    }
  } else {
    out.printify = { status: 'skipped', reason: 'Printify not configured' }
  }

  return res.status(200).json({ ok: true, ...out })
}
