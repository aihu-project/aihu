#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
/**
 * Packages the VSIX from an isolated staging directory instead of running
 * `vsce package` directly against the workspace tree.
 *
 * `vsce`'s default file walk follows `node_modules/@aihu/language-server` —
 * a bun workspace symlink — straight into the sibling package's full SOURCE
 * tree (tests, tsconfig, its own node_modules) rather than treating it as an
 * installed dependency scoped to that package's declared `files`. That drags
 * the rest of the monorepo into the walk and vsce ends up rejecting a path
 * it computes outside the extension root (see aihu#723). Staging a real,
 * non-symlinked copy of only the files each dependency actually needs at
 * runtime keeps the walk inside the extension's own directory and lets
 * vsce's own `npm list --production` check — which it runs unless told not
 * to bundle any node_modules at all — pass honestly instead of being
 * bypassed.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const extRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(extRoot, '..', '..')
const staging = join(extRoot, '.vsix-staging')
// bun's deduped flat fallback store — holds one copy of every installed npm
// package, which is what `require()` actually resolves to for a dependency
// that isn't hoisted to a plain `node_modules/<name>` symlink in this layout.
const flatStore = join(repoRoot, 'node_modules', '.bun', 'node_modules')

function run(cmd: string[], cwd: string): void {
  const result = spawnSync(cmd[0], cmd.slice(1), { cwd, stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`\`${cmd.join(' ')}\` failed in ${cwd}`)
  }
}

function readPkgJson(dir: string): { dependencies?: Record<string, string> } {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
}

/** Stage `pkgDir` (a workspace or installed package) honoring its own `files` field. */
function copyDeclaredFiles(pkgDir: string, destDir: string): void {
  const pkgJson = readPkgJson(pkgDir) as { files?: string[] }
  const files = pkgJson.files ?? ['dist', 'README.md', 'LICENSE', 'package.json']
  mkdirSync(destDir, { recursive: true })
  cpSync(join(pkgDir, 'package.json'), join(destDir, 'package.json'))
  for (const entry of files) {
    const src = join(pkgDir, entry)
    if (existsSync(src)) cpSync(src, join(destDir, entry), { recursive: true })
  }
}

/**
 * Resolve `name` the way Node actually would for a requirer installed at
 * `fromNodeModules`: prefer a version-specific override sitting alongside
 * the requirer in bun's per-package node_modules bucket (bun's store nests
 * conflicting versions this way), and only fall back to the deduped flat
 * store when there's no such override.
 */
function resolveNpmDep(name: string, fromNodeModules: string): string {
  const local = join(fromNodeModules, name)
  return existsSync(local) ? realpathSync(local) : realpathSync(join(flatStore, name))
}

/** Recursively stage a plain npm dependency and everything it depends on. */
function stageNpmDepTree(
  name: string,
  fromNodeModules: string,
  destRoot: string,
  staged: Map<string, string>,
): void {
  const real = resolveNpmDep(name, fromNodeModules)
  const already = staged.get(name)
  if (already === real) return
  if (already !== undefined && already !== real) {
    throw new Error(`conflicting resolutions for "${name}": ${already} vs ${real}`)
  }
  staged.set(name, real)
  cpSync(real, join(destRoot, name), { recursive: true })
  const { dependencies } = readPkgJson(real)
  for (const dep of Object.keys(dependencies ?? {})) {
    stageNpmDepTree(dep, dirname(real), destRoot, staged)
  }
}

// 1. Build the extension client and its runtime deps. `@aihu/tsc` is a
// build-time-only input to language-server's bundle (rolldown inlines it —
// see packages/language-server/rolldown.config.ts's `external` list, which
// does NOT include it) and ships nowhere in the VSIX.
run(['bun', 'run', 'build'], join(repoRoot, 'packages', 'tsc'))
run(['bun', 'run', 'build'], join(repoRoot, 'packages', 'language-server'))
run(['bun', 'run', 'build'], extRoot)

// 2. Fresh staging dir.
rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })

// 3. Copy the extension's own shipped files — real copies, no symlinks back
// into the workspace.
for (const entry of ['dist', 'syntaxes', 'snippets', 'language-configuration.json', 'README.md']) {
  const src = join(extRoot, entry)
  if (existsSync(src)) cpSync(src, join(staging, entry), { recursive: true })
}
const rootLicense = join(repoRoot, 'LICENSE')
if (existsSync(rootLicense)) cpSync(rootLicense, join(staging, 'LICENSE'))

// `dist` is already built; dropping `scripts`/`devDependencies` means vsce
// has nothing to re-run and nothing extra to validate (no source or
// tsconfig exists in the staging dir to run a prepublish script against).
// `dependencies['@aihu/language-server']` is rewritten below from
// `workspace:*` — a bun-only protocol `npm list` can't parse as a semver
// range — to the real version actually staged.
const extPkgJson = JSON.parse(readFileSync(join(extRoot, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  [key: string]: unknown
}
delete extPkgJson.scripts
delete extPkgJson.devDependencies

// 4. Stage @aihu/language-server with only its true runtime deps declared.
// Its own package.json lists everything it imports at the SOURCE level
// (@volar/*, volar-service-typescript, typescript, @aihu/tsc, ...), but
// rolldown bundles all of that into dist/bin.js and dist/server.js except
// the three packages its `external` config actually keeps out:
// @aihu/compiler, vscode-languageserver, vscode-languageserver-textdocument.
// Declaring the rest would make vsce's `npm list --production` check demand
// node_modules that nothing at runtime actually requires.
const languageServerDir = join(repoRoot, 'packages', 'language-server')
copyDeclaredFiles(languageServerDir, join(staging, 'node_modules', '@aihu', 'language-server'))
const languageServerPkgJsonPath = join(
  staging,
  'node_modules',
  '@aihu',
  'language-server',
  'package.json',
)
const languageServerPkgJson = JSON.parse(readFileSync(languageServerPkgJsonPath, 'utf8'))
const { dependencies: realLsDeps } = readPkgJson(languageServerDir)
const flatVersion = (name: string): string =>
  (readPkgJson(realpathSync(join(flatStore, name))) as { version?: string }).version ??
  (() => {
    throw new Error(`no version in ${name}'s package.json`)
  })()
languageServerPkgJson.dependencies = {
  '@aihu/compiler': realLsDeps?.['@aihu/compiler'],
  'vscode-languageserver': flatVersion('vscode-languageserver'),
  'vscode-languageserver-textdocument': flatVersion('vscode-languageserver-textdocument'),
}
writeFileSync(languageServerPkgJsonPath, JSON.stringify(languageServerPkgJson, null, 2))

if (extPkgJson.dependencies?.['@aihu/language-server']) {
  extPkgJson.dependencies['@aihu/language-server'] = languageServerPkgJson.version
}
writeFileSync(join(staging, 'package.json'), JSON.stringify(extPkgJson, null, 2))

// 5. Stage @aihu/compiler (a real installed npm dep, not a workspace
// symlink — its own package.json declares no `dependencies`, only
// platform-native `optionalDependencies` npm list doesn't require present).
copyDeclaredFiles(
  realpathSync(join(repoRoot, 'node_modules', '@aihu', 'compiler')),
  join(staging, 'node_modules', '@aihu', 'compiler'),
)

// 6. Stage the plain npm runtime deps and everything THEY depend on,
// recursively, from bun's flat store — so nothing is missing from vsce's
// `npm list --production` walk.
const staged = new Map<string, string>()
for (const dep of [
  'vscode-languageclient',
  'vscode-languageserver',
  'vscode-languageserver-textdocument',
]) {
  stageNpmDepTree(dep, flatStore, join(staging, 'node_modules'), staged)
}

// 7. Package from the clean staging directory.
run(['bunx', 'vsce', 'package', '--out', extRoot], staging)

// 8. Staging dir is scratch; drop it.
rmSync(staging, { recursive: true, force: true })
