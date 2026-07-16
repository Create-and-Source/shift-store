import { createClient } from '@supabase/supabase-js'

// Two admin roles, one login screen:
//   owner (ADMIN_KEY)  — Tovah. Sees true source costs + her private price layer.
//   staff (STAFF_KEY)  — everyone else. Sees the owner's price AS the product cost;
//                        the private layer does not exist from their point of view.
// Neither key has a code fallback — if an env var is missing, that login is
// simply impossible (fail closed, never fail open to a default password).
const ADMIN_KEY = process.env.ADMIN_KEY || ''
const STAFF_KEY = process.env.STAFF_KEY || ''

export function roleFromReq(req) {
  const key = req.headers['x-admin-key']
  if (key && ADMIN_KEY && key === ADMIN_KEY) return 'owner'
  if (key && STAFF_KEY && key === STAFF_KEY) return 'staff'
  return null
}

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function getOwnerPrices() {
  try {
    const { data, error } = await supabase.from('owner_prices').select('product_id, price')
    if (error) return {}
    const map = {}
    for (const r of data || []) {
      if (r.price != null) map[r.product_id] = Number(r.price)
    }
    return map
  } catch {
    return {}
  }
}

// Rewrite a product feed for non-owner eyes: any product with an owner price
// shows that price as its base price — the true cost never leaves the server.
// Fail-soft: if the table is missing or the query errors, the feed passes
// through unchanged so the storefront can never break.
export async function maskCosts(products, req) {
  if (!Array.isArray(products) || products.length === 0) return products
  if (roleFromReq(req) === 'owner') return products
  const ownerPrices = await getOwnerPrices()
  return products.map(p => {
    const op = ownerPrices[p.id]
    if (op == null) return p
    return { ...p, price: op, basePrice: op }
  })
}
