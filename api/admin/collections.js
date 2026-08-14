import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

import { roleFromReq } from '../_lib/adminRole.js'

function slugify(str = '') {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// The tables ship in supabase-collections.sql. Until that migration is run every
// route here answers as "no collections" rather than 500ing, so the storefront
// keeps rendering and the admin page shows a setup hint instead of an error.
function migrationMissing(error) {
  const m = String(error?.message || '')
  return /relation .*collections.* does not exist|Could not find the table/i.test(m)
}

export default async function handler(req, res) {
  // GET is public — it feeds the storefront /collection page.
  if (req.method === 'GET') {
    const isAdmin = !!roleFromReq(req)

    const { data: collections, error } = await supabase
      .from('collections')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

    if (error) {
      if (migrationMissing(error)) {
        return res.status(200).json({ collections: [], assignments: [], setupNeeded: true })
      }
      return res.status(500).json({ error: error.message })
    }

    const { data: assignments } = await supabase
      .from('collection_products')
      .select('*')
      .order('sort_order', { ascending: true })

    // Hidden collections never leave the server for a public caller — the
    // storefront can't reveal one by reading the payload.
    const visible = isAdmin ? (collections || []) : (collections || []).filter(c => !c.hidden)
    const ids = new Set(visible.map(c => c.id))

    return res.status(200).json({
      collections: visible,
      assignments: (assignments || []).filter(a => ids.has(a.collection_id)),
    })
  }

  if (!roleFromReq(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { action } = req.body || {}

  try {
    if (action === 'createCollection') {
      const name = String(req.body.name || '').trim()
      if (!name) return res.status(400).json({ error: 'Name required' })

      const { data, error } = await supabase
        .from('collections')
        .upsert(
          { name, slug: slugify(name), sort_order: Number(req.body.sortOrder) || 0 },
          { onConflict: 'name' }
        )
        .select()
        .single()

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ collection: data })
    }

    if (action === 'updateCollection') {
      const { collectionId } = req.body
      if (!collectionId) return res.status(400).json({ error: 'collectionId required' })

      // Only the fields actually sent are touched, so editing a blurb can't wipe a label.
      const patch = {}
      if (req.body.name != null) {
        const name = String(req.body.name).trim()
        if (!name) return res.status(400).json({ error: 'Name cannot be empty' })
        patch.name = name
        patch.slug = slugify(name)
      }
      if (req.body.label != null) patch.label = String(req.body.label).trim() || null
      if (req.body.blurb != null) patch.blurb = String(req.body.blurb).trim() || null
      if (req.body.sortOrder != null) patch.sort_order = Number(req.body.sortOrder) || 0
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' })

      const { error } = await supabase.from('collections').update(patch).eq('id', collectionId)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    if (action === 'setCollectionImage') {
      const { collectionId, imageUrl } = req.body
      if (!collectionId) return res.status(400).json({ error: 'collectionId required' })

      const { error } = await supabase
        .from('collections')
        .update({ image_url: imageUrl || null })
        .eq('id', collectionId)

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    // Hide = the whole collection disappears from the website, products untouched.
    if (action === 'setCollectionHidden') {
      const { collectionId, hidden } = req.body
      if (!collectionId) return res.status(400).json({ error: 'collectionId required' })

      const { error } = await supabase
        .from('collections')
        .update({ hidden: !!hidden })
        .eq('id', collectionId)

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    // Countdown: endsAt null/'' stops the timer. Anything unparseable is rejected
    // rather than silently stored, or the storefront would just never show a clock.
    if (action === 'setCollectionCountdown') {
      const { collectionId, endsAt, label } = req.body
      if (!collectionId) return res.status(400).json({ error: 'collectionId required' })

      let ends = null
      if (endsAt) {
        const d = new Date(endsAt)
        if (isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid date/time' })
        ends = d.toISOString()
      }

      const patch = { countdown_ends_at: ends }
      if (label != null) patch.countdown_label = String(label).trim() || null
      if (!ends) patch.countdown_label = null

      const { error } = await supabase.from('collections').update(patch).eq('id', collectionId)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true, countdownEndsAt: ends })
    }

    if (action === 'deleteCollection') {
      const { collectionId } = req.body
      if (!collectionId) return res.status(400).json({ error: 'collectionId required' })

      const { error } = await supabase.from('collections').delete().eq('id', collectionId)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    if (action === 'assignProduct') {
      const { collectionId, productId } = req.body
      if (!collectionId || !productId) {
        return res.status(400).json({ error: 'collectionId and productId required' })
      }

      const { error } = await supabase
        .from('collection_products')
        .upsert(
          { collection_id: collectionId, product_id: productId, sort_order: Number(req.body.sortOrder) || 0 },
          { onConflict: 'collection_id,product_id' }
        )

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    if (action === 'unassignProduct') {
      const { collectionId, productId } = req.body
      if (!collectionId || !productId) {
        return res.status(400).json({ error: 'collectionId and productId required' })
      }

      const { error } = await supabase
        .from('collection_products')
        .delete()
        .eq('collection_id', collectionId)
        .eq('product_id', productId)

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
