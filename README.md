# Aihu

<p align="center">
  <img src="brand/aihu-wordmark.svg" alt="aihu" width="200">
</p>

<h1 align="center">One component. Two users.</h1>

<p align="center">
  A Web Components framework where the same file renders the UI a person uses<br>
  and the MCP tools their AI agent uses. Same instance. Same policy.
</p>

<p align="center">
  <a href="https://github.com/aihu-project/aihu/actions/workflows/plan-a.yml"><img src="https://github.com/aihu-project/aihu/actions/workflows/plan-a.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/aihu-project/aihu/actions/workflows/release.yml"><img src="https://github.com/aihu-project/aihu/actions/workflows/release.yml/badge.svg" alt="Release"></a>
  <a href="#the-whole-idea-in-one-file"><img src="https://img.shields.io/badge/MCP-compatible-blue?logo=anthropic" alt="MCP compatible"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT license"></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/create-aihu"><img src="https://img.shields.io/npm/v/create-aihu?label=create-aihu" alt="create-aihu on npm"></a>
  <a href="https://www.npmjs.com/package/@aihu/runtime"><img src="https://img.shields.io/npm/v/@aihu/runtime?label=%40aihu%2Fruntime" alt="@aihu/runtime on npm"></a>
  <a href="https://www.npmjs.com/package/@aihu/compiler"><img src="https://img.shields.io/npm/v/@aihu/compiler?label=%40aihu%2Fcompiler" alt="@aihu/compiler on npm"></a>
  <a href="https://www.npmjs.com/package/@aihu/cli"><img src="https://img.shields.io/npm/v/@aihu/cli?label=%40aihu%2Fcli" alt="@aihu/cli on npm"></a>
</p>

<p align="center">
  <img src="brand/demo.gif" width="720" alt="A user types 'add milk, eggs, and bread' and an agent adds three rows to the list they are looking at">
</p>

```bash
npx create-aihu my-app --template agent
```

---

## The whole idea in one file
 
A task list a person and their agent share. The person clicks; the agent calls tools. Same instance, same policy, one declaration.
 
```aihu
@state {
  let owner = prop({
    default: '',
    describe: 'Whose list this is',
    expose: 'read' })
 
  let tasks = state<{ id: number; text: string; done: boolean }[]>([])
  let nextId = state(1)
 
  // Exposed derived state becomes an MCP resource the agent can read.
  const remaining = derived(
    { describe: 'Count of tasks not yet done', expose: 'read' },
    () => tasks.filter(t => !t.done).length)
 
  // Exposed actions become MCP tools (and A2A skills).
  const addTask = action(
    { describe: 'Append a task with the given text', expose: 'read write' },
    (text: string) => {
      tasks = [...tasks, { id: nextId, text, done: false }]
      nextId = nextId + 1 })
 
  const toggleTask = action(
    { describe: 'Mark the task with this id done or not done', expose: 'read write' },
    (id: number) => { tasks = tasks.map(t => t.id === id ? { ...t, done: !t.done } : t) })
 
  // No expose: people can click it; it does not exist to the agent.
  const clearAll = action(() => { tasks = [] })
}
 
@template {
  <h2>{owner}'s tasks <small>{remaining} left</small></h2>
  <group if={tasks.length === 0}>
    <p>Nothing yet. Ask your agent to add something.</p>
  </group><group else>
    <ul>
      <li each={task of tasks} key={task.id} data-done={task.done}>
        <input type="checkbox" checked={task.done} on:change={() => toggleTask(task.id)}>
        {task.text}
      </li>
    </ul>
  </group>
  <guard scope="admin">
    <button on:click={clearAll}>Clear all</button>
  </guard>
}
 
@agent {
  $scope "authenticated"   // JWT claim required before any exposed call
  $rate-limit 60           // calls per minute, enforced server-side
}
```
 
### What that one file produces
 
| You wrote | The compiler emits | Who uses it |
|---|---|---|
| The file | A standard custom element, `<task-list>`, no framework runtime shipped | The person's browser |
| `action({ expose: 'read write' })` ×2 | MCP tools `task-list/addTask` and `task-list/toggleTask` | Claude, Cursor, any MCP client |
| `prop` / `derived` with `expose: 'read'` ×2 | MCP resources `owner` and `remaining` | Same |
| Those same actions | A2A skills with the same ids, plus `/.well-known/agent-card.json` | Other agents |
| Every `expose:` | `task-list.agent-manifest.json`, which feeds `llms.txt` and the MCP server card | Crawlers and agent discovery |
| `@agent { $scope, $rate-limit }` | A server-side gate that answers 404 → 401 → 403 → 429, in that fixed order | The server, as sole policy authority |
| No `expose` on `clearAll` | Nothing. The agent cannot see it | |
| `<guard scope="admin">` | The button renders only for people holding the claim | The person's browser |
 
### How to read it
 
- **`state`, `prop`, `derived`, `action`** are plain TypeScript to your editor and `tsc`. The compiler lowers them to reactive declarations. Reads are bare (`tasks`), writes are plain assignment.
- **`expose` is a permission, not a comment.** `'read'` lets an agent read a value. `'read write'` lets it call an action. Anything without `expose` is not on the agent's map at all.
- **Two audiences, two gates, one place.** `clearAll` is hidden from agents by omission and hidden from unprivileged people by `<guard>`. Both decisions live next to the code they protect.
- **Policy never rides the wire.** The browser holds the live instance; the server holds the policy. An agent call is checked on the server, then dispatched to the mounted element the person is looking at.
- **The agent surface costs the person nothing.** Client builds elide every schema, manifest, and agent path. Zero bytes.
- **`<guard>` is UX, not authorization.** The server enforces the same scope. The template guard just keeps the button honest.
### Try it against the live instance
 
```bash
npx create-aihu my-app --template agent
cd my-app && bun install && bun run dev      # UI on :5108, agent bridge on :5208
```
 
```bash
# Add a task from outside the browser and watch the row appear on screen
curl -XPOST localhost:5208/agent/call -H 'content-type: application/json' \
  -d '{"tool":"task-list/addTask","params":["Write the launch post"]}'
 
# Try something that was never exposed and watch the gate refuse it
curl -XPOST localhost:5208/agent/call -H 'content-type: application/json' \
  -d '{"tool":"task-list/clearAll","params":[]}'
```

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

