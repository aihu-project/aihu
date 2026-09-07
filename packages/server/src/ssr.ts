/// <reference lib="dom" />
/**
 * CRITICAL CONSTRAINTS:
 * 1. Zero client runtime imports. Zero DOM globals (no window, document, HTMLElement).
 *    ONE EXCEPTION, added deliberately: `@aihu/runtime/ssr`. That is not the
 *    client runtime — it is the SERVER-ONLY subpath entry (`dist/ssr-string.js`),
 *    which exists precisely so these bytes stay out of client bundles, and whose
 *    every helper is pure and DOM-free. It is imported for `__aihu_schild`
 *    alone, so that a resolved child component is serialized by the SAME
 *    function the compiled string renderer calls. Duplicating that logic here
 *    would let the two renderers drift in CAPABILITY, which nothing tests —
 *    the byte-level differential suite only pins them when both render the same
 *    things. `@aihu/runtime` is a devDependency, not a dependency: rolldown's
 *    narrow external list means the helper is INLINED into `dist`, so consumers
 *    install nothing extra and there is still exactly one source file. Verified
 *    after the build: no `dist` chunk imports `@aihu/runtime`, and the helper
 *    lands in the node entry beside the rest of this file — `dist/index.js`,
 *    the entry a browser/edge/Deno bundle pulls, gains nothing. Unlike
 *    `@aihu/signals` (external, because a private copy would break scope
 *    identity) the helper is pure, so a bundled copy is safe.
 *
 *    COST, stated plainly: every package whose tsconfig maps `@aihu/server` to
 *    SOURCE must also map `@aihu/runtime/ssr` to source, or it fails TS2307 on
 *    a clean tree — TypeScript replaces a base config's `paths` rather than
 *    merging them, so this cannot be inherited from `tsconfig.base.json`. That
 *    is 13 files today (the 12 package tsconfigs that map `@aihu/server`, plus
 *    the root). A new package that maps `@aihu/server` and skips this will
 *    break, and nothing derives the mapping the way `check-moon-graph.ts`
 *    derives build edges — a gap worth closing if this pattern spreads.
 * 2. Runs in: Workers, Deno, Bun, Node ESM.
 * 3. NEVER import @aihu/context at module level — use injection slots (_setContextFns).
 * 4. NEVER import @aihu/store at module level — its registry rides @aihu/context,
 *    which rule 3 already bans. Store serialization is an injection slot too
 *    (_setStoreSerializer), wired by the app's SSR entry at startup.
 *
 * State channel (wave 3): after a hydratable render, one
 * `<script type="application/json" id="__aihu_state__">` script is emitted
 * carrying `{ v: 1, stores: {...}, signals?: {...} }` — `stores` from the
 * injected store serializer, `signals` from either `SsrOptions.serializer`
 * (an arbor MountScope-style snapshot) or, by default, a post-render walk of
 * the rendered tree collecting writable-signal values at the SAME path keys
 * the hydration walker uses (`<path>.text`, `<path>.attr:<key>`), so the
 * client can pre-seed signals instead of re-deriving them.
 */

// @aihu/signals is environment-agnostic (no DOM, no client runtime) — it is
// NOT covered by constraints 1/3/4 above. It MUST stay `external` in the
// rolldown build (see rolldown.config.ts): scope adoption rides the
// module-global `_currentScope`, so server and app must share ONE instance.
// See CRITICAL CONSTRAINT 1 above for why this one client-package specifier is
// permitted: the server-only, DOM-free subpath, imported so the walker and the
// compiled string renderer share ONE child serializer.
import {
  __aihu_schild,
  _isSerializableAttrName,
  _MAX_CHILD_BYTES,
  _MAX_CHILD_DEPTH,
  _ssrChildWrap,
  _withSsrLifecycle,
  type SsrChildModule,
} from '@aihu/runtime/ssr'
import { effectScope } from '@aihu/signals'
import type { StreamOptions } from './stream-types.ts'

// ---------------------------------------------------------------------------
// Context injection slots (hard-boundary: @aihu/context is never imported here).
// The caller populates these once at app startup via _setContextFns().
// ---------------------------------------------------------------------------
let _setContextMap: ((map: Map<symbol, unknown>) => void) | undefined
let _clearContextMap: (() => void) | undefined

/**
 * Inject context activation/deactivation functions from @aihu/context/ssr.
 * Must be called once at app startup before any renderToString calls that use
 * SsrOptions.contextSetup.
 *
 * Example:
 *   import { setSsrContextMap, clearSsrContextMap } from '@aihu/context/ssr'
 *   import { _setContextFns } from '@aihu/server'
 *   _setContextFns(setSsrContextMap, clearSsrContextMap)
 */
export function _setContextFns(set: (map: Map<symbol, unknown>) => void, clear: () => void): void {
  _setContextMap = set
  _clearContextMap = clear
}

// ---------------------------------------------------------------------------
// Store-serializer injection slot (hard-boundary: @aihu/store is never
// imported here — it rides @aihu/context, which is itself banned at module
// level). Same posture as _setContextFns: the app's SSR entry wires it once
// at startup.
// ---------------------------------------------------------------------------
let _storeSerializer: (() => Record<string, unknown>) | undefined

/**
 * Inject the store snapshot function from @aihu/store. When registered, every
 * HYDRATABLE render emits the current request's store state under the
 * `stores` key of the `__aihu_state__` script.
 *
 * Example (app SSR entry, once at startup):
 *   import { serializeStores } from '@aihu/store'
 *   import { _setStoreSerializer } from '@aihu/server'
 *   _setStoreSerializer(serializeStores)
 *
 * Pass `undefined` to unregister (tests).
 */
export function _setStoreSerializer(fn: (() => Record<string, unknown>) | undefined): void {
  _storeSerializer = fn
}

export interface MetaTag {
  readonly name?: string
  readonly property?: string
  readonly content: string
  readonly [attr: string]: string | undefined
}

export interface LinkTag {
  readonly rel: string
  readonly href: string
  readonly [attr: string]: string | undefined
}

/**
 * A `<script>` element in the document head. Used for structured-data blocks
 * such as JSON-LD (`type="application/ld+json"`). `content` is emitted verbatim
 * as the script body and is NOT HTML-attribute-escaped (it is element text, not
 * an attribute); callers are responsible for ensuring it contains no literal
 * `</script>` sequence (the SEO mapper guards this via `</` escaping).
 */
export interface ScriptTag {
  readonly type: string
  readonly content: string
}

export interface HeadConfig {
  readonly title?: string
  readonly meta?: ReadonlyArray<MetaTag>
  readonly links?: ReadonlyArray<LinkTag>
  readonly lang?: string
  /**
   * Inline `<script>` elements (e.g. JSON-LD structured data). Backward
   * compatible: omitted means no script tags are emitted, matching prior
   * `buildHead` behavior.
   */
  readonly scripts?: ReadonlyArray<ScriptTag>
}

export interface SsrOptions {
  /**
   * When provided: output is a full HTML document.
   * When absent: output is the component's inner HTML fragment only.
   */
  readonly head?: HeadConfig

  /**
   * When true: rendered HTML includes hydration markers as data attributes.
   * Default: false.
   */
  readonly hydratable?: boolean

  /**
   * Injected signal serializer (an arbor `MountScope.serialize`-shaped
   * snapshot: path key → value). When provided it REPLACES the default
   * post-render signal collection and its result rides the `signals` key of
   * the `__aihu_state__` envelope. When it throws, the error is swallowed
   * and the `signals` channel is omitted.
   */
  readonly serializer?: () => Record<string, unknown>

  /**
   * Optional per-render context setup hook. When provided alongside a prior call
   * to _setContextFns, ssr.ts will:
   *   1. Activate a fresh context Map (per-render isolation).
   *   2. Call contextSetup(activateFn, deactivateFn) so the caller can do
   *      per-request setup — including replacing that map with a pre-populated
   *      one, which is the point of the hook.
   *   3. Clear it in a finally block after the walk.
   *
   * ssr.ts never imports @aihu/context — the hard boundary is preserved.
   * The activate/deactivate functions are wired via _setContextFns at startup.
   *
   * Pre-populating (the common case — providing a context no component in the
   * tree provides, e.g. the router's `RouteContext` during SSG):
   *   import { setSsrContextMap, clearSsrContextMap } from '@aihu/context/ssr'
   *   import { _setContextFns, renderToString } from '@aihu/server'
   *   _setContextFns(setSsrContextMap, clearSsrContextMap)
   *   await renderToString(component, {
   *     contextSetup: (activate) => activate(new Map([[Token._id, value]])),
   *   })
   */
  readonly contextSetup?: (
    activate: (map: Map<symbol, unknown>) => void,
    deactivate: () => void,
  ) => void

  /**
   * GX Phase 4 (#466) — the P5/I2s guard: mark this render as a GOVERNED
   * tree. Governed trees are never streamed — encountering a `pending`
   * `dataSource` boundary in a governed render is refused fail-closed
   * (`GOVERNED_UNGATED` posture, 40-spec §10) rather than suspended, because
   * a streamed governed subtree would be an emission path the generated
   * loader never gated. Set by the router's governed `handle` path.
   */
  readonly governed?: boolean

  /**
   * The component's light-DOM scope id (light-DOM leaf flip, LDF §10 step 3).
   * When set, the render stamps `data-a="<id>"` on the component's ROOT
   * element — the server-side mirror of `@aihu/runtime`'s `wrapClass`
   * `connectedCallback` stamp — so the `@scope([data-a="<id>"]) to ([data-a])`
   * blocks the build emitted for this component apply to the prerendered HTML
   * at FIRST PAINT, before any client JS runs.
   *
   * This is not cosmetic. Without the stamp, a prerendered light-DOM
   * component's scoped CSS (its entire `@style` block, media queries
   * included) matches NOTHING until the component's chunk loads and the
   * runtime stamps the host — measured on apps/docs-next under Lighthouse's
   * throttled profile, the unstyled first paint pushed the LCP element below
   * the fold and cost ~1.9s of LCP (3430ms → 1470ms once stamped).
   *
   * The value is the compiler-assigned id (`_lightScopeId` over the module
   * id) — read it from the compiled module's `__aihu_light_scope__` export;
   * never hand-compute it. Undefined (the default) stamps nothing —
   * byte-identical output to the pre-option renderer.
   */
  readonly lightScopeId?: string

  /**
   * Wrap the render in the component's own custom-element tag.
   *
   * WHY. SSR renders a component's TEMPLATE, not the component. Output is the
   * template root — `<div class="dn-docs">` — while the client does
   * `document.createElement('aihu-layout-docs')` and mounts the template
   * INSIDE it. The two shapes never match, so the client cannot adopt the
   * prerendered subtree and replaces it wholesale. Measured on apps/docs by
   * tagging every prerendered node before hydration: 0 of 391 survived.
   *
   * Read the tag from the compiled module's `__aihu_tag__` export; never
   * hand-derive it from a filename (`layoutTagFor`/`componentTagFor` are the
   * client's own derivation and can drift from what `defineElement` actually
   * registered).
   *
   * The wrapper carries `data-a` and the template root does NOT, because that
   * is where the CLIENT puts it: `define-element.ts` stamps the HOST in its
   * constructor. Its comment already asserts "a server-rendered element
   * already carries `data-a`" — true only once the host exists in server
   * output. The wrapper takes no `data-aihu-path`: the host is not a node in
   * the component's arbor tree, so the template root keeps ROOT_PATH and every
   * hydration path below it is unchanged.
   *
   * Undefined (the default) emits exactly what the pre-option renderer did.
   */
  readonly wrapTag?: string

  /**
   * Child components, keyed by the custom-element tag they register under —
   * the fix for `<site-header>` prerendering empty on every page.
   *
   * A component referenced inside another component's template renders as an
   * empty shell, because the child's template lives in its own module and only
   * materialises when the element upgrades in the browser. Supplying this map
   * lets both renderers fill it in: the compiled string renderer receives it on
   * its opts and the tree walker reads it here, and BOTH hand it to the same
   * `__aihu_schild`, so a resolved child is serialized in exactly one place.
   *
   * PRE-RESOLVED, and a Map rather than a callback, for three reasons that all
   * point the same way: module loading is async while the compiled fast path is
   * synchronous (a callback would force the fast path off, which is the whole
   * thing this design avoids); the cycle guard wants to run once over the tag
   * graph rather than at every render; and resolution needs the caller's module
   * loader, which `@aihu/server` has no business owning.
   *
   * How the caller builds it is step 5's job — SSG prerender via
   * `ssrLoadModule`, the Workers handler via a generated tag→module manifest —
   * and that is also where a cyclic tag graph must be REJECTED, loudly, before
   * any render begins. (`__aihu_schild` carries a depth cap as a backstop, not
   * as the guard.)
   *
   * NOT YET EMITTED, and deliberately not described here as if it were: the
   * plan has the compiler export `__aihu_child_tags__` — each module's static
   * set of referenced component tags — to drive that transitive walk. It is a
   * prerequisite of step 5, not of this option, which works with any map the
   * caller assembles. Naming an export in a doc comment before it exists is how
   * `contextSetup` and `resolveComponent` each read as done while unbuilt.
   *
   * Omitted (the default) renders every reference as the empty element it
   * renders today — byte-identical output, which is what makes this safe to
   * ship ahead of the callers that populate it.
   */
  readonly children?: ReadonlyMap<string, SsrChildModule>

  /**
   * @internal Nesting depth of this render below a top-level one, incremented
   * per child rendered through the walker's escape-hatch path (§8).
   *
   * Only that path sets it. The string path keeps its own `__depth` on
   * `SsrChildRenderOpts`; both cap at `_MAX_CHILD_DEPTH`, and both exist for
   * the same reason — the registry only WARNS about a cyclic component graph
   * now, so the renderers are what make a cycle finite.
   */
  readonly __childDepth?: number

  /**
   * @internal Shared byte budget for child markup, threaded down the same path
   * as `__childDepth`. Mutated in place; one object per top-level render.
   *
   * A depth cap bounds how deep a graph goes, not how wide. Three references
   * repeated thirteen deep is `3^13` reference sites and megabytes of legal,
   * acyclic output — see the `__budget` commentary in `ssr-string.ts`.
   */
  readonly __childBudget?: { bytes: number; reported: boolean }
}

/**
 * Accepts:
 * 1. `() => unknown` — factory returning an arbor Branch | Leaf.
 * 2. `{ toHtml(): string }` — direct HTML provider (escape hatch).
 */
export type ComponentDescription = (() => unknown) | { toHtml(): string }

function escapeAttr(val: string): string {
  return val.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/** Escape element text content (NOT attributes): &, <, > → entities. */
function escapeText(val: string): string {
  return val.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Read an arbor text-leaf `value`. Per the arbor leaf shape (leaf.ts), a static
 * leaf carries the string directly; a reactive leaf carries a `[read, write]`
 * Signal tuple (discriminated by `Array.isArray`). SSR reads the current value.
 */
function leafText(value: unknown): string {
  if (Array.isArray(value)) {
    const get = value[0]
    return typeof get === 'function' ? String((get as () => unknown)()) : ''
  }
  return value == null ? '' : String(value)
}

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])

// Client codegen uses this transport-only key for values passed across a custom
// element boundary. Arbor consumes it as a property assignment, but HTML must
// contain the public prop name: an internal marker in server markup cannot be
// read by the browser and breaks parity with the compiled string renderer.
const COMPONENT_PROP_PREFIX = '__aihu_prop:'

function serializedAttrName(key: string): string {
  return key.startsWith(COMPONENT_PROP_PREFIX) ? key.slice(COMPONENT_PROP_PREFIX.length) : key
}

/**
 * Serialize a branch/leaf attr map to ` k="v"` / boolean-attr form.
 *
 * Value resolution mirrors the CLIENT's `_applyAttrs` (arbor/src/attrs.ts)
 * and the arbor AttrMap contract (types.ts §1.2):
 *   - a reactive binding is the `[read, write]` Signal tuple / `[read]` thunk
 *     array — the current value is `get()`, exactly what the client effect
 *     writes into the DOM, so hydration confirms the attribute instead of
 *     rewriting it. Previously the array was fed to `String(v)`, which
 *     stringifies the GETTER FUNCTION SOURCE into the attribute
 *     (`class="() => { … }"`) — broken bytes on every compiled reactive attr.
 *   - function values (event handlers, `onclick: fn`) never serialize —
 *     handlers are wired at hydration, and function source in HTML was the
 *     same defect wearing its other hat.
 *   - resolved/static primitives keep the shipped rules: `true` → bare attr,
 *     `false`/`undefined` → omitted, everything else → `String(v)` escaped.
 *
 * The compiled string renderer (`__ssrString` + @aihu/runtime's
 * `__aihu_sattr`) mirrors these EXACT rules — the differential suite pins
 * the byte-identity, so these resolved-value rules must not drift from
 * `__aihu_sattr` (which is why nullish is NOT special-cased beyond the
 * shipped `false`/`undefined` omission).
 */
function serializeAttrs(attrs: Record<string, string | boolean>): string {
  let out = ''
  for (const [k, v] of Object.entries(attrs)) {
    const name = serializedAttrName(k)
    let val: unknown = v
    if (Array.isArray(val)) {
      const get = val[0]
      val = typeof get === 'function' ? (get as () => unknown)() : get
    }
    if (typeof val === 'function') continue
    if (val === false || val === undefined) continue
    // §13, serialization layer. Values were escaped here from the start; KEYS
    // never were, so `{ 'data-x/onload': 'alert(1)' }` serialized to an
    // `onload` handler in the page. Checked AFTER the value rules so a name
    // that was never going to serialize does not produce a warning, and
    // through the same predicate `__aihu_sattr` uses so the two renderers drop
    // the same keys — a divergence here is a byte-identity failure, not just a
    // hole. See `_isSerializableAttrName` for why this drops rather than throws.
    if (!_isSerializableAttrName(name)) continue
    if (val === true) out += ` ${name}`
    else out += ` ${name}="${escapeAttr(String(val))}"`
  }
  return out
}

function asAttrMap(v: unknown): Record<string, string | boolean> {
  return typeof v === 'object' && v !== null ? (v as Record<string, string | boolean>) : {}
}

/**
 * Render an arbor leaf to HTML. A text leaf (`leafKind: 'text'`) renders its
 * escaped `value`; an element leaf (`leafKind: 'element'`) renders `<tag attrs>`
 * (void) or `<tag attrs></tag>`. Previously this read a nonexistent `obj.text`
 * field, so all leaf content was dropped (fellwork FEL-224).
 */
function renderLeaf(obj: Record<string, unknown>): string {
  if (obj.leafKind === 'element') {
    const tag = typeof obj.tag === 'string' ? obj.tag : 'span'
    const a = serializeAttrs(asAttrMap(obj.attrs))
    return VOID_ELEMENTS.has(tag) ? `<${tag}${a}>` : `<${tag}${a}></${tag}>`
  }
  return escapeText(leafText(obj.value))
}

/**
 * Boundary comment emitted between two adjacent text-leaf children. Two bare
 * text leaves rendered back-to-back (e.g. `{a} {b}` → `a`,` `,`b`) parse into a
 * SINGLE DOM Text node, which misaligns the hydration walker's per-host text
 * cursor (it claims one node per text leaf; see `arbor/src/hydrate.ts`). An
 * interleaved comment keeps them as separate Text nodes and is skipped by the
 * walker, so it is invisible to both render and hydrate. Only element/branch
 * children wrap in tags, so only text-leaf pairs need this. Emitted in
 * hydratable output only.
 *
 * "Hydratable output only" is a narrower claim than it used to make. This
 * comment previously justified the gate with "static SSR never hydrates, so the
 * extra bytes would be dead weight" — true only of output that is genuinely
 * terminal (a feed, an email body, a snapshot for an extractor). It was NOT
 * true of the two callers that dominate real traffic: `@aihu/router`'s SSR
 * handler and `@aihu/app`'s SSG prerenderer both produce HTML that a live SPA
 * hydrates into, and both formerly called `renderToString(...)` with no options
 * and therefore shipped markerless HTML. That is fixed at those call sites; the
 * gate itself is correct and stays. The lesson it encodes: `hydratable` is a
 * property of the DESTINATION, not of the renderer, so it must be explicit at
 * every call site rather than defaulted from what "SSR" seems to imply.
 */
const TEXT_LEAF_BOUNDARY = '<!--|-->'

/** A text leaf renders bare text (no tag/comment wrapper), so two adjacent ones coalesce. */
function _isTextLeaf(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false
  const o = node as Record<string, unknown>
  return o.kind === 'leaf' && o.leafKind !== 'element'
}

/** The boundary to emit before `children[i]` (empty unless it and its predecessor are both text leaves). */
function _textBoundaryBefore(children: unknown[], i: number, hydratable: boolean): string {
  return hydratable && i > 0 && _isTextLeaf(children[i - 1]) && _isTextLeaf(children[i])
    ? TEXT_LEAF_BOUNDARY
    : ''
}

/**
 * The root path key seeded into the `data-aihu-path` walk.
 *
 * A WIRE-PROTOCOL constant shared with two other implementations of the same
 * scheme: the client walker (`@aihu/arbor`'s `hydrate.ts`, `_ROOT_PATH`) and
 * the Rust renderer (`src-native/src/render.rs`, asserted in its `data-aihu-path="0"`
 * test). It is a fixed literal rather than a counter because the server renders
 * from a long-lived process and the client starts fresh each page load — no
 * counter can agree across that split. If this diverges from the client's root,
 * every branch lookup misses and hydration silently rebuilds the tree beside the
 * server's DOM instead of adopting it (no error is thrown; content duplicates).
 *
 * Not imported from `@aihu/arbor`: that is the client runtime and pulling it in
 * here would be a server-bundle leak. Agreement is enforced behaviorally by
 * `tests/integration/ssr-hydrate-path-parity.test.ts` and
 * `scripts/check-hydration-adoption.ts`, which is stronger than a shared import
 * anyway — a shared TS constant could not cover the Rust implementation at all.
 */
const ROOT_PATH = '0'

// ---------------------------------------------------------------------------
// #465 — the structural walk. `when()`/`each()` nodes (the compiled output of
// `{#if}`/`{#each}` and the upcoming attribute grammar) carry their branches
// as closures and their conditions/collections as Signal-shaped values; both
// are synchronously readable server-side, so SSR renders the ACTIVE branch.
// ---------------------------------------------------------------------------

/**
 * Read a structural condition's current boolean value.
 *
 * Accepted shapes (all observed in compiled output / arbor's contract):
 *   - `[read, write]` Signal tuple or `[() => expr]` thunk-array — the
 *     compiler's `createIfBoundary` forms; read via `cond[0]()`, exactly the
 *     client reconciler's read (`_reconcileWhen` in arbor/structural.ts).
 *   - a plain closure `() => boolean` — hand-built trees.
 *   - anything else — coerced with Boolean (fail-safe: no content).
 */
function _condTruthy(cond: unknown): boolean {
  if (Array.isArray(cond)) {
    const get = cond[0]
    return typeof get === 'function' ? Boolean((get as () => unknown)()) : Boolean(get)
  }
  return typeof cond === 'function' ? Boolean((cond as () => unknown)()) : Boolean(cond)
}

/**
 * Read a structural list's current items. Same shape latitude as
 * `_condTruthy`: Signal tuple / thunk-array (`list[0]()` — the client
 * reconciler's read in `_reconcileEach`), plain closure, or a plain array.
 * Non-array reads render as empty (fail-safe).
 */
function _listItems(list: unknown): unknown[] {
  let items: unknown = list
  if (Array.isArray(list) && typeof list[0] === 'function') {
    items = (list[0] as () => unknown)()
  } else if (typeof list === 'function') {
    items = (list as () => unknown)()
  }
  return Array.isArray(items) ? items : []
}

/**
 * The subtrees a structural node contributes to the render, with the path
 * each subtree continues under. Paths MIRROR the client materializer
 * (`arbor/src/structural.ts`) so `data-aihu-path` markers inside structural
 * content address the key space the hydration walker asks for:
 *   - conditional (true):  `${path}.conditional.true`
 *   - list item (key k):   `${path}.list.${String(k).replace(/\./g, '_')}`
 * A false conditional or an empty collection contributes nothing — the
 * compiler lowers `else` / `empty` arms to sibling `when()` nodes with
 * negated conditions, so every authored branch is its own conditional here.
 */
function _structuralSubtrees(
  obj: Record<string, unknown>,
  path: string,
): Array<{ node: unknown; path: string }> {
  if (obj.structuralKind === 'conditional') {
    const grow = obj.grow
    if (typeof grow !== 'function' || !_condTruthy(obj.condition)) return []
    return [{ node: (grow as () => unknown)(), path: `${path}.conditional.true` }]
  }
  if (obj.structuralKind === 'list') {
    const grow = obj.listGrow
    if (typeof grow !== 'function') return []
    const items = _listItems(obj.list)
    const keyFn = typeof obj.keyFn === 'function' ? (obj.keyFn as (i: unknown) => unknown) : null
    const out: Array<{ node: unknown; path: string }> = []
    for (let i = 0; i < items.length; i++) {
      const key = String(keyFn ? keyFn(items[i]) : i).replace(/\./g, '_')
      out.push({
        node: (grow as (i: unknown, idx: number) => unknown)(items[i], i),
        path: `${path}.list.${key}`,
      })
    }
    return out
  }
  return []
}

/**
 * Comment-safe form of a path for the structural delimiters below: `-` → `_`
 * so no `--` sequence can terminate the comment early (list keys are
 * arbitrary strings — slugs with hyphens are routine). The client walker
 * (`arbor/src/hydrate.ts`) applies the SAME transform when computing the
 * marker it looks for; the two must never diverge.
 */
function _commentPath(path: string): string {
  return path.replace(/-/g, '_')
}

/**
 * Structural delimiters emitted around a structural node's output in
 * HYDRATABLE renders only: `<!--aihu:s:PATH-->` … `<!--aihu:/s:PATH-->`.
 * They serve two roles:
 *   1. The client walker locates the server-rendered structural segment by
 *      exact path match and ADOPTS it in place — claiming the segment's DOM
 *      into live reconciler child scopes (`_adoptStructural` in
 *      `arbor/src/hydrate.ts`), with a remove-and-rebuild-in-position
 *      fallback (adopt-by-replace) when the segment cannot be claimed
 *      safely — so hydration never duplicates content beside the server's
 *      DOM.
 *   2. As comments they keep a text leaf before the structural node and one
 *      after it from coalescing into a single DOM Text node (the same
 *      cursor-alignment concern `TEXT_LEAF_BOUNDARY` covers).
 * Like `data-aihu-path`, they are destination properties: terminal
 * (non-hydratable) output carries no markers and no extra bytes.
 */
function _structuralMarkers(path: string, hydratable: boolean): { open: string; close: string } {
  if (!hydratable) return { open: '', close: '' }
  const p = _commentPath(path)
  return { open: `<!--aihu:s:${p}-->`, close: `<!--aihu:/s:${p}-->` }
}

/** A branch with a `null` or `''` tag is a FRAGMENT: no wrapper element, no
 * path marker of its own; children continue at `${path}.${i}` in the same
 * host — mirroring `_materialize` case 4 (`arbor/src/materialize.ts`). The
 * compiler emits `branch('', …)` for `{#if}`/`{#each}` bodies, so structural
 * SSR is impossible without this case; previously a null tag rendered a
 * spurious `<div>` wrapper the client never creates. */
function _isFragment(obj: Record<string, unknown>): boolean {
  return obj.tag === null || obj.tag === ''
}

/**
 * Is this path a COMPILE-TIME LITERAL — the emitter's `path.base.is_none()`,
 * reconstructed from the finished path string?
 *
 * The fourth v1 boundary, and the one that drifted twice. The emitter declines
 * a reference whose path is runtime-built; only an `{#each}` item boundary
 * makes it so (`P { base: Some(pv), … }` in `ssr_string_emit.rs`), because only
 * there is a segment a runtime value. The walker had no mirror at all, so a
 * component referenced inside a loop resolved here and stayed an empty element
 * on the compiled fast path.
 *
 * The first mirror read "every segment is digits", which was a PROXY for
 * literalness rather than the thing itself — and too strict by exactly one
 * shape. `{#if}` bodies continue at `PATH.conditional.true`, a suffix fixed at
 * compile time, so the emitter resolves there while the digits rule declined:
 * `<div if={ready}><site-header></site-header></div>` — an entirely ordinary
 * template — became a fresh divergence in the act of fixing `{#each}`.
 *
 * So test the real property. `_structuralSubtrees` above builds every non-index
 * segment, and it builds exactly two shapes: `conditional` + `true` (fixed) and
 * `list` + KEY (runtime). A path is literal iff it contains no `list` segment;
 * checking for the literal `list` is sound even against hostile keys, because
 * the key always FOLLOWS it — `each={x of ['list']} key={x}` yields
 * `…list.list`, which this rejects at the first of the two.
 *
 * Anything unrecognized is rejected: declining too much only costs a child its
 * server markup, while declining too little costs byte-identity.
 *
 * Note this can only ever be a mirror, never the same code — the emitter tests
 * a struct field it built, this tests a string. The enforcement is the
 * per-boundary differential fixture set in `ssr-string-differential.test.ts`.
 */
function _isLiteralPath(path: string): boolean {
  const segs = path.split('.')
  for (let i = 0; i < segs.length; i++) {
    // `noUncheckedIndexedAccess` types this `string | undefined`; `??` keeps the
    // loop honest without an assertion, and an empty segment fails below anyway.
    const seg = segs[i] ?? ''
    // The one fixed structural pair. Consumed together so a bare `conditional`
    // or a bare `true` (only reachable as a list key) still fails.
    if (seg === 'conditional' && segs[i + 1] === 'true') {
      i++
      continue
    }
    if (seg.length === 0) return false
    for (let j = 0; j < seg.length; j++) {
      const c = seg.charCodeAt(j)
      if (c < 48 || c > 57) return false
    }
  }
  return true
}

/**
 * Serialize one head element's attribute bag.
 *
 * §12: the names were emitted verbatim. Values were escaped from the start, so
 * `{ 'x/http-equiv': 'refresh' }` — or anything else with a space in it — was
 * the one shape that could still put an attribute of its own choosing into the
 * document head. Same predicate as `serializeAttrs`, same drop-and-warn.
 */
function serializeHeadAttrs(bag: Record<string, unknown>): string {
  return Object.entries(bag)
    .filter(([k, v]) => v !== undefined && _isSerializableAttrName(k))
    .map(([k, v]) => `${k}="${escapeAttr(String(v))}"`)
    .join(' ')
}

function buildHead(head: HeadConfig): string {
  const parts: string[] = []
  // ESCAPED. `<title>` is RCDATA — entities are parsed, and the only thing that
  // ends it is `</title` — so an unescaped title carrying `</title><script>`
  // closed the element and ran script.
  //
  // SSG never hit this, and NOT because it escapes first: `@aihu/app`'s
  // `applyHeadToHtml` builds its own `<title>` (with its own `escapeText`) and
  // never calls this function. The two are parallel implementations of the same
  // markup, which is why one could be escaped for its whole life while the other
  // was not. This one's caller is `renderToStream`, reached by the documented
  // `renderToString(component, { head })` — so nothing escaped it before here,
  // and no double-escaping is introduced by escaping it here.
  if (head.title) parts.push(`<title>${escapeText(head.title)}</title>`)
  for (const meta of head.meta ?? []) {
    parts.push(`<meta ${serializeHeadAttrs(meta as Record<string, unknown>)}>`)
  }
  for (const link of head.links ?? []) {
    parts.push(`<link ${serializeHeadAttrs(link as Record<string, unknown>)}>`)
  }
  for (const script of head.scripts ?? []) {
    // The script body is element text (not an attribute), so it is emitted
    // verbatim. We only neutralize a literal `</` so an injected `</script>`
    // cannot break out of the element — matching the HTML spec guidance for
    // inlining JSON in <script>.
    const body = script.content.replace(/<\//g, '<\\/')
    parts.push(`<script type="${escapeAttr(script.type)}">${body}</script>`)
  }
  return parts.join('')
}

// ---------------------------------------------------------------------------
// Internal async tree-walker for renderToStream
// ---------------------------------------------------------------------------

/**
 * The per-render bookkeeping `__aihu_schild` keeps on its own opts, kept here
 * for the walker's escape-hatch child path (§8) instead.
 *
 * It CANNOT live in a module-global. `@aihu/server` inlines `ssr-string.ts`
 * into its own bundle, so a module-global in either place exists twice; more
 * basically, a budget shared across concurrent requests would let one page's
 * fan-out starve another's. Threaded through opts, mutated in place, one object
 * per top-level render.
 */
interface ChildWalkState {
  /** Remaining child markup bytes for this top-level render. */
  bytes: number
  /** Has the exhaustion been reported? One message, not one per reference. */
  reported: boolean
}

/** The state-script's opening tag — see `_buildStateScript`, and `_dropStateScript`. */
const STATE_SCRIPT_OPEN = '<script type="application/json" id="__aihu_state__">'

interface WalkPendingState {
  count: number
  walkDone: boolean
  opts: StreamOptions | undefined
  root: unknown
  /** §8's byte budget, one object per top-level render. */
  childWalk: ChildWalkState
  /** Stop-once disposer for the per-render effect scope (SSR ownership,
   * effect-scope plan §3). Set by renderToStream's factory branch; every
   * TERMINAL path of the render — walk done, boundary close, boundary
   * error, walk error, factory throw, consumer cancel — must call it.
   * Idempotent by construction (the wrapper carries a `scopeStopped`
   * flag), so overlapping terminals are safe. */
  dispose: () => void
}

/**
 * Render a child component's inner tree WITH THE WALKER and wrap it — the
 * `AIHU_SSR_STRING=0` arm of the child path (§8).
 *
 * Returns `undefined` for "not renderable this way; use `__aihu_schild`". That
 * is not a failure signal, it is how markup identity between hatch-on and
 * hatch-off is preserved: this function's eligibility must be a SUBSET of
 * `__aihu_schild`'s, never a superset. Where it declines, the caller falls back
 * to the string path and the page is byte-identical to a hatch-off render.
 *
 * The gate therefore repeats `__aihu_schild`'s: a compiled `__ssrString` must
 * exist (a module whose emitter BAILED renders bare on the string path, so it
 * must render bare here too, even though the walker could happily render it),
 * and `__aihu_shadow__` must be known (there is no safe DOM mode to guess).
 * `default` must be a factory, which for a real server artifact follows from
 * the first condition — the emitter attaches `__aihu_ssr_string__` to `__ssr`
 * in the same breath as it exports `__ssrString` — but a hand-built registry
 * entry can violate it, and then falling back is again the identity-preserving
 * answer.
 *
 * NO MEMO, unlike the string path. The memo is a pure speed optimization there
 * (identical inputs, identical bytes) and this is the DEBUGGING path — the one
 * you take when you suspect the fast path of lying to you, where rendering each
 * reference site independently is the more useful behaviour. The BYTE BUDGET is
 * kept, because it is not an optimization: without it a fan-out graph produces
 * gigabytes, and the depth cap alone cannot bound width.
 */
async function _renderChildViaWalker(
  tag: string,
  attrsHtml: string,
  mod: SsrChildModule,
  hydratable: boolean,
  children: ReadonlyMap<string, SsrChildModule>,
  pendingState: WalkPendingState,
): Promise<string | undefined> {
  const shadow = mod.__aihu_shadow__
  if (
    typeof mod.__ssrString !== 'function' ||
    (shadow !== 'light' && shadow !== 'shadow') ||
    typeof mod.default !== 'function'
  ) {
    return undefined
  }

  const bare = `<${tag}${attrsHtml}></${tag}>`
  // Past either bound the reference renders as the empty element it rendered
  // before child resolution existed — the same degradation `__aihu_schild`
  // applies, reached through the same two limits so the hatch does not move
  // where a pathological graph gives up.
  const depth = pendingState.opts?.__childDepth ?? 0
  if (depth >= _MAX_CHILD_DEPTH) return bare
  const budget = pendingState.childWalk
  if (budget.bytes <= 0) return bare

  let inner: string
  try {
    inner = await _walkChildInner(mod.default as () => unknown, hydratable, children, depth, budget)
  } catch (err) {
    // Same contract as `__aihu_schild`'s catch: one broken child must not take
    // the page down, and must not be silent either.
    console.error(`[aihu] SSR child <${tag}> threw; rendering it empty:`, err)
    return bare
  }

  budget.bytes -= inner.length
  if (budget.bytes <= 0) {
    if (!budget.reported) {
      budget.reported = true
      console.error(
        `[aihu] SSR child budget (${_MAX_CHILD_BYTES} bytes) exhausted at <${tag}>; ` +
          `further children render empty. This usually means a component graph fans out ` +
          `exponentially — look for a component that references itself transitively.`,
      )
    }
    return bare
  }

  return _ssrChildWrap(tag, attrsHtml, mod, inner, hydratable)
}

/**
 * Drain a nested `renderToStream` into the child's INNER markup.
 *
 * `renderToStream`, not `renderToString`: the latter layers `wrapTag` and
 * `contextSetup` on top, and both are wrong here — the host element is wrapped
 * by `_ssrChildWrap` from the child's own `__aihu_shadow__`, and activating a
 * fresh context map mid-render would blank the PARENT's.
 *
 * `lightScopeId: ''` for the reason `__aihu_schild` documents at length: the
 * `data-a` stamp belongs on the HOST, and an omitted option lets a fallback
 * stamp the template root as well. Empty string is falsy at the walker's
 * `if (rootScopeId && …)` test, so the child's root renders unstamped.
 *
 * The trailing state script is DROPPED. `emitStateScriptAndClose` enqueues it
 * as its own final chunk, so this is a chunk-boundary check and not a regex
 * over the markup. It has to go: the envelope is per-DOCUMENT channel data that
 * the top-level render emits once, and a copy of it buried inside a child's
 * subtree would be markup the string path never produces — a byte divergence,
 * and a second `id="__aihu_state__"` in the page.
 */
async function _walkChildInner(
  factory: () => unknown,
  hydratable: boolean,
  children: ReadonlyMap<string, SsrChildModule>,
  depth: number,
  budget: ChildWalkState,
): Promise<string> {
  const stream = renderToStream(factory, {
    hydratable,
    lightScopeId: '',
    children,
    __childDepth: depth + 1,
    __childBudget: budget,
  })
  const reader = stream.getReader()
  const chunks: string[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const last = chunks[chunks.length - 1]
  if (last?.startsWith(STATE_SCRIPT_OPEN)) chunks.pop()
  return chunks.join('')
}

async function renderNodeAsync(
  node: unknown,
  path: string,
  hydratable: boolean,
  controller: ReadableStreamDefaultController<string>,
  pendingState: WalkPendingState,
): Promise<void> {
  if (typeof node !== 'object' || node === null) {
    controller.enqueue('')
    return
  }
  const obj = node as Record<string, unknown>
  if (!('kind' in obj)) {
    controller.enqueue('')
    return
  }

  if (obj.kind === 'leaf') {
    controller.enqueue(renderLeaf(obj))
    return
  }

  if (obj.kind === 'structural') {
    // #465 — structural nodes render their active branch. Children recurse
    // through THIS walker, so a `dataSource` boundary inside a structural
    // subtree keeps its semantics — including the P5/I2s governed refusal on
    // `pending` (a governed structural render still never streams).
    const { open, close } = _structuralMarkers(path, hydratable)
    if (open) controller.enqueue(open)
    for (const sub of _structuralSubtrees(obj, path)) {
      await renderNodeAsync(sub.node, sub.path, hydratable, controller, pendingState)
    }
    if (close) controller.enqueue(close)
    return
  }

  if (obj.kind === 'branch' && _isFragment(obj)) {
    // Fragment (null/'' tag): no wrapper, no path marker, no dataSource
    // boundary of its own — children continue at `${path}.${i}` directly,
    // mirroring `_materialize` case 4 in arbor.
    const children = Array.isArray(obj.children) ? obj.children : []
    for (let i = 0; i < children.length; i++) {
      const b = _textBoundaryBefore(children, i, hydratable)
      if (b) controller.enqueue(b)
      await renderNodeAsync(children[i], `${path}.${i}`, hydratable, controller, pendingState)
    }
    return
  }

  if (obj.kind === 'branch') {
    const tag = typeof obj.tag === 'string' ? obj.tag : 'div'
    let attrStr = serializeAttrs(asAttrMap(obj.attrs))
    // LDF §10 step 3 — `data-a` on the ROOT element only. Same placement as
    // the compiled string renderer's `root_scope_attr` (static attrs, then
    // `data-a`, then the path marker) so walker and string output stay
    // byte-identical. `pendingState.opts` carries the render's SsrOptions,
    // so no extra parameter threads through the recursion.
    const rootScopeId = pendingState.opts?.lightScopeId
    if (rootScopeId && path === ROOT_PATH) attrStr += ` data-a="${escapeAttr(rootScopeId)}"`
    if (hydratable) attrStr += ` data-aihu-path="${escapeAttr(path)}"`

    const children = Array.isArray(obj.children) ? obj.children : []

    // Child component resolution. Hand the node to the SAME helper the compiled
    // string renderer calls, so a resolved child's markup is produced by one
    // function on both paths — the differential suite pins that they agree
    // byte-for-byte, and it can only do that if they render the same things.
    //
    // The v1 boundaries mirror the emitter's (`ssr_string_emit.rs`): zero
    // children (slot projection is unimplemented), no attrs (attributes at a
    // reference site are the child's props, and rendering with defaults while
    // the client renders with real values is a hydration mismatch), a literal
    // path (see `_isLiteralPath`), and not at ROOT_PATH.
    //
    // ROOT_PATH carries TWO hazards, and only the second is unconditional: the
    // parent's `data-a` stamp is already folded into `attrStr` above, so a
    // resolved child would carry a SECOND one from `_ssrChildWrap`; and a
    // resolved reference is a marked host, while arbor's `hydrate()` registers
    // its container under `_ROOT_PATH` and refuses any other value on it — a
    // marked host that itself sits at `'0'` is the one case that guard cannot
    // distinguish, so `'0'` would name two elements in one path map.
    //
    // A STRUCTURAL template root does not reach this check (followups §24):
    // `<x-kid if={…}>` as the whole template resolves at `0.conditional.true`,
    // where neither hazard exists, and both renderers agree. The parent's
    // `lightScopeId` reaching no element in that shape is real but is a
    // property of the stamp's PLACEMENT, not of this gate — a plain
    // `<div if={…}>` root loses it identically with no component anywhere, and
    // `wrapTag` (the stamp on the HOST, where the client puts it) is what
    // answers it. Fixtures: `ssr-string-differential.test.ts` boundary 4b.
    //
    // "Mirror" is the strongest word available: the two gates read DIFFERENT
    // inputs — Rust over the raw template AST, this over the lowered node — and
    // the lowering is lossy. Directive macros (`show`, `class:`, `ref`, `once`,
    // `raw`, `html`, `if`) and whitespace-only text are already gone by the
    // time they reach here, so this arm CANNOT decline on them however much it
    // would like to; the emitter has to be the side that agrees, and it is (see
    // `attr_survives_lowering` / `node_is_dropped` there). They cannot be made
    // structurally identical. What keeps them honest is the per-boundary
    // fixture set in `ssr-string-differential.test.ts`, one case per line of
    // this condition, each asserting the two renderers reach the SAME verdict —
    // including when that verdict is to decline.
    //
    // `attrStr` — the reference site's own attrs plus its path marker — is
    // passed through as the host attrs, so the host keeps its position in THIS
    // component's path space while the child's tree restarts at ROOT_PATH
    // behind the `data-aihu-ssr` boundary the helper stamps.
    const childRegistry = pendingState.opts?.children
    if (
      childRegistry &&
      children.length === 0 &&
      path !== ROOT_PATH &&
      _isLiteralPath(path) &&
      Object.keys(asAttrMap(obj.attrs)).length === 0 &&
      childRegistry.has(tag)
    ) {
      // §8 — the escape hatch reaches child subtrees too.
      //
      // `__aihu_schild` calls `mod.__ssrString` directly, so the compiled string
      // renderer stayed engaged for every child even under `AIHU_SSR_STRING=0`.
      // Two costs: the documented way to route a render back through the walker
      // did not actually do so below the top level, and the differential suite
      // could never exercise a walker-rendered child (the walker's child arm
      // called the string renderer, so both sides of the comparison were the
      // string renderer).
      //
      // `_ssrStringOf` is the hatch, so ASK IT — the same function the top-level
      // fast path asks, about the same module's default export, which the server
      // target attaches `__aihu_ssr_string__` to. When it answers `undefined`
      // the hatch is open and this branch walks the child instead.
      const childMod = childRegistry.get(tag)
      if (childMod !== undefined && _ssrStringOf(childMod.default) === undefined) {
        const walked = await _renderChildViaWalker(
          tag,
          attrStr,
          childMod,
          hydratable,
          childRegistry,
          pendingState,
        )
        // `undefined` means "this module is not walker-renderable after all"
        // (see the helper). Falling through to `__aihu_schild` then keeps the
        // MARKUP identical to the hatch-off render, which matters more than
        // hatch purity: `AIHU_SSR_STRING=0` is documented to change the engine,
        // never the bytes, and a component whose eligibility differed between
        // the two settings would silently break that promise.
        if (walked !== undefined) {
          controller.enqueue(walked)
          return
        }
      }
      controller.enqueue(__aihu_schild(tag, attrStr, { hydratable, children: childRegistry }))
      return
    }

    // Check for DataSource boundary (duck-type check — no arbor type changes needed)
    const dataSource = obj.dataSource as
      | {
          status: 'pending' | 'ready' | 'error'
          value?: unknown
          error?: unknown
          onReady(cb: () => void): () => void
        }
      | undefined

    if (!dataSource || typeof dataSource !== 'object') {
      // Synchronous branch — no async boundary
      controller.enqueue(`<${tag}${attrStr}>`)
      for (let i = 0; i < children.length; i++) {
        const b = _textBoundaryBefore(children, i, hydratable)
        if (b) controller.enqueue(b)
        await renderNodeAsync(children[i], `${path}.${i}`, hydratable, controller, pendingState)
      }
      controller.enqueue(`</${tag}>`)
      return
    }

    // Async boundary handling
    controller.enqueue(`<${tag}${attrStr}>`)

    if (dataSource.status === 'error') {
      controller.error(dataSource.error)
      pendingState.dispose()
      return
    }

    if (dataSource.status === 'ready') {
      // Already resolved — render children synchronously (no suspension)
      for (let i = 0; i < children.length; i++) {
        const b = _textBoundaryBefore(children, i, hydratable)
        if (b) controller.enqueue(b)
        await renderNodeAsync(children[i], `${path}.${i}`, hydratable, controller, pendingState)
      }
      controller.enqueue(`</${tag}>`)
      return
    }

    // GX Phase 4 (#466) — P5/I2s guard: a governed tree must not stream. A
    // `pending` dataSource here would suspend-and-emit governed content
    // outside the generated loader's gate, so it is refused fail-closed (the
    // GOVERNED_UNGATED posture, 40-spec §10) instead of registered.
    if (pendingState.opts?.governed) {
      controller.error(
        new Error(
          "GOVERNED_UNGATED: governed trees are not streamed — a 'pending' dataSource " +
            'inside a governed render is refused (fail-closed)',
        ),
      )
      pendingState.dispose()
      return
    }

    // status === 'pending' — register callback and increment pending counter
    pendingState.count++

    dataSource.onReady(async () => {
      try {
        if (dataSource.status === 'error') {
          controller.error(dataSource.error)
          pendingState.dispose()
          return
        }
        for (let i = 0; i < children.length; i++) {
          const b = _textBoundaryBefore(children, i, hydratable)
          if (b) controller.enqueue(b)
          await renderNodeAsync(children[i], `${path}.${i}`, hydratable, controller, pendingState)
        }
        controller.enqueue(`</${tag}>`)
        pendingState.count--
        if (pendingState.count === 0 && pendingState.walkDone) {
          emitStateScriptAndClose(controller, pendingState.opts, pendingState.root)
          // Last boundary closed the stream — the render is terminal; the
          // per-render scope's effects are disposed here (the emit above
          // already took its tree/signal reads).
          pendingState.dispose()
        }
      } catch (err) {
        controller.error(err)
        pendingState.dispose()
      }
    })

    // Return from renderNodeAsync — the synchronous walk continues past this boundary.
    return
  }

  // Unknown kind
  controller.enqueue('')
}

// ---------------------------------------------------------------------------
// Wave 3 — the state channel. One `__aihu_state__` script per render, emitted
// at the post-render site (after all pending boundaries settle), carrying
// `{ v: 1, stores: {...}, signals?: {...} }`.
// ---------------------------------------------------------------------------

/**
 * JSON-encode `state` for inline `<script type="application/json">` embedding.
 * Every `<` becomes `<` (neutralizing both `</script` breakout and
 * `<!--` comment-interference — HTML spec script-data escaping); U+2028/9
 * are escaped for downstream JS-context consumers. All replacements happen
 * inside JSON string values only (JSON syntax itself never contains these),
 * so `JSON.parse` round-trips the exact original state.
 */
function _safeStateJson(state: unknown): string {
  return JSON.stringify(state)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** Collect writable reactive attrs (`[read, write]` tuples) at `<path>.attr:<key>`. */
function _collectAttrSignals(attrs: unknown, path: string, out: Record<string, unknown>): void {
  if (typeof attrs !== 'object' || attrs === null) return
  for (const [key, v] of Object.entries(attrs as Record<string, unknown>)) {
    if (Array.isArray(v) && typeof v[0] === 'function' && typeof v[1] === 'function') {
      const name = serializedAttrName(key)
      const kind = key.startsWith(COMPONENT_PROP_PREFIX) ? 'prop' : 'attr'
      out[`${path}.${kind}:${name}`] = (v[0] as () => unknown)()
    }
  }
}

/**
 * Default `signals` collection: walk the rendered tree AFTER the render and
 * snapshot every WRITABLE signal binding (a `[read, write]` tuple — thunk
 * arrays/deriveds have no writer and are skipped: they re-derive from seeded
 * sources on the client) at the exact path keys the hydration walker wires:
 *   - reactive text leaf   → `<path>.text`
 *   - reactive attr        → `<path>.attr:<key>`  (branch and element leaf)
 * Path construction mirrors `renderNodeAsync` (children at `<path>.<i>`,
 * fragments transparent). Structural (`when()`/`each()`) subtrees are
 * deliberately skipped: hydration rebuilds structural segments from live
 * state (adopt-by-replace), and re-invoking `grow()` closures purely for
 * serialization would re-run authored code the render already ran.
 *
 * This is a SECOND walk, kept fully separate from `renderNodeAsync` so
 * the render dispatch stays untouched (coordination
 * contract with the compiled string-renderer fast path).
 */
function _collectSignals(node: unknown, path: string, out: Record<string, unknown>): void {
  if (typeof node !== 'object' || node === null) return
  const obj = node as Record<string, unknown>
  if (obj.kind === 'leaf') {
    if (obj.leafKind === 'element') {
      _collectAttrSignals(obj.attrs, path, out)
      return
    }
    const value = obj.value
    if (Array.isArray(value) && typeof value[0] === 'function' && typeof value[1] === 'function') {
      out[`${path}.text`] = (value[0] as () => unknown)()
    }
    return
  }
  if (obj.kind === 'branch') {
    if (!_isFragment(obj)) _collectAttrSignals(obj.attrs, path, out)
    const children = Array.isArray(obj.children) ? obj.children : []
    for (let i = 0; i < children.length; i++) {
      _collectSignals(children[i], `${path}.${i}`, out)
    }
  }
  // structural: skipped (see JSDoc).
}

/**
 * Build the `__aihu_state__` script for one finished render, or `''` when
 * there is no state to ship (so a state-free page's HTML is byte-identical
 * to today and the client's no-script hydration path is exercised).
 *
 * `root` is the rendered arbor tree (pass `null` when no JS tree exists —
 * `{ toHtml() }` providers, the native renderer, a compiled string-renderer
 * path that wants stores-only emission).
 *
 * Channel gating:
 *   - `signals`: an explicit `opts.serializer` always wins (and emits even on
 *     non-hydratable renders — the pre-wave-3 contract); otherwise collected
 *     from `root` only when `opts.hydratable` (state is a property of the
 *     DESTINATION, like the path markers).
 *   - `stores`: the injected store serializer, hydratable renders only.
 * Serializer throws are swallowed per-channel (a broken serializer degrades
 * to fresh client state, never a broken page).
 *
 * @internal — shared emission helper; every render branch (stream walk,
 * native append, string-renderer fast path) must emit through this.
 */
export function _buildStateScript(root: unknown, opts: SsrOptions | undefined): string {
  let signals: Record<string, unknown> | undefined
  if (opts?.serializer) {
    try {
      signals = opts.serializer()
    } catch {
      // swallow — signals channel omitted
    }
  } else if (opts?.hydratable && root !== null && root !== undefined) {
    const collected: Record<string, unknown> = {}
    try {
      _collectSignals(root, ROOT_PATH, collected)
      signals = collected
    } catch {
      // swallow — signals channel omitted
    }
  }
  let stores: Record<string, unknown> | undefined
  if (opts?.hydratable && _storeSerializer) {
    try {
      stores = _storeSerializer()
    } catch {
      // swallow — stores channel omitted
    }
  }
  const hasSignals = signals !== undefined && Object.keys(signals).length > 0
  const hasStores = stores !== undefined && Object.keys(stores).length > 0
  if (!hasSignals && !hasStores) return ''
  const state: Record<string, unknown> = { v: 1, stores: hasStores ? stores : {} }
  if (hasSignals) state.signals = signals
  return `${STATE_SCRIPT_OPEN}${_safeStateJson(state)}</script>`
}

/**
 * Insert the state script into an ALREADY-RENDERED HTML string — the
 * post-render emission path for renderers that never enqueue through the
 * stream walk (today: the native Rust renderer's addon paths in native.ts).
 * Pass the materialized `root` when a JS tree exists so the signals channel
 * rides along; `null` gives stores-only emission. Placed before the trailing
 * `</body>` when the document has one, appended otherwise.
 *
 * @internal
 */
export function _appendStateScript(
  html: string,
  opts: SsrOptions | undefined,
  root: unknown = null,
): string {
  const script = _buildStateScript(root, opts)
  if (!script) return html
  const i = html.lastIndexOf('</body>')
  return i === -1 ? html + script : html.slice(0, i) + script + html.slice(i)
}

function emitStateScriptAndClose(
  controller: ReadableStreamDefaultController<string>,
  opts: StreamOptions | undefined,
  root: unknown,
): void {
  const script = _buildStateScript(root, opts)
  if (script) controller.enqueue(script)
  if (opts?.head) {
    controller.enqueue('</body></html>')
  }
  controller.close()
}

// ---------------------------------------------------------------------------
// Wave-3 — the compiled string fast path.
// ---------------------------------------------------------------------------

/**
 * The opts-only compiled string renderer a component factory may carry.
 * Compiled server artifacts attach it as `__ssr.__aihu_ssr_string__`
 * (opts-only, empty props); callers that bind props re-attach a props-bound
 * version via `attachSsrString` below. The renderer's output is
 * BYTE-IDENTICAL to the tree walk for the same component+state — enforced by
 * the differential suite — so taking it changes latency, never bytes.
 */
type SsrStringRenderer = (opts?: {
  hydratable?: boolean
  lightScopeId?: string
  /** The pre-resolved child registry — see `SsrOptions.children`. */
  children?: ReadonlyMap<string, SsrChildModule>
}) => string

/**
 * Resolve the compiled string renderer for `component`, if any.
 * `AIHU_SSR_STRING=0` is the escape hatch back to the tree walker.
 */
function _ssrStringOf(component: unknown): SsrStringRenderer | undefined {
  if (typeof component !== 'function') return undefined
  if (typeof process !== 'undefined' && process.env && process.env.AIHU_SSR_STRING === '0') {
    return undefined
  }
  const f = (component as { __aihu_ssr_string__?: unknown }).__aihu_ssr_string__
  return typeof f === 'function' ? (f as SsrStringRenderer) : undefined
}

/**
 * Carry a compiled string renderer across a props-binding wrapper.
 *
 * Call sites that wrap a compiled `__ssr` to bind props
 * (`() => mod.default(props)`) hide the function-attached renderer from
 * `renderToString`; this re-attaches a props-bound one when the MODULE
 * exports `__ssrString(props, opts)`. Returns `component` for chaining.
 */
export function attachSsrString<T extends () => unknown>(
  component: T,
  ssrString: unknown,
  props: unknown,
): T {
  if (typeof ssrString === 'function') {
    ;(component as T & { __aihu_ssr_string__?: SsrStringRenderer }).__aihu_ssr_string__ = (
      opts?: Parameters<SsrStringRenderer>[0],
    ) => (ssrString as (p: unknown, o?: Parameters<SsrStringRenderer>[0]) => string)(props, opts)
  }
  return component
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderToStream(
  component: ComponentDescription,
  opts?: StreamOptions,
): ReadableStream<string> {
  // SSR ownership (effect-scope plan §3): the factory branch below runs the
  // component's full setup body server-side; every effect()/computed() it (or
  // a composable) creates would otherwise leak per request, because SSR
  // bypasses defineComponent's component scope. A per-render DETACHED scope
  // adopts them; `disposeScope` stops it exactly once on EVERY terminal path:
  // sync factory throw, walk done (count 0), last-boundary close, walk/
  // boundary errors — and, crucially, the consumer's `cancel()` (client
  // disconnect, or the AbortController-race timeout documented in
  // stream-types.ts) while a boundary is still pending. Hoisted out of
  // start() so both start() and cancel() reach the same disposer. The
  // string/toHtml branches never call setup, create no reactive tree, and
  // never assign it — cancel() is then a scope no-op.
  let disposeScope: (() => void) | undefined

  return new ReadableStream<string>({
    start(controller) {
      const pendingState: WalkPendingState = {
        count: 0,
        walkDone: false,
        opts,
        root: null as unknown,
        // Inherited when this render IS a child (the hatch path passes the
        // parent's object down), created fresh when it is the top level. One
        // budget per page, shared by every child under it.
        childWalk: opts?.__childBudget ?? { bytes: _MAX_CHILD_BYTES, reported: false },
        dispose: () => disposeScope?.(),
      }

      // Step 1: Emit document preamble if opts.head is set
      if (opts?.head) {
        const headHtml = buildHead(opts.head)
        const lang = opts.head.lang ? ` lang="${escapeAttr(opts.head.lang)}"` : ''
        controller.enqueue(`<!DOCTYPE html><html${lang}><head>${headHtml}</head><body>`)
      }

      // Wave-3 fast path: a compiled string renderer replaces the whole tree
      // build + walk with one function call. Compiled templates cannot carry
      // `dataSource` boundaries (the compiler never emits them — suspense is
      // a synchronous stub), so there is nothing to suspend on: the render is
      // one chunk, then the state script + close, exactly the byte sequence
      // the walker's drained stream produces. Trees that DO stream (hand-built
      // dataSource components) have no string renderer and take the walker
      // below, preserving flush/suspend semantics unchanged.
      const ssrString = _ssrStringOf(component)
      if (ssrString) {
        // The fast path needs BOTH halves of the server-render environment, and
        // used to have only one.
        //
        // A DETACHED effect scope: `onCleanup` — and everything built on it,
        // `$stream`, `$controller`, router boundaries, most composables —
        // resolves through `getCurrentScope()`, not the lifecycle owner
        // pointer, so the lifecycle sink alone never reaches it. Without a
        // scope here, the path essentially all production traffic takes threw
        // SCR-R0011 for any component using a stream or a composable; as a
        // CHILD that became a silently empty element.
        //
        // And the lifecycle window: setup runs outside `defineComponent`, so
        // `onMount` has no owner to register against.
        //
        // The walker branch below now opens both too. Neither path may hold
        // half the environment — that asymmetry is invisible until a component
        // happens to use the hook the other path forgot.
        const fastScope = effectScope(true)
        let html: string
        try {
          html = fastScope.run(() =>
            _withSsrLifecycle(() =>
              ssrString({
                hydratable: opts?.hydratable ?? false,
                // LDF §10 step 3: the compiled renderer's `root_scope_attr`
                // reads `__opts.lightScopeId` to stamp `data-a` on the root
                // element — forward it so the string path matches the walker.
                ...(opts?.lightScopeId !== undefined ? { lightScopeId: opts.lightScopeId } : {}),
                // The child registry `__aihu_schild` resolves against, for the
                // same reason as `lightScopeId`: a value reaching only one
                // renderer is a byte divergence the differential suite fails on.
                ...(opts?.children !== undefined ? { children: opts.children } : {}),
              }),
            ),
          ) as string
        } catch (err) {
          fastScope.stop()
          controller.error(err)
          return
        }
        controller.enqueue(html)
        // Wave-3 state channel under the string fast path: emitted through the
        // SAME helper as the walker so string-rendered pages ship an identical
        // `__aihu_state__` envelope. `root` is `null` DELIBERATELY — the string
        // renderer materializes no arbor tree, so there is nothing to walk;
        // STORE state is arbor-independent and rides along regardless.
        emitStateScriptAndClose(controller, opts, null)
        // Effects the setup created are per-render and must not outlive it.
        fastScope.stop()
        return
      }

      // Step 2: Resolve component
      if (typeof component !== 'function') {
        // { toHtml() } provider — no async boundaries possible
        let html: string
        try {
          html = component.toHtml()
        } catch (err) {
          controller.error(err)
          return
        }
        controller.enqueue(html)
        emitStateScriptAndClose(controller, opts, null)
        return
      }

      // Factory (function) — may produce async boundaries. Run it inside the
      // per-render detached scope so setup-created effects/computeds are
      // adopted and disposable. Stop-once wrapper: `scopeStopped` guarantees
      // exactly one stop() across overlapping terminals, and the try/catch
      // reports a throwing user disposer (console.error) instead of letting
      // it race a settled/errored controller.
      const scope = effectScope(true)
      let scopeStopped = false
      disposeScope = () => {
        if (scopeStopped) return
        scopeStopped = true
        try {
          scope.stop()
        } catch (e) {
          console.error('[aihu/server] SSR disposer threw:', e)
        }
      }

      let root: unknown
      try {
        // The walker had the effect SCOPE but no lifecycle WINDOW, while the
        // fast path below had the window but no scope — each path held half the
        // server-render environment, so `onMount` threw here and `onCleanup`
        // threw there. Both halves, both paths.
        root = scope.run(() => _withSsrLifecycle(() => component()))
      } catch (err) {
        disposeScope()
        controller.error(err)
        return
      }
      // Retained for the post-render state emission — both completion paths
      // (sync walk-done below and the last pending boundary's onReady) build
      // the state script from the SAME rendered tree.
      pendingState.root = root

      // Kick off async tree walk. The scope stays ALIVE during the walk — a
      // suspended boundary may still read the tree's computeds — and is
      // stopped only at a terminal: walk done with no pending boundaries
      // (here), the last boundary's close (onReady in renderNodeAsync), any
      // error path, or the consumer's cancel() below.
      renderNodeAsync(root, ROOT_PATH, opts?.hydratable ?? false, controller, pendingState)
        .then(() => {
          pendingState.walkDone = true
          if (pendingState.count === 0) {
            emitStateScriptAndClose(controller, opts, root)
            // Emit before stop: the state script reads the tree's signals.
            pendingState.dispose()
          }
        })
        .catch((err: unknown) => {
          controller.error(err)
          pendingState.dispose()
        })
    },
    cancel() {
      // Consumer cancelled mid-stream (client disconnect / streaming
      // timeout) — possibly with boundaries still pending, so no completion
      // path above will ever run. The per-render scope must be disposed HERE
      // or its effects leak for the process lifetime.
      disposeScope?.()
    },
  })
}

export async function renderToString(
  component: ComponentDescription,
  opts?: SsrOptions,
): Promise<string> {
  // Context setup: activate a fresh map, hand the caller the activate/clear
  // pair, then run the walk; clear unconditionally in the finally block.
  //
  // ORDER IS LOAD-BEARING, and it used to be backwards. `contextSetup` ran
  // FIRST and the fresh empty map was activated SECOND, so any map the caller
  // activated was immediately discarded — `inject()` saw only token defaults
  // during the walk. That made the hook a no-op for the one job its own doc
  // comment gives it ("pre-populate the context map"), and nothing caught it
  // because nothing in the repo had ever called it: the seam was built,
  // documented, and left unexercised.
  //
  // Activating the fresh map first preserves the per-render isolation
  // guarantee (a caller that only wants a clean slate does nothing and still
  // gets one) while letting a caller that DOES pre-populate replace it with a
  // map that survives to the walk.
  const hasContext = Boolean(opts?.contextSetup && _setContextMap && _clearContextMap)
  if (hasContext && opts?.contextSetup) {
    _setContextMap?.(new Map<symbol, unknown>())
    opts.contextSetup(_setContextMap!, _clearContextMap!)
  }

  // `wrapTag` moves the scope stamp from the template root onto the host
  // element, so the inner render must NOT also stamp it — two `data-a`
  // attributes would make the template root a nested scope root and cut the
  // component's own rules off at its first child (`@scope … to ([data-a])`
  // stops descending at the next stamped element).
  const wrapTag = opts?.wrapTag
  let innerOpts: SsrOptions | undefined = opts
  if (wrapTag && opts) {
    // OMIT the key rather than set it to `undefined` — `exactOptionalPropertyTypes`
    // treats those as different, and so does the `!== undefined` check downstream.
    const { lightScopeId: _dropped, ...rest } = opts
    innerOpts = rest
  }

  try {
    const stream = renderToStream(component, innerOpts)
    const reader = stream.getReader()
    const chunks: string[] = []
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    const html = chunks.join('')
    if (!wrapTag) return html
    const scopeAttr =
      opts?.lightScopeId !== undefined ? ` data-a="${escapeAttr(opts.lightScopeId)}"` : ''
    // `data-aihu-ssr` — the ADOPTION marker (first-render DOM adoption). A
    // wire-protocol attribute shared with two client consumers:
    //   - `@aihu/runtime`'s defineComponent connectedCallback reads it as the
    //     host's declaration that "my children are my OWN server-rendered
    //     template" — the one fact that disambiguates server template from
    //     user-slotted light-DOM content (slotted content arrives via a PARENT
    //     render and never carries the marker on ITS host). Marked hosts adopt
    //     via arbor `hydrate()` instead of rebuilding; marked-but-unadoptable
    //     children are discarded, never slot-projected.
    //   - `@aihu/arbor`'s `hydrate()` treats a nested marked host as a path
    //     boundary: each wrapped render restarts `data-aihu-path` at ROOT_PATH
    //     ('0'), so without the boundary an outer component's path map would
    //     collide with every nested wrapped render (e.g. the page inside a
    //     layout's outlet marker).
    // Hydratable renders only — like the path markers, this is a property of
    // the DESTINATION; terminal output carries no adoption bytes.
    const adoptAttr = opts?.hydratable ? ' data-aihu-ssr=""' : ''
    return `<${wrapTag}${scopeAttr}${adoptAttr}>${html}</${wrapTag}>`
  } finally {
    if (hasContext) {
      _clearContextMap?.()
    }
  }
}
