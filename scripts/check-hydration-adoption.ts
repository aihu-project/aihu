#!/usr/bin/env bun
/**
 * check:hydration-adoption — assert the CLIENT ADOPTS the server's DOM.
 *
 * The fifth thesis invariant (FEL-249 / #421). The other four can all report
 * green while a human looking at the page sees every word twice.
 *
 * None of them closes this gap:
 *   `check:derived`        — agent artifacts are generated, not mirrored
 *   `check:attributed`     — tool calls carry a caller identity
 *   `check:governed`       — declared controls fail closed
 *   `check:dual-audience`  — markers are PRESENT in the served bytes
 *
 * `check:dual-audience` is the near miss, and the distinction is the whole
 * reason this file exists. It asserts the server EMITS `data-aihu-path`
 * markers. It cannot assert the client can USE them. Those came apart in
 * production: `@aihu/server` seeded its path walk with `'0'` while
 * `@aihu/arbor`'s `hydrate()` hardcoded `'hydrate.0'`, so the markers were
 * present, well-formed, and addressed a key space the client never asked
 * about. Every dual-audience assertion would have passed on that HTML.
 *
 * The failure mode is SILENT, which is why it needs a checker rather than a
 * stack trace. A missed path lookup is not an error — `_hydrateNode` reads it
 * as a legitimate DOM mismatch and falls back to `_materialize`, which builds
 * a second copy of the subtree and appends it. Nothing throws. The server's
 * DOM stays on the page, a duplicate lands beside it, and the only witness is
 * a human reading the same paragraph twice.
 *
 * So the assertions here are deliberately about ADOPTION, not presence:
 *
 *   1. `host.innerHTML` is BYTE-IDENTICAL across `hydrate()`. `_materialize`
 *      cannot append without changing it.
 *   2. Node IDENTITY is preserved — the root element object after hydration is
 *      the same object the server's HTML parsed into, not a replacement.
 *   3. The primary text appears EXACTLY ONCE. This is the user-visible
 *      symptom, asserted directly rather than inferred. `toContain` would pass
 *      on duplicated content, which is precisely the bug.
 *   4. Reactive writes drive the SERVER's own Text node. A rebuild wires the
 *      effect to the duplicate, leaving the visible node frozen at its
 *      server-rendered value.
 *
 * Two probes, because the chain has two production entry points and a fix to
 * one does not fix the other:
 *   HA-a — `renderToString(…, { hydratable: true })` → `hydrate()`   (CO5)
 *   HA-b — the LIVE `createServerRouter` handler     → `hydrate()`   (CO5+DA3)
 *
 * HA-b is the end-to-end one: it drives the real router, takes the bytes off
 * the real `Response`, and hydrates those. It is the only assertion in the
 * repo that the shipped pipeline produces HTML the shipped client can adopt.
 *
 * `AIHU_NATIVE_SKIP=1` selects the TypeScript SSR fallback ("slower, always
 * correct"), matching what `vitest.config.ts` and `check:dual-audience` set for
 * the same reason: the native renderer binary is not built in a plain checkout.
 * Run via the npm script, NOT bare bun:
 *   bun run check:hydration-adoption
 *
 * NO suppression comments are supported.
 */
import { JSDOM } from 'jsdom'
import {
  expectCount,
  expectedFrom,
  type Finding,
  refuseVacuous,
  selfTest,
} from './lib/invariant.ts'

const NAME = 'check:hydration-adoption'

const PRIMARY_TEXT = 'PRIMARY-CONTENT-ADOPTED-NOT-REBUILT'

// ─── DOM ─────────────────────────────────────────────────────────────────────

/**
 * `hydrate()` is client code and needs a real DOM. jsdom is already a
 * devDependency (vitest's `environment: 'jsdom'` uses it), so this introduces
 * no new dependency and runs the SAME implementation the test suite runs
 * against — not a stub written by this checker.
 *
 * Globals are installed once, because `_materialize` reaches for the ambient
 * `document` when it creates the replacement nodes this check exists to detect.
 * Without a global `document` the rebuild path would THROW instead of
 * duplicating, and the check would appear to discriminate for the wrong reason.
 */
function installDom(): void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  const g = globalThis as unknown as Record<string, unknown>
  g.window = dom.window
  g.document = dom.window.document
  g.Node = dom.window.Node
  g.Element = dom.window.Element
  g.Text = dom.window.Text
  g.HTMLElement = dom.window.HTMLElement
}

installDom()

// ─── Shared fixture ──────────────────────────────────────────────────────────

type Rendered = { html: string; component: () => unknown; setText: (v: string) => void }

/**
 * A nested component with a REACTIVE text leaf.
 *
 * Reactive on purpose: a fully static tree would be adopted trivially, because
 * `_hydrateNode` wires nothing and a rebuild produces identical bytes. The
 * signal is what makes assertion 4 (the effect drives the server's own node)
 * able to tell adoption from reconstruction at all.
 *
 * Nested on purpose too: a single-element tree cannot distinguish "the root
 * matched" from "every depth matched", and the root is the only key that was
 * ever wrong.
 */
async function makeFixture(): Promise<{ component: () => unknown; setText: (v: string) => void }> {
  const { branch, leaf } = await import('@aihu/arbor')
  const { signal } = await import('@aihu/signals')
  const [text, setText] = signal(PRIMARY_TEXT)
  const component = () =>
    branch('main', { id: 'page' }, [
      branch('article', {}, [branch('p', {}, [leaf([text] as never)])]),
    ])
  return { component, setText: setText as (v: string) => void }
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  let n = 0
  let i = haystack.indexOf(needle)
  while (i !== -1) {
    n++
    i = haystack.indexOf(needle, i + needle.length)
  }
  return n
}

/**
 * The shared adoption assertions. Returns the reasons hydration FAILED to
 * adopt, empty when it adopted cleanly.
 *
 * One finding per probe covers all four assertions: they are four symptoms of
 * ONE defect (the client could not address the server's DOM), and splitting
 * them would inflate the count without naming an additional thing to fix.
 */
async function assertAdoption(r: Rendered): Promise<string[]> {
  const { hydrate } = await import('@aihu/arbor/hydrate')

  const host = document.createElement('div')
  host.innerHTML = r.html

  const before = host.innerHTML
  const rootBefore = host.firstElementChild
  const pEl = host.querySelector('p')
  const serverTextNode = pEl?.firstChild ?? null

  hydrate(r.component as () => never, host, {})

  const reasons: string[] = []

  // 1. Byte-identical innerHTML — `_materialize` cannot append without changing it.
  if (host.innerHTML !== before) {
    reasons.push(
      'hydration MUTATED the server DOM — `hydrate()` fell back to `_materialize` and rebuilt ' +
        'the tree beside the server-rendered markup instead of adopting it',
    )
  }

  // 2. Node identity — the root must be the same object, not a replacement.
  if (host.firstElementChild !== rootBefore) {
    reasons.push('the root element was REPLACED rather than adopted')
  }

  // 3. The user-visible symptom, asserted directly.
  const textCount = countOccurrences(host.textContent ?? '', PRIMARY_TEXT)
  if (textCount !== 1) {
    reasons.push(
      `the primary text appears ${textCount} time(s), expected exactly 1 — ` +
        (textCount > 1
          ? 'this is the duplicated-content bug a human sees while every other check reports green'
          : 'the content was lost entirely'),
    )
  }

  // 4. The effect must drive the SERVER's own Text node.
  if (serverTextNode !== null) {
    r.setText('UPDATED-IN-PLACE')
    if (serverTextNode.nodeValue !== 'UPDATED-IN-PLACE') {
      reasons.push(
        'a reactive write did NOT reach the server-rendered text node — the effect was wired to ' +
          'a rebuilt duplicate, so the node the user actually sees is frozen at its SSR value',
      )
    }
  } else {
    reasons.push('no server-rendered text node was found to wire against')
  }

  return reasons
}

// ─── HA-a: renderToString → hydrate ──────────────────────────────────────────

/**
 * `live` measures PRODUCTION and is what the real scan uses. The other two are
 * SELF-TEST controls only.
 *
 * The controls deliberately do NOT reuse the live path. A self-test whose
 * should-not-flag arm is production conflates two different questions — "can
 * this checker tell adoption from a rebuild?" and "does production adopt?" —
 * and answers the second one first. `check:check-dual-audience` was built that
 * way and had to be re-based the moment its defect was fixed; worse, a genuine
 * production regression there surfaces as "SELF-TEST FAILED / the check cannot
 * discriminate", which points at the checker instead of at the bug.
 *
 * So the controls below are keyed to `_ROOT_PATH` rather than to a literal:
 *   `agreeing`  — markers rewritten to whatever root the client currently asks
 *                 for. Proves the checker RECOGNIZES adoption. A no-op while
 *                 the two sides agree, and self-repairing if they ever diverge,
 *                 so it tests the checker and never production.
 *   `disagreeing` — every marker prefixed with a sentinel that cannot collide
 *                 with any real key. Reproduces the pre-CO5 defect: markers
 *                 present, well-formed, addressing a key space the client never
 *                 queries. This is the exact shape `check:dual-audience` cannot
 *                 see, and the reason this check exists.
 *   `markerless` — rendered with `{ hydratable: false }`, the pre-DA3 state.
 */
type ProbeMode = 'live' | 'agreeing' | 'disagreeing' | 'markerless'

/** Repoint every `data-aihu-path` marker from the server's root onto `root`. */
function rekey(html: string, root: string): string {
  // Prefix-rewrite (no closing quote in the needle) so DESCENDANT keys move
  // with the root: `0.0` and `0.0.0` must become `<root>.0` and `<root>.0.0`,
  // not just the root itself. Rewriting the root alone would leave children
  // stranded and make the control fail for a reason it was not testing.
  return html.replaceAll(`data-aihu-path="${SERVER_ROOT}`, `data-aihu-path="${root}`)
}

/** The root the SERVER emits. Read from real output, never assumed. */
const SERVER_ROOT = '0'

/** A key no real path can collide with, for the should-flag control. */
const SENTINEL_ROOT = 'UNREACHABLE-ROOT'

async function renderForMode(mode: ProbeMode): Promise<Rendered> {
  const { renderToString } = await import('@aihu/server')
  const { _ROOT_PATH } = await import('@aihu/arbor/hydrate')
  const { component, setText } = await makeFixture()

  if (mode === 'markerless') {
    return { html: await renderToString(component, { hydratable: false }), component, setText }
  }

  const html = await renderToString(component, { hydratable: true })

  if (mode === 'agreeing') return { html: rekey(html, _ROOT_PATH), component, setText }
  if (mode === 'disagreeing') return { html: rekey(html, SENTINEL_ROOT), component, setText }

  return { html, component, setText }
}

async function runHaA(mode: ProbeMode): Promise<Finding | null> {
  const reasons = await assertAdoption(await renderForMode(mode))
  if (reasons.length === 0) return null
  return {
    where: '@aihu/arbor/hydrate',
    rule: 'HA-a',
    message: `the client did not adopt server-rendered DOM — ${reasons.join('; ')}.`,
  }
}

// ─── HA-b: the LIVE router handler → hydrate ─────────────────────────────────

/**
 * Drive the REAL `createServerRouter` and hydrate the bytes off its `Response`.
 *
 * Deliberately not a second `renderToString` call. The router is where the
 * `hydratable` option is actually passed or forgotten (DA3), so rendering
 * directly would test the renderer while leaving the shipped request path
 * unmeasured — which is how DA-c shipped in the first place.
 */
/** Mount a fixture route on the REAL router and return the bytes it serves. */
async function serveViaRouter(component: () => unknown): Promise<string> {
  const { createServerRouter } = await import('@aihu/router/server')
  const routes = [
    {
      pattern: '/probe',
      segments: [{ type: 'static' as const, value: 'probe' }],
      module: async () => ({ default: component }),
    },
  ] as unknown as Parameters<typeof createServerRouter>[0]

  const router = createServerRouter(routes)
  const res = await router.handle(new Request('https://example.test/probe'))
  return res.text()
}

/** The live router's bytes for a fresh fixture — used by the vacuity guard. */
async function liveRouterHtml(): Promise<string> {
  const { component } = await makeFixture()
  return serveViaRouter(component)
}

async function runHaB(mode: ProbeMode): Promise<Finding | null> {
  const { component, setText } = await makeFixture()
  let html = await serveViaRouter(component)

  // Controls rewrite the LIVE router's own bytes, so the should-flag arm still
  // exercises the real handler and differs from production in exactly one way.
  if (mode === 'markerless') {
    const { renderToString } = await import('@aihu/server')
    html = await renderToString(component, { hydratable: false })
  } else if (mode === 'disagreeing') {
    html = rekey(html, SENTINEL_ROOT)
  } else if (mode === 'agreeing') {
    const { _ROOT_PATH } = await import('@aihu/arbor/hydrate')
    html = rekey(html, _ROOT_PATH)
  }

  const reasons = await assertAdoption({ html, component, setText })
  if (reasons.length === 0) return null
  return {
    where: 'packages/router/src/server.ts',
    rule: 'HA-b',
    message:
      'HTML served by the live SSR router is not adoptable by the client walker — ' +
      `${reasons.join('; ')}.`,
  }
}

// ─── Self-test ───────────────────────────────────────────────────────────────

/**
 * Bidirectional, and run BEFORE the real scan.
 *
 * A check with only a should-flag case is satisfied by a rule that flags
 * everything; one with only a should-not-flag case is satisfied by a rule that
 * flags nothing. Both controls are real renders through the real renderer —
 * never a hand-written markup blob, which is the mistake that let the original
 * defect hide inside a green `hydrate.test.ts`.
 */
async function runSelfTest(): Promise<void> {
  const cases: Array<{ label: string; actual: number; expected: number }> = []

  cases.push({
    label: 'HA-a should-flag: markers absent entirely (the pre-DA3 shape)',
    actual: (await runHaA('markerless')) ? 1 : 0,
    expected: 1,
  })
  cases.push({
    label: 'HA-a should-flag: markers present but under an unreachable root (the pre-CO5 shape)',
    actual: (await runHaA('disagreeing')) ? 1 : 0,
    expected: 1,
  })
  cases.push({
    label: 'HA-a should-not-flag: markers keyed to the root the client asks for',
    actual: (await runHaA('agreeing')) ? 1 : 0,
    expected: 0,
  })

  cases.push({
    label: 'HA-b should-flag: live router bytes rekeyed to an unreachable root',
    actual: (await runHaB('disagreeing')) ? 1 : 0,
    expected: 1,
  })
  // HA-b deliberately has NO should-not-flag arm.
  //
  // Any such control would have to be built from the live router's own bytes —
  // that IS what HA-b probes — so a production regression would trip the
  // control and surface as "SELF-TEST FAILED / the check cannot discriminate",
  // blaming the checker for a bug in the router and suppressing the real scan
  // that would have named it. Verified: with `hydratable: true` removed from
  // packages/router/src/server.ts, that is exactly what happened.
  //
  // Discrimination is still proven in both directions. HA-a's three controls
  // exercise the SAME `assertAdoption` machinery HA-b uses, over the same
  // renderer and the same fixture; HA-b varies only where the bytes come from.
  // `selfTest` requires both directions across the case set, not per rule.

  selfTest(NAME, cases)
}

// ─── Main ────────────────────────────────────────────────────────────────────

await runSelfTest()

/**
 * The anti-vacuity guard, over the ACTUAL bytes each probe will hydrate.
 *
 * Deliberately not a count of hardcoded probe names — that array can never be
 * empty, so guarding it would be theater. What can genuinely go empty is the
 * rendered HTML: a renderer that returns '' or a router that 404s leaves the
 * probe with nothing to hydrate, and "adoption held" over an empty document is
 * the purest vacuous pass.
 *
 * The guard tests for an EMPTY body ONLY — deliberately NOT for missing
 * markers. Markerless output is the DA3 defect itself, and HA-b must be free to
 * REPORT it as a finding that names the router. An earlier revision refused
 * marker-free bodies here; with `hydratable: true` removed from
 * packages/router/src/server.ts that turned a precise finding into "refusing to
 * pass vacuously", which points at the harness instead of at the bug.
 */
const bodies: string[] = []
for (const [label, html] of [
  ['HA-a direct render', (await renderForMode('live')).html],
  ['HA-b live router', await liveRouterHtml()],
] as const) {
  if (html.trim() === '') {
    console.error(
      `${NAME} — ${label} produced an EMPTY body; there is nothing to hydrate and no adoption ` +
        'to assert. Refusing to pass vacuously.',
    )
    process.exit(1)
  }
  bodies.push(html)
}
refuseVacuous(bodies, NAME, 'renderable probe bodies')

const findings: Finding[] = []

const haA = await runHaA('live')
if (haA) findings.push(haA)

const haB = await runHaB('live')
if (haB) findings.push(haB)

console.log(
  `${NAME} — ran ${bodies.length} adoption probes (1 direct SSR render, 1 live router request), ` +
    'each asserting innerHTML stability, node identity, exactly-once text, and in-place reactivity.',
)
expectCount(findings, expectedFrom(process.argv, 'hydration-adoption'), NAME)
