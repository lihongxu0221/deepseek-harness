# Agent Note: Packaged web starts a session from an empty Workspace and an unknown stored default

Status: implemented

English | [中文](2026-08-31-packaged-web-empty-workspace-session.zh.md)

## Problem

After removing community plugins, packaged desktop can add a Workspace (`workspace.json` records the path) but never writes `$DSH_HOME/sessions` and never opens a blank Session. Two independent failures produce that empty state.

The sidebar Workspace row only toggles expansion. An empty group has no session row to open, so clicking the added Workspace does nothing. New Session is the plus control, which is hover-only.

`settings.yaml` still stores `agent-presets.default: code`. That id is not in the shipped roster (`standard`, `minimal`, `ptc`, `cordis`). Session create calls `agentPresets.resolve()` with no id, and an unknown stored default fail-louds as `agent-preset/not-found`. `startSession` only `console.warn`s that failure.

## Decision

Clicking an empty real Workspace row starts a Session in that Workspace (same path as the plus control) and expands the group. Groups that already have sessions keep expand/collapse.

An implicit `resolve()` whose stored user default is absent from the roster uses the composition `default` when that id is present. `defaultId` still reports the stored user value so the picker can show it. An explicit unknown id still fails.

## Alternatives considered

**Rewrite `settings.yaml` in the packaged home.** Rejected: the stored name may become valid later; rewriting every home is a migration, not a roster resolve rule.

**Change `defaultId` itself to the composition default.** Rejected: the picker and settings document would hide the stored value the user still has.

**Leave row click as expand-only.** Rejected: an empty Workspace then has no visible session to select; hover-only plus is easy to miss.

## Consequences

Adding a Workspace and clicking its empty row opens a blank Session. Homes that still store `code` create sessions on `standard` until the user picks a live preset. Explicit `resolve('code')` still fails. `packages/preset/agent-presets/tests/settings.spec.ts` and `packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx` pin both paths.
