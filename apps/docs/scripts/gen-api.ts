#!/usr/bin/env bun
/**
 * gen-api.ts — the API-reference datasheet generator.
 *
 * Extracts the public export surface of every documentable aihu package and
 * emits a deterministic, check-able data + page artifact — the DX surface the
 * docs site is built for. Modelled on `sync-readme`: run it to regenerate,
 * run it with `--check` in CI to fail on drift.
 *
 *   bun scripts/gen-api.ts            # (re)write the generated artifact
 *   bun scripts/gen-api.ts --check    # exit 1 if the committed output is stale
 *
 * WHAT IT DOES
 *   1. Reads `scripts/__package-inventory.json` (the monorepo package census)
 *      and keeps the 37 DOCUMENTABLE packages — dropping platform binary shims
 *      (`/npm/`, `/npm-native/`, `isPlatform`), moved/deprecated packages
 *      (`_moved`), and template scaffolds (`/templates/`).
 *   2. For each package, resolves its `exports`/`types` entry to a real `src/*.ts`
 *      (or falls back to the built `dist/*.d.ts`, or — for `.aihu`-only or CLI
 *      packages — to the `exports` subpath list). Parses it with the TypeScript
 *      compiler API, transitively following relative re-exports, and collects
 *      each exported declaration's kind + typed signature (body stripped) +
 *      first-sentence JSDoc + `@since` + agent-relevance.
 *   3. Emits one data module per package (`src/data/api/generated/<slug>.ts`),
 *      a tier-grouped index roll-up (`src/data/api/generated/index.ts`), and one
 *      datasheet page per package (`src/pages/api/<slug>.aihu`) — EXCEPT the
 *      hand-authored `@aihu/signals` exemplar page, whose curated data lives in
 *      `src/data/api-signals.ts` and is left untouched.
 *
 * Extraction is AST-only — no type-checker, no dependency graph, no module
 * resolution — so it is fast and deterministic.
 *
 * BUT IT IS NOT BUILD-INDEPENDENT. Step 2's fallback chain reaches into
 * `dist/*.d.ts` for any package whose `exports` target has no `src/` sibling,
 * and `dist/` is gitignored. Run `--check` on a tree that has never been built
 * and those packages report drift every single time — false drift, on files
 * nobody touched. Every CI caller must therefore run it AFTER the workspace
 * build step; see the note on the gate in `.github/workflows/deploy-docs.yml`
 * and the matching step in `plan-a.yml`'s `check` job.
 *
 * Output is normalized through biome (see `biomeFormat`), so the committed
 * artifact is byte-identical to `biome ci` output. That normalization is what
 * makes `--check` a real comparison — and it means these files must NOT be
 * added to biome.json's `files.includes` ignore list. An ignored path makes
 * `biome format` a pass-through at exit 0, `biomeFormat` silently emits
 * unformatted text, and `--check` then reports drift that regenerating can
 * never fix. Lint noise from the generated `${...}` signatures is handled by
 * the dedicated `overrides` entry for this directory instead.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const HERE = dirname(fileURLToPath(import.meta.url)) // apps/docs/scripts
const APP = resolve(HERE, '..') // apps/docs
const REPO = resolve(APP, '..', '..') // monorepo root
const INVENTORY = join(REPO, 'scripts', '__package-inventory.json')
const DATA_DIR = join(APP, 'src', 'data', 'api', 'generated')
const PAGES_DIR = join(APP, 'src', 'pages', 'api')
const BIOME_BIN = join(REPO, 'node_modules', '.bin', 'biome')

const CHECK = process.argv.includes('--check')

/** The hand-authored exemplar page — generator owns its DATA counts but not its page. */
const EXEMPLAR_SLUG = 'signals'
/** Hand-authored `.aihu` pages under `src/pages/api/` the sweep must never delete. */
const HAND_AUTHORED_PAGES = new Set([`${EXEMPLAR_SLUG}.aihu`, 'index.aihu'])

// ---------------------------------------------------------------------------
// inventory → the 37 documentable packages
// ---------------------------------------------------------------------------
interface InvEntry {
  name: string
  version: string
  dir: string
  isPlatform?: boolean
}

function documentable(): InvEntry[] {
  const all: InvEntry[] = JSON.parse(readFileSync(INVENTORY, 'utf8'))
  const excluded = (e: InvEntry) => {
    const d = e.dir
    return (
      e.isPlatform === true ||
      d.includes('/npm/') ||
      d.includes('/npm-native/') ||
      d.includes('_moved') ||
      d.includes('/templates/')
    )
  }
  const result = all.filter((e) => !excluded(e))
  // The compiler is deliberately owned by the standalone aihu-compiler
  // repository. Keep its API page in the root docs by extracting the locked
  // published package from node_modules, rather than reaching into deleted
  // compiler source.
  const compilerManifest = join(REPO, 'node_modules/@aihu/compiler/package.json')
  if (existsSync(compilerManifest) && !result.some((e) => e.name === '@aihu/compiler')) {
    const manifest = JSON.parse(readFileSync(compilerManifest, 'utf8')) as {
      name: string
      version: string
    }
    result.push({
      name: manifest.name,
      version: manifest.version,
      dir: 'node_modules/@aihu/compiler',
    })
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}

/** '@aihu/signals' → 'signals'; '@aihu-plugin/data' → 'plugin-data'; 'create-aihu' → 'create-aihu'. */
function slugFor(name: string): string {
  if (name.startsWith('@aihu-plugin/')) return `plugin-${name.slice('@aihu-plugin/'.length)}`
  if (name.startsWith('@aihu/')) return name.slice('@aihu/'.length)
  return name
}

/**
 * The datasheet's tier grouping. Derived from the package identity (the inventory
 * carries no tier field). Terracotta packages are the human/experience surface;
 * the "Agents & governance" tier is the graphite axis.
 */
const TIERS = [
  'Runtime core',
  'App & routing',
  'Authoring & UI',
  'Compiler & tooling',
  'Agents & governance',
  'Plugins',
] as const
type Tier = (typeof TIERS)[number]

const TIER_BY_SLUG: Record<string, Tier> = {
  // Runtime core — the reactive + rendering foundation.
  signals: 'Runtime core',
  runtime: 'Runtime core',
  arbor: 'Runtime core',
  primitives: 'Runtime core',
  store: 'Runtime core',
  context: 'Runtime core',
  'css-engine': 'Runtime core',
  // App & routing — the page/server/deploy surface.
  app: 'App & routing',
  router: 'App & routing',
  server: 'App & routing',
  seo: 'App & routing',
  'adapter-cloudflare': 'App & routing',
  'adapter-vercel': 'App & routing',
  // Authoring & UI — components + generators + editor integration.
  ui: 'Authoring & UI',
  magna: 'Authoring & UI',
  editor: 'Authoring & UI',
  // Compiler & tooling — the .aihu toolchain + CLIs.
  compiler: 'Compiler & tooling',
  cli: 'Compiler & tooling',
  tsc: 'Compiler & tooling',
  'language-server': 'Compiler & tooling',
  'create-aihu': 'Compiler & tooling',
  'vscode-aihu': 'Compiler & tooling',
  scraping: 'Compiler & tooling',
  // Agents & governance — the graphite axis: the agent-discoverable surface.
  agent: 'Agents & governance',
  'agent-a2a': 'Agents & governance',
  'agent-acp': 'Agents & governance',
  'agent-server': 'Agents & governance',
  'agent-service': 'Agents & governance',
  ai: 'Agents & governance',
  mcp: 'Agents & governance',
  auth: 'Agents & governance',
  // Plugins — optional, opt-in integrations.
  plugin: 'Plugins',
  'plugin-demo': 'Plugins',
  'plugin-agent-readiness': 'Plugins',
  'plugin-data': 'Plugins',
  'plugin-drizzle': 'Plugins',
  'plugin-kindly-note': 'Plugins',
}

const AGENT_TIERS = new Set<Tier>(['Agents & governance'])
const AGENT_RE = /\b(expose|describe|agent|mcp|a2a|acp|govern|discover|surface|permission)/i

// ---------------------------------------------------------------------------
// export extraction (AST-only)
// ---------------------------------------------------------------------------
type Kind = 'function' | 'const' | 'class' | 'interface' | 'type' | 'enum' | 'component'

interface Entry {
  name: string
  kind: Kind
  signature: string
  summary: string
  since?: string
  deprecated?: boolean
  agent?: boolean
}

/** Collapse a single-line signature: strip leading modifiers, fold whitespace. */
function oneLine(text: string): string {
  return text
    .replace(/^\s*export\s+default\s+/, '')
    .replace(/^\s*export\s+/, '')
    .replace(/^\s*declare\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Keep multi-line declarations (interface/type/enum) but drop the `export` lead. */
function multiLine(text: string): string {
  return text
    .replace(/^\s*export\s+default\s+/, '')
    .replace(/^\s*export\s+/, '')
    .replace(/^\s*declare\s+/, '')
    .replace(/[ \t]+$/gm, '')
    .trim()
}

function firstSentence(comment: string): string {
  const clean = comment.replace(/\s+/g, ' ').trim()
  const m = clean.match(/^(.*?[.!?])(\s|$)/)
  return (m?.[1] ?? clean).trim()
}

/** Read JSDoc summary + `@since` / `@deprecated` off a node. */
function docOf(node: ts.Node): { summary: string; since?: string; deprecated?: boolean } {
  const jsdocs = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc) as ts.JSDoc[]
  let summary = ''
  let since: string | undefined
  let deprecated = false
  for (const doc of jsdocs) {
    if (!summary && typeof doc.comment === 'string' && doc.comment.trim()) {
      summary = firstSentence(doc.comment)
    }
    for (const tag of doc.tags ?? []) {
      const tagName = tag.tagName.text
      const tagText = typeof tag.comment === 'string' ? tag.comment.trim() : ''
      if (tagName === 'since' && tagText) since = tagText
      if (tagName === 'deprecated') deprecated = true
    }
  }
  return since === undefined ? { summary, deprecated } : { summary, since, deprecated }
}

function signatureOf(node: ts.Node, sf: ts.SourceFile): { kind: Kind; signature: string } | null {
  if (ts.isFunctionDeclaration(node)) {
    const end = node.body ? node.body.getStart(sf) : node.getEnd()
    const text = sf.text.slice(node.getStart(sf), end)
    return { kind: 'function', signature: oneLine(text).replace(/\s*\{?\s*$/, '') }
  }
  if (ts.isClassDeclaration(node)) {
    const firstMember = node.members[0]
    const first = firstMember ? firstMember.getStart(sf) : node.getEnd()
    const brace = sf.text.lastIndexOf('{', first)
    const text = sf.text.slice(node.getStart(sf), brace > 0 ? brace : node.getEnd())
    return { kind: 'class', signature: oneLine(text) }
  }
  if (ts.isInterfaceDeclaration(node)) {
    return { kind: 'interface', signature: multiLine(node.getText(sf)) }
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return { kind: 'type', signature: multiLine(node.getText(sf)) }
  }
  if (ts.isEnumDeclaration(node)) {
    return { kind: 'enum', signature: multiLine(node.getText(sf)) }
  }
  return null
}

function varSignature(
  decl: ts.VariableDeclaration,
  sf: ts.SourceFile,
): { kind: Kind; signature: string } {
  const name = decl.name.getText(sf)
  if (decl.type)
    return { kind: 'const', signature: `const ${name}: ${oneLine(decl.type.getText(sf))}` }
  const init = decl.initializer
  if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
    const params = init.parameters.map((p) => oneLine(p.getText(sf))).join(', ')
    const ret = init.type ? `: ${oneLine(init.type.getText(sf))}` : ''
    const tp = init.typeParameters
      ? `<${init.typeParameters.map((t) => oneLine(t.getText(sf))).join(', ')}>`
      : ''
    return { kind: 'const', signature: `const ${name}${tp} = (${params})${ret} => …` }
  }
  return { kind: 'const', signature: `const ${name}` }
}

/** Resolve a relative module specifier to a concrete source file on disk. */
function resolveRel(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(fromFile), spec)
  const tries = [
    base.replace(/\.js$/, '.ts'),
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.d.ts`,
    join(base, 'index.ts'),
    join(base, 'index.d.ts'),
  ]
  for (const t of tries) if (existsSync(t) && !t.endsWith('/')) return t
  return null
}

const fileCache = new Map<string, Map<string, Entry>>()

/** All named exports of a source file, following its relative re-exports. Memoized. */
function exportsOfFile(file: string, stack: Set<string>): Map<string, Entry> {
  const cached = fileCache.get(file)
  if (cached) return cached
  const out = new Map<string, Entry>()
  fileCache.set(file, out)
  if (stack.has(file) || !existsSync(file)) return out
  stack.add(file)

  const sf = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )

  // Pass 1: index every top-level declaration by name (exported or not), so a
  // bare `export { x } from './y'` / `export { x }` can be resolved to its decl.
  const local = new Map<string, Entry>()
  const addDecl = (name: string, node: ts.Node) => {
    const sig = signatureOf(node, sf)
    if (!sig) return
    const doc = docOf(node)
    local.set(name, { name, ...sig, ...doc })
  }
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) addDecl(st.name.text, st)
    else if (ts.isClassDeclaration(st) && st.name) addDecl(st.name.text, st)
    else if (ts.isInterfaceDeclaration(st)) addDecl(st.name.text, st)
    else if (ts.isTypeAliasDeclaration(st)) addDecl(st.name.text, st)
    else if (ts.isEnumDeclaration(st) && st.name) addDecl(st.name.text, st)
    else if (ts.isVariableStatement(st)) {
      const doc = docOf(st)
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue
        const sig = varSignature(d, sf)
        local.set(d.name.text, { name: d.name.text, ...sig, ...doc })
      }
    }
  }

  const isExported = (node: ts.Node) =>
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)

  // Pass 2: resolve what is actually EXPORTED.
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st)) {
      const spec =
        st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)
          ? st.moduleSpecifier.text
          : null
      const target = spec ? resolveRel(file, spec) : null
      const targetExports = target ? exportsOfFile(target, stack) : null
      if (!st.exportClause) {
        // `export * from './x'`
        if (targetExports) for (const [k, v] of targetExports) out.set(k, v)
        continue
      }
      if (ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) {
          const localName = (el.propertyName ?? el.name).text
          const exportedName = el.name.text
          const found = targetExports ? targetExports.get(localName) : local.get(localName)
          if (found) out.set(exportedName, { ...found, name: exportedName })
          else
            out.set(exportedName, {
              name: exportedName,
              kind: st.isTypeOnly || el.isTypeOnly ? 'type' : 'const',
              signature: `${st.isTypeOnly || el.isTypeOnly ? 'type' : 'const'} ${exportedName}`,
              summary: '',
            })
        }
      }
      continue
    }
    // Directly-exported declarations.
    if (isExported(st) && !ts.isExportAssignment(st)) {
      if (ts.isFunctionDeclaration(st) && st.name && local.has(st.name.text))
        out.set(st.name.text, local.get(st.name.text)!)
      else if (ts.isClassDeclaration(st) && st.name && local.has(st.name.text))
        out.set(st.name.text, local.get(st.name.text)!)
      else if (ts.isInterfaceDeclaration(st) && local.has(st.name.text))
        out.set(st.name.text, local.get(st.name.text)!)
      else if (ts.isTypeAliasDeclaration(st) && local.has(st.name.text))
        out.set(st.name.text, local.get(st.name.text)!)
      else if (ts.isEnumDeclaration(st) && st.name && local.has(st.name.text))
        out.set(st.name.text, local.get(st.name.text)!)
      else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && local.has(d.name.text))
            out.set(d.name.text, local.get(d.name.text)!)
        }
      }
    }
  }
  return out
}

/**
 * Every `src/**` file whose basename matches the export target's, nearest
 * first. See the call site in `entryFiles` for why: a subpath's source does not
 * always live at the path the export name implies.
 *
 * Returns paths RELATIVE to the package dir, matching the other candidates'
 * shape. Ordered by directory depth so a top-level `src/x.ts` beats a nested
 * `src/a/b/x.ts`, and `index.ts` files are skipped (a directory's rolled-up
 * entry is already covered by the `srcFile/index.ts` candidate above).
 */
function srcByBasename(dir: string, target: string): string[] {
  const want = basename(target)
    .replace(/\.d\.ts$/, '')
    .replace(/\.(ts|js)$/, '')
  const srcRoot = join(dir, 'src')
  if (!existsSync(srcRoot)) return []
  const hits: string[] = []
  const walk = (d: string, depth: number): void => {
    if (depth > 4) return
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name)
      if (e.isDirectory()) walk(full, depth + 1)
      else if (e.isFile() && e.name === `${want}.ts`) hits.push(full)
    }
  }
  try {
    walk(srcRoot, 0)
  } catch {
    return []
  }
  return hits.sort((a, b) => a.split(sep).length - b.split(sep).length).map((h) => relative(dir, h))
}

/** Resolve a package's entry source files from its package.json `exports`/`types`. */
function entryFiles(dir: string): string[] {
  const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const targets = new Set<string>()
  const walk = (v: unknown) => {
    if (typeof v === 'string') targets.add(v)
    else if (v && typeof v === 'object') {
      for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
        if (k === 'types' || k === 'import' || k === 'default' || k.startsWith('.')) walk(vv)
      }
    }
  }
  walk(pj.exports)
  if (pj.types) targets.add(pj.types)
  if (pj.main) targets.add(pj.main)

  const files: string[] = []
  for (const t of targets) {
    if (!/\.(ts|js)$/.test(t)) continue
    const srcFile = t
      .replace('/dist/', '/src/')
      .replace(/\.d\.ts$/, '.ts')
      .replace(/\.js$/, '.ts')
    const cands = [
      srcFile,
      // A subpath export's dist target is often a directory's rolled-up entry
      // (`dist/useAsync.js` ← `src/useAsync/index.ts`), not a same-named file —
      // e.g. every one of @aihu/use's ~30 composables. Without this candidate
      // entryFiles falls through straight to the `dist/*.d.ts` fallback below,
      // which needs a build and (being already-typed .d.ts) loses JSDoc
      // summaries — confirmed against packages/use: 113 of 114 exports came
      // back with an empty summary and most signatures untyped until this
      // candidate was added.
      srcFile.replace(/\.ts$/, '/index.ts'),
      t
        .replace('/dist/', '/js/')
        .replace(/\.d\.ts$/, '.ts')
        .replace(/\.js$/, '.ts'),
      // Same basename anywhere under `src/`. A subpath's source does not
      // always sit at the path the export name implies: `@aihu/primitives`
      // exports `./focus-trap` from `src/dialog/focus-trap.ts`, because the
      // trap started as a dialog internal and was promoted to its own subpath
      // without moving the file. Neither candidate above finds it, so
      // resolution fell through to `dist/focus-trap.js` — whose signatures are
      // COMPILED, i.e. stripped of types: `createFocusTrap(container, options
      // = {})` instead of `(container: Element, options: FocusTrapOptions =
      // {}): FocusTrap`. Silent degradation, and it re-degrades on every
      // regeneration, so the committed sheet and a fresh run disagree forever.
      ...srcByBasename(dir, t),
      t, // built dist/*.d.ts fallback (e.g. `.aihu`-only packages once built)
    ]
    for (const c of cands) {
      const p = resolve(dir, c)
      if (existsSync(p)) {
        files.push(p)
        break
      }
    }
  }
  return [...new Set(files)]
}

/** `exports` subpath keys as a component list — the deterministic `.aihu`-package fallback. */
function subpathComponents(dir: string): Entry[] {
  const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const exp = (pj.exports ?? {}) as Record<string, unknown>
  const out: Entry[] = []
  for (const key of Object.keys(exp)) {
    if (key === '.' || !key.startsWith('./')) continue
    if (key.endsWith('.json') || key.endsWith('.css')) continue
    const name = key.slice(2)
    out.push({
      name,
      kind: 'component',
      signature: `import '${pj.name}/${name}'`,
      summary: '',
    })
  }
  return out
}

/** Extract, classify, and stable-sort a package's public exports. */
function extractPackage(inv: InvEntry): Entry[] {
  const dir = join(REPO, inv.dir)
  fileCache.clear()
  const merged = new Map<string, Entry>()
  for (const f of entryFiles(dir)) {
    for (const [k, v] of exportsOfFile(f, new Set())) merged.set(k, v)
  }
  let list = [...merged.values()]
  if (list.length === 0) {
    // No TS entry resolved — try the `.aihu`-component subpath fallback.
    list = subpathComponents(dir)
  }
  const slug = slugFor(inv.name)
  const tier = TIER_BY_SLUG[slug]
  const agentTier = tier ? AGENT_TIERS.has(tier) : false
  for (const e of list) {
    e.agent = agentTier || AGENT_RE.test(e.name) || (!!e.summary && AGENT_RE.test(e.summary))
  }
  // Values first (function, const, class, component), then types — each A→Z.
  const order: Record<Kind, number> = {
    function: 0,
    const: 1,
    class: 2,
    component: 3,
    interface: 4,
    type: 5,
    enum: 6,
  }
  return list.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------
// emit
// ---------------------------------------------------------------------------
const jsStr = (s: string) => JSON.stringify(s)

function dataModule(inv: InvEntry, exps: Entry[], tagline: string, note: string): string {
  const slug = slugFor(inv.name)
  const tier = TIER_BY_SLUG[slug] ?? 'Plugins'
  const rows = exps
    .map((e) => {
      const lines = [`    name: ${jsStr(e.name)},`, `    kind: ${jsStr(e.kind)},`]
      lines.push(`    signature: ${jsStr(e.signature)},`)
      lines.push(`    summary: ${jsStr(e.summary)},`)
      if (e.since) lines.push(`    since: ${jsStr(e.since)},`)
      if (e.deprecated) lines.push('    deprecated: true,')
      if (e.agent) lines.push('    agent: true,')
      return `  {\n${lines.join('\n')}\n  },`
    })
    .join('\n')
  return `// GENERATED by scripts/gen-api.ts — do not edit. Source: ${inv.dir}
import type { ApiExport, ApiPackage } from '../types.ts'

export const PKG: ApiPackage = {
  name: ${jsStr(inv.name)},
  slug: ${jsStr(slug)},
  tier: ${jsStr(tier)},
  version: ${jsStr(inv.version)},
  tagline: ${jsStr(tagline)},
  note: ${jsStr(note)},
}

export const EXPORTS: readonly ApiExport[] = [
${rows}
]
`
}

function indexModule(rows: string[]): string {
  return `// GENERATED by scripts/gen-api.ts — do not edit.
import type { ApiPackageMeta } from '../types.ts'

/** Tier grouping order for the API index. */
export const TIERS = [
${TIERS.map((t) => `  ${jsStr(t)},`).join('\n')}
] as const

export const PACKAGES: readonly ApiPackageMeta[] = [
${rows.join('\n')}
]
`
}

function pageFile(inv: InvEntry, slug: string, tagline: string): string {
  const title = `${inv.name} — API Reference — aihu`
  const desc = tagline.replace(/\n/g, ' ')
  return `@route {
  path: "/api/${slug}",
  name: "api-${slug}",
  layout: "docs",
  head: {
    title: ${jsStr(title)},
    description: ${jsStr(desc)},
    canonical: "/api/${slug}"
  }
}

@state {
  // GENERATED by scripts/gen-api.ts — do not edit. Datasheet page for ${inv.name}.
  // Per-export signatures render as plain interpolated <pre><code> text, so they
  // land in the DOM-free __ssrString and ship as real static HTML for agents.
  import { EXPORTS, PKG } from '../../data/api/generated/${slug}.ts'

  const pkg = PKG
  const values = EXPORTS.filter((e) => e.kind !== 'interface' && e.kind !== 'type' && e.kind !== 'enum')
  const types = EXPORTS.filter((e) => e.kind === 'interface' || e.kind === 'type' || e.kind === 'enum')
  const hasExports = EXPORTS.length > 0

  const items = EXPORTS.map((e, i) => ({
    name: e.name,
    kind: e.kind,
    summary: e.summary,
    signature: e.signature,
    agent: !!e.agent,
    since: e.since ?? '',
    hasSince: !!e.since,
    hasSummary: !!e.summary,
    num: String(i + 1).padStart(2, '0'),
  }))
}

@template {
  <div class="dn-api dn-article">
    <p class="dn-breadcrumb dn-rail"><a href="/api">API</a> / {pkg.name}</p>

    <header class="dn-api-head">
      <div class="dn-api-titles">
        <h1 class="dn-api-pkg">{pkg.name}</h1>
        <span class="dn-status dn-status-graphite dn-api-badge">
          <span class="dn-dot dn-dot-graphite"></span>{pkg.tier}
        </span>
      </div>
      <p class="dn-api-tagline">{pkg.tagline}</p>
      <dl class="dn-api-spec">
        <div><dt>version</dt><dd class="dn-num">{pkg.version}</dd></div>
        <div><dt>exports</dt><dd class="dn-num">{items.length}</dd></div>
        <div><dt>values</dt><dd class="dn-num">{values.length}</dd></div>
        <div><dt>types</dt><dd class="dn-num">{types.length}</dd></div>
      </dl>
    </header>

    <p class="dn-api-empty" if={!hasExports}>{pkg.note}</p>

    <section class="dn-api-export" each={it of items} key={it.name}>
      <div class="dn-api-export-head">
        <span class="dn-rail dn-api-export-num">{it.num}</span>
        <h2 id={it.name} class="dn-api-export-name"><code>{it.name}</code></h2>
        <span class="dn-chip dn-api-kind">{it.kind}</span>
        <span class="dn-chip dn-chip-expose dn-api-agent" if={it.agent}>
          <span class="dn-dot dn-dot-graphite"></span>agent
        </span>
        <span class="dn-chip dn-api-since" if={it.hasSince}>since {it.since}</span>
      </div>
      <pre class="dn-api-sig"><code>{it.signature}</code></pre>
      <p class="dn-api-summary" if={it.hasSummary}>{it.summary}</p>
    </section>
  </div>
}
`
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------
function collectTagline(dir: string, fallback: string): string {
  const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const d = typeof pj.description === 'string' ? pj.description.trim() : ''
  return d || fallback
}

/**
 * Normalize a generated `.ts` module through biome's formatter (via stdin, no
 * disk writes) so the committed artifact is byte-identical to `biome ci` output
 * — and so `--check` compares against that same canonical form deterministically.
 */
function biomeFormat(content: string, filename: string): string {
  try {
    return execFileSync(BIOME_BIN, ['format', `--stdin-file-path=${filename}`], {
      input: content,
      encoding: 'utf8',
    })
  } catch {
    return content
  }
}

function writeArtifact(): { files: Map<string, string>; stats: string[] } {
  const files = new Map<string, string>()
  const stats: string[] = []
  const metaRows: string[] = []
  let totalExports = 0

  for (const inv of documentable()) {
    const slug = slugFor(inv.name)
    const dir = join(REPO, inv.dir)
    const tagline = collectTagline(dir, `${inv.name} — part of the aihu framework.`)
    const exps = extractPackage(inv)
    const tier = TIER_BY_SLUG[slug] ?? 'Plugins'
    const values = exps.filter(
      (e) => e.kind !== 'interface' && e.kind !== 'type' && e.kind !== 'enum',
    ).length
    const types = exps.length - values
    const agent = AGENT_TIERS.has(tier as Tier) || exps.some((e) => e.agent)
    const note =
      exps.length === 0
        ? `${inv.name} exposes no importable API — it is a CLI / editor-tooling package. See its README.`
        : ''

    const dataPath = join(DATA_DIR, `${slug}.ts`)
    files.set(dataPath, biomeFormat(dataModule(inv, exps, tagline, note), dataPath))
    // Every package EXCEPT the hand-authored signals exemplar gets a generated page.
    if (slug !== EXEMPLAR_SLUG) {
      files.set(join(PAGES_DIR, `${slug}.aihu`), pageFile(inv, slug, tagline))
    }

    metaRows.push(
      [
        '  {',
        `    name: ${jsStr(inv.name)},`,
        `    slug: ${jsStr(slug)},`,
        `    tier: ${jsStr(tier)},`,
        `    version: ${jsStr(inv.version)},`,
        `    tagline: ${jsStr(tagline)},`,
        `    note: ${jsStr(note)},`,
        `    exportCount: ${exps.length},`,
        `    valueCount: ${values},`,
        `    typeCount: ${types},`,
        `    agent: ${agent},`,
        '  },',
      ].join('\n'),
    )
    totalExports += exps.length
    stats.push(`${inv.name}: ${exps.length}`)
  }

  const indexPath = join(DATA_DIR, 'index.ts')
  files.set(indexPath, biomeFormat(indexModule(metaRows), indexPath))
  stats.unshift(`TOTAL packages=${documentable().length} exports=${totalExports}`)
  return { files, stats }
}

const { files, stats } = writeArtifact()

if (CHECK) {
  let drift = 0
  for (const [path, content] of files) {
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null
    if (current !== content) {
      console.error(`DRIFT: ${relative(REPO, path)}`)
      drift++
    }
  }
  if (drift > 0) {
    console.error(`\ngen-api --check failed: ${drift} file(s) stale. Run: bun scripts/gen-api.ts`)
    process.exit(1)
  }
  console.log(`gen-api --check ok — ${files.size} generated files up to date.`)
} else {
  // Rewrite generated dirs cleanly so removed packages don't leave orphans.
  mkdirSync(DATA_DIR, { recursive: true })
  for (const f of readdirSync(DATA_DIR)) {
    if (f.endsWith('.ts')) rmSync(join(DATA_DIR, f))
  }
  for (const f of readdirSync(PAGES_DIR)) {
    // Remove previously-generated pages (all except the hand-authored ones).
    if (f.endsWith('.aihu') && !HAND_AUTHORED_PAGES.has(f)) rmSync(join(PAGES_DIR, f))
  }
  for (const [path, content] of files) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
  console.log(`gen-api: wrote ${files.size} files.`)
  for (const line of stats) console.log(`  ${line}`)
}
