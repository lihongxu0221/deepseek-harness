# Agent Note: Workspace shared extra folders

Status: implemented

English | [中文](2026-08-24-workspace-shared-extra-folders.zh.md)

## Problem

[Workspace extra folders](2026-08-19-workspace-extra-folders.md) made one Workspace hold several directories, but a canonical directory still belonged to at most one Workspace. Adding a folder already used as another Workspace's extra folder failed with `workspace-folder-conflict`. Creating a Workspace over that same folder returned the existing owner with `created: false`, so the GUI could not register it as a new primary. Extra folders also never appeared in the `sandbox:policy` sentence under `read-only` or `danger-full-access`, so a session in those modes could not see them.

## Decision

Only the primary directory is unique across the registry. An extra folder may belong to several Workspaces and may also be another Workspace's primary. `addFolder` no longer conflicts. `create` / `resolveByPath` adopt or resolve only a primary match; an extra-only path creates a new Workspace. `setPrimaryFolder` still rejects a path that is already another Workspace's primary (`workspace-folder-conflict`). `attachSession` rejects a session another Workspace already accounts (`WorkspaceSessionAccountedError`), because a shared extra folder would otherwise let one cwd match several accounts.

When several Workspaces own the session cwd, `extraWorkspaceRoots` picks exactly one — never the union: the Workspace whose account holds the session, else the Workspace whose primary the cwd is, else the unique owner. A shared extra with no account and no primary match stays single-root so it does not grant another Workspace's directories. `sandbox:policy` names those extra directories in `read-only` and `danger-full-access` too (`The session workspace also includes …`). A single-directory Workspace still emits the previous sentence unchanged.

The on-disk record and domain version do not change. Extra folders still do not expand the `AGENTS.md` walk, `@`-mention search, or `fs-search` default root.

## Alternatives considered

**Keep exclusive ownership and add a transfer RPC.** Moving a folder from one Workspace to another would still block "this extra folder is also my other project's primary."

**Union every matching Workspace's extra roots.** A session would write directories it is not accounted against.

**First match in registry order for a shared unaccounted extra.** A shared extra would grant whichever Workspace happened to list first.

**Match extras in `resolveByPath`.** Several owners would make the return value arbitrary.

## Consequences

A folder used as an extra in Workspace A can be added as an extra in Workspace B, and can be registered as Workspace C's primary, without removing it from A or B. Promoting it to B's primary still fails while C (or A) holds it as primary. Shared extras make cwd membership non-unique, so session accounting is the ownership truth. Old builds that still enforce exclusive extras reject a shared-extra registry at startup.

## Testing

`packages/workspace/workspace/tests/workspace.spec.ts` covers shared extras, create-on-extra, promote-conflict, session-account guard, and startup validation. `packages/host/apiproxy/tests/api-proxy-workspace.spec.ts` covers share + create-on-extra + `setPrimaryFolder` conflict on the wire. `packages/sandbox/sandbox-policy/tests/policy.spec.ts` covers the accounted/primary extra-root pick, the unaccounted extra-only single-root case, and the extra-folder sentence in `read-only` / `danger-full-access`. `packages/client/runtime/tests/workspaces-service.client.spec.ts` covers addFolder invalid-path and setPrimaryFolder conflict passthrough.
