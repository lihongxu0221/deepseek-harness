# Agent Note: Drop a client graph row when a live package loses dsh.client

Status: implemented

English | [中文](2026-08-24-drop-stale-client-graph-row.zh.md)

## Problem

The web boot graph is `window.__DSH_BOOT__`. Each row is a package that currently declares `dsh.client.platform: "web"` and ships `exports["./client"]`. The browser then fetches `/plugins/<id>/client.js?rev=…`.

A community plugin can stop being a client package without leaving the loader tree. `@linxin666/dsh-client-ui-community-plugins@0.3.2` is the case that surfaced: it remains an inert host row that publishes `community.json`, but it no longer ships `lib/client.js` or a `dsh.client` declaration. After that upgrade, a long-lived desktop kept advertising the previous `/plugins/@linxin666/dsh-client-ui-community-plugins/client.js?rev=…` URL. The script 404ed and the boot page reported "Failed to load plugins".

Two caches made the stale row survive the fiber event that follows a plugin update:

- `processOne` returned immediately when the name was already in the table, so a still-mounted host entry never lost its client row.
- `pkgMeta` cached the previous `dsh.client` verdict for the process lifetime, so even a re-scan would have reused the old declaration.

Updating `@linxin666/dsh-web-ui-all` rewrites the nested `@linxin666/dsh-client-ui-community-plugins` package in place. That package stays mounted as a host loader entry, so `internal/plugin` does not fire. F5 then injects the previous graph, which still names `/plugins/@linxin666/dsh-client-ui-community-plugins/client.js`.

## Decision

`ClientModuleRegistry.processOne` deletes the per-name `pkgMeta` entry on every dirty flush and re-reads `package.json`. If the package no longer qualifies as a web client row, or the advertised `client.js` is gone, the table deletes that name. An unchanged client row still keeps its revision; `rebuilt()` remains the only path that re-hashes bundle bytes.

Each `webserver/index-inject` dirties every advertised name plus every live loader entry and flushes before writing `__DSH_BOOT__`. Updating a host bundle and pressing F5 therefore drops a nested package that lost `dsh.client` without remounting that entry.

`frontend-static` also sends `Cache-Control: no-store` on every index response, and the desktop window URL carries `?boot=<graph.rev>` so a stale disk cache cannot keep a removed `client.js` URL.

## Alternatives considered

**Require a process restart.** That was the previous comment on `pkgMeta`. The packaged desktop is a long-lived owner process; the plugin manager updates packages in place and restarts fibers. Telling the user to quit and relaunch after every host-only downgrade leaves the boot page broken until they do.

**404 the old URL and keep the row.** The client loader still imports every graph id. A 404 is the same "Failed to load plugins" page.

**Re-hash on every fiber event.** Unnecessary for a package that is still a client plugin; HMR already owns content changes through `rebuilt()`.

**Dirty only on `internal/plugin`.** Updating `dsh-web-ui-all` rewrites the nested community-plugins package without remounting that loader entry. F5 would still inject the stale row.

## Consequences

A live upgrade that removes `dsh.client` drops the row on the next fiber flush or the next index request. F5 after updating `dsh-web-ui-all` no longer advertises the nested host-only `client.js`.

A live upgrade that *adds* `dsh.client` to a previously host-only package also works, because the negative `pkgMeta` verdict is no longer permanent.

## Testing

`packages/client/modules/tests/node-half.client.spec.ts` rewrites a live fixture to drop `dsh.client` (or deletes `client.js`) and expects an empty graph after `internal/plugin` and after `webserver/index-inject` with no fiber event. `packages/host/frontend-static/tests/frontend-static.spec.ts` asserts index `Cache-Control: no-store`. `apps/cli/tests/packaged-web-desktop.spec.ts` asserts the window URL carries `?boot=<rev>`.
