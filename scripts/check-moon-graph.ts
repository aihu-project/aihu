#!/usr/bin/env bun
/**
 * check:moon-graph (FEL-411) — the Moon project graph must describe the REAL
 * build-ordering dependencies, DERIVED from what each package actually imports.
 *
 * THE DEFECT THIS CLOSES: `packages/editor/moon.yml` declared `dependsOn:
 * [signals]` while `packages/editor/tests/component-compile.test.ts` does
 * `await import('@aihu/compiler')`. The edge editor -> compiler is absent from
 * the graph, so Moon's inherited `deps: ["^:build"]` (.moon/tasks/tasks.yml)
 * has nothing to wait on and can schedule `editor:typecheck` BEFORE
 * `compiler:build` — the `dist/*.d.ts` is not there yet and typecheck fails
 * `TS2307 Cannot find module @aihu/compiler`. main is green only because the
 * scheduler usually happens to build compiler first: a RACE, not correctness.
 * `use/moon.yml`'s own comment records the same class biting PR #541.
 *
 * WHY DERIVED, NOT HAND-LISTED: an expected-edges table drifts exactly like the
 * `node:` allowlists (C-FEL-EXTERNALS) and the publish-all PKGS array did. This
 * computes the required edges from the imports themselves, then asserts the
 * declared graph covers them. Adding a package or a cross-package import can
 * never silently outrun the graph again.
 *
 * RULE: for every workspace package `Q` that package `P` imports (static,
 * `import type`, dynamic `import()`, or `require()`, at any subpath) AND
 * declares with a `workspace:` range, `P`'s `dependsOn` must list `Q` (unless
 * Q === P) — UNLESS that edge would close a cycle. A registry range is a
 * package boundary: Moon must not build that source project before `P`, even
 * if this repository happens to retain a duplicate source checkout. Both
 * `build` and `typecheck` inherit `deps: ["^:build"]`
 * (.moon/tasks/tasks.yml), so `dependsOn` is a BUILD-ORDER graph and Moon
 * rejects it if cyclic. Where P imports Q but Q already (transitively) depends
 * on P, the codebase breaks the cycle with a LAZY `import('...')` of an optional
 * peer — e.g. `compiler` lazily resolves `@aihu/css-engine`, which itself
 * `dependsOn: compiler` (js/index.ts:1257, :1452). Those cycle-closing imports
 * are reported as informational, NOT required — a project edge there is
 * impossible, so requiring it would make the guard unsatisfiable.
 *
 * SCOPE (narrower-by-design, FEL-411 first pass): the graph encodes the acyclic
 * build-order edges. Mutual test cross-imports that would cycle stay as lazy
 * dynamic imports (the existing, deliberate cycle-avoidance) and are listed but
 * not enforced. This is the authorised narrower scope — derived, never
 * hand-listed — not a closed table.
 *
 * Exit 0 = graph covers every acyclic derived edge. Exit 1 = missing edges.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * FIXTURE-SCAN MODE (C-FEL-GATE-WIRING-RUNS). `MOON_GRAPH_ROOT` repoints the
 * scan at a fixture tree so this gate's RED path can be executed and observed,
 * which is what check:gate-wiring's negative-fixture half requires of every gate
 * (ruling 1: declared/registered is not proof). This gate shipped in #671 with
 * no such proof and no entry in the shrink-only ramp, and nothing said so —
 * check:gate-wiring, which would have, ran in no workflow.
 *
 * The override affects only WHERE the scan reads. It is not a bypass: with the
 * variable unset the behaviour is byte-for-byte what it was. Do NOT combine it
 * with `--fix`, which WRITES moon.yml files under the chosen root.
 */
const root = process.env.MOON_GRAPH_ROOT
  ? resolve(process.env.MOON_GRAPH_ROOT)
  : join(import.meta.dirname, '..')
const packagesDir = join(root, 'packages')

/** Directory names under packages/ that are real Moon projects. */
function packageDirs(): string[] {
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== '_moved')
    .map((d) => d.name)
    .filter((name) => existsSync(join(packagesDir, name, 'moon.yml')))
}

/**
 * Map every workspace package NAME (`@aihu/compiler`, `@aihu-plugin/data`,
 * `create-aihu`, …) to its Moon project id. For `packages/*` the id is the
 * directory basename (none of them override `id:` — only bench/* do), so the
 * project id a `dependsOn` entry must name is the directory name.
 */
function buildNameToProject(dirs: string[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const dir of dirs) {
    try {
      const pkg = JSON.parse(readFileSync(join(packagesDir, dir, 'package.json'), 'utf-8')) as {
        name?: string
      }
      if (pkg.name) map.set(pkg.name, dir)
    } catch {
      // No/unreadable package.json (e.g. a private scaffold) — not importable.
    }
  }
  return map
}

/**
 * Project dependencies that intentionally resolve to another source project.
 * Only these need Moon build ordering. A normal semver range resolves from the
 * registry and must stay outside the source graph, which is how extracted
 * packages prove their published contract before their former source is gone.
 */
function buildWorkspaceDependencies(dirs: string[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
  for (const dir of dirs) {
    const deps = new Set<string>()
    try {
      const pkg = JSON.parse(
        readFileSync(join(packagesDir, dir, 'package.json'), 'utf-8'),
      ) as Record<string, Record<string, string> | undefined>
      for (const section of sections) {
        for (const [name, range] of Object.entries(pkg[section] ?? {})) {
          if (range.startsWith('workspace:')) deps.add(name)
        }
      }
    } catch {
      // No/unreadable package.json cannot declare a workspace dependency.
    }
    out.set(dir, deps)
  }
  return out
}

/**
 * Parse the top-level `dependsOn:` block-list of a moon.yml into project ids.
 * Handles the block form (`dependsOn:\n  - 'signals'`) and the inline form
 * (`dependsOn: [signals, router]`). Entries may be quoted or bare; object form
 * (`- id: x, scope: y`) is reduced to its `id`.
 */
function parseDependsOn(moonYml: string): Set<string> {
  const out = new Set<string>()
  const lines = moonYml.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const inline = line.match(/^dependsOn:\s*\[([^\]]*)\]/)
    if (inline) {
      for (const raw of inline[1].split(',')) {
        const id = raw.trim().replace(/^['"]|['"]$/g, '')
        if (id) out.add(id)
      }
      continue
    }
    if (/^dependsOn:\s*$/.test(line)) {
      // Consume the following indented list items.
      for (let j = i + 1; j < lines.length; j++) {
        const item = lines[j]
        if (/^\s*#/.test(item) || item.trim() === '') continue
        const m = item.match(/^\s+-\s+(?:id:\s*)?['"]?([A-Za-z0-9_-]+)['"]?/)
        if (m) {
          out.add(m[1])
          continue
        }
        // A non-list, non-comment, non-blank line ends the block.
        if (!/^\s/.test(item) || /^\s+\w+:/.test(item)) break
      }
    }
  }
  return out
}

/**
 * A project consumes dependency `dist/*.d.ts` — and therefore needs
 * build-order edges — only if it runs a REAL `tsc` typecheck (or a build). A
 * project that pins `language: 'unknown'` / a `noop` typecheck (e.g. `templates`,
 * whose real work is its `cf-team` subproject and whose own files are inert
 * scaffold payload) never typechecks against upstream dts, so its imports are
 * not build-order edges. Skip it.
 */
function consumesDts(moonYml: string): boolean {
  if (/^language:\s*['"]?unknown['"]?/m.test(moonYml)) return false
  // An explicit `typecheck:` whose only command is `noop` opts out of tsc.
  const tc = moonYml.match(/^\s{2}typecheck:\s*\n(?:\s{4}.*\n)*/m)?.[0]
  if (tc && /command:\s*['"]?noop['"]?/.test(tc) && !/command:\s*['"]?[^'"n]/.test(tc)) return false
  return true
}

/**
 * Recursively collect source files that participate in THIS project's
 * typecheck/build. A subdirectory carrying its own `package.json` is a nested
 * project or vendored scaffold payload (e.g. `templates/cf-team`,
 * `.../template/apps/web`) — a separate compilation unit, so its example imports
 * are not this project's build-order deps. Do not descend into it.
 */
function sourceFiles(dir: string): string[] {
  const SKIP_DIRS = new Set([
    'node_modules',
    'dist',
    'build',
    'coverage',
    '.moon',
    'target',
    'npm',
    'npm-native',
  ])
  const out: string[] = []
  const walk = (d: string, isRoot: boolean) => {
    if (!isRoot && existsSync(join(d, 'package.json'))) return // nested project
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.tmp')) continue
        walk(join(d, ent.name), false)
      } else if (/\.(ts|tsx|mts|cts)$/.test(ent.name) && !ent.name.endsWith('.d.ts')) {
        out.push(join(d, ent.name))
      }
    }
  }
  try {
    walk(dir, true)
  } catch {
    // unreadable — nothing to scan
  }
  return out
}

/** Extract the package name from an import specifier, or null for relative/node. */
function specifierToPackage(spec: string): string | null {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) return null
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

const IMPORT_RE = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g

/**
 * Blank out the regions of `src` that are TEXT rather than CODE, so
 * `IMPORT_RE` cannot read a sentence — or a source-code fixture — as an import.
 *
 * A REGEX OVER RAW SOURCE CANNOT TELL CODE FROM TEXT ABOUT CODE. That class has
 * now bitten this repo twice in one day: `dep-check.ts` was comment-blind
 * (C-FEL-DEPCHECK-COMMENTS, #681), and this scanner was string-literal-blind —
 * `packages/plugin-agent-readiness/tests/agent-manifest-sidecar.test.ts` holds
 * `.aihu` component source inside BACKTICK TEMPLATE LITERALS, and one of those
 * fixtures contains the line `import { signal } from '@aihu/signals'`. The
 * regex matched the fixture's INNER SINGLE QUOTES — the enclosing backticks are
 * invisible to it — and demanded a `dependsOn: signals` edge that does not
 * exist. It turned `main` red (run 30375932836) on two PRs that were each green
 * in isolation and whose union was never built.
 *
 * Two kinds of region are blanked, and the asymmetry is the whole design:
 *
 *   COMMENTS — blanked. Same fix as #681, whose `stripComments` this mirrors.
 *   TEMPLATE LITERALS (`` ` ``) — CONTENTS blanked. A template literal is where
 *     this repo keeps embedded source (`.aihu` fixtures, codegen snippets), so
 *     its contents are text. A real specifier is never written in backticks:
 *     `import … from` requires a plain string literal, and a dynamic
 *     `import(`…`)` with a template is a computed specifier this scanner could
 *     not resolve anyway.
 *   ORDINARY '…' / "…" STRINGS — PRESERVED. Their contents ARE the specifiers
 *     (`from './foo'`); blanking them would erase every real import. This is the
 *     opposite of the template rule ON PURPOSE.
 *
 * Blanking replaces characters with spaces and PRESERVES NEWLINES, so byte
 * offsets and line numbers still line up with the original file.
 *
 * KNOWN LIMITATIONS, both in the false-NEGATIVE direction (a missed edge in an
 * advisory graph check), deliberately unmodeled rather than half-modeled:
 *   - REGEX LITERALS are not tracked, so `/…\/\//` reads as a line comment and
 *     the rest of THAT line is blanked. Inherited from #681's scanner, same
 *     rationale: an import essentially never shares a line with a regex.
 *   - An import-shaped sentence nested in an ORDINARY string (`"… from 'x' …"`)
 *     still matches, since those are preserved by design.
 * Distinguishing these needs a real parser; unifying both gates on
 * `ts.preProcessFile` is the follow-up, deliberately not bundled into a
 * main-is-red unblock.
 */
export function stripNonCode(src: string): string {
  let out = ''
  let quote: string | null = null // active string delimiter: ' " or `
  const blank = (s: string): string => s.replace(/[^\n]/g, ' ')
  for (let i = 0; i < src.length; ) {
    const c = src[i] as string
    const c2 = src[i + 1]
    if (quote) {
      // Inside a literal. Template contents are text → blanked; ordinary string
      // contents are specifiers → kept verbatim.
      if (c === '\\') {
        out += quote === '`' ? blank(src.slice(i, i + 2)) : src.slice(i, i + 2)
        i += 2
        continue
      }
      out += c === quote ? c : quote === '`' ? blank(c) : c
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
      while (i < src.length && src[i] !== '\n') {
        out += ' '
        i += 1
      }
      continue
    }
    if (c === '/' && c2 === '*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? src.length : end + 2
      out += blank(src.slice(i, stop))
      i = stop
      continue
    }
    out += c
    i += 1
  }
  return out
}

/** Workspace package names imported anywhere in `dir`'s source. */
function importedPackages(dir: string, nameToProject: Map<string, string>): Set<string> {
  const found = new Set<string>()
  for (const file of sourceFiles(dir)) {
    let content: string
    try {
      content = stripNonCode(readFileSync(file, 'utf-8'))
    } catch {
      continue
    }
    for (const m of content.matchAll(IMPORT_RE)) {
      const pkg = specifierToPackage(m[1])
      if (pkg && nameToProject.has(pkg)) found.add(pkg)
    }
  }
  return found
}

/** Can `from` reach `to` by following dependsOn edges in `graph`? */
function reaches(graph: Map<string, Set<string>>, from: string, to: string): boolean {
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length) {
    const node = stack.pop()!
    if (node === to) return true
    if (seen.has(node)) continue
    seen.add(node)
    for (const next of graph.get(node) ?? []) stack.push(next)
  }
  return false
}

// ── Run ──────────────────────────────────────────────────────────────────────
const dirs = packageDirs()
const nameToProject = buildNameToProject(dirs)
const workspaceDependencies = buildWorkspaceDependencies(dirs)

// The declared build-order graph (a working copy we grow with acyclic edges).
const graph = new Map<string, Set<string>>()
for (const dir of dirs) {
  graph.set(dir, parseDependsOn(readFileSync(join(packagesDir, dir, 'moon.yml'), 'utf-8')))
}

type Edge = { project: string; needs: string; via: string }
const candidates: Edge[] = []
for (const dir of dirs) {
  if (!consumesDts(readFileSync(join(packagesDir, dir, 'moon.yml'), 'utf-8'))) continue
  for (const importedName of importedPackages(join(packagesDir, dir), nameToProject)) {
    if (!workspaceDependencies.get(dir)?.has(importedName)) continue
    const target = nameToProject.get(importedName)!
    if (target === dir) continue // self-import
    if (!graph.get(dir)!.has(target)) {
      candidates.push({ project: dir, needs: target, via: importedName })
    }
  }
}
// Deterministic order so the cycle/required partition is stable run-to-run.
candidates.sort((a, b) => a.project.localeCompare(b.project) || a.needs.localeCompare(b.needs))

const missing: Edge[] = [] // acyclic edges the graph must add
const lazy: Edge[] = [] // cycle-closing imports — must stay lazy, not a graph edge
for (const e of candidates) {
  // Adding project -> needs closes a cycle iff `needs` can already reach `project`.
  if (reaches(graph, e.needs, e.project)) {
    lazy.push(e)
  } else {
    missing.push(e)
    graph.get(e.project)!.add(e.needs) // keep the working graph acyclic as we go
  }
}

if (lazy.length > 0) {
  console.error(
    `note: ${lazy.length} import(s) would close a Moon dependency cycle and MUST remain a\n` +
      "lazy `import('...')` of an optional peer (existing cycle-avoidance, not a graph edge):",
  )
  for (const e of lazy) {
    console.error(`  packages/${e.project} imports ${e.via} (cycle vs ${e.needs}) — keep lazy`)
  }
  console.error('')
}

const byProject = new Map<string, Edge[]>()
for (const m of missing) {
  const list = byProject.get(m.project) ?? []
  list.push(m)
  byProject.set(m.project, list)
}

/**
 * Rewrite a moon.yml's top-level `dependsOn:` to the merged, sorted, quoted set
 * of existing + new project ids. Appends to an existing block or inserts a new
 * one after the `layer:`/`language:` header. Block form only (what the repo uses).
 */
function applyEdges(project: string, needs: string[]): void {
  const path = join(packagesDir, project, 'moon.yml')
  const src = readFileSync(path, 'utf-8')
  const merged = [...new Set([...parseDependsOn(src), ...needs])].sort()
  const block = `dependsOn:\n${merged.map((n) => `  - '${n}'`).join('\n')}`
  const lines = src.split('\n')

  const startIdx = lines.findIndex((l) => /^dependsOn:/.test(l))
  if (startIdx !== -1) {
    // Replace the existing block: the `dependsOn:` line plus its `-` items.
    let endIdx = startIdx + 1
    while (endIdx < lines.length && /^\s+-\s/.test(lines[endIdx])) endIdx++
    lines.splice(startIdx, endIdx - startIdx, block)
  } else {
    // Insert after the last of the leading `language:`/`layer:` header keys.
    let insertAt = 0
    for (let i = 0; i < lines.length; i++) {
      if (/^(language|layer):/.test(lines[i])) insertAt = i + 1
    }
    lines.splice(insertAt, 0, '', block)
  }
  writeFileSync(path, lines.join('\n'))
}

if (process.argv.includes('--fix')) {
  for (const [project, list] of [...byProject].sort()) {
    applyEdges(
      project,
      list.map((e) => e.needs),
    )
    console.log(`fixed packages/${project}/moon.yml (+${list.length} edge(s))`)
  }
  console.log(
    `\ncheck:moon-graph --fix: added ${missing.length} edge(s) to ${byProject.size} file(s).`,
  )
  process.exit(0)
}

if (missing.length === 0) {
  console.log('check:moon-graph — OK: every acyclic imported package has a dependsOn edge.')
  process.exit(0)
}

console.error('check:moon-graph — FAIL: Moon graph is missing build-ordering edges.\n')
console.error(
  'Each package below imports a package declared with a `workspace:` range but its moon.yml does NOT list it in\n' +
    "`dependsOn`, so Moon's `^:build` cannot order the dependency's dist/*.d.ts before\n" +
    'this package typechecks — a TS2307 race (FEL-411). Add the edge (derived, not guessed),\n' +
    'or run `bun scripts/check-moon-graph.ts --fix`:\n',
)
for (const [project, list] of [...byProject].sort()) {
  console.error(`  packages/${project}/moon.yml  must add dependsOn:`)
  for (const m of [...list].sort((a, b) => a.needs.localeCompare(b.needs))) {
    console.error(`    - '${m.needs}'   (imports ${m.via})`)
  }
}
console.error(`\n${missing.length} missing edge(s) across ${byProject.size} package(s).`)
process.exit(1)
