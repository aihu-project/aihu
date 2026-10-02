import { describe, expect, it } from 'vitest'
import {
  checkBump,
  isCssCoreRustSource,
  isPlatformManifest,
  isVersionPr,
} from '../scripts/check-css-engine-binary-bump.ts'

const native = 'packages/css-engine/crates/aihu-css-core/src/ast.rs'
const changeset = '.changeset/native-css.md'
const validChangeset = {
  [changeset]: '---\n"@aihu/css-engine": patch\n---\nRefresh native CSS compiler.',
}

describe('css-engine binary bump guard', () => {
  it('recognizes Rust, build.rs, and included recipe source', () => {
    expect(isCssCoreRustSource(native)).toBe(true)
    expect(isCssCoreRustSource('packages/css-engine/crates/aihu-css-core/build.rs')).toBe(true)
    expect(isCssCoreRustSource('packages/css-engine/crates/aihu-css-core/recipes/btn.css')).toBe(
      true,
    )
    expect(isCssCoreRustSource('packages/css-engine/crates/aihu-css-core/tests/emit.rs')).toBe(
      false,
    )
  })

  it('passes native-only changes with a css-engine patch changeset', () => {
    expect(checkBump([native, changeset], validChangeset).ok).toBe(true)
  })

  it('fails native source changes without a css-engine changeset', () => {
    const result = checkBump([native])
    expect(result.ok).toBe(false)
    expect(result.message).toContain('no changeset for @aihu/css-engine')
  })

  it('requires a patch changeset, not a changeset for another package or bump level', () => {
    expect(
      checkBump([native, changeset], { [changeset]: '---\n"@aihu/css-engine": minor\n---\n' }).ok,
    ).toBe(false)
    expect(
      checkBump([native, changeset], { [changeset]: '---\n"@aihu/server": patch\n---\n' }).ok,
    ).toBe(false)
  })

  it('rejects platform manifest edits in feature PRs', () => {
    const manifest = 'packages/css-engine/npm/darwin-arm64/package.json'
    expect(isPlatformManifest(manifest)).toBe(true)
    expect(checkBump([manifest]).ok).toBe(false)
  })

  it('rejects host pin edits in feature PRs', () => {
    expect(checkBump(['packages/css-engine/package.json'], {}, false, true).ok).toBe(false)
  })

  it('allows generated platform manifest edits in the Changesets Version PR', () => {
    expect(isVersionPr('changeset-release/main')).toBe(true)
    expect(checkBump(['packages/css-engine/npm/darwin-arm64/package.json'], {}, true).ok).toBe(true)
  })

  it('passes unrelated and JS glue changes', () => {
    expect(
      checkBump(['packages/css-engine/src/index.ts', 'packages/signals/src/index.ts']).ok,
    ).toBe(true)
  })
})
