import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

// Shared bits for the tracking webhooks + poller.

export const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Read a raw request body (webhooks need the exact bytes for HMAC).
export async function readRawBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

// Verify an HMAC signature. `encoding` is how the provider encodes the digest
// ('base64' for Shopify, 'hex' for Printify). Returns true when it matches.
// If no secret is configured we return null → "unverified, caller decides".
export function verifyHmac({ raw, signature, secret, encoding = 'hex' }) {
  if (!secret) return null
  if (!signature) return false
  const digest = crypto.createHmac('sha256', secret).update(raw).digest(encoding)
  const a = Buffer.from(digest)
  const b = Buffer.from(String(signature))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// Write tracking onto the order matched by `column = value` (e.g.
// printify_order_id / shopify_order_id). No-ops if already has this tracking.
// Returns { orderId } on success, or { skipped } / { error }.
export async function saveTrackingByColumn(column, value, tracking) {
  if (!value || !tracking?.number) return { skipped: 'missing value or tracking' }
  const { data: order, error } = await supabaseAdmin
    .from('orders')
    .select('id, tracking_number, status')
    .eq(column, value)
    .maybeSingle()
  if (error) return { error: error.message }
  if (!order) return { skipped: 'no matching order' }
  if (order.tracking_number === tracking.number) return { orderId: order.id, unchanged: true }

  const { error: upErr } = await supabaseAdmin
    .from('orders')
    .update({
      tracking_number: tracking.number,
      tracking_url: tracking.url || null,
      status: order.status === 'delivered' || order.status === 'cancelled' ? order.status : 'shipped',
    })
    .eq('id', order.id)
  if (upErr) return { error: upErr.message }
  return { orderId: order.id }
}
