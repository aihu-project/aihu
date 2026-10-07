import { _enterContext, _exitContext } from '@aihu/context'
import {
  type EffectScope,
  effectScope,
  getCurrentScope,
  onScopeDispose,
  runWithScope,
  type signal as SignalFactory,
} from '@aihu/signals'
// Ownership contract (docs/plans/2026-07-24-lifecycle-ownership-dx.md §6):
// `@aihu/runtime` is the ONE package that attaches a `LifecycleHost` to a
// component's root scope. `@aihu/use` (a future workstream, not this one)
// reads it back via `getLifecycleHost()`; the bare `onCommit` export below
// reads it back too, through the same public entry point, just gated
// tighter (`_cur`-only) than the contract itself requires.
import { _attachLifecycleHost, getLifecycleHost, type LifecycleHost } from '@aihu/signals/lifecycle'
import { _takeAgentServerBinding } from './agent-dispatch.ts'
import { _dropCommitsFor, _scheduleCommit } from './commit.ts'
import { _inSsrLifecycle } from './ssr-lifecycle.ts'
import type {
  ComponentOptions,
  MountFn,
  PropDef,
  PropSignal,
  PropsConfig,
  Setup,
  SetupContext,
} from './types.ts'
import { RuntimeError } from './types.ts'

type _ScopeRef = ReturnType<MountFn>

/**
 * Injected hydration function (arbor's `hydrate`). Same injection posture as
 * `_mount` (`_setHydrate` / `_setMount`): wired by `@aihu/app`'s client
 * bootstrap for 'ssr'/'hybrid' rendering, left `null` for 'spa' builds and
 * bare test harnesses. Lives HERE — not in define-element.ts — because
 * hydration is not a separate lifecycle: the single connect path below
 * chooses its renderer (`_hydrate` vs `_mount`) and everything else
 * (`onMount`, slot projection, scope registration, teardown) is shared, so
 * the two paths cannot drift apart again.
 */
type HydrateFn = (
  component: () => ReturnType<Setup>,
  host: Element | ShadowRoot,
  snapshot: Record<string, unknown>,
  options?: Parameters<MountFn>[2],
) => ReturnType<MountFn>

let _mount: MountFn | null = null
let _hydrate: HydrateFn | null = null
let _signal: typeof SignalFactory | null = null

/**
 * First-render DOM adoption — the server's template marker.
 *
 * A WIRE-PROTOCOL attribute (like `data-aihu-path`): `@aihu/server`'s
 * `renderToString({ wrapTag })` stamps it on the component's own host element
 * in hydratable renders, declaring "this host's children are its OWN
 * server-rendered template". That declaration is what makes adoption safe to
 * detect at all: under light DOM the host's children at connect time are
 * otherwise the SLOT-PROJECTION source (user-slotted content), and slotted
 * content that itself came from a parent's server render carries
 * `data-aihu-path` markers too — path presence alone cannot tell the two
 * apart. The marker can, because it only ever rides the host of a render the
 * server produced FOR that host; slotted content arrives inside a parent's
 * template and its receiving host is never marked.
 *
 * Consequences, both directions:
 *   - marked host → children are NEVER slot-projected. Adopt them when
 *     possible; DISCARD them when not (shadow mode, no hydrate fn wired) —
 *     re-projecting a server template as slot content would double-render it.
 *   - unmarked host → children are ALWAYS the slot source (existing carve).
 *
 * The attribute is deliberately NOT consumed on adoption: sibling renders
 * hydrate in load order, and an outer component's `hydrate()` needs the
 * nested host's marker as a path-map boundary (see arbor's hydrate.ts) even
 * if the nested host adopted first. A disconnect→reconnect over a marked host
 * is safe because the adopted scope's dispose clears the host's children
 * (parity with mount()'s DOM removal), so re-adoption over the empty host
 * degrades to a fresh materialize — i.e. a clean mount.
 */
const ADOPT_ATTR = 'data-aihu-ssr'

/**
 * Adopt a marked host's server-rendered children: wire the component's tree
 * onto the existing DOM via the injected `_hydrate` instead of building fresh
 * nodes. The signal snapshot — if the app published one under this tag
 * (`__aihu_state__[tag]`, see @aihu/app client.ts) — pre-seeds writable
 * signals; its ABSENCE no longer gates adoption (static pages have no
 * serialized state but every reason to keep their prerendered DOM).
 *
 * The returned scope's dispose removes the host's children after the effect
 * teardown — mount()-parity (its dispose removes the mounted roots last).
 * hydrate()'s own scope deliberately leaves DOM intact, but for a COMPONENT
 * host that would break reconnect: the first hydration consumes structural
 * comment markers, so a second hydration over the stale DOM would append
 * fresh structural content beside the stale copy. Clearing makes any later
 * reconnect a clean re-render.
 *
 * `container` is where the server template actually LIVES, which is not always
 * the element: under light DOM it is `el` itself, and under Declarative Shadow
 * DOM it is `el.shadowRoot` (see `_hasDeclarativeShadowTemplate`). It is
 * always `el.shadowRoot ?? el` — the same `host` the mount path uses — so
 * adopt and mount write to one place. `el` is still the snapshot key, since
 * `__aihu_state__` is keyed by tag name in both modes.
 */
function _adoptSsrTemplate(
  el: HTMLElement,
  tree: ReturnType<Setup>,
  container: Element | ShadowRoot,
  lc: _LC,
): _ScopeRef {
  const state = (globalThis as { __aihu_state__?: Record<string, unknown> }).__aihu_state__
  const snapshot = (state?.[el.tagName.toLowerCase()] as Record<string, unknown> | undefined) ?? {}
  const inner = _hydrate!(() => tree, container, snapshot, {
    ...(container === el
      ? { projectLightDomSlot: (_host, children) => _projectLightDomSlot(el, children) }
      : {}),
    onAfterRender: () => _runAfterRenders(el, lc),
  })
  return {
    dispose(): void {
      inner.dispose()
      container.replaceChildren()
    },
    agent: inner.agent,
    serialize: () => inner.serialize(),
  }
}

/**
 * Does this host's server template live in a DECLARATIVE shadow root?
 *
 * Only meaningful on a `data-aihu-ssr`-marked host. Under DSD the browser
 * parses `<template shadowrootmode="open">` into a real shadow root and moves
 * the server's tree inside it, so the template is in `shadowRoot`, not in the
 * host's children — the mirror of the light-DOM case, and the reason
 * `isLightDom` alone cannot gate adoption for shadow components.
 *
 * Non-emptiness IS the discriminator, and it is exact for the roots aihu
 * attaches: `define-element.ts` attaches in the constructor and puts nothing
 * in it, so a root of ours is always empty when `connectedCallback` decides.
 * Populated therefore means the parser filled it. This also correctly re-reads
 * as `false` after a disconnect, because the adopted scope's dispose clears
 * the container — so a reconnect degrades to a clean fresh mount rather than
 * re-adopting consumed markers.
 *
 * The one thing it cannot distinguish is a base primitive or userland subclass
 * that populates the shadow root before this point. Nothing in aihu does —
 * primitives touch the host's role/tabindex/aria and its listeners, never its
 * root's children (see the class-form `connectedCallback`) — and the failure
 * is soft anyway: `hydrate()` over non-matching DOM degrades to materialising
 * fresh nodes.
 */
function _hasDeclarativeShadowTemplate(el: HTMLElement): boolean {
  const root = el.shadowRoot
  return root !== null && root.childNodes.length > 0
}

// Lifecycle: current-instance pointer set during setup() calls.
// R2 (Director r6 §3): four-callback $lifecycle extension. `a` (adopted) and
// `ac` (attributeChanged) are added so the host's adoptedCallback /
// attributeChangedCallback can dispatch userland callbacks at the right
// platform moment. `attributeChange` per spec runs AFTER R1's $prop signal
// dispatch (so authors see the post-converted signal value).
// Unified-LIFO teardown (effect-scope plan P0-3, ratified): there is no `c`
// (cleanup) array anymore. Everything the component owns — composable
// effects/computeds, `onCleanup` callbacks, and onMount-returned teardowns —
// registers into the ONE component-scope disposer list (`_componentScopes`)
// and is drained LIFO by `scope.stop()` on disconnect. This REVERSES the old
// order (previously: onCleanup FIFO in setup order, then onMount teardowns);
// now onMount teardowns run first (registered last), then setup-time
// cleanups in reverse registration order. All of it still runs before
// `MountScope.dispose()` (DOM removal last).
interface _LC {
  m: Array<() => void | (() => void)>
  a: Array<() => void>
  ac: Array<(name: string, oldValue: string | null, newValue: string | null) => void>
  r: Array<() => void>
}
let _cur: _LC | null = null

// Bug E — stale custom-element-reaction guard (see the detailed rationale on
// both `connectedCallback` implementations below). Module-level reentrancy
// depth: incremented for the duration of EVERY compiled component's
// connectedCallback, decremented on exit. A connectedCallback that starts
// while `_ceReactionDepth > 0` is, by construction, running SYNCHRONOUSLY
// nested inside another element's still-executing connectedCallback — the
// only way that happens on the real platform is a `[CEReactions]`-wrapped
// DOM mutation (`removeChild`, `replaceWith`, ...) performed by the OUTER
// callback's own body, which eagerly drains the INNER element's entire
// pending reaction queue, including an earlier-enqueued-but-not-yet-invoked
// `connectedCallback` reaction from the ORIGINAL insertion that is still
// waiting its turn. Scoping the guard to `wasNested` (not bare `isConnected`)
// is deliberate: several existing unit tests call `el.connectedCallback()`
// directly on a never-inserted element (a documented jsdom workaround, see
// `define-component.test.ts`'s Bug 6 suite) — those calls happen at
// `_ceReactionDepth === 0`, so they are unaffected; only a connectedCallback
// invoked WHILE ANOTHER is already mid-execution, on an element that turns
// out not to be connected, is treated as a stale replay and skipped.
let _ceReactionDepth = 0

// Callers must invoke this inside `runWithScope(es, ...)` so onMount-created
// effects are scope-owned and onMount-returned teardowns register into the
// same unified LIFO list as setup-time `onCleanup` callbacks.
function _runMounts(lc: _LC): void {
  for (const fn of lc.m) {
    const r = fn()
    if (r) onScopeDispose(r as () => void)
  }
}

/** A disposer called by one callback must not skip its registered siblings. */
function _runAfterRenders(el: HTMLElement, lc: _LC): void {
  if (!_componentScopes.get(el)?.active) return
  for (const fn of [...lc.r]) if (lc.r.includes(fn)) fn()
}

function _runAdopts(lc: _LC): void {
  for (const fn of lc.a) fn()
}

function _runAttrChanges(
  lc: _LC,
  name: string,
  oldValue: string | null,
  newValue: string | null,
): void {
  for (const fn of lc.ac) fn(name, oldValue, newValue)
}

/** @internal */
export function _setSignal(s: typeof SignalFactory): void {
  _signal = s
}

/** @internal */
export function _setMount(fn: MountFn): void {
  _mount = fn
}

/** @internal — wire the hydration renderer (arbor's `hydrate`). Null-safe to
 * re-call; passing `null` unwires it (tests). When unwired, marked hosts fall
 * back to discard-and-mount (never slot-projection of a server template). */
export function _setHydrate(fn: HydrateFn | null): void {
  _hydrate = fn
}

const _scopes = new WeakMap<HTMLElement, _ScopeRef>()
// Per-instance component effect scope (effect-scope plan §2). Module-level —
// NOT a per-class closure symbol — because `_hmrReplace` and define-element's
// hydration disconnect bridge must reach it across class boundaries.
const _componentScopes = new WeakMap<HTMLElement, EffectScope>()
// `connected` signal setter for THIS connection (lifecycle-ownership plan
// §4). Module-level, keyed the same way as `_componentScopes` and always
// set/deleted together — `_stopComponentScope` is the one place both are
// torn down, so they can never drift out of sync.
const _connections = new WeakMap<HTMLElement, (v: boolean) => void>()

/**
 * @internal — a `connected` getter/setter pair. Uses the injected `_signal`
 * factory when one has been wired (`_setSignal`, always true for real
 * `.aihu` builds via the compiler's auto-injected `_setSignal(signal)`), so
 * `connected()` is reactive and safe to read inside `effect()`. Falls back
 * to a plain non-reactive closure when no signal factory is wired — a
 * test-harness-only case: hand-written `defineComponent()` calls in tests
 * that never touch attrs/props (and so never call `_setSignal`) still get
 * a working, if non-reactive, `connected()`.
 */
function _makeConnectedSignal(): [() => boolean, (v: boolean) => void] {
  if (_signal !== null) {
    return _signal!(true) as unknown as [() => boolean, (v: boolean) => void]
  }
  let v = true
  return [
    () => v,
    (next: boolean) => {
      v = next
    },
  ]
}

/**
 * @internal — create this connection's `connected` signal, register its
 * setter for `_stopComponentScope` to flip, and attach the `LifecycleHost`
 * (lifecycle-ownership plan §6.3) to `es` so `@aihu/use`'s future
 * `getLifecycleHost()` consumers (and this module's own `_onCommit`) can
 * resolve it. Called from every `_build()` call site (both class forms —
 * covers the normal-connect AND the hydration path, since define-element's
 * hydration branch calls `_build()` directly, §2.6) and from `_hmrReplace`.
 * Returns the `connected` getter for the caller to fold into `SetupContext`.
 */
function _installLifecycle(el: HTMLElement, es: EffectScope): () => boolean {
  const [connected, setConnected] = _makeConnectedSignal()
  _connections.set(el, setConnected)
  const host: LifecycleHost = {
    connected,
    onCommit(fn) {
      _scheduleCommit(fn, connected, es)
    },
  }
  _attachLifecycleHost(es, host)
  return connected
}

/** @internal — stop + delete an element's component effect scope, if any,
 * flipping its `connected` signal to `false` FIRST (lifecycle-ownership
 * plan §4.2(c): `onCleanup` bodies and in-flight `await` continuations must
 * observe `false`, so the flip has to land before `scope.stop()` drains
 * them). Called by define-element's hydration branch, which bypasses this
 * module's `disconnectedCallback` (early return on `_HS`) but still runs
 * `_build()` and therefore opened the scope AND registered a connection —
 * and, since FEL-401, by BOTH of this module's own `disconnectedCallback`
 * forms too, making this the one real shared teardown choke point for
 * `connected`'s flip (see the FEL-401 note below `disconnectedCallback`).
 * Rethrows the first disposer error (scope.stop's collect-run-all-rethrow-
 * first contract).
 *
 * Also drops any commits queued for `es` from the rAF-coalesced commit
 * queue (`_dropCommitsFor`, commit.ts) BEFORE stopping the scope — a queued
 * `onCommit` entry otherwise strongly retains the dead scope (and whatever
 * its closure captured) until the next animation frame fires, which may
 * never happen in a suspended/hidden background tab. */
export function _stopComponentScope(el: HTMLElement): void {
  const es = _componentScopes.get(el)
  if (es !== undefined) {
    _componentScopes.delete(el)
    _connections.get(el)?.(false)
    _connections.delete(el)
    _dropCommitsFor(es)
    es.stop()
  }
}
const ATTR_SYM = Symbol()
const LC_SYM = Symbol()
// Hierarchical DI: each instance's `provides` object. Its prototype chain IS the
// ancestor context tree. Defaults to a shared reference to the parent's object
// (zero allocation); `@aihu/context.provide` swaps in an own `Object.create` copy
// on first provide. Read by descendants at connect to inherit the chain.
const PROVIDES_SYM = Symbol()

/**
 * Enter a component's context scope for the duration of its setup: resolve the
 * nearest ancestor component's `provides`, default this instance to a shared
 * reference to it (zero allocation), and install the scope. The ancestor object
 * is already prototype-linked to ITS ancestors, so one reference yields the whole
 * chain; resolution is a single hop up through the shadow host (falling back to
 * the light-DOM parent), repeated only across non-component nodes. Runs at connect
 * (post-upgrade), so a lazily-registered child still finds its ancestor. Returns
 * the token for `_exitContext`.
 */
function _enterOwnerContext(el: Record<symbol, unknown>): ReturnType<typeof _enterContext> {
  let node: Node | null = el as unknown as Node
  let parent: Record<symbol, unknown> | null = null
  while (node) {
    const root = node.getRootNode()
    node = root instanceof ShadowRoot ? root.host : node.parentNode
    const p = node && (node as unknown as Record<symbol, unknown>)[PROVIDES_SYM]
    if (p != null) {
      parent = p as Record<symbol, unknown>
      break
    }
  }
  el[PROVIDES_SYM] = parent as unknown as Record<symbol, unknown>
  return _enterContext(parent, (own) => {
    el[PROVIDES_SYM] = own
  })
}

/**
 * @internal — run `fn` inside a context scope OWNED BY an arbitrary DOM node,
 * so that `provide()` calls made in `fn` become visible to every component
 * later connected beneath that node.
 *
 * `@aihu/context`'s hierarchical `provide`/`inject` are component-scoped: only
 * `_build()` installs a scope (via `_enterOwnerContext` above), so a `provide()`
 * made during app bootstrap — outside any component setup — lands nowhere and
 * every descendant's `inject()` silently falls back to the token default. That
 * is exactly the failure mode `@aihu/app`'s `createApp()` hit with
 * `RouteContext` (`useRoute()`/`useRouter()`/`useRouteParams()` resolving null
 * forever in the primary app model).
 *
 * The provides chain is keyed on DOM nodes, not on component-ness —
 * `_enterOwnerContext` walks `parentNode` / shadow `host` looking for ANY node
 * carrying a provides object. So installing one on the app's outlet element is
 * enough to root the whole tree, with no synthetic wrapper component and no
 * change to `inject`'s hot path. Re-entrant and nestable (it uses the same
 * enter/exit token protocol as a component setup), and a no-op-safe pairing:
 * the scope is always torn down in `finally`.
 *
 * Not exported for app authors — `@aihu/app` is the intended (and only) caller.
 */
export function _withOwnerContext<R>(node: object, fn: () => R): R {
  const prev = _enterOwnerContext(node as Record<symbol, unknown>)
  try {
    return fn()
  } finally {
    _exitContext(prev)
  }
}
const _E0002 = 'no mount'

/** Bug 6: safe tag-name lookup for the connectedCallback error path. A real
 * upgraded custom element always has a valid `tagName`, but the error handler
 * must NEVER itself throw (and thereby mask the original error) — e.g. if
 * invoked on a detached/non-Element receiver the `tagName` getter throws a
 * TypeError. Fall back to a sentinel so the attributable console.error always
 * fires and the original error is what re-throws. */
function _tagOf(el: HTMLElement): string {
  try {
    return el.tagName.toLowerCase()
  } catch {
    return 'unknown-element'
  }
}

/**
 * Bug D — light-DOM slot projection helper. Under `shadowMode: 'light'` the
 * browser does not run native <slot> projection, so the compiled-to-DOM
 * `<slot>` element(s) from `<slot>` are inert. After the layout template has
 * been mounted into `host`, this hand-rolls the projection to match Shadow-DOM
 * `<slot>` semantics:
 *
 *   - Named slots: every carved child carrying `slot="foo"` is routed to the
 *     `<slot name="foo">` placeholder; children with no `slot=` attribute (and
 *     all text nodes) go to the default (unnamed) slot.
 *   - Assigned nodes win: a slot with matching children is replaced by them,
 *     and the slot's own children (its fallback content) are discarded.
 *   - Default fallback: a slot with NO matching children is unwrapped to its
 *     existing children (`<slot name="x">fallback</slot>` → `fallback`); an
 *     empty slot simply disappears.
 *   - No slot in the layout: the children are reattached to the host as a
 *     graceful fallback — preserves prior behavior for components that don't
 *     author a slot at all. Children whose `slot=` name matches no placeholder
 *     are likewise reattached to the host (preserve-not-drop) rather than
 *     silently discarded.
 */
/** Bug D — safe `is-real-Element` check for the light-DOM slot carve. Some
 * existing tests invoke `connectedCallback()` directly on an
 * `Object.create(Cmp.prototype)` non-Element receiver to exercise specific
 * invariant throws (e.g. SCR-R0003). On such a receiver the `shadowRoot` /
 * `childNodes` getters throw TypeError. The carve must therefore degrade to
 * a no-op (preserving the legacy SCR-R0003 path) instead of throwing first. */
function _isRealElement(el: HTMLElement): boolean {
  try {
    // Touch a property that throws on non-Element receivers in jsdom/native.
    void el.childNodes
    return true
  } catch {
    return false
  }
}

/** Bug D — the target slot name for a carved child. Only element children can
 * carry a `slot=` attribute; text/comment nodes always route to the default
 * (unnamed) slot, keyed here as the empty string. */
function _slotNameOfChild(c: ChildNode): string {
  if (c.nodeType === 1 /* ELEMENT_NODE */) {
    return (c as Element).getAttribute('slot') ?? ''
  }
  return ''
}

/** LDF §10 step 4 — mark a reparented top-level projected node so
 * `light_scope.rs`'s `::slotted()` lowering (`[data-aihu-slotted]`) can
 * target it. Only element nodes can carry an attribute; text/comment nodes
 * are skipped (there is no lowered selector that could match them anyway —
 * `::slotted()` in real Shadow DOM only ever matches elements). */
function _markSlotted(c: ChildNode): void {
  if (c.nodeType === 1 /* ELEMENT_NODE */) (c as Element).setAttribute('data-aihu-slotted', '')
}

/**
 * Carve-and-reinsert primitive for Bug D light-DOM `<slot>` projection.
 * Exported (not just called internally, from `connectedCallback` above) so
 * `@aihu/arbor`'s top-level `hydrate()` walk (`packages/arbor/src/hydrate.ts`
 * in the `aihu-dom` repo) can reuse the exact same routing logic for the
 * page-level hydrate path, which does not go through a component's own
 * `connectedCallback` and today has no slot-projection handling at all — see
 * aihu-runtime#4. Callers own the carve-before-build/adopt sequencing
 * themselves: capture the host's original children BEFORE the new subtree is
 * built or adopted onto it, then call this AFTER, exactly as the two call
 * sites below do.
 */
export function _projectLightDomSlot(host: HTMLElement, children: ChildNode[]): void {
  if (children.length === 0) return
  const slots = Array.from(host.querySelectorAll('slot'))
  if (slots.length === 0) {
    // No slot in the layout — reattach the children to the host so they remain
    // observable (no errors, no data loss). This preserves the prior behavior
    // of plain custom elements that simply contained children.
    for (const c of children) {
      _markSlotted(c)
      host.appendChild(c)
    }
    return
  }

  // Route each child to its target slot name (Shadow-DOM semantics). Default
  // slot is keyed '' — element children with no `slot=` attr and every text
  // node land there.
  const byName = new Map<string, ChildNode[]>()
  for (const c of children) {
    const name = _slotNameOfChild(c)
    const bucket = byName.get(name)
    if (bucket === undefined) byName.set(name, [c])
    else bucket.push(c)
  }

  // Resolve each placeholder in document order. `name=""` and an absent `name`
  // both denote the default slot. A duplicate same-named slot finds its bucket
  // already consumed and falls through to its own fallback content.
  for (const slotEl of slots) {
    const name = slotEl.getAttribute('name') ?? ''
    const assigned = byName.get(name)
    if (assigned !== undefined && assigned.length > 0) {
      // Assigned nodes win — replace the slot with them; the slot's own
      // children (its fallback content) are discarded.
      for (const c of assigned) _markSlotted(c)
      slotEl.replaceWith(...assigned)
      byName.delete(name)
    } else {
      // No assigned nodes — unwrap the slot to reveal its fallback content
      // (the slot's existing children stay in the tree; an empty slot vanishes).
      slotEl.replaceWith(...slotEl.childNodes)
    }
  }

  // Children whose `slot=` name matched no placeholder do not render in real
  // Shadow DOM; preserve-not-drop them onto the host (mirrors the no-slot path).
  for (const bucket of byName.values()) {
    for (const c of bucket) {
      _markSlotted(c)
      host.appendChild(c)
    }
  }
}

export function defineComponent(setup: Setup): typeof HTMLElement
export function defineComponent<A extends ReadonlyArray<string>>(
  options: ComponentOptions<A>,
): typeof HTMLElement
export function defineComponent(setupOrOptions: Setup | ComponentOptions): typeof HTMLElement {
  if (typeof setupOrOptions === 'function') {
    const setup = setupOrOptions
    const S = Symbol()
    class C extends HTMLElement {
      private [S]: _ScopeRef | null = null
      private [LC_SYM]: _LC | null = null
      /** @internal — hydration entry point. Runs setup and returns the node
       * tree without calling _mount. Called by define-element's hydration
       * branch via the `_build?()` check. */
      _build(): ReturnType<Setup> {
        const lc: _LC = { m: [], a: [], ac: [], r: [] }
        this[LC_SYM] = lc
        const host = this.shadowRoot ?? this
        // Component root scope — DETACHED (effect-scope plan §2). Element↔
        // element ownership is the DOM tree, not the scope tree: a child
        // component upgrading while an ancestor's scope is current must NOT
        // auto-parent its root scope into the ancestor's (that would recreate
        // the unified owner tree the ownership model rejects — double-stop,
        // tree-1-collapses-into-tree-2). Each element stops its own scope on
        // disconnect; DOM removal cascades.
        const es = effectScope(true)
        _componentScopes.set(this, es)
        // Lifecycle-ownership plan §2.6/§4.1: attach right after
        // `_componentScopes.set`, BEFORE `es.run(setup)` — this is the one
        // `_build()` call site shared by both the normal-connect path
        // (connectedCallback below) and define-element's hydration branch
        // (which calls `_build()` directly), so `connected` and `onCommit`
        // work identically on both without any hydration special-casing.
        const connected = _installLifecycle(this, es)
        _cur = lc
        const prevCtx = _enterOwnerContext(this as unknown as Record<symbol, unknown>)
        try {
          // es.run wraps ONLY the setup call (P0-2a, structural): `_mount`
          // runs later in connectedCallback, after _build returns, OUTSIDE
          // the scope — binding effects belong to the MountScope, never here.
          return es.run(() =>
            setup({ host, element: this, connected } as SetupContext),
          ) as ReturnType<Setup>
        } finally {
          _exitContext(prevCtx)
          _cur = null
        }
      }
      connectedCallback(): void {
        // Bug E — stale reaction guard. See the `_ceReactionDepth` doc comment
        // above for the full mechanism: a connectedCallback invoked while
        // ANOTHER is already synchronously mid-execution (`wasNested`), on an
        // element that turns out not to be connected, is a stale replay of an
        // earlier-queued reaction — fired prematurely by a `[CEReactions]`
        // DOM mutation (e.g. the Bug D carve's `removeChild` below, on SOME
        // ancestor) that eagerly drained this element's pending reaction
        // queue. This fires for real when a `shadowMode: 'light'` component
        // (e.g. a popover/dialog root) is itself a nested child inside
        // ANOTHER component's own compiled `@template`: arbor's
        // `_materialize` builds that whole subtree via `document.createElement`
        // (which upgrades/constructs each custom element immediately) and
        // then attaches it to the live document in one shot — unlike
        // markup/`innerHTML`-driven insertion (e.g. every `.stories.ts` that
        // writes a tag directly), where the HTML parser defers upgrading
        // nested custom elements until after an ancestor's own
        // connectedCallback has already run, so this race never fires there.
        // A disconnectedCallback follows the skipped call (harmless — nothing
        // was ever wired up), then a SECOND, correctly-timed connectedCallback
        // fires once the element reaches its final position — that is the
        // one this guard defers to.
        const wasNested = _ceReactionDepth > 0
        _ceReactionDepth++
        try {
          if (wasNested && !this.isConnected) return
          if (_mount === null) throw new RuntimeError('SCR-R0002', _E0002)
          // Bug 6: a throw from setup()/_build()/_mount() escapes into the
          // platform custom-element-reactions queue, which surfaces it only as a
          // bare anonymous "Uncaught" with no component-tag attribution (and the
          // shadow root is left empty because the throw aborts before mount runs).
          // Catch-log-rethrow: console.error WITH the tag for a greppable,
          // attributable signal, then re-throw to preserve fail-loud behavior
          // (so SCR-R0002/0003 invariants and any other throw still propagate).
          try {
            // First-render DOM adoption: a `data-aihu-ssr` marker on the host
            // (stamped by @aihu/server's wrapTag render) declares the existing
            // children to be this component's OWN server-rendered template —
            // see ADOPT_ATTR's doc comment. Marked children are NEVER the
            // slot-projection source.
            const isReal = _isRealElement(this)
            const ssrTemplate = isReal && this.hasAttribute(ADOPT_ATTR)
            // Bug D — light-DOM slot projection. Under `shadowMode: 'light'` the
            // host has no shadow root, so the browser's native <slot> projection
            // does not run. Carve any existing light-DOM children BEFORE _mount
            // appends the layout template (otherwise the layout's nodes land
            // after them) and reinsert at the <slot> position after mount.
            // Shadow-DOM path is untouched (`host !== this`). A marked host is
            // exempt: its children are the server template, not slot content.
            //
            // That exemption is safe today for a reason narrower than "usually
            // true": `__aihu_schild` (ssr-string.ts) is the SINGLE place a
            // resolved child is serialized — shared by the compiled string
            // renderer and `@aihu/server`'s own tree walker — and its SCOPE (v1)
            // contract only emits a child call (and therefore only stamps
            // ADOPT_ATTR) for a reference site with NO children. A reference
            // that carries slot content always falls back to the bare, unmarked
            // element instead, so a host can never arrive here BOTH marked and
            // carrying external slot content — it is unreachable, not just
            // unlikely (issue #2 / aihu#477 audit). If child SSR ever grows
            // prop/slot forwarding at the reference site, this exemption must be
            // revisited alongside it.
            const isLightDom = isReal && this.shadowRoot === null
            const lightDomChildren: ChildNode[] | null =
              isLightDom && !ssrTemplate ? Array.from(this.childNodes) : null
            if (lightDomChildren !== null) {
              for (const c of lightDomChildren) this.removeChild(c)
            }
            const tree = this._build()
            const lc = this[LC_SYM]!
            const host = this.shadowRoot ?? this
            // Server-build @agent components register a full per-instance binding
            // in setup (keyed by `this`). Forward it to mount() so the LiveBinding
            // lands in arbor's componentInstanceRegistry — the headless gate path.
            // Client builds never register one (undefined → mount() no-ops it).
            const ab = _takeAgentServerBinding(this)
            // Adoptable in EITHER mode: the server template is the host's own
            // children (light DOM) or the contents of a declarative shadow
            // root (shadow DOM). `host` is where it lives in both cases.
            const adoptable = isLightDom || _hasDeclarativeShadowTemplate(this)
            let scope: _ScopeRef
            if (ssrTemplate && adoptable && _hydrate !== null && !ab) {
              // Adopt: wire effects onto the server's DOM instead of rebuilding.
              // Everything after this branch is byte-identical to the mount
              // path, so onMount, scope registration and teardown are shared.
              scope = _adoptSsrTemplate(this, tree!, host, lc)
            } else {
              // Marked but unadoptable (shadow mode with an EMPTY root — the
              // server emitted the tree as light children with no declarative
              // template to adopt into; or no hydrate fn wired — 'spa'
              // bootstrap served a prerendered page): the existing nodes are a
              // server template, and the ONLY safe fallback is to discard them
              // before mounting fresh. Carving them into slot projection would
              // render the template twice.
              //
              // Clear BOTH sides: `this` for the light children a pre-DSD
              // server emits on a shadow host, and `host` for a declarative
              // root we could not adopt (mount targets `host`, so leaving its
              // stale tree in place would double-render). One of the two is
              // always already empty, making the extra call a no-op.
              if (ssrTemplate) {
                this.replaceChildren()
                if (host !== this) host.replaceChildren()
              }
              scope = _mount(tree!, host, {
                ...(ab ? { agentBinding: ab } : {}),
                onAfterRender: () => _runAfterRenders(this, lc),
              })
            }
            this[S] = scope
            _scopes.set(this, scope)
            if (lightDomChildren !== null) _projectLightDomSlot(this, lightDomChildren)
            // onMount bodies run INSIDE the component scope so effects they
            // create are scope-owned and returned teardowns join the unified
            // LIFO list (see _runMounts).
            runWithScope(_componentScopes.get(this)!, () => _runMounts(lc))
          } catch (err) {
            // Setup/mount/onMount throw: stop + delete the just-opened scope so
            // any effects created before the throw don't leak (mirror of the
            // signals first-run-throw self-dispose). A throwing disposer must
            // not mask the ORIGINAL error — log it and rethrow the original.
            try {
              _stopComponentScope(this)
            } catch (stopErr) {
              console.error(`[aihu] scope stop failed for <${_tagOf(this)}>:`, stopErr)
            }
            console.error(`[aihu] setup failed for <${_tagOf(this)}>:`, err)
            throw err
          }
        } finally {
          _ceReactionDepth--
        }
      }
      disconnectedCallback(): void {
        // Unified-LIFO teardown (P0-3, ratified): scope.stop() drains
        // everything the component owns — onMount teardowns first
        // (registered last), then setup-time onCleanup callbacks in reverse.
        // The `finally` is throw containment for COMPONENT-SCOPE disposers:
        // a throwing scope disposer never skips MountScope.dispose()
        // (bindings + DOM removal last). NOTE a throwing MountScope-INTERNAL
        // binding disposer still aborts _makeScope's own LIFO loop —
        // pre-existing gap, separate fix.
        //
        // FEL-401: routed through `_stopComponentScope` (rather than the
        // formerly-inlined `_componentScopes.get(this)?.stop()`) so
        // `connected` flips to `false` here — the design doc this shipped
        // against claimed this call site already went through that helper;
        // it did not. This call site is the fix, not a doc correction.
        try {
          _stopComponentScope(this)
        } finally {
          this[S]?.dispose()
          this[S] = this[LC_SYM] = null
          _scopes.delete(this)
        }
      }
      // FEL-396: opt-in marker for the WHATWG `moveBefore()` API. The spec
      // requires a custom element class to define `connectedMoveCallback`
      // (an EMPTY body is sufficient) before the platform will preserve its
      // state across a `moveBefore()` reparent — without it, `moveBefore`
      // itself falls back to firing disconnectedCallback + connectedCallback,
      // which is exactly the state-destroying behavior this exists to avoid.
      // No body needed: this callback runs neither `_build()` nor
      // `connectedCallback`, so nothing here needs to re-run on a move.
      // CAVEAT: DI/context does NOT re-resolve on a move — a moved component
      // keeps whatever ancestor `provides` chain it resolved at first
      // connect, even if the move relocates it under a different provider.
      connectedMoveCallback(): void {}
      // R2 (Director r6 §3): adoptedCallback dispatches userland onAdopt.
      adoptedCallback(): void {
        const lc = this[LC_SYM]
        if (lc) _runAdopts(lc)
      }
      // R2: attributeChangedCallback dispatches userland onAttributeChange.
      // Function-form components have no observedAttributes by default, so
      // this only fires if a derived class declares them — kept here for
      // completeness + parity with options-form.
      attributeChangedCallback(
        name: string,
        oldValue: string | null,
        newValue: string | null,
      ): void {
        const lc = this[LC_SYM]
        if (lc) _runAttrChanges(lc, name, oldValue, newValue)
      }
    }
    return C
  }

  const {
    attrs = [] as unknown as ReadonlyArray<string>,
    setup,
    props: propsCfg,
    base,
  } = setupOrOptions
  // Recipe class-extension (§9.4): extend a primitive base instead of
  // HTMLElement so its connectedCallback (ARIA/keyboard/context) runs. When no
  // base is declared this is HTMLElement, so existing components are unchanged.
  const Base: typeof HTMLElement = base ?? HTMLElement
  const S = Symbol()
  const PROPS_SYM = Symbol()
  // Bug (pre-connect prop binding): per-instance buffer for prop writes that
  // arrive BEFORE _build() runs (i.e. before connectedCallback). At pre-connect
  // PROPS_SYM is null, so the prop setter has no signal to write to — arbor's
  // _materialize applies reactive `$prop` bindings via `el.prop = v` the moment
  // the element is created, before it is appended/connected. Without this buffer
  // the first bound value is silently dropped and the prop reverts to its
  // attribute/default at connect. Lazily allocated in the setter, drained in
  // _build() (where it takes precedence over the getAttribute/default fallback).
  const PENDING_SYM = Symbol()
  const REFLECT_SYM = Symbol()

  // R1: derive the (propName → attributeName) mapping once at class-build time.
  // `attribute: false` removes the entry from observedAttributes; `'kebab'`
  // overrides; default is kebabCase(propName).
  const propEntries: Array<[string, PropDef, string | null]> = propsCfg
    ? Object.entries(propsCfg).map(([name, def]) => {
        const attr = def.attribute
        const attrName: string | null =
          attr === false ? null : typeof attr === 'string' ? attr : _kebab(name)
        return [name, def, attrName]
      })
    : []

  // Validation: `attribute: false` + `reflect: true` is invalid (nothing to
  // reflect to). Surface as RuntimeError at class-build (compile-time check
  // also exists in emit.rs; runtime is a defensive backstop).
  for (const [name, def, attrName] of propEntries) {
    if (attrName === null && def.reflect === true) {
      throw new RuntimeError(
        'SCR-R0004',
        `prop '${name}': reflect: true is incompatible with attribute: false`,
      )
    }
  }

  // observedAttributes = legacy `attrs` ∪ R1 prop attribute names ∪ the base
  // class's own observed attributes. A subclass's static `observedAttributes`
  // SHADOWS the base's, so without the union the base would stop seeing its
  // attributes (e.g. AihuButton's `disabled`/`pressed`) in
  // attributeChangedCallback. Union them when a base is present.
  const observed: string[] = [...attrs]
  for (const [, , attrName] of propEntries) {
    if (attrName !== null && !observed.includes(attrName)) observed.push(attrName)
  }
  const baseObserved = (Base as unknown as { observedAttributes?: string[] }).observedAttributes
  if (baseObserved) {
    for (const a of baseObserved) if (!observed.includes(a)) observed.push(a)
  }

  // Base lifecycle callbacks, captured once. `super.<cb>` can't be typed (the
  // DOM lib doesn't declare these on HTMLElement), so we dispatch via the base
  // prototype. All are `undefined` when `base` is unset (HTMLElement), so the
  // forwarding below is a no-op for ordinary components.
  type _LifecycleProto = {
    connectedCallback?: () => void
    disconnectedCallback?: () => void
    connectedMoveCallback?: () => void
    attributeChangedCallback?: (n: string, o: string | null, v: string | null) => void
  }
  const _baseProto = Base.prototype as _LifecycleProto

  // Reverse-lookup: attribute name → prop name. Used by attributeChangedCallback
  // to resolve which signal to update.
  const attrToProp = new Map<string, string>()
  for (const [name, , attrName] of propEntries) {
    if (attrName !== null) attrToProp.set(attrName, name)
  }

  class C extends Base {
    static readonly observedAttributes = observed
    private [S]: _ScopeRef | null = null
    private [LC_SYM]: _LC | null = null
    private [ATTR_SYM]: Record<string, ReturnType<typeof SignalFactory>> | null = null
    // R1 — per-instance prop signal map (callable getter + .set writer).
    private [PROPS_SYM]: Record<string, PropSignal> | null = null
    // Bug (pre-connect prop binding): pending writes keyed by prop name. `.has()`
    // distinguishes a buffered `undefined`/`null` from "never written". A Map
    // (gzips well against the file's existing Map use). Declared (no initializer)
    // → `undefined` until the first pre-connect write, so it adds no constructor
    // bytes.
    private [PENDING_SYM]: Map<string, unknown> | undefined = undefined
    // R1 — re-entrancy guard for reflect: true. Set during setAttribute writes
    // triggered by signal updates so attributeChangedCallback skips dispatch.
    private [REFLECT_SYM] = new Set<string>()
    // R4/Q3 (Director r6 §2.Q3): coarse-grained reflect-loop guard. Set on
    // entry to attributeChangedCallback, cleared in finally. While set, any
    // ps.set() that would reflect back to attribute is suppressed — covers
    // the cross-component $bind + reflect: true cycle (Lit's _isReflecting
    // precedent).
    _isInternalAttrChange: boolean = false

    constructor() {
      // Custom-element constructors are always invoked with no arguments (the
      // spec forbids parameters), so `super()` covers HTMLElement and any custom
      // `$extends` base alike.
      super()
      // Upgrade rescue. A prop assigned to an element BEFORE its tag was
      // `define()`d — the lazy/async-import case, where the tag renders and is
      // written to before its chunk lands — has no accessor to catch it, so it
      // lands as an OWN property that then SHADOWS the prototype accessor forever
      // once the element upgrades: the setter never runs, the signal never sees
      // the value, and the prop silently reverts to its default. Capture each
      // such own property, delete it, and re-assign THROUGH the accessor, which
      // (pre-connect) buffers it into PENDING_SYM for `_build()` to seed. Fields
      // above are already initialized by the time this runs, so the accessor's
      // pre-connect branch is live.
      for (const [name] of propEntries) {
        if (Object.hasOwn(this, name)) {
          const buffered = (this as Record<string, unknown>)[name]
          delete (this as Record<string, unknown>)[name]
          ;(this as Record<string, unknown>)[name] = buffered
        }
      }
    }

    /** @internal — hydration entry point. Runs the signal/prop preamble
     * and setup, returning the node tree without calling _mount. Called by
     * define-element's hydration branch via the `_build?()` check. */
    _build(): ReturnType<typeof setup> {
      if (_signal === null && (attrs.length > 0 || propEntries.length > 0)) {
        throw new RuntimeError('SCR-R0003', 'no signal')
      }
      const attrSignals: Record<string, ReturnType<typeof SignalFactory>> = {}
      for (const name of attrs) attrSignals[name] = _signal!(this.getAttribute(name) ?? '')
      this[ATTR_SYM] = attrSignals

      // R1 — allocate per-prop signal at connect time. Initial value priority:
      // (0) a value buffered by a pre-connect property write (Bug: pre-connect
      // prop binding) — wins over everything, kept as-is with NO stringification
      // so objects/functions/arrays survive intact; (1) raw attribute string
      // passed through converter (when attribute is observed AND already set on
      // the element); (2) `def.value` default.
      const pending = this[PENDING_SYM]
      const propSignals: Record<string, PropSignal> = {}
      for (const [name, def, attrName] of propEntries) {
        let initial: unknown = def.value
        if (attrName !== null) {
          const raw = this.getAttribute(attrName)
          if (raw !== null) {
            initial = _convert(raw, def, def.value)
          }
        }
        // (0) Pre-connect buffered write takes precedence. `.has()` so a
        // deliberately-buffered `undefined`/`null` still wins over the default.
        if (pending?.has(name)) initial = pending.get(name)
        const sig = _signal!(initial as string)
        // The signal here stores `unknown` — the runtime signal type is
        // generic; we cast at the boundary. (`_signal` is typed as
        // `signal<string>` only for legacy attrs path.)
        const [get, set] = sig as unknown as [() => unknown, (v: unknown) => void]
        const ps = (() => get()) as PropSignal
        ps.set = (v: unknown): void => {
          set(v)
          // Reflect to attribute when configured. R4/Q3 (Director r6 §2.Q3):
          // suppress reflect when we are mid-attributeChangedCallback — the
          // attribute already holds the source-of-truth value and reflecting
          // would re-fire the callback (cross-component $bind cycle).
          if (def.reflect === true && attrName !== null && !this._isInternalAttrChange) {
            const reflected = _reflectToAttr(v)
            this[REFLECT_SYM].add(attrName)
            try {
              if (reflected === null) {
                this.removeAttribute(attrName)
              } else {
                this.setAttribute(attrName, reflected)
              }
            } finally {
              this[REFLECT_SYM].delete(attrName)
            }
          }
        }
        propSignals[name] = ps
      }
      this[PROPS_SYM] = propSignals
      // Buffer fully drained — drop it so a later disconnect→reconnect rebuilds
      // from attribute/default (live signals carry forward via the writes
      // themselves) and we don't replay a stale pre-connect value.
      this[PENDING_SYM] = undefined

      const lc: _LC = { m: [], a: [], ac: [], r: [] }
      this[LC_SYM] = lc
      const host = this.shadowRoot ?? this
      // Component root scope — DETACHED; es.run wraps ONLY the setup call
      // (P0-2a). See the function-form _build for the full rationale.
      const es = effectScope(true)
      _componentScopes.set(this, es)
      // Lifecycle-ownership plan §2.6/§4.1: attach right after
      // `_componentScopes.set`, BEFORE `es.run(setup)` — see the
      // function-form `_build()` for the full rationale (shared by both
      // the normal-connect path and define-element's hydration branch).
      const connected = _installLifecycle(this, es)
      _cur = lc
      const prevCtx = _enterOwnerContext(this as unknown as Record<symbol, unknown>)
      try {
        return es.run(() =>
          setup({
            host,
            element: this,
            attrs: attrSignals,
            props: propSignals,
            connected,
          } as Parameters<typeof setup>[0]),
        ) as ReturnType<typeof setup>
      } finally {
        _exitContext(prevCtx)
        _cur = null
      }
    }

    connectedCallback(): void {
      // Bug E — stale reaction guard (see the `_ceReactionDepth` doc comment
      // and the function-form connectedCallback above for the full
      // mechanism). This is the path that actually throws for a
      // `base:`-extending recipe: `_baseProto.connectedCallback` below is
      // where a context-consuming primitive (e.g. `AihuPopoverTrigger` /
      // `PopoverPiece`) calls `injectContext`, which is exactly what fails
      // when this callback is a stale replay — fired synchronously nested
      // inside SOME ancestor's own connectedCallback, mid-`removeChild`, by
      // that ancestor's light-DOM-slot carve (Bug D, below) — while THIS
      // element is momentarily detached. `wasNested` (not bare `isConnected`)
      // keeps this from breaking the Bug 6 unit tests, which deliberately
      // call `el.connectedCallback()` directly on a never-inserted element at
      // `_ceReactionDepth === 0` (a documented jsdom workaround) — only a
      // connectedCallback firing WHILE ANOTHER is already mid-execution is
      // eligible to be treated as a stale replay.
      const wasNested = _ceReactionDepth > 0
      _ceReactionDepth++
      try {
        if (wasNested && !this.isConnected) return
        if (_mount === null) throw new RuntimeError('SCR-R0002', _E0002)
        // Bug 6 (options/props-form): same catch-log-rethrow as the function-form
        // connectedCallback above. A setup/build/mount throw — incl. the
        // SCR-R0003 "no signal" invariant from _build() — is logged WITH the tag
        // for attribution, then re-thrown to preserve fail-loud propagation.
        try {
          // §9.4 class-extension: run the base primitive's connectedCallback
          // FIRST — it sets role/tabindex/aria-* and listeners on the HOST and
          // provides any cross-piece context, none of which touch the host's
          // children. Running it before the template mounts means a
          // context-providing primitive (e.g. checkbox root) is registered
          // before its slotted child pieces upgrade. Dispatched via the base
          // prototype (the DOM lib can't type `super.connectedCallback`); a no-op
          // when the base is HTMLElement, so existing components are unaffected.
          _baseProto.connectedCallback?.call(this)
          // First-render DOM adoption + Bug D slot projection — mirrored from
          // the function-form connectedCallback (see it for the full
          // rationale): a `data-aihu-ssr`-marked host's children are its own
          // server-rendered template (adopt or discard, never slot-project);
          // an unmarked light-DOM host's children are the slot source (carve).
          const isReal = _isRealElement(this)
          const ssrTemplate = isReal && this.hasAttribute(ADOPT_ATTR)
          const isLightDom = isReal && this.shadowRoot === null
          const lightDomChildren: ChildNode[] | null =
            isLightDom && !ssrTemplate ? Array.from(this.childNodes) : null
          if (lightDomChildren !== null) {
            for (const c of lightDomChildren) this.removeChild(c)
          }
          const tree = this._build()
          const lc = this[LC_SYM]!
          const host = this.shadowRoot ?? this
          // See function-form connectedCallback: forward the server @agent binding
          // (registered in setup, keyed by `this`) to mount() so the headless gate
          // sees a LiveBinding. Client builds never register one.
          const ab = _takeAgentServerBinding(this)
          // See the function-form connectedCallback: adoptable in either mode —
          // light-DOM children, or a declarative shadow root's contents.
          const adoptable = isLightDom || _hasDeclarativeShadowTemplate(this)
          let scope: _ScopeRef
          if (ssrTemplate && adoptable && _hydrate !== null && !ab) {
            scope = _adoptSsrTemplate(this, tree!, host, lc)
          } else {
            if (ssrTemplate) {
              this.replaceChildren()
              if (host !== this) host.replaceChildren()
            }
            scope = _mount(tree!, host, {
              ...(ab ? { agentBinding: ab } : {}),
              onAfterRender: () => _runAfterRenders(this, lc),
            })
          }
          this[S] = scope
          _scopes.set(this, scope)
          if (lightDomChildren !== null) _projectLightDomSlot(this, lightDomChildren)
          // onMount bodies run INSIDE the component scope — unified LIFO list
          // (see the function-form connectedCallback).
          runWithScope(_componentScopes.get(this)!, () => _runMounts(lc))
        } catch (err) {
          // Setup/mount/onMount throw: stop + delete the just-opened scope (see
          // the function-form connectedCallback for the full rationale).
          try {
            _stopComponentScope(this)
          } catch (stopErr) {
            console.error(`[aihu] scope stop failed for <${_tagOf(this)}>:`, stopErr)
          }
          console.error(`[aihu] setup failed for <${_tagOf(this)}>:`, err)
          throw err
        }
      } finally {
        _ceReactionDepth--
      }
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
      // §9.4 class-extension: forward to the base FIRST so a base that observes
      // its own attributes (e.g. AihuButton's `disabled`/`pressed`) reacts. The
      // union'd observedAttributes is what makes this callback fire for the
      // base's attrs at all. No-op when base is HTMLElement.
      _baseProto.attributeChangedCallback?.call(this, name, oldValue, newValue)
      // R4/Q3: reflect-loop guard. Set host-wide flag so ps.set() called from
      // userland onAttributeChange (or from the propagated _convert below)
      // does not reflect back to the attribute and re-fire this callback.
      // Cleared in `finally` to keep stack-discipline correct under throws.
      this._isInternalAttrChange = true
      try {
        // Legacy attrs path — direct string signal update.
        this[ATTR_SYM]?.[name]?.[1](newValue ?? '')
        // R1 — prop path. Skip when this change was caused by our own reflect
        // (re-entrancy guard).
        if (!this[REFLECT_SYM].has(name)) {
          const propName = attrToProp.get(name)
          if (propName !== undefined) {
            const ps = this[PROPS_SYM]?.[propName]
            const def = (propsCfg as PropsConfig)[propName]
            if (ps !== undefined && def !== undefined) {
              ps.set(_convert(newValue, def, def.value))
            }
          }
        }
        // R2 (Director r6 §3.R2): userland $lifecycle.attributeChange runs
        // AFTER R1's $prop signal-update so authors observe the post-converted
        // signal value. Order: legacy attr signal → R1 prop signal → userland.
        const lc = this[LC_SYM]
        if (lc) _runAttrChanges(lc, name, oldValue, newValue)
      } finally {
        this._isInternalAttrChange = false
      }
    }

    // FEL-396: opt-in marker for `moveBefore()` state preservation — see the
    // function-form class above for the full rationale and the DI/context
    // CAVEAT. Forwarded to the base primitive (§9.4 class-extension) for
    // symmetry with connectedCallback/disconnectedCallback, though no shipped
    // primitive currently defines one.
    connectedMoveCallback(): void {
      _baseProto.connectedMoveCallback?.call(this)
    }
    // R2 (Director r6 §3): adoptedCallback dispatches userland onAdopt. A base
    // primitive's adoptedCallback is NOT forwarded — no primitive defines one,
    // and document-adoption of a custom element is a rare edge the recipe layer
    // doesn't need (kept lean for the runtime size budget).
    adoptedCallback(): void {
      const lc = this[LC_SYM]
      if (lc) _runAdopts(lc)
    }

    disconnectedCallback(): void {
      // Unified-LIFO teardown (P0-3): scope.stop() drains onMount teardowns
      // first (registered last), then setup-time onCleanup in reverse. The
      // `finally` is throw containment for COMPONENT-SCOPE disposers — a
      // throwing scope disposer never skips MountScope.dispose() (DOM
      // removal last) or the base's teardown. (A throwing MountScope-
      // internal binding disposer still aborts _makeScope's own loop —
      // pre-existing gap, separate fix.)
      //
      // FEL-401: routed through `_stopComponentScope` (rather than the
      // formerly-inlined `_componentScopes.get(this)?.stop()`) so
      // `connected` flips to `false` here — see the function-form
      // `disconnectedCallback` for the full note.
      try {
        _stopComponentScope(this)
      } finally {
        this[S]?.dispose()
        this[S] = this[LC_SYM] = null
        this[PROPS_SYM] = null
        _scopes.delete(this)
        // §9.4 class-extension: let the base tear down its own listeners/
        // effects (e.g. AihuButton's disposer array). Last, after our scope
        // stop + MountScope dispose.
        _baseProto.disconnectedCallback?.call(this)
      }
    }
  }

  // R1 — JS property accessors on the class prototype, one per prop. Reads
  // call into the signal getter; writes flow through the same `.set` path
  // (including reflect). Userland: `el.title = 'new'` is observable.
  for (const [name] of propEntries) {
    Object.defineProperty(C.prototype, name, {
      configurable: true,
      enumerable: true,
      get(this: InstanceType<typeof C>) {
        return this[PROPS_SYM]?.[name]?.()
      },
      set(this: InstanceType<typeof C>, v: unknown) {
        const props = this[PROPS_SYM]
        // Pre-connect: signals not built yet (PROPS_SYM null). Buffer the write
        // per prop (exact value/type, no stringification) so _build() can seed
        // it — otherwise the write is silently dropped and the prop reverts to
        // its default. Post-connect: write straight through to the signal.
        if (props !== null) props[name]?.set(v)
        else (this[PENDING_SYM] ??= new Map()).set(name, v)
      },
    })
  }

  return C
}

// ─── R1 helpers ────────────────────────────────────────────────────────────

/** kebab-case a camelCase identifier (`myProp` → `my-prop`). Used for
 * the default `attribute:` mapping when the userland did not override.
 * Acceptance: matches Lit's reactive-element kebab-cased attribute default. */
function _kebab(s: string): string {
  return s.replace(/[A-Z]/g, (c, i) => (i === 0 ? c.toLowerCase() : `-${c.toLowerCase()}`))
}

/** Default attribute → typed value conversion when no `converter` is
 * supplied. Identity for strings (raw attribute string), Number coercion
 * for numbers, presence for booleans, JSON.parse for everything else.
 * NaN-guard: bad number attributes fall back to `fallback` (the declared
 * default).  Failed JSON.parse falls back to `fallback`. */
function _convert(raw: string | null, def: PropDef, fallback: unknown): unknown {
  if (def.converter) return def.converter(raw)
  // Boolean: attribute presence (null = absent = false, anything else = true).
  // Detect a boolean prop by inspecting the declared default's type.
  if (typeof fallback === 'boolean') return raw !== null
  if (raw === null) return fallback
  if (typeof fallback === 'number') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : fallback
  }
  if (typeof fallback === 'string') return raw
  // Object / array / unknown — JSON parse with defensive fallback.
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

/** Stringify a value for `reflect: true` attribute writes. Booleans use
 * the WHATWG attribute presence convention: `false` removes the attribute
 * (return `null`); `true` writes empty string. Numbers and strings
 * `String()`-coerce. Objects JSON.stringify with a defensive fallback. */
function _reflectToAttr(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return v ? '' : null
  if (typeof v === 'number' || typeof v === 'string') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return null
  }
}

/** @internal */
export function _hmrReplace(element: HTMLElement, newSetup: Setup): void {
  if (_mount === null) return
  // Stop the OLD component scope BEFORE replacing — user teardown (onCleanup,
  // onMount teardowns, composable effects) runs before DOM teardown, same
  // order as disconnect. The `finally` is throw containment: a throwing
  // disposer must not skip the MountScope dispose.
  //
  // NOTE (pre-existing bug, separate fix): the replacement MountScope below
  // is stored ONLY in the `_scopes` WeakMap, but `disconnectedCallback`
  // disposes `this[S]` (the per-class symbol slot, unreachable from here) —
  // so a post-HMR disconnect already leaks the replacement MountScope. The
  // component scope avoids replicating that divergence by living in the
  // module-level `_componentScopes` map, which both paths share.
  //
  // Routed through `_stopComponentScope` (flips the OLD connection's
  // `connected` to `false`, same as a real disconnect) rather than an
  // inlined `.stop()` — consistent with the FEL-401 fix elsewhere in this
  // module.
  try {
    _stopComponentScope(element)
  } finally {
    _scopes.get(element)?.dispose()
    _scopes.delete(element)
  }
  const host = element.shadowRoot ?? element
  // Mirror the _build + connectedCallback flow: fresh scope + fresh _LC so
  // the replacement setup's onCleanup/onMount don't throw SCR-R0011/R0010,
  // and owner-context entry so provide/inject resolves the DI chain.
  // es.run wraps ONLY newSetup — NOT the _mount around it (P0-2a).
  const es = effectScope(true)
  _componentScopes.set(element, es)
  // Lifecycle-ownership plan: a fresh `connected`/`LifecycleHost` for the
  // replacement scope too, so `ctx.connected`/`onCommit` keep working
  // across an HMR replace exactly as they do across a real reconnect.
  const connected = _installLifecycle(element, es)
  const lc: _LC = { m: [], a: [], ac: [], r: [] }
  ;(element as unknown as Record<symbol, unknown>)[LC_SYM] = lc
  try {
    _cur = lc
    const prevCtx = _enterOwnerContext(element as unknown as Record<symbol, unknown>)
    let tree: ReturnType<Setup>
    try {
      tree = es.run(() =>
        newSetup({ host, element, connected } as SetupContext),
      ) as ReturnType<Setup>
    } finally {
      _exitContext(prevCtx)
      _cur = null
    }
    _scopes.set(element, _mount(tree!, host))
    runWithScope(es, () => _runMounts(lc))
  } catch (err) {
    // A throwing newSetup/_mount/_runMounts must not leave the fresh scope
    // running (orphaned pre-throw effects would re-run against a
    // half-initialized component). Mirror the connectedCallback catch.
    try {
      _stopComponentScope(element)
    } catch (stopErr) {
      console.error('[aihu] scope stop failed during HMR replace:', stopErr)
    }
    throw err
  }
}

// Lifecycle exports — exported only from index.ts
// Server-render sink: a server render calls the compiled setup directly, so
// `_cur` is null by construction and every registration below would throw. A
// render that never mounts has nothing to register, so it no-ops — while a
// null `_cur` in the BROWSER stays a genuine authoring error and still throws.
// See ssr-lifecycle.ts for why the flag lives in its own leaf module.

export function _onMount(fn: () => void | (() => void)): void {
  if (!_cur) {
    if (_inSsrLifecycle()) return
    throw new RuntimeError('SCR-R0010', 'no owner')
  }
  _cur.m.push(fn)
}

/**
 * Run `fn` after the browser's next layout opportunity, before paint.
 * docs/plans/2026-07-24-lifecycle-ownership-dx.md §2.2.
 *
 * Registered via the `_cur` owner pointer — the SAME convention `onMount`
 * uses, so this bare export is **setup-only**: `_cur` is non-null only for
 * the duration of `_build()`'s `es.run(setup)` call. This is a TIGHTER gate
 * than `LifecycleHost.onCommit` (§6.3, `@aihu/signals/lifecycle`), which
 * resolves via `getCurrentScope()` and is therefore also legal from inside
 * an `onMount` body — that wider window is deliberate for `@aihu/use`'s
 * future `tryOnCommit` (deferred; not part of this track), not for this
 * entry point. Delegates to the exact same underlying queue via
 * `getLifecycleHost()` — there is only one commit mechanism, just two
 * differently-gated ways to reach it.
 *
 * Fires once per connection, in registration order, coalesced with every
 * other pending commit into one rAF callback per frame; skipped entirely
 * if the element disconnects before the frame fires (gated on `connected`).
 * Runs inside `runWithScope(componentScope)`, so effects it creates are
 * scope-owned and a returned teardown joins the unified LIFO list —
 * identical to `onMount`'s contract.
 *
 * @throws RuntimeError (SCR-R0014) when called outside setup, OR when
 * called from a position where `_cur` is set but the current scope is not
 * (or is no longer) the component root scope — e.g. synchronously inside an
 * `effect()` body during setup (signals P0-1 clears the current scope for
 * the duration of every effect run) or inside a nested `effectScope().run()`
 * during setup. Both shapes are misuse of this setup-only entry point; the
 * design's fail-loud contract (§7.2) requires this to throw rather than
 * silently drop the callback. Use `getLifecycleHost()?.onCommit(fn)`
 * directly for the wider, scope-resolved entry point instead.
 */
export function _onCommit(fn: () => void | (() => void)): void {
  if (!_cur) {
    if (_inSsrLifecycle()) return
    throw new RuntimeError('SCR-R0014', 'no owner')
  }
  // `_cur` is non-null for the whole duration of `_build()`'s
  // `es.run(setup)` call, but the CURRENT SCOPE tracked by
  // `getCurrentScope()` can diverge from it within that window — e.g.
  // inside a synchronous `effect()` body (P0-1 clears the current scope for
  // every effect run) or inside a nested `effectScope().run()`. In either
  // case `getLifecycleHost()` resolves no host, and that must fail loud
  // (matching `onMount`'s fail-loud sibling) rather than silently drop the
  // callback via `?.`.
  const host = getLifecycleHost()
  if (host === undefined) throw new RuntimeError('SCR-R0014', 'no owner')
  host.onCommit(fn)
}

/** Register a callback after every Arbor DOM patch in this component. */
export function _onAfterRender(fn: () => void): () => void {
  if (!_cur) {
    if (_inSsrLifecycle()) return () => {}
    throw new RuntimeError('SCR-R0010', 'no owner')
  }
  const callbacks = _cur.r
  const entry = (): void => fn()
  callbacks.push(entry)
  let active = true
  const dispose = (): void => {
    if (!active) return
    active = false
    const index = callbacks.indexOf(entry)
    if (index !== -1) callbacks.splice(index, 1)
  }
  onScopeDispose(dispose)
  return dispose
}

// Unified into the component scope (effect-scope plan §2): onCleanup routes
// into the scope's LIFO disposer list via onScopeDispose, alongside
// composable effect handles and onMount-returned teardowns. Fail-loud
// contract preserved: no ACTIVE scope ⇒ SCR-R0011 (never a silent no-op) —
// the `.active` check matters because `runWithScope(stoppedScope, ...)` (the
// async re-entry path) leaves a stopped scope current, and onScopeDispose
// would silently drop the callback in prod.
export function _onCleanup(fn: () => void): void {
  const s = getCurrentScope()
  if (s === undefined || !s.active)
    throw new RuntimeError(
      'SCR-R0011',
      "no active scope for onCleanup — inside an effect, use the effect's onCleanup argument",
    )
  onScopeDispose(fn)
}

// R2 (Director r6 §3): four-callback $lifecycle extension. `onAdopt` and
// `onAttributeChange` mirror the platform adoptedCallback /
// attributeChangedCallback. Both register at setup() time per the same
// _cur-pointer convention used by onMount/onCleanup; the host class
// dispatches into these arrays from the platform-callback methods.
export function _onAdopt(fn: () => void): void {
  if (!_cur) {
    if (_inSsrLifecycle()) return
    throw new RuntimeError('SCR-R0012', 'no owner')
  }
  _cur.a.push(fn)
}

export function _onAttributeChange(
  fn: (name: string, oldValue: string | null, newValue: string | null) => void,
): void {
  if (!_cur) {
    if (_inSsrLifecycle()) return
    throw new RuntimeError('SCR-R0013', 'no owner')
  }
  _cur.ac.push(fn)
}
