/**
 * Test fixture for `scripts/check-published-exports.ts` (#843). npm is faked
 * with an in-memory lookup so the cases are deterministic and offline.
 */
import { describe, expect, it } from 'vitest'
import {
  checkPackage,
  hasExport,
  type NpmLookup,
  type PackageUnderCheck,
  type ResolvedManifest,
  scanImports,
  splitSpecifier,
  type WorkspacePackage,
} from '../scripts/check-published-exports.ts'

const RUNTIME_EXPORTS_WITH_APP = {
  '.': './dist/index.js',
  './ssr': './dist/ssr.js',
  './app': './dist/app.js',
}
const RUNTIME_EXPORTS_WITHOUT_APP = { '.': './dist/index.js', './ssr': './dist/ssr.js' }

function fakeNpm(published: Record<string, ResolvedManifest>): NpmLookup {
  return (spec) => published[spec] ?? null
}

function workspace(runtimeVersion: string, exports = RUNTIME_EXPORTS_WITH_APP) {
  return new Map<string, WorkspacePackage>([
    ['@aihu/runtime', { name: '@aihu/runtime', version: runtimeVersion, exports }],
  ])
}

const app = (text: string, range = 'workspace:*'): PackageUnderCheck => ({
  name: '@aihu/app',
  manifest: { peerDependencies: { '@aihu/runtime': range } },
  sources: [{ file: 'packages/app/src/client.ts', text }],
})

const CLIENT = `import { _setHydrate, _setMount } from '@aihu/runtime/app'\n`

describe('scanImports', () => {
  it('finds static, multi-line, side-effect, re-export and dynamic imports', () => {
    const src = [
      `import {\n  a,\n  b,\n} from '@aihu/runtime/app'`,
      `import '@aihu/arbor/progressive'`,
      `export { x } from "@aihu/store/devtools"`,
      `const m = await import('@aihu/compiler/codemods/state-wrapper')`,
      `import { signal } from '@aihu/signals'`,
    ].join('\n')
    expect(scanImports(src)).toEqual([
      '@aihu/arbor/progressive',
      '@aihu/compiler/codemods/state-wrapper',
      '@aihu/runtime/app',
      '@aihu/store/devtools',
    ])
  })

  it('ignores type-only imports and comments', () => {
    const src = [
      `import type { Mount } from '@aihu/runtime/app'`,
      `export type { Hydrate } from '@aihu/runtime/app'`,
      `// import { x } from '@aihu/runtime/secret'`,
      `/* import { y } from '@aihu/runtime/hidden' */`,
    ].join('\n')
    expect(scanImports(src)).toEqual([])
  })
})

describe('splitSpecifier / hasExport', () => {
  it('splits scoped specifiers into package and subpath', () => {
    expect(splitSpecifier('@aihu/compiler/codemods/state-wrapper')).toEqual({
      dependency: '@aihu/compiler',
      subpath: './codemods/state-wrapper',
    })
  })

  it('matches exact keys, pattern keys, and treats a missing exports map as open', () => {
    expect(hasExport(RUNTIME_EXPORTS_WITH_APP, './app')).toBe(true)
    expect(hasExport(RUNTIME_EXPORTS_WITHOUT_APP, './app')).toBe(false)
    expect(hasExport({ './codemods/*': './dist/codemods/*.js' }, './codemods/state-wrapper')).toBe(
      true,
    )
    expect(hasExport('./dist/index.js', './app')).toBe(false)
    expect(hasExport(undefined, './anything')).toBe(true)
  })
})

describe('checkPackage', () => {
  it('FAILS on #843: workspace version already on npm without the export', () => {
    const npm = fakeNpm({
      '@aihu/runtime@6.1.0': { version: '6.1.0', exports: RUNTIME_EXPORTS_WITHOUT_APP },
    })
    const problems = checkPackage(app(CLIENT), workspace('6.1.0'), npm)
    expect(problems).toEqual([
      {
        importer: '@aihu/app',
        file: 'packages/app/src/client.ts',
        specifier: '@aihu/runtime/app',
        dependency: '@aihu/runtime',
        version: '6.1.0',
        source: 'npm',
        subpath: './app',
      },
    ])
  })

  it('passes once the workspace version names a published release with the export', () => {
    const npm = fakeNpm({
      '@aihu/runtime@6.1.0': { version: '6.1.0', exports: RUNTIME_EXPORTS_WITHOUT_APP },
      '@aihu/runtime@6.1.1': { version: '6.1.1', exports: RUNTIME_EXPORTS_WITH_APP },
    })
    expect(checkPackage(app(CLIENT), workspace('6.1.1'), npm)).toEqual([])
  })

  it('uses the workspace manifest when its version is not published yet', () => {
    expect(checkPackage(app(CLIENT), workspace('6.2.0'), fakeNpm({}))).toEqual([])
    const missing = checkPackage(
      app(CLIENT),
      workspace('6.2.0', RUNTIME_EXPORTS_WITHOUT_APP),
      fakeNpm({}),
    )
    expect(missing).toHaveLength(1)
    expect(missing[0]?.source).toBe('workspace')
  })

  it('checks registry ranges against the version npm resolves', () => {
    const npm = fakeNpm({
      '@aihu/runtime@^6.1.0': { version: '6.1.0', exports: RUNTIME_EXPORTS_WITHOUT_APP },
    })
    expect(checkPackage(app(CLIENT, '^6.1.0'), new Map(), npm)).toHaveLength(1)
  })

  it('skips undeclared and dev-only dependencies', () => {
    const pkg: PackageUnderCheck = {
      name: '@aihu/app',
      manifest: {},
      sources: [{ file: 'packages/app/src/client.ts', text: CLIENT }],
    }
    expect(checkPackage(pkg, workspace('6.1.0'), fakeNpm({}))).toEqual([])
  })
})
