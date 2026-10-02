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
import {
  createAgentService,
  projectCapabilityResult,
  withSecurityTimeout,
} from '@aihu/agent-service'
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
  identity: string
  grantVersion?: string
  readOnly: boolean
  timer?: ReturnType<typeof setTimeout>
}

/**
 * How long a `callTool` waits for an attached channel's `hello` before
 * refusing to delegate to it. Generous relative to a localhost WS round trip
 * (single-digit ms) so a normal attach/connect race never denies, short enough
 * that a channel which will never handshake fails fast and loudly.
 */
const DEFAULT_BRIDGE_HANDSHAKE_TIMEOUT_MS = 1000
const DEFAULT_SECURITY_HOOK_TIMEOUT_MS = 5_000

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
    securityHookTimeoutMs: options.securityHookTimeoutMs ?? DEFAULT_SECURITY_HOOK_TIMEOUT_MS,
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
  let verifiedIdentity: string | undefined
  let helloSeen = false
  let peerRevoked = false
  const revokedBindings = new Map<string, Set<string>>()
  const isBindingRevoked = (identity: string, grantVersion?: string): boolean => {
    const revoked = revokedBindings.get(identity)
    return revoked?.has('*') === true || revoked?.has(grantVersion ?? '') === true
  }
  let attachmentGeneration = 0

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

  function diagnose(event: string, detail?: unknown): void {
    try {
      options.onBridgeDiagnostic?.({ event, ...(detail !== undefined ? { detail } : {}) })
    } catch {
      // Diagnostics are host-side only and cannot change authorization outcomes.
    }
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
      diagnose('hello.protocol.invalid', raw)
      return { ok: false, reason: 'BRIDGE_HELLO_INVALID: hello verification failed' }
    }
    if (raw !== BRIDGE_PROTOCOL_VERSION) {
      diagnose('hello.protocol.mismatch', raw)
      return { ok: false, reason: 'BRIDGE_HELLO_INVALID: hello verification failed' }
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
          handshakeReason = 'BRIDGE_HELLO_INVALID: hello verification failed'
          diagnose('hello.duplicate')
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
        if (!bridgeNonces.consume(hello.nonce, String(attachmentGeneration))) {
          diagnose('hello.nonce.invalid', hello.nonce)
          settleHandshake('rejected', 'BRIDGE_HELLO_INVALID: hello verification failed')
          return
        }
        if (typeof hello.sessionToken !== 'string' || !options.verifyBridgeSession) {
          diagnose('hello.session.invalid', { sessionToken: hello.sessionToken })
          settleHandshake('rejected', 'BRIDGE_HELLO_INVALID: hello verification failed')
          return
        }
        const verificationGeneration = attachmentGeneration
        Promise.resolve()
          .then(() =>
            withSecurityTimeout(
              options.verifyBridgeSession!(hello.sessionToken!),
              options.securityHookTimeoutMs ?? DEFAULT_SECURITY_HOOK_TIMEOUT_MS,
            ),
          )
          .then(
            (verified) => {
              if (
                bridge !== peer ||
                attachmentGeneration !== verificationGeneration ||
                handshake !== 'pending'
              )
                return
              if (
                !verified ||
                typeof verified !== 'object' ||
                typeof verified.identity !== 'string' ||
                verified.identity.length === 0 ||
                hello.sessionIdentity !== verified.identity ||
                (verified.grantVersion ?? undefined) !== (hello.grantVersion ?? undefined)
              ) {
                diagnose('hello.session.mismatch', {
                  sessionIdentity: hello.sessionIdentity,
                  grantVersion: hello.grantVersion,
                })
                settleHandshake('rejected', 'BRIDGE_HELLO_INVALID: hello verification failed')
                return
              }
              if (isBindingRevoked(verified.identity, verified.grantVersion)) {
                settleHandshake('rejected', 'BRIDGE_HELLO_INVALID: hello verification failed')
                return
              }
              verifiedSessionToken = hello.sessionToken
              verifiedIdentity = verified.identity
              verifiedGrantVersion = verified.grantVersion
              settleHandshake('verified', '')
            },
            () => {
              if (
                bridge === peer &&
                attachmentGeneration === verificationGeneration &&
                handshake === 'pending'
              ) {
                diagnose('hello.session.verification_failed')
                settleHandshake('rejected', 'BRIDGE_HELLO_INVALID: hello verification failed')
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
          if (p.timer !== undefined) clearTimeout(p.timer)
          p.resolve(msg.result)
        }
        return
      }
      case 'error': {
        const p = pending.get(msg.callId)
        if (p) {
          pending.delete(msg.callId)
          if (p.timer !== undefined) clearTimeout(p.timer)
          p.reject(new Error('BRIDGE_ACTION_FAILED: Bridge action failed'))
        }
        return
      }
    }
  }

  function rejectAllPending(reason: string): void {
    for (const [, p] of pending) {
      if (p.timer !== undefined) clearTimeout(p.timer)
      p.reject(new Error(reason))
    }
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
  function awaitHandshake(expectedGeneration: number): Promise<HandshakeState> {
    if (attachmentGeneration !== expectedGeneration) return Promise.resolve('rejected')
    if (handshake !== 'pending') return Promise.resolve(handshake)
    return new Promise<HandshakeState>((resolve) => {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(attachmentGeneration === expectedGeneration ? handshake : 'rejected')
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
    rejectAllPending('BRIDGE_REPLACED: bridge attachment was replaced')
    for (const wake of handshakeWaiters) wake()
    detachBridge?.()
    attachmentGeneration += 1
    bridge = channel
    // A new channel is a new peer: it must prove its protocol on its own, and
    // must never inherit the previous channel's verified status.
    handshake = 'pending'
    handshakeReason = ''
    handshakeWaiters = []
    verifiedSessionToken = undefined
    verifiedIdentity = undefined
    verifiedGrantVersion = undefined
    helloSeen = false
    peerRevoked = false
    const offMsg = channel.onMessage((data) => handleBridgeFrame(data, channel))
    const offClose = channel.onClose(() => {
      if (bridge === channel) {
        attachmentGeneration += 1
        rejectAllPending('BRIDGE_DETACHED: bridge disconnected')
        for (const wake of handshakeWaiters) wake()
        bridge = null
      }
    })
    detachBridge = () => {
      offMsg()
      offClose()
      if (bridge === channel) {
        attachmentGeneration += 1
        rejectAllPending('BRIDGE_DETACHED: bridge disconnected')
        for (const wake of handshakeWaiters) wake()
        bridge = null
      }
      detachBridge = null
    }
    return detachBridge
  }

  function revokeBridgeSession(identity: string, grantVersion?: string): void {
    const revoked = revokedBindings.get(identity) ?? new Set<string>()
    revoked.add(grantVersion ?? '*')
    revokedBindings.set(identity, revoked)
    if (
      verifiedIdentity === identity &&
      (grantVersion === undefined || verifiedGrantVersion === grantVersion)
    ) {
      peerRevoked = true
      handshake = 'rejected'
      handshakeReason = 'BRIDGE_REVOKED: bridge session was revoked'
      for (const wake of handshakeWaiters) wake()
      handshakeWaiters = []
    }
    for (const [callId, call] of pending) {
      if (
        call.identity !== identity ||
        (grantVersion !== undefined && call.grantVersion !== grantVersion)
      )
        continue
      pending.delete(callId)
      if (call.timer !== undefined) clearTimeout(call.timer)
      call.reject(new Error('BRIDGE_REVOKED: bridge session was revoked'))
    }
  }

  /**
   * Forward an approved invocation to the bridge and await the browser's reply
   * (the visible instance's result). If the bridge is disconnected mid-flight
   * the promise rejects (loud failure, per the plan's failure modes).
   */
  function forwardToBridge(
    channel: BridgeChannel,
    generation: number,
    opaqueActionId: string,
    args: unknown[],
    binding: { identity: string; grantVersion?: string; readOnly: boolean },
  ): Promise<unknown> {
    if (bridge !== channel || attachmentGeneration !== generation || !channel.connected) {
      return Promise.resolve(undefined)
    }
    const callId = crypto.randomUUID()
    const frame: BridgeInvokeMessage = { type: 'invoke', callId, opaqueActionId, args }
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          pending.delete(callId)
          reject(new Error('BRIDGE_TIMEOUT: bridge call timed out'))
        },
        options.bridgeCallTimeoutMs ??
          options.securityHookTimeoutMs ??
          DEFAULT_SECURITY_HOOK_TIMEOUT_MS,
      )
      pending.set(callId, { resolve, reject, timer, ...binding })
      try {
        channel.send(JSON.stringify(frame))
      } catch (err) {
        pending.delete(callId)
        clearTimeout(timer)
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
      const channel = bridge
      const generation = attachmentGeneration
      const handshakeAtStart = handshake
      const sessionAtStart = verifiedSessionToken
      const identityAtStart = verifiedIdentity
      const grantVersionAtStart = verifiedGrantVersion
      // Capability-bridge topology: the VISIBLE browser instance is
      // authoritative. Gate on the server (policy authority) but do NOT
      // dispatch on the server-mounted twin — that would double-execute side
      // effects and reintroduce the projection drift the bridge exists to
      // avoid. Execution is delegated to the browser via the opaque-ID
      // dispatcher; the gate carries no policy info onto the wire.
      const verdict = await service.authorize(toolName, params, ctx)
      if (bridge !== channel || attachmentGeneration !== generation) {
        return {
          error: 'BRIDGE_REPLACED: bridge attachment changed during authorization',
          code: 503,
        }
      }
      if (
        peerRevoked ||
        (handshakeAtStart === 'verified' &&
          (sessionAtStart !== verifiedSessionToken ||
            identityAtStart !== verifiedIdentity ||
            grantVersionAtStart !== verifiedGrantVersion))
      ) {
        const reason =
          identityAtStart && isBindingRevoked(identityAtStart, grantVersionAtStart)
            ? 'BRIDGE_REVOKED: bridge session was revoked'
            : 'BRIDGE_REVOKED: bridge session binding changed'
        rejectAllPending(reason)
        return { error: reason, code: 403 }
      }
      if (isGateRejection(verdict)) return verdict
      const projection =
        typeof verdict === 'object' &&
        verdict !== null &&
        Array.isArray((verdict as { projection?: unknown }).projection)
          ? (verdict as { projection: readonly string[] }).projection
          : undefined
      const readOnly =
        typeof verdict === 'object' &&
        verdict !== null &&
        (verdict as { readOnly?: unknown }).readOnly === true
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
      const handshakeState = await awaitHandshake(generation)
      if (bridge !== channel || attachmentGeneration !== generation) {
        return { error: 'BRIDGE_REPLACED: bridge attachment changed during handshake', code: 503 }
      }
      if (
        peerRevoked ||
        (handshakeAtStart === 'verified' &&
          (sessionAtStart !== verifiedSessionToken ||
            identityAtStart !== verifiedIdentity ||
            grantVersionAtStart !== verifiedGrantVersion))
      ) {
        const reason =
          identityAtStart && isBindingRevoked(identityAtStart, grantVersionAtStart)
            ? 'BRIDGE_REVOKED: bridge session was revoked'
            : 'BRIDGE_REVOKED: bridge session binding changed'
        rejectAllPending(reason)
        return { error: reason, code: 403 }
      }
      if (handshakeState !== 'verified' || peerRevoked) {
        return { error: `BRIDGE_UNVERIFIED: ${handshakeReason}`, code: 503 }
      }

      if (!options.reauthorizeBridgeInvoke) {
        return {
          error: 'BRIDGE_AUTH_UNAVAILABLE: per-invoke authorization is not configured',
          code: 503,
        }
      }
      let reauthorized: import('./types.ts').BridgeVerifiedSession | false = false
      const sessionToken = verifiedSessionToken
      const identity = verifiedIdentity
      const grantVersion = verifiedGrantVersion
      if (sessionToken === undefined || identity === undefined) {
        return { error: 'BRIDGE_UNVERIFIED: verified session missing', code: 503 }
      }
      try {
        reauthorized = await withSecurityTimeout(
          options.reauthorizeBridgeInvoke({
            sessionToken,
            identity,
            ...(grantVersion !== undefined ? { grantVersion } : {}),
            ...(actor !== undefined ? { actor } : {}),
          }),
          options.securityHookTimeoutMs ?? DEFAULT_SECURITY_HOOK_TIMEOUT_MS,
        )
      } catch {
        return { error: 'BRIDGE_AUTH_UNAVAILABLE: per-invoke authorization failed', code: 503 }
      }
      if (peerRevoked) {
        rejectAllPending('BRIDGE_REVOKED: bridge peer was revoked')
        return { error: 'BRIDGE_REVOKED: bridge peer was revoked', code: 403 }
      }
      if (!reauthorized) {
        rejectAllPending('BRIDGE_REVOKED: session or grant is no longer current')
        return { error: 'BRIDGE_REVOKED: session or grant is no longer current', code: 403 }
      }
      if (
        typeof reauthorized !== 'object' ||
        reauthorized.identity !== identity ||
        (reauthorized.grantVersion ?? undefined) !== (grantVersion ?? undefined)
      ) {
        rejectAllPending('BRIDGE_REVOKED: session or grant binding changed')
        return { error: 'BRIDGE_REVOKED: session or grant binding changed', code: 403 }
      }
      if (
        bridge !== channel ||
        attachmentGeneration !== generation ||
        peerRevoked ||
        sessionToken !== verifiedSessionToken ||
        identity !== verifiedIdentity ||
        grantVersion !== verifiedGrantVersion
      )
        return {
          error: 'BRIDGE_REPLACED: bridge attachment changed during authorization',
          code: 503,
        }

      const opaqueActionId = opaqueActionIdForTool(toolName)
      if (!opaqueActionId) return { error: `bad tool: ${toolName}`, code: 400 }

      try {
        const bridgeResult = await forwardToBridge(channel, generation, opaqueActionId, args, {
          identity,
          ...(grantVersion !== undefined ? { grantVersion } : {}),
          readOnly,
        })
        if (bridge !== channel || attachmentGeneration !== generation) {
          if (bridge === null) {
            return { error: 'BRIDGE_DETACHED: bridge disconnected during invocation', code: 503 }
          }
          return {
            error: 'BRIDGE_REPLACED: bridge attachment changed during invocation',
            code: 503,
          }
        }
        if (peerRevoked || isBindingRevoked(identity, grantVersion)) {
          return readOnly
            ? { error: 'BRIDGE_REVOKED: bridge session was revoked', code: 403 }
            : {
                error: 'BRIDGE_RESULT_WITHHELD: action may have executed; result withheld',
                code: 403,
              }
        }
        let finalAuthorization: import('./types.ts').BridgeVerifiedSession | false
        try {
          finalAuthorization = await withSecurityTimeout(
            options.reauthorizeBridgeInvoke({
              sessionToken,
              identity,
              ...(grantVersion !== undefined ? { grantVersion } : {}),
              ...(actor !== undefined ? { actor } : {}),
            }),
            options.securityHookTimeoutMs ?? DEFAULT_SECURITY_HOOK_TIMEOUT_MS,
          )
        } catch {
          return readOnly
            ? { error: 'BRIDGE_AUTH_UNAVAILABLE: post-invoke authorization failed', code: 503 }
            : {
                error: 'BRIDGE_RESULT_WITHHELD: action may have executed; result withheld',
                code: 403,
              }
        }
        if (
          peerRevoked ||
          isBindingRevoked(identity, grantVersion) ||
          !finalAuthorization ||
          typeof finalAuthorization !== 'object' ||
          finalAuthorization.identity !== identity ||
          (finalAuthorization.grantVersion ?? undefined) !== (grantVersion ?? undefined)
        ) {
          return readOnly
            ? { error: 'BRIDGE_REVOKED: session or grant is no longer current', code: 403 }
            : {
                error: 'BRIDGE_RESULT_WITHHELD: action may have executed; result withheld',
                code: 403,
              }
        }
        try {
          return { result: projectCapabilityResult(bridgeResult ?? null, projection) }
        } catch {
          return { error: 'CAPABILITY_UNAVAILABLE: result shape cannot be projected', code: 503 }
        }
      } catch (err) {
        if (bridge !== channel || attachmentGeneration !== generation) {
          if (bridge === null) {
            return { error: 'BRIDGE_DETACHED: bridge disconnected during invocation', code: 503 }
          }
          return {
            error: 'BRIDGE_REPLACED: bridge attachment changed during invocation',
            code: 503,
          }
        }
        if (err instanceof Error && err.message.startsWith('BRIDGE_REVOKED:')) {
          return readOnly
            ? { error: 'BRIDGE_REVOKED: session or grant is no longer current', code: 403 }
            : {
                error: 'BRIDGE_RESULT_WITHHELD: action may have executed; result withheld',
                code: 403,
              }
        }
        if (err instanceof Error && err.message.startsWith('BRIDGE_TIMEOUT:')) {
          return { error: 'BRIDGE_TIMEOUT: bridge call timed out', code: 503 }
        }
        // WS-disconnect mid-drive must be surfaced, not silently dropped.
        return {
          error: 'BRIDGE_ERROR: bridge call failed',
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
    revokeBridgeSession,
    issueBridgeNonce: (ttlMs?: number) => bridgeNonces.issue(ttlMs, String(attachmentGeneration)),
    dispose,
  }
}

export { BRIDGE_PROTOCOL_VERSION }
