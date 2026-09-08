import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * Coverage for scripts/stamp-platform-versions.ts.
 *
 * The script it replaced (`stamp-platform-snapshot.ts`) had NO test file at
 * all, which is how it kept a canary-only guard that nobody could safely
 * generalize — there was no way to show a change preserved its behaviour.
 *
 * Driven as a subprocess against a fixture tree via `PLATFORM_SYNC_ROOT`
 * rather than by importing functions, because the failure modes worth pinning
 * are the process-level ones: which exit code, and whether it WROTE. A unit
 * test of an exported helper cannot catch "--check quietly rewrote the tree",
 * which is the single worst thing this script could do.
 */

const SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'stamp-platform-versions.ts',
)

let root: string

/** Minimal but structurally faithful: a host with a native platform surface. */
function fixture(hostVersion: string, pinVersion: string, platVersion: string): void {
  const platforms = ['darwin-arm64', 'linux-x64-gnu']
  const optionalDependencies: Record<string, string> = {}
  for (const p of platforms) {
    optionalDependencies[`@aihu/server-${p}`] = pinVersion
  }
  const hostDir = join(root, 'packages', 'server')
  mkdirSync(hostDir, { recursive: true })
  writeFileSync(
    join(hostDir, 'package.json'),
    `${JSON.stringify({ name: '@aihu/server', version: hostVersion, optionalDependencies }, null, 2)}\n`,
  )
  for (const [dir, prefix] of [['npm', '@aihu/server-']] as const) {
    for (const p of platforms) {
      const d = join(hostDir, dir, p)
      mkdirSync(d, { recursive: true })
      writeFileSync(
        join(d, 'package.json'),
        `${JSON.stringify({ name: `${prefix}${p}`, version: platVersion }, null, 2)}\n`,
      )
    }
  }
}

function run(...args: string[]): { code: number; out: string } {
  const r = spawnSync('bun', [SCRIPT, '--host', 'server', ...args], {
    encoding: 'utf8',
    env: { ...process.env, PLATFORM_SYNC_ROOT: root },
  })
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` }
}

const hostPkg = () => JSON.parse(readFileSync(join(root, 'packages/server/package.json'), 'utf8'))
const platPkg = (dir: string, p: string) =>
  JSON.parse(readFileSync(join(root, 'packages/server', dir, p, 'package.json'), 'utf8'))

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aihu-platsync-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('stamp-platform-versions · --check', () => {
  it('passes when every platform version and pin equals the host version', () => {
    fixture('1.3.0', '1.3.0', '1.3.0')
    const { code, out } = run('--check')
    expect(code, out).toBe(0)
  })

  it('fails when a platform manifest lags the host', () => {
    fixture('1.3.0', '1.3.0', '0.1.54')
    const { code, out } = run('--check')
    expect(code).toBe(1)
    expect(out).toContain('is at 0.1.54, expected 1.3.0')
  })

  it('fails when a PIN lags, even though the manifests are correct', () => {
    // The hole the old hand-bump gate could not see: it counted edited files,
    // never compared a pin to a manifest.
    fixture('1.3.0', '0.1.54', '1.3.0')
    const { code, out } = run('--check')
    expect(code).toBe(1)
    expect(out).toContain('expected 1.3.0')
  })

  it('fails when a pin names a platform package with no directory', () => {
    fixture('1.3.0', '1.3.0', '1.3.0')
    const pkg = hostPkg()
    pkg.optionalDependencies['@aihu/server-solaris-sparc'] = '1.3.0'
    writeFileSync(join(root, 'packages/server/package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
    const { code, out } = run('--check')
    expect(code).toBe(1)
    expect(out).toContain('no platform directory produces that package')
  })

  it('NEVER writes — a verify run must not mutate the tree', () => {
    fixture('1.3.0', '0.1.54', '0.1.54')
    const before = readFileSync(join(root, 'packages/server/npm/darwin-arm64/package.json'), 'utf8')
    run('--check')
    const after = readFileSync(join(root, 'packages/server/npm/darwin-arm64/package.json'), 'utf8')
    expect(after).toBe(before)
  })
})

describe('stamp-platform-versions · write mode', () => {
  it('stamps every manifest and repoints every pin to the host version', () => {
    fixture('1.3.0', '0.1.54', '0.1.54')
    const { code, out } = run()
    expect(code, out).toBe(0)
    expect(platPkg('npm', 'darwin-arm64').version).toBe('1.3.0')
    for (const v of Object.values(hostPkg().optionalDependencies as Record<string, string>)) {
      expect(v).toBe('1.3.0')
    }
  })

  it('is idempotent, and leaves --check green afterwards', () => {
    fixture('1.3.0', '0.1.54', '0.1.54')
    run()
    const first = readFileSync(join(root, 'packages/server/package.json'), 'utf8')
    run()
    expect(readFileSync(join(root, 'packages/server/package.json'), 'utf8')).toBe(first)
    expect(run('--check').code).toBe(0)
  })
})

describe('stamp-platform-versions · --require-snapshot', () => {
  // This guard is the canary safety net: without it, a canary whose
  // `changeset version --snapshot` silently failed would stamp platform
  // packages at the STABLE version and publish them to the canary dist-tag.
  it('rejects a stable host version', () => {
    fixture('1.3.0', '1.3.0', '1.3.0')
    const { code, out } = run('--require-snapshot')
    expect(code).toBe(1)
    expect(out).toContain('not a 0.0.0-* snapshot')
  })

  it('accepts a snapshot host version and stamps it through', () => {
    fixture('0.0.0-canary-abc1234', '0.1.54', '0.1.54')
    const { code, out } = run('--require-snapshot')
    expect(code, out).toBe(0)
    expect(platPkg('npm', 'darwin-arm64').version).toBe('0.0.0-canary-abc1234')
  })

  it('is OPT-IN — a stable version is fine without the flag', () => {
    // The inversion that makes release-time stamping possible at all.
    fixture('1.3.0', '0.1.54', '0.1.54')
    expect(run().code).toBe(0)
  })
})

describe('stamp-platform-versions · --host', () => {
  it('rejects an unknown host instead of silently checking nothing', () => {
    // A typo that matched zero hosts would report success having verified
    // nothing — a green run with no coverage is worse than a red one.
    fixture('1.3.0', '1.3.0', '1.3.0')
    const r = spawnSync('bun', [SCRIPT, '--check', '--host', 'complier'], {
      encoding: 'utf8',
      env: { ...process.env, PLATFORM_SYNC_ROOT: root },
    })
    expect(r.status).toBe(1)
    expect(`${r.stdout}${r.stderr}`).toContain('unknown --host')
  })
})
