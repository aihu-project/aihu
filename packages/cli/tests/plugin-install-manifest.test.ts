/**
 * Pure-logic tests for `plugin-install-manifest.ts` — parsing/validation plus
 * the idempotent text edits `aihu plugin install` applies, per
 * `docs/specs/plugin-install-manifest.md`.
 */

import { describe, expect, it } from 'vitest'
import {
  computeConfigInsertion,
  computeEnvExampleInsertion,
  computeRouteInsertion,
  ManifestValidationError,
  parseManifest,
  renderOptionsLiteral,
} from '../src/plugin-install-manifest.ts'

describe('parseManifest', () => {
  it('accepts a well-formed manifest', () => {
    const manifest = parseManifest({
      pluginName: '@aihu/seo',
      pluginVersion: '1.0.0',
      aihuVersion: '^0.2.0',
      installSteps: [{ kind: 'add-plugin-to-config', factoryName: 'seo' }],
    })
    expect(manifest.pluginName).toBe('@aihu/seo')
  })

  it('throws on a non-object', () => {
    expect(() => parseManifest('nope')).toThrow(ManifestValidationError)
  })

  it('throws when a required field is missing', () => {
    expect(() =>
      parseManifest({ pluginVersion: '1.0.0', aihuVersion: '*', installSteps: [] }),
    ).toThrow(/pluginName/)
  })

  it('throws when installSteps is not an array', () => {
    expect(() =>
      parseManifest({
        pluginName: '@aihu/x',
        pluginVersion: '1.0.0',
        aihuVersion: '*',
        installSteps: 'nope',
      }),
    ).toThrow(/installSteps/)
  })

  it('throws when a step has no kind', () => {
    expect(() =>
      parseManifest({
        pluginName: '@aihu/x',
        pluginVersion: '1.0.0',
        aihuVersion: '*',
        installSteps: [{ factoryName: 'x' }],
      }),
    ).toThrow(/kind/)
  })

  it.each([
    'a}; process.exit(1); //',
    'seo\nprocess.exit(1)',
  ])('rejects executable factoryName %s', (factoryName) => {
    expect(() =>
      parseManifest({
        pluginName: '@aihu/x',
        pluginVersion: '1.0.0',
        aihuVersion: '*',
        installSteps: [{ kind: 'add-plugin-to-config', factoryName }],
      }),
    ).toThrow(/factoryName.*valid JavaScript identifier/)
  })

  it('rejects unknown step kinds and fields', () => {
    const manifest = {
      pluginName: '@aihu/x',
      pluginVersion: '1.0.0',
      aihuVersion: '*',
      installSteps: [{ kind: 'register-plugin', factoryName: 'x' }],
    }
    expect(() => parseManifest(manifest)).toThrow(/unknown kind/)
    expect(() =>
      parseManifest({
        ...manifest,
        installSteps: [{ kind: 'add-plugin-to-config', factoryName: 'x', injected: true }],
      }),
    ).toThrow(/unknown field/)
  })
})

describe('renderOptionsLiteral', () => {
  it('renders an empty object', () => {
    expect(renderOptionsLiteral({})).toBe('{}')
  })

  it('quotes plain strings but emits process.env.* as a bare identifier', () => {
    expect(renderOptionsLiteral({ siteName: 'My App', baseUrl: 'process.env.SITE_URL' })).toBe(
      '{ siteName: "My App", baseUrl: process.env.SITE_URL }',
    )
  })

  it('renders numbers/booleans/nested objects', () => {
    expect(renderOptionsLiteral({ n: 3, on: true, nested: { a: 'process.env.A' } })).toBe(
      '{ n: 3, on: true, nested: { a: process.env.A } }',
    )
  })

  it('safely serializes hostile and prototype-sensitive property keys', () => {
    expect(
      renderOptionsLiteral({
        'a}; process.exit(1); //': 'safe',
        __proto__: { polluted: true },
      }),
    ).toBe('{ ["a}; process.exit(1); //"]: "safe" }')
    const withProto = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>
    expect(renderOptionsLiteral(withProto)).toBe('{ ["__proto__"]: { polluted: true } }')
  })
})

describe('computeConfigInsertion', () => {
  const step = {
    kind: 'add-plugin-to-config' as const,
    factoryName: 'seo',
    defaultOptions: { siteName: 'My App', baseUrl: 'process.env.SITE_URL' },
  }

  it('inserts an import + array entry into an empty plugins: [] array', () => {
    const source = [
      "import { viteAihuPlugin } from '@aihu/app'",
      '',
      'export default {',
      '  plugins: [viteAihuPlugin({ plugins: [] })],',
      '}',
      '',
    ].join('\n')
    const edit = computeConfigInsertion(source, step, '@aihu/seo')
    expect(edit.applied).toBe(true)
    expect(edit.updated).toContain("import { seo } from '@aihu/seo'")
    expect(edit.updated).toContain('seo({ siteName: "My App", baseUrl: process.env.SITE_URL })')
  })

  it('appends alongside an existing plugin entry without disturbing it', () => {
    const source = [
      "import { viteAihuPlugin } from '@aihu/app'",
      "import { magna } from '@aihu/magna'",
      '',
      'export default {',
      '  plugins: [viteAihuPlugin({ plugins: [magna({})] })],',
      '}',
      '',
    ].join('\n')
    const edit = computeConfigInsertion(source, step, '@aihu/seo')
    expect(edit.applied).toBe(true)
    expect(edit.updated).toContain('magna({})')
    expect(edit.updated).toContain('seo({')
  })

  it('is idempotent — a second run on the already-edited source is a no-op', () => {
    const source = [
      "import { viteAihuPlugin } from '@aihu/app'",
      '',
      'export default {',
      '  plugins: [viteAihuPlugin({ plugins: [] })],',
      '}',
      '',
    ].join('\n')
    const first = computeConfigInsertion(source, step, '@aihu/seo')
    const second = computeConfigInsertion(first.updated, step, '@aihu/seo')
    expect(second.applied).toBe(false)
    expect(second.updated).toBe(first.updated)
  })

  it('reports not-applied when no plugins: [] array is found', () => {
    const source = 'export default { build: {} }\n'
    const edit = computeConfigInsertion(source, step, '@aihu/seo')
    expect(edit.applied).toBe(false)
    expect(edit.updated).toBe(source)
  })
})

describe('computeRouteInsertion', () => {
  const step = {
    kind: 'add-route' as const,
    factoryName: 'createSeoRoutes',
    routes: [
      { path: '/sitemap.xml', handlerKey: 'sitemapXml' },
      { path: '/robots.txt', handlerKey: 'robotsTxt' },
    ],
  }

  const base = [
    "import { createRequestRouter, defineRoute, json } from '@aihu/server'",
    '',
    'const router = createRequestRouter({',
    '  routes: [',
    "    defineRoute('/', () => json({ ok: true })),",
    '  ],',
    '})',
    '',
  ].join('\n')

  it('adds a handle + import + route entries', () => {
    const edit = computeRouteInsertion(base, step, '@aihu/seo')
    expect(edit.applied).toBe(true)
    expect(edit.updated).toContain('const seoRoutes = createSeoRoutes()')
    expect(edit.updated).toContain("import { createSeoRoutes } from '@aihu/seo'")
    expect(edit.updated).toContain('defineRoute("/sitemap.xml", seoRoutes.sitemapXml)')
    expect(edit.updated).toContain('defineRoute("/robots.txt", seoRoutes.robotsTxt)')
  })

  it('is idempotent by path', () => {
    const first = computeRouteInsertion(base, step, '@aihu/seo')
    const second = computeRouteInsertion(first.updated, step, '@aihu/seo')
    expect(second.applied).toBe(false)
  })

  it('reports not-applied when there is no createRequestRouter(...) call', () => {
    const edit = computeRouteInsertion('export default {}\n', step, '@aihu/seo')
    expect(edit.applied).toBe(false)
  })
})

describe('computeEnvExampleInsertion', () => {
  const entry = {
    name: 'SITE_URL',
    description: 'Canonical site URL',
    default: 'https://example.com',
  }

  it('creates the file when absent', () => {
    const edit = computeEnvExampleInsertion(undefined, entry)
    expect(edit.applied).toBe(true)
    expect(edit.updated).toBe('# Canonical site URL\nSITE_URL=https://example.com\n')
  })

  it('appends to an existing file', () => {
    const edit = computeEnvExampleInsertion('OTHER_VAR=1\n', entry)
    expect(edit.applied).toBe(true)
    expect(edit.updated).toBe('OTHER_VAR=1\n\n# Canonical site URL\nSITE_URL=https://example.com\n')
  })

  it('never overwrites an existing value for the same name', () => {
    const edit = computeEnvExampleInsertion('SITE_URL=https://real-value.example\n', entry)
    expect(edit.applied).toBe(false)
    expect(edit.updated).toBe('SITE_URL=https://real-value.example\n')
  })
})
