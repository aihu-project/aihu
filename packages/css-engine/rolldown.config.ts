import { defineConfig } from 'rolldown'
import { dts } from 'rolldown-plugin-dts'

export default defineConfig({
  input: {
    index: 'src/index.ts',
    // Built-in style packs as StylePack objects (`@aihu/css-engine/packs`).
    // A SEPARATE entry so the pack token data is its own `dist/packs.js`,
    // importable without pulling in the build-time engine (`compile`/`compileSfc`,
    // which reach for the Rust binary + node: builtins). Pure data + the shared
    // `defineStylePack` serializer — no node: imports, so no size-limit row
    // (it rides on the build/dev-time @aihu/css-engine classification).
    packs: 'src/packs.ts',
    // Browser runtime sub-exports (Plan 3). Kept as SEPARATE entries so each
    // has its own `dist/runtime/*.js` for an independent `.size-limit.json`
    // row — merging them would blow the 1 KB `cn` budget (Risk #4 size-split).
    'runtime/cn': 'src/runtime/cn.ts',
    'runtime/progressive': 'src/runtime/progressive.ts',
  },
  output: {
    dir: 'dist',
    format: 'esm',
    sourcemap: true,
    entryFileNames: '[name].js',
  },
  plugins: [dts()],
  external: [
    'node:child_process',
    'node:fs',
    'node:module',
    'node:path',
    'node:url',
    // Bug A fix: keep @aihu/compiler external so consumers always resolve
    // the LIVE compiler module (with its current binary-resolution logic)
    // instead of a frozen pre-fix copy inlined into our bundle at build time.
    '@aihu/compiler',
    '@aihu/arbor/progressive',
  ],
})
