/**
 * Conformance suite (aihu-agent#14, routed from aihu-project/aihu#874) — the
 * regression floor underneath the GX hardening work tracked in #11/#12/#13.
 *
 * This file pins, through the PUBLIC `@aihu/agent-service` surface (never
 * package-internal imports), behavior that the other hardening issues build
 * on top of. A change that silently breaks one of these assertions is a
 * regression in this package's fail-closed posture, not a test to "fix" by
 * loosening it.
 *
 * Covers:
 *  1. The exported API surface and the dependency-version contract this
 *     suite is pinned against (a drift here is exactly the kind of change
 *     that can silently alter behavior for every consumer).
 *  2. Default and malformed `extract.call` policy resolve fail-closed.
 *  3. With no `AuthPlugin` configured, every gated call/read is denied —
 *     never a silent allow.
 *  4. A component/state exposing only a `read` member (no `actions`) has no
 *     invocation path that produces a write, even via a hand-crafted
 *     tool-call payload naming a member the metadata doesn't advertise as an
 *     action.
 *
 * NOT covered here (tracked separately, not yet enforceable):
 *  - Bridge peer binding / mid-session revocation (aihu-agent#13): the
 *    CURRENT invariant — a reconnecting channel must independently re-prove
 *    its session, never inheriting a prior channel's verified status — is
 *    already pinned at the `@aihu/agent-server` integration level by
 *    `bridge-auth.test.ts`'s "a new channel must prove its OWN session" case.
 *    What is NOT yet implemented (and therefore not testable) is revoking an
 *    already-verified, still-connected channel mid-session; #13 is the issue
 *    for that gap.
 *  - Read-axis enforcement in SSR/loader/bundle output (aihu-agent#12): the
 *    `read` axis decision is pinned here (see part 3), but nothing in this
 *    package or repo consumes that decision to withhold data yet — see
 *    `principal-gate.ts`'s own docblock. Do not read part 3 as proof that
 *    `read` is enforced anywhere.
 */

import { describe, expect, it } from 'vitest'
import rootPackageJson from '../../../package.json' with { type: 'json' }
import agentServicePackageJson from '../package.json' with { type: 'json' }
import * as agentServiceIndex from '../src/index.ts'
import { createAgentService } from '../src/index.ts'
import { decideEmission } from '../src/principal-gate.ts'
import type { AuthPlugin, LiveBinding, VerifiedClaims } from '../src/types.ts'

// ─── Part 1: pinned package versions + exported API surface ─────────────────

describe('conformance — pinned package versions and API surface', () => {
  it('the workspace tooling this suite is written/run against has not silently drifted', () => {
    // A major/minor bump in any of these can change observable behavior
    // (e.g. vitest's module-mocking semantics, TS's strictness defaults).
    // Bumping on purpose is fine — bump this pin in the same change.
    expect(rootPackageJson.devDependencies.vitest).toBe('^4.1.11')
    expect(rootPackageJson.devDependencies.typescript).toBe('^5.6.2')
    expect(rootPackageJson.devDependencies.vite).toBe('^8.0.16')
  })

  it("@aihu/agent-service's own runtime dependency contract is unchanged", () => {
    expect(agentServicePackageJson.dependencies).toEqual({ '@aihu/agent': 'workspace:*' })
  })

  it('the exported value surface matches the documented allowlist exactly', () => {
    // Type-only exports are erased at runtime and cannot appear here — this
    // pins VALUE exports only, which is exactly what a caller can invoke.
    const exportedValues = Object.keys(agentServiceIndex).sort()
    expect(exportedValues).toEqual(
      [
        'authorizeCapability',
        'createAgentService',
        'decideEmission',
        'isScopeValue',
        'projectCapabilityResult',
        'resolvePrincipal',
        'surfaceCallPolicy',
        'withSecurityTimeout',
      ].sort(),
    )
  })
})

// ─── Shared fixtures ──────────────────────────────────────────────────────

/**
 * A LiveBinding that records whether its mutating members were ever invoked.
 * `callAction` succeeds only for a name in `opts.actions` (mirroring a real
 * binding, whose action set is exactly what the component declared) — for
 * any other name it throws `no action: <name>`, same as the real dispatch
 * contract `handleToolCall` falls through to `getSignal` on. This lets a
 * test tell "the gate reached dispatch and dispatch itself served/refused
 * the name" apart from "the gate's own allowlist refused before dispatch" —
 * the latter (part 4) is exercised by `callAction`/`setSignal` never being
 * called at all for an undeclared name.
 */
function makeSpyBinding(
  tag: string,
  opts?: { scope?: string | null; actions?: readonly string[] },
): LiveBinding & { callActionCalls: string[]; setSignalCalls: string[] } {
  const callActionCalls: string[] = []
  const setSignalCalls: string[] = []
  const actions = new Set(opts?.actions ?? [])
  let value = 'unchanged'
  return {
    rootId: 1,
    tag,
    callActionCalls,
    setSignalCalls,
    getSignal(name: string): unknown {
      if (name === 'value') return value
      return undefined
    },
    setSignal(name: string, v: unknown): void {
      setSignalCalls.push(name)
      if (name === 'value') value = v as string
    },
    async callAction(name: string, _args: unknown[]): Promise<unknown> {
      callActionCalls.push(name)
      if (!actions.has(name)) throw new Error(`no action: ${name}`)
      return { dispatched: name }
    },
    scope(): string | null {
      return opts?.scope ?? null
    },
    rateLimit(): string | null {
      return null
    },
    dispose$(): boolean {
      return true
    },
  }
}

function makeRegistry(tag: string, binding: LiveBinding): Map<string, LiveBinding[]> {
  return new Map([[tag, [binding]]])
}

function makeVerifyingAuthPlugin(tokens: Record<string, VerifiedClaims>): AuthPlugin {
  return {
    checkScope: () => true,
    verify: async (jwt: string) => tokens[jwt] ?? null,
  }
}

// ─── Part 2: default / malformed extract.call policy → fail-closed ──────────

describe('conformance — extract.call policy resolves fail-closed', () => {
  it('no extract member at all → the documented default (anonymous), not a refusal', async () => {
    const binding = makeSpyBinding('plain-card', { actions: ['ping'] })
    const registry = makeRegistry('plain-card', binding)
    const svc = createAgentService({
      manifests: [{ tag: 'plain-card', actions: { ping: { returns: {} } } }],
      getRegistry: () => registry,
    })
    const res = (await svc.handleToolCall('plain-card/ping', [], { userId: 'u1' })) as {
      code?: number
      result?: unknown
    }
    expect(res.code).toBeUndefined()
    expect(res.result).toEqual({ dispatched: 'ping' })
  })

  it.each([
    ['a free-text string', 'wide-open'],
    ['a scope value with an empty scope', { scope: '' }],
    ['a non-string, non-object value', 42],
  ])('malformed extract.call (%s) refuses EVERY principal with 404, never rounds to open', async (_label, call) => {
    const binding = makeSpyBinding('gated-card')
    const registry = makeRegistry('gated-card', binding)
    const svc = createAgentService({
      manifests: [
        {
          tag: 'gated-card',
          actions: { ping: { returns: {} } },
          extract: { read: 'agents', call },
        },
      ],
      getRegistry: () => registry,
    })
    const anon = (await svc.handleToolCall('gated-card/ping', [], {
      userId: 'anon',
    })) as { code?: number; error?: string }
    expect(anon.code).toBe(404)
    // A malformed policy resolves to `call: 'none'` (surfaceCallPolicy), which
    // the gate shapes EXACTLY like an absent tag ("no live instance") rather
    // than naming SURFACE_UNAVAILABLE — so possessing a credential can never
    // distinguish "closed by a corrupt policy" from "does not exist" (the
    // Amendment 4 information-hiding invariant in agent-service.ts).
    expect(anon.error).toBe('no live instance: gated-card')

    const authPlugin = makeVerifyingAuthPlugin({ good: { sub: 'agent-1' } })
    const svcWithAuth = createAgentService({
      manifests: [
        {
          tag: 'gated-card',
          actions: { ping: { returns: {} } },
          extract: { read: 'agents', call },
        },
      ],
      getRegistry: () => registry,
      authPlugin,
    })
    const verified = (await svcWithAuth.handleToolCall('gated-card/ping', [], {
      userId: 'u1',
      jwt: 'good',
    })) as { code?: number; error?: string }
    expect(verified.code).toBe(404)
    expect(verified.error).toBe('no live instance: gated-card')

    // Never reaches dispatch — the closed surface refuses before invocation.
    expect(binding.callActionCalls).toHaveLength(0)
  })
})

// ─── Part 3: no AuthPlugin registered → every gated surface fails closed ────

describe('conformance — with no AuthPlugin, every gated call/read is denied', () => {
  it('call axis: a scoped component with no authPlugin at all → 401 AUTH_MISSING', async () => {
    const binding = makeSpyBinding('scoped-card', { scope: 'reports:read' })
    const registry = makeRegistry('scoped-card', binding)
    const svc = createAgentService({
      manifests: [{ tag: 'scoped-card', actions: { ping: { returns: {} } } }],
      getRegistry: () => registry,
      // authPlugin intentionally omitted
    })
    const res = (await svc.handleToolCall('scoped-card/ping', [], { userId: 'u1' })) as {
      code?: number
      error?: string
    }
    expect(res.code).toBe(401)
    expect(res.error).toBe('AUTH_MISSING: @aihu/auth middleware is not registered')
    expect(binding.callActionCalls).toHaveLength(0)
  })

  it("call axis: extract.call:'verified' with no authPlugin → 401 AUTH_MISSING for everyone", async () => {
    const binding = makeSpyBinding('verified-only-card')
    const registry = makeRegistry('verified-only-card', binding)
    const svc = createAgentService({
      manifests: [
        {
          tag: 'verified-only-card',
          actions: { ping: { returns: {} } },
          extract: { read: 'agents', call: 'verified' },
        },
      ],
      getRegistry: () => registry,
    })
    const res = (await svc.handleToolCall('verified-only-card/ping', [], {
      userId: 'u1',
    })) as { code?: number; error?: string }
    expect(res.code).toBe(401)
    expect(res.error).toContain('AUTH_MISSING')
  })

  it('read axis (decided, not yet enforced downstream): every hard-tier value denies AUTH_MISSING', () => {
    const anonNoPlugin = {
      class: 'anonymous',
      uaTier: null,
      credentialFailure: 'no-auth-plugin',
    } as const
    for (const value of ['verified', 'human', { scope: 'reports:read' }] as const) {
      const d = decideEmission(anonNoPlugin, { axis: 'read', value })
      expect(d.allow).toBe(false)
      if (!d.allow) {
        expect(d.code).toBe(401)
        expect(d.reason).toBe('AUTH_MISSING')
      }
    }
  })

  it('read axis: compliance-tier values still pass an unclassified anonymous requester', () => {
    // No AuthPlugin does not, by itself, close the compliance-tier read axis —
    // that tier binds only DECLARED crawler UAs (spec'd honest ceiling), and
    // this pin exists so a future change does not conflate "no auth plugin"
    // with "no read access at all" for the compliance tier.
    const anonNoPlugin = {
      class: 'anonymous',
      uaTier: null,
      credentialFailure: 'no-auth-plugin',
    } as const
    for (const value of ['all', 'agents', 'search', 'none'] as const) {
      expect(decideEmission(anonNoPlugin, { axis: 'read', value }).allow).toBe(true)
    }
  })
})

// ─── Part 4: a read-only member has no invocation path to a write ───────────

describe('conformance — a read-only (state-only) member has no path to a write', () => {
  it('handleToolCall on a declared state member reads it; the writer is never invoked', async () => {
    const binding = makeSpyBinding('readonly-card')
    const registry = makeRegistry('readonly-card', binding)
    const svc = createAgentService({
      manifests: [
        {
          tag: 'readonly-card',
          // No `actions` at all — `value` is advertised only as a readable
          // state member.
          state: { value: 'The current value.' },
        },
      ],
      getRegistry: () => registry,
    })
    const res = (await svc.handleToolCall('readonly-card/value', [], { userId: 'u1' })) as {
      result?: unknown
      code?: number
      error?: string
    }
    expect(res.code).toBe(401)
    expect(res.error).toContain('AUTH_MISSING')
    expect(res.result).toBeUndefined()
    // The gate fell through to getSignal — setSignal (the write path) was
    // never reached, even though the fixture's binding exposes one.
    expect(binding.setSignalCalls).toHaveLength(0)
  })

  it('a hand-crafted action name absent from BOTH actions and state → 404, never dispatched', async () => {
    const binding = makeSpyBinding('readonly-card-2')
    const registry = makeRegistry('readonly-card-2', binding)
    const svc = createAgentService({
      manifests: [{ tag: 'readonly-card-2', state: { value: 'The current value.' } }],
      getRegistry: () => registry,
    })
    // A caller naming an action the compiled metadata never advertised —
    // the server-side allowlist (not the browser's opaque-ID map) must
    // refuse this; see the "gate authorizes by tag, not action name" fix
    // this pin guards against regressing.
    const res = (await svc.handleToolCall('readonly-card-2/forceWrite', ['payload'], {
      userId: 'u1',
    })) as { code?: number; error?: string }
    expect(res.code).toBe(404)
    expect(res.error).toContain('no action')
    expect(binding.callActionCalls).toHaveLength(0)
    expect(binding.setSignalCalls).toHaveLength(0)
  })

  it('a live secret record stays out of metadata and is denied through the actual state read path', async () => {
    const privateRecord = { id: 'order-1', customerSsn: 'secret-ssn-marker' }
    const binding: LiveBinding = {
      rootId: 1,
      tag: 'order-manifest',
      getSignal(name: string) {
        return name === 'order' ? privateRecord : undefined
      },
      setSignal() {},
      async callAction(name: string) {
        throw new Error(`no action: ${name}`)
      },
      scope: () => null,
      rateLimit: () => null,
      dispose$: () => true,
    }
    const svc = createAgentService({
      manifests: [{ tag: 'order-manifest', state: { order: 'The current order.' } }],
      getRegistry: () => new Map([['order-manifest', [binding]]]),
    })
    const manifest = JSON.stringify(svc.getManifest())
    expect(manifest).not.toContain(privateRecord.customerSsn)
    expect(manifest).not.toContain(privateRecord.id)
    const read = (await svc.handleToolCall('order-manifest/order', null, { userId: null })) as {
      code?: number
      error?: string
      result?: unknown
    }
    expect(read.code).toBe(401)
    expect(read.error).toBe('AUTH_MISSING: @aihu/auth middleware is not registered')
    expect(read.result).toBeUndefined()
  })
})
