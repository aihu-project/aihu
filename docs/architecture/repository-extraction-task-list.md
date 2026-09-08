# Aihu repository extraction task list

**Status:** Active migration plan · **Updated:** 2026-09-08

The repository split now follows package release boundaries. The root `aihu`
repository is the integration owner while packages move to independently
versioned repositories. A package is not considered migrated until the
standalone release is published and the root consumes that release.

## Non-negotiable release gate

Every published repository must prove the same contract before a tag exists:

1. CI pins npm 11.5.1 or newer, avoids `setup-node` registry token wiring, and
   uses GitHub OIDC trusted publishing.
2. The release job installs locked dependencies with lifecycle scripts disabled,
   then explicitly runs only the build steps the package requires.
3. Classic npm tokens are rejected from environment variables and project,
   default user, and global npm configuration without printing their values.
4. CI creates one tarball in a clean directory and carries that exact path
   through manifest checks, an isolated consumer install, and `npm publish`.
5. The tarball has an explicit file allowlist, valid exports, public dependency
   ranges, and no `workspace:` references.
6. The release tag exactly matches the package name/version policy, points to
   the reviewed default-branch commit, the target version returns npm `E404`,
   and publishing uses provenance.
7. `.codemap/config.json` is tracked and names only verified package seams.

The npm trusted-publisher record is configured only after the destination
workflow passes on its default branch. Root source removal happens only after
the standalone version is published and installed by the root integration
suite.

## Completed repository foundations

These repositories exist under `aihu-project` and have standalone source,
tests, and package/release preparation. A checked repository may still await
its first post-split npm publication.

- [x] `aihu-compiler` — `@aihu/compiler` and native platform packages
- [x] `aihu-dom` — `@aihu/signals`, `@aihu/arbor`, `@aihu/reactive`, `@aihu/dom`
- [x] `aihu-css` — `@aihu/css-engine` and native platform packages
- [x] `aihu-server` — `@aihu/server`
- [x] `aihu-router` — `@aihu/router`
- [x] `aihu-editor` — `@aihu/editor`
- [x] `aihu-language` — `@aihu/tsc`, `@aihu/language-server`
- [x] `aihu-mcp` — `@aihu/mcp`
- [x] `aihu-agent` — currently `@aihu/agent`; the protocol family moves here
- [x] `aihu-ai` — `@aihu/ai`
- [x] `aihu-context` — `@aihu/context`
- [x] `aihu-plugin` — `@aihu/plugin`
- [x] `aihu-primitives` — `@aihu/primitives`
- [x] `aihu-scraping` — `@aihu/scraping`
- [x] `aihu-store` — `@aihu/store`
- [x] `aihu-ui` — `@aihu/ui`
- [x] `aihu-plugin-data` — `@aihu-plugin/data`
- [x] `aihu-plugin-drizzle` — `@aihu-plugin/drizzle`
- [x] `aihu-seo` — compatibility package extraction

`aihu-plugin-kindly-note` is prepared locally and becomes complete when its
review fixes, organization repository, and hosted CI are finished.

## Wave 1 — make existing repositories publishable

- [ ] Audit every existing release workflow against the non-negotiable gate.
- [ ] Merge only reviewed, exact-head release-contract pull requests.
- [ ] Configure npm trusted publishers for each package/repository/workflow.
- [ ] Publish the prepared standalone versions in dependency order.
- [ ] Replace matching root `workspace:` edges with published version ranges.
- [ ] Run the root consumer and package-integrity suites against registry
  artifacts.
- [ ] Remove migrated source and release ownership from the root repository.

Dependency order for publication:

```text
dom family / context / plugin / agent / ai
             │
             ├── primitives ── runtime ── app ── adapters
             ├── server ── router ── use
             └── plugins / integrations / tooling
```

## Wave 2 — extract the remaining runtime surface

- [ ] **`aihu-runtime`** — move `@aihu/runtime` and its component-boundary
  fixtures. It consumes published DOM, context, and primitives packages.
- [ ] **`aihu-app`** — move `@aihu/app` and app integration tests. Keep the
  explicit `@aihu/runtime/app` bridge tested as a public contract.
- [ ] **`aihu-use`** — move `@aihu/use` and its generated composable registry.
  Preserve generator drift checks and the portable JSON registry artifact.
- [ ] **`aihu-auth`** — move `@aihu/auth` after its server, plugin, agent, and
  signals dependencies install from the registry in an isolated consumer.

These are separate repositories because their release cadence and downstream
blast radius differ. Cross-repository smoke tests use release candidates; they
do not restore workspace coupling.

## Wave 3 — finish agent, tooling, and plugin ownership

- [ ] Add `@aihu/agent-service`, `@aihu/agent-server`, `@aihu/agent-a2a`, and
  `@aihu/agent-acp` to `aihu-agent`, with a protocol compatibility matrix.
- [ ] Create **`aihu-cli`** for `@aihu/cli` and `create-aihu`; a representative
  scaffold runs on pull requests and the full template/package-manager/Vite
  matrix runs on release candidates and schedule.
- [ ] Create **`aihu-vscode`** for `vscode-aihu`; VSIX and editor-host checks
  stay out of language-library pull requests.
- [ ] Create **`aihu-plugin-agent-readiness`** with published server/agent
  smoke tests.
- [ ] Decide whether `@aihu-plugin/demo` remains a maintained example package.
  Extract it only if it represents supported public behavior; otherwise retire
  it instead of preserving dead scaffolding.

## Wave 4 — provider adapters and service-owned integrations

- [ ] Create **`aihu-adapter-cloudflare`** for `@aihu/adapter-cloudflare`.
- [ ] Create **`aihu-adapter-vercel`** for `@aihu/adapter-vercel`.
- [ ] Test each adapter against the same published `@aihu/app` release
  candidate while keeping provider credentials and deployment checks isolated.
- [ ] Record the ownership decision for `@aihu/magna`: move its Aihu integration
  to the existing Magna owner or retain a thin Aihu package. Do not create a
  second Magna implementation.

The two adapters remain separate because each has provider-specific install,
deployment, and authentication failures. A shared conformance package supplies
the DRY contract.

## Wave 5 — remove documentation and demo cost from package CI

- [ ] Create **`aihu-docs`** for the aihu.dev shell, prose, navigation, API
  metadata aggregation, targeted Playwright, and Lighthouse ownership.
- [ ] Create **`aihu-examples`** for maintained demos and generated-project
  compatibility fixtures.
- [ ] Have packages publish versioned API metadata; docs consumes the artifacts
  without rebuilding their source trees.
- [ ] Have compiler and DOM repositories publish the pinned WASM/playground
  artifacts consumed by docs.
- [ ] Run targeted docs/browser checks on relevant pull requests. Run complete
  demo and Lighthouse matrices on main, release candidates, and schedule.

## Root `aihu` end state

The root becomes the ecosystem integration repository. It owns shared public
contracts, cross-package release-candidate smoke tests, the registry index, and
architecture/governance documents. It must not republish source owned by a
standalone repository or trigger native, docs, browser, editor, and provider
matrices for an unrelated change.

```text
package PR  -> package-owned checks -> verified release candidate
                                           |
                                           v
                                  root integration smoke
                                           |
                                           v
                                     stable publish

scheduled root job -> supported-version ecosystem matrix
```

## Definition of complete

The reorganization is complete when:

- the root contains no duplicate publishable source;
- each package has one release owner and one trusted-publisher record;
- routine package pull requests run only package-owned checks;
- native, scaffold, browser, Lighthouse, visual, and provider matrices run at
  their named owners and deliberate promotion points;
- a published-version compatibility matrix detects cross-repository drift; and
- an alternate CSS/router/data provider can opt in through documented contracts
  without pulling the official implementation into its dependency graph.
