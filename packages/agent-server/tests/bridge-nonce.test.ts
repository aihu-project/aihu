import { describe, expect, it, vi } from 'vitest'
import { createBridgeNonceStore } from '../src/bridge-nonce.ts'

describe('bridge nonce store', () => {
  it('consumes each issued nonce at most once', () => {
    const store = createBridgeNonceStore()
    const issued = store.issue()
    expect(store.consume(issued.nonce)).toBe(true)
    expect(store.consume(issued.nonce)).toBe(false)
    expect(store.consume('unknown')).toBe(false)
    expect(store.consume(null)).toBe(false)
  })

  it('rejects an expired nonce', () => {
    vi.useFakeTimers()
    try {
      const store = createBridgeNonceStore()
      const issued = store.issue(100)
      vi.advanceTimersByTime(101)
      expect(store.consume(issued.nonce)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
