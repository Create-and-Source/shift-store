import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const BUCKET = 'store-media'

// ════════════════════════════════════════════════════════════════════════
// "Is this image being used, and where?"
//
// Every place an image can appear on this store, in one index:
//
//   product photo   product_overrides.image_urls — the mockups uploaded here
//   supplier photo  the Fulfill Engine / Printify / Shopify product feeds
//   category        categories.image_url
//   collection      collections.image_url
//   custom product  custom_products.image_urls
//   site            hard-coded art in /public that the storefront renders
//
// Read live on every request rather than cached in a table, so the answer is
// never stale — an image that was un-assigned five seconds ago reads as
// unused immediately. Every source is fail-soft: a supplier feed being down
// makes its photos temporarily unknown, it does not break the gallery.
// ════════════════════════════════════════════════════════════════════════

// Cache-busting query params that don't change which image you get. Shopify
// stamps ?v=<timestamp> on every CDN URL; Printify's ?camera_label=front is
// the OPPOSITE — it picks a different mockup — so only known-inert keys go.
const INERT_PARAMS = ['v', 'updated_at', 'width', 'height', 'quality', 'format', 'cache']

export function normalizeUrl(raw) {
  const url = String(raw || '').trim()
  if (!url) return ''
  try {
    const u = new URL(url, 'https://shiftapparelco.com')
    for (const p of INERT_PARAMS) u.searchParams.delete(p)
    u.hash = ''
    return u.toString()
  } catch {
    return url
  }
}

// Fulfill Engine serves the same artwork three ways —
//   …-front-faded-black-product.png / -zoom.png / -thumbnail.png
// Treat them as one image with the "product" rendition as the face of it.
// (Fingerprinting the 52×78 thumbnail separately is worse than useless: it's
// too coarse to match its own full-size version.)
const FE_RENDITION = /^(.*)-(product|zoom|thumbnail)\.(png|jpe?g)$/i

// Our own hosts. An image's identity must not depend on which one the request
// came in on — apex and www serve the same /lifestyle/car-meet.png, and keying
// by full URL filed it as two different images depending on where you were
// browsing from. Own-host URLs key by PATH.
const OWN_HOST = /(^|\.)shiftapparelco\.com$|\.vercel\.app$/i
export const SITE_BASE = 'https://shiftapparelco.com'

export function canonicalKey(url) {
  const n = normalizeUrl(url)
  const m = n.match(FE_RENDITION)
  if (m) return `${m[1]}-product.${m[3]}`
  try {
    const u = new URL(n)
    if (OWN_HOST.test(u.hostname)) return u.pathname
  } catch { /* not absolute — leave as-is */ }
  return n
}

// The absolute, fetchable form of a canonical key.
export function absoluteUrl(key) {
  return key.startsWith('/') ? SITE_BASE + key : key
}

// Images the storefront renders straight out of /public. Not in any table —
// they live in the code, so they live here too. Keep in step with App.jsx if
// a new one is added; an image missing from this list simply reads as
// "not used anywhere", never as a wrong answer.
// Images the storefront renders straight out of /public — they live in the
// code, so they live here too. AUDITED 2026-08-21 against every file in
// public/: each entry below is a real reference in App.jsx or index.html.
//
// ⚠️ A missing entry reads as "not used", which is merely incomplete. A WRONG
// entry reads as "used HERE", which is a confident false answer — that is the
// dangerous direction, and it already happened once: six of these were listed
// as homepage art when they are really the Categories page's FALLBACK tiles,
// which render only when the store has no categories at all. `when` handles
// that now — the condition is evaluated against live data, so a dormant
// fallback says so instead of claiming a slot on the homepage.
export const SITE_IMAGES = [
  ['/shift-logo.png', 'Logo — header, footer, hero, checkout, admin'],
  ['/share-image.png', 'Link preview image (og:image)'],
  ['/favicon-32.png', 'Browser tab icon'],
  ['/icon-192.png', 'App icon'],
  ['/apple-touch-icon.png', 'iPhone home-screen icon'],
  ['/lifestyle/street-crossing.png', 'Homepage — hero still, behind the video'],
  ['/lifestyle/summer-collection.jpg', 'Homepage — Summer Collection spread'],
  ['/lifestyle/shift-walk.jpg', 'Homepage — photo grid'],
  ['/lifestyle/shift-convertible.jpg', 'Homepage — photo grid'],
  ['/lifestyle/shift-caps.jpg', 'Homepage — photo grid'],
  ['/lifestyle/shift-alley.jpg', 'Homepage — photo grid'],
  ['/lifestyle/shift-skate.jpg', 'Homepage — photo grid'],
  // Categories-page fallback tiles — only rendered when NO categories exist.
  ['/lifestyle/pizza-shop.png', 'Categories page — “Essentials” tile', 'no-categories'],
  ['/lifestyle/car-meet.png', 'Categories page — “Racing” tile', 'no-categories'],
  ['/lifestyle/convertible-pink-red.png', 'Categories page — “Fresh Drops” tile', 'no-categories'],
  ['/lifestyle/subway.png', 'Categories page — “City Series” tile', 'no-categories'],
  ['/lifestyle/chinatown.jpg', 'Categories page — “Chinatown” tile', 'no-categories'],
  ['/lifestyle/nyc-crosswalk.png', 'Categories page — “NYC” tile', 'no-categories'],
]

function sourceOf(productId = '') {
  if (String(productId).startsWith('pf-')) return 'printify'
  if (String(productId).startsWith('sh-')) return 'shopify'
  return 'fulfillengine'
}

export const SOURCE_LABEL = {
  fulfillengine: 'Fulfill Engine',
  printify: 'Printify',
  shopify: 'Shopify / Tapstitch',
}

// Pull the three catalogs through the store's own public endpoints, so the
// index describes exactly what the storefront shows — no second copy of the
// mapping logic to drift out of step. A feed that fails contributes nothing
// and is reported, never thrown.
async function loadFeeds(origin) {
  const one = async (path, label) => {
    try {
      const res = await fetch(`${origin}${path}`, { headers: { Accept: 'application/json' } })
      if (!res.ok) return { products: [], error: `${label}: HTTP ${res.status}` }
      const data = await res.json()
      return { products: data.products || [], error: data.error ? `${label}: ${data.error}` : null }
    } catch (err) {
      return { products: [], error: `${label}: ${err.message}` }
    }
  }
  const [fe, pf, sh] = await Promise.all([
    one('/api/products', 'Fulfill Engine'),
    one('/api/printify/products', 'Printify'),
    one('/api/shopify/products', 'Shopify'),
  ])
  return {
    products: [...fe.products, ...pf.products, ...sh.products],
    errors: [fe.error, pf.error, sh.error].filter(Boolean),
  }
}

// ── the index ───────────────────────────────────────────────────────────
// Returns:
//   images  [{ key, url, aliases[], uses[{kind,label,sub,refId,position}] }]
//   byKey   Map(key → image)
//   errors  [string]  — sources that couldn't be read this time
export async function buildUsageIndex(origin) {
  const errors = []
  const images = new Map()

  const add = (rawUrl, use) => {
    const url = normalizeUrl(rawUrl)
    if (!url) return
    const key = canonicalKey(url)
    let img = images.get(key)
    if (!img) {
      img = { key, url: absoluteUrl(key.startsWith('http') || key.startsWith('/') ? key : url), aliases: [], uses: [] }
      images.set(key, img)
    }
    if (url !== img.url && !img.aliases.includes(url)) img.aliases.push(url)
    if (use) img.uses.push(use)
  }

  const table = async (name, query) => {
    try {
      const { data, error } = await query
      if (error) { errors.push(`${name}: ${error.message}`); return [] }
      return data || []
    } catch (err) {
      errors.push(`${name}: ${err.message}`)
      return []
    }
  }

  const [overrides, categories, collections, customProducts, feeds] = await Promise.all([
    table('product_overrides', supabase.from('product_overrides').select('product_id, image_urls, name')),
    table('categories', supabase.from('categories').select('id, name, image_url')),
    table('collections', supabase.from('collections').select('id, name, image_url')),
    table('custom_products', supabase.from('custom_products').select('id, name, image_urls')),
    loadFeeds(origin),
  ])
  errors.push(...feeds.errors)

  // Product names: the override name is what the store actually displays.
  const nameById = new Map()
  for (const p of feeds.products) nameById.set(p.id, p.name)
  for (const o of overrides) if (o.name) nameById.set(o.product_id, o.name)
  const displayName = id => nameById.get(id) || `Product ${String(id).slice(0, 8)}`

  // 1) Mockups uploaded onto a feed product
  for (const o of overrides) {
    const urls = Array.isArray(o.image_urls) ? o.image_urls : []
    urls.forEach((u, i) => add(u, {
      kind: 'product-photo',
      label: displayName(o.product_id),
      sub: i === 0 ? 'Leads the product page' : `Photo ${i + 1}`,
      refId: o.product_id,
      position: i,
      source: sourceOf(o.product_id),
    }))
  }

  // 2) Category photos
  for (const c of categories) {
    if (c.image_url) add(c.image_url, { kind: 'category', label: c.name, sub: 'Category photo', refId: c.id })
  }

  // 3) Collection photos
  for (const c of collections) {
    if (c.image_url) add(c.image_url, { kind: 'collection', label: c.name, sub: 'Collection photo', refId: c.id })
  }

  // 4) Custom products built in the admin
  for (const p of customProducts) {
    const urls = Array.isArray(p.image_urls) ? p.image_urls : []
    urls.forEach((u, i) => add(u, {
      kind: 'custom-product', label: p.name, sub: `Photo ${i + 1}`, refId: p.id, position: i,
    }))
  }

  // 5) Supplier photos straight off the feeds
  for (const p of feeds.products) {
    const src = p.source || sourceOf(p.id)
    for (const color of p.colors || []) {
      for (const img of color.images || []) {
        const use = {
          kind: 'feed',
          label: displayName(p.id),
          sub: [color.name, img.type && img.type !== 'shopify' ? img.type : null].filter(Boolean).join(' · ') || 'Supplier photo',
          refId: p.id,
          source: src,
        }
        add(img.url, use)
        // zoom/thumbnail collapse onto the same key; register them as aliases
        // without double-counting the use.
        if (img.zoom) add(img.zoom, null)
        if (img.thumbnail) add(img.thumbnail, null)
      }
    }
    if (p.image) add(p.image, null)
  }

  // 6) Art the storefront renders from /public. A conditional entry whose
  //    condition is false is recorded as DORMANT — the code points at it, but
  //    nothing renders it today, so it must not read as "used".
  const conditions = { 'no-categories': categories.length === 0 }
  for (const [path, where, when] of SITE_IMAGES) {
    const live = !when || conditions[when]
    add(`${origin}${path}`, live
      ? { kind: 'site', label: where, sub: 'Built into the site', refId: path }
      : { kind: 'site-dormant', label: where, refId: path,
          sub: `Not showing — the store has ${categories.length} categories, so this fallback never renders` })
  }

  return { images: [...images.values()], byKey: images, errors }
}

// Everything sitting in the store-media bucket, whether or not it's used.
// Lets the gallery answer "what have I uploaded that nothing points at?"
export async function listBucketFiles(folders = ['gallery', 'overrides', 'categories', 'collections', 'uploads']) {
  const out = []
  for (const folder of folders) {
    try {
      const { data, error } = await supabase.storage.from(BUCKET).list(folder, { limit: 1000, sortBy: { column: 'name', order: 'asc' } })
      if (error) continue
      for (const f of data || []) {
        if (!f.name || f.id === null) continue // sub-folder placeholder
        const path = `${folder}/${f.name}`
        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
        out.push({
          path,
          url: pub.publicUrl,
          name: f.name,
          bytes: f.metadata?.size || null,
          contentType: f.metadata?.mimetype || null,
          createdAt: f.created_at || null,
        })
      }
    } catch {
      // a missing folder is just an empty one
    }
  }
  return out
}

// Our own bucket, spelled as a public URL. Recognising it means an image
// adopted out of the store still knows which file it is — so deleting an
// unused leftover actually removes the file instead of just forgetting it.
export function storagePathFromUrl(url) {
  const base = `${process.env.VITE_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`
  const n = normalizeUrl(url)
  return n.startsWith(base) ? decodeURIComponent(n.slice(base.length)) : null
}

export function originFromReq(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host
  const proto = req.headers['x-forwarded-proto'] || (host && host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}
