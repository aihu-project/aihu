#!/usr/bin/env bun
/**
 * Version PR body: the newest CHANGELOG section of every package the version
 * step changed, the way changesets/action wrote it. Reviewers read this list
 * to catch an unintended major (a 0.x peer range forcing a dependent to bump)
 * before merging, so the body must name every package and version.
 *
 * Usage: bun scripts/release-pr-body.ts [base-ref]   (default: HEAD)
 * Reads `git diff --name-only <base-ref>` for changed CHANGELOG.md files.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const INTRO =
  'Automated Changesets Version PR. Platform binaries publish before their exact pins are committed.'

/** The first `## <version>` section of a CHANGELOG, without its heading. */
export function newestSection(changelog: string): { version: string; body: string } | null {
  const lines = changelog.split('\n')
  const start = lines.findIndex((l) => /^## \S/.test(l))
  if (start === -1) return null
  const end = lines.findIndex((l, i) => i > start && /^## \S/.test(l))
  const version = (lines[start] ?? '').slice(3).trim()
  const body = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim()
  return { version, body }
}

export function renderBody(
  entries: ReadonlyArray<{ name: string; version: string; body: string }>,
): string {
  const sections = [...entries]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => `## ${e.name}@${e.version}\n\n${e.body}`.trim())
  return [INTRO, ...sections].join('\n\n')
}

function main(): void {
  const base = process.argv[2] ?? 'HEAD'
  const changed = execFileSync('git', ['diff', '--name-only', base], { encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.endsWith('/CHANGELOG.md'))
  const entries = []
  for (const file of changed) {
    const dir = file.slice(0, -'/CHANGELOG.md'.length)
    const name = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')).name as string
    const section = newestSection(readFileSync(file, 'utf8'))
    if (section) entries.push({ name, ...section })
  }
  process.stdout.write(`${renderBody(entries)}\n`)
}

if (import.meta.main) main()
