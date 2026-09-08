/**
 * packages/language-server/src/core/code-action.ts
 *
 * QuickFix code-action backing — bridges compiler diagnostic codes C440-C444
 * (rejected old-spec macro forms) to the macro-simplification codemod
 * (`migrate()`), which rewrites a full document to v2 collection-form syntax.
 *
 * Editor-agnostic: this module computes WHAT the fix is (the rewritten text +
 * any warnings). The connection layer (src/server.ts) turns that into a protocol
 * `WorkspaceEdit`/`CodeAction`. This keeps the codemod bridge a clean seam for a
 * future Volar code-action provider.
 *
 * The migrate() codemod is loaded from the public @aihu/compiler package export.
 */
import { migrate } from '@aihu/compiler/codemods/macro-simplification'

/** Compiler diagnostic codes whose QuickFix is the v2 macro migration codemod. */
export const MIGRATE_CODES = new Set(['C440', 'C441', 'C442', 'C443', 'C444'])

export interface MigrateFix {
  /** The full-document rewritten source. */
  rewritten: string
  /** Codemod warnings (e.g. @agent referencing unknown @state name). */
  warnings: readonly string[]
  /** Human-readable action title (includes warning count when non-zero). */
  title: string
}

/**
 * Run the macro-simplification codemod over `source` and return the fix payload.
 * Returns `null` when the codemod throws (malformed source) so callers can fall
 * back to offering no action rather than surfacing a crash.
 */
export function buildMigrateFix(source: string): MigrateFix | null {
  let result: ReturnType<typeof migrate>
  try {
    result = migrate(source)
  } catch {
    return null
  }
  const { rewritten, warnings } = result
  let title = 'Migrate to v2 macro syntax (aihu codemod)'
  if (warnings.length > 0) {
    title += ` (${warnings.length} warning(s) - see Output panel)`
  }
  return { rewritten, warnings, title }
}
