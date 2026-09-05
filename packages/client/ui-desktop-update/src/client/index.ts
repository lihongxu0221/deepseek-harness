/**
 * Packaged-desktop updater plugin, browser half: a General-settings row that
 * talks to `/api/desktop-update`. Hidden when the Host reports `unavailable`.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { DesktopUpdateClient } from './controller.ts'
import { en, zh } from './locales.ts'
import { UpdateRow } from './UpdateRow.tsx'
import type { UpdateRowInjected } from './UpdateRow.tsx'

export type { UpdateRowInjected, UpdateRowProps } from './UpdateRow.tsx'
export type { DesktopUpdateRowState, DesktopUpdateStatus } from '../types.ts'
export { DesktopUpdateClient } from './controller.ts'

/** Required services. */
export const inject = ['slots', 'locale']

const NS = 'settings.desktopUpdate'

/**
 * Register dictionaries and the General-settings row.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-desktop-update: dictionaries')
  const client = new DesktopUpdateClient()
  ctx.effect(() => () => { client.dispose() }, 'ui-desktop-update: client')
  const ignore = async (op: () => Promise<unknown>): Promise<void> => {
    try {
      await op()
    } catch {
      // Settings-row actions never reject; Host errors live on the snapshot.
    }
  }
  const refresh = (): Promise<void> => ignore(() => client.refresh())
  const check = (): Promise<void> => ignore(() => client.check())
  const download = (): Promise<void> => ignore(() => client.download())
  const applyUpdate = (): Promise<void> => ignore(() => client.apply())
  const injected = (): UpdateRowInjected => ({
    hooks: { desktopUpdate: client.store },
    refresh,
    check,
    download,
    apply: applyUpdate,
  })
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'desktop-update',
    order: 15,
    locale: NS,
    inject: injected,
  }, UpdateRow))
}
