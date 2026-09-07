#!/usr/bin/env bun
/**
 * check:emit-parses — assert every fixture component compiles to VALID JS.
 *
 * The compiler test suites assert that emitted output *contains* expected
 * substrings. Nothing asserted that the output parses. That gap let five
 * separate invalid-output bugs ship simultaneously — including one on
 * `cookbook/agent-weather.aihu`, a documented exemplar for the agent feature:
 *
 *   - async `$action` handlers  → `function name(async ())`
 *   - block-bodied `$computed`  → `computed(() => if (x) return y)`
 *   - block-bodied `$resource`  → same, plus a dropped `async`
 *   - `$form`                   → leaked into the body as `let value: () => value,`
 *   - destructured `$each`      → `([name) => name`
 *
 * Every one produced output that parsed as nothing while the compiler reported
 * success. This script compiles each fixture and parses the result; a single
 * run caught all five.
 *
 * Two failure stages are reported separately:
 *   `compile` — the .aihu itself no longer compiles (stale v1 syntax)
 *   `parse`   — it compiled, but the emitted JS is not valid
 *
 * Wired into CI (`plan-a.yml`) with `--expect-compile 0 --expect-parse 0` so
 * it ratchets: as of #425 (examples migrated to v2) the baseline is
 * 0 compile / 0 parse failures across every cookbook + examples component.
 * Run manually: `bun run check:emit-parses`
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { Glob } from 'bun'
import { resolvePublishedCompilerBinary } from './lib/compiler-binary.ts'

const ROOT = join(import.meta.dir, '..')

/**
 * The root repository exercises the published compiler, exactly as an Aihu
 * application does. Compiler-source checks live in aihu-compiler.
 */
function resolveCompiler(): string {
  try {
    return resolvePublishedCompilerBinary()
  } catch (error) {
    console.error(`check:emit-parses — ${(error as Error).message}`)
    process.exit(1)
  }
}

const compiler = resolveCompiler()

// Bun's built-in transpiler, not esbuild: esbuild is only a transitive dep here
// (via vite), and its platform-binary path differs between bun's .bun store and
// a CI npm install. Bun.Transpiler needs no dependency and no path resolution,
// and it throws on exactly the syntax errors this guards against — verified
// against all five shapes it was written for.
const transpiler = new Bun.Transpiler({ loader: 'ts' })

const files: string[] = []
for (const pattern of ['cookbook/*.aihu', 'examples/**/*.aihu']) {
  for (const m of new Glob(pattern).scanSync(ROOT)) files.push(m)
}
files.sort()

if (files.length === 0) {
  console.error('check:emit-parses — no .aihu fixtures found; refusing to pass vacuously.')
  process.exit(1)
}

const failures: Array<{ file: string; stage: string; detail: string }> = []

/**
 * The define-name this file is actually registered under, mirroring the Vite
 * plugin (`packages/compiler/js/index.ts`: `_isLayoutFile` / `_layoutTag`).
 *
 * A layout SFC never registers under its bare stem — `src/layouts/app.aihu`
 * is registered as `aihu-layout-app`, because `app` has no hyphen and could
 * not register at all. Passing the bare stem here would ask the compiler to
 * emit `defineElement('app', …)`, which is now a hard C450 error: this gate
 * would fail on a file that is perfectly correct in a real build.
 */
function defineTagFor(rel: string): string {
  const stem = basename(rel, '.aihu')
  return /(^|\/)layouts\//.test(rel) ? `aihu-layout-${stem.toLowerCase()}` : stem
}

for (const rel of files) {
  const abs = join(ROOT, rel)
  const tag = defineTagFor(rel)
  const source = readFileSync(abs, 'utf8')

  let emitted: string
  try {
    emitted = execFileSync(compiler, ['--stdin', '--tag', tag, '--path', abs], {
      input: source,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (e) {
    const err = e as { stderr?: string; message: string }
    failures.push({ file: rel, stage: 'compile', detail: (err.stderr || err.message).trim() })
    continue
  }

  // The compiler emits TypeScript, so parse with the ts loader — the same
  // shape the Vite plugin hands to transformWithEsbuild.
  try {
    transpiler.transformSync(emitted)
  } catch (e) {
    const err = e as { message: string }
    failures.push({ file: rel, stage: 'parse', detail: err.message.trim() })
  }
}

// ─── Per-stage gating ────────────────────────────────────────────────────────
//
// The two stages are different defects with different owners, and collapsing
// them into one exit code hid that. `compile` failures are stale v1 fixture
// syntax (a migration backlog, CO3); `parse` failures are live compiler bugs
// emitting invalid JS. A single count cannot ratchet them independently — a
// fixture migration would mask a new emitter bug, which is exactly the kind of
// silent offset this slice exists to prevent.
//
// `--expect-parse <N>` / `--expect-compile <N>` gate each stage on its own
// committed number, exiting 0 iff BOTH match. Passing neither preserves the
// original behavior exactly: any failure at all is exit 1.
function numericFlag(name: string): number | null {
  const i = process.argv.indexOf(name)
  if (i === -1) return null
  const n = Number(process.argv[i + 1])
  if (!Number.isInteger(n) || n < 0) {
    console.error(
      `check:emit-parses — ${name} requires a non-negative integer, got "${process.argv[i + 1]}"`,
    )
    process.exit(1)
  }
  return n
}

const expectParse = numericFlag('--expect-parse')
const expectCompile = numericFlag('--expect-compile')
const gated = expectParse !== null || expectCompile !== null

const parseFailures = failures.filter((f) => f.stage === 'parse')
const compileFailures = failures.filter((f) => f.stage === 'compile')

if (failures.length > 0) {
  console.error(
    `\ncheck:emit-parses — ${failures.length}/${files.length} component(s) failed ` +
      `(${compileFailures.length} compile, ${parseFailures.length} parse):\n`,
  )
  for (const f of failures) {
    console.error(`── ${f.file}  (${f.stage})`)
    console.error(`${f.detail}\n`)
  }
}

if (!gated) {
  // Unchanged default: any failure is a failure.
  if (failures.length > 0) process.exit(1)
  console.log(`check:emit-parses — ${files.length} components emit parseable JS.`)
  process.exit(0)
}

// Gated mode. A stage with no flag is held at zero rather than ignored:
// gating one stage must not silently un-gate the other.
const wantParse = expectParse ?? 0
const wantCompile = expectCompile ?? 0
const mismatches: string[] = []

for (const [stage, got, want] of [
  ['parse', parseFailures.length, wantParse],
  ['compile', compileFailures.length, wantCompile],
] as const) {
  if (got === want) continue
  mismatches.push(
    got < want
      ? `${stage}: expected ${want}, found ${got} — ${want - got} defect(s) appear to have been ` +
          'FIXED. Decrement the baseline in the same PR as the fix.'
      : `${stage}: expected ${want}, found ${got} — ${got - want} NEW failure(s). Fix the ` +
          'source, not the baseline.',
  )
}

if (mismatches.length > 0) {
  console.error('check:emit-parses — stage counts do not match the committed baseline:')
  for (const m of mismatches) console.error(`  ${m}`)
  process.exit(1)
}

console.log(
  `check:emit-parses — ${files.length} components scanned; ${compileFailures.length} compile / ` +
    `${parseFailures.length} parse failure(s), matching the committed baseline. ` +
    'The failures are the ratchet, not a pass.',
)
