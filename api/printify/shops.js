import { printifyEnabled, listShops } from '../_lib/printify.js'

// Diagnostic: lists the Printify shops (sales channels) on the account so the
// correct one can be pinned via PRINTIFY_SHOP_ID. Read-only.
export default async function handler(req, res) {
  if (!printifyEnabled()) {
    return res.status(200).json({ shops: [], enabled: false })
  }
  try {
    const shops = await listShops()
    return res.status(200).json({
      shops: (shops || []).map(s => ({ id: s.id, title: s.title, channel: s.sales_channel })),
    })
  } catch (err) {
    return res.status(200).json({ shops: [], error: err.message })
  }
}
