/**
 * `aihu plugin install <name>` — apply a plugin's `install-manifest.json`
 * (`docs/specs/plugin-install-manifest.md`).
 *
 * `@aihu/seo`, `@aihu/plugin-demo`, and `@aihu/magna` already ship
 * `install-manifest.json` at their package root, but nothing read one: this
 * is that consumer. Named `plugin install`, not `plugin add`, for two
 * reasons: `aihu plugin <name>` already means "scaffold a NEW plugin package"
 * (see `bin.ts` / `index.ts#scaffoldPlugin`), and `aihu add <names...>` is
 * already a different feature (copies `@aihu/ui` registry recipes into
 * `ui.target`) — reusing either verb for "install an existing plugin
 * package's manifest" would collide with a command that already exists.
 *
 * Flow (spec's "A4 consumer notes" table):
 *   1. Resolve the plugin's installed `package.json` + `install-manifest.json`
 *      from `node_modules` (walking up, same convention as `registry-resolve.ts`).
 *      No manifest on disk → print a manual-install pointer and exit 0 (spec's
 *      documented fallback — a plugin with no manifest is not an error).
 *   2. Validate `pluginName`/`pluginVersion` against the resolved package.json,
 *      and `aihuVersion` against the host project's `@aihu/plugin` version.
 *   3. Print `summary`, confirm unless `--yes`.
 *   4. Run validated `installSteps` in order, dispatching on `kind`. Every
 *      step is idempotent: re-running
 *      `aihu plugin install <name>` converges rather than duplicating.
 *   5. Apply `requiredEnv` (append-only, same as an `add-env-var` step).
 *   6. `additionalPackages`: enforce the `@aihu/*` prefix (dep-free thesis —
 *      spec calls this out explicitly), then `bun add` each one.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { type LoadedProjectConfig, loadProjectConfig } from '../load-project-config.ts'
import {
  computeConfigInsertion,
  computeEnvExampleInsertion,
  computeRouteInsertion,
  ManifestValidationError,
  type PluginInstallManifest,
  parseManifest,
} from '../plugin-install-manifest.ts'
import { promptYesNo } from '../prompts.ts'
import { satisfiesRange } from '../semver-range.ts'

// ─── Injectable I/O (real impl + test fakes, mirrors commands/add.ts) ────────

export interface PluginInstallIo {
  exists(path: string): boolean
  read(path: string): string
  write(path: string, content: string): void
  stdout(s: string): void
  stderr(s: string): void
  /** `bun add <pkg>` (or whichever pm) for `additionalPackages`. */
  spawnAdd(pkg: string, cwd: string, allowScripts: boolean): { ok: boolean; message?: string }
  /** Confirmation prompt for the plugin `summary`. `true` = proceed. */
  confirm(message: string): boolean | Promise<boolean>
}

const realIo: PluginInstallIo = {
  exists: (p) => existsSync(p),
  read: (p) => readFileSync(p, 'utf8'),
  write: (p, c) => writeFileSync(p, c, 'utf8'),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  spawnAdd: (pkg, cwd, allowScripts) => {
    const args = allowScripts ? ['add', pkg] : ['add', '--ignore-scripts', pkg]
    const result = spawnSync('bun', args, { cwd, stdio: 'pipe', encoding: 'utf8' })
    if (result.status === 0) return { ok: true }
    const message = result.stderr || result.error?.message
    return message !== undefined ? { ok: false, message } : { ok: false }
  },
  confirm: (message) => promptYesNo({ message, default: false }),
}

export interface PluginInstallDeps {
  cwd?: string
  io?: PluginInstallIo
  yes?: boolean
  isTTY?: boolean
  /** Injectable so tests don't need a real `node_modules/@aihu/plugin`. */
  resolveHostAihuVersion?: (cwd: string) => Promise<string | undefined>
  /**
   * Injectable so tests don't need a real dynamic-`import()` of a temp-dir
   * `.ts` config file — `registry-resolve.ts`'s own tests avoid that for the
   * same reason (see `add.test.ts`'s disk-acceptance test comment). Defaults
   * to the real `loadProjectConfig`.
   */
  loadProjectConfigFn?: (cwd: string) => Promise<LoadedProjectConfig | null>
  exit?: (code: number) => never
}

/** Walk up from `cwd` looking for `node_modules/<pluginName>/package.json`. */
function resolvePluginDir(cwd: string, pluginName: string, io: PluginInstallIo): string | null {
  let dir = resolve(cwd)
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, 'node_modules', pluginName)
    if (io.exists(join(candidate, 'package.json'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

async function defaultResolveHostAihuVersion(cwd: string): Promise<string | undefined> {
  try {
    // Dynamic-imported, not a CLI dependency — same reasoning as
    // `load-project-config.ts`'s `@aihu/app` import: the version lives in the
    // CONSUMER project's own `node_modules`, resolved at runtime.
    const specifier = '@aihu/plugin'
    const mod = (await import(specifier)) as { AIHU_VERSION?: string }
    void cwd
    return mod.AIHU_VERSION
  } catch {
    return undefined
  }
}

function findRoutesFile(cwd: string, io: PluginInstallIo): string | null {
  const candidates = [
    'src/main.ts',
    'src/server.ts',
    'server.ts',
    'src/routes.ts',
    'apps/web/src/main.ts',
  ]
  for (const rel of candidates) {
    const p = join(cwd, rel)
    if (io.exists(p) && io.read(p).includes('createRequestRouter(')) return p
  }
  return null
}

export default async function pluginInstall(
  rest: ReadonlyArray<string>,
  deps: PluginInstallDeps = {},
): Promise<void> {
  const cwd = deps.cwd ?? process.cwd()
  const io = deps.io ?? realIo
  const exit =
    deps.exit ??
    ((code: number): never => {
      process.exit(code)
    })
  const resolveHostAihuVersion = deps.resolveHostAihuVersion ?? defaultResolveHostAihuVersion
  const loadConfig = deps.loadProjectConfigFn ?? loadProjectConfig

  const yes = deps.yes ?? rest.includes('--yes')
  const allowScripts = rest.includes('--allow-scripts')
  const pluginName = rest.find((a) => !a.startsWith('--'))
  if (pluginName === undefined) {
    io.stderr('Usage:\n  aihu plugin install <pluginName> [--yes]\n')
    return exit(1)
  }

  const pkgDir = resolvePluginDir(cwd, pluginName, io)
  if (pkgDir === null) {
    io.stderr(
      `ERROR: '${pluginName}' is not installed. Run \`bun add ${pluginName}\` first, ` +
        `then \`aihu plugin install ${pluginName}\`.\n`,
    )
    return exit(1)
  }

  const pkgJson = JSON.parse(io.read(join(pkgDir, 'package.json'))) as {
    name?: string
    version?: string
    homepage?: string
  }

  const manifestPath = join(pkgDir, 'install-manifest.json')
  if (!io.exists(manifestPath)) {
    io.stdout(
      `'${pluginName}' ships no install-manifest.json — install it manually.\n` +
        (pkgJson.homepage ? `See ${pkgJson.homepage} for setup instructions.\n` : ''),
    )
    return
  }

  let manifest: PluginInstallManifest
  try {
    manifest = parseManifest(JSON.parse(io.read(manifestPath)))
  } catch (err) {
    if (err instanceof ManifestValidationError) {
      io.stderr(`ERROR: ${pluginName}'s install-manifest.json is invalid: ${err.message}\n`)
      return exit(1)
    }
    throw err
  }

  if (manifest.pluginName !== pkgJson.name) {
    io.stderr(
      `ERROR: install-manifest.json pluginName "${manifest.pluginName}" does not match ` +
        `the resolved package "${pkgJson.name}".\n`,
    )
    return exit(1)
  }
  if (manifest.pluginVersion !== pkgJson.version) {
    io.stderr(
      `ERROR: install-manifest.json pluginVersion "${manifest.pluginVersion}" does not match ` +
        `the resolved package.json version "${pkgJson.version}".\n`,
    )
    return exit(1)
  }

  const hostAihuVersion = await resolveHostAihuVersion(cwd)
  if (hostAihuVersion !== undefined) {
    let ok: boolean
    try {
      ok = satisfiesRange(hostAihuVersion, manifest.aihuVersion)
    } catch (err) {
      io.stderr(`ERROR: cannot check aihuVersion range: ${(err as Error).message}\n`)
      return exit(1)
    }
    if (!ok) {
      io.stderr(
        `ERROR: ${pluginName}@${manifest.pluginVersion} requires aihu ${manifest.aihuVersion}; ` +
          `this project is on ${hostAihuVersion}.\n`,
      )
      return exit(1)
    }
  }

  for (const pkg of manifest.additionalPackages ?? []) {
    if (!pkg.startsWith('@aihu/')) {
      io.stderr(
        `ERROR: install-manifest.json lists additionalPackages entry "${pkg}", which is not ` +
          `an @aihu/* package. Refusing to install a non-@aihu/* runtime dependency.\n`,
      )
      return exit(1)
    }
  }

  const applied: string[] = []
  const skipped: string[] = []
  const writes = new Map<string, string>()
  const packagesToInstall: string[] = []
  const planned: string[] = []
  if (manifest.summary) planned.push(`Summary: ${manifest.summary}`)
  const scheduleWrite = (path: string, content: string, description: string) => {
    writes.set(path, content)
    planned.push(`${description}: ${path}`)
  }

  for (const step of manifest.installSteps) {
    if (step.kind === 'add-plugin-to-config') {
      const loaded = await loadConfig(cwd)
      if (loaded === null) {
        io.stderr('  ! no vite.config.ts/aihu.config.ts found — skipping add-plugin-to-config.\n')
        skipped.push(step.kind)
        continue
      }
      const source = io.read(loaded.source)
      const edit = computeConfigInsertion(source, step, pluginName)
      if (edit.applied) {
        scheduleWrite(loaded.source, edit.updated, `Register ${step.factoryName}`)
        applied.push(`registered ${step.factoryName} in ${loaded.source}`)
      } else {
        skipped.push(
          `add-plugin-to-config (${step.factoryName} already registered, or plugins: [] not found)`,
        )
      }
    } else if (step.kind === 'add-route') {
      const routesFile = findRoutesFile(cwd, io)
      if (routesFile === null) {
        io.stderr(
          `  ! could not locate a routes file with createRequestRouter(...) — register ` +
            `${step.factoryName}'s routes manually.\n`,
        )
        skipped.push(step.kind)
        continue
      }
      const source = io.read(routesFile)
      const edit = computeRouteInsertion(source, step, pluginName)
      if (edit.applied) {
        scheduleWrite(routesFile, edit.updated, `Add ${step.routes.length} route(s)`)
        applied.push(`added ${step.routes.length} route(s) to ${routesFile}`)
      } else {
        skipped.push(`add-route (routes already present in ${routesFile})`)
      }
    } else if (step.kind === 'add-env-var') {
      const envPath = join(cwd, '.env.example')
      const existing = writes.get(envPath) ?? (io.exists(envPath) ? io.read(envPath) : undefined)
      const edit = computeEnvExampleInsertion(existing, step)
      if (edit.applied) {
        scheduleWrite(envPath, edit.updated, `Add ${step.name} to .env.example`)
        applied.push(`added ${step.name} to .env.example`)
      } else {
        skipped.push(`add-env-var (${step.name} already present)`)
      }
    } else if (step.kind === 'run-migration') {
      io.stderr(
        `  ! run-migration step (${step.path}, backend ${step.backend}) is not yet supported — ` +
          'apply it manually.\n',
      )
      skipped.push(step.kind)
    }
  }

  for (const entry of manifest.requiredEnv ?? []) {
    const envPath = join(cwd, '.env.example')
    const existing = writes.get(envPath) ?? (io.exists(envPath) ? io.read(envPath) : undefined)
    const edit = computeEnvExampleInsertion(existing, entry)
    if (edit.applied) {
      scheduleWrite(envPath, edit.updated, `Add ${entry.name} to .env.example`)
      applied.push(`added ${entry.name} to .env.example`)
    }
  }

  for (const pkg of manifest.additionalPackages ?? []) {
    packagesToInstall.push(pkg)
    planned.push(`Install ${pkg}`)
  }

  io.stdout(
    `Planned changes for ${pluginName}:\n${planned.map((item) => `  - ${item}\n`).join('') || '  - No file or package changes.\n'}`,
  )
  if (packagesToInstall.length > 0) {
    io.stdout(
      allowScripts
        ? 'Package lifecycle scripts are enabled by --allow-scripts.\n'
        : 'Package lifecycle scripts are disabled with --ignore-scripts.\n',
    )
  }

  if (!yes) {
    if (!(deps.isTTY ?? process.stdin.isTTY === true)) {
      io.stderr(
        'ERROR: refusing to apply plugin install changes without a TTY; rerun with --yes.\n',
      )
      return exit(1)
    }
    if (!(await io.confirm('Apply these install steps? [y/N] '))) {
      io.stdout('Aborted — no changes made.\n')
      return
    }
  }

  for (const [path, content] of writes) io.write(path, content)

  for (const pkg of packagesToInstall) {
    const result = io.spawnAdd(pkg, cwd, allowScripts)
    if (result.ok) {
      applied.push(`installed ${pkg}`)
    } else {
      io.stderr(`  ! failed to install ${pkg}: ${result.message ?? 'unknown error'}\n`)
    }
  }

  for (const line of applied) io.stdout(`  ${line}\n`)
  for (const line of skipped) io.stdout(`  skipped  ${line}\n`)
  io.stdout(`\nDone. ${applied.length} step(s) applied, ${skipped.length} skipped.\n`)
}
