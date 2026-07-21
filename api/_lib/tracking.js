import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { sendShippedEmailOnce } from './email.js'

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

// The `token` query param off the callback URL (set at webhook registration).
// Robust regardless of body parsing / provider signing quirks.
export function tokenFromUrl(req) {
  try { return new URL(req.url, 'http://x').searchParams.get('token') } catch { return null }
}

// Combined webhook auth. When `secret` is set, require EITHER a matching
// ?token= on the URL OR a valid HMAC signature; otherwise (no secret) allow.
export function webhookAuthorized({ req, raw, secret, signature, encoding }) {
  if (!secret) return true // unconfigured → accept (documented, lower security)
  if (tokenFromUrl(req) === secret) return true
  return verifyHmac({ raw, signature, secret, encoding }) === true
}

// Write tracking (and/or advance status) onto the order matched by
// `column = value` (e.g. printify_order_id / shopify_order_id).
//   targetStatus 'shipped'   → set shipped if still new/processing
//   targetStatus 'delivered' → set delivered (carrier confirmed delivery)
// Never downgrades a delivered/cancelled order. Applies a status change even
// when the tracking number is unchanged (so a delivery event still lands).
// Returns { orderId, ...updates } on success, or { skipped } / { error }.
export async function saveTrackingByColumn(column, value, tracking, targetStatus = 'shipped') {
  if (!value) return { skipped: 'missing match value' }
  const { data: order, error } = await supabaseAdmin
    .from('orders')
    .select('id, tracking_number, status')
    .eq(column, value)
    .maybeSingle()
  if (error) return { error: error.message }
  if (!order) return { skipped: 'no matching order' }

  const updates = {}
  if (tracking?.number && tracking.number !== order.tracking_number) {
    updates.tracking_number = tracking.number
    updates.tracking_url = tracking.url || null
  }
  // Status progression — never move backward past a delivered/cancelled order.
  const locked = order.status === 'delivered' || order.status === 'cancelled'
  if (!locked) {
    if (targetStatus === 'delivered') updates.status = 'delivered'
    else if (order.status !== 'shipped') updates.status = 'shipped'
  }

  if (Object.keys(updates).length === 0) return { orderId: order.id, unchanged: true }

  const { error: upErr } = await supabaseAdmin.from('orders').update(updates).eq('id', order.id)
  if (upErr) return { error: upErr.message }
  if (updates.tracking_number) await sendShippedEmailOnce(order.id)
  return { orderId: order.id, ...updates }
}
