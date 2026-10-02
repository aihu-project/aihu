import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, type Plugin } from 'vite'
import { describe, expect, it } from 'vitest'
import type { RouteDefinition } from '../src/index.ts'
import { createRouter } from '../src/index.ts'
import { viteRouterPlugin } from '../src/plugin.ts'
import { createServerRouter } from '../src/server.ts'

// ---------------------------------------------------------------------------
// Helpers to build RouteDefinition fixtures
// ---------------------------------------------------------------------------

function staticRoute(pattern: string, html = '<div>page</div>'): RouteDefinition {
  return {
    pattern,
    segments:
      pattern === '/'
        ? []
        : pattern
            .split('/')
            .filter(Boolean)
            .map((p) => ({ kind: 'static' as const, path: p })),
    module: () =>
      Promise.resolve({
        default: { toHtml: () => html },
      }),
  }
}

function paramRoute(pattern: string): RouteDefinition {
  const segments = pattern
    .split('/')
    .filter(Boolean)
    .map((p) => {
      if (p.startsWith(':')) return { kind: 'param' as const, name: p.slice(1) }
      return { kind: 'static' as const, path: p }
    })
  return {
    pattern,
    segments,
    module: () =>
      Promise.resolve({
        default: { toHtml: () => '<div>param page</div>' },
      }),
  }
}

function catchallRoute(prefix = ''): RouteDefinition {
  const prefixSegs = prefix
    ? prefix
        .split('/')
        .filter(Boolean)
        .map((p) => ({ kind: 'static' as const, path: p }))
    : []
  const pattern = prefix ? `${prefix}/*` : '/*'
  return {
    pattern,
    segments: [...prefixSegs, { kind: 'catchall' as const }],
    module: () =>
      Promise.resolve({
        default: { toHtml: () => '<div>catchall</div>' },
      }),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('@aihu/router — createRouter', () => {
  it('matches a static root route', () => {
    const router = createRouter([staticRoute('/')])
    const result = router.match('/')
    expect(result).not.toBeNull()
    expect(result?.params).toEqual({})
    expect(result?.route.pattern).toBe('/')
  })

  it('matches a static nested route', () => {
    const router = createRouter([staticRoute('/'), staticRoute('/about')])
    const result = router.match('/about')
    expect(result).not.toBeNull()
    expect(result?.route.pattern).toBe('/about')
    expect(result?.params).toEqual({})
  })

  it('extracts params from a dynamic route', () => {
    const router = createRouter([paramRoute('/users/:id')])
    const result = router.match('/users/42')
    expect(result).not.toBeNull()
    expect(result?.params).toEqual({ id: '42' })
  })

  it('extracts multiple params from a nested dynamic route', () => {
    const router = createRouter([paramRoute('/blog/:year/:slug')])
    const result = router.match('/blog/2024/hello-world')
    expect(result).not.toBeNull()
    expect(result?.params).toEqual({ year: '2024', slug: 'hello-world' })
  })

  it('returns null for unmatched pathname', () => {
    const router = createRouter([staticRoute('/'), staticRoute('/about')])
    const result = router.match('/unknown')
    expect(result).toBeNull()
  })

  it('returns null when no routes are defined', () => {
    const router = createRouter([])
    expect(router.match('/')).toBeNull()
    expect(router.match('/anything')).toBeNull()
  })

  it('matches catchall route and captures rest as *', () => {
    const router = createRouter([catchallRoute('/blog')])
    const result = router.match('/blog/2024/hello')
    expect(result).not.toBeNull()
    expect(result?.params['*']).toBe('2024/hello')
  })

  it('static routes take priority over dynamic', () => {
    const router = createRouter([paramRoute('/users/:id'), staticRoute('/users/me')])
    const result = router.match('/users/me')
    expect(result).not.toBeNull()
    expect(result?.route.pattern).toBe('/users/me')
    expect(result?.params).toEqual({})
  })

  it('dynamic routes take priority over catchall', () => {
    const router = createRouter([catchallRoute('/blog'), paramRoute('/blog/:slug')])
    const result = router.match('/blog/hello')
    expect(result).not.toBeNull()
    expect(result?.route.pattern).toBe('/blog/:slug')
    expect(result?.params).toEqual({ slug: 'hello' })
  })

  it('URL-decodes param values', () => {
    const router = createRouter([paramRoute('/items/:name')])
    const result = router.match('/items/hello%20world')
    expect(result).not.toBeNull()
    expect(result?.params.name).toBe('hello world')
  })
})

describe('@aihu/router/server — handle()', () => {
  it('returns 200 HTML response for matched route', async () => {
    const router = createServerRouter([staticRoute('/', '<p>home</p>')])
    const req = new Request('http://localhost/')
    const res = await router.handle(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toMatch(/text\/html/)
    const body = await res.text()
    expect(body).toContain('<p>home</p>')
  })

  it('returns 404 for unmatched route', async () => {
    const router = createServerRouter([staticRoute('/')])
    const req = new Request('http://localhost/not-found')
    const res = await router.handle(req)
    expect(res.status).toBe(404)
  })

  it('calls loader and injects data into response', async () => {
    const route: RouteDefinition = {
      pattern: '/api/:id',
      segments: [
        { kind: 'static', path: 'api' },
        { kind: 'param', name: 'id' },
      ],
      module: () =>
        Promise.resolve({
          default: { toHtml: () => '<div>content</div>' },
          loader: async (params: Record<string, string>) => ({ found: true, id: params.id }),
        }),
    }
    const router = createServerRouter([route])
    const req = new Request('http://localhost/api/99')
    const res = await router.handle(req)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('<div>content</div>')
    expect(body).toContain('"found":true')
    expect(body).toContain('"id":"99"')
  })
})

describe('@aihu/router — viteRouterPlugin', () => {
  it('is a valid Vite plugin with required hooks', () => {
    const plugin = viteRouterPlugin()
    expect(typeof plugin.name).toBe('string')
    expect(plugin.name).toBe('aihu-router')
    expect(typeof plugin.resolveId).toBe('function')
    expect(typeof plugin.load).toBe('function')
  })

  it('resolves virtual:aihu-routes to internal ID', () => {
    const plugin = viteRouterPlugin()
    const resolved = plugin.resolveId?.('virtual:aihu-routes')
    expect(resolved).toBe('\0virtual:aihu-routes')
  })

  it('returns null for non-virtual module IDs', () => {
    const plugin = viteRouterPlugin()
    const resolved = plugin.resolveId?.('./some-file.ts')
    expect(resolved == null).toBe(true)
  })

  it('load returns null for non-virtual IDs', () => {
    const plugin = viteRouterPlugin()
    const result = plugin.load?.('./not-virtual.ts')
    expect(result == null).toBe(true)
  })

  it('accepts custom pagesDir option', () => {
    const plugin = viteRouterPlugin({ pagesDir: 'src/pages' })
    expect(plugin.name).toBe('aihu-router')
    // Plugin should be constructable without errors
    expect(plugin.resolveId).toBeDefined()
    expect(plugin.load).toBeDefined()
  })

  it('scans default and configured relative directories under Vite root', () => {
    const root = mkdtempSync(join(tmpdir(), 'aihu-router-vite-root-'))
    const dirs = [
      'pages',
      'src/layouts',
      'src/components',
      'custom-pages',
      'custom-layouts',
      'custom-components',
    ]
    try {
      for (const dir of dirs) mkdirSync(join(root, dir), { recursive: true })
      writeFileSync(join(root, 'pages', 'about.aihu'), '@template { <p>default page</p> }')
      writeFileSync(join(root, 'src/layouts', 'default-layout.aihu'), '@template { <outlet /> }')
      writeFileSync(
        join(root, 'src/components', 'default-card.aihu'),
        '@template { <p>default</p> }',
      )
      writeFileSync(join(root, 'custom-pages', 'custom.aihu'), '@template { <p>custom page</p> }')
      writeFileSync(join(root, 'custom-layouts', 'custom-layout.aihu'), '@template { <outlet /> }')
      writeFileSync(
        join(root, 'custom-components', 'custom-card.aihu'),
        '@template { <p>custom</p> }',
      )

      const defaultPlugin = viteRouterPlugin()
      defaultPlugin.configResolved?.({ root })
      expect(defaultPlugin.load?.('\0virtual:aihu-routes')).toContain('/about')
      expect(defaultPlugin.load?.('\0virtual:aihu-layouts')).toContain('default-layout')
      expect(defaultPlugin.load?.('\0virtual:aihu-components')).toContain('default-card')

      const configuredPlugin = viteRouterPlugin({
        pagesDir: 'custom-pages',
        layoutsDir: 'custom-layouts',
        componentsDir: 'custom-components',
      })
      configuredPlugin.configResolved?.({ root })
      expect(configuredPlugin.load?.('\0virtual:aihu-routes')).toContain('/custom')
      expect(configuredPlugin.load?.('\0virtual:aihu-layouts')).toContain('custom-layout')
      expect(configuredPlugin.load?.('\0virtual:aihu-components')).toContain('custom-card')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('uses Vite root during a build invoked from a different cwd', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aihu-router-vite-build-'))
    mkdirSync(join(root, 'pages'))
    writeFileSync(join(root, 'pages', 'about.aihu'), '@template { <p>about</p> }')
    const generated: string[] = []
    try {
      await build({
        configFile: false,
        root,
        logLevel: 'silent',
        plugins: [
          viteRouterPlugin() as Plugin,
          {
            name: 'router-test-sfc-loader',
            load(id) {
              if (id.endsWith('.aihu')) return 'export default {}'
              return null
            },
            transform(code, id) {
              if (id.includes('virtual:aihu-routes')) generated.push(code)
              return null
            },
          },
        ],
        build: { write: false, rollupOptions: { input: 'virtual:aihu-routes' } },
      })
      expect(generated.join('\n')).toContain('/about')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('exposes resolved directories through the aihu module config contract', () => {
    const plugin = viteRouterPlugin({ pagesDir: 'custom-pages' })
    expect(plugin.api?.aihuModule).toBe('@aihu/router')
    expect(plugin.api?.getOptions()).toEqual({
      pagesDir: 'custom-pages',
      layoutsDir: 'src/layouts',
      componentsDir: 'src/components',
    })
  })
})
