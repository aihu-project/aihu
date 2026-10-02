#!/usr/bin/env bun
/** Feature PR policy for css-engine native binaries.
 * Native source changes need a changeset for @aihu/css-engine. Platform
 * manifests and pins are generated in the Version PR after the packages have
 * been published, so editing them in a feature PR is an error.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const HOST_MANIFEST = 'packages/css-engine/package.json'
const PLATFORM_DIR = 'packages/css-engine/npm/'
const CHANGESET_DIR = '.changeset/'

export function isCssCoreRustSource(file: string): boolean {
  const crateRoot = 'packages/css-engine/crates/aihu-css-core/'
  return (
    (file.startsWith(`${crateRoot}src/`) && file.endsWith('.rs')) ||
    file === `${crateRoot}Cargo.toml` ||
    file === `${crateRoot}build.rs` ||
    (file.startsWith(`${crateRoot}recipes/`) && file.endsWith('.css'))
  )
}

export function isPlatformManifest(file: string): boolean {
  return (
    file.startsWith(PLATFORM_DIR) && /^packages\/css-engine\/npm\/[^/]+\/package\.json$/.test(file)
  )
}

export function isVersionPr(branch: string | undefined): boolean {
  return branch === 'changeset-release/main'
}

export function checkBump(
  changedFiles: string[],
  changesetContents: Record<string, string> = {},
  versionPr = false,
  hostPinsChanged = false,
): { ok: boolean; message: string } {
  if (!versionPr) {
    const handBumps = changedFiles.filter(isPlatformManifest)
    if (handBumps.length || hostPinsChanged) {
      return {
        ok: false,
        message: `Platform versions and pins are generated in the Version PR; remove these feature-PR edits:\n${[
          ...handBumps.map((f) => `  - ${f}`),
          ...(hostPinsChanged ? [`  - ${HOST_MANIFEST} optionalDependencies`] : []),
        ].join('\n')}`,
      }
    }
  }

  const native = changedFiles.filter(isCssCoreRustSource)
  if (!native.length) return { ok: true, message: 'ok' }

  const hasChangeset = changedFiles.some((file) => {
    if (!file.startsWith(CHANGESET_DIR) || !file.endsWith('.md')) return false
    const body = changesetContents[file] ?? ''
    return /^['"]?@aihu\/css-engine['"]?:\s*patch\s*$/m.test(body)
  })
  if (hasChangeset) return { ok: true, message: 'ok' }
  return {
    ok: false,
    message: `Native css-engine source changed (${native.join(', ')}), but no changeset for @aihu/css-engine was found. Add a patch changeset.`,
  }
}

function changedFilesVsBase(): { files: string[]; mergeBase: string } | null {
  const base = process.env.BASE_REF || process.env.GITHUB_BASE_REF || 'main'
  let mergeBase: string
  try {
    mergeBase = execFileSync('git', ['merge-base', `origin/${base}`, 'HEAD'], {
      encoding: 'utf8',
    }).trim()
  } catch {
    return null
  }
  const files = execFileSync('git', ['diff', '--name-only', mergeBase, 'HEAD'], {
    encoding: 'utf8',
  })
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean)
  return { files, mergeBase }
}

function hostPinsDifferFromBase(base: string): boolean {
  try {
    const baseManifest = JSON.parse(
      execFileSync('git', ['show', `${base}:${HOST_MANIFEST}`], { encoding: 'utf8' }),
    ) as { optionalDependencies?: Record<string, string> }
    const headManifest = JSON.parse(readFileSync(join(ROOT, HOST_MANIFEST), 'utf8')) as {
      optionalDependencies?: Record<string, string>
    }
    return (
      JSON.stringify(baseManifest.optionalDependencies ?? {}) !==
      JSON.stringify(headManifest.optionalDependencies ?? {})
    )
  } catch {
    return false
  }
}

if (import.meta.main) {
  const override = process.env.CHANGED_FILES
  const diff = override ? null : changedFilesVsBase()
  const files = override
    ? override
        .split(/[\n,]/)
        .map((file) => file.trim())
        .filter(Boolean)
    : (diff?.files ?? [])
  const changesets: Record<string, string> = {}
  if (process.env.CSS_ENGINE_CHANGESET_CONTENTS) {
    Object.assign(changesets, JSON.parse(process.env.CSS_ENGINE_CHANGESET_CONTENTS))
  }
  for (const file of files.filter((f) => f.startsWith(CHANGESET_DIR) && f.endsWith('.md'))) {
    try {
      changesets[file] ??= readFileSync(join(ROOT, file), 'utf8')
    } catch {
      // Deleted changesets and synthetic paths are not usable changesets.
    }
  }
  const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME
  const hostPinsChanged =
    files.includes(HOST_MANIFEST) && diff ? hostPinsDifferFromBase(diff.mergeBase) : false
  const result = checkBump(files, changesets, isVersionPr(branch), hostPinsChanged)
  if (!result.ok) {
    console.error(`FAIL: ${result.message}`)
    process.exit(1)
  }
  console.log('css-engine binary bump guard: ok')
}
