import { defineConfig } from 'tsdown'

/**
 * The dsh CLI ships the command, the profile lifecycle shared with Desktop,
 * and the packaged Web desktop entry consumed from the deployed folder.
 * The thin pkg launcher is committed CommonJS (`packaged-web-launcher.cjs`)
 * because Node's SEA embedder runs that file as CJS.
 * The root tsdown builds only `lib/types/index.js`, so these overrides point
 * at the compiled faces; reachable mode modules bundle with each entry.
 * Declarations come from `tsc -b` (dts: false), matching every package.
 */
export default defineConfig([
  {
    entry: ['lib/types/bin.js', 'lib/types/profile-boot.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: ['lib/*.js'],
  },
  {
    entry: ['lib/types/packaged-web-bin.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
