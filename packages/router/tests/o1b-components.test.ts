/**
 * O1b tests for @aihu/router — the compile-time tag → module registry:
 *   - componentTagFor(): local copy of the compiler's kebabComponentTag
 *   - readAihuComponentTag(): @route name → file-stem resolution (§7a: NOT @meta)
 *   - scanComponents() / genC(): recursive scan + virtual:aihu-components codegen
 *   - RouteSidecar `components` plumbing through genR (SK whitelist)
 *   - viteRouterPlugin resolveId/load hooks for virtual:aihu-components
 */

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RouteDefinition } from '../src/index.ts'
import {
  componentTagFor,
  genC,
  genL,
  readAihuComponentTag,
  readAihuLayoutComponents,
  scanComponents,
  scanPages,
  viteRouterPlugin,
} from '../src/vite-plugin.ts'

// ---------------------------------------------------------------------------
// componentTagFor() — must match the compiler's kebabComponentTag contract
// ---------------------------------------------------------------------------

describe('componentTagFor()', () => {
  it('kebabs multi-word PascalCase', () => {
    expect(componentTagFor('UserCard')).toBe('user-card')
  })

  it('splits acronym boundaries (prev upper AND next lower)', () => {
    expect(componentTagFor('APIClient')).toBe('api-client')
  })

  it('passes hyphenated names through lowercased', () => {
    expect(componentTagFor('my-widget')).toBe('my-widget')
  })

  it('lowercases single-word PascalCase without inserting a hyphen', () => {
    expect(componentTagFor('Card')).toBe('card')
  })
})

// ---------------------------------------------------------------------------
// readAihuComponentTag() — @route name → file-stem precedence
//
// §7a of docs/plans/2026-08-06-ssr-child-followups.md. `@meta { name }` is NOT
// part of the precedence, because the COMPILER does not honour it: `SfcMeta`
// has no `name` field (R-META-COEXIST), so `defineElement` — and therefore
// `__aihu_tag__`, and therefore the tag the browser registers — resolves
// `@route { name }` → file stem. Verified against the real compiler:
// `@meta { name: "custom-thing" }` in `x-plain.aihu` emits
// `defineElement('x-plain', …)`.
// ---------------------------------------------------------------------------

describe('readAihuComponentTag()', () => {
  it('falls back to the (normalized) file stem when no @route name', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aihu-comp-tag-'))
    try {
      const f = join(tmp, 'UserCard.aihu')
      writeFileSync(f, '@template { <div>card</div> }\n')
      expect(readAihuComponentTag(f)).toBe('user-card')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  // The load-bearing assertion of §7a. This file compiles to
  // `defineElement('x-plain', …)`, so `x-plain` is the ONLY tag anything can
  // reference or register; a router that answered `custom-thing` would key the
  // `virtual:aihu-components` loader under a name no module defines — the
  // element never upgrades on the client, AND the SSR child registry (which
  // keys on `__aihu_tag__`) never matches it.
  it('IGNORES @meta { name } — the compiler does, so the tag is the file stem', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aihu-comp-tag-'))
    try {
      const f = join(tmp, 'x-plain.aihu')
      writeFileSync(f, '@meta {\n  name: "custom-thing"\n}\n@template { <div/> }\n')
      expect(readAihuComponentTag(f)).toBe('x-plain')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  // …and it does not merely lose to `@route`; it is not consulted at all, so a
  // file carrying both resolves exactly as if the `@meta` block were absent.
  // (Same order the compiler produced for the same fixture: a file with
  // `@meta { name: "meta-wins" }` + `@route { name: "route-thing" }` emitted
  // `defineElement('route-thing', …)`.)
  it('does not let @meta { name } outrank @route { name }', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aihu-comp-tag-'))
    try {
      const f = join(tmp, 'Whatever.aihu')
      writeFileSync(
        f,
        '@meta {\n  name: "meta-wins"\n}\n@route {\n  name: "route-thing"\n}\n@template { <div/> }\n',
      )
      expect(readAihuComponentTag(f)).toBe('route-thing')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('prefers @route { name } over the file stem', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aihu-comp-tag-'))
    try {
      const f = join(tmp, 'Whatever.aihu')
      writeFileSync(f, '@route {\n  name: "RouteNamed"\n}\n@template { <div/> }\n')
      expect(readAihuComponentTag(f)).toBe('route-named')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// scanComponents() / genC() — recursive scan + registry codegen
// ---------------------------------------------------------------------------

function writeFixture(tmp: string): void {
  writeFileSync(join(tmp, 'UserCard.aihu'), '@template { <div>card</div> }\n')
  mkdirSync(join(tmp, 'widgets'))
  writeFileSync(join(tmp, 'widgets', 'my-widget.aihu'), '@template { <div>w</div> }\n')
  // A `@meta` name that differs from the file stem — and is ignored (§7a), so
  // this keys as `something-else` exactly like a component with no `@meta`.
  writeFileSync(
    join(tmp, 'SomethingElse.aihu'),
    '@meta {\n  name: "x-thing"\n}\n@template { <div>x</div> }\n',
  )
}

describe('scanComponents()', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty map when components dir does not exist', () => {
    expect(scanComponents('/nonexistent/components-xyz-nope')).toEqual({})
  })

  it('maps normalized tags to absolute POSIX paths, recursing into subdirs', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aihu-components-'))
    try {
      writeFixture(tmp)
      const result = scanComponents(tmp)
      expect(Object.keys(result).sort()).toEqual(['my-widget', 'something-else', 'user-card'])
      expect(result['user-card']).toContain('UserCard.aihu')
      expect(result['my-widget']).toContain('widgets/my-widget.aihu')
      expect(result['something-else']).toContain('SomethingElse.aihu')
      expect(result['x-thing']).toBeUndefined()
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  // §7b. The tie-break has to be SORTED-FIRST, not traversal-last, because
  // `@aihu/server`'s `buildChildRegistry` keeps the first claimant over the
  // sorted list `@aihu/app`'s `discoverComponents` hands it. If the two picked
  // different winners, a prerendered page would ship one module's markup and
  // the client would upgrade the tag with the other module — a content swap on
  // hydrate.
  //
  // `listDir` is substituted so the traversal order is CHOSEN, not observed.
  // A fixture-only test cannot distinguish sorted-first from traversal-last:
  // with two colliding files the two answers coincide whenever the filesystem
  // happens to enumerate them in descending order, which is not something a
  // test may leave to the filesystem.
  it('breaks a tag collision by keeping the sorted-FIRST file, whatever order the dir lists in', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aihu-components-collide-'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      mkdirSync(join(tmp, 'a-dir'))
      mkdirSync(join(tmp, 'z-dir'))
      writeFileSync(join(tmp, 'a-dir', 'user-card.aihu'), '@template { <div/> }\n')
      writeFileSync(join(tmp, 'z-dir', 'user-card.aihu'), '@template { <div/> }\n')
      // Descending order: `z-dir` is enumerated first, so traversal-LAST is
      // `a-dir` — the same file sorted-FIRST picks. Under the old behaviour
      // this ordering alone would agree, which is exactly why the ASCENDING
      // case below is the one that discriminates. Both are asserted so the
      // test pins "order-independent", not just "one order happens to work".
      const descending = scanComponents(tmp, (dir) =>
        [...readdirSync(dir, { withFileTypes: true })].sort((x, y) =>
          x.name < y.name ? 1 : x.name > y.name ? -1 : 0,
        ),
      )
      expect(descending['user-card']).toContain('a-dir/user-card.aihu')

      warn.mockClear()
      // Ascending: traversal-last is `z-dir`, sorted-first is still `a-dir`.
      const ascending = scanComponents(tmp, (dir) =>
        [...readdirSync(dir, { withFileTypes: true })].sort((x, y) =>
          x.name < y.name ? -1 : x.name > y.name ? 1 : 0,
        ),
      )
      expect(Object.keys(ascending)).toEqual(['user-card'])
      expect(ascending['user-card']).toContain('a-dir/user-card.aihu')
      expect(ascending['user-card']).not.toContain('z-dir')

      // The warning names the winner and the loser, so a build log says which
      // file's markup is live rather than only that a collision happened.
      expect(warn).toHaveBeenCalledTimes(1)
      const msg = String(warn.mock.calls[0]?.[0])
      expect(msg).toContain('"user-card"')
      expect(msg).toContain('a-dir/user-card.aihu')
      expect(msg).toContain('z-dir/user-card.aihu')
      expect(msg).toMatch(/keeping .*a-dir\/user-card\.aihu/)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('genC()', () => {
  it('emits a sorted tag → () => import(path) registry', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aihu-genc-'))
    try {
      writeFixture(tmp)
      const content = genC(tmp)
      expect(content).toContain('// AUTO-GENERATED')
      expect(content).toContain('export default')
      // Bare loader thunks keyed by normalized tag — no { tag, load } wrapper.
      expect(content).toMatch(/"my-widget": \(\) => import\(".*widgets\/my-widget\.aihu"\)/)
      expect(content).toMatch(/"user-card": \(\) => import\(".*UserCard\.aihu"\)/)
      // §7a: keyed by the STEM, not by the `@meta { name: "x-thing" }` it carries.
      expect(content).toMatch(/"something-else": \(\) => import\(".*SomethingElse\.aihu"\)/)
      expect(content).not.toContain('x-thing')
      // Deterministic output: keys in sorted order.
      const iMy = content.indexOf('"my-widget"')
      const iSomething = content.indexOf('"something-else"')
      const iUser = content.indexOf('"user-card"')
      expect(iMy).toBeGreaterThan(-1)
      expect(iMy).toBeLessThan(iSomething)
      expect(iSomething).toBeLessThan(iUser)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  // A component's children are emitted by the compiler as BARE TAGS with no
  // import (`branch('search-box', …)`), so unless the registry loads them the
  // nested element never upgrades. Apps worked around that with eager
  // side-effect imports in their client entry, which drags every island into
  // the entry chunk — the whole cost this registry exists to avoid.
  it("a parent's loader also loads its transitively nested components", () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aihu-genc-nested-'))
    try {
      // site-header → search-box → search-hit  (two levels deep)
      writeFileSync(join(tmp, 'site-header.aihu'), '@template { <div><search-box/></div> }\n')
      writeFileSync(join(tmp, 'search-box.aihu'), '@template { <div><search-hit/></div> }\n')
      writeFileSync(join(tmp, 'search-hit.aihu'), '@template { <div/> }\n')
      const content = genC(tmp)
      // The parent pulls BOTH levels, not just its direct child.
      expect(content).toMatch(
        /"site-header": \(\) => Promise\.all\(\[__m\["site-header"\]\(\), __m\["search-box"\]\(\), __m\["search-hit"\]\(\)\]\)/,
      )
      // A leaf keeps the cheap single-thunk form — no needless Promise.all.
      expect(content).toContain('"search-hit": __m["search-hit"],')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('breaks cycles instead of hanging, and never self-references', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aihu-genc-cycle-'))
    try {
      // a-x ↔ b-x mutual reference, plus a self-reference in a-x. Filenames
      // must match the referenced tags — the tag is derived from the file.
      writeFileSync(join(tmp, 'a-x.aihu'), '@template { <div><b-x/><a-x/></div> }\n')
      writeFileSync(join(tmp, 'b-x.aihu'), '@template { <div><a-x/></div> }\n')
      const content = genC(tmp)
      // Terminates at all (a naive walk would recurse forever), and each side
      // pulls the other exactly once, itself first — no repeated self-entry.
      expect(content).toMatch(
        /"a-x": \(\) => Promise\.all\(\[__m\["a-x"\]\(\), __m\["b-x"\]\(\)\]\)/,
      )
      expect(content).toMatch(
        /"b-x": \(\) => Promise\.all\(\[__m\["b-x"\]\(\), __m\["a-x"\]\(\)\]\)/,
      )
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('drops referenced tags that no component file provides', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aihu-genc-unknown-'))
    try {
      // `<some-global>` is a globally-registered element the router doesn't own;
      // emitting a __m lookup for it would be a dangling reference.
      writeFileSync(join(tmp, 'host-el.aihu'), '@template { <div><some-global/></div> }\n')
      const content = genC(tmp)
      expect(content).not.toContain('some-global')
      expect(content).toContain('"host-el": __m["host-el"],')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// F2: readAihuLayoutComponents() / genL() — a layout's own referenced
// component tags, carried on each virtual:aihu-layouts entry
// ---------------------------------------------------------------------------

describe('readAihuLayoutComponents()', () => {
  it('extracts + normalizes component-shaped tags from the @template block', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aihu-layout-comps-'))
    try {
      const f = join(tmp, 'app.aihu')
      writeFileSync(
        f,
        [
          '@template {',
          '  <div class="shell">',
          '    <some-widget size="lg" />',
          '    <OtherThing label="x">nested</OtherThing>',
          '    <header><outlet /></header>',
          '  </div>',
          '}',
          '',
        ].join('\n'),
      )
      // Sorted, deduped, normalized (OtherThing → other-thing); plain HTML
      // tags (div, header) and the <outlet> marker are never collected.
      expect(readAihuLayoutComponents(f)).toEqual(['other-thing', 'some-widget'])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('survives nested braces inside the template (brace-balanced walk)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aihu-layout-comps-nested-'))
    try {
      const f = join(tmp, 'app.aihu')
      writeFileSync(
        f,
        '@template {\n  @if { open } {\n    <nav-bar />\n  }\n  <p>{count}</p>\n  <UserCard />\n}\n',
      )
      expect(readAihuLayoutComponents(f)).toEqual(['nav-bar', 'user-card'])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('returns [] for a layout referencing no components, and for missing @template/file', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aihu-layout-comps-empty-'))
    try {
      const plain = join(tmp, 'plain.aihu')
      writeFileSync(plain, '@template {\n  <div><header/><outlet /></div>\n}\n')
      expect(readAihuLayoutComponents(plain)).toEqual([])
      const noTemplate = join(tmp, 'meta-only.aihu')
      writeFileSync(noTemplate, '@meta {\n  name: "whatever"\n}\n')
      expect(readAihuLayoutComponents(noTemplate)).toEqual([])
      expect(readAihuLayoutComponents(join(tmp, 'nope.aihu'))).toEqual([])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('genL() — layout entries carry `components`', () => {
  it('emits a components array per layout entry', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aihu-genl-comps-'))
    try {
      writeFileSync(
        join(tmp, 'app.aihu'),
        '@template {\n  <some-widget />\n  <OtherThing />\n  <outlet />\n}\n',
      )
      writeFileSync(join(tmp, 'bare.aihu'), '@template {\n  <div><outlet /></div>\n}\n')
      const content = genL(tmp)
      expect(content).toContain('// AUTO-GENERATED')
      // Entry shape: { tag, load, components } — components normalized+sorted.
      expect(content).toMatch(
        /"app": \{ tag: "aihu-layout-app", load: \(\) => import\(".*app\.aihu"\), components: \["other-thing","some-widget"\] \}/,
      )
      // A layout referencing no components still carries an explicit [].
      expect(content).toMatch(
        /"bare": \{ tag: "aihu-layout-bare", load: \(\) => import\(".*bare\.aihu"\), components: \[\] \}/,
      )
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// RouteSidecar `components` plumbing — SK whitelist → genR route entries
// ---------------------------------------------------------------------------

describe('genR — route `components` from route metadata', () => {
  it('embeds components from a .route.json sidecar', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aihu-routes-components-'))
    const pagesTmp = join(tmp, 'pages')
    mkdirSync(pagesTmp)
    try {
      writeFileSync(join(pagesTmp, 'index.aihu'), '@template { <div>home</div> }\n')
      writeFileSync(
        join(pagesTmp, 'index.route.json'),
        JSON.stringify({ name: 'home-page', components: ['hn-comment'] }),
      )
      const plugin = viteRouterPlugin({ pagesDir: 'pages' })
      const mockServer = {
        config: { root: tmp },
        watcher: { add: () => {}, on: () => {} },
        moduleGraph: { getModuleById: () => undefined, invalidateModule: () => {} },
      }
      plugin.configureServer?.(mockServer as Parameters<typeof plugin.configureServer>[0])
      const content = plugin.load?.('\0virtual:aihu-routes') as string
      expect(content).toContain('components: ["hn-comment"]')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('embeds components via a compileRouteMeta stub when no sidecar', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aihu-routes-components-meta-'))
    const pagesTmp = join(tmp, 'pages')
    mkdirSync(pagesTmp)
    try {
      writeFileSync(join(pagesTmp, 'index.aihu'), '@template { <div>home</div> }\n')
      const compileRouteMeta = () => ({
        name: 'home-page',
        components: ['hn-comment', 'user-card'],
      })
      const plugin = viteRouterPlugin({ pagesDir: 'pages', compileRouteMeta })
      const mockServer = {
        config: { root: tmp },
        watcher: { add: () => {}, on: () => {} },
        moduleGraph: { getModuleById: () => undefined, invalidateModule: () => {} },
      }
      plugin.configureServer?.(mockServer as Parameters<typeof plugin.configureServer>[0])
      const content = plugin.load?.('\0virtual:aihu-routes') as string
      expect(content).toContain('components: ["hn-comment","user-card"]')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('RouteDefinition accepts an optional components field', () => {
    const route: RouteDefinition = {
      pattern: '/',
      segments: [],
      module: () => Promise.resolve({ default: {} }),
      components: ['hn-comment'],
    }
    expect(route.components).toEqual(['hn-comment'])
  })
})

describe('scanPages — generated type-check sidecars', () => {
  it('does not treat *.aihu.ts type sidecars as routes', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aihu-route-sidecar-'))
    const pages = join(tmp, 'pages')
    mkdirSync(pages)
    try {
      writeFileSync(join(pages, 'index.aihu'), '@template { <main>home</main> }\n')
      writeFileSync(join(pages, 'about.aihu.ts'), 'export type AboutPage = {}\n')
      writeFileSync(join(pages, 'about.ts'), 'export default function About() {}\n')
      expect(scanPages(tmp, 'pages').routes.map((path) => path.split('/').at(-1))).toEqual([
        'about.ts',
        'index.aihu',
      ])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// viteRouterPlugin resolveId/load hooks for virtual:aihu-components
// ---------------------------------------------------------------------------

describe('viteRouterPlugin — virtual:aihu-components hooks', () => {
  it('resolves virtual:aihu-components to internal ID', () => {
    const plugin = viteRouterPlugin()
    const resolved = plugin.resolveId?.('virtual:aihu-components')
    expect(resolved).toBe('\0virtual:aihu-components')
  })

  it('load returns the generated registry for virtual:aihu-components', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aihu-components-plugin-'))
    const componentsTmp = join(tmp, 'components')
    mkdirSync(componentsTmp)
    try {
      writeFileSync(join(componentsTmp, 'UserCard.aihu'), '@template { <div/> }\n')
      const plugin = viteRouterPlugin({ componentsDir: 'components' })
      const mockServer = {
        config: { root: tmp },
        watcher: { add: () => {}, on: () => {} },
        moduleGraph: { getModuleById: () => undefined, invalidateModule: () => {} },
      }
      plugin.configureServer?.(mockServer as Parameters<typeof plugin.configureServer>[0])
      const content = plugin.load?.('\0virtual:aihu-components') as string
      expect(typeof content).toBe('string')
      expect(content).toContain('export default')
      expect(content).toContain('"user-card": () => import(')
      expect(content).toContain('UserCard.aihu')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

// ─── genC() — codegen input validation ───────────────────────────────────────
//
// genC concatenates tag names and module paths into JavaScript SOURCE. Both are
// read off disk (tags from `@route { name }` or the file stem), so both
// are validated at the boundary rather than trusted to `JSON.stringify`. A tag
// that fails could never have registered as a custom element anyway — the
// compiler's C450 refuses to build one — so dropping it costs nothing.

describe('genC() — input validation', () => {
  it('drops a component whose tag is not a valid custom-element name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aihu-genc-'))
    try {
      // No hyphen → `customElements.define` would throw SyntaxError.
      writeFileSync(join(dir, 'widget.aihu'), '@template {\n  <p>x</p>\n}\n')
      writeFileSync(join(dir, 'user-card.aihu'), '@template {\n  <p>y</p>\n}\n')

      const out = genC(dir)
      expect(out).toContain('"user-card"')
      expect(out).not.toContain('"widget"')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('emits a registry that parses as JavaScript', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aihu-genc-'))
    try {
      writeFileSync(join(dir, 'user-card.aihu'), '@template {\n  <p>y</p>\n}\n')
      const out = genC(dir)
      // The load-bearing property: whatever went in, the output is valid source.
      expect(() => new Function(out.replace(/^export default/m, 'return'))).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
