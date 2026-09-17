# @aihu/ui

> **Aihu** — agentic discovery and interaction, for human purpose.

aihu styled-recipe registry — copy-paste `.aihu` recipes distributed as source via `aihu add` (no runtime bundle).

<!-- BEGIN_HANDWRITTEN: prose -->
The **styled-recipe layer** on top of the headless [`@aihu/primitives`](../primitives)
and the [CSS engine](../css-engine). A recipe is an `.aihu` SFC with a `@meta`
variant declaration, a `@template` wiring `data-*` attributes, and a `@style`
block of `@apply` utilities resolved against the active style pack.

**`@aihu/ui` is source-distributed.** Its payload is the `registry/**` `.aihu`
recipe sources plus a generated `registry.json` index — NOT a bundled runtime
dependency. You install it as a devDependency and `aihu add <name>` copies the
recipe source into your project (you own the copy). Because nothing from this
package is bundled into your runtime *from the package*, it carries **no
`.size-limit.json` row** — your own build measures the copied recipes. See
[`.size-limit.README.md`](../../.size-limit.README.md).

Tooling that reads the catalog can import the stable TypeScript contract from
`@aihu/ui/registry`. The `./schema` export remains available as a compatibility
alias for existing in-repo consumers.

### Phase 1 recipes

| Recipe | Kind | Notes |
|---|---|---|
| `button` | styled | wraps a native `<button>`; variant + size matrix. No `$extends` — see below |
| `card` | styled | presentational; slotted header/body/footer |
| `badge` | styled | presentational; variant matrix |
| `separator` | styled | presentational; `orientation` + `role="separator"` |

### CSS attachment (R2): the compiler owns it

A recipe declares its appearance in `@style` and writes **no CSS-attachment
code at all**. The compiler emits, for every scoped component:

```js
const __style__ = new CSSStyleSheet()      // MODULE scope — constructed once
__style__.replaceSync(`…your @style block…`)

defineElement('aihu-card', defineComponent((ctx) => {
  (ctx.host as ShadowRoot).adoptedStyleSheets = [__style__]   // per instance
  …
}))
```

That already *is* the R2 contract — one shared, single-construction
Constructable StyleSheet, adopted into every instance's shadow root, never a
per-instance `<style>` element. Hand-rolling a second `static sheet =
new CSSStyleSheet()` inside `@state` adds nothing and cannot work: see
"Do NOT register the element yourself" below.

### Do NOT register the element yourself

The compiler registers the tag at **module scope**, before any instance
exists. A `@state` block runs in the component's *setup* body, which the
runtime only calls when an element **upgrades** — strictly after registration.
So this, which four recipes shipped with, is dead code in every browser:

```js
@state {
  // ✗ NEVER runs: customElements.get('aihu-thing') is already truthy here,
  //   because defineElement('aihu-thing', …) ran at module scope.
  if (!customElements.get('aihu-thing')) customElements.define('aihu-thing', AihuThing)
}
```

To give the host extra behavior, supply a **base class** through the sanctioned
`$extends:` macro — the compiler then emits `defineComponent({ base: … })` and
the runtime extends it, so the class you name really is in the element's
prototype chain:

```js
@state {
  import { AihuCheckboxRoot } from '@aihu/primitives/checkbox'

  base: AihuCheckboxRoot
}
```

Choose between the two shapes by asking **what carries the semantics**:

- The **host** does (it *is* the checkbox / switch / dialog) → `$extends:` the
  primitive. See `checkbox.aihu`, `switch.aihu`, `dialog-*.aihu`.
- The **template** does (it renders a native `<button>`/`<input>`/`<label>`)
  → no `$extends:`. Extending would fight the native element — you get a
  focusable host wrapping a focusable control, two tab stops, and doubled
  keyboard activation. See `button.aihu`, `input.aihu`, `textarea.aihu`.

`tests/shadow-adoption.test.ts` pins both halves against the real compiler
output loaded in a DOM.

### Authoring a recipe: `@state` runs on the SERVER too

A `@state` block is emitted verbatim into the component's setup body, and under
`output: 'ssr'` that body executes inside a Cloudflare Worker — where
`HTMLElement`, `CSSStyleSheet`, `customElements` and `document` are all
`undefined`. A bare DOM reference there is not a degraded render, it is a
`ReferenceError`: as a child the element comes out empty, as a page the request
gets no response at all.

So anything in `@state` that touches a DOM global directly must be guarded:

```js
@state {
  // A media query read at setup time — genuinely DOM-only, genuinely needed.
  const compact =
    typeof matchMedia !== 'undefined' && matchMedia('(max-width: 40rem)').matches
}
```

The guard is a last resort, not the house style. Before reaching for one, check
that the DOM work belongs in `@state` at all — element registration and CSS
attachment do not (see the two sections above), and anything that needs a live
element belongs in `onMount`.

Three things do NOT need a guard, and should not get one:

- `onMount` / event handlers / `@aihu/use` composables — never run during a
  server render (the composables carry their own `isClient` no-op contract).
- `@aihu/primitives`' `defineX()` entry points (`defineSlider()`,
  `defineRadioGroup()`, …) — each is a documented no-op without a DOM.
- The `@style` block — the compiler already elides its `new CSSStyleSheet()`
  on the server target and ships the CSS as a string instead.

`tests/ssr-recipe-safety.test.ts` enforces this by compiling every recipe to
the server target and running its renderer in a DOM-less realm.

### Local development

```bash
bun run gen:registry   # scan registry/** → registry.json (index-only)
bun run test           # vitest (recipe-compile + shadow-adoption + SSR safety)
bun run typecheck      # tsc --noEmit (no dist; recipes are typechecked, not compiled)
```

### Ported catalogs — provenance

Some recipes in this registry are ported from third-party open-source catalogs, per
`docs/plans/2026-08-01-performative-ui-port.md`:

- **[tailwind-animations](https://github.com/midudev/tailwind-animations)** (MIT, ©
  Miguel Ángel Durán) — the ported `animate-*` utility classes are transcribed into
  `@aihu/css-engine`'s utility engine; see `vendor/tailwind-animations-*/PROVENANCE.md`
  and root [`NOTICES.md`](../../NOTICES.md).
- **[performativeUI](https://github.com/vorpus/performativeUI)** (MIT) — components in
  this registry inspired by performativeUI's design/behavior/style are reimplemented in
  aihu-native code (no `pui-` prefixed class names or source text copied); each such
  recipe's header comment carries a one-line attribution. See
  `docs/plans/2026-08-01-performative-ui-port.md` for the transcription policy and
  `scripts/check-no-vendored-pui.ts` for the CI guard enforcing it.
<!-- END_HANDWRITTEN: prose -->

## Install

<!-- BEGIN_AUTOGEN: install -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

```bash
npm install @aihu/ui
# or
bun add @aihu/ui
```

<sub><i>Auto-generated against `@aihu/ui@0.1.2`.</i></sub>

<!-- END_AUTOGEN: install -->

## Package facts

<!-- BEGIN_AUTOGEN: stats -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| | |
|---|---|
| **Version** | `0.1.2` |
| **Tier** | F — UI — styled-recipe registry distributed as source via `aihu add` |
| **Published files** | 6 entries |
| **License** | MIT |

<sub><i>Auto-generated against `@aihu/ui@0.1.2`.</i></sub>

<!-- END_AUTOGEN: stats -->

## Exports

<!-- BEGIN_AUTOGEN: exports -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| Subpath | ESM | CJS |
|---|---|---|
| `./registry.json` | `./registry.json` | — |
| `./registry` | `—` | `—` |
| `./schema` | `—` | `—` |

<sub><i>Auto-generated against `@aihu/ui@0.1.2`.</i></sub>

<!-- END_AUTOGEN: exports -->

## Dependencies

<!-- BEGIN_AUTOGEN: deps -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

_Zero runtime dependencies_ (per the [dep-free thesis](../../README.md#project-posture))_._

<sub><i>Auto-generated against `@aihu/ui@0.1.2`.</i></sub>

<!-- END_AUTOGEN: deps -->

## See also

<!-- BEGIN_AUTOGEN: see-also -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

- [@aihu/primitives](../primitives)
- [@aihu/css-engine](../css-engine)
- [Aihu framework root](../../README.md)

<sub><i>Auto-generated against `@aihu/ui@0.1.2`.</i></sub>

<!-- END_AUTOGEN: see-also -->

## License

<!-- BEGIN_AUTOGEN: license -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

MIT — see [LICENSE](../../LICENSE).

<sub><i>Auto-generated against `@aihu/ui@0.1.2`.</i></sub>

<!-- END_AUTOGEN: license -->
