import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const ADMIN_KEY = process.env.ADMIN_KEY || 'shift-admin-2026'
const BUCKET = 'store-media'

// Admin image upload: accepts a base64 data URL (the client resizes/compresses
// before sending so payloads stay small), stores it in the `store-media`
// Supabase Storage bucket, and returns a public URL to save on a product or
// category. No-ops with a clear error if the bucket doesn't exist yet.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const { dataUrl, folder = 'uploads', name = 'image' } = req.body || {}
    if (!dataUrl || typeof dataUrl !== 'string') {
      return res.status(400).json({ error: 'dataUrl required' })
    }

    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s)
    if (!match) return res.status(400).json({ error: 'Invalid image data' })

    const contentType = match[1]
    const buffer = Buffer.from(match[2], 'base64')

    const ext = (contentType.split('/')[1] || 'jpg').replace('jpeg', 'jpg').split('+')[0]
    const safeName = String(name).toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'image'
    const safeFolder = String(folder).toLowerCase().replace(/[^a-z0-9/]+/g, '-').replace(/^-+|-+$/g, '') || 'uploads'
    const path = `${safeFolder}/${safeName}-${randomUUID().slice(0, 8)}.${ext}`

    const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
      contentType,
      upsert: true,
    })
    if (error) {
      const hint = /bucket not found/i.test(error.message)
        ? 'Create a public Storage bucket named "store-media" in Supabase first.'
        : error.message
      return res.status(500).json({ error: hint })
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
    return res.status(200).json({ url: data.publicUrl, path })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
