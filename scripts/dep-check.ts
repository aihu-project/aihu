#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUILD_DEV_ONLY, SERVER_SIDE } from './check-size-rows.ts'

// On Windows, new URL().pathname has a leading slash before the drive letter.
// Use import.meta.dirname for a reliable path.
const root = join(import.meta.dirname, '..')
const packagesDir = join(root, 'packages')

const ALLOWED_PEER_PATTERNS = ['@aihu/', '@aihu-plugin/', 'vite']
const ALLOWED_DEP_PATTERNS = ['@aihu/', '@aihu-plugin/']

// Editor extensions (e.g. VSCode language clients) are out of scope for the
// browser-bundle dep-free thesis. They ship as editor tooling, not user-app
// runtime surfaces. Per `.size-limit.README.md`, the dep-free contract is a
// browser-bundle thesis; non-browser packages (server-side, build/dev-only,
// editor) don't fall under it.
const EDITOR_EXTENSIONS = new Set<string>(['vscode-aihu'])

/** The original package-level dep-free scan (v3 thesis). Pure-ish: only
 * console.error side effects, returns whether it passed. */
export function checkPackageLevelDeps(): boolean {
  const packages = readdirSync(packagesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  let pass = true

  for (const pkg of packages) {
    const pkgJsonPath = join(packagesDir, pkg, 'package.json')
    let pkgJson: {
      name?: string
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      peerDependenciesMeta?: Record<string, { optional?: boolean }>
      optionalDependencies?: Record<string, string>
    }
    try {
      pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
    } catch {
      continue
    }

    // Skip non-browser packages — the dep-free thesis is a browser-bundle
    // contract per `.size-limit.README.md`. Server-side and build/dev-only
    // packages are budgeted by other means; editor extensions ship through
    // marketplaces, not browser bundles. Re-uses `SERVER_SIDE` and
    // `BUILD_DEV_ONLY` from `check-size-rows.ts` as the single source of truth.
    const name = pkgJson.name ?? ''
    if (SERVER_SIDE.has(name) || BUILD_DEV_ONLY.has(name) || EDITOR_EXTENSIONS.has(name)) {
      continue
    }

    const deps = Object.keys(pkgJson.dependencies ?? {})
    const peers = Object.keys(pkgJson.peerDependencies ?? {})
    const opts = Object.keys(pkgJson.optionalDependencies ?? {})
    const peerMeta = pkgJson.peerDependenciesMeta ?? {}

    for (const dep of deps) {
      if (!ALLOWED_DEP_PATTERNS.some((p) => dep.startsWith(p))) {
        console.error(`FAIL [${pkgJson.name}] runtime dep not allowed: ${dep}`)
        pass = false
      }
    }
    for (const dep of [...peers, ...opts]) {
      // Optional peers are zero-install (not in `npm ls --production` by
      // default); the v1 plan §"Per-version dep envelope" explicitly authorizes
      // peer-optional alongside build-time / dev-time. Skip them.
      if (peers.includes(dep) && peerMeta[dep]?.optional === true) {
        continue
      }
      if (!ALLOWED_PEER_PATTERNS.some((p) => dep.startsWith(p))) {
        console.error(`FAIL [${pkgJson.name}] peer/optional dep not allowed: ${dep}`)
        pass = false
      }
    }
  }

  return pass
}

// ---------------------------------------------------------------------------
// @aihu/use subpath purity — the mechanism behind the revised namespace
// contract ("CORE is dependency-free; FAMILY subpaths may declare optional
// peers, isolated per-composable entry"). npm has no subpath-level dependency
// declaration — this is the only real enforcement of that isolation; entry
// granularity (one rolldown input per composable) is what delivers it, and
// this scan is what proves nobody accidentally widened an entry's reach.
//
// `packages/use/families.json` is the single source of truth for which
// families exist, whether they aggregate, and which peers each MEMBER (or the
// whole family, via the `"*"` key) is allowed to import.
// ---------------------------------------------------------------------------

interface FamilyDef {
  aggregate: boolean
  autoImport: boolean
  memberLimit: string
  aggregateLimit?: string
  /** member name (or `"*"` for every member) -> allowed bare peer specifiers. */
  peers: Record<string, string[]>
}

interface FamiliesFile {
  families: Record<string, FamilyDef>
}

type EntryClass =
  | { kind: 'core' }
  | { kind: 'family-aggregate'; family: string }
  | { kind: 'family-member'; family: string; member: string }

/**
 * entryKey -> src path, parsed from `packages/use/rolldown.config.ts`'s
 * `input` block. Deliberately a local copy of
 * `scripts/check-use-registry-parity.ts`'s (also widened) `parseRolldownInputs`
 * rather than a cross-script import — keep the two regexes in sync; the
 * canonical widened pattern lives in that file's docstring.
 */
export function parseRolldownInputEntries(rolldownSrc: string): Map<string, string> {
  const entries = new Map<string, string>()
  const blockMatch = rolldownSrc.match(/input:\s*\{([\s\S]*?)\n\s*\}/)
  const block = blockMatch ? blockMatch[1] : rolldownSrc
  const re = /^\s*'?([\w/]+)'?:\s*'(src\/[\w/]+\/index\.ts)',?\s*$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(block)) !== null) {
    entries.set(m[1], m[2])
  }
  // `index: 'src/index.ts'` never matches the `src/[\w/]+/index.ts` pattern
  // above (there's no name segment between `src/` and `index.ts`) — patch it
  // in explicitly so the core barrel is still a walked entry point (it is a
  // real rolldown input; the regex gap is not a reason to skip it).
  if (!entries.has('index')) entries.set('index', 'src/index.ts')
  return entries
}

export function classifyEntry(entryKey: string, families: Record<string, FamilyDef>): EntryClass {
  if (entryKey.includes('/')) {
    const slash = entryKey.indexOf('/')
    return {
      kind: 'family-member',
      family: entryKey.slice(0, slash),
      member: entryKey.slice(slash + 1),
    }
  }
  if (families[entryKey]) return { kind: 'family-aggregate', family: entryKey }
  return { kind: 'core' }
}

export function allowedExternals(
  cls: EntryClass,
  families: Record<string, FamilyDef>,
): Set<string> {
  const out = new Set<string>(['@aihu/signals'])
  if (cls.kind === 'family-member') {
    const def = families[cls.family]
    for (const p of def?.peers['*'] ?? []) out.add(p)
    for (const p of def?.peers[cls.member] ?? []) out.add(p)
  } else if (cls.kind === 'family-aggregate') {
    const def = families[cls.family]
    for (const peers of Object.values(def?.peers ?? {})) for (const p of peers) out.add(p)
  }
  return out
}

/** First path segment under `packages/use/src/`, if it names a declared
 * family; else `null` (covers `shared/` and every core composable dir). */
export function dirFamilyOf(
  useSrcDir: string,
  absFile: string,
  families: Record<string, FamilyDef>,
): string | null {
  const rel = relative(useSrcDir, absFile)
  const first = rel.split(sep)[0]
  return families[first] ? first : null
}

/**
 * Every `from '...'` / bare `import '...'` / dynamic `import('...')` /
 * `export ... from '...'` specifier in `src` (regex-based — the repo already
 * regex-parses TS in these scripts; a real parser buys nothing here). Dynamic
 * imports are NOT an escape hatch: Vite resolves them at build time same as
 * static imports (verified against vite 8.0.16 — see the design's Exp 2).
 */
/**
 * Remove `//` line and `/* *\/` block comments so import-like PROSE in a comment
 * cannot be mis-read as a specifier. The `from '...'` pattern below matches the
 * word "from" followed by a quoted string ANYWHERE, so a comment such as
 * `indistinguishable from "nothing to decide"` was extracted as the bare
 * specifier `nothing to decide` and reported as an undeclared external — a false
 * positive that forced a correct comment to be reworded to get CI green
 * (C-FEL-DEPCHECK-COMMENTS; architect hit it on #672).
 *
 * String and template literals are PRESERVED — their contents ARE the specifiers
 * this extractor reads (`from './foo'`), so blanking them would erase real
 * imports. The strip is string-aware so a `//` or `/*` INSIDE a string (e.g.
 * `"http://…"`) is not mistaken for a comment start. Prose inside a STRING
 * literal is out of scope for the same reason a real parser is (the module's own
 * note): erasing string contents would erase the imports.
 *
 * KNOWN LIMITATION (the false-negative direction, deliberately unmodeled): the
 * scanner does not model REGEX LITERALS. A regex containing a slash-slash outside
 * a string — e.g. `/https:\/\//` — looks like a line-comment start, so the REST
 * OF THAT LINE is stripped (and a regex opening with `/*` would read as a block
 * comment, the rarer and worse variant). The `//` case is confined to the regex's
 * own line — a line-comment strip stops at the newline — so an import on any LATER
 * line still survives (asserted in the fixture). Left unmodeled because an import
 * statement essentially never shares a line with a regex literal; distinguishing
 * regex context from division needs the real parser this module deliberately
 * forgoes (C-FEL-DEPCHECK-COMMENTS).
 */
function stripComments(src: string): string {
  let out = ''
  let quote: string | null = null // active string delimiter: ' " or `
  for (let i = 0; i < src.length; ) {
    const c = src[i]
    const c2 = src[i + 1]
    if (quote) {
      out += c
      if (c === '\\') {
        out += c2 ?? ''
        i += 2
        continue
      }
      if (c === quote) quote = null
      i += 1
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      out += c
      i += 1
      continue
    }
    if (c === '/' && c2 === '/') {
      while (i < src.length && src[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && c2 === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    out += c
    i += 1
  }
  return out
}

export function extractSpecifiers(src: string): string[] {
  const specs: string[] = []
  // Strip comments FIRST so import-like prose in a comment is never matched;
  // real imports (in code, in string specifiers) survive untouched.
  const code = stripComments(src)
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /^\s*import\s*['"]([^'"]+)['"]/gm,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(code)) !== null) specs.push(m[1])
  }
  // A computed dynamic import cannot be proven to stay within the entry's
  // declared dependency envelope. Treat it as a purity violation instead of
  // silently omitting it from this static import graph.
  const dynamicImportRe = /\bimport\s*\(\s*([^)]*)\)/g
  let dynamicMatch: RegExpExecArray | null
  while ((dynamicMatch = dynamicImportRe.exec(code)) !== null) {
    if (!/^\s*['"]/.test(dynamicMatch[1])) specs.push('<computed dynamic import>')
  }
  return specs
}

/**
 * Package-boundary-aware membership check: a specifier passes if it names an
 * allowed package exactly OR a subpath of one (`@aihu/signals/lifecycle`
 * passes when `@aihu/signals` is allowed). Deliberately NOT a plain prefix
 * match — `spec.startsWith(pkg)` alone would also admit an unrelated
 * sibling package that merely shares a string prefix (e.g. `@aihu/signals2`).
 */
export function isAllowedExternal(spec: string, allowed: Set<string>): boolean {
  for (const pkg of allowed) {
    if (spec === pkg || spec.startsWith(`${pkg}/`)) return true
  }
  return false
}

function resolveRelativeSpecifier(fromFile: string, specifier: string): string {
  const p = resolve(dirname(fromFile), specifier)
  if (existsSync(p) && !p.endsWith('.ts')) return p
  if (!p.endsWith('.ts') && existsSync(`${p}.ts`)) return `${p}.ts`
  if (!p.endsWith('.ts') && existsSync(join(p, 'index.ts'))) return join(p, 'index.ts')
  return p
}

/**
 * `checkUseSubpathPurity()` — subpath-level enforcement the package-level
 * loop above cannot do. Walks the reachable-file graph of every
 * `packages/use` rolldown entry and asserts:
 *   - CORE entries reach `@aihu/signals` only, and never a file under a
 *     declared family directory (the one-way rule: family may import core,
 *     core may NEVER import family — unconditionally, not "unless the family
 *     is currently peer-free").
 *   - A family member/aggregate reaches only `@aihu/signals`, its own
 *     family's declared peers, core files, and `shared/` — never another
 *     family's directory.
 *
 * IMPORTANT — what this does NOT do: once a peer lands in `peerDependencies`,
 * `scripts/size.ts`'s `peerDepsOf()` auto-externalizes it for EVERY
 * `@aihu/use` row, including CORE rows. A peer accidentally dragged into a
 * CORE bundle would therefore measure SMALLER under `bun run size`, not
 * larger — the size gate cannot catch this class of regression. This static
 * import-graph scan is the ONLY real enforcement of CORE's dependency-free
 * contract once family peers exist.
 *
 * Peer/family manifest ownership (families.json <-> package.json) is checked
 * too, but scoped to "active" peers — those actually claimed by an EXISTING
 * rolldown entry. `families.json` is allowed to pre-declare a family's full
 * peer map (e.g. all five `/integrations` peers) before every member has
 * landed (waves roll out incrementally); forcing `axios`/`universal-cookie`/
 * `drauu`/`async-validator` into `peerDependencies` before their composables
 * exist would fail the "a peer with no member entry is a parity FAIL by
 * design" rule the other direction. Once a member's rolldown entry exists,
 * ITS declared peer(s) become active and MUST be present in
 * `peerDependencies` + `peerDependenciesMeta.<peer>.optional` + `devDependencies`.
 */
export function checkUseSubpathPurity(usePkgDir: string = join(packagesDir, 'use')): {
  pass: boolean
  errors: string[]
} {
  const errors: string[] = []
  const pkgJsonPath = join(usePkgDir, 'package.json')
  if (!existsSync(pkgJsonPath)) return { pass: true, errors }

  const familiesPath = join(usePkgDir, 'families.json')
  const families: Record<string, FamilyDef> = existsSync(familiesPath)
    ? (JSON.parse(readFileSync(familiesPath, 'utf8')) as FamiliesFile).families
    : {}

  const useSrcDir = join(usePkgDir, 'src')
  const rolldownSrc = readFileSync(join(usePkgDir, 'rolldown.config.ts'), 'utf8')
  const entries = parseRolldownInputEntries(rolldownSrc)

  const visited = new Set<string>()

  function walk(entryKey: string, cls: EntryClass, file: string, allowed: Set<string>): void {
    const real = resolve(file)
    const memoKey = `${entryKey}::${real}`
    if (visited.has(memoKey)) return
    visited.add(memoKey)
    if (!existsSync(real)) return
    const src = readFileSync(real, 'utf8')
    const fileAllowed = new Set(allowed)
    if (real === resolve(join(usePkgDir, 'src/createFocusTrap/index.ts'))) {
      fileAllowed.add('@aihu/primitives')
    }
    for (const spec of extractSpecifiers(src)) {
      if (spec === '<computed dynamic import>') {
        errors.push(
          `FAIL [@aihu/use] '${entryKey}' uses a computed dynamic import that cannot be verified ` +
            `against its allowed externals (${[...fileAllowed].join(', ') || '(none)'}). Use a static ` +
            `literal import so subpath purity can be checked.`,
        )
        continue
      }
      if (spec.startsWith('.')) {
        const resolved = resolveRelativeSpecifier(real, spec)
        const fam = dirFamilyOf(useSrcDir, resolved, families)
        const relForMsg = relative(usePkgDir, resolved)
        if (cls.kind === 'core' && fam !== null) {
          errors.push(
            `FAIL [@aihu/use] core entry '${entryKey}' reaches family file '${relForMsg}' — CORE ` +
              `may never import family code (a family may gain an optional peer at any time; CORE ` +
              `must stay peer-free by construction). Hoist the shared implementation into src/shared/ ` +
              `and have BOTH import it.`,
          )
        } else if (cls.kind !== 'core' && fam !== null && fam !== cls.family) {
          errors.push(
            `FAIL [@aihu/use] '${entryKey}' (family '${cls.family}') reaches a different family's ` +
              `file '${relForMsg}' (family '${fam}') — cross-family imports are forbidden; hoist to ` +
              `src/shared/.`,
          )
        }
        walk(entryKey, cls, resolved, allowed)
      } else if (!isAllowedExternal(spec, fileAllowed)) {
        errors.push(
          `FAIL [@aihu/use] '${entryKey}' imports '${spec}', which is not in its allowed externals ` +
            `(${[...fileAllowed].join(', ') || '(none)'}). CORE may import @aihu/signals only; a family ` +
            `entry may import @aihu/signals plus its families.json-declared peers. Only the ` +
            `createFocusTrap source may also reach @aihu/primitives.`,
        )
      }
    }
  }

  for (const [entryKey, srcPath] of entries) {
    const cls = classifyEntry(entryKey, families)
    const allowed = allowedExternals(cls, families)
    if (entryKey === 'createFocusTrap') allowed.add('@aihu/primitives')
    walk(entryKey, cls, join(usePkgDir, srcPath), allowed)
  }

  // ---- families.json <-> package.json peer manifest ownership ----
  const usePkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
    peerDependencies?: Record<string, string>
    peerDependenciesMeta?: Record<string, { optional?: boolean }>
    devDependencies?: Record<string, string>
  }
  const declaredPeers = new Set(Object.keys(usePkgJson.peerDependencies ?? {}))
  const optionalPeers = new Set(
    Object.entries(usePkgJson.peerDependenciesMeta ?? {})
      .filter(([, v]) => v?.optional === true)
      .map(([k]) => k),
  )
  const devDeps = new Set(Object.keys(usePkgJson.devDependencies ?? {}))

  const active = new Set<string>()
  for (const entryKey of entries.keys()) {
    const cls = classifyEntry(entryKey, families)
    for (const p of allowedExternals(cls, families)) {
      if (p !== '@aihu/signals') active.add(p)
    }
  }

  for (const peer of active) {
    if (!declaredPeers.has(peer) || !optionalPeers.has(peer)) {
      errors.push(
        `FAIL [@aihu/use] families.json claims peer '${peer}' for an existing rolldown entry, but ` +
          `packages/use/package.json is missing it from peerDependencies + ` +
          `peerDependenciesMeta.${peer}.optional.`,
      )
    }
    if (!devDeps.has(peer)) {
      errors.push(
        `FAIL [@aihu/use] '${peer}' is claimed by an existing family entry but missing from ` +
          `packages/use/package.json devDependencies (tsc --noEmit / vitest cannot resolve it).`,
      )
    }
  }

  const allFamilyPeers = new Set<string>()
  for (const def of Object.values(families)) {
    for (const peers of Object.values(def.peers)) for (const p of peers) allFamilyPeers.add(p)
  }
  for (const peer of optionalPeers) {
    if (!allFamilyPeers.has(peer)) {
      errors.push(
        `FAIL [@aihu/use] '${peer}' is an optional peerDependency but is not claimed by any family ` +
          `in families.json — an orphaned peer declaration.`,
      )
    }
  }

  return { pass: errors.length === 0, errors }
}

function main(): void {
  let pass = checkPackageLevelDeps()

  const useResult = checkUseSubpathPurity()
  for (const e of useResult.errors) console.error(e)
  if (!useResult.pass) pass = false

  if (pass) {
    console.log('✓ All packages pass dep-free check (v3 thesis)')
    process.exit(0)
  } else {
    process.exit(1)
  }
}

// Only run main() when this file is executed directly. Test fixtures import
// the named exports (checkUseSubpathPurity, classifyEntry, ...) without
// triggering the CLI's console output / process.exit.
const isDirectRun =
  typeof process !== 'undefined' &&
  Boolean(process.argv[1]) &&
  resolve(process.argv[1] as string) === resolve(fileURLToPath(import.meta.url))

if (isDirectRun) {
  main()
}
