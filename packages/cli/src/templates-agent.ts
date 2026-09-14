/**
 * `--template agent` generators — the agent-drivable showcase.
 *
 * Unlike the client-only `minimal`/`full`/`docs` templates (Vite + viteAihuPlugin
 * + pages router), the `agent` template is the headline aihu thesis made runnable:
 * a durable on-screen Web Component that BOTH a human and an external AI agent
 * drive. The agent reads + reskins the SAME visible instance over a server-mediated
 * capability bridge — the Bun server (`server.ts`) is the sole policy gate; the
 * browser instance is the sole executor.
 *
 * Two entries, two stories:
 *   - server.ts — the GOVERNED HTTP entry. The component's actions are gated with
 *     an auth scope + a rate limit, so `/agent/call` demonstrates 200 (authorized) /
 *     403 (no scope) / 429 (rate-limited). This is the "every guardrail is real" story.
 *   - mcp.ts    — the OPEN MCP entry (stdio). Serves the same actions as MCP tools so
 *     a standard AI client (Claude, Cursor) can discover + drive the live instance
 *     with zero auth friction — the "an agent molds the component" story.
 *
 * It is a two-process app: `bun run dev` runs the Bun bridge server (:5208) AND
 * Vite (:5108, proxying `/agent` + `/bridge`). Ported from the in-repo reference
 * `examples/agent-driven-demo`, adapted for a standalone (non-workspace) app and
 * extended with human controls + agent reskinning.
 *
 * Per the repo's dep-free thesis: pure string generators, no runtime file reads.
 * Generated files deliberately avoid template literals (string concatenation) so
 * these generators don't need nested-backtick escaping.
 */

import { aihuDep } from './dep-versions.js'
import type { PkgManager } from './index.js'
import { packageManagerField } from './pkg-manager-field.js'

/** package.json for the `agent` template. */
export function agentPackageJson(name: string, pm: PkgManager = 'bun'): string {
  // See pkg-manager-field.ts: the inline predecessor of this line could only
  // ever emit a field for bun, and under the published node-shebang binary
  // could not emit one at all.
  const packageManager = packageManagerField(pm)
  return JSON.stringify(
    {
      name,
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: {
        // Two processes: the Bun capability-bridge server + Vite. `-P` +
        // `{@}` (concurrently's passthrough-arguments mode) forward any args
        // after `--` into the vite sub-command — e.g. `bun run dev -- --port
        // N --strictPort` — instead of silently swallowing them at
        // concurrently's own CLI-parsing layer. Without this, extra argv
        // never reaches vite and it always binds the hardcoded default port.
        server: 'bun server.ts',
        dev: 'concurrently -P "bun run server" "vite --port 5108 {@}" --',
        build: 'vite build',
        preview: 'vite preview',
        typecheck: 'tsc --noEmit',
      },
      dependencies: {
        // A RUNTIME dependency here, not a devDependency (as it is in the
        // vite-only `full` template): `readiness.ts` imports
        // `createAgentReadinessRoutes` and `server.ts` / `mcp.ts` serve those
        // handlers live, so the package must be present at `bun server.ts`
        // time — not only at `vite build` time.
        '@aihu-plugin/agent-readiness': aihuDep('@aihu-plugin/agent-readiness'),
        '@aihu/agent': aihuDep('@aihu/agent'),
        '@aihu/agent-server': aihuDep('@aihu/agent-server'),
        '@aihu/agent-service': aihuDep('@aihu/agent-service'),
        '@aihu/arbor': aihuDep('@aihu/arbor'),
        '@aihu/compiler': aihuDep('@aihu/compiler'),
        // Utility classes in the component's markup + the src/theme.css tokens
        // they resolve against. Auto-wired by presence: vite.config.ts hands the
        // theme text to the compiler plugin and every class in the SFC is scanned.
        '@aihu/css-engine': aihuDep('@aihu/css-engine'),
        // Peer of `@aihu/runtime`, not of anything listed here directly — which
        // is why two passes missed it. `@aihu/runtime` and `@aihu/arbor` declare
        // ZERO runtime dependencies and express every edge as a peer, so what
        // must be installed is the transitive peer closure. Without it, `vite
        // build` dies with: Rollup failed to resolve import "@aihu/context" from
        // node_modules/@aihu/runtime/dist/index.js (run 30333950275, `full` and
        // `agent` x yarn — the two templates that share this emitter).
        '@aihu/context': aihuDep('@aihu/context'),
        '@aihu/runtime': aihuDep('@aihu/runtime'),
        '@aihu/signals': aihuDep('@aihu/signals'),
        ws: '^8.18.0',
      },
      devDependencies: {
        '@aihu/cli': aihuDep('@aihu/cli'),
        // `server.ts` and `mcp.ts` call `Bun.serve()`. Without these types
        // the scaffolded project's own `typecheck` script fails on a fresh
        // install — TS2868 "Cannot find name 'Bun'", plus TS7006 implicit-any
        // on every `Bun.serve` callback parameter. Must stay in step with the
        // `types: ['node', 'bun']` entry in agentTsConfig().
        '@types/bun': '^1.1.0',
        // `types: ['node', 'bun']` in agentTsConfig() resolves fine under
        // bun/npm/yarn's hoisted node_modules (pulled in transitively), but
        // pnpm's strict per-package resolution needs it declared directly —
        // otherwise `pnpm run typecheck` fails with TS2688 "Cannot find type
        // definition file for 'node'".
        '@types/node': '^20.0.0',
        '@types/ws': '^8.5.12',
        concurrently: '^9.0.0',
        typescript: '^5.0.0',
        vite: aihuDep('vite'),
      },
      // Same list, same reasoning, as `appPackageJson` in index.ts — read the
      // long comment there: `@aihu/compiler` no longer ships any install script
      // (measured against the published tarball) and is kept as a forward
      // guard, while `esbuild` is the package that actually postinstalls under
      // a vite-6 install and is NOT optional on the pnpm side.
      trustedDependencies: ['@aihu/compiler', 'esbuild'],
      // The pnpm-side equivalent is deliberately NOT here: current pnpm does not
      // read settings from package.json and says so on every install ("The
      // "pnpm" field in package.json is no longer read by pnpm"). It ships as
      // `pnpm-workspace.yaml` alongside this manifest — see pnpmWorkspaceYaml().
      ...(packageManager ? { packageManager } : {}),
    },
    null,
    2,
  )
}

/** vite.config.ts — client-target compiler + proxy to the Bun bridge server. */
export function agentViteConfig(): string {
  const lines = [
    "import { readFileSync } from 'node:fs'",
    "import { aihuCompilerPlugin } from '@aihu/compiler'",
    "import { defineConfig } from 'vite'",
    '',
    '// The project theme: the values @aihu/css-engine utility classes and this',
    "// component's authored CSS fall back to, in place of the built-in",
    '// `aihu-default` palette. Tokens compile to `var(--name, <value>)`, so a',
    '// stylesheet that sets them at :root still wins at runtime — the theme only',
    '// supplies the fallback half.',
    '//',
    '// Read as TEXT rather than passed as a path on purpose. The documented',
    "// `css: { theme: './src/theme.css' }` option belongs to @aihu/app's",
    '// `viteAihuPlugin`, which resolves the path and reads the file before',
    '// forwarding the CONTENT to the compiler. This template deliberately uses the',
    '// bare client-target compiler plugin (no router, no pages, no @aihu/app), so',
    '// it does that one step itself rather than taking the whole meta-framework on',
    '// as a dependency for one option.',
    "const theme = readFileSync(new URL('./src/theme.css', import.meta.url), 'utf8')",
    '',
    '// ── One theme file, two consumers. ─────────────────────────────────────────',
    '//',
    '// `theme` above is BUILD-TIME input: the engine bakes each value in as the',
    '// `var(--name, <value>)` fallback that utility classes compile to.',
    '//',
    '// Nothing has SET those properties at runtime yet, though, and authored CSS',
    '// in the SFC writes its own fallbacks by hand — so after you edit the theme',
    '// the two halves would disagree, because only the utilities get regenerated.',
    '// Setting the tokens at :root removes the question: a set value beats every',
    '// fallback, and custom properties inherit through shadow boundaries.',
    '//',
    '// The runtime sheet is DERIVED rather than hand-maintained as a second block:',
    '// one list, no drift. It cannot simply be the same file imported directly —',
    "// `@theme` is not a real at-rule, so lightningcss warns 'Unknown at rule:",
    "// @theme' on every build and ships the block as dead bytes.",
    "const VIRTUAL_THEME = 'virtual:aihu-theme.css'",
    "const themeRuntime = theme.replace(/@theme\\s*\\{/, ':root {')",
    '',
    'const themeRuntimePlugin = {',
    "  name: 'aihu-theme-runtime',",
    '  resolveId(id: string) {',
    "    return id === VIRTUAL_THEME ? '\\0' + VIRTUAL_THEME : undefined",
    '  },',
    '  load(id: string) {',
    "    return id === '\\0' + VIRTUAL_THEME ? themeRuntime : undefined",
    '  },',
    '}',
    '',
    '// The app is TWO origins behind one URL: Vite serves the page, the Bun',
    '// server (server.ts) serves the agent surface. Everything an agent needs —',
    '// the capability bridge AND the discovery documents (/llms.txt,',
    "// /.well-known/*) — is proxied so an agent that has only the app's URL",
    '// finds all of it at that one origin.',
    '//',
    '// The discovery documents are NOT emitted as static assets by',
    '// viteAgentReadinessIntegration here (as the `full` template does). They are',
    '// generated from the LIVE @aihu/agent registry inside the process that also',
    "// runs the gate, so they list this component's real, currently-callable",
    '// actions. A client-only Vite build has an empty registry at build time, so',
    '// a statically emitted card would advertise zero tools.',
    "const BRIDGE = 'http://localhost:5208'",
    '',
    '// `changeOrigin: false` matters for the discovery documents specifically:',
    "// they EMBED absolute URLs, which the server builds from the request's Host",
    '// header. At the proxy default the Host is rewritten to the internal :5208,',
    '// so an agent that fetched /llms.txt from the app URL is handed links to a',
    '// port it was never told about. Keeping the original Host makes the',
    '// documents describe the origin the agent actually used.',
    'const READINESS = { target: BRIDGE, changeOrigin: false }',
    '',
    'const AGENT_SURFACE = {',
    "  '/agent': BRIDGE,",
    "  '/bridge': { target: 'ws://localhost:5208', ws: true },",
    "  '/llms.txt': READINESS,",
    "  '/llms-full.txt': READINESS,",
    "  '/robots.txt': READINESS,",
    "  '/sitemap.xml': READINESS,",
    "  '/.well-known': READINESS,",
    '}',
    '',
    '// `target: client` makes the browser bundle ship the per-instance @agent',
    '// opaque-ID dispatcher; src/main.ts takes it off the mounted element and runs',
    '// the capability-bridge client.',
    'export default defineConfig({',
    '  plugins: [',
    '    aihuCompilerPlugin({',
    "      target: 'client',",
    '      css: { theme },',
    '    }),',
    '    themeRuntimePlugin,',
    '  ],',
    '  server: { proxy: AGENT_SURFACE },',
    '  // `vite preview` serves the built page; the agent surface still comes from',
    '  // the running Bun server, so proxy it there too.',
    '  preview: { proxy: AGENT_SURFACE },',
    '})',
    '',
  ]
  return lines.join('\n')
}

/** tsconfig.json — self-contained (no monorepo paths). */
export function agentTsConfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        // 'bun' is required because the emitted `server.ts` / `mcp.ts` use
        // `Bun.serve()`. Paired with the `@types/bun` devDependency; changing
        // one without the other breaks `typecheck` on a fresh scaffold.
        types: ['node', 'bun'],
        // Required alongside the 'bun' types: @types/bun declares
        // `ImportMeta.hot` as always-present while vite's
        // `ModuleRunnerImportMeta` declares it optional, so the two .d.ts files
        // disagree (TS2430) even though no user code is involved. skipLibCheck
        // confines type checking to the project's own source, which is what
        // the scaffolded `typecheck` script is meant to verify.
        skipLibCheck: true,
        // `server.ts` / `mcp.ts` import `./readiness.ts` by its real filename,
        // which is what Bun executes. Without this, `tsc --noEmit` rejects the
        // import with TS5097 on a fresh scaffold. Requires `noEmit` (below).
        allowImportingTsExtensions: true,
        noEmit: true,
      },
      include: ['server.ts', 'mcp.ts', 'readiness.ts', 'src', 'vite.config.ts'],
    },
    null,
    2,
  )}\n`
}

/** Ambient module shim so `import './task-list.aihu'` typechecks. */
export function agentModuleShim(): string {
  const lines = [
    '/** Side-effect import of a compiled .aihu SFC (registers the custom element). */',
    "declare module '*.aihu' {",
    '  const _default: unknown',
    '  export default _default',
    '}',
    '',
  ]
  return lines.join('\n')
}

// Shared metadata-actions + twin-binding-actions lines (server.ts and mcp.ts agree
// on the surface: addTask, clearTasks, and the two reskin actions setLabel/setVariant).
//
// The `describe:` text is not decoration: `@aihu-plugin/agent-readiness` derives
// the MCP server card's tool descriptions and the llms.txt `## Components`
// section from this registry entry, and `@aihu/agent-server` surfaces the same
// string as the MCP tool description. It mirrors the `describe:` on each
// `$action` in src/task-list.aihu — keep the two in step.
const METADATA_ACTIONS = [
  "    addTask: { describe: 'Append a task with the given text.', returns: {} },",
  '    toggleTask: {',
  "      describe: 'Mark the task with this id done or not done.',",
  '      returns: {},',
  '    },',
  "    setLabel: { describe: 'Set the panel heading text.', returns: {} },",
  '    setVariant: {',
  '      describe:',
  "        \"Set the visual variant: one of 'default', 'compact', 'danger'.\",",
  '      returns: {},',
  '    },',
]
/**
 * Readable state, surfaced as the llms.txt `## Components` State list.
 *
 * These are the component's TIER 0 + TIER 1 members — the `expose: 'read'` prop
 * and the two exposed `derived`s. They are deliberately the only readable names:
 * `draft`, `filter` and `calls` are view state a person owns, and publishing
 * them would widen the agent surface for no benefit to either audience.
 */
const METADATA_STATE = [
  "    owner: 'Display name of the person this list belongs to.',",
  "    remaining: 'Count of tasks not yet done.',",
  "    total: 'Total number of tasks on the list.',",
]
/**
 * The server-side twin's action map — one entry per TIER 2 action, and NO entry
 * for any tier 3 action. The omission is the enforcement: a name absent here is
 * a name `/agent/call` answers 404 for, so `clearAll` and `removeTask` cannot be
 * reached by an agent even with a valid `tasks:write` credential.
 */
const BINDING_ACTIONS = [
  '        addTask: () => twinLen(),',
  '        toggleTask: () => twinLen(),',
  '        setLabel: () => twinLen(),',
  '        setVariant: () => twinLen(),',
]

/** The readiness dispatch lines shared verbatim by server.ts and mcp.ts. */
const READINESS_DISPATCH = [
  '    // Discovery first: /llms.txt, /llms-full.txt, /robots.txt and the',
  '    // /.well-known/* cards. Served from THIS process because this is where',
  '    // the @aihu/agent registry is populated — so the documents list the',
  '    // component actions that are actually callable right now.',
  '    const readiness = await handleReadiness(req)',
  '    if (readiness) return readiness',
]

/**
 * readiness.ts — the machine-readable DISCOVERY surface, served live.
 *
 * WHY NOT `viteAgentReadinessIntegration` (what `minimal`/`full`/`docs` use)?
 * That integration emits the documents as STATIC assets at `vite build` and
 * serves them from vite's dev middleware. Both run in a browser-target build
 * where the `@aihu/agent` registry is EMPTY — so the MCP server card it writes
 * advertises zero tools and llms.txt has no `## Components` section. For this
 * template that would be the worst kind of pass: a file exists at the right
 * path with no agent surface in it.
 *
 * This template has something the vite-only templates do not — a real backend
 * (`server.ts` / `mcp.ts`) that calls `registerAgentMetadata()` and owns the
 * `/agent/call` gate. So it uses the SAME package's other entry point,
 * `createAgentReadinessRoutes()` — the fetch-API handlers designed for exactly
 * this — and serves them from the server that holds the registry. The documents
 * are generated per request, so they can never go stale against the gate, and
 * `vite.config.ts` proxies the paths so they answer on the app's own URL too.
 */
export function agentReadinessTs(name: string): string {
  const lines = [
    '/**',
    ' * The machine-readable DISCOVERY surface: what an agent that has only this',
    " * app's URL reads to learn what the app is and how to drive it.",
    ' *',
    ' * Served live by the same process that serves the capability bridge, because',
    ' * that is the process whose `@aihu/agent` registry is populated: every',
    ' * document below is DERIVED from the registered component metadata, so the',
    ' * advertised tools cannot drift from the actions the gate will accept.',
    ' * (A client-only `vite build` has an empty registry — a statically emitted',
    ' * card would advertise no tools at all.)',
    ' *',
    ' * Endpoints:',
    ' *   GET /llms.txt                            text/plain',
    ' *   GET /llms-full.txt                       text/plain',
    ' *   GET /robots.txt                          text/plain',
    ' *   GET /.well-known/mcp/server-card.json    application/json',
    ' *   GET /.well-known/agent-card.json         application/json  (A2A)',
    ' *   GET /.well-known/agent.json              application/json  (deprecated A2A alias)',
    ' *   GET /.well-known/mcp.json                application/json',
    ' *   GET /sitemap.xml                         application/xml',
    ' *',
    ' * The sitemap lists the one page this template has. It is served rather than',
    ' * left unhandled on purpose: an unhandled /sitemap.xml falls through to the',
    " * dev server's SPA fallback, which answers HTTP 200 with index.html — and a",
    ' * reader that trusts the status code cannot tell that from a real sitemap.',
    ' * Every path listed here answers with its own content type or not at all.',
    ' */',
    '',
    "import { createAgentReadinessRoutes, skillsFromRegistry } from '@aihu-plugin/agent-readiness'",
    '',
    `const NAME = '${name}'`,
    "const VERSION = '0.1.0'",
    'const SUMMARY =',
    "  'An agent-drivable aihu app. The <task-list> Web Component on the page is " +
      'driven by a human AND by external agents: an approved call executes against ' +
      "that same live on-screen instance over a capability bridge.'",
    '',
    '/** pathname -> the handler that answers it. */',
    'const ROUTES = {',
    "  '/llms.txt': 'llmsTxt',",
    "  '/llms-full.txt': 'llmsFullTxt',",
    "  '/robots.txt': 'robotsTxt',",
    "  '/.well-known/mcp/server-card.json': 'mcpServerCard',",
    "  '/.well-known/agent-card.json': 'a2aCard',",
    '  // Deprecated A2A alias (pre-v0.3.0 path); served with a Deprecation header.',
    "  '/.well-known/agent.json': 'a2aCard',",
    "  '/.well-known/mcp.json': 'mcpDiscovery',",
    "  '/sitemap.xml': 'sitemapXml',",
    '} as const',
    '',
    '/** The discovery paths this module answers — used for the startup banner. */',
    'export const READINESS_PATHS: readonly string[] = Object.keys(ROUTES)',
    '',
    '/**',
    ' * Build the route set for the ORIGIN the request actually arrived on, so the',
    ' * URLs inside the documents are URLs the caller can actually reach. Bun',
    ' * derives `req.url` from the Host header, and vite.config.ts proxies these',
    ' * paths with `changeOrigin: false`, so a fetch of http://localhost:5108/llms.txt',
    ' * emits :5108 URLs — not the :5208 this process happens to listen on. Cheap:',
    ' * pure closures over an in-memory registry snapshot, no I/O.',
    ' */',
    'function routesFor(origin: string) {',
    '  return createAgentReadinessRoutes({',
    '    name: NAME,',
    '    version: VERSION,',
    '    summary: SUMMARY,',
    '    siteUrl: origin,',
    '    // The address where the advertised tools are actually invoked.',
    '    //',
    '    // CAVEAT, stated plainly because the card cannot state it: the server',
    "    // card's transport type is 'streamable-http', but /agent/call speaks",
    "    // aihu's own { tool, params, userId, jwt } call shape. A raw MCP client",
    '    // should spawn `bun mcp.ts` (stdio) instead — the card shape has no way',
    '    // to express a stdio transport, so the llms.txt "Optional" entry below',
    '    // says so in the document an agent reads first.',
    "    endpoint: origin + '/agent/call',",
    '    mcpDiscovery: true,',
    '    // One page, listed honestly — see the note at the top of this file on why',
    '    // an UNSERVED /sitemap.xml is worse than none behind a dev server.',
    "    sitemapPages: [{ url: origin + '/' }],",
    '    // …and point robots.txt at it, so the two agree.',
    "    sitemap: origin + '/sitemap.xml',",
    '    // `a2aCard: true` would emit a card with NO skills — the A2A generator',
    '    // only forwards skills it is handed, it does not read the registry the',
    '    // way the MCP card does. Hand it the same registry-derived list so the',
    '    // two cards describe the same surface instead of one being a shell.',
    '    a2aCard: { skills: skillsFromRegistry() },',
    '    llmsSections: [',
    '      {',
    "        title: 'Agent interface',",
    '        links: [',
    '          {',
    "            title: 'Call an action',",
    "            url: origin + '/agent/call',",
    '            description:',
    '              \'POST application/json { "tool": "task-list/<action>", "params": [...], ' +
      '"jwt": "tasks:write" }. The transport status is always 200; READ THE BODY — it is ' +
      'either { "result": ... } or { "error", "code" } where code is 404 (undeclared tool), ' +
      '401 (no credential), 403 (missing the tasks:write scope) or 429 (past 5 calls per ' +
      "verified subject per component). An approved call runs on the live browser instance.',",
    '          },',
    '          {',
    "            title: 'Read live state',",
    "            url: origin + '/agent/state',",
    '            description:',
    "              'GET — the serialized state of the component instance a call would act on.',",
    '          },',
    '          {',
    "            title: 'MCP server card',",
    "            url: origin + '/.well-known/mcp/server-card.json',",
    '            description:',
    "              'The callable tools, derived from the live component registry rather than " +
      "hand-maintained.',",
    '          },',
    '          {',
    "            title: 'A2A agent card',",
    "            url: origin + '/.well-known/agent-card.json',",
    "            description: 'Agent-to-agent discovery card for the same surface.',",
    '          },',
    '        ],',
    '      },',
    '    ],',
    '    llmsOptional: [',
    '      {',
    "        title: 'MCP over stdio',",
    "        url: origin + '/.well-known/mcp.json',",
    '        description:',
    "          'This app serves MCP over STDIO, not HTTP: register `bun mcp.ts` with your MCP " +
      'client. /agent/call above is not an MCP streamable-http endpoint — it speaks the ' +
      "aihu call shape documented there.',",
    '      },',
    '    ],',
    '  })',
    '}',
    '',
    '/**',
    ' * Answer a discovery request, or return undefined when the path is not one of',
    ' * ours so the caller can go on routing it. Never returns a 404 body: an',
    " * unconfigured document falls through to the app's own not-found, so a caller",
    ' * is never handed a 200 that is not the document it asked for.',
    ' */',
    'export async function handleReadiness(req: Request): Promise<Response | undefined> {',
    '  const url = new URL(req.url)',
    '  const key = ROUTES[url.pathname as keyof typeof ROUTES]',
    '  if (!key) return undefined',
    '  const res = await routesFor(url.origin)[key](req, { params: {}, url })',
    '  return res.status === 404 ? undefined : res',
    '}',
    '',
  ]
  return lines.join('\n')
}

/**
 * server.ts — the GOVERNED Bun capability-bridge server.
 * Actions are gated with an auth scope (`tasks:write`) + a rate limit (5/key), so
 * `/agent/call` shows the full 404→401→403→429 gate against the live instance.
 */
export function agentServerTs(): string {
  const lines = [
    '/**',
    ' * Bun API + capability-bridge server (GOVERNED).',
    ' *',
    ' *   EXTERNAL AGENT --POST /agent/call--> createAgentServer (the 404→401→403→429',
    ' *                                         security gate; sole policy authority)',
    ' *                                           | approved { opaqueActionId, args }',
    ' *                                           v',
    ' *   BROWSER (ws /bridge) <-- attachBridge -- WS capability bridge',
    ' *     the real <task-list> instance executes the action -> on-screen UI updates.',
    ' *',
    ' * Actions here require the `tasks:write` scope and are rate-limited (5/key), so',
    ' * you can see every guardrail. Authorized call:',
    " *   curl -XPOST localhost:5208/agent/call -H 'content-type: application/json' \\",
    ' *     -d \'{"tool":"task-list/setVariant","params":["danger"],"userId":"u1","jwt":"tasks:write"}\'',
    ' * Without the scope → 403; more than 5 calls/key → 429.',
    ' *',
    ' * SECURITY: the auth/rate-limit plugins below are DEMO-grade (a real app uses',
    ' * @aihu/auth + a durable store). The bridge itself is unauthenticated — local',
    ' * dev/demo only; do not expose /agent or /bridge to untrusted networks.',
    ' */',
    '',
    "import { registerAgentMetadata } from '@aihu/agent'",
    "import type { BridgeChannel } from '@aihu/agent-server'",
    "import { createAgentServer } from '@aihu/agent-server'",
    "import { branch, leaf } from '@aihu/arbor'",
    "import { type Signal, signal } from '@aihu/signals'",
    "import { READINESS_PATHS, handleReadiness } from './readiness.ts'",
    '',
    "const TAG = 'task-list'",
    'const PORT = 5208',
    '',
    '// The @agent surface the gate authorizes against (mirrors the component).',
    'registerAgentMetadata({',
    '  tag: TAG,',
    "  describes: 'A durable, agent-reskinnable task list.',",
    '  actions: {',
    ...METADATA_ACTIONS,
    '  },',
    '  state: {',
    ...METADATA_STATE,
    '  },',
    '})',
    '',
    '// ── Governance plugins (demo-grade). ─────────────────────────────────────────',
    '// authPlugin: here a "jwt" is just a comma-list of granted scopes.',
    '//',
    '// `verify` is NOT optional in practice. The gate refuses to serve a scoped or',
    '// rate-limited tool through a plugin that cannot signature-verify a',
    '// credential: without it EVERY call fails closed with 401 AUTH_UNVERIFIABLE,',
    '// whatever scopes it carries. It is also the single source of verified claims',
    '// — the rate-limit key is built from the `sub` it returns, deliberately not',
    '// from the caller-supplied `userId` (otherwise rotating `userId` would reset',
    '// the quota).',
    '//',
    '// DEMO-GRADE: this credential is a bare scope list, so "verifying" it is just',
    '// parsing it. A real app is handed a signed token here and checks the',
    '// signature — see @aihu/auth.',
    'const authPlugin = {',
    '  verify: async (jwt: string) => {',
    "    const scopes = jwt.split(',').map((s) => s.trim()).filter(Boolean)",
    '    if (scopes.length === 0) return null',
    "    return { sub: 'demo-agent:' + scopes.join('+'), scope: scopes.join(' ') }",
    '  },',
    '  checkScope: (jwt: string, scope: string) =>',
    "    jwt.split(',').map((x) => x.trim()).includes(scope),",
    '}',
    '// rateLimitPlugin: in-memory counter, keyed by VERIFIED subject.',
    '//',
    '// `rateSpec` arrives in the shape the compiler lowers `$rate-limit 60` to:',
    "// the string '60/min'. Parse the leading integer rather than calling",
    "// Number() on the whole thing — Number('60/min') is NaN, which a `|| max`",
    '// fallback would silently paper over, leaving every component on the default',
    '// limit no matter what its @agent block declared. A governance control that',
    '// fails open while looking like it works is worse than no control.',
    'const _rl = new Map<string, number>()',
    'function parseRate(spec: string): number {',
    "  if (spec === 'unlimited') return Number.POSITIVE_INFINITY",
    '  const n = Number.parseInt(spec, 10)',
    '  return Number.isFinite(n) && n > 0 ? n : 60',
    '}',
    'const rateLimitPlugin = {',
    '  checkRateLimit: (rateSpec: string, key: string) => {',
    '    const max = parseRate(rateSpec)',
    '    const n = (_rl.get(key) ?? 0) + 1',
    '    _rl.set(key, n)',
    '    return n <= max',
    '  },',
    '}',
    '',
    '// ── The decision log — governance made VISIBLE. ────────────────────────────',
    '// Every /agent/call verdict, refusals included, in a small ring buffer the',
    '// page polls at /agent/log. This exists because of an asymmetry that is easy',
    '// to miss: an APPROVED call reaches the browser over the bridge, so the page',
    '// can see it. A REFUSED call never does — the gate stops it here, which is',
    '// the entire point of a server-side gate. Without this log the human audience',
    '// would only ever see the agent succeed, and the governance story would be',
    '// invisible in the one place it most needs to be legible.',
    'type GateCall = { at: number; tool: string; code: number; note: string }',
    'const LOG_MAX = 25',
    'const _log: GateCall[] = []',
    'function record(tool: string, code: number, note: string): void {',
    '  _log.unshift({ at: Date.now(), tool, code, note })',
    '  if (_log.length > LOG_MAX) _log.length = LOG_MAX',
    '}',
    '',
    '/**',
    ' * Map a gate result onto the status the log (and the UI) speaks.',
    ' *',
    ' * The transport is always 200 — the verdict is in the BODY — so this reads',
    ' * the envelope rather than a response status. An approved call has a',
    ' * `result`; a refused one has `error` + `code`.',
    ' */',
    'function verdict(r: unknown): { code: number; note: string } {',
    '  const e = (r ?? {}) as { error?: unknown; code?: unknown }',
    "  if (e.error === undefined) return { code: 200, note: 'ok' }",
    "  const code = typeof e.code === 'number' ? e.code : 400",
    '  return { code, note: String(e.error) }',
    '}',
    '',
    '// A server-mounted twin so the gate can resolve the tag. It is NEVER executed',
    '// while a browser bridge is attached (the visible instance is authoritative).',
    'const [twinLen, setTwinLen] = signal(0)',
    "const twinNode = branch('div', { id: TAG + '-twin' }, [",
    '  leaf([twinLen, setTwinLen] as unknown as Signal<string>),',
    '])',
    'const server = createAgentServer({',
    '  target: {',
    '    node: twinNode,',
    '    agentBinding: {',
    '      tag: TAG,',
    '      actions: {',
    ...BINDING_ACTIONS,
    '      },',
    '      reads: { owner: () => twinLen(), remaining: () => twinLen(), total: () => twinLen() },',
    '      writes: {},',
    "      scope: 'tasks:write',",
    "      rateLimit: '60/min',",
    '    },',
    '  },',
    '  authPlugin,',
    '  rateLimitPlugin,',
    '  // @aihu/agent-server stands up its own server-side DOM internally — no',
    '  // createHost / jsdom glue needed.',
    '})',
    '',
    'type BunWs = { send(data: string): void; readyState: number }',
    'const messageHandlers = new Set<(data: string) => void>()',
    'const closeHandlers = new Set<() => void>()',
    '',
    'function bridgeChannelFor(ws: BunWs): BridgeChannel {',
    '  return {',
    '    get connected() {',
    '      return ws.readyState === 1',
    '    },',
    '    send(data) {',
    '      ws.send(data)',
    '    },',
    '    onMessage(handler) {',
    '      messageHandlers.add(handler)',
    '      return () => messageHandlers.delete(handler)',
    '    },',
    '    onClose(handler) {',
    '      closeHandlers.add(handler)',
    '      return () => closeHandlers.delete(handler)',
    '    },',
    '  }',
    '}',
    '',
    'let detachBridge: (() => void) | null = null',
    '',
    'Bun.serve<{ bridge: boolean }>({',
    '  port: PORT,',
    '  async fetch(req, srv): Promise<Response | undefined> {',
    '    const url = new URL(req.url)',
    "    if (url.pathname === '/bridge') {",
    '      if (srv.upgrade(req, { data: { bridge: true } })) return undefined',
    "      return new Response('expected websocket', { status: 426 })",
    '    }',
    ...READINESS_DISPATCH,
    "    if (url.pathname === '/agent/call' && req.method === 'POST') {",
    '      const body = (await req.json()) as {',
    '        tool: string',
    '        params?: unknown',
    '        userId?: string',
    '        jwt?: string',
    '      }',
    '      // The gate reads { userId, jwt } from here; pass them through from the call.',
    '      const result = await server.callTool(body.tool, body.params ?? [], {',
    "        userId: body.userId ?? 'demo-agent',",
    "        jwt: body.jwt ?? '',",
    '      })',
    '      // Log the verdict BEFORE returning, so a refusal is on the page by the',
    "      // time the caller reads its own 403. The page's poll is what makes the",
    '      // gate observable to the human sitting in front of it.',
    '      const v = verdict(result)',
    '      record(body.tool, v.code, v.note)',
    '      return Response.json(result)',
    '    }',
    "    if (url.pathname === '/agent/state') {",
    '      return Response.json(server.serialize())',
    '    }',
    '    // Read-only and unauthenticated: it carries verdicts, never credentials',
    '    // or parameters. The page polls it every 2s to render the call log.',
    "    if (url.pathname === '/agent/log') {",
    '      return Response.json(_log)',
    '    }',
    "    return new Response('not found', { status: 404 })",
    '  },',
    '  websocket: {',
    '    open(ws) {',
    '      detachBridge?.()',
    '      detachBridge = server.attachBridge(bridgeChannelFor(ws as unknown as BunWs))',
    "      console.log('[agent] browser bridge connected')",
    '    },',
    // Explicitly typed: contextual typing from `Bun.serve`'s websocket handler
    // map does NOT reach these params here, so under the scaffolded project's
    // `strict` they are implicit-any (TS7006) and `bun run typecheck` — the
    // command the template's own next-steps prints — fails on a fresh scaffold.
    // #595 fixed this class of error by adding @types/bun; #601 reintroduced it
    // while wiring the readiness surface. Pinned by a regression test now.
    '    message(_ws: unknown, message: string | Uint8Array) {',
    "      const data = typeof message === 'string' ? message : message.toString()",
    '      for (const h of [...messageHandlers]) h(data)',
    '    },',
    '    close() {',
    '      for (const h of [...closeHandlers]) h()',
    '      messageHandlers.clear()',
    '      closeHandlers.clear()',
    '    },',
    '  },',
    '})',
    '',
    "console.log('[agent] API + bridge on http://localhost:' + PORT + ' (actions gated: scope tasks:write, 60/min)')",
    "console.log('  POST /agent/call   { tool, params, userId, jwt }   drive the component')",
    "console.log('  GET  /agent/state                                  read current state')",
    "console.log('  GET  /agent/log                                    gate verdicts, refusals included')",
    "console.log('  WS   /bridge                                       browser capability bridge')",
    "console.log('  GET  ' + READINESS_PATHS.join(', ') + '   discovery surface')",
    '',
  ]
  return lines.join('\n')
}

/** src/main.ts — the browser bridge entry. */
export function agentMainTs(): string {
  const lines = [
    '/**',
    ' * Browser entry. Mounts the visible <task-list>, takes the compiler-injected',
    ' * per-instance @agent dispatcher off the element, and runs the capability-bridge',
    ' * client over a WebSocket — so server-approved agent calls execute against THIS',
    ' * on-screen instance.',
    ' */',
    "import { createBridgeClient } from '@aihu/agent-server'",
    "import type { BridgeChannel } from '@aihu/agent-server'",
    "import { _takeAgentDispatcher } from '@aihu/runtime'",
    '',
    '// Side-effect import: the :root half of the project theme. Without this the',
    '// custom properties are never SET, and every rule falls back to the value',
    '// baked in at build time — see the long note at the top of src/theme.css.',
    "import 'virtual:aihu-theme.css'",
    '',
    '// Side-effect import: compiles + registers the custom element.',
    "import './task-list.aihu'",
    '',
    "const TAG = 'task-list'",
    "const BRIDGE_URL = 'ws://' + location.hostname + ':5208/bridge'",
    '',
    'function wrapBrowserWs(ws: WebSocket): BridgeChannel {',
    '  return {',
    '    get connected() {',
    '      return ws.readyState === WebSocket.OPEN',
    '    },',
    '    send(data) {',
    '      ws.send(data)',
    '    },',
    '    onMessage(handler) {',
    '      const h = (e: MessageEvent): void => handler(String(e.data))',
    "      ws.addEventListener('message', h)",
    "      return () => ws.removeEventListener('message', h)",
    '    },',
    '    onClose(handler) {',
    "      ws.addEventListener('close', handler)",
    "      return () => ws.removeEventListener('close', handler)",
    '    },',
    '  }',
    '}',
    '',
    'function start(): void {',
    '  const el = document.querySelector(TAG)',
    '  if (!el) {',
    "    console.error('[agent] <' + TAG + '> not found')",
    '    return',
    '  }',
    '  const dispatcher = _takeAgentDispatcher(el)',
    '  if (!dispatcher) {',
    "    console.error('[agent] no per-instance dispatcher — built for client+@agent?')",
    '    return',
    '  }',
    '  const ws = new WebSocket(BRIDGE_URL)',
    "  ws.addEventListener('open', () => {",
    '    createBridgeClient({',
    '      dispatcher,',
    '      channel: wrapBrowserWs(ws),',
    '      // What GET /agent/state reports. Mirrors the three readable names in',
    '      // the registry (owner, remaining, total) so an agent that read the MCP',
    '      // card finds the same vocabulary here instead of a second one.',
    '      serialize: () => {',
    '        const root = el.shadowRoot ?? el',
    "        const items = root.querySelectorAll('.tl-item')",
    "        const done = root.querySelectorAll('.tl-item.done')",
    '        return {',
    "          owner: el.getAttribute('owner') ?? 'Alex',",
    '          total: items.length,',
    '          remaining: items.length - done.length,',
    '        }',
    '      },',
    '    })',
    "    console.log('[agent] bridge connected — the agent can now drive this instance')",
    '  })',
    "  ws.addEventListener('error', () => {",
    "    console.warn('[agent] could not reach the bridge at ' + BRIDGE_URL + ' — is `bun run server` up?')",
    '  })',
    '}',
    '',
    "if (document.readyState === 'loading') {",
    "  document.addEventListener('DOMContentLoaded', start)",
    '} else {',
    '  start()',
    '}',
    '',
  ]
  return lines.join('\n')
}

/**
 * src/task-list.aihu — the dual-audience showcase.
 *
 * ONE component instance. TWO callers. TWO governance regimes.
 *
 * A human clicks it in the browser. An external AI agent drives the SAME live
 * instance over the capability bridge. They are not equals: what each may do is
 * decided by a four-tier ladder declared right here in `@state`, and enforced
 * server-side by `server.ts`. The ladder IS the lesson — every member below is
 * annotated with which caller reaches it and what stops the other one.
 *
 * The template is also the corpus's widest proven-construct sample (the
 * "kitchen sink"): prop with attribute/reflect, state, derived, action, effect,
 * onMount/onDispose, aria(), if/elseif/else, each+key+empty, show, bind:value,
 * class:, on:*.prevent, <group>, and the standalone `@agent` block —
 * every one of them already exercised elsewhere in the corpus, so a fresh
 * scaffold compiles.
 *
 * Styling comes from `@aihu/css-engine` utility classes resolved against
 * `src/theme.css`, with a short authored `@style` block for the few rules the
 * utility vocabulary does not cover.
 */
export function agentComponentAihu(): string {
  return `<!--
  task-list — one instance, two callers, two governance regimes.

  ┌─────────────────────────────────────────────────────────────────────────┐
  │ TIER            MEMBERS                    HUMAN          AGENT         │
  ├─────────────────────────────────────────────────────────────────────────┤
  │ 0 public read   owner                      reads          reads, no auth│
  │ 1 derived read  remaining, total           reads          reads as MCP  │
  │                                                           resource      │
  │ 2 governed      addTask, toggleTask,       clicks         needs the     │
  │   write         setLabel, setVariant       freely         tasks:write   │
  │                                                           scope + under │
  │                                                           the rate limit│
  │ 3 human only    removeTask, clearAll,      clicks         DOES NOT EXIST│
  │                 setFilter, addFromInput    freely         — no expose:, │
  │                                                           so never in   │
  │                                                           the registry  │
  └─────────────────────────────────────────────────────────────────────────┘

  Two different mechanisms do the governing, and confusing them is the most
  common way to ship an open door:

    HIDING A CONTROL        is UX. It decides what a person is SHOWN. It is
                            never authorization — anyone with devtools undoes it.

    $scope / $rate-limit    is THE GATE (declared in the agent block at the
                            bottom of this file). Enforced in server.ts before
                            a call ever reaches this browser instance, against a
                            signature-VERIFIED credential. This is the boundary.

  Tier 3 is the strongest statement of the two-audience split, and it is neither
  of the above: an action with no expose: key is not "forbidden to the agent",
  it is INVISIBLE to it. It never enters the registry, so it is not in llms.txt,
  not in the MCP server card, not in the A2A card, and /agent/call answers 404
  for it — the agent cannot even discover a name it might have tried to guess.
  The safest permission check is the one that has nothing to check.
-->

@state {
  // ── TIER 0 — PUBLIC READ ────────────────────────────────────────────────
  // expose: 'read' with no scope above it: readable by an agent that presents
  // no credential at all. attribute/reflect keep the DOM attribute in step so
  // a plain HTML author sets it without touching JS: <task-list owner="Robin">
  let owner = prop({
    default: 'Alex',
    attribute: 'owner',
    reflect: true,
    describe: 'Display name of the person this list belongs to',
    expose: 'read',
  })

  // ── LOCAL STATE (not on the agent surface at all) ───────────────────────
  let tasks = state<Array<{ id: number; text: string; done: boolean }>>([])
  let nextId = state(1)
  let draft = state('')
  let label = state('Tasks')
  let variant = state<'default' | 'compact' | 'danger'>('default')
  let filter = state<'all' | 'open' | 'done'>('all')
  // The gate's decision log, polled from server.ts. This is what makes the
  // governance VISIBLE: a human watching the page sees the agent's refused
  // calls (401/403/429), not just the ones that landed.
  let calls = state<Array<{ at: number; tool: string; code: number; note: string }>>([])
  let inputEl = state<HTMLInputElement | null>(null)
  let pollTimer = state(0)

  // ── TIER 1 — DERIVED READ ───────────────────────────────────────────────
  // An exposed derived becomes a READ-ONLY MCP resource: the agent can observe
  // the consequence of its writes without being handed a way to forge them.
  const remaining = derived(
    { describe: 'Count of tasks not yet done', expose: 'read' },
    () => tasks.filter(t => !t.done).length)
  const total = derived(
    { describe: 'Total number of tasks on the list', expose: 'read' },
    () => tasks.length)

  // Unexposed derived — pure view state for the human UI. The agent has no
  // business knowing which filter chip a person happens to have clicked.
  const visible = derived(() => filter === 'all'
    ? tasks
    : filter === 'open'
      ? tasks.filter(t => !t.done)
      : tasks.filter(t => t.done))
  const allDone = derived(() => tasks.length > 0 && remaining() === 0)
  const refused = derived(() => calls.filter(c => c.code >= 400).length)

  // ── TIER 2 — GOVERNED WRITE ─────────────────────────────────────────────
  // expose: 'read write' — the tier must match what the member DOES. These
  // mutate state, so 'read' alone would be a lie the registry then publishes.
  // For the agent every one of these is gated in server.ts by the tasks:write
  // scope and the rate limit declared in the @agent block below. For the human
  // they are ordinary click handlers: same code, same instance, no gate.
  const addTask = action(
    { describe: 'Append a task with the given text', expose: 'read write' },
    (text: string) => {
      const t = String(text ?? '').trim()
      if (!t) return
      tasks = [...tasks, { id: nextId, text: t, done: false }]
      nextId = nextId + 1
    })

  const toggleTask = action(
    { describe: 'Mark the task with this id done or not done', expose: 'read write' },
    (id: number) => {
      tasks = tasks.map(t => t.id === Number(id) ? { ...t, done: !t.done } : t)
    })

  const setLabel = action(
    { describe: 'Set the panel heading text', expose: 'read write' },
    (text: string) => { label = String(text ?? '').trim() || 'Tasks' })

  const setVariant = action(
    { describe: "Set the visual variant: one of 'default', 'compact', 'danger'",
      expose: 'read write' },
    (v: string) => {
      const next = String(v ?? 'default')
      variant = next === 'compact' || next === 'danger' ? next : 'default'
    })

  // ── TIER 3 — HUMAN ONLY ─────────────────────────────────────────────────
  // No expose: key. Not "denied to the agent" — INVISIBLE to it. Destructive
  // and view-only operations both live here: the first because an agent should
  // not be able to wipe a person's list, the second because it is not the
  // agent's concern.
  const removeTask = action((id: number) => {
    tasks = tasks.filter(t => t.id !== id)
  })
  const clearAll = action(() => { tasks = [] })
  const setFilter = action((f: 'all' | 'open' | 'done') => { filter = f })
  const addFromInput = action(() => {
    addTask(draft)
    draft = ''
    // Refocus so rapid entry keeps the caret in place.
    inputEl?.focus()
  })

  // ── ACCESSIBILITY ───────────────────────────────────────────────────────
  // The human audience has requirements the agent does not: a screen reader is
  // a third kind of reader, and it reads the DOM, not the registry.
  aria({ role: 'region', label: 'Task list' })

  // ── LIFECYCLE ───────────────────────────────────────────────────────────
  onMount(() => {
    // Durable across a refresh — and because the agent's approved calls drive
    // these SAME signals, an agent's reskin survives the reload too.
    try {
      const saved = localStorage.getItem('aihu:task-list:v2')
      if (saved) {
        const p = JSON.parse(saved)
        if (Array.isArray(p.tasks)) (tasks = p.tasks)
        if (typeof p.nextId === 'number') (nextId = p.nextId)
        if (typeof p.label === 'string') (label = p.label)
        if (typeof p.variant === 'string') (variant = p.variant)
      }
    } catch {
      // localStorage unavailable (private mode, blocked, corrupted) — start fresh.
    }
    // Poll the gate log. The browser never sees a REFUSED call over the bridge
    // — the gate stops it server-side, which is the whole point — so the only
    // way to show refusals on the page is to read the server's decision log.
    const pull = () => {
      fetch('/agent/log')
        .then(r => r.json())
        .then(rows => { if (Array.isArray(rows)) (calls = rows) })
        .catch(() => {
          // Bridge server down (\`bun run server\`); the human UI keeps working.
        })
    }
    pull()
    pollTimer = setInterval(pull, 2000)
  })

  onDispose(() => { clearInterval(pollTimer) })

  effect(() => {
    try {
      localStorage.setItem(
        'aihu:task-list:v2',
        JSON.stringify({ tasks, nextId, label, variant }))
    } catch {
      // Quota / SecurityError — persistence is best-effort, never fatal.
    }
  })
}

@template {
  <section class="tl flex flex-col gap-4 p-4 rounded-lg border border-border text-foreground mx-auto" class:compact={variant === 'compact'} class:danger={variant === 'danger'}>

    <header class="flex items-center justify-between gap-3">
      <h2 class="tl-title text-xl font-semibold text-primary">
        {owner}'s {label}
      </h2>
      <span class="tl-count rounded-full px-3 py-1 text-sm font-semibold bg-primary text-primary-foreground">
        {remaining} / {total}
      </span>
    </header>

    <!-- show= keeps the node in the DOM and toggles [hidden]; if= removes it. -->
    <p class="text-sm font-medium text-success" show={allDone()} role="status">
      Everything done.
    </p>

    <!-- on:submit.prevent — the dotted event-modifier surface. ref= captures
         the element into a signal so addFromInput can refocus it. -->
    <form class="flex gap-2" on:submit.prevent={addFromInput}>
      <label class="tl-sr" for="tl-new">New task</label>
      <input
        id="tl-new"
        class="tl-input flex-1 px-3 py-2 rounded border border-border"
        bind:value={draft}
        ref={inputEl}
        placeholder="Add a task and press Enter"
      >
      <button class="tl-btn px-3 py-2 rounded border border-primary text-primary font-medium" type="submit">Add</button>
    </form>

    <ul class="tl-items flex flex-col gap-2">
      <li
        each={task of visible}
        key={task.id}
        class="tl-item flex items-center gap-3 px-3 py-2 rounded border border-border bg-muted"
        class:done={task.done}
      >
        <input
          type="checkbox"
          checked={task.done}
          on:change={() => toggleTask(task.id)}
        >
        <span class="tl-text flex-1 truncate">{task.text}</span>
        <!-- Tier 3: a human may delete a single task. The agent has no such tool. -->
        <button class="tl-x text-muted-foreground" on:click={() => removeTask(task.id)} aria-label="Remove task">×</button>
      </li>
      <!-- empty — the each-fallback, rendered only when the filter matches nothing. -->
      <li empty class="px-3 py-2 text-sm text-muted-foreground">
        Nothing here yet. Add one above, or ask your agent to.
      </li>
    </ul>

    <footer class="flex items-center gap-2 flex-wrap" if={tasks.length > 0}>
      <button class="tl-chip px-3 py-1 rounded text-sm text-muted-foreground" on:click={() => setFilter('all')}  class:sel={filter === 'all'}>All</button>
      <button class="tl-chip px-3 py-1 rounded text-sm text-muted-foreground" on:click={() => setFilter('open')} class:sel={filter === 'open'}>Open</button>
      <button class="tl-chip px-3 py-1 rounded text-sm text-muted-foreground" on:click={() => setFilter('done')} class:sel={filter === 'done'}>Done</button>

      <!-- A destructive control, freely available to the person at the keyboard
           and UNREACHABLE by the agent. Note what is NOT doing the work here:
           there is no scope check, no permission flag, no hidden attribute on
           this button. The only thing standing between an agent and this list
           is that clearAll carries no expose: key, so the tool does not exist
           to be called. Absence from the registry IS the enforcement. -->
      <button class="tl-danger px-3 py-1 rounded text-sm font-medium border border-destructive text-destructive" on:click={clearAll}>
        Clear all
      </button>
    </footer>

    <!-- ── The gate, made visible ──────────────────────────────────────────
         Every agent call server.ts decided on, refusals included. This is the
         half of the story a component normally hides: the human sees WHAT the
         agent tried, not only what it achieved. -->
    <section class="tl-log flex flex-col gap-2" aria-label="Agent call log">
      <h3 class="text-sm font-semibold">
        Agent calls
        <span class="text-sm font-semibold text-destructive" show={refused() > 0}>· {refused} refused</span>
      </h3>

      <group if={calls.length === 0}>
        <p class="text-sm text-muted-foreground">
          No agent calls yet. Drive this instance from another terminal and watch
          the rows land here — the refused ones too.
        </p>
      </group><group else>
        <ul class="tl-rows flex flex-col gap-2">
          <li
            each={call of calls}
            key={call.at}
            class="tl-row flex items-center gap-3 px-3 py-2 rounded border border-destructive text-sm"
            class:ok={call.code < 400}
          >
            <code class="tl-code font-semibold">{call.code}</code>
            <span class="flex-1 truncate">{call.tool}</span>
            <!-- if / elseif / else — the agent's refusal, in the words a person
                 needs, not the words the protocol uses. -->
            <span class="text-muted-foreground" if={call.code === 404}>no such tool</span>
            <span class="text-muted-foreground" elseif={call.code === 401}>no credential</span>
            <span class="text-muted-foreground" elseif={call.code === 403}>missing tasks:write</span>
            <span class="text-muted-foreground" elseif={call.code === 429}>rate limited</span>
            <span class="text-muted-foreground" else>{call.note}</span>
          </li>
        </ul>
      </group>
    </section>
  </section>
}

@style {
  /* Utility classes (src/theme.css tokens) carry layout, spacing and the whole
     palette. What is left here is only what the utility vocabulary cannot say.

     Three kinds of rule, and nothing else:
       1. tokens with no utility keyword — card, input, and the *-subtle family
          are not in the engine's hand-curated vocabulary, so they are written by
          hand against the same tokens;
       2. variant and state overrides (.compact, .danger, .done, .sel, .ok),
          which need a compound selector;
       3. pseudo-classes (:hover, :focus-visible) and the sr-only pattern. */

  .tl {
    max-width: 34rem;
    background: var(--color-card, #ffffff);
    font-family: var(--font-sans, system-ui, -apple-system, sans-serif);
  }
  .tl.compact { max-width: 26rem; font-size: 0.9rem; }
  .tl.danger {
    border-color: var(--color-destructive, #b4232a);
    background: var(--color-destructive-subtle, #fff6f5);
  }
  .tl.danger .tl-title { color: var(--color-destructive, #b4232a); }
  .tl.danger .tl-count { background: var(--color-destructive, #b4232a); }

  /* Screen-reader-only: present for assistive tech, invisible on screen. The
     agent reads the registry, a person reads the screen, and a screen-reader
     user reads the DOM — three audiences, and this one is easiest to forget. */
  .tl-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .tl-input { background: var(--color-input, #ffffff); color: inherit; font: inherit; }
  .tl-input:focus-visible {
    outline: 2px solid var(--color-ring, #2b59ff);
    outline-offset: 1px;
  }

  .tl-btn { cursor: pointer; background: transparent; font: inherit; }
  .tl-btn:hover { background: var(--color-primary-subtle, #eef2ff); }

  .tl-item.done .tl-text {
    text-decoration: line-through;
    color: var(--color-muted-foreground, #71717a);
  }

  .tl-x { cursor: pointer; border: 0; background: transparent; font-size: 1.1rem; line-height: 1; }
  .tl-x:hover { color: var(--color-destructive, #b4232a); }

  .tl-chip { cursor: pointer; border: 1px solid transparent; background: transparent; font: inherit; }
  .tl-chip:hover { border-color: var(--color-border, #e4e4e7); }
  .tl-chip.sel {
    border-color: var(--color-primary, #2b59ff);
    color: var(--color-primary, #2b59ff);
    font-weight: 600;
  }

  .tl-danger { cursor: pointer; background: transparent; font: inherit; }

  .tl-log { border-top: 1px solid var(--color-border, #e4e4e7); padding-top: 0.75rem; }

  /* A refused call reads red, an approved one green. The log is the only place
     in this UI where the agent's failures are as visible as its successes, and
     that is deliberate: a gate nobody can see is a gate nobody trusts. */
  .tl-row { background: var(--color-destructive-subtle, #fff6f5); }
  .tl-row.ok {
    border-color: var(--color-success, #1a7f4b);
    background: var(--color-success-subtle, #f2fbf6);
  }
  .tl-code { font-family: var(--font-mono, ui-monospace, monospace); }

}

// The REAL gate — enforced in server.ts against a signature-verified credential
// before a call ever reaches this browser instance.
//
//   $scope       every exposed call needs this claim, or 403.
//   $rate-limit  calls per minute per verified subject, or 429.
//
// Neither applies to the human clicking the page: same instance, same actions,
// different governance. That asymmetry is the entire template.
@agent {
  $scope "tasks:write"
  $rate-limit 60
}
`
}

/**
 * src/theme.css — the project palette.
 *
 * `@theme` registers `--color-*` / `--font-*` tokens with `@aihu/css-engine`.
 * Two consumers read them, which is why the file is worth having at all in a
 * template this small:
 *
 *   1. Utility classes in the component's markup (`rounded-lg`, `border`, the
 *      `bg-*` / `text-*` families) compile against these values.
 *   2. The component's authored `@style` block references the same tokens as
 *      `var(--color-primary, …)`, so one edit here retints both halves.
 *
 * vite.config.ts reads this file and hands the text to the compiler plugin, so
 * the values become `var()` FALLBACKS: a stylesheet that sets the same tokens at
 * `:root` still wins, and a component rendered with no theme loaded at all still
 * looks right.
 */
export function agentThemeCss(): string {
  const lines = [
    "/* Project theme — the ONE place this app's palette is defined.",
    ' *',
    ' * The file carries the same tokens TWICE, on purpose, because they do two',
    ' * different jobs and a single block cannot do both:',
    ' *',
    ' * Edit the block below and the whole app follows. It is read TWICE, by',
    ' * vite.config.ts, for two different jobs:',
    ' *',
    ' *   BUILD TIME  @aihu/css-engine bakes each value in as the fallback in the',
    ' *               `var(--name, <value>)` that a utility class like bg-primary',
    ' *               compiles to. This is what renders if no stylesheet loads.',
    ' *',
    ' *   RUN TIME    the same text, with @theme rewritten to :root, is served as',
    ' *               `virtual:aihu-theme.css` and imported by src/main.ts, so the',
    ' *               properties are actually SET in the document. A set value',
    ' *               beats every fallback, and custom properties inherit through',
    ' *               shadow boundaries, so it reaches inside the component too.',
    ' *',
    ' * That second pass is why the authored rules in task-list.aihu (which write',
    ' * their own var() fallbacks by hand) and the generated utility classes cannot',
    ' * drift apart after you edit this file: at runtime neither fallback is used.',
    ' *',
    ' * The block below is kept free of comments, and the prose lives out here.',
    ' * @aihu/css-engine 0.7.0 and earlier mis-scanned a comment inside @theme and',
    ' * dropped the whole theme SILENTLY — build still exited 0, every token fell',
    ' * back to the built-in aihu-default palette. Fixed in 0.7.1 (mask_comments in',
    ' * aihu-css-core), so on a current engine you may comment inside the block;',
    ' * this layout also renders correctly on an older one.',
    ' */',
    '@theme {',
    '  --color-primary: #2b59ff;',
    '  --color-primary-foreground: #ffffff;',
    '  --color-primary-subtle: #eef2ff;',
    '  --color-background: #ffffff;',
    '  --color-foreground: #18181b;',
    '  --color-card: #ffffff;',
    '  --color-input: #ffffff;',
    '  --color-border: #e4e4e7;',
    '  --color-ring: #2b59ff;',
    '  --color-muted: #fafafa;',
    '  --color-muted-foreground: #71717a;',
    '  --color-success: #1a7f4b;',
    '  --color-success-subtle: #f2fbf6;',
    '  --color-destructive: #b4232a;',
    '  --color-destructive-subtle: #fff6f5;',
    '  --font-sans: system-ui, -apple-system, "Segoe UI", sans-serif;',
    '  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;',
    '}',
    '',
    '/* Token roles, since the blocks above cannot carry them:',
    ' *',
    ' *   primary / primary-foreground / primary-subtle',
    ' *     Brand. Heading, count badge, focus ring, Add button.',
    ' *',
    ' *   background / foreground / card / input / border / ring / muted',
    ' *     Surfaces and chrome. muted-foreground carries de-emphasised text: the',
    ' *     empty state, the filter chips, a completed task.',
    ' *',
    ' *   success / success-subtle        an APPROVED agent call in the call log.',
    ' *   destructive / destructive-subtle',
    " *     A REFUSED agent call, the Clear all button, and the 'danger' variant an",
    ' *     agent can set via setVariant. The contrast with success is load-bearing:',
    ' *     a refusal should be as visible as a success.',
    ' *',
    ' *   font-sans / font-mono            body text and the status codes.',
    ' *',
    ' * Note: card, input and the *-subtle family have no utility keyword in the',
    " * engine's hand-curated vocabulary (bg-card and bg-primary-subtle emit",
    ' * nothing), so task-list.aihu reaches them through authored CSS instead.',
    ' */',
    '',
  ]
  return lines.join('\n')
}

/** index.html — mounts <task-list> + the thesis copy and curl one-liner. */
export function agentIndexHtml(name: string): string {
  const lines = [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `    <title>${name} — agent-driven aihu</title>`,
    '    <style>',
    '      body { font-family: system-ui, -apple-system, sans-serif; max-width: 40rem;',
    '        margin: 3rem auto; padding: 0 1rem; color: #1a1a1a; line-height: 1.5; }',
    '      .lede { color: #555; font-size: 0.95rem; margin-bottom: 2rem; }',
    '      ul.lede { padding-left: 1.25rem; } ul.lede li { margin-bottom: 0.5rem; }',
    '      code { font-family: ui-monospace, monospace; background: #f3f3f3;',
    '        padding: 0.1rem 0.3rem; border-radius: 4px; }',
    '    </style>',
    '  </head>',
    '  <body>',
    '    <h1>One component. Two callers. Two rulebooks.</h1>',
    '    <p class="lede">',
    '      The &lt;task-list&gt; below is a real aihu custom element with durable state.',
    '      Add tasks yourself — you are the ungoverned caller, you just click. Then',
    '      drive the SAME on-screen instance as an agent, where every call is checked',
    '      first:',
    '      <br /><br />',
    '      <code>curl -XPOST localhost:5208/agent/call -H \'content-type: application/json\' -d \'{"tool":"task-list/setVariant","params":["danger"],"userId":"u1","jwt":"tasks:write"}\'</code>',
    '    </p>',
    '    <p class="lede">',
    '      Now try the refusals — they are the interesting half, and they show up in',
    "      the component's own call log as they happen:",
    '    </p>',
    '    <ul class="lede">',
    '      <li><strong>403</strong> — drop the scope:',
    '        <code>\'{"tool":"task-list/addTask","params":["x"],"userId":"u1","jwt":"tasks:read"}\'</code></li>',
    '      <li><strong>401</strong> — drop the credential:',
    '        <code>\'{"tool":"task-list/addTask","params":["x"],"userId":"u1","jwt":""}\'</code></li>',
    '      <li><strong>404</strong> — ask for a human-only action. <code>clearAll</code> is',
    '        real and on the page, but it carries no <code>expose:</code>, so no such tool',
    '        exists to an agent:',
    '        <code>\'{"tool":"task-list/clearAll","params":[],"userId":"u1","jwt":"tasks:write"}\'</code></li>',
    '      <li><strong>429</strong> — past 60 calls a minute for one verified subject.</li>',
    '    </ul>',
    '    <p class="lede">',
    '      An agent that has only this URL discovers the rest for itself:',
    '      <a href="/llms.txt">llms.txt</a> ·',
    '      <a href="/.well-known/mcp/server-card.json">MCP server card</a> ·',
    '      <a href="/.well-known/agent-card.json">A2A agent card</a> — served live by',
    '      <code>server.ts</code> from the same component registry the gate authorizes',
    '      against, so the advertised tools are the callable ones.',
    '    </p>',
    '    <task-list></task-list>',
    '    <script type="module" src="/src/main.ts"></script>',
    '  </body>',
    '</html>',
    '',
  ]
  return lines.join('\n')
}

/**
 * mcp.ts — expose the component's actions to a standard MCP client (Claude
 * Desktop, Cursor, Claude Code) over stdio, bridged to the LIVE browser instance.
 *
 * OPEN by design (no scope/rate-limit here) so an AI client can discover + drive
 * the reskin with zero auth friction — this is the "an agent molds the component"
 * entry. (server.ts is the governed HTTP entry that demonstrates the gate.)
 *
 * Your MCP client SPAWNS this process; it opens the WS bridge (:5208) the browser
 * connects to, and serves MCP over stdout — so all human-facing logging goes to
 * stderr (stdout is the MCP JSON-RPC channel; a stray console.log corrupts it).
 *
 * Run the page separately (`vite --port 5108`), register `bun mcp.ts` with your
 * MCP client (see README), open the page, then ask the AI to reskin the component.
 */
export function agentMcpTs(): string {
  const lines = [
    "import { getAllAgentMetadata, registerAgentMetadata } from '@aihu/agent'",
    "import type { BridgeChannel } from '@aihu/agent-server'",
    "import { createAgentServer, serveComponentMcp } from '@aihu/agent-server'",
    "import { branch, leaf } from '@aihu/arbor'",
    "import { type Signal, signal } from '@aihu/signals'",
    "import { handleReadiness } from './readiness.ts'",
    '',
    "const TAG = 'task-list'",
    'const PORT = 5208',
    '',
    'registerAgentMetadata({',
    '  tag: TAG,',
    "  describes: 'A durable, agent-reskinnable task list.',",
    '  actions: {',
    ...METADATA_ACTIONS,
    '  },',
    '  state: {',
    ...METADATA_STATE,
    '  },',
    '})',
    '',
    'const [twinLen, setTwinLen] = signal(0)',
    "const twinNode = branch('div', { id: TAG + '-twin' }, [",
    '  leaf([twinLen, setTwinLen] as unknown as Signal<string>),',
    '])',
    'const server = createAgentServer({',
    '  target: {',
    '    node: twinNode,',
    '    agentBinding: {',
    '      tag: TAG,',
    '      actions: {',
    ...BINDING_ACTIONS,
    '      },',
    '      reads: { owner: () => twinLen(), remaining: () => twinLen(), total: () => twinLen() },',
    '      writes: {},',
    '      scope: undefined,',
    '      rateLimit: undefined,',
    '    },',
    '  },',
    '})',
    '',
    'type BunWs = { send(data: string): void; readyState: number }',
    'const messageHandlers = new Set<(data: string) => void>()',
    'const closeHandlers = new Set<() => void>()',
    '',
    'function bridgeChannelFor(ws: BunWs): BridgeChannel {',
    '  return {',
    '    get connected() {',
    '      return ws.readyState === 1',
    '    },',
    '    send(data) {',
    '      ws.send(data)',
    '    },',
    '    onMessage(handler) {',
    '      messageHandlers.add(handler)',
    '      return () => messageHandlers.delete(handler)',
    '    },',
    '    onClose(handler) {',
    '      closeHandlers.add(handler)',
    '      return () => closeHandlers.delete(handler)',
    '    },',
    '  }',
    '}',
    '',
    'let detachBridge: (() => void) | null = null',
    '',
    '// WS bridge for the browser instance. NOTE: stdout is the MCP channel — log to',
    '// stderr (console.error) only.',
    'Bun.serve<{ bridge: boolean }>({',
    '  port: PORT,',
    '  async fetch(req, srv): Promise<Response | undefined> {',
    '    const url = new URL(req.url)',
    "    if (url.pathname === '/bridge') {",
    '      if (srv.upgrade(req, { data: { bridge: true } })) return undefined',
    "      return new Response('expected websocket', { status: 426 })",
    '    }',
    ...READINESS_DISPATCH,
    "    if (url.pathname === '/agent/state') return Response.json(server.serialize())",
    "    return new Response('not found', { status: 404 })",
    '  },',
    '  websocket: {',
    '    open(ws) {',
    '      detachBridge?.()',
    '      detachBridge = server.attachBridge(bridgeChannelFor(ws as unknown as BunWs))',
    "      console.error('[agent-mcp] browser bridge connected')",
    '    },',
    // Explicitly typed: contextual typing from `Bun.serve`'s websocket handler
    // map does NOT reach these params here, so under the scaffolded project's
    // `strict` they are implicit-any (TS7006) and `bun run typecheck` — the
    // command the template's own next-steps prints — fails on a fresh scaffold.
    // #595 fixed this class of error by adding @types/bun; #601 reintroduced it
    // while wiring the readiness surface. Pinned by a regression test now.
    '    message(_ws: unknown, message: string | Uint8Array) {',
    "      const data = typeof message === 'string' ? message : message.toString()",
    '      for (const h of [...messageHandlers]) h(data)',
    '    },',
    '    close() {',
    '      for (const h of [...closeHandlers]) h()',
    '      messageHandlers.clear()',
    '      closeHandlers.clear()',
    '    },',
    '  },',
    '})',
    '',
    "console.error('[agent-mcp] WS bridge on :' + PORT + ' — serving MCP (tools/list, tools/call) over stdio')",
    '',
    '// Serve the component actions as MCP tools (names: <tag>/<action>, e.g.',
    "// 'task-list/setVariant') over stdio. Each tools/call routes through the gate",
    '// and, when the browser is connected, executes on the visible instance.',
    'await serveComponentMcp(server, getAllAgentMetadata())',
    '',
  ]
  return lines.join('\n')
}

/** README.md — quickstart + the reskin/governance/MCP recipes. */
export function agentReadme(name: string): string {
  const lines = [
    `# ${name}`,
    '',
    'One `<task-list>` Web Component. Two callers. Two rulebooks.',
    '',
    'A human clicks it. An AI agent drives the **same visible instance** over a',
    'server-mediated capability bridge — the server is the policy gate, the browser is the',
    'executor. They are not equals, and the difference is the point of this template:',
    'what each caller may do is decided by a four-tier ladder declared in',
    '`src/task-list.aihu` and enforced by `server.ts`.',
    '',
    '## The tier ladder',
    '',
    '| Tier | Members | Human | Agent |',
    '| --- | --- | --- | --- |',
    '| 0 · public read | `owner` | reads | reads, no credential needed |',
    '| 1 · derived read | `remaining`, `total` | reads | reads as an MCP resource |',
    '| 2 · governed write | `addTask`, `toggleTask`, `setLabel`, `setVariant` | clicks freely | needs the `tasks:write` scope, under 60/min |',
    '| 3 · human only | `clearAll`, `removeTask`, `setFilter`, `addFromInput` | clicks freely | **does not exist** |',
    '',
    'Tier 3 is the one worth studying. An action with no `expose:` key is not *forbidden*',
    'to the agent, it is **invisible** to it: it never enters the registry, so it is not in',
    '`llms.txt`, not in the MCP server card, not in the A2A card, and `/agent/call` answers',
    '404 for it. There is no permission flag to misconfigure and no scope to leak, because',
    'there is nothing to check. Absence from the registry IS the enforcement.',
    '',
    'Hiding a control in the UI is a different thing entirely, and never authorization —',
    "anyone with devtools undoes it. `$scope` / `$rate-limit` in the component's agent",
    'block is the boundary, checked in `server.ts` against a signature-verified credential',
    'before a call ever reaches the browser.',
    '',
    '## Run it',
    '',
    '```bash',
    'bun install',
    'bun run dev      # Bun bridge server (:5208) + Vite (:5108)',
    '```',
    '',
    'Open the Vite URL and add tasks with the input — you are the ungoverned caller, you',
    'just click. Then drive the SAME instance as an agent, where every call is checked',
    'first. The component renders its own **call log**, refusals included, so you can watch',
    'the gate work instead of reading about it:',
    '',
    '```bash',
    '# authorized — adds a task, then reskins the live component:',
    "curl -XPOST localhost:5208/agent/call -H 'content-type: application/json' \\",
    '  -d \'{"tool":"task-list/setLabel","params":["Sprint Board"],"userId":"u1","jwt":"tasks:write"}\'',
    "curl -XPOST localhost:5208/agent/call -H 'content-type: application/json' \\",
    '  -d \'{"tool":"task-list/setVariant","params":["danger"],"userId":"u1","jwt":"tasks:write"}\'',
    '',
    '# no scope → 403 SCOPE_DENIED:',
    "curl -XPOST localhost:5208/agent/call -H 'content-type: application/json' \\",
    '  -d \'{"tool":"task-list/addTask","params":["x"],"userId":"u1","jwt":"tasks:read"}\'',
    '',
    '# no credential → 401 AUTH_REQUIRED:',
    "curl -XPOST localhost:5208/agent/call -H 'content-type: application/json' \\",
    '  -d \'{"tool":"task-list/addTask","params":["x"],"userId":"u1","jwt":""}\'',
    '',
    '# a tier 3 action → 404. clearAll is real, and on the page, and has no expose: key:',
    "curl -XPOST localhost:5208/agent/call -H 'content-type: application/json' \\",
    '  -d \'{"tool":"task-list/clearAll","params":[],"userId":"u1","jwt":"tasks:write"}\'',
    '',
    '# past 60 calls a minute for one verified subject → 429 RATE_LIMITED.',
    '',
    '# every verdict above, as the page sees it:',
    'curl -s localhost:5208/agent/log | jq .',
    '```',
    '',
    'The transport status is always 200 — the outcome is the `code` in the JSON body',
    '(`{ result }` or `{ error, code }`). The rate-limit key is the VERIFIED subject, not',
    'the `userId` in the request: rotating `userId` does not buy more quota.',
    '',
    'The on-screen component re-titles + re-skins (try variants `default` / `compact` /',
    '`danger`). The gate (auth + rate-limit) lives in `server.ts` — demo-grade plugins you',
    'swap for `@aihu/auth` + a real store in production.',
    '',
    '## Theming',
    '',
    '`src/theme.css` is the whole palette, and `vite.config.ts` reads it twice: once as',
    'build-time input to `@aihu/css-engine` (so utility classes like `bg-primary` compile',
    'with your values baked in as `var()` fallbacks), and once rewritten to `:root` and',
    'served as `virtual:aihu-theme.css` (so the properties are actually set at runtime).',
    "Edit one block, rebuild, and both the utility classes and the component's authored",
    'CSS follow.',
    '',
    '> The generated `@theme { … }` block carries no comments, and its prose sits outside.',
    '> `@aihu/css-engine` 0.7.0 and earlier mis-scanned a comment inside the block and',
    '> dropped the whole theme silently — the build still exited 0 and the page rendered the',
    '> built-in palette instead of yours. Fixed in 0.7.1; the layout is kept either way so',
    '> the scaffold is correct on an older engine too.',
    '',
    '## Discovery — how an agent finds all this',
    '',
    'An agent that has nothing but the app URL reads the discovery surface. All of it is',
    'served **live** by `server.ts` (see `readiness.ts`) and proxied through Vite, so the',
    'same paths answer on the app URL (:5108) and on the bridge server (:5208):',
    '',
    '| Path | Type | What it is |',
    '| --- | --- | --- |',
    '| `/llms.txt` | `text/plain` | The index: what the app is, how to call it, the component + its actions |',
    '| `/llms-full.txt` | `text/plain` | Same, with the expanded sections |',
    '| `/robots.txt` | `text/plain` | Crawl policy (user-delegated AI fetchers allowed, training crawlers not) |',
    '| `/.well-known/mcp/server-card.json` | `application/json` | The callable tools |',
    '| `/.well-known/agent-card.json` | `application/json` | A2A agent card (`/.well-known/agent.json` is a deprecated alias) |',
    '| `/.well-known/mcp.json` | `application/json` | MCP discovery pointer |',
    '| `/sitemap.xml` | `application/xml` | The one page, and what robots.txt points at |',
    '',
    '```bash',
    'curl -s localhost:5108/llms.txt',
    'curl -s localhost:5108/.well-known/mcp/server-card.json | jq .tools',
    '```',
    '',
    'Every one of those paths answers with its own content type, or 404s — none falls',
    'through to the dev-server SPA fallback. Worth re-checking if you add one: a fallback',
    'answers HTTP 200 with `index.html`, and a reader that trusts the status code cannot',
    'tell that from the real document.',
    '',
    'Those documents are **derived**, not hand-written: their component list and tool list',
    'come from the `@aihu/agent` registry that `server.ts` populates — the same registry the',
    'gate authorizes against. So the card cannot advertise a tool the gate will not accept.',
    '',
    'That is also why this template does not use `viteAgentReadinessIntegration()` the way the',
    '`full` template does. That integration emits the documents from a browser-target build,',
    'where the registry is empty — the files would exist and advertise nothing. This template',
    "uses the same package's `createAgentReadinessRoutes()` from the server that holds the",
    'registry instead.',
    '',
    'One caveat the card cannot express: its `transport.type` is `streamable-http`, but',
    "`/agent/call` speaks aihu's own `{ tool, params, userId, jwt }` shape. A standard MCP",
    'client should spawn `bun mcp.ts` over **stdio** (next section) rather than POST to',
    '`/agent/call`. `/llms.txt` says so too, in the document an agent reads first.',
    '',
    '## Drive it with an AI (MCP)',
    '',
    'Standard MCP clients (Claude Desktop, Cursor, Claude Code) can discover the component',
    'tools and call them in natural language. `mcp.ts` serves the actions as MCP tools over',
    'stdio and bridges to the live browser instance (open, no auth — so the AI can drive it',
    'with zero friction).',
    '',
    '1. Start the page (leave it running):',
    '',
    '   ```bash',
    '   vite --port 5108',
    '   ```',
    '',
    '2. Register the MCP server with your client. **Claude Code:**',
    '',
    '   ```bash',
    `   claude mcp add ${name} -- bun /ABSOLUTE/PATH/TO/${name}/mcp.ts`,
    '   ```',
    '',
    '   **Claude Desktop** (`claude_desktop_config.json`):',
    '',
    '   ```json',
    '   {',
    '     "mcpServers": {',
    `       "${name}": { "command": "bun", "args": ["/ABSOLUTE/PATH/TO/${name}/mcp.ts"] }`,
    '     }',
    '   }',
    '   ```',
    '',
    '3. Open the Vite page in a browser (so the instance connects to the bridge).',
    "4. Ask the AI: **\"rename the list to 'Launch' and switch it to the danger variant,",
    '   then add a task to ship the post"** — it calls the `task-list/*` MCP tools and the',
    '   on-screen component re-skins + updates in front of you.',
    '',
    '> The MCP client spawns `mcp.ts`, which opens the WS bridge on :5208 (do not also run',
    '> `bun run server` then — they share the port). All `mcp.ts` logging goes to stderr.',
    '',
    '## Security',
    '',
    'The capability bridge is **unauthenticated** — this is a local dev/demo. Do not expose',
    '`/agent/call` or `/bridge` to untrusted networks without auth + origin checks. The',
    "server is the sole policy authority: only actions declared in the component's `@agent`",
    'block are callable, and (in `server.ts`) only with the required scope + within the rate',
    'limit.',
    '',
  ]
  return lines.join('\n')
}
