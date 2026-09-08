import { describe, expect, it } from 'vitest'
import { pairedDeclarationTarget } from '../apps/docs/scripts/gen-api-targets.ts'

describe('API entry target selection', () => {
  it('prefers a paired declaration over runtime JavaScript', () => {
    const targets = new Set(['./dist/index.d.ts', './dist/index.js'])
    expect(pairedDeclarationTarget('./dist/index.js', targets)).toBe('./dist/index.d.ts')
  })

  it('keeps an unpaired JavaScript target available', () => {
    expect(pairedDeclarationTarget('./dist/index.js', new Set(['./dist/index.js']))).toBeUndefined()
    expect(pairedDeclarationTarget('./src/index.ts', new Set(['./src/index.ts']))).toBeUndefined()
  })
})
