# @aihu/primitives

## 0.2.4

### Patch Changes

- [#803](https://github.com/aihu-project/aihu/pull/803) [`2bc58cf`](https://github.com/aihu-project/aihu/commit/2bc58cfaba2289fd39ef7cc55a1cffc8cffb5a3a) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Move dependency-free progressive positioning to `@aihu/arbor/progressive` so
  headless primitives no longer depend on the CSS provider. The CSS provider
  continues to export its existing positioning API as a compatibility façade.

## 0.2.3

### Patch Changes

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix a live, currently-shipping crash for `$extends` (`base:`) components under
  `output: 'ssr'` — the last of the three SSR-entry exclusions filed with the
  `$aria`/`$form` guards, and the worst of them.

  **This was already live, and it did not fail soft.** A `.aihu` component using
  the `$extends`/`base:` recipe (`packages/ui/registry/switch/switch.aihu`,
  `checkbox.aihu`, every `dialog-*`/`popover-*` piece, `temperature.aihu`)
  imports its base primitive at module scope. `@aihu/primitives` declared every
  one of those bases as `class Aihu… extends HTMLElement` at ITS OWN module
  scope, and a class-extends clause is evaluated at module LOAD, not at
  construction or registration. So a server bundle threw
  `ReferenceError: HTMLElement is not defined` the instant it imported the base
  — before any compiled component code ran.

  Unlike the `$form`/`$aria` crash, this one is not caught by `__aihu_schild`'s
  fail-closed handling: the base import happens inside the router's
  `Promise.all` over the child registry, which is not fail-soft. The whole
  request died. Reproduced against a real built Worker: `ReferenceError` out of
  `__buildRouter`, no response at all — not a 200 with a missing element.

  **The scope question, settled by measurement rather than assumption.** The
  filed note wondered whether Cloudflare's runtime might already supply some
  inert `HTMLElement`, making this a bare-Node artifact. It does not. Probed
  directly against workerd 1.20260616.1 (the version this repo resolves), a
  Worker sees:

  | global                          | typeof      |
  | ------------------------------- | ----------- |
  | `HTMLRewriter`                  | `function`  |
  | `HTMLElement`                   | `undefined` |
  | `customElements`                | `undefined` |
  | `CSSStyleSheet`                 | `undefined` |
  | `document` / `Element` / `Node` | `undefined` |
  | `ElementInternals`              | `undefined` |

  So the bug is real in the actual deploy target and the scope did not narrow.
  A sweep of every `exports` subpath of every workspace package under a DOM-less
  `import()` found `@aihu/primitives` to be the ONLY package with this failure —
  so the fix did not need to widen either.

  **Two fixes, in two packages, and neither is sufficient alone.**

  1. `@aihu/primitives` — every base class now extends `HTMLElementBase`
     (new, exported from the barrel) instead of the bare global:
     `typeof HTMLElement === 'undefined' ? <inert placeholder> : HTMLElement`.
     All 23 declarations across 16 files, not a sample. A _conditional base_
     rather than the lazy-factory shape `@aihu-plugin/kindly-note` uses for its
     own DOM classes: there the class is an implementation detail, here it is
     the public API — consumers import `AihuSwitchRoot` by name, the `defineX()`
     registries hold direct references, and `$extends: AihuSwitchRoot` lowers to
     a class _identifier_, not a call. Deferring the declaration would break the
     `base:` recipe outright. Constructing one without a DOM throws a message
     naming the cause, rather than handing back an object that silently lacks
     `setAttribute`.

  2. `@aihu/compiler` — `$extends` is no longer excluded from the options-form
     SSR entry. That exclusion's stated reason was accurate but was a fact about
     `@aihu/primitives`, not about the gate: no compiler-side change could have
     fixed an import that throws before the emitted code runs. With the base
     import-safe, the exclusion was the only thing left. Without it, a
     `$extends` component still fell through to the plain client shape — a bare,
     ungated `defineElement(...)` at module scope
     (`ReferenceError: customElements is not defined`) and no `__ssr` export at
     all.

  `base:` needed no other change: it only affects which class the CLIENT-side
  `defineElement` extends (`packages/runtime/src/define-component.ts` reads
  `Base` inside `defineComponent`, which this branch already gates on DOM
  globals). `__aihu_setup__`'s body never touches it.

  **Known and intended:** the SSR pass renders the component's own `@template`,
  not the DOM the base primitive adds in `connectedCallback` (`role`,
  `aria-checked`, `tabindex`, the hidden form input). A server render never
  mounts, so that wiring lands on hydration — the same trade-off `$aria` already
  makes. **Still excluded:** `$extends` combined with `$form` (`define_opts` is
  still not threaded through the options-form SSR branch) — now pinned by a test
  so it cannot be lifted by accident.

  **Verified end-to-end, not by string assertion.** A `$extends` component
  against a real `@aihu/primitives` base, in the `workers-ssr` fixture, through
  a real `vite build`, driven as a built Worker. Before: `ReferenceError` and no
  response. After: 200 with `EXTENDS-OK` rendered inside its own element inside
  the outlet. Each fix was then reverted INDEPENDENTLY against that same Worker
  to confirm which crash each one owns:

  | primitives | compiler | result                                                         |
  | ---------- | -------- | -------------------------------------------------------------- |
  | ✗          | ✗        | `ReferenceError: HTMLElement is not defined` (the filed crash) |
  | ✗          | ✓        | same — the compiler gate cannot reach the base module          |
  | ✓          | ✗        | `ReferenceError: customElements is not defined`                |
  | ✓          | ✓        | 200, rendered                                                  |

  Pinned by three layers: `workers-ssr-e2e.test.ts` assertions 15 + 15b (real
  Worker, with the empty-registry control proving the content is resolved
  through the child registry rather than inlined); a node-environment
  `@aihu/primitives` suite covering all 20 published entries in milliseconds, so
  a primitive added later that forgets `HTMLElementBase` fails immediately; and
  four Rust tests on the emitted structure. Reverting the primitives fix turns
  10 of 18 e2e assertions red; reverting the compiler fix turns 2 Rust tests
  red.

  Size: the guard costs ~170 B gzip on each entry that declares a class, and is
  tree-shaken entirely out of the two that do not (`context`, `focus-trap` are
  byte-identical). Every per-primitive budget still passes; tightest is
  `radio-group` at 3.42 kB / 4 KB.

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

- Updated dependencies [[`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf)]:
  - @aihu/css-engine@0.6.1
  - @aihu/arbor@4.1.1

## 0.2.2

### Patch Changes

- Updated dependencies [[`ac9c045`](https://github.com/fellwork/aihu/commit/ac9c04599b2fbf57c9f39a39e1c9db7fe1388028), [`ac9c045`](https://github.com/fellwork/aihu/commit/ac9c04599b2fbf57c9f39a39e1c9db7fe1388028), [`ac9c045`](https://github.com/fellwork/aihu/commit/ac9c04599b2fbf57c9f39a39e1c9db7fe1388028)]:
  - @aihu/arbor@4.1.0

## 0.2.1

### Patch Changes

- Updated dependencies [[`c38072f`](https://github.com/fellwork/aihu/commit/c38072f95ca4887c2968d7dabee176f577b44e6e)]:
  - @aihu/css-engine@0.6.0

## 0.2.0

### Minor Changes

- [#710](https://github.com/fellwork/aihu/pull/710) [`19af14c`](https://github.com/fellwork/aihu/commit/19af14c0989fcae8eed344c119ba91894e13c776) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Dedupe the two focus-trap implementations onto one (FEL-397 / [#537](https://github.com/fellwork/aihu/issues/537)), and fix
  the escape guard that could never fire.

  `@aihu/runtime`'s `<focusTrap>` helper carried its own trap — private focusable
  selector, its own shadow-aware DOM walk, its own Tab/Shift+Tab edge handling —
  in parallel with `@aihu/primitives`' `createFocusTrap`. It is now a thin
  reactive adapter: it locates the emitted host and maps the compiler's reactive
  `active` flag onto `activate()` / `deactivate()`. `createFocusTrap(active,
returnFocus, initialFocus, childFn)` keeps its exact signature, so no compiler
  change is needed.

  This also fixes the asymmetric escape guard rather than papering over it. The
  old code bound `keydown` to the trap host and tested
  `!e.composedPath().includes(host)` — which can never be true, because a
  `composedPath()` IS the event's propagation path and a listener only runs when
  its own node is on that path. The guard was unreachable in both directions, so
  merely adding the missing forward-Tab copy would have been a no-op. The shared
  implementation binds `keydown` on `document` in the CAPTURE phase, where it
  observes keydowns originating anywhere — so `composedContains(container,
current)` is a genuinely reachable "focus escaped the trap" state, symmetric
  across Tab and Shift+Tab.

  New in `@aihu/primitives`:

  - `createFocusTrap(container, options?)` accepts `initialFocus` (a selector
    resolved across the COMPOSED subtree, so it reaches into open shadow roots)
    and `returnFocus` (opt out of restoring the previously-focused element).
    `FocusTrapOptions` is exported; the existing no-options call is unchanged.
  - A dedicated `@aihu/primitives/focus-trap` subpath entry (1.31 kB gz), so
    consumers get the trap without pulling in the whole dialog primitive.
  - A trap whose container is detached without `deactivate()` no longer hijacks
    Tab page-wide (nor reads `activeElement` off a detached root).

## 0.1.6

### Patch Changes

- Updated dependencies [[`3ac389f`](https://github.com/fellwork/aihu/commit/3ac389f55b9f8a2a956122d394639d3f9bf21bef), [`bba7e84`](https://github.com/fellwork/aihu/commit/bba7e8441a836b01a5927e5f7e3b8870b3d8c3ac)]:
  - @aihu/css-engine@0.5.0

## 0.1.5

### Patch Changes

- [#538](https://github.com/fellwork/aihu/pull/538) [`6c4d9cb`](https://github.com/fellwork/aihu/commit/6c4d9cbef430e33456370f82c0310444c43f1325) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix `composed-tree.ts`'s upward walk (`composedParent`) to consult
  `assignedSlot`, so it agrees with the slot-aware downward walk
  (`composedChildren`/`walkComposedTree`). Previously, `composedParent` only
  hopped `ShadowRoot -> .host`, never resolving a slotted node to its `<slot>` —
  so `composedContains`, `composedClosest`, and `composedCompareOrder` (all
  built on `composedParent`) silently disagreed with `queryTabbables` for any
  slotted subtree.

  This broke `createFocusTrap` in exactly the shadow-DOM-opt-in scenario it
  exists to support: a focus-trap container living inside a shadow tree that
  receives its content via `<slot>`. `queryTabbables` found the slotted
  focusable, but `composedContains`'s `!composedContains` guard fired on every
  Tab press, force-refocusing the first element and trapping the user on it —
  Tab could never reach the other slotted controls.

  It also silently degraded `<aihu-collection>`'s DOM-order sort
  (`sortDomOrder` / `composedCompareOrder`, used by `roving-focus` and
  `radio-group`) for light-DOM siblings slotted under a single shadow host: the
  ancestor chains diverged at the host with no common ancestor found, and the
  comparator fell back to `0`, silently reverting to registration order instead
  of rendered order.

  Added upward-walk slot-boundary tests (`composedContains`/`composedClosest`
  across a `<slot>`, and a `composedCompareOrder` probe for two slotted
  siblings under a shared shadow host) — the existing slot-boundary coverage
  only exercised the downward walk (`walkComposedTree`).

- [#543](https://github.com/fellwork/aihu/pull/543) [`aff5bf3`](https://github.com/fellwork/aihu/commit/aff5bf37a1b2358f8e7e9dcd71551a6afa8118d5) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix `queryTabbables`' tab-order reconstruction to match the real HTML
  sequential-focus-navigation algorithm instead of reordering each
  focus-navigation scope in place at its original composed-DFS position.

  Previously, a nested shadow root's content stayed pinned at the document
  position its host originally occupied, rather than traveling WITH the host
  once the host's own scope was reordered by tabindex. This diverged from the
  platform's real Tab sequence in exactly the scenario this module exists to
  get right — a positive-`tabindex` element and a shadow host interacting in
  the same scope:

  - A natural host before a positive-`tabindex` sibling: returned `[b, x, a]`
    where the browser visits `[b, a, x]`.
  - A positive-`tabindex` host: returned `[host, a, x]` where the browser
    enters the host's shadow tree immediately after the host, visiting
    `[host, x, a]`.

  Both cases made `createFocusTrap`'s first/last-tabbable bookkeeping disagree
  with native Tab traversal, causing the trap to wrap at the wrong edges.

  `queryTabbables` now builds a real scope tree during the walk: each open
  shadow root is a nested scope whose HOST is a member of the parent scope
  (ordered there by the host's own `tabindex`, even when the host itself isn't
  tabbable); each scope's direct members are ordered by tab rules (positive
  `tabindex` ascending, ties in tree order, then naturals in tree order); and
  each host's already-ordered nested scope is spliced in immediately after it
  in the parent's ordered sequence — not left at its original DFS slot.

  Corrected the `orderScope` doc comment's cross-scope invariant claim
  accordingly (a nested scope moves with its host; it does not keep its
  original relative document position) and added regression tests for both
  confirmed cases.

- Updated dependencies [[`2f24fa3`](https://github.com/fellwork/aihu/commit/2f24fa3fdc592c85e39f500a48a7e4d3ff67c86d), [`a993aa1`](https://github.com/fellwork/aihu/commit/a993aa19d402c221faa463dfb5d94c86cc87b670), [`edc15f2`](https://github.com/fellwork/aihu/commit/edc15f2a2de541fa8f7ffd6266ad984446206257), [`ad6921a`](https://github.com/fellwork/aihu/commit/ad6921a018ef4a479f6540278e549aa9a8cab387)]:
  - @aihu/arbor@4.0.0
  - @aihu/signals@0.5.0

## 0.1.4

### Patch Changes

- Updated dependencies [[`18e5f6d`](https://github.com/fellwork/aihu/commit/18e5f6dda93772877690e88e8c217dcdcf4bddc2), [`ea8d2eb`](https://github.com/fellwork/aihu/commit/ea8d2ebb91c28132f399a708e2bd88877072d1db)]:
  - @aihu/signals@0.4.0
  - @aihu/arbor@3.0.0

## 0.1.3

### Patch Changes

- Updated dependencies []:
  - @aihu/css-engine@0.4.6

## 0.1.2

### Patch Changes

- Updated dependencies [[`514336d`](https://github.com/fellwork/aihu/commit/514336da5892c29e9e02d7a6391bb06c62d688c3)]:
  - @aihu/signals@0.3.0
  - @aihu/arbor@2.0.0
  - @aihu/css-engine@0.4.5

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @aihu/css-engine@0.4.4

## 0.1.0

### Minor Changes

- [#348](https://github.com/fellwork/aihu/pull/348) [`03fa951`](https://github.com/fellwork/aihu/commit/03fa951c00ddf1da8e594b022cf1b1b0be22b189) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Phase 2 headless primitives (spec §7.7): `Separator`, `Label`, `Input`,
  `Textarea`, `Checkbox`, `Switch`, `RadioGroup`. Each is a light-DOM, zero-CSS
  custom element with full WAI-ARIA APG keyboard + ARIA behavior, exported from
  its own subpath (`@aihu/primitives/<name>`).

  - Form participation via a visually-hidden native input (`attachHiddenInput`,
    re-exported from `@aihu/primitives/form-control`); Input/Textarea wrap a real
    native control directly. Values ride native `FormData` / submission.
  - Labelling ARIA (`aria-label`/`aria-labelledby`/`aria-describedby`) on Input/
    Textarea hosts is forwarded to the native control; the form-association input
    is placed as the host's sibling to avoid `nested-interactive` on roled hosts.
  - `form-control` exposes `labelId` and wires `aria-labelledby` for non-native
    (`[data-fc-label]`) labels; `roving-focus` `setCurrent(i, focus=false)` moves
    the tab stop without stealing focus (RadioGroup selection-follows-focus).

### Patch Changes

- Updated dependencies [[`cc24673`](https://github.com/fellwork/aihu/commit/cc246732d7dce820ee6abdc1dc86d391a228d7cf)]:
  - @aihu/css-engine@0.4.3

## 0.0.12

### Patch Changes

- Updated dependencies []:
  - @aihu/css-engine@0.4.2

## 0.0.11

### Patch Changes

- Updated dependencies []:
  - @aihu/css-engine@0.4.1

## 0.0.10

### Patch Changes

- Updated dependencies [[`b85f400`](https://github.com/fellwork/aihu/commit/b85f4008c489a0dba9e36cbdfc48b635eeea375f), [`7e1f1fe`](https://github.com/fellwork/aihu/commit/7e1f1fe0ef1be17b5ea928727252d849f48c46ef), [`8f56e88`](https://github.com/fellwork/aihu/commit/8f56e881e500df7c237f996c319f04dedab3cd7e)]:
  - @aihu/signals@0.2.0
  - @aihu/css-engine@0.4.0
  - @aihu/arbor@1.0.0

## 0.0.9

### Patch Changes

- Updated dependencies [[`1a3a857`](https://github.com/fellwork/aihu/commit/1a3a85792ef0f21611184ff6ea84a5a2a63d09af), [`38a6dc5`](https://github.com/fellwork/aihu/commit/38a6dc5f9531d82b57081562d81a6b6c6d4cae21), [`6322593`](https://github.com/fellwork/aihu/commit/63225938452ef14e4e5f86b56a252a2c9d526265), [`4b90dfa`](https://github.com/fellwork/aihu/commit/4b90dfa1c22243bc5de9c31cb6e406ab83381bfb), [`6a84dbb`](https://github.com/fellwork/aihu/commit/6a84dbb5298fd86d715d3ccbf0b88511803980d9), [`14f3a3e`](https://github.com/fellwork/aihu/commit/14f3a3e4b12a09d396cbe3a537ee67a5cc512049), [`3089577`](https://github.com/fellwork/aihu/commit/30895777d91823005805c66a2f06c2afcf443dde)]:
  - @aihu/css-engine@0.3.0

## 0.0.8

### Patch Changes

- Updated dependencies [[`74273e0`](https://github.com/fellwork/aihu/commit/74273e0a015805f3c878c9b2c7890ed0c80a23fd), [`c6860e0`](https://github.com/fellwork/aihu/commit/c6860e022a374b3c5e35aaf8775cbb6332b1b75d), [`5f21125`](https://github.com/fellwork/aihu/commit/5f211252c7500973c6976ca48f29b09ea8aa049b)]:
  - @aihu/css-engine@0.2.5

## 0.0.7

### Patch Changes

- Updated dependencies [[`84352bc`](https://github.com/fellwork/aihu/commit/84352bcb901b7213d67727648545b41652b2092a), [`d42793b`](https://github.com/fellwork/aihu/commit/d42793b8258d723ae7c80179dcc82e2db8d0afc4)]:
  - @aihu/arbor@0.1.5
  - @aihu/css-engine@0.2.4

## 0.0.6

### Patch Changes

- Updated dependencies []:
  - @aihu/css-engine@0.2.3

## 0.0.5

### Patch Changes

- Updated dependencies []:
  - @aihu/css-engine@0.2.2

## 0.0.4

### Patch Changes

- Updated dependencies [[`71ca28e`](https://github.com/fellwork/aihu/commit/71ca28ece93dfcfdad4bd9edda2a2ead415d26f2)]:
  - @aihu/css-engine@0.2.1

## 0.0.3

### Patch Changes

- Updated dependencies [[`a866af7`](https://github.com/fellwork/aihu/commit/a866af78d41931e28c5b19084342e566ca47bdee), [`45b393c`](https://github.com/fellwork/aihu/commit/45b393c3f48758bf82c152bbe6088c63edaa68a6)]:
  - @aihu/css-engine@0.2.0

## 0.0.2

### Patch Changes

- Updated dependencies []:
  - @aihu/css-engine@0.1.1

## 0.0.1

### Patch Changes

- Updated dependencies [[`31a37ef`](https://github.com/fellwork/aihu/commit/31a37eff5506f913c7081698745eac5092e04463), [`eed6ce6`](https://github.com/fellwork/aihu/commit/eed6ce6d600c06d3fa22ea228f3f370c6cebb2dc)]:
  - @aihu/css-engine@0.1.0
