/**
 * robots.txt generation with a TIERED bot policy (#430, extended by GX Phase 2).
 *
 * Every known crawler user agent is classified by what it actually is:
 *
 *   - `searcher` — traditional search-index crawlers (Googlebot, Bingbot, …).
 *     Never listed in `AI_BOT_LIST` and never targeted by the AI policies;
 *     the tier exists so the GX `read:` axis can tell "search" apart from
 *     "AI fetch" and "training" (spec §2.1: the `'search'` value).
 *   - `user-fetcher` — agents that fetch on behalf of a user action or surface
 *     cited search results back to users (ChatGPT-User, OAI-SearchBot,
 *     DuckAssistBot, Applebot). Allowed under the `'allow-agents'` default.
 *   - `training-crawler` — autonomous crawlers that gather content for model
 *     training or bulk scraping (GPTBot, CCBot, Bytespider, …). Explicit
 *     opt-in: disallowed under the `'allow-agents'` default.
 *
 * ONE registry (`BOT_REGISTRY`) drives robots.txt generation, content
 * negotiation (`isAiCrawlerUserAgent`), and the GX principal gate's anonymous
 * UA classification (`classifyBotUserAgent` → `resolvePrincipal` in
 * `@aihu/agent-service`). A second bot list anywhere would be exactly the
 * hand-maintained sync seam `check:derived` exists to forbid.
 *
 * GX Phase 3 (#437-GX): robots.txt output is now DERIVED per route from the
 * compiled `extract.read` axis (spec §8). Pass the compiled route table as
 * `RobotsConfig.routes` and each route's declared `read:` value fans out into
 * per-path directives over the tiered registry — one declaration, no
 * hand-maintained path lists. See {@link deriveRouteDirectives} for the
 * per-value mapping. With no `routes` (or with every route at the recorded
 * default `read: 'agents'`) the output is byte-identical to #430's tiered
 * default.
 *
 * NOTE: robots.txt is ADVISORY (RFC 9309 compliance is voluntary) — the
 * compliance tier of the honest ceiling (spec §1.1): it binds exactly the
 * crawlers that identify themselves and honor it; a UA-spoofer is unaffected.
 * CDN-layer controls — e.g. Cloudflare's default AI-crawler blocking —
 * override whatever is emitted here. Hard enforcement of the verified `read`
 * values is Phase 4 (SSR withholding + the bundle/data boundary), NOT this
 * file. See apps/docs/src/content/docs/guides/agent-discovery.md §robots.txt.
 */

import { deriveReadPolicy, extractReadValue } from '@aihu/server'

/** Crawler tier — the classification the GX `read:` axis consumes. */
export type BotTier = 'searcher' | 'user-fetcher' | 'training-crawler'

/** One entry in the classified bot registry. */
export interface BotEntry {
  readonly agent: string
  readonly tier: BotTier
  /** Operator + what the agent actually is — the per-bot classification record. */
  readonly why: string
}

/**
 * The single source of truth for the 13 AI bots and their tiers.
 * `AI_BOT_LIST`, `AI_USER_FETCHER_BOTS`, and `AI_TRAINING_CRAWLER_BOTS` are
 * all DERIVED from this registry — there is no second list to keep in sync.
 * Order is preserved from the pre-#430 `AI_BOT_LIST` so `'allow-all'` /
 * `'deny-all'` output block order is unchanged for existing consumers.
 */
const AI_BOT_REGISTRY: ReadonlyArray<BotEntry> = [
  {
    agent: 'GPTBot',
    tier: 'training-crawler',
    why: 'OpenAI — autonomous crawler gathering content for model training.',
  },
  {
    agent: 'ClaudeBot',
    tier: 'training-crawler',
    why: 'Anthropic — autonomous crawler gathering content to train/improve models.',
  },
  {
    agent: 'PerplexityBot',
    tier: 'training-crawler',
    why:
      'Perplexity — autonomous index crawler. The user-delegated Perplexity agent ' +
      'is "Perplexity-User", which is not in this list.',
  },
  {
    agent: 'Googlebot-Extended',
    tier: 'training-crawler',
    why: 'Google — variant token of Google-Extended (AI/Gemini training control).',
  },
  {
    agent: 'CCBot',
    tier: 'training-crawler',
    why: 'Common Crawl — bulk corpus crawler; the corpus is widely used for LLM training.',
  },
  {
    agent: 'anthropic-ai',
    tier: 'training-crawler',
    why: 'Anthropic — legacy training-crawler token predating ClaudeBot.',
  },
  {
    agent: 'Google-Extended',
    tier: 'training-crawler',
    why: 'Google — control token governing use of content for Gemini/Vertex AI training.',
  },
  {
    agent: 'Bytespider',
    tier: 'training-crawler',
    why: 'ByteDance — aggressive scraper feeding LLM training.',
  },
  {
    agent: 'cohere-ai',
    tier: 'training-crawler',
    why: 'Cohere — training-data crawler token.',
  },
  {
    agent: 'OAI-SearchBot',
    tier: 'user-fetcher',
    why:
      'OpenAI — search-index crawler for ChatGPT search; surfaces cited links to ' +
      'users and is not used for training.',
  },
  {
    agent: 'ChatGPT-User',
    tier: 'user-fetcher',
    why: 'OpenAI — fetches a page when a ChatGPT user asks for it (user-delegated).',
  },
  {
    agent: 'DuckAssistBot',
    tier: 'user-fetcher',
    why:
      'DuckDuckGo — fetches sources to generate cited DuckAssist answers in ' +
      'response to user queries.',
  },
  {
    agent: 'Applebot',
    tier: 'user-fetcher',
    why:
      'Apple — search-index crawler powering Siri/Spotlight suggestions. AI-training ' +
      'use is separately controlled by the Applebot-Extended token (not in this list).',
  },
]

/**
 * Traditional search-index crawlers (GX Phase 2). These power the `searcher`
 * tier that the `read:` axis values `'search'`/`'none'` distinguish. They are
 * NOT AI bots: they never enter `AI_BOT_LIST`, are never targeted by the
 * `aiAgents` robots policies, and never trigger markdown content negotiation
 * — classification is their only job in this phase.
 */
const SEARCH_BOTS_LIST: ReadonlyArray<BotEntry> = [
  {
    agent: 'Googlebot',
    tier: 'searcher',
    why:
      'Google — the search-index crawler. AI-training use is separately ' +
      'controlled by the Google-Extended / Googlebot-Extended tokens (AI registry).',
  },
  {
    agent: 'Bingbot',
    tier: 'searcher',
    why: 'Microsoft — the Bing search-index crawler.',
  },
  {
    agent: 'DuckDuckBot',
    tier: 'searcher',
    why: 'DuckDuckGo — the search-index crawler (DuckAssistBot, the AI answerer, is separate).',
  },
  {
    agent: 'Baiduspider',
    tier: 'searcher',
    why: 'Baidu — the search-index crawler.',
  },
  {
    agent: 'YandexBot',
    tier: 'searcher',
    why: 'Yandex — the search-index crawler.',
  },
]

/**
 * The ONE unified bot registry: every classified crawler across all three
 * tiers. AI entries first (order preserved from #430), searchers appended —
 * so every AI-derived list below is byte-identical to its pre-unification
 * value. This is the registry `classifyBotUserAgent` matches against and the
 * one the GX principal gate consumes.
 */
export const BOT_REGISTRY: ReadonlyArray<BotEntry> = [...AI_BOT_REGISTRY, ...SEARCH_BOTS_LIST]

/** Traditional search-index crawler tokens (derived; `searcher` tier only). */
export const SEARCH_BOTS: ReadonlyArray<string> = SEARCH_BOTS_LIST.map((b) => b.agent)

const escapeForRegExp = (token: string): string => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Classification order: longest token first. Substring matching means a
 * `Googlebot-Extended` UA also contains `Googlebot`; matching the most
 * specific token first classifies it as the training-crawler it is, never as
 * plain search. Precomputed once at module load.
 */
const CLASSIFIER_ENTRIES: ReadonlyArray<{ pattern: RegExp; tier: BotTier }> = [...BOT_REGISTRY]
  .sort((a, b) => b.agent.length - a.agent.length)
  .map((b) => ({ pattern: new RegExp(escapeForRegExp(b.agent), 'i'), tier: b.tier }))

/**
 * Classify a User-Agent string against the unified bot registry.
 *
 * Returns the tier of the most specific matching token, or `null` for an
 * unrecognized UA (a human browser, an unlisted bot, or a spoofer — the
 * compliance-tier honesty budget: classification binds only the population
 * that identifies itself).
 *
 * Substring + case-insensitive, the same discipline as robots.txt matching
 * and `isAiCrawlerUserAgent`. Conservative in the over-application direction:
 * no registry token occurs in a mainstream browser UA (`Applebot` does not
 * match `AppleWebKit`).
 *
 * This is the classifier `resolvePrincipal` (`@aihu/agent-service`) uses for
 * anonymous principals, and the classification the `read:` axis will consume
 * in Phase 3.
 */
export function classifyBotUserAgent(userAgent: string): BotTier | null {
  if (!userAgent) return null
  for (const { pattern, tier } of CLASSIFIER_ENTRIES) {
    if (pattern.test(userAgent)) return tier
  }
  return null
}

/** All 13 known AI user agents (derived from the registry; order preserved). */
export const AI_BOT_LIST: ReadonlyArray<string> = AI_BOT_REGISTRY.map((b) => b.agent)

/** User-delegated fetchers / cited-search agents — allowed under `'allow-agents'`. */
export const AI_USER_FETCHER_BOTS: ReadonlyArray<string> = AI_BOT_REGISTRY.filter(
  (b) => b.tier === 'user-fetcher',
).map((b) => b.agent)

/** Training/scraping crawlers — explicit opt-in; disallowed under `'allow-agents'`. */
export const AI_TRAINING_CRAWLER_BOTS: ReadonlyArray<string> = AI_BOT_REGISTRY.filter(
  (b) => b.tier === 'training-crawler',
).map((b) => b.agent)

export interface RobotsRule {
  readonly userAgent: string | ReadonlyArray<string>
  readonly allow?: ReadonlyArray<string>
  readonly disallow?: ReadonlyArray<string>
  readonly crawlDelay?: number
}

/**
 * One compiled route's crawl policy — the `robots` projection of a
 * `RouteDefinition` (`@aihu/router`) or `.route.json` sidecar. Structurally
 * compatible with both, so the compiled route table is passed straight in:
 * there is no hand-maintained path list to keep in sync (thesis §Derived).
 */
export interface RouteReadPolicy {
  /** Route pattern, e.g. `/pricing` or `/reports/:id`. */
  readonly pattern: string
  /** The compiled `extract` object; only `read` is consulted here. */
  readonly extract?: { readonly read?: unknown } | undefined
}

/**
 * Robots path for a route pattern: the static prefix, with a trailing `/`
 * when the pattern has dynamic segments (`/reports/:id` → `/reports/`;
 * `/pricing` → `/pricing`; `/:anything` and `/*` → `/`). robots.txt matching
 * is prefix-based (RFC 9309 §2.2.2), so the static prefix is the most
 * precise honest expression of "this route's paths".
 */
function robotsPathForPattern(pattern: string): string {
  const segments = pattern.split('/').filter(Boolean)
  const staticPrefix: string[] = []
  let truncated = false
  for (const s of segments) {
    if (s.startsWith(':') || s === '*' || s.startsWith('[')) {
      truncated = true
      break
    }
    staticPrefix.push(s)
  }
  if (staticPrefix.length === 0) return '/'
  return `/${staticPrefix.join('/')}${truncated ? '/' : ''}`
}

/**
 * Per-tier directive lines derived from the declared routes. `wildcard`
 * carries the searcher/unknown-crawler refusals (search bots have no
 * dedicated groups — they follow `*`, RFC 9309 §2.2.1 — and the wildcard is
 * also the only place a compliant UNLISTED crawler can be told to stay out).
 */
interface DerivedRouteDirectives {
  readonly 'user-fetcher': ReadonlyArray<string>
  readonly 'training-crawler': ReadonlyArray<string>
  readonly wildcard: ReadonlyArray<string>
}

const NO_DERIVED: DerivedRouteDirectives = {
  'user-fetcher': [],
  'training-crawler': [],
  wildcard: [],
}

/**
 * What each tier gets for paths with no per-route directive, under the given
 * global policy. Searchers are never targeted by any AI policy (they follow
 * the wildcard `Allow: /`), so their baseline is always allow.
 *
 * A custom rules array is operator-authored with per-bot semantics this
 * function cannot model, so it takes the all-allow baseline: every declared
 * RESTRICTION is emitted explicitly (redundant lines are harmless under
 * RFC 9309), and no declared widening (`read: 'all'`) is ever emitted against
 * operator rules — derivation may narrow an operator's policy, never open it.
 * The named policies are the framework's own tiers, so both directions derive
 * precisely there.
 */
function tierBaselines(
  aiAgents: AiAgentsPolicy | ReadonlyArray<RobotsRule>,
): Record<BotTier, boolean> {
  if (aiAgents === 'deny-all') {
    return { searcher: true, 'user-fetcher': false, 'training-crawler': false }
  }
  if (aiAgents === 'allow-agents') {
    return { searcher: true, 'user-fetcher': true, 'training-crawler': false }
  }
  // 'allow-all' and custom rule arrays.
  return { searcher: true, 'user-fetcher': true, 'training-crawler': true }
}

/**
 * Derive per-path robots directives from each route's declared `read:` value
 * (GX Phase 3; spec §8). The per-value mapping over the registry tiers:
 *
 *   - `read: 'all'`     → searchers ✓, user-fetchers ✓, trainers ✓
 *   - `read: 'agents'`  → searchers ✓, user-fetchers ✓, trainers ✗ — the
 *     ratified default. Emits NO per-route lines: this is exactly the #430
 *     tiered global default, which already states it (`Allow`/`Disallow: /`
 *     per bot). The recorded default defers to the global `aiAgents` policy,
 *     which keeps undeclared apps byte-identical to #430 under every policy.
 *   - `read: 'search'`  → searchers ✓, user-fetchers ✗, trainers ✗
 *   - `read: 'none'`    → all declared crawlers ✗ (a `Disallow` under `*`
 *     covers searchers and unknown compliant crawlers; humans are unaffected
 *     — robots.txt binds crawlers only). Existence is not secret: the route
 *     is served to anonymous humans, so Disallow lines naming it are honest.
 *   - hard values (`'verified'` / `'human'` / `{ scope }`) and malformed
 *     values → the path is NOT ADVERTISED at all: no directive names it
 *     (spec §8 existence-advertising — a Disallow line would announce a
 *     governed path to anyone who reads robots.txt). Its noindex signal is
 *     carried by the served `X-Robots-Tag` header instead.
 *
 * A directive is emitted only where the declared access differs from the
 * tier's baseline under the active global policy, so output stays minimal
 * and byte-stable. Under the NAMED policies a declared non-default `read:`
 * is authoritative for its path in both directions (e.g. `read: 'all'`
 * punches a per-path `Allow` through `deny-all`'s per-bot `Disallow: /` —
 * RFC 9309 longest-match gives the per-path line precedence); under an
 * operator-authored rules ARRAY, derivation only ever narrows (see
 * {@link tierBaselines}).
 */
function deriveRouteDirectives(
  routes: ReadonlyArray<RouteReadPolicy>,
  aiAgents: AiAgentsPolicy | ReadonlyArray<RobotsRule>,
): DerivedRouteDirectives {
  if (routes.length === 0) return NO_DERIVED
  const baseline = tierBaselines(aiAgents)
  const fetcher: string[] = []
  const trainer: string[] = []
  const wildcard: string[] = []
  const seen = new Set<string>()
  for (const route of routes) {
    const d = deriveReadPolicy(extractReadValue(route.extract))
    // Hard/malformed: absent from robots entirely. Default ('agents'): the
    // global tiered policy already speaks for it (see docblock).
    if (!d.advertiseInRobots || d.value === 'agents') continue
    const path = robotsPathForPattern(route.pattern)
    const key = `${path} ${String(d.value)}`
    if (seen.has(key)) continue
    seen.add(key)
    if (d.crawl['user-fetcher'] !== baseline['user-fetcher']) {
      fetcher.push(`${d.crawl['user-fetcher'] ? 'Allow' : 'Disallow'}: ${path}`)
    }
    if (d.crawl['training-crawler'] !== baseline['training-crawler']) {
      trainer.push(`${d.crawl['training-crawler'] ? 'Allow' : 'Disallow'}: ${path}`)
    }
    if (!d.crawl.searcher) wildcard.push(`Disallow: ${path}`)
  }
  return { 'user-fetcher': fetcher, 'training-crawler': trainer, wildcard }
}

/** The three named AI-agent policies. Any other string throws at generation time. */
const AI_AGENTS_POLICIES = ['allow-agents', 'allow-all', 'deny-all'] as const
type AiAgentsPolicy = (typeof AI_AGENTS_POLICIES)[number]

export interface RobotsConfig {
  /**
   * AI-agent crawl policy. Default: `'allow-agents'` (tiered) — user-delegated
   * fetchers get `Allow: /`, training/scraping crawlers get `Disallow: /`.
   * `'allow-all'` and `'deny-all'` apply one directive to all 13 bots.
   * An array of rules gives per-bot control.
   */
  readonly aiAgents?: AiAgentsPolicy | ReadonlyArray<RobotsRule>
  readonly standard?: ReadonlyArray<RobotsRule>
  /**
   * GX Phase 3 (#437-GX): the compiled route table (structurally, `@aihu/router`
   * `RouteDefinition[]` — e.g. the `virtual:aihu-routes` module). Each route's
   * compiled `extract.read` declaration derives per-path directives over the
   * bot-registry tiers (see {@link deriveRouteDirectives} for the mapping).
   * Omitted, or with every route at the recorded default (`read: 'agents'`),
   * output is byte-identical to the #430 tiered default. COMPLIANCE-TIER:
   * advisory for compliant crawlers; the origin gate is the authority.
   */
  readonly routes?: ReadonlyArray<RouteReadPolicy>
  readonly sitemap?: string
  /**
   * Agentic Resource Discovery (ARD, agenticresourcediscovery.org, v0.9 draft)
   * `Agentmap:` directive — mirrors `Sitemap:` in both syntax and placement,
   * pointing at the `/.well-known/ai-catalog.json` document that lists this
   * site's agent-card / MCP-server-card resources. Emitted verbatim; this
   * package does not validate the URL or generate the catalog document.
   */
  readonly agentMap?: string
  /**
   * The trailing `User-agent: * / Allow: /` block is ALWAYS emitted for
   * predictable output — set `wildcard: false` to suppress it. It is also
   * skipped automatically when one of your own rules already targets `*`
   * (your rule IS the wildcard decision; emitting a second block would
   * contradict it).
   */
  readonly wildcard?: boolean
}

const renderRule = (rule: RobotsRule): string => {
  const agents = Array.isArray(rule.userAgent) ? rule.userAgent : [rule.userAgent]
  const lines: string[] = (agents as string[]).map((a) => `User-agent: ${a}`)
  if (rule.disallow) {
    for (const path of rule.disallow) lines.push(`Disallow: ${path}`)
  }
  if (rule.allow) {
    for (const path of rule.allow) lines.push(`Allow: ${path}`)
  }
  if (rule.crawlDelay !== undefined) lines.push(`Crawl-delay: ${rule.crawlDelay}`)
  return lines.join('\n')
}

/** Does any rule in the list target the `*` user agent? */
const targetsWildcard = (rules: ReadonlyArray<RobotsRule>): boolean =>
  rules.some((rule) =>
    (Array.isArray(rule.userAgent) ? rule.userAgent : [rule.userAgent]).includes('*'),
  )

export function generateRobotsTxt(config: RobotsConfig = {}): string {
  const blocks: string[] = []
  const { aiAgents = 'allow-agents' } = config

  // Value guard (#430): an unknown string must throw, not fall into the array
  // branch and iterate characters. 'disallow-all' / 'allow-verified' are
  // phantom values from older docs that were never implemented.
  if (
    typeof aiAgents === 'string' &&
    !(AI_AGENTS_POLICIES as ReadonlyArray<string>).includes(aiAgents)
  ) {
    throw new Error(
      `Unknown aiAgents value ${JSON.stringify(aiAgents)}. Valid values are ` +
        `'allow-agents' (default — user-delegated fetchers allowed, training/scraping ` +
        `crawlers disallowed), 'allow-all', 'deny-all', or an array of RobotsRule ` +
        `objects for per-bot control. (Note: 'disallow-all' and 'allow-verified' ` +
        `appeared in older docs but were never implemented — use 'deny-all' or rules.)`,
    )
  }

  if (config.standard?.length) {
    for (const rule of config.standard) {
      blocks.push(renderRule(rule))
    }
  }

  // GX Phase 3: per-path directives derived from each route's compiled
  // `extract.read` declaration. Empty (all-[]) when no routes are passed or
  // every route sits at the recorded default — the appends below are then
  // no-ops and output is byte-identical to #430.
  const derived = deriveRouteDirectives(config.routes ?? [], aiAgents)
  const tierLines = (tier: BotTier): string =>
    tier === 'searcher' || derived[tier].length === 0 ? '' : `\n${derived[tier].join('\n')}`

  if (aiAgents === 'allow-all') {
    for (const { agent, tier } of AI_BOT_REGISTRY) {
      blocks.push(`User-agent: ${agent}\nAllow: /${tierLines(tier)}`)
    }
  } else if (aiAgents === 'deny-all') {
    for (const { agent, tier } of AI_BOT_REGISTRY) {
      blocks.push(`User-agent: ${agent}\nDisallow: /${tierLines(tier)}`)
    }
  } else if (aiAgents === 'allow-agents') {
    // Tiered default: fetchers allowed, trainers explicit opt-in. Registry
    // order is preserved so the output is stable and reviewable.
    for (const { agent, tier } of AI_BOT_REGISTRY) {
      blocks.push(
        tier === 'user-fetcher'
          ? `User-agent: ${agent}\nAllow: /${tierLines(tier)}`
          : `User-agent: ${agent}\nDisallow: /${tierLines(tier)}`,
      )
    }
  } else {
    for (const rule of aiAgents) {
      blocks.push(renderRule(rule))
    }
    // Route-derived directives still apply under a custom rules array: append
    // them as dedicated per-bot groups (RFC 9309 §2.2.1 — groups sharing a
    // user agent are combined by the crawler), so operator rules stay
    // untouched and the declared route policy is still stated.
    for (const { agent, tier } of AI_BOT_REGISTRY) {
      const lines = tierLines(tier)
      if (lines !== '') blocks.push(`User-agent: ${agent}${lines}`)
    }
  }

  // Wildcard block (#430 decision 7): always emit `User-agent: * / Allow: /`
  // unless explicitly suppressed (wildcard: false) or a user rule already
  // targets `*`. Never emit a blanket wildcard Disallow — that blocks humans.
  // GX Phase 3: `read: 'none'` routes' Disallow lines ride this block — it is
  // the group searchers and unknown compliant crawlers actually follow. When
  // the operator owns the wildcard decision (suppressed or self-targeted),
  // the declared refusals still must not vanish: they are emitted as a
  // minimal derived `*` group (combined with the operator's per RFC 9309).
  const explicitWildcard =
    targetsWildcard(config.standard ?? []) ||
    (typeof aiAgents !== 'string' && targetsWildcard(aiAgents))
  const wildcardDerived = [...derived.wildcard]
  if (config.wildcard !== false && !explicitWildcard) {
    blocks.push(['User-agent: *', ...wildcardDerived, 'Allow: /'].join('\n'))
  } else if (wildcardDerived.length > 0) {
    blocks.push(['User-agent: *', ...wildcardDerived].join('\n'))
  }

  let output = blocks.join('\n\n')
  if (config.sitemap) output += `\n\nSitemap: ${config.sitemap}`
  if (config.agentMap) output += `\n\nAgentmap: ${config.agentMap}`
  return output.trimEnd()
}
