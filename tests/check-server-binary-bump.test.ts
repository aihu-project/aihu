/**
 * Test fixture for `scripts/check-server-binary-bump.ts`.
 *
 * See scripts/lib/native-binary-bump.ts for the shared FEL-414
 * background this class of guard exists to prevent. This package has only
 * one platform-binary family (the napi-rs SSR renderer addon).
 */
import { describe, expect, it } from 'vitest'
import {
  checkBump,
  discoverPlatforms,
  FAMILIES,
  HOST_MANIFEST,
  isPlatformManifest,
  isServerRustSource,
  platformManifestFamily,
} from '../scripts/check-server-binary-bump.ts'

const PLATFORMS = discoverPlatforms()

const manifests = (): string[] =>
  PLATFORMS.napi.map((p) => `${FAMILIES.napi.dir}/${p}/package.json`)

const fullBump = (): string[] => [...manifests(), HOST_MANIFEST]

describe('server binary bump guard', () => {
  it('sees the platform family on disk', () => {
    expect(PLATFORMS.napi.length).toBeGreaterThan(0)
  })

  it('recognizes the native renderer Rust source', () => {
    expect(isServerRustSource('packages/server/src-native/src/render.rs')).toBe(true)
    expect(isServerRustSource('packages/server/src-native/src/lib.rs')).toBe(true)
    expect(isServerRustSource('packages/server/src-native/Cargo.toml')).toBe(true)
    expect(isServerRustSource('packages/server/src/index.ts')).toBe(false)
    expect(isServerRustSource('packages/runtime/src-native/src/lib.rs')).toBe(false)
  })

  it('recognizes platform manifests', () => {
    expect(isPlatformManifest('packages/server/npm/darwin-arm64/package.json')).toBe(true)
    expect(platformManifestFamily('packages/server/npm/darwin-arm64/package.json')).toBe('napi')
    expect(isPlatformManifest(HOST_MANIFEST)).toBe(false)
  })

  it('FAILS when Rust source changed but no platform package bumped', () => {
    const result = checkBump([
      'packages/server/src-native/src/render.rs',
      'packages/server/src/index.ts',
    ])
    expect(result.ok).toBe(false)
    expect(result.sharedChanged).toContain('packages/server/src-native/src/render.rs')
    expect(result.requiredFamilies).toEqual(['napi'])
    expect(result.missing).toEqual(fullBump())
  })

  it('FAILS on a partial bump that misses one platform', () => {
    const all = manifests()
    const dropped = all[all.length - 1]
    const result = checkBump(fullBump().filter((f) => f !== dropped))
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual([dropped])
  })

  it('FAILS when the family bumps but the host optionalDependencies are not repointed', () => {
    const result = checkBump(['packages/server/src-native/src/render.rs', ...manifests()])
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual([HOST_MANIFEST])
  })

  it('passes on a complete bump plus the host pin', () => {
    const result = checkBump(['packages/server/src-native/src/render.rs', ...fullBump()])
    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
  })

  it('passes on a pure, complete platform bump with no Rust change (the ship-only PR)', () => {
    expect(checkBump(fullBump()).ok).toBe(true)
  })

  it('passes when nothing server-native-related changed', () => {
    expect(checkBump(['packages/signals/src/index.ts', 'README.md']).ok).toBe(true)
  })

  it('does not fire on JS-glue or test changes alone', () => {
    expect(checkBump(['packages/server/src/index.ts']).ok).toBe(true)
  })
})
