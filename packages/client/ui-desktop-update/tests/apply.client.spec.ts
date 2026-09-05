import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { UpdateRow } from '../src/client/UpdateRow.tsx'
import type { UpdateRowInjected } from '../src/client/UpdateRow.tsx'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.provide('locale', locale)
  ctx.slots.register({
    name: 'root',
    children: {
      'settings.general.item': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

describe('ui-desktop-update apply', () => {
  it('registers the General-settings row and removes it on dispose', async () => {
    hostApply()
    const b = await bench()
    const row = b.ctx.slots.entries('settings.general.item')
      .find(entry => entry.component === UpdateRow)
    expect(row?.options).toEqual({ id: 'desktop-update', order: 15 })
    const injected = row?.inject?.() as unknown as UpdateRowInjected
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      if (calls % 2 === 1) throw new Error('offline')
      return new Response(JSON.stringify({ mode: 'idle', outdated: false }), { status: 200 })
    }) as typeof fetch
    try {
      await injected.refresh()
      await injected.refresh()
      await injected.check()
      await injected.check()
      await injected.download()
      await injected.download()
      await injected.apply()
      await injected.apply()
    } finally {
      globalThis.fetch = originalFetch
    }
    await b.fiber.dispose()
    expect(b.ctx.slots.entries('settings.general.item').find(entry => entry.component === UpdateRow))
      .toBeUndefined()
  })
})
