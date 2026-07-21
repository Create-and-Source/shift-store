import { createClient } from '@supabase/supabase-js'
import { roleFromReq } from '../_lib/adminRole.js'
import { shopifyAdminEnabled, createShopifyOrder } from '../_lib/shopify.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Submit an existing order's Shopify/Tapstitch items to Shopify as a
// draft-completed order — the retry/backfill path for orders placed before
// the draft-order flow existed (or whose webhook submission failed).
export default async function handler(req, res) {
  if (!roleFromReq(req)) return res.status(401).json({ error: 'Unauthorized' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!shopifyAdminEnabled()) return res.status(400).json({ error: 'Shopify admin token not configured' })

  const { orderId } = req.body || {}
  if (!orderId) return res.status(400).json({ error: 'orderId required' })

  const { data: order, error: findErr } = await supabase
    .from('orders')
    .select('*, customer:customers(email), items:order_items(*)')
    .eq('id', orderId)
    .single()
  if (findErr || !order) return res.status(404).json({ error: 'Order not found' })
  if (order.shopify_order_id) {
    return res.status(400).json({ error: `Already sent to Shopify (${order.shopify_order_id}) — a re-send would duplicate production` })
  }

  const addr = order.shipping_address || {}
  if (!addr.line1 || !addr.city) {
    return res.status(400).json({ error: 'Order has no shipping address — recover it from Stripe first' })
  }

  // Resolve each Shopify item's variant gid by color+size from the live feed.
  const host = req.headers.host || 'shift-store.vercel.app'
  const feed = await fetch(`https://${host}/api/shopify/products`)
    .then(r => r.json())
    .catch(() => ({}))
  const byId = new Map((feed.products || []).map(p => [p.id, p]))

  const lineItems = []
  const misses = []
  for (const it of order.items || []) {
    const p = byId.get(it.product_id)
    if (!p) continue // not a Shopify product
    const variantId = p.variantMap?.[`${it.color}|${it.size}`]
    if (variantId) lineItems.push({ variantId, quantity: it.quantity || 1 })
    else misses.push(`${it.product_name} ${it.color}/${it.size}`)
  }
  if (misses.length) return res.status(400).json({ error: `No Shopify variant match for: ${misses.join(', ')}` })
  if (!lineItems.length) return res.status(400).json({ error: 'No Shopify items on this order' })

  try {
    const shOrder = await createShopifyOrder({
      email: order.customer?.email || '',
      lineItems,
      shippingAddress: addr,
    })

    if (shOrder?.id) {
      const { error: linkErr } = await supabase
        .from('orders')
        .update({ shopify_order_id: shOrder.id })
        .eq('id', orderId)
      if (linkErr) console.error('Shopify backlink (non-fatal):', linkErr.message)
    }

    return res.status(200).json({ ok: true, items: lineItems.length, order: shOrder })
  } catch (err) {
    console.error('Shopify submit failed:', err.message, err.body)
    return res.status(502).json({ error: err.message, detail: err.body })
  }
}
