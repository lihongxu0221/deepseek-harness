# Agent Note: Trusted LAN origins persist the configuration plane

Status: implemented

English | [中文](2026-08-20-trusted-lan-configuration-plane.zh.md)

## Problem

A same-origin page on a derived LAN IP (desktop `0.0.0.0`, or any `trustedHosts` authority) already reaches `session.prompt`. The configuration plane did not: `PRIVILEGED_METHODS` passed the trust fence with an empty list, so `settings.describe` and `credentials.describe` 403ed, and the browser settings mirror chose `memory` whenever `isLoopback` was false. Opening `http://<lan-ip>` therefore showed "settings are unavailable in this browser" on the Models page, and General settings writes never reached the Host.

That extra pin was a fence beside an open gate: the same caller could already run bash. Native desktop actions are a different case — they pop a dialog or opener on the host machine, not the LAN browser.

## Decision

Configuration reads and writes ride the outer trusted-host fence. `settings.describe`/`update`/`replace`/`mutate`, `credentials.describe`/`set`/`unset`, and `llm.discoverModels` are not in `PRIVILEGED_METHODS`. The browser settings mirror and every bound scope always use `host` persistence.

`PRIVILEGED_METHODS` keeps native desktop actions and preset authoring: `host.pickDirectory`, `host.openPath`, `settings.openDocument`, `agentPreset.openDocument`, and `agentPreset.read`/`copy`/`remove`. Those still pass the fence with an empty trust list. `ui-settings-general` still withholds the settings-file action off-loopback.

This amends the loopback-only configuration-plane rule in [config-plane boundaries](2026-07-30-config-plane-boundaries.md) and the privileged-set membership in [the web configuration plane](2026-07-30-web-config-plane.md). `llm.discoverModels` is no longer loopback-only; the SSRF concern in [draft provider interrogation](2026-08-04-draft-provider-endpoint-interrogation.md) is accepted for a caller who can already `session.prompt`.

## Alternatives considered

**Keep the empty-trust pin and teach users to open localhost.** Rejected because the desktop listen dialog offers `0.0.0.0` as LAN access, and the Models page is unusable there without `settings.describe`.

**Treat any IPv4 literal as loopback in the browser.** Rejected because loopback classification is a hostname fact, and the server already names LAN IPs through `trustedHosts`. Client persistence follows the wire, not a second IP heuristic.

**Unpin native openers too.** Rejected because a LAN click would open a dialog on the host desktop.

## Consequences

A trusted LAN origin can load the provider directory, edit General settings, and store credentials on the Host. Anyone who can open that origin can also change configuration; they could already drive the agent. Native file-open and directory-pick stay loopback. Preset composition text remains loopback-only.

## Testing

`packages/client/connection/tests/node-half.host.spec.ts` asserts a declared trusted authority 403s native/authoring methods and 404s (fence passed) the configuration plane over both a fake request and real HTTP. `packages/client/ui-settings/tests/settings-scope.client.spec.ts` binds a non-loopback connection in host mode and reads. `packages/client/ui-settings-general/tests/apply.client.spec.ts` still withholds the document action off-loopback while allowing the describe read.
