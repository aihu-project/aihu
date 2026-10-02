# @aihu/agent-server

## 0.5.0

### Minor Changes

- [#916](https://github.com/aihu-project/aihu/pull/916) [`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Require host authorization before serving agent state reads, resolve tenant actors from live host lookups, recursively project JSON-safe results, and bind browser bridge sessions to one-use connection nonces with per-invocation reauthorization. Migration: bridge clients must speak protocol v2 and send `nonce`, `sessionToken`, `sessionIdentity`, and the verified `grantVersion` in `hello`; hosts must return `{ identity, grantVersion? }` from both `verifyBridgeSession` and `reauthorizeBridgeInvoke`, and supply `actorResolver` and `authorizeDataRead` for protected state reads. `securityHookTimeoutMs` and `bridgeCallTimeoutMs` configure bounded hook/call waits (5000ms defaults). Hosts revoke all grants for an identity with `server.revokeBridgeSession(identity)` and revoke only one exact grant with `server.revokeBridgeSession(identity, { grantVersion })`; literal grant versions such as `"*"` remain exact values. Revocation records live for 24 hours by default (configurable with `bridgeRevocationTtlMs`) and are capped at 10,000 entries by default (`bridgeRevocationMaxEntries`); when full, new bridge handshakes fail with `BRIDGE_REVOCATION_STORE_FULL` until retained entries expire, and existing verified unrevoked sessions continue to work. Revocation synchronously cancels matching pending calls; the bounded store guards new hellos and invokes, while the host's session store remains authoritative for long-lived revocation. A revoked state read returns a denial without its result. Once an action invoke has been sent, disconnect, timeout, bridge error, protocol error, or revocation returns `BRIDGE_RESULT_WITHHELD`; callers must treat the action outcome as unknown and must not assume it did not run. Projected leaves must be JSON-safe primitives, arrays, and plain records; functions, symbols, bigints, non-finite numbers, non-plain objects such as `Date`, objects with callable `toJSON` hooks, accessors on selected paths, cycles, and results beyond the default depth 32 or 10,000 total nodes fail closed as `CAPABILITY_UNAVAILABLE`. Set `projectionLimits: { maxDepth, maxNodes }` on the service/server to tune those limits. Bridge diagnostics run asynchronously after state changes and receive frozen, bounded, credential-free peer details.

- [#916](https://github.com/aihu-project/aihu/pull/916) [`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Add configurable per-attachment (`maxPendingBridgeCalls`, default 64) and per-server (`maxPendingBridgeCallsTotal`, default 1024) bridge concurrency limits. Calls above either limit return 503 `BRIDGE_OVERLOADED` before a bridge timer or invoke frame is created. Hosts that need higher concurrency can raise both limits; invalid limits are rejected at server creation.

  Reject oversized whole-record projections before any descriptor lookup, and document that hosts must normalize untrusted Proxy or exotic values into plain data before registering them.

- [#916](https://github.com/aihu-project/aihu/pull/916) [`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Add admission limits for the entire bridge call path: `maxInFlightBridgeCalls` defaults to 1,024 server-wide, and `maxInFlightBridgeCallsPerTenant` defaults to 64 per verified actor organization. Excess calls return 503 `BRIDGE_OVERLOADED`; the server-wide limit rejects before any authorization hook, handshake waiter, or timer is created. Calls without a verified actor share one tenant bucket. Pending-call caps remain in force, with one slot reserved for another tenant when capacity permits.

  Migration: hosts expecting more concurrency should raise these new limits, along with `maxPendingBridgeCalls` and `maxPendingBridgeCallsTotal` where needed. Configure a pending cap above one to allow simultaneous cross-tenant forwarding. An upstream rate limit is still recommended.

### Patch Changes

- [#916](https://github.com/aihu-project/aihu/pull/916) [`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Bound capability projection work and bridge revocation storage, avoid diagnostic reentrancy, and report unknown outcomes whenever a forwarded action can no longer be confirmed.

- [#916](https://github.com/aihu-project/aihu/pull/916) [`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fail closed on untrusted proxy prototype chains, preserve revocation bindings when the bounded store is full, and close duplicate-hello peers with bounded diagnostics. Migration note: deployments that reach `bridgeRevocationMaxEntries` now refuse new bridge handshakes with `BRIDGE_REVOCATION_STORE_FULL` until revocations expire; size the cap and TTL for expected revocation volume. Existing verified, unrevoked bridge sessions remain available.

- [#916](https://github.com/aihu-project/aihu/pull/916) [`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Bound projection work for Proxy records by reading only requested own properties and rejecting oversized whole-record key sets before describing their entries.

  Keep malformed bridge hello objects out of host diagnostics, and pin the per-attachment diagnostic callback cap with a regression.

- Updated dependencies [[`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f), [`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f), [`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f), [`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f), [`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f)]:
  - @aihu/agent-service@0.5.0

## 0.4.4

### Patch Changes

- Updated dependencies [[`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88)]:
  - @aihu/arbor@4.1.1
  - @aihu/agent-service@0.4.0

## 0.4.3

### Patch Changes

- Updated dependencies [[`ac9c045`](https://github.com/fellwork/aihu/commit/ac9c04599b2fbf57c9f39a39e1c9db7fe1388028), [`ac9c045`](https://github.com/fellwork/aihu/commit/ac9c04599b2fbf57c9f39a39e1c9db7fe1388028), [`ac9c045`](https://github.com/fellwork/aihu/commit/ac9c04599b2fbf57c9f39a39e1c9db7fe1388028)]:
  - @aihu/arbor@4.1.0

## 0.4.2

### Patch Changes

- Updated dependencies [[`2f24fa3`](https://github.com/fellwork/aihu/commit/2f24fa3fdc592c85e39f500a48a7e4d3ff67c86d), [`a993aa1`](https://github.com/fellwork/aihu/commit/a993aa19d402c221faa463dfb5d94c86cc87b670), [`edc15f2`](https://github.com/fellwork/aihu/commit/edc15f2a2de541fa8f7ffd6266ad984446206257)]:
  - @aihu/arbor@4.0.0

## 0.4.1

### Patch Changes

- Updated dependencies [[`18e5f6d`](https://github.com/fellwork/aihu/commit/18e5f6dda93772877690e88e8c217dcdcf4bddc2)]:
  - @aihu/arbor@3.0.0

## 0.4.0

### Minor Changes

- [#435](https://github.com/fellwork/aihu/pull/435) [`30ed2b5`](https://github.com/fellwork/aihu/commit/30ed2b51c215512f840b113afaa1636378e31407) Thanks [@srmcguirt](https://github.com/srmcguirt)! - `describe:` now reaches agents. The compiler emits `registerAgentMetadata`.

  `$action` / `$prop` / `$computed` entries have accepted a `describe:` key since the
  v2 macro vocabulary landed — it was parsed, validated, and parser-tested, then
  dropped. It reached no emitted artifact, so MCP tools shipped with a synthesized
  description ("Invoke the `bump` action on a live `<tag>` instance.") regardless of
  what the author wrote.

  Two independent breaks, both fixed:

  - The compiler **never emitted `registerAgentMetadata` anywhere**, so the
    `@aihu/agent` registry that `@aihu/agent-server`'s `buildToolDefinitions` reads
    was empty in every real app. `registry.ts`'s doc comment described a wire that
    was never built. Server and universal builds now emit
    `registerAgentMetadata({ tag, state, actions })` at module scope. The payload is
    pure data — it closes over no setup locals, unlike `__agentBinding` — so it is
    safe there and readable on import without a live instance. Client builds elide
    it along with the rest of the agent surface.

  - `emit_manifest` read only the retired **v1** `@agent { input / action }`
    keywords, so a v2 component's `agent-manifest.json` came out with empty
    `inputs` and `actions`. It now derives from the same `collect_agent_members`
    walk that feeds `__agentBinding` and the registry, so the sidecar cannot drift
    from the live surface again. It also gained a `state` key mirroring the
    registry payload.

  `ActionSchema` gains an optional `describe`. `buildToolDefinitions` prefers the
  authored text over its synthesized string, for both action tools and state-read
  tools — the state map's values were previously ignored entirely.

  Descriptions are collected only for members that clear the `expose` gate, so an
  unexposed member's prose (which may describe internals) never reaches a public
  artifact.

  Not covered: MCP `inputSchema` is still `args: { type: 'array' }`. Real parameter
  schemas need handler-signature extraction and are tracked separately.

- [#450](https://github.com/fellwork/aihu/pull/450) [`e01f19d`](https://github.com/fellwork/aihu/commit/e01f19d70eabe867b8b8c310a6928b9576461cf0) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Security fix ([#420](https://github.com/fellwork/aihu/issues/420)): rate-limit keys and scope checks derive from a signature-VERIFIED JWT principal.

  Rate-limit keys were `${userId}:${tag}` with `userId` caller-supplied over MCP and never cross-checked against the JWT `sub`, so a caller reset its own quota by rotating `userId`; the scope check likewise consulted unverified claims, so a forged `scope` claim bypassed `$scope`.

  - `@aihu/agent-service` (minor — optional interface member): `AuthPlugin.verify?(jwt) → Promise<VerifiedClaims | null>` is the single verified-claims source for BOTH the rate-limit key (`sub:tag`) and the scope gate; the gate is now async end-to-end and FAILS CLOSED (401) when a scoped/rate-limited tool meets a plugin that cannot verify. New `authDiscoveryUrl` option: 401 envelopes carry the deployment's auth-discovery URL so refused agents know where to obtain a credential.
  - `@aihu/auth` (minor): `@aihu/auth/server` exports `verifyJwt` and `createVerifiedAuthPlugin({ jwtSecret })` — the `crypto.subtle` HMAC path backing `verify`. The decode-only `createAuthPlugin` remains but cannot serve scoped/rate-limited tools.
  - `@aihu/agent-server` (minor): the MCP boundary forwards only the `jwt` credential from caller-supplied `context`; caller identity (`userId`) is dropped, never forwarded as authoritative. `authDiscoveryUrl` is threaded through and surfaced in MCP 401 error text.

  Behavior change: callers that relied on caller-supplied identity to satisfy scoped/rate-limited tools (i.e. spoofing callers, or deployments without a verifying auth plugin) are now refused with 401 — this is the security fix. Un-scoped, un-rate-limited tools are unaffected.

### Patch Changes

- Updated dependencies [[`30ed2b5`](https://github.com/fellwork/aihu/commit/30ed2b51c215512f840b113afaa1636378e31407), [`889830d`](https://github.com/fellwork/aihu/commit/889830d907e83b7d74dc8e64503d8bb4b4711812), [`549448c`](https://github.com/fellwork/aihu/commit/549448cd042ba89b94ddb291be741f015c3d0d9c), [`e01f19d`](https://github.com/fellwork/aihu/commit/e01f19d70eabe867b8b8c310a6928b9576461cf0)]:
  - @aihu/agent@0.2.0
  - @aihu/agent-service@0.3.0

## 0.3.1

### Patch Changes

- Updated dependencies [[`514336d`](https://github.com/fellwork/aihu/commit/514336da5892c29e9e02d7a6391bb06c62d688c3)]:
  - @aihu/arbor@2.0.0

## 0.3.0

### Minor Changes

- [#374](https://github.com/fellwork/aihu/pull/374) [`6a0d8e4`](https://github.com/fellwork/aihu/commit/6a0d8e426fa2ab53c37fa5d1d4e6ae63ca671e0d) Thanks [@srmcguirt](https://github.com/srmcguirt)! - add `create-aihu --template agent` + publish `@aihu/agent-server`

  - **New opt-in `agent` template** (`create-aihu --template agent`, or option 4 in the
    wizard): the headline aihu thesis made runnable. A durable on-screen `<task-list>`
    Web Component that BOTH a human and an external AI agent drive — the agent reaches the
    same visible instance over `@aihu/agent-server`'s capability bridge (server = policy
    gate, browser = sole executor). Two-process app (Bun bridge server + Vite, client-target
    compiler). Verified end-to-end: typing in the input AND an external
    `curl /agent/call` both append to the same live instance; unexposed actions are rejected.
  - **`@aihu/agent-server` first publish** (added to the release allowlist). Includes the
    fix that lets `createAgentServer`'s `node` mount path stand up its own server-side DOM
    internally (no consumer jsdom/`createHost` glue) when the runtime has no `document`.

  The bridge in the template is unauthenticated (local dev/demo); the generated server
  warns against exposing it to untrusted networks.

## 0.2.0

### Minor Changes

- [#320](https://github.com/fellwork/aihu/pull/320) [`a54ca1b`](https://github.com/fellwork/aihu/commit/a54ca1b8874583a0301e84c91f2d25713908e41f) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Add @aihu/agent-server: a server-mediated capability bridge for live agent dispatch. The compiler emits a narrow opaque-ID client dispatcher (not the raw `__agentBinding`); the browser mounts the real visible component and registers it; the server holds all policy (auth/scope/rate-limit via @aihu/agent-service) and forwards only approved invocations to the browser over a WebSocket bridge. The opaque-ID dispatcher exposes no policy, so the server-side gate is the sole enforcement point.

  - New package `@aihu/agent-server` — `createAgentServer`, `createComponentMcpServer`/`serveComponentMcp` (lazy MCP SDK), `createBridgeClient` (browser), opaque-ID helpers, and the bridge protocol types + `BRIDGE_PROTOCOL_VERSION`.
  - `@aihu/agent-service` — drive a server-mounted component over the bridge.
  - `@aihu/compiler` — emit the client-safe opaque-ID agent dispatcher.

  Follow-up hardening (WS auth/origin checks, server→client invocation signing) is deferred per the go-public eng review.

### Patch Changes

- Updated dependencies [[`a54ca1b`](https://github.com/fellwork/aihu/commit/a54ca1b8874583a0301e84c91f2d25713908e41f)]:
  - @aihu/agent-service@0.2.0
  - @aihu/arbor@1.0.0
