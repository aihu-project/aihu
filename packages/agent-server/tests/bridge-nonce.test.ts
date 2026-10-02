import { describe, expect, it, vi } from 'vitest'
import { createBridgeNonceStore } from '../src/bridge-nonce.ts'

describe('bridge nonce store', () => {
  it('consumes each issued nonce at most once', () => {
    const store = createBridgeNonceStore()
    const issued = store.issue(undefined, 'connection-a')
    expect(store.consume(issued.nonce, 'connection-a')).toBe(true)
    expect(store.consume(issued.nonce, 'connection-a')).toBe(false)
    expect(store.consume('unknown', 'connection-a')).toBe(false)
    expect(store.consume(null, 'connection-a')).toBe(false)
  })

  it('binds a nonce to its issuing connection', () => {
    const store = createBridgeNonceStore()
    const issued = store.issue(undefined, 'connection-a')
    expect(store.consume(issued.nonce, 'connection-b')).toBe(false)
    expect(store.consume(issued.nonce, 'connection-a')).toBe(true)
  })

  it('rejects an expired nonce', () => {
    vi.useFakeTimers()
    try {
      const store = createBridgeNonceStore()
      const issued = store.issue(100, 'connection-a')
      vi.advanceTimersByTime(101)
      expect(store.consume(issued.nonce, 'connection-a')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
