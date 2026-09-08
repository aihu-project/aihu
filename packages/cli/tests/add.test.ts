/**
 * `aihu add` tests (Plan 5 Task 6 Step 4).
 *
 * Covers, per the R-decisions:
 *   - happy path: `aihu add button` writes `button.aihu` to `ui.target`
 *   - --prefix acme rewrites the tag name AND the `customElements.define` call (§9.4)
 *   - --dry-run writes nothing but prints the plan
 *   - --diff shows a diff when the target already exists
 *   - collision aborts without --force; overwrites with --force (R9)
 *   - SYNTHETIC two-recipe fixture (recipe-A → recipe-B): transitive resolution
 *     + a cycle-guard case (A→B→A terminates) (R8)
 *   - each of the four error paths exits nonzero with the expected message (R6)
 *
 * The resolver's I/O surfaces (config load, fs, registry-root locate) are
 * injected with in-memory fakes so the resolution/transform logic is exercised
 * deterministically. An additional real-temp-dir acceptance check writes a
 * working `<acme-button>` recipe to disk (the §12.4 acceptance line).
 */

import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Registry } from '@aihu/ui/registry'
import { describe, expect, it } from 'vitest'
import type { AddIo } from '../src/commands/add.ts'
import add, { substitutePrefix } from '../src/commands/add.ts'
import { type RegistryFs, RegistryResolveError, resolveItems } from '../src/registry-resolve.ts'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BUTTON_SOURCE = `@state {
  import { AihuButton } from '@aihu/primitives/button'
  class AihuButtonRecipe extends AihuButton {}
  if (!customElements.get('aihu-button')) {
    customElements.define('aihu-button', AihuButtonRecipe)
  }
}
@template { <button class="aihu-button"><slot /></button> }
@style { .aihu-button { color: var(--color-primary); } }
`

const REGISTRY: Registry = {
  items: [
    {
      name: 'button',
      type: 'ui',
      description: 'Styled button.',
      files: [{ path: 'registry/button/button.aihu', type: 'component' }],
      dependencies: ['@aihu/primitives'],
      registryDependencies: [],
      variants: { variant: ['default'] },
    },
    {
      name: 'card',
      type: 'ui',
      files: [{ path: 'registry/card/card.aihu', type: 'component' }],
    },
  ],
}

const REGISTRY_ROOT = '/fake/node_modules/@aihu/ui'

/**
 * Build an in-memory `RegistryFs` over a seed map of absolute path → content.
 * `exists` is true for any seeded path AND any seeded ancestor marker (the
 * config file / registry.json). Writes go into the same map so collisions are
 * observable across an add → re-add sequence.
 */
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

/** Capture stdout/stderr + route writes into the fake fs. */
function makeIo(files: Record<string, string>): AddIo & { out: string; err: string } {
  const sink = { out: '', err: '' }
  const io: AddIo = {
    write(p: string, c: string) {
      files[p] = c
    },
    mkdirp() {
      /* no-op for the in-memory fs */
    },
    stdout(s: string) {
      sink.out += s
    },
    stderr(s: string) {
      sink.err += s
    },
  }
  return Object.defineProperties(io as AddIo & { out: string; err: string }, {
    out: { get: () => sink.out },
    err: { get: () => sink.err },
  })
}

/** A resolve-deps factory that injects a fixture config + registry-root + index. */
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
        if (!hasUi && ui === undefined) return null // no-config when both unset
        return hasUi ? { ui } : {}
      },
    },
    resolveRegistryRoot: () => registryRoot,
  }
}

/** Exit fake: throw a tagged error so tests assert the nonzero exit. */
function makeExit() {
  return (code: number): never => {
    throw new Error(`__exit__:${code}`)
  }
}

// ─── substitutePrefix unit ─────────────────────────────────────────────────────

describe('substitutePrefix', () => {
  it('rewrites tag names, define() string, and class selectors but NOT @aihu/ imports', () => {
    const out = substitutePrefix(BUTTON_SOURCE, 'aihu', 'acme')
    expect(out).toContain("customElements.define('acme-button'")
    expect(out).toContain("customElements.get('acme-button')")
    expect(out).toContain('class="acme-button"')
    expect(out).toContain('.acme-button {')
    // Import specifier is a package name — must be untouched.
    expect(out).toContain("from '@aihu/primitives/button'")
    expect(out).not.toContain('@acme/primitives')
  })

  it('is a no-op when from === to', () => {
    expect(substitutePrefix(BUTTON_SOURCE, 'aihu', 'aihu')).toBe(BUTTON_SOURCE)
  })
})

// ─── happy path + prefix + dry-run + diff + collision ─────────────────────────

describe('aihu add — happy path', () => {
  function setup(uiTarget = '/proj/src/components/ui') {
    const fs = makeFs({
      '/proj/aihu.config.ts': 'export default {}',
      [join(REGISTRY_ROOT, 'registry.json')]: JSON.stringify(REGISTRY),
      [join(REGISTRY_ROOT, 'registry/button/button.aihu')]: BUTTON_SOURCE,
    })
    const io = makeIo(fs.files)
    const resolve = makeResolveDeps({ fs, ui: { target: uiTarget } })
    return { fs, io, resolve }
  }

  // The destination stem IS the registered custom-element tag, so it must
  // carry the prefix: a copy landing at `button.aihu` compiles to
  // `customElements.define('button', …)`, which throws SyntaxError (no hyphen)
  // and collides with the built-in <button>. Default prefix is `aihu`.
  it('writes aihu-button.aihu into ui.target (prefixed: the stem is the tag)', async () => {
    const { fs, io, resolve } = setup()
    await add(['button'], { cwd: '/proj', fs, io, resolve, exit: makeExit() })
    const dest = '/proj/src/components/ui/aihu-button.aihu'
    expect(Object.hasOwn(fs.files, dest)).toBe(true)
    // The unregisterable bare name must NOT be written.
    expect(Object.hasOwn(fs.files, '/proj/src/components/ui/button.aihu')).toBe(false)
    expect(io.out).toContain('added 1 file(s).')
  })

  it('--prefix acme rewrites the tag AND the customElements.define call', async () => {
    const { fs, io, resolve } = setup()
    await add(['button', '--prefix', 'acme'], { cwd: '/proj', fs, io, resolve, exit: makeExit() })
    // Filename and contents agree — one name, one place.
    const written = fs.files['/proj/src/components/ui/acme-button.aihu'] as string
    expect(written).toContain("customElements.define('acme-button'")
    expect(written).toContain('class="acme-button"')
    expect(written).toContain('.acme-button {')
    expect(written).toContain("from '@aihu/primitives/button'")
  })

  it('--dry-run writes nothing but prints the plan', async () => {
    const { fs, io, resolve } = setup()
    await add(['button', '--dry-run'], { cwd: '/proj', fs, io, resolve, exit: makeExit() })
    expect(Object.hasOwn(fs.files, '/proj/src/components/ui/aihu-button.aihu')).toBe(false)
    expect(io.out).toContain('Plan (1 file(s)')
    expect(io.out).toContain('write')
  })

  it('--diff shows a diff against an existing target file', async () => {
    const { fs, io, resolve } = setup()
    // Seed an existing (differing) target at the PREFIXED destination.
    fs.files['/proj/src/components/ui/aihu-button.aihu'] = '@template { <button>old</button> }\n'
    await add(['button', '--diff'], { cwd: '/proj', fs, io, resolve, exit: makeExit() })
    expect(io.out).toContain('--- aihu-button.aihu (existing)')
    expect(io.out).toContain('+++ aihu-button.aihu (incoming)')
    // Nothing written by --diff.
    expect(fs.files['/proj/src/components/ui/aihu-button.aihu']).toBe(
      '@template { <button>old</button> }\n',
    )
  })

  it('collision aborts without --force and writes nothing', async () => {
    const { fs, io, resolve } = setup()
    fs.files['/proj/src/components/ui/aihu-button.aihu'] = 'OLD'
    await expect(
      add(['button'], { cwd: '/proj', fs, io, resolve, exit: makeExit() }),
    ).rejects.toThrow('__exit__:1')
    expect(io.err).toContain('already exist')
    expect(fs.files['/proj/src/components/ui/aihu-button.aihu']).toBe('OLD')
  })

  it('--force overwrites on collision', async () => {
    const { fs, io, resolve } = setup()
    fs.files['/proj/src/components/ui/aihu-button.aihu'] = 'OLD'
    await add(['button', '--force'], { cwd: '/proj', fs, io, resolve, exit: makeExit() })
    expect(fs.files['/proj/src/components/ui/aihu-button.aihu']).not.toBe('OLD')
    expect(io.out).toContain('added 1 file(s).')
  })

  it('records the primitives map (D-4) on success', async () => {
    const { fs, io, resolve } = setup()
    let recorded: Record<string, string | null> | undefined
    await add(['button'], {
      cwd: '/proj',
      fs,
      io,
      resolve,
      exit: makeExit(),
      recordPrimitives: (v) => {
        recorded = v
      },
    })
    expect(recorded).toEqual({ button: '@aihu/primitives' })
  })
})

// ─── transitive resolution + cycle guard (R8) ─────────────────────────────────

describe('resolveItems — transitive deps + cycle guard (R8)', () => {
  const synthetic: Registry = {
    items: [
      {
        name: 'recipe-A',
        type: 'ui',
        files: [{ path: 'registry/recipe-A/recipe-A.aihu', type: 'component' }],
        registryDependencies: ['recipe-B'],
      },
      {
        name: 'recipe-B',
        type: 'ui',
        files: [{ path: 'registry/recipe-B/recipe-B.aihu', type: 'component' }],
        registryDependencies: [],
      },
    ],
  }

  it('pulls recipe-B transitively when adding recipe-A', () => {
    const items = resolveItems(['recipe-A'], synthetic)
    const names = items.map((i) => i.name)
    expect(names).toContain('recipe-A')
    expect(names).toContain('recipe-B')
    // Dependency ordered before its dependent.
    expect(names.indexOf('recipe-B')).toBeLessThan(names.indexOf('recipe-A'))
  })

  it('terminates on a cycle (A→B→A) without infinite recursion', () => {
    const cyclic: Registry = {
      items: [
        {
          name: 'recipe-A',
          type: 'ui',
          files: [{ path: 'a.aihu', type: 'component' }],
          registryDependencies: ['recipe-B'],
        },
        {
          name: 'recipe-B',
          type: 'ui',
          files: [{ path: 'b.aihu', type: 'component' }],
          registryDependencies: ['recipe-A'],
        },
      ],
    }
    const items = resolveItems(['recipe-A'], cyclic)
    expect(items.map((i) => i.name).sort()).toEqual(['recipe-A', 'recipe-B'])
  })

  it('throws unknown-recipe when a transitive dependency is missing', () => {
    const broken: Registry = {
      items: [
        {
          name: 'recipe-A',
          type: 'ui',
          files: [{ path: 'a.aihu', type: 'component' }],
          registryDependencies: ['nope'],
        },
      ],
    }
    expect(() => resolveItems(['recipe-A'], broken)).toThrow(RegistryResolveError)
  })
})

// ─── error paths (R6) ──────────────────────────────────────────────────────────

describe('aihu add — error paths (R6)', () => {
  it('no aihu.config.ts → exits nonzero with actionable message', async () => {
    const fs = makeFs({})
    const io = makeIo(fs.files)
    const resolve = makeResolveDeps({ fs, hasUi: false }) // load() returns null
    await expect(
      add(['button'], { cwd: '/proj', fs, io, resolve, exit: makeExit() }),
    ).rejects.toThrow('__exit__:1')
    expect(io.err).toContain('No aihu.config.ts found')
  })

  it('@aihu/ui not installed → exits nonzero with `bun add -D`', async () => {
    const fs = makeFs({ '/proj/aihu.config.ts': 'export default {}' })
    const io = makeIo(fs.files)
    const resolve = makeResolveDeps({ fs, ui: {}, registryRoot: null })
    await expect(
      add(['button'], { cwd: '/proj', fs, io, resolve, exit: makeExit() }),
    ).rejects.toThrow('__exit__:1')
    expect(io.err).toContain('is not installed')
    expect(io.err).toContain('bun add -D @aihu/ui')
  })

  it('config present but no `ui` field → exits nonzero', async () => {
    const fs = makeFs({ '/proj/aihu.config.ts': 'export default {}' })
    const io = makeIo(fs.files)
    const resolve = makeResolveDeps({ fs, hasUi: true, ui: undefined }) // load() → {}
    await expect(
      add(['button'], { cwd: '/proj', fs, io, resolve, exit: makeExit() }),
    ).rejects.toThrow('__exit__:1')
    expect(io.err).toContain('no `ui` field')
  })

  it('unknown recipe name → exits nonzero with `aihu list` hint', async () => {
    const fs = makeFs({
      '/proj/aihu.config.ts': 'export default {}',
      [join(REGISTRY_ROOT, 'registry.json')]: JSON.stringify(REGISTRY),
    })
    const io = makeIo(fs.files)
    const resolve = makeResolveDeps({ fs, ui: {} })
    await expect(
      add(['nonexistent'], { cwd: '/proj', fs, io, resolve, exit: makeExit() }),
    ).rejects.toThrow('__exit__:1')
    expect(io.err).toContain('unknown recipe')
    expect(io.err).toContain('aihu list')
  })

  it('no names → usage + nonzero exit', async () => {
    const fs = makeFs({})
    const io = makeIo(fs.files)
    await expect(add([], { cwd: '/proj', fs, io, exit: makeExit() })).rejects.toThrow('__exit__:1')
    expect(io.err).toContain('Usage:')
  })
})

// ─── real-temp-dir acceptance: <acme-button> written to disk (§12.4) ──────────

describe('aihu add — disk acceptance (§12.4)', () => {
  it('writes a working <acme-button> recipe to a real target dir', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aihu-add-'))
    const registryRoot = join(root, 'node_modules', '@aihu', 'ui')
    const targetDir = join(root, 'src', 'components', 'ui')

    // Seed a real config + a real installed registry on disk. The resolver's
    // config loader + registry-root locator are injected to point at this temp
    // layout (avoids importing a TS config through Vite in a temp dir).
    const fs: RegistryFs = {
      exists: (p) => existsSync(p),
      read: (p) => readFileSync(p, 'utf8'),
    }
    // Materialize the registry + recipe on disk.
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(registryRoot, 'registry', 'button'), { recursive: true })
    writeFileSync(join(root, 'aihu.config.ts'), 'export default {}')
    writeFileSync(join(registryRoot, 'registry.json'), JSON.stringify(REGISTRY))
    writeFileSync(join(registryRoot, 'registry', 'button', 'button.aihu'), BUTTON_SOURCE)

    await add(['button', '--prefix', 'acme'], {
      cwd: root,
      fs,
      resolve: {
        fs,
        configLoader: {
          async load() {
            return { ui: { target: './src/components/ui' } }
          },
        },
        resolveRegistryRoot: () => registryRoot,
      },
      io: {
        write: (p, c) => writeFileSync(p, c, 'utf8'),
        mkdirp: (p) => mkdirSync(p, { recursive: true }),
        stdout: () => {},
        stderr: () => {},
      },
    })

    // Destination stem carries the prefix, so the compiled recipe registers
    // <acme-button> — the same tag its own source defines. A file at
    // `button.aihu` would instead emit `defineElement('button', …)`: a
    // SyntaxError, and a clash with the built-in <button>.
    const written = readFileSync(join(targetDir, 'acme-button.aihu'), 'utf8')
    expect(existsSync(join(targetDir, 'button.aihu'))).toBe(false)
    expect(written).toContain("customElements.define('acme-button'")
    expect(written).toContain('class="acme-button"')
    expect(written).toContain('.acme-button {')
    // @style still references the semantic token (compiles clean downstream).
    expect(written).toContain('var(--color-primary)')
  })
})
