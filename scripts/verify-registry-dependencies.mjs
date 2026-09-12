#!/usr/bin/env node
/**
 * Refuse to publish a package until each already-external Aihu dependency can
 * be resolved from npm. Workspace dependencies are released in this script's
 * explicit topological order and are rewritten while packing; registry ranges
 * are a contract with a package released by another repository or an earlier
 * package in the release train.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const packageDir = process.argv[2]
if (!packageDir) {
  console.error('Usage: node scripts/verify-registry-dependencies.mjs <package-directory>')
  process.exit(2)
}

const manifestPath = resolve(packageDir, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const dependencyGroups = [
  ['dependencies', manifest.dependencies],
  ['optionalDependencies', manifest.optionalDependencies],
  ['peerDependencies', manifest.peerDependencies],
]
const internal = new Map()

for (const [group, dependencies] of dependencyGroups) {
  for (const [name, range] of Object.entries(dependencies ?? {})) {
    if (!name.startsWith('@aihu/') && !name.startsWith('@aihu-plugin/')) continue
    if (range.startsWith('workspace:') || range.startsWith('file:') || range.startsWith('link:'))
      continue
    internal.set(name, { group, range })
  }
}

// A dependency published moments earlier in the same release train is often
// not resolvable yet: npm accepts the publish before `npm view` can see it
// ("may take a few minutes to become available"). Failing on the first miss
// aborted v0.4.65 at create-aihu, seconds after @aihu/cli published. So wait
// for visibility, and only fail once the whole window has been used.
const attempts = Math.max(1, Number(process.env.VERIFY_REGISTRY_ATTEMPTS ?? 12))
const delayMs = Math.max(0, Number(process.env.VERIFY_REGISTRY_DELAY_MS ?? 15_000))

/** One `npm view`: `{ version }` when it resolves, else `{ reason }`. */
function query(spec) {
  try {
    const version = execFileSync('npm', ['view', spec, 'version', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    return !version || version === 'null' ? { reason: 'unpublished' } : { version }
  } catch (error) {
    const stderr = String(error.stderr ?? '')
    return {
      reason: /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET/.test(stderr)
        ? 'unreachable'
        : 'unpublished',
    }
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

for (const [name, { group, range }] of internal) {
  const spec = `${name}@${range}`
  let result = query(spec)
  for (let attempt = 1; !result.version && attempt < attempts; attempt++) {
    const what = result.reason === 'unreachable' ? 'npm unreachable for' : 'not visible on npm yet'
    console.error(
      `… ${manifest.name}: ${spec} ${what} (attempt ${attempt}/${attempts}); retrying in ${Math.round(delayMs / 1000)}s`,
    )
    sleep(delayMs)
    result = query(spec)
  }
  if (!result.version) {
    if (result.reason === 'unreachable') {
      console.error(`✗ ${manifest.name}: could not query npm for ${spec}.`)
      console.error(
        '  The registry must be reachable before a release can verify its dependency contract.',
      )
    } else {
      console.error(`✗ ${manifest.name}: ${group} ${spec} is not published on npm.`)
      console.error(
        '  Release its source package first, confirm the version is visible, then retry this dependent.',
      )
    }
    process.exit(1)
  }
  console.log(`✓ ${manifest.name}: ${name}@${range} resolves in npm (${result.version})`)
}
