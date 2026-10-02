/**
 * `@aihu/agent-server` — `createAgentServer()` (T2).
 *
 * Glue that lets an external MCP client drive a *server-mounted* aihu component
 * through the already-tested live-dispatch runtime, and forwards only APPROVED
 * invocations to a connected browser bridge (the visible, authoritative
 * instance).
 *
 * Responsibilities:
 *  1. Mount the target component server-side (jsdom host) so its `LiveBinding`
 *     registers in arbor's `componentInstanceRegistry`.
 *  2. Build the agent-service via `createAgentService({ manifests:
 *     getAllAgentMetadata(), getRegistry: _getComponentInstanceRegistry, … })`.
 *  3. Run tool calls through `handleToolCall` (the 404→401→403→429 security
 *     gate — NOT re-implemented here) and, on approval only, forward the
 *     invocation to an attached browser bridge.
 *
 * The MCP protocol layer lives in `./mcp-server.ts` so the SDK import stays
 * lazy (server-side package, no `.size-limit.json` row).
 */

import { getAllAgentMetadata } from '@aihu/agent'
import type { Actor, RequestContext } from '@aihu/agent-service'
import { createAgentService, projectCapabilityResult } from '@aihu/agent-service'
import type { MountScope, Snapshot } from '@aihu/arbor'
import { _getComponentInstanceRegistry, mount } from '@aihu/arbor'
import { createBridgeNonceStore } from './bridge-nonce.ts'
import { opaqueActionIdForTool } from './opaque-id.ts'
import type {
  AgentServer,
  AgentServerOptions,
  BridgeChannel,
  BridgeClientMessage,
  BridgeInvokeMessage,
} from './types.ts'
import { BRIDGE_PROTOCOL_VERSION } from './types.ts'

/** A pending `callTool` whose result will arrive over the bridge. */
interface PendingBridgeCall {
  resolve(value: unknown): void
  reject(err: Error): void
}

/**
 * How long a `callTool` waits for an attached channel's `hello` before
 * refusing to delegate to it. Generous relative to a localhost WS round trip
 * (single-digit ms) so a normal attach/connect race never denies, short enough
 * that a channel which will never handshake fails fast and loudly.
 */
const DEFAULT_BRIDGE_HANDSHAKE_TIMEOUT_MS = 1000

/**
 * Detect a gate-rejection envelope from `handleToolCall`. The agent-service
 * returns `{ error, code, jsonrpc }` for 404/401/403/429 and `{ result }` on
 * success. We forward to the bridge ONLY when there is no rejection `code`.
 */
function isGateRejection(envelope: unknown): envelope is { error: string; code: number } {
  return (
    typeof envelope === 'object' &&
    envelope !== null &&
    typeof (envelope as { code?: unknown }).code === 'number'
  )
}

/**
 * Ensure a global DOM exists before arbor's `mount()` runs.
 *
 * Why: arbor's `mount`/`branch`/`leaf` materializers reach for the GLOBAL
 * `document` (`document.createElement`, `createTextNode`, `createComment`,
 * `createDocumentFragment`, `createElementNS`). Under plain Bun/Node there is no
 * `document`, so a server-side mount crashes with `ReferenceError: document is
 * not defined`. `@aihu/agent-server` is a server-side package (no
 * `.size-limit.json` row), so it owns the SSR-DOM internally rather than making
 * every consumer hand-wire `globalThis.document = new JSDOM(...).window.document`.
 *
 * Guard: we ONLY install globals when none exist. In a browser, or a test env
 * that already provides jsdom (vitest `environment: 'jsdom'`), `document` is
 * present and we leave it untouched — we never clobber a real DOM.
 *
 * `jsdom` is pulled in via a SYNCHRONOUS require so `createAgentServer` stays
 * synchronous. We obtain `createRequire` through `process.getBuiltinModule`
 * (Node/Bun) rather than a static `import 'node:module'`: this barrel also
 * re-exports the browser-side `createBridgeClient`, and a static `node:module`
 * import gets externalized by bundlers (Vite) into a stub that THROWS the moment
 * its binding is read at module-eval time — breaking the whole graph in the
 * browser. Resolving it lazily here (this function only runs server-side, gated
 * by the missing `document`) keeps the barrel browser-safe.
 */
function ensureServerDom(): void {
  if (typeof globalThis.document !== 'undefined') return
  const nodeModule = (
    globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }
  ).process?.getBuiltinModule?.('module') as
    | { createRequire(path: string | URL): NodeRequire }
    | undefined
  if (!nodeModule?.createRequire) {
    throw new Error(
      '@aihu/agent-server: no global `document` and could not load `jsdom` ' +
        '(process.getBuiltinModule unavailable). Provide `target.mount` or run on Node/Bun.',
    )
  }
  const require = nodeModule.createRequire(import.meta.url)
  const { JSDOM } = require('jsdom') as typeof import('jsdom')
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  const w = dom.window as unknown as Record<string, unknown>
  // Only the globals arbor's mount path actually reaches for. `document` is the
  // load-bearing one (all node creation flows through it); `window` is read
  // behind a `typeof window !== 'undefined'` guard in mount.ts.
  ;(globalThis as Record<string, unknown>).window = w
  ;(globalThis as Record<string, unknown>).document = w.document
}

/**
 * Create an {@link AgentServer}.
 *
 * @throws if neither `target.mount` nor `target.node` is given.
 */
export function createAgentServer(options: AgentServerOptions): AgentServer {
  const { target } = options
  const handshakeTimeoutMs = options.bridgeHandshakeTimeoutMs ?? DEFAULT_BRIDGE_HANDSHAKE_TIMEOUT_MS

  // ── Step 1: mount server-side so the LiveBinding registers ─────────────────
  let scope: MountScope
  if (target.mount) {
    scope = target.mount
  } else {
    if (!target.node) {
      throw new Error(
        '@aihu/agent-server: target must provide either `mount` or `node` (+ `agentBinding`).',
      )
    }
    // Stand up a server-side DOM (jsdom) if the runtime has none, so arbor's
    // `mount()` can create nodes. No-op when a real DOM already exists.
    ensureServerDom()
    // `createHost` is optional: default to a detached <div> in the ensured DOM.
    // An explicit `createHost` still wins (e.g. to mount into a specific host).
    const host = options.createHost ? options.createHost() : document.createElement('div')
    scope = mount(
      target.node,
      host,
      target.agentBinding ? { agentBinding: target.agentBinding } : undefined,
    )
  }

  // ── Step 2: build the agent-service over the live registry ─────────────────
  // manifests come from the global @aihu/agent registry (compiler-populated);
  // getRegistry is the live componentInstanceRegistry getter from arbor/mount.
  // The security gate lives entirely inside this service.
  const service = createAgentService({
    manifests: getAllAgentMetadata(),
    getRegistry: _getComponentInstanceRegistry,
    ...(options.authPlugin ? { authPlugin: options.authPlugin } : {}),
    ...(options.rateLimitPlugin ? { rateLimitPlugin: options.rateLimitPlugin } : {}),
    ...(options.resolveAuth ? { resolveAuth: options.resolveAuth } : {}),
    ...(options.actorResolver ? { actorResolver: options.actorResolver } : {}),
    ...(options.authorizeDataRead ? { authorizeDataRead: options.authorizeDataRead } : {}),
    ...(options.authDiscoveryUrl ? { authDiscoveryUrl: options.authDiscoveryUrl } : {}),
  })

  // ── Bridge state ───────────────────────────────────────────────────────────
  let bridge: BridgeChannel | null = null
  let detachBridge: (() => void) | null = null
  const pending = new Map<string, PendingBridgeCall>()
  let lastBridgeSnapshot: Snapshot | null = null
  const bridgeNonces = createBridgeNonceStore()
  let verifiedSessionToken: string | undefined
  let verifiedGrantVersion: string | undefined
  let helloSeen = false
  let peerRevoked = false

  // ── Bridge handshake state (thesis §3: the client is never the authority) ──
  //
  // `BRIDGE_PROTOCOL_VERSION` was defined, sent by the client, imported by the
  // server, and re-exported — but never once appeared on the right-hand side of
  // a comparison anywhere in the tree. The constant existed for a check nobody
  // wrote, so `attachBridge` accepted ANY channel and `callTool` would delegate
  // execution to it. An unverified channel that receives `invoke` frames IS the
  // execution authority; letting it become one without proving which protocol
  // it speaks is the thesis §3 failure mode "a check that is structurally
  // always-true", in its most literal form — a check that does not exist.
  //
  // Verification is a precondition for DELEGATION only. It is deliberately NOT
  // a precondition for the no-bridge path below (headless/CI dispatch), which
  // has no channel to verify and must keep working untouched.
  type HandshakeState = 'pending' | 'verified' | 'rejected'
  let handshake: HandshakeState = 'pending'
  let handshakeReason = ''
  /** Woken when `handshake` leaves `'pending'`. */
  let handshakeWaiters: Array<() => void> = []

  function settleHandshake(state: 'verified' | 'rejected', reason: string): void {
    if (handshake !== 'pending') return
    handshake = state
    handshakeReason = reason
    const waiters = handshakeWaiters
    handshakeWaiters = []
    for (const w of waiters) w()
  }

  /**
   * Validate a `hello` frame's protocol field.
   *
   * Strict: the value must be a finite `number` EQUAL to
   * {@link BRIDGE_PROTOCOL_VERSION}. `BridgeHelloMessage.protocol` is typed
   * `number`, but this value arrives as untyped JSON off a socket, so the
   * runtime `typeof` guard is load-bearing rather than redundant — `"1"`, `null`
   * and `NaN` are all rejected here, not coerced into agreement.
   */
  function checkHelloProtocol(raw: unknown): { ok: true } | { ok: false; reason: string } {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return {
        ok: false,
        reason:
          `bridge client sent a non-numeric protocol value (${JSON.stringify(raw)}); ` +
          `expected ${BRIDGE_PROTOCOL_VERSION}`,
      }
    }
    if (raw !== BRIDGE_PROTOCOL_VERSION) {
      return {
        ok: false,
        reason: `bridge protocol mismatch: client speaks ${raw}, server speaks ${BRIDGE_PROTOCOL_VERSION}`,
      }
    }
    return { ok: true }
  }

  function handleBridgeFrame(data: string, peer: BridgeChannel): void {
    if (bridge !== peer) return
    let msg: BridgeClientMessage
    try {
      msg = JSON.parse(data) as BridgeClientMessage
    } catch {
      return // ignore malformed frames
    }
    // Until the channel has proved its protocol, `hello` is the ONLY frame it
    // may send. Honouring `result`/`error`/`snapshot` from an unverified peer
    // would let it resolve calls and overwrite `serialize()` state without ever
    // having identified itself.
    if (handshake !== 'verified' && msg.type !== 'hello') return
    switch (msg.type) {
      case 'hello': {
        if (helloSeen) {
          peerRevoked = true
          handshake = 'rejected'
          handshakeReason = 'BRIDGE_REPLAY: duplicate hello on an established peer'
          rejectAllPending(handshakeReason)
          return
        }
        helloSeen = true
        const verdict = checkHelloProtocol((msg as { protocol?: unknown }).protocol)
        if (!verdict.ok) {
          settleHandshake('rejected', verdict.reason)
          return
        }
        const hello = msg as Extract<BridgeClientMessage, { type: 'hello' }>
        if (!bridgeNonces.consume(hello.nonce)) {
          settleHandshake(
            'rejected',
            'BRIDGE_NONCE_INVALID: missing, unknown, expired, or replayed nonce',
          )
          return
        }
        if (typeof hello.sessionToken !== 'string' || !options.verifyBridgeSession) {
          settleHandshake(
            'rejected',
            'BRIDGE_SESSION_UNVERIFIED: session verifier and token are required',
          )
          return
        }
        Promise.resolve()
          .then(() => options.verifyBridgeSession!(hello.sessionToken!))
          .then(
            (ok) => {
              if (bridge !== peer || handshake !== 'pending') return
              if (!ok) {
                settleHandshake('rejected', 'BRIDGE_SESSION_INVALID: session verification failed')
                return
              }
              verifiedSessionToken = hello.sessionToken
              verifiedGrantVersion =
                typeof hello.grantVersion === 'string' ? hello.grantVersion : undefined
              settleHandshake('verified', '')
            },
            () => {
              if (bridge === peer && handshake === 'pending') {
                settleHandshake('rejected', 'BRIDGE_SESSION_INVALID: session verification failed')
              }
            },
          )
        return
      }
      case 'snapshot':
        lastBridgeSnapshot = msg.snapshot
        if (msg.callId) {
          const p = pending.get(msg.callId)
          // A snapshot alone does not resolve a call — we wait for result/error.
          // (kept for read-only viewers / spontaneous state pushes.)
          void p
        }
        return
      case 'result': {
        const p = pending.get(msg.callId)
        if (p) {
          pending.delete(msg.callId)
          p.resolve(msg.result)
        }
        return
      }
      case 'error': {
        const p = pending.get(msg.callId)
        if (p) {
          pending.delete(msg.callId)
          p.reject(new Error(msg.message))
        }
        return
      }
    }
  }

  function rejectAllPending(reason: string): void {
    for (const [, p] of pending) p.reject(new Error(reason))
    pending.clear()
  }

  /**
   * Wait for the attached channel to complete its handshake.
   *
   * A bounded wait rather than an instantaneous check, because `attachBridge`
   * and the client's `hello` are inherently racy over a real socket: the demo
   * server attaches the channel and an agent may call a tool before the first
   * frame has crossed the wire. Failing instantly there would turn a normal
   * startup race into a spurious denial. The wait is bounded so an unverified
   * channel produces a prompt, loud 503 instead of hanging — a bridge that
   * hangs looks like infrastructure flake; one that denies looks like the
   * defect it is.
   *
   * A `rejected` handshake short-circuits: there is nothing left to wait for.
   */
  function awaitHandshake(): Promise<HandshakeState> {
    if (handshake !== 'pending') return Promise.resolve(handshake)
    return new Promise<HandshakeState>((resolve) => {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(handshake)
      }
      const timer = setTimeout(() => {
        settleHandshake(
          'rejected',
          `bridge client sent no \`hello\` within ${handshakeTimeoutMs}ms; ` +
            'an unverified channel is not delegated to',
        )
        finish()
      }, handshakeTimeoutMs)
      // `unref` where available so a pending handshake timer never holds a
      // Node/Bun process (or a vitest worker) open past its work.
      ;(timer as unknown as { unref?: () => void }).unref?.()
      handshakeWaiters.push(finish)
    })
  }

  function attachBridge(channel: BridgeChannel): () => void {
    // Replace any prior bridge.
    detachBridge?.()
    bridge = channel
    // A new channel is a new peer: it must prove its protocol on its own, and
    // must never inherit the previous channel's verified status.
    handshake = 'pending'
    handshakeReason = ''
    handshakeWaiters = []
    verifiedSessionToken = undefined
    verifiedGrantVersion = undefined
    helloSeen = false
    peerRevoked = false
    const offMsg = channel.onMessage((data) => handleBridgeFrame(data, channel))
    const offClose = channel.onClose(() => {
      rejectAllPending('bridge disconnected')
      if (bridge === channel) bridge = null
    })
    detachBridge = () => {
      offMsg()
      offClose()
      if (bridge === channel) bridge = null
      detachBridge = null
    }
    return detachBridge
  }

  /**
   * Forward an approved invocation to the bridge and await the browser's reply
   * (the visible instance's result). If the bridge is disconnected mid-flight
   * the promise rejects (loud failure, per the plan's failure modes).
   */
  function forwardToBridge(opaqueActionId: string, args: unknown[]): Promise<unknown> {
    if (!bridge?.connected) {
      return Promise.resolve(undefined)
    }
    const callId = crypto.randomUUID()
    const frame: BridgeInvokeMessage = { type: 'invoke', callId, opaqueActionId, args }
    return new Promise<unknown>((resolve, reject) => {
      pending.set(callId, { resolve, reject })
      try {
        bridge!.send(JSON.stringify(frame))
      } catch (err) {
        pending.delete(callId)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  // ── callTool: bridge attached → gate-only + delegate; else server dispatch ─
  async function callTool(
    toolName: string,
    params: unknown,
    ctx?: RequestContext,
  ): Promise<unknown> {
    const args = Array.isArray(params)
      ? params
      : params !== null && params !== undefined
        ? [params]
        : []

    if (bridge?.connected) {
      // Capability-bridge topology: the VISIBLE browser instance is
      // authoritative. Gate on the server (policy authority) but do NOT
      // dispatch on the server-mounted twin — that would double-execute side
      // effects and reintroduce the projection drift the bridge exists to
      // avoid. Execution is delegated to the browser via the opaque-ID
      // dispatcher; the gate carries no policy info onto the wire.
      const verdict = await service.authorize(toolName, params, ctx)
      if (isGateRejection(verdict)) return verdict
      const projection =
        typeof verdict === 'object' &&
        verdict !== null &&
        Array.isArray((verdict as { projection?: unknown }).projection)
          ? (verdict as { projection: readonly string[] }).projection
          : undefined
      const actor =
        typeof verdict === 'object' &&
        verdict !== null &&
        typeof (verdict as { actor?: unknown }).actor === 'object'
          ? (verdict as { actor: Actor }).actor
          : undefined

      // The agent-service gate has approved the CALL; this verifies the
      // CHANNEL. Deliberately ordered after `authorize` so the security
      // ordering invariant (404 → 401 → 403 → 429) still wins: an unauthorized
      // call is refused for its own reason, not masked by a transport error,
      // and is still never forwarded.
      if ((await awaitHandshake()) !== 'verified' || peerRevoked) {
        return { error: `BRIDGE_UNVERIFIED: ${handshakeReason}`, code: 503 }
      }

      if (!options.reauthorizeBridgeInvoke) {
        return {
          error: 'BRIDGE_AUTH_UNAVAILABLE: per-invoke authorization is not configured',
          code: 503,
        }
      }
      let reauthorized = false
      try {
        reauthorized = await options.reauthorizeBridgeInvoke({
          ...(verifiedSessionToken !== undefined ? { sessionToken: verifiedSessionToken } : {}),
          ...(verifiedGrantVersion !== undefined ? { grantVersion: verifiedGrantVersion } : {}),
          ...(actor !== undefined ? { actor } : {}),
        })
      } catch {
        return { error: 'BRIDGE_AUTH_UNAVAILABLE: per-invoke authorization failed', code: 503 }
      }
      if (!reauthorized)
        return { error: 'BRIDGE_REVOKED: session or grant is no longer current', code: 403 }

      const opaqueActionId = opaqueActionIdForTool(toolName)
      if (!opaqueActionId) return { error: `bad tool: ${toolName}`, code: 400 }

      try {
        const bridgeResult = await forwardToBridge(opaqueActionId, args)
        return { result: projectCapabilityResult(bridgeResult ?? null, projection) }
      } catch (err) {
        // WS-disconnect mid-drive must be surfaced, not silently dropped.
        return {
          error: `BRIDGE_ERROR: ${err instanceof Error ? err.message : String(err)}`,
          code: 503,
        }
      }
    }

    // No bridge (headless / CI): gate + dispatch on the server-mounted instance.
    return service.handleToolCall(toolName, params, ctx)
  }

  function serialize(): Snapshot {
    return lastBridgeSnapshot ?? scope.serialize()
  }

  function dispose(): void {
    detachBridge?.()
    rejectAllPending('agent server disposed')
    scope.dispose()
  }

  return {
    service,
    mount: scope,
    callTool,
    serialize,
    attachBridge,
    issueBridgeNonce: (ttlMs?: number) => bridgeNonces.issue(ttlMs),
    dispose,
  }
}

export { BRIDGE_PROTOCOL_VERSION }
