/**
 * `createFocusTrap` options — the `initialFocus` / `returnFocus` surface added
 * so `@aihu/runtime`'s `<focusTrap initialFocus=… returnFocus=…>` template
 * primitive can delegate here instead of carrying a second, divergent
 * focus-trap implementation (FEL-397 / aihu-project/aihu#537).
 *
 * The default-option behavior (focus first tabbable, always restore) is
 * covered through `dialog-content` in `./apg.test.ts` / `./keyboard.test.ts`;
 * these tests pin the NEW public option semantics directly.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createFocusTrap } from './focus-trap.ts'

function mount(html: (root: HTMLElement) => void): HTMLElement {
  const container = document.createElement('div')
  html(container)
  document.body.appendChild(container)
  return container
}

function button(id: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.id = id
  return b
}

afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild)
})

describe('createFocusTrap — initialFocus', () => {
  it('focuses the first tabbable by default', () => {
    const container = mount((c) => {
      c.append(button('a'), button('b'), button('c'))
    })
    const trap = createFocusTrap(container)
    trap.activate()
    expect(document.activeElement?.id).toBe('a')
    trap.deactivate()
  })

  it('focuses the element matching the initialFocus selector instead', () => {
    const container = mount((c) => {
      c.append(button('a'), button('b'), button('c'))
    })
    const trap = createFocusTrap(container, { initialFocus: '#c' })
    trap.activate()
    expect(document.activeElement?.id).toBe('c')
    trap.deactivate()
  })

  it('falls back to the first tabbable when the selector matches nothing', () => {
    const container = mount((c) => {
      c.append(button('a'), button('b'))
    })
    const trap = createFocusTrap(container, { initialFocus: '#nope' })
    trap.activate()
    expect(document.activeElement?.id).toBe('a')
    trap.deactivate()
  })

  it('resolves the selector across an OPEN shadow boundary (composed subtree)', () => {
    const leafHost = document.createElement('div')
    const container = mount((c) => {
      c.append(button('a'), leafHost)
    })
    const shadow = leafHost.attachShadow({ mode: 'open' })
    const nested = button('nested')
    shadow.appendChild(nested)

    const trap = createFocusTrap(container, { initialFocus: '#nested' })
    trap.activate()
    // `container.querySelector('#nested')` is null — only a composed-tree walk
    // finds it.
    expect(container.querySelector('#nested')).toBeNull()
    expect(shadow.activeElement).toBe(nested)
    trap.deactivate()
  })

  it('treats a null initialFocus the same as omitting it', () => {
    const container = mount((c) => {
      c.append(button('a'), button('b'))
    })
    const trap = createFocusTrap(container, { initialFocus: null })
    trap.activate()
    expect(document.activeElement?.id).toBe('a')
    trap.deactivate()
  })
})

describe('createFocusTrap — returnFocus', () => {
  it('restores the previously-focused element on deactivate by default', () => {
    const opener = button('opener')
    document.body.appendChild(opener)
    const container = mount((c) => {
      c.append(button('a'))
    })
    opener.focus()
    expect(document.activeElement).toBe(opener)

    const trap = createFocusTrap(container)
    trap.activate()
    expect(document.activeElement?.id).toBe('a')
    trap.deactivate()
    expect(document.activeElement).toBe(opener)
  })

  it('leaves focus where it is when returnFocus is false', () => {
    const opener = button('opener')
    document.body.appendChild(opener)
    const container = mount((c) => {
      c.append(button('a'))
    })
    opener.focus()

    const trap = createFocusTrap(container, { returnFocus: false })
    trap.activate()
    expect(document.activeElement?.id).toBe('a')
    trap.deactivate()
    // Not yanked back to the opener.
    expect(document.activeElement?.id).toBe('a')
  })

  it('restores when returnFocus is explicitly true', () => {
    const opener = button('opener')
    document.body.appendChild(opener)
    const container = mount((c) => {
      c.append(button('a'))
    })
    opener.focus()

    const trap = createFocusTrap(container, { returnFocus: true })
    trap.activate()
    trap.deactivate()
    expect(document.activeElement).toBe(opener)
  })
})

describe('createFocusTrap — escape guard reachability (FEL-397)', () => {
  it('re-traps a forward Tab pressed while focus sits OUTSIDE the container', () => {
    const outside = button('outside')
    document.body.appendChild(outside)
    const container = mount((c) => {
      c.append(button('a'), button('b'))
    })

    const trap = createFocusTrap(container, { returnFocus: false })
    trap.activate()
    outside.focus()
    expect(document.activeElement).toBe(outside)

    const ev = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
      composed: true,
    })
    outside.dispatchEvent(ev)

    // The document-CAPTURE listener sees this keydown even though it
    // originated outside the container — which is precisely why the
    // `composedContains` escape check is a live branch rather than dead code
    // (a listener bound to the container itself would never have run at all).
    expect(ev.defaultPrevented).toBe(true)
    expect(document.activeElement?.id).toBe('a')
    trap.deactivate()
  })

  it('re-traps Shift+Tab pressed while focus sits OUTSIDE the container', () => {
    const outside = button('outside')
    document.body.appendChild(outside)
    const container = mount((c) => {
      c.append(button('a'), button('b'))
    })

    const trap = createFocusTrap(container, { returnFocus: false })
    trap.activate()
    outside.focus()

    const ev = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
      composed: true,
    })
    outside.dispatchEvent(ev)

    expect(ev.defaultPrevented).toBe(true)
    expect(document.activeElement?.id).toBe('b')
    trap.deactivate()
  })

  it('ignores Tab once its container is detached without deactivate()', () => {
    const container = mount((c) => {
      c.append(button('a'))
    })
    const trap = createFocusTrap(container)
    trap.activate()
    container.remove()

    const outside = button('outside')
    document.body.appendChild(outside)
    outside.focus()
    const ev = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
      composed: true,
    })
    outside.dispatchEvent(ev)

    // A stale document-level listener must not hijack Tab for the whole page.
    expect(ev.defaultPrevented).toBe(false)
    trap.deactivate()
  })
})
