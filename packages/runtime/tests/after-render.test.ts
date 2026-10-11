import { branch, leaf, mount } from '@aihu/arbor'
import { signal } from '@aihu/signals'
import { describe, expect, it, vi } from 'vitest'
import {
  _setMount,
  defineComponent,
  _onAfterRender as onAfterRender,
} from '../src/define-component.ts'
import { defineElement } from '../src/define-element.ts'
import { _withSsrLifecycle } from '../src/ssr-lifecycle.ts'

_setMount(mount)

let ctr = 0
function tag(): string {
  return `x-after-render-${++ctr}`
}

describe('onAfterRender', () => {
  it('runs after initial mount and every patched update with committed DOM visible', async () => {
    const [read, write] = signal('first')
    const seen: string[] = []
    let element: HTMLElement
    const Component = defineComponent(() => {
      onAfterRender(() => seen.push(element.shadowRoot?.textContent ?? ''))
      return branch('p', { id: tagName }, [leaf([read, write])])
    })
    const tagName = tag()
    defineElement(tagName, Component)
    element = document.createElement(tagName)
    document.body.appendChild(element)

    expect(seen).toEqual([])
    await Promise.resolve()
    expect(seen).toEqual(['first'])
    write('second')
    expect(element.shadowRoot?.textContent).toBe('second')
    expect(seen).toEqual(['first'])
    await Promise.resolve()
    expect(seen).toEqual(['first', 'second'])
    element.remove()
  })

  it('returned disposer is idempotent and stops callbacks; disconnect also stops them', async () => {
    const [read, write] = signal('a')
    const callback = vi.fn()
    let dispose: (() => void) | undefined
    const Component = defineComponent(() => {
      dispose = onAfterRender(callback)
      return branch('p', undefined, [leaf([read, write])])
    })
    const t = tag()
    defineElement(t, Component)
    const el = document.createElement(t)
    document.body.appendChild(el)
    await Promise.resolve()
    expect(callback).toHaveBeenCalledTimes(1)
    dispose?.()
    dispose?.()
    write('b')
    await Promise.resolve()
    expect(callback).toHaveBeenCalledTimes(1)
    el.remove()
    write('c')
    await Promise.resolve()
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('preserves callback order when one callback disposes itself', async () => {
    const [read, write] = signal('a')
    const calls: string[] = []
    let disposeFirst: (() => void) | undefined
    const Component = defineComponent(() => {
      disposeFirst = onAfterRender(() => {
        calls.push('first')
        disposeFirst?.()
      })
      onAfterRender(() => calls.push('second'))
      return branch('p', undefined, [leaf([read, write])])
    })
    const t = tag()
    defineElement(t, Component)
    const el = document.createElement(t)
    document.body.appendChild(el)
    await Promise.resolve()
    expect(calls).toEqual(['first', 'second'])

    calls.length = 0
    write('b')
    await Promise.resolve()
    expect(calls).toEqual(['second'])
    el.remove()
  })

  it('is a no-op during SSR setup', () => {
    const callback = vi.fn()
    expect(() => _withSsrLifecycle(() => onAfterRender(callback))).not.toThrow()
    expect(callback).not.toHaveBeenCalled()
  })
})
