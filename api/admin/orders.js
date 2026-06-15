import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const ADMIN_KEY = process.env.ADMIN_KEY || 'shift-admin-2026'

export default async function handler(req, res) {
  // Simple admin auth via header
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
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

    return res.status(200).json(data)
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
