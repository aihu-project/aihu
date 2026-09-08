/**
 * build.ts — example pipeline for compiling a CSS-pluggable aihu app.
 *
 * Runs three stages, none of which need Vite (Vite-on-Bun has a known
 * limitation with compiler workspace symlinks; use the published
 * `@aihu/compiler` package for this example.
 *
 *   1. Compile each .aihu SFC → .ts via `transform()`.
 *      For each compiled module, post-process the emitted defineElement
 *      call with `_injectShadowMode(..., 'light')` so the components
 *      mount in light DOM and Tailwind classes reach them.
 *   2. Bundle the compiled .ts modules (and `src/main.ts`) into
 *      `dist/main.js` via Bun's bundler.
 *   3. Run `bunx @tailwindcss/cli@3` to compile `src/styles/tailwind.css`
 *      into `dist/tailwind.css`, scanning the .aihu sources for the
 *      utility classes actually referenced (per `tailwind.config.ts`).
 *
 * Output:
 *   dist/main.js     — bundled JS (registers both custom elements)
 *   dist/tailwind.css — generated Tailwind utility set
 *
 * Run:
 *   bun run build.ts
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _injectShadowMode, transform } from '@aihu/compiler'

const __dirname = dirname(fileURLToPath(import.meta.url))
const componentsDir = resolve(__dirname, 'src/components')
const distDir = resolve(__dirname, 'dist')
mkdirSync(distDir, { recursive: true })
mkdirSync(resolve(__dirname, 'src/components/.gen'), { recursive: true })

// ─── Stage 1: compile .aihu → .ts (with shadowMode: 'light') ─────────────────
const sfcs = readdirSync(componentsDir).filter((f) => f.endsWith('.aihu'))
console.log(`[build] compiling ${sfcs.length} .aihu files...`)
for (const sfc of sfcs) {
  const inPath = resolve(componentsDir, sfc)
  const outPath = resolve(componentsDir, `${basename(sfc, '.aihu')}.ts`)
  const source = readFileSync(inPath, 'utf-8')
  const { code } = transform(source, inPath)
  // Capability addition: post-process for light-DOM mount so Tailwind classes apply.
  const lightDom = _injectShadowMode(code, 'light')
  writeFileSync(outPath, lightDom)
  console.log(`  ${sfc} → ${basename(outPath)}`)
}

// ─── Stage 2: bundle JS ────────────────────────────────────────────────────────
console.log('[build] bundling main.js...')
const bundle = await Bun.build({
  entrypoints: [resolve(__dirname, 'src/main.ts')],
  outdir: distDir,
  target: 'browser',
  format: 'esm',
  minify: false,
})
if (!bundle.success) {
  console.error('[build] bundle failed:', bundle.logs)
  process.exit(1)
}

// ─── Stage 3: run Tailwind CLI ─────────────────────────────────────────────────
console.log('[build] running tailwindcss...')
const tw = spawnSync(
  'bunx',
  [
    'tailwindcss',
    '-i',
    resolve(__dirname, 'src/styles/tailwind.css'),
    '-o',
    resolve(distDir, 'tailwind.css'),
    '-c',
    resolve(__dirname, 'tailwind.config.ts'),
  ],
  { stdio: 'inherit', shell: true },
)
if (tw.status !== 0) {
  console.error(`[build] tailwindcss failed (exit ${tw.status})`)
  process.exit(tw.status ?? 1)
}

console.log('[build] done. Run `bun server.ts` to view at http://localhost:3457/')
