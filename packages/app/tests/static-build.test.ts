import { existsSync } from 'node:fs'
import { cp, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { branch, mount, slot } from '@aihu/arbor'
import { afterAll, describe, expect, it } from 'vitest'
import { _setMount, defineComponent, defineElement } from '../../runtime/src/index.ts'
import { viteAihuPlugin } from '../src/vite-plugin.ts'

const fixtureRoot = existsSync(join(process.cwd(), 'tests/fixtures/static-site'))
  ? process.cwd()
  : join(process.cwd(), 'packages/app')
const fixture = join(fixtureRoot, 'tests/fixtures/static-site')
const outputs: string[] = []
const sources: string[] = []

afterAll(async () => {
  await Promise.all(outputs.map((path) => rm(path, { recursive: true, force: true })))
  await Promise.all(sources.map((path) => rm(path, { recursive: true, force: true })))
})

describe("viteAihuPlugin({ output: 'static' })", () => {
  it('excludes framework packages that import Vite virtual modules from dependency optimization', () => {
    const plugin = viteAihuPlugin({ output: 'static' }).find(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        'name' in entry &&
        entry.name === 'aihu-virtual-modules-optimize-deps',
    )
    expect(plugin).toBeDefined()
    if (!plugin || typeof plugin !== 'object' || !('config' in plugin))
      throw new Error('missing plugin config hook')
    const hook = plugin.config as (config: { optimizeDeps?: { exclude?: string[] } }) => {
      optimizeDeps: { exclude: string[] }
    }
    expect(hook({ optimizeDeps: { exclude: ['existing-package'] } }).optimizeDeps.exclude).toEqual([
      'existing-package',
      '@aihu/app',
    ])
  })

  it.each([
    'directory',
    'file',
  ] as const)('writes complete route HTML in %s format', async (format) => {
    const { build } = await import('vite')
    const outDir = await realpath(await mkdtemp(join(tmpdir(), `aihu-static-${format}-`)))
    const sourceDir = await realpath(await mkdtemp(join(tmpdir(), `aihu-static-source-${format}-`)))
    await cp(fixture, sourceDir, { recursive: true })
    const nameSuffix = sourceDir.split('/').at(-1)
    for (const page of ['index.aihu', 'about.aihu', 'product.aihu']) {
      const path = join(sourceDir, 'src/pages', page)
      const source = await readFile(path, 'utf8')
      await writeFile(
        path,
        source
          .replace(/name: "static-/g, `name: "${nameSuffix}-`)
          .replaceAll('layout: "site"', `layout: "site-${nameSuffix}"`)
          .replaceAll('<shared-banner>', `<${nameSuffix}-shared-banner>`)
          .replaceAll('</shared-banner>', `</${nameSuffix}-shared-banner>`)
          .replaceAll('<shared-chip />', `<${nameSuffix}-shared-chip />`),
      )
    }
    const layout = join(sourceDir, 'src/layouts/site.aihu')
    await writeFile(
      layout.replace('site.aihu', `site-${nameSuffix}.aihu`),
      await readFile(layout, 'utf8'),
    )
    await rm(layout)
    for (const component of ['shared-banner.aihu', 'shared-chip.aihu']) {
      const path = join(sourceDir, 'shared', component)
      await writeFile(
        path.replace(component, `${nameSuffix}-${component}`),
        await readFile(path, 'utf8'),
      )
      await rm(path)
    }
    const workspace = resolve(fixtureRoot, '../..')
    await symlink(join(workspace, 'node_modules'), join(sourceDir, 'node_modules'), 'dir')
    outputs.push(outDir)
    sources.push(sourceDir)

    await build({
      root: sourceDir,
      configFile: false,
      logLevel: 'silent',
      resolve: {
        alias: {
          '@aihu/app/client': join(workspace, 'packages/app/src/client.ts'),
          '@aihu/context/ssr': join(workspace, 'packages/context/src/ssr.ts'),
          '@aihu/context': join(workspace, 'packages/context/src/index.ts'),
          '@aihu/runtime/app': join(workspace, 'packages/runtime/src/app.ts'),
          '@aihu/runtime/ssr': join(workspace, 'packages/runtime/src/ssr-string.ts'),
          '@aihu/runtime': join(workspace, 'packages/runtime/src/index.ts'),
          '@aihu/server/head-lowering': join(workspace, 'packages/server/src/head-lowering.ts'),
          '@aihu/server': join(workspace, 'packages/server/src/index.ts'),
          '@aihu/store': join(workspace, 'packages/store/src/index.ts'),
          '@aihu/router/plugin': join(workspace, 'packages/router/src/plugin.ts'),
          '@aihu/router/server': join(workspace, 'packages/router/src/server.ts'),
          '@aihu/router': join(workspace, 'packages/router/src/index.ts'),
          '@aihu/primitives/focus-trap': join(
            workspace,
            'packages/primitives/src/dialog/focus-trap.ts',
          ),
          '@aihu/primitives': join(workspace, 'packages/primitives/src/index.ts'),
        },
      },
      plugins: [
        viteAihuPlugin({
          output: 'static',
          static: { format },
          css: { shadowMode: 'light' },
          dir: {
            pages: 'src/pages',
            layouts: 'src/layouts',
            components: ['src/components', 'shared'],
          },
        }),
      ],
      build: { outDir, emptyOutDir: true },
    })

    const paths = [
      ['/', 'index.html', 'Static home content', 'Static home title'],
      [
        '/about',
        format === 'directory' ? 'about/index.html' : 'about.html',
        'Static about content',
        'Static about title',
      ],
      [
        '/product',
        format === 'directory' ? 'product/index.html' : 'product.html',
        'Static product content',
        'Static product title',
      ],
    ] as const
    for (const [, path, content, title] of paths) {
      const html = await readFile(join(outDir, path), 'utf8')
      expect(html).toContain(content)
      expect(html).toContain(`<title>${title}</title>`)
      expect(html).toContain('Static site layout')
    }

    const home = await readFile(join(outDir, 'index.html'), 'utf8')
    expect(home).toContain('Projected header content')
    expect(home).toContain('Shared workspace component')
    expect(home.match(/Projected header content/g)).toHaveLength(1)

    // Upgrade the actual named-slot host serialized by the static build. This
    // exercises the same light-DOM connect path the client uses for this
    // intentionally unmarked custom-element boundary.
    const slotTag = home.match(/<(aihu-[a-z0-9-]*shared-banner)(?:\s|>)/)?.[1]
    expect(slotTag).toBeDefined()
    if (!slotTag) throw new Error('static HTML did not contain the shared banner host')
    const slotContent = home.match(new RegExp(`<${slotTag}[^>]*>(.*?)</${slotTag}>`))?.[1]
    expect(slotContent).toContain('Projected header content')
    _setMount(mount)
    const upgradeTag = `${slotTag}-upgrade-test`
    document.body.innerHTML = `<${upgradeTag}>${slotContent}</${upgradeTag}>`
    const Slotted = defineComponent(() =>
      branch('section', undefined, [branch('header', undefined, [slot('header')])]),
    )
    defineElement(upgradeTag, Slotted, { shadowMode: 'light' })
    const projected = document.querySelector(`${upgradeTag} header span[slot="header"]`)
    expect(projected?.textContent).toBe('Projected header content')
    expect(document.querySelectorAll(`${upgradeTag} span[slot="header"]`)).toHaveLength(1)
    document.body.innerHTML = ''
  })
})
