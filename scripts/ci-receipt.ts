#!/usr/bin/env bun
/**
 * ci-receipt — is this commit's green ACTUALLY a receipt for a build that ran?
 *
 * A green aggregate `ci-ok` can certify a build that never ran. Four times in
 * one session a PR reported a green that proved nothing, and each time the only
 * defence was an agent remembering a prose rule. This promotes the rule to a
 * tool. See docs/lessons/ci-ok-green-can-certify-a-build-that-never-ran.md for
 * the four faces measured on real shas.
 *
 * THE THREE PREDICATES. A green is a receipt only when ONE workflow run
 * satisfies all three:
 *
 *   (1) `check` and `ci-ok` carry the SAME run id
 *   (2) that run's `check` concluded `success` — and `skipped` is NOT success
 *   (3) `ci-ok`'s started_at is strictly AFTER `check`'s completed_at
 *
 * Why per-run, and why not `gh pr checks`: the PR summary, `gh pr checks` and
 * `mergeStateStatus` all COLLAPSE every run on a sha into one row per context
 * name. When two runs raced on one sha — the common case, because a
 * draft→ready transition or a re-dispatch starts a second one — the collapsed
 * view can show `ci-ok success` sourced from a run whose `check` was SKIPPED,
 * while the run that actually compiled anything is still in progress. Those
 * views cannot express "which run posted this", so they cannot answer the
 * question. Only the per-run check-runs data can. A tool that agrees with
 * `gh pr checks` on every input is not a discriminator.
 *
 * This is a READ tool. It never writes, never re-runs, never touches
 * .github/workflows/plan-a.yml. `ci-ok` is the sole required context on main;
 * renaming or re-concluding it is out of scope here and probably everywhere.
 *
 * USAGE
 *   bun scripts/ci-receipt.ts <pr-number|full-sha> [options]
 *
 *     --repo <owner/name>  default aihu-project/aihu
 *     --at <iso-8601>      evaluate as of an instant: ignore check-runs that had
 *                          not COMPLETED by then. Reconstructs what the tool
 *                          would have said at the moment a stale receipt posted.
 *     --fixture <path>     read a check-runs payload from disk instead of the
 *                          API — for synthetic cases (ordering violations) that
 *                          no real sha may exhibit today.
 *     --json               machine-readable verdict on stdout.
 *
 * EXIT CODES
 *   0  TRUSTWORTHY — names the run id it trusted
 *   1  NOT TRUSTWORTHY, or REFUSED (no check-runs / no `ci-ok`): never pass
 *      vacuously — "nothing ran" is not "nothing failed"
 *   2  usage or API error
 */

const CHECK = 'check'
const CI_OK = 'ci-ok'
const DEFAULT_REPO = 'aihu-project/aihu'

interface CheckRun {
  readonly name: string
  readonly status: string
  readonly conclusion: string | null
  readonly started_at: string | null
  readonly completed_at: string | null
  readonly details_url: string | null
  readonly check_suite?: { readonly id?: number }
}

interface RunGroup {
  readonly runId: string
  readonly check: CheckRun | undefined
  readonly ciOk: CheckRun | undefined
  readonly others: ReadonlyArray<CheckRun>
}

type Judgement =
  | { readonly kind: 'trusted'; readonly runId: string; readonly why: string }
  | { readonly kind: 'rejected'; readonly runId: string; readonly why: string }

interface Options {
  readonly target: string
  readonly repo: string
  readonly at: string | undefined
  readonly fixture: string | undefined
  readonly json: boolean
}

function usage(message: string): never {
  process.stderr.write(`ci-receipt: ${message}\n\n`)
  process.stderr.write('usage: bun scripts/ci-receipt.ts <pr-number|full-sha> ')
  process.stderr.write('[--repo owner/name] [--at <iso>] [--fixture <path>] [--json]\n')
  process.exit(2)
}

function parseArgs(argv: ReadonlyArray<string>): Options {
  let target: string | undefined
  let repo = DEFAULT_REPO
  let at: string | undefined
  let fixture: string | undefined
  let json = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string
    const next = (): string => {
      const v = argv[i + 1]
      if (v === undefined) usage(`${arg} needs a value`)
      i++
      return v
    }
    if (arg === '--repo') repo = next()
    else if (arg === '--at') at = next()
    else if (arg === '--fixture') fixture = next()
    else if (arg === '--json') json = true
    else if (arg.startsWith('-')) usage(`unknown option ${arg}`)
    else if (target === undefined) target = arg
    else usage(`unexpected argument ${arg}`)
  }

  if (target === undefined) usage('need a PR number or a full commit sha')
  if (at !== undefined && Number.isNaN(Date.parse(at))) usage(`--at ${at} is not a valid timestamp`)
  return { target, repo, at, fixture, json }
}

/** Shell out to `gh`, returning stdout. Exits 2 on failure — never guesses. */
async function gh(args: ReadonlyArray<string>): Promise<string> {
  const proc = Bun.spawn(['gh', ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) {
    process.stderr.write(`ci-receipt: gh ${args.join(' ')} failed (exit ${code})\n${err}\n`)
    process.exit(2)
  }
  return out
}

/** Resolve a PR number to its head sha; pass a sha straight through. */
async function resolveSha(target: string, repo: string): Promise<string> {
  if (/^[0-9a-f]{40}$/i.test(target)) return target.toLowerCase()
  if (!/^\d+$/.test(target)) {
    usage(`'${target}' is neither a PR number nor a full 40-char sha`)
  }
  const out = await gh([
    'pr',
    'view',
    target,
    '--repo',
    repo,
    '--json',
    'headRefOid',
    '-q',
    '.headRefOid',
  ])
  const sha = out.trim()
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    process.stderr.write(`ci-receipt: PR #${target} gave no usable head sha\n`)
    process.exit(2)
  }
  return sha.toLowerCase()
}

/**
 * Accepts either NDJSON (one check-run object per line — what
 * `gh api --paginate --jq '.check_runs[]'` emits, and the only pagination-safe
 * shape: concatenated page OBJECTS cannot be split on braces without a parser)
 * or a whole `{ "check_runs": [...] }` document / bare array, which is the
 * convenient hand-written fixture shape.
 */
function parseCheckRuns(raw: string): CheckRun[] {
  const whole = raw.trim()
  if (whole === '') return []
  try {
    const parsed = JSON.parse(whole) as unknown
    if (Array.isArray(parsed)) return parsed as CheckRun[]
    const list = (parsed as { check_runs?: unknown }).check_runs
    if (Array.isArray(list)) return list as CheckRun[]
  } catch {
    // Not a single document — fall through to NDJSON.
  }
  const runs: CheckRun[] = []
  for (const line of whole.split('\n')) {
    const text = line.trim()
    if (text === '') continue
    try {
      runs.push(JSON.parse(text) as CheckRun)
    } catch (e) {
      process.stderr.write(`ci-receipt: could not parse check-runs payload: ${String(e)}\n`)
      process.exit(2)
    }
  }
  return runs
}

async function fetchCheckRuns(sha: string, repo: string, fixture?: string): Promise<CheckRun[]> {
  const raw = fixture
    ? await Bun.file(fixture).text()
    : await gh([
        'api',
        '--paginate',
        `repos/${repo}/commits/${sha}/check-runs?per_page=100`,
        '--jq',
        '.check_runs[]',
      ])
  return parseCheckRuns(raw)
}

/**
 * The workflow RUN id, which is what "same run" means. `details_url` is
 * `…/actions/runs/<runId>/job/<jobId>`. `check_suite.id` is a different
 * identifier and grouping by it would silently merge two runs of the same
 * workflow, so it is only a labelled fallback — never a silent one.
 */
function runIdOf(run: CheckRun): string {
  const m = run.details_url?.match(/\/actions\/runs\/(\d+)/)
  if (m?.[1]) return m[1]
  const suite = run.check_suite?.id
  return suite === undefined ? 'unknown' : `suite:${suite}`
}

/** Keep only runs that had already COMPLETED at `at` — the historical replay. */
function asOf(runs: ReadonlyArray<CheckRun>, at: string | undefined): CheckRun[] {
  if (at === undefined) return [...runs]
  const cutoff = Date.parse(at)
  return runs.filter(
    (r) =>
      r.status === 'completed' && r.completed_at !== null && Date.parse(r.completed_at) <= cutoff,
  )
}

function group(runs: ReadonlyArray<CheckRun>): RunGroup[] {
  const byRun = new Map<string, CheckRun[]>()
  for (const run of runs) {
    const id = runIdOf(run)
    const bucket = byRun.get(id)
    if (bucket) bucket.push(run)
    else byRun.set(id, [run])
  }
  // Newest-started first, so the run a human would look at leads the report.
  const latest = (list: ReadonlyArray<CheckRun>, name: string): CheckRun | undefined =>
    list
      .filter((r) => r.name === name)
      .sort((a, b) => Date.parse(b.started_at ?? '') - Date.parse(a.started_at ?? ''))[0]

  return [...byRun.entries()]
    .map(([runId, list]) => ({
      runId,
      check: latest(list, CHECK),
      ciOk: latest(list, CI_OK),
      others: list.filter((r) => r.name !== CHECK && r.name !== CI_OK),
    }))
    .sort((a, b) => Number(b.runId.replace(/\D/g, '')) - Number(a.runId.replace(/\D/g, '')))
}

/** Apply the three predicates to one run. Order matters only for the message. */
function judge(g: RunGroup): Judgement {
  const { runId, check, ciOk } = g
  // Predicate 1 — both contexts on the SAME run.
  if (!ciOk) return { kind: 'rejected', runId, why: `no ${CI_OK} on this run` }
  if (!check)
    return {
      kind: 'rejected',
      runId,
      why: `no ${CHECK} on this run — ${CI_OK} has no sibling to certify`,
    }

  // Predicate 2 — check really passed. `skipped` is the one that fools people:
  // it is a non-failure, and an aggregate that treats non-failure as success
  // posts green for a build that compiled nothing.
  if (check.status !== 'completed') {
    return { kind: 'rejected', runId, why: `${CHECK} is ${check.status}, not completed` }
  }
  if (check.conclusion !== 'success') {
    return {
      kind: 'rejected',
      runId,
      why: `${CHECK} concluded '${check.conclusion}' (not success)`,
    }
  }
  if (ciOk.status !== 'completed') {
    return { kind: 'rejected', runId, why: `${CI_OK} is ${ciOk.status}, not completed` }
  }
  if (ciOk.conclusion !== 'success') {
    return { kind: 'rejected', runId, why: `${CI_OK} concluded '${ciOk.conclusion}' (not success)` }
  }

  // Predicate 3 — ordering. Run-id equality alone is NOT enough: a ci-ok that
  // started before its own check finished cannot have observed the result.
  const checkEnd = check.completed_at === null ? Number.NaN : Date.parse(check.completed_at)
  const ciOkStart = ciOk.started_at === null ? Number.NaN : Date.parse(ciOk.started_at)
  if (Number.isNaN(checkEnd) || Number.isNaN(ciOkStart)) {
    return { kind: 'rejected', runId, why: 'missing timestamps — cannot establish ordering' }
  }
  if (ciOkStart <= checkEnd) {
    return {
      kind: 'rejected',
      runId,
      why: `${CI_OK} started ${ciOk.started_at} which is NOT after ${CHECK} finished ${check.completed_at} — it cannot have observed the result`,
    }
  }

  return {
    kind: 'trusted',
    runId,
    why: `${CHECK} success ${check.started_at} -> ${check.completed_at}; ${CI_OK} success started ${ciOk.started_at}, after it`,
  }
}

/**
 * `--selftest`: run the discriminator against synthetic check-runs covering
 * all four observed faces plus the controls that isolate each predicate.
 *
 * Offline and deterministic ON PURPOSE. Every one of these faces was found on a
 * real sha, but a sha is not a fixture: re-pushing a branch replaces its
 * check-runs, and #672's cancelled run had already vanished by the time this
 * was written. Pinning the shapes here is what keeps the four faces reproducible
 * after the evidence rots off the API.
 */
function selfTest(): never {
  const run = (
    id: string,
    name: string,
    status: string,
    conclusion: string | null,
    start: string,
    end: string,
  ) => ({
    name,
    status,
    conclusion,
    started_at: start,
    completed_at: end,
    details_url: `https://github.com/o/r/actions/runs/${id}/job/1`,
  })

  const cases: Array<{ name: string; runs: CheckRun[]; expect: 'TRUSTWORTHY' | 'NOT' }> = [
    {
      name: 'control: one clean run is a receipt',
      runs: [
        run('1', CHECK, 'completed', 'success', '02:00', '02:30'),
        run('1', CI_OK, 'completed', 'success', '02:31', '02:31'),
      ],
      expect: 'TRUSTWORTHY',
    },
    {
      name: 'face 1 stale-green: the only completed ci-ok belongs to a run whose check SKIPPED',
      runs: [
        run('2', CHECK, 'completed', 'skipped', '02:00', '02:00'),
        run('2', CI_OK, 'completed', 'success', '02:01', '02:01'),
      ],
      expect: 'NOT',
    },
    {
      name: 'face 2 green-beside-in_progress: ci-ok success while its check still runs',
      runs: [
        run('3', CHECK, 'in_progress', null, '02:00', ''),
        run('3', CI_OK, 'completed', 'success', '02:01', '02:01'),
      ],
      expect: 'NOT',
    },
    {
      name: 'face 3 red-because-cancelled: concurrency killed check, ci-ok failed closed',
      runs: [
        run('4', CHECK, 'completed', 'cancelled', '02:00', '02:10'),
        run('4', CI_OK, 'completed', 'failure', '02:11', '02:11'),
      ],
      expect: 'NOT',
    },
    {
      name: 'face 4 draft-gated: skipped-check run races a real one; only the real one counts',
      runs: [
        run('5', CHECK, 'completed', 'skipped', '02:00', '02:00'),
        run('5', CI_OK, 'completed', 'success', '02:01', '02:01'),
        run('6', CHECK, 'completed', 'success', '02:02', '02:40'),
        run('6', CI_OK, 'completed', 'success', '02:41', '02:41'),
      ],
      expect: 'TRUSTWORTHY',
    },
    {
      name: 'ordering: same run id, both success, but ci-ok started BEFORE check finished',
      runs: [
        run('7', CHECK, 'completed', 'success', '02:00', '02:30'),
        run('7', CI_OK, 'completed', 'success', '02:10', '02:10'),
      ],
      expect: 'NOT',
    },
    {
      name: 'cross-run: check green on one run, ci-ok green on another — never a pair',
      runs: [
        run('8', CHECK, 'completed', 'success', '02:00', '02:30'),
        run('9', CI_OK, 'completed', 'success', '02:31', '02:31'),
      ],
      expect: 'NOT',
    },
    {
      name: 'vacuous: check green but ci-ok absent entirely',
      runs: [run('10', CHECK, 'completed', 'success', '02:00', '02:30')],
      expect: 'NOT',
    },
    {
      name: 'vacuous: no check-runs at all',
      runs: [],
      expect: 'NOT',
    },
  ]

  let failed = 0
  for (const c of cases) {
    // Timestamps above are HH:MM shorthand; expand to the ISO the API returns.
    const runs = c.runs.map((r) => ({
      ...r,
      started_at: r.started_at ? `2026-07-28T${r.started_at}:00Z` : null,
      completed_at: r.completed_at ? `2026-07-28T${r.completed_at}:00Z` : null,
    }))
    const hasCiOk = runs.some((r) => r.name === CI_OK)
    const trusted =
      runs.length > 0 && hasCiOk
        ? group(runs)
            .map(judge)
            .find((j) => j.kind === 'trusted')
        : undefined
    const got = trusted ? 'TRUSTWORTHY' : 'NOT'
    const ok = got === c.expect
    if (!ok) failed++
    const detail = trusted ? ` (run ${trusted.runId})` : ''
    process.stdout.write(`  ${ok ? 'ok  ' : 'FAIL'}  ${c.name} -> ${got}${detail}\n`)
  }

  process.stdout.write(`\nci-receipt selftest: ${cases.length - failed}/${cases.length} passed\n`)
  process.exit(failed === 0 ? 0 : 1)
}

const main = async (): Promise<never> => {
  if (process.argv.includes('--selftest')) selfTest()
  const opts = parseArgs(process.argv.slice(2))
  const sha = opts.fixture ? opts.target : await resolveSha(opts.target, opts.repo)
  const all = await fetchCheckRuns(sha, opts.repo, opts.fixture)
  const visible = asOf(all, opts.at)

  const lines: string[] = []
  const say = (s = ''): void => {
    lines.push(s)
  }

  say(`ci-receipt: ${opts.repo} @ ${sha}`)
  if (opts.at) say(`  as of ${opts.at} (only check-runs completed by then are visible)`)
  if (opts.fixture) say(`  source: fixture ${opts.fixture}`)

  // REFUSE rather than pass vacuously. "No checks" is not "no failures".
  if (visible.length === 0) {
    say('')
    say('  REFUSED: no check-runs visible for this commit.')
    say('  Nothing ran is not the same as nothing failed.')
    process.stdout.write(`${lines.join('\n')}\n`)
    if (opts.json)
      process.stdout.write(
        `${JSON.stringify({ sha, verdict: 'REFUSED', reason: 'no check-runs' })}\n`,
      )
    process.exit(1)
  }
  if (!visible.some((r) => r.name === CI_OK)) {
    say('')
    say(`  REFUSED: no '${CI_OK}' check-run on this commit.`)
    say('  The required context never reported; there is no receipt to trust.')
    process.stdout.write(`${lines.join('\n')}\n`)
    if (opts.json)
      process.stdout.write(
        `${JSON.stringify({ sha, verdict: 'REFUSED', reason: `no ${CI_OK}` })}\n`,
      )
    process.exit(1)
  }

  const groups = group(visible)
  const judged = groups.map((g) => ({ g, j: judge(g) }))
  const trusted = judged.find(({ j }) => j.kind === 'trusted')

  say('')
  say(`  ${groups.length} workflow run(s) posted to this commit:`)
  for (const { g, j } of judged) {
    const mark = j.kind === 'trusted' ? 'TRUSTED' : 'ignored'
    say(`    [${mark}] run ${g.runId}: ${j.why}`)
  }

  // Make the scope of the claim explicit: contexts outside ci-ok are NOT
  // consulted. A red `matrix` or `bench` on another run does not make a real
  // receipt untrustworthy — those jobs sit outside the required context by
  // design, and conflating them is its own triage failure.
  const outside = [...new Set(judged.flatMap(({ g }) => g.others.map((o) => o.name)))].sort()
  if (outside.length > 0) {
    say('')
    say(`  not consulted (outside ${CI_OK}): ${outside.join(', ')}`)
  }

  say('')
  if (trusted) {
    say(`  TRUSTWORTHY — receipt from run ${trusted.j.runId}`)
  } else {
    say('  NOT TRUSTWORTHY — no run satisfies all three predicates:')
    say(`    (1) ${CHECK} and ${CI_OK} on the same run id`)
    say(`    (2) that run's ${CHECK} concluded success (skipped is not success)`)
    say(`    (3) ${CI_OK} started strictly after ${CHECK} finished`)
  }

  process.stdout.write(`${lines.join('\n')}\n`)
  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify({
        sha,
        verdict: trusted ? 'TRUSTWORTHY' : 'NOT_TRUSTWORTHY',
        trustedRunId: trusted?.j.runId ?? null,
        runs: judged.map(({ g, j }) => ({ runId: g.runId, verdict: j.kind, why: j.why })),
        notConsulted: outside,
      })}\n`,
    )
  }
  process.exit(trusted ? 0 : 1)
}

await main()
