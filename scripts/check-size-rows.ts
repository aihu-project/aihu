#!/usr/bin/env bun
/**
 * CI lint — `.size-limit.json` row policy enforcement (v0.2.4).
 *
 * Walks each `packages/<pkg>/src/index.ts`, classifies the package, and verifies:
 *   - every browser-eligible package has a row in `.size-limit.json`
 *   - no server-side or build/dev-time-only package has a row
 *
 * See `.size-limit.README.md` for the policy and per-package classification.
 *
 * Exit codes:
 *   0  policy holds
 *   1  policy violation (missing row OR forbidden row)
 *   2  unexpected error (cannot read manifest, etc.)
 *
 * Run locally:
 *   bun run check:size-rows
 *
 * Wired into `.github/workflows/plan-a.yml` as a workflow_dispatch step.
 * Push triggers deferred to v1.0.1 per state-plan-a.md.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------- Classification policy (hardcoded allowlists) ----------

/**
 * Server-side packages — run on Node/Bun, budgeted by SSR-bytes-served and
 * dep-tree audit, not browser-bundle bytes.
 */
export const SERVER_SIDE = new Set<string>([
  '@aihu/server',
  '@aihu/agent-server',
  '@aihu-plugin/agent-readiness',
  '@aihu-plugin/drizzle',
  '@aihu/ai',
  '@aihu/mcp',
  '@aihu/seo',
])

/**
 * Build/dev-time-only packages — run in the build toolchain or dev tooling,
 * never reach a browser bundle.
 */
export const BUILD_DEV_ONLY = new Set<string>([
  '@aihu/plugin',
  '@aihu/cli',
  '@aihu/adapter-cloudflare',
  '@aihu/adapter-vercel',
  '@aihu/css-engine',
  // The compiler is published by aihu-compiler and runs only in the build
  // toolchain; this classification remains for package-policy tests even
  // though its source directory is outside this workspace.
  '@aihu/compiler',
  '@aihu/language-server',
  // `aihu-tsc` is a CLI type-checker: it runs at build/dev time and nothing from
  // it is ever bundled into a browser app, so the dep-free browser-bundle thesis
  // does not apply to it — same footing as @aihu/language-server, with which it
  // shares its Volar dependencies.
  '@aihu/tsc',
])

/**
 * Source-distributed packages — ship `.aihu`/source + an index, never a runtime
 * bundle. The consumer copies the source via `aihu add` and their OWN build
 * measures the copied recipes; nothing from THIS package is bundled into a
 * browser from the package, so it carries no `.size-limit.json` row (D-2).
 */
export const SOURCE_DISTRIBUTED = new Set<string>(['@aihu/ui'])

type Classification = 'browser-eligible' | 'server-side' | 'build-dev-only' | 'source-distributed'

interface PackageInfo {
  name: string
  dir: string
  hasIndexTs: boolean
  classification: Classification
  /**
   * `private: true` in package.json — never published, so it has no shipped
   * browser-size contract and is exempt from the row-policy entirely.
   */
  isPrivate?: boolean
}

interface SizeLimitEntry {
  name: string
  path: string
  limit: string
  gzip?: boolean
  ignore?: string[]
}

// ---------- Walk ----------

export function classify(name: string): Classification {
  if (SERVER_SIDE.has(name)) return 'server-side'
  if (BUILD_DEV_ONLY.has(name)) return 'build-dev-only'
  if (SOURCE_DISTRIBUTED.has(name)) return 'source-distributed'
  return 'browser-eligible'
}

export function discoverPackages(repoRoot: string): PackageInfo[] {
  const packagesDir = join(repoRoot, 'packages')
  if (!existsSync(packagesDir)) {
    throw new Error(`packages/ not found at ${packagesDir}`)
  }
  const result: PackageInfo[] = []
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const pkgDir = join(packagesDir, entry.name)
    const pkgJsonPath = join(pkgDir, 'package.json')
    if (!existsSync(pkgJsonPath)) continue
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
      name?: string
      private?: boolean
    }
    if (!pkg.name) continue
    const indexPath = join(pkgDir, 'src', 'index.ts')
    result.push({
      name: pkg.name,
      dir: pkgDir,
      hasIndexTs: existsSync(indexPath),
      classification: classify(pkg.name),
      isPrivate: pkg.private === true,
    })
  }
  return result
}

export function readSizeLimit(repoRoot: string): SizeLimitEntry[] {
  const path = join(repoRoot, '.size-limit.json')
  if (!existsSync(path)) {
    throw new Error(`.size-limit.json not found at ${path}`)
  }
  return JSON.parse(readFileSync(path, 'utf8')) as SizeLimitEntry[]
}

export interface CheckResult {
  ok: boolean
  errors: string[]
  warnings: string[]
  summary: string
}

/**
 * Pure check — takes the data, returns a result. The CLI wrapper at the bottom
 * loads files; the test fixture passes synthesized data directly.
 */
export function checkPolicy(packages: PackageInfo[], rows: SizeLimitEntry[]): CheckResult {
  const rowNames = new Set(rows.map((r) => r.name))
  const errors: string[] = []
  const warnings: string[] = []

  // A browser-eligible package is satisfied either by a row named exactly for
  // the package, OR by one-or-more sub-entry rows (`<pkg>/<entry>`). The latter
  // is how `@aihu/primitives` budgets PER-PRIMITIVE (one row per export entry,
  // each under its own limit) rather than one bundled row.
  const hasRowFor = (pkgName: string): boolean =>
    rowNames.has(pkgName) || rows.some((r) => r.name.startsWith(`${pkgName}/`))

  let browserEligibleChecked = 0
  let serverSideChecked = 0
  let buildDevOnlyChecked = 0
  let sourceDistributedChecked = 0
  let privateExemptChecked = 0

  for (const pkg of packages) {
    // `private: true` packages are never published — no shipped browser-size
    // contract — so they are exempt from the row-policy (neither required to
    // have a row nor forbidden from one). e.g. @aihu/plugin-demo (held-private
    // consumer-contract demo) carries a browser runtime export but ships to no
    // consumer.
    if (pkg.isPrivate) {
      privateExemptChecked++
      continue
    }

    if (!pkg.hasIndexTs && pkg.classification !== 'source-distributed') {
      // Packages without src/index.ts are out of scope when they do not ship a
      // browser bundle. Skip silently.
      // EXCEPTION: source-distributed packages (e.g. @aihu/ui) deliberately
      // have no src/index.ts (they ship .aihu source, not a bundle) but MUST
      // still be asserted row-free — fall through so the forbidden-row guard
      // applies regardless.
      continue
    }

    // Exact-name match drives the server-side / build-dev-only forbidden-row
    // checks (preserving the original semantics — e.g. @aihu/css-engine is
    // build-dev-only and its `runtime/*` sub-rows must NOT make it look like it
    // owns a forbidden top-level row).
    const hasExactRow = rowNames.has(pkg.name)

    switch (pkg.classification) {
      case 'browser-eligible':
        browserEligibleChecked++
        // Browser-eligible packages may satisfy the row requirement with
        // PER-ENTRY sub-rows (`<pkg>/<entry>`) — how @aihu/primitives budgets.
        if (!hasRowFor(pkg.name)) {
          errors.push(
            `${pkg.name}: browser-eligible package has src/index.ts but no row in .size-limit.json. ` +
              `Add a row, or classify as server-side / build-dev-only in scripts/check-size-rows.ts.`,
          )
        }
        break
      case 'server-side':
        serverSideChecked++
        if (hasExactRow) {
          errors.push(
            `${pkg.name}: server-side package MUST NOT have a row in .size-limit.json. ` +
              `Server-side packages are budgeted by SSR-bytes-served, not browser bytes. ` +
              `Remove the row or reclassify in scripts/check-size-rows.ts.`,
          )
        }
        break
      case 'build-dev-only':
        buildDevOnlyChecked++
        if (hasExactRow) {
          errors.push(
            `${pkg.name}: build/dev-time-only package MUST NOT have a row in .size-limit.json. ` +
              `These packages never reach a browser bundle. ` +
              `Remove the row or reclassify in scripts/check-size-rows.ts.`,
          )
        }
        break
      case 'source-distributed':
        sourceDistributedChecked++
        if (hasExactRow) {
          errors.push(
            `${pkg.name}: source-distributed package MUST NOT have a row in .size-limit.json. ` +
              `Its payload is copied via \`aihu add\`; the consumer's OWN build measures the ` +
              `copied recipes, not this package. Remove the row or reclassify in ` +
              `scripts/check-size-rows.ts.`,
          )
        }
        break
    }
  }

  // Warn about size-limit rows referencing packages we didn't see (typos,
  // deleted packages, etc.). Not fatal — could be intentional during a
  // rename — but worth surfacing.
  const knownNames = new Set(packages.map((p) => p.name))
  const matchesKnownPackage = (rowName: string): boolean =>
    knownNames.has(rowName) || [...knownNames].some((n) => rowName.startsWith(`${n}/`))
  for (const row of rows) {
    if (!matchesKnownPackage(row.name)) {
      warnings.push(
        `${row.name}: row in .size-limit.json but no matching package found under packages/`,
      )
    }
  }

  const summary =
    `Checked ${browserEligibleChecked + serverSideChecked + buildDevOnlyChecked + sourceDistributedChecked} packages in scope: ` +
    `${browserEligibleChecked} browser-eligible, ` +
    `${serverSideChecked} server-side, ` +
    `${buildDevOnlyChecked} build-dev-only, ` +
    `${sourceDistributedChecked} source-distributed` +
    (privateExemptChecked > 0 ? ` (+${privateExemptChecked} private, exempt)` : '') +
    `. ${rows.length} rows in .size-limit.json.`

  return { ok: errors.length === 0, errors, warnings, summary }
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

  const packages = discoverPackages(repoRoot)
  const rows = readSizeLimit(repoRoot)
  const result = checkPolicy(packages, rows)

  console.log(`\n  .size-limit.json row-policy lint`)
  console.log(`  ${result.summary}\n`)

  for (const w of result.warnings) {
    console.warn(`  WARN: ${w}`)
  }
  for (const e of result.errors) {
    console.error(`  ERROR: ${e}`)
  }

  if (!result.ok) {
    console.error(
      `\n  Policy violation. See .size-limit.README.md for the classification reference.\n`,
    )
    process.exit(1)
  }

  console.log(`  OK — policy holds.\n`)
}

// Only run main() when this file is executed directly. The test fixture
// imports the named exports without triggering the CLI.
const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (isDirectRun) {
  try {
    main()
  } catch (err) {
    console.error(`  FATAL: ${(err as Error).message}`)
    process.exit(2)
  }
}
