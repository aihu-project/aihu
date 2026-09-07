#!/usr/bin/env bun
/**
 * Scaffold DX matrix — the end-to-end first-impression harness.
 *
 * `npm create aihu` is the first command a developer ever runs against this
 * project. Everything downstream of it (install → typecheck → build → dev
 * server → production preview) is the first-impression path, and until this
 * file existed none of it was covered past `bun run build` on bun alone:
 *
 *   - `scaffold-npm-e2e.ts`     bun only, stops at a `dist/` existence check,
 *                               never starts a server.
 *   - `scaffold-default-e2e.ts` in-process `scaffoldApp()` from local source.
 *
 * This harness runs the full grid instead:
 *
 *   package managers  bun | npm | pnpm | yarn
 *   scaffold paths    create-aihu templates  minimal | full | docs | agent | ssr
 *                     `aihu app --template`  cf-team  (resolved FROM npm)
 *
 * and every cell is driven all the way to a *serving HTTP server*: the dev
 * server and the production preview server must each answer 200 with a
 * non-empty HTML body before the cell is allowed to pass.
 *
 * ── Design rules this file is built around ──────────────────────────────────
 *
 *  1. Everything runs in a temp dir with NO aihu ancestor. `resolveTemplatePackagePath()`
 *     (packages/cli/src/bin.ts) falls back to walking up for
 *     `packages/templates/<short>` — run inside the monorepo, that fallback
 *     silently substitutes the workspace template and masks a broken npm
 *     publish entirely. `assertNoAihuAncestor()` refuses to start if the temp
 *     root is anywhere under a checkout.
 *  2. A hang is never a pass. Every command and every server wait is bounded
 *     by an explicit timeout, and readiness is established by *polling the HTTP
 *     endpoint until it answers*, never by sleeping. On timeout the server's
 *     captured stdout+stderr is printed.
 *  3. Ports are ephemeral and per-cell, and children are spawned into their own
 *     process group so the whole group can be killed on every path — success,
 *     failure, throw, and process-level SIGINT/SIGTERM.
 *  4. Assertions are on exit codes and response bodies. Nothing in this file
 *     decides pass/fail by grepping log text: a substring match against an
 *     error message reads as success, which is how a harness ends up green on
 *     a broken release.
 *  5. One cell's failure never aborts the matrix. Results are collected, the
 *     grid is printed, and the process exits non-zero if any cell failed.
 *  6. A step that cannot run is `skip` or `n/a` with a printed reason. It is
 *     never silently counted as a pass.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *   # published-npm mode (the default) — what a real user gets, today
 *   bun packages/cli/tests/scaffold-matrix-e2e.ts
 *   bun packages/cli/tests/scaffold-matrix-e2e.ts --version 1.0.1
 *
 *   # local-source mode — build packages/cli and drive its dist/ directly
 *   bun packages/cli/tests/scaffold-matrix-e2e.ts --mode local
 *
 *   # slice the grid
 *   bun packages/cli/tests/scaffold-matrix-e2e.ts --pm bun,npm --template minimal
 *   bun packages/cli/tests/scaffold-matrix-e2e.ts --keep     # leave temp dirs
 *
 *   # try a candidate fix WITHOUT editing the published scaffold: patch extra
 *   # dependencies into the emitted package.json before install. Cells run this
 *   # way are marked `*` in the grid and are NOT evidence the scaffold works.
 *   bun packages/cli/tests/scaffold-matrix-e2e.ts --extra-dep @aihu/store@0.1.1
 *
 *   # vite axis — one cell per version, each a FRESH install (see --vite below)
 *   bun packages/cli/tests/scaffold-matrix-e2e.ts --template minimal --pm bun --vite 6,8
 *
 *   # drive the `ssr` template all the way to a loaded, rendering Worker
 *   bun packages/cli/tests/scaffold-matrix-e2e.ts --template ssr --pm bun
 *
 *   # install workspace packages from `npm pack` tarballs instead of the
 *   # registry, to test an UNRELEASED fix consumer-shaped. Marked `†`.
 *   bun packages/cli/tests/scaffold-matrix-e2e.ts --local-pkg compiler,app
 */

import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Pm = 'bun' | 'npm' | 'pnpm' | 'yarn'
type Mode = 'npm' | 'local'
type StepStatus = 'pass' | 'fail' | 'skip' | 'n/a'

/** Which of the two genuinely different scaffold systems a template goes through. */
type ScaffoldKind =
  /** `create-aihu` — templates compiled INTO @aihu/cli, never fetched from npm. */
  | 'create'
  /** `aihu app --template <id>` — template package resolved FROM npm at @latest. */
  | 'app-template'

interface StepResult {
  readonly name: string
  readonly status: StepStatus
  readonly ms: number
  /** Populated for `fail` (full context) and for `skip`/`n/a` (the reason). */
  readonly detail?: string
}

interface CellResult {
  readonly template: string
  readonly pm: Pm
  /** Local package directories packed into this consumer-shaped cell. */
  readonly localPkgs: readonly string[]
  /** Label of the vite version this cell installed; `'tpl'` = whatever the template pins. */
  readonly vite: string
  readonly steps: StepResult[]
  status: 'pass' | 'fail' | 'skip'
  dir?: string
}

/**
 * One point on the vite axis.
 *
 * `range === null` means "leave the template's own pin alone" — the behaviour
 * every invocation had before the axis existed, and still the default.
 */
interface ViteReq {
  /** Short label for the grid column. */
  readonly label: string
  /** Semver range written into `devDependencies.vite`, or null to leave it. */
  readonly range: string | null
}

/**
 * Marks a row whose build emits a real Worker, and says where to find it.
 *
 * ## What this used to be
 *
 * Until the `ssr` CLI template existed, this interface described a POST-SCAFFOLD
 * PATCH: the harness scaffolded `minimal`, rewrote its `vite.config.ts` to add
 * `output: 'ssr'` + `css.shadowMode` + the Cloudflare adapter, and injected
 * `@aihu/adapter-cloudflare` into the manifest before install. That was a
 * deliberate stopgap — the gate needed a consumer-shaped SSR tree and designing
 * the SSR scaffold as a side effect of building a CI gate was the wrong order —
 * and its own docblock promised it would be deleted "the day a real `ssr`
 * template lands, at which point this becomes `{ id: 'ssr', kind: 'create' }`
 * and the patch goes away".
 *
 * That day is this commit. The patch, the `ssr-config` step and the `deps`
 * field are gone; what remains is the two paths the driver needs, because
 * NOTHING here should be re-deriving what the template already decides.
 */
interface SsrSpec {
  /** Built Worker, relative to the workdir. */
  readonly worker: string
  /** Client outDir the ASSETS binding is pointed at, relative to the workdir. */
  readonly clientDist: string
}

/** How a template is scaffolded and how its servers are driven. */
interface TemplateSpec {
  readonly id: string
  readonly kind: ScaffoldKind
  /** For `app-template`: the short id passed to `aihu app --template <id>`. */
  readonly templateArg?: string
  /** Present ⇒ this row's build emits a Worker, and it is driven as one. */
  readonly ssr?: SsrSpec
  /** Directory (relative to the project root) whose package.json owns the scripts. */
  readonly workdir: string
  /** Script names; `null` means the template does not ship that script. */
  readonly typecheckScript: string | null
  readonly buildScript: string | null
  readonly devScript: string | null
  readonly previewScript: string | null
  /**
   * `'flag'`  — the port can be threaded through as `-- --port N --strictPort`.
   * `number`  — the template HARDCODES this port; cells cannot be parallelised
   *             and repeated runs collide. Recorded as a finding, not hidden.
   * `null`    — no controllable port.
   */
  readonly devPort: 'flag' | number | null
  readonly previewPort: 'flag' | number | null
  /**
   * Where the `vite` dependency ITSELF is declared, if that differs from
   * `workdir`. Defaults to `workdir` when unset. Needed for a moon/npm
   * workspace scaffold whose scripts run from the root (`workdir: '.'`) but
   * whose `vite` range is pinned inside a nested workspace member — `cf-team`
   * pins `vite: ^6.0.0` in `apps/web/package.json.tmpl`, and the root manifest
   * has no `vite` entry at all. Patching `workdir`'s manifest for the `--vite`
   * axis there would ADD an unrelated root-level devDependency that no script
   * reads, while `apps/web`'s own pin — the one that actually constrains what
   * gets installed and built — stays untouched. The axis would report "vite 8"
   * and silently build against vite 6.
   */
  readonly viteWorkdir?: string
  /** PMs whose server phases cannot run; value is the reason printed as `n/a`. */
  readonly serverOnlyOnPm?: { readonly pms: readonly Pm[]; readonly reason: string }
  /** Extra flags appended to the scaffold command. */
  readonly extraScaffoldArgs?: readonly string[]
  /**
   * External binaries this template's own scripts shell out to. If one is not
   * on PATH the whole cell is SKIPPED, not failed.
   *
   * A cell that cannot run is not a cell that failed. The harness already knew
   * cf-team needs `moon` — it said so in `notes` — but the gate did not act on
   * what it knew, so every run went red for a missing tool and the check became
   * a permanently-red X that gated nothing. That trains people to scroll past
   * failing checks, which is worse than either a green gate or no gate.
   *
   * Same treatment missing package managers already get: reported loudly as
   * NOT tested and NOT passing, never silently counted as a pass.
   */
  readonly requiresBin?: readonly string[]
  readonly notes?: string
}

// ---------------------------------------------------------------------------
// Template registry
// ---------------------------------------------------------------------------

const VITE_APP = {
  workdir: '.',
  typecheckScript: 'typecheck',
  buildScript: 'build',
  devScript: 'dev',
  previewScript: 'preview',
  devPort: 'flag',
  previewPort: 'flag',
} as const

const TEMPLATES: readonly TemplateSpec[] = [
  { id: 'minimal', kind: 'create', ...VITE_APP },
  {
    // The real `ssr` CLI template — `output: 'ssr'` + `css.shadowMode: 'light'`
    // + the Cloudflare adapter, all three baked into the scaffold's own
    // vite.config.ts rather than patched in here.
    //
    // NOT in scaffold-matrix.yml's default `--template` list, and the reason is
    // unchanged by the template becoming real: `output: 'ssr'` is not in a
    // PUBLISHED `@aihu/app` yet, so against the registry this row fails at
    // `build` with "unknown output". That is the truthful result, not a harness
    // defect. It is exercised on every PR through `--local-pkg` tarballs of this
    // branch's own packages (plan-a.yml's `scaffold-consistency` job), which is
    // where it can actually pass, and it joins the default list the release
    // after `@aihu/app` ships the option.
    id: 'ssr',
    kind: 'create',
    ...VITE_APP,
    // The template emits no `preview` script, deliberately: `vite preview`
    // serves the CLIENT outDir as static files, so under `output: 'ssr'` it
    // would report 200 on a page the Worker never rendered — a green step for
    // the wrong artifact. The `worker` step below is what replaces it.
    previewScript: null,
    previewPort: null,
    ssr: {
      worker: 'dist-server/_worker.js',
      clientDist: 'dist',
    },
    notes: 'the only template that emits a Worker; driven in-process, not through vite preview',
  },
  { id: 'full', kind: 'create', ...VITE_APP },
  { id: 'docs', kind: 'create', ...VITE_APP },
  {
    id: 'agent',
    kind: 'create',
    ...VITE_APP,
    // `dev` is `concurrently "bun run server" "vite --port 5108"`. Trailing args
    // land on concurrently, not on vite, so the port is NOT threadable — and the
    // bridge server hardcodes 5208 in vite.config.ts on top of that.
    devPort: 5108,
    // `bun run server` inside the dev script makes the dev phase bun-only no
    // matter which PM the user scaffolded with.
    serverOnlyOnPm: {
      pms: ['bun'],
      reason: 'dev script shells out to `bun server.ts`; requires bun on PATH regardless of --pm',
    },
    notes: 'hardcodes vite:5108 + bridge:5208 — cells cannot run in parallel',
  },
  {
    id: 'cf-team',
    kind: 'app-template',
    templateArg: 'cf-team',
    workdir: '.',
    // The root manifest has no `vite` entry at all — the real pin is nested.
    // See `viteWorkdir`'s docblock.
    viteWorkdir: 'apps/web',
    typecheckScript: 'typecheck',
    buildScript: 'build',
    devScript: 'dev',
    previewScript: null,
    // Root `dev` is `moon run apps/web:dev`; nothing threads a port through moon.
    devPort: null,
    previewPort: null,
    serverOnlyOnPm: {
      pms: ['bun'],
      reason: 'template declares engines.bun and its scripts shell out to `bun run vite` via moon',
    },
    requiresBin: ['moon'],
    notes: 'bun-workspaces + moon monorepo; requires `moon` on PATH',
  },
]

/** True when `bin` resolves on PATH. Used to skip, never to silently pass. */
function binExists(bin: string): boolean {
  return spawnSync(bin, ['--version'], { stdio: 'ignore', shell: false }).status === 0
}

const ALL_PMS: readonly Pm[] = ['bun', 'npm', 'pnpm', 'yarn']

// ---------------------------------------------------------------------------
// Argv
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)

function flagValue(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  if (i !== -1) return argv[i + 1]
  const eq = argv.find((a) => a.startsWith(`--${name}=`))
  return eq?.slice(name.length + 3)
}
const mode: Mode = (flagValue('mode') as Mode) ?? 'npm'
const version = flagValue('version') ?? 'latest'
const keepDirs = argv.includes('--keep')
const cmdTimeoutMs = Number(flagValue('cmd-timeout') ?? 300_000)
const serverTimeoutMs = Number(flagValue('server-timeout') ?? 120_000)

/**
 * Dependencies patched into the emitted package.json before install, for
 * evaluating a candidate fix against the real published scaffold. Cells run
 * with this set are flagged `*` in the grid — they prove a fix would work, not
 * that the shipped scaffold works.
 */
const extraDeps = (
  flagValue('extra-dep')
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) ?? []
).map((spec) => {
  const at = spec.lastIndexOf('@')
  if (at <= 0) throw new Error(`--extra-dep expects name@version, got ${JSON.stringify(spec)}`)
  return [spec.slice(0, at), spec.slice(at + 1)] as const
})

/**
 * THE VITE AXIS.
 *
 * `--vite 6,8` runs each selected cell once per version. Omitted, the axis is a
 * single point that changes nothing — the template's own pin — so every
 * pre-existing invocation behaves exactly as before.
 *
 * Why an axis at all, and why it must be a FRESH install: `vite build` broke on
 * a fresh `^8` scaffold and worked on every tree anyone tested it in, because
 * vite 8 made esbuild an optional peer while still exporting
 * `transformWithEsbuild`. `bun add -d vite@8` on top of an installed scaffold
 * keeps esbuild resolvable and passes; only an install that never had vite 6 in
 * it reproduces. So the override is written into package.json BEFORE install and
 * the tree is wiped first — an incremental upgrade is not a weaker version of
 * this test, it is a test of something else.
 *
 * Accepted forms: a bare major (`8` → `^8.0.0`), or any literal npm range
 * (`8.2.1`, `^6 || ^8`, `latest`) passed through verbatim.
 */
const TEMPLATE_PINNED: ViteReq = { label: 'tpl', range: null }

function parseViteReq(raw: string): ViteReq {
  const s = raw.trim()
  if (s === '') throw new Error('--vite got an empty entry')
  return /^\d+$/.test(s) ? { label: s, range: `^${s}.0.0` } : { label: s, range: s }
}

const viteAxis: readonly ViteReq[] = (() => {
  const raw = flagValue('vite')
  if (raw === undefined) return [TEMPLATE_PINNED]
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) {
    process.stderr.write('--vite matched nothing; try --vite 6,8\n')
    process.exit(2)
  }
  return parts.map(parseViteReq)
})()

/**
 * Workspace packages to install from `npm pack` tarballs instead of the
 * registry (`--local-pkg compiler,app`). Short directory names under
 * `packages/`.
 *
 * A TARBALL, not `file:` on the directory and not a symlink, and the difference
 * is the whole point. A linked package resolves its own imports from its
 * REALPATH — so a linked `@aihu/compiler` would `import('vite')` out of the
 * monorepo's node_modules and see the repo's vite (and the repo's resolvable
 * esbuild) instead of the scaffold's. That is exactly the tree shape the vite-8
 * defect hid inside for months. An extracted tarball resolves from the
 * scaffold's own tree, like a published package.
 *
 * Cells run this way are marked `†`: they show what a RELEASE would do, not what
 * the currently published packages do.
 */
/**
 * `--local-pkg all` — every non-private `@aihu/*` / `@aihu-plugin/*` package
 * under `packages/`, discovered from disk.
 *
 * The hand-written list this replaces drifted, and the drift was invisible
 * until a release: the two CI jobs passed `app,router,server,adapter-cloudflare,
 * compiler,runtime,arbor,signals,agent,agent-service,plugin,context` — 12 of the
 * 36 packages a scaffold can declare. Every omitted package kept resolving from
 * the REGISTRY, which is fine right up until `changeset version` moves it past
 * what is published. Then the Version PR, and only the Version PR, fails on
 * `No version matching "^2.3.0" found for @aihu-plugin/agent-readiness` — a
 * package nobody thought to list because nothing pointed at it.
 *
 * Same disease as `publish-all.sh`'s hand-ordered `PKGS` array, which needed
 * nine separate `fix(release):` commits for packages that were simply never
 * added. Derive it instead: add a package and it is covered.
 *
 * Discovery matches `scripts/sync-template-versions.ts`'s rule exactly (that is
 * the generator deciding which versions land in the scaffold in the first
 * place), so the two cannot disagree about what a scaffold depends on.
 */
function discoverAllLocalPkgs(): string[] {
  const pkgsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages')
  const out: string[] = []
  for (const entry of readdirSync(pkgsDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue
    const manifest = join(pkgsDir, entry.name, 'package.json')
    if (!existsSync(manifest)) continue
    try {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
        name?: string
        version?: string
        private?: boolean
      }
      if (pkg.private === true || !pkg.name || !pkg.version) continue
      if (!pkg.name.startsWith('@aihu/') && !pkg.name.startsWith('@aihu-plugin/')) continue
      out.push(entry.name)
    } catch {
      // Unparseable manifest: skip, same as the generator does.
    }
  }
  return out
}

const localPkgsRaw = (
  flagValue('local-pkg')
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) ?? []
).map((s) => s.replace(/^@aihu(-plugin)?\//, ''))

const localPkgs =
  localPkgsRaw.length === 1 && localPkgsRaw[0] === 'all' ? discoverAllLocalPkgs() : localPkgsRaw

const requestedAllLocalPkgs = localPkgsRaw.length === 1 && localPkgsRaw[0] === 'all'

/**
 * A workspace scaffold only needs tarballs for the packages its app actually
 * consumes.  Feeding Bun every publishable package as a root override makes
 * its workspace resolver spin indefinitely, while testing unrelated packages
 * in that cell adds no release evidence.  The other template rows still use
 * the full `--local-pkg all` set.
 */
const CF_TEAM_LOCAL_PKGS = [
  'adapter-cloudflare',
  'app',
  'arbor',
  'compiler',
  'plugin-agent-readiness',
  'router',
  'runtime',
  'server',
  'signals',
] as const

function localPkgsForCell(spec: TemplateSpec): readonly string[] {
  if (!requestedAllLocalPkgs || spec.id !== 'cf-team') return localPkgs
  const wanted = new Set(CF_TEAM_LOCAL_PKGS)
  return localPkgs.filter((pkg) => wanted.has(pkg as (typeof CF_TEAM_LOCAL_PKGS)[number]))
}

const wantPms = (flagValue('pm')
  ?.split(',')
  .map((s) => s.trim()) ?? ALL_PMS) as Pm[]
const wantTemplates = flagValue('template')
  ?.split(',')
  .map((s) => s.trim())
// A bare invocation (no `--template`) must NOT run every row in the registry.
// `ssr` fails against the published registry by design (`output: 'ssr'` is not
// in a published @aihu/app yet — see its own comment) and is meant to be
// opt-in, but `TEMPLATES` is the full registry, so falling back to it silently
// ran the SSR row on every `bun run test:scaffold-matrix` and every bare local
// invocation. `DEFAULT_TEMPLATES` is what a caller gets with no `--template`; a
// row that is not ready to run unattended must be excluded here, not just left
// out of scaffold-matrix.yml's own explicit list. Delete this filter the
// release after `@aihu/app` publishes `output: 'ssr'`.
const DEFAULT_TEMPLATES = TEMPLATES.filter((t) => t.id !== 'ssr')
const templates = wantTemplates
  ? TEMPLATES.filter((t) => wantTemplates.includes(t.id))
  : DEFAULT_TEMPLATES

if (mode !== 'npm' && mode !== 'local') {
  process.stderr.write(`--mode must be 'npm' or 'local', got ${JSON.stringify(mode)}\n`)
  process.exit(2)
}
if (templates.length === 0) {
  process.stderr.write(
    `--template matched nothing; known: ${TEMPLATES.map((t) => t.id).join(', ')}\n`,
  )
  process.exit(2)
}

// ---------------------------------------------------------------------------
// Output helpers (mirrors the step()/run() idiom in scaffold-npm-e2e.ts)
// ---------------------------------------------------------------------------

const out = (s: string): void => void process.stdout.write(s)
const bold = (s: string): string => `[1m${s}[0m`
const dim = (s: string): string => `[2m${s}[0m`

/** Raised by a step so the cell runner can record it without aborting the matrix. */
class StepError extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message)
  }
}

interface RunResult {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

/**
 * Run a command to completion. Fails on a non-zero exit code — never on a
 * substring of the log — and folds the full command, exit code, stdout and
 * stderr into the error so a failing cell prints something actionable.
 */
function run(
  label: string,
  cmd: string,
  args: string[],
  cwd: string,
  timeout = cmdTimeoutMs,
): RunResult {
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: 'pipe',
    encoding: 'utf8',
    shell: false,
    timeout,
    env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
  })
  const timedOut = res.signal === 'SIGTERM' && res.error !== undefined
  const result: RunResult = {
    status: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    timedOut,
  }
  if (res.error && !timedOut) {
    throw new StepError(
      `${label}: could not spawn`,
      describe(cmd, args, cwd, null, result.stdout, `${res.error.message}\n${result.stderr}`),
    )
  }
  if (timedOut) {
    throw new StepError(
      `${label}: timed out after ${timeout}ms`,
      describe(cmd, args, cwd, null, result.stdout, result.stderr),
    )
  }
  if (res.status !== 0) {
    throw new StepError(
      `${label}: exit ${res.status}`,
      describe(cmd, args, cwd, res.status, result.stdout, result.stderr),
    )
  }
  return result
}

function describe(
  cmd: string,
  args: string[],
  cwd: string,
  status: number | null,
  stdout: string,
  stderr: string,
  url?: string,
): string {
  return [
    `command : ${cmd} ${args.join(' ')}`,
    `cwd     : ${cwd}`,
    ...(url ? [`url     : ${url}`] : []),
    `exit    : ${status ?? '(none)'}`,
    `--- stdout ---`,
    tail(stdout),
    `--- stderr ---`,
    tail(stderr),
  ].join('\n')
}

/** Keep failure dumps readable: last N lines, which is where the error lives. */
function tail(s: string, lines = 40): string {
  const t = s.trimEnd()
  if (t === '') return '(empty)'
  const split = t.split('\n')
  return split.length <= lines
    ? t
    : `… (${split.length - lines} earlier lines elided)\n${split.slice(-lines).join('\n')}`
}

// ---------------------------------------------------------------------------
// Requirement 1 — the temp root must have no aihu ancestor
// ---------------------------------------------------------------------------

/**
 * Refuse to run anywhere under an aihu checkout.
 *
 * Inside the monorepo, `aihu app --template cf-team` resolves the template from
 * `packages/templates/cf-team` on disk instead of npm, so a template that was
 * never published — or published broken — still scaffolds perfectly. Every
 * result produced from such a directory is worthless.
 */
function assertNoAihuAncestor(startDir: string): void {
  let dir = resolve(startDir)
  for (;;) {
    if (existsSync(join(dir, 'packages', 'templates'))) {
      throw new Error(
        `refusing to run: ${startDir} is under an aihu-shaped checkout at ${dir} ` +
          `(packages/templates/ found). The CLI's workspace fallback would mask a broken publish.`,
      )
    }
    const pkgPath = join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string }
        if (pkg.name === 'aihu' || pkg.name?.startsWith('@aihu/')) {
          throw new Error(
            `refusing to run: ${startDir} is under an aihu package at ${dir} (name=${pkg.name}).`,
          )
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('refusing to run')) throw e
        // Unparseable package.json is not our problem — keep walking.
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return
    dir = parent
  }
}

// ---------------------------------------------------------------------------
// Package-manager detection
// ---------------------------------------------------------------------------

interface PmInfo {
  readonly pm: Pm
  readonly available: boolean
  readonly version: string
  readonly major: number
}

function probePm(pm: Pm): PmInfo {
  const r = spawnSync(pm, ['--version'], {
    stdio: 'pipe',
    encoding: 'utf8',
    shell: false,
    timeout: 30_000,
  })
  if (r.status !== 0 || r.error) return { pm, available: false, version: '', major: 0 }
  const version = (r.stdout ?? '').trim()
  return { pm, available: true, version, major: Number.parseInt(version.split('.')[0] ?? '0', 10) }
}

/**
 * `<pm> run <script> -- <extra>`, with yarn's and pnpm's arg-forwarding
 * differences honoured: neither strips a literal `--` before forwarding it
 * to the script the way npm/bun do — pnpm forwards it as a literal `"--"`
 * argv token (so the child sees `vite -- --port N`, which vite/cac parses as
 * end-of-flags, silently ignoring the port), and yarn classic has the same
 * issue in the other direction. Both need `extra` appended with no `--`.
 */
function pmRunArgs(pm: Pm, script: string, extra: readonly string[] = []): string[] {
  if (pm === 'yarn' || pm === 'pnpm') return ['run', script, ...extra]
  return extra.length > 0 ? ['run', script, '--', ...extra] : ['run', script]
}

function pmInstallArgs(pm: Pm): string[] {
  switch (pm) {
    case 'npm':
      return ['install', '--no-audit', '--no-fund']
    case 'pnpm':
      return ['install', '--no-frozen-lockfile']
    case 'yarn':
      return ['install']
    case 'bun':
      return ['install']
  }
}

// ---------------------------------------------------------------------------
// Ephemeral ports + server lifecycle
// ---------------------------------------------------------------------------

/**
 * Ask the kernel for a free port, then release it. There is an unavoidable
 * window between release and re-bind; every server is therefore started with
 * `--strictPort` so losing that race is a loud bind failure rather than a
 * server quietly listening somewhere we are not probing.
 */
async function ephemeralPort(): Promise<number> {
  return await new Promise((res, rej) => {
    const srv = createServer()
    srv.once('error', rej)
    // Bind dual-stack (no host) rather than 127.0.0.1: vite serves on IPv6
    // `[::1]` by default, so an IPv4-only reservation can hand back a port that
    // is already taken on the interface the server will actually use.
    srv.listen(0, () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => (port === 0 ? rej(new Error('could not allocate port')) : res(port)))
    })
  })
}

/** Every server spawned by this process, so no path can leak one. */
const liveChildren = new Set<ChildProcess>()

/** Kill the child's whole process group. Vite spawns workers; killing the pid alone orphans them. */
function killTree(child: ChildProcess): void {
  liveChildren.delete(child)
  if (child.pid === undefined || child.exitCode !== null) return
  for (const sig of ['SIGTERM', 'SIGKILL'] as const) {
    try {
      process.kill(-child.pid, sig)
    } catch {
      try {
        child.kill(sig)
      } catch {
        /* already gone */
      }
    }
    if (sig === 'SIGTERM' && child.exitCode !== null) return
  }
}

function killAllChildren(): void {
  for (const c of [...liveChildren]) killTree(c)
}
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    killAllChildren()
    process.exit(130)
  })
}
process.on('exit', killAllChildren)

interface ProbeOk {
  readonly url: string
  readonly bodyBytes: number
  readonly contentType: string
}

/**
 * Start a server, poll it until it actually answers, and assert on the RESPONSE
 * — status code, content type, body — not on anything the process logged.
 *
 * Always tears the process group down, including when the assertion throws.
 */
async function serveAndProbe(
  label: string,
  cmd: string,
  args: string[],
  cwd: string,
  port: number,
): Promise<ProbeOk> {
  // Vite's default host is `localhost`, which it binds as IPv6 `[::1]` only —
  // probing `127.0.0.1` alone times out against a server that is up and healthy
  // and reports it as a failure. Try every loopback spelling before concluding
  // anything, and report the one that answered.
  const urls = [`http://127.0.0.1:${port}/`, `http://[::1]:${port}/`, `http://localhost:${port}/`]
  const url = urls.join(' | ')
  let stdout = ''
  let stderr = ''

  const child = spawn(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    detached: true, // own process group → killTree can take the whole tree down
    env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0', BROWSER: 'none' },
  })
  liveChildren.add(child)
  child.stdout?.on('data', (c: Buffer) => {
    stdout += c.toString()
  })
  child.stderr?.on('data', (c: Buffer) => {
    stderr += c.toString()
  })

  let exited: { code: number | null; signal: string | null } | undefined
  child.on('exit', (code, signal) => {
    exited = { code, signal }
  })

  const fail = (why: string): never => {
    throw new StepError(
      `${label}: ${why}`,
      describe(cmd, args, cwd, exited?.code ?? null, stdout, stderr, url),
    )
  }

  try {
    const deadline = Date.now() + serverTimeoutMs
    let lastErr = 'never attempted'

    for (;;) {
      // The server dying is terminal — do not keep polling a corpse until the
      // timeout, that turns a crash into an indistinguishable "hang".
      if (exited !== undefined) {
        fail(`server exited (code=${exited.code}, signal=${exited.signal}) before answering ${url}`)
      }
      if (Date.now() > deadline) {
        fail(`server did not answer ${url} within ${serverTimeoutMs}ms (last error: ${lastErr})`)
      }

      let connected = false
      for (const candidate of urls) {
        let res: Response
        let body: string
        try {
          res = await fetch(candidate, {
            signal: AbortSignal.timeout(5_000),
            headers: { accept: 'text/html' },
          })
          body = await res.text()
        } catch (e) {
          lastErr = `${candidate}: ${(e as Error).message}`
          continue // this loopback spelling is not up (yet); try the next
        }

        // Connected. From here every check is an assertion on the RESPONSE —
        // status, content-type, body — and a violation is terminal, not a retry.
        connected = true
        if (res.status !== 200) fail(`${candidate} answered HTTP ${res.status} (expected 200)`)
        if (body.trim().length === 0) fail(`${candidate} answered 200 with an EMPTY body`)
        const contentType = res.headers.get('content-type') ?? ''
        if (!/text\/html/i.test(contentType)) {
          fail(
            `${candidate} answered 200 but content-type is ${JSON.stringify(contentType)}, not text/html`,
          )
        }
        if (!/<(!doctype|html|body|div|script)\b/i.test(body)) {
          fail(
            `${candidate} answered 200 text/html but the body is not HTML:\n${body.slice(0, 400)}`,
          )
        }
        return { url: candidate, bodyBytes: Buffer.byteLength(body), contentType }
      }
      if (!connected) await new Promise((r) => setTimeout(r, 400))
    }
  } finally {
    killTree(child)
  }
}

// ---------------------------------------------------------------------------
// Scaffold command construction — the two different entry paths
// ---------------------------------------------------------------------------

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const localCreateJs = join(repoRoot, 'packages', 'cli', 'dist', 'create.js')
const localBinJs = join(repoRoot, 'packages', 'cli', 'dist', 'bin.js')

// ---------------------------------------------------------------------------
// --local-pkg — workspace packages as tarballs
// ---------------------------------------------------------------------------

interface LocalTarball {
  readonly spec: string
  /**
   * Names of the package's `optionalDependencies` — its sibling platform
   * artifacts. An override loses them, so they are re-declared on the scaffold;
   * see the comment in the install step.
   */
  readonly optionalDeps: readonly string[]
}

/** Package name → packed tarball, built once and reused by every cell. */
const localPkgSpecs = new Map<string, ReadonlyMap<string, LocalTarball>>()

/**
 * Build and pack each `--local-pkg`, returning name → `file:<tgz>`.
 *
 * ## `bun pm pack`, NOT `npm pack`
 *
 * Every workspace package here expresses its intra-repo edges as
 * `"@aihu/router": "workspace:*"`. `npm pack` copies that string into the
 * tarball verbatim, so installing it fails at resolution —
 * `error: @aihu/signals@workspace:^ failed to resolve` — because there is no
 * workspace to resolve against outside the monorepo. `bun pm pack` performs the
 * same substitution a publish does (`workspace:*` → `0.5.0`), which is the
 * whole point: the tarball has to be shaped like the thing that would go to the
 * registry, or it is not testing a release.
 *
 * ## The build is unconditional
 *
 * Packing runs no build of its own, so it ships whatever `dist/` happens to be
 * on disk — and a stale `dist/` makes the whole run validate the PREVIOUS
 * release while reporting green. That failure mode is silent, which is the only
 * reason paying for the build every time is the right trade.
 */
function packLocalPkgs(
  destRoot: string,
  packages: readonly string[],
): ReadonlyMap<string, LocalTarball> {
  const cacheKey = packages.join(',')
  const cached = localPkgSpecs.get(cacheKey)
  if (cached) return cached
  const specs = new Map<string, LocalTarball>()
  for (const short of packages) {
    const pkgDir = join(repoRoot, 'packages', short)
    const manifestPath = join(pkgDir, 'package.json')
    if (!existsSync(manifestPath)) {
      throw new Error(`--local-pkg ${short}: no such package at ${pkgDir}`)
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name: string
      scripts?: Record<string, string>
      optionalDependencies?: Record<string, string>
    }
    const name = manifest.name
    const optionalDeps = Object.keys(manifest.optionalDependencies ?? {})
    // Not every publishable package builds. `@aihu/ui` ships `registry/**`
    // `.aihu` sources plus a generated index and emits no dist at all, so
    // `bun run build` there is `Script not found "build"` — an unconditional
    // build was fine while the package list was hand-picked to buildable ones,
    // and breaks the moment the list is derived. Absence of the script is a
    // legitimate package shape, not a failure; a build that EXISTS and fails
    // still fails loudly, which is the case the surrounding docblock is about.
    if (manifest.scripts?.build !== undefined) {
      out(`  ${dim(`building + packing ${name}…`)}\n`)
      run(`build ${name}`, 'bun', ['run', 'build'], pkgDir)
    } else {
      out(`  ${dim(`packing ${name}… (no build script)`)}\n`)
    }
    // One destination directory per package, so the tarball is READ back rather
    // than derived from a filename convention that only holds until it doesn't.
    const dest = join(destRoot, short)
    mkdirSync(dest, { recursive: true })
    run('pack', 'bun', ['pm', 'pack', '--destination', dest], pkgDir)
    const files = readdirSync(dest).filter((f) => f.endsWith('.tgz'))
    if (files.length !== 1) {
      throw new Error(`packing ${name} produced ${files.length} tarballs in ${dest}: ${files}`)
    }
    specs.set(name, { spec: `file:${join(dest, files[0]!)}`, optionalDeps })
  }
  localPkgSpecs.set(cacheKey, specs)
  return specs
}

/**
 * The in-process Worker driver, written into the scaffold and run under `node`.
 *
 * ## Why this exists rather than another HTTP probe
 *
 * Every other server step in this file starts a dev/preview server and asserts
 * on its response. That model could not have caught the defect this step is
 * here for: the SSR deadlock lived in the BUILT `_worker.js`, which no vite dev
 * server ever loads. `vite build` was green, `vite preview` was green, and the
 * artifact that would be deployed could not be imported at all.
 *
 * ## Why not wrangler/workerd
 *
 * Same reasoning as `packages/app/tests/workers-ssr-e2e.test.ts`, which this is
 * the consumer-shaped sibling of: the Worker is a standard ES module exporting
 * `{ fetch }`, so importing it and calling `fetch` with a stubbed ASSETS
 * exercises everything but workerd's own module resolution, at a fraction of
 * the cold-start cost a matrix cell can afford.
 *
 * ## Why the import is bounded
 *
 * A module-scope top-level await inside a chunk cycle does not throw — it
 * HANGS. An unbounded `await import()` would turn a broken Worker into a job
 * someone cancels an hour later, and a cancelled job is not a red test.
 */
function workerDriverSource(): string {
  return `// Generated by packages/cli/tests/scaffold-matrix-e2e.ts. Not part of the scaffold.
import { pathToFileURL } from 'node:url'

const worker = process.argv[2]
const url = process.argv[3] ?? 'https://matrix.test/'
const IMPORT_TIMEOUT_MS = 20000

const emit = (o) => { process.stdout.write('AIHU_PROBE:' + JSON.stringify(o) + '\\n') }

let timer
const mod = await Promise.race([
  import(pathToFileURL(worker).href),
  new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(
      'DEADLOCK: importing ' + worker + ' did not settle within ' + IMPORT_TIMEOUT_MS + 'ms. ' +
      'The built Worker cannot be loaded — every request to it would hang in production, ' +
      'even though the build was green. Almost certainly a module-scope top-level await in ' +
      'virtual:aihu-server-entry.'
    )), IMPORT_TIMEOUT_MS)
  }),
])
clearTimeout(timer)

const fetchFn = mod.default && mod.default.fetch
if (typeof fetchFn !== 'function') {
  throw new Error(worker + ' has no default export with a fetch method; exports: ' + Object.keys(mod).join(', '))
}

const assetsHits = []
const env = {
  ASSETS: {
    fetch: async (req) => {
      const p = new URL(req.url).pathname
      assetsHits.push(p)
      return new Response('ASSETS-STUB:' + p, { status: 200 })
    },
  },
}

const res = await fetchFn(new Request(url), env, {})
const body = await res.text()
emit({
  status: res.status,
  contentType: res.headers.get('content-type'),
  bodyBytes: Buffer.byteLength(body),
  assetsHits,
  body,
})
process.exit(0)
`
}

/** Path 1: `create-aihu` — templates built INTO @aihu/cli, never fetched from npm. */
function createCommand(
  pm: Pm,
  info: PmInfo,
  spec: TemplateSpec,
  appName: string,
): [string, string[]] {
  const tail = [
    appName,
    '--yes',
    '--template',
    spec.id,
    '--pm',
    pm,
    '--no-git',
    ...(spec.extraScaffoldArgs ?? []),
  ]
  if (mode === 'local') return ['node', [localCreateJs, ...tail]]
  const pkg = `create-aihu@${version}`
  switch (pm) {
    case 'npm':
      // `npm create` needs `--` before the package's own argv.
      return ['npm', ['create', `aihu@${version}`, '--', ...tail]]
    case 'bun':
      return ['bun', ['create', `aihu@${version}`, ...tail]]
    case 'pnpm':
      return ['pnpm', ['create', `aihu@${version}`, ...tail]]
    case 'yarn': {
      if (info.major >= 2) return ['yarn', ['dlx', pkg, ...tail]]
      // yarn 1 resolves `yarn create aihu@1.2.3` to a BINARY literally named
      // `create-aihu@1.2.3`, which never exists — exit 127 before the scaffolder
      // ever runs. That is a yarn 1 defect, not an aihu one, and reporting it as
      // a scaffold failure would bury the real result. Only the unversioned form
      // is meaningful there.
      if (version !== 'latest') {
        throw new StepError(
          'yarn 1 cannot pin a create-package version',
          `yarn ${info.version} resolves \`yarn create aihu@${version}\` to a binary named ` +
            `"create-aihu@${version}" and exits 127 before scaffolding. Re-run with ` +
            `--version latest, or use yarn >= 2 (which has \`yarn dlx\`).`,
        )
      }
      return ['yarn', ['create', 'aihu', ...tail]]
    }
  }
}

/** Path 2: `aihu app --template <id>` — template package resolved FROM npm at @latest. */
function appTemplateCommand(
  pm: Pm,
  info: PmInfo,
  spec: TemplateSpec,
  appName: string,
): [string, string[]] {
  const templateId = spec.templateArg ?? spec.id
  const tail = ['app', appName, '--template', templateId, '--pm', pm]
  if (mode === 'local') return ['node', [localBinJs, ...tail]]

  // npm/npx CANNOT run `@aihu/cli`'s `aihu` bin (FEL-422): npx infers the
  // executable from the package NAME, looks for a bin called `cli`, finds
  // `aihu` and `create-aihu` instead, and refuses to guess —
  //     npm error could not determine executable to run
  // `bunx` resolves differently, which is why this is npm-only and why a
  // bun-only harness could never have surfaced it.
  //
  // `create-aihu` is the entry point npm users actually reach, and as of the
  // create-aihu template work its `--template` spans BOTH tiers — built-ins
  // and the npm-published `@aihu/templates-*` packages. So npm drives the npm
  // template tier through the command a real npm user would run, not through
  // one that cannot execute.
  const createTail = [appName, '--template', templateId, '--pm', pm]
  const cliPkg = `@aihu/cli@${version}`
  const createPkg = `create-aihu@${version}`
  switch (pm) {
    case 'npm':
      return ['npx', ['-y', createPkg, ...createTail]]
    case 'bun':
      return ['bunx', [cliPkg, ...tail]]
    case 'pnpm':
      return ['pnpm', ['dlx', createPkg, ...createTail]]
    case 'yarn':
      // yarn 1 has no dlx; fall back to npx and say so in the notes.
      return info.major >= 2
        ? ['yarn', ['dlx', createPkg, ...createTail]]
        : ['npx', ['-y', createPkg, ...createTail]]
  }
}

// ---------------------------------------------------------------------------
// Cell runner
// ---------------------------------------------------------------------------

const STEP_NAMES = [
  'scaffold',
  'install',
  'typecheck',
  'build',
  'worker',
  'dev',
  'preview',
] as const

async function runCell(
  spec: TemplateSpec,
  info: PmInfo,
  viteReq: ViteReq,
  parentDir: string,
): Promise<CellResult> {
  const pm = info.pm
  const cellLocalPkgs = localPkgsForCell(spec)
  const cell: CellResult = {
    template: spec.id,
    pm,
    vite: viteReq.label,
    localPkgs: cellLocalPkgs,
    steps: [],
    status: 'pass',
  }
  // The vite label is part of the directory name: two points on the axis are
  // two independent FRESH trees, never the same tree installed twice.
  const appName = `m-${spec.id}-${pm}-v${viteReq.label}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const projectDir = join(parentDir, appName)
  cell.dir = projectDir

  out(`\n${bold(`▶ cell ${spec.id} × ${pm} × vite ${viteReq.label}`)} ${dim(projectDir)}\n`)

  // A cell that cannot run is not a cell that failed. Report it loudly as
  // untested rather than red — and never as a pass.
  const missing = (spec.requiresBin ?? []).filter((b) => !binExists(b))
  if (missing.length > 0) {
    cell.status = 'skip'
    out(
      `  ${bold('SKIP')}  ${spec.id} needs ${missing.join(', ')} on PATH — ` +
        `NOT tested, NOT passing\n`,
    )
    return cell
  }

  /** A step body may return nothing (pass) or a reasoned non-applicable verdict. */
  type StepOutcome = void | { status: StepStatus; detail: string }

  /** Run one step, recording pass/fail/skip/n-a. Later steps skip once the cell is dead. */
  let dead = false
  const step = async (
    name: string,
    fn: () => Promise<StepOutcome> | StepOutcome,
  ): Promise<void> => {
    if (dead) {
      cell.steps.push({ name, status: 'skip', ms: 0, detail: 'earlier step failed' })
      out(`  ${dim(`- ${name} (skipped — earlier step failed)`)}\n`)
      return
    }
    const t0 = Date.now()
    try {
      const res = await fn()
      const ms = Date.now() - t0
      if (res && typeof res === 'object') {
        cell.steps.push({ name, status: res.status, ms, detail: res.detail })
      } else {
        cell.steps.push({ name, status: 'pass', ms })
      }
      const last = cell.steps[cell.steps.length - 1]!
      const glyph = last.status === 'pass' ? '✓' : last.status === 'n/a' ? '·' : '-'
      out(
        `  ${glyph} ${name} ${dim(`${last.status} ${ms}ms`)}${last.detail ? dim(` — ${last.detail}`) : ''}\n`,
      )
    } catch (err) {
      const ms = Date.now() - t0
      const detail =
        err instanceof StepError
          ? `${err.message}\n${err.detail}`
          : ((err as Error).stack ?? String(err))
      cell.steps.push({ name, status: 'fail', ms, detail })
      cell.status = 'fail'
      dead = true
      out(`  ✘ ${name} ${dim(`fail ${ms}ms`)}\n`)
    }
  }

  // Typed escape hatch so a step body can return a reasoned n/a.
  const na = (detail: string): { status: StepStatus; detail: string } => ({
    status: 'n/a' as const,
    detail,
  })

  // ── 1. scaffold ───────────────────────────────────────────────────────────
  await step('scaffold', () => {
    const [cmd, args] =
      spec.kind === 'create'
        ? createCommand(pm, info, spec, appName)
        : appTemplateCommand(pm, info, spec, appName)
    // A local-package cell is a release-candidate test: it must install the
    // tarballs produced from this checkout, including their peer graph. The
    // `aihu app` path normally installs before the harness can replace registry
    // entries with those tarballs, which falsely tests yesterday's published
    // peers (and makes npm reject a valid candidate). Built-in `create` rows do
    // not auto-install, so this only changes template-package scaffolds. The
    // normal git-init remains: it captures the unmodified scaffold as the base
    // commit before this harness writes its candidate-only tarball overrides.
    if (cellLocalPkgs.length > 0 && spec.kind === 'app-template') args.push('--no-install')
    run('scaffold', cmd, args, parentDir)
    if (!existsSync(projectDir)) {
      throw new StepError(
        'scaffold',
        describe(cmd, args, parentDir, 0, '', `${projectDir} was not created`),
      )
    }
    if (!existsSync(join(projectDir, 'package.json'))) {
      throw new StepError(
        'scaffold',
        describe(cmd, args, parentDir, 0, '', `${projectDir}/package.json missing`),
      )
    }
  })

  const workdir = join(projectDir, spec.workdir)
  const scriptsOf = (): Record<string, string> => {
    try {
      const pkg = JSON.parse(readFileSync(join(workdir, 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>
      }
      return pkg.scripts ?? {}
    } catch {
      return {}
    }
  }

  // ── 2. install ────────────────────────────────────────────────────────────
  await step(`install (${pm})`, () => {
    const pkgPath = join(workdir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    let touched = false

    // The vite axis. Written into the manifest, then installed once — see the
    // `viteAxis` comment for why an incremental `add` would test the wrong thing.
    //
    // Patched at `viteWorkdir`, which may differ from `workdir` — see that
    // field's docblock. When they coincide (every template but `cf-team`
    // today) this is the SAME file as `pkg`/`pkgPath` above; write it back
    // through `pkg` in that case so the two writes cannot race each other on
    // one file. Only when they differ is a second manifest read and written.
    if (viteReq.range !== null) {
      const viteDir = join(projectDir, spec.viteWorkdir ?? spec.workdir)
      const sameFile = viteDir === workdir
      const vitePkgPath = join(viteDir, 'package.json')
      const vitePkg = sameFile
        ? pkg
        : (JSON.parse(readFileSync(vitePkgPath, 'utf8')) as {
            devDependencies?: Record<string, string>
          })
      const templatePin = vitePkg.devDependencies?.vite ?? '(none)'
      vitePkg.devDependencies = { ...(vitePkg.devDependencies ?? {}), vite: viteReq.range }
      out(`    ${dim(`! vite ${templatePin} → ${viteReq.range} (axis override, fresh install)`)}\n`)
      // `touched` unconditionally: a dependency changed either way, and it is
      // `touched` alone that drives the fresh node_modules/lockfile wipe below
      // — the entire reason this axis can see the defect at all. Losing that
      // for the separate-file case would install the OLD vite from a stale
      // tree while faithfully reporting the new range in the log.
      touched = true
      if (!sameFile) {
        writeFileSync(vitePkgPath, `${JSON.stringify(vitePkg, null, 2)}\n`)
        out(`    ${dim(`! (patched ${spec.viteWorkdir}/package.json, not ${spec.workdir})`)}\n`)
      }
    }

    if (cellLocalPkgs.length > 0) {
      const specs = packLocalPkgs(join(parentDir, '.local-tarballs'), cellLocalPkgs)
      // `exactOptionalPropertyTypes` forbids assigning `undefined` to an
      // optional property explicitly — only omitting it is allowed. `swap`
      // therefore mutates its bucket in place and returns void, so there is
      // nothing to assign when the bucket was absent.
      const swap = (bucket: Record<string, string> | undefined): void => {
        if (!bucket) return
        for (const [name, t] of specs) if (name in bucket) bucket[name] = t.spec
      }
      swap(pkg.dependencies)
      swap(pkg.devDependencies)
      // Rewriting the scaffold's OWN manifest is not enough. A tarball's
      // intra-repo edges are ordinary registry ranges once packed, so
      // `@aihu/router` pulls the PUBLISHED `@aihu/server` down beside it —
      // measured: `node_modules/@aihu/router/node_modules/@aihu/server`, which
      // shadowed the local one and failed the build on an export that only
      // exists in this checkout. An override is the only thing that reaches a
      // transitive edge.
      //
      // `overrides` ONLY — not yarn's `resolutions` alongside it. Writing both
      // is what one would reach for to cover every PM, and measured on bun
      // 1.3.8 it silently defeats the override: with `resolutions` also
      // present, the published `@aihu/server` came back nested under
      // `@aihu/router` and the build failed again on `injectIntoOutlet`.
      // Dropping `resolutions` fixed it. pnpm reads neither from package.json
      // (see pnpmWorkspaceYaml() in packages/cli/src/index.ts — pnpm says so
      // out loud and ignores them). So the transitive part of this flag is
      // bun/npm only, stated here rather than papered over: it is a diagnostic,
      // and the cell it exists for is bun.
      //
      // PM-AWARE, and it has to be. The paragraph above is accurate for bun and
      // npm and was written when the local-pkg set was a hand-picked list of
      // buildable leaves; deriving the set (`--local-pkg all`) pulls in packages
      // with intra-repo edges of their own — `@aihu/tsc`'s packed tarball
      // depends on `@aihu/compiler@<workspace version>`, which is unpublished by
      // construction on a release branch. bun and npm rewrite that edge from
      // `overrides`; pnpm reads `pnpm.overrides` and yarn reads `resolutions`,
      // so under the old single-field write those two fetched the pin from the
      // registry and failed with NO_MATCHING_VERSION. Writing the field the
      // running PM actually reads — and ONLY that field — keeps the measured
      // bun behaviour the paragraph above documents (adding `resolutions`
      // alongside `overrides` silently defeated the override on bun 1.3.8)
      // while giving pnpm and yarn the same transitive reach.
      const overrideMap = Object.fromEntries([...specs].map(([n, t]) => [n, t.spec]))
      const p = pkg as Record<string, unknown>
      if (pm === 'pnpm') {
        // NOT `pkg.pnpm.overrides` — pnpmWorkspaceYaml()'s own header says it:
        // "pnpm reads its per-project settings from this file only — the 'pnpm'
        // key in package.json is ignored, and pnpm says so on every install."
        // A first attempt wrote package.json and changed nothing; the cell
        // failed with the identical NO_MATCHING_VERSION on the identical
        // transitive edge. Appended to the workspace file instead, which the
        // scaffold emits unconditionally.
        const wsPath = join(workdir, 'pnpm-workspace.yaml')
        const body = [
          '',
          '# Injected by scaffold-matrix-e2e.ts --local-pkg: force every intra-repo',
          '# edge inside a packed tarball onto the local tarball too. Without this,',
          "# a tarball's own dependency on a sibling resolves from the registry at a",
          '# workspace version that is unpublished by construction on a release branch.',
          'overrides:',
          ...[...specs].map(([n, t]) => `  '${n}': '${t.spec}'`),
          '',
        ].join('\n')
        writeFileSync(wsPath, (existsSync(wsPath) ? readFileSync(wsPath, 'utf8') : '') + body)
      } else if (pm === 'yarn') {
        p.resolutions = overrideMap
      } else {
        p.overrides = overrideMap
      }

      // `@aihu/compiler` arrived with neither `@aihu/compiler-darwin-arm64` nor
      // `@aihu/compiler-native-darwin-arm64` beside it, and `aihu-tsc` died
      // with "Native compiler binary not found for this platform" while the
      // install reported success. NOT caused by `overrides` itself — verified
      // by removing `optionalDependencies` entirely and reinstalling:
      // `@aihu/server`, overridden the exact same way, still brought its
      // platform package in fine. Re-declaring the compiler's platform deps
      // here is a workaround for the real cause below, not for `overrides`.
      //
      // At `*`, NOT at the pin. Half of these platform pins are unpublished by
      // construction — the native addon is built from a Rust source this branch
      // may be changing, so `@aihu/compiler-native-*@0.1.18` does not exist on
      // npm yet. An unresolvable entry took the whole optional group down with
      // it. `*` installs whatever IS published, and the compiler already
      // version-checks the addon it loaded and falls back to the spawn path
      // loudly, which is the same thing it does inside this repo today.
      const platformDeps = [...specs].flatMap(([, t]) => t.optionalDeps)
      if (platformDeps.length > 0) {
        ;(pkg as Record<string, unknown>).optionalDependencies = {
          ...((pkg as { optionalDependencies?: Record<string, string> }).optionalDependencies ??
            {}),
          ...Object.fromEntries(platformDeps.map((n) => [n, '*'])),
        }
      }
      touched = true
      out(`    ${dim(`† local tarballs: ${[...specs.keys()].join(', ')}`)}\n`)
    }

    if (extraDeps.length > 0) {
      pkg.dependencies = { ...(pkg.dependencies ?? {}), ...Object.fromEntries(extraDeps) }
      touched = true
      out(
        `    ${dim(`! patched --extra-dep into package.json: ${extraDeps.map(([n, v]) => `${n}@${v}`).join(', ')}`)}\n`,
      )
    }

    if (touched) writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

    // FRESH, unconditionally, whenever a dependency was rewritten.
    //
    // The built-in `create` templates do not auto-install, so there is normally
    // nothing here — but `aihu app --template` DOES run `pm-install` during
    // scaffold, and a manifest edit on top of an installed tree resolves
    // incrementally. `bun add -d vite@8` over an existing vite 6 install keeps
    // esbuild resolvable and passes; a tree that never contained vite 6 does
    // not. Deleting the tree is the difference between the two, and it is the
    // whole reason this axis can see the defect at all.
    if (touched) {
      for (const junk of [
        'node_modules',
        'bun.lock',
        'bun.lockb',
        'package-lock.json',
        'pnpm-lock.yaml',
        'yarn.lock',
      ]) {
        rmSync(join(workdir, junk), { recursive: true, force: true })
      }
    }

    run('install', pm, pmInstallArgs(pm), projectDir)

    // A local-package row has candidate-only manifest overrides. Record them
    // separately from the scaffold's own initial commit, giving Moon a valid
    // comparison base without changing the user-facing post-install behavior.
    if (cellLocalPkgs.length > 0 && spec.kind === 'app-template') {
      run('install', 'git', ['add', '-A'], projectDir)
      run(
        'install',
        'git',
        [
          '-c',
          'user.name=aihu',
          '-c',
          'user.email=scaffold@aihu.dev',
          'commit',
          '-m',
          'chore: inject release candidate packages',
        ],
        projectDir,
      )
    }
  })

  // ── 3. typecheck ──────────────────────────────────────────────────────────
  await step('typecheck', () => {
    if (spec.typecheckScript === null) return na('template ships no typecheck script')
    if (!(spec.typecheckScript in scriptsOf()))
      return na(`no "${spec.typecheckScript}" script in package.json`)
    run('typecheck', pm, pmRunArgs(pm, spec.typecheckScript), workdir)
  })

  // ── 4. build ──────────────────────────────────────────────────────────────
  await step('build', () => {
    if (spec.buildScript === null) return na('template ships no build script')
    if (!(spec.buildScript in scriptsOf()))
      return na(`no "${spec.buildScript}" script in package.json`)
    run('build', pm, pmRunArgs(pm, spec.buildScript), workdir)
  })

  // ── 5. the BUILT Worker: must load, and must render ───────────────────────
  //
  // Everything above this line can be green on an SSR app that is entirely
  // undeployable. `vite build` reports success on a `_worker.js` whose module
  // evaluation never settles, and the dev/preview servers below never load that
  // file at all. This step is the only one that opens the artifact.
  await step('worker (200 + rendered)', () => {
    if (spec.ssr === undefined) return na('client-only template; no server bundle to drive')

    const worker = join(workdir, spec.ssr.worker)
    if (!existsSync(worker)) {
      throw new StepError(
        'worker: no server bundle',
        `${worker} does not exist after a green build. \`output: 'ssr'\` either did not take ` +
          `effect or emitted somewhere else — a client-only build here would make every ` +
          `assertion below vacuous.\n` +
          `Client dist present: ${existsSync(join(workdir, spec.ssr.clientDist))}`,
      )
    }

    const driver = join(projectDir, '.aihu-matrix-worker-probe.mjs')
    writeFileSync(driver, workerDriverSource())
    // `node`, not `pm run`: the artifact under test is a plain ES module and
    // nothing in the scaffold's scripts loads it. Bounded twice — the driver
    // races its own import against 20s so a deadlock names itself, and `run`
    // bounds the process in case the driver never gets that far.
    const res = run('worker', 'node', [driver, worker, 'https://matrix.test/'], projectDir, 60_000)

    const line = res.stdout.split('\n').find((l) => l.startsWith('AIHU_PROBE:'))
    if (!line) {
      throw new StepError(
        'worker: driver produced no result',
        describe('node', [driver, worker], projectDir, res.status, res.stdout, res.stderr),
      )
    }
    const probe = JSON.parse(line.slice('AIHU_PROBE:'.length)) as {
      status: number
      contentType: string | null
      bodyBytes: number
      body: string
    }

    // Assertions on the RESPONSE, in the order a broken build fails them.
    const bad = (why: string): never => {
      throw new StepError(
        `worker: ${why}`,
        describe(
          'node',
          [driver, worker],
          projectDir,
          res.status,
          `status=${probe.status} content-type=${probe.contentType} bytes=${probe.bodyBytes}\n` +
            `--- body ---\n${tail(probe.body, 60)}`,
          res.stderr,
        ),
      )
    }
    if (probe.status !== 200) bad(`answered HTTP ${probe.status} (expected 200)`)
    if (!/text\/html/i.test(probe.contentType ?? '')) {
      bad(`content-type is ${JSON.stringify(probe.contentType)}, not text/html`)
    }
    // A COMPLETE document, not a fragment. The SSR handler shipped a bare
    // fragment for its whole life — markup with no doctype, no <head> and no
    // client script, so an SSR route rendered once and never hydrated. Each of
    // these is a separate way for that to come back.
    if (!/^\s*<!doctype html>/i.test(probe.body)) bad('body does not start with <!doctype html>')
    if (!/<html[\s>]/i.test(probe.body)) bad('body has no <html> element')
    if (!/<head[\s>]/i.test(probe.body)) bad('body has no <head> — no title, no SEO, no hydration')
    if (!/<script type="module"[^>]*src="\/assets\/[^"]+\.js"/.test(probe.body)) {
      bad('body carries no hashed client entry <script> — server markup that can never hydrate')
    }
    // …and RENDERED CONTENT, not an empty shell. `appName` is what the scaffold
    // puts in the page's own <h1>, so it can only be here if the page component
    // actually rendered on the server. An empty `#outlet` would satisfy every
    // document assertion above.
    const outletOpen = probe.body.indexOf('<div id="outlet">')
    if (outletOpen === -1) bad('no <div id="outlet"> in the served document')
    const inside = probe.body.slice(outletOpen, probe.body.indexOf('</body>', outletOpen))
    if (!inside.includes(appName)) {
      bad(`the outlet does not contain the page's rendered <h1>${appName}</h1> — empty shell`)
    }
    if (!inside.includes('A durable Web Component')) {
      bad("the outlet does not contain the page's rendered body copy — empty shell")
    }
    out(
      `    ${dim(`_worker.js → 200 ${probe.contentType} ${probe.bodyBytes}B, outlet rendered`)}\n`,
    )
  })

  // ── 6. dev server: must answer 200 + non-empty HTML ───────────────────────
  await step('dev (HTTP 200)', async () => {
    if (spec.devScript === null) return na('template ships no dev script')
    if (!(spec.devScript in scriptsOf())) return na(`no "${spec.devScript}" script in package.json`)
    if (spec.serverOnlyOnPm && !spec.serverOnlyOnPm.pms.includes(pm)) {
      return na(spec.serverOnlyOnPm.reason)
    }
    if (spec.devPort === null) return na('no way to thread a port through this dev script')

    let port: number
    let extra: string[]
    if (spec.devPort === 'flag') {
      port = await ephemeralPort()
      extra = ['--port', String(port), '--strictPort']
    } else {
      // Hardcoded port: run it, but never pretend it is collision-safe.
      port = spec.devPort
      extra = []
      out(`    ${dim(`! template hardcodes dev port ${port}; this cell is not parallel-safe`)}\n`)
    }
    const probe = await serveAndProbe(
      'dev',
      pm,
      pmRunArgs(pm, spec.devScript, extra),
      workdir,
      port,
    )
    out(`    ${dim(`${probe.url} → 200 ${probe.contentType} ${probe.bodyBytes}B`)}\n`)
  })

  // ── 7. production/preview server: must answer 200 + non-empty HTML ────────
  await step('preview (HTTP 200)', async () => {
    if (spec.previewScript === null) return na('template ships no preview/production-server script')
    if (!(spec.previewScript in scriptsOf()))
      return na(`no "${spec.previewScript}" script in package.json`)
    if (spec.serverOnlyOnPm && !spec.serverOnlyOnPm.pms.includes(pm)) {
      return na(spec.serverOnlyOnPm.reason)
    }
    if (spec.previewPort === null) return na('no way to thread a port through this preview script')

    const port = spec.previewPort === 'flag' ? await ephemeralPort() : spec.previewPort
    const extra = spec.previewPort === 'flag' ? ['--port', String(port), '--strictPort'] : []
    const probe = await serveAndProbe(
      'preview',
      pm,
      pmRunArgs(pm, spec.previewScript, extra),
      workdir,
      port,
    )
    out(`    ${dim(`${probe.url} → 200 ${probe.contentType} ${probe.bodyBytes}B`)}\n`)
  })

  if (cell.status !== 'fail') cell.status = 'pass'
  return cell
}

// ---------------------------------------------------------------------------
// Grid rendering
// ---------------------------------------------------------------------------

function renderGrid(results: readonly CellResult[], skipped: readonly PmInfo[]): void {
  const glyph: Record<StepStatus, string> = { pass: 'ok', fail: 'FAIL', skip: '-', 'n/a': 'n/a' }
  const cols = ['template', 'pm', 'vite', ...STEP_NAMES]
  const rows = results.map((c) => {
    const byName = (n: string): string => {
      const s = c.steps.find((x) => x.name === n || x.name.startsWith(`${n} `))
      return s ? glyph[s.status] : '-'
    }
    const mark = `${extraDeps.length > 0 ? '*' : ''}${c.localPkgs.length > 0 ? '†' : ''}`
    return [c.template + mark, c.pm, c.vite, ...STEP_NAMES.map(byName)]
  })
  const widths = cols.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)))
  const line = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ')

  out(`\n${bold('══ scaffold DX matrix ══')}\n`)
  out(`mode=${mode}  version=${mode === 'npm' ? version : '(local source)'}\n\n`)
  out(`${bold(line(cols))}\n`)
  out(`${widths.map((w) => '─'.repeat(w)).join('  ')}\n`)
  for (const r of rows) out(`${line(r)}\n`)

  out(
    `\n${bold('legend')}  ok=passed  FAIL=failed  n/a=not applicable (reason below)  -=skipped after an earlier failure\n`,
  )
  if (extraDeps.length > 0) {
    out(
      `${bold('*')} these cells were run with --extra-dep ` +
        `${extraDeps.map(([n, v]) => `${n}@${v}`).join(', ')} patched in — they show what a FIXED\n` +
        `  scaffold would do, and are NOT evidence that the published scaffold works.\n`,
    )
  }
  const allCellLocalPkgs = [...new Set(results.flatMap((cell) => cell.localPkgs))]
  if (allCellLocalPkgs.length > 0) {
    out(
      `${bold('†')} these cells installed the relevant subset of ${allCellLocalPkgs.map((p) => `@aihu/${p}`).join(', ')} from ` +
        `\`npm pack\` tarballs of THIS CHECKOUT,\n` +
        `  not from the registry — they show what a RELEASE would do, and are NOT evidence that\n` +
        `  the currently published packages work.\n`,
    )
  }
  const ssrRows = results.filter((c) => TEMPLATES.find((t) => t.id === c.template)?.ssr)
  if (ssrRows.length > 0) {
    out(
      `${bold('ssr')} the \`worker\` column IMPORTED the built \`_worker.js\` and called its fetch with a\n` +
        `  stubbed ASSETS binding. A green \`build\` alone proves nothing here: the SSR deadlock\n` +
        `  this column exists for lived in an artifact that built cleanly and could not be\n` +
        `  loaded at all.\n`,
    )
  }

  if (skipped.length > 0) {
    out(`\n${bold('SKIPPED PACKAGE MANAGERS')}\n`)
    for (const s of skipped)
      out(`  SKIP  ${s.pm} — not installed on this machine; NOT tested, NOT passing\n`)
  }

  const naSteps = results.flatMap((c) =>
    c.steps
      .filter((s) => s.status === 'n/a')
      .map((s) => `  n/a   ${c.template} × ${c.pm} × vite ${c.vite} · ${s.name} — ${s.detail}`),
  )
  if (naSteps.length > 0) {
    out(`\n${bold('NOT APPLICABLE')}\n${naSteps.join('\n')}\n`)
  }

  const failures = results.filter((c) => c.status === 'fail')
  if (failures.length > 0) {
    out(`\n${bold('FAILURES')}\n`)
    for (const c of failures) {
      for (const s of c.steps.filter((x) => x.status === 'fail')) {
        out(`\n${bold(`✘ ${c.template} × ${c.pm} × vite ${c.vite} · ${s.name}`)}\n`)
        out(`${s.detail ?? '(no detail)'}\n`)
      }
    }
  }

  const notes = templates.filter((t) => t.notes).map((t) => `  note  ${t.id} — ${t.notes}`)
  if (notes.length > 0) out(`\n${bold('TEMPLATE NOTES')}\n${notes.join('\n')}\n`)

  const pass = results.filter((c) => c.status === 'pass').length
  out(
    `\n${bold('SUMMARY')}  ${pass}/${results.length} cells passed` +
      `${failures.length > 0 ? `, ${failures.length} failed` : ''}` +
      `${skipped.length > 0 ? `, ${skipped.length} package manager(s) skipped` : ''}\n`,
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const parentDir = mkdtempSync(join(tmpdir(), 'aihu-dx-matrix-'))

  // Requirement 1 — bail loudly rather than produce meaningless green.
  assertNoAihuAncestor(parentDir)

  out(`${bold('aihu scaffold DX matrix')}\n`)
  out(
    `mode      : ${mode}${mode === 'npm' ? ` (published, @${version})` : ` (local source: ${repoRoot})`}\n`,
  )
  out(`temp root : ${parentDir}  ${dim('(verified: no aihu ancestor)')}\n`)
  out(`templates : ${templates.map((t) => t.id).join(', ')}\n`)
  out(
    `vite axis : ${viteAxis
      .map((v) => (v.range === null ? `${v.label} (template pin)` : `${v.label} → ${v.range}`))
      .join(', ')}\n`,
  )
  if (localPkgs.length > 0) {
    out(
      `local pkg : ${localPkgs.map((p) => `@aihu/${p}`).join(', ')} ${dim('(npm pack tarballs)')}\n`,
    )
  }

  if (mode === 'local') {
    if (!existsSync(localCreateJs) || !existsSync(localBinJs)) {
      out(`\nBuilding @aihu/cli (dist/ missing)…\n`)
      run('build @aihu/cli', 'bun', ['run', 'build'], join(repoRoot, 'packages', 'cli'))
    }
    for (const f of [localCreateJs, localBinJs]) {
      if (!existsSync(f)) {
        out(`\nFATAL — local mode needs ${f}; build packages/cli first.\n`)
        return 2
      }
    }
  }

  const probed = wantPms.map((pm) => probePm(pm))
  const available = probed.filter((p) => p.available)
  const missing = probed.filter((p) => !p.available)

  out(`pms       : ${available.map((p) => `${p.pm}@${p.version}`).join(', ') || '(none!)'}\n`)
  for (const m of missing) {
    out(`${bold('SKIP')}      ${m.pm} — not installed; this row is NOT tested and NOT a pass\n`)
  }
  if (available.length === 0) {
    out('\nFATAL — no package managers available.\n')
    return 2
  }

  const results: CellResult[] = []
  try {
    // Deliberately serial: parallel cells fight over the npm/pnpm/yarn caches,
    // and the `agent` template hardcodes its ports.
    for (const spec of templates) {
      for (const info of available) {
        for (const viteReq of viteAxis) {
          try {
            results.push(await runCell(spec, info, viteReq, parentDir))
          } catch (err) {
            // Requirement 5 — a cell blowing up outside a step never aborts the grid.
            results.push({
              template: spec.id,
              pm: info.pm,
              vite: viteReq.label,
              localPkgs: localPkgsForCell(spec),
              steps: [
                {
                  name: 'scaffold',
                  status: 'fail',
                  ms: 0,
                  detail: (err as Error).stack ?? String(err),
                },
              ],
              status: 'fail',
            })
          }
        }
      }
    }
  } finally {
    killAllChildren()
    renderGrid(results, missing)
    if (keepDirs) {
      out(`\n${dim(`--keep: temp tree left at ${parentDir}`)}\n`)
    } else {
      rmSync(parentDir, { recursive: true, force: true })
    }
  }

  return results.some((c) => c.status === 'fail') ? 1 : 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    out(`\nFATAL — ${(err as Error).stack ?? String(err)}\n`)
    killAllChildren()
    process.exit(2)
  })
