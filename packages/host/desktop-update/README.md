---
description: "Packaged Windows desktop updater: checks GitHub Releases for a newer dsh-web-win-x64 zip, downloads it, and replaces program files while keeping .config."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-desktop-update

English | [中文](README.zh.md)

## Summary

This Host plugin updates a packaged Windows desktop folder. It reads the `VERSION` stamp beside `dsh-web.exe`, lists GitHub Releases on the configured repository, and treats a newer `dsh-web-win-x64-*.zip` asset as an update. A loopback-only `/api/desktop-update` family lets the Settings row check, download with progress, and arm a helper that copies the extract tree over the product directory after this process exits. `.config` is never copied, so sessions, credentials, and profile plugins stay on the machine. Source `dsh --profile web` has no `VERSION` beside Node and the plugin reports `unavailable` without exposing download or apply.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it after `connection` in the web composition. The browser Settings row is [`dsh-client-ui-desktop-update`](../../client/ui-desktop-update/README.md). Config fields:

- `repository` (`owner/name`, default `lihongxu0221/deepseek-harness`) — GitHub repository that publishes winexe zips.
- `assetPrefix` (default `dsh-web-win-x64-`) — required zip filename prefix.
- `checkOnBoot` (default `true`) — list Releases after load when this process is a packaged desktop.
- `cacheTtlMs` (default `600000`) — reuse a successful list for this many milliseconds unless the user clicks Check.

All control routes refuse non-loopback Hostnames, including LAN binds that Connection already authorizes for ordinary `/api`. `/api/update` is a different plugin (npm family self-update) and is not used here.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

VERSION stamps are `{semver}` or `{semver}.winexe.{n}`. Comparison uses semver precedence on the base, then the winexe iteration only when bases match. GitHub `/releases/latest` skips prereleases, so the plugin lists `/releases`. Drafts and assets that are not the configured zip prefix are ignored; the source zipball is never downloaded. A missing GitHub `digest` fails the download: the helper never copies an unauthenticated zip. After extract, a single wrapping directory is peeled, then the tree must contain `VERSION` and `dsh-web.exe` (or `dsh-web`). Apply writes a PowerShell 5.1 helper under `$DSH_HOME/desktop-update`, detaches it, and exits so the tray host drops with Node stdin.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Client row](../../client/ui-desktop-update/README.md) — Settings presentation.
- [Packaged Web desktop](../../../.agents/notes/implemented/feature/2026-08-18-packaged-web-desktop-exe.md) — product folder and VERSION stamp.
- [CLI packaged desktop](../../../apps/cli/README.md) — how the zip is built and published.

-----

<a id="model-experience"></a>
## Model Experience

None, as the packaged-desktop updater registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the current updater. They are current package constraints, not a task backlog.

- **Windows zip only** — apply runs only on `win32` and only for the configured `dsh-web-win-x64-` asset prefix.
- **First Releases page** — the check reads `per_page=30` and does not follow pagination.
- **Anonymous GitHub API** — rate limits surface as `mode: error`; there is no token Config in this version.
- **Quit required** — the running launcher is never overwritten in place.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The updater is a Host HTTP control plane whose observations (VERSION file, GitHub JSON, extract tree) cannot diverge from an independent in-process probe.
