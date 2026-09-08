/**
 * `@aihu/app` is the first likely package to move after the framework kernel.
 * Its browser bootstrap must consume the runtime's explicit app bridge, not
 * the runtime source tree or the broader runtime barrel.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP_SRC = join(process.cwd(), 'packages/app/src')
const APP_PACKAGE = JSON.parse(
  readFileSync(join(process.cwd(), 'packages/app/package.json'), 'utf8'),
) as { name: string }

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = join(dir, entry.name)
    return entry.isDirectory() ? sourceFiles(file) : file.endsWith('.ts') ? [file] : []
  })
}

describe(`${APP_PACKAGE.name} ↔ @aihu/runtime boundary`, () => {
  it('uses only the explicit runtime app bridge from app source', () => {
    const imports = sourceFiles(APP_SRC).flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return [...source.matchAll(/from\s+['"](@aihu\/runtime(?:\/[^'"]*)?)['"]/g)].map((match) => ({
        file,
        specifier: match[1],
      }))
    })

    expect(imports).toEqual([
      expect.objectContaining({
        specifier: '@aihu/runtime/app',
      }),
    ])
  })

  it('does not reach into the runtime source tree', () => {
    const offenders = sourceFiles(APP_SRC).filter((file) =>
      /(?:from\s+|import\(\s*)['"](?:\.\.\/)+runtime\/src\//.test(readFileSync(file, 'utf8')),
    )

    expect(offenders).toEqual([])
  })
})
