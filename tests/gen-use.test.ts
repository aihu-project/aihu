/**
 * Fixtures for `scripts/gen-use.ts`'s pure patch functions — family-aware
 * scaffolding (namespace-wave0). Synthesized data only (established pattern
 * in this repo — see check-use-registry-parity.test.ts / check-size-rows
 * fixtures): these functions operate on strings/objects, not the live repo
 * tree, so a fixture stays valid regardless of what lands in packages/use
 * next.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  exportKeyRank,
  type FamilyDef,
  parseGenUseArgs,
  patchFamilyBarrel,
  patchPackageExports,
  patchRolldownEntry,
  patchSizeLimit,
  patchUseRegistryRs,
  peersFor,
  scaffoldBatch,
  validateFamily,
} from '../scripts/gen-use.ts'

describe('parseGenUseArgs', () => {
  it('preserves every composable name in a multi-name invocation', () => {
    expect(parseGenUseArgs(['useFirst', 'useSecond'])).toEqual({
      names: ['useFirst', 'useSecond'],
      bare: false,
      family: undefined,
    })
  })

  it('preserves the first name when family and bare flags follow the batch', () => {
    expect(parseGenUseArgs(['useFirst', 'useSecond', '--bare', '--family', 'math'])).toEqual({
      names: ['useFirst', 'useSecond'],
      bare: true,
      family: 'math',
    })
  })
})

describe('scaffoldBatch', () => {
  it('creates every named composable and all corresponding package registrations', () => {
    const root = mkdtempSync(join(tmpdir(), 'gen-use-batch-'))
    try {
      const useDir = join(root, 'packages/use')
      const srcDir = join(useDir, 'src')
      const config = join(useDir, 'rolldown.config.ts')
      const packageJson = join(useDir, 'package.json')
      const sizeLimit = join(root, '.size-limit.json')
      const write = (path: string, content: string) => {
        mkdirSync(join(path, '..'), { recursive: true })
        writeFileSync(path, content)
      }
      write(join(srcDir, 'index.ts'), 'export {}\n')
      write(
        config,
        "input: {\n    index: 'src/index.ts',\n    shared: 'src/shared/index.ts',\n  },\n",
      )
      write(packageJson, JSON.stringify({ exports: { '.': {}, './shared': {} } }))
      write(
        sizeLimit,
        '[\n  {\n    "name": "@aihu/use/shared",\n    "path": "packages/use/dist/shared.js",\n    "limit": "320 B",\n    "gzip": true\n  },\n]\n',
      )

      scaffoldBatch(root, ['useFirst', 'useSecond'], false, undefined, {})

      expect(readFileSync(join(srcDir, 'useFirst/index.ts'), 'utf8')).toContain('useFirst')
      expect(readFileSync(join(srcDir, 'useSecond/index.ts'), 'utf8')).toContain('useSecond')
      const pkg = JSON.parse(readFileSync(packageJson, 'utf8'))
      expect(pkg.exports).toHaveProperty('./useFirst')
      expect(pkg.exports).toHaveProperty('./useSecond')
      expect(readFileSync(config, 'utf8')).toContain("useFirst: 'src/useFirst/index.ts'")
      expect(readFileSync(config, 'utf8')).toContain("useSecond: 'src/useSecond/index.ts'")
      expect(readFileSync(sizeLimit, 'utf8')).toContain('"name": "@aihu/use/useFirst"')
      expect(readFileSync(sizeLimit, 'utf8')).toContain('"name": "@aihu/use/useSecond"')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

const FAMILIES: Record<string, FamilyDef> = {
  math: {
    aggregate: true,
    autoImport: true,
    memberLimit: '250 B',
    aggregateLimit: '1200 B',
    peers: {},
  },
  motion: {
    aggregate: true,
    autoImport: true,
    memberLimit: '900 B',
    aggregateLimit: '3 KB',
    peers: {},
  },
  router: {
    aggregate: true,
    autoImport: false,
    memberLimit: '500 B',
    aggregateLimit: '1500 B',
    peers: { '*': ['@aihu/router'] },
  },
  integrations: {
    aggregate: false,
    autoImport: false,
    memberLimit: '600 B',
    peers: { useJwt: ['jwt-decode'], useAxios: ['axios'] },
  },
}

describe('validateFamily', () => {
  it('accepts a declared family', () => {
    expect(() => validateFamily('math', FAMILIES)).not.toThrow()
  })

  it('accepts undefined (CORE, no --family flag)', () => {
    expect(() => validateFamily(undefined, FAMILIES)).not.toThrow()
  })

  it('throws, listing known families, for an undeclared family', () => {
    expect(() => validateFamily('bogus', FAMILIES)).toThrow(/families\.json/)
    try {
      validateFamily('bogus', FAMILIES)
    } catch (e) {
      expect((e as Error).message).toContain('integrations')
      expect((e as Error).message).toContain('math')
    }
  })
})

describe('peersFor', () => {
  it('returns [] for a CORE composable (no family)', () => {
    expect(peersFor(undefined, 'useCounter', FAMILIES)).toEqual([])
  })

  it('returns [] for a dep-free family (math)', () => {
    expect(peersFor('math', 'useClamp', FAMILIES)).toEqual([])
  })

  it('applies the family-wide "*" peer (router)', () => {
    expect(peersFor('router', 'useRouteParams', FAMILIES)).toEqual(['@aihu/router'])
  })

  it('applies the member-specific peer (integrations)', () => {
    expect(peersFor('integrations', 'useJwt', FAMILIES)).toEqual(['jwt-decode'])
    expect(peersFor('integrations', 'useAxios', FAMILIES)).toEqual(['axios'])
  })
})

describe('exportKeyRank', () => {
  it('ranks CORE keys before family keys', () => {
    const core = exportKeyRank('./useCounter', FAMILIES)
    const fam = exportKeyRank('./math', FAMILIES)
    expect(core[0]).toBeLessThan(fam[0])
  })

  it('ranks a family aggregate before its own members', () => {
    const agg = exportKeyRank('./math', FAMILIES)
    const member = exportKeyRank('./math/useClamp', FAMILIES)
    expect(agg[2]).toBeLessThan(member[2])
    expect(agg[1]).toBe(member[1])
  })

  it('groups two different families by family name', () => {
    const mathMember = exportKeyRank('./math/useClamp', FAMILIES)
    const motionMember = exportKeyRank('./motion/useSpring', FAMILIES)
    expect(mathMember[1]).toBe('math')
    expect(motionMember[1]).toBe('motion')
  })
})

describe('patchPackageExports', () => {
  it('adds a CORE key at the existing sort position (unchanged behavior)', () => {
    const pkg = {
      exports: {
        '.': { types: 'x', import: 'y' },
        './shared': { types: 'x', import: 'y' },
        './useCounter': { types: 'x', import: 'y' },
        './useToggle': { types: 'x', import: 'y' },
      },
    }
    const result = patchPackageExports(pkg, 'useMap', undefined, FAMILIES)
    expect(result).toEqual({ memberAdded: true, aggregateAdded: false })
    expect(Object.keys(pkg.exports)).toEqual([
      '.',
      './shared',
      './useCounter',
      './useMap',
      './useToggle',
    ])
  })

  it('adds a family member AND its aggregate together on first landing', () => {
    const pkg = {
      exports: {
        '.': { types: 'x', import: 'y' },
        './shared': { types: 'x', import: 'y' },
        './useCounter': { types: 'x', import: 'y' },
      },
    }
    const result = patchPackageExports(pkg, 'useClamp', 'math', FAMILIES)
    expect(result).toEqual({ memberAdded: true, aggregateAdded: true })
    expect(Object.keys(pkg.exports)).toEqual([
      '.',
      './shared',
      './useCounter',
      './math',
      './math/useClamp',
    ])
  })

  it('does NOT add an aggregate for an aggregate:false family (integrations)', () => {
    const pkg = { exports: { '.': {}, './shared': {} } }
    const result = patchPackageExports(pkg, 'useJwt', 'integrations', FAMILIES)
    expect(result).toEqual({ memberAdded: true, aggregateAdded: false })
    expect(Object.keys(pkg.exports)).toEqual(['.', './shared', './integrations/useJwt'])
    expect(Object.hasOwn(pkg.exports, './integrations')).toBe(false)
  })

  it('groups family keys together and keeps aggregate before members across two families', () => {
    const pkg = {
      exports: {
        '.': {},
        './shared': {},
        './useCounter': {},
      },
    }
    patchPackageExports(pkg, 'useClamp', 'math', FAMILIES)
    patchPackageExports(pkg, 'useSpring', 'motion', FAMILIES)
    patchPackageExports(pkg, 'useSum', 'math', FAMILIES)
    expect(Object.keys(pkg.exports)).toEqual([
      '.',
      './shared',
      './useCounter',
      './math',
      './math/useClamp',
      './math/useSum',
      './motion',
      './motion/useSpring',
    ])
  })

  it('is idempotent — running twice does not duplicate or re-add', () => {
    const pkg = { exports: { '.': {}, './shared': {} } }
    patchPackageExports(pkg, 'useClamp', 'math', FAMILIES)
    const before = JSON.stringify(pkg.exports)
    const result = patchPackageExports(pkg, 'useClamp', 'math', FAMILIES)
    expect(result).toEqual({ memberAdded: false, aggregateAdded: false })
    expect(JSON.stringify(pkg.exports)).toBe(before)
  })
})

describe('patchRolldownEntry', () => {
  const CORE_SRC = [
    'export default defineConfig({',
    '  input: {',
    "    index: 'src/index.ts',",
    "    shared: 'src/shared/index.ts',",
    "    useCounter: 'src/useCounter/index.ts',",
    "    useToggle: 'src/useToggle/index.ts',",
    '  },',
    '})',
  ].join('\n')

  it('inserts a CORE entry alphabetically', () => {
    const result = patchRolldownEntry(CORE_SRC, 'useMap', 'src/useMap/index.ts', false)
    expect(result.changed).toBe(true)
    expect(result.text).toContain("useMap: 'src/useMap/index.ts',")
    const lines = result.text.split('\n')
    expect(lines.findIndex((l) => l.includes('useCounter'))).toBeLessThan(
      lines.findIndex((l) => l.includes('useMap')),
    )
    expect(lines.findIndex((l) => l.includes('useMap'))).toBeLessThan(
      lines.findIndex((l) => l.includes('useToggle')),
    )
  })

  it('is idempotent for CORE entries', () => {
    const result = patchRolldownEntry(CORE_SRC, 'useCounter', 'src/useCounter/index.ts', false)
    expect(result.changed).toBe(false)
    expect(result.text).toBe(CORE_SRC)
  })

  it('inserts a family aggregate as a quoted-or-bare key, then members after it, alphabetically', () => {
    let src = CORE_SRC
    src = patchRolldownEntry(src, 'math', 'src/math/index.ts', true).text
    src = patchRolldownEntry(src, 'math/useSum', 'src/math/useSum/index.ts', true).text
    src = patchRolldownEntry(src, 'math/useClamp', 'src/math/useClamp/index.ts', true).text

    expect(src).toContain("math: 'src/math/index.ts',")
    expect(src).toContain("'math/useClamp': 'src/math/useClamp/index.ts',")
    expect(src).toContain("'math/useSum': 'src/math/useSum/index.ts',")

    const lines = src.split('\n')
    const idx = (needle: string) => lines.findIndex((l) => l.includes(needle))
    expect(idx('math:')).toBeLessThan(idx("'math/useClamp'"))
    expect(idx("'math/useClamp'")).toBeLessThan(idx("'math/useSum'"))
    // Family entries land after every CORE entry.
    expect(idx('useToggle')).toBeLessThan(idx('math:'))
  })

  it('is idempotent for a quoted family/member key', () => {
    const withMember = patchRolldownEntry(
      CORE_SRC,
      'math/useClamp',
      'src/math/useClamp/index.ts',
      true,
    )
    const again = patchRolldownEntry(
      withMember.text,
      'math/useClamp',
      'src/math/useClamp/index.ts',
      true,
    )
    expect(again.changed).toBe(false)
    expect(again.text).toBe(withMember.text)
  })
})

describe('patchSizeLimit', () => {
  const SIZE_LIMIT_SRC = [
    '[',
    '  {',
    '    "name": "@aihu/signals",',
    '    "path": "packages/signals/dist/index.js",',
    '    "limit": "2350 B",',
    '    "gzip": true',
    '  },',
    '  {',
    '    "name": "@aihu/use/shared",',
    '    "path": "packages/use/dist/shared.js",',
    '    "limit": "320 B",',
    '    "gzip": true,',
    '    "ignore": ["@aihu/signals"]',
    '  },',
    '  {',
    '    "name": "@aihu/use/watch",',
    '    "path": "packages/use/dist/watch.js",',
    '    "limit": "370 B",',
    '    "gzip": true,',
    '    "ignore": ["@aihu/signals"]',
    '  },',
    '  {',
    '    "name": "@aihu/auth",',
    '    "path": "packages/auth/dist/index.js",',
    '    "limit": "1.5 KB",',
    '    "gzip": true',
    '  }',
    ']',
  ].join('\n')

  it('anchors after the LAST @aihu/use/* row, even a nested family row', () => {
    const withNested = patchSizeLimit(
      SIZE_LIMIT_SRC,
      '@aihu/use/math/useClamp',
      'packages/use/dist/math/useClamp.js',
      '250 B',
      ['@aihu/signals'],
    )
    expect(withNested.changed).toBe(true)
    // Inserted right after 'watch' row, BEFORE @aihu/auth.
    const idx = (needle: string) => withNested.text.split('\n').findIndex((l) => l.includes(needle))
    expect(idx('@aihu/use/watch')).toBeLessThan(idx('@aihu/use/math/useClamp'))
    expect(idx('@aihu/use/math/useClamp')).toBeLessThan(idx('@aihu/auth'))

    // A SECOND family row must anchor after the first nested row too (the
    // widened anchor regex must keep matching nested rows, not just the
    // original flat ones).
    const withSecond = patchSizeLimit(
      withNested.text,
      '@aihu/use/math/useSum',
      'packages/use/dist/math/useSum.js',
      '250 B',
      ['@aihu/signals'],
    )
    const idx2 = (needle: string) =>
      withSecond.text.split('\n').findIndex((l) => l.includes(needle))
    expect(idx2('@aihu/use/math/useClamp')).toBeLessThan(idx2('@aihu/use/math/useSum'))
    expect(idx2('@aihu/use/math/useSum')).toBeLessThan(idx2('@aihu/auth'))
  })

  it('uses the exact limit and ignore list passed in (family ceiling, not a guess)', () => {
    const result = patchSizeLimit(
      SIZE_LIMIT_SRC,
      '@aihu/use/integrations/useJwt',
      'packages/use/dist/integrations/useJwt.js',
      '600 B',
      ['@aihu/signals', 'jwt-decode'],
    )
    expect(result.text).toContain('"limit": "600 B"')
    expect(result.text).toContain('"ignore": ["@aihu/signals","jwt-decode"]')
  })

  it('is idempotent — a row already present is not duplicated', () => {
    const result = patchSizeLimit(
      SIZE_LIMIT_SRC,
      '@aihu/use/watch',
      'packages/use/dist/watch.js',
      '370 B',
      ['@aihu/signals'],
    )
    expect(result.changed).toBe(false)
    expect(result.text).toBe(SIZE_LIMIT_SRC)
  })
})

describe('patchUseRegistryRs', () => {
  const RS_SRC = [
    'pub(crate) const USE_COMPOSABLES: &[(&str, &str)] = &[',
    '    ("useCounter", "@aihu/use/useCounter"),',
    '];',
  ].join('\n')

  it('emits the NESTED specifier for a family composable, not the aggregate or barrel', () => {
    const result = patchUseRegistryRs(RS_SRC, 'useClamp', 'math/useClamp')
    expect(result.changed).toBe(true)
    expect(result.text).toContain('("useClamp", "@aihu/use/math/useClamp"),')
  })

  it('is idempotent by call name', () => {
    const once = patchUseRegistryRs(RS_SRC, 'useClamp', 'math/useClamp')
    const twice = patchUseRegistryRs(once.text, 'useClamp', 'math/useClamp')
    expect(twice.changed).toBe(false)
  })
})

describe('patchFamilyBarrel', () => {
  it('creates a new family barrel when absent, with a header comment', () => {
    const result = patchFamilyBarrel(undefined, 'math', 'useClamp')
    expect(result.created).toBe(true)
    expect(result.changed).toBe(true)
    expect(result.text).toContain('@aihu/use/math')
    expect(result.text).toContain("export { useClamp } from './useClamp/index.ts'")
  })

  it('patches an existing family barrel, preserving prior members', () => {
    const existing = patchFamilyBarrel(undefined, 'math', 'useClamp').text
    const result = patchFamilyBarrel(existing, 'math', 'useSum')
    expect(result.created).toBe(false)
    expect(result.changed).toBe(true)
    expect(result.text).toContain('useClamp')
    expect(result.text).toContain('useSum')
  })

  it('is idempotent', () => {
    const existing = patchFamilyBarrel(undefined, 'math', 'useClamp').text
    const again = patchFamilyBarrel(existing, 'math', 'useClamp')
    expect(again.changed).toBe(false)
  })
})
