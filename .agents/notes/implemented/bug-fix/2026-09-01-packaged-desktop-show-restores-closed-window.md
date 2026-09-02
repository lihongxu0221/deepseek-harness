# Agent Note: Tray Show restores a closed Chromium app window

Status: implemented

English | [中文](2026-09-01-packaged-desktop-show-restores-closed-window.zh.md)

## Problem

Closing the packaged `--app` window often leaves Edge or Chrome running under `$DSH_HOME/desktop-chromium`. Tray Show treated a still-tracked process as a visible window and sent `focus`. The tray required a visible HWND of that exact pid and otherwise did nothing. Left-click and **Show main window** failed. **Settings** always killed the tracked process and opened `#settings`, so only that item restored the GUI.

## Decision

The tray `focus` handler raises a visible window whose pid matches or whose title is `DeepSeek Harness` or ends with ` — DeepSeek Harness`. If none exists it emits `window-missing`. Node reopens the loopback URL only when that reply follows a Show that asked to raise an already-tracked window, so a `focus` sent right after spawn cannot loop. Settings still always reopens with `#settings`. The single-instance pipe still accepts only `show`. Protocol ownership stays on the [Windows splash and tray](../feature/2026-08-19-windows-packaged-desktop-tray.md) note.

## Alternatives considered

**Make Show always close and reopen like Settings.** Rejected: clicking Show while the window is visible would kill the Chromium process and drop in-page drafts.

**Drop `DESKTOP_WINDOW_HANDOFF_MS` and spawn on every Show.** Rejected: a launcher that exits within 2s would open a second `--app` window while the first is still on screen.

## Consequences

Tray Show brings an existing product window forward, and restores one after the user closes it even if Chromium keeps a background process. `apps/cli/tests/windows-desktop-shell.spec.ts` pins `window-missing` and title matching. `apps/cli/tests/packaged-web-desktop.spec.ts` pins reopen on missing after Show, ignore otherwise, and that an immediate launcher handoff still does not spawn until missing.
