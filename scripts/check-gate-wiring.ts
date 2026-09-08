#!/usr/bin/env bun
/**
 * check-gate-wiring.ts — C-FEL-428 gate-wiring meta-check.
 *
 * Two properties per gate: (1) REACHABILITY — some CI path invokes it; (2)
 * NEGATIVE FIXTURE — its red path was EXECUTED this run and observed to exit
 * non-zero. Both halves below.
 *
 * WHY THIS EXISTS: a gate that no CI path ever invokes is green-by-construction
 * — it can never make a PR red, so it protects nothing. That is the
 * FEL-438/FEL-430 shape ("an invariant parked outside CI protects nothing",
 * check:emit-parses' own plan-a.yml comment). This meta-check enumerates every
 * gate and asserts each is REACHABLE by CI.
 *
 * REACHABILITY = EITHER ROUTE (orchestrator amendment, post-#673): a gate is
 * reachable if it is in the `check:ci` transitive chain OR an actual `run:`
 * step in any .github/workflows/*.yml invokes it. The repo DELIBERATELY runs
 * cheap always-on gates as their own workflow job (lesson-refs, readme-sync)
 * rather than inside check:ci; a check:ci-ONLY test would flag those
 * correctly-wired gates and pressure someone to undo #673.
 *
 * ...BUT THE CHAIN ROUTE IS CONDITIONAL, and this is the correction that this
 * meta-check most needed (C-FEL-GATE-WIRING-RUNS). Membership in `check:ci`
 * only means "CI invokes this gate" IF SOME WORKFLOW INVOKES `check:ci`. On
 * main it did not — plan-a.yml says so in its own words ("`check:ci` is invoked
 * by no workflow in this repo") — so the chain route was asserting a fact that
 * was false, and it was covering for exactly ONE gate: check:gate-wiring
 * ITSELF, which appeared in no `run:` step anywhere in .github/. The meta-check
 * that exists to forbid green-by-construction gates was one. So the chain route
 * is now GATED on `ciChainIsWired` below, derived from the same `run:` bodies as
 * everything else. Self-correcting in both directions: wire `check:ci` into a
 * workflow and the chain route becomes valid again automatically; unwire it and
 * every chain-only gate is reported. Nothing here hardcodes today's answer.
 *
 * DANGLING CHAIN REFERENCE (same contract): `bun run check:grammar-v` sat in the
 * check:ci chain naming a script that does not exist — the script is
 * check:grammar-v2. `bun run` on an undefined name exits 1, so local check:ci
 * died mid-chain, and check:grammar-v2 fell out of the chain and became a NEW
 * ORPHAN. Both facts were true on main and neither was visible, because of the
 * paragraph above. A name that resolves to no script is now RED in its own
 * right: it is a gate invocation that cannot invoke a gate.
 *
 * A workflow "invokes" a gate if a run: body names it by `check:<name>` OR by
 * the SCRIPT PATH its command runs. storybook.yml runs check:stories by PATH
 * (`bun scripts/check-required-stories.ts`), not by name — matching only the
 * name would mis-flag a correctly-wired gate as an orphan.
 *
 * TWO PARSE TRAPS, both of which flip a TRUE finding into a FALSE one (the
 * self-test below reproduces each before trusting the scan):
 *   1. COMMENTS ARE NOT INVOCATIONS. plan-a.yml MENTIONS check:agent-conformance
 *      in a YAML comment ("NOT here — see the lesson-refs job"). That is not a
 *      run step. We read ONLY `run:` step bodies, and strip shell `#` comments.
 *   2. `on.push.paths` FILTERS LIST SCRIPT PATHS (e.g. scripts/check-required-
 *      stories.ts) but do not RUN them. Same fix: only `run:` bodies count.
 *
 * DEBT, NOT A HARD FAIL (slice-0 idiom, docs/plans/slice-0-invariants): two
 * gates are orphaned on main today (check:hmr, check:hydration-adoption) and
 * this contract's SURFACE forbids rewiring them. So the orphan set is locked
 * against a committed baseline: exit 0 iff current === baseline. A NEW orphan
 * is red and named; a baseline orphan that gets WIRED is ALSO red (forces the
 * baseline decrement into the same PR as the fix). The baseline is printed as
 * DEBT every run so it cannot go quiet.
 *
 * SURFACE (C-FEL-428): this meta-check + its baseline only. It does NOT rewrite
 * or rewire any individual gate to fix what it finds.
 *
 * NEGATIVE FIXTURE (ruling 1): a gate is PROVEN only if its red command is
 * EXECUTED in this run and observed to exit non-zero — declared/registered is
 * not enough (that would be green-by-construction, the meta-gate becoming an
 * instance of its own subject). Gates not yet proven are grandfathered into a
 * SHRINK-ONLY ramp (scripts/gate-fixture-baseline.json) so this does not require
 * rewriting ~20 gates on day one; the ramp can only shrink as gates opt in. See
 * NEGATIVE_FIXTURES below.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Glob } from 'bun'

const REPO_ROOT = join(import.meta.dir, '..')

// Pure chains (not gates) are excluded: check:ci / check:pre-push / check:thesis
// only orchestrate other check:*; they have no assertion of their own.
const EXCLUDE_CHAINS = new Set(['check:ci', 'check:pre-push', 'check:thesis'])
// Fixers (scripts that WRITE/regenerate rather than assert) must not be
// enumerated as gates that have to go red. This set is EMPTY BY CONSTRUCTION and
// must stay that way: the repo's writers are `check` (biome check --write .),
// `format`, `readme:remeasure` and `release:version` — NONE is a check:* leaf,
// so the check:*-prefixed enumeration already excludes every one of them. This
// list exists only for a HYPOTHETICAL future check:* that writes; do NOT
// populate it to "tidy up" an empty set. (C-FEL-428 ruling 2.)
const EXCLUDE_FIXERS = new Set<string>([])

// A fixture subprocess (used to prove a gate's negative path — see below) sets
// this so it runs the reachability half ONLY and does not recurse into the
// negative-fixture half that spawned it.
const NO_FIXTURES = Boolean(process.env.GATE_WIRING_NO_FIXTURES)
// The reachability baseline path is overridable so a proof run can point the
// meta-check at an EMPTY baseline (turning the real orphans into "new" ones) and
// observe it go red — the meta-gate proving its own detector actually fires.
const REACH_BASELINE = process.env.GATE_WIRING_BASELINE ?? 'scripts/gate-wiring-baseline.json'

/**
 * NEGATIVE-FIXTURE REGISTRY (C-FEL-428, ruling 1). A gate counts as PROVEN only
 * if the command here is EXECUTED in this run and OBSERVED to exit non-zero —
 * not declared, not registered. Day-one this proves the meta-check ITSELF (the
 * meta-gate is not exempt from its own rule): run it against an EMPTY baseline
 * so the real orphans become "new" and it MUST go red; a detector that found
 * nothing would exit 0 and be caught as unproven. Every other gate is
 * grandfathered into the SHRINK-ONLY not-yet-proven baseline
 * (scripts/gate-fixture-baseline.json). A gate opts in by adding a
 * fixture-invocation entry here — future work, since THIS contract's surface
 * forbids rewriting the individual gates to expose a fixture-scan mode.
 */
interface Fixture {
  /** Red input: MUST exit non-zero, or the gate cannot go red. */
  cmd: string[]
  env?: Record<string, string>
  /**
   * Optional GREEN control on a near-identical input: MUST exit 0.
   *
   * Why (C-FEL-GATE-WIRING-RUNS): "exited non-zero" alone does not prove the
   * gate DISCRIMINATES. A fixture that is red because the gate crashed, or
   * because the fixture tree is malformed in some way unrelated to the property
   * under test, satisfies the red half perfectly and proves nothing — a gate
   * that says "no" to everything is as useless as one that says "yes" to
   * everything. Pair the red input with a control differing in EXACTLY the
   * property being asserted. For check:moon-graph the two trees are identical
   * but for one `dependsOn: ['beta']` line.
   *
   * Optional so this does not invalidate the day-one proof below, whose control
   * is structural: the same command runs against the REAL baseline on every
   * other invocation of this file and is required to exit 0 for it to proceed.
   */
  green?: { cmd: string[]; env?: Record<string, string> }
}

const NEGATIVE_FIXTURES: Record<string, Fixture> = {
  'check:gate-wiring': {
    cmd: ['bun', 'scripts/check-gate-wiring.ts'],
    env: {
      GATE_WIRING_NO_FIXTURES: '1',
      GATE_WIRING_BASELINE: 'scripts/fixtures/gate-wiring/empty-baseline.json',
    },
  },
  // First gate to leave the shrink-only ramp — it was never ON it. #671 added
  // check:moon-graph with no proof and no ramp entry, which check:gate-wiring
  // reports as `GATE WITH NO NEGATIVE-FIXTURE PROOF and not grandfathered`. That
  // went unseen for the whole life of the gate because check:gate-wiring ran in
  // no workflow. `MOON_GRAPH_ROOT` (added with this entry) repoints its scan at
  // a fixture tree; it changes WHERE the gate reads and nothing else.
  // One-Rust-pin guard. `RUST_PIN_ROOT` repoints the scan at a fixture tree
  // (same shape as MOON_GRAPH_ROOT): red is a workflow pinning the minor
  // SERIES "1.95" while rust-toolchain.toml declares the exact "1.95.0" —
  // the real drift this gate was written for, since rustup resolves a series
  // to the latest patch and CI ends up installing a toolchain the repo never
  // declared. Green is every pin matching exactly.
  'check:rust-pin': {
    cmd: ['bun', 'scripts/check-rust-pin.ts'],
    env: { RUST_PIN_ROOT: 'scripts/fixtures/rust-pin/should-flag' },
    green: {
      cmd: ['bun', 'scripts/check-rust-pin.ts'],
      env: { RUST_PIN_ROOT: 'scripts/fixtures/rust-pin/should-not-flag' },
    },
  },
  'check:moon-graph': {
    cmd: ['bun', 'scripts/check-moon-graph.ts'],
    env: { MOON_GRAPH_ROOT: 'scripts/fixtures/moon-graph/should-flag' },
    green: {
      cmd: ['bun', 'scripts/check-moon-graph.ts'],
      env: { MOON_GRAPH_ROOT: 'scripts/fixtures/moon-graph/should-not-flag' },
    },
  },
  'check:lockfile-platform-pins': {
    cmd: ['bun', 'scripts/check-lockfile-platform-pins.ts'],
    env: { LOCKFILE_PINS_ROOT: 'scripts/fixtures/lockfile-platform-pins/should-flag' },
    green: {
      cmd: ['bun', 'scripts/check-lockfile-platform-pins.ts'],
      env: { LOCKFILE_PINS_ROOT: 'scripts/fixtures/lockfile-platform-pins/should-not-flag' },
    },
  },
  // FEL-342 — the LSP composable-registry generator's --check mode. Same
  // env-override shape as check:moon-graph: point it at a 2-entry fixture
  // `USE_COMPOSABLES` and a hand-written "committed" output missing one
  // entry (red) vs. matching exactly (green).
  'check:composable-registry': {
    cmd: ['bun', 'scripts/gen-composable-hover-registry.ts', '--check'],
    env: {
      COMPOSABLE_REGISTRY_RS: 'scripts/fixtures/composable-registry/use_registry.rs',
      COMPOSABLE_REGISTRY_OUT: 'scripts/fixtures/composable-registry/expected-mismatch.ts',
      COMPOSABLE_REGISTRY_CONTRACT_OUT:
        'scripts/fixtures/composable-registry/expected-mismatch.json',
      COMPOSABLE_USE_SRC_ROOT: 'scripts/fixtures/composable-registry/nonexistent-src',
    },
    green: {
      cmd: ['bun', 'scripts/gen-composable-hover-registry.ts', '--check'],
      env: {
        COMPOSABLE_REGISTRY_RS: 'scripts/fixtures/composable-registry/use_registry.rs',
        COMPOSABLE_REGISTRY_OUT: 'scripts/fixtures/composable-registry/expected-match.ts',
        COMPOSABLE_REGISTRY_CONTRACT_OUT:
          'scripts/fixtures/composable-registry/expected-match.json',
        COMPOSABLE_USE_SRC_ROOT: 'scripts/fixtures/composable-registry/nonexistent-src',
      },
    },
  },
  // The css-engine/server native-binary-bump guards (scripts/lib/native-
  // binary-bump.ts, same rule as check:compiler-binary-bump — see that
  // gate's own history for why this class of guard exists). Both scripts
  // support a CHANGED_FILES env override that replaces the real `git diff`
  // with a synthetic file list, so no on-disk fixture tree is needed: red is
  // "Rust source changed, no platform bumped", green is a complete bump
  // (every platform of the one family this package ships, plus the host
  // manifest's optionalDependencies repoint).
  'check:css-engine-binary-bump': {
    cmd: ['bun', 'scripts/check-css-engine-binary-bump.ts'],
    env: { CHANGED_FILES: 'packages/css-engine/crates/aihu-css-core/src/ast.rs' },
    green: {
      cmd: ['bun', 'scripts/check-css-engine-binary-bump.ts'],
      env: {
        CHANGED_FILES: [
          'packages/css-engine/crates/aihu-css-core/src/ast.rs',
          'packages/css-engine/npm/darwin-arm64/package.json',
          'packages/css-engine/npm/darwin-x64/package.json',
          'packages/css-engine/npm/linux-x64-gnu/package.json',
          'packages/css-engine/npm/win32-x64-msvc/package.json',
          'packages/css-engine/package.json',
        ].join(','),
      },
    },
  },
  'check:server-binary-bump': {
    cmd: ['bun', 'scripts/check-server-binary-bump.ts'],
    env: { CHANGED_FILES: 'packages/server/src-native/src/render.rs' },
    green: {
      cmd: ['bun', 'scripts/check-server-binary-bump.ts'],
      env: {
        CHANGED_FILES: [
          'packages/server/src-native/src/render.rs',
          'packages/server/npm/darwin-arm64/package.json',
          'packages/server/npm/darwin-x64/package.json',
          'packages/server/npm/linux-x64-gnu/package.json',
          'packages/server/npm/win32-x64-msvc/package.json',
          'packages/server/package.json',
        ].join(','),
      },
    },
  },
  // performativeUI port Track B follow-up: check:cn-map and
  // check:animations-gallery were wired into plan-a.yml's `check` job (they
  // had been NEW ORPHANs — declared but invoked by no workflow, see git
  // history on this entry's PR). Same shape as check:moon-graph above: a gate
  // freshly leaving "no CI path invokes it" must ship its own proof rather
  // than fall into the shrink-only not-yet-proven ramp, which can never be
  // ADDED to.
  //
  // BUILDLESS BY CONSTRUCTION — THIS job (`gate-wiring` in plan-a.yml) runs
  // with no `bun install`, no build, no Rust (deliberately, see that job's own
  // comment). Both generators normally shell out to the `aihu-css-compile`
  // Rust binary; a fixture that did the same would throw "binary not found"
  // on BOTH its red and green runs here — indiscriminate, not proven. So
  // CN_MAP_DUMP_JSON / ANIMATIONS_GALLERY_CLASSES_JSON /
  // ANIMATIONS_GALLERY_CSS_DUMP repoint the INPUT at a committed fixture file
  // instead (bypassing the binary entirely), while CN_MAP_TARGET /
  // ANIMATIONS_GALLERY_*_TARGET repoint the OUTPUT comparison — red points at
  // a deliberately-stale target, green at the exact expected serialization of
  // the same dump (generated once via the script's own write mode, not
  // hand-transcribed, so it cannot drift from the real format).
  'check:cn-map': {
    cmd: ['bun', 'packages/css-engine/scripts/gen-cn-conflict-map.ts', '--check'],
    env: {
      CN_MAP_DUMP_JSON: 'scripts/fixtures/cn-map/dump.json',
      CN_MAP_TARGET: 'scripts/fixtures/cn-map/stale.generated.ts',
    },
    green: {
      cmd: ['bun', 'packages/css-engine/scripts/gen-cn-conflict-map.ts', '--check'],
      env: {
        CN_MAP_DUMP_JSON: 'scripts/fixtures/cn-map/dump.json',
        CN_MAP_TARGET: 'scripts/fixtures/cn-map/expected.generated.ts',
      },
    },
  },
  // The scaffold dependency-range drift guard. Same env-override shape as
  // check:moon-graph / check:cn-map: TEMPLATE_VERSIONS_PACKAGES_DIR repoints the
  // version SOURCE at a two-package fixture tree and TEMPLATE_VERSIONS_TS_TARGET
  // repoints the generated-module TARGET, so this runs BUILDLESS — no `bun
  // install`, no compiler, nothing but reading four small files — which is what
  // this job (`gate-wiring` in plan-a.yml) requires.
  //
  // Red and green differ in EXACTLY the property under test: one `@aihu/runtime`
  // range, `^5.0.0` (stale) vs `^6.0.0` (the fixture package's real version).
  // Same generator, same source tree, same everything else — so a red run is the
  // detector firing on drift, not on a malformed fixture.
  'check:template-versions': {
    cmd: ['bun', 'scripts/sync-template-versions.ts', '--check'],
    env: {
      TEMPLATE_VERSIONS_PACKAGES_DIR: 'scripts/fixtures/template-versions/packages',
      TEMPLATE_VERSIONS_TS_TARGET: 'scripts/fixtures/template-versions/stale.generated.ts',
    },
    green: {
      cmd: ['bun', 'scripts/sync-template-versions.ts', '--check'],
      env: {
        TEMPLATE_VERSIONS_PACKAGES_DIR: 'scripts/fixtures/template-versions/packages',
        TEMPLATE_VERSIONS_TS_TARGET: 'scripts/fixtures/template-versions/expected.generated.ts',
      },
    },
  },
  // The tsc <-> vitest alias parity gate. Same env-override shape as
  // check:moon-graph / check:rust-pin: ALIAS_PARITY_ROOT repoints the SCAN at a
  // self-contained fixture tree (two tiny packages, one tsconfig, one
  // vitest.config.ts), so it runs BUILDLESS — no `bun install`, no compiler,
  // nothing but reading four small files — which is what THIS job (`gate-wiring`
  // in plan-a.yml) requires.
  //
  // Red and green differ in EXACTLY the property under test: `@fx/beta` aliased
  // to `packages/beta/dist/index.d.ts` (red) vs `packages/beta/src/index.ts`
  // (green), against the same tsconfig mapping it to src both times. Same keys,
  // same ordering, same files — so a red run is the src-vs-dist detector firing,
  // not a malformed fixture. See scripts/fixtures/alias-parity/README.md.
  'check:alias-parity': {
    cmd: ['bun', 'scripts/check-alias-parity.ts'],
    env: { ALIAS_PARITY_ROOT: 'scripts/fixtures/alias-parity/should-flag' },
    green: {
      cmd: ['bun', 'scripts/check-alias-parity.ts'],
      env: { ALIAS_PARITY_ROOT: 'scripts/fixtures/alias-parity/should-not-flag' },
    },
  },
  // Same shape, for check:animations-gallery's two generated targets.
  'check:animations-gallery': {
    cmd: ['bun', 'packages/css-engine/scripts/gen-animations-gallery.ts', '--check'],
    env: {
      ANIMATIONS_GALLERY_CLASSES_JSON: 'scripts/fixtures/animations-gallery/dump-classes.json',
      ANIMATIONS_GALLERY_CSS_DUMP: 'scripts/fixtures/animations-gallery/dump.css',
      ANIMATIONS_GALLERY_CSS_TARGET: 'scripts/fixtures/animations-gallery/stale.generated.css',
      ANIMATIONS_GALLERY_CLASSES_TARGET: 'scripts/fixtures/animations-gallery/stale.generated.ts',
    },
    green: {
      cmd: ['bun', 'packages/css-engine/scripts/gen-animations-gallery.ts', '--check'],
      env: {
        ANIMATIONS_GALLERY_CLASSES_JSON: 'scripts/fixtures/animations-gallery/dump-classes.json',
        ANIMATIONS_GALLERY_CSS_DUMP: 'scripts/fixtures/animations-gallery/dump.css',
        ANIMATIONS_GALLERY_CSS_TARGET: 'scripts/fixtures/animations-gallery/expected.generated.css',
        ANIMATIONS_GALLERY_CLASSES_TARGET:
          'scripts/fixtures/animations-gallery/expected.generated.ts',
      },
    },
  },
}

interface Baseline {
  orphans: string[]
}

// ── GATING HALF (C-FEL-GATE-WIRING-RUNS) ─────────────────────────────────────
//
// REACHABILITY (above) answers "does some workflow invoke this gate". It does
// NOT answer "does a failure of that gate fail the PR". Those are different
// properties and only the first existed.
//
// `ci-ok` is the SOLE required status on main. Its own comment states the rule:
// "being in `needs` is NOT being gated on; only appearing in the loop below is."
// A job in `needs:` is WAITED on; a job read in the result loop is GATED on.
// Drop the loop entry and the job still runs, still goes red, and ci-ok reports
// SUCCESS — green-by-construction one layer up from the gates.
//
// THIS IS NOT HYPOTHETICAL AND THAT IS WHY IT IS CHECKED IN CODE. plan-a.yml
// records it happening TWICE: the `palette` job (in `needs:`, result never read,
// ci-ok green on a red palette) and #649. A two-incident history is what argued
// against wiring any gate as its own job at all. This closes it structurally, so
// own-job is safe rather than merely careful — and the check is the same parse
// of plan-a.yml the reachability half already does.
//
// Deliberately stronger than "the name appears in the loop": the loop entry's
// env var must be bound to THAT job's `.result`. A copy-paste that leaves
// `"gate-wiring:$README_SYNC_RESULT"` reads perfectly and gates nothing.
const AGGREGATOR_WORKFLOW = '.github/workflows/plan-a.yml'
const AGGREGATOR_JOB = 'ci-ok'

/**
 * Jobs a HUMAN has declared exempt from result-loop gating. `changes` is the
 * only one: ci-ok consumes `needs.changes.outputs.code` rather than gating on
 * its pass/fail.
 *
 * THIS LIST IS NECESSARY BUT NOT SUFFICIENT, AND THE TWO-KEY SHAPE IS THE POINT.
 * A name here silences nothing on its own — the check below ALSO requires that
 * ci-ok genuinely reads `needs.<job>.outputs.*`. So an exemption takes a human
 * DECLARING it and the machine VERIFYING the property holds.
 *
 * I briefly replaced this with a pure derivation ("no list; exempt iff outputs
 * are consumed"), reasoning that any allowlist is the fail-open shape this
 * contract fixed in ci-ok's own loop. That was WRONG, and measurably so: with
 * the pure form, adding a job to `needs:` plus a single unused
 * `FOO: ${{ needs.badjob.outputs.x }}` line silently exempts it — one key, no
 * declaration, EXIT 0. The two-key form flags it, because the name is absent
 * here. Pure derivation lets an exemption APPEAR; this makes it a deliberate act.
 *
 * The hazard I thought I was closing does not exist against the two-key form:
 * "just append the name" cannot silence a real gate, since the outputs proof
 * still fails. A NEW legitimate outputs-provider that nobody lists is FLAGGED —
 * friction that fails CLOSED, which is the correct direction for an exemption.
 *
 * OR, not XOR: a job may legitimately be BOTH gated AND export a value ci-ok
 * reads. The exemption branch below is only reached when the job is ABSENT from
 * the loop, so that arrangement never consults this list and cannot false-red.
 * (XOR would flag it, and a false red is pressure to widen the exemption.)
 */
const NEEDS_NOT_GATED = new Set(['changes'])

function readScripts(): Record<string, string> {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).scripts ?? {}
}

/** Script paths a command actually runs (for reachability-by-path). */
function scriptPathsOf(cmd: string): string[] {
  return [...cmd.matchAll(/(?:scripts|skills|packages)\/[\w./@-]+\.(?:ts|sh|js|mjs)/g)].map(
    (m) => m[0],
  )
}

/** Gate names: check:* minus pure chains minus the fixer. */
function gateNames(scripts: Record<string, string>): string[] {
  return Object.keys(scripts).filter(
    (k) => k.startsWith('check:') && !EXCLUDE_CHAINS.has(k) && !EXCLUDE_FIXERS.has(k),
  )
}

/** check:* names the check:ci chain transitively invokes. */
function chainReachable(scripts: Record<string, string>): Set<string> {
  const seen = new Set<string>()
  const visit = (name: string) => {
    if (seen.has(name)) return
    seen.add(name)
    const cmd = scripts[name] ?? ''
    for (const m of cmd.matchAll(/bun run (check:[a-z0-9:-]+)/g)) visit(m[1])
  }
  visit('check:ci')
  return seen
}

/**
 * Does any workflow `run:` body actually invoke `check:ci`? The chain route is
 * only meaningful if one does. Negative lookahead so `check:ci-something` (a
 * DIFFERENT script) cannot be mistaken for it — `\b` would not do, because the
 * `-` that follows is a non-word char and would satisfy the boundary.
 */
function ciChainIsWired(workflowRunText: string): boolean {
  return /check:ci(?![\w:-])/.test(workflowRunText)
}

/**
 * Every `bun run <name>` in package.json whose <name> is not a defined script.
 * `bun run` exits 1 on an undefined name, so such a reference silently truncates
 * whatever chain contains it AND drops the gate it was meant to name.
 *
 * TWO REAL SHAPES this must not misread, both present in this package.json and
 * both of which turn a true finding into a false one:
 *   1. `bun run --cwd apps/storybook storybook` — the name is resolved against
 *      apps/storybook/package.json, NOT root's. There is nothing here to check
 *      it against, so a --cwd invocation is SKIPPED, not reported. Reading
 *      `--cwd` (or `apps/storybook`) as the script name yields three dangling
 *      refs that do not exist, and a meta-check that cries wolf gets muted —
 *      the same end state as not running at all.
 *   2. `bun run test packages/app/tests/x.test.ts` — trailing ARGUMENTS follow
 *      the script name. Only the first non-flag token is a script name.
 */
function danglingRunRefs(scripts: Record<string, string>): { from: string; name: string }[] {
  const out: { from: string; name: string }[] = []
  for (const [from, cmd] of Object.entries(scripts)) {
    // One shell segment per `bun run`; `&&`/`;`/`|` end an invocation's args.
    for (const seg of cmd.split(/&&|\|\||;|\|/)) {
      const tokens = seg.trim().split(/\s+/)
      const at = tokens.findIndex((t, i) => t === 'run' && tokens[i - 1] === 'bun')
      if (at === -1) continue
      const rest = tokens.slice(at + 1)
      if (rest.includes('--cwd')) continue // resolved against another manifest
      const name = rest.find((t) => !t.startsWith('-'))
      if (name && !(name in scripts)) out.push({ from, name })
    }
  }
  return out
}

/** Strip a shell `#` comment so a commented mention is not read as a command. */
function stripShellComment(line: string): string {
  return line.replace(/(^|\s)#.*$/, '')
}

/**
 * The executed shell text of a workflow: the concatenation of every `run:`
 * step body (inline and block-scalar), with comments removed. Deliberately
 * ignores everything else — `on.push.paths` filters, `name:`, `if:`, YAML
 * comments — so only genuine invocations count.
 */
function runBodiesOf(yamlText: string): string {
  const lines = yamlText.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(?:-\s+)?run:\s*(.*)$/)
    if (!m) continue
    const indent = m[1].length
    const inline = m[2].trim()
    if (inline && !/^[|>]/.test(inline)) {
      out.push(stripShellComment(inline))
      continue
    }
    // block scalar: gather lines indented deeper than the `run:` key
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') continue
      const bIndent = lines[j].match(/^(\s*)/)![1].length
      if (bIndent <= indent) break
      out.push(stripShellComment(lines[j]))
    }
  }
  return out.join('\n')
}

function allWorkflowRunText(): string {
  // Scan INSIDE the workflows dir: Bun's Glob skips the dot-dir `.github`
  // unless matched from within it, which would silently return zero files and
  // make every non-check:ci gate a false orphan (the exact wrong-meta-gate
  // failure this contract exists to prevent — caught by running it).
  const dir = join(REPO_ROOT, '.github/workflows')
  const glob = new Glob('*.yml')
  const files = [...glob.scanSync({ cwd: dir })]
  if (files.length === 0) {
    console.error(
      'check:gate-wiring: found no .github/workflows/*.yml — refusing to pass vacuously.',
    )
    process.exit(1)
  }
  return files.map((f) => runBodiesOf(readFileSync(join(dir, f), 'utf8'))).join('\n')
}

/** Reachable by check:ci chain (by name) OR by a workflow run: (name OR path). */
function isReachable(
  gate: string,
  cmd: string,
  chain: Set<string>,
  workflowRunText: string,
): boolean {
  if (chain.has(gate)) return true
  if (workflowRunText.includes(gate)) return true
  return scriptPathsOf(cmd).some((p) => workflowRunText.includes(p))
}

/** The `jobs:` block's top-level job ids, in order. */
export function jobIdsOf(yamlText: string): string[] {
  const lines = yamlText.split('\n')
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l))
  if (start === -1) return []
  // Scoped to AFTER `jobs:` on purpose: `on:` has `  push:` / `  pull_request:`
  // children with the identical shape, and counting those as jobs would make
  // every real check downstream nonsense.
  return lines
    .slice(start + 1)
    .map((l) => l.match(/^ {2}([A-Za-z0-9_-]+):\s*$/)?.[1])
    .filter((x): x is string => Boolean(x))
}

/** The text of one job block (from `  <id>:` to the next `  <id>:`). */
export function jobBlockOf(yamlText: string, jobId: string): string {
  const lines = yamlText.split('\n')
  const start = lines.indexOf(`  ${jobId}:`)
  if (start === -1) return ''
  let end = start + 1
  while (end < lines.length && !/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[end])) end++
  return lines.slice(start, end).join('\n')
}

interface GatingAudit {
  /** jobs listed in the aggregator's `needs:` */
  needs: string[]
  /** job name -> the env var its result-loop entry reads */
  loop: Map<string, string>
  /** env var -> the job whose `.result` it is bound to */
  binding: Map<string, string>
  /** jobs the aggregator reads `.outputs.` from */
  outputsRead: Set<string>
}

export function auditGating(aggregatorBlock: string): GatingAudit {
  const needs = (aggregatorBlock.match(/^\s*needs:\s*\[([^\]]*)\]/m)?.[1] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  // `for pair in "check:$CHECK_RESULT" "examples:$EXAMPLES_RESULT" ...; do`
  const forLine = aggregatorBlock.split('\n').find((l) => /^\s*for\s+\w+\s+in\s+"/.test(l)) ?? ''
  const loop = new Map<string, string>()
  for (const m of forLine.matchAll(/"([A-Za-z0-9_-]+):\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?"/g)) {
    loop.set(m[1], m[2])
  }

  // `CHECK_RESULT: ${{ needs.check.result }}`
  const binding = new Map<string, string>()
  for (const m of aggregatorBlock.matchAll(
    /^\s*([A-Za-z_][A-Za-z0-9_]*):\s*\$\{\{\s*needs\.([A-Za-z0-9_-]+)\.result\s*\}\}/gm,
  )) {
    binding.set(m[1], m[2])
  }

  const outputsRead = new Set<string>()
  for (const m of aggregatorBlock.matchAll(/needs\.([A-Za-z0-9_-]+)\.outputs\./g)) {
    outputsRead.add(m[1])
  }

  return { needs, loop, binding, outputsRead }
}

/**
 * Every `needs:` entry of the aggregator must be GATED ON, not merely waited on:
 * present in the result loop, and bound to its OWN job's `.result`. The only
 * exemption is an outputs-provider, and it must PROVE it is one.
 */
function gatingProblems(aggregatorBlock: string): string[] {
  const { needs, loop, binding, outputsRead } = auditGating(aggregatorBlock)
  const problems: string[] = []
  if (needs.length === 0) {
    return [`${AGGREGATOR_JOB}: could not parse a \`needs:\` list — refusing to pass vacuously.`]
  }
  if (loop.size === 0) {
    return [`${AGGREGATOR_JOB}: could not parse a result loop — refusing to pass vacuously.`]
  }
  for (const job of needs) {
    const varName = loop.get(job)
    if (!varName) {
      // Not gated. Legitimate only under BOTH keys: declared here, AND the
      // outputs-provider property actually exhibited by the file.
      if (!NEEDS_NOT_GATED.has(job)) {
        problems.push(
          `${job}: in \`needs:\` but MISSING from ${AGGREGATOR_JOB}'s result loop — it is WAITED on, not GATED on. It can fail while ${AGGREGATOR_JOB} reports success (the palette defect, #649). If it is an outputs provider rather than a gate, declare it in NEEDS_NOT_GATED; declaring alone is not enough, ${AGGREGATOR_JOB} must really read its outputs.`,
        )
      } else if (!outputsRead.has(job)) {
        problems.push(
          `${job}: declared in NEEDS_NOT_GATED but ${AGGREGATOR_JOB} never reads needs.${job}.outputs.* — the exemption is for outputs providers, not for gates. A name on the list silences nothing by itself.`,
        )
      }
      continue
    }
    const boundTo = binding.get(varName)
    if (boundTo !== job) {
      problems.push(
        `${job}: result-loop entry reads $${varName}, which is bound to \`needs.${boundTo ?? '<nothing>'}.result\` — the loop reports on the wrong job.`,
      )
    }
  }

  // ── The runtime count guard's expected value must be DERIVED, not asserted ──
  //
  // ci-ok carries `if [ "$checked" -ne N ]`. That N is the one hand-maintained
  // number in this design, and a hand-maintained number in the file it guards is
  // a CONSISTENCY check, not a CORRECTNESS one — it only catches someone who
  // edited one side. Drop a pair AND decrement N in the same commit (two
  // self-consistent edits) and the guard passes while ci-ok reads one job fewer.
  //
  // So N is checked HERE, against the loop this file already parses. That makes
  // it derived-and-enforced rather than magic: the number cannot drift from the
  // loop without this gate going red, and the two referents now live in
  // DIFFERENT FILES, which is the whole property the co-located version lacked.
  //
  // Why the guard is not redundant with the checks above, which is the part that
  // is easy to get wrong: those make check:gate-wiring red, i.e. they make the
  // GATE-WIRING JOB red. In the exact scenario they detect — a job dropped from
  // the result loop — ci-ok no longer reads that job, so CI-OK ITSELF STAYS
  // GREEN. Measured in production, not argued: run 30401968909, gate-wiring
  // failure + ci-ok SUCCESS. The parse DETECTS; only the runtime guard REJECTS.
  const guard = aggregatorBlock.match(/\$\{?checked\}?"?\s*-ne\s+(\d+)/)
  if (!guard) {
    problems.push(
      `${AGGREGATOR_JOB}: no \`[ "$checked" -ne N ]\` guard — the result loop can be truncated to zero pairs and still report fail=0. \`fail=0\` is an absence report and cannot distinguish "no failing job" from "no job examined".`,
    )
  } else if (Number(guard[1]) !== loop.size) {
    problems.push(
      `${AGGREGATOR_JOB}: count guard expects ${guard[1]} but the result loop has ${loop.size} pair(s) — the guard would pass a loop that reads the wrong number of jobs.`,
    )
  }
  return problems
}

/**
 * Self-test — the meta-check's own negative fixture. Proves the reachability
 * logic CAN flag an orphan (should-flag) AND does not flag a wired gate
 * (should-not-flag), AND reproduces both parse traps, BEFORE it is trusted on
 * the real tree. A meta-check with no failing case is exactly what it exists to
 * forbid, so it must demonstrate its own on every run (exits 1 if the self-test
 * is wrong).
 */
function selfTest(): void {
  const fail = (msg: string) => {
    console.error(`check:gate-wiring SELF-TEST FAILED — ${msg}`)
    process.exit(1)
  }
  const chain = new Set(['check:ci', 'check:real'])
  // should-not-flag: a gate in the chain is reachable
  if (!isReachable('check:real', 'bun scripts/real.ts', chain, '')) fail('chain gate flagged')
  // should-flag: a gate in neither route is an orphan
  if (isReachable('check:orphan', 'bun scripts/orphan.ts', new Set(['check:ci']), '')) {
    fail('orphan gate not flagged')
  }
  // reachable by PATH only (the storybook.yml/check:stories case)
  if (
    !isReachable(
      'check:byPath',
      'bun scripts/thing.ts',
      new Set(['check:ci']),
      'run body: bun scripts/thing.ts',
    )
  ) {
    fail('path-only reachability missed')
  }
  // TRAP 1: a YAML comment mention is NOT an invocation
  const commentOnly = runBodiesOf(
    '    # note: bun run check:ghost is not here\n    - run: echo hi\n',
  )
  if (commentOnly.includes('check:ghost')) fail('comment counted as invocation (trap 1)')
  // TRAP 2: an on.push.paths entry is NOT an invocation
  const pathsOnly = runBodiesOf(
    "on:\n  push:\n    paths:\n      - 'scripts/ghost.ts'\njobs:\n  x:\n    steps:\n      - run: echo hi\n",
  )
  if (pathsOnly.includes('scripts/ghost.ts')) fail('paths-filter counted as invocation (trap 2)')
  // a real run: block-scalar IS captured
  const realRun = runBodiesOf('    - run: |\n        bun scripts/ghost.ts\n        echo done\n')
  if (!realRun.includes('scripts/ghost.ts')) fail('block-scalar run body missed')

  // ── GATING half ────────────────────────────────────────────────────────────
  // `on:` children have the same shape as job ids; counting them would poison
  // every downstream assertion, so prove the scoping first.
  const ids = jobIdsOf('on:\n  push:\n  pull_request:\njobs:\n  alpha:\n  beta:\n    x: 1\n')
  if (ids.join(',') !== 'alpha,beta') fail(`jobIdsOf scoping wrong: got [${ids}]`)

  const ok = [
    '  ci-ok:',
    '    needs: [changes, alpha]',
    '        env:',
    '          ALPHA_RESULT: ${{ needs.alpha.result }}',
    '          CODE: ${{ needs.changes.outputs.code }}',
    '        run: |',
    '          for pair in "alpha:$ALPHA_RESULT"; do',
    '          if [ "$checked" -ne 1 ]; then',
  ].join('\n')
  if (gatingProblems(ok).length) fail(`correct wiring flagged: ${gatingProblems(ok)}`)

  // should-flag: in needs:, absent from the loop (the palette/#649 defect)
  const dropped = ok.replace(' "alpha:$ALPHA_RESULT"', ' "beta:$BETA_RESULT"')
  if (!gatingProblems(dropped).some((p) => p.startsWith('alpha:'))) {
    fail('needs-without-loop not flagged')
  }
  // should-flag: present in the loop but bound to another job's result
  const misbound = ok.replace(
    'ALPHA_RESULT: ${{ needs.alpha.result }}',
    'ALPHA_RESULT: ${{ needs.changes.result }}',
  )
  if (!gatingProblems(misbound).some((p) => p.includes('wrong job'))) {
    fail('mis-bound result var not flagged')
  }
  // KEY 2 should-flag: declared in NEEDS_NOT_GATED, but the outputs property is
  // NOT exhibited. A name on the list must not be able to silence anything.
  const fakeExempt = ok.replace('          CODE: ${{ needs.changes.outputs.code }}\n', '')
  if (!gatingProblems(fakeExempt).some((p) => p.includes('never reads'))) {
    fail('declared-but-unproven exemption not flagged')
  }
  // KEY 1 should-flag: outputs ARE consumed, but the job was never declared —
  // the residual of the pure-derived form (an unused `needs.J.outputs.x` line
  // silently exempts J). Measured EXIT 0 under pure derivation; must be red here.
  const undeclared = ok
    .replace('    needs: [changes, alpha]', '    needs: [changes, alpha, badjob]')
    .replace(
      '          CODE: ${{ needs.changes.outputs.code }}',
      '          CODE: ${{ needs.changes.outputs.code }}\n          FOO: ${{ needs.badjob.outputs.x }}',
    )
  if (!gatingProblems(undeclared).some((p) => p.startsWith('badjob:'))) {
    fail('undeclared job silently exempted by an outputs reference (one-key hole)')
  }
  // should-NOT-flag: a job that is BOTH gated AND outputs-consumed. This is the
  // OR-vs-XOR case; XOR calls a correct arrangement a violation, and that false
  // red is what gets "fixed" by reintroducing an exemption list.
  const bothGatedAndConsumed = ok.replace(
    '          CODE: ${{ needs.changes.outputs.code }}',
    '          CODE: ${{ needs.changes.outputs.code }}\n          X: ${{ needs.alpha.outputs.y }}',
  )
  if (gatingProblems(bothGatedAndConsumed).length) {
    fail('a job both gated AND outputs-consumed was flagged (XOR instead of OR)')
  }
  // should-flag: the count guard's literal drifted from the loop it guards.
  // This is the ONLY thing separating scenario F (drop a pair AND decrement the
  // count — two self-consistent edits) from a silent pass.
  if (!gatingProblems(ok.replace('-ne 1', '-ne 2')).some((p) => p.includes('count guard'))) {
    fail('count guard drift not flagged')
  }
  // should-flag: no count guard at all -> a truncated loop reports fail=0
  if (!gatingProblems(ok.replace('          if [ "$checked" -ne 1 ]; then', '')).length) {
    fail('missing count guard not flagged')
  }
  // must not pass vacuously on an unparseable block
  if (gatingProblems('  ci-ok:\n    steps: []').length === 0) fail('vacuous gating pass')

  // ── chain route is conditional (C-FEL-GATE-WIRING-RUNS) ────────────────────
  if (ciChainIsWired('bun run check:lint')) fail('chain route active with no check:ci invocation')
  if (ciChainIsWired('bun run check:cico')) fail('check:cico misread as check:ci')
  if (!ciChainIsWired('- run: bun run check:ci')) fail('a real check:ci invocation not detected')
  if (!ciChainIsWired('bun run check:ci\n')) fail('check:ci at end-of-line not detected')

  // ── dangling `bun run` reference ───────────────────────────────────────────
  const d = (s: Record<string, string>) => danglingRunRefs(s).map((x) => x.name)
  // should-flag: the real main defect — check:grammar-v vs check:grammar-v2
  if (
    !d({ 'check:ci': 'bun run check:grammar-v', 'check:grammar-v2': 'bun x.ts' }).includes(
      'check:grammar-v',
    )
  ) {
    fail('dangling reference not flagged')
  }
  // should-not-flag: a defined name
  if (d({ 'check:ci': 'bun run check:real', 'check:real': 'bun x.ts' }).length) {
    fail('defined script flagged as dangling')
  }
  // should-not-flag: --cwd resolves against another manifest (trap 1)
  if (d({ storybook: 'bun run --cwd apps/storybook storybook' }).length) {
    fail('--cwd invocation flagged (other manifest)')
  }
  // should-not-flag: trailing args are not script names (trap 2)
  if (d({ test: 'vitest', t: 'bun run test packages/app/tests/x.test.ts --config y.ts' }).length) {
    fail('trailing argument read as a script name')
  }
}

interface NegResult {
  proven: Set<string>
  /** fixture ran but the gate did NOT reject it (exit 0) — a gate that cannot go red. */
  passed: string[]
  /** green control ran but the gate rejected it too — the gate does not discriminate. */
  indiscriminate: string[]
  ms: number
}

/**
 * Execute each registered negative fixture and OBSERVE its exit code. A gate is
 * proven iff its fixture command exits NON-ZERO in this run (executed and
 * observed — ruling 1). A fixture that exits 0 means the gate did not reject its
 * own red input: it cannot go red, the exact green-by-construction defect this
 * meta-check exists to kill.
 */
function proveNegativeFixtures(gates: string[]): NegResult {
  const proven = new Set<string>()
  const passed: string[] = []
  const indiscriminate: string[] = []
  const start = performance.now()
  const run = (cmd: string[], env?: Record<string, string>) =>
    Bun.spawnSync(cmd, {
      cwd: REPO_ROOT,
      env: { ...process.env, ...(env ?? {}) },
      stdout: 'ignore',
      stderr: 'ignore',
    }).exitCode
  for (const g of gates) {
    const entry = NEGATIVE_FIXTURES[g]
    if (!entry) continue
    if (run(entry.cmd, entry.env) === 0) {
      passed.push(g)
      continue
    }
    // Red observed. If a green control is declared, the gate must ACCEPT it —
    // otherwise the red proves only that the gate says no to everything.
    if (entry.green && run(entry.green.cmd, entry.green.env) !== 0) {
      indiscriminate.push(g)
      continue
    }
    proven.add(g)
  }
  return { proven, passed, indiscriminate, ms: performance.now() - start }
}

function main(): void {
  selfTest()

  const scripts = readScripts()
  const gates = gateNames(scripts)
  // Floor: a parse failure that finds no gates must not pass vacuously.
  if (gates.length < 10) {
    console.error(
      `check:gate-wiring: only ${gates.length} gates enumerated — package.json parse looks wrong; refusing to pass vacuously.`,
    )
    process.exit(1)
  }

  const workflowRunText = allWorkflowRunText()
  // The chain route counts ONLY if a workflow actually invokes check:ci.
  const ciWired = ciChainIsWired(workflowRunText)
  const chain = ciWired ? chainReachable(scripts) : new Set<string>()

  const orphans = gates.filter((g) => !isReachable(g, scripts[g], chain, workflowRunText)).sort()

  const baseline: Baseline = JSON.parse(readFileSync(join(REPO_ROOT, REACH_BASELINE), 'utf8'))
  const baseSet = new Set(baseline.orphans)
  const newOrphans = orphans.filter((g) => !baseSet.has(g))
  const fixed = baseline.orphans.filter((g) => !orphans.includes(g))

  console.log(
    `check:gate-wiring — ${gates.length} gates, ${orphans.length} orphaned (baseline ${baseline.orphans.length}).`,
  )
  console.log(
    `  check:ci chain route: ${ciWired ? 'ACTIVE (a workflow run: step invokes check:ci)' : 'INERT (no workflow invokes check:ci — chain membership proves nothing)'}`,
  )
  console.log('  KNOWN-ORPHAN DEBT (reachable by neither check:ci nor any workflow run: step):')
  for (const g of baseline.orphans) console.log(`    - ${g}`)

  let bad = false
  const dangling = danglingRunRefs(scripts)
  if (dangling.length) {
    bad = true
    console.error('\n  DANGLING `bun run` REFERENCE — names a script that does not exist:')
    for (const d of dangling) console.error(`    - ${d.from}  ->  bun run ${d.name}`)
    console.error(
      '  `bun run <undefined>` exits 1, so this truncates its chain and drops whatever gate it meant to name.',
    )
  }
  if (newOrphans.length) {
    bad = true
    console.error('\n  NEW ORPHAN(S) — a gate that no CI path invokes protects nothing:')
    for (const g of newOrphans) {
      console.error(`    - ${g}  (${scripts[g]})`)
    }
    console.error(
      '  Add a `run:` step invoking it in .github/workflows/*.yml — do NOT baseline it away.',
    )
    console.error(
      '  Prefer a STEP in the existing `check` job over a new job: a new job also needs adding to',
    )
    console.error(
      "  ci-ok's `needs:` AND to ci-ok's RESULT LOOP, and this repo has shipped needs-without-loop twice.",
    )
  }
  if (fixed.length) {
    bad = true
    console.error('\n  BASELINE ORPHAN NOW WIRED — decrement the baseline in this same PR:')
    for (const g of fixed) console.error(`    - ${g}`)
    console.error(
      '  Remove it from scripts/gate-wiring-baseline.json so the debt cannot silently regrow.',
    )
  }

  // ── GATING HALF: every job ci-ok WAITS on must also be GATED on ────────────
  const aggYaml = readFileSync(join(REPO_ROOT, AGGREGATOR_WORKFLOW), 'utf8')
  const aggBlock = jobBlockOf(aggYaml, AGGREGATOR_JOB)
  if (!aggBlock) {
    console.error(
      `\n  check:gate-wiring: no \`${AGGREGATOR_JOB}\` job in ${AGGREGATOR_WORKFLOW} — refusing to pass vacuously.`,
    )
    process.exit(1)
  }
  const { needs, loop } = auditGating(aggBlock)
  console.log(
    `\n  GATING (${AGGREGATOR_JOB}, the sole required status) — ${needs.length} in \`needs:\`, ${loop.size} read in the result loop.`,
  )
  // Clause (i)->(ii): a gate wired via its OWN job is only gating if ci-ok needs
  // that job. Checked for the jobs in THIS workflow that run a gate; gates in
  // other workflow files (e.g. check:stories in storybook.yml) have their own
  // aggregator and are out of scope here — stated rather than silently passed.
  const needsSet = new Set(needs)
  const ungatedJobs: string[] = []
  for (const jobId of jobIdsOf(aggYaml)) {
    if (jobId === AGGREGATOR_JOB || needsSet.has(jobId)) continue
    const body = runBodiesOf(jobBlockOf(aggYaml, jobId))
    const runsAGate = gates.some(
      (g) => body.includes(g) || scriptPathsOf(scripts[g]).some((p) => body.includes(p)),
    )
    if (runsAGate) ungatedJobs.push(jobId)
  }
  const problems = gatingProblems(aggBlock)
  for (const j of ungatedJobs) {
    problems.push(
      `${j}: runs a check:* gate but is NOT in ${AGGREGATOR_JOB}'s \`needs:\` — the gate runs, can go red, and the required status never sees it.`,
    )
  }
  if (problems.length) {
    console.error(`\n  NOT GATED — a job ${AGGREGATOR_JOB} does not READ cannot fail a PR:`)
    for (const p of problems) console.error(`    - ${p}`)
    console.error(
      `  "${AGGREGATOR_JOB}" is the sole required status on main. Being in \`needs:\` is being WAITED on, not GATED on.`,
    )
    process.exit(1)
  }
  console.log(`  Every \`needs:\` job is read in the result loop, bound to its own result. OK.`)

  // A fixture subprocess runs the reachability half ONLY and returns — it must
  // not recurse into the negative-fixture half that spawned it.
  if (NO_FIXTURES) {
    if (bad) process.exit(1)
    return
  }
  if (bad) process.exit(1)
  console.log('  All gates reachable except the known baseline debt. OK.')

  // ── NEGATIVE-FIXTURE HALF (executed and observed, ruling 1) ────────────────
  const { proven, passed, indiscriminate, ms } = proveNegativeFixtures(gates)
  const notYetProven: string[] = JSON.parse(
    readFileSync(join(REPO_ROOT, 'scripts/gate-fixture-baseline.json'), 'utf8'),
  ).notYetProven
  const nyp = new Set(notYetProven)
  // Every gate must be PROVEN this run or grandfathered into the ramp.
  const unaccounted = gates.filter((g) => !proven.has(g) && !nyp.has(g)).sort()
  // A gate now proven but still listed as debt: the shrink-only baseline is stale.
  const provenButBaselined = notYetProven.filter((g) => proven.has(g)).sort()

  console.log(
    `\n  NEGATIVE FIXTURE — executed ${proven.size} proof(s) in ${(ms / 1000).toFixed(1)}s; ${notYetProven.length} gate(s) not yet proven (shrink-only ramp debt).`,
  )
  if (ms > 120_000) {
    console.log(
      '  NOTE: executed-fixture wall-clock > 120s — split the execution half into its own always-on job and report the number to the orchestrator.',
    )
  }

  let badFix = false
  // Floor: if NOTHING was executed, the executed-and-observed invariant is
  // untested this run — the green-by-construction shape this half exists to
  // forbid. A meta-check that can silently observe nothing must fail, not pass.
  if (proven.size === 0) {
    badFix = true
    console.error('\n  NO negative-fixture proof executed — the mechanism is unverified this run.')
  }
  if (passed.length) {
    badFix = true
    console.error(
      '\n  NEGATIVE FIXTURE PASSED — the gate did NOT reject its own red input (it cannot go red):',
    )
    for (const g of passed) console.error(`    - ${g}`)
  }
  if (indiscriminate.length) {
    badFix = true
    console.error(
      '\n  FIXTURE RED **AND** GREEN CONTROL RED — the gate rejects everything, so its red proves nothing:',
    )
    for (const g of indiscriminate) console.error(`    - ${g}`)
  }
  if (unaccounted.length) {
    badFix = true
    console.error('\n  GATE WITH NO NEGATIVE-FIXTURE PROOF and not grandfathered:')
    for (const g of unaccounted) console.error(`    - ${g}`)
    console.error(
      '  Add an executed proof to NEGATIVE_FIXTURES — the not-yet-proven baseline is SHRINK-ONLY.',
    )
  }
  if (provenButBaselined.length) {
    badFix = true
    console.error(
      '\n  GATE NOW PROVEN but still in the not-yet-proven baseline — remove it (shrink-only):',
    )
    for (const g of provenButBaselined) console.error(`    - ${g}`)
  }

  if (badFix) process.exit(1)
  console.log('  All gates either proven or grandfathered into the shrink-only ramp. OK.')
}

main()
