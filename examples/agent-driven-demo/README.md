# agent-driven-demo — the launch proof

An external agent reads a component's metadata and **drives the real, visible
component instance** over a real WebSocket — gated server-side, executed in the
browser. This is the live, runnable version of the automated proof in
[`tests/real-ws-bridge.test.ts`](./tests/real-ws-bridge.test.ts).

```
  EXTERNAL AGENT ──POST /agent/call──▶  createAgentServer  (the 404→401→403→429
                                          security gate; sole policy authority)
                                            │  approved { opaqueActionId, args }
                                            ▼
  BROWSER  ◀────── ws /bridge ───────── WS capability bridge
    real <task-list> custom element mounted, opaque-ID dispatcher registered,
    executes the action → on-screen UI updates → the durable list the user
    sees is the one the agent mutated.  (The server twin is never executed.)
```

The component (`src/task-list.aihu`) holds **durable list state** — not a
stateless counter — so the contrast is real: an agent driving generated UI via
DOM selectors would have nothing to mutate (no component, no signal, no
serialisable state). Here it drives the component's own signals and the streamed
snapshot reflects every change.

This package is **private** (an example, not published) and adds **no
`.size-limit.json` row**.

## Primary acceptance — the automated proof

The load-bearing artifact is the passing integration test. It compiles the REAL
component with the published `@aihu/compiler` binary (`--target client`), evaluates that exact
output, mounts the custom element in jsdom, runs the real `createBridgeClient`
over a real `ws` socket against a real `createAgentServer`, and an external
`callTool` drives it. It asserts: the compiled component's signal changed, the
result came back over the socket, the server twin was NOT executed, and the
streamed snapshot reflects the visible instance.

```bash
# from this directory (uses the repo's pinned vitest + this example's config)
cd examples/agent-driven-demo
bun run test
# or, from the repo root, point the repo's vitest binary at this config:
#   node_modules/.bin/vitest run examples/agent-driven-demo/tests
```

> The test's `globalSetup` (`tests/compile-fixture.ts`) shells out to the
> platform binary installed by the published `@aihu/compiler` package. Run
> `bun install` from the repository root if the matching optional dependency
> is missing.

## Run the live demo

Two processes — the Bun API/bridge server and the Vite dev server:

```bash
# terminal 1 — API + WebSocket bridge on :5208
bun run server

# terminal 2 — Vite dev server on :5108 (proxies /agent + /bridge to :5208)
bun run dev
```

Open <http://localhost:5108>. The `<task-list>` mounts and connects its bridge.

### Record the proof

1. Load <http://localhost:5108>. The list is empty. Open the DOM inspector and
   confirm `<task-list>` is a real custom element with a shadow root.
2. Drive it from an external process (no browser interaction):
   ```bash
   curl -XPOST localhost:5208/agent/call \
     -H 'content-type: application/json' \
     -d '{"tool":"task-list/addTask","params":["Write the launch post"]}'
   ```
   Watch the on-screen list gain a row — the **visible** instance was driven.
3. Add another, then toggle it:
   ```bash
   curl -XPOST localhost:5208/agent/call -H 'content-type: application/json' \
     -d '{"tool":"task-list/addTask","params":["Record the demo"]}'
   curl -XPOST localhost:5208/agent/call -H 'content-type: application/json' \
     -d '{"tool":"task-list/toggleTask","params":[2]}'
   ```
4. Read the streamed state the server sees from the visible instance:
   ```bash
   curl localhost:5208/agent/state
   ```
5. Try an un-exposed action and confirm it is rejected loudly (the component is
   never mutated):
   ```bash
   curl -XPOST localhost:5208/agent/call -H 'content-type: application/json' \
     -d '{"tool":"task-list/deleteEverything","params":[]}'
   ```

## How the per-instance dispatcher is wired (Step 0)

The compiler emits a module-scope `export const __agentDispatcher` whose opaque-ID
→ invoker maps reference setup-closure locals (`(args) => addTask(args)`), so at
module scope they're an inert, introspection-only template. The capability bridge
needs invokers bound to a **specific mounted instance**. The compiler therefore
ALSO injects, inside the setup body (where the closures resolve), a
`_registerAgentDispatcher(ctx.element, { … })` call. The runtime
(`@aihu/runtime`) keys that instance-bound dispatcher by the host element; the
browser bridge takes it after mount via `_takeAgentDispatcher(el)`. No policy is
carried over the wire — the server is the sole policy authority.
