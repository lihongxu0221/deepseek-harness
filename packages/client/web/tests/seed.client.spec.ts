import { describe, expect, it } from 'vitest'
import * as ClientStore from '@deepseek-ai/dsh-client-store'
import { PLATFORM_MODULES } from '../src/platform.ts'
import { getStaticModules } from '../src/seed.ts'

describe('getStaticModules', () => {
  it('seeds every platform word', () => {
    const table = getStaticModules()
    for (const word of PLATFORM_MODULES) {
      expect(table[word]).toBeDefined()
    }
    expect(table['@deepseek-ai/dsh-client-store']).toBe(ClientStore)
  })

  it('answers the deleted Runtime specifier with the client-store seed', () => {
    const table = getStaticModules()
    const runtime = table['@deepseek-ai/dsh-client-runtime/client'] as {
      createSnapshotStore: unknown
      defineStore: unknown
    }
    expect(table['@deepseek-ai/dsh-client-runtime']).toBe(ClientStore)
    expect(runtime).toBe(ClientStore)
    expect(typeof runtime.createSnapshotStore).toBe('function')
    expect(typeof runtime.defineStore).toBe('function')
  })
})
