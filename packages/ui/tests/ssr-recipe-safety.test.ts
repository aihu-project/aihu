// @vitest-environment node
//
// NOT jsdom (the repo default). The whole claim under test is what a recipe's
// setup body does when `HTMLElement` / `CSSStyleSheet` / `customElements` do
// NOT exist. Under jsdom every assertion here would pass vacuously against the
// exact bug it exists to catch.

/**
 * Every shipped recipe must SERVER-RENDER without a DOM.
 *
 * ## What broke
 *
 * `card.aihu`, `badge.aihu`, `separator.aihu` and `button.aihu` each declared a
 * custom-element class inside `@state` — `class AihuCard extends HTMLElement`,
 * `static sheet = new CSSStyleSheet()`, `customElements.define(…)`. The
 * compiler emits an `@state` block VERBATIM into `__aihu_setup__` and
 * `__aihu_ssr_string_setup__`, i.e. into the body every server render runs. So
 * under `output: 'ssr'` those three lines threw
 * `ReferenceError: HTMLElement is not defined` on a Cloudflare Worker — as a
 * child, the element rendered empty; as a page, the whole request died.
 *
 * `before-after.aihu` and `temperature.aihu` had the same disease with a
 * different symptom: they call `@aihu/primitives`' own `defineSlider()` /
 * `defineRadioGroup()` from `@state`, and those threw
 * `ReferenceError: customElements is not defined` one frame deeper.
 *
 * This is NOT the `$extends` bug (`.changeset/ssr-extends-base-guard.md`).
 * That one threw at module LOAD, because the class sat at the primitive
 * module's own top level and an extends clause is evaluated on import. This one
 * throws at SETUP-BODY EXECUTION, which happens for every server-rendered
 * component whether or not it has a `base:` clause.
 *
 * ## Why this file executes rather than pattern-matches
 *
 * A regex over the emitted source would pin today's four files and nothing
 * else — a new recipe reaching for `matchMedia` or `new ResizeObserver()` at
 * setup time is the same bug and would sail past. So this compiles each recipe
 * with the REAL compiler binary at the REAL server target and CALLS the
 * emitted renderers in a DOM-less realm. Whatever a recipe touches, it is
 * touched here.
 *
 * `packages/app/tests/workers-ssr-e2e.test.ts` (assertions 16–18) covers the
 * other axis — a real `vite build`, driven as a built Worker — for the shapes
 * these recipes use. That gate is ~30s and exercises probe components; this one
 * is seconds and exercises every file actually shipped.
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { transform } from '@aihu/compiler'
// The SAME window `@aihu/server`'s `renderToString` and `__aihu_schild` open
// around a render. Without it a recipe with a user-authored `onMount` throws
// `SCR-R0010 'no owner'` — an artifact of calling the renderer bare, not
// anything a Worker would hit. See `packages/runtime/src/ssr-lifecycle.ts`.
import { _withSsrLifecycle } from '@aihu/runtime/ssr'
import { beforeAll, describe, expect, it } from 'vitest'

const __dirname = dirname(new URL(import.meta.url).pathname)
const REPO = resolve(__dirname, '../../..')
const REGISTRY = resolve(__dirname, '../registry')
/** Emitted modules land inside the repo so vitest will transform them. */
const EMIT_DIR = join(__dirname, '.ssr-emit')

/**
 * Bare specifier → the workspace SOURCE file behind it.
 *
 * Every import the compiler emits for a recipe is rewritten to an absolute
 * path before the module is written out. Two reasons, and the second is the
 * load-bearing one:
 *
 *   1. It tests `src/`, not `dist/`. A `dist/`-resolved run would validate the
 *      last build — and the fix under test lives in `@aihu/primitives`' source.
 *   2. It removes the build-order coupling entirely. `bun run test` runs BEFORE
 *      `bun run build` in this repo's `check:ci`, so a subpath like
 *      `@aihu/primitives/slider` (which `package.json#exports` maps to
 *      `dist/slider.js`) would not resolve at all in a fresh clone.
 *
 * The DOM engine is deliberately different: recipes exercise its published
 * boundary, because it is independently released from this repository.
 * `resolveSpecifier` throws on any other unknown Aihu package, so a recipe
 * that starts importing something new still fails loudly rather than silently
 * skipping.
 */
function resolveSpecifier(spec: string): string {
  if (spec === '@aihu/arbor' || spec === '@aihu/signals') return spec
  const direct: Record<string, string> = {
    '@aihu/runtime': 'packages/runtime/src/index.ts',
    '@aihu/runtime/ssr': 'packages/runtime/src/ssr-string.ts',
    '@aihu/context': 'packages/context/src/index.ts',
    '@aihu/css-engine/runtime/cn': 'packages/css-engine/src/runtime/cn.ts',
  }
  const hit = direct[spec]
  if (hit !== undefined) return join(REPO, hit)
  // `@aihu/primitives/slider` → packages/primitives/src/slider/index.ts
  const prim = /^@aihu\/primitives\/(.+)$/.exec(spec)
  if (prim) return join(REPO, 'packages/primitives/src', prim[1]!, 'index.ts')
  // `@aihu/use/motion/useCountTo` → packages/use/src/motion/useCountTo/index.ts
  const use = /^@aihu\/use\/(.+)$/.exec(spec)
  if (use) return join(REPO, 'packages/use/src', use[1]!, 'index.ts')
  throw new Error(
    `ssr-recipe-safety: no source mapping for '${spec}'. A recipe imports something this ` +
      `test does not know how to resolve to workspace source — add it to resolveSpecifier ` +
      `rather than letting the module fall back to a dist build.`,
  )
}

/** Every recipe in the registry, as `[name, absolute .aihu path]`. */
function recipes(): Array<readonly [string, string]> {
  const out: Array<readonly [string, string]> = []
  for (const dir of readdirSync(REGISTRY, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    for (const f of readdirSync(join(REGISTRY, dir.name))) {
      if (f.endsWith('.aihu'))
        out.push([f.slice(0, -'.aihu'.length), join(REGISTRY, dir.name, f)] as const)
    }
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]))
}

const RECIPES = recipes()

/**
 * Compile one recipe to the server target and write it out with every import
 * rewritten to workspace source.
 *
 * The `aihu-` prefix on the compiled id is not cosmetic: a recipe is stored
 * under its bare name (`card/card.aihu`) but registers the PREFIXED tag that
 * `aihu add` writes at copy time, and the compiler rejects a hyphen-less
 * custom-element name outright (C450). So this compiles the file under the
 * name a consumer's project would actually hold.
 */
function emit(name: string, file: string): string {
  const src = readFileSync(file, 'utf8')
  const { code } = transform(src, join(dirname(file), `aihu-${name}.aihu`), { target: 'server' })
  const rewritten = code.replace(/(\bfrom\s+)'([^']+)'/g, (_m, kw: string, spec: string) => {
    if (!spec.startsWith('@aihu/')) return `${kw}'${spec}'`
    const resolved = resolveSpecifier(spec)
    return `${kw}'${resolved.startsWith('@aihu/') ? resolved : pathToFileURL(resolved).href}'`
  })
  const out = join(EMIT_DIR, `aihu-${name}.ts`)
  writeFileSync(out, rewritten)
  return out
}

const emitted = new Map<string, string>()

beforeAll(() => {
  // THROW, never skip. `vite-build-utility-css.e2e.test.ts` names soft-skipping
  // as "the false-confidence pattern that let the prior Bug 2 fix ship a
  // non-working feature", and a recipe suite that quietly covers zero recipes
  // is exactly that.
  expect(RECIPES.length, 'the registry produced no recipes to test').toBeGreaterThan(10)
  rmSync(EMIT_DIR, { recursive: true, force: true })
  mkdirSync(EMIT_DIR, { recursive: true })
  writeFileSync(join(EMIT_DIR, '.gitignore'), '*\n')
  for (const [name, file] of RECIPES) emitted.set(name, emit(name, file))
}, 120_000)

describe('@aihu/ui recipes server-render without a DOM', () => {
  it('the environment really has no DOM — otherwise this file proves nothing', () => {
    expect(typeof HTMLElement).toBe('undefined')
    expect(typeof CSSStyleSheet).toBe('undefined')
    expect(typeof customElements).toBe('undefined')
    expect(typeof document).toBe('undefined')
  })

  for (const [name] of RECIPES) {
    it(`${name} renders`, async () => {
      const mod = (await import(pathToFileURL(emitted.get(name)!).href)) as {
        __ssrString?: (props?: Record<string, unknown>, opts?: Record<string, unknown>) => unknown
        __ssr?: () => unknown
        default?: unknown
      }

      // The string fast path — what `__aihu_schild` and the compiled page
      // renderer actually call. A throw here IS the bug: as a child it costs
      // the element its content, as a page it costs the request its response.
      expect(typeof mod.__ssrString, `${name} exports no __ssrString`).toBe('function')
      const html = _withSsrLifecycle(() => mod.__ssrString!({}, {}))
      expect(typeof html, `${name}'s __ssrString did not return a string`).toBe('string')

      // …and the arbor-tree entry, which the walker uses when the fast path is
      // unavailable. Both run the same setup body, so both must survive it.
      expect(typeof mod.__ssr, `${name} exports no __ssr`).toBe('function')
      expect(_withSsrLifecycle(() => mod.__ssr!())).toBeTruthy()
    })
  }

  it('the four styled recipes registered nothing, rather than throwing quietly', () => {
    // The guard's whole premise is that skipping registration is FREE on the
    // server. Nothing above would notice a recipe that grew a real DOM shim and
    // started registering for real, so state it: after 53 renders there is
    // still no custom-element registry in this realm.
    expect(typeof customElements).toBe('undefined')
  })
})

describe('the shipped recipe sources carry the guard', () => {
  /**
   * A source-level companion to the execution above, and NOT a substitute for
   * it. Execution proves the recipes are safe as written; this proves the
   * SPECIFIC construct that broke cannot come back unguarded — including in a
   * recipe whose renderer happens not to reach it on the default props.
   */
  const DOM_ONLY = /\b(?:CSSStyleSheet|customElements|HTMLElement)\b/

  for (const [name, file] of RECIPES) {
    it(`${name}'s @state block guards any DOM global it names`, () => {
      const src = readFileSync(file, 'utf8')
      const state = /@state\s*\{([\s\S]*?)\n\}/.exec(src)?.[1] ?? ''
      // Comments are prose, not code — `chat-fab.aihu` and `temperature.aihu`
      // both DISCUSS `customElements.define` without calling it.
      const code = state.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      if (!DOM_ONLY.test(code)) return
      expect(
        code,
        `${name}'s @state names a DOM global but has no \`typeof … === 'undefined'\` guard; ` +
          `the compiler emits @state into the setup body a server render executes`,
      ).toMatch(/typeof\s+(?:HTMLElement|customElements|CSSStyleSheet)\s*!==\s*'undefined'/)
    })
  }
})

describe('the emitted modules really are server-target builds', () => {
  it('carry the server artifacts, not a client build the assertions would skip', () => {
    // Every `renders` case above is gated on `typeof mod.__ssrString ===
    // 'function'`. If `target: 'server'` ever stopped taking effect, those
    // gates would fail — but a future refactor could just as easily soften
    // them into `if (!mod.__ssrString) return`, and the suite would go green
    // while executing nothing. Assert the property directly, once.
    for (const [name] of RECIPES) {
      const code = readFileSync(emitted.get(name)!, 'utf8')
      expect(code, `${name} was not compiled at the server target`).toContain(
        'export const __ssrString',
      )
      // The client-only `new CSSStyleSheet()` for the `@style` block is
      // ELIDED at this target (`emit_ssr_css_export`, emit.rs) — the CSS rides
      // as the `__aihu_css__` string instead. Any `new CSSStyleSheet()` left
      // in a server module therefore came from a recipe's own `@state`.
      const fromState = code.split('export const __aihu_css__')[0] ?? code
      if (fromState.includes('new CSSStyleSheet()')) {
        expect(fromState, `${name} constructs a CSSStyleSheet outside a DOM guard`).toMatch(
          /typeof\s+(?:HTMLElement|customElements|CSSStyleSheet)\s*!==\s*'undefined'/,
        )
      }
    }
  })
})
