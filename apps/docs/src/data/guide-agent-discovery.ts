/**
 * Agent Discovery guide body. Adapted from the real
 * apps/docs/src/content/docs/guides/agent-discovery.md. One dialect fix
 * applied — the "Calling aihu components as MCP tools" example used the
 * retired collection-form \`$prop:\`/\`$action:\` macros with object-form
 * \`expose: { read: true }\`; rewritten to the current wrapper intrinsics
 * (\`prop()\`/\`action()\` with string-form \`expose\`), matching
 * the standalone compiler state-model fixture. The
 * per-name \`describe:\`/\`expose:\` metadata now lives directly on the
 * prop/action declaration, so the standalone \`@agent { $describe: ... }\`
 * block in that example is dropped — \`$describe\` at the \`@agent\` level is
 * retired (an old per-name concept now expressed inline); \`@agent\` today
 * only carries the still-current cross-cutting \`$scope\`/\`$rate-limit\`
 * declarations (unchanged, not part of this migration), which this
 * particular example didn't use. Fenced code uses the ~~~ delimiter and
 * inline code uses <code> tags so the source carries no backticks.
 */
export const AGENT_DISCOVERY = `# Agent Discovery & MCP Compliance

aihu is designed from the ground up for the agentic web. Every aihu application automatically exposes standard discovery endpoints that let AI agents find, understand, and call your components as tools — with no manual configuration.

## How AI agents discover aihu apps

Aihu apps expose four discovery endpoints that agents and crawlers check:

| Endpoint | Purpose |
|---|---|
| <code>/llms.txt</code> | Human-readable index of docs and links in llmstxt.org format |
| <code>/llms-full.txt</code> | Extended index with full package list, examples, and spec links |
| <code>/.well-known/mcp/server-card.json</code> | Machine-readable MCP server card (SEP-1649) |
| <code>/robots.txt</code> | Agent-friendly crawl directives (RFC 9309) |

All four are generated automatically by <code>@aihu-plugin/agent-readiness</code> from a single config object. The minimum viable setup is:

~~~typescript
import { createAgentReadinessRoutes } from '@aihu-plugin/agent-readiness'
import { createRequestRouter, defineRoute } from '@aihu/server'

const ar = createAgentReadinessRoutes({
  name: 'My App',
  endpoint: 'https://myapp.workers.dev/mcp',
  summary: 'A aihu-powered app.',
})

const router = createRequestRouter({
  routes: [
    defineRoute('/llms.txt', ar.llmsTxt),
    defineRoute('/.well-known/mcp/server-card.json', ar.mcpServerCard),
    defineRoute('/robots.txt', ar.robotsTxt),
  ],
})
~~~

This works on Cloudflare Workers, Bun, and Deno — anywhere with a fetch-API request handler.

## The MCP Server Card

The MCP Server Card is a machine-readable JSON document at <code>/.well-known/mcp/server-card.json</code> that describes your application's agent capabilities per the SEP-1649 schema.

A minimal server card looks like:

~~~json
{
  "schema_version": "1.0",
  "name": "My App",
  "summary": "A aihu-powered app.",
  "mcp_endpoint": "https://myapp.workers.dev/mcp",
  "skills": [
    {
      "id": "my-counter",
      "name": "Live Counter",
      "description": "Read and increment a counter"
    }
  ]
}
~~~

The <code>skills</code> array is auto-populated from the agent-exposed props and actions in your SFCs — the compiler emits an MCP tool schema alongside each compiled component, and <code>@aihu-plugin/agent-readiness</code> aggregates them at build time.

To configure the server card, pass <code>AgentReadinessConfig</code> to <code>createAgentReadinessRoutes</code>:

~~~typescript
const ar = createAgentReadinessRoutes({
  name: 'My App',
  version: '1.0.0',
  summary: 'A aihu-powered app.',
  endpoint: 'https://myapp.workers.dev/mcp',
  // Optional: declare skills explicitly (merged with auto-derived from @state)
  skills: [
    { id: 'counter', name: 'Counter', description: 'Read and set counter value' },
  ],
})
~~~

### Auth configuration (opt-in)

By default the MCP endpoint is public (no-auth, Option A). To require OAuth 2.0 (Option C per RFC 9728):

~~~typescript
const ar = createAgentReadinessRoutes({
  name: 'My App',
  endpoint: 'https://myapp.workers.dev/mcp',
  auth: {
    type: 'oauth2',
    authorizationUrl: 'https://auth.myapp.com/authorize',
    tokenUrl: 'https://auth.myapp.com/token',
    scopes: ['mcp:read', 'mcp:write'],
  },
})
~~~

## llms.txt

The <code>llms.txt</code> file at the app root follows the llmstxt.org specification. It gives AI coding assistants a structured map of your app's documentation and endpoints.

### Format

The file uses a small Markdown subset:

- First line: <code># &lt;Name&gt;</code> (H1 heading — the app name)
- Optional second non-blank line: <code>&gt; &lt;tagline&gt;</code> (blockquote summary)
- Sections: <code>## &lt;Section Title&gt;</code> (H2 headings)
- Links: <code>- [Title](URL)</code> or <code>- [Title](URL): Optional description</code>
- An optional <code>## Optional</code> section at the end (for supplementary links)

The <code>llms-full.txt</code> variant follows the same format but uses <code>## More</code> instead of <code>## Optional</code> for the trailing section, and typically includes more links (all packages, examples, spec files).

### LlmsTxtConfig type

<code>@aihu-plugin/agent-readiness</code> generates both files from <code>LlmsTxtConfig</code>:

~~~typescript
interface LlmsTxtLink {
  readonly title: string
  readonly url: string
  readonly description?: string
}

interface LlmsTxtSection {
  readonly title: string
  readonly links: ReadonlyArray<LlmsTxtLink>
}

interface LlmsTxtConfig {
  readonly name: string
  readonly summary?: string
  readonly sections: ReadonlyArray<LlmsTxtSection>
  readonly optional?: ReadonlyArray<LlmsTxtLink>
}
~~~

To generate the files programmatically:

~~~typescript
import { generateLlmsTxt, generateLlmsFullTxt } from '@aihu-plugin/agent-readiness'

const config: LlmsTxtConfig = {
  name: 'My App',
  summary: 'A aihu-powered app.',
  sections: [
    {
      title: 'Getting Started',
      links: [
        { title: 'Installation', url: 'https://myapp.com/docs/install' },
        { title: 'Quickstart', url: 'https://myapp.com/docs/quickstart' },
      ],
    },
  ],
  optional: [
    { title: 'Contributing', url: 'https://github.com/org/myapp/blob/main/CONTRIBUTING.md' },
  ],
}

const llmsTxt = generateLlmsTxt(config)      // uses "## Optional"
const llmsFullTxt = generateLlmsFullTxt(config) // uses "## More"
~~~

The <code>llmsSections</code> and <code>llmsOptional</code> fields on <code>AgentReadinessConfig</code> feed directly into these generators, so you can customize the content without calling the generators manually.

## robots.txt

Aihu generates an agent-friendly <code>robots.txt</code> per RFC 9309. The default (<code>aiAgents: 'allow-all'</code>) produces directives that permit all compliant AI agents to crawl your app:

~~~
User-agent: *
Allow: /

User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: anthropic-ai
Allow: /
~~~

To restrict AI agent access, set <code>aiAgents: 'disallow-all'</code> or <code>aiAgents: 'allow-verified'</code>. You can also add custom rules for specific bots via <code>standardBots</code>:

~~~typescript
const ar = createAgentReadinessRoutes({
  name: 'My App',
  endpoint: 'https://myapp.workers.dev/mcp',
  aiAgents: 'allow-all',
  standardBots: [
    { userAgent: 'Googlebot', allow: ['/'], disallow: ['/admin'] },
  ],
  sitemap: 'https://myapp.com/sitemap.xml',
})
~~~

## Calling aihu components as MCP tools

Agent-callable components are the core proposition of aihu. Here is the end-to-end flow:

<b>Step 1 — Declare an agent surface in <code>@state</code></b>

Expose a prop and an action with <code>describe</code>/<code>expose</code> metadata — no separate block needed for per-name agent visibility:

~~~aihu
@state {
  let count = prop<number>({ default: 0, expose: 'read' })

  const increment = action(
    { describe: 'Increment the counter by one', expose: 'write' },
    () => { count++ },
  )
}
~~~

<b>Step 2 — Compiler emits <code>.mcp.json</code></b>

When the Rust SFC compiler processes this file with <code>BuildTarget.Server</code> or <code>BuildTarget.Universal</code>, it emits a <code>.mcp.json</code> sidecar describing the exposed tools:

~~~json
{
  "tools": [
    {
      "name": "increment",
      "description": "Increment the counter by one",
      "inputSchema": { "type": "object", "properties": {} }
    }
  ],
  "resources": [
    { "name": "count", "description": "Current counter value", "type": "number" }
  ]
}
~~~

Note: with <code>BuildTarget.Client</code>, agent-exposed state is fully elided — no manifest JSON is emitted and no agent code reaches the browser bundle.

<b>Step 3 — <code>@aihu/agent-service</code> exposes via <code>aihu mcp serve</code></b>

The <code>@aihu/agent-service</code> package reads the aggregated tool schemas and exposes them over the MCP protocol. Run:

~~~bash
aihu mcp serve
~~~

This starts an MCP-compatible server that AI agents (Claude, GPT, Gemini, etc.) can connect to and call your component actions as tools.

<b>Step 4 — Live-binding connects tools to the running component</b>

When an AI agent calls the <code>increment</code> tool, <code>@aihu/agent-service</code> uses the live-binding registry (RFC APPROVED) to find the running component instance and call the action against its actual signal graph — the UI updates in real time.

## Testing compliance

All compliance checks are backed by vitest test suites that run as part of <code>bun run test</code>. The test files serve as the executable specification:

| Suite | File | Tests |
|---|---|---|
| llms.txt format | <code>packages/plugin-agent-readiness/tests/compliance/llms-txt-spec.test.ts</code> | 9 |
| MCP Server Card (SEP-1649) | <code>packages/plugin-agent-readiness/tests/compliance/mcp-server-card-schema.test.ts</code> | 14 |
| robots.txt (RFC 9309) | <code>packages/plugin-agent-readiness/tests/compliance/robots-rfc9309.test.ts</code> | 7 |
| isitagentready.com checklist | <code>packages/plugin-agent-readiness/tests/compliance/isitagentready.test.ts</code> | 7 |
| SSR output structure | <code>packages/server/tests/compliance/ssr-output.test.ts</code> | 12 |

Run all compliance checks:

~~~bash
bun run test       # TS + Rust unit, integration, and compliance suites
bun run test:quality   # Lighthouse gate (≥ 90 on perf/a11y/best-practices/seo)
~~~

## isitagentready.com

Aihu passes all 7 checks on isitagentready.com. The checks are exercised by the compliance test suite at <code>packages/plugin-agent-readiness/tests/compliance/isitagentready.test.ts</code>. The seven gates are:

1. <code>llms.txt</code> present at root
2. <code>llms.txt</code> first line is <code># &lt;Name&gt;</code>
3. <code>/.well-known/mcp/server-card.json</code> returns valid JSON
4. MCP server card contains <code>mcp_endpoint</code>
5. <code>robots.txt</code> present and allows AI agents
6. App sets <code>X-Agent-Friendly: true</code> response header
7. MCP endpoint responds to <code>POST</code> with a valid tool-list response
`
