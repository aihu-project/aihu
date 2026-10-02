/** Single-use, short-lived bridge handshake nonces. */
export interface BridgeNonce {
  readonly nonce: string
  readonly expiresAt: number
}

export interface BridgeNonceStore {
  issue(ttlMs: number | undefined, connectionId: string): BridgeNonce
  consume(value: unknown, connectionId: string): boolean
}

export function createBridgeNonceStore(): BridgeNonceStore {
  const issued = new Map<string, { expiresAt: number; connectionId: string }>()
  return {
    issue(ttlMs = 30_000, connectionId): BridgeNonce {
      if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError('nonce ttl must be positive')
      const now = Date.now()
      for (const [nonce, record] of issued) if (record.expiresAt <= now) issued.delete(nonce)
      const nonce = crypto.randomUUID()
      const expiresAt = now + ttlMs
      issued.set(nonce, { expiresAt, connectionId })
      return { nonce, expiresAt }
    },
    consume(value: unknown, connectionId): boolean {
      if (typeof value !== 'string' || value.length === 0) return false
      const record = issued.get(value)
      if (record === undefined) return false
      if (record.connectionId !== connectionId) return false
      issued.delete(value)
      return record.expiresAt > Date.now()
    },
  }
}
