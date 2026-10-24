# Governed Extractability (GX) — status

Live status of the GX build. Thesis: `docs/architecture/thesis.md` §GX (ratified 2026-07-21).
Design of record: `40-spec.md` (+ `50-credential-lifecycle.md`). Tracking epic: GitHub #464.

## Shipped — the compliance tier (in `main`)

An author writes one declaration and the framework derives every discovery surface + the
gate decision from it, provably drift-free:

```
@route { path: '/pricing', extract: { read: 'agents', call: 'anonymous' } }
```

| PR | What |
|---|---|
| #457 | Security: JWT `exp`/`nbf`/`aud` validation + fail-closed rate limiter |
| #458 | Thesis amendment §GX ratified |
| #459 | Phase 0: auth routes verify tokens before cookieing (P7/P8) |
| #460 | Design record published (spec + credential-lifecycle + charter) |
| #461 | Phase 1: `extract:` two-axis vocabulary, compile-error composition, three-artifact fan-out (compiler binary 0.1.12) |
| #462 | Phase 2: principal gate (`resolvePrincipal`/`decideEmission`) + `call:` axis + unified bot registry |
| #463 | Phase 3: robots.txt / `noindex` / discovery derived per-route from `read:` |

**What the compliance tier is:** `read:` derives per-route robots directives
(searchers + user-directed AI fetchers allowed, training crawlers disallowed under the
`'agents'` default), `noindex` signals, and discovery-doc listings; `call:` is enforced at
the serving gate as a ceiling over `expose:`/`$scope`. Undeclared apps are byte-identical
to today. **It is compliance-tier — advisory, honored by compliant self-identifying
crawlers, defeated by a UA-spoofer.** (Thesis §GX honest ceiling.)

## Shipped — the hard tier (in `main`)

Control is *hard* (a verified principal + server-held data, not advisory) for
`read: verified|{scope}|human`. An author declares a governed data type beside the policy;
the framework generates the loader that gates the whole data path:

```
@route { path: '/lexicon/[slug]', ssr: true,
         extract: { read: { scope: 'members' }, call: { scope: 'members' } },
         data: { type: 'LexiconEntry', preview: ['headword'] } }
```

| PR | What |
|---|---|
| #470 | Ratified design — the governed data-access boundary (`70-governed-data-access.md`): generated loaders + live entitlements |
| #471 | P3 keystone — `--target server` renders a compiled route server-side (pure Node, no DOM); compiler binary 0.1.13 |
| #472 | Phase 4 gate engine — `createGovernedRegistry` (provider + entitlement), the generated loader pipeline, `Entitled<T>`/`Withheld<T>`, memo + positive-only TTL cache, `runGate` call-axis stage, P5/I2s guard |
| #473 | Phase 4 compiler + integration — `@route data:` parse, generated withheld type (unguarded `route.data` is a compile error), P3 item-2 server render, the render seam threading gated data into SSR; binary 0.1.14 |
| #474 | Phase 5 invariants — `check:governed` G4a-c/G5a-c + `check:dual-audience` DA-f1-3, each proven to bite (self-tests both directions) |
| #475 | Runtime registry governed — `registerAgentMetadata` carries `extract`, byte-agreeing with the sidecar as a fourth artifact; binary 0.1.15 |

**What the hard tier is:** a governed route's data is fetched server-side **only after** a
verified principal passes the static token-scope meet **and** a live entitlement resolver
(e.g. "is this Fellwork member's subscription active *right now*"); withheld responses are
byte-verified clean of the governed payload across HTML **and** the loader JSON, and the
provider is never even called. Fail-closed distinguishes `entitlement` (403 denied) from
`unavailable` (503 — an outage is never a verdict). The same gate serves SSR, the E3 data
endpoint, and the agent `call:` axis from one per-request memo. The G4/G5/DA-f invariants
make every guarantee above non-regressable at build time. Undeclared apps are byte-identical
to today.

**Honest ceiling in practice:** entitled dual-audience now holds for content inside a
structural `{#if}`/`{#each}` guard as well as direct interpolations — the SSR structural
walk (#465) has landed. The Phase-5 G5c check and the e2e test auto-tightened accordingly.

## Shipped — the P3 SSR remainder (#465)

**2026-10-24 reconciliation:** the structural-walk keystone landed in
[PR #482](https://github.com/aihu-project/aihu/pull/482) (merged 2026-07-22, "Closes the
#465 core gap") — it didn't auto-close the issue because its body text broke GitHub's
`Closes #465` keyword adjacency. The issue sat open for three months afterward; a
2026-09-11 build-router pass re-flagged it `needs-spec` without re-checking `main` against
the already-merged fix. Every sub-item #465 named is independently re-verified present and
tested in current `main` as of this pass:

- **Structural directive SSR walk** — `renderNodeAsync`'s `obj.kind === 'structural'`
  branch (`packages/server/src/ssr.ts:909-920`) renders the active `{#if}` branch /
  `{#each}` items via `_structuralSubtrees`, with path-mirrored hydration markers
  (`_structuralMarkers`) and fragment handling (`_isFragment`) matching the client
  materializer. Covered by `ssr-structural.test.ts` and the differential suite in
  `ssr-string-differential.test.ts` (e.g. "an `{#each}` nested under `{#if}` still
  declines", "structural churn: same template, different state shapes, still identical").
  Nested `dataSource` boundaries inside a structural subtree keep their P5/I2s governed
  refusal on `pending` per the inline comment at `ssr.ts:910-913`.
- **Reactive/tuple leaf rendering** — `leafText` (`ssr.ts:336-342`) reads a `[read, write]`
  Signal-tuple leaf by calling `read()`, not just static string leaves.
- **`$suspense`/`@stream` boundaries** — the compiled fast path and the hand-built
  `dataSource`/walker path both preserve flush/suspend semantics (`ssr.ts:1395-1402`);
  `ssr-stream.test.ts` passes.
- **Host-less lifecycle** — fixed per `packages/runtime/CHANGELOG.md` / `packages/server/CHANGELOG.md`
  ("`show`/`class:`/`ref`/`html` effect IIFEs guard their `onMount` registration — host-less
  SSR and loop-item factories previously crashed with SCR-R0010 'no owner'").
- **Hydration parity** — `packages/runtime/src/define-element.ts` no longer has a separate
  hydrate-vs-mount connect path keyed on a global/per-tag state-script contract; the
  renderer itself (`_hydrate` vs `_mount`) is keyed on the server's stamp.

Verification: `bunx vitest run packages/server` — 271 passed, 0 failed (68 skipped only for
missing local `@aihu/compiler` native binary, per the documented `AIHU_COMPILE_BIN` trap in
`AGENTS.md`/`TOPOLOGY.md` §T6 — not a gap in the feature).

## Remaining

- **#437 — the DA4 light-DOM flip (Phase 6).** Page-level components default to
  `shadowMode: 'none'` so server-rendered content reaches non-JS crawlers; leaf components
  keep shadow encapsulation. A **breaking, next-major** change, gated on a light-DOM
  slot-projection prerequisite — held for a founder decision on release approach.

## The honest ceiling (never claim above this)
Anything an anonymous human can see, an anonymous scraper can extract. Anonymous-crawl
control is compliance-tier; hard control exists only for content behind a verified
principal AND server-held. No aihu artifact or claim may state control above this.
