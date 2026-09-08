/**
 * The shared GOVERNED FIXTURE for the GX Phase 5 build-time invariants
 * (#467): `check:governed` G4a–c / G5a–c and `check:dual-audience` DA-f1.
 *
 * One fixture, two checks — extracted here for the same reason
 * `lib/invariant.ts` exists: two hand-rolled copies of the governed route
 * would drift, and a drifted fixture measures two different surfaces while
 * reporting on one.
 *
 * What it stands up (the pattern of `check-governed.ts` G1: REAL things,
 * probed behaviorally):
 *
 *   - the COMPILED CENSUS row of the governed conformance fixture —
 *     `bench/compiler-conformance/route/04-governed-data.route.json`, read
 *     verbatim (pattern, `extract`, `data`). The census is byte-pinned to the
 *     standalone compiler's release tests, so probing the committed artifact
 *     is probing the compiler's fan-out without requiring compiler source in
 *     this checkout.
 *   - a route MODULE mirroring the compiled server artifact's semantic shape:
 *     `default` is a component factory accepting `{ route: { params, data } }`
 *     (the P4 integration seam), with the entitled-only `senses` content
 *     inside a REAL arbor structural `when()` boundary — the same
 *     `createIfBoundary` shape the compiler emits — so the fixture inherits
 *     the honest ceiling: structural `{#if}` renders EMPTY server-side today
 *     (#465), exactly like production.
 *   - a real `createGovernedRegistry` with SPIED provider fetch/preview and a
 *     controllable live entitlement resolver.
 *   - a real `createServerRouter(routes, { governed, auth })`.
 *
 * The sentinels are values only the PROVIDER can produce — they appear
 * nowhere in any source or census artifact — so "sentinel present in a
 * response/byte-stream" is equivalent to "provider-sourced governed data
 * reached that channel", the E6 byte-check posture.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './invariant.ts'

// ─── Sentinels (provider-sourced values; absent from all source artifacts) ───

/** The governed payload byte no withheld channel may ever carry. */
export const GX_SECRET = 'GX-P5-GOVERNED-SECRET-SENSES-BYTES'
/** The entitled-only headword (a DIRECT interpolation — renders in SSR HTML). */
export const GX_ENTITLED_HEADWORD = 'GX-P5-ENTITLED-HEADWORD'
/** The declared-preview headword (public-tier by declaration). */
export const GX_PREVIEW_HEADWORD = 'GX-P5-PREVIEW-HEADWORD'

/** Every sentinel that must be ABSENT from a withheld/anonymous channel. */
export const GX_GOVERNED_SENTINELS = [GX_SECRET, GX_ENTITLED_HEADWORD] as const

// ─── The compiled census ─────────────────────────────────────────────────────

export const GOVERNED_CENSUS_PATH = join(
  ROOT,
  'bench/compiler-conformance/route/04-governed-data.route.json',
)

export interface GovernedCensusRow {
  readonly pattern: string
  readonly extract?: { readonly read?: unknown; readonly call?: unknown }
  readonly data?: unknown
}

/** The compiled `.route.json` census row, verbatim (Rust-golden-pinned). */
export function loadGovernedCensus(): GovernedCensusRow {
  return JSON.parse(readFileSync(GOVERNED_CENSUS_PATH, 'utf8')) as GovernedCensusRow
}

/** `.route.json` pattern (`/lexicon/[slug]`) → router segments — the same
 * lowering `tests/integration/governed-route-e2e.test.ts` performs. */
export function segmentsOf(
  pattern: string,
): Array<{ kind: 'static'; path: string } | { kind: 'param'; name: string }> {
  return pattern
    .split('/')
    .filter(Boolean)
    .map((p) =>
      p.startsWith('[') && p.endsWith(']')
        ? ({ kind: 'param', name: p.slice(1, -1) } as const)
        : ({ kind: 'static', path: p } as const),
    )
}

// ─── Credentials ─────────────────────────────────────────────────────────────

/** Verified-claims table: what a REAL signature check would settle. */
export const GX_TOKENS: ReadonlyMap<string, { sub: string; scope: string }> = new Map([
  ['member-token', { sub: 'member-1', scope: 'members' }],
  ['lapsed-token', { sub: 'lapsed-9', scope: 'members' }],
  ['other-scope-token', { sub: 'other-2', scope: 'reports' }],
])

/**
 * A DECODE-ONLY-forgeable credential: its base64 payload decodes to fully
 * entitled claims (`member-1`, scope `members`) but it is NOT in the verified
 * table — a signature check refuses it; a `decodeJwt`-style boundary would
 * seat it as the entitled member. G4c's discriminating input.
 */
export function forgedDecodableToken(): string {
  const payload = Buffer.from(JSON.stringify({ sub: 'member-1', scope: 'members' })).toString(
    'base64',
  )
  return `forged-header.${payload}.forged-signature`
}

/** Decode a forged/real token's payload segment — the REGRESSED verify. */
function decodePayload(jwt: string): { sub?: string; scope?: string } | null {
  const seg = jwt.split('.')[1]
  if (!seg) return null
  try {
    return JSON.parse(Buffer.from(seg, 'base64').toString('utf8')) as {
      sub?: string
      scope?: string
    }
  } catch {
    return null
  }
}

// ─── Fixture construction ────────────────────────────────────────────────────

export interface GovernedFixtureOptions {
  /** Live entitlement resolver behavior. Default `'ok'`: grants `member-1` only. */
  readonly resolver?: 'ok' | 'deny' | 'throw'
  /**
   * Credential boundary:
   *   - `'real'` (default): signature-verifying plugin over {@link GX_TOKENS};
   *   - `'none'`: NO auth material passed at all (G4b's fail-closed cell);
   *   - `'accept-anything'`: `verify` seats an entitled principal for ANY
   *     credential string — the "boundary defaults open when misconfigured"
   *     regression (G4b's should-flag arm);
   *   - `'decode-only'`: `verify` DECODES the payload and trusts it — the
   *     exact regression G4c exists to forbid (spec §10 G4c: the boundary
   *     uses `verify`, never `decodeJwt`).
   */
  readonly auth?: 'real' | 'none' | 'accept-anything' | 'decode-only'
  /**
   * REGRESSION (self-test should-flag arms only): serve the same source
   * through an UNGOVERNED route — the census row stripped of `data:`, the
   * provider re-exposed as a plain route loader, no registry. This reproduces
   * "the governed declaration is lost between compiler and router" (a census
   * fan-out drop, or the router ceasing to treat `data:` as governed): the
   * surface reaches emission with no gate anywhere, which is invariant I2's
   * violated state.
   */
  readonly ungoverned?: boolean
}

export interface GovernedFixture {
  readonly router: { handle(req: Request): Promise<Response> }
  /** Spy counters — the gate's observable side effects. */
  readonly counts: { fetch: number; preview: number; resolve: number }
  readonly census: GovernedCensusRow
  /** A concrete instance path of the census pattern (`/lexicon/logos`). */
  readonly path: string
  /** The E3 governed-data endpoint path for {@link path}. */
  readonly dataPath: string
}

/** A request for the fixture route, optionally credentialed. */
export function govReq(path: string, jwt?: string): Request {
  return new Request(`http://governed.probe${path}`, {
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
  })
}

/** Strip the loader embed → the HTML channel. */
export function htmlOf(body: string): string {
  return body.replace(/<script type="application\/json" id="__aihu_loader__">.*<\/script>/s, '')
}

/** Parse the `__aihu_loader__` embed, or null when absent. */
export function loaderJsonOf(body: string): unknown {
  const m = body.match(/<script type="application\/json" id="__aihu_loader__">(.*?)<\/script>/s)
  if (!m) return null
  return JSON.parse(m[1]!)
}

/**
 * The route component, mirroring the compiled server artifact of
 * `04-governed-data.aihu`: direct interpolations for headword/slug (these DO
 * render server-side) and a structural `when()` boundary for the
 * entitled-only senses (renders EMPTY server-side until the
 * structural-directive SSR walk lands — #465).
 */
export async function makeGovernedComponent(): Promise<(props?: unknown) => unknown> {
  const { branch, leaf, when } = await import('@aihu/arbor')
  return (props?: unknown) => {
    const route = (props as { route?: { params?: Record<string, string>; data?: unknown } })?.route
    const data = (route?.data ?? {}) as {
      $gx?: { entitled?: boolean; reason?: string }
      headword?: unknown
      senses?: unknown
      preview?: { headword?: unknown }
    }
    const entitled = data.$gx?.entitled === true
    const headword = entitled
      ? String(data.headword ?? '')
      : String(data.preview?.headword ?? 'locked')
    const cond = [() => entitled, () => {}] as unknown as Parameters<typeof when>[0]
    return branch('article', undefined, [
      branch('h1', { class: 'gx-headword' }, [leaf(headword)]),
      branch('p', { class: 'gx-slug' }, [leaf(String(route?.params?.slug ?? ''))]),
      when(cond, () =>
        branch('section', { class: 'gx-senses' }, [
          leaf(Array.isArray(data.senses) ? data.senses.join(', ') : ''),
        ]),
      ),
      when([() => !entitled, () => {}] as unknown as Parameters<typeof when>[0], () =>
        branch('p', { class: 'gx-locked' }, [leaf(String(data.$gx?.reason ?? ''))]),
      ),
    ])
  }
}

/** Stand up the full fixture: census route + registry + auth + real router. */
export async function makeGovernedFixture(opts?: GovernedFixtureOptions): Promise<GovernedFixture> {
  const { createGovernedRegistry, defineGovernedFetch } = await import('@aihu/server')
  const { createServerRouter } = await import('@aihu/router/server')

  const census = loadGovernedCensus()
  const component = await makeGovernedComponent()
  const counts = { fetch: 0, preview: 0, resolve: 0 }
  const resolverMode = opts?.resolver ?? 'ok'
  const authMode = opts?.auth ?? 'real'

  const payload = () => ({ headword: GX_ENTITLED_HEADWORD, senses: [GX_SECRET] })

  const registry = createGovernedRegistry()
    .provider('LexiconEntry', {
      fetch: async () => {
        counts.fetch++
        return payload()
      },
      preview: async () => {
        counts.preview++
        return { headword: GX_PREVIEW_HEADWORD }
      },
    })
    .entitlement('members', {
      resolve: async ({ principal }) => {
        counts.resolve++
        if (resolverMode === 'throw') throw new Error('entitlement backend outage (probe)')
        if (resolverMode === 'deny') return false
        return principal.sub === 'member-1'
      },
      timeoutMs: 250,
    })

  const authPlugin = {
    checkScope: (jwt: string, scope: string) => {
      const claims = GX_TOKENS.get(jwt)
      return claims ? claims.scope.split(' ').includes(scope) : false
    },
    verify: async (jwt: string) => {
      if (authMode === 'accept-anything') return { sub: 'anyone-at-all', scope: 'members' }
      if (authMode === 'decode-only') return decodePayload(jwt) ?? GX_TOKENS.get(jwt) ?? null
      return GX_TOKENS.get(jwt) ?? null
    },
  }

  const path = '/lexicon/logos'
  const dataPath = `/__aihu/data${path}`

  if (opts?.ungoverned) {
    // The I2-violated regression: same source, no gate anywhere. The census
    // row loses `data:`; the provider becomes a plain, always-invoked loader.
    const routes = [
      {
        pattern: census.pattern,
        segments: segmentsOf(census.pattern),
        module: async () => ({
          default: component,
          loader: async () => {
            counts.fetch++
            return { ...payload(), preview: { headword: GX_PREVIEW_HEADWORD } }
          },
        }),
        // extract deliberately ABSENT too: with a hard-tier `read` the router's
        // T4 fallback would still withhold route-level, which is the shipped
        // tree behaving well — the regression under probe is the census losing
        // the governed declaration entirely.
      },
    ] as never
    const router = createServerRouter(routes)
    return { router, counts, census, path, dataPath }
  }

  // `defineGovernedFetch` is imported so the escape-hatch brand stays covered
  // by the fixture's type graph; the standing fixture registers the provider
  // by type key (the primary §4.1 surface).
  void defineGovernedFetch

  const routes = [
    {
      pattern: census.pattern,
      segments: segmentsOf(census.pattern),
      module: async () => ({ default: component }),
      extract: census.extract,
      data: census.data,
    },
  ] as never

  const router = createServerRouter(routes, {
    governed: registry,
    ...(authMode === 'none' ? {} : { auth: { authPlugin } }),
  })
  return { router, counts, census, path, dataPath }
}
