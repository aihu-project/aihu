/**
 * scaffold-compile-clean — the guard that the §8.2 harness was missing.
 *
 * For EVERY scaffolder/template path that emits `.aihu` SFCs, generate the
 * project and run the CURRENT `aihu-compile` binary on each emitted `.aihu`
 * file, asserting ZERO compile errors (exit 0, no `C###` diagnostic on
 * stderr). This is what catches stale scaffolder grammar: prior to r2 the
 * default `create-aihu`/`aihu app` scaffolder emitted `$on:click` (C305) and
 * `{{ count }}`, and the cf-team templates used the removed
 * `@agent { $expose/$describe }` form (C440) — all of which the existing
 * file-presence harness (scaffold-and-compile.test.ts) silently passed.
 *
 * Binary resolution uses the locked published compiler package. Compiler
 * source is tested and released from aihu-compiler, while this suite verifies
 * the version a freshly scaffolded application receives.
 *
 * The `@route` block carries a path-scoped check (C500: `@route` only valid
 * in `src/pages/`). Emitted files are compiled IN PLACE at their real project
 * paths, so that check is satisfied exactly as it would be for a real build.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
// vitest is built on vite, so `vite` is always resolvable in the test runtime.
// `@aihu/compiler`'s plugin transpiles the TS it emits to runnable JS in dev;
// `transformWithOxc` (vite's current transpiler; it superseded the now-removed
// `transformWithEsbuild`) performs the same parse+transpile, so feeding the
// compiled output through it mirrors the real dev path and fails on the same
// inputs (duplicate top-level `const`, TS that won't transpile).
import { transformWithOxc } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolvePublishedCompilerBinary } from '../../../scripts/lib/compiler-binary.ts'
import { scaffoldApp, scaffoldComponent, scaffoldPage } from '../src/index.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI_BIN = resolve(HERE, '..', 'src', 'bin.ts')
const COMPILE_BIN = resolvePublishedCompilerBinary()

/** Recursively collect absolute paths of every `.aihu` file under `root`. */
function collectAihu(root: string): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const cur = stack.pop()!
    for (const entry of readdirSync(cur)) {
      const abs = join(cur, entry)
      const st = statSync(abs)
      if (st.isDirectory()) stack.push(abs)
      else if (st.isFile() && abs.endsWith('.aihu')) out.push(abs)
    }
  }
  return out.sort()
}

/**
 * Run the compiler on one `.aihu` file. Returns a structured result so the
 * test can assert exit 0 AND the absence of any `C###` diagnostic (the binary
 * exits non-zero on hard errors, but we also scan stderr to be defensive
 * about any future soft-error path).
 */
function compileFile(file: string): { ok: boolean; status: number | null; stderr: string } {
  const res = spawnSync(COMPILE_BIN, [file], { encoding: 'utf8' })
  const stderr = res.stderr ?? ''
  // Hard error codes are emitted as `C<digits>:`; the `[SECURITY]` $scope
  // advisory is intentionally NOT treated as a failure.
  const hasErrorCode = /\bC\d{3,}\b/.test(stderr)
  return { ok: res.status === 0 && !hasErrorCode, status: res.status, stderr }
}

/**
 * Compile with `--target client` (the browser pipeline the vite plugin uses)
 * and return the emitted module text alongside the clean check. The native
 * compiler exits 0 even when the emitted code has a duplicate top-level `const`
 * (e.g. a signal setter named like an $action) — that class of bug only
 * surfaces when the TS is transpiled, which is why the agent guard below feeds
 * `stdout` through esbuild.
 */
function compileClient(file: string): {
  ok: boolean
  status: number | null
  stderr: string
  stdout: string
} {
  const res = spawnSync(COMPILE_BIN, [file, '--target', 'client'], { encoding: 'utf8' })
  const stderr = res.stderr ?? ''
  const hasErrorCode = /\bC\d{3,}\b/.test(stderr)
  return {
    ok: res.status === 0 && !hasErrorCode,
    status: res.status,
    stderr,
    stdout: res.stdout ?? '',
  }
}

/**
 * The router only mounts a route whose `name` is a valid (hyphenated)
 * custom-element tag; a page registered under a hyphen-less stem never mounts
 * (blank `#outlet`). Every scaffolded PAGE (`src/pages/`) carries a
 * `@route { name }` with a hyphenated tag, so this must never trip.
 *
 * This used to assert the ABSENCE of an advisory `does not contain a hyphen`
 * warning — a string that no longer exists, because the rule is now the hard
 * compile error C450 raised wherever a define-name is resolved. Left as a
 * belt-and-braces check on the page path specifically: `compileFile` already
 * fails on any `C###`, so a regression here is caught twice.
 */
function assertNoHyphenWarning(stderr: string, file: string): void {
  if (!file.includes(`${join('src', 'pages')}${sep}`)) return
  expect(
    stderr.includes('C450'),
    `scaffolded page resolved to a tag that cannot register (would render a blank #outlet) for ${file}\nstderr:\n${stderr}`,
  ).toBe(false)
}

let parentDir: string

beforeAll(() => {
  parentDir = mkdtempSync(join(tmpdir(), 'aihu-scaffold-clean-'))
})

afterAll(() => {
  if (parentDir) rmSync(parentDir, { recursive: true, force: true })
})

describe('scaffold-compile-clean · every emitted .aihu compiles under current aihu-compile', () => {
  it('create-aihu / legacy `aihu app` scaffolder emits compiler-clean .aihu', () => {
    const root = join(parentDir, 'legacy-app')
    scaffoldApp('legacy-app', parentDir)

    const files = collectAihu(root)
    expect(files.length, 'legacy scaffold must emit at least one .aihu file').toBeGreaterThan(0)

    for (const f of files) {
      const r = compileFile(f)
      expect(r.ok, `compile failed for ${f}\nstatus=${r.status}\nstderr:\n${r.stderr}`).toBe(true)
      assertNoHyphenWarning(r.stderr, f)
    }
  })

  it('full + docs templates emit compiler-clean .aihu (FIX 3 hard constraint)', () => {
    for (const template of ['full', 'docs'] as const) {
      const appName = `tpl-${template}`
      const root = join(parentDir, appName)
      scaffoldApp(appName, parentDir, { template })

      const files = collectAihu(root)
      expect(
        files.length,
        `${template} scaffold must emit at least one .aihu file`,
      ).toBeGreaterThan(0)

      for (const f of files) {
        const r = compileFile(f)
        expect(
          r.ok,
          `${template}: compile failed for ${f}\nstatus=${r.status}\nstderr:\n${r.stderr}`,
        ).toBe(true)
        assertNoHyphenWarning(r.stderr, f)
      }
    }
  })

  it('agent template: emitted .aihu native-compiles AND esbuild-transpiles (dev-path mount guard)', async () => {
    const appName = 'tpl-agent'
    const root = join(parentDir, appName)
    scaffoldApp(appName, parentDir, { template: 'agent' })

    const files = collectAihu(root)
    expect(files.length, 'agent scaffold must emit at least one .aihu file').toBeGreaterThan(0)

    for (const f of files) {
      // 1) Native compiler must be clean (exit 0, no C### diagnostic).
      const r = compileClient(f)
      expect(
        r.ok,
        `agent: native compile failed for ${f}\nstatus=${r.status}\nstderr:\n${r.stderr}`,
      ).toBe(true)
      assertNoHyphenWarning(r.stderr, f)

      // 2) The CLIENT-target output must transpile to runnable JS — exactly what
      //    @aihu/compiler's vite plugin does in dev. If this throws (a signal
      //    setter colliding with an $action name → two top-level `const`, or any
      //    TS that won't transpile), the plugin silently serves raw TS and the
      //    custom element never registers (blank mount). This is the regression
      //    guard for that bug class; the file-presence + native-compile checks
      //    alone passed it silently (native compile exits 0).
      await expect(
        transformWithOxc(r.stdout, 'component.ts'),
        `agent: compiled output for ${f} failed to transpile (would never mount in the browser)`,
      ).resolves.toBeTruthy()
    }
  })

  it('`aihu page` + `aihu component` scaffolders emit compiler-clean .aihu', () => {
    const root = join(parentDir, 'gen')
    // page lands at src/pages/about.aihu (carries a @route block, so it must
    // be compiled at a src/pages/ path — C500 — which scaffoldPage emits).
    scaffoldPage('/about', root)
    // Multi-word: the filename stem IS the registered tag, so it must kebab to
    // a hyphenated name (`user-card`). A single-word name is refused outright —
    // see the sibling test below.
    scaffoldComponent('UserCard', root)

    const files = collectAihu(root)
    expect(files.length, 'page+component scaffold must emit .aihu files').toBe(2)

    for (const f of files) {
      const r = compileFile(f)
      expect(r.ok, `compile failed for ${f}\nstatus=${r.status}\nstderr:\n${r.stderr}`).toBe(true)
      assertNoHyphenWarning(r.stderr, f)
    }
  })

  // The scaffolder must not emit a component that can never register. Before
  // this guard, `aihu component Card` wrote `card.aihu`, whose compiled output
  // called `customElements.define('card', …)` — a SyntaxError in every
  // browser, so the element stayed inert and the page rendered blank, with a
  // green build and a warning nobody gated on.
  it('`aihu component` REFUSES a single-word name (tag could never register)', () => {
    const root = join(parentDir, 'gen-reject')
    expect(() => scaffoldComponent('Card', root)).toThrow(/cannot register as a custom element/)
    expect(() => scaffoldComponent('Card', root)).toThrow(/'card'/)
    // And it wrote nothing.
    expect(existsSync(join(root, 'src', 'components', 'card.aihu'))).toBe(false)
  })

  it('@aihu/templates-cf-team scaffolder emits compiler-clean .aihu', () => {
    const appName = 'cfteam-clean'
    const root = join(parentDir, appName)
    const argv = [
      CLI_BIN,
      'app',
      appName,
      '--template',
      'cf-team',
      '--no-interactive',
      '--use-defaults',
      '--options-json',
      JSON.stringify({ auth: 'better-auth' }),
      '--no-git',
      '--no-install',
    ]
    const scaffold = spawnSync('bun', argv, { cwd: parentDir, encoding: 'utf8', env: process.env })
    expect(
      scaffold.status,
      `cf-team scaffold failed:\nstdout: ${scaffold.stdout}\nstderr: ${scaffold.stderr}`,
    ).toBe(0)

    const files = collectAihu(root)
    expect(files.length, 'cf-team scaffold must emit at least one .aihu file').toBeGreaterThan(0)

    for (const f of files) {
      const r = compileFile(f)
      expect(r.ok, `compile failed for ${f}\nstatus=${r.status}\nstderr:\n${r.stderr}`).toBe(true)
    }
  })
})
