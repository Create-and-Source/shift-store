import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  httpClient: Stripe.createFetchHttpClient(),
})

import { roleFromReq } from '../_lib/adminRole.js'

export default async function handler(req, res) {
  // Admin auth via header — owner or staff login both work here.
  const role = roleFromReq(req)
  if (!role) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (req.method === 'GET') {
    const { status } = req.query

    let query = supabase
      .from('orders')
      .select(`
        *,
        customer:customers(id, email, name),
        items:order_items(*)
      `)
      .order('created_at', { ascending: false })

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    const { data, error } = await query

    if (error) {
      console.error('Orders fetch error:', error)
      return res.status(500).json({ error: error.message })
    }

    // Purchase-time cost snapshots live on order_items as `cost` (true source
    // cost) + `owner_price` (the owner's private layer). Staff sees the owner's
    // price AS the cost — the true cost and the private layer never leave the
    // server for non-owner eyes.
    if (role !== 'owner') {
      for (const o of data || []) {
        for (const it of o.items || []) {
          if (it.owner_price != null) it.cost = it.owner_price
          delete it.owner_price
        }
      }
    }

    return res.status(200).json(data)
  }

  // Recover a missing shipping address from the order's Stripe session —
  // repairs orders recorded before the collected_information webhook fix.
  if (req.method === 'POST' && req.body?.action === 'recoverAddress') {
    const { orderId } = req.body
    if (!orderId) return res.status(400).json({ error: 'orderId required' })

    const { data: order, error: findErr } = await supabase
      .from('orders')
      .select('id, stripe_session_id, shipping_address')
      .eq('id', orderId)
      .single()
    if (findErr || !order) return res.status(404).json({ error: 'Order not found' })
    if (!order.stripe_session_id) return res.status(400).json({ error: 'Order has no Stripe session' })

    const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id)
    const details = session.collected_information?.shipping_details
      || session.shipping_details || session.shipping || {}
    const addr = { ...(details.address || {}) }
    addr.name = details.name || session.customer_details?.name || ''
    if (session.customer_details?.phone) addr.phone = session.customer_details.phone
    if (!addr.line1 && !addr.city) {
      return res.status(404).json({ error: 'Stripe session has no shipping address either' })
    }

    const { error: upErr } = await supabase
      .from('orders')
      .update({ shipping_address: addr })
      .eq('id', orderId)
    if (upErr) return res.status(500).json({ error: upErr.message })

    return res.status(200).json({ ok: true, shipping_address: addr })
  }

  if (req.method === 'PATCH') {
    const { orderId, status, tracking_number, tracking_url, admin_notes } = req.body

    if (!orderId) {
      return res.status(400).json({ error: 'orderId required' })
    }

    const updates = {}
    if (status) updates.status = status
    if (tracking_number !== undefined) updates.tracking_number = tracking_number
    if (tracking_url !== undefined) updates.tracking_url = tracking_url
    if (admin_notes !== undefined) updates.admin_notes = admin_notes

    const { data, error } = await supabase
      .from('orders')
      .update(updates)
      .eq('id', orderId)
      .select()
      .single()

    if (error) {
      console.error('Order update error:', error)
      return res.status(500).json({ error: error.message })
    }

    return res.status(200).json(data)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
