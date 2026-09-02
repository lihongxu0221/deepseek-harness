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

// Attach a hidden console on Windows GUI hosts, then wrap child_process so
// callers that leave windowsHide unset inherit that console instead of
// CREATE_NO_WINDOW. CREATE_NO_WINDOW hides a direct CUI child but leaves its
// CUI grandchildren (pwsh spawning git) without a console, so they allocate a
// new, visible, empty console window. Restricted-token sandbox children also
// cannot use CREATE_NO_WINDOW. Restoring stdin/stdout/stderr after AllocConsole
// keeps piped stdio and leaves Node's already-opened streams non-TTY.
// The wrap still injects windowsHide when AllocConsole does not attach, which
// is the fallback for a GUI host with no console. An explicit caller-owned
// windowsHide always wins: CREATE_NO_WINDOW also seeds STARTUPINFO with SW_HIDE,
// which hides the first GUI window of Chromium-style children, so
// window-spawning helpers declare false.
function attachHiddenConsole() {
  if (process.platform !== 'win32') return false
  try {
    const { createRequire } = require('node:module')
    const onDisk = join(dirname(process.execPath), 'lib', 'packaged-web-bin.js')
    const req = existsSync(onDisk) ? createRequire(onDisk) : createRequire(__filename)
    const koffi = req('koffi')
    const kernel32 = koffi.load('kernel32.dll')
    const user32 = koffi.load('user32.dll')
    const stdcall = (lib, name, result, args) => lib.func('__stdcall', name, result, args)
    const GetConsoleWindow = stdcall(kernel32, 'GetConsoleWindow', 'void*', [])
    const isNullHwnd = (value) => value === null || value === undefined || value === 0 || value === 0n
    if (!isNullHwnd(GetConsoleWindow())) return true
    const GetStdHandle = stdcall(kernel32, 'GetStdHandle', 'void*', ['int'])
    const SetStdHandle = stdcall(kernel32, 'SetStdHandle', 'int', ['int', 'void*'])
    const AllocConsole = stdcall(kernel32, 'AllocConsole', 'int', [])
    const ShowWindow = stdcall(user32, 'ShowWindow', 'int', ['void*', 'int'])
    const STD_INPUT_HANDLE = -10
    const STD_OUTPUT_HANDLE = -11
    const STD_ERROR_HANDLE = -12
    const stdin = GetStdHandle(STD_INPUT_HANDLE)
    const stdout = GetStdHandle(STD_OUTPUT_HANDLE)
    const stderr = GetStdHandle(STD_ERROR_HANDLE)
    if (!AllocConsole()) return false
    const hwnd = GetConsoleWindow()
    if (!isNullHwnd(hwnd)) ShowWindow(hwnd, 0)
    SetStdHandle(STD_INPUT_HANDLE, stdin)
    SetStdHandle(STD_OUTPUT_HANDLE, stdout)
    SetStdHandle(STD_ERROR_HANDLE, stderr)
    return !isNullHwnd(GetConsoleWindow())
  } catch (_koffiOrWin32Unavailable) {
    return false
  }
}

if (process.platform === 'win32') {
  const inheritHiddenConsole = attachHiddenConsole()
  const hideOptions = (options) => {
    if (options === undefined || options === null || typeof options !== 'object' || Array.isArray(options)) {
      return inheritHiddenConsole ? {} : { windowsHide: true }
    }
    if ('windowsHide' in options) return options
    return inheritHiddenConsole ? options : { ...options, windowsHide: true }
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
