# TODOS

**2026-09-10 pass:** most of the compiler/agent items below predate the
`aihu-compiler` / `aihu-agent` / `aihu-dom` extractions and describe code
that no longer lives in this repo. Each item below has been re-verified
against the current extracted repos; items confirmed fixed are marked
`FIXED` inline with evidence, items that are now real satellite-repo bugs
have been routed as issues there (linked inline), and items that still need
a design call are left open as-is.

## Compiler / language (added 2026-07-10)

### aihu-tsc — DONE (2026-07-13); remaining follow-ups
- **Shipped:** `@aihu/tsc` (`aihu-tsc`) projects each `.aihu` into the TypeScript
  program as a VIRTUAL file via Volar's `proxyCreateProgram`. The vite plugin no
  longer writes `*.aihu.ts`, and the scaffolded `typecheck` script now runs
  `aihu-tsc` instead of `tsc` (plain `tsc` cannot see inside a `.aihu` and reports
  a clean pass over every SFC without checking one).
- **Follow-ups:**
  - Consumers can drop `*.aihu.ts` from `.gitignore` once on the new compiler, and
    delete any sidecars still on disk.
  - `aihu-compile <file> --out <dir>` still writes a `<tag>.aihu.ts` into the OUT
    dir. Harmless (it is not next to the source) but now pointless — remove.
  - Wire `.aihu` diagnostics into `@aihu/language-server` from the same surface, so
    the editor and `aihu-tsc` cannot disagree. Its `state-generator.ts` is a second,
    weaker generator and should be retired.

### `signal(null)` infers `T = null` — untyped signals across the corpus (added 2026-07-12) — ROUTED to aihu-dom

**Routed:** `@aihu/signals` now lives in `aihu-project/aihu-dom` (extracted).
Re-verified still reproducing against current `aihu-dom` source
(`packages/signals/src/signal.ts:496`, single generic overload, no
`null`/`undefined` special case). Tracked as
[`aihu-dom#5`](https://github.com/aihu-project/aihu-dom/issues/5).
- **What:** `const [doc, setDoc] = signal(null)` gives `T = null`, so `doc()` is
  `null`, `setDoc(realDoc)` is an error, and every member read off it lands on
  `never`. Same for `signal([])` → `never[]`. Wants `signal<Doc | null>(null)`.
- **Why:** Now that @state is actually type-checked, this single idiom is the
  dominant source of diagnostics in the fellwork web app (15 files; it accounts
  for most of the ~274 substantive errors the new sidecar surfaces). It was
  invisible before only because the script was never handed to tsc.
- **Note:** this is app-side authoring, not a compiler bug — but the corpus has
  to be migrated before `.aihu` type-checking can be made blocking.

### TS type-check sidecar — remaining harvest gap — PARTIALLY FIXED
- **Compiler source moved to `aihu-project/aihu-compiler`** (extracted). Re-verified
  against current source:
  - **loop aliases — FIXED.** `{#each xs as m}` now lowers to
    `for (const [item, i] of __aihu_each(list))` against a generic-inferring
    helper, so `m` gets a real inferred type instead of `any`
    (`sidecar_ts.rs:23-26`, helper at `:251`).
  - **`$prop:` bodies — improved.** Still blanked from the lifted body, but a
    synthetic accessor declaration restores real type-checking for reads
    elsewhere in the file (`sidecar_ts.rs:1168-1188`).
  - **`$action:`/`$computed:`/collection-macro bodies — still `any`.** Explicitly
    acknowledged in the current source (`sidecar_ts.rs:1142-1144, 1206`). Tracked
    as [`aihu-compiler#14`](https://github.com/aihu-project/aihu-compiler/issues/14).

### TS type-check sidecar — completion pass
- Superseded by the harvest-gap item above for the loop-alias/`$prop`/macro-body
  specifics; the remaining piece is `aihu-compiler#14`. `packages/compiler` no
  longer exists in this repo (extracted to `aihu-project/aihu-compiler`).

### Template expressions: spread, `.map`, and array/array-like functions — FIXED
- **Verified against current `aihu-compiler` source.** The expression grammar is
  now oxc-backed (a real JS/TS parser), default-on since PR #485
  (`lib.rs:73-94`, `expr/mod.rs:1-14`). Tests directly cover spread,
  `.map()`/`.filter()`, and `Array.from` across interpolation, `{#each}`, and
  attribute-binding positions (`expr/mod.rs:492-538`), and rejected input gets a
  rich C320 diagnostic quoting the offending expression rather than an opaque
  failure.

## Deferred from go-public eng review (2026-06-02)

### WS capability-bridge auth/origin hardening (v1.x)
- **What:** Add origin checks + WS authentication to the agent-server capability bridge so only the trusted server process can send approved action invocations to a browser-owned component instance, and only authorized viewers can connect to the state stream.
- **Why:** The bridge topology's entire security argument is that the server is the *sole* policy-enforcement point and the *only* thing that can invoke the client-side opaque-ID dispatcher. A demo bridge that trusts localhost is fine for the launch recording, but in production an unauthenticated WS channel is an open remote-control surface for every mounted component.
- **Context:** Chosen topology (go-public design) is a server-mediated capability bridge: compiler emits a narrow opaque-ID client dispatcher (NOT the raw `__agentBinding`), the browser mounts the real visible component and registers that dispatcher, and the server (holding auth/scope/rate-limit via `getAllAgentMetadata()` + agent-service) forwards only approved invocations over WS. The dispatcher exposes no policy info, so the server-side gate is load-bearing.
- **Depends on:** the capability bridge + compiler opaque-ID dispatcher landing first.
- **Start at:** `@aihu/agent-server` (new package) WS handler; reuse `@aihu/auth` for viewer/session checks; enforce server→client invocation signing or a shared per-session bridge token.

### ~~`$action`/`$computed`/`$prop` dispatcher lowering (CLIENT/bridge path)~~ — FIXED (branch fix/agent-action-computed-lowering)
- **Resolved:** Two real bugs in the client/bridge dispatcher path, fixed + tested:
  - `$action` return value was swallowed — `batch(fn): void` discarded `fn()`'s result, so `return batch(() => { … return X })` returned `undefined`. Fixed: `batch<T>(fn): T` now returns the callback value (`@aihu/signals`; behavioral test in `batch.test.ts`).
  - `$prop` write invoker emitted `(v) => { name = v }` (reassigns the `const` binding → throws, never reaches the signal). Fixed: emits `(v) => name.set(v)` across all three sites (server `__agentBinding`, client `__agentDispatcher` export, in-setup `_registerAgentDispatcher`). Compiler test `agent_prop_write_uses_setter_and_action_returns_value`.
  - Reads (`() => computed()` / `() => prop()`) were already correct.
- **Net:** the capability-bridge (client) path now supports reading computed/prop, driving actions WITH return values, and writing props — so the demo can read/drive signals directly instead of via the `serialize()` snapshot workaround.

### ~~`@state` collection macros are NOT lowered in the SERVER/universal build~~ — FIXED (#327, `11323570`)
- **Resolved:** `emit_options_form` (the divergent server path that skipped lowering) was deleted rather than patched. Targets now branch in exactly one place (`emit.rs:127-131`) and `emit_function_form` runs unconditionally for client/server/universal. Verified: `--target server` emits fully lowered `$prop`/`$action`/`$computed` plus a callable `_registerAgentServerBinding`; `--target universal` is byte-identical.
- **Still true (by design, not a bug):** the module-scope `export const __agentBinding` references setup-closure locals, so it is introspection-only — never invoke it directly. The callable path is the in-setup `_registerAgentServerBinding`.
- **Residual gap — test coverage, not correctness:** there is still no insta snapshot of `--target server` output, `inject_server_binding_registration` has no Rust test, and `agent_prop_write_uses_setter_and_action_returns_value` claims to assert "all three emission sites" but sets `target = Client` and inspects only `client.js`. The whole server path leans on one TS test (`agent-server/tests/headless-compiled-dispatch.test.ts`) that **skips itself if the compiler binary is absent**.

### ~~`describe:` / `expose:` never reached any agent-facing artifact~~ — FIXED (this change)
- **What it was:** Two independent dead ends. (1) `emit_manifest` read only the retired **v1** `@agent { input / action }` keywords, so a v2 component's manifest came out `"inputs": {}, "actions": {}` — and nothing in the repo reads `agent-manifest.json` anyway. (2) More importantly, the compiler **never emitted `registerAgentMetadata` at all**, so the `@aihu/agent` registry that `agent-server`'s `buildToolDefinitions` reads was empty in every real app. `describe:` was parsed, validated, parser-tested — then dropped on the floor, reaching no artifact.
- **Why it hid:** the only manifest test in the suite (`agent_airtime_quote_manifest`) uses a **v1** fixture, so it exercised the dead path and stayed green. `registry.ts`'s doc comment ("The compiler emits `registerAgentMetadata(metadata)` at the top level of each…") described a wire that was never built.
- **Fixed:** `collect_agent_members` now also collects each entry's `describe` (gated on `expose`, so unexposed prose never leaks). New `emit_agent_metadata_registration` emits `registerAgentMetadata({ tag, state, actions })` at module scope for server/universal builds — pure data, so it is safe there. `ActionSchema` gained `describe?`; `buildToolDefinitions` now prefers the authored text over its synthesized string for both action and state tools. `emit_manifest` derives from the same walk, so the sidecar can no longer drift from the live registry.
- **Still open:** MCP `inputSchema` is still `args: { type: 'array' }` — real parameter schemas need handler-signature extraction (arity + types off the `handler:` arrow). That is a separate, larger piece and likely interacts with the `function fetchForecast(async ())` codegen bug below.

### `agent-manifest.json` has no consumers
- **What:** Every `manifest_json` reference in the repo is a compiler test. Nothing in `agent-server`, the CLI, the Vite plugin, or `plugin-agent-readiness` reads the sidecar. It is now derived from the same walk as the live registry so it cannot drift, but it remains an artifact nobody opens.
- **Decision needed:** keep it as a build-time introspection sidecar (external tools could consume it), or delete it and let `registerAgentMetadata` be the single source. Leaning delete — an unread artifact that silently disagreed with the live one is exactly how the v1/v2 drift above went unnoticed.

### ~~`@agent` block: docs say optional, compiler says required~~ — FIXED
- **Resolved:** gating moved from "has an `@agent` block" to "exposes anything". `@agent` keeps its v2 job (policy: `$scope`, `$rate-limit`); a component with exposed members and no block gets an empty `AgentBlock` — no policy, which is what declaring nothing means. Does not widen the surface: `expose:` was already an explicit per-member opt-in, and requiring a second one only made the first silently inert. Covered both ways (a component exposing nothing stays inert, block or no block).
- **Blast radius:** ten `cookbook/`+`examples/` components became agent-enabled — they had written `expose:` and were being ignored. On client builds those now carry the opaque-ID bridge dispatcher, i.e. new client weight where there was none.
- **Still open (docs/CLI):** the MCP server-card `skills` array is still hand-mirrored in `vite.config.ts` with a comment admitting manual sync, while the docs claim it is "auto-populated from the `@agent` blocks in your SFCs… aggregated at build time". Now that `registerAgentMetadata` is emitted, wiring the card off the real registry is finally possible.

### ~~`agent-weather.aihu` compiles to invalid JS~~ — FIXED (it was a class, not a file)
- **Resolved:** the reported `function fetchForecast(async ())` turned out to be one of **five** codegen bugs emitting invalid JS. Syntax-checking all 32 `cookbook/`+`examples/` components with esbuild found 5 failures; all now parse, with regression tests. Full list in the `emitted-js-validity-fixes` changeset: async `$action` arg parsing, block-body brace loss in `$computed`/`$resource`, dropped `async` across four macro kinds, `$form` leaking into the plain body, and destructured `$each` aliases tearing at the comma inside their own pattern.

### Emitted JS is never syntax-checked in CI — SCRIPT LANDED, not yet gating
- **What:** the compiler suites assert that emitted output *contains* expected substrings. Nothing asserted it is valid JavaScript. That is how five separate invalid-output bugs shipped at once, one on a documented cookbook exemplar.
- **Landed:** `scripts/check-emit-parses.ts` (`bun run check:emit-parses`). Compiles every `cookbook/*.aihu` + `examples/**/*.aihu` and parses the result with `Bun.Transpiler` — no new dependency, and it catches assignment-to-const, which esbuild's `transform` silently accepts. Reports `compile` vs `parse` failures separately.
- **NOT wired into `plan-a.yml` yet** — 16 of 59 fixtures still fail, so adding it would red the build. Wire it in once the two lists below are clear.
- **Gotcha baked into the script:** it picks the NEWEST of `packages/compiler/bin` / `target/release` / `target/debug`, not the Vite plugin's fixed precedence. The fixed order silently reads a stale `target/release` and reports already-fixed bugs as live — which it did to me on the first run.

### ~~Components emit invalid JS — macro bodies assigning to a `$prop`~~ — FIXED (CO1, `fix/prop-write-rewrite`)
- **What:** `$prop` lowers to `const count = ctx.props.count` (a callable getter with `.set`). A macro body that writes the prop directly — `count++`, `count = 0`, as `aihu-counter` authors it — emitted assignment to a `const`. That is a hard runtime `TypeError: Assignment to constant variable`, so **the cookbook counter's increment/decrement/reset were all broken**, on probably the most-copied example in the repo.
- **Resolved via option (a):** the compiler now rewrites writes to `$prop` bindings into `.set(…)` inside `$action`, `$lifecycle` and `$effect` bodies — `packages/compiler/src/expr/prop_write.rs`, an oxc AST pass with span-based splicing into the original body text. Reads are deliberately NOT touched: `count()` and bare `count` pass through byte-identical.
- **Corrected file set — the original list here was wrong in one entry, and it mattered.** `examples/hacker-news/src/pages/item/[id].aihu` **writes no prop at all**; its failure is the unrelated `$afterNavigate` bug filed directly below. The true affected set was `cookbook/aihu-counter.aihu`, `cookbook/aihu-modal.aihu`, `cookbook/ssr-hydration.aihu`, `examples/_shared/macro-test.aihu`, and `packages/compiler/tests/codemods/fixtures/todo-mvc.expected.aihu` — plus a **sixth found by diffing every `.aihu` emit in the repo pre/post fix**, `packages/templates/cf-team/template/apps/web/src/components/live-counter.aihu`, which sits outside the `check:emit-parses` glob and had therefore never been surveyed.
- **`$lifecycle` was in scope too, not just `$action`:** `cookbook/ssr-hydration.aihu` writes its props from `$lifecycle.mount`. An `$action`-only fix would have left it broken.
- **Still broken in `todo-mvc.expected.aihu`, by design:** `todos = [...todos, …]` becomes `todos.set([...todos, …])`, but the RHS read `...todos` still spreads the getter *function*. That is the separate bare-read defect in `docs/domain-hints/prop-read-form.md`, out of CO1's scope.
- **Diagnosed rather than rewritten:** destructuring / `for-of` / `for-in` into a prop is **C560** (no sound desugar without a temporary and a statement split); a prop write inside `$computed`/`$resource` is **C561** (a derivation must not mutate); `count.foo = x` warns rather than rewriting, since fixing it would require a *read* rewrite.
- **Why esbuild missed it:** `esbuild --loader=ts` transform does not perform const-assignment analysis. `Bun.Transpiler` does. The earlier 32-component sweep passed all of these.

### `$afterNavigate` lowering strips its call head, leaving a dangling `})` (bug) — FIXED; separate gate bug tracked as aihu-compiler#13
- **File:** `examples/hacker-news/src/pages/item/[id].aihu` — after CO1, the only remaining `(parse)` failure in `bun run check:emit-parses`.
- **What:** the `$afterNavigate((to) => {` head — the call expression *and* its arrow prefix — is stripped during lowering, but the body and its closing `})` are spliced through. The emit ends up as:

  ```js
  88:     // arch-5 M1: post-navigation analytics — runs after each successful nav.
  89:       if (typeof window !== 'undefined' && (window as any).analytics?.pageview) {
  90:         (window as any).analytics.pageview(to.pathname)
  91:       }
  92:     })          // ← dangling: the `$afterNavigate((to) => {` head was stripped
  ```

  The orphaned `})` is a syntax error, so the whole module fails to parse. The arrow's `to` parameter is left unbound as well.

  **2026-09-10: fixed.** `parse_state_macros` now uses a balanced-paren scanner
  (`find_paren_close`) to capture the whole `(to) => {...}` expression verbatim,
  with a regression test pinning this exact shape (`aihu-compiler`
  `state_macros.rs:1468-1500, 2722-2734`). A separate, still-open gap in the
  same emit family — a bare `afterNavigate(...)` call is only lowered when
  `@state` also declares another binding wrapper — was found while verifying
  this and caused the real production incident in aihu#744; tracked as
  [`aihu-compiler#13`](https://github.com/aihu-project/aihu-compiler/issues/13).
- **NOT a `$prop` write bug.** This file writes no prop. It was mis-attributed to the prop-write defect above; CO1 deliberately left it alone, and the negative-control test `hacker_news_item_is_unchanged_by_co1` pins that its emit is untouched. Substituting it into a prop-write brief's acceptance set would have made that slice unfalsifiable.
- **Start at:** the router-macro lowering for `$afterNavigate` / `$beforeNavigate` in `packages/compiler/src/codegen/emit.rs` — compare against how `$lifecycle` callbacks correctly keep their head and args.
- **Depends on:** nothing.

### ~~11 example components no longer compile (stale v1 syntax)~~ — FIXED (#425)
- **Resolved:** all ten non-archived files migrated to v2 (`aihu migrate --v2` chain + hand edits for the `$action name: <arrow>` colon form and stale template macros); `examples/archived/` deleted (git history is the archive). `bun run check:emit-parses` is at **0 compile / 0 parse** failures across all 58 components — including `examples/hacker-news`, whose `$afterNavigate` emit bug (above) no longer reproduces against current `main`.
- **Codemod defects fixed in the same slice:** `$lifecycle.mount: { … }` colon form, quoted `$let="…"`, `onclick={…}`-family C306 event handlers, async-arrow round-trip on the v2 idempotency path, statement-aware `@state` passthrough, trailing-comment preservation. The macro-simplification pass is now reachable via `aihu migrate --v2` (plus `--dry-run` on the standalone runner).

### ~~agent-service gate authorizes by tag, not action name~~ — FIXED
- **Resolved:** `runGate` now checks the requested action against the metadata registered for the tag — it must appear in `actions`, or in `state` (handleToolCall falls through to `getSignal` for those). The old check, `typeof binding.callAction === 'function'`, was always true, so the allowlist was dead code on the only branch that can succeed and the CLIENT was the de-facto authority.
- **Why it hid:** the existing AC11 test's fixture throws `no action:` from `callAction`, so it asserted the INVOKER's rejection, not the gate's — the same inversion mirrored in the test. New AC11b cases use a binding that succeeds for any name; verified failing against the old code, where an unadvertised `wipeDatabase` executed.
- **Residual:** when NO metadata is registered for a tag there is nothing to enforce against and the call falls through to the invoker. Not reachable by anything compiled from source (the compiler now always emits `registerAgentMetadata`), but closing it properly means giving `LiveBinding` an advertised surface.

### a2a / acp are shims that look finished (security + correctness) — FIXED
- **Agent packages moved to `aihu-project/aihu-agent`** (extracted). Re-verified
  against current source and CHANGELOGs:
  - `agent-a2a` now implements real JSON-RPC 2.0 envelopes, spec v1.0.1
    PascalCase methods, and parts-based `Message` parsing via a real
    `TaskStore` (`a2a-adapter.ts:1-20, 73-88, 245-261`; CHANGELOG 1.0.0: "The
    0.1.x wire was a shim that implemented neither the old nor the new spec;
    it is removed entirely").
  - `agent-acp` derives `params` from the incoming message and threads them
    into `handleToolCall` (`acp-adapter.ts:72-84`) — the hardcoded-`null` bug
    is fixed and explicitly called out in a code comment; deprecated in favor
    of A2A but functionally correct.
  - Both adapters now construct a real `RequestContext` (defaulting to an
    explicit `ANONYMOUS` sentinel, not "nothing") and thread it through
    `agent-service`'s `runGate` for scope/rate-limit enforcement
    (`a2a-adapter.ts:103-110,174`; `acp-adapter.ts:29-36,84`).

### Rate limiting fails open where scope fails closed — FIXED
- **Verified in current `aihu-agent/packages/agent-service`.** The guard is now
  `if (rateLimitSpec !== null)` — a declared `$rate-limit` with no plugin
  installed now returns 429 `RATE_LIMIT_MISSING` (fail-closed), not silent
  unlimited access (`agent-service.ts:322-364`). Rate-limit keys are now
  `${verifiedSub}:${tag}` off the JWT-verified principal, not caller-supplied
  `userId` (`agent-service.ts:357`).

### `@aihu/seo` duplicates `plugin-agent-readiness`, with inverted defaults — FIXED
- **Verified against `aihu-project/aihu-seo` (extracted) and core
  `plugin-agent-readiness`.** `@aihu/seo` is now an explicit "DEPRECATED
  compatibility shim over @aihu-plugin/agent-readiness" that imports the bot
  list/sitemap/robots generation directly from `plugin-agent-readiness` rather
  than duplicating it. The bot registry has one source of truth
  (`plugin-agent-readiness/src/robots.ts:61-181`). Sitemap XML-escaping is
  implemented (`sitemap.ts:26-33`). The old `disallowAiBots` default is
  preserved only as a documented, warned compatibility mapping in the seo
  shim, not a silent inverted default (`aihu-seo/src/routes.ts:25-40`).

### Docs describe unshipped behavior with no status markers — STALE (files removed)
- `docs/site/agent-discovery.md` and `authoring-agents.md` no longer exist in
  this repo — the docs site was reorganized since this was filed. No action
  needed here; if the successor docs make similar claims, file a fresh issue
  against the current file.

### SSR hydration does not work end-to-end — FIXED
- **Path keys now match.** Both sides agree on `'0'` as root, with an explicit
  shared-wire-protocol comment and a dedicated integration test
  (`packages/server/src/ssr.ts:495` `ROOT_PATH = '0'`;
  `aihu-dom` `packages/arbor/src/hydrate.ts:81` `_ROOT_PATH = '0'`;
  `tests/integration/ssr-hydrate-path-parity.test.ts`). The old
  `hydrate.0` hardcode is gone, and the hydrate `snapshot` param is now
  actively used to pre-seed signal/attr values before effects run
  (`hydrate.ts:100-114, 327, 398, 464`) rather than discarded.
- **Shadow DOM is now emitted in SSR.** Declarative shadow DOM
  (`<template shadowrootmode>`) is emitted from `packages/runtime/src/ssr-string.ts:552`
  and wired through `packages/server/src/ssr.ts:834`, with a test asserting
  the `shadowrootmode="open"` output (`ssr-child-adoption.test.ts:315`).

### C205 is a stale hard error rejecting valid code — DONE (#424)
- **What:** `lib.rs` fired C205 when a plain `@state` const read a `$prop`, on the premise that the prop shadow is emitted AFTER the plain body. Issue #279 hoisted prop bindings ABOVE the plain body, which fixed the TDZ this guarded against. Confirmed empirically: `const label = ctx.props.label` now emits before the plain body.
- **Resolution:** deleted the C205 emission in `lib.rs`; replaced the rejection-locking test in `cross_block_decls.rs` with two `issue424_*` tests (prop read now compiles + prop binding emitted before the plain body); updated the four docs pages. The `find_plain_const_prop_read` helper in `signals.rs` is retained (its own unit tests still pass) but is no longer wired into the pipeline. No genuinely TDZ-unsafe construct depended on this guard.

### Shard prerequisites (only if pursuing topcoat-style server fragments)
- Ordered; each blocks the next. Recorded from the feasibility pass so the shape isn't re-derived.
- 1. The two SSR mismatches above — prerequisite for everything. **Satisfied as of 2026-09-10** (see "SSR hydration does not work end-to-end — FIXED" above).
- 2. **Signal pre-seeding.** **Satisfied as of 2026-09-10** — `hydrate()`'s `snapshot` param is no longer discarded; `_seedSignal`/`_seedAttrs` (aihu-dom `hydrate.ts:100-114`) now pre-seed values before effects run.
- 3. **SSR for structural nodes.** `renderNodeAsync` handles `leaf` and `branch`, then falls through to `enqueue('')` — `when()`/`each()` render to the empty string. No shard may contain a list or conditional.
- 4. **A `hydrateFragment(node, host, pathPrefix, parentScope)` entry point.** Today `pathBase` is hardcoded and there is no way to hydrate against an EXISTING scope, so a fragment can't splice into its parent's disposal chain.
- 5. **The endpoint layer.** No server-function / RPC / action concept exists anywhere in `router` or `server` (grepped: zero hits). Registry, stable IDs, protocol, and client-signal serialization all need building.
- **Reusable as-is:** fragment-mode `renderToString` (omit `head`), the hydration walker's wire-don't-recreate algorithm, `ChildScope` + `_teardownChildScope` + `_mc` as the region swap primitive, `effect()` for invalidation, `defineApiRoute` as endpoint substrate.
- **Recommendation:** restrict v1 shards to `shadowMode: 'light'` — those route CSS through `virtual:aihu-utility/<hash>.css` and sidestep the constructable-stylesheet problem entirely, since a server fragment cannot carry `adoptedStyleSheets`.

### MCP tools still ship without parameter schemas — FIXED
- **Verified against current `aihu-compiler` source.** `mcp_schema.rs` ("DE5")
  replaces the old `args: {type:'array'}` shape with named, typed JSON-Schema
  properties derived from the parsed handler signature, with a documented
  TS→JSON-Schema mapping and tests confirming the old shape is gone
  (`mcp_schema.rs:1-7, 34-41, 103-142, 223-235`).

### plugin-agent-readiness serves deprecated / non-spec discovery endpoints (bug) — MOSTLY FIXED
- **Re-verified against current core source.**
  1. **Agent card — fixed.** `vite-plugin.ts:20-22` now serves the canonical
     `/.well-known/agent-card.json`, with `/.well-known/agent.json` kept as a
     deliberate, documented deprecated alias (not the only path served).
  2. **OAuth well-knowns — fixed.** `mcp-server-card.ts:128-133` deliberately no
     longer advertises `/.well-known/oauth-protected-resource` /
     `-authorization-server` without serving them ("a dangling unserved
     advertisement is worse than none").
  3. **`mcp.json` / `mcp/server-card.json` — still served, but no longer a false
     conformance claim.** Both are now explicitly documented as non-standard,
     speculative endpoints with SEP-1649's closed status called out in-source
     (`mcp-server-card.ts:1-9`, `mcp-discovery.ts:3-7`). Serving them is now a
     documented choice, not a silent spec-compliance bug — no further action
     needed unless the project wants to drop them outright.

### Adopt ARD (`/.well-known/ai-catalog.json` + robots.txt `Agentmap:`)
- **What:** [Agentic Resource Discovery](https://agenticresourcediscovery.org/spec), announced 2026-06-17 by Google, Microsoft, GitHub, Hugging Face, Cisco, Databricks, NVIDIA, Salesforce, ServiceNow, Snowflake. A `/.well-known/ai-catalog.json` listing `application/a2a-agent-card+json` and `application/mcp-server-card+json` entries, plus an **`Agentmap:` robots.txt directive mirroring `Sitemap:`**.
- **Why it matters here:** `Agentmap:` is the single clearest technical convergence point between the crawler and agent worlds — the one place the two audiences share a mechanism *by design* rather than by our construction. It is the standards-backed version of the unified-discoverability surface we were about to design ourselves.
- **Status:** v0.9 draft, one month old, Apache-2.0. Real backing, but do not over-index. Track it; don't bet the design on it yet.
- **Depends on:** the endpoint-correctness item above (ARD entries reference the A2A and MCP cards, so those paths must be right first).

### Bare boolean attributes are stripped in templates (bug) — FIXED
- **Verified against current `aihu-compiler` source.** `parse_attr("disabled")`
  now returns `Attr::Static{name:"disabled", value:""}`
  (`directives.rs:1272-1278`), and codegen serializes it as `disabled: ''`
  rather than dropping it (`template_emit.rs:1423-1434`). An adjacent W602
  diagnostic warns when authors over-specify a non-empty value.
