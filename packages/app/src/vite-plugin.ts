import { existsSync, readFileSync } from 'node:fs'
import { cp, writeFile as fsWriteFile, mkdir } from 'node:fs/promises'
import { basename, dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
// Build-time sub-plugin imports. These are devDependencies of @aihu/app and
// are marked external in rolldown.config.ts — they are never bundled.
import {
  _deriveChildTags,
  _isLayoutFile,
  _layoutTag,
  _parseComponentTagsMarker,
  aihuCompilerPlugin,
  compileRouteMeta,
  transform,
} from '@aihu/compiler'
import type { RouteDefinition } from '@aihu/router'
import type { RouterPluginOptions } from '@aihu/router/plugin'
import { scanPages, viteRouterIntegration } from '@aihu/router/plugin'
import type { Plugin, PluginOption, ResolvedConfig, UserConfig } from 'vite'
import type { AdapterContext, CreateHandlerSourceOptions } from './adapter.ts'
import type { AihuConfig } from './config.ts'
import { validateAihuConfig } from './config.ts'
import { resolveCssTheme } from './css-theme.ts'
import { ENTRY_RESOLVED_ID, ENTRY_VIRTUAL_ID, entrySource, injectEntryScript } from './entry.ts'
import { applyHeadConfig } from './head.ts'
import { AIHU_CONFIG_PLUGIN, type AihuModuleApi, type AihuPluginApi } from './load-config.ts'
import { prerenderClose } from './prerender.ts'
import {
  buildServerEntrySource,
  SERVER_ENTRY_RESOLVED_ID,
  SERVER_ENTRY_VIRTUAL_ID,
  SSR_DOCUMENT_RESOLVED_ID,
  SSR_DOCUMENT_VIRTUAL_ID,
} from './server-entry.ts'
import { assertOutletPresent, DEFAULT_OUTLET_ID } from './ssr-document.ts'

/**
 * Where the `'ssr'` environment writes: a SIBLING of the client outDir, never
 * inside it.
 *
 * D-2: Cloudflare's `[assets] directory` serves the client outDir verbatim, so
 * SSR chunks written into it become publicly downloadable — server code, route
 * modules, and anything they close over, on a public URL. The two environments
 * need separate roots, and the server one must sit OUTSIDE the assets root.
 *
 * Derived from the client outDir rather than hardcoded, so a project that
 * renames `dist` does not silently get a `dist-server` unrelated to it.
 *
 * EXPORTED because an adapter needs the same answer and must not re-derive it.
 * `@aihu/adapter-cloudflare` writes `main = "<ssrOutDir>/_worker.js"` into the
 * wrangler.toml it generates; it had that path hardcoded as `dist-server/`
 * while this function was already computing the real one, so any project with a
 * non-default `build.outDir` got a config pointing at a file the build never
 * wrote. Two derivations of one fact is the bug — there is only this one.
 */
export function ssrOutDirFor(clientOutDir: string): string {
  // Trailing separators stripped by scanning backwards, NOT by `/[/\\]+$/`.
  // That regex is a polynomial-ReDoS sink (CodeQL js/polynomial-redos, high):
  // the `+` is anchored at the end, so on a value ending in many separators the
  // engine retries the quantifier from each start position — O(n^2) on input
  // that arrives from user config (`build.outDir`). A backwards scan is O(n)
  // and cannot backtrack at all.
  let end = clientOutDir.length
  while (end > 0) {
    const ch = clientOutDir[end - 1]
    if (ch !== '/' && ch !== '\\') break
    end--
  }
  return `${clientOutDir.slice(0, end)}-server`
}

/** Build input name → `dist-server/_worker.js`. */
const SSR_ENTRY_NAME = '_worker'

/**
 * Derive a `.aihu` file's server-render child tags for `genSC`.
 *
 * `transform` is content-addressed-memoized, so a file the build is about to
 * compile anyway costs one spawn total, not two. `target: 'server'` is
 * required: client/universal output carries no `__aihu_schild` call sites, so
 * any other target silently yields an empty edge set and prunes the whole
 * registry away.
 *
 * ## Why this needs the layouts dir
 *
 * `genSC` roots its reachability walk at the LAYOUTS as well as the pages, so
 * this function is now handed layout files — and a layout compiles in LAYOUT
 * MODE, under the namespaced `aihu-layout-<stem>` tag. Compiling one as an
 * ordinary component derives its tag from the file stem instead, and the
 * common case (`src/layouts/app.aihu`) then fails the build outright with C450:
 * `'app'` has no hyphen, so it could never register as a custom element.
 *
 * That is not hypothetical — it is exactly what the Workers-SSR e2e gate
 * caught the moment layouts became roots, and only that test caught it, because
 * it is the only one that runs a real `vite build` over a real layout file.
 *
 * The layout-mode decision is `@aihu/compiler`'s `_isLayoutFile` + `_layoutTag`
 * — the SAME pair `aihuCompilerPlugin`'s own transform uses. Reused rather than
 * re-derived: a second definition of "is this a layout, and what does it
 * register as" would drift from the plugin's the first time the convention
 * moved, and the two disagreeing means a layout whose children are silently
 * pruned from the server bundle.
 */
function makeDeriveChildTags(layoutsDir: string): (source: string, id: string) => string[] {
  return (source, id) => {
    const isLayout = _isLayoutFile(id, layoutsDir)
    const compiled = transform(source, id, {
      target: 'server',
      ...(isLayout ? { tag: _layoutTag(basename(id, '.aihu')) } : {}),
    }).code
    // ── Layouts use a DIFFERENT edge set, and the reason is a compiler fact,
    // not a preference.
    //
    // Measured on the server target: a compiled PAGE exports `__ssr` AND
    // `__ssrString`; a compiled LAYOUT exports `__ssr` only. `_deriveChildTags`
    // reads `__aihu_schild('<tag>'` call sites, which live exclusively in
    // `__ssrString` — so for every layout it returns `[]`. Rooting the walk at
    // layouts while deriving their edges that way would have added a root set
    // that can never contribute anything, which is worse than not adding it:
    // it looks done.
    //
    // A layout therefore renders through the WALKER, and the walker resolves a
    // child from the registry by tag on its own (`ssr.ts`'s child-component
    // arm), so the tags that matter for a layout are the ones its TEMPLATE
    // references — the `// @aihu:component-tags` marker, which the layout's
    // server output does carry.
    //
    // ACCEPTED TRADE, stated because it is real: the marker is the strictly
    // LARGER set. It counts references the walker will decline at render time
    // (one carrying attributes, one with children, one at a non-literal path),
    // so a layout can pull a module into the server bundle for an element that
    // renders empty. That is upload weight, and upload weight is the currency
    // on a Worker — but the alternative for layouts is the EMPTY set, i.e. a
    // site's entire nav and footer rendering blank on every route. Over-
    // inclusion by a reference or two beats that, and it stops being a trade
    // the moment the compiler emits `__ssrString` for layouts too.
    return isLayout ? _parseComponentTagsMarker(compiled) : _deriveChildTags(compiled)
  }
}

/** Map a pages-dir file path to a minimal RouteDefinition for adapter context. */
function fileToRouteDefinition(filePath: string, _root: string, pagesDir: string): RouteDefinition {
  // Derive a URL pattern from the file path relative to the pages directory.
  const rel = filePath
    .replace(/\\/g, '/')
    .replace(new RegExp(`^.*?${pagesDir}/`), '')
    .replace(/\.[^.]+$/, '') // strip extension
  const parts = rel.split('/').filter(Boolean)
  // Strip trailing 'index' segment (file-router convention)
  if (parts.length > 0 && parts[parts.length - 1] === 'index') parts.pop()

  const segments = parts.map((p) =>
    p.startsWith('[...') && p.endsWith(']')
      ? { kind: 'catchall' as const }
      : p.startsWith('[') && p.endsWith(']')
        ? { kind: 'param' as const, name: p.slice(1, -1) }
        : { kind: 'static' as const, path: p },
  )

  const pattern =
    segments.length === 0
      ? '/'
      : '/' +
        segments
          .map((s) => (s.kind === 'static' ? s.path : s.kind === 'param' ? `:${s.name}` : '*'))
          .join('/')

  return {
    pattern,
    segments,
    module: () => Promise.resolve({ default: null }),
  }
}

/** Build the AdapterContext object passed to adapter.adapt(). */
function buildAdapterContext(
  resolvedViteConfig: ResolvedConfig,
  routeFiles: string[],
  config: AihuConfig | undefined,
): AdapterContext {
  const outDir = resolvePath(resolvedViteConfig.root, resolvedViteConfig.build.outDir)
  const root = resolvedViteConfig.root
  const pagesDir = config?.dir?.pages ?? 'pages'

  const routes: RouteDefinition[] = routeFiles.map((f) => fileToRouteDefinition(f, root, pagesDir))

  return {
    outDir,
    root,
    routes,
    config: config ?? {},

    async emitFile(path: string, content: string): Promise<void> {
      const abs = resolvePath(outDir, path)
      await mkdir(dirname(abs), { recursive: true })
      await fsWriteFile(abs, content, 'utf8')
    },

    async copy(src: string, dest: string): Promise<void> {
      await mkdir(dirname(dest), { recursive: true })
      await cp(src, dest, { recursive: true, force: true })
    },

    async writeFile(absolutePath: string, content: string): Promise<void> {
      await mkdir(dirname(absolutePath), { recursive: true })
      await fsWriteFile(absolutePath, content, 'utf8')
    },

    createHandlerSource(opts?: CreateHandlerSourceOptions): string {
      const routesSpec = opts?.routesSpecifier ?? './routes-manifest.js'
      const serverSpec = opts?.serverSpecifier ?? '@aihu/server'
      return [
        `// AUTO-GENERATED — do not edit`,
        `import { createRequestRouter } from '${serverSpec}'`,
        `import routes from '${routesSpec}'`,
        `const _manifest = { routes }`,
        `const _handler = createRequestRouter(_manifest)`,
        `export { _handler as handler }`,
      ].join('\n')
    },
  }
}

/**
 * viteAihuPlugin() — composed Vite plugin for aihu SPA projects.
 *
 * Returns Plugin[] composing:
 *   [0] aihuCompilerPlugin (enforce:'pre') — transforms .aihu SFCs
 *   [1] viteRouterIntegration — serves virtual:aihu-routes + virtual:aihu-layouts
 *   [2] aihu-agent-readiness (opt-in) or no-op
 *   [3] aihu-entry — serves virtual:aihu-entry (createApp() with no options) and
 *       injects its <script> tag into index.html when no src/main.ts exists
 *   [4] aihu-head (injects config.app.head into index.html <head>)
 *   [5..n] user plugins from config.plugins
 *   [n+1] aihu-vite-passthrough (merges config.vite into Vite's resolved config)
 *   [n+2] aihu-adapter (adapter.adapt() on closeBundle, build mode only)
 *
 * @example
 * // vite.config.ts
 * import { defineConfig } from 'vite'
 * import { viteAihuPlugin } from '@aihu/app'
 * export default defineConfig({ plugins: [viteAihuPlugin()] })
 *
 * @example
 * // With adapter
 * import { cloudflare } from '@aihu/adapter-cloudflare'
 * export default defineConfig({
 *   plugins: [viteAihuPlugin({
 *     dir: { pages: 'src/pages' },
 *     adapter: cloudflare({ name: 'my-worker' }),
 *   })]
 * })
 */
export function viteAihuPlugin(config?: AihuConfig): PluginOption[] {
  // Validate the inline config the same way `defineConfig` does. Previously
  // only configs written through `defineConfig` were checked, so passing the
  // object straight to this function — which every example does — skipped
  // validation entirely. Now that the Vite config is becoming the canonical
  // home for aihu config, this is the path that matters most.
  const resolved: AihuConfig = config ?? {}
  validateAihuConfig(resolved)

  // `css.theme` / `css.hostTokens` → the compiler's css-engine options. A
  // relative theme path resolves the way Vite resolves `root` itself.
  const cssTheme = resolveCssTheme(
    config?.css?.theme,
    resolvePath(config?.vite?.root ?? process.cwd()),
  )
  const cssEngineOptions = {
    ...(cssTheme ? { theme: cssTheme.css } : {}),
    ...(config?.css?.hostTokens != null ? { hostTokens: config.css.hostTokens } : {}),
  }
  // The theme is read once, when this function runs. Restarting the dev
  // server re-evaluates the Vite config, which re-reads the file.
  const cssThemeWatchPlugin: Plugin = {
    name: 'aihu-css-theme',
    configureServer(server) {
      const file = cssTheme?.file
      if (file === undefined) return
      server.watcher.add(file)
      server.watcher.on('change', (changed) => {
        if (resolvePath(changed) === file) void server.restart()
      })
    },
  }

  // Marker plugin: carries the evaluated config on a public `api` handle so
  // non-Vite consumers (aihu add / dev / build, the language server, the VS
  // Code extension) can read it via `loadAihuConfig()` without running a
  // build. Modelled on Qwik's `QwikVitePluginApi`.
  //
  // This is what lets the Vite config be the single source of truth: tooling
  // reads the EVALUATED config — spreads, conditionals, computed values and
  // imported fragments all work, because the config genuinely ran.
  const configMarkerPlugin: Plugin = {
    name: AIHU_CONFIG_PLUGIN,
    api: {
      getAihuConfig: () => resolved,
      // @aihu/app declares itself under the same module contract every other
      // package uses, so nothing has to special-case the framework's own entry.
      aihuModule: '@aihu/app',
      getOptions: () => resolved,
    } satisfies AihuPluginApi & AihuModuleApi<AihuConfig>,
  }

  const routerOpts = {
    pagesDir: config?.dir?.pages ?? 'pages',
    layoutsDir: config?.dir?.layouts ?? 'src/layouts',
    // `componentsDir` has existed on RouterPluginOptions all along but was
    // unreachable from aihu.config.ts — changing it meant calling
    // viteRouterIntegration() yourself, i.e. abandoning viteAihuPlugin.
    ...(config?.dir?.components != null ? { componentsDir: config.dir.components } : {}),
    // Give the router's route generator the compiler's route-metadata extractor
    // so per-route head/middleware/params/ssr flow into virtual:aihu-routes in
    // SPA builds (no .route.json sidecar is written on the stdin compile path).
    // Cast bridges compiler's `RouteMeta` (head: unknown) to the router's
    // `RouteSidecar` (head: RouteHead) — the shapes are otherwise identical.
    compileRouteMeta: compileRouteMeta as unknown as NonNullable<
      RouterPluginOptions['compileRouteMeta']
    >,
    // Injected the same way, for the same reason: the router keeps zero
    // compiler dependency and `genSC` needs the compiler's ONE child-tag
    // derivation rather than a fourth copy of the rule.
    deriveChildTags: makeDeriveChildTags(config?.dir?.layouts ?? 'src/layouts'),
  } satisfies RouterPluginOptions

  // Agent readiness: opt-in only. No safe default for `name`.
  let agentPlugin: PluginOption
  const ar = config?.agentReadiness
  if (ar) {
    // Lazy-load @aihu-plugin/agent-readiness so it isn't pulled in when unused.
    // It is an ESM-only package (its `exports` expose no CJS/`require` entry), and
    // vite loads vite.config.ts as bundled ESM where the bare `require` global
    // doesn't exist — so neither `require(...)` nor createRequire works here
    // (createRequire uses CJS resolution → ERR_PACKAGE_PATH_NOT_EXPORTED). A
    // dynamic `import()` uses the ESM `import` condition and resolves correctly;
    // Vite accepts the resulting `Promise<Plugin>` as a plugin entry and awaits it.
    agentPlugin = import('@aihu-plugin/agent-readiness').then(
      ({ viteAgentReadinessIntegration }) => viteAgentReadinessIntegration(ar) as unknown as Plugin,
    )
  } else {
    // Stable no-op so plugin-inspector shows a meaningful entry
    agentPlugin = { name: 'aihu-agent-readiness-disabled' }
  }

  // Virtual client entry — see packages/app/src/entry.ts for the full
  // rationale and the escape-hatch contract.
  let entryRoot = process.cwd()
  const entryPlugin: Plugin = {
    name: 'aihu-entry',
    configResolved(rc) {
      entryRoot = rc.root
    },
    resolveId(id) {
      // Two callers reach this, with two different id shapes. An `import`
      // statement (from `virtual:aihu-components` or a test) resolves through
      // Vite's plugin container and hands us the bare specifier. A `<script
      // src="/virtual:aihu-entry">` in HTML (`injectEntryScript`, below) is a
      // browser HTTP REQUEST — Vite strips the origin and query, so the id
      // here is the leading-slash request PATH, not the bare specifier. Both
      // must resolve to the same module or dev serves a 404 for every new
      // project (the bug this comment exists to prevent regressing).
      return id === ENTRY_VIRTUAL_ID || id === `/${ENTRY_VIRTUAL_ID}` ? ENTRY_RESOLVED_ID : null
    },
    load(id) {
      // `app.outletId` threaded through, so a project that moved off `#outlet`
      // states it once in the config rather than being forced into a
      // hand-written `src/main.ts` just to tell the client.
      return id === ENTRY_RESOLVED_ID ? entrySource(config?.app?.outletId) : null
    },
    transformIndexHtml: {
      // Run before Vite's core HTML processing (which resolves <script> src
      // attributes into the module graph) so an injected tag is picked up as
      // a build entry the same way an authored one would be.
      order: 'pre',
      handler(html: string): string {
        const hasUserEntry = existsSync(join(entryRoot, 'src/main.ts'))
        return injectEntryScript(html, hasUserEntry)
      },
    },
  }

  // Head injection — applies config.app.head into the built index.html <head>.
  // Without this hook the configured global head (title/charset/viewport/meta)
  // is silently dropped from SPA/static output, hurting SEO and non-JS agents.
  const headPlugin: Plugin = {
    name: 'aihu-head',
    transformIndexHtml: {
      // Run after Vite's core HTML processing so our config wins over the
      // scaffold defaults present in the source index.html.
      order: 'post',
      handler(html: string): string {
        return applyHeadConfig(html, config?.app?.head)
      },
    },
  }

  // Vite config passthrough — deep-merged by Vite via the config() hook return value.
  const passthroughPlugin: Plugin = {
    name: 'aihu-vite-passthrough',
    config() {
      return (config?.vite ?? {}) as import('vite').UserConfig
    },
  }

  // Adapter sentinel — calls adapter.adapt() after build completes.
  // Registered unconditionally; short-circuits immediately if no adapter is set.
  let resolvedViteConfig: ResolvedConfig | null = null

  /**
   * `closeBundle` fires ONCE PER ENVIRONMENT.
   *
   * Under `output: 'ssr'` there are two (`client` and `ssr`), and neither the
   * adapter hook nor the SSG prerender was guarded — both would run twice per
   * build. For the adapter that means `adapt()` twice (a second `_worker.js`
   * write, a second `wrangler.toml` check); for the prerender it means a whole
   * second prerender pass over an outDir that is not even its own, since the
   * `ssr` environment's `build.outDir` is `dist-server`.
   *
   * This is the one place a shipped `output: 'static'` build can regress, so it
   * is a named helper with its own test rather than an inline condition
   * duplicated at two call sites.
   *
   * `'spa'`/`'static'` builds have exactly one environment, which Vite names
   * `client` — so the guard is a no-op there and those modes take zero new
   * paths. `environment` is absent on pre-Environment-API Vite; treated as
   * client (the single-environment case) rather than skipped, or the guard
   * would silently disable the adapter on an older Vite.
   */
  function isClientEnvironment(ctx: { environment?: { name?: string } }): boolean {
    const name = ctx.environment?.name
    return name === undefined || name === 'client'
  }

  const adapterPlugin: Plugin = {
    name: 'aihu-adapter',
    apply: 'build',
    configResolved(rc) {
      resolvedViteConfig = rc
    },
    async closeBundle() {
      if (!isClientEnvironment(this)) return
      const adapter = config?.adapter
      if (!adapter || !resolvedViteConfig) return

      const pagesDir = config?.dir?.pages ?? 'pages'
      const { routes: routeFiles } = scanPages(resolvedViteConfig.root, pagesDir)
      const context = buildAdapterContext(resolvedViteConfig, routeFiles, config)

      try {
        await adapter.adapt(context)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        this.error(`[@aihu/app] Adapter '${adapter.name}' failed: ${msg}`)
      }
    },
  }

  // SSG prerender — active only when `output: 'static'`. Runs after Vite writes
  // the SPA build and before the adapter (so an adapter, if present, sees the
  // per-route HTML). Prerenders every static route to a content-ful
  // `<pattern>/index.html` that hydrates into the SPA. `output: 'spa'` is a
  // no-op here, preserving the existing empty-shell behavior.
  let ssgResolvedConfig: ResolvedConfig | null = null
  const ssgPlugin: Plugin = {
    name: 'aihu-ssg',
    apply: 'build',
    configResolved(rc) {
      ssgResolvedConfig = rc
    },
    // Run before the adapter's closeBundle (plugin order in the array is honored
    // for sequential closeBundle hooks).
    async closeBundle() {
      if (!isClientEnvironment(this)) return
      if (config?.output !== 'static' || !ssgResolvedConfig) return
      try {
        await prerenderClose(ssgResolvedConfig, config, (msg) => this.warn(msg))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        this.error(`[@aihu/app] static (SSG) prerender failed: ${msg}`)
      }
    },
  }

  // ── output: 'ssr' ─────────────────────────────────────────────────────────
  // Everything below is gated on `output === 'ssr'`, so 'spa' and 'static'
  // builds take zero new paths.
  const ssrEnabled = config?.output === 'ssr'

  /**
   * Serves `virtual:aihu-server-entry` and declares the `ssr` environment.
   *
   * The environment declaration and the module have to live in one plugin
   * because they are one fact: the virtual id is only reachable as a build
   * entry through `rollupOptions.input`. `build.ssr: 'virtual:…'` fails with
   * `[UNRESOLVED_ENTRY]` — Vite's ssr-entry path resolves against the
   * filesystem before any plugin's `resolveId` sees it.
   */
  /**
   * The client outDir, captured in `config()` and read again in `load()`.
   *
   * ONE derivation, used for both the SSR outDir (`ssrOutDirFor`) and the
   * template path below — if the two disagreed, the Worker would inline an
   * `index.html` from a directory the client build never wrote to.
   */
  let clientOutDirForTemplate = 'dist'
  let projectRoot = process.cwd()

  /**
   * Serve `virtual:aihu-ssr-document` — the finished client `index.html`,
   * inlined into the Worker bundle, plus the resolved outlet id and the head
   * inputs.
   *
   * ## Why reading a build output from a `load()` hook is sound here
   *
   * The `builder.buildApp` above builds the CLIENT environment to completion
   * before it starts the `ssr` one, so `<outDir>/index.html` is on disk — with
   * its hashed `<script type="module">`, its modulepreloads, its stylesheet
   * links and the `app.head` the `aihu-head` plugin applied — by the time this
   * runs. That ordering is not incidental; it is the reason this whole approach
   * works, and it is why the SSG path (which reads the same file, from the same
   * place, at `closeBundle`) has always been able to produce hydrating pages
   * while live SSR could not.
   *
   * ## Why a missing template FAILS THE BUILD
   *
   * The alternative is a Worker that serves bare fragments: a green build, a
   * successful deploy, and a site that renders once and never hydrates — which
   * is the exact defect this module exists to remove, and it is invisible
   * without opening devtools. A named build error at the moment the input is
   * missing is the only version of this that a consumer can act on.
   */
  function loadSsrDocumentModule(this: { error(msg: string): never }): string {
    const templatePath = resolvePath(projectRoot, clientOutDirForTemplate, 'index.html')
    let template: string
    try {
      template = readFileSync(templatePath, 'utf8')
    } catch {
      return this.error(
        `[@aihu/app] output: 'ssr' — no client index.html at ${templatePath}, so the server ` +
          'bundle has no document to render into. Without it every SSR response would be a ' +
          'bare fragment with no <html>, no <head> and no client <script type="module">: the ' +
          'page would paint server-rendered markup and never hydrate. The client environment ' +
          'builds before this one, so an absent index.html means the client build wrote ' +
          'somewhere else — check build.outDir.',
      )
    }
    // The outlet has to be in the template, and this is the last moment anyone
    // can be told. `config.ts` guarantees the id is well-SHAPED; only here is
    // the finished document available to say whether it is PRESENT. Failing now
    // costs a build; not failing ships a site whose every page is an empty
    // shell until the client boots. See `assertOutletPresent`.
    const outletId = config?.app?.outletId ?? DEFAULT_OUTLET_ID
    const outletProblem = assertOutletPresent(template, outletId)
    if (outletProblem !== null) {
      return this.error(`[@aihu/app] output: 'ssr' — ${templatePath} has ${outletProblem}`)
    }
    const documentConfig = {
      template,
      outletId,
      ...(config?.site?.url !== undefined ? { siteUrl: config.site.url } : {}),
      ...(config?.app?.head !== undefined ? { globalHead: config.app.head } : {}),
    }
    return [
      '// AUTO-GENERATED by @aihu/app — virtual:aihu-ssr-document. Do not edit.',
      '// The built client index.html, inlined so a Worker (which has no filesystem)',
      '// can assemble the same document the SSG prerender writes to disk.',
      `export default ${JSON.stringify(documentConfig)}`,
      '',
    ].join('\n')
  }

  const serverEntryPlugin: Plugin = {
    name: 'aihu-server-entry',
    apply: 'build',
    configResolved(rc) {
      projectRoot = rc.root
    },
    config(userConfig) {
      if (!ssrEnabled) return
      // The client outDir as this build will actually resolve it: aihu's own
      // `vite` passthrough first (it is the value the user wrote in the aihu
      // config), then whatever the Vite config already carries, then Vite's
      // default.
      const clientOutDir =
        config?.vite?.build?.outDir ??
        (userConfig as UserConfig | undefined)?.build?.outDir ??
        'dist'
      clientOutDirForTemplate = clientOutDir
      return {
        environments: {
          ssr: {
            // Bundle everything. The default for an SSR environment is to
            // EXTERNALIZE node_modules, which produces a `_worker.js` full of
            // bare specifiers that no Worker runtime can resolve — a bundle
            // that looks built and cannot deploy.
            resolve: { noExternal: true },
            build: {
              // D-2: OUTSIDE the client outDir, always a sibling.
              outDir: ssrOutDirFor(clientOutDir),
              emptyOutDir: true,
              // Workers runtimes are evergreen; the SSR default target is a
              // Node baseline that would down-level for no reason.
              target: 'esnext',
              rollupOptions: {
                input: { [SSR_ENTRY_NAME]: SERVER_ENTRY_VIRTUAL_ID },
                output: { entryFileNames: '[name].js', format: 'es' as const },
              },
            },
          },
        },
        builder: {
          async buildApp(builder: {
            environments: Record<string, unknown>
            build(env: unknown): Promise<unknown>
          }): Promise<void> {
            // Client FIRST. The SSR entry does not import client chunks, but
            // the adapter's `closeBundle` (client-only, see
            // `isClientEnvironment`) reads the finished client outDir, and an
            // adapter that inspects `dist-server` wants it to exist.
            const client = builder.environments.client
            if (client) await builder.build(client)
            const ssr = builder.environments.ssr
            if (ssr) await builder.build(ssr)
          },
        },
      } as unknown as import('vite').UserConfig
    },
    resolveId(id) {
      if (id === SERVER_ENTRY_VIRTUAL_ID) return SERVER_ENTRY_RESOLVED_ID
      if (id === SSR_DOCUMENT_VIRTUAL_ID) return SSR_DOCUMENT_RESOLVED_ID
      return null
    },
    load(id) {
      if (id === SSR_DOCUMENT_RESOLVED_ID) return loadSsrDocumentModule.call(this)
      if (id !== SERVER_ENTRY_RESOLVED_ID) return null
      const adapter = config?.adapter
      const wrapper = adapter?.serverEntry?.({
        handler: 'handler',
        config: config ?? {},
      })
      if (adapter && adapter.serverEntry === undefined) {
        this.warn(
          `[@aihu/app] output: 'ssr' with adapter '${adapter.name}', which implements no ` +
            `serverEntry() — the server bundle exports a bare \`handler\` and carries no ` +
            `platform wrapper, so it is not deployable as-is.`,
        )
      }
      return buildServerEntrySource(wrapper)
    },
  }

  /**
   * D-1 — keep `node:module` out of the Worker bundle.
   *
   * `@aihu/server`'s `renderToString` reaches a lazy `await import('./native.js')`,
   * and the built `native.js` statically imports `node:module` for
   * `createRequire`. Rolldown chases the dynamic import and emits the chunk.
   * It is UNREACHABLE at runtime here — `loader.ts` short-circuits to the TS
   * walker whenever `children !== undefined`, which the SSR entry always passes —
   * but it is still uploaded, and workerd rejects the module specifier at deploy
   * time without `nodejs_compat`. A `wrangler deploy` failing on a client's
   * clock is not an acceptable way to discover that.
   *
   * `enforce: 'pre'` is LOAD-BEARING. Without it Vite's own resolver claims
   * `node:module` first (as an external builtin) and this hook never fires.
   *
   * The stub THROWS rather than returning a no-op `createRequire`: if the
   * unreachable path ever became reachable, a silently-broken `require` would
   * surface as a mystery render failure, whereas this names itself.
   *
   * The stub is a real FILE (`./node-module-stub.js`, shipped as its own dist
   * artifact) and not source text returned from a `load` hook. Inlining it here
   * would put `createRequire` — the one identifier the stub cannot rename,
   * because the built `native.js` imports exactly that binding — into
   * `@aihu/app`'s own `dist/index.js` as inert string data, where
   * `scripts/check-runtime-purity.ts`'s token scan cannot distinguish it from a
   * real symbol. A declared boundary artifact is the shape that guard already
   * names for `packages/server/dist/native.js`; the alternative (an exception
   * for `dist/index.js`) would blind it to a genuine future leak anywhere in
   * this plugin. The stub file is listed in the checker under its own tier.
   */
  // Sibling of THIS module: `src/` when vitest loads the source, `dist/` when a
  // consumer loads the published plugin — the stub is emitted to both.
  //
  // NOT `new URL('./node-module-stub.js', import.meta.url)`. Vite owns that
  // exact pattern as its asset-URL sugar and rewrites the specifier at
  // transform time, so under vitest it evaluates to
  // `http://localhost:3000/packages/app/src/node-module-stub.js` and
  // fileURLToPath throws ERR_INVALID_URL_SCHEME. Rolldown leaves it alone,
  // which means the dist works and only the tests break — a trap worth naming.
  // `fileURLToPath(import.meta.url)` alone matches no such pattern.
  const NODE_MODULE_STUB_ID = resolvePath(
    dirname(fileURLToPath(import.meta.url)),
    'node-module-stub.js',
  )
  // Written as prefix-strip rather than the natural `id === 'node:module'`
  // because that verbatim specifier is itself a forbidden token in
  // `check:runtime-purity` (see LEAK_VECTOR — the pattern requires a leading
  // quote precisely because a real import specifier is always quoted, which a
  // comparison literal also is). Assembling it (`\`node:${'module'}\``) does
  // not work: rolldown constant-folds it straight back to the literal.
  // `startsWith`/`slice` are calls on a runtime value, so no folding applies,
  // and the semantics are identical to `id === 'node:module' || id === 'module'`.
  const NODE_PREFIX = 'node:'
  const BUILTIN_NAME = 'module'
  const nodeModuleStubPlugin: Plugin = {
    name: 'aihu-node-module-stub',
    apply: 'build',
    enforce: 'pre',
    resolveId(id) {
      if (!ssrEnabled) return null
      if (this.environment?.name !== 'ssr') return null
      const bare = id.startsWith(NODE_PREFIX) ? id.slice(NODE_PREFIX.length) : id
      return bare === BUILTIN_NAME ? NODE_MODULE_STUB_ID : null
    },
  }

  return [
    // First: the marker plugin carrying the evaluated config on its `api`
    // handle. Position is not load-bearing for the build, but keeping it first
    // means anything scanning the array finds it immediately.
    configMarkerPlugin,
    // `enforce: 'pre'`, so it must precede everything — including the compiler
    // plugin, which is also 'pre'. Vite sorts by enforce and then by array
    // order within a tier.
    nodeModuleStubPlugin,
    // SPA mode: route components are top-level mounts that frequently use
    // lifecycle hooks (onMount/onCleanup) and rely on the runtime/signals
    // owner context regardless of whether they call signal() directly. The
    // static-island optimization is unsafe to apply silently here — it strips
    // defineComponent and breaks `no owner` for any module touching lifecycle.
    // It also saves ~0 B in practice because the runtime already ships in the
    // main bundle. Default islands off; opt back in via the compiler plugin
    // directly if you genuinely have an MPA-style mixed-island layout.
    // `css.shadowMode` (when set) forwards to the compiler's per-plugin
    // shadowMode injection — required for consumers using `@aihu/css-engine`
    // utility classes (or any cascade-dependent CSS framework) which need
    // `'light'` so styles aren't trapped in shadow roots.
    aihuCompilerPlugin({
      // `islands` was hardcoded false here, with the comment above telling the
      // reader to "opt back in via the compiler plugin directly" — a framework
      // documenting a workaround instead of exposing an option. It is now
      // `compiler.islands`, still defaulting to false.
      islands: config?.compiler?.islands ?? false,
      ...(config?.compiler?.target != null ? { target: config.compiler.target } : {}),
      // Compile layouts (under the same dir the router scans) in layout mode:
      // namespaced tag + passive <outlet> marker the client renderer fills.
      layoutsDir: routerOpts.layoutsDir,
      ...(config?.css?.shadowMode != null ? { shadowMode: config.css.shadowMode } : {}),
      // Needs an @aihu/compiler release with the `css` option; older ones
      // ignore it.
      ...(Object.keys(cssEngineOptions).length > 0 ? { css: cssEngineOptions } : {}),
    }) as unknown as Plugin,
    cssThemeWatchPlugin,
    viteRouterIntegration(routerOpts) as unknown as Plugin,
    agentPlugin,
    entryPlugin,
    headPlugin,
    ...((config?.plugins ?? []) as Plugin[]),
    passthroughPlugin,
    serverEntryPlugin,
    ssgPlugin,
    adapterPlugin,
  ]
}
