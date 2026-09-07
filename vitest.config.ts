import { defineConfig } from 'vitest/config'

export default defineConfig({
  // __DEV__ = true in tests so arbor telemetry hooks fire (same guard as
  // production `__DEV__ = false` in arbor's rolldown.config.ts define).
  define: { __DEV__: 'true' },
  test: {
    environment: 'jsdom',
    include: [
      'packages/*/tests/**/*.test.ts',
      // @aihu/primitives colocates keyboard/apg conformance tests next to each
      // primitive's source (src/<primitive>/*.test.ts), per the Plan 4 layout.
      'packages/*/src/**/*.test.ts',
      'tests/**/*.test.ts',
      'cookbook/**/*.test.ts',
    ],
    // These two tests are NOT dead — they run in CI as dedicated plan-a.yml
    // gate steps through vitest.gates.config.ts (root config minus this
    // exclude). They are excluded HERE so the default `bun run test`
    // [--coverage] run stays green in a fresh clone and does not double-run
    // them (#434/#445):
    //   - b3b-sidecar-tsc: needs the built aihu-compile binary AND
    //     packages/signals/dist (its tsc pass maps @aihu/* -> packages/*/dist),
    //     so its CI step runs AFTER `bun run build`.
    //   - legacy-snapshot: the arch-6 §7.3 backward-compat freeze; its CI step
    //     runs it exactly once (the coverage run would double it).
    exclude: [
      '**/node_modules/**',
      'packages/compiler/tests/b3b-sidecar-tsc.test.ts',
      'packages/cli/tests/legacy-snapshot.test.ts',
    ],
    // #445: a step that selects zero test files must FAIL, not exit 0. The
    // legacy-snapshot CI gate no-opped for weeks because the exclude above
    // defeated its explicit file filter and passWithNoTests let it exit 0
    // ("No test files found"). Guarded by tests/ci-gate-config.test.ts.
    passWithNoTests: false,
    // Per Director session-002 (.team/v1/director-notes/server-native-session-002.md §3):
    // set AIHU_NATIVE_SKIP=1 in the repo's test env so a fresh clone's
    // `bun run test` passes without a built native addon. The loader's
    // documented escape hatch (spec §5.3) is the right tool for this — it
    // routes packages/server through the TS implementation silently. CI
    // builds the addon and unsets this var on the parity-gate runner so
    // AC-9 (loud throw on missing binary) still gates real production use.
    env: {
      AIHU_NATIVE_SKIP: '1',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/types.ts', '**/index.ts'],
    },
  },
  resolve: {
    alias: {
      // Order matters: the subpath alias must precede the package alias, or
      // '@aihu/context' matches first and '@aihu/context/ssr' resolves to the
      // nonexistent '<index.ts>/ssr'. Two aliases below cite THIS pair as the
      // example to follow while it was itself inverted — nothing imported
      // '@aihu/context/ssr' until now, so the breakage had nowhere to surface.
      '@aihu/context/ssr': new URL('./packages/context/src/ssr.ts', import.meta.url).pathname,
      '@aihu/context': new URL('./packages/context/src/index.ts', import.meta.url).pathname,
      // Order matters: the subpath alias must precede the package alias.
      // `@aihu/compiler/plugin` is a RETIRED subpath (it never existed in the
      // published `exports` map — @aihu/cli 0.3.4 moved the scaffold to the
      // bare `@aihu/compiler` main export) and nothing imports it today. It is
      // mirrored here only because packages/cli/tsconfig.json still maps it, and
      // the alias-parity gate requires the two systems to agree; if that
      // tsconfig entry is ever removed, remove this line with it.
      '@aihu/compiler/plugin': new URL('./packages/compiler/js/index.ts', import.meta.url).pathname,
      '@aihu/compiler': new URL('./packages/compiler/js/index.ts', import.meta.url).pathname,
      '@aihu/tsc': new URL('./packages/tsc/src/index.ts', import.meta.url).pathname,
      // Order matters: the subpath alias must precede the package alias, or
      // '@aihu/app' matches first and '@aihu/app/client' resolves to the
      // nonexistent '<index.ts>/client' (same pattern as '@aihu/context/ssr').
      '@aihu/app/client': new URL('./packages/app/src/client.ts', import.meta.url).pathname,
      '@aihu/app': new URL('./packages/app/src/index.ts', import.meta.url).pathname,
      // `@aihu/cli` itself is not aliased (nothing imports the CLI's main
      // export from a test), so this subpath carries no ordering constraint.
      '@aihu/cli/template-manifest': new URL(
        './packages/cli/src/template-manifest.ts',
        import.meta.url,
      ).pathname,
      '@aihu/editor': new URL('./packages/editor/src/index.ts', import.meta.url).pathname,
      '@aihu/mcp': new URL('./packages/mcp/src/index.ts', import.meta.url).pathname,
      '@aihu/seo': new URL('./packages/seo/src/index.ts', import.meta.url).pathname,
      '@aihu/store': new URL('./packages/store/src/index.ts', import.meta.url).pathname,
      // Order matters: the subpath alias must precede the package alias or
      // '@aihu/runtime/ssr' resolves as '<index.ts>/ssr' (same pattern as
      // '@aihu/context/ssr' above).
      '@aihu/runtime/ssr': new URL('./packages/runtime/src/ssr-string.ts', import.meta.url)
        .pathname,
      '@aihu/runtime': new URL('./packages/runtime/src/index.ts', import.meta.url).pathname,
      '@aihu/agent': new URL('./packages/agent/src/index.ts', import.meta.url).pathname,
      '@aihu/server/head-lowering': new URL(
        './packages/server/src/head-lowering.ts',
        import.meta.url,
      ).pathname,
      '@aihu/server': new URL('./packages/server/src/index.ts', import.meta.url).pathname,
      '@aihu-plugin/agent-readiness': new URL(
        './packages/plugin-agent-readiness/src/index.ts',
        import.meta.url,
      ).pathname,
      '@aihu-plugin/data': new URL('./packages/plugin-data/src/index.ts', import.meta.url).pathname,
      '@aihu-plugin/kindly-note': new URL(
        './packages/plugin-kindly-note/src/index.ts',
        import.meta.url,
      ).pathname,
      '@aihu-plugin/drizzle': new URL('./packages/plugin-drizzle/src/index.ts', import.meta.url)
        .pathname,
      // Order matters: BOTH subpath aliases must precede the package alias, or
      // '@aihu/router' matches first and the subpaths resolve as
      // '<index.ts>/plugin' / '<index.ts>/server'.
      '@aihu/router/plugin': new URL('./packages/router/src/plugin.ts', import.meta.url).pathname,
      '@aihu/router/server': new URL('./packages/router/src/server.ts', import.meta.url).pathname,
      '@aihu/router': new URL('./packages/router/src/index.ts', import.meta.url).pathname,
      '@aihu/agent-service': new URL('./packages/agent-service/src/index.ts', import.meta.url)
        .pathname,
      '@aihu/agent-server': new URL('./packages/agent-server/src/index.ts', import.meta.url)
        .pathname,
      '@aihu/agent-a2a': new URL('./packages/agent-a2a/src/index.ts', import.meta.url).pathname,
      '@aihu/plugin': new URL('./packages/plugin/src/index.ts', import.meta.url).pathname,
      '@aihu/agent-acp': new URL('./packages/agent-acp/src/index.ts', import.meta.url).pathname,
      '@aihu/auth': new URL('./packages/auth/src/index.ts', import.meta.url).pathname,
      '@aihu/plugin-demo': new URL('./packages/plugin-demo/src/index.ts', import.meta.url).pathname,
      '@aihu/magna': new URL('./packages/magna/src/index.ts', import.meta.url).pathname,
      // @aihu/magna-gqlmin is an optional dep that doesn't exist on npm yet.
      // Alias to an empty stub so Vite doesn't hard-fail; codegen.ts catches
      // the missing export and falls back to untyped mode (graceful-skip).
      '@aihu/magna-gqlmin': new URL(
        './packages/magna/src/__stubs__/magna-gqlmin.ts',
        import.meta.url,
      ).pathname,
      // @aihu/primitives + the css-engine progressive shim it reuses (tooltip's
      // position() source import). Aliased to src so primitives tests run
      // without a prior dist build of either package.
      // Order matters: the subpath alias must precede the package alias (same
      // pattern as '@aihu/runtime/ssr' above) or '@aihu/primitives/focus-trap'
      // resolves as '<index.ts>/focus-trap'. @aihu/runtime's `<focusTrap>`
      // adapter imports this subpath (FEL-397 dedup).
      '@aihu/primitives/focus-trap': new URL(
        './packages/primitives/src/dialog/focus-trap.ts',
        import.meta.url,
      ).pathname,
      '@aihu/primitives': new URL('./packages/primitives/src/index.ts', import.meta.url).pathname,
      '@aihu/css-engine/runtime/progressive': new URL(
        './packages/css-engine/src/runtime/progressive.ts',
        import.meta.url,
      ).pathname,
      // @aihu/ui recipe-compile + shadow-adoption tests (Plan 5 Task 5) import
      // compileSfc + cn from source; aliased so they run without a prior dist
      // build of @aihu/css-engine (same rationale as @aihu/primitives above).
      // NOTE: order matters — the more-specific runtime/cn alias must precede
      // the bare '@aihu/css-engine' entry so it wins.
      '@aihu/css-engine/runtime/cn': new URL(
        './packages/css-engine/src/runtime/cn.ts',
        import.meta.url,
      ).pathname,
      '@aihu/css-engine': new URL('./packages/css-engine/src/index.ts', import.meta.url).pathname,
      'virtual:aihu-routes': new URL(
        './packages/app/tests/__stubs__/aihu-routes.ts',
        import.meta.url,
      ).pathname,
      'virtual:aihu-layouts': new URL(
        './packages/app/tests/__stubs__/aihu-layouts.ts',
        import.meta.url,
      ).pathname,
      'virtual:aihu-components': new URL(
        './packages/app/tests/__stubs__/aihu-components.ts',
        import.meta.url,
      ).pathname,
    },
  },
})
