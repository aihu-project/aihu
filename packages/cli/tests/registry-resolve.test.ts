/**
 * `registry-resolve.ts` resolver-level tests.
 *
 * `aihu add`/`aihu list` used to require a legacy `aihu.config.ts` file to even
 * recognize a directory as an aihu project — `registry-resolve.ts` had its own
 * private `aihu.config.ts`-only loader, a third loader alongside `aihu build`
 * and `aihu dev`'s (see `load-project-config.ts`'s doc comment). A project
 * configured only via `viteAihuPlugin({...})` in `vite.config.ts` — the
 * now-canonical location (`docs/TOPOLOGY.md` §T1) — made `aihu add` report
 * "no config found" even though `aihu build`/`aihu dev` read it fine.
 *
 * These tests exercise `resolveRegistry` directly (below the `add`/`list`
 * command layer) with the same injectable-fake style the command tests use.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Registry } from '@aihu/ui/registry'
import { afterEach, describe, expect, it } from 'vitest'
import { realConfigLoader, type RegistryFs, resolveRegistry } from '../src/registry-resolve.ts'

const REGISTRY: Registry = {
  items: [
    {
      name: 'button',
      type: 'ui',
      files: [{ path: 'registry/button/button.aihu', type: 'component' }],
    },
  ],
}
const REGISTRY_ROOT = '/fake/node_modules/@aihu/ui'

function makeFs(seed: Record<string, string>): RegistryFs {
  return {
    exists: (p) => Object.hasOwn(seed, p),
    read: (p) => {
      if (!Object.hasOwn(seed, p)) throw new Error(`ENOENT (fake): ${p}`)
      return seed[p] as string
    },
  }
}

describe('resolveRegistry — project root recognized via vite.config.ts alone', () => {
  it('does not throw no-config when only vite.config.ts marks the project (no aihu.config.ts)', async () => {
    const fs = makeFs({
      '/proj/vite.config.ts': "import { defineConfig } from 'vite'\nexport default defineConfig({})\n",
      [join(REGISTRY_ROOT, 'registry.json')]: JSON.stringify(REGISTRY),
    })
    const resolved = await resolveRegistry('/proj', {
      fs,
      configLoader: { async load() { return { ui: { target: './src/components/ui' } } } },
      resolveRegistryRoot: () => REGISTRY_ROOT,
    })
    expect(resolved.projectRoot).toBe('/proj')
    expect(resolved.ui.target).toBe('./src/components/ui')
  })

  it('still recognizes a project from a nested subdirectory (upward walk preserved)', async () => {
    const fs = makeFs({
      '/proj/vite.config.ts': "import { defineConfig } from 'vite'\nexport default defineConfig({})\n",
      [join(REGISTRY_ROOT, 'registry.json')]: JSON.stringify(REGISTRY),
    })
    const resolved = await resolveRegistry('/proj/src/deeply/nested', {
      fs,
      configLoader: { async load() { return { ui: {} } } },
      resolveRegistryRoot: () => REGISTRY_ROOT,
    })
    expect(resolved.projectRoot).toBe('/proj')
  })

  it('still throws no-config when neither vite.config.ts nor aihu.config.ts is present', async () => {
    const fs = makeFs({})
    await expect(
      resolveRegistry('/proj', {
        fs,
        configLoader: { async load() { return null } },
      }),
    ).rejects.toThrow('No aihu project config found')
  })
})

describe('realConfigLoader — real fs', () => {
  const tmpDirs: string[] = []
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  // Reading the `ui` block out of a real `aihu.config.ts`/`vite.config.ts` via
  // dynamic import is covered by the `aihu add` disk-acceptance test in
  // `add.test.ts`, which injects a fake `configLoader` even against a real
  // temp dir — vite-node's dynamic `import()` of an arbitrary absolute path
  // outside the project root does not resolve inside vitest the way it does
  // under plain bun/node at runtime, so `realConfigLoader` itself is exercised
  // here only for the marker-detection short-circuit, not the import step.
  it('returns null when neither vite.config.ts nor aihu.config.ts exists', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aihu-registry-resolve-'))
    tmpDirs.push(root)
    expect(await realConfigLoader.load(root)).toBeNull()
  })
})
