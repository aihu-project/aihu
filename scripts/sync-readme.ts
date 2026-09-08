#!/usr/bin/env bun
/**
 * sync-readme.ts — regenerate marker-bounded sections of README.md and every
 * packages/**\/README.md from canonical sources.
 *
 * Canonical sources (root README):
 *   - aihu-dom package release data                         → performance link
 *   - .size-limit.json + rolldown bundling              → bundle-size table
 *   - examples/* / package.json + README.md             → examples table
 *   - packages/* / package.json                         → packages list
 *   - docs/roadmap/*.md + docs/superpowers/specs/*.md   → reference list
 *
 * Per-package READMEs:
 *   - packages/* / package.json                         → name, version, description, exports, deps
 *   - .size-limit.json                                  → size if applicable
 *   - PACKAGE_TIERS map (below)                         → tier-aware "see also" links
 *
 * Usage:
 *   bun scripts/sync-readme.ts            # regenerate (writes if changed)
 *   bun scripts/sync-readme.ts --check    # exit 1 if any file would change (CI)
 *
 * Pre-commit + CI ensure the README + per-package READMEs never drift.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { gzipSync } from 'node:zlib'
import { Glob } from 'bun'

// NOTE: `rolldown` is NOT imported statically. It is loaded lazily inside
// `measureSizes()` (the only caller), so `--check` — which reads the committed
// scripts/__bundle-sizes.json cache and never measures — does not need the
// bundler on the module graph. That decoupling lets the always-on CI
// readme-sync job run cheaply with no `bun install` (C-FEL-READMESYNC-JOB;
// the coupling was accidental — a static import at the top of a two-mode file).

const REPO_ROOT = process.cwd()
const CHECK_MODE = process.argv.includes('--check')
/**
 * Re-measure bundle sizes with rolldown instead of reading the committed
 * `__bundle-sizes.json`. Requires a BUILT tree; refuses rather than recording
 * absent measurements. Run via `bun run readme:remeasure` (FEL-418).
 *
 * Refreshing the numbers is deliberate by design. It used to happen as a side
 * effect of whichever mode ran, which is how an unbuilt release-PR tree came to
 * overwrite real numbers with `_no dist_`. Note the size GATE is unaffected —
 * `bun run size` reads `.size-limit.json` independently, so budget violations
 * are still caught whether or not this cache is current.
 */
const REMEASURE = process.argv.includes('--remeasure')

interface SectionResult {
  key: string
  body: string
  versionStamp?: string // e.g. "@aihu/signals@0.1.0"
}

// ---------------------------------------------------------------------------
// Marker helpers
// ---------------------------------------------------------------------------

function replaceMarker(source: string, key: string, body: string, versionStamp?: string): string {
  const begin = `<!-- BEGIN_AUTOGEN: ${key} -->`
  const end = `<!-- END_AUTOGEN: ${key} -->`
  const beginIdx = source.indexOf(begin)
  const endIdx = source.indexOf(end)
  if (beginIdx === -1 || endIdx === -1) {
    return source // marker absent — silently skip; per-package may not have every section
  }
  const note = `<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->`
  const stamp = versionStamp
    ? `\n<sub><i>Auto-generated against ${versionStamp}.</i></sub>\n`
    : `\n<sub><i>Auto-generated — run \`bun scripts/sync-readme.ts\` to update.</i></sub>\n`
  const replacement = `${begin}\n${note}\n\n${body.trim()}\n${stamp}\n${end}`
  return `${source.slice(0, beginIdx)}${replacement}${source.slice(endIdx + end.length)}`
}

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

function genPerformanceSection(): SectionResult {
  return {
    key: 'performance',
    body: [
      'The independent DOM engine packages — `@aihu/signals`, `@aihu/reactive`, `@aihu/arbor`, and the `@aihu/dom` facade — now live in [aihu-dom](https://github.com/aihu-project/aihu-dom).',
      '',
      'Its manually triggered workflow runs package-focused deterministic update counts and optional timing measurements. Keeping those checks with the engine prevents a framework, documentation, or demo edit from rebuilding the whole benchmark harness.',
    ].join('\n'),
  }
}

// ---------------------------------------------------------------------------
// Bundle sizes — read .size-limit.json, bundle each entry, gzip
// ---------------------------------------------------------------------------

interface SizeEntry {
  name: string
  path: string
  limit: string
  gzip?: boolean
  ignore?: string[]
}

function parseBytes(limit: string): number {
  const m = limit.trim().match(/^(\d+(?:\.\d+)?)\s*(B|kB|KB)$/)
  if (!m) throw new Error(`Cannot parse limit "${limit}"`)
  return m[2] === 'B' ? parseFloat(m[1]) : parseFloat(m[1]) * 1024
}

function fmtBytes(n: number): string {
  return n < 1024 ? `${Math.round(n)} B` : `${(n / 1024).toFixed(2)} kB`
}

/**
 * Walk UP from `entryPath`'s directory to find the nearest `package.json` —
 * see `scripts/size.ts`'s identical `peerDepsOf` for the full rationale. A
 * fixed `dirname(entryPath)/../package.json` hop resolves correctly for a
 * flat entry but silently breaks for a nested family entry
 * (`packages/use/dist/math/useClamp.js`), leaving its declared peers
 * un-externalized. Keep this copy in sync with `scripts/size.ts`'s.
 */
async function peerDepsOf(entryPath: string): Promise<string[]> {
  let dir = dirname(entryPath)
  for (let i = 0; i < 6; i++) {
    const pkgPath = join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
        return Object.keys(pkg.peerDependencies ?? {})
      } catch {
        return []
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return []
}

async function measureSizes(): Promise<
  Array<{ name: string; bytes: number; limit: string; ok: boolean }>
> {
  // Lazy-load `rolldown` — the ONLY place the bundler is needed (the measure
  // path). Loaded OUTSIDE the per-entry try/catch below (which is for a single
  // entry failing to bundle) so a MISSING rolldown FAILS LOUDLY here — an
  // aborting throw with a clear cause — rather than being swallowed into a
  // silent `bytes: -1` no-op for every entry. A measurement that quietly
  // becomes "absent" is the exact absent-value failure this repo has a lesson
  // about; a dynamic import in a swallowing try/catch is how it sneaks in.
  const { rolldown } = await import('rolldown').catch((cause: unknown) => {
    throw new Error(
      'sync-readme: measuring bundle sizes needs the `rolldown` dev dependency, which is not ' +
        'installed. Run `bun install` on a built tree, or use `--check` (which reads the committed ' +
        'scripts/__bundle-sizes.json cache and needs no bundler).',
      { cause },
    )
  })
  const entries: SizeEntry[] = JSON.parse(readFileSync(join(REPO_ROOT, '.size-limit.json'), 'utf8'))
  const out: Array<{ name: string; bytes: number; limit: string; ok: boolean }> = []
  for (const entry of entries) {
    const peerDeps = await peerDepsOf(entry.path)
    const external = [...new Set([...(entry.ignore ?? []), ...peerDeps])]
    if (!existsSync(join(REPO_ROOT, entry.path))) {
      out.push({ name: entry.name, bytes: -1, limit: entry.limit, ok: false })
      continue
    }
    try {
      const bundle = await rolldown({ input: entry.path, external, platform: 'browser' })
      const { output } = await bundle.generate({ format: 'esm', minify: true })
      await bundle.close()
      const chunk = output.find((c) => c.type === 'chunk') as { code?: string } | undefined
      const code = chunk?.code ?? ''
      const raw = Buffer.from(code)
      const bytes = entry.gzip !== false ? gzipSync(raw).length : raw.length
      const ok = bytes <= parseBytes(entry.limit)
      out.push({ name: entry.name, bytes, limit: entry.limit, ok })
    } catch {
      out.push({ name: entry.name, bytes: -1, limit: entry.limit, ok: false })
    }
  }
  return out
}

/**
 * `@aihu/use` grows a `.size-limit.json` row per composable — 24 CORE rows
 * today, ~40 after namespace-wave0, ~170 by wave 12 (one per family member,
 * per families.json's per-composable-entry model). `sync-readme --check` is
 * the real landing gate, so a one-line-per-row README would turn every wave
 * into a 100+-line diff. Collapse:
 *   - every CORE composable row (`@aihu/use/<name>`, no further slash, `name`
 *     not `shared` and not a declared family name) into ONE summary line.
 *   - every FAMILY MEMBER row (`@aihu/use/<family>/<name>`) into one summary
 *     line PER family (this is where the wave-12 growth actually happens).
 * Left as explicit, individual lines (never collapsed): `.` / `@aihu/use`
 * itself, `@aihu/use/shared`, and every family AGGREGATE row
 * (`@aihu/use/<family>`, bare) — there is at most one aggregate row per
 * family, so it never becomes a diff-growth problem.
 */
function loadUseFamilyNames(): Set<string> {
  const path = join(REPO_ROOT, 'packages/use/families.json')
  if (!existsSync(path)) return new Set()
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { families?: Record<string, unknown> }
    return new Set(Object.keys(parsed.families ?? {}))
  } catch {
    return new Set()
  }
}

function summarizeGroup(
  label: string,
  group: Array<{ name: string; bytes: number; limit: string; ok: boolean }>,
): string {
  const measured = group.filter((m) => m.bytes >= 0).map((m) => m.bytes)
  const size =
    measured.length > 0
      ? measured.length > 1 && Math.min(...measured) !== Math.max(...measured)
        ? `${fmtBytes(Math.min(...measured))} – ${fmtBytes(Math.max(...measured))}`
        : fmtBytes(measured[0] ?? 0)
      : '—'
  const limits = [...new Set(group.map((m) => m.limit))]
  const limit = limits.length > 1 ? `${limits.length} distinct limits` : (limits[0] ?? '—')
  const status = group.every((m) => m.ok)
    ? 'pass'
    : group.some((m) => m.bytes < 0)
      ? '_no dist_'
      : 'OVER'
  return `| \`${label}\` (${group.length} composable${group.length === 1 ? '' : 's'}) | ${size} | ${limit} | ${status} |`
}

async function genBundleSizesSection(
  measurements: Array<{ name: string; bytes: number; limit: string; ok: boolean }>,
): Promise<SectionResult> {
  const families = loadUseFamilyNames()
  const prefix = '@aihu/use/'

  const coreGroup: typeof measurements = []
  const familyGroups = new Map<string, typeof measurements>()
  const individual: typeof measurements = []

  for (const m of measurements) {
    if (m.name.startsWith(prefix)) {
      const rest = m.name.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash === -1) {
        // Bare: 'shared' or a family aggregate stay individual; every other
        // bare name is a CORE composable, collapsed.
        if (rest === 'shared' || families.has(rest)) {
          individual.push(m)
        } else {
          coreGroup.push(m)
        }
        continue
      }
      // `<family>/<member>` — grouped per family.
      const family = rest.slice(0, slash)
      const group = familyGroups.get(family) ?? []
      group.push(m)
      familyGroups.set(family, group)
      continue
    }
    individual.push(m)
  }

  const lines: string[] = []
  lines.push(`| Package | Size (gz) | Limit | Status |`)
  lines.push(`|---|---:|---:|:---:|`)
  for (const m of individual) {
    const size = m.bytes >= 0 ? fmtBytes(m.bytes) : '—'
    const status = m.bytes < 0 ? '_no dist_' : m.ok ? 'pass' : 'OVER'
    lines.push(`| \`${m.name}\` | ${size} | ${m.limit} | ${status} |`)
  }
  if (coreGroup.length > 0) {
    lines.push(summarizeGroup('@aihu/use', coreGroup))
  }
  for (const [family, group] of [...familyGroups.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    lines.push(summarizeGroup(`@aihu/use/${family}`, group))
  }
  return { key: 'bundle-sizes', body: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// Examples — scrape examples/* / package.json + README.md tagline
// ---------------------------------------------------------------------------

function firstPara(md: string): string {
  const lines = md.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()
    if (line.startsWith('#') || line.startsWith('>') || line === '' || line.startsWith('---')) {
      i++
      continue
    }
    const para: string[] = [lines[i]]
    let j = i + 1
    while (j < lines.length && lines[j].trim() !== '' && !lines[j].trim().startsWith('#')) {
      para.push(lines[j])
      j++
    }
    return para.join(' ').replace(/\s+/g, ' ').trim()
  }
  return ''
}

function extractWhatThisTeaches(md: string): string {
  const m = md.match(/\*\*What this teaches:?\*\*\s*([^\n]+)/i)
  if (m) return m[1].trim()
  return firstPara(md).slice(0, 220)
}

function extractPort(pkgJson: { scripts?: { dev?: string } }): string {
  const dev = pkgJson?.scripts?.dev ?? ''
  const m = dev.match(/--port\s+(\d+)/)
  return m ? m[1] : '—'
}

function genExamplesSection(): SectionResult {
  const lines: string[] = []
  lines.push(`| # | Folder | What it teaches | Port |`)
  lines.push(`|---|---|---|---|`)
  const glob = new Glob('examples/*/package.json')
  const all: Array<{ folder: string; name: string; teaches: string; port: string }> = []
  for (const rawPath of glob.scanSync(REPO_ROOT)) {
    const path = rawPath.replace(/\\/g, '/')
    if (path.includes('_shared') || path.includes('archived')) continue
    const dir = dirname(path)
    const folder = dir.replace(/^examples\//, '')
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, path), 'utf8'))
    const readmePath = join(REPO_ROOT, dir, 'README.md')
    let teaches = ''
    if (existsSync(readmePath)) {
      teaches = extractWhatThisTeaches(readFileSync(readmePath, 'utf8'))
    }
    const port = extractPort(pkg)
    all.push({ folder, name: pkg.name, teaches, port })
  }
  all.sort((a, b) => a.folder.localeCompare(b.folder))
  let i = 1
  for (const ex of all) {
    const link = `[\`${ex.folder}/\`](./examples/${ex.folder})`
    const teaches =
      ex.teaches.length > 140 ? `${ex.teaches.slice(0, 137)}...` : ex.teaches || '_no README_'
    lines.push(`| ${String(i).padStart(2, '0')} | ${link} | ${teaches} | ${ex.port} |`)
    i++
  }
  return { key: 'examples', body: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// Packages list — scrape packages/*/package.json
// ---------------------------------------------------------------------------

interface PkgInfo {
  dir: string // packages/foo or packages/server/npm/darwin-arm64
  name: string
  version: string
  description: string
  pkg: Record<string, unknown> & {
    name?: string
    version?: string
    description?: string
    dependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
    exports?: unknown
    main?: string
    module?: string
    files?: string[]
    license?: string
    scripts?: Record<string, string>
  }
  isPlatform: boolean
}

function discoverPackages(): PkgInfo[] {
  const out: PkgInfo[] = []
  const seen = new Set<string>()
  const glob1 = new Glob('packages/*/package.json')
  const glob2 = new Glob('packages/*/*/package.json')
  const glob3 = new Glob('packages/*/*/*/package.json')
  for (const g of [glob1, glob2, glob3]) {
    for (const rawRel of g.scanSync(REPO_ROOT)) {
      // Normalize path separators (Windows ships backslashes from bun glob/dirname)
      const rel = rawRel.replace(/\\/g, '/')
      if (
        rel.includes('node_modules') ||
        rel.includes('/dist/') ||
        rel.includes('/fixtures/') ||
        rel.includes('/legacy-snapshot.golden/') ||
        // wasm-pack build output (gitignored) generates pkg-wasm/package.json
        // locally; it is a build artifact,
        // not a workspace package, and CI (no local wasm build) would flag
        // any README/inventory row derived from it as drift (#491).
        rel.includes('/pkg-wasm/')
      )
        continue
      if (seen.has(rel)) continue
      seen.add(rel)
      const pkg = JSON.parse(readFileSync(join(REPO_ROOT, rel), 'utf8'))
      if (!pkg.name) continue
      const dir = dirname(rel)
      const isPlatform = dir.includes('/npm/')
      out.push({
        dir,
        name: pkg.name,
        version: pkg.version ?? '0.0.0',
        description: pkg.description ?? '',
        pkg,
        isPlatform,
      })
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

function genPackagesListSection(packages: PkgInfo[]): SectionResult {
  const lines: string[] = []
  lines.push(`| Package | Version | Description |`)
  lines.push(`|---|---|---|`)
  for (const p of packages) {
    if (p.isPlatform) continue
    lines.push(
      `| [\`${p.name}\`](./${p.dir}) | \`${p.version}\` | ${p.description || '_no description_'} |`,
    )
  }
  return { key: 'packages', body: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// Reference — scrape docs/roadmap/*.md + docs/superpowers/specs/*.md for H1
// ---------------------------------------------------------------------------

function firstH1(md: string): string {
  const m = md.match(/^#\s+(.+)$/m)
  return m ? m[1].trim() : ''
}

function genReferenceSection(): SectionResult {
  const lines: string[] = []
  lines.push(`#### Roadmap tracks`)
  lines.push('')
  const roadmapGlob = new Glob('docs/roadmap/arch-*.md')
  const archDocs: Array<{ file: string; title: string }> = []
  for (const rawRel of roadmapGlob.scanSync(REPO_ROOT)) {
    const rel = rawRel.replace(/\\/g, '/')
    archDocs.push({ file: rel, title: firstH1(readFileSync(join(REPO_ROOT, rel), 'utf8')) })
  }
  archDocs.sort((a, b) => a.file.localeCompare(b.file))
  for (const d of archDocs) {
    lines.push(`- [\`${d.file}\`](./${d.file}) — ${d.title}`)
  }
  lines.push('')
  lines.push(`#### Specs (ratified + RFC)`)
  lines.push('')
  const specGlob = new Glob('docs/superpowers/specs/*.md')
  const specs: Array<{ file: string; title: string; status: string }> = []
  for (const rawRel of specGlob.scanSync(REPO_ROOT)) {
    const rel = rawRel.replace(/\\/g, '/')
    if (rel.includes('applied-amendments')) continue
    const md = readFileSync(join(REPO_ROOT, rel), 'utf8')
    const title = firstH1(md)
    const statusM = md.match(/\*\*Status:\*\*\s*([^\n]+)/)
    const status = statusM ? statusM[1].trim().split(/[;.(]/)[0].trim() : ''
    specs.push({ file: rel, title, status })
  }
  specs.sort((a, b) => a.file.localeCompare(b.file))
  for (const d of specs) {
    const stamp = d.status ? ` _(${d.status})_` : ''
    lines.push(`- [\`${d.file}\`](./${d.file}) — ${d.title}${stamp}`)
  }
  return { key: 'reference', body: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// Per-package READMEs
// ---------------------------------------------------------------------------

type Tier = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'platform'

interface TierInfo {
  tier: Tier
  label: string
  seeAlso: Array<{ label: string; href: string }>
}

const PACKAGE_TIERS: Record<string, TierInfo> = {
  // Tier A — runtime core
  '@aihu/runtime': {
    tier: 'A',
    label: 'Reactive runtime core — custom-element wiring for compiled SFCs',
    seeAlso: [
      { label: 'Phase 4 spec (runtime)', href: '../../.team/phase-4/spec-runtime.md' },
      { label: '@aihu/arbor', href: 'https://github.com/aihu-project/aihu-dom' },
      { label: '@aihu/compiler', href: 'https://github.com/aihu-project/aihu-compiler' },
    ],
  },
  '@aihu/context': {
    tier: 'A',
    label: 'Reactive runtime core — async-context request primitives',
    seeAlso: [
      { label: '@aihu-plugin/data', href: '../plugin-data' },
      { label: '@aihu/server', href: '../server' },
    ],
  },
  // Tier B — meta-framework
  '@aihu/router': {
    tier: 'B',
    label: 'Meta-framework — file-based router',
    seeAlso: [
      { label: 'arch-1 (website)', href: '../../docs/roadmap/arch-1-website.md' },
      {
        label: 'Routing & layouts guide',
        href: 'https://aihu.dev/guides/routing-layouts',
      },
      { label: '@aihu/server', href: '../server' },
    ],
  },
  '@aihu/server': {
    tier: 'B',
    label: 'Meta-framework — SSR + native renderer (napi-rs)',
    seeAlso: [
      { label: 'arch-1 (website)', href: '../../docs/roadmap/arch-1-website.md' },
      {
        label: 'SSR & hydration guide',
        href: 'https://aihu.dev/guides/ssr-hydration',
      },
      { label: '@aihu/router', href: '../router' },
      { label: '@aihu-plugin/agent-readiness', href: '../plugin-agent-readiness' },
    ],
  },
  '@aihu-plugin/data': {
    tier: 'B',
    label: 'Meta-framework — reactive resources + loader protocol',
    seeAlso: [
      {
        label: 'Data-fetching guide',
        href: 'https://aihu.dev/guides/data-fetching',
      },
      { label: '@aihu/context', href: '../context' },
    ],
  },
  '@aihu/app': {
    tier: 'B',
    label: 'Meta-framework — top-level integration of runtime, router, adapter',
    seeAlso: [
      { label: 'arch-1 (website)', href: '../../docs/roadmap/arch-1-website.md' },
      { label: '@aihu/router', href: '../router' },
      { label: '@aihu/adapter-cloudflare', href: '../adapter-cloudflare' },
    ],
  },
  '@aihu/adapter-cloudflare': {
    tier: 'B',
    label: 'Meta-framework — Cloudflare Workers/Pages deploy adapter',
    seeAlso: [
      { label: '@aihu/app', href: '../app' },
      { label: '@aihu/server', href: '../server' },
    ],
  },
  '@aihu/adapter-vercel': {
    tier: 'B',
    label: 'Meta-framework — Vercel deploy adapter',
    seeAlso: [
      { label: '@aihu/app', href: '../app' },
      { label: '@aihu/server', href: '../server' },
    ],
  },
  // Tier C — agent surface
  '@aihu/agent': {
    tier: 'C',
    label: 'Agent surface — primitives (foundation of agent-readiness)',
    seeAlso: [
      { label: 'Phase 5 spec (agent)', href: '../../.team/phase-5/spec-agent.md' },
      {
        label: 'Plugin Contract spec',
        href: '../../docs/superpowers/specs/2026-05-02-spec-plugin-contract.md',
      },
      { label: '@aihu/agent-service', href: '../agent-service' },
    ],
  },
  '@aihu/agent-service': {
    tier: 'C',
    label: 'Agent surface — server-side execution + tool dispatch',
    seeAlso: [
      {
        label: 'Live-Binding RFC',
        href: '../../docs/superpowers/specs/2026-05-05-spec-live-binding.md',
      },
      { label: '@aihu/agent', href: '../agent' },
      { label: '@aihu/agent-a2a', href: '../agent-a2a' },
      { label: '@aihu/agent-acp', href: '../agent-acp' },
    ],
  },
  '@aihu/agent-a2a': {
    tier: 'C',
    label: 'Agent surface — A2A (Agent2Agent) protocol, spec v1.0.1 JSON-RPC binding',
    seeAlso: [
      { label: '@aihu/agent-service', href: '../agent-service' },
      { label: '@aihu/agent', href: '../agent' },
    ],
  },
  '@aihu/agent-acp': {
    tier: 'C',
    label: 'Agent surface — DEPRECATED; use @aihu/agent-a2a (ACP merged into A2A, Aug 2025)',
    seeAlso: [
      { label: '@aihu/agent-service', href: '../agent-service' },
      { label: '@aihu/agent', href: '../agent' },
    ],
  },
  '@aihu-plugin/agent-readiness': {
    tier: 'C',
    label: 'Agent surface — discovery manifests (llms.txt, MCP Server Card, robots)',
    seeAlso: [
      {
        label: 'Agent-Readiness spec',
        href: '../../.team/agent-readiness/spec-agent-readiness.md',
      },
      { label: '@aihu/server', href: '../server' },
    ],
  },
  '@aihu/mcp': {
    tier: 'C',
    label: 'Agent surface — MCP server (aihu_example cookbook retrieval + aihu_validate)',
    seeAlso: [
      { label: 'Cookbook corpus', href: '../../cookbook' },
      { label: '@aihu/agent', href: '../agent' },
      { label: '@aihu-plugin/agent-readiness', href: '../plugin-agent-readiness' },
    ],
  },
  // Tier D — compiler/cli
  '@aihu/compiler': {
    tier: 'D',
    label: 'Compiler — Single-File Component (.aihu) → Web Component',
    seeAlso: [
      {
        label: 'Block Structure spec',
        href: '../../docs/superpowers/specs/2026-05-02-spec-block-structure.md',
      },
      {
        label: 'Template Attribute Syntax spec',
        href: '../../docs/superpowers/specs/2026-05-02-spec-template-attribute-syntax.md',
      },
      {
        label: 'Macro Vocabulary spec',
        href: '../../docs/superpowers/specs/2026-05-02-spec-macro-vocabulary.md',
      },
    ],
  },
  '@aihu/cli': {
    tier: 'D',
    label: 'Toolchain — `aihu` / `create-aihu` CLI',
    seeAlso: [
      { label: 'docs/cli.md', href: '../../docs/cli.md' },
      { label: '@aihu/compiler', href: 'https://github.com/aihu-project/aihu-compiler' },
    ],
  },
  'create-aihu': {
    tier: 'D',
    label: 'Toolchain — `npm create aihu` scaffolder entry point',
    seeAlso: [
      { label: '@aihu/cli', href: '../cli' },
      { label: 'docs/cli.md', href: '../../docs/cli.md' },
    ],
  },
  '@aihu/css-engine': {
    tier: 'D',
    label: 'Compiler — CSS engine (Tailwind v4 hard fork, WC-native scoped output)',
    seeAlso: [
      {
        label: 'CSS Engine + Primitives design spec',
        href: '../../docs/superpowers/specs/2026-05-10-aihu-css-engine-and-primitives-design.md',
      },
      { label: '@aihu/compiler', href: 'https://github.com/aihu-project/aihu-compiler' },
    ],
  },
  // Tier E — held private
  '@aihu/plugin': {
    tier: 'E',
    label: 'Plugin substrate — runtime hook surface (held private until live-binding RATIFIES)',
    seeAlso: [
      {
        label: 'Plugin Contract spec',
        href: '../../docs/superpowers/specs/2026-05-02-spec-plugin-contract.md',
      },
      {
        label: 'Live-Binding RFC',
        href: '../../docs/superpowers/specs/2026-05-05-spec-live-binding.md',
      },
    ],
  },
  'vscode-aihu': {
    tier: 'E',
    label: 'Editor — VS Code extension (TextMate grammar + snippets; LSP in M2)',
    seeAlso: [{ label: 'arch-4 (DX tools)', href: '../../docs/roadmap/arch-4-dx-tools.md' }],
  },
  '@aihu/templates-cf-team': {
    tier: 'E',
    label: 'Starter — Cloudflare Workers + bun/moon monorepo team template',
    seeAlso: [
      { label: '@aihu/adapter-cloudflare', href: '../adapter-cloudflare' },
      { label: '@aihu/cli', href: '../cli' },
    ],
  },
  // Tier B — meta-framework (server / data capabilities)
  '@aihu/auth': {
    tier: 'B',
    label: 'Meta-framework — JWT scope checks, ScopeSignal, and server auth middleware',
    seeAlso: [
      { label: '@aihu/server', href: '../server' },
      { label: '@aihu/agent-service', href: '../agent-service' },
    ],
  },
  '@aihu/magna': {
    tier: 'B',
    label: 'Meta-framework — dep-free Magna GraphQL bridge (resources + JWT relay)',
    seeAlso: [
      { label: '@aihu-plugin/data', href: '../plugin-data' },
      { label: '@aihu/server', href: '../server' },
    ],
  },
  '@aihu-plugin/drizzle': {
    tier: 'B',
    label: 'Meta-framework — Drizzle ORM data adapter (typed resources + loaders)',
    seeAlso: [{ label: '@aihu-plugin/data', href: '../plugin-data' }],
  },
  // Tier C — agent surface (server glue + adapters)
  '@aihu/agent-server': {
    tier: 'C',
    label: 'Agent surface — server-mount + MCP live-dispatch bridge to a browser',
    seeAlso: [
      { label: '@aihu/agent-service', href: '../agent-service' },
      { label: '@aihu/mcp', href: '../mcp' },
    ],
  },
  '@aihu/ai': {
    tier: 'C',
    label: 'Agent surface — AI SDK stream adapters for `$stream` collections',
    seeAlso: [
      { label: '@aihu/agent', href: '../agent' },
      { label: '@aihu/mcp', href: '../mcp' },
    ],
  },
  '@aihu/seo': {
    tier: 'C',
    label: 'Agent surface — DEPRECATED shim over @aihu-plugin/agent-readiness',
    seeAlso: [{ label: '@aihu-plugin/agent-readiness', href: '../plugin-agent-readiness' }],
  },
  // Tier D — compiler / toolchain (type-checking + editor tooling)
  '@aihu/tsc': {
    tier: 'D',
    label: 'Toolchain — `aihu-tsc` type-checker for .aihu Single-File Components',
    seeAlso: [
      { label: '@aihu/compiler', href: 'https://github.com/aihu-project/aihu-compiler' },
      { label: '@aihu/language-server', href: '../language-server' },
    ],
  },
  '@aihu/language-server': {
    tier: 'D',
    label: 'Toolchain — cross-editor Language Server for .aihu SFCs',
    seeAlso: [
      { label: '@aihu/tsc', href: '../tsc' },
      { label: '@aihu/compiler', href: 'https://github.com/aihu-project/aihu-compiler' },
      { label: 'vscode-aihu', href: '../vscode-aihu' },
    ],
  },
  // Tier F — UI, styling & content rendering
  '@aihu/primitives': {
    tier: 'F',
    label: 'UI — headless WAI-ARIA APG behavior primitives (zero CSS)',
    seeAlso: [
      { label: '@aihu/css-engine', href: '../css-engine' },
      { label: '@aihu/ui', href: '../ui' },
    ],
  },
  '@aihu/ui': {
    tier: 'F',
    label: 'UI — styled-recipe registry distributed as source via `aihu add`',
    seeAlso: [
      { label: '@aihu/primitives', href: '../primitives' },
      { label: '@aihu/css-engine', href: '../css-engine' },
    ],
  },
  '@aihu-plugin/kindly-note': {
    tier: 'F',
    label: 'UI — runtime syntax highlighting + markdown custom elements',
    seeAlso: [{ label: '@aihu/ui', href: '../ui' }],
  },
  // Tier G — state & rich-content capabilities
  '@aihu/store': {
    tier: 'G',
    label: 'State — Pinia-style global stores on aihu signals (SSR-safe per-request)',
    seeAlso: [
      { label: '@aihu/signals', href: 'https://github.com/aihu-project/aihu-dom' },
      { label: '@aihu/context', href: '../context' },
    ],
  },
  '@aihu/editor': {
    tier: 'G',
    label: 'Content — GX-governed rich-text editor (JSON doc model + transactions)',
    seeAlso: [
      { label: '@aihu/agent', href: '../agent' },
      { label: '@aihu/store', href: '../store' },
    ],
  },
  '@aihu/use': {
    tier: 'G',
    label:
      'Composables — VueUse-style sensor/state/browser utilities on aihu signals (SSR-safe, per-composable entries)',
    seeAlso: [
      { label: '@aihu/signals', href: 'https://github.com/aihu-project/aihu-dom' },
      { label: '@aihu/primitives', href: '../primitives' },
    ],
  },
}

/**
 * Platform packages live under `packages/<parent>/npm/<platform>/` and are named
 * `@aihu/<parent>-<platform-triple>`. We ship two families today:
 *   - `@aihu/server-<triple>`     → native napi `.node` renderer addon.
 *   - `@aihu/css-engine-<triple>` → prebuilt `aihu-css-compile` CLI executable.
 *   - `@aihu/compiler-<triple>`   → prebuilt `aihu-compile` CLI executable.
 * Return the parent package name for a platform package, or null if not one.
 */
function platformParent(name: string): string | null {
  const m = name.match(/^(@aihu\/(?:server|css-engine|compiler))-[a-z0-9-]+$/)
  return m ? m[1] : null
}

function tierFor(name: string): TierInfo {
  if (PACKAGE_TIERS[name]) return PACKAGE_TIERS[name]
  const parent = platformParent(name)
  if (parent) {
    return {
      tier: 'platform',
      label: `Platform-specific native binary distributor for \`${parent}\``,
      seeAlso: [
        { label: parent, href: '../../README.md' },
        { label: 'Aihu framework root', href: '../../../../README.md' },
      ],
    }
  }
  return {
    tier: 'E',
    label: 'Held private (unmapped tier)',
    seeAlso: [],
  }
}

// Human-facing titles for the README "packages by tier" prose. Every non-platform
// tier a mapped package can carry MUST have a title here, or genPackagesByTierSection
// throws (exhaustiveness guard #1).
const TIER_TITLES: Record<Exclude<Tier, 'platform'>, string> = {
  A: 'Reactive runtime core (sized, ships to client)',
  B: 'Meta-framework — server, routing, data & adapters',
  C: 'Agent surface (built in, governed)',
  D: 'Compiler & toolchain (build-time)',
  E: 'Plugin substrate, editor & templates',
  F: 'UI, styling & content rendering',
  G: 'State & rich-content capabilities',
}

const TIER_ORDER: Array<Exclude<Tier, 'platform'>> = ['A', 'B', 'C', 'D', 'E', 'F', 'G']

/**
 * A package is eligible for the human-facing "packages by tier" prose when it is a
 * real, publishable workspace package: not a platform native-binary distributor,
 * not a `_moved/` redirect stub, and not `private`.
 */
function isTierProseEligible(p: PkgInfo): boolean {
  if (p.isPlatform) return false
  if (tierFor(p.name).tier === 'platform') return false
  if (p.dir.includes('/_moved/')) return false
  if (p.pkg.private === true) return false
  return true
}

/**
 * Emit the README `packages-by-tier` prose from the SAME discovery pass that builds
 * the Packages table + inventory, so the tier listing can never be partial again.
 *
 * Two guards make incompleteness a hard error:
 *   1. every eligible package MUST have an explicit PACKAGE_TIERS entry (no falling
 *      back to the `E — unmapped` default), and its tier MUST have a TIER_TITLES title;
 *   2. the emitted member count MUST equal the eligible package count (no orphans).
 */
function genPackagesByTierSection(packages: PkgInfo[]): SectionResult {
  const eligible = packages.filter(isTierProseEligible)

  const unmapped = eligible.filter((p) => !PACKAGE_TIERS[p.name]).map((p) => p.name)
  if (unmapped.length > 0) {
    throw new Error(
      `sync-readme: ${unmapped.length} publishable package(s) missing from PACKAGE_TIERS ` +
        `(add a tier so the README "packages by tier" prose stays complete): ${unmapped.join(', ')}`,
    )
  }

  const byTier = new Map<Exclude<Tier, 'platform'>, PkgInfo[]>()
  for (const p of eligible) {
    const ti = PACKAGE_TIERS[p.name]
    if (ti.tier === 'platform') continue // impossible for a mapped entry, but keep the type honest
    if (!TIER_TITLES[ti.tier]) {
      throw new Error(`sync-readme: tier '${ti.tier}' (${p.name}) has no TIER_TITLES entry`)
    }
    const arr = byTier.get(ti.tier) ?? []
    arr.push(p)
    byTier.set(ti.tier, arr)
  }

  const lines: string[] = []
  lines.push('See [`packages/`](./packages) for all packages on disk. By tier:')
  lines.push('')
  let emitted = 0
  for (const tier of TIER_ORDER) {
    const members = (byTier.get(tier) ?? []).sort((a, b) => a.name.localeCompare(b.name))
    if (members.length === 0) continue
    emitted += members.length
    const links = members.map((m) => `[\`${m.name}\`](./${m.dir})`).join(', ')
    lines.push(`- **${TIER_TITLES[tier]}:** ${links}.`)
  }

  if (emitted !== eligible.length) {
    throw new Error(
      `sync-readme: tier prose emitted ${emitted} packages but ${eligible.length} are eligible (orphan/tier mismatch)`,
    )
  }

  return { key: 'packages-by-tier', body: lines.join('\n') }
}

function genInstallSection(p: PkgInfo): SectionResult {
  const ti = tierFor(p.name)
  if (ti.tier === 'platform') {
    const parent = platformParent(p.name) ?? '@aihu/server'
    const lines: string[] = []
    lines.push(
      `This package is the platform-specific native binary distributor for [\`${parent}\`](../../README.md). You almost certainly do **not** need to install it directly — it is wired in as an \`optionalDependencies\` of \`${parent}\` and resolved automatically for the platform you are on.`,
    )
    lines.push('')
    lines.push(`**Current platform support matrix:**`)
    lines.push('')
    lines.push(`| Triple | npm package |`)
    lines.push(`|---|---|`)
    lines.push(`| \`darwin-arm64\` (Apple Silicon) | \`${parent}-darwin-arm64\` |`)
    lines.push(`| \`darwin-x64\` (Intel macOS) | \`${parent}-darwin-x64\` |`)
    lines.push(`| \`linux-x64-gnu\` (glibc Linux) | \`${parent}-linux-x64-gnu\` |`)
    lines.push(`| \`win32-x64-msvc\` (Windows) | \`${parent}-win32-x64-msvc\` |`)
    lines.push('')
    lines.push(`If you genuinely need to install only this package (e.g. for an offline mirror):`)
    lines.push('')
    lines.push('```bash')
    lines.push(`npm install ${p.name}`)
    lines.push(`# or`)
    lines.push(`bun add ${p.name}`)
    lines.push('```')
    return { key: 'install', body: lines.join('\n'), versionStamp: `\`${p.name}@${p.version}\`` }
  }
  const lines: string[] = []
  if (ti.tier === 'D' && p.name === '@aihu/cli') {
    lines.push('```bash')
    lines.push(`# Scaffold a new app`)
    lines.push(`bunx ${p.name} app my-app`)
    lines.push(`# Or install globally`)
    lines.push(`bun add -g ${p.name}`)
    lines.push('```')
  } else if (p.name === 'create-aihu') {
    lines.push('```bash')
    lines.push(`# Scaffold a new Aihu app (no install needed)`)
    lines.push(`npm create aihu@latest my-app`)
    lines.push(`# or`)
    lines.push(`npx create-aihu my-app`)
    lines.push(`# or`)
    lines.push(`bun create aihu my-app`)
    lines.push('```')
  } else if (ti.tier === 'E' && p.name === 'vscode-aihu') {
    lines.push(
      `Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=fellwork.vscode-aihu) (publishing as part of v1.1 LSP work).`,
    )
  } else {
    lines.push('```bash')
    lines.push(`npm install ${p.name}`)
    lines.push(`# or`)
    lines.push(`bun add ${p.name}`)
    lines.push('```')
  }
  return { key: 'install', body: lines.join('\n'), versionStamp: `\`${p.name}@${p.version}\`` }
}

function genStatsSection(
  p: PkgInfo,
  sizeMap: Map<string, { bytes: number; limit: string }>,
): SectionResult {
  const lines: string[] = []
  lines.push(`| | |`)
  lines.push(`|---|---|`)
  lines.push(`| **Version** | \`${p.version}\` |`)
  const ti = tierFor(p.name)
  lines.push(`| **Tier** | ${ti.tier} — ${ti.label} |`)
  const sz = sizeMap.get(p.name)
  if (sz && sz.bytes >= 0) {
    lines.push(`| **Bundle size** | ${fmtBytes(sz.bytes)} (gz) — limit ${sz.limit} |`)
  }
  if (Array.isArray(p.pkg.files)) {
    lines.push(`| **Published files** | ${p.pkg.files.length} entries |`)
  }
  if (p.pkg.license) {
    lines.push(`| **License** | ${p.pkg.license} |`)
  }
  return { key: 'stats', body: lines.join('\n'), versionStamp: `\`${p.name}@${p.version}\`` }
}

function genExportsSection(p: PkgInfo): SectionResult {
  const lines: string[] = []
  const exp = p.pkg.exports
  if (!exp) {
    lines.push(
      `_No \`exports\` field in \`package.json\`. Main entry: \`${p.pkg.main ?? p.pkg.module ?? 'unset'}\`._`,
    )
  } else if (typeof exp === 'string') {
    lines.push(`Default export: \`${exp}\`.`)
  } else {
    lines.push(`| Subpath | ESM | CJS |`)
    lines.push(`|---|---|---|`)
    for (const [subpath, val] of Object.entries(exp as Record<string, unknown>)) {
      if (typeof val === 'string') {
        lines.push(`| \`${subpath}\` | \`${val}\` | — |`)
        continue
      }
      const v = val as Record<string, unknown>
      const imp = v.import as unknown
      const req = v.require as unknown
      const impStr =
        typeof imp === 'string'
          ? imp
          : typeof imp === 'object' && imp !== null
            ? (((imp as Record<string, unknown>).default as string) ?? '—')
            : '—'
      const reqStr =
        typeof req === 'string'
          ? req
          : typeof req === 'object' && req !== null
            ? (((req as Record<string, unknown>).default as string) ?? '—')
            : '—'
      lines.push(`| \`${subpath}\` | \`${impStr}\` | \`${reqStr}\` |`)
    }
  }
  return { key: 'exports', body: lines.join('\n'), versionStamp: `\`${p.name}@${p.version}\`` }
}

function genDepsSection(p: PkgInfo): SectionResult {
  const lines: string[] = []
  const deps = p.pkg.dependencies ?? {}
  const peerDeps = p.pkg.peerDependencies ?? {}
  const optDeps = p.pkg.optionalDependencies ?? {}

  if (
    Object.keys(deps).length === 0 &&
    Object.keys(peerDeps).length === 0 &&
    Object.keys(optDeps).length === 0
  ) {
    lines.push(
      `_Zero runtime dependencies_ (per the [dep-free thesis](../../README.md#project-posture))_._`,
    )
    return { key: 'deps', body: lines.join('\n'), versionStamp: `\`${p.name}@${p.version}\`` }
  }
  if (Object.keys(deps).length > 0) {
    lines.push(`**Dependencies:**`)
    lines.push('')
    for (const [k, v] of Object.entries(deps)) {
      lines.push(`- \`${k}\` — \`${v}\``)
    }
    lines.push('')
  }
  if (Object.keys(peerDeps).length > 0) {
    lines.push(`**Peer dependencies:**`)
    lines.push('')
    for (const [k, v] of Object.entries(peerDeps)) {
      lines.push(`- \`${k}\` — \`${v}\``)
    }
    lines.push('')
  }
  if (Object.keys(optDeps).length > 0) {
    lines.push(`**Optional dependencies (platform-specific):**`)
    lines.push('')
    for (const [k, v] of Object.entries(optDeps)) {
      lines.push(`- \`${k}\` — \`${v}\``)
    }
  }
  return { key: 'deps', body: lines.join('\n'), versionStamp: `\`${p.name}@${p.version}\`` }
}

function genLicenseSection(p: PkgInfo): SectionResult {
  const depth = p.dir.split('/').length
  const href = `${'../'.repeat(depth)}LICENSE`
  const license = (p.pkg.license as string) || 'MIT'
  return {
    key: 'license',
    body: `${license} — see [LICENSE](${href}).`,
    versionStamp: `\`${p.name}@${p.version}\``,
  }
}

function genSeeAlsoSection(p: PkgInfo): SectionResult {
  const ti = tierFor(p.name)
  const lines: string[] = []
  // Compute relative depth back to repo root from p.dir.
  const depth = p.dir.split('/').length
  const rootHref = `${'../'.repeat(depth)}README.md`
  const roadmapHref = `${'../'.repeat(depth)}docs/roadmap/SUMMARY.md`
  if (ti.seeAlso.length === 0) {
    lines.push(`- [Aihu framework root](${rootHref})`)
    lines.push(`- [v1.1 roadmap](${roadmapHref})`)
  } else {
    for (const link of ti.seeAlso) {
      lines.push(`- [${link.label}](${link.href})`)
    }
    // Add framework root only if not already present in tier-specific list.
    if (
      !ti.seeAlso.some(
        (l) =>
          l.label.toLowerCase().includes('framework root') ||
          l.label.toLowerCase().includes('aihu (framework'),
      )
    ) {
      lines.push(`- [Aihu framework root](${rootHref})`)
    }
  }
  return { key: 'see-also', body: lines.join('\n'), versionStamp: `\`${p.name}@${p.version}\`` }
}

function brandHeader(p: PkgInfo): string {
  const ti = tierFor(p.name)
  const lines: string[] = []
  lines.push(`# ${p.name}`)
  lines.push('')
  lines.push(`> **Aihu** — agentic discovery and interaction, for human purpose.`)
  lines.push('')
  lines.push(p.description || ti.label)
  lines.push('')
  if (ti.tier === 'A') {
    lines.push(
      `Part of the **runtime core** layer of the Aihu meta-framework. Shipped to the client; sized via \`bun run size\`. The runtime core is dep-free and stacks under \`@aihu/runtime\` → \`@aihu/router\` → \`@aihu/server\` → \`@aihu/app\`.`,
    )
  } else if (ti.tier === 'B') {
    lines.push(
      `Part of the **meta-framework** layer of Aihu. Provides whole-app capability — file-based routing, SSR, loaders, cookies — without the boilerplate other meta-frameworks impose. See [arch-1](../../docs/roadmap/arch-1-website.md) for the meta-framework contract.`,
    )
  } else if (ti.tier === 'C') {
    lines.push(
      `Part of the **agent surface** layer of Aihu. Every Aihu component exposes its agent surface via the \`@agent\` block; this package implements one slice of the dispatch + protocol surface that connects \`@agent\` actions to live runtime signals (per the [Live-Binding RFC](../../docs/superpowers/specs/2026-05-05-spec-live-binding.md)).`,
    )
  } else if (ti.tier === 'D') {
    lines.push(
      `Part of the **compiler + toolchain** layer of Aihu. Build-time only — does not ship to the client. The compiler reads \`.aihu\` SFC source (per the [Block Structure spec](../../docs/superpowers/specs/2026-05-02-spec-block-structure.md)) and emits standards-compliant Web Components.`,
    )
  } else if (ti.tier === 'E') {
    lines.push(`Held-private workspace package. Not yet published to npm.`)
    lines.push('')
    lines.push(
      `> **Status:** Held private — not yet published to npm. See [v1.1 roadmap](../../docs/roadmap/SUMMARY.md) for ratification gating (e.g. RFC #56 live-binding for \`@aihu/plugin\` enforcement).`,
    )
  } else if (ti.tier === 'platform') {
    const parent = platformParent(p.name) ?? '@aihu/server'
    lines.push(
      `Platform-specific native binary distributor for [\`${parent}\`](../../README.md). Installed automatically as an \`optionalDependencies\` of \`${parent}\` for users on this platform.`,
    )
  }
  return lines.join('\n')
}

function migrateExistingProse(_p: PkgInfo, existing: string): string {
  // Pull out the body between the H1 header and the License section, drop the
  // boilerplate "Part of the [aihu] framework — agentic discovery..." sentence
  // (we now put a richer paragraph in the brand block above), drop common
  // template stubs, drop existing autogen markers if any, and return what's
  // left as hand-written prose.

  // Strip any existing autogen-marker blocks (defensive — should not be present
  // on first migration, but second-run safety).
  let body = existing.replace(/<!-- BEGIN_AUTOGEN: \w+ -->[\s\S]*?<!-- END_AUTOGEN: \w+ -->/g, '')
  body = body.replace(/<!-- BEGIN_HANDWRITTEN: \w+ -->[\s\S]*?<!-- END_HANDWRITTEN: \w+ -->/g, '')

  // Trim everything before the H1 line.
  const h1Idx = body.indexOf('\n# ')
  if (h1Idx > 0) body = body.slice(h1Idx)
  // Drop the H1 line itself.
  body = body.replace(/^# [^\n]+\n+/, '')
  // Drop the legacy "> One-line description" blockquote and "Part of the [aihu]" boilerplate paragraph.
  body = body.replace(/^>\s*[^\n]+\n+/, '')
  body = body.replace(/^Part of the \[aihu\][^\n]+\n+/m, '')
  // Drop common stub sections that we now autogen. Use multiline-anchored
  // patterns so we only match real H2 headings, not stray lines starting with
  // "# or" inside fenced code blocks.
  body = body.replace(/^##\s+Install[\s\S]*?(?=^##\s|^#\s|$(?![\r\n]))/im, '')
  body = body.replace(/^##\s+Usage[\s\S]*?(?=^##\s|^#\s|$(?![\r\n]))/im, '')
  body = body.replace(/^##\s+Status[\s\S]*?(?=^##\s|^#\s|$(?![\r\n]))/im, '')
  body = body.replace(/^##\s+License[\s\S]*?(?=^##\s|^#\s|$(?![\r\n]))/im, '')
  body = body.trim()
  // If what's left is the bare placeholder ("Aihu CLI ... — scaffolding ..."), drop it.
  // Heuristic: if shorter than 80 chars, treat as no real prose.
  if (body.length < 80) return ''
  return body
}

function buildPackageReadme(
  p: PkgInfo,
  existing: string | null,
  sizeMap: Map<string, { bytes: number; limit: string }>,
): string {
  const header = brandHeader(p)
  const sections = [
    genInstallSection(p),
    genStatsSection(p, sizeMap),
    genExportsSection(p),
    genDepsSection(p),
    genSeeAlsoSection(p),
    genLicenseSection(p),
  ]

  // Preserve hand-written prose. Two paths:
  //   (a) explicit BEGIN_HANDWRITTEN block exists from a prior run → use it
  //   (b) first migration → migrate any prose between H1 and License
  let prose = ''
  if (existing) {
    const m = existing.match(
      /<!-- BEGIN_HANDWRITTEN: prose -->([\s\S]*?)<!-- END_HANDWRITTEN: prose -->/,
    )
    if (m) {
      prose = m[1].trim()
    } else {
      prose = migrateExistingProse(p, existing)
    }
  }

  const ti = tierFor(p.name)
  const isPlatform = ti.tier === 'platform'
  const proseBlock = `<!-- BEGIN_HANDWRITTEN: prose -->\n${
    prose ||
    (isPlatform
      ? '_(no hand-written prose — this is a platform binary distributor; the autogen sections below tell you everything you need.)_'
      : '_(Hand-written prose lives in this block. Replace this placeholder; everything below is auto-generated.)_')
  }\n<!-- END_HANDWRITTEN: prose -->`

  let body = `${header}\n\n${proseBlock}\n`

  if (!isPlatform) {
    body += `\n## Install\n\n<!-- BEGIN_AUTOGEN: install -->\n<!-- END_AUTOGEN: install -->\n\n`
    body += `## Package facts\n\n<!-- BEGIN_AUTOGEN: stats -->\n<!-- END_AUTOGEN: stats -->\n\n`
    body += `## Exports\n\n<!-- BEGIN_AUTOGEN: exports -->\n<!-- END_AUTOGEN: exports -->\n\n`
    body += `## Dependencies\n\n<!-- BEGIN_AUTOGEN: deps -->\n<!-- END_AUTOGEN: deps -->\n\n`
    body += `## See also\n\n<!-- BEGIN_AUTOGEN: see-also -->\n<!-- END_AUTOGEN: see-also -->\n\n`
  } else {
    body += `\n## Install\n\n<!-- BEGIN_AUTOGEN: install -->\n<!-- END_AUTOGEN: install -->\n\n`
    body += `## Package facts\n\n<!-- BEGIN_AUTOGEN: stats -->\n<!-- END_AUTOGEN: stats -->\n\n`
    body += `## See also\n\n<!-- BEGIN_AUTOGEN: see-also -->\n<!-- END_AUTOGEN: see-also -->\n\n`
  }

  body += `## License\n\n<!-- BEGIN_AUTOGEN: license -->\n<!-- END_AUTOGEN: license -->\n`

  for (const s of sections) {
    body = replaceMarker(body, s.key, s.body, s.versionStamp)
  }

  return body
}

function syncPackageReadme(
  p: PkgInfo,
  sizeMap: Map<string, { bytes: number; limit: string }>,
): { path: string; existed: boolean; changed: boolean; before: string; after: string } {
  const path = join(REPO_ROOT, p.dir, 'README.md')
  const existed = existsSync(path)
  const existing: string | null = existed ? readFileSync(path, 'utf8') : null

  // Regenerate fully if file is missing, the template stub (≤ 40 lines), or
  // doesn't carry the brand block.
  const tooShort = existing ? existing.split('\n').length < 40 : true
  const hasBrandBlock = existing
    ? /^# (@aihu\/[a-z0-9-]+|vscode-aihu|create-aihu)\s*\n\s*\n\s*>\s*\*\*Aihu\*\*/m.test(existing)
    : false

  let after: string
  // If the existing file lacks the new license autogen marker, treat as needing
  // full regeneration so the static License section gets converted.
  const hasLicenseMarker = existing ? existing.includes('<!-- BEGIN_AUTOGEN: license -->') : false
  if (!existed || tooShort || !hasBrandBlock || !hasLicenseMarker) {
    after = buildPackageReadme(p, existing, sizeMap)
  } else {
    const sections = [
      genInstallSection(p),
      genStatsSection(p, sizeMap),
      genExportsSection(p),
      genDepsSection(p),
      genSeeAlsoSection(p),
      genLicenseSection(p),
    ]
    after = existing
    for (const s of sections) {
      after = replaceMarker(after, s.key, s.body, s.versionStamp)
    }
  }

  const changed = (existing ?? '') !== after
  return { path, existed, changed, before: existing ?? '', after }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`sync-readme.ts — mode: ${CHECK_MODE ? 'check' : 'write'}`)

  const packages = discoverPackages()
  const inventoryPath = join(REPO_ROOT, 'scripts/__package-inventory.json')
  const inventory = packages.map((p) => ({
    name: p.name,
    version: p.version,
    dir: p.dir,
    isPlatform: p.isPlatform,
  }))
  const inventoryJson = `${JSON.stringify(inventory, null, 2)}\n`
  let inventoryChanged = false
  if (!existsSync(inventoryPath) || readFileSync(inventoryPath, 'utf8') !== inventoryJson) {
    inventoryChanged = true
    if (!CHECK_MODE) writeFileSync(inventoryPath, inventoryJson)
  }
  console.log(
    `  → ${packages.length} packages discovered (${packages.filter((p) => p.isPlatform).length} platform)`,
  )

  const sizeCachePath = join(REPO_ROOT, 'scripts/__bundle-sizes.json')
  let measurements: Array<{ name: string; bytes: number; limit: string; ok: boolean }>
  let sizeCacheChanged = false

  // FEL-418 — the cache is authoritative in BOTH modes unless re-measuring is
  // asked for explicitly.
  //
  // These two modes used to disagree: check mode read the committed cache while
  // write mode always re-measured. That is not a cosmetic difference, it is a
  // loop that cannot be exited. `release-pr.yml` runs `release:version`, whose
  // only install is `bun install --frozen-lockfile` — it never builds. So write
  // mode ran against a tree with no `dist/`, measured nothing, and committed
  // `_no dist_` into the published README. Check mode then read the cache, saw
  // real values, and failed the comparison. The error it printed said "Run: bun
  // scripts/sync-readme.ts", which is the write mode that produced the bad value
  // — following the advice reproduced the failure.
  //
  // Reading the cache in write mode too makes the unbuilt release-PR tree emit
  // the correct committed numbers, and makes that error message true for the
  // first time. Refreshing is now an explicit act — `bun run readme:remeasure`
  // on a built tree — rather than a side effect of which mode happened to run.
  const useCache = existsSync(sizeCachePath) && !REMEASURE
  if (useCache) {
    // Platform-independent by design: a Windows dev and Linux CI produce
    // different rolldown+gzip byte counts for identical source, so the
    // committed cache — not the local machine — is the reference.
    const cached: Array<{ name: string; bytes: number; limit: string }> = JSON.parse(
      readFileSync(sizeCachePath, 'utf8'),
    )
    measurements = cached.map((c) => ({ ...c, ok: true }))
    console.log(`  → bundle sizes (from __bundle-sizes.json cache)…`)
  } else {
    console.log('  → measuring bundle sizes (rolldown)…')
    measurements = await measureSizes()

    // A missing `dist/` is an ABSENT measurement, never a value. Publishing it
    // as `_no dist_` is what let this survive unnoticed — the same shape as a
    // benchmark row that timed a binding which never fired. Refuse instead.
    const unmeasured = measurements.filter((m) => m.bytes < 0).map((m) => m.name)
    if (unmeasured.length > 0) {
      console.error(
        `\n  Cannot measure ${unmeasured.length} package(s) — no dist/ on disk:\n` +
          unmeasured.map((n) => `    - ${n}`).join('\n') +
          `\n\n  Refusing to write "_no dist_" into the README as if it were a measurement.\n` +
          `  Build first:            bun run build\n` +
          `  Or reuse committed numbers by dropping --remeasure.\n`,
      )
      process.exit(1)
    }

    const sizeCacheJson = `${JSON.stringify(
      measurements.map(({ name, bytes, limit }) => ({ name, bytes, limit })),
      null,
      2,
    )}\n`
    if (!existsSync(sizeCachePath) || readFileSync(sizeCachePath, 'utf8') !== sizeCacheJson) {
      sizeCacheChanged = true
      if (!CHECK_MODE) writeFileSync(sizeCachePath, sizeCacheJson)
    }
  }

  const sizeMap = new Map<string, { bytes: number; limit: string }>()
  for (const m of measurements) sizeMap.set(m.name, { bytes: m.bytes, limit: m.limit })

  console.log('  → generating root README sections…')
  const rootSections: SectionResult[] = [
    genPerformanceSection(),
    await genBundleSizesSection(measurements),
    genExamplesSection(),
    genPackagesByTierSection(packages),
    genPackagesListSection(packages),
    genReferenceSection(),
  ]

  const readmePath = join(REPO_ROOT, 'README.md')
  let readme = readFileSync(readmePath, 'utf8')
  const beforeRoot = readme
  for (const s of rootSections) {
    readme = replaceMarker(readme, s.key, s.body, undefined)
  }
  const rootChanged = beforeRoot !== readme

  console.log('  → syncing per-package READMEs…')
  const pkgResults: Array<{
    path: string
    existed: boolean
    changed: boolean
    before: string
    after: string
    name: string
  }> = []
  for (const p of packages) {
    const r = syncPackageReadme(p, sizeMap)
    pkgResults.push({ ...r, name: p.name })
  }
  const pkgChanged = pkgResults.some((r) => r.changed)
  const pkgCreated = pkgResults.filter((r) => !r.existed).length
  const pkgUpdated = pkgResults.filter((r) => r.existed && r.changed).length

  console.log('')
  console.log(`  Root README: ${rootChanged ? 'CHANGED' : 'in sync'}`)
  console.log(`  Inventory:   ${inventoryChanged ? 'CHANGED' : 'in sync'}`)
  console.log(
    `  Packages:    ${pkgCreated} new, ${pkgUpdated} updated, ${pkgResults.length - pkgCreated - pkgUpdated} unchanged`,
  )

  if (CHECK_MODE) {
    const rootDrifted = beforeRoot !== readme
    const pkgDrifted = pkgResults.some((r) => r.before !== r.after)
    if (rootDrifted || pkgDrifted || inventoryChanged || sizeCacheChanged) {
      console.error('')
      console.error('  README drift detected. Run: bun scripts/sync-readme.ts')
      if (rootDrifted) console.error('    - README.md has stale autogen content')
      if (inventoryChanged) console.error('    - scripts/__package-inventory.json is stale')
      if (sizeCacheChanged) console.error('    - scripts/__bundle-sizes.json is stale')
      for (const r of pkgResults) {
        if (r.before !== r.after)
          console.error(`    - ${relative(REPO_ROOT, r.path)} has stale autogen content`)
      }
      process.exit(1)
    }
    console.log('  All in sync.')
    return
  }

  if (rootChanged) writeFileSync(readmePath, readme)
  for (const r of pkgResults) {
    if (r.changed) writeFileSync(r.path, r.after)
  }
  if (rootChanged || pkgChanged || inventoryChanged || sizeCacheChanged) {
    console.log('')
    console.log(
      `  Wrote ${[
        rootChanged && 'README.md',
        inventoryChanged && '__package-inventory.json',
        sizeCacheChanged && '__bundle-sizes.json',
        pkgChanged && `${pkgCreated + pkgUpdated} package READMEs`,
      ]
        .filter(Boolean)
        .join(', ')}.`,
    )
  } else {
    console.log('')
    console.log('  Already in sync — no writes.')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
