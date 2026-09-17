import { execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileToAst } from '@aihu/compiler'

export {
  DARK_SELECTOR,
  defineStylePack,
  type StylePack,
  type StylePackInput,
  type TokenMap,
} from './define-style-pack.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Platform support matrix
// ---------------------------------------------------------------------------
//
// Maps process.platform + process.arch to the per-platform npm package that
// ships the prebuilt `aihu-css-compile` executable, plus the binary's filename
// inside that package. Mirrors @aihu/server/src/native.ts detectPlatform() and
// the package directory names under packages/css-engine/npm/<platform>/.
//
// Unlike @aihu/server (a napi `.node` addon loaded via require), the css engine
// invokes `aihu-css-compile` as a CLI SUBPROCESS (execFileSync against the
// executable on disk). So the platform package exposes a raw executable file,
// and we resolve its absolute PATH — we never `require()` the binary itself.

interface PlatformDescriptor {
  readonly platformId: string
  readonly packageName: string
  /** Executable filename inside the platform package. */
  readonly binFile: string
}

function detectPlatform(): PlatformDescriptor | null {
  if (typeof process === 'undefined' || !process.platform || !process.arch) {
    return null
  }
  const key = `${process.platform}-${process.arch}`
  switch (key) {
    case 'darwin-arm64':
      return {
        platformId: 'darwin-arm64',
        packageName: '@aihu/css-engine-darwin-arm64',
        binFile: 'aihu-css-compile',
      }
    case 'darwin-x64':
      return {
        platformId: 'darwin-x64',
        packageName: '@aihu/css-engine-darwin-x64',
        binFile: 'aihu-css-compile',
      }
    case 'linux-x64':
      // We only ship glibc; musl users fall through to the dev/source path.
      return {
        platformId: 'linux-x64-gnu',
        packageName: '@aihu/css-engine-linux-x64-gnu',
        binFile: 'aihu-css-compile',
      }
    case 'win32-x64':
      return {
        platformId: 'win32-x64-msvc',
        packageName: '@aihu/css-engine-win32-x64-msvc',
        binFile: 'aihu-css-compile.exe',
      }
    default:
      return null
  }
}

let _binPath: string | null = null

/**
 * Whether `candidate` is a usable `aihu-css-compile` executable — NOT merely a
 * present file.
 *
 * The per-platform packages (`@aihu/css-engine-<platform>`) carry a placeholder
 * `aihu-css-compile` in source; the real prebuilt binary is only injected by
 * the release CI. Once those packages become resolvable in the workspace (e.g.
 * after a `bun.lock` refresh that pins them as optionalDependencies), a bare
 * `existsSync` would happily return the non-executable placeholder, which then
 * blows up with EACCES inside `spawnSync`/`execFileSync`. So we must verify the
 * candidate is actually runnable before accepting it.
 *
 * POSIX: require the execute bit (X_OK). A zero-byte/text placeholder without
 * +x fails here and we fall through to the dev `target/` fallback.
 *
 * Windows: there is no execute bit — `accessSync(_, X_OK)` is effectively
 * always true — so we additionally require a non-empty regular file, which
 * still rejects a zero-byte placeholder.
 */
export function isUsableExecutable(candidate: string): boolean {
  try {
    const st = statSync(candidate)
    if (!st.isFile() || st.size === 0) return false
    accessSync(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve the absolute path to the `aihu-css-compile` executable.
 *
 * Resolution order:
 *   1. `AIHU_CSS_COMPILE_BIN` env var override, if set — mirrors
 *      `@aihu/compiler`'s `AIHU_COMPILE_BIN` idiom. Lets a caller that already
 *      knows the exact binary it wants (a test harness, another package
 *      pinning its own build) skip resolution entirely.
 *   2. Dev fallback: the monorepo workspace `target/release|debug/` — only
 *      present in a dev clone with a Rust toolchain (`cargo build --release -p
 *      aihu-css-core`). Checked BEFORE the published package: `target/` is a
 *      path relative to this file inside THIS git checkout, so a real
 *      standalone npm consumer's `node_modules/@aihu/css-engine` never has it
 *      — this ordering only ever matters inside the monorepo, where it fixes
 *      a real trap: a stale/out-of-sync per-platform npm package sitting in
 *      `node_modules` would otherwise silently outrank a freshly-built dev
 *      binary, so `cargo build` + a test run would keep exercising old
 *      compiled behavior. (Same failure shape as the compiler's own binary-
 *      resolution trap — see `docs/plans/*-compiler-binary-resolution*`.)
 *   3. The per-platform optionalDependency package
 *      (`@aihu/css-engine-<platform>`) shipped to npm consumers — resolved via
 *      `createRequire(...).resolve('<pkg>/package.json')` so it works in both
 *      ESM and CJS and respects the consumer's node_modules layout.
 *
 * If the current platform is SUPPORTED but neither path yields a binary, throws
 * a structured error pointing at the missing optionalDependency (mirrors
 * @aihu/server's failure-loud contract). If the platform is UNSUPPORTED, the
 * error lists the dev fallback so source builds still have a clear remedy.
 */
function resolveBinary(): string {
  if (_binPath !== null) return _binPath

  // 1. Explicit override.
  const override = process.env.AIHU_CSS_COMPILE_BIN
  if (override && isUsableExecutable(override)) {
    _binPath = override
    return _binPath
  }

  const descriptor = detectPlatform()

  // 2. Dev fallback: monorepo workspace target/. Only exists in a dev clone.
  const ext = process.platform === 'win32' ? '.exe' : ''
  const devCandidates = [
    resolve(__dirname, '../../../target/release', `aihu-css-compile${ext}`),
    resolve(__dirname, '../../../target/debug', `aihu-css-compile${ext}`),
  ]
  for (const c of devCandidates) {
    if (existsSync(c)) {
      _binPath = c
      return _binPath
    }
  }

  // 3. Per-platform optionalDependency package (the published-consumer path).
  //
  // Accept the candidate ONLY if it is a usable executable. A present-but-
  // non-executable placeholder (the in-source stub that becomes resolvable once
  // the per-platform packages are pinned in the lockfile) must NOT be returned —
  // doing so spawns a non-executable file and fails with EACCES. In that case we
  // deliberately fall through to the missing-binary error below.
  if (descriptor) {
    const requireFn = createRequire(import.meta.url)
    try {
      const pkgJson = requireFn.resolve(`${descriptor.packageName}/package.json`)
      const candidate = join(dirname(pkgJson), descriptor.binFile)
      if (isUsableExecutable(candidate)) {
        _binPath = candidate
        return _binPath
      }
    } catch {
      // Package not installed (optionalDependency skipped for this platform, or
      // a partial install).
    }
  }

  throw buildMissingBinaryError(descriptor, devCandidates)
}

function buildMissingBinaryError(
  descriptor: PlatformDescriptor | null,
  devCandidates: string[],
): Error {
  if (descriptor === null) {
    return new Error(
      `[@aihu/css-engine] No prebuilt aihu-css-compile binary for this platform.\n\n` +
        `  Platform:        ${typeof process !== 'undefined' ? `${process.platform}-${process.arch}` : 'unknown'}\n\n` +
        `  @aihu/css-engine ships prebuilt binaries for darwin-arm64, darwin-x64,\n` +
        `  linux-x64-gnu (glibc) and win32-x64-msvc. Your platform is not in that set.\n\n` +
        `  To build from source you need a Rust toolchain, then run from the repo root:\n` +
        `    cargo build --release -p aihu-css-core\n\n` +
        `  Checked dev fallback paths: ${devCandidates.join(', ')}`,
    )
  }
  return new Error(
    `[@aihu/css-engine] Native CSS compiler binary not found for this platform.\n\n` +
      `  Platform:         ${descriptor.platformId}\n` +
      `  Expected package: ${descriptor.packageName}\n` +
      `  Expected file:    ${descriptor.packageName}/${descriptor.binFile}\n\n` +
      `  This binary is distributed as an optionalDependency of @aihu/css-engine.\n` +
      `  Your package manager may have skipped it (optionalDependencies are\n` +
      `  silently dropped on install failure).\n\n` +
      `  To reinstall:\n` +
      `    npm install @aihu/css-engine\n` +
      `    # or: pnpm install   or: bun install\n\n` +
      `  If you are working in the aihu monorepo, build from source instead:\n` +
      `    cargo build --release -p aihu-css-core\n` +
      `  Checked dev fallback paths: ${devCandidates.join(', ')}`,
  )
}

/**
 * Compile a list of utility class names to CSS.
 *
 * Plan 1 bootstrap — supports a hardcoded subset; see crates/aihu-css-core/src/tokens.rs.
 * Plan 2 wires the AST scanner so callers pass `.aihu` SFC ASTs instead of raw class lists.
 *
 * @param classes - utility class names like `['bg-primary', 'p-4']`
 * @returns CSS string with one rule per known class
 */
// ---------------------------------------------------------------------------
// Spawn bounds — why this call is not allowed to be unbounded
// ---------------------------------------------------------------------------
//
// OBSERVED FAILURE (2026-08-07, macOS 26.5 / node 22.12, reproduced under load):
// an `apps/docs` vite build sat for 10 minutes at 0.0% CPU. `ps` showed the
// build and a child `aihu-css-compile --ast-json` both asleep, neither making
// progress. Reproduced in a stress harness and sampled both sides:
//
//   child  : read (libsystem_kernel) — parked in io::stdin().read_to_string(),
//            waiting for an EOF on stdin that never arrives.
//   parent : node::SyncProcessRunner::TryInitializeAndRunLoop -> uv_run ->
//            uv__io_poll -> kevent — parked in spawnSync's own private uv loop,
//            still holding the stdin pipe's WRITE end open (confirmed via
//            `lsof -U`: the peer of the child's fd 0 was the parent and nothing
//            else, so this is not an fd-inheritance leak).
//
// So the stall is on the parent side: spawnSync's loop never delivers the
// writable event that would finish `input` and close the write end, and the
// child blocks in read() forever. With no timer armed, `uv__io_poll` calls
// kevent with NO deadline — which is precisely why it hangs for days rather
// than minutes. Passing `timeout` arms a uv timer in that same loop, which
// gives kevent a deadline, so the loop always wakes and kills the child.
// Verified: the same harness that hung indefinitely without `timeout` was
// rescued at iteration 94 with ETIMEDOUT after 5002 ms once `timeout` was set.
//
// This is intermittent and load-dependent — it is not a pipe-buffer capacity
// problem (20 MB of stdin against 200 KB each of stdout+stderr round-trips
// cleanly on both node and bun).

/**
 * Wall-clock ceiling for a single `aihu-css-compile` invocation — a measured
 * floor plus a payload-scaled term, NOT a round number.
 *
 * The floor. Measured on this machine: the largest SFC in `apps/docs` (16 KB
 * source -> 27.7 KB AST JSON -> 7 KB CSS) compiles in 4-5 ms, and 24 concurrent
 * processes x 60 compiles each never exceeded 5 ms per call. 120 s is ~24,000x
 * the measured per-call cost. That headroom is deliberately absurd: it has to
 * absorb a loaded CI runner, a cold first exec paying macOS code-signature
 * validation, and a machine thrashing swap — because a timeout that trips a
 * legitimately slow build turns a rare hang into routine CI flake, which is
 * strictly worse than the bug. 120 s is also short enough that a human watching
 * a build notices, which is the whole point: today's hang produced no output for
 * 10 minutes, and two sibling children survived 2.5 days unnoticed.
 *
 * The scaled term. A flat bound is the wrong shape if some future payload is
 * enormous, so the ceiling also grows at 2 ms per KB of stdin — about 370x
 * slower than the measured 5.4 MB/s throughput. Below ~60 MB of stdin the floor
 * dominates (nothing in this repo comes within three orders of magnitude of
 * that), so in practice the bound IS 120 s today; the scaling only takes over in
 * the regime where a fixed bound could genuinely be too tight.
 *
 * `AIHU_CSS_COMPILE_TIMEOUT_MS` replaces the FLOOR, not the scaling.
 */
const COMPILE_TIMEOUT_FLOOR_MS = 120_000

/** See COMPILE_TIMEOUT_FLOOR_MS — ~370x slower than measured throughput. */
const COMPILE_TIMEOUT_MS_PER_KB = 2

/**
 * Explicit stdout+stderr cap. Node's default `maxBuffer` is 1 MiB, which is a
 * latent failure of its own: a large `compile(classes)` call can emit more CSS
 * than that and would die with an opaque `spawnSync ... ENOBUFS`. 64 MiB is far
 * above any plausible stylesheet while still bounding parent memory — the value
 * is deliberate rather than inherited.
 */
const COMPILE_MAX_BUFFER = 64 * 1024 * 1024

function compileTimeoutMs(inputBytes: number): number {
  const scaled = Math.ceil(inputBytes / 1024) * COMPILE_TIMEOUT_MS_PER_KB
  const raw = process.env.AIHU_CSS_COMPILE_TIMEOUT_MS
  if (raw !== undefined && raw !== '') {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) return Math.max(n, scaled)
  }
  return Math.max(COMPILE_TIMEOUT_FLOOR_MS, scaled)
}

/**
 * Spawn the native compiler, returning stdout on success. On a non-zero exit
 * (the binary's R-RESULT error path) throw an `Error` carrying the binary's
 * stderr message rather than letting `execFileSync`'s opaque status error
 * surface. stderr is PIPED (not inherited) so the message lands in the thrown
 * error instead of the parent's console.
 *
 * The spawn is BOUNDED: `timeout` (see `DEFAULT_COMPILE_TIMEOUT_MS`) and an
 * explicit `maxBuffer`. `killSignal: 'SIGKILL'` because the whole point is that
 * nothing survives — a SIGTERM-ignoring or already-wedged child is exactly the
 * process that was found still alive 2.5 days later.
 */
function runBinary(bin: string, args: string[], input: string): string {
  const timeoutMs = compileTimeoutMs(input.length)
  const startedAt = Date.now()
  try {
    return execFileSync(bin, args, {
      input,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
      maxBuffer: COMPILE_MAX_BUFFER,
      killSignal: 'SIGKILL',
    })
  } catch (err) {
    const e = err as { code?: string; stderr?: Buffer | string; message?: string }
    const elapsedMs = Date.now() - startedAt
    const where =
      `  binary:   ${bin}\n` +
      `  args:     ${args.length > 0 ? args.join(' ') : '(none)'}\n` +
      `  stdin:    ${input.length} bytes\n` +
      `  elapsed:  ${elapsedMs} ms`

    if (e.code === 'ETIMEDOUT') {
      throw new Error(
        `[@aihu/css-engine] CSS compile TIMED OUT after ${timeoutMs} ms and the child was killed.\n\n` +
          `${where}\n\n` +
          `  This is the known spawn stall, not a slow compile: the compiler normally\n` +
          `  finishes in single-digit milliseconds. The child parks in read() waiting for\n` +
          `  an EOF on stdin that the parent's spawnSync loop never delivers, so without\n` +
          `  this timeout the build would hang at 0% CPU indefinitely.\n\n` +
          `  What to do next:\n` +
          `    - Re-run the build. The stall is intermittent and load-dependent; a retry\n` +
          `      normally succeeds.\n` +
          `    - If it reproduces every time, the binary itself is likely wedged. Check it\n` +
          `      directly:  ${bin} --help\n` +
          `      and rebuild it:  cargo build --release -p aihu-css-core\n` +
          `    - If a payload genuinely needs longer than ${timeoutMs} ms, raise the bound\n` +
          `      with AIHU_CSS_COMPILE_TIMEOUT_MS=<milliseconds>. Do not remove it.`,
      )
    }

    if (e.code === 'ENOBUFS') {
      throw new Error(
        `[@aihu/css-engine] CSS compile produced more than the ${COMPILE_MAX_BUFFER} byte\n` +
          `  stdout/stderr limit and the child was killed.\n\n` +
          `${where}\n\n` +
          `  A stylesheet this large almost certainly means the input is wrong (an\n` +
          `  unbounded generated class list, or a non-AST payload sent to --ast-json)\n` +
          `  rather than a real page. Check what is being passed in before raising the cap.`,
      )
    }

    const stderr =
      typeof e.stderr === 'string'
        ? e.stderr
        : e.stderr instanceof Buffer
          ? e.stderr.toString('utf-8')
          : ''
    const detail = stderr.trim() || e.message || 'unknown error'
    throw new Error(`[@aihu/css-engine] CSS compile failed: ${detail}\n\n${where}`)
  }
}

export function compile(classes: string[]): string {
  if (classes.length === 0) return ''

  const bin = resolveBinary()
  const input = classes.join('\n')
  return runBinary(bin, [], input)
}

/**
 * Compile a `.aihu` SFC source string to scoped, shadow-DOM-embedded CSS.
 *
 * Pipeline (Plan 2 Task 9): `compileToAst(source)` (from `@aihu/compiler`)
 * → AST JSON → `aihu-css-compile --ast-json` → scoped CSS. The output is the
 * per-SFC stylesheet the compiler folds into the component's shadow `<style>`:
 * `:host`-level theme tokens, variant-resolved utility rules, and the folded
 * authored `@style` block. There is NO global utility stylesheet.
 *
 * @param source - the `.aihu` SFC source text
 * @param id - optional file path/id (used to derive the tag stem + `@route` checks)
 * @param lightScopeId - the compiler-assigned `data-a` scope id (light-DOM leaf
 *   flip prep, LDF §10 step 1), only when the compiler resolved this SFC to
 *   `shadowMode: 'light'`. Injected onto the AST payload before it crosses the
 *   `--ast-json` boundary; not yet consumed by the CSS engine (step 3 does
 *   that) — passing it today is inert plumbing.
 * @param options - project-level theme inputs, see {@link CompileSfcOptions}
 * @returns the scoped CSS string for the SFC
 */
export function compileSfc(
  source: string,
  id?: string,
  lightScopeId?: string,
  options?: CompileSfcOptions,
): string {
  const ast = compileToAst(source, id)
  const payload = {
    ...ast,
    ...(lightScopeId !== undefined ? { lightScopeId } : {}),
    ...(options?.theme !== undefined ? { theme: options.theme } : {}),
    ...(options?.hostTokens !== undefined ? { hostTokens: options.hostTokens } : {}),
  }
  const bin = resolveBinary()
  return runBinary(bin, ['--ast-json'], JSON.stringify(payload))
}

/** Project-level inputs to {@link compileSfc}, shared by every SFC in a build. */
export interface CompileSfcOptions {
  /**
   * Project theme: CSS containing `@theme { … }` blocks, or a bare
   * `--name: value;` declaration list. Replaces the built-in default token
   * values. They still compile to `var(--name, <value>)` fallbacks, so a theme
   * the component inherits from the document wins; an SFC's own `@theme`
   * block overrides both.
   */
  theme?: string
  /**
   * `false` drops the default-value fallbacks, so token references compile to
   * bare `var(--name)`. For apps that always load their tokens at `:root`.
   * Tokens an SFC's own `@theme` sets are still declared. Default `true`.
   */
  hostTokens?: boolean
}
