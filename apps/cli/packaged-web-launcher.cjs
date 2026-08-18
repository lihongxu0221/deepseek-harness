#!/usr/bin/env node
/**
 * Thin packaged Web desktop launcher. Node's SEA embedder runs this file as
 * CommonJS (`embedderRunCjs`); the CLI closure stays on disk beside the
 * executable so profile module fallback can symlink real packages.
 * A first extra argument that names an existing .js/.cjs/.mjs file is
 * imported instead of the GUI entry, so spawn(process.execPath, [worker])
 * from a packaged host behaves like node.
 */

'use strict'

const { existsSync } = require('node:fs')
const { basename, dirname, extname, join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')

const SCRIPT_EXTS = new Set(['.js', '.cjs', '.mjs'])
const LAUNCHER_BASENAMES = new Set([
  'packaged-web-launcher.cjs',
  'packaged-web-bin.js',
])

function sameResolvedPath(left, right) {
  const a = resolve(left)
  const b = resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function extraPackagedArgv(argv, launcherPath) {
  const execPath = argv[0]
  const rest = argv.slice(1)
  const skip = (value) =>
    (execPath !== undefined && sameResolvedPath(value, execPath))
    || sameResolvedPath(value, launcherPath)
    || LAUNCHER_BASENAMES.has(basename(value).toLowerCase())
  let index = 0
  while (index < rest.length && skip(rest[index] ?? '')) index += 1
  return rest.slice(index)
}

function resolvePackagedScriptArg(args) {
  const candidate = args[0]
  if (candidate === undefined) return undefined
  if (!SCRIPT_EXTS.has(extname(candidate).toLowerCase())) return undefined
  if (!existsSync(candidate)) return undefined
  return resolve(candidate)
}

const script = resolvePackagedScriptArg(extraPackagedArgv(process.argv, __filename))
const entry = script ?? join(dirname(process.execPath), 'lib', 'packaged-web-bin.js')
if (!existsSync(entry)) {
  throw new Error(
    `dsh-web: missing ${entry}. Keep this executable inside the built folder; do not copy the .exe alone.`,
  )
}

import(pathToFileURL(entry).href).catch((error) => {
  console.error(error)
  process.exit(1)
})
