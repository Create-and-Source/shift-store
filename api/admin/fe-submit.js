import { createClient } from '@supabase/supabase-js'
import { roleFromReq } from '../_lib/adminRole.js'
import { feEnabled, createFEOrder, feDebug } from '../_lib/fulfillengine.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Submit (or dry-run validate) an existing order's Fulfill Engine items to FE.
// The retry/backfill path for orders the webhook couldn't auto-submit —
// e.g. the first-ever orders, placed before FE integration existed.
export default async function handler(req, res) {
  if (!roleFromReq(req)) return res.status(401).json({ error: 'Unauthorized' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!feEnabled()) return res.status(400).json({ error: 'FE_API_KEY is not set in Vercel yet' })

  const { orderId, validate = false } = req.body || {}
  if (!orderId) return res.status(400).json({ error: 'orderId required' })

  const { data: order, error: findErr } = await supabase
    .from('orders')
    .select('*, customer:customers(email), items:order_items(*)')
    .eq('id', orderId)
    .single()
  if (findErr || !order) return res.status(404).json({ error: 'Order not found' })
  if (order.fe_order_id && !validate) {
    return res.status(400).json({ error: `Already sent to Fulfill Engine (${order.fe_order_id})` })
  }

  const addr = order.shipping_address || {}
  if (!addr.line1 || !addr.city) {
    return res.status(400).json({ error: 'Order has no shipping address — recover it from Stripe first' })
  }

  // FE items = items whose product id is in the FE catalog
  const feed = await fetch('https://api.fulfillengine.com/shop/campaigns/shift')
    .then(r => r.json())
    .catch(() => ({}))
  const feIds = new Set((feed.products || []).map(p => p.id))
  const feItems = (order.items || []).filter(it => feIds.has(it.product_id))
  if (!feItems.length) return res.status(400).json({ error: 'No Fulfill Engine items on this order' })

  if (req.body?.debug) {
    try {
      const dbg = await feDebug(feItems.map(it => ({ productId: it.product_id })))
      return res.status(200).json(dbg)
    } catch (err) {
      return res.status(502).json({ error: err.message, detail: err.body })
    }
  }

  try {
    const result = await createFEOrder({
      externalId: order.id,
      items: feItems.map(it => ({
        productId: it.product_id,
        color: it.color,
        size: it.size,
        qty: it.quantity || 1,
        price: Number(it.unit_price) || 0,
      })),
      address: addr,
      email: order.customer?.email || '',
      validateOnly: validate,
    })

    if (!validate) {
      const feId = String(result?.id || result?.orderId || '')
      if (feId) {
        // Best-effort backlink; ignore if the column doesn't exist yet.
        const { error: linkErr } = await supabase
          .from('orders')
          .update({ fe_order_id: feId })
          .eq('id', orderId)
        if (linkErr) console.error('FE backlink (non-fatal):', linkErr.message)
      }
      // A successful manual (re)send resolves the loud-failure banner.
      // Separate call so a missing column can't take the backlink down with it.
      const { error: clearErr } = await supabase
        .from('orders')
        .update({ fulfillment_error: null })
        .eq('id', orderId)
      if (clearErr) console.error('fulfillment_error clear (non-fatal):', clearErr.message)
    }

    return res.status(200).json({ ok: true, validated: !!validate, feItems: feItems.length, result })
  } catch (err) {
    console.error('FE submit failed:', err.message, err.body)
    return res.status(502).json({ error: err.message, detail: err.body })
  }
}
