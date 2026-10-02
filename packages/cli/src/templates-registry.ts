/**
 * @aihu/cli/templates-registry — the catalogue of templates the CLI can
 * scaffold, in two tiers:
 *
 *   1. BUILT-IN templates, embedded in @aihu/cli itself (`minimal`, `full`,
 *      `docs`, `agent`). No download; emitted by `scaffoldApp()`.
 *   2. NPM template packages (`@aihu/templates-*`), auto-installed on demand
 *      and driven through the 6-stage scaffold pipeline.
 *
 * Intentionally NOT registry-search at runtime: that adds 500-2000ms to the
 * first prompt and `create-next-app` doesn't do it either. Each `@aihu/cli`
 * minor publish stamps the supported template set.
 */

export const KNOWN_TEMPLATES = [
  '@aihu/templates-cf-team',
  '@aihu/templates-vercel-team',
  '@aihu/templates-fly-team',
  '@aihu/templates-cf-solo',
  '@aihu/templates-cf-full-agent',
] as const

export type KnownTemplate = (typeof KNOWN_TEMPLATES)[number]

/**
 * The subset of KNOWN_TEMPLATES that is actually published to npm and can be
 * installed today. The remaining entries in KNOWN_TEMPLATES are declared by
 * arch-6 §3.5 but 404 on the registry and have no source under
 * `packages/templates/`, so offering them as choices would send users into an
 * `npm ERR! 404` dead end. They stay in KNOWN_TEMPLATES (removing them is a
 * separate spec call) but are surfaced to users as unavailable, never as
 * selectable options.
 *
 * `cf-solo` (arch-6 §1.3's solo-dev escape hatch) has real source under
 * `packages/templates/cf-solo/` and the same in-repo scaffold-and-compile
 * test coverage `cf-team` has — see `packages/cli/tests/
 * scaffold-cf-solo-and-compile.test.ts`. It is NOT yet in `.github/workflows/
 * scaffold-matrix.yml`'s real npm/pnpm/yarn/bun-registry matrix; that is a
 * `.github/` edit a human needs to make as a follow-up (see arch-6 §10 Round
 * B2 — the remaining 3 templates stamp out the same way).
 */
export const AVAILABLE_TEMPLATE_PACKAGES = [
  '@aihu/templates-cf-team',
  '@aihu/templates-cf-solo',
] as const

/** Templates embedded in @aihu/cli — always available, never downloaded. */
export const BUILTIN_TEMPLATES = ['minimal', 'full', 'docs', 'agent', 'ssr'] as const
export type BuiltinTemplate = (typeof BUILTIN_TEMPLATES)[number]

const SHORT_PREFIX = '@aihu/templates-'

const BUILTIN_SUMMARIES: Record<BuiltinTemplate, string> = {
  minimal: 'signals + arbor, single SFC',
  full: 'signals, arbor, router, multi-page',
  docs: 'docs-site starter',
  agent: 'agent-drivable component over the capability bridge',
  ssr: 'server-rendered on Cloudflare Workers',
}

const PACKAGE_SUMMARIES: Record<KnownTemplate, string> = {
  '@aihu/templates-cf-team':
    'Cloudflare Workers + bun/moon monorepo, auth, Biome, Vitest, agent surface',
  '@aihu/templates-vercel-team': 'Vercel + monorepo team stack',
  '@aihu/templates-fly-team': 'Fly.io + monorepo team stack',
  '@aihu/templates-cf-solo': 'Cloudflare Workers, single-app solo stack',
  '@aihu/templates-cf-full-agent': 'Cloudflare Workers with the full agent surface',
}

export interface CatalogEntry {
  /** The value a user types after `--template`, e.g. `minimal` or `cf-team`. */
  readonly id: string
  readonly source: 'builtin' | 'npm'
  /** Full package name for `source: 'npm'` entries. */
  readonly pkg?: KnownTemplate
  readonly summary: string
  /** False for declared-but-unpublished packages — cannot be selected. */
  readonly available: boolean
}

/** Every template the CLI knows about, selectable or not. */
export const TEMPLATE_CATALOG: ReadonlyArray<CatalogEntry> = [
  ...BUILTIN_TEMPLATES.map(
    (id): CatalogEntry => ({
      id,
      source: 'builtin',
      summary: BUILTIN_SUMMARIES[id],
      available: true,
    }),
  ),
  ...KNOWN_TEMPLATES.map(
    (pkg): CatalogEntry => ({
      id: pkg.slice(SHORT_PREFIX.length),
      source: 'npm',
      pkg,
      summary: PACKAGE_SUMMARIES[pkg],
      available: (AVAILABLE_TEMPLATE_PACKAGES as ReadonlyArray<string>).includes(pkg),
    }),
  ),
]

/** Selectable entries only — what a user may actually pass to `--template`. */
export function selectableTemplates(): ReadonlyArray<CatalogEntry> {
  return TEMPLATE_CATALOG.filter((e) => e.available)
}

/**
 * Resolve a short template name (e.g. `'cf-team'`) to its full package name
 * (e.g. `'@aihu/templates-cf-team'`).
 *
 * Accepts both the short form and the full form. Returns `undefined` if the
 * name does not match any KNOWN_TEMPLATES entry. Note this answers "is this a
 * known package name", NOT "can it be installed" — use `selectTemplate()` for
 * the latter.
 */
export function resolveTemplateName(short: string): KnownTemplate | undefined {
  const candidate = short.startsWith(SHORT_PREFIX) ? short : `${SHORT_PREFIX}${short}`
  return (KNOWN_TEMPLATES as ReadonlyArray<string>).includes(candidate)
    ? (candidate as KnownTemplate)
    : undefined
}

export type TemplateSelection =
  /** A template embedded in @aihu/cli. */
  | { readonly kind: 'builtin'; readonly id: BuiltinTemplate }
  /** A published @aihu/templates-* package — install and run the pipeline. */
  | { readonly kind: 'package'; readonly id: string; readonly pkg: KnownTemplate }
  /** Declared in KNOWN_TEMPLATES but not published to npm. */
  | { readonly kind: 'unpublished'; readonly id: string; readonly pkg: KnownTemplate }
  /** Not a template name at all. */
  | { readonly kind: 'unknown'; readonly raw: string }

/**
 * Classify a raw `--template` value into what the CLI should do with it.
 * The single classifier shared by `aihu app` and `create-aihu`.
 */
export function selectTemplate(raw: string): TemplateSelection {
  if ((BUILTIN_TEMPLATES as ReadonlyArray<string>).includes(raw)) {
    return { kind: 'builtin', id: raw as BuiltinTemplate }
  }
  const pkg = resolveTemplateName(raw)
  if (pkg === undefined) return { kind: 'unknown', raw }
  const id = pkg.slice(SHORT_PREFIX.length)
  return (AVAILABLE_TEMPLATE_PACKAGES as ReadonlyArray<string>).includes(pkg)
    ? { kind: 'package', id, pkg }
    : { kind: 'unpublished', id, pkg }
}

/**
 * Render the human-readable template catalogue used by `--help` and by every
 * "that's not a template" error. Plain text (no ANSI) so it is safe to write
 * to stderr, into a golden file, or into a test assertion.
 */
export function formatTemplateCatalog(indent = '  '): string {
  const pad = (s: string): string => s.padEnd(10, ' ')
  const lines: string[] = []

  lines.push(`${indent}Built-in (no download):`)
  for (const e of TEMPLATE_CATALOG) {
    if (e.source === 'builtin') lines.push(`${indent}  ${pad(e.id)}— ${e.summary}`)
  }

  const npmAvailable = TEMPLATE_CATALOG.filter((e) => e.source === 'npm' && e.available)
  lines.push('')
  lines.push(`${indent}From npm (installed on demand):`)
  for (const e of npmAvailable) lines.push(`${indent}  ${pad(e.id)}— ${e.summary}`)

  const unpublished = TEMPLATE_CATALOG.filter((e) => e.source === 'npm' && !e.available)
  if (unpublished.length > 0) {
    lines.push('')
    lines.push(
      `${indent}Declared but NOT YET PUBLISHED (cannot be selected): ` +
        unpublished.map((e) => e.id).join(', '),
    )
  }

  return `${lines.join('\n')}\n`
}
