/**
 * Unit tests for `defineComponent` per
 * `.team/phase-4/spec-runtime.md` §1.5 + Phase 4 builder brief.
 *
 * `defineComponent` returns a class consumable by `defineElement`.
 * Internally it calls `setup(ctx)` in `connectedCallback`, mounts the
 * resulting tree via the injected `mount` function, and disposes the
 * resulting `MountScope` in `disconnectedCallback`.
 *
 * Spec §2.4: runtime has no source-level *value* imports from
 * `@aihu/arbor`. Tests inject `mount` via `_setMount(mount)` (the
 * same hook real apps use at boot).
 */

import { branch, leaf, mount } from '@aihu/arbor'
import type { Signal } from '@aihu/signals'
import { signal } from '@aihu/signals'
import { describe, expect, it, vi } from 'vitest'
import { _setMount, _setSignal, defineComponent } from '../src/define-component.ts'
import { defineElement } from '../src/define-element.ts'
import type { SetupContext } from '../src/types.ts'
import { RuntimeError } from '../src/types.ts'

// Wire mount once for all tests in this file.
_setMount(mount)

describe('defineComponent — Task 21b spec tests', () => {
  it('returned class registers via defineElement without error (#1)', () => {
    const Cmp = defineComponent(({ host: _host }) => leaf('hi'))
    expect(() => defineElement('x-c1', Cmp)).not.toThrow()
    expect(customElements.get('x-c1')).toBeDefined()
  })

  it('setup(ctx) runs once in connectedCallback (#2)', () => {
    let captured: SetupContext | null = null
    const setup = vi.fn((ctx: SetupContext) => {
      captured = ctx
      return leaf('hello')
    })
    const Cmp = defineComponent(setup)
    defineElement('x-c2', Cmp)
    expect(setup).not.toHaveBeenCalled()
    const el = document.createElement('x-c2')
    document.body.appendChild(el)
    expect(setup).toHaveBeenCalledTimes(1)
    expect(captured).not.toBeNull()
    expect((captured as SetupContext | null)?.element).toBe(el)
    expect((captured as SetupContext | null)?.host).toBe(el.shadowRoot)
    el.remove()
  })

  it('effects created during setup are auto-disposed when element is removed (#3)', () => {
    const sig = signal('a')
    const setText = sig[1]
    const Cmp = defineComponent(() => branch('p', undefined, [leaf(sig)]))
    defineElement('x-c3', Cmp)
    const el = document.createElement('x-c3')
    document.body.appendChild(el)
    const p = el.shadowRoot?.querySelector('p') as HTMLElement
    expect(p.textContent).toBe('a')
    setText('b')
    expect(p.textContent).toBe('b')
    // Capture text node reference to assert it does not update post-remove.
    const captured = p
    el.remove()
    setText('c')
    // After dispose, the effect that wrote text is torn down — captured
    // node's textContent stays at 'b'.
    expect(captured.textContent).toBe('b')
  })

  it('disconnectedCallback calls scope.dispose() (#4)', () => {
    const disposeSpy = vi.fn()
    // Inject a fake mount that records dispose.
    const realMount = mount
    _setMount((node, host) => {
      const scope = realMount(node, host)
      const origDispose = scope.dispose.bind(scope)
      return {
        ...scope,
        dispose() {
          disposeSpy()
          origDispose()
        },
      }
    })
    const Cmp = defineComponent(() => leaf('x'))
    defineElement('x-c4', Cmp)
    const el = document.createElement('x-c4')
    document.body.appendChild(el)
    expect(disposeSpy).not.toHaveBeenCalled()
    el.remove()
    expect(disposeSpy).toHaveBeenCalledTimes(1)
    // Restore real mount for any subsequent file/test.
    _setMount(realMount)
  })
})

describe('defineComponent — Plan 1.2 props tests', () => {
  // T1: function-form still returns an HTMLElement class (no regression)
  it('T1: defineComponent(setup) function-form still returns an HTMLElement class', () => {
    const Cmp = defineComponent(({ host: _host }) => leaf('t1'))
    // The returned class must be a subclass of HTMLElement
    expect(Object.prototype.isPrototypeOf.call(HTMLElement, Cmp)).toBe(true)
    // Confirm it has no observedAttributes (function-form never sets them)
    expect((Cmp as { observedAttributes?: string[] }).observedAttributes).toBeUndefined()
  })

  // T2: options-form sets static observedAttributes
  it('T2: defineComponent({ attrs, setup }) sets static observedAttributes', () => {
    const Cmp = defineComponent({
      attrs: ['count'] as const,
      setup: (_ctx) => leaf('t2'),
    })
    expect((Cmp as { observedAttributes?: string[] }).observedAttributes).toEqual(['count'])
  })

  // T3: after connectedCallback, ctx.attrs.count is a Signal<string> readable
  it('T3: after connectedCallback, ctx.attrs.count is a Signal<string> readable', () => {
    // Wire signal factory
    _setSignal(signal)
    let capturedAttrSignal: Signal<string> | null = null
    const Cmp = defineComponent({
      attrs: ['count'] as const,
      setup: (ctx) => {
        const typedCtx = ctx as unknown as { attrs: { count: Signal<string> } }
        capturedAttrSignal = typedCtx.attrs.count
        // Pass the full Signal tuple to leaf (Signal<string> | string)
        return leaf(capturedAttrSignal!)
      },
    })
    defineElement('x-p3', Cmp)
    const el = document.createElement('x-p3')
    el.setAttribute('count', '42')
    document.body.appendChild(el)
    // The signal should be readable and return the initial attribute value
    expect(capturedAttrSignal).not.toBeNull()
    expect(capturedAttrSignal![0]()).toBe('42')
    // The rendered text content should also be '42'
    expect(el.shadowRoot?.textContent).toBe('42')
    el.remove()
  })

  // T4: attributeChangedCallback drives the signal setter
  it('T4: attributeChangedCallback updates ctx.attrs.count signal', () => {
    _setSignal(signal)
    let capturedSignal: Signal<string> | null = null
    const Cmp = defineComponent({
      attrs: ['count'] as const,
      setup: (ctx) => {
        const typedCtx = ctx as unknown as { attrs: { count: Signal<string> } }
        capturedSignal = typedCtx.attrs.count
        return leaf(capturedSignal!)
      },
    })
    defineElement('x-p4', Cmp)
    const el = document.createElement('x-p4')
    el.setAttribute('count', '0')
    document.body.appendChild(el)
    expect(capturedSignal).not.toBeNull()
    expect(capturedSignal![0]()).toBe('0')
    el.setAttribute('count', '5')
    expect(capturedSignal![0]()).toBe('5')
    el.remove()
  })

  // T5: _setSignal not called before connect of an attrs-using component → RuntimeError
  it('T5: missing _setSignal before connect of attrs component throws RuntimeError', () => {
    // Reset signal injection to simulate "not called" state.
    _setSignal(null as unknown as typeof signal)

    const Cmp = defineComponent({
      attrs: ['x'] as const,
      setup: (_ctx) => leaf('t5'),
    })
    // Instantiate the element and call connectedCallback directly to bypass
    // jsdom's error-swallowing in appendChild (jsdom turns synchronous
    // connectedCallback throws into unhandled exceptions rather than
    // propagating them through appendChild).
    const el = Object.create(Cmp.prototype) as InstanceType<typeof Cmp> & {
      connectedCallback(): void
    }
    expect(() => el.connectedCallback()).toThrow(RuntimeError)

    // Restore signal injection for subsequent tests.
    _setSignal(signal)
  })

  // T6: two independent Signal<string> values; changing a does not affect b
  it('T6: multiple attrs produce independent signals', () => {
    _setSignal(signal)
    let sigA: Signal<string> | null = null
    let sigB: Signal<string> | null = null
    const Cmp = defineComponent({
      attrs: ['a', 'b'] as const,
      setup: (ctx) => {
        const typedCtx = ctx as unknown as { attrs: { a: Signal<string>; b: Signal<string> } }
        sigA = typedCtx.attrs.a
        sigB = typedCtx.attrs.b
        return leaf('t6')
      },
    })
    defineElement('x-p6', Cmp)
    const el = document.createElement('x-p6')
    el.setAttribute('a', 'alpha')
    el.setAttribute('b', 'beta')
    document.body.appendChild(el)
    expect(sigA).not.toBeNull()
    expect(sigB).not.toBeNull()
    expect(sigA![0]()).toBe('alpha')
    expect(sigB![0]()).toBe('beta')
    // Change 'a' — 'b' must be unaffected
    el.setAttribute('a', 'changed')
    expect(sigA![0]()).toBe('changed')
    expect(sigB![0]()).toBe('beta')
    el.remove()
  })

  // T7: options-form without attrs does not require _setSignal
  it('T7: options-form without attrs connects without _setSignal', () => {
    _setSignal(null as unknown as typeof signal)
    const Cmp = defineComponent({
      setup: (_ctx) => leaf('no-attrs'),
    })
    defineElement('x-p7', Cmp)
    const el = document.createElement('x-p7')
    expect(() => document.body.appendChild(el)).not.toThrow()
    el.remove()
    _setSignal(signal)
  })
})

// ─── R1 — $prop reactivity (template-syntax-v2 round 5, Builder B1) ──────────
//
// Surface: defineComponent({ props: { name: { value, attribute, reflect, converter } }, setup })
// Acceptance criteria from director-notes/template-syntax-005.md §5 (B1):
//   AC5  attribute mutation flows to signal       (R1-AC5)
//   AC6  attribute: false skips observedAttributes (R1-AC6)
//   AC7  reflect: true writes attribute on set    (R1-AC7)
//   AC8  converter Date round-trip                (R1-AC8)
//   AC10 fine-grained signal preserved            (R1-AC10)
//   AC11 attribute: false + reflect: true rejected (R1-AC11)
describe('defineComponent — R1 ($prop reactivity)', () => {
  it('receives compiler-marked callback and value props before the child connects', () => {
    _setSignal(signal)
    const onSave = vi.fn()
    const back = vi.fn()
    let propsAtSetup: Record<string, unknown> | null = null
    const Cmp = defineComponent({
      props: {
        onSave: { value: () => undefined, attribute: false },
        back: { value: () => undefined, attribute: false },
        label: { value: '', attribute: false },
      },
      setup: (ctx) => {
        propsAtSetup = {
          onSave: ctx.props.onSave!(),
          back: ctx.props.back!(),
          label: ctx.props.label!(),
        }
        return leaf('callback boundary')
      },
    })
    defineElement('x-callback-prop-boundary', Cmp, { shadowMode: 'light' })

    const host = document.createElement('div')
    document.body.appendChild(host)
    const scope = mount(
      branch(
        'x-callback-prop-boundary',
        {
          '__aihu_prop:onSave': onSave,
          '__aihu_prop:back': back,
          '__aihu_prop:label': 'from parent',
        },
        [],
      ),
      host,
    )
    const el = host.querySelector('x-callback-prop-boundary') as HTMLElement & {
      onSave: () => void
      back: () => void
      label: string
    }

    expect(el.onSave).toBe(onSave)
    expect(el.back).toBe(back)
    expect(el.label).toBe('from parent')
    expect(propsAtSetup).toEqual({ onSave, back, label: 'from parent' })
    el.onSave()
    el.back()
    expect(onSave).toHaveBeenCalledOnce()
    expect(back).toHaveBeenCalledOnce()

    scope.dispose()
    host.remove()
  })

  it('R1-AC5: setAttribute → ctx.props.<name>() updates the signal', () => {
    _setSignal(signal)
    let captured: (() => unknown) | null = null
    const Cmp = defineComponent({
      props: { name: { value: 'default' } },
      setup: (ctx) => {
        captured = ctx.props.name as () => unknown
        return leaf('ac5')
      },
    })
    defineElement('x-r1-ac5', Cmp)
    const el = document.createElement('x-r1-ac5')
    document.body.appendChild(el)
    expect(captured).not.toBeNull()
    expect(captured!()).toBe('default')
    el.setAttribute('name', 'after')
    expect(captured!()).toBe('after')
    el.remove()
  })

  it('R1-AC6: attribute: false omits the prop from observedAttributes', () => {
    const Cmp = defineComponent({
      props: {
        title: { value: '' }, // observed (default)
        user: { value: null, attribute: false }, // property-only
      },
      setup: (_ctx) => leaf('ac6'),
    })
    const observed = (Cmp as { observedAttributes?: string[] }).observedAttributes ?? []
    expect(observed).toContain('title')
    expect(observed).not.toContain('user')
  })

  it('R1-AC7: reflect: true writes signal value back to attribute on .set', () => {
    _setSignal(signal)
    const Cmp = defineComponent({
      props: { count: { value: 0, reflect: true } },
      setup: (_ctx) => leaf('ac7'),
    })
    defineElement('x-r1-ac7', Cmp)
    const el = document.createElement('x-r1-ac7') as HTMLElement & { count: number }
    document.body.appendChild(el)
    expect(el.getAttribute('count')).toBe(null) // initial absence
    el.count = 5
    expect(el.getAttribute('count')).toBe('5')
    el.count = 12
    expect(el.getAttribute('count')).toBe('12')
    el.remove()
  })

  it('R1-AC8: converter round-trips an ISO Date attribute', () => {
    _setSignal(signal)
    let dateProp: (() => unknown) | null = null
    const Cmp = defineComponent({
      props: {
        date: {
          value: new Date(0),
          converter: (s: string | null) => (s !== null ? new Date(s) : new Date(0)),
        },
      },
      setup: (ctx) => {
        dateProp = ctx.props.date as () => unknown
        return leaf('ac8')
      },
    })
    defineElement('x-r1-ac8', Cmp)
    const el = document.createElement('x-r1-ac8')
    el.setAttribute('date', '2026-01-15T00:00:00.000Z')
    document.body.appendChild(el)
    expect(dateProp).not.toBeNull()
    const v = dateProp!() as Date
    expect(v).toBeInstanceOf(Date)
    expect(v.toISOString()).toBe('2026-01-15T00:00:00.000Z')
    el.setAttribute('date', '2027-06-20T12:00:00.000Z')
    expect((dateProp!() as Date).toISOString()).toBe('2027-06-20T12:00:00.000Z')
    el.remove()
  })

  it('R1-AC10: prop signal is fine-grained — derived computed updates only when prop changes', () => {
    _setSignal(signal)
    let captured: (() => unknown) | null = null
    const Cmp = defineComponent({
      props: { color: { value: 'red' } },
      setup: (ctx) => {
        captured = ctx.props.color as () => unknown
        return leaf('ac10')
      },
    })
    defineElement('x-r1-ac10', Cmp)
    const el = document.createElement('x-r1-ac10')
    el.setAttribute('color', 'blue')
    document.body.appendChild(el)
    expect(captured!()).toBe('blue')
    // The signal getter is the same reference across reads (callable
    // signal). Subscribing through it tracks fine-grained changes.
    el.setAttribute('color', 'green')
    expect(captured!()).toBe('green')
    // Setting a different attribute does NOT trigger the color signal.
    el.setAttribute('unrelated', '1')
    expect(captured!()).toBe('green')
    el.remove()
  })

  it('R1-AC11: attribute: false + reflect: true throws RuntimeError at class build', () => {
    expect(() =>
      defineComponent({
        props: { x: { value: 5, attribute: false, reflect: true } },
        setup: (_ctx) => leaf('ac11'),
      }),
    ).toThrow(RuntimeError)
  })

  it('R1: number type-conversion via default-typed default value', () => {
    _setSignal(signal)
    let captured: (() => unknown) | null = null
    const Cmp = defineComponent({
      props: { count: { value: 0 } }, // typeof default === 'number' → Number coercion
      setup: (ctx) => {
        captured = ctx.props.count as () => unknown
        return leaf('num')
      },
    })
    defineElement('x-r1-num', Cmp)
    const el = document.createElement('x-r1-num')
    el.setAttribute('count', '42')
    document.body.appendChild(el)
    expect(captured!()).toBe(42)
    el.setAttribute('count', '7')
    expect(captured!()).toBe(7)
    // NaN-guard: bad numeric attribute falls back to default.
    el.setAttribute('count', 'not-a-number')
    expect(captured!()).toBe(0)
    el.remove()
  })

  it('R1: boolean prop uses presence-based conversion', () => {
    _setSignal(signal)
    let captured: (() => unknown) | null = null
    const Cmp = defineComponent({
      props: { open: { value: false, reflect: true } },
      setup: (ctx) => {
        captured = ctx.props.open as () => unknown
        return leaf('bool')
      },
    })
    defineElement('x-r1-bool', Cmp)
    const el = document.createElement('x-r1-bool') as HTMLElement & { open: boolean }
    document.body.appendChild(el)
    expect(captured!()).toBe(false)
    el.setAttribute('open', '')
    expect(captured!()).toBe(true)
    el.removeAttribute('open')
    expect(captured!()).toBe(false)
    // Reflect: setting the property writes the attribute (presence convention).
    el.open = true
    expect(el.hasAttribute('open')).toBe(true)
    el.open = false
    expect(el.hasAttribute('open')).toBe(false)
    el.remove()
  })

  it('R1: attribute: "kebab-name" overrides the default kebab mapping', () => {
    _setSignal(signal)
    const Cmp = defineComponent({
      props: { user: { value: null, attribute: 'data-user' } },
      setup: (_ctx) => leaf('alias'),
    })
    const observed = (Cmp as { observedAttributes?: string[] }).observedAttributes ?? []
    expect(observed).toContain('data-user')
    expect(observed).not.toContain('user')
  })

  it('R1: default kebab-cased attribute name (myProp → my-prop)', () => {
    const Cmp = defineComponent({
      props: { myProp: { value: '' } },
      setup: (_ctx) => leaf('kebab'),
    })
    const observed = (Cmp as { observedAttributes?: string[] }).observedAttributes ?? []
    expect(observed).toContain('my-prop')
  })

  it('R1: el.prop = v flows through .set (property accessor wired)', () => {
    _setSignal(signal)
    let captured: (() => unknown) | null = null
    const Cmp = defineComponent({
      props: { count: { value: 0 } },
      setup: (ctx) => {
        captured = ctx.props.count as () => unknown
        return leaf('accessor')
      },
    })
    defineElement('x-r1-accessor', Cmp)
    const el = document.createElement('x-r1-accessor') as HTMLElement & { count: number }
    document.body.appendChild(el)
    expect(captured!()).toBe(0)
    el.count = 99
    expect(captured!()).toBe(99)
    // Read-back via accessor.
    expect(el.count).toBe(99)
    el.remove()
  })

  it('R1: reflect re-entrancy guard — setting via .set does not double-fire', () => {
    _setSignal(signal)
    let setCount = 0
    const Cmp = defineComponent({
      props: { tag: { value: '', reflect: true } },
      setup: (ctx) => {
        const tagSig = ctx.props.tag!
        const orig = tagSig.set
        tagSig.set = (v: unknown) => {
          setCount++
          orig.call(tagSig, v)
        }
        return leaf('reentry')
      },
    })
    defineElement('x-r1-reentry', Cmp)
    const el = document.createElement('x-r1-reentry') as HTMLElement & { tag: string }
    document.body.appendChild(el)
    setCount = 0
    el.tag = 'hello'
    // Exactly one set: external assignment. The attribute write that follows
    // re-enters attributeChangedCallback, but the reflect guard suppresses
    // the inner ps.set re-dispatch → setCount stays at 1.
    expect(setCount).toBe(1)
    expect(el.getAttribute('tag')).toBe('hello')
    el.remove()
  })
})

// ─── Bug: pre-connect reactive $prop binding dropped ─────────────────────────
//
// Root cause: arbor's _materialize applies reactive `$prop` bindings via
// `el.prop = v` the instant the element is created — BEFORE it is appended /
// connected. At that point the prop setter ran `this[PROPS_SYM]?.[name]?.set(v)`
// but PROPS_SYM is null until _build() (called from connectedCallback), so the
// optional-chain no-opped and the write was silently dropped. _build() then
// seeded the signal from getAttribute (never set — property path was taken) →
// the prop reverted to its declared default. For static content whose source
// signal never changes after mount, the bound value never arrived.
//
// Fix: buffer pre-connect property writes per prop, then drain them in _build()
// where the buffered value takes precedence over the attribute/default fallback
// (no stringification — non-string props survive intact).
//
// These tests reproduce the arbor pre-connect ordering directly: assign the
// property to a created-but-not-yet-connected element, THEN append it. They
// also cover the layout-`<slot>` shape (the element is a child appended into a
// wrapper before the wrapper connects) and the nested-direct shape.
describe('defineComponent — pre-connect reactive $prop binding', () => {
  it('PC1 (nested-direct): $prop set before connect arrives at first render', () => {
    _setSignal(signal)
    let captured: (() => unknown) | null = null
    // Render the prop reactively by wrapping its getter in a Signal tuple so the
    // shadow DOM reflects the value (leaf() consumes a [read, write] tuple).
    const Cmp = defineComponent({
      props: { body: { value: '' } },
      setup: (ctx) => {
        captured = ctx.props.body as () => unknown
        const render: Signal<string> = [
          ctx.props.body as () => string,
          () => {},
        ] as unknown as Signal<string>
        return leaf(render)
      },
    })
    defineElement('x-pc1', Cmp)
    // Pre-connect property write (what arbor's _materialize does via el.prop=v
    // before host.appendChild).
    const el = document.createElement('x-pc1') as HTMLElement & { body: string }
    el.body = '<p>hello</p>'
    expect(el.isConnected).toBe(false)
    // Now connect — _build() must seed the signal from the buffered write.
    document.body.appendChild(el)
    expect(captured).not.toBeNull()
    // Prop value present at first render (setup captured it during _build()).
    expect(captured!()).toBe('<p>hello</p>')
    // And the rendered shadow DOM reflects it (not the '' default).
    expect(el.shadowRoot?.textContent).toBe('<p>hello</p>')
    el.remove()
  })

  it('PC0 (pre-define): $prop set before the tag is defined survives the upgrade', () => {
    // One step earlier than PC1. PC1 writes after define() but before connect —
    // the accessor exists, so the write buffers. Here the write happens BEFORE
    // define(), the lazy/async-import case: the tag renders and is written to
    // before its chunk lands. With no accessor yet, `el.body = …` lands as an
    // OWN property that SHADOWS the accessor once the element upgrades — the
    // setter never runs and the prop reverts to its default. The constructor's
    // upgrade rescue must reclaim it.
    _setSignal(signal)
    _setMount(mount)
    let captured: (() => unknown) | null = null
    const Cmp = defineComponent({
      props: { body: { value: 'DEFAULT' } },
      setup: (ctx) => {
        captured = ctx.props.body as () => unknown
        return branch('div', undefined, [leaf('x')])
      },
    })

    // Element exists and is written to BEFORE its tag is defined.
    const el = document.createElement('x-pc0') as HTMLElement & { body: string }
    document.body.appendChild(el)
    el.body = '<p>real</p>'
    expect(Object.hasOwn(el, 'body')).toBe(true) // shadowing own prop, pre-upgrade

    // The chunk lands: define + upgrade. The rescue must reclaim the own prop.
    defineElement('x-pc0', Cmp)
    customElements.upgrade(el)

    expect(Object.hasOwn(el, 'body')).toBe(false) // own prop deleted by the rescue
    expect(captured).not.toBeNull()
    expect(captured!()).toBe('<p>real</p>') // not 'DEFAULT'
    el.remove()
  })

  it('PC2 (slotted): child given $prop before its wrapper connects gets the value', () => {
    _setSignal(signal)
    let captured: (() => unknown) | null = null
    const Cmp = defineComponent({
      props: { body: { value: '' } },
      setup: (ctx) => {
        captured = ctx.props.body as () => unknown
        const render: Signal<string> = [
          ctx.props.body as () => string,
          () => {},
        ] as unknown as Signal<string>
        return leaf(render)
      },
    })
    defineElement('x-pc2', Cmp)
    // Build the child detached, write its prop, then nest it inside a wrapper
    // that is itself detached — mirroring a layout <slot>: the whole subtree
    // is assembled before being attached to the document. The child does not
    // connect until the wrapper is appended to the live document.
    const child = document.createElement('x-pc2') as HTMLElement & { body: string }
    child.body = 'slotted-content'
    const wrapper = document.createElement('div')
    wrapper.appendChild(child)
    expect(child.isConnected).toBe(false) // still detached — _build() not run yet
    document.body.appendChild(wrapper) // NOW child connects → _build() drains buffer
    expect(captured).not.toBeNull()
    expect(captured!()).toBe('slotted-content')
    expect(child.shadowRoot?.textContent).toBe('slotted-content')
    child.remove()
  })

  it('PC3 (static-never-changes): bound value persists; default never wins', () => {
    _setSignal(signal)
    let captured: (() => unknown) | null = null
    const Cmp = defineComponent({
      props: { body: { value: 'DEFAULT' } },
      setup: (ctx) => {
        captured = ctx.props.body as () => unknown
        return leaf('pc3')
      },
    })
    defineElement('x-pc3', Cmp)
    const el = document.createElement('x-pc3') as HTMLElement & { body: string }
    el.body = 'static-once'
    document.body.appendChild(el)
    // No further writes (static content / signal never re-fires). The prop must
    // equal the initial bound value permanently — NOT the declared default.
    expect(captured!()).toBe('static-once')
    expect(captured!()).not.toBe('DEFAULT')
    el.remove()
  })

  it('PC4 (non-string object): pre-connect object prop arrives intact (no stringification)', () => {
    _setSignal(signal)
    let captured: (() => unknown) | null = null
    const obj = { items: [1, 2, 3], nested: { ok: true } }
    const Cmp = defineComponent({
      props: { data: { value: null } },
      setup: (ctx) => {
        captured = ctx.props.data as () => unknown
        return leaf('obj')
      },
    })
    defineElement('x-pc4', Cmp)
    const el = document.createElement('x-pc4') as HTMLElement & { data: unknown }
    el.data = obj
    document.body.appendChild(el)
    // Same object reference — proves no JSON round-trip / String() coercion.
    expect(captured!()).toBe(obj)
    expect((captured!() as typeof obj).items).toEqual([1, 2, 3])
    el.remove()
  })

  it('PC5 (non-string function): pre-connect function prop arrives intact', () => {
    _setSignal(signal)
    let captured: (() => unknown) | null = null
    const fn = (): string => 'callback-result'
    const Cmp = defineComponent({
      props: { onpick: { value: null, attribute: false } },
      setup: (ctx) => {
        captured = ctx.props.onpick as () => unknown
        return leaf('fn')
      },
    })
    defineElement('x-pc5', Cmp)
    const el = document.createElement('x-pc5') as HTMLElement & { onpick: unknown }
    el.onpick = fn
    document.body.appendChild(el)
    expect(captured!()).toBe(fn)
    expect((captured!() as () => string)()).toBe('callback-result')
    el.remove()
  })

  it('PC6 (non-string array): pre-connect array prop arrives intact', () => {
    _setSignal(signal)
    let captured: (() => unknown) | null = null
    const arr = [{ id: 1 }, { id: 2 }]
    const Cmp = defineComponent({
      props: { rows: { value: null, attribute: false } },
      setup: (ctx) => {
        captured = ctx.props.rows as () => unknown
        return leaf('arr')
      },
    })
    defineElement('x-pc6', Cmp)
    const el = document.createElement('x-pc6') as HTMLElement & { rows: unknown }
    el.rows = arr
    document.body.appendChild(el)
    expect(captured!()).toBe(arr)
    el.remove()
  })

  it('PC7: post-mount signal updates still propagate after a pre-connect seed', () => {
    _setSignal(signal)
    let captured: (() => unknown) | null = null
    const Cmp = defineComponent({
      props: { body: { value: '' } },
      setup: (ctx) => {
        captured = ctx.props.body as () => unknown
        const render: Signal<string> = [
          ctx.props.body as () => string,
          () => {},
        ] as unknown as Signal<string>
        return leaf(render)
      },
    })
    defineElement('x-pc7', Cmp)
    const el = document.createElement('x-pc7') as HTMLElement & { body: string }
    el.body = 'first'
    document.body.appendChild(el)
    expect(captured!()).toBe('first')
    // A later (post-mount) write must still flow through the live signal.
    el.body = 'second'
    expect(captured!()).toBe('second')
    expect(el.shadowRoot?.textContent).toBe('second')
    el.remove()
  })

  it('PC8: default still applies when nothing is bound pre-connect', () => {
    _setSignal(signal)
    let captured: (() => unknown) | null = null
    const Cmp = defineComponent({
      props: { body: { value: 'FALLBACK' } },
      setup: (ctx) => {
        captured = ctx.props.body as () => unknown
        return leaf('pc8')
      },
    })
    defineElement('x-pc8', Cmp)
    const el = document.createElement('x-pc8')
    document.body.appendChild(el)
    expect(captured!()).toBe('FALLBACK')
    el.remove()
  })

  it('PC9: attribute set pre-connect still wins when no property write buffered', () => {
    _setSignal(signal)
    let captured: (() => unknown) | null = null
    const Cmp = defineComponent({
      props: { label: { value: 'def' } },
      setup: (ctx) => {
        captured = ctx.props.label as () => unknown
        return leaf('pc9')
      },
    })
    defineElement('x-pc9', Cmp)
    const el = document.createElement('x-pc9')
    el.setAttribute('label', 'from-attr')
    document.body.appendChild(el)
    expect(captured!()).toBe('from-attr')
    el.remove()
  })

  it('PC10: buffered property write takes precedence over a pre-connect attribute', () => {
    _setSignal(signal)
    let captured: (() => unknown) | null = null
    const Cmp = defineComponent({
      props: { label: { value: 'def' } },
      setup: (ctx) => {
        captured = ctx.props.label as () => unknown
        return leaf('pc10')
      },
    })
    defineElement('x-pc10', Cmp)
    const el = document.createElement('x-pc10') as HTMLElement & { label: string }
    el.setAttribute('label', 'from-attr')
    el.label = 'from-prop'
    document.body.appendChild(el)
    // The property binding (what the compiler emits for `label={...}`) wins.
    expect(captured!()).toBe('from-prop')
    el.remove()
  })
})

// Bug 6 (r1): a throw from setup()/render at mount used to escape into the
// platform custom-element-reactions queue — surfacing only as a bare anonymous
// "Uncaught" with NO component-tag attribution, and leaving the shadow root
// empty (the throw aborts before _mount runs). The fix wraps both
// connectedCallback bodies in catch-log-rethrow: console.error WITH the tag,
// then re-throw to preserve fail-loud behavior.
//
// As with T5 above, these tests instantiate via document.createElement(tag) +
// a DIRECT connectedCallback() call inside try/catch — jsdom turns synchronous
// connectedCallback throws into unhandled exceptions rather than propagating
// them through appendChild, so the direct call is how we observe the throw.
describe('defineComponent — Bug 6: surface setup throws with component tag', () => {
  it('B6-1: function-form setup-throws → console.error contains tag, rethrows, empty shadow', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const boom = () => {
        throw new ReferenceError('active is not defined')
      }
      const Cmp = defineComponent(() => boom())
      defineElement('x-b6-fn', Cmp)
      const el = document.createElement('x-b6-fn') as HTMLElement & { connectedCallback(): void }

      // The throw must still propagate (fail-loud preserved).
      expect(() => el.connectedCallback()).toThrow(ReferenceError)

      // console.error fired WITH the offending tag for attribution.
      expect(errSpy).toHaveBeenCalled()
      const loggedWithTag = errSpy.mock.calls.some(
        (args) => typeof args[0] === 'string' && args[0].includes('x-b6-fn'),
      )
      expect(loggedWithTag).toBe(true)

      // Shadow root is left empty (unchanged behavior — throw aborts before mount).
      expect(el.shadowRoot?.childNodes.length ?? 0).toBe(0)
    } finally {
      errSpy.mockRestore()
    }
  })

  it('B6-2: options/props-form setup-throws → console.error contains tag, rethrows, empty shadow', () => {
    _setSignal(signal)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const Cmp = defineComponent({
        props: { active: { value: '' } },
        setup: () => {
          throw new ReferenceError('active is not defined')
        },
      })
      defineElement('x-b6-props', Cmp)
      const el = document.createElement('x-b6-props') as HTMLElement & { connectedCallback(): void }

      expect(() => el.connectedCallback()).toThrow(ReferenceError)

      expect(errSpy).toHaveBeenCalled()
      const loggedWithTag = errSpy.mock.calls.some(
        (args) => typeof args[0] === 'string' && args[0].includes('x-b6-props'),
      )
      expect(loggedWithTag).toBe(true)

      expect(el.shadowRoot?.childNodes.length ?? 0).toBe(0)
    } finally {
      errSpy.mockRestore()
    }
  })

  it('B6-3: regression — SCR-R0002 invariant still propagates (catch does not swallow it)', () => {
    // SCR-R0002 ("no mount") is thrown BEFORE the try block, so it must still
    // propagate as a RuntimeError when _mount was never injected.
    const realMount = mount
    // Force the "no mount" state by resetting the injected mount to null.
    _setMount(null as unknown as typeof mount)
    try {
      const Cmp = defineComponent(() => leaf('never-mounts'))
      defineElement('x-b6-r0002', Cmp)
      const el = document.createElement('x-b6-r0002') as HTMLElement & { connectedCallback(): void }
      expect(() => el.connectedCallback()).toThrow(RuntimeError)
    } finally {
      // Restore mount injection for any subsequent file/test.
      _setMount(realMount)
    }
  })
})

describe('defineComponent — §9.4 recipe class-extension (base option)', () => {
  _setSignal(signal)

  /** A fake primitive base recording lifecycle + setting host ARIA. */
  function makeBase(log: string[]): typeof HTMLElement {
    class FakeBase extends HTMLElement {
      static readonly observedAttributes = ['checked']
      connectedCallback(): void {
        log.push('base:connect')
        this.setAttribute('role', 'checkbox')
        this.setAttribute('tabindex', '0')
      }
      disconnectedCallback(): void {
        log.push('base:disconnect')
      }
      attributeChangedCallback(name: string): void {
        log.push(`base:attr:${name}`)
      }
    }
    return FakeBase as unknown as typeof HTMLElement
  }

  it('extends the base, runs base.connectedCallback before mount, sets host ARIA', () => {
    const log: string[] = []
    const Base = makeBase(log)
    const Cmp = defineComponent({
      base: Base,
      props: { label: { value: 'x' } },
      setup: () => {
        log.push('setup')
        return leaf('content')
      },
    })
    defineElement('x-ext-1', Cmp, { shadowMode: 'light' })
    const el = document.createElement('x-ext-1')
    document.body.appendChild(el)
    // Base CC runs BEFORE setup (so a context-providing primitive registers
    // before its child pieces mount), and the host inherits the base's ARIA.
    expect(log).toEqual(['base:connect', 'setup'])
    expect(el.getAttribute('role')).toBe('checkbox')
    expect(el.getAttribute('tabindex')).toBe('0')
    expect(el instanceof Base).toBe(true)
    el.remove()
    expect(log).toContain('base:disconnect')
  })

  it("unions the base's observedAttributes and forwards attributeChangedCallback", () => {
    const log: string[] = []
    const Base = makeBase(log)
    const Cmp = defineComponent({
      base: Base,
      props: { size: { value: 'md' } },
      setup: () => leaf('c'),
    })
    // observedAttributes = props (`size`) ∪ base (`checked`).
    const observed = (Cmp as unknown as { observedAttributes: string[] }).observedAttributes
    expect(observed).toContain('size')
    expect(observed).toContain('checked')
    defineElement('x-ext-2', Cmp, { shadowMode: 'light' })
    const el = document.createElement('x-ext-2')
    document.body.appendChild(el)
    log.length = 0
    el.setAttribute('checked', '')
    // The base sees its own observed attribute change.
    expect(log).toContain('base:attr:checked')
    el.remove()
  })

  it('no base → ordinary HTMLElement component is unchanged (no base dispatch)', () => {
    const Cmp = defineComponent({ props: { a: { value: '1' } }, setup: () => leaf('c') })
    defineElement('x-ext-3', Cmp)
    const el = document.createElement('x-ext-3')
    expect(() => document.body.appendChild(el)).not.toThrow()
    expect(el.getAttribute('role')).toBeNull()
    el.remove()
  })
})
