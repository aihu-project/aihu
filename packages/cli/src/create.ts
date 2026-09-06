/**
 * `create-aihu` — interactive project scaffolder for `npx create-aihu@latest`.
 *
 * Usage:
 *   npx create-aihu@latest [project-name] [--template <id>]
 *   npm create aihu [project-name] -- --template <id>
 *   bun create aihu [project-name] --template <id>
 *
 * Features (SOTA npx create pattern):
 *   - Auto-detects available package managers (bun > pnpm > yarn > npm)
 *   - Interactive prompts via Node readline (zero extra dependencies)
 *   - `--template` spans BOTH tiers of the catalogue: the built-in templates
 *     embedded in @aihu/cli (minimal | full | docs | agent | ssr) and the
 *     npm-published `@aihu/templates-*` packages (installed on demand and run
 *     through the shared 6-stage scaffold pipeline).
 *   - Optional git init
 *   - Prints exact next steps with detected PM
 *
 * Why the npm-template tier lives here (FEL-422): `npx @aihu/cli app my-app`
 * cannot work — npx infers the bin from the package NAME and @aihu/cli's bins
 * are `aihu` and `create-aihu`, so npm users could never reach
 * `aihu app --template <pkg>`. `create-aihu` is the entry point they DO reach,
 * so it has to be the complete one.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { classifyPmFlag, firstPositional, PKG_MANAGERS_HINT } from './argv.js'
import { CLI_VERSION } from './cli-version.js'
import type { AppTemplate, CssChoice, PkgManager, ShadowChoice } from './index.js'
import { scaffoldApp } from './index.js'
import { parseOptionsJson } from './options-json.js'
import { scaffoldFromTemplatePackage } from './scaffold-pipeline.js'
import { formatTemplateCatalog, type KnownTemplate, selectTemplate } from './templates-registry.js'

// ─── Colour helpers (no deps) ────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  purple: '\x1b[35m',
}

function bold(s: string): string {
  return `${c.bold}${s}${c.reset}`
}
function dim(s: string): string {
  return `${c.dim}${s}${c.reset}`
}
function green(s: string): string {
  return `${c.green}${s}${c.reset}`
}
function cyan(s: string): string {
  return `${c.cyan}${s}${c.reset}`
}
function yellow(s: string): string {
  return `${c.yellow}${s}${c.reset}`
}
function purple(s: string): string {
  return `${c.purple}${s}${c.reset}`
}

// ─── Package manager detection ───────────────────────────────────────────────

/** Check if a program exists by running `pm --version` via spawnSync (no shell). */
function pmExists(pm: string): boolean {
  const r = spawnSync(pm, ['--version'], { stdio: 'ignore', shell: false })
  return r.status === 0
}

function detectPm(): PkgManager {
  for (const pm of ['bun', 'pnpm', 'yarn', 'npm'] as const) {
    if (pmExists(pm)) return pm
  }
  return 'npm'
}

// ─── Readline prompt helper ───────────────────────────────────────────────────

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((res) => rl.question(question, res))
}

// ─── Argv flag helpers (pre-fill / skip prompts) ─────────────────────────────

const argv = process.argv.slice(2)

function extractFlag(flag: string): string | undefined {
  const long = `--${flag}`
  const longEq = `${long}=`
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === long) return argv[i + 1]
    if (a.startsWith(longEq)) return a.slice(longEq.length)
  }
  return undefined
}

function hasFlag(flag: string): boolean {
  return argv.includes(`--${flag}`)
}

/**
 * Resolve the css-engine choice from argv (`--css engine|none` or the
 * `--css-engine` boolean alias). Returns `undefined` when no css flag was
 * passed, so the wizard knows to prompt.
 */
function cssFromArgv(): CssChoice | undefined {
  if (hasFlag('css-engine')) return 'engine'
  const raw = extractFlag('css')
  if (raw === 'engine') return 'engine'
  if (raw === 'none') return 'none'
  return undefined
}

/** Resolve the shadow-mode choice from argv, or `undefined` to prompt. */
function shadowFromArgv(): ShadowChoice | undefined {
  const raw = extractFlag('shadow')
  if (raw === 'light' || raw === 'shadow') return raw
  return undefined
}

// ─── Template selection (built-ins + npm packages) ───────────────────────────

/**
 * What `--template` resolved to, including the two "user needs the list" cases
 * that used to silently fall back to `minimal`:
 *
 *   `--template` with no value      -> { kind: 'missing' }
 *   `--template cf-team`            -> { kind: 'package' }   (was: minimal!)
 *   `--template nonsense`           -> { kind: 'unknown' }   (was: minimal!)
 *
 * Silently scaffolding a `minimal` app when the user asked for something else
 * is the worst of the available failure modes — the run "succeeds" and the
 * user finds out much later.
 */
export type CreateTemplateChoice =
  | { readonly kind: 'absent' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'builtin'; readonly name: AppTemplate }
  | { readonly kind: 'package'; readonly id: string; readonly pkg: KnownTemplate }
  | { readonly kind: 'unpublished'; readonly id: string }
  | { readonly kind: 'unknown'; readonly raw: string }

/**
 * Pure classifier over an argv tail. Exported for tests.
 *
 * `present` vs `value` matters: `--template` as the last token (or immediately
 * followed by another flag) is a user who wants the list, not a user who wants
 * the default.
 */
export function classifyTemplateArg(args: ReadonlyArray<string>): CreateTemplateChoice {
  let raw: string | undefined
  let present = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--template') {
      present = true
      const next = args[i + 1]
      raw = next !== undefined && !next.startsWith('-') ? next : undefined
      break
    }
    if (a.startsWith('--template=')) {
      present = true
      raw = a.slice('--template='.length)
      break
    }
  }
  if (!present) return { kind: 'absent' }
  if (raw === undefined || raw === '') return { kind: 'missing' }

  const sel = selectTemplate(raw)
  switch (sel.kind) {
    case 'builtin':
      return { kind: 'builtin', name: sel.id as AppTemplate }
    case 'package':
      return { kind: 'package', id: sel.id, pkg: sel.pkg }
    case 'unpublished':
      return { kind: 'unpublished', id: sel.id }
    case 'unknown':
      return { kind: 'unknown', raw: sel.raw }
  }
}

/** Resolve the built-in template choice from argv, or `undefined` to prompt. */
function templateFromArgv(): AppTemplate | undefined {
  const choice = classifyTemplateArg(argv)
  return choice.kind === 'builtin' ? choice.name : undefined
}

/**
 * Resolve the package-manager choice from argv, or `undefined` to prompt.
 *
 * An unusable `--pm` exits 1 rather than falling through to `undefined`, which
 * meant "the user did not choose" — so `create-aihu app --pm garbage --yes`
 * pinned the DETECTED package manager into `packageManager` and said nothing.
 * That pin is enforced by corepack, so the very next command the wizard prints
 * (`<pm> install`) refuses to run. Same triage `--template` already gets, three
 * function definitions above.
 */
function pmFromArgv(): PkgManager | undefined {
  const flag = classifyPmFlag(argv)
  if (flag.kind === 'value') return flag.pm
  if (flag.kind === 'missing') failUsage(`--pm needs a value (${PKG_MANAGERS_HINT}).`)
  if (flag.kind === 'unknown') {
    failUsage(`unknown --pm value ${JSON.stringify(flag.raw)}. Valid: ${PKG_MANAGERS_HINT}.`)
  }
  return undefined
}

/**
 * Pure resolution of every scaffold option from flags + environment, with
 * documented defaults. Used by the non-interactive path (`--yes` or non-TTY
 * stdin) so piped/scripted invocations never hang waiting on a prompt that can
 * never be answered.
 *
 * Defaults: template=minimal, pm=detected, css=none, git=on.
 */
export interface ResolvedCreateOptions {
  readonly template: AppTemplate
  readonly pm: PkgManager
  readonly css: CssChoice
  /**
   * Explicit shadow-mode choice, or `undefined` when the user did not choose —
   * the scaffold then emits no plugin-global `css: { shadowMode }` block and
   * the DA4 framework defaults apply (pages/layouts light, leaves shadow).
   * Fabricating a default here would pin it into vite.config.ts (FEL-425).
   */
  readonly shadowMode: ShadowChoice | undefined
  readonly initGit: boolean
  /**
   * Coding-assistant files (AGENTS.md, CLAUDE.md, .mcp.json). On by default;
   * `--no-agent-tooling` opts out. Governs ONLY those developer-environment
   * files — the app's own runtime agent surface ($action, llms.txt, cards) is
   * the product thesis and is never affected.
   */
  readonly agentTooling: boolean
}

export function resolveCreateOptions(opts: {
  template?: AppTemplate | undefined
  pm?: PkgManager | undefined
  css?: CssChoice | undefined
  shadow?: ShadowChoice | undefined
  /** `false` when `--no-git` is present. */
  git?: boolean | undefined
  /** `false` when `--no-agent-tooling` is present. */
  agentTooling?: boolean | undefined
  /** Detected package manager fallback (so this stays pure/testable). */
  detected: PkgManager
}): ResolvedCreateOptions {
  const css: CssChoice = opts.css ?? 'none'
  // Only a genuine `--shadow` choice survives; `undefined` means the scaffold
  // emits no shadowMode and the framework defaults decide (FEL-425).
  const shadowMode: ShadowChoice | undefined = css === 'engine' ? opts.shadow : undefined
  return {
    template: opts.template ?? 'minimal',
    pm: opts.pm ?? opts.detected,
    css,
    shadowMode,
    initGit: opts.git ?? true,
    agentTooling: opts.agentTooling ?? true,
  }
}

/** True when the run must be fully non-interactive: `--yes`/`-y` was passed, or
 * stdin is not a TTY (piped/redirected input — Node readline drops buffered
 * lines at EOF, which silently no-ops the wizard). */
function isNonInteractive(): boolean {
  return hasFlag('yes') || argv.includes('-y') || !process.stdin.isTTY
}

// ─── Project name + help ─────────────────────────────────────────────────────

/**
 * First positional argument = the project name. Skips flags AND the values of
 * value-taking flags, so `create-aihu --template cf-team my-app` names the app
 * `my-app` — not `--template` (which is what `process.argv[2]` gave you).
 * Exported for tests.
 *
 * The implementation moved to `argv.ts` when `aihu app` adopted it: that path
 * was still reading `rest[0]` and happily scaffolding a directory named `--pm`.
 */
export function parseProjectName(args: ReadonlyArray<string>): string | undefined {
  return firstPositional(args)
}

/** The `--help` / error-path usage text. Plain text; exported for tests. */
export function usageText(): string {
  return [
    'Usage:',
    '  npm create aihu <project-name> -- [options]',
    '  npx create-aihu <project-name> [options]',
    '  bun create aihu <project-name> [options]',
    '',
    'Options:',
    '  --template <id>     Template to scaffold from (see the list below)',
    '  --pm <bun|pnpm|npm|yarn>   Package manager (default: auto-detected)',
    '  --css <engine|none>        Include @aihu/css-engine (built-in templates only)',
    '  --shadow <light|shadow>    Force one shadow mode project-wide when --css engine is set',
    '                             (default: framework defaults — light-DOM pages/layouts, shadow-DOM leaves)',
    '  --options-json <JSON>      npm template packages only (e.g. --template cf-team):',
    "                             overrides for the template manifest's `overridable`",
    '                             cells, e.g. \'{"auth":"supabase","starter":"empty"}\'',
    '  --no-agent-tooling  Skip AGENTS.md/CLAUDE.md/.mcp.json (coding-assistant files).',
    "                      Your app's own agent surface is unaffected.",
    '  --no-git            Skip git init',
    '  --no-install        Skip dependency install (npm templates only)',
    '  --yes, -y           Non-interactive; take documented defaults',
    '  --help, -h          Show this message',
    '  --version, -v       Print the @aihu/cli version',
    '',
    'Templates for --template:',
    formatTemplateCatalog('  '),
    'Examples:',
    '  npm create aihu my-app -- --template minimal',
    '  npx create-aihu my-app --template cf-team',
    '',
  ].join('\n')
}

/**
 * An invocation we cannot act on: the reason, a pointer to `--help`, exit 1.
 * The one error dialect this entry point speaks.
 */
function failUsage(message: string): never {
  process.stderr.write(`\n  ${c.red}error${c.reset} ${message}\n\n`)
  process.stderr.write(`  Run with ${bold('--help')} for the full option list.\n\n`)
  process.exit(1)
}

/**
 * Print the catalogue + exit non-zero. Every "we cannot use that TEMPLATE" path
 * routes through here, so the user never has to already know the names.
 */
function failWithCatalog(message: string): never {
  process.stderr.write(`\n  ${c.red}error${c.reset} ${message}\n\n`)
  process.stderr.write(`  Available templates:\n${formatTemplateCatalog('    ')}\n`)
  process.stderr.write(`  Run with ${bold('--help')} for the full option list.\n\n`)
  process.exit(1)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // `--help` is answered before the banner so the output pipes cleanly.
  if (hasFlag('help') || argv.includes('-h')) {
    process.stdout.write(usageText())
    process.exit(0)
  }
  // …and so is `--version`, for the same reason plus a worse one: this handler
  // did not exist. `bin.ts` grew real `--version` support and `create.ts` — the
  // ONLY bin npm users can actually reach, per this file's own docblock — never
  // did, so the flag fell through to the positional/non-interactive path and
  // `create-aihu --version` CREATED A DIRECTORY (`my-aihu-app/`) and exited 0.
  // An advertised informational flag that is unreachable is bad; one that is
  // destructive instead of a no-op is a defect. Same version source as
  // `bin.ts`, inlined from package.json at build time, so the two bins in this
  // package cannot report different versions of themselves.
  if (hasFlag('version') || argv.includes('-v')) {
    process.stdout.write(`${CLI_VERSION}\n`)
    process.exit(0)
  }

  process.stdout.write('\n')
  process.stdout.write(`${purple(bold('◆'))} ${bold('Create Aihu App')}\n`)
  process.stdout.write(`${dim('  Web Components, reactive.')}\n\n`)

  const detected = detectPm()
  const nonInteractive = isNonInteractive()

  // ── `--template` triage ─────────────────────────────────────────────────────
  // Anything we cannot honor exits non-zero WITH the catalogue, on both the
  // interactive and non-interactive paths. Previously all three of these cases
  // silently produced a `minimal` app.
  const choice = classifyTemplateArg(argv)
  switch (choice.kind) {
    case 'missing':
      failWithCatalog('--template needs a value.')
      break
    case 'unknown':
      failWithCatalog(`unknown template ${JSON.stringify(choice.raw)}.`)
      break
    case 'unpublished':
      failWithCatalog(
        `template ${JSON.stringify(choice.id)} is declared in the aihu registry but is ` +
          'not published to npm yet, so it cannot be scaffolded.',
      )
      break
    default:
      break
  }

  const nameArg = parseProjectName(argv)

  // ── npm template package path ───────────────────────────────────────────────
  // Runs the SAME pipeline as `aihu app --template <pkg>` (shared in
  // scaffold-pipeline.ts) — this is the tier npm users could not reach.
  if (choice.kind === 'package') {
    const projectName = nameArg && nameArg !== '.' ? nameArg : 'my-aihu-app'
    try {
      await scaffoldFromTemplatePackage({
        appName: projectName,
        templatePkg: choice.pkg,
        pm: pmFromArgv() ?? detected,
        noGit: hasFlag('no-git'),
        noInstall: hasFlag('no-install'),
        noAutoInstall: hasFlag('no-auto-install-template'),
        // `--options-json` was already in VALUE_FLAGS (so its value never got
        // mistaken for the project name) but was read by nobody here, so
        // `create-aihu my-app --template cf-team --options-json '{"auth":"kinde"}'`
        // silently scaffolded better-auth. `bin.ts` threaded the same flag with
        // real validation; there is no comment or test suggesting the omission
        // was deliberate, and this is the ONLY path npm users reach — so it
        // shares bin.ts's parser rather than growing a second one.
        userOverrides: parseOptionsJson(extractFlag('options-json')),
      })
    } catch (err) {
      // Surface the real reason and exit non-zero. A scaffold that prints an
      // error and exits 0 is the failure mode that lets broken templates look
      // like successes in CI.
      process.stderr.write(`\n  ${c.red}error${c.reset} ${(err as Error).message}\n\n`)
      process.exit(1)
    }
    return
  }

  // ── Non-interactive path (--yes / -y or non-TTY stdin) ──────────────────────
  // Every unset option takes its documented default; NO prompts are issued.
  // This is the pipe-safe fix: `printf '' | create-aihu demo --yes` (or any
  // redirected stdin) deterministically scaffolds and exits 0 instead of
  // silently no-op'ing when readline loses its buffered lines at EOF.
  if (nonInteractive) {
    const projectName = nameArg && nameArg !== '.' ? nameArg : 'my-aihu-app'
    const opts = resolveCreateOptions({
      template: templateFromArgv(),
      pm: pmFromArgv(),
      css: cssFromArgv(),
      shadow: shadowFromArgv(),
      git: hasFlag('no-git') ? false : undefined,
      agentTooling: hasFlag('no-agent-tooling') ? false : undefined,
      detected,
    })
    await scaffoldAndReport(projectName, opts)
    return
  }

  // ── Interactive (TTY) path ──────────────────────────────────────────────────
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  // ── Project name ──────────────────────────────────────────────────────────
  let projectName: string
  if (nameArg && nameArg !== '.') {
    projectName = nameArg
    process.stdout.write(`${dim('  Project name:')} ${cyan(projectName)}\n`)
  } else {
    const answer = await prompt(rl, `${dim('  Project name:')} `)
    projectName = answer.trim() || 'my-aihu-app'
  }

  const targetDir = resolve(process.cwd(), projectName)

  if (existsSync(targetDir)) {
    const overwrite = await prompt(
      rl,
      `${yellow('  !')} Directory ${bold(projectName)} already exists. Overwrite? ${dim('[y/N]')} `,
    )
    if (!overwrite.trim().toLowerCase().startsWith('y')) {
      rl.close()
      process.stdout.write(dim('  Aborted.\n\n'))
      process.exit(0)
    }
  }

  // ── Template ──────────────────────────────────────────────────────────────
  // A `--template` flag short-circuits the prompt (mirrors `nameArg`).
  let template: AppTemplate
  const templateArg = templateFromArgv()
  if (templateArg !== undefined) {
    template = templateArg
    process.stdout.write(`${dim('  Template:')} ${cyan(template)}\n`)
  } else {
    process.stdout.write('\n')
    process.stdout.write(`${dim('  Select template:')}\n`)
    process.stdout.write(
      `    ${cyan('1)')} minimal  — smallest runnable aihu app; the counter teaches @state/$action ${dim('(recommended)')}\n`,
    )
    process.stdout.write(
      `    ${cyan('2)')} full     — the dual-experience demo: a word game you, a model, and any MCP agent play\n`,
    )
    process.stdout.write(`    ${cyan('3)')} docs     — docs site starter\n`)
    process.stdout.write(
      `    ${cyan('4)')} agent    — capability-bridge task-list demo ${dim('(folding into full)')}\n`,
    )
    process.stdout.write(
      `    ${cyan('5)')} ssr      — server-rendered on Cloudflare Workers (deploy with wrangler)\n`,
    )
    const templateAnswer = await prompt(rl, `  ${dim('Template [1]:')} `)
    const templateMap: Record<string, AppTemplate> = {
      '': 'minimal',
      '1': 'minimal',
      minimal: 'minimal',
      '2': 'full',
      full: 'full',
      '3': 'docs',
      docs: 'docs',
      '4': 'agent',
      agent: 'agent',
      '5': 'ssr',
      ssr: 'ssr',
    }
    template = templateMap[templateAnswer.trim().toLowerCase()] ?? 'minimal'
  }

  // ── Package manager ───────────────────────────────────────────────────────
  // A `--pm` flag short-circuits the prompt.
  let pm: PkgManager
  const pmArg = pmFromArgv()
  if (pmArg !== undefined) {
    pm = pmArg
    process.stdout.write(`${dim('  Package manager:')} ${cyan(pm)}\n`)
  } else {
    process.stdout.write('\n')
    process.stdout.write(`${dim('  Package manager:')}\n`)
    process.stdout.write(`    ${cyan('1)')} bun   ${detected === 'bun' ? dim('(detected)') : ''}\n`)
    process.stdout.write(
      `    ${cyan('2)')} pnpm  ${detected === 'pnpm' ? dim('(detected)') : ''}\n`,
    )
    process.stdout.write(
      `    ${cyan('3)')} yarn  ${detected === 'yarn' ? dim('(detected)') : ''}\n`,
    )
    process.stdout.write(`    ${cyan('4)')} npm   ${detected === 'npm' ? dim('(detected)') : ''}\n`)
    const pmAnswer = await prompt(rl, `  ${dim(`Package manager [${detected}]:`)} `)
    const pmMap: Record<string, PkgManager> = {
      '': detected,
      '1': 'bun',
      bun: 'bun',
      '2': 'pnpm',
      pnpm: 'pnpm',
      '3': 'yarn',
      yarn: 'yarn',
      '4': 'npm',
      npm: 'npm',
    }
    pm = pmMap[pmAnswer.trim().toLowerCase()] ?? detected
  }

  // ── CSS engine (utility classes) ────────────────────────────────────────────
  // Argv flags (`--css engine|none`, `--css-engine`, `--shadow ...`) suppress the
  // corresponding prompt, mirroring how `nameArg` short-circuits the name prompt.
  let css: CssChoice
  const cssArg = cssFromArgv()
  if (cssArg !== undefined) {
    css = cssArg
    process.stdout.write(`${dim('  CSS engine:')} ${cyan(css === 'engine' ? 'yes' : 'no')}\n`)
  } else {
    const cssAnswer = await prompt(
      rl,
      `\n  Include ${bold('@aihu/css-engine')} (utility classes)? ${dim('[y/N]')} `,
    )
    css = cssAnswer.trim().toLowerCase().startsWith('y') ? 'engine' : 'none'
  }

  // Shadow mode only matters when css-engine is on. `undefined` means the
  // user made no explicit choice — the scaffold then emits no plugin-global
  // `css: { shadowMode }` block and the DA4 framework defaults apply
  // (pages/layouts light DOM, leaf components shadow DOM). Pressing Enter is
  // NOT a choice: fabricating one would pin the framework default into
  // vite.config.ts and freeze it (FEL-425).
  let shadowMode: ShadowChoice | undefined
  if (css === 'engine') {
    const shadowArg = shadowFromArgv()
    if (shadowArg !== undefined) {
      shadowMode = shadowArg
      process.stdout.write(`${dim('  Shadow mode:')} ${cyan(shadowMode)}\n`)
    } else {
      process.stdout.write('\n')
      process.stdout.write(`${dim('  Shadow mode:')}\n`)
      process.stdout.write(
        `    ${cyan('1)')} default ${dim('(framework defaults — light-DOM pages/layouts, shadow-DOM leaves)')}\n`,
      )
      process.stdout.write(
        `    ${cyan('2)')} shadow  ${dim('(force shadow project-wide — utilities fold into each shadow style)')}\n`,
      )
      process.stdout.write(
        `    ${cyan('3)')} light   ${dim('(force light DOM project-wide — global cascade)')}\n`,
      )
      const shadowAnswer = await prompt(rl, `  ${dim('Shadow mode [1]:')} `)
      const shadowMap: Record<string, ShadowChoice> = {
        '2': 'shadow',
        shadow: 'shadow',
        '3': 'light',
        light: 'light',
      }
      shadowMode = shadowMap[shadowAnswer.trim().toLowerCase()]
    }
  }

  // ── Git init ──────────────────────────────────────────────────────────────
  // `--no-git` skips the prompt entirely (default remains git on).
  let initGit: boolean
  if (hasFlag('no-git')) {
    initGit = false
    process.stdout.write(`${dim('  Git:')} ${cyan('skipped')}\n`)
  } else {
    const gitAnswer = await prompt(rl, `\n  Initialize git repo? ${dim('[Y/n]')} `)
    initGit = !gitAnswer.trim().toLowerCase().startsWith('n')
  }

  rl.close()

  await scaffoldAndReport(projectName, {
    template,
    pm,
    css,
    shadowMode,
    initGit,
    // Flag-only (no prompt): tooling is on unless explicitly declined.
    agentTooling: !hasFlag('no-agent-tooling'),
  })
}

/** The identity `git commit` uses when the ambient config resolves neither a
 * `user.name` nor a `user.email`. Deliberately the SAME pair that
 * `scaffold-pipeline.ts`'s `git-init` step passes, so the two implementations
 * of "initialize the scaffold's repo" cannot drift into disagreeing again —
 * that divergence is what FEL-431 defect 5 was. */
const FALLBACK_IDENTITY = { name: 'aihu', email: 'scaffold@aihu.dev' } as const

/** True when `git config <key>` resolves to something non-empty in `dir`.
 * Must be asked AFTER `git init`, so repo-local config counts. */
function gitConfigResolves(dir: string, key: string): boolean {
  const r = spawnSync('git', ['-C', dir, 'config', '--get', key], {
    stdio: ['ignore', 'pipe', 'ignore'],
    shell: false,
    encoding: 'utf8',
  })
  return r.status === 0 && r.stdout.trim().length > 0
}

/** `git init` + `add -A` + `commit`, stopping at the FIRST failure so a later
 * command cannot paper over an earlier one.
 *
 * Two defects this fixes, both of which shipped in the `create-aihu` wizard
 * while the `aihu app` pipeline path had already been fixed (#632):
 *
 *  1. **No exit status was read.** All three commands ran with `stdio:
 *     'ignore'` and their statuses discarded, then the wizard printed a green
 *     `✓ git init` unconditionally — so any failure produced an unborn HEAD
 *     under a checkmark claiming otherwise. `git rev-parse HEAD` then exits
 *     128, which is exactly the FEL-431 defect 5 breakage: moon cannot answer
 *     a question about HEAD, so `dev`, `build` and `typecheck` all die — every
 *     command this wizard prints as the next step. This half is independent of
 *     identity: it is wrong to claim a success you did not check.
 *
 *     NOTE, corrected against #632's comment rather than inherited from it:
 *     that comment says `git commit` "fails outright when no user.name/
 *     user.email is resolvable, which is the normal state of CI runners". Only
 *     half true, measured on git 2.50.1 — with an empty config and no identity
 *     env `git commit` SUCCEEDS (rc=0), auto-deriving `username@hostname`. It
 *     fails (rc=128) when that derivation is unavailable or forbidden
 *     (`user.useConfigOnly`), which is the slim-container case, not merely the
 *     unset-config case. The distinction is load-bearing for the test: one
 *     written to the inherited wording passes whether or not the fallback
 *     below exists.
 *  2. **Identity was taken from ambient config only.** Ambient is the RIGHT
 *     default here, unlike the pipeline path: a human running the wizard on
 *     their own machine should author their own first commit. But when nothing
 *     resolves there must be a fallback, or point 1's failure is merely
 *     reported rather than avoided.
 *
 * Returns the failing command verbatim so the caller can name it. `status` is
 * `number | null` — `spawnSync` reports null when the child was killed by a
 * signal rather than exiting, and null is a failure, not a pass. */
export function initGitRepo(
  targetDir: string,
): { ok: true } | { ok: false; failed: string; status: number | null } {
  const run = (
    args: readonly string[],
  ): { ok: true } | { ok: false; failed: string; status: number | null } => {
    const r = spawnSync('git', [...args], { stdio: 'ignore', shell: false })
    if (r.status === 0) return { ok: true }
    return { ok: false, failed: `git ${args.join(' ')}`, status: r.status }
  }

  const init = run(['init', targetDir])
  if (!init.ok) return init
  // Pin the branch name; `git init` alone takes whatever ambient
  // `init.defaultBranch` says, and the cf-team template's
  // `.moon/workspace.yml` declares `defaultBranch: 'main'`. A mismatch makes
  // moon resolve `base="main"` against a repo with no `main` and exit 128.
  run(['-C', targetDir, 'symbolic-ref', 'HEAD', 'refs/heads/main'])
  const add = run(['-C', targetDir, 'add', '-A'])
  if (!add.ok) return add

  // Asked after `init` so repo-local config counts, and asked per-key because
  // a machine can resolve one and not the other.
  const identity =
    gitConfigResolves(targetDir, 'user.name') && gitConfigResolves(targetDir, 'user.email')
      ? []
      : ['-c', `user.name=${FALLBACK_IDENTITY.name}`, '-c', `user.email=${FALLBACK_IDENTITY.email}`]

  return run(['-C', targetDir, ...identity, 'commit', '-m', 'chore: initial aihu scaffold'])
}

/** Shared scaffold + git + next-steps reporting, used by both the interactive
 * and non-interactive paths. */
async function scaffoldAndReport(
  projectName: string,
  resolved: ResolvedCreateOptions,
): Promise<void> {
  const { template, pm, css, shadowMode, initGit, agentTooling } = resolved
  const targetDir = resolve(process.cwd(), projectName)

  // ── Scaffold ──────────────────────────────────────────────────────────────
  process.stdout.write('\n')
  const cssLabel = css === 'engine' ? ` / css-engine:${shadowMode ?? 'default'}` : ''
  process.stdout.write(
    `${dim('  Creating')} ${cyan(projectName)} ${dim(`(${template} / ${pm}${cssLabel})…`)}\n\n`,
  )

  const result = scaffoldApp(projectName, process.cwd(), {
    pm,
    template,
    css,
    shadowMode,
    agentTooling,
  })

  for (const f of result.created) process.stdout.write(`  ${green('+')} ${f}\n`)
  for (const f of result.skipped)
    process.stdout.write(`  ${yellow('·')} ${f} ${dim('(skipped)')}\n`)

  // ── Git ───────────────────────────────────────────────────────────────────
  if (initGit) {
    const git = initGitRepo(targetDir)
    if (git.ok) {
      process.stdout.write(`\n  ${green('✓')} git init\n`)
    } else {
      // Do NOT print the checkmark. The scaffolded files are on disk and are
      // fine; only the repo is missing, so this is a warning, not a failure of
      // `create`. But it must be visible: an unborn HEAD makes `moon` exit 128
      // on every command this wizard is about to print as the next step.
      process.stdout.write(
        `\n  ${yellow('!')} git init skipped — \`${git.failed}\` exited ${git.status ?? 'on a signal'}\n` +
          `    ${dim('The project is scaffolded; only the git repo is missing. Run `git init` yourself.')}\n`,
      )
    }
  }

  // ── Next steps ────────────────────────────────────────────────────────────
  const installCmd: Record<PkgManager, string> = {
    bun: 'bun install',
    pnpm: 'pnpm install',
    npm: 'npm install',
    yarn: 'yarn',
  }
  const devCmd: Record<PkgManager, string> = {
    bun: 'bun run dev',
    pnpm: 'pnpm dev',
    npm: 'npm run dev',
    yarn: 'yarn dev',
  }

  process.stdout.write(`\n  ${green(bold('✓'))} Done!\n\n`)
  process.stdout.write(`  Next steps:\n\n`)
  process.stdout.write(`    ${cyan(`cd ${projectName}`)}\n`)
  process.stdout.write(`    ${cyan(installCmd[pm])}\n`)
  process.stdout.write(`    ${cyan(devCmd[pm])}\n`)
  process.stdout.write('\n')
  process.stdout.write(`  ${dim('Docs:')} https://github.com/aihu-project/aihu\n\n`)
}

/** True when this module is the process entry point (the `create-aihu` bin),
 * not when imported (e.g. by the unit tests for `resolveCreateOptions`). Uses
 * an argv[1] vs module-path comparison that works on both node and bun. */
function isCliEntry(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isCliEntry()) {
  main().catch((err: unknown) => {
    process.stderr.write(`\n  ${c.red}error${c.reset} ${String(err)}\n\n`)
    process.exit(1)
  })
}
