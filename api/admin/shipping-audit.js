import { roleFromReq } from '../_lib/adminRole.js'
import { feEnabled, feShippingActuals } from '../_lib/fulfillengine.js'

// Owner-only: what Fulfill Engine actually charged per order (from their
// invoices API — item cost + pick&pack + shipping, keyed by our order uuid).
// Powers the "FE actuals" table on /dashadmin → Shipping so the rate table is
// set from real bills, not guesses.
export default async function handler(req, res) {
  if (roleFromReq(req) !== 'owner') return res.status(401).json({ error: 'Unauthorized' })
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  if (!feEnabled()) return res.status(200).json({ enabled: false, invoices: [], orders: [] })

  try {
    const { invoices, orders } = await feShippingActuals()
    return res.status(200).json({ enabled: true, invoices, orders })
  } catch (err) {
    console.error('FE shipping audit error:', err.message, err.body)
    return res.status(200).json({ enabled: true, error: err.message, detail: err.body })
  }
}
