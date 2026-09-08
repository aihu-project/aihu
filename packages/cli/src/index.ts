/**
 * @aihu/cli — build-time CLI scaffolder for aihu applications.
 *
 * v0.8.1: `@aihu/cli` package exposing scaffold functions for `aihu app`,
 * `aihu page`, `aihu component`, and `aihu plugin` commands.
 *
 * v0.8.5: Plugin scaffold template — `npx aihu plugin <name>` produces a
 * skeleton plugin package with `definePlugin` wired.
 *
 * v0.2.x scaffold: Vite + `viteAihuPlugin()` (compiler + router +
 * agent-readiness composed). Mirrors `examples/blog-router` — the
 * documented v1 pattern. The earlier rolldown-based scaffold imported
 * `virtual:aihu-routes` (a Vite-plugin virtual module) inside
 * `createApp()` but had no rolldown equivalent for the plugin, so
 * `npx aihu app NAME && bun run dev` could not actually route.
 *
 * Per Learning #49 (v3 dep-free thesis): zero non-Node built-in dependencies.
 * All templates are embedded as pure string functions — no runtime file reads.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { aihuDep } from './dep-versions.js'
import { packageManagerField } from './pkg-manager-field.js'
import { assertProjectName, assertRouteSegments } from './project-name.js'
import {
  agentComponentAihu,
  agentIndexHtml,
  agentMainTs,
  agentMcpTs,
  agentModuleShim,
  agentPackageJson,
  agentReadinessTs,
  agentReadme,
  agentServerTs,
  agentTsConfig,
  agentViteConfig,
} from './templates-agent.js'
import { fullTemplateFiles } from './templates-full.js'
import { ssrAgentsFacts, ssrPackageJson, ssrReadme, ssrViteConfig } from './templates-ssr.js'
import {
  agentToolingFiles,
  pnpmWorkspaceYaml,
  viteTemplateAgentsFacts,
} from './templates-tooling.js'

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ScaffoldResult {
  /** Files that were written. */
  readonly created: ReadonlyArray<string>
  /** Files skipped because they already existed. */
  readonly skipped: ReadonlyArray<string>
}

// ---------------------------------------------------------------------------
// Template generators — pure functions (no I/O; fully testable)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Template variants
// ---------------------------------------------------------------------------

export type PkgManager = 'bun' | 'pnpm' | 'npm' | 'yarn'
export type AppTemplate = 'minimal' | 'full' | 'docs' | 'agent' | 'ssr'

/** Out-of-the-box CSS strategy for a scaffolded app. */
export type CssChoice = 'engine' | 'none'
/** Shadow-DOM mode threaded into the compiler when css-engine is opted in. */
export type ShadowChoice = 'light' | 'shadow'

// ---------------------------------------------------------------------------
// App template generators (Vite + viteAihuPlugin, v1 syntax)
// ---------------------------------------------------------------------------

/** package.json for a new aihu application.
 *
 * When `withCssEngine` is true, `@aihu/css-engine` is added to `dependencies`
 * so the OOTB utility-class scaffold resolves the optional compiler peer.
 */
export function appPackageJson(
  name: string,
  pm: PkgManager = 'bun',
  withCssEngine = false,
): string {
  // `<pm>@<version>` for whichever `--pm` was chosen — see pkg-manager-field.ts
  // for why the previous inline version of this line made `--pm` a no-op under
  // the published node-shebang binary for EVERY value, bun included.
  const packageManager = packageManagerField(pm)

  return JSON.stringify(
    {
      name,
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        preview: 'vite preview',
        // `aihu-tsc`, not `tsc`: plain tsc cannot see inside a `.aihu` file, so it
        // would report a clean pass over every SFC in the project without having
        // type-checked a line of one.
        typecheck: 'aihu-tsc',
      },
      dependencies: {
        // `@aihu/app` re-exports `viteAihuPlugin` (the composed compiler +
        // router + agent-readiness plugin) and ships `createApp()`. Runtime
        // primitives are listed explicitly because `@state` blocks bare-import
        // them (e.g. `import { signal } from '@aihu/signals'`); pinning them
        // here keeps version drift visible at `bun outdated`.
        '@aihu/app': aihuDep('@aihu/app'),
        // The compiler unconditionally emits `import { registerAgentMetadata }
        // from '@aihu/agent'` for any component with an `$action` block — and
        // the scaffolded counter component always has one. `@aihu/agent` is a
        // real `dependencies` entry of `@aihu/server`, so bun/npm/yarn's
        // hoisted `node_modules` resolve the transitive import anyway; pnpm's
        // strict per-package resolution does not expose it, so `pnpm run
        // build` fails with an unresolved import unless it is listed here too.
        '@aihu/agent': aihuDep('@aihu/agent'),
        '@aihu/arbor': aihuDep('@aihu/arbor'),
        // Peer of `@aihu/runtime`, which is why it is easy to miss: it is not a
        // peer of `@aihu/app`, so satisfying app's own list is not enough.
        // `@aihu/app`, `@aihu/runtime` and `@aihu/arbor` all declare ZERO
        // dependencies and express every edge as a peer, so what a scaffold has
        // to install is the TRANSITIVE PEER CLOSURE, not one package's list.
        // Missing it took `full` and `agent` from a yarn build failure on
        // `@aihu/store` to a yarn build failure on `@aihu/context` — one layer
        // down the same chain (run 30333109465).
        '@aihu/context': aihuDep('@aihu/context'),
        // `@aihu/css-engine` is the optional utility-class compiler peer; only
        // emitted for the OOTB css-engine scaffold (`--css engine`). Its scoped
        // utilities fold into each component's shadow style at build time.
        ...(withCssEngine ? { '@aihu/css-engine': aihuDep('@aihu/css-engine') } : {}),
        '@aihu/router': aihuDep('@aihu/router'),
        '@aihu/runtime': aihuDep('@aihu/runtime'),
        // `@aihu/server` and `@aihu/store` are peers of `@aihu/app` that its
        // CLIENT entry imports eagerly — `hydrateStores` from `@aihu/store` and
        // `routeHeadToSsrHead` from `@aihu/server/head-lowering`. `@aihu/app`
        // declares NO runtime `dependencies` at all; every one of its imports is
        // a peer, so a consumer must list them or nothing installs them.
        //
        // npm 7+, pnpm and bun auto-install peers, which hid this: the scaffold
        // worked on three of four package managers. YARN 1 DOES NOT, so it was
        // the only one to fail — `yarn run build` died at config load with
        // ERR_MODULE_NOT_FOUND "Cannot find package '@aihu/store' imported from
        // node_modules/@aihu/app/dist/index.js" (run 30322552896, 4 cells).
        //
        // The fix belongs HERE and not in `@aihu/app`'s dependencies: promoting
        // a peer to a dependency lets the app install its own copy alongside the
        // consumer's, and two `@aihu/store` instances mean two module-level
        // store registries — hydration writes to one and reads from the other.
        // Same reasoning as `@aihu-plugin/agent-readiness` below.
        '@aihu/server': aihuDep('@aihu/server'),
        '@aihu/signals': aihuDep('@aihu/signals'),
        '@aihu/store': aihuDep('@aihu/store'),
      },
      devDependencies: {
        // `@aihu-plugin/agent-readiness` powers the `agentReadiness` pass in
        // vite.config.ts (llms.txt + MCP server-card emission). It is a
        // devDependency of `@aihu/app`, NOT a transitive runtime dep, so a
        // consumer must list it explicitly — otherwise `viteAihuPlugin`'s
        // `require('@aihu-plugin/agent-readiness')` throws at config load.
        '@aihu-plugin/agent-readiness': aihuDep('@aihu-plugin/agent-readiness'),
        '@aihu/cli': aihuDep('@aihu/cli'),
        '@aihu/compiler': aihuDep('@aihu/compiler'),
        // Provides `aihu-tsc` — the `typecheck` script above.
        '@aihu/tsc': aihuDep('@aihu/tsc'),
        typescript: '^5.0.0',
        vite: aihuDep('vite'),
      },
      // The same two packages as the emitted `pnpm-workspace.yaml`'s
      // `allowBuilds`, deliberately kept in step. Both entries were re-measured
      // rather than inherited, and the answers were not what the comment here
      // used to claim:
      //
      //   `@aihu/compiler` — ships NO install script today. `npm view
      //   @aihu/compiler@1.2.0 scripts` lists build/typecheck/prepublishOnly and
      //   nothing else; the arch-validating postinstall this line was originally
      //   written for was deleted in #370, which replaced it with per-platform
      //   `optionalDependencies`. So the entry is INERT, and is kept only as a
      //   forward guard: that delivery mechanism has already changed once, and a
      //   blocked script does not fail at install time — it surfaces much later
      //   as ENOEXEC ("Unknown system error -8") inside `run build`.
      //
      //   `esbuild` — the one package in a scaffold that DOES postinstall (it
      //   links the platform binary), reached transitively through vite 6. It is
      //   listed here even though bun currently ships `esbuild` in its BUILT-IN
      //   allow-list (`bun pm default-trusted`, 367 entries, verified to contain
      //   it), because relying on that list makes the manifest silent about its
      //   own requirement — and it is NOT optional on the pnpm side, where a
      //   missing entry exits 1 with ERR_PNPM_IGNORED_BUILDS before the first
      //   build. Under `vite ^8` there is no esbuild at all and the entry is
      //   simply unused; `^6 || ^8` means both installs are possible from the
      //   same manifest.
      //
      // Verified that naming packages here does not DISABLE bun's built-in list:
      // a probe project depending on esbuild@0.25.12 with
      // `trustedDependencies: ['@aihu/compiler']` still ran esbuild's script
      // (`bun pm untrusted` → 0 untrusted, binary resolvable).
      trustedDependencies: ['@aihu/compiler', 'esbuild'],
      // NOTE: pnpm's counterpart to `trustedDependencies` is NOT here. Current
      // pnpm does not read settings from package.json at all — it says so, out
      // loud, and then ignores them:
      //
      //   [WARN] The "pnpm" field in package.json is no longer read by pnpm.
      //          The following keys were ignored: "pnpm.onlyBuiltDependencies".
      //
      // It lives in the emitted `pnpm-workspace.yaml` instead. See
      // pnpmWorkspaceYaml() below for why that file ships even for a
      // single-package scaffold.
      ...(packageManager ? { packageManager } : {}),
    },
    null,
    2,
  )
}

/** vite.config.ts for a new aihu application (`minimal` and `docs`).
 *
 * `viteAihuPlugin()` composes the compiler plugin, the router plugin (which
 * provides `virtual:aihu-routes` consumed by `createApp()`), the head/SSG
 * plugins, and an opt-in agent-readiness pass — see `@aihu/app/vite-plugin`.
 * `dir.pages` tells the router where to scan for `.aihu` page files; this
 * mirrors `examples/blog-router/vite.config.ts`.
 *
 * WHY THIS EMITS AGENT-READINESS AT BUILD TIME RATHER THAN SERVING IT (FEL-423).
 *
 * `full` and `agent` derive their readiness documents from a LIVE registry via
 * `createAgentReadinessRoutes()`, served by the process that owns it
 * (`templates-full.ts:607`, `templates-agent.ts:276`). That is the better
 * design, and it is unavailable here by construction: `minimal` and `docs`
 * scaffold no server at all — no `server.ts`, no `mcp.ts`, no `readiness.ts`
 * (see the shared base in `scaffoldApp`). There is no process to serve from.
 * Giving them one would change what those templates ARE — a static client
 * build — rather than fix a defect, so it was deliberately not done.
 *
 * What that costs, stated honestly: the emitted `llms.txt` carries the app's
 * name and summary but NO `## Components` section, even though the scaffolded
 * page declares `$action` entries. The cause is not in this file — a client
 * target strips `registerAgentMetadata` by design (`elide_agent`,
 * the standalone compiler emitter, so the generator faithfully
 * renders an empty registry. Tracked as FEL-434; when that emission lands this
 * document fills in with no change here.
 *
 * The documents are still emitted rather than suppressed because what they DO
 * say is now true: no MCP server card and no A2A card are published, so
 * nothing advertises capabilities it cannot answer for. A missing file would
 * be honest too, but deleting the surface now means re-adding it later.
 */
export function appViteConfig(
  appName = 'app',
  withCssEngine = false,
  shadowMode?: ShadowChoice,
): string {
  const tag = `${toSafe(appName)}-root`
  // DA4 (#437, the flip): pages and layouts default to light DOM; leaves keep
  // shadow. A css-engine scaffold emits the plugin-global
  // `css: { shadowMode: … }` block ONLY when the user explicitly chose a mode
  // (`--shadow light|shadow` or the wizard) — the config tier outranks the
  // page/layout default, so an explicit choice must be carried here or the
  // page default 'light' would silently override `--shadow shadow`. With no
  // choice, nothing is emitted and the framework defaults apply — a scaffold
  // that pins the default freezes it (FEL-425: the old unconditional
  // `'shadow'` fallback silently reversed the DA4 flip for exactly the
  // scaffold that most needs global CSS to reach component internals). The
  // plain (css-off) scaffold pins `$shadow: 'light'` per-file instead and
  // emits no css block.
  const emitCssBlock = withCssEngine && shadowMode !== undefined
  const cssEngineComment = withCssEngine
    ? emitCssBlock
      ? `      // @aihu/css-engine utility classes fold into each component's shadow
      // <style> automatically (or into the global cascade under 'light').
      // Explicit --shadow choice, carried project-wide as the plugin-global
      // config — it outranks the DA4 page/layout default (only a per-file
      // $shadow pin outranks the config).
`
      : `      // @aihu/css-engine utility classes fold into the global cascade for
      // light-DOM components and into each shadow component's <style>.
      // DA4 defaults apply: pages and layouts are light DOM, leaf components
      // are shadow. To force one mode project-wide, pass
      // \`shadowMode: 'light' | 'shadow'\` via the plugin's \`css\` option
      // below (a per-file $shadow pin outranks it).
`
    : ''
  const cssBlock = emitCssBlock ? `      css: { shadowMode: '${shadowMode}' },\n` : ''
  return `import { viteAihuPlugin } from '@aihu/app'
import { defineConfig } from 'vite'

export default defineConfig({
  // Vite/esbuild pre-bundles dependencies for dev. \`@aihu/app\`'s client entry
  // imports the \`virtual:aihu-routes\` / \`virtual:aihu-layouts\` modules that the
  // router plugin resolves at request time — esbuild's pre-bundle pass can't see
  // them, so it MUST be excluded or \`vite dev\` fails to start.
  optimizeDeps: { exclude: ['@aihu/app'] },
  plugins: [
    // This is the whole aihu configuration surface. It lives here rather than
    // in a separate aihu.config.ts on purpose: the \`aihu\` CLI and the language
    // server read it straight out of this file (via the plugin's own api
    // handle), so a second file would only be a place for the two to drift.
    viteAihuPlugin({
${cssEngineComment}      dir: { pages: 'src/pages' },
${cssBlock}
      // Injected into index.html's <head> at build time.
      app: {
        head: {
          title: '${appName}',
        },
      },

      // ── Agent + SEO surface ───────────────────────────────────────────
      // Emits /llms.txt, /llms-full.txt, /robots.txt and JSON-LD at build
      // time, and serves them in \`vite dev\`. Set to \`false\` to turn the
      // whole surface off.
      //
      // Honesty rule: this is a STATIC CLIENT build, whose @aihu/agent
      // registry is empty at build time. A client target compiles \`$action\`
      // entries out (they are server-only artifacts), so
      // <${tag}> publishes a declaration here, not callable tools.
      // This therefore declares NO MCP \`endpoint\` and no A2A card: a card at
      // the right path advertising zero tools is indistinguishable from a
      // real one to anything that reads it. The \`full\` template ships the
      // server that serves those cards from the LIVE registry, listing
      // exactly the callable tools. Run under @aihu/server (SSR) and set
      // \`endpoint\` to the real MCP URL to make them callable.
      agentReadiness: {
        name: '${appName}',
        summary:
          'A reactive Web Components app built with aihu. Static build — component ' +
          'actions are declared in source; no live tool endpoint is served here.',
        version: '0.1.0',
        // Replace with your deployed origin. Drives JSON-LD, robots'
        // Sitemap: line, and absolute URLs in the generated documents.
        siteUrl: 'https://example.com',
      },
    }),
  ],
})
`
}

/** tsconfig.json for a new aihu application. */
export function appTsConfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        noEmit: true,
      },
      include: ['src'],
    },
    null,
    2,
  )}\n`
}

/**
 * src/main.ts entry point for a new aihu app.
 *
 * NOT written by `scaffoldApp` by default — `viteAihuPlugin`'s `aihu-entry`
 * sub-plugin (packages/app/src/vite-plugin.ts) now injects a virtual
 * equivalent (`virtual:aihu-entry`) into `index.html` whenever no real
 * `src/main.ts` is present, so a fresh scaffold never needs this file. Kept
 * exported, and still generates byte-identical content, as the ESCAPE HATCH:
 * a project that needs `createApp(options)` (e.g. `provide`, `outletId`, a
 * non-default `head`) writes this file for real, which makes the virtual
 * entry step aside entirely (see `aihu-entry`'s `transformIndexHtml` hook).
 */
export function appMainTs(_name: string): string {
  return `import { createApp } from '@aihu/app/client'\n\ncreateApp()\n`
}

/**
 * index.html for a new aihu application.
 *
 * No `<script>` tag: `viteAihuPlugin`'s `aihu-entry` sub-plugin injects one
 * pointing at `virtual:aihu-entry` (dev and build) when `src/main.ts` is
 * absent, and steps aside once a real `src/main.ts` exists — see
 * `appMainTs`'s doc comment for the escape-hatch contract this depends on.
 * `<div id="outlet"></div>` is the mount target `createApp()` looks up by
 * default (see `@aihu/app/client#outletId`); without it `createApp()`
 * throws on boot.
 */
export function appIndexHtml(name: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${name}</title>
  </head>
  <body>
    <div id="outlet"></div>
  </body>
</html>
`
}

/** .vscode/extensions.json — recommends the aihu language extension. */
export function appVscodeExtensions(): string {
  return `${JSON.stringify(
    {
      recommendations: ['fellwork.vscode-aihu'],
    },
    null,
    2,
  )}\n`
}

/** .vscode/settings.json — file associations and editor wiring for .aihu. */
export function appVscodeSettings(): string {
  return `${JSON.stringify(
    {
      'files.associations': {
        '*.aihu': 'aihu',
      },
      'editor.formatOnSave': false,
    },
    null,
    2,
  )}\n`
}

/** aihu.config.ts — kept for server/SSR config; optional for client-only apps. */
export function appAihuConfig(): string {
  return "import { defineAihuConfig } from '@aihu/server'\nimport { definePlugin as data } from '@aihu-plugin/data'\nimport { definePlugin as agent } from '@aihu/agent'\n\nexport default defineAihuConfig({\n  build: { target: 'universal' },\n  plugins: [data(), agent()],\n})\n"
}

/** src/pages/index.aihu for Hello World (v1 syntax).
 *
 * When `withCssEngine` is true, emits a utility-class starter (no authored
 * `@style` block) so the scaffold demonstrates `@aihu/css-engine` end to end —
 * the classes are scanned at build time and the scoped rules fold into the
 * component's shadow `<style>`. When false, byte-identical to the original
 * hand-written `@style` starter.
 */
export function appIndexAihu(appName: string = 'app', withCssEngine = false): string {
  const tag = `${toSafe(appName)}-root`
  // The counter's actions are declared as `$action` entries so they are exposed
  // as agent-callable tools. Template buttons reference them by name (string
  // handler form), so the `$action` block is the single source of truth for the
  // agent surface.
  //
  // The `@route { name }` block registers the page under a HYPHENATED
  // custom-element tag. The router only mounts routes whose name is a valid
  // custom-element tag (must contain a hyphen); without this block the page is
  // registered under its filename stem (`index`, no hyphen) and never mounts —
  // the app renders a blank `#outlet`.
  //
  // The MCP server card's tools are DERIVED from this `$action` block at
  // runtime (the compiler emits `registerAgentMetadata` from it; the
  // agent-readiness plugin reads the registry), never hand-mirrored in
  // vite.config — so the card cannot drift from the component.
  //
  // DA4 (#437, flipped): pages default to light DOM now. The plain scaffold
  // keeps a `$shadow: 'light'` pin — it is simply explicit about the default
  // (the legacy-snapshot golden regenerates with the binary token). The
  // css-engine scaffold does NOT pin per-file: an explicit `--shadow` wizard
  // choice is carried as the PLUGIN-GLOBAL `css: { shadowMode }` in
  // vite.config.ts (the config tier outranks the page default; a per-file
  // `$shadow` marker would outrank the config and freeze the choice), and
  // with no choice nothing is emitted at all, so the DA4 framework defaults
  // apply (FEL-425 — a scaffold that pins the default freezes it).
  const shadowPin = withCssEngine ? '' : "$shadow: 'light'\n\n"
  const stateBlock = `@state {
${shadowPin}import { signal } from '@aihu/signals'

const [count, setCount] = signal(0)

$action: {
  increment: {
    describe: 'Add 1 to the value',
    expose: { read: true, write: true },
    handler: () => setCount(count() + 1),
  },
  decrement: {
    describe: 'Subtract 1 from the value',
    expose: { read: true, write: true },
    handler: () => setCount(count() - 1),
  },
  reset: {
    describe: 'Set the value to 0',
    expose: { read: true, write: true },
    handler: () => setCount(0),
  },
}
}`
  if (withCssEngine) {
    return `@route {
  name: '${tag}'
}

${stateBlock}

@template {
  <main class="flex flex-col gap-8 max-w-7xl mx-auto p-8">
    <header class="flex flex-col gap-1">
      <h1 class="text-3xl font-bold">${appName}</h1>
      <p class="text-lg">A durable Web Component your AI agent can read and drive.</p>
    </header>

    <section class="flex flex-col gap-4">
      <h2 class="text-xl font-semibold">Control</h2>
      <p class="text-lg">Value: {count}</p>
      <div class="flex gap-2">
        <button class="px-4 py-2 rounded-lg border" on:click={decrement}>−1</button>
        <button class="px-4 py-2 rounded-lg border" on:click={reset}>Reset</button>
        <button class="px-4 py-2 rounded-lg bg-primary text-white" on:click={increment}>+1</button>
      </div>
    </section>

    <section class="flex flex-col gap-4">
      <h2 class="text-xl font-semibold">Agent surface</h2>
      <p>These actions are declared agent-callable. This static build publishes the declaration (llms.txt); serving them as live, callable tools is what the full template's server does.</p>
      <ul class="flex flex-col gap-1">
        <li>increment — Add 1 to the value</li>
        <li>decrement — Subtract 1 from the value</li>
        <li>reset — Set the value to 0</li>
      </ul>
      <p>
        <a href="/llms.txt">llms.txt</a> — what this build honestly says about itself to agents.
      </p>
    </section>

    <p>To get started, edit <code>src/pages/index.aihu</code> — save, and this page hot-reloads. Want these actions live for real agents? <code>npm create aihu -- --template full</code> ships the server.</p>
  </main>
}
`
  }
  return `@route {
  name: '${tag}'
}

${stateBlock}

@template {
  <main class="root">
    <header>
      <h1>${appName}</h1>
      <p class="subtitle">A durable Web Component your AI agent can read and drive.</p>
    </header>

    <section class="card">
      <h2>Control</h2>
      <p class="value">Value: {count}</p>
      <div class="controls">
        <button on:click={decrement}>−1</button>
        <button on:click={reset}>Reset</button>
        <button on:click={increment}>+1</button>
      </div>
    </section>

    <section class="card">
      <h2>Agent surface</h2>
      <p>These actions are declared agent-callable. This static build publishes the declaration (llms.txt); serving them as live, callable tools is what the full template's server does.</p>
      <ul>
        <li>increment — Add 1 to the value</li>
        <li>decrement — Subtract 1 from the value</li>
        <li>reset — Set the value to 0</li>
      </ul>
      <p>
        <a href="/llms.txt">llms.txt</a> — what this build honestly says about itself to agents.
      </p>
    </section>

    <p class="note">To get started, edit <code>src/pages/index.aihu</code> — save, and this page hot-reloads. Want these actions live for real agents? <code>npm create aihu -- --template full</code> ships the server.</p>
  </main>
}

@style {
.root {
  padding: 2rem;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  max-width: 640px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 2rem;
  line-height: 1.5;
}
header {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.subtitle {
  color: #555;
  margin: 0;
}
.card {
  border: 1px solid #e2e2e2;
  border-radius: 12px;
  padding: 1.25rem 1.5rem;
}
.card h2 {
  margin-top: 0;
}
.value {
  font-size: 1.25rem;
  font-weight: 600;
}
.controls {
  display: flex;
  gap: 0.5rem;
}
button {
  padding: 8px 16px;
  cursor: pointer;
}
ul {
  padding-left: 1.25rem;
}
.note {
  color: #555;
}
}
`
}

/** src/layouts/default.aihu for Hello World (v1 syntax). */
export function appDefaultLayout(): string {
  return '@template {\n  <div class="layout">\n    <slot />\n  </div>\n}\n\n@style {\n.layout {\n  max-width: 1200px;\n  margin: 0 auto;\n}\n}\n'
}

/** src/pages/about.aihu — a second route, emitted by the `full` template to
 * demonstrate the router resolving more than one page. Client-buildable only
 * (no @aihu/server wiring). */
export function appAboutAihu(appName: string = 'app'): string {
  return `@route {
  name: '${toSafe(appName)}-about'
}

@template {
  <div class="about">
    <h1>About</h1>
    <p>This is the about page — a second route wired through the aihu router.</p>
    <a href="/">Home</a>
  </div>
}

@style {
.about {
  padding: 2rem;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  max-width: 600px;
  margin: 0 auto;
}
}
`
}

/** src/pages/index.aihu for the `docs` template — a docs-flavored landing page.
 * Pure string generator, client-buildable only. */
export function appDocsIndexAihu(appName: string = 'app'): string {
  const title = appName
  const tag = `${toSafe(appName)}-root`
  return `@route {
  name: '${tag}'
}

@state {
import { signal } from '@aihu/signals'

const [open, setOpen] = signal(false)
const toggle = () => setOpen(v => !v)
}

@template {
  <div class="docs">
    <header class="docs-header">
      <h1>${title} docs</h1>
      <p class="tagline">Web Components, reactive — documentation starter.</p>
    </header>
    <nav class="docs-nav">
      <a href="/">Home</a>
      <a href="/guide">Guide</a>
    </nav>
    <button class="toggle" on:click={toggle}>{open ? 'Hide' : 'Show'} details</button>
    <section if={open} class="details">
      <p>Edit <code>src/pages/index.aihu</code> to author your docs content.</p>
    </section>
  </div>
}

@style {
.docs {
  padding: 2rem;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  max-width: 760px;
  margin: 0 auto;
}
.tagline {
  color: #666;
}
.docs-nav a {
  margin-right: 1rem;
}
button.toggle {
  padding: 8px 16px;
  cursor: pointer;
}
}
`
}

/** src/pages/guide.aihu — second docs route for the `docs` template. */
export function appDocsGuideAihu(appName: string = 'app'): string {
  return `@route {
  name: '${toSafe(appName)}-guide'
}

@template {
  <div class="guide">
    <h1>Guide</h1>
    <p>Author your guide pages as <code>.aihu</code> SFCs under <code>src/pages</code>.</p>
    <a href="/">Back to docs</a>
  </div>
}

@style {
.guide {
  padding: 2rem;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  max-width: 760px;
  margin: 0 auto;
}
}
`
}

/** A page file for a given route path. */
export function pageAihu(routePath: string): string {
  const name = routePath.replace(/^\//, '').replace(/\//g, '-') || 'page'
  // The router only mounts routes whose name is a valid custom-element tag
  // (must contain a hyphen). A single-segment path like `/contact` yields a
  // non-hyphenated name, so suffix `-page` to keep it mountable.
  const tag = name.includes('-') ? name : `${name}-page`
  return `@route {\n  name: '${tag}'\n}\n\n@template {\n  <div class="${tag}">\n    <h1>${tag}</h1>\n  </div>\n}\n`
}

/** A component file for a given component name. */
export function componentAihu(name: string): string {
  const kebab = toKebab(name)
  // Emit a real element (not a bare HTML comment): the v1 template parser
  // rejects comment-only element bodies ("expected tag name"). A heading
  // keeps the starter compiler-clean while still naming the component.
  return `@template {\n  <div class="${kebab}">\n    <h2>${name}</h2>\n  </div>\n}\n`
}

/** package.json for a new aihu plugin. */
export function pluginPackageJson(name: string): string {
  const kebab = toKebab(name)
  return JSON.stringify(
    {
      name: `aihu-plugin-${kebab}`,
      version: '0.1.0',
      type: 'module',
      main: './dist/index.js',
      module: './dist/index.js',
      types: './dist/index.d.ts',
      exports: {
        '.': {
          types: './dist/index.d.ts',
          import: './dist/index.js',
        },
      },
      peerDependencies: {
        // Generated, not typed: this said `^0.8.0` while `@aihu/plugin` was on
        // 0.1.0 — a range that resolves to nothing, in a scaffold nobody would
        // notice until `npm install` in the generated package.
        '@aihu/plugin': aihuDep('@aihu/plugin'),
      },
    },
    null,
    2,
  )
}

/** src/index.ts for a new aihu plugin. */
export function pluginIndex(name: string): string {
  const kebab = toKebab(name)
  return `import { definePlugin, type Plugin } from '@aihu/plugin'\n\nconst plugin: Plugin = definePlugin({\n  name: '${name}',\n  version: '0.1.0',\n  namespace: '${kebab}',\n  contributes: {\n    blocks: [],\n    macros: [],\n  },\n})\n\nexport default plugin\n`
}

// ---------------------------------------------------------------------------
// Scaffold functions — write template files to disk
// ---------------------------------------------------------------------------

/**
 * Scaffold a new aihu application at `<outDir>/<name>/`.
 *
 * v0.2.x: Vite + `viteAihuPlugin()`, v1 `@state` / `@template` / `@style`
 * syntax. Produces: package.json, vite.config.ts, tsconfig.json, index.html,
 *   src/pages/index.aihu, .vscode/extensions.json, .vscode/settings.json
 * (no src/main.ts — see appMainTs's doc comment)
 */
export function scaffoldApp(
  name: string,
  outDir?: string,
  opts?: {
    pm?: PkgManager
    template?: AppTemplate
    /** `'engine'` includes `@aihu/css-engine` OOTB; `'none'` (default) is the plain scaffold. */
    css?: CssChoice
    /**
     * Explicit shadow-mode choice when css-engine is opted in. `undefined`
     * (default) emits NO plugin-global `css: { shadowMode }` block, so the
     * DA4 framework defaults apply (pages/layouts light, leaves shadow) —
     * only a genuine user choice is written out (FEL-425).
     */
    shadowMode?: ShadowChoice | undefined
    /**
     * Coding-assistant files (AGENTS.md, CLAUDE.md, .mcp.json) — on by
     * default, `--no-agent-tooling` opts out. This governs ONLY the
     * developer-environment files; the app's own runtime agent surface
     * (`$action`, llms.txt, the cards) is the product thesis and is never
     * affected by this flag.
     */
    agentTooling?: boolean
  },
): ScaffoldResult {
  const pm = opts?.pm ?? 'bun'
  const template: AppTemplate = opts?.template ?? 'minimal'
  const withCssEngine = opts?.css === 'engine'
  const shadowMode = opts?.shadowMode
  const agentTooling = opts?.agentTooling !== false
  // Before `resolve()`, not after: `resolve(outDir ?? '.', '../../ESCAPED')`
  // silently lands two directories above the cwd, and the same string is what
  // `appPackageJson` writes into the `name` field, which npm then rejects.
  // Shared with the template pipeline so the two paths cannot disagree about
  // what a legal project name is (see project-name.ts).
  assertProjectName(name, 'aihu app', 'project name')
  const root = resolve(outDir ?? '.', name)

  // `full` is the kitchen-sink template: the dual-experience word-game demo on
  // the capability-bridge architecture (the former `agent` template folds into
  // it — see docs/plans/2026-07-26-scaffold-experience-design.md §3.3-3.4).
  if (template === 'full') {
    return writeFiles(root, fullTemplateFiles(name, pm, { agentTooling }))
  }

  // `agent` is the showcase template: a durable component driven by both a human
  // and an external AI agent over @aihu/agent-server's capability bridge. It is a
  // two-process app (Bun bridge server + Vite) and uses the raw client-target
  // compiler — NOT the viteAihuPlugin pages-router base — so it emits its own
  // file set and returns early.
  if (template === 'agent') {
    const files: Array<readonly [string, string]> = [
      ['package.json', agentPackageJson(name, pm)],
      // Same reason as `minimal`/`docs`/`full`: pnpm reads its settings from
      // this file only, and without it the first `pnpm install` exits non-zero
      // with ERR_PNPM_IGNORED_BUILDS before the user reaches a build. `agent`
      // was the one template that never emitted it — the file list is a
      // fourth place this had to be said, and it was the place nobody looked.
      ['pnpm-workspace.yaml', pnpmWorkspaceYaml()],
      ['vite.config.ts', agentViteConfig()],
      ['tsconfig.json', agentTsConfig()],
      ['index.html', agentIndexHtml(name)],
      ['server.ts', agentServerTs()],
      ['mcp.ts', agentMcpTs()],
      // The live discovery surface (llms.txt + the .well-known cards), served by
      // server.ts/mcp.ts rather than emitted statically by vite — see the
      // rationale on agentReadinessTs().
      ['readiness.ts', agentReadinessTs(name)],
      ['src/main.ts', agentMainTs()],
      ['src/task-list.aihu', agentComponentAihu()],
      ['src/aihu-modules.d.ts', agentModuleShim()],
      ['README.md', agentReadme(name)],
      ['.vscode/extensions.json', appVscodeExtensions()],
      ['.vscode/settings.json', appVscodeSettings()],
    ]
    if (agentTooling) {
      files.push(
        ...agentToolingFiles({
          name,
          commands: [
            ['bun run dev', 'Bridge server (:5208) + Vite (:5108) together'],
            ['bun run server', 'Just the Bun gate/bridge server'],
            ['bun run build', 'Static production build to dist/ (page only)'],
            ['bun run typecheck', 'tsc --noEmit over server.ts, mcp.ts, readiness.ts, src/'],
          ],
          map: [
            ['src/task-list.aihu', 'The demo component a human and an agent both drive'],
            ['src/main.ts', 'Browser entry: capability-bridge client'],
            ['server.ts', 'Governed gate (auth scope + rate limit)'],
            ['readiness.ts', 'llms.txt + MCP/A2A cards, derived live from the registry'],
            ['mcp.ts', 'MCP stdio entry for standard MCP clients'],
          ],
        }),
      )
    }
    return writeFiles(root, files)
  }

  // `ssr` is the Cloudflare-Worker template: the ONLY scaffold that emits
  // `output: 'ssr'`, so it is the only one whose `vite build` produces a
  // server bundle at all. It shares `minimal`'s page, index.html and tsconfig
  // — the difference is entirely in vite.config.ts and the dependency set —
  // but it returns early rather than joining the base below, because the base
  // hardcodes `appViteConfig`/`appPackageJson` and a boolean threaded through
  // both would make two genuinely different builds look like one with a flag.
  if (template === 'ssr') {
    const files: Array<readonly [string, string]> = [
      ['package.json', ssrPackageJson(name, pm, withCssEngine)],
      ['pnpm-workspace.yaml', pnpmWorkspaceYaml()],
      ['vite.config.ts', ssrViteConfig(name, `${toSafe(name)}-root`)],
      ['tsconfig.json', appTsConfig()],
      ['index.html', appIndexHtml(name)],
      ['src/pages/index.aihu', appIndexAihu(name, withCssEngine)],
      ['README.md', ssrReadme(name)],
      ['.vscode/extensions.json', appVscodeExtensions()],
      ['.vscode/settings.json', appVscodeSettings()],
    ]
    if (agentTooling) files.push(...agentToolingFiles(ssrAgentsFacts(name)))
    return writeFiles(root, files)
  }

  // Shared base for the vite-only templates (minimal | docs): a 7-file set
  // (src/main.ts is no longer scaffolded — viteAihuPlugin's aihu-entry
  // sub-plugin injects a virtual equivalent; see appMainTs's doc comment for
  // the escape hatch) plus the agent-tooling trio (AGENTS.md / CLAUDE.md /
  // .mcp.json, opt out with agentTooling: false). The legacy-snapshot golden
  // gates this output; intentional changes here require a deliberate golden
  // refresh.
  const indexPage = template === 'docs' ? appDocsIndexAihu(name) : appIndexAihu(name, withCssEngine)
  const files: Array<readonly [string, string]> = [
    ['package.json', appPackageJson(name, pm, withCssEngine)],
    // Emitted for every scaffold, not only `--pm pnpm`: bun, npm and yarn
    // ignore the file outright, so one always-present copy costs nothing and
    // means a user who scaffolds with bun and later runs `pnpm install` does
    // not hit ERR_PNPM_IGNORED_BUILDS. Choosing per-PM would make the failure
    // depend on which package manager the project was BORN with.
    ['pnpm-workspace.yaml', pnpmWorkspaceYaml()],
    ['vite.config.ts', appViteConfig(name, withCssEngine, shadowMode)],
    ['tsconfig.json', appTsConfig()],
    ['index.html', appIndexHtml(name)],
    ['src/pages/index.aihu', indexPage],
    ['.vscode/extensions.json', appVscodeExtensions()],
    ['.vscode/settings.json', appVscodeSettings()],
  ]

  if (template === 'docs') {
    // `docs` is a docs-flavored variant: a distinct landing page (above) plus a
    // second guide route.
    files.push(['src/pages/guide.aihu', appDocsGuideAihu(name)])
  }

  // Coding-assistant files, uniform across templates (the developer's editor
  // does not care which tier was scaffolded). `--no-agent-tooling` opts out.
  if (agentTooling) {
    files.push(...agentToolingFiles(viteTemplateAgentsFacts(name)))
  }

  return writeFiles(root, files)
}

/**
 * Scaffold a page file under `src/pages/`.
 *
 * Usage: `aihu page /about` -> `src/pages/about.aihu`
 */
export function scaffoldPage(routePath: string, outDir?: string): ScaffoldResult {
  const root = resolve(outDir ?? '.')
  const segments = routePath.replace(/^\//, '').split('/').filter(Boolean)
  // `.`/`..` survive `filter(Boolean)` (both are truthy strings), and
  // `join(root, rel)` below resolves them normally — so an unchecked route
  // like '../../../../etc/whatever' writes outside src/pages/, potentially
  // outside the project entirely. Reject rather than silently escape.
  //
  // The check lives in project-name.ts because splitting on `/` alone is not
  // enough: `join()` treats `\` as a separator on Win32, so `..\..\x` is one
  // `/`-segment here and a real traversal there.
  assertRouteSegments(routePath, segments)
  const rel = segments.length > 0 ? `src/pages/${segments.join('/')}.aihu` : 'src/pages/index.aihu'
  return writeFiles(root, [[rel, pageAihu(routePath)]])
}

/**
 * Scaffold a component file under `src/components/`.
 *
 * Usage: `aihu component UserCard` -> `src/components/user-card.aihu`
 *
 * The filename stem IS the registered custom-element tag, and custom-element
 * names require a hyphen. A single-word name (`aihu component Card`) would
 * produce `card.aihu` -> `customElements.define('card', …)`, which throws
 * SyntaxError in every browser: the component never upgrades and renders
 * blank. Rather than scaffold something that cannot run — or silently rename
 * what the author typed — this refuses, and says what to type instead.
 */
export function scaffoldComponent(name: string, outDir?: string): ScaffoldResult {
  const root = resolve(outDir ?? '.')
  const kebab = toKebab(name)
  if (!kebab.includes('-')) {
    throw new Error(
      `aihu component: '${name}' produces the tag '${kebab}', which cannot register as a ` +
        'custom element (custom-element names require a hyphen), so the component would ' +
        `never upgrade. Use a multi-word name (e.g. '${name}Panel') or a hyphenated one ` +
        `(e.g. 'aihu-${kebab}').`,
    )
  }
  return writeFiles(root, [[`src/components/${kebab}.aihu`, componentAihu(name)]])
}

/**
 * Scaffold a plugin package directory.
 *
 * Usage: `aihu plugin my-forms` -> `aihu-plugin-my-forms/`
 */
export function scaffoldPlugin(name: string, outDir?: string): ScaffoldResult {
  // `toKebab` happens to strip `/` and `.` to hyphens, so this path could not
  // traverse the way `scaffoldApp` could — but it silently ACCEPTED the garbage
  // and scaffolded it: `aihu plugin ../../X` produced a directory literally
  // named `aihu-plugin--x`, while the CLI reported creating `../../X/…`.
  // `pluginIndex()` also interpolates the raw name into a single-quoted JS
  // string literal in the generated source, so an unvalidated name is a code
  // injection into the file the user is about to run.
  assertProjectName(name, 'aihu plugin', 'plugin name')
  const kebab = toKebab(name)
  const root = resolve(outDir ?? '.', `aihu-plugin-${kebab}`)
  return writeFiles(root, [
    ['package.json', pluginPackageJson(name)],
    ['src/index.ts', pluginIndex(name)],
  ])
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function writeFiles(
  root: string,
  entries: ReadonlyArray<readonly [string, string]>,
): ScaffoldResult {
  const created: string[] = []
  const skipped: string[] = []

  for (const [rel, content] of entries) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    if (!existsSync(abs)) {
      writeFileSync(abs, content, 'utf8')
      created.push(rel)
    } else {
      skipped.push(rel)
    }
  }

  return { created, skipped }
}

export function toKebab(name: string): string {
  return name
    .replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`)
    .replace(/^-/, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
}

/**
 * Convert a project name to a safe JS identifier (for use as rolldown input key
 * or custom-element tag name component). Strips leading digits, replaces
 * non-alphanumeric with hyphens.
 */
export function toSafe(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/^[^a-z]+/, '')
      .replace(/-+/g, '-')
      .replace(/-$/, '') || 'app'
  )
}
