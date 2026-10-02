// @vitest-environment node
/** Regression coverage for the 2026-W40 dependency and workflow security sweep. */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = new URL('..', import.meta.url).pathname
const dependencySections = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const

type PackageManifest = Partial<
  Record<(typeof dependencySections)[number], Record<string, string>>
> & {
  overrides?: Record<string, string>
}

function packageManifests(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'repos') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...packageManifests(path))
    else if (entry.name === 'package.json') found.push(path)
  }
  return found
}

const expectedPins: Record<string, string> = {
  'actions/checkout': '3d3c42e5aac5ba805825da76410c181273ba90b1 # v7',
  'oven-sh/setup-bun': '0c5077e51419868618aeaa5fe8019c62421857d6 # v2',
  'moonrepo/setup-toolchain': '261c62cb5b0f580c7be7c8cd0f023a2e96756095 # v0',
  'actions/upload-artifact': '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7',
  'actions/setup-node': '820762786026740c76f36085b0efc47a31fe5020 # v7',
  'dorny/paths-filter': 'ceb8a2b8f2d89434be7ff52d3de7ec3738c5cc9d # v4',
  'actions/download-artifact': '3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8',
  'Swatinem/rust-cache': '6323deb102c322ba6fcbdcafc7e3dddab59af2b6 # v2',
  'cloudflare/wrangler-action': '953926a2e2182532811c01a25e53647d93bf07c0 # v4',
  'actions/create-github-app-token': 'bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3',
  'actions/labeler': 'bf12e9b00b37c5c0ca2b87b79b2daf7891dbda13 # v7',
  'actions/github-script': '3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9',
  'chromaui/action': 'c93e0bc3a63aa176e14a75b61a31847cbfdd341c # v1',
}

describe('2026-W40 security sweep', () => {
  it('overrides the critical example-only shell-quote chain to its patched version', () => {
    const rootManifest = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    ) as PackageManifest
    expect(rootManifest.overrides?.['shell-quote']).toBe('1.8.4')
  })

  it('keeps every declared Vitest package at the patched 4.1.11 line', () => {
    const manifests = packageManifests(root)
    let declarations = 0

    for (const path of manifests) {
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
      for (const section of dependencySections) {
        for (const [name, range] of Object.entries(manifest[section] ?? {})) {
          if (name !== 'vitest' && !name.startsWith('@vitest/')) continue
          declarations += 1
          expect(range, `${path}: ${section}.${name}`).toBe('^4.1.11')
        }
      }
    }

    expect(declarations).toBeGreaterThan(0)
  })

  it('pins every external workflow action to a commit SHA and retains requested tags', () => {
    const workflowDirectory = join(root, '.github/workflows')
    const files = readdirSync(workflowDirectory).filter((file) => file.endsWith('.yml'))
    const seen = new Set<string>()
    let externalActions = 0

    for (const file of files) {
      const source = readFileSync(join(workflowDirectory, file), 'utf8')
      for (const line of source.split('\n')) {
        const uses = line.match(/^\s*(?:-\s*)?uses:\s*(\S+)/)?.[1]
        if (!uses || uses.startsWith('./')) continue
        externalActions += 1

        const at = uses.lastIndexOf('@')
        expect(at, `${file}: ${line.trim()}`).toBeGreaterThan(0)
        expect(uses.slice(at + 1), `${file}: ${line.trim()}`).toMatch(/^[0-9a-f]{40}$/)

        const action = uses.slice(0, at)
        if (expectedPins[action]) {
          expect(line.trim(), `${file}: ${action}`).toContain(
            `uses: ${action}@${expectedPins[action]}`,
          )
          seen.add(action)
        }
      }
    }

    expect(externalActions).toBeGreaterThan(0)
    expect(seen).toEqual(new Set(Object.keys(expectedPins)))
  })
})
