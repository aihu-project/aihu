/**
 * `@aihu/agent-service` — type definitions (Plan 5.2 / v0.3.0 live-binding).
 *
 * `AgentManifest` is the MCP multi-tool manifest shape.
 * `AgentToolEntry` is the per-tool descriptor.
 * `AgentServiceOptions` configures `createAgentService`.
 * `LiveBinding` is the runtime instance record wired by `mount()`.
 * Re-uses `InputSchema` and `ActionSchema` from `@aihu/agent`.
 */
export type { ActionSchema, InputSchema } from '@aihu/agent'

import type { AgentMetadata } from '@aihu/agent'
import type { Actor, ActorResolver } from './actor.ts'
import type { EntitlementMemo, EntitlementsHandle } from './entitlements.ts'

// ─── v0.3.0 — LiveBinding (RFC §2.2) ─────────────────────────────────────────

/**
 * A live binding for one mounted component instance. Constructed by
 * `registerLiveBinding()` in `@aihu/arbor/mount.ts` when a component with a
 * `__agentBinding` server export is mounted.
 *
 * `dispose$` is called by the `onCleanup`-driven teardown when the component
 * unmounts; returning `true` signals that the registry entry was removed.
 *
 * Security: this interface is module-private to `@aihu/arbor`. Only the
 * `mount()` call path can construct and register a `LiveBinding`.
 */
export interface LiveBinding {
  /** Stable root ID from the mount scope (spec §2.7 path prefix). */
  readonly rootId: number
  /** Custom-element tag name identifying the component type. */
  readonly tag: string
  /** Read the current value of a named signal (prop or computed). */
  getSignal(name: string): unknown
  /** Write a value to a named writable signal (prop only). */
  setSignal(name: string, value: unknown): void
  /** Invoke a named action with arguments, returning the result. */
  callAction(name: string, args: unknown[]): Promise<unknown>
  /** The `$scope` claim string, or null when absent. */
  scope(): string | null
  /** The `$rate-limit` spec string (e.g. `'100/min'`), or null when absent. */
  rateLimit(): string | null
  /** Disposal function: removes this binding from the registry. Returns true on success. */
  dispose$: () => boolean
}

// ─── v0.3.0 — request context ────────────────────────────────────────────────

/**
 * Request context passed to `handleToolCall` for authorization and rate-limit
 * checks.
 *
 * SECURITY (#420): `jwt` is the credential; `userId` is a caller-supplied
 * HINT that is NEVER used for authorization or rate-limit keying. The gate
 * derives the principal exclusively from `AuthPlugin.verify(jwt)` — the
 * signature-verified `sub` claim. A caller can put anything in `userId`; it
 * cannot move them into another caller's rate-limit bucket or satisfy a
 * scope check.
 */
export interface RequestContext {
  /**
   * Caller-supplied identity hint. Retained for interface compatibility and
   * telemetry only — the gate ignores it for every policy decision. The
   * authoritative identity is the `sub` claim of the signature-verified `jwt`.
   */
  readonly userId: string | null | undefined
  /**
   * The raw JWT string. This is the sole credential: scoped and rate-limited
   * tools require it, and all claims (identity + scopes) are read from it
   * only after `AuthPlugin.verify` has checked its signature.
   */
  readonly jwt?: string | null
  /**
   * GX Phase 4 (#466, spec §4.4/§4.6): an OPTIONAL shared per-request
   * entitlement memo. A host serving one page request that both renders a
   * governed route and executes governed tool calls passes the same memo to
   * both transports so a scope is live-resolved at most once per request.
   * When absent, `runGate` creates a fresh memo per call. Never a policy
   * input — only a deduplication scope.
   */
  readonly entitlementMemo?: EntitlementMemo
}

// ─── v0.3.0 — auth/scope plugin ──────────────────────────────────────────────

/**
 * Claims decoded from a JWT whose signature HAS been verified.
 * Shape mirrors the standard scope-claim conventions (`scope`/`scp`/`scopes`).
 */
export interface VerifiedClaims {
  /** Subject — the verified principal identity. */
  readonly sub?: string
  /** Space-separated scope string (RFC 6749 §3.3). */
  readonly scope?: string
  /** Array-form scopes (Auth0 convention). */
  readonly scp?: readonly string[]
  /** Array-form scopes (Okta convention). */
  readonly scopes?: readonly string[]
  readonly [key: string]: unknown
}

/**
 * Optional auth plugin injected into `createAgentService`. When absent and
 * a component has a non-null `$scope` or `$rate-limit`, `handleToolCall`
 * returns HTTP 401 `AUTH_MISSING` (fail-closed per Amendment 2 / §6.1).
 */
export interface AuthPlugin {
  /**
   * Verify that the JWT carries the required scope claim.
   * Returns true if the claim is present, false otherwise.
   *
   * SECURITY (#420): the gate calls this only AFTER `verify` has confirmed
   * the token's signature, so implementations may decode without their own
   * signature check — the claims they read are already authenticated. This
   * method alone is NOT sufficient for a scoped tool: a plugin without
   * `verify` is treated as unable to verify and the gate fails closed (401).
   */
  checkScope(jwt: string, scope: string): boolean
  /**
   * Signature-verify `jwt` and return its claims, or `null` when the token
   * is malformed, forged, or otherwise unverifiable. Never throws.
   *
   * This is THE single verified-claims source for the gate (#420): the
   * rate-limit key derives from the returned `sub`, and the scope check runs
   * only against a token this method has authenticated. Async because
   * verification uses `crypto.subtle` (e.g. `@aihu/auth/server`'s HMAC path).
   *
   * OPTIONAL so existing third-party `AuthPlugin` implementations still
   * typecheck — but a plugin without it cannot serve scoped or rate-limited
   * tools: the gate FAILS CLOSED (401 `AUTH_UNVERIFIABLE`) rather than fall
   * back to caller-supplied identity.
   */
  verify?(jwt: string): Promise<VerifiedClaims | null>
}

// ─── v0.3.0 — rate-limit plugin ──────────────────────────────────────────────

/**
 * Rate-limit store injected into `createAgentService`. Implementations MUST
 * operate in O(1) constant time per Amendment 4 / §6.8.
 */
export interface RateLimitPlugin {
  /**
   * Check and consume one unit of quota for `key`.
   * `rateSpec` is a string like `'100/min'`.
   * Returns false when quota is exhausted (caller should return 429).
   */
  checkRateLimit(rateSpec: string, key: string): boolean
}

/**
 * Per-tool entry in an `AgentManifest`.
 * Maps directly to a single registered `AgentMetadata`.
 */
export interface AgentToolEntry {
  /** The custom-element tag name (tool identifier prefix). */
  name: string
  /** Custom-element tag, identical to `name`. */
  tag: string
  /** Input fields declared on the component. */
  inputs: Record<string, import('@aihu/agent').InputSchema>
  /** Callable actions declared on the component. */
  actions: Record<string, import('@aihu/agent').ActionSchema>
}

/**
 * MCP multi-tool manifest aggregating all registered agents.
 */
export interface AgentManifest {
  tools: AgentToolEntry[]
}

/**
 * Options for `createAgentService`.
 */
export interface AgentServiceOptions {
  /**
   * Explicit list of agent metadata entries.
   * When omitted, reads the global registry via `getAgentMetadata`.
   */
  manifests?: AgentMetadata[]
  /**
   * Optional auth plugin. When absent and a component uses `$scope`,
   * `handleToolCall` returns 401 AUTH_MISSING (fail-closed, Amendment 2).
   */
  authPlugin?: AuthPlugin
  /**
   * Optional rate-limit plugin. Fail-closed, matching `authPlugin`: when a
   * component declares `$rate-limit` and this is ABSENT, the gate returns 429
   * `RATE_LIMIT_MISSING` rather than dispatching. A component that declares no
   * `$rate-limit` is unaffected and dispatches normally.
   *
   * "Optional" therefore means "un-rate-limited components need no plugin" — it
   * is NOT optional for a component that asks to be rate-limited.
   */
  rateLimitPlugin?: RateLimitPlugin
  /**
   * Getter for the `componentInstanceRegistry` from `@aihu/arbor/mount`.
   * Injected at construction time to avoid a circular import.
   * When absent, all `handleToolCall` calls return 404 (no live instance).
   *
   * The registry is consumed READ-ONLY here (only `.get(tag)` is called),
   * so the getter is typed as `ReadonlyMap` — a zero-cost type-level lock that
   * prevents external mutation of the live registry without snapshotting it.
   */
  getRegistry?: () => ReadonlyMap<string, LiveBinding[]>
  /**
   * Optional per-request auth resolver. When provided, `asMiddleware()` calls
   * it to build the `RequestContext` (userId + raw jwt) passed to
   * `handleToolCall`, enabling scoped tools over the bundled HTTP path. When
   * absent, `asMiddleware()` passes no context (fail-closed: scoped tools 401).
   * Injected to keep agent-service auth-library-agnostic and avoid a circular
   * `@aihu/auth` dep. The host wires `getAuthState` (`@aihu/auth/server`).
   */
  resolveAuth?: (req: Request) => RequestContext | Promise<RequestContext>
  /**
   * Optional auth-discovery URL (e.g. the deployment's
   * `/.well-known/oauth-protected-resource`) included as `authDiscoveryUrl`
   * in every 401 envelope the gate returns, so an agent that is refused
   * knows WHERE to obtain a credential. Purely informational — never a
   * policy input. When unset, 401 envelopes carry no discovery field.
   */
  authDiscoveryUrl?: string
  /**
   * GX Phase 4 (#466, spec §4.6): the live-entitlement registry handle —
   * pass the SAME `createGovernedRegistry()` instance (`@aihu/server`) the
   * server router was constructed with, so one scope has one live meaning on
   * both axes. When present, `runGate` gains one stage between the scope meet
   * and the rate limit: every scope in the met set is consulted through the
   * shared `check` (deny → 403 `ENTITLEMENT_DENIED`; resolver failure → 503
   * `ENTITLEMENT_UNAVAILABLE` + Retry-After — the §4.3 ladder in the tool
   * envelope). ABSENT ⇒ byte-identical behavior to today (the same injected
   * posture as `resolveAuth`: no ambient state, trivially testable).
   */
  entitlements?: EntitlementsHandle
  /**
   * Tenant-aware actor resolution (#870): the same injected posture as
   * `entitlements`/`resolveAuth`. When present, `runGate` resolves the
   * calling {@link Actor} for every non-anonymous principal that reaches
   * dispatch, and `authorize()` surfaces it to callers (e.g. the
   * capability-bridge in `@aihu/agent-server`) alongside the `authorized`
   * verdict. ABSENT (or a resolver returning `null` for a given principal)
   * ⇒ no `actor` is produced — byte-identical to today's behavior for every
   * existing caller, since nothing before #870 reads this field.
   */
  actorResolver?: ActorResolver
}

/**
 * The service handle returned by `createAgentService`.
 */
export interface AgentService {
  /** Returns the aggregated manifest for all registered agents. */
  getManifest(): AgentManifest
  /**
   * Routes a tool call to the correct agent binding.
   * `toolName` format: `"<tag>/<actionName>"`.
   *
   * v0.3.0: full live-dispatch per RFC §5. Error ordering invariant:
   * 404 → 401 → 403 → 429 (Amendment 4 timing-channel invariant).
   *
   * The gate is ASYNC end-to-end (#420): scoped/rate-limited tools require a
   * signature-verified JWT (via `AuthPlugin.verify`, `crypto.subtle`-based),
   * and verification completes before any scope or rate-limit consult.
   *
   * @param toolName - `"<tag>/<actionName>"` or `"<tag>/<signalName>"`.
   * @param params - Action arguments or signal write value.
   * @param requestContext - Auth context. `jwt` is the credential and is
   *   required for scoped/rate-limited components; `userId` is a hint the
   *   gate never trusts (see {@link RequestContext}).
   */
  handleToolCall(
    toolName: string,
    params: unknown,
    requestContext?: RequestContext,
  ): Promise<unknown>
  /**
   * Run the security gate WITHOUT dispatching. Returns `{ authorized: true }`
   * when the call would be allowed, or the same `{ error, code, jsonrpc }`
   * rejection envelope `handleToolCall` would return (404/401/403/429). Shares
   * the single gate implementation with `handleToolCall`, so the error-ordering
   * invariant is identical. Used by `@aihu/agent-server`'s capability-bridge
   * path to gate on the server while delegating execution to the visible
   * browser instance.
   */
  authorize(toolName: string, params: unknown, requestContext?: RequestContext): Promise<unknown>
  /**
   * Returns a fetch-compatible middleware function.
   * Handles `POST /__aihu/tools/call` with `{ tool, params }` JSON body.
   * Returns `null` for non-matching requests (pass-through).
   */
  asMiddleware(): (req: Request) => Promise<Response | null>
}
