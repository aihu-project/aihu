/**
 * aihu#871 — the capability authorization hook: `authorizeCapability` +
 * `projectCapabilityResult`.
 *
 * Unit-level coverage of the hook itself (fail-closed ladder, resolver
 * outcomes, projection stripping). `tests/capability-authorization-live.test.ts`
 * covers the same hook wired through `handleToolCall`'s data-read path.
 */

import { describe, expect, it } from 'vitest'
import {
  authorizeCapability,
  type CapabilityGrantResolver,
  projectCapabilityResult,
  withSecurityTimeout,
} from '../src/capability-gate.ts'
import type {
  AnonymousPrincipal,
  HumanSessionPrincipal,
  ScopedAgentPrincipal,
} from '../src/principal-gate.ts'

const anonymous = (
  credentialFailure: AnonymousPrincipal['credentialFailure'],
): AnonymousPrincipal => ({
  class: 'anonymous',
  uaTier: null,
  credentialFailure,
})

const verifiedScoped: ScopedAgentPrincipal = {
  class: 'scoped-agent',
  sub: 'agent-1',
  scopes: ['read:orders'],
  claims: { sub: 'agent-1', scope: 'read:orders' },
}

const humanSession: HumanSessionPrincipal = {
  class: 'human-session',
  sub: 'user-1',
  scopes: [],
}

describe('authorizeCapability — fail-closed ladder', () => {
  it('denies an anonymous principal with 401 AUTH_REQUIRED, without ever calling resolve', async () => {
    const resolve = (): never => {
      throw new Error('resolve must not run for an anonymous principal')
    }
    const verdict = await authorizeCapability(
      anonymous('no-credential'),
      { capability: 'orders.view' },
      { resolve },
    )
    expect(verdict.allow).toBe(false)
    if (!verdict.allow) {
      expect(verdict.code).toBe(401)
      expect(verdict.reason).toBe('AUTH_REQUIRED')
      expect(verdict.message).toBe('AUTH_REQUIRED: a signed JWT is required for this capability')
    }
  })

  it('denies with AUTH_MISSING when the anonymous principal has no auth plugin at all', async () => {
    const verdict = await authorizeCapability(
      anonymous('no-auth-plugin'),
      { capability: 'orders.view' },
      { resolve: () => ({ granted: true }) },
    )
    expect(verdict.allow).toBe(false)
    if (!verdict.allow) expect(verdict.reason).toBe('AUTH_MISSING')
  })

  it('returns 503 CAPABILITY_UNAVAILABLE when no resolver is configured', async () => {
    const verdict = await authorizeCapability(verifiedScoped, { capability: 'orders.view' }, {})
    expect(verdict.allow).toBe(false)
    if (!verdict.allow) {
      expect(verdict.code).toBe(503)
      expect(verdict.reason).toBe('CAPABILITY_UNAVAILABLE')
      expect(verdict.message).toBe(
        "CAPABILITY_UNAVAILABLE: no capability authorizer is configured for 'orders.view'",
      )
    }
  })

  it('returns 503 CAPABILITY_UNAVAILABLE when the resolver throws (never a grant)', async () => {
    const resolve: CapabilityGrantResolver = () => {
      throw new Error('downstream outage')
    }
    const verdict = await authorizeCapability(
      verifiedScoped,
      { capability: 'orders.view', resource: { id: 'order-1' } },
      { resolve },
    )
    expect(verdict.allow).toBe(false)
    if (!verdict.allow) {
      expect(verdict.code).toBe(503)
      expect(verdict.reason).toBe('CAPABILITY_UNAVAILABLE')
      expect(verdict.message).toBe(
        "CAPABILITY_UNAVAILABLE: authorization for 'orders.view' could not be verified (resolver failure); refusing to serve",
      )
    }
  })

  it('returns 503 CAPABILITY_UNAVAILABLE when the resolver rejects', async () => {
    const resolve: CapabilityGrantResolver = async () => {
      throw new Error('resolver rejected')
    }
    const verdict = await authorizeCapability(
      verifiedScoped,
      { capability: 'orders.view' },
      { resolve },
    )
    expect(verdict.allow).toBe(false)
    if (!verdict.allow) expect(verdict.code).toBe(503)
  })
})

describe('authorizeCapability — resolver verdicts', () => {
  it('denies a verified actor without the right scope/resource grant (403 CAPABILITY_DENIED)', async () => {
    const resolve: CapabilityGrantResolver = (principal, request) => {
      expect(principal).toBe(verifiedScoped)
      expect(request.resource).toEqual({ id: 'order-not-owned' })
      return { granted: false }
    }
    const verdict = await authorizeCapability(
      verifiedScoped,
      { capability: 'orders.view', resource: { id: 'order-not-owned' } },
      { resolve },
    )
    expect(verdict.allow).toBe(false)
    if (!verdict.allow) {
      expect(verdict.code).toBe(403)
      expect(verdict.reason).toBe('CAPABILITY_DENIED')
      expect(verdict.message).toBe(
        "CAPABILITY_DENIED: 'orders.view' is not authorized for this principal",
      )
    }
  })

  it('allows a valid grant and carries through the projection untouched', async () => {
    const resolve: CapabilityGrantResolver = () => ({
      granted: true,
      projection: ['id', 'total'],
    })
    const verdict = await authorizeCapability(
      humanSession,
      { capability: 'orders.view', resource: { id: 'order-1' } },
      { resolve },
    )
    expect(verdict.allow).toBe(true)
    if (verdict.allow) expect(verdict.projection).toEqual(['id', 'total'])
  })

  it('allows a valid grant with no projection (no restriction)', async () => {
    const verdict = await authorizeCapability(
      verifiedScoped,
      { capability: 'orders.view' },
      { resolve: () => ({ granted: true }) },
    )
    expect(verdict.allow).toBe(true)
    if (verdict.allow) expect(verdict.projection).toBeUndefined()
  })

  it('awaits an async resolver before deciding', async () => {
    const resolve: CapabilityGrantResolver = async () => {
      await new Promise((r) => setTimeout(r, 1))
      return { granted: true, projection: ['id'] }
    }
    const verdict = await authorizeCapability(
      verifiedScoped,
      { capability: 'orders.view' },
      { resolve },
    )
    expect(verdict.allow).toBe(true)
  })
})

describe('projectCapabilityResult', () => {
  it('strips every field not named by the projection', () => {
    const result = projectCapabilityResult(
      { id: 'order-1', total: 42, customerSsn: '000-00-0000' },
      ['id', 'total'],
    )
    expect(result).toEqual({ id: 'order-1', total: 42 })
    expect(result).not.toHaveProperty('customerSsn')
  })

  it('passes the value through unchanged when no projection is given', () => {
    const value = { id: 'order-1', secret: 'leaked-if-unprojected' }
    expect(projectCapabilityResult(value, undefined)).toBe(value)
  })

  it('passes scalar leaves through and projects each array element', () => {
    expect(projectCapabilityResult('sunny', ['anything'])).toBe('sunny')
    expect(projectCapabilityResult([1, 2, 3], ['anything'])).toEqual([1, 2, 3])
    expect(
      projectCapabilityResult(
        [
          { id: 'o1', customerSsn: 'secret' },
          { id: 'o2', customerSsn: 'secret-2' },
        ],
        ['id'],
      ),
    ).toEqual([{ id: 'o1' }, { id: 'o2' }])
    expect(projectCapabilityResult(null, ['anything'])).toBeNull()
  })

  it('produces an empty object when the projection names no present field', () => {
    expect(projectCapabilityResult({ a: 1, b: 2 }, ['c'])).toEqual({})
  })

  it('projects dotted paths recursively through records and arrays of records', () => {
    expect(
      projectCapabilityResult(
        { order: { id: 'o1', customerSsn: 'secret' }, items: [{ sku: 's1', cost: 99 }] },
        ['order.id', 'items.sku'],
      ),
    ).toEqual({ order: { id: 'o1' }, items: [{ sku: 's1' }] })
  })

  it('fails closed for object shapes that cannot be described by field paths', () => {
    expect(() => projectCapabilityResult(new Map([['secret', 'value']]), ['id'])).toThrow(
      'CAPABILITY_UNAVAILABLE: result shape cannot be projected',
    )
  })

  it('fails closed when a selected leaf exposes a callable toJSON', () => {
    const withToJson = { id: 1, toJSON: () => ({ secret: 'unprojected-marker' }) }
    expect(() => {
      const projected = projectCapabilityResult({ record: withToJson }, ['record.toJSON'])
      JSON.stringify(projected)
    }).toThrow('CAPABILITY_UNAVAILABLE: result shape cannot be projected')
  })

  it('fails closed for a selected Date leaf', () => {
    expect(() => projectCapabilityResult({ created: new Date() }, ['created'])).toThrow(
      'CAPABILITY_UNAVAILABLE: result shape cannot be projected',
    )
  })
})

describe('withSecurityTimeout', () => {
  it('keeps the timeout denial when the hook resolves after its deadline', async () => {
    let resolve!: (value: string) => void
    const hook = new Promise<string>((done) => {
      resolve = done
    })
    const result = withSecurityTimeout(hook, 2)
    const outcome = result.then(
      () => new Error('unexpected hook success'),
      (error: unknown) => error,
    )
    await new Promise((done) => setTimeout(done, 5))
    resolve('late allow')
    expect(await outcome).toMatchObject({ message: 'security hook timed out' })
  })

  it('observes a rejection that arrives after timeout without an unhandled rejection', async () => {
    let reject!: (reason: Error) => void
    const hook = new Promise<never>((_resolve, done) => {
      reject = done
    })
    const result = withSecurityTimeout(hook, 2)
    await expect(result).rejects.toThrow('security hook timed out')
    reject(new Error('late hook failure'))
    await new Promise((done) => setTimeout(done, 0))
    await expect(result).rejects.toThrow('security hook timed out')
  })
})
