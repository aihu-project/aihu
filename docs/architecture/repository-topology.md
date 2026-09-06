# Aihu repository topology

**Status:** Proposed migration · **Date:** 2026-09-06

## Goal

Repository boundaries should isolate build cost and release risk. A documentation
or registry change should not build compiler, CSS engine, and server native
artifacts. A provider change should prove compatibility with the framework
contract without running every unrelated package check.

The split is staged around dependency seams. Moving tightly coupled packages
first would replace one monorepo build with synchronized cross-repository
releases, which is slower and harder to recover.

## Target repositories

| Repository | Initial package scope | Checks owned by the repository |
| --- | --- | --- |
| `aihu` | Runtime contracts, DOM composition, signals, context, arbor, app integration | Unit tests, type checks, provider conformance harness |
| `aihu-compiler` | Compiler, native compiler packages | Compiler fixtures and native platform matrix |
| `aihu-css` | Official CSS provider and native packages | CSS fixtures, Vite provider conformance, native platform matrix |
| `aihu-router` | Official router provider | Routing fixtures, runtime provider conformance |
| `aihu-server` | Server runtime, adapters, native packages | Server tests, adapter tests, native platform matrix |
| `aihu-tooling` | CLI, create package, TypeScript integration, language server, editor extension | Scaffold matrix, editor protocol tests, CLI integration |
| `aihu-ui` | Source-owned UI recipes and registry source | Recipe validation, accessibility checks, visual checks |
| One repository per mature plugin | Data, Drizzle, agent readiness, and later providers | Package tests plus the relevant conformance suite |

Agent protocols may remain together initially because `agent-service`, A2A,
ACP, and agent-server share a release graph. They can move to `aihu-agents` when
their interfaces stop changing with the server runtime.

## DOM composition is independent of styling

Functional DOM switching is a framework capability, not a feature of the
official CSS engine. The runtime owns the `shadow` and `light` component modes,
the mount target, slot projection, hydration, event surfaces, and the component
scope identifier. This keeps a component's DOM behavior stable when an
application replaces or declines the official CSS provider.

The public DOM-composition contract should expose the resolved component mode
and a neutral style target. A CSS provider may compile styles for that target
(for example a component sheet, a document sheet, scoped CSS, or server CSS),
but it must not select the DOM mode or alter slot and hydration behavior. The
compiler should produce mode and target metadata once, then pass it separately
to the runtime and to the configured style adapter.

This corrects a current coupling: the compiler uses `shadowMode` both to inject
runtime options and to select the CSS-engine folding path. The migration must
replace that branch with a DOM composition adapter plus a CSS-provider adapter.
The progressive `position()` utility used by primitives is also DOM behavior;
it should move to a core DOM utility rather than remain an implicit
`@aihu/primitives` dependency on `@aihu/css-engine`.

## Extraction gates

A package moves only after all of these are true:

1. Its consumers import a public contract rather than the official
   implementation.
2. Its repository can build and test from published or release-candidate
   dependencies.
3. A conformance suite can test another implementation of the same capability.
4. Its release does not require a lockstep release of an unrelated repository.
5. Trusted publishing, provenance, ownership, and registry metadata are ready
   for the new repository.

Current blockers are concrete:

- `@aihu/app` imports and peers directly on `@aihu/router`.
- `@aihu/use` peers directly on `@aihu/router`.
- `@aihu/primitives` depends directly on `@aihu/css-engine` for progressive
  positioning.
- `@aihu/router` depends directly on `@aihu/server`.
- The compiler uses `shadowMode` to select both runtime DOM behavior and the
  official CSS engine's style-emission path.

These edges should be replaced with routing, DOM-composition, styling, and
server capability contracts before those providers move.

## CI model

Each repository runs its own unit, type, build, and package checks on pull
requests. Shared contract tests are versioned and reusable. Downstream
integration runs at three deliberate points:

- a small release-candidate smoke test before publishing;
- a scheduled compatibility matrix across supported provider versions;
- a full ecosystem test before changing a capability contract.

Documentation, registry, and website changes do not trigger native platform
matrices. Native provider repositories publish release candidates that the
small integration matrix consumes. The central registry aggregates validated
metadata from first-party repositories without rebuilding their packages.

## Migration order

1. Publish routing, styling, and server capability contracts with conformance
   fixtures inside `aihu`. Establish the DOM-composition contract first and
   move progressive positioning out of the CSS engine.
2. Split compiler DOM metadata from CSS-provider style emission, then remove
   the concrete dependency edges listed above.
3. Add conformance fixtures that run each DOM mode with the official CSS
   provider, an alternate provider, and no CSS provider. They must separately
   cover slot projection, hydration, SSR output, and the chosen style target.
4. Extract `aihu-compiler`, `aihu-css`, and `aihu-server` to eliminate the
   largest native build matrices from routine framework checks.
5. Extract `aihu-router`, `aihu-tooling`, and `aihu-ui` once their contract and
   release inputs are stable.
6. Move mature plugins individually as their ownership or release cadence
   diverges.
7. Open third-party registry contributions only after at least one alternative
   provider passes the same conformance suite as the official provider.
