# @aihu/agent-server

> **Aihu** — agentic discovery and interaction, for human purpose.

Server-side glue: mount an aihu component server-side and let an MCP client drive it through the agent-service live-dispatch gate, forwarding approved invocations to a browser bridge.

Held-private workspace package. Not yet published to npm.

> **Status:** Held private — not yet published to npm. See [v1.1 roadmap](../../docs/roadmap/SUMMARY.md) for ratification gating (e.g. RFC #56 live-binding for `@aihu/plugin` enforcement).

<!-- BEGIN_HANDWRITTEN: prose -->
Server-side glue that lets an external MCP client drive a **server-mounted**
aihu component through the already-tested live-dispatch runtime
(`@aihu/agent-service`), and forwards **only approved** invocations to a
connected browser "capability bridge" (the visible, authoritative instance).

This is a **server-side package**: it depends on `jsdom` (host DOM) and the MCP
SDK, targets Node/Bun, and carries **no `.size-limit.json` row** (see
`.size-limit.README.md`).

## What `createAgentServer()` does

1. **Mounts** the target component server-side into a jsdom host so its
   `LiveBinding` registers in arbor's `componentInstanceRegistry`.
2. **Builds** an agent-service via
   `createAgentService({ manifests: getAllAgentMetadata(), getRegistry: _getComponentInstanceRegistry, … })`.
   The `404 → 401 → 403 → 429` security gate lives entirely in agent-service and
   is **not** re-implemented or bypassed here.
3. **Exposes an MCP endpoint** (`createComponentMcpServer` / `serveComponentMcp`)
   where each component action/state is an MCP tool backed by `callTool` — reusing
   the same `@modelcontextprotocol/sdk` stdio pattern as `@aihu/mcp`.
4. **Exposes a WS/SSE capability bridge**: on an *approved* tool call only, the
   server forwards `{ opaqueActionId, args }` (no policy info) to a connected
   browser client and surfaces the visible instance's result + `serialize()`
   snapshots back.

```ts
import { JSDOM } from 'jsdom'
import { createAgentServer, serveComponentMcp } from '@aihu/agent-server'
import { __agentBinding, render } from './my-counter.server.js' // compiler output

const server = createAgentServer({
  target: { node: render(), agentBinding: __agentBinding },
  createHost: () => new JSDOM('<!doctype html><body>').window.document.body,
})

// Drive it from an MCP client over stdio:
await serveComponentMcp(server)
```

## WS capability-bridge contract (server side — for the browser-bridge client, T3)

The browser-bridge client (a separate task) implements against the message
shapes in [`src/types.ts`](./src/types.ts). `BRIDGE_PROTOCOL_VERSION = 1`.

**Server → client**

```ts
// Sent ONLY after the gate authorizes the call. Carries NO scope/rate-limit info.
{ type: 'invoke', callId: string, opaqueActionId: string, args: unknown[] }
```

`opaqueActionId` is `"<tag>/<action>"` for v1 (the compiler's stable opaque-id
emit, T1, will replace the plain name; the client allowlist keys on the same
string).

**Client → server**

```ts
{ type: 'hello',    protocol: number }                      // handshake on connect
{ type: 'result',   callId: string, result: unknown }       // visible instance's return
{ type: 'error',    callId: string, message: string }       // exec failed → surfaced to agent
{ type: 'snapshot', callId?: string, snapshot: Snapshot }   // serialize() state stream
```

The transport is abstracted behind `BridgeChannel` (`send` / `onMessage` /
`onClose` / `connected`) so a real deployment passes a `ws` `WebSocket` and tests
pass an in-memory channel. The server never imports `ws`.

### Guarantees

- A **rejected** call (404/401/403/429) is **never** forwarded to the bridge.
- A bridge **disconnect mid-drive** rejects the pending `callTool` as a loud
  `503 BRIDGE_ERROR` rather than silently dropping it.
- The forwarded frame contains only the opaque id + args — no scope, no
  rate-limit, no auth context.

## Testing

```bash
bunx vitest run packages/agent-server/tests/agent-server.test.ts
```

The suite drives a real `@aihu/signals` + `@aihu/arbor` component mounted into a
jsdom host: a scripted in-process MCP client calls `increment`, a real signal
changes, and `serialize()` reflects it — plus 404 / 401 / 403 gate paths and the
full bridge contract.
<!-- END_HANDWRITTEN: prose -->

## Install

<!-- BEGIN_AUTOGEN: install -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

```bash
npm install @aihu/agent-server
# or
bun add @aihu/agent-server
```

<sub><i>Auto-generated against `@aihu/agent-server@0.4.4`.</i></sub>

<!-- END_AUTOGEN: install -->

## Package facts

<!-- BEGIN_AUTOGEN: stats -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| | |
|---|---|
| **Version** | `0.4.4` |
| **Tier** | C — Agent surface — server-mount + MCP live-dispatch bridge to a browser |
| **Published files** | 3 entries |
| **License** | MIT |

<sub><i>Auto-generated against `@aihu/agent-server@0.4.4`.</i></sub>

<!-- END_AUTOGEN: stats -->

## Exports

<!-- BEGIN_AUTOGEN: exports -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| Subpath | ESM | CJS |
|---|---|---|
| `.` | `./dist/index.js` | `—` |

<sub><i>Auto-generated against `@aihu/agent-server@0.4.4`.</i></sub>

<!-- END_AUTOGEN: exports -->

## Dependencies

<!-- BEGIN_AUTOGEN: deps -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

**Dependencies:**

- `@aihu/agent` — `workspace:*`
- `@aihu/agent-service` — `workspace:*`
- `@aihu/arbor` — `^4.1.2`
- `@modelcontextprotocol/sdk` — `^1.0.0`
- `jsdom` — `^25.0.0`

<sub><i>Auto-generated against `@aihu/agent-server@0.4.4`.</i></sub>

<!-- END_AUTOGEN: deps -->

## See also

<!-- BEGIN_AUTOGEN: see-also -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

- [@aihu/agent-service](../agent-service)
- [@aihu/mcp](../mcp)
- [Aihu framework root](../../README.md)

<sub><i>Auto-generated against `@aihu/agent-server@0.4.4`.</i></sub>

<!-- END_AUTOGEN: see-also -->

## License

<!-- BEGIN_AUTOGEN: license -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

MIT — see [LICENSE](../../LICENSE).

<sub><i>Auto-generated against `@aihu/agent-server@0.4.4`.</i></sub>

<!-- END_AUTOGEN: license -->
