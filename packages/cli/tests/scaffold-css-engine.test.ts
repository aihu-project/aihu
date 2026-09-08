/**
 * scaffold-css-engine — OOTB `@aihu/css-engine` scaffold option.
 *
 * Covers the Director-specified acceptance for the legacy `scaffoldApp()`
 * css-engine path (updated at the DA4 flip and again at FEL-425 — pages
 * default to light DOM, and the scaffold emits the plugin-global
 * `css: { shadowMode }` block ONLY for a genuine user choice; fabricating a
 * default would pin it and silently reverse the DA4 flip):
 *   - `{ css: 'engine' }` (no shadow choice) → `@aihu/css-engine` in deps,
 *     NO `css: { shadowMode }` block in vite.config (framework defaults
 *     apply — the scaffolded page is light DOM via the compiler's page
 *     default), utility-class starter with no `@style` block.
 *   - `{ css: 'engine', shadowMode: 'shadow' | 'light' }` → explicit
 *     `css: { shadowMode: … }` block emitted (the deliberate-choice path).
 *   - Default (no opts) scaffold is byte-identical to the no-css path (the
 *     legacy-snapshot.golden test is the cross-process gate; here we assert the
 *     pure generators are unchanged).
 *   - The css-engine starter ACTUALLY EMITS utility CSS — proved by running the
 *     real compiler plugin transform and asserting the scoped declarations fold
 *     into the shadow `__style__` ('shadow') / route to a virtual CSS import ('light').
 *     Tests-pass-alone is insufficient (project lesson); this is the
 *     user-visible behavioural check.
 *   - Flag parsing for `--css engine|none`, `--css-engine`, `--shadow …`.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type AihuCompilerPluginOptions, aihuCompilerPlugin } from '@aihu/compiler'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolvePublishedCompilerBinary } from '../../../scripts/lib/compiler-binary.ts'
import { aihuDep } from '../src/dep-versions.ts'
import { appIndexAihu, appPackageJson, appViteConfig, scaffoldApp } from '../src/index.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

// ── Pure-generator assertions (deterministic, no I/O) ────────────────────────

describe('scaffold css-engine · package.json', () => {
  it('adds @aihu/css-engine to dependencies when css-engine is on', () => {
    const pkg = JSON.parse(appPackageJson('x', 'bun', true)) as {
      dependencies: Record<string, string>
    }
    expect(pkg.dependencies['@aihu/css-engine']).toBe(aihuDep('@aihu/css-engine'))
  })

  it('omits @aihu/css-engine when off (default)', () => {
    const pkg = JSON.parse(appPackageJson('x', 'bun')) as {
      dependencies: Record<string, string>
    }
    expect(pkg.dependencies['@aihu/css-engine']).toBeUndefined()
  })
})

describe('scaffold css-engine · vite.config.ts', () => {
  it('no shadow choice emits NO css block — framework defaults apply (FEL-425)', () => {
    const cfg = appViteConfig('demo', true)
    expect(cfg).not.toContain('css: { shadowMode')
    // The css-engine comment still explains where utilities land and how to
    // opt into a project-wide mode.
    expect(cfg).toContain('fold into the global cascade')
    expect(cfg).toContain('DA4 defaults apply')
  })

  it('an explicit shadow choice emits the css block (DA4: it outranks the light page default)', () => {
    const cfg = appViteConfig('demo', true, 'shadow')
    expect(cfg).toContain("css: { shadowMode: 'shadow' },")
    expect(cfg).toContain('fold into each')
  })

  it('an explicit light choice emits the css block', () => {
    const cfg = appViteConfig('demo', true, 'light')
    expect(cfg).toContain("css: { shadowMode: 'light' },")
  })

  it('css off (default) emits the base config: optimizeDeps + agentReadiness, no css block', () => {
    const cfg = appViteConfig('demo')
    // Gap 1: dev-server fix — @aihu/app must be excluded from esbuild pre-bundle.
    expect(cfg).toContain("optimizeDeps: { exclude: ['@aihu/app'] }")
    // Gap 2: the agent surface is enabled by default. Its skills are DERIVED
    // from the @aihu/agent registry at runtime, NOT a hand-written literal —
    // so the emitted config carries no `skills:` array (thesis §2, Derived).
    // The agent surface is now configured through viteAihuPlugin's own
    // `agentReadiness` option rather than a hand-wired second plugin — the
    // framework's first-class path, which no template previously used.
    expect(cfg).toContain('agentReadiness: {')
    expect(cfg).not.toContain('viteAgentReadinessIntegration')
    expect(cfg).toContain("name: 'demo'")
    expect(cfg).not.toContain('skills:')
    expect(cfg).not.toContain("name: 'increment'")
    expect(cfg).toContain("dir: { pages: 'src/pages' }")
    // css off → no shadowMode block and no css-engine comment.
    expect(cfg).not.toContain('      css: { shadowMode')
    expect(cfg).not.toContain('fold into each')
  })
})

describe('scaffold css-engine · index.aihu starter', () => {
  it('uses utility classes and drops the @style block when on', () => {
    const sfc = appIndexAihu('myapp', true)
    expect(sfc).toContain('class="flex flex-col gap-8 max-w-7xl mx-auto p-8"')
    expect(sfc).toContain('class="text-3xl font-bold"')
    expect(sfc).not.toContain('@style')
    // signal counter retained
    expect(sfc).toContain('const [count, setCount] = signal(0)')
    // the agent-surface section dramatizes the human + agent control panel
    expect(sfc).toContain('Agent surface')
  })

  it('keeps the hand-written @style starter byte-identical when off', () => {
    expect(appIndexAihu('myapp', false)).toBe(appIndexAihu('myapp'))
    expect(appIndexAihu('myapp')).toContain('@style {')
  })
})

// ── scaffoldApp end-to-end (writes files) ────────────────────────────────────

describe('scaffold css-engine · scaffoldApp() writes the right tree', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aihu-css-scaffold-'))
  })
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('css: engine (no shadow choice) — deps + NO shadowMode block + utility starter (FEL-425)', () => {
    scaffoldApp('app', dir, { css: 'engine' })
    const root = join(dir, 'app')
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(pkg.dependencies['@aihu/css-engine']).toBe(aihuDep('@aihu/css-engine'))

    // No choice was made, so nothing is pinned: the framework defaults decide
    // (the scaffolded page is light DOM via the compiler's page default).
    const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8')
    expect(vite).not.toContain('css: { shadowMode')

    const sfc = readFileSync(join(root, 'src/pages/index.aihu'), 'utf8')
    expect(sfc).toContain('class="flex flex-col gap-8 max-w-7xl mx-auto p-8"')
    expect(sfc).not.toContain('@style')
    expect(sfc).not.toContain('$shadow')
  })

  it('css: engine + shadowMode shadow — explicit css block (deliberate choice kept)', () => {
    scaffoldApp('app', dir, { css: 'engine', shadowMode: 'shadow' })
    const vite = readFileSync(join(dir, 'app', 'vite.config.ts'), 'utf8')
    expect(vite).toContain("css: { shadowMode: 'shadow' },")
  })

  it('css: engine + shadowMode light — explicit css block', () => {
    scaffoldApp('app', dir, { css: 'engine', shadowMode: 'light' })
    const vite = readFileSync(join(dir, 'app', 'vite.config.ts'), 'utf8')
    expect(vite).toContain("css: { shadowMode: 'light' },")
  })

  it('default (no opts) does not emit css-engine — byte-stable plain path', () => {
    scaffoldApp('app', dir)
    const root = join(dir, 'app')
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(pkg.dependencies['@aihu/css-engine']).toBeUndefined()
    const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8')
    expect(vite).not.toContain('      css: { shadowMode')
    expect(vite).not.toContain('css-engine')
    const sfc = readFileSync(join(root, 'src/pages/index.aihu'), 'utf8')
    expect(sfc).toContain('@style {')
  })
})

// ── User-visible behaviour: the utilities actually emit ──────────────────────
//
// Gate on the css-core binary the same way css-engine-hook.test.ts does. When
// it resolves, run the REAL compiler plugin transform over the scaffolded
// shadow-mode starter and assert the scoped utility CSS folds into the shadow
// `__style__`; for `light`, assert it routes to a virtual CSS import instead.

const ext = process.platform === 'win32' ? '.exe' : ''
process.env.AIHU_COMPILE_BIN ??= resolvePublishedCompilerBinary()
const cssCoreBin =
  existsSync(resolve(HERE, `../../../target/release/aihu-css-compile${ext}`)) ||
  existsSync(resolve(HERE, `../../../target/debug/aihu-css-compile${ext}`))

type TransformFn = (
  this: unknown,
  code: string,
  id: string,
) => Promise<{ code: string; map: null } | null | undefined>

async function transformStarter(
  source: string,
  options?: AihuCompilerPluginOptions,
): Promise<string> {
  const tmp = mkdtempSync(join(tmpdir(), 'aihu-css-emit-'))
  try {
    const plugin = aihuCompilerPlugin(options)
    const transform = plugin.transform as unknown as TransformFn
    // The starter now carries a `@route` block, which the compiler only accepts
    // under a `src/pages/` path (C500), so compile it at that path.
    const res = await transform.call({}, source, join(tmp, 'src', 'pages', 'index.aihu'))
    if (res == null) throw new Error('plugin returned no result')
    return res.code
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

describe('scaffold css-engine · utilities actually emit (compiler transform)', () => {
  const starter = appIndexAihu('myapp', true)

  it.runIf(cssCoreBin)(
    'no plugin shadowMode (the FEL-425 scaffold default): the page default is light — utility CSS routes to a virtual CSS import',
    async () => {
      // The scaffold emits NO `css: { shadowMode }` block when the user made
      // no --shadow choice, so the compiler's DA4 page default ('light')
      // decides: utility CSS reaches the global cascade via the virtual CSS
      // import, not a per-component shadow sheet.
      const out = await transformStarter(starter)
      expect(out).toContain('virtual:aihu-utility')
      // Combined options object (LDF §10 step 3 folds lightScopeId into the
      // same injection as shadowMode — see `_injectShadowMode`'s doc
      // comment) — assert the shadowMode field, not the whole literal object.
      expect(out).toMatch(/shadowMode: ['"]light['"]/)
      expect(out).toMatch(/lightScopeId: ['"][0-9a-f]{8}['"]/)
    },
  )

  it.runIf(cssCoreBin)(
    'shadow mode folds scoped utility CSS into the component shadow __style__',
    async () => {
      // DA4: the starter page defaults to light DOM, so shadow mode means
      // the scaffold's explicit plugin-global config (appViteConfig emits
      // `css: { shadowMode: 'shadow' }` for the deliberate --shadow shadow
      // choice) — mirror it.
      const out = await transformStarter(starter, { shadowMode: 'shadow' })
      expect(out).toContain('new CSSStyleSheet()')
      expect(out).toContain('adoptedStyleSheets')
      // flex → display: flex; p-8 → padding: 2rem; max-w-7xl → max-width: 80rem
      expect(out).toContain('display: flex')
      expect(out).toContain('padding: 2rem')
      expect(out).toContain('max-width: 80rem')
    },
  )

  it.runIf(cssCoreBin)('light mode routes utility CSS to a virtual CSS import', async () => {
    const out = await transformStarter(starter, { shadowMode: 'light' })
    expect(out).toContain('virtual:aihu-utility')
  })
})
