import { defineConfig } from 'rolldown'
import { dts } from 'rolldown-plugin-dts'

// Runtime deps, the compiler package, and node builtins stay external. The
// installed @aihu/compiler package supplies the public codemod and resolver at
// runtime; node: builtins must never be bundled.
const external = [
  /^node:/,
  /^@aihu\/compiler(?:\/|$)/,
  'vscode-languageserver',
  'vscode-languageserver/node.js',
  'vscode-languageserver-textdocument',
]

export default defineConfig([
  // ---------------------------------------------------------------------------
  // Library entries — server connection layer + editor-agnostic core surface.
  // ---------------------------------------------------------------------------
  {
    input: {
      server: 'src/server.ts',
      'core/index': 'src/core/index.ts',
    },
    platform: 'node',
    external,
    checks: { circularDependency: true },
    output: {
      dir: 'dist',
      format: 'esm',
      sourcemap: true,
      entryFileNames: '[name].js',
    },
    plugins: [dts()],
  },

  // ---------------------------------------------------------------------------
  // Bin entry — the runnable `aihu-language-server` binary (stdio LSP server).
  // ---------------------------------------------------------------------------
  {
    input: { bin: 'src/bin.ts' },
    platform: 'node',
    external,
    checks: { circularDependency: true },
    output: {
      dir: 'dist',
      format: 'esm',
      banner: '#!/usr/bin/env node',
      entryFileNames: '[name].js',
    },
  },
])
