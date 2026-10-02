# @aihu/agent-a2a

> **Aihu** — agentic discovery and interaction, for human purpose.

A2A (Agent2Agent) protocol bindings (spec v1.0.1, JSON-RPC) for @aihu/agent-service.

Part of the **agent surface** layer of Aihu. Every Aihu component exposes its agent surface via the `@agent` block; this package implements one slice of the dispatch + protocol surface that connects `@agent` actions to live runtime signals (per the [Live-Binding RFC](../../docs/superpowers/specs/2026-05-05-spec-live-binding.md)).

<!-- BEGIN_HANDWRITTEN: prose -->
Implements the [Agent2Agent (A2A) Protocol Specification v1.0.1](https://a2a-protocol.org/v1.0.1/specification), JSON-RPC 2.0 binding. `mountA2aAdapter(service, options?)` wraps an `AgentService` with two routes:

| Method | Path | Description |
|---|---|---|
| `GET` | `{prefix}/.well-known/agent-card.json` | Agent card (spec §4.4.1) — `supportedInterfaces`, `capabilities`, `skills` |
| `POST` | `{prefix}/a2a` | JSON-RPC 2.0 endpoint — `SendMessage`, `SendStreamingMessage` (SSE), `GetTask`, `ListTasks`, `CancelTask`, `SubscribeToTask`, `GetExtendedAgentCard` |

**Skill addressing:** every aihu action is exposed as an A2A skill with id `"<tag>/<action>"`. A `Message` invokes one with a data part — `{ "data": { "skill": "x-counter/increment", "params": { … } } }` — or a text part whose text is the skill id (params then come from the first data part, if any).

**Tasks:** results are persisted to a `TaskStore` (in-memory by default, injectable via `options.taskStore`), so `GetTask`/`ListTasks`/`CancelTask` are real. The gate's verdict maps onto task state: 401 `AUTH_REQUIRED` → `TASK_STATE_AUTH_REQUIRED` (resumable by re-sending with `message.taskId` and credentials), 403 `SCOPE_DENIED` → `TASK_STATE_REJECTED`; the full gate envelope rides in a status-message data part for audit.

**Attribution (thesis §4 tier 0):** pass `options.resolveAuth` to derive a `RequestContext` per request; absent or throwing resolvers degrade to an explicit anonymous context, which still fails closed on scoped bindings.

**⚠ v0.1.x wire is gone (semver-major):** the pre-v0.2 REST paths (`/a2a/tasks/send`, `/a2a/tasks/sendSubscribe`, `/.well-known/agent.json`), the `"tag/action"` string-message hack, and the `[DONE]` streaming sentinel are all removed in favor of the spec wire above.
<!-- END_HANDWRITTEN: prose -->

## Install

<!-- BEGIN_AUTOGEN: install -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

```bash
npm install @aihu/agent-a2a
# or
bun add @aihu/agent-a2a
```

<sub><i>Auto-generated against `@aihu/agent-a2a@1.0.2`.</i></sub>

<!-- END_AUTOGEN: install -->

## Package facts

<!-- BEGIN_AUTOGEN: stats -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| | |
|---|---|
| **Version** | `1.0.2` |
| **Tier** | C — Agent surface — A2A (Agent2Agent) protocol, spec v1.0.1 JSON-RPC binding |
| **Bundle size** | 2.62 kB (gz) — limit 3000 B |
| **Published files** | 3 entries |
| **License** | MIT |

<sub><i>Auto-generated against `@aihu/agent-a2a@1.0.2`.</i></sub>

<!-- END_AUTOGEN: stats -->

## Exports

<!-- BEGIN_AUTOGEN: exports -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| Subpath | ESM | CJS |
|---|---|---|
| `.` | `./dist/index.js` | `—` |

<sub><i>Auto-generated against `@aihu/agent-a2a@1.0.2`.</i></sub>

<!-- END_AUTOGEN: exports -->

## Dependencies

<!-- BEGIN_AUTOGEN: deps -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

**Dependencies:**

- `@aihu/agent-service` — `workspace:*`

<sub><i>Auto-generated against `@aihu/agent-a2a@1.0.2`.</i></sub>

<!-- END_AUTOGEN: deps -->

## See also

<!-- BEGIN_AUTOGEN: see-also -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

- [@aihu/agent-service](../agent-service)
- [@aihu/agent](../agent)
- [Aihu framework root](../../README.md)

<sub><i>Auto-generated against `@aihu/agent-a2a@1.0.2`.</i></sub>

<!-- END_AUTOGEN: see-also -->

## License

<!-- BEGIN_AUTOGEN: license -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

MIT — see [LICENSE](../../LICENSE).

<sub><i>Auto-generated against `@aihu/agent-a2a@1.0.2`.</i></sub>

<!-- END_AUTOGEN: license -->
