/**
 * agent-driven-demo — Bun API server.
 *
 * The live, runnable version of the acceptance test (`tests/real-ws-bridge.test.ts`):
 * an external agent drives the REAL, visible `<task-list>` component over a real
 * WebSocket, gated server-side, executed in the browser.
 *
 * Topology (matches the go-public eng-review plan):
 *
 *   EXTERNAL AGENT ──POST /agent/call──▶  createAgentServer (the 404→401→403→429
 *                                          security gate; sole policy authority)
 *                                            │  approved {opaqueActionId, args}
 *                                            ▼
 *   BROWSER (ws /bridge) ◀── attachBridge ── WS capability bridge
 *     real <task-list> custom element mounted, opaque-ID dispatcher registered,
 *     executes the action → on-screen UI updates → the durable list the user
 *     sees is the one the agent mutated.
 *
 * Start with:  bun --watch server.ts
 * Then open the Vite dev server (bun run dev) and drive it:
 *   curl -XPOST localhost:5208/agent/call \
 *     -H 'content-type: application/json' \
 *     -d '{"tool":"task-list/addTask","params":["Write the launch post"]}'
 */

import { registerAgentMetadata } from '@aihu/agent'
import type { BridgeChannel } from '@aihu/agent-server'
import { createAgentServer, verifyBridgeUpgrade } from '@aihu/agent-server'
import { branch, leaf } from '@aihu/arbor'
import { type Signal, signal } from '@aihu/signals'

const TAG = 'task-list'
const PORT = 5208
const VITE_PORT = 5108

// Origins allowed to open the `/bridge` WebSocket and become the trusted
// browser peer. A WS upgrade is not subject to the same-origin policy the way
// `fetch` is, so this allowlist is the only thing standing between "the
// component's own page" and "any page the user has open in another tab" —
// see `verifyBridgeUpgrade`'s doc comment for why this check must run before
// `srv.upgrade`, not after. Override via `BRIDGE_ALLOWED_ORIGINS` (comma
// separated) for a non-default dev port or a real deployment origin.
const ALLOWED_BRIDGE_ORIGINS = (
  process.env.BRIDGE_ALLOWED_ORIGINS?.split(',').map((o) => o.trim()) ?? [
    `http://localhost:${VITE_PORT}`,
    `http://127.0.0.1:${VITE_PORT}`,
  ]
).filter(Boolean)

// ── Register the component's agent metadata (the @agent surface). ─────────────
// In a full app this comes from the compiler manifest sidecar + the
// plugin-agent-readiness llms.txt. Here we register it directly so the gate has
// a manifest to authorize against.
registerAgentMetadata({
  tag: TAG,
  describes: 'A durable task list driven over the capability bridge.',
  actions: {
    addTask: { returns: {} },
    toggleTask: { returns: {} },
    clearCompleted: { returns: {} },
  },
  state: {},
})

// ── A server-mounted twin so the gate finds a live binding. ───────────────────
// It is NEVER executed while a browser bridge is attached (the visible instance
// is authoritative); it exists only so the security gate can resolve the tag.
const [twinLen, setTwinLen] = signal(0)
const twinNode = branch('div', { id: `${TAG}-twin` }, [
  leaf([twinLen, setTwinLen] as unknown as Signal<string>),
])
const server = createAgentServer({
  target: {
    node: twinNode,
    agentBinding: {
      tag: TAG,
      actions: {
        addTask: () => twinLen(),
        toggleTask: () => twinLen(),
        clearCompleted: () => twinLen(),
      },
      reads: { length: () => twinLen() },
      writes: {},
      scope: undefined,
      rateLimit: undefined,
    },
  },
  // No `createHost` and no jsdom glue: @aihu/agent-server stands up its own
  // server-side DOM internally when the runtime (plain Bun here) has none.
})

// ── Wrap a Bun ServerWebSocket as a BridgeChannel. ────────────────────────────
type BunWs = { send(data: string): void; readyState: number }
const messageHandlers = new Set<(data: string) => void>()
const closeHandlers = new Set<() => void>()

function bridgeChannelFor(ws: BunWs): BridgeChannel {
  return {
    get connected() {
      return ws.readyState === 1 // OPEN
    },
    send(data) {
      ws.send(data)
    },
    onMessage(handler) {
      messageHandlers.add(handler)
      return () => messageHandlers.delete(handler)
    },
    onClose(handler) {
      closeHandlers.add(handler)
      return () => closeHandlers.delete(handler)
    },
  }
}

let detachBridge: (() => void) | null = null

Bun.serve<{ bridge: boolean }>({
  port: PORT,
  async fetch(req, srv): Promise<Response | undefined> {
    const url = new URL(req.url)

    // WS upgrade for the browser capability bridge.
    if (url.pathname === '/bridge') {
      const verdict = verifyBridgeUpgrade(req, { allowedOrigins: ALLOWED_BRIDGE_ORIGINS })
      if (!verdict.ok) {
        console.warn(`[agent-driven-demo] ${verdict.reason}`)
        return new Response(verdict.reason, { status: verdict.status })
      }
      if (srv.upgrade(req, { data: { bridge: true } })) return undefined
      return new Response('expected websocket', { status: 426 })
    }

    // External-agent entry point: gate + (if a browser is connected) delegate to
    // the visible instance over the bridge.
    if (url.pathname === '/agent/call' && req.method === 'POST') {
      const body = (await req.json()) as { tool: string; params?: unknown; userId?: string }
      const result = await server.callTool(body.tool, body.params ?? [], {
        userId: body.userId ?? 'demo-agent',
      })
      return Response.json(result)
    }

    // The component's current state, as the visible instance last streamed it.
    if (url.pathname === '/agent/state') {
      return Response.json(server.serialize())
    }

    return new Response('not found', { status: 404 })
  },
  websocket: {
    open(ws) {
      detachBridge?.()
      detachBridge = server.attachBridge(bridgeChannelFor(ws as unknown as BunWs))
      console.log('[agent-driven-demo] browser bridge connected')
    },
    message(_ws, message) {
      const data = typeof message === 'string' ? message : message.toString()
      for (const h of [...messageHandlers]) h(data)
    },
    close() {
      for (const h of [...closeHandlers]) h()
      messageHandlers.clear()
      closeHandlers.clear()
      console.log('[agent-driven-demo] browser bridge disconnected')
    },
  },
})

console.log(`[agent-driven-demo] API + bridge listening on http://localhost:${PORT}`)
console.log('  POST /agent/call   { tool, params, userId }   drive the component')
console.log('  GET  /agent/state                              read current state')
console.log('  WS   /bridge                                   browser capability bridge')
