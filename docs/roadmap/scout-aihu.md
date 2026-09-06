# Scout Report: Aihu v1.1+ Roadmap Survey

**Date:** 2026-05-05 · **Repo:** `c:/git/aihu-project/aihu` · v1.0 shipped 2026-05-03

---

## Section 1 — Current State

### 1A. Package Inventory (19 packages)

| Package | Purpose | Size budget | Key exports |
|---|---|---|---|
| `@aihu/signals` | Reactive primitives (signal/computed/effect/batch/untrack/lattice) | ≤1970 B | `signal`, `computed`, `effect`, `batch`, `untrack`, `latticeSignal`, `boolLatticeSignal`, `maxLatticeSignal` |
| `@aihu/arbor` | DOM tree primitives (branch/leaf/mount/slot/hydrate/each/when) | ≤2200 B | All core DOM primitives |
| `@aihu/runtime` | Lifecycle + custom-element wiring | ≤1170 B | `defineComponent`, `defineElement`, `onMount`, `onCleanup` |
| `@aihu/context` | SSR-safe context (`provide`/`inject`/`runWithContext`) | ≤300 B | `createContext`, `provide`, `inject`, `runWithContext` |
| `@aihu/data` | Reactive `createResource`, store, SSR serializer | ≤800 B | `createResource`, `createResourceStore`, `createResourceSerializer` |
| `@aihu/plugin` | Build-time plugin contract | build-only | `definePlugin`, `validatePlugin`, `RESERVED_NAMESPACES` |
| `@aihu/agent` | AgentMetadata registry; populated by compiler | ≤200 B | `registerAgentMetadata`, `getAgentMetadata`, `getAllAgentMetadata` |
| `@aihu/agent-service` | MCP tool aggregator + middleware | ≤600 B | `createAgentService`, `AgentService` |
| `@aihu/agent-readiness` | llms.txt, robots.txt, MCP server card, content-negotiation | build-time | `viteAgentReadinessIntegration`, `generateLlmsTxt`, `generateMcpServerCard`, `AI_BOT_LIST` |
| `@aihu/agent-a2a` | Google A2A protocol (SSE streaming) | ≤750 B | `mountA2aAdapter` — `/.well-known/agent.json`, `POST /a2a/tasks/sendSubscribe` |
| `@aihu/agent-acp` | BeeAI ACP protocol | ≤600 B | `mountAcpAdapter` — `/.well-known/acp-agent`, `POST /acp/messages` |
| `@aihu/router` | File-based router + Vite plugin | ≤1536 B | `createRouter`, `viteRouterIntegration`, `scanPages`, `scanLayouts` |
| `@aihu/server` | SSR + API routes + native module loader | server-only | `defineAihuConfig`, `defineRoute`, `defineLoader`, `renderToStream`, `renderToString` |
| `@aihu/app` | Vite/app orchestration; adapter interface | ≤800 B | `createApp`, `defineConfig`, `AihuAdapter` |
| `@aihu/adapter-cloudflare` | CF Workers/Pages adapter | build-time | `cloudflare(options?)` |
| `@aihu/adapter-vercel` | Vercel Build Output API v3 | build-time | `vercel(options?)` |
| `@aihu/compiler` | Rust SFC compiler (`aihu-compile` binary) + Vite plugin | Rust binary | `compile`, `aihuCompilerPlugin` |
| `@aihu/cli` | `aihu` (app/page/component/plugin/migrate) + `create-aihu` | build-time | All scaffolders |
| `vscode-aihu` | VS Code TextMate grammar + 14 snippets | n/a | Published as `fellwork.vscode-aihu` |

**Dep-free thesis:** zero non-`@aihu/*` runtime deps (peer `vite>=5` allowed for build-time pkgs). Enforced by `scripts/dep-check.ts`.

### 1B. Examples Inventory (14 directories, 21 .aihu files)

| Example | Status | Notes |
|---|---|---|
| `todo-mvc.aihu` | Self-contained | No build setup; demo-only |
| `live-counter`, `timer`, `temperature-converter`, `currency-converter`, `color-theme`, `markdown-preview` | Standalone | Each has README + `index.html` but no build pipeline |
| **`weather-card.aihu`** | **Sole `@agent` showcase** | The only example demonstrating agent block + `$expose`/`$action`/`$describe` |
| `hacker-news` | Most production-realistic | Multi-page, SSR loaders, pagination — full `vite.config.ts` |
| `blog-loader` | Worked SSR loader | `$prop route.data` + `<$suspense>` + `defineLoader` |
| `blog-router` | Client routing demo | About/index/slug pages |
| `css-pluggability` | Tailwind integration | Custom `build.ts`, no README on Tailwind wiring |
| `docs-site` | Interactive docs SPA | Uses `marked` (violates dep-free thesis at example level), rolldown bundle |

**Styling state:** Most examples use bare CSS in `@style`. None use `$reactive`/`$media`/`$when` style macros. Production-grade visual polish absent.

**Agent integration state:** Single example (`weather-card`). NO example demonstrates `@aihu/agent-service` + A2A/ACP end-to-end, no example uses `@aihu/adapter-*`, no example uses `@aihu/context`, no example uses the plugin system.

### 1C. Docs Pipeline

**12 published pages** under `docs/site/`: introduction, installation, getting-started, authoring-components, authoring-agents, authoring-plugins, reactivity, routing-layouts, data-fetching, ssr-hydration, deployment, api-reference.

**Two pipelines:**
1. `scripts/build-docs.ts` — zero-dep MD→HTML, hand-written parser. No syntax highlighting in code blocks.
2. `examples/docs-site/` — interactive aihu SPA browser using `marked` + rolldown.

**Critical gaps:**
- **No deployed public URL** — no Cloudflare Pages/Vercel/GH Pages config
- API reference docs reference `defineAgent`/`AgentRegistry` which don't exist (actual: `registerAgentMetadata`, `getAllAgentMetadata`)
- Missing docs for `@aihu/agent-a2a`, `@aihu/agent-acp`, `@aihu/context`, both adapters
- `docs/cli.md` exists but isn't in the `docs/site/` pipeline (missing from generated site)
- No search, no versioning, no changelog, no playground/live-edit

### 1D. CLI Capabilities

`aihu` sub-commands: `app`, `page`, `component`, `plugin`, `migrate` (HTML-tag → `@blockname{}` syntax converter, `--dry-run` supported).

`create-aihu` interactive scaffolder: zero-dep, prompts for project/template/PM/git, auto-detects bun > pnpm > yarn > npm.

**Missing CLI:** `aihu dev`, `aihu build`, `aihu deploy`, `aihu add <plugin>`, `aihu generate <agent>`, `aihu inspect`. The `full`/`docs` template variants currently resolve to the same minimal scaffold.

### 1E. Agent System Surface

```
@aihu/agent-readiness  (Vite plugin + static gen)
@aihu/agent-a2a        (Google A2A — SSE streaming)
@aihu/agent-acp        (BeeAI ACP)
       ↓ both depend on ↓
@aihu/agent-service    (MCP tool aggregator)
       ↓ depends on ↓
@aihu/agent            (registry)
```

Standards implemented:
- **MCP Server Card** — schema `2025-06-18` at `/.well-known/mcp/server-card.json`
- **llms.txt** + **llms-full.txt** — full spec
- **robots.txt** — RFC 9309, `AI_BOT_LIST` (9 bots)
- **MCP OAuth 2.0** — RFC 9728 resource metadata at `/.well-known/oauth-protected-resource`
- **A2A** — Google format, SSE streaming wired
- **ACP** — BeeAI format
- **Content negotiation** — `Accept: text/markdown` returns markdown with `x-markdown-tokens` header

**Compliance test suites:** `isAgentReady`, `llms-txt-spec`, `robots-rfc9309`, `mcp-server-card-schema` — these are LOAD-BEARING for any agent work.

**Critical stub:** `handleToolCall` in `@aihu/agent-service` returns `{ stub: true, result: null }` — actual component method invocation is NOT implemented (Plan 5.3 deferred). No live binding between component instance state and agent registry. `$rate-limit` parsed but not enforced. `$scope` not enforced.

---

## Section 2 — Gaps Per Work-stream

### Work-stream 1: Website + Docs
- **Have:** 12 doc pages, 2 generation pipelines, VS Code extension
- **Missing:** deployment, search, syntax highlighting, playground, versioning/changelog, complete API ref accuracy, docs for 5 packages
- **TTHW unmeasured** — TODO-001 (pre-built compiler binary) is the biggest TTHW blocker

### Work-stream 2: Examples Polish
- **Have:** `hacker-news`, `blog-loader`, `weather-card` as anchors
- **Missing:** end-to-end agent example with A2A/ACP, adapter examples (CF/Vercel), context example, plugin example, `createResourceSerializer` example, production styling
- **Standalone files** (timer/todo-mvc/etc.) lack `index.html` + build config

### Work-stream 3: SOTA Plugins
- **Have:** complete agent-readiness stack, A2A, ACP, MCP server card, OAuth typing
- **Missing:** search (no FTS or vector), SEO (no structured data/sitemap/canonical), scraping control beyond robots.txt, auth (no session/JWT/OAuth client/PKCE), data interfacing (no GraphQL client — magna integration absent), commerce (none), live-binding for agent calls, MCP streaming on `/__aihu/tools/call`, MCP resources/prompts capabilities

### Work-stream 4: DX + LSP + Agentic
- **Have:** TextMate grammar with embedded scopes, snippets, `aihu migrate`, scaffolders, HMR via Vite, dep-free check, size gate, Moon orchestration, Husky pre-commit/pre-push
- **Missing:** **Language Server Protocol** (no go-to-def, no hover, no template type-check, no diagnostics, no completions beyond snippets), `aihu dev`/`build`/`deploy`/`check` commands, browser DevTools integration, component tree viewer, dynamic completions, HMR in rolldown-first templates

---

## Section 3 — Architectural Assets

### 3A. Magna Integration Status
**Aihu has zero Rust dependency on magna today.** Magna is consumed by `fellwork/api` (Axum backend), not aihu. Aihu's relationship to magna would be: aihu apps fetch from magna's `/graphql` endpoint via `@aihu/data::createResource`. No bridging code exists today.

### 3B. Build Pipeline
- **Bundler:** rolldown 1.0.0-rc.17 (NOT Vite for package builds)
- **Size check:** `scripts/size.ts` — rolldown in-memory + gzip, exits 1 on violation
- **Moon orchestration:** `^:build` ensures upstream builds before typecheck
- **Husky:** pre-commit (biome --staged), pre-push (full check:ci)
- **CI gate:** `bunx biome ci . && bun run typecheck && bun run test && bun run build && bun run size && bun run check:size-rows`
- **Mangling:** `@aihu/signals` and `@aihu/arbor` run `scripts/mangle-dist.mjs` for size budget compliance

### 3C. Test Infrastructure
- **65 TS test files** (vitest)
- **11 Rust test files** (compiler) + 16 unit tests in `render.rs`
- **4 protocol-compliance suites** (load-bearing): isAgentReady, llms-txt-spec, robots-rfc9309, mcp-server-card-schema
- **Native parity gate:** byte-for-byte equivalence between Rust SSR (`packages/server/src-native/`) and TS `renderToString`
- **Property tests:** `fast-check` for signal invariants

### 3D. Compiler Architecture
Rust binary `aihu-compile` + Node wrapper. Pipeline: `parser::sfc::parse` → `parser::template::parse_template` → `codegen::emit`. Build targets: Universal (default), Client (elides `@agent`), Server. Native SSR module via napi-rs. **TODO-001 (pre-built binaries) unresolved** — fresh installs require `cargo build --release`.

---

## Section 4 — Do-Not-Break List

### 4A. Stable v1.0 APIs
All packages declared v1.0.0; breaking changes need semver major. `_hmrReplace`, `_setMount`, `_setSignal`, `_setHydrate` are `@internal` — do NOT expose. The `AgentMetadata` index signature `[key: string]: unknown` is spec §9.1.

### 4B. Dep-Free Thesis (Learning #49)
**Zero non-`@aihu/*` runtime deps.** Hard CI gate. Plugin authors can bring deps; framework packages cannot. Only peer: `vite>=5.0.0`.

### 4C. Size Budgets
Per-package limits in `.size-limit.json` are hard CI gates. Combined browser floor ~9.3 kB gzip. Adding exports to budget-tracked packages requires limit bump justification.

### 4D. Compiler Grammar Contract
v1.0 `@blockname{}` is the ONLY accepted syntax. Five core blocks: `@state`, `@template`, `@style`, `@agent`, `@route`. Plugin blocks: `@plugin-name.block-name{}`. `@route` is non-macro-bearing (Amendment 01). New macros require RFC + version bump. `aihu migrate` must remain functional for v0 users.

### 4E. SSR Parity Contract
Rust SSR must maintain byte-for-byte parity with `ssr.ts`. `native-parity.test.ts` is the gate.

### 4F. Agent Stack Protocol Versions
- MCP card schema `2025-06-18` (DO NOT downgrade)
- `AI_BOT_LIST` additions OK; removals not
- `/.well-known/agent.json` and `/.well-known/acp-agent` URLs are published conventions
- `__aihu_plugin: true` brand on `Plugin` objects must be preserved

### 4G. Stub Coordination
`handleToolCall` stub is intentional (Plan 5.3 deferred). Any v1.1 work attempting real component method invocation must coordinate with the arbor `AgentContext` stub and `MountScope.agent` surface. Full live-binding NOT yet designed.

### 4H. VS Code Extension
TextMate scopes (`meta.block.state.aihu source.ts`, etc.) are part of the contract. Any new block type must be added to grammar + extension before shipping in compiler.

---

## Appendix: Key Files

- Compliance tests: `packages/agent-readiness/tests/compliance/`
- v1 framework plan: `docs/superpowers/plans/2026-05-02-aihu-v1-framework.md`
- Spec quartet: `docs/superpowers/specs/2026-05-02-spec-{block-structure,template-attribute-syntax,macro-vocabulary,plugin-contract}.md`
- Open TODOs: `docs/TODOS.md`
- TTHW log: `docs/tthw-log.md`
- CI gate: `package.json` → `check:ci`
- Size budgets: `.size-limit.json`
- Best end-to-end example: `examples/hacker-news/`
- Agent showcase: `examples/weather-card/weather-card.aihu`
- Reactive showcase: `examples/todo-mvc/todo-mvc.aihu`
