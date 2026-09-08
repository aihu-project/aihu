// @vitest-environment node
// (importing the configs pulls vitest/config -> vite -> esbuild, whose
// TextEncoder invariant check fails under jsdom; the assertions are pure
// object reads, so the node environment is the correct one anyway)
/**
 * #445 meta-assertion — the CI gates must fail loud, never no-op.
 *
 * The legacy-snapshot gate (plan-a.yml) silently passed for weeks: the root
 * vitest exclude defeated its explicit file filter and `passWithNoTests:
 * true` turned "No test files found" into exit 0. That vacuum is what let
 * PR #395's golden drift land unnoticed (#434).
 *
 * These assertions pin the config properties that closed the vacuum. The
 * companion behavioral proof (a bogus filter exits non-zero) was verified
 * manually and cannot regress while `passWithNoTests` stays false.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import rootConfig from '../vitest.config'
import gatesConfig from '../vitest.gates.config'

type TestSection = { passWithNoTests?: boolean; exclude?: string[] }
const rootTest = (rootConfig as { test?: TestSection }).test ?? {}
const gatesTest = (gatesConfig as { test?: TestSection }).test ?? {}

describe('CI gate honesty (#445)', () => {
  it('root config: a zero-test vitest invocation must exit non-zero', () => {
    expect(rootTest.passWithNoTests).toBe(false)
  })

  it('gates config: same — a gate step selecting zero tests must fail', () => {
    expect(gatesTest.passWithNoTests).toBe(false)
  })

  it('gates config un-excludes the gated tests the root config excludes', () => {
    const gatesExclude = gatesTest.exclude ?? []
    expect(gatesExclude).toEqual(['**/node_modules/**'])
  })

  it('runs polished examples only for the governed coverage boundary', () => {
    const planA = readFileSync(new URL('../.github/workflows/plan-a.yml', import.meta.url), 'utf8')
    const examples = planA.match(/ {2}examples:\n([\s\S]*?)\n {2}governed-examples:/)?.[1] ?? ''

    expect(examples).toContain('needs: [check, changes]')
    expect(examples).toContain("needs.changes.outputs.governed == 'true'")
  })

  it('every root-excluded test file is genuinely invoked in plan-a.yml via the gates config', () => {
    // The b3b class of bug: excluded at root AND invoked nowhere = a test
    // that exists but gates nothing. Any test file excluded at root must
    // have a dedicated plan-a step running it through the gates config.
    // Compiler-source tests moved to aihu-compiler with its release pipeline;
    // this root workspace intentionally excludes them instead of duplicating
    // their CI. Every other excluded test remains a root-owned gate.
    const excludedFiles = (rootTest.exclude ?? []).filter(
      (entry) => !entry.includes('node_modules'),
    )
    expect(excludedFiles.length).toBeGreaterThan(0)
    const planA = readFileSync(new URL('../.github/workflows/plan-a.yml', import.meta.url), 'utf8')
    for (const file of excludedFiles) {
      const invoked = planA
        .split('\n')
        .some((line) => line.includes(file) && line.includes('--config vitest.gates.config.ts'))
      expect(
        invoked,
        `${file} is excluded in vitest.config.ts but plan-a.yml has no ` +
          'gate step running it with --config vitest.gates.config.ts — it gates nothing.',
      ).toBe(true)
    }
  })
})
