// ─── Shopify Storefront API client ──────────────────────────────────────
// Files under /api starting with "_" are helpers, not routes. Everything here
// is a no-op unless SHOPIFY_STORE_DOMAIN + SHOPIFY_STOREFRONT_TOKEN are set,
// so Shopify stays inert until the credentials exist.

const API_VERSION = '2026-07'
const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN // e.g. "shift.myshopify.com"
const TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN

export function shopifyEnabled() {
  return Boolean(DOMAIN && TOKEN)
}

// Order creation needs the Admin API (a separate, secret token with write_orders).
export function shopifyAdminEnabled() {
  return Boolean(DOMAIN && ADMIN_TOKEN)
}

async function sf(query, variables = {}) {
  const url = `https://${DOMAIN}/api/${API_VERSION}/graphql.json`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  })

  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }

  if (!res.ok) {
    const err = new Error(body?.errors?.[0]?.message || `Shopify ${res.status}`)
    err.status = res.status
    err.body = body
    throw err
  }
  if (body?.errors?.length) {
    const err = new Error(body.errors[0]?.message || 'Shopify GraphQL error')
    err.body = body.errors
    throw err
  }
  return body?.data
}

// ─── Products ───────────────────────────────────────────────────────────

const PRODUCTS_QUERY = `
query Products($first: Int!, $cursor: String) {
  products(first: $first, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        title
        description
        handle
        availableForSale
        featuredImage { url }
        images(first: 20) { edges { node { url } } }
        options { name values }
        priceRange { minVariantPrice { amount } }
        variants(first: 100) {
          edges {
            node {
              id
              title
              availableForSale
              price { amount }
              selectedOptions { name value }
              image { url }
            }
          }
        }
      }
    }
  }
}`

export async function listShopifyProducts() {
  const all = []
  let cursor = null
  let page = 0
  // Paginate defensively; cap at 10 pages (500 products).
  while (page < 10) {
    const data = await sf(PRODUCTS_QUERY, { first: 50, cursor })
    const conn = data?.products
    const nodes = (conn?.edges || []).map(e => e.node)
    all.push(...nodes)
    if (!conn?.pageInfo?.hasNextPage) break
    cursor = conn.pageInfo.endCursor
    page++
  }
  return all
}

// Storefront doesn't expose color swatch hex by default, so map common
// apparel color names to a reasonable hex; fall back to neutral gray.
const COLOR_HEX = {
  black: '#0A0A0A', white: '#F5F5F5', cream: '#EDE8E0', bone: '#E8E2D5',
  natural: '#E0D2C5', navy: '#1B2A4A', blue: '#2C5FAA', red: '#CC0000',
  maroon: '#6E1414', green: '#2E5D34', olive: '#4A5D23', orange: '#E2571E',
  yellow: '#EFC331', pink: '#F4C2C2', purple: '#5B2A86', grey: '#8A8A8A',
  gray: '#8A8A8A', charcoal: '#333333', brown: '#5A3E2B', tan: '#B99976',
  sand: '#C9B29B', 'heather grey': '#B0B0B0', 'heather gray': '#B0B0B0',
}

function hexFor(name) {
  const key = (name || '').trim().toLowerCase()
  return COLOR_HEX[key] || '#6B6B6B'
}

// Normalize a Shopify product into the storefront's product shape (matching
// Fulfill Engine + Printify), tagged with source + ids for future ordering.
export function mapShopifyProduct(p) {
  const numericId = (p.id || '').split('/').pop()
  const options = p.options || []
  const colorOpt = options.find(o => /colou?r/i.test(o.name || ''))
  const sizeOpt = options.find(o => /size/i.test(o.name || ''))
  const colorName = colorOpt?.name
  const sizeName = sizeOpt?.name

  const variants = (p.variants?.edges || []).map(e => e.node)

  const variantInfo = variants.map(v => {
    const sel = v.selectedOptions || []
    const color = sel.find(o => o.name === colorName)?.value || 'Default'
    const size = sel.find(o => o.name === sizeName)?.value || 'One Size'
    return {
      id: v.id,
      color,
      size,
      price: parseFloat(v.price?.amount || '0'),
      image: v.image?.url || '',
      available: v.availableForSale !== false,
    }
  })

  const prices = variantInfo.map(v => v.price).filter(n => n > 0)
  const basePrice = prices.length ? Math.min(...prices) : parseFloat(p.priceRange?.minVariantPrice?.amount || '0')

  // Full product gallery (every mockup/angle uploaded to the product).
  const productImages = (p.images?.edges || []).map(e => e.node.url)
  const defaultImg = p.featuredImage?.url || productImages[0] || ''

  // Images pinned to a specific variant (usually the front shot of each
  // colorway). Everything else in the gallery is a shared mockup — back,
  // detail, lifestyle — that belongs to every color, not just one.
  const variantImageUrls = new Set(variantInfo.map(v => v.image).filter(Boolean))
  const sharedImages = productImages.filter(url => !variantImageUrls.has(url))

  const colorsMap = new Map()
  const sizesMap = new Map()
  const variantMap = {}

  for (const v of variantInfo) {
    variantMap[`${v.color}|${v.size}`] = v.id

    if (!colorsMap.has(v.color)) {
      colorsMap.set(v.color, { name: v.color, hex: hexFor(v.color), images: [] })
    }
    const colorEntry = colorsMap.get(v.color)
    if (v.image && !colorEntry.images.find(im => im.url === v.image)) {
      colorEntry.images.push({ url: v.image, zoom: v.image, thumbnail: v.image, type: 'shopify' })
    }

    if (!sizesMap.has(v.size)) {
      sizesMap.set(v.size, { name: v.size, surcharge: Math.max(0, +(v.price - basePrice).toFixed(2)) })
    }
  }

  const colors = [...colorsMap.values()]
  // Give every color the FULL set of mockups: its own variant shot(s) first,
  // then the shared gallery images. A color with no variant image at all gets
  // the whole gallery. This is why extra mockups now pull in instead of being
  // dropped after the single variant image.
  colors.forEach(c => {
    const have = new Set(c.images.map(im => im.url))
    const extras = (c.images.length ? sharedImages : productImages).filter(url => !have.has(url))
    c.images.push(...extras.map(url => ({ url, zoom: url, thumbnail: url, type: 'shopify' })))
  })

  return {
    id: `sh-${numericId}`, // prefix avoids id collisions with other sources
    shopifyProductId: p.id,
    source: 'shopify',
    name: p.title,
    description: (p.description || '').trim(),
    price: basePrice,
    basePrice,
    colors: colors.length
      ? colors
      : [{ name: 'Default', hex: '#0A0A0A', images: defaultImg ? [{ url: defaultImg, zoom: defaultImg, thumbnail: defaultImg, type: 'shopify' }] : [] }],
    sizes: [...sizesMap.values()],
    image: defaultImg,
    specUrl: '',
    variantMap,
  }
}

// ─── Admin API — order creation (fulfillment) ───────────────────────────

async function adminGql(query, variables = {}) {
  const url = `https://${DOMAIN}/admin/api/${API_VERSION}/graphql.json`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': ADMIN_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  })

  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }

  if (!res.ok) {
    const err = new Error(body?.errors?.[0]?.message || `Shopify Admin ${res.status}`)
    err.status = res.status
    err.body = body
    throw err
  }
  if (body?.errors?.length) {
    const err = new Error(body.errors[0]?.message || 'Shopify Admin GraphQL error')
    err.body = body.errors
    throw err
  }
  return body?.data
}

// Convert Stripe's flattened shipping address into Shopify's MailingAddressInput.
function toShopifyAddress(shippingAddress = {}) {
  const name = (shippingAddress.name || '').trim()
  const parts = name.split(/\s+/).filter(Boolean)
  const addr = {
    firstName: parts.shift() || 'Customer',
    lastName: parts.join(' ') || '-',
    address1: shippingAddress.line1 || '',
    city: shippingAddress.city || '',
    countryCode: shippingAddress.country || 'US',
    zip: shippingAddress.postal_code || '',
  }
  if (shippingAddress.line2) addr.address2 = shippingAddress.line2
  if (shippingAddress.state) addr.provinceCode = shippingAddress.state
  if (shippingAddress.phone) addr.phone = shippingAddress.phone
  return addr
}

const ORDER_CREATE = `
mutation orderCreate($order: OrderCreateOrderInput!) {
  orderCreate(order: $order) {
    userErrors { field message }
    order { id name }
  }
}`

// Create a PAID order in the Shopify admin so it can be fulfilled there.
// lineItems: [{ variantId (gid://shopify/ProductVariant/...), quantity }]
export async function createShopifyOrder({ email, lineItems, shippingAddress }) {
  const order = {
    financialStatus: 'PAID',
    // requiresShipping must be explicit — API-created orders default to
    // "Shipping not required", which makes Tapstitch/POD apps skip them.
    lineItems: lineItems.map(li => ({ variantId: li.variantId, quantity: li.quantity, requiresShipping: true })),
    shippingLines: [{
      title: 'Standard Shipping',
      priceSet: { shopMoney: { amount: '0.00', currencyCode: 'USD' } },
    }],
  }
  if (email) order.email = email
  if (shippingAddress) order.shippingAddress = toShopifyAddress(shippingAddress)

  const data = await adminGql(ORDER_CREATE, { order })
  const userErrors = data?.orderCreate?.userErrors || []
  if (userErrors.length) {
    const err = new Error('Shopify orderCreate: ' + userErrors.map(e => e.message).join('; '))
    err.body = userErrors
    throw err
  }
  return data?.orderCreate?.order
}

// ─── Admin API — tracking lookup ────────────────────────────────────────

const ORDER_TRACKING = `
query OrderTracking($id: ID!) {
  order(id: $id) {
    id
    displayFulfillmentStatus
    fulfillments(first: 10) {
      trackingInfo { number url company }
    }
  }
}`

// Look up the first tracking number on a Shopify order's fulfillments, or null
// if it hasn't shipped yet. `orderGid` is the gid stored when we created the
// order (e.g. gid://shopify/Order/1234567890).
export async function getShopifyOrderTracking(orderGid) {
  const data = await adminGql(ORDER_TRACKING, { id: orderGid })
  const fulfillments = data?.order?.fulfillments || []
  for (const f of fulfillments) {
    const t = (f.trackingInfo || [])[0]
    if (t?.number) return { number: t.number, url: t.url || '', company: t.company || '' }
  }
  return null
}

// ─── Webhooks ───────────────────────────────────────────────────────────

const WEBHOOKS_LIST = `
query { webhookSubscriptions(first: 100) {
  edges { node { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } }
} }`

export async function listShopifyWebhooks() {
  const data = await adminGql(WEBHOOKS_LIST)
  return (data?.webhookSubscriptions?.edges || []).map(e => ({
    id: e.node.id,
    topic: e.node.topic,
    callbackUrl: e.node.endpoint?.callbackUrl || '',
  }))
}

const WEBHOOK_CREATE = `
mutation Create($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
    userErrors { field message }
    webhookSubscription { id }
  }
}`

// Register an HTTPS webhook (e.g. topic ORDERS_FULFILLED). Shopify signs each
// delivery with the app's API secret (verified in the receiver).
export async function createShopifyWebhook({ topic, callbackUrl }) {
  const data = await adminGql(WEBHOOK_CREATE, { topic, sub: { callbackUrl, format: 'JSON' } })
  const errs = data?.webhookSubscriptionCreate?.userErrors || []
  if (errs.length) {
    const err = new Error('Shopify webhookSubscriptionCreate: ' + errs.map(e => e.message).join('; '))
    err.body = errs
    throw err
  }
  return data?.webhookSubscriptionCreate?.webhookSubscription
}
