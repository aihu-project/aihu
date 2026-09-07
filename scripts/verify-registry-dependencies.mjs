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

for (const [name, { group, range }] of internal) {
  const spec = `${name}@${range}`
  let version = ''
  try {
    version = execFileSync('npm', ['view', spec, 'version', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    const stderr = String(error.stderr ?? '')
    if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET/.test(stderr)) {
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
  if (!version || version === 'null') {
    console.error(`✗ ${manifest.name}: ${group} ${spec} is not published on npm.`)
    console.error(
      '  Release its source package first, confirm the version is visible, then retry this dependent.',
    )
    process.exit(1)
  }
  console.log(`✓ ${manifest.name}: ${name}@${range} resolves in npm (${version})`)
}
