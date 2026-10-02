/**
 * Conformance suite (aihu-agent#14, routed from aihu-project/aihu#874) — the
 * `@aihu/agent-server` half of the regression floor described in the
 * `@aihu/agent-service` conformance suite (`packages/agent-service/tests/
 * conformance.test.ts`). Read that file's header first; this one covers only
 * what is specific to this package: the capability-bridge origin/handshake
 * posture.
 *
 * Covers:
 *  1. The exported API surface and dependency-version contract this package
 *     is pinned against.
 *  2. `isAllowedBridgeOrigin` fails closed by default (empty allowlist,
 *     missing origin) — pinned through the public export.
 *  3. A capability-bridge channel that reconnects after the previous one
 *     disconnected must independently prove its own session; a verified
 *     handshake is never inherited by a new channel.
 *
 * Also pins protocol v2, verified session identity/grant binding, and peer
 * replacement cancellation. Live revocation is checked before each invoke.
 */

import { registerAgentMetadata } from '@aihu/agent'
import { type AgentBindingSpec, branch, leaf } from '@aihu/arbor'
import { type Signal, signal } from '@aihu/signals'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import agentServerPackageJson from '../package.json' with { type: 'json' }
import { createAgentServer } from '../src/agent-server.ts'
import { verifyBridgeUpgrade } from '../src/bridge-auth.ts'
import * as agentServerIndex from '../src/index.ts'
import type { AgentServer, BridgeChannel } from '../src/types.ts'
import { BRIDGE_PROTOCOL_VERSION } from '../src/types.ts'

// ─── Part 1: pinned package versions + exported API surface ─────────────────

describe('conformance — pinned package versions and API surface', () => {
  it("@aihu/agent-server's own runtime dependency contract is unchanged", () => {
    expect(agentServerPackageJson.dependencies).toEqual({
      '@aihu/agent': 'workspace:*',
      '@aihu/agent-service': 'workspace:*',
      '@modelcontextprotocol/sdk': '^1.0.0',
      jsdom: '^25.0.0',
    })
    expect(agentServerPackageJson.peerDependencies['@aihu/arbor']).toBe('^4.1.2')
    expect(agentServerPackageJson.devDependencies['@aihu/arbor']).toBe('workspace:*')
  })

  it('the exported value surface matches the documented allowlist exactly', () => {
    const exportedValues = Object.keys(agentServerIndex).sort()
    expect(exportedValues).toEqual(
      [
        'BRIDGE_PROTOCOL_VERSION',
        'createAgentServer',
        'createBridgeNonceStore',
        'createBridgeClient',
        'verifyBridgeUpgrade',
        'createComponentMcpServer',
        'serveComponentMcp',
        'opaqueActionId',
        'opaqueActionIdForTool',
        'parseToolName',
      ].sort(),
    )
  })

  it('the WS capability-bridge protocol is v2 for bound nonce/session hellos', () => {
    expect(BRIDGE_PROTOCOL_VERSION).toBe(2)
  })
})

// ─── Part 2: origin allowlist fails closed by default ────────────────────────

describe('conformance — bridge origin is an independent exact-match control', () => {
  it('rejects an empty allowlist and a missing origin with exact reason', () => {
    const opts = { allowedOrigins: [] }
    expect(verifyBridgeUpgrade(new Request('https://bridge.example'), opts)).toEqual({
      ok: false,
      status: 403,
      reason: 'capability-bridge upgrade refused: missing Origin header',
    })
    expect(
      verifyBridgeUpgrade(
        new Request('https://bridge.example', { headers: { origin: 'https://app.example.com' } }),
        opts,
      ),
    ).toEqual({
      ok: false,
      status: 403,
      reason:
        'capability-bridge upgrade refused: origin "https://app.example.com" is not in the allowlist',
    })
  })
})

// ─── Part 3: a reconnecting bridge channel proves its own session ───────────

const TAG = 'conformance-counter'

function makeCounter(): { node: ReturnType<typeof branch>; agentBinding: AgentBindingSpec } {
  const [count, setCount] = signal(0)
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
    },
    reads: { count: () => count() },
    writes: { count: (v: unknown) => setCount(Number(v)) },
  }
  return { node, agentBinding }
}

function host(): Element {
  return new JSDOM('<!DOCTYPE html><body></body>').window.document.body
}

beforeEach(() => {
  registerAgentMetadata({
    tag: TAG,
    describes: 'A counter used by the conformance suite.',
    actions: { increment: { returns: {} } },
    state: { count: 'The current counter value.' },
  })
})

let servers: AgentServer[] = []
afterEach(() => {
  for (const s of servers) s.dispose()
  servers = []
})

function spawn(...args: Parameters<typeof createAgentServer>): AgentServer {
  const s = createAgentServer(...args)
  servers.push(s)
  return s
}

/** A fake bridge channel whose close can be triggered, mirroring bridge-auth.test.ts. */
function makeFakeBridge(onSend: (data: string) => void): BridgeChannel & {
  reply(data: string): void
  close(): void
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
    close() {
      open = false
      closeHandler?.()
    },
  }
}

describe('conformance — a reconnected bridge channel must independently re-verify', () => {
  it('cancels reauthorization on peer replacement and never routes A approval to B', async () => {
    const counter = makeCounter()
    let release!: (value: { identity: string }) => void
    let entered!: () => void
    const reauthEntered = new Promise<void>((resolve) => {
      entered = resolve
    })
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      verifyBridgeSession: (token) => ({ identity: token }),
      reauthorizeBridgeInvoke: () => {
        entered()
        return new Promise<{ identity: string }>((resolve) => {
          release = resolve
        })
      },
    })
    const a = makeFakeBridge(() => {})
    server.attachBridge(a)
    a.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        nonce: server.issueBridgeNonce().nonce,
        sessionToken: 'session-a',
        sessionIdentity: 'session-a',
      }),
    )
    await Promise.resolve()
    await Promise.resolve()
    const result = server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })
    await reauthEntered
    const bFrames: string[] = []
    let b!: ReturnType<typeof makeFakeBridge>
    b = makeFakeBridge((frame) => {
      bFrames.push(frame)
      const message = JSON.parse(frame) as { type?: string; callId?: string }
      if (message.type === 'invoke' && message.callId) {
        b.reply(
          JSON.stringify({ type: 'result', callId: message.callId, result: 'delivered-to-B' }),
        )
      }
    })
    server.attachBridge(b)
    b.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        nonce: server.issueBridgeNonce().nonce,
        sessionToken: 'session-b',
        sessionIdentity: 'session-b',
      }),
    )
    await Promise.resolve()
    await Promise.resolve()
    release({ identity: 'session-a' })
    const denied = (await result) as { code?: number; error?: string }
    expect(denied.code).toBe(503)
    expect(denied.error).toBe('BRIDGE_REPLACED: bridge attachment changed during authorization')
    expect(bFrames.filter((frame) => frame.includes('"invoke"'))).toHaveLength(0)
  })

  it('does not let a call waiting on A handshake adopt B after replacement', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      bridgeHandshakeTimeoutMs: 500,
      verifyBridgeSession: (token) => ({ identity: token }),
      reauthorizeBridgeInvoke: (binding) => ({
        identity: binding.identity,
        ...(binding.grantVersion ? { grantVersion: binding.grantVersion } : {}),
      }),
    })
    const a = makeFakeBridge(() => {})
    server.attachBridge(a)
    const result = server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const bFrames: string[] = []
    let b!: ReturnType<typeof makeFakeBridge>
    b = makeFakeBridge((frame) => {
      bFrames.push(frame)
      const message = JSON.parse(frame) as { type?: string; callId?: string }
      if (message.type === 'invoke' && message.callId) {
        b.reply(
          JSON.stringify({ type: 'result', callId: message.callId, result: 'delivered-to-B' }),
        )
      }
    })
    server.attachBridge(b)
    b.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        nonce: server.issueBridgeNonce().nonce,
        sessionToken: 'session-b',
        sessionIdentity: 'session-b',
      }),
    )
    await Promise.resolve()
    await Promise.resolve()
    const denied = (await result) as { code?: number; error?: string }
    expect(denied.code).toBe(503)
    expect(denied.error).toBe('BRIDGE_REPLACED: bridge attachment changed during handshake')
    expect(bFrames.filter((frame) => frame.includes('"invoke"'))).toHaveLength(0)
  })

  it('bounds a never-settling session verifier and refuses the channel', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      securityHookTimeoutMs: 5,
      bridgeHandshakeTimeoutMs: 25,
      verifyBridgeSession: () => new Promise(() => {}),
      reauthorizeBridgeInvoke: (binding) => ({
        identity: binding.identity,
        ...(binding.grantVersion ? { grantVersion: binding.grantVersion } : {}),
      }),
    })
    const sent: string[] = []
    const bridge = makeFakeBridge((frame) => sent.push(frame))
    server.attachBridge(bridge)
    bridge.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        nonce: server.issueBridgeNonce().nonce,
        sessionToken: 'session-a',
        sessionIdentity: 'session-a',
      }),
    )
    const denied = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
      error?: string
    }
    expect(denied.code).toBe(503)
    expect(denied.error).toContain('BRIDGE_SESSION_INVALID')
    expect(sent.filter((frame) => frame.includes('"invoke"'))).toHaveLength(0)
  })

  it('bounds a never-settling per-invoke reauthorization hook', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      securityHookTimeoutMs: 5,
      verifyBridgeSession: (token) => ({ identity: token }),
      reauthorizeBridgeInvoke: () => new Promise(() => {}),
    })
    const sent: string[] = []
    const bridge = makeFakeBridge((frame) => sent.push(frame))
    server.attachBridge(bridge)
    bridge.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        nonce: server.issueBridgeNonce().nonce,
        sessionToken: 'session-a',
        sessionIdentity: 'session-a',
      }),
    )
    await Promise.resolve()
    await Promise.resolve()
    const denied = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
      error?: string
    }
    expect(denied.code).toBe(503)
    expect(denied.error).toBe('BRIDGE_AUTH_UNAVAILABLE: per-invoke authorization failed')
    expect(sent.filter((frame) => frame.includes('"invoke"'))).toHaveLength(0)
  })

  it('rejects a per-invoke binding that changes identity or grant version', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      verifyBridgeSession: (token) => ({ identity: token, grantVersion: 'g7' }),
      reauthorizeBridgeInvoke: () => ({ identity: 'session-b', grantVersion: 'g8' }),
    })
    const sent: string[] = []
    const bridge = makeFakeBridge((frame) => sent.push(frame))
    server.attachBridge(bridge)
    bridge.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        nonce: server.issueBridgeNonce().nonce,
        sessionToken: 'session-a',
        sessionIdentity: 'session-a',
        grantVersion: 'g7',
      }),
    )
    await Promise.resolve()
    await Promise.resolve()
    const denied = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
      error?: string
    }
    expect(denied.code).toBe(403)
    expect(denied.error).toBe('BRIDGE_REVOKED: session or grant binding changed')
    expect(sent.filter((frame) => frame.includes('"invoke"'))).toHaveLength(0)
  })

  it('rejects existing pending calls when a later invoke detects grant revocation', async () => {
    const counter = makeCounter()
    let authorizeCount = 0
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      verifyBridgeSession: (token) => ({ identity: token, grantVersion: 'g7' }),
      reauthorizeBridgeInvoke: (binding) => {
        authorizeCount += 1
        return authorizeCount === 1 ? { identity: binding.identity, grantVersion: 'g7' } : false
      },
    })
    const frames: string[] = []
    const bridge = makeFakeBridge((frame) => frames.push(frame))
    server.attachBridge(bridge)
    bridge.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        nonce: server.issueBridgeNonce().nonce,
        sessionToken: 'session-a',
        sessionIdentity: 'session-a',
        grantVersion: 'g7',
      }),
    )
    await Promise.resolve()
    await Promise.resolve()
    const pending = server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(frames.filter((frame) => frame.includes('"invoke"'))).toHaveLength(1)
    const revoked = (await server.callTool(`${TAG}/increment`, [2], { userId: 'u1' })) as {
      code?: number
      error?: string
    }
    const cancelled = (await pending) as { code?: number; error?: string }
    expect(revoked.code).toBe(403)
    expect(revoked.error).toBe('BRIDGE_REVOKED: session or grant is no longer current')
    expect(cancelled.code).toBe(403)
    expect(cancelled.error).toBe('BRIDGE_REVOKED: session or grant is no longer current')
    expect(frames.filter((frame) => frame.includes('"invoke"'))).toHaveLength(1)
  })

  it('times out a pending bridge invocation with its stable error code', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      bridgeCallTimeoutMs: 5,
      verifyBridgeSession: (token) => ({ identity: token }),
      reauthorizeBridgeInvoke: (binding) => ({
        identity: binding.identity,
        ...(binding.grantVersion ? { grantVersion: binding.grantVersion } : {}),
      }),
    })
    const sent: string[] = []
    const bridge = makeFakeBridge((frame) => sent.push(frame))
    server.attachBridge(bridge)
    bridge.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        nonce: server.issueBridgeNonce().nonce,
        sessionToken: 'session-a',
        sessionIdentity: 'session-a',
      }),
    )
    await Promise.resolve()
    await Promise.resolve()
    const denied = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
      error?: string
    }
    expect(denied.code).toBe(503)
    expect(denied.error).toBe('BRIDGE_TIMEOUT: bridge call timed out')
    expect(sent.some((frame) => frame.includes('"invoke"'))).toBe(true)
  })

  it('after the verified channel disconnects, a new channel that skips hello is never delegated to', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      bridgeHandshakeTimeoutMs: 50,
      verifyBridgeSession: (token) =>
        token === 'good-token' ? { identity: token, grantVersion: 'g7' } : { identity: '' },
      reauthorizeBridgeInvoke: (binding) => ({
        identity: binding.identity,
        ...(binding.grantVersion ? { grantVersion: binding.grantVersion } : {}),
      }),
    })

    // First connection: proves its session and would be delegated to.
    const first = makeFakeBridge(() => {})
    server.attachBridge(first)
    const nonce = server.issueBridgeNonce().nonce
    first.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        sessionToken: 'good-token',
        sessionIdentity: 'good-token',
        grantVersion: 'g7',
        nonce,
      }),
    )
    await Promise.resolve()
    await Promise.resolve()
    first.close()

    // Reconnect: a new channel attaches after the disconnect. Even though a
    // channel for this same logical peer was already verified once, the new
    // channel must prove ITS OWN session — nothing about the prior verified
    // state carries over to it.
    const sent: string[] = []
    const reconnected = makeFakeBridge((d) => sent.push(d))
    server.attachBridge(reconnected) // no `hello` sent this time

    const res = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
    }
    expect(res.code).toBe(503)
    expect(sent.filter((s) => s.includes('"invoke"'))).toHaveLength(0)
  })

  it('a reconnected channel presenting a stale/invalid token is rejected, not grandfathered in', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      bridgeHandshakeTimeoutMs: 50,
      verifyBridgeSession: (token) =>
        token === 'good-token' ? { identity: token, grantVersion: 'g7' } : { identity: '' },
      reauthorizeBridgeInvoke: (binding) => ({
        identity: binding.identity,
        ...(binding.grantVersion ? { grantVersion: binding.grantVersion } : {}),
      }),
    })

    const first = makeFakeBridge(() => {})
    server.attachBridge(first)
    const nonce = server.issueBridgeNonce().nonce
    first.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        sessionToken: 'good-token',
        sessionIdentity: 'good-token',
        grantVersion: 'g7',
        nonce,
      }),
    )
    await Promise.resolve()
    await Promise.resolve()
    first.close()

    const sent: string[] = []
    const reconnected = makeFakeBridge((d) => sent.push(d))
    server.attachBridge(reconnected)
    reconnected.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        sessionToken: 'stale-token',
        sessionIdentity: 'stale-token',
        grantVersion: 'g7',
        nonce: server.issueBridgeNonce().nonce,
      }),
    )
    await Promise.resolve()
    await Promise.resolve()

    const res = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
    }
    expect(res.code).toBe(503)
    expect(res.error).toBe('BRIDGE_UNVERIFIED: BRIDGE_SESSION_INVALID: session verification failed')
    expect(sent.filter((s) => s.includes('"invoke"'))).toHaveLength(0)
  })

  it('a hello nonce can be consumed only once; a duplicate hello revokes that peer', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      bridgeHandshakeTimeoutMs: 50,
      verifyBridgeSession: (token) =>
        token === 'good-token' ? { identity: token, grantVersion: 'g7' } : { identity: '' },
      reauthorizeBridgeInvoke: (binding) => ({
        identity: binding.identity,
        ...(binding.grantVersion ? { grantVersion: binding.grantVersion } : {}),
      }),
    })
    const sent: string[] = []
    const bridge = makeFakeBridge((data) => sent.push(data))
    server.attachBridge(bridge)
    const nonce = server.issueBridgeNonce().nonce
    const hello = JSON.stringify({
      type: 'hello',
      protocol: BRIDGE_PROTOCOL_VERSION,
      sessionToken: 'good-token',
      sessionIdentity: 'good-token',
      grantVersion: 'g7',
      nonce,
    })
    bridge.reply(hello)
    await Promise.resolve()
    await Promise.resolve()
    bridge.reply(hello)

    const res = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
      error?: string
    }
    expect(res.code).toBe(403)
    expect(res.error).toBe('BRIDGE_REVOKED: bridge session binding changed')
    expect(sent.filter((s) => s.includes('"invoke"'))).toHaveLength(0)
  })

  it('a revoked grant is denied on the next invoke and never forwarded', async () => {
    const counter = makeCounter()
    let current = true
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      bridgeHandshakeTimeoutMs: 50,
      verifyBridgeSession: (token) =>
        token === 'good-token' ? { identity: token, grantVersion: 'g7' } : { identity: '' },
      reauthorizeBridgeInvoke: ({ identity, grantVersion }) =>
        current && identity === 'good-token' && grantVersion === 'g7'
          ? { identity, grantVersion }
          : false,
    })
    const sent: string[] = []
    const bridge = makeFakeBridge((data) => sent.push(data))
    server.attachBridge(bridge)
    bridge.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        sessionToken: 'good-token',
        sessionIdentity: 'good-token',
        grantVersion: 'g7',
        nonce: server.issueBridgeNonce().nonce,
      }),
    )
    await Promise.resolve()
    await Promise.resolve()
    current = false

    const res = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
      error?: string
    }
    expect(res.code).toBe(403)
    expect(res.error).toBe('BRIDGE_REVOKED: session or grant is no longer current')
    expect(sent.filter((s) => s.includes('"invoke"'))).toHaveLength(0)
  })

  it('a valid session without per-invoke reauthorization fails closed', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      bridgeHandshakeTimeoutMs: 50,
      verifyBridgeSession: (token) =>
        token === 'good-token' ? { identity: token, grantVersion: 'g7' } : { identity: '' },
    })
    const sent: string[] = []
    const bridge = makeFakeBridge((data) => sent.push(data))
    server.attachBridge(bridge)
    bridge.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        sessionToken: 'good-token',
        sessionIdentity: 'good-token',
        grantVersion: 'g7',
        nonce: server.issueBridgeNonce().nonce,
      }),
    )
    await Promise.resolve()
    await Promise.resolve()

    const res = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
      error?: string
    }
    expect(res.code).toBe(503)
    expect(res.error).toBe('BRIDGE_AUTH_UNAVAILABLE: per-invoke authorization is not configured')
    expect(sent.filter((s) => s.includes('"invoke"'))).toHaveLength(0)
  })

  it('a hello without its issued nonce is rejected with the specific handshake error', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      bridgeHandshakeTimeoutMs: 50,
      verifyBridgeSession: (token) =>
        token === 'good-token' ? { identity: token, grantVersion: 'g7' } : { identity: '' },
      reauthorizeBridgeInvoke: (binding) => ({
        identity: binding.identity,
        ...(binding.grantVersion ? { grantVersion: binding.grantVersion } : {}),
      }),
    })
    const sent: string[] = []
    const bridge = makeFakeBridge((data) => sent.push(data))
    server.attachBridge(bridge)
    bridge.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        sessionToken: 'good-token',
        sessionIdentity: 'good-token',
        grantVersion: 'g7',
      }),
    )

    const res = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
      error?: string
    }
    expect(res.code).toBe(503)
    expect(res.error).toBe(
      'BRIDGE_UNVERIFIED: BRIDGE_NONCE_INVALID: missing, unknown, expired, or replayed nonce',
    )
    expect(sent.filter((s) => s.includes('"invoke"'))).toHaveLength(0)
  })
})
