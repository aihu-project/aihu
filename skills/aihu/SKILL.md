---
name: aihu
description: Official aihu authoring skill. TRIGGER when creating or editing any .aihu single-file component, or when writing components in a project that uses the aihu framework (@aihu/* packages). .aihu SFC syntax is novel — code written from prior knowledge will not compile.
metadata:
  version: 0.1.0
  source: https://github.com/aihu-project/aihu
---

# aihu

aihu is a meta-framework that compiles `.aihu` single-file components (SFCs) into
vanilla Web Components with sub-2 kB signal-based reactivity. There is no virtual
DOM, no hydration step, and no framework lock-in at the consumer boundary: the
compiler output is a plain `customElements.define` call.

`.aihu` syntax looks like a blend of Vue/Svelte/JSX but is none of them. Every
Vue/Svelte-ism (`@click`, `:value`, `v-if`, `{{ }}`, `$on.click`) is a hard
compile error with a dedicated diagnostic. Do not write `.aihu` from prior
framework knowledge — read this skill first, and validate against the compiler.

## When to run this skill

- Creating or editing any `.aihu` file
- Working in a repo that depends on `@aihu/*` packages
- The user mentions aihu, `.aihu` SFCs, `@state` / `@template` blocks, or the aihu cookbook

## Ground truth is the compiler, not prose

Docs (including this skill) can drift; the compiler cannot. Work in this order:

1. **If the project exposes the `aihu` MCP server** (an `.mcp.json` with
   `{ "mcpServers": { "aihu": { "command": "aihu", "args": ["mcp", "serve"] } } }`),
   use its two tools as your primary interface:
   - `aihu_example` — pass a natural-language `intent` ("modal dialog with escape
     key"); returns a canonical, CI-compiled cookbook recipe to start from.
   - `aihu_validate` — pass full `.aihu` `source`; compiles it with the real
     Rust compiler and returns structured diagnostics. **Call this on every
     component you write, before claiming it is correct.**
2. **No MCP server?** Compile directly. In the aihu repo itself:
   `bun run test:cookbook` compiles the cookbook; the compiler binary
   (`aihu-compile`, buildable via `cargo build --release -p aihu-compiler`)
   accepts `--stdin --tag <tag> --path <virtual-path>`. In a consumer project,
   the vite plugin from `@aihu/app` compiles on `vite build`.
3. **Never ship a `.aihu` file you have not compiled.** A skill or doc snippet
   is not evidence; a zero exit code is.

Human editors additionally get completion/hover/diagnostics from
`@aihu/language-server`. It is the same compiler underneath — do not build a
third source of truth (regex grammars, hand-maintained syntax rules).

## File anatomy

A `.aihu` file is a set of top-level `@block { }` declarations, each at most once
per file. Order is free; convention is `@state`, `@template`, `@style`, `@agent`.
`@route` is valid only in files under `src/pages/` (C500 elsewhere).

The component's custom-element tag comes from the filename stem, which must
therefore contain a hyphen: `my-counter.aihu` → `<my-counter>`.

A minimal component that compiles:

```aihu
@state {
  let count = state(0)

  const increment = action(() => { count++ })
}

@template {
  <button class="counter" on:click={increment}>Count: {count}</button>
}

@style {
  .counter { padding: 0.5rem 1rem; cursor: pointer; }
}
```

## The mistakes that will not compile

These are the exact failure modes observed in AI-generated aihu code. Each is a
hard compile error; the codes below are what you will see.

| Wrong (do not write) | Correct | Error |
|---|---|---|
| `$on.click={fn}`, `$on:click={fn}` | `on:click={fn}` | C607 |
| `$bind.value="x"`, `$bind:value` | `bind:value={x}` | C607 |
| `$if={cond}`, `$each="xs as x"` | `if={cond}`, `each={x of xs}` | C606 |
| `@click="fn"` (Vue) | `on:click={fn}` | C305 |
| `:value="x"` (Vue) | `value={x}` | C304 |
| `v-if`, `v-for` (Vue) | `if={…}`, `each={… of …}` | error |
| `{{count}}` mustache | `{count}` single braces | C604 |
| `if="cond"` quoted | `if={cond}` braced | C302 |
| `class=myClass` bare value | `class="x"` or `class={x}` | C300 |
| `$action name() { }` (v1 macro) | `const name = action(() => { })` | C440 |
| `action(fn, config)` args swapped | `action(config, fn)` — config bag FIRST | C622 |
| Mixing `$`-macros and `state()`/`action()` wrappers in one `@state` | one dialect per file; use wrappers | C625 |

Two silent traps (compile fine, behave wrong):

- Composable getters read bare: `{x}` renders the getter's source text. Names
  returned by composables (e.g. `const { x, y } = useMouse()`) are getters, not
  `state()` declarations — call them: `{x()}`. Names you declared with
  `state`/`prop`/`derived` are read bare (`{count}`) everywhere.
- `disabled="false"` is truthy HTML (W602 warning). Bind reactively:
  `disabled={cond}`.

## Reading and writing reactive values

The current `@state` dialect is intrinsic wrappers with plain reads/writes — no
signal tuples, no setters, no `.value`:

```aihu
@state {
  let city = prop({ default: 'London' })   // host-settable public surface
  let loading = state(false)                // private reactive state
  const banner = derived(() => `Weather for ${city}`)  // memoized, pure

  const refresh = action(() => {
    loading = true        // write: plain assignment — the compiler rewrites it
    loading = false
  })
}

@template {
  <p aria-busy={loading}>{banner}</p>
  <button on:click={refresh} disabled={loading}>Refresh</button>
}
```

Reads are bare names in both `@state` and `@template` (`city`, not `city()` —
though the explicit call form also compiles). Writes are plain assignments and
`++`/`--`, valid only on `state`/`prop` declarations.

## Mandatory reference

| Task | Guide | Note |
|---|---|---|
| `@state` logic: state/prop/derived/action, lifecycle, resources | [./state/SKILL.md](./state/SKILL.md) | MANDATORY before writing any `@state` block. |
| Template grammar: control flow, events, bindings, slots | [./template/SKILL.md](./template/SKILL.md) | MANDATORY before writing any `@template` block. |
| Agent surface: `expose:`/`describe:`, `@agent` block | [./agent/SKILL.md](./agent/SKILL.md) | Read when a component should be readable/drivable by AI agents. |
| Finding working code by task | [./cookbook/SKILL.md](./cookbook/SKILL.md) | Task-keyed index of the 21 CI-compiled cookbook recipes and 26 example apps. |
| Compiler diagnostics reference | [./errors/SKILL.md](./errors/SKILL.md) | Read when a compile fails — real error output, cause, and fix for each code. |

## What this skill does not cover

- `@aihu/store` (Pinia-style stores), the `stream()` intrinsic, `event()`/`$emit`,
  `<suspense>`/`<shield>`/`<router>` elements, GX hard-tier governance vocabulary
  (`read: verified`, `call:`), and SSG `output:'static'` — these exist in the
  compiler but have little or no exercised example coverage yet; consult
  `cookbook/COVERAGE-MATRIX.md` in the aihu repo before using them.
- The legacy `$`-collection macro dialect (`$action: { … }`). It still compiles
  in old files, but do not write it in new code and never mix it with wrappers
  (C625).
- Consuming compiled components from React/Vue (interop annex, in progress).
