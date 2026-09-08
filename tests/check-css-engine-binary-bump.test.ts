/**
 * Test fixture for `scripts/check-css-engine-binary-bump.ts`.
 *
 * See scripts/lib/native-binary-bump.ts for the shared FEL-414
 * background this class of guard exists to prevent. This package has only
 * one platform-binary family (no napi addon), so the lockstep/lone-family
 * cases collapse relative to the compiler's dual-family test suite.
 */
import { describe, expect, it } from 'vitest'
import {
  checkBump,
  discoverPlatforms,
  FAMILIES,
  HOST_MANIFEST,
  isCssCoreRustSource,
  isPlatformManifest,
  platformManifestFamily,
} from '../scripts/check-css-engine-binary-bump.ts'

const PLATFORMS = discoverPlatforms()

const manifests = (): string[] => PLATFORMS.cli.map((p) => `${FAMILIES.cli.dir}/${p}/package.json`)

const fullBump = (): string[] => [...manifests(), HOST_MANIFEST]

describe('css-engine binary bump guard', () => {
  it('sees the platform family on disk', () => {
    expect(PLATFORMS.cli.length).toBeGreaterThan(0)
  })

  it('recognizes aihu-css-core Rust source', () => {
    expect(isCssCoreRustSource('packages/css-engine/crates/aihu-css-core/src/emit.rs')).toBe(true)
    expect(isCssCoreRustSource('packages/css-engine/crates/aihu-css-core/Cargo.toml')).toBe(true)
    expect(isCssCoreRustSource('packages/css-engine/src/index.ts')).toBe(false)
    expect(isCssCoreRustSource('packages/css-engine/crates/aihu-css-core/tests/emit.rs')).toBe(
      false,
    )
    expect(isCssCoreRustSource('packages/runtime/src/emit.ts')).toBe(false)
  })

  it("recognizes build.rs and recipes/*.css — both include_str!'d into the binary", () => {
    // The gap this guard used to have (tailwind-animations port doc, Track A
    // Slice 13): `build.rs` include_str!s every `recipes/*.css` file, so an
    // edit to either changes the compiled binary exactly like a `.rs` edit
    // does, but neither matched the old `src/**.rs`-only predicate.
    expect(isCssCoreRustSource('packages/css-engine/crates/aihu-css-core/build.rs')).toBe(true)
    expect(isCssCoreRustSource('packages/css-engine/crates/aihu-css-core/recipes/btn.css')).toBe(
      true,
    )
    // A non-.css file under recipes/ (if one ever existed) isn't include_str!'d.
    expect(isCssCoreRustSource('packages/css-engine/crates/aihu-css-core/recipes/README.md')).toBe(
      false,
    )
    // build.rs/recipes/ from an unrelated crate must not false-positive.
    expect(isCssCoreRustSource('packages/runtime/build.ts')).toBe(false)
  })

  it('recognizes platform manifests', () => {
    expect(isPlatformManifest('packages/css-engine/npm/darwin-arm64/package.json')).toBe(true)
    expect(platformManifestFamily('packages/css-engine/npm/darwin-arm64/package.json')).toBe('cli')
    expect(isPlatformManifest(HOST_MANIFEST)).toBe(false)
    expect(isPlatformManifest('packages/css-engine/npm/darwin-arm64/sub/package.json')).toBe(false)
  })

  it('FAILS when Rust source changed but no platform package bumped', () => {
    // The exact shape of #714 — ast.rs gained a field, no platform bump.
    const result = checkBump([
      'packages/css-engine/crates/aihu-css-core/src/ast.rs',
      'packages/css-engine/src/index.ts',
    ])
    expect(result.ok).toBe(false)
    expect(result.sharedChanged).toContain('packages/css-engine/crates/aihu-css-core/src/ast.rs')
    expect(result.requiredFamilies).toEqual(['cli'])
    expect(result.missing).toEqual(fullBump())
  })

  it('FAILS when a recipes/*.css file changed but no platform package bumped', () => {
    const result = checkBump([
      'packages/css-engine/crates/aihu-css-core/recipes/btn.css',
      'packages/css-engine/src/index.ts',
    ])
    expect(result.ok).toBe(false)
    expect(result.sharedChanged).toContain(
      'packages/css-engine/crates/aihu-css-core/recipes/btn.css',
    )
    expect(result.missing).toEqual(fullBump())
  })

  it('FAILS on a partial bump that misses one platform', () => {
    const all = manifests()
    const dropped = all[all.length - 1]
    const result = checkBump(fullBump().filter((f) => f !== dropped))
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual([dropped])
    for (const m of all.filter((n) => n !== dropped)) {
      expect(result.missing).not.toContain(m)
    }
  })

  it('FAILS when the family bumps but the host optionalDependencies are not repointed', () => {
    const result = checkBump([
      'packages/css-engine/crates/aihu-css-core/src/ast.rs',
      ...manifests(),
    ])
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual([HOST_MANIFEST])
  })

  it('FAILS on a lone platform manifest touch even with no Rust change', () => {
    const result = checkBump([manifests()[0], HOST_MANIFEST])
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(manifests().slice(1))
  })

  it('passes on a complete bump plus the host pin', () => {
    const result = checkBump(['packages/css-engine/crates/aihu-css-core/src/ast.rs', ...fullBump()])
    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.message).toBe('ok')
  })

  it('passes on a pure, complete platform bump with no Rust change (the ship-only PR)', () => {
    expect(checkBump(fullBump()).ok).toBe(true)
  })

  it('passes when nothing css-engine-related changed', () => {
    expect(checkBump(['packages/signals/src/index.ts', 'README.md']).ok).toBe(true)
  })

  it('does not fire on JS-glue or test changes alone', () => {
    expect(checkBump(['packages/css-engine/src/index.ts']).ok).toBe(true)
    expect(checkBump(['packages/css-engine/crates/aihu-css-core/tests/emit.rs']).ok).toBe(true)
  })
})
