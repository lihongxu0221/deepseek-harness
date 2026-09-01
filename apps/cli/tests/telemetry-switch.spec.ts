import { describe, expect, it } from 'vitest'
import { resolveApiproxyDependentDisablePatches, resolveTelemetryPatch } from '../src/profile-boot.ts'

describe('resolveTelemetryPatch', () => {
  it('preserves the configured telemetry mode when the hard-disable switch is unset or empty', () => {
    expect(resolveTelemetryPatch(undefined, true)).toBeUndefined()
    expect(resolveTelemetryPatch('', true)).toBeUndefined()
  })

  it('disables on ANY non-empty value, including falsy-looking ones', () => {
    for (const value of ['1', '0', 'false', 'no']) {
      expect(resolveTelemetryPatch(value, true)).toEqual({ id: 'session-telemetry-otel', disabled: true })
    }
  })

  it('is trivially satisfied by a composition without the telemetry row', () => {
    // A custom profile need not mount telemetry: nothing exports, so the
    // privacy switch has nothing to disable and generates no patch.
    expect(resolveTelemetryPatch('1', false)).toBeUndefined()
    expect(resolveTelemetryPatch(undefined, false)).toBeUndefined()
  })
})

describe('resolveApiproxyDependentDisablePatches', () => {
  it('disables only the seeded rows that inject apiProxy', () => {
    expect(resolveApiproxyDependentDisablePatches(new Set([
      'web-ui-task-board',
      'web-ui-remote-web-ui',
      'ui-task-board',
      'web-ui-pet',
    ]))).toEqual([
      { id: 'web-ui-task-board', disabled: true },
      { id: 'web-ui-remote-web-ui', disabled: true },
      { id: 'ui-task-board', disabled: true },
    ])
  })

  it('is a no-op when those rows are absent', () => {
    expect(resolveApiproxyDependentDisablePatches(new Set(['webserver', 'web-ui-pet']))).toEqual([])
  })
})
