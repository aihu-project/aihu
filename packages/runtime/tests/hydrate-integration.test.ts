/**
 * First-render DOM adoption — integration tests.
 *
 * The old model (`defineElement(tag, Cmp, { hydrate: true })` + a
 * `window.__aihu_state__[tag]` snapshot gate) ran hydration as a SEPARATE
 * connect path in define-element.ts that skipped the whole mount phase
 * (no onMount, no slot projection). That fork is deleted: defineComponent's
 * connectedCallback is the ONE connect path and chooses its renderer —
 * `_hydrate` when the host carries the server's `data-aihu-ssr` template
 * marker (and a hydrate fn is wired), `_mount` otherwise.
 *
 * These tests pin the marker semantics in both directions:
 *   - marked host → children are the component's OWN server-rendered
 *     template: adopted in place (hydrate), or DISCARDED when adoption is
 *     impossible — never slot-projected.
 *   - unmarked host → children are the slot-projection source (Bug D carve),
 *     exactly as before.
 * And the lifecycle unification: onMount RUNS on adopted components.
 */

import { branch, leaf, mount } from '@aihu/arbor'
import { hydrate } from '@aihu/arbor/hydrate'
import { signal } from '@aihu/signals'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _setHydrate,
  _setMount,
  _setSignal,
  defineComponent,
  _onMount as onMount,
} from '../src/define-component.ts'
import { defineElement } from '../src/define-element.ts'
import { _ssrChildWrap, type SsrChildModule } from '../src/ssr-string.ts'
import type { SetupContext } from '../src/types.ts'

// ── Unique tag counter to avoid SCR-R0001 conflicts between tests ────────────
let tagCounter = 0
function nextTag(): string {
  return `x-hi${++tagCounter}`
}

// ── Wire real mount/signal so _build() tests work correctly ──────────────────
_setMount(mount)
_setSignal(signal as Parameters<typeof _setSignal>[0])

/** A light-DOM element pre-populated with a server-rendered template shape. */
function serverRenderedEl(tag: string, innerHTML = '<p data-aihu-path="0">srv</p>'): HTMLElement {
  const el = document.createElement(tag)
  el.setAttribute('data-aihu-ssr', '')
  el.innerHTML = innerHTML
  return el
}

const fakeScope = () => ({ dispose: vi.fn(), agent: {}, serialize: vi.fn() })

describe('First-render adoption — _build() and renderer choice', () => {
  // Restore __aihu_state__ after each test to avoid cross-test contamination.
  let originalState: unknown
  beforeEach(() => {
    originalState = (globalThis as Record<string, unknown>).__aihu_state__
  })
  afterEach(() => {
    ;(globalThis as Record<string, unknown>).__aihu_state__ = originalState
    _setHydrate(null)
    _setMount(mount)
  })

  // ── T-H3: _build() returns the correct node tree ──────────────────────────
  describe('T-H3: _build() on function-form defineComponent', () => {
    it('_build() is present on the class prototype', () => {
      const Cmp = defineComponent((_ctx: SetupContext) => leaf('check'))
      expect(typeof (Cmp.prototype as { _build?: unknown })._build).toBe('function')
    })

    it('connectedCallback delegates to _build() — captured tree matches setup output', () => {
      const expectedTree = leaf('hello hydration')
      let capturedTree: unknown = null

      const realMount = mount
      _setMount((tree, host) => {
        capturedTree = tree
        return realMount(tree, host)
      })

      const tag = nextTag()
      const Cmp = defineComponent((_ctx: SetupContext) => expectedTree)
      defineElement(tag, Cmp)

      const el = document.createElement(tag)
      document.body.appendChild(el)

      expect(capturedTree).toBe(expectedTree)
      el.remove()
      _setMount(mount)
    })

    it('_build() on options-form is present on the class prototype', () => {
      _setSignal(signal as Parameters<typeof _setSignal>[0])
      const Cmp = defineComponent({
        attrs: [] as const,
        setup: (_ctx) => leaf('opts'),
      })
      expect(typeof (Cmp.prototype as { _build?: unknown })._build).toBe('function')
    })

    it('options-form _build() output is passed to _mount via connectedCallback', () => {
      _setSignal(signal as Parameters<typeof _setSignal>[0])
      const expectedTree = leaf('opts hydration')
      let capturedTree: unknown = null

      const realMount = mount
      _setMount((tree, host) => {
        capturedTree = tree
        return realMount(tree, host)
      })

      const tag = nextTag()
      const Cmp = defineComponent({
        attrs: [] as const,
        setup: (_ctx) => expectedTree,
      })
      defineElement(tag, Cmp)

      const el = document.createElement(tag)
      document.body.appendChild(el)

      expect(capturedTree).toBe(expectedTree)
      el.remove()
      _setMount(mount)
    })
  })

  // ── T-A1: adoption path is taken when the host carries the marker ─────────
  it('T-A1: connectedCallback calls hydrateFn (not mountFn) on a marked light-DOM host', () => {
    const hydrateSpy = vi.fn().mockReturnValue(fakeScope())
    const mountSpy = vi.fn().mockReturnValue(fakeScope())
    _setHydrate(hydrateSpy as Parameters<typeof _setHydrate>[0])
    _setMount(mountSpy as Parameters<typeof _setMount>[0])

    const tag = nextTag()
    const Cmp = defineComponent((_ctx: SetupContext) => leaf('adopt-me'))
    defineElement(tag, Cmp, { shadowMode: 'light' })

    const el = serverRenderedEl(tag)
    document.body.appendChild(el)

    expect(hydrateSpy).toHaveBeenCalledTimes(1)
    expect(mountSpy).not.toHaveBeenCalled()
    // The server children were NOT carved out — they are the template being
    // adopted, so they must still be in place when hydrate runs.
    expect(el.querySelector('p')?.textContent).toBe('srv')

    el.remove()
  })

  it('T-A1b: adoption does NOT require a signal snapshot (static pages adopt too)', () => {
    const hydrateSpy = vi.fn().mockReturnValue(fakeScope())
    _setHydrate(hydrateSpy as Parameters<typeof _setHydrate>[0])

    const tag = nextTag()
    const Cmp = defineComponent((_ctx: SetupContext) => leaf('no-snapshot'))
    defineElement(tag, Cmp, { shadowMode: 'light' })
    // No __aihu_state__ at all.
    delete (globalThis as Record<string, unknown>).__aihu_state__

    const el = serverRenderedEl(tag)
    document.body.appendChild(el)

    expect(hydrateSpy).toHaveBeenCalledTimes(1)
    // Empty snapshot handed through.
    expect(hydrateSpy.mock.calls[0]![2]).toEqual({})
    el.remove()
  })

  it('T-A1c: a published __aihu_state__[tag] snapshot reaches hydrate', () => {
    const hydrateSpy = vi.fn().mockReturnValue(fakeScope())
    _setHydrate(hydrateSpy as Parameters<typeof _setHydrate>[0])

    const tag = nextTag()
    const Cmp = defineComponent((_ctx: SetupContext) => leaf('seeded'))
    defineElement(tag, Cmp, { shadowMode: 'light' })
    ;(globalThis as Record<string, unknown>).__aihu_state__ = {
      [tag]: { '0.text': 'seeded' },
    }

    const el = serverRenderedEl(tag)
    document.body.appendChild(el)

    expect(hydrateSpy).toHaveBeenCalledTimes(1)
    expect(hydrateSpy.mock.calls[0]![2]).toEqual({ '0.text': 'seeded' })
    el.remove()
  })

  // ── T-A2: unmarked hosts always mount ─────────────────────────────────────
  it('T-A2: connectedCallback falls through to _mount when the marker is absent — even with a snapshot present', () => {
    const hydrateSpy = vi.fn().mockReturnValue(fakeScope())
    const mountSpy = vi.fn().mockReturnValue(fakeScope())
    _setHydrate(hydrateSpy as Parameters<typeof _setHydrate>[0])
    _setMount(mountSpy as Parameters<typeof _setMount>[0])

    const tag = nextTag()
    const Cmp = defineComponent((_ctx: SetupContext) => leaf('no-marker'))
    defineElement(tag, Cmp, { shadowMode: 'light' })
    ;(globalThis as Record<string, unknown>).__aihu_state__ = {
      [tag]: { '0.text': 'no-marker' },
    }

    const el = document.createElement(tag)
    document.body.appendChild(el)

    expect(hydrateSpy).not.toHaveBeenCalled()
    expect(mountSpy).toHaveBeenCalledTimes(1)
    el.remove()
  })

  // ── T-A3: marked but unadoptable → template DISCARDED, never slotted ──────
  it('T-A3: with no hydrate fn wired, a marked host discards its server template and mounts fresh', () => {
    _setHydrate(null)
    _setMount(mount)

    const tag = nextTag()
    const Cmp = defineComponent((_ctx: SetupContext) =>
      branch('div', { class: 'fresh' }, [leaf('client')]),
    )
    defineElement(tag, Cmp, { shadowMode: 'light' })

    const el = serverRenderedEl(tag, '<div class="stale" data-aihu-path="0">stale</div>')
    document.body.appendChild(el)

    // The stale server template must be gone — NOT slot-projected after the
    // fresh mount (which would double-render the template).
    expect(el.querySelector('.stale')).toBeNull()
    expect(el.querySelector('.fresh')?.textContent).toBe('client')
    expect(el.textContent).toBe('client')
    el.remove()
  })

  it('T-A3b: a marked SHADOW host discards its light-DOM server template (no declarative shadow DOM to adopt)', () => {
    const hydrateSpy = vi.fn().mockReturnValue(fakeScope())
    _setHydrate(hydrateSpy as Parameters<typeof _setHydrate>[0])
    _setMount(mount)

    const tag = nextTag()
    const Cmp = defineComponent((_ctx: SetupContext) => leaf('shadow-client'))
    defineElement(tag, Cmp) // default shadowMode: 'shadow'

    const el = serverRenderedEl(tag, '<div class="stale">stale</div>')
    document.body.appendChild(el)

    expect(hydrateSpy).not.toHaveBeenCalled()
    // Light-DOM children removed so native <slot> projection can't render the
    // stale template beside the shadow tree.
    expect(el.childNodes.length).toBe(0)
    expect(el.shadowRoot?.textContent).toBe('shadow-client')
    el.remove()
  })

  // ── T-A4: onMount runs on adopted components ──────────────────────────────
  it('T-A4: onMount runs (and its teardown fires on disconnect) for an adopted component', () => {
    const realMount = mount
    const hydrateSpy = vi.fn((component: () => unknown, host: Element | ShadowRoot) => {
      // Real contract shape: consume the built tree, hand back a MountScope.
      return realMount(component() as Parameters<typeof realMount>[0], host)
    })
    _setHydrate(hydrateSpy as unknown as Parameters<typeof _setHydrate>[0])

    const mounted = vi.fn()
    const torndown = vi.fn()
    const tag = nextTag()
    const Cmp = defineComponent((_ctx: SetupContext) => {
      onMount(() => {
        mounted()
        return torndown
      })
      return leaf('lifecycle')
    })
    defineElement(tag, Cmp, { shadowMode: 'light' })

    const el = serverRenderedEl(tag)
    document.body.appendChild(el)

    expect(hydrateSpy).toHaveBeenCalledTimes(1)
    expect(mounted).toHaveBeenCalledTimes(1)
    expect(torndown).not.toHaveBeenCalled()

    el.remove()
    expect(torndown).toHaveBeenCalledTimes(1)
  })

  // ── T-A5: adopted scope's dispose clears the host for a clean reconnect ───
  it('T-A5: disconnect after adoption clears the adopted children (reconnect re-renders fresh)', () => {
    const inner = fakeScope()
    const hydrateSpy = vi.fn().mockReturnValue(inner)
    _setHydrate(hydrateSpy as Parameters<typeof _setHydrate>[0])

    const tag = nextTag()
    const Cmp = defineComponent((_ctx: SetupContext) => leaf('cleared'))
    defineElement(tag, Cmp, { shadowMode: 'light' })

    const el = serverRenderedEl(tag)
    document.body.appendChild(el)
    expect(el.childNodes.length).toBeGreaterThan(0)

    el.remove()
    expect(inner.dispose).toHaveBeenCalledTimes(1)
    // DOM removal parity with mount(): the adopted subtree does not survive
    // its scope. A reconnect then starts from an empty host (hydrate's
    // mismatch fallback materializes fresh — a clean mount).
    expect(el.childNodes.length).toBe(0)
  })

  // ── T-A6: slot projection still works for unmarked light-DOM hosts ────────
  it('T-A6: unmarked light-DOM children are still carved and slot-projected (Bug D unchanged)', () => {
    _setHydrate(vi.fn().mockReturnValue(fakeScope()) as Parameters<typeof _setHydrate>[0])
    _setMount(mount)

    const tag = nextTag()
    const Cmp = defineComponent((_ctx: SetupContext) =>
      branch('div', { class: 'layout' }, [
        branch('slot', undefined, []) as unknown as ReturnType<typeof leaf>,
      ]),
    )
    defineElement(tag, Cmp, { shadowMode: 'light' })

    const el = document.createElement(tag)
    // User-slotted content — note it may even carry data-aihu-path markers
    // (slotted content that itself came from a parent's server render does);
    // only the HOST marker decides, so this must still project.
    el.innerHTML = '<span data-aihu-path="0.1.0">slotted</span>'
    document.body.appendChild(el)

    const layout = el.querySelector('.layout')
    expect(layout).not.toBeNull()
    // The slotted span was routed into the layout's <slot> position.
    expect(layout?.querySelector('span')?.textContent).toBe('slotted')
    expect(el.querySelectorAll('span').length).toBe(1)
    el.remove()
  })

  // ── connectedCallback still works normally after the refactor ─────────────
  it('normal mount path still produces reactive DOM after the _build() refactor', () => {
    _setMount(mount)
    const tag = nextTag()
    const [sig, setSig] = signal('initial')
    const Cmp = defineComponent(() => branch('p', undefined, [leaf([sig, setSig])]))
    defineElement(tag, Cmp)

    const el = document.createElement(tag)
    document.body.appendChild(el)

    const p = el.shadowRoot?.querySelector('p') as HTMLElement
    expect(p?.textContent).toBe('initial')

    setSig('updated')
    expect(p?.textContent).toBe('updated')

    el.remove()
  })
})

describe('First-render adoption — light-DOM slot projection through top-level hydrate', () => {
  it('projects original light children after adopting server output', () => {
    const tag = nextTag()
    const module: SsrChildModule = { __ssrString: () => '', __aihu_shadow__: 'light' }
    const serverHtml = _ssrChildWrap(
      tag,
      '',
      module,
      '<h1 slot="header">Title</h1><main data-aihu-path="0"><slot data-aihu-path="0.0" name="header"><b>Fallback</b></slot></main>',
      true,
    )
    const parsed = document.createElement('div')
    parsed.innerHTML = serverHtml
    const host = parsed.firstElementChild as HTMLElement
    const Component = defineComponent(() =>
      branch('main', undefined, [
        branch('slot', { name: 'header' }, [branch('b', undefined, [leaf('Fallback')])]),
      ]),
    )
    defineElement(tag, Component, { shadowMode: 'light' })
    _setHydrate(hydrate)

    document.body.appendChild(host)

    expect(host.querySelector('slot')).toBeNull()
    expect(host.querySelectorAll('h1[slot="header"]')).toHaveLength(1)
    expect(host.querySelector('main')?.textContent).toBe('Title')
    expect(host.textContent).toBe('Title')

    host.remove()
    _setHydrate(null)
  })
})
