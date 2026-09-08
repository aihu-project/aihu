import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

describe('standalone package contract', () => {
  it('uses registry-resolvable dependency ranges', () => {
    for (const [section, dependencies] of Object.entries({
      dependencies: manifest.dependencies ?? {},
      peerDependencies: manifest.peerDependencies ?? {},
      devDependencies: manifest.devDependencies ?? {},
    })) {
      for (const [name, range] of Object.entries(dependencies)) {
        expect(range, `${section}.${name}`).not.toMatch(/^workspace:/)
      }
    }
  })

  it('keeps optional family peers explicitly optional', () => {
    for (const name of ['@aihu/context', '@aihu/router', 'jwt-decode']) {
      expect(manifest.peerDependencies, `peerDependencies.${name}`).toHaveProperty(name)
      expect(manifest.peerDependenciesMeta?.[name]?.optional, `peerDependenciesMeta.${name}`).toBe(
        true,
      )
    }
  })
})
