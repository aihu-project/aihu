import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { appPackageJson } from '../src/index.ts'
import { agentPackageJson } from '../src/templates-agent.ts'
import { ssrPackageJson } from '../src/templates-ssr.ts'

/**
 * C-FEL-SCAFFOLD-PM-COMPAT — the scaffold must declare the TRANSITIVE PEER
 * CLOSURE of what it lists, not one package's peer list.
 *
 * `@aihu/app`, `@aihu/runtime` and `@aihu/arbor` each declare **zero** runtime
 * `dependencies` and express every edge as a `peerDependency`. Nothing installs
 * a peer on the consumer's behalf except the package manager, and only some of
 * them do it: npm 7+, pnpm and bun auto-install peers; **yarn 1 does not**. So
 * an omission here is invisible on three of four package managers and fatal on
 * the fourth — which is exactly how it reached main twice.
 *
 * This test walks the real workspace manifests rather than hardcoding a list,
 * so adding a peer to any of those packages fails HERE — at `bun run test`, in
 * seconds — instead of thirty minutes later in one yarn cell of the scaffold
 * matrix, or not at all until a user hits it.
 *
 * Two rounds of this defect were found one layer apart and each time the fix
 * merely relocated the error message:
 *   run 30322552896  yarn build → Cannot find package '@aihu/store'
 *   run 30333109465  yarn build → failed to resolve import "@aihu/context"
 *                                 from @aihu/runtime
 * Hence a closure, not another name.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function manifestFor(pkg: string):
  | {
      peerDependencies?: Record<string, string>
      peerDependenciesMeta?: Record<string, { optional?: boolean }>
    }
  | undefined {
  // `@aihu/foo` → packages/foo. Only first-party packages participate in the
  // closure; anything else (vite, typescript) is a leaf we do not walk into.
  const m = /^@aihu\/(.+)$/.exec(pkg)
  if (!m) return undefined
  try {
    return JSON.parse(readFileSync(join(repoRoot, 'packages', m[1]!, 'package.json'), 'utf8'))
  } catch {
    return undefined
  }
}

/** Every required first-party peer reachable from `roots`, including the roots' own. */
function peerClosure(roots: readonly string[]): Set<string> {
  const seen = new Set<string>()
  const out = new Set<string>()
  const queue = [...roots]
  while (queue.length > 0) {
    const pkg = queue.pop()!
    if (seen.has(pkg)) continue
    seen.add(pkg)
    const manifest = manifestFor(pkg)
    for (const peer of Object.keys(manifest?.peerDependencies ?? {})) {
      if (manifest?.peerDependenciesMeta?.[peer]?.optional) continue
      out.add(peer)
      queue.push(peer)
    }
  }
  return out
}

/**
 * EVERY package.json a scaffold can emit, not just the one that happened to be
 * broken first.
 *
 * The first version of this guard checked `appPackageJson` alone and passed
 * while `full` and `agent` were still shipping the identical defect — those two
 * templates share `agentPackageJson`, a second emitter the test never looked at
 * (run 30333950275: minimal/docs × yarn went fully green, full/agent × yarn
 * still failed on `@aihu/context`). A guard that covers one of two emitters is
 * worse than none, because it reads as coverage.
 */
const EMITTERS: ReadonlyArray<[string, () => string]> = [
  ['appPackageJson', () => appPackageJson('demo', 'bun', false)],
  ['appPackageJson (css-engine)', () => appPackageJson('demo', 'bun', true)],
  ['agentPackageJson', () => agentPackageJson('demo', 'bun')],
  ['ssrPackageJson', () => ssrPackageJson('demo', 'bun', false)],
  ['ssrPackageJson (css-engine)', () => ssrPackageJson('demo', 'bun', true)],
]

describe('scaffold declares the transitive peer closure', () => {
  for (const [label, emit] of EMITTERS) {
    it(`covers every required first-party peer — ${label}`, () => {
      const pkg = JSON.parse(emit())
      const declared = new Set([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ])

      // Walk from what the scaffold itself lists — so a package added to the
      // scaffold later drags its own peers into the requirement automatically.
      const required = peerClosure([...declared])

      const missing = [...required]
        .filter((p) => p.startsWith('@aihu/'))
        .filter((p) => !declared.has(p))
        .sort()

      expect(
        missing,
        `undeclared peers reachable from the scaffold: ${missing.join(', ')}`,
      ).toEqual([])
    })
  }

  it('actually has a closure to check — guards against a vacuous pass', () => {
    // If the walk ever returns nothing (a rename, a moved package dir, a
    // manifest read that silently throws) the assertion above would pass while
    // checking nothing at all. Pin the two edges this contract was built on.
    const closure = peerClosure(['@aihu/app'])
    expect(closure.has('@aihu/store')).toBe(true) // direct peer of @aihu/app
    expect(closure.has('@aihu/context')).toBe(true) // reached only via @aihu/runtime
  })
})
