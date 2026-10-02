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
        // ^0.5.0 makes arbor a peer. Older agent-server releases install their
        // own arbor 4.1.1, giving `node` two incompatible type identities.
        '@aihu/agent-server': aihuDep('@aihu/agent-server'),
        '@aihu/agent-service': aihuDep('@aihu/agent-service'),
        '@aihu/arbor': aihuDep('@aihu/arbor'),
        '@aihu/compiler': aihuDep('@aihu/compiler'),
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
    "import { aihuCompilerPlugin } from '@aihu/compiler'",
    "import { defineConfig } from 'vite'",
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
    "  plugins: [aihuCompilerPlugin({ target: 'client' })],",
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
  "    clearTasks: { describe: 'Remove all tasks.', returns: {} },",
  "    setLabel: { describe: 'Set the panel heading text.', returns: {} },",
  '    setVariant: {',
  '      describe:',
  "        \"Set the visual variant: one of 'default', 'compact', 'danger'.\",",
  '      returns: {},',
  '    },',
]
/** Readable state, surfaced as the llms.txt `## Components` State list. */
const METADATA_STATE = [
  "    length: 'Number of tasks currently on the list.',",
  "    count: 'Alias of length — number of tasks currently on the list.',",
]
const BINDING_ACTIONS = [
  '        addTask: () => twinLen(),',
  '        clearTasks: () => twinLen(),',
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
    '// rateLimitPlugin: in-memory counter; rateSpec is "max calls per key".',
    'const _rl = new Map<string, number>()',
    'const rateLimitPlugin = {',
    '  checkRateLimit: (rateSpec: string, key: string) => {',
    '    const max = Number(rateSpec) || 5',
    '    const n = (_rl.get(key) ?? 0) + 1',
    '    _rl.set(key, n)',
    '    return n <= max',
    '  },',
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
    '      reads: { length: () => twinLen(), count: () => twinLen() },',
    '      writes: {},',
    "      scope: 'tasks:write',",
    "      rateLimit: '5',",
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
    '      return Response.json(result)',
    '    }',
    "    if (url.pathname === '/agent/state') {",
    '      return Response.json(server.serialize())',
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
    "console.log('[agent] API + bridge on http://localhost:' + PORT + ' (actions gated: scope tasks:write, 5/key)')",
    "console.log('  POST /agent/call   { tool, params, userId, jwt }   drive the component')",
    "console.log('  GET  /agent/state                                  read current state')",
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
    '      serialize: () => ({',
    "        taskCount: (el.shadowRoot ?? el).querySelectorAll('.tl-item').length,",
    '      }),',
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

/** src/task-list.aihu — the durable, human+agent-drivable, RESKINNABLE component. */
export function agentComponentAihu(): string {
  return `@state {
  import { signal, effect } from '@aihu/signals'

  // Client-durable state: hydrate from localStorage on mount, write back on
  // every change. Survives a refresh — and because the agent's bridge calls
  // drive these SAME signals, the agent's reskin persists too. Browser-only;
  // guarded so any non-browser eval (build/SSR) safely falls back to defaults.
  // (For state shared across tabs/devices + multiple viewers, move the source
  // of truth server-side — e.g. a Durable Object / KV behind the agent gate.)
  const STORE_KEY = 'aihu:task-list:v1'
  const persisted =
    typeof localStorage !== 'undefined'
      ? JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}')
      : {}

  // The durable list both a human and an agent drive. Each task: { id, text }.
  const [tasks, setTasks] = signal(persisted.tasks ?? [])
  const [nextId, setNextId] = signal(persisted.nextId ?? 1)
  const [draft, setDraft] = signal('') // transient input — not persisted
  // Agent-RESKINNABLE state: the heading text + the visual variant. An agent
  // sets these on the live instance — molding a vanilla component into a styled one.
  // The signal setters are named writeLabel/writeVariant so they don't collide
  // with the agent-facing setLabel/setVariant $actions below (same name → the
  // compiler would emit two top-level \`const setLabel\`).
  const [label, writeLabel] = signal(persisted.label ?? 'Tasks')
  const [variant, writeVariant] = signal(persisted.variant ?? 'default')

  // Persist the durable slice on any change (effect re-runs when a signal it
  // reads changes). draft is intentionally excluded.
  effect(() => {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ tasks: tasks(), nextId: nextId(), label: label(), variant: variant() }),
    )
  })

  // Shared mutation — the human input and the agent's addTask both call this, so
  // both drive the SAME signal state on this one instance.
  const add = (text) => {
    const t = (text ?? '').trim()
    if (!t) return
    const id = nextId()
    setTasks([...tasks(), { id, text: t }])
    setNextId(id + 1)
  }

  const onDraft = (e) => setDraft(e.target.value)
  const addFromInput = () => {
    add(draft())
    setDraft('')
  }

  $action: {
    addTask: {
      describe: 'Append a task with the given text.',
      expose: { read: true },
      handler: (args) => add(typeof args?.[0] === 'string' ? args[0] : String(args?.[0] ?? '')),
    },
    clearTasks: {
      describe: 'Remove all tasks.',
      expose: { read: true },
      handler: () => setTasks([]),
    },
    setLabel: {
      describe: 'Set the panel heading text.',
      expose: { read: true },
      handler: (args) => writeLabel(typeof args?.[0] === 'string' && args[0] ? args[0] : 'Tasks'),
    },
    setVariant: {
      describe: "Set the visual variant: one of 'default', 'compact', 'danger'.",
      expose: { read: true },
      handler: (args) => {
        const v = String(args?.[0] ?? 'default')
        writeVariant(['default', 'compact', 'danger'].includes(v) ? v : 'default')
      },
    },
  }
}

@template {
  <section class={['tl', variant()]}>
    <header class="tl-head">
      <h2 class="tl-title">{label}</h2>
      <span class="tl-count">{tasks.length}</span>
    </header>
    <div class="tl-add">
      <label class="tl-srlabel" for="tl-new">New task</label>
      <input
        id="tl-new"
        class="tl-input"
        value={draft}
        on:input={onDraft}
        on:keydown={(e) => e.key === 'Enter' && addFromInput()}
        placeholder="Add a task and press Enter"
      />
      <button class="tl-btn" on:click={addFromInput}>Add</button>
      <button class="tl-btn" on:click={() => setTasks([])}>Clear</button>
    </div>
    <ul class="tl-items">
      <li each={task of tasks} key={task.id} class="tl-item">
        <span class="tl-text">{task.text}</span>
      </li>
    </ul>
  </section>
}

@style {
  .tl {
    --tl-accent: #2b59ff;
    --tl-border: #e2e2e2;
    max-width: 32rem;
    margin: 0 auto;
    padding: 1.25rem 1.5rem;
    border: 1px solid var(--tl-border);
    border-radius: 12px;
    font-family: system-ui, -apple-system, sans-serif;
    color: #1a1a1a;
  }
  .tl.compact {
    padding: 0.6rem 0.8rem;
    max-width: 24rem;
    font-size: 0.85rem;
  }
  .tl.danger {
    --tl-accent: #c0392b;
    --tl-border: #c0392b;
    background: #fff6f5;
  }
  .tl-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  .tl-title {
    margin: 0;
    font-size: 1.1rem;
    color: var(--tl-accent);
  }
  .tl-count {
    min-width: 1.5rem;
    text-align: center;
    padding: 0.1rem 0.45rem;
    background: var(--tl-accent);
    color: #fff;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 700;
  }
  .tl-add {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.75rem;
  }
  .tl-srlabel {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .tl-input {
    flex: 1;
    padding: 0.5rem 0.6rem;
    border: 1px solid #ccc;
    border-radius: 8px;
    font: inherit;
  }
  .tl-btn {
    padding: 0.5rem 0.9rem;
    cursor: pointer;
    border: 1px solid var(--tl-accent);
    border-radius: 8px;
    background: #fff;
    color: var(--tl-accent);
    font: inherit;
  }
  .tl-items {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.4rem;
  }
  .tl-item {
    padding: 0.5rem 0.7rem;
    background: #fafafa;
    border: 1px solid #ececec;
    border-radius: 8px;
  }
}

@agent {
  action addTask()
  action clearTasks()
  action setLabel()
  action setVariant()
}
`
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
    '      code { font-family: ui-monospace, monospace; background: #f3f3f3;',
    '        padding: 0.1rem 0.3rem; border-radius: 4px; }',
    '    </style>',
    '  </head>',
    '  <body>',
    '    <h1>Agent-driven, durable component</h1>',
    '    <p class="lede">',
    '      The &lt;task-list&gt; below is a real aihu custom element with durable signal',
    '      state. Add tasks yourself — then drive AND reskin the same on-screen instance',
    '      as an agent would (authorized + rate-limited, executed here in the browser):',
    '      <br /><br />',
    '      <code>curl -XPOST localhost:5208/agent/call -H \'content-type: application/json\' -d \'{"tool":"task-list/setVariant","params":["danger"],"userId":"u1","jwt":"tasks:write"}\'</code>',
    '    </p>',
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
    '      reads: { length: () => twinLen(), count: () => twinLen() },',
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
    'An **agent-drivable** aihu app: a durable `<task-list>` Web Component that a human',
    'and an AI agent both drive — and that an agent can **reskin live** (set the heading',
    'text, switch the visual variant). The agent reaches the *same visible instance* over',
    'a server-mediated capability bridge — the server is the policy gate, the browser is',
    'the executor. The UI the user sees is the UI the agent molds.',
    '',
    '## Run it',
    '',
    '```bash',
    'bun install',
    'bun run dev      # Bun bridge server (:5208) + Vite (:5108)',
    '```',
    '',
    'Open the Vite URL, add tasks with the input — then drive + reskin the SAME instance',
    'as an agent would. Actions are **authorized** (`tasks:write` scope) and **rate-limited**',
    '(5/key), so you can see every guardrail:',
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
    '# more than 5 calls per key → 429 RATE_LIMITED.',
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
