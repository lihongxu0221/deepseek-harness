# Agent Note: Packaged desktop GitHub zip update

Status: implemented

English | [中文](2026-09-05-packaged-desktop-github-update.zh.md)

## Problem

The winexe desktop is a ~270MB folder published as a GitHub prerelease zip. Users who already run `dsh-web.exe` have no in-product way to learn that a newer `dsh-web-win-x64-*.zip` exists or to replace program files without manually downloading the release. The seeded `@linxin666/dsh-remote-web-ui` "Check for updates" control talks to `/api/update` and runs `pnpm update` for the npm plugin family; it does not read [lihongxu0221/deepseek-harness/releases](https://github.com/lihongxu0221/deepseek-harness/releases) and must not be overloaded.

## Decision

Ship the updater as two Cordis plugins, not as launcher logic:

- [`dsh-host-desktop-update`](../../../../packages/host/desktop-update/README.md) reads `VERSION` beside the exe, lists GitHub Releases (prereleases included; `/releases/latest` skips them), downloads the configured `dsh-web-win-x64-` zip, verifies the GitHub `sha256` digest, extracts, and arms a detached PowerShell helper.
- [`dsh-client-ui-desktop-update`](../../../../packages/client/ui-desktop-update/README.md) adds a General-settings row. Source `dsh web` still loads the Host plugin and returns `mode: unavailable`, which the row shows as “Not a packaged desktop”. HTTP 403/404 from a missing route surface as an error instead of hiding the row.

Control routes live at `/api/desktop-update/*` on Connection's authenticated Fetch channel and additionally refuse non-loopback Hostnames so a LAN/phone session cannot start a 270MB download or replace the product folder. Apply never copies `.config`. The helper waits for this PID to exit, robocopies the extract tree with `/XD .config`, and relaunches `dsh-web.exe`. Node then `process.exit(0)`; the Windows tray host already quits when stdin closes.

Version stamps are `{semver}` or `{semver}.winexe.{n}`. Comparison uses semver precedence on the base; the winexe iteration is only a tiebreaker. The GitHub repository and asset prefix are Config (defaults `lihongxu0221/deepseek-harness` and `dsh-web-win-x64-`). Download starts only on an explicit click; boot at most lists Releases.

Both plugins are inserted in the web-app bundle so the packaged zip ships them without a separate npm publish.

## Alternatives considered

**Bake the updater into `packaged-web-bin` / the thin pkg launcher.** Rejected because the check is fork-specific (this GitHub repo's winexe zips) and the user asked for plugin mode. A missing `VERSION` already no-ops the plugins on source `dsh web`.

**Reuse `/api/update` and the remote-web-ui download button.** Rejected because that surface updates `@linxin666/dsh-web-all` via pnpm. Mixing a 270MB product zip into the same button would replace the wrong tree.

**electron-updater / Squirrel / in-place overwrite of the running exe.** Rejected: the published artifact is a folder zip, Windows locks `dsh-web.exe`, and the existing tray already treats Node exit as quit.

**Typert Remote for status/download.** Rejected for v1: download progress of a large zip fits Connection Fetch plus polling; a unary Remote would still need a second progress channel.

## Consequences

Packaged desktop users see Desktop update in Settings → General when `VERSION` sits beside the exe. Checking GitHub does not download the zip. Apply preserves `.config` (sessions, credentials, seeded and user-installed plugins). Tests pin version compare, zip selection (skip drafts and non-matching assets), loopback 403, digest failure, `.config` exclusion in the helper script, and the unavailable copy when the Host is not a packaged desktop. There is no assembled-application snapshot of a successful apply. Cross-links: [packaged Web desktop](2026-08-18-packaged-web-desktop-exe.md), [Windows splash and tray](2026-08-19-windows-packaged-desktop-tray.md).
