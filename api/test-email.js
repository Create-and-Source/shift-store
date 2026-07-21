// TEMPORARY template preview — sends the order-confirmation email with sample
// items to Tovah's own inbox (hardcoded; not abusable for arbitrary sends).
// Delete this file after the test.
import { sendEmail, orderConfirmationHtml } from './_lib/email.js'

const TO = 'tovah.marx@gmail.com'

export default async function handler(req, res) {
  const items = [
    { name: 'OG Faded Black Hoodie', color: 'Faded Black', size: 'Large', qty: 1, price: 50.0 },
    { name: 'OG Racing Tee', color: 'Black Stone', size: 'Medium', qty: 2, price: 34.99 },
    { name: 'Carhartt Painter Hat', color: 'Carhartt Brown', size: 'One Size', qty: 1, price: 45.99 },
  ]
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0)
  const result = await sendEmail({
    to: TO,
    subject: 'Order confirmed — #TESTMAIL · SHIFT',
    html: orderConfirmationHtml({
      orderId: 'TESTMAIL-preview',
      items,
      subtotal,
      shipping: 10,
      total: subtotal + 10,
      address: { name: 'Test Customer', line1: '123 Example Ave', city: 'Phoenix', state: 'AZ', postal_code: '85001' },
    }),
  })
  return res.status(result.ok ? 200 : 500).json(result)
}
