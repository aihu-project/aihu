/**
 * `@aihu/agent-server` — scripted end-to-end tests (T2).
 *
 * Acceptance: a scripted client actually DRIVES a server-mounted component.
 * We assert user-visible behavior — a real signal changes and `serialize()`
 * reflects it — not merely "it builds".
 *
 * Coverage:
 *  - MCP tool call (over an in-memory MCP client↔server pair) drives a mounted
 *    component: a write action mutates a real signal; serialize() reflects it.
 *  - 404 for an unmounted tag (gate, via the live registry).
 *  - 401 for a scoped component with no auth context.
 *  - 403 for a scoped component whose JWT lacks the claim.
 *  - WS capability-bridge contract: approved invocations are forwarded as
 *    `{ opaqueActionId, args }`; rejected ones are NOT; the browser's result
 *    is surfaced back; disconnect mid-drive is a loud error.
 *
 * The tests build a genuine reactive component out of `@aihu/signals` +
 * `@aihu/arbor` so the LiveBinding's reads/writes/actions are real signals
 * mounted into a jsdom host — exactly the server-mount path the plan requires.
 */

import { registerAgentMetadata } from '@aihu/agent'
import { type AgentBindingSpec, branch, leaf } from '@aihu/arbor'
import { type Signal, signal } from '@aihu/signals'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAgentServer } from '../src/agent-server.ts'
import { createComponentMcpServer } from '../src/mcp-server.ts'
import { opaqueActionId } from '../src/opaque-id.ts'
import type { AgentServer, BridgeChannel } from '../src/types.ts'
import { BRIDGE_PROTOCOL_VERSION } from '../src/types.ts'

// ─── A real reactive counter component + its server agent-binding ────────────

const TAG = 'agent-counter'

/**
 * Build a real `<agent-counter>` component: a `count` signal rendered into a
 * leaf, plus an `increment`/`set` action and a read of `count`. Returns the
 * arbor node + the `__agentBinding`-shaped spec the SERVER build would emit.
 */
function makeCounter(opts?: { scope?: string; rateLimit?: string }): {
  node: ReturnType<typeof branch>
  agentBinding: AgentBindingSpec
  readCount: () => number
} {
  const [count, setCount] = signal(0)
  // Render the `count` signal directly as the leaf's text. The leaf factory
  // takes a Signal tuple `[Read, Write]`; passing `count`'s tuple makes the
  // reactive text binding register in the mount's signalRegistry so
  // serialize() reflects it. (Numbers stringify in the text-leaf effect.)
  const countSig = [count, setCount] as unknown as Signal<string>
  const node = branch('div', { id: TAG }, [leaf(countSig)])

  const agentBinding: AgentBindingSpec = {
    tag: TAG,
    actions: {
      increment: (args: unknown) => {
        const by = Array.isArray(args) && typeof args[0] === 'number' ? args[0] : 1
        setCount(count() + by)
        return count()
      },
      set: (args: unknown) => {
        const v = Array.isArray(args) && typeof args[0] === 'number' ? args[0] : 0
        setCount(v)
        return count()
      },
    },
    reads: { count: () => count() },
    writes: { count: (v: unknown) => setCount(Number(v)) },
    scope: opts?.scope,
    rateLimit: opts?.rateLimit,
  }

  return { node, agentBinding, readCount: () => count() }
}

function host(): Element {
  return new JSDOM('<!DOCTYPE html><body></body>').window.document.body
}

// Register the static metadata so MCP tool-listing surfaces the actions.
beforeEach(() => {
  registerAgentMetadata({
    tag: TAG,
    describes: 'A counter exposing increment/set actions and a count read.',
    actions: { increment: { returns: {} }, set: { returns: {} } },
    state: { count: 'The current counter value.' },
  })
})

let servers: AgentServer[] = []
afterEach(() => {
  for (const s of servers) s.dispose()
  servers = []
})

function spawn(...args: Parameters<typeof createAgentServer>): AgentServer {
  const [input] = args
  const s = createAgentServer({
    ...input,
    verifyBridgeSession:
      input.verifyBridgeSession ??
      ((token) => (token === 'test-session' ? { identity: token } : { identity: '' })),
    reauthorizeBridgeInvoke:
      input.reauthorizeBridgeInvoke ?? (() => ({ identity: 'test-session' })),
  })
  servers.push(s)
  return s
}

// ─── Scripted MCP client drives the mounted component ────────────────────────

describe('scripted MCP client drives a server-mounted component', () => {
  it('a tools/call increment mutates a real signal and serialize() reflects it', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
    })

    // Starting state: signal is 0, serialize reflects 0.
    expect(counter.readCount()).toBe(0)
    const before = server.serialize()
    expect(Object.values(before)).toContain(0)

    // Wire a real MCP client ↔ the component MCP server over in-memory transport.
    const mcp = createComponentMcpServer(server)
    const [clientT, serverT] = InMemoryTransport.createLinkedPair()
    await mcp.connect(serverT)
    const client = new Client({ name: 'test-agent', version: '0.0.0' }, { capabilities: {} })
    await client.connect(clientT)

    // The agent discovers the tools…
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name)
    expect(names).toContain(`${TAG}/increment`)
    expect(names).toContain(`${TAG}/count`)

    // …then DRIVES the component: increment by 5.
    const res = await client.callTool({
      name: `${TAG}/increment`,
      arguments: { args: [5] },
    })
    expect(res.isError).toBeFalsy()

    // User-visible proof: the real signal changed.
    expect(counter.readCount()).toBe(5)
    // …and serialize() (the browser-view stream payload) reflects it.
    const after = server.serialize()
    expect(Object.values(after)).toContain(5)

    await client.close()
    await mcp.close()
  })

  it('a read tool denies an anonymous caller before returning the live signal value', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
    })
    counter.agentBinding.actions.increment!([3])

    const mcp = createComponentMcpServer(server)
    const [clientT, serverT] = InMemoryTransport.createLinkedPair()
    await mcp.connect(serverT)
    const client = new Client({ name: 'test-agent', version: '0.0.0' }, { capabilities: {} })
    await client.connect(clientT)

    const res = (await client.callTool({ name: `${TAG}/count`, arguments: {} })) as {
      content: Array<{ text: string }>
      isError?: boolean
    }
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain(
      '[401] AUTH_MISSING: @aihu/auth middleware is not registered',
    )

    await client.close()
    await mcp.close()
  })

  // ─── DE5 — derived named-parameter schema, marshalled to positional ─────────
  it('a derived param schema surfaces named inputs and marshals them positionally', async () => {
    const counter = makeCounter()
    // Register metadata carrying a DERIVED param schema (as the compiler now
    // emits it for `increment(by: number)`) — last-write-wins over beforeEach.
    registerAgentMetadata({
      tag: TAG,
      actions: {
        increment: {
          returns: {},
          params: { properties: { by: { type: 'number' } }, required: ['by'] },
        },
        set: { returns: {} },
      },
      state: { count: 'The current counter value.' },
    })
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
    })

    const mcp = createComponentMcpServer(server)
    const [clientT, serverT] = InMemoryTransport.createLinkedPair()
    await mcp.connect(serverT)
    const client = new Client({ name: 'test-agent', version: '0.0.0' }, { capabilities: {} })
    await client.connect(clientT)

    // The tool advertises the REAL parameter, not the opaque `args` array.
    const { tools } = await client.listTools()
    const inc = tools.find((t) => t.name === `${TAG}/increment`)!
    expect(inc.inputSchema.properties).toHaveProperty('by')
    expect(inc.inputSchema.properties).not.toHaveProperty('args')
    expect(inc.inputSchema.required).toEqual(['by'])

    // A NAMED call marshals `{ by: 5 }` back into the positional `[5]` the
    // runtime action expects — the signal advances by 5.
    const res = await client.callTool({ name: `${TAG}/increment`, arguments: { by: 5 } })
    expect(res.isError).toBeFalsy()
    expect(counter.readCount()).toBe(5)

    await client.close()
    await mcp.close()
  })
})

// ─── Gate: 404 / 401 / 403 (delegated to agent-service, verified end-to-end) ──

describe('security gate is preserved through callTool', () => {
  it('404 for an unmounted tag', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
    })
    const res = (await server.callTool('not-mounted/doThing', {}, { userId: 'u1' })) as {
      code: number
      error: string
    }
    expect(res.code).toBe(404)
    expect(res.error).toContain('not-mounted')
  })

  it('401 for a scoped component with no auth context', async () => {
    const counter = makeCounter({ scope: 'authenticated' })
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      authPlugin: {
        checkScope: () => true,
        verify: async (jwt) => (jwt.startsWith('token-') ? { sub: 'u1' } : null),
      },
    })
    const res = (await server.callTool(`${TAG}/increment`, { args: [1] })) as {
      code: number
      error: string
    }
    expect(res.code).toBe(401)
  })

  it('401 (fail-closed) when the auth plugin cannot signature-verify (#420)', async () => {
    const counter = makeCounter({ scope: 'authenticated' })
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      // Decode-only plugin: no `verify`. The gate must refuse rather than
      // trust unverified claims — even though checkScope would have passed.
      authPlugin: { checkScope: () => true },
    })
    const res = (await server.callTool(
      `${TAG}/increment`,
      { args: [1] },
      { userId: 'u1', jwt: 'token-authenticated' },
    )) as { code: number; error: string }
    expect(res.code).toBe(401)
    expect(res.error).toContain('AUTH_UNVERIFIABLE')
  })

  it('403 for a scoped component whose (verified) JWT lacks the claim', async () => {
    const counter = makeCounter({ scope: 'admin' })
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      authPlugin: {
        checkScope: (jwt, scope) => jwt.includes(scope),
        verify: async (jwt) => (jwt.startsWith('token-') ? { sub: 'u1' } : null),
      },
    })
    const res = (await server.callTool(
      `${TAG}/increment`,
      { args: [1] },
      { userId: 'u1', jwt: 'token-without-the-claim' },
    )) as { code: number; error: string }
    expect(res.code).toBe(403)
    expect(res.error).toContain('SCOPE_DENIED')
  })

  it('a rejected call is NOT forwarded to the bridge', async () => {
    const counter = makeCounter({ scope: 'admin' })
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      authPlugin: {
        checkScope: (jwt, scope) => jwt.includes(scope),
        verify: async (jwt) => (jwt.length > 0 ? { sub: 'u1' } : null),
      },
    })
    const forwarded: string[] = []
    server.attachBridge(makeFakeBridge((msg) => forwarded.push(msg)))

    const res = (await server.callTool(
      `${TAG}/increment`,
      { args: [1] },
      { userId: 'u1', jwt: 'nope' },
    )) as { code: number }
    expect(res.code).toBe(403)
    // The gate rejected it; the visible instance must never have been driven.
    expect(forwarded).toHaveLength(0)
  })
})

// ─── MCP transport hardening (#420) ──────────────────────────────────────────
//
// `mcp-server.ts` used to forward `request.params.arguments.context` (incl.
// `userId`) to the gate as if authoritative. It now forwards ONLY the `jwt`
// credential; caller-supplied identity is dropped at the boundary.

describe('MCP boundary forwards the credential, never caller identity (#420)', () => {
  async function mcpPair(server: AgentServer) {
    const mcp = createComponentMcpServer(server)
    const [clientT, serverT] = InMemoryTransport.createLinkedPair()
    await mcp.connect(serverT)
    const client = new Client({ name: 'test-agent', version: '0.0.0' }, { capabilities: {} })
    await client.connect(clientT)
    return { mcp, client }
  }

  it('rotating context.userId over MCP does not rotate the rate-limit bucket', async () => {
    const counter = makeCounter({ rateLimit: '100/min' })
    const usedKeys: string[] = []
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      authPlugin: {
        checkScope: () => true,
        verify: async (jwt) => (jwt === 'signed-token' ? { sub: 'true-principal' } : null),
      },
      rateLimitPlugin: {
        checkRateLimit: (_spec, key) => {
          usedKeys.push(key)
          return true
        },
      },
    })
    const { mcp, client } = await mcpPair(server)

    for (const spoofed of ['spoof-a', 'spoof-b']) {
      const res = await client.callTool({
        name: `${TAG}/increment`,
        arguments: { args: [1], context: { userId: spoofed, jwt: 'signed-token' } },
      })
      expect(res.isError).toBeFalsy()
    }
    expect(usedKeys).toEqual([`true-principal:${TAG}`, `true-principal:${TAG}`])
    expect(usedKeys.join()).not.toContain('spoof')

    await client.close()
    await mcp.close()
  })

  it('context carrying only a userId (no jwt) is dropped entirely → 401', async () => {
    const counter = makeCounter({ rateLimit: '100/min' })
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      authPlugin: {
        checkScope: () => true,
        verify: async () => ({ sub: 'true-principal' }),
      },
      rateLimitPlugin: { checkRateLimit: () => true },
    })
    const { mcp, client } = await mcpPair(server)

    const res = (await client.callTool({
      name: `${TAG}/increment`,
      arguments: { args: [1], context: { userId: 'i-claim-to-be-someone' } },
    })) as { isError?: boolean; content: Array<{ text: string }> }
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain('[401]')

    await client.close()
    await mcp.close()
  })

  it('a 401 over MCP carries the configured auth-discovery URL', async () => {
    const DISCOVERY = 'https://example.dev/.well-known/oauth-protected-resource'
    const counter = makeCounter({ rateLimit: '100/min' })
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      authPlugin: {
        checkScope: () => true,
        verify: async (jwt) => (jwt === 'signed-token' ? { sub: 'true-principal' } : null),
      },
      rateLimitPlugin: { checkRateLimit: () => true },
      authDiscoveryUrl: DISCOVERY,
    })
    const { mcp, client } = await mcpPair(server)

    const res = (await client.callTool({
      name: `${TAG}/increment`,
      arguments: { args: [1] }, // anonymous — no credential at all
    })) as { isError?: boolean; content: Array<{ text: string }> }
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain('[401]')
    expect(res.content[0]!.text).toContain(DISCOVERY)

    await client.close()
    await mcp.close()
  })
})

// ─── WS capability-bridge contract ───────────────────────────────────────────

/**
 * Minimal in-memory bridge whose outbound frames are captured by `onSend`.
 *
 * `handshake()` sends the `hello` frame a real `createBridgeClient` sends on
 * connect. Since GO2 the server refuses to delegate to a channel that has not
 * completed one, so any test expecting forwarding must call it. It is explicit
 * at each call site rather than folded into construction, because the handshake
 * is now security-relevant: a fixture that silently handshakes would hide
 * exactly the property these tests exist to pin.
 */
function makeFakeBridge(onSend: (data: string) => void): BridgeChannel & {
  reply(data: string): void
  handshake(nonce: string): void
  fireClose(): void
} {
  let msgHandler: ((d: string) => void) | null = null
  let closeHandler: (() => void) | null = null
  let open = true
  return {
    get connected() {
      return open
    },
    send(data: string) {
      onSend(data)
    },
    onMessage(h) {
      msgHandler = h
      return () => {
        msgHandler = null
      }
    },
    onClose(h) {
      closeHandler = h
      return () => {
        closeHandler = null
      }
    },
    reply(data: string) {
      msgHandler?.(data)
    },
    handshake(nonce: string) {
      msgHandler?.(
        JSON.stringify({
          type: 'hello',
          protocol: BRIDGE_PROTOCOL_VERSION,
          nonce,
          sessionToken: 'test-session',
          sessionIdentity: 'test-session',
        }),
      )
    },
    fireClose() {
      open = false
      closeHandler?.()
    },
  }
}

// ─── Internal SSR-DOM: no createHost, no pre-existing global document ─────────
//
// This is the fix's load-bearing path. Under plain Bun/Node there is no global
// `document`, and arbor's `mount()` reaches for `document.createElement` etc.
// `createAgentServer` must stand up an internal jsdom DOM so a consumer needs
// NO `createHost` and NO `globalThis.document` glue. The root vitest config runs
// `environment: 'jsdom'`, so a global `document` already exists here — we delete
// it to exercise the headless path, then restore it for the other suites.
describe('internal SSR-DOM (no createHost, no global document)', () => {
  let savedDocument: typeof globalThis.document | undefined
  let savedWindow: typeof globalThis.window | undefined

  beforeEach(() => {
    savedDocument = (globalThis as Record<string, unknown>).document as typeof globalThis.document
    savedWindow = (globalThis as Record<string, unknown>).window as typeof globalThis.window
    // Actually remove the globals so `typeof document === 'undefined'`,
    // reproducing a plain Bun/Node runtime (not just setting them undefined).
    delete (globalThis as Record<string, unknown>).document
    delete (globalThis as Record<string, unknown>).window
  })

  afterEach(() => {
    ;(globalThis as Record<string, unknown>).document = savedDocument
    ;(globalThis as Record<string, unknown>).window = savedWindow
  })

  it('mounts + registers a LiveBinding with no DOM glue, and the gate drives it', async () => {
    expect(typeof (globalThis as Record<string, unknown>).document).toBe('undefined')

    const counter = makeCounter()
    // No `createHost`. No pre-existing `document`. This crashed before the fix.
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
    })

    // The internal DOM was installed by createAgentServer.
    expect(typeof (globalThis as Record<string, unknown>).document).not.toBe('undefined')

    // Starting state mounted correctly.
    expect(counter.readCount()).toBe(0)

    // The gate resolves the EXPOSED action and drives the real signal.
    const ok = (await server.callTool(`${TAG}/increment`, [4], { userId: 'u1' })) as {
      result?: unknown
      code?: number
    }
    expect(ok.code).toBeUndefined()
    expect(counter.readCount()).toBe(4)
    const after = server.serialize()
    expect(Object.values(after)).toContain(4)

    // The gate REJECTS an unexposed tag (404) — the security gate still works
    // through the internally-mounted binding.
    const denied = (await server.callTool('not-exposed/doThing', {}, { userId: 'u1' })) as {
      code: number
      error: string
    }
    expect(denied.code).toBe(404)
    expect(denied.error).toContain('not-exposed')
  })

  it('honors an explicit createHost even when an internal DOM would be stood up', () => {
    const counter = makeCounter()
    let hostCalls = 0
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: () => {
        hostCalls++
        // createAgentServer ensures the DOM BEFORE calling createHost, so a
        // factory that itself uses `document` works without consumer glue.
        return document.createElement('section')
      },
    })
    expect(hostCalls).toBe(1)
    expect(server.serialize()).toBeDefined()
  })
})

describe('WS capability bridge', () => {
  it('forwards an approved invocation as {opaqueActionId, args} and surfaces the browser result', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
    })

    let lastFrame: {
      type: string
      callId: string
      opaqueActionId: string
      args: unknown[]
    } | null = null
    const bridge = makeFakeBridge((data) => {
      lastFrame = JSON.parse(data)
      // Browser executes + replies with the visible instance's result.
      bridge.reply(
        JSON.stringify({ type: 'result', callId: lastFrame!.callId, result: { visible: 42 } }),
      )
    })
    server.attachBridge(bridge)
    // The browser client completes the protocol handshake on connect; without
    // it the server would refuse to delegate (GO2).
    bridge.handshake(server.issueBridgeNonce().nonce)

    // callTool takes the positional args array directly (the MCP layer unwraps
    // `.args` before calling it; here we call callTool directly).
    const res = (await server.callTool(`${TAG}/increment`, [7], { userId: 'u1' })) as {
      result: unknown
    }

    // Contract: forwarded message carries the STABLE opaque id (matching the
    // compiler-emitted __agentDispatcher) + args, and no policy info.
    expect(lastFrame).not.toBeNull()
    expect(lastFrame!.type).toBe('invoke')
    expect(lastFrame!.opaqueActionId).toBe(opaqueActionId(TAG, 'increment'))
    expect(lastFrame!.opaqueActionId).toMatch(/^a_[0-9a-f]{16}$/)
    expect(lastFrame!.args).toEqual([7])
    expect('scope' in (lastFrame as Record<string, unknown>)).toBe(false)
    expect('rateLimit' in (lastFrame as Record<string, unknown>)).toBe(false)

    // The visible instance's result is surfaced back to the agent.
    expect(res.result).toEqual({ visible: 42 })

    // Browser is authoritative: the server-mounted twin was NOT driven. The
    // server gates (policy) but delegates execution to the visible instance, so
    // its signal stays at 0 — no double-execution, no projection drift.
    expect(counter.readCount()).toBe(0)
  })

  it('a disconnect mid-drive is a loud error, not a silent drop', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
    })

    const bridge = makeFakeBridge(() => {
      // Browser never replies; instead the socket drops.
      bridge.fireClose()
    })
    server.attachBridge(bridge)
    // A verified channel — so the withheld result is provably a post-send
    // disconnect, not a handshake refusal.
    bridge.handshake(server.issueBridgeNonce().nonce)

    const res = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code: number
      error: string
    }
    expect(res.code).toBe(403)
    expect(res.error).toBe('BRIDGE_RESULT_WITHHELD: action may have executed; result withheld')
  })
})

// ─── GO2: the bridge must VERIFY the handshake it already sends ──────────────
//
// Thesis §3: "The client is never the policy authority", and the named failure
// mode "a check that is structurally always-true".
//
// `BRIDGE_PROTOCOL_VERSION` was defined, sent by `bridge-client.ts`, imported
// AND re-exported by `agent-server.ts` — and never once appeared on the
// right-hand side of a comparison anywhere in the tree. `attachBridge` accepted
// any channel, and `callTool` delegated execution to it. A channel that
// receives `invoke` frames IS the execution authority; it must prove which
// protocol it speaks before becoming one.
//
// Every test here asserts the GATE's envelope (503 BRIDGE_UNVERIFIED) AND that
// no `invoke` frame reached the wire — never merely that the call failed.
//
// BIDIRECTIONAL: three rejection cases, then a must-delegate case and the
// no-bridge headless path. Without those last two, "refuse every channel" would
// score identically to a correct fix while breaking the bridge outright.

describe('GO2 under-enforcement — an unverified channel must never be delegated to', () => {
  /** Attach a bridge, optionally send `hello`, invoke, and report what happened. */
  async function probe(hello: unknown | undefined): Promise<{
    res: { code?: number; error?: string; result?: unknown }
    invokes: string[]
  }> {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      // Keep the no-`hello` case from waiting out the full default timeout.
      bridgeHandshakeTimeoutMs: 50,
    })
    const sent: string[] = []
    const bridge = makeFakeBridge((data) => {
      sent.push(data)
      // A cooperative browser would answer; if the server ever forwards, the
      // call resolves rather than hanging, so a failure reads as a wrong CODE.
      const frame = JSON.parse(data) as { callId: string }
      bridge.reply(JSON.stringify({ type: 'result', callId: frame.callId, result: 1 }))
    })
    server.attachBridge(bridge)
    if (hello !== undefined) {
      const issued = server.issueBridgeNonce().nonce
      bridge.reply(JSON.stringify({ nonce: issued, sessionToken: 'test-session', ...hello }))
    }

    const res = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
      error?: string
    }
    return { res, invokes: sent.filter((s) => s.includes('"invoke"')) }
  }

  it('(a) an invoke with NO prior hello → 503 BRIDGE_UNVERIFIED, nothing forwarded', async () => {
    const { res, invokes } = await probe(undefined)
    expect(res.code).toBe(503)
    expect(res.error).toContain('BRIDGE_UNVERIFIED')
    expect(invokes).toHaveLength(0)
  })

  it('(b) hello with a MISMATCHED protocol version → 503, nothing forwarded', async () => {
    const { res, invokes } = await probe({
      type: 'hello',
      protocol: BRIDGE_PROTOCOL_VERSION + 1,
    })
    expect(res.code).toBe(503)
    expect(res.error).toContain('BRIDGE_UNVERIFIED')
    expect(res.error).toBe('BRIDGE_UNVERIFIED: BRIDGE_HELLO_INVALID: hello verification failed')
    expect(invokes).toHaveLength(0)
  })

  it('(c) hello with a NON-NUMERIC protocol value → 503, nothing forwarded', async () => {
    const { res, invokes } = await probe({ type: 'hello', protocol: 'not-a-number' })
    expect(res.code).toBe(503)
    expect(res.error).toContain('BRIDGE_UNVERIFIED')
    expect(invokes).toHaveLength(0)
  })

  it("a stringified protocol ('1') is not coerced into agreement", async () => {
    // `'1' == 1` is true under loose equality; the check is strict on purpose.
    const { res, invokes } = await probe({ type: 'hello', protocol: '1' })
    expect(res.code).toBe(503)
    expect(invokes).toHaveLength(0)
  })

  it('an unverified channel cannot resolve calls or overwrite serialize() state', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
    })
    const bridge = makeFakeBridge(() => {})
    server.attachBridge(bridge)

    // A peer that never identified itself pushes a snapshot. Honouring it would
    // let an unverified channel dictate what the server reports as state.
    bridge.reply(JSON.stringify({ type: 'snapshot', snapshot: { count: 9999 } }))

    expect(server.serialize()).not.toMatchObject({ count: 9999 })
  })

  it('attaching a NEW channel resets verification — status is never inherited', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      bridgeHandshakeTimeoutMs: 50,
    })

    const good = makeFakeBridge(() => {})
    server.attachBridge(good)
    good.handshake(server.issueBridgeNonce().nonce)

    // A second peer takes over the bridge without handshaking. If verification
    // were global rather than per-channel, it would inherit `good`'s status.
    const sent: string[] = []
    const impostor = makeFakeBridge((d) => sent.push(d))
    server.attachBridge(impostor)

    const res = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
    }
    expect(res.code).toBe(503)
    expect(sent.filter((s) => s.includes('"invoke"'))).toHaveLength(0)
  })
})

describe('GO2 over-enforcement — verification must not break the working paths', () => {
  it('a channel that sends a VALID hello IS delegated to', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
    })
    const sent: string[] = []
    const bridge = makeFakeBridge((data) => {
      sent.push(data)
      const frame = JSON.parse(data) as { callId: string }
      bridge.reply(JSON.stringify({ type: 'result', callId: frame.callId, result: { ok: 1 } }))
    })
    server.attachBridge(bridge)
    bridge.handshake(server.issueBridgeNonce().nonce)

    const res = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      result: unknown
      code?: number
    }
    expect(res.code).toBeUndefined()
    expect(res.result).toEqual({ ok: 1 })
    expect(sent.filter((s) => s.includes('"invoke"'))).toHaveLength(1)
  })

  it('a hello arriving AFTER callTool starts still verifies (the attach/connect race)', async () => {
    // Over a real socket `attachBridge` returns before the client's `hello`
    // lands. Denying that would turn a normal startup race into a spurious
    // failure, so the wait is bounded rather than instantaneous.
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
    })
    const sent: string[] = []
    const bridge = makeFakeBridge((data) => {
      sent.push(data)
      const frame = JSON.parse(data) as { callId: string }
      bridge.reply(JSON.stringify({ type: 'result', callId: frame.callId, result: 7 }))
    })
    server.attachBridge(bridge)

    const call = server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })
    // Handshake lands a tick later, while the call is already in flight.
    await Promise.resolve()
    bridge.handshake(server.issueBridgeNonce().nonce)

    const res = (await call) as { result: unknown; code?: number }
    expect(res.code).toBeUndefined()
    expect(res.result).toBe(7)
    expect(sent.filter((s) => s.includes('"invoke"'))).toHaveLength(1)
  })

  it('the NO-BRIDGE headless path needs no handshake at all', async () => {
    // agent-server.ts's no-bridge branch (headless / CI dispatch) has no
    // channel to verify. Requiring a handshake there would break every
    // bridge-less consumer — the explicit non-goal of this slice.
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
    })

    const res = (await server.callTool(`${TAG}/increment`, [5], { userId: 'u1' })) as {
      result: unknown
      code?: number
    }
    expect(res.code).toBeUndefined()
    // Dispatched on the server-mounted instance, as the headless path must.
    expect(counter.readCount()).toBe(5)
  })

  it('a gate rejection still reports its OWN code, not the transport error', async () => {
    // Ordering: the agent-service gate runs before channel verification, so an
    // unauthorized call is denied for its own reason (403) and is still never
    // forwarded — the handshake check must not mask 404/401/403/429.
    const counter = makeCounter({ scope: 'admin' })
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      authPlugin: {
        checkScope: (jwt, scope) => jwt.includes(scope),
        verify: async (jwt) => (jwt.length > 0 ? { sub: 'u1' } : null),
      },
      bridgeHandshakeTimeoutMs: 50,
    })
    const sent: string[] = []
    server.attachBridge(makeFakeBridge((d) => sent.push(d))) // never handshakes

    const res = (await server.callTool(`${TAG}/increment`, [1], {
      userId: 'u1',
      jwt: 'nope',
    })) as { code: number; error: string }

    expect(res.code).toBe(403)
    expect(res.error).toContain('SCOPE_DENIED')
    expect(sent.filter((s) => s.includes('"invoke"'))).toHaveLength(0)
  })
})
