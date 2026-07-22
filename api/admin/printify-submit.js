import { createClient } from '@supabase/supabase-js'
import { roleFromReq } from '../_lib/adminRole.js'
import {
  printifyEnabled,
  getPrintifyOrder,
  sendPrintifyToProductionWithRetry,
  findPrintifyOrderByExternalId,
} from '../_lib/printify.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Push an order's Printify order to production — the repair path for the
// create-then-push race (the webhook creates the order, but the production
// push can fail while Printify still has it in "pending"). Never creates a
// Printify order: it finds the existing one (backlink, or external_id scan
// when the backlink was never stored) and pushes it.
const PUSHABLE = new Set(['pending', 'on-hold', 'onhold'])

export default async function handler(req, res) {
  if (!roleFromReq(req)) return res.status(401).json({ error: 'Unauthorized' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!printifyEnabled()) return res.status(400).json({ error: 'PRINTIFY_API_TOKEN is not set' })

  const { orderId } = req.body || {}
  if (!orderId) return res.status(400).json({ error: 'orderId required' })

  const { data: order, error: findErr } = await supabase
    .from('orders')
    .select('id, printify_order_id')
    .eq('id', orderId)
    .single()
  if (findErr || !order) return res.status(404).json({ error: 'Order not found' })

  try {
    let pfId = order.printify_order_id
    if (!pfId) {
      const existing = await findPrintifyOrderByExternalId(orderId)
      if (existing) {
        pfId = existing.id
        const { error: linkErr } = await supabase
          .from('orders')
          .update({ printify_order_id: pfId })
          .eq('id', orderId)
        if (linkErr) console.error('Printify backlink (non-fatal):', linkErr.message)
      }
    }
    if (!pfId) {
      return res.status(404).json({
        error: 'No Printify order exists for this order — the webhook never created one (did the cart have Printify items?).',
      })
    }

    const pfOrder = await getPrintifyOrder(pfId)
    const status = String(pfOrder?.status || '').toLowerCase()

    if (!PUSHABLE.has(status)) {
      // Already moving (sending-to-production / in-production / fulfilled…) —
      // resolve the banner, nothing to push.
      await supabase.from('orders').update({ fulfillment_error: null }).eq('id', orderId)
      return res.status(200).json({ ok: true, already: true, printifyOrderId: pfId, status: pfOrder?.status })
    }

    await sendPrintifyToProductionWithRetry(pfId)
    const { error: clearErr } = await supabase
      .from('orders')
      .update({ fulfillment_error: null })
      .eq('id', orderId)
    if (clearErr) console.error('fulfillment_error clear (non-fatal):', clearErr.message)

    return res.status(200).json({ ok: true, printifyOrderId: pfId, status: 'sent-to-production' })
  } catch (err) {
    console.error('Printify submit failed:', err.message, err.body)
    return res.status(502).json({ error: err.message, detail: err.body })
  }
}
