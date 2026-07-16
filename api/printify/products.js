import { printifyEnabled, listPrintifyProducts, mapPrintifyProduct } from '../_lib/printify.js'
import { maskCosts } from '../_lib/adminRole.js'

// Public storefront endpoint: returns the Printify catalog mapped into the
// same product shape the UI uses for Fulfill Engine products. Always returns
// 200 with a (possibly empty) products array so it can never break the
// storefront — if Printify is unconfigured or errors, the store just shows
// the Fulfill Engine catalog as before.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!printifyEnabled()) {
    return res.status(200).json({ products: [], enabled: false })
  }

  try {
    const raw = await listPrintifyProducts()
    const products = raw
      .filter(p => p.visible !== false)
      .map(mapPrintifyProduct)
      .filter(p => p.sizes.length > 0 || p.colors.length > 0)
    return res.status(200).json({ products: await maskCosts(products, req), enabled: true })
  } catch (err) {
    console.error('Printify products error:', err.status, err.message)
    return res.status(200).json({ products: [], enabled: true, error: err.message })
  }
}
