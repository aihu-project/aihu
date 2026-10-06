# @aihu-plugin/agent-readiness

> **Aihu** — agentic discovery and interaction, for human purpose.

Discovery + readiness manifest emitter so agents can introspect aihu apps.

Part of the **agent surface** layer of Aihu. Every Aihu component exposes its agent surface via the `@agent` block; this package implements one slice of the dispatch + protocol surface that connects `@agent` actions to live runtime signals (per the [Live-Binding RFC](../../docs/superpowers/specs/2026-05-05-spec-live-binding.md)).

<!-- BEGIN_HANDWRITTEN: prose -->
_(Hand-written prose lives in this block. Replace this placeholder; everything below is auto-generated.)_

### Agentic Resource Discovery — `Agentmap:` (robots.txt)

`RobotsConfig.agentMap` (and the mirrored `AgentReadinessConfig.agentMap` on
`@aihu/server`'s config) emits an `Agentmap: <url>` line in `robots.txt`,
immediately after `Sitemap:` — the
[ARD](https://agenticresourcediscovery.org/spec) v0.9 draft's directive
pointing at a site's `/.well-known/ai-catalog.json`. The URL must be an
absolute `http(s)://` URL with no embedded CR/LF; it is emitted verbatim and
this package does not generate the catalog document itself.

```ts
createAgentReadinessRoutes({
  name: 'My App',
  sitemap: 'https://example.com/sitemap.xml',
  agentMap: 'https://example.com/.well-known/ai-catalog.json',
})
```
<!-- END_HANDWRITTEN: prose -->

## Install

<!-- BEGIN_AUTOGEN: install -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

```bash
npm install @aihu-plugin/agent-readiness
# or
bun add @aihu-plugin/agent-readiness
```

<sub><i>Auto-generated against `@aihu-plugin/agent-readiness@2.4.1`.</i></sub>

<!-- END_AUTOGEN: install -->

## Package facts

<!-- BEGIN_AUTOGEN: stats -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| | |
|---|---|
| **Version** | `2.4.1` |
| **Tier** | C — Agent surface — discovery manifests (llms.txt, MCP Server Card, robots) |
| **Published files** | 3 entries |
| **License** | MIT |

<sub><i>Auto-generated against `@aihu-plugin/agent-readiness@2.4.1`.</i></sub>

<!-- END_AUTOGEN: stats -->

## Exports

<!-- BEGIN_AUTOGEN: exports -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| Subpath | ESM | CJS |
|---|---|---|
| `.` | `./dist/index.js` | `—` |

<sub><i>Auto-generated against `@aihu-plugin/agent-readiness@2.4.1`.</i></sub>

<!-- END_AUTOGEN: exports -->

## Dependencies

<!-- BEGIN_AUTOGEN: deps -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

**Dependencies:**

- `@aihu/server` — `workspace:*`
- `@aihu/agent` — `workspace:*`

<sub><i>Auto-generated against `@aihu-plugin/agent-readiness@2.4.1`.</i></sub>

<!-- END_AUTOGEN: deps -->

## See also

<!-- BEGIN_AUTOGEN: see-also -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

- [Agent-Readiness spec](../../.team/agent-readiness/spec-agent-readiness.md)
- [@aihu/server](../server)
- [Aihu framework root](../../README.md)

<sub><i>Auto-generated against `@aihu-plugin/agent-readiness@2.4.1`.</i></sub>

<!-- END_AUTOGEN: see-also -->

## License

<!-- BEGIN_AUTOGEN: license -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

MIT — see [LICENSE](../../LICENSE).

<sub><i>Auto-generated against `@aihu-plugin/agent-readiness@2.4.1`.</i></sub>

<!-- END_AUTOGEN: license -->
