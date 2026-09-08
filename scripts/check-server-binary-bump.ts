#!/usr/bin/env bun
/**
 * CI guard: a change to @aihu/server's native renderer Rust source MUST bump
 * the platform binary packages, or the fix never ships.
 *
 * One family — packages/server/npm/<platform> → @aihu/server-<platform> (the
 * napi-rs SSR renderer addon). Same shape as
 * scripts/check-css-engine-binary-bump.ts; see
 * the shared native-binary-bump helper for the FEL-414 history this class of
 * guard exists to prevent (a native binary silently going stale relative to
 * its own source, with only a runtime symptom — not a build failure — as the
 * tell).
 *
 * Usage:
 *   bun scripts/check-server-binary-bump.ts            # diff vs origin/<base>
 *   BASE_REF=main bun scripts/check-server-binary-bump.ts
 *   CHANGED_FILES='a,b' bun scripts/check-server-binary-bump.ts
 *
 * Exit 0 = ok (or nothing to check), 1 = a required platform bump is missing.
 */
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBumpChecker } from './lib/native-binary-bump.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export const HOST_MANIFEST = 'packages/server/package.json'

export type Family = 'napi'

export const FAMILIES: Record<Family, { dir: string; label: string }> = {
  napi: {
    dir: 'packages/server/npm',
    label: '@aihu/server-<platform> (napi-rs SSR renderer)',
  },
}

/** True when the file is the server's native-renderer Rust source. */
export function isServerRustSource(file: string): boolean {
  return (
    (file.startsWith('packages/server/src-native/') && file.endsWith('.rs')) ||
    file === 'packages/server/src-native/Cargo.toml'
  )
}

const checker = createBumpChecker<Family>(
  {
    hostManifest: HOST_MANIFEST,
    families: FAMILIES,
    isSharedSource: isServerRustSource,
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
  console.log('server binary bump guard: ok')
}
