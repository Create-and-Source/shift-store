import { createClient } from '@supabase/supabase-js'
import { roleFromReq } from './_lib/adminRole.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Newsletter signups. POST = public (the storefront "Join the Movement" form);
// GET = admin (owner or staff) — the list feeds the admin Subscribers page.
export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (!roleFromReq(req)) return res.status(401).json({ error: 'Unauthorized' })
    const { data, error } = await supabase
      .from('subscribers')
      .select('email, created_at, source')
      .order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ subscribers: data || [] })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const email = String(req.body?.email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email' })
  }
  const { error } = await supabase
    .from('subscribers')
    .upsert({ email }, { onConflict: 'email' })
  if (error) {
    console.error('Subscribe error:', error)
    return res.status(500).json({ error: 'Something went wrong — try again' })
  }
  return res.status(200).json({ ok: true })
}
