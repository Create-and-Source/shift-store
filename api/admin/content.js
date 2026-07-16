import { createClient } from '@supabase/supabase-js'
import { roleFromReq, getOwnerPrices } from '../_lib/adminRole.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Map a custom_products row into the same shape the storefront uses for feed
// products (so it merges seamlessly alongside Fulfill Engine / Printify / Shopify).
function mapCustomProduct(row) {
  const urls = Array.isArray(row.image_urls) ? row.image_urls : []
  const images = urls.map(url => ({ url, zoom: url, thumbnail: url, type: 'custom' }))
  const sizes = (Array.isArray(row.sizes) ? row.sizes : []).map(s => ({ name: String(s), surcharge: 0 }))
  const price = Number(row.price) || 0
  return {
    id: `cust-${row.id}`,
    customProductId: row.id,
    source: 'custom',
    name: row.name,
    description: row.description || '',
    price,
    basePrice: price,
    colors: [{ name: 'Default', hex: '#0A0A0A', images }],
    sizes,
    image: images[0]?.url || '',
    specUrl: '',
    variantMap: {},
  }
}

export default async function handler(req, res) {
  // GET = public: overrides + custom products for the storefront merge.
  if (req.method === 'GET') {
    try {
      const [{ data: overrideRows }, { data: customRows }] = await Promise.all([
        supabase.from('product_overrides').select('*'),
        supabase.from('custom_products').select('*')
          .eq('active', true)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: false }),
      ])
      const overrides = {}
      for (const o of (overrideRows || [])) {
        overrides[o.product_id] = {
          image_urls: Array.isArray(o.image_urls) ? o.image_urls : [],
          name: o.name || null,
          price: o.price != null ? Number(o.price) : null,
          description: o.description || null,
        }
      }
      const payload = {
        overrides,
        customProducts: (customRows || []).map(mapCustomProduct),
      }
      // The private price layer rides along ONLY for the owner — the public
      // storefront and staff logins never receive it.
      if (roleFromReq(req) === 'owner') payload.ownerPrices = await getOwnerPrices()
      return res.status(200).json(payload)
    } catch (err) {
      // Tables may not exist yet — fail soft so the storefront is unaffected.
      return res.status(200).json({ overrides: {}, customProducts: [], enabled: false })
    }
  }

  // Mutations require an admin login (owner or staff).
  const role = roleFromReq(req)
  if (!role) return res.status(401).json({ error: 'Unauthorized' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { action } = req.body || {}
  try {
    // ── Owner-only: the private price layer ──
    if (action === 'setOwnerPrice' || action === 'bulkSetOwnerPrices') {
      if (role !== 'owner') return res.status(403).json({ error: 'Not allowed' })
    }

    if (action === 'setOwnerPrice') {
      const { productId, price } = req.body
      if (!productId) return res.status(400).json({ error: 'productId required' })
      if (price === '' || price == null) {
        const { error } = await supabase.from('owner_prices').delete().eq('product_id', productId)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ ok: true })
      }
      const p = Number(price)
      if (isNaN(p) || p < 0) return res.status(400).json({ error: 'Invalid price' })
      const { error } = await supabase.from('owner_prices').upsert(
        { product_id: productId, price: p, updated_at: new Date().toISOString() },
        { onConflict: 'product_id' }
      )
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    if (action === 'bulkSetOwnerPrices') {
      const { prices } = req.body
      const entries = Object.entries(prices || {})
        .map(([id, p]) => [id, Number(p)])
        .filter(([id, p]) => id && !isNaN(p) && p >= 0)
      if (!entries.length) return res.status(400).json({ error: 'No valid prices given' })
      const now = new Date().toISOString()
      const rows = entries.map(([id, p]) => ({ product_id: id, price: p, updated_at: now }))
      const { error } = await supabase.from('owner_prices').upsert(rows, { onConflict: 'product_id' })
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true, count: rows.length })
    }

    if (action === 'setOverride') {
      const { productId, imageUrls, name, price, description } = req.body
      if (!productId) return res.status(400).json({ error: 'productId required' })
      const row = {
        product_id: productId,
        image_urls: Array.isArray(imageUrls) ? imageUrls : [],
        name: name && String(name).trim() ? String(name).trim() : null,
        price: price === '' || price == null ? null : Number(price),
        description: description && String(description).trim() ? String(description).trim() : null,
        updated_at: new Date().toISOString(),
      }
      const { error } = await supabase.from('product_overrides').upsert(row, { onConflict: 'product_id' })
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    // Bulk markup: price many products in one call. prices = { productId: number }.
    // Preserves any existing photo/name override on each product.
    if (action === 'bulkSetPrices') {
      const { prices } = req.body
      const entries = Object.entries(prices || {})
        .map(([id, p]) => [id, Number(p)])
        .filter(([id, p]) => id && !isNaN(p) && p >= 0)
      if (!entries.length) return res.status(400).json({ error: 'No valid prices given' })
      const ids = entries.map(([id]) => id)
      const { data: existing } = await supabase.from('product_overrides').select('*').in('product_id', ids)
      const byId = new Map((existing || []).map(r => [r.product_id, r]))
      const now = new Date().toISOString()
      const rows = entries.map(([id, p]) => {
        const cur = byId.get(id)
        return {
          product_id: id,
          image_urls: Array.isArray(cur?.image_urls) ? cur.image_urls : [],
          name: cur?.name || null,
          price: p,
          description: cur?.description || null,
          updated_at: now,
        }
      })
      const { error } = await supabase.from('product_overrides').upsert(rows, { onConflict: 'product_id' })
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true, count: rows.length })
    }

    if (action === 'clearOverride') {
      const { productId } = req.body
      if (!productId) return res.status(400).json({ error: 'productId required' })
      const { error } = await supabase.from('product_overrides').delete().eq('product_id', productId)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    if (action === 'createCustomProduct') {
      const { name, description, price, imageUrls, sizes } = req.body
      if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name required' })
      const { data, error } = await supabase.from('custom_products').insert({
        name: String(name).trim(),
        description: description || '',
        price: Number(price) || 0,
        image_urls: Array.isArray(imageUrls) ? imageUrls : [],
        sizes: Array.isArray(sizes) ? sizes : [],
      }).select().single()
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ product: data })
    }

    if (action === 'updateCustomProduct') {
      const { id, name, description, price, imageUrls, sizes, active } = req.body
      if (!id) return res.status(400).json({ error: 'id required' })
      const patch = {}
      if (name != null) patch.name = String(name).trim()
      if (description != null) patch.description = description
      if (price != null) patch.price = Number(price) || 0
      if (imageUrls != null) patch.image_urls = Array.isArray(imageUrls) ? imageUrls : []
      if (sizes != null) patch.sizes = Array.isArray(sizes) ? sizes : []
      if (active != null) patch.active = !!active
      const { error } = await supabase.from('custom_products').update(patch).eq('id', id)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    if (action === 'deleteCustomProduct') {
      const { id } = req.body
      if (!id) return res.status(400).json({ error: 'id required' })
      const { error } = await supabase.from('custom_products').delete().eq('id', id)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
