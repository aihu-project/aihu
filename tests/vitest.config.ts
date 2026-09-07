import { defineConfig } from 'vitest/config'

/**
 * Cross-package integration test config per spec §4 (Task 19).
 *
 * The root `vitest.config.ts` only covers `packages/*\/tests/**`. This
 * config covers `tests/integration/**` — tests that import from multiple
 * `@aihu/*` packages to verify they compose correctly.
 *
 * Run via the root package.json script: `bun run test:integration`.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/integration/**/*.test.ts'],
    passWithNoTests: false,
    // `@aihu/server` selects its TypeScript SSR fallback rather than requiring a
    // built native addon — the same reason the root `vitest.config.ts` sets it.
    env: { AIHU_NATIVE_SKIP: '1' },
  },
  resolve: {
    alias: {
      // Added for `ssr-state-channel.test.ts` — the wave-3 round-trip pipes
      // real @aihu/server state-script output into @aihu/store hydration and
      // @aihu/arbor signal pre-seeding.
      '@aihu/store': new URL('../packages/store/src/index.ts', import.meta.url).pathname,
      '@aihu/context': new URL('../packages/context/src/index.ts', import.meta.url).pathname,
      // Subpath before package (wave-3): '@aihu/runtime/ssr' must not resolve
      // through the package alias as '<index.ts>/ssr'.
      '@aihu/runtime/ssr': new URL('../packages/runtime/src/ssr-string.ts', import.meta.url)
        .pathname,
      '@aihu/runtime': new URL('../packages/runtime/src/index.ts', import.meta.url).pathname,
      // Added for `ssr-hydrate-path-parity.test.ts`, which is cross-package by
      // nature. The DOM engine resolves through its published package boundary.
      '@aihu/server': new URL('../packages/server/src/index.ts', import.meta.url).pathname,
    },
  },
})
