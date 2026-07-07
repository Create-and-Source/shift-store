import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const ADMIN_KEY = process.env.ADMIN_KEY || 'shift-admin-2026'

function slugify(str = '') {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export default async function handler(req, res) {
  // GET = public (for storefront category filtering)
  if (req.method === 'GET') {
    const { data: categories } = await supabase
      .from('categories')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

    const { data: assignments } = await supabase
      .from('product_category_assignments')
      .select('*')

    const { data: hidden } = await supabase
      .from('hidden_products')
      .select('product_id')

    return res.status(200).json({
      categories: categories || [],
      assignments: assignments || [],
      hiddenProductIds: (hidden || []).map(h => h.product_id),
    })
  }

  // All mutations require admin
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { action } = req.body

  try {
    if (action === 'createCategory') {
      const name = String(req.body.name || '').trim()
      if (!name) return res.status(400).json({ error: 'Name required' })

      const { data, error } = await supabase
        .from('categories')
        .upsert({ name, slug: slugify(name), sort_order: 0 }, { onConflict: 'name' })
        .select()
        .single()

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ category: data })
    }

    if (action === 'updateCategory') {
      const { categoryId, name } = req.body
      if (!categoryId || !name) return res.status(400).json({ error: 'categoryId and name required' })

      const { error } = await supabase
        .from('categories')
        .update({ name: name.trim(), slug: slugify(name) })
        .eq('id', categoryId)

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    if (action === 'setCategoryImage') {
      const { categoryId, imageUrl } = req.body
      if (!categoryId) return res.status(400).json({ error: 'categoryId required' })

      const { error } = await supabase
        .from('categories')
        .update({ image_url: imageUrl || null })
        .eq('id', categoryId)

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    if (action === 'deleteCategory') {
      const { categoryId } = req.body
      if (!categoryId) return res.status(400).json({ error: 'categoryId required' })

      const { error } = await supabase
        .from('categories')
        .delete()
        .eq('id', categoryId)

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    if (action === 'assignProduct') {
      const { categoryId, productId } = req.body
      if (!categoryId || !productId) return res.status(400).json({ error: 'categoryId and productId required' })

      const { error } = await supabase
        .from('product_category_assignments')
        .upsert({ category_id: categoryId, product_id: productId }, { onConflict: 'product_id,category_id' })

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    if (action === 'unassignProduct') {
      const { categoryId, productId } = req.body
      if (!categoryId || !productId) return res.status(400).json({ error: 'categoryId and productId required' })

      const { error } = await supabase
        .from('product_category_assignments')
        .delete()
        .eq('category_id', categoryId)
        .eq('product_id', productId)

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    if (action === 'hideProduct') {
      const { productId } = req.body
      if (!productId) return res.status(400).json({ error: 'productId required' })

      const { error } = await supabase
        .from('hidden_products')
        .upsert({ product_id: productId }, { onConflict: 'product_id' })

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    if (action === 'showProduct') {
      const { productId } = req.body
      if (!productId) return res.status(400).json({ error: 'productId required' })

      const { error } = await supabase
        .from('hidden_products')
        .delete()
        .eq('product_id', productId)

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
