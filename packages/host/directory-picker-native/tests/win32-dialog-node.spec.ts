import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isNodeExecutable, resolveDialogNodeExecutable } from '../src/win32-dialog-node.ts'

describe('resolveDialogNodeExecutable', () => {
  it('keeps process.execPath when it is already node', () => {
    const execPath = resolve('C:\\Program Files\\nodejs\\node.exe')
    expect(isNodeExecutable(execPath)).toBe(true)
    expect(resolveDialogNodeExecutable(execPath, { NODE_BINARY: resolve('D:\\other\\node.exe') }, () => true)).toBe(execPath)
  })

  it('uses NODE_BINARY then npm_node_execpath when execPath is a packaged exe', () => {
    const packaged = resolve('D:\\dist\\dsh-web.exe')
    const override = resolve('C:\\nodejs\\node.exe')
    const npmNode = resolve('C:\\nvm\\node.exe')
    expect(isNodeExecutable(packaged)).toBe(false)
    expect(resolveDialogNodeExecutable(packaged, { NODE_BINARY: override }, path => path === override)).toBe(override)
    expect(resolveDialogNodeExecutable(packaged, { npm_node_execpath: npmNode }, path => path === npmNode)).toBe(npmNode)
    expect(resolveDialogNodeExecutable(
      packaged,
      { NODE_BINARY: override, npm_node_execpath: npmNode },
      path => path === override || path === npmNode,
    )).toBe(override)
  })

  it('ignores a missing or non-node override and falls back to execPath', () => {
    const packaged = resolve('D:\\dist\\dsh-web.exe')
    const missing = resolve('C:\\missing\\node.exe')
    const notNode = resolve('C:\\tools\\python.exe')
    expect(resolveDialogNodeExecutable(packaged, { NODE_BINARY: missing }, () => false)).toBe(packaged)
    expect(resolveDialogNodeExecutable(packaged, { NODE_BINARY: notNode }, () => true)).toBe(packaged)
    expect(resolveDialogNodeExecutable(packaged, {}, () => true)).toBe(packaged)
  })
})
