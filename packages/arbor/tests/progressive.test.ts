import { describe, expect, it } from 'vitest'
import { position } from '../src/progressive.ts'

function elementAt(rect: Partial<DOMRect>): HTMLElement {
  const element = document.createElement('div')
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
  element.getBoundingClientRect = () => full
  return element
}

function floatingElement(width: number, height: number): HTMLElement {
  const element = document.createElement('div')
  Object.defineProperty(element, 'offsetWidth', { value: width, configurable: true })
  Object.defineProperty(element, 'offsetHeight', { value: height, configurable: true })
  return element
}

describe('@aihu/arbor/progressive', () => {
  it('positions a floating element below its anchor by default', () => {
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
    const floating = floatingElement(40, 10)

    expect(position(anchor, floating, { offset: 4 })).toBe('bottom')
    expect(floating.style.position).toBe('fixed')
    expect(floating.style.left).toBe('105px')
    expect(floating.style.top).toBe('124px')
  })

  it('flips to the opposite side when the preferred side overflows', () => {
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
    const floating = floatingElement(40, 50)

    expect(position(anchor, floating, { placement: 'bottom', offset: 4 })).toBe('top')
  })
})
