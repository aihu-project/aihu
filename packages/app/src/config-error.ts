/**
 * `AihuConfigError` — extracted from `config.ts` so the validation combinators
 * in `config-validate.ts` can throw it without a circular import back into the
 * schema that uses them.
 *
 * `config.ts` re-exports it, so this move is not a breaking change.
 */

/** Thrown by `defineConfig` when configuration validation fails. */
export class AihuConfigError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'INVALID_OUTPUT_MODE'
      | 'INVALID_DIR'
      | 'UNKNOWN_FIELD'
      | 'INVALID_CSS_SHADOW_MODE'
      | 'INVALID_TYPE'
      | 'INVALID_COMPILER_TARGET'
      | 'INVALID_BUNDLER'
      | 'REMOVED_FIELD'
      | 'MISSING_SHADOW_MODE'
      | 'INVALID_CSS_THEME'
      | 'CSS_THEME_UNUSED',
    readonly field?: string,
  ) {
    super(message)
    this.name = 'AihuConfigError'
  }
}
