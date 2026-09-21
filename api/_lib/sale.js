import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// One sale at a time: a whole-number % off every product in ONE collection,
// until a set moment. Stored in store_settings under 'sale' as
// { collectionId, percent, endsAt, message }, set from /dashadmin → Collections.
//
// The discount comes entirely out of the brand's cut: the Connect app fee
// (csShareCents in create-checkout) is owner price + shipping, which a sale
// does not change.

export async function getSaleSetting() {
  try {
    const { data } = await supabase
      .from('store_settings')
      .select('value')
      .eq('key', 'sale')
      .maybeSingle()
    return data?.value || null
  } catch {
    return null
  }
}

// The sale as it stands right now, with its product ids — or null. Past its
// end, on a hidden collection, or on any read error there is no sale: prices
// fall back to full, which is the safe direction.
export async function getActiveSale(now = Date.now()) {
  const s = await getSaleSetting()
  if (!s?.collectionId) return null
  const percent = Number(s.percent)
  if (!Number.isInteger(percent) || percent < 1 || percent > 90) return null
  const ends = new Date(s.endsAt).getTime()
  if (!ends || isNaN(ends) || ends <= now) return null
  try {
    const [{ data: col }, { data: rows, error }] = await Promise.all([
      supabase.from('collections').select('id, name, slug, hidden').eq('id', s.collectionId).maybeSingle(),
      supabase.from('collection_products').select('product_id').eq('collection_id', s.collectionId),
    ])
    if (!col || col.hidden || error) return null
    return {
      collectionId: col.id,
      collectionName: col.name,
      slug: col.slug,
      percent,
      endsAt: new Date(ends).toISOString(),
      message: s.message || null,
      productIds: (rows || []).map(r => r.product_id),
    }
  } catch {
    return null
  }
}

// Integer cents, rounded once — the storefront has an identical copy
// (salePriceOf in App.jsx) so the cart and Stripe always agree to the cent.
export function salePrice(price, percent) {
  return Math.round(Math.round(Number(price) * 100) * (100 - percent) / 100) / 100
}
