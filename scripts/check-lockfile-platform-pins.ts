#!/usr/bin/env bun
/**
 * CI guard: every platform pin must be RESOLVED in `bun.lock`.
 *
 * Step 1 of docs/plans/2026-08-10-platforms-before-pins.md, landed first and
 * on purpose: it is the failing test the ordering fix has to turn green.
 *
 * ── THE STATE THIS CATCHES ───────────────────────────────────────────────────
 *
 * Bun cannot resolve an `optionalDependency` that is not published, so it
 * silently OMITS it from the lockfile rather than failing. Under lockstep a
 * release writes pins naming a version that does not exist yet, so this is
 * exactly what happens on every Version PR:
 *
 *   pins say 1.3.1  ->  1.3.1 unpublished  ->  bun drops all ten entries
 *                                              -> lock and manifests disagree
 *
 * The disagreement is invisible until the versions publish, at which point
 * every `bun install --frozen-lockfile` wants to add them back and is refused.
 * That took `main` red for every PR twice — #783 (v0.4.62) and #794 (v0.4.64) —
 * and both times the only symptom was a confusing frozen-lockfile error in an
 * unrelated job.
 *
 * ── WHY IT IS GREEN TODAY, AND WHY THAT IS CORRECT ───────────────────────────
 *
 * Right now all 18 pins resolve, because v0.4.64 published them and #794
 * refreshed the lock. A guard that only fires in a transient state is still
 * worth having: this is precisely the guard that would have caught the window
 * between #791 and #794 at the PR that opened it, instead of at a stranger's
 * unrelated CI run hours later.
 *
 * It goes red the moment a Version PR bumps the pins ahead of the registry —
 * which is the current, unfixed behaviour. When the platforms-before-pins
 * change lands, it stays green through the Version PR too, and THAT is the
 * signal the fix worked.
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────────
 *
 * Checks the two native hosts still released by this repository. Compiler
 * platform pins are released from aihu-compiler and are intentionally outside
 * this check.
 *
 * Usage:
 *   bun scripts/check-lockfile-platform-pins.ts
 *   LOCKFILE_PINS_ROOT=/tmp/fixture bun scripts/check-lockfile-platform-pins.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.LOCKFILE_PINS_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..')

const HOSTS = ['css-engine', 'server']

const lockPath = join(ROOT, 'bun.lock')
if (!existsSync(lockPath)) {
  console.error(`✗ no bun.lock at ${lockPath}`)
  process.exit(1)
}
const lock = readFileSync(lockPath, 'utf8')

interface Missing {
  host: string
  name: string
  version: string
}

const missing: Missing[] = []
let checked = 0

for (const host of HOSTS) {
  const manifestPath = join(ROOT, 'packages', host, 'package.json')
  if (!existsSync(manifestPath)) continue
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    optionalDependencies?: Record<string, string>
  }
  for (const [name, version] of Object.entries(manifest.optionalDependencies ?? {})) {
    checked++
    // bun.lock keys resolved packages as `"<name>@<version>"`. Matching the
    // exact pair is the point: a lock entry at a DIFFERENT version is just as
    // broken as a missing one, and a bare name match would hide that.
    if (!lock.includes(`"${name}@${version}"`)) missing.push({ host, name, version })
  }
}

if (missing.length > 0) {
  console.error(`\n✗ ${missing.length} of ${checked} platform pins are not resolved in bun.lock:\n`)
  for (const m of missing) {
    console.error(`  packages/${m.host}  ${m.name}@${m.version}`)
  }
  console.error(
    '\nBun omits an optionalDependency it cannot resolve, so this almost always means the\n' +
      'pinned version is NOT PUBLISHED yet. Left alone it becomes a frozen-lockfile failure\n' +
      'for every PR the moment those versions publish (see #783, #794).\n\n' +
      'If the versions ARE published, the lock is merely stale — run `bun install` and commit.\n' +
      'If they are not, the pins moved ahead of the registry: that is the ordering defect\n' +
      'docs/plans/2026-08-10-platforms-before-pins.md exists to remove.\n',
  )
  process.exit(1)
}

console.log(`✔ all ${checked} platform pins resolve in bun.lock`)
