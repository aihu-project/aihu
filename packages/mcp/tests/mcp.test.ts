/**
 * Tests for @aihu/mcp package.
 *
 * Covers:
 * - Cookbook index loading
 * - Intent keyword matching (exact tag, partial match, no match)
 * - compileSource happy path (mocked binary)
 * - compileSource error path with valid JSON stderr
 * - compileSource fallback for non-JSON stderr
 * - compileSource timeout handling
 * - errors/warnings split from severity field
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  _resetIndex,
  _setIndex,
  type CookbookEntry,
  findBestMatch,
  getAllTags,
  getEntrySource,
} from '../src/cookbook.js'
import { handleExample } from '../src/tools/example.js'

// ───────────────────────────────────────────────
// Test fixtures
// ───────────────────────────────────────────────

const FIXTURE_ENTRIES: CookbookEntry[] = [
  {
    filename: 'counter.aihu',
    description: 'Minimal counter with signal and increment action',
    tags: ['signal', 'action', 'counter', 'minimal', '7guis', 'increment'],
    source:
      '@state { count: number = 0\n$action: { increment: () => { count++ } } }\n@template { <p>{count}</p><button on:click={increment}>+</button> }',
  },
  {
    filename: 'each-list.aihu',
    description: 'Todo list with each loop and keyed items',
    tags: ['each', 'list', 'todo', 'key', 'array', 'crud'],
    source:
      '@state { items: Array<{id: string; text: string}> = [] }\n@template { <ul><group each={item of items} key={item.id}><li>{item.text}</li></group></ul> }',
  },
  {
    filename: 'lifecycle.aihu',
    description: 'Lifecycle hooks with mount and dispose for cleanup',
    tags: ['lifecycle', 'mount', 'dispose', 'cleanup', '$lifecycle'],
    source:
      '@state { $lifecycle: { mount: () => { }, dispose: () => { } } }\n@template { <div>mounted</div> }',
  },
]

// ───────────────────────────────────────────────
// Cookbook index loading tests
// ───────────────────────────────────────────────

describe('cookbook index', () => {
  beforeEach(() => {
    _resetIndex()
    _setIndex(FIXTURE_ENTRIES)
  })

  afterEach(() => {
    _resetIndex()
  })

  it('loads entries from the test fixture', () => {
    const tags = getAllTags()
    expect(tags).toContain('signal')
    expect(tags).toContain('each')
    expect(tags).toContain('lifecycle')
  })

  it('returns sorted unique tags', () => {
    const tags = getAllTags()
    const sorted = [...tags].sort()
    expect(tags).toEqual(sorted)
  })

  it('provides entry source via getEntrySource', () => {
    const entry = FIXTURE_ENTRIES[0]!
    const source = getEntrySource(entry)
    expect(source).toBe(entry.source)
    expect(source).toContain('@state')
  })
})

// ───────────────────────────────────────────────
// Intent keyword matching tests
// ───────────────────────────────────────────────

describe('findBestMatch', () => {
  beforeEach(() => {
    _resetIndex()
    _setIndex(FIXTURE_ENTRIES)
  })

  afterEach(() => {
    _resetIndex()
  })

  it('exact tag match — counter with signal', () => {
    const result = findBestMatch('counter with signal')
    expect(result).not.toBeNull()
    expect(result!.entry.filename).toBe('counter.aihu')
    expect(result!.score).toBeGreaterThan(0)
  })

  it('partial match — finds lifecycle for mount pattern', () => {
    const result = findBestMatch('component with mount and dispose')
    expect(result).not.toBeNull()
    expect(result!.entry.filename).toBe('lifecycle.aihu')
  })

  it('no match — returns null for completely unrelated intent', () => {
    const result = findBestMatch('xyzzy irrelevant nonsense')
    expect(result).toBeNull()
  })

  it('tag array parameter narrows search', () => {
    const result = findBestMatch('component', ['each', 'todo'])
    expect(result).not.toBeNull()
    expect(result!.entry.filename).toBe('each-list.aihu')
  })

  it('prefers higher-scoring entry when multiple match', () => {
    const result = findBestMatch('counter signal action increment')
    expect(result).not.toBeNull()
    expect(result!.entry.filename).toBe('counter.aihu')
  })

  it('returns null when index is empty', () => {
    _setIndex([])
    const result = findBestMatch('counter with signal')
    expect(result).toBeNull()
  })
})

// ───────────────────────────────────────────────
// handleExample tool tests
// ───────────────────────────────────────────────

describe('handleExample', () => {
  beforeEach(() => {
    _resetIndex()
    _setIndex(FIXTURE_ENTRIES)
  })

  afterEach(() => {
    _resetIndex()
  })

  it('returns source, filename, description on match', () => {
    const result = handleExample({ intent: 'counter with signal' })
    expect('isError' in result).toBe(false)
    const r = result as { source: string; filename: string; description: string; tags: string[] }
    expect(r.filename).toMatch(/\.aihu$/)
    expect(r.source.length).toBeGreaterThan(0)
    expect(r.description.length).toBeGreaterThan(0)
    expect(Array.isArray(r.tags)).toBe(true)
  })

  it('source contains @state or @template on match', () => {
    const result = handleExample({ intent: 'counter with signal' })
    const r = result as { source: string }
    expect(r.source).toMatch(/@state|@template/)
  })

  it('returns error with "No cookbook example matched" on no match', () => {
    const result = handleExample({ intent: 'xyzzy irrelevant nonsense' })
    expect('isError' in result).toBe(true)
    const r = result as { isError: true; message: string }
    expect(r.message).toContain('No cookbook example matched')
    expect(r.message).toContain('xyzzy irrelevant nonsense')
  })

  it('error message includes available tags', () => {
    const result = handleExample({ intent: 'xyzzy irrelevant nonsense' })
    const r = result as { isError: true; message: string }
    expect(r.message).toContain('Available tags:')
  })
})

// ───────────────────────────────────────────────
// compileSource tests (dependency-injection harness)
// ───────────────────────────────────────────────

type ExecFn = (
  bin: string,
  args: string[],
  opts: { input: string; encoding: string; timeout: number },
) => string

function makeCompileSource(execFn: ExecFn) {
  const { basename } = {
    basename: (p: string, ext: string) => (p.endsWith(ext) ? p.slice(0, -ext.length) : p),
  }

  return function compileSource(
    source: string,
    filename = 'component.aihu',
  ): {
    ok: boolean
    errors: { code: string; message: string; line: number; col: number }[]
    warnings: { code: string; message: string; line: number; col: number }[]
    output?: string
  } {
    const stem = basename(filename, '.aihu')
    try {
      const stdout = execFn(
        'aihu-compile',
        ['--stdin', '--tag', stem, '--path', filename, '--machine-errors'],
        { input: source, encoding: 'utf8', timeout: 10000 },
      )
      return { ok: true, errors: [], warnings: [], output: stdout }
    } catch (err: unknown) {
      const e = err as { stderr?: string | Buffer; killed?: boolean; signal?: string }

      if (e.killed === true || (typeof e.signal === 'string' && e.signal !== null)) {
        return {
          ok: false,
          errors: [
            { code: 'TIMEOUT', message: 'Compiler timed out after 10000ms', line: 0, col: 0 },
          ],
          warnings: [],
        }
      }

      const rawStderr = e.stderr
      const stderr =
        rawStderr instanceof Buffer
          ? rawStderr.toString('utf-8')
          : typeof rawStderr === 'string'
            ? rawStderr
            : ''

      try {
        const parsed: unknown = JSON.parse(stderr)
        if (Array.isArray(parsed)) {
          const normalize = (d: unknown) => {
            const r = d as Record<string, unknown>
            return {
              code: String(r.code ?? 'UNKNOWN'),
              message: String(r.message ?? ''),
              line: Number(r.line ?? 0),
              col: Number(r.col ?? 0),
            }
          }
          return {
            ok: false,
            errors: parsed
              .filter((d) => (d as Record<string, unknown>).severity !== 'warning')
              .map(normalize),
            warnings: parsed
              .filter((d) => (d as Record<string, unknown>).severity === 'warning')
              .map(normalize),
          }
        }
      } catch {
        // not JSON
      }

      return {
        ok: false,
        errors: [
          {
            code: 'UNKNOWN',
            message: stderr.trim() || 'Compilation failed (no stderr)',
            line: 0,
            col: 0,
          },
        ],
        warnings: [],
      }
    }
  }
}

describe('compileSource (injectable exec)', () => {
  it('happy path — returns ok: true with compiled code', () => {
    const compiledCode = `import { defineComponent, defineElement } from '@aihu/runtime'\ndefineElement('my-widget', defineComponent((_ctx) => { return null }))`

    const compileSource = makeCompileSource((_bin, _args, _opts) => compiledCode)

    const result = compileSource(
      '@state { count: number = 0 }\n@template { <p>{count}</p> }',
      'my-widget.aihu',
    )

    expect(result.ok).toBe(true)
    expect(result.output).toContain('defineElement')
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('happy path — filename stem is passed as --tag arg', () => {
    let capturedArgs: string[] = []
    const compileSource = makeCompileSource((_bin, args, _opts) => {
      capturedArgs = args
      return 'compiled'
    })

    compileSource('@state { }\n@template { <p>hello</p> }', 'my-widget.aihu')

    const tagIdx = capturedArgs.indexOf('--tag')
    expect(tagIdx).toBeGreaterThan(-1)
    expect(capturedArgs[tagIdx + 1]).toBe('my-widget')
  })

  it('error path — valid JSON stderr returns structured diagnostics', () => {
    const diagnostics = [
      { code: 'C440', message: 'C440 — old-spec macro form rejected', line: 4, col: 2 },
    ]

    const compileSource = makeCompileSource((_bin, _args, _opts) => {
      throw Object.assign(new Error('compilation failed'), {
        stderr: JSON.stringify(diagnostics),
        code: 1,
      })
    })

    const result = compileSource(
      '$prop label: String\n@template { <p>{label}</p> }',
      'component.aihu',
    )

    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]!.code).toMatch(/^C4/)
  })

  it('warnings split — severity=warning goes to warnings, not errors', () => {
    const diagnostics = [
      { code: 'W001', message: 'unused import', severity: 'warning', line: 1, col: 0 },
      { code: 'C440', message: 'parse error', line: 4, col: 2 },
    ]

    const compileSource = makeCompileSource((_bin, _args, _opts) => {
      throw Object.assign(new Error('compilation failed'), {
        stderr: JSON.stringify(diagnostics),
        code: 1,
      })
    })

    const result = compileSource('@template { <p>x</p> }', 'component.aihu')

    expect(result.ok).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.code).toBe('C440')
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]!.code).toBe('W001')
  })

  it('fallback — non-JSON stderr returns UNKNOWN diagnostic', () => {
    const compileSource = makeCompileSource((_bin, _args, _opts) => {
      throw Object.assign(new Error('compilation failed'), {
        stderr: 'something went wrong (not JSON)',
        code: 1,
      })
    })

    const result = compileSource('not valid aihu at all @@@@', 'component.aihu')

    expect(result.ok).toBe(false)
    expect(result.errors[0]!.code).toBe('UNKNOWN')
  })

  it('does not crash when stderr is empty', () => {
    const compileSource = makeCompileSource((_bin, _args, _opts) => {
      throw Object.assign(new Error('compilation failed'), { stderr: '', code: 1 })
    })

    const result = compileSource('@@@@###$$$', 'component.aihu')
    expect(result.ok).toBe(false)
    expect(result.errors[0]!.code).toBe('UNKNOWN')
    expect(result.errors[0]!.message).toContain('no stderr')
  })

  it('timeout — returns TIMEOUT diagnostic when process is killed', () => {
    const compileSource = makeCompileSource((_bin, _args, _opts) => {
      throw Object.assign(new Error('timeout'), { killed: true, signal: 'SIGTERM', stderr: '' })
    })

    const result = compileSource(
      '@state { count: number = 0 }\n@template { <p>{count}</p> }',
      'component.aihu',
    )

    expect(result.ok).toBe(false)
    expect(result.errors[0]!.code).toBe('TIMEOUT')
  })
})
