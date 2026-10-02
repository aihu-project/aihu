/** Single-use, short-lived bridge handshake nonces. */
export interface BridgeNonce {
  readonly nonce: string
  readonly expiresAt: number
}

export interface BridgeNonceStore {
  issue(ttlMs?: number): BridgeNonce
  consume(value: unknown): boolean
}

export function createBridgeNonceStore(): BridgeNonceStore {
  const issued = new Map<string, number>()
  return {
    issue(ttlMs = 30_000): BridgeNonce {
      if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError('nonce ttl must be positive')
      const now = Date.now()
      for (const [nonce, expiry] of issued) if (expiry <= now) issued.delete(nonce)
      const nonce = crypto.randomUUID()
      const expiresAt = now + ttlMs
      issued.set(nonce, expiresAt)
      return { nonce, expiresAt }
    },
    consume(value: unknown): boolean {
      if (typeof value !== 'string' || value.length === 0) return false
      const expiresAt = issued.get(value)
      if (expiresAt === undefined) return false
      issued.delete(value)
      return expiresAt > Date.now()
    },
  }
}
