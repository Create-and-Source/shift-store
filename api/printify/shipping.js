import { printifyEnabled, getPrintifyShipping, pickStandardUsd } from '../_lib/printify.js'

// Live Printify shipping rate for the Printify items in a cart. Called by the
// checkout page to display shipping before payment. Always returns 200 with
// `shipping: null` when unavailable so the UI can fall back gracefully.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { items = [], address } = req.body || {}

    const lineItems = items
      .filter(i => i.source === 'printify' && i.printifyProductId && i.printifyVariantId)
      .map(i => ({
        product_id: i.printifyProductId,
        variant_id: Number(i.printifyVariantId),
        quantity: i.qty || 1,
      }))

    if (!lineItems.length || !printifyEnabled()) {
      return res.status(200).json({ shipping: null, enabled: printifyEnabled() })
    }

    const rates = await getPrintifyShipping(lineItems, address)
    const toUsd = c => (typeof c === 'number' ? c / 100 : null)

    return res.status(200).json({
      shipping: pickStandardUsd(rates),
      methods: {
        standard: toUsd(rates?.standard),
        express: toUsd(rates?.express),
        economy: toUsd(rates?.economy),
        priority: toUsd(rates?.priority),
      },
    })
  } catch (err) {
    console.error('Printify shipping error:', err.status, err.message)
    return res.status(200).json({ shipping: null, error: err.message })
  }
}
