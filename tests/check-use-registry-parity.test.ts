/**
 * Test fixture for `scripts/check-use-registry-parity.ts`.
 *
 * A `@aihu/use` composable has six touch points (src dir, barrel, package.json
 * exports, rolldown input, .size-limit.json row, USE_COMPOSABLES tuple). These
 * cases lock the bidirectional parity rule: a composable dir missing any
 * manifest entry is an error, and a manifest entry with no backing dir (a
 * ghost row) is also an error — plus the REGISTRY_EXEMPT opt-out.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkFamilyAggregates,
  checkParity,
  checkRegistryTupleNames,
  discoverComposableDirs,
  discoverOrphanFamilyDirs,
  type FamilyDef,
  type ParitySources,
  parseBarrelExports,
  parsePackageJsonExports,
  parseRolldownInputs,
  parseSizeLimitRows,
  parseSsrSafetyEntries,
  parseUseRegistryRs,
  REGISTRY_EXEMPT,
  referencesIsClient,
  registryRequired,
} from '../scripts/check-use-registry-parity.ts'

/** A minimal, internally-consistent two-composable universe for fixtures. */
function baseSources(): ParitySources {
  return {
    dirs: new Set(['useCounter', 'useToggle']),
    barrel: new Set(['useCounter', 'useToggle']),
    pkgExports: new Set(['useCounter', 'useToggle']),
    rolldownInputs: new Set(['useCounter', 'useToggle']),
    sizeRows: new Set(['useCounter', 'useToggle']),
    registry: new Set(['useCounter', 'useToggle']),
  }
}

describe('check-use-registry-parity', () => {
  it('passes the all-present green path', () => {
    const result = checkParity(baseSources())
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('flags a name missing from the barrel only', () => {
    const sources = baseSources()
    sources.barrel = new Set(['useCounter'])
    const result = checkParity(sources)
    expect(result.ok).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("'useToggle'")
    expect(result.errors[0]).toContain('barrel export')
  })

  it('flags a name missing from package.json exports only', () => {
    const sources = baseSources()
    sources.pkgExports = new Set(['useCounter'])
    const result = checkParity(sources)
    expect(result.ok).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("'useToggle'")
    expect(result.errors[0]).toContain('package.json exports key')
  })

  it('flags a name missing from the rolldown input only', () => {
    const sources = baseSources()
    sources.rolldownInputs = new Set(['useCounter'])
    const result = checkParity(sources)
    expect(result.ok).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("'useToggle'")
    expect(result.errors[0]).toContain('rolldown input')
  })

  it('flags a name missing from .size-limit.json only', () => {
    const sources = baseSources()
    sources.sizeRows = new Set(['useCounter'])
    const result = checkParity(sources)
    expect(result.ok).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("'useToggle'")
    expect(result.errors[0]).toContain('.size-limit.json row')
  })

  it('flags a name missing from USE_COMPOSABLES only', () => {
    const sources = baseSources()
    sources.registry = new Set(['useCounter'])
    const result = checkParity(sources)
    expect(result.ok).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("'useToggle'")
    expect(result.errors[0]).toContain('USE_COMPOSABLES')
  })

  it('flags a registry tuple with no backing src/ directory (a ghost row)', () => {
    const sources = baseSources()
    sources.dirs = new Set(['useCounter', 'useToggle'])
    sources.registry = new Set(['useCounter', 'useToggle', 'ghostComposable'])
    const result = checkParity(sources)
    expect(result.ok).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("'ghostComposable'")
    expect(result.errors[0]).toContain('directory')
  })

  it('does not flag an EXEMPT-listed name missing from the registry', () => {
    REGISTRY_EXEMPT.add('watch')
    try {
      const sources = baseSources()
      sources.dirs.add('watch')
      sources.barrel.add('watch')
      sources.pkgExports.add('watch')
      sources.rolldownInputs.add('watch')
      sources.sizeRows.add('watch')
      // Deliberately NOT added to sources.registry.
      const result = checkParity(sources)
      expect(result.ok).toBe(true)
      expect(result.errors).toEqual([])
    } finally {
      REGISTRY_EXEMPT.delete('watch')
    }
  })

  it('reports every missing source when a name is dir-only', () => {
    const sources = baseSources()
    sources.dirs.add('useOrphan')
    const result = checkParity(sources)
    expect(result.ok).toBe(false)
    const err = result.errors.find((e) => e.includes('useOrphan'))
    expect(err).toBeDefined()
    expect(err).toContain('barrel export')
    expect(err).toContain('package.json exports key')
    expect(err).toContain('rolldown input')
    expect(err).toContain('.size-limit.json row')
    expect(err).toContain('USE_COMPOSABLES')
  })

  describe('parsers', () => {
    it('parseBarrelExports pulls composable names, excludes shared', () => {
      const src = [
        "export type { MaybeGetter } from './shared/index.ts'",
        "export { isClient } from './shared/index.ts'",
        "export type { UseCounterOptions, UseCounterReturn } from './useCounter/index.ts'",
        "export { useCounter } from './useCounter/index.ts'",
        "export { useToggle } from './useToggle/index.ts'",
      ].join('\n')
      expect(parseBarrelExports(src)).toEqual(new Set(['useCounter', 'useToggle']))
    })

    it('parsePackageJsonExports excludes "." and "./shared"', () => {
      const pkg = {
        exports: {
          '.': { types: 'x', import: 'y' },
          './shared': { types: 'x', import: 'y' },
          './useCounter': { types: 'x', import: 'y' },
          './useToggle': { types: 'x', import: 'y' },
        },
      }
      expect(parsePackageJsonExports(pkg)).toEqual(new Set(['useCounter', 'useToggle']))
    })

    it('parseRolldownInputs excludes index and shared', () => {
      const src = [
        'export default defineConfig({',
        '  input: {',
        "    index: 'src/index.ts',",
        "    shared: 'src/shared/index.ts',",
        "    useCounter: 'src/useCounter/index.ts',",
        "    useToggle: 'src/useToggle/index.ts',",
        '  },',
        '})',
      ].join('\n')
      expect(new Set(parseRolldownInputs(src).keys())).toEqual(new Set(['useCounter', 'useToggle']))
    })

    it('parseRolldownInputs matches quoted family/member keys (the plain \\w+ form cannot)', () => {
      const src = [
        'export default defineConfig({',
        '  input: {',
        "    index: 'src/index.ts',",
        "    shared: 'src/shared/index.ts',",
        "    math: 'src/math/index.ts',",
        "    'math/useClamp': 'src/math/useClamp/index.ts',",
        "    'integrations/useJwt': 'src/integrations/useJwt/index.ts',",
        '  },',
        '})',
      ].join('\n')
      const result = parseRolldownInputs(src)
      expect(new Set(result.keys())).toEqual(
        new Set(['math', 'math/useClamp', 'integrations/useJwt']),
      )
      expect(result.get('math/useClamp')).toBe('src/math/useClamp/index.ts')
    })

    it('parseSizeLimitRows filters to @aihu/use/* rows, excludes shared', () => {
      const rows = [
        { name: '@aihu/signals' },
        { name: '@aihu/use/shared' },
        { name: '@aihu/use/useCounter' },
        { name: '@aihu/use/useToggle' },
        { name: '@aihu/auth' },
      ]
      expect(parseSizeLimitRows(rows)).toEqual(new Set(['useCounter', 'useToggle']))
    })

    it('parseUseRegistryRs pulls the subpath name out of each tuple', () => {
      const src = [
        'pub(crate) const USE_COMPOSABLES: &[(&str, &str)] = &[',
        '    ("useCounter", "@aihu/use/useCounter"),',
        '    ("useToggle", "@aihu/use/useToggle"),',
        '];',
      ].join('\n')
      expect(parseUseRegistryRs(src)).toEqual(new Set(['useCounter', 'useToggle']))
    })

    it('parseUseRegistryRs does NOT count a commented-out tuple as registered', () => {
      const src = [
        'pub(crate) const USE_COMPOSABLES: &[(&str, &str)] = &[',
        '    ("useCounter", "@aihu/use/useCounter"),',
        '    // ("useToggle", "@aihu/use/useToggle"), // temporarily disabled',
        '];',
      ].join('\n')
      expect(parseUseRegistryRs(src)).toEqual(new Set(['useCounter']))
    })

    it('parseUseRegistryRs ignores a tuple inside a block comment', () => {
      const src = [
        'pub(crate) const USE_COMPOSABLES: &[(&str, &str)] = &[',
        '    ("useCounter", "@aihu/use/useCounter"),',
        '    /* ("useToggle", "@aihu/use/useToggle"), */',
        '];',
      ].join('\n')
      expect(parseUseRegistryRs(src)).toEqual(new Set(['useCounter']))
    })

    it('parseUseRegistryRs matches a family/member subpath (group 2 widened past \\w+)', () => {
      const src = [
        'pub(crate) const USE_COMPOSABLES: &[(&str, &str)] = &[',
        '    ("useClamp", "@aihu/use/math/useClamp"),',
        '];',
      ].join('\n')
      expect(parseUseRegistryRs(src)).toEqual(new Set(['math/useClamp']))
    })

    it("checkRegistryTupleNames flags a bare call name that diverges from the subpath's last segment", () => {
      const src = [
        'pub(crate) const USE_COMPOSABLES: &[(&str, &str)] = &[',
        '    ("useClamp", "@aihu/use/math/useSum"),',
        '];',
      ].join('\n')
      const errors = checkRegistryTupleNames(src)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('useClamp')
      expect(errors[0]).toContain('useSum')
    })

    it('checkRegistryTupleNames passes when the call name matches', () => {
      const src = [
        'pub(crate) const USE_COMPOSABLES: &[(&str, &str)] = &[',
        '    ("useClamp", "@aihu/use/math/useClamp"),',
        '];',
      ].join('\n')
      expect(checkRegistryTupleNames(src)).toEqual([])
    })

    it('parseSsrSafetyEntries pulls slash-qualified Tier-2 entry names', () => {
      const src = [
        'const entries = [',
        "  { entry: 'useMouse', run: () => {} },",
        "  { entry: 'math/useClamp', run: () => {} },",
        ']',
      ].join('\n')
      expect(parseSsrSafetyEntries(src)).toEqual(new Set(['useMouse', 'math/useClamp']))
    })

    it('referencesIsClient detects the isClient token', () => {
      expect(referencesIsClient("import { isClient } from '../shared/index.ts'")).toBe(true)
      expect(referencesIsClient('export function useClamp() {}')).toBe(false)
    })
  })

  describe('registryRequired', () => {
    const families: Record<string, FamilyDef> = {
      math: { aggregate: true, autoImport: true, memberLimit: '250 B', peers: {} },
      integrations: { aggregate: false, autoImport: false, memberLimit: '600 B', peers: {} },
    }

    it('CORE composables always require a registry tuple', () => {
      expect(registryRequired('useCounter', families)).toBe(true)
    })

    it('a member of an autoImport:true family requires a tuple', () => {
      expect(registryRequired('math/useClamp', families)).toBe(true)
    })

    it('a member of an autoImport:false family does NOT require a tuple', () => {
      expect(registryRequired('integrations/useJwt', families)).toBe(false)
    })

    it('REGISTRY_EXEMPT still opts a CORE name out', () => {
      REGISTRY_EXEMPT.add('watchFixture')
      try {
        expect(registryRequired('watchFixture', families)).toBe(false)
      } finally {
        REGISTRY_EXEMPT.delete('watchFixture')
      }
    })
  })

  describe('checkParity — family awareness', () => {
    const families: Record<string, FamilyDef> = {
      math: { aggregate: true, autoImport: true, memberLimit: '250 B', peers: {} },
      integrations: { aggregate: false, autoImport: false, memberLimit: '600 B', peers: {} },
    }

    function familySources(): ParitySources {
      return {
        dirs: new Set(['math/useClamp', 'integrations/useJwt']),
        barrel: new Set(),
        pkgExports: new Set(['math/useClamp', 'integrations/useJwt']),
        rolldownInputs: new Set(['math/useClamp', 'integrations/useJwt']),
        sizeRows: new Set(['math/useClamp', 'integrations/useJwt']),
        registry: new Set(['math/useClamp']), // integrations/useJwt correctly has none
      }
    }

    it('passes when an autoImport:true member has a tuple and an autoImport:false member does not', () => {
      const result = checkParity(familySources(), { families })
      expect(result.errors).toEqual([])
      expect(result.ok).toBe(true)
    })

    it('FAILs when an autoImport:false member incorrectly HAS a registry tuple', () => {
      const sources = familySources()
      sources.registry.add('integrations/useJwt')
      const result = checkParity(sources, { families })
      expect(result.ok).toBe(false)
      expect(
        result.errors.some(
          (e) => e.includes('integrations/useJwt') && e.includes('autoImport: false'),
        ),
      ).toBe(true)
    })

    it('FAILs when a family name (member) appears in the CORE barrel', () => {
      const sources = familySources()
      sources.barrel.add('math/useClamp')
      const result = checkParity(sources, { families })
      expect(result.ok).toBe(false)
      expect(
        result.errors.some((e) => e.includes('math/useClamp') && e.includes('CORE barrel')),
      ).toBe(true)
    })

    it('does not require an SSR row for a member whose source never references isClient', () => {
      const sources = familySources()
      const result = checkParity(sources, { families, ssrRequired: new Set() })
      expect(result.ok).toBe(true)
    })

    it('requires an SSR Tier-2 row when the member is flagged ssrRequired and it is missing', () => {
      const sources = familySources()
      sources.ssrRows = new Set() // no rows at all
      const result = checkParity(sources, { families, ssrRequired: new Set(['math/useClamp']) })
      expect(result.ok).toBe(false)
      expect(
        result.errors.some((e) => e.includes('math/useClamp') && e.includes('ssr-safety')),
      ).toBe(true)
    })

    it('passes the SSR requirement once the Tier-2 row exists', () => {
      const sources = familySources()
      sources.ssrRows = new Set(['math/useClamp'])
      const result = checkParity(sources, { families, ssrRequired: new Set(['math/useClamp']) })
      expect(result.ok).toBe(true)
    })
  })

  describe('discoverComposableDirs — family-aware directory discovery', () => {
    let root: string | undefined
    afterEach(() => {
      if (root) rmSync(root, { recursive: true, force: true })
      root = undefined
    })

    it("finds CORE dirs and family/member dirs, skips shared and the family's own aggregate file", () => {
      root = mkdtempSync(join(tmpdir(), 'use-dirs-'))
      mkdirSync(join(root, 'shared'), { recursive: true })
      writeFileSync(join(root, 'shared/index.ts'), '')
      mkdirSync(join(root, 'useCounter'), { recursive: true })
      writeFileSync(join(root, 'useCounter/index.ts'), '')
      mkdirSync(join(root, 'math'), { recursive: true })
      writeFileSync(join(root, 'math/index.ts'), '') // aggregate barrel — a FILE, not a member dir
      mkdirSync(join(root, 'math/useClamp'), { recursive: true })
      writeFileSync(join(root, 'math/useClamp/index.ts'), '')

      const families: Record<string, FamilyDef> = {
        math: { aggregate: true, autoImport: true, memberLimit: '250 B', peers: {} },
      }
      expect(discoverComposableDirs(root, families)).toEqual(
        new Set(['useCounter', 'math/useClamp']),
      )
    })
  })

  describe('discoverOrphanFamilyDirs', () => {
    let root: string | undefined
    afterEach(() => {
      if (root) rmSync(root, { recursive: true, force: true })
      root = undefined
    })

    it('flags a top-level dir with no index.ts that is not declared in families.json', () => {
      root = mkdtempSync(join(tmpdir(), 'use-orphan-'))
      mkdirSync(join(root, 'shared'), { recursive: true })
      mkdirSync(join(root, 'stray'), { recursive: true })
      mkdirSync(join(root, 'stray/useFoo'), { recursive: true })
      writeFileSync(join(root, 'stray/useFoo/index.ts'), '')
      expect(discoverOrphanFamilyDirs(root, {})).toEqual(['stray'])
    })

    it('does not flag a declared family, or a CORE composable dir', () => {
      root = mkdtempSync(join(tmpdir(), 'use-orphan-'))
      mkdirSync(join(root, 'math'), { recursive: true })
      mkdirSync(join(root, 'useCounter'), { recursive: true })
      writeFileSync(join(root, 'useCounter/index.ts'), '')
      const families: Record<string, FamilyDef> = {
        math: { aggregate: true, autoImport: true, memberLimit: '250 B', peers: {} },
      }
      expect(discoverOrphanFamilyDirs(root, families)).toEqual([])
    })
  })

  describe('checkFamilyAggregates', () => {
    const families: Record<string, FamilyDef> = {
      math: {
        aggregate: true,
        autoImport: true,
        memberLimit: '250 B',
        aggregateLimit: '1200 B',
        peers: {},
      },
      integrations: { aggregate: false, autoImport: false, memberLimit: '600 B', peers: {} },
    }

    it('a zero-member family requires nothing — Wave 0 pre-declares families ahead of their first member', () => {
      const errors = checkFamilyAggregates(
        families,
        {},
        {
          barrelExists: new Set(),
          pkgExportsAggregates: new Set(),
          rolldownAggregates: new Set(),
          sizeRowAggregates: new Set(),
        },
      )
      expect(errors).toEqual([])
    })

    it('an aggregate:true family with >=1 member MUST carry all four aggregate touch points', () => {
      const errors = checkFamilyAggregates(
        families,
        { math: 1 },
        {
          barrelExists: new Set(),
          pkgExportsAggregates: new Set(),
          rolldownAggregates: new Set(),
          sizeRowAggregates: new Set(),
        },
      )
      expect(errors.length).toBe(4)
      expect(errors.every((e) => e.includes('math'))).toBe(true)
    })

    it('an aggregate:false family (integrations) MUST NOT carry an aggregate entry even with members', () => {
      const errors = checkFamilyAggregates(
        families,
        { integrations: 3 },
        {
          barrelExists: new Set(['integrations']),
          pkgExportsAggregates: new Set(),
          rolldownAggregates: new Set(),
          sizeRowAggregates: new Set(),
        },
      )
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('integrations')
      expect(errors[0]).toContain('remove it')
    })

    it('passes when an aggregate:true family with members has all four parts present', () => {
      const errors = checkFamilyAggregates(
        families,
        { math: 2 },
        {
          barrelExists: new Set(['math']),
          pkgExportsAggregates: new Set(['math']),
          rolldownAggregates: new Set(['math']),
          sizeRowAggregates: new Set(['math']),
        },
      )
      expect(errors).toEqual([])
    })
  })
})

// NOTE: deliberately no "against the real tree" test here reading the live
// packages/use/src + manifests (unlike this file's synthetic-fixture tests
// above, which is the established pattern — see check-size-rows.test.ts /
// native binary tests, both synthesized-data only). A
// hardcoded composable count pinned against the live filesystem would be
// exactly one landing (or one sibling in-flight branch) away from a stale,
// unrelated CI failure. `bun run check:use-registry-parity` IS the real-tree
// check — run it directly (wired into check:ci and plan-a.yml) rather than
// re-deriving it inside a unit test.
