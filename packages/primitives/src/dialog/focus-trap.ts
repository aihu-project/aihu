/**
 * `createFocusTrap` — a tiny native-DOM focus trap (no library). Queries the
 * focusable descendants of a container via the composed-tree substrate (so it
 * correctly descends into any nested custom element's OPEN shadow root), wraps
 * Tab at the edges, moves focus to the first focusable (or the container) on
 * activate, and restores focus to the previously-active element on deactivate.
 *
 * This is the SINGLE focus-trap implementation in the repo (FEL-397 /
 * aihu-project/aihu#537). Two consumers share it:
 *   - `dialog-content` (`../dialog/index.ts`), via the default options.
 *   - `@aihu/runtime`'s `<focusTrap>` template surface, which imports the
 *     dedicated `@aihu/primitives/focus-trap` subpath entry and wraps this in
 *     a reactive `Branch` adapter — see `packages/runtime/src/a11y.ts`. That
 *     adapter is why `FocusTrapOptions` exists: `<focusTrap initialFocus=…
 *     returnFocus=…>` are authored-template attributes, and the honest way to
 *     support them is here, in the one implementation, rather than as a
 *     second trap grown inside the runtime.
 */

import {
  composedActiveElement,
  composedContains,
  composedQuerySelector,
  queryTabbables,
} from '../composed-tree.ts'

export interface FocusTrap {
  activate(): void
  deactivate(): void
}

export interface FocusTrapOptions {
  /**
   * CSS selector, resolved against the container's COMPOSED subtree (so it can
   * match into a nested open shadow root), naming the element to focus on
   * `activate()`. Falls back to the first tabbable — the default behavior —
   * when absent or when the selector matches nothing.
   */
  initialFocus?: string | null
  /**
   * Restore focus to whatever was focused before `activate()` when the trap is
   * deactivated. Defaults to `true`; pass `false` to opt out (the trap then
   * leaves focus wherever it currently is).
   */
  returnFocus?: boolean
}

/**
 * The focus-owning root to read `activeElement` from. `getRootNode()` returns
 * a plain `DocumentFragment` (or the node itself) when the container is
 * DETACHED — neither has `activeElement`, so reading it blind throws. A
 * detached container is not hypothetical: `@aihu/runtime`'s `<focusTrap>`
 * adapter keeps a trap alive while its host is torn down and re-rendered.
 */
function ownerRoot(container: Element): Document | ShadowRoot {
  const root = container.getRootNode() as Document | ShadowRoot
  return 'activeElement' in root ? root : (container.ownerDocument ?? document)
}

function focusables(container: Element): HTMLElement[] {
  // Include the currently-focused element even if it reports zero layout
  // (e.g. mid-transition) — same carve-out the old implementation had, now
  // resolved via the composed-tree activeElement so it still applies when the
  // focused node is nested inside a shadow root.
  const active = composedActiveElement(ownerRoot(container))
  return queryTabbables(container, { includeElement: active })
}

export function createFocusTrap(container: Element, options: FocusTrapOptions = {}): FocusTrap {
  let previouslyFocused: HTMLElement | null = null
  let active = false

  const onKeydown = (ev: KeyboardEvent): void => {
    if (!active || ev.key !== 'Tab') return
    // A document-level listener sees EVERY keydown, so a trap whose container
    // has been torn down without `deactivate()` would otherwise keep hijacking
    // Tab for the whole page (and read `activeElement` off a detached root).
    if (!container.isConnected) return
    const items = focusables(container)
    const first = items[0]
    const last = items[items.length - 1]
    if (!first || !last) {
      ev.preventDefault()
      return
    }
    const current = composedActiveElement(ownerRoot(container))

    if (ev.shiftKey && (current === first || !composedContains(container, current))) {
      ev.preventDefault()
      last.focus()
    } else if (!ev.shiftKey && (current === last || !composedContains(container, current))) {
      ev.preventDefault()
      first.focus()
    }
  }

  return {
    activate(): void {
      if (active) return
      active = true
      previouslyFocused = composedActiveElement(document) as HTMLElement | null
      const items = focusables(container)
      const initial = options.initialFocus
        ? composedQuerySelector<HTMLElement>(container, options.initialFocus)
        : null
      const target = initial ?? items[0] ?? (container as HTMLElement)
      // Ensure the container itself is focusable as a fallback.
      if (!items.length && !(container as HTMLElement).hasAttribute('tabindex')) {
        ;(container as HTMLElement).setAttribute('tabindex', '-1')
      }
      target.focus()
      document.addEventListener('keydown', onKeydown, true)
    },
    deactivate(): void {
      if (!active) return
      active = false
      document.removeEventListener('keydown', onKeydown, true)
      // Return focus to whatever opened the trap, unless opted out.
      if (options.returnFocus !== false) previouslyFocused?.focus?.()
      previouslyFocused = null
    },
  }
}
