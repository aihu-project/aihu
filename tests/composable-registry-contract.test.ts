/**
 * The published @aihu/use registry is the portable boundary for consumers
 * that live outside this monorepo. Keep it byte-for-byte in parity with the
 * generated language-server table so a compiler or LSP cannot silently use a
 * different auto-import set after extraction.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMPOSABLE_REGISTRY } from '../packages/language-server/src/core/composable-registry.ts'

interface RegistryContract {
  schemaVersion: number
  package: string
  entries: typeof COMPOSABLE_REGISTRY
}

const contractPath = resolve(import.meta.dirname, '../packages/use/composable-registry.json')
const contract = JSON.parse(readFileSync(contractPath, 'utf8')) as RegistryContract

describe('@aihu/use portable registry contract', () => {
  it('matches the generated language-server table exactly', () => {
    expect(contract.schemaVersion).toBe(1)
    expect(contract.package).toBe('@aihu/use')
    expect(contract.entries).toEqual(COMPOSABLE_REGISTRY)
  })

  it('contains unique names and specifiers for downstream consumers', () => {
    const names = contract.entries.map((entry) => entry.name)
    const specifiers = contract.entries.map((entry) => entry.specifier)
    expect(new Set(names).size).toBe(names.length)
    expect(new Set(specifiers).size).toBe(specifiers.length)
    for (const entry of contract.entries) {
      expect(entry.name).toMatch(/^use[A-Z]/)
      expect(entry.specifier).toMatch(/^@aihu\/use\//)
      expect(entry.description.length).toBeGreaterThan(0)
    }
  })

  it('does not let an LSP-only output override bypass contract drift checking', () => {
    const fixtureRoot = resolve(import.meta.dirname, '../scripts/fixtures/composable-registry')
    const result = spawnSync('bun', ['scripts/gen-composable-hover-registry.ts', '--check'], {
      cwd: resolve(import.meta.dirname, '..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        COMPOSABLE_REGISTRY_RS: resolve(fixtureRoot, 'use_registry.rs'),
        COMPOSABLE_REGISTRY_OUT: resolve(fixtureRoot, 'expected-match.ts'),
        COMPOSABLE_USE_SRC_ROOT: resolve(fixtureRoot, 'nonexistent-src'),
        // Deliberately omit COMPOSABLE_REGISTRY_CONTRACT_OUT. A fixture
        // redirecting only the LSP output must still validate production's
        // committed portable contract and fail on the fixture data.
      },
    })
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain('composable-registry.json is stale')
  })
})
