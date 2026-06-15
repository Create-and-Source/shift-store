import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  httpClient: Stripe.createFetchHttpClient(),
})

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { items, shipping = 0 } = req.body

    if (!items || !items.length) {
      return res.status(400).json({ error: 'No items provided' })
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

    if (shipping > 0) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: 'Shipping' },
          unit_amount: Math.round(shipping * 100),
        },
        quantity: 1,
      })
    }

    const origin = req.headers.origin || 'https://shift-store.vercel.app'

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      shipping_address_collection: { allowed_countries: ['US'] },
      success_url: `${origin}/order-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/shop`,
      metadata: {
        itemsJson: JSON.stringify(
          items.map(i => ({
            id: i.productId,
            q: i.qty,
            c: i.color,
            s: i.size,
            n: i.name,
          }))
        ).substring(0, 500),
      },
    })

    return res.status(200).json({ url: session.url, sessionId: session.id })
  } catch (err) {
    console.error('Checkout error:', err.type, err.message)
    return res.status(500).json({ error: err.message || 'Something went wrong' })
  }
}
