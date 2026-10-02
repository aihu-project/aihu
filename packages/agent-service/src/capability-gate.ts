/**
 * `@aihu/agent-service` — the capability authorization hook (aihu#871).
 *
 * Today's gate (`principal-gate.ts`'s `resolvePrincipal` + `decideEmission`,
 * routed through `runGate` in `agent-service.ts`) authorizes the `call`
 * axis — can this principal invoke this action/state AT ALL — but has no
 * per-request, per-resource hook for "is THIS row/record visible to THIS
 * actor". Hosts have been rolling that check themselves in application
 * code, which means client state and rendered HTML end up as the de facto
 * authorization authority: exactly what this hook exists to stop.
 *
 * `authorizeCapability` is that hook. Same injected-dependency posture as
 * `EntitlementsHandle` (`entitlements.ts`) and `AuthPlugin`: this package
 * defines only the structural contract and the fail-closed ladder; the host
 * supplies `resolve` (its own per-resource authorization logic) and wires it
 * in as `AgentServiceOptions.authorizeDataRead` so `runGate`'s data-read path
 * (`handleToolCall`'s `getSignal` dispatch) calls it before a value reaches
 * the response.
 */

import type { Actor } from './actor.ts'
import type { EntitledPrincipal } from './entitlements.ts'
import type { AnonymousPrincipal, Principal } from './principal-gate.ts'

/** One data-read authorization request: which capability, over which resource. */
export interface CapabilityAuthorizationRequest {
  /** Stable capability identifier, e.g. `"<tag>.<member>"`. */
  readonly capability: string
  /**
   * The resource being read — host-defined (a row, a record id, a tenant
   * scope, …). Opaque to this package; only `resolve` interprets it. Absent
   * when the capability itself (not a specific resource) is what's gated.
   */
  readonly resource?: unknown
  /** Current host-resolved actor; never copied from the inbound request. */
  readonly actor?: Actor
}

/** Field names the result is restricted to. Absent/undefined means "no restriction". */
export type CapabilityProjection = readonly string[]

/**
 * What the host's resolver decided — BEFORE the credential-failure ladder
 * below ever runs (that ladder only fires when `resolve` is unreachable or
 * absent, never as a substitute for its answer).
 */
export type CapabilityGrant =
  | { readonly granted: true; readonly projection?: CapabilityProjection }
  | { readonly granted: false }

/**
 * Host-injected per-resource check. Receives the ALREADY-VERIFIED principal
 * — never an anonymous one; `authorizeCapability` denies before this ever
 * runs, the same contract `EntitlementsHandle.check` holds for the live
 * entitlement stage. May throw or reject; `authorizeCapability` treats that
 * as `'unavailable'`, never as a grant.
 */
export type CapabilityGrantResolver = (
  principal: EntitledPrincipal,
  request: CapabilityAuthorizationRequest,
) => CapabilityGrant | Promise<CapabilityGrant>

/** Resolve a host hook within a finite bound; the original promise cannot win after timeout. */
export async function withSecurityTimeout<T>(value: T | Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve(value),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('security hook timed out')), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Machine-readable reasons, mirroring the `call`/`read` axis's own ladder. */
export type CapabilityDenyReason =
  | 'AUTH_MISSING'
  | 'AUTH_UNVERIFIABLE'
  | 'AUTH_REQUIRED'
  | 'AUTH_INVALID'
  | 'CAPABILITY_DENIED'
  | 'CAPABILITY_UNAVAILABLE'

/** The verdict for one principal × one capability (+ resource) request. */
export type CapabilityAuthorizationVerdict =
  | { readonly allow: true; readonly projection?: CapabilityProjection }
  | {
      readonly allow: false
      /** 503 is reserved for an unreachable/unconfigured resolver — never a real grant. */
      readonly code: 401 | 403 | 503
      readonly reason: CapabilityDenyReason
      readonly message: string
    }

/** 401 messages, reusing the exact #420 AUTH_* ladder wording. */
const AUTH_MESSAGES: Record<
  AnonymousPrincipal['credentialFailure'],
  { reason: CapabilityDenyReason; message: string }
> = {
  'no-auth-plugin': {
    reason: 'AUTH_MISSING',
    message: 'AUTH_MISSING: @aihu/auth middleware is not registered',
  },
  'unverifiable-plugin': {
    reason: 'AUTH_UNVERIFIABLE',
    message:
      'AUTH_UNVERIFIABLE: auth plugin cannot signature-verify JWTs; refusing unverified claims',
  },
  'no-credential': {
    reason: 'AUTH_REQUIRED',
    message: 'AUTH_REQUIRED: a signed JWT is required for this capability',
  },
  'invalid-credential': {
    reason: 'AUTH_INVALID',
    message: 'AUTH_INVALID: JWT signature verification failed',
  },
  'no-subject': {
    reason: 'AUTH_INVALID',
    message: 'AUTH_INVALID: verified JWT carries no usable `sub` claim',
  },
}

/**
 * Authorize one data read (aihu-project/aihu#871). Derives its verdict
 * EXCLUSIVELY from `principal` — the already-verified output of
 * `resolvePrincipal` — and NEVER from `request.resource`'s own contents or
 * any caller-supplied identity. Fails closed on every rung:
 *
 *   - `principal` is anonymous → denied (401, the same AUTH_* ladder as the
 *     call axis) before `resolve` ever runs.
 *   - no `resolve` configured → 503 `CAPABILITY_UNAVAILABLE`: an unwired
 *     hook is an outage, never an open door.
 *   - `resolve` throws, or rejects → 503 `CAPABILITY_UNAVAILABLE`.
 *   - `resolve` returns `{ granted: false }` → 403 `CAPABILITY_DENIED`.
 *   - `resolve` returns `{ granted: true, projection? }` → allowed; the
 *     projection (when present) is the caller's contract to apply via
 *     {@link projectCapabilityResult} before the value leaves the server.
 */
export async function authorizeCapability(
  principal: Principal,
  request: CapabilityAuthorizationRequest,
  deps: { readonly resolve?: CapabilityGrantResolver | undefined; readonly timeoutMs?: number },
): Promise<CapabilityAuthorizationVerdict> {
  if (principal.class === 'anonymous') {
    const { reason, message } = AUTH_MESSAGES[principal.credentialFailure]
    return { allow: false, code: 401, reason, message }
  }

  if (!deps.resolve) {
    return {
      allow: false,
      code: 503,
      reason: 'CAPABILITY_UNAVAILABLE',
      message: `CAPABILITY_UNAVAILABLE: no capability authorizer is configured for '${request.capability}'`,
    }
  }

  let grant: CapabilityGrant
  try {
    grant = await withSecurityTimeout(deps.resolve(principal, request), deps.timeoutMs ?? 5_000)
  } catch {
    return {
      allow: false,
      code: 503,
      reason: 'CAPABILITY_UNAVAILABLE',
      message: `CAPABILITY_UNAVAILABLE: authorization for '${request.capability}' could not be verified (resolver failure); refusing to serve`,
    }
  }

  if (typeof grant !== 'object' || grant === null || typeof grant.granted !== 'boolean') {
    return {
      allow: false,
      code: 503,
      reason: 'CAPABILITY_UNAVAILABLE',
      message: `CAPABILITY_UNAVAILABLE: authorization for '${request.capability}' returned an invalid verdict`,
    }
  }

  if (!grant.granted) {
    return {
      allow: false,
      code: 403,
      reason: 'CAPABILITY_DENIED',
      message: `CAPABILITY_DENIED: '${request.capability}' is not authorized for this principal`,
    }
  }

  if (
    grant.projection !== undefined &&
    (!Array.isArray(grant.projection) ||
      grant.projection.some(
        (path) =>
          typeof path !== 'string' ||
          path.length === 0 ||
          path.split('.').some((part) => part.length === 0),
      ))
  ) {
    return {
      allow: false,
      code: 503,
      reason: 'CAPABILITY_UNAVAILABLE',
      message: `CAPABILITY_UNAVAILABLE: authorization for '${request.capability}' returned an invalid projection`,
    }
  }

  return grant.projection !== undefined
    ? { allow: true, projection: grant.projection }
    : { allow: true }
}

/**
 * Apply a {@link CapabilityProjection} to a read result: strip every own
 * enumerable key not covered by the projection. Server-side, before the value
 * leaves — the enforcement the issue asks for ("fields outside the
 * constraint are stripped, not just hidden client-side"). Dotted paths select
 * nested fields and arrays are projected element-by-element. Unsupported
 * object shapes fail closed.
 */
export function projectCapabilityResult(
  value: unknown,
  projection: CapabilityProjection | undefined,
): unknown {
  if (projection === undefined) return value
  const paths = projection.map((path) => path.split('.').filter(Boolean))
  const project = (current: unknown, relevant: string[][]): unknown => {
    if (current === null || typeof current !== 'object') {
      if (typeof current === 'function') throw new TypeError('unsupported projection value')
      return current
    }
    if (Array.isArray(current)) return current.map((item) => project(item, relevant))
    const proto = Object.getPrototypeOf(current)
    if (proto !== Object.prototype && proto !== null)
      throw new TypeError('unsupported projection value')
    const out = Object.create(null) as Record<string, unknown>
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      const matching = relevant.filter((path) => path[0] === key)
      if (matching.length === 0) continue
      const tails = matching.map((path) => path.slice(1))
      if (tails.some((path) => path.length === 0)) out[key] = child
      else out[key] = project(child, tails)
    }
    return out
  }
  try {
    return project(value, paths)
  } catch {
    throw new TypeError('CAPABILITY_UNAVAILABLE: result shape cannot be projected')
  }
}
