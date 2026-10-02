import type { AgentMetadata } from '@aihu/agent'
import { getAllAgentMetadata } from '@aihu/agent'
import type { RouteHandler } from '@aihu/server'
import { json, notFound } from '@aihu/server'
import { generateA2aCard } from './a2a-card.ts'
import { readAgentManifestDir } from './agent-manifest-sidecar.ts'
import { generateLlmsFullTxt, generateLlmsTxt } from './llms-txt.ts'
import { generateMcpDiscovery } from './mcp-discovery.ts'
import { generateMcpServerCard } from './mcp-server-card.ts'
import { generateRobotsTxt } from './robots.ts'
import { generateSitemapXml } from './sitemap.ts'
import type { AgentReadinessConfig } from './types.ts'

/**
 * Minimal Vite Plugin interface — avoids importing from 'vite' at compile time
 * while remaining structurally compatible. `vite` is external in rolldown.config.ts.
 * @internal
 */
/** A2A canonical discovery path (spec v0.3.0+). */
const A2A_CANONICAL_PATH = '/.well-known/agent-card.json'
/** A2A legacy discovery path — deprecated in v0.3.0, kept as an alias. */
const A2A_LEGACY_PATH = '/.well-known/agent.json'

interface VitePlugin {
  readonly name: string
  configureServer?: (server: {
    middlewares: {
      use: (fn: (req: any, res: any, next: () => void) => void) => void
    }
  }) => void
  generateBundle?: (options: any, bundle: any) => Promise<void>
  transformIndexHtml?: (html: string) => string
}

/**
 * Create fetch-API route handlers for all agent-readiness endpoints.
 * Each handler generates fresh content on every request (pure functions, negligible cost).
 *
 * @example
 * const ar = createAgentReadinessRoutes({ name: 'My App', endpoint: '...' })
 * const router = createRequestRouter({
 *   routes: [
 *     defineRoute('/llms.txt', ar.llmsTxt),
 *     defineRoute('/llms-full.txt', ar.llmsFullTxt),
 *     defineRoute('/.well-known/mcp/server-card.json', ar.mcpServerCard),
 *     defineRoute('/robots.txt', ar.robotsTxt),
 *     ...appRoutes,
 *   ],
 * })
 */
/**
 * Injectable sources for the generators, alongside the declarative config.
 *
 * These are NOT part of `AgentReadinessConfig` (which is single-sourced in
 * `@aihu/server`): they are wiring, not app configuration.
 */
export interface AgentReadinessSources {
  /**
   * Component-metadata reader, mirroring `RouteMarkdownResolverOptions`'
   * seam of the same name. Defaults to `getAllAgentMetadata` — the live
   * registry.
   *
   * FEL-434b: the registry is EMPTY on a client-target build, because the
   * compiler elides `registerAgentMetadata` from client JS. Point this at
   * `readAgentManifestDir(<compiler out dir>)` to build the `## Components`
   * section from the on-disk agent-meta sidecars instead.
   */
  readonly readComponents?: () => ReadonlyArray<AgentMetadata>
}

/** `AgentReadinessSources` plus the build-time-only sidecar directory. */
export interface ViteAgentReadinessSources extends AgentReadinessSources {
  /**
   * Directory the compiler wrote its `<tag>.agent-manifest.json` sidecars to
   * (the `--out` dir). When set, the `## Components` section and the MCP
   * server card's skills are derived from those files instead of the live
   * registry — the fix for a client-target build listing nothing (FEL-434b).
   * Overrides `readComponents`. A missing directory reads as zero components.
   */
  readonly agentManifestDir?: string
}

function validateAgentMap(agentMap: string | undefined): void {
  if (agentMap === undefined) return
  if (/[\r\n]/.test(agentMap)) {
    throw new TypeError('agent.agentMap must not contain CR or LF characters')
  }

  let url: URL
  try {
    if (!/^https?:\/\//i.test(agentMap)) throw new TypeError()
    url = new URL(agentMap)
  } catch {
    throw new TypeError('agent.agentMap must be an absolute HTTP(S) URL')
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) {
    throw new TypeError('agent.agentMap must be an absolute HTTP(S) URL')
  }
}

export function createAgentReadinessRoutes(
  config: AgentReadinessConfig,
  sources: AgentReadinessSources = {},
): {
  readonly llmsTxt: RouteHandler
  readonly llmsFullTxt: RouteHandler
  readonly mcpServerCard: RouteHandler
  readonly robotsTxt: RouteHandler
  readonly a2aCard: RouteHandler
  readonly mcpDiscovery: RouteHandler
  readonly sitemapXml: RouteHandler
} {
  validateAgentMap(config.agentMap)

  // GX Phase 3 (#437-GX): the compiled route table + site URL, threaded into
  // the llms.txt generators so route listings and component sections derive
  // from the declared `extract` policy (spec §8) — no hand-maintained lists.
  const llmsDerivationInputs = {
    ...(config.routes !== undefined ? { routes: config.routes } : {}),
    ...(config.siteUrl !== undefined ? { baseUrl: config.siteUrl } : {}),
  }

  const readComponents = sources.readComponents ?? getAllAgentMetadata

  const llmsTxt: RouteHandler = (_req) => {
    // Snapshot the component source at request/build time, consistent with
    // how the rest of the config is read. Zero components → omitted section.
    const components = readComponents()
    const txt = generateLlmsTxt({
      name: config.name,
      sections: config.llmsSections ?? [],
      components,
      ...llmsDerivationInputs,
      ...(config.summary !== undefined ? { summary: config.summary } : {}),
      ...(config.llmsOptional !== undefined ? { optional: config.llmsOptional } : {}),
      ...(config.llmsIntro !== undefined ? { intro: config.llmsIntro } : {}),
    })
    return new Response(txt, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  const llmsFullTxt: RouteHandler = (_req) => {
    const components = readComponents()
    const txt = generateLlmsFullTxt({
      name: config.name,
      sections: config.llmsSections ?? [],
      components,
      ...llmsDerivationInputs,
      ...(config.summary !== undefined ? { summary: config.summary } : {}),
      ...(config.llmsOptional !== undefined ? { optional: config.llmsOptional } : {}),
      ...(config.llmsIntro !== undefined ? { intro: config.llmsIntro } : {}),
    })
    return new Response(txt, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  const mcpServerCard: RouteHandler = (_req) => {
    if (!config.endpoint) return notFound()
    const card = generateMcpServerCard({
      name: config.name,
      version: config.version ?? '0.0.0',
      endpoint: config.endpoint,
      ...(sources.readComponents !== undefined ? { components: sources.readComponents() } : {}),
      ...(config.skills !== undefined ? { skills: config.skills } : {}),
      ...(config.auth !== undefined ? { auth: config.auth } : {}),
      ...(config.summary !== undefined ? { description: config.summary } : {}),
    })
    return json(card)
  }

  const robotsTxt: RouteHandler = (_req) => {
    const txt = generateRobotsTxt({
      ...(config.aiAgents !== undefined ? { aiAgents: config.aiAgents } : {}),
      ...(config.standardBots !== undefined ? { standard: config.standardBots } : {}),
      // GX Phase 3: per-route directives derived from compiled `extract.read`.
      ...(config.routes !== undefined ? { routes: config.routes } : {}),
      ...(config.sitemap !== undefined ? { sitemap: config.sitemap } : {}),
      ...(config.agentMap !== undefined ? { agentMap: config.agentMap } : {}),
      ...(config.wildcard !== undefined ? { wildcard: config.wildcard } : {}),
    })
    return new Response(txt, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  const a2aCard: RouteHandler = (req) => {
    if (!config.a2aCard) return notFound()
    if (!config.siteUrl) return notFound()
    const a2aConfig = config.a2aCard === true ? {} : config.a2aCard
    const card = generateA2aCard({
      name: config.name,
      url: config.siteUrl,
      ...(config.summary !== undefined ? { description: config.summary } : {}),
      ...(config.version !== undefined ? { version: config.version } : {}),
      ...(a2aConfig.capabilities !== undefined ? { capabilities: a2aConfig.capabilities } : {}),
      ...(a2aConfig.skills !== undefined ? { skills: a2aConfig.skills } : {}),
    })
    // A2A v0.3.0 renamed the discovery path to /.well-known/agent-card.json.
    // The old /.well-known/agent.json is served as a deprecated alias: same
    // body, plus a `Deprecation` header (RFC 8594) and a `Link` to the
    // canonical path, so existing consumers keep working but are nudged over.
    const pathname = new URL(req.url).pathname
    if (pathname === A2A_LEGACY_PATH) {
      return new Response(JSON.stringify(card), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          Deprecation: 'true',
          Link: `<${A2A_CANONICAL_PATH}>; rel="successor-version"`,
        },
      })
    }
    return json(card)
  }

  const mcpDiscovery: RouteHandler = (_req) => {
    if (!config.mcpDiscovery) return notFound()
    const mcpUrl =
      config.endpoint ??
      (config.siteUrl ? `${config.siteUrl}/.well-known/mcp/server-card.json` : undefined)
    if (!mcpUrl) return notFound()
    const discovery = generateMcpDiscovery({
      name: config.name,
      url: mcpUrl,
      ...(config.summary !== undefined ? { description: config.summary } : {}),
    })
    return json(discovery)
  }

  const sitemapXml: RouteHandler = (_req) => {
    if (!config.sitemapPages) return notFound()
    const xml = generateSitemapXml({ pages: config.sitemapPages })
    return new Response(xml, {
      status: 200,
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    })
  }

  return { llmsTxt, llmsFullTxt, mcpServerCard, robotsTxt, a2aCard, mcpDiscovery, sitemapXml }
}

/**
 * The `viteAgentReadinessIntegration()` Vite plugin (v0.7.4 canonical name).
 *
 * configureServer (dev): serves /llms.txt, /llms-full.txt, /.well-known/mcp/server-card.json, /robots.txt,
 *   /.well-known/agent-card.json (+ /.well-known/agent.json deprecated alias), /.well-known/mcp.json, /sitemap.xml
 * generateBundle (build): writes those files as static assets to the output dir
 *
 * Route injection: does NOT inject into createRequestRouter automatically.
 * Use createAgentReadinessRoutes() for fetch-API integration.
 *
 * Previously named `agentReadiness`. That name is kept as a deprecated alias
 * until v1.0 to avoid a breaking change.
 */
export function viteAgentReadinessIntegration(
  config: AgentReadinessConfig,
  sources: ViteAgentReadinessSources = {},
): VitePlugin {
  // FEL-434b: when a manifest directory is given, the component listing comes
  // from the compiler's on-disk sidecars rather than the live registry — the
  // registry is empty on a client-target build, because the compiler elides
  // `registerAgentMetadata` from client JS. Loaded on first use (the sidecars
  // are written by the compile step that precedes this plugin) and cached, so
  // every file generated in one build sees the same snapshot.
  let routes = createAgentReadinessRoutes(config, sources)
  let loaded = sources.agentManifestDir === undefined
  const ensureRoutes = async (): Promise<typeof routes> => {
    if (loaded) return routes
    loaded = true
    const components = await readAgentManifestDir(sources.agentManifestDir as string)
    routes = createAgentReadinessRoutes(config, { readComponents: () => components })
    return routes
  }

  const serveResponse = async (path: string, handler: RouteHandler, res: any): Promise<boolean> => {
    const req = new Request(`http://localhost${path}`)
    const response = await handler(req, { params: {}, url: new URL(`http://localhost${path}`) })
    const body = await response.text()
    if (response.status === 404) return false
    // Forward all response headers (Content-Type plus e.g. the A2A alias's
    // Deprecation/Link headers), defaulting Content-Type when absent.
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })
    if (!headers['content-type']) headers['content-type'] = 'text/plain'
    res.writeHead(response.status, headers)
    res.end(body)
    return true
  }

  function buildJsonLdTags(): string {
    if (config.jsonLd === false) return ''
    if (Array.isArray(config.jsonLd)) {
      return config.jsonLd
        .map((obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`)
        .join('\n')
    }
    if (config.siteUrl) {
      const schema: Record<string, unknown> = {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: config.name,
        url: config.siteUrl,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Web',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      }
      if (config.summary !== undefined) schema.description = config.summary
      if (config.version !== undefined) schema.version = config.version
      return `<script type="application/ld+json">${JSON.stringify(schema)}</script>`
    }
    return ''
  }

  return {
    name: 'aihu-agent-readiness',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url as string | undefined) ?? '/'
        const routes = await ensureRoutes()
        const pathMap: Array<[string, RouteHandler]> = [
          ['/llms.txt', routes.llmsTxt],
          ['/llms-full.txt', routes.llmsFullTxt],
          ['/.well-known/mcp/server-card.json', routes.mcpServerCard],
          ['/robots.txt', routes.robotsTxt],
          [A2A_CANONICAL_PATH, routes.a2aCard],
          // Deprecated A2A alias — kept so existing consumers don't break.
          [A2A_LEGACY_PATH, routes.a2aCard],
          ['/.well-known/mcp.json', routes.mcpDiscovery],
          ['/sitemap.xml', routes.sitemapXml],
        ]
        for (const [path, handler] of pathMap) {
          if (url === path || url.startsWith(`${path}?`)) {
            const handled = await serveResponse(url, handler, res)
            if (handled) return
          }
        }
        next()
      })
    },
    async generateBundle(_options, _bundle) {
      const routes = await ensureRoutes()
      const files: Array<[string, RouteHandler]> = [
        ['llms.txt', routes.llmsTxt],
        ['llms-full.txt', routes.llmsFullTxt],
        ['.well-known/mcp/server-card.json', routes.mcpServerCard],
        ['robots.txt', routes.robotsTxt],
        ['.well-known/agent-card.json', routes.a2aCard],
        // Deprecated A2A alias — emitted alongside the canonical card.
        ['.well-known/agent.json', routes.a2aCard],
        ['.well-known/mcp.json', routes.mcpDiscovery],
        ['sitemap.xml', routes.sitemapXml],
      ]
      for (const [name, handler] of files) {
        const req = new Request(`http://localhost/${name}`)
        const response = await handler(req, {
          params: {},
          url: new URL(`http://localhost/${name}`),
        })
        if (response.status === 200) {
          const body = await response.text()
          ;(this as any).emitFile({ type: 'asset', fileName: name, source: body })
        }
      }
    },
    transformIndexHtml(html: string): string {
      const tags = buildJsonLdTags()
      if (!tags) return html
      return html.replace('</head>', `${tags}\n</head>`)
    },
  }
}

/** @deprecated Use `viteAgentReadinessIntegration` instead. Will be removed in v1.0. */
export const agentReadiness = viteAgentReadinessIntegration
