#!/usr/bin/env bun
/**
 * CI lint — every `@aihu/*` subpath a package imports exists in the version
 * that package will publish against.
 *
 * #843: `@aihu/app` 10.1.0 imports `@aihu/runtime/app` and declares
 * `@aihu/runtime` as a `workspace:*` peer. The workspace runtime already
 * exported `./app`, but its version (6.1.0) had been on npm since before that
 * export existed. The release skipped republishing it, `workspace:*` became an
 * exact `6.1.0` pin, and every install honouring the peer failed to resolve the
 * import. CI stayed green because the workspace copy resolves locally and
 * nothing compared the import with what npm would actually serve.
 *
 * For each publishable package this scans its source for static, re-export and
 * dynamic imports of `@aihu/<name>/<subpath>` (type-only imports are erased and
 * skipped), finds the dependency's declared range, works out the version a
 * consumer would install, and checks that version's `exports` covers the
 * subpath:
 *   - `workspace:` range: the workspace package's version. If npm already has
 *     that version, npm's manifest is what consumers get; otherwise the release
 *     publishes the workspace copy, so its local manifest is used.
 *   - registry range: the highest npm version satisfying it.
 *
 * Exit codes:
 *   0  every imported subpath is exported by the version it publishes against
 *   1  a subpath is missing
 *   2  npm could not be queried
 *
 * Run locally:
 *   bun run check:published-exports
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverPublishable } from './check-publish-manifest.ts'

// `PUBLISHED_EXPORTS_ROOT` repoints the scan at a fixture tree (same shape as
// LOCKFILE_PINS_ROOT) and reads npm from that tree's `npm.json` instead of the
// registry, so check:gate-wiring can execute the red and green paths offline.
const FIXTURE_ROOT = process.env.PUBLISHED_EXPORTS_ROOT
const ROOT = FIXTURE_ROOT
  ? resolve(FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = join(ROOT, 'packages')

export type ExportsField = string | Record<string, unknown> | null | undefined

/** A resolved manifest: the version a consumer gets and its `exports`. */
export interface ResolvedManifest {
  version: string
  exports: ExportsField
}

/** Looks up `name@rangeOrVersion` on npm; `null` when nothing is published. */
export type NpmLookup = (spec: string) => ResolvedManifest | null

export interface WorkspacePackage {
  name: string
  version: string
  exports: ExportsField
}

export interface PackageUnderCheck {
  name: string
  manifest: {
    dependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
  }
  sources: { file: string; text: string }[]
}

export interface Problem {
  importer: string
  file: string
  specifier: string
  dependency: string
  version: string
  source: 'npm' | 'workspace'
  subpath: string
}

const SPECIFIER = String.raw`(@aihu(?:-plugin)?\/[a-z0-9][a-z0-9-]*\/[^'"\s]+)`
const IMPORT_PATTERNS = [
  // import x from '…', import { a,\n b } from '…', import * as x from '…'
  new RegExp(
    String.raw`(?:^|[\s;])import\s+(?!type\s)[\w*${'$'}{}\s,]*?from\s*['"]${SPECIFIER}['"]`,
    'g',
  ),
  // side-effect import '…'
  new RegExp(String.raw`(?:^|[\s;])import\s*['"]${SPECIFIER}['"]`, 'g'),
  // export { a } from '…', export * from '…'
  new RegExp(
    String.raw`(?:^|[\s;])export\s+(?!type\s)[\w*${'$'}{}\s,]*?from\s*['"]${SPECIFIER}['"]`,
    'g',
  ),
  // import('…')
  new RegExp(String.raw`import\(\s*['"]${SPECIFIER}['"]\s*\)`, 'g'),
]

/** Every `@aihu/<name>/<subpath>` a module imports at runtime. */
export function scanImports(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const found = new Set<string>()
  for (const pattern of IMPORT_PATTERNS) {
    for (const m of code.matchAll(pattern)) found.add(m[1])
  }
  return [...found].sort()
}

/** `@aihu/runtime/app` → `{ dependency: '@aihu/runtime', subpath: './app' }`. */
export function splitSpecifier(specifier: string): { dependency: string; subpath: string } {
  const [scope, name, ...rest] = specifier.split('/')
  return { dependency: `${scope}/${name}`, subpath: `./${rest.join('/')}` }
}

/** Whether an `exports` field makes `subpath` importable. */
export function hasExport(exports: ExportsField, subpath: string): boolean {
  // No exports map: Node resolves any file path, so there is nothing to check.
  if (exports === undefined || exports === null) return true
  // A string, or a conditions object without "./" keys, exports only ".".
  if (typeof exports === 'string') return false
  const keys = Object.keys(exports).filter((k) => k.startsWith('.'))
  if (keys.includes(subpath)) return true
  return keys.some((key) => {
    const star = key.indexOf('*')
    if (star === -1) return false
    const prefix = key.slice(0, star)
    const suffix = key.slice(star + 1)
    return (
      subpath.length >= prefix.length + suffix.length &&
      subpath.startsWith(prefix) &&
      subpath.endsWith(suffix)
    )
  })
}

function declaredRange(pkg: PackageUnderCheck, dependency: string): string | undefined {
  const { dependencies, peerDependencies, optionalDependencies } = pkg.manifest
  return (
    dependencies?.[dependency] ??
    peerDependencies?.[dependency] ??
    optionalDependencies?.[dependency]
  )
}

/** Imported subpaths the publish target of their dependency does not export. */
export function checkPackage(
  pkg: PackageUnderCheck,
  workspace: Map<string, WorkspacePackage>,
  lookup: NpmLookup,
): Problem[] {
  const problems: Problem[] = []
  for (const { file, text } of pkg.sources) {
    for (const specifier of scanImports(text)) {
      const { dependency, subpath } = splitSpecifier(specifier)
      if (dependency === pkg.name) continue
      const range = declaredRange(pkg, dependency)
      // Undeclared or dev-only imports do not ship a pin; other checks own them.
      if (range === undefined || range.startsWith('file:') || range.startsWith('link:')) continue

      let target: ResolvedManifest | null
      let source: Problem['source']
      if (range.startsWith('workspace:')) {
        const local = workspace.get(dependency)
        if (!local) continue
        target = lookup(`${dependency}@${local.version}`)
        source = 'npm'
        if (!target) {
          target = { version: local.version, exports: local.exports }
          source = 'workspace'
        }
      } else {
        target = lookup(`${dependency}@${range}`)
        source = 'npm'
        // A registry range nothing satisfies is verify-registry-dependencies' job.
        if (!target) continue
      }

      if (!hasExport(target.exports, subpath)) {
        problems.push({
          importer: pkg.name,
          file,
          specifier,
          dependency,
          version: target.version,
          source,
          subpath,
        })
      }
    }
  }
  return problems
}

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/
const SKIP_DIRS = new Set(['node_modules', 'dist', 'tests', 'test', '__tests__', 'fixtures'])

function collectSources(dir: string, root: string, out: { file: string; text: string }[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectSources(abs, root, out)
    } else if (SOURCE_EXT.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) {
      out.push({ file: abs.slice(root.length + 1), text: readFileSync(abs, 'utf8') })
    }
  }
}

function workspacePackages(): Map<string, WorkspacePackage> {
  const map = new Map<string, WorkspacePackage>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue
      const abs = join(dir, entry.name)
      const manifest = join(abs, 'package.json')
      if (existsSync(manifest)) {
        const p = JSON.parse(readFileSync(manifest, 'utf8'))
        if (typeof p.name === 'string') {
          map.set(p.name, { name: p.name, version: p.version, exports: p.exports })
        }
        continue
      }
      walk(abs)
    }
  }
  walk(PACKAGES)
  return map
}

class NpmUnreachable extends Error {}

function npmLookup(): NpmLookup {
  if (FIXTURE_ROOT) {
    const published: Record<string, ResolvedManifest> = JSON.parse(
      readFileSync(join(ROOT, 'npm.json'), 'utf8'),
    )
    return (spec) => published[spec] ?? null
  }
  const cache = new Map<string, ResolvedManifest | null>()
  return (spec) => {
    if (cache.has(spec)) return cache.get(spec) ?? null
    let result: ResolvedManifest | null = null
    try {
      const out = execFileSync('npm', ['view', spec, '--json'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim()
      if (out) {
        const parsed = JSON.parse(out)
        // A range matching several versions yields an array in ascending order.
        const manifest = Array.isArray(parsed) ? parsed[parsed.length - 1] : parsed
        if (manifest?.version) result = { version: manifest.version, exports: manifest.exports }
      }
    } catch (error) {
      const stderr = String((error as { stderr?: unknown }).stderr ?? '')
      if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET/.test(stderr)) {
        throw new NpmUnreachable(`could not query npm for ${spec}`)
      }
      if (!/E404|404 Not Found|No match found/.test(stderr)) throw error
    }
    cache.set(spec, result)
    return result
  }
}

function main(): number {
  const workspace = workspacePackages()
  const lookup = npmLookup()
  const problems: Problem[] = []
  let scanned = 0
  try {
    for (const { slug, name } of discoverPublishable(PACKAGES)) {
      const dir = join(PACKAGES, slug)
      const sources: { file: string; text: string }[] = []
      for (const sub of ['src', 'bin']) {
        const abs = join(dir, sub)
        if (existsSync(abs) && statSync(abs).isDirectory()) collectSources(abs, ROOT, sources)
      }
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && SOURCE_EXT.test(entry.name) && !/config\./.test(entry.name)) {
          const abs = join(dir, entry.name)
          sources.push({ file: abs.slice(ROOT.length + 1), text: readFileSync(abs, 'utf8') })
        }
      }
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      problems.push(...checkPackage({ name, manifest, sources }, workspace, lookup))
      scanned++
    }
  } catch (error) {
    if (error instanceof NpmUnreachable) {
      console.error(`ERROR: ${error.message}. The registry must be reachable for this check.`)
      return 2
    }
    throw error
  }

  if (problems.length === 0) {
    console.log(
      `OK: every @aihu/* subpath imported by ${scanned} publishable packages is exported by the version they publish against.`,
    )
    return 0
  }

  console.error('FAIL: imported @aihu/* subpaths that the published dependency does not export.\n')
  for (const p of problems) {
    console.error(`  ${p.importer} (${p.file})`)
    console.error(
      `    imports ${p.specifier}, but publishes against ${p.dependency}@${p.version}` +
        ` (${p.source === 'npm' ? 'already on npm' : 'workspace copy'}), whose exports lack ${p.subpath}.`,
    )
  }
  console.error(
    "\nIf the workspace package already exports it, bump that package's version so the\n" +
      'published pin names a release that includes the export. Otherwise add the export,\n' +
      'or import from a subpath the published version provides.',
  )
  return 1
}

if (import.meta.main) process.exit(main())
