// Per-parcel shipping — each supplier ships its own package, so a mixed cart
// pays the sum of its legs. Printify quotes live rates via its API; Fulfill
// Engine and Shopify/Tapstitch publish no quote API, so those legs price from
// first-item + each-additional rate tables stored in store_settings (key
// 'shipping_rates', editable at /dashadmin → Shipping). DEFAULT_RATES applies
// until a saved table exists — and per-field, so a partial save still falls
// back cleanly. Every failure direction charges the table/default rather than
// blocking checkout.
import { createClient } from '@supabase/supabase-js'
import { printifyEnabled, getPrintifyStandardShipping } from './printify.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// FE bills shipping AND pick-and-pack per order (see /dashadmin → Shipping →
// FE actuals) — its table entries should cover both.
export const DEFAULT_RATES = {
  fulfillengine: { first: 10, additional: 6 },
  shopify: { first: 5, additional: 2.5 },
  printify: { first: 6, additional: 2 }, // fallback only — live quote wins
  other: { first: 10, additional: 5 },
}

export const RATE_SOURCES = Object.keys(DEFAULT_RATES)

function legKey(source) {
  return RATE_SOURCES.includes(source) ? source : 'other'
}

export async function getShippingRates() {
  const merged = JSON.parse(JSON.stringify(DEFAULT_RATES))
  try {
    const { data } = await supabase
      .from('store_settings')
      .select('value')
      .eq('key', 'shipping_rates')
      .maybeSingle()
    const saved = data?.value || {}
    for (const src of RATE_SOURCES) {
      const r = saved[src]
      if (r && isFinite(Number(r.first))) merged[src].first = Number(r.first)
      if (r && isFinite(Number(r.additional))) merged[src].additional = Number(r.additional)
    }
  } catch {
    // Table missing / Supabase down — defaults it is.
  }
  return merged
}

const tableAmount = (rate, units) =>
  units <= 0 ? 0 : rate.first + (units - 1) * rate.additional

// items: [{ source, qty, printifyProductId?, printifyVariantId? }]
// Returns { total, legs: [{ source, units, amount, method }], rates }.
export async function computeCartShipping(items = []) {
  const rates = await getShippingRates()
  const unitsBy = {}
  for (const it of items) {
    const key = legKey(it.source || 'other')
    unitsBy[key] = (unitsBy[key] || 0) + (Number(it.qty) || 1)
  }

  const legs = []
  for (const [source, units] of Object.entries(unitsBy)) {
    let amount = null
    let method = 'table'
    if (source === 'printify' && printifyEnabled()) {
      const lineItems = items
        .filter(i => i.source === 'printify' && i.printifyProductId && i.printifyVariantId)
        .map(i => ({
          product_id: i.printifyProductId,
          variant_id: Number(i.printifyVariantId),
          quantity: Number(i.qty) || 1,
        }))
      if (lineItems.length) {
        try {
          amount = await getPrintifyStandardShipping(lineItems)
          if (amount != null) method = 'live'
        } catch (err) {
          console.error('Printify live shipping failed, using table:', err.message)
        }
      }
    }
    if (amount == null) amount = tableAmount(rates[source], units)
    legs.push({ source, units, amount: +Number(amount).toFixed(2), method })
  }

  const total = +legs.reduce((s, l) => s + l.amount, 0).toFixed(2)
  return { total, legs, rates }
}
