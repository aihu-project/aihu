/**
 * `assertTemplateCompatibility` — the gate that makes `cliRange` and
 * `contractVersion` mean something.
 *
 * Both fields were parsed and validated by `validateManifest()` and then
 * compared against nothing, for long enough that the only publishable template
 * in the repo drifted to declaring `cliRange: '^0.2.0'` against a CLI at 1.2.x
 * without anything going red. The last describe block below reads the REAL
 * `@aihu/templates-cf-team` manifests off disk so that particular drift cannot
 * recur silently — and reads both the `.ts` and the `.js` copy, because
 * `loadTemplateConfig` picks between them by runtime and a divergence would
 * make the gate's answer depend on whether the user's CLI runs under Bun.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CLI_VERSION } from '../src/cli-version.ts'
import {
  assertTemplateCompatibility,
  SUPPORTED_CONTRACT_VERSION,
} from '../src/scaffold-pipeline.ts'
import type { TemplateManifest } from '../src/template-manifest.ts'
import { validateManifest } from '../src/template-manifest.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const CF_TEAM = resolve(HERE, '..', '..', 'templates', 'cf-team')
const CF_SOLO = resolve(HERE, '..', '..', 'templates', 'cf-solo')

function manifest(over: Partial<TemplateManifest> = {}): TemplateManifest {
  return {
    name: '@aihu/templates-fixture',
    displayName: 'Fixture',
    description: 'test fixture',
    contractVersion: SUPPORTED_CONTRACT_VERSION,
    cliRange: '^1.0.0',
    fixed: {},
    overridable: {},
    conditionalFiles: [],
    placeholders: [],
    postInstall: [],
    appPeerDeps: {},
    ...over,
  }
}

describe('assertTemplateCompatibility — cliRange', () => {
  it('passes when the CLI is in range', () => {
    expect(() => assertTemplateCompatibility(manifest(), '1.2.0')).not.toThrow()
    expect(() => assertTemplateCompatibility(manifest({ cliRange: '*' }), '9.9.9')).not.toThrow()
  })

  it('fails loudly when the CLI is out of range, naming both versions', () => {
    expect(() => assertTemplateCompatibility(manifest({ cliRange: '^0.2.0' }), '1.2.0')).toThrow(
      /requires @aihu\/cli \^0\.2\.0, but this is @aihu\/cli 1\.2\.0/,
    )
  })

  it('fails on an unreadable range instead of waving it through', () => {
    expect(() =>
      assertTemplateCompatibility(manifest({ cliRange: 'sometime-after-tuesday' }), '1.2.0'),
    ).toThrow(/unusable cliRange/)
  })

  it('checks a prerelease CLI as its release core', () => {
    // npm's prerelease rule would make a canary CLI fail EVERY template range,
    // which answers a different question than "can this binary drive this
    // manifest". `1.3.0-beta.1` is 1.3.0 for the purposes of this gate.
    expect(() =>
      assertTemplateCompatibility(manifest({ cliRange: '^1.0.0' }), '1.3.0-beta.1'),
    ).not.toThrow()
    expect(() =>
      assertTemplateCompatibility(manifest({ cliRange: '^1.0.0' }), '2.0.0-beta.1'),
    ).toThrow(/requires @aihu\/cli/)
  })
})

describe('assertTemplateCompatibility — contractVersion', () => {
  it('tells a user with an OLD cli to upgrade the cli', () => {
    expect(() =>
      assertTemplateCompatibility(
        manifest({ contractVersion: SUPPORTED_CONTRACT_VERSION + 1 }),
        '1.2.0',
      ),
    ).toThrow(/Upgrade the CLI/)
  })

  it('tells a user with an OLD template to upgrade the template', () => {
    expect(() =>
      assertTemplateCompatibility(
        manifest({ contractVersion: SUPPORTED_CONTRACT_VERSION - 1 }),
        '1.2.0',
      ),
    ).toThrow(/too old for this CLI/)
  })
})

/**
 * The real `@aihu/templates-cf-team` manifests, both copies.
 *
 * `loadTemplateConfig` prefers `template.config.ts` and falls through to
 * `template.config.js` when the runtime cannot import TypeScript — which is
 * ALWAYS, for the published `#!/usr/bin/env node` binary. The two files are
 * hand-kept in sync, and they had silently diverged: the `.js` copy's
 * `conditionalFiles` still named post-strip target paths (`.../kinde.ts`)
 * instead of the `.tmpl` source paths that exist on disk, and had none of the
 * F-5b `rename` fields.
 *
 * Nothing matched, so under Node NO conditional fired: a default `cf-team`
 * scaffold wrote all three auth providers' files while installing only the
 * chosen provider's SDK, and emitted `.env.example.better-auth` instead of
 * `.env.example`. The scaffolded project then failed its own `typecheck` with
 * TS2307 on `@kinde-oss/kinde-typescript-sdk` and `@supabase/supabase-js`.
 * In-repo harnesses run `bun src/bin.ts`, take the `.ts` copy, and never saw it.
 */
describe.each([
  ['@aihu/templates-cf-team', CF_TEAM],
  ['@aihu/templates-cf-solo', CF_SOLO],
])('%s — the shipped manifests', (_name, pkgDir) => {
  async function load(file: string): Promise<TemplateManifest> {
    const mod = (await import(/* @vite-ignore */ resolve(pkgDir, file))) as Record<string, unknown>
    return validateManifest(mod.default ?? mod.config)
  }

  it('the .ts and .js copies are the SAME manifest', async () => {
    const [ts, js] = await Promise.all([load('template.config.ts'), load('template.config.js')])
    expect(js).toEqual(ts)
  })

  it('every conditionalFiles path names a file that exists under template/', async () => {
    // The check that would have caught the drift on its own: a `when` guarding
    // a path that is in no template tree is not a guard, it is a no-op.
    const ts = await load('template.config.ts')
    for (const c of ts.conditionalFiles) {
      expect(existsSync(resolve(pkgDir, 'template', c.path)), c.path).toBe(true)
    }
  })

  for (const file of ['template.config.ts', 'template.config.js']) {
    it(`${file}: the running CLI (${CLI_VERSION}) satisfies its cliRange`, async () => {
      const m = await load(file)
      expect(() => assertTemplateCompatibility(m, CLI_VERSION)).not.toThrow()
    })
  }
})

/**
 * The gate is wired into `scaffoldFromTemplatePackage`, which is the single
 * driver BOTH bins run — so proving it once, through the real `aihu` process,
 * proves it for `create-aihu` too.
 *
 * The fake package is planted in `<cwd>/node_modules/@aihu/templates-cf-team`,
 * which `resolveTemplatePackagePath` checks FIRST (strategy 0), so it shadows
 * the in-repo workspace copy without touching it.
 */
describe('an out-of-range template blocks the scaffold before writing anything', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'aihu-cli-range-'))
  })

  afterEach(() => {
    if (cwd !== '') rmSync(cwd, { recursive: true, force: true })
  })

  function plant(cliRange: string): void {
    const pkgRoot = join(cwd, 'node_modules', '@aihu', 'templates-cf-team')
    mkdirSync(join(pkgRoot, 'template'), { recursive: true })
    writeFileSync(join(pkgRoot, 'template', 'README.md'), '# planted\n')
    writeFileSync(
      join(pkgRoot, 'template.config.js'),
      `export const config = ${JSON.stringify({
        name: '@aihu/templates-cf-team',
        displayName: 'Planted',
        description: 'compat fixture',
        contractVersion: 1,
        cliRange,
        fixed: {},
        overridable: {},
        conditionalFiles: [],
        placeholders: [],
        postInstall: [],
        appPeerDeps: {},
      })}\nexport default config\n`,
    )
  }

  function scaffold() {
    const bin = resolve(HERE, '..', 'src', 'bin.ts')
    const r = spawnSync(
      'bun',
      [bin, 'app', 'compat-probe', '--template', 'cf-team', '--no-install', '--no-git'],
      { cwd, encoding: 'utf8', env: process.env },
    )
    return { status: r.status, stderr: r.stderr ?? '', stdout: r.stdout ?? '' }
  }

  it('exits 1 and creates no project directory', () => {
    plant('^0.2.0') // the exact range cf-team had gone stale at
    const r = scaffold()
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('requires @aihu/cli ^0.2.0')
    expect(existsSync(join(cwd, 'compat-probe'))).toBe(false)
  })

  it('scaffolds normally when the range matches', () => {
    plant(`^${CLI_VERSION.split('.')[0]}.0.0`)
    const r = scaffold()
    expect(r.status, r.stderr).toBe(0)
    expect(existsSync(join(cwd, 'compat-probe', 'README.md'))).toBe(true)
  })
})
