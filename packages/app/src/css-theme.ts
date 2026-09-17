/**
 * `css.theme` resolution: turn the configured project theme into the CSS text
 * `@aihu/css-engine` consumes (#836 follow-up).
 *
 * The engine uses the theme for its `var(--name, <value>)` fallback values, so
 * it replaces the built-in `aihu-default` palette without declaring anything at
 * `:host` — a theme the component inherits from the document still wins.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CssConfig } from './config.ts'
import { AihuConfigError } from './config-error.ts'

/** A resolved `css.theme`: engine input text, plus the file it came from. */
export interface ResolvedCssTheme {
  readonly css: string
  /** Absolute path when the theme is a file, so the dev server can watch it. */
  readonly file?: string
}

/**
 * Resolve `css.theme` against the project root.
 *
 * - A string is a path to a CSS file that must contain an `@theme { … }` block.
 * - A style pack (`defineStylePack()`) contributes its base `tokens`. Its dark
 *   and named themes are runtime overrides, so they have no fallback role.
 */
export function resolveCssTheme(
  theme: CssConfig['theme'],
  root: string,
  keypath = 'config',
): ResolvedCssTheme | undefined {
  if (theme === undefined) return undefined
  const field = `${keypath}.css.theme`
  if (typeof theme === 'string') {
    const file = resolve(root, theme)
    if (!existsSync(file)) {
      throw new AihuConfigError(
        `${field} points at ${file}, which does not exist.`,
        'INVALID_CSS_THEME',
        field,
      )
    }
    const css = readFileSync(file, 'utf8')
    if (!/@theme\s*\{/.test(css)) {
      throw new AihuConfigError(
        `${field} points at ${file}, which has no @theme { … } block. ` +
          'Declare the project tokens inside @theme, e.g. @theme { --color-primary: #0a7; }.',
        'INVALID_CSS_THEME',
        field,
      )
    }
    return { css, file }
  }
  const css = Object.entries(theme.tokens)
    .map(([name, value]) => `${name.startsWith('--') ? name : `--${name}`}: ${value};`)
    .join('\n')
  return { css }
}
