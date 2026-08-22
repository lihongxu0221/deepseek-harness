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
const cp = require('node:child_process')
const { basename, dirname, extname, join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')

// Hide the cmd.exe consoles the Plugin Market opens (`cmd /c pnpm --version`
// on first open, `cmd /c dsh plugin …` per install). Those calls live in
// dshmarket and cannot set windowsHide themselves. Patching here — before
// any ESM import creates the node:child_process facade — lets every later
// `import { spawn } from 'node:child_process'` see the wrapped functions.
if (process.platform === 'win32') {
  const CONSOLE_STEMS = new Set(['cmd', 'powershell', 'pwsh'])
  const hideOptions = (options) => {
    if (options === undefined || options === null || typeof options !== 'object' || Array.isArray(options)) {
      return { windowsHide: true }
    }
    return { ...options, windowsHide: true }
  }
  const shouldHideConsole = (file, args, options) => {
    const opts = Array.isArray(args) || args === undefined ? options : args
    if (opts !== undefined && opts !== null && typeof opts === 'object' && !Array.isArray(opts) && opts.shell === true) {
      return true
    }
    const name = basename(String(file ?? '')).toLowerCase()
    const stem = name.replace(/\.exe$/u, '')
    return CONSOLE_STEMS.has(stem) || name.endsWith('.cmd') || name.endsWith('.bat')
  }
  const wrap = (fn) => function windowsHiddenSpawn(file, args, options) {
    const hide = shouldHideConsole(file, args, options)
    if (Array.isArray(args) || args === undefined) {
      return fn.call(this, file, args, hide ? hideOptions(options) : options)
    }
    return fn.call(this, file, hide ? hideOptions(args) : args)
  }
  cp.spawn = wrap(cp.spawn)
  cp.spawnSync = wrap(cp.spawnSync)
}

const SCRIPT_EXTS = new Set(['.js', '.cjs', '.mjs'])
const LAUNCHER_BASENAMES = new Set([
  'packaged-web-launcher.cjs',
  'packaged-web-bin.js',
])
const INVOCATION_STEMS = new Set(['dsh', 'dsh-web'])

function sameResolvedPath(left, right) {
  const a = resolve(left)
  const b = resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function invocationStem(value) {
  return basename(value).toLowerCase().replace(/\.(?:exe)$/u, '')
}

function isInvocationEcho(value, execPath) {
  if (value.startsWith('-')) return false
  if (sameResolvedPath(value, execPath)) return true
  const token = invocationStem(value)
  return token === invocationStem(execPath) || INVOCATION_STEMS.has(token)
}

function extraPackagedArgv(argv, launcherPath) {
  const invokedAs = argv[0]
  const rest = argv.slice(1)
  const skip = (value) =>
    (invokedAs !== undefined && sameResolvedPath(value, invokedAs))
    // The SEA normalizes argv[0] to the executable path and preserves the
    // token as typed (`dsh`, `dsh.exe`, any absolute spelling) in the next
    // slot; that echo is never an argument, a script, or an option.
    || isInvocationEcho(value, process.execPath)
    || sameResolvedPath(value, launcherPath)
    || sameResolvedPath(value, join(dirname(process.execPath), 'lib', 'bin.js'))
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
