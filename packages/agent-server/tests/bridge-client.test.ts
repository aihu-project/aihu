/**
 * `@aihu/agent-server` — browser bridge client (T3) + full capability-bridge loop.
 *
 * Acceptance (user-visible): an agent's `callTool` on the SERVER drives the
 * REAL, separate "browser" component instance over the bridge — and the
 * server-mounted twin is NOT touched. This is the honest topology: the visible
 * instance is the one actually driven.
 */

import { registerAgentMetadata } from '@aihu/agent'
import { type AgentBindingSpec, branch, leaf } from '@aihu/arbor'
import { type Signal, signal } from '@aihu/signals'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAgentServer } from '../src/agent-server.ts'
import { type AgentDispatcher, createBridgeClient } from '../src/bridge-client.ts'
import { opaqueActionId } from '../src/opaque-id.ts'
import type { AgentServer, BridgeChannel } from '../src/types.ts'

const TAG = 'bridge-counter'

/** A pair of linked in-memory channels: `[serverSide, clientSide]`. */
function makeLinkedChannels(): [BridgeChannel, BridgeChannel] {
  const msg: Array<Array<(d: string) => void>> = [[], []]
  const close: Array<Array<() => void>> = [[], []]
  const open = true
  const make = (self: 0 | 1): BridgeChannel => {
    const other = self === 0 ? 1 : 0
    return {
      get connected() {
        return open
      },
      send(data) {
        for (const h of [...msg[other]!]) h(data)
      },
      onMessage(h) {
        msg[self]!.push(h)
        return () => {
          msg[self] = msg[self]!.filter((x) => x !== h)
        }
      },
      onClose(h) {
        close[self]!.push(h)
        return () => {
          close[self] = close[self]!.filter((x) => x !== h)
        }
      },
    }
  }
  return [make(0), make(1)]
}

/** Build a real reactive counter + the client `__agentDispatcher` for it. */
function makeBrowserCounter(): {
  dispatcher: AgentDispatcher
  read: () => number
  serialize: () => { count: number }
} {
  const [count, setCount] = signal(0)
  return {
    read: () => count(),
    serialize: () => ({ count: count() }),
    dispatcher: {
      tag: TAG,
      actions: {
        [opaqueActionId(TAG, 'increment')]: (args: unknown[]) => {
          const by = typeof args[0] === 'number' ? args[0] : 1
          setCount(count() + by)
          return count()
        },
      },
      reads: { [opaqueActionId(TAG, 'count')]: () => count() },
      writes: { [opaqueActionId(TAG, 'count')]: (v: unknown) => setCount(Number(v)) },
    },
  }
}

/** A server-mounted twin (same tag) so the gate finds a live binding. */
function makeServerTwin(): {
  node: ReturnType<typeof branch>
  agentBinding: AgentBindingSpec
  read: () => number
} {
  const [count, setCount] = signal(0)
  const countSig = [count, setCount] as unknown as Signal<string>
  return {
    node: branch('div', { id: TAG }, [leaf(countSig)]),
    read: () => count(),
    agentBinding: {
      tag: TAG,
      actions: {
        increment: (args: unknown) => {
          const by = Array.isArray(args) && typeof args[0] === 'number' ? args[0] : 1
          setCount(count() + by)
          return count()
        },
      },
      reads: { count: () => count() },
      writes: { count: (v: unknown) => setCount(Number(v)) },
    },
  }
}

beforeEach(() => {
  registerAgentMetadata({
    tag: TAG,
    describes: 'A counter driven over the capability bridge.',
    actions: { increment: { returns: {} } },
    state: { count: 'The current value.' },
  })
})

let servers: AgentServer[] = []
let clients: Array<{ dispose(): void }> = []
afterEach(() => {
  for (const c of clients) c.dispose()
  for (const s of servers) s.dispose()
  servers = []
  clients = []
})

describe('bridge client executes opaque invocations on the visible component', () => {
  it('runs an action and replies with result + snapshot; sends hello on connect', async () => {
    const [serverSide, clientSide] = makeLinkedChannels()
    const browser = makeBrowserCounter()

    const frames: Array<Record<string, unknown>> = []
    serverSide.onMessage((d) => frames.push(JSON.parse(d)))

    clients.push(
      createBridgeClient({
        dispatcher: browser.dispatcher,
        channel: clientSide,
        serialize: browser.serialize,
      }),
    )

    // hello handshake fired on connect.
    expect(frames.find((f) => f.type === 'hello')).toMatchObject({ type: 'hello', protocol: 1 })

    // Server sends an approved invoke; the client drives the REAL component.
    serverSide.send(
      JSON.stringify({
        type: 'invoke',
        callId: 'k1',
        opaqueActionId: opaqueActionId(TAG, 'increment'),
        args: [5],
      }),
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(browser.read()).toBe(5) // the visible instance actually changed
    expect(frames.find((f) => f.type === 'result')).toMatchObject({ callId: 'k1', result: 5 })
    expect(frames.find((f) => f.type === 'snapshot')).toMatchObject({ snapshot: { count: 5 } })
  })

  it('replies with a loud error for an unknown opaque id (desync)', async () => {
    const [serverSide, clientSide] = makeLinkedChannels()
    const browser = makeBrowserCounter()
    const frames: Array<Record<string, unknown>> = []
    serverSide.onMessage((d) => frames.push(JSON.parse(d)))
    clients.push(createBridgeClient({ dispatcher: browser.dispatcher, channel: clientSide }))

    serverSide.send(
      JSON.stringify({
        type: 'invoke',
        callId: 'k2',
        opaqueActionId: 'a_deadbeefdeadbeef',
        args: [],
      }),
    )
    await Promise.resolve()

    expect(frames.find((f) => f.type === 'error')).toMatchObject({ callId: 'k2' })
  })
})

describe('full loop: server gates, the BROWSER instance is driven (not the twin)', () => {
  it('callTool on the server drives the visible component; the server twin stays untouched', async () => {
    const twin = makeServerTwin()
    const browser = makeBrowserCounter()
    const [serverSide, clientSide] = makeLinkedChannels()

    const server = createAgentServer({
      target: { node: twin.node, agentBinding: twin.agentBinding },
      createHost: () => new JSDOM('<!DOCTYPE html><body></body>').window.document.body,
      verifyBridgeSession: (token) => token === 'test-session',
      reauthorizeBridgeInvoke: () => true,
    })
    servers.push(server)
    server.attachBridge(serverSide)
    const nonce = server.issueBridgeNonce().nonce
    clients.push(
      createBridgeClient({
        dispatcher: browser.dispatcher,
        channel: clientSide,
        sessionToken: 'test-session',
        nonce,
        serialize: browser.serialize,
      }),
    )

    const res = (await server.callTool(`${TAG}/increment`, [5], { userId: 'u1' })) as {
      result: unknown
    }

    // The agent got the visible instance's result.
    expect(res.result).toBe(5)
    // The VISIBLE (browser) component was driven…
    expect(browser.read()).toBe(5)
    // …and the server-mounted twin was NOT (browser is authoritative).
    expect(twin.read()).toBe(0)
    // serialize() reflects the visible instance's streamed snapshot.
    expect(server.serialize()).toMatchObject({ count: 5 })
  })
})
