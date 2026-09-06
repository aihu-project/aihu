/**
 * WAI-ARIA conformance test (jsdom) for the NON-MODAL popover: disclosure
 * wiring on the trigger (`aria-haspopup="dialog"` + `aria-expanded` +
 * `aria-controls`), `role="dialog"` WITHOUT `aria-modal` on the content, no
 * focus trap, and `open-change` on user-driven changes only.
 *
 * Plus the positioning-REUSE assertion: popover imports `position` from
 * @aihu/css-engine/runtime/progressive and contains no positioning math, and
 * the source-level assertion that it never creates a focus trap.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { definePresenceGate } from '../presence-gate/index.ts'
import { type AihuPopoverRoot, definePopover } from './index.ts'

definePopover()
definePresenceGate()

interface Parts {
  root: AihuPopoverRoot
  trigger: HTMLElement
  content: HTMLElement
}

function build(rootAttrs = ''): Parts {
  document.body.innerHTML = `
    <aihu-popover-root ${rootAttrs}>
      <aihu-popover-trigger id="trg">Open</aihu-popover-trigger>
      <aihu-popover-content><button id="inner">act</button></aihu-popover-content>
    </aihu-popover-root>`
  return {
    root: document.querySelector('aihu-popover-root') as AihuPopoverRoot,
    trigger: document.getElementById('trg') as HTMLElement,
    content: document.querySelector('aihu-popover-content') as HTMLElement,
  }
}

describe('ARIA conformance — Popover (non-modal disclosure)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('the trigger advertises a dialog-flavored popup', () => {
    const { trigger } = build()
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
  })

  it('the trigger is a disclosure: aria-expanded reflects open, aria-controls names the content', () => {
    const { root, trigger, content } = build()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.getAttribute('aria-controls')).toBe(content.id)
    root.setOpen(true)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('a non-button trigger gets role=button + tabindex=0', () => {
    const { trigger } = build()
    expect(trigger.getAttribute('role')).toBe('button')
    expect(trigger.getAttribute('tabindex')).toBe('0')
  })

  it('the content has role=dialog but NOT aria-modal (non-modal disclosure)', () => {
    const { root, content } = build()
    expect(content.getAttribute('role')).toBe('dialog')
    expect(content.hasAttribute('aria-modal')).toBe(false)
    root.setOpen(true)
    expect(content.hasAttribute('aria-modal')).toBe(false)
  })

  it('the content takes its accessible name from the trigger when the consumer supplied none', () => {
    const { trigger, content } = build()
    expect(content.getAttribute('aria-labelledby')).toBe(trigger.id)
  })

  it('a consumer-supplied aria-label wins over the trigger fallback', () => {
    document.body.innerHTML = `
      <aihu-popover-root>
        <aihu-popover-trigger id="t2">Open</aihu-popover-trigger>
        <aihu-popover-content aria-label="Filters"></aihu-popover-content>
      </aihu-popover-root>`
    const content = document.querySelector('aihu-popover-content') as HTMLElement
    expect(content.getAttribute('aria-label')).toBe('Filters')
    expect(content.hasAttribute('aria-labelledby')).toBe(false)
  })

  it('opening does NOT move focus into the content (non-modal — no focus steal)', () => {
    const { trigger } = build()
    trigger.focus()
    trigger.click()
    expect(document.activeElement).toBe(trigger)
  })

  it('the content imposes no tabindex — its own children stay the tab order', () => {
    const { content } = build()
    expect(content.hasAttribute('tabindex')).toBe(false)
  })

  it('every piece reflects data-state', () => {
    const { root, trigger, content } = build()
    for (const el of [root, trigger, content]) {
      expect(el.getAttribute('data-state')).toBe('closed')
    }
    root.setOpen(true)
    for (const el of [root, trigger, content]) {
      expect(el.getAttribute('data-state')).toBe('open')
    }
  })

  it('the open attribute is two-way reflected', () => {
    const { root } = build()
    root.setOpen(true)
    expect(root.hasAttribute('open')).toBe(true)
    root.removeAttribute('open')
    expect(root.open()).toBe(false)
    root.setAttribute('open', '')
    expect(root.open()).toBe(true)
  })

  it('open-change fires on user-driven changes only', () => {
    const { root, trigger } = build()
    const seen: boolean[] = []
    root.addEventListener('open-change', (ev) => {
      seen.push((ev as CustomEvent<{ open: boolean }>).detail.open)
    })
    root.setOpen(true) // programmatic — silent
    root.setOpen(false)
    expect(seen).toEqual([])
    trigger.click() // user-driven — emits
    trigger.click()
    expect(seen).toEqual([true, false])
  })

  it('open-change bubbles and is composed', () => {
    const { root, trigger } = build()
    let ev: CustomEvent | null = null
    document.addEventListener('open-change', (e) => {
      ev = e as CustomEvent
    })
    trigger.click()
    expect(ev).not.toBeNull()
    expect((ev as unknown as CustomEvent).composed).toBe(true)
    void root
  })

  it('placement is reflected onto the content once positioned', () => {
    const { root, content } = build('placement="top"')
    root.setOpen(true)
    expect(content.getAttribute('data-placement')).toBeTruthy()
    expect(root.coords()).not.toBeNull()
  })

  it('drives an OPTIONAL descendant presence gate from open', () => {
    document.body.innerHTML = `
      <aihu-popover-root>
        <aihu-popover-trigger id="t3">Open</aihu-popover-trigger>
        <aihu-presence-gate>
          <aihu-popover-content>panel</aihu-popover-content>
        </aihu-presence-gate>
      </aihu-popover-root>`
    const root = document.querySelector('aihu-popover-root') as AihuPopoverRoot
    const gate = document.querySelector('aihu-presence-gate') as HTMLElement
    expect(gate.hasAttribute('present')).toBe(false)
    root.setOpen(true)
    expect(gate.hasAttribute('present')).toBe(true)
    expect(gate.getAttribute('data-state')).toBe('open')
    root.setOpen(false)
    expect(gate.hasAttribute('present')).toBe(false)
    expect(gate.getAttribute('data-state')).toBe('closed')
  })

  it('REUSES the core position() utility (no reimplemented positioning math)', () => {
    const src = readFileSync(
      join(process.cwd(), 'packages/primitives/src/popover/index.ts'),
      'utf8',
    )
    expect(src).toMatch(/import\s*\{[^}]*\bposition\b[^}]*\}\s*from\s*'@aihu\/arbor\/progressive'/)
    expect(src).toMatch(/position\(\s*anchor\s*,\s*this/)
    expect(src).not.toMatch(/getBoundingClientRect/)
  })

  it('does NOT trap focus — the source never touches the focus trap', () => {
    const src = readFileSync(
      join(process.cwd(), 'packages/primitives/src/popover/index.ts'),
      'utf8',
    )
    // No import of, and no call into, the repo's single focus-trap
    // implementation. (`aria-modal` appears only in prose here, hence the
    // runtime assertion above rather than a source-level one.)
    expect(src).not.toMatch(/from\s*'\.\.\/dialog\/focus-trap\.ts'/)
    expect(src).not.toMatch(/createFocusTrap\(/)
  })
})
