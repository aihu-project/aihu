import type { Plugin, UserConfig } from 'vite'
import type { AihuAdapter } from './adapter.ts'
import { AihuConfigError as AihuConfigErrorImpl } from './config-error.ts'
import * as v from './config-validate.ts'

/**
 * Build output mode.
 *
 * - `'spa'` (default): a single empty-shell `index.html` that boots the client
 *   SPA. No per-route HTML, no prerendered content.
 * - `'static'` (SSG): prerenders every static route to a content-ful
 *   `<pattern>/index.html` with a per-page `<head>`, then hydrates into the SPA
 *   on load (progressive enhancement). Ideal for content sites on static hosts
 *   (e.g. Cloudflare Pages) — crawlers and non-JS agents see real content.
 * - `'ssr'`: everything `'spa'` builds, PLUS a second Vite environment whose
 *   entry is `virtual:aihu-server-entry` — a request-time server bundle that
 *   imports `virtual:aihu-routes` and `virtual:aihu-server-components` from
 *   INSIDE the build graph, so route modules and child components are real
 *   chunks rather than placeholders. Targets a Worker-style runtime; the
 *   adapter contributes the platform wrapper via `AihuAdapter.serverEntry`.
 *
 * `@aihu/server`'s `RenderingMode` is a DIFFERENT axis and not a build knob —
 * its only consumer is the client's hydration path. `'ssr'` belongs here.
 */
export type OutputMode = 'spa' | 'static' | 'ssr'

/** Site-level configuration. */
export interface SiteConfig {
  /**
   * Absolute base URL of the deployed site (e.g. `https://example.com`).
   * Used by the `'static'` (SSG) output mode to resolve relative per-route
   * `canonical` / `og:*` / `twitter:*` URLs into absolute URLs (passed as
   * `siteUrl` to @aihu/server's `routeHeadToSsrHead`). When absent, relative
   * URLs are emitted unchanged.
   */
  readonly url?: string
}

export interface DirConfig {
  /** Directory to scan for page routes. Default: 'pages' */
  readonly pages?: string
  /** Directory to scan for layout files. Default: 'src/layouts' */
  readonly layouts?: string
  /** Public static assets directory. Default: 'public' */
  readonly public?: string
  /**
   * Directory to scan for components. Default: 'src/components'
   *
   * `@aihu/router`'s `componentsDir` has always existed but was unreachable
   * from here: `viteAihuPlugin` forwarded only `pagesDir` and `layoutsDir`, so
   * changing it meant calling `viteRouterIntegration()` yourself — i.e.
   * abandoning `viteAihuPlugin` entirely.
   */
  readonly components?: string
}

/**
 * Compiler options forwarded to `aihuCompilerPlugin`.
 *
 * These were previously reachable only by dropping `viteAihuPlugin` and wiring
 * `aihuCompilerPlugin()` by hand — `islands` in particular was hardcoded to
 * `false` with a comment instructing the reader to "opt back in via the
 * compiler plugin directly." A framework documenting a workaround is a missing
 * option.
 */
export interface CompilerConfig {
  /**
   * Build target for compiled SFC output.
   *
   * `'client'` elides server-only artifacts (the `@agent` binding, the agent
   * manifest). NOTE this is what makes a static build's `llms.txt` list no
   * tools — the compiler strips `registerAgentMetadata()` from client output.
   */
  readonly target?: 'client' | 'server' | 'universal'
  /**
   * Emit island boundaries for partial hydration. Default: `false`.
   */
  readonly islands?: boolean
}

/** Options for `aihu dev`. Consumed by the CLI, not by Vite. */
export interface DevConfig {
  readonly port?: number
  readonly host?: string
  readonly open?: boolean
}

/** Build options read by `aihu build` and `aihu dev`. */
export interface BuildConfig {
  /**
   * Bundler used by `aihu dev` / `aihu build`.
   *
   * Declared here because both commands ALREADY read it — each hand-rolls a
   * local structural interface to do so — while no config type declared it.
   * `aihu build --help` documented a key the schema said did not exist.
   */
  readonly bundler?: 'vite' | 'rolldown'
}

/** Options for `aihu-tsc` / `aihu check`. Consumed by the CLI, not by Vite. */
export interface TypecheckConfig {
  /** Fail on template expressions that do not typecheck. */
  readonly strictTemplates?: boolean
  /** tsconfig path. Default: 'tsconfig.json' */
  readonly project?: string
}

/** Runtime configuration split. Public values are safe to expose to the client. */
export interface RuntimeConfig {
  readonly public?: Record<string, unknown>
  /** V0: accepted but ignored at runtime (server-side enforcement deferred to V1). */
  readonly private?: Record<string, unknown>
}

export interface HeadConfig {
  readonly title?: string
  /** Default: 'UTF-8' */
  readonly charset?: string
  /** Default: 'width=device-width, initial-scale=1' */
  readonly viewport?: string
  readonly meta?: ReadonlyArray<Record<string, string>>
}

/**
 * The `app` section of the aihu config. Named for the `head` it originally
 * carried alone; kept under that name because it is exported.
 */
export interface AppHeadConfig {
  readonly head?: HeadConfig
  /**
   * Id of the outlet element in `index.html` — the element every render path
   * puts the page into. Default: `'outlet'`.
   *
   * Declared here because it is a fact about the DOCUMENT, and three separate
   * things need it: `createApp()` mounts into it, the SSG prerender splices
   * into it, and the `output: 'ssr'` Worker splices into it. Before this key
   * existed only the client could be told, via `createApp({ outletId })` in a
   * hand-written `src/main.ts` — and the two build-time paths hardcoded
   * `'outlet'`, so changing it silently emptied every prerendered page.
   *
   * `viteAihuPlugin` also threads this into the VIRTUAL client entry
   * (`createApp({ outletId })`), so a project with no `src/main.ts` needs to
   * state it exactly once. A project that ejected to its own `src/main.ts`
   * passes the same value to `createApp` itself — the virtual entry is not in
   * play there.
   */
  readonly outletId?: string
}

/** Vite config fields that can be safely merged (excludes plugins — use AihuConfig.plugins). */
export type VitePassthrough = Omit<UserConfig, 'plugins'>

/** A Aihu plugin is structurally identical to a Vite plugin (V0). */
export type AihuPlugin = Plugin

/** Type-only import — not bundled when agentReadiness is absent. */
export type AgentReadinessConfig = import('@aihu-plugin/agent-readiness').AgentReadinessConfig

/**
 * CSS / styling options forwarded to the compiler's Vite plugin.
 *
 * Today this surfaces the rendering mode the compiler injects into every
 * `defineElement(...)` call — a BINARY choice (DA4 #437): `'shadow'`
 * (shadow-encapsulated component styles; internally an OPEN root, the only
 * browser mode aihu's composition/hydration can use) or `'light'` (no shadow
 * root). Unset, pages/layouts default to `'light'` and leaves to `'shadow'`.
 * `@aihu/css-engine` is scoped by design and works in either mode — its
 * utilities fold into each component's shadow style. Global-cascade
 * frameworks (Tailwind, UnoCSS, Pico) — or styling light-DOM / external
 * (slotted) children — need `'light'`.
 *
 * When set, `viteAihuPlugin` forwards this to its internal
 * `aihuCompilerPlugin({ shadowMode })` call. When absent, behaviour is
 * unchanged (compiler default applies).
 */
export interface CssConfig {
  /**
   * Project-wide rendering mode for every `.aihu` SFC compiled by
   * `viteAihuPlugin`.
   *
   * - `'shadow'` — shadow DOM (an OPEN root internally; `this.shadowRoot`
   *               non-null).
   * - `'light'`  — **no shadow root** (`this.shadowRoot === null`). Use for
   *               global-cascade CSS frameworks, or when you explicitly want
   *               light-DOM / global CSS (e.g. to style external / slotted
   *               child elements). NOT required for `@aihu/css-engine`,
   *               which is scoped and works in either mode.
   */
  readonly shadowMode?: 'light' | 'shadow'

  /**
   * Project theme for `@aihu/css-engine`: the values its utilities and
   * recipes fall back to, in place of the built-in `aihu-default` palette.
   *
   * - A path (relative to the Vite root) to a CSS file with an
   *   `@theme { --color-primary: …; }` block. The dev server restarts when the
   *   file changes.
   * - A style pack from `defineStylePack()`; its base `tokens` are used.
   *
   * Values compile to `var(--name, <value>)` fallbacks, never `:host`
   * declarations, so tokens set at `:root` (e.g. an imported pack stylesheet)
   * still win inside components, and an SFC's own `@theme` overrides both.
   */
  readonly theme?: string | CssThemePack

  /**
   * `false` compiles token references to bare `var(--name)` with no fallback
   * value, trimming every component's CSS. Only for apps that always load
   * their tokens at `:root`: an unset token then renders as the property's
   * initial value. Tokens an SFC's own `@theme` sets are still declared.
   * Default `true`. Cannot be combined with `theme`, which only supplies
   * fallback values.
   */
  readonly hostTokens?: boolean
}

/**
 * The part of a `defineStylePack()` result `css.theme` reads. Structural, so
 * `@aihu/app` takes no dependency on `@aihu/css-engine`.
 */
export interface CssThemePack {
  /** Base (light) tokens; names with or without the `--` prefix. */
  readonly tokens: Readonly<Record<string, string>>
}

/** Router-related app config (arch-5 M1, RFC-A5-012). */
export interface RouterConfig {
  /**
   * When `true`, `<a>` navigation wraps in `document.startViewTransition()`
   * if the browser supports the View Transitions API. No-op in unsupported
   * browsers (graceful degradation). Default: `false`.
   *
   * SSR safety: the wrapping is browser-only — server-rendered HTML is
   * unchanged, and hydration is unaffected.
   */
  readonly viewTransitions?: boolean
}

export interface AihuConfig {
  /** Directory layout overrides. */
  readonly dir?: DirConfig
  /**
   * Output mode. Supports `'spa'` (default), `'static'` (SSG prerender) and
   * `'ssr'` (client bundle + a request-time server bundle).
   * defineConfig throws AihuConfigError for any other value.
   *
   * `'ssr'` additionally REQUIRES `css.shadowMode` — see
   * `requireShadowModeForSsr` below for why that is an error and not a
   * warning.
   */
  readonly output?: OutputMode
  /**
   * Site-level configuration. `site.url` is the absolute base URL used by the
   * `'static'` output mode to resolve relative canonical/OG/Twitter URLs.
   */
  readonly site?: SiteConfig
  /**
   * Aihu plugins. Order is preserved.
   * Appended after the three framework plugins (compiler, router, agent-readiness).
   */
  readonly plugins?: ReadonlyArray<AihuPlugin>
  /** Runtime configuration split — public values are inlined in the client bundle. */
  readonly runtimeConfig?: RuntimeConfig
  /**
   * App-level values made available to all components as bare identifiers.
   * Declared here for documentation and future build-time validation; the
   * values are hoisted into globalThis by createApp() at runtime.
   *
   * @example
   * export default defineConfig({ provide: { supabase, checkAuth } })
   */
  readonly provide?: Record<string, unknown>
  /** HTML <head> metadata. */
  readonly app?: AppHeadConfig
  /** Passthrough to Vite's UserConfig. Merged via Vite's config() hook. */
  readonly vite?: VitePassthrough
  /**
   * Opt-in agent-readiness integration.
   * Requires { name: string } at minimum.
   * When absent or false, a no-op plugin is substituted.
   */
  readonly agentReadiness?: AgentReadinessConfig | false
  /**
   * Deployment adapter. Transforms the Vite build output into the target
   * platform's required format. Called after vite build completes.
   * When absent, no post-build transformation is applied (manual deployment).
   */
  readonly adapter?: AihuAdapter
  /**
   * Router-related app config (arch-5 M1).
   *
   * WARNING: `router.viewTransitions` is declared but NOT wired — nothing
   * forwards it from here to the router runtime, so setting it has no effect.
   * `defineConfig` warns when you do. The working lever is the
   * `<router viewTransitions>` prop. Tracked for wiring or removal.
   */
  readonly router?: RouterConfig
  /** Compiler options forwarded to `aihuCompilerPlugin`. */
  readonly compiler?: CompilerConfig
  /** `aihu dev` options. Read by the CLI, not by Vite. */
  readonly dev?: DevConfig
  /** `aihu build` / `aihu dev` build options. Read by the CLI, not by Vite. */
  readonly build?: BuildConfig
  /** `aihu-tsc` options. Read by the CLI, not by Vite. */
  readonly typecheck?: TypecheckConfig
  /**
   * CSS / styling integration. Currently surfaces the project-wide
   * `shadowMode` forwarded to the compiler. Set to `{ shadowMode: 'light' }`
   * when using a cascade-dependent CSS framework (Tailwind, UnoCSS, Pico).
   */
  readonly css?: CssConfig
}

// `AihuConfigError` lives in its own module so the validation combinators can
// throw it without importing this file back. Re-exported here for compat.
export { AihuConfigError } from './config-error.ts'

/**
 * The config schema — the single source of truth for which keys aihu owns.
 *
 * `Object.keys(SCHEMA)` is therefore the authoritative key list; nothing can
 * drift from it. SvelteKit derives its `kit`-vs-`vite-plugin-svelte` key split
 * from exactly this, which is what will let us accept inline config on
 * `viteAihuPlugin()` later without a hand-maintained list.
 */
/**
 * `app.outletId` — the HTML4 `ID` production: a letter, then letters, digits,
 * hyphens, underscores, colons or periods.
 *
 * A bare `v.string` let three shapes through that are not ids at all, and each
 * failed SILENTLY at request time rather than at the config that declared them:
 *
 *   - `''` — matches no element; the SSR splice no-ops and the client's
 *     `getElementById('')` returns null.
 *   - `'a"b'` — closes the `id="…"` attribute the splice looks for and the
 *     template writes, so the two disagree about where the page goes.
 *   - `'my outlet'` — ASCII whitespace is illegal in an id per the HTML spec;
 *     the browser sees two attributes and the splice sees neither.
 *
 * HTML5 relaxed the production to "any non-empty string with no ASCII
 * whitespace", and this is deliberately the older, narrower rule. It is the set
 * that is safe in EVERY place this one value has to travel to unescaped — a
 * quoted attribute in the emitted template, a regex splice target
 * (`injectIntoOutletId`), `document.getElementById`, and a `#id` CSS selector —
 * and an id outside it is far likelier to be a mistake than an intention.
 * Widening later is additive; narrowing later would break configs.
 */
const OUTLET_ID = v.pattern(
  /^[A-Za-z][A-Za-z0-9_:.-]*$/,
  'an HTML id: a letter followed by letters, digits, hyphens, underscores, colons or periods',
)

/** `css.theme`: a CSS file path, or a style pack carrying a `tokens` map. */
const CSS_THEME: v.Validator = (value, keypath) => {
  if (value === undefined || typeof value === 'string') return
  const tokens = (value as { tokens?: unknown } | null)?.tokens
  if (typeof value === 'object' && tokens !== null && typeof tokens === 'object') return
  throw new AihuConfigErrorImpl(
    `${keypath} should be a path to a CSS file with an @theme block, ` +
      'or a style pack from defineStylePack(), if specified.',
    'INVALID_CSS_THEME',
    keypath,
  )
}

const SCHEMA: Record<string, v.Validator> = {
  dir: v.object({
    pages: v.string,
    layouts: v.string,
    public: v.string,
    components: v.string,
  }),
  output: v.list(['spa', 'static', 'ssr'], 'INVALID_OUTPUT_MODE'),
  site: v.object({ url: v.string }),
  plugins: v.array,
  runtimeConfig: v.object({ public: v.passthrough, private: v.passthrough }),
  provide: v.passthrough,
  app: v.object({
    head: v.object({
      title: v.string,
      charset: v.string,
      viewport: v.string,
      meta: v.array,
    }),
    outletId: OUTLET_ID,
  }),
  vite: v.passthrough,
  // `false` is a whole-block disable; otherwise the plugin owns the shape, so
  // we do not re-declare its ~20 fields here and risk drifting from them.
  agentReadiness: v.orFalse(v.passthrough),
  adapter: v.anything,
  router: v.object({
    // Declared, documented, and read by NOTHING: `viteAihuPlugin` forwards
    // only pagesDir/layoutsDir/compileRouteMeta to the router. Warn rather
    // than silently accept — a config file advertised as THE customization
    // surface must not contain fields that quietly do nothing.
    viewTransitions: v.notYetImplemented(v.boolean, 'use the <router viewTransitions> prop'),
  }),
  compiler: v.object({
    target: v.list(['client', 'server', 'universal'], 'INVALID_COMPILER_TARGET'),
    islands: v.boolean,
  }),
  dev: v.object({ port: v.number, host: v.string, open: v.boolean }),
  build: v.object({ bundler: v.list(['vite', 'rolldown'], 'INVALID_BUNDLER') }),
  typecheck: v.object({ strictTemplates: v.boolean, project: v.string }),
  css: v.object({
    shadowMode: v.list(['light', 'shadow'], 'INVALID_CSS_SHADOW_MODE'),
    theme: CSS_THEME,
    hostTokens: v.boolean,
  }),
  ui: v.object({
    registry: v.string,
    target: v.string,
    // Resolved into ResolvedUiConfig and then read by nothing. `aihu add
    // --style` documents it as "recorded; the engine reads it at build" — the
    // engine does not.
    style: v.notYetImplemented(v.string, 'no consumer reads ui.style yet'),
    prefix: v.string,
    registries: v.passthrough,
  }),
}

/** Keys aihu owns, derived from the schema rather than hand-listed. */
export const AIHU_CONFIG_KEYS: ReadonlyArray<string> = Object.freeze(Object.keys(SCHEMA))

/**
 * Map an unknown top-level key to a hint.
 *
 * Targets the mistakes people actually make rather than listing every legal
 * key. The `@aihu/server` entries matter most: there are two config dialects
 * with the same file name and the same interface name, and until they are
 * consolidated, a user who writes `rendering: {}` or `agent: {}` into an
 * `@aihu/app` config gets silence.
 */
function suggestTopLevel(key: string): string | undefined {
  const hints: Record<string, string> = {
    // @aihu/server's AihuConfig fields, which do NOT apply here.
    rendering: 'output',
    agent: 'agentReadiness',
    server: 'vite.server',
    // Common near-misses.
    integrations: 'plugins',
    pages: 'dir.pages',
    layouts: 'dir.layouts',
    components: 'dir.components',
    head: 'app.head',
    outletId: 'app.outletId',
    shadowMode: 'css.shadowMode',
    bundler: 'build.bundler',
    strictTemplates: 'typecheck.strictTemplates',
    base: 'vite.base',
    alias: 'vite.resolve.alias',
  }
  return hints[key]
}

const validateShape = v.object(SCHEMA, suggestTopLevel)

/**
 * `output: 'ssr'` REQUIRES `css.shadowMode`. A build error, not a warning.
 *
 * This is the one cross-field rule in the schema, and it earns the exception.
 * The server child registry (`@aihu/server`'s `buildChildRegistry`) refuses any
 * module whose `__aihu_shadow__` export is neither `'light'` nor `'shadow'` —
 * it has no safe default to guess, because light children under a host that
 * later calls `attachShadow` are discarded on upgrade and a declarative shadow
 * root on a light component is never adopted.
 *
 * And with NO `css.shadowMode` configured, a plain component exports no
 * `__aihu_shadow__` at all: `aihuCompilerPlugin` only injects it when
 * `effectiveShadow != null`, and the implicit DA4 `light` default marker is
 * emitted for `@route` units and layouts — not for leaf components. So an
 * unconfigured `output: 'ssr'` build ships a server bundle in which EVERY child
 * component reference renders as an empty element, with the only signal a
 * `buildChildRegistry` warning in a build log.
 *
 * Silently-empty children is precisely the failure this whole feature exists to
 * remove, and it is indistinguishable at the page from "the registry is
 * broken". `apps/docs` sets `shadowMode: 'light'`, which is the only reason the
 * SSG path never hit it. So the build refuses, naming the key.
 */
function requireShadowModeForSsr(config: AihuConfig, keypath: string): void {
  if (config.output !== 'ssr') return
  if (config.css?.shadowMode !== undefined) return
  throw new AihuConfigErrorImpl(
    `${keypath}.output is 'ssr' but ${keypath}.css.shadowMode is not set. ` +
      "Set css.shadowMode to 'light' or 'shadow'. Without it, leaf components " +
      'export no `__aihu_shadow__`, the server child registry refuses them, and every ' +
      'child component reference server-renders as an EMPTY element — visually identical ' +
      'to a broken registry. There is no safe default to guess: light children under a ' +
      'host that later calls attachShadow are discarded on upgrade, and a declarative ' +
      'shadow root on a light component is never adopted. ' +
      "(Use 'light' for global-cascade CSS frameworks; 'shadow' for encapsulated styles.)",
    'MISSING_SHADOW_MODE',
    `${keypath}.css.shadowMode`,
  )
}

/**
 * `css.theme` only supplies `var()` fallback values and `css.hostTokens: false`
 * removes every fallback, so together the theme would silently do nothing.
 */
function rejectThemeWithoutHostTokens(config: AihuConfig, keypath: string): void {
  if (config.css?.theme === undefined || config.css.hostTokens !== false) return
  throw new AihuConfigErrorImpl(
    `${keypath}.css.theme has no effect when ${keypath}.css.hostTokens is false: ` +
      'the theme only supplies var() fallback values, and hostTokens: false removes them. ' +
      'Drop one of the two, or load the theme at :root instead.',
    'CSS_THEME_UNUSED',
    `${keypath}.css.theme`,
  )
}

function validateConfig(config: AihuConfig, keypath: string): void {
  validateShape(config, keypath)
  requireShadowModeForSsr(config, keypath)
  rejectThemeWithoutHostTokens(config, keypath)
}

/**
 * Define the aihu application configuration.
 *
 * Validates at call time and throws `AihuConfigError` on an invalid value OR
 * an unknown key. Returns the config unchanged (typed identity function).
 *
 * Unknown keys THROW rather than warn. Next.js validates with a zod schema but
 * only warns, and it cost them visibly — people learn to ignore a banner. This
 * file is now scaffolded into every project and advertised as the place to
 * customize things, so a silently-dropped key would read as a broken feature.
 *
 * @example
 * // aihu.config.ts
 * import { defineConfig } from '@aihu/app'
 * export default defineConfig({
 *   app: { head: { title: 'My App' } },
 * })
 */
export function defineConfig(config: AihuConfig): AihuConfig {
  validateConfig(config, 'config')
  return config
}

/**
 * Validate a config object without the `defineConfig` ceremony.
 *
 * `viteAihuPlugin()` calls this on its inline argument. Before, only configs
 * routed through `defineConfig` were checked — so every example, which passes
 * the object straight to the plugin, was unvalidated. That is the path that
 * matters most now that the Vite config is the canonical home.
 */
export function validateAihuConfig(config: AihuConfig): void {
  validateConfig(config, 'config')
}
