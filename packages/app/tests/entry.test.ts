/**
 * virtual:aihu-entry tests — eliminates the need for a scaffolded
 * `src/main.ts` (packages/cli/src/index.ts's appMainTs/appIndexHtml no
 * longer write one for the minimal/docs templates).
 *
 * Three layers of proof:
 *   1. Unit — injectEntryScript() string transform (injection + both escape
 *      hatches: a real src/main.ts, or any pre-existing module script tag).
 *   2. Plugin registration — viteAihuPlugin() wires up resolveId/load/
 *      transformIndexHtml for the virtual module.
 *   3. End-to-end — a real `vite build` proves the virtual module is
 *      resolvable as an HTML script-tag entry (the one mechanism this repo
 *      had no prior precedent for) in both the injected and ejected cases.
 */

import { existsSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { afterAll, describe, expect, it } from 'vitest'
import {
  ENTRY_RESOLVED_ID,
  ENTRY_SOURCE,
  ENTRY_VIRTUAL_ID,
  entrySource,
  injectEntryScript,
} from '../src/entry.ts'
import { viteAihuPlugin } from '../src/vite-plugin.ts'

const sourceHtml =
  '<!doctype html><html><head><title>Scaffold</title></head><body><div id="outlet"></div></body></html>'

describe('injectEntryScript — injection & escape hatches', () => {
  it('injects the virtual entry script before </body> when there is no user entry', () => {
    const out = injectEntryScript(sourceHtml, false)
    expect(out).toContain(`<script type="module" src="/${ENTRY_VIRTUAL_ID}"></script>`)
    expect(out.indexOf('<script')).toBeLessThan(out.indexOf('</body>'))
  })

  it('leads with "/" — a bare "virtual:" src has no browser-recognised scheme', () => {
    // A `<script src>` is resolved by the BROWSER as a URL, not by Vite's
    // plugin-id resolver. The bare specifier `virtual:aihu-entry` looks like a
    // URL with scheme "virtual", which Chromium rejects outright ("Cross
    // origin requests are only supported for protocol schemes: chrome, data,
    // http, https") — every scaffolded dev server served a blank page on this
    // until the leading slash was added. `/virtual:aihu-entry` is a same-origin
    // absolute path instead.
    const out = injectEntryScript(sourceHtml, false)
    expect(out).toContain(`src="/${ENTRY_VIRTUAL_ID}"`)
    expect(out).not.toContain(`src="${ENTRY_VIRTUAL_ID}"`)
  })

  it('leaves html unchanged when a real src/main.ts exists (full eject)', () => {
    expect(injectEntryScript(sourceHtml, true)).toBe(sourceHtml)
  })

  it('leaves html unchanged when a module script tag is already present', () => {
    const authored =
      '<!doctype html><html><body><script type="module" src="./src/main.ts"></script></body></html>'
    expect(injectEntryScript(authored, false)).toBe(authored)
  })

  it('leaves html unchanged when there is no </body> to inject before', () => {
    const fragment = '<div>no body tag here</div>'
    expect(injectEntryScript(fragment, false)).toBe(fragment)
  })
})

describe('entrySource — config threading', () => {
  it('is byte-identical to ENTRY_SOURCE when neither option is set', () => {
    expect(entrySource()).toBe(ENTRY_SOURCE)
    expect(entrySource(undefined, undefined)).toBe(ENTRY_SOURCE)
  })

  it('threads outletId alone, matching the pre-existing single-field shape', () => {
    expect(entrySource('root')).toBe(
      'import { createApp } from \'@aihu/app/client\'\n\ncreateApp({ outletId: "root" })\n',
    )
  })

  it('threads router.viewTransitions alone', () => {
    const out = entrySource(undefined, true)
    expect(out).toContain('createApp({ router: { viewTransitions: true } })')
  })

  it('threads both outletId and router.viewTransitions together', () => {
    const out = entrySource('root', true)
    expect(out).toContain('outletId: "root"')
    expect(out).toContain('router: { viewTransitions: true }')
  })
})

describe('aihu-entry plugin — hooks are registered', () => {
  it('viteAihuPlugin() includes an aihu-entry plugin with resolveId/load/transformIndexHtml', () => {
    const plugins = viteAihuPlugin()
    const entry = plugins.find((p) => (p as Plugin).name === 'aihu-entry') as Plugin
    expect(entry).toBeDefined()
    expect(entry.resolveId).toBeDefined()
    expect(entry.load).toBeDefined()
    expect(entry.transformIndexHtml).toBeDefined()
  })

  it('resolveId accepts BOTH the bare specifier and the leading-slash request path', () => {
    // Two callers, two id shapes: an `import` statement hands resolveId the
    // bare specifier; the browser requesting the injected <script src> hands
    // Vite's dev server the leading-slash path. Both must resolve, or the
    // fix to injectEntryScript's src (above) serves a 404 in dev instead of a
    // CORS error — a different failure, still a blank page.
    const plugins = viteAihuPlugin()
    const entry = plugins.find((p) => (p as Plugin).name === 'aihu-entry') as Plugin
    // biome-ignore lint/suspicious/noExplicitAny: exercising the raw hook fn
    const resolveId = entry.resolveId as any
    expect(resolveId.call({}, ENTRY_VIRTUAL_ID)).not.toBeNull()
    expect(resolveId.call({}, `/${ENTRY_VIRTUAL_ID}`)).not.toBeNull()
    expect(resolveId.call({}, `${ENTRY_VIRTUAL_ID}?x=1`)).toBeNull()
  })

  it('load() forwards config.router.viewTransitions into the generated entry', () => {
    const plugins = viteAihuPlugin({ router: { viewTransitions: true } })
    const entry = plugins.find((p) => (p as Plugin).name === 'aihu-entry') as Plugin
    // biome-ignore lint/suspicious/noExplicitAny: exercising the raw hook fn
    const load = entry.load as any
    expect(load.call({}, ENTRY_RESOLVED_ID)).toContain('router: { viewTransitions: true }')
  })

  it('load() omits router entirely when not configured (byte-identical default)', () => {
    const plugins = viteAihuPlugin()
    const entry = plugins.find((p) => (p as Plugin).name === 'aihu-entry') as Plugin
    // biome-ignore lint/suspicious/noExplicitAny: exercising the raw hook fn
    const load = entry.load as any
    expect(load.call({}, ENTRY_RESOLVED_ID)).toBe(ENTRY_SOURCE)
  })
})

describe('end-to-end: vite build resolves virtual:aihu-entry as a real HTML script-tag entry', () => {
  let injectedDir: string
  let ejectedDir: string

  afterAll(async () => {
    if (injectedDir) await rm(injectedDir, { recursive: true, force: true })
    if (ejectedDir) await rm(ejectedDir, { recursive: true, force: true })
  })

  /**
   * Build the entry plugin object directly from the exported pieces — the
   * same construction viteAihuPlugin() registers (see the suite above), but
   * inline so the nested `vite build` does not re-resolve @aihu/router/plugin
   * or @aihu/compiler (build-time subpaths whose dist isn't built in the
   * test environment).
   */
  function makeEntryPlugin(root: string): Plugin {
    return {
      name: 'aihu-entry',
      resolveId(id) {
        // Both id shapes, matching the real plugin in vite-plugin.ts — this
        // helper is a hand-kept copy, and it drifted once before (it still
        // asserted the bare specifier after injectEntryScript moved to the
        // leading-slash form, so this exact build silently regressed until a
        // real `vite build()` in this test caught it: HTML's own transform
        // pipeline hands resolveId the leading-slash form, not the bare one).
        return id === ENTRY_VIRTUAL_ID || id === `/${ENTRY_VIRTUAL_ID}` ? ENTRY_RESOLVED_ID : null
      },
      load(id) {
        return id === ENTRY_RESOLVED_ID ? ENTRY_SOURCE : null
      },
      transformIndexHtml: {
        order: 'pre',
        handler(html: string) {
          const hasUserEntry = existsSync(join(root, 'src/main.ts'))
          return injectEntryScript(html, hasUserEntry)
        },
      },
    }
  }

  // @aihu/app/client (what ENTRY_SOURCE imports) itself statically imports
  // virtual:aihu-{routes,layouts,components} — normally provided by
  // viteRouterIntegration, deliberately excluded here (see makeEntryPlugin's
  // doc comment). A build only needs to BUNDLE the module graph, not execute
  // it, so a syntactically-valid default export per specifier is enough.
  function stubRouterVirtualsPlugin(): Plugin {
    const specs: Record<string, string> = {
      'virtual:aihu-routes': '\0virtual:aihu-routes',
      'virtual:aihu-layouts': '\0virtual:aihu-layouts',
      'virtual:aihu-components': '\0virtual:aihu-components',
    }
    return {
      name: 'stub-router-virtuals',
      resolveId(id) {
        return specs[id] ?? null
      },
      load(id) {
        return Object.values(specs).includes(id) ? 'export default []' : null
      },
    }
  }

  it('injects and builds virtual:aihu-entry when no src/main.ts exists', async () => {
    const { build } = await import('vite')

    // realpath resolves the macOS /var → /private/var symlink that rolldown
    // would otherwise reject as an absolute-looking path when emitting HTML.
    injectedDir = await realpath(await mkdtemp(join(tmpdir(), 'aihu-entry-injected-')))
    await writeFile(
      join(injectedDir, 'index.html'),
      '<!doctype html>\n<html>\n<head>\n<title>Injected</title>\n</head>\n<body>\n<div id="outlet"></div>\n</body>\n</html>\n',
    )

    await build({
      root: injectedDir,
      logLevel: 'silent',
      plugins: [makeEntryPlugin(injectedDir), stubRouterVirtualsPlugin()],
      build: { outDir: join(injectedDir, 'dist'), emptyOutDir: true },
    })

    const builtHtml = await readFile(join(injectedDir, 'dist', 'index.html'), 'utf8')
    // The injected virtual-entry script tag was resolved into a real,
    // hashed build asset — proof the virtual module worked as an HTML entry.
    expect(builtHtml).toMatch(/<script[^>]*type="module"[^>]*src="\/assets\/index-[^"]+\.js"/)

    const assetFiles = readdirSync(join(injectedDir, 'dist', 'assets'))
    const jsFile = assetFiles.find((f) => f.endsWith('.js'))
    expect(jsFile).toBeDefined()
    const bundled = await readFile(join(injectedDir, 'dist', 'assets', jsFile as string), 'utf8')
    // Bundled output actually contains @aihu/app/client's real code (a
    // string literal that survives minification, unlike the `createApp`
    // identifier itself, which gets renamed) — proof the virtual module's
    // `import { createApp } from '@aihu/app/client'; createApp()` source
    // was resolved, bundled, and invoked, not just an empty entry.
    expect(bundled).toContain('no element with id=')
  })

  it('does NOT inject virtual:aihu-entry when a real src/main.ts exists (escape hatch, end-to-end)', async () => {
    const { build } = await import('vite')

    ejectedDir = await realpath(await mkdtemp(join(tmpdir(), 'aihu-entry-ejected-')))
    await writeFile(
      join(ejectedDir, 'index.html'),
      '<!doctype html>\n<html>\n<body>\n<div id="outlet"></div>\n<script type="module" src="./src/main.ts"></script>\n</body>\n</html>\n',
    )
    await mkdir(join(ejectedDir, 'src'), { recursive: true })
    await writeFile(
      join(ejectedDir, 'src', 'main.ts'),
      'document.getElementById("outlet").textContent = "ejected"\n',
    )

    await build({
      root: ejectedDir,
      logLevel: 'silent',
      plugins: [makeEntryPlugin(ejectedDir)],
      build: { outDir: join(ejectedDir, 'dist'), emptyOutDir: true },
    })

    const assetFiles = readdirSync(join(ejectedDir, 'dist', 'assets'))
    const jsFile = assetFiles.find((f) => f.endsWith('.js'))
    expect(jsFile).toBeDefined()
    const bundled = await readFile(join(ejectedDir, 'dist', 'assets', jsFile as string), 'utf8')
    // The real src/main.ts shipped, not the virtual createApp() default.
    expect(bundled).toContain('ejected')
    expect(bundled).not.toContain('createApp')
  })
})
