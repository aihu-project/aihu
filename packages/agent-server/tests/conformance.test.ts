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
    expect(denied.error).toBe('BRIDGE_UNVERIFIED: BRIDGE_HELLO_INVALID: hello verification failed')
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

  it('ignores verification from an earlier attachment of the same channel object', async () => {
    const counter = makeCounter()
    let finishVerification!: (value: { identity: string }) => void
    let verificationStarted!: () => void
    const started = new Promise<void>((resolve) => {
      verificationStarted = resolve
    })
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      bridgeHandshakeTimeoutMs: 10,
      bridgeCallTimeoutMs: 15,
      verifyBridgeSession: () =>
        new Promise((resolve) => {
          verificationStarted()
          finishVerification = resolve
        }),
      reauthorizeBridgeInvoke: (binding) => ({ identity: binding.identity }),
    })
    const frames: string[] = []
    const bridge = makeFakeBridge((frame) => frames.push(frame))
    const detach = server.attachBridge(bridge)
    bridge.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        nonce: server.issueBridgeNonce().nonce,
        sessionToken: 'old',
        sessionIdentity: 'old',
      }),
    )
    await started
    detach()
    server.attachBridge(bridge)
    finishVerification({ identity: 'old' })
    const denied = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
      error?: string
    }
    expect(denied.code).toBe(503)
    expect(frames.filter((frame) => frame.includes('"invoke"'))).toHaveLength(0)
  })

  it('redacts peer values from malformed and mismatched hello errors', async () => {
    for (const hello of [
      { protocol: 'peer-marker-protocol' },
      { protocol: BRIDGE_PROTOCOL_VERSION, nonce: 'peer-marker-nonce' },
      { protocol: BRIDGE_PROTOCOL_VERSION, nonce: null, sessionToken: 'peer-marker-token' },
    ]) {
      const counter = makeCounter()
      const server = spawn({
        target: { node: counter.node, agentBinding: counter.agentBinding },
        createHost: host,
        bridgeHandshakeTimeoutMs: 5,
        verifyBridgeSession: (token) => ({ identity: token }),
        reauthorizeBridgeInvoke: (binding) => ({ identity: binding.identity }),
      })
      const bridge = makeFakeBridge(() => {})
      server.attachBridge(bridge)
      bridge.reply(JSON.stringify({ type: 'hello', ...hello }))
      const result = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
        code?: number
        error?: string
      }
      expect(result.code).toBe(503)
      expect(result.error).toBe(
        'BRIDGE_UNVERIFIED: BRIDGE_HELLO_INVALID: hello verification failed',
      )
      expect(JSON.stringify(result)).not.toContain('peer-marker')
      server.dispose()
    }
  })

  it('revocation rejects an in-flight call immediately and withholds action results', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      verifyBridgeSession: (token) => ({ identity: token }),
      reauthorizeBridgeInvoke: (binding) => ({ identity: binding.identity }),
    })
    const frames: string[] = []
    const bridge = makeFakeBridge((frame) => frames.push(frame))
    server.attachBridge(bridge)
    bridge.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        nonce: server.issueBridgeNonce().nonce,
        sessionToken: 'identity-a',
        sessionIdentity: 'identity-a',
      }),
    )
    await Promise.resolve()
    await Promise.resolve()
    const pending = server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const invoke = JSON.parse(frames.find((frame) => frame.includes('"invoke"'))!) as {
      callId: string
    }
    server.revokeBridgeSession('identity-a')
    const denied = (await pending) as { code?: number; error?: string }
    expect(denied.code).toBe(403)
    expect(denied.error).toBe('BRIDGE_RESULT_WITHHELD: action may have executed; result withheld')
    bridge.reply(JSON.stringify({ type: 'result', callId: invoke.callId, result: 'secret-marker' }))
    expect(await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })).toMatchObject({
      code: 403,
      error: 'BRIDGE_REVOKED: bridge session was revoked',
    })
  })

  it('denies revoked state reads after forwarding without returning protected data', async () => {
    const counter = makeCounter()
    let authorized = true
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      authPlugin: {
        verify: async (token: string) => (token === 'valid-jwt' ? { sub: 'user-1' } : null),
        checkScope: () => true,
      },
      actorResolver: {
        resolveActor: (principal) => ({
          kind: 'human',
          subject: principal.sub ?? 'user-1',
          organizationId: 'org-1',
          scopes: [],
          issuer: null,
          audience: null,
          grantId: 'grant-1',
          grantVersion: 'g1',
        }),
      },
      authorizeDataRead: () => ({ granted: true, projection: ['count'] }),
      verifyBridgeSession: (token) => ({ identity: token }),
      reauthorizeBridgeInvoke: (binding) => (authorized ? { identity: binding.identity } : false),
    })
    const bridge = makeFakeBridge((frame) => {
      const message = JSON.parse(frame) as { type?: string; callId?: string }
      if (message.type === 'invoke' && message.callId) {
        authorized = false
        bridge.reply(
          JSON.stringify({
            type: 'result',
            callId: message.callId,
            result: { count: 42, secret: 'protected' },
          }),
        )
      }
    })
    server.attachBridge(bridge)
    bridge.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        nonce: server.issueBridgeNonce().nonce,
        sessionToken: 'identity-read',
        sessionIdentity: 'identity-read',
      }),
    )
    await Promise.resolve()
    await Promise.resolve()
    const result = (await server.callTool(`${TAG}/count`, [], {
      userId: 'user-1',
      jwt: 'valid-jwt',
    })) as {
      code?: number
      error?: string
      result?: unknown
    }
    expect(result.code).toBe(403)
    expect(result.error).toBe('BRIDGE_REVOKED: session or grant is no longer current')
    expect(result.result).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain('protected')
  })

  it('returns the withheld-result code when post-forward reauthorization times out', async () => {
    const counter = makeCounter()
    let calls = 0
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      securityHookTimeoutMs: 5,
      verifyBridgeSession: (token) => ({ identity: token }),
      reauthorizeBridgeInvoke: (binding) =>
        ++calls === 1 ? { identity: binding.identity } : new Promise(() => {}),
    })
    const bridge = makeFakeBridge((frame) => {
      const message = JSON.parse(frame) as { type?: string; callId?: string }
      if (message.type === 'invoke' && message.callId)
        bridge.reply(JSON.stringify({ type: 'result', callId: message.callId, result: 'done' }))
    })
    server.attachBridge(bridge)
    bridge.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        nonce: server.issueBridgeNonce().nonce,
        sessionToken: 'identity-timeout',
        sessionIdentity: 'identity-timeout',
      }),
    )
    await Promise.resolve()
    await Promise.resolve()
    const result = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
      error?: string
    }
    expect(result.code).toBe(403)
    expect(result.error).toBe('BRIDGE_RESULT_WITHHELD: action may have executed; result withheld')
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
    expect(cancelled.error).toBe(
      'BRIDGE_RESULT_WITHHELD: action may have executed; result withheld',
    )
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
    expect(denied.code).toBe(403)
    expect(denied.error).toBe('BRIDGE_RESULT_WITHHELD: action may have executed; result withheld')
    expect(sent.some((frame) => frame.includes('"invoke"'))).toBe(true)
  })

  it('withholds action outcomes after a bridge error frame', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      verifyBridgeSession: (token) => ({ identity: token }),
      reauthorizeBridgeInvoke: (binding) => ({ identity: binding.identity }),
    })
    const bridge = makeFakeBridge((frame) => {
      const message = JSON.parse(frame) as { type?: string; callId?: string }
      if (message.type === 'invoke' && message.callId)
        bridge.reply(JSON.stringify({ type: 'error', callId: message.callId, error: 'peer error' }))
    })
    server.attachBridge(bridge)
    bridge.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        nonce: server.issueBridgeNonce().nonce,
        sessionToken: 'identity-error',
        sessionIdentity: 'identity-error',
      }),
    )
    await Promise.resolve()
    await Promise.resolve()
    const result = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
      error?: string
    }
    expect(result.code).toBe(403)
    expect(result.error).toBe('BRIDGE_RESULT_WITHHELD: action may have executed; result withheld')
  })

  it('withholds action outcomes after bridge disconnect', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      verifyBridgeSession: (token) => ({ identity: token }),
      reauthorizeBridgeInvoke: (binding) => ({ identity: binding.identity }),
    })
    let bridge!: ReturnType<typeof makeFakeBridge>
    bridge = makeFakeBridge((frame) => {
      if (frame.includes('"invoke"')) bridge.close()
    })
    server.attachBridge(bridge)
    bridge.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        nonce: server.issueBridgeNonce().nonce,
        sessionToken: 'identity-disconnect',
        sessionIdentity: 'identity-disconnect',
      }),
    )
    await Promise.resolve()
    await Promise.resolve()
    const result = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
      error?: string
    }
    expect(result.code).toBe(403)
    expect(result.error).toBe('BRIDGE_RESULT_WITHHELD: action may have executed; result withheld')
  })

  it('treats a literal wildcard grant version as an exact revocation', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      bridgeCallTimeoutMs: 25,
      verifyBridgeSession: (token) => ({
        identity: 'identity-shared',
        grantVersion: token === 'token-star' ? '*' : 'v2',
      }),
      reauthorizeBridgeInvoke: (binding) => ({
        identity: binding.identity,
        grantVersion: binding.grantVersion,
      }),
    })
    const attach = async (token: string, grantVersion: string) => {
      const frames: string[] = []
      const bridge = makeFakeBridge((frame) => {
        frames.push(frame)
        const message = JSON.parse(frame) as { type?: string; callId?: string }
        if (message.type === 'invoke' && message.callId)
          bridge.reply(JSON.stringify({ type: 'result', callId: message.callId, result: 'ok' }))
      })
      server.attachBridge(bridge)
      bridge.reply(
        JSON.stringify({
          type: 'hello',
          protocol: BRIDGE_PROTOCOL_VERSION,
          nonce: server.issueBridgeNonce().nonce,
          sessionToken: token,
          sessionIdentity: 'identity-shared',
          grantVersion,
        }),
      )
      await Promise.resolve()
      await Promise.resolve()
      return { bridge, frames }
    }
    await attach('token-star', '*')
    await new Promise((resolve) => setTimeout(resolve, 0))
    server.revokeBridgeSession('identity-shared', { grantVersion: '*' })
    const starDenied = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
      error?: string
    }
    expect(starDenied.code).toBe(403)
    expect(starDenied.error).toBe('BRIDGE_REVOKED: bridge session was revoked')
    const other = await attach('token-v2', 'v2')
    const allowed = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      result?: string
      error?: string
    }
    expect(other.frames.some((frame) => frame.includes('"invoke"'))).toBe(true)
    expect(allowed.result).toBe('ok')
    expect(allowed.error).toBeUndefined()
  })

  it('expires revocations after their configured TTL', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      bridgeRevocationTtlMs: 10,
      bridgeRevocationMaxEntries: 1,
      bridgeCallTimeoutMs: 10,
      verifyBridgeSession: (token) => ({ identity: token, grantVersion: 'v1' }),
      reauthorizeBridgeInvoke: (binding) => ({
        identity: binding.identity,
        grantVersion: binding.grantVersion,
      }),
    })
    server.revokeBridgeSession('expired', { grantVersion: 'v1' })
    await new Promise((resolve) => setTimeout(resolve, 15))
    const expiredBridge = makeFakeBridge(() => {})
    server.attachBridge(expiredBridge)
    expiredBridge.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        nonce: server.issueBridgeNonce().nonce,
        sessionToken: 'expired',
        sessionIdentity: 'expired',
        grantVersion: 'v1',
      }),
    )
    const expiredResult = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
      error?: string
    }
    expect(expiredResult.code).toBe(403)
    expect(expiredResult.error).toBe(
      'BRIDGE_RESULT_WITHHELD: action may have executed; result withheld',
    )
  })

  it('evicts the oldest revocation when the configured cap is reached', async () => {
    const counter = makeCounter()
    const capped = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      bridgeRevocationTtlMs: 10_000,
      bridgeRevocationMaxEntries: 1,
      bridgeCallTimeoutMs: 10,
      verifyBridgeSession: (token) => ({ identity: token, grantVersion: 'v1' }),
      reauthorizeBridgeInvoke: (binding) => ({
        identity: binding.identity,
        grantVersion: binding.grantVersion,
      }),
    })
    capped.revokeBridgeSession('oldest', { grantVersion: 'v1' })
    capped.revokeBridgeSession('newest', { grantVersion: 'v1' })
    const oldestBridge = makeFakeBridge((frame) => {
      const message = JSON.parse(frame) as { type?: string; callId?: string }
      if (message.type === 'invoke' && message.callId)
        oldestBridge.reply(JSON.stringify({ type: 'result', callId: message.callId, result: 'ok' }))
    })
    capped.attachBridge(oldestBridge)
    oldestBridge.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        nonce: capped.issueBridgeNonce().nonce,
        sessionToken: 'oldest',
        sessionIdentity: 'oldest',
        grantVersion: 'v1',
      }),
    )
    await Promise.resolve()
    await Promise.resolve()
    const oldestResult = (await capped.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      result?: string
      error?: string
    }
    expect(oldestResult.result).toBe('ok')
    expect(oldestResult.error).toBeUndefined()
    const newestBridge = makeFakeBridge(() => {})
    capped.attachBridge(newestBridge)
    newestBridge.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        nonce: capped.issueBridgeNonce().nonce,
        sessionToken: 'newest',
        sessionIdentity: 'newest',
        grantVersion: 'v1',
      }),
    )
    const newestResult = (await capped.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
      error?: string
    }
    expect(newestResult.code).toBe(503)
    expect(newestResult.error).toBe(
      'BRIDGE_UNVERIFIED: BRIDGE_HELLO_INVALID: hello verification failed',
    )
  })

  it('commits protocol denial before running a throwing diagnostic hook', async () => {
    const counter = makeCounter()
    let calls = 0
    let captured: unknown
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      bridgeHandshakeTimeoutMs: 5,
      verifyBridgeSession: (token) => ({ identity: token }),
      reauthorizeBridgeInvoke: (binding) => ({ identity: binding.identity }),
      onBridgeDiagnostic: async (diagnostic) => {
        calls += 1
        captured = diagnostic
        throw new Error('diagnostic failure')
      },
    })
    const bridge = makeFakeBridge(() => {})
    server.attachBridge(bridge)
    bridge.reply(JSON.stringify({ type: 'hello', protocol: -1, nonce: 'marker-token' }))
    const result = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
      error?: string
    }
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    process.off('unhandledRejection', onUnhandled)
    expect(result.code).toBe(503)
    expect(result.error).toBe('BRIDGE_UNVERIFIED: BRIDGE_HELLO_INVALID: hello verification failed')
    expect(calls).toBeGreaterThan(0)
    expect(unhandled).toEqual([])
    expect(Object.isFrozen(captured)).toBe(true)
  })

  it('keeps a diagnostic reattachment from rejecting the replacement handshake', async () => {
    const counter = makeCounter()
    let server!: AgentServer
    let replacement!: ReturnType<typeof makeFakeBridge>
    server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      verifyBridgeSession: (token) => ({ identity: token }),
      reauthorizeBridgeInvoke: (binding) => ({ identity: binding.identity }),
      onBridgeDiagnostic: ({ event }) => {
        if (event !== 'hello.protocol.mismatch') return
        replacement = makeFakeBridge((frame) => {
          const message = JSON.parse(frame) as { type?: string; callId?: string }
          if (message.type === 'invoke' && message.callId)
            replacement.reply(
              JSON.stringify({ type: 'result', callId: message.callId, result: 'replacement-ok' }),
            )
        })
        server.attachBridge(replacement)
        replacement.reply(
          JSON.stringify({
            type: 'hello',
            protocol: BRIDGE_PROTOCOL_VERSION,
            nonce: server.issueBridgeNonce().nonce,
            sessionToken: 'replacement',
            sessionIdentity: 'replacement',
          }),
        )
      },
    })
    const original = makeFakeBridge(() => {})
    server.attachBridge(original)
    const originalCall = server.callTool(`${TAG}/increment`, [1], { userId: 'u1' }) as Promise<{
      code?: number
      error?: string
    }>
    original.reply(JSON.stringify({ type: 'hello', protocol: -1 }))
    const originalResult = await originalCall
    expect(originalResult.code).toBe(503)
    expect(originalResult.error).toBe(
      'BRIDGE_REPLACED: bridge attachment changed during authorization',
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    const replacementResult = (await server.callTool(`${TAG}/increment`, [1], {
      userId: 'u1',
    })) as {
      result?: string
      error?: string
    }
    expect(replacementResult.result).toBe('replacement-ok')
    expect(replacementResult.error).toBeUndefined()
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
    expect(res.error).toBe('BRIDGE_UNVERIFIED: BRIDGE_HELLO_INVALID: hello verification failed')
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
    expect(res.error).toBe('BRIDGE_UNVERIFIED: BRIDGE_HELLO_INVALID: hello verification failed')
    expect(sent.filter((s) => s.includes('"invoke"'))).toHaveLength(0)
  })
})
