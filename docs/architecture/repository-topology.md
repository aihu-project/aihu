# Aihu repository topology

**Status:** Active migration · **Updated:** 2026-09-08

The ordered checklist and release gates live in
[repository-extraction-task-list.md](./repository-extraction-task-list.md).

## Architecture goal

Every opt-in capability has a package and repository boundary that matches its
release and verification cost. Framework code remains compatible with alternate
CSS, routing, state, data, and deployment providers. The root repository proves
that published versions work together without rebuilding every source tree.

```text
                         aihu (integration owner)
                                  |
       +--------------------------+--------------------------+
       |                          |                          |
   browser core               app/tooling              server/plugins
       |                          |                          |
   aihu-dom                  aihu-runtime               aihu-server
   aihu-context              aihu-app                   aihu-auth
   aihu-primitives           aihu-use                   aihu-agent
   aihu-store                aihu-cli                   plugin repos
   aihu-ui                   aihu-language              adapter repos
   aihu-css                  aihu-vscode
   aihu-router               aihu-compiler
```

The diagram shows contract families, not bundled installs. A consumer installs
only the capabilities it selects.

## Boundary rules

- `aihu-dom` owns observation, change propagation, and DOM rendering primitives:
  signals, Arbor, reactive trees, and the opt-in DOM facade.
- `aihu-runtime` owns component definition and lifecycle behavior. It consumes
  public DOM/context/primitives packages and exposes the explicit app bridge.
- `aihu-app` owns the meta-framework integration layer. CSS, routing, state,
  data, and deployment providers remain replaceable dependencies.
- Provider repositories implement versioned capability contracts. A contract
  fixture tests the official provider, an alternate provider, and absence of a
  provider where absence is valid.
- Closely related packages share a repository only when they release and fail
  together. This is why the DOM and agent protocol families stay grouped while
  Cloudflare and Vercel adapters do not.
- Documentation, demos, native matrices, editor-host tests, and Lighthouse have
  distinct owners and triggers.

## Release and integration flow

```text
source commit
    |
    v
package CI -> exact allowlisted tarball -> isolated consumer
    |                                      |
    +------------------- pass -------------+
                           |
                           v
                OIDC release candidate
                           |
                           v
                 root compatibility smoke
                           |
                           v
                    stable npm release
```

No stable tag is created before the exact package artifact passes its own tests
and the required downstream smoke tests. Cross-repository coordination uses
published candidates instead of Git branches or local workspace links.

## CI ownership

| Work | Pull-request owner | Broader execution |
| --- | --- | --- |
| Type/unit/package checks | package repository | every relevant PR |
| Native platform matrix | compiler/CSS/server owner | release candidate, tag, schedule |
| Scaffold matrix | `aihu-cli` | representative PR case; full candidate/schedule |
| VS Code host/VSIX | `aihu-vscode` | extension PR, candidate, tag |
| Provider deploy checks | individual adapter | adapter PR/candidate |
| Docs Playwright | `aihu-docs` | affected docs/runtime inputs |
| Lighthouse | `aihu-docs` | performance PR sample; full main/candidate/schedule |
| Complete example matrix | `aihu-examples` | candidate and schedule |
| Ecosystem compatibility | root `aihu` | candidate and schedule |

This removes the current failure mode where a prose, demo, or leaf-package
change pays for Rust/native builds, all examples, the docs site, browser tests,
and Lighthouse.

## Migration safety

A repository foundation is only the first step. Source remains in the root
until the destination workflow is reviewed, npm trusted publishing is
configured, the new version is published, and the root passes against that
registry artifact. Root removal and CI simplification then land together, which
keeps rollback to the prior published version straightforward.

The current migration state and remaining waves are maintained in the task
list. That file is the source of truth for progress; this file is the stable
boundary model.
