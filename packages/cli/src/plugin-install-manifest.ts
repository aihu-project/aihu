/**
 * `pluginInstallManifest.json` consumer — `docs/specs/plugin-install-manifest.md`.
 *
 * Three packages (`@aihu/seo`, `@aihu/plugin-demo`, `@aihu/magna`) have shipped
 * `install-manifest.json` since the spec was drafted, but nothing in this repo
 * ever read one: `aihu add` is a different feature (copies `@aihu/ui` registry
 * recipes), and grepping `packages/cli/src` for `install-manifest`/`InstallStep`
 * turned up zero hits outside unrelated template-scaffolding code. This module
 * is the missing reader: pure parsing/validation plus the idempotent text edits
 * `aihu plugin install <name>` applies. I/O (reading the manifest off disk,
 * writing files back, running `bun add`) lives in `commands/plugin-install.ts`
 * so this half stays a plain function library, testable without a filesystem.
 */

// ─── Schema (spec's TypeScript canonical form) ────────────────────────────────

export interface AddPluginToConfigStep {
  readonly kind: 'add-plugin-to-config'
  readonly factoryName: string
  readonly defaultOptions?: Readonly<Record<string, unknown>>
}

export interface AddRouteStep {
  readonly kind: 'add-route'
  readonly factoryName: string
  readonly routes: ReadonlyArray<{ readonly path: string; readonly handlerKey: string }>
}

export interface AddEnvVarStep {
  readonly kind: 'add-env-var'
  readonly name: string
  readonly description: string
  readonly default?: string
}

export interface RunMigrationStep {
  readonly kind: 'run-migration'
  readonly path: string
  readonly backend: 'magna-sdl' | 'sql'
}

/** A step kind this reader does not recognise — warn-skip per spec, not fail. */
export interface UnknownStep {
  readonly kind: string
  readonly [key: string]: unknown
}

export type InstallStep = AddPluginToConfigStep | AddRouteStep | AddEnvVarStep | RunMigrationStep

const KNOWN_KINDS: ReadonlySet<string> = new Set([
  'add-plugin-to-config',
  'add-route',
  'add-env-var',
  'run-migration',
])

export interface RequiredEnvEntry {
  readonly name: string
  readonly description: string
  readonly default?: string
}

export interface PluginInstallManifest {
  readonly pluginName: string
  readonly pluginVersion: string
  readonly aihuVersion: string
  readonly installSteps: ReadonlyArray<InstallStep | UnknownStep>
  readonly requiredEnv?: ReadonlyArray<RequiredEnvEntry>
  readonly additionalPackages?: ReadonlyArray<string>
  readonly summary?: string
}

export class ManifestValidationError extends Error {}

/**
 * Parse + structurally validate a manifest read off disk. Throws
 * `ManifestValidationError` on anything the CLI cannot safely act on — a
 * malformed manifest is a broken plugin release, not a "manual install" case
 * (that fallback is reserved for a plugin shipping NO manifest at all).
 */
export function parseManifest(raw: unknown): PluginInstallManifest {
  if (typeof raw !== 'object' || raw === null) {
    throw new ManifestValidationError('install-manifest.json is not a JSON object')
  }
  const m = raw as Record<string, unknown>
  for (const field of ['pluginName', 'pluginVersion', 'aihuVersion'] as const) {
    if (typeof m[field] !== 'string' || m[field] === '') {
      throw new ManifestValidationError(`install-manifest.json is missing "${field}"`)
    }
  }
  if (!Array.isArray(m.installSteps)) {
    throw new ManifestValidationError('install-manifest.json "installSteps" must be an array')
  }
  for (const step of m.installSteps) {
    if (
      typeof step !== 'object' ||
      step === null ||
      typeof (step as { kind?: unknown }).kind !== 'string'
    ) {
      throw new ManifestValidationError(
        'install-manifest.json has an installSteps entry with no "kind"',
      )
    }
  }
  if (m.requiredEnv !== undefined && !Array.isArray(m.requiredEnv)) {
    throw new ManifestValidationError('install-manifest.json "requiredEnv" must be an array')
  }
  if (m.additionalPackages !== undefined && !Array.isArray(m.additionalPackages)) {
    throw new ManifestValidationError('install-manifest.json "additionalPackages" must be an array')
  }
  return m as unknown as PluginInstallManifest
}

export function isKnownStep(step: { readonly kind: string }): step is InstallStep {
  return KNOWN_KINDS.has(step.kind)
}

// ─── `add-plugin-to-config` — edit `plugins: [...]` in vite.config.ts / aihu.config.ts ──

/**
 * Render a manifest's `defaultOptions` as the TypeScript object literal the
 * spec describes: JSON-serializable values, except a string matching
 * `process.env.NAME` is emitted as the bare identifier (so the scaffolded
 * config reads an env var instead of embedding its literal name as a string).
 */
export function renderOptionsLiteral(options: Readonly<Record<string, unknown>>): string {
  const entries = Object.entries(options)
  if (entries.length === 0) return '{}'
  const body = entries.map(([key, value]) => `${key}: ${renderValue(value)}`).join(', ')
  return `{ ${body} }`
}

function renderValue(value: unknown): string {
  if (typeof value === 'string') {
    const envMatch = /^process\.env\.[A-Za-z_][A-Za-z0-9_]*$/.exec(value)
    if (envMatch) return value
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(renderValue).join(', ')}]`
  if (typeof value === 'object' && value !== null) {
    return renderOptionsLiteral(value as Record<string, unknown>)
  }
  return JSON.stringify(value)
}

export interface TextEdit {
  readonly updated: string
  /** False when the edit was a no-op because it was already applied (idempotent). */
  readonly applied: boolean
}

const IMPORT_RE = /^import\s+.*$/gm

/** Insert `stmt` after the last top-of-file `import` line (or at the top if none). */
function insertAfterImports(source: string, stmt: string): string {
  let lastImportEnd = 0
  for (const match of source.matchAll(IMPORT_RE)) {
    lastImportEnd = (match.index ?? 0) + match[0].length
  }
  if (lastImportEnd === 0) return `${stmt}\n${source}`
  return `${source.slice(0, lastImportEnd)}\n${stmt}${source.slice(lastImportEnd)}`
}

/**
 * Idempotent `add-plugin-to-config` edit. Looks for an existing
 * `<factoryName>(` call already present anywhere in the file — that is the
 * spec's idempotency key ("matching factoryName + pluginName") and is
 * deliberately loose: a config that already registers the plugin by hand
 * (or from a previous `aihu plugin install` run) must not gain a duplicate.
 *
 * Finds the `plugins: [` array belonging to `viteAihuPlugin({...})` (current
 * convention) or `defineAihuConfig({...})` (legacy `aihu.config.ts` fallback)
 * and inserts a new element before its closing `]`. Returns `applied: false`
 * with the source unchanged when neither an existing registration nor a
 * `plugins:` array can be found, so the caller can warn instead of silently
 * doing nothing.
 */
export function computeConfigInsertion(
  source: string,
  step: AddPluginToConfigStep,
  pluginName: string,
): TextEdit {
  const callRe = new RegExp(`\\b${escapeRegExp(step.factoryName)}\\s*\\(`)
  if (callRe.test(source)) {
    return { updated: source, applied: false }
  }

  const pluginsArrayRe = /plugins\s*:\s*\[/
  const arrayMatch = pluginsArrayRe.exec(source)
  if (!arrayMatch) {
    return { updated: source, applied: false }
  }

  const optionsLiteral = renderOptionsLiteral(step.defaultOptions ?? {})
  const entry = `${step.factoryName}(${optionsLiteral})`

  const arrayStart = arrayMatch.index + arrayMatch[0].length
  const closeIndex = findMatchingBracket(source, arrayStart - 1, '[', ']')
  if (closeIndex === -1) {
    return { updated: source, applied: false }
  }

  const inner = source.slice(arrayStart, closeIndex)
  const trimmedInner = inner.trim()
  const insertion =
    trimmedInner === '' ? `${entry}` : `${trimmedInner.replace(/,\s*$/, '')}, ${entry}`
  let updated = `${source.slice(0, arrayStart)}${inner.includes('\n') ? `\n  ${insertion}\n` : insertion}${source.slice(closeIndex)}`

  const importStmt = `import { ${step.factoryName} } from '${pluginName}'`
  if (!source.includes(importStmt)) {
    updated = insertAfterImports(updated, importStmt)
  }

  return { updated, applied: true }
}

/** Find the index of the bracket matching the one at `openIndex` (which must be `openChar`). */
function findMatchingBracket(
  source: string,
  openIndex: number,
  openChar: string,
  closeChar: string,
): number {
  if (source[openIndex] !== openChar) return -1
  let depth = 0
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === openChar) depth++
    else if (source[i] === closeChar) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ─── `add-route` — edit `createRequestRouter({ routes: [...] })` ─────────────

/**
 * Idempotent `add-route` edit against a routes module built on
 * `createRequestRouter({ routes: [...] })` (`@aihu/server`'s convention —
 * see `packages/templates/cf-team/template/apps/web/src/main.ts.tmpl`).
 *
 * Idempotency key is the route PATH (per the spec's CLI-behavior table):
 * a `defineRoute('<path>', ...)` call for a path already present is skipped.
 * Returns `applied: false` with the source unchanged when no
 * `createRequestRouter(` call can be found, so the caller can fall back to a
 * "register manually" message instead of guessing at file structure.
 */
export function computeRouteInsertion(
  source: string,
  step: AddRouteStep,
  pluginName: string,
): TextEdit {
  const routerCallIdx = source.indexOf('createRequestRouter(')
  if (routerCallIdx === -1) {
    return { updated: source, applied: false }
  }
  const routesArrayRe = /routes\s*:\s*\[/
  const arrayMatch = routesArrayRe.exec(source.slice(routerCallIdx))
  if (!arrayMatch) {
    return { updated: source, applied: false }
  }
  const arrayStart = routerCallIdx + arrayMatch.index + arrayMatch[0].length
  const closeIndex = findMatchingBracket(source, arrayStart - 1, '[', ']')
  if (closeIndex === -1) {
    return { updated: source, applied: false }
  }

  const varName = lowerFirst(step.factoryName.replace(/^create/, '')) || 'routesHandle'
  const pending = step.routes.filter(
    (r) => !source.includes(`'${r.path}'`) && !source.includes(`"${r.path}"`),
  )
  if (pending.length === 0) {
    return { updated: source, applied: false }
  }

  const entries = pending
    .map((r) => `defineRoute('${r.path}', ${varName}.${r.handlerKey})`)
    .join(',\n    ')

  const inner = source.slice(arrayStart, closeIndex)
  const trimmedInner = inner.trim()
  const insertion =
    trimmedInner === ''
      ? `\n    ${entries},\n  `
      : `${inner.replace(/\s*$/, '')}\n    ${entries},\n  `
  let updated = `${source.slice(0, arrayStart)}${insertion}${source.slice(closeIndex)}`

  const handleDecl = `const ${varName} = ${step.factoryName}()`
  if (!updated.includes(handleDecl) && !updated.includes(`${varName} =`)) {
    updated = `${handleDecl}\n\n${updated}`
  }
  const looseImportRe = new RegExp(
    `import\\s*\\{[^}]*\\b${escapeRegExp(step.factoryName)}\\b[^}]*\\}\\s*from\\s*['"]${escapeRegExp(pluginName)}['"]`,
  )
  if (!looseImportRe.test(updated) && !updated.includes(`from '${pluginName}'`)) {
    updated = insertAfterImports(updated, `import { ${step.factoryName} } from '${pluginName}'`)
  }

  return { updated, applied: true }
}

function lowerFirst(s: string): string {
  return s.length === 0 ? s : s[0]!.toLowerCase() + s.slice(1)
}

// ─── `add-env-var` / `requiredEnv` — append to `.env.example` ────────────────

/**
 * Append a missing env var to `.env.example` (creating the file's contents
 * from scratch when `existing` is `undefined`). Never overwrites an existing
 * value for the same name — idempotency key is the `NAME=` line.
 */
export function computeEnvExampleInsertion(
  existing: string | undefined,
  entry: { readonly name: string; readonly description: string; readonly default?: string },
): TextEdit {
  const source = existing ?? ''
  const nameRe = new RegExp(`^${escapeRegExp(entry.name)}=`, 'm')
  if (nameRe.test(source)) {
    return { updated: source, applied: false }
  }
  const line = `${entry.name}=${entry.default ?? ''}`
  const block = `# ${entry.description}\n${line}\n`
  const updated = source === '' ? block : `${source.replace(/\n*$/, '\n\n')}${block}`
  return { updated, applied: true }
}
