# Aihu hosted registry

**Status:** Foundation implemented · **Date:** 2026-09-06

## Product contract

The registry gives Aihu one discovery surface across source-distributed UI
recipes and installable extensions. Humans browse it at `aihu.dev/registry`;
tools consume `aihu.dev/registry/index.json`.

The initial catalog is a public, first-party preview. It gives early users
working examples and installable official packages while extension contracts
are still evolving. External registry contributions remain closed until those
provider contracts are versioned and pass compatibility tests.

`@aihu/ui` remains the canonical source for shadcn-style recipes. `aihu add`
copies those files into an application so the application owns and edits the
result. Extensions remain versioned npm packages and display their package
install command in the same catalog.

## Opt-in provider rule

The base framework supplies component compilation, runtime primitives, and
versioned capability contracts. Routing, CSS generation, SSR, persistence,
agent transports, and similar systems are opt-in providers. Aihu's own router
and CSS engine are the first implementations of this rule: the registry lists
the capability each package provides, and an application installs the provider
it chooses. Future third-party implementations will use the same contracts once
those contracts are stable. No default provider may be bundled transitively
into the base runtime.

The current implementation is partway there. CSS engine scaffolding defaults to
none, but `@aihu/app` still imports and peers directly on `@aihu/router`, and
route macros emit imports from that concrete package. The migration should
introduce a small, versioned routing contract, resolve the configured provider
through the application, and make the router-free scaffold the base path.

The installation lifecycle depends on what is being extended:

- Source recipes use `aihu add` and become application-owned code.
- Build providers, including CSS engines and compiler transforms, are explicit
  entries in the Vite-backed project configuration.
- Runtime providers, including routers and data services, install through an
  application-level capability API and receive their options there.

Singleton capabilities such as routing select one provider. Additive extensions
may install together. Registry metadata identifies these capabilities; each
capability gets an explicit contract version when its public provider interface
is introduced. The registry does not activate packages by itself.

## Repository boundary

Core framework packages and first-party recipes live in `aihu-project/aihu`.
A plugin moves to a sibling repository under `aihu-project` when it needs an
independent release cadence, maintainer boundary, or security boundary. Moving
code does not create a second discovery system. During the preview, the Aihu
build publishes the first-party catalog. Later, sibling repositories may
publish validated contributions that aihu.dev aggregates.

A package boundary by itself is not a reason to create a repository. The core
compiler, runtime, capability contracts, CLI, UI recipes, and registry generator
can share coordinated releases while their contracts settle. Path ownership,
package-level tasks, and isolated worktrees provide agent granularity inside the
monorepo without multiplying repository automation.

Provider interfaces come before repository extraction. The router and CSS
engine are early extraction candidates once the base packages depend only on
their capability contracts; independent builds then prove that neither provider
is an implicit framework dependency. Installable plugins such as data, Drizzle,
and agent-readiness can follow when their release cadence, ownership, or
security boundary warrants a separate repository.

## Publication path

1. `packages/ui/scripts/gen-registry.ts` validates recipe metadata and emits the
   local npm-package index.
2. `apps/docs/scripts/gen-registry.ts` reads that index, inlines its source files,
   derives extension cards from package manifests, and emits both website data
   and the hosted JSON catalog.
3. The docs build runs the generator before prerendering. A `--check` mode lets
   CI fail when committed registry artifacts drift from package source.

The hosted artifact is deterministic: it contains no timestamp or environment
data. Repository URLs identify `aihu-project/aihu`, and the source remains tied
to the same commit that deploys the catalog.

## Next compatibility step

The CLI currently reads recipes from the installed `@aihu/ui` package. A later
CLI release may accept an HTTPS registry URL, but it must preserve the current
collision preview, dependency closure, prefix substitution, and dry-run rules.
Remote entries should carry a content digest and provenance before the CLI
writes them. Until that verifier exists, the hosted JSON is a discovery and
distribution API while `aihu add` continues using the installed package.
