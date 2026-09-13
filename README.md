# Aihu

<p align="center">
  <img src="brand/aihu-wordmark.svg" alt="aihu" width="200">
</p>

<h1 align="center">One component. Two users.</h1>

<p align="center">
  A Web Components framework where the same file renders the UI a person uses<br>
  and the MCP tools their AI agent uses. Same instance. Same policy.
</p>

[![CI](https://github.com/aihu-project/aihu/actions/workflows/plan-a.yml/badge.svg)](https://github.com/aihu-project/aihu/actions/workflows/plan-a.yml)
[![release](https://github.com/aihu-project/aihu/actions/workflows/release.yml/badge.svg)](https://github.com/aihu-project/aihu/actions/workflows/release.yml)
[![@aihu/signals on npm](https://img.shields.io/npm/v/@aihu/signals.svg?label=@aihu/signals)](https://www.npmjs.com/package/@aihu/signals)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue?logo=anthropic)](#compliance)
[![Agent Ready](https://img.shields.io/badge/agent--ready-yes-brightgreen)](#compliance)

---

<p align="center">
  <a href="https://github.com/aihu-project/aihu/actions/workflows/plan-a.yml"><img src="https://github.com/aihu-project/aihu/actions/workflows/plan-a.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@aihu/runtime"><img src="https://img.shields.io/npm/v/@aihu/runtime.svg?label=@aihu/runtime" alt="npm"></a>
  <img src="https://img.shields.io/badge/MCP-compatible-blue?logo=anthropic" alt="MCP">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT">
</p>

<p align="center">
  <!-- TODO: replace with the agent-visible-demo GIF (SPEC-agent-visible-demo §6) -->
  <img src="brand/demo.gif" alt="A user types 'add milk, eggs, and bread' and an agent adds three rows to the list they are looking at" width="720">
</p>

```bash
npx create-aihu my-app --template agent
```

---

## The whole idea in 25 lines

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

- `state(0)` is a reactive field. Read it as `count`, assign to write it, and the DOM updates on the touched node.
- `action({ expose: 'read write' }, fn)` is an ordinary method. Because it carries `expose`, the compiler **also** emits an MCP tool schema for it, and an agent can call it on the live instance.
- The template is plain HTML with `{expr}` bindings, type-checked as TypeScript.
- The output is a standard custom element. No virtual DOM, no shipped framework, light DOM by default.

Nothing is reachable by an agent unless you write `expose`. Entitlement is resolved server-side, and what you did not expose does not exist to the agent.

---

## Why

Every product now has a second user: the person, and the person's AI agent. Most stacks make you build a UI for one and a separate API for the other, and the two drift from day one.

aihu compiles both from one declaration. The agent does not generate a throwaway interface for the turn; it steers the component already on screen, and the person always sees what the agent touched.

| | Human | Agent |
|---|---|---|
| **Gets** | Reactive UI on vanilla custom elements, SSR, accessible primitives | MCP tools + `llms.txt` emitted from the component; SSR content agents can read |
| **Governed by** | Server-held auth and policy | Only what you marked `expose`, enforced server-side, non-regressable |

---

## Try it

```bash
# The agent showcase: a live <task-list> a person AND an agent drive
npx create-aihu my-app --template agent
cd my-app && bun install
bun run dev          # UI on :5108, agent bridge on :5208

# Drive it from outside the browser
curl -XPOST localhost:5208/agent/call \
  -H 'content-type: application/json' \
  -d '{"tool":"task-list/addTask","params":["Write the launch post"]}'
```

Watch the on-screen list gain a row. Then try an action you did not expose and watch the gate reject it.

Requirements: [Bun](https://bun.sh) ≥ 1.3, Node ≥ 20.18.

---

## What ships in the box

aihu is a full meta-framework, not just a component library. Every layer is usable on its own.

| Layer | Packages | What you get |
|---|---|---|
| **Reactive core** | `@aihu/signals`, `@aihu/arbor`, `@aihu/runtime` | Push-based signals and direct DOM writes. ~1.8 kB gz for signals, ~4.6 kB gz for the full runtime. |
| **Compiler** | `@aihu/compiler`, `@aihu/tsc` | Rust, prebuilt for Linux/macOS/Windows/ARM64, plus a WASM build for in-browser playgrounds. `.aihu` type-checks as plain TypeScript. |
| **Agent surface** | `@aihu/agent`, `@aihu/agent-server`, `@aihu/agent-a2a`, `@aihu-plugin/agent-readiness` | MCP tool schemas from `expose`, A2A bindings, auto-generated `llms.txt`, MCP Server Card, and `robots.txt`. |
| **App framework** | `@aihu/router`, `@aihu/server`, `@aihu/app`, `@aihu/auth`, `@aihu-plugin/data` | File-based routing, SSR with streaming, loaders, cookies, server actions, JWT scopes. |
| **Styling and UI** | `@aihu/css-engine`, `@aihu/primitives`, `@aihu/ui` | Tailwind-v4-style utilities with zero browser bytes, WAI-ARIA primitives, copy-paste `.aihu` recipes via `aihu add`. |
| **Deploy** | `@aihu/adapter-cloudflare`, `@aihu/adapter-vercel` | First-party adapters. |
| **Tooling** | `@aihu/cli`, `create-aihu`, `@aihu/language-server`, `vscode-aihu` | Scaffolding, dev, build, migrations, diagnostics, completions. |

Every browser-shipped package has an empty `dependencies` list. Per-package size budgets are enforced in CI (`bun run size`). Full package list and versions: [`docs/packages.md`](docs/packages.md).

---

## How it compares

**aihu is to Lit what Next.js is to React**: a full app framework on a small Web Components runtime.

| | Solid | Lit | Vue | aihu |
|---|---|---|---|---|
| Output | Framework runtime | Custom elements | Virtual DOM | Custom elements |
| Routing, SSR, data, deploy built in | Via SolidStart | No | Via Nuxt | Yes |
| Agent surface from the component file | No | No | No | **Yes** |

---

## Examples

Six polished examples with full agent surfaces, dark-mode tokens, and smoke tests. Run them all with `bun run dev:examples`.

| Example | What it shows |
|---|---|
| [`agent-driven-demo`](examples/agent-driven-demo) | An external agent drives the visible component over a real WebSocket, gated server-side |
| [`live-counter`](examples/live-counter) | The smallest possible component, 25 lines |
| [`todo-mvc`](examples/todo-mvc) | The canonical TodoMVC with an agent that can add and clear items |
| [`weather-card`](examples/weather-card) | Every exposed signal becomes an MCP resource, every action an MCP tool |
| [`currency-converter`](examples/currency-converter) | Enum-typed inputs become typed tool schemas |
| [`hacker-news`](examples/hacker-news) | A port of the canonical HN reader against the live API |

More under [`examples/`](examples/).

---

## Status

aihu ships in `v1.0.x` releases. The runtime, compiler, router, server, agent surface, CLI, styling engine, and primitives all work today. Packages version independently, so most are still `0.x` and you can adopt any piece alone.

Held for the `v1.0.0` milestone tag: rich-text and markdown support as a plugin.

This is a solo-maintained, research-driven project. Each layer is pinned by a written spec before code lands, and performance regressions block merges. If you want to help, [`CONTRIBUTING.md`](CONTRIBUTING.md) and the `good first issue` label are the starting points.

---

## Docs

- [Introduction](apps/docs/src/content/docs/introduction.md) · [Getting started](apps/docs/src/content/docs/getting-started.md) · [API reference](apps/docs/src/content/docs/api-reference.md)
- Guides: [authoring components](apps/docs/src/content/docs/guides) · authoring agents · reactivity · SSR and hydration · routing · data · styling · deployment
- [CLI reference](docs/cli.md) · [Releasing](docs/RELEASING.md) · [Benchmarks (aihu-dom)](https://github.com/aihu-project/aihu-dom)
- Compliance gates for `llms.txt`, MCP Server Card, and `robots.txt` run in `bun run test`: [`docs/compliance.md`](docs/compliance.md)

## License

MIT

