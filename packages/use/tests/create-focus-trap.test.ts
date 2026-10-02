import { effectScope } from '@aihu/signals'
import { describe, expect, it, vi } from 'vitest'
import { createFocusTrap } from '../src/createFocusTrap/index.ts'
import { withSSR } from './_ssr.ts'

function dialog(): { root: HTMLElement; first: HTMLButtonElement; last: HTMLButtonElement } {
  const root = document.createElement('section')
  const first = document.createElement('button')
  const last = document.createElement('button')
  root.append(first, last)
  document.body.append(root)
  return { root, first, last }
}

describe('@aihu/use/createFocusTrap', () => {
  it('delegates focus entry and Tab wrapping to primitives, including open shadow descendants', () => {
    const { root } = dialog()
    const host = document.createElement('div')
    const shadow = host.attachShadow({ mode: 'open' })
    const first = document.createElement('button')
    const last = document.createElement('button')
    shadow.append(first, last)
    root.replaceChildren(host)

    const trap = createFocusTrap(root)
    trap.activate()
    expect(document.activeElement?.shadowRoot?.activeElement).toBe(first)

    last.focus()
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(event)
    expect(document.activeElement?.shadowRoot?.activeElement).toBe(first)
    expect(event.defaultPrevented).toBe(true)
    trap.deactivate()
  })

  it('supports initial/return targets, Escape, inert restoration, and scope cleanup', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const { root, last } = dialog()
    const background = document.createElement('main')
    background.inert = false
    document.body.append(background)
    const onEscape = vi.fn()
    const trap = createFocusTrap(root, {
      initialFocus: () => last,
      returnFocus: () => opener,
      inertTargets: [background],
      onEscape,
    })
    trap.activate()
    expect(document.activeElement).toBe(last)
    expect(background.inert).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onEscape).toHaveBeenCalledOnce()
    trap.deactivate()
    expect(background.inert).toBe(false)
    expect(document.activeElement).toBe(opener)

    const scoped = effectScope()
    const second = dialog().root
    const scopedTrap = scoped.run(() => createFocusTrap(second))!
    scopedTrap.activate()
    scoped.stop()
    expect(document.activeElement).toBe(opener)
  })

  it('restores focus and inert state when the dialog disconnects', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const { root } = dialog()
    const background = document.createElement('main')
    background.inert = false
    document.body.append(background)
    const onEscape = vi.fn()
    const trap = createFocusTrap(root, { inertTargets: [background], onEscape })
    trap.activate()
    expect(background.inert).toBe(true)
    root.remove()
    await Promise.resolve()
    await Promise.resolve()
    expect(background.inert).toBe(false)
    expect(document.activeElement).toBe(opener)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onEscape).not.toHaveBeenCalled()
    trap.deactivate()
  })

  it('falls back to the dialog when the original focus target is gone', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const { root } = dialog()
    const trap = createFocusTrap(root)
    trap.activate()
    opener.remove()
    trap.deactivate()
    expect(document.activeElement).toBe(root)
    expect(root.tabIndex).toBe(-1)
  })

  it('is an SSR no-op', async () =>
    withSSR(
      () => import('../src/createFocusTrap/index.ts'),
      ({ createFocusTrap: create }) => {
        const trap = create(null)
        expect(() => {
          trap.activate()
          trap.deactivate()
        }).not.toThrow()
      },
    ))
})
