// Transactional email via Resend's HTTP API, sent from the store's own
// domain (shiftapparelco.com must be Verified in Resend — Squarespace DNS,
// same one-click integration used for createandsource.com on 07-20).
// Everything no-ops until RESEND_API_KEY is set in Vercel — senders log and
// move on; email must never block an order or a tracking write.
//
// Two sends exist: order confirmation (webhook, right after the order is
// recorded) and shipped/tracking (fired from every path that writes tracking).
// Both are deduped via timestamp columns on orders (supabase-email-log.sql).
import { createClient } from '@supabase/supabase-js'

const FROM = 'SHIFT <noreply@shiftapparelco.com>'
const STORE_URL = 'https://shiftapparelco.com'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export function emailEnabled() {
  return !!process.env.RESEND_API_KEY
}

export async function sendEmail({ to, subject, html }) {
  if (!emailEnabled()) return { skipped: 'RESEND_API_KEY not set' }
  if (!to) return { skipped: 'no recipient' }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) return { error: body?.message || `Resend ${res.status}` }
  return { ok: true, id: body?.id }
}

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const money = n => `$${Number(n || 0).toFixed(2)}`

// Shared shell: white card on light grey, black masthead with the SHIFT
// wordmark, red accent. Inline styles + tables only (email-client safe).
function shell(inner) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;">
<tr><td style="background:#0a0a0a;padding:22px 32px;">
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:900;letter-spacing:0.28em;color:#ffffff;">SHIFT<span style="color:#E50000;">.</span></span>
</td></tr>
<tr><td style="padding:32px;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
${inner}
</td></tr>
<tr><td style="padding:18px 32px;border-top:1px solid #eeeeee;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#999999;">
  Life Keeps Moving — <a href="${STORE_URL}" style="color:#999999;">shiftapparelco.com</a>
</td></tr>
</table>
</td></tr></table></body></html>`
}

function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr>
<td style="background:#0a0a0a;">
  <a href="${href}" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#ffffff;text-decoration:none;">${label}</a>
</td></tr></table>`
}

function itemRows(items) {
  return (items || []).map(it => `
<tr>
  <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:13px;color:#1a1a1a;">
    <strong>${esc(it.name)}</strong><br/>
    <span style="color:#888888;font-size:12px;">${esc([it.color, it.size].filter(Boolean).join(' / '))}</span>
  </td>
  <td align="right" style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:13px;color:#1a1a1a;white-space:nowrap;">
    ${it.qty} × ${money(it.price)}
  </td>
</tr>`).join('')
}

export function orderConfirmationHtml({ orderId, items, subtotal, shipping, total, address }) {
  const addr = address || {}
  const addrLines = [addr.name, addr.line1, addr.line2, [addr.city, addr.state, addr.postal_code].filter(Boolean).join(', ')]
    .filter(Boolean).map(esc).join('<br/>')
  return shell(`
<h1 style="margin:0 0 6px;font-size:20px;font-weight:900;letter-spacing:0.04em;">Order confirmed.</h1>
<p style="margin:0 0 20px;font-size:13px;color:#555555;">Thanks for moving with us. Order <strong>#${esc(String(orderId).slice(0, 8))}</strong> is in — we'll email you again the moment it ships.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemRows(items)}</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;font-size:13px;">
<tr><td style="padding:3px 0;color:#888888;">Subtotal</td><td align="right">${money(subtotal)}</td></tr>
<tr><td style="padding:3px 0;color:#888888;">Shipping</td><td align="right">${money(shipping)}</td></tr>
<tr><td style="padding:6px 0;font-weight:900;font-size:15px;">Total</td><td align="right" style="font-weight:900;font-size:15px;">${money(total)}</td></tr>
</table>
${addrLines ? `<p style="margin:20px 0 0;font-size:12px;color:#888888;line-height:1.6;"><strong style="color:#1a1a1a;">Ships to</strong><br/>${addrLines}</p>` : ''}
${button(`${STORE_URL}/account`, 'View your order')}
<p style="margin:0;font-size:12px;color:#999999;">Track status anytime under My Orders (sign in with this email address — use "Forgot password?" to set a password if you don't have one yet).</p>`)
}

export function orderShippedHtml({ orderId, trackingNumber, trackingUrl }) {
  return shell(`
<h1 style="margin:0 0 6px;font-size:20px;font-weight:900;letter-spacing:0.04em;">It's on the way.</h1>
<p style="margin:0 0 20px;font-size:13px;color:#555555;">Order <strong>#${esc(String(orderId).slice(0, 8))}</strong> has shipped.</p>
<p style="margin:0;font-size:13px;">Tracking number<br/><strong style="font-size:15px;letter-spacing:0.04em;">${esc(trackingNumber)}</strong></p>
${trackingUrl ? button(trackingUrl, 'Track your package') : button(`${STORE_URL}/account`, 'View your order')}
<p style="margin:0;font-size:12px;color:#999999;">Carriers can take a few hours to show first movement after the label is created.</p>`)
}

// Fire the shipped email exactly once per order, from ANY path that lands
// tracking (provider webhooks, the 6h poller, manual admin entry). Reads its
// own state so callers just fire-and-forget; missing columns (migration not
// run) or a missing API key only log.
export async function sendShippedEmailOnce(orderId) {
  try {
    if (!emailEnabled() || !orderId) return
    const { data: order, error } = await supabase
      .from('orders')
      .select('id, tracking_number, tracking_url, shipped_email_at, customer:customers(email)')
      .eq('id', orderId)
      .maybeSingle()
    if (error || !order) { if (error) console.error('shipped email lookup (non-fatal):', error.message); return }
    if (!order.tracking_number || order.shipped_email_at) return
    const to = order.customer?.email
    if (!to) return
    const result = await sendEmail({
      to,
      subject: `Your SHIFT order is on the way — #${String(orderId).slice(0, 8)}`,
      html: orderShippedHtml({ orderId, trackingNumber: order.tracking_number, trackingUrl: order.tracking_url }),
    })
    if (result.error) { console.error('shipped email send (non-fatal):', result.error); return }
    if (result.ok) {
      const { error: stampErr } = await supabase
        .from('orders')
        .update({ shipped_email_at: new Date().toISOString() })
        .eq('id', orderId)
      if (stampErr) console.error('shipped email stamp (non-fatal):', stampErr.message)
      console.log('Shipped email sent:', orderId, '→', to)
    }
  } catch (e) {
    console.error('shipped email (non-fatal):', e.message)
  }
}
