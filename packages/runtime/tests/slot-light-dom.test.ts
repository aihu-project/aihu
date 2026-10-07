/**
 * Bug D — light-DOM <slot> projection under `shadowMode: 'light'`.
 *
 * Spec (investigation §8 + Architect brief): when a custom element is
 * registered with `shadowMode: 'light'` the browser does NOT run native
 * <slot> projection; the compiler still emits a real <slot> DOM element
 * from `<slot>`. Pre-fix, the layout's template was appended AFTER the
 * page's light-DOM children, producing the wrong order; the <slot>
 * placeholder was inert.
 *
 * Post-fix, defineComponent.connectedCallback:
 *   1. Carves `this.childNodes` into a buffer.
 *   2. Lets _build/_mount run on an empty host.
 *   3. Finds the first default <slot> in the host and replaces it with
 *      the buffered children. If no slot is present, reattaches the
 *      children to the host as a graceful fallback.
 *
 * The Shadow-DOM path MUST remain untouched (regression guard below).
 *
 * Named slots (`<slot name="foo">`) + default fallback content
 * (`<slot>fallback</slot>`) are now handled with full Shadow-DOM parity —
 * see the "#436 — named slots + default fallback" describe block below for
 * the acceptance-criteria (A–F) coverage.
 */

import { branch, leaf, mount, slot } from '@aihu/arbor'
import { describe, expect, it } from 'vitest'
import { _projectLightDomSlot, _setMount, defineComponent } from '../src/define-component.ts'
import { defineElement } from '../src/define-element.ts'

_setMount(mount)

describe('Bug D — light-DOM <slot> projection (shadowMode: "light")', () => {
  it('projects light-DOM children at the <slot> position', () => {
    const Cmp = defineComponent(() =>
      branch('div', { class: 'layout' }, [leaf.element('nav', undefined), slot()]),
    )
    defineElement('x-bugd-light-1', Cmp, { shadowMode: 'light' })

    const host = document.createElement('x-bugd-light-1')
    host.innerHTML = '<h1>Waves</h1><p>p</p>'
    document.body.appendChild(host)

    // Host has the layout div as its sole child; div has [nav, h1, p] in
    // that order (slot replaced by the page's children).
    expect(host.children.length).toBe(1)
    const div = host.firstElementChild as HTMLElement
    expect(div.tagName).toBe('DIV')
    expect(div.getAttribute('class')).toBe('layout')
    expect([...div.children].map((c) => c.tagName)).toEqual(['NAV', 'H1', 'P'])
    // The inert <slot> placeholder must be gone.
    expect(div.querySelector('slot')).toBeNull()

    host.remove()
  })

  it('preserves text nodes among the projected children', () => {
    const Cmp = defineComponent(() => branch('section', undefined, [slot()]))
    defineElement('x-bugd-light-2', Cmp, { shadowMode: 'light' })

    const host = document.createElement('x-bugd-light-2')
    // Mix element + text nodes — childNodes (not children) must be carved.
    host.append('hello ', document.createElement('em'), ' world')
    ;(host.querySelector('em') as HTMLElement).textContent = 'bold'
    document.body.appendChild(host)

    const section = host.firstElementChild as HTMLElement
    expect(section.tagName).toBe('SECTION')
    // Text node + element + text node landed where the <slot> was.
    expect(section.childNodes.length).toBe(3)
    expect(section.childNodes[0]?.nodeType).toBe(Node.TEXT_NODE)
    expect(section.childNodes[0]?.nodeValue).toBe('hello ')
    expect((section.childNodes[1] as HTMLElement).tagName).toBe('EM')
    expect(section.childNodes[2]?.nodeValue).toBe(' world')

    host.remove()
  })

  it('regression: shadow-DOM path is unchanged (browser handles slot natively)', () => {
    const Cmp = defineComponent(() =>
      branch('div', { class: 'layout' }, [leaf.element('nav', undefined), slot()]),
    )
    defineElement('x-bugd-shadow-1', Cmp, { shadowMode: 'shadow' })

    const host = document.createElement('x-bugd-shadow-1')
    host.innerHTML = '<h1>Waves</h1><p>p</p>'
    document.body.appendChild(host)

    // Shadow-mode: light-DOM children remain on the host element itself;
    // the layout template lives in the shadow root with the native <slot>
    // placeholder still present (the browser composes the tree at render
    // time — there is no carve-and-reinsert).
    expect([...host.children].map((c) => c.tagName)).toEqual(['H1', 'P'])
    const shadowRoot = host.shadowRoot
    expect(shadowRoot).not.toBeNull()
    const shadowDiv = shadowRoot?.firstElementChild as HTMLElement
    expect(shadowDiv.tagName).toBe('DIV')
    // The platform <slot> is still present (jsdom does not compose, but
    // critically: the runtime fix did NOT carve under shadowMode).
    expect(shadowDiv.querySelector('slot')).not.toBeNull()
    expect([...shadowDiv.children].map((c) => c.tagName)).toEqual(['NAV', 'SLOT'])

    host.remove()
  })

  it('edge case: shadowMode "light" with no <slot> in the layout — children fall back onto the host', () => {
    // Layout has no slot — the carve-and-reinsert should append the
    // buffered children back to the host (no errors, no data loss).
    const Cmp = defineComponent(() => branch('div', { class: 'no-slot' }, []))
    defineElement('x-bugd-light-3', Cmp, { shadowMode: 'light' })

    const host = document.createElement('x-bugd-light-3')
    host.innerHTML = '<span>orphan</span>'
    document.body.appendChild(host)

    // Layout div is the first child; the orphan span trails after it on
    // the host (fallback path, preserves the child rather than dropping).
    expect(host.children.length).toBe(2)
    expect((host.children[0] as HTMLElement).tagName).toBe('DIV')
    expect((host.children[0] as HTMLElement).getAttribute('class')).toBe('no-slot')
    expect((host.children[1] as HTMLElement).tagName).toBe('SPAN')
    expect((host.children[1] as HTMLElement).textContent).toBe('orphan')

    host.remove()
  })
})

describe('#436 — named slots + default fallback (Shadow-DOM parity)', () => {
  // A: a named-slot placeholder + a child carrying the matching `slot="foo"`
  // → the child lands where the named slot was; unmatched children do not.
  it('A: routes a child with slot="foo" to <slot name="foo">', () => {
    const Cmp = defineComponent(() => branch('div', { class: 'layout' }, [slot('foo')]))
    defineElement('x-436-a', Cmp, { shadowMode: 'light' })

    const host = document.createElement('x-436-a')
    // The <span slot="foo"> must land in the named slot; the bare <p> has no
    // default slot to fall into and so must NOT appear inside the layout div.
    host.innerHTML = '<span slot="foo">named</span><p>orphan</p>'
    document.body.appendChild(host)

    const div = host.firstElementChild as HTMLElement
    expect(div.tagName).toBe('DIV')
    expect([...div.children].map((c) => c.tagName)).toEqual(['SPAN'])
    expect(div.querySelector('span')?.textContent).toBe('named')
    expect(div.querySelector('slot')).toBeNull()
    // The unmatched <p> is preserved on the host (preserve-not-drop).
    expect(host.querySelector(':scope > p')?.textContent).toBe('orphan')

    host.remove()
  })

  // B: the unnamed default slot still works exactly as before — default
  // children (no `slot=` attr) land in order at the default-slot position.
  it('B: unnamed <slot> receives the default children in order', () => {
    const Cmp = defineComponent(() => branch('div', { class: 'layout' }, [slot()]))
    defineElement('x-436-b', Cmp, { shadowMode: 'light' })

    const host = document.createElement('x-436-b')
    host.innerHTML = '<h1>a</h1><p>b</p>'
    document.body.appendChild(host)

    const div = host.firstElementChild as HTMLElement
    expect([...div.children].map((c) => c.tagName)).toEqual(['H1', 'P'])
    expect(div.querySelector('slot')).toBeNull()

    host.remove()
  })

  // C: a named slot with fallback content and NO matching child → the
  // fallback renders and the slot element itself is unwrapped.
  it('C: <slot name="x">DEFAULT</slot> with no match preserves the fallback', () => {
    const Cmp = defineComponent(() =>
      branch('div', { class: 'layout' }, [
        branch('slot', { name: 'x' }, [branch('span', { class: 'fb' }, [leaf('DEFAULT')])]),
      ]),
    )
    defineElement('x-436-c', Cmp, { shadowMode: 'light' })

    const host = document.createElement('x-436-c')
    // A child that does NOT target slot "x" — leaves the named slot unassigned.
    host.innerHTML = '<em slot="other">nope</em>'
    document.body.appendChild(host)

    const div = host.firstElementChild as HTMLElement
    // Fallback preserved, slot unwrapped.
    expect(div.querySelector('slot')).toBeNull()
    const fb = div.querySelector('span.fb')
    expect(fb).not.toBeNull()
    expect(fb?.textContent).toBe('DEFAULT')
    // Unmatched child preserved on the host.
    expect(host.querySelector(':scope > em')?.textContent).toBe('nope')

    host.remove()
  })

  // D: a default slot with fallback AND at least one matching default child →
  // the children win and the fallback content is discarded.
  it('D: <slot>DEFAULT</slot> with a default child discards the fallback', () => {
    const Cmp = defineComponent(() =>
      branch('div', { class: 'layout' }, [
        branch('slot', undefined, [branch('span', { class: 'fb' }, [leaf('DEFAULT')])]),
      ]),
    )
    defineElement('x-436-d', Cmp, { shadowMode: 'light' })

    const host = document.createElement('x-436-d')
    host.innerHTML = '<p>real</p>'
    document.body.appendChild(host)

    const div = host.firstElementChild as HTMLElement
    expect([...div.children].map((c) => c.tagName)).toEqual(['P'])
    expect(div.querySelector('p')?.textContent).toBe('real')
    expect(div.querySelector('span.fb')).toBeNull()
    expect(div.querySelector('slot')).toBeNull()

    host.remove()
  })

  // E: multiple named slots + a default slot in one layout all route in a
  // single projection pass, each to its own placeholder position.
  it('E: multiple named slots + default all route correctly in one pass', () => {
    const Cmp = defineComponent(() =>
      branch('div', { class: 'layout' }, [slot('header'), slot(), slot('footer')]),
    )
    defineElement('x-436-e', Cmp, { shadowMode: 'light' })

    const host = document.createElement('x-436-e')
    host.innerHTML = '<h1 slot="header">H</h1><p>d1</p><nav slot="footer">F</nav><p>d2</p>'
    document.body.appendChild(host)

    const div = host.firstElementChild as HTMLElement
    // Placeholder order: header, default, footer → H, [d1, d2], F.
    expect([...div.children].map((c) => c.tagName)).toEqual(['H1', 'P', 'P', 'NAV'])
    expect(div.children[0]?.textContent).toBe('H')
    expect(div.children[1]?.textContent).toBe('d1')
    expect(div.children[2]?.textContent).toBe('d2')
    expect(div.children[3]?.textContent).toBe('F')
    expect(div.querySelector('slot')).toBeNull()

    host.remove()
  })

  // F: a component authoring NO slot at all is unchanged — the children
  // reattach to the host after the layout template.
  it('F: no slot in the layout reattaches children to the host', () => {
    const Cmp = defineComponent(() => branch('div', { class: 'no-slot' }, []))
    defineElement('x-436-f', Cmp, { shadowMode: 'light' })

    const host = document.createElement('x-436-f')
    host.innerHTML = '<span>orphan</span>'
    document.body.appendChild(host)

    expect(host.children.length).toBe(2)
    expect((host.children[0] as HTMLElement).getAttribute('class')).toBe('no-slot')
    expect((host.children[1] as HTMLElement).tagName).toBe('SPAN')
    expect((host.children[1] as HTMLElement).textContent).toBe('orphan')

    host.remove()
  })
})

describe('LDF §10 step 4 — data-aihu-slotted marker on projected nodes', () => {
  // The marker lets `light_scope.rs`'s `::slotted()` lowering
  // (`[data-aihu-slotted]`) target every top-level node this module
  // reparents from the caller into the layout. This is a deliberate
  // SUPERSET of what real Shadow DOM's `::slotted()` would match: in real
  // Shadow DOM, a child whose `slot=` matches no placeholder (or every
  // child, when the layout has no `<slot>` at all) is unassigned and
  // doesn't render at all, so `::slotted()` never sees it. aihu's
  // light-DOM emulation instead preserve-not-drops those nodes onto the
  // host (see the "preserve-not-drop" tests above) — leaving them
  // unmarked would make them unstylable by `::slotted()` while still being
  // visible, which is worse than the marker being slightly too broad. A
  // slot's own fallback content is the component's OWN authored markup,
  // not projected content, and must not be marked either way.
  it('marks a default-slot child', () => {
    const Cmp = defineComponent(() => branch('div', { class: 'layout' }, [slot()]))
    defineElement('x-slotmark-a', Cmp, { shadowMode: 'light' })

    const host = document.createElement('x-slotmark-a')
    host.innerHTML = '<h1>a</h1>'
    document.body.appendChild(host)

    const h1 = host.querySelector('h1') as HTMLElement
    expect(h1.hasAttribute('data-aihu-slotted')).toBe(true)

    host.remove()
  })

  it('marks a named-slot child', () => {
    const Cmp = defineComponent(() => branch('div', { class: 'layout' }, [slot('foo')]))
    defineElement('x-slotmark-b', Cmp, { shadowMode: 'light' })

    const host = document.createElement('x-slotmark-b')
    host.innerHTML = '<span slot="foo">named</span>'
    document.body.appendChild(host)

    const span = host.querySelector('span') as HTMLElement
    expect(span.hasAttribute('data-aihu-slotted')).toBe(true)

    host.remove()
  })

  it('marks children reattached via the no-slot-in-layout fallback path', () => {
    const Cmp = defineComponent(() => branch('div', { class: 'no-slot' }, []))
    defineElement('x-slotmark-c', Cmp, { shadowMode: 'light' })

    const host = document.createElement('x-slotmark-c')
    host.innerHTML = '<span>orphan</span>'
    document.body.appendChild(host)

    const span = host.querySelector('span') as HTMLElement
    expect(span.hasAttribute('data-aihu-slotted')).toBe(true)

    host.remove()
  })

  it('marks a child whose slot= name matches no placeholder (preserve-not-drop path)', () => {
    const Cmp = defineComponent(() => branch('div', { class: 'layout' }, [slot('foo')]))
    defineElement('x-slotmark-d', Cmp, { shadowMode: 'light' })

    const host = document.createElement('x-slotmark-d')
    host.innerHTML = '<p>orphan</p>'
    document.body.appendChild(host)

    const p = host.querySelector('p') as HTMLElement
    expect(p.hasAttribute('data-aihu-slotted')).toBe(true)

    host.remove()
  })

  it("does NOT mark a slot's own fallback content (not projected — the component's own markup)", () => {
    const Cmp = defineComponent(() =>
      branch('div', { class: 'layout' }, [
        branch('slot', { name: 'x' }, [branch('span', { class: 'fb' }, [leaf('DEFAULT')])]),
      ]),
    )
    defineElement('x-slotmark-e', Cmp, { shadowMode: 'light' })

    const host = document.createElement('x-slotmark-e')
    document.body.appendChild(host)

    const fb = host.querySelector('span.fb') as HTMLElement
    expect(fb.hasAttribute('data-aihu-slotted')).toBe(false)

    host.remove()
  })

  it('does not mark projected nodes under shadowMode: "shadow" (no carve-and-reinsert)', () => {
    const Cmp = defineComponent(() => branch('div', { class: 'layout' }, [slot()]))
    defineElement('x-slotmark-f', Cmp, { shadowMode: 'shadow' })

    const host = document.createElement('x-slotmark-f')
    host.innerHTML = '<h1>a</h1>'
    document.body.appendChild(host)

    const h1 = host.querySelector('h1') as HTMLElement
    expect(h1.hasAttribute('data-aihu-slotted')).toBe(false)

    host.remove()
  })
})

describe('_projectLightDomSlot export (aihu-runtime#4 — top-level hydrate path)', () => {
  // These drive the exported primitive directly, standalone from
  // `connectedCallback`, mirroring the carve-before/build-or-adopt/
  // reinsert-after sequencing that `@aihu/arbor`'s top-level `hydrate()` walk
  // (a different package, outside this repo) would need to replicate to
  // close the page-level hydration gap described in aihu-runtime#4.

  it('projects carved children into a <slot> built by a later step, same as the connectedCallback path', () => {
    const host = document.createElement('div')
    host.innerHTML = '<h1>Waves</h1><p>p</p>'
    document.body.appendChild(host)

    // Carve BEFORE the new subtree is built/adopted onto the host.
    const carved = Array.from(host.childNodes)
    host.replaceChildren()

    // Simulate the SSR/hydrate-produced subtree landing on the host.
    const nav = document.createElement('nav')
    const layout = document.createElement('div')
    layout.className = 'layout'
    layout.appendChild(nav)
    layout.appendChild(document.createElement('slot'))
    host.appendChild(layout)

    // Reinsert AFTER, exactly as the two connectedCallback call sites do.
    _projectLightDomSlot(host, carved)

    expect([...layout.children].map((c) => c.tagName)).toEqual(['NAV', 'H1', 'P'])
    expect(layout.querySelector('slot')).toBeNull()

    host.remove()
  })

  it('is a no-op when there are no carved children', () => {
    const host = document.createElement('div')
    const layout = document.createElement('div')
    layout.appendChild(document.createElement('slot'))
    host.appendChild(layout)
    document.body.appendChild(host)

    _projectLightDomSlot(host, [])

    // Untouched — an empty carve list returns before touching the DOM.
    expect(layout.querySelector('slot')).not.toBeNull()

    host.remove()
  })
})
