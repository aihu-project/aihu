import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { aihuDep } from '../src/dep-versions.ts'
import {
  appAihuConfig,
  appDefaultLayout,
  appIndexAihu,
  appPackageJson,
  appViteConfig,
  componentAihu,
  pageAihu,
  pluginIndex,
  pluginPackageJson,
  scaffoldApp,
  scaffoldComponent,
  scaffoldPage,
  scaffoldPlugin,
  toKebab,
  toSafe,
} from '../src/index.ts'

// ---------------------------------------------------------------------------
// Template generators (pure — no I/O)
// ---------------------------------------------------------------------------

describe('appPackageJson', () => {
  it('includes the app name', () => {
    const pkg = JSON.parse(appPackageJson('my-app')) as Record<string, unknown>
    expect(pkg.name).toBe('my-app')
  })

  it('lists core aihu runtime dependencies', () => {
    const pkg = JSON.parse(appPackageJson('demo')) as { dependencies: Record<string, string> }
    const deps = pkg.dependencies
    expect(deps).toHaveProperty('@aihu/arbor')
    expect(deps).toHaveProperty('@aihu/runtime')
    expect(deps).toHaveProperty('@aihu/signals')
  })

  it('lists @aihu/cli and vite as devDependencies', () => {
    const pkg = JSON.parse(appPackageJson('demo')) as {
      devDependencies: Record<string, string>
    }
    expect(pkg.devDependencies).toHaveProperty('@aihu/cli')
    expect(pkg.devDependencies).toHaveProperty('vite')
    // Regression guard against re-introducing the rolldown scaffold:
    // `createApp()` consumes `virtual:aihu-routes` from `viteAihuPlugin()`,
    // which rolldown does not provide.
    expect(pkg.devDependencies).not.toHaveProperty('rolldown')
  })

  it('uses vite for dev/build scripts', () => {
    const pkg = JSON.parse(appPackageJson('demo')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts.dev).toBe('vite')
    expect(pkg.scripts.build).toBe('vite build')
    expect(pkg.scripts.preview).toBe('vite preview')
  })

  it('lists @aihu/router as a runtime dependency', () => {
    // The router is required by `createApp()`. Listing it explicitly here
    // (alongside the @aihu/app meta-dep) keeps it visible to `bun outdated`
    // and survives any future surface trimming on @aihu/app's re-exports.
    const pkg = JSON.parse(appPackageJson('demo')) as {
      dependencies: Record<string, string>
    }
    expect(pkg.dependencies).toHaveProperty('@aihu/router')
  })

  it('sets type to module', () => {
    const pkg = JSON.parse(appPackageJson('demo')) as { type: string }
    expect(pkg.type).toBe('module')
  })

  it('declares the trusted dependencies bun would otherwise block (FIX 1)', () => {
    // Under `bun install`, lifecycle scripts are blocked unless the package is
    // trusted or on bun's own built-in allow-list. `esbuild` is the package a
    // scaffold actually postinstalls (reached through vite 6) and is named here
    // so the manifest states its own requirement instead of depending on bun's
    // list; `@aihu/compiler` no longer ships an install script at all and is
    // kept as a forward guard. Both mirror pnpm-workspace.yaml's `allowBuilds`,
    // where the esbuild entry is NOT optional. Assert for every PM + css variant.
    for (const pm of ['bun', 'pnpm', 'npm', 'yarn'] as const) {
      for (const withCss of [false, true]) {
        const pkg = JSON.parse(appPackageJson('demo', pm, withCss)) as {
          trustedDependencies?: string[]
        }
        expect(pkg.trustedDependencies, `pm=${pm} css=${withCss}`).toEqual([
          '@aihu/compiler',
          'esbuild',
        ])
      }
    }
  })
})

describe('appViteConfig', () => {
  it('imports viteAihuPlugin from @aihu/app', () => {
    expect(appViteConfig()).toContain("import { viteAihuPlugin } from '@aihu/app'")
  })

  it('imports defineConfig from vite', () => {
    expect(appViteConfig()).toContain("from 'vite'")
  })

  it('wires viteAihuPlugin into the plugins array', () => {
    expect(appViteConfig()).toContain('viteAihuPlugin(')
  })

  it('points the router at src/pages', () => {
    // `viteAihuPlugin({ dir: { pages: 'src/pages' } })` matches the
    // scaffold's `src/pages/index.aihu` location and the convention used by
    // `examples/blog-router`.
    expect(appViteConfig()).toContain("pages: 'src/pages'")
  })
})

describe('appAihuConfig', () => {
  it('references defineAihuConfig', () => {
    expect(appAihuConfig()).toContain('defineAihuConfig')
  })

  it('sets build.target to universal', () => {
    expect(appAihuConfig()).toContain("target: 'universal'")
  })
})

describe('appIndexAihu', () => {
  it('has a @state block with signal import', () => {
    expect(appIndexAihu()).toContain('@state')
    expect(appIndexAihu()).toContain("from '@aihu/signals'")
  })

  it('has a @template block', () => {
    expect(appIndexAihu()).toContain('@template')
  })

  it('uses v1 signal pattern', () => {
    expect(appIndexAihu()).toContain('signal(')
  })
})

describe('appDefaultLayout', () => {
  it('has a @template block with <slot />', () => {
    expect(appDefaultLayout()).toContain('<slot />')
  })
})

describe('pageAihu', () => {
  it('sets route name from path, suffixing -page to keep it hyphenated', () => {
    // Single-segment path has no hyphen, so `-page` is appended to make it a
    // valid (mountable) custom-element tag.
    expect(pageAihu('/about')).toContain("name: 'about-page'")
  })

  it('converts nested path to kebab name (already hyphenated, left as-is)', () => {
    expect(pageAihu('/admin/users')).toContain("name: 'admin-users'")
  })

  it('falls back to "page-page" for root path', () => {
    expect(pageAihu('/')).toContain("name: 'page-page'")
  })
})

describe('componentAihu', () => {
  it('produces a @template block', () => {
    expect(componentAihu('MyCard')).toContain('@template')
  })

  it('uses kebab-case class name', () => {
    expect(componentAihu('MyCard')).toContain('my-card')
  })
})

describe('pluginPackageJson', () => {
  it('names the package aihu-plugin-<kebab>', () => {
    const pkg = JSON.parse(pluginPackageJson('MyForms')) as { name: string }
    expect(pkg.name).toBe('aihu-plugin-my-forms')
  })

  it('has @aihu/plugin as peerDependency', () => {
    const pkg = JSON.parse(pluginPackageJson('forms')) as {
      peerDependencies: Record<string, string>
    }
    expect(pkg.peerDependencies).toHaveProperty('@aihu/plugin')
  })
})

describe('pluginIndex', () => {
  it('calls definePlugin with the given name', () => {
    expect(pluginIndex('forms')).toContain("name: 'forms'")
  })

  it('uses kebab namespace', () => {
    expect(pluginIndex('MyForms')).toContain("namespace: 'my-forms'")
  })
})

describe('toKebab', () => {
  it('converts CamelCase to kebab-case', () => {
    expect(toKebab('MyComponent')).toBe('my-component')
  })

  it('leaves lowercase unchanged', () => {
    expect(toKebab('foo')).toBe('foo')
  })

  it('replaces spaces with hyphens', () => {
    expect(toKebab('foo bar')).toBe('foo-bar')
  })

  it('collapses multiple hyphens', () => {
    expect(toKebab('foo--bar')).toBe('foo-bar')
  })
})

describe('toSafe', () => {
  it('lowercases the name', () => {
    expect(toSafe('MyApp')).toBe('myapp')
  })

  it('replaces non-alphanumeric with hyphens', () => {
    expect(toSafe('my app!')).toBe('my-app')
  })

  it('removes leading non-alpha', () => {
    expect(toSafe('123app')).toBe('app')
  })

  it('falls back to "app" for empty input', () => {
    expect(toSafe('')).toBe('app')
  })
})

// ---------------------------------------------------------------------------
// Scaffold functions (with temp directory)
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'aihu-cli-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('scaffoldApp · project-name validation', () => {
  it('refuses to escape the project directory', () => {
    // Measured before the fix, against the built `dist/bin.js`:
    // `aihu app ../../ESCAPED` wrote a complete 11-file project two
    // directories ABOVE the cwd and exited 0. `scaffoldPage` had grown a
    // traversal guard for exactly this; `scaffoldApp` and `scaffoldPlugin`
    // never got one.
    expect(() => scaffoldApp('../../ESCAPED', tmpDir)).toThrow(/not usable/)
    expect(existsSync(join(tmpDir, '..', '..', 'ESCAPED'))).toBe(false)
    expect(readdirSync(tmpDir)).toEqual([])
  })

  it('names the traversal as a traversal, not just a bad name', () => {
    expect(() => scaffoldApp('../x', tmpDir)).toThrow(/write outside the current directory/)
    expect(() => scaffoldApp('/abs/path', tmpDir)).toThrow(/write outside the current directory/)
  })

  it('refuses a name npm would reject, which the next command depends on', () => {
    // The escaped scaffold above also emitted `"name": "../../ESCAPED"` — not a
    // legal npm package name — so the `bun install` the CLI prints as the very
    // next step fails on the tree it just created.
    for (const bad of ['9app', 'BadCase', 'my_app', 'my.app', '@scope/app', '']) {
      expect(() => scaffoldApp(bad, tmpDir), bad).toThrow(/not usable/)
    }
    expect(readdirSync(tmpDir)).toEqual([])
  })

  it('agrees with the template pipeline about what a legal name is', () => {
    // The two paths used to disagree: `mergeOptions` enforced this regex and
    // `scaffoldApp` enforced nothing, so the same string was legal on one
    // scaffold path and not the other.
    expect(() => scaffoldApp('my-app-2', tmpDir)).not.toThrow()
    expect(existsSync(join(tmpDir, 'my-app-2', 'package.json'))).toBe(true)
  })
})

describe('scaffoldApp', () => {
  it('creates the 11 expected files (8 baseline + agent-tooling trio)', () => {
    const result = scaffoldApp('demo', tmpDir)
    // 11, not 12: src/main.ts is no longer scaffolded — viteAihuPlugin's
    // aihu-entry sub-plugin injects a virtual equivalent (see
    // appMainTs's doc comment for the escape hatch). pnpm-workspace.yaml is
    // still part of the baseline: current pnpm reads its settings from that
    // file only, so without it the first `pnpm install` dies with
    // ERR_PNPM_IGNORED_BUILDS (C-FEL-SCAFFOLD-PM-COMPAT).
    expect(result.created).toHaveLength(11)
    expect(result.created).toContain('pnpm-workspace.yaml')
    expect(result.created).toContain('AGENTS.md')
    expect(result.created).toContain('CLAUDE.md')
    expect(result.created).toContain('.mcp.json')
    expect(result.created).not.toContain('src/main.ts')
    expect(result.skipped).toHaveLength(0)
  })

  it('agentTooling: false drops exactly the coding-assistant trio', () => {
    const result = scaffoldApp('demo', tmpDir, { agentTooling: false })
    expect(result.created).toHaveLength(8)
    expect(result.created).not.toContain('AGENTS.md')
    expect(result.created).not.toContain('CLAUDE.md')
    expect(result.created).not.toContain('.mcp.json')
  })

  it('writes .vscode/extensions.json', () => {
    scaffoldApp('demo', tmpDir)
    expect(existsSync(join(tmpDir, 'demo', '.vscode', 'extensions.json'))).toBe(true)
  })

  it('writes .vscode/settings.json', () => {
    scaffoldApp('demo', tmpDir)
    expect(existsSync(join(tmpDir, 'demo', '.vscode', 'settings.json'))).toBe(true)
  })

  it('writes package.json with the correct name', () => {
    scaffoldApp('my-app', tmpDir)
    const raw = readFileSync(join(tmpDir, 'my-app', 'package.json'), 'utf8')
    const pkg = JSON.parse(raw) as { name: string }
    expect(pkg.name).toBe('my-app')
  })

  it('writes vite.config.ts', () => {
    scaffoldApp('demo', tmpDir)
    expect(existsSync(join(tmpDir, 'demo', 'vite.config.ts'))).toBe(true)
  })

  it('does not write a stale rolldown.config.ts', () => {
    // Regression guard: the prior scaffold wrote `rolldown.config.ts` and
    // missed the router plugin entirely, so `bun run dev` could not route.
    scaffoldApp('demo', tmpDir)
    expect(existsSync(join(tmpDir, 'demo', 'rolldown.config.ts'))).toBe(false)
  })

  it('writes index.html with an outlet div and no hardcoded entry script (not a custom-element root)', () => {
    // `createApp()` looks up `document.getElementById('outlet')`; an
    // index.html with `<demo-root>` instead of `<div id="outlet">` boots to
    // a hard error. No <script> tag: viteAihuPlugin's aihu-entry sub-plugin
    // injects one pointing at virtual:aihu-entry when src/main.ts is absent.
    scaffoldApp('demo', tmpDir)
    const html = readFileSync(join(tmpDir, 'demo', 'index.html'), 'utf8')
    expect(html).toContain('id="outlet"')
    expect(html).not.toContain('<script')
  })

  it('writes src/pages/index.aihu', () => {
    scaffoldApp('demo', tmpDir)
    expect(existsSync(join(tmpDir, 'demo', 'src', 'pages', 'index.aihu'))).toBe(true)
  })

  it('writes index.html', () => {
    scaffoldApp('demo', tmpDir)
    expect(existsSync(join(tmpDir, 'demo', 'index.html'))).toBe(true)
  })

  it('does NOT write src/main.ts (virtual entry covers the default case)', () => {
    scaffoldApp('demo', tmpDir)
    expect(existsSync(join(tmpDir, 'demo', 'src', 'main.ts'))).toBe(false)
  })

  it('skips existing files on re-run', () => {
    scaffoldApp('demo', tmpDir)
    const second = scaffoldApp('demo', tmpDir)
    expect(second.created).toHaveLength(0)
    expect(second.skipped).toHaveLength(11)
  })

  it('writes package.json with trustedDependencies on disk (FIX 1)', () => {
    scaffoldApp('demo', tmpDir)
    const pkg = JSON.parse(readFileSync(join(tmpDir, 'demo', 'package.json'), 'utf8')) as {
      trustedDependencies?: string[]
    }
    expect(pkg.trustedDependencies).toEqual(['@aihu/compiler', 'esbuild'])
  })
})

describe('scaffoldApp · template differentiation (FIX 3)', () => {
  it('minimal produces the baseline set (no layout, no extra pages)', () => {
    const result = scaffoldApp('demo', tmpDir, { template: 'minimal' })
    expect(result.created).toHaveLength(11)
    expect(result.created).not.toContain('src/layouts/default.aihu')
    expect(result.created).not.toContain('src/pages/about.aihu')
  })

  it('full is the word-game dual-experience template on the bridge architecture', () => {
    const result = scaffoldApp('demo', tmpDir, { template: 'full' })
    // The former `agent` machinery folds in: gate, MCP stdio, live readiness.
    expect(result.created).toContain('server.ts')
    expect(result.created).toContain('mcp.ts')
    expect(result.created).toContain('readiness.ts')
    expect(result.created).toContain('src/word-duet.aihu')
    expect(result.created).toContain('.env.example')
    expect(result.created).toContain('README.md')
    // The dishonest static integration is NOT wired: readiness is served live.
    const vite = readFileSync(join(tmpDir, 'demo', 'vite.config.ts'), 'utf8')
    expect(vite).not.toContain('viteAgentReadinessIntegration')
    expect(vite).toContain("'/model': BRIDGE")
    // The component's two actions exist and the server metadata mirrors them.
    const sfc = readFileSync(join(tmpDir, 'demo', 'src', 'word-duet.aihu'), 'utf8')
    const server = readFileSync(join(tmpDir, 'demo', 'server.ts'), 'utf8')
    for (const action of ['guess', 'newGame']) {
      expect(sfc).toContain(action)
      expect(server).toContain(action)
    }
    // The model player goes through the same gate as any outside agent.
    expect(server).toContain("server.callTool(TAG + '/guess'")
    expect(server).toContain("jwt: 'game:play'")
  })

  it('docs adds a guide page and a docs-flavored index', () => {
    const result = scaffoldApp('demo', tmpDir, { template: 'docs' })
    expect(result.created).toContain('src/pages/guide.aihu')
    expect(result.created).not.toContain('src/pages/about.aihu')
    const index = readFileSync(join(tmpDir, 'demo', 'src', 'pages', 'index.aihu'), 'utf8')
    expect(index).toContain('docs')
  })

  it('the three templates produce distinct file sets', () => {
    const minimal = scaffoldApp('m', tmpDir, { template: 'minimal' }).created
    const full = scaffoldApp('f', tmpDir, { template: 'full' }).created
    const docs = scaffoldApp('d', tmpDir, { template: 'docs' }).created
    expect(full.length).toBeGreaterThan(minimal.length)
    expect(docs.length).toBeGreaterThan(minimal.length)
    expect([...full].sort()).not.toEqual([...docs].sort())
  })
})

describe('scaffoldPage', () => {
  it('creates a page file at the correct path', () => {
    scaffoldPage('/about', tmpDir)
    expect(existsSync(join(tmpDir, 'src', 'pages', 'about.aihu'))).toBe(true)
  })

  it('handles nested routes', () => {
    scaffoldPage('/admin/users', tmpDir)
    expect(existsSync(join(tmpDir, 'src', 'pages', 'admin', 'users.aihu'))).toBe(true)
  })

  it('falls back to index.aihu for root path', () => {
    scaffoldPage('/', tmpDir)
    expect(existsSync(join(tmpDir, 'src', 'pages', 'index.aihu'))).toBe(true)
  })

  it('rejects a route containing a .. segment rather than writing outside src/pages/', () => {
    expect(() => scaffoldPage('../../../../../ESCAPED', tmpDir)).toThrow(/\.\./)
    expect(existsSync(join(tmpDir, '..', '..', '..', '..', 'ESCAPED.aihu'))).toBe(false)
  })

  it('rejects a route containing a . segment', () => {
    expect(() => scaffoldPage('./foo', tmpDir)).toThrow(/\./)
  })

  it('rejects a Windows-style ..\\ segment, which the `/`-only split let through', () => {
    // On POSIX `\` is an ordinary filename character, so this wrote a literal
    // `..\..\WINESC.aihu` inside src/pages/ — harmless here, a real traversal
    // on Win32 where `join()` treats `\` as a separator. The guard has to
    // reject on every platform or it is not a guard.
    expect(() => scaffoldPage('..\\..\\WINESC', tmpDir)).toThrow(/\.\.|backslash/)
    expect(existsSync(join(tmpDir, 'src', 'pages', '..\\..\\WINESC.aihu'))).toBe(false)
  })

  it('rejects a backslash anywhere in a route — never a legal route character', () => {
    expect(() => scaffoldPage('admin\\users', tmpDir)).toThrow(/backslash/)
  })
})

describe('scaffoldComponent', () => {
  it('creates a component file with kebab name', () => {
    scaffoldComponent('MyCard', tmpDir)
    expect(existsSync(join(tmpDir, 'src', 'components', 'my-card.aihu'))).toBe(true)
  })
})

describe('scaffoldPlugin', () => {
  it('creates package.json and src/index.ts', () => {
    const result = scaffoldPlugin('forms', tmpDir)
    expect(result.created).toHaveLength(2)
  })

  it('writes the plugin directory as aihu-plugin-<kebab>', () => {
    scaffoldPlugin('my-forms', tmpDir)
    expect(existsSync(join(tmpDir, 'aihu-plugin-my-forms', 'package.json'))).toBe(true)
    expect(existsSync(join(tmpDir, 'aihu-plugin-my-forms', 'src', 'index.ts'))).toBe(true)
  })

  it('refuses a path-shaped name instead of mangling it into a directory', () => {
    // `toKebab` turned `../../X` into `-x`, so this could not traverse the way
    // `scaffoldApp` could — but it scaffolded `aihu-plugin--x` and reported
    // success. Silently renaming what the author typed is the failure mode
    // `scaffoldComponent`'s docblock already refuses.
    expect(() => scaffoldPlugin('../../PESCAPED', tmpDir)).toThrow(/not usable/)
    expect(readdirSync(tmpDir)).toEqual([])
  })

  it('refuses a name that is not a legal package name', () => {
    // `pluginIndex()` interpolates the raw name into a single-quoted JS string
    // literal in the generated source — an unvalidated name is an injection
    // into the file the user is about to run.
    expect(() => scaffoldPlugin("x'; evil()//", tmpDir)).toThrow(/not usable/)
    expect(() => scaffoldPlugin('9forms', tmpDir)).toThrow(/not usable/)
    expect(readdirSync(tmpDir)).toEqual([])
  })

  it('suggests the kebab form rather than silently applying it', () => {
    expect(() => scaffoldPlugin('MyForms', tmpDir)).toThrow(/'my-forms'/)
  })
})

describe("scaffoldApp · template 'agent' (capability-bridge showcase)", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aihu-agent-tmpl-'))
  })
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('emits the two-process agent file set (server.ts + client-target vite + component), not the pages base', () => {
    scaffoldApp('myagent', dir, { template: 'agent' })
    const root = join(dir, 'myagent')
    for (const f of [
      'server.ts',
      'vite.config.ts',
      'src/main.ts',
      'src/task-list.aihu',
      'src/aihu-modules.d.ts',
      'index.html',
    ]) {
      expect(existsSync(join(root, f)), `${f} should exist`).toBe(true)
    }
    expect(existsSync(join(root, 'src/pages/index.aihu'))).toBe(false)
  })

  it('wires the bridge: client compiler target, @aihu/agent-server dep, @agent surface + human controls', () => {
    scaffoldApp('myagent', dir, { template: 'agent' })
    const root = join(dir, 'myagent')
    const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8')
    expect(vite).toContain("target: 'client'")
    expect(vite).toContain("'/agent'")
    expect(vite).toContain("'/bridge'")

    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(pkg.dependencies['@aihu/agent-server']).toBe(aihuDep('@aihu/agent-server'))

    const sfc = readFileSync(join(root, 'src/task-list.aihu'), 'utf8')
    expect(sfc).toContain('@agent')
    // The v2 collection-form vocabulary: `const x = action({ … }, fn)`, NOT the
    // retired v1 `$action:` block (C440). The metadata that used to live in
    // `@agent` is now per-entry `describe:` / `expose:` on the @state member.
    expect(sfc).toContain('= action(')
    expect(sfc).toContain("expose: 'read write'")
    expect(sfc).toContain('addTask')
    expect(sfc).toContain('on:submit.prevent={addFromInput}')
    // client-durable state: hydrates from + persists to localStorage (survives refresh)
    expect(sfc).toContain('localStorage')
    expect(sfc).toContain('aihu:task-list:v2')

    // The project theme the component's utility classes resolve against, and
    // the two places vite.config.ts consumes it.
    expect(existsSync(join(root, 'src/theme.css'))).toBe(true)
    expect(vite).toContain('css: { theme }')
    expect(vite).toContain('themeRuntimePlugin')
  })

  // The agent template is the one named for agents; before this it was the only
  // template with NO agent-readiness surface (the generic `full` template had
  // one). It gets the surface from its own server rather than from
  // viteAgentReadinessIntegration, because a browser-target vite build has an
  // empty @aihu/agent registry — statically emitted documents would exist and
  // advertise zero tools.
  it('serves a live, registry-derived discovery surface from the app server', () => {
    scaffoldApp('myagent', dir, { template: 'agent' })
    const root = join(dir, 'myagent')

    // The generator module exists and is in the typecheck program.
    expect(existsSync(join(root, 'readiness.ts'))).toBe(true)
    const tsconfig = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8')) as {
      include: string[]
    }
    expect(tsconfig.include).toContain('readiness.ts')

    // Runtime (not dev) dependency: `bun server.ts` imports it.
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    expect(pkg.dependencies['@aihu-plugin/agent-readiness']).toBe(
      aihuDep('@aihu-plugin/agent-readiness'),
    )
    expect(pkg.devDependencies['@aihu-plugin/agent-readiness']).toBeUndefined()

    // The fetch-API route handlers, not the vite plugin.
    const readiness = readFileSync(join(root, 'readiness.ts'), 'utf8')
    expect(readiness).toContain('createAgentReadinessRoutes')
    expect(readiness).not.toContain('viteAgentReadinessIntegration')
    for (const path of [
      '/llms.txt',
      '/llms-full.txt',
      '/robots.txt',
      '/.well-known/mcp/server-card.json',
      '/.well-known/agent-card.json',
      '/.well-known/mcp.json',
    ]) {
      expect(readiness, `${path} should be routed`).toContain(`'${path}'`)
    }
    // A path we do not serve must fall through to the app's 404 rather than be
    // answered with some other document at 200.
    expect(readiness).toContain('res.status === 404 ? undefined : res')

    // BOTH entry points dispatch it — whichever process holds :5208, an agent
    // that has only the URL finds the surface.
    for (const entry of ['server.ts', 'mcp.ts']) {
      expect(readFileSync(join(root, entry), 'utf8'), entry).toContain(
        'const readiness = await handleReadiness(req)',
      )
    }

    // The registry entry the documents derive from carries the describe: text
    // that becomes each MCP tool's description.
    const server = readFileSync(join(root, 'server.ts'), 'utf8')
    expect(server).toContain("describe: 'Append a task with the given text.'")

    // Reachable on the app's own origin, in dev and in preview.
    const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8')
    expect(vite).toContain("'/llms.txt': READINESS")
    expect(vite).toContain("'/.well-known': READINESS")
    // The documents embed absolute URLs built from the request Host; rewriting
    // it to the internal port would hand an agent links it was never given.
    expect(vite).toContain('const READINESS = { target: BRIDGE, changeOrigin: false }')
    expect(vite).toContain('server: { proxy: AGENT_SURFACE }')
    expect(vite).toContain('preview: { proxy: AGENT_SURFACE }')
  })
})
