# @aihu/app

## 10.1.1

### Patch Changes

- [#844](https://github.com/aihu-project/aihu/pull/844) [`d257f63`](https://github.com/aihu-project/aihu/commit/d257f63c7710c5c654260684333e2a51b17c396e) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix the `@aihu/runtime` peer pin. `@aihu/app` 10.1.0 imports `@aihu/runtime/app` but pinned `@aihu/runtime` to 6.1.0, which predates that export, so installing the declared peers failed to resolve the import. The workspace runtime version now matches the published 6.1.1 that provides `./app`, so this release pins `@aihu/runtime` 6.1.1 ([#843](https://github.com/aihu-project/aihu/issues/843)).

## 10.1.0

### Minor Changes

- [#838](https://github.com/aihu-project/aihu/pull/838) [`a11112b`](https://github.com/aihu-project/aihu/commit/a11112bdcd4eadaa3fbb9a366c6b692e4e74ecea) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Add project-level theme controls for `@aihu/css-engine`.

  - `css.theme` on `viteAihuPlugin` takes a CSS file with an `@theme { … }` block (relative to the Vite root) or a `defineStylePack()` result. Its values replace the built-in `aihu-default` palette as the `var()` fallback values in every component, so components render the app palette without a per-file `@theme`, while tokens set at `:root` still win. The dev server restarts when the theme file changes.
  - `css.hostTokens: false` compiles token references to bare `var(--name)` with no fallback, for apps that always load their tokens at `:root`. Combining it with `css.theme` is a config error, since the theme would have no effect.
  - `compileSfc()` accepts these as a fourth `options` argument (`{ theme, hostTokens }`).

  Forwarding from `@aihu/app` needs an `@aihu/compiler` release with the matching `css` plugin option.

### Patch Changes

- [#810](https://github.com/aihu-project/aihu/pull/810) [`37a0a2e`](https://github.com/aihu-project/aihu/commit/37a0a2e83611c7654c41e43dce1ac930a23698be) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Resolve compiler integrations through the published `@aihu/compiler` package instead of the monorepo source tree. `@aihu/app` now declares the compiler as a runtime dependency so its public Vite integration installs correctly for consumers.

## 10.0.0

### Minor Changes

- [#778](https://github.com/fellwork/aihu/pull/778) [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Prerender referenced components instead of empty shells.

  `buildChildRegistry` indexes discovered components by the tag they register
  under and rejects a cyclic component graph at build time — loudly, because
  render-time recursion is already bounded by a depth cap, so a cycle would
  otherwise emit 32 nested copies of the same subtree and write them to disk.

  The SSG prerender discovers components under `dir.components`, keying each by
  its own `__aihu_tag__` export rather than deriving a tag from the filename, and
  passes the registry to every layout and page render.

  Also fixes a double `data-a` stamp: a compiled `__ssrString` resolves
  `opts.lightScopeId ?? __AIHU_LIGHT_SCOPE_ID__`, so omitting the option let the
  module's own id stamp the template root while the host carried it too. Two
  stamps make the template root a nested scope root and cut the component's own
  `@scope(…) to ([data-a])` rules off at its first child. The child now renders
  with an explicit empty scope id, which survives `??` and suppresses the stamp.

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - `output: 'ssr'` now serves a full document, so an SSR route actually hydrates.

  The response body was a bare fragment: no doctype, no `<html>`, no `<head>`, no
  `<title>`, and — the part that mattered — no client `<script type="module">`. A
  deployed Worker painted server-rendered markup and then stopped. No hydration,
  no interactivity, no SEO tags, and nothing in the build said so.

  `renderToString`'s own document wrapper is gated on `SsrOptions.head`, which
  neither `handle()` arm passes, and passing it would not have helped: `buildHead`
  has no facility for `<script src>` at all (`ScriptTag` is `{ type, content }`).
  Meanwhile the SSG path had solved this from the start by never computing a
  document — it reads the finished client `dist/index.html`, which already carries
  Vite's hashed entry script, and splices the render into the outlet. The only
  missing input was that nothing passed that template into the server bundle.

  A new `virtual:aihu-ssr-document` inlines the built `index.html` into the Worker
  (the client environment builds first, so the file is on disk when the `ssr`
  environment's `load()` runs), and the generated `virtual:aihu-server-entry`
  splices each rendered fragment into it. `@aihu/app/ssr-document` is a new pure,
  Worker-safe entry holding the splice — the SAME function the SSG prerender now
  calls, so the two paths cannot drift.

  The wrap lives in the generated entry rather than in `createServerRouter` on
  purpose. The template is a BUILD ARTIFACT, and the only thing that knows about
  build artifacts is the Vite plugin that generates the entry. `handle()` is
  therefore byte-identical for every existing consumer — adapters, hand-wired Node
  servers, the SSG path — and `@aihu/server` is untouched.

  Only `text/html` responses are wrapped. A 404, a 500 and the E3 governed-data
  endpoint pass through as the same object, which is what keeps an adapter's
  `status !== 404 → env.ASSETS.fetch(request)` fallthrough serving the very bundle
  the document now references.

  Per-route `<head>` lands with it: the matched route's compiled `head` is lowered
  through the same `routeHeadToSsrHead` + `applyHeadToHtml` pair the SSG and
  client-navigation paths use, folded under `app.head` and resolved against
  `site.url`. It is memoised per route pattern, so the per-request cost is a map
  lookup.

  **`app.outletId` is new, and it fixes a latent SSG bug.** `runPrerender`
  hardcoded `const outletId = 'outlet'` while its splice already took the id as a
  parameter — and `AihuConfig` had no `outletId` key at all, so the only way to
  move the outlet was `createApp({ outletId })` in a hand-written `src/main.ts`,
  which the prerender never sees. Any project that did so got a client mounting
  one element and a prerender splicing another: every prerendered page shipped
  with its content dropped, silently. `app.outletId` is now read by the prerender,
  by the SSR splice, and by the virtual client entry (`createApp({ outletId })`),
  so one value drives all three. It is verified on a NON-DEFAULT value in both
  paths — against the default, hardcoding and resolving are indistinguishable.

  A splice that finds no matching element now says so instead of returning the
  template unchanged, on both paths. That silence is how the bug above survived.

  A missing client `index.html` FAILS the `ssr` build rather than degrading. The
  degraded outcome is a green build, a successful deploy and a site that never
  hydrates — the exact defect this change removes.

- [#779](https://github.com/fellwork/aihu/pull/779) [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Compose layouts on the live SSR path, by the same rule the prerender uses.

  `createServerRouter` had zero layout handling. The SSG prerender composed a
  route's layout around its page; live SSR served the page bare. So an app that
  looked correct prerendered lost its entire shell — nav, footer, grid — the
  moment the same route was served from a Worker, silently.

  `ServerRouterOptions.layouts` takes a resolved name → module map (built at
  module init by `virtual:aihu-server-entry` from `virtual:aihu-layouts`), and
  `handle` composes it on BOTH the governed and ungoverned arms, with the same
  fallback ladder the prerender has: a missing layout, a layout with no renderable
  default, a layout with no `data-aihu-outlet` marker, or a layout that throws
  each warn once and serve the bare page.

  The outlet splice itself is not reimplemented. It moved out of `@aihu/app`'s
  `prerender.ts` into `@aihu/server` as `injectIntoOutlet`, and both paths call
  it — including its protection against `$&`/`` $` ``/`$'`/`$n` expanding as
  replacement backreferences when page prose contains them.

  `genSC` (`virtual:aihu-server-components`) now roots its reachability walk at
  the LAYOUTS as well as the pages. Without that, every component a layout
  references — which is where a site's nav, header and footer live — was left out
  of the server bundle and rendered as an empty element on every route.

  Two compiler-facing corrections were required to make that real, both found by
  the Workers-SSR e2e gate against an actual `vite build` and neither visible to a
  unit test:

  - The child-tag derivation `@aihu/app` injects into the router now compiles a
    layout in LAYOUT MODE (`_isLayoutFile` + `_layoutTag`, the same pair the
    compiler plugin's own transform uses). Compiling one as an ordinary component
    derives its tag from the file stem, so the common `src/layouts/app.aihu`
    failed the whole build with C450 — `'app'` cannot register as a custom
    element.
  - Layouts derive their edges from the `// @aihu:component-tags` marker rather
    than from `__aihu_schild` call sites. On the server target a compiled page
    exports `__ssr` and `__ssrString`; a compiled LAYOUT exports `__ssr` only, and
    the call sites live exclusively in `__ssrString` — so the call-site derivation
    returns `[]` for every layout. A layout renders through the walker, which
    resolves registry children by tag on its own, so the template-reference set is
    the correct one there. It is the strictly larger set, which can bundle a
    module for a reference the walker declines; that trade is documented at the
    call site and ends when the compiler emits `__ssrString` for layouts.

  An empty-string `layout` is treated as no layout, matching the client renderer's
  existing convention — `compileRouteMeta` emits `layout: ""` for every page that
  declares none, so an `undefined`-only check warned about a layout nobody wrote
  on the most common route shape there is.

  Omitting `layouts` leaves `handle` byte-identical to before.

- [#779](https://github.com/fellwork/aihu/pull/779) [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Thread the host runtime's per-request platform context into live SSR.

  `ServerRouter.handle(req)` took a `Request` and nothing else, so a Cloudflare
  Worker's `env` — the KV namespaces, D1 databases, R2 buckets, Durable Object
  stubs and secrets — was unreachable from a page render. Those values exist ONLY
  per request; there is no module-scope handle a loader could have closed over, so
  a route loader on a Worker had exactly one data source: the public internet.

  `handle(req, platform?)` now forwards an opaque, adapter-supplied value to every
  consumer that can act on it:

  - plain route loaders, as a second argument `{ request, url, platform }` (which
    also gives a loader the request and query string for the first time)
  - the governed provider's `fetch` and `preview`
  - the live entitlement resolver (`EntitlementContext.platform`)
  - the host-verified session resolver (`GovernedRequestAuth.resolveSession`)
  - the E3 `/__aihu/data/*` transport, so it and SSR still reach the same sources

  The framework never reads inside the value, and its type is `unknown` — an
  augmentable interface with an index signature was rejected because TypeScript
  gives interfaces no implicit index signature, so `wrangler types`' generated
  `interface Env` would not have been assignable. `@aihu/adapter-cloudflare`
  passes `{ env, ctx }`, so both bindings and `waitUntil` are reachable.

  `handle(req)` with no platform is unchanged: every consumer receives no
  `platform` key at all, which is the state they were already in.

- [#779](https://github.com/fellwork/aihu/pull/779) [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88) Thanks [@srmcguirt](https://github.com/srmcguirt)! - `output: 'ssr'` — a Workers-deployable server bundle that actually renders.

  [#778](https://github.com/fellwork/aihu/issues/778) made SSR child rendering correct. It did not make it shippable: the only
  verified consumer was the SSG prerender. This closes that gap.

  **The crux.** Generated server code does not need to be _emitted_ — it needs to
  be a virtual module that is an SSR-environment **build input**. `@aihu/app` now
  declares a second Vite environment under `output: 'ssr'` whose entry is
  `virtual:aihu-server-entry`, so `import routes from 'virtual:aihu-routes'`
  inside it resolves to REAL chunks, `.aihu` files compile to the server target
  with no config (`aihuCompilerPlugin` reads
  `this.environment.config.consumer === 'server'`), and one `vite build` produces
  both environments. A built `dist-server/_worker.js` server-renders two levels of
  child nesting, verified against a stubbed `ASSETS` binding in CI.

  Load-bearing and non-obvious: a `virtual:` id works as a build entry ONLY via
  `rollupOptions.input`. `build.ssr: 'virtual:…'` fails `[UNRESOLVED_ENTRY]`.

  **`@aihu/app`**

  - `OutputMode` gains `'ssr'`. `@aihu/server`'s `RenderingMode` is a different
    axis — a client hydration hint whose only real consumer is `client.ts` — and
    is deliberately not the knob here.
  - **`output: 'ssr'` REQUIRES `css.shadowMode`, as a build error naming the key.**
    Without it a leaf component exports no `__aihu_shadow__`, `buildChildRegistry`
    refuses it, and every child renders as an empty element — indistinguishable
    from a broken registry, which is the precise failure this whole effort exists
    to remove. `apps/docs` setting `shadowMode: 'light'` is the only reason SSG
    never hit it.
  - `AihuAdapter.serverEntry?(ctx)` contributes the platform wrapper INTO the
    virtual entry. `AdapterContext.createHandlerSource` is deprecated: its output
    is written after the build, outside the module graph, so every route it wires
    404s by construction.
  - **D-1** — a `node:module` stub (`enforce: 'pre'`, or Vite's resolver wins)
    keeps the builtin out of the Worker bundle. It arrives via `@aihu/server`'s
    lazy `import('./native.js')`, is unreachable at runtime (the loader
    short-circuits to the TS walker whenever `children` is passed), but is still
    uploaded and fails on workerd without `nodejs_compat`.
    The stub ships as its OWN artifact, `dist/node-module-stub.js`, rather than as
    source text inside a `load` hook. Its export name is fixed by the binding
    `native.js` imports, so inlining it put that identifier into `dist/index.js`
    as inert string data that `check:runtime-purity`'s token scan cannot tell from
    a real symbol. The fix is a declared boundary artifact — the same shape the
    guard already uses for `@aihu/server`'s `dist/native.js` — checked under its
    own `builtin-stub` tier (no quoted `node:` specifier of any kind), not an
    exception that would blind the guard to a real leak elsewhere in the plugin.
  - **D-2** — the SSR environment writes to a SIBLING of the client outDir
    (`dist` → `dist-server`). Cloudflare's ASSETS binding serves the client outDir
    verbatim; SSR chunks written there are downloadable server code.
  - `closeBundle` fires once per environment, and `aihu-adapter` / `aihu-ssg` had
    no guard — both would have run twice. Now client-only, with an absent
    `environment` treated as the single-environment case so an older Vite is not
    silently left without an adapter. `apps/docs`' `output: 'static'` build is
    byte-identical across all 290 emitted files.

  **`@aihu/router`** — `virtual:aihu-server-components` (`genSC`): a FLAT
  tag→loader map, because the consumer is `buildChildRegistry`, which indexes
  tag→MODULE and cannot use `genC`'s transitive `Promise.all` bundle. It carries
  only the subgraph REACHABLE from the pages, walked over `__aihu_child_tags__`
  render edges. Measured on a fixture separating the sets: every-component
  bundles 4 modules, the source regex 3, render edges **2** — the regex pulls in
  an attribute-bearing reference the emitter DECLINES, which `__aihu_schild` can
  never look up and which renders empty either way.

  Accepted trade, written into `genSC`'s docblock: a pruned registry loses
  `buildChildRegistry`'s global cycle view. Correct for a Worker (the report is
  advisory, `__aihu_schild` is depth- and budget-bounded, and an unreachable cycle
  cannot affect a response); SSG still loads everything and keeps the global check.

  **`@aihu/compiler`** — `_deriveChildTags` is exported so the compiler's
  transform and the router's `genSC` share ONE derivation instead of adding a
  fourth. The `__aihu_referenced_tags__` docblock already argues that deriving the
  runtime edge set twice would be "one rule written in two places"; that does not
  stop applying because the second site is in another package.

  **`@aihu/adapter-cloudflare`** — implements `serverEntry`, and under
  `output: 'ssr'` stops emitting `_worker.js` into the client outDir entirely
  (the build's own `dist-server/_worker.js` is the worker). Its generated
  `wrangler.toml` points `main` at the server bundle and `[assets] directory` at
  the client dir only. Its docblock's claim that the 404 placeholders were caused
  by "a non-serializable `module()` thunk" is corrected: `fileToRouteDefinition`
  builds `module: () => Promise.resolve({ default: null })`, so there was never a
  loadable module and no adapter-side fix was possible.

  **Not in scope, named so it is not mistaken for done.** `@aihu/adapter-vercel`
  still uses the string-emission shape and does not gain `serverEntry`. Layouts
  are not composed under live SSR — `createServerRouter` has no layout handling at
  all (SSG composes them); this is a real, separate gap. Worker bindings (`env`)
  are not threaded into a page render, because `ServerRouter.handle` takes a
  `Request` and nothing else.

### Patch Changes

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix two `js/polynomial-redos` (CWE-1333) alerts in `applyHeadToHtml`
  (`packages/app/src/head-apply.ts`), surfaced by a fresh CodeQL pass during a
  full-diff release review. `applyHeadToHtml` runs at build/prerender time
  against the build's own `index.html` template — attacker-reachable the same
  way `.aihu` source is elsewhere in this repo's threat model (an untrusted PR
  can commit its own template), and per this file's own "build-time only" note,
  a slow build IS the DoS here, not a runtime one.

  **`<title>` matching** — `/<title[^>]*>[\s\S]*?<\/title>/i` re-ran its lazy
  `</title>` scan from EVERY `<title` occurrence in the string when none of
  them actually closed. A first attempt split this into two regex-based scans
  (an open-tag `/<title[^>]*>/i.exec` followed by a `</title>` search over the
  remainder) — that closed the combined pattern's lazy-suffix half, but a
  second CodeQL pass correctly re-flagged the open-tag half on its own: with no
  `>` anywhere in the string, `.exec` (no `g` flag) still retries at every
  `<title` occurrence, each retry re-scanning the remainder — confirmed by
  direct timing (11ms → 61ms → 237ms at 2k/5k/10k occurrences, quadratic).
  Replaced with the same `indexOf`-based technique as the canonical-link fix
  below: no regex for the tag boundary at all, so there is nothing left to
  retry-and-rescan. Confirmed linear: 0.5ms at 100,000 occurrences.

  **Canonical `<link>` matching** — `/<link\s+[^>]*rel="canonical"[^>]*>/i` had
  two separate defects, both measured directly. The `\s+[^>]*` boundary let a
  long whitespace run split ambiguously between the two adjacent quantifiers.
  Worse, and the one that mattered: a string containing many repetitions of the
  literal prefix `<link rel="canonical"` with no closing `>` anywhere took the
  original regex ~2.4s to fail at 1,000 repetitions and ~22.9s at 2,000 — worse
  than quadratic. A first attempt at a fix (enumerating `<link ...>` tags via
  `/<link\b[^>]*>/gi` and checking each with a plain substring search) closed
  the worst failure mode but was still measurably O(n²) on the same adversarial
  shape, because the regex's own unbounded `[^>]*` re-scans the remaining
  string from every `<link` position before concluding there's no `>`. Replaced
  with a manual `indexOf`-based scan instead: no regex for the tag boundary at
  all, `searchFrom` only ever advances, and if a tag's own `>` is never found
  the function returns immediately rather than retrying at the next `<link` —
  confirmed via direct timing to stay under 1.1ms at 100,000 repetitions of the
  adversarial prefix (was multiple seconds, unmeasurable, at 2,000).

  Both preserve exact prior matching behavior, including quirks: case-
  insensitivity on tag names and the `rel="canonical"` literal, and — verified
  this is what the ORIGINAL regex also did, not a new gap — matching on the raw
  literal substring `rel="canonical"` anywhere within a `<link ...>` tag's text
  rather than parsing real attribute boundaries. Regression suite in
  `head-apply-redos.test.ts` (15 tests): behavior-preservation cases for both
  matchers plus adversarial-timing proofs for every distinct ambiguity shape,
  mutation-tested against both the original patterns AND the intermediate
  regex-based fixes (each reintroduction reproduces its own blowup — the
  title open-tag case measurably at 951ms against a 250ms budget, the link
  case by hanging past a 30s hard kill).

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix three defects in the generated Cloudflare deploy config, each of which
  produced a broken or silently-degraded deployment from a green build.

  **1. `main` was hardcoded while the SSR output directory is configurable.**
  `generateWranglerToml` wrote the literal `main = "dist-server/_worker.js"`, and
  the comment above it asserted a "sibling `dist-server/`" as though that were
  fixed. It has not been since `ssrOutDirFor` existed: `@aihu/app` derives the SSR
  outDir from the client `build.outDir`, so a project configuring
  `outDir: 'build'` gets its worker emitted at `build-server/_worker.js` while
  wrangler was pointed at a path the build never wrote. `wrangler deploy` fails to
  find its entry point. `[assets] directory` was already parameterized from the
  same input — `main` was the half that was not.

  `ssrOutDirFor` is now exported from `@aihu/app` and called by the adapter, so
  there is one derivation rather than two. A test pins the adapter's answer
  against the framework's own function across four outDir shapes rather than
  against a second copy of the rule.

  **2. The Worker was never invoked for `/`.** Cloudflare's Workers Assets routing
  serves a matching static asset _before_ running the Worker —
  `assets.run_worker_first` defaults to `false` — and `html_handling` (default
  `auto-trailing-slash`) maps `/` to `index.html`, which the SSR build writes into
  the very directory `[assets] directory` points at. So an `output: 'ssr'` site
  served the **empty SPA shell** for its home page and never server-rendered it.
  The adapter's documented route priority (handler → ASSETS → index.html) was not
  what was deployed.

  Generated SSR configs now set `run_worker_first = true`, with a comment in the
  emitted file explaining why. `true` rather than a path list because SSR routes
  are dynamic and known only to the router; unmatched paths still reach ASSETS via
  the wrapper's existing 404 fallthrough. SPA mode deliberately does **not** set
  it — there, serving the asset first is the entire point.

  _Verification:_ checked against Cloudflare's live documentation on 2026-08-08
  (`workers/static-assets/routing/worker-script/`, `.../advanced/html-handling/`,
  and `workers/wrangler/configuration/`). `run_worker_first` is the current,
  non-deprecated key, accepts `true|false` or an array of glob patterns, and
  defaults to `false`; `html_handling` defaults to `auto-trailing-slash`.

  **3. The SPA fallback was dead code and had never once run.** All three
  generated worker shapes wrapped the ASSETS call as
  `try { return await env.ASSETS.fetch(req) } catch { …serve /index.html… }`.
  `env.ASSETS.fetch` does not reject on a miss — it is documented as returning
  `Promise<Response>`, and an unmatched request comes back as a _Response_ whose
  status reflects `not_found_handling` (default `none`, a plain 404). The catch
  was therefore unreachable, and the client-side-routing fallback this adapter has
  advertised since it was written had never executed: a deep link to an SPA route
  returned Cloudflare's bare 404 instead of the shell that would have routed it.

  Now a status check, shared by all three shapes. Serving the shell for any 404
  matches Cloudflare's own `not_found_handling = "single-page-application"`
  semantics rather than inventing a narrower rule the platform does not have.
  Proven by _driving_ the emitted worker in a child Node process with an ASSETS
  stub that 404s exactly like the real binding — a string assertion would have
  passed against the dead catch as happily as against the fix.

  This whole branch of the adapter was previously **untested**: the only fixture
  exercising `output: 'ssr'` end to end passes `generateWrangler: false`, so
  nothing had ever read the file this adapter tells people to deploy with.

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix the dev server serving a blank page on every new scaffolded project.

  `injectEntryScript` wrote `<script type="module" src="virtual:aihu-entry">` —
  a bare specifier. A `<script src>` is resolved by the BROWSER as a URL, and
  `virtual:aihu-entry` parses as a URL with scheme `virtual`, which Chromium
  rejects outright ("Cross origin requests are only supported for protocol
  schemes: chrome, data, http, https"). Every `aihu dev` session failed silently
  on first load with a CORS error in the console and nothing on the page.

  Now emits `/virtual:aihu-entry` — a same-origin absolute path, Vite's own
  documented convention for referencing a virtual module from HTML. The plugin's
  `resolveId` accepts both the bare specifier (an `import` statement resolving
  through Vite's plugin container) and the leading-slash form (the browser's
  HTTP request for the injected `<script src>`, which Vite passes through
  verbatim rather than stripping the slash) — confirmed by a real `vite build()`
  in the test suite, which showed HTML's own transform pipeline hands
  `resolveId` the leading-slash form too, not only the browser dev-server path.

  Verified in-browser: before the fix, `aihu dev` on a fresh scaffold shows a
  CORS error and an empty page; after, zero console errors and full content
  (layout, page, child, grandchild all present).

- [#778](https://github.com/fellwork/aihu/pull/778) [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf) Thanks [@srmcguirt](https://github.com/srmcguirt)! - First batch of SSR child-rendering review follow-ups.

  A component reference cycle now WARNS instead of failing the build. The hard
  failure rejected ordinary recursive shapes — trees, nested menus, comment
  threads — because the tag set is derived from reference sites and cannot see a
  guard, and its stated justification (that a cycle would ship 32 nested copies)
  stopped being true once the renderer gained a depth cap and an output budget.
  `ChildCycleError` is replaced by a reported `ChildCycle`.

  Component discovery no longer follows symlinks out of the components directory
  (`readdir({recursive:true})` follows them under bun and not under Node, and
  every match is compiled and evaluated at build time), and no longer flattens
  nested paths when `parentPath` is absent.

  New build diagnostics for the silent-empty-render cases: a referenced tag the
  registry cannot supply, and a module exporting no `__aihu_tag__`.

  Prerender content is spliced with the function form of `String.replace`, so
  `` $` ``/`$&`/`$'` in page prose no longer re-splices the layout shell.

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Make a broken `app.outletId` a build error instead of a silent runtime
  divergence, and fix two real matching bugs in the outlet splice.

  `app.outletId` became real config in `609d0774` but was validated as a bare
  `v.string`, while the splice that consumes it (`injectIntoOutletId`, shared by
  the live SSR path and the SSG prerender) matched a narrower grammar than that
  string could express. Everything in the gap failed silently: the server spliced
  one place, the client's `getElementById` looked in another, and the only report
  was a single `console.error` — inside a Worker, which is the least-read place a
  framework can put anything.

  **The splice matched things that are not the id attribute.** `\bid="` puts a
  word boundary between the hyphen and the `i`, so `data-id="outlet"` matched —
  along with `aria-id`, `x-id`, and any other prefixed attribute — and the page
  content was spliced into the wrong element. The rule is now whitespace before
  `id=`, which is what actually separates an attribute from the tag name or its
  predecessor and which no prefixed attribute can satisfy.

  **And it missed things that are.** Only DOUBLE-quoted `id="…"` matched.
  `index.html` is authored by the _consumer_ — Vite requires one, and this repo's
  scaffold is only one of the ways it gets written — and vite passes its quoting
  through verbatim (verified: a built `index.html` still reads `id='app-root'`).
  So `id='outlet'`, an entirely ordinary document, spliced nothing. Both quotings
  are accepted now.

  Unquoted `id=outlet` is deliberately **not** accepted. It is legal HTML but
  effectively unwritten, and matching it would make any `id=<outletId>` sitting
  inside another attribute's _value_ a splice target — a false positive the quoted
  forms cannot produce, since a double-quoted value cannot contain a double quote.

  **Two new gates, so declining it is no longer silent.**

  `app.outletId` is validated against the HTML4 `ID` production
  (`/^[A-Za-z][A-Za-z0-9_:.-]*$/`). HTML5 relaxed this to "any non-empty string
  with no ASCII whitespace"; the older, narrower rule is chosen deliberately as
  the set that is safe in every place this one value travels to unescaped — a
  quoted attribute in the emitted template, a regex splice target,
  `document.getElementById`, and a `#id` CSS selector. Widening later is additive;
  narrowing later would break configs. `''`, `'a"b'` and `'my outlet'` all passed
  before and are now named config errors.

  And `virtual:aihu-ssr-document` — which already reads the finished client
  `index.html` and already hard-fails when it is absent — now also fails when the
  document contains no outlet the splice can match. Everything needed was already
  on hand at that point; checking there turns "green build, every page an empty
  shell until the client boots" into a named, pre-deploy failure. The gate is
  implemented by _asking the splice_ with empty content rather than by a second
  regex, so it cannot drift from the thing it gates — pinned by a test that
  asserts the two agree across six template shapes.

  Verified by real `vite build` runs in the workers-ssr e2e fixture: each
  malformed `outletId` shape is rejected before a file is emitted, an unquoted
  outlet fails with a message naming the quoting rule, and the existing
  non-default-outlet variant now uses single quotes end to end — which is what
  demonstrated the double-quote gap was reachable through a real build in the
  first place.

  One existing test fixture was internally inconsistent in exactly the way the new
  gate exists to catch (it configured `outletId: 'app-root'` against the default
  `id="outlet"` template) and has been corrected to the consistent pair it always
  meant to assert.

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix `output: 'ssr'` emitting a Worker that can never be loaded, by removing the
  module-scope top-level await from `virtual:aihu-server-entry`.

  The entry resolved both registries — the child-component registry and the
  layout registry — with `await` at module scope. That makes `_worker.js` an ESM
  **async module**, and vite/rollup hoists the shared runtime INTO the entry
  chunk, so the lazy component and layout chunks statically import back into
  `_worker.js`. Measured in a consumer-shaped tree on vite 6.4.3: **7 of 8 chunks
  carried that back-edge.**

  Async-module semantics then close the loop. The entry suspends at its top-level
  await; the dynamically imported chunk cannot finish evaluating until the entry's
  evaluation promise settles; and that settles only once the dynamic import
  resolves. `await import('./_worker.js')` never settles — node reports
  `Warning: Detected unsettled top-level await` and exits 13.

  The build was **GREEN**. The failure was at module load, i.e. on every request
  in production, on a Worker that had already been deployed.

  Both registries are now resolved lazily inside `__buildRouter()` and memoised
  behind a single init **promise**, awaited by `handler` before `handle()` is
  called. The memo holds the promise rather than the resolved router, and the
  check-and-assign pair is synchronous, so a cold burst of concurrent requests all
  await the same initialisation: `__buildRouter` runs exactly once, no module is
  loaded twice, and `createServerRouter`'s one-time boot validation is not
  replayed. The cost is one await, paid by whichever request arrives first on a
  cold isolate.

  The synchronous-render contract is unchanged. `ServerRouterOptions.children` is
  still a RESOLVED `Map`, because `__aihu_schild` still runs inside the compiled
  string fast path, which is still synchronous. Only the location of the awaiting
  moved — from module scope to the first request, still strictly before any render
  begins.

  **The static import cycle is still present after this change, and is harmless.**
  A cycle without a top-level await resolves normally, and the dynamic imports now
  happen during a request, long after the entry finished evaluating. That is the
  point: this removes the _necessary_ condition rather than the incidental one, so
  no future chunking decision can reintroduce the deadlock. `inlineDynamicImports`
  and a `manualChunks` shape that keeps the entry a leaf were both rejected for
  the opposite reason — they only tune where the cycle lands on today's bundler,
  and their failure mode is a green build that hangs on every production request.

  Chunking really is that unstable: the same fixture emits 9 chunks with zero
  back-edges on vite 8 before this change, and 8 chunks with 2 back-edges after
  it. Vite 8/rolldown was not immune, only lucky.

  `packages/app/tests/workers-ssr-e2e.test.ts` now imports every built worker
  **under a timeout**. Unbounded, that import HUNG against a deadlocked build —
  a hung CI job, not a red test — which is precisely why the defect was invisible
  to the gate that exists to catch it. It now fails with a message naming the
  deadlock and how to confirm it. Two evaluation-level unit tests were added
  alongside: one asserts that module evaluation touches neither registry (no
  top-level await), the other that five concurrent first requests share one init.

  `output: 'spa'` and `output: 'static'` are untouched — verified byte-identical
  output before and after.

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Give the `output: 'ssr'` request path an error boundary, and make the server
  child/layout registries degrade per entry instead of all-or-nothing. Both are
  the same failure shape — a rejected promise where an HTTP response should be —
  and either one alone leaves the other's outage intact.

  **Nothing on the render chain caught anything.** Neither
  `@aihu/router/server`'s `handle()`, nor the generated `handler` in
  `virtual:aihu-server-entry`, nor `@aihu/adapter-cloudflare`'s `fetch` wrapper
  wrapped `route.module()`, `mod.loader()` or `renderToString` in a try/catch. A
  throw anywhere on that chain therefore rejected the Worker's `fetch` promise,
  and Cloudflare answers a rejected fetch with **error 1101: no status, no body,
  no response at all** — not a 500. Nothing a browser, a monitor or a
  `wrangler tail` can act on.

  This was known and documented rather than fixed. `workers-ssr-e2e.test.ts`
  assertion 17 already recorded measuring it ("the throw propagates out of the
  fetch handler and the request gets NO RESPONSE") and closed the one _cause_ it
  had in front of it — a DOM access in a setup body — leaving the missing
  boundary open for every other cause.

  **Reproduced against a real built Worker, then fixed.** A new fixture page
  throws from its `@state` block, i.e. from inside `renderToString`, the deepest
  point on the chain. Before: `Error: E2E-BOOM` thrown out of `mod.default.fetch`
  — `fetchThrough` itself rejected. After: `500` `text/plain`
  `Internal Server Error`.

  **The boundary is in the generated `handler`, and the layer was chosen, not
  defaulted.** Three could hold it:

  | layer                              | why not                                                                                                                                                                                           |
  | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `handle()` (`@aihu/router/server`) | a runtime library a consumer wires by hand; callers legitimately want the throw. Also insufficient — `__getRouter()` and the document wrapper sit outside it and both can throw                   |
  | an adapter's `fetch` wrapper       | per-adapter. Cloudflare, Vercel and every community adapter need their own copy, and an `output: 'ssr'` build with **no** adapter falls back to the bare `handler` export with no boundary at all |
  | the generated `handler`            | the one place every `output: 'ssr'` build passes through, directly beneath the platform entry point                                                                                               |

  Two details are load-bearing. The response is `text/plain`, which is what
  `createSsrDocument`'s `isHtml` gate passes through unwrapped — an HTML 500 would
  be spliced into the client template and served as a document. And it is a `500`,
  not a `404`, so the Cloudflare wrapper's ASSETS fallthrough does not mask a
  broken route with a `200` SPA shell. The body is generic and the error is
  logged, never served: a thrown value here can carry a query string, a binding
  name or a build-time filesystem path. `return await`, not `return` — a bare
  `return` of a promise resolves the try block before the promise settles and the
  rejection escapes.

  **The registries were all-or-nothing, and permanently sticky.** `__buildRouter`
  resolved both with `await Promise.all(…)` over `await load()`, so ONE component
  module that throws on import rejected the whole build — every other component
  lost with it. `__getRouter()` memoises the promise (correctly, for reasons its
  docblock gives), so the isolate then answered nothing to **every** request for
  its entire life. Compounded with the missing boundary: one 1101 per request
  until Cloudflare recycles it.

  `eca2ab46` fixed one specific _cause_ of a child import throwing
  (`@aihu/primitives` evaluating `class … extends HTMLElement` at module scope).
  A different module throwing for a different reason still took everything down.

  Both loops now catch per entry: a failing component or layout logs a named
  warning and is SKIPPED, matching `__aihu_schild`'s established degrade-to-empty
  posture for a child it cannot render, and `withLayout`'s for a layout not in the
  map. Verified with a new `poison` build variant that injects one unloadable
  entry into each registry while leaving every real one intact. Before:
  `fetchThrough` rejected with `E2E-POISON…` and nothing rendered. After: `200`
  with every real component and the layout composed, the poisoned pair the only
  thing missing.

  The sticky rejection is deliberately unchanged, and is now _more_ clearly
  correct: with per-entry catches the only things that can still reject are
  `buildChildRegistry` and `createServerRouter`'s boot validation — pure functions
  of the build, which genuinely cannot succeed on a retry. And a sticky rejection
  is no longer a dropped request, because `handler` catches it.

  Pinned by 10 new assertions in `workers-ssr-e2e.test.ts` against real
  `vite build` output, including that the 500 leaks neither message nor stack,
  that it is not re-served from ASSETS, and that one throwing route does not
  poison the isolate for the others.

- [#778](https://github.com/fellwork/aihu/pull/778) [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Reconcile the SSR child-eligibility boundaries between the two renderers.

  Whether a component reference is eligible for server rendering was decided in
  two places — the Rust emitter on the raw template AST, the TypeScript walker on
  the lowered arbor node — and their eligible sets differed, so one renderer
  filled a child in while the other emitted an empty element.

  The lowering is lossy: `<x-kid>`, `<x-kid show={on()}>`, `<x-kid ref={el}>`,
  `<x-kid raw><b>s</b></x-kid>` and a multi-line `<x-kid>\n</x-kid>` all reach the
  walker as the same node, so the walker cannot decline on information it does not
  have. Those cases are reconciled by having the emitter resolve them; the lowered
  tree is byte-identical to the plain reference already resolved and shipped.

  Also fixes a divergence introduced by the previous `{#each}` fix: a reference
  merely nested inside a conditional (`<div if={ready}><site-header></div>`)
  resolved on the compiled path and declined on the walker, because the
  static-path check tested "all digits" as a proxy for compile-time literalness
  and `conditional.true` fails it. The check now tests literalness exactly.

  32 differential fixtures added, one per boundary line, each asserting both
  renderers agree AND which way — "both empty" satisfies byte-identity while
  shipping the bug.

  Component discovery loads in parallel, warns about a failed component only when
  something references it, and no longer follows symlinks out of the components
  directory.

- Updated dependencies [[`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`0774261`](https://github.com/fellwork/aihu/commit/0774261509469b96093ebbbdcbeeeb3c2f200466), [`ac3affc`](https://github.com/fellwork/aihu/commit/ac3affc4cb27bae5af0ebbf84c1fd70b800d9ac8), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`788319c`](https://github.com/fellwork/aihu/commit/788319ca907d9a34ec83c7af655436555a42b4c0), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88), [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88), [`ff58a1b`](https://github.com/fellwork/aihu/commit/ff58a1b8d9018f0198aa8879c359e90133266b2f), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88), [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88)]:
  - @aihu/server@0.6.0
  - @aihu/runtime@6.1.0
  - @aihu/arbor@4.1.1
  - @aihu/router@0.5.0

## 9.0.0

### Minor Changes

- [#762](https://github.com/fellwork/aihu/pull/762) [`ac9c045`](https://github.com/fellwork/aihu/commit/ac9c04599b2fbf57c9f39a39e1c9db7fe1388028) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Adopt the server-rendered DOM on first render instead of rebuilding it.

  Prerendering used to buy first paint and crawlability but zero client work: the
  client discarded the entire server-rendered subtree and rebuilt it. Measured on
  apps/docs by tagging every prerendered node before hydration and counting
  survivors — **0 of 393**. It is now **320 of 393**, with no duplication (total
  node count identical to a pure client render) and Lighthouse unchanged at
  perf 100 / LCP 1480ms.

  **BREAKING (`@aihu/runtime`):** `DefineOptions.hydrate` is removed. It gated a
  hydration branch in `define-element.ts` that nothing in production ever set —
  the compiler never emitted it — and that branch bypassed `defineComponent`'s
  connect path entirely, so `onMount` never ran under hydration. Rather than
  enable a lifecycle-skipping bypass, the fork is deleted: `defineComponent`'s
  `connectedCallback` is now the single connect path and chooses its renderer
  (`_adoptSsrTemplate` vs `_mount`). Everything downstream — `onMount`, slot
  projection, scope registration, teardown — is byte-identical, so the lifecycle
  cannot drift again.

  The adoptable boundary is server-declared, not client-guessed:
  `renderToString({ wrapTag, hydratable })` stamps `data-aihu-ssr` on the host it
  wraps, meaning "these children are this host's own rendered template". That
  resolves an ambiguity `data-aihu-path` could not — slotted content from a
  parent's server render carries paths too, but its receiving host is never
  marked.

  Three latent bugs surfaced only once adoption ran, and are fixed here: arbor's
  `hydrate()` pathMap collided across nested wrapped renders (the page overwrote
  the layout's root key); `hydrate()` never assigned `branch.el`, silently
  no-op'ing `class:`/`html={}` effects on adopted trees; and the compiler wrapped
  enhanced `<a>` multi-children in a fragment the server never renders,
  duplicating every prerendered link's children.

  Remaining ceiling: structural `each`/`if` segments still use arbor's
  adopt-by-replace, which is why 73 nodes do not survive.

### Patch Changes

- [#762](https://github.com/fellwork/aihu/pull/762) [`ac9c045`](https://github.com/fellwork/aihu/commit/ac9c04599b2fbf57c9f39a39e1c9db7fe1388028) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Move `hydrate` to its own subpath export, `@aihu/arbor/hydrate`.

  The size row measures `dist/index.js`'s whole entry graph, so every consumer
  paid for the hydration walker whether or not it could run — including
  `@aihu/app`'s `spa` mode, whose own comment says it "skips `_setHydrate` — no
  SSR HTML to hydrate". Splitting drops the main entry from 4005 B to 2671 B gz.

  **Migration:** `import { hydrate } from '@aihu/arbor'` becomes
  `import { hydrate } from '@aihu/arbor/hydrate'`. Everything else on the main
  entry is unchanged, which is why this is minor rather than major — but the
  named export did move.

  Two things the split broke and this fixes:

  - `scripts/mangle-dist.mjs` only rewrote `dist/index.js`. A second entry makes
    rolldown hoist shared code into a `mount-<hash>.js` chunk, so property
    mangling silently stopped applying (`appendedNodes`, `disposers` came back
    unmangled) while index.js — now a 344 B re-export shim — matched nothing.
    It globs `dist/*.js` now, so adding an entry can never quietly disable it.

  - `@aihu/app` did not externalise the new subpath. Rolldown's `external`
    matches exact specifiers, so listing `@aihu/arbor` alone let the entire
    walker inline into client.js (4.8 kB → 13.2 kB). Same failure shape as
    `@aihu/context/ssr` and `@aihu/signals/lifecycle`.

  `@aihu/app`'s client also drops below its budget again (30 B over → 29 B
  headroom) through four changes that are each a readability win on their own:
  `Array.from` removed from a static NodeList walk; three near-identical
  meta/link/script upsert blocks folded into one helper; three copies of the
  route-param loop folded into `stampParams`; and `tagName.toLowerCase()`
  replaced with `localName`. The author-facing "layout has no `<outlet>`"
  warning is now `__DEV__`-gated the way arbor gates telemetry — the recovery
  path is not gated, so production still renders.

  The `@aihu/app` size row was also counting `@aihu/store` (a declared peer, like
  every other ignored entry) and `virtual:aihu-components` (a router virtual,
  like the two already listed). Both omissions were oversights.

- Updated dependencies [[`ac9c045`](https://github.com/fellwork/aihu/commit/ac9c04599b2fbf57c9f39a39e1c9db7fe1388028), [`ac9c045`](https://github.com/fellwork/aihu/commit/ac9c04599b2fbf57c9f39a39e1c9db7fe1388028), [`ac9c045`](https://github.com/fellwork/aihu/commit/ac9c04599b2fbf57c9f39a39e1c9db7fe1388028)]:
  - @aihu/arbor@4.1.0
  - @aihu/runtime@6.0.0
  - @aihu/server@0.5.0
  - @aihu/router@0.4.4

## 8.1.0

### Minor Changes

- [#719](https://github.com/fellwork/aihu/pull/719) [`c972073`](https://github.com/fellwork/aihu/commit/c972073efcd9ad94e89923432b435ea1e8de0ffa) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Eliminate the need for a scaffolded `src/main.ts` in the common case, and fix a real typecheck/build divergence uncovered along the way.

  - `@aihu/app`: `viteAihuPlugin()` gained an `aihu-entry` sub-plugin
    (`packages/app/src/entry.ts`) that serves `virtual:aihu-entry` — a
    byte-identical stand-in for the old boilerplate `src/main.ts`
    (`import { createApp } from '@aihu/app/client'; createApp()`) — and
    injects its `<script>` tag into `index.html` whenever no real
    `src/main.ts` exists on disk. A project that needs `createApp(options)`
    (`provide`, `outletId`, a non-default `head`) still writes a real
    `src/main.ts`, which makes the virtual entry step aside entirely (full
    eject, not a partial override — mirrors how framework-owned client entries
    work elsewhere, and keeps `provide` where comparable frameworks keep it:
    code, not declarative config, since it holds live values that can't be
    serialized into generated source).
  - `@aihu/cli`: `appMainTs`/`appIndexHtml` (the `minimal`/`docs` templates)
    stop emitting `src/main.ts` and its `<script>` tag — the virtual entry
    above covers it. `AGENTS.md`'s generated project-map table updated to
    match.
  - `@aihu/compiler`: `compileSidecar()` gained a `target` option
    (`'client' | 'server' | 'universal'`), mirroring what `transform()` already
    passes as `--target`. Previously the sidecar (the type-check surface
    `aihu-tsc` and the language server hand to TypeScript) always compiled
    against the binary's `universal` default regardless of what a project's
    `vite.config.ts` actually configured — a real divergence, since `--target`
    changes what the sidecar is derived from (e.g. a `target: 'client'` build
    elides server-only artifacts). `islands`/`shadowMode` are deliberately NOT
    added here: both are JS-side post-processing on the runtime JS output only
    and have no bearing on the sidecar's types.
  - `@aihu/tsc`: `run()`/`aihu-tsc` now read `AihuConfig.compiler.target` and
    `AihuConfig.typecheck.strictTemplates` from the project's `vite.config.ts`
    (new `loadTscProjectConfig()`, invoked from `bin/aihu-tsc.mjs` since
    `run()` itself stays synchronous) and thread `target` into `compileSidecar`
    — closing the gap above for the common `"typecheck": "aihu-tsc"` scaffold
    script, which is invoked with no flags and had no other way to see that
    config.
  - `@aihu/language-server`: reads the same `compiler.target` from the
    workspace root (best-effort — a client that gives no workspace root, or a
    project with no `vite.config.ts`, behaves exactly as before), so editor
    diagnostics match `aihu-tsc`'s and CI's.

## 8.0.1

### Patch Changes

- [#715](https://github.com/fellwork/aihu/pull/715) [`9bba4bb`](https://github.com/fellwork/aihu/commit/9bba4bbf177bcd266502ab9181e91478f1710704) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix ReDoS-vulnerable regex patterns and a prototype-pollution gap found by CodeQL code scanning.

  - `@aihu/app`: `applyHeadConfig`'s `<meta>`-tag matching no longer uses a
    `\s+[^>]*attr...[^>]*` nested-quantifier regex over the whole `index.html`
    string (catastrophic backtracking on pathological/repetitive input) — it
    now scans tag boundaries with one unambiguous pass, then tests the
    attribute within just that bounded tag.
  - `@aihu/router`: the file-router's segment builder no longer strips a
    route's extension with a `\.[^/]+$/`-anchored regex (same backtracking
    class) — a plain `lastIndexOf`-based split instead.
  - `@aihu/compiler`: `_isLayoutFile`'s trailing-slash trim no longer uses a
    `\/+$/`-anchored regex — measured 45s on a 200k-character pathological
    input before the fix, sub-millisecond after. The state-wrapper codemod
    (`migrate.ts`/`verify.ts`) also now fully escapes identifiers before
    embedding them into `RegExp` constructors (previously escaped only `$`).
  - `@aihu/cli`: the `full` template's scaffolded `server.ts` had the same
    trailing-slash ReDoS shape in a generated string — fixed so scaffolded
    apps don't inherit it.
  - `@aihu/magna`: `setBuildFlag` (a public function accepting an arbitrary
    dot-notation key) now rejects `__proto__`/`constructor`/`prototype`
    segments, closing a prototype-pollution gap in its public contract.

- Updated dependencies [[`9bba4bb`](https://github.com/fellwork/aihu/commit/9bba4bbf177bcd266502ab9181e91478f1710704)]:
  - @aihu/router@0.4.3

## 8.0.0

### Patch Changes

- Updated dependencies [[`19af14c`](https://github.com/fellwork/aihu/commit/19af14c0989fcae8eed344c119ba91894e13c776)]:
  - @aihu/runtime@5.1.0

## 7.1.0

### Minor Changes

- [#609](https://github.com/fellwork/aihu/pull/609) [`bef4c66`](https://github.com/fellwork/aihu/commit/bef4c66fb59c8d9224d131e158106713cdb0da05) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Config lives in `vite.config.ts`; the CLI reads it from there

  The scaffold no longer emits a separate `aihu.config.ts`. Everything aihu is
  configured with goes inline on `viteAihuPlugin({...})` in `vite.config.ts`, and
  non-Vite consumers read it back from there.

  A second config file is justified exactly as long as something other than Vite
  needs the config and cannot parse the Vite config. That was SvelteKit's stated
  reason for `svelte.config.js` in 2022 — the language server had to know your
  preprocessors and does not run Vite. SvelteKit then removed the reason rather
  than living with it: once the language server could read `vite.config.js`, the
  second file became optional, and SvelteKit 3 makes the Vite config the required
  location.

  **New in `@aihu/app`:**

  - `viteAihuPlugin()` registers an `aihu:config` marker plugin carrying the
    evaluated config on a public `api` handle.
  - `loadAihuConfig(root)` reads it back through Vite's own `loadConfigFromFile`
    — no build. Returns the config, its source path, Vite's dependency list, and
    every registered aihu module's options.
  - `declareAihuModule()` + `collectAihuModules()`: the contract by which any
    package becomes readable by the CLI and the language server without a central
    registry to update.
  - `viteAihuPlugin()` now validates its inline argument. Only `defineConfig` did
    before, so the path every example uses was unvalidated. Unknown keys throw
    with a keypath and a did-you-mean.
  - New options that previously required abandoning `viteAihuPlugin` and wiring
    the underlying plugin by hand: `dir.components`, `compiler.islands`,
    `compiler.target`, `build.bundler`, `dev.*`, `typecheck.*`.

  **In `@aihu/cli`:** `aihu build` and `aihu dev` each had a private loader that
  dynamic-imported `aihu.config.ts` with its own local interface. They now share
  one loader that prefers `vite.config.ts` and falls back to `aihu.config.ts`, so
  existing projects keep working.

  **Also:** the scaffolded config declares no MCP `endpoint`. The previous one
  pointed `endpoint` at the server card's own URL, publishing a card that
  advertised zero tools and named the discovery document as its own transport.
  A static client build has no process to serve MCP, so no card is emitted.

## 7.0.0

### Patch Changes

- Updated dependencies [[`2f24fa3`](https://github.com/fellwork/aihu/commit/2f24fa3fdc592c85e39f500a48a7e4d3ff67c86d), [`a993aa1`](https://github.com/fellwork/aihu/commit/a993aa19d402c221faa463dfb5d94c86cc87b670), [`3790c91`](https://github.com/fellwork/aihu/commit/3790c91331fa7ecb15649213a66c83078e63dafe), [`edc15f2`](https://github.com/fellwork/aihu/commit/edc15f2a2de541fa8f7ffd6266ad984446206257), [`ad6921a`](https://github.com/fellwork/aihu/commit/ad6921a018ef4a479f6540278e549aa9a8cab387), [`51451a4`](https://github.com/fellwork/aihu/commit/51451a47fee517c922d203951baf6442fe806115), [`2ea4a8f`](https://github.com/fellwork/aihu/commit/2ea4a8f4197b5d2f4bf07b122f2e9653508ecf42)]:
  - @aihu/arbor@4.0.0
  - @aihu/runtime@5.0.0
  - @aihu/signals@0.5.0
  - @aihu/router@0.4.2
  - @aihu/server@0.4.1
  - @aihu/store@0.1.2

## 6.0.0

### Patch Changes

- Updated dependencies [[`2ef2830`](https://github.com/fellwork/aihu/commit/2ef2830aa737906d09a5d870176da34a22f20b99), [`8924c51`](https://github.com/fellwork/aihu/commit/8924c51da6e6c25fb2664a7ab6fe9c628895161d), [`18e5f6d`](https://github.com/fellwork/aihu/commit/18e5f6dda93772877690e88e8c217dcdcf4bddc2), [`27a3268`](https://github.com/fellwork/aihu/commit/27a326826ee9a4d0a9b46bf50ca31686543848fe), [`ea8d2eb`](https://github.com/fellwork/aihu/commit/ea8d2ebb91c28132f399a708e2bd88877072d1db), [`061eefb`](https://github.com/fellwork/aihu/commit/061eefb3e94fdbbe9e6f5d5301db3bcdd3fa3b22)]:
  - @aihu/server@0.4.0
  - @aihu/signals@0.4.0
  - @aihu/arbor@3.0.0
  - @aihu/runtime@4.0.0
  - @aihu/router@0.4.1
  - @aihu/store@0.1.1

## 5.0.0

### Major Changes

- [#479](https://github.com/fellwork/aihu/pull/479) [`9dd7654`](https://github.com/fellwork/aihu/commit/9dd7654678da1149705e21324f6b30e9baafcd4b) Thanks [@srmcguirt](https://github.com/srmcguirt)! - DA4 ([#437](https://github.com/fellwork/aihu/issues/437)): the binary shadow API (`'light' | 'shadow'`) and light-DOM-by-default pages — one breaking change.

  **The API.** `ShadowMode` collapsed to a BINARY `'light' | 'shadow'`; the
  `'open'`, `'closed'`, and `'none'` tokens are retired everywhere (the
  `$shadow` macro, the plugin-global `shadowMode` config /
  `css: { shadowMode }`, the runtime `defineElement` options, and the CLI
  `--shadow` flag). `'shadow'` attaches an OPEN root internally — open is the
  only browser mode aihu's composition/hydration can use; `'closed'` was
  self-contradictory (a closed root nulls `this.shadowRoot`, so light-DOM
  detection misclassified it and content rendered into the host anyway).
  `'light'` attaches no root, so `this.shadowRoot === null` is an unambiguous
  detection. Migration: `'open'` → `'shadow'`, `'none'` → `'light'`,
  `'closed'` → `'shadow'`.

  **The defaults.** Page-level components — those with an `@route` block — and
  layout SFCs (files under the configured layouts dir, default `src/layouts/`)
  now default to `'light'`, so server-rendered page content is reachable by
  crawlers and agents that do not execute JavaScript. Leaf components (no
  `@route`) default to `'shadow'` (behaviorally the old `'open'` default).

  Precedence, in order: a per-file `$shadow` pin > an explicit plugin-global
  `shadowMode` config > the page/layout default `'light'` > the leaf default
  `'shadow'`. An unpinned page carries a new `// @aihu:shadow-default light`
  marker (distinct from the `$shadow` pin marker) so the implicit default ranks
  below an explicit plugin-global config.

  Breaking implications:

  - Retired tokens fail loudly: `$shadow` with an old token is a C471 compile
    error; `css.shadowMode` with one throws at config validation; `--shadow`
    with one warns and falls back to the default.
  - A `$shadow`-less `@route` page's `@style` block now joins the global
    cascade instead of being trapped in a shadow root — scope bare element
    selectors under a page root class (see the migration guide §8).
  - W472 (the phase-1 advisory that announced this flip) is retired.
  - The static-island fast path is skipped for light-DOM components — the shim
    cannot honor `shadowMode: 'light'`; such components keep the full runtime
    path.
  - css-engine scaffolds now always emit an explicit `css: { shadowMode }`
    block carrying the wizard's `--shadow` choice (default `'shadow'`), since
    the page default would otherwise override it.

### Patch Changes

- Updated dependencies [[`9dd7654`](https://github.com/fellwork/aihu/commit/9dd7654678da1149705e21324f6b30e9baafcd4b), [`80531dc`](https://github.com/fellwork/aihu/commit/80531dcc4dfc43bc9cd399bbb8ab4520efb8f15a), [`bc0f289`](https://github.com/fellwork/aihu/commit/bc0f289ee38871cda8002e56fba3e3b8b7e34d84)]:
  - @aihu/runtime@3.0.0
  - @aihu/router@0.4.0
  - @aihu/server@0.3.0

## 4.0.0

### Minor Changes

- [#418](https://github.com/fellwork/aihu/pull/418) [`212e3e3`](https://github.com/fellwork/aihu/commit/212e3e38ae57de7e38c3211ef0223729ba1511e1) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Layout-scoped component registration (F2): a layout's own referenced components now get route-scope registered, the same way a page's do. The router's `virtual:aihu-layouts` entries carry a `components` array — the normalized tags the layout SFC's `@template` references, scanned at build time (`readAihuLayoutComponents`, mirroring the compiler's `is_component_tag`/`collect_component_tags` rule). When `@aihu/app` renders a route under a layout, it registers those components (from `virtual:aihu-components`) alongside loading the layout module, so a component used inside a layout — not the page — is defined before the layout element mounts instead of relying on prop-on-upgrade or an eager import. Entries without a `components` field (pre-F2 generated modules) keep working unchanged.

- [#416](https://github.com/fellwork/aihu/pull/416) [`bf66339`](https://github.com/fellwork/aihu/commit/bf66339bfeb7aaf855eb23e804f099c0e7d92726) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Route-scoped component registration (O1c): on navigation the client imports every component the matched route references — from the compile-time `virtual:aihu-components` registry — and registers their custom elements before the page element mounts. Apps no longer need a hand-written entry that eagerly imports every component; just reference the tag in a template. Tags with no registry entry (e.g. globally-registered elements) are skipped silently. Applies to the not-found route too.

### Patch Changes

- [#418](https://github.com/fellwork/aihu/pull/418) [`212e3e3`](https://github.com/fellwork/aihu/commit/212e3e38ae57de7e38c3211ef0223729ba1511e1) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Nested `<$outlet>` component registration (F1): the compiler-emitted `createOutletBoundary` now loads the matched route's referenced components alongside its page module — `Promise.all([m.route.module(), ...(globalThis.__aihuRegisterRouteComponents?.(m.route) ?? [])])` — so pages rendered through a layout's nested outlet get the same route-scoped registration as the top-level render path (O1c). `@aihu/app` publishes the registrar as `globalThis.__aihuRegisterRouteComponents` at module load; a standalone `@aihu/router` app without `@aihu/app` leaves it undefined and the outlet simply skips registration, unchanged from before.

- Updated dependencies [[`e8b082f`](https://github.com/fellwork/aihu/commit/e8b082f708e67de5ca54cf2d1e774a38b650c61c), [`8c80d98`](https://github.com/fellwork/aihu/commit/8c80d9844503c248ecf5fb2c0b3ec5ab06128d5e), [`212e3e3`](https://github.com/fellwork/aihu/commit/212e3e38ae57de7e38c3211ef0223729ba1511e1), [`84d6544`](https://github.com/fellwork/aihu/commit/84d654444bbfe2877896bca5ae74cbe5ce3ea364), [`514336d`](https://github.com/fellwork/aihu/commit/514336da5892c29e9e02d7a6391bb06c62d688c3)]:
  - @aihu/runtime@2.0.0
  - @aihu/router@0.3.0
  - @aihu/signals@0.3.0
  - @aihu/arbor@2.0.0

## 3.0.2

### Patch Changes

- [#374](https://github.com/fellwork/aihu/pull/374) [`6a0d8e4`](https://github.com/fellwork/aihu/commit/6a0d8e426fa2ab53c37fa5d1d4e6ae63ca671e0d) Thanks [@srmcguirt](https://github.com/srmcguirt)! - fix: `viteAihuPlugin({ agentReadiness })` no longer crashes under ESM vite config

  `viteAihuPlugin` lazy-loaded `@aihu-plugin/agent-readiness` with a bare
  `require(...)`, which throws "require is not defined" when vite loads
  `vite.config.ts` as bundled ESM (and `createRequire` fails too, since the
  package is ESM-only with no CJS export). Switched to a dynamic `import()`
  returned as a `Promise<Plugin>` (Vite awaits plugin promises). The plugin
  factory's return type widens from `Plugin[]` to `PluginOption[]`.

## 3.0.1

### Patch Changes

- Updated dependencies [[`5a94938`](https://github.com/fellwork/aihu/commit/5a949381544afd8276a0f6f5dba10cc4561b1d1a)]:
  - @aihu/server@0.2.1
  - @aihu/router@0.2.2

## 3.0.0

### Patch Changes

- Updated dependencies [[`dbc0903`](https://github.com/fellwork/aihu/commit/dbc09031f22ee93d9e5c9a46fea2ca2409463e90)]:
  - @aihu/runtime@1.1.0

## 2.0.3

### Patch Changes

- [#342](https://github.com/fellwork/aihu/pull/342) [`a96c49b`](https://github.com/fellwork/aihu/commit/a96c49b27b42d8271664e4f1c0907cbd27e70dbe) Thanks [@srmcguirt](https://github.com/srmcguirt)! - SSG/prerender layout parity (composition). When a static route declares a
  `layout` and that layout module exposes an SSR-renderable `default`, the
  prerender now renders the layout shell and injects the page content into its
  `data-aihu-outlet` marker — so prerendered HTML matches the client's layout
  wrapping. Layouts that aren't server-renderable (compiled SFCs, which register a
  side-effect custom element with no `default`) are unchanged: the page ships the
  SPA shell and the layout is applied client-side on hydration. A layout that
  renders no `<$outlet>` marker warns and ships the page unwrapped.

## 2.0.2

### Patch Changes

- [#339](https://github.com/fellwork/aihu/pull/339) [`fb436ac`](https://github.com/fellwork/aihu/commit/fb436ac2a1ecb6f9d570ccc05beeeab666c3ad6d) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Full per-route metadata (`head`/`middleware`/`params`/`ssr`) now reaches
  `virtual:aihu-routes` in a normal SPA build. Previously only `name`+`layout`
  survived (via an `@route` source regex): the compiler compiles `.aihu` via
  stdin and writes no `.route.json` sidecar, and `genR` runs before pages are
  lazily transformed — so nested metadata like per-route `<head>` SEO tags were
  silently dropped unless the app was prerendered/SSG'd.

  - **@aihu/compiler** — new `--route-json` binary flag (prints the computed
    route sidecar to stdout) and a `compileRouteMeta(source, id)` export that
    wraps it (mirrors `compileToAst`).
  - **@aihu/router** — `genR` accepts a `compileRouteMeta` option and uses it to
    recover full `@route` metadata for `.aihu` pages (precedence: disk sidecar →
    `compileRouteMeta` → `name`+`layout` regex fallback when no compiler is
    wired, so standalone `viteRouterIntegration` still works).
  - **@aihu/app** — wires the compiler's `compileRouteMeta` into the router
    integration, so SPA apps get per-route `<head>` without prerendering.

- Updated dependencies [[`fb436ac`](https://github.com/fellwork/aihu/commit/fb436ac2a1ecb6f9d570ccc05beeeab666c3ad6d)]:
  - @aihu/router@0.2.1

## 2.0.1

### Patch Changes

- [#336](https://github.com/fellwork/aihu/pull/336) [`0ab1988`](https://github.com/fellwork/aihu/commit/0ab1988b5f546f2050fa3eaea1b0ac1a26a32f96) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix SPA link interception for `<a>` nested inside a shadow root. A click inside
  a shadow-DOM layout/page (the default shadow mode) is retargeted at the host, so
  `e.target.closest('a')` missed the real anchor and the click fell through to a
  full page reload. The handler now resolves the anchor via `composedPath()`, so
  client-side navigation works inside shadow-DOM layouts — `shadowMode: 'none'` is
  no longer required just to make in-layout nav links work.

## 2.0.0

### Minor Changes

- [#334](https://github.com/fellwork/aihu/pull/334) [`eaadd45`](https://github.com/fellwork/aihu/commit/eaadd459118055e422e4ae025ceaa72be39ee17c) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Runtime layout rendering + dynamic layout switching.

  A page's `@route { layout: "<name>" }` now actually renders that layout around
  the page at runtime. Previously the layout metadata was emitted by the compiler
  and scanned by the router, but nothing rendered the layout — pages mounted
  straight into the root outlet.

  These three packages MUST ship in lockstep — the compiler emits what the router
  generates and `@aihu/app` consumes:

  - **@aihu/compiler** — layout SFCs (under the layouts dir) compile in layout
    mode: registered under a valid `aihu-layout-<name>` custom-element tag, with a
    passive `data-aihu-outlet` marker instead of the reactive route-driven
    boundary (which the imperative client renderer would otherwise fight).
  - **@aihu/router** — `virtual:aihu-layouts` now yields runtime
    `{ tag, load }` entries (a dynamic-import loader + the registered tag) instead
    of bare path strings; new `layoutTagFor()` shares the tag convention with the
    compiler. `genR` also recovers `layout` directly from the `@route` block so it
    flows through a normal (sidecar-less) Vite build.
  - **@aihu/app** — `createApp()` reads the matched route's `layout`, loads it,
    and mounts the page into the layout's outlet marker (falling back to the root
    outlet when there is no layout). It now returns an `AppHandle` with
    `setLayout(name | null)` to switch the current route's layout without
    navigating (resets on navigation) — wireable to a UI toggle or an `@agent`
    action.

  Scope: a single layout per route, client-side rendering. Nested layouts and
  SSR/prerender layout parity are follow-ups.

  See `examples/layouts` for a working demo (layouts by navigation + a
  dynamic-switch toolbar).

### Patch Changes

- Updated dependencies [[`eaadd45`](https://github.com/fellwork/aihu/commit/eaadd459118055e422e4ae025ceaa72be39ee17c)]:
  - @aihu/router@0.2.0

## 1.0.0

### Patch Changes

- Updated dependencies [[`b85f400`](https://github.com/fellwork/aihu/commit/b85f4008c489a0dba9e36cbdfc48b635eeea375f), [`7ec7155`](https://github.com/fellwork/aihu/commit/7ec71553722eaa4e3f6814e79ec747db68b72451), [`24dee56`](https://github.com/fellwork/aihu/commit/24dee56964e5afdac11c858cca0da2b3ec2483c9), [`1132357`](https://github.com/fellwork/aihu/commit/113235708bac1e8f9263d35feb865af8f8127f86)]:
  - @aihu/signals@0.2.0
  - @aihu/runtime@1.0.0
  - @aihu/arbor@1.0.0
  - @aihu/router@0.1.8

## 0.3.2

### Patch Changes

- [#276](https://github.com/fellwork/aihu/pull/276) [`22234fa`](https://github.com/fellwork/aihu/commit/22234fa1d34e913d84bcdbcc9c2bcf1fb315186b) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Scaffold `@aihu/css-engine` out of the box, with a shadow-mode choice.

  `aihu app <name>` gains two flags on the legacy scaffold path:

  - `--css <engine|none>` (with `--css-engine` as a boolean alias for
    `--css engine`) — includes `@aihu/css-engine` in `dependencies` and emits a
    utility-class starter page (`flex gap-4 max-w-7xl mx-auto p-8`, `text-3xl
font-bold`, …) instead of the hand-written `@style` starter.
  - `--shadow <open|closed|none>` — the shadow mode threaded into the compiler
    when css-engine is on (default `open`). `--shadow` without `--css engine`
    warns and is ignored.

  The `create-aihu` interactive wizard asks the same two questions. The default
  css-engine mode is `open` (scoped shadow fold), which is the compiler default —
  so the default css-engine scaffold writes **no** `css` block; only
  `closed`/`none` emit an explicit `css: { shadowMode }`. The plain (no-flag)
  scaffold output is unchanged.

  `@aihu/app` patch: corrected the `CssConfig` JSDoc — `@aihu/css-engine` is
  scoped by design and works in any shadow mode (its utilities fold into each
  component's shadow style); `shadowMode: 'none'` is only needed for
  global-cascade frameworks (Tailwind/UnoCSS/Pico) or to style light-DOM /
  external (slotted) children. (Wording only; no type or validation change.)

## 0.3.1

### Patch Changes

- Updated dependencies [[`2aecb07`](https://github.com/fellwork/aihu/commit/2aecb071623d989e7dc331c5e487eb6bdf756c2e)]:
  - @aihu/runtime@0.1.8

## 0.3.0

### Minor Changes

- [#253](https://github.com/fellwork/aihu/pull/253) [`d42793b`](https://github.com/fellwork/aihu/commit/d42793b8258d723ae7c80179dcc82e2db8d0afc4) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Forward `shadowMode` through `viteAihuPlugin` for utility-class CSS frameworks.

  - **`@aihu/app`** — new `css.shadowMode` option on `AihuConfig`. When set, it
    forwards to the compiler's per-plugin `shadowMode` injection
    (`'open' | 'closed' | 'none'`). Required for consumers of
    `@aihu/css-engine` (and other cascade-dependent CSS frameworks) so the
    utility classes the compiler folds in are not trapped inside a shadow root.
    Default behaviour is unchanged.
  - **`@aihu/compiler`** — `_maybeCompileUtilityCss` now emits a one-shot
    `console.warn` when `@aihu/css-engine` resolves but `compileSfc()` throws
    (typically: the native `aihu-css-core` binary is unresolvable). Build is
    still non-fatal; previously this case was completely silent and users
    could not discover why their utility classes never emitted.
  - **`@aihu/css-engine`** — README now documents the canonical
    `viteAihuPlugin({ css: { shadowMode: 'none' } })` wiring and points to the
    new `examples/css-engine-utility/` end-to-end example.

### Patch Changes

- Updated dependencies [[`84352bc`](https://github.com/fellwork/aihu/commit/84352bcb901b7213d67727648545b41652b2092a), [`1bf3145`](https://github.com/fellwork/aihu/commit/1bf3145bd6c627537448bdd72af378933ab851f2)]:
  - @aihu/arbor@0.1.5
  - @aihu/runtime@0.1.7
  - @aihu/router@0.1.7

## 0.2.0

### Minor Changes

- [#224](https://github.com/fellwork/aihu/pull/224) [`e1a6cfc`](https://github.com/fellwork/aihu/commit/e1a6cfcc9e50688592d580cd515b60c8faa50839) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Add a build-time **static / SSG output mode** (`output: 'static'`) that
  prerenders every route to content-ful HTML (B4 of the SEO arc).

  The default `output: 'spa'` ships an empty shell — crawlers and non-JS agents
  see no content. `output: 'static'` now prerenders each route at build time:
  the route's real module is loaded by file path (via a short-lived Vite SSR
  loader, so `.aihu`/TS compile exactly like the dev pipeline), rendered to
  content HTML with `@aihu/server`'s `renderToString`, and its per-route
  `<head>` (from the compiler's `.route.json` sidecar) is folded in via
  `routeHeadToSsrHead` — resolving relative `canonical`/`og:*`/`twitter:*` URLs
  to absolute against the new `site.url`, and emitting JSON-LD. The built
  `index.html` is used as the template so each emitted `<pattern>/index.html`
  keeps the client bundle `<script>` tags and hydrates into the live SPA
  (progressive enhancement). Ideal for content sites on static hosts (e.g.
  Cloudflare Pages).

  - `OutputMode` gains `'static'`; `defineConfig()` accepts it.
  - New `AihuConfig.site.url` (the absolute base URL) feeds absolute
    canonical/OG/Twitter resolution.
  - Dynamic routes (`:param` / `[param]`) are prerendered when their module
    exports `getStaticPaths()` (one HTML per returned path); without it the
    route is skipped with a clear build warning.
  - `output: 'spa'` behavior is unchanged. The SSG code is build-time only — no
    `.size-limit.json` row and no client-bundle impact.

### Patch Changes

- [#225](https://github.com/fellwork/aihu/pull/225) [`f2005e2`](https://github.com/fellwork/aihu/commit/f2005e222bc720a8cbc69ed81cfafa0cab8d8ced) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Update `document.head` on client-side SPA navigation to reflect each route's
  per-route `<head>` (B5, SEO arc). `createApp()` now lowers the active route's
  `head` (merged with optional global `app.head` defaults and resolved against
  `site.url`) and applies it to the live `document.head` — setting `<title>`,
  upserting `<meta>`/`<link rel=canonical>` by key, and injecting the JSON-LD
  `<script>`. Per-page tags are tracked and cleaned up on every navigation so
  stale title/canonical/OG/JSON-LD never accumulate; global defaults persist.

  The HeadConfig→tag application core is now shared (`head-apply.ts`) between the
  SSG prerender (string transform) and the client (live-DOM) paths so they can
  never diverge. To keep the browser client bundle `node:`-free, `@aihu/server`
  gains a pure `@aihu/server/head-lowering` subpath export for `routeHeadToSsrHead`
  (the barrel reaches the native loader and must not enter a browser bundle).

- [#216](https://github.com/fellwork/aihu/pull/216) [`0628885`](https://github.com/fellwork/aihu/commit/0628885ae3948bf6432a44102f92a00ce60f040b) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Inject `app.head` into the built `index.html`. `AihuConfig.app.head`
  (`title`, `charset`, `viewport`, `meta[]`) was accepted by `defineConfig()`
  but never read by any plugin, so the configured global head was silently
  dropped from SPA/static output — bad for SEO and non-JS agents.

  `viteAihuPlugin()` now registers an `aihu-head` plugin whose
  `transformIndexHtml` hook applies the configured head. Precedence is
  **config overrides source**: when the source `index.html` already declares a
  tag that `app.head` also configures (title, charset, viewport, or a meta with
  a matching `name`/`property`), the configured value replaces the source value
  in place — no duplicate `<title>`/charset/meta is emitted. Tags present only
  in config are injected before `</head>`. Values are HTML-escaped.

- Updated dependencies [[`f2005e2`](https://github.com/fellwork/aihu/commit/f2005e222bc720a8cbc69ed81cfafa0cab8d8ced), [`41c5e35`](https://github.com/fellwork/aihu/commit/41c5e355a55ca91872ac66ffb7375d1dd20570cc), [`a4b62f2`](https://github.com/fellwork/aihu/commit/a4b62f2229f43cdb30d117a5d33cb1702153446b), [`90d3174`](https://github.com/fellwork/aihu/commit/90d3174896ee03cf1756f5b92d125be45d13983f)]:
  - @aihu/server@0.2.0
  - @aihu/router@0.1.6
  - @aihu/runtime@0.1.6

## 0.1.9

### Patch Changes

- Updated dependencies []:
  - @aihu/router@0.1.5

## 0.1.8

### Patch Changes

- Updated dependencies [[`faca280`](https://github.com/fellwork/aihu/commit/faca2804cf62c05ffc90ef867faa2058b5e267ad)]:
  - @aihu/runtime@0.1.5
  - @aihu/router@0.1.4

## 0.1.7

### Patch Changes

- Updated dependencies []:
  - @aihu/router@0.1.3

## 0.1.6

### Patch Changes

- [#155](https://github.com/fellwork/aihu/pull/155) [`2aedc11`](https://github.com/fellwork/aihu/commit/2aedc113385896a0c9deefd6bd9e17d0f71fff4b) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Republish so peerDependencies pin `@aihu/router@0.1.2` (clean) instead of the
  stale `0.1.1` that the previous build emitted. Root cause: `bun pm pack`
  resolves `workspace:*` peer-dep ranges from `bun.lock`, not from the local
  workspace `package.json`. The Release-PR flow updates package versions but
  not the lockfile, so pack saw stale resolutions. Fixed in
  `scripts/publish-all.sh` by refreshing the lock before packing.

## 0.1.5

### Patch Changes

- [#153](https://github.com/fellwork/aihu/pull/153) [`f2421b1`](https://github.com/fellwork/aihu/commit/f2421b17a534d518c4f21c22d7f5e47a45c030da) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Scaffold install path fixes.

  `@aihu/cli`:

  - `aihu app <name>` now emits `package.json` with `latest` ranges for all `@aihu/*` deps instead of the aspirational `^1.0.0` (no 1.x exists on npm; the old pins broke `bun install` immediately).
  - Adds the missing `@aihu/app` (used by `src/main.ts`) and `@aihu/compiler` (used by `rolldown.config.ts`) to the generated dependency list.
  - Drops the malformed `bun@1` `packageManager` fallback — detects bun via `globalThis.Bun?.version`, omits the field when no real version is detectable.
  - Generates `.vscode/extensions.json` (recommends `fellwork.vscode-aihu`) and `.vscode/settings.json` (file association for `.aihu`) so new adopters get language support out of the box.

  `@aihu/router`, `@aihu/app`:

  - Republish so transitive pins point at clean versions. Previously `@aihu/router@0.1.1` pinned `@aihu/server@0.1.0` (carries the `workspace:*` leak) and `@aihu/app@0.1.4` peer-pinned `@aihu/router@0.1.0` (also leaked). Combined effect: `bun install` of any scaffolded app failed at the workspace-protocol resolution step. Both republish with deps targeting the post-leak versions.

- Updated dependencies [[`f2421b1`](https://github.com/fellwork/aihu/commit/f2421b17a534d518c4f21c22d7f5e47a45c030da)]:
  - @aihu/router@0.1.2

## 0.1.4

### Patch Changes

- Updated dependencies [[`70fdad2`](https://github.com/fellwork/aihu/commit/70fdad254bedab492e3b46b131564605d4665537)]:
  - @aihu/arbor@0.1.4
  - @aihu/runtime@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies []:
  - @aihu/arbor@0.1.3
  - @aihu/runtime@0.1.3

## 0.1.2

### Patch Changes

- [#109](https://github.com/fellwork/aihu/pull/109) [`82954a5`](https://github.com/fellwork/aihu/commit/82954a576a3f558133ee9cdb18df233c3b991972) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Round 2 SPA emit-correctness fixes — three layered defects surfaced by
  fellwork/mail dogfooding.

  - **Defect B (`@aihu/compiler` — runtime crash)**: template attribute bindings
    that reference any name declared in `@state` are now lowered to a
    single-element thunk array `[() => (expr)]`. Previously, an attribute like
    `<CalendarGrid events={events}>` where `events: any[] = []` emitted the raw
    array as the attribute value. arbor's `_applyAttrs` discriminates reactive
    bindings via `Array.isArray(value)`, so an empty-array state value was
    mis-detected as a Signal tuple and the runtime threw
    `TypeError: c is not a function` when it invoked `value[0]() as () =>
unknown`. The thunk-array form makes the discriminant explicit:
    `value[0]` is a getter, `mountEffect` reads the current value reactively.
    Static literals (`class="static"`), event handlers (`on*`), and locally
    declared `<script setup>` consts continue to pass through unwrapped.

  - **Defect A (`@aihu/compiler` — runtime crash)**: state declarations from
    `@state` blocks are now emitted _before_ the action / effect / lifecycle
    registration code in the setup body. `effect(...)`, `onMount(...)`, and
    `onCleanup(...)` synchronously invoke their callbacks once at registration
    time to track dependencies, so any reference to a state variable declared
    later hit the temporal dead zone and threw
    `ReferenceError: Cannot access 'n' before initialization`. Bare class-property
    declarations (`count: number = 0`) now lower to `let`, not `const`, so
    reassignments from action / lifecycle bodies (`count = count + 1`) don't
    throw `Assignment to constant variable`.

  - **Defect C (`@aihu/app` — stale published artifact)**: republish to ensure
    the round-1 `viteAihuPlugin({ islands: false })` plumbing actually ships in
    the consumed package. SPA route components are top-level mounts that should
    always go through `defineComponent`; the Round 1 fix made
    `viteAihuPlugin()` pass `islands: false` to `aihuCompilerPlugin()`, but the
    npm artifact for `@aihu/app@0.1.1` did not pick up the rebuilt `dist/`.
    Bumping the patch republishes with the corrected plumbing — login (and
    any route without `signal`/`computed`/`effect`/`onMount`/`onCleanup`) now
    emits a `defineElement(... defineComponent(...))` chunk shape instead of
    the static-island `customElements.define(...)` shim that strips the runtime.

## 0.1.1

### Patch Changes

- [`4dea3a4`](https://github.com/fellwork/aihu/commit/4dea3a4d98509742553dc654ef023cd6f8189edb) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix `RuntimeError: SCR-R0010 'no owner'` when `.aihu` route components use
  `$lifecycle.mount` / `$lifecycle.dispose` (or any `onMount` / `onCleanup`
  call) without also using `signal()`. Two changes:

  - **`@aihu/compiler`**: `_classifyIsland` now treats `onMount(` and
    `onCleanup(` as interactive primitives. Previously only
    `signal/computed/effect/setSignal` flipped a module to interactive, so a
    page that only used lifecycle hooks was mis-classified as static — the
    static-island shim then stripped `defineComponent`, leaving the lifecycle
    call without an owner. The compiler also now lifts `import` statements
    from `@state` blocks to module scope (deduped against framework-emitted
    imports) so consumed identifiers actually resolve at runtime.
  - **`@aihu/app`**: `viteAihuPlugin()` now passes `{ islands: false }` to
    `aihuCompilerPlugin()`. SPA route components are top-level mounts that
    should always go through the full reactive pipeline; the static-island
    optimization is for MPA-style mixed-island layouts and saves ~0 B in an
    SPA where the runtime is already shared in the main bundle. Set
    `islands: true` on the compiler plugin directly if you genuinely need
    per-component static-island emission.
  - **`@aihu/app`**: `createApp()` accepts a `provide` config and hoists
    the values into `globalThis` before any component runs, so app-level
    singletons (db clients, auth helpers) resolve as bare identifiers in
    `@state` blocks without manual `window.*` wiring. Mirrored on
    `AihuConfig` for build-time documentation.
