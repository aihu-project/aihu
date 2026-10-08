/**
 * SSG prerender tests (B4, SEO arc).
 *
 * Three layers of proof:
 *   1. defineConfig accepts `output: 'static'` and the `site` field.
 *   2. runPrerender against a tmp pages dir + a real built `index.html`
 *      template — asserts per-route `<pattern>/index.html` files are written
 *      with the correct per-page <head> (title/description/canonical/og/twitter/
 *      JSON-LD, absolute URLs) and rendered <body> content (not an empty shell).
 *   3. Dynamic-route handling: getStaticPaths() → one HTML per path; absent →
 *      skipped + a clear build warning.
 *
 * The route modules are supplied via a custom `loadModule` so the test
 * exercises the full prerender pipeline (route derivation, head folding from
 * `.route.json` sidecars, content rendering via @aihu/server's renderToString,
 * template head-injection + outlet content-injection, dynamic-path expansion)
 * without requiring the Rust SFC compiler.
 */

import type { Dirent } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { useRoute } from '@aihu/router'
import type { ResolvedConfig } from 'vite'
import { afterEach, describe, expect, it } from 'vitest'
import { AihuConfigError, defineConfig } from '../src/config.ts'
import { prerenderClose, runPrerender, type SsrModuleLoader } from '../src/prerender.ts'

/**
 * A directory walk that DESCENDS symlinked directories — i.e. bun's
 * `readdir({recursive:true, withFileTypes:true})`, reproduced on Node.
 *
 * Needed because `discoverComponents`'s symlink containment can only fire on a
 * candidate whose path escapes the components directory, and the only thing
 * that ever hands it one is a lister that descends a symlinked DIRECTORY. The
 * two runtimes disagree, measured on the same fixture shape and machine:
 *
 *   bun  v24.3.0  -> ok.aihu(file) . linked(symlink) .
 *                    evil.aihu(file, parentPath=<components>/linked)
 *   node v22.12.0 -> linked(symlink) . ok.aihu(file)      <- never descends
 *
 * This suite runs under Node even when launched with `bun x vitest` (the pool
 * worker's `process.execPath` is the Node binary), so with the real lister the
 * out-of-tree module is never a candidate — which is exactly why the previous
 * attempt at a containment test was VACUOUS: it passed against code with no
 * containment check at all, and could not tell "containment excluded it" from
 * "discovery never saw it". Neither `vi.mock('node:fs/promises')` nor
 * `vi.spyOn` can close that gap: the former reaches only the test file itself
 * (a module importing the builtin still gets the real one — measured), and the
 * latter throws "Module namespace is not configurable in ESM".
 *
 * So the lister is injected through `RunPrerenderOptions._listComponentDir`,
 * and NOTHING ELSE is substituted: real directories, a real symlink, real
 * `realpath` resolution, the real `discoverComponents`, the real `runPrerender`
 * driver. Each step calls the platform's own non-recursive `readdir`, so the
 * `Dirent`s — `parentPath` included — are genuine rather than fabricated.
 */
async function listDescendingSymlinks(dir: string): Promise<Dirent[]> {
  const out: Dirent[] = []
  const visit = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      out.push(e)
      const child = join(d, e.name)
      if (e.isDirectory()) {
        await visit(child)
      } else if (e.isSymbolicLink()) {
        const st = await stat(child).catch(() => null)
        if (st?.isDirectory()) await visit(child)
      }
    }
  }
  await visit(dir)
  return out
}

// ─── defineConfig: static mode + site ────────────────────────────────────────

describe('defineConfig — static output + site', () => {
  it("accepts output: 'static'", () => {
    expect(() => defineConfig({ output: 'static' })).not.toThrow()
  })

  it("still accepts output: 'spa'", () => {
    expect(() => defineConfig({ output: 'spa' })).not.toThrow()
  })

  it('rejects an unknown output mode', () => {
    // @ts-expect-error — intentionally invalid for the runtime guard test.
    expect(() => defineConfig({ output: 'ssr' })).toThrow(AihuConfigError)
  })

  it('accepts site.url', () => {
    const cfg = defineConfig({ output: 'static', site: { url: 'https://example.com' } })
    expect(cfg.site?.url).toBe('https://example.com')
  })
})

// ─── runPrerender — fixture build harness ─────────────────────────────────────

const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Scaffold Default</title>
  </head>
  <body>
    <div id="outlet"></div>
    <script type="module" src="/assets/main-abc123.js"></script>
  </body>
</html>
`

interface Fixture {
  root: string
  outDir: string
  resolvedViteConfig: ResolvedConfig
  warnings: string[]
  warn: (m: string) => void
}

async function makeFixture(template: string = TEMPLATE): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'aihu-ssg-'))
  const outDir = join(root, 'dist')
  await mkdir(join(root, 'pages'), { recursive: true })
  await mkdir(outDir, { recursive: true })
  // The "built" SPA index.html — our prerender template (carries the client
  // bundle <script> tag, so prerendered pages still hydrate into the SPA).
  await writeFile(join(outDir, 'index.html'), template)
  const warnings: string[] = []
  const resolvedViteConfig = {
    root,
    build: { outDir: 'dist' },
  } as unknown as ResolvedConfig
  return { root, outDir, resolvedViteConfig, warnings, warn: (m) => warnings.push(m) }
}

/** Write a route file + its `.route.json` sidecar into the pages dir. */
async function writeRoute(
  root: string,
  relPath: string,
  sidecar: Record<string, unknown> | null,
): Promise<void> {
  const abs = join(root, 'pages', relPath)
  await mkdir(join(abs, '..'), { recursive: true })
  await writeFile(abs, '// route stub\n')
  if (sidecar) {
    const sidecarPath = abs.replace(/\.[^.]+$/, '.route.json')
    await writeFile(sidecarPath, JSON.stringify(sidecar))
  }
}

describe('runPrerender — static routes', () => {
  let fx: Fixture
  afterEach(async () => {
    if (fx) await rm(fx.root, { recursive: true, force: true })
  })

  it('writes per-route index.html with per-page <head> and rendered <body>', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', {
      name: 'home-page',
      head: { title: 'Home', description: 'Welcome home' },
    })
    await writeRoute(fx.root, 'about.ts', {
      name: 'about-page',
      head: {
        title: 'About Us',
        description: 'About this site',
        canonical: '/about',
        og: { title: 'About OG', image: '/og/about.png', type: 'website' },
        twitter: { card: 'summary', title: 'About TW' },
        jsonld: '{"@context":"https://schema.org","@type":"AboutPage","name":"About"}',
      },
    })

    const loadModule: SsrModuleLoader = async (file) => {
      const f = file.replace(/\\/g, '/')
      if (f.endsWith('/index.ts')) {
        return {
          default: () => ({
            kind: 'branch',
            tag: 'h1',
            children: [{ kind: 'leaf', leafKind: 'text', value: 'Home Content' }],
          }),
        }
      }
      return { default: { toHtml: () => '<article><h1>About Content</h1></article>' } }
    }

    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', site: { url: 'https://example.com' }, dir: { pages: 'pages' } },
      loadModule,
      warn: fx.warn,
    })

    expect(result.written.sort()).toEqual(['about/index.html', 'index.html'])

    // Root route content + head
    const homeHtml = await readFile(join(fx.outDir, 'index.html'), 'utf8')
    expect(homeHtml).toContain('<title>Home</title>')
    expect(homeHtml).not.toContain('<title>Scaffold Default</title>')
    expect(homeHtml).toContain('<meta name="description" content="Welcome home">')
    // Assert the CONTENT is reachable, not an exact markup blob: since DA3b the
    // prerenderer renders with `hydratable: true`, so elements legitimately
    // carry `data-aihu-path` markers and `<h1>Home Content</h1>` no longer
    // appears verbatim. Pinning the blob would have made this test fail on the
    // fix rather than on a regression.
    expect(homeHtml).toMatch(/<h1[^>]*>Home Content<\/h1>/)
    // Client bundle script preserved → page hydrates into SPA. That is exactly
    // why the markers must be present: without them the client walker has
    // nothing to adopt and rebuilds the tree beside the prerendered DOM.
    expect(homeHtml).toContain('src="/assets/main-abc123.js"')
    expect(homeHtml).toContain('data-aihu-path')

    // About route — full head surface + absolute URL resolution
    const aboutHtml = await readFile(join(fx.outDir, 'about', 'index.html'), 'utf8')
    expect(aboutHtml).toContain('<title>About Us</title>')
    expect(aboutHtml).toContain('<meta name="description" content="About this site">')
    expect(aboutHtml).toContain('<link rel="canonical" href="https://example.com/about">')
    expect(aboutHtml).toContain('<meta property="og:title" content="About OG">')
    expect(aboutHtml).toContain(
      '<meta property="og:image" content="https://example.com/og/about.png">',
    )
    expect(aboutHtml).toContain('<meta property="og:type" content="website">')
    expect(aboutHtml).toContain('<meta name="twitter:card" content="summary">')
    expect(aboutHtml).toContain('<meta name="twitter:title" content="About TW">')
    expect(aboutHtml).toContain('<script type="application/ld+json">')
    expect(aboutHtml).toContain('"@type":"AboutPage"')
    expect(aboutHtml).toContain('<article><h1>About Content</h1></article>')
    expect(aboutHtml).toContain('src="/assets/main-abc123.js"')
  })

  it('fails with both route pattern and source file when route loading fails', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, 'broken.ts', null)
    await expect(
      runPrerender({
        resolvedViteConfig: fx.resolvedViteConfig,
        config: { output: 'static', dir: { pages: 'pages' } },
        loadModule: async () => {
          throw new Error('fixture load failure')
        },
        warn: fx.warn,
      }),
    ).rejects.toThrow(/failed to load route \/broken .*pages\/broken\.ts.*fixture load failure/)
  })

  it('fails with route context when rendering throws', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, 'broken.ts', null)
    await expect(
      runPrerender({
        resolvedViteConfig: fx.resolvedViteConfig,
        config: { output: 'static', dir: { pages: 'pages' } },
        loadModule: async () => ({
          default: {
            toHtml: () => {
              throw new Error('fixture render failure')
            },
          },
        }),
        warn: fx.warn,
      }),
    ).rejects.toThrow(
      /render failed for route \/broken .*pages\/broken\.ts.*fixture render failure/,
    )
  })

  it('writes file-format paths when configured', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, 'about.ts', null)
    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', static: { format: 'file' }, dir: { pages: 'pages' } },
      loadModule: async () => ({ default: { toHtml: () => '<main>About file route</main>' } }),
      warn: fx.warn,
    })
    expect(result.written).toEqual(['about.html'])
    expect(await readFile(join(fx.outDir, 'about.html'), 'utf8')).toContain('About file route')
  })

  it('rejects static paths that escape build.outDir', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, '[slug].ts', null)
    await expect(
      runPrerender({
        resolvedViteConfig: fx.resolvedViteConfig,
        config: { output: 'static', dir: { pages: 'pages' } },
        loadModule: async () => ({
          default: { toHtml: () => '<main>unsafe path</main>' },
          getStaticPaths: () => [{ slug: '../outside' }],
        }),
        warn: fx.warn,
      }),
    ).rejects.toThrow(/resolved to an HTML path outside build\.outDir/)
  })

  it('folds globalHead (app.head) under per-route overrides', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', { name: 'home', head: { title: 'Page Title' } })
    const loadModule: SsrModuleLoader = async () => ({ default: { toHtml: () => '<p>x</p>' } })

    await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: {
        output: 'static',
        dir: { pages: 'pages' },
        app: { head: { meta: [{ name: 'author', content: 'Aihu' }] } as never },
      },
      loadModule,
      warn: fx.warn,
    })

    const html = await readFile(join(fx.outDir, 'index.html'), 'utf8')
    expect(html).toContain('<title>Page Title</title>')
    expect(html).toContain('<meta name="author" content="Aihu">')
  })
})

// ─── runPrerender — SSR layout parity (#7) ────────────────────────────────────

describe('runPrerender — layout composition', () => {
  let fx: Fixture
  afterEach(async () => {
    if (fx) await rm(fx.root, { recursive: true, force: true })
  })

  /** Write a layout `.aihu` file under the layouts dir (content irrelevant —
   * loadModule is mocked; scanLayouts only needs the file to exist). */
  async function writeLayout(root: string, name: string): Promise<void> {
    const dir = join(root, 'src', 'layouts')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${name}.aihu`), '<layout/>\n')
  }

  it('renders the page INSIDE the layout outlet marker', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', {
      name: 'home-page',
      layout: 'app',
      head: { title: 'Home' },
    })
    await writeLayout(fx.root, 'app')

    const loadModule: SsrModuleLoader = async (file) => {
      const f = file.replace(/\\/g, '/')
      if (f.endsWith('/src/layouts/app.aihu')) {
        return {
          default: {
            toHtml: () =>
              '<div class="shell"><header>App Header</header><main data-aihu-outlet></main></div>',
          },
        }
      }
      return { default: { toHtml: () => '<h1>Home Content</h1>' } }
    }

    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages', layouts: 'src/layouts' } },
      loadModule,
      warn: fx.warn,
    })

    expect(result.written).toContain('index.html')
    const html = await readFile(join(fx.outDir, 'index.html'), 'utf8')
    // Layout shell present…
    expect(html).toContain('<header>App Header</header>')
    // …and the page content is INSIDE the layout's data-aihu-outlet marker.
    expect(html).toMatch(/data-aihu-outlet[^>]*><h1>Home Content<\/h1><\/main>/)
    // Per-route head still applied to the document.
    expect(html).toContain('<title>Home</title>')
    expect(html).toContain('src="/assets/main-abc123.js"')
  })

  it('stamps each module’s __aihu_light_scope__ as data-a on its prerendered root (LDF §10 step 3)', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', { name: 'home-page', layout: 'app' })
    await writeLayout(fx.root, 'app')

    // Both modules carry the compiler's server-target scope export. The layout
    // is an arbor factory (the walker path); its root must carry the LAYOUT's
    // id and the page root the PAGE's id — the ids must not cross, because the
    // page root's `data-a` is also the layout scope's `to ([data-a])` boundary.
    const loadModule: SsrModuleLoader = async (file) => {
      const f = file.replace(/\\/g, '/')
      if (f.endsWith('/src/layouts/app.aihu')) {
        return {
          __aihu_light_scope__: 'aabbccdd',
          default: () => ({
            kind: 'branch',
            tag: 'div',
            attrs: { class: 'shell' },
            children: [
              {
                kind: 'branch',
                tag: 'main',
                attrs: { 'data-aihu-outlet': '' },
                children: [],
              },
            ],
          }),
        }
      }
      return {
        __aihu_light_scope__: '11223344',
        default: () => ({
          kind: 'branch',
          tag: 'article',
          children: [{ kind: 'leaf', leafKind: 'text', value: 'Page Content' }],
        }),
      }
    }

    await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages', layouts: 'src/layouts' } },
      loadModule,
      warn: fx.warn,
    })

    const html = await readFile(join(fx.outDir, 'index.html'), 'utf8')
    // Layout root: its own scope id, on the ROOT element only.
    expect(html).toMatch(/<div class="shell" data-a="aabbccdd" data-aihu-path="0">/)
    // Page root: its own scope id — inside the layout's outlet marker.
    expect(html).toMatch(/<article data-a="11223344" data-aihu-path="0">Page Content<\/article>/)
    // Root-only: no other element gained a data-a stamp.
    expect(html.match(/ data-a="/g)).toHaveLength(2)
  })

  it('falls back to the SPA shell when the layout has no SSR-renderable default', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', { name: 'home-page', layout: 'app' })
    await writeLayout(fx.root, 'app')

    const loadModule: SsrModuleLoader = async (file) => {
      // Compiled-SFC layout: side-effect custom element, no default renderable.
      if (file.replace(/\\/g, '/').endsWith('/src/layouts/app.aihu')) return { default: undefined }
      return { default: { toHtml: () => '<h1>Home Content</h1>' } }
    }

    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages', layouts: 'src/layouts' } },
      loadModule,
      warn: fx.warn,
    })

    const html = await readFile(join(fx.outDir, 'index.html'), 'utf8')
    expect(html).toContain('<h1>Home Content</h1>') // page still ships
    expect(html).not.toContain('App Header') // layout not server-rendered
    expect(result.warnings.join('\n')).toMatch(/no SSR-renderable default/)
  })

  it('warns and ships the page unwrapped when the layout has no <outlet> marker', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', { name: 'home-page', layout: 'broken' })
    await writeLayout(fx.root, 'broken')

    const loadModule: SsrModuleLoader = async (file) => {
      if (file.replace(/\\/g, '/').endsWith('/src/layouts/broken.aihu')) {
        return { default: { toHtml: () => '<div class="shell">no outlet here</div>' } }
      }
      return { default: { toHtml: () => '<h1>Home Content</h1>' } }
    }

    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages', layouts: 'src/layouts' } },
      loadModule,
      warn: fx.warn,
    })

    const html = await readFile(join(fx.outDir, 'index.html'), 'utf8')
    expect(html).toContain('<h1>Home Content</h1>') // page still ships
    expect(result.warnings.join('\n')).toMatch(/renders no <outlet>/)
  })

  // ─── the no-sidecar path — i.e. every real build ──────────────────────────
  //
  // The three tests above all hand `writeRoute` a sidecar object, so they only
  // ever exercised `readRouteSidecar()` returning a populated record. A real
  // SSG build never produces one: routes compile through the stdin path, which
  // writes no `.route.json` to disk. `sidecar?.layout` was therefore ALWAYS
  // undefined in production, layouts were never prerendered, and nothing warned
  // — the layout warnings above are all downstream of a name that never
  // arrived. The suite could not catch it because the fixture supplied by hand
  // exactly the artifact the build does not emit.
  //
  // So this test writes a real `.aihu` source with NO sidecar and asserts the
  // layout still wraps the page, recovered from source via `compileRouteMeta`.
  it('recovers the layout from source when no .route.json sidecar exists', async () => {
    fx = await makeFixture()
    const routePath = join(fx.root, 'pages', 'index.aihu')
    await writeFile(
      routePath,
      '@route {\n  layout: "app"\n}\n\n@template {\n  <h1>Home Content</h1>\n}\n',
    )
    await writeLayout(fx.root, 'app')

    const loadModule: SsrModuleLoader = async (file) => {
      if (file.replace(/\\/g, '/').endsWith('/src/layouts/app.aihu')) {
        return {
          default: {
            toHtml: () =>
              '<div class="shell"><header>App Header</header><main data-aihu-outlet></main></div>',
          },
        }
      }
      return { default: { toHtml: () => '<h1>Home Content</h1>' } }
    }

    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages', layouts: 'src/layouts' } },
      loadModule,
      warn: fx.warn,
    })

    expect(result.written).toContain('index.html')
    const html = await readFile(join(fx.outDir, 'index.html'), 'utf8')
    expect(html).toContain('<header>App Header</header>')
    expect(html).toMatch(/data-aihu-outlet[^>]*><h1>Home Content<\/h1><\/main>/)
  })
})

describe('runPrerender — dynamic routes', () => {
  let fx: Fixture
  afterEach(async () => {
    if (fx) await rm(fx.root, { recursive: true, force: true })
  })

  it('prerenders one HTML per getStaticPaths() entry', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, join('posts', '[slug].ts'), {
      name: 'post-page',
      head: { title: 'A Post', canonical: '/posts/x' },
    })

    const loadModule: SsrModuleLoader = async () => ({
      default: { toHtml: () => '<article>Post</article>' },
      getStaticPaths: () => [{ slug: 'hello' }, { params: { slug: 'world' } }],
    })

    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', site: { url: 'https://example.com' }, dir: { pages: 'pages' } },
      loadModule,
      warn: fx.warn,
    })

    expect(result.written.sort()).toEqual(['posts/hello/index.html', 'posts/world/index.html'])
    const hello = await readFile(join(fx.outDir, 'posts', 'hello', 'index.html'), 'utf8')
    expect(hello).toContain('<article>Post</article>')
    expect(hello).toContain('<title>A Post</title>')
    const world = await readFile(join(fx.outDir, 'posts', 'world', 'index.html'), 'utf8')
    expect(world).toContain('<article>Post</article>')
  })

  it('skips a dynamic route with no getStaticPaths() and warns clearly', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, join('posts', '[slug].ts'), { name: 'post-page' })

    const loadModule: SsrModuleLoader = async () => ({
      default: { toHtml: () => '<article>Post</article>' },
      // no getStaticPaths
    })

    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages' } },
      loadModule,
      warn: fx.warn,
    })

    expect(result.written).toEqual([])
    expect(result.warnings.join('\n')).toMatch(/dynamic route .* has no getStaticPaths/)
  })
})

describe('runPrerender — edge cases', () => {
  let fx: Fixture
  afterEach(async () => {
    if (fx) await rm(fx.root, { recursive: true, force: true })
  })

  it('fails with route context when a route lacks a renderable default', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', { name: 'home' })
    const loadModule: SsrModuleLoader = async () => ({ default: undefined })

    await expect(
      runPrerender({
        resolvedViteConfig: fx.resolvedViteConfig,
        config: { output: 'static', dir: { pages: 'pages' } },
        loadModule,
        warn: fx.warn,
      }),
    ).rejects.toThrow(/route \/ .*pages\/index\.ts.*no renderable default export/)
  })

  it('relative canonical stays relative when no site.url is configured', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, 'about.ts', {
      name: 'about',
      head: { title: 'About', canonical: '/about' },
    })
    const loadModule: SsrModuleLoader = async () => ({ default: { toHtml: () => '<p>a</p>' } })

    await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages' } },
      loadModule,
      warn: fx.warn,
    })

    const html = await readFile(join(fx.outDir, 'about', 'index.html'), 'utf8')
    expect(html).toContain('<link rel="canonical" href="/about">')
  })
})

// ─── runPrerender — a NON-DEFAULT outlet id ──────────────────────────────────
//
// `runPrerender` hardcoded `const outletId = 'outlet'` while `injectContent`
// already took the id as a parameter — so an app that set a different outlet id
// got a client mounting one element and a prerender splicing another. Every
// prerendered page shipped with its content dropped, and nothing warned.
//
// It was invisible because nothing could SET the id: `AihuConfig` had no
// `outletId` key at all (only `createApp({ outletId })`, in a hand-written
// `src/main.ts`, which the prerender never sees). So the fix is two things —
// the config key, and reading it — and only a test on a NON-DEFAULT value can
// tell the difference between them.

describe('runPrerender — app.outletId', () => {
  let fx: Fixture
  afterEach(async () => {
    if (fx) await rm(fx.root, { recursive: true, force: true })
  })

  const ROOT_TEMPLATE = TEMPLATE.replace('id="outlet"', 'id="app-root"')

  it('splices into the CONFIGURED outlet id, not the default', async () => {
    fx = await makeFixture(ROOT_TEMPLATE)
    await writeRoute(fx.root, 'index.ts', { name: 'home' })
    const loadModule: SsrModuleLoader = async () => ({
      default: { toHtml: () => '<p>OUTLET-CONTENT</p>' },
    })

    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages' }, app: { outletId: 'app-root' } },
      loadModule,
      warn: fx.warn,
    })

    expect(result.warnings).toEqual([])
    const html = await readFile(join(fx.outDir, 'index.html'), 'utf8')
    // INSIDE the element, not merely somewhere on the page.
    expect(html).toMatch(/<div id="app-root">.*OUTLET-CONTENT.*<\/div>/s)
  })

  it('warns instead of silently writing an empty shell when the id is not in the template', async () => {
    // The counterfactual, kept as a test: this is exactly the state a
    // misconfigured project lands in, and the old code wrote the file anyway
    // with no diagnostic of any kind.
    fx = await makeFixture(ROOT_TEMPLATE)
    await writeRoute(fx.root, 'index.ts', { name: 'home' })
    const loadModule: SsrModuleLoader = async () => ({
      default: { toHtml: () => '<p>OUTLET-CONTENT</p>' },
    })

    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      // The DEFAULT id, against a template that only has `app-root`.
      config: { output: 'static', dir: { pages: 'pages' } },
      loadModule,
      warn: fx.warn,
    })

    const html = await readFile(join(fx.outDir, 'index.html'), 'utf8')
    expect(html).not.toContain('OUTLET-CONTENT')
    expect(result.warnings.join('\n')).toMatch(/no element with id="outlet"/)
    expect(result.warnings.join('\n')).toMatch(/EMPTY outlet/)
  })

  it('still defaults to `outlet` when nothing is configured', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', { name: 'home' })
    const loadModule: SsrModuleLoader = async () => ({
      default: { toHtml: () => '<p>OUTLET-CONTENT</p>' },
    })

    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages' } },
      loadModule,
      warn: fx.warn,
    })

    expect(result.warnings).toEqual([])
    const html = await readFile(join(fx.outDir, 'index.html'), 'utf8')
    expect(html).toMatch(/<div id="outlet">.*OUTLET-CONTENT.*<\/div>/s)
  })
})

// ─── runPrerender — component discovery (SSR follow-ups §17/§18) ─────────────
//
// `docs/plans/2026-08-06-ssr-child-followups.md` §17/§18: `discoverComponents`
// used to load every `.aihu` file under the components dir one at a time
// (`for (const file of files.sort()) { await loadModule(file) }`), and warned
// on EVERY build about every component that failed to load under SSR —
// including demo/example components nothing on the site references.

describe('runPrerender — component discovery', () => {
  let fx: Fixture
  afterEach(async () => {
    if (fx) await rm(fx.root, { recursive: true, force: true })
  })

  it('§17: loads discovered components concurrently, not one at a time', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', { name: 'home' })
    const componentsDir = join(fx.root, 'src', 'components')
    await mkdir(componentsDir, { recursive: true })
    const COUNT = 5
    const DELAY_MS = 60
    for (let i = 0; i < COUNT; i++) {
      await writeFile(join(componentsDir, `widget-${i}.aihu`), '<div/>\n')
    }

    // OBSERVE CONCURRENCY, don't time it. A wall-clock threshold
    // (`elapsed < COUNT * DELAY_MS * 0.6`) is the obvious assertion and the
    // wrong one: it is a flake waiting for a loaded CI box, and it only
    // measures the property indirectly. Counting how many loads are in flight
    // at once tests the actual claim — the loop fans out — and is immune to how
    // fast the machine happens to be.
    let inFlight = 0
    let maxInFlight = 0
    const loadModule: SsrModuleLoader = async (file) => {
      const f = file.replace(/\\/g, '/')
      if (f.endsWith('/index.ts')) return { default: { toHtml: () => '<p>home</p>' } }
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      try {
        // Stands in for real per-module cost (Vite transform + I/O). The delay
        // only has to be long enough that a serial loop cannot overlap.
        await new Promise((r) => setTimeout(r, DELAY_MS))
        const stem = f.slice(f.lastIndexOf('/') + 1).replace(/\.aihu$/, '')
        return { __aihu_tag__: stem }
      } finally {
        inFlight--
      }
    }

    await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages', components: 'src/components' } },
      loadModule,
      warn: fx.warn,
    })

    // A serial loop can never exceed 1. Asserting the exact fan-out (rather
    // than `> 1`) also pins that nothing silently throttles it later.
    expect(maxInFlight).toBe(COUNT)
  })

  it('§18: warns about a component that fails to load ONLY when something references it', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', { name: 'home' })
    const componentsDir = join(fx.root, 'src', 'components')
    await mkdir(componentsDir, { recursive: true })
    // Loads fine, and declares a reference to `weather-demo` — the tag
    // `weather-demo.aihu` registers under (its file stem; no @meta/@route
    // name override, so `readAihuComponentTag` derives the same tag).
    await writeFile(join(componentsDir, 'nav-bar.aihu'), '<nav/>\n')
    // Fails to load (mirrors `weather-demo.aihu`'s real SSR failure:
    // `CSSStyleSheet is not defined`) and IS referenced above.
    await writeFile(join(componentsDir, 'weather-demo.aihu'), '<weather/>\n')
    // Fails to load too, but nothing references it.
    await writeFile(join(componentsDir, 'orphan-demo.aihu'), '<orphan/>\n')

    const loadModule: SsrModuleLoader = async (file) => {
      const f = file.replace(/\\/g, '/')
      if (f.endsWith('/index.ts')) return { default: { toHtml: () => '<p>home</p>' } }
      if (f.endsWith('/nav-bar.aihu')) {
        return { __aihu_tag__: 'nav-bar', __aihu_child_tags__: ['weather-demo'] }
      }
      if (f.endsWith('/weather-demo.aihu')) throw new Error('CSSStyleSheet is not defined')
      if (f.endsWith('/orphan-demo.aihu')) throw new Error('CSSStyleSheet is not defined')
      throw new Error(`unexpected file: ${file}`)
    }

    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages', components: 'src/components' } },
      loadModule,
      warn: fx.warn,
    })

    const warnings = result.warnings.join('\n')
    expect(warnings).toMatch(/component "[^"]*weather-demo\.aihu" failed to load/)
    expect(warnings).not.toMatch(/component "[^"]*orphan-demo\.aihu" failed to load/)
  })
})

// ─── prerenderClose — real Vite SSR module loading by file path ───────────────

describe('prerenderClose — loads real route modules via Vite SSR', () => {
  let fx: Fixture
  afterEach(async () => {
    if (fx) await rm(fx.root, { recursive: true, force: true })
  })

  it('loads a real .ts route module by file path and prerenders its content', async () => {
    fx = await makeFixture()
    // A real route module on disk — exports a `default` renderable. prerenderClose
    // must import THIS module (not a stub) via Vite's SSR loader.
    await writeFile(
      join(fx.root, 'pages', 'index.ts'),
      `export default { toHtml: () => '<main>Real Module Content</main>' }\n`,
    )
    await writeFile(
      join(fx.root, 'pages', 'index.route.json'),
      JSON.stringify({ name: 'home-page', head: { title: 'Real Home', description: 'desc' } }),
    )

    const result = await prerenderClose(
      fx.resolvedViteConfig,
      { output: 'static', site: { url: 'https://example.com' }, dir: { pages: 'pages' } },
      fx.warn,
    )

    expect(result.written).toContain('index.html')
    const html = await readFile(join(fx.outDir, 'index.html'), 'utf8')
    expect(html).toContain('<main>Real Module Content</main>')
    expect(html).toContain('<title>Real Home</title>')
    expect(html).toContain('<meta name="description" content="desc">')
    expect(html).toContain('src="/assets/main-abc123.js"')
  }, 30000)
})

// ─── runPrerender — route context during SSG ─────────────────────────────────
//
// `@aihu/server` never imports `@aihu/context`; the seam is `_setContextFns` +
// `SsrOptions.contextSetup`, and `runPrerender` is the SSG SSR entry that owns
// wiring it. Before that wiring, `inject(RouteContext)` returned the token
// default (`null`) for the whole prerender, so every route-aware component
// server-rendered as if no route were active and then changed on the client.
//
// No component in a prerendered tree provides `RouteContext` — on the client
// `<router>` does, and there is no `<router>` here — so pre-population is the
// only mechanism, and these tests are what prove it survives to the walk.

describe('runPrerender — route context', () => {
  let fx: Fixture
  afterEach(async () => {
    if (fx) await rm(fx.root, { recursive: true, force: true })
  })

  it('exposes the matched route to the page render', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, 'about.ts', { name: 'about-page' })

    const loadModule: SsrModuleLoader = async () => ({
      default: () => ({
        kind: 'leaf',
        leafKind: 'text',
        value: `path=${useRoute()?.pathname ?? 'NO-ROUTE'}`,
      }),
    })

    await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages' } },
      loadModule,
      warn: fx.warn,
    })

    const html = await readFile(join(fx.outDir, 'about', 'index.html'), 'utf8')
    expect(html).toContain('path=/about')
    expect(html).not.toContain('NO-ROUTE')
  })

  it('gives each concrete path of a dynamic route its OWN params', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, join('posts', '[slug].ts'), { name: 'post-page' })

    const loadModule: SsrModuleLoader = async () => ({
      default: () => ({
        kind: 'leaf',
        leafKind: 'text',
        value: `slug=${useRoute()?.params.slug ?? 'NONE'}`,
      }),
      getStaticPaths: () => [{ slug: 'hello' }, { slug: 'world' }],
    })

    await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages' } },
      loadModule,
      warn: fx.warn,
    })

    expect(await readFile(join(fx.outDir, 'posts', 'hello', 'index.html'), 'utf8')).toContain(
      'slug=hello',
    )
    expect(await readFile(join(fx.outDir, 'posts', 'world', 'index.html'), 'utf8')).toContain(
      'slug=world',
    )
  })

  // The layout shell cache used to key on layout NAME alone, which was safe
  // only while layouts rendered route-blind. Now that a layout sees the route,
  // a name-only key would serve every page the FIRST page's chrome — the exact
  // bug an active-nav highlight would exhibit, and the reason to wire context
  // at all. This is the regression lock on the cache key.
  it('re-renders the layout per concrete path, not once per route pattern', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, join('posts', '[slug].ts'), { name: 'post-page', layout: 'app' })
    await mkdir(join(fx.root, 'src', 'layouts'), { recursive: true })
    await writeFile(join(fx.root, 'src', 'layouts', 'app.aihu'), '<layout/>\n')

    const loadModule: SsrModuleLoader = async (file) => {
      if (file.replace(/\\/g, '/').endsWith('/src/layouts/app.aihu')) {
        return {
          default: {
            toHtml: () =>
              `<div class="shell"><header>nav:${useRoute()?.params.slug ?? 'NONE'}</header>` +
              `<main data-aihu-outlet></main></div>`,
          },
        }
      }
      return {
        default: { toHtml: () => '<article>Post</article>' },
        getStaticPaths: () => [{ slug: 'hello' }, { slug: 'world' }],
      }
    }

    await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages', layouts: 'src/layouts' } },
      loadModule,
      warn: fx.warn,
    })

    expect(await readFile(join(fx.outDir, 'posts', 'hello', 'index.html'), 'utf8')).toContain(
      'nav:hello',
    )
    // The load-bearing assertion: 'world' must NOT have been served 'hello'.
    expect(await readFile(join(fx.outDir, 'posts', 'world', 'index.html'), 'utf8')).toContain(
      'nav:world',
    )
  })
})

// ─── Fixes that shipped with no test at all ─────────────────────────────────
//
// A review reverted each of these and found the whole suite still green. They
// are the feature's own headline behaviours — the diagnostics that exist to end
// silent empty renders, a security boundary, and a live content-corruption fix
// — so "nothing would notice" is the worst possible coverage for them.

describe('runPrerender — previously unguarded fixes', () => {
  let fx: Fixture

  afterEach(async () => {
    // Was `await fx?.cleanup?.()` — a property `Fixture` does not have, so the
    // optional call silently no-opped and every fixture in this block leaked
    // its temp directory (and, since §23, a dangling symlink). `tsc` flagged it;
    // the suite could not, because a no-op teardown passes.
    if (fx) await rm(fx.root, { recursive: true, force: true })
  })

  it('splices page content WITHOUT $-expansion', async () => {
    // Rendered content used to go into a `String.replace` REPLACEMENT string,
    // where `$&`, `` $` ``, `$'` and `$n` expand as backreferences — so prose
    // containing one re-spliced the layout shell into itself. `/api/store`
    // trips this in the real docs build.
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', { name: 'home' })
    const evil = "price is $` and $& and $' and $1"
    const loadModule: SsrModuleLoader = async () => ({
      default: { toHtml: () => `<p>${evil}</p>` },
    })
    await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages' } },
      loadModule,
      warn: fx.warn,
    })
    const html = await readFile(join(fx.root, 'dist', 'index.html'), 'utf8')
    // The literal text survives, and the layout was not re-injected into itself.
    expect(html).toContain(evil)
    expect(html.match(/<p>price is/g)?.length).toBe(1)
  })

  it('warns when a referenced tag is not in the registry', async () => {
    // The §3 diagnostic. Without it an unresolvable reference is
    // indistinguishable from a component nobody registered, which is
    // indistinguishable from correct output for a third-party element.
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', { name: 'home' })
    const componentsDir = join(fx.root, 'src', 'components')
    await mkdir(componentsDir, { recursive: true })
    await writeFile(join(componentsDir, 'nav-bar.aihu'), '<nav/>\n')

    const loadModule: SsrModuleLoader = async (file) => {
      const f = file.replace(/\\/g, '/')
      if (f.endsWith('/index.ts')) return { default: { toHtml: () => '<p>home</p>' } }
      // References a tag no discovered component provides.
      return { __aihu_tag__: 'nav-bar', __aihu_child_tags__: ['ghost-widget'] }
    }
    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages', components: 'src/components' } },
      loadModule,
      warn: fx.warn,
    })
    expect(result.warnings.some((w) => w.includes('ghost-widget'))).toBe(true)
  })

  it('warns when a component module exports no __aihu_tag__', async () => {
    // Such a module cannot be resolved by tag and renders as an empty element.
    // Skipping it silently was the same failure class the feature removes.
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', { name: 'home' })
    const componentsDir = join(fx.root, 'src', 'components')
    await mkdir(componentsDir, { recursive: true })
    await writeFile(join(componentsDir, 'no-tag.aihu'), '<div/>\n')

    const loadModule: SsrModuleLoader = async (file) => {
      const f = file.replace(/\\/g, '/')
      if (f.endsWith('/index.ts')) return { default: { toHtml: () => '<p>home</p>' } }
      return {} // loads fine, exports no tag
    }
    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages', components: 'src/components' } },
      loadModule,
      warn: fx.warn,
    })
    expect(result.warnings.some((w) => w.includes('no-tag.aihu'))).toBe(true)
  })

  // §23: symlink containment, exercised rather than assumed.
  //
  // The previous attempt at this test was vacuous and was removed; see
  // `listDescendingSymlinks` at the top of this file for the measured reason
  // (Node's recursive `readdir` never descends a symlinked directory, so the
  // out-of-tree module was never a candidate at all) and for exactly what is
  // substituted — the directory lister, and nothing else.
  //
  // The load-bearing distinction: this asserts the out-of-tree module is
  // DISCOVERED AND THEN EXCLUDED — a candidate that reached the containment
  // check and lost — not merely that it is absent from the output. The
  // containment warning proves the first half (nothing else in
  // `discoverComponents` emits it, and it names the resolved path), and
  // `loaded` proves the second. Defeat the containment check and both flip.
  it('§23: discovers a module through a symlinked directory and REFUSES to load it', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', { name: 'home' })
    const componentsDir = join(fx.root, 'src', 'components')
    await mkdir(componentsDir, { recursive: true })
    await writeFile(join(componentsDir, 'in-tree.aihu'), '<div/>\n')
    // A real directory OUTSIDE the components tree, linked in from inside it.
    const outside = join(fx.root, 'outside')
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'evil.aihu'), '<div/>\n')
    await symlink(outside, join(componentsDir, 'linked'), 'dir')

    // PRECONDITION, asserted rather than assumed: the lister this test injects
    // really does surface the escaping module as a candidate. Without this, the
    // assertions below could pass for the wrong reason — which is precisely how
    // the previous attempt went wrong.
    const entries = await listDescendingSymlinks(componentsDir)
    const evil = entries.find((e) => e.name === 'evil.aihu')
    expect(evil?.isFile()).toBe(true)
    expect(evil?.parentPath).toBe(join(componentsDir, 'linked'))

    // Every discovered file is compiled AND EVALUATED by Vite at build time, so
    // "was it loaded" is the security property, not "was it rendered".
    const loaded: string[] = []
    const loadModule: SsrModuleLoader = async (file) => {
      const f = file.replace(/\\/g, '/')
      if (f.endsWith('/index.ts')) return { default: { toHtml: () => '<p>home</p>' } }
      loaded.push(f)
      return { __aihu_tag__: f.slice(f.lastIndexOf('/') + 1).replace(/\.aihu$/, '') }
    }

    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages', components: 'src/components' } },
      loadModule,
      warn: fx.warn,
      _listComponentDir: listDescendingSymlinks,
    })

    // Discovery is live: the in-tree sibling WAS loaded, from the same walk.
    expect(loaded.some((f) => f.endsWith('/in-tree.aihu'))).toBe(true)
    // …and the escaping module was never evaluated.
    expect(loaded.some((f) => f.includes('evil.aihu'))).toBe(false)
    // …because containment rejected it. The message names the candidate path
    // AND the real path it resolves to, so it cannot be produced by a miss.
    const containment = result.warnings.filter((w) => w.includes('evil.aihu'))
    expect(containment).toHaveLength(1)
    expect(containment[0]).toMatch(/skipping "[^"]*linked\/evil\.aihu"/)
    expect(containment[0]).toMatch(/resolves to "[^"]*outside\/evil\.aihu"/)
    expect(containment[0]).toMatch(/outside the components directory/)
  })

  // #909: a symlink that resolves INSIDE another configured `dir.components`
  // entry is a deliberate cross-reference between two dirs the same project
  // already configured (not an escape) and must be followed, not refused —
  // the opposite outcome from §23 above, which is the escape case.
  it('#909: follows a symlink that resolves inside another configured components dir', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', { name: 'home' })
    const componentsDir = join(fx.root, 'src', 'components')
    await mkdir(componentsDir, { recursive: true })
    await writeFile(join(componentsDir, 'in-tree.aihu'), '<div/>\n')
    // A SECOND configured components dir, elsewhere in the project — linked
    // in from inside the first, the way a workspace shares components across
    // packages (e.g. `packages/ui/src/components` linked into an app's tree).
    const shared = join(fx.root, 'shared-components')
    await mkdir(shared, { recursive: true })
    await writeFile(join(shared, 'shared.aihu'), '<div/>\n')
    await symlink(shared, join(componentsDir, 'linked'), 'dir')

    const loaded: string[] = []
    const loadModule: SsrModuleLoader = async (file) => {
      const f = file.replace(/\\/g, '/')
      if (f.endsWith('/index.ts')) return { default: { toHtml: () => '<p>home</p>' } }
      loaded.push(f)
      return { __aihu_tag__: f.slice(f.lastIndexOf('/') + 1).replace(/\.aihu$/, '') }
    }

    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: {
        output: 'static',
        dir: { pages: 'pages', components: ['src/components', 'shared-components'] },
      },
      loadModule,
      warn: fx.warn,
      _listComponentDir: listDescendingSymlinks,
    })

    // Both the in-tree sibling and the linked-but-configured module loaded —
    // no "outside the components directory" warning for either.
    expect(loaded.some((f) => f.endsWith('/in-tree.aihu'))).toBe(true)
    expect(loaded.some((f) => f.endsWith('shared.aihu'))).toBe(true)
    expect(result.warnings.some((w) => w.includes('outside the components directory'))).toBe(
      false,
    )
  })

  // §17 tie-break determinism.
  //
  // `discoverComponents` fans out with `Promise.all` over a SORTED list and
  // `buildChildRegistry` keeps the FIRST module claiming a tag — which is only
  // deterministic because `Promise.all` yields results in INPUT order. Push
  // results as they settle instead (the obvious "optimization") and the winner
  // becomes a race between module load times, silently, on a real build.
  //
  // The existing §17 test cannot see that: it counts concurrency, and both
  // shapes fan out identically. So: two files claim one tag, and the
  // LATER-sorted one resolves FIRST. The winner is observable through the
  // registry — the tags each module references differ, and only the WINNER's
  // references reach the unresolved-tag diagnostic.
  it('§17: the sort-first module wins a duplicate tag even when it resolves LAST', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', { name: 'home' })
    const componentsDir = join(fx.root, 'src', 'components')
    await mkdir(componentsDir, { recursive: true })
    await writeFile(join(componentsDir, 'a-first.aihu'), '<div/>\n')
    await writeFile(join(componentsDir, 'z-second.aihu'), '<div/>\n')

    const settleOrder: string[] = []
    const loadModule: SsrModuleLoader = async (file) => {
      const f = file.replace(/\\/g, '/')
      if (f.endsWith('/index.ts')) return { default: { toHtml: () => '<p>home</p>' } }
      const first = f.endsWith('/a-first.aihu')
      // Sorted FIRST, resolves LAST. The delay only has to be long enough that
      // the other load has certainly settled.
      if (first) await new Promise((r) => setTimeout(r, 50))
      settleOrder.push(first ? 'a-first' : 'z-second')
      return {
        __aihu_tag__: 'dup-tag',
        __aihu_child_tags__: [first ? 'ghost-from-a' : 'ghost-from-z'],
      }
    }

    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages', components: 'src/components' } },
      loadModule,
      warn: fx.warn,
    })

    // The premise: resolution order really is the INVERSE of sort order, so a
    // settle-ordered implementation would pick the other module.
    expect(settleOrder).toEqual(['z-second', 'a-first'])
    // The conflict was reported…
    expect(result.warnings.some((w) => w.includes('two modules claim'))).toBe(true)
    // …and the SORT-FIRST module is the one in the registry.
    const warnings = result.warnings.join('\n')
    expect(warnings).toContain('ghost-from-a')
    expect(warnings).not.toContain('ghost-from-z')
  })
})

// ─── §22: both diagnostics must see page→ and layout→component references ────
//
// `runPrerender` used to build its `referenced` set from `childRegistry`
// alone — tags referenced by DISCOVERED COMPONENTS — and emit both diagnostics
// before the render loop. Pages and layouts reference components too, and their
// modules load later, inside that loop, so their `__aihu_child_tags__` never
// reached the set.
//
// Found by re-running the real `apps/docs` build, not by the suite: after the
// §18 warn-gate landed, `weather-demo.aihu` (which fails to load under SSR with
// `CSSStyleSheet is not defined`, and is referenced from `pages/index.aihu` and
// `pages/cookbook/agent-weather.aihu` — pages, not components) was judged
// unreferenced and said nothing. The fix that existed to make load failures
// visible made the build quieter.
describe('runPrerender — diagnostics see page + layout references (§22)', () => {
  let fx: Fixture
  afterEach(async () => {
    if (fx) await rm(fx.root, { recursive: true, force: true })
  })

  it('warns about a broken component referenced only by a PAGE', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', { name: 'home' })
    const componentsDir = join(fx.root, 'src', 'components')
    await mkdir(componentsDir, { recursive: true })
    // Fails to load, exactly like the real `weather-demo.aihu`. NOTHING under
    // the components dir references it — the page does.
    await writeFile(join(componentsDir, 'weather-demo.aihu'), '<weather/>\n')
    // …and a second broken component nobody references at all, to prove the
    // §18 gate is still a gate and not just "warn about everything".
    await writeFile(join(componentsDir, 'orphan-demo.aihu'), '<orphan/>\n')

    const loadModule: SsrModuleLoader = async (file) => {
      const f = file.replace(/\\/g, '/')
      if (f.endsWith('/index.ts')) {
        return {
          default: { toHtml: () => '<p>home</p>' },
          __aihu_child_tags__: ['weather-demo'],
        }
      }
      throw new Error('CSSStyleSheet is not defined')
    }

    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages', components: 'src/components' } },
      loadModule,
      warn: fx.warn,
    })

    const warnings = result.warnings.join('\n')
    expect(warnings).toMatch(/component "[^"]*weather-demo\.aihu" failed to load/)
    expect(warnings).not.toMatch(/component "[^"]*orphan-demo\.aihu" failed to load/)
  })

  it('warns about a broken component referenced only by a LAYOUT', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', { name: 'home', layout: 'app' })
    await mkdir(join(fx.root, 'src', 'layouts'), { recursive: true })
    await writeFile(join(fx.root, 'src', 'layouts', 'app.aihu'), '<layout/>\n')
    const componentsDir = join(fx.root, 'src', 'components')
    await mkdir(componentsDir, { recursive: true })
    await writeFile(join(componentsDir, 'site-header.aihu'), '<header/>\n')

    const loadModule: SsrModuleLoader = async (file) => {
      const f = file.replace(/\\/g, '/')
      if (f.endsWith('/src/layouts/app.aihu')) {
        return {
          default: { toHtml: () => '<div><main data-aihu-outlet></main></div>' },
          __aihu_child_tags__: ['site-header'],
        }
      }
      if (f.endsWith('/index.ts')) return { default: { toHtml: () => '<p>home</p>' } }
      throw new Error('CSSStyleSheet is not defined')
    }

    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: {
        output: 'static',
        dir: { pages: 'pages', layouts: 'src/layouts', components: 'src/components' },
      },
      loadModule,
      warn: fx.warn,
    })

    expect(result.warnings.join('\n')).toMatch(/component "[^"]*site-header\.aihu" failed to load/)
  })

  it('reports an unresolved tag referenced only by a PAGE', async () => {
    // §3's diagnostic had the same hole: a tag referenced from a page and
    // absent from the registry was never reported.
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', { name: 'home' })
    const componentsDir = join(fx.root, 'src', 'components')
    await mkdir(componentsDir, { recursive: true })
    await writeFile(join(componentsDir, 'nav-bar.aihu'), '<nav/>\n')

    const loadModule: SsrModuleLoader = async (file) => {
      const f = file.replace(/\\/g, '/')
      if (f.endsWith('/index.ts')) {
        return {
          default: { toHtml: () => '<p>home</p>' },
          __aihu_child_tags__: ['nav-bar', 'ghost-from-page'],
        }
      }
      // A RENDERABLE component module, not just a tag claim: a real
      // server-target artifact exports `__ssrString`, `__aihu_shadow__` and
      // `__aihu_tag__` together, and §4 now reports a registry entry that has
      // the tag but not the renderer — which is what a bare `{ __aihu_tag__ }`
      // is. `nav-bar` here is the CONTROL for §3 ("a tag the registry supplies
      // stays quiet"), so it has to be a component the registry can actually
      // supply; otherwise the assertion below passes for the wrong reason.
      return { __aihu_tag__: 'nav-bar', __ssrString: () => '', __aihu_shadow__: 'light' }
    }

    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages', components: 'src/components' } },
      loadModule,
      warn: fx.warn,
    })

    const ghost = result.warnings.filter((w) => w.includes('ghost-from-page'))
    // Once per tag, not once per reference site.
    expect(ghost).toHaveLength(1)
    expect(ghost[0]).toMatch(/<ghost-from-page> is referenced but was not found/)
    // A tag the registry DOES supply must stay quiet.
    expect(result.warnings.some((w) => w.includes('<nav-bar>'))).toBe(false)
  })

  it('reports unresolved page tags in sorted order, once each', async () => {
    // Determinism: the emission moved after the render loop, where pages are
    // visited in route order. The tag list is sorted, not insertion-ordered.
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', { name: 'home' })
    await writeRoute(fx.root, 'about.ts', { name: 'about' })

    const loadModule: SsrModuleLoader = async (file) => {
      const f = file.replace(/\\/g, '/')
      // `about` is rendered before `index`; it references the LATER tag, and
      // both pages reference `zz-shared`.
      return f.endsWith('/about.ts')
        ? { default: { toHtml: () => '<p>a</p>' }, __aihu_child_tags__: ['mm-mid', 'zz-shared'] }
        : { default: { toHtml: () => '<p>h</p>' }, __aihu_child_tags__: ['aa-early', 'zz-shared'] }
    }

    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages' } },
      loadModule,
      warn: fx.warn,
    })

    const tags = result.warnings
      .map((w) => /<([a-z-]+)> is referenced but was not found/.exec(w)?.[1])
      .filter((t): t is string => t !== undefined)
    expect(tags).toEqual(['aa-early', 'mm-mid', 'zz-shared'])
  })
})

// ─── §22 second half: a reference the EMITTER DECLINED still counts ──────────
//
// Moving both diagnostics after the render loop (above) was necessary and NOT
// sufficient. `__aihu_child_tags__` is derived by scanning emitted
// `__aihu_schild(` call sites, so a reference the emitter declines under the v1
// child boundaries contributes no tag at all. `<weather-demo city="London">`
// carries an attribute, is therefore declined, and `pages/index.aihu` compiles
// to ZERO call sites — so it was STILL judged unreferenced, which is the exact
// case §22 was written for.
//
// `__aihu_referenced_tags__` (the compiler's `// @aihu:component-tags` marker,
// walked off the template AST) is the set that answers "does anything reference
// this?". These pin that `runPrerender` reads it, prefers it, and falls back.
describe('runPrerender — referenced tags come from the template AST (§22)', () => {
  let fx: Fixture
  afterEach(async () => {
    if (fx) await rm(fx.root, { recursive: true, force: true })
  })

  it('warns about a broken component whose only reference the emitter DECLINED', async () => {
    // The docs case in miniature: the page module exports NO
    // `__aihu_child_tags__` at all — there are no call sites to derive one
    // from — and names the component only via `__aihu_referenced_tags__`.
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', { name: 'home' })
    const componentsDir = join(fx.root, 'src', 'components')
    await mkdir(componentsDir, { recursive: true })
    await writeFile(join(componentsDir, 'weather-demo.aihu'), '<weather/>\n')
    // Still a gate: a second broken component nobody references stays quiet.
    await writeFile(join(componentsDir, 'orphan-demo.aihu'), '<orphan/>\n')

    const loadModule: SsrModuleLoader = async (file) => {
      const f = file.replace(/\\/g, '/')
      if (f.endsWith('/index.ts')) {
        return {
          default: { toHtml: () => '<p>home</p>' },
          __aihu_referenced_tags__: ['weather-demo'],
        }
      }
      throw new Error('CSSStyleSheet is not defined')
    }

    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages', components: 'src/components' } },
      loadModule,
      warn: fx.warn,
    })

    const warnings = result.warnings.join('\n')
    expect(warnings).toMatch(/component "[^"]*weather-demo\.aihu" failed to load/)
    expect(warnings).not.toMatch(/component "[^"]*orphan-demo\.aihu" failed to load/)
  })

  it('falls back to __aihu_child_tags__ when the newer export is absent', async () => {
    // A module compiled before the marker existed must still contribute what it
    // can, rather than contributing nothing and going silent.
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', { name: 'home' })

    const loadModule: SsrModuleLoader = async () => ({
      default: { toHtml: () => '<p>home</p>' },
      __aihu_child_tags__: ['legacy-only'],
    })

    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages' } },
      loadModule,
      warn: fx.warn,
    })

    expect(result.warnings.join('\n')).toMatch(/<legacy-only> is referenced but was not found/)
  })

  it('prefers the newer export over the older one — it does not union them', async () => {
    // `__aihu_referenced_tags__` already contains everything the call-site set
    // does. Unioning would let a stale artifact's narrower set masquerade as new
    // information, so the older export is not consulted when the newer is there.
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', { name: 'home' })

    const loadModule: SsrModuleLoader = async () => ({
      default: { toHtml: () => '<p>home</p>' },
      __aihu_referenced_tags__: ['from-marker'],
      __aihu_child_tags__: ['from-call-sites'],
    })

    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages' } },
      loadModule,
      warn: fx.warn,
    })

    const warnings = result.warnings.join('\n')
    expect(warnings).toMatch(/<from-marker> is referenced but was not found/)
    expect(warnings).not.toMatch(/from-call-sites/)
  })

  it('reports a broken component ONCE, with the reason — not twice, with a falsehood', async () => {
    // Found by rebuilding apps/docs after the fix above made the pair reachable.
    // `weather-demo` produced BOTH the load-failure line and §3's unresolved-tag
    // line, and the second says the component "was not found under
    // src/components" and advises "move it there" — of a file already there.
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', { name: 'home' })
    const componentsDir = join(fx.root, 'src', 'components')
    await mkdir(componentsDir, { recursive: true })
    await writeFile(join(componentsDir, 'weather-demo.aihu'), '<weather/>\n')

    const loadModule: SsrModuleLoader = async (file) => {
      const f = file.replace(/\\/g, '/')
      if (f.endsWith('/index.ts')) {
        return {
          default: { toHtml: () => '<p>home</p>' },
          __aihu_referenced_tags__: ['weather-demo'],
        }
      }
      throw new Error('CSSStyleSheet is not defined')
    }

    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages', components: 'src/components' } },
      loadModule,
      warn: fx.warn,
    })

    const about = result.warnings.filter((w) => w.includes('weather-demo'))
    expect(about).toHaveLength(1)
    expect(about[0]).toMatch(/failed to load \(CSSStyleSheet is not defined\)/)
    expect(about[0]).not.toMatch(/was not found under/)
  })
})

// ─── §4's warning is gated on "referenced", and the gate lives here ──────────
//
// `buildChildRegistry` warns for every discovered component that can never
// render (no `__ssrString`, or no `__aihu_shadow__`). It runs BEFORE the render
// loop and has no referenced set, so the gate can only live in `runPrerender`.
// It belongs there for §18's reason: the warning describes an EMPTY ELEMENT,
// and an unreferenced component puts no element on any page — there is no
// symptom for it to explain.
describe('runPrerender — the unrenderable-component warning is gated (§4)', () => {
  let fx: Fixture
  afterEach(async () => {
    if (fx) await rm(fx.root, { recursive: true, force: true })
  })

  /** A component module that LOADS but that `__aihu_schild` would refuse. */
  const unrenderable = (tag: string) => ({ __aihu_tag__: tag })
  /** What a real server-target artifact exports. */
  const renderable = (tag: string) => ({
    __aihu_tag__: tag,
    __ssrString: () => '',
    __aihu_shadow__: 'light',
  })

  it('stays quiet about an unrenderable component nothing references', async () => {
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', { name: 'home' })
    const componentsDir = join(fx.root, 'src', 'components')
    await mkdir(componentsDir, { recursive: true })
    await writeFile(join(componentsDir, 'lone-badge.aihu'), '<badge/>\n')

    const loadModule: SsrModuleLoader = async (file) =>
      file.replace(/\\/g, '/').endsWith('/index.ts')
        ? { default: { toHtml: () => '<p>home</p>' } }
        : unrenderable('lone-badge')

    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages', components: 'src/components' } },
      loadModule,
      warn: fx.warn,
    })

    expect(result.warnings.join('\n')).not.toMatch(/<lone-badge>/)
  })

  it('reports the SAME component once a page references it', async () => {
    // The control for the test above: identical fixture, one added reference.
    // Without this pair, "stays quiet" could pass because the warning never
    // fires at all.
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', { name: 'home' })
    const componentsDir = join(fx.root, 'src', 'components')
    await mkdir(componentsDir, { recursive: true })
    await writeFile(join(componentsDir, 'lone-badge.aihu'), '<badge/>\n')

    const loadModule: SsrModuleLoader = async (file) =>
      file.replace(/\\/g, '/').endsWith('/index.ts')
        ? { default: { toHtml: () => '<p>home</p>' }, __aihu_referenced_tags__: ['lone-badge'] }
        : unrenderable('lone-badge')

    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages', components: 'src/components' } },
      loadModule,
      warn: fx.warn,
    })

    expect(result.warnings.join('\n')).toMatch(
      /\[@aihu\/server\] <lone-badge> exports no compiled server renderer/,
    )
  })

  it('never gates a warning that is not about one tag rendering', async () => {
    // A duplicate tag claim breaks `customElements.define` on the CLIENT
    // whether or not this build prerenders a reference to it, so it must not be
    // suppressed. The gate keys on the `[@aihu/server] <tag> ` prefix precisely
    // so messages of any other shape replay unconditionally.
    fx = await makeFixture()
    await writeRoute(fx.root, 'index.ts', { name: 'home' })
    const componentsDir = join(fx.root, 'src', 'components')
    await mkdir(componentsDir, { recursive: true })
    await writeFile(join(componentsDir, 'a-dup.aihu'), '<a/>\n')
    await writeFile(join(componentsDir, 'b-dup.aihu'), '<b/>\n')

    const loadModule: SsrModuleLoader = async (file) => {
      const f = file.replace(/\\/g, '/')
      if (f.endsWith('/index.ts')) return { default: { toHtml: () => '<p>home</p>' } }
      // Two DISTINCT modules claiming one tag; nothing references it.
      return f.endsWith('/a-dup.aihu') ? renderable('same-tag') : renderable('same-tag')
    }

    const result = await runPrerender({
      resolvedViteConfig: fx.resolvedViteConfig,
      config: { output: 'static', dir: { pages: 'pages', components: 'src/components' } },
      loadModule,
      warn: fx.warn,
    })

    expect(result.warnings.join('\n')).toMatch(
      /two modules claim the custom-element tag "same-tag"/,
    )
  })
})
