/**
 * Hidden-console attachment for GUI hosts whose CUI children must inherit a
 * console instead of allocating a visible empty window.
 * @module dsh-win32-process/console
 */

import koffi from 'koffi'
import { STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE } from './abi.ts'
import { extendWin32ProcessBindings, isNullPtr, type NativePtr } from './ffi.ts'

type Ptr = ReturnType<typeof koffi.pointer>

/** Win32 ShowWindow command that hides an existing window. */
const SW_HIDE = 0

/** Injected kernel32/user32 operations used by {@link attachHiddenConsole}. */
export interface HiddenConsoleBindings {
  /** Return the current console window, or null when this process has none. */
  getConsoleWindow(): NativePtr | null
  /**
   * Return one standard handle.
   * @param selector - STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, or STD_ERROR_HANDLE.
   */
  getStdHandle(selector: number): NativePtr
  /**
   * Restore one standard handle after AllocConsole.
   * @param selector - STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, or STD_ERROR_HANDLE.
   * @param handle - handle captured before AllocConsole.
   * @returns nonzero on success.
   */
  setStdHandle(selector: number, handle: NativePtr): number
  /** Allocate a new console for this process. @returns nonzero on success. */
  allocConsole(): number
  /**
   * Set a window's show state.
   * @param hwnd - console window from GetConsoleWindow.
   * @param cmdShow - ShowWindow command; callers pass SW_HIDE (0).
   * @returns the previous show state.
   */
  showWindow(hwnd: NativePtr, cmdShow: number): number
}

/**
 * Attach a hidden console when this process has none, then restore the
 * standard handles AllocConsole would replace.
 *
 * A GUI host without a console makes every console-subsystem child allocate a
 * visible window. CREATE_NO_WINDOW hides that direct child but leaves CUI
 * grandchildren (pwsh spawning git) without a console, so they flash an empty
 * one. Restricted-token children cannot use CREATE_NO_WINDOW at all.
 * Inheriting a hidden console covers both. Restoring stdin/stdout/stderr keeps
 * piped runner stdio and leaves Node's already-opened streams non-TTY.
 *
 * @param api - injectable bindings; omitted calls load kernel32/user32 on win32.
 * @returns whether this process owns a console afterwards.
 */
export function attachHiddenConsole(api?: HiddenConsoleBindings): boolean {
  if (api === undefined && process.platform !== 'win32') return false
  return attachHiddenConsoleWith(api ?? nativeHiddenConsoleBindings())
}

/**
 * Apply hidden-console attachment through one binding table.
 * @param api - kernel32/user32 operations.
 * @returns whether this process owns a console afterwards.
 */
function attachHiddenConsoleWith(api: HiddenConsoleBindings): boolean {
  if (!isNullPtr(api.getConsoleWindow())) return true
  const stdin = api.getStdHandle(STD_INPUT_HANDLE)
  const stdout = api.getStdHandle(STD_OUTPUT_HANDLE)
  const stderr = api.getStdHandle(STD_ERROR_HANDLE)
  if (api.allocConsole() === 0) return false
  try {
    const hwnd = api.getConsoleWindow()
    if (!isNullPtr(hwnd)) api.showWindow(hwnd, SW_HIDE)
    return !isNullPtr(api.getConsoleWindow())
  } finally {
    api.setStdHandle(STD_INPUT_HANDLE, stdin)
    api.setStdHandle(STD_OUTPUT_HANDLE, stdout)
    api.setStdHandle(STD_ERROR_HANDLE, stderr)
  }
}

/* v8 ignore start -- kernel32/user32 binds; tests inject HiddenConsoleBindings. */
function nativeHiddenConsoleBindings(): HiddenConsoleBindings {
  const PVOID: Ptr = koffi.pointer('void')
  const extended = extendWin32ProcessBindings((ctx) => {
    const user32 = koffi.load('user32.dll')
    return {
      allocConsole: ctx.bind(ctx.kernel32, 'AllocConsole', 'int', []) as () => number,
      getConsoleWindowRaw: ctx.bind(ctx.kernel32, 'GetConsoleWindow', PVOID, []) as () => NativePtr | null,
      setStdHandle: ctx.bind(ctx.kernel32, 'SetStdHandle', 'int', ['int', PVOID]) as (
        selector: number,
        handle: NativePtr,
      ) => number,
      showWindow: ctx.bind(user32, 'ShowWindow', 'int', [PVOID, 'int']) as (
        hwnd: NativePtr,
        cmdShow: number,
      ) => number,
    }
  })
  return {
    getConsoleWindow: () => {
      const value = extended.getConsoleWindowRaw()
      return isNullPtr(value) ? null : value
    },
    getStdHandle: selector => extended.getStdHandle(selector),
    setStdHandle: (selector, handle) => extended.setStdHandle(selector, handle),
    allocConsole: () => extended.allocConsole(),
    showWindow: (hwnd, cmdShow) => extended.showWindow(hwnd, cmdShow),
  }
}
/* v8 ignore stop */
