# @aihu/auth

## 6.0.1

### Patch Changes

- Updated dependencies [[`a40aba7`](https://github.com/aihu-project/aihu/commit/a40aba75cd95539427e42a4cc0686c4f4e63c6e3)]:
  - @aihu/plugin@0.1.2

## 6.0.0

### Patch Changes

- Updated dependencies [[`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88)]:
  - @aihu/agent-service@0.4.0

## 5.0.0

### Patch Changes

- Updated dependencies [[`ad6921a`](https://github.com/fellwork/aihu/commit/ad6921a018ef4a479f6540278e549aa9a8cab387)]:
  - @aihu/signals@0.5.0

## 4.0.0

### Patch Changes

- Updated dependencies [[`18e5f6d`](https://github.com/fellwork/aihu/commit/18e5f6dda93772877690e88e8c217dcdcf4bddc2), [`ea8d2eb`](https://github.com/fellwork/aihu/commit/ea8d2ebb91c28132f399a708e2bd88877072d1db)]:
  - @aihu/signals@0.4.0

## 3.0.0

### Minor Changes

- [#459](https://github.com/fellwork/aihu/pull/459) [`2b6c013`](https://github.com/fellwork/aihu/commit/2b6c013ef7700397b73f8016dd6bc5f8d5a92dd9) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Security hardening (GX Phase 0): `createAuthRoutes` now verifies tokens before setting the session cookie.

  - The sign-in and refresh routes verify the posted token with `verifyJwt` (HMAC signature plus the registered-claim validation from [#457](https://github.com/fellwork/aihu/issues/457): `exp` required by default, `nbf`, and `aud` when `AuthConfig.audience` is set) BEFORE it is set as the session cookie. An unverifiable token is rejected with 401 and no `Set-Cookie` header. When `jwtSecret` is empty the routes fail closed (500, no cookie).
  - Docstring corrections: `AuthConfig.jwtSecret` and `VerifiedAuthPluginOptions.jwtSecret` no longer imply aihu signs or issues JWTs. aihu verifies tokens; issuance is not yet provided (planned for the GX issuance phase).

  Behavior change: previously the routes accepted any `{ token }` body and cookied it as-is; tokens must now be signed with the configured `jwtSecret` and carry valid registered claims. This matches what `getAuthState` already required to honor the cookie.

- [#457](https://github.com/fellwork/aihu/pull/457) [`11e4ae5`](https://github.com/fellwork/aihu/commit/11e4ae5165dedb23edb4a37e7bc4300eec6212e0) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Security hardening: JWT verification now enforces registered claims, and the rate limiter fails closed at capacity.

  - `@aihu/auth` (minor): `verifyJwt` (and therefore `createVerifiedAuthPlugin` and `getAuthState`) validates registered claims after the signature check: `exp` is now REQUIRED and enforced (a token without `exp` is rejected unless the service opts in via `allowNoExpiry: true`), `nbf` is enforced, a wildly future `iat` is rejected, and `aud` is enforced when an expected `audience` is configured. A configurable clock-skew leeway (`clockSkewSec`, default 60s) absorbs minor clock drift. New options surface on `VerifyJwtOptions`, `VerifiedAuthPluginOptions`, and `AuthConfig`. All failures return `null`, which the agent-service gate maps to 401 `AUTH_INVALID` (fail-closed).
  - `@aihu/scraping` (minor): `createRateLimiter` now DENIES a call it cannot positively account for — a new key when the key map is at `maxKeys` capacity, or an internal error — instead of allowing it. Under-limit behavior is unchanged. The store remains per-process; distributed accounting is a separate concern.

  Behavior change: tokens without `exp` (previously accepted forever) are now refused unless `allowNoExpiry` is explicitly set — this is the security fix.

- [#450](https://github.com/fellwork/aihu/pull/450) [`e01f19d`](https://github.com/fellwork/aihu/commit/e01f19d70eabe867b8b8c310a6928b9576461cf0) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Security fix ([#420](https://github.com/fellwork/aihu/issues/420)): rate-limit keys and scope checks derive from a signature-VERIFIED JWT principal.

  Rate-limit keys were `${userId}:${tag}` with `userId` caller-supplied over MCP and never cross-checked against the JWT `sub`, so a caller reset its own quota by rotating `userId`; the scope check likewise consulted unverified claims, so a forged `scope` claim bypassed `$scope`.

  - `@aihu/agent-service` (minor — optional interface member): `AuthPlugin.verify?(jwt) → Promise<VerifiedClaims | null>` is the single verified-claims source for BOTH the rate-limit key (`sub:tag`) and the scope gate; the gate is now async end-to-end and FAILS CLOSED (401) when a scoped/rate-limited tool meets a plugin that cannot verify. New `authDiscoveryUrl` option: 401 envelopes carry the deployment's auth-discovery URL so refused agents know where to obtain a credential.
  - `@aihu/auth` (minor): `@aihu/auth/server` exports `verifyJwt` and `createVerifiedAuthPlugin({ jwtSecret })` — the `crypto.subtle` HMAC path backing `verify`. The decode-only `createAuthPlugin` remains but cannot serve scoped/rate-limited tools.
  - `@aihu/agent-server` (minor): the MCP boundary forwards only the `jwt` credential from caller-supplied `context`; caller identity (`userId`) is dropped, never forwarded as authoritative. `authDiscoveryUrl` is threaded through and surfaced in MCP 401 error text.

  Behavior change: callers that relied on caller-supplied identity to satisfy scoped/rate-limited tools (i.e. spoofing callers, or deployments without a verifying auth plugin) are now refused with 401 — this is the security fix. Un-scoped, un-rate-limited tools are unaffected.

### Patch Changes

- Updated dependencies [[`889830d`](https://github.com/fellwork/aihu/commit/889830d907e83b7d74dc8e64503d8bb4b4711812), [`549448c`](https://github.com/fellwork/aihu/commit/549448cd042ba89b94ddb291be741f015c3d0d9c), [`e01f19d`](https://github.com/fellwork/aihu/commit/e01f19d70eabe867b8b8c310a6928b9576461cf0)]:
  - @aihu/agent-service@0.3.0

## 2.0.0

### Patch Changes

- Updated dependencies [[`514336d`](https://github.com/fellwork/aihu/commit/514336da5892c29e9e02d7a6391bb06c62d688c3)]:
  - @aihu/signals@0.3.0

## 1.0.0

### Patch Changes

- Updated dependencies [[`b85f400`](https://github.com/fellwork/aihu/commit/b85f4008c489a0dba9e36cbdfc48b635eeea375f), [`a54ca1b`](https://github.com/fellwork/aihu/commit/a54ca1b8874583a0301e84c91f2d25713908e41f)]:
  - @aihu/signals@0.2.0
  - @aihu/agent-service@0.2.0

## 0.1.2

### Patch Changes

- [#241](https://github.com/fellwork/aihu/pull/241) [`ca3431c`](https://github.com/fellwork/aihu/commit/ca3431cd53fe6af284272f1c33ec845014a7baca) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Add @aihu/magna greenfield package skeleton: dep-free GraphQL fetch, resource composition over @aihu-plugin/data, JWT relay via getToken config, and a beforeCompile SDL pipeline with graceful skip when magna-gqlmin is absent.

  Add @aihu/auth size-limit row (pre-existing gap fix — v0.1.1 shipped browser code without a budget row).

## 0.1.1

### Patch Changes

- [#176](https://github.com/fellwork/aihu/pull/176) [`eacba9c`](https://github.com/fellwork/aihu/commit/eacba9c66145c1f208e108cea642e75b2d788185) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Republish without the workspace:\* leak in published dependencies. Same Bug 1
  class fixed for @aihu/cli@0.3.2, @aihu/server@0.1.2, and @aihu/agent-readiness@0.1.2
  earlier this session.

  - @aihu/agent-service@0.1.2 ships workspace:\* for @aihu/agent (broken)
  - @aihu/auth@0.1.0 ships workspace:\* for agent-service and signals (broken)

  Changesets cascade: bumping agent-service triggers patch bumps on @aihu/agent-a2a
  and @aihu/agent-acp (which depend on agent-service via workspace:\*), so their
  tarballs republish with the clean pin to the new agent-service version.

  The publish path (scripts/publish-all.sh + bun pm pack) now correctly rewrites
  workspace:\* at pack time. Previous broken versions will be deprecated on npm
  post-republish.

- Updated dependencies [[`eacba9c`](https://github.com/fellwork/aihu/commit/eacba9c66145c1f208e108cea642e75b2d788185)]:
  - @aihu/agent-service@0.1.3
