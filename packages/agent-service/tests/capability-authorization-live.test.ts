/**
 * aihu#871 — `authorizeCapability` wired through `handleToolCall`'s
 * data-read path (`AgentServiceOptions.authorizeDataRead`).
 *
 * Proves the three acceptance-criteria scenarios end-to-end, through the
 * public `createAgentService`/`handleToolCall` surface only:
 *   (a) an ANONYMOUS principal is denied a capability that requires a
 *       verified actor,
 *   (b) a verified actor without the right scope/resource grant is denied,
 *   (c) a valid grant is allowed and the resource projection constraint is
 *       applied — fields outside it are stripped from the dispatched value
 *       itself, not merely hidden client-side.
 */

import type { AgentMetadata } from '@aihu/agent'
import { describe, expect, it } from 'vitest'
import type { CapabilityGrantResolver } from '../src/capability-gate.ts'
import { createAgentService } from '../src/index.ts'
import type { AuthPlugin, LiveBinding, VerifiedClaims } from '../src/types.ts'

function makeVerifyingAuthPlugin(tokens: Record<string, VerifiedClaims>): AuthPlugin {
  return {
    checkScope: () => true,
    verify: async (jwt: string) => tokens[jwt] ?? null,
  }
}

/** A read-only (state-only, no actions) component binding, served via getSignal. */
function makeReadOnlyBinding(tag: string, orderRecord: unknown): LiveBinding {
  return {
    rootId: 1,
    tag,
    getSignal(name: string): unknown {
      return name === 'order' ? orderRecord : undefined
    },
    setSignal(): void {},
    async callAction(name: string): Promise<unknown> {
      throw new Error(`no action: ${name}`)
    },
    scope: () => null,
    rateLimit: () => null,
    dispose$: () => true,
  }
}

const ORDER = { id: 'order-1', total: 42, customerSsn: '000-00-0000' }

function makeService(resolve: CapabilityGrantResolver, orderRecord: unknown = ORDER) {
  const tag = 'order-card'
  const meta: AgentMetadata = { tag, state: { order: 'the order record' } }
  const registry = new Map([[tag, [makeReadOnlyBinding(tag, orderRecord)]]])
  const authPlugin = makeVerifyingAuthPlugin({ 'valid-jwt': { sub: 'user-1' } })
  const svc = createAgentService({
    manifests: [meta],
    getRegistry: () => registry,
    authPlugin,
    authorizeDataRead: resolve,
    actorResolver: {
      resolveActor: (principal) => ({
        kind: 'human',
        subject: principal.sub,
        organizationId: 'org-1',
        scopes: principal.scopes,
        issuer: null,
        audience: null,
        grantId: 'grant-1',
        grantVersion: '1',
      }),
    },
  })
  return svc
}

describe('authorizeDataRead — (a) anonymous denied', () => {
  it('returns 401 for a request with no JWT, and never calls the resolver', async () => {
    let resolverRan = false
    const svc = makeService(() => {
      resolverRan = true
      return { granted: true }
    })
    const res = (await svc.handleToolCall('order-card/order', null, {
      userId: null,
    })) as {
      error: string
      code: number
    }
    expect(res.code).toBe(401)
    expect(resolverRan).toBe(false)
  })
})

describe('authorizeDataRead — (b) verified actor denied the resource', () => {
  it('returns 403 CAPABILITY_DENIED when the resolver refuses the grant', async () => {
    const svc = makeService((_principal, request) => {
      expect(request.resource).toEqual({ orderId: 'order-1', organizationId: 'attacker-org' })
      expect(request.actor?.organizationId).toBe('org-1')
      return { granted: false }
    })
    const res = (await svc.handleToolCall('order-card/order', null, {
      userId: 'user-1',
      jwt: 'valid-jwt',
      resource: { orderId: 'order-1', organizationId: 'attacker-org' },
    })) as { error: string; code: number }
    expect(res.code).toBe(403)
    expect(res.error).toContain('CAPABILITY_DENIED')
  })
})

describe('authorizeDataRead — (c) valid grant + projection stripped server-side', () => {
  it('returns only the projected fields, with denied fields absent from the dispatched result', async () => {
    const svc = makeService(() => ({
      granted: true,
      projection: ['id', 'total'],
    }))
    const res = (await svc.handleToolCall('order-card/order', null, {
      userId: 'user-1',
      jwt: 'valid-jwt',
      resource: { orderId: 'order-1' },
    })) as { result: Record<string, unknown> }
    expect(res.result).toEqual({ id: 'order-1', total: 42 })
    expect(res.result).not.toHaveProperty('customerSsn')
  })

  it('returns the full value when the grant carries no projection', async () => {
    const svc = makeService(() => ({ granted: true }))
    const res = (await svc.handleToolCall('order-card/order', null, {
      userId: 'user-1',
      jwt: 'valid-jwt',
    })) as { result: Record<string, unknown> }
    expect(res.result).toEqual(ORDER)
  })

  it('recursively projects nested records and arrays through the direct read path', async () => {
    const value = {
      id: 'o1',
      order: { id: 'o1', customerSsn: 'secret' },
      items: [{ sku: 's1', cost: 55 }],
    }
    const svc = makeService(() => ({ granted: true, projection: ['order.id', 'items.sku'] }), value)
    const res = (await svc.handleToolCall('order-card/order', null, {
      userId: 'user-1',
      jwt: 'valid-jwt',
    })) as { result: unknown }
    expect(res.result).toEqual({ order: { id: 'o1' }, items: [{ sku: 's1' }] })
  })
})

describe('security hook timeout', () => {
  it('returns the specific actor unavailable code when actor resolution never settles', async () => {
    const svc = createAgentService({
      manifests: [{ tag: 'order-card', state: { order: 'the order record' } }],
      getRegistry: () => new Map([['order-card', [makeReadOnlyBinding('order-card', ORDER)]]]),
      authPlugin: makeVerifyingAuthPlugin({ 'valid-jwt': { sub: 'user-1' } }),
      securityHookTimeoutMs: 5,
      actorResolver: { resolveActor: () => new Promise(() => {}) },
      authorizeDataRead: () => ({ granted: true }),
    })
    const result = (await svc.handleToolCall('order-card/order', null, {
      userId: 'user-1',
      jwt: 'valid-jwt',
    })) as { code?: number; error?: string }
    expect(result.code).toBe(503)
    expect(result.error).toBe('ACTOR_UNAVAILABLE: actor resolution failed')
  })

  it('returns the specific unavailable code when capability authorization never settles', async () => {
    const svc = createAgentService({
      manifests: [{ tag: 'order-card', state: { order: 'the order record' } }],
      getRegistry: () => new Map([['order-card', [makeReadOnlyBinding('order-card', ORDER)]]]),
      authPlugin: makeVerifyingAuthPlugin({ 'valid-jwt': { sub: 'user-1' } }),
      securityHookTimeoutMs: 5,
      actorResolver: {
        resolveActor: (principal) => ({
          kind: 'human',
          subject: principal.sub,
          organizationId: 'org-1',
          scopes: principal.scopes,
          issuer: null,
          audience: null,
          grantId: null,
          grantVersion: null,
        }),
      },
      authorizeDataRead: () => new Promise(() => {}),
    })
    const result = (await svc.handleToolCall('order-card/order', null, {
      userId: 'user-1',
      jwt: 'valid-jwt',
    })) as { code?: number; error?: string }
    expect(result.code).toBe(503)
    expect(result.error).toBe(
      "CAPABILITY_UNAVAILABLE: authorization for 'order-card.order' could not be verified (resolver failure); refusing to serve",
    )
  })
})

describe('authorizeDataRead — absent hook fails closed', () => {
  it('returns CAPABILITY_UNAVAILABLE without exposing the state value', async () => {
    const tag = 'order-card'
    const meta: AgentMetadata = { tag, state: { order: 'the order record' } }
    const registry = new Map([[tag, [makeReadOnlyBinding(tag, ORDER)]]])
    const svc = createAgentService({
      manifests: [meta],
      getRegistry: () => registry,
      authPlugin: makeVerifyingAuthPlugin({ 'valid-jwt': { sub: 'user-1' } }),
      actorResolver: {
        resolveActor: (principal) => ({
          kind: 'human',
          subject: principal.sub,
          organizationId: 'org-1',
          scopes: principal.scopes,
          issuer: null,
          audience: null,
          grantId: 'grant-1',
          grantVersion: '1',
        }),
      },
    })
    const res = (await svc.handleToolCall('order-card/order', null, {
      userId: 'user-1',
      jwt: 'valid-jwt',
    })) as {
      error: string
      code: number
    }
    expect(res.code).toBe(503)
    expect(res.error).toBe(
      "CAPABILITY_UNAVAILABLE: no capability authorizer is configured for 'order-card.order'",
    )
  })

  it('returns exact ACTOR_UNAVAILABLE when a verified principal has no tenant resolver', async () => {
    const tag = 'order-card'
    const svc = createAgentService({
      manifests: [{ tag, state: { order: 'the order record' } }],
      getRegistry: () => new Map([[tag, [makeReadOnlyBinding(tag, ORDER)]]]),
      authPlugin: makeVerifyingAuthPlugin({ 'valid-jwt': { sub: 'user-1' } }),
      authorizeDataRead: () => ({ granted: true }),
    })
    const res = (await svc.handleToolCall(`${tag}/order`, null, {
      userId: 'user-1',
      jwt: 'valid-jwt',
    })) as {
      error: string
      code: number
    }
    expect(res.code).toBe(503)
    expect(res.error).toBe('ACTOR_UNAVAILABLE: actor resolver is not configured')
  })

  it('returns exact ACTOR_DENIED when the current tenant lookup has no grant', async () => {
    const tag = 'order-card'
    const svc = createAgentService({
      manifests: [{ tag, state: { order: 'the order record' } }],
      getRegistry: () => new Map([[tag, [makeReadOnlyBinding(tag, ORDER)]]]),
      authPlugin: makeVerifyingAuthPlugin({ 'valid-jwt': { sub: 'user-1' } }),
      actorResolver: { resolveActor: () => null },
      authorizeDataRead: () => ({ granted: true }),
    })
    const res = (await svc.handleToolCall(`${tag}/order`, null, {
      userId: 'user-1',
      jwt: 'valid-jwt',
    })) as {
      error: string
      code: number
    }
    expect(res.code).toBe(403)
    expect(res.error).toBe('ACTOR_DENIED: no current actor grant for this principal')
  })
})
