import { defineConfig } from 'tsdown'

/**
 * Build the desktop-compat file-format shim. The package has no Typert faces
 * and no invariant/startup modules, so the shared host-face entry glob does
 * not apply; only the single public entry is bundled.
 */
export default defineConfig({
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
