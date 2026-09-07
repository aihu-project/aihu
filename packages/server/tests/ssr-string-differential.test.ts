// @vitest-environment node
/**
 * Wave-3 keystone — the SSR string fast path's DIFFERENTIAL GATE.
 *
 * The compiled `__ssrString` renderer's whole contract is byte-identity with
 * the tree walker: for the same component+state, `__ssrString(props, opts)`
 * must produce EXACTLY the bytes `renderToString`'s walk over `__ssr(props)`
 * produces — every `data-aihu-path`, every `<!--aihu:s:…-->` structural
 * marker, every `<!--|-->` text-leaf boundary, every escaped byte. These
 * tests run a representative component set through BOTH renderers (the
 * walker via a plain wrapper that hides the fast path; the string fn
 * directly) and assert `toBe` on the full output, hydratable and plain.
 *
 * Real pipeline throughout: Rust compiler binary → server artifact written
 * to scratch → dynamic import in a DOM-less node environment. Mirrors
 * tests/integration/server-emission-ssr.test.ts.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from '@aihu/compiler'
import { afterAll, describe, expect, it } from 'vitest'
import { renderToStream, renderToString } from '../src/ssr.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../../..')

const hasBinary = ['target/release/aihu-compile', 'target/debug/aihu-compile'].some((p) =>
  existsSync(join(repoRoot, p)),
)

const SCRATCH = join(__dirname, '.scratch-ssr-string')

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true })
})

function withResolvedImports(code: string): string {
  return code
    .replaceAll("'@aihu/runtime/ssr'", `'${repoRoot}/packages/runtime/src/ssr-string.ts'`)
    .replaceAll("'@aihu/runtime'", `'${repoRoot}/packages/runtime/src/index.ts'`)
    .replaceAll("'@aihu/router'", `'${repoRoot}/packages/router/src/index.ts'`)
}

interface CompiledModule {
  __ssr: (props?: Record<string, unknown>) => unknown
  __ssrString?: (props?: Record<string, unknown>, opts?: { hydratable?: boolean }) => string
  default: (props?: Record<string, unknown>) => unknown
}

let seq = 0
async function compileToModule(
  name: string,
  source: string,
): Promise<{ mod: CompiledModule; code: string }> {
  const { code } = transform(source, `src/pages/${name}.aihu`, { target: 'server' })
  mkdirSync(SCRATCH, { recursive: true })
  const file = join(SCRATCH, `${name}.${seq++}.ts`)
  writeFileSync(file, withResolvedImports(code))
  const mod = (await import(/* @vite-ignore */ file)) as unknown as CompiledModule
  return { mod, code }
}

/**
 * Wave-3 integration seam. The `__aihu_state__` script is post-render CHANNEL
 * data appended by `renderToStream`'s emission site — NOT part of either
 * renderer's MARKUP. The walker path harvests component-local signals via its
 * post-render arbor tree walk (`_collectSignals`); the compiled string path
 * builds no arbor tree, so it emits an EMPTY signals map (stores still ride
 * along, arbor-independent). The two paths therefore legitimately diverge on
 * the signals channel while their MARKUP stays byte-identical. This gate pins
 * the MARKUP (the string renderer's actual contract, per this file's
 * docblock); the state channel is covered by the parity + state-channel
 * suites. See the seam commentary in packages/server/src/ssr.ts.
 */
const STATE_SCRIPT = /<script type="application\/json" id="__aihu_state__">.*?<\/script>$/s
function markup(html: string): string {
  return html.replace(STATE_SCRIPT, '')
}

/**
 * The differential assertion: walker MARKUP (a bare wrapper so the fast path
 * cannot engage) vs compiled-string bytes, both hydration modes, PLUS the
 * public entry (`renderToString(mod.default)` — fast path engaged) against
 * the same markup. The walker's post-render signals channel is stripped
 * before comparison (see `markup`): the string renderer emits markup only,
 * and byte-identity is a claim about the markup.
 */
async function expectByteIdentity(mod: CompiledModule, props?: Record<string, unknown>) {
  expect(typeof mod.__ssrString).toBe('function')
  for (const hydratable of [true, false]) {
    const walker = await renderToString(() => mod.__ssr(props), { hydratable })
    const fast = mod.__ssrString!(props ?? {}, { hydratable })
    expect(fast).toBe(markup(walker))
    if (props === undefined) {
      const publicPath = await renderToString(mod.default, { hydratable })
      expect(markup(publicPath)).toBe(markup(walker))
    }
  }
}

describe.skipIf(!hasBinary)('SSR string fast path — differential byte-identity', () => {
  it('precondition: DOM-less environment', () => {
    expect(typeof HTMLElement).toBe('undefined')
  })

  it('static-only component (folds to pure literals)', async () => {
    const { mod, code } = await compileToModule(
      'diff-static',
      `@template {
  <main class="page" data-kind="static">
    <h1>Title &amp; more</h1>
    <img src="/x.png" alt="a&quot;b">
    <br>
    <p>1 &lt; 2 &gt; 0</p>
  </main>
}
`,
    )
    expect(code).toContain('export const __ssrString')
    await expectByteIdentity(mod)
    // Sanity on the folded shape: the walker closes every branch tag
    // (leaf.element voids are not emitted by the compiler).
    const html = mod.__ssrString!({}, { hydratable: true })
    expect(html).toContain('data-aihu-path="0"')
    expect(html).toContain('Title &amp; more')
  })

  it('interpolations: signals, getter calls, eager projections, escaping', async () => {
    const { mod } = await compileToModule(
      'diff-interp',
      `@state {
  const [count, setCount] = signal(3)
  const [name, setName] = signal('a<b&"c')
  const label = () => 'L' + count()
  const plain = 'static <text>'
}

@template {
  <div>
    <h1>Hello {name} you have {count} items</h1>
    <p>{label()} and {count() * 2} and {plain}</p>
    <span>{count() > 2 ? 'many' : 'few'}</span>
  </div>
}
`,
    )
    await expectByteIdentity(mod)
    const html = mod.__ssrString!({}, { hydratable: true })
    expect(html).toContain('a&lt;b&amp;"c')
    expect(html).toContain('<!--|-->')
  })

  it('reactive + static + computed-expression attributes, class array form, bind/on', async () => {
    const { mod } = await compileToModule(
      'diff-attrs',
      `@state {
  const [cls, setCls] = signal('on')
  const [count, setCount] = signal(1)
  const [text, setText] = signal('t')
  const inc = () => setCount(count() + 1)
}

@template {
  <section data-x="a&b">
    <p class={cls} title={count() > 0 ? 'pos"itive' : 'neg'}>x</p>
    <p class={['base', count() > 0 && 'pos']}>y</p>
    <input bind:value={text}>
    <button onclick={inc} on:click.prevent={inc}>go</button>
  </section>
}
`,
    )
    await expectByteIdentity(mod)
    const html = mod.__ssrString!({}, { hydratable: false })
    // Reactive attrs resolve to VALUES (the serializeAttrs fix) — never
    // function source; event handlers never serialize.
    expect(html).toContain('class="on"')
    expect(html).toContain('title="pos&quot;itive"')
    expect(html).toContain('class="base pos"')
    expect(html).toContain('value="t"')
    expect(html).not.toContain('=>')
  })

  it('if / elseif / else chains and lone-if attribute form', async () => {
    const { mod } = await compileToModule(
      'diff-if',
      `@state {
  const [n, setN] = signal(1)
}

@template {
  <div>
    <p if={n() === 0}>zero</p>
    <p elseif={n() === 1}>one</p>
    <p else>many</p>
    <span if={n() > 0}>lone-if body</span>
  </div>
}
`,
    )
    await expectByteIdentity(mod)
    const html = mod.__ssrString!({}, { hydratable: true })
    // All three chain branches carry markers even when inactive.
    expect(html).toContain('<!--aihu:s:0.0.0-->')
    expect(html).toContain('<!--aihu:s:0.0.1-->')
    expect(html).toContain('<!--aihu:s:0.0.2-->')
  })

  it('each: keyed, unkeyed, nested, group-each fragments, empty arm, path-hostile keys', async () => {
    const { mod } = await compileToModule(
      'diff-each',
      `@state {
  const [rows, setRows] = signal([
    { id: 'a.dot', label: 'A' },
    { id: 'b-dash', label: 'B<' },
  ])
  const none = []
  const groups = [['g1', ['x', 'y']], ['g2', []]]
}

@template {
  <div>
    <ul>
      <li each={r of rows()} key={r.id} data-k={r.id}>{r.label}</li>
    </ul>
    <group each={g of groups}>
      <h2>{g[0]}</h2>
      <ol>
        <li each={c of g[1]}>{c}</li>
      </ol>
    </group>
    <p each={x of none}>{x}</p>
    <p empty>nothing here</p>
  </div>
}
`,
    )
    await expectByteIdentity(mod)
    const html = mod.__ssrString!({}, { hydratable: true })
    // Dots in keys fold to `_` in paths; dashes fold to `_` in comment
    // markers but stay verbatim in the path attribute.
    expect(html).toContain('.list.a_dot')
    expect(html).toContain('data-aihu-path="0.0.0.list.b-dash"')
    expect(html).toContain('nothing here')
  })

  it('structural churn: same template, different state shapes, still identical', async () => {
    const src = (init: string) => `@state {
  const [items, setItems] = signal(${init})
  const [open, setOpen] = signal(${init.length % 2 === 0 ? 'true' : 'false'})
}

@template {
  <div>
    <details if={open()}>
      <p each={it, i of items()} key={i}>{it}</p>
    </details>
    <span else>closed</span>
  </div>
}
`
    for (const init of ["['a']", "['a','b','c']", '[]']) {
      const { mod } = await compileToModule('diff-churn', src(init))
      await expectByteIdentity(mod)
    }
  })

  it('mount-time effect directives (class:/show/ref) are SSR-transparent, not crashes', async () => {
    const { mod } = await compileToModule(
      'diff-effects',
      `@state {
  const [on, setOn] = signal(true)
  let el = null
}

@template {
  <div>
    <button class:active={on()} show={on()} ref={el}>go</button>
  </div>
}
`,
    )
    // Pre-slice, the un-guarded onMount registration threw SCR-R0010
    // ('no owner') on every host-less render of these directives.
    await expectByteIdentity(mod)
    const html = mod.__ssrString!({}, { hydratable: true })
    expect(html).toContain('<button')
  })

  it('enhanced <a> (internal), opted-out <a> (external), dynamic href', async () => {
    const { mod } = await compileToModule(
      'diff-anchor',
      `@state {
  const [slug, setSlug] = signal('post-1')
}

@template {
  <nav>
    <a href="/about" class="lnk">About</a>
    <a href={'/blog/' + slug()}>Post</a>
    <a href="https://ext.example" target="_blank">Ext</a>
  </nav>
}
`,
    )
    await expectByteIdentity(mod)
    const html = mod.__ssrString!({}, { hydratable: false })
    expect(html).toContain('href="/about"')
    expect(html).toContain('data-aihu-link=""')
    expect(html).toContain('href="/blog/post-1"')
    // The external anchor renders plain — no SPA enhancement bytes.
    expect(html).toContain('<a href="https://ext.example" target="_blank">Ext</a>')
  })

  it('options-form ($prop) artifact threads props through both renderers', async () => {
    const { mod, code } = await compileToModule(
      'diff-props',
      `@state {
  $prop: {
    route: {
      type: { params: { slug: string }; data: { title: string } },
    },
  }
}

@template {
  <article>
    <h1>{route.data.title}</h1>
    <p>{route.params.slug}</p>
  </article>
}
`,
    )
    expect(code).toContain('export const __ssrString')
    const props = { route: { params: { slug: 's-1' }, data: { title: 'T&T' } } }
    await expectByteIdentity(mod, props)
    const html = mod.__ssrString!(props, { hydratable: true })
    expect(html).toContain('T&amp;T')
    expect(html).toContain('s-1')
  })

  it('AIHU_SSR_STRING=0 escape hatch routes the public entry back to the walker', async () => {
    const { mod } = await compileToModule(
      'diff-hatch',
      `@state {
  const [n, setN] = signal(7)
}

@template {
  <p>{n}</p>
}
`,
    )
    const before = process.env.AIHU_SSR_STRING
    try {
      process.env.AIHU_SSR_STRING = '0'
      const viaWalker = await renderToString(mod.default, { hydratable: true })
      delete process.env.AIHU_SSR_STRING
      const viaFast = await renderToString(mod.default, { hydratable: true })
      // Same MARKUP — the hatch changes the engine, never the markup.
      expect(markup(viaWalker)).toBe(markup(viaFast))
      expect(markup(viaFast)).toBe(mod.__ssrString!({}, { hydratable: true }))
      // The wave-3 seam, made observable: this component's `{n}` is a
      // component-local signal. The walker engine harvests it into an
      // `__aihu_state__` signals channel via its post-render tree walk; the
      // string engine builds no tree and (with no store serializer here)
      // emits no state script at all. The hatch thus changes the signals
      // channel even though the markup is identical — the documented v1
      // limitation of string-path rendering.
      expect(viaWalker).toContain('id="__aihu_state__"')
      expect(viaWalker).toContain('"0.0.text":7')
      expect(viaFast).not.toContain('__aihu_state__')
    } finally {
      if (before === undefined) delete process.env.AIHU_SSR_STRING
      else process.env.AIHU_SSR_STRING = before
    }
  })

  it('unsupported constructs bail: no __ssrString export, walker unaffected', async () => {
    const { mod, code } = await compileToModule(
      'diff-bail',
      `@state {
  const src = { status: 'ready', value: 1, onReady: () => () => {} }
}

@template {
  <div>
    <suspense source={src}>
      <p>loaded</p>
    </suspense>
  </div>
}
`,
    )
    expect(code).not.toContain('__ssrString')
    expect(mod.__ssrString).toBeUndefined()
    // The walker remains the renderer of record for bailed templates. (The
    // suspense boundary's SSR stub renders its fallback slot — empty here —
    // so the observable walker output is the bare wrapper.)
    const html = await renderToString(mod.default, { hydratable: true })
    expect(html).toBe('<div data-aihu-path="0"></div>')
  })

  it('lightScopeId stamps data-a on the root — byte-identical across both renderers', async () => {
    // LDF §10 step 3: `root_scope_attr` (string emit) reads
    // `__opts.lightScopeId`; the walker reads `SsrOptions.lightScopeId`. Both
    // stamp the ROOT element only, between the static attrs and the path
    // marker — this pins the placement AND the parity, in both hydration
    // modes, plus the unstamped default staying unstamped.
    const { mod } = await compileToModule(
      'diff-light-scope',
      `@template {
  <section class="card">
    <h2>Scoped</h2>
  </section>
}
`,
    )
    const ssrString = mod.__ssrString as (
      props?: Record<string, unknown>,
      opts?: { hydratable?: boolean; lightScopeId?: string },
    ) => string
    for (const hydratable of [true, false]) {
      const walker = await renderToString(() => mod.__ssr(), {
        hydratable,
        lightScopeId: 'deadbee1',
      })
      const fast = ssrString({}, { hydratable, lightScopeId: 'deadbee1' })
      expect(fast).toBe(markup(walker))
      expect(fast).toContain(' data-a="deadbee1"')
      // Root only.
      expect(fast.match(/ data-a="/g)).toHaveLength(1)
    }
    // Placement: static attrs, then data-a, then the path marker.
    expect(ssrString({}, { hydratable: true, lightScopeId: 'deadbee1' })).toContain(
      '<section class="card" data-a="deadbee1" data-aihu-path="0">',
    )
    // Undefined stays unstamped on both paths.
    expect(ssrString({}, { hydratable: true })).not.toContain('data-a=')
    expect(await renderToString(() => mod.__ssr(), { hydratable: true })).not.toContain('data-a=')
  })

  it('dataSource trees (hand-built) never carry a string renderer; streaming intact', async () => {
    // Compiled templates cannot produce dataSource branches — this shape only
    // exists for hand-built trees, which have no __ssrString by construction.
    const readySource = {
      status: 'ready' as const,
      value: 42,
      onReady: (_cb: () => void) => () => {},
    }
    const component = () => ({
      kind: 'branch',
      tag: 'div',
      attrs: { id: 'ds' },
      children: [{ kind: 'leaf', leafKind: 'text', value: 'data', tag: null, attrs: null }],
      dataSource: readySource,
    })
    const stream = renderToStream(component)
    const reader = stream.getReader()
    const chunks: string[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    expect(chunks.join('')).toBe('<div id="ds">data</div>')
  })
})

// ─── Child component resolution (SSR children step 3d) ──────────────────────
//
// The gate that made the whole design worth its cost. A resolved child must
// come out byte-identical from BOTH renderers, because both call the same
// `__aihu_schild`. The rejected alternative — implementing resolution only in
// the walker and declining the fast path whenever a registry was supplied —
// would have forced this suite's contract to be WEAKENED to "identical unless
// a registry is present". Here it is instead strengthened: identity now covers
// resolved child subtrees, in both shadow modes, at depth.

/** Byte-identity with a child registry threaded into both renderers. */
async function expectByteIdentityWithChildren(
  mod: CompiledModule,
  children: ReadonlyMap<string, unknown>,
) {
  expect(typeof mod.__ssrString).toBe('function')
  for (const hydratable of [true, false]) {
    const opts = { hydratable, children } as Parameters<typeof renderToString>[1]
    const walker = await renderToString(() => mod.__ssr(), opts)
    const fast = (mod.__ssrString as (p: unknown, o?: unknown) => string)(
      {},
      { hydratable, children },
    )
    expect(fast).toBe(markup(walker))
  }
}

describe.skipIf(!hasBinary)('SSR string fast path — resolved child components', () => {
  const PARENT = `@template {
  <main class="page"><h1>Title</h1><x-kid></x-kid></main>
}
`
  const CHILD = `@template {
  <nav class="kid"><span>nav</span></nav>
}
`

  it('a light-DOM child renders identically on both paths', async () => {
    const parent = await compileToModule('diff-parent-light', PARENT)
    const kid = await compileToModule('diff-kid-light', CHILD)
    const children = new Map([
      ['x-kid', { ...kid.mod, __aihu_shadow__: 'light', __aihu_light_scope__: 'k1' }],
    ])
    await expectByteIdentityWithChildren(parent.mod, children)

    // …and it is actually FILLED IN, not just consistently empty. Two renderers
    // agreeing on nothing would satisfy byte-identity while shipping the very
    // bug this work exists to fix.
    const html = (parent.mod.__ssrString as (p: unknown, o?: unknown) => string)(
      {},
      { hydratable: true, children },
    )
    expect(html).toContain('<nav class="kid"')
    expect(html).toContain('data-a="k1"')
    expect(html).toContain('data-aihu-ssr=""')
  })

  it('a shadow-DOM child renders identically on both paths', async () => {
    const parent = await compileToModule('diff-parent-shadow', PARENT)
    const kid = await compileToModule('diff-kid-shadow', CHILD)
    const children = new Map([['x-kid', { ...kid.mod, __aihu_shadow__: 'shadow' }]])
    await expectByteIdentityWithChildren(parent.mod, children)

    const html = (parent.mod.__ssrString as (p: unknown, o?: unknown) => string)(
      {},
      { hydratable: true, children },
    )
    expect(html).toContain('<template shadowrootmode="open">')
    expect(html).toContain('<nav class="kid"')
  })

  it('a grandchild resolves through the child, identically on both paths', async () => {
    const parent = await compileToModule('diff-parent-deep', PARENT)
    const kid = await compileToModule(
      'diff-kid-deep',
      `@template {
  <nav class="kid"><x-grandkid></x-grandkid></nav>
}
`,
    )
    const grandkid = await compileToModule(
      'diff-grandkid',
      `@template {
  <b class="gk">deep</b>
}
`,
    )
    const children = new Map<string, unknown>([
      ['x-kid', { ...kid.mod, __aihu_shadow__: 'light' }],
      ['x-grandkid', { ...grandkid.mod, __aihu_shadow__: 'light' }],
    ])
    await expectByteIdentityWithChildren(parent.mod, children)

    const html = (parent.mod.__ssrString as (p: unknown, o?: unknown) => string)(
      {},
      { hydratable: true, children },
    )
    expect(html).toContain('<b class="gk" data-aihu-path="0">deep</b>')
    // Each nested host restarts its own path space at ROOT_PATH behind its own
    // `data-aihu-ssr` boundary — which is what makes the paths non-colliding
    // and is exactly what arbor's hydrate() expects of a nested marked host.
    expect(html).toContain('<x-grandkid data-aihu-path="0.0" data-aihu-ssr="">')
  })

  it('an unresolved tag stays an empty element on both paths', async () => {
    const parent = await compileToModule('diff-parent-unresolved', PARENT)
    // A registry that does not know this tag — the common case for any
    // third-party custom element on the page.
    const children = new Map<string, unknown>([['x-other', {}]])
    await expectByteIdentityWithChildren(parent.mod, children)

    const html = (parent.mod.__ssrString as (p: unknown, o?: unknown) => string)(
      {},
      { hydratable: true, children },
    )
    expect(html).toContain('<x-kid')
    expect(html).not.toContain('<nav class="kid"')
  })

  it('a shadow child carries its own compiled CSS into the template (step 4)', async () => {
    // The end-to-end join: the compiler exports __aihu_css__, and the helper
    // inlines it inside the declarative template. Asserted through the REAL
    // pipeline rather than a hand-built module, because the failure mode is the
    // two halves not meeting — an export nothing reads, or a reader with
    // nothing to read.
    const parent = await compileToModule('diff-parent-css', PARENT)
    const kid = await compileToModule(
      'diff-kid-css',
      `@template {
  <nav class="kid"><span>nav</span></nav>
}

@style {
  .kid { color: red; }
}
`,
    )
    expect((kid.mod as unknown as { __aihu_css__?: string }).__aihu_css__).toContain('color: red')

    const children = new Map([['x-kid', { ...kid.mod, __aihu_shadow__: 'shadow' }]])
    await expectByteIdentityWithChildren(parent.mod, children)

    const html = (parent.mod.__ssrString as (p: unknown, o?: unknown) => string)(
      {},
      { hydratable: true, children },
    )
    // Styles INSIDE the template and ahead of the content — without that, the
    // prerendered subtree paints unstyled until the chunk loads (#754).
    expect(html).toContain('<template shadowrootmode="open"><style>.kid { color: red; }</style>')
  })

  it('a reference inside {#each} DECLINES on both paths', async () => {
    // The v1 boundary that drifted. The emitter declines a runtime-built path;
    // the walker had no mirror, so this resolved on one renderer and stayed an
    // empty element on the other — a byte divergence with a registry present.
    //
    // The assertion that matters is that the two paths AGREE ON DECLINING.
    // Every boundary needs one of these: the eligibility rule is written twice,
    // in Rust and in TypeScript, and only their intersection was covered.
    const parent = await compileToModule(
      'diff-parent-each',
      `@state {
  const items = ['a', 'b']
}

@template {
  <ul><li each={x of items}><x-kid></x-kid></li></ul>
}
`,
    )
    const kid = await compileToModule('diff-kid-each', CHILD)
    const children = new Map([
      ['x-kid', { ...kid.mod, __aihu_shadow__: 'light', __aihu_light_scope__: 'k1' }],
    ])
    await expectByteIdentityWithChildren(parent.mod, children)

    const html = (parent.mod.__ssrString as (p: unknown, o?: unknown) => string)(
      {},
      { hydratable: true, children },
    )
    expect(html).toContain('<x-kid')
    expect(html).not.toContain('<nav class="kid"')
  })

  it('stamps data-a exactly once for a resolved light child', async () => {
    // The `lightScopeId: \'\'` sentinel is a contract with the Rust emitter, and
    // byte-identity alone cannot defend it: both renderers call the same
    // helper, so a double stamp changes both identically and stays "identical".
    // Counting is what catches it — and this exact bug already shipped once,
    // double-stamping <site-header> on aihu.dev.
    const parent = await compileToModule('diff-parent-count', PARENT)
    const kid = await compileToModule('diff-kid-count', CHILD)
    const children = new Map([
      ['x-kid', { ...kid.mod, __aihu_shadow__: 'light', __aihu_light_scope__: 'k1' }],
    ])
    const html = (parent.mod.__ssrString as (p: unknown, o?: unknown) => string)(
      {},
      { hydratable: true, children },
    )
    expect(html.match(/data-a=/g)?.length).toBe(1)
  })

  it('no registry at all is byte-identical to the pre-resolution renderer', async () => {
    // The safety property that lets 3a/3b/3c ship ahead of the callers that
    // populate the registry: every existing site renders exactly as before.
    const parent = await compileToModule('diff-parent-noreg', PARENT)
    await expectByteIdentity(parent.mod)
    const html = (parent.mod.__ssrString as (p: unknown, o?: unknown) => string)(
      {},
      { hydratable: true },
    )
    expect(html).toContain('<x-kid data-aihu-path="0.1"></x-kid>')
  })
})

// ─── Child eligibility — one fixture per BOUNDARY LINE ──────────────────────
//
// Why these exist, in one sentence: the eligibility rule is written twice — in
// Rust against the raw template AST (`ssr_string_emit.rs`) and in TypeScript
// against the LOWERED arbor node (`renderNodeAsync`'s child arm) — and the two
// gates read different inputs, so they can only be kept equal by being tested
// equal.
//
// They cannot be made structurally identical, and it is worth being blunt about
// why rather than hoping a future refactor closes it: the lowering is LOSSY.
// `show=`, `class:`, `ref=`, `once`, `raw`, `html=`, `if=` and a whitespace-only
// body are all gone by the time the walker sees a node — `<x-kid show={on()}>`
// and `<x-kid>\n</x-kid>` both arrive as `branch('x-kid', undefined, [])`,
// indistinguishable from a bare `<x-kid>`. The walker therefore CANNOT decline
// on them; the emitter is the side that has to agree, and the only thing that
// can prove it does is a differential fixture.
//
// The suite above varies only the CHILD, against a single parent shape (one
// line, no whitespace, no attrs, no directives, static non-root path). Every
// divergence found in the 2026-08-06 review round lived in the parent shape,
// which is exactly why they drifted unseen. These vary the PARENT.
//
// Each case asserts the two renderers reach the same VERDICT — and asserts what
// the verdict is, because "both empty" satisfies byte-identity while shipping
// the bug this whole design exists to remove.

const KID = `@template {
  <nav class="kid"><span>nav</span></nav>
}
`

/** The child's markup, present iff a renderer actually resolved the reference. */
const KID_MARK = '<nav class="kid"'

let boundarySeq = 0

/**
 * Compile `template` as a parent, render it through BOTH renderers with the
 * given registry, assert byte-identity in both hydration modes, and assert the
 * agreed verdict is the expected one.
 *
 * The `@state` preamble is shared so a case is one line of template.
 */
async function expectAgreedVerdict(
  template: string,
  verdict: 'resolves' | 'declines',
  registry?: ReadonlyMap<string, unknown>,
): Promise<string> {
  const kid = await compileToModule(`bkid-${boundarySeq}`, KID)
  const children =
    registry ??
    new Map<string, unknown>([
      ['x-kid', { ...kid.mod, __aihu_shadow__: 'light', __aihu_light_scope__: 'k1' }],
    ])
  const { mod } = await compileToModule(
    `bparent-${boundarySeq++}`,
    `@state {
  const [on, setOn] = signal(true)
  const [txt, setTxt] = signal('t')
  let el = null
  const frag = '<i>hi</i>'
  const items = ['a']
  const bump = () => setOn(!on())
}

@template {
  ${template}
}
`,
  )
  expect(typeof mod.__ssrString).toBe('function')
  const ssrString = mod.__ssrString as (p: unknown, o?: unknown) => string
  let hydratableHtml = ''
  for (const hydratable of [true, false]) {
    const opts = { hydratable, children } as Parameters<typeof renderToString>[1]
    const walker = markup(await renderToString(() => mod.__ssr(), opts))
    const fast = ssrString({}, { hydratable, children })
    expect(fast).toBe(walker)
    if (hydratable) hydratableHtml = fast
  }
  // Direction, not just agreement.
  if (verdict === 'resolves') expect(hydratableHtml).toContain(KID_MARK)
  else expect(hydratableHtml).not.toContain(KID_MARK)
  return hydratableHtml
}

/**
 * Compile the same parent shape `expectAgreedVerdict` uses, plus the kid and
 * its registry, without rendering — for the cases that need render options
 * (`lightScopeId`, `wrapTag`) that the verdict helper deliberately does not take.
 */
async function compileParentWithKid(template: string): Promise<{
  mod: CompiledModule
  children: ReadonlyMap<string, unknown>
}> {
  const kid = await compileToModule(`skid-${boundarySeq}`, KID)
  const children = new Map<string, unknown>([
    ['x-kid', { ...kid.mod, __aihu_shadow__: 'light', __aihu_light_scope__: 'k1' }],
  ])
  const { mod } = await compileToModule(
    `sparent-${boundarySeq++}`,
    `@state {
  const [on, setOn] = signal(true)
  const items = ['a']
}

@template {
  ${template}
}
`,
  )
  return { mod, children }
}

/**
 * Render `template` through BOTH renderers with a light scope id set and NO
 * `wrapTag`, i.e. the one caller shape in which the template-root stamp is the
 * only stamp there is.
 */
async function renderBothWithScope(
  template: string,
  opts?: { scope?: string },
): Promise<{ fast: string; walker: string }> {
  const { mod, children } = await compileParentWithKid(template)
  const lightScopeId = opts?.scope ?? 'PARENTSCOPE'
  expect(typeof mod.__ssrString).toBe('function')
  const fast = (mod.__ssrString as (p: unknown, o?: unknown) => string)(
    {},
    { hydratable: true, children, lightScopeId },
  )
  const walker = markup(
    await renderToString(() => mod.__ssr(), {
      hydratable: true,
      children,
      lightScopeId,
    } as Parameters<typeof renderToString>[1]),
  )
  return { fast, walker }
}

describe.skipIf(!hasBinary)('SSR child eligibility — the boundary lines agree', () => {
  // ── boundary 1: attributes ────────────────────────────────────────────────
  //
  // The emitter's rule is not "no attributes written" but "no attribute that
  // SURVIVES LOWERING", because that is all the walker can see. Real props
  // block (rendering the child with defaults while the client renders it with
  // real values is a hydration mismatch); element-level directives do not.

  it.each([
    ['id="p"', 'declines'],
    ['data-x="1"', 'declines'],
    ['title={txt}', 'declines'],
    // An event handler occupies a key in the lowered attrs object even though
    // nothing serializes it — the walker counts KEYS, so it declines, and so
    // must the emitter.
    ['onclick={bump}', 'declines'],
    ['on:click.prevent={bump}', 'declines'],
    // `bind:` lowers to a real attribute (and serializes).
    ['bind:value={txt}', 'declines'],
    // Directives: mount effects on the HOST, lowered outside the attrs object.
    // The walker sees zero attrs and resolves; before this reconciliation the
    // emitter counted the raw `Attr::Macro` and shipped an empty element beside
    // the walker's filled one.
    ['show={on()}', 'resolves'],
    ['class:active={on()}', 'resolves'],
    ['ref={el}', 'resolves'],
    ['once', 'resolves'],
    ['memo={on()}', 'resolves'],
    ['raw', 'resolves'],
  ] as const)('a reference carrying %s — both %s', async (attr, verdict) => {
    await expectAgreedVerdict(
      `<main class="page"><h1>T</h1><x-kid ${attr}></x-kid></main>`,
      verdict,
    )
  })

  it('a directive plus a real prop still declines on both', async () => {
    // The directive relaxation must not leak: one surviving attribute is enough.
    await expectAgreedVerdict(
      `<main class="page"><h1>T</h1><x-kid show={on()} id="p"></x-kid></main>`,
      'declines',
    )
  })

  // ── boundary 2: children (slot content) ───────────────────────────────────

  it('a reference with slot children declines on both', async () => {
    await expectAgreedVerdict(
      `<main class="page"><h1>T</h1><x-kid><b>s</b></x-kid></main>`,
      'declines',
    )
  })

  it('a whitespace-only body SPANNING LINES resolves on both', async () => {
    // Template indentation, normalized to nothing by `normalize_text_node`. The
    // walker's node has no children at all; the emitter used to count the text
    // node it was about to drop.
    const html = await expectAgreedVerdict(
      `<main class="page"><h1>T</h1><x-kid>\n  </x-kid></main>`,
      'resolves',
    )
    expect(html).toContain('data-aihu-ssr=""')
  })

  it('a whitespace body on ONE line declines on both', async () => {
    // The counterpart, and the reason the rule is `node_is_dropped` and not
    // `trim().isEmpty()`: a single-line run is a significant inline space, kept
    // by both renderers, so it is real slot content and must block.
    const html = await expectAgreedVerdict(
      `<main class="page"><h1>T</h1><x-kid> </x-kid></main>`,
      'declines',
    )
    expect(html).toContain('<x-kid data-aihu-path="0.1"> </x-kid>')
  })

  it('raw discards written children, so a raw reference resolves on both', async () => {
    // `raw` erases its children during lowering — the walker sees an empty node
    // whatever was written between the tags — so counting the AST children here
    // was another emitter-only decline.
    await expectAgreedVerdict(
      `<main class="page"><h1>T</h1><x-kid raw><b>s</b></x-kid></main>`,
      'resolves',
    )
  })

  // ── boundary 3: the path ──────────────────────────────────────────────────
  //
  // The emitter's condition is "the path is a compile-time LITERAL"; only an
  // `{#each}` item boundary makes it otherwise. `_isLiteralPath` reconstructs
  // that from the path string.

  it('a reference inside {#each} declines on both', async () => {
    await expectAgreedVerdict(
      `<main class="page"><ul><li each={x of items}><x-kid></x-kid></li></ul></main>`,
      'declines',
    )
  })

  it('list keys that spell structural words still decline', async () => {
    // `_isLiteralPath` reads a STRING, so a hostile key is the way to fool it.
    // It cannot be fooled: the runtime key always follows a literal `list`
    // segment, which is rejected first — `…list.conditional`, `…list.true`.
    const html = await expectAgreedVerdict(
      `<main class="page"><ul><li each={x of ['conditional', 'true', 'list']} key={x}><x-kid></x-kid></li></ul></main>`,
      'declines',
    )
    expect(html).toContain('data-aihu-path="0.0.0.list.conditional"')
    expect(html).toContain('data-aihu-path="0.0.0.list.list"')
  })

  it.each([
    // A lone `if=` on the reference itself: the parser folds it into an
    // IfBlock, so the path picks up `.conditional.true` but stays literal.
    ['lone if on the reference', `<main class="page"><h1>T</h1><x-kid if={on()}></x-kid></main>`],
    // A full chain adds a fragment index under the branch.
    [
      'an if/else chain',
      `<main class="page"><h1>T</h1><x-kid if={on()}></x-kid><p else>e</p></main>`,
    ],
    // The reference in the ELSE arm.
    [
      'the else arm',
      `<main class="page"><h1>T</h1><p if={!on()}>no</p><x-kid else></x-kid></main>`,
    ],
    // The ordinary shape, and the one that matters: a plain reference nested
    // inside a conditional block. `<div if={ready}><site-header></site-header>`
    // is everyday template code; the first `_isStaticPath` (digits-only)
    // declined it on the walker while the emitter resolved it.
    [
      'a plain reference nested under {#if}',
      `<main class="page"><h1>T</h1><div if={on()}><x-kid></x-kid></div><p else>e</p></main>`,
    ],
  ])('%s keeps a literal path — both resolve', async (_name, template) => {
    const html = await expectAgreedVerdict(template, 'resolves')
    expect(html).toContain('conditional.true')
  })

  it('an {#each} nested under {#if} still declines (list beats conditional)', async () => {
    const html = await expectAgreedVerdict(
      `<main class="page"><div if={on()}><ul><li each={x of items}><x-kid></x-kid></li></ul></div><p else>e</p></main>`,
      'declines',
    )
    expect(html).toContain('conditional.true')
    expect(html).toContain('.list.')
  })

  it('an {#if} nested under {#each} still declines', async () => {
    await expectAgreedVerdict(
      `<main class="page"><ul><li each={x of items}><div if={on()}><x-kid></x-kid></div><p else>e</p></li></ul></main>`,
      'declines',
    )
  })

  // ── boundary 4: root position ─────────────────────────────────────────────

  it('a reference at ROOT_PATH declines on both', async () => {
    // TWO independent hazards live at ROOT_PATH, and the second is the one that
    // makes this boundary unconditional:
    //
    //  1. the DOUBLE STAMP. `root_scope_attr` (emitter) / `path === ROOT_PATH`
    //     (walker) put the PARENT's `data-a` on this very element, and
    //     `_ssrChildWrap` would add the CHILD's — one element, two `data-a`
    //     attributes, which is malformed and cuts the child's own
    //     `@scope(…) to ([data-a])` rules off at its first child.
    //  2. the PATH-SPACE COLLISION. A resolved reference is a marked host, and
    //     arbor's `hydrate()` (`_ROOT_PATH` guard, added because a marked child
    //     host was clobbering its own key space) registers the container under
    //     `'0'` and refuses any other value on it. A marked host that itself
    //     sits at `'0'` is the one case that guard CANNOT distinguish: its
    //     `data-aihu-path` equals the parent container's, so `'0'` names two
    //     different elements in one path map.
    //
    // Hazard 1 is conditional on a light scope being stamped; hazard 2 is not.
    const html = await expectAgreedVerdict(`<x-kid></x-kid>`, 'declines')
    expect(html).toBe('<x-kid data-aihu-path="0"></x-kid>')
  })

  it('a root reference with a whitespace-only body still declines', async () => {
    // Two boundaries at once: the body relaxation must not smuggle a root
    // reference past the root check.
    await expectAgreedVerdict(`<x-kid>\n</x-kid>`, 'declines')
  })

  // ── boundary 4b: a STRUCTURAL template root (followups §24) ───────────────
  //
  // `<x-kid if={…}>` as the WHOLE template puts the reference at
  // `0.conditional.true`, not `'0'`, so it clears the root check and resolves
  // on both renderers. §24 asked whether that is a hole — whether the child
  // should be declined there too, because the parent's `lightScopeId` is
  // stamped nowhere in that shape.
  //
  // It is not, and these fixtures are the evidence rather than the assertion:
  // neither ROOT_PATH hazard exists at `0.conditional.true` (the element
  // carries no parent stamp, and its path is distinct from the container's),
  // while declining would delete markup that both renderers currently produce
  // — the empty-first-paint class this whole feature exists to remove.
  //
  // The dropped parent stamp is REAL, but it is not a property of the child
  // gate: the fixtures below show a plain `<div if={…}>` root and a multi-root
  // template losing it identically, with no component anywhere.

  it('a reference under a STRUCTURAL root resolves on both', async () => {
    const html = await expectAgreedVerdict(`<x-kid if={on()}></x-kid>`, 'resolves')
    expect(html).toContain('<x-kid data-aihu-path="0.conditional.true"')
    // …and the host is the marked boundary, exactly as at any other non-root
    // position. WHEN THIS FAILS someone has extended the root decline to
    // structural roots (§24 option b): that trades prerendered content for no
    // stamp, so the trade has to be argued, not made silently.
    expect(html).toContain('data-aihu-ssr=""')
  })

  it('the parent stamp is dropped under a structural root — identically on both', async () => {
    // §24's actual finding, pinned. The two renderers AGREE (byte-identity
    // holds, which is why the suite never caught it), and what they agree on is
    // that `lightScopeId` reaches no element: `root_scope_attr` and the
    // walker's `path === ROOT_PATH` both fire only for a single ELEMENT root.
    const { fast, walker } = await renderBothWithScope(`<x-kid if={on()}></x-kid>`)
    expect(fast).toBe(walker)
    expect(fast).toContain('<nav class="kid"') // the child still renders
    expect(fast).not.toContain('data-a="PARENTSCOPE"')
  })

  it.each([
    ['a plain conditional root', `<div if={on()}>x</div>`],
    ['a plain each root', `<div each={x of items}>{x}</div>`],
    ['two element roots', `<p>a</p><p>b</p>`],
  ])('%s drops the same stamp with no component in sight', async (_name, template) => {
    // The counterfactual for the paragraph above: if the dropped stamp were a
    // child-gate property, these would keep it. They do not, so a change to the
    // child gate is the wrong lever — the stamp's placement is.
    const { fast, walker } = await renderBothWithScope(template)
    expect(fast).toBe(walker)
    expect(fast).not.toContain('data-a="PARENTSCOPE"')
  })

  it('wrapTag stamps the host, so the SSG shape loses nothing to a structural root', async () => {
    // Why §24 is not urgent, measured rather than argued. `@aihu/app`'s
    // prerender passes `lightScopeId` and `wrapTag` TOGETHER, and
    // `renderToString` then drops `lightScopeId` from the inner opts and stamps
    // the HOST — which is also where the client stamps it
    // (`define-element.ts`'s connectedCallback). The template root's shape
    // stops mattering: the stamp lands on an element that always exists.
    const { mod, children } = await compileParentWithKid(`<x-kid if={on()}></x-kid>`)
    for (const component of [() => mod.__ssr(), mod.default]) {
      const html = markup(
        await renderToString(component, {
          hydratable: true,
          children,
          lightScopeId: 'PARENTSCOPE',
          wrapTag: 'x-parent',
        } as Parameters<typeof renderToString>[1]),
      )
      expect(html).toContain('<x-parent data-a="PARENTSCOPE" data-aihu-ssr="">')
      expect(html).toContain('<nav class="kid"')
      // The parent's stamp exactly once, and the child's exactly once — not the
      // double stamp the root boundary exists to prevent.
      expect(html.match(/data-a="PARENTSCOPE"/g)).toHaveLength(1)
      expect(html.match(/data-a="k1"/g)).toHaveLength(1)
    }
  })

  it('a hostile lightScopeId is escaped identically on both paths', async () => {
    // `SsrOptions.lightScopeId` is public API and takes any string, while the
    // emitter used to interpolate it RAW into `data-a="…"` where the walker
    // escapes it. Byte divergence on the fast path, and the fast path's bytes
    // were the malformed ones (`data-a="a"b"` — an attribute-injection point).
    const { fast, walker } = await renderBothWithScope(`<main class="page"><h1>T</h1></main>`, {
      scope: 'a"b&c',
    })
    expect(fast).toBe(walker)
    expect(fast).toContain('data-a="a&quot;b&amp;c"')
    expect(fast).not.toContain('data-a="a"b')
  })

  // ── boundary 5: the registry ──────────────────────────────────────────────

  it('a child module the compiler BAILED on declines on both', async () => {
    // A registry entry with no `__ssrString` — `__aihu_schild` fails closed on
    // it. Both renderers reach the helper, so they fail closed together; the
    // fixture pins that neither declines EARLIER than the other, which is what
    // would put an empty element beside a filled one.
    const bailed = await compileToModule(
      'bkid-bailed',
      `@state {
  const src = { status: 'ready', value: 1, onReady: () => () => {} }
}

@template {
  <div><suspense source={src}><p>loaded</p></suspense></div>
}
`,
    )
    expect(bailed.mod.__ssrString).toBeUndefined()
    await expectAgreedVerdict(
      `<main class="page"><h1>T</h1><x-kid></x-kid></main>`,
      'declines',
      new Map<string, unknown>([['x-kid', { ...bailed.mod, __aihu_shadow__: 'light' }]]),
    )
  })

  it('a tag missing from the registry declines on both', async () => {
    await expectAgreedVerdict(
      `<main class="page"><h1>T</h1><x-kid></x-kid></main>`,
      'declines',
      new Map<string, unknown>([['x-other', {}]]),
    )
  })

  // ── the mix ───────────────────────────────────────────────────────────────

  it('a sibling mix of eligible and ineligible references agrees position by position', async () => {
    // Per-case fixtures cannot catch an ordering or index skew, because each
    // renders one reference. Here four references sit side by side — resolve,
    // decline, resolve, decline — so a verdict applied to the wrong sibling
    // shows up as a byte difference rather than passing on both.
    const html = await expectAgreedVerdict(
      `<main class="page"><x-kid></x-kid><x-kid id="p"></x-kid><x-kid show={on()}></x-kid><x-kid><b>s</b></x-kid></main>`,
      'resolves',
    )
    expect(html).toContain('<x-kid data-aihu-path="0.0" data-a="k1" data-aihu-ssr="">')
    expect(html).toContain('<x-kid id="p" data-aihu-path="0.1"></x-kid>')
    expect(html).toContain('<x-kid data-aihu-path="0.2" data-a="k1" data-aihu-ssr="">')
    expect(html).toContain('<x-kid data-aihu-path="0.3"><b data-aihu-path="0.3.0">s</b></x-kid>')
    // Exactly two resolved.
    expect(html.match(/data-aihu-ssr=""/g)).toHaveLength(2)
  })

  it('a resolving reference beside an {#each} one agrees', async () => {
    const html = await expectAgreedVerdict(
      `<main class="page"><x-kid></x-kid><ul><li each={x of items}><x-kid></x-kid></li></ul></main>`,
      'resolves',
    )
    expect(html.match(/data-aihu-ssr=""/g)).toHaveLength(1)
  })

  // ── html={…}: reconciled at the boundary, still open in general ───────────

  it('html={…} on a bare reference resolves the child on both', async () => {
    // The reported worst case: two DIFFERENT non-empty trees. `html` is a
    // directive, so the walker always resolved the child and never saw the
    // binding; the emitter interpolated the html instead. They now agree on the
    // walker's answer, which is also what the client does — the lowered node is
    // `branch('x-kid', undefined, [])` exactly as for a bare reference, and the
    // `html` mount effect skips its first run inside a `data-aihu-ssr`
    // boundary.
    const html = await expectAgreedVerdict(
      `<main class="page"><h1>T</h1><x-kid html={frag}></x-kid></main>`,
      'resolves',
    )
    expect(html).not.toContain('<i>hi</i>')
  })

  it('KNOWN GAP — html={…} still diverges wherever the child gate declines', async () => {
    // NOT a child-boundary divergence, and the counterfactual proves it: a
    // plain `<div html={frag}>` — no component anywhere — diverges identically.
    // The emitter interpolates the binding (deliberately: templates whose BODY
    // is an `html` binding otherwise prerender empty, #docs-next guides); the
    // walker cannot, because `html` is a mount effect and never enters the tree
    // it walks. Reconciling it means changing what `html` MEANS to SSR, which
    // is a different slice than child eligibility.
    //
    // Characterized rather than left silent. WHEN THIS TEST FAILS someone has
    // closed §6's html bullet in general — delete it and add the identity
    // assertion in its place.
    const { mod } = await compileToModule(
      'bhtml-gap',
      `@state {
  const frag = '<i>hi</i>'
}

@template {
  <main><div html={frag}></div></main>
}
`,
    )
    const fast = (mod.__ssrString as (p: unknown, o?: unknown) => string)({}, { hydratable: true })
    const walker = markup(await renderToString(() => mod.__ssr(), { hydratable: true }))
    expect(fast).toContain('<i>hi</i>')
    expect(walker).not.toContain('<i>hi</i>')
    expect(fast).not.toBe(walker)
  })
})

// ─── §8 — AIHU_SSR_STRING=0 reaches child subtrees ──────────────────────────
//
// `__aihu_schild` calls `mod.__ssrString` DIRECTLY, so the compiled string
// renderer stayed engaged for every child even with the hatch open. Two costs.
// The documented way to route a render back through the walker stopped working
// below the top level — a hole in an escape hatch whose whole job is to answer
// "is the fast path lying to me?". And this suite could never exercise a
// walker-rendered child: the walker's own child arm called the string renderer,
// so both sides of every comparison above were, underneath, the same function.
//
// The walker now asks `_ssrStringOf` about the child module's default export
// (the server target attaches `__aihu_ssr_string__` to `__ssr` and exports it
// as `default`, so the same hatch answers for a child as for a page) and walks
// the child itself when the hatch is open. The engine changes; the markup must
// not.
//
// EVERY test here counts calls into the child's `__ssrString` and asserts ZERO
// under the hatch, and this is not belt-and-braces. Reverting the walker's new
// branch leaves both halves of a byte-identity comparison rendered by the SAME
// function, so identity holds trivially and the comparison proves nothing: a
// first draft of this block had five tests that passed with the fix reverted.
// The call count is what makes each of them a claim about the ENGINE.

describe.skipIf(!hasBinary)('SSR string fast path — the escape hatch reaches children (§8)', () => {
  const PARENT = `@template {
  <main class="page"><h1>Title</h1><x-kid></x-kid></main>
}
`
  const CHILD = `@state {
  const [n, setN] = signal(3)
}

@template {
  <nav class="kid"><span>nav {n}</span></nav>
}
`
  const RECURSIVE_CHILD = `@template {
  <nav class="kid"><x-kid></x-kid></nav>
}
`

  async function withHatch<T>(fn: () => Promise<T>): Promise<T> {
    const before = process.env.AIHU_SSR_STRING
    process.env.AIHU_SSR_STRING = '0'
    try {
      return await fn()
    } finally {
      if (before === undefined) delete process.env.AIHU_SSR_STRING
      else process.env.AIHU_SSR_STRING = before
    }
  }

  /**
   * A registry entry that COUNTS compiled-renderer calls while behaving exactly
   * like the real module. `calls` is the engine probe: non-zero means the child
   * came from `__aihu_schild`'s string path, zero means the walker rendered it.
   */
  function countingKid(
    mod: CompiledModule,
    extra: Record<string, unknown> = {},
  ): { entry: Record<string, unknown>; probe: { calls: number } } {
    const probe = { calls: 0 }
    const real = mod.__ssrString
    return {
      probe,
      entry: {
        ...mod,
        __aihu_shadow__: 'light',
        __aihu_light_scope__: 'k1',
        ...extra,
        ...(typeof real === 'function'
          ? {
              __ssrString: (p: Record<string, unknown>, o?: { hydratable?: boolean }) => {
                probe.calls++
                return real(p, o)
              },
            }
          : {}),
      },
    }
  }

  it('renders a walker-rendered child, byte-identical to the string-rendered one', async () => {
    const parent = await compileToModule('hatch-parent', PARENT)
    const kid = await compileToModule('hatch-kid', CHILD)
    const { entry, probe } = countingKid(kid.mod)
    const children = new Map<string, unknown>([['x-kid', entry]])
    for (const hydratable of [true, false]) {
      const opts = { hydratable, children } as Parameters<typeof renderToString>[1]
      probe.calls = 0
      const off = markup(await renderToString(parent.mod.default, opts))
      expect(probe.calls).toBeGreaterThan(0)

      probe.calls = 0
      const on = markup(await withHatch(() => renderToString(parent.mod.default, opts)))
      expect(probe.calls).toBe(0)

      expect(on).toBe(off)
      // FILLED IN on both. Two engines agreeing on an empty element would
      // satisfy identity while shipping the bug the child work exists to fix.
      expect(on).toContain('<nav class="kid"')
      expect(on).toContain('nav ')
    }
  })

  it('changes the engine for the child even when the WALKER runs at the top level', async () => {
    // Isolates the child arm: both halves walk the page, so the only thing the
    // hatch can change here is how the child subtree was produced.
    const parent = await compileToModule('hatch-parent-spy', PARENT)
    const kid = await compileToModule('hatch-kid-spy', CHILD)
    const { entry, probe } = countingKid(kid.mod)
    const children = new Map<string, unknown>([['x-kid', entry]])
    const opts = { hydratable: true, children } as Parameters<typeof renderToString>[1]

    const off = await renderToString(() => parent.mod.__ssr(), opts)
    expect(probe.calls).toBeGreaterThan(0)

    probe.calls = 0
    const on = await withHatch(() => renderToString(() => parent.mod.__ssr(), opts))
    expect(probe.calls).toBe(0)
    expect(markup(on)).toBe(markup(off))
  })

  it('emits the same declarative shadow root + inlined <style> under the hatch', async () => {
    // The host shell (adoption marker, `data-a`, `<template shadowrootmode>`,
    // the inlined CSS) is built by ONE function on both paths — that is why it
    // was split out of `__aihu_schild` rather than reimplemented on the walker
    // side, where it would have drifted.
    const parent = await compileToModule('hatch-parent-shadow', PARENT)
    const kid = await compileToModule('hatch-kid-shadow', CHILD)
    const { entry, probe } = countingKid(kid.mod, {
      __aihu_shadow__: 'shadow',
      __aihu_css__: '.kid{color:red}',
    })
    const children = new Map<string, unknown>([['x-kid', entry]])
    const opts = { hydratable: true, children } as Parameters<typeof renderToString>[1]
    const off = markup(await renderToString(parent.mod.default, opts))
    expect(probe.calls).toBeGreaterThan(0)

    probe.calls = 0
    const on = markup(await withHatch(() => renderToString(parent.mod.default, opts)))
    expect(probe.calls).toBe(0)

    expect(on).toBe(off)
    expect(on).toContain('<template shadowrootmode="open">')
    expect(on).toContain('<style>.kid{color:red}</style>')
    // No `data-a` on a shadow child: its styles are inside the root.
    expect(on).not.toContain('data-a="k1"')
  })

  it('declines exactly where the string path declines — an emitter bail stays bare', async () => {
    // Eligibility here must be a SUBSET of `__aihu_schild`'s, never a superset.
    // The walker COULD render this module (its `__ssr` is intact); rendering it
    // would make the hatch change the MARKUP, which the hatch is documented
    // never to do. `calls` cannot probe the engine when there is no renderer to
    // call, so the claim is pinned the other way: the output is the BARE
    // element, which is what the string path produces and what the walker path
    // would NOT produce if it had taken this module.
    const parent = await compileToModule('hatch-parent-bail', PARENT)
    const kid = await compileToModule('hatch-kid-bail', CHILD)
    const { __ssrString: _dropped, ...noRenderer } = kid.mod as unknown as Record<string, unknown>
    const children = new Map<string, unknown>([
      ['x-kid', { ...noRenderer, __aihu_shadow__: 'light', __aihu_light_scope__: 'k1' }],
    ])
    const opts = { hydratable: true, children } as Parameters<typeof renderToString>[1]
    const off = markup(await renderToString(parent.mod.default, opts))
    const on = markup(await withHatch(() => renderToString(parent.mod.default, opts)))
    expect(on).toBe(off)
    expect(on).toContain('<x-kid data-aihu-path="0.1"></x-kid>')
    expect(on).not.toContain('<nav class="kid"')
  })

  it('bounds a self-referencing child at the same depth on both engines', async () => {
    // The registry only WARNS about a cycle now, so the RENDERERS are what make
    // one finite. The string path caps at `_MAX_CHILD_DEPTH` on its own opts;
    // the walker path threads the same cap through `SsrOptions.__childDepth`.
    // Without that threading this render never terminates — the byte budget
    // cannot stop it, because bytes are only charged as the recursion UNWINDS.
    const parent = await compileToModule('hatch-parent-cycle', PARENT)
    const kid = await compileToModule('hatch-kid-cycle', RECURSIVE_CHILD)
    const { entry, probe } = countingKid(kid.mod)
    const children = new Map<string, unknown>([['x-kid', entry]])
    const opts = { hydratable: true, children } as Parameters<typeof renderToString>[1]
    const off = markup(await renderToString(parent.mod.default, opts))
    expect(probe.calls).toBeGreaterThan(0)

    probe.calls = 0
    const on = markup(await withHatch(() => renderToString(parent.mod.default, opts)))
    expect(probe.calls).toBe(0)

    expect(on).toBe(off)
    const depth = (s: string) => s.split('<nav class="kid"').length - 1
    expect(depth(on)).toBe(32)
    expect(depth(off)).toBe(32)
  }, 20_000)

  it('does not bury a second __aihu_state__ envelope inside the child', async () => {
    // The walker child path drains a nested `renderToStream`, which ends with
    // the per-DOCUMENT state script. It is channel data, not markup: a copy
    // inside a child subtree is both a byte divergence and a duplicate DOM id.
    // This one is ONLY meaningful under the hatch — the string path has no
    // nested stream to drain — so the zero-call assertion is what proves the
    // nested drain actually happened.
    const parent = await compileToModule('hatch-parent-state', PARENT)
    const kid = await compileToModule('hatch-kid-state', CHILD)
    const { entry, probe } = countingKid(kid.mod)
    const children = new Map<string, unknown>([['x-kid', entry]])
    const on = await withHatch(() =>
      renderToString(parent.mod.default, {
        hydratable: true,
        children,
      } as Parameters<typeof renderToString>[1]),
    )
    expect(probe.calls).toBe(0)
    expect(markup(on)).toContain('<nav class="kid"')
    expect(on.split('id="__aihu_state__"').length - 1).toBeLessThanOrEqual(1)
    expect(markup(on)).not.toContain('<script type="application/json"')
  })
})
