/**
 * SSG prerender (B4, SEO arc) — build-time only.
 *
 * When `output: 'static'`, this module runs in `viteAihuPlugin`'s `closeBundle`
 * after Vite has written the SPA build. For every STATIC route it:
 *
 *   1. Loads the route's REAL module by file path (via a short-lived Vite SSR
 *      module loader — this compiles `.aihu`/`.ts` exactly like the dev/prod
 *      pipeline). The `AdapterContext.routes` stub is NOT used here.
 *   2. Renders the route's component to content HTML with @aihu/server's
 *      `renderToString`.
 *   3. Folds the route's `<head>` (from the `.route.json` sidecar) into a
 *      renderable `HeadConfig` via `routeHeadToSsrHead`, resolving relative
 *      canonical/OG/Twitter URLs against `site.url`.
 *   4. Uses the built `index.html` as a template — injecting the per-page head
 *      into `<head>` and the rendered content into the SPA outlet — so the page
 *      ships content-ful HTML for crawlers/agents AND keeps the client bundle
 *      `<script>` tags that hydrate it into the live SPA (progressive
 *      enhancement).
 *   5. Writes `<pattern>/index.html` (and `index.html` for `/`).
 *
 * Dynamic routes (`:param` / `[param]`) are prerendered only when their module
 * exports `getStaticPaths()`; otherwise they are SKIPPED with a build warning.
 *
 * This module is build-time only (no DOM, never shipped to the client) — it
 * does NOT get a `.size-limit.json` row.
 */

import { mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve as resolvePath, sep } from 'node:path'
import { compileRouteMeta } from '@aihu/compiler'
import { clearSsrContextMap, setSsrContextMap } from '@aihu/context/ssr'
import type { RouteDefinition, RouteSegment } from '@aihu/router'
import { createRouter, provideRouteContext } from '@aihu/router'
import { readAihuComponentTag, readRouteSidecar, scanLayouts, scanPages } from '@aihu/router/plugin'
import type { HeadConfig, SsrOptions } from '@aihu/server'
import {
  _setContextFns,
  _setStoreSerializer,
  buildChildRegistry,
  type ChildModuleLike,
  type DiscoveredComponent,
  // The layout↔page outlet splice. Shared with `@aihu/router/server`'s live
  // SSR path so the two render paths compose layouts by one rule, not two.
  injectIntoOutlet,
  renderToString,
  routeHeadToSsrHead,
} from '@aihu/server'
import { _resetStoreRegistry, serializeStores } from '@aihu/store'
import type { ResolvedConfig } from 'vite'
import type { AihuConfig } from './config.ts'
import { applyHeadToHtml } from './head-apply.ts'
// The template↔page outlet splice, shared with the live SSR path (the generated
// `virtual:aihu-server-entry` imports the same function). Two copies of this
// rule is exactly how the hardcoded-outletId bug below survived.
import { DEFAULT_OUTLET_ID, injectIntoOutletId } from './ssr-document.ts'

/**
 * One param set for a dynamic route, as returned by `getStaticPaths()`.
 * Either a flat record of params, or `{ params: {...} }` (the latter mirrors
 * the common framework shape and is accepted for ergonomics).
 */
type StaticPathEntry = Record<string, string> | { params: Record<string, string> }

/** The subset of a route module shape that the prerender consumes. */
interface PrerenderRouteModule {
  /** The renderable component — `() => arbor-tree` or `{ toHtml() }`. */
  default?: unknown
  /** Dynamic-route param sets to prerender. Absent → route is skipped + warned. */
  getStaticPaths?: () => StaticPathEntry[] | Promise<StaticPathEntry[]>
  /**
   * The compiler-assigned light-DOM scope id (LDF §10 step 3), exported by
   * `@aihu/compiler`'s server-target transform for `shadowMode: 'light'`
   * components. Passed to `renderToString` as `SsrOptions.lightScopeId` so
   * the prerendered root carries `data-a="<id>"` and the component's
   * `@scope([data-a="…"])` CSS applies at first paint — before the client
   * bundle loads and the runtime re-stamps the host. Absent for shadow-mode
   * components and hand-authored modules: nothing is stamped, which is the
   * pre-existing behavior.
   */
  __aihu_light_scope__?: string
  /**
   * The component's registered custom-element tag, exported by the same
   * server-target transform. Passed as `SsrOptions.wrapTag` so the prerendered
   * output is wrapped in the REAL host element the client builds, instead of
   * the bare template root.
   *
   * Without it the shapes cannot match: SSR emits `<div class="dn-docs">`
   * while the client builds `<aihu-layout-docs>`, so the client replaces the
   * whole subtree rather than adopting it (measured: 0 of 391 prerendered
   * nodes survived hydration). Absent on hand-authored modules — nothing is
   * wrapped, which is the pre-existing behavior.
   */
  __aihu_tag__?: string
  /**
   * `__aihu_child_tags__` — every component tag this module's template
   * references. Drives the cycle check when the child registry is built.
   */
  __aihu_child_tags__?: ReadonlyArray<string>
  /**
   * `__aihu_referenced_tags__` — every component tag this module's template
   * references AT ALL, from the compiler's `// @aihu:component-tags` marker
   * (the template-AST walk that also fills `route.json`'s components array).
   *
   * A STRICTLY LARGER set than `__aihu_child_tags__`, and the right one for the
   * two diagnostics below. `__aihu_child_tags__` is derived from the emitted
   * `__aihu_schild(` call sites, which makes it exactly the set of tags the
   * compiled renderer will look up — correct for the cycle check that consumes
   * it, wrong here: a reference the emitter DECLINES under the v1 child
   * boundaries (an attribute, children, a root/dynamic path) produces no call
   * site and so no tag, and the component it names is then judged unreferenced
   * and reported to nobody. See §22.
   *
   * Absent on modules from a compiler that predates the marker, and on
   * hand-authored modules; `__aihu_child_tags__` is the fallback, so an older
   * artifact still contributes what it can rather than contributing nothing.
   */
  __aihu_referenced_tags__?: ReadonlyArray<string>
}

/** The reference-bearing shape shared by route modules and registry entries —
 * `@aihu/server`'s `ChildModuleLike` declares only the older of the two exports,
 * so this is what both are read through. See `referencesOf`. */
interface ReferencingModule {
  readonly __aihu_referenced_tags__?: ReadonlyArray<string>
  readonly __aihu_child_tags__?: ReadonlyArray<string>
}

/**
 * Every component tag `mod`'s template references, for DIAGNOSTIC purposes.
 *
 * Prefers `__aihu_referenced_tags__` (template AST, every reference) and falls
 * back to `__aihu_child_tags__` (emitted call sites, the renderable subset).
 * Not a union of the two: when the marker-derived export is present it already
 * contains everything the call-site set does, and unioning would only let a
 * stale artifact's narrower set look like new information.
 */
function referencesOf(mod: ReferencingModule): ReadonlyArray<string> {
  return mod.__aihu_referenced_tags__ ?? mod.__aihu_child_tags__ ?? []
}

/** A loader that resolves a route file path to its evaluated module. */
export type SsrModuleLoader = (filePath: string) => Promise<PrerenderRouteModule>

/** Derived route info for a single scanned page file. */
interface ScannedRoute {
  /** Absolute file path to the route module. */
  file: string
  /** URL pattern, e.g. `/`, `/about`, `/posts/:slug`. */
  pattern: string
  segments: RouteSegment[]
  /** Whether the pattern contains a `:param` / catchall segment. */
  dynamic: boolean
}

/** Result of a prerender run — surfaced for tests + logging. */
export interface PrerenderResult {
  /** outDir-relative HTML paths that were written. */
  written: string[]
  /** Human-readable warnings (e.g. skipped dynamic routes). */
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Route derivation (mirrors @aihu/router's file-router conventions)
// ---------------------------------------------------------------------------

function fileToSegments(rel: string): RouteSegment[] {
  const parts = rel
    .replace(/\\/g, '/')
    .replace(/\.[^/.]+$/, '')
    .split('/')
    .filter(Boolean)
    .map(
      (p): RouteSegment =>
        p.startsWith('[...') && p.endsWith(']')
          ? { kind: 'catchall' }
          : p.startsWith('[') && p.endsWith(']')
            ? { kind: 'param', name: p.slice(1, -1) }
            : p.startsWith(':')
              ? { kind: 'param', name: p.slice(1) }
              : { kind: 'static', path: p },
    )
  // File-router convention: a trailing `index` segment maps to its parent dir.
  if (parts.length > 0) {
    const last = parts[parts.length - 1]!
    if (last.kind === 'static' && last.path === 'index') parts.pop()
  }
  return parts
}

function segmentsToPattern(segs: RouteSegment[]): string {
  if (segs.length === 0) return '/'
  return `/${segs
    .map((s) => (s.kind === 'static' ? s.path : s.kind === 'param' ? `:${s.name}` : '*'))
    .join('/')}`
}

/** One component file whose module failed to evaluate, deferred (not yet
 * warned about) until the caller knows whether anything actually references
 * it. See `discoverComponents`'s return doc and §18 of
 * `docs/plans/2026-08-06-ssr-child-followups.md`. */
interface ComponentLoadFailure {
  readonly file: string
  readonly error: unknown
}

/** `discoverComponents`'s result: the components that loaded, and the ones
 * that didn't (warn-gating for the latter is the caller's job — see
 * `ComponentLoadFailure`). */
interface DiscoverComponentsResult {
  readonly found: DiscoveredComponent[]
  readonly failures: readonly ComponentLoadFailure[]
}

/** As much of `Dirent` as component discovery reads. */
export interface ComponentDirEntry {
  readonly name: string
  /** The directory the entry was found in. Required — see `discoverComponents`. */
  readonly parentPath?: unknown
  isFile(): boolean
}

/**
 * Lists a directory and everything under it, one flat entry list.
 *
 * A seam because the two runtimes an aihu build runs under DISAGREE about it,
 * and the disagreement is the entire reason the containment check below exists:
 * `readdir({recursive:true})` DESCENDS symlinked directories under bun — the
 * toolchain this repo builds with — and does not under Node. So the default
 * implementation's behaviour is not a fixed thing this module can reason about,
 * and neither is it something a test can choose by writing a fixture: under a
 * non-descending lister the containment branch is unreachable by construction.
 *
 * Substituting the lister is therefore the only way to exercise containment on
 * a Node-hosted test runner, which is what
 * `packages/app/tests/prerender.test.ts` does. Production always gets
 * `defaultComponentDirLister`.
 */
export type ComponentDirLister = (dir: string) => Promise<ReadonlyArray<ComponentDirEntry>>

/** The real lister: `node:fs/promises`, recursive, with file types. */
const defaultComponentDirLister: ComponentDirLister = (dir) =>
  readdir(dir, { recursive: true, withFileTypes: true })

/**
 * Discover every component under `componentsDir` and index it by the tag it
 * actually registers under.
 *
 * Indexed by the module's OWN `__aihu_tag__` export, never derived from the
 * filename. `layoutTagFor`/`componentTagFor` are the CLIENT's derivations and
 * can drift from what `defineElement` registered; a registry keyed on a guess
 * would silently miss exactly the components whose tag does not match their
 * file stem.
 *
 * Every component is loaded, rather than walking `__aihu_child_tags__`
 * transitively from each page. This is simplicity, not necessity — the real
 * reasons, not the circular "the tags cannot be read without loading them
 * anyway" this docblock used to give (true, but only because load-all was
 * already the design):
 *   - `buildChildRegistry`'s cycle check wants a GLOBAL view of the component
 *     graph. A cycle that runs through a component no page directly
 *     references is still a cycle; a per-page transitive walk would only see
 *     the components reachable from that one page and could miss it.
 *   - The extra cost is negligible for an SSG build: every `.aihu` file under
 *     the components dir is already compiled by Vite as part of the build,
 *     so loading it too is marginal, not additive (§17 also overlaps it with
 *     `Promise.all` instead of paying it serially).
 * That trade is WRONG for a Workers build, which cannot bundle every
 * component artifact whether or not a live request ever reaches it — this
 * function is the SSG-only caller. `packages/server/src/child-registry.ts`'s
 * docblock is explicit that a Workers build supplies its own tag→module
 * manifest instead of a discovery walk like this one.
 *
 * A module that fails to load does not fail the whole prerender: one broken
 * component should cost that component's markup, not the build.
 * `__aihu_schild` then fails closed on its tag, which is exactly today's
 * behaviour. The failure is reported in `failures` rather than warned here —
 * whether it deserves a warning depends on whether anything discovered
 * actually references its tag (§18), which needs the full set of
 * successfully-loaded components' `__aihu_child_tags__` and so can only be
 * decided by the caller, after this function returns.
 */
async function discoverComponents(
  root: string,
  componentsDir: string,
  loadModule: SsrModuleLoader,
  pushWarn: (msg: string) => void,
  listDir: ComponentDirLister = defaultComponentDirLister,
  // Real paths of every OTHER configured `dir.components` entry (plural config
  // is #901). A symlink under this dir that resolves inside one of these is a
  // deliberate cross-reference between two component dirs in the SAME project
  // — not an escape — so it must not be excluded here only to be re-included
  // (or not) depending on scan order. Includes this dir's own real path too;
  // harmless, since that is already checked separately below.
  siblingRoots: readonly string[] = [],
): Promise<DiscoverComponentsResult> {
  const abs = resolvePath(root, componentsDir)
  let files: string[]
  try {
    const entries = await listDir(abs)
    const candidates: string[] = []
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.aihu')) continue
      // `e.parentPath` is required, not optional. The old `?? abs` fallback
      // silently FLATTENED nested paths on a runtime that lacks it — loading
      // the wrong file rather than none, which is worse than a miss.
      if (typeof e.parentPath !== 'string') continue
      candidates.push(join(e.parentPath, e.name))
    }
    // Symlink containment. `readdir({recursive:true})` FOLLOWS symlinked
    // directories under bun — the toolchain this repo builds with — and does
    // not under Node. Every match here is about to be compiled AND EVALUATED by
    // Vite, so one symlink under the components dir would execute `.aihu`
    // modules from outside the project at build time. Resolve each path and
    // keep only what really lives under the directory we were asked to scan,
    // or under another directory this same project already configured as a
    // components dir — see `siblingRoots` above.
    const rootReal = await realpath(abs)
    const allowedRoots = [rootReal, ...siblingRoots]
    files = []
    for (const f of candidates) {
      try {
        const real = await realpath(f)
        if (allowedRoots.some((r) => real === r || real.startsWith(r + sep))) files.push(f)
        else {
          pushWarn(
            `[@aihu/app] static output: skipping "${f}" — it resolves to "${real}", ` +
              `outside the components directory. Component discovery does not follow ` +
              `symlinks out of the project.`,
          )
        }
      } catch {
        // Vanished between readdir and realpath; nothing to load.
      }
    }
  } catch {
    // No components directory is normal — a site can be pages-only.
    return { found: [], failures: [] }
  }

  // §17: overlap module loading instead of paying ~9ms/module serially. The
  // SORT happens before the fan-out, and `Promise.all` returns results in the
  // SAME order as its input array regardless of which promise settles first —
  // so the loop below still sees files in sorted order and the duplicate-tag
  // "keep the first" tie-break in `buildChildRegistry` stays deterministic.
  // Pushing into `found`/`failures` DURING each load (e.g. from inside the
  // `.map` callback) would have reintroduced resolution-order nondeterminism;
  // collecting into an array first and iterating that after `Promise.all`
  // settles is what preserves it.
  type LoadOutcome =
    | { readonly file: string; readonly ok: true; readonly mod: PrerenderRouteModule }
    | { readonly file: string; readonly ok: false; readonly error: unknown }
  const sorted = files.sort()
  const outcomes = await Promise.all(
    sorted.map(async (file): Promise<LoadOutcome> => {
      try {
        const mod = (await loadModule(file)) as PrerenderRouteModule
        return { file, ok: true, mod }
      } catch (error) {
        return { file, ok: false, error }
      }
    }),
  )

  const found: DiscoveredComponent[] = []
  const failures: ComponentLoadFailure[] = []
  for (const outcome of outcomes) {
    if (!outcome.ok) {
      // Deferred — see the docblock and §18. Not warned here.
      failures.push({ file: outcome.file, error: outcome.error })
      continue
    }
    const tag = outcome.mod.__aihu_tag__
    if (tag === undefined) {
      // Silently skipping this made a component unrenderable-as-a-child with
      // no signal at all — the empty-element failure this feature exists to
      // remove, reintroduced at the edge. Unlike a load failure, this one
      // fires unconditionally: the module DID load, so this is a real
      // authoring mistake (or a non-component file under the components
      // directory) rather than an environment limitation, and it deserves a
      // warning whether or not anything currently references it.
      pushWarn(
        `[@aihu/app] static output: component "${outcome.file}" exports no __aihu_tag__, ` +
          `so it cannot be resolved by tag and will render as an empty element. ` +
          `(A non-component module under the components directory is the usual cause.)`,
      )
      continue
    }
    found.push({ tag, module: outcome.mod as unknown as ChildModuleLike })
  }
  return { found, failures }
}

function deriveRoutes(root: string, pagesDir: string): ScannedRoute[] {
  const { routes } = scanPages(root, pagesDir)
  const pagesAbs = resolvePath(root, pagesDir).replace(/\\/g, '/')
  return routes.map((file) => {
    const norm = file.replace(/\\/g, '/')
    const rel = norm.startsWith(`${pagesAbs}/`) ? norm.slice(pagesAbs.length + 1) : norm
    const segments = fileToSegments(rel)
    const pattern = segmentsToPattern(segments)
    const dynamic = segments.some((s) => s.kind === 'param' || s.kind === 'catchall')
    return { file, pattern, segments, dynamic }
  })
}

/** Substitute `:param` segments with concrete values to form a concrete path. */
function fillPattern(segments: RouteSegment[], params: Record<string, string>): string {
  if (segments.length === 0) return '/'
  const parts = segments.map((s) => {
    if (s.kind === 'static') return s.path
    if (s.kind === 'param') return params[s.name] ?? ''
    // catchall: accept either '*' or a named param for the rest
    return params['*'] ?? ''
  })
  return `/${parts.filter((p) => p !== '').join('/')}`
}

function normalizeStaticPathEntry(entry: StaticPathEntry): Record<string, string> {
  if (
    entry &&
    typeof entry === 'object' &&
    'params' in entry &&
    (entry as { params?: unknown }).params
  ) {
    return (entry as { params: Record<string, string> }).params
  }
  return entry as Record<string, string>
}

// ---------------------------------------------------------------------------
// HTML templating
//
// The HeadConfig→template head transform (`applyHeadToHtml`) lives in the
// shared `./head-apply.ts` module so the SSG path (here) and the client-nav
// path (client.ts, B5) key/merge/escape tags identically and can never diverge.
//
// The template↔page outlet splice used to live here as a private
// `injectContent`. It is now `./ssr-document.ts`'s `injectIntoOutletId`, shared
// with the live SSR path — a Worker assembles the SAME document from the SAME
// built `index.html`, and two implementations of that splice would diverge the
// moment either grew a case.
//
// The layout↔page outlet splice used to live here as a private function. It is
// now `@aihu/server`'s `injectIntoOutlet`, imported above and shared with
// `@aihu/router/server`'s live SSR path — which had NO layout composition at
// all, so a page that looked right prerendered lost its whole shell when the
// same route was served from a Worker. Two implementations of one rule is how
// that divergence would come back, so there is exactly one.

// ---------------------------------------------------------------------------
// Prerender driver
// ---------------------------------------------------------------------------

/**
 * Resolve the renderable component from a loaded route module.
 *
 * The compiled-`.aihu` happy path registers a custom element as an import
 * side-effect and may not expose a `default`. Hand-authored route modules and
 * SSG-targeted pages export a `default` renderable (`() => arbor-tree` or
 * `{ toHtml() }`) — the same contract @aihu/server's router `handle()` uses.
 * Returns `null` when no renderable is present.
 */
function resolveComponent(
  mod: PrerenderRouteModule,
): (() => unknown) | { toHtml(): string } | null {
  const d = mod.default
  if (typeof d === 'function') return d as () => unknown
  if (d && typeof d === 'object' && typeof (d as { toHtml?: unknown }).toHtml === 'function') {
    return d as { toHtml(): string }
  }
  return null
}

/** Convert a route pattern to its `index.html` output path under outDir. */
function patternToHtmlPath(pattern: string, format: 'directory' | 'file' = 'directory'): string {
  if (pattern === '/') return 'index.html'
  const clean = pattern.replace(/^\//, '').replace(/\/$/, '')
  return format === 'file' ? `${clean}.html` : join(clean, 'index.html')
}

export interface RunPrerenderOptions {
  resolvedViteConfig: ResolvedConfig
  config: AihuConfig | undefined
  /**
   * Loads a route module by absolute file path. The default driver
   * (`prerenderClose`) wires this to a short-lived Vite SSR loader.
   */
  loadModule: SsrModuleLoader
  /** Emits a warning (skipped dynamic routes, missing renderables). */
  warn: (msg: string) => void
  /**
   * @internal Overrides how the components directory is listed. Defaults to
   * `node:fs/promises`'s recursive `readdir`.
   *
   * Exists for one reason: the symlink-containment branch in
   * `discoverComponents` is only REACHABLE when the lister descends symlinked
   * directories, which bun's `readdir` does and Node's does not. The test suite
   * runs under Node, so without this seam that branch cannot be exercised by
   * any fixture and a test for it can only ever be vacuous. See
   * `ComponentDirLister`.
   */
  _listComponentDir?: ComponentDirLister
}

/**
 * Run the SSG prerender. Enumerates routes, renders each static route (and any
 * dynamic route that exports `getStaticPaths`), and writes per-route HTML into
 * the Vite build's outDir using the built `index.html` as the template.
 */
export async function runPrerender(opts: RunPrerenderOptions): Promise<PrerenderResult> {
  const { resolvedViteConfig, config, loadModule, warn, _listComponentDir } = opts
  const root = resolvedViteConfig.root
  const outDir = resolvePath(root, resolvedViteConfig.build.outDir)
  const pagesDir = config?.dir?.pages ?? 'pages'
  const layoutsDir = config?.dir?.layouts ?? 'src/layouts'
  const siteUrl = config?.site?.url
  const globalHead = config?.app?.head as HeadConfig | undefined
  // READ FROM CONFIG, not hardcoded. This was `const outletId = 'outlet'` while
  // `injectContent` already took the id as a parameter — so an app setting
  // `app.outletId: 'root'` got a client mounting `#root` and a prerender
  // splicing `#outlet`: every prerendered page shipped an empty shell with its
  // content dropped on the floor, and nothing said so. Masked only because
  // nobody moved off the default.
  const outletId = config?.app?.outletId ?? DEFAULT_OUTLET_ID

  const result: PrerenderResult = { written: [], warnings: [] }
  const pushWarn = (msg: string): void => {
    result.warnings.push(msg)
    warn(msg)
  }

  // SSR child components (plan step 5). Built ONCE, before any render: the
  // renderers take a pre-resolved map and load nothing themselves, because
  // module loading is async while the compiled string fast path — the path
  // every prerendered page actually takes — is synchronous.
  //
  // This is also where a cyclic component graph is rejected. Loudly, and here,
  // because render-time recursion is already bounded by `__aihu_schild`'s depth
  // cap: a cycle would not hang the build, it would quietly emit 32 nested
  // copies of the same subtree and write them to disk.
  const componentsDirs = config?.dir?.components ?? 'src/components'
  const componentPaths = (Array.isArray(componentsDirs) ? componentsDirs : [componentsDirs])
    .map((dir) => resolvePath(root, dir))
    .sort()
  // Real paths of every configured `dir.components` entry. A symlink under one
  // that resolves inside ANOTHER is a cross-reference between two dirs the
  // SAME project already configured (#901 made `dir.components` an array for
  // exactly this), not an escape — see `discoverComponents`'s `siblingRoots`.
  // A dir that doesn't exist yet is dropped rather than failing the build;
  // `discoverComponents` already treats a missing dir as "no components".
  const siblingRoots = (
    await Promise.all(componentPaths.map((p) => realpath(p).catch(() => null)))
  ).filter((r): r is string => r !== null)
  const discovered = await Promise.all(
    componentPaths.map((componentsDir) =>
      discoverComponents(
        root,
        componentsDir,
        loadModule,
        pushWarn,
        _listComponentDir ?? defaultComponentDirLister,
        siblingRoots,
      ),
    ),
  )
  const discoveredComponents = discovered.flatMap(({ found }) => found)
  const componentLoadFailures = discovered.flatMap(({ failures }) => failures)
  // `buildChildRegistry`'s warnings are BUFFERED, not emitted where they are
  // raised, for the same reason the two diagnostics below are: the registry is
  // built before the render loop, so nothing that reads "does anything reference
  // this?" can be answered yet.
  //
  // Specifically §4 — a registry entry that can never render (no `__ssrString`,
  // or no `__aihu_shadow__`). `buildChildRegistry` reports one per discovered
  // component, and it has no referenced set to gate on; that gate can only live
  // here. It belongs here for the same reason §18's does: the warning describes
  // an EMPTY ELEMENT in the output, and an unreferenced component puts no
  // element, empty or otherwise, on any page. There is no symptom for it to
  // explain, so it is noise on every build — precisely the noise §18 removed,
  // and leaving it ungated would mean a broken component that FAILED TO LOAD
  // stays quiet while one that loaded-but-cannot-render shouts, for the same
  // unreferenced state.
  //
  // The §22 objection — "over-gating recreates the silence this fixes" — was
  // real, and was a defect in the referenced SET, not in the idea of gating: it
  // is answered above by `referencesOf`, which now sees declined references too.
  //
  // GATED BY MESSAGE SHAPE, and this is a deliberate, narrow coupling: a
  // `@aihu/server` warning that is about one tag's rendering starts with
  // `[@aihu/server] <tag> `. Anything else — a tag conflict, a reference cycle,
  // any future shape — does not match and replays UNCONDITIONALLY, which is the
  // correct disposition for those (a duplicate `customElements.define` throws on
  // the client whether or not this build references the tag) and the safe
  // failure direction if the shape ever drifts: too loud, never silent.
  const childRegistryWarnings: string[] = []
  const childRegistry = buildChildRegistry(discoveredComponents, (m) =>
    childRegistryWarnings.push(m),
  )
  // Omitted entirely when nothing was discovered, so a site with no components
  // renders byte-identically to before.
  const childOpts: Pick<SsrOptions, 'children'> =
    childRegistry.size > 0 ? { children: childRegistry } : {}

  // Every tag ANY module the prerender loads REFERENCES.
  //
  // Seeded from the registry, then extended by every page and layout module the
  // render loop below loads (`noteReferences`). §22: seeding it from
  // `childRegistry.values()` ALONE — the shape this had — made both diagnostics
  // below blind to page→component and layout→component references, because
  // those modules are loaded later, inside the render loop. In `apps/docs` that
  // meant `weather-demo.aihu`, which fails to load under SSR and is referenced
  // from `pages/index.aihu` and `pages/cookbook/agent-weather.aihu`, was judged
  // unreferenced and said nothing: the fix that was supposed to make load
  // failures visible made the build QUIETER. Both diagnostics are therefore
  // emitted AFTER the render loop (`emitChildDiagnostics`), not before it — the
  // information already existed, it was only collected too early.
  //
  // Registry values rather than every discovered component, deliberately: a
  // module that LOST a duplicate-tag tie-break never renders, so its references
  // are not references the prerendered output can make.
  //
  // Read through `referencesOf`, NOT `__aihu_child_tags__` directly: §22 was
  // only HALF fixed by moving the diagnostics after the render loop. The other
  // half is that the call-site-derived export cannot see a reference the emitter
  // declined — `<weather-demo city="London">` carries an attribute, so
  // `pages/index.aihu` compiles to zero `__aihu_schild` call sites and named
  // nothing. `__aihu_referenced_tags__` comes from the template AST and does.
  const referenced = new Set<string>()
  for (const mod of childRegistry.values()) {
    for (const t of referencesOf(mod)) referenced.add(t)
  }
  /** Fold one loaded module's referenced tags into `referenced`. */
  const noteReferences = (mod: PrerenderRouteModule): void => {
    for (const t of referencesOf(mod)) referenced.add(t)
  }

  /**
   * The two child-registry diagnostics, emitted once, after everything that can
   * contribute to `referenced` has been loaded.
   *
   * Deterministic by construction: `componentLoadFailures` arrives in sorted
   * file order from `discoverComponents`, and the unresolved-tag pass sorts its
   * tags. Both are once-per-file / once-per-tag, never once-per-reference-site.
   */
  const emitChildDiagnostics = (): void => {
    // §4, deferred from registry-build time — see `childRegistryWarnings`.
    // Emitted FIRST so the registry's own report still precedes the two
    // diagnostics that read the registry, exactly as it did when it was emitted
    // inline.
    for (const msg of childRegistryWarnings) {
      const tag = /^\[@aihu\/server\] <([^>]+)> /.exec(msg)?.[1]
      if (tag !== undefined && !referenced.has(tag)) continue
      pushWarn(msg)
    }

    // §18: a component that failed to load (e.g. `weather-demo.aihu` under SSR:
    // `CSSStyleSheet is not defined`) is only worth a build warning if
    // something actually references it — otherwise it is dead weight under the
    // components directory and the warning fires on every build for no
    // actionable reason.
    //
    // The catch: a load failure means the module never evaluated, so its real
    // `__aihu_tag__` — the compiler-assigned tag, what the registry above is
    // keyed on — is unknowable here. There is no way to look it up in
    // `referenced` directly. Falling back to `readAihuComponentTag`, which
    // derives a tag from the SOURCE TEXT (`@meta.name` → `@route.name` → file
    // stem, the same precedence the compiler applies) without evaluating the
    // module, gives a best-effort stand-in: good enough to decide "does
    // anything plausibly point at this file", not good enough to trust as a
    // registry key (that mismatch is exactly why the registry above never uses
    // it). When even that can't be determined — the file vanished, is
    // unreadable, whatever — this fails OPEN and warns anyway: silence is the
    // wrong default for "a component broke and we can't tell if it matters".
    //
    // Tags reported HERE are withheld from the unresolved-tag pass below — see
    // `explainedByLoadFailure`.
    const explainedByLoadFailure = new Set<string>()
    for (const { file, error } of componentLoadFailures) {
      // TWO candidate tags, not one, because the two derivations in this repo
      // disagree. `readAihuComponentTag` applies `@meta.name → @route.name →
      // stem`; the compiler's `defineElement` — and therefore the tag a
      // template actually references — currently uses the stem. So a component
      // declaring `@meta { name: "custom-thing" }` in `x-plain.aihu` derives as
      // `custom-thing` here while `referenced` holds `x-plain`, and checking
      // only the first would silently skip a broken component that IS
      // referenced. (That disagreement is a real pre-existing bug, tracked as
      // §7a of `docs/plans/2026-08-06-ssr-child-followups.md`; until it is
      // settled, consulting both is the only way not to inherit it here.)
      const candidates = new Set<string>()
      try {
        candidates.add(readAihuComponentTag(file))
      } catch {
        // Unreadable source — leave `candidates` short and fail open below.
      }
      const stem = basename(file).replace(/\.aihu$/, '')
      if (stem) candidates.add(stem)
      // Fails OPEN when nothing could be determined: silence is the wrong
      // default for "a component broke and we cannot tell whether it matters".
      if (candidates.size > 0 && ![...candidates].some((t) => referenced.has(t))) continue
      for (const t of candidates) explainedByLoadFailure.add(t)
      pushWarn(
        `[@aihu/app] static output: component "${file}" failed to load (${
          error instanceof Error ? error.message : String(error)
        }); it will render as an empty element.`,
      )
    }

    // Every tag something REFERENCES but the registry cannot supply.
    //
    // Without this, an unresolvable reference is completely silent: the
    // component renders as an empty element, which is indistinguishable from
    // one nobody registered, which is indistinguishable from correct output for
    // a third-party custom element. A component colocated with pages, imported
    // from a package, or keyed by `@meta { name }` rather than its file stem
    // (the client's scanner keys on the former, this registry on the latter)
    // would prerender empty forever with nothing to grep for.
    //
    // Warned once per tag, not per reference site. Unknown tags are NOT
    // necessarily errors — a genuine third-party element belongs on this list —
    // so the wording says what happened rather than asserting a mistake.
    //
    // A tag whose component file was found and FAILED TO LOAD is skipped: the
    // loop above already reported it, with the actual exception, and this
    // message would contradict that report rather than add to it. It says "was
    // not found under `src/components`" and advises "move it there" — of a file
    // that is already there. Found by rebuilding apps/docs after the fix above
    // made this pair reachable for the first time: `weather-demo` produced both
    // lines, and only one of them was true.
    for (const tag of [...referenced].sort()) {
      if (childRegistry.has(tag)) continue
      if (explainedByLoadFailure.has(tag)) continue
      pushWarn(
        `[@aihu/app] static output: <${tag}> is referenced but was not found under ` +
          `"${Array.isArray(componentsDirs) ? componentsDirs.join(', ') : componentsDirs}", ` +
          `so it prerenders as an empty element and fills in on the ` +
          `client. Move it there, or ignore this if it is not an aihu component.`,
      )
    }
  }

  // Wave-3 state channel: this is @aihu/app's SSG SSR entry, so it owns the
  // store-serializer wiring (@aihu/server never imports @aihu/store — the
  // injection-slot posture of _setContextFns). Each hydratable page render
  // below then emits its stores under `__aihu_state__`. Prerender runs
  // sequentially in one Node process with no per-request context map, so
  // stores live in the module-singleton registry; `_resetStoreRegistry()`
  // before every render keeps one page's store state out of the next page's
  // snapshot.
  _setStoreSerializer(serializeStores)

  // Route context during SSG. `@aihu/server` never imports `@aihu/context` —
  // the seam is `_setContextFns` + `SsrOptions.contextSetup` — so this, the
  // SSG SSR entry, owns the wiring exactly as it owns the store serializer
  // above.
  //
  // Without it `inject(RouteContext)` returned the token default (`null`) for
  // the whole prerender, so anything route-aware — `useRoute`, `useRouter`,
  // `$route`, an `<a>` deciding whether it is the active link — server-rendered
  // as if no route were active, then changed on the client. That is a
  // correctness bug that presents as a flash.
  //
  // No component in a prerendered tree provides this: on the client `<router>`
  // does, and there is no `<router>` here. Pre-populating IS the mechanism.
  _setContextFns(setSsrContextMap, clearSsrContextMap)

  const routes = deriveRoutes(root, pagesDir)

  // A router over the same scanned routes the loop below walks, so `current()`
  // returns a real `MatchResult` — matched params included — rather than a
  // hand-built stub that would drift from what the client computes.
  const router = createRouter(
    routes.map(
      (r): RouteDefinition => ({
        pattern: r.pattern,
        segments: r.segments,
        module: () => loadModule(r.file) as Promise<never>,
      }),
    ),
  )

  /**
   * `contextSetup` for one concrete path.
   *
   * `provideRouteContext` writes into the map `ssr.ts` activates immediately
   * before calling this hook, so the public provide/inject API is all that is
   * needed — no reaching for token internals.
   *
   * `current` is a plain closure, not a signal: a prerender is one static
   * snapshot, and `createRouteSignal` would attach a `popstate` listener that
   * has nothing to listen to in Node.
   */
  const routeContextFor = (concretePath: string): NonNullable<SsrOptions['contextSetup']> => {
    const match = router.match(concretePath)
    return () => provideRouteContext({ router, current: () => match })
  }

  // SSR layout parity (#7): render a route's layout shell and cache it. Scoped
  // to the composition case — only layouts whose module exposes an
  // SSR-renderable `default` are prerendered. Compiled-SFC layouts (side-effect
  // custom element, no default) resolve to null, so the page ships the SPA
  // shell unchanged and the layout is applied client-side on hydration. Map
  // value `null` = resolved but not server-renderable.
  //
  // The cache key is layout name + CONCRETE PATH, not the name alone. Keying on
  // the name was safe only while layouts rendered route-blind; now that they
  // see `RouteContext`, a layout with an active-nav highlight (the common case,
  // and the reason this wiring exists) renders differently per page. A
  // name-only key would have served every page the first page's chrome.
  const layoutShellCache = new Map<string, string | null>()
  const renderLayoutShell = async (
    name: string,
    routePattern: string,
    concretePath: string,
    routeFile: string,
  ): Promise<string | null> => {
    const cacheKey = `${name}\u0000${concretePath}`
    const cached = layoutShellCache.get(cacheKey)
    if (cached !== undefined) return cached
    let shell: string | null = null
    const layoutFile = scanLayouts(resolvePath(root, layoutsDir))[name]
    if (!layoutFile) {
      pushWarn(
        `[@aihu/app] static output: layout "${name}" (route ${routePattern}) not found under ` +
          `${layoutsDir} — rendering without a layout.`,
      )
    } else {
      try {
        const layoutMod = await loadModule(layoutFile)
        // §22: a layout references components too — most of a site's do, since
        // that is where the nav and footer live. Folded in BEFORE the render so
        // the diagnostics after the loop can see them.
        noteReferences(layoutMod)
        const layoutComponent = resolveComponent(layoutMod)
        if (layoutComponent) {
          // See the `hydratable` note on the page render below — the layout
          // shell is part of the same prerendered document and must carry
          // markers too, or the client adopts the page and rebuilds its wrapper.
          _resetStoreRegistry()
          shell = await renderToString(layoutComponent, {
            hydratable: true,
            contextSetup: routeContextFor(concretePath),
            // Referenced components (e.g. <site-header>) render their real
            // content instead of an empty shell. Layouts are where most of them
            // live, which is why the site nav was missing from every page.
            ...childOpts,
            // Stamp the layout's `data-a` scope id on its prerendered root so
            // the layout's scoped CSS (grid columns, the mobile media query
            // that hides the sidebar, …) applies at FIRST PAINT. Without it
            // the prerendered chrome renders unstyled until the layout chunk
            // loads — measured on apps/docs-next: the unstyled sidebar filled
            // the mobile viewport, pushed the article (the LCP element) below
            // the fold, and cost ~1.9s of throttled LCP.
            ...(layoutMod.__aihu_light_scope__ !== undefined
              ? { lightScopeId: layoutMod.__aihu_light_scope__ }
              : {}),
            // …and wrap it in the layout's own element, so the prerendered
            // shape is the one the client builds. `data-a` rides the wrapper
            // rather than the template root — that is where the client stamps
            // it (define-element.ts, in the host constructor).
            ...(layoutMod.__aihu_tag__ !== undefined ? { wrapTag: layoutMod.__aihu_tag__ } : {}),
          })
        } else {
          pushWarn(
            `[@aihu/app] static output: layout "${name}" has no SSR-renderable default export — ` +
              `route ${routePattern} ships the SPA shell (the layout is applied client-side). ` +
              `Export a default renderable to prerender the layout.`,
          )
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(
          `[@aihu/app] static output: failed to load or render layout "${name}" for route ` +
            `${routePattern} (${routeFile}; layout ${layoutFile}): ${msg}`,
          { cause: err },
        )
      }
    }
    layoutShellCache.set(cacheKey, shell)
    return shell
  }

  // The built index.html is our template — it already carries the hashed client
  // bundle <script> tags + base <head>, so reusing it gives free hydration.
  const templatePath = resolvePath(outDir, 'index.html')
  let template: string
  try {
    template = await readFile(templatePath, 'utf8')
  } catch {
    // Nothing will be rendered, so `referenced` is already final: emit here too
    // rather than lose both diagnostics on this path. Emitted BEFORE the
    // template warning so the relative order matches every other exit.
    emitChildDiagnostics()
    pushWarn(
      `[@aihu/app] static output: no index.html in ${outDir} — cannot prerender. ` +
        `Ensure the SPA build produced an index.html.`,
    )
    return result
  }

  for (const route of routes) {
    let mod: PrerenderRouteModule
    try {
      mod = await loadModule(route.file)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(
        `[@aihu/app] static output: failed to load route ${route.pattern} (${route.file}): ${msg}`,
        { cause: err },
      )
    }
    // §22: a page's own template references components — `<weather-demo>` in
    // apps/docs is referenced from pages ONLY. Folded in before any `continue`
    // below, so a page that is skipped for an unrelated reason (no renderable
    // default, a dynamic route with no getStaticPaths) still contributes its
    // references to the diagnostics.
    noteReferences(mod)

    const sidecar = readRouteSidecar(route.file)
    let head = sidecar?.head
    let declaredLayout = sidecar?.layout
    if (head === undefined || declaredLayout === undefined) {
      // The stdin compile path writes no `.route.json` sidecar to disk, so a
      // real SSG build has none to read (only the test harness lays them down).
      // Recover the route's `@route` metadata straight from source via the
      // compiler — the SAME metadata the SPA build threads into
      // `virtual:aihu-routes` (compileRouteMeta). Without this fallback every
      // prerendered page ships ONLY the global head and loses its per-route
      // title / description / canonical / og / twitter / json-ld — the SEO
      // payload that is the entire reason to prerender for crawlers.
      //
      // `layout` needs the SAME recovery, and its absence was worse than an SEO
      // loss: `sidecar?.layout` was ALWAYS undefined in a real build, so the
      // layout shell was silently never prerendered — not even a warning, since
      // the "layout not found" / "no outlet marker" warnings below all sit
      // downstream of a layout NAME that never arrived. Every static page
      // therefore shipped its bare content with no chrome, and the client had to
      // build the entire layout before the page reached its final geometry.
      //
      // Failure is non-fatal: the page still ships content + the global head.
      try {
        const src = await readFile(route.file, 'utf8')
        const meta = compileRouteMeta(src, route.file)
        if (head === undefined) head = meta?.head as typeof head
        if (declaredLayout === undefined) declaredLayout = meta?.layout
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        pushWarn(
          `[@aihu/app] static output: could not recover @route metadata for ${route.pattern}: ` +
            `${msg} — the page ships with the global head and no layout.`,
        )
      }
    }

    const component = resolveComponent(mod)
    if (!component) {
      throw new Error(
        `[@aihu/app] static output: route ${route.pattern} (${route.file}) has no renderable default export`,
      )
    }

    const layoutName = declaredLayout

    // Build the param-path list to render: static routes render once with no
    // params; dynamic routes require getStaticPaths().
    let paramSets: Array<Record<string, string>>
    if (route.dynamic) {
      if (typeof mod.getStaticPaths !== 'function') {
        pushWarn(
          `[@aihu/app] static output: dynamic route ${route.pattern} has no getStaticPaths() — ` +
            `skipped. Export getStaticPaths() to prerender its paths.`,
        )
        continue
      }
      const raw = await mod.getStaticPaths()
      paramSets = (raw ?? []).map(normalizeStaticPathEntry)
      if (paramSets.length === 0) {
        pushWarn(
          `[@aihu/app] static output: dynamic route ${route.pattern} getStaticPaths() returned ` +
            `no paths — nothing prerendered for this route.`,
        )
      }
    } else {
      paramSets = [{}]
    }

    for (const params of paramSets) {
      const concretePath = route.dynamic ? fillPattern(route.segments, params) : route.pattern

      let content: string
      try {
        // `hydratable: true` is REQUIRED, not an optimization. Every
        // `data-aihu-path` marker in `ssr.ts` is gated on
        // `opts?.hydratable ?? false`, so no options means markerless HTML.
        //
        // "Static" here names WHEN the page is rendered, not whether it
        // hydrates: an SSG page is still the document a live SPA boots into.
        // Without markers the client walker has nothing to adopt and rebuilds
        // the tree beside the prerendered DOM, silently duplicating every
        // statically generated page's content on first load. `hydratable` is a
        // property of the DESTINATION, not of the renderer.
        _resetStoreRegistry()
        content = await renderToString(component, {
          hydratable: true,
          contextSetup: routeContextFor(concretePath),
          // See the layout shell above — a page's own template can reference
          // components too.
          ...childOpts,
          // Same first-paint stamp as the layout shell above: the page's own
          // `@scope([data-a="…"])` CSS must match the prerendered content
          // before any client JS runs. Also the scope BOUNDARY (`to
          // ([data-a])`): the page root's `data-a` is what stops the layout's
          // scope from leaking into page content.
          ...(mod.__aihu_light_scope__ !== undefined
            ? { lightScopeId: mod.__aihu_light_scope__ }
            : {}),
          // …and the page's own element, matching what the client builds
          // (`document.createElement(tag)` in client.ts's route render).
          ...(mod.__aihu_tag__ !== undefined ? { wrapTag: mod.__aihu_tag__ } : {}),
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(
          `[@aihu/app] static output: render failed for route ${concretePath} (${route.file}): ${msg}`,
          { cause: err },
        )
      }

      // SSR layout parity (#7): render the route's layout shell, then inject the
      // page into its `data-aihu-outlet` marker. If the layout isn't
      // server-renderable (compiled SFC) or has no marker, fall back to the page
      // alone (the client still wraps it on hydrate).
      //
      // Rendered per CONCRETE PATH, not once per route pattern: the layout now
      // sees `RouteContext`, so a dynamic route's pages get their own chrome
      // rather than every `/posts/:slug` page reusing the first slug's.
      let layoutShell = layoutName
        ? await renderLayoutShell(layoutName, route.pattern, concretePath, route.file)
        : null
      if (layoutShell !== null && injectIntoOutlet(layoutShell, '') === null) {
        pushWarn(
          `[@aihu/app] static output: layout "${layoutName}" renders no <outlet> ` +
            `(data-aihu-outlet) marker — route ${route.pattern} prerendered without the layout.`,
        )
        layoutShell = null
      }
      if (layoutShell !== null) {
        content = injectIntoOutlet(layoutShell, content) ?? content
      }

      const lowered = routeHeadToSsrHead(head, {
        ...(siteUrl !== undefined ? { siteUrl } : {}),
        ...(globalHead !== undefined ? { globalHead } : {}),
      })
      let html = applyHeadToHtml(template, lowered)
      const spliced = injectIntoOutletId(html, content, outletId)
      if (spliced === null) {
        // Previously this returned the template unchanged, silently: a written
        // file that looks complete, with an empty outlet and the page's content
        // gone. Warn and keep writing the shell (the client still mounts and
        // renders the route), but say why the page is empty in the source.
        pushWarn(
          `[@aihu/app] static output: index.html has no element with id="${outletId}", so ` +
            `${concretePath} was written with an EMPTY outlet — its prerendered content was ` +
            `dropped. Add <div id="${outletId}"></div> to index.html, or set app.outletId to ` +
            'the id it already uses.',
        )
      }
      html = spliced ?? html

      const relPath = patternToHtmlPath(concretePath, config?.static?.format)
      const absPath = resolvePath(outDir, relPath)
      if (absPath !== outDir && !absPath.startsWith(`${outDir}${sep}`)) {
        throw new Error(
          `[@aihu/app] static output: route ${route.pattern} (${route.file}) resolved to an ` +
            `HTML path outside build.outDir: ${relPath}`,
        )
      }
      await mkdir(dirname(absPath), { recursive: true })
      await writeFile(absPath, html, 'utf8')
      result.written.push(relPath.replace(/\\/g, '/'))
    }
  }

  // §22: AFTER the loop — every page and layout has now contributed its
  // `__aihu_child_tags__`, so "is this broken component referenced?" and "is
  // this tag resolvable?" are answered against the whole site, not against the
  // components directory in isolation.
  emitChildDiagnostics()

  return result
}

/**
 * `closeBundle` driver for the SSG prerender. Spins up a short-lived Vite SSR
 * module loader (middleware mode) so route files compile exactly like the dev
 * pipeline (`.aihu`, TS, virtual modules), runs `runPrerender`, then tears the
 * loader down.
 */
export async function prerenderClose(
  resolvedViteConfig: ResolvedConfig,
  config: AihuConfig | undefined,
  warn: (msg: string) => void,
): Promise<PrerenderResult> {
  // Lazy import of Vite so this stays out of any non-build path.
  const { createServer } = await import('vite')
  // Reuse the resolved plugin chain so route files compile exactly like the
  // build (compiler for `.aihu`, router for virtual modules), but drop our own
  // build-only sentinels — they have no role in a module-loading dev server and
  // would only add noise. (closeBundle does not fire in middleware mode, so the
  // SSG plugin cannot re-enter even if left in.)
  const plugins = (
    (resolvedViteConfig.plugins as ReadonlyArray<{ name?: string }> | undefined) ?? []
  ).filter((p) => p?.name !== 'aihu-ssg' && p?.name !== 'aihu-adapter')
  const server = await createServer({
    root: resolvedViteConfig.root,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    // This is a loader for an already-resolved app, not a second project
    // config. Preserve settings that affect source resolution/transforms, while
    // disabling dependency discovery so esbuild cannot prebundle @aihu/app's
    // Vite virtual imports.
    ...(resolvedViteConfig.resolve?.alias
      ? { resolve: { alias: resolvedViteConfig.resolve.alias } }
      : {}),
    ...(resolvedViteConfig.define ? { define: resolvedViteConfig.define } : {}),
    ...(resolvedViteConfig.css ? { css: resolvedViteConfig.css } : {}),
    ssr: {
      ...(resolvedViteConfig.ssr?.noExternal !== undefined
        ? { noExternal: resolvedViteConfig.ssr.noExternal }
        : {}),
      ...(resolvedViteConfig.ssr?.external !== undefined
        ? { external: resolvedViteConfig.ssr.external }
        : {}),
    },
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false },
    plugins: plugins as never,
  })
  try {
    const loadModule: SsrModuleLoader = async (filePath) =>
      (await server.ssrLoadModule(filePath)) as PrerenderRouteModule
    return await runPrerender({ resolvedViteConfig, config, loadModule, warn })
  } finally {
    await server.close()
  }
}
