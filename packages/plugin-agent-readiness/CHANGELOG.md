# @aihu/agent-readiness

## 2.4.1

### Patch Changes

- Updated dependencies []:
  - @aihu/server@0.6.2

## 2.4.0

### Minor Changes

- [#889](https://github.com/aihu-project/aihu/pull/889) [`04da84c`](https://github.com/aihu-project/aihu/commit/04da84ca60390fb7198588afe3a5872ab134defe) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Add validated Agentmap URL configuration for robots.txt discovery.

### Patch Changes

- Updated dependencies [[`a40aba7`](https://github.com/aihu-project/aihu/commit/a40aba75cd95539427e42a4cc0686c4f4e63c6e3), [`04da84c`](https://github.com/aihu-project/aihu/commit/04da84ca60390fb7198588afe3a5872ab134defe)]:
  - @aihu/server@0.6.1

## 2.3.0

### Minor Changes

- [#768](https://github.com/fellwork/aihu/pull/768) [`788319c`](https://github.com/fellwork/aihu/commit/788319ca907d9a34ec83c7af655436555a42b4c0) Thanks [@srmcguirt](https://github.com/srmcguirt)! - llms.txt: support prose, not just link lists.

  `LlmsTxtSection` gains `body` (free markdown under the heading, before the
  links) and `LlmsTxtConfig` gains `intro` (prose after the `>` summary, before
  the first section). `links` becomes optional, so a section can be prose-only.
  Both surface on `AgentReadinessConfig` as `llmsSections[].body` and
  `llmsIntro`, and thread through `createAgentReadinessRoutes` into both
  `/llms.txt` and `/llms-full.txt`.

  **Why.** A section was previously a title plus a list of links and nothing
  else. That is enough for a docs site whose llms.txt is a table of contents,
  and not enough for a site whose llms.txt has to TEACH an agent something
  before the links mean anything — a wire protocol and its transport, a REST
  route table, the grammar for addressing content. Those are paragraphs and
  non-link bullets. fellwork.com needs all three and had to hand-roll its entire
  document instead, which is how a canonical format ends up with one dialect per
  consumer.

  `body` and `intro` are emitted verbatim and unescaped — markdown going into a
  markdown document. They are authored content, never interpolated input.

  **No behaviour change for existing configs.** A section with neither `body`
  nor `links` is still omitted; the guard widened from "no links" to "nothing to
  say". Link-only configs render byte-for-byte as before — asserted by a strict
  equality test, and verified end-to-end by regenerating `apps/docs`' llms.txt
  and diffing it against what aihu.dev serves today: identical, 1428 bytes.

### Patch Changes

- Updated dependencies [[`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`788319c`](https://github.com/fellwork/aihu/commit/788319ca907d9a34ec83c7af655436555a42b4c0), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`ff58a1b`](https://github.com/fellwork/aihu/commit/ff58a1b8d9018f0198aa8879c359e90133266b2f), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88), [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf)]:
  - @aihu/server@0.6.0

## 2.2.3

### Patch Changes

- Updated dependencies [[`ac9c045`](https://github.com/fellwork/aihu/commit/ac9c04599b2fbf57c9f39a39e1c9db7fe1388028)]:
  - @aihu/server@0.5.0

## 2.2.2

### Patch Changes

- Updated dependencies []:
  - @aihu/server@0.4.1

## 2.2.1

### Patch Changes

- Updated dependencies [[`2ef2830`](https://github.com/fellwork/aihu/commit/2ef2830aa737906d09a5d870176da34a22f20b99), [`8924c51`](https://github.com/fellwork/aihu/commit/8924c51da6e6c25fb2664a7ab6fe9c628895161d), [`27a3268`](https://github.com/fellwork/aihu/commit/27a326826ee9a4d0a9b46bf50ca31686543848fe), [`061eefb`](https://github.com/fellwork/aihu/commit/061eefb3e94fdbbe9e6f5d5301db3bcdd3fa3b22)]:
  - @aihu/server@0.4.0

## 2.2.0

### Minor Changes

- [#462](https://github.com/fellwork/aihu/pull/462) [`549448c`](https://github.com/fellwork/aihu/commit/549448cd042ba89b94ddb291be741f015c3d0d9c) Thanks [@srmcguirt](https://github.com/srmcguirt)! - GX Phase 2 — the principal gate, `call`-axis enforcement, and the unified bot registry ([#437](https://github.com/fellwork/aihu/issues/437)-GX).

  `@aihu/agent-service` gains `principal-gate.ts`: `resolvePrincipal` (request →
  one of four principal classes: anonymous / verified-agent / scoped-agent /
  human-session, derived exclusively from `AuthPlugin.verify` — never decode-only,
  never caller-supplied identity; a presented-but-invalid credential resolves to
  anonymous) and `decideEmission` (principal × surface policy → allow/deny with
  enforcement tier). The tool gate's AUTH\_\* ladder and scope check now route
  through this one gate — behavior for existing callers is unchanged (same rungs,
  same order, same messages, same rate-limit keys).

  New enforcement: the `extract.call` axis from GX Phase 1 is consumed
  server-side as a CEILING over per-member `expose:`/`$scope` — `call: 'none'`
  makes the agent surface unavailable (404-shaped), `'verified'` forces a
  verified principal for every member, `{ scope }` is met with each member's own
  `$scope` (both must pass). Surfaces with no declaration keep today's behavior
  exactly; a malformed declared value fails closed.

  The `read` axis is DECIDED by `decideEmission` but not yet enforced anywhere —
  compliance-tier derivation is Phase 3, hard-tier withholding is Phase 4.

  `@aihu/plugin-agent-readiness` unifies its bot lists into one exported
  `BOT_REGISTRY` with a tier classification (`searcher` / `user-fetcher` /
  `training-crawler`) and a `classifyBotUserAgent` classifier
  (longest-token-first, so `Googlebot-Extended` is a trainer, not search). The
  13-bot AI list, robots.txt output, and markdown negotiation are byte-identical;
  search bots (`Googlebot`, `Bingbot`, `DuckDuckBot`, `Baiduspider`, `YandexBot`)
  exist only for classification until Phase 3 derives output from `read:`.

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

- Updated dependencies [[`30ed2b5`](https://github.com/fellwork/aihu/commit/30ed2b51c215512f840b113afaa1636378e31407), [`bc0f289`](https://github.com/fellwork/aihu/commit/bc0f289ee38871cda8002e56fba3e3b8b7e34d84)]:
  - @aihu/agent@0.2.0
  - @aihu/server@0.3.0

## 2.1.0

### Minor Changes

- [#430](https://github.com/fellwork/aihu/issues/430) Consolidate `@aihu/seo` into this package; tiered AI-bot robots.txt default.
  - **New default `aiAgents: 'allow-agents'`** (was `'allow-all'`): the 13-bot list is now classified per bot — user-delegated fetchers / cited-search agents (`ChatGPT-User`, `OAI-SearchBot`, `DuckAssistBot`, `Applebot`) get `Allow: /`; training/scraping crawlers (`GPTBot`, `ClaudeBot`, `PerplexityBot`, `Googlebot-Extended`, `CCBot`, `anthropic-ai`, `Google-Extended`, `Bytespider`, `cohere-ai`) get `Disallow: /` and are explicit opt-in. New exports `AI_USER_FETCHER_BOTS` / `AI_TRAINING_CRAWLER_BOTS` (both derived from one classified registry). `'allow-all'`, `'deny-all'`, and rule arrays keep working.
  - **Runtime value guard**: an unknown `aiAgents` string (e.g. the phantom documented values `'disallow-all'` / `'allow-verified'`) now throws a helpful error naming the valid options instead of silently iterating the string's characters as rules.
  - **Wildcard block policy**: robots.txt always ends with `User-agent: * / Allow: /` (predictable output, now also in the rules-array branch) unless `wildcard: false` suppresses it or one of your own rules already targets `*`.
  - **Ported from `@aihu/seo`**: `seoLlmsSections` (llms.txt composition sugar) and the JSON-LD helpers (`JsonLdPage`, `generateJsonLd`).

## 2.0.4

### Patch Changes

- Updated dependencies [[`5a94938`](https://github.com/fellwork/aihu/commit/5a949381544afd8276a0f6f5dba10cc4561b1d1a)]:
  - @aihu/server@0.2.1

## 2.0.3

### Patch Changes

- Updated dependencies [[`f2005e2`](https://github.com/fellwork/aihu/commit/f2005e222bc720a8cbc69ed81cfafa0cab8d8ced), [`90d3174`](https://github.com/fellwork/aihu/commit/90d3174896ee03cf1756f5b92d125be45d13983f)]:
  - @aihu/server@0.2.0

## 2.0.2

### Patch Changes

- Updated dependencies [[`ec9f59b`](https://github.com/fellwork/aihu/commit/ec9f59b345116576b58f85298501d43d9ac33d61)]:
  - @aihu/server@0.1.4

## 2.0.1

### Patch Changes

- Updated dependencies [[`afead86`](https://github.com/fellwork/aihu/commit/afead86a982ca8df290f2970e3a16f5f003c0c03)]:
  - @aihu/server@0.1.3

## 2.0.0

### Major Changes

- [#171](https://github.com/fellwork/aihu/pull/171) [`7577bd1`](https://github.com/fellwork/aihu/commit/7577bd10f391b9f3996048371706c9be34b08e2e) Thanks [@srmcguirt](https://github.com/srmcguirt)! - v1.0.9 — Naming Scheme A: rename `@aihu/data` → `@aihu-plugin/data` and
  `@aihu/agent-readiness` → `@aihu-plugin/agent-readiness`.

  The two plugin-contract packages move from the framework-core `@aihu/*`
  scope into the new `@aihu-plugin/*` scope so that plugin-contract and
  framework-core surfaces can evolve at independent cadences. Decision
  record `6c7aa75b-...` (Amendment 04) ratified the scope on 2026-05-09 and
  v1.0.9 §400-416 of the v1 framework plan covers the cutover mechanics.

  **Per-package effect**

  - `@aihu-plugin/data` (new) — first publish at `1.0.0`. Same public API as
    `@aihu/data@0.1.0`; only the npm name changed.
  - `@aihu-plugin/agent-readiness` (new) — first publish at `1.0.0`. Same
    public API as `@aihu/agent-readiness@0.1.1`; only the npm name changed.
  - `@aihu/data@1.0.0` — published as a **moved stub**. The legacy name now
    installs a tiny package that re-exports `@aihu-plugin/data`. Carries
    `"deprecated"` metadata so npm surfaces the move on `npm install`.
  - `@aihu/agent-readiness@1.0.0` — same moved-stub treatment.
  - `@aihu/cli` — extends `aihu migrate` with a v1.0.9 pass that rewrites
    package.json `dependencies` blocks, static imports, dynamic imports, and
    JSDoc / Markdown URL references. Idempotent on already-renamed input.

  **Migration**

  Existing installs keep working via the deprecated stubs. To upgrade:

  ```sh
  bun add @aihu-plugin/data @aihu-plugin/agent-readiness
  bun remove @aihu/data @aihu/agent-readiness
  bunx aihu migrate
  ```

  `@aihu/agent-service` is explicitly **out of scope** for this rename and
  stays under the framework-core `@aihu/*` scope.

## 0.1.2

### Patch Changes

- [#172](https://github.com/fellwork/aihu/pull/172) [`ac63d4b`](https://github.com/fellwork/aihu/commit/ac63d4b9a2a5296de8a20b80049e2c5bbc493880) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix critical packaging bug: @aihu/server@0.1.1 shipped with optionalDependencies pinning native subpackages at 0.1.1, but those versions were never published (only 0.1.0 exists). This made @aihu/server unusable on every platform.

  Republishes all 6 server packages in lockstep at 0.1.2:

  - @aihu/server: 0.1.2 with native pinned at 0.1.2 (coherent)
  - @aihu/server-{darwin-arm64,darwin-x64,linux-x64-gnu,win32-x64-msvc}: 0.1.2 (first publish at this version)
  - @aihu/agent-readiness: 0.1.2 with @aihu/server@0.1.2 pin (was pinning broken 0.1.0)

  Reported by a downstream consumer. Bug surface includes the original workspace:\* leak in @aihu/server@0.1.0 (immutable; will be deprecated separately) and the broken transitive chain through @aihu/agent-readiness@0.1.1.

- Updated dependencies [[`ac63d4b`](https://github.com/fellwork/aihu/commit/ac63d4b9a2a5296de8a20b80049e2c5bbc493880)]:
  - @aihu/server@0.1.2
