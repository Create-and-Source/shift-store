// ─── Printify REST client ───────────────────────────────────────────────
// Files under /api that start with "_" are NOT deployed as routes by Vercel,
// so this is a shared helper only. Everything here is a no-op unless
// PRINTIFY_API_TOKEN is set — that keeps Printify completely inert (and the
// store unaffected) until the credential exists.

const BASE = 'https://api.printify.com/v1'
const TOKEN = process.env.PRINTIFY_API_TOKEN

// Shop id is OPTIONAL: if PRINTIFY_SHOP_ID is set it's used directly;
// otherwise it's auto-resolved from the token (the account's first shop) and
// cached for the function's lifetime — so the token alone is enough to run.
let SHOP_ID = process.env.PRINTIFY_SHOP_ID || null
let shopIdPromise = null

export function printifyEnabled() {
  return Boolean(TOKEN)
}

async function getShopId() {
  if (SHOP_ID) return SHOP_ID
  if (!shopIdPromise) {
    shopIdPromise = pf('/shops.json')
      .then(shops => {
        if (!Array.isArray(shops) || !shops.length) {
          throw new Error('No Printify shops found for this token')
        }
        // This account has multiple brand shops; prefer the one whose title
        // mentions "shift" (the SHIFT Apparel store). Set PRINTIFY_SHOP_ID to
        // override explicitly. Falls back to the first shop only if none match.
        const shift = shops.find(s => /shift/i.test(s.title || ''))
        SHOP_ID = String((shift || shops[0]).id)
        return SHOP_ID
      })
      .catch(err => { shopIdPromise = null; throw err })
  }
  return shopIdPromise
}

async function pf(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      // Printify requires a User-Agent identifying the app.
      'User-Agent': 'SHIFT Store (createandsource.com)',
      ...(options.headers || {}),
    },
  })

  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }

  if (!res.ok) {
    const msg = body?.message || body?.error || `Printify ${res.status}`
    const err = new Error(msg)
    err.status = res.status
    err.body = body
    throw err
  }
  return body
}

// ─── Shops ──────────────────────────────────────────────────────────────

export async function listShops() {
  return pf('/shops.json')
}

// ─── Products ───────────────────────────────────────────────────────────

export async function listPrintifyProducts() {
  const shopId = await getShopId()
  const all = []
  let page = 1
  // Paginate defensively; cap at 20 pages (2000 products) as a safety stop.
  while (page <= 40) {
    // Printify caps the products limit at 50 per page (lowered from 100 in 2024).
    const data = await pf(`/shops/${shopId}/products.json?limit=50&page=${page}`)
    const items = data?.data || []
    all.push(...items)
    if (!data?.next_page_url || items.length === 0) break
    page++
  }
  return all
}

// Normalize a raw Printify product into the shape the storefront UI expects
// (matching api/products.js from Fulfill Engine), plus the fields the webhook
// needs to route fulfillment: `source`, `printifyProductId`, and `variantMap`
// (a "Color|Size" -> variant_id lookup).
export function mapPrintifyProduct(p) {
  const options = p.options || []
  const colorOpt = options.find(o => o.type === 'color' || /colou?r/i.test(o.name || ''))
  const sizeOpt = options.find(o => o.type === 'size' || /size/i.test(o.name || ''))
  const colorValues = new Map((colorOpt?.values || []).map(v => [v.id, v]))
  const sizeValues = new Map((sizeOpt?.values || []).map(v => [v.id, v]))

  const enabledVariants = (p.variants || []).filter(v => v.is_enabled)

  const variantInfo = enabledVariants.map(v => {
    let colorVal, sizeVal
    for (const id of v.options || []) {
      if (colorValues.has(id)) colorVal = colorValues.get(id)
      if (sizeValues.has(id)) sizeVal = sizeValues.get(id)
    }
    return {
      id: v.id,
      color: colorVal?.title || 'Default',
      colorHex: colorVal?.colors?.[0] || '#0A0A0A',
      size: sizeVal?.title || 'One Size',
      price: (v.price || 0) / 100,
      available: v.is_available !== false,
    }
  })

  // Map each variant id to its mockup image srcs.
  const imagesByVariant = new Map()
  for (const img of p.images || []) {
    for (const vid of img.variant_ids || []) {
      const arr = imagesByVariant.get(vid) || []
      arr.push(img.src)
      imagesByVariant.set(vid, arr)
    }
  }

  const prices = variantInfo.map(v => v.price).filter(n => n > 0)
  const basePrice = prices.length ? Math.min(...prices) : 0

  const colorsMap = new Map()
  const sizesMap = new Map()
  const variantMap = {}

  for (const v of variantInfo) {
    variantMap[`${v.color}|${v.size}`] = v.id

    if (!colorsMap.has(v.color)) {
      colorsMap.set(v.color, { name: v.color, hex: v.colorHex, images: [] })
    }
    const colorEntry = colorsMap.get(v.color)
    for (const src of imagesByVariant.get(v.id) || []) {
      if (!colorEntry.images.find(im => im.url === src)) {
        colorEntry.images.push({ url: src, zoom: src, thumbnail: src, type: 'mockup' })
      }
    }

    if (!sizesMap.has(v.size)) {
      sizesMap.set(v.size, { name: v.size, surcharge: Math.max(0, +(v.price - basePrice).toFixed(2)) })
    }
  }

  const defaultImg =
    (p.images || []).find(i => i.is_default)?.src || (p.images || [])[0]?.src || ''

  const colors = [...colorsMap.values()]
  colors.forEach(c => {
    if (c.images.length === 0 && defaultImg) {
      c.images.push({ url: defaultImg, zoom: defaultImg, thumbnail: defaultImg, type: 'mockup' })
    }
  })

  return {
    id: `pf-${p.id}`, // prefix avoids id collisions with Fulfill Engine products
    printifyProductId: p.id,
    source: 'printify',
    name: p.title,
    description: (p.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    price: basePrice,
    basePrice,
    colors: colors.length
      ? colors
      : [{ name: 'Default', hex: '#0A0A0A', images: defaultImg ? [{ url: defaultImg, zoom: defaultImg, thumbnail: defaultImg, type: 'mockup' }] : [] }],
    sizes: [...sizesMap.values()],
    image: defaultImg,
    specUrl: '',
    variantMap,
  }
}

// ─── Orders / fulfillment ───────────────────────────────────────────────

// Convert Stripe's flattened shipping address into Printify's address_to.
export function toPrintifyAddress(shippingAddress = {}, email = '') {
  const name = (shippingAddress.name || '').trim()
  const parts = name.split(/\s+/).filter(Boolean)
  const first = parts.shift() || 'Customer'
  const last = parts.join(' ') || '-'
  return {
    first_name: first,
    last_name: last,
    email: email || '',
    phone: shippingAddress.phone || '',
    country: shippingAddress.country || 'US',
    region: shippingAddress.state || '',
    address1: shippingAddress.line1 || '',
    address2: shippingAddress.line2 || '',
    city: shippingAddress.city || '',
    zip: shippingAddress.postal_code || '',
  }
}

export async function createPrintifyOrder({ externalId, lineItems, address, shippingMethod = 1 }) {
  const shopId = await getShopId()
  return pf(`/shops/${shopId}/orders.json`, {
    method: 'POST',
    body: JSON.stringify({
      external_id: String(externalId),
      label: `SHIFT #${externalId}`,
      line_items: lineItems,
      shipping_method: shippingMethod, // 1 = standard
      send_shipping_notification: false,
      address_to: address,
    }),
  })
}

export async function sendPrintifyToProduction(orderId) {
  const shopId = await getShopId()
  return pf(`/shops/${shopId}/orders/${orderId}/send_to_production.json`, { method: 'POST' })
}

// Fetch a single Printify order (includes `status` and `shipments`, each of
// which carries { carrier, number, url, delivered_at } once it ships).
export async function getPrintifyOrder(orderId) {
  const shopId = await getShopId()
  return pf(`/shops/${shopId}/orders/${orderId}.json`)
}

// Pull the first available tracking off a Printify order, or null if none yet.
export function printifyTrackingFrom(order) {
  const ship = (order?.shipments || []).find(s => s?.number)
  if (!ship) return null
  return { number: ship.number, url: ship.url || '', carrier: ship.carrier || '' }
}

// ─── Shipping rates ─────────────────────────────────────────────────────

// The store ships US-only, and Printify's US "standard" rate is provider-set
// and uniform across the mainland, so a representative US address yields the
// correct live rate without collecting the buyer's address up front.
export const US_RATE_ADDRESS = {
  country: 'US',
  region: 'CA',
  address1: '1 Market St',
  address2: '',
  city: 'San Francisco',
  zip: '94105',
}

// Raw rates from Printify (values in cents), e.g. { standard, express, ... }.
export async function getPrintifyShipping(lineItems, address = US_RATE_ADDRESS) {
  const shopId = await getShopId()
  return pf(`/shops/${shopId}/orders/shipping.json`, {
    method: 'POST',
    body: JSON.stringify({ line_items: lineItems, address_to: address }),
  })
}

// Prefer the standard rate; fall back to the cheapest offered method.
export function pickStandardUsd(rates) {
  if (!rates || typeof rates !== 'object') return null
  if (typeof rates.standard === 'number') return rates.standard / 100
  const cents = [rates.economy, rates.priority, rates.express, rates.printify_express]
    .filter(v => typeof v === 'number')
  return cents.length ? Math.min(...cents) / 100 : null
}

// Standard shipping in dollars for the given Printify line items, or null.
export async function getPrintifyStandardShipping(lineItems, address) {
  const rates = await getPrintifyShipping(lineItems, address)
  return pickStandardUsd(rates)
}
