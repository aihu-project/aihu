/**
 * `@aihu/agent-server` — opaque action ID (T1 ↔ T2 reconciliation).
 *
 * Mirrors the compiler's `opaque_member_id` in
 * the standalone compiler emitter: FNV-1a-64 over `"<tag>:<member>"`,
 * rendered as `a_` + a 16-char zero-padded lowercase hex string.
 *
 * This MUST stay byte-identical to the Rust emit. The server forwards this id
 * over the capability bridge, and the compiler-emitted `__agentDispatcher` in
 * the browser keys its action map on the same string — so a mismatch means the
 * browser silently fails to find the action. The golden vectors in
 * `tests/opaque-id.test.ts` (taken from the compiler's own emitted output) lock
 * the two implementations together.
 */

// FNV-1a-64 constants — identical to emit.rs `fnv1a_64`.
const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MASK64 = 0xffffffffffffffffn

/** FNV-1a 64-bit over the UTF-8 bytes of `input`. */
function fnv1a64(input: string): bigint {
  let hash = FNV_OFFSET
  for (const byte of new TextEncoder().encode(input)) {
    hash ^= BigInt(byte)
    hash = (hash * FNV_PRIME) & MASK64
  }
  return hash
}

/**
 * Deterministic, stable opaque ID for an agent-exposed member — identical to
 * the compiler's `opaque_member_id(tag, member)`.
 */
export function opaqueActionId(tag: string, member: string): string {
  return `a_${fnv1a64(`${tag}:${member}`).toString(16).padStart(16, '0')}`
}

/** Split a `"<tag>/<member>"` tool name. Returns null when malformed. */
export function parseToolName(toolName: string): { tag: string; member: string } | null {
  const slash = toolName.indexOf('/')
  if (slash === -1) return null
  return { tag: toolName.slice(0, slash), member: toolName.slice(slash + 1) }
}

/** Opaque ID directly from a `"<tag>/<member>"` tool name; null if malformed. */
export function opaqueActionIdForTool(toolName: string): string | null {
  const parts = parseToolName(toolName)
  return parts ? opaqueActionId(parts.tag, parts.member) : null
}
