/**
 * Shared utilities for the Slice-0 thesis invariants.
 *
 * Extracted so the checks cannot drift from one another — a duplicated
 * allowlist or a second copy of the stale-artifact fix would itself be a
 * `check:derived` violation. See
 * `docs/plans/slice-0-invariants/architecture-spec.md` §"Shared utilities".
 *
 * The exit contract here is deliberately two-sided. A check that exits 0 on
 * "zero findings" ratchets in one direction only: it can never prove it ever
 * failed. These checks exit 0 iff `findings === expected`, where `expected`
 * is a committed baseline in `docs/plans/slice-0-invariants/baselines.json`.
 * A count that DROPS is red too, which forces the baseline decrement into the
 * same PR as the fix and makes a silent regression impossible in either
 * direction.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const ROOT = join(import.meta.dir, '..', '..')

// ─── Stale-artifact resolution ───────────────────────────────────────────────

/**
 * Resolve a build artifact from a candidate list, preferring the NEWEST build.
 *
 * Deliberately not a fixed precedence (bin → release → debug): that order
 * silently picks a stale `target/release` over a fresh `target/debug`, which
 * once made `check-emit-parses.ts` report 24 phantom failures against
 * already-fixed bugs. A checker that reads a stale artifact is worse than no
 * checker.
 *
 * Extracted verbatim (behavior-preserving) from `check-emit-parses.ts`'s
 * `resolveCompiler`, which now calls this. The one place the fix lives.
 *
 * @returns the newest existing candidate, or `null` when none exist. Callers
 *   own the error message, since it names the build command to run.
 */
export function resolveNewest(candidates: readonly string[]): string | null {
  const present = candidates.filter((c) => existsSync(c))
  if (present.length === 0) return null
  return present.reduce((newest, c) =>
    statSync(c).mtimeMs > statSync(newest).mtimeMs ? c : newest,
  )
}

// ─── Findings + the exit contract ────────────────────────────────────────────

export interface Finding {
  /** `path:line`, repo-relative. Omit line only when genuinely file-scoped. */
  readonly where: string
  /** Stable rule id, e.g. `D1`, `G2`, `AT`, `DA-a`. */
  readonly rule: string
  readonly message: string
}

/** Read a committed baseline count by check name. */
export function baseline(name: string): number {
  const path = join(ROOT, 'docs/plans/slice-0-invariants/baselines.json')
  if (!existsSync(path)) {
    console.error(`invariant — baselines.json not found at ${path}`)
    process.exit(1)
  }
  const doc = JSON.parse(readFileSync(path, 'utf8')) as {
    checks?: Record<string, { expect?: unknown }>
  }
  const entry = doc.checks?.[name]
  if (!entry || typeof entry.expect !== 'number') {
    console.error(`invariant — baselines.json has no numeric \`expect\` for "${name}"`)
    process.exit(1)
  }
  return entry.expect
}

/**
 * Resolve the expected count: `--expect <N>` wins, else the committed baseline.
 */
export function expectedFrom(argv: readonly string[], name: string): number {
  const i = argv.indexOf('--expect')
  if (i !== -1) {
    const n = Number(argv[i + 1])
    if (!Number.isInteger(n) || n < 0) {
      console.error(`invariant — --expect requires a non-negative integer, got "${argv[i + 1]}"`)
      process.exit(1)
    }
    return n
  }
  return baseline(name)
}

/**
 * The exit contract. Prints every finding, then the count, then exits 0 iff
 * `findings.length === expected`.
 *
 * The mismatch message carries DIRECTION on purpose. A builder who sees only
 * "FAIL" will try to make the check pass; a builder who sees "a defect was
 * fixed — decrement the baseline" does the right thing instead.
 */
export function expectCount(findings: readonly Finding[], expected: number, name: string): never {
  if (findings.length > 0) {
    console.error(`\n${name} — ${findings.length} finding(s):\n`)
    for (const f of findings) {
      console.error(`  ${f.where}  [${f.rule}]  ${f.message}`)
    }
    console.error('')
  }

  if (findings.length === expected) {
    console.log(
      `${name} — ${findings.length} finding(s), matching the committed baseline of ${expected}. ` +
        (expected > 0
          ? 'The property is still violated; the baseline is the ratchet, not a pass.'
          : 'Property holds.'),
    )
    process.exit(0)
  }

  if (findings.length < expected) {
    console.error(
      `${name} — expected ${expected}, found ${findings.length} — a defect appears to have been ` +
        'FIXED. Decrement the baseline in docs/plans/slice-0-invariants/baselines.json in the ' +
        'same PR as the fix. Do not decrement it without a source change.',
    )
  } else {
    console.error(
      `${name} — expected ${expected}, found ${findings.length} — a NEW violation was introduced. ` +
        'Fix the source, not the baseline.',
    )
  }
  process.exit(1)
}

/**
 * The empty-input guard, generalized from `check-emit-parses.ts:77`.
 * Zero inputs is always exit 1: a check that scanned nothing has measured
 * nothing, and "0 findings" from an empty scan is the purest vacuous pass.
 */
export function refuseVacuous(items: readonly unknown[], name: string, what: string): void {
  if (items.length === 0) {
    console.error(`${name} — no ${what} discovered; refusing to pass vacuously.`)
    process.exit(1)
  }
}

// ─── The agent-surface allowlist ─────────────────────────────────────────────

/**
 * The single definition of "agent surface", consumed by `check:derived` and
 * `check:attributed` so the two cannot disagree about what they govern.
 *
 * Exclusions carry their reason inline, because an unexplained exclusion is
 * indistinguishable from a suppression — and no check in this slice supports
 * suppression.
 */
export const AGENT_SURFACE_GLOBS: readonly string[] = [
  'packages/plugin-agent-readiness/src/**/*.ts',
  'packages/seo/src/**/*.ts',
  'packages/agent/src/**/*.ts',
  'packages/agent-service/src/**/*.ts',
  'packages/agent-server/src/**/*.ts',
  'packages/agent-a2a/src/**/*.ts',
  'packages/agent-acp/src/**/*.ts',
  'packages/mcp/src/**/*.ts',
  'packages/server/src/agent-readiness-config.ts',
  'packages/cli/src/**/*.ts',
]

/**
 * Paths excluded from every agent-surface scan.
 *
 * - `packages/primitives/**` — its "kept in sync" comments are about DOM /
 *   attribute reflection and CSS state hooks, not the agent surface.
 * - standalone compiler artifacts — codegen invariants are owned and tested in
 *   the aihu-compiler repository, not this package graph.
 * - `dist/**`, tests — build output and fixtures are not source of truth.
 *   Direct counter to "the test supplies the thing that does not exist."
 */
export const GLOBAL_EXCLUDES: readonly RegExp[] = [
  /(^|\/)dist\//,
  /(^|\/)tests?\//,
  /\.test\.ts$/,
  /\.spec\.ts$/,
  /(^|\/)node_modules\//,
  /(^|\/)packages\/_moved\//,
  /(^|\/)packages\/primitives\//,
  /(^|\/)packages\/compiler\//,
]

export function isExcluded(relPath: string): boolean {
  const p = relPath.replaceAll('\\', '/')
  return GLOBAL_EXCLUDES.some((re) => re.test(p))
}

/** Discover agent-surface source files, repo-relative and sorted. */
export async function agentSurfaceFiles(): Promise<string[]> {
  const { Glob } = await import('bun')
  const out = new Set<string>()
  for (const pattern of AGENT_SURFACE_GLOBS) {
    for (const m of new Glob(pattern).scanSync(ROOT)) {
      const rel = m.replaceAll('\\', '/')
      if (!isExcluded(rel)) out.add(rel)
    }
  }
  return [...out].sort()
}

// ─── Bidirectional self-test ─────────────────────────────────────────────────

/**
 * The bidirectional harness, run BEFORE every real scan.
 *
 * A check with only a should-flag case can be satisfied by a rule that flags
 * everything; a check with only a should-not-flag case can be satisfied by a
 * rule that flags nothing. Both fixtures are required, and a self-test failure
 * exits 1 immediately — a check whose own discrimination is broken must not go
 * on to report a number about the real tree.
 */
export function selfTest(
  name: string,
  cases: ReadonlyArray<{ label: string; actual: number; expected: number }>,
): void {
  const bad = cases.filter((c) => c.actual !== c.expected)
  if (bad.length > 0) {
    console.error(`\n${name} — SELF-TEST FAILED. The check cannot discriminate; its count on the`)
    console.error('real tree is meaningless and was not computed.\n')
    for (const c of bad) {
      console.error(`  ${c.label}: expected ${c.expected} finding(s), got ${c.actual}`)
    }
    process.exit(1)
  }
  const shouldFlag = cases.filter((c) => c.expected > 0).length
  const shouldNot = cases.filter((c) => c.expected === 0).length
  if (shouldFlag === 0 || shouldNot === 0) {
    console.error(
      `${name} — self-test is one-sided (${shouldFlag} should-flag, ${shouldNot} should-not-flag). ` +
        'Both directions are required.',
    )
    process.exit(1)
  }
  console.log(`${name} — self-test ok (${cases.length} cases, both directions).`)
}
