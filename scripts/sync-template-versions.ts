#!/usr/bin/env bun
/**
 * `sync-template-versions` — generate the dependency ranges the CLI scaffolds.
 *
 * ## The bug class this closes
 *
 * Every `@aihu/*` entry a scaffold emitted was the literal string `"latest"`.
 * That is not a version, it is a *promise to resolve later*, and it has three
 * properties nobody wants from a scaffolding tool:
 *
 *   1. NOT REPRODUCIBLE. A project scaffolded today and one scaffolded in six
 *      months share a `package.json` byte-for-byte and install two different
 *      dependency graphs. Neither manifest records which one it was.
 *   2. NOT AUDITABLE. `"latest"` is compatible with every future major. A
 *      breaking `@aihu/runtime` publish reaches every existing scaffold on its
 *      owner's next `install` — not on an upgrade they chose.
 *   3. NOT REVIEWABLE. There was no mechanism to sync a template's declared
 *      versions to anything, so nothing could be wrong and nothing could be
 *      checked. `check-pins-published.ts` guards platform *binaries* only.
 *
 * ## What this emits, and from what
 *
 * Every non-private workspace package under `packages/` whose name starts with
 * `@aihu/` or `@aihu-plugin/` contributes ONE caret range derived from its own
 * `package.json` `version`. Nothing is hand-typed and there is no curated list
 * to drift: add a package, it appears; bump a package, its range moves.
 *
 * A caret range, not an exact pin, deliberately. A scaffold is a STARTING
 * POINT: `^6.0.0` lets a user pick up `6.0.1` without editing a manifest, while
 * still refusing `7.0.0`. An exact pin would freeze a new project on the
 * release it was born from, which is the opposite failure.
 *
 * ## Why the version can lead the registry, and why that is correct
 *
 * Run on this repo today, the standalone `@aihu/compiler` release may lead the
 * npm registry briefly, so its emitted range can be momentarily unsatisfiable.
 * That is not a defect of this script — it is the release pipeline's normal
 * state, the same one `check-pins-published.ts` documents for platform binaries. The templates
 * that carry these ranges ship INSIDE `@aihu/cli` / `@aihu/templates-*`, which
 * are published by the very release that publishes the versions named here
 * (`release.yml` orders the publishes). A user only ever runs a *published*
 * `create-aihu`, and its ranges name versions that release put on npm.
 *
 * Which is why this runs in `release:version` (see package.json), right after
 * `changeset version` sets the versions that are about to be published.
 *
 * ## Usage
 *
 *   bun scripts/sync-template-versions.ts           # regenerate
 *   bun scripts/sync-template-versions.ts --check   # CI: fail if stale
 *
 * ## Fixture overrides (check-gate-wiring's negative fixture)
 *
 * `TEMPLATE_VERSIONS_PACKAGES_DIR` repoints the version SOURCE at a fixture
 * tree and `TEMPLATE_VERSIONS_TS_TARGET` repoints the generated-module TARGET.
 * Setting the target override also SKIPS the cf-team targets — they read the
 * real workspace and would mismatch a fixture source unconditionally, which
 * would make the fixture red for the wrong reason (a gate that says "no" to
 * everything proves nothing). Never set either by hand.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')

const PACKAGES_DIR = resolve(ROOT, process.env.TEMPLATE_VERSIONS_PACKAGES_DIR ?? 'packages')
const TS_TARGET_OVERRIDE = process.env.TEMPLATE_VERSIONS_TS_TARGET
const TS_TARGET = resolve(ROOT, TS_TARGET_OVERRIDE ?? 'packages/cli/src/dep-versions.ts')
/** Fixture mode: only the generated module is compared. See the docblock. */
const FIXTURE_MODE = TS_TARGET_OVERRIDE !== undefined

const CF_TEAM_TMPL = resolve(ROOT, 'packages/templates/cf-team/template/apps/web/package.json.tmpl')
const CF_TEAM_CONFIG_TS = resolve(ROOT, 'packages/templates/cf-team/template.config.ts')
const CF_TEAM_CONFIG_JS = resolve(ROOT, 'packages/templates/cf-team/template.config.js')

/**
 * EXTERNAL ranges a scaffold pins, kept here rather than typed into each
 * template for exactly the reason the `@aihu/*` ranges are: `vite` was written
 * out in FOUR places (`appPackageJson`, `agentPackageJson`, cf-team's
 * `apps/web/package.json.tmpl`, and the legacy golden), and a range that lives
 * in four places is a range nobody can change.
 *
 * `vite`: `^6 || ^8`, not `^6.0.0`.
 *
 * Vite 8 was genuinely unsafe until commit e817455a: vite 8 made esbuild an
 * OPTIONAL PEER while still exporting `transformWithEsbuild`, the compiler's
 * strip chain tested only that the FUNCTION existed, and a fresh `^8` install
 * (which has no esbuild at all) therefore threw inside the strip and — via a
 * swallowing catch — returned UN-STRIPPED TypeScript to rolldown. That commit
 * ungated `transformWithOxc` and made a failed strip fatal, which removes the
 * coupling rather than pinning around it. Vite 6 cannot regress: it does not
 * export `transformWithOxc` at all, so it keeps taking the esbuild branch.
 *
 * Vite 7 is EXCLUDED, and the omission is deliberate rather than an oversight:
 * no cell of the scaffold matrix has ever installed it, so listing it would be
 * a compatibility claim with no measurement behind it. `^6 || ^8` names exactly
 * the two majors `scaffold-consistency` builds on every PR.
 */
const THIRD_PARTY_RANGES: Readonly<Record<string, string>> = {
  vite: '^6 || ^8',
}

/**
 * DOM engine packages are released from aihu-dom, not this workspace. Derive
 * their ranges from the root manifest so the scaffold stays aligned with the
 * consumer graph without pretending they are local workspaces.
 */
const EXTERNAL_AIHU_PACKAGES = [
  '@aihu/arbor',
  '@aihu/compiler',
  '@aihu/reactive',
  '@aihu/signals',
] as const

function externalAihuRanges(): Record<string, string> {
  const rootManifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const ranges: Record<string, string> = {}
  for (const name of EXTERNAL_AIHU_PACKAGES) {
    const range = rootManifest.dependencies?.[name] ?? rootManifest.devDependencies?.[name]
    if (typeof range !== 'string' || range.startsWith('workspace:')) {
      throw new Error(`sync-template-versions: root package.json lacks an npm range for ${name}`)
    }
    ranges[name] = range
  }
  return ranges
}

// Fixture mode must remain self-contained: its expected generated module has
// only the two synthetic workspace packages and the Vite range.
const EXTERNAL_RANGES: Readonly<Record<string, string>> = FIXTURE_MODE
  ? THIRD_PARTY_RANGES
  : { ...THIRD_PARTY_RANGES, ...externalAihuRanges() }

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

interface WorkspacePackage {
  readonly name: string
  readonly version: string
}

/** Every non-private `@aihu/*` / `@aihu-plugin/*` package directly under `dir`. */
export function discoverAihuPackages(dir: string): WorkspacePackage[] {
  const out: WorkspacePackage[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue
    const manifest = join(dir, entry.name, 'package.json')
    if (!existsSync(manifest)) continue
    let pkg: { name?: unknown; version?: unknown; private?: unknown }
    try {
      pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    } catch {
      // An unreadable manifest is check:lint's business, not this gate's.
      continue
    }
    if (pkg.private === true) continue
    if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string') continue
    if (!pkg.name.startsWith('@aihu/') && !pkg.name.startsWith('@aihu-plugin/')) continue
    out.push({ name: pkg.name, version: pkg.version })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * A caret range for a workspace version.
 *
 * Prerelease versions are pinned EXACTLY: `^1.0.0-rc.1` does not include
 * `1.0.0-rc.2` under npm's semver but DOES include `1.0.0` and every later
 * prerelease of a higher patch — a range whose meaning almost nobody predicts
 * correctly. A canary scaffold that pins the canary it was cut from is at least
 * unambiguous.
 */
export function caretRange(version: string): string {
  return version.includes('-') ? version : `^${version}`
}

// ---------------------------------------------------------------------------
// Target 1 — the generated module
// ---------------------------------------------------------------------------

const GENERATED_HEADER = `/**
 * GENERATED by scripts/sync-template-versions.ts — DO NOT EDIT BY HAND.
 *
 * The dependency ranges \`@aihu/cli\` writes into a scaffolded project's
 * package.json. Regenerate with:
 *
 *   bun scripts/sync-template-versions.ts
 *
 * \`check:template-versions\` fails CI when this file disagrees with the
 * workspace versions it is derived from, so a hand edit here does not survive
 * review. Change a version by releasing the package; change the \`vite\` range
 * in EXTERNAL_RANGES inside the generator.
 */`

export function renderModule(
  packages: readonly WorkspacePackage[],
  external: Readonly<Record<string, string>>,
): string {
  // Quote a key only when it needs quoting — biome's default `quoteProperties:
  // "asNeeded"` strips redundant quotes, and this file has to survive
  // `biome ci .` unchanged or the format gate and the drift gate fight.
  const key = (name: string): string => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : `'${name}'`)
  const aihuLines = packages.map((p) => `  ${key(p.name)}: '${caretRange(p.version)}',`).join('\n')
  const externalLines = Object.entries(external)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, range]) => `  ${key(name)}: '${range}',`)
    .join('\n')

  return `${GENERATED_HEADER}

/** Caret ranges for every published \`@aihu/*\` / \`@aihu-plugin/*\` package. */
export const AIHU_DEP_VERSIONS: Readonly<Record<string, string>> = {
${aihuLines}
}

/** External package ranges a scaffold pins. See EXTERNAL_RANGES in the generator. */
export const EXTERNAL_DEP_VERSIONS: Readonly<Record<string, string>> = {
${externalLines}
}

/**
 * The range to write for \`name\`.
 *
 * THROWS on an unknown name rather than falling back to \`'latest'\` or \`'*'\`.
 * A silent fallback is how the string this file exists to delete would come
 * back: a template referencing a package that has been renamed would emit an
 * unpinned dependency and every scaffold would keep working, wrongly.
 */
export function aihuDep(name: string): string {
  const range = AIHU_DEP_VERSIONS[name] ?? EXTERNAL_DEP_VERSIONS[name]
  if (range === undefined) {
    throw new Error(
      \`[@aihu/cli] no generated version range for '\${name}'. Either the package is not a \` +
        'published source package, or dep-versions.ts is stale — run ' +
        '\`bun scripts/sync-template-versions.ts\`.',
    )
  }
  return range
}
`
}

// ---------------------------------------------------------------------------
// Target 2 — cf-team's apps/web/package.json.tmpl
// ---------------------------------------------------------------------------

/**
 * Rewrite the dependency VALUES of a `package.json.tmpl` in place, line by
 * line, leaving everything else — including the `__APP_CONDITIONAL_DEPS__`
 * token that makes the file invalid JSON — byte-identical.
 *
 * Line-oriented on purpose: `JSON.parse` cannot read this file (the token), and
 * a parse/serialize round-trip would reformat and reorder a hand-authored
 * template as a side effect of changing two numbers.
 */
export function rewriteManifestRanges(
  src: string,
  ranges: Readonly<Record<string, string>>,
): string {
  return src.replace(
    // `rest` is everything after the value's closing quote — a comma, nothing,
    // or `__APP_CONDITIONAL_DEPS__`. The last one is why this cannot anchor on
    // `,?$`: the final dependency line carries the token, and an anchored regex
    // skipped exactly that entry, leaving one `"latest"` behind in a file the
    // generator reported as fully rewritten.
    /^(\s*)"([^"]+)":\s*"([^"]*)"(.*)$/gm,
    (line, indent: string, name: string, value: string, rest: string) => {
      const next = ranges[name]
      if (next === undefined || next === value) return line
      return `${indent}"${name}": "${next}"${rest}`
    },
  )
}

/**
 * Rewrite the `appPeerDeps: { … }` block of a cf-team `template.config.{ts,js}`.
 *
 * Scoped to that one block rather than the whole file: `appPeerDepsConditional`
 * sits immediately below it and pins THIRD-PARTY auth SDKs (`better-auth`,
 * `@supabase/supabase-js`), which this generator knows nothing about and must
 * not touch.
 */
export function rewriteAppPeerDeps(src: string, ranges: Readonly<Record<string, string>>): string {
  const open = src.indexOf('appPeerDeps: {')
  if (open === -1) {
    throw new Error(
      'sync-template-versions: could not find `appPeerDeps: {` in a cf-team template.config — ' +
        'the manifest shape changed; update this script rather than letting it silently no-op.',
    )
  }
  const close = src.indexOf('\n  },', open)
  if (close === -1) {
    throw new Error('sync-template-versions: unterminated `appPeerDeps` block in template.config')
  }
  const block = src.slice(open, close)
  const rewritten = block.replace(
    /'([^']+)':\s*'([^']*)'/g,
    (entry, name: string, value: string) => {
      const next = ranges[name]
      return next === undefined || next === value ? entry : `'${name}': '${next}'`
    },
  )
  return src.slice(0, open) + rewritten + src.slice(close)
}

// ---------------------------------------------------------------------------
// Drive
// ---------------------------------------------------------------------------

interface Target {
  readonly path: string
  readonly next: string
}

function buildTargets(): Target[] {
  const packages = discoverAihuPackages(PACKAGES_DIR)
  if (packages.length === 0) {
    throw new Error(`sync-template-versions: no @aihu packages found under ${PACKAGES_DIR}`)
  }
  const ranges: Record<string, string> = { ...EXTERNAL_RANGES }
  for (const p of packages) ranges[p.name] = caretRange(p.version)

  const targets: Target[] = [{ path: TS_TARGET, next: renderModule(packages, EXTERNAL_RANGES) }]
  if (FIXTURE_MODE) return targets

  targets.push({
    path: CF_TEAM_TMPL,
    next: rewriteManifestRanges(readFileSync(CF_TEAM_TMPL, 'utf8'), ranges),
  })
  for (const config of [CF_TEAM_CONFIG_TS, CF_TEAM_CONFIG_JS]) {
    targets.push({
      path: config,
      next: rewriteAppPeerDeps(readFileSync(config, 'utf8'), ranges),
    })
  }
  return targets
}

function main(): number {
  const targets = buildTargets()
  const stale: string[] = []

  for (const target of targets) {
    const current = existsSync(target.path) ? readFileSync(target.path, 'utf8') : null
    if (current === target.next) continue
    if (CHECK) {
      stale.push(target.path.startsWith(ROOT) ? target.path.slice(ROOT.length + 1) : target.path)
      continue
    }
    writeFileSync(target.path, target.next)
    process.stdout.write(`  wrote ${target.path.slice(ROOT.length + 1)}\n`)
  }

  if (!CHECK) {
    process.stdout.write(`sync-template-versions: ${targets.length} target(s) up to date\n`)
    return 0
  }
  if (stale.length === 0) {
    process.stdout.write(
      `sync-template-versions --check: ${targets.length} target(s) match the workspace versions\n`,
    )
    return 0
  }
  process.stderr.write(
    'sync-template-versions --check FAILED — a scaffold template declares dependency\n' +
      'ranges that do not match the workspace versions they are generated from:\n\n' +
      stale.map((p) => `  ${p}\n`).join('') +
      '\nRun `bun scripts/sync-template-versions.ts` and commit the result.\n',
  )
  return 1
}

if (import.meta.main) process.exit(main())
