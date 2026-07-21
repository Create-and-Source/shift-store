// Storefront availability for Fulfill Engine items. The public shop feed has
// no stock data, so this merges FE's catalog-blank inventory (per color/size)
// for the store's FE products. Role-independent and public-safe (colors/sizes
// are already public), so the CDN caches it. Fail-open by design: on any FE
// error the store just sells everything and the checkout guard is the backstop.
import { feEnabled, feAvailability } from './_lib/fulfillengine.js'

const FE_STORE_SLUG = 'shift'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    if (!feEnabled()) {
      res.setHeader('Cache-Control', 's-maxage=60')
      return res.status(200).json({ stock: {}, degraded: true })
    }

    const feed = await fetch(
      `https://api.fulfillengine.com/shop/campaigns/${FE_STORE_SLUG}`,
      { headers: { Accept: 'application/json' } }
    ).then(r => r.json())

    const availability = await feAvailability((feed.products || []).map(p => p.id))

    // ?debug=1 additionally returns every combo with its availability —
    // for eyeballing that FE's option names line up with the shop feed's.
    const debug = req.query.debug === '1'
    const stock = {}
    for (const [id, a] of Object.entries(availability)) {
      stock[id] = debug ? a : { unavailable: a.unavailable, unavailableKeys: a.unavailableKeys }
    }

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600')
    return res.status(200).json({ stock, checkedAt: new Date().toISOString() })
  } catch (err) {
    console.error('Stock fetch failed (fail-open):', err.message, JSON.stringify(err.body || '').slice(0, 300))
    res.setHeader('Cache-Control', 's-maxage=60')
    return res.status(200).json({ stock: {}, degraded: true })
  }
}
