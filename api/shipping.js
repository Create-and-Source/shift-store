import { computeCartShipping } from './_lib/shipping.js'

// Public shipping quote for a cart — the checkout page shows this before
// payment, and create-checkout recomputes the same quote server-side when the
// session is created. Always 200; `shipping: null` means "couldn't quote" so
// the UI can fall back to "calculated at payment".
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  try {
    const { items = [] } = req.body || {}
    if (!Array.isArray(items) || !items.length) {
      return res.status(200).json({ shipping: null, legs: [] })
    }
    const quote = await computeCartShipping(items)
    return res.status(200).json({ shipping: quote.total, legs: quote.legs })
  } catch (err) {
    console.error('Shipping quote error:', err.message)
    return res.status(200).json({ shipping: null, error: err.message })
  }
}
