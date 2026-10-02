export type { AgentReadinessConfig } from './agent-readiness-config.ts'

// Type-only import so @aihu/server picks up no runtime dependency on
// @aihu/plugin (which is build/dev-time only). The `plugins` field below
// admits `Plugin[]` purely for type checking; v0.2.1 ships no dispatcher —
// the compiler wires registration in v0.3+.
import type { Plugin } from '@aihu/plugin'

// ---------------------------------------------------------------------------
// v0.6.5: Build target configuration
// ---------------------------------------------------------------------------

/**
 * Build target for the aihu application.
 * - 'client'    — browser-only bundle (no SSR)
 * - 'server'    — server-only bundle (SSR, no client hydration)
 * - 'universal' — both client and server bundles (default)
 */
export type BuildTarget = 'client' | 'server' | 'universal'

export interface BuildConfig {
  /** Build target. Default: 'universal' */
  target?: BuildTarget
}

// ---------------------------------------------------------------------------
// Rendering mode
// ---------------------------------------------------------------------------

/**
 * Runtime rendering strategy for the application.
 *
 * - 'ssr'     — every page request renders HTML on the server and ships
 *               hydration markers to the client. Required for streaming,
 *               agentic access, SEO, and the fastest LCP. This is the
 *               aihu default because it enables the full agent-ready surface.
 *
 * - 'spa'     — the server returns a bare HTML shell; all rendering happens
 *               in the browser. No server compute per page request. Suitable
 *               for: auth-gated dashboards, internal tools, apps deployed to
 *               fully-static hosts (S3, GitHub Pages, Cloudflare Pages in
 *               direct-upload mode). Limitations: no streaming, no agent
 *               content access without JS execution, weaker SEO.
 *
 * - 'hybrid'  — some routes are SSR'd (dynamic server rendering + hydration),
 *               others are pre-rendered to static HTML at build time, and the
 *               remainder fall back to a SPA shell. Use when you need static
 *               marketing pages (fast, cacheable) alongside dynamic user-specific
 *               routes (SSR) and app sections (SPA). The per-route mode is
 *               controlled via route-level options; this field sets the fallback.
 */
export type RenderingMode = 'ssr' | 'spa' | 'hybrid'

export interface RenderingConfig {
  /**
   * Default rendering mode for all routes.
   * Default: 'ssr' — server-renders every page with hydration markers enabled.
   */
  readonly mode?: RenderingMode
  /**
   * Emit `data-aihu-path` hydration markers on SSR output by default.
   * Only applies when mode is 'ssr' or 'hybrid'.
   * Default: true — enabling client-side takeover after first paint.
   */
  readonly hydratable?: boolean
}

export interface CorsConfig {
  readonly origin: string | ReadonlyArray<string> | '*'
  readonly methods?: ReadonlyArray<import('./types.ts').HttpMethod>
  readonly headers?: ReadonlyArray<string>
  readonly credentials?: boolean
  readonly maxAge?: number
}

export interface ServerConfig {
  readonly basePath?: string
  readonly cors?: CorsConfig
  /** Default: 1_048_576 (1 MB). */
  readonly maxBodySize?: number
}

export interface RouteConfig {
  /** Default: `./routes.gen.ts`. */
  readonly manifestPath?: string
}

// ---------------------------------------------------------------------------
// v1: @aihu/ui styled-recipe registry (`aihu add`)
// ---------------------------------------------------------------------------

/**
 * Configuration for the `@aihu/ui` styled-recipe registry, consumed by the
 * `aihu add` / `aihu list` CLI subcommands and the css-engine scanner.
 *
 * Defaults are NOT applied here — the CLI resolves them at read-time because
 * `ui` may be omitted from the config entirely (spec §6.6).
 */
export interface UiConfig {
  /** Source registry to pull recipes from. v1: the '@aihu/ui' package specifier. Default: '@aihu/ui'. */
  readonly registry?: string
  /** Directory `aihu add` copies recipe sources into. Default: './src/components/ui'. */
  readonly target?: string
  /** Active style pack name. Default: 'aihu-default'. */
  readonly style?: string
  /** Custom-element tag prefix for copied recipes. Default: 'aihu'. */
  readonly prefix?: string
  /** RESERVED for v2 multi-registry support — schema slot only, unimplemented. */
  readonly registries?: Readonly<Record<string, string>>
}

/**
 * @deprecated Use `@aihu/app`'s `AihuConfig` for new application configuration.
 * This exported shape remains available for compatibility with existing
 * `@aihu/server` consumers and will only be removed in a future major release.
 */
export interface AihuConfig {
  readonly server?: ServerConfig
  readonly agent?: import('./agent-readiness-config.ts').AgentReadinessConfig
  readonly routes?: RouteConfig
  /**
   * Plugins registered in this aihu project.
   *
   * Per Plugin Contract Spec §7.1-§7.2: plugins MUST be explicitly imported
   * and registered here. Auto-discovery is forbidden.
   *
   * v0.2.1: type contract + registration plumbing only. The compiler
   * dispatcher is a no-op until v0.3+ wires block parsers, macro lowerings,
   * and hook execution. Admitting the field now lets plugin authors begin
   * shaping `definePlugin({...})` calls against a stable type surface.
   */
  readonly plugins?: ReadonlyArray<Plugin>
  /**
   * v0.6.5: Build target configuration.
   * Controls whether aihu emits a client bundle, server bundle, or both.
   * This field is read by the compiler/build tooling; it has no runtime effect.
   */
  readonly build?: BuildConfig
  /**
   * Runtime rendering strategy. Defaults to SSR with hydration enabled —
   * the agent-ready posture that gives LLMs, crawlers, and the aihu MCP
   * server access to content without JavaScript execution.
   */
  readonly rendering?: RenderingConfig
  /**
   * v1: `@aihu/ui` styled-recipe registry configuration.
   * BUILD-TIME ONLY — consumed by the `aihu add` CLI and the css-engine
   * scanner; it has no runtime/edge effect (matching the `build`/`plugins`
   * field posture). Defaults are resolved by the CLI at read-time, so omitting
   * `ui` entirely is valid.
   */
  readonly ui?: UiConfig
}

const RENDERING_DEFAULTS: Required<RenderingConfig> = { mode: 'ssr', hydratable: true }

/**
 * @deprecated Use `defineConfig` from `@aihu/app` for new application
 * configuration. This function remains available for existing consumers.
 *
 * Define the aihu application configuration.
 *
 * Applies opinionated defaults before returning so callers always receive
 * a fully-resolved config object:
 *   - `rendering.mode`       defaults to `'ssr'`
 *   - `rendering.hydratable` defaults to `true`
 *
 * Both can be overridden per-field; omitting `rendering` entirely still
 * yields the SSR-with-hydration posture.
 *
 * IMPORTANT: BUILD-TIME ONLY. Not bundled into or available at edge
 * execution time. For runtime-dynamic configuration, call individual
 * generator functions directly in route handlers.
 *
 * @example
 * // aihu.config.ts — SSR default (no rendering field needed)
 * export default defineAihuConfig({
 *   server: { cors: { origin: '*' } },
 *   agent: { name: 'My App', version: '1.0.0', endpoint: 'https://myapp.workers.dev/mcp' },
 * })
 *
 * @example
 * // aihu.config.ts — opt into SPA mode
 * export default defineAihuConfig({ rendering: { mode: 'spa' } })
 *
 * @example
 * // aihu.config.ts — hybrid: SSR default, hydratable markers on
 * export default defineAihuConfig({ rendering: { mode: 'hybrid', hydratable: true } })
 */
export function defineAihuConfig(config: AihuConfig): AihuConfig {
  return {
    ...config,
    rendering: { ...RENDERING_DEFAULTS, ...config.rendering },
  }
}
