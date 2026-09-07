/**
 * SSR → hydrate path-key parity (CO5).
 *
 * The `data-aihu-path` addressing scheme has three independent implementations:
 * `@aihu/server`'s `ssr.ts`, `@aihu/arbor`'s `hydrate.ts`, and the Rust renderer
 * in `packages/server/src-native/src/render.rs`. Before CO5 the first two
 * disagreed at the root — the server seeded its walk with `'0'` while the
 * client walker hardcoded `'hydrate.0'` — so no branch lookup could ever hit.
 *
 * That defect was invisible to the entire suite because NO test piped real
 * server output into `hydrate()`. `packages/arbor/tests/hydrate.test.ts`
 * hand-wrote the markup it then asserted, so it agreed with itself while
 * disagreeing with the renderer, and stayed green throughout. These tests exist
 * to close exactly that gap: every fixture here is REAL
 * `renderToString(…, { hydratable: true })` output, never a hand-written blob.
 *
 * The failure mode being guarded is silent. A root mismatch throws nothing —
 * `_hydrateNode` reads a missed lookup as a DOM mismatch and falls back to
 * `_materialize`, which builds a second copy of the tree beside the server's
 * DOM. The user sees duplicated content; the test suite sees green. So the
 * load-bearing assertions below are ADOPTION (`innerHTML` unchanged, same node
 * identity) and TEXT-APPEARS-EXACTLY-ONCE, not "the text is present".
 */

import { branch, leaf } from '@aihu/arbor'
// This is intentionally exported by the hydration subpath: server and client
// path-key parity is part of the package's release contract.
import { _ROOT_PATH, hydrate } from '@aihu/arbor/hydrate'
import { renderToString } from '@aihu/server'
import { signal } from '@aihu/signals'
import { describe, expect, it } from 'vitest'

const PRIMARY_TEXT = 'PRIMARY-CONTENT-ADOPTED-NOT-REBUILT'

/** Render a component through the real SSR path and install it under a host. */
async function serverRender(component: () => unknown): Promise<HTMLDivElement> {
  const html = await renderToString(component, { hydratable: true })
  const host = document.createElement('div')
  host.innerHTML = html
  return host
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

describe('SSR → hydrate parity: the server root and the client root agree', () => {
  it('the server emits a root marker the client walker actually looks up', async () => {
    const component = () => branch('main', { id: 'page' }, [leaf(PRIMARY_TEXT)])
    const html = await renderToString(component, { hydratable: true })

    // Whatever the root key is, BOTH sides must use it. Assert the property
    // (the root marker exists and the client finds it), not the literal.
    expect(html).toContain('data-aihu-path')

    const host = document.createElement('div')
    host.innerHTML = html
    const rootEl = host.firstElementChild
    expect(rootEl).not.toBeNull()
    const serverRoot = rootEl?.getAttribute('data-aihu-path')
    expect(serverRoot).not.toBeNull()

    // The client's lookup table is built the same way `hydrate()` builds it.
    const pathMap = new Map<string, Element>()
    for (const el of host.querySelectorAll('[data-aihu-path]')) {
      pathMap.set(el.getAttribute('data-aihu-path') as string, el)
    }

    // The load-bearing assertion: the key the CLIENT will ask for is present.
    // Asserting `pathMap.has(serverRoot)` alone proves nothing — it compares
    // the server against itself and stays green under a client-side root
    // change. This compares the two implementations.
    expect(pathMap.has(_ROOT_PATH)).toBe(true)
    expect(serverRoot).toBe(_ROOT_PATH)
  })

  it('hydrate ADOPTS the server DOM — innerHTML is byte-identical afterward', async () => {
    const [text] = signal(PRIMARY_TEXT)
    const component = () =>
      branch('main', { id: 'page' }, [branch('article', {}, [leaf([text] as never)])])

    const host = await serverRender(component)
    const before = host.innerHTML
    const rootBefore = host.firstElementChild

    hydrate(component as () => never, host, {})

    // The whole point: no element re-creation. A root-key mismatch would send
    // `_hydrateNode` down the `_materialize` fallback and APPEND a second tree,
    // which changes innerHTML and duplicates the text.
    expect(host.innerHTML).toBe(before)
    expect(host.firstElementChild).toBe(rootBefore)
  })

  it('the primary text appears EXACTLY ONCE after hydration', async () => {
    const [text] = signal(PRIMARY_TEXT)
    const component = () =>
      branch('main', { id: 'page' }, [branch('article', {}, [leaf([text] as never)])])

    const host = await serverRender(component)
    expect(countOccurrences(host.textContent ?? '', PRIMARY_TEXT)).toBe(1)

    hydrate(component as () => never, host, {})

    // Duplication is the user-visible symptom of a rebuild-beside-the-DOM.
    expect(countOccurrences(host.textContent ?? '', PRIMARY_TEXT)).toBe(1)
    expect(countOccurrences(host.innerHTML, PRIMARY_TEXT)).toBe(1)
  })

  it('hydration wires signals to the SERVER-rendered node, not a replacement', async () => {
    const [text, setText] = signal(PRIMARY_TEXT)
    const component = () =>
      branch('main', { id: 'page' }, [branch('article', {}, [leaf([text] as never)])])

    const host = await serverRender(component)
    const article = host.querySelector('article')
    expect(article).not.toBeNull()
    // Capture the actual Text node the server produced.
    const serverTextNode = article?.firstChild
    expect(serverTextNode?.nodeType).toBe(3)

    hydrate(component as () => never, host, {})
    setText('UPDATED-IN-PLACE')

    // If hydration had rebuilt, the effect would drive a DIFFERENT text node
    // and this original one would still read the server's value.
    expect(serverTextNode?.nodeValue).toBe('UPDATED-IN-PLACE')
    expect(article?.firstChild).toBe(serverTextNode)
    expect(countOccurrences(host.textContent ?? '', 'UPDATED-IN-PLACE')).toBe(1)
  })

  it('nested branches adopt at every depth, not just the root', async () => {
    const [text, setText] = signal('deep')
    const component = () =>
      branch('main', {}, [
        branch('section', {}, [branch('div', {}, [branch('span', {}, [leaf([text] as never)])])]),
      ])

    const host = await serverRender(component)
    const before = host.innerHTML
    const span = host.querySelector('span')

    hydrate(component as () => never, host, {})

    expect(host.innerHTML).toBe(before)
    setText('deep-updated')
    expect(span?.textContent).toBe('deep-updated')
    expect(host.querySelectorAll('span').length).toBe(1)
  })
})
