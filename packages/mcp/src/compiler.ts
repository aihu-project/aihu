/**
 * Compiler invocation and error parsing for aihu_validate.
 *
 * Shells out to aihu-compile --machine-errors using execFileSync (stdin piping).
 * Returns structured ValidateResult — either compiled TS on success or
 * an array of AihuDiagnostic objects on failure, with errors and warnings split.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, resolve } from 'node:path'

const require = createRequire(import.meta.url)

export function resolveBinPath(
  env: Readonly<Record<string, string | undefined>> = process.env,
  resolvePaths: (specifier: string) => readonly string[] | null = (specifier) =>
    require.resolve.paths(specifier),
  pathExists: (path: string) => boolean = existsSync,
): string {
  if (env.AIHU_COMPILE_BIN) {
    return env.AIHU_COMPILE_BIN
  }

  for (const nodeModulesPath of resolvePaths('@aihu/compiler') ?? []) {
    const candidate = resolve(nodeModulesPath, '@aihu/compiler/bin/aihu-compile.mjs')
    if (pathExists(candidate)) return candidate
  }

  return 'aihu-compile'
}

const binPath = resolveBinPath()

const TIMEOUT_MS = parseInt(process.env.AIHU_MCP_COMPILE_TIMEOUT_MS ?? '10000', 10)

export interface AihuDiagnostic {
  code: string
  message: string
  line: number
  col: number
}

export interface ValidateResult {
  ok: boolean
  errors: AihuDiagnostic[]
  warnings: AihuDiagnostic[]
  output?: string
}

/**
 * Normalize a raw diagnostic from --machine-errors JSON into { code, message, line, col }.
 * Handles both { line, col } and { from: { line, character } } shapes.
 */
function normalizeDiagnostic(raw: unknown): AihuDiagnostic {
  if (typeof raw !== 'object' || raw === null) {
    return { code: 'UNKNOWN', message: String(raw), line: 0, col: 0 }
  }
  const r = raw as Record<string, unknown>
  const code = typeof r.code === 'string' ? r.code : 'UNKNOWN'
  const message = typeof r.message === 'string' ? r.message : ''
  let line = 0
  let col = 0
  if (typeof r.line === 'number') {
    line = r.line
    col = typeof r.col === 'number' ? r.col : 0
  } else if (typeof r.from === 'object' && r.from !== null) {
    const from = r.from as Record<string, unknown>
    line = typeof from.line === 'number' ? from.line : 0
    col = typeof from.character === 'number' ? from.character : 0
  }
  return { code, message, line, col }
}

/**
 * Compile a .aihu source string and return structured results.
 *
 * On success (exit 0): returns { ok: true, errors: [], warnings: [], output: string }
 * On failure (exit 1): returns { ok: false, errors: AihuDiagnostic[], warnings: AihuDiagnostic[] }
 * On non-JSON stderr: wraps in a synthetic UNKNOWN diagnostic
 * On timeout: returns a synthetic TIMEOUT diagnostic
 */
export function compileSource(source: string, filename: string): ValidateResult {
  const stem = basename(filename, '.aihu')

  try {
    const stdout = execFileSync(
      binPath,
      ['--stdin', '--tag', stem, '--path', filename, '--machine-errors'],
      { input: source, encoding: 'utf8', timeout: TIMEOUT_MS },
    )
    return { ok: true, errors: [], warnings: [], output: stdout }
  } catch (err: unknown) {
    const e = err as { stderr?: string | Buffer; killed?: boolean; signal?: string }

    if (e.killed === true || (typeof e.signal === 'string' && e.signal !== null)) {
      return {
        ok: false,
        errors: [
          { code: 'TIMEOUT', message: `Compiler timed out after ${TIMEOUT_MS}ms`, line: 0, col: 0 },
        ],
        warnings: [],
      }
    }

    const rawStderr = e.stderr
    const stderr =
      rawStderr instanceof Buffer
        ? rawStderr.toString('utf-8')
        : typeof rawStderr === 'string'
          ? rawStderr
          : ''

    try {
      const parsed: unknown = JSON.parse(stderr)
      if (Array.isArray(parsed)) {
        const errors = parsed
          .filter((d) => (d as Record<string, unknown>).severity !== 'warning')
          .map(normalizeDiagnostic)
        const warnings = parsed
          .filter((d) => (d as Record<string, unknown>).severity === 'warning')
          .map(normalizeDiagnostic)
        return { ok: false, errors, warnings }
      }
    } catch {
      // not JSON
    }

    return {
      ok: false,
      errors: [
        {
          code: 'UNKNOWN',
          message: stderr.trim() || 'Compilation failed (no stderr)',
          line: 0,
          col: 0,
        },
      ],
      warnings: [],
    }
  }
}
