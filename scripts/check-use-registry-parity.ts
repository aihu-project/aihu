#!/usr/bin/env bun
/**
 * CI guard — `@aihu/use` registry parity (src <-> registry, bidirectional),
 * NOW FAMILY-AWARE (namespace-wave0: CORE stays dependency-free; FAMILY
 * subpaths — `math`, `motion`, `router`, `integrations` — may declare
 * optional peers, `packages/use/families.json` is the single source of
 * truth for which families exist).
 *
 * A CORE composable directory `packages/use/src/<name>/index.ts` and a
 * FAMILY member directory `packages/use/src/<family>/<name>/index.ts` must
 * all agree, in BOTH directions, across SIX companion registrations:
 *   1. barrel export in packages/use/src/index.ts (CORE names only — a
 *      family name found here is a FAIL, not a pass: the core barrel is
 *      family-free by the one-way import rule)
 *   2. `./<name>` (or `./<family>/<name>`) key in packages/use/package.json
 *      `exports`
 *   3. `<name>: 'src/<name>/index.ts'` (or the quoted `'<family>/<name>'`
 *      form) in packages/use/rolldown.config.ts `input`
 *   4. a `@aihu/use/<name>` (or `@aihu/use/<family>/<name>`) row in root
 *      .size-limit.json
 *   5. a hand-written Tier-2 row in packages/use/tests/ssr-safety.test.ts —
 *      REQUIRED iff the composable's source references `isClient`
 *      (otherwise optional; nothing to assert either way).
 *
 * Plus family-level (not per-composable) invariants:
 *   - a family with `aggregate: true` and >=1 discovered member must carry
 *     an aggregate barrel (`src/<family>/index.ts`), a bare `./<family>`
 *     exports key, a bare `<family>` rolldown input, and a
 *     `@aihu/use/<family>` size row.
 *   - a family with `aggregate: false` (or zero discovered members) must
 *     carry NONE of the four above — this is what keeps a bare
 *     `@aihu/use/integrations` from silently reappearing (aggregate entries
 *     are a hard `vite build` resolution break for any family whose members
 *     carry different optional peers — verified).
 *   - every family directory found on disk must be declared in
 *     `families.json` (no orphan family dirs). The converse — "every
 *     declared family has >=1 member" — is DELIBERATELY NOT enforced: this
 *     namespace's four families are pre-declared, founder-ratified
 *     architecture ahead of their first composable landing, and a hard
 *     "must have a member" gate would block landing that declaration at all.
 *
 * "Bidirectional" means: a composable dir missing ANY of its required
 * manifest entries is an error, AND a manifest entry with no backing src/
 * directory (a ghost row — e.g. a leftover after a rename, or a copy/paste
 * typo) is ALSO an error. Every name is checked against every source it is
 * expected to appear in.
 *
 * `shared` is the one documented non-composable subpath and is excluded from
 * all source discovery. Family AGGREGATE names (`math`, `motion`, `router`)
 * are tracked separately from composable/member names — they are not
 * "composables" for the six-touch-point rule, they get their own four-part
 * check above.
 *
 * Run: bun run check:use-registry-parity
 *
 * Wired into `check:ci` (right after `check:size-rows`, same family of
 * manifest cross-checks) and as its own early step in
 * `.github/workflows/plan-a.yml` (right after `check:compiler-binary-bump`
 * — both are cheap, no-build-required guards over the same
 * Rust-source-adjacent surface).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------- families.json ----------

export interface FamilyDef {
  aggregate: boolean
  autoImport: boolean
  memberLimit: string
  aggregateLimit?: string
  peers: Record<string, string[]>
}

export interface FamiliesFile {
  families: Record<string, FamilyDef>
}

export function loadFamilies(familiesJsonSrc: string): Record<string, FamilyDef> {
  return (JSON.parse(familiesJsonSrc) as FamiliesFile).families ?? {}
}

// ---------- Opt-out allowlist ----------

/**
 * Names deliberately excluded from the USE_COMPOSABLES registry check —
 * e.g. a bare, non-`use`-prefixed name judged too collision-risky for
 * auto-import. Every entry MUST carry a one-line justification comment.
 * This is for CORE one-offs; a FAMILY composable's registry requirement is
 * derived from its family's `autoImport` flag (see `registryRequirement`),
 * never hand-listed here.
 */
export const REGISTRY_EXEMPT = new Set<string>()

// ---------- Per-source discovery / parsing ----------

/**
 * Composable directory names under `packages/use/src/`: CORE names bare
 * (`useCounter`), family members slash-qualified (`math/useClamp`). Excludes
 * `shared` and every family's own aggregate barrel (`src/<family>/index.ts`
 * is a FILE, not a directory, so it is never picked up here).
 */
export function discoverComposableDirs(
  useSrcDir: string,
  families: Record<string, FamilyDef>,
): Set<string> {
  const names = new Set<string>()
  for (const entry of readdirSync(useSrcDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name === 'shared') continue
    if (families[entry.name]) {
      // Family directory: one level inside is the member composables.
      const familyDir = join(useSrcDir, entry.name)
      for (const member of readdirSync(familyDir, { withFileTypes: true })) {
        if (!member.isDirectory()) continue
        if (existsSync(join(familyDir, member.name, 'index.ts'))) {
          names.add(`${entry.name}/${member.name}`)
        }
      }
      continue
    }
    if (existsSync(join(useSrcDir, entry.name, 'index.ts'))) {
      names.add(entry.name)
    }
  }
  return names
}

/** Top-level directory names under `src/` (excl. `shared`) that are NOT
 * declared in `families.json` and are also NOT a CORE composable dir
 * themselves (no `index.ts` directly inside) — i.e. an orphan family dir. */
export function discoverOrphanFamilyDirs(
  useSrcDir: string,
  families: Record<string, FamilyDef>,
): string[] {
  const orphans: string[] = []
  for (const entry of readdirSync(useSrcDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'shared') continue
    if (families[entry.name]) continue
    if (existsSync(join(useSrcDir, entry.name, 'index.ts'))) continue
    orphans.push(entry.name)
  }
  return orphans
}

/** Composable names re-exported from the barrel (`packages/use/src/index.ts`).
 * Widened to catch a nested `./<family>/<name>/index.ts` re-export too — the
 * core barrel must never carry ANY family name (aggregate or member); a
 * match here is reported as a distinct violation by the caller, not silently
 * treated as a legitimate composable name. */
export function parseBarrelExports(barrelSrc: string): Set<string> {
  const names = new Set<string>()
  const re = /from '\.\/([\w/]+)\/index\.ts'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(barrelSrc)) !== null) {
    if (m[1] !== 'shared') names.add(m[1])
  }
  return names
}

/** Composable subpath names in `packages/use/package.json`'s `exports` map
 * (family aggregate keys, e.g. `math`, included — the caller separates
 * aggregate names from member names using `families`). */
export function parsePackageJsonExports(pkg: { exports?: Record<string, unknown> }): Set<string> {
  const names = new Set<string>()
  for (const key of Object.keys(pkg.exports ?? {})) {
    // Published metadata artifacts are package exports, but they are not
    // composable entry points and therefore do not take part in the
    // src/barrel/rolldown/size parity matrix.
    if (key === '.' || key === './shared' || key === './composable-registry.json') continue
    if (key.startsWith('./')) names.add(key.slice(2))
  }
  return names
}

/**
 * Composable entry names in `packages/use/rolldown.config.ts`'s `input`
 * block -> their src path. Widened to accept quoted `'family/name'` keys
 * (the plain `\w+` form cannot match a slash) — the previous version was
 * `/^\s*(\w+):\s*'src\/\w+\/index\.ts',?\s*$/gm`, which silently failed to
 * match ANY family entry.
 */
export function parseRolldownInputs(rolldownSrc: string): Map<string, string> {
  const entries = new Map<string, string>()
  const blockMatch = rolldownSrc.match(/input:\s*\{([\s\S]*?)\n\s*\}/)
  const block = blockMatch ? blockMatch[1] : rolldownSrc
  const re = /^\s*'?([\w/]+)'?:\s*'(src\/[\w/]+\/index\.ts)',?\s*$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(block)) !== null) {
    const key = m[1]
    if (key === 'index' || key === 'shared') continue
    entries.set(key, m[2])
  }
  return entries
}

/** Composable names carrying a `@aihu/use/<name>` row in `.size-limit.json`
 * (family aggregate rows, e.g. `@aihu/use/math`, included). */
export function parseSizeLimitRows(rows: Array<{ name: string }>): Set<string> {
  const names = new Set<string>()
  const prefix = '@aihu/use/'
  for (const row of rows) {
    if (!row.name.startsWith(prefix)) continue
    const rest = row.name.slice(prefix.length)
    if (rest === 'shared') continue
    names.add(rest)
  }
  return names
}

/**
 * Strip `//` line comments and `/* ... *\/` block comments from Rust source
 * before parsing. Without this, a temporarily-disabled, commented-out tuple
 * (`// ("useFoo", "@aihu/use/useFoo"),`) still matches the tuple regex below
 * and is counted as a registered entry — exactly the gap this gate exists to
 * close. Naive (doesn't special-case `//`/`/*` appearing inside a string
 * literal) — acceptable here since USE_COMPOSABLES tuples never contain
 * comment-marker substrings in their string values.
 */
export function stripRustComments(rsSrc: string): string {
  return rsSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/**
 * Composable names carrying a tuple in `use_registry.rs`'s USE_COMPOSABLES —
 * keyed by the SUBPATH (group 2, e.g. `math/useClamp`), widened from `\w+`
 * to `[\w/]+` so a family's nested specifier matches at all.
 */
export function parseUseRegistryRs(rsSrc: string): Set<string> {
  const names = new Set<string>()
  const src = stripRustComments(rsSrc)
  const re = /\(\s*"([\w/]+)"\s*,\s*"@aihu\/use\/([\w/]+)"\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    // Group 2 (the subpath) is the stable identifier shared with package.json
    // exports / .size-limit.json / rolldown input names — it's the
    // cross-source join key. Group 1 (the bare call name) is identical to
    // group 2's LAST segment for every entry landed so far; a family entry
    // whose call name diverges from its subpath's last segment is a
    // copy/paste typo (`("useClamp", "@aihu/use/math/useSum")`), flagged
    // separately by `checkRegistryTupleNames` below — this parser stays
    // permissive so a typo still shows up as an ordinary parity gap too.
    names.add(m[2])
  }
  return names
}

/**
 * A registry tuple's bare call name (group 1) MUST equal its subpath's
 * (group 2) last segment — catches `("useClamp", "@aihu/use/math/useSum")`
 * typos that `parseUseRegistryRs` alone would silently accept (it only keys
 * off group 2). Returns one message per mismatch.
 */
export function checkRegistryTupleNames(rsSrc: string): string[] {
  const errors: string[] = []
  const src = stripRustComments(rsSrc)
  const re = /\(\s*"([\w/]+)"\s*,\s*"@aihu\/use\/([\w/]+)"\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    const callName = m[1]
    const subpath = m[2]
    const lastSegment = subpath.split('/').at(-1)
    if (callName !== lastSegment) {
      errors.push(
        `USE_COMPOSABLES tuple ("${callName}", "@aihu/use/${subpath}") — bare call name ` +
          `'${callName}' does not match the subpath's last segment '${lastSegment}'.`,
      )
    }
  }
  return errors
}

/**
 * Tier-2 (call-time) entry names in `packages/use/tests/ssr-safety.test.ts`'s
 * hand-maintained `entries` array — slash-qualified for family members
 * (`entry: 'math/useClamp'`).
 */
export function parseSsrSafetyEntries(testSrc: string): Set<string> {
  const names = new Set<string>()
  const re = /entry:\s*'([\w/]+)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(testSrc)) !== null) names.add(m[1])
  return names
}

/** True when a composable's own source file references `isClient` — the
 * mechanical proxy for "this composable does SSR-sensitive work and needs a
 * Tier-2 ssr-safety.test.ts row", per the 7th touch point rule. */
export function referencesIsClient(composableSrc: string): boolean {
  return /\bisClient\b/.test(composableSrc)
}

// ---------- Registry requirement (derived from families.json) ----------

/** Whether `name` (bare CORE name or `family/member`) is expected to carry a
 * USE_COMPOSABLES tuple. CORE composables always require one (existing
 * behavior, `REGISTRY_EXEMPT` opt-out preserved); a family member's
 * requirement is derived from its family's `autoImport` flag — never
 * hand-listed per composable. */
export function registryRequired(name: string, families: Record<string, FamilyDef>): boolean {
  if (REGISTRY_EXEMPT.has(name)) return false
  if (!name.includes('/')) return true // CORE
  const family = name.slice(0, name.indexOf('/'))
  return families[family]?.autoImport === true
}

// ---------- Parity check ----------

export interface ParitySources {
  dirs: Set<string>
  barrel: Set<string>
  pkgExports: Set<string>
  rolldownInputs: Set<string>
  sizeRows: Set<string>
  /** Published compiler auto-import registry is checked in aihu-compiler.
   * The root check intentionally validates only root-owned use artifacts. */
  registry?: Set<string>
  /** Tier-2 ssr-safety.test.ts entry names. Optional so pre-existing
   * 6-source fixtures (no SSR touch point) keep passing unmodified. */
  ssrRows?: Set<string>
}

export interface ParityOptions {
  families?: Record<string, FamilyDef>
  /** Names whose source references `isClient` (SSR row required). */
  ssrRequired?: Set<string>
}

export interface ParityResult {
  ok: boolean
  errors: string[]
}

const SOURCE_LABELS: Record<Exclude<keyof ParitySources, 'dirs' | 'ssrRows'>, string> = {
  barrel: 'barrel export (packages/use/src/index.ts)',
  pkgExports: 'package.json exports key (packages/use/package.json)',
  rolldownInputs: 'rolldown input (packages/use/rolldown.config.ts)',
  sizeRows: '.size-limit.json row',
}

/**
 * Pure check — takes the discovered/parsed name sets (+ family metadata),
 * returns the bidirectional diff. A name missing from ANY source it's
 * expected in is an error naming every source it's missing from (a
 * composable-dir-only name is missing from all manifests; a manifest-only
 * "ghost" name is missing from `dirs` plus whichever other manifests never
 * got it either). A name found in the barrel that names a family (aggregate
 * or member) is ALSO an error — the core barrel is family-free by
 * construction.
 */
export function checkParity(sources: ParitySources, options: ParityOptions = {}): ParityResult {
  const families = options.families ?? {}
  const errors: string[] = []
  const allNames = new Set<string>([
    ...sources.dirs,
    ...sources.barrel,
    ...sources.pkgExports,
    ...sources.rolldownInputs,
    ...sources.sizeRows,
    ...(sources.registry ?? []),
    ...(sources.ssrRows ?? []),
  ])

  for (const name of [...allNames].sort()) {
    const isFamilyName = name.includes('/')
    const missing: string[] = []
    if (!sources.dirs.has(name)) missing.push('packages/use/src/<name>/index.ts directory')

    // The core barrel is family-free: a family name (aggregate or member)
    // showing up there is a distinct FAIL, never satisfies the barrel
    // touch-point requirement (which only applies to CORE names).
    if (isFamilyName) {
      if (sources.barrel.has(name)) {
        errors.push(
          `'${name}' is exported from packages/use/src/index.ts (the CORE barrel) — a family ` +
            `name may NEVER appear there (one-way rule: family may import core, core may never ` +
            `import family). Remove it; family barrels live at src/<family>/index.ts.`,
        )
      }
    } else if (!sources.barrel.has(name)) {
      missing.push(SOURCE_LABELS.barrel)
    }

    if (!sources.pkgExports.has(name)) missing.push(SOURCE_LABELS.pkgExports)
    if (!sources.rolldownInputs.has(name)) missing.push(SOURCE_LABELS.rolldownInputs)
    if (!sources.sizeRows.has(name)) missing.push(SOURCE_LABELS.sizeRows)

    if (sources.registry) {
      if (registryRequired(name, families) && !sources.registry.has(name)) {
        missing.push('standalone compiler auto-import registry (USE_COMPOSABLES contract)')
      } else if (!registryRequired(name, families) && sources.registry.has(name)) {
        errors.push(
          `'${name}' has an auto-import registry entry but its family has autoImport: false — ` +
            'remove the entry in the standalone compiler registry.',
        )
      }
    }

    if (options.ssrRequired?.has(name) && sources.ssrRows) {
      if (!sources.ssrRows.has(name)) {
        missing.push(
          'Tier-2 row in packages/use/tests/ssr-safety.test.ts (source references `isClient`)',
        )
      }
    }

    if (missing.length > 0) {
      errors.push(`'${name}' is missing from: ${missing.join(', ')}`)
    }
  }

  return { ok: errors.length === 0, errors }
}

// ---------- Family aggregate invariants ----------

export interface FamilyAggregateSources {
  /** Family aggregate barrel file exists (`src/<family>/index.ts`). */
  barrelExists: Set<string>
  pkgExportsAggregates: Set<string>
  rolldownAggregates: Set<string>
  sizeRowAggregates: Set<string>
}

/**
 * A family with `aggregate: true` and >=1 discovered member MUST carry all
 * four aggregate touch points; a family with `aggregate: false`, OR zero
 * discovered members, MUST carry NONE of them. This is the assertion that
 * keeps a bare `@aihu/use/integrations` (or a premature `@aihu/use/math`
 * before any math composable lands) from silently reappearing — an
 * aggregate entry for a multi-peer family is a hard `vite build` resolution
 * break for a consumer who only imports one member (verified against
 * rolldown 1.0.3 + vite 8.0.16).
 */
export function checkFamilyAggregates(
  families: Record<string, FamilyDef>,
  memberCounts: Record<string, number>,
  found: FamilyAggregateSources,
): string[] {
  const errors: string[] = []
  for (const [family, def] of Object.entries(families)) {
    const memberCount = memberCounts[family] ?? 0
    const shouldHaveAggregate = def.aggregate === true && memberCount > 0
    const parts: Array<{ key: keyof FamilyAggregateSources; label: string }> = [
      { key: 'barrelExists', label: `src/${family}/index.ts (aggregate barrel)` },
      { key: 'pkgExportsAggregates', label: `./${family} package.json exports key` },
      { key: 'rolldownAggregates', label: `${family} rolldown input` },
      { key: 'sizeRowAggregates', label: `@aihu/use/${family} size row` },
    ]
    for (const { key, label } of parts) {
      const has = found[key].has(family)
      if (shouldHaveAggregate && !has) {
        errors.push(
          `family '${family}' has aggregate: true and ${memberCount} member(s), but is missing ${label}.`,
        )
      } else if (!shouldHaveAggregate && has) {
        const why =
          def.aggregate === true
            ? 'has zero discovered members yet'
            : 'has aggregate: false (multiple unrelated optional peers — a bare aggregate entry is ' +
              'a hard vite-build resolution break for a consumer who imports only one member)'
        errors.push(`family '${family}' ${why}, but carries ${label} — remove it.`)
      }
    }
  }
  return errors
}

// ---------- CLI entrypoint ----------

function findRepoRoot(start: string): string {
  let dir = start
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, '.size-limit.json')) && existsSync(join(dir, 'packages'))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(
    `Could not locate repo root (no .size-limit.json + packages/ found above ${start})`,
  )
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url))
  const repoRoot = findRepoRoot(resolve(here))

  const useDir = join(repoRoot, 'packages/use')
  const useSrcDir = join(useDir, 'src')
  const familiesPath = join(useDir, 'families.json')
  const families: Record<string, FamilyDef> = existsSync(familiesPath)
    ? loadFamilies(readFileSync(familiesPath, 'utf8'))
    : {}

  const barrelSrc = readFileSync(join(useSrcDir, 'index.ts'), 'utf8')
  const pkg = JSON.parse(readFileSync(join(useDir, 'package.json'), 'utf8')) as {
    exports?: Record<string, unknown>
  }
  const rolldownSrc = readFileSync(join(useDir, 'rolldown.config.ts'), 'utf8')
  const sizeLimitRows = JSON.parse(
    readFileSync(join(repoRoot, '.size-limit.json'), 'utf8'),
  ) as Array<{ name: string }>
  const ssrSafetyPath = join(useDir, 'tests/ssr-safety.test.ts')
  const ssrSafetySrc = existsSync(ssrSafetyPath) ? readFileSync(ssrSafetyPath, 'utf8') : ''

  const dirs = discoverComposableDirs(useSrcDir, families)
  const rolldownInputMap = parseRolldownInputs(rolldownSrc)
  const rolldownInputs = new Set(rolldownInputMap.keys())
  const pkgExportsAll = parsePackageJsonExports(pkg)
  const sizeRowsAll = parseSizeLimitRows(sizeLimitRows)

  // Separate aggregate names (bare family names) from composable/member names
  // across every source that mixes them.
  const isAggregateName = (n: string): boolean => Boolean(families[n]) && !n.includes('/')
  const pkgExports = new Set([...pkgExportsAll].filter((n) => !isAggregateName(n)))
  const rolldownComposableInputs = new Set([...rolldownInputs].filter((n) => !isAggregateName(n)))
  const sizeRows = new Set([...sizeRowsAll].filter((n) => !isAggregateName(n)))

  const barrel = parseBarrelExports(barrelSrc)
  const ssrRows = parseSsrSafetyEntries(ssrSafetySrc)

  // "Does this composable's own source reference isClient?" — read each
  // discovered composable's src file directly.
  const ssrRequired = new Set<string>()
  for (const name of dirs) {
    const srcPath = join(useSrcDir, name, 'index.ts')
    if (existsSync(srcPath) && referencesIsClient(readFileSync(srcPath, 'utf8'))) {
      ssrRequired.add(name)
    }
  }

  const sources: ParitySources = {
    dirs,
    barrel,
    pkgExports,
    rolldownInputs: rolldownComposableInputs,
    sizeRows,
    ssrRows,
  }

  const result = checkParity(sources, { families, ssrRequired })

  const orphanFamilyDirs = discoverOrphanFamilyDirs(useSrcDir, families)
  const orphanErrors = orphanFamilyDirs.map(
    (d) =>
      `'src/${d}/' is a top-level directory with no index.ts of its own and is NOT declared in ` +
      `families.json — either it's a family that needs declaring there, or a stray directory.`,
  )

  const memberCounts: Record<string, number> = {}
  for (const name of dirs) {
    if (!name.includes('/')) continue
    const family = name.slice(0, name.indexOf('/'))
    memberCounts[family] = (memberCounts[family] ?? 0) + 1
  }
  const aggregateSources: FamilyAggregateSources = {
    barrelExists: new Set(
      Object.keys(families).filter((f) => existsSync(join(useSrcDir, f, 'index.ts'))),
    ),
    pkgExportsAggregates: new Set([...pkgExportsAll].filter(isAggregateName)),
    rolldownAggregates: new Set([...rolldownInputs].filter(isAggregateName)),
    sizeRowAggregates: new Set([...sizeRowsAll].filter(isAggregateName)),
  }
  const aggregateErrors = checkFamilyAggregates(families, memberCounts, aggregateSources)

  const allErrors = [...result.errors, ...orphanErrors, ...aggregateErrors]
  const totalNames = new Set([
    ...sources.dirs,
    ...sources.barrel,
    ...sources.pkgExports,
    ...sources.rolldownInputs,
    ...sources.sizeRows,
  ]).size

  console.log('\n  @aihu/use registry parity check (family-aware)')
  console.log(
    `  ${totalNames} composable name(s) discovered across five root-owned registrations ` +
      `(+ family aggregate invariants; compiler auto-import registration is checked in aihu-compiler).\n`,
  )

  for (const e of allErrors) {
    console.error(`  ERROR: ${e}`)
  }

  if (allErrors.length > 0) {
    console.error(
      `\n  Parity violation — a composable is missing one or more of its six touch points, or a ` +
        `family aggregate invariant was violated.\n` +
        `  See CLAUDE.md / docs/plans/2026-07-22-effect-scope-and-composables.md §5 for the ` +
        `six-touch-point rule, packages/use/families.json for family declarations, or run ` +
        `\`bun scripts/gen-use.ts <name> [--family <family>]\` to scaffold them.\n`,
    )
    process.exit(1)
  }

  console.log(`  OK — all ${totalNames} composable(s) are in parity across every source.\n`)
}

// Only run main() when this file is executed directly. The test fixture
// imports the named exports without triggering the CLI.
const isDirectRun =
  typeof process !== 'undefined' &&
  Boolean(process.argv[1]) &&
  resolve(process.argv[1] as string) === resolve(fileURLToPath(import.meta.url))

if (isDirectRun) {
  try {
    main()
  } catch (err) {
    console.error(`  FATAL: ${(err as Error).message}`)
    process.exit(2)
  }
}
