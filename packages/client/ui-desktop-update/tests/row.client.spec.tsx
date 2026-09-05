// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { UpdateRow, type UpdateRowProps } from '../src/client/UpdateRow.tsx'
import { zh } from '../src/client/locales.ts'
import type { DesktopUpdateRowState } from '../src/types.ts'

afterEach(cleanup)

const dictionary: Record<string, string> = zh
const t: UpdateRowProps['t'] = key => dictionary[key] ?? key
type AttentionSnapshot = Parameters<Parameters<UpdateRowProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const runtime = {
  useSessions: (() => { throw new Error('unused') }) as never,
  useSessionPendingInteraction: ((selector: (snapshot: AttentionSnapshot) => unknown) => selector(noAttention)) as UpdateRowProps['useSessionPendingInteraction'],
  useWorkspaces: (() => { throw new Error('unused') }) as never,
}

function mount(state: DesktopUpdateRowState, actions: Partial<{
  refresh: () => Promise<void>
  check: () => Promise<void>
  download: () => Promise<void>
  apply: () => Promise<void>
}> = {}) {
  const store = createSnapshotStore(state)
  const refresh = actions.refresh ?? vi.fn(async () => {})
  return {
    refresh,
    ...render(
      <UpdateRow
        {...runtime}
        refresh={refresh}
        check={actions.check ?? vi.fn(async () => {})}
        download={actions.download ?? vi.fn(async () => {})}
        apply={actions.apply ?? vi.fn(async () => {})}
        useDesktopUpdate={bindSnapshotSelector(store)}
        t={t}
      />,
    ),
  }
}

describe('UpdateRow', () => {
  it('renders nothing until a packaged snapshot loads', () => {
    mount({ loaded: false, status: { mode: 'unavailable', outdated: false } })
    expect(screen.queryByText(zh.title)).toBeNull()
    mount({ loaded: true, status: { mode: 'unavailable', outdated: false } })
    expect(screen.getByText(zh.title)).toBeTruthy()
    expect(screen.getByText(zh.unavailable)).toBeTruthy()
  })

  it('shows check, download, apply, progress, and error', async () => {
    const check = vi.fn(async () => {})
    const download = vi.fn(async () => {})
    const apply = vi.fn(async () => {})
    mount({
      loaded: true,
      status: {
        mode: 'idle', outdated: true, current: '1', latest: '2',
      },
    }, { check, download })
    fireEvent.click(screen.getByText(zh.check))
    expect(check).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByText(zh.download))
    expect(download).toHaveBeenCalledOnce()

    cleanup()
    mount({
      loaded: true,
      status: {
        mode: 'downloading',
        outdated: true,
        current: '1',
        latest: '2',
        progress: { received: 50, total: 100 },
      },
    })
    expect(screen.getByText(`${zh.downloading} 50%`)).toBeTruthy()

    cleanup()
    mount({
      loaded: true,
      status: { mode: 'ready', outdated: true, current: '1', latest: '2' },
    }, { apply })
    fireEvent.click(screen.getByText(zh.apply))
    expect(apply).toHaveBeenCalledOnce()
    expect(screen.getByText(zh.ready)).toBeTruthy()

    cleanup()
    mount({
      loaded: true,
      status: { mode: 'error', outdated: false, error: 'boom', current: '1' },
    })
    expect(screen.getByRole('alert').textContent).toBe('boom')

    cleanup()
    mount({
      loaded: true,
      status: { mode: 'idle', outdated: false, current: '1', latest: '1' },
    })
    expect(screen.getByText(zh.upToDate)).toBeTruthy()

    cleanup()
    mount({
      loaded: true,
      status: {
        mode: 'idle', outdated: false, progress: { received: 1, total: 0 },
      },
    })
    expect(screen.queryByText(/0%/)).toBeNull()
    expect(screen.getByText(`${zh.current}: —`)).toBeTruthy()
  })
})
