# Agent Note: Packaged executable sidecar default cordis.yml

Status: implemented

English | [中文](2026-08-17-packaged-exe-sidecar-default-cordis-yml.zh.md)

## Problem

The packaged JSON-RPC executable refused to start without `$DSH_CORDIS_CONFIG` or an argv path. That is the right contract for the generic bin, the node carrier, and the Python SDK, which injects the checked-in default. It is the wrong first-run experience for someone who launches `dsh-jsonrpc-agent-pkg-*.exe` directly: Explorer and a bare shell give no config, and the process printed usage and exited 1.

A hidden in-exe fallback would also be wrong. The [single-exe distribution](../architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md) still requires the booted plugin list to come from an external `cordis.yml`.

## Decision

`$DSH_CORDIS_CONFIG` still wins over argv. A named path that does not exist still fails loudly and is never created.

Unpackaged `dsh-jsonrpc-agent` launches and the Python node carrier still require an explicit path.

A packaged executable — Node `isSea()` or a `dsh-jsonrpc-agent-pkg*` filename — with neither channel uses `<executable-dir>/cordis.yml`. If that file is missing, the process writes the bundled default plugin list (the same entries as `python/sdk-runtime/src/deepseek_harness_runtime/runtime/cordis.yml`) and reports the write on stderr. A write failure is fatal.

That launch also loads `.env` from the executable directory without overriding existing variables, and defaults unset `DSH_CWD` / `DSH_SESSION_ROOT` to the executable directory and `<executable-dir>/.sessions`. Explorer's process cwd is not the executable directory, so those defaults make the generated file usable.

The Python SDK still injects its checked-in default via `DSH_CORDIS_CONFIG`, so SDK launches do not take this path.

## Alternatives considered

**Hidden in-exe fallback with no on-disk file.** Rejected because the booted plugin list must remain an external `cordis.yml` the user can edit, and a silent default hides that file.

**Working-directory `./cordis.yml`.** Rejected because an Explorer launch cwd is often `System32` or the user's home, not the executable directory, and unpackaged launches must stay explicit.

**Create a missing env/argv path.** Rejected because a named path is a request for that file; inventing it would mask a typo.

**Write next to `node.exe` for the node carrier.** Rejected because that carrier is a system Node plus `packaged-bin.js`, and the config would land in the Node install or the caller's accidental cwd.

## Consequences

Running the packaged executable with no arguments creates an editable `cordis.yml` beside it and boots that file. The Python SDK, CI, and unpackaged bins keep their explicit-config contract. A first launch into a read-only directory such as Program Files fails loudly instead of inventing an in-memory default. Unit tests in `packages/examples/jsonrpc-demo/tests/config-path.spec.ts` pin discovery, write failure, launch-directory defaults, and plugin-entry parity with the Python default.
