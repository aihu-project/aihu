/**
 * `@aihu/cli/registry-resolve` — shared resolver for the `aihu add` / `aihu list`
 * subcommands (Plan 5 Task 6).
 *
 * Responsibilities (master spec §9.6, plan §Task 6 Step 1):
 *   - `resolveRegistry(cwd)` — read `aihu.config.ts → ui` (defaults resolved at
 *     read-time, R3/§6.6), locate the installed `@aihu/ui`
 *     (`node_modules/@aihu/ui/registry.json`), parse the INDEX-ONLY catalog (R3).
 *   - `readRecipeSource(item, registryRoot, fs)` — read the recipe `.aihu`
 *     file(s) by `path` directly from the installed package (R3 — source is NOT
 *     inlined in the index).
 *   - `resolveItems(names, registry)` — collect requested items + transitively
 *     pull `registryDependencies`, cycle-safe (R8).
 *   - `preflight(items, target, fs)` — detect target-dir collisions, return the
 *     write plan.
 *
 * Error paths (R6) are TYPED errors (`RegistryResolveError`) the command layer
 * renders as an actionable message + nonzero exit:
 *   (i)   no `aihu.config.ts` walking up from `cwd`        → 'no-config'
 *   (ii)  `@aihu/ui` not resolvable in `node_modules`      → 'registry-not-installed'
 *   (iii) config present but no `ui` field                 → 'no-ui-field'
 *   (iv)  a requested recipe not present in `registry.json` → 'unknown-recipe'
 *
 * The side-effect surfaces (file reads, config import) are injectable so tests
 * run against in-memory fakes + fixture configs without touching the disk or
 * the real `node_modules`.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { Registry, RegistryItem } from '@aihu/ui/registry'

// ─── Resolved UI config (defaults applied at read-time) ──────────────────────

/** The `ui` block with all v1 defaults filled in (spec §6.6). */
export interface ResolvedUiConfig {
  registry: string
  target: string
  style: string
  prefix: string
}

const UI_DEFAULTS: ResolvedUiConfig = {
  registry: '@aihu/ui',
  target: './src/components/ui',
  style: 'aihu-default',
  prefix: 'aihu',
}

// ─── Typed error (R6) ────────────────────────────────────────────────────────

export type RegistryResolveErrorCode =
  | 'no-config'
  | 'registry-not-installed'
  | 'no-ui-field'
  | 'unknown-recipe'

/**
 * A resolver failure with an actionable, user-facing `message`. The command
 * layer prints `message` and exits nonzero (R6). The `code` lets callers branch
 * or tests assert which path fired.
 */
export class RegistryResolveError extends Error {
  readonly code: RegistryResolveErrorCode
  constructor(code: RegistryResolveErrorCode, message: string) {
    super(message)
    this.name = 'RegistryResolveError'
    this.code = code
  }
}

// ─── Injectable side-effect surfaces ─────────────────────────────────────────

/** Minimal filesystem surface the resolver needs (real impl + test fakes). */
export interface RegistryFs {
  exists(path: string): boolean
  read(path: string): string
}

export const realRegistryFs: RegistryFs = {
  exists: (p) => existsSync(p),
  read: (p) => readFileSync(p, 'utf8'),
}

/**
 * Load the raw `ui` block from `aihu.config.ts`. Returns:
 *   - `null`           when no config file is found (→ 'no-config')
 *   - `{ ui: undefined }` when the config has no `ui` field (→ 'no-ui-field')
 *   - `{ ui: {...} }`   when present.
 *
 * The real loader dynamic-imports `aihu.config.ts` (same approach as `dev.ts`);
 * tests inject a fake that returns a fixture config.
 */
export interface ConfigLoader {
  load(cwd: string): Promise<{ ui?: Partial<ResolvedUiConfig> | undefined } | null>
}

/** Walk up from `cwd` looking for `aihu.config.ts`; returns its dir or null. */
function findConfigDir(cwd: string, fs: RegistryFs): string | null {
  let dir = resolve(cwd)
  for (let i = 0; i < 12; i++) {
    if (fs.exists(join(dir, 'aihu.config.ts'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

export const realConfigLoader: ConfigLoader = {
  async load(cwd) {
    const dir = findConfigDir(cwd, realRegistryFs)
    if (dir === null) return null
    const configPath = join(dir, 'aihu.config.ts')
    try {
      const mod = (await import(configPath)) as {
        default?: { ui?: Partial<ResolvedUiConfig> }
      }
      const cfg = mod.default ?? {}
      // Distinguish "no ui field" from "ui present": preserve undefined.
      return Object.hasOwn(cfg, 'ui') ? { ui: cfg.ui } : {}
    } catch {
      // A config that exists but fails to import is treated as present-with-no-ui
      // so the caller surfaces the actionable 'no-ui-field' message rather than a
      // raw stack trace.
      return {}
    }
  },
}

// ─── resolveRegistry ─────────────────────────────────────────────────────────

/** The fully-resolved registry context `add`/`list` operate against. */
export interface ResolvedRegistry {
  /** `ui` config with defaults applied. */
  ui: ResolvedUiConfig
  /** Absolute directory the consumer's project root (where `aihu.config.ts` lives). */
  projectRoot: string
  /** Absolute directory of the installed `@aihu/ui` package. */
  registryRoot: string
  /** The parsed (index-only) catalog. */
  registry: Registry
  /** Absolute path of the resolved `ui.target` directory. */
  targetDir: string
}

export interface ResolveRegistryDeps {
  fs?: RegistryFs
  configLoader?: ConfigLoader
  /**
   * Locate the installed registry package root (dir containing `registry.json`)
   * given `projectRoot` + the `ui.registry` specifier. Injectable for tests so
   * a fixture package can stand in for `node_modules/@aihu/ui`. Returns `null`
   * when the package is not resolvable.
   */
  resolveRegistryRoot?: (projectRoot: string, registrySpec: string, fs: RegistryFs) => string | null
}

/** Default registry-package locator: `node_modules/<spec>/registry.json`. */
function defaultResolveRegistryRoot(
  projectRoot: string,
  registrySpec: string,
  fs: RegistryFs,
): string | null {
  // Walk up from projectRoot looking for node_modules/<spec>/registry.json
  // (handles workspace hoisting where deps live at a higher node_modules).
  let dir = resolve(projectRoot)
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, 'node_modules', registrySpec)
    if (fs.exists(join(candidate, 'registry.json'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * Read config, locate the installed registry, parse the index (R3).
 * Throws `RegistryResolveError` on any of the four R6 error paths.
 */
export async function resolveRegistry(
  cwd: string,
  deps: ResolveRegistryDeps = {},
): Promise<ResolvedRegistry> {
  const fs = deps.fs ?? realRegistryFs
  const configLoader = deps.configLoader ?? realConfigLoader
  const resolveRegistryRoot = deps.resolveRegistryRoot ?? defaultResolveRegistryRoot

  // (i) no aihu.config.ts walking up from cwd.
  const projectRoot = findConfigDir(cwd, fs)
  const loaded = await configLoader.load(cwd)
  if (loaded === null || projectRoot === null) {
    throw new RegistryResolveError(
      'no-config',
      'No aihu.config.ts found.\n' +
        'Run `aihu add` from inside an aihu project, or create one with:  aihu app <name>',
    )
  }

  // (iii) config present but no `ui` field.
  if (loaded.ui === undefined) {
    throw new RegistryResolveError(
      'no-ui-field',
      'aihu.config.ts has no `ui` field.\n' +
        "Add a `ui` block, e.g.:  ui: { registry: '@aihu/ui', target: './src/components/ui' }",
    )
  }

  const ui: ResolvedUiConfig = {
    registry: loaded.ui.registry ?? UI_DEFAULTS.registry,
    target: loaded.ui.target ?? UI_DEFAULTS.target,
    style: loaded.ui.style ?? UI_DEFAULTS.style,
    prefix: loaded.ui.prefix ?? UI_DEFAULTS.prefix,
  }

  // (ii) @aihu/ui not resolvable in node_modules.
  const registryRoot = resolveRegistryRoot(projectRoot, ui.registry, fs)
  if (registryRoot === null) {
    throw new RegistryResolveError(
      'registry-not-installed',
      `Registry package ${JSON.stringify(ui.registry)} is not installed.\n` +
        `Run:  bun add -D ${ui.registry}`,
    )
  }

  const registry = parseRegistry(fs.read(join(registryRoot, 'registry.json')))

  const targetDir = isAbsolute(ui.target) ? ui.target : resolve(projectRoot, ui.target)

  return { ui, projectRoot, registryRoot, registry, targetDir }
}

/** Parse + minimally validate the `registry.json` index. */
function parseRegistry(raw: string): Registry {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new RegistryResolveError(
      'registry-not-installed',
      `registry.json is not valid JSON: ${(err as Error).message}`,
    )
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { items?: unknown }).items)
  ) {
    throw new RegistryResolveError(
      'registry-not-installed',
      'registry.json is malformed: expected `{ items: RegistryItem[] }`.',
    )
  }
  return parsed as Registry
}

// ─── resolveItems (transitive registryDependencies, cycle-safe — R8) ─────────

/**
 * Collect the requested recipes plus every recipe transitively reachable via
 * `registryDependencies`. Cycle-safe: a recipe already visited is skipped, so
 * an A→B→A cycle terminates rather than recursing forever (R8).
 *
 * Throws `RegistryResolveError('unknown-recipe', …)` (R6) when a requested name
 * — or a transitively-referenced dependency — is absent from the index.
 */
export function resolveItems(names: ReadonlyArray<string>, registry: Registry): RegistryItem[] {
  const byName = new Map<string, RegistryItem>()
  for (const item of registry.items) byName.set(item.name, item)

  const visited = new Set<string>()
  const ordered: RegistryItem[] = []

  const visit = (name: string, requestedDirectly: boolean): void => {
    if (visited.has(name)) return
    const item = byName.get(name)
    if (item === undefined) {
      const where = requestedDirectly
        ? `unknown recipe ${JSON.stringify(name)}`
        : `recipe references unknown dependency ${JSON.stringify(name)}`
      throw new RegistryResolveError(
        'unknown-recipe',
        `${where} — run \`aihu list\` to see available recipes.`,
      )
    }
    // Mark visited BEFORE recursing so a cycle (A→B→A) terminates.
    visited.add(name)
    for (const dep of item.registryDependencies ?? []) {
      visit(dep, false)
    }
    ordered.push(item)
  }

  for (const name of names) visit(name, true)
  return ordered
}

// ─── readRecipeSource (read .aihu by path from the installed package — R3) ───

/** One recipe file resolved to its on-disk source. */
export interface RecipeSourceFile {
  /** Path relative to the package root (from the index). */
  path: string
  /** The recipe's basename written into the target dir (e.g. `button.aihu`). */
  basename: string
  /** The raw `.aihu` source read from the installed package. */
  source: string
  /** Role the file plays (`component` | `style` | `lib` | `block`). */
  type: string
}

/**
 * Read every file declared on `item` directly from the installed package
 * (`registryRoot`/<path>). Source is NOT inlined in the index (R3); this is
 * where the actual `.aihu` text is loaded at copy time.
 */
export function readRecipeSource(
  item: RegistryItem,
  registryRoot: string,
  fs: RegistryFs = realRegistryFs,
): RecipeSourceFile[] {
  return item.files.map((f) => {
    const abs = join(registryRoot, f.path)
    const basename = f.path.slice(f.path.lastIndexOf('/') + 1)
    return { path: f.path, basename, source: fs.read(abs), type: f.type }
  })
}

// ─── preflight (collision detection → write plan) ────────────────────────────

/** A single planned write + whether it collides with an existing target file. */
export interface WritePlanEntry {
  /** The recipe item this file belongs to. */
  item: RegistryItem
  /** The resolved source file. */
  file: RecipeSourceFile
  /** Absolute destination path under `targetDir`. */
  dest: string
  /** True when a file already exists at `dest`. */
  collides: boolean
}

export interface WritePlan {
  entries: WritePlanEntry[]
  /** True when ANY entry collides — the command aborts unless `--force`. */
  hasCollision: boolean
}

/**
 * The destination filename for a copied recipe.
 *
 * The `.aihu` filename stem IS the registered custom-element tag, so the
 * destination name — not the registry's source name — decides what the recipe
 * registers as. The registry stores recipes under bare stems (`button.aihu`),
 * which is why every recipe carries the `aihu-` prefix INSIDE its source
 * (`customElements.define('aihu-button', …)`, `.aihu-button { … }`) and why
 * Storybook copies them out as `aihu-<stem>.aihu`
 * (`apps/storybook/scripts/sync-recipes.ts`).
 *
 * Copying `button.aihu` through verbatim produced `customElements.define(
 * 'button', …)` in the consumer build — a SyntaxError, and a collision with
 * the built-in `<button>` besides. Prefixing here makes the destination stem
 * agree with the `aihu-` → `<prefix>-` rewrite `substitutePrefix` already
 * applies to the file's contents, so `--prefix acme` yields `acme-button.aihu`
 * registering `<acme-button>` — one name, one place.
 *
 * Idempotent: a registry file already named `<prefix>-…` is left alone.
 */
export function destBasename(basename: string, prefix: string): string {
  return basename.startsWith(`${prefix}-`) ? basename : `${prefix}-${basename}`
}

/**
 * Build the write plan: one entry per (item, file), flagging collisions against
 * the existing target dir. Does NOT write — the command decides based on
 * `--dry-run` / `--diff` / `--force`.
 */
export function preflight(
  items: ReadonlyArray<RegistryItem>,
  targetDir: string,
  registryRoot: string,
  fs: RegistryFs = realRegistryFs,
  prefix: string = UI_DEFAULTS.prefix,
): WritePlan {
  const entries: WritePlanEntry[] = []
  let hasCollision = false
  for (const item of items) {
    for (const file of readRecipeSource(item, registryRoot, fs)) {
      const dest = join(targetDir, destBasename(file.basename, prefix))
      const collides = fs.exists(dest)
      if (collides) hasCollision = true
      entries.push({ item, file, dest, collides })
    }
  }
  return { entries, hasCollision }
}
