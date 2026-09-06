# Aihu repository extraction task list

**Status:** Active migration plan · **Date:** 2026-09-06

This is the execution order for splitting Aihu without trading local build
speed for fragile synchronized releases. A checkbox becomes eligible only when
its acceptance criteria are met; creating an empty repository is not
completion.

## Operating rules

- Keep the framework kernel in `aihu`: `signals`, `context`, `arbor`,
  `runtime`, `reactive`, `store`, `use`, `primitives`, `app`, and `plugin`.
- Give a package its own repository when it has an independent native build,
  a distinct provider contract, a distinct release cadence, or a bounded
  downstream compatibility suite.
- Release candidates, not untested workspace links, are the integration
  mechanism between repositories.
- Move npm trusted publishing only after the destination repository's release
  workflow has built, packed, and verified every package it will publish.

## Active and foundational work

- [x] **EX-01 — Establish `aihu-compiler`.**
  - Scope: `@aihu/compiler`, its CLI and N-API platform packages, compiler
    fixtures, and compiler-only CI.
  - Complete when: the standalone repository's full check passes. This is now
    [`aihu-project/aihu-compiler`](https://github.com/aihu-project/aihu-compiler).

- [ ] **EX-02 — Move compiler releases to `aihu-compiler`.**
  - Scope: compiler CLI and N-API platform build matrices, package packing,
    release-candidate publishing, provenance, and npm trusted publishers for
    all `@aihu/compiler*` packages.
  - Complete when: a canary release from `aihu-compiler` installs and compiles
    a fixture project on every supported platform; the monorepo no longer
    publishes compiler packages.
  - Depends on: EX-01.

- [ ] **EX-03 — Publish the DOM-composition contract in `aihu`.**
  - Scope: `shadow` and `light` component modes, mount targets, slot
    projection, hydration, SSR metadata, scope identifiers, and progressive
    DOM positioning.
  - Complete when: a component can run in each DOM mode with no CSS provider,
    the official provider, and a test provider while preserving its DOM and
    hydration behavior.
  - Dependency removal: move progressive `position()` out of
    `@aihu/css-engine` so `@aihu/primitives` no longer depends on the CSS
    provider.

- [ ] **EX-04 — Separate compiler DOM metadata from style emission.**
  - Scope: compiler `shadowMode` processing and the CSS virtual-module path.
  - Complete when: the compiler emits resolved DOM metadata once and passes a
    neutral style target to an adapter; no compiler branch selects the
    official CSS engine's behavior based on the DOM mode.
  - Depends on: EX-02, EX-03.

- [ ] **EX-05 — Add provider conformance automation.**
  - Scope: a reusable fixture suite for DOM mode, slots, hydration, SSR, style
    target, and absence of a provider.
  - Complete when: the suite runs in pull requests for `aihu`, `aihu-css`,
    and a minimal alternate provider; a scheduled compatibility matrix runs
    published release candidates.
  - Depends on: EX-03, EX-04.

## Provider and native-runtime repositories

- [ ] **EX-06 — Extract `aihu-css`.**
  - Scope: `@aihu/css-engine`, CSS core, CSS platform packages, style packs,
    and CSS/Vite conformance fixtures.
  - Complete when: the CSS repository publishes a release candidate consumed
    by the conformance suite, and `@aihu/primitives` has no CSS-engine import.
  - Depends on: EX-03 through EX-05.

- [ ] **EX-07 — Define the server capability contract.**
  - Scope: the server interfaces needed by routing, plugins, and app adapters.
  - Complete when: `@aihu/router`, `@aihu-plugin/agent-readiness`,
    `@aihu-plugin/drizzle`, and `@aihu/seo` import a server contract rather
    than the concrete `@aihu/server` implementation.

- [ ] **EX-08 — Extract `aihu-server`.**
  - Scope: `@aihu/server`, its native packages, and its standalone adapter
    tests.
  - Complete when: a server release candidate passes the router and plugin
    smoke matrix, and the monorepo no longer runs the server native matrix for
    framework-only changes.
  - Depends on: EX-07.

- [ ] **EX-09 — Define the router capability contract.**
  - Scope: navigation, route state, link/outlet integration, and app-facing
    hooks.
  - Complete when: `@aihu/app` and `@aihu/use` depend on the contract rather
    than `@aihu/router`.

- [ ] **EX-10 — Extract `aihu-router`.**
  - Scope: `@aihu/router`, routing fixtures, and its provider conformance
    suite.
  - Complete when: the router repository independently publishes a release
    candidate consumed by the app smoke test.
  - Depends on: EX-08, EX-09.

## Product-facing repositories

- [ ] **EX-11 — Extract `aihu-tooling`.**
  - Scope: `@aihu/cli`, `create-aihu`, `@aihu/tsc`,
    `@aihu/language-server`, `vscode-aihu`, and `@aihu/editor`.
  - Complete when: generated projects, TypeScript diagnostics, language-server
    protocol tests, and the extension build run without the full framework
    workspace.
  - Depends on: EX-02. Keep compiler consumption on published or
    release-candidate versions.

- [ ] **EX-12 — Extract `aihu-ui`.**
  - Scope: `@aihu/ui`, source-owned recipes, registry metadata, and visual and
    accessibility checks.
  - Complete when: registry validation and recipe tests can run without
    compiler, server, or native CSS checks.
  - Depends on: EX-03, EX-05. `@aihu/primitives` stays with the framework
    kernel until its DOM contract is stable.

- [ ] **EX-13 — Extract `aihu-agents` when the protocol release graph stabilizes.**
  - Scope: `@aihu/agent`, `@aihu/agent-service`, `@aihu/agent-server`,
    `@aihu/agent-a2a`, and `@aihu/agent-acp`.
  - Complete when: the group has a documented protocol compatibility matrix
    and can release independently from `@aihu/server`.
  - Depends on: EX-07, EX-08.

## Independent integrations and plugins

- [ ] **EX-14 — Move application adapters into `aihu-adapters`.**
  - Scope: `@aihu/adapter-cloudflare` and `@aihu/adapter-vercel`.
  - Complete when: each adapter is tested against published app
    release candidates and provider-specific deployment checks run in its own
    repository.
  - Depends on: app contract stabilization after EX-09.

- [ ] **EX-15 — Extract mature plugins one at a time.**
  - Candidate order: `@aihu-plugin/data`, `@aihu-plugin/drizzle`,
    `@aihu-plugin/agent-readiness`, then `@aihu-plugin/kindly-note`.
  - Complete when: each candidate has an owner, semantic versioning policy,
    published-core smoke test, and no workspace-only import.
  - Depends on: EX-07 for server-backed plugins; EX-05 for UI-facing plugins.

- [ ] **EX-16 — Evaluate integration packages by release cadence.**
  - Scope: `@aihu/magna`, `@aihu/auth`, `@aihu/ai`, `@aihu/mcp`,
    `@aihu/scraping`, and `@aihu/seo`.
  - Complete when: each package has a recorded decision to remain in the core
    repository, move under the appropriate service owner, or become a plugin.
  - Depends on: EX-07 for packages that currently depend on the server or
    plugin implementation.

## CI decomposition and costly checks

Every check remains valuable, but its trigger and owner must match the change.
The current monorepo path builds both Rust binaries before broad checks; docs
deployment also builds the compiler, CSS compiler, and WASM playground before
running Playwright and Lighthouse. Those are the costs this migration removes.

- [ ] **EX-17 — Establish a fast, required pull-request lane.**
  - Scope: formatting, affected-package type checks and unit tests, package
    manifest checks, dependency-graph checks, and the smallest relevant bundle
    budget.
  - Complete when: documentation-only changes run no package builds; a normal
    core-library change runs neither native platform matrices nor browser
    suites; an affected package's checks are still required before merge.

- [ ] **EX-18 — Route native checks to their owners.**
  - `aihu-compiler`: Linux build plus compiler tests for compiler changes;
    five-platform CLI and N-API matrix only for release candidates, tags, and
    a scheduled smoke run.
  - `aihu-css`: Linux CSS-core build plus CSS fixtures for CSS changes; its
    platform matrix follows the same release-candidate and scheduled policy.
  - `aihu-server`: local native parity test for server changes; its platform
    matrix runs only for server release candidates, tags, and scheduled smoke.
  - Complete when: framework, documentation, UI, router, and tooling changes
    cannot queue compiler, CSS, or server platform jobs.
  - Depends on: EX-02, EX-06, EX-08.

- [ ] **EX-19 — Split the aihu.dev build into independent artifacts.**
  - Docs shell: build guides, prose, navigation, and the static site against
    released or release-candidate framework packages. It must not run
    `moon run :build` for the entire workspace.
  - API reference: have each published package supply a versioned API metadata
    artifact; the docs generator consumes those artifacts rather than building
    every package merely to inspect `dist` files.
  - Playground: publish the compiler WASM bundle and preview runtime as
    versioned compiler/core artifacts. Docs downloads the pinned artifact; it
    does not install wasm-pack or compile Rust unless the corresponding source
    changes.
  - Complete when: a prose or docs-shell change builds only the site, while a
    compiler change builds the compiler artifact once and the docs integration
    job consumes that exact release candidate.
  - Depends on: EX-02.

- [ ] **EX-20 — Give demos their own build and ownership lanes.**
  - Scope: the standalone `examples/*` applications and embedded aihu.dev
    demos, including CSS, routing, agent, adapter, data, and primitives
    scenarios.
  - Policy: each example declares the framework capabilities it consumes. A
    provider change runs only its affected examples plus one representative
    cross-capability smoke test; the complete example suite runs nightly and
    for release candidates.
  - Complete when: changing an example or a single package no longer causes
    every demo to build, while every supported integration still has a named
    owner and scheduled smoke coverage.
  - Depends on: EX-05, EX-08, EX-10, EX-13 through EX-16 as applicable.

- [ ] **EX-21 — Move Lighthouse and docs browser checks to the docs surface.**
  - Scope: the docs-shell build, docs Playwright navigation tests, Lighthouse,
    and the embedded playground smoke test.
  - Pull-request policy: run docs build and targeted Playwright only when docs
    files or their declared runtime inputs change. Run a single Lighthouse
    sample only for an explicit performance-affecting change.
  - Promotion policy: run the full best-of-three Lighthouse gate on main,
    scheduled runs, and a release candidate; retain artifact upload for trend
    comparison.
  - Complete when: unrelated package changes cannot deploy or audit docs, and
    every dependency that can alter the docs output is declared in the docs
    workflow or consumed as a release candidate.
  - Depends on: EX-19, EX-20.

- [ ] **EX-22 — Isolate Storybook, visual, and accessibility checks.**
  - Scope: Storybook build, Playwright/axe interaction checks, required-story
    validation, and Chromatic visual review.
  - Policy: trigger only for `aihu-ui`, primitives, CSS-provider, Storybook,
    or their contract-fixture changes. Run full visual comparison on UI-facing
    pull requests; schedule the broad visual sweep.
  - Complete when: compiler-only, server-only, documentation-only, and
    integration-only changes cannot install Chromium or build Storybook.
  - Depends on: EX-06, EX-12.

- [ ] **EX-23 — Move scaffold and version matrices to tooling.**
  - Scope: generated-project smoke tests across templates, package managers,
    Vite versions, SSR mode, TypeScript projections, language-server protocol,
    and VS Code extension build.
  - Policy: one representative scaffold per tooling pull request; full
    template × package-manager × Vite × SSR matrix on `aihu-tooling` release
    candidates and scheduled runs.
  - Complete when: changing a framework leaf package does not run every
    scaffold combination, while a tooling release still proves all supported
    generated applications.
  - Depends on: EX-11.

- [ ] **EX-24 — Add release-candidate compatibility automation.**
  - Complete when: a small downstream smoke suite runs before every provider
    release, a scheduled supported-version matrix catches drift, and a full
    ecosystem suite runs only for framework contract changes.

- [ ] **EX-25 — Open the external extension path.**
  - Complete when: at least one alternate provider has passed the same
    conformance suite as the official provider, the registry has automated
    metadata and provenance checks, and extension documentation states the
    compatibility promise.
  - Depends on: EX-05, EX-06, EX-24.

## Packages intentionally retained in `aihu` for now

The core package group is not a missed extraction. Its high-frequency internal
changes make an early split more expensive than its build cost: `@aihu/signals`,
`@aihu/context`, `@aihu/arbor`, `@aihu/runtime`, `@aihu/reactive`,
`@aihu/store`, `@aihu/use`, `@aihu/primitives`, `@aihu/app`, and
`@aihu/plugin` remain together until their public contracts and release
cadences diverge.
