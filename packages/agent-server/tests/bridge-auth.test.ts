/**
 * `@aihu/agent-server` — `verifyBridgeUpgrade` (capability-bridge origin gate).
 *
 * A WebSocket upgrade is not subject to the same-origin policy the way
 * `fetch`/XHR are, so a bridge server that skips this check lets ANY page the
 * user has open attach as the trusted browser peer and drive approved
 * invocations against the real component. These tests pin the fail-closed
 * behavior directly, independent of any particular runtime's `upgrade()` API.
 */

import { describe, expect, it } from 'vitest'
import { verifyBridgeUpgrade } from '../src/bridge-auth.ts'

const ALLOWED = ['http://localhost:5108', 'http://127.0.0.1:5108']

function upgradeRequest(headers: Record<string, string>): Request {
  return new Request('http://localhost:5208/bridge', { headers })
}

describe('verifyBridgeUpgrade', () => {
  it('accepts an allowlisted origin', () => {
    const verdict = verifyBridgeUpgrade(upgradeRequest({ origin: 'http://localhost:5108' }), {
      allowedOrigins: ALLOWED,
    })
    expect(verdict).toEqual({ ok: true })
  })

  it('rejects a missing Origin header', () => {
    const verdict = verifyBridgeUpgrade(upgradeRequest({}), { allowedOrigins: ALLOWED })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.status).toBe(403)
      expect(verdict.reason).toMatch(/missing Origin/)
    }
  })

  it('rejects an origin outside the allowlist', () => {
    const verdict = verifyBridgeUpgrade(upgradeRequest({ origin: 'https://evil.example' }), {
      allowedOrigins: ALLOWED,
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.status).toBe(403)
      expect(verdict.reason).toMatch(/not in the allowlist/)
      expect(verdict.reason).toContain('https://evil.example')
    }
  })

  it('does not treat a prefix match as an allowlist match', () => {
    // A naive `startsWith`/`includes`-on-string check would wrongly accept
    // this — exact match only.
    const verdict = verifyBridgeUpgrade(
      upgradeRequest({ origin: 'http://localhost:5108.evil.example' }),
      { allowedOrigins: ALLOWED },
    )
    expect(verdict.ok).toBe(false)
  })

  it('rejects every origin when the allowlist is empty', () => {
    const verdict = verifyBridgeUpgrade(upgradeRequest({ origin: 'http://localhost:5108' }), {
      allowedOrigins: [],
    })
    expect(verdict.ok).toBe(false)
  })
})
