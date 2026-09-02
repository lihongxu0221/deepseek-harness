import { describe, expect, it, vi } from 'vitest'
import { attachHiddenConsole, type HiddenConsoleBindings } from '../src/console.ts'
import { STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE } from '../src/abi.ts'
import type { NativePtr } from '../src/ffi.ts'

const HWND = 42n as NativePtr
const STDIN = 10n as NativePtr
const STDOUT = 11n as NativePtr
const STDERR = 12n as NativePtr

function bindings(overrides: Partial<HiddenConsoleBindings> = {}): HiddenConsoleBindings & {
  allocConsole: ReturnType<typeof vi.fn>
  showWindow: ReturnType<typeof vi.fn>
  setStdHandle: ReturnType<typeof vi.fn>
} {
  const allocConsole = vi.fn(() => 1)
  const showWindow = vi.fn(() => 1)
  const setStdHandle = vi.fn(() => 1)
  const api = {
    getConsoleWindow: vi.fn(() => null),
    getStdHandle: vi.fn((selector: number) => {
      if (selector === STD_INPUT_HANDLE) return STDIN
      if (selector === STD_OUTPUT_HANDLE) return STDOUT
      return STDERR
    }),
    setStdHandle,
    allocConsole,
    showWindow,
  }
  Object.assign(api, overrides)
  return api
}

describe('attachHiddenConsole', () => {
  it.skipIf(process.platform === 'win32')('returns false on non-win32 without injected bindings', () => {
    expect(attachHiddenConsole()).toBe(false)
  })

  it('leaves an existing console untouched', () => {
    const api = bindings({ getConsoleWindow: vi.fn(() => HWND) })
    expect(attachHiddenConsole(api)).toBe(true)
    expect(api.allocConsole).not.toHaveBeenCalled()
    expect(api.showWindow).not.toHaveBeenCalled()
    expect(api.setStdHandle).not.toHaveBeenCalled()
  })

  it('returns false when AllocConsole fails', () => {
    const api = bindings({ allocConsole: vi.fn(() => 0) })
    expect(attachHiddenConsole(api)).toBe(false)
    expect(api.showWindow).not.toHaveBeenCalled()
    expect(api.setStdHandle).not.toHaveBeenCalled()
  })

  it('hides the new console and restores standard handles', () => {
    const api = bindings({
      getConsoleWindow: vi.fn()
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(HWND)
        .mockReturnValueOnce(HWND),
    })
    expect(attachHiddenConsole(api)).toBe(true)
    expect(api.showWindow).toHaveBeenCalledWith(HWND, 0)
    expect(api.setStdHandle.mock.calls).toEqual([
      [STD_INPUT_HANDLE, STDIN],
      [STD_OUTPUT_HANDLE, STDOUT],
      [STD_ERROR_HANDLE, STDERR],
    ])
  })

  it('restores standard handles when the new console window is missing', () => {
    const api = bindings({
      getConsoleWindow: vi.fn(() => null),
      allocConsole: vi.fn(() => 1),
    })
    expect(attachHiddenConsole(api)).toBe(false)
    expect(api.showWindow).not.toHaveBeenCalled()
    expect(api.setStdHandle).toHaveBeenCalledTimes(3)
  })
})
