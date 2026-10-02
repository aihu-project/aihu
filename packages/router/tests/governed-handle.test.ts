/**
 * GX Phase 4 (#466) — the governed data-access boundary, end to end through
 * `createServerRouter(routes, { governed }).handle`.
 * Spec: docs/plans/governed-extractability/70-governed-data-access.md §6.
 *
 * G7a — generation via fixture (withheld vs entitled; provider spy; E3 parity)
 * G7b — live delta both axes from ONE fixture registry
 * G7c — fail-closed ladder (throw/timeout → 503; post-grant → 500; byte-scan)
 * G7e — revocation composition (verify-path upstream; onRevoke purge)
 * G7f — attenuation preserved (the live layer never widens)
 * G7i — escape hatch (defineGovernedFetch; C486 backstop; W48x/T4 fallback)
 * G7j — no-registry byte-identical regression
 */

import type { AuthPlugin, LiveBinding, VerifiedClaims } from '@aihu/agent-service'
import { createAgentService } from '@aihu/agent-service'
import type { GovernedRegistry } from '@aihu/server'
import { createGovernedRegistry, defineGovernedFetch } from '@aihu/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RouteDefinition } from '../src/index.ts'
import { createServerRouter } from '../src/server.ts'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SECRET_SENSES = 'GOVERNED-SECRET-SENSES-BYTES'
const HEADWORD = 'λόγος'

/** Verified-token registry: token string → claims. Revocation = delete. */
const tokens = new Map<string, VerifiedClaims>()

const authPlugin: AuthPlugin = {
  checkScope: (jwt, scope) => {
    const claims = tokens.get(jwt)
    if (!claims) return false
    const scopes = typeof claims.scope === 'string' ? claims.scope.split(' ') : []
    return scopes.includes(scope)
  },
  verify: async (jwt) => tokens.get(jwt) ?? null,
}

function route(
  pattern: string,
  extra: Partial<RouteDefinition> & { module: RouteDefinition['module'] },
): RouteDefinition {
  return {
    pattern,
    segments: pattern
      .split('/')
      .filter(Boolean)
      .map((p) =>
        p.startsWith(':')
          ? { kind: 'param' as const, name: p.slice(1) }
          : { kind: 'static' as const, path: p },
      ),
    ...extra,
  }
}

function pageModule(): { default: { toHtml(): string } } {
  return { default: { toHtml: () => '<div>lexicon page</div>' } }
}

interface Fixture {
  registry: GovernedRegistry
  fetch: ReturnType<typeof vi.fn>
  preview: ReturnType<typeof vi.fn>
  resolve: ReturnType<typeof vi.fn>
  entitledSubs: Set<string>
  router: ReturnType<typeof createServerRouter>
}

function makeFixture(overrides?: {
  resolver?: (ctx: { principal: { sub: string } }) => Promise<boolean>
  cacheTtlMs?: number
  moduleLoader?: RouteDefinition['module']
}): Fixture {
  const entitledSubs = new Set<string>(['member-1'])
  const fetch = vi.fn(async () => ({ headword: HEADWORD, senses: SECRET_SENSES }))
  const preview = vi.fn(async () => ({ headword: HEADWORD }))
  const resolve = vi.fn(
    overrides?.resolver ?? (async ({ principal }) => entitledSubs.has(principal.sub)),
  )
  const registry = createGovernedRegistry()
    .provider('LexiconEntry', { fetch, preview })
    .entitlement('members', {
      resolve,
      timeoutMs: 50,
      ...(overrides?.cacheTtlMs !== undefined ? { cache: { ttlMs: overrides.cacheTtlMs } } : {}),
    })
  const routes = [
    route('/lexicon/:slug', {
      module: overrides?.moduleLoader ?? (() => Promise.resolve(pageModule())),
      extract: { read: { scope: 'members' }, call: { scope: 'members' } },
      data: { type: 'LexiconEntry', preview: ['headword'] },
    }),
    route('/public', {
      module: () =>
        Promise.resolve({
          default: { toHtml: () => '<div>public</div>' },
          loader: async () => ({ hello: 'world' }),
        }),
      extract: { read: 'all', call: 'anonymous' },
    }),
  ]
  const router = createServerRouter(routes, { governed: registry, auth: { authPlugin } })
  return { registry, fetch, preview, resolve, entitledSubs, router }
}

function loaderPayload(body: string): unknown {
  const m = body.match(/<script type="application\/json" id="__aihu_loader__">(.*?)<\/script>/s)
  expect(m, 'expected an __aihu_loader__ embed').not.toBeNull()
  return JSON.parse(m![1]!)
}

function req(path: string, jwt?: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
  })
}

beforeEach(() => {
  tokens.clear()
  tokens.set('member-token', { sub: 'member-1', scope: 'members' })
  tokens.set('lapsed-token', { sub: 'lapsed-9', scope: 'members' })
  tokens.set('attenuated-token', { sub: 'member-1', scope: 'read:other' })
})

// ─── G7a — generation via fixture ────────────────────────────────────────────

describe('G7a — the generated loader serves the governed route', () => {
  it('anonymous → withheld shape, 401, preview only, provider NEVER invoked', async () => {
    const fx = makeFixture()
    const res = await fx.router.handle(req('/lexicon/hello'))
    expect(res.status).toBe(401)
    const body = await res.text()
    const payload = loaderPayload(body) as {
      $gx: { entitled: boolean; reason: string }
      preview?: { headword?: string }
    }
    expect(payload.$gx).toEqual({ entitled: false, reason: 'auth' })
    expect(payload.preview).toEqual({ headword: HEADWORD })
    expect(body).not.toContain(SECRET_SENSES) // no governed bytes, ever
    expect(fx.fetch).not.toHaveBeenCalled() // assert via provider spy
    expect(fx.preview).toHaveBeenCalledTimes(1)
    // Governed response discipline (spec §3.2 step 5):
    expect(res.headers.get('Cache-Control')).toBe('private')
    expect(res.headers.get('Vary')).toBe('Authorization, Cookie')
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex')
  })

  it('entitled member → full data with $gx.entitled, 200', async () => {
    const fx = makeFixture()
    const res = await fx.router.handle(req('/lexicon/hello', 'member-token'))
    expect(res.status).toBe(200)
    const payload = loaderPayload(await res.text()) as Record<string, unknown>
    expect(payload).toEqual({
      headword: HEADWORD,
      senses: SECRET_SENSES,
      $gx: { entitled: true },
    })
    expect(fx.fetch).toHaveBeenCalledTimes(1)
  })

  it('G7g runtime half: the withheld payload contains NO key of T beyond declared preview', async () => {
    const fx = makeFixture()
    const res = await fx.router.handle(req('/lexicon/hello'))
    const payload = loaderPayload(await res.text()) as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(['$gx', 'preview'])
    expect(Object.keys(payload.preview as object)).toEqual(['headword'])
  })

  it('denied data never appears in rendered HTML or route loader metadata', async () => {
    const fx = makeFixture()
    const res = await fx.router.handle(req('/lexicon/hello'))
    const html = await res.text()
    const payload = loaderPayload(html) as Record<string, unknown>
    expect(html).not.toContain(SECRET_SENSES)
    expect(payload).toEqual({
      preview: { headword: HEADWORD },
      $gx: { entitled: false, reason: 'auth' },
    })
    expect(Object.keys(payload).sort()).toEqual(['$gx', 'preview'])
  })

  it('E3 endpoint transport parity: identical decisions, JSON transport', async () => {
    const fx = makeFixture()
    const anon = await fx.router.handle(req('/__aihu/data/lexicon/hello'))
    expect(anon.status).toBe(401)
    expect(anon.headers.get('Cache-Control')).toBe('private')
    const anonBody = (await anon.json()) as { $gx: { entitled: boolean; reason: string } }
    expect(anonBody.$gx).toEqual({ entitled: false, reason: 'auth' })
    expect(JSON.stringify(anonBody)).not.toContain(SECRET_SENSES)

    const entitled = await fx.router.handle(req('/__aihu/data/lexicon/hello', 'member-token'))
    expect(entitled.status).toBe(200)
    expect(await entitled.json()).toEqual({
      headword: HEADWORD,
      senses: SECRET_SENSES,
      $gx: { entitled: true },
    })
  })

  it('the E3 endpoint never serves ungoverned routes (no second data path)', async () => {
    const fx = makeFixture()
    const res = await fx.router.handle(req('/__aihu/data/public'))
    expect(res.status).toBe(404)
  })
})

// ─── G7b — the live delta, both axes, ONE fixture registry ───────────────────

describe('G7b — token carries the scope, resolver says no (the static-scope hole)', () => {
  function callAxisService(fx: Fixture) {
    const binding: LiveBinding = {
      rootId: 1,
      tag: 'lexicon-tool',
      getSignal: () => undefined,
      setSignal: () => {},
      callAction: async () => 'called',
      scope: () => 'members',
      rateLimit: () => null,
      dispose$: () => true,
    }
    return createAgentService({
      manifests: [
        {
          tag: 'lexicon-tool',
          actions: { lookup: { params: [] } },
          extract: { read: { scope: 'members' }, call: { scope: 'members' } },
        } as never,
      ],
      authPlugin,
      getRegistry: () => new Map([['lexicon-tool', [binding]]]),
      entitlements: fx.registry, // the SAME instance as the read axis
    })
  }

  it("read axis: withheld reason 'entitlement', 403", async () => {
    const fx = makeFixture()
    const res = await fx.router.handle(req('/lexicon/hello', 'lapsed-token'))
    expect(res.status).toBe(403)
    const payload = loaderPayload(await res.text()) as { $gx: { reason: string } }
    expect(payload.$gx).toEqual({ entitled: false, reason: 'entitlement' })
    expect(fx.fetch).not.toHaveBeenCalled()
  })

  it('call axis: ENTITLEMENT_DENIED 403 through the SAME registry', async () => {
    const fx = makeFixture()
    const service = callAxisService(fx)
    const out = (await service.handleToolCall('lexicon-tool/lookup', null, {
      userId: null,
      jwt: 'lapsed-token',
    })) as { code?: number; error?: string }
    expect(out.code).toBe(403)
    expect(out.error).toMatch(/ENTITLEMENT_DENIED/)

    // …and the entitled member still calls through.
    const ok = (await service.handleToolCall('lexicon-tool/lookup', null, {
      userId: null,
      jwt: 'member-token',
    })) as { result?: unknown }
    expect(ok.result).toBe('called')
  })

  it('call axis: resolver outage → 503 ENTITLEMENT_UNAVAILABLE (never a verdict)', async () => {
    const fx = makeFixture({
      resolver: async () => {
        throw new Error('billing down')
      },
    })
    const service = callAxisService(fx)
    const out = (await service.handleToolCall('lexicon-tool/lookup', null, {
      userId: null,
      jwt: 'member-token',
    })) as { code?: number; error?: string; retryAfter?: number }
    expect(out.code).toBe(503)
    expect(out.error).toMatch(/ENTITLEMENT_UNAVAILABLE/)
    expect(out.retryAfter).toBe(30)
  })
})

// ─── G7c — fail-closed ladder ────────────────────────────────────────────────

describe('G7c — fail-closed, honestly labeled', () => {
  it("resolver throw → withheld 'unavailable', 503 + Retry-After; nothing fetched", async () => {
    const fx = makeFixture({
      resolver: async () => {
        throw new Error('billing down')
      },
    })
    const res = await fx.router.handle(req('/lexicon/hello', 'member-token'))
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('30')
    const body = await res.text()
    expect((loaderPayload(body) as { $gx: { reason: string } }).$gx.reason).toBe('unavailable')
    expect(body).not.toContain(SECRET_SENSES)
    expect(fx.fetch).not.toHaveBeenCalled()
  })

  it("resolver deadline exceeded → the same 'unavailable' shape (timeout ≡ throw)", async () => {
    const fx = makeFixture({ resolver: () => new Promise<boolean>(() => {}) })
    const res = await fx.router.handle(req('/lexicon/hello', 'member-token'))
    expect(res.status).toBe(503)
    const payload = loaderPayload(await res.text()) as { $gx: { reason: string } }
    expect(payload.$gx.reason).toBe('unavailable')
    expect(fx.fetch).not.toHaveBeenCalled()
  })

  it('provider throw AFTER grant → 500 error state, never a withheld shape, no bytes', async () => {
    const fx = makeFixture()
    fx.fetch.mockRejectedValueOnce(new Error('db down'))
    const res = await fx.router.handle(req('/lexicon/hello', 'member-token'))
    expect(res.status).toBe(500)
    const body = await res.text()
    expect(body).not.toContain(SECRET_SENSES) // byte-scan, E6 style
    expect(body).not.toContain('__aihu_loader__') // no withheld/locked shape either
    expect(body).not.toContain('entitled')
  })

  it('byte-scan across every failure path: governed bytes never appear', async () => {
    // auth (anonymous), scope (attenuated), entitlement (lapsed):
    const fx = makeFixture()
    for (const jwt of [undefined, 'attenuated-token', 'lapsed-token']) {
      const res = await fx.router.handle(req('/lexicon/hello', jwt))
      expect(await res.text()).not.toContain(SECRET_SENSES)
    }
    expect(fx.fetch).not.toHaveBeenCalled()
  })
})

// ─── G7e — revocation composition ────────────────────────────────────────────

describe('G7e — revocation composes with the entitlement cache', () => {
  it('a revoked credential resolves anonymous upstream; the warm cache is unreachable', async () => {
    const fx = makeFixture({ cacheTtlMs: 60_000 })
    // Warm the positive cache.
    const first = await fx.router.handle(req('/lexicon/hello', 'member-token'))
    expect(first.status).toBe(200)
    expect(fx.resolve).toHaveBeenCalledTimes(1)
    const statsBefore = fx.registry.stats()

    // Revoke the CREDENTIAL (the verify-path consult — upstream of step 2).
    tokens.delete('member-token')
    const res = await fx.router.handle(req('/lexicon/hello', 'member-token'))
    expect(res.status).toBe(401)
    const payload = loaderPayload(await res.text()) as { $gx: { reason: string } }
    expect(payload.$gx.reason).toBe('auth')
    // The entitlement layer was never consulted on the anonymous path:
    expect(fx.resolve).toHaveBeenCalledTimes(1)
    expect(fx.registry.stats().cacheReads).toBe(statsBefore.cacheReads) // zero cache reads
  })

  it('onRevoke(sub) purges the warm entry: next entitled request re-resolves live', async () => {
    const fx = makeFixture({ cacheTtlMs: 60_000 })
    await fx.router.handle(req('/lexicon/hello', 'member-token'))
    expect(fx.resolve).toHaveBeenCalledTimes(1)
    // Within TTL a second request rides the cache:
    await fx.router.handle(req('/lexicon/hello', 'member-token'))
    expect(fx.resolve).toHaveBeenCalledTimes(1)

    fx.registry.onRevoke('member-1')
    const res = await fx.router.handle(req('/lexicon/hello', 'member-token'))
    expect(res.status).toBe(200)
    expect(fx.resolve).toHaveBeenCalledTimes(2) // re-resolved live
  })
})

// ─── G7f — attenuation preserved ─────────────────────────────────────────────

describe('G7f — the live layer never widens', () => {
  it('a delegated token minted WITHOUT the scope is refused at the static meet', async () => {
    const fx = makeFixture() // member-1 IS entitled (resolver would say true)
    const res = await fx.router.handle(req('/lexicon/hello', 'attenuated-token'))
    expect(res.status).toBe(403)
    const payload = loaderPayload(await res.text()) as { $gx: { reason: string } }
    expect(payload.$gx.reason).toBe('scope')
    expect(fx.resolve).not.toHaveBeenCalled() // never consulted — C3/R3 at this boundary
    expect(fx.fetch).not.toHaveBeenCalled()
  })
})

// ─── G7i — escape hatch & fallbacks ──────────────────────────────────────────

describe('G7i — defineGovernedFetch replaces the provider stage ONLY', () => {
  function escapeHatchModule() {
    const fetch = vi.fn(async () => ({ headword: HEADWORD, senses: SECRET_SENSES }))
    const preview = vi.fn(async () => ({ headword: HEADWORD }))
    const mod = {
      ...pageModule(),
      loader: defineGovernedFetch<{ headword: string; senses: string }>({ fetch, preview }),
    }
    return { fetch, preview, module: () => Promise.resolve(mod) }
  }

  it('G7a/b/c hold unchanged through the escape hatch (the gate is identical)', async () => {
    const hatch = escapeHatchModule()
    const fx = makeFixture({ moduleLoader: hatch.module as never })

    // a: anonymous — withheld, hatch fetch never invoked, hatch preview runs.
    const anon = await fx.router.handle(req('/lexicon/hello'))
    expect(anon.status).toBe(401)
    expect(hatch.fetch).not.toHaveBeenCalled()
    expect(hatch.preview).toHaveBeenCalledTimes(1)
    expect(fx.fetch).not.toHaveBeenCalled() // registry provider fully replaced

    // b: live delta — lapsed member withheld 'entitlement'.
    const lapsed = await fx.router.handle(req('/lexicon/hello', 'lapsed-token'))
    expect(lapsed.status).toBe(403)
    expect(hatch.fetch).not.toHaveBeenCalled()

    // entitled — full data through the hatch.
    const ok = await fx.router.handle(req('/lexicon/hello', 'member-token'))
    expect(ok.status).toBe(200)
    expect(loaderPayload(await ok.text())).toEqual({
      headword: HEADWORD,
      senses: SECRET_SENSES,
      $gx: { entitled: true },
    })
    expect(hatch.fetch).toHaveBeenCalledTimes(1)

    // c: post-grant hatch failure — error state, no bytes.
    hatch.fetch.mockRejectedValueOnce(new Error('assembly failed'))
    const err = await fx.router.handle(req('/lexicon/hello', 'member-token'))
    expect(err.status).toBe(500)
    expect(await err.text()).not.toContain(SECRET_SENSES)
  })

  it('C486 runtime backstop: data: + a PLAIN loader refuses to serve (500, nothing invoked)', async () => {
    const plainLoader = vi.fn(async () => ({ senses: SECRET_SENSES }))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const fx = makeFixture({
        moduleLoader: (() => Promise.resolve({ ...pageModule(), loader: plainLoader })) as never,
      })
      const res = await fx.router.handle(req('/lexicon/hello', 'member-token'))
      expect(res.status).toBe(500)
      expect(await res.text()).not.toContain(SECRET_SENSES)
      expect(plainLoader).not.toHaveBeenCalled()
      expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/C486/))
    } finally {
      errSpy.mockRestore()
    }
  })

  it('W48x/T4 fallback: a plain loader on a hard-read route (no data:) is withheld route-level from anonymous', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const registry = createGovernedRegistry().entitlement('reports:read', 'token-only')
      const routes = [
        route('/reports', {
          module: () =>
            Promise.resolve({
              default: { toHtml: () => '<div>reports</div>' },
              loader: async () => ({ rows: SECRET_SENSES }),
            }),
          extract: { read: { scope: 'reports:read' }, call: 'anonymous' },
        }),
      ]
      const router = createServerRouter(routes, { governed: registry, auth: { authPlugin } })

      // Anonymous: rendered page, NO loader output (T4 holds).
      const anon = await router.handle(req('/reports'))
      const anonBody = await anon.text()
      expect(anonBody).toContain('<div>reports</div>')
      expect(anonBody).not.toContain(SECRET_SENSES)
      expect(anonBody).not.toContain('__aihu_loader__')
      expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/W487/))

      // A principal passing the route read still gets the loader output.
      tokens.set('reports-token', { sub: 'analyst-1', scope: 'reports:read' })
      const ok = await router.handle(req('/reports', 'reports-token'))
      expect(await ok.text()).toContain(SECRET_SENSES)
    } finally {
      warnSpy.mockRestore()
    }
  })
})

// ─── G7d (transport view) — one request, one resolver call ───────────────────

describe('G7d — memo & cache counts through the transport', () => {
  it('one SSR request costs exactly one resolver call; TTL makes the second free', async () => {
    const fx = makeFixture({ cacheTtlMs: 60_000 })
    await fx.router.handle(req('/lexicon/hello', 'member-token'))
    expect(fx.resolve).toHaveBeenCalledTimes(1)
    await fx.router.handle(req('/lexicon/hello', 'member-token'))
    expect(fx.resolve).toHaveBeenCalledTimes(1) // cache hit, zero resolves
    expect(fx.registry.stats().cacheHits).toBe(1)
  })
})

// ─── G7j — no-registry byte-identical regression ─────────────────────────────

describe('G7j — an app with no registry and no data: is byte-identical', () => {
  function legacyRoutes(): RouteDefinition[] {
    return [
      route('/public', {
        module: () =>
          Promise.resolve({
            default: { toHtml: () => '<div>public</div>' },
            loader: async () => ({ hello: 'world' }),
          }),
        extract: { read: 'all', call: 'anonymous' },
      }),
      route('/members-page', {
        module: () => Promise.resolve({ default: { toHtml: () => '<div>hard</div>' } }),
        extract: { read: { scope: 'members' }, call: 'anonymous' },
      }),
    ]
  }

  it('single-arg construction still works and serves exactly the pre-P4 bytes', async () => {
    const router = createServerRouter(legacyRoutes())
    const res = await router.handle(req('/public'))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(
      '<div>public</div><script type="application/json" id="__aihu_loader__">{"hello":"world"}</script>',
    )
    expect(res.headers.get('Cache-Control')).toBeNull()
    expect(res.headers.get('Vary')).toBeNull()

    // Hard-read route WITHOUT a registry: Phase 3 semantics exactly — full
    // body served, advisory noindex only.
    const hard = await router.handle(req('/members-page'))
    expect(hard.status).toBe(200)
    expect(await hard.text()).toContain('<div>hard</div>')
    expect(hard.headers.get('X-Robots-Tag')).toBe('noindex')
  })

  it('the E3 prefix is inert without a registry (no reserved namespace appears)', async () => {
    const router = createServerRouter(legacyRoutes())
    const res = await router.handle(req('/__aihu/data/public'))
    expect(res.status).toBe(404) // plain no-match, not the governed endpoint
    expect(await res.text()).toBe('Not Found')
  })
})

// ─── G7k — the loader embed cannot be used to break out of its <script> ─────
//
// Regression for a stored-XSS gap: both the governed and ungoverned loader
// embeds used to interpolate JSON.stringify(data) straight into the response
// HTML. JSON.stringify does not escape `<`/`>`, so data containing a literal
// `</script>` (plausible the moment a loader reads from D1/KV/R2, or any
// other source an attacker can influence) closed the script block early and
// turned everything after it into live markup.

const XSS_PAYLOAD = '</script><img src=x onerror=alert(1)>'

describe('G7k — the loader embed cannot be used to break out of its <script>', () => {
  it('ungoverned arm: a loader value containing </script> does not terminate the block', async () => {
    const routes = [
      route('/evil', {
        module: () =>
          Promise.resolve({
            default: { toHtml: () => '<div>page</div>' },
            loader: async () => ({ comment: XSS_PAYLOAD }),
          }),
        extract: { read: 'all', call: 'anonymous' },
      }),
    ]
    const router = createServerRouter(routes)
    const res = await router.handle(req('/evil'))
    const body = await res.text()

    expect(body).not.toContain('</script><img') // the raw breakout string
    expect(loaderPayload(body)).toEqual({ comment: XSS_PAYLOAD }) // client still gets it exactly
  })

  it('governed arm: entitled data containing </script> does not terminate the block', async () => {
    // Built standalone rather than via makeFixture(): the shared fixture's
    // `fetch` is hardcoded to SECRET_SENSES, which contains no `<`/`>` and so
    // can't exercise this fix. This mirrors makeFixture()'s wiring exactly,
    // with a malicious provider response instead.
    const registry = createGovernedRegistry()
      .provider('LexiconEntry', {
        fetch: async () => ({ headword: HEADWORD, senses: XSS_PAYLOAD }),
        preview: async () => ({ headword: HEADWORD }),
      })
      .entitlement('members', { resolve: async () => true, timeoutMs: 50 })
    const routes = [
      route('/lexicon/:slug', {
        module: () => Promise.resolve(pageModule()),
        extract: { read: { scope: 'members' }, call: { scope: 'members' } },
        data: { type: 'LexiconEntry', preview: ['headword'] },
      }),
    ]
    const router = createServerRouter(routes, { governed: registry, auth: { authPlugin } })
    const res = await router.handle(req('/lexicon/hello', 'member-token'))
    const body = await res.text()

    expect(body).not.toContain('</script><img')
    const payload = loaderPayload(body) as { senses: string }
    expect(payload.senses).toBe(XSS_PAYLOAD) // round-trips through JSON.parse unchanged
  })
})
