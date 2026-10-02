# @aihu/agent-acp

## 0.2.2

### Patch Changes

- Updated dependencies [[`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f), [`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f), [`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f), [`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f), [`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f)]:
  - @aihu/agent-service@0.5.0

## 0.2.1

### Patch Changes

- Updated dependencies [[`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88)]:
  - @aihu/agent-service@0.4.0

## 0.2.0

### Minor Changes

- [#455](https://github.com/fellwork/aihu/pull/455) [`5b2f3c7`](https://github.com/fellwork/aihu/commit/5b2f3c7d95c3e8075b53137eb7f87f436d5fcb28) Thanks [@srmcguirt](https://github.com/srmcguirt)! - **DEPRECATED — use `@aihu/agent-a2a` instead** ([#428](https://github.com/fellwork/aihu/issues/428)).

  The ACP protocol this package targeted (BeeAI ACP) merged into the A2A protocol
  under the Linux Foundation in August 2025 — its maintainers migrated, and there
  is no independent ACP spec left to conform to. (The "ACP" name now belongs to
  Zed's unrelated editor↔agent Agent Client Protocol, which this package never
  implemented; the package had also accumulated three conflicting name expansions
  across its own docs.)

  The package is frozen at `0.1.x`: it still compiles, its routes still respond,
  and the AT1 tier-0 `RequestContext` attribution remains intact and tested — but
  no further features will land. `package.json` now carries a `deprecated` notice;
  run `npm deprecate @aihu/agent-acp` at publish time with the same message.

  **Migration:** mount `mountA2aAdapter` from `@aihu/agent-a2a` on the same
  `AgentService`. The A2A adapter implements the A2A v1.0.1 JSON-RPC binding and
  accepts the same `resolveAuth` injection point.

  The ~293 lines of tests that validated the adapter's invented wire shape were
  deleted (not rewritten — they locked in a shape with no spec behind it). The
  attribution/argument-threading suite (`tests/attribution.test.ts`) is kept in
  full.

### Patch Changes

- Updated dependencies [[`889830d`](https://github.com/fellwork/aihu/commit/889830d907e83b7d74dc8e64503d8bb4b4711812), [`549448c`](https://github.com/fellwork/aihu/commit/549448cd042ba89b94ddb291be741f015c3d0d9c), [`e01f19d`](https://github.com/fellwork/aihu/commit/e01f19d70eabe867b8b8c310a6928b9576461cf0)]:
  - @aihu/agent-service@0.3.0

## 0.1.2

### Patch Changes

- Updated dependencies [[`a54ca1b`](https://github.com/fellwork/aihu/commit/a54ca1b8874583a0301e84c91f2d25713908e41f)]:
  - @aihu/agent-service@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`eacba9c`](https://github.com/fellwork/aihu/commit/eacba9c66145c1f208e108cea642e75b2d788185)]:
  - @aihu/agent-service@0.1.3
