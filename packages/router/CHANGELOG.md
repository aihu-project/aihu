# @aihu/router

## 0.5.3

### Patch Changes

- [#905](https://github.com/aihu-project/aihu/pull/905) [`f84635f`](https://github.com/aihu-project/aihu/commit/f84635f1c4e7e9fb137cffff5dd2a055752ae3ee) Thanks [@srmcguirt](https://github.com/srmcguirt)! - A push navigation (a clicked link, or `navigate()` without `replace`) now scrolls the new page to its `#fragment` target, or to the top when there is none, instead of leaving it at the previous page's scroll offset. Replace navigations keep the scroll position, and back/forward keep the browser's own scroll restoration.

## 0.5.2

### Patch Changes

- [#895](https://github.com/aihu-project/aihu/pull/895) [`444604a`](https://github.com/aihu-project/aihu/commit/444604a0653a3378dd7cace386ee413833c4da57) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Resolve route, layout, and component directories from Vite's project root, and preserve native link behavior for modified, targeted, downloaded, external, and same-page fragment clicks. SPA fragment navigation now scrolls to and focuses its destination, while active links expose `aria-current="page"` and the `active` class. Router plugin options are also exposed through the aihu module config contract.

- [#901](https://github.com/aihu-project/aihu/pull/901) [`b912065`](https://github.com/aihu-project/aihu/commit/b91206574284b3893327e9c909fc436a6b1edc9b) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Complete static prerenders across Vite virtual modules, support shared component directories and file-style route HTML, and fail builds with route-specific errors.

- Updated dependencies [[`a40aba7`](https://github.com/aihu-project/aihu/commit/a40aba75cd95539427e42a4cc0686c4f4e63c6e3), [`04da84c`](https://github.com/aihu-project/aihu/commit/04da84ca60390fb7198588afe3a5872ab134defe)]:
  - @aihu/server@0.6.1

## 0.5.1

### Patch Changes

- [#890](https://github.com/aihu-project/aihu/pull/890) [`334bb32`](https://github.com/aihu-project/aihu/commit/334bb328cdd36de4dd0424d3cc0541a7b4c0101d) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Name the copyright holder in the MIT license file. The holder line now reads Shane McGuirt instead of Fellwork. The license terms are unchanged.

## 0.5.0

### Minor Changes

- [#779](https://github.com/fellwork/aihu/pull/779) [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Forward the child-component registry on both server render paths.

  `createServerRouter` forwarded `lightScopeId` to `renderToString` and nothing
  else, so every request-time SSR consumer rendered a component reference as an
  empty element with no diagnostic — the failure the child work exists to remove,
  left behind at the live-SSR edge while SSG got the fix. `ServerRouterOptions`
  gains `children`, typed as `buildChildRegistry`'s own return type:

  ```ts
  const children = buildChildRegistry(discovered);
  export default createServerRouter(routes, { children });
  ```

  A resolved `Map` rather than a loader, because `__aihu_schild` runs inside the
  compiled string fast path, which is synchronous — awaiting belongs at module
  init, once. Both the governed and ungoverned arms forward it: child rendering
  must not depend on whether a route happens to declare `extract`.

  Omitting it is byte-identical to before.

  **Scope, stated because it is easy to overestimate.** This closes the
  forwarding hole and nothing more. It does not by itself give any shipped
  adapter non-empty children: `@aihu/adapter-cloudflare` and `-vercel` emit their
  entry as a raw string at `closeBundle` (so it never enters Vite's module
  graph), wire `createRequestRouter` rather than this function, and give every
  route a `notFound` placeholder — they render nothing at all today. A consumer
  also still needs a way to BUILD the map on the server. That is a separate piece
  of work.

- [#779](https://github.com/fellwork/aihu/pull/779) [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Agree with the compiler on both the custom-element tag and the collision
  tie-break.

  `readAihuComponentTag` preferred `@meta { name }` over everything else, but the
  compiler never reads it: `SfcMeta` has no `name` field, and the parser hardcodes
  `ScriptMeta { name: None }`, so the "@meta name" leg the OQ-C6 comments refer to
  names an older script-level field that no longer parses. The convention that
  `@meta` must not redefine the component name is written down as R-META-COEXIST
  and asserted by the compiler's own tests; the router was the only thing that
  believed otherwise.

  The consequence was worse than an SSR miss. A component declaring
  `@meta { name: "custom-thing" }` in `x-plain.aihu` compiles to
  `defineElement('x-plain', …)`, so the router registered its loader under a tag
  no module ever defines: `<custom-thing>` never upgraded on the client, and the
  tag templates actually reference resolved to nothing. Precedence is now
  `@route { name }` → file stem, matching `resolve_tag`.

  **Behaviour change.** A component relying on `@meta { name }` to set its tag now
  resolves to its file stem. That reliance was already broken — the browser
  registered the stem regardless — so this makes the router agree with what
  `customElements.define` actually receives rather than changing what ships. No
  `.aihu` file in this repo declares `@meta` at all. Use `@route { name }`, or
  rename the file.

  `scanComponents` also kept the LAST file claiming a tag, over raw `readdirSync`
  order, while `@aihu/server`'s `buildChildRegistry` keeps the FIRST over a sorted
  list. The prerendered page shipped one module's markup while the client
  upgraded with the other's — a content swap on hydrate — and the winner was not
  reproducible across filesystems. Now sorts and keeps the first, over the same
  key, so both sides select the same module from the same tree.

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

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Escape values embedded in the four generated virtual modules against
  code-construction breakout, and fix a runtime `TypeError` found while tracing
  one of the flagged flows.

  Closes three OPEN CodeQL `js/bad-code-sanitization` alerts (CWE-79/94/116,
  severity error), all in `packages/router/src/vite-plugin.ts`: **[#61](https://github.com/fellwork/aihu/issues/61)** and
  **[#86](https://github.com/fellwork/aihu/issues/86)** (the module specifier in `genC`'s and `genSC`'s `import(...)`) and
  **[#62](https://github.com/fellwork/aihu/issues/62)** (`genC`'s transitive `Promise.all([...])` loader).

  **The vulnerability class.** `genR`, `genL`, `genC` and `genSC` each build
  JavaScript SOURCE by string concatenation, interpolating values read off disk
  with a bare `JSON.stringify`. `JSON.stringify` escapes for the JSON grammar —
  quotes, backslashes, C0 controls — and passes `<`, `>`, U+2028 and U+2029
  straight through. Those four are exactly the characters that matter in the
  grammars a chunk of JS source can end up inside: `</script>` terminates an
  inline `<script>` element, `<!--` opens an HTML comment inside script data, and
  U+2028/9 are LineTerminators to a pre-ES2019 parser. Sanitizing for the wrong
  context is the whole of the rule.

  **What was actually reachable — traced, not assumed.** Two distinct sources
  feed these sinks, and they are not equally exposed.

  | sink                              | value                                       | existing guard       | `<`/`>` blocked? |
  | --------------------------------- | ------------------------------------------- | -------------------- | ---------------- |
  | `genC` / `genSC` `import(...)`    | filesystem path from the `readdirSync` walk | `SAFE_MODULE_PATH`   | **no**           |
  | `genC` / `genSC` registry key     | component tag                               | `CUSTOM_ELEMENT_TAG` | yes              |
  | `genR` `name:` / `layout:`        | text of the SFC's own `@route` block        | _none_               | **no**           |
  | `genR` `head:`/`middleware:`/…    | a `.route.json` sidecar's JSON              | _none_               | **no**           |
  | `genL` key / `tag` / `components` | layout stem, `@template` text               | _none_               | **no**           |

  `SAFE_MODULE_PATH` bans quotes, backslashes and line terminators but says
  nothing about angle brackets, and `<`/`>` are legal in a POSIX filename. So a
  component under a directory named `a</script>b` put a literal `</script>` into
  the generated registry, with a perfectly valid tag. Reproduced on a real
  fixture: the emitted `virtual:aihu-components`, wrapped in a
  `<script type="module">`, contained **five** `<script`/`</script` tokens where
  two were intended.

  The `genR` and `genL` sinks CodeQL did **not** flag turned out to be the more
  exposed ones: those values are not filesystem paths but the _contents_ of a
  `.aihu` file, lifted by regex (`@route { name: '…' }`) straight into the route
  table with no shape check at any point. A one-line payload in a page file put
  both a raw `</script>` and a raw U+2028 into the generated module. Fixed too —
  an escaper used at three of five structurally identical sites is worse than one
  used at all five.

  None of this is a live exploit in the first-party pipeline as shipped: the
  client entry is always injected as `<script type="module" src=...>`, never
  inlined, so the generated module is served as an external `.js` where `<` is
  inert. It becomes live the moment anything inlines a chunk — a
  single-file/inline-script plugin, a CSP-driven inlining step, a downstream
  consumer's own HTML template. Given that the value is attacker-influenceable
  under a realistic threat model (a monorepo whose CI builds untrusted PRs: a
  contributor controls both component filenames and `@route { name }`), and that
  the fix is free at every normal input, defense in depth was the call rather
  than dismissal. All three alerts are fixed; none dismissed.

  **The fix.** One shared helper, `jsSourceLiteral()` (new
  `packages/router/src/codegen.ts`, exported from `@aihu/router/plugin` alongside
  `escapeForJsSource` so the sibling emitters in `@aihu/app`, the adapters and
  `@aihu/magna` can adopt it rather than re-deriving it). It is `JSON.stringify`
  plus the escaping pass the CodeQL rule's own remediation prescribes, over
  `< > BS FF LF CR TAB NUL U+2028 U+2029`. Every replacement is a `\uXXXX`
  escape, which denotes the same character inside a JS string literal, so the
  emitted module evaluates identically — specifiers still resolve, tags still
  match. It now backs all 11 interpolation holes across the four generators.

  One deliberate divergence from the rule's example charMap: NUL is spelled
  `\u0000`, not `\0`. `\0` immediately followed by a digit is a legacy
  OctalEscapeSequence and a **SyntaxError** in module code — verified, and pinned
  by a test that asserts the rule's own spelling throws while ours round-trips.

  **A real bug, found by tracing alert [#62](https://github.com/fellwork/aihu/issues/62).** That sink interpolates the child
  tags of `genC`'s transitive loader, and the value arriving there was not merely
  unescaped — it was unchecked against the registry it indexes into. The child
  filter accepted any key of `mods` (the raw directory scan) rather than any
  member of `tags` (what survived the codegen-boundary filter). A single-word
  component — `button.aihu` → tag `button`, no hyphen — is dropped by
  `CUSTOM_ELEMENT_TAG` but stays in `mods`, so a parent referencing `<Button />`
  emitted `__m["button"]()` against a registry with no `button` key:

  ```
  TypeError: __m["button"] is not a function
  ```

  thrown out of the _parent's_ loader, taking `site-header` down with the child
  that was only ever meant to be skipped. Now filtered on the emitted set.

  **Verified before and after, on real fixtures.**

  | check                                                         | before                                               | after                                |
  | ------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------ |
  | hostile dir name → `genC`/`genSC`, script tokens when inlined | `<script`,`</script`,`<script`,`</script`,`</script` | `<script`,`</script`                 |
  | hostile `@route { name }` → `genR`                            | raw `</script>` **and** raw U+2028                   | `\u003C/script\u003E`, `\u2028`      |
  | dangling `__m["button"]()`                                    | emitted; loader throws `TypeError`                   | not emitted; loader resolves         |
  | escaped literal round-trips through `new Function` (strict)   | —                                                    | all 7 payloads exact                 |
  | **normal tree, output byte-identical to pre-fix**             | —                                                    | `genR` ✓ `genL` ✓ `genC` ✓ `genSC` ✓ |

  That last row is the one that matters for blast radius: on a tree with no
  hostile characters, all four generators emit byte-for-byte what they emitted
  before, diffed against `HEAD`'s `vite-plugin.ts` loaded side by side in the
  same process. Nothing about normal output changed.

  Pinned by 11 new tests in `packages/router/tests/codegen-escaping.test.ts`.
  Reverting `vite-plugin.ts` alone turns 4 of them red (one per generator, plus
  the dangling-lookup case) and leaves the other 7 — the helper's own unit tests
  — green, so each half of the change is independently guarded. Full
  `packages/router` suite: 199 passed / 16 files. Full repo suite: 4787 passed,
  with the same 25 pre-existing failures the unmodified base produces (all
  build-artifact-dependent — they need `cargo build --release` and `bun run
build`), confirmed by a baseline run on the same worktree. `biome ci` clean,
  `moon run :typecheck` clean across 63 tasks.

  No size impact on the measured surface: the helper is reachable only from the
  build-time `@aihu/router/plugin` entry. `dist/index.js` — the browser runtime
  under the 2400 B budget — does not contain it and stays at 1780 B gzip.

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix a stored-XSS gap in the SSR loader embed: `<script type="application/json"
id="__aihu_loader__">` interpolated `JSON.stringify(data)` directly, on both
  the governed and ungoverned response paths in `packages/router/src/server.ts`.
  `JSON.stringify` does not escape `<`/`>`, so route data containing a literal
  `</script>` closed the embed early and turned everything after it into live
  DOM — the exact CWE-79/94/116 vulnerability class `router-codegen-escaping.md`
  already fixed at build time in `vite-plugin.ts`, present at runtime too, and
  missed by that sweep because these two sinks are a sibling package (`@aihu/server`
  data flowing through `@aihu/router`'s request handler), not a codegen emitter.

  **Why this one is live, unlike the codegen sinks.** This branch's SSR work
  newly wires loaders to real platform bindings (D1/KV/R2) via `PlatformContext`,
  so `emission.data`/`loaderData` can now carry stored, non-developer-authored
  content — a comment, a title, anything round-tripped through a database. A
  single field containing `</script><img src=x onerror=alert(1)>` is live markup
  in the response the instant that route is requested. `packages/app/src/head-apply.ts`
  already documents the concern for its own script-tag path ("no `</script>`
  escaping needed, unlike the string path" — this is that string path).

  Both sinks now use `jsSourceLiteral()` (the escaper `router-codegen-escaping.md`
  built for the build-time generators) instead of `JSON.stringify`. `\uXXXX`
  escapes round-trip through `JSON.parse` unchanged, so the client-side loader —
  which reads `#__aihu_loader__`'s `textContent` and parses it — receives
  byte-identical data; nothing on the client needed to change.

  **Verified.** Reproduced the breakout against the pre-fix code (a payload
  containing `</script><img ...>` survives verbatim in the response body) and
  confirmed the fix neutralizes it while the parsed payload is unchanged.
  Regression-tested end to end through `createServerRouter(...).handle()` on
  both the governed and ungoverned arms (`packages/router/tests/governed-handle.test.ts`,
  new `G7k` describe block) — mutation-tested: reverting the fix turns both new
  tests red for exactly this reason, restoring it turns them green. Full
  `packages/router`/`packages/app`/`packages/server` suites (811 tests) and the
  real-built-Worker `workers-ssr-e2e` harness (23 tests) all pass.

  Grepped for other `__aihu_loader__` write sites — these are the only two.

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

- Updated dependencies [[`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`788319c`](https://github.com/fellwork/aihu/commit/788319ca907d9a34ec83c7af655436555a42b4c0), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`ff58a1b`](https://github.com/fellwork/aihu/commit/ff58a1b8d9018f0198aa8879c359e90133266b2f), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88), [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf)]:
  - @aihu/server@0.6.0

## 0.4.4

### Patch Changes

- Updated dependencies [[`ac9c045`](https://github.com/fellwork/aihu/commit/ac9c04599b2fbf57c9f39a39e1c9db7fe1388028)]:
  - @aihu/server@0.5.0

## 0.4.3

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

## 0.4.2

### Patch Changes

- Updated dependencies [[`ad6921a`](https://github.com/fellwork/aihu/commit/ad6921a018ef4a479f6540278e549aa9a8cab387)]:
  - @aihu/signals@0.5.0
  - @aihu/server@0.4.1

## 0.4.1

### Patch Changes

- [#514](https://github.com/fellwork/aihu/pull/514) [`061eefb`](https://github.com/fellwork/aihu/commit/061eefb3e94fdbbe9e6f5d5301db3bcdd3fa3b22) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Compile-time SSR string-template emit target (wave-3 keystone).

  - `--target server` artifacts now additionally export `__ssrString(props,
{ hydratable })` — a compiled string renderer of straight-line
    concatenation with interpolated dynamic holes and static-subtree constant
    folding (Svelte/Solid-SSR style), byte-identical to the tree-walk renderer
    including the full hydration wire grammar (`data-aihu-path`,
    `<!--aihu:s:PATH-->` structural markers, `<!--|-->` text-leaf boundaries).
    Templates using constructs outside the lowerable set (suspense/shield/
    guard/warp/focusTrap/router-macro elements, duplicate attr keys) simply
    ship without the export and keep the walker.
  - New `@aihu/runtime/ssr` subpath entry with the SSR string helpers
    (`__aihu_stext`, `__aihu_sattr`, …) mirroring the walker's escaping —
    server-only bytes on their own entry, so the client bundle size gate is
    untouched.
  - `@aihu/server` renderToString/renderToStream take the string fast path when
    the component carries a compiled renderer (`AIHU_SSR_STRING=0` opts out);
    new `attachSsrString` carries the renderer across props-binding wrappers
    (used by the router's governed path).
  - SSR walker fix: reactive attribute tuples/thunks now serialize their
    CURRENT VALUE (previously the getter's function source was printed into the
    attribute) and function-valued attrs (event handlers) never serialize.
  - Compiler fixes surfaced by the differential gate: `show`/`class:`/`ref`/
    `html` effect IIFEs guard their `onMount` registration (host-less SSR and
    loop-item factories previously crashed with SCR-R0010 'no owner'), and an
    `each`+`empty` chain now emits the `createIfBoundary` helper it references.

- Updated dependencies [[`2ef2830`](https://github.com/fellwork/aihu/commit/2ef2830aa737906d09a5d870176da34a22f20b99), [`8924c51`](https://github.com/fellwork/aihu/commit/8924c51da6e6c25fb2664a7ab6fe9c628895161d), [`18e5f6d`](https://github.com/fellwork/aihu/commit/18e5f6dda93772877690e88e8c217dcdcf4bddc2), [`27a3268`](https://github.com/fellwork/aihu/commit/27a326826ee9a4d0a9b46bf50ca31686543848fe), [`ea8d2eb`](https://github.com/fellwork/aihu/commit/ea8d2ebb91c28132f399a708e2bd88877072d1db), [`061eefb`](https://github.com/fellwork/aihu/commit/061eefb3e94fdbbe9e6f5d5301db3bcdd3fa3b22)]:
  - @aihu/server@0.4.0
  - @aihu/signals@0.4.0

## 0.4.0

### Minor Changes

- [#463](https://github.com/fellwork/aihu/pull/463) [`bc0f289`](https://github.com/fellwork/aihu/commit/bc0f289ee38871cda8002e56fba3e3b8b7e34d84) Thanks [@srmcguirt](https://github.com/srmcguirt)! - GX Phase 3 ([#437](https://github.com/fellwork/aihu/issues/437)-GX) — derive robots.txt, noindex, and discovery output from
  the compiled `extract.read` axis.

  - `@aihu/server`: new `deriveReadPolicy` / `extractReadValue` /
    `isCallAdvertised` — the one read-axis derivation table (crawl access per
    bot tier, robots advertisability, noindex, discovery membership), fail-closed
    on malformed values. `AgentReadinessConfig` gains `routes` (the compiled
    route table conduit).
  - `@aihu-plugin/agent-readiness`: `generateRobotsTxt` accepts `routes` and
    derives per-path directives per route `read:` value over the tiered bot
    registry (`'all'` → all tiers; `'agents'` → the [#430](https://github.com/fellwork/aihu/issues/430) tiered default, now
    derived per route; `'search'` → searchers only; `'none'` → all crawlers
    disallowed; hard values → not advertised at all). llms.txt gains a derived
    `## Routes` section and filters its components section by the declared
    policy; MCP server-card tools are filtered by read + call advertisability.
    With no routes declared, robots.txt is byte-identical to the shipped [#430](https://github.com/fellwork/aihu/issues/430)
    default.
  - `@aihu/router`: `RouteDefinition`/`RouteSidecar` carry the compiled
    `extract` member; `createServerRouter.handle` sends `X-Robots-Tag: noindex`
    for `read:'none'`/hard/malformed routes.
  - `@aihu/compiler`: `RouteMeta` types the `extract` member the binary already
    emits (type-only).

  All of this is compliance-tier: advisory signals honored by compliant,
  self-identifying crawlers. Hard-tier enforcement (SSR withholding, the
  bundle/data boundary) is Phase 4 and is not part of this change.

### Patch Changes

- [#489](https://github.com/fellwork/aihu/pull/489) [`80531dc`](https://github.com/fellwork/aihu/commit/80531dcc4dfc43bc9cd399bbb8ab4520efb8f15a) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Template grammar v2 — the prefix-less template (founder-ratified 40-spec).

  One rule: naked keywords + naked HTML attributes + naked framework vocabulary;
  `{expr}` braces mean expression, quoted strings mean static; `$` retreats to
  `@state` macros only.

  **New grammar:** `if={…}`/`elseif={…}`/`else` attribute chains (adjacency-checked),
  the item-first `each={item, i of items}` `of`-binder with destructuring, `key={…}`,
  `empty` siblings, colon directives `on:<event>` (with `.prevent`/`.stop`/`.self`/`.once`
  modifiers), `bind:<prop>`, `class:<name>`, the `attr:<name>` literal escape hatch,
  naked `show`/`html`/`ref`/`once`/`memo`/`raw`, the NEW `<group>` fragment carrier,
  naked framework elements (`<slot>` is now THE projection form), and the enhanced
  `<a>` (SPA navigation, `prefetch`, `replace`, `aria-current`, auto-opt-out +
  explicit `reload`) replacing `<$link>`.

  **Retired (compile errors with fix hints):** `{#if}` C601, `{#each}` C602,
  `{@html}` C603, `{{ident}}` C604, `<$if>`/`<$else>` C605, `$if=`/`$each=`/`$let=`
  C606, every other `$`-attribute C607, `<$link>` C608, other `<$…>` elements C609,
  adjacency violations C610, unknown non-hyphenated elements C611. New lints:
  W601 (keyless stateful `each`), W602 (non-empty string on a boolean attribute).

  **Intended emission diffs:** internal `<a href>` links now lower to
  `createLinkBoundary` (the retired `<$link>` lowering) with a runtime
  origin/scheme auto-opt-out; everything else lowers through the same arbor
  structural calls as v1 (`when`/`each`/fragment branches).

  `aihu migrate --v2` now lands on this grammar (new final codemod pass:
  `compiler/js/codemods/template-grammar-v2`).

- Updated dependencies [[`bc0f289`](https://github.com/fellwork/aihu/commit/bc0f289ee38871cda8002e56fba3e3b8b7e34d84)]:
  - @aihu/server@0.3.0

## 0.3.0

### Minor Changes

- [#418](https://github.com/fellwork/aihu/pull/418) [`212e3e3`](https://github.com/fellwork/aihu/commit/212e3e38ae57de7e38c3211ef0223729ba1511e1) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Layout-scoped component registration (F2): a layout's own referenced components now get route-scope registered, the same way a page's do. The router's `virtual:aihu-layouts` entries carry a `components` array — the normalized tags the layout SFC's `@template` references, scanned at build time (`readAihuLayoutComponents`, mirroring the compiler's `is_component_tag`/`collect_component_tags` rule). When `@aihu/app` renders a route under a layout, it registers those components (from `virtual:aihu-components`) alongside loading the layout module, so a component used inside a layout — not the page — is defined before the layout element mounts instead of relying on prop-on-upgrade or an eager import. Entries without a `components` field (pre-F2 generated modules) keep working unchanged.

### Patch Changes

- Updated dependencies [[`b279f74`](https://github.com/fellwork/aihu/commit/b279f74b34cd4e901be1cfa5d70c212cf604dfc1), [`8c80d98`](https://github.com/fellwork/aihu/commit/8c80d9844503c248ecf5fb2c0b3ec5ab06128d5e), [`514336d`](https://github.com/fellwork/aihu/commit/514336da5892c29e9e02d7a6391bb06c62d688c3)]:
  - @aihu/context@0.2.0
  - @aihu/signals@0.3.0

## 0.2.2

### Patch Changes

- Updated dependencies [[`5a94938`](https://github.com/fellwork/aihu/commit/5a949381544afd8276a0f6f5dba10cc4561b1d1a)]:
  - @aihu/server@0.2.1

## 0.2.1

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

## 0.2.0

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

## 0.1.8

### Patch Changes

- Updated dependencies [[`b85f400`](https://github.com/fellwork/aihu/commit/b85f4008c489a0dba9e36cbdfc48b635eeea375f)]:
  - @aihu/signals@0.2.0

## 0.1.7

### Patch Changes

- [#257](https://github.com/fellwork/aihu/pull/257) [`1bf3145`](https://github.com/fellwork/aihu/commit/1bf3145bd6c627537448bdd72af378933ab851f2) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Split the server-only `handle(req)` request handler out of `createRouter` into a new `@aihu/router/server` subpath export (`createServerRouter`). The `@aihu/router` root entry is now strictly browser-safe and contains zero `@aihu/server` imports.

  Previously `packages/router/src/router.ts` imported `renderToString` from the `@aihu/server` barrel solely to power `router.handle()`. That barrel's `renderToString` carries an `await import('./native.js')`, and the built `native.js` statically imports `node:module`. Because `@aihu/router` is browser-eligible (every SPA depends on it via `@aihu/app/client`), Vite/Rolldown chased the dynamic import during SPA builds and choked with `Module "node:module" has been externalized for browser compatibility`. SPA examples like `examples/blog-router` and `examples/css-engine-utility` failed to build.

  The fix mirrors the existing fence `@aihu/server/head-lowering` that `@aihu/app/client` uses: a clean subpath with zero `node:*` reach. The `Router` type no longer carries `handle`; SSR consumers should import `createServerRouter` from `@aihu/router/server`. Browser consumers (the vast majority — `createRouter`, `useRoute`, `navigate`, `<$link>`, `<$navigate>`, guards) are unaffected.

  Also adds a `bun run lint:node-leak` CI gate (`scripts/lint-node-bundle-leaks.ts`) that builds the browser-eligible examples and greps `dist/assets/*.js` for any surviving `from "node:` specifier. This catches future regressions where a server-only entry sneaks into a browser-reachable graph.

## 0.1.6

### Patch Changes

- [#218](https://github.com/fellwork/aihu/pull/218) [`41c5e35`](https://github.com/fellwork/aihu/commit/41c5e355a55ca91872ac66ffb7375d1dd20570cc) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Thread per-route `<head>` metadata from the compiler's `.route.json` sidecar
  through to `RouteDefinition` and the generated `virtual:aihu-routes` module
  (B2 of the SEO `<head>` arc).

  Adds and exports a new `RouteHead` type (`title`, `description`, `canonical`,
  `og`, `twitter`, `jsonld`) and an optional `head?: RouteHead` field on
  `RouteDefinition` and the build-time `RouteSidecar`. `head` is added to the
  `SK` sidecar-key allowlist so it survives into `virtual:aihu-routes` — without
  it the key would be silently dropped. Routes with no `head:` stay backward
  compatible (`head` is `undefined`).

  Type-only addition; the runtime/browser bundle size is unchanged. Downstream
  consumers (SSG prerender, client-nav head updater) import `RouteHead` from
  `@aihu/router`.

- Updated dependencies [[`f2005e2`](https://github.com/fellwork/aihu/commit/f2005e222bc720a8cbc69ed81cfafa0cab8d8ced), [`90d3174`](https://github.com/fellwork/aihu/commit/90d3174896ee03cf1756f5b92d125be45d13983f)]:
  - @aihu/server@0.2.0

## 0.1.5

### Patch Changes

- Updated dependencies [[`ec9f59b`](https://github.com/fellwork/aihu/commit/ec9f59b345116576b58f85298501d43d9ac33d61)]:
  - @aihu/server@0.1.4

## 0.1.4

### Patch Changes

- Updated dependencies [[`afead86`](https://github.com/fellwork/aihu/commit/afead86a982ca8df290f2970e3a16f5f003c0c03)]:
  - @aihu/server@0.1.3

## 0.1.3

### Patch Changes

- Updated dependencies [[`ac63d4b`](https://github.com/fellwork/aihu/commit/ac63d4b9a2a5296de8a20b80049e2c5bbc493880)]:
  - @aihu/server@0.1.2

## 0.1.2

### Patch Changes

- [#153](https://github.com/fellwork/aihu/pull/153) [`f2421b1`](https://github.com/fellwork/aihu/commit/f2421b17a534d518c4f21c22d7f5e47a45c030da) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Scaffold install path fixes.

  `@aihu/cli`:

  - `aihu app <name>` now emits `package.json` with `latest` ranges for all `@aihu/*` deps instead of the aspirational `^1.0.0` (no 1.x exists on npm; the old pins broke `bun install` immediately).
  - Adds the missing `@aihu/app` (used by `src/main.ts`) and `@aihu/compiler` (used by `rolldown.config.ts`) to the generated dependency list.
  - Drops the malformed `bun@1` `packageManager` fallback — detects bun via `globalThis.Bun?.version`, omits the field when no real version is detectable.
  - Generates `.vscode/extensions.json` (recommends `fellwork.vscode-aihu`) and `.vscode/settings.json` (file association for `.aihu`) so new adopters get language support out of the box.

  `@aihu/router`, `@aihu/app`:

  - Republish so transitive pins point at clean versions. Previously `@aihu/router@0.1.1` pinned `@aihu/server@0.1.0` (carries the `workspace:*` leak) and `@aihu/app@0.1.4` peer-pinned `@aihu/router@0.1.0` (also leaked). Combined effect: `bun install` of any scaffolded app failed at the workspace-protocol resolution step. Both republish with deps targeting the post-leak versions.
