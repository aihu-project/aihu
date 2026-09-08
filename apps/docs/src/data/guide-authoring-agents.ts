/**
 * Authoring Agents guide body. Adapted from the real
 * apps/docs/src/content/docs/guides/authoring-agents.md. This is the guide
 * most affected by the retired `@state` v2 collection-form macro dialect —
 * every `@state` example used `$prop: {...}`/`$action: {...}` with
 * object-form `expose: { read: true }`; all rewritten below to the current
 * wrapper intrinsics (`prop()`/`action()`/`state()`) with string-form
 * `expose` (`'read'` / `'read write'`), matching
 * apps/docs/src/data/guide-authoring-components.ts and
 * guide-agent-discovery.ts, and confirmed against
 * the standalone compiler state-wrapper parser and the
 * weather-new.aihu/counter-new.aihu state-model fixtures.
 *
 * Additional corrections, each confirmed directly against source before
 * porting:
 * - `createRouter` (used in several old code samples) does not exist on
 *   `@aihu/server` — the real export is `createRequestRouter`
 *   (packages/server/src/index.ts). `createRouter` is a different package's
 *   export (`@aihu/router`, the client-side route registry) — fixed at
 *   every call site below.
 * - `@aihu/agent-acp`'s old doc said "frozen at 0.1.x"; the shipped package
 *   is 0.2.0 (still deprecated, same two routes, no new features) — fixed.
 * - The `<tag>.agent-manifest.json` sidecar filename in the old doc is
 *   still exactly correct (the standalone compiler binary,
 *   packages/plugin-agent-readiness/src/agent-manifest-sidecar.ts) — no
 *   change needed there, despite guide-agent-discovery.ts elsewhere calling
 *   the sidecar `.mcp.json` (that's a pre-existing inaccuracy in already-
 *   shipped content, out of scope for this port; this guide keeps the
 *   correct `.agent-manifest.json` name).
 * - `@agent`'s `$scope`/`$rate-limit` grammar, the `@aihu/agent` registry,
 *   `@aihu/agent-service`, `@aihu-plugin/agent-readiness`, `@aihu/mcp`, and
 *   the A2A/ACP adapters were all spot-checked and are otherwise accurate;
 *   brief notes added where the public surface has grown since the old doc
 *   (an `extract` field on `AgentMetadata`, additional `@aihu/agent-service`
 *   exports, `createInMemoryTaskStore` from `@aihu/agent-a2a`) without
 *   documenting them in full here.
 *
 * Fenced code uses the ~~~ delimiter and inline code uses <code> tags so the
 * source carries no backticks.
 */
export const AUTHORING_AGENTS = `# Authoring Agents

aihu is agent-first by design. Every <code>.aihu</code> SFC can declare an <code>@agent</code> block, and the Rust compiler emits both a Web Component and a <code>&lt;tag&gt;.agent-manifest.json</code> sidecar (aihu's own shape — not an MCP <code>.mcp.json</code> document) from the same source file. The result is a three-layer stack — component-level <code>@state</code> exposure metadata, the <code>@aihu/agent</code> static registry, and the <code>@aihu/agent-service</code> live execution engine — that lets an aihu app be made callable by MCP-compatible AI agents once the agent surface is wired up (the discovery and serving pieces are opt-in, not automatic — see §6 and §10).

---

## 1. Overview: aihu's agent-first design

### Three layers

| Layer | Package | Role |
|---|---|---|
| <code>@state</code> exposure | <code>.aihu</code> SFC | Per-declaration <code>describe</code>/<code>expose</code> metadata on <code>prop()</code>/<code>derived()</code>/<code>action()</code>/<code>resource()</code> |
| Registry | <code>@aihu/agent</code> | Compile-time metadata store, keyed by custom-element tag |
| Service | <code>@aihu/agent-service</code> | Live-binding dispatch — routes agent tool calls to DOM signal graph |

### Key properties

- <b>Agent code is fully elided from client builds.</b> When compiling with <code>BuildTarget.Client</code>, exposed <code>@state</code> metadata produces zero runtime bytes for the agent surface. Agent schemas never reach the browser bundle.
- <b>The Rust compiler emits a <code>&lt;tag&gt;.agent-manifest.json</code> sidecar</b> for every SFC with an exposed agent surface (<code>expose:</code> on a <code>prop()</code>/<code>derived()</code>/<code>action()</code>/<code>resource()</code> call) — one file per component, including on client builds. The schema is derived directly from <code>describe:</code>/<code>expose:</code> metadata on those calls. This is aihu's own shape, not <code>.mcp.json</code>; <code>@aihu-plugin/agent-readiness</code> reads it to build <code>llms.txt</code> and the MCP server card — see §7.
- <b>Live-binding (v0.3.0+)</b> wires agent tool calls to the actual signal graph of mounted components, so an AI agent invoking <code>live-counter/increment</code> triggers the same reactive path as a user clicking the button.

---

## 2. Declaring an agent surface in <code>@state</code>

Agent metadata lives directly on the <code>@state</code> wrapper intrinsics — there is no separate collection block to assemble. Add a config object with <code>describe</code> and <code>expose</code> to any <code>prop()</code>, <code>derived()</code>, <code>action()</code>, or <code>resource()</code> call:

~~~aihu
@state {
  let count = state(0)

  const increment = action(
    { describe: 'Add 1 to counter', expose: 'read write' },
    () => { count++ },
  )
  const decrement = action(
    { describe: 'Subtract 1 from counter', expose: 'read write' },
    () => { count-- },
  )
}

@agent {
  $scope "authenticated"
}
~~~

<code>expose</code> takes the string form <code>'read'</code> (agents can read the value) or <code>'read write'</code> (agents can also call/set it). <code>describe</code> is the human-readable description surfaced in the MCP tool schema.

### <code>@agent</code> block grammar

~~~
@agent {
  $scope <string-literal>   // optional — access scope claim required in JWT
  $rate-limit <integer>     // optional — requests per minute
}
~~~

Both directives are optional; the entire block may be omitted if no scope or rate limiting is needed. Exposure and description metadata live on <code>@state</code> wrapper calls, not inside <code>@agent</code> — the old v1 forms (<code>$expose</code>, <code>$expose.write</code>, agent-bare <code>$action</code>, <code>$describe</code>) are rejected by the parser with error code <b>C440</b>.

### Minimal <code>@agent</code> block (scope only)

~~~aihu
@agent {
  $scope "authenticated"
}
~~~

### No <code>@agent</code> block needed

If you only want MCP tools with no scope or rate-limit enforcement, you do not need to write an <code>@agent</code> block at all. Adding <code>expose:</code> to a <code>@state</code> wrapper call is sufficient to generate the MCP tool schema.

### Real example: <code>live-counter.aihu</code>

~~~aihu
@state {
  let count = state(0)

  const increment = action(
    { describe: 'Add 1 to the counter', expose: 'read write' },
    () => { count++ },
  )
  const decrement = action(
    { describe: 'Subtract 1 from the counter', expose: 'read write' },
    () => { count-- },
  )
  const reset = action(
    { describe: 'Reset the counter to 0', expose: 'read write' },
    () => { count = 0 },
  )
}
~~~

No <code>@agent</code> block is needed here — these actions are exposed publicly with no scope restriction.

---

## 3. <code>@aihu/agent</code> — the registry layer

The <code>@aihu/agent</code> package is the compile-time metadata registry. The Rust compiler emits a <code>registerAgentMetadata()</code> call at the top level of every compiled <code>.aihu</code> module that has exposed state or actions. Module evaluation populates the registry.

### Public API

~~~typescript
import {
  registerAgentMetadata, // emitted by compiler — do not call directly
  getAgentMetadata,      // look up a single component by tag
  getAllAgentMetadata,    // enumerate the full registry (used by adapters)
} from '@aihu/agent'
~~~

### <code>AgentMetadata</code> shape

~~~typescript
interface AgentMetadata {
  tag: string                              // custom-element tag name
  describes?: string                       // top-level description (MCP prompt)
  state?: Record<string, string>           // exposed signal names → descriptions
  actions?: Record<string, ActionSchema>   // exposed action names → schemas
  extract?: ExtractPolicy                  // read-policy metadata for governed/extraction-aware surfaces
  [key: string]: unknown                   // unknown fields preserved (spec §9.1)
}
~~~

The compiler emits a frozen object. <code>getAgentMetadata(tag)</code> returns it by reference. <code>getAllAgentMetadata()</code> returns an array snapshot of all registered entries, used by adapters like <code>@aihu/agent-a2a</code> that need the full registry without knowing tags in advance.

### When to call these directly

You typically do not call <code>registerAgentMetadata</code> — the compiler does. You may call <code>getAgentMetadata</code> or <code>getAllAgentMetadata</code> in server code (route handlers, adapters) to read the compile-time manifest.

---

## 4. <code>@aihu/agent-service</code> — the execution layer

<code>@aihu/agent-service</code> bridges the compile-time <code>AgentMetadata</code> registry and the live component instance registry into a single service that MCP clients can call. Beyond the core surface below, the package also exports principal/entitlement helpers (<code>resolvePrincipal</code>, <code>decideEmission</code>, <code>surfaceCallPolicy</code>, <code>isScopeValue</code>) for advanced scope-gating scenarios, not covered in depth here.

### Creating a service

~~~typescript
import { createAgentService } from '@aihu/agent-service'
import { getAllAgentMetadata } from '@aihu/agent'

const service = createAgentService({
  manifests: getAllAgentMetadata(),
  // Wire live-binding registry from @aihu/arbor (v0.3.0+)
  getRegistry: () => componentInstanceRegistry,
  // Optional: scope enforcement
  authPlugin: myAuthPlugin,
  // Optional: rate limiting
  rateLimitPlugin: myRateLimitPlugin,
})
~~~

### <code>AgentServiceOptions</code>

| Field | Type | Description |
|---|---|---|
| <code>manifests</code> | <code>AgentMetadata[]</code> | Explicit metadata list. |
| <code>getRegistry</code> | <code>() => Map&lt;string, LiveBinding[]&gt;</code> | Getter for the live instance registry from <code>@aihu/arbor/mount</code>. Required for live dispatch. |
| <code>authPlugin</code> | <code>AuthPlugin</code> | Scope enforcement. Required when any component uses <code>$scope</code>. |
| <code>rateLimitPlugin</code> | <code>RateLimitPlugin</code> | Rate-limit enforcement. Optional. |

### <code>AgentService</code> methods

~~~typescript
interface AgentService {
  getManifest(): AgentManifest
  handleToolCall(toolName: string, params: unknown, requestContext?: RequestContext): Promise<unknown>
  asMiddleware(): (req: Request) => Promise<Response | null>
}
~~~

- <b><code>getManifest()</code></b> — returns the aggregated MCP manifest listing all tools.
- <b><code>handleToolCall(toolName, params, ctx)</code></b> — routes <code>"&lt;tag&gt;/&lt;action&gt;"</code> to the live binding. Tool name format: <code>"live-counter/increment"</code>.
- <b><code>asMiddleware()</code></b> — returns a fetch-API middleware that handles <code>POST /__aihu/tools/call</code> with <code>{ tool, params }</code> JSON body. Returns <code>null</code> for non-matching requests (pass-through compatible).

### Using as middleware

~~~typescript
import { createRequestRouter, defineRoute } from '@aihu/server'

const router = createRequestRouter({
  routes: [
    defineRoute('/api/*', (req) => service.asMiddleware()(req)),
    ...appRoutes,
  ],
})
~~~

---

## 5. Live-binding — the <code>$live</code> directive

Live-binding (v0.3.0, spec APPROVED 2026-05-05) is the mechanism that makes exposed <code>@state</code> declarations operational rather than decorative.

### What live-binding is

When a component with exposed state or actions mounts, the <code>mount()</code> path in <code>@aihu/arbor</code> detects the <code>__agentBinding</code> export on the server artifact and constructs a <code>LiveBinding</code> object. This object is registered in a module-level <code>componentInstanceRegistry</code> keyed by the component's tag name.

~~~typescript
interface LiveBinding {
  rootId: number           // unique mount ID
  tag: string              // component tag
  getSignal(name): unknown
  setSignal(name, value): void
  callAction(name, args): Promise<unknown>
  scope(): string | null
  rateLimit(): string | null
  dispose$: () => boolean  // called on unmount
}
~~~

When an agent calls <code>handleToolCall('live-counter/increment', {})</code>, the service:

1. Looks up <code>live-counter</code> in <code>componentInstanceRegistry</code>.
2. Checks <code>$scope</code> — returns 403 if the JWT lacks the required claim.
3. Checks <code>$rate-limit</code> — returns 429 if quota is exhausted.
4. Calls <code>binding.callAction('increment', [{}])</code>.
5. The action runs through the same reactive signal path as a user click, and the DOM updates immediately.

### The <code>$guard</code> primitive

<code>$guard</code> blocks an agent action when a condition fails. Declare it alongside an exposed action in <code>@state</code>:

~~~aihu
const checkout = action(
  { describe: 'Complete the purchase', expose: 'read write' },
  () => { processCheckout() },
  // guard: cartItems.length > 0  // (v1.1 syntax — see live-binding spec §4)
)
~~~

Guards are evaluated before the action handler runs. A guard failure returns a structured error to the agent without executing the action.

### SSR and headless considerations

A server-rendered <code>LiveBinding</code> is ephemeral — it lives only for the duration of the SSR request. For persistent stateful agent interactions (multi-turn conversations, cart mutations, collaborative state), the component must be client-hydrated. A client-mounted <code>LiveBinding</code> is long-lived for the page session.

### Security invariants

- <b>Error ordering (timing-channel protection):</b> <code>handleToolCall</code> always returns errors in order: 404 (no instance) → 401 (missing auth) → 403 (scope denied) → 429 (rate limited). Reordering is forbidden — serving 429 before 403 would leak binding existence to unauthorized callers.
- <b>Fail-closed for missing auth:</b> If <code>authPlugin</code> is not registered and a component declares <code>$scope</code>, <code>handleToolCall</code> returns <code>{ error: 'AUTH_MISSING' }</code> (HTTP 401). The component is never served without an active auth plugin.
- <b><code>componentInstanceRegistry</code> is module-private.</b> Only the <code>mount()</code> call path can register bindings. Plugins and request handlers cannot inject entries.
- <b><code>__agentBinding</code> is elided from client bundles.</b> This is a compiler guarantee enforced by the split-bundle compilation (Block Structure Spec §11.5).

---

## 6. <code>@aihu-plugin/agent-readiness</code> — discovery and MCP compliance

<code>@aihu-plugin/agent-readiness</code> generates the four standard agent-discovery endpoints: <code>llms.txt</code>, <code>llms-full.txt</code>, <code>/.well-known/mcp/server-card.json</code>, and <code>robots.txt</code>.

### Router wiring (server/edge)

~~~typescript
import { createAgentReadinessRoutes } from '@aihu-plugin/agent-readiness'
import { createRequestRouter, defineRoute } from '@aihu/server'

const ar = createAgentReadinessRoutes({
  name: 'My App',
  version: '1.0.0',
  summary: 'What this app does for AI agents',
  endpoint: 'https://myapp.example.com/mcp',
  llmsSections: [
    {
      title: 'Docs',
      links: [
        { title: 'API Reference', url: '/llms-full.txt', description: 'Full API docs' },
      ],
    },
  ],
})

const router = createRequestRouter({
  routes: [
    defineRoute('/llms.txt', ar.llmsTxt),
    defineRoute('/llms-full.txt', ar.llmsFullTxt),
    defineRoute('/.well-known/mcp/server-card.json', ar.mcpServerCard),
    defineRoute('/robots.txt', ar.robotsTxt),
    ...appRoutes,
  ],
})

export default { fetch: router }
~~~

Each handler is a pure function that generates fresh content on every request. No global state.

### <code>AgentReadinessConfig</code> fields

| Field | Type | Description |
|---|---|---|
| <code>name</code> | <code>string</code> | Required. App name — appears as the H1 in <code>llms.txt</code>. |
| <code>version</code> | <code>string</code> | Semver string for the MCP server card. |
| <code>summary</code> | <code>string</code> | Blockquote summary in <code>llms.txt</code>. |
| <code>endpoint</code> | <code>string</code> | MCP server URL. Required for <code>server-card.json</code> generation. |
| <code>llmsSections</code> | <code>LlmsTxtSection[]</code> | Custom sections in <code>llms.txt</code>. |
| <code>llmsOptional</code> | <code>LlmsTxtLink[]</code> | Links in the <code>## Optional</code> section. |
| <code>aiAgents</code> | <code>'allow-all' \\| 'deny-all' \\| RobotsRule[]</code> | AI bot policy for <code>robots.txt</code>. Default: <code>'allow-all'</code>. |
| <code>sitemap</code> | <code>string</code> | Sitemap URL appended to <code>robots.txt</code>. |
| <code>auth</code> | <code>McpAuthConfig</code> | Optional OAuth 2.0 config for the MCP server card. |
| <code>skills</code> | <code>AgentSkill[]</code> | Manually declared MCP skills. |

### With OAuth 2.0 (opt-in)

~~~typescript
const ar = createAgentReadinessRoutes({
  name: 'My App',
  endpoint: 'https://myapp.example.com/mcp',
  auth: {
    type: 'oauth2',
    authorizationUrl: 'https://auth.example.com/authorize',
    tokenUrl: 'https://auth.example.com/token',
    scopes: ['mcp:read', 'mcp:write'],
  },
})
~~~

The generated MCP server card advertises <b>only</b> the authorization-server issuer origin (derived from <code>tokenUrl</code>) as <code>auth.authorizationServer</code> — not the full authorization/token URLs or scopes, and never client secrets. It deliberately does <b>not</b> advertise <code>/.well-known/oauth-authorization-server</code> (RFC 8414) or <code>/.well-known/oauth-protected-resource</code> (RFC 9728) documents; consumers perform their own RFC 8414 discovery from the issuer.

### Vite integration (dev + build)

Use <code>viteAgentReadinessIntegration()</code> for Vite-based apps. In dev, it serves all four endpoints as Vite middleware. In build, it emits them as static assets.

~~~typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { viteAgentReadinessIntegration } from '@aihu-plugin/agent-readiness'

export default defineConfig({
  plugins: [
    viteAgentReadinessIntegration({
      name: 'My App',
      endpoint: 'https://myapp.workers.dev/mcp',
      summary: 'Component-driven app with agent tools',
    }),
  ],
})
~~~

Note: <code>viteAgentReadinessIntegration()</code> does NOT inject routes into <code>createRequestRouter</code> automatically. For server-side route wiring, use <code>createAgentReadinessRoutes()</code> separately.

> <code>agentReadiness()</code> is a deprecated alias for <code>viteAgentReadinessIntegration()</code>. It will be removed in v1.0.

---

## 7. Compiler-emitted agent manifest

The Rust compiler emits a <code>&lt;tag&gt;.agent-manifest.json</code> sidecar alongside the compiled JS for every SFC that has exposed state or actions. The shape is aihu's own — it is <b>not</b> an MCP <code>.mcp.json</code> document. It is derived from <code>describe:</code>/<code>expose:</code> metadata on <code>@state</code> wrapper calls.

<code>@aihu-plugin/agent-readiness</code> consumes these sidecars — pass <code>agentManifestDir</code> to <code>viteAgentReadinessIntegration</code> and the <code>## Components</code> section of <code>llms.txt</code> plus the MCP server card's skills are derived from them. This is the only source that works on a <b>client</b> build, where <code>registerAgentMetadata(...)</code> is elided and the runtime registry is therefore empty. The sidecar may carry policy (<code>scope</code>, <code>rateLimit</code>, <code>streamOutput</code>); the reader copies only <code>tag</code> / <code>describes</code> / <code>state</code> / <code>actions</code> / <code>extract</code>, so policy never reaches the served documents. The operational agent surface remains carried by the <code>registerAgentMetadata(...)</code> module-scope call (§3) and the <code>__agentBinding</code> server export (below).

### Emitted manifest for <code>live-counter.aihu</code>

Given the live-counter example from §2, the compiler emits approximately:

~~~json
{
  "tools": [
    {
      "name": "live_counter",
      "tag": "live-counter",
      "inputs": {},
      "actions": {
        "increment": { "returns": {}, "describe": "Add 1 to the counter" },
        "decrement": { "returns": {}, "describe": "Subtract 1 to the counter" },
        "reset": { "returns": {}, "describe": "Reset the counter to 0" }
      },
      "state": {}
    }
  ]
}
~~~

The <code>__agentBinding</code> server export, emitted alongside the client Web Component, wires the schema to the live signal graph:

~~~typescript
// server artifact — never reaches the client bundle
export const __agentBinding = {
  tag: 'live-counter',
  actions: {
    increment: (args) => increment(),
    decrement: (args) => decrement(),
    reset: (args) => reset(),
  },
  reads: {},
  writes: {},
  scope: undefined,
  rateLimit: undefined,
}
~~~

This export is completely absent from the client artifact — its absence is validated by CI (check for any <code>__agentBinding</code> string reference in client bundle output).

---

## 8. <code>@aihu/mcp</code> — the MCP stdio server

<code>@aihu/mcp</code> exposes an MCP stdio server with two built-in tools that help AI coding agents work with aihu.

### CLI usage

~~~bash
aihu mcp serve
~~~

Starts an MCP stdio server. The process stays alive until stdin closes (the MCP host disconnects).

### Built-in tools

| Tool | Description |
|---|---|
| <code>aihu_example</code> | Returns canonical <code>.aihu</code> SFC snippets from the cookbook matching a natural-language intent. |
| <code>aihu_validate</code> | Compiles a <code>.aihu</code> source string using the Rust compiler and returns compiled TypeScript or structured diagnostics. |

### <code>aihu_example</code>

~~~json
{
  "name": "aihu_example",
  "inputSchema": {
    "type": "object",
    "properties": {
      "intent": { "type": "string", "description": "Natural-language description of component pattern" },
      "tags": { "type": "array", "items": { "type": "string" }, "description": "Optional keyword tags" }
    },
    "required": ["intent"]
  }
}
~~~

Example call: <code>{ "intent": "counter with signal and action" }</code> returns the canonical counter SFC.

### <code>aihu_validate</code>

~~~json
{
  "name": "aihu_validate",
  "inputSchema": {
    "type": "object",
    "properties": {
      "source": { "type": "string", "description": "Full .aihu SFC source to compile" },
      "filename": { "type": "string", "description": "Optional virtual filename for diagnostics" }
    },
    "required": ["source"]
  }
}
~~~

Returns compiled TypeScript on success, or structured diagnostic errors (code, message, line/col) on failure. Use this to verify <code>.aihu</code> source before writing to disk.

### Programmatic usage

~~~typescript
import { createServer, startServer } from '@aihu/mcp'

// Start the server (blocks until stdin closes)
await startServer()

// Or create without connecting (for testing)
const server = createServer()
~~~

### MCP client configuration

To add the aihu MCP server to Claude Code or another MCP client:

~~~json
{
  "mcpServers": {
    "aihu": {
      "command": "aihu",
      "args": ["mcp", "serve"]
    }
  }
}
~~~

---

## 9. A2A protocol adapter (and the deprecated ACP adapter)

aihu ships one in-tree protocol adapter for agent-to-agent communication.

### <code>@aihu/agent-a2a</code> — Agent2Agent (A2A) protocol

<code>mountA2aAdapter</code> wraps an <code>AgentService</code> with the <a href="https://a2a-protocol.org/v1.0.1/specification">A2A Protocol Specification v1.0.1</a> JSON-RPC 2.0 binding. (The <b>protocol spec</b> version is v1.0.1; the <code>@aihu/agent-a2a</code> <b>package</b> itself is versioned separately, currently 1.0.0.)

~~~typescript
import { mountA2aAdapter, createInMemoryTaskStore } from '@aihu/agent-a2a'

const a2a = mountA2aAdapter(service, {
  prefix: '',                              // URL prefix for all routes. Default: ''
  name: 'my-app',                          // Agent name in the agent card
  url: 'https://my-app.example.com/a2a',   // Absolute endpoint URL advertised in the card
  resolveAuth: (req) => getAuthState(req), // RequestContext per request (tier-0 attribution)
  // taskStore: createInMemoryTaskStore(), // Swap the default in-memory TaskStore explicitly
})

// Wire the middleware
const router = createRequestRouter({
  routes: [
    defineRoute('/*', async (req) => {
      const res = await a2a.asMiddleware()(req)
      return res ?? notFound()
    }),
  ],
})
~~~

Routes exposed:

| Method | Path | Description |
|---|---|---|
| <code>GET</code> | <code>/.well-known/agent-card.json</code> | A2A agent card (spec §4.4.1): <code>supportedInterfaces</code>, <code>capabilities</code>, <code>skills</code> |
| <code>POST</code> | <code>/a2a</code> | JSON-RPC 2.0 endpoint: <code>SendMessage</code>, <code>SendStreamingMessage</code> (SSE), <code>GetTask</code>, <code>ListTasks</code>, <code>CancelTask</code>, <code>SubscribeToTask</code>, <code>GetExtendedAgentCard</code> |

Every exposed action is an A2A skill with id <code>"&lt;tag&gt;/&lt;action&gt;"</code>. A <code>Message</code> invokes one with a data part — <code>{ "data": { "skill": "x-counter/increment", "params": { … } } }</code> — or a text part whose text is the skill id. Results persist to a <code>TaskStore</code> (in-memory by default, injectable via <code>createInMemoryTaskStore()</code> or your own implementation), so <code>GetTask</code>/<code>ListTasks</code>/<code>CancelTask</code> are real; <code>SendStreamingMessage</code> streams JSON-RPC-wrapped <code>StreamResponse</code> frames over SSE, and terminality is the task state (no <code>[DONE]</code> sentinel).

> <b>Breaking change (semver-major):</b> the 0.1.x REST wire (<code>POST /a2a/tasks/send</code>, <code>POST /a2a/tasks/sendSubscribe</code>, <code>GET /.well-known/agent.json</code>, <code>body.message</code> as a <code>"tag/action"</code> string) is removed.

### <code>@aihu/agent-acp</code> — deprecated; use A2A

<b><code>@aihu/agent-acp</code> is deprecated — use <code>@aihu/agent-a2a</code>.</b> The ACP protocol (BeeAI ACP) merged into A2A under the Linux Foundation in August 2025, so there is no independent ACP spec left to target. The package is at <code>0.2.x</code>: it still compiles and its routes (<code>GET /.well-known/acp-agent</code>, <code>POST /acp/messages</code>) still respond, but no further features will land. Migrate by mounting <code>mountA2aAdapter</code> on the same service instance.

---

## 10. Agent compliance checklist

> <b>🚧 Opt-in, not "by contract."</b> These capabilities are <b>not</b> shipped by every aihu app automatically. The <code>llms.txt</code> / <code>llms-full.txt</code> / server-card / <code>robots.txt</code> endpoints require the <code>@aihu-plugin/agent-readiness</code> integration (§6). The A2A routes require mounting the adapter (§9). <code>aihu mcp serve</code> is a separate authoring stdio server (§8), <b>not</b> an app endpoint. Treat this as a checklist of what you can enable, not a description of defaults.

| Capability | Endpoint / command | Standard | How to enable |
|---|---|---|---|
| llms.txt discovery | <code>GET /llms.txt</code> | <a href="https://llmstxt.org">llmstxt.org</a> | agent-readiness (§6) |
| llms-full.txt | <code>GET /llms-full.txt</code> | llmstxt.org | agent-readiness (§6) |
| MCP Server Card | <code>GET /.well-known/mcp/server-card.json</code> | aihu shape (not MCP-spec) | agent-readiness (§6) |
| robots.txt | <code>GET /robots.txt</code> | RFC 9309 | agent-readiness (§6) |
| A2A agent card | <code>GET /.well-known/agent-card.json</code> | <a href="https://a2a-protocol.org/v1.0.1/specification">A2A v1.0.1</a> | <code>mountA2aAdapter</code> (§9) |
| A2A JSON-RPC endpoint | <code>POST /a2a</code> | A2A v1.0.1 §9 (JSON-RPC 2.0 binding) | <code>mountA2aAdapter</code> (§9) |
| Authoring MCP stdio server | <code>aihu mcp serve</code> | MCP SDK | CLI (§8) — authoring helper only |

### isitagentready.com checklist

The full checklist at <a href="https://isitagentready.com">isitagentready.com</a> verifies:

- <code>llms.txt</code> present and parseable (H1 name, optional blockquote, H2 sections, link format)
- <code>robots.txt</code> includes explicit <code>Allow: /</code> for major AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Googlebot-Extended, CCBot, anthropic-ai, Google-Extended, Bytespider, cohere-ai)
- MCP server card present at <code>/.well-known/mcp/server-card.json</code> and valid against the aihu <code>McpServerCard</code> shape (this is aihu's own shape, <b>not</b> an MCP spec — SEP-1649 is closed)
- MCP endpoint responds to tool calls

### AI bot policy in <code>robots.txt</code>

The default <code>aiAgents: 'allow-all'</code> policy emits explicit <code>Allow: /</code> rules for every bot in <code>AI_BOT_LIST</code>. To deny all AI bots:

~~~typescript
createAgentReadinessRoutes({
  name: 'My App',
  aiAgents: 'deny-all',  // User-agent: *\\nDisallow: /
})
~~~

To customize per-bot:

~~~typescript
createAgentReadinessRoutes({
  name: 'My App',
  aiAgents: [
    { userAgent: 'GPTBot', allow: ['/'] },
    { userAgent: 'ClaudeBot', allow: ['/'] },
    { userAgent: '*', disallow: ['/private/'] },
  ],
})
~~~

### Security notes

- <code>$scope</code> declarations are a security control, not a DX annotation. Always install <code>@aihu/auth</code> when using scoped <code>@agent</code> blocks.
- Audit all agent-exposed <code>@state</code> declarations in third-party <code>.aihu</code> templates before production deployment. Review <code>$scope</code>, <code>expose: 'read'</code>, and <code>expose: 'read write'</code> declarations for privilege escalation risks.
- Client bundles must never contain <code>__agentBinding</code>. Add a CI step: <code>grep '__agentBinding' dist/client/*.js && exit 1</code> to enforce this.
`
