import { describe, expect, it } from 'vitest'
import { shouldReuseCssEnginePlatformVersion } from '../scripts/css-engine-platform-reuse.ts'

describe('css-engine platform version reuse', () => {
  it('reuses the highest published version when its native source matches', () => {
    expect(shouldReuseCssEnginePlatformVersion('tree-hash', 'tree-hash')).toBe(true)
  })

  it('bumps when the published source differs', () => {
    expect(shouldReuseCssEnginePlatformVersion('current-hash', 'published-hash')).toBe(false)
  })

  it('bumps when the published version has no native source field', () => {
    expect(shouldReuseCssEnginePlatformVersion('current-hash', undefined)).toBe(false)
    expect(shouldReuseCssEnginePlatformVersion('current-hash', '')).toBe(false)
  })
})
