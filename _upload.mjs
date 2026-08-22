// Push a folder of mockups through the REAL gallery endpoint — the same path
// her browser takes, so every file gets the same matching, de-duping and
// "where is this used" answer. Usage:
//   ADMIN_KEY=... node _upload.mjs [folder]
import fs from 'fs'
import path from 'path'
import { decodeImage } from './api/_lib/imagehash.js'
import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'

const ORIGIN = process.env.ORIGIN || 'https://www.shiftapparelco.com'
const KEY = process.env.ADMIN_KEY
const DIR = process.argv[2] || '/Users/tovahmarx/Desktop/SHIFT'
if (!KEY) { console.error('ADMIN_KEY missing'); process.exit(1) }

const MAX_DIM = 1600
const MAX_DATAURL = 3_300_000   // Vercel caps the body at ~4.5MB; base64 adds a third

function boxResize(dec, ow, oh) {
  const out = Buffer.alloc(ow * oh * 4)
  for (let oy = 0; oy < oh; oy++) {
    const y0 = Math.floor(oy * dec.height / oh), y1 = Math.max(y0 + 1, Math.floor((oy + 1) * dec.height / oh))
    for (let ox = 0; ox < ow; ox++) {
      const x0 = Math.floor(ox * dec.width / ow), x1 = Math.max(x0 + 1, Math.floor((ox + 1) * dec.width / ow))
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * dec.width + x) * 4
        r += dec.data[i]; g += dec.data[i + 1]; b += dec.data[i + 2]; a += dec.data[i + 3]; n++
      }
      const o = (oy * ow + ox) * 4
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n
    }
  }
  return { data: out, width: ow, height: oh }
}

// Flatten onto WHITE, matching what the server composites transparency onto,
// so a transparent mockup still fingerprints the same after a JPEG fallback.
function onWhite(dec) {
  const out = Buffer.alloc(dec.width * dec.height * 4)
  for (let i = 0; i < out.length; i += 4) {
    const al = dec.data[i + 3] / 255
    out[i] = dec.data[i] * al + 255 * (1 - al)
    out[i + 1] = dec.data[i + 1] * al + 255 * (1 - al)
    out[i + 2] = dec.data[i + 2] * al + 255 * (1 - al)
    out[i + 3] = 255
  }
  return { data: out, width: dec.width, height: dec.height }
}

function toDataUrl(file) {
  const buf = fs.readFileSync(file)
  const isPng = /\.png$/i.test(file)
  const dec = decodeImage(buf, isPng ? 'image/png' : 'image/jpeg')
  if (!dec) return null
  let img = dec
  if (Math.max(dec.width, dec.height) > MAX_DIM) {
    const s = MAX_DIM / Math.max(dec.width, dec.height)
    img = boxResize(dec, Math.round(dec.width * s), Math.round(dec.height * s))
  }
  let type = isPng ? 'image/png' : 'image/jpeg'
  let bytes = isPng
    ? PNG.sync.write(Object.assign(new PNG({ width: img.width, height: img.height }), { data: Buffer.from(img.data) }))
    : jpeg.encode({ data: Buffer.from(img.data), width: img.width, height: img.height }, 88).data
  let url = `data:${type};base64,${bytes.toString('base64')}`
  if (url.length > MAX_DATAURL) {
    const flat = onWhite(img)
    bytes = jpeg.encode({ data: Buffer.from(flat.data), width: flat.width, height: flat.height }, 88).data
    type = 'image/jpeg'
    url = `data:${type};base64,${bytes.toString('base64')}`
  }
  return { url, w: img.width, h: img.height, kb: Math.round(bytes.length / 1024) }
}

const files = fs.readdirSync(DIR).filter(f => /\.(png|jpe?g)$/i.test(f)).sort()
const skipped = fs.readdirSync(DIR).filter(f => !/\.(png|jpe?g)$/i.test(f) && !f.startsWith('.'))
console.log(`${files.length} images to send${skipped.length ? `  ·  skipping ${skipped.join(', ')}` : ''}\n`)

const tally = {}
const detail = []
for (let i = 0; i < files.length; i++) {
  const f = files[i]
  const label = `${String(i + 1).padStart(2)}/${files.length}  ${f.slice(0, 46).padEnd(46)}`
  let prepped
  try { prepped = toDataUrl(path.join(DIR, f)) } catch (e) { console.log(`${label} could not read — ${e.message}`); tally.error = (tally.error||0)+1; continue }
  if (!prepped) { console.log(`${label} could not read that image`); tally.error = (tally.error||0)+1; continue }
  try {
    const res = await fetch(`${ORIGIN}/api/admin/gallery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': KEY },
      body: JSON.stringify({ action: 'ingest', dataUrl: prepped.url, filename: f }),
    })
    const json = await res.json()
    if (!res.ok) { console.log(`${label} FAILED — ${json.error}`); tally.error = (tally.error||0)+1; continue }
    if (json.needsSetup) { console.log(`\n${json.error}`); process.exit(1) }
    const uses = (json.item?.uses || json.uses || [])
    tally[json.status] = (tally[json.status] || 0) + 1
    detail.push({ file: f, status: json.status, distance: json.match?.distance ?? null, uses })
    const where = uses.length ? ' → ' + uses.map(u => `${u.label}${u.sub ? ` (${u.sub})` : ''}`).join(' | ').slice(0, 80) : ''
    console.log(`${label} ${json.status.padEnd(15)}${json.match ? `d=${String(json.match.distance).padStart(3)} ` : '     '}${where}`)
  } catch (e) {
    console.log(`${label} FAILED — ${e.message}`); tally.error = (tally.error||0)+1
  }
}
console.log('\n── ' + Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(' · '))
fs.writeFileSync('/private/tmp/claude-501/-Users-tovahmarx/ad473e77-8876-4269-8841-25575bf41395/scratchpad/shift-upload-result.json', JSON.stringify(detail, null, 1))
