import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { roleFromReq } from '../_lib/adminRole.js'
import { fingerprint, fingerprintUrl, bestMatch, matchLevel } from '../_lib/imagehash.js'
import { buildUsageIndex, listBucketFiles, canonicalKey, originFromReq, storagePathFromUrl, BUCKET } from '../_lib/imageusage.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ════════════════════════════════════════════════════════════════════════
// The media gallery.
//
// Upload a pile of mockups; for each one this answers "is this already on the
// store, and where?" — by fingerprint, not filename, so a resized re-export
// of a photo still recognises itself.
//
//   already in the gallery      → nothing is stored twice
//   already used on the store   → HER copy is discarded and the store's own
//                                 image is what lands in the gallery, carrying
//                                 the list of places it appears
//   looks like something used   → both are kept and shown side by side; she
//                                 decides. Never guessed at: front and back of
//                                 the same black leggings are 70 bits apart,
//                                 close enough that a silent auto-match would
//                                 throw away the wrong file.
//   new                         → stored, and flagged as used nowhere yet
//
// Everything fails soft: without the migration this answers "gallery not set
// up yet" instead of 500ing, and a supplier feed being down narrows what can
// be matched rather than breaking the page.
// ════════════════════════════════════════════════════════════════════════

const MISSING_TABLE = /relation .* does not exist|Could not find the table|schema cache/i
const SCAN_BUDGET_MS = 45000

function tableMissing(error) {
  return !!error && MISSING_TABLE.test(error.message || '')
}

function setupNeeded(res) {
  return res.status(200).json({
    needsSetup: true,
    error: 'Run supabase-media-gallery.sql in Supabase first — the gallery tables do not exist yet.',
    items: [], storeImages: [], scan: { total: 0, hashed: 0, remaining: 0 },
  })
}

// ── usage index, memoised briefly ───────────────────────────────────────
// Building it costs three feed calls; a gallery page load, an upload and a
// scan batch in quick succession shouldn't each pay for that. 60s is short
// enough that an un-assignment still reads as un-assigned right away.
let usageCache = { at: 0, origin: '', value: null }
let bucketCache = { at: 0, value: null }
async function bucketFiles({ fresh = false } = {}) {
  if (!fresh && bucketCache.value && Date.now() - bucketCache.at < 60000) return bucketCache.value
  const value = await listBucketFiles()
  bucketCache = { at: Date.now(), value }
  return value
}
async function usageIndex(origin, { fresh = false } = {}) {
  const age = Date.now() - usageCache.at
  if (!fresh && usageCache.value && usageCache.origin === origin && age < 60000) return usageCache.value
  const value = await buildUsageIndex(origin)
  usageCache = { at: Date.now(), origin, value }
  return value
}

const fpOf = row => ({ sha256: row.sha256, phash: row.phash, chash: row.chash, width: row.width, height: row.height })

// A gallery row plus everywhere the store currently shows that image.
// Usage is matched by URL first (exact truth) and then by fingerprint, which
// catches the same artwork served from a second URL — a supplier re-upload,
// or her own copy sitting next to the original.
function decorate(item, index, hashByKey) {
  const direct = index.byKey.get(item.url_key)
  const uses = [...(direct?.uses || [])]
  const alsoAt = []

  if (item.phash || item.sha256) {
    for (const img of index.images) {
      if (img.key === item.url_key || !img.uses.length) continue
      const h = hashByKey.get(img.key)
      if (!h) continue
      const m = matchLevel(fpOf(item), fpOf(h))
      if (m.level === 'exact' || m.level === 'sure') {
        alsoAt.push({ url: img.url, distance: m.distance, uses: img.uses })
        uses.push(...img.uses.map(u => ({ ...u, viaCopy: true })))
      }
    }
  }

  return {
    ...item,
    tags: Array.isArray(item.tags) ? item.tags : [],
    uses,
    alsoAt,
    used: uses.length > 0,
  }
}

export default async function handler(req, res) {
  const role = roleFromReq(req)
  if (!role) return res.status(401).json({ error: 'Unauthorized' })

  const origin = originFromReq(req)

  try {
    if (req.method === 'GET') return await handleGet(req, res, origin)
    if (req.method === 'POST') return await handlePost(req, res, origin)
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('Gallery error:', err)
    return res.status(500).json({ error: err.message })
  }
}

// ── GET: the gallery, plus what the store is using ──────────────────────
async function handleGet(req, res, origin) {
  const { data: items, error } = await supabase
    .from('media_library')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) {
    if (tableMissing(error)) return setupNeeded(res)
    return res.status(500).json({ error: error.message })
  }

  const [index, { data: hashes }] = await Promise.all([
    usageIndex(origin, { fresh: req.query.fresh === '1' }),
    supabase.from('media_hashes').select('*'),
  ])
  const hashByKey = new Map((hashes || []).map(h => [h.url_key, h]))

  const inGallery = new Set(items.map(i => i.url_key))
  const decorated = items.map(i => decorate(i, index, hashByKey))

  // Everything the store uses, so the UI can offer "add these to the gallery"
  // and show what's still unfingerprinted.
  const storeImages = index.images
    .filter(img => img.uses.length)
    .map(img => ({
      key: img.key,
      url: img.url,
      uses: img.uses,
      inGallery: inGallery.has(img.key),
      hashed: hashByKey.has(img.key) && !!hashByKey.get(img.key).phash,
      hashError: hashByKey.get(img.key)?.error || null,
    }))

  const scanKeys = await scanUniverse(index)
  const remaining = scanKeys.filter(k => !hashByKey.has(k.key)).length

  return res.status(200).json({
    items: decorated,
    storeImages,
    feedErrors: index.errors,
    scan: { total: scanKeys.length, hashed: scanKeys.length - remaining, remaining },
    stats: {
      total: decorated.length,
      used: decorated.filter(i => i.used).length,
      unused: decorated.filter(i => !i.used).length,
      pending: decorated.filter(i => i.pending_match).length,
      storeImages: storeImages.length,
      notInGallery: storeImages.filter(s => !s.inGallery).length,
    },
  })
}

// Everything worth fingerprinting: every image the store uses, plus every
// file sitting in our own bucket (so an orphan from a deleted product is
// recognised too, rather than uploaded all over again).
async function scanUniverse(index) {
  const seen = new Map()
  for (const img of index.images) {
    if (img.uses.length) seen.set(img.key, { key: img.key, url: img.url })
  }
  const files = await bucketFiles()
  for (const f of files) {
    const key = canonicalKey(f.url)
    if (!seen.has(key)) seen.set(key, { key, url: f.url })
  }
  return [...seen.values()]
}

// ── POST ────────────────────────────────────────────────────────────────
async function handlePost(req, res, origin) {
  const { action } = req.body || {}

  if (action === 'scan') return scanAction(req, res, origin)
  if (action === 'ingest') return ingestAction(req, res, origin)
  if (action === 'adopt') return adoptAction(req, res, origin)
  if (action === 'resolveMatch') return resolveMatchAction(req, res)
  if (action === 'tag') return tagAction(req, res)
  if (action === 'remove') return removeAction(req, res, origin)
  if (action === 'assign') return assignAction(req, res)

  return res.status(400).json({ error: 'Unknown action' })
}

// Fingerprint store images that don't have one yet, a batch at a time.
// Called in a loop by the UI with a progress bar; stops on a time budget so
// the function returns rather than being killed mid-batch.
async function scanAction(req, res, origin) {
  const limit = Math.min(Number(req.body.limit) || 12, 40)
  const index = await usageIndex(origin, { fresh: !!req.body.fresh })
  const universe = await scanUniverse(index)

  const { data: existing, error } = await supabase.from('media_hashes').select('url_key')
  if (error) {
    if (tableMissing(error)) return setupNeeded(res)
    return res.status(500).json({ error: error.message })
  }
  const have = new Set((existing || []).map(h => h.url_key))
  const todo = universe.filter(u => !have.has(u.key))

  const started = Date.now()
  const done = []
  const failed = []
  for (const item of todo.slice(0, limit)) {
    if (Date.now() - started > SCAN_BUDGET_MS) break
    const fp = await fingerprintUrl(item.url)
    const row = {
      url_key: item.key,
      url: item.url,
      sha256: fp.sha256 || null,
      phash: fp.phash || null,
      chash: fp.chash || null,
      width: fp.width || null,
      height: fp.height || null,
      bytes: fp.bytes || null,
      content_type: fp.content_type || null,
      error: fp.error || null,
      checked_at: new Date().toISOString(),
    }
    const { error: upErr } = await supabase.from('media_hashes').upsert(row, { onConflict: 'url_key' })
    if (upErr) return res.status(500).json({ error: upErr.message })
    if (fp.error) failed.push({ url: item.url, error: fp.error })
    else done.push(item.url)
  }

  return res.status(200).json({
    hashed: done.length,
    failed,
    remaining: Math.max(0, todo.length - done.length - failed.length),
    total: universe.length,
  })
}

function slugName(name = '') {
  return String(name).toLowerCase().replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'image'
}

async function storeUpload(buffer, contentType, filename) {
  const ext = (contentType.split('/')[1] || 'jpg').replace('jpeg', 'jpg').split('+')[0]
  const path = `gallery/${slugName(filename)}-${randomUUID().slice(0, 8)}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType, upsert: true })
  if (error) throw new Error(/bucket not found/i.test(error.message)
    ? 'Create a public Storage bucket named "store-media" in Supabase first.'
    : error.message)
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return { path, url: data.publicUrl }
}

// ── the upload path ─────────────────────────────────────────────────────
async function ingestAction(req, res, origin) {
  const { dataUrl, filename = 'image' } = req.body || {}
  if (!dataUrl || typeof dataUrl !== 'string') return res.status(400).json({ error: 'dataUrl required' })

  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/s)
  if (!m) return res.status(400).json({ error: 'Invalid image data' })
  const contentType = m[1]
  const buffer = Buffer.from(m[2], 'base64')
  const fp = fingerprint(buffer, contentType)

  const { data: libraryRows, error: libErr } = await supabase.from('media_library').select('*')
  if (libErr) {
    if (tableMissing(libErr)) return setupNeeded(res)
    return res.status(500).json({ error: libErr.message })
  }

  // 1) Already in the gallery? Then there is nothing to do — don't store a
  //    second copy of a file she already has here.
  const dupe = bestMatch(fp, libraryRows.map(r => ({ ...fpOf(r), row: r })))
  if (dupe && (dupe.level === 'exact' || dupe.level === 'sure')) {
    const index = await usageIndex(origin)
    const { data: hashes } = await supabase.from('media_hashes').select('*')
    const hashByKey = new Map((hashes || []).map(h => [h.url_key, h]))
    return res.status(200).json({
      status: 'duplicate',
      filename,
      match: { level: dupe.level, distance: dupe.distance },
      item: decorate(dupe.candidate.row, index, hashByKey),
    })
  }

  // 2) Already ON the store? Adopt the store's copy, discard hers.
  const index = await usageIndex(origin)
  const { data: hashes } = await supabase.from('media_hashes').select('*')
  const hashRows = hashes || []
  const hashByKey = new Map(hashRows.map(h => [h.url_key, h]))
  const usedKeys = new Set(index.images.filter(i => i.uses.length).map(i => i.key))

  const candidates = hashRows
    .filter(h => h.phash || h.sha256)
    .map(h => ({ ...fpOf(h), row: h, used: usedKeys.has(h.url_key) }))
  // A used image outranks an unused orphan at the same distance.
  candidates.sort((a, b) => Number(b.used) - Number(a.used))
  const found = bestMatch(fp, candidates)

  if (found && (found.level === 'exact' || found.level === 'sure')) {
    const row = found.candidate.row
    const img = index.byKey.get(row.url_key)
    const url = img?.url || row.url
    const item = await upsertLibraryRow({
      url,
      url_key: row.url_key,
      storage_path: storagePathFromUrl(url),
      origin: 'store',
      filename,
      sha256: row.sha256, phash: row.phash, chash: row.chash,
      width: row.width, height: row.height, bytes: row.bytes, content_type: row.content_type,
    })
    // A match against a file that's merely SITTING in storage is not the same
    // claim as a match against something the store is showing — say which.
    return res.status(200).json({
      status: img?.uses?.length ? 'in-use' : 'stored-already',
      filename,
      match: { level: found.level, distance: found.distance },
      item: decorate(item, index, hashByKey),
      uses: img?.uses || [],
    })
  }

  // 3) Close but not certain — keep BOTH and let her look at them.
  const stored = await storeUpload(buffer, contentType, filename)
  const maybe = found && found.level === 'maybe' ? found : null
  const pending = maybe ? {
    url: index.byKey.get(maybe.candidate.row.url_key)?.url || maybe.candidate.row.url,
    url_key: maybe.candidate.row.url_key,
    distance: maybe.distance,
    color: maybe.color,
    uses: index.byKey.get(maybe.candidate.row.url_key)?.uses || [],
  } : null

  const storedKey = canonicalKey(stored.url)
  const item = await upsertLibraryRow({
    url: stored.url,
    url_key: storedKey,
    storage_path: stored.path,
    origin: 'upload',
    filename,
    ...fp,
    pending_match: pending,
  })
  // Cache the fingerprint straight away so the very next file in the same
  // batch recognises it — without this, uploading the same photo twice in one
  // go stores it twice and only a later scan notices.
  await supabase.from('media_hashes').upsert({
    url_key: storedKey, url: stored.url, ...fp, error: null, checked_at: new Date().toISOString(),
  }, { onConflict: 'url_key' })

  return res.status(200).json({
    status: pending ? 'maybe' : 'new',
    filename,
    match: maybe ? { level: 'maybe', distance: maybe.distance } : null,
    item: decorate(item, index, hashByKey),
    candidate: pending,
  })
}

async function upsertLibraryRow(row) {
  const payload = { ...row, updated_at: new Date().toISOString() }
  // Keep a filename that's already there — hers named it first.
  const { data: existing } = await supabase.from('media_library').select('*').eq('url_key', row.url_key).maybeSingle()
  if (existing) {
    if (existing.filename) payload.filename = existing.filename
    const { data, error } = await supabase.from('media_library').update(payload).eq('id', existing.id).select().single()
    if (error) throw new Error(error.message)
    return data
  }
  const { data, error } = await supabase.from('media_library').insert(payload).select().single()
  if (error) throw new Error(error.message)
  return data
}

// Pull store images into the gallery without uploading anything — one, or
// every one that isn't in there yet.
async function adoptAction(req, res, origin) {
  const index = await usageIndex(origin, { fresh: true })
  const { data: hashes } = await supabase.from('media_hashes').select('*')
  const hashByKey = new Map((hashes || []).map(h => [h.url_key, h]))

  let keys = Array.isArray(req.body.keys) ? req.body.keys : null
  if (req.body.all) {
    const { data: have } = await supabase.from('media_library').select('url_key')
    const inGallery = new Set((have || []).map(h => h.url_key))
    keys = index.images.filter(i => i.uses.length && !inGallery.has(i.key)).map(i => i.key)
  }
  if (!keys || !keys.length) return res.status(400).json({ error: 'Nothing to add' })

  const added = []
  for (const key of keys) {
    const img = index.byKey.get(key)
    if (!img) continue
    const h = hashByKey.get(key) || {}
    const item = await upsertLibraryRow({
      url: img.url,
      url_key: key,
      storage_path: storagePathFromUrl(img.url),
      origin: 'store',
      filename: null,
      sha256: h.sha256 || null, phash: h.phash || null, chash: h.chash || null,
      width: h.width || null, height: h.height || null, bytes: h.bytes || null,
      content_type: h.content_type || null,
    })
    added.push(item.id)
  }
  return res.status(200).json({ ok: true, added: added.length })
}

// Her verdict on a "looks like this one" pair.
//   same = true  → her file goes, the store's image takes its place
//   same = false → keep hers, drop the suggestion
async function resolveMatchAction(req, res) {
  const { id, same } = req.body || {}
  if (!id) return res.status(400).json({ error: 'id required' })

  const { data: row, error } = await supabase.from('media_library').select('*').eq('id', id).single()
  if (error) return res.status(500).json({ error: error.message })
  if (!row.pending_match) return res.status(200).json({ ok: true, note: 'nothing pending' })

  if (!same) {
    const { error: upErr } = await supabase.from('media_library')
      .update({ pending_match: null, updated_at: new Date().toISOString() }).eq('id', id)
    if (upErr) return res.status(500).json({ error: upErr.message })
    return res.status(200).json({ ok: true, kept: true })
  }

  const target = row.pending_match
  const { data: h } = await supabase.from('media_hashes').select('*').eq('url_key', target.url_key).maybeSingle()

  // The store's copy takes the slot — carrying her filename and tags across.
  await supabase.from('media_library').delete().eq('id', id)
  if (row.storage_path) await supabase.storage.from(BUCKET).remove([row.storage_path])

  const item = await upsertLibraryRow({
    url: target.url,
    url_key: target.url_key,
    storage_path: storagePathFromUrl(target.url),
    origin: 'store',
    filename: row.filename,
    sha256: h?.sha256 || null, phash: h?.phash || null, chash: h?.chash || null,
    width: h?.width || null, height: h?.height || null, bytes: h?.bytes || null,
    content_type: h?.content_type || null,
    tags: row.tags || [],
    note: row.note || null,
  })
  return res.status(200).json({ ok: true, replaced: true, item })
}

async function tagAction(req, res) {
  const { id, tags, note } = req.body || {}
  if (!id) return res.status(400).json({ error: 'id required' })
  const payload = { updated_at: new Date().toISOString() }
  if (tags !== undefined) {
    payload.tags = (Array.isArray(tags) ? tags : String(tags).split(','))
      .map(t => String(t).trim()).filter(Boolean).slice(0, 24)
  }
  if (note !== undefined) payload.note = note || null
  const { data, error } = await supabase.from('media_library').update(payload).eq('id', id).select().single()
  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ ok: true, item: data })
}

// Refuses to delete anything the store is still showing — the gallery must
// never be the reason a product page loses its photo.
async function removeAction(req, res, origin) {
  const { id } = req.body || {}
  if (!id) return res.status(400).json({ error: 'id required' })

  const { data: row, error } = await supabase.from('media_library').select('*').eq('id', id).single()
  if (error) return res.status(500).json({ error: error.message })

  const index = await usageIndex(origin, { fresh: true })
  const uses = index.byKey.get(row.url_key)?.uses || []
  if (uses.length && !req.body.force) {
    return res.status(409).json({
      error: `This photo is still on the store — ${uses.map(u => u.label).join(', ')}. Take it off there first.`,
      uses,
    })
  }

  if (row.storage_path) {
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove([row.storage_path])
    if (rmErr) return res.status(500).json({ error: rmErr.message })
  }
  const { error: delErr } = await supabase.from('media_library').delete().eq('id', id)
  if (delErr) return res.status(500).json({ error: delErr.message })
  return res.status(200).json({ ok: true, deletedFile: !!row.storage_path })
}

// Put a gallery image to work: onto a product, a category, or a collection.
// Nothing is copied — the same URL is what the store starts serving, which is
// exactly what makes "used / not used" answerable afterwards.
async function assignAction(req, res) {
  const { id, target } = req.body || {}
  if (!id || !target?.kind) return res.status(400).json({ error: 'id and target required' })

  const { data: row, error } = await supabase.from('media_library').select('*').eq('id', id).single()
  if (error) return res.status(500).json({ error: error.message })
  const url = row.url

  if (target.kind === 'category') {
    const { error: e } = await supabase.from('categories').update({ image_url: url }).eq('id', target.refId)
    if (e) return res.status(500).json({ error: e.message })
  } else if (target.kind === 'collection') {
    const { error: e } = await supabase.from('collections').update({ image_url: url }).eq('id', target.refId)
    if (e) return res.status(500).json({ error: e.message })
  } else if (target.kind === 'product') {
    // ⚠️ product_overrides is a whole-row upsert: every other field has to be
    // carried or a photo assignment silently wipes the rename / price /
    // description sitting on the same row.
    const { data: cur } = await supabase.from('product_overrides').select('*').eq('product_id', target.refId).maybeSingle()
    const images = Array.isArray(cur?.image_urls) ? cur.image_urls : []
    if (images.includes(url)) return res.status(200).json({ ok: true, note: 'already on that product' })
    const { error: e } = await supabase.from('product_overrides').upsert({
      product_id: target.refId,
      image_urls: [...images, url],
      name: cur?.name ?? null,
      price: cur?.price ?? null,
      description: cur?.description ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'product_id' })
    if (e) return res.status(500).json({ error: e.message })
  } else {
    return res.status(400).json({ error: 'Unknown target kind' })
  }

  // The assignment changes what "used" means — don't answer from a stale index.
  usageCache = { at: 0, origin: '', value: null }
  return res.status(200).json({ ok: true })
}
