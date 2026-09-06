/**
 * arch-5 M1 a11y primitive runtime — RFC-A5-017..021 (arch-5 §2.6).
 *
 * Tree-shakable: an SFC that uses only `<visuallyHidden>` imports
 * `_ensureA11yStyles`; `<focusTrap>` users import `createFocusTrap`;
 * `$announce(...)` action sites import `announce`.
 *
 * Budget: arch-5 §2.6 caps the total compiled-runtime cost across the 5
 * primitives at ~800 bytes. `<liveRegion>`, `<skipLink>`, and
 * `<visuallyHidden>` lower to plain `branch()` calls; only the CSS
 * injector + announce singleton + focus-trap helper add JS.
 */

import type { Branch } from '@aihu/arbor'
import { branch } from '@aihu/arbor'
import { createFocusTrap as _createTrap } from '@aihu/primitives/focus-trap'

// ─── sr-only + skip-link CSS ──────────────────────────────────────────────────

let _stylesInjected = false

/** @internal — idempotent style injection used by `<visuallyHidden>` and `<skipLink>`. */
export function _ensureA11yStyles(): void {
  if (_stylesInjected || typeof document === 'undefined') return
  _stylesInjected = true
  const s = document.createElement('style')
  s.setAttribute('data-aihu-a11y', '')
  s.textContent =
    '.aihu-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}' +
    '.aihu-skip-link{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}' +
    '.aihu-skip-link:focus{position:fixed;left:1rem;top:1rem;width:auto;height:auto;padding:.5rem 1rem;background:#000;color:#fff;z-index:9999;clip:auto}'
  document.head.appendChild(s)
}

// ─── $announce — RFC-A5-021 ───────────────────────────────────────────────────

let _liveEl: HTMLElement | null = null
let _clearTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Programmatic ARIA announcement. Singleton `<div aria-live="polite"
 * aria-atomic="true">` appended to `<body>` once and reused; messages
 * cleared after 2 s. Compiler rewrites `$announce('...')` in `@state`
 * action bodies to `__a11y_announce('...')`.
 */
export function announce(message: string): void {
  if (typeof document === 'undefined') return
  if (!_liveEl?.isConnected) {
    const d = document.createElement('div')
    d.setAttribute('aria-live', 'polite')
    d.setAttribute('aria-atomic', 'true')
    d.setAttribute('data-aihu-announce', '')
    d.className = 'aihu-sr-only'
    _ensureA11yStyles()
    document.body.appendChild(d)
    _liveEl = d
  }
  _liveEl.textContent = message
  if (_clearTimer) clearTimeout(_clearTimer)
  _clearTimer = setTimeout(() => {
    if (_liveEl) _liveEl.textContent = ''
    _clearTimer = null
  }, 2000)
}

/** @internal — test-only reset hook; rolldown DCE strips this for production. */
export function _resetAnnounceForTests(): void {
  if (_clearTimer) {
    clearTimeout(_clearTimer)
    _clearTimer = null
  }
  if (_liveEl?.parentNode) _liveEl.parentNode.removeChild(_liveEl)
  _liveEl = null
  _stylesInjected = false
  document.querySelectorAll('style[data-aihu-a11y]').forEach((n) => n.remove())
}

// ─── <focusTrap> — RFC-A5-018 ────────────────────────────────────────────────

let _trapSeq = 0

/**
 * Shadow-DOM-aware `querySelector`: `Document`/`Element.querySelector` never
 * descends into shadow roots, so a trap host rendered inside a component that
 * opts into `shadowMode: 'shadow'` (arch-5 thesis DA4 — leaf/design-system
 * components keep shadow encapsulation) is otherwise unfindable from
 * `document`. Falls through into every element's OPEN shadow root (recursing
 * for arbitrarily nested shadow trees) when a direct match isn't found in the
 * current root. Closed shadow roots are unavoidably invisible here (same
 * documented limitation as `@aihu/primitives/composed-tree.ts`'s
 * `composedQuerySelector`).
 *
 * Deliberately kept local rather than imported: this is a search DOWN FROM
 * `document` for a host that may not exist yet (hence `wire()`'s retry loop),
 * which happens BEFORE there is any container to hand to the primitives trap.
 * `@aihu/primitives/focus-trap` — the one place the actual trapping logic
 * lives (FEL-397) — exposes only the trap factory, not the composed-tree
 * substrate, and runtime imports that subpath ONLY, so it never pulls in the
 * dialog primitive or the primitives barrel.
 */
function _deepQuerySelector<T extends Element = HTMLElement>(
  root: ParentNode,
  selector: string,
): T | null {
  const direct = root.querySelector<T>(selector)
  if (direct) return direct
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const shadow = (el as HTMLElement).shadowRoot
    if (shadow) {
      const found = _deepQuerySelector<T>(shadow, selector)
      if (found) return found
    }
  }
  return null
}

/**
 * Focus-trap boundary. Renders `<div data-aihu-focustrap="N">` containing
 * `childFn()`. While `active` is truthy, Tab cycles within the host's
 * focusable descendants. `active` may be a boolean or `() => boolean`
 * (signal-ref); the trap re-checks it on every `focusin`, so reactive
 * toggling needs no subscription.
 *
 * This is a THIN REACTIVE ADAPTER, not a focus-trap implementation
 * (FEL-397 / aihu-project/aihu#537). Everything about actually trapping focus —
 * composed-tree tabbable enumeration and ordering, the Tab/Shift+Tab edge
 * wrap, the escape guard, initial focus, focus restore — lives in the single
 * shared implementation at `@aihu/primitives/focus-trap`. All this function
 * owns is (a) locating the emitted host element once it lands in the DOM and
 * (b) mapping the compiler's reactive `active` flag onto `activate()` /
 * `deactivate()`.
 *
 * Delegating also FIXES the escape guard rather than merely symmetrizing it.
 * The old local implementation bound `keydown` to `host` itself and tested
 * `!e.composedPath().includes(host)` — which can never be true: a
 * `composedPath()` IS the event's propagation path, and a listener only runs
 * when its own node is on that path, so `host` is always a member. That guard
 * was unreachable in BOTH directions, so adding the missing forward-Tab copy
 * of it would have been a no-op. The primitives implementation binds
 * `keydown` on `document` in the CAPTURE phase, where it observes keydowns
 * that originate anywhere — including outside the container — so its
 * `composedContains(container, current)` check is a genuinely reachable,
 * genuinely distinguishable "focus escaped the trap" state.
 */
export function createFocusTrap(
  active: boolean | (() => boolean),
  returnFocus: boolean,
  initialFocus: string | null,
  childFn: () => Branch,
): Branch {
  const id = String(++_trapSeq)
  const sub = childFn()
  const isActive = (): boolean => (typeof active === 'function' ? active() : active)

  let lastActive = false

  const wire = (): void => {
    if (typeof document === 'undefined') return
    const host = _deepQuerySelector<HTMLElement>(document, `[data-aihu-focustrap="${id}"]`)
    if (!host) {
      setTimeout(wire, 0)
      return
    }
    const trap = _createTrap(host, { initialFocus, returnFocus })
    const sync = (): void => {
      const a = isActive()
      if (a === lastActive) return
      lastActive = a
      if (a) trap.activate()
      else trap.deactivate()
    }
    sync()
    document.addEventListener('focusin', sync)
  }

  if (typeof queueMicrotask === 'function') queueMicrotask(wire)
  else setTimeout(wire, 0)

  return branch('div', { 'data-aihu-focustrap': id }, [sub])
}
