import { readFileSync, writeFileSync } from 'node:fs'

const src = readFileSync('apps/cli/src/windows-desktop-shell.ps1', 'utf8')
  .replace(/^\uFEFF/, '')
  .replace(/\r\n/g, '\n')
const tsPath = 'apps/cli/src/windows-desktop-shell.ts'
const ts = readFileSync(tsPath, 'utf8')
const pattern = /export const WINDOWS_DESKTOP_SHELL_SCRIPT = "[\s\S]*?"\n/
if (!pattern.test(ts)) {
  console.error('embed target not found in', tsPath)
  process.exit(1)
}
const next = ts.replace(
  pattern,
  `export const WINDOWS_DESKTOP_SHELL_SCRIPT = ${JSON.stringify(src)}\n`,
)
if (next === ts) {
  console.log(`already current (${String(src.length)} chars)`)
} else {
  writeFileSync(tsPath, next)
  console.log(`embedded ${String(src.length)} chars`)
}
