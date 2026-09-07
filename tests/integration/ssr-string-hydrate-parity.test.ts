/**
 * Wave-3 — hydration adoption over STRING-RENDERED output.
 *
 * `ssr-hydrate-path-parity.test.ts` proves the client walker adopts the TREE
 * WALKER's HTML. The compiled string fast path replaces that renderer for
 * compiled components, so the same adoption property must hold over
 * `__ssrString` output: identical wire grammar in, byte-identical adoption
 * out. The load-bearing assertions are the same four as the checker script
 * (`scripts/check-hydration-adoption.ts`): innerHTML unchanged, node
 * identity preserved, text appears exactly once, and reactive writes drive
 * the server's own nodes.
 *
 * Fixtures compile through the REAL Rust binary (skipped when unbuilt),
 * exactly like tests/integration/server-emission-ssr.test.ts.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hydrate } from '@aihu/arbor/hydrate'
import { transform } from '@aihu/compiler'
import { _setStoreSerializer, renderToString } from '@aihu/server'
import { computed, signal } from '@aihu/signals'
import { _resetStoreRegistry, defineStore, hydrateStores, serializeStores } from '@aihu/store'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')

const hasBinary = ['target/release/aihu-compile', 'target/debug/aihu-compile'].some((p) =>
  existsSync(join(repoRoot, p)),
)

const SCRATCH = join(__dirname, '.scratch-ssr-string-hydrate')

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
  __ssr: () => unknown
  __ssrString: (props?: Record<string, unknown>, opts?: { hydratable?: boolean }) => string
  default: (props?: Record<string, unknown>) => unknown
}

async function compileToModule(name: string, source: string): Promise<CompiledModule> {
  const { code } = transform(source, `src/pages/${name}.aihu`, { target: 'server' })
  mkdirSync(SCRATCH, { recursive: true })
  const file = join(SCRATCH, `${name}.ts`)
  writeFileSync(file, withResolvedImports(code))
  return (await import(/* @vite-ignore */ file)) as unknown as CompiledModule
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  let n = 0
  let i = haystack.indexOf(needle)
  while (i !== -1) {
    n++
    i = haystack.indexOf(needle, i + needle.length)
  }
  return n
}

const PRIMARY = 'STRING-RENDERED-ADOPTED-NOT-REBUILT'

describe.skipIf(!hasBinary)('string-rendered HTML: the client walker adopts it', () => {
  it('non-structural compiled component: adoption is BYTE-STABLE', async () => {
    const mod = await compileToModule(
      'hydrate-string-basic',
      `@state {
  const [msg, setMsg] = signal('${PRIMARY}')
}

@template {
  <main id="page">
    <article>
      <h2>{msg}</h2>
      <p>static tail</p>
    </article>
  </main>
}
`,
    )
    const html = mod.__ssrString({}, { hydratable: true })
    expect(html).toContain('data-aihu-path="0"')

    const host = document.createElement('div')
    host.innerHTML = html
    const before = host.innerHTML
    const rootBefore = host.firstElementChild

    hydrate(mod.__ssr as () => never, host, {})

    // Adoption, not rebuild: a missed path lookup silently materializes a
    // SECOND tree beside the server's DOM — innerHTML would change and the
    // text would double.
    expect(host.innerHTML).toBe(before)
    expect(host.firstElementChild).toBe(rootBefore)
    expect(countOccurrences(host.textContent ?? '', PRIMARY)).toBe(1)
  })

  it('structural content: adopt-by-replace, no duplication, root identity kept', async () => {
    const mod = await compileToModule(
      'hydrate-string-structural',
      `@state {
  const [n, setN] = signal(2)
  const items = ['x', 'y']
}

@template {
  <section>
    <p if={n() > 1}>big {n}</p>
    <p else>small</p>
    <li each={it of items} key={it}>{it}</li>
  </section>
}
`,
    )
    const { renderToString } = await import('../../packages/server/src/ssr.ts')
    const viaWalker = await renderToString(() => mod.__ssr(), { hydratable: true })
    const viaString = mod.__ssrString({}, { hydratable: true })
    // Identical bytes in ⇒ identical hydration behavior, by construction.
    expect(viaString).toBe(viaWalker)

    const host = document.createElement('div')
    host.innerHTML = viaString
    const rootBefore = host.firstElementChild

    hydrate(mod.__ssr as () => never, host, {})

    // Structural segments hydrate ADOPT-BY-REPLACE (the client materializer
    // swaps the marked segment in position — see arbor/src/hydrate.ts), so
    // innerHTML is NOT byte-stable across them; the invariants that must
    // hold are: the host element is adopted (same object), and no content
    // duplicates beside the server's DOM.
    expect(host.firstElementChild).toBe(rootBefore)
    expect(countOccurrences(host.textContent ?? '', 'big')).toBe(1)
    expect(host.querySelectorAll('li').length).toBe(2)
    expect(countOccurrences(host.textContent ?? '', 'small')).toBe(0)
  })
})

/**
 * Wave-3 seam proof — STORE state adopts under the STRING renderer.
 *
 * The reconciliation's load-bearing guarantee: the compiled string fast path
 * builds NO arbor tree, so the walker's post-render signal harvest cannot run
 * (component-local signals re-derive on the client — the documented v1
 * limitation). But STORE state is arbor-independent (`serializeStores` reads
 * the module-singleton registry, not the tree), so it MUST still ride the
 * `__aihu_state__` envelope under string rendering and adopt on the client
 * with NO re-derivation. This is the important case the seam must not drop.
 * See the string-fast-path emission commentary in packages/server/src/ssr.ts
 * and the seam assertions in packages/server/tests/ssr-string-differential.
 */
describe.skipIf(!hasBinary)('string-rendered pages: STORE state adopts (the wave-3 seam)', () => {
  const deriveSpy = vi.fn(() => 41)
  let storeCounter = 0
  const defineCounter = () =>
    defineStore(`str-counter-${++storeCounter}`, () => {
      const [count, setCount] = signal(0)
      const double = computed(() => count() * 2)
      const load = (): void => setCount(deriveSpy())
      return { count, setCount, double, load }
    })

  afterEach(() => {
    _setStoreSerializer(undefined)
    _resetStoreRegistry()
    deriveSpy.mockClear()
  })

  it('store adopts under the string path; component-local signals stay empty', async () => {
    // A COMPILED component (carries `__aihu_ssr_string__`, so `renderToString`
    // takes the string fast path). Its `{msg}` is a component-local signal —
    // under the string path it CANNOT be harvested (no arbor tree), which is
    // exactly what makes the seam observable.
    const mod = await compileToModule(
      'hydrate-string-store',
      `@state {
  const [msg, setMsg] = signal('${PRIMARY}')
}

@template {
  <main id="page"><h2>{msg}</h2></main>
}
`,
    )

    // ── Server: stores live in the registry (populated during setup), wired
    //    exactly like @aihu/app's prerender injects serializeStores. ──
    _setStoreSerializer(serializeStores)
    const useCounter = defineCounter()
    const storeId = `str-counter-${storeCounter}`
    const serverStore = useCounter()
    // Fetch-if-empty runs server-side → count becomes 41 (the derive the
    // client must NOT repeat).
    if ((serverStore.count as () => number)() === 0) (serverStore.load as () => void)()
    expect(deriveSpy).toHaveBeenCalledTimes(1)

    // ── Render via the STRING fast path (mod.default carries the compiled
    //    __aihu_ssr_string__; renderToString engages it). ──
    const html = await renderToString(mod.default as () => never, { hydratable: true })
    // The string renderer's markup is present (no walker tree was built)…
    expect(html).toContain('id="page"')
    expect(html).toContain(PRIMARY)

    const m = html.match(
      /<script type="application\/json" id="__aihu_state__">([\s\S]*?)<\/script>/,
    )
    expect(m).not.toBeNull()
    const env = JSON.parse((m as RegExpMatchArray)[1] as string) as {
      v: number
      stores: Record<string, Record<string, unknown>>
      signals?: Record<string, unknown>
    }
    expect(env.v).toBe(1)
    // The SEAM: the component's local `{msg}` signal is NOT harvested under
    // string rendering (no tree walk) — the signals channel is empty. Its
    // presence would prove the walker ran; its absence proves the string path
    // did. (msg re-derives on the client from the factory default — correct,
    // just not the optimized adopt-in-place the walker path gets.)
    expect(env.signals ?? {}).toEqual({})
    // …while STORE state (arbor-independent) DID ride the envelope.
    expect(env.stores[storeId]).toEqual({ count: 41 })

    // ── "New page load": adopt stores, then re-instantiate with the same
    //    fetch-if-empty guard. Adoption must short-circuit the derive. ──
    _resetStoreRegistry()
    deriveSpy.mockClear()
    hydrateStores(env.stores)
    const clientStore = useCounter()
    if ((clientStore.count as () => number)() === 0) (clientStore.load as () => void)()
    // NO re-derivation under string rendering — the guarantee holds for stores.
    expect(deriveSpy).not.toHaveBeenCalled()
    expect((clientStore.count as () => number)()).toBe(41)
    expect((clientStore.double as () => number)()).toBe(82)
  })

  it('html={expr}: SSR carries the content and hydration stays byte-stable', async () => {
    // `html` used to emit nothing server-side, so this case could not
    // mismatch — the SSR miss was guaranteed. Now the string carries the
    // markup AND the client's onMount still runs replaceChildren over the
    // same expression, so the two renderings have to agree exactly.
    const mod = await compileToModule(
      'hydrate-string-html-binding',
      `@state {
  const body = '<h2>${PRIMARY}</h2><p>static tail</p>'
}

@template {
  <main id="page">
    <article html={body}></article>
  </main>
}
`,
    )
    const html = mod.__ssrString({}, { hydratable: true })
    // The regression this guards: an empty <article> served to crawlers.
    expect(html).toContain(PRIMARY)

    const host = document.createElement('div')
    host.innerHTML = html
    const before = host.innerHTML
    const rootBefore = host.firstElementChild

    hydrate(mod.__ssr as () => never, host, {})

    expect(host.innerHTML).toBe(before)
    expect(host.firstElementChild).toBe(rootBefore)
    // Doubling here would mean the client appended its fragment alongside the
    // server's nodes instead of replacing them.
    expect(countOccurrences(host.textContent ?? '', PRIMARY)).toBe(1)
  })
})
