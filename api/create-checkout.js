import Stripe from 'stripe'
import { printifyEnabled, getPrintifyStandardShipping } from './_lib/printify.js'
import { feEnabled, feAvailability, comboKey } from './_lib/fulfillengine.js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  httpClient: Stripe.createFetchHttpClient(),
})

// Flat shipping for non-Printify (Fulfill Engine / static) items.
const FLAT_SHIPPING = 10

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { items, shipping = 0, customerEmail } = req.body

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
    // live Printify rate for Printify items + a flat rate for any items from
    // other providers (they ship as a separate parcel). Falls back to flat on
    // any Printify error so checkout is never blocked.
    const flatBase = typeof shipping === 'number' && shipping > 0 ? shipping : FLAT_SHIPPING
    const printifyLineItems = items
      .filter(i => i.source === 'printify' && i.printifyProductId && i.printifyVariantId)
      .map(i => ({ product_id: i.printifyProductId, variant_id: Number(i.printifyVariantId), quantity: i.qty }))
    const hasOther = items.some(i => (i.source || 'static') !== 'printify')

    let shippingCost = 0
    if (printifyLineItems.length && printifyEnabled()) {
      try {
        const pfShip = await getPrintifyStandardShipping(printifyLineItems)
        shippingCost += pfShip != null ? pfShip : flatBase
      } catch (err) {
        console.error('Printify shipping calc failed, using flat:', err.message)
        shippingCost += flatBase
      }
    }
    if (hasOther) shippingCost += flatBase
    if (shippingCost <= 0) shippingCost = flatBase // safety net

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

    const session = await stripe.checkout.sessions.create({
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
    })

    return res.status(200).json({ url: session.url, sessionId: session.id })
  } catch (err) {
    console.error('Checkout error:', err.type, err.message)
    return res.status(500).json({ error: err.message || 'Something went wrong' })
  }
}
