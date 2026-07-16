import { createClient } from '@supabase/supabase-js'
import { printifyEnabled, getPrintifyOrder, printifyTrackingFrom } from './_lib/printify.js'
import { shopifyAdminEnabled, getShopifyOrderTracking } from './_lib/shopify.js'

// Polls Printify + Shopify for tracking on in-flight orders and writes it back
// onto the Supabase order (tracking_number/url + status → shipped), so tracking
// flows automatically to both the admin and the customer "My Orders" dashboard.
//
// Triggered two ways:
//   • Vercel Cron (see vercel.json) on a schedule.
//   • The admin "Sync tracking" button (x-admin-key header), for on-demand runs.

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

import { roleFromReq } from './_lib/adminRole.js'

const CRON_SECRET = process.env.CRON_SECRET

function authorized(req) {
  // Admin button — owner or staff login both work
  if (roleFromReq(req)) return true
  // Vercel Cron with a configured secret
  if (CRON_SECRET && req.headers['authorization'] === `Bearer ${CRON_SECRET}`) return true
  // Vercel Cron when no secret is set (Vercel stamps this header on cron calls)
  if (!CRON_SECRET && req.headers['x-vercel-cron']) return true
  return false
}

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  // In-flight orders that don't have tracking yet. select('*') so missing
  // backlink columns (printify_order_id/shopify_order_id) degrade gracefully
  // instead of erroring the whole query.
  const { data: orders, error } = await supabase
    .from('orders')
    .select('*')
    .in('status', ['new', 'processing'])
    .is('tracking_number', null)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return res.status(500).json({ error: error.message })

  let updated = 0
  const details = []

  for (const o of orders || []) {
    let tracking = null
    try {
      if (o.printify_order_id && printifyEnabled()) {
        tracking = printifyTrackingFrom(await getPrintifyOrder(o.printify_order_id))
      } else if (o.shopify_order_id && shopifyAdminEnabled()) {
        tracking = await getShopifyOrderTracking(o.shopify_order_id)
      } else {
        continue // no provider backlink to look up (e.g. Fulfill Engine order)
      }
    } catch (err) {
      details.push({ id: o.id, error: err.message })
      continue
    }

    if (tracking?.number) {
      const { error: upErr } = await supabase
        .from('orders')
        .update({
          tracking_number: tracking.number,
          tracking_url: tracking.url || null,
          status: 'shipped',
        })
        .eq('id', o.id)
      if (upErr) details.push({ id: o.id, error: upErr.message })
      else { updated++; details.push({ id: o.id, tracking: tracking.number }) }
    }
  }

  return res.status(200).json({ ok: true, scanned: orders?.length || 0, updated, details })
}
