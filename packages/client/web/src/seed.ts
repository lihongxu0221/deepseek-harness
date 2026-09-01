/**
 * Platform-singleton module-table. Fetch bundles resolve their externals
 * against this table through the loader's require. {@link PLATFORM_MODULES}
 * remains the single source of truth with the tsdown client externals;
 * values stay shell-static imports so every bundle sees the same instance.
 * {@link getStaticModules} may add extra keys that first-party bundles must
 * not treat as baseline words.
 */
import * as React from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import * as ReactDom from 'react-dom'
import * as ReactDomClient from 'react-dom/client'
import * as Cordis from '@deepseek-ai/cordis'
import * as ClientStore from '@deepseek-ai/dsh-client-store'
import * as UiSlots from '@deepseek-ai/dsh-client-ui-slots'
import * as UiPrimitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { PlatformModule } from './platform.ts'

/**
 * Build the static table handed to the module loader at boot.
 * @returns module specifier → exported entity (platform words plus Runtime aliases).
 */
export function getStaticModules(): Record<string, unknown> {
  // The satisfies pin is the projection contract: a word added to
  // PLATFORM_MODULES without a static import here (or vice versa) fails to
  // compile instead of drifting into a runtime require miss.
  const modules = {
    'react': React,
    'react/jsx-runtime': ReactJsxRuntime,
    'react-dom': ReactDom,
    'react-dom/client': ReactDomClient,
    '@deepseek-ai/cordis': Cordis,
    '@deepseek-ai/dsh-client-store': ClientStore,
    '@deepseek-ai/dsh-client-ui-slots': UiSlots,
    '@deepseek-ai/dsh-client-ui-primitives': UiPrimitives,
  } satisfies Record<PlatformModule, unknown>
  // Keep these keys as literals; a computed table can drop them from the Vite
  // artifact. Seed matching is exact, so both the package name and `/client`
  // must be present. These are not PLATFORM_MODULES words; first-party bundles
  // must not request them.
  return {
    ...modules,
    '@deepseek-ai/dsh-client-runtime': ClientStore,
    '@deepseek-ai/dsh-client-runtime/client': ClientStore,
  }
}
