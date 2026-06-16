import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

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

  // Create customer record
  const { data: customer, error } = await supabase
    .from('customers')
    .insert({
      email,
      name: name || '',
      auth_id: authUser?.user?.id || null,
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

    const shippingDetails = session.shipping_details || session.shipping || {}
    const shippingAddress = shippingDetails.address || {}
    shippingAddress.name = shippingDetails.name || session.customer_details?.name || ''

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

    // Create order items
    const orderItemRows = items.map(item => ({
      order_id: order.id,
      product_id: item.productId,
      product_name: item.name,
      color: item.color,
      size: item.size,
      quantity: item.qty,
      unit_price: item.price,
    }))

    const { error: itemsErr } = await supabase
      .from('order_items')
      .insert(orderItemRows)

    if (itemsErr) {
      console.error('Order items error:', itemsErr)
    }

    console.log('Order created:', order.id, 'for', customerEmail)
  }

  return res.status(200).json({ received: true })
}
