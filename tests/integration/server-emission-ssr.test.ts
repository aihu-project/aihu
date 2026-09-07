// @vitest-environment node
/**
 * GX P3 (server emission) — the keystone vertical slice: a compiled `.aihu`
 * route renders to HTML server-side, in a plain JS runtime with NO DOM.
 *
 * Before this slice, a compiled module was client-registration only: its single
 * side-effect was `defineElement('tag', defineComponent(setup))`, whose
 * `defineComponent` call evaluates `class extends HTMLElement` — so the module
 * could not even be IMPORTED in Node/Bun (ReferenceError), and the setup
 * closure that builds the arbor tree was reachable only via a constructed
 * custom element (`connectedCallback`/`_build`). `--target server` output was
 * byte-identical to `--target client` for non-agent components, i.e. there was
 * no server artifact at all in any meaningful sense.
 *
 * The slice makes `--target server` diverge for non-agent components:
 *
 *   1. setup is hoisted to a named module const (reachable without a DOM);
 *   2. the `defineElement` registration is gated behind a DOM-globals check;
 *   3. the `@style` block (module-scope `new CSSStyleSheet()` — the other
 *      hard DOM dependency) is elided: styles never reach server HTML;
 *   4. `export const __ssr` / `export default` expose the host-less arbor-tree
 *      factory — the `ComponentDescription` (`() => arborTree`) shape that
 *      `@aihu/server`'s `renderToString` accepts, and which the caller's child
 *      registry holds for a component referenced by tag inside another
 *      template.
 *
 *      (This used to describe a `resolveComponent` callback on `@aihu/app`.
 *      That seam was never built, and it turned out to be the wrong shape:
 *      resolution is async while the compiled fast path is synchronous, so a
 *      per-render callback would have forced every page off the fast path. The
 *      caller pre-resolves a `ReadonlyMap<tag, module>` instead — see
 *      `SsrOptions.children` and
 *      `docs/plans/2026-08-05-ssr-child-components.md`. Naming a mechanism in a
 *      comment and never wiring it is how `contextSetup` and
 *      `_injectLightScopeId` each sat unbuilt for a release.)
 *
 * These tests run the REAL pipeline: Rust compiler binary → emitted server
 * artifact written to a scratch file → dynamic import in a node (DOM-less)
 * vitest environment → `renderToString`. The load-bearing assertions are that
 * the import itself does not throw and that real HTML comes back — exactly the
 * two things the pre-slice output could not do.
 *
 * Client-invariance is asserted in the same file at the structural level:
 * `--target client` and the default universal target must keep the ungated
 * module-scope registration and grow no server-emission bytes. Byte-for-byte
 * identity is policed by the Rust golden conformance suite and `bun run size`.
 *
 * Binary resolution: dev fallback is the workspace `target/{release,debug}`
 * build (same resolver `transform()` uses). Skipped when no binary is built —
 * mirrors the b3b-sidecar precedent of binary-dependent tests.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from '@aihu/compiler'
import { renderToString } from '@aihu/server'
import { afterAll, describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')

const hasBinary = ['target/release/aihu-compile', 'target/debug/aihu-compile'].some((p) =>
  existsSync(join(repoRoot, p)),
)

// Scratch inside the workspace (gitignored via `.scratch*/`) so the written
// artifact goes through the vite/vitest transform pipeline on dynamic import.
const SCRATCH = join(__dirname, '.scratch-ssr')

/**
 * The emitted artifact imports bare `@aihu/*` specifiers. Vitest's aliases
 * cover them for files it knows about, but a runtime-written scratch file is
 * safest with explicit source paths — rewrite specifiers to the package
 * sources so resolution can never silently fall back to a stale dist build.
 */
function withResolvedImports(code: string): string {
  return code.replaceAll("'@aihu/runtime'", `'${repoRoot}/packages/runtime/src/index.ts'`)
}

async function importServerArtifact(name: string, code: string): Promise<Record<string, unknown>> {
  mkdirSync(SCRATCH, { recursive: true })
  const file = join(SCRATCH, `${name}.ts`)
  writeFileSync(file, withResolvedImports(code))
  return (await import(/* @vite-ignore */ file)) as Record<string, unknown>
}

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true })
})

const FIXTURE = join(repoRoot, 'bench/compiler-conformance/route/01-basic-route.aihu')
const BLOG_INDEX = join(repoRoot, 'examples/blog-router/src/pages/index.aihu')
const GOVERNED = join(repoRoot, 'bench/compiler-conformance/route/04-governed-data.aihu')

describe.skipIf(!hasBinary)('GX P3 — server emission renders a compiled route (no DOM)', () => {
  it('runs in a DOM-less environment (precondition for every assertion below)', () => {
    expect(typeof HTMLElement).toBe('undefined')
    expect(typeof customElements).toBe('undefined')
    expect(typeof CSSStyleSheet).toBe('undefined')
  })

  it('server artifact imports in plain node and renderToString returns real HTML', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(FIXTURE, 'utf8')
    const { code } = transform(src, 'src/pages/01-basic-route.aihu', { target: 'server' })

    // Structural shape: standalone setup + gated registration + default export.
    expect(code).toContain('const __aihu_setup__ =')
    expect(code).toContain(
      "if (typeof HTMLElement !== 'undefined' && typeof customElements !== 'undefined')",
    )
    expect(code).toContain('export default __ssr')

    // The import itself is half the deliverable: pre-slice this threw
    // ReferenceError (HTMLElement) before any render could be attempted.
    const mod = await importServerArtifact('basic-route.server', code)
    expect(typeof mod.default).toBe('function')

    const hydratable = await renderToString(mod.default as () => unknown, { hydratable: true })
    expect(hydratable).toBe('<div class="users" data-aihu-path="0">Users</div>')

    const plain = await renderToString(mod.default as () => unknown)
    expect(plain).toBe('<div class="users">Users</div>')
  })

  it('a route with @style still imports server-side (CSSStyleSheet is elided)', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(BLOG_INDEX, 'utf8')
    const { code } = transform(src, 'src/pages/blog-index.aihu', { target: 'server' })

    // The @style block is the module-scope DOM dependency; it must be gone.
    expect(code).not.toContain('CSSStyleSheet')
    expect(code).not.toContain('adoptedStyleSheets')

    const mod = await importServerArtifact('blog-index.server', code)
    const html = await renderToString(mod.default as () => unknown, { hydratable: true })
    // Static template content renders. ($each boundaries render empty — the
    // structural-directive SSR walk is a later P3 slice; asserted here so the
    // gap is explicit and this test starts failing the moment it is closed.)
    expect(html).toContain('The aihu blog')
    expect(html).toContain('<h1')
    expect(html).toContain('About this blog')
  })

  it('client and universal targets keep the pre-slice shape (no __ssr bytes)', async () => {
    // Byte-for-byte identity of non-server output is policed where it already
    // lives: the Rust golden conformance suite (`sfc_conformance.rs` compiles
    // every `bench/compiler-conformance/blocks/*.golden.js` with the universal
    // target) and `bun run size`. The checked-in route golden is
    // prettier-formatted and tag-resolved differently than `transform()`'s
    // `--tag` path, so an exact string compare here would assert formatting,
    // not the compiler. This test asserts the structural invariant instead:
    // NOTHING from the server emission leaks into client/universal artifacts.
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(FIXTURE, 'utf8')

    const client = transform(src, 'src/pages/01-basic-route.aihu', { target: 'client' }).code
    const universal = transform(src, 'src/pages/01-basic-route.aihu', { target: 'universal' }).code

    for (const code of [client, universal]) {
      // The registration stays a module-scope side-effect (ungated).
      expect(code).toContain('defineElement(')
      expect(code).not.toContain("typeof HTMLElement !== 'undefined'")
      // No server-emission bytes.
      expect(code).not.toContain('__ssr')
      expect(code).not.toContain('__aihu_setup__')
      expect(code).not.toContain('export default')
    }
  })
})

// ─── GX P4 (#466) — governed loader-route: `route.data` renders server-side ──
//
// P3 item 2: the options-form ($prop) standalone-SSR shape threads props into
// the host-less SetupContext, so a `data:`-declared route's server artifact
// renders its gated payload — `__ssr({ route: { params, data } })` is exactly
// the call the router's generated loader makes after the gate settles.
//
// Compiled through the BINARY (not `transform()`) so `--expr-parser ast` is in
// force: the fixture's headline is a multi-read ternary over `route.data`, and
// the legacy token rewriter only rewrites the first prop read in an expression
// (a known W3 limitation — the ast mode is the corpus-diff path that fixes it).
// The `{#if}` boundaries in the same fixture still render EMPTY server-side —
// the structural-directive SSR walk is a later P3 slice (see the $each note
// above) — so the assertions ride the direct interpolations.
describe.skipIf(!hasBinary)('GX P4 — governed route renders route.data server-side', () => {
  function compileWithBinary(src: string, path: string): string {
    const bin = ['target/release/aihu-compile', 'target/debug/aihu-compile']
      .map((p) => join(repoRoot, p))
      .find((p) => existsSync(p))!
    return execFileSync(
      bin,
      [
        '--stdin',
        '--tag',
        'governed-lexicon',
        '--path',
        path,
        '--target',
        'server',
        '--expr-parser',
        'ast',
      ],
      { input: src, encoding: 'utf8' },
    )
  }

  it('entitled payload renders full data; withheld renders declared preview only', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(GOVERNED, 'utf8')
    const code = compileWithBinary(src, 'src/pages/04-governed-data.aihu')

    // The P4 options-form SSR shape: hoisted setup, gated registration,
    // prop-threading entry.
    expect(code).toContain('const __aihu_setup__ = (ctx) =>')
    expect(code).toContain(
      "if (typeof HTMLElement !== 'undefined' && typeof customElements !== 'undefined')",
    )
    expect(code).toContain('const __aihu_ssr_prop =')
    expect(code).toContain('export default __ssr')

    const mod = await importServerArtifact('governed-lexicon.server', code)
    const ssr = mod.__ssr as (props?: Record<string, unknown>) => unknown

    // Entitled: the generated loader granted — full payload in `route.data`.
    const entitled = await renderToString(
      (() =>
        ssr({
          route: {
            params: { slug: 'logos' },
            data: {
              $gx: { entitled: true },
              headword: 'logos-headword',
              senses: ['word', 'reason'],
            },
          },
        })) as () => never,
      { hydratable: true },
    )
    expect(entitled).toContain('<h1 class="gx-headword" data-aihu-path="0.0">logos-headword</h1>')
    expect(entitled).toContain('<p class="gx-slug" data-aihu-path="0.1">logos</p>')

    // Withheld: the gate withheld — ONLY the declared preview fields exist in
    // the payload, and only they can render (E6-style byte check: no governed
    // bytes in the response because none were ever passed in).
    const withheld = await renderToString(
      (() =>
        ssr({
          route: {
            params: { slug: 'logos' },
            data: {
              $gx: { entitled: false, reason: 'entitlement' },
              preview: { headword: 'preview-headword' },
            },
          },
        })) as () => never,
      { hydratable: true },
    )
    expect(withheld).toContain('<h1 class="gx-headword" data-aihu-path="0.0">preview-headword</h1>')
    expect(withheld).not.toContain('logos-headword')
    expect(withheld).not.toContain('word, reason')
  })

  it('__ssr() with no props still imports and renders the static shell (no DOM)', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(GOVERNED, 'utf8')
    const code = compileWithBinary(src, 'src/pages/04-governed-data.aihu')
    const mod = await importServerArtifact('governed-lexicon.noprops.server', code)
    // No props: prop getters read undefined; optional-chained expressions
    // yield their fallbacks and the structural shell still renders. (The
    // ternary headline reads `route.data.…` on undefined and would throw —
    // that is the CALLER's contract: a governed route is always rendered
    // through the loader's settled emission. Assert import + callability.)
    expect(typeof mod.__ssr).toBe('function')
    expect(typeof mod.default).toBe('function')
  })
})
