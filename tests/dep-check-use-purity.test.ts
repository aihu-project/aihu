/**
 * Fixtures for `scripts/dep-check.ts`'s `checkUseSubpathPurity()` — the
 * mechanism that enforces the revised `@aihu/use` namespace contract (CORE
 * dependency-free; FAMILY subpaths may declare optional peers, isolated per
 * entry). A gate with no negative test is a gate that silently stops
 * working, so this file builds real temp `packages/use`-shaped trees on disk
 * (the function walks the filesystem) and asserts both the green path and
 * the three FAIL cases the design calls out:
 *   1. a CORE entry statically importing a family file
 *   2. a family entry importing a different family's file
 *   3. a family member importing a peer it does not own
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkUseSubpathPurity, extractSpecifiers } from '../scripts/dep-check.ts'

let dir: string | undefined

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

async function write(root: string, rel: string, content: string): Promise<void> {
  const path = join(root, rel)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
}

/** A minimal, otherwise-green `packages/use` tree: one core composable, one
 * math member + aggregate, one integrations member with its own peer. */
async function baseFixture(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'use-purity-'))
  await write(
    root,
    'families.json',
    JSON.stringify({
      families: {
        math: {
          aggregate: true,
          autoImport: true,
          memberLimit: '250 B',
          aggregateLimit: '1200 B',
          peers: {},
        },
        integrations: {
          aggregate: false,
          autoImport: false,
          memberLimit: '600 B',
          peers: { useJwt: ['jwt-decode'] },
        },
      },
    }),
  )
  await write(
    root,
    'package.json',
    JSON.stringify({
      name: '@aihu/use',
      peerDependencies: { 'jwt-decode': '>=4' },
      peerDependenciesMeta: { 'jwt-decode': { optional: true } },
      devDependencies: { 'jwt-decode': '^4' },
    }),
  )
  await write(
    root,
    'rolldown.config.ts',
    [
      'export default {',
      '  input: {',
      "    index: 'src/index.ts',",
      "    shared: 'src/shared/index.ts',",
      "    useMouse: 'src/useMouse/index.ts',",
      "    math: 'src/math/index.ts',",
      "    'math/useClamp': 'src/math/useClamp/index.ts',",
      "    'integrations/useJwt': 'src/integrations/useJwt/index.ts',",
      '  },',
      '}',
    ].join('\n'),
  )
  await write(root, 'src/shared/index.ts', 'export const isClient = false\n')
  await write(root, 'src/index.ts', "export { useMouse } from './useMouse/index.ts'\n")
  await write(
    root,
    'src/useMouse/index.ts',
    "import { isClient } from '../shared/index.ts'\nexport function useMouse() {}\n",
  )
  await write(root, 'src/math/index.ts', "export { useClamp } from './useClamp/index.ts'\n")
  await write(
    root,
    'src/math/useClamp/index.ts',
    "import { isClient } from '../../shared/index.ts'\nexport function useClamp() {}\n",
  )
  await write(
    root,
    'src/integrations/useJwt/index.ts',
    "import { jwtDecode } from 'jwt-decode'\nexport function useJwt() { return jwtDecode }\n",
  )
  return root
}

describe('checkUseSubpathPurity', () => {
  it('green path: passes with no violations', async () => {
    dir = await baseFixture()
    const result = checkUseSubpathPurity(dir)
    expect(result.errors).toEqual([])
    expect(result.pass).toBe(true)
  })

  it('FAIL: a CORE entry statically importing a family file', async () => {
    dir = await baseFixture()
    await write(
      dir,
      'src/useMouse/index.ts',
      "import { isClient } from '../shared/index.ts'\nimport '../math/useClamp/index.ts'\nexport function useMouse() {}\n",
    )
    const result = checkUseSubpathPurity(dir)
    expect(result.pass).toBe(false)
    expect(
      result.errors.some((e) => e.includes("core entry 'useMouse'") && e.includes('family file')),
    ).toBe(true)
  })

  it('FAIL: a family entry importing a different family file', async () => {
    dir = await baseFixture()
    await write(
      dir,
      'families.json',
      JSON.stringify({
        families: {
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
          integrations: {
            aggregate: false,
            autoImport: false,
            memberLimit: '600 B',
            peers: { useJwt: ['jwt-decode'] },
          },
        },
      }),
    )
    await write(
      dir,
      'rolldown.config.ts',
      [
        'export default {',
        '  input: {',
        "    index: 'src/index.ts',",
        "    shared: 'src/shared/index.ts',",
        "    useMouse: 'src/useMouse/index.ts',",
        "    math: 'src/math/index.ts',",
        "    'math/useClamp': 'src/math/useClamp/index.ts',",
        "    'motion/useReducedMotion': 'src/motion/useReducedMotion/index.ts',",
        "    'integrations/useJwt': 'src/integrations/useJwt/index.ts',",
        '  },',
        '}',
      ].join('\n'),
    )
    await write(
      dir,
      'src/motion/useReducedMotion/index.ts',
      "import { useClamp } from '../../math/useClamp/index.ts'\nexport function useReducedMotion() { return useClamp }\n",
    )
    const result = checkUseSubpathPurity(dir)
    expect(result.pass).toBe(false)
    expect(
      result.errors.some(
        (e) => e.includes("'motion/useReducedMotion'") && e.includes("family 'math'"),
      ),
    ).toBe(true)
  })

  it('FAIL: a family member importing a peer it does not own', async () => {
    dir = await baseFixture()
    await write(
      dir,
      'src/integrations/useJwt/index.ts',
      "import axios from 'axios'\nexport function useJwt() { return axios }\n",
    )
    const result = checkUseSubpathPurity(dir)
    expect(result.pass).toBe(false)
    expect(
      result.errors.some((e) => e.includes("'integrations/useJwt'") && e.includes("'axios'")),
    ).toBe(true)
  })

  it('FAIL: a computed dynamic import cannot bypass subpath purity', async () => {
    dir = await baseFixture()
    await write(
      dir,
      'src/useMouse/index.ts',
      "import { isClient } from '../shared/index.ts'\nconst target = 'unlisted-package'\nvoid import(target)\nexport function useMouse() { return isClient }\n",
    )
    const result = checkUseSubpathPurity(dir)
    expect(result.pass).toBe(false)
    expect(result.errors.some((error) => error.includes('computed dynamic import'))).toBe(true)
  })

  it('FAIL: an optional peer declared in package.json but not claimed by families.json', async () => {
    dir = await baseFixture()
    await write(
      dir,
      'package.json',
      JSON.stringify({
        name: '@aihu/use',
        peerDependencies: { 'jwt-decode': '>=4', axios: '>=1' },
        peerDependenciesMeta: { 'jwt-decode': { optional: true }, axios: { optional: true } },
        devDependencies: { 'jwt-decode': '^4', axios: '^1' },
      }),
    )
    const result = checkUseSubpathPurity(dir)
    expect(result.pass).toBe(false)
    expect(result.errors.some((e) => e.includes("'axios'") && e.includes('orphaned peer'))).toBe(
      true,
    )
  })
})

describe('extractSpecifiers (comment-blindness)', () => {
  // Regression for C-FEL-DEPCHECK-COMMENTS: the `from '...'` pattern matched the
  // word "from" followed by a quoted string ANYWHERE, so prose in a comment was
  // read as an import specifier and reported as an undeclared external. That
  // false positive forced a correct comment to be reworded to get CI green
  // (architect hit it on #672). The fix strips comments before matching.
  //
  // BOTH directions live in ONE fixture on purpose: a fix that simply stopped
  // parsing would drop the real imports too and fail the second assertion.
  it('ignores import-like prose in // and /* */ comments but still reads real imports', () => {
    const src = [
      '// this line is indistinguishable from "nothing to decide"',
      '/* a block comment also mentioning from "phantom-in-block" here */',
      'import { effect } from "@aihu/signals"',
      "export { thing } from './local-module.ts'",
      "const url = 'http://example.com/from-not-a-real-spec' // // not a comment start",
    ].join('\n')
    const specs = extractSpecifiers(src)
    // Real imports/exports survive the comment strip.
    expect(specs).toContain('@aihu/signals')
    expect(specs).toContain('./local-module.ts')
    // Comment prose is NOT read as a specifier — the exact bug string.
    expect(specs).not.toContain('nothing to decide')
    expect(specs).not.toContain('phantom-in-block')
    // A `//` inside a string literal must not swallow the rest of the line, so
    // the real import three lines up is still present (asserted above); the URL
    // itself is a value, not a `from`/`import` specifier, so it is not extracted.
    expect(specs).not.toContain('http://example.com/from-not-a-real-spec')
  })

  it('still catches a genuinely undeclared import (no false negative)', () => {
    // The fix must not trade a false positive for a false negative: a real,
    // undeclared import in live code is still surfaced to the purity check.
    const src = "import axios from 'axios'\nconst from = 'shadowed'\n"
    expect(extractSpecifiers(src)).toContain('axios')
  })

  it('marks computed dynamic imports as unverifiable', () => {
    expect(extractSpecifiers("const specifier = 'pkg'; void import(specifier)")).toContain(
      '<computed dynamic import>',
    )
  })

  it('an import on a later line survives a regex-with-slashes above it', () => {
    // Documents the one known limitation: stripComments does not model regex
    // literals, so a `//` inside a regex (e.g. /https:\/\//) reads as a line
    // comment. The damage is CONFINED to that line — a line-comment strip stops
    // at the newline — so imports on later lines are unaffected. This is the
    // false-negative direction the contract warned about; it is nearly
    // untriggerable because an import never shares a line with a regex literal.
    const src = ['const urlRe = /https:\\/\\//g', "import { effect } from '@aihu/signals'"].join(
      '\n',
    )
    expect(extractSpecifiers(src)).toContain('@aihu/signals')
  })
})
