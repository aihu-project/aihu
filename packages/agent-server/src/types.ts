/**
 * `@aihu/agent-server` — public type definitions.
 *
 * This module is the source of truth for the **WS capability-bridge contract**
 * (T2). The browser-bridge client (T3, a separate worktree) implements against
 * the message shapes declared here. Keeping the contract in a dependency-free
 * `types.ts` lets both the server (`createAgentServer`) and a future client
 * package import it without pulling in jsdom / the MCP SDK.
 */

import type {
  Actor,
  ActorResolver,
  AgentService,
  AgentServiceOptions,
  AuthPlugin,
  CapabilityGrantResolver,
  RateLimitPlugin,
  RequestContext,
} from '@aihu/agent-service'
import type { AgentBindingSpec, MountScope, Node, Snapshot } from '@aihu/arbor'
import type { BridgeNonce } from './bridge-nonce.ts'

// ─── createAgentServer options ───────────────────────────────────────────────

/**
 * The thing being driven. One of:
 *  - `node` + `agentBinding`: an arbor render tree plus its compiler-emitted
 *    `__agentBinding` server export. `createAgentServer` mounts it into a
 *    jsdom host so its `LiveBinding` registers in the componentInstanceRegistry.
 *  - `mount`: a `MountScope` you already produced (e.g. via `@aihu/server`
 *    SSR). The binding is assumed to already be registered.
 */
export interface AgentServerTarget {
  /** arbor render tree (root `Node`) to mount server-side. */
  node?: Node
  /** Compiler-emitted `__agentBinding` server export for the component. */
  agentBinding?: AgentBindingSpec
  /** A pre-built `MountScope` (its binding is already registered). */
  mount?: MountScope
}

/**
 * Options for {@link createAgentServer}.
 *
 * Auth/scope/rate-limit plugins and `resolveAuth` are forwarded verbatim to
 * the underlying `createAgentService` — the security gate (404→401→403→429)
 * lives there and is NOT re-implemented in this package.
 */
export interface AgentServerOptions {
  /** The component to mount + drive. */
  target: AgentServerTarget
  /**
   * Optional host factory for the server-side mount. When omitted,
   * `createAgentServer` stands up an internal jsdom-backed global DOM (if the
   * runtime has none) and mounts into a fresh detached `<div>` — so a plain
   * Bun/Node consumer needs no DOM glue at all. Provide this only to mount into
   * a specific host element (an explicit factory always wins).
   */
  createHost?: () => Element
  /** Auth plugin — forwarded to `createAgentService` for `$scope` checks. */
  authPlugin?: AuthPlugin
  /** Rate-limit plugin — forwarded to `createAgentService`. */
  rateLimitPlugin?: RateLimitPlugin
  /**
   * Per-request auth resolver — forwarded to `createAgentService.asMiddleware`.
   * Lets scoped/rate-limited tools be reachable over the bundled HTTP path.
   */
  resolveAuth?: AgentServiceOptions['resolveAuth']
  actorResolver?: ActorResolver
  authorizeDataRead?: CapabilityGrantResolver
  /** Maximum duration for each injected security hook and pending bridge call. Defaults to 5000ms. */
  securityHookTimeoutMs?: number
  /**
   * Auth-discovery URL forwarded to `createAgentService` — included in every
   * 401 envelope so a refused agent knows where to obtain a credential (e.g.
   * the deployment's `/.well-known/oauth-protected-resource`). Informational
   * only; never a policy input.
   */
  authDiscoveryUrl?: AgentServiceOptions['authDiscoveryUrl']
  /** Verify a bridge token and return its stable identity/grant binding. Missing verifier denies attachment. */
  verifyBridgeSession?: (token: string) => BridgeVerifiedSession | Promise<BridgeVerifiedSession>
  /**
   * How long (ms) `callTool` waits for an attached bridge channel to complete
   * its `hello` handshake before refusing to delegate to it (503
   * `BRIDGE_UNVERIFIED`). Defaults to 1000ms.
   *
   * The wait exists only to absorb the attach/connect race over a real socket;
   * it is not a grace period. A channel that sends a MISMATCHED or non-numeric
   * protocol version is rejected immediately, without waiting out this timeout.
   */
  bridgeHandshakeTimeoutMs?: number
  /** Maximum duration for a bridge invocation reply. Defaults to 5000ms. */
  bridgeCallTimeoutMs?: number
  /** Re-check the bound session/grant before every invocation. */
  reauthorizeBridgeInvoke?: (binding: {
    readonly sessionToken?: string
    readonly identity: string
    readonly grantVersion?: string
    /** Actor resolved by the service gate for this invocation, if verified. */
    readonly actor?: Actor
  }) => BridgeVerifiedSession | false | Promise<BridgeVerifiedSession | false>
  /** Optional host-side diagnostics for rejected bridge frames. Disabled when omitted. */
  onBridgeDiagnostic?: (diagnostic: { readonly event: string; readonly detail?: unknown }) => void
}

export interface BridgeVerifiedSession {
  readonly identity: string
  readonly grantVersion?: string
}

// ─── WS capability-bridge contract (T2 → T3) ─────────────────────────────────

/**
 * Protocol version for the capability bridge. Bumped on any breaking change to
 * the message shapes below.
 *
 * ENFORCED SERVER-SIDE: `createAgentServer` compares an attached channel's
 * `hello.protocol` against this constant and refuses to delegate any invocation
 * to a channel that did not send a matching numeric value (503
 * `BRIDGE_UNVERIFIED`). A stale browser client may also refuse to connect, but
 * the server never relies on it to — per thesis §3, the client is never the
 * policy authority.
 */
export const BRIDGE_PROTOCOL_VERSION = 2 as const

/**
 * Server → client. Sent ONLY after `handleToolCall` authorizes an invocation
 * (i.e. the 404→401→403→429 gate has passed). Carries **no policy info** —
 * the client receives an opaque action id + args and nothing about scope,
 * rate-limit, or auth. The browser's opaque-ID dispatcher (T1) maps
 * `opaqueActionId` → a concrete action on the visible component.
 *
 * `opaqueActionId` is `"<tag>/<action>"` for v1. The compiler (T1) is expected
 * to emit a stable opaque id; until that lands the server forwards the plain
 * tool name, and the client allowlist is keyed on the same string.
 */
export interface BridgeInvokeMessage {
  type: 'invoke'
  /** Correlates the eventual `result`/`error`/`snapshot` reply. */
  callId: string
  /** Opaque action identifier the client maps to a concrete action. */
  opaqueActionId: string
  /** Positional arguments for the action. */
  args: unknown[]
}

/**
 * Client → server. The browser executed the approved invocation; this reports
 * the action's return value (if any) back so the agent's `tools/call` can
 * resolve with a real result from the *visible* instance.
 */
export interface BridgeResultMessage {
  type: 'result'
  callId: string
  result: unknown
}

/**
 * Client → server. The browser failed to execute the invocation (e.g. the
 * opaque id wasn't in its allowlist, or the action threw). Surfaced to the
 * agent as an error rather than silently swallowed (failure mode: WS-disconnect
 * / desync must be loud — plan §"Failure modes").
 */
export interface BridgeErrorMessage {
  type: 'error'
  callId: string
  code?: string
  message: string
}

/**
 * Client → server (or server → a read-only viewer). A flat path-keyed
 * `serialize()` snapshot of the driven component's signal state, streamed so
 * the server (and any attached viewer) can reflect the visible component's
 * current state. `callId` is present when the snapshot is the direct result of
 * an invocation; absent for spontaneous (effect-driven) state changes.
 */
export interface BridgeSnapshotMessage {
  type: 'snapshot'
  callId?: string
  snapshot: Snapshot
}

/**
 * Handshake, client → server, sent once on connect. Lets the server reject a
 * client speaking an incompatible protocol version.
 */
export interface BridgeHelloMessage {
  type: 'hello'
  protocol: number
  sessionToken?: string
  sessionIdentity?: string
  nonce?: string
  grantVersion?: string
}

/** Any message a client may send to the server over the bridge. */
export type BridgeClientMessage =
  | BridgeHelloMessage
  | BridgeResultMessage
  | BridgeErrorMessage
  | BridgeSnapshotMessage

/** Any message the server may send to a client over the bridge. */
export type BridgeServerMessage = BridgeInvokeMessage

/**
 * The minimal duplex transport the bridge needs. A real deployment passes a
 * `ws` `WebSocket` (or an SSE+POST pair); tests pass an in-memory channel. This
 * keeps `@aihu/agent-server` transport-agnostic and free of a `ws` dep.
 */
export interface BridgeChannel {
  /** Send one (already-serialized) message frame to the peer. */
  send(data: string): void
  /** Register a frame handler. Returns an unsubscribe function. */
  onMessage(handler: (data: string) => void): () => void
  /** Register a close handler. Returns an unsubscribe function. */
  onClose(handler: () => void): () => void
  /** True while the channel can still deliver frames. */
  readonly connected: boolean
}

// ─── createAgentServer handle ────────────────────────────────────────────────

/**
 * The handle returned by {@link createAgentServer}.
 */
export interface AgentServer {
  /** The underlying agent-service (exposes `handleToolCall`, `asMiddleware`). */
  readonly service: AgentService
  /** The `MountScope` of the server-mounted component. */
  readonly mount: MountScope

  /**
   * Run a tool call through the full agent-service gate. On authorization, the
   * dispatch is applied to the server-mounted binding AND, if a browser bridge
   * is attached, forwarded to it as a {@link BridgeInvokeMessage}.
   *
   * Returns the agent-service envelope: `{ result }` on success, or
   * `{ error, code, jsonrpc }` on a gate rejection (404/401/403/429). The HTTP
   * code is never mutated here — the gate is the sole policy authority.
   */
  callTool(toolName: string, params: unknown, ctx?: RequestContext): Promise<unknown>

  /** Current serialized state of the server-mounted component. */
  serialize(): Snapshot

  /**
   * Attach a browser bridge channel. Approved invocations are forwarded to it;
   * `result`/`error`/`snapshot` frames from it resolve pending `callTool`
   * promises. Returns a detach function.
   *
   * The channel MUST complete the `hello` handshake (see
   * {@link BRIDGE_PROTOCOL_VERSION}) before anything is delegated to it. Until
   * it does, `hello` is the only frame it may send, and `callTool` refuses to
   * forward — an unverified channel never becomes the execution authority.
   * Attaching a new channel always resets this state; verified status is never
   * inherited from a previous peer.
   */
  attachBridge(channel: BridgeChannel): () => void

  /** Issue a single-use nonce for a forthcoming bridge handshake. */
  issueBridgeNonce(ttlMs?: number): BridgeNonce

  /** Revoke a verified bridge identity (or its exact grant) and cancel its pending calls. */
  revokeBridgeSession(identity: string, grantVersion?: string): void

  /**
   * Build the MCP `Server` (stdio-ready) exposing each component action as an
   * MCP tool backed by `callTool`. Lazily constructed; the SDK is imported only
   * when this is called. See {@link createComponentMcpServer}.
   */
  // (the MCP server factory is a separate export to keep the SDK import lazy)

  /** Tear down: dispose the mount + detach any bridge. */
  dispose(): void
}
