/**
 * scaffold-and-compile harness for `@aihu/templates-cf-solo` — mirrors
 * `scaffold-and-compile.test.ts` (the cf-team coverage), minus the
 * auth-provider matrix (cf-solo has no `auth` overridable).
 *
 * Per arch-6 §10 Round B2, cf-solo stamps out the same pipeline shape as
 * cf-team into a flattened, single-package tree. Nothing in the pipeline
 * itself branches on repo shape (`fixed.repo` is descriptive metadata, not
 * consumed by `scaffold-pipeline.ts`), so the acceptance bar is the same:
 * file-presence assertions always run; the install+typecheck+build chain
 * runs only under `AIHU_SCAFFOLD_COMPILE=1` (see the cf-team harness's
 * header for why: the emitted `@aihu/*` peer deps may momentarily lead what
 * is published to npm).
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI_BIN = resolve(HERE, '..', 'src', 'bin.ts')
const REPO_ROOT = resolve(HERE, '..', '..', '..')

const RUN_COMPILE = process.env.AIHU_SCAFFOLD_COMPILE === '1'
const ON_WINDOWS = process.platform === 'win32'

interface ScaffoldedApp {
  appRoot: string
  parentDir: string
}

let parentDir: string

beforeEach(() => {
  parentDir = mkdtempSync(join(tmpdir(), 'aihu-scaffold-cf-solo-'))
})

afterEach(() => {
  if (parentDir !== '') rmSync(parentDir, { recursive: true, force: true })
})

function scaffoldCfSolo(appName: string): ScaffoldedApp {
  const appRoot = join(parentDir, appName)
  const argv = [
    CLI_BIN,
    'app',
    appName,
    '--template',
    'cf-solo',
    '--no-interactive',
    '--use-defaults',
    '--no-git',
    '--no-install',
  ]

  const result = spawnSync('bun', argv, {
    cwd: parentDir,
    encoding: 'utf8',
    env: process.env,
  })
  if (result.status !== 0) {
    throw new Error(
      `scaffold failed (status=${result.status}):\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    )
  }
  return { appRoot, parentDir }
}

describe('scaffold-and-compile · cf-solo', () => {
  it('scaffolds the flattened single-package file set (defaults)', () => {
    const appName = 'myapp-solo'
    const { appRoot } = scaffoldCfSolo(appName)

    expect(existsSync(appRoot)).toBe(true)

    // Default-on conditionals (agentSurface=minimal, starter=live-counter).
    expect(existsSync(join(appRoot, '.mcp.json'))).toBe(true)
    expect(existsSync(join(appRoot, 'src', 'components', 'live-counter.aihu'))).toBe(true)
    expect(existsSync(join(appRoot, 'src', 'agent', 'aihu-expose.aihu'))).toBe(true)

    // Single-package shape: no monorepo nesting, no moon, no auth files.
    expect(existsSync(join(appRoot, 'apps'))).toBe(false)
    expect(existsSync(join(appRoot, 'packages'))).toBe(false)
    expect(existsSync(join(appRoot, 'moon.yml'))).toBe(false)
    expect(existsSync(join(appRoot, 'src', 'auth'))).toBe(false)

    // Sanity: root package.json + wrangler.toml emitted, .tmpl stripped.
    expect(existsSync(join(appRoot, 'package.json'))).toBe(true)
    expect(existsSync(join(appRoot, 'wrangler.toml'))).toBe(true)
    expect(existsSync(join(appRoot, 'package.json.tmpl'))).toBe(false)
  })

  it.skipIf(ON_WINDOWS || !RUN_COMPILE)(
    'scaffolded app installs + typechecks + builds',
    () => {
      const appName = 'compile-solo'
      const { appRoot } = scaffoldCfSolo(appName)

      const install = spawnSync('bun', ['install', '--frozen-lockfile'], {
        cwd: appRoot,
        encoding: 'utf8',
        env: { ...process.env, BUN_INSTALL_CACHE_DIR: join(REPO_ROOT, '.bun-install-cache') },
      })
      expect(install.status, `bun install stderr: ${install.stderr}`).toBe(0)

      const typecheck = spawnSync('bun', ['run', 'typecheck'], { cwd: appRoot, encoding: 'utf8' })
      expect(typecheck.status, `bun run typecheck stderr: ${typecheck.stderr}`).toBe(0)

      const build = spawnSync('bun', ['run', 'build'], { cwd: appRoot, encoding: 'utf8' })
      expect(build.status, `bun run build stderr: ${build.stderr}`).toBe(0)
    },
    180_000,
  )
})
