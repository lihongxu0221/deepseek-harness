# Agent Note: Packaged desktop must open the process-token Web URL

Status: implemented

English | [中文](2026-08-31-packaged-web-desktop-auth-url.zh.md)

## Problem

`dsh web` prints and opens `connection.authenticatedUrl`. The packaged Windows desktop opened `http://127.0.0.1:<port>` (and the tray Open-URL item used the same origin). Host Connection then answered every window and browser request with `401` and `dsh web authentication required; reopen the URL printed by dsh web.`

## Decision

`runPackagedWebDesktop` builds the window URL from `ctx.connection.authenticatedUrl` on loopback, then appends `boot` and `#settings`. The tray `listen` message may carry that same URL; the PowerShell host prefers it over reconstructing `http://host:port` when launching the default browser. The tray menu caption strips the query and fragment so the process token is not visible. Stopping the service omits `url` so the tray does not keep a stale token.

## Alternatives considered

**Leave the desktop on the clean origin.** Rejected: Connection requires the process token for the first GET.

**Mint a cookie without a query token.** Rejected: that would bypass the Host Connection login exchange.

## Consequences

A packaged window and the tray Open-URL action present the same login URL `dsh web` prints. The tray caption shows only the origin. `apps/cli/tests/packaged-web-desktop.spec.ts` pins the token on boot, show, settings, and boot-rev URLs. `apps/cli/tests/windows-desktop-shell.spec.ts` pins the tray override field, `DisplayListenUrl`, and `Start-Process` against `ListenUrl`.
