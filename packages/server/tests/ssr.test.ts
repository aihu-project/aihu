import { describe, expect, it } from 'vitest'
import { _setContextFns, renderToString } from '../src/ssr.ts'

describe('@aihu/server ssr', () => {
  it('{ toHtml() } component renders its HTML directly', async () => {
    const component = { toHtml: () => '<p>Hello World</p>' }
    const result = await renderToString(component)
    expect(result).toBe('<p>Hello World</p>')
  })

  // Leaf fixtures mirror the real arbor shape (packages/arbor/src/leaf.ts):
  // a text leaf is { kind:'leaf', leafKind:'text', value } — content in `value`,
  // NOT `text`. The earlier fixtures used a `text` field arbor never emits, so
  // they passed while real leaves rendered empty (FEL-224).

  it('factory returning text leaf renders its value', async () => {
    const component = () => ({ kind: 'leaf', leafKind: 'text', value: 'Hello' })
    const result = await renderToString(component)
    expect(result).toBe('Hello')
  })

  it('factory returning branch renders wrapping tag with children', async () => {
    const component = () => ({
      kind: 'branch',
      tag: 'div',
      children: [{ kind: 'leaf', leafKind: 'text', value: 'X' }],
    })
    const result = await renderToString(component)
    expect(result).toBe('<div>X</div>')
  })

  it('text leaf HTML-escapes its value', async () => {
    const component = () => ({ kind: 'leaf', leafKind: 'text', value: '<b>&"q"' })
    const result = await renderToString(component)
    expect(result).toBe('&lt;b&gt;&amp;"q"')
  })

  it('text leaf with a Signal tuple value renders the current value', async () => {
    // A reactive leaf carries a [read, write] tuple (Array.isArray discriminant).
    const value: [() => string, (v: string) => void] = [() => 'live', () => {}]
    const component = () => ({ kind: 'leaf', leafKind: 'text', value })
    const result = await renderToString(component)
    expect(result).toBe('live')
  })

  it('element leaf renders a void tag with attrs', async () => {
    const component = () => ({
      kind: 'leaf',
      leafKind: 'element',
      tag: 'br',
      attrs: { class: 'x' },
    })
    const result = await renderToString(component)
    expect(result).toBe('<br class="x">')
  })

  it('serializes component-prop transport keys under their public names', async () => {
    const component = () => ({
      kind: 'branch',
      tag: 'x-child',
      attrs: { '__aihu_prop:title': [() => 'live', () => {}] },
      children: [],
    })

    const result = await renderToString(component, { hydratable: true })
    expect(result).toContain('<x-child title="live" data-aihu-path="0"></x-child>')
    expect(result).not.toContain('__aihu_prop:')
    expect(result).toContain('"0.prop:title":"live"')
  })

  it('with opts.head.title → output starts with <!DOCTYPE html> and contains <title>', async () => {
    const component = { toHtml: () => '<p>Content</p>' }
    const result = await renderToString(component, {
      head: { title: 'My Page' },
    })
    expect(result).toMatch(/^<!DOCTYPE html>/)
    expect(result).toContain('<title>My Page</title>')
    expect(result).toContain('<p>Content</p>')
  })

  it('with opts.serializer that returns data → injects __aihu_state__ script', async () => {
    const component = { toHtml: () => '<p>App</p>' }
    const serializer = () => ({ count: 42, user: 'alice' })
    const result = await renderToString(component, { head: {}, serializer })
    expect(result).toContain('<script type="application/json" id="__aihu_state__">')
    expect(result).toContain('"count":42')
    expect(result).toContain('"user":"alice"')
  })

  it('with opts.serializer that throws → no script injected, no error thrown', async () => {
    const component = { toHtml: () => '<p>App</p>' }
    const serializer = (): Record<string, unknown> => {
      throw new Error('not implemented')
    }
    const result = await renderToString(component, { head: {}, serializer })
    expect(result).not.toContain('__aihu_state__')
    expect(result).toContain('<p>App</p>')
  })

  it('branch with attrs renders attributes on element', async () => {
    const component = () => ({
      kind: 'branch',
      tag: 'a',
      attrs: { href: '/home', class: 'nav-link' },
      children: [{ kind: 'leaf', leafKind: 'text', value: 'Home' }],
    })
    const result = await renderToString(component)
    expect(result).toContain('href="/home"')
    expect(result).toContain('class="nav-link"')
    expect(result).toContain('>Home</a>')
  })

  it('opts.hydratable adds data-aihu-path attribute', async () => {
    const component = () => ({
      kind: 'branch',
      tag: 'div',
      children: [],
    })
    const result = await renderToString(component, { hydratable: true })
    expect(result).toContain('data-aihu-path=')
  })

  // Adjacent bare text leaves parse into ONE DOM Text node in the browser,
  // which misaligns the hydration walker's per-host text cursor (it claims one
  // node per text leaf — see packages/arbor/src/hydrate.ts). A `<!--|-->`
  // boundary comment keeps them as separate Text nodes; the walker skips it.
  it('hydratable: inserts a boundary comment between adjacent text leaves', async () => {
    const component = () => ({
      kind: 'branch',
      tag: 'div',
      children: [
        { kind: 'leaf', leafKind: 'text', value: 'a' },
        { kind: 'leaf', leafKind: 'text', value: 'b' },
      ],
    })
    const result = await renderToString(component, { hydratable: true })
    // The two leaves are separated, not coalesced into `ab`.
    expect(result).toContain('a<!--|-->b')
    expect(result).not.toContain('>ab<')
  })

  it('hydratable: `{a} {b}` (static space between) yields the marker layout arbor M2 expects', async () => {
    const component = () => ({
      kind: 'branch',
      tag: 'div',
      children: [
        { kind: 'leaf', leafKind: 'text', value: '1' },
        { kind: 'leaf', leafKind: 'text', value: ' ' },
        { kind: 'leaf', leafKind: 'text', value: '2' },
      ],
    })
    const result = await renderToString(component, { hydratable: true })
    expect(result).toContain('1<!--|--> <!--|-->2')
  })

  it('non-hydratable: no boundary comment (static SSR never hydrates)', async () => {
    const component = () => ({
      kind: 'branch',
      tag: 'div',
      children: [
        { kind: 'leaf', leafKind: 'text', value: 'a' },
        { kind: 'leaf', leafKind: 'text', value: 'b' },
      ],
    })
    const result = await renderToString(component)
    expect(result).toBe('<div>ab</div>')
    expect(result).not.toContain('<!--|-->')
  })

  it('hydratable: no boundary between a text leaf and an element leaf (element wraps in a tag)', async () => {
    const component = () => ({
      kind: 'branch',
      tag: 'div',
      children: [
        { kind: 'leaf', leafKind: 'text', value: 'a' },
        { kind: 'leaf', leafKind: 'element', tag: 'br' },
        { kind: 'leaf', leafKind: 'text', value: 'b' },
      ],
    })
    const result = await renderToString(component, { hydratable: true })
    expect(result).not.toContain('<!--|-->')
    expect(result).toContain('a<br>b')
  })

  it('head with meta tags renders meta elements', async () => {
    const component = { toHtml: () => '' }
    const result = await renderToString(component, {
      head: {
        title: 'Test',
        meta: [{ name: 'description', content: 'A test page' }],
      },
    })
    expect(result).toContain('<meta')
    expect(result).toContain('description')
  })
})

// ─── the contextSetup seam ───────────────────────────────────────────────────
//
// `SsrOptions.contextSetup` exists so a caller can pre-populate the context map
// a render walk reads — the case where NO component in the tree provides the
// value (the router's `RouteContext` during SSG, say). It did not work: the
// hook ran first and a fresh empty map was activated second, discarding
// whatever the caller had activated. Nothing in the repo called the hook, so
// nothing noticed.
//
// These tests use a hand-rolled activate/clear pair rather than importing
// `@aihu/context`. That keeps ssr.ts's hard boundary intact in the dependency
// graph AND is the more precise test: what's under test is the ORDER ssr.ts
// calls the seam in, not @aihu/context's map lookup.

describe('@aihu/server ssr — contextSetup', () => {
  const TOKEN = Symbol('test.token')

  /** Mirrors @aihu/context's module-global active-map semantics. */
  function makeContextFns(): {
    activate: (m: Map<symbol, unknown>) => void
    clear: () => void
    read: () => unknown
  } {
    let active: Map<symbol, unknown> | null = null
    return {
      activate: (m) => {
        active = m
      },
      clear: () => {
        active = null
      },
      read: () => active?.get(TOKEN),
    }
  }

  it('keeps a map the caller activates alive for the render walk', async () => {
    const fns = makeContextFns()
    _setContextFns(fns.activate, fns.clear)

    const component = (): unknown => ({
      kind: 'leaf',
      leafKind: 'text',
      value: String(fns.read() ?? 'MISSING'),
    })

    const html = await renderToString(component, {
      contextSetup: (activate) => activate(new Map([[TOKEN, 'PROVIDED']])),
    })
    expect(html).toBe('PROVIDED')
  })

  it('still hands a fresh empty map to a caller that pre-populates nothing', async () => {
    const fns = makeContextFns()
    _setContextFns(fns.activate, fns.clear)
    // Leak a value from a "previous request" — the fresh map must shadow it.
    fns.activate(new Map([[TOKEN, 'STALE']]))

    const component = (): unknown => ({
      kind: 'leaf',
      leafKind: 'text',
      value: String(fns.read() ?? 'EMPTY'),
    })

    const html = await renderToString(component, { contextSetup: () => {} })
    expect(html).toBe('EMPTY')
  })

  it('clears the active map after the walk', async () => {
    const fns = makeContextFns()
    _setContextFns(fns.activate, fns.clear)

    await renderToString(() => ({ kind: 'leaf', leafKind: 'text', value: 'x' }), {
      contextSetup: (activate) => activate(new Map([[TOKEN, 'PROVIDED']])),
    })
    expect(fns.read()).toBeUndefined()
  })
})

// ─── §12 / §13 — escaping and validation at the serialization boundary ───────
//
// Two holes with the same shape: a field that reaches HTML without passing
// through an escaper. `buildHead` emitted `<title>` and every meta/link
// attribute NAME verbatim; `serializeAttrs` escaped attribute VALUES from the
// start but never KEYS. SSG missed both — `@aihu/app`'s `applyHeadToHtml` is a
// parallel implementation that escapes, and authored templates go through the
// parser — but `renderToString(component, { head })` is documented public API
// and a hostile or runtime-computed attribute key reaches serialization by
// routes the parser never sees.

describe('@aihu/server ssr — head escaping (§12)', () => {
  const empty = { toHtml: () => '' }

  it('escapes a title that would otherwise close its own element', async () => {
    // `<title>` is RCDATA: the only thing that ends it is `</title`, and what
    // follows is parsed as ordinary markup.
    const html = await renderToString(empty, {
      head: { title: '</title><script>alert(1)</script>' },
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;/title&gt;&lt;script&gt;')
  })

  it('escapes & in a title, so entities survive as text', async () => {
    const html = await renderToString(empty, { head: { title: 'Tom & Jerry' } })
    expect(html).toContain('<title>Tom &amp; Jerry</title>')
  })

  it('drops a meta attribute NAME that would split into a second attribute', async () => {
    const html = await renderToString(empty, {
      head: { meta: [{ 'content" onload="alert(1)': 'x', name: 'ok' } as never] },
    })
    expect(html).not.toContain('onload')
    // The well-formed sibling still serializes — this drops a key, not the tag.
    expect(html).toContain('name="ok"')
  })

  it('drops a link attribute NAME with whitespace in it', async () => {
    const html = await renderToString(empty, {
      head: { links: [{ 'rel x': 'stylesheet', href: '/a.css' } as never] },
    })
    expect(html).not.toContain('rel x')
    expect(html).toContain('href="/a.css"')
  })

  it('leaves a legitimate hyphenated/colon name alone', async () => {
    // The alphabet is NARROW on purpose: `http-equiv` and `xml:lang` round-trip
    // through a parser unchanged, so rejecting them would fail real pages.
    const html = await renderToString(empty, {
      head: { meta: [{ 'http-equiv': 'refresh', 'xml:lang': 'en' } as never] },
    })
    expect(html).toContain('http-equiv="refresh"')
    expect(html).toContain('xml:lang="en"')
  })
})

describe('@aihu/server ssr — attribute-name validation (§13, serialization layer)', () => {
  /** A hand-built arbor element leaf — the route the parser does not cover. */
  const leafWith = (attrs: Record<string, unknown>) => () => ({
    kind: 'leaf' as const,
    leafKind: 'element' as const,
    tag: 'span',
    attrs,
  })

  it('drops the `data-x/onload` injection', async () => {
    // In a real browser `<span data-x/onload="alert(1)">` is TWO attributes,
    // the second an event handler — the shape §13 reports.
    const html = await renderToString(leafWith({ 'data-x/onload': 'alert(1)' }))
    expect(html).toBe('<span></span>')
  })

  it('drops a key with a space, a quote, or an equals sign', async () => {
    for (const k of ['a b', 'a"b', "a'b", 'a=b', 'a<b', 'a`b', 'a>b']) {
      expect(await renderToString(leafWith({ [k]: 'v' }))).toBe('<span></span>')
    }
  })

  it('drops a BOOLEAN attribute with an invalid key too', async () => {
    // ` k` (no value) is the other serialization shape, and it was the one that
    // needed no quoting — so it was the easier one to forget.
    expect(await renderToString(leafWith({ 'a/onload': true }))).toBe('<span></span>')
  })

  it('drops the empty key', async () => {
    expect(await renderToString(leafWith({ '': 'v' }))).toBe('<span></span>')
  })

  it('keeps every key a browser reads back unchanged', async () => {
    const html = await renderToString(
      leafWith({ 'data-x': '1', 'xml:lang': 'en', 'aria-label': 'a', $odd: 'y' }),
    )
    expect(html).toBe('<span data-x="1" xml:lang="en" aria-label="a" $odd="y"></span>')
  })

  it('drops only the bad key, keeping its well-formed siblings', async () => {
    const html = await renderToString(leafWith({ id: 'a', 'b c': 'x', class: 'z' }))
    expect(html).toBe('<span id="a" class="z"></span>')
  })
})
