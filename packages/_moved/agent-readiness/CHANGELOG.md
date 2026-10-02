# @aihu/agent-readiness

## 2.0.6

### Patch Changes

- Updated dependencies []:
  - @aihu-plugin/agent-readiness@2.4.1

## 2.0.5

### Patch Changes

- Updated dependencies [[`04da84c`](https://github.com/aihu-project/aihu/commit/04da84ca60390fb7198588afe3a5872ab134defe)]:
  - @aihu-plugin/agent-readiness@2.4.0

## 2.0.4

### Patch Changes

- Updated dependencies [[`788319c`](https://github.com/fellwork/aihu/commit/788319ca907d9a34ec83c7af655436555a42b4c0)]:
  - @aihu-plugin/agent-readiness@2.3.0

## 2.0.3

### Patch Changes

- Updated dependencies []:
  - @aihu-plugin/agent-readiness@2.2.3

## 2.0.2

### Patch Changes

- Updated dependencies []:
  - @aihu-plugin/agent-readiness@2.0.2

## 2.0.1

### Patch Changes

- Updated dependencies []:
  - @aihu-plugin/agent-readiness@2.0.1

## 2.0.0

### Major Changes

- [#171](https://github.com/fellwork/aihu/pull/171) [`7577bd1`](https://github.com/fellwork/aihu/commit/7577bd10f391b9f3996048371706c9be34b08e2e) Thanks [@srmcguirt](https://github.com/srmcguirt)! - v1.0.9 — Naming Scheme A: rename `@aihu/data` → `@aihu-plugin/data` and
  `@aihu/agent-readiness` → `@aihu-plugin/agent-readiness`.

  The two plugin-contract packages move from the framework-core `@aihu/*`
  scope into the new `@aihu-plugin/*` scope so that plugin-contract and
  framework-core surfaces can evolve at independent cadences. Decision
  record `6c7aa75b-...` (Amendment 04) ratified the scope on 2026-05-09 and
  v1.0.9 §400-416 of the v1 framework plan covers the cutover mechanics.

  **Per-package effect**

  - `@aihu-plugin/data` (new) — first publish at `1.0.0`. Same public API as
    `@aihu/data@0.1.0`; only the npm name changed.
  - `@aihu-plugin/agent-readiness` (new) — first publish at `1.0.0`. Same
    public API as `@aihu/agent-readiness@0.1.1`; only the npm name changed.
  - `@aihu/data@1.0.0` — published as a **moved stub**. The legacy name now
    installs a tiny package that re-exports `@aihu-plugin/data`. Carries
    `"deprecated"` metadata so npm surfaces the move on `npm install`.
  - `@aihu/agent-readiness@1.0.0` — same moved-stub treatment.
  - `@aihu/cli` — extends `aihu migrate` with a v1.0.9 pass that rewrites
    package.json `dependencies` blocks, static imports, dynamic imports, and
    JSDoc / Markdown URL references. Idempotent on already-renamed input.

  **Migration**

  Existing installs keep working via the deprecated stubs. To upgrade:

  ```sh
  bun add @aihu-plugin/data @aihu-plugin/agent-readiness
  bun remove @aihu/data @aihu/agent-readiness
  bunx aihu migrate
  ```

  `@aihu/agent-service` is explicitly **out of scope** for this rename and
  stays under the framework-core `@aihu/*` scope.

### Patch Changes

- Updated dependencies [[`7577bd1`](https://github.com/fellwork/aihu/commit/7577bd10f391b9f3996048371706c9be34b08e2e)]:
  - @aihu-plugin/agent-readiness@2.0.0
