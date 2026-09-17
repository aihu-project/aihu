import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { validateAihuConfig } from '../src/config.ts'
import type { AihuConfigError } from '../src/config-error.ts'
import { resolveCssTheme } from '../src/css-theme.ts'

const compilerOptions = vi.hoisted(() => [] as unknown[])
vi.mock('@aihu/compiler', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  aihuCompilerPlugin: (options: unknown) => {
    compilerOptions.push(options)
    return { name: 'aihu-compiler-stub' }
  },
}))

const tmp = mkdtempSync(join(tmpdir(), 'aihu-css-theme-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

function write(name: string, css: string): string {
  writeFileSync(join(tmp, name), css)
  return name
}

function err(run: () => unknown): AihuConfigError | undefined {
  try {
    run()
  } catch (e) {
    return e as AihuConfigError
  }
  return undefined
}

describe('resolveCssTheme', () => {
  it('reads a CSS file with an @theme block, relative to the root', () => {
    const name = write('theme.css', '@theme {\n  --color-primary: #0a7;\n}\n')
    const theme = resolveCssTheme(name, tmp)
    expect(theme?.css).toContain('--color-primary: #0a7;')
    expect(theme?.file).toBe(join(tmp, name))
  })

  it('rejects a missing file', () => {
    const e = err(() => resolveCssTheme('nope.css', tmp))
    expect(e?.code).toBe('INVALID_CSS_THEME')
    expect(e?.field).toBe('config.css.theme')
  })

  it('rejects a file without an @theme block', () => {
    const name = write('root.css', ':root { --color-primary: #0a7; }')
    const e = err(() => resolveCssTheme(name, tmp))
    expect(e?.code).toBe('INVALID_CSS_THEME')
    expect(e?.message).toContain('@theme')
  })

  it("turns a style pack's base tokens into declarations", () => {
    const theme = resolveCssTheme(
      { tokens: { 'color-primary': '#0a7', '--radius-md': '6px' } },
      tmp,
    )
    expect(theme).toEqual({ css: '--color-primary: #0a7;\n--radius-md: 6px;' })
  })
})

describe('css.theme / css.hostTokens validation', () => {
  it('accepts a path, a pack, and a boolean hostTokens', () => {
    expect(err(() => validateAihuConfig({ css: { theme: 'theme.css' } }))).toBeUndefined()
    expect(err(() => validateAihuConfig({ css: { theme: { tokens: {} } } }))).toBeUndefined()
    expect(err(() => validateAihuConfig({ css: { hostTokens: false } }))).toBeUndefined()
  })

  it('rejects a theme that is neither a path nor a pack', () => {
    const e = err(() => validateAihuConfig({ css: { theme: 42 as unknown as string } }))
    expect(e?.code).toBe('INVALID_CSS_THEME')
  })

  it('rejects a non-boolean hostTokens', () => {
    const e = err(() => validateAihuConfig({ css: { hostTokens: 'no' as unknown as boolean } }))
    expect(e?.code).toBe('INVALID_TYPE')
  })

  it('rejects theme combined with hostTokens: false, which would do nothing', () => {
    const e = err(() => validateAihuConfig({ css: { theme: 'theme.css', hostTokens: false } }))
    expect(e?.code).toBe('CSS_THEME_UNUSED')
    expect(e?.field).toBe('config.css.theme')
  })
})

describe('viteAihuPlugin forwards css.theme / css.hostTokens to the compiler', () => {
  it('passes the resolved theme text and hostTokens as the `css` option', async () => {
    const { viteAihuPlugin } = await import('../src/vite-plugin.ts')
    const name = write('forward.css', '@theme { --color-primary: #0a7; }')

    compilerOptions.length = 0
    viteAihuPlugin({ vite: { root: tmp }, css: { theme: name } })
    expect(compilerOptions.at(-1)).toMatchObject({
      css: { theme: '@theme { --color-primary: #0a7; }' },
    })

    viteAihuPlugin({ css: { hostTokens: false } })
    expect(compilerOptions.at(-1)).toMatchObject({ css: { hostTokens: false } })

    viteAihuPlugin({})
    expect(compilerOptions.at(-1)).not.toHaveProperty('css')
  })
})
