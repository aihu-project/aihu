import componentRegistry from 'virtual:aihu-components'
import layouts from 'virtual:aihu-layouts'
import routes from 'virtual:aihu-routes'
import { mount } from '@aihu/arbor'
import { hydrate } from '@aihu/arbor/hydrate'

/** Replaced with `false` by rolldown in the published build (see rolldown.config.ts). */
declare const __DEV__: boolean

import type { MatchResult, RouteContextValue, RouteDefinition, RouteHead } from '@aihu/router'
import { bindRouteSignalWriter, createRouter, provideRouteContext } from '@aihu/router'
import { _setHydrate, _setMount, _setSignal, _withOwnerContext } from '@aihu/runtime'
// Pure subpath — NOT the @aihu/server barrel. The barrel reaches loader.ts +
// the lazy native loader; importing it would risk dragging node:-bearing code
// into the browser client bundle and trip check:runtime-purity. head-lowering.ts
// is side-effect free (only the web-standard URL), so this stays node:-free.
import type { HeadConfig } from '@aihu/server/head-lowering'
import { routeHeadToSsrHead } from '@aihu/server/head-lowering'
import { signal } from '@aihu/signals'
import { hydrateStores } from '@aihu/store'
import { applyHeadToDocument, clearManagedHead } from './head-apply.ts'

/**
 * Rendering mode passed from the server config into the client bootstrap.
 * Inlined here to avoid importing @aihu/server into the client bundle.
 * Must stay in sync with RenderingMode in @aihu/server.
 */
export type AppRenderingMode = 'ssr' | 'spa' | 'hybrid'

/** Inline runtime configuration accepted by createApp(). All fields optional. */
export interface AppConfig {
  /** Id of the outlet element in index.html. Default: 'outlet' */
  outletId?: string
  /**
   * App-level values hoisted into globalThis before any component runs.
   * Use this for singletons (db clients, auth helpers, i18n) that are
   * referenced as bare identifiers inside @state blocks.
   *
   * NOTE — this is NOT `@aihu/context`'s `provide()`. Despite the shared name
   * it is a different mechanism: values land on `globalThis`, not in a context
   * token, and `inject(Token)` will never see them. For real token-based DI at
   * the app root, use {@link AppConfig.context} below.
   *
   * @example
   * createApp({ provide: { supabase, checkAuth } })
   */
  provide?: Record<string, unknown>
  /**
   * App-root context scope. Runs ONCE at bootstrap, inside a real
   * `@aihu/context` scope owned by the outlet element — so every
   * `provide(Token, value)` made here is visible to `inject(Token)` in every
   * page, layout and nested component the app renders.
   *
   * This is the app-root seam that several packages' docs already assume
   * exists ("provide at app root" — `@aihu/magna`'s `MagnaFetchToken`,
   * `@aihu-plugin/data`'s `ResourceStoreToken`). Without it, `provide()` at
   * bootstrap lands in no scope at all and `inject()` silently returns the
   * token default forever — `inject` falls back rather than throwing, so the
   * failure is invisible. `@aihu/app` installs the router's own `RouteContext`
   * through the same scope, immediately BEFORE this callback runs, so an app
   * may also deliberately override it.
   *
   * Must be synchronous: `provide()` only writes to the active scope, and the
   * scope is torn down when the callback returns. Providing from an `await`ed
   * continuation is a silent no-op.
   *
   * @example
   * import { provide } from '@aihu/context'
   * import { MagnaFetchToken, createMagnaFetch } from '@aihu/magna'
   *
   * createApp({
   *   context: () => provide(MagnaFetchToken, createMagnaFetch({ url })),
   * })
   */
  context?: () => void
  /**
   * Rendering mode from the server config. Controls whether the client
   * wires the hydration function into the runtime.
   *
   * - 'ssr' | 'hybrid' (default): wires _setHydrate so the client can
   *   take over from server-rendered HTML without re-creating DOM.
   * - 'spa': skips _setHydrate — no SSR HTML to hydrate, mount-only.
   *
   * Pass `defineAihuConfig(…).rendering?.mode` from your server config.
   * Default: 'ssr' (hydration wired).
   */
  rendering?: { mode?: AppRenderingMode }
  /**
   * Site-level config. `site.url` is the absolute base URL used to resolve
   * relative per-route `canonical` / `og:*` / `twitter:*` values into absolute
   * URLs as the head is applied on client navigation (mirrors the SSG path's
   * `AihuConfig.site.url`). When absent, relative values are emitted unchanged.
   */
  site?: { url?: string }
  /**
   * Global `<head>` defaults (typically `aihu.config.ts`'s `app.head`). On every
   * navigation these defaults are folded under the active route's head
   * (`routeHeadToSsrHead`'s `globalHead`) and re-applied — so a route that omits
   * a field falls back to the global default, and global tags persist across
   * navigations while route-only tags are cleaned up.
   */
  head?: HeadConfig
}

/**
 * Handle returned by {@link createApp} for driving the running app.
 */
export interface AppHandle {
  /**
   * Switch the active layout on the current route without navigating.
   * `setLayout(name)` forces that layout; `setLayout(null)` forces none. The
   * override is reset on the next navigation. Wire it to a UI toggle or expose
   * it to an `@agent` action (e.g. `setLayout("compact")`).
   */
  setLayout(name: string | null): Promise<void>
}

/**
 * O1c: import (and thereby defineElement) every component a route references,
 * from the compile-time `virtual:aihu-components` registry, so a page's child
 * custom elements are defined before the page element mounts. Unknown tags are
 * skipped (a tag with no registry entry — e.g. a globally-registered element —
 * is not an error). Returns the in-flight import promises.
 */
function registerRouteComponents(route: RouteDefinition): Promise<unknown>[] {
  return registerComponents(route.components)
}

/**
 * F2: shared core of route-scoped registration — kick off the registry loader
 * for each tag, skipping tags with no registry entry. Used for both a PAGE's
 * `route.components` (O1c, above) and a LAYOUT entry's `components`
 * (`virtual:aihu-layouts`, scanned from the layout SFC's template by the
 * router's `genL`), so components referenced inside a layout — not the page —
 * are also defined before mount instead of relying on prop-on-upgrade (#406)
 * or an eager import.
 */
function registerComponents(tags: readonly string[] | undefined): Promise<unknown>[] {
  return (tags ?? [])
    .map((t) => componentRegistry[t])
    .filter((load): load is () => Promise<unknown> => typeof load === 'function')
    .map((load) => load())
}
// F1: publish the registrar for compiler-emitted code. The nested `<outlet>`
// boundary (`createOutletBoundary` in the standalone compiler) is
// emitted JS with no build-graph import, so it cannot import
// virtual:aihu-components itself — instead it calls this global optional-chained
// (`globalThis.__aihuRegisterRouteComponents?.(m.route)`) to load a route's
// referenced components alongside its page module. A standalone @aihu/router
// app that never loads @aihu/app leaves the global undefined and the outlet
// simply skips component registration. Published at module top level (like the
// registry import itself) so it is live before any component code runs; typed
// in virtual.d.ts, cast here because the hook's parameter is deliberately wider
// (structural `{ components? }`) than RouteDefinition.
;(globalThis as Record<string, unknown>).__aihuRegisterRouteComponents = registerRouteComponents

/**
 * Bootstrap the aihu SPA.
 *
 * - Wires the aihu runtime (mount + signal) — idempotent if called multiple times
 * - Creates the router from virtual:aihu-routes
 * - Renders the current route (wrapped in its `layout`, if any)
 * - Installs SPA click interception and popstate listeners
 *
 * Returns an {@link AppHandle} for runtime control (e.g. dynamic layout switching).
 *
 * @example
 * // src/main.ts
 * import { createApp } from '@aihu/app/client'
 * const app = createApp()
 * app.setLayout('compact') // switch layout on the current route
 */
/**
 * Flat per-attribute route params (A4 protocol — replaces the JSON route
 * attribute). Written out three times: on the adopted page element, on an
 * adopted layout-less page, and on a freshly created one.
 */
function stampParams(el: Element, params: Record<string, string> | undefined): void {
  for (const key in params) el.setAttribute(key, String(params[key]))
}

export function createApp(config?: AppConfig): AppHandle {
  // Hoist provided values into globalThis before any component runs so that
  // @state blocks can reference them as bare identifiers.
  if (config?.provide) {
    Object.assign(globalThis, config.provide)
  }

  // Wave-3 state channel: adopt the server's `__aihu_state__` envelope
  // ({ v: 1, stores, signals? }) SYNCHRONOUSLY, before the router renders
  // anything. `hydrateStores` must precede the first `useStore()` in any
  // component setup — createApp runs before any route module is imported
  // (and so before any custom element is defined or connected), which is
  // that guarantee. The `signals` record is held and published under the
  // initial route's tag (see render()) so the runtime's first-render
  // adoption path (defineComponent's connectedCallback) hands it to
  // arbor's `hydrate()` for signal pre-seeding.
  let ssrSignals: Record<string, unknown> | null = null
  try {
    const env = JSON.parse(document.getElementById('__aihu_state__')?.textContent ?? '') as {
      v?: number
      stores?: Record<string, Record<string, unknown>>
      signals?: Record<string, unknown>
    }
    if (env?.v === 1) {
      if (env.stores) hydrateStores(env.stores)
      ssrSignals = env.signals ?? {}
    }
  } catch {
    // No state script, or a malformed one: hydrate fresh (client re-derives).
  }

  // Wire runtime — null-guarded in @aihu/runtime, safe to call multiple times
  _setMount(mount)
  _setSignal(signal as Parameters<typeof _setSignal>[0])
  if (config?.rendering?.mode !== 'spa') {
    _setHydrate(hydrate as Parameters<typeof _setHydrate>[0])
  }

  const outletId = config?.outletId ?? 'outlet'
  const outletEl = document.getElementById(outletId)
  if (!outletEl) {
    throw new Error(
      `@aihu/app: no element with id="${outletId}" found. Add <div id="${outletId}"></div> to your index.html`,
    )
  }
  const outlet: HTMLElement = outletEl

  const router = createRouter(routes)

  // ── App-root context scope ────────────────────────────────────────────────
  //
  // ROOT CAUSE this fixes: `@aihu/app` had NO context-participating app root.
  // `@aihu/context`'s `provide()` is component-scoped — only a component's
  // `_build()` installs a scope (`_enterOwnerContext` in
  // packages/runtime/src/define-component.ts) — and `createApp` is bootstrap,
  // not a component. So a `provide()` here landed in no scope at all and every
  // descendant's `inject()` fell back to the token default, silently, forever.
  //
  // Two consequences, one cause:
  //   1. `RouteContext` was provided ONLY by the standalone `<router>` element
  //      path (`aihu-router.aihu` / the compiler's `createRouterBoundary`), so
  //      `useRoute()` / `useRouter()` / `useRouteParams()` were dead no-ops in
  //      the PRIMARY app model — including `output: 'static'` SSG apps.
  //   2. Tokens whose docs say "provide at app root" (`@aihu/magna`'s
  //      `MagnaFetchToken`, `@aihu-plugin/data`'s `ResourceStoreToken`) had no
  //      such root to be provided from.
  //
  // The fix is therefore the general seam, not a RouteContext special case:
  // `_withOwnerContext` installs a context scope OWNED BY THE OUTLET ELEMENT —
  // a DOM ancestor of every page and layout this app renders. The runtime's
  // per-component `_enterOwnerContext` walks `parentNode` / shadow `host`
  // looking for ANY node carrying a provides object, so rooting the chain on
  // the outlet needs no synthetic wrapper component and no change to
  // `inject`'s hot path. `config.context` opens the same scope to app authors.
  //
  // Note `config.provide` (above) is an unrelated `globalThis` hoist that never
  // touches `@aihu/context`; the name collision is part of why this went
  // unnoticed. See the AppConfig docs.
  //
  // The match signal is written from `render()` (below), so `ctx.current()` is
  // reactive and tracks navigation. Binding it as the route-signal writer also
  // makes `@aihu/router`'s programmatic `navigate()` work here: it now finds a
  // context (instead of falling back to a full page load) and drives a real
  // outlet re-render through `renderNav`.
  const [readMatch, writeMatch] = signal<MatchResult | null>(null)
  const routeContext: RouteContextValue = { router, current: readMatch }
  bindRouteSignalWriter(routeContext, renderNav)
  _withOwnerContext(outlet, () => {
    provideRouteContext(routeContext)
    // Author-supplied providers run second so an app may deliberately override
    // the framework's own tokens (both write to the same scope; last wins).
    config?.context?.()
  })

  // Per-route <head> wiring (B5, SEO arc). `siteUrl` resolves relative
  // canonical/OG/Twitter URLs to absolute; `globalHead` (app.head) is folded
  // under each route's head so defaults persist across navigations.
  const siteUrl = config?.site?.url
  const globalHead = config?.head

  /**
   * Update the live `document.head` for the active route. Lowers the route's
   * head (merged with the global defaults) into a renderable HeadConfig and
   * applies it — `applyHeadToDocument` first removes the prior route's managed
   * tags, so stale title/canonical/OG/JSON-LD never accumulate across nav.
   *
   * When there is no route head AND no global defaults, the previously-managed
   * per-page tags are simply cleared (nothing to re-apply).
   */
  function updateHead(head: RouteHead | undefined): void {
    if (head === undefined && globalHead === undefined) {
      clearManagedHead()
      return
    }
    const lowered = routeHeadToSsrHead(head, {
      ...(siteUrl !== undefined ? { siteUrl } : {}),
      ...(globalHead !== undefined ? { globalHead } : {}),
    })
    applyHeadToDocument(lowered)
  }

  // Dynamic layout switching (Step 2). `layoutOverride` lets a human toggle or
  // an `@agent` action swap the active layout WITHOUT navigating:
  //   - `undefined` → follow the matched route's declared `layout`
  //   - `null`      → force NO layout (render at the root outlet)
  //   - `"<name>"`  → force that layout
  // It is transient: navigating resets it so each route shows its declared
  // layout again. `currentMatch` is the last rendered match so `setLayout` can
  // re-render the same route under the new layout.
  let currentMatch: MatchResult | null = null
  let layoutOverride: string | null | undefined

  // First-render DOM adoption: only the VERY FIRST render may adopt the
  // document's prerendered outlet content (later renders are client
  // navigations over client-built DOM). Read-and-clear at the top of render()
  // so a failed probe can never re-arm.
  let firstRender = true

  async function render(match: MatchResult | null): Promise<void> {
    currentMatch = match
    const mayAdopt = firstRender
    firstRender = false
    // Publish to the route context BEFORE any page/layout element is created,
    // so a component's `useRoute()` — read during its synchronous setup — sees
    // the match it is being rendered for, not the previous one.
    writeMatch(match)
    if (!match) {
      // Check for a 404/not-found route by convention before falling back inline
      const notFoundRoute = (routes as RouteDefinition[]).find(
        (r) => r.pattern === '*' || r.name === 'not-found',
      )
      if (notFoundRoute) {
        // Load the 404 page module AND its referenced components together (O1c).
        await Promise.all([notFoundRoute.module(), ...registerRouteComponents(notFoundRoute)])
        const tag = notFoundRoute.name
        if (tag?.includes('-')) {
          updateHead(notFoundRoute.head)
          outlet.replaceChildren(document.createElement(tag))
          return
        }
      }
      // Inline fallback 404 — drop the prior route's head, fall back to globals.
      updateHead(undefined)
      const p = document.createElement('p')
      p.style.cssText = 'font-family:system-ui;padding:2rem;color:#888'
      p.textContent = '404 — page not found'
      outlet.replaceChildren(p)
      return
    }

    // Reflect the active route's <head> on the live document before rendering
    // its element, so title/meta/canonical/JSON-LD match the page being shown.
    updateHead(match.route.head)

    const tag = match.route.name

    // First render only: publish the SSR signal snapshot under this page's tag
    // so the runtime's adoption path (`__aihu_state__[tag]` in
    // defineComponent's connectedCallback) hands it to arbor's `hydrate()` for
    // pre-seeding. MUST happen BEFORE the module imports below: when the
    // prerendered element is already in the document, `customElements.define`
    // (a side effect of the import) upgrades it and runs its connectedCallback
    // synchronously — adoption reads the snapshot then, not at
    // createElement time. Consumed once — later navigations are client
    // renders with no server snapshot.
    if (ssrSignals && tag?.includes('-')) {
      const g = globalThis as { __aihu_state__?: Record<string, unknown> }
      ;(g.__aihu_state__ ??= {})[tag] = ssrSignals
      ssrSignals = null
    }

    // Layout resolution — needed BEFORE the imports so the adoption probe can
    // compare the prerendered shape against what this render would build.
    // Override (dynamic switch) wins over the route's declared layout.
    const layoutName =
      layoutOverride === undefined ? match.route.layout : (layoutOverride ?? undefined)
    const entry = layoutName ? layouts[layoutName] : undefined

    // ── First-render DOM adoption probe ──────────────────────────────────────
    //
    // If the outlet already holds EXACTLY the shape this render would build —
    // `<aihu-layout-x>…<div data-aihu-outlet><page-tag>…` (or the bare page
    // when the route has no layout) — keep it. The elements are still inert
    // (not yet defined); the imports below define them, which UPGRADES them in
    // place, and the runtime's connectedCallback adopts each host's
    // server-rendered children via its `data-aihu-ssr` marker. Route params
    // are stamped on the existing page element FIRST, so its setup reads them
    // at upgrade exactly as it would on a client-created element.
    //
    // Any mismatch falls through to the replace path below, which discards the
    // prerendered subtree — the pre-adoption behavior, still correct.
    let adopting = false
    if (mayAdopt && tag?.includes('-')) {
      const first = outlet.firstElementChild
      if (entry && first && first.localName === entry.tag) {
        const marker = first.querySelector('[data-aihu-outlet]')
        const pageEl = marker?.firstElementChild
        if (pageEl && pageEl.localName === tag) {
          stampParams(pageEl, match.params)
          adopting = true
        }
      } else if (!entry && first && first.localName === tag) {
        stampParams(first, match.params)
        adopting = true
      }
    }

    // Import the page module — registers its custom element + auto-wires
    // runtime. O1c: also import every component the route references
    // (route.json `components` → virtual:aihu-components), and — when the
    // route has a layout — the layout module plus ITS referenced components
    // (F2, `entry.components` from `virtual:aihu-layouts`), so child custom
    // elements are defined before the page/layout element mounts (or, on the
    // adoption path, before the prerendered elements upgrade).
    await Promise.all([
      match.route.module(),
      ...registerRouteComponents(match.route),
      ...(entry ? [entry.load(), ...registerComponents(entry.components)] : []),
    ])
    if (!tag?.includes('-')) return

    if (adopting) {
      // The defines above upgraded the prerendered layout + page elements in
      // place; each adopted its own server-rendered subtree (runtime
      // `data-aihu-ssr` path). Nothing to build, nothing to replace.
      return
    }

    const el = document.createElement(tag)

    // Flat per-attribute route params (A4 protocol — replaces JSON route attribute)
    stampParams(el, match.params)

    // Layout wrapping: if the matched route declares a `layout` and that layout
    // exists in the generated map, render the layout into the root outlet and
    // mount the page into the layout's `data-aihu-outlet` marker. Otherwise the
    // page mounts directly into the root outlet (original behavior).
    if (entry) {
      const layoutEl = document.createElement(entry.tag)
      // Connect the layout first so its template — including the passive outlet
      // marker — mounts synchronously, then place the page inside the marker.
      outlet.replaceChildren(layoutEl)
      const root: ParentNode = layoutEl.shadowRoot ?? layoutEl
      const marker = root.querySelector('[data-aihu-outlet]')
      if (marker) {
        marker.replaceChildren(el)
      } else {
        // Misconfigured layout (no <outlet>) — keep it visible + surface it
        // rather than silently dropping the page. The warning is an AUTHOR
        // diagnostic (it names the layout to fix), so it is `__DEV__`-gated the
        // way arbor gates its telemetry: rolldown defines `__DEV__ = false` for
        // the published build and DCEs the branch. The recovery — appending the
        // page anyway — is NOT gated; production still renders.
        if (__DEV__) console.warn(`[@aihu/app] layout "${layoutName}" has no <outlet>`)
        root.appendChild(el)
      }
      return
    }

    outlet.replaceChildren(el)
  }

  /** Navigate-and-render: a real navigation clears any transient layout override. */
  function renderNav(match: MatchResult | null): void {
    layoutOverride = undefined
    void render(match)
  }

  /**
   * Switch the active layout on the current route WITHOUT navigating.
   * - `setLayout("compact")` — render the current page under the `compact` layout.
   * - `setLayout(null)` — render the current page with no layout (root outlet).
   * The override is reset on the next navigation. Returns a promise that
   * resolves once the re-render completes.
   */
  function setLayout(name: string | null): Promise<void> {
    layoutOverride = name
    return render(currentMatch)
  }

  // Initial render
  renderNav(router.match(location.pathname))

  // SPA click interception — handles <a> links within the app
  document.addEventListener('click', (e) => {
    // Resolve the anchor across shadow boundaries. A click inside a shadow root
    // (e.g. a layout shell rendered with the default shadow mode) is retargeted
    // at the host, so `e.target` is the host element and `closest('a')` misses
    // the real <a>. `composedPath()` includes nodes inside shadow trees, ordered
    // target→root, so the first anchor in it is the innermost one clicked.
    const a = e.composedPath().find((n): n is HTMLAnchorElement => n instanceof HTMLAnchorElement)
    if (!a) return
    const href = a.getAttribute('href')
    if (!href || href.startsWith('http') || href.startsWith('//') || href.startsWith('mailto:'))
      return
    e.preventDefault()
    history.pushState({}, '', href)
    renderNav(router.match(location.pathname))
  })

  // Browser back/forward
  window.addEventListener('popstate', () => {
    renderNav(router.match(location.pathname))
  })

  return { setLayout }
}
