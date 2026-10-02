/**
 * @aihu/router — browser-side reactive runtime (arch-5 M1).
 *
 * Provides:
 * - `RouteContext` — context token carrying the active router + reactive route signal
 * - `createRouteSignal(router)` — wraps the router in a `Signal<MatchResult | null>`
 *   driven by `popstate` + programmatic navigation
 * - `useRoute()` — read the current `MatchResult` from the active context (used by
 *   the `$route` macro lowering)
 * - `useRouter()` — get the active router instance
 * - Compiler hook seams for `$beforeNavigate` / `$afterNavigate`:
 *   `__router_registerBeforeGuard`, `__router_registerAfterGuard`
 * - `navigate(href, opts)` — programmatic SPA navigation (used by `<a>` and
 *   `<navigate>`)
 * - `createPrefetcher(href, mode)` — `<a prefetch>` helper
 *
 * Browser-only behavior is gated on `typeof window !== 'undefined'` so the
 * module is safe to import during SSR.
 */

import { createContext, inject, provide } from '@aihu/context'
import { signal } from '@aihu/signals'
import type { MatchResult, Router } from './router.ts'

// ---------------------------------------------------------------------------
// RouteContext token
// ---------------------------------------------------------------------------

/** Value carried by `RouteContext`. */
export interface RouteContextValue {
  router: Router
  /** Reactive read accessor for the current match. */
  current: () => MatchResult | null
  /** @internal — view transitions opt-in (read by `<a>`). */
  viewTransitions?: boolean
}

/**
 * Context token for the active routing context. Provided by `<router>` and
 * read by `<a>`, `<outlet>`, `<navigate>`, and the `$route` macro.
 */
export const RouteContext = createContext<RouteContextValue | null>(null)

// ---------------------------------------------------------------------------
// createRouteSignal
// ---------------------------------------------------------------------------

const SAFE_WINDOW: Window | undefined = typeof window === 'undefined' ? undefined : window

/**
 * Wrap a `Router` in a reactive `Signal<MatchResult | null>` that updates on
 * `popstate` events and on calls to `navigate()`.
 *
 * Returns `[read, write, dispose]` — `dispose` removes the popstate listener.
 */
export function createRouteSignal(
  router: Router,
  initialPathname?: string,
): {
  read: () => MatchResult | null
  write: (m: MatchResult | null) => void
  dispose: () => void
} {
  const initial =
    initialPathname !== undefined
      ? router.match(initialPathname)
      : SAFE_WINDOW
        ? router.match(SAFE_WINDOW.location.pathname)
        : null
  const [read, set] = signal<MatchResult | null>(initial)

  const onPopState = (): void => {
    if (!SAFE_WINDOW) return
    set(router.match(SAFE_WINDOW.location.pathname))
  }

  if (SAFE_WINDOW) {
    SAFE_WINDOW.addEventListener('popstate', onPopState)
  }

  const dispose = (): void => {
    if (SAFE_WINDOW) SAFE_WINDOW.removeEventListener('popstate', onPopState)
  }

  return { read, write: set, dispose }
}

// ---------------------------------------------------------------------------
// Active context helpers (used by macro lowering and components)
// ---------------------------------------------------------------------------

/**
 * Read the current matched route from the nearest `<router>` context.
 *
 * `$route currentRoute` lowers to `const currentRoute = computed(() => useRoute())`.
 */
export function useRoute(): MatchResult | null {
  const ctx = inject(RouteContext)
  if (!ctx) return null
  return ctx.current()
}

/** Get the active `Router` instance from the nearest `<router>` context. */
export function useRouter(): Router | null {
  const ctx = inject(RouteContext)
  return ctx ? ctx.router : null
}

/** Provide the route context (used by `<router>` SFC). */
export function provideRouteContext(value: RouteContextValue): void {
  provide(RouteContext, value)
}

/**
 * @internal — compiler-emitted entry point for `$beforeNavigate(fn)` macro
 * lowering. Looks up the active router via context. If no router is active
 * (e.g. SSR or component mounted outside `<router>`), the registration is a
 * no-op — the developer-facing `$beforeNavigate` is documented to require a
 * router ancestor.
 */
export function __router_registerBeforeGuard(
  fn: Parameters<Router['registerBeforeGuard']>[0],
): () => void {
  const ctx = inject(RouteContext)
  if (!ctx) return () => {}
  return ctx.router.registerBeforeGuard(fn)
}

/** @internal — compiler-emitted entry point for `$afterNavigate(fn)`. */
export function __router_registerAfterGuard(
  fn: Parameters<Router['registerAfterGuard']>[0],
): () => void {
  const ctx = inject(RouteContext)
  if (!ctx) return () => {}
  return ctx.router.registerAfterGuard(fn)
}

// ---------------------------------------------------------------------------
// navigate() — programmatic SPA navigation
// ---------------------------------------------------------------------------

export interface NavigateOptions {
  /** Use `history.replaceState` instead of `pushState`. */
  replace?: boolean
  /** Wrap navigation in `document.startViewTransition()` when supported. */
  viewTransitions?: boolean
}

/**
 * Programmatically navigate to `href` within the active router. Runs the
 * before-guard chain, updates `history`, drives the route signal, and runs
 * the after-guard chain.
 *
 * Returns a promise that resolves with the navigation decision.
 */
export async function navigate(
  href: string,
  opts: NavigateOptions = {},
): Promise<'navigated' | 'cancelled' | 'no-router' | 'no-match'> {
  if (!SAFE_WINDOW) return 'navigated' // SSR: trust the user's redirect handling
  const ctx = inject(RouteContext)
  if (!ctx) {
    // Fall back to a hard nav so `<a>` outside a router still works
    if (opts.replace) SAFE_WINDOW.location.replace(href)
    else SAFE_WINDOW.location.assign(href)
    return 'no-router'
  }
  return navigateWithContext(ctx, href, opts)
}

/**
 * @internal — context-bound navigation. Captures the active route context
 * up-front so the rest of the (async) flow does not depend on the
 * synchronous `inject()` lookup. Required because `runWithContext` clears
 * the active context on the synchronous return — anything the guard chain
 * triggers asynchronously (redirect recursion, after-guards) must reuse the
 * captured `ctx` instead of re-injecting.
 */
async function navigateWithContext(
  ctx: RouteContextValue,
  href: string,
  opts: NavigateOptions,
): Promise<'navigated' | 'cancelled' | 'no-router' | 'no-match'> {
  if (!SAFE_WINDOW) return 'navigated'
  const url = new URL(href, SAFE_WINDOW.location.href)
  const target = ctx.router.match(url.pathname)
  if (!target) {
    if (opts.replace) SAFE_WINDOW.location.replace(href)
    else SAFE_WINDOW.location.assign(href)
    return 'no-match'
  }
  const from = ctx.current()
  const decision = await ctx.router.runBeforeGuards(target, from)
  if (decision === 'cancel') return 'cancelled'
  if (typeof decision === 'object' && 'redirect' in decision) {
    const redirOpts: NavigateOptions = { replace: true }
    if (opts.viewTransitions !== undefined) redirOpts.viewTransitions = opts.viewTransitions
    return navigateWithContext(ctx, decision.redirect, redirOpts)
  }

  const commit = (): void => {
    if (opts.replace) SAFE_WINDOW.history.replaceState(null, '', href)
    else SAFE_WINDOW.history.pushState(null, '', href)
    setRouteSignal(ctx, target)
    // A replace (filters, query updates) keeps the reader's place; a push lands
    // at the #fragment target or the top, as a full page load would.
    if (opts.replace) navigateToFragment(url.hash)
    else scrollAfterNavigation(url.hash)
  }

  const useVT =
    (opts.viewTransitions ?? ctx.viewTransitions ?? false) &&
    typeof (document as unknown as { startViewTransition?: unknown }).startViewTransition ===
      'function'

  if (useVT) {
    const start = (
      document as unknown as {
        startViewTransition: (cb: () => void) => { finished: Promise<void> }
      }
    ).startViewTransition
    const transition = start(commit)
    await transition.finished.catch(() => {})
  } else {
    commit()
  }

  ctx.router.runAfterGuards(target, from)
  return 'navigated'
}

/** @internal — Whether a link click belongs to client-side route navigation. */
export function shouldInterceptLinkClick(event: MouseEvent, anchor: HTMLAnchorElement): boolean {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    anchor.hasAttribute('download') ||
    (anchor.target !== '' && anchor.target.toLowerCase() !== '_self')
  ) {
    return false
  }

  const target = new URL(anchor.href, SAFE_WINDOW?.location.href ?? 'http://localhost/')
  const current = new URL(SAFE_WINDOW?.location.href ?? 'http://localhost/')
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false
  if (target.origin !== current.origin) return false
  if (target.pathname === current.pathname && target.search === current.search && target.hash) {
    return false
  }
  return true
}

/** @internal — Compare a link destination with the current route pathname. */
export function isActiveRouteLink(href: string, pathname: string): boolean {
  const base = SAFE_WINDOW?.location.href ?? 'http://localhost/'
  return new URL(href, base).pathname === pathname
}

/**
 * @internal — Scroll after an in-app push navigation: to the `#fragment`
 * target when the URL has one, otherwise to the top of the page. Without this
 * an SPA navigation leaves the new page at the previous page's scroll offset.
 * Back/forward don't call it, so the browser's own scroll restoration applies.
 */
export function scrollAfterNavigation(hash: string): void {
  if (hash && hash !== '#') navigateToFragment(hash)
  else SAFE_WINDOW?.scrollTo(0, 0)
}

function navigateToFragment(hash: string): void {
  if (!SAFE_WINDOW || !hash || hash === '#') return
  let id: string
  try {
    id = decodeURIComponent(hash.slice(1))
  } catch {
    return
  }
  if (!id) return

  const focusTarget = (element: Element): void => {
    element.scrollIntoView({ behavior: 'auto' })
    if (!(element instanceof HTMLElement)) return
    const hadTabIndex = element.hasAttribute('tabindex')
    if (!hadTabIndex) element.setAttribute('tabindex', '-1')
    element.focus({ preventScroll: true })
    if (!hadTabIndex) {
      const clearTabIndex = (): void => {
        element.removeAttribute('tabindex')
        element.removeEventListener('blur', clearTabIndex)
      }
      element.addEventListener('blur', clearTabIndex)
    }
  }
  const resolveTarget = (): Element | null =>
    document.getElementById(id) ?? document.getElementsByName(id)[0] ?? null
  const target = resolveTarget()
  if (target) {
    focusTarget(target)
  } else {
    SAFE_WINDOW.requestAnimationFrame(() => {
      const retried = resolveTarget()
      if (retried) focusTarget(retried)
    })
  }
}

// ---------------------------------------------------------------------------
// Route signal write registry
// ---------------------------------------------------------------------------
//
// `provideRouteContext` always pairs the context with a writer through this
// WeakMap so that programmatic `navigate()` calls can drive the same signal
// the popstate listener writes to. Keyed on the `RouteContextValue` instance
// so multiple routers in the same page do not collide.
const writerByContext = new WeakMap<RouteContextValue, (m: MatchResult | null) => void>()

/** @internal */
export function bindRouteSignalWriter(
  value: RouteContextValue,
  write: (m: MatchResult | null) => void,
): void {
  writerByContext.set(value, write)
}

function setRouteSignal(value: RouteContextValue, match: MatchResult | null): void {
  const w = writerByContext.get(value)
  if (w) w(match)
}

// ---------------------------------------------------------------------------
// createPrefetcher — `<a prefetch>` (RFC-A5-012)
// ---------------------------------------------------------------------------

export type PrefetchMode = 'none' | 'hover' | 'visible'

/**
 * Build the DOM hooks needed for a prefetch-enabled `<a>`.
 *
 * Returns `{ attach, detach }` — `attach(anchor, getMatch)` wires the hover
 * or IntersectionObserver listener; `detach(anchor)` cleans up.
 */
export function createPrefetcher(mode: PrefetchMode): {
  attach: (a: HTMLAnchorElement, getMatch: () => MatchResult | null) => void
  detach: (a: HTMLAnchorElement) => void
} {
  if (mode === 'none' || !SAFE_WINDOW) {
    return { attach: () => {}, detach: () => {} }
  }

  // Track which hrefs we have already injected a <link rel="prefetch"> for.
  const prefetched = new Set<string>()

  const triggerOnce = (href: string): void => {
    if (prefetched.has(href)) return
    prefetched.add(href)
    const link = document.createElement('link')
    link.rel = 'prefetch'
    link.href = href
    link.as = 'document'
    document.head.appendChild(link)
  }

  if (mode === 'hover') {
    const cleanup = new WeakMap<HTMLAnchorElement, () => void>()
    return {
      attach(a, _getMatch) {
        const handler = (): void => triggerOnce(a.href)
        a.addEventListener('mouseenter', handler, { once: true, passive: true })
        a.addEventListener('focus', handler, { once: true, passive: true })
        cleanup.set(a, () => {
          a.removeEventListener('mouseenter', handler)
          a.removeEventListener('focus', handler)
        })
      },
      detach(a) {
        cleanup.get(a)?.()
        cleanup.delete(a)
      },
    }
  }

  // mode === 'visible'
  const ioCleanup = new WeakMap<HTMLAnchorElement, () => void>()
  if (typeof IntersectionObserver === 'undefined') {
    return { attach: () => {}, detach: () => {} }
  }
  return {
    attach(a, _getMatch) {
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            triggerOnce(a.href)
            io.disconnect()
            ioCleanup.delete(a)
          }
        }
      })
      io.observe(a)
      ioCleanup.set(a, () => io.disconnect())
    },
    detach(a) {
      ioCleanup.get(a)?.()
      ioCleanup.delete(a)
    },
  }
}
