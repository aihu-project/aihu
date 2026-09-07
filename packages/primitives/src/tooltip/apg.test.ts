/**
 * WAI-ARIA APG **Tooltip** conformance test (jsdom). Asserts the contract from
 * https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/ :
 *   - content role=tooltip
 *   - trigger aria-describedby={contentId} (described-by, NOT labelled-by)
 *   - tooltip is NOT focusable
 *   - Escape dismisses
 * Plus the positioning-REUSE assertion: the tooltip source imports `position`
 * from @aihu/css-engine/runtime/progressive and contains no positioning math.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type AihuTooltipRoot, defineTooltip } from './index.ts'

defineTooltip()

function build(): { root: AihuTooltipRoot; trigger: HTMLElement; content: HTMLElement } {
  document.body.innerHTML = `
    <aihu-tooltip-root>
      <aihu-tooltip-trigger id="t" tabindex="0">Trigger</aihu-tooltip-trigger>
      <aihu-tooltip-content>tip text</aihu-tooltip-content>
    </aihu-tooltip-root>`
  return {
    root: document.querySelector('aihu-tooltip-root') as AihuTooltipRoot,
    trigger: document.getElementById('t') as HTMLElement,
    content: document.querySelector('aihu-tooltip-content') as HTMLElement,
  }
}

describe('APG conformance — Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('content has role=tooltip', () => {
    const { content } = build()
    expect(content.getAttribute('role')).toBe('tooltip')
  })

  it('trigger is described-by the tooltip (aria-describedby={contentId})', () => {
    const { trigger, content } = build()
    expect(trigger.getAttribute('aria-describedby')).toBe(content.id)
    // It is described-by, NOT labelled-by.
    expect(trigger.getAttribute('aria-labelledby')).toBeNull()
  })

  it('the tooltip content is NOT focusable', () => {
    const { content } = build()
    expect(content.hasAttribute('tabindex')).toBe(false)
  })

  it('Escape dismisses the tooltip', () => {
    const { root, trigger } = build()
    trigger.dispatchEvent(new FocusEvent('focus'))
    vi.advanceTimersByTime(700)
    expect(root.open()).toBe(true)
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(root.open()).toBe(false)
  })

  it('REUSES the core position() utility (no reimplemented positioning math)', () => {
    // Read the tooltip source from the repo (cwd is the repo root under vitest).
    const src = readFileSync(
      join(process.cwd(), 'packages/primitives/src/tooltip/index.ts'),
      'utf8',
    )
    // Imports position from the progressive shim.
    expect(src).toMatch(/import\s*\{[^}]*\bposition\b[^}]*\}\s*from\s*'@aihu\/arbor\/progressive'/)
    // Calls the shim.
    expect(src).toMatch(/position\(\s*anchor\s*,\s*this/)
    // Contains no homegrown geometry (no getBoundingClientRect math in tooltip).
    expect(src).not.toMatch(/getBoundingClientRect/)
  })
})
