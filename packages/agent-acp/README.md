# @aihu/agent-acp

> **Aihu** — agentic discovery and interaction, for human purpose.

DEPRECATED — use [`@aihu/agent-a2a`](../agent-a2a). The ACP protocol merged into A2A under the Linux Foundation (Aug 2025).

Part of the **agent surface** layer of Aihu. Every Aihu component exposes its agent surface via the `@agent` block; this package implements one slice of the dispatch + protocol surface that connects `@agent` actions to live runtime signals (per the [Live-Binding RFC](../../docs/superpowers/specs/2026-05-05-spec-live-binding.md)).

<!-- BEGIN_HANDWRITTEN: prose -->
> [!WARNING]
> **DEPRECATED — use [`@aihu/agent-a2a`](../agent-a2a) instead.**
>
> This package is frozen at `0.1.x` and will receive no further features. The
> ACP protocol it targeted (BeeAI ACP) **merged into the A2A protocol under the
> Linux Foundation in August 2025** — its maintainers migrated, and there is no
> independent ACP spec left to conform to. (The name "ACP" now belongs to Zed's
> unrelated editor↔agent Agent Client Protocol, which this package never
> implemented.)
>
> **Migration:** mount [`mountA2aAdapter`](../agent-a2a) from `@aihu/agent-a2a`
> on the same `AgentService`. The A2A adapter speaks the A2A v1.0.1 JSON-RPC
> binding (agent card at `/.well-known/agent-card.json`, `SendMessage`,
> `GetTask`, …) and carries the same tier-0 `RequestContext` attribution via
> `resolveAuth`.
<!-- END_HANDWRITTEN: prose -->

## Install

<!-- BEGIN_AUTOGEN: install -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

```bash
npm install @aihu/agent-acp
# or
bun add @aihu/agent-acp
```

<sub><i>Auto-generated against `@aihu/agent-acp@0.2.2`.</i></sub>

<!-- END_AUTOGEN: install -->

## Package facts

<!-- BEGIN_AUTOGEN: stats -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| | |
|---|---|
| **Version** | `0.2.2` |
| **Tier** | C — Agent surface — DEPRECATED; use @aihu/agent-a2a (ACP merged into A2A, Aug 2025) |
| **Bundle size** | 675 B (gz) — limit 800 B |
| **Published files** | 3 entries |
| **License** | MIT |

<sub><i>Auto-generated against `@aihu/agent-acp@0.2.2`.</i></sub>

<!-- END_AUTOGEN: stats -->

## Exports

<!-- BEGIN_AUTOGEN: exports -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| Subpath | ESM | CJS |
|---|---|---|
| `.` | `./dist/index.js` | `—` |

<sub><i>Auto-generated against `@aihu/agent-acp@0.2.2`.</i></sub>

<!-- END_AUTOGEN: exports -->

## Dependencies

<!-- BEGIN_AUTOGEN: deps -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

**Dependencies:**

- `@aihu/agent-service` — `workspace:*`

<sub><i>Auto-generated against `@aihu/agent-acp@0.2.2`.</i></sub>

<!-- END_AUTOGEN: deps -->

## See also

<!-- BEGIN_AUTOGEN: see-also -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

- [@aihu/agent-service](../agent-service)
- [@aihu/agent](../agent)
- [Aihu framework root](../../README.md)

<sub><i>Auto-generated against `@aihu/agent-acp@0.2.2`.</i></sub>

<!-- END_AUTOGEN: see-also -->

## License

<!-- BEGIN_AUTOGEN: license -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

MIT — see [LICENSE](../../LICENSE).

<sub><i>Auto-generated against `@aihu/agent-acp@0.2.2`.</i></sub>

<!-- END_AUTOGEN: license -->
