# aihu v0 — Plan A: TypeScript Runtime Family Implementation Plan

> **Status (updated 2026-05-02):** All five v0 phases shipped + Rounds N+1 / N+2 / N+3 perf work. v1 framework plan **ratified** at [`2026-05-02-aihu-v1-framework.md`](2026-05-02-aihu-v1-framework.md) (covers v0.2 → v1.0; spec quartet authority at [`docs/superpowers/specs/`](../specs/)). This v0 plan is retained for archival reference. **For current state — what shipped, open items, learnings, bench leadership — see `state-plan-a.md`.**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four TypeScript packages (`@aihu/signals`, `@aihu/arbor`, `@aihu/runtime`, `@aihu/agent`) that together let a developer hand-write reactive custom elements with signals, mount them in a browser, and retrieve static agent metadata — all within a ~4 KB gzipped bundle, with a full test pyramid running in CI.

**Architecture:** bun workspace orchestrated by [moon](https://moonrepo.dev), four focused packages. `@aihu/signals` provides reactive primitives (signal, computed, effect). `@aihu/arbor` builds a persistent reactive tree (branch/leaf) on top of signals with lifecycle scopes. `@aihu/runtime` wires arbor into Web Components via `defineElement`. `@aihu/agent` exposes a static-metadata accessor. Every package is individually buildable, testable, and size-gated.

**Tech Stack:** [proto](https://moonrepo.dev/proto) toolchain manager pinning bun 1.3+ and node 20.18+, [moon](https://moonrepo.dev) for cross-package task orchestration, TypeScript 5.5+, [Biome](https://biomejs.dev) for lint + format, vitest 2+, fast-check 3+, jsdom 24+, [Rolldown](https://rolldown.rs) for package builds (uses oxc-parser, oxc-transformer, oxc-minifier internally) with [rolldown-plugin-dts](https://github.com/sxzz/rolldown-plugin-dts) for type emission, size-limit (bundle gates), GitHub Actions (CI).

**Ecosystem alignment:** Rolldown is the bundler that powers Vite 6+, so the runtime packages are built with the same toolchain that consuming apps use in dev/build. This keeps Plans B/C (Vite plugin, SFC compiler) on a single OXC-based pipeline end to end.

**Out of scope:** Rust crates, Vite plugin, SFC compiler, `.aihu` files, Playwright e2e. All of those land in Plans B and C.

---

## File Structure

```
fellwork/aihu/
├── package.json                        # workspace root; bun workspaces, scripts, dev deps
├── bun.lock                            # bun lockfile
├── .prototools                         # proto-pinned bun + node versions
├── .moon/
│   ├── workspace.yml                   # moon project graph
│   ├── toolchain.yml                   # moon toolchain (bun)
│   └── tasks.yml                       # shared build/typecheck tasks
├── tsconfig.base.json                  # shared TS config
├── .size-limit.json                    # bundle-size CI gate config
├── biome.json                          # Biome lint + format config
├── vitest.config.ts                    # root test config (coverage, aliases)
├── .github/
│   └── workflows/
│       └── plan-a.yml                  # CI workflow for TS runtime family
├── packages/
│   ├── signals/
│   │   ├── package.json                # @aihu/signals
│   │   ├── tsconfig.json
│   │   ├── rolldown.config.ts
│   │   ├── src/
│   │   │   ├── index.ts                # public exports
│   │   │   ├── signal.ts               # signal() primitive
│   │   │   ├── effect.ts               # effect() + dep tracking
│   │   │   ├── computed.ts             # computed() memoized derivations
│   │   │   ├── state.ts                # $state runes-style sugar
│   │   │   └── errors.ts               # SignalError, cycle detection
│   │   └── tests/
│   │       ├── signal.test.ts
│   │       ├── effect.test.ts
│   │       ├── computed.test.ts
│   │       ├── state.test.ts
│   │       └── properties.test.ts      # fast-check invariants
│   ├── arbor/
│   │   ├── package.json                # @aihu/arbor
│   │   ├── tsconfig.json
│   │   ├── rolldown.config.ts
│   │   ├── src/
│   │   │   ├── index.ts                # public exports
│   │   │   ├── types.ts                # Branch, Leaf, AttrMap, ChildList
│   │   │   ├── leaf.ts                 # leaf() + leaf.element()
│   │   │   ├── branch.ts               # branch()
│   │   │   ├── mount.ts                # mount(), MountScope, dispose
│   │   │   ├── attrs.ts                # signal-to-DOM attr bindings
│   │   │   ├── structural.ts           # when()/each() stubs
│   │   │   └── errors.ts               # ArborError
│   │   └── tests/
│   │       ├── leaf.test.ts
│   │       ├── branch.test.ts
│   │       ├── mount.test.ts
│   │       ├── attrs.test.ts
│   │       ├── structural.test.ts
│   │       └── bench.test.ts           # 10k-leaves microbenchmark
│   ├── runtime/
│   │   ├── package.json                # @aihu/runtime
│   │   ├── tsconfig.json
│   │   ├── rolldown.config.ts
│   │   ├── src/
│   │   │   ├── index.ts                # public exports
│   │   │   ├── define-element.ts       # defineElement(spec)
│   │   │   └── types.ts                # ElementSpec, shadow modes
│   │   └── tests/
│   │       └── define-element.test.ts
│   └── agent/
│       ├── package.json                # @aihu/agent
│       ├── tsconfig.json
│       ├── rolldown.config.ts
│       ├── src/
│       │   ├── index.ts
│       │   ├── registry.ts             # registerAgentMetadata, getAgentMetadata
│       │   └── types.ts                # AgentMetadata type
│       └── tests/
│           └── registry.test.ts
└── tests/
    └── integration/
        ├── mount-arbor-with-signals.test.ts
        └── define-element-integration.test.ts
```

---

## Phase 1 — Workspace Scaffolding

> **Toolchain note:** versions are pinned by [proto](https://moonrepo.dev/proto) via `.prototools`. Cross-package task orchestration is handled by [moon](https://moonrepo.dev). Package management uses [bun](https://bun.sh) workspaces. There is no `pnpm-workspace.yaml`, no `.nvmrc`, no `pnpm-lock.yaml`.

### Task 1: Initialize bun workspace with proto-pinned toolchain

**Files:**
- Create: `.prototools`
- Create: `package.json`
- Create: `bun.lock` (generated by `bun install`)
- Create: `.moon/workspace.yml`, `.moon/toolchain.yml` (via `moon init`)

**Prerequisite:** `proto`, `bun`, and `moon` must be on PATH. With proto installed, `proto install` will read `.prototools` once written.

- [x] **Step 1: Create `.prototools`**

```toml
bun = "1.3.8"
node = "20.18.0"
```

- [x] **Step 2: Create root `package.json`**

```json
{
  "name": "aihu",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "engines": {
    "bun": ">=1.3.0",
    "node": ">=20.18.0"
  },
  "scripts": {
    "build": "moon run :build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run --config tests/vitest.config.ts",
    "typecheck": "moon run :typecheck",
    "lint": "eslint . --ext .ts",
    "format": "prettier --write .",
    "size": "size-limit"
  },
  "devDependencies": {
    "@size-limit/preset-small-lib": "^11.1.6",
    "@types/node": "^20.16.5",
    "@typescript-eslint/eslint-plugin": "^8.8.0",
    "@typescript-eslint/parser": "^8.8.0",
    "eslint": "^8.57.1",
    "eslint-config-prettier": "^9.1.0",
    "fast-check": "^3.22.0",
    "jsdom": "^25.0.1",
    "prettier": "^3.3.3",
    "size-limit": "^11.1.6",
    "rolldown": "^1.0.0-rc.17",
    "rolldown-plugin-dts": "^0.23.2",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1"
  }
}
```

> Note: the `tests/` directory is **not** a bun workspace member; it's picked up by `vitest.config.ts` directly. Bun errors if a workspace path doesn't exist.

- [x] **Step 3: Install dependencies**

Run: `bun install`
Expected: Creates `node_modules/` and `bun.lock`. Workspaces glob matches no packages yet, so only root devDeps install.

- [x] **Step 4: Initialize moon workspace**

Run: `moon init --yes --minimal`
Then edit `.moon/workspace.yml` so `vcs.defaultBranch` is `"main"` (moon defaults to the current branch, which may not be main during feature work).
Add `.moon/toolchain.yml`:
```yaml
# yaml-language-server: $schema=https://moonrepo.dev/schemas/toolchain.json
bun:
  version: "1.3.8"
```

- [x] **Step 5: Commit**

```bash
git add .prototools package.json bun.lock
git commit -m "chore: initialize bun workspace with proto-pinned toolchain"
git add .moon/ package.json
git commit -m "chore: add moon workspace config for task orchestration"
```

---

### Task 2: Root TypeScript config

**Files:**
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`

- [x] **Step 1: Create `tsconfig.base.json`**

Create file at the repo root:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true
  }
}
```

- [x] **Step 2: Create root `tsconfig.json`**

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["packages/*/src/**/*.ts", "packages/*/tests/**/*.ts", "tests/**/*.ts"]
}
```

- [x] **Step 3: Skip verification until Phase 2**

`bunx tsc --noEmit` errors with `TS18003: No inputs were found` until the first package lands. Config itself is valid; the verification step happens at the end of Task 6 when `@aihu/signals/src/index.ts` exists.

- [x] **Step 4: Commit**

```bash
git add tsconfig.base.json tsconfig.json
git commit -m "chore: add root TypeScript config"
```

---

### Task 3: Lint and format config (Biome)

**Files:**
- Create: `biome.json`
- Add devDep: `@biomejs/biome`

[Biome](https://biomejs.dev) replaces both ESLint and Prettier in one binary. It has no plugin system to wire up, runs in milliseconds, and respects `.gitignore` automatically (`vcs.useIgnoreFile`).

- [x] **Step 1: Install Biome**

```bash
bun add -D @biomejs/biome
```

- [x] **Step 2: Initialize and configure `biome.json`**

```bash
bunx biome init
```
Then replace generated `biome.json` with project-tuned config:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.13/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": false,
    "includes": ["**", "!dist", "!coverage", "!target", "!bun.lock", "!**/*.cjs"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "asNeeded",
      "trailingCommas": "all",
      "arrowParentheses": "always"
    }
  },
  "assist": {
    "enabled": true,
    "actions": {
      "source": { "organizeImports": "on" }
    }
  }
}
```

- [x] **Step 3: Wire `lint`, `format`, and `check` scripts in root `package.json`**

```json
"lint": "biome lint .",
"format": "biome format --write .",
"check": "biome check --write ."
```

`biome check` combines lint + format + import-organize in one pass — preferred for local dev. CI uses `biome ci` (read-only).

- [x] **Step 4: Verify**

Run: `bun run lint`
Expected: `Checked N files in <time>. No fixes applied.` Exits 0 even on an empty workspace (Biome doesn't fail on missing matches).

- [x] **Step 5: Commit**

```bash
git add biome.json package.json bun.lock
git commit -m "chore: replace eslint+prettier with biome"
```

---

### Task 4: Root vitest config

**Files:**
- Create: `vitest.config.ts`

- [x] **Step 1: Create `vitest.config.ts`**

> Includes `passWithNoTests: true` so `bun run test` exits 0 in the empty workspace state. Remove this flag (or leave it — it's harmless) once tests exist.

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['packages/*/tests/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/types.ts', '**/index.ts'],
    },
  },
  resolve: {
    alias: {
      '@aihu/signals': new URL('./packages/signals/src/index.ts', import.meta.url).pathname,
      '@aihu/arbor': new URL('./packages/arbor/src/index.ts', import.meta.url).pathname,
      '@aihu/runtime': new URL('./packages/runtime/src/index.ts', import.meta.url).pathname,
      '@aihu/agent': new URL('./packages/agent/src/index.ts', import.meta.url).pathname,
    },
  },
})
```

- [x] **Step 2: Run vitest to verify config loads**

Run: `bun run test`
Expected: "No test files found, exiting with code 0" — config loads without error.

- [x] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "chore: add root vitest config with package aliases"
```

---

### Task 5: size-limit config, shared moon tasks, and CI workflow

**Files:**
- Create: `.size-limit.json`
- Create: `.moon/tasks.yml`
- Create: `.github/workflows/plan-a.yml`

- [x] **Step 1: Create `.size-limit.json`**
```json
[
  {
    "name": "@aihu/signals",
    "path": "packages/signals/dist/index.js",
    "limit": "1024 B",
    "gzip": true
  },
  {
    "name": "@aihu/arbor",
    "path": "packages/arbor/dist/index.js",
    "limit": "2048 B",
    "gzip": true
  },
  {
    "name": "@aihu/runtime",
    "path": "packages/runtime/dist/index.js",
    "limit": "1024 B",
    "gzip": true
  },
  {
    "name": "@aihu/agent",
    "path": "packages/agent/dist/index.js",
    "limit": "512 B",
    "gzip": true
  },
  {
    "name": "Combined runtime family",
    "path": [
      "packages/signals/dist/index.js",
      "packages/arbor/dist/index.js",
      "packages/runtime/dist/index.js",
      "packages/agent/dist/index.js"
    ],
    "limit": "4096 B",
    "gzip": true
  }
]
```

- [x] **Step 2: Create shared moon tasks**

Create `.moon/tasks.yml`. These tasks are inherited by every project under `packages/*` so per-package `moon.yml` files only need overrides:
```yaml
# yaml-language-server: $schema=https://moonrepo.dev/schemas/tasks.json
fileGroups:
  sources:
    - "src/**/*"
  tests:
    - "tests/**/*"
  configs:
    - "tsconfig.json"
    - "rolldown.config.ts"

tasks:
  build:
    command: "rolldown -c"
    inputs:
      - "@group(sources)"
      - "@group(configs)"
      - "package.json"
    outputs:
      - "dist"
    deps:
      - "^:build"

  typecheck:
    command: "tsc --noEmit"
    inputs:
      - "@group(sources)"
      - "@group(tests)"
      - "@group(configs)"
```

- [x] **Step 3: Create CI workflow**

`moonrepo/setup-toolchain@v0` installs both proto and moon, then `auto-install: true` reads `.prototools` and installs bun + node. One step replaces the previous pnpm/setup-node combo.

```yaml
name: Plan A — TS runtime family
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: moonrepo/setup-toolchain@v0
        with:
          auto-install: true
      - run: bun install --frozen-lockfile
      - run: bunx biome ci .
      - run: bun run typecheck
      - run: bun run test --coverage
      - run: bun run build
      - run: bun run size
```

- [x] **Step 4: Commit**

```bash
git add .size-limit.json .github/workflows/plan-a.yml
git commit -m "ci: add size-limit gate and Plan A workflow"
git add .moon/tasks.yml
git commit -m "chore(moon): add shared build and typecheck tasks"
```

---

## Status checkpoint

Phase 1 (scaffolding) **complete** on branch `plan-a-phase-1`. Repo has workspace tooling, lint/format, tests, builds, and CI wired through bun + proto + moon. No source code yet. Remaining phases:

- **Phase 2:** `@aihu/signals` — reactive primitives (Tasks 6–11)
- **Phase 3:** `@aihu/arbor` — persistent reactive tree (Tasks 12–19)
- **Phase 4:** `@aihu/runtime` — WC wiring (Tasks 20–22)
- **Phase 5:** `@aihu/agent` — metadata registry (Tasks 23–24)
- **Phase 6:** Integration tests and bundle verification (Tasks 25–27)

### Toolchain conventions for Phases 2–6

When detailed task content for Phases 2–6 is authored, the following toolchain conventions apply (replacing all pnpm/`.nvmrc` references in the original plan draft):

- **Per-package `package.json`** — declare scripts only as escape hatches. Build/typecheck flow through moon, not bun's `--filter`. Each `packages/<name>/package.json` should set `"name": "@aihu/<name>"` and a peer/dev dep on workspace siblings via `"workspace:*"`.
- **Per-package `moon.yml`** — minimal; inherits `build` and `typecheck` from `.moon/tasks.yml`. Only override when a package needs custom inputs/outputs (e.g. `arbor` if it adds bench tasks).
- **Adding a dep** — `bun add -D <pkg>` at the root for shared dev deps; `bun add --filter @aihu/<name> <pkg>` for package-scoped deps.
- **Running a single package's tasks** — `moon run signals:build`, `moon run arbor:typecheck`, etc.
- **Tests** — root-level vitest already discovers `packages/*/tests/**/*.test.ts`. No per-package test task needed unless a package wants its own config.
- **CI** — already covers lint → typecheck → test → build → size via root scripts; no workflow change needed when packages land.

---

## Phase 2 — `@aihu/signals` reactive primitives

> **Goal of this phase:** ship `signal()`, `effect()`, `computed()`, `$state()` with circular-dependency detection, full unit + property test coverage, and a built artifact under the 1 KB gz size budget. Six tasks (6–11). Strict TDD: write the test, watch it fail, write the minimum to pass, commit.

**Design clarifications applied to this phase (consistent with v0 spec §6.5, §7.4):**

- `signal<T>(init)` returns a tuple `[get, set]` (Solid-shaped). `get()` is tracked when called inside an effect/computed; `set(next | updater)` propagates changes.
- Equality short-circuit: writes that are `Object.is`-equal to the current value are no-ops (no notification, no effect re-run). This is the default; an `equals: false` option opts out.
- `effect(fn)` runs `fn` synchronously once at registration, captures its dependencies, and re-runs synchronously when any dep changes. Returns a `dispose()` function that detaches the effect.
- `computed(fn)` is **lazy**: it does not run until read, and re-runs only when a dep changed since the last read. When read inside another effect/computed, it propagates dependency tracking outward.
- `$state(init)` is the **runtime** stand-in for the runes-style sugar described in §6.5. Until the SFC compiler lands (Plan C), the runtime helper exposes an accessor object with a `.value` getter/setter that delegates to the same underlying signal cell. The compiler will later compile bare reads/writes to `.value` access. This keeps the cell shape identical so the compiler swap is mechanical.
- **Cycle detection:** an effect that writes to a signal it depends on (transitively) throws `SignalCircularError` synchronously, with the dependency chain. Implemented as a "currently running" flag on each computation node — re-entry while running is the cycle signal.
- **No batching API in Phase 2.** Updates fire synchronously. Batching lands when arbor needs it (Phase 3 or later).

---

### Task 6: Scaffold `@aihu/signals` package

**Files:**
- Create: `packages/signals/package.json`
- Create: `packages/signals/tsconfig.json`
- Create: `packages/signals/moon.yml`
- Create: `packages/signals/rolldown.config.ts`
- Create: `packages/signals/src/index.ts`
- Create: `packages/signals/src/errors.ts`

- [ ] **Step 1: Create `packages/signals/package.json`**

```json
{
  "name": "@aihu/signals",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "rolldown -c",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Create `packages/signals/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Create `packages/signals/moon.yml`**

Minimal project file so moon picks up `language` and `type` for task inheritance from `.moon/tasks.yml`.

```yaml
# yaml-language-server: $schema=https://moonrepo.dev/schemas/project.json
language: typescript
type: library
```

- [ ] **Step 4: Create `packages/signals/rolldown.config.ts`**

```ts
import { defineConfig } from 'rolldown'
import { dts } from 'rolldown-plugin-dts'

export default defineConfig({
  input: 'src/index.ts',
  output: {
    dir: 'dist',
    format: 'esm',
    sourcemap: true,
  },
  plugins: [dts()],
})
```

- [ ] **Step 5: Create `packages/signals/src/errors.ts`**

```ts
export class SignalError extends Error {
  override name = 'SignalError'
}

export class SignalCircularError extends SignalError {
  override name = 'SignalCircularError'

  constructor(public readonly chain: readonly string[]) {
    super(`circular dependency detected: ${chain.join(' -> ')}`)
  }
}
```

- [ ] **Step 6: Create `packages/signals/src/index.ts` placeholder**

Re-exports nothing yet — just exists so build + typecheck succeed before Task 7 lands the first symbol.

```ts
export { SignalError, SignalCircularError } from './errors.ts'
```

- [ ] **Step 7: Refresh workspace and verify build + typecheck**

Run: `bun install`
Expected: workspaces glob now matches `packages/signals`; lockfile updated.

Run: `moon run signals:typecheck`
Expected: PASS — no source files reference unknowns.

Run: `moon run signals:build`
Expected: PASS — `packages/signals/dist/index.js` and `dist/index.d.ts` written.

- [ ] **Step 8: Trim `.size-limit.json` to only the signals row**

CI calls `bun run size`. With three of four package paths missing, size-limit exits non-zero on every CI run until Phase 5 lands. Trim the config now to the only package that exists, and reinstate rows in Tasks 12 (`arbor`), 20 (`runtime`), 23 (`agent`), and 25 (`Combined`).

Replace the contents of `.size-limit.json` with:

```json
[
  {
    "name": "@aihu/signals",
    "path": "packages/signals/dist/index.js",
    "limit": "1024 B",
    "gzip": true
  }
]
```

- [ ] **Step 9: Verify size-limit gate is green**

Run: `bun run size`
Expected: the `@aihu/signals` row reports a tiny size (likely < 200 B gz, well under the 1024 B budget). Exit code 0.

- [ ] **Step 10: Commit**

```bash
git add packages/signals .size-limit.json bun.lock
git commit -m "feat(signals): scaffold package with build, typecheck, error types"
```

---

### Task 7: `signal()` primitive — read, write, equality short-circuit

**Files:**
- Create: `packages/signals/src/signal.ts`
- Create: `packages/signals/tests/signal.test.ts`
- Modify: `packages/signals/src/index.ts`

This task ships the bare cell only — no observer wiring yet. Tracking hooks land in Task 8 alongside `effect()`. Tests here verify value semantics and equality without involving effects.

- [ ] **Step 1: Write failing test for read returns initial value**

Create `packages/signals/tests/signal.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { signal } from '../src/signal.ts'

describe('signal', () => {
  it('returns initial value on read', () => {
    const [count] = signal(0)
    expect(count()).toBe(0)
  })
})
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `bun run test -- signal`
Expected: FAIL — `Cannot find module '../src/signal.ts'`.

- [ ] **Step 3: Create `packages/signals/src/signal.ts` with minimal cell**

```ts
export type Read<T> = () => T
export type Write<T> = (next: T | ((prev: T) => T)) => void
export type Signal<T> = readonly [Read<T>, Write<T>]

export interface SignalOptions<T> {
  equals?: ((a: T, b: T) => boolean) | false
}

export interface Subscriber {
  notify(): void
}

const defaultEquals = <T>(a: T, b: T): boolean => Object.is(a, b)

let currentObserver: Subscriber | null = null

export function setCurrentObserver(observer: Subscriber | null): Subscriber | null {
  const prev = currentObserver
  currentObserver = observer
  return prev
}

export function signal<T>(initial: T, options?: SignalOptions<T>): Signal<T> {
  let value = initial
  const equals =
    options?.equals === false ? null : (options?.equals ?? (defaultEquals as (a: T, b: T) => boolean))
  const subs = new Set<Subscriber>()

  const read: Read<T> = () => {
    if (currentObserver) subs.add(currentObserver)
    return value
  }

  const write: Write<T> = (next) => {
    const nextValue =
      typeof next === 'function' ? (next as (prev: T) => T)(value) : next
    if (equals && equals(value, nextValue)) return
    value = nextValue
    // Snapshot — a subscriber's notify() may add/remove subs mid-iteration.
    for (const sub of [...subs]) sub.notify()
  }

  return [read, write] as const
}
```

- [ ] **Step 4: Run test, expect PASS**

Run: `bun run test -- signal`
Expected: PASS (1 test).

- [ ] **Step 5: Add failing test for setter mutates value**

Append to `packages/signals/tests/signal.test.ts`:

```ts
it('updates value on set', () => {
  const [count, setCount] = signal(0)
  setCount(1)
  expect(count()).toBe(1)
})
```

- [ ] **Step 6: Run test, expect PASS**

Run: `bun run test -- signal`
Expected: PASS (2 tests).

- [ ] **Step 7: Add failing test for updater function form**

Append:

```ts
it('accepts an updater function for set', () => {
  const [count, setCount] = signal(2)
  setCount((prev) => prev + 3)
  expect(count()).toBe(5)
})
```

Run: `bun run test -- signal`
Expected: PASS (3 tests).

- [ ] **Step 8: Add failing test for `Object.is` equality short-circuit**

Append:

```ts
it('short-circuits writes when next value is Object.is equal', () => {
  const [obj, setObj] = signal({ x: 1 })
  const before = obj()
  setObj(before) // same reference — should be a no-op
  expect(obj()).toBe(before)
})
```

Run: `bun run test -- signal`
Expected: PASS (4 tests).

- [ ] **Step 9: Add failing test for `equals: false` opt-out**

Append:

```ts
it('always treats writes as updates when equals is false', () => {
  const [n, setN] = signal(1, { equals: false })
  setN(1) // identical primitive — should still pass through
  expect(n()).toBe(1)
})
```

> Behavior here is observable only via subscription, which doesn't exist until Task 8. This test confirms the no-throw / no-crash path; Task 8 adds an effect-based equality test that proves notification fires.

Run: `bun run test -- signal`
Expected: PASS (5 tests).

- [ ] **Step 10: Re-export `signal` from `packages/signals/src/index.ts`**

```ts
export { signal } from './signal.ts'
export type { Read, Signal, SignalOptions, Write } from './signal.ts'
export { SignalError, SignalCircularError } from './errors.ts'
```

- [ ] **Step 11: Verify typecheck and build still pass**

Run: `moon run signals:typecheck`
Expected: PASS.

Run: `moon run signals:build`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add packages/signals
git commit -m "feat(signals): add signal() primitive with equality short-circuit"
```

---

### Task 8: `effect()` — dependency tracking and disposal

**Files:**
- Create: `packages/signals/src/effect.ts`
- Create: `packages/signals/tests/effect.test.ts`
- Modify: `packages/signals/src/index.ts`

`effect.ts` owns the `Subscriber` implementation and uses `setCurrentObserver` from `signal.ts` to plug itself into the tracking machinery during runs.

- [ ] **Step 1: Write failing test — effect runs once on registration**

Create `packages/signals/tests/effect.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { signal } from '../src/signal.ts'
import { effect } from '../src/effect.ts'

describe('effect', () => {
  it('runs synchronously once on registration', () => {
    const fn = vi.fn()
    effect(fn)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
```

Run: `bun run test -- effect`
Expected: FAIL — module not found.

- [ ] **Step 2: Create `packages/signals/src/effect.ts` with minimal effect**

```ts
import { setCurrentObserver, type Subscriber } from './signal.ts'

export type EffectFn = () => void
export type Dispose = () => void

interface Effect extends Subscriber {
  run(): void
  fn: EffectFn
  disposed: boolean
}

export function effect(fn: EffectFn): Dispose {
  const node: Effect = {
    fn,
    disposed: false,
    notify() {
      if (!node.disposed) node.run()
    },
    run() {
      const prev = setCurrentObserver(node)
      try {
        node.fn()
      } finally {
        setCurrentObserver(prev)
      }
    },
  }
  node.run()
  return () => {
    node.disposed = true
  }
}
```

Run: `bun run test -- effect`
Expected: PASS (1 test).

- [ ] **Step 3: Add failing test — effect re-runs when a tracked signal changes**

Append:

```ts
it('re-runs when a tracked signal changes', () => {
  const [count, setCount] = signal(0)
  const fn = vi.fn(() => {
    count() // track
  })
  effect(fn)
  setCount(1)
  setCount(2)
  expect(fn).toHaveBeenCalledTimes(3) // 1 init + 2 updates
})
```

Run: `bun run test -- effect`
Expected: PASS.

- [ ] **Step 4: Add failing test — equality short-circuit suppresses re-runs**

Append:

```ts
it('does not re-run when set is short-circuited by equality', () => {
  const [count, setCount] = signal(0)
  const fn = vi.fn(() => {
    count()
  })
  effect(fn)
  setCount(0) // Object.is equal — no notification
  expect(fn).toHaveBeenCalledTimes(1)
})
```

Run: `bun run test -- effect`
Expected: PASS.

- [ ] **Step 5: Add failing test — `equals: false` forces re-run on identical value**

Append:

```ts
it('re-runs on identical writes when equals is false', () => {
  const [n, setN] = signal(1, { equals: false })
  const fn = vi.fn(() => {
    n()
  })
  effect(fn)
  setN(1)
  expect(fn).toHaveBeenCalledTimes(2)
})
```

Run: `bun run test -- effect`
Expected: PASS.

- [ ] **Step 6: Add failing test — disposal stops further re-runs**

Append:

```ts
it('stops re-running after dispose()', () => {
  const [count, setCount] = signal(0)
  const fn = vi.fn(() => {
    count()
  })
  const dispose = effect(fn)
  setCount(1)
  expect(fn).toHaveBeenCalledTimes(2)
  dispose()
  setCount(2)
  expect(fn).toHaveBeenCalledTimes(2)
})
```

Run: `bun run test -- effect`
Expected: PASS.

- [ ] **Step 7: Add failing test — multiple effects on the same signal each fire**

Append:

```ts
it('notifies every subscribing effect', () => {
  const [v, setV] = signal('a')
  const a = vi.fn(() => {
    v()
  })
  const b = vi.fn(() => {
    v()
  })
  effect(a)
  effect(b)
  setV('b')
  expect(a).toHaveBeenCalledTimes(2)
  expect(b).toHaveBeenCalledTimes(2)
})
```

Run: `bun run test -- effect`
Expected: PASS.

- [ ] **Step 8: Re-export `effect` from `packages/signals/src/index.ts`**

```ts
export { signal } from './signal.ts'
export type { Read, Signal, SignalOptions, Write } from './signal.ts'
export { effect } from './effect.ts'
export type { Dispose, EffectFn } from './effect.ts'
export { SignalError, SignalCircularError } from './errors.ts'
```

- [ ] **Step 9: Verify typecheck and build**

Run: `moon run signals:typecheck`
Expected: PASS.

Run: `moon run signals:build`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/signals
git commit -m "feat(signals): add effect() with dependency tracking and disposal"
```

---

### Task 9: `computed()` — lazy memoized derivations

**Files:**
- Create: `packages/signals/src/computed.ts`
- Create: `packages/signals/tests/computed.test.ts`
- Modify: `packages/signals/src/index.ts`

`computed` behaves as both subscriber (to its deps) and signal (when read). It is **lazy**: the body runs on first read and again only when a dep has marked it stale.

- [ ] **Step 1: Write failing test — computed returns derived value**

Create `packages/signals/tests/computed.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { signal } from '../src/signal.ts'
import { computed } from '../src/computed.ts'
import { effect } from '../src/effect.ts'

describe('computed', () => {
  it('returns a derived value on read', () => {
    const [n] = signal(2)
    const doubled = computed(() => n() * 2)
    expect(doubled()).toBe(4)
  })
})
```

Run: `bun run test -- computed`
Expected: FAIL — module not found.

- [ ] **Step 2: Add `peekCurrentObserver` to `packages/signals/src/signal.ts`**

`computed` needs to read the current observer without mutating it (forward-subscription: when something reads the computed, register that observer as a sub of the computed). `setCurrentObserver` is a setter; expose a non-destructive peeker too.

Edit `packages/signals/src/signal.ts`. After the existing `setCurrentObserver` function, add:

```ts
export function peekCurrentObserver(): Subscriber | null {
  return currentObserver
}
```

- [ ] **Step 3: Create `packages/signals/src/computed.ts`**

```ts
import { peekCurrentObserver, setCurrentObserver, type Read, type Subscriber } from './signal.ts'

interface ComputedNode<T> extends Subscriber {
  value: T | undefined
  stale: boolean
  fn: () => T
  subs: Set<Subscriber>
}

export function computed<T>(fn: () => T): Read<T> {
  const node: ComputedNode<T> = {
    value: undefined,
    stale: true,
    fn,
    subs: new Set(),
    notify() {
      if (node.stale) return
      node.stale = true
      // Cascade staleness so downstream computeds/effects re-evaluate.
      for (const sub of [...node.subs]) sub.notify()
    },
  }

  const read: Read<T> = () => {
    if (node.stale) {
      const prev = setCurrentObserver(node)
      try {
        node.value = node.fn()
      } finally {
        setCurrentObserver(prev)
      }
      node.stale = false
    }
    // Forward subscription: if a downstream observer is reading us, register it.
    const obs = peekCurrentObserver()
    if (obs) node.subs.add(obs)
    return node.value as T
  }

  return read
}
```

- [ ] **Step 4: Run test, expect PASS**

Run: `bun run test -- computed`
Expected: PASS (1 test).

- [ ] **Step 5: Add failing test — computed re-derives only when dep changes**

Append to `packages/signals/tests/computed.test.ts`:

```ts
it('re-derives only when a dep changes', () => {
  const [n, setN] = signal(2)
  const fn = vi.fn(() => n() * 2)
  const doubled = computed(fn)
  expect(doubled()).toBe(4)
  expect(doubled()).toBe(4) // cached — no re-derive
  expect(fn).toHaveBeenCalledTimes(1)
  setN(3)
  expect(doubled()).toBe(6)
  expect(fn).toHaveBeenCalledTimes(2)
})
```

Run: `bun run test -- computed`
Expected: PASS.

- [ ] **Step 6: Add failing test — computed in effect retriggers downstream**

Append:

```ts
it('triggers downstream effects through the computed', () => {
  const [n, setN] = signal(1)
  const doubled = computed(() => n() * 2)
  const seen: number[] = []
  effect(() => {
    seen.push(doubled())
  })
  setN(5)
  setN(7)
  expect(seen).toEqual([2, 10, 14])
})
```

Run: `bun run test -- computed`
Expected: PASS.

- [ ] **Step 7: Add failing test — chained computeds stay lazy**

Append:

```ts
it('chains lazily: outer recomputes only on read after dep change', () => {
  const [n, setN] = signal(1)
  const innerFn = vi.fn(() => n() + 1)
  const inner = computed(innerFn)
  const outerFn = vi.fn(() => inner() * 10)
  const outer = computed(outerFn)

  expect(outer()).toBe(20)
  expect(innerFn).toHaveBeenCalledTimes(1)
  expect(outerFn).toHaveBeenCalledTimes(1)

  setN(4) // marks both stale, but neither runs yet
  expect(innerFn).toHaveBeenCalledTimes(1)
  expect(outerFn).toHaveBeenCalledTimes(1)

  expect(outer()).toBe(50)
  expect(innerFn).toHaveBeenCalledTimes(2)
  expect(outerFn).toHaveBeenCalledTimes(2)
})
```

Run: `bun run test -- computed`
Expected: PASS.

- [ ] **Step 8: Re-export `computed` from `packages/signals/src/index.ts`**

```ts
export { signal } from './signal.ts'
export type { Read, Signal, SignalOptions, Write } from './signal.ts'
export { effect } from './effect.ts'
export type { Dispose, EffectFn } from './effect.ts'
export { computed } from './computed.ts'
export { SignalError, SignalCircularError } from './errors.ts'
```

- [ ] **Step 9: Verify typecheck and build**

Run: `moon run signals:typecheck`
Expected: PASS.

Run: `moon run signals:build`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/signals
git commit -m "feat(signals): add lazy computed() with cascade invalidation"
```

---

### Task 10: `$state()` — runes-style accessor

**Files:**
- Create: `packages/signals/src/state.ts`
- Create: `packages/signals/tests/state.test.ts`
- Modify: `packages/signals/src/index.ts`

`$state(init)` returns a small object with a `.value` get/set that delegates to the same underlying signal cell. This is the v0 runtime stand-in for the future compiler-emitted runes form. Same cell shape, same tracking, different ergonomics.

- [ ] **Step 1: Write failing test — read via `.value`**

Create `packages/signals/tests/state.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { $state } from '../src/state.ts'
import { effect } from '../src/effect.ts'

describe('$state', () => {
  it('reads initial value via .value', () => {
    const count = $state(0)
    expect(count.value).toBe(0)
  })
})
```

Run: `bun run test -- state`
Expected: FAIL — module not found.

- [ ] **Step 2: Create `packages/signals/src/state.ts`**

```ts
import { signal } from './signal.ts'

export interface State<T> {
  value: T
}

export function $state<T>(initial: T): State<T> {
  const [get, set] = signal(initial)
  return {
    get value(): T {
      return get()
    },
    set value(next: T) {
      set(next)
    },
  }
}
```

Run: `bun run test -- state`
Expected: PASS (1 test).

- [ ] **Step 3: Add failing test — assignment via `.value` updates the cell**

Append:

```ts
it('updates the cell when .value is assigned', () => {
  const count = $state(0)
  count.value = 5
  expect(count.value).toBe(5)
})
```

Run: `bun run test -- state`
Expected: PASS.

- [ ] **Step 4: Add failing test — `.value` reads are tracked by effects**

Append:

```ts
it('tracks .value reads inside effects', () => {
  const count = $state(0)
  const fn = vi.fn(() => {
    count.value
  })
  effect(fn)
  count.value = 1
  count.value = 2
  expect(fn).toHaveBeenCalledTimes(3)
})
```

Run: `bun run test -- state`
Expected: PASS.

- [ ] **Step 5: Add failing test — equality short-circuit applies through `.value`**

Append:

```ts
it('short-circuits identical assignments', () => {
  const count = $state(7)
  const fn = vi.fn(() => {
    count.value
  })
  effect(fn)
  count.value = 7
  expect(fn).toHaveBeenCalledTimes(1)
})
```

Run: `bun run test -- state`
Expected: PASS.

- [ ] **Step 6: Re-export `$state` from `packages/signals/src/index.ts`**

```ts
export { signal } from './signal.ts'
export type { Read, Signal, SignalOptions, Write } from './signal.ts'
export { effect } from './effect.ts'
export type { Dispose, EffectFn } from './effect.ts'
export { computed } from './computed.ts'
export { $state } from './state.ts'
export type { State } from './state.ts'
export { SignalError, SignalCircularError } from './errors.ts'
```

- [ ] **Step 7: Verify typecheck and build**

Run: `moon run signals:typecheck`
Expected: PASS.

Run: `moon run signals:build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/signals
git commit -m "feat(signals): add \$state runtime accessor sharing signal cells"
```

---

### Task 11: cycle detection, fast-check property tests, size-limit verification

**Files:**
- Modify: `packages/signals/src/effect.ts`
- Modify: `packages/signals/src/computed.ts`
- Create: `packages/signals/tests/properties.test.ts`
- Modify: `packages/signals/tests/effect.test.ts`

Cycle detection lives on `effect` and `computed` runs: a `running` flag flips true while the body executes; if `notify()` fires while running, it means the body wrote to a dep it just read — a cycle. We throw `SignalCircularError` synchronously from the writer's call stack.

- [ ] **Step 1: Write failing test — direct self-write inside effect throws**

Append to `packages/signals/tests/effect.test.ts`:

```ts
import { SignalCircularError } from '../src/errors.ts'

it('throws SignalCircularError when an effect writes to its own dep', () => {
  const [count, setCount] = signal(0)
  expect(() => {
    effect(() => {
      const v = count()
      setCount(v + 1)
    })
  }).toThrow(SignalCircularError)
})
```

Run: `bun run test -- effect`
Expected: FAIL — currently re-runs (or stack overflows) instead of throwing.

- [ ] **Step 2: Add `running` flag and cycle check to `effect.ts`**

Replace the `Effect` interface and `effect()` body in `packages/signals/src/effect.ts`:

```ts
import { setCurrentObserver, type Subscriber } from './signal.ts'
import { SignalCircularError } from './errors.ts'

export type EffectFn = () => void
export type Dispose = () => void

interface Effect extends Subscriber {
  run(): void
  fn: EffectFn
  disposed: boolean
  running: boolean
}

export function effect(fn: EffectFn): Dispose {
  const node: Effect = {
    fn,
    disposed: false,
    running: false,
    notify() {
      if (node.disposed) return
      if (node.running) {
        throw new SignalCircularError(['effect'])
      }
      node.run()
    },
    run() {
      node.running = true
      const prev = setCurrentObserver(node)
      try {
        node.fn()
      } finally {
        setCurrentObserver(prev)
        node.running = false
      }
    },
  }
  node.run()
  return () => {
    node.disposed = true
  }
}
```

Run: `bun run test -- effect`
Expected: PASS — cycle is detected synchronously from the `setCount(v + 1)` call site.

- [ ] **Step 3: Add failing test — cycle through a computed also throws**

Append to `packages/signals/tests/computed.test.ts`:

```ts
import { SignalCircularError } from '../src/errors.ts'

it('throws SignalCircularError on indirect cycle through a computed', () => {
  const [n, setN] = signal(0)
  const inc = computed(() => n() + 1)
  expect(() => {
    effect(() => {
      const next = inc()
      setN(next) // writes a dep transitively read through `inc`
    })
  }).toThrow(SignalCircularError)
})
```

Run: `bun run test -- computed`
Expected: FAIL — computed has no `running` guard yet, so the write cascades and either re-runs or stack-overflows before the effect's guard fires.

> **Why this case slips past effect's guard:** when `setN` is called, the signal notifies the computed first (which marks itself stale and notifies the effect). The effect's `notify()` then sees `running === true` and *should* throw — verify whether Step 2's guard already covers this. If it does, this test passes after Step 4 is a no-op for that path; either way Step 4 hardens computed against direct cycles where a computed reads a signal it ends up writing through another computed. Run the test first; if it already passes after Step 2, mark Step 4 done with no edits and proceed.

- [ ] **Step 4: Add `running` guard to `computed.ts`**

In `packages/signals/src/computed.ts`, modify the `ComputedNode` interface and `read` body:

```ts
interface ComputedNode<T> extends Subscriber {
  value: T | undefined
  stale: boolean
  running: boolean
  fn: () => T
  subs: Set<Subscriber>
}
```

Add `import { SignalCircularError } from './errors.ts'` at the top of `computed.ts`. Set `running: false` in the initial node literal. Replace the existing `read` body with:

```ts
const read: Read<T> = () => {
  if (node.stale) {
    if (node.running) {
      throw new SignalCircularError(['computed'])
    }
    node.running = true
    const prev = setCurrentObserver(node)
    try {
      node.value = node.fn()
    } finally {
      setCurrentObserver(prev)
      node.running = false
    }
    node.stale = false
  }
  const obs = peekCurrentObserver()
  if (obs) node.subs.add(obs)
  return node.value as T
}
```

Run: `bun run test -- computed`
Expected: PASS.

- [ ] **Step 5: Add fast-check property tests**

Create `packages/signals/tests/properties.test.ts`:

```ts
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { computed } from '../src/computed.ts'
import { effect } from '../src/effect.ts'
import { signal } from '../src/signal.ts'

describe('signal properties', () => {
  it('last write wins: get equals most recent set', () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { minLength: 1 }), (writes) => {
        const [n, setN] = signal(0)
        for (const w of writes) setN(w)
        return n() === writes[writes.length - 1]
      }),
    )
  })

  it('effect runs equal 1 + number of distinct consecutive writes', () => {
    fc.assert(
      fc.property(fc.array(fc.integer(-3, 3)), (writes) => {
        const [n, setN] = signal(0)
        let runs = 0
        effect(() => {
          n()
          runs++
        })
        let prev = 0
        let changes = 0
        for (const w of writes) {
          if (!Object.is(prev, w)) {
            changes++
            prev = w
          }
          setN(w)
        }
        return runs === 1 + changes
      }),
    )
  })

  it('computed value equals f(signal) for any sequence of writes', () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), (writes) => {
        const [n, setN] = signal(0)
        const sq = computed(() => n() * n())
        for (const w of writes) {
          setN(w)
          if (sq() !== w * w) return false
        }
        return true
      }),
    )
  })
})
```

Run: `bun run test -- properties`
Expected: PASS (3 properties, default fast-check sample size).

- [ ] **Step 6: Run full test suite and confirm green**

Run: `bun run test`
Expected: All signal/effect/computed/state/properties tests PASS. No skipped tests.

- [ ] **Step 7: Run typecheck and lint**

Run: `moon run signals:typecheck`
Expected: PASS.

Run: `bun run lint`
Expected: PASS — Biome reports no issues for `packages/signals/**`.

- [ ] **Step 8: Build and verify size budget**

Run: `moon run signals:build`
Expected: `packages/signals/dist/index.js` and `dist/index.d.ts` written.

Run: `bun run size`
Expected: `@aihu/signals` row reports `<= 1024 B` gz and is marked passing. Exit code 0.

> If `@aihu/signals` exceeds 1024 B gz, profile with `bunx rolldown -c --inspect` (or `bun run build` then inspect `dist/index.js`). Likely culprits: stringly-named errors, dead `peekCurrentObserver` indirection, exported types that pull in heavyweight DOM lib references. Trim before committing.

- [ ] **Step 9: Commit**

```bash
git add packages/signals
git commit -m "feat(signals): cycle detection, property tests, size-budget verified"
```

---

## Status checkpoint

Phase 2 (`@aihu/signals`) **complete** when all Task 11 verifications pass: full test pyramid green, typecheck clean, lint clean, build emits ESM + dts, signals row of size-limit reports under 1024 B gz. Public surface: `signal`, `effect`, `computed`, `$state`, `SignalError`, `SignalCircularError` plus their types. Remaining phases:

- **Phase 3:** `@aihu/arbor` — persistent reactive tree (Tasks 12–19)
- **Phase 4:** `@aihu/runtime` — WC wiring (Tasks 20–22)
- **Phase 5:** `@aihu/agent` — metadata registry (Tasks 23–24)
- **Phase 6:** Integration tests and bundle verification (Tasks 25–27)

*Phases 3–6 follow in the next document edits.*

---

## Phase 3 — `@aihu/arbor` persistent reactive tree

> **Authoritative source:** `.team/phase-3/spec-arbor.md` (Team Lead, 2026-04-26).
> The plan section below is a navigational index — full task definitions, test plans, file lists, and rationale live in the spec.
>
> The Phase 3 spec session also locked four project-level decisions that affect later phases. Read `.team/learnings.md` Learnings #10–#18 before consuming this section.

### Task 12.5 — Add `untrack` to `@aihu/signals` (prep commit)

Authorized by Team Lead Call 1 in the Phase 3 launch brief. Builder ships before Task 12. Spec §1.1.

### Task 12 — Scaffold `@aihu/arbor`

Package scaffold (package.json, tsconfig, moon.yml, rolldown.config), errors, types, `.size-limit.json` arbor row at 2048 B gz. Spec §3, §5.

### Task 13 — `leaf()` and `leaf.element()`

Text leaf and element leaf factories. Spec §1.3, §4 Task 13.

### Task 14 — `branch()`

Branch factory with static children. Spec §1.2, §4 Task 14.

### Task 15 — AttrMap subscription

Static attrs, reactive signal attrs, event handlers. Three runtime detection paths. Spec §1.2, §2.4, §4 Task 15.

### Task 16 — `mount()` and `MountScope`

DOM materialization and scope-collector (`_activeMountDisposers`). Spec §1.4, §1.5, §2.2, §2.3.

### Task 17 — `MountScope.dispose()`

LIFO effect teardown + DOM removal + idempotency. Spec §1.5, §4 Task 17.

### Task 18 — `when()` and `each()` stubs

Throw `ArborNotImplementedError` immediately. Spec §1.6, §4 Task 18.

### Task 19 — Microbench, integration, size

10k-leaf smoke benchmark, batch+arbor integration test, size-limit verification. Phase 2.5 bench-spike (`.team/phase-2-5-bench-spike.md`) ships the comparative regression gate. Spec §4 Task 19.

---

## Phase 4 — `@aihu/runtime` Custom Elements wiring

> **Authoritative source:** `.team/phase-4/spec-runtime.md` (Architect B, 2026-04-26; touched up by Team Lead with §1.5 forward-compat note).

### Task 20 — Scaffold `@aihu/runtime`

Package scaffold, types, stub `defineElement`, CI trigger fix. Spec §3, §5.

### Task 21 — Implement `defineElement` + tests + size row

Class-wrap with shadow root injection, double-registration guard, observed-attributes propagation. 10 unit tests. `.size-limit.json` runtime row at 1024 B gz. Spec §1.2, §2, §4 Task 21.

### Task 22 — Integration test (gated on Phase 3)

Cross-package test exercising arbor + signals + runtime. Builder must not start until `@aihu/arbor` ships. Spec §4 Task 22.

### Task 22.5 (Phase 4 Architect's call) — `defineComponent(setup)` for hand-authored components

Functional wrapper for hand-authored custom elements per Learning #12 (two-layer authoring model). Recommended for v0; Phase 4 Architect adjudicates. Spec §1.5.

---

## Phase 5 — `@aihu/agent` static metadata registry

> **Authoritative source:** `.team/phase-5/spec-agent.md` (Architect C, 2026-04-26; touched up by Team Lead with §1.4 forward-compat note for app-wide manifest aggregation per Learning #15).

### Task 23 — Scaffold + implement registry

Two source files (`registry.ts`, `types.ts`), three exports (`getAgentMetadata`, `registerAgentMetadata`, `AgentMetadata`). 7 unit tests. Spec §1, §2, §4 Task 23.

### Task 24 — Verify and ship

`moon run agent:typecheck`, `moon run agent:build`, `bun run size` (`@aihu/agent` row at 100 B gz hard gate), full test suite green. Spec §3, §4 Task 24.

---

## Phase 6 — Integration tests and bundle verification (Tasks 25–27)

Not yet specced. The Phase 3 spec session left this to a future Architect once Phases 3/4/5 specs are validated by Builders. v0 spec §11 lays out the integration test scope.

---

## Phase 2.5 — Bench-spike (between Phase 3 specs and Phase 3 implementation)

> **Authoritative source:** `.team/phase-2-5-bench-spike.md`.

One-Builder spike, ~1 day wall-clock. Two tracks: (Track A) vanilla aihu vs SOTA JS reactivity (alien-signals, Solid, Vue, Preact, S.js); (Track B) aihu+magna end-to-end. Establishes the regression gate for every subsequent runtime PR per Learning #11.
