// @vitest-environment node
//
// NOT jsdom (the repo default). A Worker has no `customElements`, and the
// compiled server target guards its registration on `typeof customElements`.
// Under jsdom the guard passes, both built workers register the SAME page tag
// into ONE shared registry, and the second one to load throws SCR-R0001
// (`already: probe-page`) — which is exactly what happened, and is an artifact
// of the test host rather than anything a deployed worker would ever hit. The
// node environment is both the fix and the faithful runtime.

/**
 * THE CI GATE for `output: 'ssr'` — a real `vite build`, driven in-process.
 *
 * ## Why this file lives here and not in `examples/`
 *
 * The root vitest config includes `packages/*&#47;tests/**` and NOT `examples/**`,
 * and the `examples` CI job walks two hardcoded directory lists inside a lane a
 * `changes` filter can skip entirely. A test in the example would gate nothing
 * on most PRs. Here it is gated for free by the job everyone already runs.
 *
 * ## Why a subprocess
 *
 * Same reason as the standalone compiler's vite utility-CSS e2e test:
 * vitest's runtime intercepts `await import('vite')` in a way that breaks the
 * compiler plugin's TS-strip. A spawned `vite build` is the exact execution
 * context a consumer's `bun run build` has, which is the contract under test.
 *
 * ## Why no wrangler / workerd
 *
 * `scripts/serve-dist.ts` documents why wrangler was deliberately ejected from
 * CI: compat-date drift, ~246 cold packages, blown timeouts. Same reason
 * `@cloudflare/vite-plugin` is not the route here. The worker is a standard ES
 * module exporting `{ fetch }`, so `import()`ing it and calling `fetch` with a
 * stubbed `ASSETS` exercises everything except workerd's own module resolution
 * — and assertion 4 (no node builtin in the bundle) is what stands in for that.
 *
 * ## THROWS, never skips
 *
 * `vite-build-utility-css.e2e.test.ts`'s own comment names soft-skipping as
 * "the false-confidence pattern that let the prior Bug 2 fix ship a non-working
 * feature." Every prerequisite below is either satisfied or a red bar. In
 * particular the package `dist/`s are REBUILT rather than assumed: `@aihu/app`,
 * `@aihu/router` and `@aihu/adapter-cloudflare` are consumed through their
 * `exports` (i.e. `dist/`); the standalone `@aihu/compiler` is consumed from
 * its published artifact. The repo's own CI runs `bun run test` BEFORE
 * `bun run build`, and `packages/router/dist/plugin.js` has previously shipped
 * without an export its `src` had. A stale dist would make this file validate
 * the last release instead of this change.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const __dirname = dirname(new URL(import.meta.url).pathname)
const REPO = resolve(__dirname, '../../..')
const FIXTURE = resolve(__dirname, 'fixtures/workers-ssr')

/**
 * Packages whose `dist/` this fixture consumes through package `exports`.
 *
 * `primitives` is here for `probe-extends.aihu`: the `$extends`/`base:` recipe
 * imports a real primitive at server-module scope, and the thing under test is
 * whether THAT module can be imported without a DOM. A stale
 * `packages/primitives/dist/` would test the last release's answer.
 */
const REBUILD = ['router', 'server', 'app', 'adapter-cloudflare', 'primitives'] as const

type Variant = 'main' | 'control' | 'outlet' | 'poison'

const CLIENT_DIST = {
  main: 'dist',
  control: 'dist-control',
  outlet: 'dist-outlet',
  poison: 'dist-poison',
} as const
const SERVER_DIST = {
  main: 'dist-server',
  control: 'dist-control-server',
  outlet: 'dist-outlet-server',
  poison: 'dist-poison-server',
} as const

/** The env switch each variant's `vite.config.ts` reads. */
const VARIANT_ENV: Record<Variant, Record<string, string>> = {
  main: {},
  control: { AIHU_E2E_CONTROL: '1' },
  outlet: { AIHU_E2E_OUTLET: '1' },
  poison: { AIHU_E2E_POISON: '1' },
}

interface Built {
  readonly worker: string
  readonly serverDist: string
  readonly clientDist: string
}

const built: { main?: Built; control?: Built; outlet?: Built; poison?: Built } = {}

function run(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  return spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function build(variant: Variant): Built {
  const r = run('bunx', ['vite', 'build'], FIXTURE, VARIANT_ENV[variant])
  if (r.status !== 0) {
    throw new Error(
      `[${variant}] vite build failed (exit ${r.status})\nSTDOUT:\n${r.stdout}\nSTDERR:\n${r.stderr}`,
    )
  }
  const serverDist = join(FIXTURE, SERVER_DIST[variant])
  const worker = join(serverDist, '_worker.js')
  if (!existsSync(worker)) {
    throw new Error(
      `[${variant}] the ssr environment produced no ${SERVER_DIST[variant]}/_worker.js.\n` +
        `STDOUT:\n${r.stdout}`,
    )
  }
  return { worker, serverDist, clientDist: join(FIXTURE, CLIENT_DIST[variant]) }
}

/** Every file under a directory, recursively. */
function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

/**
 * How long a worker's module evaluation may take before this gate calls it a
 * deadlock. Generous — evaluation is a few milliseconds — because the point is
 * to distinguish "slow" from "never", not to measure.
 *
 * MUST stay below the per-`it` timeout passed to every test that imports a
 * worker, so the failure reported is THIS one, naming the cause, rather than
 * vitest's generic "test timed out".
 */
const WORKER_IMPORT_TIMEOUT_MS = 20_000

/**
 * `import()` a built worker UNDER A TIMEOUT.
 *
 * ## Why the bound exists, and why it is not optional
 *
 * The SSR entry used to resolve its child and layout registries with
 * module-scope top-level `await`. That makes `_worker.js` an ESM async module —
 * and vite/rollup hoists the shared runtime INTO the entry chunk, so the lazy
 * chunks statically import back into `_worker.js` (7 of 8, measured on vite
 * 6.4.3 in a consumer-shaped tree). The cycle then cannot resolve: the entry
 * suspends at its top-level await; the dynamically imported chunk cannot finish
 * evaluating until the entry's evaluation promise settles; and that settles
 * only when the dynamic import resolves.
 *
 * The consequence for THIS FILE is what matters. An unbounded
 * `await import(worker)` against such a build does not fail — it HANGS, and a
 * hung CI job is not a red test. It is a job someone cancels an hour later and
 * reruns. So the class of bug that ships a green build whose Worker cannot be
 * loaded was, structurally, invisible here.
 *
 * The bound converts that into a named failure. Note it also stops being
 * bundler-luck-dependent: vite 8/rolldown happens to extract the runtime into
 * standalone chunks so the entry is a leaf with zero back-edges, which is the
 * only reason this gate passed on 8 while the same source deadlocked on 6.
 *
 * The abandoned `import()` is deliberately not cancelled — it cannot be. A
 * deadlocked module holds no timer or handle, so leaving it pending does not
 * keep the process alive.
 */
async function importWorker(worker: string): Promise<Record<string, unknown>> {
  // Cache-bust: the two variants are different files, but a re-run inside one
  // vitest process must not reuse a previous build's module.
  const href = `${pathToFileURL(worker).href}?v=${Date.now()}`
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return (await Promise.race([
      import(href),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `DEADLOCK: importing ${worker} did not settle within ` +
                  `${WORKER_IMPORT_TIMEOUT_MS}ms. The built Worker cannot be loaded — ` +
                  `every request to it would hang in production, even though the build ` +
                  `was green.\n` +
                  `Almost certainly a module-scope top-level await reintroduced into ` +
                  `virtual:aihu-server-entry (packages/app/src/server-entry.ts): the ` +
                  `emitted chunks statically import back into _worker.js, and an ESM ` +
                  `async module in that cycle can never finish evaluating.\n` +
                  `Confirm with: node ${worker}  →  ` +
                  `"Warning: Detected unsettled top-level await".`,
              ),
            ),
          WORKER_IMPORT_TIMEOUT_MS,
        )
      }),
    ])) as Record<string, unknown>
  } finally {
    clearTimeout(timer)
  }
}

/** Load a built worker and drive one request through it with a stubbed ASSETS. */
async function fetchThrough(
  worker: string,
  url: string,
): Promise<{ status: number; body: string; contentType: string | null; assetsHits: string[] }> {
  const mod = (await importWorker(worker)) as {
    default?: { fetch?: (r: Request, env: unknown, ctx: unknown) => Promise<Response> }
  }
  const handler = mod.default?.fetch
  if (typeof handler !== 'function') {
    throw new Error(`${worker} has no default export with a fetch method`)
  }
  const assetsHits: string[] = []
  const env = {
    ASSETS: {
      fetch: async (req: Request) => {
        const path = new URL(req.url).pathname
        assetsHits.push(path)
        return new Response(`ASSETS-STUB:${path}`, { status: 200 })
      },
    },
  }
  const res = await handler(new Request(url), env, {})
  return {
    status: res.status,
    body: await res.text(),
    contentType: res.headers.get('content-type'),
    assetsHits,
  }
}

/**
 * Call the framework `handler` export DIRECTLY, bypassing the adapter's
 * ASSETS-fallthrough wrapper.
 *
 * The wrapper swallows a 404 by re-serving it from ASSETS, so a request driven
 * through `fetch` can never show what `handler` itself returned for an unmatched
 * path — and "the document wrapper leaves non-HTML responses alone" is precisely
 * a claim about that value.
 */
async function callHandler(
  worker: string,
  url: string,
): Promise<{ status: number; body: string; contentType: string | null }> {
  const mod = (await importWorker(worker)) as {
    handler?: (r: Request, platform?: unknown) => Promise<Response>
  }
  if (typeof mod.handler !== 'function') {
    throw new Error(`${worker} exports no \`handler\` — the prelude's named export is gone`)
  }
  const res = await mod.handler(new Request(url), { env: {}, ctx: {} })
  return {
    status: res.status,
    body: await res.text(),
    contentType: res.headers.get('content-type'),
  }
}

beforeAll(async () => {
  // ── Prerequisite 1: a working compiler. THROW, do not skip. ──────────────
  // Probed by actually compiling, rather than by guessing at a binary path:
  // the path moved once already (optionalDependency packages replaced the
  // in-repo `bin/`), and a path check that goes stale reports "prerequisite
  // met" for a compiler that cannot run.
  const probe = run('bunx', ['vite', '--version'], REPO)
  if (probe.status !== 0) {
    throw new Error(
      `The Workers-SSR e2e gate needs a runnable \`vite\`. \`bunx vite --version\` exited ` +
        `${probe.status}:\n${probe.stderr}\nFix the toolchain — skipping here would be the ` +
        `false-confidence pattern this file exists to avoid.`,
    )
  }

  // ── Prerequisite 2: FRESH package dists. Built, not assumed. ─────────────
  for (const pkg of REBUILD) {
    const r = run('bun', ['run', 'build'], join(REPO, 'packages', pkg))
    if (r.status !== 0) {
      throw new Error(
        `\`bun run build\` failed for @aihu/${pkg} (exit ${r.status}). This gate consumes ` +
          `packages through their \`exports\` (dist/), so a failed or stale build would make ` +
          `it validate the previous release.\nSTDERR:\n${r.stderr}`,
      )
    }
  }

  for (const dir of [...Object.values(CLIENT_DIST), ...Object.values(SERVER_DIST)]) {
    rmSync(join(FIXTURE, dir), { recursive: true, force: true })
  }

  built.main = build('main')
  built.control = build('control')
  built.outlet = build('outlet')
  built.poison = build('poison')
}, 300_000)

// ---------------------------------------------------------------------------

describe('output: ssr produces a deployable, rendering Worker', () => {
  it('1. the ssr environment emits a _worker.js that LOADS, with a default-exported fetch', async () => {
    // "Loads" is half the claim and the half that used to be untested: an
    // unbounded import here hung instead of failing whenever the entry was an
    // async module inside the chunk cycle. See `importWorker`.
    const mod = (await importWorker(built.main!.worker)) as { default?: { fetch?: unknown } }
    expect(typeof mod.default?.fetch).toBe('function')
  }, 60_000)

  it('2. server-renders TWO levels of child nesting', async () => {
    const { status, body } = await fetchThrough(built.main!.worker, 'https://e2e.test/')
    expect(status).toBe(200)
    // The child…
    expect(body).toContain('CARD-OK')
    // …and the GRANDCHILD, which no page template names. It is reachable only
    // through `probe-card`'s own render edge, which is the whole claim.
    expect(body).toContain('GRANDCHILD-OK')
    // Nested inside the child's element, not merely present somewhere.
    expect(body).toMatch(/<probe-card[^>]*>.*<probe-inner[^>]*>.*GRANDCHILD-OK/s)
  }, 60_000)

  it('3. THE CONTROL — an empty registry renders the same host EMPTY', async () => {
    // Same pages, same components, same entry, same renderer; only
    // `virtual:aihu-server-components` is shadowed with `export default {}`.
    // Without this, assertion 2 could be passing because the text was inlined
    // into the page's own compiled template rather than resolved as a child.
    const { body } = await fetchThrough(built.control!.worker, 'https://e2e.test/')
    expect(body).not.toContain('GRANDCHILD-OK')
    expect(body).not.toContain('CARD-OK')
    expect(body).toMatch(/<probe-card[^>]*><\/probe-card>/)
    // The page's own markup is unaffected — proving the control changed the
    // registry and not the whole render.
    expect(body).toContain('probe page')
  }, 60_000)

  it('4. no node builtin import survives into the SSR output', () => {
    // D-1. `@aihu/server`'s lazy `import('./native.js')` statically imports the
    // `module` builtin for `createRequire`; rolldown chases it and emits an
    // ~18 kB chunk. Unreachable at runtime here (the loader short-circuits to
    // the TS walker whenever `children` is passed, which the SSR entry always
    // does) but still UPLOADED — and workerd rejects the specifier at deploy
    // time without `nodejs_compat`. This assertion is the only thing between
    // the bundle and a `wrangler deploy` failing on a client's clock.
    const offenders = walk(built.main!.serverDist)
      .filter((f) => f.endsWith('.js'))
      .filter((f) => readFileSync(f, 'utf8').includes('node:module'))
    expect(offenders, `files still referencing the node module builtin`).toEqual([])
  })

  it('5. the registry carries the reachable subgraph and nothing else', () => {
    // Pinned by CONTENT, not by chunk count: chunk naming is a bundler detail
    // that would make this brittle without making it stricter.
    //
    // `probe-attr` is the DECLINED reference — the page names it, but it
    // carries an attribute, so the emitter refuses to lower it and
    // `__aihu_schild` can never look it up. A source-regex derivation WOULD
    // bundle it, for an element that renders empty either way.
    // `probe-orphan` is reached by nothing.
    const serverJs = walk(built.main!.serverDist)
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n')
    expect(serverJs).toContain('CARD-OK')
    expect(serverJs).toContain('GRANDCHILD-OK')
    expect(serverJs).not.toContain('DECLINED-SHOULD-NOT-SHIP')
    expect(serverJs).not.toContain('ORPHAN-SHOULD-NOT-SHIP')
  })

  it('5b. the declined reference still renders as a bare element, not an error', async () => {
    const { body } = await fetchThrough(built.main!.worker, 'https://e2e.test/')
    expect(body).toMatch(/<probe-attr city="London"[^>]*><\/probe-attr>/)
  }, 60_000)

  it('6. an unmatched path falls through to the ASSETS binding', async () => {
    const { status, body, assetsHits } = await fetchThrough(
      built.main!.worker,
      'https://e2e.test/assets/some-chunk.js',
    )
    expect(status).toBe(200)
    expect(assetsHits).toEqual(['/assets/some-chunk.js'])
    expect(body).toBe('ASSETS-STUB:/assets/some-chunk.js')
  }, 60_000)

  it('7. composes the route LAYOUT, with the page inside its outlet', async () => {
    // The SSG prerender composed layouts and live SSR did not, so an app that
    // looked right prerendered lost its whole shell the moment a Worker served
    // it. Everything else asserting this is a unit test over a HAND-BUILT
    // layout module; only this one proves the real chain — a compiled `.aihu`
    // layout exporting an SSR-renderable default under the server target,
    // reached through `virtual:aihu-layouts` from inside the bundle, with the
    // compiler's `<outlet>` lowering to the marker the splice looks for.
    const { body } = await fetchThrough(built.main!.worker, 'https://e2e.test/')
    expect(body).toContain('CHROME-OK')
    // The page is INSIDE the layout's outlet, not merely on the same document.
    expect(body).toMatch(/data-aihu-outlet[^>]*>.*probe page/s)
    // …and the shell precedes it, i.e. the page did not swallow the layout.
    expect(body.indexOf('CHROME-OK')).toBeLessThan(body.indexOf('probe page'))
  }, 60_000)

  it('8. a component only the LAYOUT references still ships to the server bundle', () => {
    // `genSC` rooted its reachability walk at the PAGES alone. No page names
    // `probe-chrome` — only the layout does — so before layouts became roots
    // its module was pruned from the server bundle and the site nav rendered as
    // an empty element on EVERY route. This is the control's mirror image:
    // assertion 5 proves the walk still excludes what nothing reaches, and this
    // proves it now includes what only a layout reaches.
    const serverJs = walk(built.main!.serverDist)
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n')
    expect(serverJs).toContain('CHROME-OK')
    // And the orphan is STILL out — adding a second root set must not have
    // quietly become "bundle everything".
    expect(serverJs).not.toContain('ORPHAN-SHOULD-NOT-SHIP')
  })

  // -------------------------------------------------------------------------
  // Step 4 — the FULL DOCUMENT. Without this the Worker rendered and never
  // hydrated: the body was a bare fragment, so a visitor got server markup and
  // then nothing at all — no hydration, no interactivity, no head.
  // -------------------------------------------------------------------------

  it('9. serves a COMPLETE document, not a bare fragment', async () => {
    const { status, body, contentType } = await fetchThrough(
      built.main!.worker,
      'https://e2e.test/',
    )
    expect(status).toBe(200)
    expect(contentType).toMatch(/^text\/html/)

    expect(body.toLowerCase()).toMatch(/^\s*<!doctype html>/)
    expect(body).toContain('<html lang="en">')
    expect(body).toContain('<head>')
    expect(body).toContain('</head>')
    expect(body).toContain('<body>')
    expect(body).toContain('<title>workers-ssr fixture</title>')

    // THE assertion the whole step exists for: the hashed client entry, which
    // is the only thing that can hydrate the markup above it.
    expect(body).toMatch(/<script type="module"[^>]*src="\/assets\/index-[^"]+\.js"/)
  }, 60_000)

  it('10. the rendered child AND grandchild are INSIDE the outlet element', async () => {
    // Not merely "the document contains both". A document whose outlet is empty
    // and whose content trails after `</html>` would pass a naive `toContain`
    // and would hydrate into a blank page.
    const { body } = await fetchThrough(built.main!.worker, 'https://e2e.test/')
    const open = body.indexOf('<div id="outlet">')
    expect(open).toBeGreaterThan(-1)
    const close = body.indexOf('</div>', open)
    const inside = body.slice(open, close)
    expect(inside).toContain('CARD-OK')
    expect(inside).toContain('GRANDCHILD-OK')
    expect(inside).toContain('CHROME-OK')
    // …and the outlet closes before the document does.
    expect(body.indexOf('</body>')).toBeGreaterThan(open)
  }, 60_000)

  it('11. the hashed script the document references is one ASSETS actually serves', async () => {
    // A document naming a bundle the ASSETS binding cannot resolve is the same
    // outcome as no script tag at all. `env.ASSETS` serves `/assets/*` through
    // the adapter's 404 fallthrough, so this is a round trip: read the src the
    // Worker emitted, then ask the Worker for it.
    const { body } = await fetchThrough(built.main!.worker, 'https://e2e.test/')
    const src = /src="(\/assets\/index-[^"]+\.js)"/.exec(body)?.[1]
    expect(src, 'no hashed client entry in the served document').toBeTruthy()

    // It exists on disk in the client outDir the ASSETS binding is pointed at…
    expect(existsSync(join(built.main!.clientDist, src!.replace(/^\//, '')))).toBe(true)

    // …and the Worker hands that path to ASSETS rather than trying to route it.
    const asset = await fetchThrough(built.main!.worker, `https://e2e.test${src}`)
    expect(asset.status).toBe(200)
    expect(asset.assetsHits).toEqual([src])
  }, 60_000)

  it('12. a NON-HTML response is not wrapped — the 404 stays a 404', async () => {
    // Called on `handler` directly: the adapter wrapper re-serves a 404 from
    // ASSETS, so driving this through `fetch` would hide the value under test.
    // If the document wrapper keyed on anything but Content-Type, this would
    // come back as a 200-shaped HTML document, the `status !== 404` fallthrough
    // would never fire, and every static asset on the site would 404.
    const { status, body, contentType } = await callHandler(
      built.main!.worker,
      'https://e2e.test/no-such-route',
    )
    expect(status).toBe(404)
    expect(body).toBe('Not Found')
    expect(contentType ?? '').not.toMatch(/text\/html/)
    expect(body).not.toContain('<!DOCTYPE')
    expect(body).not.toContain('<div id="outlet"')
  }, 60_000)

  it('13. splices the CONFIGURED outlet id, not a hardcoded one', async () => {
    // `outlet` is the standard, which is exactly why the default proves nothing
    // here: hardcoding it and resolving it are indistinguishable. This variant
    // sets `app.outletId: 'app-root'` and renames the element to match, so a
    // splice that still targets `#outlet` finds nothing and ships an empty
    // document.
    //
    // The renamed element is SINGLE-quoted (`id='app-root'`), and that is the
    // second thing under test. `index.html` is a file the CONSUMER authors —
    // Vite requires one and this repo's scaffold is only one of the ways it
    // gets written — and vite passes its quoting through verbatim (verified:
    // the built `dist-outlet/index.html` still reads `id='app-root'`). The
    // splice regex used to match double quotes only, so a perfectly ordinary
    // hand-authored document silently produced an EMPTY outlet, reported by
    // one `console.error` inside a Worker.
    const { status, body } = await fetchThrough(built.outlet!.worker, 'https://e2e.test/')
    expect(status).toBe(200)
    expect(body).toContain("<div id='app-root'>")
    expect(body).not.toContain('id="outlet"')

    const open = body.indexOf("<div id='app-root'>")
    const inside = body.slice(open, body.indexOf('</div>', open))
    expect(inside).toContain('GRANDCHILD-OK')
    // The document is still whole — the id change must not cost the script tag.
    expect(body).toMatch(/<script type="module"[^>]*src="\/assets\/index-[^"]+\.js"/)
  }, 60_000)

  it('14. the CLIENT mounts the same configured id the server spliced', async () => {
    // The other half of the same fact, and the one that makes `app.outletId` a
    // single source of truth: the virtual client entry has to pass the id to
    // `createApp`, or the server would splice `#app-root` while the browser
    // looked for `#outlet` and threw at bootstrap.
    const clientJs = walk(built.outlet!.clientDist)
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n')
    expect(clientJs).toContain('app-root')
  })

  // -------------------------------------------------------------------------
  // `$extends` (`base:`) — a component whose base class comes from
  // @aihu/primitives. Filed as a known gap when the `$aria`/`$form` SSR guards
  // landed, on the (correct) reasoning that no compiler-side gate could fix it.
  // -------------------------------------------------------------------------

  it('15. a `$extends` component server-renders instead of killing the request', async () => {
    // TWO failures are pinned here, and they are in different packages.
    //
    //   1. `@aihu/primitives`. The base module evaluated
    //      `class AihuSwitchRoot extends HTMLElement` at ITS OWN module scope.
    //      workerd exposes `HTMLRewriter` but NOT `HTMLElement` (verified
    //      against workerd directly), so importing the base threw
    //      `ReferenceError: HTMLElement is not defined`. That import happens
    //      inside the router's `Promise.all` over the child registry, so it did
    //      not degrade to an empty element the way a `__aihu_schild` failure
    //      does — the WHOLE request threw. Hence `status === 200` below: it is
    //      the assertion, not a formality.
    //
    //   2. The published `@aihu/compiler` output. `$extends` was also excluded
    //      from the options-form SSR-entry gate, so even with an import-safe base the module emitted
    //      a bare, ungated `defineElement(...)` at module scope
    //      (`ReferenceError: customElements is not defined`) and exported no
    //      `__ssr` at all. Each fix alone still fails — verified by reverting
    //      them one at a time against this same built Worker.
    const { status, body } = await fetchThrough(built.main!.worker, 'https://e2e.test/')
    expect(status).toBe(200)
    // Rendered as the element's own content, not merely present in the document.
    expect(body).toMatch(/<probe-extends[^>]*>.*EXTENDS-OK.*<\/probe-extends>/s)
    // …and inside the outlet, so it actually reached the page.
    const open = body.indexOf('<div id="outlet">')
    expect(body.slice(open, body.indexOf('</body>'))).toContain('EXTENDS-OK')
  }, 60_000)

  it('15b. THE CONTROL — with an empty registry the `$extends` host renders empty', async () => {
    // Same proof obligation as assertion 3: without this, assertion 15 could be
    // passing because `EXTENDS-OK` was inlined into the page's own compiled
    // template rather than resolved through the child registry.
    const { status, body } = await fetchThrough(built.control!.worker, 'https://e2e.test/')
    expect(status).toBe(200)
    expect(body).not.toContain('EXTENDS-OK')
    expect(body).toMatch(/<probe-extends[^>]*><\/probe-extends>/)
  }, 60_000)

  // -------------------------------------------------------------------------
  // The SETUP-BODY DOM crash — a DIFFERENT bug from `$extends` above, at a
  // different time. `$extends` threw on IMPORT, because the base class sat at a
  // primitive module's own top level. These throw when the component RENDERS,
  // because the compiler emits an `@state` block verbatim into
  // `__aihu_setup__` / `__aihu_ssr_string_setup__` — the body a server render
  // runs for EVERY component, `base:` clause or not.
  //
  // Two shapes, two owners:
  //   16/17 — a hand-written element class in `@state` (`card.aihu`,
  //           `badge.aihu`, `separator.aihu`, `button.aihu`). Authored code;
  //           the fix is a guard in the recipe source.
  //   18    — a `defineX()` call in `@state` (`before-after.aihu`,
  //           `temperature.aihu`). Library code; the fix is in
  //           `@aihu/primitives`, once, for every caller.
  // -------------------------------------------------------------------------

  it('16. a styled-recipe CHILD renders instead of coming out empty', async () => {
    // Fails SOFT without the guard: `__aihu_schild` catches the child's throw
    // and degrades that one element to `<probe-recipe></probe-recipe>`, with
    // `ReferenceError: HTMLElement is not defined` on the console. So the
    // meaningful assertion is the CONTENT, not the status.
    const { status, body } = await fetchThrough(built.main!.worker, 'https://e2e.test/')
    expect(status).toBe(200)
    expect(body).toMatch(/<probe-recipe[^>]*>.*RECIPE-OK.*<\/probe-recipe>/s)
    const open = body.indexOf('<div id="outlet">')
    expect(body.slice(open, body.indexOf('</body>'))).toContain('RECIPE-OK')
  }, 60_000)

  it('16b. THE CONTROL — with an empty registry the styled-recipe host renders empty', async () => {
    // Same obligation as assertions 3 and 15b: without it, 16 could be passing
    // because the text was inlined into the page's own compiled template.
    const { body } = await fetchThrough(built.control!.worker, 'https://e2e.test/')
    expect(body).not.toContain('RECIPE-OK')
    expect(body).toMatch(/<probe-recipe[^>]*><\/probe-recipe>/)
  }, 60_000)

  it('17. the same shape on a PAGE returns a response at all', async () => {
    // The severe half. A page is rendered by `handle()` calling
    // `renderToString` directly — there is no `__aihu_schild` net, so the throw
    // propagates out of the fetch handler and the request gets NO RESPONSE.
    // Measured before the fix, against this same built Worker:
    //   `ReferenceError: HTMLElement is not defined`, thrown out of
    //   `mod.default.fetch` — not a 500, not an empty element.
    // `status === 200` is therefore the assertion, exactly as it is for 15.
    const { status, body } = await fetchThrough(built.main!.worker, 'https://e2e.test/recipe-page')
    expect(status).toBe(200)
    expect(body).toContain('RECIPE-PAGE-OK')
    // …and it is a real page render, inside the layout, not an error document.
    expect(body).toContain('CHROME-OK')
  }, 60_000)

  it('18. a component calling `defineX()` from `@state` renders', async () => {
    // The library-owned half, and the reason the fix is NOT 18 one-line edits
    // in `@aihu/ui`: `defineSlider()` is called from a recipe, from an example,
    // and from any consumer that composes a primitive. Guarding it once inside
    // `@aihu/primitives` closes it for every caller, including callers that do
    // not exist yet.
    //
    // NOTE the probe itself is UNGUARDED, deliberately — that is the point. If
    // this needed a guard at the call site, the fix would be in the wrong
    // place.
    const { status, body } = await fetchThrough(built.main!.worker, 'https://e2e.test/')
    expect(status).toBe(200)
    expect(body).toMatch(/<probe-define[^>]*>.*DEFINE-OK.*<\/probe-define>/s)
  }, 60_000)

  it('18b. THE CONTROL — with an empty registry the `defineX()` host renders empty', async () => {
    const { body } = await fetchThrough(built.control!.worker, 'https://e2e.test/')
    expect(body).not.toContain('DEFINE-OK')
    expect(body).toMatch(/<probe-define[^>]*><\/probe-define>/)
  }, 60_000)

  it('D-2. the SSR bundle is NOT written where the ASSETS binding would serve it', () => {
    // Cloudflare's `[assets] directory` serves the client outDir verbatim. An
    // SSR chunk landing there is downloadable server code on a public URL.
    const clientFiles = walk(built.main!.clientDist)
    expect(clientFiles.some((f) => f.endsWith('_worker.js'))).toBe(false)
    // And the client bundle must not carry the server-only string renderer.
    const clientJs = clientFiles
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n')
    expect(clientJs).not.toContain('__aihu_schild')
  })
})

// ---------------------------------------------------------------------------
// Robustness at the SSR edge. Both of these are about the SAME failure shape —
// a rejected promise where an HTTP response should be — and they are separated
// because the fixes are at different layers and either one alone leaves the
// other's failure intact.
// ---------------------------------------------------------------------------

describe('a throw on the render path becomes a response, not a dropped request', () => {
  it('19. a page that throws while rendering returns a 500 instead of NOTHING', async () => {
    // THE failure this closes. `handle()` calls `renderToString` on the route
    // module directly and nothing on the chain — not `handle()`, not the
    // generated `handler`, not the adapter wrapper — had a try/catch. A throw
    // therefore rejected the Worker's `fetch` promise, and a rejected `fetch`
    // on Cloudflare is error 1101: no status, no body, nothing a client or a
    // log can act on. Assertion 17's own comment records measuring exactly
    // that ("the request gets NO RESPONSE") and then fixed the one CAUSE it
    // had rather than the missing boundary.
    //
    // Measured against this same built Worker before the boundary landed:
    // `Error: E2E-BOOM: this page throws while rendering` thrown out of
    // `mod.default.fetch`, i.e. `fetchThrough` itself rejected.
    const { status, body, contentType } = await fetchThrough(
      built.main!.worker,
      'https://e2e.test/boom',
    )
    expect(status).toBe(500)
    expect(contentType ?? '').toMatch(/^text\/plain/)
    expect(body).toBe('Internal Server Error')
  }, 60_000)

  it('19b. the 500 leaks no internals — not the message, not a stack', async () => {
    // The boundary sees the real error and must log it, never serve it. A
    // thrown value on this path can carry a query string, a binding name or a
    // filesystem path from the build.
    const { body } = await fetchThrough(built.main!.worker, 'https://e2e.test/boom')
    // The thrown message…
    expect(body).not.toContain('E2E-BOOM')
    // …the module it came from, and any build-time filesystem path…
    expect(body).not.toContain('boom.aihu')
    expect(body).not.toContain('/dist-server/')
    // …and a stack. (`Internal Server Error` legitimately contains the word
    // "Error", so the assertion is on the SHAPE: nothing beyond that phrase.)
    expect(body).not.toMatch(/\bat\s/)
    expect(body).toBe('Internal Server Error')
  }, 60_000)

  it('19c. the 500 is NOT re-served from ASSETS as a 200 SPA shell', async () => {
    // The adapter wrapper falls through to ASSETS on 404 only. A boundary that
    // returned 404 — or that let the document wrapper turn the failure into an
    // HTML page — would hand a broken route a 200 and a shell, which is worse
    // than the crash: a monitor cannot see it.
    const { assetsHits } = await fetchThrough(built.main!.worker, 'https://e2e.test/boom')
    expect(assetsHits).toEqual([])
  }, 60_000)

  it('19d. `text/plain` survives the document wrapper unwrapped', async () => {
    // Called on `handler` directly, past the adapter. `createSsrDocument`
    // wraps on Content-Type and nothing else (`isHtml`), so the boundary's
    // media type is load-bearing: an HTML 500 would be spliced into the client
    // template and served as a document.
    const { status, body, contentType } = await callHandler(
      built.main!.worker,
      'https://e2e.test/boom',
    )
    expect(status).toBe(500)
    expect(contentType ?? '').toMatch(/^text\/plain/)
    expect(body).toBe('Internal Server Error')
    expect(body).not.toContain('<!DOCTYPE')
    expect(body).not.toContain('<div id="outlet"')
  }, 60_000)

  it('19e. one throwing route does not poison the isolate for the others', async () => {
    // The same module instance, after the failure: the memoised router is
    // still the resolved one, so the next request renders normally. A boundary
    // that had been placed around the memo instead would have discarded it.
    const worker = built.main!.worker
    const boom = await fetchThrough(worker, 'https://e2e.test/boom')
    expect(boom.status).toBe(500)
    const ok = await fetchThrough(worker, 'https://e2e.test/')
    expect(ok.status).toBe(200)
    expect(ok.body).toContain('CARD-OK')
  }, 60_000)
})

describe('a broken outlet is a BUILD error, not a silent runtime divergence', () => {
  /** Run a real `vite build` expected to FAIL, and return its combined output. */
  function buildExpectingFailure(env: Record<string, string>): string {
    const r = run('bunx', ['vite', 'build'], FIXTURE, env)
    const output = `${r.stdout}\n${r.stderr}`
    if (r.status === 0) {
      throw new Error(
        `the build SUCCEEDED with ${JSON.stringify(env)}. That is the defect: the config and ` +
          `the document disagree about where the page goes, and shipping it produces a site ` +
          `whose every page is an empty shell until the client bundle boots.\n${output}`,
      )
    }
    return output
  }

  it.each([
    // Empty: matches no element, and `getElementById('')` is always null.
    ['', 'an empty outletId'],
    // A quote closes the `id="…"` attribute the splice looks for.
    ['a"b', 'a double quote'],
    // ASCII whitespace is illegal in an HTML id — the browser parses two
    // attributes and the splice matches neither.
    ['my outlet', 'whitespace'],
  ])('21. rejects app.outletId %j (%s) at build time', (value) => {
    // Config validation runs when `viteAihuPlugin()` is constructed, i.e. while
    // vite.config.ts is evaluated — so this fails before a single file is
    // emitted, which is the whole point.
    const out = buildExpectingFailure({ AIHU_E2E_BAD_OUTLET: value })
    expect(out).toContain('app.outletId')
    expect(out).toContain('an HTML id')
  }, 60_000)

  it('22. rejects a template whose outlet the splice cannot match', () => {
    // The other half. A WELL-SHAPED id that the document does not actually
    // carry in a matchable form was previously a green build and a
    // `console.error` on the first request inside a Worker — the least-read
    // place a framework can report anything. Here the index.html is rewritten
    // to the unquoted `id=outlet`, which is legal HTML that the splice
    // deliberately declines.
    const out = buildExpectingFailure({ AIHU_E2E_UNQUOTED_OUTLET: '1' })
    expect(out).toContain('no element with id="outlet"')
    expect(out).toContain('must be quoted')
  }, 60_000)
})

describe('one unloadable registry entry degrades alone', () => {
  it('20. a component module that fails to import does not take the whole registry with it', async () => {
    // `__buildRouter` resolved both registries with `await Promise.all(...)`
    // over `await load()`, so ONE rejecting module rejected the whole build —
    // and `__getRouter` memoises the promise, so the isolate then returned
    // nothing to EVERY request for its entire life. Compounded by the missing
    // boundary above, that is a Worker which serves one 1101 per request until
    // Cloudflare recycles it.
    //
    // Measured against this variant before the fix: `fetchThrough` rejected
    // with `E2E-POISON: component module failed to import` — no response, and
    // no component rendered.
    const { status, body } = await fetchThrough(built.poison!.worker, 'https://e2e.test/')
    expect(status).toBe(200)
    // Every real component still resolved through the registry…
    expect(body).toContain('CARD-OK')
    expect(body).toContain('GRANDCHILD-OK')
    expect(body).toContain('EXTENDS-OK')
    expect(body).toContain('RECIPE-OK')
    expect(body).toContain('DEFINE-OK')
    // …and nested exactly as they are in the unpoisoned build.
    expect(body).toMatch(/<probe-card[^>]*>.*<probe-inner[^>]*>.*GRANDCHILD-OK/s)
  }, 60_000)

  it('20b. a layout module that fails to import does not cost the OTHER layouts theirs', async () => {
    // Same shape, second registry. The poisoned entry is a layout no route
    // uses; `app` is the one every page declares. Before the fix the two
    // `Promise.all`s were equally all-or-nothing, so an unrelated broken
    // layout stripped the shell off every route in the site.
    const { body } = await fetchThrough(built.poison!.worker, 'https://e2e.test/')
    expect(body).toContain('CHROME-OK')
    expect(body).toMatch(/data-aihu-outlet[^>]*>.*probe page/s)
  }, 60_000)

  it('20c. the degraded build still serves a complete, hydratable document', async () => {
    // Skipping a registry entry must not quietly change the response SHAPE —
    // the failure is supposed to cost exactly one element, not the head or the
    // client entry script.
    const { body, contentType } = await fetchThrough(built.poison!.worker, 'https://e2e.test/')
    expect(contentType).toMatch(/^text\/html/)
    expect(body.toLowerCase()).toMatch(/^\s*<!doctype html>/)
    expect(body).toMatch(/<script type="module"[^>]*src="\/assets\/index-[^"]+\.js"/)
  }, 60_000)

  it('20d. the poisoned tag is the only thing missing, and it renders as a bare element', async () => {
    // `<probe-poison>` is not referenced by any template in this fixture, so
    // the observable claim is the registry's: the skipped tag is absent from
    // it while every reachable one is present. Proven through the RESPONSE
    // rather than by reading the bundle, because the skip happens at request
    // time inside the Worker, not at build time.
    const mod = (await importWorker(built.poison!.worker)) as {
      handler?: (r: Request, platform?: unknown) => Promise<Response>
    }
    const res = await mod.handler!(new Request('https://e2e.test/'), { env: {}, ctx: {} })
    const html = await res.text()
    expect(html).not.toContain('probe-poison')
  }, 60_000)
})
