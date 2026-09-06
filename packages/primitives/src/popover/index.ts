/**
 * Headless popover — `<aihu-popover-root>` + `<aihu-popover-trigger>` +
 * `<aihu-popover-content>`. A **non-modal disclosure**: the WAI-ARIA APG
 * [Dialog (Modal)](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
 * pattern's *non-modal* sibling, wired like a
 * [Disclosure](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/) button —
 * `aria-haspopup="dialog"` + `aria-expanded` + `aria-controls` on the trigger,
 * `role="dialog"` (deliberately WITHOUT `aria-modal`) on the content.
 *
 * Popover is NOT tooltip and NOT dialog:
 *   - vs `tooltip`: click-to-toggle (no hover delays), the content MAY contain
 *     focusable/interactive children, Escape returns focus to the trigger, and
 *     an outside pointerdown dismisses.
 *   - vs `dialog`: NO focus trap, NO `aria-modal`, NO backdrop element. A
 *     popover leaves the rest of the page reachable — trapping focus is
 *     dialog's job. Use `dialog` when the surface must be modal.
 *
 * Placement REUSES the `position()` shim from
 * `@aihu/arbor/progressive` (the same one `tooltip` uses) —
 * popover contains NO positioning math of its own and adds NO floating-ui
 * dependency.
 *
 * Exit timing composes `<aihu-presence-gate>`: wrap the content in a gate and
 * the ROOT drives the gate's `present` attribute from `open`, so a closing
 * popover holds its content mounted until the CSS exit transition ends. The
 * gate is OPTIONAL — without one the content simply stays mounted and flips
 * `data-state`. (The root, not the content, drives the gate: the gate unmounts
 * its own children on exit, so a content-driven wiring would tear out the very
 * element that has to re-arm presence on the next open.)
 *
 * Root attributes (reflected): `open` (boolean, two-way), `placement`
 * (`"top"|"bottom"|"left"|"right"`, default `"bottom"`).
 * Root signals: `open`, `coords` (`{ x, y, placement }` — the resolved values
 * the shim applied, published for consumers such as arrow positioning).
 * Events: `open-change` (detail `{ open: boolean }`, bubbles, composed) on
 * USER-driven changes only (trigger click/keys, Escape, outside pointerdown) —
 * programmatic `setOpen()` / attribute writes do NOT emit, matching switch's
 * `checked-change` and slider's `value-change` convention.
 */

import { type Placement, position } from '@aihu/arbor/progressive'
import { effect, type Read, signal } from '@aihu/signals'
import { createDomContext, injectValue, provideContext } from '../dom-context.ts'
import { HTMLElementBase } from '../html-element-base.ts'
import { createIdSequence } from '../id.ts'
import { AihuPresenceGate } from '../presence-gate/index.ts'

/** The position the shim actually applied (post viewport-collision flip). */
export interface PopoverCoords {
  x: number
  y: number
  placement: Placement
}

export interface PopoverContextValue {
  readonly open: Read<boolean>
  readonly contentId: Read<string>
  readonly placement: Read<Placement>
  /** Resolved position written by the content after each `position()` call. */
  readonly coords: Read<PopoverCoords | null>
  setCoords(next: PopoverCoords): void
  /** Programmatic write — signal + reflected attribute, does NOT emit. */
  setOpen(next: boolean): void
  /** User-driven toggle (trigger click / Enter / Space) — emits. */
  toggle(): void
  /** User-driven close WITHOUT returning focus (outside pointerdown). */
  close(): void
  /** User-driven close that RETURNS focus to the trigger (Escape). */
  dismiss(): void
  registerTrigger(el: Element): void
  registerContent(el: Element): void
  triggerEl(): Element | null
}

export const popoverContext = createDomContext<PopoverContextValue>('popover')

const uid = createIdSequence('aihu-popover')

function isPlacement(v: string | null): v is Placement {
  return v === 'top' || v === 'bottom' || v === 'left' || v === 'right'
}

export class AihuPopoverRoot extends HTMLElementBase {
  static readonly observedAttributes = ['open', 'placement']

  private readonly _open = signal(false)
  private readonly _contentId = signal(uid())
  private readonly _placement = signal<Placement>('bottom')
  private readonly _coords = signal<PopoverCoords | null>(null)
  private _trigger: Element | null = null
  private _content: Element | null = null
  private _outsideBound = false
  private _disposers: Array<() => void> = []
  private _ctx: PopoverContextValue

  constructor() {
    super()
    this._ctx = {
      open: this._open[0],
      contentId: this._contentId[0],
      placement: this._placement[0],
      coords: this._coords[0],
      setCoords: (next) => this._coords[1](next),
      setOpen: (next) => this.setOpen(next),
      toggle: () => this._userSetOpen(!this._open[0]()),
      close: () => this._userSetOpen(false),
      dismiss: () => this._dismiss(),
      registerTrigger: (el) => {
        this._trigger = el
      },
      registerContent: (el) => {
        this._content = el
      },
      triggerEl: () => this._trigger,
    }
    provideContext(this, popoverContext, this._ctx)
  }

  get open(): Read<boolean> {
    return this._open[0]
  }

  /** The resolved position the shim last applied to the content. */
  get coords(): Read<PopoverCoords | null> {
    return this._coords[0]
  }

  /** Programmatic write: signal + reflected `open` attribute (two-way, dialog
   * open-attr pattern). Does NOT emit `open-change`. */
  setOpen(next: boolean): void {
    if (next === this._open[0]()) return
    this._open[1](next)
    if (next) this.setAttribute('open', '')
    else this.removeAttribute('open')
    this._onOpenChanged(next)
  }

  connectedCallback(): void {
    const p = this.getAttribute('placement')
    if (isPlacement(p)) this._placement[1](p)
    this._open[1](this.hasAttribute('open'))
    this._disposers.push(
      effect(() => {
        this.setAttribute('data-state', this._open[0]() ? 'open' : 'closed')
      }),
    )
    this._onOpenChanged(this._open[0]())
  }

  /**
   * Imperative side effects of an open/close, deliberately NOT run inside the
   * `data-state` effect. Driving the presence gate means writing an attribute
   * that the GATE turns into a signal write of its own — doing that during our
   * effect's run is a nested write mid-propagation, which `@aihu/signals`
   * correctly rejects with `SignalCircularError`. These are effects of a state
   * change, not derivations of state, so they belong on the write path.
   */
  private _onOpenChanged(open: boolean): void {
    this._syncPresence(open)
    this._bindOutside(open)
  }

  disconnectedCallback(): void {
    // Teardown order matters: the document-level listener must go even if a
    // disposer throws, so it is removed first (a leaked capture-phase
    // pointerdown listener would keep closing a popover that no longer exists).
    this._bindOutside(false)
    for (const d of this._disposers) d()
    this._disposers = []
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    switch (name) {
      case 'open':
        this.setOpen(value !== null)
        break
      case 'placement':
        if (isPlacement(value)) this._placement[1](value)
        break
    }
  }

  /** User-driven state change — emits `open-change` when it actually flips. */
  private _userSetOpen(next: boolean): void {
    if (next === this._open[0]()) return
    this.setOpen(next)
    this.dispatchEvent(
      new CustomEvent<{ open: boolean }>('open-change', {
        detail: { open: next },
        bubbles: true,
        composed: true,
      }),
    )
  }

  /** Escape path: close AND restore focus to the trigger (disclosure norm). */
  private _dismiss(): void {
    const wasOpen = this._open[0]()
    this._userSetOpen(false)
    if (wasOpen) (this._trigger as HTMLElement | null)?.focus?.()
  }

  /** Drive an OPTIONAL descendant `<aihu-presence-gate>` from `open`. */
  private _syncPresence(open: boolean): void {
    const gate = this._presenceGate()
    if (!gate) return
    if (open) gate.setAttribute('present', '')
    else gate.removeAttribute('present')
  }

  /**
   * The nearest descendant presence gate, if the consumer composed one. The
   * tag-name arm is not redundant: when the root is parsed from markup its
   * children exist in the DOM but have not been UPGRADED yet, so the
   * `instanceof` check alone would miss the gate on the very first pass.
   */
  private _presenceGate(): Element | null {
    for (const el of this.querySelectorAll('*')) {
      if (el instanceof AihuPresenceGate) return el
      if (el.tagName.toLowerCase().endsWith('presence-gate')) return el
    }
    return null
  }

  /** Add/remove the document-level outside-pointerdown listener with `open`. */
  private _bindOutside(open: boolean): void {
    if (open && !this._outsideBound) {
      document.addEventListener('pointerdown', this._onDocPointerDown, true)
      this._outsideBound = true
    } else if (!open && this._outsideBound) {
      document.removeEventListener('pointerdown', this._onDocPointerDown, true)
      this._outsideBound = false
    }
  }

  private readonly _onDocPointerDown = (ev: Event): void => {
    if (this._isInside(ev, this._trigger) || this._isInside(ev, this._content)) return
    // No focus restore here — an outside pointerdown means the user is already
    // moving focus somewhere else on purpose; yanking it back to the trigger
    // would fight them. Escape (`dismiss()`) is the path that restores focus.
    this._userSetOpen(false)
  }

  private _isInside(ev: Event, el: Element | null): boolean {
    if (!el) return false
    // `composedPath()` is the shadow-DOM-correct containment check; `contains`
    // is the fallback for environments/events that don't provide a path.
    const path = typeof ev.composedPath === 'function' ? ev.composedPath() : []
    if (path.includes(el)) return true
    const target = ev.target
    return target instanceof Node && el.contains(target)
  }
}

/** Base for pieces that inject the popover context lazily on connect. */
abstract class PopoverPiece extends HTMLElementBase {
  protected ctx!: PopoverContextValue
  protected disposers: Array<() => void> = []

  connectedCallback(): void {
    this.ctx = injectValue(this, popoverContext)
    this.onConnect()
  }

  disconnectedCallback(): void {
    for (const d of this.disposers) d()
    this.disposers = []
    this.onDisconnect()
  }

  protected abstract onConnect(): void
  protected onDisconnect(): void {}
}

export class AihuPopoverTrigger extends PopoverPiece {
  protected onConnect(): void {
    this.ctx.registerTrigger(this)
    // The trigger is always an AUTONOMOUS custom element (`<*-popover-trigger>`)
    // — never a native `<button>` — so it always needs the button role and a
    // tab stop, unless the consumer supplied their own.
    if (!this.hasAttribute('role')) this.setAttribute('role', 'button')
    if (!this.hasAttribute('tabindex')) this.setAttribute('tabindex', '0')
    if (this._disabled()) this.setAttribute('aria-disabled', 'true')
    // APG: the popover's content is a small panel, so the trigger advertises
    // `dialog` (not `true`/`menu`) — same value dialog-trigger uses.
    this.setAttribute('aria-haspopup', 'dialog')
    this.addEventListener('click', this._onClick)
    this.addEventListener('keydown', this._onKeydown)
    this.disposers.push(
      effect(() => {
        this.setAttribute('aria-expanded', String(this.ctx.open()))
        this.setAttribute('aria-controls', this.ctx.contentId())
        this.setAttribute('data-state', this.ctx.open() ? 'open' : 'closed')
      }),
    )
  }

  protected override onDisconnect(): void {
    this.removeEventListener('click', this._onClick)
    this.removeEventListener('keydown', this._onKeydown)
  }

  private _disabled(): boolean {
    return this.hasAttribute('disabled') || this.getAttribute('aria-disabled') === 'true'
  }

  private readonly _onClick = (): void => {
    if (this._disabled()) return
    this.ctx.toggle()
  }

  /**
   * Enter/Space activation for the `role="button"` host. A deliberate addition
   * over `dialog-trigger`, which sets `role="button"` without ever making that
   * role's keys work.
   *
   * `ev.target !== this` is load-bearing, not defensive: a consumer may nest a
   * real `<button>` (or link) inside the trigger, and the platform already
   * synthesizes a click from Enter/Space there. That click bubbles to this host
   * and toggles — so also handling the bubbled KEYDOWN would toggle twice and
   * leave the popover exactly where it started.
   */
  private readonly _onKeydown = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      this.ctx.dismiss()
      return
    }
    if (ev.target !== this || this._disabled()) return
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault()
      this.ctx.toggle()
    }
  }
}

export class AihuPopoverContent extends PopoverPiece {
  private _tracking = false

  protected onConnect(): void {
    this.ctx.registerContent(this)
    // Non-modal disclosure: `role="dialog"` WITHOUT `aria-modal`. Unlike
    // tooltip content, this panel may hold focusable children — no `tabindex`
    // is imposed either way, so the consumer's own children stay the tab order.
    this.setAttribute('role', this.getAttribute('role') ?? 'dialog')
    this.id = this.ctx.contentId()
    // A `role="dialog"` needs an accessible name; the trigger's own text is the
    // honest default (dialog gets one from its `<title>` piece, which popover
    // deliberately doesn't carry). A consumer-supplied name always wins.
    if (!this.hasAttribute('aria-label') && !this.hasAttribute('aria-labelledby')) {
      const trigger = this.ctx.triggerEl() as HTMLElement | null
      if (trigger) {
        if (!trigger.id) trigger.id = `${this.ctx.contentId()}-trigger`
        this.setAttribute('aria-labelledby', trigger.id)
      }
    }
    this.addEventListener('keydown', this._onKeydown)
    this.disposers.push(
      effect(() => {
        const open = this.ctx.open()
        this.setAttribute('data-state', open ? 'open' : 'closed')
        if (open) {
          this._position()
          this._track(true)
        } else {
          this._track(false)
        }
      }),
    )
  }

  protected override onDisconnect(): void {
    this._track(false)
    this.removeEventListener('keydown', this._onKeydown)
  }

  /** Position against the trigger using the shared core DOM utility. */
  private readonly _position = (): void => {
    const anchor = this.ctx.triggerEl()
    if (!anchor) return
    const resolved = position(anchor, this, { placement: this.ctx.placement() })
    this.setAttribute('data-placement', resolved)
    // Publish what the shim APPLIED (read back off the inline styles it wrote —
    // popover does no geometry of its own), so consumers can place an arrow.
    this.ctx.setCoords({
      x: Number.parseFloat(this.style.left) || 0,
      y: Number.parseFloat(this.style.top) || 0,
      placement: resolved,
    })
  }

  /**
   * Keep the panel anchored while open. `anchorFallback()` from the same shim
   * bundles these listeners, but it returns only a cleanup function — popover
   * needs `position()`'s RESOLVED placement for `data-placement`/`coords`, so
   * it calls the core directly and owns the two listeners.
   */
  private _track(on: boolean): void {
    if (on === this._tracking) return
    this._tracking = on
    if (on) {
      window.addEventListener('scroll', this._position, { passive: true, capture: true })
      window.addEventListener('resize', this._position, { passive: true })
    } else {
      window.removeEventListener('scroll', this._position, {
        capture: true,
      } as EventListenerOptions)
      window.removeEventListener('resize', this._position)
    }
  }

  private readonly _onKeydown = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape' && this.getAttribute('data-dismissable-escape') !== 'false') {
      ev.stopPropagation()
      this.ctx.dismiss()
    }
  }
}

const REGISTRY: Array<[string, CustomElementConstructor]> = [
  ['aihu-popover-root', AihuPopoverRoot],
  ['aihu-popover-trigger', AihuPopoverTrigger],
  ['aihu-popover-content', AihuPopoverContent],
]

const _definedPrefixes = new Set<string>()
/**
 * Register all popover custom elements under `<prefix>-popover-*` (idempotent
 * per prefix). Non-default prefixes register a fresh trivial subclass per
 * piece — a constructor can only be `customElements.define`d once. Demos/
 * stories use a non-`aihu` prefix so styled recipes own the `aihu-popover-*`
 * namespace (spec §9.4). A no-op without a DOM.
 */
export function definePopover(prefix = 'aihu'): void {
  // No DOM, no registry to register INTO — a documented no-op. See
  // `html-element-base.ts` §"Registration without a DOM".
  if (typeof customElements === 'undefined') return
  if (_definedPrefixes.has(prefix)) return
  for (const [tag, ctor] of REGISTRY) {
    const name = prefix === 'aihu' ? tag : tag.replace(/^aihu-/, `${prefix}-`)
    if (!customElements.get(name)) {
      customElements.define(name, prefix === 'aihu' ? ctor : class extends ctor {})
    }
  }
  _definedPrefixes.add(prefix)
}
