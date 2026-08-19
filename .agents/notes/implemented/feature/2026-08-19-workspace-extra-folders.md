# Agent Note: Workspace extra folders

Status: implemented

English | [中文](2026-08-19-workspace-extra-folders.zh.md)

## Problem

A Workspace was one canonical directory. Users who keep related repositories side by side needed either several Workspace registrations or a wider sandbox (`danger-full-access`) so one session could write outside its cwd. Multiple registrations split the session list; a full-access sandbox drops the workspace-write boundary.

## Decision

A Workspace keeps a primary `path` (new-session cwd) and an extra `folders` list. A canonical directory belongs to at most one Workspace, as primary or extra. `Workspace.addFolder` / `removeFolder` and the `workspace.addFolder` / `workspace.removeFolder` RPCs mutate that list. Removing the primary path fails with `workspace-folder-primary`; claiming a path another Workspace already owns fails with `workspace-folder-conflict`. Records written before `folders` existed parse as an empty extra list.

Session membership matches a header cwd against the primary path or any extra folder. New sessions created from a Workspace still use the primary path as cwd. `workspace-write` policy resolution reads the mounted workspace registry and sets `SandboxExecutionPolicy.extraRoots` to every other owned directory, so a session whose cwd is an extra folder still writes the primary. `writableRoots`, Seatbelt, Landlock, bwrap, and Windows ACL standing grants all consume that list; a later `addFolder` receives an ACE on the next confine.

The sidebar Workspace row menu keeps **Edit project**, **Add folder…**, **Remove folder**, **Rename**, and **Delete workspace**. **Edit project** opens a dialog for the display name, extra source folders, and registration removal; extra folders stay in that draft until Save. **Add folder…** on the row reuses the same directory-flow hole as adding a Workspace and commits immediately. The hover card lists every owned directory.

## Alternatives considered

**Several Workspace registrations, one folder each.** Already shipped, but it splits the session list and does not expand write roots for the current session.

**Extra roots on the Session header.** The header is immutable, so adding a folder later would not reach existing sessions. Live Workspace folders apply on the next policy resolve.

**Domain version bump that rejects old records.** Extra folders default on parse so existing user registries keep loading. A version bump would drop every stored Workspace.

## Consequences

Workspace-write sessions in a multi-folder Workspace can modify every owned directory without switching sandbox mode. New sessions still start in the primary directory; extra folders are additional roots, not alternate homes. One path cannot sit in two Workspaces, so adding a folder that is already another Workspace's primary is a conflict rather than a merge.

## Testing

`packages/workspace/workspace/tests/workspace.spec.ts` covers add/remove, attach-by-extra-cwd, and conflict/primary errors. `packages/host/apiproxy/tests/api-proxy-workspace.spec.ts` and `rpc-schemas.spec.ts` cover the RPCs and wire defaults. `packages/sandbox/sandbox/tests/roots.spec.ts`, `sandbox-policy/tests/policy.spec.ts`, and `sandbox-local/tests/local.spec.ts` plus `acl-grants.spec.ts` cover extra write roots, an extra-folder session cwd, live Windows ACL grants, and the model-visible policy sentence. `packages/client/ui-workspace/tests/rows.client.spec.tsx` covers the row menu. `workspace-edit-dialog.client.spec.tsx` and `workspace-browser.client.spec.tsx` cover the project editor.
