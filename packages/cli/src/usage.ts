/**
 * `aihu`'s help text — its own module so tests can read it without importing
 * `bin.ts`, whose top-level `main()` call would run the CLI on import.
 */

import { CLI_VERSION } from './cli-version.js'
import { formatTemplateCatalog } from './templates-registry.js'

/**
 * The full help text. Plain string, exported for tests.
 *
 * EVERY flag listed here is one the dispatcher actually reads, and every flag
 * the dispatcher reads is listed here. That was not previously true in either
 * direction: `--style` (a real `aihu add` flag) and `aihu migrate --state` were
 * missing, while seven real `aihu app` flags (`--pm`, `--no-git`,
 * `--no-install`, `--options-json`, `--no-auto-install-template`, plus the
 * since-deleted `--use-defaults`/`--no-interactive`) existed only in a code
 * comment and appeared in no user-facing help at all.
 *
 * The `aihu app` flags are split by the path they affect, because the two
 * scaffold paths are genuinely different programs: `--template <npm-package>`
 * drives the manifest pipeline, everything else drives the built-in generators.
 * A flat list would imply `--css` works on `cf-team` (it does not) and that
 * `--options-json` does something for `minimal` (it does not).
 */
export function usageText(): string {
  return [
    `aihu ${CLI_VERSION}`,
    '',
    'Usage:',
    '  aihu <command> [options]',
    '',
    'Commands:',
    '  app <name>              Scaffold a new application (default: client-only SPA)',
    '  page <route>            Scaffold a page file (e.g. /about)',
    '  component <name>        Scaffold a component file',
    '  plugin <name>           Scaffold a plugin package',
    '  dev [options]           Start the dev server',
    '  build [options]         Production build',
    '  deploy [options]        Deploy via the configured platform adapter',
    '  migrate <files...>      Migrate legacy SFC syntax to v1.0+ canonical forms',
    '  add <names...>          Copy styled recipes from @aihu/ui into ui.target',
    '  list [--installed]      List registry recipes (--installed: only copied ones)',
    '  mcp serve               Start the MCP stdio server',
    '',
    'aihu app <name>:',
    '  --template <id>              Template to scaffold from (see the list below)',
    '  --pm <bun|pnpm|npm|yarn>     Package manager for the emitted manifest and installs',
    '                               (default: bun)',
    '  Built-in templates only (minimal | full | docs | agent | ssr):',
    '    --css <engine|none>        Include @aihu/css-engine OOTB (utility classes);',
    '                               default none',
    '    --shadow <light|shadow>    Force one shadow mode project-wide when --css engine',
    '                               is set; default: framework defaults (light-DOM',
    '                               pages/layouts, shadow-DOM leaves)',
    '  npm template packages only (e.g. --template cf-team):',
    '    --options-json <JSON>      JSON object of overrides for the template manifest’s',
    '                               `overridable` cells, e.g. \'{"auth":"supabase"}\'',
    '    --no-git                   Skip the git-init post-install step',
    '    --no-install               Skip the pm-install + lint-fix post-install steps',
    '    --no-auto-install-template Do not npm-install the template package when it is',
    '                               missing; fail with the resolution error instead',
    '',
    'aihu migrate <files...>:',
    '  --v2                    Also migrate v1 macro forms to the v2 vocabulary',
    '  --state                 Migrate @state to the wrapper model',
    '  --dry-run               Preview changes without writing',
    '',
    'aihu add <names...>:',
    '  --prefix <p>            Override the custom-element tag prefix (ui.prefix)',
    '  --style <s>             Override the recorded style variant (ui.style)',
    '  --dry-run               Print the plan; write nothing',
    '  --diff                  Show a unified diff against existing target files',
    '  --force                 Overwrite on collision',
    '',
    'Global:',
    '  --help, -h              Show this message',
    '  --version, -v           Print the @aihu/cli version',
    '',
    'Templates for `aihu app --template <id>`:',
    formatTemplateCatalog('  '),
  ].join('\n')
}
