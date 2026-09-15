# @aihu/cli

Build-time CLI scaffolder for aihu applications. Zero runtime size impact — it is a
dev/build-time tool only and is never included in browser bundles.

## Prerequisites

- Bun ≥ 1.3.0 (or Node.js ≥ 20.18.0)
- A terminal in your project directory

## Quick start — `aihu app`

```bash
npx aihu app my-app
cd my-app
bun install
bun run dev
```

This creates:

```
my-app/
  package.json              # all @aihu/* deps pre-wired
  aihu.config.ts          # defineAihuConfig with target: 'universal'
  vite.config.ts            # viteRouterIntegration + viteAgentReadinessIntegration
  src/
    pages/
      index.aihu          # Hello World page with @state, @template, @route
    layouts/
      default.aihu        # default layout with <slot />
```

## Scaffold commands

### `aihu app <name>`

Scaffold a new application with all aihu integrations wired.

```bash
aihu app my-store
```

Output:
```
✓ Created my-store/
  cd my-store
  bun install
  bun run dev
```

### `aihu page <route>`

Add a page to an existing project. Run from the project root.

```bash
aihu page about
```

Creates `src/pages/about.aihu`:
```
@state {
}

@template {
  <div>about page</div>
}

@route {
  path: /about
  name: about
}
```

### `aihu component <name>`

Scaffold a `.aihu` component.

```bash
aihu component Button
```

Creates `src/components/Button.aihu`:
```
@state {
}

@template {
  <div>Button</div>
}
```

### `aihu plugin <name>`

Scaffold a plugin package skeleton. Creates `<name>/` with a wired `definePlugin` entry.

```bash
aihu plugin my-forms
```

Creates:
```
my-forms/
  package.json    # peerDependencies: { "@aihu/plugin": "latest" }
  src/
    index.ts      # definePlugin({ name, namespace, contributes: {} })
```

### `aihu migrate [files...]`

Mechanically rewrite legacy v0.1.x SFC syntax to the v1.0 canonical forms. The
command runs three passes in order — block framing (v1.0.7), inline attribute
bindings (v1.0.8 / Amendment 04), and package-name renames (v1.0.9 / Naming
Scheme A) — and is idempotent (running it twice produces the same output as
running it once).

```bash
aihu migrate src/components/Counter.aihu
aihu migrate --dry-run src/**/*.aihu
```

Use `--dry-run` to preview changes without writing files.

#### Pass 1 — block framing (v1.0.7)

Convert HTML-tag SFC framing to `@blockname {}` syntax.

| v0.1.x HTML-tag syntax | v1.0 `@blockname` syntax |
|------------------------|--------------------------|
| `<script setup>`       | `@state {`               |
| `<template>`           | `@template {`            |
| `<style>`              | `@style {`               |
| `<agent>`              | `@agent {`               |

#### Pass 2 — inline attribute bindings (v1.0.8 / Amendment 04)

Rewrite the legacy Vue-shape and plain-curly attribute bindings to the
always-`$`-prefixed canonical form. Component prop-passing on capitalized
component tags (`<UserCard user={u} />`) and XML namespace prefixes (`xmlns:`,
`xlink:`) are preserved untouched.

| Legacy form        | v1.0 canonical form                       |
|--------------------|-------------------------------------------|
| `:attr="expr"`     | `$attr={expr}` (or `$bind.attr=` two-way) |
| `@event="fn"`      | `$on.event="fn"` (dot-form per B3c)       |
| `attr={expr}`      | `$attr={expr}`                            |

#### Pass 3 — package-name renames (v1.0.9 / Naming Scheme A)

The two Plugin Contract packages moved out of the framework-core `@aihu/*`
scope into the `@aihu-plugin/*` scope. The migrate tool rewrites `package.json`
dependency keys, static `import`/`export` statements, dynamic `import()` calls,
and JSDoc/Markdown URL references. Core packages (`@aihu/signals`,
`@aihu/arbor`, `@aihu/runtime`, `@aihu/router`, etc.) are NOT renamed.

| Legacy import           | v1.0.9 import                  |
|-------------------------|--------------------------------|
| `@aihu/data`            | `@aihu-plugin/data`            |
| `@aihu/agent-readiness` | `@aihu-plugin/agent-readiness` |

#### Error codes

The v1.0 cutover rejects each legacy form as a hard parse error (no
deprecation-with-warning period). When the compiler reports one of these codes,
run `npx aihu migrate <file>` to obtain the mechanical rewrite.

| Code | Rejected form                                                              | Removed in | Canonical migration target                              |
|------|----------------------------------------------------------------------------|------------|---------------------------------------------------------|
| C107 | `<script setup>` / `<template>` / `<style>` / `<agent>` HTML-tag SFC framing | v1.0.7     | `@state { … }` / `@template { … }` / `@style { … }` / `@agent { … }` |
| C304 | `:attr="expr"` Vue-shape one-way binding alias                              | v1.0.8     | `$attr={expr}` (or `$bind.attr=` for two-way)           |
| C305 | `@event="fn"` Vue-shape event alias                                         | v1.0.8     | `$on.event="fn"` (dot-form)                             |
| C306 | `attr={expr}` plain-curly HTML attribute binding (no `$`)                   | v1.0.8     | `$attr={expr}`                                          |

## Dev → build → preview cycle

```bash
# Start development server
bun run dev

# Production build
bun run build

# Preview production build locally
bun run preview
```

### `aihu deploy [options]`

Deploy the production build via the platform adapter configured in
`vite.config.ts` (`adapter: cloudflare(...)` or `adapter: vercel()` on
`viteAihuPlugin`):

- `cloudflare` → runs `wrangler deploy`
- `vercel` → runs `vercel --prod`

```bash
aihu deploy
```

`@aihu/cli` has zero non-Node-builtin dependencies at build time — the
adapter name is read structurally off the loaded config, and the platform
CLI (`wrangler` or `vercel`) is resolved from the project's own
`node_modules`/`PATH` at run time, the same way `aihu dev`/`aihu build`
resolve Vite. If no adapter is configured, or the configured adapter isn't
`cloudflare` or `vercel`, `aihu deploy` exits nonzero with a message naming
the supported adapters.

Flags:

| Flag | Description |
|------|-------------|
| `--help`, `-h` | Show usage |

## Programmatic API

All scaffold functions are exported for use in build scripts:

```ts
import {
  scaffoldApp,
  scaffoldPage,
  scaffoldComponent,
  scaffoldPlugin,
  migrateFile,
  migrateFiles,
} from '@aihu/cli'

// Scaffold a new app
scaffoldApp('my-app', '/path/to/projects')

// Migrate a file's contents (pure function — no I/O)
const converted = migrateFile(sfcFileContent)
```

## Design constraints

- Zero external npm dependencies (Node/Bun builtins only)
- Build-time only — never added to size budgets or browser bundles
- Per Learning #49 (v3 dep-free thesis): zero non-`@aihu/*` runtime deps
