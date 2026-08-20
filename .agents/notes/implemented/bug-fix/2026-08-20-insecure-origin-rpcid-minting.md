# Agent Note: Client rpcId minting works on insecure HTTP origins

Status: implemented

English | [中文](2026-08-20-insecure-origin-rpcid-minting.zh.md)

## Problem

Browsers omit `crypto.randomUUID` outside a secure context. HTTP to a LAN IP literal is not a secure context, while `localhost` is. The Web GUI already serves LAN IP URLs as a supported path ([API browser-trust boundary](../architecture/2026-07-28-api-browser-trust-boundary.md)): the authority fence admits those literals, and configuration reads such as `agentPreset.list` and `llm.providers` are not loopback-pinned.

`AbstractApiClient.mintRpcId` called `crypto.randomUUID` for every domain unary. Opening settings over `http://<lan-ip>` therefore threw `crypto.randomUUID is not a function` before fetch, so the Agent preset roster and the provider catalog failed to load. The generic Connection RPC path already minted from `crypto.getRandomValues`, which browsers expose on insecure origins; the domain carrier did not.

## Decision

`AbstractApiClient.mintRpcId` mints through a package-local `randomUuid()`, an RFC 4122 UUID v4 from `crypto.getRandomValues` with version and variant bits set in-process. Every `IApiClient` unary — including `agentPreset.list` and `llm.providers` — goes through that method. The generic Connection RPC path keeps its existing `packages/client/connection/src/client/random-uuid.ts` helper.

## Alternatives considered

**Override `mintRpcId` only on `WebApiClient`.** Smaller browser-only diff, but `FixtureApiClient` and any later subclass would keep calling `crypto.randomUUID` on the same insecure origin.

**Call `crypto.randomUUID` when present and fall back otherwise.** Two minting paths for the same id format. `getRandomValues` is available wherever this carrier runs (browser insecure origins and Node ≥19), so the fallback branch would never be the unique Node path.

**Require HTTPS or localhost.** That would reject the LAN IP serving path the trust fence already admits.

## Consequences

A browser on `http://<lan-ip>` can load the Agent preset roster and the provider catalog. rpcIds remain UUID v4; only the Web Crypto entry point changed. Composer draft-attachment ids still call `crypto.randomUUID` and are outside this mint.

## Testing

`packages/host/apiproxy/tests/fetch-carrier.spec.ts` stubs `crypto` to `getRandomValues` only and asserts `sessions.list` still mints a version-4 id. `packages/client/connection/tests/client-apply.client.spec.ts` mounts the real `WebApiClient` under a LAN IP origin with the same stub and round-trips `agentPreset.list` plus `llm.providers`.
