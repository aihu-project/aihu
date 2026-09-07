import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: { __DEV__: 'true' },
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      '@aihu/plugin': new URL('../plugin/src/index.ts', import.meta.url).pathname,
      '@aihu-plugin/data': new URL('../plugin-data/src/index.ts', import.meta.url).pathname,
      '@aihu/context': new URL('../context/src/index.ts', import.meta.url).pathname,
    },
  },
  optimizeDeps: {
    exclude: ['@aihu/magna-gqlmin'],
  },
  ssr: {
    noExternal: ['@aihu/plugin', '@aihu-plugin/data', '@aihu/context'],
    external: ['@aihu/magna-gqlmin'],
  },
})
