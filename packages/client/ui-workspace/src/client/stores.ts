/**
 * The workspace browser's viewing store: the session-list grouping mode,
 * persisted across reloads. Module level exports the factory only (a
 * module-level handle would pin the store identity across plugin reloads);
 * register() receives the factory and the browser derives its PropsStore
 * share from the return type.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** Browser-local order account for the hierarchy-free flat Session list. */
export const FLAT_SESSION_ORDER_KEY = '__flat_session_order__'

/** Session-list grouping mode: workspace sections or one flat recency list. */
export type SessionGroupBy = 'workspace' | 'flat'
/** Session order: user-arranged only, or user-arranged plus activity promotion. */
export type SessionOrderBy = 'manual' | 'updated'

/** Workspace browser viewing state persisted across surface remounts and reloads. */
type WorkspaceViewState = {
  groupBy: SessionGroupBy
  orderBy: SessionOrderBy
  /** Explicit zero-or-five-session state keyed by Workspace group identity. */
  groupExpansion: Record<string, boolean>
  /** Shared editable order per Workspace group plus the browser-local flat-list account. */
  sessionOrderByAccount: Record<string, string[]>
  /** Last observed update timestamps per order account for one-time promotion events. */
  sessionUpdatedAtByAccount: Record<string, Record<string, number>>
  /** Workspace ids kept at the front of the grouped list, in pin order. */
  pinnedWorkspaceIds: string[]
  /** Whether the Workspaces section is expanded. */
  workspacesOpen: boolean
  /** Whether the Recent sessions section is expanded. */
  recentsOpen: boolean
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type WorkspaceViewActions = {
  setGroupBy: (draft: WorkspaceViewState, mode: SessionGroupBy) => void
  setOrderBy: (draft: WorkspaceViewState, mode: SessionOrderBy) => void
  setGroupExpanded: (draft: WorkspaceViewState, key: string, expanded: boolean) => void
  retainAccountKeys: (draft: WorkspaceViewState, workspaceKeys: readonly string[]) => void
  syncSessionOrderAccount: (
    draft: WorkspaceViewState,
    accountKey: string,
    order: string[],
    updatedAt: Record<string, number>,
  ) => void
  setSessionOrder: (draft: WorkspaceViewState, accountKey: string, order: string[]) => void
  pinWorkspace: (draft: WorkspaceViewState, workspaceId: string) => void
  unpinWorkspace: (draft: WorkspaceViewState, workspaceId: string) => void
  setWorkspacesOpen: (draft: WorkspaceViewState, open: boolean) => void
  setRecentsOpen: (draft: WorkspaceViewState, open: boolean) => void
}

/**
 * Create the workspace browser viewing store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createWorkspaceViewStore(): EngineStoreHandle<WorkspaceViewState, WorkspaceViewActions> {
  return defineStore({
    init: (): WorkspaceViewState => ({
      groupBy: 'workspace',
      orderBy: 'updated',
      groupExpansion: {},
      sessionOrderByAccount: {},
      sessionUpdatedAtByAccount: {},
      pinnedWorkspaceIds: [],
      workspacesOpen: true,
      recentsOpen: true,
    }),
    persist: 'dsh.workspace.view.v5',
    actions: {
      setGroupBy: (d, mode: SessionGroupBy) => { d.groupBy = mode },
      setOrderBy: (d, mode: SessionOrderBy) => { d.orderBy = mode },
      setGroupExpanded: (d, key: string, expanded: boolean) => { d.groupExpansion[key] = expanded },
      retainAccountKeys: (d, workspaceKeys: readonly string[]) => {
        const retained = new Set(workspaceKeys)
        d.groupExpansion = Object.fromEntries(
          Object.entries(d.groupExpansion).filter(([key]) => retained.has(key)),
        )
        d.sessionOrderByAccount = Object.fromEntries(
          Object.entries(d.sessionOrderByAccount).filter(([key]) => retained.has(key)),
        )
        d.sessionUpdatedAtByAccount = Object.fromEntries(
          Object.entries(d.sessionUpdatedAtByAccount).filter(([key]) => retained.has(key)),
        )
        const pinned = Array.isArray(d.pinnedWorkspaceIds) ? d.pinnedWorkspaceIds : []
        d.pinnedWorkspaceIds = pinned.filter(id => retained.has(id))
        if (typeof d.workspacesOpen !== 'boolean') d.workspacesOpen = true
        if (typeof d.recentsOpen !== 'boolean') d.recentsOpen = true
      },
      syncSessionOrderAccount: (d, accountKey: string, order: string[], updatedAt: Record<string, number>) => {
        d.sessionOrderByAccount[accountKey] = order
        d.sessionUpdatedAtByAccount[accountKey] = updatedAt
      },
      setSessionOrder: (d, accountKey: string, order: string[]) => {
        d.sessionOrderByAccount[accountKey] = order
      },
      pinWorkspace: (d, workspaceId: string) => {
        const pinned = Array.isArray(d.pinnedWorkspaceIds) ? d.pinnedWorkspaceIds : []
        if (pinned.includes(workspaceId)) return
        d.pinnedWorkspaceIds = [...pinned, workspaceId]
      },
      unpinWorkspace: (d, workspaceId: string) => {
        const pinned = Array.isArray(d.pinnedWorkspaceIds) ? d.pinnedWorkspaceIds : []
        d.pinnedWorkspaceIds = pinned.filter(id => id !== workspaceId)
      },
      setWorkspacesOpen: (d, open: boolean) => { d.workspacesOpen = open },
      setRecentsOpen: (d, open: boolean) => { d.recentsOpen = open },
    },
  })
}
