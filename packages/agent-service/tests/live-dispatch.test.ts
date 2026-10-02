/**
 * v0.3.0 live-dispatch tests for `@aihu/agent-service` — AC4–AC11, AC14.
 *
 * AC4: handleToolCall live dispatch returns real result, not stub.
 * AC5: Scope pass — JWT with claim → 200.
 * AC6: Scope fail — JWT without claim → 403.
 * AC7: Auth-absent fail-closed → 401 AUTH_MISSING.
 * AC8: Rate-limit → 429 after quota exhausted.
 * AC9: userId missing → 401.
 * AC10: No live instance → 404.
 * AC11: Undeclared action → 404.
 * AC14: Dispatch ordering invariant: 403 before 429.
 */

import { describe, expect, it } from 'vitest'
import { createAgentService } from '../src/index.ts'
import type { AuthPlugin, LiveBinding, RateLimitPlugin, VerifiedClaims } from '../src/types.ts'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * An `AuthPlugin` that can signature-"verify": `verify(jwt)` resolves the
 * claims registered for that exact token string and `null` for anything else
 * — the same observable contract as the real HMAC path (#420). `checkScope`
 * defaults to the legacy substring convention used throughout this file.
 */
function makeVerifyingAuthPlugin(
  tokens: Record<string, VerifiedClaims>,
  checkScope: (jwt: string, scope: string) => boolean = () => true,
): AuthPlugin {
  return {
    checkScope,
    verify: async (jwt: string) => tokens[jwt] ?? null,
  }
}

/** Build a minimal LiveBinding for testing. */
function makeLiveBinding(
  tag: string,
  scopeStr: string | null = null,
  rateLimitStr: string | null = null,
): LiveBinding {
  let locationValue = 'NYC'
  let disposeCount = 0

  return {
    rootId: 1,
    tag,
    getSignal(name: string): unknown {
      if (name === 'location') return locationValue
      if (name === 'forecast') return 'sunny'
      return undefined
    },
    setSignal(name: string, value: unknown): void {
      if (name === 'location') locationValue = value as string
    },
    async callAction(name: string, _args: unknown[]): Promise<unknown> {
      if (name === 'fetchForecast') return { weather: 'sunny', location: locationValue }
      throw new Error(`no action: ${name}`)
    },
    scope(): string | null {
      return scopeStr
    },
    rateLimit(): string | null {
      return rateLimitStr
    },
    dispose$(): boolean {
      if (disposeCount > 0) return false
      disposeCount++
      return true
    },
  }
}

/** Create a registry Map with one binding. */
function makeRegistry(tag: string, binding: LiveBinding): Map<string, LiveBinding[]> {
  return new Map([[tag, [binding]]])
}

// ─── AC10: No live instance ──────────────────────────────────────────────────

describe('AC10 — no live instance → 404', () => {
  it('returns 404 when no binding is in the registry', async () => {
    const registry = new Map<string, LiveBinding[]>()
    const svc = createAgentService({
      getRegistry: () => registry,
    })
    const res = (await svc.handleToolCall(
      'weather-card/fetchForecast',
      {},
      {
        userId: 'user-1',
      },
    )) as { error: string; code: number }
    expect(res.code).toBe(404)
    expect(res.error).toContain('weather-card')
  })

  it('returns 404 for empty binding array', async () => {
    const registry = new Map([['weather-card', [] as LiveBinding[]]])
    const svc = createAgentService({ getRegistry: () => registry })
    const res = (await svc.handleToolCall(
      'weather-card/fetchForecast',
      {},
      {
        userId: 'user-1',
      },
    )) as { error: string; code: number }
    expect(res.code).toBe(404)
  })
})

// ─── AC9: verified principal required ────────────────────────────────────────
// Since #420: auth-gated endpoints (those with $scope or $rate-limit) require a
// signature-VERIFIED JWT; the principal is its `sub` claim. Caller-supplied
// userId satisfies nothing. Un-scoped, un-rate-limited components allow
// anonymous.

describe('AC9 — verified principal missing → 401 for scoped components', () => {
  it('returns 401 when no JWT is presented (scoped component)', async () => {
    const binding = makeLiveBinding('weather-card', 'authenticated') // has scope
    const registry = makeRegistry('weather-card', binding)
    const authPlugin = makeVerifyingAuthPlugin({ good: { sub: 'user-1' } })
    const svc = createAgentService({ getRegistry: () => registry, authPlugin })
    const res = (await svc.handleToolCall(
      'weather-card/fetchForecast',
      {},
      {
        userId: 'user-1', // a caller-supplied identity is NOT a credential
      },
    )) as { error: string; code: number }
    expect(res.code).toBe(401)
    expect(res.error).toContain('AUTH_REQUIRED')
  })

  it('returns 401 when the plugin cannot verify signatures (fail-closed)', async () => {
    const binding = makeLiveBinding('weather-card', 'authenticated')
    const registry = makeRegistry('weather-card', binding)
    // Decode-only plugin: no `verify`. Must fail closed, never fall back to
    // unverified claims or caller identity.
    const authPlugin = { checkScope: () => true }
    const svc = createAgentService({ getRegistry: () => registry, authPlugin })
    const res = (await svc.handleToolCall(
      'weather-card/fetchForecast',
      {},
      {
        userId: 'user-1',
        jwt: 'looks-fine',
      },
    )) as { error: string; code: number }
    expect(res.code).toBe(401)
    expect(res.error).toContain('AUTH_UNVERIFIABLE')
  })

  it('returns 401 when requestContext is omitted for scoped component', async () => {
    const binding = makeLiveBinding('weather-card', 'authenticated')
    const registry = makeRegistry('weather-card', binding)
    const authPlugin = makeVerifyingAuthPlugin({ good: { sub: 'user-1' } })
    const svc = createAgentService({ getRegistry: () => registry, authPlugin })
    const res = (await svc.handleToolCall('weather-card/fetchForecast', {})) as {
      error: string
      code: number
    }
    expect(res.code).toBe(401)
  })

  it('returns 401 when no JWT is presented for a rate-limited component', async () => {
    const binding = makeLiveBinding('weather-card', null, '100/min')
    const registry = makeRegistry('weather-card', binding)
    const authPlugin = makeVerifyingAuthPlugin({ good: { sub: 'user-1' } })
    const svc = createAgentService({ getRegistry: () => registry, authPlugin })
    const res = (await svc.handleToolCall('weather-card/fetchForecast', {})) as {
      error: string
      code: number
    }
    expect(res.code).toBe(401)
  })

  it('returns 401 when the verified JWT carries no sub claim', async () => {
    const binding = makeLiveBinding('weather-card', 'authenticated')
    const registry = makeRegistry('weather-card', binding)
    const authPlugin = makeVerifyingAuthPlugin({ subless: { scope: 'authenticated' } })
    const svc = createAgentService({ getRegistry: () => registry, authPlugin })
    const res = (await svc.handleToolCall(
      'weather-card/fetchForecast',
      {},
      { userId: 'user-1', jwt: 'subless' },
    )) as { error: string; code: number }
    expect(res.code).toBe(401)
    expect(res.error).toContain('sub')
  })
})

// ─── AC4: Live dispatch ──────────────────────────────────────────────────────

describe('AC4 — live dispatch returns real result', () => {
  it('callAction on mounted component returns real result', async () => {
    const binding = makeLiveBinding('weather-card')
    const registry = makeRegistry('weather-card', binding)
    const svc = createAgentService({ getRegistry: () => registry })
    const res = (await svc.handleToolCall(
      'weather-card/fetchForecast',
      {},
      {
        userId: 'user-1',
      },
    )) as { result: { weather: string } }
    expect(res.result).toBeDefined()
    expect(res.result.weather).toBe('sunny')
  })

  it('getSignal refuses a read-only signal without an authorization hook', async () => {
    const binding = makeLiveBinding('weather-card')
    const registry = makeRegistry('weather-card', binding)
    const svc = createAgentService({ getRegistry: () => registry })
    // `location` is a read signal, not an action
    const res = (await svc.handleToolCall(
      'weather-card/location',
      {},
      {
        userId: 'user-1',
      },
    )) as { result?: unknown; error?: string; code?: number }
    expect(res.code).toBe(401)
    expect(res.error).toBe('AUTH_MISSING: @aihu/auth middleware is not registered')
    expect(res.result).toBeUndefined()
  })

  it('result is NOT the stub { stub: true }', async () => {
    const binding = makeLiveBinding('weather-card')
    const registry = makeRegistry('weather-card', binding)
    const svc = createAgentService({ getRegistry: () => registry })
    const res = (await svc.handleToolCall(
      'weather-card/fetchForecast',
      {},
      {
        userId: 'user-1',
      },
    )) as Record<string, unknown>
    expect(res.stub).toBeUndefined()
  })
})

// ─── AC11: Action allowlist ──────────────────────────────────────────────────

describe('AC11 — undeclared action → 404', () => {
  it('returns 404 for an action not exposed by the binding', async () => {
    const binding = makeLiveBinding('weather-card')
    const registry = makeRegistry('weather-card', binding)
    const svc = createAgentService({ getRegistry: () => registry })
    const res = (await svc.handleToolCall(
      'weather-card/internalMethod',
      {},
      {
        userId: 'user-1',
      },
    )) as { error: string; code: number }
    expect(res.code).toBe(404)
    expect(res.error).toContain('internalMethod')
  })
})

// ─── AC11b: the gate itself must enforce, not the invoker ───────────────────
//
// AC11 above passes even with NO server-side allowlist, because
// `makeLiveBinding.callAction` throws `no action: …` and the handler maps that
// to a 404. It therefore asserts the INVOKER's rejection, not the gate's — the
// same inversion that let `typeof binding.callAction === 'function'` stand in
// for an allowlist check on the only branch that can succeed.
//
// These tests are constructed so the invoker WOULD succeed. Only a real
// server-side check can produce a 404.

describe('AC11b — server-side allowlist is load-bearing', () => {
  /** A binding whose callAction succeeds for ANY name. */
  function makePermissiveBinding(tag: string): LiveBinding {
    return {
      rootId: 1,
      tag,
      getSignal: () => 'readable',
      setSignal: () => {},
      callAction: async (name: string) => ({ called: name }),
      scope: () => null,
      rateLimit: () => null,
      dispose$: () => true,
    }
  }

  it('denies an action the metadata does not advertise, even though the binding would run it', async () => {
    const binding = makePermissiveBinding('weather-card')
    const registry = makeRegistry('weather-card', binding)
    const svc = createAgentService({
      getRegistry: () => registry,
      manifests: [
        {
          tag: 'weather-card',
          actions: { fetchForecast: { returns: {} } },
          state: { forecast: 'The current forecast' },
        },
      ],
    })

    // Sanity: the binding really would have run it.
    await expect(binding.callAction('wipeDatabase', [])).resolves.toEqual({
      called: 'wipeDatabase',
    })

    const res = (await svc.handleToolCall('weather-card/wipeDatabase', {}, { userId: 'u1' })) as {
      error: string
      code: number
    }
    expect(res.code).toBe(404)
    expect(res.error).toContain('wipeDatabase')
  })

  it('allows an advertised action', async () => {
    const binding = makePermissiveBinding('weather-card')
    const registry = makeRegistry('weather-card', binding)
    const svc = createAgentService({
      getRegistry: () => registry,
      manifests: [{ tag: 'weather-card', actions: { fetchForecast: { returns: {} } } }],
    })
    const res = (await svc.handleToolCall('weather-card/fetchForecast', {}, { userId: 'u1' })) as {
      result: unknown
    }
    expect(res.result).toBeDefined()
  })

  it('allows a readable state member (handleToolCall falls through to getSignal)', async () => {
    const binding = makePermissiveBinding('weather-card')
    const registry = makeRegistry('weather-card', binding)
    const svc = createAgentService({
      getRegistry: () => registry,
      manifests: [
        {
          tag: 'weather-card',
          actions: { fetchForecast: { returns: {} } },
          state: { forecast: 'The current forecast' },
        },
      ],
    })
    const res = (await svc.handleToolCall('weather-card/forecast', {}, { userId: 'u1' })) as {
      result: unknown
    }
    expect(res.result).toBeDefined()
  })
})

// ─── AC5 + AC6: Scope enforcement ───────────────────────────────────────────

describe('AC5 + AC6 — scope enforcement', () => {
  // Both tokens VERIFY (they are "signed"); only one carries the scope. The
  // scope decision runs on verified claims — checkScope is consulted only
  // after verify() authenticated the token (#420).
  const authPlugin: AuthPlugin = makeVerifyingAuthPlugin(
    {
      'token-authenticated-xyz': { sub: 'user-1', scope: 'authenticated' },
      'token-no-scope': { sub: 'user-1' },
    },
    (jwt: string, scope: string): boolean => jwt.includes(scope),
  )

  it('AC5: scope pass — JWT with authenticated claim → 200 result', async () => {
    const binding = makeLiveBinding('weather-card', 'authenticated')
    const registry = makeRegistry('weather-card', binding)
    const svc = createAgentService({ getRegistry: () => registry, authPlugin })
    const res = (await svc.handleToolCall(
      'weather-card/fetchForecast',
      {},
      { userId: 'user-1', jwt: 'token-authenticated-xyz' },
    )) as { result: unknown }
    expect(res.result).toBeDefined()
  })

  it('AC6: scope fail — JWT without claim → 403', async () => {
    const binding = makeLiveBinding('weather-card', 'authenticated')
    const registry = makeRegistry('weather-card', binding)
    const svc = createAgentService({ getRegistry: () => registry, authPlugin })
    const res = (await svc.handleToolCall(
      'weather-card/fetchForecast',
      {},
      { userId: 'user-1', jwt: 'token-no-scope' },
    )) as { error: string; code: number }
    expect(res.code).toBe(403)
    expect(res.error).toContain('SCOPE_DENIED')
  })
})

// ─── AC7: Auth-absent fail-closed ───────────────────────────────────────────

describe('AC7 — auth-absent fail-closed', () => {
  it('no authPlugin + $scope component → 401 AUTH_MISSING', async () => {
    const binding = makeLiveBinding('weather-card', 'authenticated')
    const registry = makeRegistry('weather-card', binding)
    // No authPlugin injected
    const svc = createAgentService({ getRegistry: () => registry })
    const res = (await svc.handleToolCall(
      'weather-card/fetchForecast',
      {},
      {
        userId: 'user-1',
        jwt: 'token-authenticated',
      },
    )) as { error: string; code: number }
    expect(res.code).toBe(401)
    expect(res.error).toContain('AUTH_MISSING')
  })

  it('no authPlugin + no scope → passes (only scope-guarded components fail-closed)', async () => {
    const binding = makeLiveBinding('weather-card', null) // no scope
    const registry = makeRegistry('weather-card', binding)
    const svc = createAgentService({ getRegistry: () => registry })
    const res = (await svc.handleToolCall(
      'weather-card/fetchForecast',
      {},
      {
        userId: 'user-1',
      },
    )) as { result: unknown }
    expect(res.result).toBeDefined()
  })
})

// ─── AC8: Rate-limit ─────────────────────────────────────────────────────────

describe('AC8 — rate-limit enforcement', () => {
  it('returns 429 after quota is exhausted', async () => {
    const binding = makeLiveBinding('weather-card', null, '2/min')
    const registry = makeRegistry('weather-card', binding)

    let callCount = 0
    const rateLimitPlugin: RateLimitPlugin = {
      checkRateLimit(_spec: string, _key: string): boolean {
        callCount++
        return callCount <= 2 // allow first 2, block on 3rd
      },
    }

    const authPlugin = makeVerifyingAuthPlugin({ 'signed-token': { sub: 'user-1' } })
    const svc = createAgentService({ getRegistry: () => registry, rateLimitPlugin, authPlugin })
    const ctx = { userId: 'user-1', jwt: 'signed-token' }

    const r1 = await svc.handleToolCall('weather-card/fetchForecast', {}, ctx)
    const r2 = await svc.handleToolCall('weather-card/fetchForecast', {}, ctx)
    const r3 = (await svc.handleToolCall('weather-card/fetchForecast', {}, ctx)) as {
      error: string
      code: number
    }

    expect((r1 as { result: unknown }).result).toBeDefined()
    expect((r2 as { result: unknown }).result).toBeDefined()
    expect(r3.code).toBe(429)
    expect(r3.error).toContain('RATE_LIMITED')
  })

  // ── The #420 pinning test, INVERTED, not deleted ──────────────────────────
  // This test used to assert `userId:tag` — pinning the caller-supplied
  // identity as the bucket key, i.e. pinning the vulnerability. It now pins
  // the fix: the key is `sub:tag` from the signature-VERIFIED principal, and
  // a caller-supplied userId that disagrees with the token is ignored.
  it('rate-limit key uses verified-sub:tag format — caller userId is not the key', async () => {
    const binding = makeLiveBinding('weather-card', null, '100/min')
    const registry = makeRegistry('weather-card', binding)

    const usedKeys: string[] = []
    const rateLimitPlugin: RateLimitPlugin = {
      checkRateLimit(_spec: string, key: string): boolean {
        usedKeys.push(key)
        return true
      },
    }

    const authPlugin = makeVerifyingAuthPlugin({ 'signed-token': { sub: 'verified-sub-7' } })
    const svc = createAgentService({ getRegistry: () => registry, rateLimitPlugin, authPlugin })
    // The caller CLAIMS to be user-42; the verified token says otherwise.
    await svc.handleToolCall(
      'weather-card/fetchForecast',
      {},
      { userId: 'user-42', jwt: 'signed-token' },
    )
    expect(usedKeys[0]).toBe('verified-sub-7:weather-card')
    expect(usedKeys[0]).not.toContain('user-42')
  })
})

// ─── AC14: Dispatch ordering invariant ───────────────────────────────────────

describe('AC14 — error ordering: 404 → 401 → 403 → 429', () => {
  it('rate-limited call with invalid scope → 403 not 429 (scope check before rate-limit)', async () => {
    const binding = makeLiveBinding('weather-card', 'authenticated', '1/min')
    const registry = makeRegistry('weather-card', binding)

    let rateLimitCalled = false
    const rateLimitPlugin: RateLimitPlugin = {
      checkRateLimit(): boolean {
        rateLimitCalled = true
        return false // would return 429
      },
    }
    // Token VERIFIES (so step 2 passes) but the scope check fails → 403.
    const authPlugin: AuthPlugin = makeVerifyingAuthPlugin(
      { 'no-scope-token': { sub: 'user-1' } },
      () => false, // invalid scope → 403
    )

    const svc = createAgentService({ getRegistry: () => registry, authPlugin, rateLimitPlugin })
    const res = (await svc.handleToolCall(
      'weather-card/fetchForecast',
      {},
      { userId: 'user-1', jwt: 'no-scope-token' },
    )) as { error: string; code: number }

    // Must be 403 (scope fail), NOT 429 (rate-limit)
    expect(res.code).toBe(403)
    // Rate-limit must NOT have been called (ordering invariant)
    expect(rateLimitCalled).toBe(false)
  })

  it('no live instance → 404 before userId check', async () => {
    const registry = new Map<string, LiveBinding[]>() // empty
    const svc = createAgentService({ getRegistry: () => registry })
    // No userId — but 404 must come first
    const res = (await svc.handleToolCall('weather-card/fetchForecast', {})) as {
      error: string
      code: number
    }
    expect(res.code).toBe(404)
  })
})

// ─── Backward compat: existing tests still pass ──────────────────────────────

describe('backward compat — Plan 5.2 behavior preserved', () => {
  it('createAgentService() with no options still returns a valid service', () => {
    const svc = createAgentService()
    expect(typeof svc.getManifest).toBe('function')
    expect(typeof svc.handleToolCall).toBe('function')
    expect(typeof svc.asMiddleware).toBe('function')
  })

  it('getManifest() still aggregates metadata', () => {
    const svc = createAgentService({
      manifests: [{ tag: 'x-counter', describes: 'A counter' }],
    })
    expect(svc.getManifest().tools).toHaveLength(1)
  })
})

// ─── GO1: rate limiting fails CLOSED ─────────────────────────────────────────
//
// Thesis §3: "capability, authority, and rate are declared per-member and
// enforced by the server", and the named failure mode "a declared control that
// silently no-ops when its plugin is absent".
//
// The gate used to read `if (rateLimitSpec !== null && rateLimitPlugin)`, so
// declaring `$rate-limit` and omitting the plugin made the whole branch
// unreachable and the call dispatched, silently unlimited.
//
// ANTI-AC11 CONSTRUCTION: every binding below is PERMISSIVE — its `callAction`
// succeeds for any name. `makeLiveBinding` throws `no action: …` for anything
// but `fetchForecast`, which the handler maps to a 404, so a test built on it
// can pass with NO server-side check at all by asserting the INVOKER's
// rejection. These assert the GATE's own envelope code (429 / 401), and pair
// every denial with a proof that the action did not run.
//
// BIDIRECTIONAL by construction: the `describe` blocks are under-enforcement
// (declared control must DENY when unenforceable) and over-enforcement
// (undeclared control must still DISPATCH). A fix that only satisfied the first
// would turn the gate into "deny everything" and is caught by the second.

/**
 * A binding whose `callAction` succeeds for ANY name and records that it ran.
 * If the gate lets a call through, `ran` flips — so "did the gate deny" is
 * answered by observed behaviour, not by a return shape alone.
 */
function makePermissiveRateBinding(
  tag: string,
  scopeStr: string | null,
  rateLimitStr: string | null,
): LiveBinding & { ran(): boolean } {
  let ran = false
  return {
    rootId: 1,
    tag,
    getSignal: () => undefined,
    setSignal: () => {},
    async callAction(name: string): Promise<unknown> {
      ran = true
      return { called: name }
    },
    scope: () => scopeStr,
    rateLimit: () => rateLimitStr,
    dispose$: () => true,
    ran: () => ran,
  }
}

describe('GO1 under-enforcement — a declared control with its plugin ABSENT must deny', () => {
  it('$rate-limit declared + rateLimitPlugin absent → 429 RATE_LIMIT_MISSING, action never runs', async () => {
    // Sanity, on a throwaway twin: the invoker itself would happily have run
    // this action, so any denial below can only have come from the gate.
    const twin = makePermissiveRateBinding('weather-card', null, '10/min')
    await expect(twin.callAction('fetchForecast', [])).resolves.toEqual({
      called: 'fetchForecast',
    })

    const binding = makePermissiveRateBinding('weather-card', null, '10/min')
    // No rateLimitPlugin. Pre-GO1 this dispatched, silently unlimited.
    // (#420: a verifying authPlugin + signed JWT are supplied so the gate
    // reaches step 4 and the denial measured is specifically the
    // rate-limit fail-closed, not the earlier 401 principal refusal.)
    const svc = createAgentService({
      getRegistry: () => makeRegistry('weather-card', binding),
      authPlugin: makeVerifyingAuthPlugin({ 'signed-token': { sub: 'user-1' } }),
    })

    const res = (await svc.handleToolCall('weather-card/fetchForecast', [], {
      userId: 'user-1',
      jwt: 'signed-token',
    })) as { error: string; code: number }

    expect(res.code).toBe(429)
    expect(res.error).toContain('RATE_LIMIT_MISSING')
    // The control did not merely report a denial — it prevented execution.
    expect(binding.ran()).toBe(false)
  })

  it('$scope declared + authPlugin absent → 401 AUTH_MISSING (the posture GO1 mirrors)', async () => {
    const binding = makePermissiveRateBinding('weather-card', 'admin', null)
    const svc = createAgentService({ getRegistry: () => makeRegistry('weather-card', binding) })

    const res = (await svc.handleToolCall('weather-card/fetchForecast', [], {
      userId: 'user-1',
      jwt: 'j',
    })) as { error: string; code: number }

    expect(res.code).toBe(401)
    expect(res.error).toContain('AUTH_MISSING')
    expect(binding.ran()).toBe(false)
  })

  it('the two absent-plugin denials are DISTINCT codes, not one blanket rule', async () => {
    const rateOnly = makePermissiveRateBinding('weather-card', null, '10/min')
    const scopeOnly = makePermissiveRateBinding('weather-card', 'admin', null)

    const rateRes = (await createAgentService({
      getRegistry: () => makeRegistry('weather-card', rateOnly),
      authPlugin: makeVerifyingAuthPlugin({ 'signed-token': { sub: 'u1' } }),
    }).handleToolCall('weather-card/fetchForecast', [], {
      userId: 'u1',
      jwt: 'signed-token',
    })) as { code: number }
    const scopeRes = (await createAgentService({
      getRegistry: () => makeRegistry('weather-card', scopeOnly),
    }).handleToolCall('weather-card/fetchForecast', [], { userId: 'u1', jwt: 'j' })) as {
      code: number
    }

    // Each declaration is enforced on its own terms. Identical codes would mean
    // the gate collapsed both controls into a single "declared ⇒ deny" rule.
    expect(rateRes.code).toBe(429)
    expect(scopeRes.code).toBe(401)
    expect(rateRes.code).not.toBe(scopeRes.code)
  })
})

describe('GO1 over-enforcement — a control that is NOT declared must still dispatch', () => {
  it('no $rate-limit, no plugin → dispatches normally', async () => {
    const binding = makePermissiveRateBinding('weather-card', null, null)
    const svc = createAgentService({ getRegistry: () => makeRegistry('weather-card', binding) })

    const res = (await svc.handleToolCall('weather-card/fetchForecast', [], {
      userId: 'user-1',
    })) as { result: unknown; code?: number }

    expect(res.code).toBeUndefined()
    expect(res.result).toEqual({ called: 'fetchForecast' })
    expect(binding.ran()).toBe(true)
  })

  it('no $rate-limit and no $scope and NO request context at all → still dispatches', async () => {
    // The unscoped/unlimited path must stay reachable by adapters that carry no
    // auth context (a2a/acp, v0.3.0 back-compat). Requiring a userId here would
    // be over-enforcement of a control nobody declared.
    const binding = makePermissiveRateBinding('weather-card', null, null)
    const svc = createAgentService({ getRegistry: () => makeRegistry('weather-card', binding) })

    const res = (await svc.handleToolCall('weather-card/fetchForecast', [])) as {
      result: unknown
      code?: number
    }

    expect(res.code).toBeUndefined()
    expect(binding.ran()).toBe(true)
  })

  it('$rate-limit declared WITH a permissive plugin → dispatches (declared ≠ denied)', async () => {
    const binding = makePermissiveRateBinding('weather-card', null, '10/min')
    const rateLimitPlugin: RateLimitPlugin = { checkRateLimit: () => true }
    const svc = createAgentService({
      getRegistry: () => makeRegistry('weather-card', binding),
      rateLimitPlugin,
      authPlugin: makeVerifyingAuthPlugin({ 'signed-token': { sub: 'user-1' } }),
    })

    const res = (await svc.handleToolCall('weather-card/fetchForecast', [], {
      userId: 'user-1',
      jwt: 'signed-token',
    })) as { result: unknown; code?: number }

    expect(res.code).toBeUndefined()
    expect(binding.ran()).toBe(true)
  })

  it('fail-closed did not displace the ordering invariant: 403 still beats 429', async () => {
    // A scoped + rate-limited component with NEITHER plugin must report the
    // scope failure (401), not the rate-limit one — Step 3 precedes Step 4.
    const binding = makePermissiveRateBinding('weather-card', 'admin', '10/min')
    const svc = createAgentService({ getRegistry: () => makeRegistry('weather-card', binding) })

    const res = (await svc.handleToolCall('weather-card/fetchForecast', [], {
      userId: 'u1',
      jwt: 'j',
    })) as { code: number; error: string }

    expect(res.code).toBe(401)
    expect(res.error).toContain('AUTH_MISSING')
  })
})
