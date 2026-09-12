/**
 * `scripts/verify-registry-dependencies.mjs` runs inside `publish-all.sh`
 * right after earlier packages in the same release train were published. npm
 * accepts a publish before `npm view` can resolve it, so the check has to wait
 * for visibility instead of failing on the first miss. v0.4.65 aborted at
 * `create-aihu` because `@aihu/cli@^1.3.1` had been published seconds earlier.
 *
 * A fake `npm` on PATH stands in for the registry.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve(__dirname, '../scripts/verify-registry-dependencies.mjs')

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/**
 * A package that depends on `@aihu/dep@^1.2.3` (a registry range the script
 * must verify) and `@aihu/ws@workspace:*` (which it must skip), plus a fake
 * `npm` that reports "not published" for the first `failTimes` queries.
 */
function fixture(failTimes: number) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-registry-'))
  dirs.push(dir)
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: '@aihu/fixture',
      version: '0.0.1',
      dependencies: { '@aihu/dep': '^1.2.3', '@aihu/ws': 'workspace:*' },
    }),
  )
  const calls = join(dir, 'npm-calls.log')
  const npm = join(dir, 'npm')
  writeFileSync(
    npm,
    `#!/bin/sh
echo "$*" >> "${calls}"
n=$(wc -l < "${calls}" | tr -d ' ')
if [ "$n" -le ${failTimes} ]; then
  echo "npm error code E404" >&2
  exit 1
fi
echo '"1.2.3"'
`,
  )
  chmodSync(npm, 0o755)
  const run = (attempts: number) =>
    spawnSync(process.execPath, [SCRIPT, dir], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        VERIFY_REGISTRY_ATTEMPTS: String(attempts),
        VERIFY_REGISTRY_DELAY_MS: '1',
      },
    })
  const queries = () => readFileSync(calls, 'utf8').split('\n').filter(Boolean)
  return { run, queries }
}

describe.skipIf(process.platform === 'win32')('verify-registry-dependencies', () => {
  it('waits for a dependency published moments earlier to become visible', () => {
    const { run, queries } = fixture(2)
    const result = run(5)
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('not visible on npm yet (attempt 1/5)')
    expect(result.stdout).toContain('✓ @aihu/fixture: @aihu/dep@^1.2.3 resolves in npm ("1.2.3")')
    expect(queries()).toHaveLength(3)
  })

  it('still fails, with the original message, once every attempt misses', () => {
    const { run, queries } = fixture(99)
    const result = run(3)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '✗ @aihu/fixture: dependencies @aihu/dep@^1.2.3 is not published on npm.',
    )
    expect(queries()).toHaveLength(3)
  })

  it('never queries workspace dependencies', () => {
    const { run, queries } = fixture(0)
    expect(run(3).status).toBe(0)
    expect(queries().some((q) => q.includes('@aihu/ws'))).toBe(false)
  })
})
