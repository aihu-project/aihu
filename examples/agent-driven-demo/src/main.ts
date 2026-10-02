/**
 * agent-driven-demo — browser entry.
 *
 * Mounts the REAL, visible `<task-list>` component, takes the compiler-injected
 * per-instance opaque-ID dispatcher off the mounted element, and runs the
 * capability-bridge client over a real browser WebSocket. Server-approved
 * invocations execute against THIS on-screen instance — so what the user sees
 * is what the agent drives.
 */

import type { BridgeChannel } from '@aihu/agent-server'
import { createBridgeClient } from '@aihu/agent-server'
import { _takeAgentDispatcher } from '@aihu/runtime'

// Side-effect import: the Vite plugin compiles `task-list.aihu` with the client
// pipeline (auto-wiring + the @agent dispatcher pass) and registers the custom
// element. The per-instance dispatcher is registered in the element's setup.
import './task-list.aihu'

const TAG = 'task-list'
const BRIDGE_URL = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.hostname}:5208/bridge`

interface BridgeBootstrap {
  type: 'bridge-bootstrap'
  nonce: string
  sessionToken: string
  sessionIdentity: string
  grantVersion: string
}

function isBridgeBootstrap(value: unknown): value is BridgeBootstrap {
  if (typeof value !== 'object' || value === null) return false
  const frame = value as Record<string, unknown>
  return (
    frame.type === 'bridge-bootstrap' &&
    typeof frame.nonce === 'string' &&
    typeof frame.sessionToken === 'string' &&
    typeof frame.sessionIdentity === 'string' &&
    typeof frame.grantVersion === 'string'
  )
}

function wrapBrowserWs(ws: WebSocket): BridgeChannel {
  return {
    get connected() {
      return ws.readyState === WebSocket.OPEN
    },
    send(data) {
      ws.send(data)
    },
    onMessage(handler) {
      const h = (e: MessageEvent): void => handler(String(e.data))
      ws.addEventListener('message', h)
      return () => ws.removeEventListener('message', h)
    },
    onClose(handler) {
      ws.addEventListener('close', handler)
      return () => ws.removeEventListener('close', handler)
    },
  }
}

function start(): void {
  const el = document.querySelector(TAG)
  if (!el) {
    console.error(`[agent-driven-demo] <${TAG}> not found in the DOM`)
    return
  }

  // The Step-0 wiring: the compiler injected `_registerAgentDispatcher(ctx.element, …)`
  // into the component's setup, so the instance-bound dispatcher is available now.
  const dispatcher = _takeAgentDispatcher(el)
  if (!dispatcher) {
    console.error(
      '[agent-driven-demo] no per-instance dispatcher — was the component built for client+@agent?',
    )
    return
  }

  const ws = new WebSocket(BRIDGE_URL)
  let bridgeClient: ReturnType<typeof createBridgeClient> | null = null
  ws.addEventListener('message', (event: MessageEvent) => {
    let frame: unknown
    try {
      frame = JSON.parse(String(event.data))
    } catch {
      return
    }
    if (!isBridgeBootstrap(frame) || bridgeClient) return
    bridgeClient = createBridgeClient({
      dispatcher,
      channel: wrapBrowserWs(ws),
      nonce: frame.nonce,
      sessionToken: frame.sessionToken,
      sessionIdentity: frame.sessionIdentity,
      grantVersion: frame.grantVersion,
      // Stream a flat snapshot of the visible instance after each invocation so
      // the server (and any read-only viewer) reflects the on-screen state.
      serialize: () => ({
        taskCount: (el.shadowRoot ?? el).querySelectorAll('.tl-item').length,
      }),
    })
    console.log(
      '[agent-driven-demo] bridge session established — the agent can now drive this instance',
    )
  })
  ws.addEventListener('close', () => bridgeClient?.dispose())
  ws.addEventListener('error', () => {
    console.warn(
      `[agent-driven-demo] could not reach the bridge at ${BRIDGE_URL}. Is the API server running (bun run server)?`,
    )
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start)
} else {
  start()
}
