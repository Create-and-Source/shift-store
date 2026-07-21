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
// The API resolves the variant from campaignProductId + productColor/productSize,
// so no SKU mapping is needed. validateOnly hits the dry-run endpoint: full
// validation, nothing produced.
export async function createFEOrder({ externalId, items, address, email, validateOnly = false }) {
  const orderItemGroups = items.map((it, i) => ({
    id: `item-${i + 1}`,
    campaignProductId: it.productId,
    productColor: it.color || undefined,
    // One-size products have no Size option in FE — omit rather than mismatch.
    productSize: it.size && it.size !== 'One Size' ? it.size : undefined,
    quantity: it.qty,
    declaredValue: it.price,
  }))

  const body = {
    campaignId: FE_CAMPAIGN_ID,
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
