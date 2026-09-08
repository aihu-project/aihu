import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { transform } from '@aihu/compiler'
import { describe, expect, it } from 'vitest'

describe('published compiler boundary', () => {
  it('resolves the released compiler instead of packages/compiler source', () => {
    const packageJson = join(process.cwd(), 'node_modules/@aihu/compiler/package.json')
    const packagePath = realpathSync(packageJson)
    const manifest = JSON.parse(readFileSync(packageJson, 'utf8')) as { version: string }

    expect(packagePath).not.toContain('/packages/compiler/')
    expect(manifest.version).toBe('1.3.3')
  })

  it('compiles a component through the released platform binary', () => {
    const { code } = transform('@template { <p>registry proof</p> }', 'registry-proof.aihu')

    expect(code).toContain('registry proof')
  })
})
