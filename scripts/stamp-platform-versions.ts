#!/usr/bin/env bun
/**
 * stamp-platform-versions.ts — keep native platform package versions and host
 * pins synchronized. Server follows its host version; css-engine has an
 * independent patch version advanced only for native source changes.
 *
 * Was `stamp-platform-snapshot.ts`, which did this for canary snapshots only.
 * The mechanism is identical for a stable release; only the guard differed. See
 * `--require-snapshot` below for the one behaviour that is canary-specific and
 * must stay that way.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * The platform packages under `packages/<host>/{npm,npm-native}/<platform>/`
 * are NOT workspace members — the root `workspaces` glob is `packages/*`, which
 * does not match nested dirs — so changesets never versions them. This script
 * keeps the remaining server platform manifests synchronized with the host
 * version and css-engine platform manifests synchronized with their own
 * release version and host pins.
 *
 * ── MODES ────────────────────────────────────────────────────────────────────
 *
 *   (default)            write: stamp platform versions + repoint host pins
 *   --check              verify only, never write; exit 1 on any mismatch
 *   --host <a[,b]>       limit to these hosts (staged rollout; default: all)
 *   --bump-css-engine    increment the css-engine platform family's patch
 *                        version and repoint its host pins (Version PR only)
 *   --published-version  latest css-engine platform version observed on npm;
 *                        prevents an abandoned Version PR's orphan version
 *                        from being reused
 *   --set-css-engine-version <v> use an already-published platform version
 *                        instead of advancing the patch
 *   --require-snapshot   hard-fail unless the host version is `0.0.0-*`
 *
 * ── --require-snapshot IS NOT VESTIGIAL ──────────────────────────────────────
 *
 * The old script hard-failed whenever the host version was not `0.0.0-*`. That
 * guard was INVERTED into this flag rather than deleted, and the distinction
 * matters: its job is to catch "`changeset version --snapshot` didn't run".
 * Dropped entirely, a canary whose snapshot step silently failed would stamp
 * the platform packages at the STABLE version and publish them to the `canary`
 * dist-tag — a canary resolving stable binaries, which is the exact bug the
 * original docblock was written against. Every canary call site in
 * release.yml must pass it. Stable release-time stamping must not.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Repo root, overridable so tests can drive a fixture tree. */
const ROOT = process.env.PLATFORM_SYNC_ROOT ?? join(import.meta.dir, '..')

/**
 * Each remaining root-owned host maps to the platform-package dirs it owns.
 * Enumerated, not globbed: a new native surface should be a deliberate edit
 * here. Compiler platform packages are synchronized by aihu-compiler.
 */
const HOSTS: Array<{ host: string; npmDirs: string[] }> = [
  { host: 'server', npmDirs: ['npm'] },
  { host: 'css-engine', npmDirs: ['npm'] },
]

type PackageJson = {
  name: string
  version: string
  optionalDependencies?: Record<string, string>
} & Record<string, unknown>

const readPkg = (path: string): PackageJson => JSON.parse(readFileSync(path, 'utf8'))
const writePkg = (path: string, pkg: PackageJson): void =>
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`)

function flagValue(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}

const CHECK = process.argv.includes('--check')
const REQUIRE_SNAPSHOT = process.argv.includes('--require-snapshot')
const BUMP_CSS_ENGINE = process.argv.includes('--bump-css-engine')
const setCssEngineVersion = flagValue('--set-css-engine-version')
const publishedVersion = flagValue('--published-version')
const hostFilter = flagValue('--host')
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean)

if (hostFilter) {
  const known = HOSTS.map((h) => h.host)
  const unknown = hostFilter.filter((h) => !known.includes(h))
  if (unknown.length > 0) {
    // Loud, not silent. A typo'd --host that quietly matched nothing would
    // report "0 hosts, all in sync" — a green run that checked nothing.
    console.error(`✗ unknown --host value(s): ${unknown.join(', ')}. Known: ${known.join(', ')}`)
    process.exit(1)
  }
}

const selected = hostFilter ? HOSTS.filter((h) => hostFilter.includes(h.host)) : HOSTS

if (BUMP_CSS_ENGINE && setCssEngineVersion) {
  console.error('✗ --bump-css-engine and --set-css-engine-version cannot be used together')
  process.exit(1)
}
if (setCssEngineVersion && !/^\d+\.\d+\.\d+$/.test(setCssEngineVersion)) {
  console.error(`✗ invalid stable css-engine platform version: ${setCssEngineVersion}`)
  process.exit(1)
}

const nativeSource = execFileSync(
  'git',
  ['rev-parse', 'HEAD:packages/css-engine/crates/aihu-css-core'],
  { cwd: join(import.meta.dir, '..'), encoding: 'utf8' },
).trim()

const problems: string[] = []
const label = CHECK ? 'check' : 'stamp'

for (const { host, npmDirs } of selected) {
  const hostPkgPath = join(ROOT, 'packages', host, 'package.json')
  if (!existsSync(hostPkgPath)) {
    problems.push(`packages/${host}/package.json does not exist`)
    continue
  }
  const hostPkg = readPkg(hostPkgPath)
  let version = hostPkg.version

  if (REQUIRE_SNAPSHOT && !version.startsWith('0.0.0-')) {
    problems.push(
      `${hostPkg.name} is at ${version}, not a 0.0.0-* snapshot. ` +
        'Run `bun scripts/canary-catchall-changeset.ts` then ' +
        '`changeset version --snapshot canary` first.',
    )
    continue
  }

  // Collect the platform manifests that exist ON DISK.
  const platformPkgPaths: string[] = []
  for (const npmDirName of npmDirs) {
    const npmDir = join(ROOT, 'packages', host, npmDirName)
    if (!existsSync(npmDir)) {
      problems.push(`packages/${host}/${npmDirName}/ does not exist`)
      continue
    }
    const platforms = readdirSync(npmDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
    if (platforms.length === 0) {
      problems.push(`no platform package dirs under packages/${host}/${npmDirName}/`)
      continue
    }
    for (const platform of platforms) {
      platformPkgPaths.push(join(npmDir, platform, 'package.json'))
    }
  }

  const optDeps: Record<string, string> = hostPkg.optionalDependencies ?? {}
  if (host === 'css-engine' && !BUMP_CSS_ENGINE) {
    // css-engine's native binaries have an independent patch stream. Ordinary
    // host package bumps must not publish duplicate binaries; preserve the
    // platform version and verify/stamp the exact pins against it.
    version = readPkg(platformPkgPaths[0]).version
  }
  if (BUMP_CSS_ENGINE && host === 'css-engine') {
    const firstPlatform = readPkg(platformPkgPaths[0])
    const versions = [firstPlatform.version, ...(publishedVersion ? [publishedVersion] : [])]
    const parsed = versions.map((v) => /^(\d+)\.(\d+)\.(\d+)$/.exec(v))
    if (parsed.some((m) => !m)) {
      problems.push(
        `cannot patch-bump non-stable css-engine platform version(s): ${versions.join(', ')}`,
      )
      continue
    }
    const highest = parsed
      .map((m) => m!.slice(1).map(Number))
      .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
      .at(-1)!
    const match = highest
    version = `${match[0]}.${match[1]}.${match[2] + 1}`
    const moved =
      platformPkgPaths.some((path) => readPkg(path).version !== version) ||
      Object.values(optDeps).some((pin) => pin !== version)
    console.log(`CSS_ENGINE_PLATFORM_VERSION_MOVED=${moved}`)
  }
  if (setCssEngineVersion && host === 'css-engine') {
    version = setCssEngineVersion
    // This version was already confirmed on npm; keep the publish job skipped.
    console.log('CSS_ENGINE_PLATFORM_VERSION_MOVED=false')
  }
  const onDisk = new Set<string>()

  for (const platPkgPath of platformPkgPaths) {
    const platPkg = readPkg(platPkgPath)
    onDisk.add(platPkg.name)

    if (!(platPkg.name in optDeps)) {
      problems.push(
        `${hostPkg.name} optionalDependencies is missing ${platPkg.name} — ` +
          'platform dir and host pins are out of sync; fix the host package.json.',
      )
      continue
    }

    if (CHECK) {
      if (platPkg.version !== version) {
        problems.push(
          `${platPkg.name} is at ${platPkg.version}, expected ${version} (its host's version)`,
        )
      }
      if (optDeps[platPkg.name] !== version) {
        problems.push(
          `${hostPkg.name} pins ${platPkg.name}@${optDeps[platPkg.name]}, expected ${version}`,
        )
      }
      if (host === 'css-engine' && platPkg.aihuNativeSource !== nativeSource) {
        problems.push(
          `${platPkg.name} has aihuNativeSource ${String(platPkg.aihuNativeSource)}, expected ${nativeSource}`,
        )
      }
    } else {
      platPkg.version = version
      if (host === 'css-engine' && (BUMP_CSS_ENGINE || setCssEngineVersion)) {
        platPkg.aihuNativeSource = nativeSource
      }
      writePkg(platPkgPath, platPkg)
      optDeps[platPkg.name] = version
      console.log(`  ${platPkg.name} → ${version}`)
    }
  }

  // Reverse assertion — a pin naming a platform package with no directory.
  //
  // New in this script, and it closes a real hole: the loop above only walks
  // dirs, so a typo'd or stale pin (a renamed platform, a dropped target) was
  // invisible to every check while still being published as an unresolvable
  // optionalDependency. Safe to treat as an error because all three hosts have
  // exactly platform pins and no third-party optional deps — verified: 10/10,
  // 4/4, 4/4 pins-to-dirs with zero on either side unmatched.
  for (const pinned of Object.keys(optDeps)) {
    if (!onDisk.has(pinned)) {
      problems.push(
        `${hostPkg.name} pins ${pinned}, but no platform directory produces that package ` +
          `(looked in ${npmDirs.map((d) => `packages/${host}/${d}/`).join(', ')})`,
      )
    }
  }

  if (!CHECK) {
    hostPkg.optionalDependencies = optDeps
    writePkg(hostPkgPath, hostPkg)
    console.log(`✔ ${hostPkg.name}@${version}: ${platformPkgPaths.length} platform pins stamped`)
  } else {
    console.log(`  ${hostPkg.name}@${version}: ${platformPkgPaths.length} platform package(s)`)
  }
}

if (problems.length > 0) {
  console.error(`\n✗ platform version ${label} failed:`)
  for (const p of problems) console.error(`  - ${p}`)
  if (CHECK) {
    console.error(
      '\nPlatform versions are generated, not hand-maintained. Run:\n' +
        '  bun scripts/stamp-platform-versions.ts\n',
    )
  }
  process.exit(1)
}

if (CHECK) {
  console.log(`✔ platform versions in sync (${selected.map((h) => h.host).join(', ')})`)
}
