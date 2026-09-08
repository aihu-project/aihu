#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
/**
 * `gen:use` — scaffold a new `@aihu/use` composable's touch points, family-aware.
 *
 * A CORE composable has five root-owned touch points (src dir, barrel,
 * package.json exports, rolldown input, .size-limit.json row) PLUS
 * an optional 7th (a Tier-2 row in tests/ssr-safety.test.ts, required only
 * when the implementation references `isClient`). A FAMILY composable
 * (`--family math`) has the same shape, except: its barrel lives at
 * `src/<family>/index.ts` (never the CORE barrel — the one-way rule forbids
 * it). The compiler auto-import registry is maintained in the standalone
 * aihu-compiler repository; this command prints a handoff reminder for
 * auto-import families.
 *
 * Usage:
 *   bun scripts/gen-use.ts <name> [<name>...] [--bare] [--family <family>]
 *   bun run gen:use <name> [<name>...] [--bare] [--family <family>]
 *
 * `<name>` must match `^use[A-Z]` (e.g. `useMap`) unless `--bare` is passed,
 * for the rare non-`use`-prefixed case (e.g. `watch`) — the scaffolder does
 * not force every future composable into the `useX` mold, but requires the
 * author to consciously opt out of the convention.
 *
 * `--family <family>` must name a family already declared in
 * `packages/use/families.json` — adding a NEW family is a deliberate,
 * reviewed edit to that file (plus a dep-check/parity review), never a
 * scaffolder side effect.
 *
 * Multiple names in one invocation land together so the root-owned manifest
 * edits remain reviewable as one wave. Coordinate the corresponding compiler
 * registry update in aihu-compiler before publishing.
 *
 * Every patch step is "check first, patch if absent, log SKIPPED if
 * present" — running this twice in a row is a no-op the second time, which
 * is what makes the self-check safe to run unconditionally.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Escape every regex-special character so a CLI-provided name (composable
 * name, size-limit row name, use-registry call name) is matched LITERALLY —
 * not interpreted as regex syntax. Without this, a name containing `.`/`*`/
 * etc. silently false-positive-matches (`use.Map` would match `useXMap`) or
 * throws on unbalanced `(`/`[`. CodeQL flags the unescaped construction as
 * `js/regex-injection`. */
function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------- families.json ----------

export interface FamilyDef {
  aggregate: boolean
  autoImport: boolean
  memberLimit: string
  aggregateLimit?: string
  peers: Record<string, string[]>
}

export interface FamiliesFile {
  families: Record<string, FamilyDef>
}

export function loadFamilies(familiesJsonSrc: string): Record<string, FamilyDef> {
  return (JSON.parse(familiesJsonSrc) as FamiliesFile).families ?? {}
}

export function validateFamily(
  family: string | undefined,
  families: Record<string, FamilyDef>,
): void {
  if (family === undefined) return
  if (!Object.hasOwn(families, family)) {
    const known = Object.keys(families).sort().join(', ') || '(none declared)'
    throw new Error(
      `'--family ${family}' is not declared in packages/use/families.json. Known families: ${known}. ` +
        `Adding a new family is a deliberate edit to families.json (plus a dep-check/parity review) — ` +
        `never a scaffolder side effect.`,
    )
  }
}

/** Peer package(s) THIS composable (as opposed to the whole family) is
 * allowed to import — `peers['*']` (family-wide) union `peers[name]`
 * (member-specific). Empty for dep-free families (math, motion). */
export function peersFor(
  family: string | undefined,
  name: string,
  families: Record<string, FamilyDef>,
): string[] {
  if (!family) return []
  const def = families[family]
  if (!def) return []
  return [...(def.peers['*'] ?? []), ...(def.peers[name] ?? [])]
}

// ---------- Naming ----------

/**
 * The descriptive suffix used for the stub's `Use<Name>Options`/`Return`
 * interface names: for a `useX`-prefixed name this is `X` (`useCounter` ->
 * `Counter`, matching every existing composable's own interface naming);
 * for a `--bare` name with no `use` prefix, it's the whole name PascalCased
 * (`watch` -> `Watch`). Bare-name authors are expected to heavily rework
 * the generic stub anyway (see the manual checklist) — this is a starting
 * point, not a naming contract for non-`use`-prefixed composables.
 */
export function pascalSuffix(name: string): string {
  if (/^use[A-Z]/.test(name)) return name.slice(3)
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** `useEventListenerMap` -> `use-event-listener-map` (test-file naming). */
export function toKebabCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

export function validateName(name: string, bare: boolean): void {
  if (!bare && !/^use[A-Z]/.test(name)) {
    throw new Error(
      `'${name}' does not match the ^use[A-Z] convention (e.g. useMap). ` +
        `Pass --bare to explicitly opt out for a deliberately non-use-prefixed ` +
        `name (e.g. watch).`,
    )
  }
}

// ---------- 1. src stub ----------

export function stubContent(name: string, family: string | undefined, peers: string[]): string {
  const pascal = pascalSuffix(name)
  const sharedImportPath = family ? '../../shared/index.ts' : '../shared/index.ts'
  const peerNote =
    peers.length > 0
      ? `\n * Optional peer(s): ${peers.join(', ')}. This file is the ONLY place that specifier\n` +
        ' * may appear (dep-check enforces this per-entry, not just per-package). The composable\n' +
        ' * must fail gracefully at CALL time if the peer is missing at runtime — never at module\n' +
        ' * scope (a top-level throw would break every consumer, even ones that never call this).\n'
      : ''
  return `/**
 * \`${name}\` — TODO: one-line description
 * (docs/plans/2026-07-22-effect-scope-and-composables.md §5).
 *
 * Return convention (ratified): an object of named getters, signals under
 * the hood. Readers in .aihu templates MUST call getters with parens:
 * \`{value()}\`, never bare \`{value}\`.
 *
 * SSR (\`isClient === false\`): TODO — describe the static/no-op return.${peerNote}
 */
import { isClient } from '${sharedImportPath}'

export interface Use${pascal}Options {}
export interface Use${pascal}Return {}

export function ${name}(options: Use${pascal}Options = {}): Use${pascal}Return {
  if (!isClient) {
    // TODO: no-op under SSR — return static default getters here (see
    // packages/use/src/useMediaQuery or useDocumentVisibility for the house
    // pattern). Never throw: SSR must be a safe no-op, not a crash.
    return {} as Use${pascal}Return
  }
  throw new Error('TODO: implement')
}
`
}

// ---------- 2. barrel (packages/use/src/index.ts OR src/<family>/index.ts) ----------

interface BarrelMatch {
  name: string
  start: number
  end: number
}

/** Every `export (type )?{...} from './NAME/index.ts'` statement, in order. */
function findBarrelMatches(src: string): BarrelMatch[] {
  const re = /export (?:type )?\{[\s\S]*?\} from '\.\/(\w+)\/index\.ts'\n?/g
  const matches: BarrelMatch[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    matches.push({ name: m[1], start: m.index, end: m.index + m[0].length })
  }
  return matches
}

/** Offset to insert a new composable's block at, preserving alpha order. */
function findBarrelInsertionOffset(src: string, name: string): number {
  const matches = findBarrelMatches(src)
  const composableMatches = matches.filter((m) => m.name !== 'shared')
  if (composableMatches.length === 0) {
    return matches.length > 0 ? matches[matches.length - 1].end : src.length
  }
  const firstStart = new Map<string, number>()
  for (const m of composableMatches) {
    if (!firstStart.has(m.name)) firstStart.set(m.name, m.start)
  }
  for (const [existingName, start] of firstStart) {
    if (existingName > name) return start
  }
  return composableMatches[composableMatches.length - 1].end
}

/** CORE barrel patch — unchanged behavior, used only when `--family` is absent. */
export function patchBarrel(barrelSrc: string, name: string): { text: string; changed: boolean } {
  const alreadyPresent = new RegExp(`from '\\./${escapeRegex(name)}/index\\.ts'`).test(barrelSrc)
  if (alreadyPresent) return { text: barrelSrc, changed: false }

  const pascal = pascalSuffix(name)
  const block =
    `export type { Use${pascal}Options, Use${pascal}Return } from './${name}/index.ts'\n` +
    `export { ${name} } from './${name}/index.ts'\n`
  const offset = findBarrelInsertionOffset(barrelSrc, name)
  const text = barrelSrc.slice(0, offset) + block + barrelSrc.slice(offset)
  return { text, changed: true }
}

/**
 * Family barrel patch — `src/<family>/index.ts`. Creates the file (with a
 * header comment naming the family) if absent. Only called for
 * `aggregate: true` families — `aggregate: false` families (e.g.
 * `integrations`) never get a barrel; the caller skips this step entirely
 * and logs why (a bare aggregate import is a hard `vite build` resolution
 * break for a family whose members carry different optional peers).
 */
export function patchFamilyBarrel(
  familyBarrelSrc: string | undefined,
  family: string,
  name: string,
): { text: string; changed: boolean; created: boolean } {
  const created = familyBarrelSrc === undefined
  const base =
    familyBarrelSrc ??
    `/**\n * \`@aihu/use/${family}\` — family aggregate barrel (namespace-wave0).\n` +
      ` * Re-exports every ${family} member for the bare \`@aihu/use/${family}\` entry.\n */\n`
  const alreadyPresent = new RegExp(`from '\\./${escapeRegex(name)}/index\\.ts'`).test(base)
  if (alreadyPresent) return { text: base, changed: false, created: false }

  const pascal = pascalSuffix(name)
  const block =
    `export type { Use${pascal}Options, Use${pascal}Return } from './${name}/index.ts'\n` +
    `export { ${name} } from './${name}/index.ts'\n`
  const offset = findBarrelInsertionOffset(base, name)
  const text = base.slice(0, offset) + block + base.slice(offset)
  return { text, changed: true, created }
}

// ---------- 3. packages/use/package.json exports ----------

/**
 * Sort rank for a non-fixed exports key, used by `patchPackageExports`'s
 * comparator: `[0, coreName]` sorts CORE keys alphabetically among
 * themselves; `[1, family, isMember, memberName]` groups every family
 * key together, aggregate (`isMember: 0`) before its members
 * (`isMember: 1`, alphabetical). Without this, `./math` and `./motion`
 * interleave alphabetically into the middle of the core list and every
 * future scaffold produces a scattered diff.
 */
export function exportKeyRank(
  key: string,
  families: Record<string, FamilyDef>,
): [number, string, number, string] {
  const name = key.slice(2) // strip leading './'
  const slash = name.indexOf('/')
  if (slash === -1) {
    if (families[name]) return [1, name, 0, ''] // family aggregate
    return [0, name, 0, ''] // CORE composable
  }
  return [1, name.slice(0, slash), 1, name.slice(slash + 1)]
}

export function patchPackageExports(
  pkg: { exports?: Record<string, unknown> },
  name: string,
  family: string | undefined,
  families: Record<string, FamilyDef>,
): { memberAdded: boolean; aggregateAdded: boolean } {
  const memberKey = family ? `./${family}/${name}` : `./${name}`
  const memberPath = family ? `${family}/${name}` : name
  const exportsMap = pkg.exports ?? {}
  let memberAdded = false
  let aggregateAdded = false

  if (!Object.hasOwn(exportsMap, memberKey)) {
    exportsMap[memberKey] = {
      types: `./dist/${memberPath}.d.ts`,
      import: `./dist/${memberPath}.js`,
    }
    memberAdded = true
  }

  if (family && families[family]?.aggregate) {
    const aggKey = `./${family}`
    if (!Object.hasOwn(exportsMap, aggKey)) {
      exportsMap[aggKey] = { types: `./dist/${family}.d.ts`, import: `./dist/${family}.js` }
      aggregateAdded = true
    }
  }

  if (!memberAdded && !aggregateAdded) {
    pkg.exports = exportsMap
    return { memberAdded, aggregateAdded }
  }

  const entries = Object.entries(exportsMap)
  const fixed = entries.filter(([k]) => k === '.' || k === './shared')
  const rest = entries.filter(([k]) => k !== '.' && k !== './shared')
  rest.sort((a, b) => {
    const ra = exportKeyRank(a[0], families)
    const rb = exportKeyRank(b[0], families)
    if (ra[0] !== rb[0]) return ra[0] - rb[0]
    if (ra[1] !== rb[1]) return ra[1].localeCompare(rb[1])
    if (ra[2] !== rb[2]) return ra[2] - rb[2]
    return ra[3].localeCompare(rb[3])
  })
  pkg.exports = Object.fromEntries([...fixed, ...rest])
  return { memberAdded, aggregateAdded }
}

// ---------- 4. packages/use/rolldown.config.ts input ----------

interface RolldownEntryMatch {
  key: string
  start: number
  end: number
  indent: string
}

/** Widened to accept both the bare CORE form (`useCounter: '...'`) and the
 * quoted family form (`'math/useClamp': '...'`) — the plain `\w+` key regex
 * cannot match a slash. */
function findRolldownEntries(src: string): RolldownEntryMatch[] {
  const entryRe = /^(\s*)'?([\w/]+)'?:\s*'src\/[\w/]+\/index\.ts',?\s*$/gm
  const entries: RolldownEntryMatch[] = []
  let m: RegExpExecArray | null
  while ((m = entryRe.exec(src)) !== null) {
    // `$` (no `s` flag) matches before the line's `\n`, not after it — bump
    // `end` past the newline too, or an "insert after the last match"
    // splice glues the new line onto the tail of the previous one instead
    // of starting a fresh line.
    let end = m.index + m[0].length
    if (src[end] === '\n') end += 1
    entries.push({ key: m[2], start: m.index, end, indent: m[1] })
  }
  return entries
}

function rolldownLine(indent: string, key: string, valuePath: string): string {
  const quotedKey = key.includes('/') ? `'${key}'` : key
  return `${indent}${quotedKey}: '${valuePath}',\n`
}

/**
 * Insert one rolldown input entry (member OR aggregate — same shape, an
 * aggregate key is just a bare family name with `src/<family>/index.ts`).
 * CORE entries keep the existing alphabetical-within-the-core-block
 * behavior; family entries land in a family-grouped block AFTER every core
 * entry (aggregate before its own members, families alphabetical among
 * themselves) — see `exportKeyRank`'s ordering, mirrored here without the
 * dependency on `families` (rank is derivable from the key shape alone:
 * no-slash-and-unclassified = core, else family).
 */
export function patchRolldownEntry(
  src: string,
  key: string,
  valuePath: string,
  isFamilyKey: boolean,
): { text: string; changed: boolean } {
  const alreadyPresent = findRolldownEntries(src).some((e) => e.key === key)
  if (alreadyPresent) return { text: src, changed: false }

  const entries = findRolldownEntries(src)
  if (entries.length === 0) {
    throw new Error(
      "rolldown.config.ts: no `key: 'src/.../index.ts'` entries found to anchor insertion",
    )
  }

  if (!isFamilyKey) {
    // CORE — unchanged behavior: 'index'/'shared' first, unsorted; every
    // other CORE entry alphabetical. Family entries (slash key, or a bare
    // key matching a family name) are never a valid insertion target here.
    const coreEntries = entries.filter(
      (e) => e.key !== 'index' && e.key !== 'shared' && !e.key.includes('/'),
    )
    const indent = (coreEntries[0] ?? entries[entries.length - 1]).indent
    const newLine = rolldownLine(indent, key, valuePath)
    const target = coreEntries.find((e) => e.key > key)
    const insertAt = target ? target.start : entries[entries.length - 1].end
    return { text: src.slice(0, insertAt) + newLine + src.slice(insertAt), changed: true }
  }

  // Family entry: `key` is either `<family>` (aggregate) or `<family>/<member>`.
  const family = key.includes('/') ? key.slice(0, key.indexOf('/')) : key
  const sameFamilyEntries = entries.filter(
    (e) => e.key === family || e.key.startsWith(`${family}/`),
  )
  const indent = (sameFamilyEntries[0] ?? entries[entries.length - 1]).indent
  const newLine = rolldownLine(indent, key, valuePath)

  if (sameFamilyEntries.length === 0) {
    // First entry ever for this family — append at the very end of the block.
    const insertAt = entries[entries.length - 1].end
    return { text: src.slice(0, insertAt) + newLine + src.slice(insertAt), changed: true }
  }

  // Aggregate key always sorts first within its family block; members are
  // inserted in alphabetical order after it.
  if (!key.includes('/')) {
    const insertAt = sameFamilyEntries[0].start
    return { text: src.slice(0, insertAt) + newLine + src.slice(insertAt), changed: true }
  }
  const memberEntries = sameFamilyEntries.filter((e) => e.key.includes('/'))
  const target = memberEntries.find((e) => e.key > key)
  const insertAt = target ? target.start : sameFamilyEntries[sameFamilyEntries.length - 1].end
  return { text: src.slice(0, insertAt) + newLine + src.slice(insertAt), changed: true }
}

// ---------- 5. root .size-limit.json ----------

/**
 * Text-based (not JSON.parse + JSON.stringify) on purpose: the file mixes
 * inline arrays (`"ignore": ["@aihu/signals"]`) with multi-line objects, a
 * style `JSON.stringify(..., null, 2)` cannot reproduce (it always expands
 * every array, one element per line) — round-tripping through the parsed
 * structure would reformat the ENTIRE file into a mass of unrelated diff
 * noise. Splicing new text in preserves everyone else's formatting exactly,
 * touching only the lines this composable adds.
 *
 * The anchor regex is widened from `"name": "@aihu\/use\/\w+"` to
 * `"name": "@aihu\/use\/[\w/]+"` — the old pattern stops finding the LAST
 * `@aihu/use/*` row once a nested family row (`@aihu/use/math/useClamp`)
 * exists, silently anchoring insertion to the wrong place.
 */
export function patchSizeLimit(
  src: string,
  rowName: string,
  path: string,
  limit: string,
  ignore: string[],
): { text: string; changed: boolean } {
  if (new RegExp(`"name": "${escapeRegex(rowName)}"`).test(src)) {
    return { text: src, changed: false }
  }

  const blockRe = / {2}\{\n {4}"name": "@aihu\/use\/[\w/]+",\n(?:.*\n)*? {2}\},\n/g
  let m: RegExpExecArray | null
  let lastBlockEnd = -1
  while ((m = blockRe.exec(src)) !== null) {
    lastBlockEnd = m.index + m[0].length
  }
  if (lastBlockEnd === -1) {
    throw new Error(
      'could not find an existing "@aihu/use/*" row in .size-limit.json to anchor insertion',
    )
  }

  const ignoreJson = JSON.stringify(ignore)
  const newBlock =
    '  {\n' +
    `    "name": "${rowName}",\n` +
    `    "path": "${path}",\n` +
    `    "limit": "${limit}",\n` +
    '    "gzip": true,\n' +
    `    "ignore": ${ignoreJson}\n` +
    '  },\n'
  const text = src.slice(0, lastBlockEnd) + newBlock + src.slice(lastBlockEnd)
  return { text, changed: true }
}

// ---------- 6. standalone compiler registry handoff ----------

export function patchUseRegistryRs(
  src: string,
  callName: string,
  subpath: string,
): { text: string; changed: boolean } {
  const alreadyPresent = new RegExp(`\\("${escapeRegex(callName)}",`).test(src)
  if (alreadyPresent) return { text: src, changed: false }

  const marker = 'USE_COMPOSABLES: &[(&str, &str)] = &['
  const markerIdx = src.indexOf(marker)
  if (markerIdx === -1) {
    throw new Error('could not find `USE_COMPOSABLES: &[(&str, &str)] = &[` in use_registry.rs')
  }
  const closeIdx = src.indexOf('];', markerIdx)
  if (closeIdx === -1) {
    throw new Error('could not find the closing `];` for USE_COMPOSABLES in use_registry.rs')
  }
  // Landing order, not alphabetical — append-only is the safe move here too.
  const line = `    ("${callName}", "@aihu/use/${subpath}"),\n`
  const text = src.slice(0, closeIdx) + line + src.slice(closeIdx)
  return { text, changed: true }
}

// ---------- CLI entrypoint ----------

function findRepoRoot(start: string): string {
  let dir = start
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, '.size-limit.json')) && existsSync(join(dir, 'packages'))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(
    `Could not locate repo root (no .size-limit.json + packages/ found above ${start})`,
  )
}

function scaffoldOne(
  repoRoot: string,
  name: string,
  _bare: boolean,
  family: string | undefined,
  families: Record<string, FamilyDef>,
): void {
  const useDir = join(repoRoot, 'packages/use')
  const def = family ? families[family] : undefined
  const peers = peersFor(family, name, families)

  console.log(`\n  gen:use — scaffolding '${family ? `${family}/${name}` : name}'\n`)

  // 1. src stub — never overwrites a hand-authored file.
  const srcDir = family ? join(useDir, 'src', family, name) : join(useDir, 'src', name)
  const stubPath = join(srcDir, 'index.ts')
  const relStub = family
    ? `packages/use/src/${family}/${name}/index.ts`
    : `packages/use/src/${name}/index.ts`
  if (existsSync(stubPath)) {
    console.log(`  [skip] ${relStub} already exists`)
  } else {
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(stubPath, stubContent(name, family, peers))
    console.log(`  [ok]   created ${relStub}`)
  }

  // 2. barrel
  if (!family) {
    const barrelPath = join(useDir, 'src/index.ts')
    const barrelResult = patchBarrel(readFileSync(barrelPath, 'utf8'), name)
    if (barrelResult.changed) {
      writeFileSync(barrelPath, barrelResult.text)
      console.log('  [ok]   patched packages/use/src/index.ts (barrel export)')
    } else {
      console.log(`  [skip] packages/use/src/index.ts already exports '${name}'`)
    }
  } else if (def?.aggregate) {
    const familyBarrelPath = join(useDir, 'src', family, 'index.ts')
    const existingSrc = existsSync(familyBarrelPath)
      ? readFileSync(familyBarrelPath, 'utf8')
      : undefined
    const result = patchFamilyBarrel(existingSrc, family, name)
    if (result.changed) {
      mkdirSync(join(useDir, 'src', family), { recursive: true })
      writeFileSync(familyBarrelPath, result.text)
      console.log(
        `  [ok]   ${result.created ? 'created' : 'patched'} packages/use/src/${family}/index.ts (family barrel)`,
      )
    } else {
      console.log(`  [skip] packages/use/src/${family}/index.ts already exports '${name}'`)
    }
  } else {
    console.log(
      `  [skip] family '${family}' has aggregate: false — no family barrel is ever created for it ` +
        `(a bare aggregate import is a hard vite-build resolution break for a family whose members ` +
        `carry different optional peers).`,
    )
  }

  // 3. package.json exports
  const pkgPath = join(useDir, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { exports?: Record<string, unknown> }
  const { memberAdded, aggregateAdded } = patchPackageExports(pkg, name, family, families)
  if (memberAdded || aggregateAdded) {
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
    if (memberAdded) {
      console.log(
        `  [ok]   patched packages/use/package.json (exports: './${family ? `${family}/${name}` : name}')`,
      )
    }
    if (aggregateAdded) {
      console.log(`  [ok]   patched packages/use/package.json (exports: './${family}' aggregate)`)
    }
  } else {
    console.log(`  [skip] packages/use/package.json already has the required exports key(s)`)
  }

  // 4. rolldown.config.ts input
  const rolldownPath = join(useDir, 'rolldown.config.ts')
  let rolldownSrc = readFileSync(rolldownPath, 'utf8')
  let rolldownChanged = false
  if (family && def?.aggregate) {
    const aggResult = patchRolldownEntry(rolldownSrc, family, `src/${family}/index.ts`, true)
    if (aggResult.changed) {
      rolldownSrc = aggResult.text
      rolldownChanged = true
      console.log(`  [ok]   patched packages/use/rolldown.config.ts (input: '${family}' aggregate)`)
    }
  }
  const memberKey = family ? `${family}/${name}` : name
  const memberResult = patchRolldownEntry(
    rolldownSrc,
    memberKey,
    `src/${memberKey}/index.ts`,
    Boolean(family),
  )
  if (memberResult.changed) {
    rolldownSrc = memberResult.text
    rolldownChanged = true
    console.log(`  [ok]   patched packages/use/rolldown.config.ts (input: '${memberKey}')`)
  } else {
    console.log(`  [skip] packages/use/rolldown.config.ts already has an input for '${memberKey}'`)
  }
  if (rolldownChanged) writeFileSync(rolldownPath, rolldownSrc)

  // 5. root .size-limit.json
  const sizeLimitPath = join(repoRoot, '.size-limit.json')
  let sizeLimitSrc = readFileSync(sizeLimitPath, 'utf8')
  let sizeLimitChanged = false
  const distPathFor = (key: string) => `packages/use/dist/${key}.js`
  if (family && def?.aggregate) {
    const aggResult = patchSizeLimit(
      sizeLimitSrc,
      `@aihu/use/${family}`,
      distPathFor(family),
      def.aggregateLimit ?? '<TODO-CALIBRATE> B',
      ['@aihu/signals', ...new Set(Object.values(def.peers).flat())],
    )
    if (aggResult.changed) {
      sizeLimitSrc = aggResult.text
      sizeLimitChanged = true
      console.log(`  [ok]   patched .size-limit.json (aggregate row for '@aihu/use/${family}')`)
    }
  }
  const rowName = family ? `@aihu/use/${family}/${name}` : `@aihu/use/${name}`
  const limit = def?.memberLimit ?? '<TODO-CALIBRATE> B'
  const ignore = ['@aihu/signals', ...peers]
  const memberSizeResult = patchSizeLimit(
    sizeLimitSrc,
    rowName,
    distPathFor(memberKey),
    limit,
    ignore,
  )
  if (memberSizeResult.changed) {
    sizeLimitSrc = memberSizeResult.text
    sizeLimitChanged = true
    console.log(`  [ok]   patched .size-limit.json (row for '${rowName}')`)
    if (!def) {
      console.log(
        '  [!!!]  REMINDER: `<TODO-CALIBRATE> B` is a PLACEHOLDER. Run `bun run build && bun run size` ' +
          `once '${name}' is implemented and replace it with the real measured gzip size before merging.`,
      )
    } else {
      console.log(
        `  [note] limit '${limit}' comes from families.json's memberLimit for '${family}' — a ` +
          'measured FAMILY CEILING, not a per-composable guess. Confirm the ceiling still holds once ' +
          "'" +
          name +
          "' is implemented (`bun run build && bun run size`); re-tighten once the family has >=3 members.",
      )
    }
  } else {
    console.log(`  [skip] .size-limit.json already has a row for '${rowName}'`)
  }
  if (sizeLimitChanged) writeFileSync(sizeLimitPath, sizeLimitSrc)

  const autoImport = family ? (def?.autoImport ?? false) : true
  if (!autoImport) {
    console.log(
      `  [note] '${name}' is in an optional-peer family (autoImport: false) — deliberately NOT ` +
        'auto-imported; authors import it explicitly. Injecting this import would hard-break bundling ' +
        `in apps without its peer (verified: vite fails at resolution, before tree-shaking).`,
    )
  } else {
    console.log(
      `  [handoff] register '${name}' in the standalone aihu-compiler repository's published ` +
        'auto-import registry before releasing the matching compiler version.',
    )
  }

  // 7. manual checklist
  console.log('\n  Manual follow-ups (this scaffolder deliberately does NOT do these):')
  const implPath = family
    ? `packages/use/src/${family}/${name}/index.ts`
    : `packages/use/src/${name}/index.ts`
  console.log(`   - Implement the composable body in ${implPath} (replace the TODOs).`)
  const testPath = family
    ? `packages/use/tests/${family}/${toKebabCase(name)}.test.ts`
    : `packages/use/tests/${toKebabCase(name)}.test.ts`
  console.log(`   - Add a test file: ${testPath}.`)
  console.log(
    `   - Add a row to packages/use/tests/ssr-safety.test.ts's Tier-2 \`entries\` array for ` +
      `'${memberKey}' — REQUIRED (the parity gate enforces it) if your implementation references ` +
      '`isClient`; optional otherwise.',
  )
  console.log(
    '   - Run `bun run build && bun run size`, then confirm/replace the .size-limit.json limit.',
  )
  if (peers.length > 0) {
    console.log(
      `   - '${name}' has declared optional peer(s) ${peers.join(', ')} — add them to ` +
        'packages/use/package.json devDependencies if not already present (needed for ' +
        'tsc --noEmit / vitest to resolve them), and confirm peerDependencies + ' +
        'peerDependenciesMeta.<peer>.optional are set.',
    )
  }
}

function main(): void {
  const args = process.argv.slice(2)
  const bare = args.includes('--bare')
  const familyIdx = args.indexOf('--family')
  const family = familyIdx !== -1 ? args[familyIdx + 1] : undefined
  const names = args.filter(
    (a, i) => !a.startsWith('--') && !(familyIdx !== -1 && i === familyIdx + 1),
  )

  if (names.length === 0) {
    console.error('Usage: bun scripts/gen-use.ts <name> [<name>...] [--bare] [--family <family>]')
    console.error('  e.g. bun scripts/gen-use.ts useMap')
    console.error('       bun scripts/gen-use.ts watch --bare')
    console.error('       bun scripts/gen-use.ts useClamp useSum useMin --family math')
    process.exit(2)
  }

  const here = dirname(fileURLToPath(import.meta.url))
  const repoRoot = findRepoRoot(resolve(here))
  const familiesPath = join(repoRoot, 'packages/use/families.json')
  const families: Record<string, FamilyDef> = existsSync(familiesPath)
    ? loadFamilies(readFileSync(familiesPath, 'utf8'))
    : {}

  validateFamily(family, families)
  for (const name of names) validateName(name, bare)

  if (names.length > 1) {
    console.log(
      `\n  Scaffolding ${names.length} composables together: ${names.join(', ')}` +
        (family ? ` (family: ${family})` : '') +
        `.\n  Root-owned artifacts land together; coordinate the standalone compiler ` +
        `registry handoff shown for each auto-import family before publishing.\n`,
    )
  }

  for (const name of names) {
    scaffoldOne(repoRoot, name, bare, family, families)
  }

  // 8. self-verify — immediate feedback instead of waiting for CI.
  const parityScriptPath = join(repoRoot, 'scripts/check-use-registry-parity.ts')
  if (existsSync(parityScriptPath)) {
    console.log('\n  Self-check — bun run check:use-registry-parity\n')
    const parityResult = spawnSync('bun', ['run', 'check:use-registry-parity'], {
      cwd: repoRoot,
      stdio: 'inherit',
    })
    if (parityResult.status !== 0) {
      console.log(
        '\n  (parity check reported issues above — expected until the manual follow-ups are ' +
          'done, e.g. an unimplemented stub or a missing ssr-safety.test.ts row is NOT what this ' +
          'check covers; a genuine touch-point gap is)',
      )
    }
  } else {
    console.log('\n  (scripts/check-use-registry-parity.ts not present yet — skipping self-check)')
  }

  console.log('\n  Self-check — bun run check:deps (subpath purity + peer ownership)\n')
  const depCheckPath = join(repoRoot, 'scripts/dep-check.ts')
  if (existsSync(depCheckPath)) {
    spawnSync('bun', ['run', 'check:deps'], { cwd: repoRoot, stdio: 'inherit' })
  }

  console.log('')
}

// Only run main() when this file is executed directly. The test fixture
// imports the named exports without triggering the CLI.
const isDirectRun =
  typeof process !== 'undefined' &&
  Boolean(process.argv[1]) &&
  resolve(process.argv[1] as string) === resolve(fileURLToPath(import.meta.url))

if (isDirectRun) {
  try {
    main()
  } catch (err) {
    console.error(`  FATAL: ${(err as Error).message}`)
    process.exit(2)
  }
}
