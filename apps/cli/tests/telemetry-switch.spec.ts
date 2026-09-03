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
  it('does not disable seeded family-pack rows that no longer inject apiProxy', () => {
    expect(resolveApiproxyDependentDisablePatches(new Set([
      'web-ui-task-board',
      'web-ui-remote-web-ui',
      'ui-task-board',
      'remote-web-ui',
      'web-ui-pet',
    ]))).toEqual([])
  })
})
