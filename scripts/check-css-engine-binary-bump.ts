#!/usr/bin/env bun
/**
 * CI guard: a change to aihu-css-core's Rust source MUST bump
 * @aihu/css-engine's platform binary packages, or the fix never ships.
 *
 * One family — packages/css-engine/npm/<platform> → @aihu/css-engine-<platform>
 * (the aihu-css-compile CLI binary). Unlike the compiler package, which is
 * released in its own repository, this package ships
 * no napi addon, so there is only one family to keep in lockstep; the general
 * rule (shared source, lockstep, host-pin repoint) lives in
 * scripts/lib/native-binary-bump.ts.
 *
 * Added after the binary drifted silently: aba7e70d (#714) added a `tag`
 * field to aihu-css-core's SfcAst wire format, but the published platform
 * binaries stayed at 0.1.3 (last bumped in #293, long before #714) — every
 * compileSfc() call started throwing `missing field 'tag'`, caught non-fatally
 * and silently degraded to a no-op fallback (utility-class CSS compilation
 * stopped working, with only a console warning as a symptom). This is the
 * exact FEL-414 failure shape @aihu/compiler's guard
 * (the former root compiler guard) already prevented — this file is the same
 * protection for aihu-css-core.
 *
 * Usage:
 *   bun scripts/check-css-engine-binary-bump.ts            # diff vs origin/<base>
 *   BASE_REF=main bun scripts/check-css-engine-binary-bump.ts
 *   CHANGED_FILES='a,b' bun scripts/check-css-engine-binary-bump.ts
 *
 * Exit 0 = ok (or nothing to check), 1 = a required platform bump is missing.
 */
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBumpChecker } from './lib/native-binary-bump.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export const HOST_MANIFEST = 'packages/css-engine/package.json'

export type Family = 'cli'

export const FAMILIES: Record<Family, { dir: string; label: string }> = {
  cli: {
    dir: 'packages/css-engine/npm',
    label: '@aihu/css-engine-<platform> (aihu-css-compile CLI binary)',
  },
}

/**
 * True when the file feeds the compiled aihu-css-core binary — Rust source
 * under `src/`, the crate manifest, `build.rs`, OR a `recipes/*.css` file.
 * The last two were a real gap (tailwind-animations port doc, Track A
 * Slice 13): `build.rs` `include_str!`s every `recipes/*.css` file into
 * `RECIPE_SOURCES` (see that file's own doc comment) — a recipe-family CSS
 * edit changes the compiled binary's output exactly like a `.rs` edit does,
 * but neither file matched the old `src/**.rs`-only predicate, so this guard
 * could pass while the binary silently went stale — the exact FEL-414
 * failure shape this file exists to prevent, just for CSS instead of Rust.
 */
export function isCssCoreRustSource(file: string): boolean {
  const crateRoot = 'packages/css-engine/crates/aihu-css-core/'
  return (
    (file.startsWith(`${crateRoot}src/`) && file.endsWith('.rs')) ||
    file === `${crateRoot}Cargo.toml` ||
    file === `${crateRoot}build.rs` ||
    (file.startsWith(`${crateRoot}recipes/`) && file.endsWith('.css'))
  )
}

const checker = createBumpChecker<Family>(
  {
    hostManifest: HOST_MANIFEST,
    families: FAMILIES,
    isSharedSource: isCssCoreRustSource,
  },
  ROOT,
)

export const platformManifestFamily = checker.platformManifestFamily
export const isPlatformManifest = checker.isPlatformManifest
export const discoverPlatforms = checker.discoverPlatforms
export const checkBump = checker.checkBump

function changedFilesVsBase(): string[] {
  const base = process.env.BASE_REF || process.env.GITHUB_BASE_REF || 'main'
  const ref = `origin/${base}`
  let mergeBase: string
  try {
    mergeBase = execSync(`git merge-base ${ref} HEAD`, { encoding: 'utf8' }).trim()
  } catch {
    return []
  }
  return execSync(`git diff --name-only ${mergeBase} HEAD`, { encoding: 'utf8' })
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

if (import.meta.main) {
  const override = process.env.CHANGED_FILES
  const files = override
    ? override
        .split(/[\n,]/)
        .map((l) => l.trim())
        .filter(Boolean)
    : changedFilesVsBase()
  const result = checkBump(files)
  if (!result.ok) {
    console.error(`FAIL: ${result.message}`)
    process.exit(1)
  }
  console.log('css-engine binary bump guard: ok')
}
