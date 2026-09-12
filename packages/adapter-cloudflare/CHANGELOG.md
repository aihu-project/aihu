# @aihu/adapter-cloudflare

## 14.0.0

### Patch Changes

- Updated dependencies [[`a11112b`](https://github.com/aihu-project/aihu/commit/a11112bdcd4eadaa3fbb9a366c6b692e4e74ecea), [`37a0a2e`](https://github.com/aihu-project/aihu/commit/37a0a2e83611c7654c41e43dce1ac930a23698be)]:
  - @aihu/app@10.1.0

## 13.0.0

### Minor Changes

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

- Updated dependencies [[`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88), [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88)]:
  - @aihu/app@10.0.0

## 12.0.0

### Patch Changes

- Updated dependencies [[`ac9c045`](https://github.com/fellwork/aihu/commit/ac9c04599b2fbf57c9f39a39e1c9db7fe1388028), [`ac9c045`](https://github.com/fellwork/aihu/commit/ac9c04599b2fbf57c9f39a39e1c9db7fe1388028)]:
  - @aihu/app@9.0.0

## 11.0.0

### Patch Changes

- Updated dependencies [[`c972073`](https://github.com/fellwork/aihu/commit/c972073efcd9ad94e89923432b435ea1e8de0ffa)]:
  - @aihu/app@8.1.0

## 10.0.1

### Patch Changes

- Updated dependencies [[`9bba4bb`](https://github.com/fellwork/aihu/commit/9bba4bbf177bcd266502ab9181e91478f1710704)]:
  - @aihu/app@8.0.1

## 10.0.0

### Patch Changes

- Updated dependencies []:
  - @aihu/app@8.0.0

## 9.0.0

### Patch Changes

- Updated dependencies [[`bef4c66`](https://github.com/fellwork/aihu/commit/bef4c66fb59c8d9224d131e158106713cdb0da05)]:
  - @aihu/app@7.1.0

## 8.0.0

### Patch Changes

- Updated dependencies []:
  - @aihu/app@7.0.0

## 7.0.0

### Patch Changes

- Updated dependencies []:
  - @aihu/app@6.0.0

## 6.0.0

### Patch Changes

- Updated dependencies [[`9dd7654`](https://github.com/fellwork/aihu/commit/9dd7654678da1149705e21324f6b30e9baafcd4b)]:
  - @aihu/app@5.0.0

## 5.0.0

### Patch Changes

- Updated dependencies [[`212e3e3`](https://github.com/fellwork/aihu/commit/212e3e38ae57de7e38c3211ef0223729ba1511e1), [`212e3e3`](https://github.com/fellwork/aihu/commit/212e3e38ae57de7e38c3211ef0223729ba1511e1), [`bf66339`](https://github.com/fellwork/aihu/commit/bf66339bfeb7aaf855eb23e804f099c0e7d92726)]:
  - @aihu/app@4.0.0

## 4.0.2

### Patch Changes

- Updated dependencies [[`6a0d8e4`](https://github.com/fellwork/aihu/commit/6a0d8e426fa2ab53c37fa5d1d4e6ae63ca671e0d)]:
  - @aihu/app@3.0.2

## 4.0.1

### Patch Changes

- Updated dependencies []:
  - @aihu/app@3.0.1

## 4.0.0

### Patch Changes

- Updated dependencies []:
  - @aihu/app@3.0.0

## 3.0.3

### Patch Changes

- Updated dependencies [[`a96c49b`](https://github.com/fellwork/aihu/commit/a96c49b27b42d8271664e4f1c0907cbd27e70dbe)]:
  - @aihu/app@2.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [[`fb436ac`](https://github.com/fellwork/aihu/commit/fb436ac2a1ecb6f9d570ccc05beeeab666c3ad6d)]:
  - @aihu/app@2.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [[`0ab1988`](https://github.com/fellwork/aihu/commit/0ab1988b5f546f2050fa3eaea1b0ac1a26a32f96)]:
  - @aihu/app@2.0.1

## 3.0.0

### Patch Changes

- Updated dependencies [[`eaadd45`](https://github.com/fellwork/aihu/commit/eaadd459118055e422e4ae025ceaa72be39ee17c)]:
  - @aihu/app@2.0.0

## 2.0.0

### Patch Changes

- Updated dependencies []:
  - @aihu/app@1.0.0

## 1.0.2

### Patch Changes

- Updated dependencies [[`22234fa`](https://github.com/fellwork/aihu/commit/22234fa1d34e913d84bcdbcc9c2bcf1fb315186b)]:
  - @aihu/app@0.3.2

## 1.0.1

### Patch Changes

- Updated dependencies []:
  - @aihu/app@0.3.1

## 1.0.0

### Patch Changes

- Updated dependencies [[`d42793b`](https://github.com/fellwork/aihu/commit/d42793b8258d723ae7c80179dcc82e2db8d0afc4)]:
  - @aihu/app@0.3.0

## 0.1.10

### Patch Changes

- [#215](https://github.com/fellwork/aihu/pull/215) [`c171aab`](https://github.com/fellwork/aihu/commit/c171aab4c1fc1b07b6ad35d7a3198d5bf5465f42) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix SSR mode emitting an unresolvable `_worker.js`. When `cloudflare({ ssr:
true })` ran, the generated worker did `import routes from
'./routes-manifest.js'` but the adapter never wrote that file, so `wrangler
pages dev` failed with `Could not resolve "./routes-manifest.js"` and CI fell
  back to an empty SPA shell (bad for SEO + agents). The adapter now serializes
  `AdapterContext.routes` into a `routes-manifest.js` (default-exporting the
  routes array consumed by `createRequestRouter`) and writes it to `outDir`
  before `_worker.js`, keeping the filename in sync with the handler's import
  specifier. The SSR test now exercises the real handler-source + manifest
  emission (replacing the stub that masked the gap) and asserts the worker's
  import resolves.
- Updated dependencies [[`f2005e2`](https://github.com/fellwork/aihu/commit/f2005e222bc720a8cbc69ed81cfafa0cab8d8ced), [`0628885`](https://github.com/fellwork/aihu/commit/0628885ae3948bf6432a44102f92a00ce60f040b), [`e1a6cfc`](https://github.com/fellwork/aihu/commit/e1a6cfcc9e50688592d580cd515b60c8faa50839)]:
  - @aihu/app@0.2.0

## 0.1.9

### Patch Changes

- Updated dependencies []:
  - @aihu/app@0.1.9

## 0.1.8

### Patch Changes

- Updated dependencies []:
  - @aihu/app@0.1.8

## 0.1.7

### Patch Changes

- Updated dependencies []:
  - @aihu/app@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [[`2aedc11`](https://github.com/fellwork/aihu/commit/2aedc113385896a0c9deefd6bd9e17d0f71fff4b)]:
  - @aihu/app@0.1.6

## 0.1.5

### Patch Changes

- Updated dependencies [[`f2421b1`](https://github.com/fellwork/aihu/commit/f2421b17a534d518c4f21c22d7f5e47a45c030da)]:
  - @aihu/app@0.1.5

## 0.1.4

### Patch Changes

- Updated dependencies []:
  - @aihu/app@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies []:
  - @aihu/app@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies [[`82954a5`](https://github.com/fellwork/aihu/commit/82954a576a3f558133ee9cdb18df233c3b991972)]:
  - @aihu/app@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [[`4dea3a4`](https://github.com/fellwork/aihu/commit/4dea3a4d98509742553dc654ef023cd6f8189edb)]:
  - @aihu/app@0.1.1
