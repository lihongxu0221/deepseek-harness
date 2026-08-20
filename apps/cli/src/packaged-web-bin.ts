#!/usr/bin/env node
/**
 * Packaged Web desktop entry. Double-click boots the `web` profile, then
 * opens the local GUI in a Chromium app window. On Windows the splash and
 * tray host owns lifetime: closing the app window does not stop the server.
 * This is not the JSON-RPC agent and does not read a sidecar cordis.yml.
 * A first extra argument that names an existing .js/.cjs/.mjs file is
 * imported instead, so a packaged host that spawn()s this executable with
 * a worker script behaves like node. CLI heads such as `plugin` and `--profile`
 * run the on-disk CLI against `.config` instead of claiming the GUI lock.
 * @module @deepseek-ai/dsh/packaged-web-bin
 */

/* v8 ignore file -- packaged desktop entry; window opening is unit-tested. */

import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { defaultDesktopWindowIo, DESKTOP_WINDOW_HANDOFF_MS, openDesktopWindow } from './open-desktop-window.ts'
import { defaultPackagedWebDesktopIo, runPackagedWebDesktop } from './packaged-web-desktop.ts'
import {
  extraPackagedArgv,
  packagedCliArgv,
  resolvePackagedCliEntry,
  resolvePackagedScriptArg,
} from './packaged-web-entry.ts'
import { applyPackagedWebHome } from './packaged-web-home.ts'
import { runProfile } from './profile-boot.ts'

const extra = extraPackagedArgv(process.argv, fileURLToPath(import.meta.url))
const script = resolvePackagedScriptArg(extra)
if (script !== undefined) {
  await import(pathToFileURL(script).href)
} else {
  const execDir = dirname(process.execPath)
  if (resolve(process.cwd()) !== resolve(execDir)) {
    process.chdir(execDir)
  }

  const home = applyPackagedWebHome(process.execPath)
  const cli = packagedCliArgv(extra)
  if (cli !== undefined) {
    const cliEntry = resolvePackagedCliEntry(process.execPath)
    process.argv = [process.execPath, cliEntry, ...cli]
    await import(pathToFileURL(cliEntry).href)
  } else if (process.platform === 'win32') {
    await runPackagedWebDesktop(defaultPackagedWebDesktopIo())
  } else {
    console.error(`dsh-web: starting the Web GUI (config ${home})`)

    const { ctx, shutdown } = await runProfile({
      environment: loadLayeredEnv('dsh'),
      profile: 'web',
      patchFiles: [],
      args: ['--no-open', ...process.argv.slice(2)],
    })

    const settled = ctx.get('loader')?.await()
    if (settled !== undefined) {
      try {
        await settled
      } catch {
        // Loader already reported the failed boot; stay quiet and let fail-loud exit.
      }
    }

    const port = ctx.get('webServer')?.port
    if (port === undefined) {
      console.error('dsh-web: web server did not start. This executable is a Web GUI, not the JSON-RPC agent.')
      await shutdown.shutdown(1)
    } else {
      const url = `http://127.0.0.1:${String(port)}`
      try {
        const opened = openDesktopWindow(url, defaultDesktopWindowIo())
        if (opened === undefined) {
          console.error(`dsh-web: open ${url} in a browser. Close this window to stop the server.`)
        } else {
          console.error('dsh-web: close the app window or this console to stop the server.')
          const openedAt = Date.now()
          void opened.wait.then(
            () => {
              if (Date.now() - openedAt < DESKTOP_WINDOW_HANDOFF_MS) {
                console.error(`dsh-web: the browser is at ${url}. Close this console to stop the server.`)
                return
              }
              void shutdown.shutdown(0)
            },
            (error: unknown) => {
              console.error(`dsh-web: desktop window failed: ${error instanceof Error ? error.message : String(error)}`)
              console.error(`dsh-web: the server is still at ${url}. Close this window to stop it.`)
            },
          )
        }
      } catch (error) {
        console.error(`dsh-web: ${error instanceof Error ? error.message : String(error)}`)
        console.error(`dsh-web: the server is still at ${url}. Close this window to stop it.`)
      }
    }
  }
}
