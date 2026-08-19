#!/usr/bin/env node
/**
 * Rasterize apps/web/public/favicon.svg into apps/cli/assets/dsh-web.ico.
 * Uses @resvg/resvg-js (install anywhere and pass RESVG_MODULE, or keep the
 * default temp install path used when regenerating on Windows).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const svgPath = join(root, 'apps', 'web', 'public', 'favicon.svg')
const outPath = join(root, 'apps', 'cli', 'assets', 'dsh-web.ico')
const sizes = [16, 32, 48, 256]
const resvgModule = process.env.RESVG_MODULE
  ?? pathToFileURL(join(process.env.TEMP ?? '/tmp', 'dsh-resvg', 'node_modules', '@resvg', 'resvg-js', 'index.js')).href

function packIco(pngs) {
  const count = pngs.length
  let offset = 6 + 16 * count
  const entries = pngs.map((png, index) => {
    const entry = { png, offset, size: png.length, dim: sizes[index] ?? 0 }
    offset += png.length
    return entry
  })
  const buf = Buffer.alloc(offset)
  buf.writeUInt16LE(0, 0)
  buf.writeUInt16LE(1, 2)
  buf.writeUInt16LE(count, 4)
  for (const [index, entry] of entries.entries()) {
    const base = 6 + 16 * index
    const dim = entry.dim >= 256 ? 0 : entry.dim
    buf.writeUInt8(dim, base)
    buf.writeUInt8(dim, base + 1)
    buf.writeUInt8(0, base + 2)
    buf.writeUInt8(0, base + 3)
    buf.writeUInt16LE(1, base + 4)
    buf.writeUInt16LE(32, base + 6)
    buf.writeUInt32LE(entry.size, base + 8)
    buf.writeUInt32LE(entry.offset, base + 12)
    entry.png.copy(buf, entry.offset)
  }
  return buf
}

const { Resvg } = await import(resvgModule)
const svg = readFileSync(svgPath, 'utf8').replace(/<style>[\s\S]*?<\/style>/, '')
const pngs = sizes.map((size) => {
  const rendered = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
  }).render().asPng()
  const png = Buffer.from(rendered)
  if (png[0] !== 0x89 || png[1] !== 0x50) throw new Error('resvg did not emit PNG for ' + String(size))
  return png
})
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, packIco(pngs))
console.log('wrote ' + outPath + ' (' + sizes.join(', ') + ' px)')
