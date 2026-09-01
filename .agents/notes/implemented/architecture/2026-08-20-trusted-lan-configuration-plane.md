# Agent Note: Trusted LAN origins persist the configuration plane

Status: implemented

English | [中文](2026-08-20-trusted-lan-configuration-plane.zh.md)

## Problem

A same-origin page on a derived LAN IP (desktop `0.0.0.0`, or any `trustedHosts` authority) already reaches `session.prompt`. The configuration plane did not: the browser settings mirror chose `memory` whenever `isLoopback` was false. Opening `http://<lan-ip>` therefore showed "settings are unavailable in this browser" on the Models page, and General settings writes never reached the Host.

That extra pin was a fence beside an open gate: Connection already authenticates the complete Host API with one browser session. Native desktop actions are a different case — they pop a dialog or opener on the host machine, not the LAN browser.

## Decision

The browser settings mirror and every bound scope always use `host` persistence. Configuration reads and writes therefore persist on a trusted LAN origin the same way they persist on loopback.

Native desktop actions stay loopback-only in the Client: `ui-settings-general` still withholds the settings-file action off-loopback. Connection authenticates generated Remote methods uniformly; Host/Origin failures still return 403 before identity is checked.

This amends the loopback-only configuration-plane rule in [config-plane boundaries](2026-07-30-config-plane-boundaries.md) and the Client persistence rule in [the web configuration plane](2026-07-30-web-config-plane.md). `llm.discoverModels` is no longer loopback-only; the SSRF concern in [draft provider interrogation](2026-08-04-draft-provider-endpoint-interrogation.md) is accepted for a caller who can already `session.prompt`.

## Alternatives considered

**Keep the empty-trust pin and teach users to open localhost.** Rejected because the desktop listen dialog offers `0.0.0.0` as LAN access, and the Models page is unusable there without `settings.describe`.

**Treat any IPv4 literal as loopback in the browser.** Rejected because loopback classification is a hostname fact, and the server already names LAN IPs through `trustedHosts`. Client persistence follows the wire, not a second IP heuristic.

**Unpin native openers too.** Rejected because a LAN click would open a dialog on the host desktop.

## Consequences

A trusted LAN origin can load the provider directory, edit General settings, and store credentials on the Host. Anyone who can open that origin can also change configuration; they could already drive the agent. Native file-open and directory-pick stay loopback. Preset composition text remains loopback-only.

## Testing

`packages/client/ui-settings/tests/settings-scope.client.spec.ts` binds a non-loopback connection in host mode and reads. `packages/client/ui-settings-general/tests/apply.client.spec.ts` still withholds the document action off-loopback while allowing the describe read.
