/**
 * Dispatcher wiring smoke for `aihu add` / `aihu list` (Plan 5 Task 9 Step 3).
 *
 * Two layers of proof:
 *   1. Source-grep on `bin.ts` — the async-import dispatch blocks + usage text
 *      exist (mirrors the bug-9c `migrate` dispatcher checks in cli.test.ts).
 *   2. Behavioral smoke — calling the `add` / `list` command entries the
 *      dispatcher reaches (`add(rest)` / `list(rest)`) with in-memory fixtures
 *      completes without hitting the nonzero-exit path: `aihu add --dry-run
 *      button` reaches add.ts (exit 0) and `aihu list` reaches list.ts.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Registry } from '@aihu/ui/registry'
import { describe, expect, it } from 'vitest'
import type { AddIo } from '../src/commands/add.ts'
import add from '../src/commands/add.ts'
import type { ListIo } from '../src/commands/list.ts'
import list from '../src/commands/list.ts'
import type { RegistryFs } from '../src/registry-resolve.ts'
import { usageText } from '../src/usage.ts'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const REGISTRY_ROOT = '/fake/node_modules/@aihu/ui'
const BUTTON_SOURCE = `@template { <button class="aihu-button"><slot /></button> }
@style { .aihu-button { color: var(--color-primary); } }
`

const REGISTRY: Registry = {
  items: [
    {
      name: 'button',
      type: 'ui',
      description: 'Styled button.',
      files: [{ path: 'registry/button/button.aihu', type: 'component' }],
    },
  ],
}

function makeFs(seed: Record<string, string>): RegistryFs {
  const files = { ...seed }
  return {
    exists: (p) => Object.hasOwn(files, p),
    read: (p) => {
      if (!Object.hasOwn(files, p)) throw new Error(`ENOENT (fake): ${p}`)
      return files[p] as string
    },
  }
}

function makeResolveDeps(fs: RegistryFs) {
  return {
    fs,
    configLoader: {
      async load() {
        return { ui: { target: '/proj/src/components/ui' } }
      },
    },
    resolveRegistryRoot: () => REGISTRY_ROOT,
  }
}

/** Exit fake: throw so the test fails loudly if a command takes the exit path. */
function makeExit() {
  return (code: number): never => {
    throw new Error(`__exit__:${code}`)
  }
}

function setup() {
  const fs = makeFs({
    '/proj/aihu.config.ts': 'export default {}',
    [join(REGISTRY_ROOT, 'registry.json')]: JSON.stringify(REGISTRY),
    [join(REGISTRY_ROOT, 'registry/button/button.aihu')]: BUTTON_SOURCE,
  })
  return { fs, resolve: makeResolveDeps(fs) }
}

// ─── Layer 1: bin.ts source-grep wiring ───────────────────────────────────────

describe('bin.ts dispatcher — add/list wiring', () => {
  function binSource(): string {
    return readFileSync(join(__dirname, '..', 'src', 'bin.ts'), 'utf8')
  }

  it('registers the add subcommand and async-imports add.js', () => {
    const src = binSource()
    expect(src).toContain("if (cmd === 'add')")
    expect(src).toContain("await import('./commands/add.js')")
    expect(src).toContain('await add(rest)')
  })

  it('registers the list subcommand and async-imports list.js', () => {
    const src = binSource()
    expect(src).toContain("if (cmd === 'list')")
    expect(src).toContain("await import('./commands/list.js')")
    expect(src).toContain('await list(rest)')
  })

  it('documents add + list (with flags) in the top-level usage text', () => {
    // Reads the RENDERED help rather than grepping bin.ts source: the text
    // moved to `usage.ts` (so tests can import it without bin.ts's top-level
    // `main()` running), and asserting on rendered output means a reformat
    // cannot break the test while a genuine omission still does. `--style` is
    // in this list because it is a real `aihu add` flag that the old help text
    // did not mention at all.
    const text = usageText()
    expect(text).toContain('add <names...>')
    expect(text).toContain('list [--installed]')
    for (const flag of ['--prefix', '--style', '--dry-run', '--diff', '--force']) {
      expect(text, flag).toContain(flag)
    }
  })

  it('does NOT wire a rename subcommand (R1 — deferred to Plan 6)', () => {
    expect(binSource()).not.toContain("if (cmd === 'rename')")
  })
})

// ─── Layer 2: behavioral smoke — the dispatched entries reach + exit 0 ─────────

describe('dispatched command entries', () => {
  it('`aihu add --dry-run button` reaches add.ts and returns (exit 0)', async () => {
    const { fs, resolve } = setup()
    let out = ''
    const io: AddIo = {
      write() {},
      mkdirp() {},
      stdout: (s) => {
        out += s
      },
      stderr: () => {},
    }
    await expect(
      add(['button', '--dry-run'], { cwd: '/proj', fs, io, resolve, exit: makeExit() }),
    ).resolves.toBeUndefined()
    expect(out).toContain('Plan (1 file(s)')
  })

  it('`aihu list` reaches list.ts and returns (exit 0)', async () => {
    const { fs, resolve } = setup()
    let out = ''
    const io: ListIo = {
      listDir: () => [],
      stdout: (s) => {
        out += s
      },
      stderr: () => {},
    }
    await expect(
      list([], { cwd: '/proj', fs, io, resolve, exit: makeExit() }),
    ).resolves.toBeUndefined()
    expect(out).toContain('button')
  })
})
