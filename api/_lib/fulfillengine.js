// Fulfill Engine merchant API — order auto-submission.
// Docs: https://help.fulfillengine.com/en/api-guide (spec: api.fulfillengine.com/openapi)
// Auth is an account-scoped API key (FE dashboard → Configuration → API keys).
// Everything no-ops until FE_API_KEY is set in Vercel.

const FE_ACCOUNT_ID = process.env.FE_ACCOUNT_ID || 'act-9679744'
const FE_CAMPAIGN_ID = process.env.FE_CAMPAIGN_ID || 'b1e7b585-569d-4b88-ad27-4ce43ffcbb91'
const FE_API_KEY = process.env.FE_API_KEY || ''
const BASE = 'https://api.fulfillengine.com'

export function feEnabled() {
  return !!FE_API_KEY
}

async function feFetch(path, opts = {}) {
  const res = await fetch(`${BASE}/api/accounts/${FE_ACCOUNT_ID}${path}`, {
    ...opts,
    headers: {
      'X-API-KEY': FE_API_KEY,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  if (!res.ok) {
    const err = new Error(`Fulfill Engine ${res.status}`)
    err.body = body
    throw err
  }
  return body
}

export async function testFEAuth() {
  return feFetch('/authentication-test')
}

// What FE ACTUALLY billed, per order — invoices carry per-order item cost,
// pick-and-pack, and shipping actuals; customId is our order uuid. This is
// the calibration source for the fulfillengine rate table on
// /dashadmin → Shipping (their table entries should cover shipping + P&P).
export async function feShippingActuals(days = 90) {
  const minDateCreated = new Date(Date.now() - days * 86400e3).toISOString()
  const resp = await feFetch('/invoices', {
    method: 'POST',
    body: JSON.stringify({ minDateCreated }),
  })
  const invoices = (resp?.invoices || [])
    .sort((a, b) => new Date(b.dateCreated) - new Date(a.dateCreated))
    .slice(0, 12)
  const orders = []
  for (const inv of invoices) {
    try {
      const r = await feFetch(`/invoices/${inv.id}/orders`)
      for (const o of r?.orders || []) {
        orders.push({
          invoiceDate: inv.dateCreated,
          orderId: o.orderId,
          customId: o.customId,
          itemCost: o.accountInvoiceItemCost,
          pickAndPack: o.accountInvoicePickAndPack,
          shipping: o.accountInvoiceShipping,
          total: o.accountInvoiceTotal,
        })
      }
    } catch (err) {
      console.error(`FE invoice ${inv.id} orders failed:`, err.message)
    }
  }
  return { invoices, orders }
}

// Tracking for a submitted FE order (the id createFEOrder returned).
// Shipments carry trackingNumber/trackingUrl once FE ships; returns
// { number, url } for the first tracked, non-canceled shipment, else null.
export async function getFEOrderTracking(feOrderId) {
  const shipments = await feFetch(`/orders/${feOrderId}/shipments`)
  for (const s of Array.isArray(shipments) ? shipments : []) {
    if (s?.trackingNumber && s.status !== 'canceled') {
      return { number: s.trackingNumber, url: s.trackingUrl || null }
    }
  }
  return null
}

// items: [{ productId, color, size, qty, price }] — FE campaign products only.
// Diagnostic bundle: the campaign's products/variants/SKUs as FE sees them,
// FE's own per-SKU validity check (campaign inventory), and account prices.
export async function feDebug(items) {
  const ids = [...new Set(items.map(it => it.productId))]
  const products = await feFetch(`/campaigns/${FE_CAMPAIGN_ID}/products`, {
    method: 'POST',
    body: JSON.stringify({ campaignProductIds: ids }),
  })
  const slim = (Array.isArray(products) ? products : []).map(p => ({
    id: p.id,
    name: p.name,
    catalogProductId: p.catalogProductId,
    designId: p.designId,
    variants: (p.variants || []).map(v => ({ sku: v.sku, options: v.options })),
  }))
  const skus = slim.flatMap(p => p.variants.map(v => v.sku)).filter(Boolean)
  let inventory = null
  let prices = null
  try {
    inventory = await feFetch(`/campaigns/${FE_CAMPAIGN_ID}/inventory`, {
      method: 'POST', body: JSON.stringify({ skus }),
    })
  } catch (e) { inventory = { error: e.message, detail: e.body } }
  try {
    prices = await feFetch(`/campaigns/${FE_CAMPAIGN_ID}/products/account-prices`, {
      method: 'POST', body: JSON.stringify({ productIds: ids }),
    })
  } catch (e) { prices = { error: e.message, detail: e.body } }
  return { campaignId: FE_CAMPAIGN_ID, products: slim, inventory, prices }
}

// Stable lookup key for a (color, size) combo. Colors share display names
// across FE's catalog and the shop feed ('Black Stone'), but sizes do NOT:
// the shop feed spells them out ('XXX-Large') while catalog inventory
// abbreviates ('3XL') — verified live 2026-07-21 — so both spellings
// canonicalize to the abbreviation. One-size products (hats, bags) carry
// 'One Size' in our carts but no size in FE — both normalize to ''.
const SIZE_CANON = {
  'xx-small': 'xxs', 'x-small': 'xs', 'small': 's', 'medium': 'm', 'large': 'l',
  'x-large': 'xl', 'xx-large': '2xl', 'xxl': '2xl', 'xxx-large': '3xl', 'xxxl': '3xl',
  'xxxx-large': '4xl', 'xxxxl': '4xl', 'xxxxx-large': '5xl', 'xxxxxl': '5xl',
  'one size': '',
}
export function comboKey(color, size) {
  const norm = v => String(v || '').trim().toLowerCase()
  const s = norm(size)
  return `${norm(color)}|${SIZE_CANON[s] ?? s}`
}

// Blank-level availability for FE campaign products, per (color, size).
// The public shop feed carries no stock data at all, and FE ACCEPTS orders
// for out-of-stock blanks and silently parks them — so this is the only way
// to know a combo can't be bought. Campaign products resolve to their catalog
// blanks; the catalog inventory endpoint reports per-SKU isAvailable.
// Returns { [campaignProductId]: { unavailable, unavailableKeys, combos } }.
// Only combos FE explicitly reports unavailable are listed — unknown products
// or combos stay sellable (fail open; an FE hiccup must never hide the store).
export async function feAvailability(campaignProductIds) {
  const ids = [...new Set(campaignProductIds)].filter(Boolean)
  if (!ids.length) return {}
  const products = await feFetch(`/campaigns/${FE_CAMPAIGN_ID}/products`, {
    method: 'POST',
    body: JSON.stringify({ campaignProductIds: ids }),
  })
  const list = Array.isArray(products) ? products : []
  const catalogIds = [...new Set(list.map(p => p.catalogProductId).filter(Boolean))]
  const byCatalog = new Map()
  for (let i = 0; i < catalogIds.length; i += 50) { // endpoint caps at 50 ids
    const inv = await feFetch('/product-catalog/inventory', {
      method: 'POST',
      body: JSON.stringify({ productIds: catalogIds.slice(i, i + 50) }),
    })
    for (const p of inv?.products || []) byCatalog.set(p.productId, p.skus || [])
  }
  const out = {}
  for (const p of list) {
    const skus = byCatalog.get(p.catalogProductId)
    if (!skus) continue
    const combos = skus.map(s => ({
      color: s.options?.color || '',
      size: s.options?.size || '',
      available: s?.isAvailable !== false,
    }))
    const unavailable = combos.filter(c => !c.available).map(({ color, size }) => ({ color, size }))
    out[p.id] = {
      unavailable,
      unavailableKeys: unavailable.map(u => comboKey(u.color, u.size)),
      combos,
    }
  }
  return out
}

// The store's items are print-on-demand: campaign variant SKUs are NOT
// orderable (FE's campaign inventory reports them empty → InvalidSKU on
// orders). A POD order references the catalog BLANK (catalogProductId, an
// accepted identifier) + the stored design (designId = "design details") +
// productColor/productSize to pick the variant. Both come from the
// authenticated campaign catalog.
async function resolvePodItems(items) {
  const ids = [...new Set(items.map(it => it.productId))]
  const products = await feFetch(`/campaigns/${FE_CAMPAIGN_ID}/products`, {
    method: 'POST',
    body: JSON.stringify({ campaignProductIds: ids }),
  })
  const byId = new Map((Array.isArray(products) ? products : []).map(p => [p.id, p]))
  return items.map(it => {
    const p = byId.get(it.productId)
    if (!p) throw new Error(`Product ${it.productId} not found in the FE campaign`)
    if (!p.catalogProductId) throw new Error(`"${p.name}" has no catalogProductId in FE`)
    return { ...it, catalogProductId: p.catalogProductId, designId: p.designId || undefined }
  })
}

// items: [{ productId, color, size, qty, price }] — FE campaign products only.
// validateOnly hits the dry-run endpoint: full validation, nothing produced.
export async function createFEOrder({ externalId, items, address, email, validateOnly = false }) {
  const resolved = await resolvePodItems(items)
  const orderItemGroups = resolved.map((it, i) => ({
    id: `item-${i + 1}`,
    catalogProductId: it.catalogProductId,
    designId: it.designId,
    productColor: it.color || undefined,
    productSize: it.size && it.size !== 'One Size' ? it.size : undefined,
    quantity: it.qty,
    declaredValue: it.price,
  }))

  // No campaignId on the order — FE docs: "omitted for most API orders"
  // (account-level). The id that field wants is the store-admin-page id, NOT
  // the storefront feed's campaignId; sending the wrong one → InvalidSKU
  // "ensure the order is using the correct campaign".
  const body = {
    customId: externalId,
    customIdIsUniqueKey: true,
    customerEmailAddress: email || undefined,
    orderItemGroups,
    shipments: [
      {
        shippingAddress: {
          name: address?.name || '',
          addressLine1: address?.line1 || '',
          addressLine2: address?.line2 || '',
          city: address?.city || '',
          state: address?.state || '',
          postalCode: address?.postal_code || '',
          country: address?.country || 'US',
          phone: address?.phone || '',
        },
      },
    ],
  }

  return feFetch(validateOnly ? '/orders/validate' : '/orders', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
