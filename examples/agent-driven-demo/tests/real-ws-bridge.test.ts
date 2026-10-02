/**
 * PRIMARY ACCEPTANCE (T6) — the REAL compiled component, driven over a REAL
 * `ws` WebSocket, gated server-side, executed in the (jsdom) browser.
 *
 * This is the honest, end-to-end version of the in-memory loop proven in
 * `packages/agent-server/tests/bridge-client.test.ts`. Every load-bearing piece
 * here is the real artifact:
 *
 *   • The component is compiled from `src/task-list.aihu` by the REAL
 *     `@aihu/compiler` binary with `--target client`. We import and EVALUATE
 *     that exact output — including the compiler-emitted, per-instance
 *     `_registerAgentDispatcher(...)` call and the opaque action IDs.
 *   • The component is MOUNTED as a real custom element in jsdom (visible
 *     instance, real `@aihu/signals`).
 *   • The browser bridge reads the instance-bound dispatcher via the runtime's
 *     `_takeAgentDispatcher(element)` (the Step-0 wiring) and runs the real
 *     `createBridgeClient` over a real `ws` socket.
 *   • The server runs the real `createAgentServer` (the 404→401→403→429 gate)
 *     + `attachBridge` over the SAME real `ws` socket.
 *   • An external `callTool` drives it.
 *
 * Asserted (user-visible truth):
 *   1. the REAL compiled component's signal changed (a task was added);
 *   2. the result envelope came back over the socket;
 *   3. the server-mounted twin was NOT executed (browser is authoritative);
 *   4. the streamed snapshot reflects the visible instance's new state.
 */

import { registerAgentMetadata } from '@aihu/agent'
import {
  type AgentDispatcher,
  type BridgeChannel,
  createAgentServer,
  createBridgeClient,
} from '@aihu/agent-server'
import { type AgentBindingSpec, branch, leaf, mount } from '@aihu/arbor'
import { _setMount, _setSignal, _takeAgentDispatcher } from '@aihu/runtime'
import { type Signal, signal } from '@aihu/signals'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'

const TAG = 'task-list'
const DEMO_SESSION = 'demo-browser-session'
const DEMO_GRANT_VERSION = '1'

function demoBridgeAuthorization() {
  return {
    verifyBridgeSession: (token: string) =>
      token === DEMO_SESSION
        ? { identity: DEMO_SESSION, grantVersion: DEMO_GRANT_VERSION }
        : { identity: '' },
    reauthorizeBridgeInvoke: (binding: {
      sessionToken?: string
      identity: string
      grantVersion?: string
    }) =>
      binding.sessionToken === DEMO_SESSION &&
      binding.identity === DEMO_SESSION &&
      binding.grantVersion === DEMO_GRANT_VERSION
        ? { identity: DEMO_SESSION, grantVersion: DEMO_GRANT_VERSION }
        : false,
  }
}

/** Poll `cond` until true (real-socket frames are async). */
async function waitFor(cond: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

// The REAL compiler output (binary, `--target client`) is produced by the
// vitest globalSetup (`tests/compile-fixture.ts`) into `__generated__/`. We
// import + EVALUATE that exact artifact here so the test drives the real
// component — including the compiler-injected per-instance `_registerAgentDispatcher`.
interface CompiledClientModule {
  /** The compiler's module-scope export (introspection-only template). */
  __agentDispatcher: AgentDispatcher
}

let clientModule: CompiledClientModule

beforeAll(async () => {
  // Wire the runtime exactly as the Vite plugin's auto-wiring does, so the
  // compiled custom element can mount() in jsdom.
  _setMount(mount)
  _setSignal(signal)
  clientModule = (await import('virtual:task-list-client')) as CompiledClientModule
})

// The MCP/agent metadata the server's gate authorizes against — the @agent
// block's exposed surface. (In a full app this is populated at compile time via
// the manifest sidecar; here we register it directly, mirroring the in-memory
// proof.)
beforeEach(() => {
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
})

// ── A real `ws` socket pair wrapped as BridgeChannels. ────────────────────────
interface WsPair {
  serverChannel: BridgeChannel
  clientChannel: BridgeChannel
  close(): Promise<void>
}

/** Wrap a live `ws` WebSocket as a `BridgeChannel`. */
function wrapWs(ws: WebSocket): BridgeChannel {
  return {
    get connected() {
      return ws.readyState === WebSocket.OPEN
    },
    send(data) {
      ws.send(data)
    },
    onMessage(handler) {
      const h = (data: unknown): void => handler(String(data))
      ws.on('message', h)
      return () => ws.off('message', h)
    },
    onClose(handler) {
      ws.on('close', handler)
      return () => ws.off('close', handler)
    },
  }
}

/** Stand up a real loopback ws server + client and return both ends wrapped. */
async function makeRealWsPair(): Promise<WsPair> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>((res) => wss.on('listening', res))
  const addr = wss.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0

  const serverConn = new Promise<WebSocket>((res) => wss.once('connection', res))
  const client = new WebSocket(`ws://127.0.0.1:${port}`)
  const clientOpen = new Promise<void>((res) => client.once('open', () => res()))

  const [serverWs] = await Promise.all([serverConn, clientOpen])

  return {
    serverChannel: wrapWs(serverWs),
    clientChannel: wrapWs(client),
    async close() {
      client.close()
      serverWs.close()
      await new Promise<void>((res) => wss.close(() => res()))
    },
  }
}

/** A server-mounted twin (same tag) so the gate finds a live binding. */
function makeServerTwin(): {
  node: ReturnType<typeof branch>
  agentBinding: AgentBindingSpec
  read: () => number
} {
  const [len, setLen] = signal(0)
  const lenSig = [len, setLen] as unknown as Signal<string>
  return {
    node: branch('div', { id: `${TAG}-twin` }, [leaf(lenSig)]),
    read: () => len(),
    agentBinding: {
      tag: TAG,
      // The twin counts adds — if it were ever driven, read() would move off 0.
      actions: {
        addTask: () => {
          setLen(len() + 1)
          return len()
        },
        toggleTask: () => len(),
        clearCompleted: () => len(),
      },
      reads: { length: () => len() },
      writes: {},
      scope: undefined,
      rateLimit: undefined,
    },
  }
}

let disposers: Array<() => void> = []
let wsPairs: WsPair[] = []
afterEach(async () => {
  for (const d of disposers) d()
  disposers = []
  for (const p of wsPairs) await p.close()
  wsPairs = []
})

describe('REAL compiled component driven over a REAL ws socket', () => {
  it('callTool gates on the server; the visible browser instance executes; twin untouched', async () => {
    // ── BROWSER SIDE: mount the REAL compiled custom element in jsdom. ────────
    const host = document.createElement('div')
    document.body.appendChild(host)
    const el = document.createElement(TAG)
    host.appendChild(el) // connectedCallback → setup runs → _registerAgentDispatcher fires

    // The Step-0 wiring: the compiler-injected, per-instance dispatcher is now
    // registered against the mounted element. Take it for the bridge.
    const instanceDispatcher = _takeAgentDispatcher(el)
    expect(instanceDispatcher, 'per-instance dispatcher must be registered on mount').toBeDefined()
    expect(instanceDispatcher!.tag).toBe(TAG)

    // Sanity: the instance dispatcher's opaque IDs are the REAL compiler IDs —
    // the same ones on the module-scope export.
    const moduleActionIds = Object.keys(clientModule.__agentDispatcher.actions).sort()
    expect(Object.keys(instanceDispatcher!.actions).sort()).toEqual(moduleActionIds)
    expect(moduleActionIds.length).toBe(3)

    // A serialize() bound to the mounted instance's signals, via the element's
    // own scope. We read the live task count straight off the rendered DOM so
    // the assertion is about what the USER sees.
    const liveTaskCount = (): number => (el.shadowRoot ?? el).querySelectorAll('.tl-item').length

    expect(liveTaskCount()).toBe(0) // nothing yet

    // ── Wire the REAL ws bridge. ─────────────────────────────────────────────
    const pair = await makeRealWsPair()
    wsPairs.push(pair)

    const twin = makeServerTwin()
    const server = createAgentServer({
      target: { node: twin.node, agentBinding: twin.agentBinding },
      createHost: () => document.createElement('div'),
      ...demoBridgeAuthorization(),
    })
    disposers.push(() => server.dispose())
    server.attachBridge(pair.serverChannel)
    const nonce = server.issueBridgeNonce().nonce

    const client = createBridgeClient({
      dispatcher: instanceDispatcher as AgentDispatcher,
      channel: pair.clientChannel,
      nonce,
      sessionToken: DEMO_SESSION,
      sessionIdentity: DEMO_SESSION,
      grantVersion: DEMO_GRANT_VERSION,
      serialize: () => ({ taskCount: liveTaskCount() }),
    })
    disposers.push(() => client.dispose())

    // ── EXTERNAL AGENT: drive the component via the server's gate. ────────────
    const res = (await server.callTool(`${TAG}/addTask`, ['Write the launch post'], {
      userId: 'agent-1',
    })) as { result?: unknown; error?: string; code?: number }

    if (res.error) console.error('[agent-driven-demo] bridge denial:', res.code, res.error)

    // 2. The result envelope came back over the REAL socket.
    expect(res).toHaveProperty('result')

    // 1. The REAL compiled component's signal changed — a task is now rendered
    //    in the VISIBLE instance's DOM.
    expect(liveTaskCount()).toBe(1)
    expect((el.shadowRoot ?? el).textContent).toContain('Write the launch post')

    // 3. The server-mounted twin was NOT executed (browser is authoritative).
    expect(twin.read()).toBe(0)

    // 4. serialize() reflects the visible instance's streamed snapshot. The
    //    snapshot is a SEPARATE frame the client pushes after the result, so
    //    over a real socket it may arrive a tick after callTool resolves.
    await waitFor(() => (server.serialize() as { taskCount?: number }).taskCount === 1)
    expect(server.serialize()).toMatchObject({ taskCount: 1 })

    // Drive a second action over the same socket to prove durability.
    await server.callTool(`${TAG}/addTask`, ['Record the demo'], { userId: 'agent-1' })
    expect(liveTaskCount()).toBe(2)
    expect(twin.read()).toBe(0)

    el.remove()
  })

  it('rejects an unknown tool at the server gate without touching the browser', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const el = document.createElement(TAG)
    host.appendChild(el)
    const instanceDispatcher = _takeAgentDispatcher(el)!

    const pair = await makeRealWsPair()
    wsPairs.push(pair)
    const twin = makeServerTwin()
    const server = createAgentServer({
      target: { node: twin.node, agentBinding: twin.agentBinding },
      createHost: () => document.createElement('div'),
      ...demoBridgeAuthorization(),
    })
    disposers.push(() => server.dispose())
    server.attachBridge(pair.serverChannel)
    const nonce = server.issueBridgeNonce().nonce
    disposers.push(
      createBridgeClient({
        dispatcher: instanceDispatcher,
        channel: pair.clientChannel,
        nonce,
        sessionToken: DEMO_SESSION,
        sessionIdentity: DEMO_SESSION,
        grantVersion: DEMO_GRANT_VERSION,
      }).dispose,
    )

    const res = (await server.callTool(`${TAG}/deleteEverything`, [], { userId: 'agent-1' })) as {
      code?: number
      error?: string
    }
    // The service gate rejects an unknown action before any bridge invoke.
    expect(res.code).toBe(404)
    expect(res.error).toBe('no action: deleteEverything')
    expect((el.shadowRoot ?? el).querySelectorAll('.tl-item').length).toBe(0)
    el.remove()
  })
})
