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
 *     -H 'authorization: Bearer local-demo-secret' \
 *     -H 'content-type: application/json' \
 *     -d '{"tool":"task-list/addTask","params":["Write the launch post"]}'
 */

import { registerAgentMetadata } from '@aihu/agent'
import type { BridgeChannel } from '@aihu/agent-server'
import { createAgentServer, verifyBridgeUpgrade } from '@aihu/agent-server'
import { projectCapabilityResult } from '@aihu/agent-service'
import { branch, leaf } from '@aihu/arbor'
import { type Signal, signal } from '@aihu/signals'
import { createDemoSecurity } from './demo-security'

const TAG = 'task-list'
const PORT = 5208
const VITE_PORT = 5108
const DEMO_GRANT_VERSION = '1'
const demoSecurity = createDemoSecurity(process.env.DEMO_AGENT_TOKEN)

// One visible browser owns this demo's single bridge attachment. The token is
// generated for that socket and invalidated on replacement or disconnect.
let demoSession: { token: string; identity: string; grantVersion: string } | null = null

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
  verifyBridgeSession: (token) =>
    demoSession?.token === token
      ? { identity: demoSession.identity, grantVersion: demoSession.grantVersion }
      : { identity: '' },
  reauthorizeBridgeInvoke: ({ sessionToken, identity, grantVersion }) => {
    const current = demoSession
    return current !== null &&
      current.token === sessionToken &&
      current.identity === identity &&
      current.grantVersion === grantVersion
      ? { identity, grantVersion }
      : false
  },
  authPlugin: demoSecurity.authPlugin,
  actorResolver: demoSecurity.actorResolver,
  authorizeDataRead: demoSecurity.authorizeDataRead,
  // No `createHost` and no jsdom glue: @aihu/agent-server stands up its own
  // server-side DOM internally when the runtime (plain Bun here) has none.
})

// ── Wrap a Bun ServerWebSocket as a BridgeChannel. ────────────────────────────
type BunWs = { send(data: string): void; readyState: number }
const channelHandlers = new Map<
  BunWs,
  { messages: Set<(data: string) => void>; closes: Set<() => void> }
>()

function bridgeChannelFor(ws: BunWs): BridgeChannel {
  const handlers = {
    messages: new Set<(data: string) => void>(),
    closes: new Set<() => void>(),
  }
  channelHandlers.set(ws, handlers)
  return {
    get connected() {
      return ws.readyState === 1 // OPEN
    },
    send(data) {
      ws.send(data)
    },
    onMessage(handler) {
      handlers.messages.add(handler)
      return () => handlers.messages.delete(handler)
    },
    onClose(handler) {
      handlers.closes.add(handler)
      return () => handlers.closes.delete(handler)
    },
  }
}

let detachBridge: (() => void) | null = null
let activeBridge: BunWs | null = null

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
      const caller = await demoSecurity.authorizeRequest(req)
      if (!caller) return Response.json({ error: 'AUTH_REQUIRED', code: 401 }, { status: 401 })
      const body = (await req.json()) as { tool: string; params?: unknown }
      const result = await server.callTool(body.tool, body.params ?? [], {
        userId: caller.actor.subject,
        jwt: caller.credential,
      })
      return Response.json(result)
    }

    // The component's current state, as the visible instance last streamed it.
    if (url.pathname === '/agent/state') {
      const verdict = await demoSecurity.authorizeSnapshot(req)
      if (!verdict.allowed) {
        return Response.json({ error: verdict.error, code: verdict.code }, { status: verdict.code })
      }
      try {
        return Response.json(projectCapabilityResult(server.serialize(), verdict.projection))
      } catch {
        return Response.json({ error: 'CAPABILITY_UNAVAILABLE', code: 503 }, { status: 503 })
      }
    }

    return new Response('not found', { status: 404 })
  },
  websocket: {
    open(ws) {
      detachBridge?.()
      const peer = ws as unknown as BunWs
      activeBridge = peer
      detachBridge = server.attachBridge(bridgeChannelFor(peer))
      demoSession = {
        token: crypto.randomUUID(),
        identity: crypto.randomUUID(),
        grantVersion: DEMO_GRANT_VERSION,
      }
      // The nonce is bound to the attachment generation and can be consumed
      // only once. Send it after attachBridge so the hello matches this peer.
      ws.send(
        JSON.stringify({
          type: 'bridge-bootstrap',
          nonce: server.issueBridgeNonce().nonce,
          sessionToken: demoSession.token,
          sessionIdentity: demoSession.identity,
          grantVersion: demoSession.grantVersion,
        }),
      )
      console.log('[agent-driven-demo] browser bridge connected')
    },
    message(ws, message) {
      const data = typeof message === 'string' ? message : message.toString()
      const handlers = channelHandlers.get(ws as unknown as BunWs)
      for (const h of handlers?.messages ?? []) h(data)
    },
    close(ws) {
      const peer = ws as unknown as BunWs
      const handlers = channelHandlers.get(peer)
      for (const h of handlers?.closes ?? []) h()
      channelHandlers.delete(peer)
      if (activeBridge === peer) {
        demoSession = null
        activeBridge = null
        detachBridge = null
      }
      console.log('[agent-driven-demo] browser bridge disconnected')
    },
  },
})

console.log(`[agent-driven-demo] API + bridge listening on http://localhost:${PORT}`)
console.log('  POST /agent/call   { tool, params }   drive the component (Bearer token required)')
console.log('  GET  /agent/state                     read task count (Bearer token required)')
console.log('  WS   /bridge                                   browser capability bridge')
