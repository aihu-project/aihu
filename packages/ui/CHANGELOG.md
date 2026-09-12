# @aihu/ui

## 0.1.2

### Patch Changes

- [#821](https://github.com/aihu-project/aihu/pull/821) [`95bf123`](https://github.com/aihu-project/aihu/commit/95bf1232ce3df85a5b4b373b79d760aba098d46b) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Expose the UI registry catalog types from `@aihu/ui/registry` and make the CLI
  consume that public contract instead of importing the UI package's source tree.

## 0.1.1

### Patch Changes

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Delete the dead `customElements.define` block from `card`, `badge`, `separator`
  and `button`, and correct the two architectural claims it was standing in for.

  This closes the open finding filed at the end of
  `.changeset/ssr-setup-body-dom-guard.md`. That change SSR-guarded these four
  `@state` blocks to preserve their behavior exactly, and while doing so noticed
  the blocks never ran in a browser either. Reproduced independently here before
  acting on it, and the finding holds — with one correction, below.

  **The mechanism, from the compiler's actual output.** `aihu-compile --target
client` on `card.aihu` emits, in this order:

  ```js
  const __style__ = new CSSStyleSheet();            // module scope
  __style__.replaceSync(`.aihu-card { … }`);

  defineElement('aihu-card', defineComponent((ctx) => {   // module scope
    (ctx.host as ShadowRoot).adoptedStyleSheets = [__style__];
    if (typeof HTMLElement !== 'undefined' && …) {        // the recipe's @state
      class AihuCard extends HTMLElement { static sheet = new CSSStyleSheet() … }
      if (!customElements.get('aihu-card')) customElements.define('aihu-card', AihuCard)
    }
    return branch('div', …)
  }))
  ```

  `defineElement` runs when the module evaluates. The `@state` block is emitted
  into the _setup_ body, which the runtime calls only when an element **upgrades**
  — strictly afterwards. So `customElements.get('aihu-card')` is already truthy
  the first time the recipe's own guard reads it, and always will be. Loading the
  compiled module in jsdom and instrumenting `customElements.define` confirms it:
  one call, tag `aihu-card`, constructor `Wrapped` (the runtime's
  `wrapClass`), at module load — and after upgrading two instances, still one
  call. The recipe's class never registers. `aihu add`'s `substitutePrefix`
  rewrites the tag and the filename together, so it was not registering a phantom
  element under a stale prefix either.

  **Correction to the filed finding: R2 was never broken.** The note concluded
  that "the compiled recipe stylesheet is a shared static Constructable StyleSheet
  adopted into the shadow root" was therefore not delivered. It is delivered — by
  the compiler, which is where it belongs. `__style__` above is module-scope
  (constructed once per module, not per instance), carries the real compiled
  `@style` rules, and is assigned to `ctx.host.adoptedStyleSheets` for every
  instance. Measured on the compiled module: one adopted sheet per shadow root,
  the SAME object across two instances, four parsed rules for `card`. What the
  four recipes hand-rolled was a _second_, redundant implementation of a contract
  the compiler already satisfied — and their `static sheet = new CSSStyleSheet()`
  was never `replaceSync`'d, so it held zero rules. Had it somehow won
  registration it would have attached a bare shadow root with no template and no
  CSS: strictly worse than what ships.

  **Chosen: delete it.** The alternative in the filed note — teach the compiler to
  honour a class the recipe defines — is not a gap in the framework. Supplying a
  base class is exactly what `$extends:`/`base:` already does: the compiler emits
  `defineComponent({ base: X })`, the runtime does `class C extends Base` and then
  `class Wrapped extends C`, so the named class really is in the prototype chain.
  Eleven recipes already use it (`checkbox`, `switch`, the `dialog-*`, `popover-*`
  and `tooltip-*` pieces, `temperature`). These four were not reaching for a
  missing mechanism; they were duplicating one that exists, in a position where it
  could not run.

  **And `$extends` is the WRONG tool for these four — measured, not assumed.**
  The tempting reading is that `button.aihu`, which imported `AihuButton` and
  claimed to be "the class-extension recipe", should simply migrate to
  `base: AihuButton`. Compiled and driven, that turns out to be a regression. Its
  `@template` renders a real `<button type="button">` inside the shadow root, and
  `AihuButton`'s contract is "if the host is NOT a native `<button>`, set
  `role="button"` + `tabindex="0"` and translate Enter/Space into `this.click()`".
  Applying it here:

  |                         | host `role` | host `tabindex` | inner native `<button>` |
  | ----------------------- | ----------- | --------------- | ----------------------- |
  | shipped today           | _(none)_    | _(none)_        | present                 |
  | with `base: AihuButton` | `button`    | `0`             | present                 |

  — a focusable widget wrapping a focusable control: nested interactive controls,
  two tab stops, and Enter activating twice. That is precisely the failure
  `input.aihu` already documents as the reason it takes no base ("the native
  control plus light DOM is enough for forms; extending a primitive would fight
  the template-rendered native element"). `button`, `card`, `badge` and
  `separator` all render the semantic element in their template, so all four
  belong in the no-`$extends` camp with `input` / `textarea` / `label`. The
  recipes' headers now say so, and say where the class-extension model lives
  instead.

  **What actually changes at runtime.** Nothing visual — the CSS was always coming
  from `__style__`, and the a11y/ARIA was always coming from the template
  (`separator.stories.ts` had already noticed this and asserted against the
  template element, calling it a "Track 0 finding"). Two real, small wins:

  - the class declaration and its throwaway `new CSSStyleSheet()` sat inside the
    setup body, so they were re-evaluated on EVERY instance. Loading a recipe and
    upgrading two elements used to cost 3 sheet constructions; it now costs 1.
  - `button`'s compiled module no longer imports `@aihu/primitives/button` (and
    transitively its context/form-control/signals edges) for a class it never
    used. `meta.json`'s `dependencies: ['@aihu/primitives']` and the generated
    `registry.json` entry drop with it — `aihu add button` no longer tells
    consumers to install a package the recipe does not use.

  **`tests/shadow-adoption.test.ts` is rebuilt, because the old one was a
  landmine.** It re-declared the recipe class by hand in TypeScript, registered
  _that_ itself, and asserted the result — validating a code path production never
  takes. It could not have failed for a third reason either: jsdom 25 exposes a
  `CSSStyleSheet` constructor but implements neither `replaceSync` nor a real
  `adoptedStyleSheets` accessor, so `shadowRoot.adoptedStyleSheets = [sheet]` was a
  plain expando write that `toContain(sheet)` read straight back. The replacement
  compiles all four recipes with the real binary at the real client target, loads
  the emitted modules, upgrades two instances of each, and asserts against those:
  one adopted sheet per shadow root carrying the recipe's own selectors, the same
  object across instances, exactly one `CSSStyleSheet` construction per recipe,
  exactly one `customElements.define` per tag, and the template actually rendered.
  Falsified in both directions: restoring all four pre-fix sources turns 8 of its
  25 assertions red (4 sheet-construction counts, 4 source guards), and the
  "registered exactly once" assertions stay green under the old sources too —
  which is the honest result, since the dead `define` genuinely never fired.

  **Real-browser confirmation, since jsdom cannot give it.** The Storybook + axe
  gate (`bun run check:a11y`) drives all four recipes in chromium, and three
  stories gained assertions that only mean something there: `UI/Card` Default
  checks `adoptedStyleSheets.length === 1` with no inline `<style>` and real
  computed `border-radius: 8px` / `padding: 24px`; `UI/Badge` Variants checks each
  variant resolves a distinct background, proving the `[data-variant]` selectors
  are live in the shadow cascade; `UI/Button` Default checks the computed size
  box AND pins the host as having no `role` and no `tabindex` — the property the
  `$extends` migration would have broken.

  `packages/ui/README.md` gains two sections — "CSS attachment (R2): the compiler
  owns it" and "Do NOT register the element yourself" — and its SSR-guard example
  no longer teaches the dead pattern as the thing to guard. That example mattered:
  these recipes are copied verbatim into consumer projects by `aihu add`.

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix a live, currently-shipping crash for `@aihu/ui` styled recipes under
  `output: 'ssr'` — a component's `@state` block runs on the server, and six
  recipes touched a DOM global from inside it.

  **This was already live, and on a page it did not fail soft.** The compiler
  emits an `@state` block VERBATIM into `__aihu_setup__` and
  `__aihu_ssr_string_setup__` — the body a server render executes for every
  component. Six shipped recipes put a DOM-only operation there:

  | recipe                       | what it did in `@state`                                                                         | threw                           |
  | ---------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------- |
  | `card`, `badge`, `separator` | `class X extends HTMLElement` + `static sheet = new CSSStyleSheet()` + `customElements.define`  | `HTMLElement is not defined`    |
  | `button`                     | same, extending `AihuButton` (import-safe, but the static initializer and registration are not) | `CSSStyleSheet is not defined`  |
  | `before-after`               | `defineSlider()` from `@aihu/primitives/slider`                                                 | `customElements is not defined` |
  | `temperature`                | `defineRadioGroup()` from `@aihu/primitives/radio-group`                                        | `customElements is not defined` |

  Two outcomes, and only one is survivable. As a CHILD, `__aihu_schild` catches
  the throw and degrades that element to `<aihu-card></aihu-card>` with a console
  error — the page ships with a hole in it. As a PAGE or a LAYOUT there is no
  such net: `handle()` calls `renderToString` directly, the `ReferenceError`
  propagates out of the Worker's `fetch`, and the request gets **no response at
  all**. Both reproduced against a real built Worker, not inferred.

  **This is a DIFFERENT bug from `$extends`, at a different time.**
  `.changeset/ssr-extends-base-guard.md` fixed a crash at module LOAD: a class
  declared at a primitive module's own top level, whose extends clause is
  evaluated on import. That fix (`HTMLElementBase`) is necessary and is not
  sufficient here, because nothing about it reaches code that runs later. This
  crash is at SETUP-BODY EXECUTION, which happens for every server-rendered
  component whether or not it has a `base:` clause — and `HTMLElementBase` cannot
  help a `new CSSStyleSheet()` or a `customElements.get()` written by an author.

  **The filed scope was wrong in both directions; corrected by measurement.**

  - `chat-fab.aihu` was flagged as calling `defineX()`. It does not — its only
    mention of `customElements.define` is a comment explaining why it deliberately
    does NOT call `definePopover()`. Removed from scope.
  - `button.aihu` was NOT flagged and is affected — the same class + Constructable
    StyleSheet shape as `card`/`badge`/`separator`. Added to scope.
  - A sweep of all 301 `.aihu` files in the repo (not just `packages/ui`) found no
    further instances. Every other DOM reference in a `@state` block is inside
    `onMount`, an `action`, or an event handler — none of which run on the server
    — or is already `typeof`-guarded (`apps/docs`), or reaches `@aihu/use`, whose
    composables carry their own `isClient` no-op contract.
    `examples/primitives-showcase` does call `defineButton`/`defineDialog`/
    `defineTooltip` from `@state`; it is a SPA build, so it never crashed, but it
    is fixed by the same change below.

  **Two fixes, in two packages, and neither is sufficient alone.**

  1.  `@aihu/primitives` — all 17 `defineX()` registration entry points now return
      early when `typeof customElements === 'undefined'`. Fixed ONCE for every
      caller, rather than as ~18 edits across recipes, examples and consumer code
      that does not exist yet.

           **The no-op is deliberate, and it is not a new policy.** The filed note
           raised it as an open behavior decision ("silently skipping registration").
           Three things settle it. Registration is a pure side effect on
           `window.customElements` with no return value and no server-side consumer: an
           SSR render resolves children through the compiler's module registry
           (`virtual:aihu-server-components`), never through `customElements`, and a
           server render never mounts — so nothing observable is lost. The compiler
           ALREADY emits every compiled component's own registration as
           `if (typeof HTMLElement !== 'undefined' && typeof customElements !==

      'undefined') defineElement(…)`, so "no DOM → skip registration" is what aihu
     does everywhere it controls the registration; this extends it to the ones a
     primitive owns. And a better-worded throw would help nobody: the `defineX()`
      call is correct code that happens to also run on the server, and there is no
      edit the author could make in response.

           This is the opposite answer to `HTMLElementBase`'s throw-on-CONSTRUCT, for a
           reason stated in that file's docblock: construction hands back an object the
           caller will use and find broken, so it fails loud. Unlike the conditional
           base, the check here is per CALL, so a host that installs a DOM shim late
           still gets real registration.

  2.  `@aihu/ui` — `card`, `badge`, `separator` and `button` wrap their `@state`
      class + registration in the same `typeof HTMLElement !== 'undefined' &&
typeof customElements !== 'undefined'` condition the compiler puts on its own
      `defineElement` call a few lines below in the emitted module. This one has to
      live in authored source: no shared function is involved, the compiler emits
      what the author wrote, and these recipes are copied verbatim into consumer
      projects by `aihu add`. Documented in `packages/ui/README.md` §"Authoring a
      recipe: `@state` runs on the SERVER too".

  No compiler change was needed. The `@style` block's own `new CSSStyleSheet()`
  is already elided at the server target (`emit_ssr_css_export`, `emit.rs`); only
  author-written code was reaching a DOM global.

  **Verified end-to-end, then reverted in both directions.** The
  `workers-ssr` fixture gained three probes (a styled-recipe child, the same shape
  on a page, and an unguarded `defineSlider()` call), built by a real `vite build`
  and driven as a built Worker. Before: the child rendered empty with
  `ReferenceError: HTMLElement is not defined`, and `GET /recipe-page` threw out
  of `mod.default.fetch` with no response. After: 200, content rendered inside the
  outlet. Each fix was then reverted INDEPENDENTLY against that same Worker:

  | primitives | ui recipes | result                                                                 |
  | ---------- | ---------- | ---------------------------------------------------------------------- |
  | ✗          | ✗          | both shapes broken (the filed crash)                                   |
  | ✓          | ✗          | assertions 16 + 17 red — the library fix cannot reach authored code    |
  | ✗          | ✓          | assertion 18 red — `customElements is not defined` from `defineSlider` |
  | ✓          | ✓          | 23/23 green                                                            |

  Pinned by three layers. `workers-ssr-e2e.test.ts` assertions 16/16b/17/18/18b (a
  real Worker, with empty-registry controls proving the content resolves through
  the child registry rather than being inlined). A new
  `packages/ui/tests/ssr-recipe-safety.test.ts` that compiles all 53 registry
  recipes to the server target with the real compiler binary and CALLS
  `__ssrString` and `__ssr` in a node realm with no DOM — execution, not a regex,
  so a future recipe reaching for `matchMedia` or `new ResizeObserver()` at setup
  time fails too; reverting the ui fix turns 8 of its 109 assertions red, and
  reverting the primitives fix turns exactly `before-after` and `temperature` red.
  And an extension to `packages/primitives/tests/no-dom-import.test.ts` that
  enumerates every `define*` export off the barrel and calls each one twice under
  no DOM.

  Browser behavior is unchanged and was checked as such, not assumed: the
  Storybook interaction + axe gate (`bun run check:a11y`) passes 270 tests across
  61 suites in real chromium, covering every affected recipe's play functions.
  Size: `@aihu/primitives/radio-group`, the tightest budget, moves 3.42 kB → 3.43 kB
  against a 4 KB cap; every other entry is unchanged or smaller in headroom terms.

  **Found while verifying, NOT fixed here.** RESOLVED in
  `.changeset/registry-dead-registration.md`: the block was deleted, and the R2
  worry below turned out to be unfounded — the compiler's own module-scope
  `__style__` already delivers it. Everything from here down is the finding as
  originally filed. The
  hand-written `customElements.define` in `card`/`badge`/`separator`/`button` is
  DEAD CODE in the browser, and measurably so: loading a compiled `aihu-card`
  module in jsdom and reading `customElements.get('aihu-card')` returns the
  compiler's `Wrapped` class, never `AihuCard`. The compiler registers the tag at
  module scope; the `@state` body only runs on upgrade, i.e. strictly afterwards,
  so `customElements.get(...)` is already truthy and the recipe's own `define` is
  always skipped. (`aihu add`'s `substitutePrefix` rewrites the tag in the source
  AND the filename together, so the two never disagree and it is not registering a
  phantom element either.) The consequence is that R2 — "the compiled recipe
  stylesheet is a shared static Constructable StyleSheet adopted into the shadow
  root" — is not actually delivered by the shipped path for these four recipes;
  `tests/shadow-adoption.test.ts` proves the class SHAPE honours it, by
  registering that class itself, which the real build never does. Guarding the
  block keeps today's behavior exactly. Deleting it, or making the compiler honour
  the recipe's own class, is a design decision about the registry's CSS-attachment
  contract and is left to the founder.

## 0.1.0

### Minor Changes

- [#348](https://github.com/fellwork/aihu/pull/348) [`dbc0903`](https://github.com/fellwork/aihu/commit/dbc09031f22ee93d9e5c9a46fea2ca2409463e90) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Phase 2 styled recipes (spec §9.7), all light-DOM (`$shadow: 'none'`) so
  native form controls join the outer `<form>`: `checkbox` and `switch` extend
  their headless primitives via `$extends:` (the host element IS the behavioral
  primitive subclass); `input`, `textarea`, `label` forward props onto native
  elements; `dialog` (7 piece files) and `tooltip` (3 piece files) extend the
  overlay primitive pieces. Also fixes the four Phase 1 recipes' unsupported
  `const props = $props` pattern (now `$prop:` declarations — the old form threw
  `ReferenceError` at element instantiation) and excludes co-located
  `*.stories.ts`/`*.test.ts` from the registry index so `aihu add` never copies
  them.
