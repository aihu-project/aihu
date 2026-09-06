#!/usr/bin/env bun
/**
 * Pre-build hook: stage the compiler WASM bundle for the docs playground.
 *
 * Used by `apps/docs` to embed the WASM playground bundle at build
 * time (Directive 1 — homepage interactive playground per
 * `docs/roadmap/_user-directives.md`).
 *
 * Regression #491: this script previously ONLY fetched the latest
 * `aihu-compile-wasm.tar.gz` from GitHub Releases. Once the workspace
 * grammar moved past the last release (grammar v2, #489), the playground
 * presets failed to compile (C306) on every PR — main's playground was
 * pinned to a stale compiler. The bundle must therefore be BUILT FROM THE
 * WORKSPACE SOURCE so the playground always matches the checked-out grammar.
 *
 * Behavior (in priority order):
 *   1. Reuse: `packages/compiler/pkg-wasm/` exists and its `build-stamp.json`
 *      matches the current hash of the compiler's Rust inputs → copy into
 *      `<outDir>/`. This is what makes repeat local builds fast, and what
 *      lets the CI deploy job reuse the smoke-test job's build via an
 *      artifact instead of installing the Rust toolchain twice.
 *   2. Build: `wasm-pack` + the `wasm32-unknown-unknown` target are
 *      available → `wasm-pack build --target web --out-dir pkg-wasm`
 *      (same invocation as `bun run build:wasm` in packages/compiler and
 *      the release.yml build-wasm job), write the stamp, copy to `<outDir>/`.
 *   3. Fetch (fallback only): no wasm toolchain → download the latest
 *      release tarball. Loudly warned: the release may LAG the workspace
 *      grammar, so presets can fail to compile. Never used in CI (the
 *      smoke-test job installs the toolchain).
 *   4. Nothing worked → write an `UNAVAILABLE` marker and exit 0 so the
 *      docs build proceeds (the playground shows a runtime fallback), or
 *      exit 1 under `--strict` (production deploys).
 *
 * Usage:
 *   bun scripts/build-wasm-bundle.ts <outDir> [--strict]
 *
 * Spec: docs/roadmap/_user-directives.md Directive 1; arch-4 §4.6.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const outDirArg = args.find((a) => !a.startsWith('--'))
const strict = args.includes('--strict')

if (!outDirArg) {
  console.error('Usage: build-wasm-bundle.ts <output-dir> [--strict]')
  process.exit(1)
}

const outDir = resolve(outDirArg)
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const compilerDir = join(repoRoot, 'packages/compiler')
const pkgWasmDir = join(compilerDir, 'pkg-wasm')
// NOT dot-prefixed: actions/upload-artifact@v4 drops hidden files by default,
// and the CI deploy job reuses pkg-wasm (stamp included) via an artifact.
const stampPath = join(pkgWasmDir, 'build-stamp.json')

console.log(`[build-wasm-bundle] target: ${outDir}`)

// ── Source hash ──────────────────────────────────────────────────
// Content hash of everything that determines the WASM output: the
// compiler crate's Rust sources + manifest, and the workspace manifest +
// lockfile (the root Cargo.toml carries the size-optimized [profile.release]
// — see WASM.md). Deterministic across machines/jobs on the same checkout.

async function collectFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) out.push(...(await collectFiles(p)))
    else out.push(p)
  }
  return out
}

async function sourceHash(): Promise<string> {
  const inputs = [
    ...(await collectFiles(join(compilerDir, 'src'))).sort(),
    join(compilerDir, 'Cargo.toml'),
    join(repoRoot, 'Cargo.toml'),
    join(repoRoot, 'Cargo.lock'),
  ]
  const h = createHash('sha256')
  for (const f of inputs) {
    h.update(f.slice(repoRoot.length)) // path (repo-relative, so hash is machine-independent)
    h.update('\0')
    h.update(await readFile(f))
    h.update('\0')
  }
  return h.digest('hex')
}

// ── Copy pkg-wasm → outDir ───────────────────────────────────────

async function stageBundle(): Promise<void> {
  await mkdir(outDir, { recursive: true })
  // Skip build-internal files; the retired apps/docs build.ts also stripped
  // non-runtime files (package.json, README, .d.ts) before deploy.
  const skip = new Set(['.gitignore', 'build-stamp.json'])
  for (const ent of await readdir(pkgWasmDir, { withFileTypes: true })) {
    if (!ent.isFile() || skip.has(ent.name)) continue
    await copyFile(join(pkgWasmDir, ent.name), join(outDir, ent.name))
  }
  for (const f of ['aihu_compiler.js', 'aihu_compiler_bg.wasm']) {
    if (!existsSync(join(outDir, f))) {
      console.error(`[build-wasm-bundle] missing expected file after staging: ${f}`)
      process.exit(1)
    }
  }
  // A prior fetch-fallback run may have left an UNAVAILABLE marker.
  await rm(join(outDir, 'UNAVAILABLE'), { force: true })
}

// ── 1. Reuse a fresh existing build ──────────────────────────────

const hash = await sourceHash()

if (existsSync(stampPath) && existsSync(join(pkgWasmDir, 'aihu_compiler_bg.wasm'))) {
  try {
    const stamp = JSON.parse(await readFile(stampPath, 'utf8')) as { sourceHash?: string }
    if (stamp.sourceHash === hash) {
      console.log('[build-wasm-bundle] pkg-wasm is up to date with compiler sources — reusing.')
      await stageBundle()
      console.log('[build-wasm-bundle] done (reused).')
      process.exit(0)
    }
    console.log('[build-wasm-bundle] pkg-wasm is stale (compiler sources changed) — rebuilding.')
  } catch {
    console.log('[build-wasm-bundle] unreadable build stamp — rebuilding.')
  }
}

// ── 2. Build from the workspace compiler ─────────────────────────

// wasm-pack resolves rustc from PATH. On machines where a non-rustup rust
// (e.g. Homebrew) shadows the rustup shims, that rustc has no
// wasm32-unknown-unknown target and no rust-toolchain.toml awareness — so
// when rustup is present, prepend its shim directory to PATH so cargo/rustc
// resolve through rustup (which honors the repo's rust-toolchain.toml pin).
function rustupAwareEnv(): NodeJS.ProcessEnv {
  // The proxy binaries live next to `rustup` itself (~/.cargo/bin).
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['rustup'], {
    encoding: 'utf8',
  })
  const rustupPath = probe.status === 0 ? probe.stdout?.split('\n')[0]?.trim() : null
  if (!rustupPath) return process.env
  const shimDir = dirname(rustupPath)
  return { ...process.env, PATH: `${shimDir}${delimiter}${process.env.PATH ?? ''}` }
}

const buildEnv = rustupAwareEnv()
const wasmPackCheck = spawnSync('wasm-pack', ['--version'], { stdio: 'ignore', env: buildEnv })
const haveWasmPack = wasmPackCheck.status === 0

if (haveWasmPack) {
  console.log('[build-wasm-bundle] building pkg-wasm from workspace source (wasm-pack)…')
  const build = spawnSync('wasm-pack', ['build', '--target', 'web', '--out-dir', 'pkg-wasm'], {
    cwd: compilerDir,
    stdio: 'inherit',
    env: buildEnv,
  })
  if (build.status !== 0) {
    console.error(`[build-wasm-bundle] wasm-pack build failed (status=${build.status})`)
    console.error('  If the wasm32 target is missing: rustup target add wasm32-unknown-unknown')
    process.exit(1)
  }
  await writeFile(
    stampPath,
    `${JSON.stringify({ sourceHash: hash, builtAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  )
  await stageBundle()
  console.log('[build-wasm-bundle] done (built from source).')
  process.exit(0)
}

// ── 3. Fallback: fetch the last release (may lag the workspace) ──

console.warn(
  '[build-wasm-bundle] wasm-pack not found — cannot build the compiler WASM from source.',
)
console.warn('  Install it to get a playground that matches this checkout:')
console.warn('    rustup target add wasm32-unknown-unknown && cargo install wasm-pack')
console.warn('  Falling back to the latest GitHub Release bundle, which may LAG the')
console.warn('  workspace grammar (stale-release presets fail with C306 — see #491).')

const url =
  process.env.AIHU_WASM_BUNDLE_URL ??
  'https://github.com/aihu-project/aihu/releases/latest/download/aihu-compile-wasm.tar.gz'

console.log(`[build-wasm-bundle] fetch source: ${url}`)

let res: Response | null = null
try {
  res = await fetch(url, { redirect: 'follow' })
} catch (err) {
  console.warn(`[build-wasm-bundle] fetch failed: ${(err as Error).message}`)
}

if (!res?.ok) {
  const status = res ? `${res.status} ${res.statusText}` : 'network error'
  const msg = `[build-wasm-bundle] WASM bundle unavailable: ${status}`
  if (strict) {
    console.error(msg)
    console.error('  --strict was passed; failing the build.')
    console.error('  To unblock: install the wasm toolchain (preferred) or publish a release.')
    process.exit(1)
  }
  console.warn(msg)
  console.warn('  Continuing build without WASM (playground will show fallback notice).')
  // Still ensure outDir exists so later build steps don't fail on missing dir.
  await mkdir(outDir, { recursive: true })
  // Drop a marker file so the playground knows to render the fallback message.
  await writeFile(
    join(outDir, 'UNAVAILABLE'),
    `WASM bundle was not available at build time.\nURL: ${url}\nStatus: ${status}\n`,
    'utf8',
  )
  process.exit(0)
}

await mkdir(outDir, { recursive: true })
const tarBasename = 'wasm-bundle.tar.gz'
const tarPath = join(outDir, tarBasename)
const buf = Buffer.from(await res.arrayBuffer())
await writeFile(tarPath, buf)
console.log(`[build-wasm-bundle] downloaded ${buf.length} bytes`)

// Extract via the system tar binary. `--strip-components=1` drops the
// leading `pkg-wasm/` prefix so files land directly in <outDir>.
// Use cwd + relative filename to avoid MSYS2/Git Bash tar treating the
// "C:" drive prefix in Windows absolute paths as a hostname.
console.log(`[build-wasm-bundle] extracting to ${outDir}/`)
const tarRes = spawnSync('tar', ['-xzf', tarBasename, '--strip-components=1'], {
  cwd: outDir,
  stdio: 'inherit',
})

if (tarRes.status !== 0) {
  console.error(`[build-wasm-bundle] tar extract failed (status=${tarRes.status})`)
  process.exit(1)
}

// Drop the tarball after extraction.
await rm(tarPath)

// Sanity check: confirm the two critical files landed.
for (const f of ['aihu_compiler.js', 'aihu_compiler_bg.wasm']) {
  if (!existsSync(join(outDir, f))) {
    console.error(`[build-wasm-bundle] missing expected file after extract: ${f}`)
    process.exit(1)
  }
}

console.log('[build-wasm-bundle] done (fetched release — may lag workspace grammar).')
