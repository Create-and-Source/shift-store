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

// FE requires a real SKU per order item ("All order item groups must include
// one of: SKU, GTIN, CatalogProductId, or VendorSKU") — resolve each item's
// variant SKU from the authenticated campaign catalog by color + size.
async function resolveSkus(items) {
  const ids = [...new Set(items.map(it => it.productId))]
  const products = await feFetch(`/campaigns/${FE_CAMPAIGN_ID}/products`, {
    method: 'POST',
    body: JSON.stringify({ campaignProductIds: ids }),
  })
  const byId = new Map((Array.isArray(products) ? products : []).map(p => [p.id, p]))
  return items.map(it => {
    const p = byId.get(it.productId)
    if (!p) throw new Error(`Product ${it.productId} not found in the FE campaign`)
    const variants = p.variants || []
    const color = (it.color || '').trim().toLowerCase()
    const size = (it.size || '').trim().toLowerCase()
    const oneSize = !size || size === 'one size'
    const colorOf = v => (v.options?.color || '').trim().toLowerCase()
    const sizeOf = v => (v.options?.size || '').trim().toLowerCase()
    let v = variants.find(x => colorOf(x) === color && (oneSize ? !sizeOf(x) : sizeOf(x) === size))
    if (!v) {
      const sameColor = variants.filter(x => colorOf(x) === color)
      if (sameColor.length === 1) v = sameColor[0]
    }
    if (!v && variants.length === 1) v = variants[0]
    if (!v || !v.sku) {
      const have = variants.map(x => `${x.options?.color || '?'} / ${x.options?.size || '-'}`).join(', ')
      throw new Error(`No SKU match for "${p.name}" ${it.color} / ${it.size} — FE variants: ${have}`)
    }
    return { ...it, sku: v.sku }
  })
}

// items: [{ productId, color, size, qty, price }] — FE campaign products only.
// validateOnly hits the dry-run endpoint: full validation, nothing produced.
export async function createFEOrder({ externalId, items, address, email, validateOnly = false }) {
  const resolved = await resolveSkus(items)
  const orderItemGroups = resolved.map((it, i) => ({
    id: `item-${i + 1}`,
    sku: it.sku,
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
