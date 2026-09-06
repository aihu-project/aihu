# Architecture Spec — Examples Polish + Website Integration

**Author:** Architect A2 · **Date:** 2026-05-05 · **Branch:** `feat/examples-polish`

## 0. Orientation

13 official examples across 4 tiers. Every example demonstrates BOTH a human UX and an agent surface (even minimal `$expose` blocks). The constraint is aihu's identity: "for humans AND AI."

## 1. Curated Portfolio

### Promoted + Polished (10)
`live-counter`, `temperature-converter`, `timer`, `todo-mvc`, `color-theme`, `weather-card`, `hacker-news`, `blog-loader`, `blog-router`, `css-pluggability`

### Demoted / Archived
- `markdown-preview` → `examples/archived/` (security footgun without sanitization plugin)
- `docs-site` → promote to `apps/docs/` (it's the website, not an example)
- `my-counter/` → DELETE (`.scribe` rebrand artifact)
- `airtime-quote/dist`, `scripture-reference/dist` → move to `packages/compiler/tests/fixtures/`

### New Examples (5)
- **EX-07 `agent-hub`** — Multi-component AgentService aggregation, A2A+ACP wired
- **EX-10 `cf-adapter`** — Cloudflare Workers deploy demo
- **EX-11 `plugin-demo`** — Custom plugin with new block + macro + transform hook
- **EX-12 `realtime-scores`** — WebSocket + signals + `createResource`
- **EX-13 `storefront`** — `@aihu/data` + `createResourceSerializer` + dummy Stripe

## 2. Per-Example Definitions

| # | Slug | Tier | Key features | Port |
|---|------|------|--------------|------|
| 01 | `live-counter` | 1 | signals, `$action`, minimal `@agent` | 5101 |
| 02 | `temperature-converter` | 1 | `$bind:value`, `$computed`, `@agent` $expose C/F | 5102 |
| 03 | `timer` | 1 | `$lifecycle`, `$effect` cleanup, `@agent` reset action | 5103 |
| 04 | `todo-mvc` | 2 | `$each/$key`, **localStorage (fix v1 gap)**, agent addTodo/clearCompleted | 5104 |
| 05 | `color-theme` | 2 | `$reactive` in `@style`, `$global`, **add `$media` macro demo**, agent setPreset | 5105 |
| 06 | `weather-card` (extended) | 3 | **Replace mock w/ Open-Meteo API**, `server.ts` mounting AgentService+A2A+ACP, `viteAgentReadinessIntegration`, `$rate-limit 10/minute` | 5106 |
| 07 | `agent-hub` (NEW) | 3 | 3 sub-components, AgentService aggregation, `getAllAgentMetadata()`, A2A streaming, ACP messages, `@aihu/context` | 5107 |
| 08 | `hacker-news` (polish) | 3 | Multi-page SSR, dark-mode token pass, **add `@agent` on index page**, mobile responsive | 5108 |
| 09 | `blog-loader` (polish) | 2 | `defineLoader`, `$prop route.data`, `<$suspense>`, **add `@aihu/context` demo + `@agent` block** | 5109 |
| 10 | `cf-adapter` (NEW) | 3 | `cloudflare()` adapter, `wrangler.toml`, agent-readiness survives CF build | 5110 |
| 11 | `plugin-demo` (NEW) | 3 | `definePlugin`, custom `@forms.fields{}` block, `$forms.validate` macro, `transformBlock`/`afterCompile` hooks | 5111 |
| 12 | `realtime-scores` (NEW) | 3 | WebSocket in `$lifecycle.mount`/`dispose`, `$effect` reacts to messages, `createResource` for initial fetch + live overlay | 5112 |
| 13 | `storefront` (NEW) | 3 | `@aihu/data` `createResource` + `createResourceSerializer` (SSR-safe), `@aihu/context` cart, `$shared` cross-component, dummy Stripe `POST /api/checkout` | 5113 |

### Coverage matrix (every framework feature gets at least one demo)
- Signals/computed/effect: 01-04
- `$bind:value`: 02, 04, 05
- `$each` + `$key`: 04, 08
- `$lifecycle.mount`/`dispose`: 03, 04, 12
- **`$reactive` + `$global` (UNIQUE TO AIHU)**: 05
- `$media` / `$when` style macros: 05 (added in v1.1)
- `@agent` block (all): every example
- `@agent $rate-limit`: 06
- A2A end-to-end: 06, 07
- ACP end-to-end: 06, 07
- `@aihu/context` provide/inject: 07, 09, 13
- `defineLoader`: 08, 09, 13
- `<$suspense>`: 09, 13
- File-based routing: 08-10, 13
- `@aihu/adapter-cloudflare`: 10
- Plugin system: 11
- `createResource` / `createResourceSerializer`: 12, 13
- WebSocket + signals: 12
- `$shared` cross-component state: 13
- Recursive components: 08

## 3. Visual Design System

### Decision: vanilla CSS + custom properties + shared token file

Reasons: framework is style-agnostic (using Tailwind in shell would implicitly endorse); CSS custom properties compose naturally with `$reactive()` in `@style`; zero build dep; dark-mode via `.dark` class on `<html>`.

### Shared component library at `examples/_shared/` (NOT a workspace package)

Files:
- `tokens.css` — canonical CSS custom properties (light + dark), extending existing `docs-site/style.css` token set
- `example-shell.aihu` — page chrome (header + theme-toggle + slot)
- `agent-panel.aihu` — `getAllAgentMetadata()` inspector (mandatory in EX-06, 07, 10, 11)
- `code-tabs.aihu` — tabbed code/preview pane (docs site only)
- `device-frame.aihu`, `result-pane.aihu` — supporting

Vite alias `@shared` per example to avoid relative-path noise.

### Migration task
Audit every `@style` block in retained examples, replace hardcoded colors with `var(--token)`. Common violations: `#f7f7f7`, `#828282`, `#ff6600` (HN — keep as `var(--hn-orange, #ff6600)` brand-locked fallback).

### Mobile responsive baseline
All examples render usably at 375px viewport. Touch targets ≥44×44px. Inputs/buttons stack vertically below 480px.

## 4. Build + Run UX

### Mandatory files per example
`index.html`, `package.json`, `vite.config.ts`, `README.md`. Server examples add `aihu.config.ts`, `wrangler.toml` (CF), `.env.example`.

### Standard `package.json` shape
```json
{
  "name": "@aihu/example-{slug}",
  "private": true,
  "scripts": {
    "dev": "vite --port {PORT}",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": { "@aihu/compiler": "workspace:*", ... },
  "devDependencies": { "vite": "^5.0.0", "vitest": "^2.1.1" }
}
```

### `bun run dev:examples` parallel launcher
New `scripts/dev-examples.ts` uses `bun glob` to find all `examples/*/vite.config.ts` and spawns each on its assigned port.

### StackBlitz templates
`.stackblitzrc` per example + "Open in StackBlitz" badge in each README.

## 5. Website Integration

### Examples gallery `/examples` (M3, depends on arch-1 `apps/docs/`)

Static page from `apps/docs/src/data/examples.ts` typed manifest:
```typescript
interface ExampleMeta {
  slug, title, tagline, tier: 1|2|3, tags: string[],
  liveUrl, sourceUrl, stackblitzUrl,
  screenshotLight, screenshotDark
}
```

CSS Grid 3-col desktop / 1-col mobile. Tag chips for filtering (signals/agent/a2a/acp/ssr/routing/adapter/plugin/realtime/commerce). Client-side filter via signals (no search backend).

### Per-example page `/examples/{slug}`
4-panel layout:
1. **Live preview** — sandboxed iframe (600px height, resize handle, "Open in new tab" escape; replaced by link on mobile)
2. **Source view** — syntax-highlighted tabs per file with Copy + "Edit on GitHub" buttons
3. **"Open in Playground"** — StackBlitz link (custom playground deferred to M4)
4. **Agent tools panel** — renders `AgentMetadata`, protocol status (`/.well-known/agent.json` + `/.well-known/acp-agent` reachable from live URL); collapsed for examples without `@agent` blocks

### "Edit on GitHub" → `github.com/aihu-project/aihu/edit/main/examples/{slug}/{primaryFile}` (opens GitHub web editor)

## 6. Test + Maintenance Contract

### Smoke tests via Vitest browser mode (NOT Playwright in M1-M3)
Each example: `tests/smoke.test.ts`. Asserts mounts without errors + key interaction works. Server examples use `renderToString`. Agent examples additionally verify `getAllAgentMetadata()` returns expected entries.

### CI gate (new step in `.github/workflows/ci.yml`)
For-loop over `examples/*/` running `bun run build` + `bun run test`. Build failures block merge.

### Visual regression
Recommended but **deferred to M4** (Playwright + browser binaries adds CI cost). M1-M3 relies on smoke tests + manual review + StackBlitz links in PRs.

## 7. Phased Delivery

### M1 — 6 examples polished (3 weeks)
- `_shared/{tokens.css, example-shell.aihu, agent-panel.aihu (minimal)}`
- Polish EX-01..05 (basics tier) + EX-08 (hacker-news)
- `scripts/dev-examples.ts` + root `bun run dev:examples`
- CI gate added
- Smoke tests for EX-01..05
- Archive markdown-preview, delete my-counter, move dist artifacts to compiler fixtures
- Resolve `viteAihuPlugin` vs `viteRouterIntegration` naming inconsistency (canonical: `viteRouterIntegration`)

### M2 — Advanced examples (5 weeks)
- Polish EX-06 (weather-card with Open-Meteo + agent protocols)
- Polish EX-09 (blog-loader with context)
- Create EX-07 (agent-hub), EX-10 (cf-adapter), EX-11 (plugin-demo), EX-12 (realtime-scores), EX-13 (storefront)
- Expand `agent-panel.aihu` with protocol status indicators
- Smoke tests for EX-06..13
- Update `examples/README.md` portfolio table

### M3 — Website integration (8 weeks; depends on arch-1)
- Promote `examples/docs-site/` → `apps/docs/`
- Create `apps/docs/src/data/examples.ts` manifest
- Gallery page with tag filtering
- Per-example pages with 4-panel layout
- Light/dark screenshots committed for all 13
- StackBlitz `.stackblitzrc` for all 13

**HOMEPAGE PLAYGROUND COORDINATION (per `_user-directives.md` Directive 1):**
The homepage playground in arch-1 M1 pulls preset snippets from THIS portfolio. Six P0 presets at launch: `live-counter` (EX-01), `todo-mvc` (EX-04), `weather-card` (EX-06 — agent showcase), `blog-loader` (EX-09 — SSR), `blog-router` (routing), `plugin-demo` (EX-11 — when ready in M2). The presets must be ≤50 lines each so they compile <200ms in the embedded compiler.

### M4 — Visual regression + community (ongoing)
- Playwright snapshots
- Community contribution guide
- `examples/community/` + `TEMPLATE/`
- Evaluate `@aihu/example-kit` package promotion
- `bun create aihu --template={blog,storefront}` template variants

## 8. Open Questions / Decisions

### 8.1 Promote `examples/docs-site/` to `apps/docs/`
**YES.** It's the website, not an example. Move + update workspaces config in M1 or pre-M3 standalone PR.

### 8.2 Template variants in `create-aihu`
Three named templates (`minimal`/`blog`/`storefront`) — gated to M4. Don't add until source examples are stable + CI-tested.

### 8.3 Coordination with arch-3
- **EX-11 (plugin-demo)** depends on `@aihu/plugin` `definePlugin`/hooks stability — last M2 item
- **EX-13 (storefront)** depends on `createResourceSerializer` from arch-3 — falls back to manual JSON serialization with TODO comment if not available
- **EX-12 (realtime-scores)** does NOT depend on magna — uses plain WS server with mock data; README notes Supabase Realtime / magna NOTIFY swap path

## 9. Critical Implementation Notes

### 9.1 Dep-free thesis applies to `packages/`, NOT `examples/`
`scripts/dep-check.ts` runs only against `packages/`. Examples may use deps freely (Stripe, ws, etc.).

### 9.2 `handleToolCall` stub MUST be visible in EX-06 and EX-07
- `agent-panel.aihu` shows "Tool call stubbed — live binding pending" badge on invocation
- README states: "A2A/ACP protocol wiring demonstrated. Tool invocation results stubbed pending Plan 5.3 live-binding (arch-3)."
- Do NOT simulate fake results. Stub must be visible.

### 9.3 `$reactive` macro callout in EX-05
Per-example page for `color-theme`: callout "The `$reactive()` macro in `@style` is unique to aihu — it binds a signal directly to a CSS custom property with no JavaScript in the template." Most differentiated capability in the framework.

### 9.4 StackBlitz + WASM compiler constraint
The `aihu-compile` Rust binary won't run in StackBlitz WebContainers without WASM build. Short-term: `--startScript "bun install && bun run dev"` may fail silently. Note in per-example UI: "StackBlitz support requires pre-built compiler binaries (TODO-001 + arch-4 WASM build)." Long-term: TODO-001 + arch-4's WASM `aihu-compile` resolves it.

### 9.5 Size budget exclusion
`examples/*/` excluded from `.size-limit.json` and `scripts/size.ts`. Confirm explicit in `scripts/size.ts`.

## 10. File Map

### Create
- `examples/_shared/{tokens.css, example-shell, code-tabs, device-frame, result-pane, agent-panel}.aihu`
- `examples/agent-hub/`, `examples/cf-adapter/`, `examples/plugin-demo/`, `examples/realtime-scores/`, `examples/storefront/`
- `scripts/dev-examples.ts`

### Modify (per-example: add `@agent` block, token-pass dark-mode, `package.json`+`vite.config.ts`)
- `examples/live-counter/`, `temperature-converter/`, `timer/`, `todo-mvc/`, `color-theme/`, `weather-card/`, `hacker-news/`, `blog-loader/`, `blog-router/`, `css-pluggability/`
- `examples/README.md` — full portfolio table rewrite
- Root `package.json` — `dev:examples` script + `apps/*` workspace

### Move/Delete
- `examples/docs-site/` → `apps/docs/`
- `examples/markdown-preview/` → `examples/archived/`
- `examples/my-counter/` → DELETE
- `examples/{airtime-quote,scripture-reference}/dist/` → `packages/compiler/tests/fixtures/`

---

*End — coordinates with arch-1 (homepage playground presets), arch-3 (plugin/data dependencies), arch-4 (WASM compiler for in-browser playground)*
