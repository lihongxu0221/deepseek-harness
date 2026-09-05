---
description: "General-settings row that checks GitHub for a newer packaged Windows desktop zip and drives download plus quit-and-apply."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-desktop-update

English | [中文](README.zh.md)

## Summary

This browser plugin contributes one General-settings row that talks to the Host [`dsh-host-desktop-update`](../../host/desktop-update/README.md) routes. It shows the installed `VERSION`, checks GitHub, downloads a newer `dsh-web-win-x64` zip with progress, and offers Quit and update. The row renders nothing until the Host reports a packaged desktop (`mode` other than `unavailable`), so source `dsh web` stays unchanged.

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

Mount it beside the Host updater in the web composition. The row occupies `settings.general.item` with id `desktop-update`. Copy lives in the `settings.desktopUpdate` locale namespace. The Host refuses non-loopback control routes; a 403/404 is treated as `unavailable` and the row stays hidden.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The apply-world controller owns same-origin Fetch to `/api/desktop-update/*` and publishes a snapshot store through the inject `hooks` compartment. Download polls `/progress` every 500ms until the Host leaves `downloading`. Apply treats a dropped Fetch as success because the Host exits after arming the helper.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Host updater](../../host/desktop-update/README.md) — check, download, and apply.
- [General settings](../ui-settings-general/README.md) — the section that renders this row.

-----

<a id="model-experience"></a>
## Model Experience

None, as the Settings row talks only to the Host updater HTTP routes.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the current Settings row. They are current package constraints, not a task backlog.

- **Web packaged desktop only** — non-Web clients and source `dsh web` do not see this row.
- **No sidebar badge** — the npm-family download control on remote-web-ui is a different updater and is not reused.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The command and slot contribution lifecycles are proven by the HMR-safety spec, and the browser controller owns no host events.
