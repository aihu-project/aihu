/**
 * @aihu/cli bin entry — parses argv and dispatches to commands.
 *
 * Usage:
 *   aihu app <name>            Scaffold a new application
 *   aihu page <route>          Scaffold a page file
 *   aihu component <name>      Scaffold a component file
 *   aihu plugin <name>         Scaffold a plugin package
 *   aihu dev [options]         Start development server (arch-4 §3)
 *   aihu build [options]       Production build (arch-4 §3)
 *   aihu deploy [options]      Deploy via the configured platform adapter (arch-4 §3)
 *   aihu migrate <files...>    Migrate legacy SFC syntax to v1.0+ canonical forms
 *   aihu add <names...>        Copy styled recipes from @aihu/ui (css-5 §9.6)
 *   aihu list [--installed]    List registry recipes (css-5 §9.6)
 *   aihu --help | --version    Help / version, on stdout, exit 0
 *
 * `usageText()` in `./usage.ts` is the authoritative flag list — this summary
 * is a table of contents, not a second source of truth.
 */

import { resolve } from 'node:path'
import { classifyPmFlag, firstPositional, PKG_MANAGERS_HINT } from './argv.js'
import { CLI_VERSION } from './cli-version.js'
import type { CssChoice, PkgManager, ShadowChoice } from './index.js'
import { scaffoldApp, scaffoldComponent, scaffoldPage, scaffoldPlugin, toKebab } from './index.js'
import { parseOptionsJson } from './options-json.js'
import {
  printNextSteps,
  type ResolvedOptions,
  scaffoldFromTemplatePackage,
} from './scaffold-pipeline.js'
import { formatTemplateCatalog, selectTemplate } from './templates-registry.js'
import { usageText } from './usage.js'

const [, , cmd, ...rest] = process.argv

/**
 * Pull the value of `--<flag> <V>` (or `--<flag>=<V>`) out of an argv tail.
 * Returns `undefined` when the flag is absent.
 */
function extractFlag(args: ReadonlyArray<string>, flag: string): string | undefined {
  const long = `--${flag}`
  const longEq = `${long}=`
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === long) return args[i + 1]
    if (a.startsWith(longEq)) return a.slice(longEq.length)
  }
  return undefined
}

/** True when `--<flag>` (boolean) appears in argv. */
function hasFlag(args: ReadonlyArray<string>, flag: string): boolean {
  return args.includes(`--${flag}`)
}

/**
 * `--pm <bun|pnpm|npm|yarn>`, defaulting to bun when the flag is ABSENT — and
 * exiting 1 when it is present with a value we cannot honor.
 *
 * Shared by both scaffold paths because the built-in one used to parse it
 * nowhere at all: `aihu app x --pm pnpm` dropped the flag on the floor and
 * scaffolded with the `pm` default, so the emitted package.json carried
 * `"packageManager": "bun@…"` and `pnpm install` refused to run before
 * resolving a single dependency — `ERROR: This project is configured to use
 * bun`. The interactive `create-aihu` path always threaded it correctly, which
 * is why the hole survived: the two entry points disagreed about the same flag.
 *
 * Threading the flag fixed the valid values and left the invalid ones falling
 * into the same trap: `--pm garbage` and a dangling `--pm` both resolved to
 * `'bun'` in silence, producing exactly the wrong pin described above with no
 * indication the flag had been discarded. They now fail the way `--template`
 * already does — the two are the same kind of mistake and deserve the same
 * answer.
 */
function resolvePmFlag(args: ReadonlyArray<string>): PkgManager {
  const flag = classifyPmFlag(args)
  if (flag.kind === 'absent') return 'bun'
  if (flag.kind === 'value') return flag.pm
  if (flag.kind === 'missing') failUsage(`--pm needs a value (${PKG_MANAGERS_HINT}).`)
  failUsage(`unknown --pm value ${JSON.stringify(flag.raw)}. Valid: ${PKG_MANAGERS_HINT}.`)
}

function extractTemplateFlag(args: ReadonlyArray<string>): string | undefined {
  return extractFlag(args, 'template')
}

/**
 * Parse the OOTB css-engine flags for the legacy `aihu app` scaffold path.
 *
 *   --css <engine|none>     include @aihu/css-engine OOTB (default: none)
 *   --css-engine            boolean alias for `--css engine`
 *   --shadow <light|shadow>       explicit shadow mode when css-engine is on
 *
 * `shadowMode` is `undefined` unless the user explicitly chose one — the
 * scaffold then emits no plugin-global `css: { shadowMode }` block and the
 * DA4 framework defaults apply (pages/layouts light, leaves shadow). A
 * fabricated default written into vite.config.ts would silently pin the
 * framework default at scaffold time (FEL-425).
 *
 * `--shadow` is only meaningful with css-engine; passed without it, we warn and
 * ignore so the semantics stay clear. Invalid values are ignored (framework
 * defaults) with a stderr note rather than aborting the scaffold.
 */
function parseCssOptions(args: ReadonlyArray<string>): {
  css: CssChoice
  shadowMode: ShadowChoice | undefined
} {
  const cssRaw = extractFlag(args, 'css')
  const cssEngineAlias = hasFlag(args, 'css-engine')
  let css: CssChoice = 'none'
  if (cssEngineAlias || cssRaw === 'engine') {
    css = 'engine'
  } else if (cssRaw !== undefined && cssRaw !== 'none') {
    process.stderr.write(`  ! Unknown --css value '${cssRaw}'; using 'none'.\n`)
  }

  const shadowRaw = extractFlag(args, 'shadow')
  let shadowMode: ShadowChoice | undefined
  if (shadowRaw === 'light' || shadowRaw === 'shadow') {
    shadowMode = shadowRaw
  } else if (shadowRaw !== undefined) {
    process.stderr.write(
      `  ! Unknown --shadow value '${shadowRaw}'; ignoring (framework defaults apply).\n`,
    )
  }

  if (css !== 'engine' && shadowRaw !== undefined) {
    process.stderr.write('  ! --shadow has no effect without --css engine; ignoring.\n')
    shadowMode = undefined
  }

  return { css, shadowMode }
}

/**
 * Help to STDOUT, exit 0.
 *
 * `usage()` used to be one function that wrote to stderr and exited 1 for all
 * four of `--help`, `--version`, an unknown command, and no args at all — so a
 * typo produced byte-identical output to asking for help, on the same stream,
 * with the same exit code. Nothing downstream could tell them apart, and
 * `aihu --help | less` showed nothing.
 */
function printHelp(): never {
  process.stdout.write(`${usageText()}\n`)
  process.exit(0)
}

/** An invocation we cannot act on: message + pointer to `--help`, exit 1. */
function failUsage(message: string): never {
  process.stderr.write(`\nERROR: ${message}\n\nRun \`aihu --help\` for usage.\n`)
  process.exit(1)
}

/**
 * Pipeline dispatcher for `aihu app <name> --template <T>`. Replaces the
 * B1.1 stub: drives the 6 pure pipeline functions through the
 * realFileSystem + realSpawner injection seam.
 *
 * Flags honored (all of them documented in `usageText()`):
 *   --options-json <S>  (overrides for the manifest's `overridable` cells)
 *   --no-git                     (skip git-init post-install step)
 *   --no-install                 (skip pm-install + lint-fix post-install steps;
 *                                 useful for harness tests + offline scaffolding)
 *   --pm <bun|pnpm|...>         (package manager for pm-install + emitted scripts)
 *   --no-auto-install-template  (skip auto-install when template package is missing;
 *                                 surface the original error immediately)
 */
async function dispatchTemplate(args: {
  appName: string
  templatePkg: string
  rest: ReadonlyArray<string>
}): Promise<void> {
  const { appName, templatePkg, rest } = args

  // --- flag parsing ---
  const pm: ResolvedOptions['pm'] = resolvePmFlag(rest)
  //
  // `--use-defaults` and `--no-interactive` used to be parsed here into two
  // variables that were immediately `void`-discarded, under the comment
  // "Reserved for B2+ wiring". They are DELETED rather than kept, because
  // "silently accepted, does nothing" is strictly worse than "not a flag": a
  // scripted `aihu app x --use-defaults` looked supported and was not, and the
  // reservation was for prompts this dispatcher still does not issue. `aihu app`
  // is already fully non-interactive, so their described behaviour ("use
  // manifest defaults for unspecified overridable cells") is what mergeOptions()
  // unconditionally does — they could not have changed the output even wired up.
  // Reintroduce them alongside real prompts, not before.
  //
  // The 6-stage pipeline itself lives in scaffold-pipeline.ts so that
  // `create-aihu` drives the identical implementation (FEL-422).
  const result = await scaffoldFromTemplatePackage({
    appName,
    templatePkg,
    pm,
    noGit: hasFlag(rest, 'no-git'),
    noInstall: hasFlag(rest, 'no-install'),
    noAutoInstall: hasFlag(rest, 'no-auto-install-template'),
    userOverrides: parseOptionsJson(extractFlag(rest, 'options-json')),
  })

  // --- output summary ---
  for (const f of result.written) {
    process.stdout.write(`  created  ${f}\n`)
  }
  for (const f of result.skipped) {
    process.stdout.write(`  skipped  ${f} (already exists)\n`)
  }
  for (const step of result.post.ran) {
    process.stdout.write(`  ran      ${step.kind}\n`)
  }
  for (const step of result.post.skipped) {
    process.stdout.write(`  skipped  ${step.kind}\n`)
  }
  if (result.post.failures.length > 0) {
    for (const f of result.post.failures) {
      process.stderr.write(`  FAILED   ${f.step.kind}: ${f.error}\n`)
    }
    process.exit(1)
  }

  // --- 6. printNextSteps ---
  printNextSteps({ options: result.options, targetDir: result.targetDir })
}

async function main(): Promise<void> {
  // `--help` / `--version` are answered before anything else so they work
  // regardless of what follows them, and so their output pipes cleanly
  // (stdout, exit 0 — matching `create-aihu`'s own `--help` convention).
  if (cmd === '--help' || cmd === '-h' || rest.includes('--help') || rest.includes('-h')) {
    printHelp()
  }
  // Recognised anywhere in argv, exactly like `--help` immediately above.
  // It used to be tested against `argv[2]` alone, so `aihu --version` printed
  // the version but `aihu app foo --version` scaffolded a complete project —
  // two flags documented side by side in `usageText()` under "Global:", only
  // one of which was actually global.
  if (cmd === '--version' || cmd === '-v' || rest.includes('--version') || rest.includes('-v')) {
    process.stdout.write(`${CLI_VERSION}\n`)
    process.exit(0)
  }
  // Bare `aihu`: the user is asking what this thing does. Same answer as
  // `--help`, same stream, same exit code — an empty invocation is not an
  // error to report, it is a question to answer.
  if (!cmd) printHelp()

  // Async commands (dynamic-imported)
  if (cmd === 'dev') {
    const { default: dev } = await import('./commands/dev.js')
    await dev(rest)
    return
  }
  if (cmd === 'build') {
    const { default: build } = await import('./commands/build.js')
    await build(rest)
    return
  }
  if (cmd === 'deploy') {
    const { default: deploy } = await import('./commands/deploy.js')
    await deploy(rest)
    return
  }
  if (cmd === 'migrate') {
    // Bug 9c — wire the existing migrate command into the dispatcher so the
    // `Run: npx aihu migrate <file>` guidance emitted by C304/C305/C306 is
    // actually reachable. `migrate.ts` is a complete, tested implementation;
    // here we only parse argv and call its file-driving entry.
    const { migrateFiles } = await import('./commands/migrate.js')
    const dryRun = hasFlag(rest, 'dry-run')
    // #425 — `--v2` chains the v1→v2 macro-simplification pass after the
    // v0→v1 passes, giving external devs a CLI path to the v2 vocabulary.
    const v2 = hasFlag(rest, 'v2')
    // #487 — `--state` runs the @state wrapper-model codemod (spec §7):
    // `$`-macros → wrappers, signal tuples → `state()` incl. call sites.
    const state = hasFlag(rest, 'state')
    const files = rest.filter((a) => !a.startsWith('--'))
    if (files.length === 0) {
      // `failUsage`, not a bespoke block: this used to print a bare four-line
      // usage listing with no `ERROR:` marker and no pointer to `--help`, so
      // the dispatcher spoke two different error dialects depending on which
      // branch you tripped. `usageText()` already documents `--v2`,
      // `--state` and `--dry-run`, so nothing is lost by pointing at it.
      failUsage('aihu migrate needs at least one file.')
    }
    migrateFiles(files, dryRun, process.cwd(), v2, state)
    return
  }
  if (cmd === 'add') {
    const { default: add } = await import('./commands/add.js')
    await add(rest)
    return
  }
  if (cmd === 'list') {
    const { default: list } = await import('./commands/list.js')
    await list(rest)
    return
  }
  if (cmd === 'mcp') {
    const subCmd = rest[0]
    if (subCmd === 'serve') {
      const { default: mcpServe } = await import('./commands/mcp-serve.js')
      await mcpServe(rest.slice(1))
      return
    }
    // Same dialect unification as `migrate` above.
    failUsage(
      subCmd === undefined
        ? 'aihu mcp needs a subcommand; the only one is `aihu mcp serve`.'
        : `unknown \`aihu mcp\` subcommand ${JSON.stringify(subCmd)}; the only one is \`aihu mcp serve\`.`,
    )
  }

  // Scaffold commands (synchronous).
  //
  // An unknown command is rejected HERE, before argument parsing, and says
  // which word it did not recognise. It used to reprint the bare usage block on
  // stderr with exit 1 — byte-identical to what `--help` printed — so a typo
  // and a help request were indistinguishable to a human and to a script.
  if (cmd !== 'app' && cmd !== 'page' && cmd !== 'component' && cmd !== 'plugin') {
    failUsage(`unknown command ${JSON.stringify(cmd)}.`)
  }
  //
  // The positional is the first token that is neither a flag nor a flag's
  // value — `firstPositional`, the same parser `create-aihu` uses. Reading
  // `rest[0]` meant `aihu app --pm pnpm` scaffolded a complete project into a
  // directory literally named `--pm` and exited 0.
  const arg = firstPositional(rest)
  if (arg === undefined) {
    const what =
      cmd === 'app'
        ? 'a project name'
        : cmd === 'page'
          ? 'a route'
          : cmd === 'plugin'
            ? 'a plugin name'
            : 'a component name'
    failUsage(`aihu ${cmd} needs ${what}.`)
  }

  let result: { created: ReadonlyArray<string>; skipped: ReadonlyArray<string> }
  switch (cmd) {
    case 'app': {
      // B1.3: when --template <T> resolves in the registry, drive the real
      // 6-stage scaffold pipeline (resolveTemplate → mergeOptions →
      // enumerateFiles → readSubstituteWrite → runPostInstall →
      // printNextSteps). When --template is absent OR T is not a known
      // template name, fall through to the legacy scaffoldApp() path
      // (preserves R-CT-06 backward compatibility).
      const templatePresent = rest.some((a) => a === '--template' || a.startsWith('--template='))
      const tplFlag = extractTemplateFlag(rest)
      if (templatePresent && (tplFlag === undefined || tplFlag === '')) {
        // `--template` as the last token, or `--template=` with nothing after
        // the `=`. Previously indistinguishable from "flag absent" and fell
        // through to a silent `minimal` scaffold.
        process.stderr.write(
          `\nERROR: --template needs a value.\n\n` +
            `Available templates:\n${formatTemplateCatalog('  ')}\n`,
        )
        process.exit(1)
      }
      const selection = tplFlag !== undefined ? selectTemplate(tplFlag) : undefined
      if (selection?.kind === 'package') {
        await dispatchTemplate({ appName: arg, templatePkg: selection.pkg, rest })
        return
      }
      if (selection?.kind === 'unpublished') {
        // Previously this fell through to auto-install and died on an npm 404.
        // Say so up front instead.
        process.stderr.write(
          `\nERROR: template '${selection.id}' is declared in the aihu registry but is ` +
            `not published to npm yet, so it cannot be scaffolded.\n\n` +
            `Available templates:\n${formatTemplateCatalog('  ')}\n`,
        )
        process.exit(1)
      }
      if (selection?.kind === 'unknown') {
        // Previously fell through and silently scaffolded `minimal` — "the
        // run 'succeeds' and the user finds out much later" (create.ts's own
        // docblock names this the worst failure mode; this is the same bug
        // on the legacy `aihu app` path create.ts already fixed for itself).
        process.stderr.write(
          `\nERROR: unknown template ${JSON.stringify(selection.raw)}.\n\n` +
            `Available templates:\n${formatTemplateCatalog('  ')}\n`,
        )
        process.exit(1)
      }
      // Legacy scaffold path — honor the OOTB css-engine flags. With no
      // css flags this stays byte-identical to the historical output
      // (css defaults to 'none', shadow to unset/framework defaults); the
      // legacy-snapshot golden gates that.
      const { css, shadowMode } = parseCssOptions(rest)
      result = scaffoldApp(arg, undefined, {
        pm: resolvePmFlag(rest),
        css,
        shadowMode,
        // A built-in `--template` value now actually selects that built-in;
        // it used to be swallowed here and silently produce `minimal`.
        ...(selection?.kind === 'builtin' ? { template: selection.id } : {}),
      })
      break
    }
    case 'page':
      result = scaffoldPage(arg)
      break
    case 'component':
      result = scaffoldComponent(arg)
      break
    case 'plugin':
      result = scaffoldPlugin(arg)
      break
  }

  // `scaffoldApp`/`scaffoldPlugin` write into `<cwd>/<arg>/` but report paths
  // relative to that new directory, so the listing said `created  package.json`
  // for a file that is not at `./package.json`. Prefix it. `page`/`component`
  // write into the CURRENT project (`src/pages/…`), so their paths are already
  // correct relative to the cwd and must NOT be prefixed — which is why this is
  // keyed on the command rather than applied to every line.
  //
  // `plugin` needs the `aihu-plugin-` prefix `scaffoldPlugin` puts on the
  // directory it actually creates: reporting `created  my-forms/package.json`
  // for a file at `aihu-plugin-my-forms/package.json` is the same
  // wrong-path-in-the-listing defect this prefixing was added to fix, one
  // level further in.
  const prefix = cmd === 'app' ? `${arg}/` : cmd === 'plugin' ? `aihu-plugin-${toKebab(arg)}/` : ''
  for (const f of result.created) {
    process.stdout.write(`  created  ${prefix}${f}\n`)
  }
  for (const f of result.skipped) {
    process.stdout.write(`  skipped  ${prefix}${f} (already exists)\n`)
  }

  if (result.created.length === 0) {
    process.stdout.write('\nNothing to do — all files already exist.\n')
    return
  }
  process.stdout.write(`\nDone. ${result.created.length} file(s) created.\n`)

  // The legacy `aihu app` path stopped at that line — no cd, no install, no
  // dev command — while BOTH other scaffold paths (`dispatchTemplate` above and
  // `create-aihu`) end with printNextSteps(). Same function, so the three paths
  // cannot drift into three different sets of instructions.
  if (cmd === 'app') {
    printNextSteps({
      options: { appName: arg, pm: resolvePmFlag(rest), overrides: {} },
      targetDir: resolve(process.cwd(), arg),
    })
  }
}

main().catch((err: Error) => {
  process.stderr.write(`\nERROR: ${err.message}\n`)
  process.exit(1)
})
