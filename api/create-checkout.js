import Stripe from 'stripe'
import { feEnabled, feAvailability, comboKey } from './_lib/fulfillengine.js'
import { getOwnerPrices } from './_lib/adminRole.js'
import { computeCartShipping } from './_lib/shipping.js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  httpClient: Stripe.createFetchHttpClient(),
})

// ── Stripe Connect split (Option A, 2026-07-21) ──────────────────────────
// The Shift Apparel LLC account stays merchant of record; the session is
// created ON it THROUGH Tovah's platform account, carrying an
// application_fee_amount = the C&S share (items at owner price + shipping —
// the exact settlement-panel formula). Stripe routes that fee to the platform
// before the partner is paid anything. Inert until STRIPE_PLATFORM_KEY is set
// AND the LLC account has authorized the platform; any Connect failure falls
// back to the direct legacy path — checkout must never break over the split.
const CONNECT_ACCOUNT = process.env.STRIPE_CONNECT_ACCOUNT || 'acct_1TvRRgFUHp82gpm3'
const PLATFORM_KEY = process.env.STRIPE_PLATFORM_KEY || ''
const platformStripe = PLATFORM_KEY
  ? new Stripe(PLATFORM_KEY, { httpClient: Stripe.createFetchHttpClient() })
  : null

// C&S share of this cart in cents: per item owner price ?? true source cost
// (the owner-key feeds are unmasked), plus the shipping the customer pays —
// mirrors the Friday settlement formula. Unknown items contribute 0 (they'll
// surface as settlement drift rather than overcharging the partner).
async function csShareCents(items, shippingCost, host) {
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
  let share = shippingCost
  for (const it of items) {
    const perUnit = ownerPrices?.[it.productId] ?? costs[it.productId] ?? 0
    share += Number(perUnit) * (it.qty || 1)
  }
  return Math.max(0, Math.round(share * 100))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { items, customerEmail } = req.body

    if (!items || !items.length) {
      return res.status(400).json({ error: 'No items provided' })
    }

    // Sold-out guard for Fulfill Engine items — the storefront greys these
    // out, but a stale page (or a race) can still submit one, and FE accepts
    // orders for out-of-stock blanks and silently parks them. Fail-open: an
    // FE error skips the guard rather than blocking checkout.
    try {
      const feItems = items.filter(i => i.source === 'fulfillengine')
      if (feItems.length && feEnabled()) {
        const availability = await feAvailability(feItems.map(i => i.productId))
        const soldOut = feItems.filter(i =>
          (availability[i.productId]?.unavailableKeys || []).includes(comboKey(i.color, i.size))
        )
        if (soldOut.length) {
          return res.status(409).json({
            error: 'sold_out',
            soldOut: soldOut.map(i => ({ name: i.name, color: i.color, size: i.size })),
            message: `Just sold out: ${soldOut
              .map(i => [i.name, [i.color, i.size].filter(Boolean).join(' / ')].filter(Boolean).join(' — '))
              .join('; ')}. Remove it from your cart to continue.`,
          })
        }
      }
    } catch (stockErr) {
      console.error('Checkout stock guard skipped (fail-open):', stockErr.message)
    }

    const lineItems = items.map(item => {
      const productData = { name: item.name }
      const desc = [item.color, item.size].filter(Boolean).join(' / ')
      if (desc) productData.description = desc
      if (item.image) {
        productData.images = [item.image]
      }
      return {
        price_data: {
          currency: 'usd',
          product_data: productData,
          unit_amount: Math.round(item.price * 100),
        },
        quantity: item.qty,
      }
    })

    // Authoritative shipping, computed server-side (never trust the client):
    // one leg per supplier — live Printify rate + admin-set rate tables for
    // Fulfill Engine / Shopify (no quote APIs). Same quote the checkout page
    // showed via /api/shipping. Falls back to flat per-leg on total failure
    // so checkout is never blocked.
    let shippingCost = 0
    try {
      const quote = await computeCartShipping(items)
      shippingCost = quote.total
    } catch (err) {
      console.error('Shipping quote failed — flat per-leg fallback:', err.message)
      shippingCost = new Set(items.map(i => i.source || 'other')).size * 10
    }
    if (shippingCost <= 0) shippingCost = 10 // safety net

    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: { name: 'Shipping' },
        unit_amount: Math.round(shippingCost * 100),
      },
      quantity: 1,
    })

    const origin = req.headers.origin || 'https://shift-store.vercel.app'

    // Printify fulfillment routing — carried in metadata so the webhook can
    // submit an order to Printify. Only Printify line items are included, and
    // because the payload can exceed Stripe's 500-char-per-key metadata limit
    // it is chunked across pf0..pfN keys (pfn = chunk count). This is purely
    // additive: itemsJson (used for the Supabase order) is unchanged.
    const printifyRoute = items
      .filter(i => i.source === 'printify' && i.printifyProductId && i.printifyVariantId)
      .map(i => ({ pp: i.printifyProductId, pv: i.printifyVariantId, q: i.qty }))

    const printifyMeta = {}
    if (printifyRoute.length) {
      const routeStr = JSON.stringify(printifyRoute)
      const chunks = []
      for (let i = 0; i < routeStr.length; i += 480) chunks.push(routeStr.slice(i, i + 480))
      printifyMeta.pfn = String(chunks.length)
      chunks.forEach((c, idx) => { printifyMeta[`pf${idx}`] = c })
    }

    // Shopify fulfillment routing — the webhook creates a paid order in the
    // Shopify admin for these items. `printifyVariantId` carries the source's
    // variant id generically (a Shopify variant gid for Shopify items).
    const shopifyRoute = items
      .filter(i => i.source === 'shopify' && i.printifyVariantId)
      .map(i => ({ v: i.printifyVariantId, q: i.qty }))

    const shopifyMeta = {}
    if (shopifyRoute.length) {
      const routeStr = JSON.stringify(shopifyRoute)
      const chunks = []
      for (let i = 0; i < routeStr.length; i += 480) chunks.push(routeStr.slice(i, i + 480))
      shopifyMeta.sfn = String(chunks.length)
      chunks.forEach((c, idx) => { shopifyMeta[`sf${idx}`] = c })
    }

    const sessionParams = {
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      shipping_address_collection: { allowed_countries: ['US'] },
      phone_number_collection: { enabled: true },
      ...(customerEmail ? { customer_email: customerEmail } : {}),
      success_url: `${origin}/order-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/checkout`,
      metadata: {
        store: 'shift',
        itemsJson: JSON.stringify(
          items.map(i => ({
            id: i.productId,
            q: i.qty,
            c: i.color,
            s: i.size,
            n: i.name,
          }))
        ).substring(0, 500),
        ...printifyMeta,
        ...shopifyMeta,
      },
    }

    // Connect path: same merchant, C&S share skimmed as the platform fee.
    if (platformStripe) {
      try {
        const totalCents = lineItems.reduce((s, li) => s + li.price_data.unit_amount * li.quantity, 0)
        const fee = Math.min(
          await csShareCents(items, shippingCost, req.headers.host),
          totalCents
        )
        const session = await platformStripe.checkout.sessions.create(
          { ...sessionParams, payment_intent_data: { application_fee_amount: fee } },
          { stripeAccount: CONNECT_ACCOUNT }
        )
        return res.status(200).json({ url: session.url, sessionId: session.id })
      } catch (connectErr) {
        console.error('Connect checkout failed — falling back to direct:', connectErr.message)
      }
    }

    const session = await stripe.checkout.sessions.create(sessionParams)

    return res.status(200).json({ url: session.url, sessionId: session.id })
  } catch (err) {
    console.error('Checkout error:', err.type, err.message)
    return res.status(500).json({ error: err.message || 'Something went wrong' })
  }
}
