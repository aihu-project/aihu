#!/usr/bin/env bun
/**
 * `gen:composable-registry` — regenerate the LSP's `@aihu/use` completion +
 * hover table from each composable's own leading JSDoc in
 *      `packages/use/src/<...specifier-tail>/index.ts` — the one-line
 *      description after the `` `name` — `` prefix, already hand-written and
 *      maintained per FEL-342's ask for "hover docs (signature + one-line
 *      purpose)".
 *
 * Run after editing either source (adding a composable via `gen:use`, or
 * editing a composable's doc comment):
 *
 *   bun scripts/gen-composable-hover-registry.ts          # regenerate
 *   bun scripts/gen-composable-hover-registry.ts --check  # CI: fail if stale
 *
 * Emits packages/language-server/src/core/composable-registry.ts — checked
 * in (a real npm consumer of `@aihu/language-server` doesn't have
 * `packages/use/src` on disk, so this can't be read at the LSP's runtime).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
// Overridable so check-gate-wiring.ts's negative-fixture proof can point this
// at a fixture tree instead of the real repo (same shape as check-moon-graph.ts's
// MOON_GRAPH_ROOT) — never set these by hand.
const OUT_FILE = process.env.COMPOSABLE_REGISTRY_OUT
  ? resolve(ROOT, process.env.COMPOSABLE_REGISTRY_OUT)
  : join(ROOT, 'packages/language-server/src/core/composable-registry.ts')
const CONTRACT_FILE = process.env.COMPOSABLE_REGISTRY_CONTRACT_OUT
  ? resolve(ROOT, process.env.COMPOSABLE_REGISTRY_CONTRACT_OUT)
  : join(ROOT, 'packages/use/composable-registry.json')
const USE_SRC_ROOT = process.env.COMPOSABLE_USE_SRC_ROOT
  ? resolve(ROOT, process.env.COMPOSABLE_USE_SRC_ROOT)
  : join(ROOT, 'packages/use/src')

interface ComposableEntry {
  name: string
  specifier: string
  description: string
}

function parseRegistry(): { name: string; specifier: string }[] {
  // The legacy Rust registry override is retained for gate-wiring's tiny
  // fixture pair. Production generation reads root-owned @aihu/use sources;
  // the standalone compiler consumes the resulting published contract.
  const legacyRegistry = process.env.COMPOSABLE_REGISTRY_RS
    ? resolve(ROOT, process.env.COMPOSABLE_REGISTRY_RS)
    : undefined
  if (legacyRegistry && existsSync(legacyRegistry)) {
    const text = readFileSync(legacyRegistry, 'utf8')
    return [...text.matchAll(/\("([^"]+)",\s*"([^"]+)"\)/g)].map((match) => ({
      name: match[1],
      specifier: match[2],
    }))
  }
  const srcRoot = resolve(USE_SRC_ROOT)
  const familiesPath = join(ROOT, 'packages/use/families.json')
  const families = existsSync(familiesPath)
    ? ((
        JSON.parse(readFileSync(familiesPath, 'utf8')) as {
          families?: Record<string, { autoImport?: boolean }>
        }
      ).families ?? {})
    : {}
  const entries: { name: string; specifier: string }[] = []
  const walk = (dir: string, tail: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'shared') continue
      const nextTail = tail ? `${tail}/${entry.name}` : entry.name
      const index = join(dir, entry.name, 'index.ts')
      if (existsSync(index)) {
        // Only directories declared as families have aggregate indexes that
        // are not composables. A root-level composable such as useMouse also
        // has an index.ts and must be registered directly.
        if (!tail && families[entry.name]) {
          walk(join(dir, entry.name), nextTail)
          continue
        }
        const family = tail ? tail.split('/')[0] : undefined
        if (!family || families[family]?.autoImport === true) {
          entries.push({ name: entry.name, specifier: `@aihu/use/${nextTail}` })
        }
        continue
      }
      walk(join(dir, entry.name), nextTail)
    }
  }
  walk(srcRoot, '')
  return entries
}

/**
 * The leading doc comment's one-line purpose, e.g.
 * `` `useMouse` — reactive mouse position: the reference SENSOR composable ``
 * → "reactive mouse position: the reference SENSOR composable".
 *
 * The name — description dash may wrap across several `* `-prefixed lines
 * before hitting a `(docs/plans/...)` citation or a blank line; join them,
 * strip the citation, and cap length so a hover tooltip stays one line.
 */
function descriptionFor(specifier: string): string {
  // specifier is `@aihu/use/<tail>` or `@aihu/use/<family>/<tail>`.
  const tail = specifier.replace(/^@aihu\/use\//, '')
  const srcFile = join(USE_SRC_ROOT, tail, 'index.ts')
  let text: string
  try {
    text = readFileSync(srcFile, 'utf8')
  } catch {
    return ''
  }
  const blockMatch = text.match(/\/\*\*([\s\S]*?)\*\//)
  if (!blockMatch?.[1]) return ''
  const joined = blockMatch[1]
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  const m = joined.match(/`[\w$]+`\s*(?:\([^)]*\)\s*)?—\s*(.+)/)
  if (!m?.[1]) return ''
  let desc = m[1]
    .replace(/\(docs\/plans\/[^)]*\)/g, '')
    .replace(/\(§[^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  // Cut at the first sentence boundary so the hover stays one line.
  const period = desc.indexOf('. ')
  if (period > 20) desc = desc.slice(0, period)
  desc = desc.replace(/[.:,]$/, '').trim()
  return desc.length > 140 ? `${desc.slice(0, 137)}...` : desc
}

function main(): void {
  const check = process.argv.includes('--check')
  let existing = ''
  if (check) {
    try {
      existing = readFileSync(OUT_FILE, 'utf8')
    } catch {
      existing = ''
    }
  }
  const raw = parseRegistry()
  const entries: ComposableEntry[] = raw
    .map(({ name, specifier }) => ({ name, specifier, description: descriptionFor(specifier) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // This JSON is the portable contract. It is shipped by @aihu/use so the
  // language server and compiler can validate/consume the registry after the
  // package leaves this monorepo; neither consumer needs packages/use/src.
  const contract = `${JSON.stringify(
    {
      schemaVersion: 1,
      package: '@aihu/use',
      entries,
    },
    null,
    2,
  )}\n`

  const lines: string[] = []
  lines.push('/**')
  lines.push(' * packages/language-server/src/core/composable-registry.ts')
  lines.push(' *')
  lines.push(' * GENERATED — do not hand-edit. Source of truth:')
  lines.push(' *   packages/use/src/<name>/index.ts (names, specifiers, and doc comments)')
  lines.push(' *')
  lines.push(' * Regenerate: bun scripts/gen-composable-hover-registry.ts')
  lines.push(' * (FEL-342 / #427 follow-up — LSP composable-awareness)')
  lines.push(' */')
  lines.push('')
  lines.push('export interface ComposableRegistryEntry {')
  lines.push('  /** Bare call name, e.g. `useMouse`. */')
  lines.push('  name: string')
  lines.push('  /** Module specifier the compiler auto-imports, e.g. `@aihu/use/useMouse`. */')
  lines.push('  specifier: string')
  lines.push("  /** One-line purpose, extracted from the composable's doc comment. */")
  lines.push('  description: string')
  lines.push('}')
  lines.push('')
  lines.push('export const COMPOSABLE_REGISTRY: readonly ComposableRegistryEntry[] = [')
  for (const e of entries) {
    const desc = e.description.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    lines.push(`  { name: '${e.name}', specifier: '${e.specifier}', description: '${desc}' },`)
  }
  lines.push(']')
  lines.push('')
  const output = lines.join('\n')

  // Biome's formatter (line wrapping, quote style) is the actual style this
  // repo enforces via `check:lint` — write raw, then let it reformat, so the
  // committed file always matches what `bun run check:lint` expects rather
  // than this script's own guess at formatting.
  // `--check` must be READ-ONLY. It used to write OUT_FILE, format it in
  // place, compare, then restore — which left the tracked file dirty if the
  // process died between write and restore, and printed a confusing
  // "Fixed 1 file" into every CI run for a step that is supposed to inspect,
  // not mutate. Format a temp copy instead; the real file is only written on a
  // genuine (non-check) regeneration.
  // The temp copy MUST keep a .ts extension — biome picks its formatter from
  // the file extension, and a `.tmp` name is left unformatted, which made the
  // comparison report a false 'stale'. Placed in the OS temp dir so a crash
  // cannot leave a stray .ts file inside the package for tsc to pick up.
  const target = check ? join(tmpdir(), `aihu-composable-registry.check.ts`) : OUT_FILE
  writeFileSync(target, output)
  spawnSync('bunx', ['biome', 'format', '--write', target], { stdio: 'inherit' })

  if (check) {
    const formatted = readFileSync(target, 'utf8')
    rmSync(target, { force: true })
    if (existing !== formatted) {
      console.error(
        `[gen-composable-registry] ${basename(OUT_FILE)} is stale — run: bun scripts/gen-composable-hover-registry.ts`,
      )
      process.exit(1)
    }
    let existingContract = ''
    try {
      existingContract = readFileSync(CONTRACT_FILE, 'utf8')
    } catch {
      existingContract = ''
    }
    if (existingContract !== contract) {
      console.error(
        `[gen-composable-registry] ${basename(CONTRACT_FILE)} is stale — run: bun scripts/gen-composable-hover-registry.ts`,
      )
      process.exit(1)
    }
    console.log('[gen-composable-registry] up to date')
    return
  }

  writeFileSync(CONTRACT_FILE, contract)
  console.log(
    `[gen-composable-registry] wrote ${entries.length} entries to ${OUT_FILE} and ${CONTRACT_FILE}`,
  )
}

main()
