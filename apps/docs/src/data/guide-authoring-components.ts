/**
 * Authoring Components guide body. Adapted from the real
 * apps/docs/src/content/docs/guides/authoring-components.md. That source is
 * almost entirely the retired `@state` v2 collection-form macro dialect
 * (`$prop: {...}`, `$computed: {...}`, `$action: {...}`, `$effect: {...}`,
 * `$resource: {...}`, `$lifecycle: {...}`) — every code sample using it is
 * rewritten below into the CURRENT prefix-less wrapper-intrinsic dialect
 * (`state()`, `prop()`, `derived()`, `action()`, `resource()`, `effect()`,
 * `onMount()`/`onDispose()`), confirmed against
 * the standalone compiler state-wrapper parser and the state-model
 * fixtures (weather-new.aihu, counter-new.aihu). Notably `type:` is no
 * longer a `prop` config key — the type now comes from `prop<T>(...)`'s
 * generic — and `expose` is a string (`'read'` / `'read write'`), not an
 * object. The `@template` section in the source doc already documented the
 * current prefix-less template grammar (it carries over unchanged aside
 * from a light correction to its "$ retreats to @state macros only" claim,
 * since @state dropped `$` too); `@style`'s `$reactive`/`$media`/`$global`
 * and `@agent`'s `$scope`/`$rate-limit` were never part of the retired
 * dialect and are untouched. Fenced code uses the `~~~` delimiter and
 * inline code uses <code> tags (both valid markdown) so the source carries
 * no backticks — that keeps it a plain template literal and avoids
 * escaped-backtick corruption. Literal tag-name mentions in prose (e.g. a
 * bare "<slot>") are HTML-entity-escaped as &lt;slot&gt; so the browser
 * doesn't parse them as real elements.
 */
export const AUTHORING_COMPONENTS = `# Authoring Components

A <code>.aihu</code> Single File Component (SFC) is composed of named blocks. Each block uses the <code>@blockname { ... }</code> syntax.

## @state block

The <code>@state</code> block declares the reactive contract of the component. It is ordinary TypeScript: each entry — a prop, a derived value, an action, an effect, a resource, or a lifecycle hook — is its own <code>let</code>/<code>const</code> declaration that calls the matching wrapper intrinsic (<code>state</code>, <code>prop</code>, <code>derived</code>, <code>action</code>, <code>resource</code>, <code>effect</code>, <code>onMount</code>/<code>onDispose</code>). One signature applies everywhere: the optional config object comes first, the running code (value thunk or handler) comes last — <code>wrapper(config?, valueOrFn)</code>.

### State wrapper intrinsics

**<code>prop()</code>** — a public, reactive property settable from HTML attributes. Always takes a config object (there is no bare <code>prop(default)</code> shorthand).

~~~aihu
let name = prop<TypeAnnotation>({
  default: value,
  describe: 'human-readable description',  // optional
  expose: 'read',                          // optional: 'read' | 'write' | 'read write'
  attribute: true,                         // optional
  reflect: false,                          // optional
  required: false,                         // optional
})
~~~

Use <code>expose: 'read'</code> to expose the prop value to agents. Add <code>'write'</code> (<code>expose: 'read write'</code>) to also allow agents to set it. The generic <code>&lt;TypeAnnotation&gt;</code> carries the type — there is no separate <code>type:</code> config key.

---

**<code>derived()</code>** — a derived, read-only signal. Re-evaluates when dependencies change. Supports bare (no metadata) or wrapped (config object first, thunk second) form.

~~~aihu
// bare — value-thunk, no metadata
const name = derived(() => expr)
// wrapped — add describe/expose, config comes first
const namedWithMeta = derived({ describe: '...', expose: 'read' }, () => expr)
~~~

There is no <code>type:</code> config key for <code>derived</code>. Annotate the thunk's own return type inline when needed: <code>derived((): T[] => [])</code>.

---

**<code>action()</code>** — a named method on the component. Bare (no metadata) or wrapped, config first.

~~~aihu
// bare handler
const doSomething = action((args) => { /* body */ })
// wrapped — add describe/expose to surface to agents
const doSomethingExposed = action(
  { describe: 'human-readable description', expose: 'read write' },
  (args) => { /* body */ },
)
~~~

Writes to props or state from inside an action are plain assignment (<code>count++</code>, <code>count = 0</code>) — there is no setter-function call to make.

---

**<code>effect()</code>** — runs a side effect when tracked signals change. Two valid forms:

~~~aihu
// auto-tracked — dependencies inferred from what the function reads
effect(() => { /* side effect body */ })
// explicit deps — config object's "on:" lists what to watch
effect({ on: [data] }, () => { /* side effect body */ })
~~~

Call <code>effect()</code> as many times as needed in one <code>@state</code> block — each call stands on its own, so there is no name to collide on (unlike the retired named-collection form).

---

**<code>resource()</code>** — binds an async fetcher to a reactive signal. Returns a 3-state loader: <code>{ pending, value, error }</code>. Bare or wrapped.

~~~aihu
// bare fetcher-thunk
const data = resource(() => fetchUsers())
// wrapped — add describe/expose
const user = resource({ describe: '...', expose: 'read' }, () => fetchUser(userId))
~~~

---

**<code>onMount()</code> / <code>onDispose()</code>** — lifecycle hooks. Plain statement-position calls; there is no collection object to assemble.

~~~aihu
onMount(() => { /* runs after first DOM mount */ })
onDispose(() => { /* runs on unmount */ })
~~~

There are also <code>onAdopt</code> and <code>onAttributeChange</code> lifecycle hooks, not shown above.

### Complete example

~~~aihu
@state {
  let count = prop({ default: 0, describe: 'Current counter value', expose: 'read' })

  const doubled = derived(() => count * 2)
  const isHigh = derived(
    { describe: 'True when count exceeds 100', expose: 'read' },
    () => count > 100,
  )

  const increment = action(
    { describe: 'Add 1 to the counter', expose: 'read write' },
    () => { count++ },
  )
  const reset = action(() => { count = 0 })

  onMount(() => console.log('mounted'))
  onDispose(() => console.log('unmounted'))

  effect(() => { document.title = 'Count: ' + count })
}
~~~

### <code>describe</code> and <code>expose</code> — agent visibility

<code>describe</code> and <code>expose</code> are config keys inside the optional config object passed as the first argument to <code>prop()</code>, <code>derived()</code>, <code>action()</code>, and <code>resource()</code>. They replace the old <code>@agent</code>-level <code>$expose</code> and <code>$describe</code> macros.

- <code>describe: 'text'</code> — makes the entry visible in the agent's capability description.
- <code>expose: 'read'</code> — the agent can read this value.
- <code>expose: 'read write'</code> — the agent can read and write this value (props, actions).

## @template block

The <code>@template</code> block defines the DOM output using aihu's template DSL.

> **Tag naming.** Components compile to native custom elements, so every component tag must normalize to a hyphenated name: multi-word PascalCase kebab-cases automatically (<code>&lt;UserCard&gt;</code> → <code>user-card</code>), hyphenated tags pass through lowercased, and **referencing a single-word component tag is a hard compile error (C450)** (<code>&lt;Comment&gt;</code>) — use a hyphenated tag (e.g. <code>&lt;x-comment&gt;</code>) or an explicit hyphenated <code>@meta name</code>. Full rules and examples: see the Composition guide's "Tag naming" section.

> **The prefix-less template.** One rule: naked keywords + naked HTML attributes + naked framework vocabulary. <code>{expr}</code> braces mean expression; quoted strings mean static; <code>$</code> is retired from both <code>@template</code> and <code>@state</code> — the only surviving <code>$</code>-prefixed forms anywhere in the SFC are the two cross-cutting <code>@agent</code> declarations, <code>$scope</code> and <code>$rate-limit</code>. Reactive attribute bindings are plain braces (<code>class={…}</code>, <code>href={…}</code>, <code>disabled={loading}</code>); events and two-way binds are colon directives (<code>on:click={…}</code>, <code>bind:value={…}</code>); control flow attaches to the element it governs (<code>if={…}</code>, <code>each={item of items}</code>). Older <code>$</code>-prefixed attribute forms and <code>&lt;$…&gt;</code> macro elements from pre-redesign sources are compile errors under this grammar. Run <code>npx aihu migrate &lt;file&gt;</code> to mechanically rewrite older sources.

### Text interpolation

- <code>{expr}</code> — reactive text node. Writes through <code>nodeValue</code>, which updates the text node in place instead of reparsing the element's children.

### Event handlers

- <code>on:click={handlerName}</code> — attach an event listener (quoted identifier reference).
- <code>on:click={() => expr}</code> — attach an inline handler (curly expression).

A colon separates the directive from the event name: <code>on:&lt;event&gt;</code>. Dotted modifiers compose behavior: <code>on:click.prevent</code>, <code>on:submit.once</code> (supported: <code>.prevent</code>, <code>.stop</code>, <code>.self</code>, <code>.once</code>).

### Two-way binding

- <code>bind:value={signalName}</code> — two-way bind a writable signal to a form element. The name after the colon is the bound property: <code>bind:value</code>, <code>bind:checked</code>, etc.

### Conditional rendering

- <code>if={cond}</code> — remove/insert the element based on a boolean signal or expression.
- <code>elseif={cond}</code> / <code>else</code> — chain onto the **immediately preceding** <code>if</code>/<code>elseif</code> element sibling (only whitespace/comments may sit between).
- <code>show={cond}</code> — toggle visibility without removing from DOM.
- Wrap multi-element branches in <code>&lt;group&gt;</code> — the invisible fragment carrier.

### List rendering

- <code>each={item, i of items}</code> — render a list, item-first (<code>&lt;binder&gt; [, &lt;index&gt;] of &lt;list-expr&gt;</code>). Destructuring binders work: <code>each={[k, v] of entries}</code>. Pair with <code>key={…}</code> for stable reconciliation, and put <code>empty</code> on the immediately following sibling for the empty state:

~~~aihu
<li each={todo of todos} key={todo.id}>{todo.text}</li>
~~~

### HTML output

- <code>html={expr}</code> — render raw HTML from an expression (trusted content only). Under <code>output: 'static'</code> this is prerendered too: the value is interpolated unescaped into the HTML you serve, not just injected into the DOM after load. Treat it as <code>innerHTML</code> at build time — never point it at untrusted or remote content.

### Memoization and DOM stability

- <code>key={expr}</code> — key for list reconciliation (pairs with <code>each</code>).
- <code>memo={expr}</code> — memoize a subtree; only re-renders when expr changes.
- <code>once</code> — boolean attribute; renders once and never re-renders.
- <code>raw</code> — boolean attribute; verbatim element, no macro processing.

### Class bindings

- <code>class={cond ? 'active' : ''}</code> — reactive whole-string class expression.
- <code>class:active={cond}</code> — per-class toggle; composes with a static <code>class="…"</code> base list (the toggle is authoritative when both address the same name).

### Special elements

**<code>&lt;slot&gt;</code>** — inserts slotted children provided by the parent:

~~~aihu
<slot name="header" />
~~~

Use <code>expose</code> to pass context to slot consumers:

~~~aihu
<!-- In UserList.aihu -->
<slot name="row" expose="user, index">
  <!-- default content -->
</slot>
~~~

**<code>&lt;suspense&gt;</code>** — wraps an async resource with a loading fallback:

~~~aihu
<!-- Simple: fallback attribute (component name) -->
<suspense fallback="Skeleton">
  <UserProfile />
</suspense>

<!-- Context-aware: slot form -->
<suspense>
  <UserProfile />
  <slot name="fallback">
    {loadAttempts > 3 ? <SlowConnection /> : <Spinner />}
  </slot>
</suspense>
~~~

The <code>fallback</code> attribute takes a component name (quoted string); <code>fallbackProps</code> may be added for static props. <code>fallback</code> attribute and <code>&lt;slot name="fallback"&gt;</code> are mutually exclusive.

**<code>&lt;shield&gt;</code>** — isolates a subtree behind an error boundary:

~~~aihu
<shield>
  <UserProfile />
  <slot name="fallback">
    <ErrorPage error="shield.error" retry="shield.retry" />
  </slot>
</shield>
~~~

Exposes <code>shield.error</code> (Error) and <code>shield.retry</code> (function) to the fallback slot.

**<code>&lt;guard&gt;</code>** — conditionally renders based on an auth scope:

~~~aihu
<guard scope="admin" fallback="UnauthorizedPage">
  <AdminPanel />
</guard>
~~~

Attributes: <code>scope</code> (scope-name), <code>permissions</code>, <code>rateLimit</code>, <code>fallback</code> (component-ref), <code>redirect</code> (path), <code>onDeny</code> (function-ref). Exposes <code>guard.user</code>, <code>guard.reason</code>, <code>guard.path</code> to the fallback slot.

**<code>&lt;warp&gt;</code>** — renders children into a portal target:

~~~aihu
<warp to="#modal-root">
  <div>Portal content</div>
</warp>
~~~

### Attribute value forms

Every attribute value must be in one of two forms — bare unquoted values are forbidden:

~~~aihu
✗ <button on:click=save>            ← parse error (bare value)
✓ <button on:click={save}>          ← handler reference
✓ <button on:click={() => save()}>  ← inline handler expression
~~~

Some attributes are boolean-only (present-or-absent): <code>once</code>, <code>raw</code>, <code>else</code>, <code>empty</code>, <code>disabled</code>, <code>required</code>, etc.

## @style block

The <code>@style</code> block defines component-scoped styles with reactive capabilities.

### <code>$reactive(signal)</code>

Binds a CSS custom property value to a signal. Updates reactively without JavaScript in the template:

~~~aihu
@style {
  $global {
    :root {
      --color-primary:    $reactive(primary);
      --color-on-primary: $reactive(onPrimary);
      --color-surface:    $reactive(surface);
    }
  }
  .host { color: $reactive(textColor); }
}
~~~

<code>$global { ... }</code> hoists styles out of the shadow root to the document root.

### <code>$media(query)</code>

A responsive breakpoint block. Compiles to a standard <code>@media</code> rule but participates in the reactive style system:

~~~aihu
@style {
  $media(max-width: 480px) {
    label { grid-template-columns: 1fr; }
  }
}
~~~

### Standard CSS

All standard CSS is valid inside <code>@style</code>. Styles are scoped to the component shadow root by default (unless <code>$global</code> is used).

## @agent block

The <code>@agent</code> block is a vestigial cross-cutting block. Per-name agent metadata (<code>describe</code>, <code>expose</code>) lives on <code>@state</code> wrapper calls, not here.

<code>@agent</code> now holds only two cross-cutting declarations:

~~~aihu
@agent {
  $scope "user:read"     // agent permission scope
  $rate-limit 100        // requests per minute
}
~~~

Both are optional. The entire block may be omitted. For full agent authoring details — tool exposure, MCP compliance, and the agent capability contract — see the Authoring Agents guide.

## Common diagnostics

The compiler enforces the grammar with named diagnostics. The hard errors <code>C304</code> (Vue-shape <code>:attr=</code>), <code>C305</code> (colon-form event/bind alias), <code>C306</code> (plain-curly attribute binding), and <code>C107</code> (HTML-tag SFC framing) are covered by the Grammar v2 callout under <code>@template</code>. Three more are easy to hit and worth calling out:

### C205 — reading a <code>prop</code> in a bare <code>@state</code> const

A plain <code>@state</code> <code>const</code>/<code>let</code> can be emitted before the prop binding, so reading a prop there risks a temporal-dead-zone (TDZ) throw at runtime; the compiler steers you to <code>derived()</code>, where the read happens lazily inside a thunk instead of eagerly at setup:

~~~aihu
// ✗ risks C205 — prop read in a plain const/let, no thunk to defer it
@state {
  let name = prop<string>({ default: 'world' })
  const greeting = 'Hello, ' + name + '!'
}

// ✓ read the prop inside derived()
@state {
  let name = prop<string>({ default: 'world' })
  const greeting = derived(() => 'Hello, ' + name + '!')
}
~~~

Beyond sidestepping the hazard, <code>derived()</code> is also what keeps <code>greeting</code> reactive — a bare <code>const</code> would only capture the prop's value once at setup, where <code>derived()</code> re-reads it whenever <code>name</code> changes.

### C204 — unknown @block

The only recognized top-level blocks are <code>@state</code>, <code>@template</code>, <code>@style</code>, <code>@agent</code>, <code>@route</code> (plus the deprecated <code>@layout</code> shorthand). Any other <code>@&lt;name&gt;</code> header is an unknown block (**C204**). The most common offender is a v0 <code>@props</code> block — the hint steers you to declare props via <code>prop()</code> inside <code>@state</code>:

~~~aihu
// ✗ C204 — there is no @props block
@props { name: { default: 'world' } }

// ✓ declare props via prop() inside @state
@state {
  let name = prop<string>({ default: 'world' })
}
~~~

### C450 — single-word component tag (custom elements need a hyphen)

A component tag (or a component's resolved name) that normalizes to a single hyphen-less word can never be a valid custom-element name, so the compiler rejects it with **C450**. <code>&lt;UserCard&gt;</code> kebab-cases fine (<code>user-card</code>), but <code>&lt;Comment&gt;</code> resolves to <code>comment</code> — no hyphen, hard error:

~~~aihu
// ✗ C450 — 'Comment' resolves to 'comment', which has no hyphen
<Comment item={c} />

// ✓ use a hyphenated tag (and file stem), or set a hyphenated @meta name
<x-comment item={c} />
~~~

See the Composition guide's "Tag naming" section for the full normalization table.

### W210 — <code>on:&lt;non-event&gt;</code> (use <code>html</code> for innerHTML)

<code>on:&lt;name&gt;</code> referencing anything that is not a real DOM event compiles to a dead <code>on&lt;name&gt;</code> handler that never fires; the compiler warns with **W210**. To set raw HTML reactively, use the <code>html</code> attribute, not an <code>on:</code> binding:

~~~aihu
// ✗ W210 — on:innerHTML is not a DOM event → dead handler
<div on:innerHTML={markup}></div>

// ✓ use the html attribute
<div html={markup}></div>
~~~

For the full diagnostic mapping, see the Migration guide.
`
