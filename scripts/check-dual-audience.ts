#!/usr/bin/env bun
/**
 * check:dual-audience — thesis §1: humans and agents are both first-class
 * audiences of ONE codebase, and the agent axis is a real projection rather
 * than the UI re-serialized.
 *
 * "Any content reachable only by executing the site's presentation logic is
 * unavailable to the agent axis entirely."
 *
 * The furthest property: the scorecard measures 0/4. Four sub-checks, each
 * one finding:
 *
 *   DA-a  A markdown representation can be PRODUCED. `MarkdownResolver` must
 *         have a real implementation — a VALUE, exported from a package public
 *         entry. Today every reference is the interface declaration, the config
 *         field, a `dist/*.d.ts` re-export, or a test mock.
 *
 *   DA-b  Negotiation reaches non-`Accept` clients. Behavioral: build the real
 *         middleware, send a request with NO `Accept` header and a crawler
 *         user-agent, expect markdown. Today `content-negotiation.ts` reads
 *         `Accept` and nothing else, and AI crawlers do not send it.
 *
 *   DA-c  Primary content is retrievable without JS. Behavioral: drive the real
 *         `createServerRouter(...).handle(req)` and look for the content and the
 *         hydration markers in the raw body. Today `router/src/server.ts:41`
 *         calls `renderToString(component)` with NO options, and every marker in
 *         `ssr.ts` is gated on `opts?.hydratable ?? false`.
 *
 *   DA-d  The SAME assertion against the PRERENDER (SSG) path. Behavioral:
 *         drive the real `runPrerender(...)` over a temp fixture and read the
 *         HTML it actually writes to disk. `packages/app/src/prerender.ts:283`
 *         and `:382` call `renderToString(...)` with NO options — the identical
 *         defect class as `router/src/server.ts:41`, in a second reachable
 *         production path.
 *
 * ⚠️ DA-d is a SCOPE DECISION, not a newly introduced defect. The prerender
 * path was always broken this way; the check simply did not look at it. The
 * founder ruled prerender in scope on 2026-07-19, so this check went from
 * measuring 3 to measuring 4. NOTHING IS FIXED by adding it — the baseline
 * moves 3 → 4 because the check now SEES a defect that was already shipping,
 * and `check:dual-audience` must still fail. `baselines.json` carries that
 * reason; the scorecard row moves 0/3 → 0/4 for the same reason.
 *
 * ─── GX Phase 5 (#467) — the governed dual-audience seams (40-spec §10) ─────
 *
 * Three additional sub-checks make the Phase-4 governed boundary's
 * dual-audience guarantees non-regressable. Shared fixture:
 * `scripts/lib/governed-fixture.ts` (also driven by `check:governed` G4/G5),
 * standing up the REAL `createServerRouter` + registry over the REAL compiled
 * census row of `bench/compiler-conformance/route/04-governed-data.aihu`.
 *
 *   DA-f1  PER-VALUE SENTINEL BYTE CHECKS (E6 generalized into a standing
 *          check): for a WITHHELD principal (anonymous AND lapsed-entitlement)
 *          each governed value's sentinel is absent from the ENTIRE response —
 *          HTML and the `__aihu_loader__` JSON channel scanned per sentinel;
 *          the declared preview still renders. For an ENTITLED principal the
 *          granted values are present AS GRANTED (headword in server HTML —
 *          reachable without JS; the full payload on the loader channel).
 *          Regression proven: a withheld response whose loader embed carries
 *          the granted payload (the redact-at-serialize-instead-of-
 *          never-fetch regression, §4.5's forbidden shape) is flagged.
 *
 *   DA-f2  THREE-ARTIFACT AGREEMENT over the committed conformance corpus:
 *          the `// @aihu:extract` code marker and the `.route.json` sidecar
 *          must carry the SAME policy for every route fixture, and a `data:`
 *          declaration in the source must ride the census (present, well-formed
 *          under the runtime's own `normalizeGovernedData`, type + preview
 *          tokens agreeing with the source). The committed artifacts are
 *          produced by the standalone compiler release; the root repository
 *          verifies the released package and committed sidecars as a consumer.
 *          The agent-meta leg (manifest ≡ marker ≡ route.json) is checked by
 *          the standalone compiler repository. HONEST SCOPE: `data:` fans out to
 *          `.route.json` (+ the type sidecar) only — the marker and agent-meta
 *          do not carry it, so `data:` agreement is source ≡ census, not
 *          three-way.
 *
 *   DA-f3  DISCOVERY AGREEMENT: the generated discovery artifacts —
 *          robots.txt, llms.txt, and the served `X-Robots-Tag` header — must
 *          agree with each surface's declared `read:` across the full value
 *          vocabulary (all/agents/search/none/verified/human/{scope}/malformed,
 *          plus the compiled census route): hard values are ABSENT from every
 *          anonymous artifact (existence never advertised), `'none'` gets its
 *          honest Disallow + noindex, public values stay listed. Regression
 *          proven: hand-leaked documents (a Disallow line naming the governed
 *          path; an llms.txt row listing it) are flagged. HONEST SCOPE:
 *          per-principal discovery (an authenticated agent's OWN listing of
 *          entitled surfaces) has no shipped surface on main yet — that leg
 *          activates when one lands; nothing here should be read as covering it.
 *
 *   DA-g   SHADOW-PAGE CENSUS (#437, DA4): an informational per-page census of
 *          the AUTHORED shadow state over the same conformance corpus (pin from
 *          the `// @aihu:shadow` golden marker, source `$shadow` fallback;
 *          unpinned reports "default (light DOM)"). `$shadow` is pure
 *          encapsulation — the census is never a finding. The ONE hard case is
 *          the explicit self-contradiction: `ssr: true` + public `read:` + an
 *          explicit `$shadow: 'shadow'` pin (the sole shadow value of the
 *          ratified binary `'light' | 'shadow'` vocabulary), all three
 *          author-declared, never the default.
 *
 * DA-c and DA-d are separate findings because they are separate defects in
 * separate files with separate fixes: DA3 repairing the router does not repair
 * the SSG writer. Grouping them would let one fix silently decrement a baseline
 * that covered two live defects.
 *
 * DA-a's exclusions are the load-bearing part of this check. The four
 * `tests/compliance/` suites report green precisely because THE TEST SUPPLIES
 * THE THING THAT DOES NOT EXIST — `isitagentready.test.ts` injects its own mock
 * `mdResolver`. So DA-a refuses to count test mocks, refuses `dist/`, refuses a
 * TYPE (a re-exported interface is not an implementation), and refuses a
 * resolver constructed inside this check.
 *
 * DA-c asserts the PRESENCE OF MARKERS and the REACHABILITY OF TEXT, never an
 * exact markup string — the explicit anti-`hydrate.test.ts` guard, that suite
 * having hand-written the `hydrate.0` markup it then asserted.
 *
 * NO suppression comments are supported.
 *
 * Wired into CI (plan-a.yml `check` job). Run via the npm script, NOT bare bun:
 *   bun run check:dual-audience
 *
 * `AIHU_NATIVE_SKIP=1` selects the TypeScript SSR fallback ("slower, always
 * correct"), matching what `vitest.config.ts` sets for the same reason; the
 * native renderer binary is not built in a plain checkout.
 *
 * ⚠️ This script previously also passed `--tsconfig-override ./tsconfig.json`,
 * to force the ROOT `paths` map onto every file because the per-package
 * tsconfigs declared `paths` with no `baseUrl` and bun therefore ignored them.
 * That override was REMOVED: it forced an INCOMPLETE map onto package sources
 * and broke resolution it was meant to fix — the root map has no
 * `@aihu/router/plugin` entry, so `packages/app/src/prerender.ts` (which DA-d
 * drives) failed to resolve under it. The per-package tsconfigs now carry
 * `baseUrl`, so their own already-correct maps apply. Removing it also silences
 * the `Internal error: directory mismatch` Bun emits for that flag.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Glob } from 'bun'
import ts from 'typescript'
import {
  expectCount,
  expectedFrom,
  type Finding,
  isExcluded,
  ROOT,
  refuseVacuous,
  selfTest,
} from './lib/invariant.ts'

const NAME = 'check:dual-audience'

// ─── DA-a: a MarkdownResolver implementation exists ──────────────────────────

/** The structural contract: `resolve(path: string): Promise<string | null>`. */
const RESOLVER_METHOD = 'resolve'

function parse(source: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
}

/**
 * Does this node declare a VALUE that structurally satisfies MarkdownResolver?
 *
 * A type or interface never qualifies, however perfectly it matches — an
 * interface is the declaration of the gap, not its filling. This is the direct
 * counter to the scorecard's finding that all nine `MarkdownResolver` hits are
 * declarations, config fields, `dist` re-exports, or mocks.
 */
function declaresResolverValue(node: ts.Node): boolean {
  // class X { async resolve(p: string) { … } }
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    return node.members.some(
      (m) =>
        (ts.isMethodDeclaration(m) || ts.isPropertyDeclaration(m)) &&
        m.name !== undefined &&
        ts.isIdentifier(m.name) &&
        m.name.text === RESOLVER_METHOD,
    )
  }
  // const x = { resolve(p) { … } } / { resolve: async (p) => … }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.some(
      (p) =>
        p.name !== undefined &&
        ts.isIdentifier(p.name) &&
        p.name.text === RESOLVER_METHOD &&
        (ts.isMethodDeclaration(p) ||
          (ts.isPropertyAssignment(p) &&
            (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer)))),
    )
  }
  return false
}

/** Exported value declarations in a file that satisfy the resolver shape. */
function findResolverValues(rel: string, source: string): string[] {
  const sf = parse(source, rel)
  const hits: string[] = []

  const isExported = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)

  const at = (node: ts.Node): string =>
    `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`

  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && isExported(node) && declaresResolverValue(node)) {
      hits.push(at(node))
    }
    if (ts.isVariableStatement(node) && isExported(node)) {
      for (const d of node.declarationList.declarations) {
        if (!d.initializer) continue
        // `const r: MarkdownResolver = { resolve … }` or a factory's return
        // is not followed here — a factory is only an implementation once
        // something exports its result, which the object-literal case covers.
        if (declaresResolverValue(d.initializer)) hits.push(at(d))
        else if (
          (ts.isAsExpression(d.initializer) || ts.isSatisfiesExpression(d.initializer)) &&
          declaresResolverValue(d.initializer.expression)
        ) {
          hits.push(at(d))
        }
      }
    }
    // A factory function whose body returns a resolver object literal is a
    // real implementation the moment it is exported.
    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      isExported(node) &&
      node.body
    ) {
      let returnsResolver = false
      const scan = (n: ts.Node): void => {
        if (ts.isReturnStatement(n) && n.expression && declaresResolverValue(n.expression)) {
          returnsResolver = true
        }
        ts.forEachChild(n, scan)
      }
      scan(node.body)
      if (returnsResolver) hits.push(at(node))
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

/**
 * Package public entries: `packages/<pkg>/src/index.ts` plus the source files
 * named by each package's `exports` map. Only code REACHABLE FROM A PUBLIC
 * ENTRY counts — a resolver buried in an unexported internal module is not a
 * representation any agent can obtain.
 */
function publicEntrySources(base = ROOT): Array<{ rel: string; source: string }> {
  const out: Array<{ rel: string; source: string }> = []
  const seen = new Set<string>()

  const add = (rel: string): void => {
    const norm = rel.replaceAll('\\', '/')
    if (seen.has(norm) || isExcluded(norm)) return
    const abs = join(base, norm)
    if (!existsSync(abs)) return
    seen.add(norm)
    out.push({ rel: norm, source: readFileSync(abs, 'utf8') })
  }

  for (const pkgJson of new Glob('packages/*/package.json').scanSync(base)) {
    const rel = pkgJson.replaceAll('\\', '/')
    if (isExcluded(rel)) continue
    const dir = rel.slice(0, rel.lastIndexOf('/'))
    add(`${dir}/src/index.ts`)
    // Follow the whole src tree of any package that mentions MarkdownResolver,
    // so an implementation placed beside the interface is still discoverable.
    for (const f of new Glob(`${dir}/src/**/*.ts`).scanSync(base)) add(f)
  }
  return out
}

function runDaA(files: ReadonlyArray<{ rel: string; source: string }>): {
  hits: string[]
  finding: Finding | null
} {
  const hits = files.flatMap((f) => findResolverValues(f.rel, f.source))
  if (hits.length > 0) return { hits, finding: null }
  return {
    hits,
    finding: {
      where: 'packages/plugin-agent-readiness/src/content-negotiation.ts:13',
      rule: 'DA-a',
      message:
        'no `MarkdownResolver` IMPLEMENTATION is exported from any package public entry — only ' +
        'the interface declaration, the config field, `dist/*.d.ts` re-exports, and test mocks. ' +
        'A markdown representation cannot be produced in production, so the agent axis has no ' +
        'content to negotiate for. (Test mocks are deliberately not counted: the compliance ' +
        'suites report green because they supply the thing that does not exist.)',
    },
  }
}

// ─── DA-b: negotiation reaches non-`Accept` clients ──────────────────────────

/** Crawler UAs that do not send `Accept: text/markdown`, plus a human cell. */
const UA_MATRIX = [
  { label: 'GPTBot, no Accept header', ua: 'GPTBot/1.0', accept: null, wantMarkdown: true },
  {
    label: 'ClaudeBot, no Accept header',
    ua: 'ClaudeBot/1.0',
    accept: null,
    wantMarkdown: true,
  },
  // The must-not-flag cell. Demanding markdown for a browser would break the
  // HUMAN axis — a thesis violation in the opposite direction, and just as
  // real. "A human receives an experience."
  {
    label: 'a normal browser UA (must stay HTML)',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    accept: 'text/html,application/xhtml+xml',
    wantMarkdown: false,
  },
] as const

interface UaOutcome {
  readonly label: string
  readonly gotMarkdown: boolean
  readonly correct: boolean
}

/**
 * @param acceptOnly `--self-test` REGRESSION mutation. Disables the UA fallback
 *   via the real `userAgentFallback: false` option, reproducing exactly the
 *   Accept-only negotiation that shipped before DA2. Re-based 2026-07-20: this
 *   parameter used to mean the opposite — it SIMULATED the fix, because no
 *   implementation existed to drive. Now that production is UA-aware, a
 *   simulated fix would make the should-flag case vacuous (it went green on its
 *   own the moment DA2 landed, which is what caught this). The should-flag half
 *   must therefore be a real-code regression, and the should-not-flag half is
 *   now the LIVE default path. Same rebasing the `governed` baseline records for
 *   GO1/GO2.
 */
async function runDaB(
  acceptOnly: boolean,
): Promise<{ outcomes: UaOutcome[]; finding: Finding | null }> {
  const { createContentNegotiationHandler } = await import(
    '@aihu-plugin/agent-readiness/content-negotiation'
  ).catch(() => import('@aihu-plugin/agent-readiness'))

  const outcomes: UaOutcome[] = []
  for (const cell of UA_MATRIX) {
    // The resolver here belongs to the PROBE, not to production — DA-a is what
    // asserts a production implementation exists, and it counts nothing built
    // in this file. DA-b is only asking whether negotiation is REACHED.
    const middleware = createContentNegotiationHandler({
      resolver: { resolve: async () => '# probe\n\nprimary content' },
      ...(acceptOnly ? { userAgentFallback: false } : {}),
    })
    const headers: Record<string, string> = { 'User-Agent': cell.ua }
    if (cell.accept) headers.Accept = cell.accept

    const req = new Request('https://example.test/docs/page', { headers })
    const next = async () =>
      new Response('<html><body>ui</body></html>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })

    const res = await middleware(req, next)
    const ct = res?.headers.get('Content-Type') ?? ''
    const gotMarkdown = ct.includes('text/markdown')
    outcomes.push({
      label: cell.label,
      gotMarkdown,
      correct: gotMarkdown === cell.wantMarkdown,
    })
  }

  const bad = outcomes.filter((o) => !o.correct)
  if (bad.length === 0) return { outcomes, finding: null }
  return {
    outcomes,
    finding: {
      where: 'packages/plugin-agent-readiness/src/content-negotiation.ts:49',
      rule: 'DA-b',
      message:
        `content negotiation ignores the user-agent — ${bad.length}/${outcomes.length} cells wrong ` +
        `(${bad.map((b) => b.label).join('; ')}). The middleware reads \`Accept\` and nothing ` +
        'else, and only a minority of agent clients send `Accept: text/markdown`. Format ' +
        'selection is supposed to move to the client; for a crawler it never gets the chance.',
    },
  }
}

// ─── DA-c: primary content retrievable without JS ────────────────────────────

const PRIMARY_TEXT = 'PRIMARY-CONTENT-REACHABLE-WITHOUT-JS'

/**
 * Which direction a DA-c/DA-d probe is being run in.
 *
 * `live` drives the real production path and is what the REAL SCAN uses.
 * `regressed` re-creates the pre-DA3 defect — the identical render minus the
 * options object DA3/DA3b added — and is the self-test's should-flag control.
 *
 * The polarity flipped when DA3 landed. While the defect shipped, `live` WAS
 * the should-flag arm; now that it is fixed, `live` is the should-NOT-flag arm
 * and the positive control has to be simulated. A boolean named `hydratable`
 * could not express that inversion without reading backwards, hence the enum.
 */
type ProbeMode = 'live' | 'regressed'

async function runDaC(mode: ProbeMode): Promise<{ body: string; finding: Finding | null }> {
  const { createServerRouter } = await import('@aihu/router/server')
  const { branch, leaf } = await import('@aihu/arbor')
  const { renderToString } = await import('@aihu/server')

  // A fixture route whose component renders known text. We assert the text is
  // REACHABLE and the hydration markers are PRESENT — never an exact markup
  // blob. `hydrate.test.ts` hand-wrote the root-path markup it then asserted
  // and measured nothing; this must not repeat that.
  //
  // `leaf` takes `Signal<string> | string`; a plain string is used deliberately.
  // Passing a bare signal GETTER stringifies the accessor's source into the
  // markup instead of its value, which silently made the primary text
  // unfindable and the should-not-flag half of this probe impossible to satisfy.
  const component = () =>
    branch('main', { id: 'page' }, [branch('article', {}, [leaf(PRIMARY_TEXT)])])

  const routes = [
    {
      pattern: '/probe',
      segments: [{ type: 'static' as const, value: 'probe' }],
      module: async () => ({ default: component }),
    },
  ] as unknown as Parameters<typeof createServerRouter>[0]

  let body: string
  if (mode === 'live') {
    const router = createServerRouter(routes)
    const res = await router.handle(new Request('https://example.test/probe'))
    body = await res.text()
  } else {
    // `--self-test` should-FLAG arm, re-based by DA3.
    //
    // Before DA3 this arm WAS the live router: the production defect supplied
    // the positive control. DA3 repaired the router, so that control now
    // reports clean and the self-test would exit 1 before the real scan ever
    // ran — the check would read as broken rather than as passing.
    //
    // So the positive control is now a simulated REGRESSION: the SAME
    // component through the SAME renderer the router uses, differing ONLY in
    // the options object DA3 added. That is precisely the edit that would
    // reintroduce the defect, so the probe still discriminates on the thing it
    // governs. Deliberately not a string patch of the live body — a mutation
    // that fakes the output proves nothing about whether these assertions can
    // recognize genuinely non-hydratable markup.
    body = await renderToString(component, { hydratable: false })
  }

  const hasText = body.includes(PRIMARY_TEXT)
  const hasMarkers = body.includes('data-aihu-path')
  // Content sealed inside a declarative shadow root is unreachable to a
  // non-JS extractor even when it is technically in the byte stream.
  const shadowStart = body.indexOf('shadowrootmode')
  const textIndex = body.indexOf(PRIMARY_TEXT)
  const textInShadow = shadowStart !== -1 && textIndex > shadowStart

  if (hasText && hasMarkers && !textInShadow) return { body, finding: null }

  const reasons: string[] = []
  if (!hasText) reasons.push('primary text absent from the raw body')
  if (!hasMarkers) {
    reasons.push(
      'no `data-aihu-path` markers — `router/src/server.ts:41` calls `renderToString(component)` ' +
        'with no options, and every marker in `ssr.ts` is gated on `opts?.hydratable ?? false`, ' +
        'so the production path emits non-hydratable output',
    )
  }
  if (textInShadow) reasons.push('primary text sits inside a declarative shadow root')

  // ONE finding covering both assertions: one defect (the missing options
  // object). Splitting them inflates dual-audience past 3.
  return {
    body,
    finding: {
      where: 'packages/router/src/server.ts:41',
      rule: 'DA-c',
      message: `primary content is not fully retrievable without JS — ${reasons.join('; ')}.`,
    },
  }
}

// ─── DA-d: the prerender (SSG) path emits the same non-hydratable output ─────

/**
 * Drive the REAL `runPrerender` over a temp fixture and read the HTML it writes.
 *
 * Deliberately not a source scan for `renderToString(component)`. A grep would
 * pass the moment someone reformatted the call, and it would not prove the
 * written file lacks the markers. This mounts the actual SSG pipeline — route
 * derivation, render, template head-injection, outlet content-injection, file
 * write — and inspects the bytes on disk, which is what a crawler receives.
 *
 * `loadModule` is injected (the same seam `packages/app/tests/prerender.test.ts`
 * uses) so the probe does not need the Rust SFC compiler to be built. That is
 * NOT the DA-a class of mock: the injected module supplies the ROUTE, which is
 * app-author input, while the thing under test — whether the renderer is asked
 * for hydratable output — remains entirely production code.
 */
async function runDaD(mode: ProbeMode): Promise<{ body: string; finding: Finding | null }> {
  const { mkdir, mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { runPrerender } = await import('../packages/app/src/prerender.ts')
  const { branch, leaf } = await import('@aihu/arbor')
  const { renderToString } = await import('@aihu/server')

  const component = () =>
    branch('main', { id: 'page' }, [branch('article', {}, [leaf(PRIMARY_TEXT)])])

  const root = await mkdtemp(join(tmpdir(), 'aihu-da-d-'))
  try {
    const outDir = join(root, 'dist')
    await mkdir(join(root, 'pages'), { recursive: true })
    await mkdir(outDir, { recursive: true })
    // The "built" SPA shell the prerenderer uses as its template. Kept in a
    // variable because `runPrerender` OVERWRITES this file with the composed
    // page — the mutation below needs the original shell, not the output.
    const template =
      '<!doctype html><html><head><title>t</title></head><body><div id="outlet"></div></body></html>'
    await writeFile(join(outDir, 'index.html'), template)
    await writeFile(join(root, 'pages', 'index.ts'), '// route stub\n')

    await runPrerender({
      resolvedViteConfig: { root, build: { outDir: 'dist' } } as never,
      config: undefined,
      loadModule: async () => ({ default: component }),
      warn: () => {},
    })

    // The bytes `runPrerender` actually wrote to disk — what a crawler receives.
    let body = await readFile(join(outDir, 'index.html'), 'utf8')
    if (mode === 'regressed') {
      // `--self-test` should-FLAG arm, re-based by DA3b, for the same reason as
      // DA-c's: before DA3b the live SSG writer supplied the positive control,
      // and repairing it would leave this probe one-sided and exit the
      // self-test before the real scan.
      //
      // The control is now a simulated REGRESSION composed the way
      // `runPrerender` composes — same component, same renderer, same template,
      // injected into the same outlet — differing ONLY in the options object
      // DA3b added. Composed from the ORIGINAL template rather than patched
      // into the written output, because the written output no longer contains
      // an empty outlet to patch. A mutation that faked the markup would prove
      // nothing about whether these assertions can recognize genuinely
      // non-hydratable prerendered HTML.
      const rendered = await renderToString(component, { hydratable: false })
      body = template.replace('<div id="outlet"></div>', `<div id="outlet">${rendered}</div>`)
    }

    const hasText = body.includes(PRIMARY_TEXT)
    const hasMarkers = body.includes('data-aihu-path')
    const shadowStart = body.indexOf('shadowrootmode')
    const textIndex = body.indexOf(PRIMARY_TEXT)
    const textInShadow = shadowStart !== -1 && textIndex > shadowStart

    if (hasText && hasMarkers && !textInShadow) return { body, finding: null }

    const reasons: string[] = []
    if (!hasText) reasons.push('primary text absent from the written HTML')
    if (!hasMarkers) {
      reasons.push(
        'no `data-aihu-path` markers in the file written to disk — ' +
          '`packages/app/src/prerender.ts:283` and `:382` call `renderToString(...)` with no ' +
          'options, so every statically generated page ships non-hydratable output',
      )
    }
    if (textInShadow) reasons.push('primary text sits inside a declarative shadow root')

    // ONE finding: one defect (the missing options object in the SSG writer),
    // distinct from DA-c's defect in the router.
    return {
      body,
      finding: {
        where: 'packages/app/src/prerender.ts:382',
        rule: 'DA-d',
        message: `statically prerendered content is not fully retrievable without JS — ${reasons.join('; ')}.`,
      },
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

// ─── DA-e (INFORMATIONAL, #437): route components without `$shadow` ──────────
//
// The DA4 flip LANDED: the founder-ratified classifier
// (`docs/architecture/thesis.md` §DA4) makes `@route`-block components pages,
// and pages now DEFAULT to `shadowMode: 'light'` — the compiler emits a
// `// @aihu:shadow-default light` marker for an unpinned page, and
// W472 (the phase-1 advisory) is retired. An unpinned page is therefore no
// longer future-behavior-changing; this scan remains an informational census
// of pages riding the implicit default (vs pinning it explicitly). Promoting
// it to an enforced finding class (ratification amendment 4 contemplated
// this) is a follow-up decision, not automatic at the flip.
//
// The detector mirrors the compiler's page classifier (emit.rs): `@route`
// block present AND no `$shadow` macro. Text-shape match rather than a
// compiler invocation, deliberately — this check must run on a plain checkout
// with no Rust binary built, and an informational count does not warrant
// spawning the compiler per file.

/** Where shipped `.aihu` sources live. Fixtures/bench corpora are not shipped
 * code and are excluded (tests via GLOBAL_EXCLUDES, bench by omission). */
const AIHU_SOURCE_GLOBS = [
  'packages/**/*.aihu',
  'apps/**/*.aihu',
  'examples/**/*.aihu',
  'cookbook/**/*.aihu',
] as const

/** The unpinned-page shape: an `@route` block with no `$shadow` declaration. */
function isRouteComponentWithoutShadow(source: string): boolean {
  const hasRoute = /^@route\s*\{/m.test(source)
  const hasShadow = /^\s*\$shadow\b/m.test(source)
  return hasRoute && !hasShadow
}

function runDaE(files: ReadonlyArray<{ rel: string; source: string }>): string[] {
  return files.filter((f) => isRouteComponentWithoutShadow(f.source)).map((f) => f.rel)
}

function aihuSources(base = ROOT): Array<{ rel: string; source: string }> {
  const out: Array<{ rel: string; source: string }> = []
  const seen = new Set<string>()
  for (const pattern of AIHU_SOURCE_GLOBS) {
    for (const m of new Glob(pattern).scanSync(base)) {
      const rel = m.replaceAll('\\', '/')
      if (seen.has(rel) || isExcluded(rel)) continue
      seen.add(rel)
      out.push({ rel, source: readFileSync(join(base, rel), 'utf8') })
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel))
}

// ─── DA-f1 (GX P5 #467): per-value sentinel byte checks ──────────────────────

async function runDaF1(mode: ProbeMode): Promise<{ finding: Finding | null }> {
  const { GX_GOVERNED_SENTINELS, GX_PREVIEW_HEADWORD, GX_ENTITLED_HEADWORD, GX_SECRET } =
    await import('./lib/governed-fixture.ts')
  const { makeGovernedFixture, govReq, htmlOf, loaderJsonOf } = await import(
    './lib/governed-fixture.ts'
  )

  const fx = await makeGovernedFixture()
  let anonBody = await (await fx.router.handle(govReq(fx.path))).text()
  const lapsedBody = await (await fx.router.handle(govReq(fx.path, 'lapsed-token'))).text()
  const entitledBody = await (await fx.router.handle(govReq(fx.path, 'member-token'))).text()

  if (mode === 'regressed') {
    // The §4.5-forbidden regression: the withheld response is produced by
    // SERIALIZING the granted payload (redaction downstream of a full fetch)
    // instead of never fetching it — the loader embed leaks the sentinels
    // while the HTML still looks locked. Composed, not live-mutated: the live
    // pipeline correctly has no code path that fetches for a withheld request
    // (G4a's spy proves that), which is the property itself.
    const granted = JSON.stringify({
      headword: GX_ENTITLED_HEADWORD,
      senses: [GX_SECRET],
      $gx: { entitled: false, reason: 'auth' },
    })
    anonBody = `${htmlOf(anonBody)}<script type="application/json" id="__aihu_loader__">${granted}</script>`
  }

  const bad: string[] = []
  // Per-value scan, per withheld principal class — one line per leaked value
  // so a partial leak (one field) is named, not rounded into a boolean.
  for (const [label, body] of [
    ['anonymous', anonBody],
    ['lapsed-entitlement', lapsedBody],
  ] as const) {
    for (const sentinel of GX_GOVERNED_SENTINELS) {
      if (body.includes(sentinel)) {
        bad.push(`withheld (${label}) response carries governed value sentinel '${sentinel}'`)
      }
    }
    if (!htmlOf(body).includes(GX_PREVIEW_HEADWORD)) {
      bad.push(`withheld (${label}) response lost the DECLARED preview field`)
    }
  }
  // Entitled: present AS GRANTED — headword in the no-JS-reachable HTML,
  // full payload on the loader channel.
  if (!htmlOf(entitledBody).includes(GX_ENTITLED_HEADWORD)) {
    bad.push('entitled response is missing the granted headword in server HTML')
  }
  const entitledJson = loaderJsonOf(entitledBody) as { senses?: string[] } | null
  if (!entitledJson?.senses?.includes(GX_SECRET)) {
    bad.push('entitled loader channel is missing the granted governed payload')
  }

  if (bad.length === 0) return { finding: null }
  return {
    finding: {
      where: 'packages/router/src/server.ts:244',
      rule: 'DA-f1',
      message:
        `governed sentinel byte checks failed — ${bad.length} violation(s): ${bad.join('; ')}. ` +
        'A withheld response must contain NO governed value on ANY channel (HTML or ' +
        '__aihu_loader__ JSON), and an entitled response must carry what the gate granted.',
    },
  }
}

// ─── DA-f2 (GX P5 #467): three-artifact agreement over the census corpus ─────

interface RouteArtifactEntry {
  readonly rel: string
  readonly source: string
  readonly golden: string | null
  readonly routeJson: Record<string, unknown> | null
}

/** Canonical single-token form of a compiled extract axis value — the TS
 * mirror of `ExtractRead::marker_value` / `ExtractCall::marker_value`. */
function canonicalExtractToken(value: unknown): string | null {
  if (typeof value === 'string' && value !== '') return value
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { scope?: unknown }).scope === 'string' &&
    (value as { scope: string }).scope !== ''
  ) {
    return `scope:${(value as { scope: string }).scope}`
  }
  return null
}

/**
 * Pure agreement core (self-testable on synthetic entries). One finding per
 * disagreeing fixture — each is its own drift with its own artifact to fix.
 */
async function daF2Findings(entries: ReadonlyArray<RouteArtifactEntry>): Promise<Finding[]> {
  const { normalizeGovernedData } = await import('@aihu/server')
  const findings: Finding[] = []

  for (const e of entries) {
    const problems: string[] = []
    const extract = (e.routeJson?.extract ?? null) as { read?: unknown; call?: unknown } | null

    if (e.golden !== null && e.routeJson !== null) {
      const m = e.golden.match(/^\/\/ @aihu:extract read=(\S+) call=(\S+)/m)
      if (!m) {
        problems.push('the emitted JS carries no `// @aihu:extract` code marker')
      } else if (extract === null) {
        problems.push('.route.json carries no `extract` member while the marker exists')
      } else {
        const jsonRead = canonicalExtractToken(extract.read)
        const jsonCall = canonicalExtractToken(extract.call)
        if (m[1] !== jsonRead) {
          problems.push(
            `read axis disagrees: marker '${m[1]}' vs .route.json '${jsonRead}' — the §2.4 ` +
              'fan-out drifted',
          )
        }
        if (m[2] !== jsonCall) {
          problems.push(`call axis disagrees: marker '${m[2]}' vs .route.json '${jsonCall}'`)
        }
      }
    }

    // `data:` agreement — source ≡ census (the artifacts that carry it).
    if (e.routeJson !== null) {
      const sourceDeclares = /^\s*data\s*:\s*\{/m.test(e.source)
      const censusData = e.routeJson.data
      if (sourceDeclares && censusData === undefined) {
        problems.push(
          'the source declares `data:` but the compiled census carries none — the governed ' +
            'declaration was dropped in fan-out, so the route would BOOT UNGATED',
        )
      } else if (!sourceDeclares && censusData !== undefined) {
        problems.push('the census carries `data:` the source never declared')
      } else if (censusData !== undefined) {
        const norm = normalizeGovernedData(censusData)
        if (norm === 'malformed' || norm === null) {
          problems.push('the census `data:` does not survive the runtime normalizer (malformed)')
        } else {
          if (!e.source.includes(`'${norm.type}'`) && !e.source.includes(`"${norm.type}"`)) {
            problems.push(`census data.type '${norm.type}' does not appear in the source`)
          }
          for (const field of norm.preview ?? []) {
            if (!e.source.includes(`'${field}'`) && !e.source.includes(`"${field}"`)) {
              problems.push(`census preview field '${field}' does not appear in the source`)
            }
          }
        }
      }
    }

    if (problems.length > 0) {
      findings.push({
        where: e.rel,
        rule: 'DA-f2',
        message: `artifact agreement broken — ${problems.join('; ')}.`,
      })
    }
  }
  return findings
}

/** The committed conformance corpus: source + sibling artifacts. */
function routeArtifactEntries(base = ROOT): RouteArtifactEntry[] {
  const out: RouteArtifactEntry[] = []
  for (const m of new Glob('bench/compiler-conformance/route/*.aihu').scanSync(base)) {
    const rel = m.replaceAll('\\', '/')
    const stem = rel.slice(0, -'.aihu'.length)
    const goldenPath = join(base, `${stem}.golden.js`)
    const routeJsonPath = join(base, `${stem}.route.json`)
    out.push({
      rel,
      source: readFileSync(join(base, rel), 'utf8'),
      golden: existsSync(goldenPath) ? readFileSync(goldenPath, 'utf8') : null,
      routeJson: existsSync(routeJsonPath)
        ? (JSON.parse(readFileSync(routeJsonPath, 'utf8')) as Record<string, unknown>)
        : null,
    })
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel))
}

/**
 * The root repository consumes compiler output through the published package.
 * Keep that boundary explicit: the standalone compiler owns Rust source and
 * golden tests, while this check proves the consumer has the released artifact
 * and no stale in-tree compiler checkout that could mask a bad dependency.
 */
function daF2CompilerArtifactFindings(base = ROOT): Finding[] {
  const findings: Finding[] = []
  const sourcePath = join(base, 'packages/compiler')
  if (existsSync(sourcePath)) {
    findings.push({
      where: 'packages/compiler',
      rule: 'DA-f2',
      message:
        'the root checkout still contains compiler source; compiler ownership belongs to ' +
        'the standalone aihu-compiler repository.',
    })
  }

  const manifestPath = join(base, 'node_modules/@aihu/compiler/package.json')
  if (!existsSync(manifestPath)) {
    findings.push({
      where: 'node_modules/@aihu/compiler/package.json',
      rule: 'DA-f2',
      message:
        'the published @aihu/compiler consumer artifact is missing; reinstall the locked ' +
        'dependency before trusting the sidecar agreement.',
    })
    return findings
  }

  let manifest: { name?: unknown; version?: unknown }
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof manifest
  } catch {
    findings.push({
      where: 'node_modules/@aihu/compiler/package.json',
      rule: 'DA-f2',
      message: 'the published @aihu/compiler package manifest is not valid JSON.',
    })
    return findings
  }
  if (manifest.name !== '@aihu/compiler' || typeof manifest.version !== 'string') {
    findings.push({
      where: 'node_modules/@aihu/compiler/package.json',
      rule: 'DA-f2',
      message: 'the installed compiler artifact has no valid @aihu/compiler name/version.',
    })
  }
  if (!existsSync(join(base, 'node_modules/@aihu/compiler/dist/index.d.ts'))) {
    findings.push({
      where: 'node_modules/@aihu/compiler/dist/index.d.ts',
      rule: 'DA-f2',
      message: 'the installed @aihu/compiler artifact is missing its public type entrypoint.',
    })
  }
  return findings
}

// ─── DA-f3 (GX P5 #467): discovery agreement with the declared read: ─────────

interface DaF3Docs {
  readonly robots: string
  readonly llms: string
}

interface DaF3Route {
  readonly pattern: string
  readonly extract?: { readonly read?: unknown; readonly call?: unknown }
}

/** Pure agreement core over generated documents (self-testable). */
async function daF3Disagreements(
  routes: ReadonlyArray<DaF3Route>,
  docs: DaF3Docs,
  noindexByPattern: ReadonlyMap<string, boolean>,
): Promise<string[]> {
  const { deriveReadPolicy, extractReadValue } = await import('@aihu/server')
  const bad: string[] = []
  for (const route of routes) {
    const d = deriveReadPolicy(extractReadValue(route.extract))
    const value = typeof d.value === 'string' ? d.value : `scope:${d.value.scope}`
    // The static prefix is what a robots directive would name for this route.
    const prefix = route.pattern.split('[')[0]!

    if (!d.advertiseInRobots) {
      // Hard/malformed: existence never advertised — no directive may NAME it.
      if (docs.robots.includes(prefix)) {
        bad.push(`robots.txt names hard surface '${route.pattern}' (read=${value})`)
      }
    } else if (d.value === 'none') {
      if (!docs.robots.includes(`Disallow: ${prefix}`)) {
        bad.push(`robots.txt lacks the Disallow for '${route.pattern}' (read='none')`)
      }
    }

    if (d.agentDiscovery) {
      if (!docs.llms.includes(route.pattern)) {
        bad.push(`llms.txt does not list public surface '${route.pattern}' (read=${value})`)
      }
    } else if (docs.llms.includes(route.pattern)) {
      bad.push(`llms.txt lists non-agent-discoverable surface '${route.pattern}' (read=${value})`)
    }

    const served = noindexByPattern.get(route.pattern)
    if (served !== undefined && served !== d.noindex) {
      bad.push(
        `served X-Robots-Tag noindex=${served} disagrees with declared read=${value} ` +
          `(derivation says noindex=${d.noindex}) for '${route.pattern}'`,
      )
    }
  }
  return bad
}

/** The full read-value vocabulary as a synthetic census, plus the REAL one. */
function daF3RouteTable(census: DaF3Route): DaF3Route[] {
  return [
    { pattern: '/pub-all', extract: { read: 'all', call: 'anonymous' } },
    { pattern: '/pub-agents', extract: { read: 'agents', call: 'anonymous' } },
    { pattern: '/pub-search', extract: { read: 'search', call: 'anonymous' } },
    { pattern: '/private-notes', extract: { read: 'none', call: 'anonymous' } },
    { pattern: '/hard-verified', extract: { read: 'verified', call: 'anonymous' } },
    { pattern: '/hard-human', extract: { read: 'human', call: 'anonymous' } },
    { pattern: '/hard-scoped', extract: { read: { scope: 'members' }, call: 'anonymous' } },
    { pattern: '/mal-formed', extract: { read: 42, call: 'anonymous' } },
    census,
  ]
}

async function runDaF3(mode: ProbeMode): Promise<{ bad: string[]; finding: Finding | null }> {
  const { generateLlmsTxt, generateRobotsTxt } = await import('@aihu-plugin/agent-readiness')
  const { createServerRouter } = await import('@aihu/router/server')
  const { branch, leaf } = await import('@aihu/arbor')
  const { loadGovernedCensus, makeGovernedFixture, govReq } = await import(
    './lib/governed-fixture.ts'
  )

  const census = loadGovernedCensus()
  const table = daF3RouteTable({ pattern: census.pattern, extract: census.extract })

  // The REAL generators over the census (the artifacts a deploy ships).
  let robots = generateRobotsTxt({ routes: table })
  let llms = generateLlmsTxt({
    name: 'discovery-probe',
    sections: [],
    routes: table,
    baseUrl: 'https://probe.test',
  })
  if (mode === 'regressed') {
    // The leak shape a generator regression would produce: the governed
    // surface advertised in both anonymous artifacts. Composed onto the real
    // documents so the assertions face otherwise-correct output.
    robots += `\nUser-agent: *\nDisallow: ${census.pattern.split('[')[0]}`
    llms += `\n- [${census.pattern}](https://probe.test${census.pattern})`
  }

  // The served-header leg: drive the REAL server router for every synthetic
  // (ungoverned) route and record the noindex signal it actually sends.
  const noindexByPattern = new Map<string, boolean>()
  const syntheticRoutes = table.filter((r) => r.pattern !== census.pattern)
  const routes = syntheticRoutes.map((r) => ({
    pattern: r.pattern,
    segments: [{ kind: 'static' as const, path: r.pattern.slice(1) }],
    module: async () => ({ default: () => branch('main', undefined, [leaf('discovery probe')]) }),
    extract: r.extract,
  })) as never
  const router = createServerRouter(routes)
  for (const r of syntheticRoutes) {
    const res = await router.handle(new Request(`http://discovery.probe${r.pattern}`))
    noindexByPattern.set(r.pattern, res.headers.get('X-Robots-Tag')?.includes('noindex') ?? false)
  }
  // The governed census route is served by the governed pipeline — its
  // noindex signal is asserted from the shared fixture's ENTITLED response
  // (the header must ride even a granted emission).
  const fx = await makeGovernedFixture()
  const entitled = await fx.router.handle(govReq(fx.path, 'member-token'))
  noindexByPattern.set(
    census.pattern,
    entitled.headers.get('X-Robots-Tag')?.includes('noindex') ?? false,
  )

  const bad = await daF3Disagreements(table, { robots, llms }, noindexByPattern)
  if (bad.length === 0) return { bad, finding: null }
  return {
    bad,
    finding: {
      where: 'packages/plugin-agent-readiness/src/robots.ts:363',
      rule: 'DA-f3',
      message:
        `discovery artifacts disagree with declared read: policies — ${bad.length} ` +
        `disagreement(s): ${bad.join('; ')}.`,
    },
  }
}

// ─── DA-g (#437 DA4): shadow-page census over the conformance corpus ─────────
//
// The ratified DA4 shape: `$shadow` is PURE ENCAPSULATION with ZERO
// extractability semantics, and extractability policy is NEVER inferred from
// rendering mode. A "page is shadow → fail" rule would re-derive policy from
// rendering mode — the exact anti-pattern the GX thesis forbids. So the census
// below is INFORMATIONAL: it prints each route fixture's AUTHORED shadow
// state (an explicit `$shadow` pin shows its pin; an unpinned page shows
// "default (light DOM)") and is never a finding on its own.
//
// ONE narrow HARD case rides the census: a route that declares `ssr: true`
// AND a public `read:` (`all` | `agents` | `search`) AND an EXPLICIT
// `$shadow: 'shadow'` pin. That combination is self-contradictory — the
// author declared crawl-reachability and simultaneously pinned the mode
// that seals the served DOM against non-JS adoption (the same
// `shadowrootmode` unreachability DA-c/DA-d assert on). Every leg is an
// explicit author declaration; nothing keys on the rendering-mode DEFAULT,
// so the rule survives the DA4 default flip unchanged and does not violate
// the never-infer-from-rendering-mode ratification.
//
// The value set is the ratified BINARY vocabulary: `'light' | 'shadow'`
// (`'shadow'` attaches a shadow root under the hood; the pre-ratification
// three-value mode vocabulary is gone).
//
// Pin detection: the `// @aihu:shadow <mode>` marker in the committed golden
// exists iff the author wrote `$shadow` (`route_shadow_warning.rs` pins that
// no synthetic marker is ever emitted), so the marker IS the authored state
// for fixtures with a golden; fixtures without one (03-route-with-head) fall
// back to the `$shadow` declaration in the source. Same text-shape posture as
// DA-e: no Rust binary required on a plain checkout.

type ShadowPin = 'light' | 'shadow'

interface ShadowCensusRow {
  readonly rel: string
  readonly pattern: string
  readonly ssr: boolean
  /** Canonical `read:` token from the census sidecar, or null when absent. */
  readonly read: string | null
  /** The EXPLICIT author pin, or null when unpinned (the default applies). */
  readonly pin: ShadowPin | null
  readonly pinSource: 'marker' | 'source' | null
}

const SHADOW_MARKER_RE = /^\/\/ @aihu:shadow (light|shadow)\b/m
const SHADOW_SOURCE_RE = /^\s*\$shadow\s*:\s*['"](light|shadow)['"]/m

function shadowCensusRow(e: RouteArtifactEntry): ShadowCensusRow {
  const marker = (e.golden?.match(SHADOW_MARKER_RE)?.[1] ?? null) as ShadowPin | null
  const authored = (e.source.match(SHADOW_SOURCE_RE)?.[1] ?? null) as ShadowPin | null
  const pin = marker ?? authored
  const extract = e.routeJson?.extract as { read?: unknown } | undefined
  return {
    rel: e.rel,
    pattern: String(e.routeJson?.pattern ?? '(no .route.json)'),
    ssr: e.routeJson?.ssr === true,
    read: canonicalExtractToken(extract?.read),
    pin,
    pinSource: marker !== null ? 'marker' : authored !== null ? 'source' : null,
  }
}

/** The `read:` values that declare the surface publicly crawlable. */
const PUBLIC_READS: ReadonlySet<string> = new Set(['all', 'agents', 'search'])

/** The one hard case — explicit contradiction only, never the default. */
function daGFindings(rows: ReadonlyArray<ShadowCensusRow>): Finding[] {
  const findings: Finding[] = []
  for (const r of rows) {
    const publicRead = r.read !== null && PUBLIC_READS.has(r.read)
    if (r.ssr && publicRead && r.pin === 'shadow') {
      findings.push({
        where: r.rel,
        rule: 'DA-g',
        message:
          `self-contradictory declarations on '${r.pattern}': \`ssr: true\` + public ` +
          `\`read: '${r.read}'\` + an explicit \`$shadow: '${r.pin}'\` pin. The author declared ` +
          'crawl-reachability (SSR + a public read: policy) and simultaneously pinned the ' +
          'rendering mode that seals the served DOM inside a shadow root non-JS agents cannot ' +
          'adopt. All three legs are explicit author declarations — nothing here is inferred ' +
          "from the rendering-mode default. Resolve by dropping the pin (or pinning 'light'), " +
          'or by narrowing the read: policy to match the intended audience.',
      })
    }
  }
  return findings
}

// ─── Self-test ───────────────────────────────────────────────────────────────

/** A fixture that DOES implement the resolver — DA-a's should-not-flag half. */
const RESOLVER_FIXTURE = `
  export class FileMarkdownResolver {
    async resolve(path: string): Promise<string | null> {
      return path.endsWith('.md') ? '# hi' : null
    }
  }
`
/** Shapes DA-a must REFUSE: a type, a mock, a config field. */
const NON_RESOLVER_FIXTURE = `
  export interface MarkdownResolver {
    resolve(path: string): Promise<string | null>
  }
  export type { MarkdownResolver as Resolver }
  export interface ContentNegotiationOptions {
    readonly resolver: MarkdownResolver
  }
  const notExported = { resolve: async () => null }
`

async function runSelfTest(): Promise<void> {
  const cases: Array<{ label: string; actual: number; expected: number }> = []

  // DA-a, both directions.
  cases.push({
    label: 'DA-a should-flag: only a type declaration + an unexported mock',
    actual: runDaA([{ rel: 'fixture/types.ts', source: NON_RESOLVER_FIXTURE }]).finding ? 1 : 0,
    expected: 1,
  })
  cases.push({
    label: 'DA-a should-not-flag: a real exported resolver class',
    actual: runDaA([{ rel: 'fixture/impl.ts', source: RESOLVER_FIXTURE }]).finding ? 1 : 0,
    expected: 0,
  })

  // DA-b, both directions. Inverted vs. pre-DA2: the REGRESSION is now the
  // mutation and the LIVE path is the passing case.
  cases.push({
    label: 'DA-b should-flag: Accept-only negotiation (userAgentFallback disabled)',
    actual: (await runDaB(true)).finding ? 1 : 0,
    expected: 1,
  })
  cases.push({
    label: 'DA-b should-not-flag: live UA-aware negotiation',
    actual: (await runDaB(false)).finding ? 1 : 0,
    expected: 0,
  })

  // DA-c, both directions. Polarity inverted by DA3: the live router is now
  // the should-NOT-flag control, and the regression is simulated.
  cases.push({
    label: 'DA-c should-flag: non-hydratable render (the pre-DA3 regression)',
    actual: (await runDaC('regressed')).finding ? 1 : 0,
    expected: 1,
  })
  cases.push({
    label: 'DA-c should-not-flag: live router, now passing hydratable: true',
    actual: (await runDaC('live')).finding ? 1 : 0,
    expected: 0,
  })

  // DA-e detector, both directions. Informational today, but a detector that
  // cannot discriminate would report a meaningless count — same bar as the
  // enforced rules. `$shadow: 'light'` and `$shadow: 'shadow'` must BOTH count as
  // pinned (the macro always wins in the ratified classifier), and a leaf with
  // no `@route` must never count.
  cases.push({
    label: 'DA-e should-flag: @route block, no $shadow',
    actual: runDaE([
      {
        rel: 'fixture/page.aihu',
        source: '@template {\n  <div>hi</div>\n}\n@route {\n  path: /\n}\n',
      },
    ]).length,
    expected: 1,
  })
  cases.push({
    label: 'DA-e should-not-flag: $shadow pinned, and a routeless leaf',
    actual: runDaE([
      {
        rel: 'fixture/pinned.aihu',
        source:
          "@state {\n  $shadow: 'shadow'\n}\n@template {\n  <div>hi</div>\n}\n@route {\n  path: /\n}\n",
      },
      { rel: 'fixture/leaf.aihu', source: '@template {\n  <button>ok</button>\n}\n' },
    ]).length,
    expected: 0,
  })

  // DA-d, both directions. Same inversion, landed by DA3b.
  cases.push({
    label: 'DA-d should-flag: non-hydratable prerender (the pre-DA3b regression)',
    actual: (await runDaD('regressed')).finding ? 1 : 0,
    expected: 1,
  })
  cases.push({
    label: 'DA-d should-not-flag: live runPrerender, now passing hydratable: true',
    actual: (await runDaD('live')).finding ? 1 : 0,
    expected: 0,
  })

  // DA-f1 (GX P5), both directions: the live governed pipeline is byte-clean;
  // a withheld response serialized from the granted payload must flag.
  cases.push({
    label: 'DA-f1 should-flag: withheld loader embed carries the granted payload',
    actual: (await runDaF1('regressed')).finding ? 1 : 0,
    expected: 1,
  })
  cases.push({
    label: 'DA-f1 should-not-flag: live governed responses (P4 landed)',
    actual: (await runDaF1('live')).finding ? 1 : 0,
    expected: 0,
  })

  // DA-f2, both directions, on SYNTHETIC entries — the checker must see a
  // drifted marker and a dropped `data:` census member, and must pass a
  // fixture whose artifacts genuinely agree.
  const agreeing: RouteArtifactEntry = {
    rel: 'fixture/agree.aihu',
    source:
      "@route {\n  path: '/x',\n  extract: { read: { scope: 'm' } },\n  data: { type: 'T', preview: ['a'] }\n}\n",
    golden: '// @aihu:extract read=scope:m call=anonymous\nexport default 1\n',
    routeJson: {
      pattern: '/x',
      extract: { read: { scope: 'm' }, call: 'anonymous' },
      data: { type: 'T', preview: ['a'] },
    },
  }
  cases.push({
    label: 'DA-f2 should-not-flag: marker ≡ route.json ≡ source (agreeing fixture)',
    actual: (await daF2Findings([agreeing])).length,
    expected: 0,
  })
  cases.push({
    label: 'DA-f2 should-flag: drifted marker + dropped data: census member',
    actual: (
      await daF2Findings([
        { ...agreeing, golden: '// @aihu:extract read=agents call=anonymous\n' },
        {
          ...agreeing,
          rel: 'fixture/dropped.aihu',
          routeJson: { pattern: '/x', extract: agreeing.routeJson!.extract },
        },
      ])
    ).length,
    expected: 2,
  })

  // DA-g, both directions, on SYNTHETIC corpus entries. The hard case must
  // bite on the explicit contradiction (ssr + public read + shadow pin) and
  // must stay silent on every non-contradictory neighbor — most importantly
  // the UNPINNED ssr+public page, because a rule that fired there would be
  // keying on the rendering-mode DEFAULT, the ratified anti-pattern.
  const daGContradictory: RouteArtifactEntry = {
    rel: 'fixture/contradictory.aihu',
    source:
      "@state {\n  $shadow: 'shadow'\n}\n@template {\n  <div>hi</div>\n}\n@route {\n  path: '/leak',\n  ssr: true,\n  extract: { read: 'agents' }\n}\n",
    golden: '// @aihu:shadow shadow\nexport default 1\n',
    routeJson: { pattern: '/leak', ssr: true, extract: { read: 'agents', call: 'anonymous' } },
  }
  cases.push({
    label: "DA-g should-flag: ssr:true + public read + explicit $shadow: 'shadow' pin",
    actual: daGFindings([shadowCensusRow(daGContradictory)]).length,
    expected: 1,
  })
  cases.push({
    label: 'DA-g should-not-flag: pinned shadow without public+ssr; pin light; unpinned default',
    actual: daGFindings(
      [
        // Pinned shadow, but a HARD read — no crawl-reachability was declared.
        {
          ...daGContradictory,
          rel: 'fixture/hard-read.aihu',
          routeJson: {
            pattern: '/members',
            ssr: true,
            extract: { read: { scope: 'members' }, call: 'anonymous' },
          },
        },
        // Pinned shadow + public read, but NO ssr — nothing served to seal.
        {
          ...daGContradictory,
          rel: 'fixture/no-ssr.aihu',
          routeJson: {
            pattern: '/spa',
            ssr: false,
            extract: { read: 'agents', call: 'anonymous' },
          },
        },
        // ssr + public read, pinned to 'light' — the crawlable mode.
        {
          ...daGContradictory,
          rel: 'fixture/light.aihu',
          source:
            "@state {\n  $shadow: 'light'\n}\n@template {\n  <div>hi</div>\n}\n@route {\n  path: '/light',\n  ssr: true,\n  extract: { read: 'agents' }\n}\n",
          golden: '// @aihu:shadow light\nexport default 1\n',
        },
        // ssr + public read, UNPINNED — the default is never a finding.
        {
          ...daGContradictory,
          rel: 'fixture/unpinned.aihu',
          source:
            "@template {\n  <div>hi</div>\n}\n@route {\n  path: '/plain',\n  ssr: true,\n  extract: { read: 'agents' }\n}\n",
          golden: 'export default 1\n',
        },
      ].map(shadowCensusRow),
    ).length,
    expected: 0,
  })

  // DA-f3, both directions: the real generators agree; hand-leaked documents
  // (a Disallow naming the governed path, an llms.txt row listing it) flag.
  cases.push({
    label: 'DA-f3 should-flag: discovery documents advertising a hard surface',
    actual: (await runDaF3('regressed')).finding ? 1 : 0,
    expected: 1,
  })
  cases.push({
    label: 'DA-f3 should-not-flag: live generators + served noindex signals',
    actual: (await runDaF3('live')).finding ? 1 : 0,
    expected: 0,
  })

  selfTest(NAME, cases)
}

// ─── Main ────────────────────────────────────────────────────────────────────

await runSelfTest()

const entries = publicEntrySources()
refuseVacuous(entries, NAME, 'package public entry sources')

const findings: Finding[] = []

const daA = runDaA(entries)
if (daA.finding) findings.push(daA.finding)

const daB = await runDaB(false)
if (daB.finding) findings.push(daB.finding)

const daC = await runDaC('live')
if (daC.finding) findings.push(daC.finding)

const daD = await runDaD('live')
if (daD.finding) findings.push(daD.finding)

// DA-f1 — the standing byte check over the live governed pipeline.
const daF1 = await runDaF1('live')
if (daF1.finding) findings.push(daF1.finding)

// DA-f2 — artifact agreement over the committed conformance corpus, plus the
// existence pins for the legs the Rust suite owns. Census printed per run
// (spec §10: "Census print every run").
const artifactEntries = routeArtifactEntries()
refuseVacuous(artifactEntries, NAME, 'conformance route fixtures (DA-f2)')
console.log(`${NAME} — DA-f2 census (${artifactEntries.length} compiled route fixture(s)):`)
for (const e of artifactEntries) {
  const ex = (e.routeJson?.extract ?? {}) as { read?: unknown; call?: unknown }
  const data = e.routeJson?.data as { type?: string; preview?: string[] } | undefined
  console.log(
    `  ${e.rel}  read=${canonicalExtractToken(ex.read) ?? '(absent)'} ` +
      `call=${canonicalExtractToken(ex.call) ?? '(absent)'}` +
      (data ? ` data=${data.type}[preview: ${(data.preview ?? []).join(', ')}]` : ''),
  )
}
for (const f of await daF2Findings(artifactEntries)) findings.push(f)
for (const f of daF2CompilerArtifactFindings()) findings.push(f)

// DA-g — the shadow-page census over the same corpus. INFORMATIONAL: a page's
// shadow mode is never a finding by itself (`$shadow` is pure encapsulation;
// policy is never inferred from rendering mode). Only the explicit
// ssr+public-read+shadow-pin contradiction is a finding.
const shadowRows = artifactEntries.map(shadowCensusRow)
console.log(
  `${NAME} — DA-g shadow-page census (${shadowRows.length} route fixture(s); informational — ` +
    "a page's shadow mode is NEVER a finding on its own):",
)
for (const r of shadowRows) {
  const mode = r.pin === null ? 'default (light DOM)' : `pinned '${r.pin}' (${r.pinSource})`
  console.log(`  ${r.rel}  shadow=${mode}  ssr=${r.ssr} read=${r.read ?? '(absent)'}`)
}
for (const f of daGFindings(shadowRows)) findings.push(f)

// DA-f3 — discovery agreement across the read-value vocabulary + the census.
const daF3 = await runDaF3('live')
if (daF3.finding) findings.push(daF3.finding)
console.log(
  `${NAME} — DA-f3: robots/llms/noindex agreement over ${daF3.bad.length === 0 ? 'all' : ''} ` +
    `9 read-value surfaces (incl. the compiled census route). NOTE (honest scope): ` +
    'per-principal discovery — an authenticated listing of entitled surfaces — has no ' +
    'shipped surface yet; that leg activates when one lands.',
)

// DA-e — reported, NEVER pushed to `findings` (informational census).
const aihuFiles = aihuSources()
const daE = runDaE(aihuFiles)
console.log(
  `${NAME} — informational (DA-e, #437 DA4): ${daE.length} route component(s) without an ` +
    `explicit $shadow, of ${aihuFiles.length} shipped .aihu file(s) scanned. The DA4 flip ` +
    'LANDED: these ARE light DOM now by default (W472 retired with the flip). This census ' +
    'tracks unpinned pages; ratcheting it into a finding class is a follow-up decision.',
)
for (const rel of daE) console.log(`  ${rel}  [DA-e informational]`)

console.log(
  `${NAME} — scanned ${entries.length} public-entry source file(s); ran ${UA_MATRIX.length} ` +
    'negotiation cells, 1 SSR render and 1 SSG prerender.',
)
expectCount(findings, expectedFrom(process.argv, 'dual-audience'), NAME)
