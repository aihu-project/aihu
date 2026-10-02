# @aihu/agent-service

## 0.5.0

### Minor Changes

- [#916](https://github.com/aihu-project/aihu/pull/916) [`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Require host authorization before serving agent state reads, resolve tenant actors from live host lookups, recursively project JSON-safe results, and bind browser bridge sessions to one-use connection nonces with per-invocation reauthorization. Migration: bridge clients must speak protocol v2 and send `nonce`, `sessionToken`, `sessionIdentity`, and the verified `grantVersion` in `hello`; hosts must return `{ identity, grantVersion? }` from both `verifyBridgeSession` and `reauthorizeBridgeInvoke`, and supply `actorResolver` and `authorizeDataRead` for protected state reads. `securityHookTimeoutMs` and `bridgeCallTimeoutMs` configure bounded hook/call waits (5000ms defaults). Hosts revoke all grants for an identity with `server.revokeBridgeSession(identity)` and revoke only one exact grant with `server.revokeBridgeSession(identity, { grantVersion })`; literal grant versions such as `"*"` remain exact values. Revocation records live for 24 hours by default (configurable with `bridgeRevocationTtlMs`) and are capped at 10,000 entries by default (`bridgeRevocationMaxEntries`); when full, new bridge handshakes fail with `BRIDGE_REVOCATION_STORE_FULL` until retained entries expire, and existing verified unrevoked sessions continue to work. Revocation synchronously cancels matching pending calls; the bounded store guards new hellos and invokes, while the host's session store remains authoritative for long-lived revocation. A revoked state read returns a denial without its result. Once an action invoke has been sent, disconnect, timeout, bridge error, protocol error, or revocation returns `BRIDGE_RESULT_WITHHELD`; callers must treat the action outcome as unknown and must not assume it did not run. Projected leaves must be JSON-safe primitives, arrays, and plain records; functions, symbols, bigints, non-finite numbers, non-plain objects such as `Date`, objects with callable `toJSON` hooks, accessors on selected paths, cycles, and results beyond the default depth 32 or 10,000 total nodes fail closed as `CAPABILITY_UNAVAILABLE`. Set `projectionLimits: { maxDepth, maxNodes }` on the service/server to tune those limits. Bridge diagnostics run asynchronously after state changes and receive frozen, bounded, credential-free peer details.

### Patch Changes

- [#916](https://github.com/aihu-project/aihu/pull/916) [`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Bound capability projection work and bridge revocation storage, avoid diagnostic reentrancy, and report unknown outcomes whenever a forwarded action can no longer be confirmed.

- [#916](https://github.com/aihu-project/aihu/pull/916) [`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fail closed on untrusted proxy prototype chains, preserve revocation bindings when the bounded store is full, and close duplicate-hello peers with bounded diagnostics. Migration note: deployments that reach `bridgeRevocationMaxEntries` now refuse new bridge handshakes with `BRIDGE_REVOCATION_STORE_FULL` until revocations expire; size the cap and TTL for expected revocation volume. Existing verified, unrevoked bridge sessions remain available.

- [#916](https://github.com/aihu-project/aihu/pull/916) [`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Bound projection work for Proxy records by reading only requested own properties and rejecting oversized whole-record key sets before describing their entries.

  Keep malformed bridge hello objects out of host diagnostics, and pin the per-attachment diagnostic callback cap with a regression.

- [#916](https://github.com/aihu-project/aihu/pull/916) [`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Add configurable per-attachment (`maxPendingBridgeCalls`, default 64) and per-server (`maxPendingBridgeCallsTotal`, default 1024) bridge concurrency limits. Calls above either limit return 503 `BRIDGE_OVERLOADED` before a bridge timer or invoke frame is created. Hosts that need higher concurrency can raise both limits; invalid limits are rejected at server creation.

  Reject oversized whole-record projections before any descriptor lookup, and document that hosts must normalize untrusted Proxy or exotic values into plain data before registering them.

## 0.4.0

### Minor Changes

- [#779](https://github.com/fellwork/aihu/pull/779) [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Thread the host runtime's per-request platform context into live SSR.

  `ServerRouter.handle(req)` took a `Request` and nothing else, so a Cloudflare
  Worker's `env` — the KV namespaces, D1 databases, R2 buckets, Durable Object
  stubs and secrets — was unreachable from a page render. Those values exist ONLY
  per request; there is no module-scope handle a loader could have closed over, so
  a route loader on a Worker had exactly one data source: the public internet.

  `handle(req, platform?)` now forwards an opaque, adapter-supplied value to every
  consumer that can act on it:

  - plain route loaders, as a second argument `{ request, url, platform }` (which
    also gives a loader the request and query string for the first time)
  - the governed provider's `fetch` and `preview`
  - the live entitlement resolver (`EntitlementContext.platform`)
  - the host-verified session resolver (`GovernedRequestAuth.resolveSession`)
  - the E3 `/__aihu/data/*` transport, so it and SSR still reach the same sources

  The framework never reads inside the value, and its type is `unknown` — an
  augmentable interface with an index signature was rejected because TypeScript
  gives interfaces no implicit index signature, so `wrangler types`' generated
  `interface Env` would not have been assignable. `@aihu/adapter-cloudflare`
  passes `{ env, ctx }`, so both bindings and `waitUntil` are reachable.

  `handle(req)` with no platform is unchanged: every consumer receives no
  `platform` key at all, which is the state they were already in.

## 0.3.0

### Minor Changes

- [#462](https://github.com/fellwork/aihu/pull/462) [`549448c`](https://github.com/fellwork/aihu/commit/549448cd042ba89b94ddb291be741f015c3d0d9c) Thanks [@srmcguirt](https://github.com/srmcguirt)! - GX Phase 2 — the principal gate, `call`-axis enforcement, and the unified bot registry ([#437](https://github.com/fellwork/aihu/issues/437)-GX).

  `@aihu/agent-service` gains `principal-gate.ts`: `resolvePrincipal` (request →
  one of four principal classes: anonymous / verified-agent / scoped-agent /
  human-session, derived exclusively from `AuthPlugin.verify` — never decode-only,
  never caller-supplied identity; a presented-but-invalid credential resolves to
  anonymous) and `decideEmission` (principal × surface policy → allow/deny with
  enforcement tier). The tool gate's AUTH\_\* ladder and scope check now route
  through this one gate — behavior for existing callers is unchanged (same rungs,
  same order, same messages, same rate-limit keys).

  New enforcement: the `extract.call` axis from GX Phase 1 is consumed
  server-side as a CEILING over per-member `expose:`/`$scope` — `call: 'none'`
  makes the agent surface unavailable (404-shaped), `'verified'` forces a
  verified principal for every member, `{ scope }` is met with each member's own
  `$scope` (both must pass). Surfaces with no declaration keep today's behavior
  exactly; a malformed declared value fails closed.

  The `read` axis is DECIDED by `decideEmission` but not yet enforced anywhere —
  compliance-tier derivation is Phase 3, hard-tier withholding is Phase 4.

  `@aihu/plugin-agent-readiness` unifies its bot lists into one exported
  `BOT_REGISTRY` with a tier classification (`searcher` / `user-fetcher` /
  `training-crawler`) and a `classifyBotUserAgent` classifier
  (longest-token-first, so `Googlebot-Extended` is a trainer, not search). The
  13-bot AI list, robots.txt output, and markdown negotiation are byte-identical;
  search bots (`Googlebot`, `Bingbot`, `DuckDuckBot`, `Baiduspider`, `YandexBot`)
  exist only for classification until Phase 3 derives output from `read:`.

- [#450](https://github.com/fellwork/aihu/pull/450) [`e01f19d`](https://github.com/fellwork/aihu/commit/e01f19d70eabe867b8b8c310a6928b9576461cf0) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Security fix ([#420](https://github.com/fellwork/aihu/issues/420)): rate-limit keys and scope checks derive from a signature-VERIFIED JWT principal.

  Rate-limit keys were `${userId}:${tag}` with `userId` caller-supplied over MCP and never cross-checked against the JWT `sub`, so a caller reset its own quota by rotating `userId`; the scope check likewise consulted unverified claims, so a forged `scope` claim bypassed `$scope`.

  - `@aihu/agent-service` (minor — optional interface member): `AuthPlugin.verify?(jwt) → Promise<VerifiedClaims | null>` is the single verified-claims source for BOTH the rate-limit key (`sub:tag`) and the scope gate; the gate is now async end-to-end and FAILS CLOSED (401) when a scoped/rate-limited tool meets a plugin that cannot verify. New `authDiscoveryUrl` option: 401 envelopes carry the deployment's auth-discovery URL so refused agents know where to obtain a credential.
  - `@aihu/auth` (minor): `@aihu/auth/server` exports `verifyJwt` and `createVerifiedAuthPlugin({ jwtSecret })` — the `crypto.subtle` HMAC path backing `verify`. The decode-only `createAuthPlugin` remains but cannot serve scoped/rate-limited tools.
  - `@aihu/agent-server` (minor): the MCP boundary forwards only the `jwt` credential from caller-supplied `context`; caller identity (`userId`) is dropped, never forwarded as authoritative. `authDiscoveryUrl` is threaded through and surfaced in MCP 401 error text.

  Behavior change: callers that relied on caller-supplied identity to satisfy scoped/rate-limited tools (i.e. spoofing callers, or deployments without a verifying auth plugin) are now refused with 401 — this is the security fix. Un-scoped, un-rate-limited tools are unaffected.

### Patch Changes

- [#435](https://github.com/fellwork/aihu/pull/435) [`889830d`](https://github.com/fellwork/aihu/commit/889830d907e83b7d74dc8e64503d8bb4b4711812) Thanks [@srmcguirt](https://github.com/srmcguirt)! - The server-side action allowlist is now actually enforced.

  `runGate` checked `typeof binding.callAction === 'function'` before dispatching
  — always true for a `LiveBinding`. The real membership check (`action in
meta.actions`) existed only on the branch that returns 404 unconditionally two
  lines later, so no reachable path enforced it. Enforcement was displaced to the
  browser's opaque-ID map, which made the **client** the allowlist authority —
  inverting this package's stated design that "the server-side gate is
  load-bearing."

  The gate now checks the requested action against the compiler-emitted metadata
  registered for that tag: it must be advertised in `actions`, or be a readable
  member of `state` (`handleToolCall` falls through to `getSignal` for those).
  `LiveBinding` intentionally exposes no action list — it is a set of invokers,
  not a manifest — so the metadata is the authority. This composes with the
  compiler now emitting `registerAgentMetadata`, which is what makes that
  metadata present for any component compiled from source.

  When no metadata is registered for a tag, there is nothing to enforce against
  and the call proceeds to the invoker, which rejects unknown names itself.
  Closing that remaining gap requires giving `LiveBinding` an advertised surface
  and is tracked separately; it is not reachable by a component compiled from
  source.

  The existing AC11 test did not catch this: its fixture's `callAction` throws
  `no action: …`, so it asserted the invoker's rejection rather than the gate's —
  the same inversion, mirrored in the test. The new AC11b tests use a binding
  whose `callAction` succeeds for any name, so only a real server-side check can
  produce a 404. Verified failing against the old code, where an unadvertised
  `wipeDatabase` executed.

- Updated dependencies [[`30ed2b5`](https://github.com/fellwork/aihu/commit/30ed2b51c215512f840b113afaa1636378e31407)]:
  - @aihu/agent@0.2.0

## 0.2.0

### Minor Changes

- [#320](https://github.com/fellwork/aihu/pull/320) [`a54ca1b`](https://github.com/fellwork/aihu/commit/a54ca1b8874583a0301e84c91f2d25713908e41f) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Add @aihu/agent-server: a server-mediated capability bridge for live agent dispatch. The compiler emits a narrow opaque-ID client dispatcher (not the raw `__agentBinding`); the browser mounts the real visible component and registers it; the server holds all policy (auth/scope/rate-limit via @aihu/agent-service) and forwards only approved invocations to the browser over a WebSocket bridge. The opaque-ID dispatcher exposes no policy, so the server-side gate is the sole enforcement point.

  - New package `@aihu/agent-server` — `createAgentServer`, `createComponentMcpServer`/`serveComponentMcp` (lazy MCP SDK), `createBridgeClient` (browser), opaque-ID helpers, and the bridge protocol types + `BRIDGE_PROTOCOL_VERSION`.
  - `@aihu/agent-service` — drive a server-mounted component over the bridge.
  - `@aihu/compiler` — emit the client-safe opaque-ID agent dispatcher.

  Follow-up hardening (WS auth/origin checks, server→client invocation signing) is deferred per the go-public eng review.

## 0.1.3

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
