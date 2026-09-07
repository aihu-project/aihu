import { position as corePosition } from '@aihu/arbor/progressive'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { anchorFallback, popoverFallback, portal, position } from '../src/runtime/progressive.ts'

/** Build an element whose getBoundingClientRect returns a fixed rect. */
function elementAt(rect: Partial<DOMRect>): HTMLElement {
  const el = document.createElement('div')
  const full: DOMRect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect
  el.getBoundingClientRect = () => full
  return el
}

/** A floating element with mocked offset dimensions (jsdom has no layout). */
function floatingEl(width: number, height: number): HTMLElement {
  const el = document.createElement('div')
  Object.defineProperty(el, 'offsetWidth', { value: width, configurable: true })
  Object.defineProperty(el, 'offsetHeight', { value: height, configurable: true })
  return el
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('@aihu/css-engine/runtime/progressive — positioning shim', () => {
  it('keeps position as a compatibility re-export of the core DOM utility', () => {
    expect(position).toBe(corePosition)
  })

  it('places the floating element below the anchor by default (+offset)', () => {
    // Anchor at (100,100) sized 50x20; floating 40x10; viewport large.
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true })
    const anchor = elementAt({
      left: 100,
      top: 100,
      right: 150,
      bottom: 120,
      width: 50,
      height: 20,
    })
    const floating = floatingEl(40, 10)

    const placement = position(anchor, floating, { offset: 4 })

    expect(placement).toBe('bottom')
    expect(floating.style.position).toBe('fixed')
    // y = anchor.bottom + offset = 120 + 4
    expect(floating.style.top).toBe('124px')
    // x = anchor.left + (anchor.width - floating.width)/2 = 100 + (50-40)/2 = 105
    expect(floating.style.left).toBe('105px')
  })

  it('flips to the opposite side when the preferred side overflows the viewport', () => {
    // Tiny viewport so bottom overflows; top fits.
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 130, configurable: true })
    const anchor = elementAt({
      left: 100,
      top: 100,
      right: 150,
      bottom: 120,
      width: 50,
      height: 20,
    })
    const floating = floatingEl(40, 50)

    const placement = position(anchor, floating, { placement: 'bottom', offset: 4 })

    // bottom would put y at 124 with height 50 → 174 > 130 (overflow) → flip to top.
    expect(placement).toBe('top')
  })

  it('anchorFallback applies position and returns a cleanup that removes listeners', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true })
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')

    const anchor = elementAt({ left: 10, top: 10, right: 60, bottom: 30, width: 50, height: 20 })
    const floating = floatingEl(20, 10)

    const cleanup = anchorFallback(anchor, floating)
    expect(floating.style.position).toBe('fixed')
    // wired scroll + resize listeners
    expect(add).toHaveBeenCalledWith('scroll', expect.any(Function), expect.any(Object))
    expect(add).toHaveBeenCalledWith('resize', expect.any(Function), expect.any(Object))

    cleanup()
    expect(remove).toHaveBeenCalledTimes(2)
  })
})

describe('@aihu/css-engine/runtime/progressive — popover/portal fallback', () => {
  it('portal moves the element to a top-layer container and restores it', () => {
    const host = document.createElement('section')
    const panel = document.createElement('div')
    host.appendChild(panel)
    document.body.appendChild(host)

    const restore = portal(panel)
    // Panel moved out of host into a body-level layer.
    expect(panel.parentElement).not.toBe(host)
    expect(panel.parentElement?.parentElement).toBe(document.body)

    restore()
    // Panel returned to its original parent.
    expect(panel.parentElement).toBe(host)
    host.remove()
  })

  it('popoverFallback portals + positions the panel and cleanup tears it down', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true })
    const host = document.createElement('section')
    const anchor = elementAt({ left: 10, top: 10, right: 60, bottom: 30, width: 50, height: 20 })
    const panel = floatingEl(40, 10)
    host.appendChild(panel)
    document.body.appendChild(host)

    const cleanup = popoverFallback(anchor, panel)
    expect(panel.style.position).toBe('fixed')
    expect(panel.parentElement).not.toBe(host)

    cleanup()
    // Restored to original parent after teardown.
    expect(panel.parentElement).toBe(host)
    host.remove()
  })
})
