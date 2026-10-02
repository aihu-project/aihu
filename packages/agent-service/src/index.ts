/**
 * `@aihu/agent-service` public surface (v0.3.0 live-dispatch).
 *
 * Value exports: `createAgentService`, and the GX Phase 2 principal gate:
 *               `resolvePrincipal`, `decideEmission`, `surfaceCallPolicy`,
 *               `isScopeValue`
 * Type exports: `AgentManifest`, `AgentToolEntry`, `AgentService`,
 *               `AgentServiceOptions`, `InputSchema`, `ActionSchema`,
 *               `LiveBinding`, `RequestContext`, `AuthPlugin`,
 *               `RateLimitPlugin`, `VerifiedClaims`, and the principal-gate
 *               types (`Principal`, `EmissionDecision`, …)
 */

// #870 — tenant-aware actor context. Host-injected resolution from a
// verified principal to an authoritative, org-scoped `Actor`; see
// `actor.ts`'s header for why this cannot be derived from claims alone.
export type { Actor, ActorKind, ActorResolver } from './actor.ts'
export { createAgentService } from './agent-service.ts'
export type {
  CapabilityAuthorizationRequest,
  CapabilityAuthorizationVerdict,
  CapabilityDenyReason,
  CapabilityGrant,
  CapabilityGrantResolver,
  CapabilityProjection,
  CapabilityProjectionLimits,
} from './capability-gate.ts'
export {
  authorizeCapability,
  projectCapabilityResult,
  withSecurityTimeout,
} from './capability-gate.ts'
// GX Phase 4 (#466) — the live-entitlement contract the call axis consults.
// The engine lives in `@aihu/server` (`createGovernedRegistry`); these types
// are the structural seam that keeps this package server-agnostic.
export type {
  EntitledPrincipal,
  EntitlementMemo,
  EntitlementsHandle,
  EntitlementVerdict,
} from './entitlements.ts'
export type {
  AnonymousPrincipal,
  AnonymousUaTier,
  CredentialFailure,
  EmissionDecision,
  EmissionDenyReason,
  EmissionDeps,
  EmissionQuery,
  EnforcementTier,
  ExtractCallValue,
  ExtractReadValue,
  ExtractScopeValue,
  HumanSessionPrincipal,
  Principal,
  PrincipalClass,
  PrincipalGateDeps,
  PrincipalSource,
  ScopedAgentPrincipal,
  VerifiedAgentPrincipal,
} from './principal-gate.ts'
export {
  decideEmission,
  isScopeValue,
  resolvePrincipal,
  surfaceCallPolicy,
} from './principal-gate.ts'
export type {
  ActionSchema,
  AgentManifest,
  AgentService,
  AgentServiceOptions,
  AgentToolEntry,
  AuthPlugin,
  InputSchema,
  LiveBinding,
  RateLimitPlugin,
  RequestContext,
  VerifiedClaims,
} from './types.ts'
