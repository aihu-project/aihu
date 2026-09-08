/**
 * Fixture: the exact shape of `packages/agent-server/src/opaque-id.ts:4`.
 *
 * This says "Mirrors the compiler's `opaque_member_id`" and MUST NOT be a
 * finding. It is a cross-language (TS↔Rust) algorithm parity note: there is no
 * second TypeScript declaration for D1 to pair it with, and no artifact array
 * for D2 to match. A naive comment-grep flags it and blows check:derived's
 * count from 2 to 3.
 *
 * This is the sharpest guard in the check. Open question #3 in the spec asks
 * whether this SHOULD count; it is specified as must-not-flag, and changing
 * that is above this slice's authority.
 *
 * Mirrors the compiler's `opaque_member_id` in
 * the standalone compiler emitter — this MUST stay byte-identical to
 * the Rust emit, and is kept in sync with it by golden vectors.
 */

const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n

export function opaqueActionId(tag: string, member: string): string {
  let hash = FNV_OFFSET
  for (const byte of new TextEncoder().encode(`${tag}:${member}`)) {
    hash ^= BigInt(byte)
    hash = (hash * FNV_PRIME) & 0xffffffffffffffffn
  }
  return `a_${hash.toString(16).padStart(16, '0')}`
}
