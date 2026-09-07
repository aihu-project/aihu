import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Resolve workspace packages to `src` (mirrors the repo-root vitest.config.ts)
// so the example's integration test runs against source without a prior dist
// build. The example itself adds NO `.size-limit.json` row — it is private.
const pkg = (p: string) => fileURLToPath(new URL(`../../packages/${p}`, import.meta.url))

export default defineConfig({
  // __DEV__ = true so arbor telemetry hooks fire (same guard as the root config).
  define: { __DEV__: 'true' },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    env: { AIHU_NATIVE_SKIP: '1' },
    // Polyfill Constructable Stylesheets (jsdom 25 lacks replaceSync) before any
    // test module — the compiled component adopts a stylesheet for its @style.
    setupFiles: ['./tests/jsdom-polyfill.ts'],
    // Compile the REAL component (binary, --target client) before collection so
    // the test's static `import('./__generated__/...')` resolves.
    globalSetup: ['./tests/compile-fixture.ts'],
  },
  resolve: {
    alias: {
      // DOM-engine packages resolve from their published dependencies. The
      // remaining aliases keep this integration test on the consumer sources.
      '@aihu/runtime': pkg('runtime/src/index.ts'),
      '@aihu/agent': pkg('agent/src/index.ts'),
      '@aihu/agent-service': pkg('agent-service/src/index.ts'),
      '@aihu/agent-server': pkg('agent-server/src/index.ts'),
      '@aihu/compiler': pkg('compiler/js/index.ts'),
      '@aihu/context': pkg('context/src/index.ts'),
      // The REAL compiler artifact, written by the globalSetup at run time.
      'virtual:task-list-client': fileURLToPath(
        new URL('./tests/__generated__/task-list.client.ts', import.meta.url),
      ),
    },
  },
})
