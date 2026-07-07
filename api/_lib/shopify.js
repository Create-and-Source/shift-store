// ─── Shopify Storefront API client ──────────────────────────────────────
// Files under /api starting with "_" are helpers, not routes. Everything here
// is a no-op unless SHOPIFY_STORE_DOMAIN + SHOPIFY_STOREFRONT_TOKEN are set,
// so Shopify stays inert until the credentials exist.

const API_VERSION = '2026-07'
const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN // e.g. "shift.myshopify.com"
const TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN

export function shopifyEnabled() {
  return Boolean(DOMAIN && TOKEN)
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

  const productImages = (p.images?.edges || []).map(e => e.node.url)
  const defaultImg = p.featuredImage?.url || productImages[0] || ''

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
  colors.forEach(c => {
    if (c.images.length === 0) {
      const imgs = productImages.length ? productImages : (defaultImg ? [defaultImg] : [])
      c.images = imgs.map(url => ({ url, zoom: url, thumbnail: url, type: 'shopify' }))
    }
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
