# Aihu Coverage Matrix — the authoritative construct × exerciser ledger

**Status:** committed reference (Phase 2a). This is the single authoritative
map of *every* construct / intrinsic / package* against (a) the governed example
that exercises it **LIVE** (CI-built), and (b) the cookbook block that
**DOCUMENTS** it. Every current **GAP** is marked explicitly. This matrix **is**
the Phase 2b cookbook backlog and the interop-annex backlog.

Row universe is taken from the compiler, not from docs:
- binding + statement intrinsics — `the standalone compiler state-wrapper parser`
  (`BINDING_INTRINSICS` / `STATEMENT_INTRINSICS`), mirrored in
  `packages/mcp/scripts/cookbook-lib.ts` `CONSTRUCT_REGISTRY`.
- template grammar — `the standalone compiler directive parser`
  (`GRAMMAR_WORDS_EXPR` / `GRAMMAR_WORDS_BARE` / prefixes / `KNOWN_EVENT_MODIFIERS`).
- GX / output modes — `docs/plans/governed-extractability/`, `packages/app/src/config.ts`.

## Legend

| Mark | Meaning |
|---|---|
| **G1–G9** | live exerciser in that governed example (CI-built; see the governed-set table). Verified by `check:coverage-manifest`. |
| **CB:<id>** | documented by that cookbook recipe (`constructs:` frontmatter). Verified by `check:cookbook`. |
| ✅ | live **and** documented |
| 🟡 doc-only | documented in the cookbook, **no live governed exerciser** — a live-coverage gap |
| 🟡 live-only | live in a governed example, **no cookbook block** — a Phase 2b doc gap |
| ⛔ | **ZERO** coverage today — neither live nor documented. Phase 2b/3 must create both. |
| ⚠️ exception | deliberately documented-only or package-test-only (declared, not a silent absence) |
| ⤳ planned Gn | designated future live exerciser (manifest `planned`), lands in Phase 2b/3 |

## The governed set (9) — founder-ratified

The 8 subsystem anchors **plus** `agent-hub` kept separate as the agent-protocol
flagship. Enforced by `check:coverage-manifest` (exactly these 9 ids, claims
verified against source). `ci` = the `governed-examples` CI lane tier.

| ID | Example | Subsystem | ci tier | Absorbs (P3) |
|---|---|---|---|---|
| **G1** | `todo-mvc` | Core reactivity + template grammar | build | — |
| **G2** | `hacker-news` | SSR meta-framework | compile+smoke | blog-loader |
| **G3** | `layouts` | Router / layouts / navigation | build | blog-router |
| **G4** | `storefront` | Data + app-state platform | compile+smoke | — |
| **G5** | `realtime-scores` | Streaming / realtime | compile+smoke | — |
| **G6** | `css-engine-utility` | Styling system | build | css-engine-demo |
| **G7** | `agent-driven-demo` | Agent surface / GX governance | compile+smoke | — |
| **G8** | `ssg-site` **(NEW)** | SSG / static output | build | auth-magna-seo |
| **G9** | `agent-hub` | Agent protocols (A2A + ACP) | compile+smoke | — |

`ci: build` → `vite build` (todo-mvc, layouts, css-engine-utility, ssg-site — all
verified building green in 2a; ssg-site additionally runs the SSG prerender
pass). `ci: compile+smoke` → SFC compile gated by `check:emit-parses`, plus the
example's smoke/behavioral suite (server/SSR wiring is not vite-buildable in the
default lane). Tier lives in each `coverage.manifest.json`; the lane is
data-driven (`scripts/build-governed-examples.ts`).

---

## 1. Template grammar

| Construct | Live (governed) | Documented (cookbook) | Status |
|---|---|---|---|
| interpolation `{expr}` | G1,G2,G4,G7,G8,G9 | CB ×18 | ✅ |
| `if` | G1,G2,G4,G9 | CB ×6 | ✅ |
| `elseif` | ⤳ G1 (planned) | CB: agent-weather, fetch-resource, search-debounce | 🟡 doc-only (live-zero) |
| `else` | ⤳ G1 (planned) | CB: agent-weather, aihu-tabs, fetch-resource | 🟡 doc-only (live-zero) |
| `each={item, i of xs}` | G1,G2,G4,G5,G7,G8,G9 | CB ×5 | ✅ |
| `key=` | G1,G2,G4,G5,G7,G8,G9 | CB ×5 | ✅ |
| `empty` (each tail) | **G1** | CB: infinite-scroll | ✅ (G1 added in 2a) |
| `show` | **G1** | CB: aihu-accordion, aihu-modal, aihu-toast | ✅ (G1 added in 2a) |
| `html={}` | G2 | — | 🟡 live-only |
| `ref={}` | **G1** | — | 🟡 live-only (G1 added in 2a) |
| `memo` | ⤳ G1 (planned) | — | ⛔ |
| `once` | ⤳ G1 (planned) | — | ⛔ |
| `raw` | — | — | ⛔ |
| `<slot>` (+named) | G8 | CB: aihu-modal, context-provider | ✅ |
| `<group>` fragment | ⤳ G1 (planned) | CB ×7 | 🟡 doc-only (live-zero in governed) |
| `<suspense>` + fallback slot | ⤳ G2 (from blog-loader) | — | ⛔ |
| `<outlet>` | G3 | — | 🟡 live-only |
| `<shield>` | ⤳ G7 (planned) | — | ⛔ |
| `<router>` | — | — | ⛔ |
| `<navigate>` / `navigate()` | ⤳ G3 (planned) | — | ⛔ |
| `<guard>` | — | CB: guard-ui | 🟡 doc-only (live-zero) |
| `<a>` enhanced nav | G2,G3,G8 | — | 🟡 live-only |
| `prefetch="hover"` | G2 | — | 🟡 live-only |
| `<a reload>` opt-out | ⤳ G2 (planned) | — | ⛔ |

## 2. @state binding intrinsics

| Intrinsic | Live (governed) | Documented (cookbook) | Status |
|---|---|---|---|
| `state` | G1,G4,G5,G8,G9 (+more) | CB ×15 | ✅ |
| `prop` (default/describe/expose) | G2,G8 | CB ×10 | ✅ |
| `prop` `attribute:` / `reflect:` | **G8** | — | 🟡 live-only (G8 new) |
| `prop` `required:` | — | — | ⛔ (⤳ interop IN-02) |
| `derived` | G1,G4,G9 | CB ×4 | ✅ |
| `action` | G1,G2,G4,G7,G9 | CB ×15 | ✅ |
| `resource()` **intrinsic** | ⤳ G4/G5 (planned) | CB: fetch-resource | 🟡 doc-only — **examples use imperative `createResource`, never the intrinsic** |
| `stream()` **intrinsic** | ⤳ G5 (planned) | — | ⛔ **zero everywhere** |
| `controller()` | — (governed) | CB: aihu-controller, infinite-scroll | 🟡 doc-only (live-zero in governed) |
| `route()` | G2,G3,G6,G8 | — | 🟡 live-only |
| `consume()` **intrinsic** | ⤳ G4/G9 (planned) | CB: context-consumer | 🟡 doc-only — **examples use imperative `inject()`, never the intrinsic** |

## 3. @state statement intrinsics

| Intrinsic | Live (governed) | Documented (cookbook) | Status |
|---|---|---|---|
| `effect` | G1 | CB: search-debounce, theme-toggle | ✅ |
| `onMount` | G1,G5 | CB ×5 | ✅ |
| `onDispose` | G5 | CB: aihu-clock, aihu-toast | ✅ |
| `onAdopt` | **G8** | — | 🟡 live-only (G8 new — **was zero everywhere**) |
| `onAttributeChange` | **G8** | — | 🟡 live-only (G8 new — **was zero everywhere**) |
| `aria()` | — (governed) | CB: aihu-modal, aria-form | 🟡 doc-only (live-zero in governed) |
| `provide()` | G4,G9 | CB: context-provider, theme-toggle | ✅ |
| `form()` | ⤳ G4 (planned) | CB: aria-form, form-validation | 🟡 doc-only (live-zero in governed) |
| `event()` + `$emit` | ⤳ G7/G9 (planned) | — | ⛔ **zero everywhere** |
| `beforeNavigate` | ⤳ G2/G3 (planned) | — | ⛔ |
| `afterNavigate` | G2 | — | 🟡 live-only |

## 4. Directives, expose tiers, GX

| Row | Live (governed) | Documented (cookbook) | Status |
|---|---|---|---|
| `on:` events | G1,G4,G9 | CB ×8 | ✅ |
| `on:*.prevent` modifier | **G1** (on:submit.prevent) | — | 🟡 live-only (G1 added in 2a) |
| `on:*.stop/.self/.once` modifiers | — | — | ⛔ |
| `bind:value` | G1 | CB: aria-form, search-debounce | ✅ |
| `class:` directive | G5 | — | 🟡 live-only (sole user: realtime-scores) |
| `expose:'read'` | G1,G2,G4,G7,G8,G9 | CB: agent-weather | ✅ |
| `expose:'read write'` | G1,G4 | — | 🟡 live-only |
| `expose:'write'` (alone) | — | — | ⛔ |
| `expose:'public'` | ⤳ G7 (planned) | — | ⛔ |
| `describe` | G1,G2,G4,G7,G8,G9 | CB: agent-weather | ✅ |
| GX hard tier `read: verified\|{scope}\|human`, `call:` | ⤳ G7 (planned) | — | ⛔ **in examples** (exists in `check:governed` probes only) |
| standalone `@agent{}` block | G7 | CB: agent-weather | ✅ |

## 5. Routing / layouts / SSR / SSG / output modes

| Row | Live (governed) | Documented (cookbook) | Status |
|---|---|---|---|
| `@route{}` + params | G2,G3,G6,G8 | — | 🟡 live-only |
| `@route{ head }` (SEO) | G3,G8 | — | 🟡 live-only |
| `@route{ layout: }` | G3 | — | 🟡 live-only |
| dynamic `[param]` routes | G2 (⤳ G3) | — | 🟡 live-only |
| `defineLoader` | G2 | — | 🟡 live-only |
| SSR structural walk / hydration adoption | G2 (+G8) | CB: ssr-hydration | ✅ |
| `output:'spa'` (default) | G3 (+all SPA) | — | ✅ (implicit) |
| `output:'static'` (SSG) | **G8** | — | 🟡 live-only (G8 new — **was zero**) ⚠️ prerender degrades, see §9 |

## 6. Packages & platform

| Row | Live (governed) | Documented (cookbook) | Status |
|---|---|---|---|
| `@aihu/context` (provide/inject) | G4,G9 | CB: context-provider, context-consumer | ✅ |
| `@aihu/auth` (`requireAuth`) | G4 | — | 🟡 live-only |
| `@aihu/store` (defineStore ×2, `$patch`/`$subscribe`/`$onAction`, persist, serialize/hydrate) | ⤳ G4 (planned) | — | ⛔ **zero everywhere** (landed `ebceef31`, 49 unit tests, no corpus presence) |
| `@aihu/css-engine` (utility fold) | G6 | CB: tailwind-style | ✅ |
| container queries / variants | G6 | — | 🟡 live-only |
| `cn()` / `compile()` runtime | ⤳ G6 (from css-engine-demo) | — | 🟡 (planned) |
| `@aihu/primitives` (dialog/tooltip/button) | ⚠️ package tests | CB: aihu-modal, aihu-tabs, aihu-toast, aihu-accordion | ⚠️ exception (package-test-live) |
| `@aihu/agent-a2a` (A2A SSE) | G9 | — | 🟡 live-only |
| `@aihu/agent-acp` (ACP) | G9 | — | 🟡 live-only |
| `websocket` lifecycle | G5 | — | 🟡 live-only |
| `localStorage` persistence | G1 | CB: theme-toggle | ✅ |
| `definePlugin` (plugin authoring) | ⚠️ package tests | ⤳ CB recipe (P2) | ⚠️ exception (declared) |

## 7. Interop targets (the annex — proposal §5)

| Row | Live | Documented | Status |
|---|---|---|---|
| plain npm lib in `@state` | — | — | ⛔ (⤳ IN-01) |
| foreign web component wrap (+`prop attribute/reflect/required`) | — | — | ⛔ (⤳ IN-02) |
| consumed from **React** | — | — | ⛔ **zero** (⤳ IN-03) |
| consumed from **Vue** | — | — | ⛔ **zero** (⤳ IN-03) |
| consumed from **vanilla** | — | — | ⛔ **zero** (⤳ IN-03) |
| `adapter-cloudflare` | ⚠️ cf-adapter (→ annex IN-04a) | — | 🟡 annex |
| `adapter-vercel` | — | — | ⛔ **zero** (package exists; ⤳ IN-04b) |
| node / Fly serving | — | — | ⛔ (⤳ IN-04c) |
| Durable-Object state | ⚠️ agent-durable-room (→ annex IN-05b) | — | 🟡 annex |
| BYO Tailwind / UnoCSS / Pico | ⚠️ css-pluggability | — | 🟡 (⤳ interop-byo-tailwind recipe) |

---

## 8. Biggest remaining gaps — the Phase 2b / P3 backlog (prioritized)

**Tier A — ZERO-everywhere constructs the framework SUPPORTS but nothing exercises**
(these are the highest-value: a shipped capability with no proof and no teaching):

1. **`@aihu/store`** — an entire package (`ebceef31`, Pinia-style defineStore, 49
   unit tests) with **zero corpus presence**. Needs: G4 live integration (cart
   store) + ≥4 cookbook `store/` blocks (both defineStore styles, `$patch`,
   `$subscribe`, `$onAction`, persist, SSR serialize/hydrate). **Largest single gap.**
2. **`stream()` intrinsic** — zero coverage anywhere; the streaming subsystem's
   own binding intrinsic. Needs: G5 base-layer migration + `streaming/` block.
3. **`event()` + `$emit`** — agent-visible events, zero everywhere. Needs: G7/G9
   live + `agent/` block.
4. **`onAdopt` / `onAttributeChange`** — CLOSED LIVE in 2a by **G8**; still need
   cookbook `ssr-ssg/` blocks (doc side).
5. **`output:'static'` (SSG)** — CLOSED LIVE in 2a by **G8**; needs a cookbook
   block AND the framework prerender fix (§9).
6. **GX hard-tier `read:`/`call:` vocabulary** in examples — only `check:governed`
   probes it. Needs G7 live + `agent/` governance block.
7. **`memo` / `once` / `raw`** template refinements — zero. Cheap `display/` blocks + G1 `memo`.
8. **`beforeNavigate`** — zero (afterNavigate is live in G2). Needs G2/G3 + `routing/` block.
9. **`<shield>` / `<router>` / `<navigate>` / `<a reload>`** — zero. `routing/` blocks + G3/G7 live.
10. **`expose:'public'` / `expose:'write'`-alone / `prop required:`** — zero tiers.

**Tier B — INTRINSIC-vs-imperative gap** (the framework has a first-class
intrinsic; every example still uses the old imperative import):

11. **`resource()`** — examples use `@aihu-plugin/data` `createResource`. Migrate G4/G5.
12. **`consume()`** — examples use `@aihu/context` `inject()`. Migrate G4/G9.
    *(Both compile clean today via the imperative API — this is an idiom-upgrade,
    not a compile-fix. The proposal sequences it as P3, not P1.)*

**Tier C — interop direction nobody covers** (proposal §5):

13. **Consumed-from React / Vue / vanilla** — zero. IN-03 fixture recipes.
14. **`adapter-vercel` / node-Fly serving** — zero. IN-04b/c.
15. **plain npm lib / foreign WC** — zero. IN-01 / IN-02 (IN-02 is the designated
    `prop attribute/reflect/required` doc exerciser).

**Tier D — live-only rows needing a cookbook block** (live proof exists; teaching
does not): `html`, `ref`, `outlet`, `<a>`+`prefetch`, `class:`, `on:*.prevent`,
`@route{head/layout}`, `defineLoader`, `requireAuth`, `websocket`, A2A/ACP,
container-queries, `afterNavigate`, `expose:'read write'`. ~15 blocks.

---

## 9. Framework findings surfaced during 2a (for the director)

1. **SSG prerender degrades vacuously.** `ssg-site` (`output:'static'`) `vite
   build` exits **0** and emits the client SPA bundle, but the prerender
   `closeBundle` pass fails to load *any* route: Vite 8's SSR module-runner
   evaluates compiled components where `CSSStyleSheet` (and `customElements` /
   `HTMLElement` / `document`) are undefined, so each route load throws and is
   swallowed as a **warning** — no per-route `index.html` content is written, yet
   the build stays green. This is the **same "succeed-vacuously" failure class**
   the cookbook-index guard exists to prevent, now in the SSG path. A parent-
   process `globalThis` shim does **not** fix it (the module-runner context is
   isolated) — it needs an SSR DOM environment / shim inside
   `@aihu/app`'s prerender loader (`packages/app/src/prerender.ts`). **Filed for
   Phase 2b/3 as a framework fix.** Until then `output:'static'` produces a SPA
   shell, not prerendered content — the coverage is honest at the source/compile
   level (SFCs compile, head sidecars carry full SEO metadata) but not end-to-end.
2. **Only 1 of the 9 governed examples has a standalone `@agent{}` block**
   (agent-driven-demo). Several examples the proposal/docs describe as "having an
   @agent block" actually expose via per-member `expose:` metadata — the guard
   caught the over-claim. This matches the proposal's "1 of 2 in repo" note and
   is correct, but the docs elsewhere overstate `@agent{}` block prevalence.

---

## 10. Recommended Phase 2b decomposition (fleet by component-type axis)

Phase 2b (~100 cookbook artifacts) shards cleanly by the **component-type
directory** — the retrieval axis, and the natural per-builder ownership boundary.
Each shard's acceptance gate is mechanical: `check:cookbook` (frontmatter +
regenerated index) + `test:cookbook` (harness compile) + `check:coverage-manifest`
(if it touches a governed example). No cross-shard deps.

| Shard (dir) | Owns | New blocks (est.) | Anchors / gaps it closes |
|---|---|---|---|
| `display/` | render-only + light interaction | ~8 | memo/once/raw, html, ref, show variants |
| `form/` | inputs, bind, `form()` FACE, validation | ~8 | form() live doc, bind variants, on:* modifiers |
| `list/` | each/key/empty, CRUD, sort/filter, virtual | ~8 | empty, keyed-crud, infinite (migrate) |
| `container/` | slots/group/tabs/accordion/modal/toast | ~8 | group, slot named, primitives recipes |
| `async/` | resource(), suspense, loaders, debounce | ~8 | **resource() intrinsic**, suspense, defineLoader |
| `streaming/` | **stream()**, WS/SSE, live regions | ~6 | **stream() (zero)**, class:, websocket |
| `store/` | **@aihu/store** — both styles, patch/subscribe/persist/SSR | ~8 | **the largest gap** (zero everywhere) |
| `agent/` | expose/describe, @agent, **event()**, **GX tiers** | ~10 | event()+$emit, GX read:/call:, expose:public |
| `ssr-ssg/` | SSR hydration, **output:'static'**, head/SEO, **onAdopt** | ~8 | onAdopt/onAttributeChange, SSG, SEO head |
| `routing/` | @route, layouts, links, **nav guards** | ~8 | beforeNavigate, shield/router/navigate, reload |
| `interop/` | npm libs, foreign WC, **React/Vue/vanilla**, adapters, BYO CSS | ~10 | IN-01…IN-05, prop attribute/reflect/required |

Plus **~20 existing recipes** migrated into the `<type>-<subject>` naming scheme
(already carry frontmatter from #512). Single-owner (NOT sharded): the registry,
the matrix, the README, and any `planned` → live governed-set gap-closure (G4
store, G5 stream, G7 event/GX — those touch governed examples + their manifests,
so they serialize behind `check:coverage-manifest`).

**Sequencing:** the `store/`, `streaming/`, and `agent/` shards carry the Tier-A
zero-everywhere gaps and should go first (highest value, and they unblock the
matching governed-set gap-closure). `interop/` is independent and can run in
parallel throughout. Builders must fork from a base that includes this branch
(the manifests + guard) or they inherit the pre-governed contradictions.

---

*Machine-checked surfaces: the governed set + `exercises` claims →
`scripts/check-coverage-manifest.ts`; the cookbook `constructs:` coverage →
`scripts/check-cookbook-index.ts`. This doc is the human-readable join of the two
plus the gap analysis; when a gap closes, update the row here and promote the row
into `MUST_BE_LIVE` in the guard.*
