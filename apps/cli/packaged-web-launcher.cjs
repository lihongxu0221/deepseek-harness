#!/usr/bin/env node
/**
 * Thin packaged Web desktop launcher. Node's SEA embedder runs this file as
 * CommonJS (`embedderRunCjs`); the CLI closure stays on disk beside the
 * executable so profile module fallback can symlink real packages.
 * A first extra argument that names an existing .js/.cjs/.mjs file is
 * imported instead of the GUI entry, so spawn(process.execPath, [worker])
 * from a packaged host behaves like node. That import first rewrites
 * process.argv to [execPath, script, ...scriptArgs] so the worker's
 * process.argv.slice(2) matches Node.
 */

'use strict'

const { existsSync } = require('node:fs')
const cp = require('node:child_process')
const { basename, dirname, extname, join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')

// Hide every child console on Windows. The packaged host is a GUI process
// without its own console, so a child spawned without windowsHide — git from
// a sidebar plugin, pnpm from the market, any future plugin's CLI helper —
// allocates a new, visible, empty console window. Third-party plugins cannot
// be fixed per callsite, so wrap the whole child_process export family here,
// before any ESM import creates the node:child_process facade; every later
// `import { spawn } from 'node:child_process'` sees the wrapped functions.
// The override is unconditional: this product never shows a console window.
if (process.platform === 'win32') {
  const hideOptions = (options) => {
    if (options === undefined || options === null || typeof options !== 'object' || Array.isArray(options)) {
      return { windowsHide: true }
    }
    return { ...options, windowsHide: true }
  }
  const wrapArgv = (fn) => function windowsHiddenSpawn(file, args, options) {
    if (Array.isArray(args) || args === undefined || args === null) {
      return fn.call(this, file, args, hideOptions(options))
    }
    return fn.call(this, file, hideOptions(args))
  }
  const wrapExec = (fn) => function windowsHiddenExec(command, options, callback) {
    if (typeof options === 'function') return fn.call(this, command, hideOptions(), options)
    return fn.call(this, command, hideOptions(options), callback)
  }
  const wrapExecFile = (fn) => function windowsHiddenExecFile(file, args, options, callback) {
    if (Array.isArray(args) || args === undefined || args === null) {
      if (typeof options === 'function') return fn.call(this, file, args, hideOptions(), options)
      return fn.call(this, file, args, hideOptions(options), callback)
    }
    if (typeof args === 'function') return fn.call(this, file, hideOptions(), args)
    // execFile(file, options[, callback]): the args slot carries the options.
    if (typeof options === 'function') return fn.call(this, file, hideOptions(args), options)
    return fn.call(this, file, hideOptions(args), callback)
  }
  cp.spawn = wrapArgv(cp.spawn)
  cp.spawnSync = wrapArgv(cp.spawnSync)
  cp.exec = wrapExec(cp.exec)
  cp.execSync = wrapExec(cp.execSync)
  cp.execFile = wrapExecFile(cp.execFile)
  cp.execFileSync = wrapExecFile(cp.execFileSync)
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

const extra = extraPackagedArgv(process.argv, __filename)
const script = resolvePackagedScriptArg(extra)
if (script !== undefined) {
  process.argv = [process.execPath, script, ...extra.slice(1)]
}
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
