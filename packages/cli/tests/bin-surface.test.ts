/**
 * `aihu`'s top-level command surface, driven as a real process.
 *
 * ## What was wrong
 *
 * `usage()` wrote the same block to STDERR and exited 1 for all four of
 * `--help`, `--version`, an unknown command, and no arguments at all. Every one
 * of those produced byte-identical output on the same stream with the same exit
 * code, so nothing — a human, a shell script, a CI job — could tell a typo from
 * a request for help, and `aihu --help | less` showed an empty screen. There
 * was no `--version` at all.
 *
 * Separately, the positional argument was `rest[0]`, so `aihu app --pm pnpm`
 * scaffolded a complete project into a directory literally named `--pm` and
 * exited 0.
 *
 * ## Why these assertions are on streams and exit codes
 *
 * They are the machine-readable half of the contract, and they are the half
 * that was broken. Asserting only on text would have passed against the old
 * code for three of the four cases.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CLI_VERSION } from '../src/cli-version.ts'
import { usageText } from '../src/usage.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI_BIN = resolve(HERE, '..', 'src', 'bin.ts')

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'aihu-bin-surface-'))
})

afterEach(() => {
  if (cwd !== '') rmSync(cwd, { recursive: true, force: true })
})

function run(...args: string[]) {
  const r = spawnSync('bun', [CLI_BIN, ...args], { cwd, encoding: 'utf8', env: process.env })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe('--help', () => {
  it('prints the usage block to STDOUT and exits 0', () => {
    const r = run('--help')
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
    expect(r.stdout).toContain('Usage:')
    expect(r.stdout).toContain('aihu <command> [options]')
  })

  it('-h is the same', () => {
    expect(run('-h').status).toBe(0)
    expect(run('-h').stdout).toContain('Usage:')
  })

  it('answers a subcommand-scoped --help too', () => {
    const r = run('migrate', '--help')
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Usage:')
  })
})

describe('--version', () => {
  it('prints just the version to STDOUT and exits 0', () => {
    const r = run('--version')
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
    expect(r.stdout.trim()).toBe(CLI_VERSION)
    // Must be the version of THIS package, not a hand-maintained literal.
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('-v is the same', () => {
    expect(run('-v').stdout.trim()).toBe(CLI_VERSION)
  })
})

describe('no arguments', () => {
  it('answers the implied question — usage on STDOUT, exit 0', () => {
    const r = run()
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Usage:')
  })
})

describe('unknown command', () => {
  it('names the word it did not recognise, on STDERR, exit 1', () => {
    const r = run('frobnicate')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('unknown command')
    expect(r.stderr).toContain('frobnicate')
    expect(r.stdout).toBe('')
  })

  it('is distinguishable from --help — the defect that motivated this', () => {
    const help = run('--help')
    const typo = run('aap')
    expect(help.status).not.toBe(typo.status)
    expect(help.stdout).not.toBe(typo.stdout)
    // Help says nothing on stderr; a typo says nothing on stdout.
    expect(help.stderr).toBe('')
    expect(typo.stdout).toBe('')
  })
})

describe('missing positional', () => {
  it('says what is missing instead of reprinting usage', () => {
    const r = run('app')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('aihu app needs a project name')
    expect(readdirSync(cwd)).toEqual([])
  })

  it('does not mistake a flag for the project name', () => {
    const r = run('app', '--pm', 'pnpm')
    expect(r.status).toBe(1)
    // The old dispatcher read rest[0] and created a directory named `--pm`.
    expect(existsSync(join(cwd, '--pm'))).toBe(false)
    expect(readdirSync(cwd)).toEqual([])
  })

  it('does not mistake a flag VALUE for the project name', () => {
    const r = run('app', '--pm', 'pnpm', 'real-app')
    expect(r.status).toBe(0)
    expect(existsSync(join(cwd, 'real-app'))).toBe(true)
    expect(existsSync(join(cwd, 'pnpm'))).toBe(false)
  })
})

describe('legacy `aihu app` output', () => {
  it('prefixes created paths with the project directory', () => {
    const r = run('app', 'demo')
    expect(r.status).toBe(0)
    // `created  package.json` named a file that is not at ./package.json.
    expect(r.stdout).toContain('created  demo/package.json')
    expect(r.stdout).not.toMatch(/^ {2}created {2}package\.json$/m)
  })

  it('ends with next steps, like the other two scaffold paths', () => {
    const r = run('app', 'demo', '--pm', 'npm')
    expect(r.stdout).toContain('Next steps:')
    expect(r.stdout).toContain('cd demo')
    expect(r.stdout).toContain('npm run dev')
  })

  it('page/component paths are NOT prefixed — they write into the current project', () => {
    const r = run('page', 'about')
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('created  src/pages/about.aihu')
    expect(r.stdout).not.toContain('created  about/src')
  })
})

describe('usageText accuracy', () => {
  const text = usageText()

  it('documents every `aihu app` flag the dispatcher reads', () => {
    for (const flag of [
      '--template',
      '--pm',
      '--css',
      '--shadow',
      '--options-json',
      '--no-git',
      '--no-install',
      '--no-auto-install-template',
    ]) {
      expect(text, flag).toContain(flag)
    }
  })

  it('documents the real `aihu add` and `aihu migrate` flags', () => {
    for (const flag of ['--prefix', '--diff', '--force', '--v2', '--state', '--dry-run']) {
      expect(text, flag).toContain(flag)
    }
  })

  it('does not advertise the deleted no-op flags', () => {
    // They parsed into variables that were immediately `void`-discarded, so a
    // scripted `aihu app x --use-defaults` looked supported and was not.
    expect(text).not.toContain('--use-defaults')
    expect(text).not.toContain('--no-interactive')
    // `--style` never had a variant to select; removed outright (ui.style).
    expect(text).not.toContain('--style')
  })

  it('carries the version', () => {
    expect(text).toContain(CLI_VERSION)
  })
})

describe('--version is global, like --help', () => {
  it('is answered wherever it appears in argv', () => {
    // It was tested against argv[2] only, so `aihu --version` printed the
    // version while `aihu app foo --version` SCAFFOLDED A PROJECT and exited 0
    // — two flags documented side by side under "Global:", one of which was not.
    const r = run('app', 'foo', '--version')
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe(CLI_VERSION)
    expect(readdirSync(cwd)).toEqual([])
  })

  it('-v behaves the same', () => {
    const r = run('app', 'foo', '-v')
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe(CLI_VERSION)
    expect(readdirSync(cwd)).toEqual([])
  })
})

describe('--pm triage', () => {
  // `resolvePmFlag` returned 'bun' for ANY unrecognised value including none at
  // all, so the emitted `"packageManager": "bun@…"` was a silent lie about what
  // the user asked for — and corepack ENFORCES that field, so the `pnpm install`
  // the CLI prints next refuses to run: the exact failure resolvePmFlag's own
  // docblock was written about.

  it('rejects an unknown value instead of silently using bun', () => {
    const r = run('app', 'demo', '--pm', 'garbage')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('unknown --pm value')
    expect(r.stderr).toContain('garbage')
    expect(r.stderr).toContain('bun | pnpm | npm | yarn')
    expect(readdirSync(cwd)).toEqual([])
  })

  it('rejects a dangling --pm instead of silently using bun', () => {
    const r = run('app', 'demo', '--pm')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('--pm needs a value')
    expect(readdirSync(cwd)).toEqual([])
  })

  it('rejects --pm= with an empty value', () => {
    const r = run('app', 'demo', '--pm=')
    expect(r.status).toBe(1)
    expect(readdirSync(cwd)).toEqual([])
  })

  it('speaks the same error dialect as --template, which was already loud', () => {
    const pm = run('app', 'demo', '--pm', 'garbage')
    const tpl = run('app', 'demo', '--template', 'garbage')
    expect(pm.status).toBe(tpl.status)
    expect(pm.stdout).toBe('')
    expect(tpl.stdout).toBe('')
  })

  it('still accepts every valid value, and still defaults to bun when absent', () => {
    for (const pm of ['bun', 'pnpm', 'npm', 'yarn']) {
      const r = run('app', `demo-${pm}`, '--pm', pm)
      expect(r.status, pm).toBe(0)
    }
    expect(run('app', 'demo-default').status).toBe(0)
  })
})

describe('scaffold-name triage', () => {
  it('refuses to scaffold an app outside the current directory', () => {
    const r = run('app', '../../ESCAPED')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('write outside the current directory')
    expect(existsSync(resolve(cwd, '..', '..', 'ESCAPED'))).toBe(false)
    expect(readdirSync(cwd)).toEqual([])
  })

  it('refuses to scaffold a plugin from a path-shaped name', () => {
    const r = run('plugin', '../../PESCAPED')
    expect(r.status).toBe(1)
    expect(readdirSync(cwd)).toEqual([])
  })

  it('reports the plugin directory it actually created', () => {
    // The listing was prefixed with the raw argument (`my-forms/package.json`)
    // for files written to `aihu-plugin-my-forms/` — the same wrong-path-in-the
    // -listing defect the prefixing was added to fix, one level further in.
    const r = run('plugin', 'my-forms')
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('created  aihu-plugin-my-forms/package.json')
    expect(existsSync(join(cwd, 'aihu-plugin-my-forms', 'package.json'))).toBe(true)
  })
})

describe('one error dialect', () => {
  // `mcp` and `migrate` printed a bare usage block with no `ERROR:` marker and
  // no pointer to `--help`, so the dispatcher answered malformed invocations in
  // two different voices depending on which branch you tripped.

  it('`aihu migrate` with no files uses the failUsage convention', () => {
    const r = run('migrate')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('ERROR:')
    expect(r.stderr).toContain('aihu migrate needs at least one file')
    expect(r.stderr).toContain('aihu --help')
  })

  it('`aihu mcp` with no subcommand uses the failUsage convention', () => {
    const r = run('mcp')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('ERROR:')
    expect(r.stderr).toContain('aihu mcp serve')
    expect(r.stderr).toContain('aihu --help')
  })

  it('`aihu mcp <typo>` names the subcommand it did not recognise', () => {
    const r = run('mcp', 'srve')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('srve')
  })
})
