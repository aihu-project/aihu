# aihu

A JavaScript/TypeScript meta-framework for building Web Components with
runtime-first reactivity. Authored as `.aihu` SFCs, compiled by a Rust
compiler to vanilla custom elements, mounted with sub-2 kB reactive
primitives.

## Commands

```bash
bun install                 # Install workspace deps
bun run test                # vitest, 612 TS + 232 Rust tests
bun run build               # Build all packages
bun run typecheck           # tsc --noEmit across packages
bun run size                # per-package bundle-size gate (see Conventions)
bun run bench                # benchmark suite (cellx, dynamic-deps, etc.)
```

## Stack

- **bun** — runtime, package manager
- **vitest** — test runner
- Published SFC compiler (`@aihu/compiler`, released by the standalone
  `aihu-project/aihu-compiler` repository) emits vanilla JS, a type-check
  sidecar for `tsc`/the editor, and SSR/route metadata. This repository tests
  the released artifact as a consumer and does not own compiler source.
- Workspace packages under `packages/`:
  - `@aihu/signals` — push-based signals/computeds/effects (≤ 1.7 kB gz)
  - `@aihu/arbor` — `branch`/`leaf`/`mount` DOM primitives
  - `@aihu/runtime` — runtime layer
  - `@aihu/tsc` / `@aihu/language-server` — type-checking (`aihu-tsc`) and
    editor support for `.aihu` files
  - `@aihu/agent` + `agent-readiness` — agent/MCP compliance helpers

## Conventions

- **Per-package size gates are the contract.** Every browser-eligible
  package has a row in `.size-limit.json`, validated by `bun run size`.
  New browser-tier packages add a row; server-side/build-time-only
  packages must not (see `.size-limit.README.md`).
- Output is **vanilla custom elements** — no framework lock-in at the
  consumer boundary, no global context, no hydration step.
- Reactive text updates assign `nodeValue` on a cached text node (not
  `textContent` on its parent), so a write is O(1) in the parent's child
  count instead of rebuilding its child list.
- llms.txt + MCP support is part of the contract, not optional.

## Vendored Repositories

External source vendored under `repos/` as read-only reference material,
so agents read real library code instead of guessing at an API.

- **Do not edit** anything under `repos/` unless explicitly asked.
- **Do not import from** `repos/`. Application and package code keeps
  importing from normal registry dependencies; the vendored tree exists
  to be *read*, never to be built or linked against.
- **Do not run build tooling inside** `repos/` — no `cargo`, no `bun
  install`. Pruning removes workspace members, so a vendored tree's own
  manifest is deliberately left inconsistent; the resulting errors are
  expected and are not something to "fix". Read the files, nothing else.
- Prefer patterns from the vendored source over pretrained recall or web
  search — those return whatever version happens to be current, which is
  usually not the version pinned here.
- Vendored trees are pruned to what aihu actually compiles against, not
  full upstream mirrors. A missing crate is intentional, not damage.

## gstack

AI dev tooling — headless browser, QA, design review, deploy workflows.

**Install (one-time per machine):**
```bash
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack && cd ~/.claude/skills/gstack && ./setup
```

Use `/browse` for all web browsing. Never use `mcp__claude-in-chrome__*` tools directly.

Available skills:
`/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/design-shotgun`, `/design-html`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/retro`, `/investigate`, `/document-release`, `/codex`, `/cso`, `/autoplan`, `/plan-devex-review`, `/devex-review`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`, `/learn`

## Skill routing

When the user's request matches an available skill, invoke it. When in doubt, invoke the skill.

- Product ideas/brainstorming → `/office-hours`
- Strategy/scope → `/plan-ceo-review`
- Architecture → `/plan-eng-review`
- Design system/plan review → `/design-consultation` or `/plan-design-review`
- Full review pipeline → `/autoplan`
- Bugs/errors → `/investigate`
- QA/testing site behavior → `/qa` or `/qa-only`
- Code review/diff check → `/review`
- Visual polish → `/design-review`
- Ship/deploy/PR → `/ship` or `/land-and-deploy`
- Save/resume progress → `/context-save` / `/context-restore`

## Tracker cache

GitHub issues/PRs and Linear tasks for this repo are mirrored into a local
SQLite cache (`.cache/tracker.db`) by `scripts/tracker-cache/sync.ts`, kept
fresh by a periodic local job — see `scripts/tracker-cache/README.md`.
**Read from the cache first** (`bun scripts/tracker-cache/query.ts …`)
instead of calling `gh`/Linear for routine lookups; only hit the live APIs
when the cache is stale or you need to mutate state.
