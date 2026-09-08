import { defineConfig } from 'rolldown'
import { dts } from 'rolldown-plugin-dts'

const external = [
  // MUST stay external. `@aihu/context` keeps the active context map in a
  // module-global (`_activeContextMap`), so a bundled copy is a SECOND map:
  // `prerender.ts` would populate its private one while user components read
  // the app's, and `inject()` would return token defaults with nothing to
  // indicate why. Tests can't catch it — vitest aliases `@aihu/context` to
  // source, so the duplicate only exists in the published dist.
  '@aihu/context',
  '@aihu/context/ssr',
  '@aihu/router',
  '@aihu/router/plugin',
  '@aihu/server',
  '@aihu/server/head-lowering',
  '@aihu/arbor',
  // The subpath needs its OWN entry: rolldown's `external` matches exact
  // specifiers, so listing '@aihu/arbor' alone does not cover
  // '@aihu/arbor/hydrate' and the whole hydration walker gets inlined into
  // client.js (observed: 4.8 kB -> 13.2 kB, blowing the size row by 3 kB).
  // Same failure shape as '@aihu/context/ssr' and '@aihu/signals/lifecycle'.
  '@aihu/arbor/hydrate',
  '@aihu/signals',
  '@aihu/store',
  '@aihu/runtime',
  // The app bootstrap consumes the narrow runtime integration bridge. Keep
  // its subpath external too, or a workspace build would inline a second
  // runtime copy and hide the published package boundary.
  '@aihu/runtime/app',
  '@aihu-plugin/agent-readiness',
  '@aihu/compiler',
  'vite',
  // node: builtins externalized by PATTERN so the allowlist can't drift as new
  // builtins are imported (FEL-EXTERNALS). The build-time index entry is the
  // only node: consumer; the browser client entry imports none.
  /^node:/,
  'virtual:aihu-routes',
  'virtual:aihu-layouts',
]

// `__DEV__ = false` in the published build so rolldown DCEs author-only
// diagnostics (see client.ts's no-<outlet> warning). Mirrors arbor's config.
const transform = { define: { __DEV__: 'false' } }

export default defineConfig([
  // Main entry — build/config-time only. No DOM. No size-limit row.
  {
    input: 'src/index.ts',
    external,
    checks: { circularDependency: true },
    output: {
      dir: 'dist',
      format: 'esm',
      sourcemap: true,
      minify: true,
    },
    plugins: [dts()],
  },
  // Client entry — browser runtime. Measured by .size-limit.json (≤400 B gz).
  {
    input: { client: 'src/client.ts' },
    transform,
    external,
    checks: { circularDependency: true },
    output: {
      dir: 'dist',
      format: 'esm',
      sourcemap: true,
      minify: true,
      entryFileNames: '[name].js',
    },
    plugins: [dts({ outFile: 'dist/client.d.ts' })],
  },
  // SSR document assembly — bundled INTO the consumer's Worker by the `ssr`
  // environment (the generated `virtual:aihu-server-entry` imports it), so it
  // holds the same properties as the client entry: no `node:` builtin, no DOM
  // at module scope. `check:runtime-purity` scans it on the `browser-edge`
  // tier. Its own entry rather than a re-export from `dist/index.js` because
  // that file IS the Vite plugin — full of `node:fs`/`node:path` — and pulling
  // it into a Worker bundle to reach one pure function is not a thing to ask a
  // bundler to tree-shake correctly.
  {
    input: { 'ssr-document': 'src/ssr-document.ts' },
    transform,
    external,
    checks: { circularDependency: true },
    output: {
      dir: 'dist',
      format: 'esm',
      sourcemap: true,
      minify: true,
      entryFileNames: '[name].js',
    },
    plugins: [dts({ outFile: 'dist/ssr-document.d.ts' })],
  },
  // The `node:module` stub the SSR plugin resolves to (see vite-plugin.ts,
  // "D-1"). Its own artifact rather than a string inside the main entry: the
  // export name is load-bearing and cannot be renamed, and carrying it as
  // source text inside `dist/index.js` would trip `check:runtime-purity`'s
  // token scan on data that is never imported and never executed. As a
  // declared boundary artifact it is scanned on its own terms instead — see
  // the `builtin-stub` tier in scripts/check-runtime-purity.ts.
  //
  // NOT minified and NOT source-mapped: it is ~3 lines of code, it is read by
  // whoever is debugging a Worker bundle that unexpectedly contains it, and a
  // `.map` sibling would be a second file to ship for no benefit.
  //
  // NO `external` here. The stub imports nothing, and inheriting the shared
  // list (which externalizes /^node:/) would be actively wrong for a file
  // whose entire job is to keep a node: builtin out of a bundle.
  {
    input: { 'node-module-stub': 'src/node-module-stub.js' },
    checks: { circularDependency: true },
    output: {
      dir: 'dist',
      format: 'esm',
      sourcemap: false,
      minify: false,
      entryFileNames: '[name].js',
    },
  },
])
