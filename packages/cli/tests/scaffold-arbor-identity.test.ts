import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { agentPackageJson } from '../src/templates-agent.ts'
import { fullPackageJson } from '../src/templates-full.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const agentServer = JSON.parse(
  readFileSync(join(repoRoot, 'packages/agent-server/package.json'), 'utf8'),
) as {
  version: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

describe('scaffold Arbor type identity', () => {
  for (const [template, emit] of [
    ['agent', agentPackageJson],
    ['full', fullPackageJson],
  ] as const) {
    it(`${template} selects the peer-based agent-server release`, () => {
      const scaffold = JSON.parse(emit('identity-test', 'npm')) as {
        dependencies: Record<string, string>
      }
      const deps = scaffold.dependencies

      expect(deps['@aihu/agent-server']).toBe(`^${agentServer.version}`)
      expect(agentServer.dependencies?.['@aihu/arbor']).toBeUndefined()
      expect(agentServer.peerDependencies?.['@aihu/arbor']).toBe(deps['@aihu/arbor'])
    })
  }
})
