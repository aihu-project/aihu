/**
 * packages/language-server/src/core/diagnostics.ts
 *
 * Async wrapper around the aihu-compile Rust binary with --machine-errors support.
 * Invoked by the LSP server on every textDocument/didOpen and textDocument/didChange.
 *
 * NOTE: Uses node:child_process execFile (not exec) with argv arrays — safe from
 * shell injection. The LSP server process runs out-of-process for editor isolation.
 *
 * This module is editor-agnostic: it returns plain `AihuDiagnostic` records with
 * 0-based LSP positions. The transport/connection layer (src/server.ts) maps these
 * onto protocol `Diagnostic` objects. Keeping the parse logic here is the clean
 * seam for a future `@volar/language-core` virtual-code adoption (arch-4 §2.7).
 */
import { resolveCompilerBinary } from '@aihu/compiler'
import { type ExecFileOptionsWithStringEncoding, execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// execFile honours an `input` option at runtime (written to the child's stdin)
// but the typed overloads omit it. Extend the string-encoding options type so
// the call site stays type-safe while feeding source on stdin.
type ExecFileStdinOptions = ExecFileOptionsWithStringEncoding & { input: string }

const binPath = resolveCompilerBinary()

/**
 * The raw JSON shape emitted by the Rust binary with --machine-errors.
 * range uses 1-based lines (Rust internal) and 0-based cols.
 */
interface RawMachineError {
  code: string
  message: string
  hint?: string
  fix?: string
  /** Original text token (string) NOT an LSP Position */
  from: string | null
  /** Replacement text (string) NOT an LSP Position */
  to: string | null
  /** { line, col, end_line, end_col } — 1-based line, 0-based col from Rust */
  range: { line: number; col: number; end_line: number; end_col: number } | null
}

/** Normalised diagnostic with 0-based LSP positions. */
export interface AihuDiagnostic {
  code: string
  message: string
  // `| undefined` is explicit so the raw compiler error's optional hint/fix
  // (which may be undefined) assign cleanly under exactOptionalPropertyTypes.
  hint?: string | undefined
  fix?: string | undefined
  /** Original source text to replace (for code-action text edits). */
  fromText: string | null
  /** Replacement text (for code-action text edits). */
  toText: string | null
  /** 0-based LSP range. null when position is unknown. */
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  } | null
}

function toAihuDiagnostic(raw: RawMachineError): AihuDiagnostic {
  let lspRange: AihuDiagnostic['range'] = null
  if (raw.range && raw.range.line > 0) {
    // Rust uses 1-based lines; convert to 0-based for LSP.
    const startLine = raw.range.line - 1
    const endLine = raw.range.end_line - 1
    lspRange = {
      start: { line: startLine, character: raw.range.col },
      end: { line: endLine, character: raw.range.end_col },
    }
  }
  return {
    code: raw.code,
    message: raw.message,
    hint: raw.hint,
    fix: raw.fix,
    fromText: raw.from ?? null,
    toText: raw.to ?? null,
    range: lspRange,
  }
}

/**
 * Fallback: parse a plain-text compiler error into a synthetic diagnostic.
 * Used when the binary does not emit JSON (very old binary or stdin parse error).
 * TODO: remove when --machine-errors covers all error paths.
 */
function parsePlainError(stderr: string, _filePath: string): AihuDiagnostic {
  const m = /\b(\d+):\s*(.+)/.exec(stderr)
  const line = m ? Math.max(0, Number.parseInt(m[1]!, 10) - 1) : 0
  const message = m ? m[2]! : stderr.trim() || 'Unknown compiler error'
  return {
    code: 'C000',
    message,
    fromText: null,
    toText: null,
    range: {
      start: { line, character: 0 },
      end: { line, character: 0 },
    },
  }
}

export interface CompileResult {
  code: string | null
  diagnostics: AihuDiagnostic[]
}

/**
 * Parse the Rust binary's `--machine-errors` stderr stream into structured
 * diagnostics. Each JSON line is one error; non-JSON lines are skipped. When no
 * JSON is present at all, falls back to a single synthetic plain-text diagnostic.
 *
 * Pure function — no I/O. Exposed so editors/tests can exercise the mapping
 * without spawning the compiler.
 */
export function parseMachineErrors(stderr: string, filePath: string): AihuDiagnostic[] {
  const diagnostics: AihuDiagnostic[] = []
  let jsonParsed = false
  for (const line of stderr.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed?.startsWith('{')) continue
    try {
      const raw = JSON.parse(trimmed) as RawMachineError
      diagnostics.push(toAihuDiagnostic(raw))
      jsonParsed = true
    } catch {
      // not a JSON line — skip
    }
  }
  if (!jsonParsed) {
    diagnostics.push(parsePlainError(stderr, filePath))
  }
  return diagnostics
}

/**
 * Compile a .aihu source string via stdin, returning structured diagnostics.
 */
export async function compileWithDiagnostics(
  source: string,
  filePath: string,
): Promise<CompileResult> {
  const stem =
    filePath
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      ?.replace(/\.aihu$/, '') ?? 'component'

  try {
    const options: ExecFileStdinOptions = {
      input: source,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    }
    const { stdout } = await execFileAsync(
      binPath,
      ['--stdin', '--tag', stem, '--path', filePath, '--machine-errors'],
      options,
    )
    return { code: stdout, diagnostics: [] }
  } catch (err: unknown) {
    const stderr: string = (err as { stderr?: string }).stderr ?? ''
    return { code: null, diagnostics: parseMachineErrors(stderr, filePath) }
  }
}
