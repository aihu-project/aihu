/**
 * skills/aihu/check-samples.ts — compile-verify every code sample in the skill.
 *
 * Contract:
 *   - every ```aihu fence in skills/aihu/**\/*.md MUST compile (exit 0)
 *   - every ```aihu-error fence MUST fail to compile (exit != 0) — these are
 *     the deliberate wrong-code teaching samples
 *
 * A skill that teaches syntax that does not compile is worse than no skill;
 * this script is the mechanical gate that keeps the skill honest against the
 * compiler in this checkout.
 *
 * Compiler resolution: $AIHU_COMPILE_BIN, else the published @aihu/compiler
 * package. Compiler source now has its own repository and release checks.
 *
 * Run: bun skills/aihu/check-samples.ts
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolvePublishedCompilerBinary } from '../../scripts/lib/compiler-binary.ts'

const skillDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(skillDir, '..', '..')

const bin = process.env.AIHU_COMPILE_BIN ?? resolvePublishedCompilerBinary()

if (!bin || !existsSync(bin)) {
  console.error(
    'ERROR: no published @aihu/compiler binary. Reinstall dependencies or set AIHU_COMPILE_BIN.',
  )
  process.exit(1)
}

/** Recursively collect .md files under a directory. */
function mdFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...mdFiles(p))
    else if (name.endsWith('.md')) out.push(p)
  }
  return out
}

/** Extract fenced blocks whose info string starts with `lang`. Supports an
 *  optional `path=...` attribute (e.g. ```aihu path=src/pages/index.aihu). */
function fences(src: string, lang: string): { code: string; path: string; line: number }[] {
  const out: { code: string; path: string; line: number }[] = []
  const lines = src.split('\n')
  let i = 0
  while (i < lines.length) {
    const m = lines[i].match(/^```(\S+)(?:\s+path=(\S+))?\s*$/)
    if (m && m[1] === lang) {
      const start = i + 1
      let j = start
      while (j < lines.length && !lines[j].startsWith('```')) j++
      out.push({
        code: lines.slice(start, j).join('\n'),
        path: m[2] ?? 'src/components/skill-sample.aihu',
        line: start + 1,
      })
      i = j + 1
    } else {
      i++
    }
  }
  return out
}

function compile(code: string, virtualPath: string): { ok: boolean; stderr: string } {
  const stem = virtualPath
    .split('/')
    .pop()!
    .replace(/\.aihu$/, '')
  const tag = stem.includes('-') ? stem : `${stem}-el`
  const r = spawnSync(bin!, ['--stdin', '--tag', tag, '--path', virtualPath], {
    input: code,
    encoding: 'utf8',
  })
  return { ok: r.status === 0, stderr: r.stderr ?? '' }
}

let pass = 0
let fail = 0

for (const file of mdFiles(skillDir)) {
  const src = readFileSync(file, 'utf8')
  const rel = file.slice(repoRoot.length + 1)

  for (const f of fences(src, 'aihu')) {
    const r = compile(f.code, f.path)
    if (r.ok) {
      console.log(`PASS  ${rel}:${f.line} (compiles)`)
      pass++
    } else {
      console.error(`FAIL  ${rel}:${f.line} — sample marked \`\`\`aihu does NOT compile:`)
      console.error(r.stderr.split('\n').slice(0, 6).join('\n'))
      fail++
    }
  }

  for (const f of fences(src, 'aihu-error')) {
    const r = compile(f.code, f.path)
    if (!r.ok) {
      console.log(`PASS  ${rel}:${f.line} (errors as documented)`)
      pass++
    } else {
      console.error(
        `FAIL  ${rel}:${f.line} — sample marked \`\`\`aihu-error unexpectedly COMPILES; the documented error is stale`,
      )
      fail++
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed (compiler: ${bin})`)

// FLOOR ASSERTION — a gate that checks nothing must not report success.
//
// Without this, the script exits 0 when it finds ZERO fences: `fail` is 0, so
// `fail > 0` is false. Rename the info strings (```aihu -> ```aihu title="x"),
// move the files, or relocate the directory, and it prints "0 passed, 0 failed"
// and exits green while verifying nothing at all.
//
// That is the failure this repo keeps producing: an absent value rendered as a
// real one. A dead binding published as `28.63 ns`. An unbuilt dist recorded as
// `_no dist_`. A js-framework-benchmark run over an empty framework list — all
// `0.00 ms`, still "successful". A gate silently measuring nothing belongs on
// that list, and would be a particularly bad entry: this is the check that
// keeps the agent-facing syntax documentation honest.
//
// Raise MIN_SAMPLES when adding samples. Lowering it is a decision, not a
// convenience — it means fewer of the agent's instructions are proven to
// compile. Fix discovery instead.
const MIN_SAMPLES = 11
const total = pass + fail
if (total < MIN_SAMPLES) {
  console.error(
    `\nFAIL  floor assertion: found ${total} sample(s), expected at least ${MIN_SAMPLES}.\n` +
      `      The fences were not found where this script looks — renamed info string,\n` +
      `      moved file, or relocated directory. This does NOT mean the samples pass;\n` +
      `      it means they were never checked. Fix discovery, do not lower the floor.`,
  )
  process.exit(1)
}

process.exit(fail > 0 ? 1 : 0)
