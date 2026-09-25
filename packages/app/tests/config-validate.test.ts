/**
 * Config validation — unknown keys, invalid values, and the declared-but-dead
 * fields.
 *
 * The tests that matter most here are the UNKNOWN-KEY ones. Every case below
 * was silently accepted before: `defineConfig` had four hand-written `if`
 * statements and no excess-key check at all, and its own `UNKNOWN_FIELD` error
 * code was declared and never thrown. A typo'd key did nothing and said
 * nothing — which only became urgent once `aihu.config.ts` started being
 * scaffolded into every project and advertised as THE place to configure
 * things.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AIHU_CONFIG_KEYS, defineConfig } from '../src/config.ts'
import { AihuConfigError } from '../src/config-error.ts'
import { __resetWarningsForTesting } from '../src/config-validate.ts'

/** Call defineConfig and return the thrown AihuConfigError, or null. */
function err(config: unknown): AihuConfigError | null {
  try {
    defineConfig(config as never)
    return null
  } catch (e) {
    if (e instanceof AihuConfigError) return e
    throw e
  }
}

beforeEach(() => {
  __resetWarningsForTesting()
})

describe('unknown keys throw rather than being silently dropped', () => {
  it('rejects a plain typo and names the keypath', () => {
    const e = err({ outpout: 'static' })
    expect(e?.code).toBe('UNKNOWN_FIELD')
    expect(e?.field).toBe('config.outpout')
    expect(e?.message).toContain('Unexpected option config.outpout')
  })

  it('rejects a nested typo with its full keypath', () => {
    const e = err({ dir: { page: 'src/pages' } })
    expect(e?.code).toBe('UNKNOWN_FIELD')
    expect(e?.field).toBe('config.dir.page')
  })

  it('every error message links the docs', () => {
    expect(err({ nope: 1 })?.message).toContain('https://aihu.dev/docs/config')
  })
})

describe('did-you-mean targets the mistakes people actually make', () => {
  // The two config dialects share a file name AND an interface name. Until
  // they are consolidated, writing a @aihu/server field into a @aihu/app
  // config is the single most likely error, and it used to be silent.
  it.each([
    ['rendering', 'output'],
    ['agent', 'agentReadiness'],
    ['server', 'vite.server'],
  ])('maps @aihu/server field %s -> %s', (wrong, right) => {
    expect(err({ [wrong]: {} })?.message).toContain(`did you mean ${right}?`)
  })

  it.each([
    ['shadowMode', 'css.shadowMode'],
    ['bundler', 'build.bundler'],
    ['components', 'dir.components'],
    ['head', 'app.head'],
    ['integrations', 'plugins'],
  ])('maps mis-nested %s -> %s', (wrong, right) => {
    expect(err({ [wrong]: {} })?.message).toContain(`did you mean ${right}?`)
  })

  it('omits the hint when there is no good guess', () => {
    expect(err({ zzz: 1 })?.message).not.toContain('did you mean')
  })
})

describe('invalid values keep their specific error codes', () => {
  it.each([
    // `'hybrid'` (not `'ssr'`) is the invalid sample now: `'ssr'` became a
    // real OutputMode. `'hybrid'` is the other name the old docblock listed
    // as "tracked separately", so it is the mode a reader is most likely to
    // reach for next and the most useful one to reject by name.
    [{ output: 'hybrid' }, 'INVALID_OUTPUT_MODE'],
    [{ css: { shadowMode: 'closed' } }, 'INVALID_CSS_SHADOW_MODE'],
    [{ build: { bundler: 'webpack' } }, 'INVALID_BUNDLER'],
    [{ compiler: { target: 'edge' } }, 'INVALID_COMPILER_TARGET'],
    [{ dev: { port: '3000' } }, 'INVALID_TYPE'],
    [{ dir: { pages: 42 } }, 'INVALID_TYPE'],
  ] as const)('%j -> %s', (config, code) => {
    expect(err(config)?.code).toBe(code)
  })

  it('reports the received value so the message is actionable', () => {
    expect(err({ output: 'hybrid' })?.message).toContain('received "hybrid"')
  })

  it('phrases a three-option list as "one of"', () => {
    expect(err({ output: 'hybrid' })?.message).toContain('one of "spa", "static" or "ssr"')
  })

  it('phrases a two-option list as "either/or"', () => {
    expect(err({ css: { shadowMode: 'closed' } })?.message).toContain('either "light" or "shadow"')
  })

  it('phrases a three-option list as "one of" (compiler.target)', () => {
    expect(err({ compiler: { target: 'edge' } })?.message).toContain(
      'one of "client", "server" or "universal"',
    )
  })
})

/**
 * `app.outletId` was a bare `v.string`, so every shape below passed config
 * validation and then failed SILENTLY at request time: the SSR splice matched
 * nothing (or the wrong thing) and the client's `getElementById` looked for an
 * element that could not exist, so the server and the browser disagreed about
 * where the page goes with no error anywhere.
 */
describe('app.outletId must be a real HTML id, rejected at the config', () => {
  it.each([
    ['', 'empty — matches no element, and getElementById("") is always null'],
    ['a"b', 'closes the id="…" attribute the splice and the template both write'],
    ["a'b", 'closes a single-quoted id attribute'],
    ['my outlet', 'ASCII whitespace is illegal in an id; the browser sees two attributes'],
    ['1abc', 'the HTML4 ID production requires a leading letter'],
    ['-abc', 'same'],
    ['a<b', 'angle brackets end the tag'],
    ['a>b', 'same'],
    ['a\nb', 'a newline is whitespace'],
  ])('rejects %j', (outletId) => {
    const e = err({ app: { outletId } })
    expect(e, `expected ${JSON.stringify(outletId)} to be rejected`).toBeDefined()
    expect(e?.field).toBe('config.app.outletId')
    // Actionable: names the shape AND echoes what was received.
    expect(e?.message).toContain('an HTML id')
    expect(e?.message).toContain(JSON.stringify(outletId))
  })

  it.each([
    ['outlet'],
    ['app-root'],
    ['app_root'],
    ['Root'],
    ['a.b:c-d_e9'],
  ])('accepts %j', (outletId) => {
    expect(err({ app: { outletId } })).toBeNull()
  })

  it('still accepts an absent outletId', () => {
    expect(err({ app: {} })).toBeNull()
    expect(err({})).toBeNull()
  })

  it('rejects a non-string before it rejects the shape', () => {
    expect(err({ app: { outletId: 42 } })?.code).toBe('INVALID_TYPE')
  })
})

/**
 * `output: 'ssr'` requires `css.shadowMode`.
 *
 * Not a style preference. With no shadowMode configured, a LEAF component
 * exports no `__aihu_shadow__` (the compiler injects it only when
 * `effectiveShadow != null`, and the implicit DA4 `'light'` default marker is
 * emitted for `@route` units and layouts, never for leaves).
 * `buildChildRegistry`'s `_whyUnrenderable` then rejects it, and every child
 * reference in the server bundle renders as an empty element — byte-identical
 * to "the registry is broken", which is the exact indistinguishability the SSR
 * child work exists to remove.
 *
 * So the deliverable is a BUILD ERROR naming `css.shadowMode`, not a runtime
 * warning: a warning in a build log is what let `apps/docs` be the only project
 * that ever set it.
 */
describe("output: 'ssr' requires css.shadowMode", () => {
  it('throws MISSING_SHADOW_MODE and names the key', () => {
    const e = err({ output: 'ssr' })
    expect(e?.code).toBe('MISSING_SHADOW_MODE')
    expect(e?.field).toBe('config.css.shadowMode')
    expect(e?.message).toContain('css.shadowMode')
  })

  it('explains the consequence, so the fix is not cargo-culted', () => {
    expect(err({ output: 'ssr' })?.message).toContain('EMPTY element')
  })

  it.each(['light', 'shadow'] as const)("accepts output: 'ssr' with shadowMode %s", (mode) => {
    const e = err({ output: 'ssr', css: { shadowMode: mode } })
    expect(e).toBeNull()
  })

  it('leaves spa and static alone — they take zero new paths', () => {
    expect(err({ output: 'spa' })).toBeNull()
    expect(err({ output: 'static' })).toBeNull()
    expect(err({})).toBeNull()
  })

  it('an explicitly-undefined css block is still missing, not satisfied', () => {
    // `{ css: {} }` passes the shape validator (shadowMode is optional there),
    // so the cross-field rule is the ONLY thing standing between this config
    // and a silently-empty server render.
    expect(err({ output: 'ssr', css: {} })?.code).toBe('MISSING_SHADOW_MODE')
  })
})

describe('declared-but-not-wired fields warn instead of lying', () => {
  it('warns on ui.style but still accepts it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => defineConfig({ ui: { style: 'daisyui' } })).not.toThrow()
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]?.[0]).toContain('not yet wired up')
    warn.mockRestore()
  })

  it('warns only once per key, so a rebuild loop does not train people to ignore it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    defineConfig({ ui: { style: 'daisyui' } })
    defineConfig({ ui: { style: 'daisyui' } })
    defineConfig({ ui: { style: 'daisyui' } })
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('stays silent when the dead field is not set', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    defineConfig({ ui: {} })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('router.viewTransitions — wired via RouteContext', () => {
  it('is accepted with no warning (no longer a declared-but-dead field)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => defineConfig({ router: { viewTransitions: true } })).not.toThrow()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('valid configs are accepted unchanged', () => {
  it('returns the caller object by identity — defineConfig stays an identity fn', () => {
    // Deliberate deviation from SvelteKit, whose validators also apply
    // defaults. viteAihuPlugin applies its own defaults at point of use
    // (`config?.dir?.pages ?? 'pages'`), so returning a different object here
    // would be a behaviour change unrelated to validation.
    const input = { output: 'static' } as const
    expect(defineConfig(input)).toBe(input)
  })

  it('accepts every field the schema declares', () => {
    expect(() =>
      defineConfig({
        dir: { pages: 'src/pages', layouts: 'src/layouts', components: 'src/components' },
        output: 'static',
        site: { url: 'https://example.com' },
        app: { head: { title: 'x', meta: [{ name: 'a', content: 'b' }] } },
        compiler: { islands: true, target: 'client' },
        dev: { port: 5173, host: 'localhost', open: false },
        build: { bundler: 'vite' },
        typecheck: { strictTemplates: true, project: 'tsconfig.json' },
        css: { shadowMode: 'light' },
        ui: { registry: '@aihu/ui', target: './src/components/ui' },
        agentReadiness: { name: 'demo' },
      }),
    ).not.toThrow()
  })

  it('accepts agentReadiness: false as a whole-block disable', () => {
    expect(() => defineConfig({ agentReadiness: false })).not.toThrow()
  })

  it('accepts an empty config', () => {
    expect(() => defineConfig({})).not.toThrow()
  })
})

describe('the key list is derived from the schema, not hand-maintained', () => {
  it('exposes the owned keys', () => {
    expect(AIHU_CONFIG_KEYS).toContain('agentReadiness')
    expect(AIHU_CONFIG_KEYS).toContain('compiler')
  })

  it('every declared key is actually accepted by the validator', () => {
    // Guards the drift this list exists to prevent: a key present in the type
    // but missing from the schema would throw UNKNOWN_FIELD on its own name.
    for (const key of AIHU_CONFIG_KEYS) {
      const e = err({ [key]: undefined })
      expect(e, `schema key '${key}' rejected itself`).toBeNull()
    }
  })
})
