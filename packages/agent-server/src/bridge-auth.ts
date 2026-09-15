/**
 * `@aihu/agent-server` — capability-bridge upgrade authorization.
 *
 * `createAgentServer` is deliberately transport-agnostic (no `ws` dependency;
 * see {@link BridgeChannel}), so it never sees the raw HTTP upgrade request for
 * `/bridge`. That means today nothing stops an arbitrary page from opening a
 * WebSocket to a running bridge port and being treated as the trusted browser
 * instance — a WebSocket upgrade is not subject to the same-origin policy the
 * way `fetch`/XHR are, so the server MUST check `Origin` itself.
 *
 * This module is the reusable check every capability-bridge server (the
 * `agent-driven-demo` example today; any real deployment tomorrow) should run
 * BEFORE calling its runtime's `upgrade()` — never after. A rejected upgrade
 * must never reach `attachBridge`.
 */

/** Result of {@link verifyBridgeUpgrade}. */
export type BridgeUpgradeVerdict = { ok: true } | { ok: false; status: number; reason: string }

export interface VerifyBridgeUpgradeOptions {
  /**
   * Origins allowed to open the capability-bridge WebSocket, exact string
   * match against the `Origin` request header (e.g. `http://localhost:5108`).
   * There is no wildcard support — a bridge that trusts every origin is the
   * vulnerability this function exists to close.
   */
  allowedOrigins: readonly string[]
}

/**
 * Decide whether an HTTP upgrade request for the capability bridge should be
 * accepted, based on its `Origin` header.
 *
 * Fails closed: a missing `Origin` header (a non-browser client, or a browser
 * page loaded over `file://`) and an `Origin` outside `allowedOrigins` are both
 * rejected. A real browser tab always sends `Origin` on a cross-scheme
 * WebSocket handshake, so requiring it costs nothing for the legitimate case
 * and removes the only case (no header at all) that would otherwise need a
 * separate carve-out.
 *
 * This is NOT authentication — it only constrains which *pages* may attach as
 * the bridge's browser peer. Confirming which *user/session* opened the page
 * (e.g. via `@aihu/auth`) is a separate, session-bound check layered on top.
 */
export function verifyBridgeUpgrade(
  req: Request,
  options: VerifyBridgeUpgradeOptions,
): BridgeUpgradeVerdict {
  const origin = req.headers.get('origin')
  if (!origin) {
    return {
      ok: false,
      status: 403,
      reason: 'capability-bridge upgrade refused: missing Origin header',
    }
  }
  if (!options.allowedOrigins.includes(origin)) {
    return {
      ok: false,
      status: 403,
      reason: `capability-bridge upgrade refused: origin "${origin}" is not in the allowlist`,
    }
  }
  return { ok: true }
}
