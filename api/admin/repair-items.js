import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { roleFromReq, getOwnerPrices } from '../_lib/adminRole.js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  httpClient: Stripe.createFetchHttpClient(),
})

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Rebuild an order's item rows from its Stripe session.
//
// The cart used to be truncated at Stripe's 500-char metadata limit, so orders
// large enough to overflow it (~5 items) landed with a blank product_id, color
// and size on every row — which silently disabled supplier routing and the
// cost snapshot. create-checkout now chunks the payload, but orders placed
// before that fix still need repairing, and Stripe kept everything we need:
// the product name on each line item and "Color / Size" in its description.
//
// Only fills fields that are currently empty — never overwrites good data.

const norm = s => String(s || '').trim().toLowerCase()

// Name -> id across all three feeds. Fetched with the owner key so `price` is
// the TRUE source cost (the same basis the webhook's snapshot uses).
async function loadCatalog(host) {
  const h = { headers: { 'x-admin-key': process.env.ADMIN_KEY || '' } }
  const base = `https://${host}`
  const [fe, printify, shopify, content] = await Promise.all([
    fetch(`${base}/api/products`, h).then(r => r.json()).catch(() => ({})),
    fetch(`${base}/api/printify/products`, h).then(r => r.json()).catch(() => ({})),
    fetch(`${base}/api/shopify/products`, h).then(r => r.json()).catch(() => ({})),
    fetch(`${base}/api/admin/content`).then(r => r.json()).catch(() => ({})),
  ])

  const byId = {}
  const byName = {}
  const add = (p, source) => {
    if (!p?.id) return
    byId[p.id] = { ...p, source }
    const n = norm(p.name)
    if (n && !byName[n]) byName[n] = p.id
  }
  for (const p of (fe.products || [])) add(p, 'fulfillengine')
  for (const p of (printify.products || [])) add(p, 'printify')
  for (const p of (shopify.products || [])) add(p, 'shopify')

  // A renamed product went into the cart under its OVERRIDE name while the
  // feeds still return the original, so index both.
  for (const [pid, ov] of Object.entries(content.overrides || {})) {
    const n = norm(ov?.name)
    if (n && byId[pid] && !byName[n]) byName[n] = pid
  }
  return { byId, byName }
}

// Pull the real colorway/size out of Stripe's "Color / Size" description by
// matching against what the product actually offers — splitting on "/" breaks
// on colorways like "Black / White".
function resolveVariant(product, desc) {
  const d = norm(desc)
  if (!d) return { color: '', size: '' }
  const pick = list => (list || [])
    .map(v => v?.name)
    .filter(Boolean)
    .filter(name => d.includes(norm(name)))
    .sort((a, b) => b.length - a.length)[0] || ''

  let color = pick(product?.colors)
  let size = pick(product?.sizes)

  // Fall back to positional parsing when the catalog no longer lists the
  // variant that was bought (discontinued colorway, renamed size).
  if (!color && !size) {
    const parts = String(desc).split(' / ').map(s => s.trim()).filter(Boolean)
    if (parts.length >= 2) { color = parts[0]; size = parts[parts.length - 1] }
    else if (parts.length === 1) { size = parts[0] }
  }
  return { color, size }
}

export default async function handler(req, res) {
  const role = roleFromReq(req)
  if (!role) return res.status(401).json({ error: 'Unauthorized' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { orderId, apply = false } = req.body || {}
  if (!orderId) return res.status(400).json({ error: 'orderId required' })

  const { data: order, error: findErr } = await supabase
    .from('orders')
    .select('id, stripe_session_id, items:order_items(*)')
    .eq('id', orderId)
    .single()
  if (findErr || !order) return res.status(404).json({ error: 'Order not found' })
  if (!order.stripe_session_id) {
    return res.status(400).json({ error: 'This order has no Stripe session on file, so there is nothing to rebuild from.' })
  }

  let lineItems
  try {
    const resp = await stripe.checkout.sessions.listLineItems(order.stripe_session_id, {
      limit: 100,
      expand: ['data.price.product'],
    })
    lineItems = (resp.data || []).filter(li => (li.description || '') !== 'Shipping')
  } catch (err) {
    return res.status(502).json({ error: `Could not read the Stripe session: ${err.message}` })
  }
  if (!lineItems.length) return res.status(400).json({ error: 'The Stripe session has no line items.' })

  const { byId, byName } = await loadCatalog(req.headers.host)
  const ownerPrices = await getOwnerPrices().catch(() => ({}))

  // Pair each Stripe line item with its order row: by name + quantity first,
  // then by position for anything left over.
  const rows = [...(order.items || [])]
  const used = new Set()
  const plan = []

  for (const li of lineItems) {
    const name = li.price?.product?.name || li.description || ''
    const qty = li.quantity || 1
    let row = rows.find(r => !used.has(r.id) && norm(r.product_name) === norm(name) && (r.quantity || 1) === qty)
    if (!row) row = rows.find(r => !used.has(r.id) && norm(r.product_name) === norm(name))
    if (!row) row = rows.find(r => !used.has(r.id))
    if (!row) continue
    used.add(row.id)

    const productId = byName[norm(name)] || ''
    const product = productId ? byId[productId] : null
    const { color, size } = resolveVariant(product, li.price?.product?.description || '')

    const patch = {}
    if (!row.product_id && productId) patch.product_id = productId
    if (!row.color && color) patch.color = color
    if (!row.size && size) patch.size = size
    if (row.cost == null && product?.price != null) patch.cost = Number(product.price)
    if (row.owner_price == null && productId && ownerPrices?.[productId] != null) {
      patch.owner_price = Number(ownerPrices[productId])
    }

    plan.push({
      rowId: row.id,
      name,
      matched: !!productId,
      source: product?.source || null,
      color: patch.color ?? row.color ?? '',
      size: patch.size ?? row.size ?? '',
      // Never echo money back — staff must not see the private cost layer.
      costRestored: patch.cost != null,
      fields: Object.keys(patch),
      patch,
    })
  }

  const unmatched = plan.filter(p => !p.matched).map(p => p.name)
  const changes = plan.filter(p => p.fields.length)

  if (!apply) {
    return res.status(200).json({
      dryRun: true,
      items: plan.map(({ patch, rowId, ...rest }) => rest),
      wouldUpdate: changes.length,
      unmatched,
    })
  }

  let updated = 0
  const failures = []
  for (const p of changes) {
    const { error } = await supabase.from('order_items').update(p.patch).eq('id', p.rowId)
    if (error) failures.push(`${p.name}: ${error.message}`)
    else updated++
  }

  return res.status(200).json({
    ok: true,
    updated,
    unmatched,
    failures,
    message: updated
      ? `Repaired ${updated} item${updated === 1 ? '' : 's'}${unmatched.length ? ` — ${unmatched.length} could not be matched to a product` : ''}. Now send the order to its supplier.`
      : 'Nothing needed repairing on this order.',
  })
}
