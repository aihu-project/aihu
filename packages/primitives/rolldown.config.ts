import { defineConfig } from 'rolldown'
import { dts } from 'rolldown-plugin-dts'

export default defineConfig({
  // Multi-entry: one key per primitive (+ the shared dom-context util). Each
  // lowers to its own `dist/<name>.js` so every primitive gets an independent
  // `.size-limit.json` row that tree-shakes on its own (the same pattern
  // css-engine uses for runtime/cn + runtime/progressive). The per-primitive,
  // under-4-KB budget is the contract — NOT one bundled row.
  input: {
    index: 'src/index.ts',
    'dom-context': 'src/dom-context.ts',
    'presence-gate': 'src/presence-gate/index.ts',
    'form-control': 'src/form-control/index.ts',
    'config-provider': 'src/config-provider/index.ts',
    collection: 'src/collection/index.ts',
    'roving-focus': 'src/roving-focus/index.ts',
    dialog: 'src/dialog/index.ts',
    // The focus trap gets its OWN entry (not just `./dialog`) because
    // @aihu/runtime's `<focusTrap>` adapter consumes it — importing `./dialog`
    // there would drag the whole dialog primitive into runtime's single
    // bundled dist for the sake of one factory. FEL-397 / aihu-project/aihu#537.
    'focus-trap': 'src/dialog/focus-trap.ts',
    tooltip: 'src/tooltip/index.ts',
    button: 'src/button/index.ts',
    separator: 'src/separator/index.ts',
    label: 'src/label/index.ts',
    input: 'src/input/index.ts',
    textarea: 'src/textarea/index.ts',
    checkbox: 'src/checkbox/index.ts',
    switch: 'src/switch/index.ts',
    'radio-group': 'src/radio-group/index.ts',
    slider: 'src/slider/index.ts',
    popover: 'src/popover/index.ts',
  },
  output: {
    dir: 'dist',
    format: 'esm',
    sourcemap: true,
    entryFileNames: '[name].js',
  },
  plugins: [dts()],
  // Substrate stays external so each primitive's dist measures only its own
  // code (matching the `.size-limit.json` ignore lists). tooltip imports the
  // position() shim from @aihu/css-engine/runtime/progressive — both the bare
  // and subpath specifiers are externalized.
  //
  // DELIBERATE: no `node:` externals, and DO NOT add a `/^node:/` pattern
  // (FEL-EXTERNALS ruling). primitives is a BROWSER-tier, size-gated package
  // (each entry has a `.size-limit.json` row); a `node:` import in a bundled
  // entry is a genuine bug that must FAIL LOUDLY, not be silently externalized.
  // (The only current node: imports are in a *.test.ts, which is not a bundle
  // input — so nothing to externalize here.)
  external: [
    '@aihu/signals',
    '@aihu/arbor',
    '@aihu/css-engine',
    '@aihu/css-engine/runtime/progressive',
    '@aihu/css-engine/runtime/cn',
  ],
})
