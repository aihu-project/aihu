import { defineConfig } from 'rolldown'
import { dts } from 'rolldown-plugin-dts'

const external = [
  'node:child_process',
  'node:module',
  'node:path',
  'node:url',
  'node:util',
  'node:fs',
  'node:fs/promises',
  'node:os',
  '@modelcontextprotocol/sdk',
  '@modelcontextprotocol/sdk/server/index.js',
  '@modelcontextprotocol/sdk/server/stdio.js',
  '@modelcontextprotocol/sdk/types.js',
  '@aihu/compiler',
]

export default defineConfig([
  {
    input: 'src/index.ts',
    external,
    checks: { circularDependency: true },
    output: {
      dir: 'dist',
      format: 'esm',
      sourcemap: true,
    },
    plugins: [dts()],
  },
  {
    input: 'bin/serve.ts',
    external,
    checks: { circularDependency: true },
    output: {
      dir: 'dist/bin',
      format: 'esm',
      banner: '#!/usr/bin/env node',
    },
  },
])
