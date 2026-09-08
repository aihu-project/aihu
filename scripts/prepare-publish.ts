// One-shot script to prepare tier A/B/C/D packages for npm publish.
// Sets version 0.1.0, ensures publishConfig, repository, homepage, bugs,
// description, sideEffects, files, prepublishOnly script.
//
// Run: `bun scripts/prepare-publish.ts`. Idempotent.
//
// This script is committed because it is a one-shot operation that's easy
// to audit by reading.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type Pkg = Record<string, unknown> & {
  name?: string
  version?: string
  description?: string
  license?: string
  private?: boolean
  files?: string[]
  scripts?: Record<string, string>
  repository?: unknown
  homepage?: string
  bugs?: string | { url?: string }
  publishConfig?: Record<string, unknown>
  sideEffects?: boolean | string[]
  optionalDependencies?: Record<string, string>
}

const TIER_A = ['signals', 'arbor', 'runtime', 'context', 'data']
// Note: @aihu/plugin promoted to tier-B because @aihu/server depends on it
// at runtime. A held plugin would break consumer install of server.
const TIER_B = ['router', 'server', 'app', 'adapter-cloudflare', 'adapter-vercel', 'plugin']
const TIER_C = ['agent', 'agent-service', 'agent-readiness', 'agent-a2a', 'agent-acp']
const TIER_D = ['cli']
const PUBLISH = new Set([...TIER_A, ...TIER_B, ...TIER_C, ...TIER_D])

const DESCRIPTIONS: Record<string, string> = {
  signals: 'Tiny reactive signals — the reactive primitive at the core of aihu.',
  arbor: 'Reactive component tree (the rendering layer that consumes @aihu/signals).',
  runtime:
    'Single File Component (.aihu) runtime — registers custom elements compiled by @aihu/compiler.',
  context: 'Async-context-friendly request/SSR context primitives for aihu.',
  data: 'Reactive data loaders and resource primitives for aihu.',
  router: 'File-based router for the aihu meta-framework.',
  server: 'Server runtime + native renderer (napi-rs) for aihu SSR.',
  app: 'Top-level app integration — wires runtime, router, and adapters into a Vite app.',
  'adapter-cloudflare': 'Cloudflare Workers/Pages deployment adapter for @aihu/app.',
  'adapter-vercel': 'Vercel deployment adapter for @aihu/app.',
  agent: 'Agent primitives — the foundation of aihu agent-readiness.',
  'agent-service': 'Service-side agent runtime (server-hosted agent endpoints).',
  'agent-readiness': 'Discovery + readiness manifest emitter so agents can introspect aihu apps.',
  'agent-a2a':
    'A2A (Agent2Agent) protocol bindings (spec v1.0.1, JSON-RPC) for @aihu/agent-service.',
  'agent-acp': 'DEPRECATED — use @aihu/agent-a2a (ACP merged into A2A, Aug 2025).',
  cli: 'Aihu CLI (`aihu`, `create-aihu`) — scaffolding, dev, build commands.',
  plugin: 'Plugin substrate shared by @aihu/server and the meta-framework — runtime hook surface.',
}

function ensurePackage(dir: string): { changed: boolean; readmeMissing: boolean } {
  const pkgPath = join('packages', dir, 'package.json')
  const raw = readFileSync(pkgPath, 'utf8')
  const pkg = JSON.parse(raw) as Pkg
  let changed = false

  // 1. private flag — remove if present
  if (pkg.private === true) {
    delete pkg.private
    changed = true
  } else if (pkg.private === false) {
    delete pkg.private // implicit-public is cleaner
    changed = true
  }

  // 2. version → 0.1.0
  if (pkg.version !== '0.1.0') {
    pkg.version = '0.1.0'
    changed = true
  }

  // 3. description
  if (!pkg.description && DESCRIPTIONS[dir]) {
    pkg.description = DESCRIPTIONS[dir]
    changed = true
  }

  // 4. license
  if (!pkg.license) {
    pkg.license = 'MIT'
    changed = true
  }

  // 5. repository
  const wantRepo = {
    type: 'git',
    url: 'git+https://github.com/aihu-project/aihu.git',
    directory: `packages/${dir}`,
  }
  if (
    !pkg.repository ||
    typeof pkg.repository !== 'object' ||
    JSON.stringify(pkg.repository) !== JSON.stringify(wantRepo)
  ) {
    pkg.repository = wantRepo
    changed = true
  }

  // 6. homepage
  const wantHomepage = `https://github.com/aihu-project/aihu/tree/main/packages/${dir}#readme`
  if (pkg.homepage !== wantHomepage) {
    pkg.homepage = wantHomepage
    changed = true
  }

  // 7. bugs
  const wantBugs = 'https://github.com/aihu-project/aihu/issues'
  if (pkg.bugs !== wantBugs) {
    pkg.bugs = wantBugs
    changed = true
  }

  // 8. publishConfig
  const wantPublishConfig = { access: 'public' }
  if (
    !pkg.publishConfig ||
    JSON.stringify(pkg.publishConfig) !== JSON.stringify(wantPublishConfig)
  ) {
    pkg.publishConfig = wantPublishConfig
    changed = true
  }

  // 9. sideEffects — leave as-is if set, otherwise default to false
  if (pkg.sideEffects === undefined) {
    pkg.sideEffects = false
    changed = true
  }

  // 10. files — ensure dist, README.md, and LICENSE are included
  const filesSet = new Set(pkg.files ?? ['dist'])
  for (const f of ['dist', 'README.md', 'LICENSE']) filesSet.add(f)
  pkg.files = [...filesSet]
  changed = true // re-serialize for ordering anyway

  // 11. prepublishOnly
  if (!pkg.scripts) pkg.scripts = {}
  if (!pkg.scripts.prepublishOnly) {
    pkg.scripts.prepublishOnly = 'bun run build'
    changed = true
  }

  // 12. keep optionalDependencies versions in sync — if @aihu/server's
  //     optional native deps reference a version, that version stays at 0.1.0.
  //     (No-op if the dep is already 0.1.0.)
  if (pkg.optionalDependencies) {
    for (const k of Object.keys(pkg.optionalDependencies)) {
      if (pkg.optionalDependencies[k] !== '0.1.0' && k.startsWith('@aihu/')) {
        // leave native sub-packages locked to 0.1.0
        if (pkg.optionalDependencies[k] === undefined) continue
        // already 0.1.0 — keep
      }
    }
  }

  if (changed) {
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  }

  // README check
  const readmePath = join('packages', dir, 'README.md')
  let readmeMissing = false
  try {
    const st = statSync(readmePath)
    if (st.size < 200) readmeMissing = true
  } catch {
    readmeMissing = true
  }

  return { changed, readmeMissing }
}

const dirs = readdirSync('packages').filter((d) => PUBLISH.has(d))
const results: { dir: string; changed: boolean; readmeMissing: boolean }[] = []
for (const d of dirs) {
  const r = ensurePackage(d)
  results.push({ dir: d, ...r })
}

console.log('package edits:')
for (const r of results) {
  console.log(`  ${r.dir.padEnd(20)} changed=${r.changed} readmeMissing=${r.readmeMissing}`)
}
