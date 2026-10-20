/**
 * packages/language-server/src/core/hover.ts
 *
 * Static hover lookup table for aihu macro keywords.
 * Used by the LSP server textDocument/hover handler.
 *
 * Editor-agnostic: returns Markdown strings + does pure position math. The
 * connection layer wraps the result in a protocol `Hover`. Clean seam for a
 * future Volar virtual-code hover provider.
 */

import { COMPOSABLE_REGISTRY } from './composable-registry.ts'

const COMPOSABLE_BY_NAME = new Map(COMPOSABLE_REGISTRY.map((e) => [e.name, e]))

/**
 * Hover markdown for a bare `@aihu/use` composable call (FEL-342). The
 * compiler auto-imports these — see `compileSidecar`'s ambient
 * `declare const useMouse: (...args: any[]) => any;` — so this is the only
 * place a real signature/description ever surfaces to the author.
 */
function composableHover(name: string): string | null {
  const entry = COMPOSABLE_BY_NAME.get(name)
  if (!entry) return null
  return [
    `**\`${entry.name}\`** _(auto-imported from \`${entry.specifier}\`)_`,
    '',
    entry.description || 'A `@aihu/use` composable.',
  ].join('\n')
}

const HOVER_TABLE: Record<string, string> = {
  $prop: [
    '**aihu macro: `$prop`**',
    '',
    'Declares reactive prop signals from parent attributes.',
    '',
    'Compiles to:',
    '```typescript',
    'const name = computed(() => ctx.attrs.name)',
    '```',
    '',
    '[v2 spec](docs/superpowers/specs/2026-05-05-spec-macro-vocabulary-v2.md)',
  ].join('\n'),

  $computed: [
    '**aihu macro: `$computed`**',
    '',
    'Declares a derived signal.',
    '',
    'Compiles to:',
    '```typescript',
    'const name = computed(() => expr)',
    '```',
    '',
    '[v2 spec](docs/superpowers/specs/2026-05-05-spec-macro-vocabulary-v2.md)',
  ].join('\n'),

  $action: [
    '**aihu macro: `$action`**',
    '',
    'Declares a callable action in component scope.',
    '',
    'Compiles to:',
    '```typescript',
    'function name(args) { return batch(() => { body }) }',
    '```',
    '',
    '',
    '> **Agent-side context:** `$action` is primarily for agent/MCP handler scope. In `@state` blocks, prefer `$computed` for derived values or direct function declarations. See macro-vocabulary-v2 §5.',
    '[v2 spec](docs/superpowers/specs/2026-05-05-spec-macro-vocabulary-v2.md)',
  ].join('\n'),

  $resource: [
    '**aihu macro: `$resource`**',
    '',
    'Declares an async data resource signal.',
    '',
    'Compiles to:',
    '```typescript',
    'const name = createResource(() => expr)',
    '```',
    '',
    '[v2 spec](docs/superpowers/specs/2026-05-05-spec-macro-vocabulary-v2.md)',
  ].join('\n'),

  $effect: [
    '**aihu macro: `$effect`**',
    '',
    'Declares a reactive side effect.',
    '',
    'Compiles to:',
    '```typescript',
    'effect(() => { body })',
    '```',
    '',
    '[v2 spec](docs/superpowers/specs/2026-05-05-spec-macro-vocabulary-v2.md)',
  ].join('\n'),

  $lifecycle: [
    '**aihu macro: `$lifecycle`**',
    '',
    'Declares lifecycle hooks (mount, dispose, adopt, attributeChange).',
    '',
    'Compiles to:',
    '```typescript',
    'onMount(() => { ... })',
    'onCleanup(() => { ... })',
    '```',
    '',
    '[v2 spec](docs/superpowers/specs/2026-05-05-spec-macro-vocabulary-v2.md)',
  ].join('\n'),

  $if: [
    '**aihu template directive: `if={…}`** (chain with `elseif={…}` / `else` siblings)',
    '',
    'Conditional rendering.',
    '',
    'Compiles to:',
    '```typescript',
    'branch(condition, () => trueBranch)',
    '```',
    '',
    '[Template spec](docs/superpowers/specs/2026-05-05-spec-macro-vocabulary-v2.md)',
  ].join('\n'),

  $each: [
    '**aihu template directive: `each={item, i of items}`** (pair with `key={…}`; `empty` sibling for the empty state)',
    '',
    'List rendering.',
    '',
    'Compiles to:',
    '```typescript',
    'branch.each(items, (item) => leaf(...))',
    '```',
    '',
    '[Template spec](docs/superpowers/specs/2026-05-05-spec-macro-vocabulary-v2.md)',
  ].join('\n'),

  $html: [
    '**aihu template directive: `html={expr}`**',
    '',
    'Raw HTML injection. Use with trusted content only.',
    '',
    'Compiles to:',
    '```typescript',
    'leaf({ nodeValue: htmlContent })',
    '```',
    '',
    '[Template spec](docs/superpowers/specs/2026-05-05-spec-macro-vocabulary-v2.md)',
  ].join('\n'),

  $show: [
    '**aihu template directive: `show={…}`**',
    '',
    'Toggles element visibility without removing it from the DOM.',
    '',
    'Compiles to:',
    '```typescript',
    'el.style.display = condition ? "" : "none"',
    '```',
    '',
    '[Template spec](docs/superpowers/specs/2026-05-05-spec-macro-vocabulary-v2.md)',
  ].join('\n'),

  $on: [
    '**aihu template directive: `on:<event>={handler}`** (modifiers: `.prevent`, `.stop`, `.self`, `.once`)',
    '',
    'Attaches an event listener to a DOM element.',
    '',
    'Compiles to:',
    '```typescript',
    'element.addEventListener("event", handler)',
    '```',
    '',
    'Usage: `on:click={handler}`',
    '',
    '[Template spec](docs/superpowers/specs/2026-05-05-spec-macro-vocabulary-v2.md)',
  ].join('\n'),

  $bind: [
    '**aihu template directive: `bind:<prop>={signal}`**',
    '',
    'Two-way binding between a signal and an element attribute.',
    '',
    'Compiles to:',
    '```typescript',
    '// two-way binding via signal setter',
    'el.addEventListener("input", e => setSignal(e.target.value))',
    '```',
    '',
    'Usage: `bind:value={signal}`',
    '',
    '[Template spec](docs/superpowers/specs/2026-05-05-spec-macro-vocabulary-v2.md)',
  ].join('\n'),

  $emit: [
    '**aihu macro: `$emit`**',
    '',
    'Declares and dispatches typed custom events.',
    '',
    'Compiles to:',
    '```typescript',
    'this.dispatchEvent(new CustomEvent(name, { detail: payload }))',
    '```',
    '',
    'Usage: `$emit.name(payload)`',
    '',
    '[Template syntax v2 spec](docs/superpowers/specs/2026-05-06-spec-template-syntax-v2.md)',
  ].join('\n'),

  // ---------------------------------------------------------------------------
  // @state macros (new in round-0 per director-note §3.1)
  // ---------------------------------------------------------------------------

  // Source: 2026-05-02-spec-macro-vocabulary.md §2.6 lines 385-431
  $watch: [
    '**aihu macro: `$watch`**',
    '',
    'Imperative subscription to a value with access to prev and next values.',
    '',
    'Compiles to:',
    '```typescript',
    'let _prev = source',
    'effect(() => { const _next = source; if (_next !== _prev) { callback(_next, _prev); _prev = _next } })',
    '```',
    '',
    'Does NOT run on mount. Callback runs in an untracked context.',
    '',
    '[v1 spec §2.6](docs/superpowers/specs/2026-05-02-spec-macro-vocabulary.md)',
  ].join('\n'),

  // Source: 2026-05-02-spec-macro-vocabulary.md §2.9 lines 537-575 (@state)
  //   plus 2026-05-05-spec-macro-vocabulary-v2.md §4 lines 208-216 (C440 — agent-side $expose removed)
  $expose: [
    '**aihu macro: `$expose`**',
    '',
    'Marks `@state` declarations as accessible from a parent via template ref',
    '(equivalent to Vue `defineExpose`). By default `@state` entries are private.',
    '',
    'Compiles to:',
    '```typescript',
    'defineExpose({ name1, name2, ... })',
    '```',
    '',
    'Usage: `$expose name1, name2` or `$expose { name1, name2 }`',
    '',
    '**Deprecated in v2 (C440)** when used INSIDE `@agent`. The agent-side',
    '`$expose` (and `$expose.write`) are removed; replace with per-name',
    '`expose: { read: true }` or `expose: { read: true, write: true }` on the',
    'corresponding `@state` collection entry.',
    '',
    '[v1 spec §2.9](docs/superpowers/specs/2026-05-02-spec-macro-vocabulary.md)',
    '[v2 spec §4 (C440)](docs/superpowers/specs/2026-05-05-spec-macro-vocabulary-v2.md)',
  ].join('\n'),

  // Source: 2026-05-02-spec-macro-vocabulary.md §2.10 lines 577-615
  $shared: [
    '**aihu macro: `$shared`**',
    '',
    'SSR-safe global state shared across components; survives hydration.',
    '',
    'Compiles to:',
    '```typescript',
    "const name = useSharedState(key ?? 'auto-' + componentId + '-' + name, defaultValue)",
    '```',
    '',
    'Usage: `$shared name: type = defaultValue` or `$shared(key) name: type = default`',
    '',
    '[v1 spec §2.10](docs/superpowers/specs/2026-05-02-spec-macro-vocabulary.md)',
  ].join('\n'),

  // Source: 2026-05-02-spec-macro-vocabulary.md §2.11 lines 617-653
  $cookie: [
    '**aihu macro: `$cookie`**',
    '',
    'Reactive binding to a cookie value (SSR-safe).',
    '',
    'Compiles to:',
    '```typescript',
    "const name = useCookie<type>('name', { defaultValue, ...options })",
    '```',
    '',
    'Usage: `$cookie name: string = ""` or `$cookie({ maxAge: 86400 }) sessionId: string = ""`',
    '',
    '[v1 spec §2.11](docs/superpowers/specs/2026-05-02-spec-macro-vocabulary.md)',
  ].join('\n'),

  // Source: 2026-05-02-spec-macro-vocabulary.md §2.13 lines 703-749
  $meta: [
    '**aihu macro: `$meta`**',
    '',
    'Declares page metadata (title, description, OG tags).',
    '',
    'Compiles to:',
    '```typescript',
    'useHead({ title, description, og })',
    '// or dynamic: useHead(() => ({ title: dynamicTitle }))',
    '```',
    '',
    'Multiple `$meta` blocks merge (later overrides earlier). SSR-emitted into `<head>`.',
    '',
    '[v1 spec §2.13](docs/superpowers/specs/2026-05-02-spec-macro-vocabulary.md)',
  ].join('\n'),

  // ---------------------------------------------------------------------------
  // @template macros (new in round-0 per director-note §3.1)
  // ---------------------------------------------------------------------------

  // Source: 2026-05-02-spec-macro-vocabulary.md §3.6 lines 947-976
  $key: [
    '**aihu template directive: `key={…}`**',
    '',
    'Stable identity for list reconciliation inside `$each`.',
    '',
    'Compiles to:',
    '```typescript',
    'createEachBoundary({ key: (item) => keyExpr, ... })',
    '```',
    '',
    'Usage: `<li each={u of users} key={u.id}>{u.name}</li>`',
    '',
    '[v1 spec §3.6](docs/superpowers/specs/2026-05-02-spec-macro-vocabulary.md)',
  ].join('\n'),

  // Source: 2026-05-02-spec-macro-vocabulary.md §3.8 lines 1006-1028
  $raw: [
    '**aihu template directive: `raw`**',
    '',
    'Skip compilation of the element subtree. Boolean-only (no value).',
    '',
    'Interpolations like `{x}`, macros, and bindings inside are NOT processed —',
    'the subtree renders as static content.',
    '',
    "Usage: `<pre raw>{this looks like interpolation but isn't}</pre>`",
    '',
    '[v1 spec §3.8](docs/superpowers/specs/2026-05-02-spec-macro-vocabulary.md)',
  ].join('\n'),

  // Source: 2026-05-02-spec-macro-vocabulary.md §3.9 lines 1030-1061
  $once: [
    '**aihu template directive: `once`**',
    '',
    'Render subtree once at mount; never update. Boolean-only.',
    '',
    'Compiles to:',
    '```typescript',
    'createOnceBoundary({ build: () => subtree, parent: parentEl })',
    '```',
    '',
    'No reactive subscriptions inside. Subtree never re-renders.',
    '',
    '[v1 spec §3.9](docs/superpowers/specs/2026-05-02-spec-macro-vocabulary.md)',
  ].join('\n'),

  // Source: 2026-05-02-spec-macro-vocabulary.md §3.10 lines 1063-1097
  $memo: [
    '**aihu template directive: `memo={deps}`**',
    '',
    'Memoize an element subtree by explicit dependencies (curly form only).',
    '',
    'Compiles to:',
    '```typescript',
    'createMemoBoundary({ deps: () => [dep1, dep2], build: () => subtree })',
    '```',
    '',
    'Usage: `<ExpensiveChart memo={[data, settings]} />`',
    '',
    '[v1 spec §3.10](docs/superpowers/specs/2026-05-02-spec-macro-vocabulary.md)',
  ].join('\n'),

  // Source: 2026-05-02-spec-macro-vocabulary.md §3.12 lines 1141-1194
  '<slot>': [
    '**aihu template element: `<slot>`**',
    '',
    'Children passthrough or named slot.',
    '',
    'Compiles to:',
    '```typescript',
    "const slotN = useSlot('name', defaultContent)",
    'slotN.render({ exposed: { user, index } })',
    '```',
    '',
    'Usage: `<slot />`, `<slot name="header">default</slot>`,',
    '`<slot name="row" expose="user, index" />`',
    '',
    '[v1 spec §3.12](docs/superpowers/specs/2026-05-02-spec-macro-vocabulary.md)',
  ].join('\n'),

  // Source: 2026-05-02-spec-macro-vocabulary.md §3.13 lines 1196-1244
  '<suspense>': [
    '**aihu template element: `<suspense>`**',
    '',
    'Loading boundary for async data (`$resource`).',
    '',
    'Compiles to:',
    '```typescript',
    'createSuspenseBoundary({ fallback, fallbackProps, build, parent })',
    '```',
    '',
    'While any tracked resource is loading, renders `fallback`. Once all ready,',
    'swaps to actual content. Streaming SSR-compatible.',
    '',
    '[v1 spec §3.13](docs/superpowers/specs/2026-05-02-spec-macro-vocabulary.md)',
  ].join('\n'),

  // Source: 2026-05-02-spec-macro-vocabulary.md §3.14 lines 1246-1290
  '<shield>': [
    '**aihu template element: `<shield>`**',
    '',
    'Error boundary.',
    '',
    'Compiles to:',
    '```typescript',
    'createShieldBoundary({ fallback, onError, build, parent })',
    '```',
    '',
    'Catches errors during render, in effects, and unhandled `$resource` errors.',
    'Slot context: `shield.error`, `shield.retry`.',
    '',
    '[v1 spec §3.14](docs/superpowers/specs/2026-05-02-spec-macro-vocabulary.md)',
  ].join('\n'),

  // Source: 2026-05-02-spec-macro-vocabulary.md §3.15 lines 1292-1349
  '<guard>': [
    '**aihu template element: `<guard>`**',
    '',
    'Access-control boundary (scope, permissions, rate limit).',
    '',
    'Compiles to:',
    '```typescript',
    'createGuardBoundary({ scope, permissions, rateLimit, fallback, redirect, onDeny, build })',
    '```',
    '',
    'Usage: `<guard scope="authenticated" fallback="LoginPrompt"><Page /></guard>`',
    'Slot context: `guard.user`, `guard.reason`, `guard.path`.',
    '',
    '[v1 spec §3.15](docs/superpowers/specs/2026-05-02-spec-macro-vocabulary.md)',
  ].join('\n'),

  // Source: 2026-05-02-spec-macro-vocabulary.md §3.16 lines 1351-1397
  '<warp>': [
    '**aihu template element: `<warp>`**',
    '',
    'Render content into a different DOM location (portal).',
    '',
    'Compiles to:',
    '```typescript',
    'createWarpBoundary({ target: () => to, condition: () => $if, build })',
    '```',
    '',
    'Usage: `<warp to="#modal-root"><Dialog /></warp>`',
    '',
    '[v1 spec §3.16](docs/superpowers/specs/2026-05-02-spec-macro-vocabulary.md)',
  ].join('\n'),

  // ---------------------------------------------------------------------------
  // @style macros (new in round-0 per director-note §3.1)
  // ---------------------------------------------------------------------------

  // Source: 2026-05-02-spec-macro-vocabulary.md §4.1 lines 1405-1443
  $reactive: [
    '**aihu @style macro: `$reactive`**',
    '',
    'Bind a CSS property to a reactive expression via a CSS custom property.',
    '',
    'Compiles to:',
    '```typescript',
    "effect(() => rootEl.style.setProperty('--reactive-N', String(expr)))",
    '/* CSS: .aihu-component { property: var(--reactive-N) } */',
    '```',
    '',
    'Usage: `h1 { color: $reactive(error ? "red" : "black") }`',
    '',
    '[v1 spec §4.1](docs/superpowers/specs/2026-05-02-spec-macro-vocabulary.md)',
  ].join('\n'),

  // Source: style_macros.rs StyleMacro::Container (RFC-A5-022)
  $container: [
    '**aihu @style macro: `$container`**',
    '',
    'Container query block (RFC-A5-022), optionally named.',
    '',
    'Compiles to:',
    '```css',
    '@container name (query) { rules }',
    '```',
    '',
    'Usage: `$container(sidebar, min-width: 300px) { .label { font-size: 1.2rem } }`',
    'Usage (unnamed): `$container(min-width: 300px) { .label { font-size: 1.2rem } }`',
  ].join('\n'),

  // Source: style_macros.rs StyleMacro::Prefers (RFC-A5-023)
  $prefers: [
    '**aihu @style macro: `$prefers`**',
    '',
    'Media block for a user preference feature (RFC-A5-023). Maps a bare',
    'feature name to its "opted-in" media-feature value.',
    '',
    'Compiles to:',
    '```css',
    '@media (prefers-feature: value) { rules }',
    '```',
    '',
    'Supported features: `reduced-motion`, `reduced-transparency`,',
    '`reduced-data` (→ `reduce`), `contrast` (→ `more`), `color-scheme` (→ `dark`).',
    'Use `$media` directly for any other media feature.',
    '',
    'Usage: `$prefers(reduced-motion) { .anim { transition: none } }`',
  ].join('\n'),

  // Source: 2026-05-02-spec-macro-vocabulary.md §4.3 lines 1481-1516
  $global: [
    '**aihu @style macro: `$global`**',
    '',
    'Emit unscoped CSS rules (escape from component scoping).',
    '',
    'Usage:',
    '```',
    '@style {',
    '  $global { body { margin: 0 } * { box-sizing: border-box } }',
    '}',
    '```',
    '',
    '`$reactive` inside `$global` targets `document.documentElement`.',
    '',
    '[v1 spec §4.3](docs/superpowers/specs/2026-05-02-spec-macro-vocabulary.md)',
  ].join('\n'),

  // Source: 2026-05-02-spec-macro-vocabulary.md §4.4 lines 1518-1556
  $media: [
    '**aihu @style macro: `$media`**',
    '',
    'CSS media-query block.',
    '',
    'Compiles to:',
    '```css',
    '@media (query) { rules }',
    '```',
    '',
    'Usage: `$media(min-width: 768px) { h1 { font-size: 2rem } }`',
    '',
    '[v1 spec §4.4](docs/superpowers/specs/2026-05-02-spec-macro-vocabulary.md)',
  ].join('\n'),

  // Source: 2026-05-02-spec-macro-vocabulary.md §4.5 lines 1558-1604
  $when: [
    '**aihu @style macro: `$when`**',
    '',
    'Apply styles conditionally based on a signal value.',
    '',
    'Compiles to:',
    '```typescript',
    'effect(() => { rootEl.dataset.whenN = String(condition) })',
    '/* CSS: .aihu-component[data-when-N="true"] { rules } */',
    '```',
    '',
    'Usage: `$when(loading) { root { opacity: 0.5 } }`',
    '',
    '[v1 spec §4.5](docs/superpowers/specs/2026-05-02-spec-macro-vocabulary.md)',
  ].join('\n'),

  // ---------------------------------------------------------------------------
  // @agent macros (new in round-0 per director-note §3.1)
  // ---------------------------------------------------------------------------

  // Source: 2026-05-02-spec-macro-vocabulary.md §5.4 lines 1730-1766
  //   plus 2026-05-05-spec-macro-vocabulary-v2.md §4 lines 199-203 (retained in v2)
  $scope: [
    '**aihu @agent macro: `$scope`**',
    '',
    'Declares the auth scope required to access this component agent surface.',
    '',
    'Compiles to scope metadata attached to all MCP resources/tools registered',
    'for this component. Every agent request is checked against the scope.',
    '',
    'Usage: `$scope authenticated`',
    '',
    '[v2 spec §4](docs/superpowers/specs/2026-05-05-spec-macro-vocabulary-v2.md)',
  ].join('\n'),

  // Source: 2026-05-02-spec-macro-vocabulary.md §5.5 lines 1768-1807
  //   plus 2026-05-05-spec-macro-vocabulary-v2.md §4 lines 199-203 (retained in v2)
  '$rate-limit': [
    '**aihu @agent macro: `$rate-limit`**',
    '',
    'Override the default rate limit for this component agent surface.',
    '',
    'Compiles to rate-limit metadata attached to MCP tools. Per-component limit',
    'composes with scope-level limits (tighter wins). Counted per user per component.',
    '',
    'Usage: `$rate-limit "100/min"`, `$rate-limit "unlimited"`',
    '',
    '[v2 spec §4](docs/superpowers/specs/2026-05-05-spec-macro-vocabulary-v2.md)',
  ].join('\n'),

  // Source: 2026-05-02-spec-macro-vocabulary.md §5.6 lines 1809-1840 (v1 form)
  //   plus 2026-05-05-spec-macro-vocabulary-v2.md §4 lines 208-216 (C440 — removed in v2)
  $describe: [
    '**aihu @agent macro: `$describe`**',
    '',
    '**Deprecated in v2 (C440)**. Replace with per-name `describe: "<text>"`',
    'on the corresponding `@state` collection entry.',
    '',
    'v1 form (for migration reference only):',
    '```',
    '$describe name "description string"',
    '$describe { name1: "...", name2: "..." }',
    '```',
    '',
    'v2 replacement:',
    '```',
    '@state {',
    '  $prop: {',
    "    name: { default: undefined, describe: 'description string' },",
    '  }',
    '}',
    '```',
    '',
    '[v1 spec §5.6](docs/superpowers/specs/2026-05-02-spec-macro-vocabulary.md)',
    '[v2 spec §4 (C440)](docs/superpowers/specs/2026-05-05-spec-macro-vocabulary-v2.md)',
  ].join('\n'),
}

export function getBlockContext(
  lines: string[],
  lineIndex: number,
): 'state' | 'template' | 'style' | 'agent' | 'route' | 'unknown' {
  for (let i = lineIndex; i >= 0; i--) {
    const trimmed = lines[i]!.trimStart()
    if (/^@state\s*\{/.test(trimmed)) return 'state'
    if (/^@template\s*\{/.test(trimmed)) return 'template'
    if (/^@style\s*\{/.test(trimmed)) return 'style'
    if (/^@agent\s*\{/.test(trimmed)) return 'agent'
    if (/^@route\s*\{/.test(trimmed)) return 'route'
  }
  return 'unknown'
}

export function getMacroAtPosition(lineText: string, character: number): string | null {
  let m: RegExpExecArray | null
  // Framework-element forms (grammar v2 naked words): <slot>, <suspense>,
  // <shield>, <guard>, <warp>. Returns the bracketed form (e.g. `<slot>`) so
  // HOVER_TABLE entries keyed with the angle-bracketed form resolve correctly.
  const elementRe = /<(slot|suspense|shield|guard|warp)\b/g
  while ((m = elementRe.exec(lineText)) !== null) {
    if (character >= m.index && character <= m.index + m[0].length) {
      return `<${m[1]!}>`
    }
  }
  // Colon directives (grammar v2): `on:click` (with dotted modifiers),
  // `bind:value`. Returns the `$`-keyed family entry (`$on`, `$bind`) — the
  // HOVER_TABLE keys are stable identifiers, not surface syntax.
  const colonRe = /(?<![\w$:])(on|bind):[A-Za-z_$][\w$-]*(?:\.[a-z]+)*/g
  while ((m = colonRe.exec(lineText)) !== null) {
    if (character >= m.index && character <= m.index + m[0].length) {
      return `$${m[1]!}`
    }
  }
  // Naked template keywords with braced values (grammar v2): `if={…}`,
  // `each={…}`, `key={…}`, `show={…}`, `html={…}`, `memo={…}`. The `={`
  // lookahead keeps prose words inert. `elseif` folds into the `$if` entry.
  const nakedExprRe = /(?<=[\s<])(if|elseif|each|key|show|html|memo)(?=\s*=\{)/g
  while ((m = nakedExprRe.exec(lineText)) !== null) {
    if (character >= m.index && character <= m.index + m[0].length) {
      const word = m[1]!
      return word === 'elseif' ? '$if' : `$${word}`
    }
  }
  // Naked bare template words: `once`, `raw` (attribute position only).
  const nakedBareRe = /(?<=\s)(once|raw)(?=[\s/>])/g
  while ((m = nakedBareRe.exec(lineText)) !== null) {
    if (character >= m.index && character <= m.index + m[0].length) {
      return `$${m[1]!}`
    }
  }
  // Namespaced/dotted `@state` forms. Returns the bare prefix (`$effect`,
  // `$lifecycle`, `$expose`, `$emit`) for dotted/colon-suffixed forms; the
  // bare HOVER_TABLE entries cover the family by design (dotted-form folding
  // per director-note §3.8).
  const namespacedRe = /\$(effect|lifecycle|expose|emit)(?:[.:][A-Za-z_$][\w$]*)?\b/g
  while ((m = namespacedRe.exec(lineText)) !== null) {
    if (character >= m.index && character <= m.index + m[0].length) {
      return `$${m[1]!}`
    }
  }
  // Bare-form `@state`/`@style`/`@agent` macros (still `$`-prefixed — the `$`
  // retreat applies to @template only). `rate-limit` includes a hyphen — the
  // regex captures it as a single token; we still return `$rate-limit`.
  const bareRe =
    /\$(prop|computed|action|resource|effect|lifecycle|emit|watch|shared|cookie|server|meta|reactive|container|prefers|global|media|when|scope|rate-limit|describe)\b/g
  while ((m = bareRe.exec(lineText)) !== null) {
    if (character >= m.index && character <= m.index + m[0].length) {
      return `$${m[1]!}`
    }
  }
  // A bare `@aihu/use` composable call — `useMouse()`, `useToggle()`, etc.
  // (FEL-342). Checked last: every other form above is a `$`/`<`/`:`-marked
  // aihu keyword, so a plain identifier call can only be this.
  const composableRe = /\b[\w$]+(?=\()/g
  while ((m = composableRe.exec(lineText)) !== null) {
    if (
      COMPOSABLE_BY_NAME.has(m[0]) &&
      character >= m.index &&
      character <= m.index + m[0].length
    ) {
      return m[0]
    }
  }
  return null
}

export function getHoverContent(macro: string): string | null {
  return HOVER_TABLE[macro] ?? composableHover(macro)
}
