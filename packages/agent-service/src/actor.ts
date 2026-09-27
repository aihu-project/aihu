/**
 * `@aihu/agent-service` — tenant-aware actor context (#870).
 *
 * Spec-shaped by the same injected-dependency posture as
 * {@link EntitlementsHandle} / `resolveAuth` — see `entitlements.ts`'s header
 * comment for the pattern this mirrors.
 *
 * WHY THIS EXISTS: `Principal` (`principal-gate.ts`) answers "who verified
 * this credential" — `sub`, `scopes`, the raw verified `claims`. It says
 * nothing about which ORGANIZATION that principal currently belongs to, or
 * whether the grant behind its scopes is still current. A token's own claims
 * are signature-verified but can still be STALE: org membership and grants
 * can change or be revoked after a long-lived token was issued, so trusting a
 * `claims.org`-shaped field as-is would let a revoked or transferred
 * principal keep acting under yesterday's tenant. `Actor` is that missing,
 * tenant-scoped identity — and it MUST come from an authoritative, live
 * lookup the host controls, never from a bare claim.
 *
 * SECURITY POSTURE:
 *   - `resolveActor` receives only the already-verified, non-anonymous
 *     `Principal` — there is no channel here for a caller-supplied
 *     `organizationId` to flow in. `RequestContext` never carries one either
 *     (see `types.ts`); the ONLY inputs are the signature-verified `sub` /
 *     `scopes` / `claims` this gate already produced.
 *   - The resolver is expected to treat any organization-shaped claim in
 *     `principal.claims` as a HINT at most and confirm it against its own
 *     current, authoritative store (a tenant/membership table, a grants
 *     service, etc.) — this module cannot enforce that inside a host's
 *     resolver body, but every field on {@link Actor} is documented as
 *     authoritative-lookup output, not claim passthrough, precisely so a
 *     resolver that just echoes `claims.org` is visibly cutting a corner
 *     its own doc comment warns against.
 *   - FAIL CLOSED: when no `ActorResolver` is configured, or the configured
 *     resolver returns `null` for a given principal, the resolved actor is
 *     `undefined`. Absence of an `Actor` MUST be treated by any consumer that
 *     requires tenant identity as "deny" — never as "no tenant restriction",
 *     and never by falling back to a default organization.
 */

import type { EntitledPrincipal } from './entitlements.ts'

/**
 * Who is acting, at the coarsest grain a host's authorization logic needs to
 * branch on:
 *   - `'human'` — a person, generally via a verified session
 *     (`HumanSessionPrincipal`) or a Bearer credential minted for one.
 *   - `'delegated-agent'` — software acting on a specific human's or org's
 *     behalf, holding a grant scoped to that delegation.
 *   - `'machine'` — a service-to-service principal with no human behind a
 *     given call (a cron job, a background worker, another backend).
 *
 * The framework never infers this from `Principal.class` — the presentation
 * channel (Bearer vs. session) does not determine WHO is behind it, only
 * how the request arrived. Only the host's {@link ActorResolver}, backed by
 * its own authoritative record of what each credential/grant represents,
 * can answer this.
 */
export type ActorKind = 'human' | 'delegated-agent' | 'machine'

/**
 * The authoritative, tenant-scoped identity behind a signature-verified
 * principal, as resolved by the host's {@link ActorResolver}.
 *
 * Every field here is expected to be resolver output backed by a current
 * lookup, not a verbatim copy of a token claim — a token's signature proves
 * it was issued by the expected party, not that its claims are still true
 * today.
 */
export interface Actor {
  /** Coarse actor category — see {@link ActorKind}. */
  readonly kind: ActorKind
  /** The authoritative subject or key ID for this actor (may differ from the raw JWT `sub`, e.g. after a key rotation the resolver reconciles). */
  readonly subject: string
  /** The organization this actor currently belongs to, per the resolver's live lookup — never trusted from a bare claim. */
  readonly organizationId: string
  /** The scopes the resolver confirms are currently live for this actor (may narrow, but never widen, the verified principal's own `scopes`). */
  readonly scopes: readonly string[]
  /** Token issuer, when the resolver considers it meaningful for this actor; `null` when not applicable. */
  readonly issuer: string | null
  /** Token audience, when the resolver considers it meaningful for this actor; `null` when not applicable. */
  readonly audience: string | null
  /** Stable identifier for the grant behind this actor's access, when the deployment models grants; `null` when not applicable. */
  readonly grantId: string | null
  /** Version/generation of that grant, so a revoked-and-reissued grant is distinguishable from the one a caller last saw; `null` when not applicable. */
  readonly grantVersion: string | null
}

/**
 * Injected, host-owned actor resolution (the same posture as
 * `EntitlementsHandle.check` / `AgentServiceOptions.resolveAuth`).
 *
 * Implemented by the host, backed by whatever authoritative store it uses
 * for tenant membership and grants (a database, an identity provider, an
 * internal admin service — this package has no opinion). Injected rather
 * than built in because organization/grant modeling is host-specific in a
 * way scope strings and rate limits are not.
 */
export interface ActorResolver {
  /**
   * Resolve the current, authoritative actor for a principal that has
   * ALREADY passed signature verification and the static scope/rate-limit
   * meet (`EntitledPrincipal` — never anonymous). Return `null` when the
   * host has no current actor record for this principal (e.g. an org
   * membership was revoked after the token was issued) — the caller MUST
   * treat that as a denial, not as "unrestricted".
   *
   * Never called with, and must never itself trust, anything from the raw
   * inbound request other than what `principal` already carries.
   */
  resolveActor(principal: EntitledPrincipal): Actor | null | Promise<Actor | null>
}
