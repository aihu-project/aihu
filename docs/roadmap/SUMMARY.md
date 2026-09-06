# Aihu v1.1 Roadmap — Master Summary

**Synthesized:** 2026-05-05 · **Sources:** `_user-directives.md`, `scout-aihu.md`, `scout-magna.md`, `arch-1-website.md`, `arch-2-examples.md`, `arch-3-plugins.md`, `arch-4-dx-tools.md`

---

## 1. Executive Overview

**The v1.1 thesis:** Aihu v1.1 converts the framework from a shipped artifact into a living, discoverable product — a homepage playground proves its value in 30 seconds, a language server makes it productive in any editor, and a live-binding architecture makes every component natively callable by AI agents. These three capabilities, delivered in strict dependency order, define the release.

**Top 5 strategic outcomes:**

1. Any visitor to `aihu.dev` can compile and run an Aihu SFC in under 30 seconds without installing anything (homepage playground + WASM compiler).
2. Any developer can `npm create aihu` and have a running project in under 5 minutes (pre-built binaries, `aihu dev` CLI).
3. Any VS Code / Neovim / Helix user gets IntelliSense, diagnostics, and hover docs for every macro without configuration (LSP M2).
4. Every `@agent` block in every deployed Aihu app becomes a live, secure, rate-limited tool callable by MCP-compatible AI agents (live-binding, M1 keystone + M2 plugins).
5. The framework's own documentation site is the premier dogfood — built with Aihu, deployed on Cloudflare, agent-ready from day one, and the source of truth for 13 canonical examples.

**Critical path callout — these three gate everything else:**

- **Live-binding RFC ratification** (arch-3 §3) — gates all agent-interactive plugins (auth scope enforcement, rate-limit enforcement, all M2+ plugin tool calls). No M2 plugin ships before this is real.
- **WASM compiler build** (arch-4 §4.6) — gates the homepage playground (arch-1 M1). M1 priority alongside pre-built binaries, not deferred.
- **Homepage playground** (arch-1 M1 + arch-2 preset snippets) — the flagship "flex." Not a placeholder. Not a mockup. A working, sub-200ms compiler in the browser with 6 presets at launch.

---

## 2. User Directives (Enforced Verbatim)

**Directive 1 — Interactive playground on homepage is P0**

> The homepage MUST embed an interactive Aihu playground. This is the flagship "flex of our code power" — the single artifact that proves the framework's value to a visitor in under 30 seconds. It is not a M3/M4 nice-to-have; it is M1 across all relevant work-streams.

**Acceptance criteria (non-negotiable):**

1. M1 includes a working playground — not a placeholder, not a mockup.
2. Compile latency target: < 200ms for a 50-line `.aihu` source.
3. Playground bundle size budget: < 1 MB initial JS (the compiler.wasm can lazy-load).
4. URL-encoded snippet sharing: works.
5. Mobile responsive: editor + preview stack vertically below 768px.
6. Six preset examples loaded at launch (counter, todo, agent-block, ssr, route, plugin).

---

## 3. Cross-Cutting Priorities

### P0 — Week 1-2 (blocks everything)

| Item | Owner | Blocking |
|---|---|---|
| Pre-built compiler binaries (TODO-001) | A4 §4 | TTHW, playground, StackBlitz, all consumers |
| WASM `aihu-compile` build (wasm-bindgen) | A4 §4.6 | Homepage playground (A1 M1 flagship) |
| Homepage playground `<playground-embed>` live | A1 §3.5 / A2 §7 | User Directive 1; flagship deliverable |
| `aihu dev` + `aihu build` CLI commands | A4 §3 | TTHW_UI ≤5 min metric |
| Live-binding RFC ratification (§3 arch-3) | A3 §3 | Every M2+ plugin tool call; scope/rate-limit enforcement |
| `getAllAgentMetadata` export in `@aihu/agent` | A4 §6.3 | `get_agent_manifest` tool; agent-host MCP server |
| `apps/docs/` scaffold + CF Pages deploy | A1 M1 | All doc content delivery |
| 6 polished baseline examples (EX-01..05, EX-08) | A2 M1 | Playground presets |

### P1 — M2 (weeks 3-5)

| Item | Owner |
|---|---|
| LSP basics (hover, completions, structural diagnostics) | A4 §2 |
| Core 4 plugins: `@aihu/auth`, `@aihu/magna`, `@aihu/seo`, `@aihu/scraping` | A3 M2 |
| Advanced examples EX-06, 07, 09-13 | A2 M2 |
| Full doc migration (12 existing pages + 5 new package docs) | A1 M2 |
| API ref corrections (TASK-DOC-001/002) | A1 §5 |
| `LiveBinding` + `componentInstanceRegistry` in arbor | A3 §3.2 |
| Real `handleToolCall` dispatch | A3 §3.4 |
| `@aihu/magna` bridge package skeleton + SDL codegen | A3 §2.6 |

### P2 — M3+ (weeks 6+, some v0.2-gated)

| Item | Owner | Gate |
|---|---|---|
| `@aihu/search` (FTS path) | A3 M3 | magna v0.2 FTS |
| `@aihu/commerce` (upsert/bulk) | A3 M3 | magna v0.2 upsert |
| `@aihu/agent-acp-ext` | A3 M3 | magna v0.2 / live-binding |
| LSP advanced (go-to-def, cross-block type check) | A4 M3 | LSP basics (M2) |
| `@aihu/agent-host` MCP server (9 tools) | A4 M4 | `getAllAgentMetadata` |
| `packages/devtools/` + `aihu inspect` | A4 M5 | dev-bridge event pipeline |
| Pagefind search + `<search-modal>` | A1 M3 | apps/docs deployed |
| Per-example pages + gallery (arch-2 M3) | A2 M3 | apps/docs (A1) |
| Versioning + community + blog | A1 M4 | full doc pipeline |

---

## 4. Dependency Graph

```
                  ┌────────────────────────────────────────┐
                  │  Pre-built binaries (TODO-001)         │
                  │  + WASM aihu-compile build             │
                  └──────────────────┬─────────────────────┘
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        ▼                            ▼                            ▼
   Homepage Playground       TTHW_UI ≤5 min           StackBlitz support
   (arch-1 M1 FLAGSHIP)      aihu dev/build CLI       in examples
        │
        ├── arch-4 WASM target ────────────────── REQUIRED (gates M1)
        ├── arch-2 6 preset snippets ──────────── REQUIRED (gates M1)
        └── arch-1 <playground-embed>.aihu ────── REQUIRED (gates M1)


   Live-binding RFC (arch-3 §3)
        │
        ├── componentInstanceRegistry ────────► arbor/mount.ts
        ├── __agentBinding compiler emission ──► compiler @agent codegen
        ├── real handleToolCall ───────────────► agent-service.ts
        │
        ▼ gates ALL of:
   @aihu/auth ($scope enforcement)
   @aihu/search (agent search tool)
   @aihu/commerce (cart mutations)
   @aihu/agent-acp-ext (all ACP tool dispatch)
   examples EX-06, EX-07 (no fake stubs)


   getAllAgentMetadata export (packages/agent/src/index.ts)
        │
        ├──► agent-service handleToolCall manifest lookup
        ├──► agent-host get_agent_manifest tool (arch-4 §6.3)
        └──► devtools Agent Registry panel (arch-4 §5.3)


   LSP basics M2 (language-server package)
        │
        ├──► VS Code extension LSP client activation
        ├──► Neovim / Helix config snippets
        └──► editor adoption ──► community contribution velocity


   apps/docs/ (promote from examples/docs-site/)
        │
        ├──► aihu.dev live site (A1 M1)
        ├──► doc migration landing location (A1 M2)
        └──► examples gallery /examples (A2 M3)


   @aihu/magna bridge package
        │
        ├──► @aihu/auth (service-role JWT relay to RLS)
        ├──► @aihu/data $resource macro lowering
        ├──► @aihu/search (FTS queries, v0.2)
        ├──► @aihu/commerce (typed product/cart resources)
        ├──► @aihu/seo (sitemap pagination)
        └──► @aihu/agent-acp-ext (service-role data queries)


   magna v0.2 (external dependency, not controlled)
        │
        ├──► @aihu/search FTS path (Typesense webhook is fallback)
        ├──► @aihu/commerce upsert + bulk ops
        └──► @aihu/agent-acp-ext NOTIFY SSE streaming
```

---

## 5. Unified Milestone Schedule

### M1 — Weeks 1-2: Foundation

**Theme:** Ship the flagship. Every consumer of the WASM compiler and pre-built binaries unblocks.

| Deliverable | Arch | Acceptance |
|---|---|---|
| Tag `v1.0.0` → release workflow → 5-platform binaries | A4 | `npm install @aihu/compiler` fetches binary <5s |
| `aarch64-linux` added to release matrix + postinstall | A4 §4.2 | CI cross-compiles via `cross` |
| SHA256 sidecar generation + postinstall verification | A4 §4.3 | Tampered binary rejected |
| **WASM build of `aihu-compile`** | A4 §4.6 | Loads in browser; compiles 50-line SFC <200ms |
| `aihu dev` + `aihu build` commands | A4 §3 | Works end-to-end |
| `create-aihu` scaffolds `.mcp.json` | A4 §6.6 | Cursor/Claude Desktop reads it |
| Live-binding RFC ratified — `LiveBinding` + `componentInstanceRegistry` | A3 §3.2 | Reviewed, merged; not yet shipped to npm |
| `__agentBinding` compiler emission | A3 §3.2 | Compiler test fixture emits shape |
| Real `handleToolCall` dispatch | A3 §3.4 | Returns real signal value; 401 without JWT; 429 over rate-limit |
| `apps/docs/` scaffold + CF Pages deploy | A1 M1 | `aihu.dev` serves homepage |
| **`<playground-embed>` working — not placeholder** | A1 §3.5 | <200ms; 6 presets; URL sharing; mobile |
| 6 preset snippets (counter, todo, agent-block, ssr, route, plugin) | A2 §7 | Each ≤50 lines; <200ms |
| `examples/_shared/` shared library | A2 M1 | tokens.css, example-shell, agent-panel (minimal) |
| Polish EX-01..05 + EX-08 | A2 M1 | Smoke tests pass; `@agent` in every example |
| CI smoke tests for EX-01..05 | A2 M1 | Green in CI |
| Archive markdown-preview; delete my-counter; move dist artifacts | A2 M1 | No orphans |
| `scripts/dev-examples.ts` parallel launcher | A2 M1 | `bun run dev:examples` works |
| TTHW_UI measured + recorded | A4 §4.5 | ≤5 min cold install |

### M2 — Weeks 3-5: Plugins Core + LSP Basics + Full Docs

| Deliverable | Arch | Acceptance |
|---|---|---|
| `@aihu/auth` (JWT, `<$guard>`, scope, magna RLS relay) | A3 M2 | Auth-gated page reads from magna; `$scope` enforced |
| `@aihu/magna` (full bridge: createMagnaResource, SDL codegen, magna-gqlmin optional) | A3 M2 | `beforeCompile` runs `magna export-sdl`; types generated |
| `@aihu/seo` (sitemap, JSON-LD, canonical, OG) | A3 M2 | Sitemap valid; JSON-LD in head |
| `@aihu/scraping` (rate-limit, bot detection) | A3 M2 | 429 on excess; AI_BOT_LIST enforced |
| `packages/language-server/` with @state virtual file | A4 M2 | Builds and starts |
| Hover docs for all 39 macros | A4 M2 | Hover over `$computed` shows description |
| Macro completions per block; structural diagnostics | A4 M2 | Unknown macro flagged |
| VS Code LSP client + marketplace publish | A4 M2 | Extension version bump |
| Neovim + Helix configs at `editors/` | A4 M2 | Documented in installation page |
| LSP completion <100ms p95 | A4 M2 | CI benchmark gate |
| `aihu deploy/check/add/generate` commands | A4 M2 | Works end-to-end |
| 12 existing docs migrated under new IA | A1 M2 | New URLs work |
| `docs/cli.md` added to pipeline | A1 M2 | Appears at `/docs/packages/cli` |
| All 10 TASK-DOC items completed | A1 §5 | API ref accurate |
| `scripts/check-doc-coverage.ts` CI gate | A1 M2 | 100% public exports documented |
| Lighthouse 95+ on `/docs/introduction` | A1 M2 | CI gate |
| Advanced examples EX-06, 07, 09-13 | A2 M2 | Smoke tests pass; agent-panel shows stub badge |
| `examples/README.md` portfolio rewrite | A2 M2 | All 13 listed |

### M3 — Weeks 6-9: Plugins Advanced + LSP Advanced + Website Live

| Deliverable | Arch | Acceptance |
|---|---|---|
| `@aihu/search` (Typesense webhook now; FTS on magna v0.2) | A3 M3 | Search proxied; agent `search/search` tool callable |
| `@aihu/commerce` (Stripe HMAC webhook, CRUD; upsert on v0.2) | A3 M3 | Webhook validates; `useCart()` reactive |
| `@aihu/agent-acp-ext` (service-role + NOTIFY SSE) | A3 M3 | ACP skill dispatch through handleToolCall |
| RFC-002 `$cart` macro ratified | A3 M3 | Compiler accepts; spec updated |
| Multi-instance dispatch (`instanceId` parameter) | A3 M3 | Two `weather-card` instances respond distinctly |
| `@template` virtual file + cross-block type check | A4 M3 | `{{ count.toFixed(2) }}` flagged when `count: string` |
| Go-to-definition from `<MyComp />` | A4 M3 | Works VS Code + Neovim |
| Code actions: "Convert to `$computed`", "Extract component" | A4 M3 | Quick-fix menu |
| Zed extension draft | A4 M3 | Basic activation |
| Pagefind index + `<search-modal>` (Cmd+K) | A1 M3 | 10/10 canonical queries pass |
| Standalone `/playground` (StackBlitz hacker-news) | A1 M3 | Requires TODO-001 shipped |
| "Open in Playground" buttons on guides | A1 M3 | Each guide page button works |
| `<live-demo>` tab switcher | A1 M3 | Inline interactive demos |
| Examples gallery `/examples` with tag filter | A2 M3 | CSS Grid + signal filter |
| Per-example 4-panel pages | A2 M3 | All 13 examples have pages |
| Light/dark screenshots; `.stackblitzrc` for all 13 | A2 M3 | Automated CI Playwright screenshots |

### M4 — Weeks 10+: Agentic Surface + DevTools + Versioning + Community

| Deliverable | Arch | Acceptance |
|---|---|---|
| `getAllAgentMetadata()` exported from `@aihu/agent` | A4 M4 | Index.ts export |
| `packages/agent-host/` (9 tools, 4 resources, 3 prompts) | A4 M4 | `aihu mcp serve` starts stdio |
| `aihu mcp serve` CLI | A4 §3 | Cursor `.mcp.json` → `list_components()` |
| `aihu generate agent` scaffolder | A4 M4 | Generated `.aihu` compiles clean |
| TTHW_MCP ≤10 min measured | A4 M4 | Recorded |
| `packages/devtools/` (Component Tree, Signal Graph, Agent Registry, Network) | A4 M5 | `aihu inspect` opens panel |
| `dev-bridge.ts` event emission in compiler | A4 §5.2 | `signal:update` events appear |
| `aihu inspect` CLI | A4 §3 | Opens inspector |
| v1.0 snapshot at `/v1/` + version selector | A1 M4 | Pinned snapshot served |
| `scripts/gen-changelog.ts` (zero-dep) | A1 M4 | CHANGELOG generated on tag |
| Blog renderer + 2-3 launch posts | A1 M4 | `/blog/introducing-aihu` live |
| "Edit this page" + RSS + sitemap.xml | A1 M4 | All pages link; RSS valid |
| TTHW_UI ≤5 min confirmed; TODO-001 callout removed | A1 M4 | Recorded officially |
| Visual regression with Playwright | A2 M4 | Snapshots committed; CI fails on diff |
| `bun create aihu --template={blog,storefront}` | A2 M4 | Interactive shows all 3 |
| `@aihu/semantic-search` (external pgvector) | A3 M4 | Separate from `@aihu/search` |
| MCP streaming on `/__aihu/tools/call` (SSE) | A3 M4 | Streams partial results |
| Vite 8 bump evaluation | A4 M4 | Compatibility verified or deferred |

---

## 6. Risk Register (Consolidated)

### HIGH

| Risk | Source | Mitigation |
|---|---|---|
| **Live-binding security surface** — `componentInstanceRegistry` is global mutable state; new attack surface | arch-3 R3 | (a) Only `mount()` registers; (b) scope+rate-limit checked before dispatch; (c) `dispose$` prevents stale bindings. **Mandatory security review before M2 ships.** Single most security-critical new surface in v1.1. |
| **WASM compiler delivery on M1 critical path** — no current WASM build; homepage playground blocked without it | A4 §4.6 + user directive | Spike in week 1. If wasm-bindgen takes >3 days: fallback = server-side compile API endpoint with playground UI spinner. Announce delay; do not ship mockup. |

### MEDIUM

| Risk | Source | Mitigation |
|---|---|---|
| Magna v0.2 schedule (search FTS, commerce upsert, ACP NOTIFY all gate) | arch-3 R1 | All M3 plugins have production-viable external-provider fallback (Typesense for search, two-round-trip cart for commerce). Public API identical. |
| MCP spec evolution | arch-3 R2 | Compliance suite catches breaks. Budget 1 sprint per revision. |
| `magna-gqlmin` napi distribution (no per-platform `.node` pipeline in magna) | arch-3 R6 | File issue upstream. Graceful skip with warning. SDL validation optional until resolved. |
| RLS behavioral testing (pool reuse with stale session vars) | arch-3 R7 | `@aihu/auth` integration tests with concurrent JWTs asserting RLS isolation. Separate `test:integration` suite. |
| Volar dependency stability (`@volar/language-server` vs `@volar/language-core` direct) | A4 OQ-DX-01 | Start with `@volar/language-server` (M2). Refactor to direct if conflicts. |

### LOW

| Risk | Source | Mitigation |
|---|---|---|
| Multi-instance agent dispatch ambiguity | arch-3 R5 | M3 `instanceId` resolves. M2 documented. |
| `trusted_documents_only` enforcement timing | arch-3 R8 | Document in deployment guide. |
| Shiki `.aihu` grammar registration failure | A1 §9 | Test in M1; fallback `typescript`. |
| StackBlitz WebContainers + compiler binary | A2 §9.4 | Resolved by M1 WASM delivery. |

---

## 7. New Packages to Create (13 Total)

| # | Package | Owning Arch | Depends On | Milestone |
|---|---|---|---|---|
| 1 | `@aihu/auth` | A3 §2.4 | `@aihu/magna`, live-binding | M2 |
| 2 | `@aihu/magna` | A3 §2.6 | `magna-gqlmin` (optional), `@aihu/data` | M1 skeleton / M2 full |
| 3 | `@aihu/seo` | A3 §2.2 | `@aihu/agent-readiness` | M2 |
| 4 | `@aihu/scraping` | A3 §2.3 | `@aihu/agent-readiness` | M2 |
| 5 | `@aihu/search` | A3 §2.1 | `@aihu/magna` (FTS path), live-binding | M3 |
| 6 | `@aihu/commerce` | A3 §2.7 | `@aihu/magna`, `@aihu/auth`, live-binding | M3 |
| 7 | `@aihu/agent-acp-ext` | A3 §2.5 | `@aihu/agent-acp`, `@aihu/magna`, live-binding | M3 |
| 8 | `@aihu/language-server` | A4 §2 | `@volar/language-core`, `@aihu/compiler` | M2 |
| 9 | `@aihu/agent-host` | A4 §6 | `@aihu/agent`, `@aihu/compiler`, `@aihu/language-server` | M4 |
| 10 | `@aihu/devtools` | A4 §5 | dev-bridge event pipeline in compiler | M4/M5 |
| 11 | `apps/docs/` | A1 §3.1 | `@aihu/app`, `@aihu/router`, `@aihu/server`, `@aihu/adapter-cloudflare` | M1 scaffold |
| 12 | `packages/zed-aihu/` | A4 §2.7 | `@aihu/language-server` | M3 draft |
| 13 | `@aihu/semantic-search` | A3 M4 | external pgvector (NOT magna) | M4 |

**Dependency chain summary:** `@aihu/magna` is the backbone — auth, search, commerce, seo, agent-acp-ext all consume it. Live-binding (arbor + agent-service changes, not a new package) gates all agent-tool-capable plugins. `@aihu/language-server` gates `@aihu/agent-host` and editor adoption. `apps/docs/` gates the website, examples gallery, and all doc-delivery milestones.

---

## 8. Files to Modify (Most-Touched)

| File | Change | Arch | Milestone |
|---|---|---|---|
| `packages/agent/src/index.ts` | Add `getAllAgentMetadata()` export — prerequisite for `get_agent_manifest` + devtools Agent Registry | A4 §6.3 | M4 (before agent-host) |
| `packages/arbor/src/types.ts:127` | Evolve `AgentContext` from sentinel to full interface (backward compat via `'rootId' in agent` check) | A3 §3.3 | M1 |
| `packages/arbor/src/mount.ts` | Add `componentInstanceRegistry`; populate `agent` in `MountScope` | A3 §3.2 | M1 |
| `packages/agent-service/src/agent-service.ts` | Replace `handleToolCall` stub with real dispatch | A3 §3.4 | M1 |
| `packages/agent-service/src/types.ts` | Add `LiveBinding`, `InstanceRegistry` types | A3 §3.2 | M1 |
| `packages/compiler/js/postinstall.ts` | Add `linux/arm64` case + SHA256 verification | A4 §4.2-4.3 | M1 |
| `packages/compiler/js/index.ts` | Inject `dev-bridge.ts` events in dev (`__DEV__` guard) | A4 §5.2 | M4 |
| `.github/workflows/release.yml` | Add `aarch64-unknown-linux-gnu` (cross) + WASM (wasm-bindgen) + SHA256 sidecars | A4 §4 | M1 |
| `packages/cli/src/bin.ts` | Extend switch for new commands | A4 §3 | M1 (dev/build), M2 (rest) |
| `packages/vscode-aihu/package.json` + new `extension.ts` | LSP client activation | A4 §2.6 | M2 |
| `docs/superpowers/specs/2026-05-02-spec-macro-vocabulary.md` | Append plugin macros after RFC ratification | A3 §6 | M2/M3 |
| `examples/README.md` | Full portfolio rewrite | A2 M2 | M2 |
| Root `package.json` | `dev:examples` script + `apps/*` workspace | A2 M1 | M1 |

---

## 9. Decision Points Needing User Input

1. **GitHub org for plugin packages** — RESOLVED 2026-09-06. Core packages stay in `aihu-project/aihu`; independently maintained plugins may move to sibling repositories under `aihu-project`, with aihu.dev as their shared registry and documentation surface.
2. **Volar approach for LSP** (A4 OQ-DX-01) — `@volar/language-server` (faster M2) vs `@volar/language-core` direct (more control). Recommended: `@volar/language-server` for M2.
3. **Versioning UX** (A1 §3.6) — committed to path prefix `aihu.dev/v1/`. **Confirm** before DNS work.
4. **`examples/docs-site/` promotion timing** (A1 §3.1, A2 §8.1) — committed to M1 standalone PR. **Confirm.**
5. **Scope of v1.1 package commitment** — all 7 plugins shipping with fallback paths in v1.1 (search via Typesense webhook, commerce via two-round-trip), v0.2-gated upgrades documented for v1.2. **Confirm or scope down.**
6. **`aihu check` strategy** (A4 OQ-DX-02) — M2 subprocess, M3 module import. **Confirm M2 subprocess.**

---

## 10. Success Metrics (Rolled Up)

| Metric | Target | Source | Gate |
|---|---|---|---|
| TTHW_UI | ≤5 min cold | A4 §4.5 | M1 measure, M4 official |
| TTHW_MCP | ≤10 min agent → working scaffold | A4 M4 | M4 |
| **Homepage playground compile latency** | **<200ms for 50-line `.aihu`** | User Directive 1 + A1 §3.5 + A4 §4.6 | **M1 (P0)** |
| Playground bundle size | <1 MB initial; compiler.wasm lazy | User Directive 1 | M1 (P0) |
| Playground preset snippets | 6 at launch | User Directive 1 + A2 §7 | M1 (P0) |
| Pre-built binary install | <5s | A4 §4.5 | M1 |
| LSP completion latency | <100ms p95 | A4 M2 | M2 |
| Doc coverage | 100% public exports | A1 M2 | M2 |
| Example smoke pass rate | 100% in CI | A2 M2 | M2 |
| Lighthouse | 95+ all scores | A1 M2 | M2 (90+ M1) |
| Search relevance | 10/10 canonical | A1 M3 | M3 |
| MCP tools shipped | 9 tools, 4 resources, 3 prompts | A4 M4 | M4 |
| Editor support | VS Code+Nvim+Helix (M2), Zed (M3) | A4 §2.7 | M2/M3 |
| Hover coverage | ≥50% public exports | A4 M3 | M3 |

---

## 11. The Mantra (Directive 0)

**"Aihu is about agentic discovery and interaction for human purpose."**

The hierarchy: agents are the *means*, discovery and interaction are the *mechanism*, **human purpose is the end**. Every v1.1 deliverable is evaluated against this. The homepage playground proves the framework's value to a human in 30 seconds. The LSP makes a human productive. The agent-host lets AI agents discover and serve the human's intent inside the project. The plugin suite gives the human an agent surface they authorize and scope. v1.1 is the release where Aihu becomes discoverable by agents, in service of whatever a human is trying to build.
