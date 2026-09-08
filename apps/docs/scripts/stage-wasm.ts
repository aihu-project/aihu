#!/usr/bin/env bun
import { cp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Stage the published compiler WASM package for the in-browser playground.
 *
 * The docs site deliberately consumes the release artifact rather than building
 * compiler source. This keeps the docs deployment independent of Rust and
 * wasm-pack, and makes the playground's compiler version explicit in this
 * app's manifest and lockfile.
 */

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(appDir, 'public/wasm')
const require = createRequire(import.meta.url)

let packageJson: string
try {
  packageJson = require.resolve('@aihu/compiler-wasm/package.json')
} catch {
  console.error(
    '[stage-wasm] @aihu/compiler-wasm is required. Run `bun install` after the matching compiler release is published.',
  )
  process.exit(1)
}

const packageDir = dirname(packageJson)
await rm(outDir, { recursive: true, force: true })
await cp(packageDir, outDir, {
  recursive: true,
  filter(source) {
    const relative = source.slice(packageDir.length + 1)
    return relative === '' || ['aihu_compiler.js', 'aihu_compiler_bg.wasm'].includes(relative)
  },
})

for (const file of ['aihu_compiler.js', 'aihu_compiler_bg.wasm']) {
  const staged = join(outDir, file)
  if (!(await Bun.file(staged).exists())) {
    console.error(`[stage-wasm] package is missing ${file}`)
    process.exit(1)
  }
}

console.log('[stage-wasm] staged published @aihu/compiler-wasm → public/wasm/')
