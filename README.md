# Aihu

> **One component. Two audiences.** The framework for the next era of AI — where every interface has two users: the person using it, and that person's AI agent.

[![CI](https://github.com/aihu-project/aihu/actions/workflows/plan-a.yml/badge.svg)](https://github.com/aihu-project/aihu/actions/workflows/plan-a.yml)
[![release](https://github.com/aihu-project/aihu/actions/workflows/release.yml/badge.svg)](https://github.com/aihu-project/aihu/actions/workflows/release.yml)
[![@aihu/signals on npm](https://img.shields.io/npm/v/@aihu/signals.svg?label=@aihu/signals)](https://www.npmjs.com/package/@aihu/signals)
[![llms.txt](https://img.shields.io/badge/llms.txt-supported-blueviolet)](#compliance)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue?logo=anthropic)](#compliance)
[![Agent Ready](https://img.shields.io/badge/agent--ready-yes-brightgreen)](#compliance)

The next era of software gives every product a second user. The person clicks, types, and reads. Their AI agent — Claude, ChatGPT, Cursor, whatever comes next — reads the same screen and acts on their behalf. Most frameworks make you build for one and bolt on the other: a UI here, a separate API for agents there, and drift between them from day one.

Aihu makes them the same thing. You author a `.aihu` single-file component and declare what each audience may see and do. A Rust compiler emits both experiences from that one declaration — the rendered UI the human drives, and the MCP tool surface the agent drives — wired to the same live instance under the same policy. No second API layer, no drift between what the user sees and what the agent can touch.

```bash
npx create-aihu my-app --template agent   # one component, two audiences — running in one command
```

**For AI innovators** — every component ships with an agent surface by construction. Mark a `state()` or `action()` `expose` and the compiler emits a matching MCP tool schema from the same line that renders the UI. `llms.txt`, an MCP Server Card, and A2A support come out of the box, and entitlement resolves server-side — what you didn't expose doesn't exist to the agent.

**For web designers** — author in plain HTML with `{expr}` bindings, type-checked as TypeScript, compiled to vanilla custom elements on a sub-2 kB runtime. No virtual DOM, no lock-in, no hydration step. Accessible primitives, a styling engine, SSR, and first-party Cloudflare/Vercel adapters.

*Equally governs* is concrete — one declaration fills all four quadrants:

| For | Experience | Security |
|---|---|---|
| **Humans** | Reactive UI on vanilla custom elements — sub-2 kB runtime, SSR, accessible primitives | Server-held auth and policy; the agent bridge is scoped and mediated, never a back door |
| **AI** | MCP tools + llms.txt emitted from the component itself; SSR renders real content agents can read | Nothing is agent-reachable unless declared `expose` — entitlement resolved server-side, non-regressable |

An agent never fabricates a throwaway interface for the turn — it steers the component already on screen. Where generative UI renders once and vanishes, an aihu component persists and holds its own state. That persistence is what lets both audiences drive the same instance over time, and it means the user always sees the thing the agent touched. Durable wins when the UI has to be trusted, styled, and reused.

Under the hood it's a complete meta-framework — routing, SSR, auth, data loading, and cloud adapters included. The runtime is sub-2 kB, the output is vanilla custom elements with zero runtime dependencies, and reactive text updates bind directly to a cached text node, so a targeted write costs the same whether its parent has three children or ten thousand ([benchmarks below](#performance)).

> **Status:** actively developed and shipping in `v1.0.x` releases — the reactive runtime, compiler, router, server, agent surface, CLI, styling engine, and UI primitives all work today. See [Project status](#project-status).

---

## Quickstart

```bash
# The agent showcase — a live <task-list> a human AND an AI agent drive
npx create-aihu my-app --template agent
cd my-app && bun install
bun run dev      # component on http://localhost:5108 · agent bridge on :5208

# …or a minimal app
npx create-aihu my-app

# …or run the canonical examples portfolio in parallel
git clone https://github.com/aihu-project/aihu
cd aihu && bun install
bun run dev:examples
```

Browse the source-distributed component and extension catalog at
[aihu.dev/registry](https://aihu.dev/registry). `aihu add <name>` copies a
recipe into your project so you own the resulting `.aihu` source.

---

## What a component looks like

State, view, styles, and the agent interface — one `.aihu` file. This is [`live-counter`](./examples/live-counter) (7GUIs #1, ~25 LOC):

```aihu
@state {
  let count = state(0)

  const increment = action(
    { describe: 'Add 1 to the counter', expose: 'read write' },
    () => { count = count + 1 })
  const reset = action(
    { describe: 'Reset the counter to 0', expose: 'read write' },
    () => { count = 0 })
}

@template {
  <section class="counter">
    <h1>Count: {count}</h1>
    <button on:click={reset}>Reset</button>
    <button on:click={increment}>+</button>
  </section>
}

@style {
  .counter { display: grid; gap: 0.75rem; }
}
```

How to read it:

- **`state(0)`** declares a reactive field. Read it as `count`, write it with plain assignment — the DOM updates on the touched node.
- **`action({ … }, fn)`** is an ordinary method. Because it carries `expose: 'read write'`, it *also* becomes an MCP tool an agent can call on the live instance — governance at the declaration site. Nothing is agent-reachable unless you say so.
- **The template is prefix-less** — naked HTML, `{expr}` for reactive values, `on:click` for events.
- **It type-checks as plain TypeScript.** `state` / `prop` / `derived` / `action` carry identity types, so your editor and `tsc` see ordinary code; the compiler lowers them to reactive declarations underneath.
- **The output is a plain custom element** — no virtual DOM, no shipped framework runtime, light DOM by default.

---

## What you get

Everything below ships in the box — a compiler, a runtime, and an app framework, each usable on its own:

- **A tiny reactive core** — signals, computeds, and effects in under 2 kB, with direct DOM updates and no virtual DOM (`@aihu/signals` + `@aihu/arbor`).
- **A real Rust compiler** — pre-built per platform, plus a WebAssembly build for in-browser playgrounds.
- **Equal governance, declared in place** — mark state and actions `expose` and the compiler emits a matching AI tool schema (MCP) from the same declaration that renders the UI, with A2A protocol support alongside. What an agent may see and do is exactly what you exposed — enforced server-side, never inferred.
- **A complete app framework** — file-based routing, server-side rendering, loaders, cookies, and server actions (`@aihu/router` + `@aihu/server`).
- **Batteries included** — auth, data loading, context, a plugin system, and accessible UI primitives — all dependency-free.
- **Deploy anywhere** — first-party Cloudflare and Vercel adapters.
- **A real toolchain** — a CLI for scaffolding and builds (`aihu app`/`page`/`component`/`plugin`/`dev`/`build`) and a VS Code extension.

The output is **plain custom elements** — nothing locks you in at the consumer boundary, there's no global runtime and no hydration step, and every component serves both of its audiences by construction: rendered for the human, governed and callable for the agent.

---

## How it compares

Most component libraries give you a way to build *components*. Aihu gives you a way to build *apps* — routing, server-side rendering, data, and deployment are first-class, not add-ons.

**Aihu is to Lit what Next.js is to React:** a full app framework built on a small Web Components runtime. Solid is a single reactive package; Lit is templating plus a base class; Vue ships its own scheduler and virtual DOM. Aihu layers cleanly — use just the signals, just the runtime, or the whole framework — and it's the only one that governs a second audience at all: every component's AI surface is part of the file format, under the same policy as its human one.

---

## Features

### Reactive runtime
- Push-based signals, computeds, and effects with batched writes (`@aihu/signals`, ~1.8 kB gz)
- Direct DOM updates, no virtual DOM (`@aihu/arbor`, ~2.1 kB gz — targeted text writes land on a cached text node, never through the parent's child list)
- In `.aihu` files, reactivity is declared with `state` / `prop` / `derived` / `action` wrappers — plain-value reads, plain-assignment writes, no `.value` ceremony
- Synchronous mount with predictable teardown
- Compiled components register as standard custom elements (`@aihu/runtime`)

### Compiler & toolchain
- Rust-native compiler — reads `.aihu` files and emits standard custom-element classes
- Pre-built binaries for Linux, macOS, Windows, and ARM64 Linux (SHA256-verified), via `npm install @aihu/compiler`
- WebAssembly build for in-browser playgrounds (target: under 200 ms to compile a 50-line component)
- Scoped styles, slots, list/conditional rendering, type-checked templates, error boundaries, hot reload, islands, and full hydration

### AI-agent surface (built in, governed)
- Mark any `state()` / `action()` declaration `expose` and the compiler emits a matching MCP tool schema next to the Web Component — the agent's surface and the human's UI come from the same line of code
- A component-level `@agent` block adds descriptions and metadata for the manifest
- Exposure is a permission, not an annotation: entitlement is resolved server-side and the surface is non-regressable — what you didn't expose does not exist to the agent
- A2A protocol included (`@aihu/agent-a2a`)
- Auto-generates `llms.txt`, an MCP Server Card, and `robots.txt` for any app — no manual config (`@aihu-plugin/agent-readiness`)

### Full-stack capabilities
- File-based routing with nested routes and layouts (`@aihu/router`)
- Server-side rendering, streaming, loaders, cookies, and hydration (`@aihu/server`)
- Request-scoped context plus a reactive data/loader layer (`@aihu/context`, `@aihu-plugin/data`)
- Accessible UI primitives — guards, live regions, focus traps, links, and outlets
- Cloud adapters for Cloudflare and Vercel

### Developer experience
- `aihu` CLI for scaffolding and builds (`app` / `page` / `component` / `plugin` / `dev` / `build`)
- VS Code extension — syntax highlighting today, full language server in progress
- An example portfolio you can run in parallel with `bun run dev:examples`
- Built on Bun, Rolldown, Biome, and Vitest

### Standards & compliance
- **llms.txt** — every app is discoverable by AI tools out of the box
- **MCP** — Model Context Protocol compatible (Server Card, tool schemas, resources)
- **Agent-ready** — every component an app ships has an agent interface
- **Accessibility** — WCAG-oriented primitives (live regions, focus traps, skip links)

---

## Project status

Aihu is under active development and ships in `v1.0.x` releases. The reactive runtime, compiler, router, server, agent surface, CLI, styling engine (`@aihu/css-engine` — a Tailwind v4-style utility engine with scoped, **zero-browser-byte** output), and accessible UI primitives (`@aihu/primitives` — dialog, tooltip, button, and more) all work today. The `v1.0.0` milestone tag is held for one remaining piece:

- **Rich-text / markdown** support, shipping as a plugin.

A copy-paste UI registry built on the engine is also in progress.

Packages version independently (most are in the `0.x` range during early access), so you can adopt any piece on its own. **Aihu is dependency-free at runtime** — every browser-shipped package has an empty `dependencies` list. It's a research-driven codebase: each layer is pinned by a written spec before code lands, and performance regressions block merges.

Migrating between versions is mechanical — `npx aihu migrate --v2 <file>` moves templates to the prefix-less grammar, `npx aihu migrate --state <file>` moves `@state` to the wrapper model, and compiler errors carry a `fix:` hint that points at the exact change. See [`docs/cli.md`](./docs/cli.md) for the migration reference.

---

## Performance

DOM-engine measurements and deterministic update counts are maintained with their package source in [aihu-dom](https://github.com/aihu-project/aihu-dom).

<!-- BEGIN_AUTOGEN: performance -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

The independent DOM engine packages — `@aihu/signals`, `@aihu/reactive`, `@aihu/arbor`, and the `@aihu/dom` facade — now live in [aihu-dom](https://github.com/aihu-project/aihu-dom).

Its manually triggered workflow runs package-focused deterministic update counts and optional timing measurements. Keeping those checks with the engine prevents a framework, documentation, or demo edit from rebuilding the whole benchmark harness.

<sub><i>Auto-generated — run `bun scripts/sync-readme.ts` to update.</i></sub>

<!-- END_AUTOGEN: performance -->

### Bundle size (gz)

Per-package gates enforced by `bun run size`:

<!-- BEGIN_AUTOGEN: bundle-sizes -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| Package | Size (gz) | Limit | Status |
|---|---:|---:|:---:|
| `@aihu/context` | 420 B | 450 B | pass |
| `@aihu/runtime` | 4.62 kB | 4750 B | pass |
| `@aihu/agent` | 141 B | 200 B | pass |
| `@aihu-plugin/data` | 723 B | 800 B | pass |
| `@aihu-plugin/kindly-note` | 1.65 kB | 1850 B | pass |
| `@aihu/router` | 1.71 kB | 2400 B | pass |
| `@aihu/agent-service` | 2.76 kB | 2900 B | pass |
| `@aihu/agent-acp` | 675 B | 800 B | pass |
| `@aihu/agent-a2a` | 2.62 kB | 3000 B | pass |
| `@aihu/app` | 1.77 kB | 1900 B | pass |
| `@aihu/css-engine/runtime/cn` | 886 B | 1 KB | pass |
| `@aihu/css-engine/runtime/progressive` | 716 B | 3 KB | pass |
| `@aihu/primitives/context` | 430 B | 1 KB | pass |
| `@aihu/primitives/presence-gate` | 798 B | 4 KB | pass |
| `@aihu/primitives/form-control` | 1.63 kB | 4 KB | pass |
| `@aihu/primitives/config-provider` | 757 B | 4 KB | pass |
| `@aihu/primitives/roving-focus` | 1.69 kB | 4 KB | pass |
| `@aihu/primitives/collection` | 847 B | 4 KB | pass |
| `@aihu/primitives/dialog` | 2.61 kB | 4 KB | pass |
| `@aihu/primitives/tooltip` | 1.83 kB | 4 KB | pass |
| `@aihu/primitives/button` | 1.10 kB | 4 KB | pass |
| `@aihu/primitives/separator` | 566 B | 4 KB | pass |
| `@aihu/primitives/label` | 2.08 kB | 4 KB | pass |
| `@aihu/primitives/input` | 1.43 kB | 4 KB | pass |
| `@aihu/primitives/textarea` | 1.41 kB | 4 KB | pass |
| `@aihu/primitives/checkbox` | 1.89 kB | 4 KB | pass |
| `@aihu/primitives/switch` | 1.80 kB | 4 KB | pass |
| `@aihu/primitives/radio-group` | 3.21 kB | 4 KB | pass |
| `@aihu/store` | 1.81 kB | 2.5 KB | pass |
| `@aihu/use/shared` | 288 B | 320 B | pass |
| `@aihu/use/math` | 158 B | 1200 B | pass |
| `@aihu/use/motion` | 423 B | 3 KB | pass |
| `@aihu/use/router` | 165 B | 1500 B | pass |
| `@aihu/auth` | 1.16 kB | 1.5 KB | pass |
| `@aihu/magna` | 758 B | 1.8 KB | pass |
| `@aihu/magna/codegen` | 1.04 kB | 1.2 KB | pass |
| `@aihu/editor` | 13.56 kB | 14 KB | pass |
| `@aihu/editor/safe-href` | 134 B | 300 B | pass |
| `@aihu/use` (61 composables) | 139 B – 946 B | 36 distinct limits | pass |
| `@aihu/use/integrations` (1 composable) | 338 B | 600 B | pass |
| `@aihu/use/math` (1 composable) | 158 B | 250 B | pass |
| `@aihu/use/motion` (1 composable) | 423 B | 900 B | pass |
| `@aihu/use/router` (1 composable) | 165 B | 500 B | pass |

<sub><i>Auto-generated — run `bun scripts/sync-readme.ts` to update.</i></sub>

<!-- END_AUTOGEN: bundle-sizes -->

> **Per-package rows are the contract; combined is reported, not budgeted.** The pre-v1 "≤ 3.46 kB combined" target was retired at v1 cutover (Plan 7.1) — packages grew to support hydration, islands, error boundaries, and reconciliation. Each row in `.size-limit.json` is the binding gate. See [`.size-limit.README.md`](./.size-limit.README.md).

---

## Layout

> **Publish status:** packages publish independently at `0.x` early-access (see [Project status](#project-status)). A few internal packages stay private until their designs settle.

<!-- BEGIN_AUTOGEN: packages-by-tier -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

See [`packages/`](./packages) for all packages on disk. By tier:

- **Reactive runtime core (sized, ships to client):** [`@aihu/context`](./packages/context), [`@aihu/runtime`](./packages/runtime).
- **Meta-framework — server, routing, data & adapters:** [`@aihu-plugin/data`](./packages/plugin-data), [`@aihu-plugin/drizzle`](./packages/plugin-drizzle), [`@aihu/adapter-cloudflare`](./packages/adapter-cloudflare), [`@aihu/adapter-vercel`](./packages/adapter-vercel), [`@aihu/app`](./packages/app), [`@aihu/auth`](./packages/auth), [`@aihu/magna`](./packages/magna), [`@aihu/router`](./packages/router), [`@aihu/server`](./packages/server).
- **Agent surface (built in, governed):** [`@aihu-plugin/agent-readiness`](./packages/plugin-agent-readiness), [`@aihu/agent`](./packages/agent), [`@aihu/agent-a2a`](./packages/agent-a2a), [`@aihu/agent-acp`](./packages/agent-acp), [`@aihu/agent-server`](./packages/agent-server), [`@aihu/agent-service`](./packages/agent-service), [`@aihu/ai`](./packages/ai), [`@aihu/mcp`](./packages/mcp), [`@aihu/seo`](./packages/seo).
- **Compiler & toolchain (build-time):** [`@aihu/cli`](./packages/cli), [`@aihu/css-engine`](./packages/css-engine), [`@aihu/language-server`](./packages/language-server), [`@aihu/tsc`](./packages/tsc), [`create-aihu`](./packages/create-aihu).
- **Plugin substrate, editor & templates:** [`@aihu/plugin`](./packages/plugin), [`@aihu/templates-cf-team`](./packages/templates/cf-team), [`vscode-aihu`](./packages/vscode-aihu).
- **UI, styling & content rendering:** [`@aihu-plugin/kindly-note`](./packages/plugin-kindly-note), [`@aihu/primitives`](./packages/primitives), [`@aihu/ui`](./packages/ui).
- **State & rich-content capabilities:** [`@aihu/editor`](./packages/editor), [`@aihu/store`](./packages/store), [`@aihu/use`](./packages/use).

<sub><i>Auto-generated — run `bun scripts/sync-readme.ts` to update.</i></sub>

<!-- END_AUTOGEN: packages-by-tier -->

### Packages

<!-- BEGIN_AUTOGEN: packages -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| Package | Version | Description |
|---|---|---|
| [`@aihu-plugin/agent-readiness`](./packages/plugin-agent-readiness) | `2.3.0` | Discovery + readiness manifest emitter so agents can introspect aihu apps. |
| [`@aihu-plugin/data`](./packages/plugin-data) | `2.0.5` | Reactive data loaders and resource primitives for aihu. |
| [`@aihu-plugin/drizzle`](./packages/plugin-drizzle) | `0.1.6` | Drizzle ORM data adapter for aihu — typed createResource fetchers and defineLoader helpers (Postgres / SQLite / libSQL). |
| [`@aihu-plugin/kindly-note`](./packages/plugin-kindly-note) | `0.2.4` | Runtime syntax highlighting + markdown rendering for aihu — <aihu-code>/<aihu-markdown> custom elements + signal-aware highlight()/renderMarkdown() helpers, powered by published @kindly-note/* packages with lazy loading. |
| [`@aihu/adapter-cloudflare`](./packages/adapter-cloudflare) | `14.0.0` | Cloudflare Workers/Pages deployment adapter for @aihu/app. |
| [`@aihu/adapter-vercel`](./packages/adapter-vercel) | `14.0.0` | Vercel deployment adapter for @aihu/app. |
| [`@aihu/agent`](./packages/agent) | `0.2.0` | Agent primitives — the foundation of aihu agent-readiness. |
| [`@aihu/agent-a2a`](./packages/agent-a2a) | `1.0.1` | A2A (Agent2Agent) protocol bindings (spec v1.0.1, JSON-RPC) for @aihu/agent-service. |
| [`@aihu/agent-acp`](./packages/agent-acp) | `0.2.1` | DEPRECATED — use @aihu/agent-a2a. BeeAI ACP merged into A2A under the Linux Foundation (Aug 2025); this adapter's invented ACP shape has no spec to conform to. |
| [`@aihu/agent-readiness`](./packages/_moved/agent-readiness) | `2.0.4` | [MOVED] This package has moved to @aihu-plugin/agent-readiness. |
| [`@aihu/agent-server`](./packages/agent-server) | `0.4.4` | Server-side glue: mount an aihu component server-side and let an MCP client drive it through the agent-service live-dispatch gate, forwarding approved invocations to a browser bridge. |
| [`@aihu/agent-service`](./packages/agent-service) | `0.4.0` | Service-side agent runtime (server-hosted agent endpoints). |
| [`@aihu/ai`](./packages/ai) | `0.1.0` | Thin adapters from AI SDK stream types to ReadableStream<string> for aihu $stream collections. |
| [`@aihu/app`](./packages/app) | `10.1.0` | Top-level app integration — wires runtime, router, and adapters into a Vite app. |
| [`@aihu/auth`](./packages/auth) | `6.0.0` | JWT scope checks, ScopeSignal, and server middleware for aihu auth. |
| [`@aihu/cli`](./packages/cli) | `1.3.1` | Aihu CLI (`aihu`, `create-aihu`) — scaffolding, dev, build commands. |
| [`@aihu/context`](./packages/context) | `0.2.0` | Async-context-friendly request/SSR context primitives for aihu. |
| [`@aihu/css-engine`](./packages/css-engine) | `0.7.0` | aihu CSS engine — Tailwind v4 hard fork with WC-native scoped output. |
| [`@aihu/data`](./packages/_moved/data) | `2.0.5` | [MOVED] This package has moved to @aihu-plugin/data. |
| [`@aihu/editor`](./packages/editor) | `0.1.2` | Hand-rolled, dependency-free, GX-governed rich-text editor — JSON doc model, invertible transactions, markdown (web-v1 dialect) round-trip, contenteditable view with IME-safe read-back, agent read/suggest/write surface. |
| [`@aihu/language-server`](./packages/language-server) | `0.4.2` | Cross-editor Language Server (aihu-language-server) for .aihu Single File Components — diagnostics, hover, completion, and quick-fix code actions. |
| [`@aihu/magna`](./packages/magna) | `0.2.8` | aihu bridge for Magna GraphQL — dep-free fetch, resource composition, JWT relay |
| [`@aihu/mcp`](./packages/mcp) | `0.2.1` | MCP server for aihu — exposes aihu_example and aihu_validate tools via stdio transport. |
| [`@aihu/plugin`](./packages/plugin) | `0.1.0` | Plugin substrate shared by @aihu/server and the meta-framework — runtime hook surface. |
| [`@aihu/plugin-demo`](./packages/plugin-demo) | `0.1.4` | Canonical proof-of-life for the @aihu/plugin API — exercises macros, middleware, and transforms. |
| [`@aihu/primitives`](./packages/primitives) | `0.2.4` | aihu headless behavior primitives — WAI-ARIA APG patterns as vanilla custom elements, zero CSS. |
| [`@aihu/router`](./packages/router) | `0.5.0` | File-based router for the aihu meta-framework. |
| [`@aihu/runtime`](./packages/runtime) | `6.1.0` | Single File Component (.aihu) runtime — registers custom elements compiled by @aihu/compiler. |
| [`@aihu/seo`](./packages/seo) | `1.0.5` | DEPRECATED compatibility shim over @aihu-plugin/agent-readiness (sitemap.xml, robots.txt, llms.txt, JSON-LD). |
| [`@aihu/server`](./packages/server) | `0.6.0` | Server runtime + native renderer (napi-rs) for aihu SSR. |
| [`@aihu/store`](./packages/store) | `0.1.2` | Pinia-style global stores on aihu signals — defineStore, SSR-safe per-request instances, registry-based serialize/hydrate, plugins. |
| [`@aihu/templates-cf-team`](./packages/templates/cf-team) | `3.1.0` | Cloudflare Workers + monorepo (bun workspaces + moon) team template for Aihu |
| [`@aihu/tsc`](./packages/tsc) | `0.3.4` | aihu-tsc — `tsc` for projects containing .aihu Single File Components. Type-checks .aihu sources as virtual TypeScript, with no .aihu.ts files written to disk. |
| [`@aihu/ui`](./packages/ui) | `0.1.2` | aihu styled-recipe registry — copy-paste .aihu recipes distributed as source via `aihu add` (no runtime bundle). |
| [`@aihu/use`](./packages/use) | `2.0.0` | aihu utility/sensor/state composables — SSR-safe, scope-aware, per-composable subpath entries. |
| [`create-aihu`](./packages/create-aihu) | `0.1.12` | Scaffold a new Aihu app — the `npm create aihu` / `npx create-aihu` entry point. Thin delegator to @aihu/cli. |
| [`vscode-aihu`](./packages/vscode-aihu) | `1.0.0` | Syntax highlighting, snippets, and language support for .aihu Single File Components |

<sub><i>Auto-generated — run `bun scripts/sync-readme.ts` to update.</i></sub>

<!-- END_AUTOGEN: packages -->

---

## Examples

13-example portfolio under [`examples/`](./examples). Six are M1-polished with full `@agent` surfaces, dark-mode tokens, and smoke tests:

<!-- BEGIN_AUTOGEN: examples -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| # | Folder | What it teaches | Port |
|---|---|---|---|
| 01 | [`agent-driven-demo/`](./examples/agent-driven-demo) | An external agent reads a component's metadata and **drives the real, visible component instance** over a real WebSocket — gated server-s... | 5108 |
| 02 | [`agent-durable-room/`](./examples/agent-durable-room) | The **server-authoritative, multi-client** version of the agent-driven component. | — |
| 03 | [`agent-hub/`](./examples/agent-hub) | _no README_ | 5107 |
| 04 | [`auth-magna-seo/`](./examples/auth-magna-seo) | A server-only worked example that proves the **3-package integration contract** — `@aihu/auth` + `@aihu/magna` + `@aihu/seo` — using **on... | — |
| 05 | [`blog-loader/`](./examples/blog-loader) | A server-rendered post page demonstrating aihu's loader pattern, `@aihu/context` as a parallel data channel, and an `@agent` block for ag... | — |
| 06 | [`blog-router/`](./examples/blog-router) | A 3-page blog demonstrating aihu's file-based routing. | — |
| 07 | [`cf-adapter/`](./examples/cf-adapter) | _no README_ | 5110 |
| 08 | [`color-theme/`](./examples/color-theme) | `$reactive(...)` in `@style` plus `$global { }` to propagate tokens beyond component scope — and `$media` macro for responsive breakpoint... | 5105 |
| 09 | [`css-engine-demo/`](./examples/css-engine-demo) | Demonstrates all three browser-facing surfaces of the published [`@aihu/css-engine`](../../packages/css-engine) package: | 5114 |
| 10 | [`css-engine-utility/`](./examples/css-engine-utility) | When `@aihu/css-engine` is installed (as a dependency or peer), the compiler plugin that `viteAihuPlugin` composes will: | 5118 |
| 11 | [`css-pluggability/`](./examples/css-pluggability) | A worked example showing how to plug **Tailwind CSS** into a aihu app, plus documented swap paths to **UnoCSS**, **Pico CSS**, and **vani... | — |
| 12 | [`currency-converter/`](./examples/currency-converter) | the second `@agent` flagship, with enum-typed inputs. Demonstrates how a TypeScript union type (`'USD' | 'EUR' | 'GBP' | 'JPY'`) on a sta... | 5116 |
| 13 | [`hacker-news/`](./examples/hacker-news) | A aihu port of the canonical Hacker News reader. Hits the live HN API. M1 polish: dark-mode token pass, `@agent` block on the index page,... | 5108 |
| 14 | [`layouts/`](./examples/layouts) | Runtime **layout rendering** + **dynamic layout switching**. | — |
| 15 | [`live-counter/`](./examples/live-counter) | the smallest possible aihu component — state, event handlers, a reactive text node, and an agent surface, in one file. | 5101 |
| 16 | [`plugin-demo/`](./examples/plugin-demo) | _no README_ | 5111 |
| 17 | [`primitives-showcase/`](./examples/primitives-showcase) | Wires three WAI-ARIA APG patterns from the published [`@aihu/primitives`](../../packages/primitives) package — each a vanilla custom elem... | 5115 |
| 18 | [`realtime-scores/`](./examples/realtime-scores) | Live score board demonstrating WebSocket-driven signal updates, `$lifecycle.mount/dispose`, and `createResource` from `@aihu-plugin/data`... | 5112 |
| 19 | [`ssg-site/`](./examples/ssg-site) | The designated live exerciser for aihu's **static output** build path and the hydration-lifecycle callbacks. Before the governed set, `ou... | 5120 |
| 20 | [`storefront/`](./examples/storefront) | _no README_ | 5113 |
| 21 | [`temperature-converter/`](./examples/temperature-converter) | two-way binding plus a computed-derived counterpart (7GUIs #2), and an agent surface that lets AI tools read and write the temperature on... | 5102 |
| 22 | [`timer/`](./examples/timer) | lifecycle hooks, reactive derivations, and an agent surface that lets AI monitor timer progress and trigger resets on the human's behalf ... | 5103 |
| 23 | [`todo-mvc/`](./examples/todo-mvc) | the canonical TodoMVC — list reactivity, filtering, computed derivations, keyed iteration, localStorage persistence, and an agent surface... | 5104 |
| 24 | [`weather-card/`](./examples/weather-card) | the aihu-unique `@agent` block. Every signal you `$expose` becomes an MCP resource; every action you `$action` becomes an MCP tool. The s... | 5106 |

<sub><i>Auto-generated — run `bun scripts/sync-readme.ts` to update.</i></sub>

<!-- END_AUTOGEN: examples -->

Run all polished examples in parallel:

```bash
bun run dev:examples
```

---

## Toolchain

- **Runtime:** [Bun](https://bun.sh) ≥ 1.3.0, Node ≥ 20.18.0. Both required (`engines` enforced).
- **Bundler:** [Rolldown](https://rolldown.rs) — Rust-based, OXC ecosystem.
- **Test:** [Vitest](https://vitest.dev) + jsdom + [fast-check](https://github.com/dubzzz/fast-check) (property tests).
- **Lint/format:** [Biome](https://biomejs.dev).
- **Task runner:** [Moon](https://moonrepo.dev) — `moon run :build`, `moon run :typecheck`.
- **Size budget:** [size-limit](https://github.com/ai/size-limit) gates per-package gzipped bundles.
- **Tool versions:** pinned via [proto](https://moonrepo.dev/proto) (`.prototools`).

---

## Workspace dev loop

```bash
bun install
bun run build      # build all packages
bun run test       # TS + Rust suites (unit + integration + compliance)
bun run size       # per-package gzipped bundle gates
bun run check      # biome lint + format
bash scripts/check-boundary.sh   # AC-7: hard boundary (no client imports in server layer)
bash scripts/check-edge-safe.sh  # AC-6: no Node-only globals in dist bundles
bun run test:quality              # Lighthouse gate (≥ 90 on perf/a11y/best-practices/seo)
```

Run the DOM-engine checks in [aihu-dom](https://github.com/aihu-project/aihu-dom): its manual workflow isolates signals and DOM benchmarks from framework, docs, and demo builds.

Use the packages directly:

```ts
import { signal, computed, effect } from '@aihu/signals'
import { branch, leaf, mount } from '@aihu/arbor'
import { defineComponent } from '@aihu/runtime'
import { registerAgentMetadata } from '@aihu/agent'

const [count, setCount] = signal(0)
const tree = branch('div', null, [leaf([count, setCount])])
const scope = mount(tree, document.body)
setCount(1) // DOM updates synchronously via nodeValue
scope.dispose()
```

Edge / server (fetch-API, works on Cloudflare Workers, Deno, Bun) — request-router shape from `@aihu/server`. Two distinct routing APIs ship in aihu: `@aihu/server.createRequestRouter` builds a fetch-API request handler from an explicit route manifest (shown below), while `@aihu/router.createRouter` powers file-based routing via the v1 Vite plugin (`viteRouterPlugin`); see [`apps/docs/src/content/docs/guides/routing-layouts.md`](./apps/docs/src/content/docs/guides/routing-layouts.md).

```ts
import { createRequestRouter, defineRoute, json } from '@aihu/server'
import { createAgentReadinessRoutes } from '@aihu-plugin/agent-readiness'

const ar = createAgentReadinessRoutes({
  name: 'My App',
  endpoint: 'https://myapp.workers.dev/mcp',
  summary: 'A aihu-powered app.',
})

const router = createRequestRouter({
  routes: [
    defineRoute('/llms.txt', ar.llmsTxt),
    defineRoute('/.well-known/mcp/server-card.json', ar.mcpServerCard),
    defineRoute('/robots.txt', ar.robotsTxt),
    defineRoute('/api/hello', () => json({ hello: 'world' })),
  ],
})

// Cloudflare Worker
export default { fetch: router }
// Deno / Bun
// Deno.serve(router)  |  Bun.serve({ fetch: router })
```

---

## Compliance

The agent-protocol badges are backed by real test gates in `bun run test`.

| Gate | Tests | Status |
|---|---|---|
| `llms.txt` format (llmstxt.org spec) | 9 tests in `packages/plugin-agent-readiness/tests/compliance/llms-txt-spec.test.ts` | passing |
| MCP Server Card schema (SEP-1649) | 14 tests in `packages/plugin-agent-readiness/tests/compliance/mcp-server-card-schema.test.ts` | passing |
| `robots.txt` RFC 9309 | 7 tests in `packages/plugin-agent-readiness/tests/compliance/robots-rfc9309.test.ts` | passing |
| isitagentready.com endpoint checklist | 7 tests in `packages/plugin-agent-readiness/tests/compliance/isitagentready.test.ts` | passing |
| SSR output structural checks | 12 tests in `packages/server/tests/compliance/ssr-output.test.ts` | passing |
| Lighthouse quality gate (≥ 90 all categories) | `bun run test:quality` via `scripts/lighthouse.ts` | passing |

Run all compliance checks: `bun run test && bun run test:quality`

---

## Reference

- **User guide** — [`apps/docs/src/content/docs/`](./apps/docs/src/content/docs): the rendered documentation site source — [introduction](./apps/docs/src/content/docs/introduction.md), [installation](./apps/docs/src/content/docs/installation.md), [getting started](./apps/docs/src/content/docs/getting-started.md), [API reference](./apps/docs/src/content/docs/api-reference.md), [migration](./apps/docs/src/content/docs/migration.md), and the [guides](./apps/docs/src/content/docs/guides) (authoring components, authoring agents, reactivity, SSR + hydration, routing + layouts, data fetching, styling, theming, composition, deployment, plugins).
- **CLI reference** — [`docs/cli.md`](./docs/cli.md): `create-aihu`, `aihu app` / `page` / `component` / `dev` / `build`, and `aihu migrate`.
- **Contributing** — [`CONTRIBUTING.md`](./CONTRIBUTING.md): fork, branch, conventional commits, changesets, and the dependency-free thesis.
- **Releasing** — [`docs/RELEASING.md`](./docs/RELEASING.md): changeset workflow, release PR, npm publish pipeline.
- **DOM-engine benchmarks** — [aihu-dom](https://github.com/aihu-project/aihu-dom): package-focused checks and measurement harnesses.

---

## License

MIT
