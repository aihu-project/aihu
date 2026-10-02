/**
 * #870 — tenant-aware actor context. `runGate` gains one stage after the
 * static call-axis meet: when an `ActorResolver` is injected, it resolves
 * the authoritative {@link Actor} for the verified, non-anonymous principal
 * and surfaces it through `authorize()` for a capability-bridge host to
 * layer its own session/tenant authorization on top.
 *
 * Fail-closed contract under test: ABSENT resolver ⇒ no `actor` field at
 * all (byte-identical to pre-#870 behavior); a resolver that returns `null`
 * for a given principal also yields no `actor` — never a placeholder.
 */
import { describe, expect, it } from 'vitest'
import type { Actor, ActorResolver } from '../src/actor.ts'
import { createAgentService } from '../src/index.ts'
import type { AuthPlugin, LiveBinding, VerifiedClaims } from '../src/types.ts'

const CLAIMS: Record<string, VerifiedClaims> = {
  'agent-token': { sub: 'agent-1', scope: 'members', org: 'attacker-supplied-org' },
  'plain-token': { sub: 'plain-1' },
}

const authPlugin: AuthPlugin = {
  checkScope: (jwt, scope) => {
    const claims = CLAIMS[jwt]
    return typeof claims?.scope === 'string' && claims.scope.split(' ').includes(scope)
  },
  verify: async (jwt) => CLAIMS[jwt] ?? null,
}

function binding(): LiveBinding {
  return {
    rootId: 1,
    tag: 'actor-tool',
    getSignal: () => undefined,
    setSignal: () => {},
    callAction: async () => 'dispatched',
    scope: () => 'members',
    rateLimit: () => null,
    dispose$: () => true,
  }
}

/** A resolver that ignores `claims.org` and does its own authoritative lookup by `sub`. */
function authoritativeResolver(bySub: Record<string, Actor>): ActorResolver & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    resolveActor(principal) {
      calls.push(principal.sub)
      return bySub[principal.sub] ?? null
    },
  }
}

const ACTOR_1: Actor = {
  kind: 'delegated-agent',
  subject: 'agent-1',
  organizationId: 'org-authoritative',
  scopes: ['members'],
  issuer: 'https://issuer.example',
  audience: 'aihu-tools',
  grantId: 'grant-42',
  grantVersion: '3',
}

function service(actorResolver?: ActorResolver) {
  return createAgentService({
    manifests: [
      {
        tag: 'actor-tool',
        actions: { run: { params: [] } },
        extract: { call: 'anonymous' },
      } as never,
    ],
    authPlugin,
    getRegistry: () => new Map([['actor-tool', [binding()]]]),
    ...(actorResolver ? { actorResolver } : {}),
  })
}

const ctx = (jwt: string) => ({ userId: null, jwt })

describe('runGate step 2b — tenant-aware actor resolution (#870)', () => {
  it('ABSENT resolver ⇒ no `actor` field at all (byte-identical to pre-#870 behavior)', async () => {
    const out = (await service().authorize('actor-tool/run', null, ctx('agent-token'))) as Record<
      string,
      unknown
    >
    expect(out).toEqual({ authorized: true })
    expect('actor' in out).toBe(false)
  })

  it('resolver present ⇒ authorize() surfaces the resolved actor', async () => {
    const resolver = authoritativeResolver({ 'agent-1': ACTOR_1 })
    const out = (await service(resolver).authorize('actor-tool/run', null, ctx('agent-token'))) as {
      authorized: boolean
      actor?: Actor
    }
    expect(out.authorized).toBe(true)
    expect(out.actor).toEqual(ACTOR_1)
  })

  it('the resolver is called with the verified principal only — an org-shaped claim never becomes the actor', async () => {
    const resolver = authoritativeResolver({ 'agent-1': ACTOR_1 })
    await service(resolver).authorize('actor-tool/run', null, ctx('agent-token'))
    expect(resolver.calls).toEqual(['agent-1'])
    // The token's `claims.org` said "attacker-supplied-org"; the resolver's
    // own authoritative record said "org-authoritative" — the latter wins
    // because nothing here ever reads `claims.org` directly.
  })

  it('resolver returning null for this principal ⇒ no `actor` field — never a placeholder', async () => {
    const resolver = authoritativeResolver({}) // no record for 'agent-1'
    const out = (await service(resolver).authorize(
      'actor-tool/run',
      null,
      ctx('agent-token'),
    )) as Record<string, unknown>
    expect(out).toEqual({ authorized: true })
    expect('actor' in out).toBe(false)
  })

  it('an anonymous/refused caller never reaches the resolver', async () => {
    const resolver = authoritativeResolver({ 'agent-1': ACTOR_1 })
    const out = (await service(resolver).authorize('actor-tool/run', null, ctx('plain-token'))) as {
      code?: number
    }
    // plain-token has no `members` scope, so the static meet refuses first.
    expect(out.code).toBe(403)
    expect(resolver.calls).toEqual([])
  })

  it('an anonymous caller (no credential at all) never reaches the resolver', async () => {
    const resolver = authoritativeResolver({ 'agent-1': ACTOR_1 })
    await service(resolver).authorize('actor-tool/run', null)
    expect(resolver.calls).toEqual([])
  })

  it('handleToolCall dispatches normally whether or not an actor was resolved', async () => {
    const resolver = authoritativeResolver({ 'agent-1': ACTOR_1 })
    const out = (await service(resolver).handleToolCall(
      'actor-tool/run',
      null,
      ctx('agent-token'),
    )) as {
      result?: unknown
    }
    expect(out.result).toBe('dispatched')
  })
})
