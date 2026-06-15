import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  httpClient: Stripe.createFetchHttpClient(),
})

const FE_API_KEY = process.env.FULFILL_ENGINE_API_KEY
const FE_ACCOUNT_ID = 'act-9679744'
const FE_CAMPAIGN_ID = 'b1e7b585-569d-4b88-ad27-4ce43ffcbb91'

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

async function submitFEOrder(items, shippingAddress, customerEmail, sessionId) {
  const orderItemGroups = items.map(item => ({
    catalogProductId: item.id,
    productColor: item.c || '',
    productSize: item.s || '',
    quantity: item.q,
  }))

  const payload = {
    campaignId: FE_CAMPAIGN_ID,
    customerEmailAddress: customerEmail,
    customId: `SHIFT-${sessionId.slice(-8)}`,
    orderItemGroups,
    shipments: [{
      shippingAddress: {
        name: shippingAddress.name || '',
        addressLine1: shippingAddress.line1 || '',
        addressLine2: shippingAddress.line2 || '',
        city: shippingAddress.city || '',
        state: shippingAddress.state || '',
        postalCode: shippingAddress.postal_code || '',
        country: shippingAddress.country || 'US',
      },
      shippingTier: 'economy',
      confirmationEmailAddress: customerEmail,
    }],
  }

  const res = await fetch(`https://api.fulfillengine.com/api/accounts/${FE_ACCOUNT_ID}/orders`, {
    method: 'POST',
    headers: {
      'X-API-KEY': FE_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { raw: text } }

  console.log(`FE order submit: ${res.status}`, JSON.stringify(data))
  return { success: res.ok, status: res.status, data }
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

    let orderItems = []
    try {
      orderItems = JSON.parse(session.metadata?.itemsJson || '[]')
    } catch {}

    const shippingDetails = session.shipping_details || session.shipping || {}
    const shippingAddress = shippingDetails.address || {}
    shippingAddress.name = shippingDetails.name || session.customer_details?.name || ''

    const customerEmail = session.customer_details?.email || ''

    try {
      const result = await submitFEOrder(orderItems, shippingAddress, customerEmail, session.id)
      console.log('FE fulfillment result:', JSON.stringify(result))
    } catch (err) {
      console.error('FE fulfillment error:', err.message)
    }
  }

  return res.status(200).json({ received: true })
}
