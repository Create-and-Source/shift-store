import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import {
  printifyEnabled,
  createPrintifyOrder,
  sendPrintifyToProduction,
  toPrintifyAddress,
} from './_lib/printify.js'
import { shopifyAdminEnabled, createShopifyOrder } from './_lib/shopify.js'
import { getOwnerPrices } from './_lib/adminRole.js'
import { feEnabled, createFEOrder } from './_lib/fulfillengine.js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  httpClient: Stripe.createFetchHttpClient(),
})

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const config = {
  api: { bodyParser: false },
}

async function buffer(readable) {
  const chunks = []
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

async function getOrCreateCustomer(email, name) {
  // Check if customer exists
  const { data: existing } = await supabase
    .from('customers')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (existing) return existing.id

  // Create auth user (for customer portal login)
  const tempPassword = crypto.randomUUID().slice(0, 16)
  const { data: authUser } = await supabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  })
  let authId = authUser?.user?.id || null

  // Buyer may have signed up through the portal BEFORE their first purchase —
  // createUser fails on the existing email, so find that account and link it,
  // or their orders would never show up in the portal.
  if (!authId) {
    const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
    authId = (list?.users || []).find(u => (u.email || '').toLowerCase() === email.toLowerCase())?.id || null
  }

  // Create customer record
  const { data: customer, error } = await supabase
    .from('customers')
    .insert({
      email,
      name: name || '',
      auth_id: authId,
    })
    .select('id')
    .single()

  if (error) {
    console.error('Customer creation error:', error)
    // If unique constraint, customer was just created by another request
    const { data: retry } = await supabase
      .from('customers')
      .select('id')
      .eq('email', email)
      .maybeSingle()
    return retry?.id || null
  }

  return customer.id
}

// Purchase-time cost snapshot: true source cost per product (via our own feeds
// with the owner key — unmasked) + the owner's private price layer. Stamped
// onto order_items so profit reports stay exact no matter how catalog prices
// drift later. Best-effort: on any failure the columns stay null and the admin
// falls back to live catalog costs for that order.
async function costSnapshot(host) {
  const h = { headers: { 'x-admin-key': process.env.ADMIN_KEY || '' } }
  const base = `https://${host}`
  const [a, b, c, ownerPrices] = await Promise.all([
    fetch(`${base}/api/products`, h).then(r => r.json()).catch(() => ({})),
    fetch(`${base}/api/printify/products`, h).then(r => r.json()).catch(() => ({})),
    fetch(`${base}/api/shopify/products`, h).then(r => r.json()).catch(() => ({})),
    getOwnerPrices(),
  ])
  const costs = {}
  for (const p of [...(a.products || []), ...(b.products || []), ...(c.products || [])]) {
    if (p?.id != null && p.price != null) costs[p.id] = Number(p.price)
  }
  // Which product ids belong to Fulfill Engine — drives FE order routing.
  const feIds = new Set((a.products || []).map(p => p.id))
  return { costs, ownerPrices, feIds }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET

  let event
  const buf = await buffer(req)

  if (endpointSecret) {
    const sig = req.headers['stripe-signature']
    try {
      event = stripe.webhooks.constructEvent(buf, sig, endpointSecret)
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message)
      return res.status(400).json({ error: 'Invalid signature' })
    }
  } else {
    event = JSON.parse(buf.toString())
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object

    // Only process Shift store checkouts
    if (session.metadata?.store !== 'shift') {
      console.log('Ignoring non-Shift checkout:', session.id)
      return res.status(200).json({ received: true, skipped: true })
    }

    // Idempotency check
    const { data: existingOrder } = await supabase
      .from('orders')
      .select('id')
      .eq('stripe_session_id', session.id)
      .maybeSingle()

    if (existingOrder) {
      console.log('Duplicate webhook — order exists:', existingOrder.id)
      return res.status(200).json({ received: true, duplicate: true })
    }

    let orderItems = []
    try {
      orderItems = JSON.parse(session.metadata?.itemsJson || '[]')
    } catch {}

    // Get line items from Stripe for full details
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id)
    const items = lineItems.data
      .filter(li => li.description !== 'Shipping')
      .map((li, idx) => ({
        productId: orderItems[idx]?.id || '',
        name: orderItems[idx]?.n || li.description,
        qty: li.quantity,
        price: li.amount_total / 100 / li.quantity,
        color: orderItems[idx]?.c || '',
        size: orderItems[idx]?.s || '',
      }))

    // Newer Stripe API versions moved shipping onto collected_information —
    // the legacy top-level fields are checked as fallbacks for old sessions.
    const shippingDetails = session.collected_information?.shipping_details
      || session.shipping_details || session.shipping || {}
    const shippingAddress = shippingDetails.address || {}
    shippingAddress.name = shippingDetails.name || session.customer_details?.name || ''
    if (session.customer_details?.phone) shippingAddress.phone = session.customer_details.phone

    const customerEmail = session.customer_details?.email || ''
    const customerName = session.customer_details?.name || ''

    // Get or create customer
    const customerId = await getOrCreateCustomer(customerEmail, customerName)

    const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0)
    const total = session.amount_total / 100

    // Create order
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        customer_id: customerId,
        stripe_session_id: session.id,
        stripe_payment_intent: session.payment_intent,
        status: 'new',
        subtotal,
        shipping_cost: total - subtotal,
        total,
        shipping_address: shippingAddress,
      })
      .select('id')
      .single()

    if (orderErr) {
      console.error('Order creation error:', orderErr)
      return res.status(500).json({ error: 'Failed to create order' })
    }

    // Create order items, stamped with purchase-time costs
    let snap = { costs: {}, ownerPrices: {} }
    try {
      snap = await costSnapshot(req.headers.host)
    } catch (snapErr) {
      console.error('Cost snapshot failed (non-fatal):', snapErr.message)
    }

    const orderItemRows = items.map(item => ({
      order_id: order.id,
      product_id: item.productId,
      product_name: item.name,
      color: item.color,
      size: item.size,
      quantity: item.qty,
      unit_price: item.price,
      cost: snap.costs[item.productId] ?? null,
      owner_price: snap.ownerPrices[item.productId] ?? null,
    }))

    let { error: itemsErr } = await supabase
      .from('order_items')
      .insert(orderItemRows)

    // If the snapshot columns don't exist yet (migration not run), never lose
    // the items — retry without them.
    if (itemsErr) {
      console.error('Order items error (retrying bare):', itemsErr)
      const bare = orderItemRows.map(({ cost, owner_price, ...r }) => r)
      const { error: retryErr } = await supabase.from('order_items').insert(bare)
      if (retryErr) console.error('Order items error:', retryErr)
    }

    console.log('Order created:', order.id, 'for', customerEmail)

    // ─── Printify fulfillment ───────────────────────────────────────────
    // Reassemble the chunked routing (pf0..pfN) set by create-checkout and,
    // for any Printify line items, create + auto-submit the order to Printify
    // for production. Entirely best-effort: it never blocks the 200 response,
    // and no-ops when Printify is unconfigured or the cart had no Printify
    // items — so Fulfill Engine / static orders are unaffected.
    try {
      let printifyRoute = []
      const chunkCount = parseInt(session.metadata?.pfn || '0', 10)
      if (chunkCount > 0) {
        let routeStr = ''
        for (let i = 0; i < chunkCount; i++) routeStr += session.metadata[`pf${i}`] || ''
        printifyRoute = JSON.parse(routeStr)
      }

      if (printifyRoute.length && printifyEnabled()) {
        const lineItems = printifyRoute.map(r => ({
          product_id: r.pp,
          variant_id: Number(r.pv),
          quantity: r.q,
        }))

        const pfOrder = await createPrintifyOrder({
          externalId: order.id,
          lineItems,
          address: toPrintifyAddress(shippingAddress, customerEmail),
        })

        await sendPrintifyToProduction(pfOrder.id)
        console.log('Printify order submitted:', pfOrder.id, 'for order', order.id)

        // Best-effort backlink; ignore if the column doesn't exist yet.
        const { error: linkErr } = await supabase
          .from('orders')
          .update({ printify_order_id: pfOrder.id })
          .eq('id', order.id)
        if (linkErr) console.error('Printify backlink (non-fatal):', linkErr.message)
      }
    } catch (pfErr) {
      console.error('Printify fulfillment failed (non-fatal):', pfErr.message, pfErr.body || '')
    }

    // ─── Shopify fulfillment ────────────────────────────────────────────
    // Reassemble the chunked routing (sf0..sfN) and, for any Shopify line
    // items, create a PAID order in the Shopify admin so it can be fulfilled
    // there. Best-effort and non-blocking; no-ops without the admin token or
    // when the cart had no Shopify items.
    try {
      let shopifyRoute = []
      const chunkCount = parseInt(session.metadata?.sfn || '0', 10)
      if (chunkCount > 0) {
        let routeStr = ''
        for (let i = 0; i < chunkCount; i++) routeStr += session.metadata[`sf${i}`] || ''
        shopifyRoute = JSON.parse(routeStr)
      }

      if (shopifyRoute.length && shopifyAdminEnabled()) {
        const lineItems = shopifyRoute.map(r => ({ variantId: r.v, quantity: r.q }))

        const shOrder = await createShopifyOrder({
          email: customerEmail,
          lineItems,
          shippingAddress,
        })

        console.log('Shopify order created:', shOrder?.id, shOrder?.name, 'for order', order.id)

        // Best-effort backlink; ignore if the column doesn't exist yet.
        const { error: linkErr } = await supabase
          .from('orders')
          .update({ shopify_order_id: shOrder?.id })
          .eq('id', order.id)
        if (linkErr) console.error('Shopify backlink (non-fatal):', linkErr.message)
      }
    } catch (shErr) {
      console.error('Shopify fulfillment failed (non-fatal):', shErr.message, shErr.body || '')
    }

    // ─── Fulfill Engine fulfillment ─────────────────────────────────────
    // FE items are identified by membership in the FE catalog (already
    // fetched for the cost snapshot). Best-effort like the others: no-ops
    // until FE_API_KEY is set, never blocks the 200.
    try {
      const feItems = items.filter(it => snap.feIds?.has(it.productId))
      if (feItems.length && feEnabled()) {
        const feOrder = await createFEOrder({
          externalId: order.id,
          items: feItems.map(it => ({
            productId: it.productId,
            color: it.color,
            size: it.size,
            qty: it.qty,
            price: it.price,
          })),
          address: shippingAddress,
          email: customerEmail,
        })
        const feId = String(feOrder?.id || feOrder?.orderId || '')
        console.log('Fulfill Engine order submitted:', feId, 'for order', order.id)

        // Best-effort backlink; ignore if the column doesn't exist yet.
        if (feId) {
          const { error: linkErr } = await supabase
            .from('orders')
            .update({ fe_order_id: feId })
            .eq('id', order.id)
          if (linkErr) console.error('FE backlink (non-fatal):', linkErr.message)
        }
      }
    } catch (feErr) {
      console.error('Fulfill Engine fulfillment failed (non-fatal):', feErr.message, JSON.stringify(feErr.body || '').slice(0, 500))
    }
  }

  return res.status(200).json({ received: true })
}
