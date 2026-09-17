/**
 * `aihu add <names...>` — copy styled recipes from the installed `@aihu/ui`
 * registry into the consumer's `ui.target` directory (Plan 5 Task 6, spec §9.6).
 *
 * Flow (spec §9.6 steps 1–6):
 *   1. Read `ui.{registry,target,prefix,style}` from `vite.config.ts` (or the
 *      legacy `aihu.config.ts`) (defaults at read-time)
 *   2. Resolve requested items + their `registryDependencies` transitively (R8)
 *   3. Read the `.aihu` source(s) directly from the installed package (R3)
 *   4. Preflight target collisions
 *   5. For each file: run the prefix transform (aihu- → <prefix>-) then write
 *   6. Update the `ui.primitives` record (record-only, D-4); print `added N files.`
 *
 * Flags:
 *   --prefix <p>   override `ui.prefix` for this copy (one-off, spec §9.4)
 *   --style <s>    override `ui.style` (recorded; the engine reads it at build)
 *   --dry-run      print the plan, write nothing
 *   --diff         print a unified diff against any existing target file
 *   --force        overwrite on collision (R9); without it a collision aborts
 *
 * Error paths (R6) surface as actionable messages + `process.exit(1)`.
 *
 * Prefix substitution (D-3): the existing `scaffold-pipeline.ts`
 * `readSubstituteWrite` machinery is placeholder-token-driven
 * (`__APP_NAME__`, …) and coupled to the template-manifest flow — it cannot do
 * the `aihu-` → `<prefix>-` recipe rewrite. Per the D-3 fallback, the rewrite is
 * a focused local `substitutePrefix` (only this step diverges from reuse). It
 * rewrites custom-element tag names, the `customElements.define(...)` string,
 * and the recipe's own `@style` class selectors — NOT `@aihu/*` import
 * specifiers (those stay package names the consumer keeps depending on).
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import {
  preflight,
  type RegistryFs,
  RegistryResolveError,
  type ResolveRegistryDeps,
  readRecipeSource,
  realRegistryFs,
  resolveItems,
  resolveRegistry,
} from '../registry-resolve.ts'

// ─── Flags ───────────────────────────────────────────────────────────────────

interface AddFlags {
  names: string[]
  prefix: string | undefined
  style: string | undefined
  dryRun: boolean
  diff: boolean
  force: boolean
}

function parseAddArgs(args: ReadonlyArray<string>): AddFlags {
  const names: string[] = []
  let prefix: string | undefined
  let style: string | undefined
  let dryRun = false
  let diff = false
  let force = false

  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string
    if (a === '--dry-run') dryRun = true
    else if (a === '--diff') diff = true
    else if (a === '--force') force = true
    else if (a === '--prefix') {
      const next = args[i + 1]
      if (next !== undefined) {
        prefix = next
        i++
      }
    } else if (a.startsWith('--prefix=')) {
      prefix = a.slice('--prefix='.length)
    } else if (a === '--style') {
      const next = args[i + 1]
      if (next !== undefined) {
        style = next
        i++
      }
    } else if (a.startsWith('--style=')) {
      style = a.slice('--style='.length)
    } else if (!a.startsWith('--')) {
      names.push(a)
    }
  }
  return { names, prefix, style, dryRun, diff, force }
}

// ─── Prefix substitution (D-3 fallback — focused local transformer) ──────────

/**
 * Rewrite the `aihu-` custom-element prefix to `<to>-` across:
 *   - custom-element tag names in `@template` (e.g. `<aihu-button>`)
 *   - the `customElements.define('aihu-button', …)` / `customElements.get(...)`
 *     registration strings
 *   - the recipe's own `@style` class selectors + `cn('aihu-button', …)` literals
 *     (`.aihu-button { … }`, `cn('aihu-button')`)
 *
 * Deliberately does NOT touch `@aihu/*` scoped package specifiers (imports) —
 * the `(?<![@/\w])` lookbehind ensures the `aihu` token is not part of a scope
 * (`@aihu/…`) or another identifier. No-op when `from === to`.
 */
export function substitutePrefix(source: string, from: string, to: string): string {
  if (from === to) return source
  // Match `<from>-<name>` where the `<from>` token is not preceded by `@`, `/`,
  // or a word char (so `@aihu/…` and `myaihu-x` are left alone) and is followed
  // by `-<identifier-ish>`.
  const re = new RegExp(`(?<![@/\\w])${escapeRegExp(from)}(-[a-z][\\w-]*)`, 'g')
  return source.replace(re, `${to}$1`)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ─── Minimal unified diff (for --diff) ───────────────────────────────────────

/** A compact line-level diff (no external dep) for the `--diff` preview. */
function unifiedDiff(existing: string, next: string, label: string): string {
  if (existing === next) return `  (no changes) ${label}\n`
  const oldLines = existing.split('\n')
  const newLines = next.split('\n')
  const out: string[] = [`--- ${label} (existing)`, `+++ ${label} (incoming)`]
  const max = Math.max(oldLines.length, newLines.length)
  for (let i = 0; i < max; i++) {
    const o = oldLines[i]
    const n = newLines[i]
    if (o === n) continue
    if (o !== undefined) out.push(`-${o}`)
    if (n !== undefined) out.push(`+${n}`)
  }
  return `${out.join('\n')}\n`
}

// ─── Injectable I/O for write + output (real impl + test fakes) ──────────────

export interface AddIo {
  write(path: string, content: string): void
  mkdirp(path: string): void
  stdout(s: string): void
  stderr(s: string): void
}

const realAddIo: AddIo = {
  write: (p, c) => writeFileSync(p, c, 'utf8'),
  mkdirp: (p) => mkdirSync(p, { recursive: true }),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
}

export interface AddDeps {
  cwd?: string
  fs?: RegistryFs
  io?: AddIo
  /** Forwarded to `resolveRegistry` so tests inject a fixture config + registry. */
  resolve?: ResolveRegistryDeps
  /**
   * Record the added recipe → primitive version (D-4, record-only). Injectable
   * so the default no-op (Plan 5 keeps it minimal) can be swapped in tests.
   * `versions` maps recipe name → its declared `@aihu/primitives` dep (or null).
   */
  recordPrimitives?: (versions: Record<string, string | null>) => void
  /** Throw instead of `process.exit` (tests assert without killing the runner). */
  exit?: (code: number) => never
}

// ─── Command entry ────────────────────────────────────────────────────────────

/**
 * `aihu add <names...>` entry. Default-export async (mirrors `dev`/`build`).
 *
 * Resolves, transforms, and writes recipes; returns the list of written
 * destination paths (empty on `--dry-run` / `--diff`). Throws/exits nonzero on
 * any R6 error path or an un-forced collision (R9).
 */
export default async function add(rest: ReadonlyArray<string>, deps: AddDeps = {}): Promise<void> {
  const cwd = deps.cwd ?? process.cwd()
  const fs = deps.fs ?? realRegistryFs
  const io = deps.io ?? realAddIo
  const exit =
    deps.exit ??
    ((code: number): never => {
      process.exit(code)
    })

  const flags = parseAddArgs(rest)

  if (flags.names.length === 0) {
    io.stderr(
      'Usage:\n' +
        '  aihu add <names...> [--prefix p] [--style s] [--dry-run] [--diff] [--force]\n',
    )
    return exit(1)
  }

  // 1–2: resolve registry + items (transitive). Render R6 errors actionably.
  let resolved: Awaited<ReturnType<typeof resolveRegistry>>
  let items: ReturnType<typeof resolveItems>
  try {
    resolved = await resolveRegistry(cwd, { fs, ...deps.resolve })
    items = resolveItems(flags.names, resolved.registry)
  } catch (err) {
    if (err instanceof RegistryResolveError) {
      io.stderr(`ERROR: ${err.message}\n`)
      return exit(1)
    }
    throw err
  }

  const prefix = flags.prefix ?? resolved.ui.prefix
  // `prefix` drives the destination FILENAME as well as the in-source rewrite:
  // the stem is the registered custom-element tag, so the two must agree or
  // the copied recipe registers under a name its own code never mentions.
  const { entries, hasCollision } = preflight(
    items,
    resolved.targetDir,
    resolved.registryRoot,
    fs,
    prefix,
  )

  // --diff: print diffs against any existing target file; write nothing.
  // Labelled with the DESTINATION basename, which is what the author will see
  // on disk (and what carries the prefix), not the registry-side source name.
  if (flags.diff) {
    for (const e of entries) {
      const transformed = substitutePrefix(e.file.source, 'aihu', prefix)
      const label = basename(e.dest)
      if (e.collides) {
        io.stdout(unifiedDiff(fs.read(e.dest), transformed, label))
      } else {
        io.stdout(`  (new file) ${label}\n`)
      }
    }
    return
  }

  // 3–4: collision handling (R9 — abort unless --force).
  if (hasCollision && !flags.force) {
    const collisions = entries.filter((e) => e.collides).map((e) => e.dest)
    io.stderr(
      `ERROR: ${collisions.length} file(s) already exist in the target:\n` +
        `${collisions.map((c) => `  ${c}`).join('\n')}\n` +
        'Pass --force to overwrite, or --diff to preview changes.\n',
    )
    return exit(1)
  }

  // --dry-run: print the plan, write nothing.
  if (flags.dryRun) {
    io.stdout(`Plan (${entries.length} file(s), prefix "${prefix}"):\n`)
    for (const e of entries) {
      const tag = e.collides ? 'overwrite' : 'write'
      io.stdout(`  ${tag}  ${e.dest}\n`)
    }
    return
  }

  // 5: transform + write.
  for (const e of entries) {
    const transformed = substitutePrefix(e.file.source, 'aihu', prefix)
    io.mkdirp(dirname(e.dest))
    io.write(e.dest, transformed)
  }

  // 6: update the ui.primitives record (record-only, D-4).
  const versions: Record<string, string | null> = {}
  for (const item of items) {
    versions[item.name] = (item.dependencies ?? []).includes('@aihu/primitives')
      ? '@aihu/primitives'
      : null
  }
  deps.recordPrimitives?.(versions)

  io.stdout(`added ${entries.length} file(s).\n`)
}

// Re-export the resolved item source reader for symmetry with `list` callers.
export { readRecipeSource }
