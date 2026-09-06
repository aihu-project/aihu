/**
 * @aihu/cli/scaffold-pipeline — the 6 pure functions per arch-6 §4.4.
 *
 * Pipeline order: resolveTemplate → mergeOptions → enumerateFiles →
 * readSubstituteWrite → runPostInstall → printNextSteps.
 *
 * Purity contract (arch-6 §4.4):
 *   - resolveTemplate / mergeOptions / enumerateFiles do NO I/O.
 *     They operate on the manifest object the caller hands them.
 *   - readSubstituteWrite and runPostInstall DO I/O — but the I/O surface
 *     is injected via the FileSystem and Spawner interfaces so tests can
 *     run them against in-memory fakes without touching the disk.
 */

import type { SpawnSyncReturns } from 'node:child_process'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLI_VERSION } from './cli-version.ts'
import { evalWhen } from './conditional-eval.ts'
import { assertProjectName } from './project-name.ts'
import { parseVersion, satisfiesRange } from './semver-range.ts'
import type { PostInstallStep, TemplateManifest } from './template-manifest.ts'
import { validateManifest } from './template-manifest.ts'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ResolvedOptions {
  appName: string
  appDescription?: string
  pm: 'bun' | 'pnpm' | 'npm' | 'yarn'
  /** All overridable cells from the manifest, resolved to a final value. */
  overrides: Record<string, string | boolean>
  /** Whether to skip the git-init post-install step. */
  noGit?: boolean
}

export interface FileTuple {
  /** Path within the template/ directory (POSIX-style; '/' separator). */
  sourcePath: string
  /** Path written into the user's project (drops `.tmpl`). */
  targetRelPath: string
  /** True when sourcePath ends in `.tmpl` and substitution must run. */
  isTemplate: boolean
}

export interface WrittenFiles {
  written: string[]
  skipped: string[]
}

export interface PostInstallResult {
  ran: PostInstallStep[]
  skipped: PostInstallStep[]
  failures: Array<{ step: PostInstallStep; error: string }>
}

// ─── Injectable side-effect surfaces (real implementations + test fakes) ─────

export interface FileSystem {
  exists(path: string): boolean
  read(path: string): string
  write(path: string, content: string): void
  mkdirp(path: string): void
}

export const realFileSystem: FileSystem = {
  exists: (p) => existsSync(p),
  read: (p) => readFileSync(p, 'utf8'),
  write: (p, c) => writeFileSync(p, c, 'utf8'),
  mkdirp: (p) => mkdirSync(p, { recursive: true }),
}

export interface Spawner {
  run(
    command: string,
    args: ReadonlyArray<string>,
    cwd: string,
  ): { status: number | null; stdout: string; stderr: string }
}

export const realSpawner: Spawner = {
  run(command, args, cwd) {
    const result: SpawnSyncReturns<string> = spawnSync(command, [...args], {
      cwd,
      shell: false, // mirrors create.ts pattern
      encoding: 'utf8',
    })
    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    }
  },
}

// ─── Auto-install ─────────────────────────────────────────────────────────────

/**
 * Detect the first available package manager. Mirrors the logic in create.ts.
 * Injectable via the `pmExists` parameter for tests.
 */
export function detectPackageManager(
  pmExists: (pm: string) => boolean = (pm) => {
    const r = spawnSync(pm, ['--version'], { stdio: 'ignore', shell: false })
    return r.status === 0
  },
): 'bun' | 'pnpm' | 'yarn' | 'npm' {
  for (const pm of ['bun', 'pnpm', 'yarn', 'npm'] as const) {
    if (pmExists(pm)) return pm
  }
  return 'npm'
}

export interface AutoInstallTemplateInput {
  /** Full package name, e.g. `@aihu/templates-cf-team`. */
  pkgName: string
  /** Package manager to use; auto-detected when absent. */
  pm?: 'bun' | 'pnpm' | 'yarn' | 'npm'
  /** Spawner for the install command. Defaults to realSpawner. */
  spawner?: Spawner
  /** Override PM detection (injectable for tests). */
  pmExists?: (pm: string) => boolean
  /** Override stdout writer (injectable for tests). */
  write?: (s: string) => void
}

export interface AutoInstallTemplateResult {
  /** True when the install command exited 0. */
  success: boolean
  /** The PM that was used. */
  pm: 'bun' | 'pnpm' | 'yarn' | 'npm'
  /** Install command args actually run (e.g. ['add', '@aihu/templates-cf-team']). */
  args: string[]
  /** Raw stderr from the install command on failure. */
  stderr: string
}

/**
 * Install a template package using the detected (or supplied) package manager.
 *
 * Emits one status line to stdout: `Installing template package <pkg>...`
 * Returns a result record so callers can decide what to do on failure.
 */
export function autoInstallTemplate(input: AutoInstallTemplateInput): AutoInstallTemplateResult {
  const spawner = input.spawner ?? realSpawner
  const write = input.write ?? ((s: string) => process.stdout.write(s))
  const pm = input.pm ?? detectPackageManager(input.pmExists)

  // Build the install args per PM convention.
  // bun/npm/yarn use `add`; pnpm uses `add` too.
  const installArgs = ['add', input.pkgName]

  write(`Installing template package ${input.pkgName}...\n`)

  const res = spawner.run(pm, installArgs, process.cwd())

  return {
    success: res.status === 0,
    pm,
    args: installArgs,
    stderr: res.stderr,
  }
}

// ─── 1. resolveTemplate ──────────────────────────────────────────────────────

/**
 * Stub for B1.1: load a manifest object from a path. The full version (B1.2+)
 * dynamically imports `<pkg>/dist/template.config.js` from a resolved npm
 * package; the seam is identical because both produce a validated
 * TemplateManifest.
 *
 * For B1.1, callers pass the manifest object directly. We expose a function
 * shape that takes either an already-loaded object or a `loader` callback so
 * tests can inject without touching the disk.
 */
export interface ResolveTemplateInput {
  /** Already-loaded manifest object (the typical B1.1 path). */
  manifest?: unknown
  /** Optional async loader (B1.2 will plug in `import()`-by-path here). */
  loader?: () => Promise<unknown>
}

export async function resolveTemplate(input: ResolveTemplateInput): Promise<TemplateManifest> {
  const raw =
    input.manifest !== undefined ? input.manifest : input.loader ? await input.loader() : undefined
  if (raw === undefined) {
    throw new Error('resolveTemplate: must provide either `manifest` or `loader`')
  }
  return validateManifest(raw)
}

// ─── 1b. compatibility gate ──────────────────────────────────────────────────

/**
 * The `contractVersion` this CLI knows how to read.
 *
 * Bump ONLY on a breaking change to the `TemplateManifest` shape. Additive
 * fields (`conditionalFiles[].rename`, `appPeerDepsConditional`) did not and
 * must not bump it — old templates keep scaffolding.
 */
export const SUPPORTED_CONTRACT_VERSION = 1

/**
 * Enforce a template manifest's declared compatibility against this CLI.
 *
 * Both `contractVersion` and `cliRange` were parsed and validated by
 * `validateManifest()` and then compared against nothing at all — the fields
 * existed, so templates declared them, and nothing could ever be wrong. The
 * proof that this matters is that the declaration had ALREADY gone stale
 * without anyone noticing: `@aihu/templates-cf-team` shipped `cliRange: '^0.2.0'`
 * against a CLI at 1.2.x, i.e. every published scaffold of the only publishable
 * template asserted an incompatibility it did not have.
 *
 * Fails in the loud style the `unpublished`/`unknown` template cases already
 * use: name the template, name both versions, and say what to do.
 *
 * @param cliVersion injectable for tests; defaults to this CLI's own version.
 */
export function assertTemplateCompatibility(
  manifest: TemplateManifest,
  cliVersion: string = CLI_VERSION,
): void {
  if (manifest.contractVersion !== SUPPORTED_CONTRACT_VERSION) {
    throw new Error(
      `template '${manifest.name}' declares contractVersion ${manifest.contractVersion}, but ` +
        `@aihu/cli ${cliVersion} implements contractVersion ${SUPPORTED_CONTRACT_VERSION}. ` +
        (manifest.contractVersion > SUPPORTED_CONTRACT_VERSION
          ? 'Upgrade the CLI: npm install -g @aihu/cli@latest'
          : 'That template is too old for this CLI; use a newer release of it.'),
    )
  }

  // A prerelease CLI (`1.3.0-beta.1`) is checked as its release core. npm's
  // prerelease rule would otherwise make a canary build fail EVERY template's
  // range — correct for third-party packages, useless for asking "can the
  // binary I am running drive this manifest".
  const parsed = parseVersion(cliVersion)
  const effective =
    parsed !== undefined && parsed.pre.length > 0
      ? `${parsed.major}.${parsed.minor}.${parsed.patch}`
      : cliVersion

  let ok: boolean
  try {
    ok = satisfiesRange(effective, manifest.cliRange)
  } catch (err) {
    // An unreadable range is a template defect, not a reason to proceed. The
    // whole point of enforcing the field is that it cannot silently pass.
    throw new Error(
      `template '${manifest.name}' declares an unusable cliRange: ${(err as Error).message}`,
    )
  }
  if (!ok) {
    throw new Error(
      `template '${manifest.name}' requires @aihu/cli ${manifest.cliRange}, but this is ` +
        `@aihu/cli ${cliVersion}.\n` +
        `Install a CLI in range (npm install -g @aihu/cli@"${manifest.cliRange}"), or use a ` +
        'release of the template that supports this CLI.',
    )
  }
}

// ─── 2. mergeOptions ─────────────────────────────────────────────────────────

export interface MergeOptionsInput {
  appName: string
  appDescription?: string
  pm?: 'bun' | 'pnpm' | 'npm' | 'yarn'
  noGit?: boolean
  /** User-supplied override values (CLI flags + prompt answers). */
  userOverrides: Record<string, string | boolean>
}

export function mergeOptions(
  manifest: TemplateManifest,
  input: MergeOptionsInput,
): ResolvedOptions {
  // Validate appName: kebab-ish, no leading digit (per arch-6 §4.3). The rule
  // moved to project-name.ts when `scaffoldApp`/`scaffoldPlugin` adopted it —
  // this path was the ONLY one enforcing it, so the two scaffold paths
  // disagreed about what a legal name was and only one of them could escape
  // the project directory.
  assertProjectName(input.appName, 'mergeOptions', 'appName')

  // Reject any user-attempted override of a `fixed` cell.
  for (const key of Object.keys(input.userOverrides)) {
    if (Object.hasOwn(manifest.fixed, key)) {
      throw new Error(`mergeOptions: cannot override fixed manifest cell ${JSON.stringify(key)}`)
    }
  }

  // Resolve every `overridable` cell: user value if provided + valid, else default.
  const overrides: Record<string, string | boolean> = {}
  for (const key of Object.keys(manifest.overridable)) {
    const field = manifest.overridable[key]!
    if (Object.hasOwn(input.userOverrides, key)) {
      const v = input.userOverrides[key]!
      if (!field.choices.includes(v)) {
        throw new Error(
          `mergeOptions: ${key}=${JSON.stringify(v)} not in allowed choices ${JSON.stringify(field.choices)}`,
        )
      }
      overrides[key] = v
    } else {
      overrides[key] = field.default
    }
  }

  // Reject unknown override keys (anything not in fixed and not in overridable).
  for (const key of Object.keys(input.userOverrides)) {
    if (!Object.hasOwn(manifest.overridable, key)) {
      throw new Error(`mergeOptions: unknown override key ${JSON.stringify(key)}`)
    }
  }

  const result: ResolvedOptions = {
    appName: input.appName,
    pm: input.pm ?? 'bun',
    overrides,
    ...(input.appDescription !== undefined ? { appDescription: input.appDescription } : {}),
    ...(input.noGit !== undefined ? { noGit: input.noGit } : {}),
  }
  return result
}

// ─── 3. enumerateFiles ───────────────────────────────────────────────────────

export interface EnumerateFilesInput {
  /** Every file path under template/ in POSIX form, e.g. `'src/main.ts.tmpl'`. */
  templateFiles: ReadonlyArray<string>
}

/**
 * Pure: given a manifest + resolved options + a list of paths under template/,
 * produce the ordered FileTuple list to write.
 *
 * For each path:
 *   - if it appears in manifest.conditionalFiles, evaluate the `when`
 *     expression against the merged context (overrides ∪ fixed cells).
 *     Skip the file if the expression is false.
 *   - otherwise include unconditionally.
 *
 * Strips `.tmpl` from the target relpath when present.
 */
export function enumerateFiles(
  manifest: TemplateManifest,
  options: ResolvedOptions,
  input: EnumerateFilesInput,
): FileTuple[] {
  // F-5b: track both `when` and optional `rename` per conditional file.
  const conditional = new Map<string, { when: string; rename?: string }>()
  for (const c of manifest.conditionalFiles) {
    conditional.set(normalize(c.path), {
      when: c.when,
      ...(c.rename !== undefined ? { rename: c.rename } : {}),
    })
  }

  const ctx: Record<string, unknown> = {
    ...manifest.fixed,
    ...options.overrides,
  }

  const out: FileTuple[] = []
  for (const raw of input.templateFiles) {
    const sourcePath = normalize(raw)
    const entry = conditional.get(sourcePath)
    if (entry !== undefined && !evalWhen(entry.when, ctx)) continue

    const isTemplate = sourcePath.endsWith('.tmpl')
    let targetRelPath = isTemplate ? sourcePath.slice(0, -5) : sourcePath

    // F-5b: when a conditional file declares `rename`, replace the filename
    // portion of the target path with the rename value.
    if (entry?.rename) {
      const lastSlash = sourcePath.lastIndexOf('/')
      const dir = lastSlash >= 0 ? sourcePath.slice(0, lastSlash) : ''
      targetRelPath = dir ? `${dir}/${entry.rename}` : entry.rename
    }

    out.push({ sourcePath, targetRelPath, isTemplate })
  }
  return out
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/')
}

// ─── 4. readSubstituteWrite ──────────────────────────────────────────────────

const PLACEHOLDER_TOKENS = [
  '__APP_NAME__',
  '__APP_DESCRIPTION__',
  '__APP_VERSION__',
  '__AIHU_VERSION__',
  '__TEMPLATE_NAME__',
  '__SCAFFOLD_DATE__',
  // F-3b: expands to conditional dep lines (with leading comma) or '' when none match.
  '__APP_CONDITIONAL_DEPS__',
  // Range for an intra-workspace dependency, chosen by package manager.
  // See workspaceProtocolFor().
  '__WORKSPACE_PROTOCOL__',
] as const

export interface ReadSubstituteWriteInput {
  templateRoot: string
  targetDir: string
  manifest: TemplateManifest
  options: ResolvedOptions
  fs?: FileSystem
  /** Override the date stamp (deterministic tests). */
  now?: () => string
}

export function readSubstituteWrite(
  files: ReadonlyArray<FileTuple>,
  input: ReadSubstituteWriteInput,
): WrittenFiles {
  const fs = input.fs ?? realFileSystem
  const written: string[] = []
  const skipped: string[] = []

  const subs = buildSubstitutions(input.manifest, input.options, input.now)

  for (const f of files) {
    const src = posix.join(normalize(input.templateRoot), f.sourcePath)
    const dst = join(input.targetDir, f.targetRelPath.replace(/\//g, sepFor(input.targetDir)))

    if (fs.exists(dst)) {
      skipped.push(dst)
      continue
    }

    const raw = fs.read(src)
    const content = f.isTemplate ? substitute(raw, subs) : raw

    fs.mkdirp(dirname(dst))
    fs.write(dst, content)
    written.push(dst)
  }

  return { written, skipped }
}

function sepFor(targetDir: string): string {
  return targetDir.includes('\\') ? '\\' : '/'
}

/**
 * F-3b: evaluate `appPeerDepsConditional` and return a JSON-fragment string
 * that can be substituted for `__APP_CONDITIONAL_DEPS__` in `.tmpl` files.
 *
 * When one or more conditional deps match, returns:
 *   `,\n    "<pkg>": "<version>"[,\n    "<pkg>": "<version>"]`
 * (leading comma so it appends cleanly to the last unconditional dep line).
 * Returns `''` when no deps match.
 */
function buildConditionalDepLines(
  manifest: TemplateManifest,
  ctx: Record<string, unknown>,
): string {
  const cond = manifest.appPeerDepsConditional
  if (!cond) return ''
  const entries: string[] = []
  for (const [pkg, dep] of Object.entries(cond)) {
    if (evalWhen(dep.when, ctx)) {
      entries.push(`    "${pkg}": "${dep.version}"`)
    }
  }
  return entries.length > 0 ? `,\n${entries.join(',\n')}` : ''
}

/**
 * The dependency range a monorepo template should use to point one of its own
 * workspace members at another, for the package manager actually being used.
 *
 * There is no single spelling that works everywhere, which is what broke the
 * cf-team template on 3 of 4 package managers (run 30322552896, all three at
 * the `scaffold` step, before a single file could be typechecked):
 *
 *   `workspace:*`  bun ✓  pnpm ✓  npm ✘  yarn 1 ✘
 *     npm    → EUNSUPPORTEDPROTOCOL: Unsupported URL Type "workspace:"
 *     yarn 1 → Couldn't find package "@app/shared@workspace:*" on the "npm"
 *              registry — it takes the range literally and asks the registry
 *              for it, rather than reading it as a workspace pointer.
 *
 *   `*`            bun ✓  npm ✓  yarn 1 ✓  pnpm ✘
 *     pnpm 10 defaults `link-workspace-packages` to false, so a bare `*`
 *     resolves from the REGISTRY — silently installing a stranger's package,
 *     or failing, instead of linking the sibling next door.
 *
 * So the choice is genuinely per-PM. `workspace:` is strictly better where it
 * is understood (it cannot accidentally resolve to a registry package), so it
 * is the default and `*` is the fallback for the two that reject it.
 */
export function workspaceProtocolFor(pm: ResolvedOptions['pm']): string {
  return pm === 'npm' || pm === 'yarn' ? '*' : 'workspace:*'
}

function buildSubstitutions(
  manifest: TemplateManifest,
  options: ResolvedOptions,
  now: (() => string) | undefined,
): Record<string, string> {
  const aihuVersion = manifest.appPeerDeps['@aihu/runtime'] ?? '^1.0.0'
  const ctx: Record<string, unknown> = { ...manifest.fixed, ...options.overrides }
  return {
    __APP_NAME__: options.appName,
    __APP_DESCRIPTION__: options.appDescription ?? manifest.displayName,
    __APP_VERSION__: '0.1.0',
    __AIHU_VERSION__: aihuVersion,
    __TEMPLATE_NAME__: manifest.name,
    __SCAFFOLD_DATE__: (now ?? (() => new Date().toISOString().slice(0, 10)))(),
    // F-3b: conditional auth deps (leading comma + newline when non-empty).
    __APP_CONDITIONAL_DEPS__: buildConditionalDepLines(manifest, ctx),
    __WORKSPACE_PROTOCOL__: workspaceProtocolFor(options.pm),
  }
}

function substitute(input: string, subs: Record<string, string>): string {
  let out = input
  for (const token of PLACEHOLDER_TOKENS) {
    out = out.replaceAll(token, subs[token] ?? '')
  }
  return out
}

// ─── 5. runPostInstall ───────────────────────────────────────────────────────

export interface RunPostInstallInput {
  manifest: TemplateManifest
  options: ResolvedOptions
  targetDir: string
  spawner?: Spawner
}

export function runPostInstall(input: RunPostInstallInput): PostInstallResult {
  const spawner = input.spawner ?? realSpawner
  const ctx: Record<string, unknown> = {
    ...input.manifest.fixed,
    ...input.options.overrides,
    initGit: input.options.noGit !== true && (input.options.overrides.initGit ?? true),
  }

  const ran: PostInstallStep[] = []
  const skipped: PostInstallStep[] = []
  const failures: Array<{ step: PostInstallStep; error: string }> = []

  for (const step of input.manifest.postInstall) {
    if (step.when !== undefined) {
      if (!evalWhen(step.when, ctx)) {
        skipped.push(step)
        continue
      }
    }

    const cmds = commandsFor(step, input.options.pm)
    if (cmds === null) {
      // Step is recognized but a no-op for this options shape (e.g. git-init
      // when --no-git was passed; aihu-check before the binary exists).
      skipped.push(step)
      continue
    }

    // Run the sequence, stopping at the first failure so a later command
    // cannot paper over an earlier one (a `git commit` "succeeding" after a
    // failed `git add` would leave exactly the empty repo this step exists to
    // prevent).
    // `status` is `number | null` — spawnSync reports null when the child was
    // killed by a signal rather than exiting. Narrowing it to `number` here
    // would be a lie that only shows up on a killed process.
    let failure: {
      command: string
      args: string[]
      status: number | null
      stderr: string
    } | null = null
    for (const cmd of cmds) {
      const res = spawner.run(cmd.command, cmd.args, input.targetDir)
      if (res.status !== 0) {
        failure = { ...cmd, status: res.status, stderr: res.stderr }
        break
      }
    }

    if (failure === null) {
      ran.push(step)
    } else if (step.allowFailure === true) {
      ran.push(step) // best-effort; we ran it, it failed quietly
    } else {
      failures.push({
        step,
        error: `command ${failure.command} ${failure.args.join(' ')} exited with status ${failure.status}: ${failure.stderr.trim()}`,
      })
    }
  }

  return { ran, skipped, failures }
}

/**
 * The command sequence for one post-install step, run in order; the first
 * non-zero exit fails the step. Returns null when the step is a no-op for this
 * options shape.
 *
 * A LIST rather than a single command because `git-init` is not one command —
 * see below.
 */
function commandsFor(
  step: PostInstallStep,
  pm: ResolvedOptions['pm'],
): Array<{ command: string; args: string[] }> | null {
  switch (step.kind) {
    case 'pm-install':
      return [{ command: pm, args: ['install'] }]
    case 'git-init':
      // `git init` ALONE leaves an unborn HEAD, and anything that asks git a
      // question about HEAD then fails. That is FEL-431 defect 5: moon's git
      // integration exits 128 with "fatal: ambiguous argument 'HEAD'", so a
      // scaffolded cf-team cannot run dev, build or typecheck — every command
      // the CLI prints as the next step. Reproduced on a real scaffold:
      // `git rev-parse HEAD` -> 128, `git rev-list --count --all` -> 0.
      //
      // `create.ts` (the create-aihu wizard) has always done init + add +
      // commit. This path did not, so ONE capability had TWO implementations
      // that disagreed — and only the path nobody tested was broken.
      //
      // Identity is passed explicitly rather than taken from the ambient git
      // config: `git commit` fails outright when no user.name/user.email is
      // resolvable, which is the normal state of CI runners and fresh
      // containers. Depending on ambient config would make this fix work on a
      // developer machine and leave the unborn HEAD in exactly the environment
      // the scaffold matrix runs in. Verified that the explicit form succeeds
      // with no global config at all.
      //
      // The branch name is pinned for the same reason, one level on: a born
      // HEAD is not enough if it is born under the WRONG NAME. The branch
      // `git init` creates is whatever ambient `init.defaultBranch` says, and
      // the cf-team template ships `.moon/workspace.yml` declaring
      // `defaultBranch: 'main'`. When the two disagree, moon resolves
      // `base="main" head="HEAD"` against a repo that has no `main` and dies:
      //   fatal: ambiguous argument 'main': unknown revision …   (git exit 128)
      // Measured in scaffold-matrix run 30404220223: cf-team FAILED at
      // `typecheck` on ALL FOUR package managers — which is what proves it is
      // not a package-manager defect. A developer whose global config already
      // says `main` never sees it.
      //
      // `symbolic-ref` rather than `git init -b main`, which reads better and
      // is the idiom: `-b` landed in git 2.28 (Jul 2020) and on anything older
      // it is `error: unknown switch 'b'`, exit 129 — turning a scaffold that
      // works today into one that fails outright. `symbolic-ref` on an unborn
      // HEAD is just a rewrite of `.git/HEAD` and has no version floor, which
      // is the right trade for a step whose whole job is to not depend on the
      // machine it runs on.
      return [
        { command: 'git', args: ['init'] },
        { command: 'git', args: ['symbolic-ref', 'HEAD', 'refs/heads/main'] },
        { command: 'git', args: ['add', '-A'] },
        {
          command: 'git',
          args: [
            '-c',
            'user.name=aihu',
            '-c',
            'user.email=scaffold@aihu.dev',
            'commit',
            '-m',
            'chore: initial aihu scaffold',
          ],
        },
      ]
    case 'lint-fix':
      return [{ command: pm, args: ['run', 'check'] }]
    case 'aihu-check':
      // The aihu binary is the new app's local devDep; until install ran,
      // we can't run it. Skip silently if pm-install has not yet run.
      return null
  }
}

// ─── 6. printNextSteps ───────────────────────────────────────────────────────

export interface PrintNextStepsInput {
  options: ResolvedOptions
  targetDir: string
  /** Inject for testing; defaults to process.stdout.write. */
  output?: (chunk: string) => void
}

export function printNextSteps(input: PrintNextStepsInput): void {
  const write = input.output ?? ((s: string) => process.stdout.write(s))
  const lines = [
    '',
    `  Done! Your app is at ${input.targetDir}`,
    '',
    '  Next steps:',
    `    cd ${input.options.appName}`,
    `    ${input.options.pm} run dev`,
    '',
    '  Docs: https://github.com/aihu-project/aihu',
    '',
  ]
  write(lines.join('\n'))
}

// ─── npm-template driver (shared by `aihu app` and `create-aihu`) ────────────
//
// Everything below used to live in bin.ts, reachable only from
// `aihu app --template <pkg>`. `create-aihu` — the entry point npm users
// actually reach (`npm create aihu` / `npx create-aihu`) — had no way to run
// it, so the @aihu/templates-* packages were npm-unreachable (FEL-422).
// It lives here so both bins drive one implementation.

/**
 * Recursively enumerate every file under `root`. Returns POSIX-style relpaths
 * (forward slashes), suitable for `enumerateFiles({ templateFiles })`.
 */
export function walkTemplateFiles(root: string): string[] {
  const out: string[] = []
  const stack: string[] = [root]
  while (stack.length > 0) {
    const cur = stack.pop()!
    for (const entry of readdirSync(cur)) {
      const abs = join(cur, entry)
      const st = statSync(abs)
      if (st.isDirectory()) {
        stack.push(abs)
      } else if (st.isFile()) {
        const rel = relative(root, abs).replace(/\\/g, '/')
        out.push(rel)
      }
    }
  }
  return out.sort()
}

/**
 * Resolve a template package's on-disk root directory. Tries (in order):
 *   0. The INVOKING PROJECT's `<cwd>/node_modules` — where `autoInstallTemplate()`
 *      puts the package.
 *   1. Node ESM resolution: `import.meta.resolve(<pkg>)` — the production
 *      path used after `npm install <template-pkg>`.
 *   2. Workspace-relative fallback: walk up from this file looking for a
 *      sibling `packages/templates/<short>/template.config.*` — the dev
 *      path used inside the aihu monorepo before templates packages publish.
 *
 * Returns the directory containing `template.config.{ts,js,mjs}` and a
 * sub-directory `template/`. Throws if neither path resolves.
 */
export async function resolveTemplatePackagePath(
  pkgName: string,
  cwd: string = process.cwd(),
): Promise<string> {
  // Strategy 0: the INVOKING PROJECT's node_modules.
  //
  // This has to come first, because it is where `autoInstallTemplate()` puts
  // the package: it runs `<pm> add <pkg>` in `process.cwd()`. Strategy 1 below
  // uses `import.meta.resolve`, which resolves relative to THIS MODULE — and
  // when the CLI is run via `bunx`/`npx` that module lives in a package-manager
  // cache directory with no view of the user's project. So the auto-install
  // would succeed, drop the template into `<cwd>/node_modules`, and resolution
  // would still fail:
  //
  //   Installing template package @aihu/templates-cf-team...
  //   Resolved, downloaded and extracted [2]      <- install worked
  //   ERROR: Failed to install template package   <- resolve did not
  //
  // That made `aihu app --template <pkg>` impossible for every user outside
  // the monorepo, on every package manager, regardless of what was published.
  for (const dir of [cwd, dirname(fileURLToPath(import.meta.url))]) {
    const pkgRoot = join(dir, 'node_modules', ...pkgName.split('/'))
    for (const ext of ['ts', 'js', 'mjs']) {
      const cfg = join(pkgRoot, `template.config.${ext}`)
      try {
        if (statSync(cfg).isFile()) return pkgRoot
      } catch {
        // not this extension; keep looking
      }
    }
  }

  // Strategy 1: Node ESM resolution.
  try {
    // import.meta.resolve is sync since Node 20.6+; it returns a URL string.
    // We try to resolve `<pkg>/template.config.ts` first, falling back to
    // `<pkg>/template.config.js` and the package root.
    const candidates = [
      `${pkgName}/template.config.ts`,
      `${pkgName}/template.config.js`,
      `${pkgName}/template.config.mjs`,
      pkgName,
    ]
    for (const c of candidates) {
      try {
        const url = import.meta.resolve(c)
        const fsPath = fileURLToPath(url)
        // Normalize to the package root (parent of template.config.* file).
        if (/template\.config\.(ts|js|mjs)$/.test(fsPath)) {
          return dirname(fsPath)
        }
        return fsPath
      } catch {
        // try next candidate
      }
    }
  } catch {
    // fall through to workspace fallback
  }

  // Strategy 2: workspace-relative fallback. The CLI source lives at
  // `<repo>/packages/cli/src/scaffold-pipeline.ts` (or `dist/*.js` after
  // build). Walk up until we find `packages/templates/`, then look for the
  // short-name dir.
  const short = pkgName.startsWith('@aihu/templates-')
    ? pkgName.slice('@aihu/templates-'.length)
    : pkgName
  const here = fileURLToPath(import.meta.url)
  let dir = dirname(here)
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'packages', 'templates', short)
    try {
      const st = statSync(candidate)
      if (st.isDirectory()) {
        // Confirm a template.config.* file is present.
        for (const ext of ['ts', 'js', 'mjs']) {
          try {
            statSync(join(candidate, `template.config.${ext}`))
            return candidate
          } catch {
            // try next ext
          }
        }
      }
    } catch {
      // not here; walk up
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  throw new Error(
    `Could not resolve template package ${JSON.stringify(pkgName)}: ` +
      'not installed via npm and not found in workspace fallback. ' +
      `Run 'npm install ${pkgName}' first, or invoke the CLI from inside the aihu monorepo.`,
  )
}

/**
 * Load a template package's manifest. Reads the package directory listing
 * to find any `template.config.{ts,js,mjs,cjs}` file (more robust than
 * stat'ing fixed filenames — handles bunx temp-dir layouts where stat can
 * misbehave). Then dynamic-imports it; expects either a default export or
 * a named export `config` shaped per TemplateManifest.
 */
export async function loadTemplateConfig(pkgRoot: string): Promise<unknown> {
  let entries: string[]
  try {
    entries = readdirSync(pkgRoot)
  } catch (e) {
    throw new Error(`Could not read template package root ${pkgRoot}: ${(e as Error).message}`)
  }
  // Prefer .ts (Bun-native), fall through to compiled forms.
  const ordered = ['.ts', '.js', '.mjs', '.cjs']
  let lastImportError: Error | undefined
  for (const ext of ordered) {
    const match = entries.find((f) => f === `template.config${ext}`)
    if (!match) continue
    const candidate = join(pkgRoot, match)
    try {
      // Use file:// URL so dynamic import works on Windows.
      const mod = (await import(`file://${candidate.replace(/\\/g, '/')}`)) as Record<
        string,
        unknown
      >
      return mod.default ?? mod.config ?? mod
    } catch (e) {
      // import failed — record and try next extension (e.g. .ts fails under
      // Node.js, fall through to compiled .js)
      lastImportError = e as Error
    }
  }
  const importHint = lastImportError ? ` Last import error: ${lastImportError.message}` : ''
  throw new Error(
    `No template.config.{ts,js,mjs,cjs} found under ${pkgRoot}. ` +
      `Directory contains: ${entries.slice(0, 20).join(', ')}${entries.length > 20 ? ', …' : ''}.${importHint}`,
  )
}

export interface ScaffoldFromTemplatePackageInput {
  /** Directory name for the new app (also the emitted package name). */
  appName: string
  /** Full template package name, e.g. `@aihu/templates-cf-team`. */
  templatePkg: string
  /** Package manager used for auto-install, `pm-install` and emitted scripts. */
  pm: ResolvedOptions['pm']
  /** Skip the `git-init` post-install step. */
  noGit?: boolean
  /** Skip `pm-install` + `lint-fix` (offline / harness scaffolding). */
  noInstall?: boolean
  /** Do not auto-install the template package when resolution fails. */
  noAutoInstall?: boolean
  /** Overrides for the manifest's `overridable` cells. */
  userOverrides?: Record<string, string | boolean>
  /** Working directory the app is created under. Defaults to `process.cwd()`. */
  cwd?: string
  /** Status writer for the auto-install line. Defaults to process.stdout. */
  write?: (s: string) => void
}

export interface ScaffoldFromTemplatePackageResult {
  targetDir: string
  options: ResolvedOptions
  manifest: TemplateManifest
  written: string[]
  skipped: string[]
  post: PostInstallResult
}

/**
 * Drive the full npm-template scaffold: resolve (auto-installing the template
 * package when missing) → resolveTemplate → mergeOptions → enumerateFiles →
 * readSubstituteWrite → runPostInstall.
 *
 * Deliberately does NOT print a summary or call `process.exit`: `aihu app` and
 * `create-aihu` render their own (differently styled) output from the returned
 * result. Throws on unrecoverable errors; post-install failures come back in
 * `result.post.failures` for the caller to report.
 */
export async function scaffoldFromTemplatePackage(
  input: ScaffoldFromTemplatePackageInput,
): Promise<ScaffoldFromTemplatePackageResult> {
  const cwd = input.cwd ?? process.cwd()
  const pm = input.pm

  // --- 1. resolveTemplate (with auto-install on first-resolve failure) ---
  let pkgRoot: string
  try {
    pkgRoot = await resolveTemplatePackagePath(input.templatePkg, cwd)
  } catch (firstErr) {
    // Auto-install is disabled — surface the original error immediately.
    if (input.noAutoInstall === true) throw firstErr

    // Attempt to auto-install the template package, then retry resolution.
    const installResult = autoInstallTemplate({
      pkgName: input.templatePkg,
      pm,
      ...(input.write !== undefined ? { write: input.write } : {}),
    })
    if (!installResult.success) {
      throw new Error(
        `Failed to install template package; please install manually: ` +
          `${installResult.pm} add ${input.templatePkg}\n` +
          (installResult.stderr.trim() ? `Install stderr: ${installResult.stderr.trim()}` : ''),
      )
    }

    // Retry resolution after successful install.
    try {
      pkgRoot = await resolveTemplatePackagePath(input.templatePkg, cwd)
    } catch (retryErr) {
      throw new Error(
        `Failed to install template package; please install manually: ` +
          `${installResult.pm} add ${input.templatePkg}\n` +
          `Resolution after install failed: ${(retryErr as Error).message}`,
      )
    }
  }

  const manifest = await resolveTemplate({ loader: () => loadTemplateConfig(pkgRoot) })

  // --- 1b. compatibility gate ---
  // Before ANY file is written or any package installed. Both bins reach the
  // pipeline through this function, so neither can skip the check.
  assertTemplateCompatibility(manifest)

  // --- 2. mergeOptions ---
  const options = mergeOptions(manifest, {
    appName: input.appName,
    pm,
    ...(input.noGit !== undefined ? { noGit: input.noGit } : {}),
    userOverrides: input.userOverrides ?? {},
  })

  // --- 3. enumerateFiles ---
  const templateRoot = join(pkgRoot, 'template')
  const templateFiles = walkTemplateFiles(templateRoot)
  const files = enumerateFiles(manifest, options, { templateFiles })

  // --- 4. readSubstituteWrite ---
  const targetDir = resolve(cwd, input.appName)
  const written = readSubstituteWrite(files, {
    templateRoot: posix.normalize(templateRoot.replace(/\\/g, '/')),
    targetDir,
    manifest,
    options,
    fs: realFileSystem,
  })

  // --- 5. runPostInstall ---
  // When noInstall is set, filter out pm-install + lint-fix (lint-fix requires
  // the toolchain installed). git-init still honors noGit via
  // mergeOptions/runPostInstall's existing skip path.
  const filteredManifest = input.noInstall
    ? {
        ...manifest,
        postInstall: manifest.postInstall.filter(
          (s) => s.kind !== 'pm-install' && s.kind !== 'lint-fix',
        ),
      }
    : manifest
  const post = runPostInstall({
    manifest: filteredManifest,
    options,
    targetDir,
    spawner: realSpawner,
  })

  return {
    targetDir,
    options,
    manifest,
    written: written.written,
    skipped: written.skipped,
    post,
  }
}
