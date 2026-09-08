/**
 * `@aihu/agent-server` — opaque-ID reconciliation (T1 ↔ T2).
 *
 * GOLDEN VECTORS: the expected hashes below were emitted by the COMPILER's own
 * `__agentDispatcher` output (`opaque_member_id` from the standalone compiler), captured in
 * the T1 review. If this test fails, the TS mirror (`opaque-id.ts`) has drifted
 * from the Rust emit — the server would then forward an id the browser
 * dispatcher can't find, and every bridged call would silently 404. Keep them
 * byte-identical.
 */

import { describe, expect, it } from 'vitest'
import { opaqueActionId, opaqueActionIdForTool, parseToolName } from '../src/opaque-id.ts'

describe('opaqueActionId — golden vectors from the compiler emit', () => {
  it('matches the compiler-emitted ids for weather-card', () => {
    expect(opaqueActionId('weather-card', 'fetchForecast')).toBe('a_c377974f43f03a03')
    expect(opaqueActionId('weather-card', 'location')).toBe('a_97c5cab05e2e71b5')
    expect(opaqueActionId('weather-card', 'forecast')).toBe('a_ba1f98d4072961ff')
  })

  it('is deterministic — same input yields the same id', () => {
    expect(opaqueActionId('x-card', 'flip')).toBe(opaqueActionId('x-card', 'flip'))
  })

  it('is namespaced by tag — same member in two components differs', () => {
    expect(opaqueActionId('a-comp', 'go')).not.toBe(opaqueActionId('b-comp', 'go'))
  })

  it('always renders `a_` + 16 lowercase hex chars', () => {
    expect(opaqueActionId('t', 'm')).toMatch(/^a_[0-9a-f]{16}$/)
    // Even when the low bytes are zero, the hash is zero-padded to 16.
    expect(opaqueActionId('weather-card', 'fetchForecast')).toHaveLength(18)
  })
})

describe('tool-name helpers', () => {
  it('parses `<tag>/<member>`', () => {
    expect(parseToolName('weather-card/fetchForecast')).toEqual({
      tag: 'weather-card',
      member: 'fetchForecast',
    })
  })

  it('returns null for a malformed tool name', () => {
    expect(parseToolName('no-slash')).toBeNull()
    expect(opaqueActionIdForTool('no-slash')).toBeNull()
  })

  it('opaqueActionIdForTool composes parse + hash', () => {
    expect(opaqueActionIdForTool('weather-card/fetchForecast')).toBe('a_c377974f43f03a03')
  })
})
