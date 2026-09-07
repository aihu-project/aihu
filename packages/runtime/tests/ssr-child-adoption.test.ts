// @vitest-environment jsdom
/**
 * SSR child rendering ⇄ client adoption — the CROSS-BOUNDARY suite (§21 of
 * `docs/plans/2026-08-06-ssr-child-followups.md`).
 *
 * Server bytes are pinned by `packages/runtime/tests/ssr-child.test.ts` and by
 * the differential gate; client adoption is pinned by
 * `packages/arbor/tests/hydrate-child-host.test.ts` and
 * `declarative-shadow-adoption.test.ts`. NOTHING JOINED THEM: their meeting
 * point was covered only by eyeballing an `apps/docs` build. That gap hid the
 * duplicate-host bug (a child host carries BOTH `data-aihu-path` and
 * `data-aihu-ssr`, so `el.closest()` made every host its own path-map
 * boundary), and the arbor test that pins the fix hand-writes its HTML rather
 * than taking it from the real server renderer.
 *
 * Every fixture here goes through the REAL pipeline end to end:
 *
 *   .aihu source
 *     → the real Vite plugin transform (so `__aihu_light_scope__`,
 *       `__aihu_shadow__`, `__AIHU_LIGHT_SCOPE_ID__` and `__aihu_child_tags__`
 *       are the compiler's, not a hand-written stand-in)
 *     → the compiled `__ssrString`, which calls the real `__aihu_schild`
 *       with a real registry
 *     → those exact bytes into a jsdom document
 *     → adoption, either by calling `hydrate` directly or by letting
 *       `defineElement`/`defineComponent` upgrade the host the way a browser
 *       does.
 *
 * Two things are asserted about the harness itself, because a green test over
 * the WRONG bytes is worse than no test: `SCHILD_MARKER` proves the compiled
 * renderer actually emitted a `__aihu_schild` call (a stale compiler backend
 * emits a plain empty element and every adoption assertion below would pass
 * vacuously), and the child content is asserted present in the server string
 * before anything hydrates.
 *
 * NOTE ON THE COMPILER BACKEND. `transform()` prefers the in-process napi
 * addon (`@aihu/compiler-native-*`), which is a PUBLISHED package — on a
 * working tree whose Rust source is ahead of that release it silently compiles
 * the old grammar. Observed here: the installed addon emits `<x-kid></x-kid>`
 * where this branch's source emits `__aihu_schild('x-kid', …)`. The backend is
 * therefore pinned to the CLI binary, and the marker assertion makes a stale
 * binary fail loudly instead of quietly.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mount } from '@aihu/arbor'
import { hydrate } from '@aihu/arbor/hydrate'
import { signal } from '@aihu/signals'
import { afterAll, describe, expect, it } from 'vitest'
import { aihuCompilerPlugin } from '../../compiler/js/index.ts'
import { _setHydrate, _setMount, _setSignal } from '../src/define-component.ts'
import type { SsrChildModule, SsrChildRenderOpts } from '../src/ssr-string.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../../..')

// Pin the compile backend to the CLI binary (see the module docblock). Set
// before the first `transform`, which is when the backend is resolved.
process.env.AIHU_COMPILER_NATIVE = '0'
const BIN = ['packages/compiler/bin/aihu-compile', 'target/release/aihu-compile']
  .map((p) => join(repoRoot, p))
  .find((p) => existsSync(p))
if (BIN) process.env.AIHU_COMPILE_BIN ??= BIN

const SCRATCH = join(__dirname, '.scratch-ssr-child-adoption')
afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true })
})

/** The call site whose ABSENCE would make every assertion below vacuous. */
const SCHILD_MARKER = '__aihu_schild('

// The client runtime's three injection seams, wired to the REAL arbor/signals
// implementations so a `data-aihu-ssr` host takes the adopt branch in
// `define-component.ts` exactly as it does under `@aihu/app`'s bootstrap.
_setMount(mount)
_setSignal(signal as Parameters<typeof _setSignal>[0])
_setHydrate(hydrate as unknown as Parameters<typeof _setHydrate>[0])

type TransformFn = (
  this: unknown,
  code: string,
  id: string,
) => Promise<{ code: string } | null | undefined>

/** The hook `this` a Vite SERVER environment supplies (mirrors the SSG build). */
const SERVER_ENV = { environment: { config: { consumer: 'server' } } }

/**
 * Rewrite the compiled module's bare specifiers to this repo's sources, and
 * drop the css-engine virtual import (a Vite-only id with no resolver here).
 * The TS-strip normalizes to double quotes, hence the quote style.
 */
function resolveImports(code: string): string {
  return code
    .split('\n')
    .filter((l) => !l.includes('virtual:aihu-utility'))
    .join('\n')
    .replaceAll('"@aihu/runtime/ssr"', `"${repoRoot}/packages/runtime/src/ssr-string.ts"`)
    .replaceAll('"@aihu/runtime"', `"${repoRoot}/packages/runtime/src/index.ts"`)
}

/**
 * The compiled server module's shape. Deliberately NOT `extends
 * SsrChildModule`: that interface types `__ssrString`'s first parameter as
 * `unknown` (it is only ever called with `{}` from `__aihu_schild`), which is
 * not callable from a test that passes an opts bag. Every registry entry casts
 * across in `registry()`.
 */
interface ServerModule {
  /** The host-less arbor-tree factory — what the client walker hydrates. */
  readonly __ssr: () => never
  readonly __ssrString: (props: Record<string, never>, opts?: SsrChildRenderOpts) => string
  readonly __aihu_tag__?: string
  readonly __aihu_shadow__?: SsrChildModule['__aihu_shadow__']
  readonly __aihu_light_scope__?: string
  readonly __aihu_child_tags__?: readonly string[]
}

/**
 * Compile `.aihu` source through the real plugin for a SERVER consumer and
 * import the result.
 *
 * The server target is the one that matters on both sides: it exports
 * `__ssrString` (the bytes) AND `__ssr` (the arbor tree the client walks), and
 * its `defineElement` registration is guarded on `typeof customElements` — so
 * importing it in jsdom ALSO registers the custom element, giving the real
 * upgrade path for free. The lowered tree is byte-identical to the client
 * target's (verified against `transform(..., { target: 'client' })`: the
 * `html={…}` mount effect and the `raw` child-drop are emitted the same in
 * both), so nothing here depends on the server/client split.
 */
async function compile(
  name: string,
  src: string,
  shadowMode: 'light' | 'shadow' = 'light',
): Promise<ServerModule> {
  mkdirSync(SCRATCH, { recursive: true })
  const plugin = aihuCompilerPlugin({ shadowMode })
  const transform = plugin.transform as unknown as TransformFn
  const res = await transform.call(SERVER_ENV, src, join(SCRATCH, `${name}.aihu`))
  if (res == null) throw new Error(`plugin returned no result for ${name}`)
  const file = join(SCRATCH, `${name}.server.ts`)
  writeFileSync(file, resolveImports(res.code))
  const mod = (await import(/* @vite-ignore */ file)) as unknown as ServerModule
  emitted.set(mod, res.code)
  return mod
}

/**
 * The compiled source behind each imported module — the only place the
 * `__aihu_schild` call site is visible (`__ssrString` is a thin wrapper around
 * the inner setup fn, so `Function.prototype.toString` on it shows nothing).
 */
const emitted = new WeakMap<ServerModule, string>()

/** Fail loudly when the compiler backend did not emit a child call at all. */
function expectSchild(mod: ServerModule): void {
  expect(emitted.get(mod) ?? '').toContain(SCHILD_MARKER)
}

const registry = (...mods: ServerModule[]): Map<string, SsrChildModule> =>
  new Map(mods.map((m) => [m.__aihu_tag__ as string, m as unknown as SsrChildModule]))

/** Non-overlapping occurrences of `needle`. */
function count(haystack: string, needle: string): number {
  let n = 0
  let i = haystack.indexOf(needle)
  while (i !== -1) {
    n++
    i = haystack.indexOf(needle, i + needle.length)
  }
  return n
}

/**
 * What the HTML parser does with `<template shadowrootmode="open">` and jsdom
 * does not: attach the root and move the template's content into it, on an
 * element that has not been upgraded yet. Same hand-attachment
 * `declarative-shadow-adoption.test.ts` uses, but driven off the REAL bytes
 * `__aihu_schild` emitted rather than a literal.
 */
function attachDeclarativeShadowRoots(root: ParentNode): number {
  let n = 0
  for (const tpl of Array.from(root.querySelectorAll('template[shadowrootmode]'))) {
    const host = tpl.parentElement
    if (!host) continue
    const mode = tpl.getAttribute('shadowrootmode') as ShadowRootMode
    // `?? attachShadow` and not a bare attach: these fixtures import the
    // component module (which is how they get `__ssrString`), so the element
    // is DEFINED before the markup is parsed and `define-element.ts`'s
    // constructor has already attached an empty root. The browser ordering is
    // the reverse — parser attaches the populated root, definition upgrades it
    // later — and the two converge on the same state (`!this.shadowRoot`
    // guards the constructor there), which is the state this reproduces.
    const sr = host.shadowRoot ?? host.attachShadow({ mode })
    sr.append((tpl as HTMLTemplateElement).content)
    tpl.remove()
    n++
  }
  return n
}

/** A detached container: nothing upgrades, so `hydrate` is observed alone. */
function detachedFrom(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  return el
}

const hasBinary = BIN !== undefined

// ---------------------------------------------------------------------------
// 1. Light-DOM child — the duplicate-host and double-stamp bugs
// ---------------------------------------------------------------------------

describe.skipIf(!hasBinary)('light-DOM child: real server bytes are ADOPTED, not rebuilt', () => {
  const KID = `@template {\n  <nav><span>KID-CONTENT</span></nav>\n}\n`
  const PARENT = `@template {\n  <section><h1>PARENT</h1><x-lkid></x-lkid></section>\n}\n`

  async function fixture() {
    const kid = await compile('x-lkid', KID)
    const parent = await compile('x-lpar', PARENT)
    const html = parent.__ssrString({}, { hydratable: true, children: registry(kid) })
    return { kid, parent, html }
  }

  it('the harness really exercised __aihu_schild (guards every case below)', async () => {
    const { parent, html } = await fixture()
    // If the compiler backend is stale this is a plain `<x-lkid></x-lkid>` and
    // every adoption assertion in this file passes over markup that has no
    // child in it at all.
    expectSchild(parent)
    expect(html).toContain('KID-CONTENT')
    expect(html).toContain('data-aihu-ssr')
    expect(parent.__aihu_child_tags__).toEqual(['x-lkid'])
  })

  it('exactly ONE host survives hydration (the duplicate-host bug)', async () => {
    const { parent, html } = await fixture()
    const container = detachedFrom(html)

    hydrate(parent.__ssr, container, {})

    // Pre-fix (`el.closest` instead of `el.parentElement?.closest` in
    // hydrate.ts) the host was its own path-map boundary: pruned from the
    // parent's map, missed on lookup, and re-materialized as a SECOND host
    // appended at the end of `<section>`.
    expect(container.querySelectorAll('x-lkid')).toHaveLength(1)
  })

  it("the child's server content is preserved verbatim", async () => {
    const { parent, html } = await fixture()
    const container = detachedFrom(html)
    const before = container.innerHTML

    hydrate(parent.__ssr, container, {})

    // Adoption is byte-stable: the parent treats the host as a childless leaf,
    // so nothing it does may touch the child's subtree.
    expect(container.innerHTML).toBe(before)
    expect(count(container.textContent ?? '', 'KID-CONTENT')).toBe(1)
  })

  it('data-a is stamped ONCE — on the host, never on the child template root', async () => {
    const { kid, parent, html } = await fixture()

    // The double-stamp bug: `__aihu_schild` must pass `lightScopeId: ''`, not
    // omit it, or the child module's own `?? __AIHU_LIGHT_SCOPE_ID__` fallback
    // stamps the template root too — making it a nested `@scope(…) to
    // ([data-a])` root that cuts the child's rules off at its first child.
    // Non-vacuous only because the kid module really carries an injected
    // scope id to fall back to:
    expect(kid.__aihu_light_scope__).toMatch(/^[0-9a-f]{8}$/)

    const container = detachedFrom(html)
    hydrate(parent.__ssr, container, {})

    const host = container.querySelector('x-lkid') as Element
    expect(host.getAttribute('data-a')).toBe(kid.__aihu_light_scope__)
    // Nothing INSIDE the host carries one — one stamp, on the host, total.
    expect(host.querySelectorAll('[data-a]')).toHaveLength(0)
    expect(count(host.outerHTML, 'data-a=')).toBe(1)
  })

  it('the host stays a LEAF: the parent never walks into the child key space', async () => {
    const { parent, html } = await fixture()
    const container = detachedFrom(html)

    hydrate(parent.__ssr, container, {})

    // The child's `<nav data-aihu-path="0">` restarts at ROOT_PATH in the
    // CHILD's key space and must not collide with the parent's own root.
    expect(container.querySelector('section')?.getAttribute('data-aihu-path')).toBe('0')
    expect(container.querySelectorAll('nav')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 2. Shadow child — declarative shadow root, adopted on upgrade
// ---------------------------------------------------------------------------

describe.skipIf(!hasBinary)('shadow child: the declarative root is adopted', () => {
  const KID = `@template {\n  <nav><span>SHADOW-KID</span></nav>\n}\n\n@style {\n  nav { color: rebeccapurple; }\n}\n`
  const PARENT = `@template {\n  <section><h1>PARENT</h1><x-skid></x-skid></section>\n}\n`

  async function fixture() {
    const kid = await compile('x-skid', KID, 'shadow')
    const parent = await compile('x-spar', PARENT, 'shadow')
    const html = parent.__ssrString({}, { hydratable: true, children: registry(kid) })
    return { kid, parent, html }
  }

  it('emits a declarative template with the styles INSIDE it', async () => {
    const { kid, html } = await fixture()
    expect(kid.__aihu_shadow__).toBe('shadow')
    expect(html).toContain('<template shadowrootmode="open">')
    // #754: a shadow root is style-isolated, so CSS outside it paints nothing.
    expect(html).toContain('<style>')
    expect(html.indexOf('<style>')).toBeLessThan(html.indexOf('SHADOW-KID'))
    // A shadow child is NOT light-stamped — its rules live in its own root.
    expect(html).not.toContain('data-a="undefined"')
  })

  it('the parent adopts the host without disturbing its shadow tree', async () => {
    const { parent, html } = await fixture()
    const container = detachedFrom(html)
    expect(attachDeclarativeShadowRoots(container)).toBe(1)
    const host = container.querySelector('x-skid') as HTMLElement
    const rootBefore = host.shadowRoot

    hydrate(parent.__ssr, container, {})

    expect(container.querySelectorAll('x-skid')).toHaveLength(1)
    expect(host.shadowRoot).toBe(rootBefore)
    expect(host.shadowRoot?.querySelectorAll('nav')).toHaveLength(1)
    expect(host.shadowRoot?.textContent).toContain('SHADOW-KID')
  })

  it('upgrading the host adopts the parser root instead of re-rendering it', async () => {
    const { html } = await fixture()
    const container = detachedFrom(html)
    attachDeclarativeShadowRoots(container)
    const host = container.querySelector('x-skid') as HTMLElement
    const navBefore = host.shadowRoot?.querySelector('nav')

    // Connecting drives the real upgrade: `_hasDeclarativeShadowTemplate` →
    // adopt into `shadowRoot`, not `mount` into a cleared one.
    document.body.appendChild(container)
    try {
      expect(host.shadowRoot?.querySelectorAll('nav')).toHaveLength(1)
      expect(host.shadowRoot?.querySelector('nav')).toBe(navBefore)
      expect(host.shadowRoot?.querySelector('style')).not.toBeNull()
      expect(count(host.shadowRoot?.textContent ?? '', 'SHADOW-KID')).toBe(1)
    } finally {
      container.remove()
    }
  })
})

// ---------------------------------------------------------------------------
// 3a. `html={…}` on a reference — the first-run skip, EXECUTED
// ---------------------------------------------------------------------------

/**
 * The emitted client effect is
 *
 *   `_skip = _a0 && _el.childNodes.length > 0 && _el.closest('[data-aihu-ssr]') !== null`
 *
 * and the claim that it "prevents the server's content being replaced on
 * hydrate" was verified by READING it. Reading cannot see that the effect only
 * exists at all when `onMount` has a component owner — a direct
 * `hydrate(mod.__ssr, …)` call registers nothing, because the compiled
 * `onMount` sits inside a `try {} catch {}` and throws SCR-R0010 without one.
 * So these two run the REAL upgrade path, and the control proves the effect is
 * live rather than absent.
 */
describe.skipIf(!hasBinary)('html={…} on a child reference: the first-run skip', () => {
  const KID = `@template {\n  <nav><span>KID-CONTENT</span></nav>\n}\n`
  const PARENT = `@state {
  const [h, setH] = signal('<b>FROM-HTML</b>')
  ;(globalThis as any).__aihuTestSetH = setH
}

@template {
  <section><h1>PARENT</h1><x-hkid html={h}></x-hkid></section>
}
`

  async function fixture() {
    const kid = await compile('x-hkid', KID)
    const parent = await compile('x-hpar', PARENT)
    const html = parent.__ssrString({}, { hydratable: true, children: registry(kid) })
    return { kid, parent, html }
  }

  const setH = (v: string) =>
    (globalThis as unknown as { __aihuTestSetH: (s: string) => void }).__aihuTestSetH(v)

  it('a `html=` reference still resolves the child server-side', async () => {
    const { parent, html } = await fixture()
    // `html` is a DIRECTIVE, so it does not disqualify the reference; the
    // child is rendered and the html expression is never serialized.
    expectSchild(parent)
    expect(html).toContain('KID-CONTENT')
    expect(html).not.toContain('FROM-HTML')
  })

  it("ADOPT: the effect's first run leaves the server's child content alone", async () => {
    const { html } = await fixture()
    // The wrapTag shape a prerendered page ships: the render inside its host,
    // marked for adoption.
    const wrapper = document.createElement('x-hpar')
    wrapper.setAttribute('data-aihu-ssr', '')
    wrapper.innerHTML = html
    document.body.appendChild(wrapper)
    try {
      const host = wrapper.querySelector('x-hkid') as HTMLElement
      expect(wrapper.querySelectorAll('x-hkid')).toHaveLength(1)
      expect(host.textContent).toContain('KID-CONTENT')
      expect(wrapper.innerHTML).not.toContain('FROM-HTML')
    } finally {
      wrapper.remove()
    }
  })

  it('CONTROL: the same effect DOES write when there is no server subtree', async () => {
    // Without this the adopt case above is unfalsifiable — an effect that
    // never ran would also leave the server content untouched.
    await fixture()
    setH('<b>FROM-HTML</b>')
    const fresh = document.createElement('x-hpar') // unmarked, empty → mount path
    document.body.appendChild(fresh)
    try {
      const host = fresh.querySelector('x-hkid') as HTMLElement
      expect(host.innerHTML).toContain('FROM-HTML')
    } finally {
      fresh.remove()
    }
  })

  it('SKIP IS FIRST-RUN ONLY: a later write still reaches the adopted host', async () => {
    const { html } = await fixture()
    const wrapper = document.createElement('x-hpar')
    wrapper.setAttribute('data-aihu-ssr', '')
    wrapper.innerHTML = html
    document.body.appendChild(wrapper)
    try {
      const host = wrapper.querySelector('x-hkid') as HTMLElement
      setH('<i>UPDATED</i>')
      await Promise.resolve()
      // `_a0` is false now, so the effect writes — proving it was WIRED to the
      // server's own host and merely declined its first run.
      expect(host.innerHTML).toContain('UPDATED')
      expect(host.innerHTML).not.toContain('KID-CONTENT')
    } finally {
      wrapper.remove()
      setH('<b>FROM-HTML</b>')
    }
  })
})

// ---------------------------------------------------------------------------
// 3b. `raw` with written children — do both sides discard them?
// ---------------------------------------------------------------------------

describe.skipIf(!hasBinary)(
  'raw on a child reference: both sides drop the written children',
  () => {
    const KID = `@template {\n  <nav><span>KID-CONTENT</span></nav>\n}\n`
    const RAW = `@template {\n  <section><x-rkid raw><span>WRITTEN</span></x-rkid></section>\n}\n`
    const PLAIN = `@template {\n  <section><x-rkid2><span>WRITTEN</span></x-rkid2></section>\n}\n`

    it('SERVER: `raw` still resolves the child, and the written children vanish', async () => {
      const kid = await compile('x-rkid', KID)
      const parent = await compile('x-rpar', RAW)
      const html = parent.__ssrString({}, { hydratable: true, children: registry(kid) })
      expectSchild(parent)
      expect(html).toContain('KID-CONTENT')
      expect(html).not.toContain('WRITTEN')
    })

    it('CLIENT: the lowered tree agrees — hydration adds no written children back', async () => {
      const kid = await compile('x-rkid', KID)
      const parent = await compile('x-rpar', RAW)
      const html = parent.__ssrString({}, { hydratable: true, children: registry(kid) })
      const container = detachedFrom(html)
      const before = container.innerHTML

      hydrate(parent.__ssr, container, {})

      // If lowering kept `<span>WRITTEN</span>` the walker would materialize it
      // INSIDE the adopted host, on top of the child's own server tree.
      expect(container.innerHTML).toBe(before)
      expect(container.textContent).not.toContain('WRITTEN')
      expect(container.querySelectorAll('x-rkid')).toHaveLength(1)
    })

    it('CONTROL: WITHOUT `raw` the same children block resolution on both sides', async () => {
      // Proves the two assertions above are about `raw` and not about children
      // being ignored generally.
      const kid = await compile('x-rkid2', KID)
      const parent = await compile('x-rpar2', PLAIN)
      const html = parent.__ssrString({}, { hydratable: true, children: registry(kid) })
      // Written children are slot content, and slot projection is unimplemented:
      // the reference declines and the child is NOT rendered.
      expect(html).not.toContain('KID-CONTENT')
      expect(html).toContain('WRITTEN')

      const container = detachedFrom(html)
      hydrate(parent.__ssr, container, {})
      expect(count(container.textContent ?? '', 'WRITTEN')).toBe(1)
    })
  },
)

// ---------------------------------------------------------------------------
// 4. Nested — a child inside a child
// ---------------------------------------------------------------------------

describe.skipIf(!hasBinary)('nested children: each marked host owns its own key space', () => {
  const GRAND = `@template {\n  <p>GRAND-CONTENT</p>\n}\n`
  const KID = `@template {\n  <div><span>KID-SPAN</span><x-ngrand></x-ngrand></div>\n}\n`
  const PARENT = `@template {\n  <section><h1>PARENT</h1><x-nkid></x-nkid></section>\n}\n`

  async function fixture() {
    const grand = await compile('x-ngrand', GRAND)
    const kid = await compile('x-nkid', KID)
    const parent = await compile('x-npar', PARENT)
    const html = parent.__ssrString({}, { hydratable: true, children: registry(grand, kid) })
    return { grand, kid, parent, html }
  }

  it('the server nests both, each restarting data-aihu-path at ROOT', async () => {
    const { html } = await fixture()
    expect(count(html, 'data-aihu-ssr')).toBe(2)
    expect(html).toContain('KID-SPAN')
    expect(html).toContain('GRAND-CONTENT')
    // The kid host sits at 0.1 in the PARENT's space; the kid's own root
    // restarts at 0, and the grandchild host is 0.1 in the KID's space.
    expect(html).toContain('<x-nkid data-aihu-path="0.1"')
    expect(html).toContain('<x-ngrand data-aihu-path="0.1"')
  })

  it('the PARENT adopts its host and does not reach into the kid subtree', async () => {
    const { parent, html } = await fixture()
    const container = detachedFrom(html)
    const before = container.innerHTML

    hydrate(parent.__ssr, container, {})

    expect(container.innerHTML).toBe(before)
    expect(container.querySelectorAll('x-nkid')).toHaveLength(1)
    expect(container.querySelectorAll('x-ngrand')).toHaveLength(1)
  })

  it('the KID adopts its own subtree, grandchild host included', async () => {
    const { kid, html } = await fixture()
    const container = detachedFrom(html)
    const kidHost = container.querySelector('x-nkid') as Element
    const before = container.innerHTML

    hydrate(kid.__ssr, kidHost, {})

    expect(container.innerHTML).toBe(before)
    expect(container.querySelectorAll('x-ngrand')).toHaveLength(1)
    expect(count(container.textContent ?? '', 'GRAND-CONTENT')).toBe(1)
  })

  /**
   * KNOWN BUG — `it.fails` so the suite stays green AND flips the moment the
   * fix lands. Flip to `it` to watch it fail.
   *
   * `hydrate()` finishes building its path map with
   *
   *   const hp = root.getAttribute?.('data-aihu-path')
   *   if (hp != null) pathMap.set(hp, root)
   *
   * That is right when the container IS this render's root element (path `0`).
   * It is wrong for a marked CHILD host, which carries its slot in the
   * PARENT's key space (`0.1`) while hydrating its OWN key space — so the host
   * registers itself under `0.1` and CLOBBERS whatever the kid's own tree has
   * at `0.1`. Here that is the grandchild host: the grandchild branch node
   * gets `.el = <x-nkid>` instead of `<x-ngrand>`.
   *
   * Structurally invisible (the grandchild reference has no children, so the
   * walk stops there and the DOM is unchanged) — which is exactly why nothing
   * caught it. It surfaces the first time anything reads that node's `.el`.
   * A reactive `html={…}` on the nested reference does, and then a write
   * replaces the ENTIRE kid subtree instead of the grandchild's:
   *
   *   <x-nkid …><i>UPDATE</i></x-nkid>          ← the whole `<div>` is gone
   *
   * The same seam carries `class:`, `ref=`, and the router's link boundary.
   *
   * Fix (verified against this test and the full arbor+runtime+integration
   * suites, 449 passing): register the container's own path only when it is
   * this render's ROOT key —
   *
   *   if (hp === _ROOT_PATH) pathMap.set(hp, root)
   *
   * A render always starts at `_ROOT_PATH`, so any other value is a foreign
   * key space by construction.
   */
  it('FIXED: the kid host clobbers its own 0.1 in the path map', async () => {
    const grand = await compile('x-bgrand', `@template {\n  <p>GRAND-CONTENT</p>\n}\n`)
    const kid = await compile(
      'x-bkid',
      `@state {
  const [h, setH] = signal('<b>H1</b>')
  ;(globalThis as any).__aihuTestSetNested = setH
}

@template {
  <div><span>KID-SPAN</span><x-bgrand html={h}></x-bgrand></div>
}
`,
    )
    const parent = await compile(
      'x-bpar',
      `@template {\n  <section><h1>PARENT</h1><x-bkid></x-bkid></section>\n}\n`,
    )
    const html = parent.__ssrString({}, { hydratable: true, children: registry(grand, kid) })

    const container = detachedFrom(html)
    document.body.appendChild(container)
    try {
      const kidHost = container.querySelector('x-bkid') as HTMLElement
      expect(kidHost.querySelector('x-bgrand')).not.toBeNull()

      ;(globalThis as unknown as { __aihuTestSetNested: (s: string) => void }).__aihuTestSetNested(
        '<i>UPDATE</i>',
      )
      await Promise.resolve()

      // The write must land in the GRANDCHILD host…
      expect(container.querySelector('x-bgrand')?.innerHTML).toContain('UPDATE')
      // …and must not take the kid's own template with it.
      expect(container.textContent).toContain('KID-SPAN')
    } finally {
      container.remove()
    }
  })
})

// ---------------------------------------------------------------------------
// 5. Positional text adoption past the injected <style>
// ---------------------------------------------------------------------------

/**
 * Text-node adoption is POSITIONAL: a text leaf claims the next unclaimed text
 * node at or after a shared cursor. A shadow child's declarative root gets a
 * `<style>` injected AHEAD of the component's own tree, so a template whose
 * first node is TEXT (a multi-root template lowers to `branch(null, …)`, which
 * hydrates its children straight into the host) starts its cursor walk with an
 * element that the server never produced from the tree.
 *
 * Flagged in §21 as untested. It turns out to be ALREADY CORRECT — the claim
 * loop skips non-text nodes rather than taking `childNodes[i]` positionally —
 * but nothing said so, and the property is one line of `hydrate.ts` away from
 * being lost. These pin it.
 */
describe.skipIf(!hasBinary)('shadow child whose template starts with a text node', () => {
  const KID = `@state {
  const [w, setW] = signal('WORLD')
  ;(globalThis as any).__aihuTestSetW = setW
}

@template {
  LEAD {w}<p>TAIL</p>
}

@style {
  p { color: teal; }
}
`
  const PARENT = `@template {\n  <section><h1>PARENT</h1><x-tkid></x-tkid></section>\n}\n`

  async function fixture() {
    const kid = await compile('x-tkid', KID, 'shadow')
    const parent = await compile('x-tpar', PARENT, 'shadow')
    const html = parent.__ssrString({}, { hydratable: true, children: registry(kid) })
    return { kid, parent, html }
  }

  it('the injected <style> really does precede a leading text node', async () => {
    const { html } = await fixture()
    // The hazard has to EXIST for the test below to mean anything.
    expect(html).toContain('<style>')
    expect(html.indexOf('<style>')).toBeLessThan(html.indexOf('LEAD'))

    const container = detachedFrom(html)
    attachDeclarativeShadowRoots(container)
    const root = (container.querySelector('x-tkid') as HTMLElement).shadowRoot as ShadowRoot
    expect(root.childNodes[0]?.nodeName).toBe('STYLE')
    expect(root.childNodes[1]?.nodeType).toBe(3 /* TEXT_NODE */)
  })

  it('the text leaves claim the SERVER text nodes, not the style element', async () => {
    const { kid, html } = await fixture()
    const container = detachedFrom(html)
    attachDeclarativeShadowRoots(container)
    const root = (container.querySelector('x-tkid') as HTMLElement).shadowRoot as ShadowRoot
    const styleBefore = root.querySelector('style')
    const before = root.innerHTML

    hydrate(kid.__ssr, root, {})

    expect(root.innerHTML).toBe(before)
    expect(root.querySelector('style')).toBe(styleBefore)
    expect(count(root.textContent ?? '', 'WORLD')).toBe(1)
    expect(count(root.textContent ?? '', 'LEAD')).toBe(1)
    expect(root.querySelectorAll('p')).toHaveLength(1)
  })

  it('a write drives the adopted text node — proof the claim bound correctly', async () => {
    const { kid, html } = await fixture()
    const container = detachedFrom(html)
    attachDeclarativeShadowRoots(container)
    const root = (container.querySelector('x-tkid') as HTMLElement).shadowRoot as ShadowRoot

    hydrate(kid.__ssr, root, {})
    ;(globalThis as unknown as { __aihuTestSetW: (s: string) => void }).__aihuTestSetW('MOON')
    await Promise.resolve()

    // Mis-claiming would either write into the <style> (breaking its CSS) or
    // create a second text node.
    expect(root.querySelector('style')?.textContent).toContain('color')
    expect(root.querySelector('style')?.textContent).not.toContain('MOON')
    expect(count(root.textContent ?? '', 'MOON')).toBe(1)
    expect(root.textContent).toContain('LEAD')
  })
})

// ---------------------------------------------------------------------------
// 6. A STRUCTURAL template root (followups §24)
// ---------------------------------------------------------------------------

/**
 * `<x-kid if={…}>` as the WHOLE template puts the reference at
 * `0.conditional.true` rather than `'0'`, so it clears the child gate's root
 * check and BOTH renderers resolve it. §24 asked whether that is a hole that
 * should be closed by declining there too.
 *
 * These fixtures are the reason it should not be: the resolved child at a
 * structural root is not merely byte-identical across the two SERVER
 * renderers, it ADOPTS on the client — one host, content preserved verbatim,
 * one `data-a`. Declining would delete markup that demonstrably works, which
 * is the empty-first-paint class the child feature exists to remove.
 *
 * Note what is NOT asserted: the PARENT's own `data-a`. Neither renderer
 * stamps one in this shape (`root_scope_attr` and the walker's
 * `path === ROOT_PATH` both fire only for a single ELEMENT root), which is
 * §24's real finding — and the differential suite pins that the two agree on
 * it. It is not a child-gate property: a plain `<div if={…}>` root loses the
 * same stamp with no component anywhere. The stamp that MATTERS in the SSG
 * pipeline is the one `SsrOptions.wrapTag` puts on the host, which is also
 * where `define-element.ts` puts it on the client.
 */
describe.skipIf(!hasBinary)('a child under a STRUCTURAL template root', () => {
  const KID = `@template {\n  <nav><span>KID-CONTENT</span></nav>\n}\n`
  const PARENT = `@state {
  const [on, setOn] = signal(true)
}

@template {
  <x-ckid if={on()}></x-ckid>
}
`

  async function fixture() {
    const kid = await compile('x-ckid', KID)
    const parent = await compile('x-cpar', PARENT)
    const html = parent.__ssrString({}, { hydratable: true, children: registry(kid) })
    return { kid, parent, html }
  }

  it('the reference really resolved at 0.conditional.true', async () => {
    const { parent, html } = await fixture()
    // Without this the adoption assertions below would pass over an empty
    // element — the exact vacuity the module docblock warns about.
    expectSchild(parent)
    expect(html).toContain('KID-CONTENT')
    expect(html).toContain('data-aihu-path="0.conditional.true"')
    // The structural markers still bracket it: the host is INSIDE the
    // conditional, not hoisted out of it.
    expect(html.indexOf('<!--aihu:s:0-->')).toBeLessThan(html.indexOf('<x-ckid'))
  })

  it('adopts: one host, content verbatim, one data-a', async () => {
    const { kid, parent, html } = await fixture()
    const container = detachedFrom(html)
    const before = container.innerHTML

    hydrate(parent.__ssr, container, {})

    expect(container.querySelectorAll('x-ckid')).toHaveLength(1)
    expect(container.innerHTML).toBe(before)
    expect(count(container.textContent ?? '', 'KID-CONTENT')).toBe(1)
    const host = container.querySelector('x-ckid') as Element
    expect(host.getAttribute('data-a')).toBe(kid.__aihu_light_scope__)
    expect(count(host.outerHTML, 'data-a=')).toBe(1)
  })
})
