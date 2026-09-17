/**
 * `aihu list` tests (Plan 5 Task 7 Step 2).
 *
 * Covers:
 *   - `aihu list` prints EVERY fixture registry item (name, type, description)
 *   - `aihu list --installed` reflects ONLY recipes copied into `ui.target`,
 *     with the version from the `ui.primitives` record (D-4)
 *   - the R6 resolver error paths surface (no config / no registry / no ui field)
 *
 * The resolver's I/O surfaces (config load, fs, registry-root locate) plus the
 * target-dir scan + primitives-record read are injected with in-memory fakes so
 * the logic is exercised deterministically without touching disk.
 */

import { join } from 'node:path'
import type { Registry } from '@aihu/ui/registry'
import { describe, expect, it } from 'vitest'
import type { ListIo } from '../src/commands/list.ts'
import list from '../src/commands/list.ts'
import type { RegistryFs } from '../src/registry-resolve.ts'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const REGISTRY: Registry = {
  items: [
    {
      name: 'button',
      type: 'ui',
      description: 'Styled button.',
      files: [{ path: 'registry/button/button.aihu', type: 'component' }],
      dependencies: ['@aihu/primitives'],
      registryDependencies: [],
    },
    {
      name: 'card',
      type: 'ui',
      description: 'Slotted card.',
      files: [{ path: 'registry/card/card.aihu', type: 'component' }],
    },
    {
      name: 'badge',
      type: 'ui',
      description: 'Pill badge.',
      files: [{ path: 'registry/badge/badge.aihu', type: 'component' }],
    },
  ],
}

const REGISTRY_ROOT = '/fake/node_modules/@aihu/ui'

function makeFs(seed: Record<string, string>): RegistryFs & { files: Record<string, string> } {
  const files = { ...seed }
  return {
    files,
    exists: (p) => Object.hasOwn(files, p),
    read: (p) => {
      if (!Object.hasOwn(files, p)) throw new Error(`ENOENT (fake): ${p}`)
      return files[p] as string
    },
  }
}

/** Capture stdout/stderr + drive `listDir` off a seeded dir → basenames map. */
function makeIo(dirs: Record<string, string[]> = {}): ListIo & { out: string; err: string } {
  const sink = { out: '', err: '' }
  const io: ListIo = {
    listDir: (dir) => dirs[dir] ?? [],
    stdout: (s) => {
      sink.out += s
    },
    stderr: (s) => {
      sink.err += s
    },
  }
  return Object.defineProperties(io as ListIo & { out: string; err: string }, {
    out: { get: () => sink.out },
    err: { get: () => sink.err },
  })
}

function makeResolveDeps(opts: {
  fs: RegistryFs
  ui?: Record<string, unknown> | undefined
  hasUi?: boolean
  registryRoot?: string | null
}) {
  const { fs, ui, hasUi = true, registryRoot = REGISTRY_ROOT } = opts
  return {
    fs,
    configLoader: {
      async load() {
        if (!hasUi && ui === undefined) return null
        return hasUi ? { ui } : {}
      },
    },
    resolveRegistryRoot: () => registryRoot,
  }
}

function makeExit() {
  return (code: number): never => {
    throw new Error(`__exit__:${code}`)
  }
}

function baseFs() {
  return makeFs({
    '/proj/aihu.config.ts': 'export default {}',
    [join(REGISTRY_ROOT, 'registry.json')]: JSON.stringify(REGISTRY),
  })
}

// ─── aihu list (no flags) ──────────────────────────────────────────────────────

describe('aihu list — prints all registry items', () => {
  it('lists every fixture item with name, type, and description', async () => {
    const fs = baseFs()
    const io = makeIo()
    const resolve = makeResolveDeps({ fs, ui: {} })
    await list([], { cwd: '/proj', fs, io, resolve, exit: makeExit() })

    expect(io.out).toContain('Available recipes (3)')
    expect(io.out).toContain('button')
    expect(io.out).toContain('(ui)')
    expect(io.out).toContain('Styled button.')
    expect(io.out).toContain('card')
    expect(io.out).toContain('Slotted card.')
    expect(io.out).toContain('badge')
    expect(io.out).toContain('Pill badge.')
  })

  it('prints a friendly message when the registry is empty', async () => {
    const fs = makeFs({
      '/proj/aihu.config.ts': 'export default {}',
      [join(REGISTRY_ROOT, 'registry.json')]: JSON.stringify({ items: [] }),
    })
    const io = makeIo()
    const resolve = makeResolveDeps({ fs, ui: {} })
    await list([], { cwd: '/proj', fs, io, resolve, exit: makeExit() })
    expect(io.out).toContain('No recipes in the registry.')
  })
})

// ─── aihu list --installed ─────────────────────────────────────────────────────

describe('aihu list --installed — reflects only what was added', () => {
  const targetDir = '/proj/src/components/ui'

  it('lists only recipes copied into ui.target, with recorded versions (D-4)', async () => {
    const fs = baseFs()
    // Only button + card were copied into the target.
    const io = makeIo({ [targetDir]: ['button.aihu', 'card.aihu'] })
    const resolve = makeResolveDeps({ fs, ui: { target: targetDir } })
    await list(['--installed'], {
      cwd: '/proj',
      fs,
      io,
      resolve,
      exit: makeExit(),
      readPrimitives: () => ({ button: '@aihu/primitives', card: null }),
    })

    expect(io.out).toContain('Installed recipes (2)')
    expect(io.out).toContain('button')
    expect(io.out).toContain('@aihu/primitives')
    expect(io.out).toContain('card')
    // badge was never copied — must NOT appear.
    expect(io.out).not.toContain('badge')
  })

  it('reports nothing installed when the target dir is empty', async () => {
    const fs = baseFs()
    const io = makeIo({ [targetDir]: [] })
    const resolve = makeResolveDeps({ fs, ui: { target: targetDir } })
    await list(['--installed'], { cwd: '/proj', fs, io, resolve, exit: makeExit() })
    expect(io.out).toContain('No recipes installed.')
  })

  it('does not list a registry item that has no copied file', async () => {
    const fs = baseFs()
    // Only badge copied.
    const io = makeIo({ [targetDir]: ['badge.aihu'] })
    const resolve = makeResolveDeps({ fs, ui: { target: targetDir } })
    await list(['--installed'], { cwd: '/proj', fs, io, resolve, exit: makeExit() })
    expect(io.out).toContain('Installed recipes (1)')
    expect(io.out).toContain('badge')
    expect(io.out).not.toContain('button')
    expect(io.out).not.toContain('card')
  })
})

// ─── error paths (R6) ──────────────────────────────────────────────────────────

describe('aihu list — resolver error paths (R6)', () => {
  it('no aihu.config.ts / vite.config.ts → exits nonzero with actionable message', async () => {
    const fs = makeFs({})
    const io = makeIo()
    const resolve = makeResolveDeps({ fs, hasUi: false })
    await expect(list([], { cwd: '/proj', fs, io, resolve, exit: makeExit() })).rejects.toThrow(
      '__exit__:1',
    )
    expect(io.err).toContain('No aihu project config found')
  })

  it('@aihu/ui not installed → exits nonzero with `bun add -D`', async () => {
    const fs = makeFs({ '/proj/aihu.config.ts': 'export default {}' })
    const io = makeIo()
    const resolve = makeResolveDeps({ fs, ui: {}, registryRoot: null })
    await expect(list([], { cwd: '/proj', fs, io, resolve, exit: makeExit() })).rejects.toThrow(
      '__exit__:1',
    )
    expect(io.err).toContain('is not installed')
  })

  it('config present but no `ui` field → exits nonzero', async () => {
    const fs = makeFs({ '/proj/aihu.config.ts': 'export default {}' })
    const io = makeIo()
    const resolve = makeResolveDeps({ fs, hasUi: true, ui: undefined })
    await expect(list([], { cwd: '/proj', fs, io, resolve, exit: makeExit() })).rejects.toThrow(
      '__exit__:1',
    )
    expect(io.err).toContain('no `ui` field')
  })
})
