import { shopifyEnabled, listShopifyProducts, mapShopifyProduct } from '../_lib/shopify.js'

// Storefront endpoint: returns the Shopify catalog mapped into the same
// product shape the UI uses for Fulfill Engine + Printify products. Always
// returns 200 with a (possibly empty) products array so it can never break
// the storefront — if Shopify is unconfigured or errors, the store just shows
// its other catalogs as before.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!shopifyEnabled()) {
    return res.status(200).json({ products: [], enabled: false })
  }

  try {
    const raw = await listShopifyProducts()
    const products = raw.map(mapShopifyProduct)
    return res.status(200).json({ products, enabled: true })
  } catch (err) {
    console.error('Shopify products error:', err.status, err.message)
    return res.status(200).json({ products: [], enabled: true, error: err.message })
  }
}
