/**
 * The CLI is extracted independently from the monorepo. It may consume the
 * public `@aihu/ui/registry` contract, but it must never reach into the UI
 * package's source tree through a relative import.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('@aihu/cli ↔ @aihu/ui boundary', () => {
  it('does not import UI types through the monorepo source tree', () => {
    const files = [
      ...collectTypeScriptFiles(join(__dirname, '..', 'src')),
      ...collectTypeScriptFiles(__dirname),
    ]
    const relativeUiSourceImport = /(?:\.\.\/)+ui\/src\//
    const offenders = files.filter((file) =>
      relativeUiSourceImport.test(readFileSync(file, 'utf8')),
    )

    expect(offenders).toEqual([])
  })

  it('uses the public UI registry contract', () => {
    const source = readFileSync(`${__dirname}/../src/registry-resolve.ts`, 'utf8')
    expect(source).toContain("from '@aihu/ui/registry'")
  })
})

function collectTypeScriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? collectTypeScriptFiles(path) : path.endsWith('.ts') ? [path] : []
  })
}
