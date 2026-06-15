// Fetch products from Fulfill Engine public storefront API
const FE_STORE_SLUG = 'shift'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const response = await fetch(
      `https://api.fulfillengine.com/shop/campaigns/${FE_STORE_SLUG}`,
      { headers: { 'Accept': 'application/json' } }
    )

    if (!response.ok) {
      const text = await response.text()
      console.error('FE API error:', response.status, text)
      return res.status(502).json({ error: `Fulfill Engine returned ${response.status}` })
    }

    const data = await response.json()
    const feProducts = data.products || []
    const categories = data.productCategories || []

    const products = feProducts.map(p => {
      const colorOption = p.options?.find(o => o.name === 'Color') || {}
      const sizeOption = p.options?.find(o => o.name === 'Size') || {}

      const colors = (colorOption.optionValues || []).map(v => ({
        name: v.name,
        hex: v.images?.[0]?.hexCode || '#000000',
        images: (v.images || []).map(img => ({
          url: img.url,
          zoom: img.zoomUrl,
          thumbnail: img.thumbnailUrl,
          type: img.imageType,
        })),
      }))

      const sizes = (sizeOption.optionValues || []).map(v => ({
        name: v.name,
        surcharge: v.surcharge || 0,
      }))

      return {
        id: p.id,
        name: p.name,
        description: p.description || '',
        price: p.defaultPrice || p.salesBasePrice || 0,
        basePrice: p.salesBasePrice || 0,
        colors,
        sizes,
        image: colors[0]?.images?.[0]?.url || '',
        specUrl: p.productSpecificationsUrl || '',
      }
    })

    return res.status(200).json({ products, categories })
  } catch (err) {
    console.error('Products fetch error:', err)
    return res.status(500).json({ error: 'Failed to fetch products' })
  }
}
