/**
 * General-settings row for the packaged-desktop GitHub zip updater.
 * Hidden until the Host reports a packaged install.
 */

import { useEffect } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopUpdateRowState } from '../types.ts'
import type { DesktopUpdateKey } from './locales.ts'
import css from './UpdateRow.module.css'

/** Registration-side business face. */
export interface UpdateRowInjected {
  hooks: {
    /** Updater snapshot bound by the renderer as useDesktopUpdate. */
    desktopUpdate: {
      getSnapshot: () => DesktopUpdateRowState
      subscribe: (listener: () => void) => () => void
    }
  }
  /** Probe current status. */
  refresh: () => Promise<void>
  /** Force a GitHub check. */
  check: () => Promise<void>
  /** Download the newer zip. */
  download: () => Promise<void>
  /** Arm the apply helper and quit. */
  apply: () => Promise<void>
}

/** Full component props. */
export type UpdateRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.desktopUpdate'>
  & InjectFace<UpdateRowInjected>

/**
 * Render the desktop-update row.
 * @param props - composed slot props.
 * @returns the row, or null until the first status probe finishes.
 */
export function UpdateRow({
  refresh, check, download, apply, useDesktopUpdate, t,
}: UpdateRowProps) {
  const state = useDesktopUpdate(snapshot => snapshot)
  useEffect(() => {
    void refresh()
  }, [refresh])
  if (!state.loaded) return null
  if (state.status.mode === 'unavailable') {
    return (
      <div className={css.row}>
        <div className={css.title}>{t('title')}</div>
        <div className={css.desc}>{t('unavailable')}</div>
      </div>
    )
  }
  const busy = state.status.mode === 'downloading' || state.status.mode === 'applying'
  const statusText = statusLine(state, t)
  const progress = state.status.progress
  const percent = progress !== undefined && progress.total > 0
    ? Math.min(100, Math.round(progress.received / progress.total * 100))
    : undefined
  return (
    <div className={css.row}>
      <div className={css.title}>{t('title')}</div>
      <div className={css.desc} role={state.status.error === undefined ? undefined : 'alert'}>
        {state.status.error ?? t('description')}
      </div>
      <div className={css.versions}>
        {t('current')}: {state.status.current ?? '—'}
        {state.status.latest !== undefined ? ` · ${t('latest')}: ${state.status.latest}` : ''}
      </div>
      {percent !== undefined && (
        <div className={css.progress}>{t('downloading')} {percent}%</div>
      )}
      <div className={css.actions}>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => { void check() }}
        >
          {t('check')}
        </Button>
        {state.status.outdated && state.status.mode !== 'ready' && (
          <Button
            variant="primary"
            size="sm"
            disabled={busy}
            onClick={() => { void download() }}
          >
            {busy && state.status.mode === 'downloading' ? t('downloading') : t('download')}
          </Button>
        )}
        {state.status.mode === 'ready' && (
          <Button
            variant="primary"
            size="sm"
            disabled={busy}
            onClick={() => { void apply() }}
          >
            {t('apply')}
          </Button>
        )}
      </div>
      <div className={css.desc}>{statusText}</div>
    </div>
  )
}

function statusLine(
  state: DesktopUpdateRowState,
  t: UpdateRowProps['t'],
): string {
  if (state.status.mode === 'ready') return t('ready')
  if (state.status.outdated) return t('outdated')
  if (state.status.latest !== undefined) return t('upToDate')
  return t('description')
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Desktop-update row copy. */
    'settings.desktopUpdate': DesktopUpdateKey
  }
}
