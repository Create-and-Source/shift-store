import { createHash } from 'crypto'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'

// ════════════════════════════════════════════════════════════════════════
// Image fingerprinting for the media gallery.
//
// Three fingerprints per image:
//   sha256 — exact bytes. Certain, but only fires on a byte-identical file.
//   phash  — a 1024-bit difference hash (dHash, 33×32 grayscale). Survives
//            resizing and re-compression, so the 1400px JPEG the browser
//            uploads still matches the 4000px original on the store.
//   chash  — a 4×4 grid of average RGB. dHash is nearly colour-blind; this
//            keeps two colourways of the same mockup from reading as one.
//
// Everything is PURE JS on purpose (jpeg-js + pngjs, no native binaries) so
// the same code produces the same bits on this Mac and in a Vercel function
// — a perceptual hash is only useful if every machine agrees on it. The
// store's images are all PNG or JPEG (verified across all three feeds,
// Supabase storage and /public); anything else gets sha256 only rather than
// a guessed-at fingerprint.
//
// ── Thresholds are CALIBRATED, not guessed (2026-08-21, real store images):
//      same image, browser upload pipeline (1400px + JPEG q82) →  19 / 1024
//      same image, FE "product" vs "zoom" rendition           →   9 / 1024
//      DIFFERENT: front vs back of the same black leggings    →  70 / 1024
//      DIFFERENT: leggings vs hoodie                          → 337 / 1024
//    Front and back of a plain black legging are 7 bits apart at 256-bit
//    resolution — which is why this runs at 1024. Auto-adopt sits at 40,
//    comfortably above every same-image case and comfortably below 70.
// ════════════════════════════════════════════════════════════════════════

const HASH_W = 33   // 33 columns → 32 left-to-right comparisons per row
const HASH_H = 32   // × 32 rows = 1024 bits
export const PHASH_BITS = (HASH_W - 1) * HASH_H

export const MATCH_SURE = 40    // ≤ this (and colour agrees) = same image, act on it
export const MATCH_MAYBE = 110  // ≤ this = show her both and let her decide
export const COLOR_SURE = 12    // mean abs RGB difference per channel
export const COLOR_MAYBE = 45
const TINY_EDGE = 100           // below this, a thumbnail is too coarse to trust

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

// ── decode ──────────────────────────────────────────────────────────────
// Returns { data: RGBA bytes, width, height } or null for anything we can't
// read. Never throws — an undecodable image is a fact to record, not a crash.
export function decodeImage(buffer, contentType = '') {
  try {
    const isPng = /png/i.test(contentType) || (buffer[0] === 0x89 && buffer[1] === 0x50)
    const isJpg = /jpe?g/i.test(contentType) || (buffer[0] === 0xff && buffer[1] === 0xd8)
    if (isPng) {
      const png = PNG.sync.read(buffer)
      return { data: png.data, width: png.width, height: png.height }
    }
    if (isJpg) {
      const img = jpeg.decode(buffer, { useTArray: true, maxMemoryUsageInMB: 512 })
      return { data: img.data, width: img.width, height: img.height }
    }
    return null
  } catch {
    return null
  }
}

// ── grayscale box-downscale ─────────────────────────────────────────────
// Averages each source region rather than sampling one pixel, so two
// renditions of the same artwork at different sizes converge on the same
// small image. Alpha composites onto WHITE — mockups are routinely
// transparent PNGs, and every copy has to land on the same background or the
// fingerprints drift apart.
function grayResize({ data, width, height }, outW, outH) {
  const out = new Float64Array(outW * outH)
  for (let oy = 0; oy < outH; oy++) {
    const y0 = Math.floor((oy * height) / outH)
    const y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * height) / outH))
    for (let ox = 0; ox < outW; ox++) {
      const x0 = Math.floor((ox * width) / outW)
      const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * width) / outW))
      let sum = 0, n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4
          const a = data[i + 3] / 255
          const r = data[i] * a + 255 * (1 - a)
          const g = data[i + 1] * a + 255 * (1 - a)
          const b = data[i + 2] * a + 255 * (1 - a)
          sum += 0.299 * r + 0.587 * g + 0.114 * b
          n++
        }
      }
      out[oy * outW + ox] = n ? sum / n : 0
    }
  }
  return out
}

// ── dHash ───────────────────────────────────────────────────────────────
export function dhash(decoded) {
  if (!decoded || !decoded.width || !decoded.height) return null
  const g = grayResize(decoded, HASH_W, HASH_H)
  let hex = '', bits = 0, acc = 0
  for (let y = 0; y < HASH_H; y++) {
    for (let x = 0; x < HASH_W - 1; x++) {
      acc = (acc << 1) | (g[y * HASH_W + x] > g[y * HASH_W + x + 1] ? 1 : 0)
      if (++bits === 4) { hex += acc.toString(16); bits = 0; acc = 0 }
    }
  }
  return hex
}

// ── colour signature ────────────────────────────────────────────────────
// 4×4 grid of average RGB, hex-packed (96 chars). Samples every other pixel
// — plenty for an average, a quarter of the work.
export function chash(decoded, n = 4) {
  if (!decoded || !decoded.width || !decoded.height) return null
  const { data, width, height } = decoded
  let hex = ''
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      const y0 = Math.floor((gy * height) / n), y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / n))
      const x0 = Math.floor((gx * width) / n), x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / n))
      let r = 0, g = 0, b = 0, c = 0
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * width + x) * 4
          const a = data[i + 3] / 255
          r += data[i] * a + 255 * (1 - a)
          g += data[i + 1] * a + 255 * (1 - a)
          b += data[i + 2] * a + 255 * (1 - a)
          c++
        }
      }
      if (!c) { hex += '000000'; continue }
      hex += [r / c, g / c, b / c].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
    }
  }
  return hex
}

const POPCOUNT = new Uint8Array(16)
for (let i = 0; i < 16; i++) POPCOUNT[i] = (i & 1) + ((i >> 1) & 1) + ((i >> 2) & 1) + ((i >> 3) & 1)

// Hamming distance between two hex phashes. Infinity when either is missing
// or they're different lengths — an unknown distance must never read as a
// close one. (Different lengths also means one predates a hash change.)
export function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity
  let d = 0
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    if (Number.isNaN(x)) return Infinity
    d += POPCOUNT[x]
  }
  return d
}

// Mean absolute per-channel difference between two colour signatures.
export function colorDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity
  let s = 0
  for (let i = 0; i < a.length; i += 2) s += Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16))
  return Math.round(s / (a.length / 2))
}

// ── the verdict ─────────────────────────────────────────────────────────
// 'exact' | 'sure' | 'maybe' | null. Only 'exact' and 'sure' are ever acted
// on without asking; 'maybe' is shown side by side for her to judge.
export function matchLevel(a, b) {
  if (!a || !b) return { level: null, distance: Infinity, color: Infinity }
  if (a.sha256 && b.sha256 && a.sha256 === b.sha256) return { level: 'exact', distance: 0, color: 0 }
  const distance = hamming(a.phash, b.phash)
  const color = colorDistance(a.chash, b.chash)
  if (distance === Infinity) return { level: null, distance, color }
  // A thumbnail small enough to have lost its detail can only ever be a
  // "maybe" — at 52×78 a hoodie front and its own zoom sat 30 bits apart.
  const tiny = Math.max(a.width || 0, a.height || 0) < TINY_EDGE || Math.max(b.width || 0, b.height || 0) < TINY_EDGE
  if (!tiny && distance <= MATCH_SURE && color <= COLOR_SURE) return { level: 'sure', distance, color }
  if (distance <= MATCH_MAYBE && color <= COLOR_MAYBE) return { level: 'maybe', distance, color }
  return { level: null, distance, color }
}

// ── one-shot fingerprint ────────────────────────────────────────────────
export function fingerprint(buffer, contentType = '') {
  const decoded = decodeImage(buffer, contentType)
  return {
    sha256: sha256(buffer),
    phash: decoded ? dhash(decoded) : null,
    chash: decoded ? chash(decoded) : null,
    width: decoded?.width || null,
    height: decoded?.height || null,
    bytes: buffer.length,
    content_type: contentType || null,
  }
}

const MAX_BYTES = 16 * 1024 * 1024
const FETCH_MS = 20000

// Fetch a remote image and fingerprint it. Resolves to { error } instead of
// throwing, so one dead CDN URL can never sink a whole scan batch.
export async function fingerprintUrl(url) {
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), FETCH_MS)
    let res
    try {
      res = await fetch(url, { signal: ctl.signal, headers: { Accept: 'image/*,*/*' } })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) return { error: `HTTP ${res.status}` }
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length) return { error: 'empty response' }
    if (buf.length > MAX_BYTES) return { error: `too large (${Math.round(buf.length / 1e6)} MB)` }
    const fp = fingerprint(buf, res.headers.get('content-type') || '')
    if (!fp.phash) return { ...fp, error: 'could not read this image format' }
    return fp
  } catch (err) {
    return { error: err.name === 'AbortError' ? 'timed out' : err.message }
  }
}

// Best match for `fp` among candidates, preferring exact → sure → maybe and
// then the smallest distance. candidates: [{ sha256, phash, chash, ... }]
export function bestMatch(fp, candidates) {
  const RANK = { exact: 0, sure: 1, maybe: 2 }
  let best = null
  for (const c of candidates) {
    const m = matchLevel(fp, c)
    if (!m.level) continue
    if (!best || RANK[m.level] < RANK[best.level] || (RANK[m.level] === RANK[best.level] && m.distance < best.distance)) {
      best = { ...m, candidate: c }
    }
  }
  return best
}
