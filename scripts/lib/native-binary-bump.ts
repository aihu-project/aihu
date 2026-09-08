/**
 * scripts/lib/native-binary-bump.ts
 *
 * Shared core for the "native binary bump" CI guards: a change to a package's
 * Rust source MUST bump the platform binary packages, or the fix never ships.
 *
 * This shared rule set applies to every native-binary package in the monorepo:
 * lockstep bumps across every platform of every affected family, plus the host
 * manifest's optionalDependencies pins repointed. It was hardened after a
 * partial bump of one family passed the old, looser check.
 *
 * A package with native binaries defines a `BumpCheckerConfig` (its platform
 * families, host manifest path, and source-file predicates) and gets a fully
 * tested checker via `createBumpChecker(config)`. One family (e.g.
 * @aihu/css-engine, @aihu/server) is just the one-family case of the same
 * general rule.
 */
import { existsSync, readdirSync } from 'node:fs'

export type FamilyKey = string

export interface FamilyConfig {
  /** Directory (repo-root-relative) holding one subdir per platform. */
  dir: string
  /** Human-readable label used in failure messages. */
  label: string
}

export interface BumpCheckerConfig<F extends FamilyKey> {
  /** The manifest carrying the optionalDependencies pins for every family. */
  hostManifest: string
  /** One entry per platform-binary family this package ships. */
  families: Record<F, FamilyConfig>
  /**
   * True when `file` is Rust (or other) source that feeds EVERY family —
   * a change here requires ALL families to bump.
   */
  isSharedSource: (file: string) => boolean
  /**
   * Per-family predicates for source that feeds ONLY that specific family
   * (e.g. a napi addon wrapper crate that isn't compiled into the CLI
   * binary). Omit a family here if it has no family-only source category —
   * every one of its changes is necessarily shared source.
   */
  isFamilyOnlySource?: Partial<Record<F, (file: string) => boolean>>
}

export type PlatformMap<F extends FamilyKey> = Record<F, string[]>

export interface BumpCheckResult<F extends FamilyKey> {
  ok: boolean
  /** Shared source files that changed (drive every family). */
  sharedChanged: string[]
  /** Family-only source files that changed, per family. */
  familyOnlyChanged: Partial<Record<F, string[]>>
  /** Families this change is required to bump. */
  requiredFamilies: F[]
  /** Exact manifest paths that must have changed but did not. */
  missing: string[]
  message: string
}

export interface BumpChecker<F extends FamilyKey> {
  isSharedSource: (file: string) => boolean
  isFamilyOnlySource: (family: F, file: string) => boolean
  platformManifestFamily: (file: string) => F | null
  isPlatformManifest: (file: string) => boolean
  discoverPlatforms: (root?: string) => PlatformMap<F>
  /** Pure check over a list of changed paths — no git, so unit-testable. */
  checkBump: (changedFiles: string[], expected?: PlatformMap<F>) => BumpCheckResult<F>
}

/** Build a fully-configured, testable bump checker for one native package. */
export function createBumpChecker<F extends FamilyKey>(
  config: BumpCheckerConfig<F>,
  root: string,
): BumpChecker<F> {
  const familyKeys = Object.keys(config.families) as F[]
  let cachedPlatforms: PlatformMap<F> | undefined

  function discoverPlatforms(discoverRoot: string = root): PlatformMap<F> {
    const read = (dir: string): string[] => {
      const abs = `${discoverRoot}/${dir}`
      if (!existsSync(abs)) return []
      return readdirSync(abs, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(`${abs}/${e.name}/package.json`))
        .map((e) => e.name)
        .sort()
    }
    const out = {} as PlatformMap<F>
    for (const family of familyKeys) out[family] = read(config.families[family].dir)
    return out
  }

  function platforms(): PlatformMap<F> {
    cachedPlatforms ??= discoverPlatforms()
    return cachedPlatforms
  }

  function isFamilyOnlySource(family: F, file: string): boolean {
    return config.isFamilyOnlySource?.[family]?.(file) ?? false
  }

  function platformManifestFamily(file: string): F | null {
    const parts = file.split('/')
    if (parts[parts.length - 1] !== 'package.json') return null
    for (const family of familyKeys) {
      const dirParts = config.families[family].dir.split('/')
      // Exactly <dir>/<platform>/package.json — nothing nested deeper.
      if (parts.length === dirParts.length + 2 && dirParts.every((p, i) => parts[i] === p)) {
        return family
      }
    }
    return null
  }

  function isPlatformManifest(file: string): boolean {
    return platformManifestFamily(file) !== null
  }

  function checkBump(
    changedFiles: string[],
    expected: PlatformMap<F> = platforms(),
  ): BumpCheckResult<F> {
    const changed = new Set(changedFiles)
    const sharedChanged = changedFiles.filter(config.isSharedSource)
    const familyOnlyChanged = {} as Partial<Record<F, string[]>>
    for (const family of familyKeys) {
      const files = changedFiles.filter((f) => isFamilyOnlySource(family, f))
      if (files.length > 0) familyOnlyChanged[family] = files
    }

    const touched = {} as Record<F, string[]>
    for (const family of familyKeys) touched[family] = []
    for (const file of changedFiles) {
      const family = platformManifestFamily(file)
      if (family) touched[family].push(file)
    }

    const reasons = {} as Record<F, string[]>
    for (const family of familyKeys) reasons[family] = []
    if (sharedChanged.length > 0) {
      const why = `shared source changed (${sharedChanged.length} file${
        sharedChanged.length === 1 ? '' : 's'
      }) — compiled into every platform family this package ships`
      for (const family of familyKeys) reasons[family].push(why)
    }
    for (const family of familyKeys) {
      const files = familyOnlyChanged[family]
      if (files && files.length > 0) {
        reasons[family].push(`family-only source changed (${files.join(', ')})`)
      }
    }
    for (const family of familyKeys) {
      if (touched[family].length > 0 && touched[family].length < expected[family].length) {
        reasons[family].push(
          `a partial bump of this family is already in the diff (${touched[family].length} of ${expected[family].length} manifests) — platform versions must move in lockstep`,
        )
      }
    }

    const requiredFamilies = familyKeys.filter((f) => reasons[f].length > 0)

    const missing: string[] = []
    for (const family of requiredFamilies) {
      for (const platform of expected[family]) {
        const manifest = `${config.families[family].dir}/${platform}/package.json`
        if (!changed.has(manifest)) missing.push(manifest)
      }
    }
    if (requiredFamilies.length > 0 && !changed.has(config.hostManifest)) {
      missing.push(config.hostManifest)
    }

    if (missing.length === 0) {
      return {
        ok: true,
        sharedChanged,
        familyOnlyChanged,
        requiredFamilies,
        missing,
        message: 'ok',
      }
    }

    const lines: string[] = ['Native binary bump incomplete.', '']
    if (sharedChanged.length > 0) {
      lines.push('Shared source changed:')
      lines.push(...sharedChanged.map((f) => `  - ${f}`))
      lines.push('')
    }
    for (const family of familyKeys) {
      const files = familyOnlyChanged[family]
      if (files && files.length > 0) {
        lines.push(`${config.families[family].label} family-only source changed:`)
        lines.push(...files.map((f) => `  - ${f}`))
        lines.push('')
      }
    }
    for (const family of requiredFamilies) {
      lines.push(`${config.families[family].label} must bump, because:`)
      lines.push(...reasons[family].map((r) => `  - ${r}`))
    }
    lines.push('')
    lines.push('Missing (not changed in this PR):')
    lines.push(...missing.map((f) => `  - ${f}`))
    lines.push('')
    lines.push(
      'release.yml skips any platform version already on npm. Any manifest left',
      'unbumped is silently not published and consumers keep loading the stale',
      'artifact — see this helper for the FEL-414 history',
      'this rule was hardened against.',
      '',
      'Fix: bump every manifest listed above (all platforms of every required',
      `family, in lockstep) and repoint ${config.hostManifest}'s optionalDependencies`,
      'pins at the new versions.',
    )
    return {
      ok: false,
      sharedChanged,
      familyOnlyChanged,
      requiredFamilies,
      missing,
      message: lines.join('\n'),
    }
  }

  return {
    isSharedSource: config.isSharedSource,
    isFamilyOnlySource,
    platformManifestFamily,
    isPlatformManifest,
    discoverPlatforms,
    checkBump,
  }
}
