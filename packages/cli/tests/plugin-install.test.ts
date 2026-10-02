/**
 * Command-level tests for `aihu plugin install <name>` — exercises the real
 * `node_modules` resolution + `loadProjectConfig`'s legacy `aihu.config.ts`
 * path against a real temp directory (same acceptance style as
 * `add.test.ts`'s real-temp-dir check), with only `spawnAdd`/`confirm`
 * injected so no `bun add` actually runs.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import pluginInstall, { type PluginInstallIo } from '../src/commands/plugin-install.ts'
import type { LoadedProjectConfig } from '../src/load-project-config.ts'

const tmpDirs: string[] = []

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'aihu-plugin-install-'))
  tmpDirs.push(root)
  writeFileSync(join(root, 'aihu.config.ts'), 'export default { plugins: [] }\n')
  return root
}

/**
 * Fake `loadProjectConfig` pointed at the temp project's `aihu.config.ts`.
 * Avoids a real dynamic `import()` of a `.ts` file in a temp dir, which this
 * suite's own `add.test.ts` disk-acceptance test documents as unreliable —
 * the write/read side stays real (`PluginInstallIo`); only config-file
 * DISCOVERY is faked, same division `registry-resolve.ts`'s tests use.
 */
function fakeLoadProjectConfig(root: string): () => Promise<LoadedProjectConfig | null> {
  return async () => ({ config: {}, source: join(root, 'aihu.config.ts'), from: 'aihu.config' })
}

function installFixturePlugin(
  root: string,
  opts: {
    pluginName: string
    version?: string
    manifest?: unknown
    homepage?: string
  },
): void {
  const version = opts.version ?? '1.0.0'
  const pkgDir = join(root, 'node_modules', opts.pluginName)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({ name: opts.pluginName, version, homepage: opts.homepage }),
  )
  if (opts.manifest !== undefined) {
    writeFileSync(join(pkgDir, 'install-manifest.json'), JSON.stringify(opts.manifest))
  }
}

function fakeIo(): PluginInstallIo & { out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    exists: (p) => {
      try {
        readFileSync(p)
        return true
      } catch {
        return false
      }
    },
    read: (p) => readFileSync(p, 'utf8'),
    write: (p, c) => writeFileSync(p, c, 'utf8'),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    spawnAdd: () => ({ ok: true }),
    confirm: () => true,
  }
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('aihu plugin install', () => {
  it('applies add-plugin-to-config + add-env-var against a real aihu.config.ts', async () => {
    const root = makeProject()
    installFixturePlugin(root, {
      pluginName: '@aihu/seo',
      version: '1.0.0',
      manifest: {
        pluginName: '@aihu/seo',
        pluginVersion: '1.0.0',
        aihuVersion: '*',
        summary: 'Installs SEO extensions.',
        installSteps: [
          {
            kind: 'add-plugin-to-config',
            factoryName: 'seo',
            defaultOptions: { siteName: 'My App' },
          },
        ],
        requiredEnv: [{ name: 'SITE_URL', description: 'Canonical site URL' }],
      },
    })
    const io = fakeIo()

    await pluginInstall(['@aihu/seo', '--yes'], {
      cwd: root,
      io,
      yes: true,
      resolveHostAihuVersion: async () => undefined,
      loadProjectConfigFn: fakeLoadProjectConfig(root),
    })

    const config = readFileSync(join(root, 'aihu.config.ts'), 'utf8')
    expect(config).toContain("import { seo } from '@aihu/seo'")
    expect(config).toContain('seo({ siteName: "My App" })')
    const env = readFileSync(join(root, '.env.example'), 'utf8')
    expect(env).toContain('SITE_URL=')
  })

  it('shows planned edits and packages and waits for confirmation when summary is absent', async () => {
    const root = makeProject()
    installFixturePlugin(root, {
      pluginName: '@aihu/seo',
      manifest: {
        pluginName: '@aihu/seo',
        pluginVersion: '1.0.0',
        aihuVersion: '*',
        installSteps: [{ kind: 'add-env-var', name: 'SITE_URL', description: 'Canonical URL' }],
        additionalPackages: ['@aihu/plugin'],
      },
    })
    const io = fakeIo()
    let spawned = false
    io.spawnAdd = () => {
      spawned = true
      return { ok: true }
    }
    io.confirm = () => false

    await pluginInstall(['@aihu/seo'], {
      cwd: root,
      io,
      isTTY: true,
      resolveHostAihuVersion: async () => undefined,
    })

    expect(io.out.join('')).toContain('Add SITE_URL to .env.example')
    expect(io.out.join('')).toContain('Install @aihu/plugin')
    expect(io.out.join('')).toContain('disabled with --ignore-scripts')
    expect(io.out.join('')).toContain('Aborted')
    expect(readFileSync(join(root, 'aihu.config.ts'), 'utf8')).toBe(
      'export default { plugins: [] }\n',
    )
    expect(() => readFileSync(join(root, '.env.example'), 'utf8')).toThrow()
    expect(spawned).toBe(false)
  })

  it('refuses non-TTY install without --yes before writing files or adding packages', async () => {
    const root = makeProject()
    installFixturePlugin(root, {
      pluginName: '@aihu/seo',
      manifest: {
        pluginName: '@aihu/seo',
        pluginVersion: '1.0.0',
        aihuVersion: '*',
        installSteps: [{ kind: 'add-env-var', name: 'SITE_URL', description: 'Canonical URL' }],
        additionalPackages: ['@aihu/plugin'],
      },
    })
    const io = fakeIo()
    let spawned = false
    io.spawnAdd = () => {
      spawned = true
      return { ok: true }
    }
    let exited: number | undefined

    await expect(
      pluginInstall(['@aihu/seo'], {
        cwd: root,
        io,
        isTTY: false,
        resolveHostAihuVersion: async () => undefined,
        exit: (code): never => {
          exited = code
          throw new Error(`exit ${code}`)
        },
      }),
    ).rejects.toThrow('exit 1')

    expect(exited).toBe(1)
    expect(io.err.join('')).toContain('refusing to apply')
    expect(() => readFileSync(join(root, '.env.example'), 'utf8')).toThrow()
    expect(spawned).toBe(false)
  })

  it('passes lifecycle-script opt-in through to package installation', async () => {
    const root = makeProject()
    installFixturePlugin(root, {
      pluginName: '@aihu/seo',
      manifest: {
        pluginName: '@aihu/seo',
        pluginVersion: '1.0.0',
        aihuVersion: '*',
        installSteps: [],
        additionalPackages: ['@aihu/plugin'],
      },
    })
    const io = fakeIo()
    let allowScripts: boolean | undefined
    io.spawnAdd = (_pkg, _cwd, allowed) => {
      allowScripts = allowed
      return { ok: true }
    }

    await pluginInstall(['@aihu/seo', '--yes', '--allow-scripts'], {
      cwd: root,
      io,
      yes: true,
      resolveHostAihuVersion: async () => undefined,
    })

    expect(allowScripts).toBe(true)
    expect(io.out.join('')).toContain('lifecycle scripts are enabled by --allow-scripts')
  })

  it('is idempotent end to end — running twice does not duplicate', async () => {
    const root = makeProject()
    installFixturePlugin(root, {
      pluginName: '@aihu/plugin-demo',
      version: '0.1.0',
      manifest: {
        pluginName: '@aihu/plugin-demo',
        pluginVersion: '0.1.0',
        aihuVersion: '*',
        installSteps: [{ kind: 'add-plugin-to-config', factoryName: 'demo', defaultOptions: {} }],
      },
    })
    const io = fakeIo()
    const run = () =>
      pluginInstall(['@aihu/plugin-demo', '--yes'], {
        cwd: root,
        io,
        yes: true,
        resolveHostAihuVersion: async () => undefined,
        loadProjectConfigFn: fakeLoadProjectConfig(root),
      })

    await run()
    const once = readFileSync(join(root, 'aihu.config.ts'), 'utf8')
    await run()
    const twice = readFileSync(join(root, 'aihu.config.ts'), 'utf8')
    expect(twice).toBe(once)
    expect((once.match(/demo\(\{\}\)/g) ?? []).length).toBe(1)
  })

  it('falls back to a manual-install message when no manifest ships', async () => {
    const root = makeProject()
    installFixturePlugin(root, {
      pluginName: '@aihu/no-manifest',
      homepage: 'https://example.com/no-manifest',
    })
    const io = fakeIo()
    let exited: number | undefined
    await pluginInstall(['@aihu/no-manifest'], {
      cwd: root,
      io,
      exit: (code): never => {
        exited = code
        throw new Error(`exit ${code}`)
      },
    })
    expect(exited).toBeUndefined()
    expect(io.out.join('')).toContain('ships no install-manifest.json')
    expect(io.out.join('')).toContain('https://example.com/no-manifest')
  })

  it('aborts on a pluginVersion mismatch', async () => {
    const root = makeProject()
    installFixturePlugin(root, {
      pluginName: '@aihu/seo',
      version: '2.0.0',
      manifest: {
        pluginName: '@aihu/seo',
        pluginVersion: '1.0.0',
        aihuVersion: '*',
        installSteps: [],
      },
    })
    const io = fakeIo()
    let exited: number | undefined
    await expect(
      pluginInstall(['@aihu/seo', '--yes'], {
        cwd: root,
        io,
        yes: true,
        exit: (code): never => {
          exited = code
          throw new Error(`exit ${code}`)
        },
      }),
    ).rejects.toThrow()
    expect(exited).toBe(1)
    expect(io.err.join('')).toContain('pluginVersion')
  })

  it('refuses an additionalPackages entry outside the @aihu/* namespace', async () => {
    const root = makeProject()
    installFixturePlugin(root, {
      pluginName: '@aihu/auth',
      manifest: {
        pluginName: '@aihu/auth',
        pluginVersion: '1.0.0',
        aihuVersion: '*',
        installSteps: [],
        additionalPackages: ['left-pad'],
      },
    })
    const io = fakeIo()
    let exited: number | undefined
    await expect(
      pluginInstall(['@aihu/auth', '--yes'], {
        cwd: root,
        io,
        yes: true,
        resolveHostAihuVersion: async () => undefined,
        exit: (code): never => {
          exited = code
          throw new Error(`exit ${code}`)
        },
      }),
    ).rejects.toThrow()
    expect(exited).toBe(1)
    expect(io.err.join('')).toContain('left-pad')
  })

  it('rejects an unrecognized install-step kind before applying changes', async () => {
    const root = makeProject()
    installFixturePlugin(root, {
      pluginName: '@aihu/seo',
      manifest: {
        pluginName: '@aihu/seo',
        pluginVersion: '1.0.0',
        aihuVersion: '*',
        installSteps: [{ kind: 'register-plugin', description: 'legacy pre-spec step' }],
      },
    })
    const io = fakeIo()
    let exited: number | undefined
    await expect(
      pluginInstall(['@aihu/seo', '--yes'], {
        cwd: root,
        io,
        yes: true,
        resolveHostAihuVersion: async () => undefined,
        exit: (code): never => {
          exited = code
          throw new Error(`exit ${code}`)
        },
      }),
    ).rejects.toThrow('exit 1')
    expect(exited).toBe(1)
    expect(io.err.join('')).toContain('unknown kind "register-plugin"')
    expect(readFileSync(join(root, 'aihu.config.ts'), 'utf8')).toBe(
      'export default { plugins: [] }\n',
    )
  })

  it('rejects install when the host aihuVersion does not satisfy the manifest range', async () => {
    const root = makeProject()
    installFixturePlugin(root, {
      pluginName: '@aihu/seo',
      manifest: {
        pluginName: '@aihu/seo',
        pluginVersion: '1.0.0',
        aihuVersion: '^5.0.0',
        installSteps: [],
      },
    })
    const io = fakeIo()
    let exited: number | undefined
    await expect(
      pluginInstall(['@aihu/seo', '--yes'], {
        cwd: root,
        io,
        yes: true,
        resolveHostAihuVersion: async () => '0.2.0',
        exit: (code): never => {
          exited = code
          throw new Error(`exit ${code}`)
        },
      }),
    ).rejects.toThrow()
    expect(exited).toBe(1)
    expect(io.err.join('')).toContain('requires aihu ^5.0.0')
  })
})
