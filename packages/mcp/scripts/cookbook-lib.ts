/**
 * cookbook-lib.ts — the single parsing/validation/rendering library for the
 * cookbook corpus (`cookbook/*.aihu`).
 *
 * Every consumption surface is GENERATED from the corpus through this module:
 *   - `packages/mcp/src/cookbook-index.json` (served by the `aihu_example` MCP tool)
 *   - `llms-cookbook.txt` at the repo root (agent-consumable text export)
 *   - `apps/docs/playground/presets.generated.ts` (playground presets)
 *
 * Doctrine (the `-1` bundle-size incident, restored in #510): generators must
 * FAIL LOUDLY on missing/invalid input — never emit vacuously. Every recipe
 * MUST carry a `<!-- @cookbook … -->` frontmatter block that validates against
 * the schema below; a single offender fails the whole build, listing all
 * offenders.
 *
 * Frontmatter schema (proposal §4 — block schema for dual consumption):
 *
 *   <!-- @cookbook
 *   id: aihu-counter                    # REQUIRED, must equal the filename stem
 *   type: display                       # REQUIRED, one of COMPONENT_TYPES
 *   granularity: block                  # REQUIRED, block | recipe
 *   description: One-line description.  # REQUIRED, non-empty single line
 *   constructs: [prop, action, on:click]# REQUIRED, canonical construct IDs
 *   packages: ["@aihu/store"]           # optional, defaults to []
 *   concerns: [state, events]           # REQUIRED, one+ of CONCERNS
 *   since: 0.5.0                        # REQUIRED, semver
 *   playground: Counter                 # optional — presence ⇒ playground preset,
 *                                       #   value is the preset label
 *   anti-patterns:                      # optional block list of quoted strings
 *     - "Do not …"
 *   related: [aihu-tabs]                # optional, ids of related recipes
 *   -->
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Vocabulary (proposal §3 taxonomy + §4 registry)
// ---------------------------------------------------------------------------

/** Component-type axis — the retrieval axis an agent filters on first. */
export const COMPONENT_TYPES = [
  'display',
  'form',
  'list',
  'container',
  'async',
  'streaming',
  'store',
  'agent',
  'ssr-ssg',
  'routing',
  'interop',
] as const

/** Concern axis — orthogonal frontmatter tags. */
export const CONCERNS = [
  'state',
  'events',
  'styling',
  'a11y',
  'governance',
  'persistence',
  'serialization',
] as const

export const GRANULARITIES = ['block', 'recipe'] as const

/**
 * Canonical construct IDs. Row universe follows the compiler, not the docs:
 * binding + statement intrinsics from
 * `the standalone compiler state-wrapper parser` (BINDING_INTRINSICS /
 * STATEMENT_INTRINSICS), template vocabulary from the template-grammar-v2
 * surface. Kept as data so `check:coverage-manifest` (P1) can join the same
 * registry.
 */
const BINDING_INTRINSICS = [
  'state',
  'prop',
  'derived',
  'action',
  'resource',
  'stream',
  'controller',
  'route',
  'consume',
]

const STATEMENT_INTRINSICS = [
  'effect',
  'onMount',
  'onDispose',
  'onAdopt',
  'onAttributeChange',
  'aria',
  'provide',
  'form',
  'event',
  'beforeNavigate',
  'afterNavigate',
]

const TEMPLATE_CONSTRUCTS = [
  'interpolation',
  'if',
  'elseif',
  'else',
  'each',
  'key',
  'empty',
  'show',
  'html',
  'ref',
  'memo',
  'once',
  'raw',
  'slot',
  'group',
  'suspense',
  'outlet',
  'shield',
  'router',
  'navigate',
  'guard',
  'a-enhanced',
  'prefetch',
]

const OTHER_CONSTRUCTS = [
  'agent-block', // standalone @agent{} block
  'emit', // $emit from event()
]

export const CONSTRUCT_REGISTRY: ReadonlySet<string> = new Set([
  ...BINDING_INTRINSICS,
  ...STATEMENT_INTRINSICS,
  ...TEMPLATE_CONSTRUCTS,
  ...OTHER_CONSTRUCTS,
])

/**
 * A construct ID is valid when it is:
 *  - a registry entry (`prop`, `each`, `onMount`, …), or
 *  - a directive-prefix form (`on:click`, `bind:value`, `class:active`), or
 *  - a dotted refinement whose base is registered (`prop.expose`,
 *    `controller.describe`).
 */
export function isKnownConstruct(id: string): boolean {
  if (CONSTRUCT_REGISTRY.has(id)) return true
  if (/^(on|bind|class):[\w-]+$/.test(id)) return true
  const dot = id.indexOf('.')
  if (dot > 0) return CONSTRUCT_REGISTRY.has(id.slice(0, dot))
  return false
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CookbookFrontmatter {
  id: string
  type: (typeof COMPONENT_TYPES)[number]
  granularity: (typeof GRANULARITIES)[number]
  description: string
  constructs: string[]
  packages: string[]
  concerns: string[]
  since: string
  /** Preset label — presence means "include as a playground preset". */
  playground?: string
  antiPatterns: string[]
  related: string[]
}

export interface CookbookIndexEntry extends CookbookFrontmatter {
  filename: string
  /** Derived retrieval tags (union of type/granularity/concerns/construct segments/id segments). */
  tags: string[]
  /** Recipe source with the frontmatter block stripped (metadata lives in the entry itself). */
  source: string
}

export interface ParseResult {
  meta: CookbookFrontmatter | null
  /** Source with the frontmatter block removed. */
  body: string
  errors: string[]
}

export interface CorpusResult {
  entries: CookbookIndexEntry[]
  errors: string[]
}

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

const FM_RE = /<!--\s*@cookbook\r?\n([\s\S]*?)-->\r?\n?/

const REQUIRED_KEYS = [
  'id',
  'type',
  'granularity',
  'description',
  'constructs',
  'concerns',
  'since',
] as const

const KNOWN_KEYS = new Set([...REQUIRED_KEYS, 'packages', 'playground', 'anti-patterns', 'related'])

function parseInlineArray(raw: string, key: string, errors: string[]): string[] {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    errors.push(`${key}: expected an inline array like [a, b, c], got: ${trimmed}`)
    return []
  }
  const inner = trimmed.slice(1, -1).trim()
  if (inner === '') return []
  return inner
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
}

/**
 * Parse the `<!-- @cookbook … -->` frontmatter block out of a recipe source.
 * Returns all schema violations (never throws); `meta` is null when the block
 * is missing or unusable.
 */
export function parseFrontmatter(source: string, filename: string): ParseResult {
  const errors: string[] = []
  const m = FM_RE.exec(source)
  if (!m) {
    return {
      meta: null,
      body: source,
      errors: [`missing <!-- @cookbook --> frontmatter block`],
    }
  }
  const body = source.replace(FM_RE, '')

  const scalars = new Map<string, string>()
  const antiPatterns: string[] = []
  let inAntiPatterns = false

  for (const rawLine of m[1].split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line.trim() === '') continue
    if (inAntiPatterns) {
      const item = /^\s+-\s+(.*)$/.exec(line)
      if (item) {
        antiPatterns.push(item[1].trim().replace(/^["']|["']$/g, ''))
        continue
      }
      inAntiPatterns = false
    }
    const kv = /^([a-z-]+):\s*(.*)$/.exec(line.trim())
    if (!kv) {
      errors.push(`unparseable frontmatter line: ${line.trim()}`)
      continue
    }
    const [, key, value] = kv
    if (!KNOWN_KEYS.has(key)) {
      errors.push(`unknown frontmatter key: ${key}`)
      continue
    }
    if (key === 'anti-patterns') {
      if (value.trim() !== '') {
        errors.push(`anti-patterns: must be a block list ("- \\"…\\"" lines), not inline`)
      }
      inAntiPatterns = true
      continue
    }
    if (scalars.has(key)) {
      errors.push(`duplicate frontmatter key: ${key}`)
      continue
    }
    scalars.set(key, value.trim())
  }

  for (const key of REQUIRED_KEYS) {
    if (!scalars.has(key) || scalars.get(key) === '') {
      errors.push(`missing required frontmatter field: ${key}`)
    }
  }

  const stem = filename.replace(/\.aihu$/, '')
  const id = scalars.get('id') ?? ''
  if (id && id !== stem) {
    errors.push(`id '${id}' must equal the filename stem '${stem}'`)
  }

  const type = scalars.get('type') ?? ''
  if (type && !(COMPONENT_TYPES as readonly string[]).includes(type)) {
    errors.push(`type '${type}' is not a component type (${COMPONENT_TYPES.join(', ')})`)
  }

  const granularity = scalars.get('granularity') ?? ''
  if (granularity && !(GRANULARITIES as readonly string[]).includes(granularity)) {
    errors.push(`granularity '${granularity}' must be one of: ${GRANULARITIES.join(', ')}`)
  }

  const since = scalars.get('since') ?? ''
  if (since && !/^\d+\.\d+\.\d+$/.test(since)) {
    errors.push(`since '${since}' is not a semver version`)
  }

  const constructs = scalars.has('constructs')
    ? parseInlineArray(scalars.get('constructs') ?? '', 'constructs', errors)
    : []
  if (scalars.has('constructs') && constructs.length === 0) {
    errors.push('constructs: must list at least one canonical construct ID')
  }
  for (const c of constructs) {
    if (!isKnownConstruct(c)) {
      errors.push(`constructs: unknown construct ID '${c}' (not in the registry)`)
    }
  }

  const concerns = scalars.has('concerns')
    ? parseInlineArray(scalars.get('concerns') ?? '', 'concerns', errors)
    : []
  if (scalars.has('concerns') && concerns.length === 0) {
    errors.push('concerns: must list at least one concern')
  }
  for (const c of concerns) {
    if (!(CONCERNS as readonly string[]).includes(c)) {
      errors.push(`concerns: unknown concern '${c}' (${CONCERNS.join(', ')})`)
    }
  }

  const packages = scalars.has('packages')
    ? parseInlineArray(scalars.get('packages') ?? '', 'packages', errors)
    : []

  const related = scalars.has('related')
    ? parseInlineArray(scalars.get('related') ?? '', 'related', errors)
    : []

  const playground = scalars.get('playground')

  if (errors.length > 0) {
    return { meta: null, body, errors }
  }

  return {
    meta: {
      id,
      type: type as CookbookFrontmatter['type'],
      granularity: granularity as CookbookFrontmatter['granularity'],
      description: scalars.get('description') ?? '',
      constructs,
      packages,
      concerns,
      since,
      ...(playground ? { playground } : {}),
      antiPatterns,
      related,
    },
    body,
    errors: [],
  }
}

// ---------------------------------------------------------------------------
// Corpus building
// ---------------------------------------------------------------------------

/** Derive flat retrieval tags for the aihu_example keyword matcher. */
function deriveTags(meta: CookbookFrontmatter): string[] {
  const tags = new Set<string>()
  tags.add(meta.type)
  tags.add(meta.granularity)
  for (const c of meta.concerns) tags.add(c)
  for (const c of meta.constructs) {
    tags.add(c.toLowerCase())
    for (const seg of c.split(/[.:]/)) {
      if (seg) tags.add(seg.toLowerCase())
    }
  }
  for (const seg of meta.id.split('-')) {
    if (seg && seg !== 'aihu') tags.add(seg.toLowerCase())
  }
  for (const p of meta.packages) tags.add(p.toLowerCase())
  return [...tags].sort()
}

/**
 * Read every `cookbook/*.aihu` file, parse + validate frontmatter, and build
 * the deterministic (filename-sorted) index entries.
 *
 * NEVER partial: any invalid file contributes errors, and callers must treat
 * a non-empty `errors` as fatal. An empty cookbook directory is itself an
 * error — the empty-index failure class is exactly what this library exists
 * to prevent.
 */
export function buildCorpus(cookbookDir: string): CorpusResult {
  const errors: string[] = []
  let files: string[]
  try {
    files = readdirSync(cookbookDir)
      .filter((f) => f.endsWith('.aihu'))
      .sort()
  } catch (e) {
    return {
      entries: [],
      errors: [`could not read cookbook dir ${cookbookDir}: ${(e as Error).message}`],
    }
  }

  if (files.length === 0) {
    return {
      entries: [],
      errors: [`no .aihu recipes found in ${cookbookDir} — refusing to emit an empty index`],
    }
  }

  const entries: CookbookIndexEntry[] = []
  const seenIds = new Set<string>()
  const seenPlaygroundLabels = new Map<string, string>()

  for (const filename of files) {
    const source = readFileSync(join(cookbookDir, filename), 'utf-8')
    const { meta, body, errors: fileErrors } = parseFrontmatter(source, filename)
    if (fileErrors.length > 0 || meta === null) {
      for (const err of fileErrors) errors.push(`${filename}: ${err}`)
      continue
    }
    if (seenIds.has(meta.id)) {
      errors.push(`${filename}: duplicate id '${meta.id}'`)
      continue
    }
    seenIds.add(meta.id)
    if (meta.playground) {
      const prev = seenPlaygroundLabels.get(meta.playground)
      if (prev) {
        errors.push(`${filename}: playground label '${meta.playground}' already used by ${prev}`)
      } else {
        seenPlaygroundLabels.set(meta.playground, filename)
      }
    }
    entries.push({
      ...meta,
      filename,
      tags: deriveTags(meta),
      source: body.replace(/^\s*\n/, ''),
    })
  }

  // Cross-file: `related:` ids must resolve within the corpus.
  const allIds = new Set(entries.map((e) => e.id))
  for (const e of entries) {
    for (const rel of e.related) {
      if (!allIds.has(rel)) {
        errors.push(`${e.filename}: related id '${rel}' does not exist in the cookbook`)
      }
    }
  }

  return { entries, errors }
}

// ---------------------------------------------------------------------------
// Renderers — all deterministic (sorted input, stable formatting)
// ---------------------------------------------------------------------------

/** The JSON index consumed by @aihu/mcp (`aihu_example`). */
export function renderIndexJson(entries: CookbookIndexEntry[]): string {
  const ordered = entries.map((e) => ({
    filename: e.filename,
    id: e.id,
    type: e.type,
    granularity: e.granularity,
    description: e.description,
    constructs: e.constructs,
    packages: e.packages,
    concerns: e.concerns,
    since: e.since,
    ...(e.playground ? { playground: e.playground } : {}),
    antiPatterns: e.antiPatterns,
    related: e.related,
    tags: e.tags,
    source: e.source,
  }))
  return `${JSON.stringify(ordered, null, 2)}\n`
}

/** `llms-cookbook.txt` — the zero-infrastructure agent-consumable export. */
export function renderLlmsCookbook(entries: CookbookIndexEntry[]): string {
  const parts: string[] = [
    '# Aihu Cookbook',
    '',
    '> Canonical, compiler-verified .aihu recipes — the fluency corpus for writing',
    '> idiomatic aihu components. Every recipe below compiles through the real aihu',
    '> compiler in CI (cookbook/harness.ts). Generated from cookbook/*.aihu by',
    '> packages/mcp/scripts/build-cookbook-index.ts — do not edit by hand.',
    '',
    `> Recipes: ${entries.length}`,
    '',
    '---',
    '',
  ]
  for (const e of entries) {
    parts.push(`## ${e.id} (${e.type} · ${e.granularity})`)
    parts.push('')
    parts.push(e.description)
    parts.push('')
    parts.push(`- constructs: ${e.constructs.join(', ')}`)
    if (e.packages.length > 0) parts.push(`- packages: ${e.packages.join(', ')}`)
    parts.push(`- concerns: ${e.concerns.join(', ')}`)
    parts.push(`- since: ${e.since}`)
    if (e.related.length > 0) parts.push(`- related: ${e.related.join(', ')}`)
    if (e.antiPatterns.length > 0) {
      parts.push('- anti-patterns:')
      for (const a of e.antiPatterns) parts.push(`  - ${a}`)
    }
    parts.push('')
    parts.push('```aihu')
    parts.push(e.source.trimEnd())
    parts.push('```')
    parts.push('')
    parts.push('---')
    parts.push('')
  }
  return `${parts.join('\n').trimEnd()}\n`
}

/** `apps/docs/playground/presets.generated.ts` — playground presets. */
export function renderPresetsTs(entries: CookbookIndexEntry[]): string {
  const presets = entries.filter((e) => e.playground)
  const parts: string[] = [
    '/**',
    ' * GENERATED FILE — do not edit.',
    ' *',
    ' * Playground presets derived from the cookbook corpus: every recipe whose',
    ' * frontmatter carries a `playground:` label lands here. Regenerate with',
    ' * `bun packages/mcp/scripts/build-cookbook-index.ts`; CI diffs this file',
    ' * against a fresh build (scripts/check-cookbook-index.ts).',
    ' */',
    '',
    'export interface GeneratedPreset {',
    '  readonly id: string',
    '  readonly label: string',
    '  readonly source: string',
    '}',
    '',
    'export const GENERATED_PRESETS: readonly GeneratedPreset[] = [',
  ]
  for (const e of presets) {
    parts.push('  {')
    parts.push(`    id: ${JSON.stringify(e.id)},`)
    parts.push(`    label: ${JSON.stringify(e.playground)},`)
    parts.push(`    source: ${JSON.stringify(e.source)},`)
    parts.push('  },')
  }
  parts.push(']')
  return `${parts.join('\n')}\n`
}
