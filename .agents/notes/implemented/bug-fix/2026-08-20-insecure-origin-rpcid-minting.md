# Agent Note: Client rpcId minting works on insecure HTTP origins

Status: implemented

English | [中文](2026-08-20-insecure-origin-rpcid-minting.zh.md)

## Problem

Browsers omit `crypto.randomUUID` outside a secure context. HTTP to a LAN IP literal is not a secure context, while `localhost` is. The Web GUI already serves LAN IP URLs as a supported path ([API browser-trust boundary](../architecture/2026-07-28-api-browser-trust-boundary.md)): the authority fence admits those literals, and configuration reads such as `agentPreset.list` and `llm.providers` are not loopback-pinned.

Client RPC minting called `crypto.randomUUID` for every unary. Opening settings over `http://<lan-ip>` therefore threw `crypto.randomUUID is not a function` before fetch, so the Agent preset roster and the provider catalog failed to load. Browsers expose `crypto.getRandomValues` on insecure origins; `crypto.randomUUID` is omitted.

## Decision

Connection mints rpcIds through `packages/client/connection/src/client/random-uuid.ts`, an RFC 4122 UUID v4 from `crypto.getRandomValues` with version and variant bits set in-process. Every Connection unary — including `agentPreset.list` and `llm.providers` — goes through that helper.

## Alternatives considered

**Override `mintRpcId` only on `WebApiClient`.** Smaller browser-only diff, but `FixtureApiClient` and any later subclass would keep calling `crypto.randomUUID` on the same insecure origin.

**Call `crypto.randomUUID` when present and fall back otherwise.** Two minting paths for the same id format. `getRandomValues` is available wherever this carrier runs (browser insecure origins and Node ≥19), so the fallback branch would never be the unique Node path.

**Require HTTPS or localhost.** That would reject the LAN IP serving path the trust fence already admits.

## Consequences

A browser on `http://<lan-ip>` can load the Agent preset roster and the provider catalog. rpcIds remain UUID v4; only the Web Crypto entry point changed. Composer draft-attachment ids still call `crypto.randomUUID` and are outside this mint.

## Testing

`packages/client/connection/tests/client-apply.client.spec.ts` stubs `crypto` to `getRandomValues` only and asserts Connection RPC still mints a version-4 id on an insecure LAN origin.
