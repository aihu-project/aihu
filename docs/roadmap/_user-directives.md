# User Directives — v1.1 Roadmap Planning

These are explicit user instructions that supersede architect autonomy where they conflict. Synthesizer must enforce.

## Directive 0 — Project Mantra (foundational, supersedes all earlier framing)

**"Aihu is about agentic discovery and interaction for human purpose."**

**Official tagline (LOCKED for marketing/hero/README/all public copy):**

> **"Aihu — agentic discovery and interaction, for human purpose."**

**Issued:** 2026-05-05, post-roadmap synthesis.

**Statement:** This is the project's North Star. It is hierarchical, not symmetric:

- **Agentic discovery** — AI agents finding, exploring, and learning the framework, the code, and the runtime state
- **Interaction** — bidirectional engagement (agents read AND write; humans direct AND observe)
- **For human purpose** — the entire AI surface exists to serve what a human is trying to accomplish

**This refines and supersedes the earlier "for humans AND AI" parallel framing.** Aihu does not treat the two audiences as equal/symmetric. AI capability is the *means*; the human's intent is the *end*. Every architectural decision should be evaluated against: "does this make agentic discovery and interaction more useful in service of a human's purpose?"

**Implications across all work-streams:**

- **A1 (website):** Hero copy must reflect the hierarchy. Replace "The framework humans write and AI agents call" with copy that centers human purpose with AI as the amplifier. Example direction: "Build for humans. Discoverable by agents. Both, on purpose."
- **A2 (examples):** Each example's "Agent surface" description should frame agent capabilities as serving the human user of the component (not as parallel functionality). The `weather-card` agent surface isn't "agents can fetch the forecast too" — it's "humans get a forecast UI; agents get a tool to fetch forecasts on the human's behalf."
- **A3 (plugins):** Plugin design must surface the human-purpose ceiling. `@aihu/auth` `$scope` enforcement, `@aihu/agent-acp-ext` skill dispatch, `@aihu/commerce` cart actions — all framed as "the agent acts within scope the human authorized."
- **A4 (DX + agentic):** The agent-host MCP server's tools (`list_components`, `get_component_metadata`, `validate_aihu_file`) are explicitly designed for "agentic discovery." The full-circle: an agent working in an Aihu project discovers the framework, helps the human build apps that themselves expose an agent surface to other agents — all in service of whatever the human is trying to accomplish.

**Brand voice guide:**
- **Use:** "agentic discovery", "human purpose", "agent-readable", "discoverable", "in service of"
- **Avoid:** Pure parallelism ("both humans and AI" without context), AI-first framing ("the framework AI uses"), human-only framing that hides the agent surface

**Updates required:**
- README.md hero (currently "humans + AI" parallel framing)
- arch-1-website.md §2.3 hero copy
- SUMMARY.md §11 closing sentence
- Brand voice guide as new docs page (M2)

---

## Directive 3 — Locked Decisions (post-roadmap review)

**Issued:** 2026-05-05, after SUMMARY.md surface to user.

### Critical-path commitments (P0)
- **Live-binding RFC** — APPROVED. Proceed with arch-3 §3 architecture (`componentInstanceRegistry` in arbor, `__agentBinding` compiler emission, real `handleToolCall` dispatch with scope + rate-limit enforcement). Mandatory security review before M2 ships.
- **WASM `aihu-compile` build** — APPROVED. M1 priority alongside pre-built binaries via `wasm-bindgen`. 3-day spike timebox; if blocked, fall back to server-side compile API endpoint with playground UI spinner (do NOT ship a mockup).
- **Homepage playground** — APPROVED. M1 flagship deliverable per Directive 1. Working `<playground-embed>` element, sub-200ms compile, 6 presets, URL sharing, mobile responsive.

### Decision answers (SUMMARY.md §9)

1. **GitHub org for plugins** — core framework and first-party packages live in `aihu-project/aihu`. Split a plugin into a sibling repository under `aihu-project` when it needs an independent release cadence, maintainer boundary, or security boundary. The aihu.dev registry is the shared discovery layer across monorepo and sibling-repo packages.
2. **Volar approach** — APPROVED — `@volar/language-server` (higher-abstraction package) for M2; refactor to `@volar/language-core` direct only if conflicts arise.
3. **Versioning UX** — APPROVED — `aihu.dev/v1/` path prefix (not subdomain). Confirmed for arch-1 §3.6.
4. **`examples/docs-site/` → `apps/docs/`** — APPROVED — M1 standalone PR before website content work begins.
5. **Scope of v1.1 plugin commitment** — APPROVED, **NO SCOPE DOWN**. All 7 plugins ship in v1.1: `@aihu/auth`, `@aihu/magna`, `@aihu/seo`, `@aihu/scraping`, `@aihu/search`, `@aihu/commerce`, `@aihu/agent-acp-ext`. v0.2-gated features (FTS native, upsert, NOTIFY streaming) ship via fallback paths in v1.1 with documented v0.2 upgrade path for v1.2.
6. **`aihu check` strategy** — APPROVED — M2 subprocess approach (`aihu-language-server --check`); refactor to module import in M3 if perf warrants.

### Implications

These decisions remove all blockers for M1 execution. The implementation order is:

**Week 1 (parallel work-streams):**
- Tag `v1.0.0` → trigger release workflow → verify 4-platform binaries on `releases/latest/download/`
- WASM compiler spike (`wasm-bindgen` integration, 3-day timebox)
- Live-binding RFC drafting in `docs/superpowers/specs/2026-MM-DD-spec-live-binding.md`
- `apps/docs/` scaffold from `examples/docs-site/` (standalone PR)
- Examples polish kick-off (EX-01 live-counter as the pilot)

**Week 2 (integration):**
- Pre-built binary postinstall + SHA256 verification
- `<playground-embed>` custom element built on WASM compiler
- 6 preset snippets curated from polished examples
- `aihu dev` + `aihu build` CLI commands
- Live-binding implementation (arbor + compiler + agent-service)

---

## Directive 1 — Interactive playground on homepage is P0

**Issued:** 2026-05-05 mid-planning, after architects A1-A4 dispatched.

**Statement:** The homepage MUST embed an interactive Aihu playground. This is the flagship "flex of our code power" — the single artifact that proves the framework's value to a visitor in under 30 seconds. It is not a M3/M4 nice-to-have; it is M1 across all relevant work-streams.

**Implications by work-stream:**

- **A1 (website)** — Homepage IA: hero copy on top, full-width playground BELOW THE FOLD on mobile / SIDE-BY-SIDE with hero on desktop. Theme-aware. URL state preserves snippets so demos are shareable. Default snippet must demonstrate signals + agent block within 10 lines (the dual-audience thesis).
- **A2 (examples)** — Each official example must have a "Open in Playground" preset. The playground's example picker pulls from the curated set. Ship at least 6 preset snippets at M1.
- **A3 (plugins)** — When plugins are loaded into the playground, agent tools panel renders live AgentMetadata. This is the fastest way for a visitor to grok "humans + AI."
- **A4 (DX)** — The compile-in-browser path is the gating dependency. WASM build of `aihu-compile` (Rust → wasm-bindgen) needs to be M1 priority, not deferred. This may require accelerating the pre-built binary work to also produce a `.wasm` artifact in the same release pipeline.

**Acceptance criteria (Synthesizer to enforce in roadmap rollup):**
1. M1 includes a working playground — not a placeholder, not a mockup
2. Compile latency target: < 200ms for a 50-line `.aihu` source
3. Playground bundle size budget: < 1 MB initial JS (the compiler.wasm can lazy-load)
4. URL-encoded snippet sharing: works
5. Mobile responsive: editor + preview stack vertically below 768px
6. Six preset examples loaded at launch (counter, todo, agent-block, ssr, route, plugin)
