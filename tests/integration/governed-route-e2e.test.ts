// @vitest-environment node
/**
 * GX Phase 4 (#466) — the INTEGRATION seam between the two halves:
 *
 *   compiler half (this branch): `@route { data: }` → `.route.json` census +
 *     a server artifact whose `__ssr` accepts `{ route: { params, data } }`;
 *   gate engine (merged #472): `createServerRouter(routes, { governed })`
 *     runs the generated loader and emits `Entitled<T>` / `Withheld<T>`.
 *
 * This file drives the REAL pipeline end to end: Rust binary compiles the
 * governed conformance fixture (`--target server --expr-parser ast` AND
 * `--route-json` for the census) → the artifact is imported DOM-less → a
 * governed registry with a resolver we control is wired into
 * `createServerRouter` → `handle(req)` is driven for entitled / anonymous /
 * lapsed principals — and the RESPONSE BYTES are asserted, not the parts.
 *
 * The seam this exists to hold (the P4 integration fix): the governed handle
 * path must thread the settled emission into the render —
 * `mod.default({ route: { params, data: emission.data } })` — so an entitled
 * principal's HTML actually carries the governed content server-side
 * (dual-audience: reachable without JS) and a withheld principal's HTML
 * renders the declared preview. Before the fix the emission reached only the
 * `__aihu_loader__` JSON and the HTML rendered against `route.data ===
 * undefined`.
 *
 * PROMOTED (#465): the structural SSR walk landed, so the fixture's
 * `<section class="gx-senses">` — the entitled-only `if=` group — IS now
 * required in the entitled server HTML (dual-audience: the guarded content is
 * reachable without JS), and the withheld `else` group (`gx-locked`) renders
 * for withheld principals. The `senses` byte-scan is now load-bearing over
 * BOTH channels: present in entitled HTML, byte-absent from every withheld
 * response (HTML and loader JSON alike — the E6-style hard sentinel).
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AuthPlugin, LiveBinding, VerifiedClaims } from '@aihu/agent-service'
import { createAgentService } from '@aihu/agent-service'
import { createGovernedRegistry } from '@aihu/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RouteDefinition, RouteSegment } from '../../packages/router/src/router.ts'
import { createServerRouter } from '../../packages/router/src/server.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')

const BINARY = ['target/release/aihu-compile', 'target/debug/aihu-compile']
  .map((p) => join(repoRoot, p))
  .find((p) => existsSync(p))

const FIXTURE = join(repoRoot, 'bench/compiler-conformance/route/04-governed-data.aihu')
const SCRATCH = join(__dirname, '.scratch-governed-e2e')

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true })
})

// ─── Compile the fixture through the real binary ────────────────────────────

function compileServerArtifact(src: string): string {
  return execFileSync(
    BINARY!,
    [
      '--stdin',
      '--tag',
      'governed-lexicon-e2e',
      '--path',
      'src/pages/04-governed-data.aihu',
      '--target',
      'server',
      '--expr-parser',
      'ast',
    ],
    { input: src, encoding: 'utf8' },
  )
}

/** The REAL compiled census row — `.route.json` verbatim from the binary. */
function compileRouteJson(src: string): {
  pattern: string
  extract?: { read?: unknown; call?: unknown }
  data?: unknown
} {
  const out = execFileSync(
    BINARY!,
    [
      '--stdin',
      '--tag',
      'governed-lexicon-e2e',
      '--path',
      'src/pages/04-governed-data.aihu',
      '--route-json',
    ],
    { input: src, encoding: 'utf8' },
  )
  return JSON.parse(out)
}

/** Emitted artifacts import bare `@aihu/*`; pin them to workspace sources
 * (same rationale as tests/integration/server-emission-ssr.test.ts). */
function withResolvedImports(code: string): string {
  return code.replaceAll("'@aihu/runtime'", `'${repoRoot}/packages/runtime/src/index.ts'`)
}

async function importServerArtifact(name: string, code: string): Promise<Record<string, unknown>> {
  mkdirSync(SCRATCH, { recursive: true })
  const file = join(SCRATCH, `${name}.ts`)
  writeFileSync(file, withResolvedImports(code))
  return (await import(/* @vite-ignore */ file)) as Record<string, unknown>
}

/** `.route.json` file-pattern (`/lexicon/[slug]`) → router segments — the
 * same lowering the vite plugin's `segs()` performs on generated route defs. */
function segmentsOf(pattern: string): RouteSegment[] {
  return pattern
    .split('/')
    .filter(Boolean)
    .map((p) =>
      p.startsWith('[') && p.endsWith(']')
        ? ({ kind: 'param', name: p.slice(1, -1) } as const)
        : ({ kind: 'static', path: p } as const),
    )
}

// ─── Principals & registry (resolver under test control) ────────────────────

const SECRET_SENSES = 'GOVERNED-SECRET-SENSES-BYTES'
const ENTITLED_HEADWORD = 'logos-headword'
const PREVIEW_HEADWORD = 'preview-headword'

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

beforeEach(() => {
  tokens.clear()
  tokens.set('member-token', { sub: 'member-1', scope: 'members' })
  tokens.set('lapsed-token', { sub: 'lapsed-9', scope: 'members' })
})

function req(path: string, jwt?: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
  })
}

interface Fx {
  router: ReturnType<typeof createServerRouter>
  registry: ReturnType<typeof createGovernedRegistry>
  fetch: ReturnType<typeof vi.fn>
  preview: ReturnType<typeof vi.fn>
}

async function makeFixture(): Promise<Fx> {
  const src = readFileSync(FIXTURE, 'utf8')
  const census = compileRouteJson(src)
  const mod = await importServerArtifact('governed-lexicon-e2e.server', compileServerArtifact(src))
  expect(typeof mod.default, 'compiled server artifact must default-export __ssr').toBe('function')

  const fetch = vi.fn(async () => ({ headword: ENTITLED_HEADWORD, senses: [SECRET_SENSES] }))
  const preview = vi.fn(async () => ({ headword: PREVIEW_HEADWORD }))
  const registry = createGovernedRegistry()
    .provider('LexiconEntry', { fetch, preview })
    .entitlement('members', {
      resolve: async ({ principal }) => principal.sub === 'member-1',
      timeoutMs: 50,
    })

  // Route def built from the REAL compiled census (extract + data verbatim).
  const routes: RouteDefinition[] = [
    {
      pattern: census.pattern,
      segments: segmentsOf(census.pattern),
      module: () => Promise.resolve(mod as never),
      extract: census.extract,
      data: census.data,
    },
  ]
  const router = createServerRouter(routes, { governed: registry, auth: { authPlugin } })
  return { router, registry, fetch, preview }
}

function htmlOf(body: string): string {
  return body.replace(/<script type="application\/json" id="__aihu_loader__">.*<\/script>/s, '')
}

function loaderJsonOf(body: string): unknown {
  const m = body.match(/<script type="application\/json" id="__aihu_loader__">(.*?)<\/script>/s)
  expect(m, 'expected an __aihu_loader__ embed').not.toBeNull()
  return JSON.parse(m![1]!)
}

// ─── The end-to-end property ────────────────────────────────────────────────

describe.skipIf(!BINARY)('GX P4 e2e — compiled governed route through handle(req)', () => {
  it('entitled principal: the governed content is IN the server HTML (dual-audience)', async () => {
    const fx = await makeFixture()
    const res = await fx.router.handle(req('/lexicon/logos', 'member-token'))
    expect(res.status).toBe(200)
    const body = await res.text()
    const html = htmlOf(body)

    // THE integration property: the emission is threaded into the render —
    // the entitled payload is server-rendered, reachable without JS.
    expect(html).toContain(`>${ENTITLED_HEADWORD}</h1>`)
    expect(html).toContain('gx-headword')
    expect(html).toContain('>logos</p>') // route.params threaded too

    // #465 PROMOTION: the `if={$gx.entitled}`-guarded group is now
    // server-rendered — the guarded governed content is IN the entitled HTML,
    // not just the loader JSON. This was the honest-ceiling caveat; it is now
    // load-bearing.
    expect(html).toContain('gx-senses')
    expect(html).toContain(`>${SECRET_SENSES}</section>`)
    // The else arm must NOT render for an entitled principal.
    expect(html).not.toContain('gx-locked')

    // The loader JSON still carries the full Entitled<T> payload.
    expect(loaderJsonOf(body)).toEqual({
      headword: ENTITLED_HEADWORD,
      senses: [SECRET_SENSES],
      $gx: { entitled: true },
    })
    expect(fx.fetch).toHaveBeenCalledTimes(1)

    // Governed response discipline unchanged by the fix.
    expect(res.headers.get('Cache-Control')).toBe('private')
    expect(res.headers.get('Vary')).toBe('Authorization, Cookie')
  })

  it('anonymous: HTML renders ONLY the declared preview; governed bytes appear NOWHERE', async () => {
    const fx = await makeFixture()
    const res = await fx.router.handle(req('/lexicon/logos'))
    expect(res.status).toBe(401)
    const body = await res.text()
    const html = htmlOf(body)

    // The withheld render receives Withheld<T>: the preview branch of the
    // authored ternary renders server-side.
    expect(html).toContain(`>${PREVIEW_HEADWORD}</h1>`)

    // #465: the `else` arm renders for a withheld principal (the locked
    // state is server-rendered too), and the entitled-only `if=` arm stays
    // byte-absent — down to its class name.
    expect(html).toContain('gx-locked')
    expect(html).toContain('>auth</p>')
    expect(body).not.toContain('gx-senses')

    // E6-style hard sentinel over the WHOLE response — HTML and the
    // __aihu_loader__ JSON channel: the governed payload appears nowhere.
    expect(body).not.toContain(SECRET_SENSES)
    expect(body).not.toContain(ENTITLED_HEADWORD)
    expect(fx.fetch).not.toHaveBeenCalled()

    // The JSON carries ONLY the Withheld<T> shape (declared preview subset).
    const payload = loaderJsonOf(body) as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(['$gx', 'preview'])
    expect(payload.$gx).toEqual({ entitled: false, reason: 'auth' })
    expect(payload.preview).toEqual({ headword: PREVIEW_HEADWORD })
  })

  it("lapsed member (resolver says no): withheld 'entitlement', 403, byte-clean", async () => {
    const fx = await makeFixture()
    const res = await fx.router.handle(req('/lexicon/logos', 'lapsed-token'))
    expect(res.status).toBe(403)
    const body = await res.text()
    expect(htmlOf(body)).toContain(`>${PREVIEW_HEADWORD}</h1>`)
    expect(htmlOf(body)).toContain('>entitlement</p>') // #465: else arm, reason threaded
    expect(body).not.toContain('gx-senses')
    expect(body).not.toContain(SECRET_SENSES)
    expect((loaderJsonOf(body) as { $gx: { reason: string } }).$gx.reason).toBe('entitlement')
    expect(fx.fetch).not.toHaveBeenCalled()
  })

  it('call axis, same registry + scope: §4.3 envelopes still hold', async () => {
    const fx = await makeFixture()
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
    const service = createAgentService({
      manifests: [
        {
          tag: 'lexicon-tool',
          actions: { lookup: { params: [] } },
          extract: { read: { scope: 'members' }, call: { scope: 'members' } },
        } as never,
      ],
      authPlugin,
      getRegistry: () => new Map([['lexicon-tool', [binding]]]),
      entitlements: fx.registry,
    })

    const denied = (await service.handleToolCall('lexicon-tool/lookup', null, {
      userId: null,
      jwt: 'lapsed-token',
    })) as { code?: number; error?: string }
    expect(denied.code).toBe(403)
    expect(denied.error).toMatch(/ENTITLEMENT_DENIED/)

    const ok = (await service.handleToolCall('lexicon-tool/lookup', null, {
      userId: null,
      jwt: 'member-token',
    })) as { result?: unknown }
    expect(ok.result).toBe('called')
  })
})

// ─── G7h — boot validation against the REAL compiled census ─────────────────

describe.skipIf(!BINARY)('GX P4 e2e — G7h: validateGovernedBoot over the compiled census', () => {
  function routesFromCensus(): RouteDefinition[] {
    const census = compileRouteJson(readFileSync(FIXTURE, 'utf8'))
    return [
      {
        pattern: census.pattern,
        segments: segmentsOf(census.pattern),
        module: () => Promise.reject(new Error('never loaded at boot')),
        extract: census.extract,
        data: census.data,
      },
    ]
  }

  it('data type with NO registered provider refuses to boot (names route + key)', () => {
    const registry = createGovernedRegistry().entitlement('members', 'token-only')
    expect(() => createServerRouter(routesFromCensus(), { governed: registry })).toThrowError(
      /boot refusal.*'\/lexicon\/\[slug\]'.*'LexiconEntry'.*no provider/s,
    )
  })

  it('strict mode (hard-tier read present): unregistered hard scope refuses to boot', () => {
    const registry = createGovernedRegistry().provider('LexiconEntry', {
      fetch: async () => ({}),
    })
    expect(() => createServerRouter(routesFromCensus(), { governed: registry })).toThrowError(
      /boot refusal \(strict mode\).*'members'/s,
    )
  })

  it("explicit 'token-only' boots (the declared opt-out)", () => {
    const registry = createGovernedRegistry()
      .provider('LexiconEntry', { fetch: async () => ({}) })
      .entitlement('members', 'token-only')
    expect(() => createServerRouter(routesFromCensus(), { governed: registry })).not.toThrow()
  })

  it('a data: route with NO registry at all refuses to boot', () => {
    expect(() => createServerRouter(routesFromCensus())).toThrowError(
      /boot refusal.*never boot ungated/s,
    )
  })
})
