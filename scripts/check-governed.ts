#!/usr/bin/env bun
import type { BridgeChannel } from '@aihu/agent-server'
import type { LiveBinding, RequestContext } from '@aihu/agent-service'
/**
 * check:governed — thesis §3: capability, authority, and rate are declared
 * per-member and ENFORCED BY THE SERVER.
 *
 * Failure modes the property exists to prevent, quoted from the thesis:
 * "enforcement displaced to the browser; a declared control that silently
 * no-ops when its plugin is absent; a check that is structurally always-true."
 *
 * This check is BEHAVIORAL, not static — precisely because `AC11` failed by
 * asserting the INVOKER's rejection rather than the GATE's, and reported green
 * while the allowlist was dead code. Every probe stands up a real
 * `AgentService` (G1) or a real `AgentServer` + bridge channel pair (G2) and
 * asserts the gate's own envelope CODE, never merely that the call didn't
 * succeed.
 *
 * G1 — a declared control whose plugin is absent must DENY.
 *   `$scope` declared / authPlugin omitted      → expect 401 AUTH_MISSING.
 *   `$rate-limit` declared / plugin omitted     → expect a fail-closed denial (429).
 *   NOTHING declared / no plugin                → must DISPATCH.
 *
 * G2 — the bridge handshake must be VERIFIED. An unverified channel that
 *   receives `invoke` frames IS the execution authority, so the server must
 *   refuse to delegate to one. Three channels must be REJECTED (no `hello`;
 *   mismatched protocol; non-numeric protocol) and one — a channel that sent a
 *   valid v2 `hello` with an attachment-bound nonce and verified session —
 *   must be DELEGATED to.
 *
 * G3 — rate-limit KEY PROVENANCE (#420 / GO1a). The bucket key must derive
 *   from the signature-VERIFIED JWT `sub` (via `AuthPlugin.verify`), never
 *   from caller-supplied `context.userId`. The probe replays the reported
 *   attack: one credential, rotated caller identities → the SAME bucket,
 *   keyed by the verified sub; an unverifiable credential → 401 with the
 *   limiter never consulted. This is the behavioral form of the "key
 *   provenance" check `check:governed` was explicitly documented NOT to
 *   catch before #420 landed. Verified to FAIL against the pre-fix tree
 *   (git stash of packages/ → self-test's should-not-flag G3 case reports
 *   caller-keyed buckets and the run exits 1).
 *
 * ─── GX Phase 5 (#467) — the governed data boundary (40-spec §10) ───────────
 *
 * G4/G5 make the Phase-4 hard tier NON-REGRESSABLE. Same posture as G1–G3:
 * every probe stands up the REAL `createServerRouter` + `createGovernedRegistry`
 * over the REAL compiled census row (`bench/compiler-conformance/route/
 * 04-governed-data.route.json`, byte-pinned to the compiler by the Rust golden
 * suite `gx_data.rs`) and asserts the gate's own statuses, emission shapes, and
 * spy counters — never merely "the call didn't succeed". Shared fixture:
 * `scripts/lib/governed-fixture.ts` (also consumed by `check:dual-audience`
 * DA-f1, so the two checks measure the same surface).
 *
 * G4a — NO GOVERNED SURFACE REACHES EMISSION UNGATED (invariant I2):
 *   a `data:` route refuses to BOOT without a registry; a malformed census
 *   `data` is a boot refusal (never rounded to ungoverned); an anonymous
 *   request gets the gate's own 401 with the provider NEVER invoked and zero
 *   governed sentinel bytes anywhere in the response; an entitled request is
 *   emitted THROUGH the gate (`$gx.entitled: true`); and `renderToString`
 *   refuses a pending dataSource inside a governed render (GOVERNED_UNGATED —
 *   the I2s streaming seam). Regression proven: census stripped of `data:` +
 *   provider re-exposed as a plain loader (the fan-out-drop regression) leaks
 *   the sentinel to anonymous and is flagged.
 *
 * G4b — non-default `read` + NO auth material + a credentialed request →
 *   deny (the G1 posture at the content boundary: a boundary whose plugin is
 *   absent must fail CLOSED), with a positive control proving the gate is not
 *   "deny everything". Regression proven: an accept-anything `verify` serves
 *   the governed payload and is flagged.
 *
 * G4c — the boundary uses `verify`, never `decodeJwt` (G3's provenance
 *   concern at the content gate): a token whose PAYLOAD decodes to fully
 *   entitled claims but whose signature cannot verify gets 401 with resolver
 *   AND provider untouched. Plus: static-meet-BEFORE-live-resolver ordering
 *   (a wrong-scope token is refused with the resolver never consulted), and
 *   fail-closed reason EXHAUSTIVENESS — the four withheld reasons
 *   (auth/scope/entitlement/unavailable) are each observed with their exact
 *   status (401/403/403/503+Retry-After). Regression proven: a decode-only
 *   `verify` seats the forged principal, leaks the payload, and is flagged
 *   (both the forged cell and the exhaustiveness row).
 *
 * G5a — BUNDLE/STATIC ABSENCE (E6 generalized): drive the REAL `runPrerender`
 *   over a governed route whose provider yields sentinel bytes, then scan
 *   EVERY byte written to `dist/` — governed sentinels absent, provider never
 *   invoked at build time. Regression proven: an inlined-loader-output page
 *   (the "SSG starts embedding governed data" regression) is flagged.
 *
 * G5b — the E3 governed-data endpoint serves the SAME gate decisions as SSR:
 *   anonymous → 401 withheld JSON (no sentinel bytes, `Cache-Control:
 *   private`); entitled → the granted payload; per-principal status AND `$gx`
 *   parity with the SSR channel; non-GET → 405; ungoverned path → 404 (the
 *   endpoint is never a second, open data path). Regression proven: an
 *   always-200 open endpoint stub is flagged on four of five cells.
 *
 * G5c — ENTITLED COMPLETENESS, honestly scoped (#465): entitled server HTML
 *   carries every DIRECT-interpolation governed value (headword, params) and
 *   the loader JSON carries the FULL granted payload. Structural `{#if}`
 *   content renders EMPTY server-side today, so the `senses` sentinel is
 *   load-bearing on the LOADER channel only — the probe AUTO-TIGHTENS: the
 *   moment the structural-directive SSR walk lands (detected by the
 *   `gx-senses` boundary appearing in entitled HTML), the sentinel becomes
 *   required in the HTML channel too. Mirrors the promotion note in
 *   `tests/integration/governed-route-e2e.test.ts`. Regression proven: the
 *   historical pre-P4 seam (render invoked WITHOUT the emission threaded as
 *   props; payload only in the JSON embed) is flagged.
 *
 * ─── Both slices have LANDED (GO1, GO2, 2026-07-19). ────────────────────────
 *
 * This file was updated in the same commit as the fix, because the self-test
 * below was written against the broken tree and would otherwise have gone
 * vacuous the moment the tree went green. Nothing was WEAKENED: the two
 * simulation shims were REMOVED and replaced with stronger, real-behaviour
 * controls in both directions.
 *
 *   Before: the should-not-flag half was a SHIM — a hardcoded
 *     `{ code: 429 }` / early return that simulated the fix the tree did not
 *     yet have. It proved the assertion logic could observe a pass; it could
 *     not prove the SERVER could produce one.
 *
 *   After: the should-not-flag half is the REAL, unmutated tree, and the
 *     should-flag half REGRESSES it using real code paths only — no shim
 *     anywhere:
 *       G1 regression: inject an always-permissive `rateLimitPlugin`, which
 *         reproduces exactly what the old `&& rateLimitPlugin` guard produced —
 *         a declared control that does not enforce.
 *       G2 regression: substitute a VALID v2 `hello` for each of the three
 *         unverified-channel cases. This exercises the real delegation path
 *         without sending a duplicate `hello` (which v2 revokes).
 *
 * The discrimination proof was likewise re-based rather than dropped. It used
 * to read "$scope denies, $rate-limit does not" — an assertion that only held
 * while the bug did. It now asserts the axis that actually matters and that a
 * broken gate cannot fake: DECLARED-with-absent-plugin denies, UNDECLARED
 * dispatches, and the two declared controls deny with DIFFERENT codes (401 vs
 * 429) so they are provably two separate checks rather than one blanket rule.
 * A gate that denied everything, or allowed everything, fails it.
 *
 * NO suppression comments are supported.
 *
 * Wired into CI (plan-a.yml `check` job). Run manually:
 *   bun run check:governed
 */
import type { AgentBindingSpec } from '@aihu/arbor'
import type { Signal } from '@aihu/signals'
import { JSDOM } from 'jsdom'
import {
  expectCount,
  expectedFrom,
  type Finding,
  refuseVacuous,
  selfTest,
} from './lib/invariant.ts'

// Workspace packages are imported by SOURCE, via the `check:governed` npm
// script's `bun --tsconfig-override ./tsconfig.json`.
//
// That flag is load-bearing, and the reason is not obvious. `@aihu/*` is NOT
// linked into `node_modules` (the install is isolated; `node_modules/@aihu`
// does not exist), so resolution falls to tsconfig `paths`. Bun applies the
// tsconfig NEAREST each file, and the per-package ones — e.g.
// `packages/arbor/tsconfig.json` — omit `baseUrl`, which makes bun ignore
// their `paths` entirely. So the entry's own imports resolve fine while a
// TRANSITIVE one dies: `packages/arbor/src/mount.ts` importing `@aihu/signals`
// fails. `--tsconfig-override` forces the root map on every file and fixes it.
//
// Without the flag this script does not merely mis-measure, it CRASHES before
// reporting — which is how it sat unverified in the WIP commit.
//
// Source, not `dist/`, on purpose: a behavioral invariant that reads a stale
// package build reports on a tree nobody is reviewing. Same trap as the stale
// compiler binary that once produced 24 phantom failures. Bare `bun` without
// the override silently resolves `@aihu/arbor` to a PUBLISHED 2.0.0 tarball in
// `~/.bun/install/cache` — measuring someone else's build, not this tree.
//
// Imports stay dynamic so a resolution failure surfaces here rather than at
// module-graph construction. Type-only imports above are erased entirely.
const { registerAgentMetadata } = await import('@aihu/agent')
const { createAgentService } = await import('@aihu/agent-service')
const { branch, leaf } = await import('@aihu/arbor')
const { BRIDGE_PROTOCOL_VERSION, createAgentServer } = await import('@aihu/agent-server')
const { signal } = await import('@aihu/signals')

const NAME = 'check:governed'
const SELF_TEST = process.argv.includes('--self-test-only')

const TAG = 'governed-probe'
const ACTION = 'increment'

/** A gate rejection envelope, as `jsonrpcError` produces it. */
interface Envelope {
  error?: string
  code?: number
  result?: unknown
}

// ─── G1: declared control, plugin absent ─────────────────────────────────────

/**
 * A real LiveBinding whose `callAction` has an OBSERVABLE side effect. If the
 * gate lets the call through, `dispatched` flips — so "did the gate deny" is
 * answered by behavior, not by inspecting a return shape alone.
 */
function makeBinding(
  scopeStr: string | null,
  rateLimitStr: string | null,
): LiveBinding & { dispatched(): boolean } {
  let dispatched = false
  return {
    rootId: 1,
    tag: TAG,
    getSignal: () => undefined,
    setSignal: () => {},
    async callAction(name: string): Promise<unknown> {
      if (name !== ACTION) throw new Error(`no action: ${name}`)
      dispatched = true
      return { ok: true }
    },
    scope: () => scopeStr,
    rateLimit: () => rateLimitStr,
    dispose$: () => true,
    dispatched: () => dispatched,
  }
}

interface G1Cell {
  readonly label: string
  /** `$scope` / `$rate-limit` as declared on the binding. */
  readonly scope: string | null
  readonly rateLimit: string | null
  /** Whether the corresponding plugin is supplied. */
  readonly plugin: boolean
  /** Codes that constitute a correct fail-closed denial. */
  readonly expectDenyCodes: readonly number[] | null
}

/**
 * The probe matrix. The undeclared cells are the must-not-flag half: a control
 * that is simply NOT declared must dispatch normally, or the check is just
 * "deny everything".
 */
const G1_MATRIX: readonly G1Cell[] = [
  {
    label: '$scope declared, authPlugin absent',
    scope: 'admin',
    rateLimit: null,
    plugin: false,
    expectDenyCodes: [401],
  },
  {
    label: '$rate-limit declared, rateLimitPlugin absent',
    scope: null,
    rateLimit: '10/min',
    plugin: false,
    expectDenyCodes: [429, 401, 403],
  },
  {
    label: 'no control declared, no plugin (must dispatch)',
    scope: null,
    rateLimit: null,
    plugin: false,
    expectDenyCodes: null,
  },
  {
    label: '$rate-limit declared, plugin present and permissive (must dispatch)',
    scope: null,
    rateLimit: '10/min',
    plugin: true,
    expectDenyCodes: null,
  },
]

interface ProbeOutcome {
  readonly label: string
  readonly denied: boolean
  readonly code: number | undefined
  readonly dispatched: boolean
  readonly correct: boolean
  readonly detail: string
}

/**
 * @param regressed When true, reproduce the PRE-GO1 defect using real code
 *   only: hand every `$rate-limit` cell an always-permissive plugin, so the
 *   declared control runs but never denies — observationally identical to the
 *   old `if (rateLimitSpec !== null && rateLimitPlugin)` guard skipping it.
 *   The should-flag cells must flip to "not denied" under this, which is what
 *   proves the probe can still see the violation it was written for.
 */
async function runG1Cell(cell: G1Cell, regressed: boolean): Promise<ProbeOutcome> {
  const binding = makeBinding(cell.scope, cell.rateLimit)
  const registry = new Map<string, LiveBinding[]>([[TAG, [binding]]])
  const regressRateLimit = regressed && cell.rateLimit !== null && !cell.plugin

  // #420: the gate requires a signature-VERIFIED principal before it will even
  // consult a rate limit. Rate-limit-only cells get a verify-capable
  // authPlugin so the outcome they measure is specifically the RATE-LIMIT
  // control (429 when its plugin is absent), not the earlier 401 principal
  // refusal — which also keeps the discrimination proof's distinct-codes axis
  // honest. Scope cells keep their declared authPlugin absence.
  const verifyingAuth = {
    checkScope: () => true,
    verify: async (jwt: string) => (jwt === 'probe-jwt' ? { sub: 'probe-user' } : null),
  }

  // The action IS advertised in metadata, so the 404 "unknown action" branch
  // cannot fire. This is the explicit anti-AC11 guard: we assert the GATE's
  // 401/429, never merely `ok === false`, and never the invoker's own
  // rejection of an unknown name.
  const service = createAgentService({
    manifests: [{ tag: TAG, describes: 'probe', actions: { [ACTION]: { returns: {} } } }],
    getRegistry: () => registry,
    ...(cell.plugin && cell.scope ? { authPlugin: { checkScope: () => true } } : {}),
    ...(cell.scope === null && cell.rateLimit !== null ? { authPlugin: verifyingAuth } : {}),
    ...((cell.plugin && cell.rateLimit) || regressRateLimit
      ? { rateLimitPlugin: { checkRateLimit: () => true } }
      : {}),
  })

  const ctx: RequestContext = { userId: 'probe-user', jwt: 'probe-jwt' }
  const env = (await service.handleToolCall(`${TAG}/${ACTION}`, [], ctx)) as Envelope

  const code = typeof env.code === 'number' ? env.code : undefined
  const denied = code !== undefined
  const dispatched = binding.dispatched()

  if (cell.expectDenyCodes === null) {
    const correct = !denied
    return {
      label: cell.label,
      denied,
      code,
      dispatched,
      correct,
      detail: correct
        ? 'dispatched normally, as an undeclared/permitted control must'
        : `expected normal dispatch, got a denial (code ${code}) — the gate is denying an ` +
          'undeclared control, which would make the check "deny everything"',
    }
  }

  const correct = denied && cell.expectDenyCodes.includes(code!)
  return {
    label: cell.label,
    denied,
    code,
    dispatched,
    correct,
    detail: correct
      ? `gate denied with code ${code}, as required`
      : denied
        ? `gate denied but with code ${code}; expected one of ${cell.expectDenyCodes.join('/')}`
        : 'GATE DID NOT DENY — the declared control silently no-opped because its plugin is ' +
          `absent, and the action ${binding.dispatched() ? 'DISPATCHED' : 'returned'} instead. ` +
          'A control that evaporates with its plugin is not enforcement.',
  }
}

async function runG1(regressed: boolean): Promise<ProbeOutcome[]> {
  const out: ProbeOutcome[] = []
  for (const cell of G1_MATRIX) out.push(await runG1Cell(cell, regressed))
  return out
}

// ─── G2: bridge handshake verification ───────────────────────────────────────

/** Upper bound on any single bridge wait. Generous; only hit on a real hang. */
const BRIDGE_DEADLINE_MS = 2000

function sleep(ms: number): Promise<undefined> {
  return new Promise((r) => setTimeout(() => r(undefined), ms))
}

/** Poll `probe` until it yields a value or the deadline passes. */
async function waitFor<T>(probe: () => T | undefined, deadlineMs: number): Promise<T | undefined> {
  const until = Date.now() + deadlineMs
  for (;;) {
    const v = probe()
    if (v !== undefined) return v
    if (Date.now() >= until) return undefined
    await sleep(5)
  }
}

function domHost(): Element {
  return new JSDOM('<!DOCTYPE html><body></body>').window.document.body
}

/** A real in-memory bridge channel; outbound frames are captured. */
function makeChannel(sent: string[]): BridgeChannel & { reply(data: string): void } {
  let onMsg: ((d: string) => void) | null = null
  return {
    get connected() {
      return true
    },
    send: (d: string) => {
      sent.push(d)
    },
    onMessage(h) {
      onMsg = h
      return () => {
        onMsg = null
      }
    },
    onClose() {
      return () => {}
    },
    reply(d: string) {
      onMsg?.(d)
    },
  }
}

function makeComponent(): { node: ReturnType<typeof branch>; agentBinding: AgentBindingSpec } {
  const [count, setCount] = signal(0)
  const sig = [count, setCount] as unknown as Signal<string>
  return {
    node: branch('div', { id: TAG }, [leaf(sig)]),
    agentBinding: {
      tag: TAG,
      actions: { [ACTION]: () => setCount(count() + 1) },
      reads: { count: () => count() },
      writes: { count: (v: unknown) => setCount(Number(v)) },
    },
  }
}

interface G2Sub {
  readonly label: string
  /** The `hello` protocol to send before invoking, or null to send none. */
  readonly protocol: number | string | null
  /**
   * `true` when the channel is legitimate and the server MUST delegate to it.
   * This is the anti-vacuity half: without it, "refuse every channel" would
   * score a perfect G2, and the fix would be indistinguishable from breaking
   * the bridge outright.
   */
  readonly mustDelegate?: boolean
}

const G2_SUBPROBES: readonly G2Sub[] = [
  { label: 'invoke with NO hello sent at all', protocol: null },
  {
    label: 'hello with protocol = BRIDGE_PROTOCOL_VERSION + 1',
    protocol: BRIDGE_PROTOCOL_VERSION + 1,
  },
  {
    label: "hello with protocol = 'not-a-number'",
    protocol: 'not-a-number',
  },
  {
    label: 'hello with a VALID protocol (must delegate)',
    protocol: BRIDGE_PROTOCOL_VERSION,
    mustDelegate: true,
  },
]

/**
 * Drive a real `createAgentServer` with a channel that never completes a valid
 * handshake, then call an approved tool.
 *
 * The observable: does the server DELEGATE to the unverified channel? A frame
 * on the wire proves the channel became the execution authority without ever
 * having proved which protocol it speaks. A correct implementation refuses to
 * treat an unhandshaken channel as the authoritative instance.
 */
async function runG2Sub(sub: G2Sub, regressed: boolean): Promise<ProbeOutcome> {
  registerAgentMetadata({
    tag: TAG,
    describes: 'probe',
    actions: { [ACTION]: { returns: {} } },
    state: {},
  })
  const comp = makeComponent()
  const server = createAgentServer({
    target: { node: comp.node, agentBinding: comp.agentBinding },
    createHost: domHost,
    verifyBridgeSession: (token) => ({
      identity: token === 'probe-session-token' ? 'probe-session' : '',
      grantVersion: 'probe-grant',
    }),
    reauthorizeBridgeInvoke: (binding) =>
      binding.sessionToken === 'probe-session-token'
        ? { identity: binding.identity, grantVersion: binding.grantVersion }
        : false,
  })
  try {
    const sent: string[] = []
    const channel = makeChannel(sent)
    server.attachBridge(channel)

    // `--self-test` REGRESSION (no shim): substitute a real valid handshake
    // for each must-reject case. A verified channel delegates through the real
    // bridge path; v2 treats a second hello as a revocation, so the pre-v2
    // "prepend a good hello" technique would mask the regression instead.
    const protocol = regressed ? BRIDGE_PROTOCOL_VERSION : sub.protocol
    if (protocol !== null) {
      channel.reply(
        JSON.stringify({
          type: 'hello',
          protocol,
          nonce: server.issueBridgeNonce().nonce,
          sessionToken: 'probe-session-token',
          sessionIdentity: 'probe-session',
          grantVersion: 'probe-grant',
        }),
      )
    }

    const call = server.callTool(`${TAG}/${ACTION}`, [], { userId: 'probe-user', jwt: 'j' })
    // `callTool` awaits the gate before forwarding, so the wire is still empty
    // on this tick. Poll for the frame, then answer it — the bridge path waits
    // on a browser reply that would otherwise never come. A hard deadline
    // bounds every wait: an invariant that HANGS in CI is worse than one that
    // fails, because it looks like infrastructure flake rather than a defect.
    const frame = await waitFor(() => sent.find((s) => s.includes('"invoke"')), BRIDGE_DEADLINE_MS)
    if (frame) {
      const parsed = JSON.parse(frame) as { callId: string }
      channel.reply(JSON.stringify({ type: 'result', callId: parsed.callId, result: null }))
    }
    await Promise.race([call, sleep(BRIDGE_DEADLINE_MS)])

    const delegated = frame !== undefined
    const correct = sub.mustDelegate === true ? delegated : !delegated
    return {
      label: sub.label,
      denied: !delegated,
      code: undefined,
      dispatched: delegated,
      correct,
      detail: sub.mustDelegate
        ? delegated
          ? 'server delegated to the properly handshaken channel, as it must'
          : 'server REFUSED a channel that sent a valid `hello` — the handshake check has ' +
            'become "reject everything", which breaks the bridge instead of governing it.'
        : delegated
          ? 'server FORWARDED an `invoke` to a channel that never completed a valid handshake — ' +
            'the unverified channel became the execution authority. BRIDGE_PROTOCOL_VERSION is ' +
            'sent and exported but never compared against anything.'
          : 'server refused to delegate to the unverified channel',
    }
  } finally {
    server.dispose()
  }
}

async function runG2(regressed: boolean): Promise<ProbeOutcome[]> {
  const out: ProbeOutcome[] = []
  for (const sub of G2_SUBPROBES) out.push(await runG2Sub(sub, regressed))
  return out
}

// ─── G3: rate-limit key provenance (#420) ────────────────────────────────────
//
// The reported attack: rate-limit keys were `${context.userId}:${tag}` with
// `userId` caller-supplied and never cross-checked against the JWT `sub`, so
// rotating `userId` reset the caller's own quota. The fix derives the key
// from the signature-verified principal (`AuthPlugin.verify(jwt).sub`).
//
// BEHAVIORAL, like G1/G2 (the issue allowed a static probe; a behavioral one
// is strictly stronger — it measures what the gate DOES, not what its source
// mentions). The probe replays the attack against a real `AgentService` and
// observes the keys the rate-limit plugin is actually consulted with:
//   1. one credential, two rotated caller userIds → BOTH calls must land in
//      the SAME bucket, keyed by the verified sub — and neither rotated
//      identity may appear in any key; and
//   2. an unverifiable credential → 401, with the limiter NEVER consulted
//      (no fall-through to caller claims).
//
// `--self-test` REGRESSION (real code path, no shim): the regressed plugin's
// `verify` ECHOES the caller-supplied identity as `sub`. The gate then keys
// buckets off whatever the caller claimed — observationally identical to the
// pre-#420 `${userId}:${tag}` derivation — and the probe must flag it.

const G3_SUB = 'g3-verified-principal'
const G3_JWT = 'g3-signed-token'

async function runG3(regressed: boolean): Promise<ProbeOutcome[]> {
  const binding = makeBinding(null, '100/min')
  const registry = new Map<string, LiveBinding[]>([[TAG, [binding]]])
  const usedKeys: string[] = []
  let callerIdentity = ''

  const service = createAgentService({
    manifests: [{ tag: TAG, describes: 'probe', actions: { [ACTION]: { returns: {} } } }],
    getRegistry: () => registry,
    authPlugin: {
      checkScope: () => true,
      verify: async (jwt: string) => {
        if (regressed) return { sub: callerIdentity } // caller controls the principal
        return jwt === G3_JWT ? { sub: G3_SUB } : null
      },
    },
    rateLimitPlugin: {
      checkRateLimit: (_spec: string, key: string) => {
        usedKeys.push(key)
        return true
      },
    },
  })

  // The attack: same credential, rotated caller identity.
  for (const caller of ['rotated-a', 'rotated-b']) {
    callerIdentity = caller
    await service.handleToolCall(`${TAG}/${ACTION}`, [], { userId: caller, jwt: G3_JWT })
  }
  const rotationKeys = [...usedKeys]

  // An unverifiable credential must be refused before the limiter is touched.
  callerIdentity = 'rotated-c'
  const forgedEnv = (await service.handleToolCall(`${TAG}/${ACTION}`, [], {
    userId: 'rotated-c',
    jwt: 'not-a-signed-token',
  })) as Envelope
  const forgedDenied401 = forgedEnv.code === 401
  const limiterUntouchedByForged = usedKeys.length === rotationKeys.length

  const expectedKey = `${G3_SUB}:${TAG}`
  const sameVerifiedBucket =
    rotationKeys.length === 2 && rotationKeys.every((k) => k === expectedKey)
  const callerLeaked = rotationKeys.some((k) => k.includes('rotated-'))

  const correct = sameVerifiedBucket && !callerLeaked && forgedDenied401 && limiterUntouchedByForged
  return [
    {
      label: 'rate-limit key derives from the VERIFIED principal, not caller context',
      denied: forgedDenied401,
      code: forgedEnv.code,
      dispatched: binding.dispatched(),
      correct,
      detail: correct
        ? `both rotated-identity calls keyed ${expectedKey}; unverifiable credential got 401 ` +
          'with the limiter untouched'
        : callerLeaked || !sameVerifiedBucket
          ? `CALLER CONTROLS THE BUCKET KEY — observed keys [${rotationKeys.join(', ')}], ` +
            `expected [${expectedKey}, ${expectedKey}]. A caller that rotates its ` +
            'context.userId mints itself a fresh quota; the key must come from the ' +
            'signature-verified JWT `sub`, never from caller-supplied context.'
          : `unverifiable credential was not refused cleanly (code ${forgedEnv.code}, limiter ` +
            `consulted ${usedKeys.length - rotationKeys.length} extra time(s)) — verification ` +
            'must complete, and fail closed, before any quota is consumed',
    },
  ]
}

// ─── G4/G5 shared fixture (GX Phase 5, #467) ─────────────────────────────────

const {
  forgedDecodableToken,
  govReq,
  GX_ENTITLED_HEADWORD,
  GX_GOVERNED_SENTINELS,
  GX_PREVIEW_HEADWORD,
  GX_SECRET,
  htmlOf,
  loaderJsonOf,
  loadGovernedCensus,
  makeGovernedComponent,
  makeGovernedFixture,
  segmentsOf,
} = await import('./lib/governed-fixture.ts')

/** Do any governed sentinel bytes appear in this channel? */
function sentinelLeaks(bytes: string): string[] {
  return GX_GOVERNED_SENTINELS.filter((s) => bytes.includes(s))
}

/** The `$gx` discriminant off a parsed loader/E3 JSON payload, or null. */
function gxOf(json: unknown): { entitled?: boolean; reason?: string } | null {
  if (typeof json !== 'object' || json === null) return null
  const gx = (json as { $gx?: unknown }).$gx
  return typeof gx === 'object' && gx !== null ? (gx as { entitled?: boolean }) : null
}

function outcome(label: string, correct: boolean, ok: string, bad: string): ProbeOutcome {
  return {
    label,
    denied: false,
    code: undefined,
    dispatched: false,
    correct,
    detail: correct ? ok : bad,
  }
}

// ─── G4a: no governed surface reaches emission ungated (I2) ──────────────────

async function runG4a(regressed: boolean): Promise<ProbeOutcome[]> {
  const out: ProbeOutcome[] = []
  const census = loadGovernedCensus()
  const { createServerRouter } = await import('@aihu/router/server')
  const { renderToString } = await import('@aihu/server')
  const component = await makeGovernedComponent()

  // a1 — a `data:` route must REFUSE TO BOOT with no registry (spec §2.3).
  // Regressed arm: the census row has lost `data:` (fan-out drop), so the
  // route boots ungated — precisely the silence this cell exists to forbid.
  {
    const routes = [
      {
        pattern: census.pattern,
        segments: segmentsOf(census.pattern),
        module: async () => ({ default: component }),
        extract: census.extract,
        ...(regressed ? {} : { data: census.data }),
      },
    ] as never
    let threw: string | null = null
    try {
      createServerRouter(routes)
    } catch (e) {
      threw = (e as Error).message
    }
    out.push(
      outcome(
        'a1: data: route with NO registry refuses to boot',
        threw !== null && /never boot ungated/.test(threw),
        'boot refusal, naming the ungated governed route',
        threw === null
          ? 'a governed route BOOTED with no registry — it will serve with no gate anywhere ' +
              '(invariant I2 violated at init)'
          : `boot threw, but not the ungated-governed refusal: ${threw}`,
      ),
    )
  }

  // a2 — a MALFORMED census `data` is a boot refusal, never rounded to
  // ungoverned (the fail-closed posture of `normalizeGovernedData`).
  {
    const routes = [
      {
        pattern: census.pattern,
        segments: segmentsOf(census.pattern),
        module: async () => ({ default: component }),
        extract: census.extract,
        data: { type: '' },
      },
    ] as never
    let threw: string | null = null
    try {
      createServerRouter(routes)
    } catch (e) {
      threw = (e as Error).message
    }
    out.push(
      outcome(
        'a2: malformed census data: is a boot refusal (fail-closed)',
        threw !== null && /malformed/.test(threw),
        'malformed declaration refused at boot',
        'a corrupted data: declaration was rounded to ungoverned instead of refused',
      ),
    )
  }

  // a3 — anonymous request: the gate's own 401, provider untouched, ZERO
  // governed sentinel bytes in the whole response.
  {
    const fx = await makeGovernedFixture(regressed ? { ungoverned: true } : {})
    const res = await fx.router.handle(govReq(fx.path))
    const body = await res.text()
    const leaks = sentinelLeaks(body)
    const correct = res.status === 401 && leaks.length === 0 && fx.counts.fetch === 0
    out.push(
      outcome(
        'a3: anonymous request → gate 401, provider never invoked, zero sentinel bytes',
        correct,
        'withheld with the AUTH ladder status; provider fetch count 0; response byte-clean',
        `status ${res.status} (expected 401), provider fetch count ${fx.counts.fetch} ` +
          `(expected 0), leaked sentinel(s): [${leaks.join(', ') || 'none'}] — a governed ` +
          'surface reached emission without the generated loader gating it',
      ),
    )
  }

  // a4 — entitled request is emitted THROUGH the gate: the loader JSON carries
  // the `$gx` discriminant the emission stage stamps (a raw ungated payload
  // has no `$gx` — which is how the regressed arm is caught even at 200).
  {
    const fx = await makeGovernedFixture(regressed ? { ungoverned: true } : {})
    const res = await fx.router.handle(govReq(fx.path, 'member-token'))
    const body = await res.text()
    const gx = gxOf(loaderJsonOf(body))
    const correct = res.status === 200 && gx?.entitled === true && fx.counts.fetch === 1
    out.push(
      outcome(
        'a4: entitled request → 200 emitted through the gate ($gx.entitled)',
        correct,
        'granted emission carries the gate discriminant; provider invoked exactly once',
        `status ${res.status}, $gx ${JSON.stringify(gx)}, fetch count ${fx.counts.fetch} — ` +
          'the payload is being served WITHOUT the emission stage (no $gx discriminant), ' +
          'i.e. outside the generated loader',
      ),
    )
  }

  // a5 — GOVERNED_UNGATED (I2s): a pending dataSource inside a governed render
  // is refused fail-closed; a settled one still renders (the must-not-flag
  // half, so "refuse every governed render" cannot pass).
  {
    const pendingNode = {
      kind: 'branch',
      tag: 'div',
      attrs: {},
      children: [],
      dataSource: { status: 'pending', onReady: () => () => {} },
    }
    let refused = false
    try {
      await renderToString(() => pendingNode, { hydratable: true, governed: true })
    } catch (e) {
      refused = /GOVERNED_UNGATED/.test((e as Error).message)
    }
    let settledRenders = false
    try {
      const html = await renderToString(
        () => ({ ...pendingNode, dataSource: { status: 'ready', onReady: () => () => {} } }),
        { hydratable: true, governed: true },
      )
      settledRenders = html.includes('<div')
    } catch {
      settledRenders = false
    }
    out.push(
      outcome(
        'a5: pending dataSource in a governed render → GOVERNED_UNGATED (settled renders)',
        refused && settledRenders,
        'governed trees refuse to stream/suspend; settled governed trees still render',
        refused
          ? 'a SETTLED governed render was refused — the guard has become "refuse everything"'
          : 'a pending dataSource inside a governed render was NOT refused — an emission ' +
              'path exists that the generated loader never gated (I2s)',
      ),
    )
  }

  return out
}

// ─── G4b: absent auth material fails closed at the content boundary ──────────

async function runG4b(regressed: boolean): Promise<ProbeOutcome[]> {
  const out: ProbeOutcome[] = []

  // b1 — hard-`read` governed route, NO auth material configured, request
  // PRESENTS a (real) credential: must deny, never serve. Regressed arm: an
  // accept-anything `verify` (the misconfigured-open boundary) serves it.
  {
    const fx = await makeGovernedFixture({ auth: regressed ? 'accept-anything' : 'none' })
    const res = await fx.router.handle(govReq(fx.path, 'member-token'))
    const body = await res.text()
    const leaks = sentinelLeaks(body)
    const correct =
      res.status === 401 && leaks.length === 0 && fx.counts.fetch === 0 && fx.counts.resolve === 0
    out.push(
      outcome(
        'b1: hard read, no auth plugin, credentialed request → deny (fail-closed)',
        correct,
        'denied 401 with provider and resolver untouched — the declared control does not ' +
          'evaporate with its plugin',
        `status ${res.status} (expected 401), fetch ${fx.counts.fetch}, resolve ` +
          `${fx.counts.resolve}, leaked [${leaks.join(', ') || 'none'}] — the content boundary ` +
          'served a governed surface without any credential verification path configured',
      ),
    )
  }

  // b2 — the positive control: WITH the real plugin the entitled member is
  // served. Without this, "deny everything" would score a perfect G4b.
  {
    const fx = await makeGovernedFixture()
    const res = await fx.router.handle(govReq(fx.path, 'member-token'))
    const body = await res.text()
    out.push(
      outcome(
        'b2: real plugin + entitled member → served (must not be "deny everything")',
        res.status === 200 && htmlOf(body).includes(GX_ENTITLED_HEADWORD),
        'entitled principal served through the gate',
        `status ${res.status} — the boundary refuses even a fully entitled principal, which ` +
          'breaks the surface instead of governing it',
      ),
    )
  }

  return out
}

// ─── G4c: verify-not-decode, meet ordering, reason exhaustiveness ────────────

async function runG4c(regressed: boolean): Promise<ProbeOutcome[]> {
  const out: ProbeOutcome[] = []
  const auth = regressed ? ('decode-only' as const) : ('real' as const)
  const observedReasons = new Set<string>()

  // c1 — the forged credential: payload decodes to fully entitled claims,
  // signature cannot verify. The boundary must resolve it ANONYMOUS (401),
  // with resolver and provider untouched.
  {
    const fx = await makeGovernedFixture({ auth })
    const res = await fx.router.handle(govReq(fx.path, forgedDecodableToken()))
    const body = await res.text()
    const gx = gxOf(loaderJsonOf(body))
    if (gx?.reason) observedReasons.add(gx.reason)
    const leaks = sentinelLeaks(body)
    const correct =
      res.status === 401 &&
      gx?.reason === 'auth' &&
      leaks.length === 0 &&
      fx.counts.resolve === 0 &&
      fx.counts.fetch === 0
    out.push(
      outcome(
        'c1: decodable-but-unverifiable credential → 401, resolver+provider untouched',
        correct,
        'the boundary demanded signature verification; the forged principal was never seated',
        `status ${res.status}, reason '${gx?.reason}', resolve ${fx.counts.resolve}, fetch ` +
          `${fx.counts.fetch}, leaked [${leaks.join(', ') || 'none'}] — the content gate ` +
          'accepted claims it never verified (decodeJwt posture); a hand-rolled token mints ' +
          'entitled access',
      ),
    )
  }

  // c2 — static meet BEFORE live resolver: a verified token WITHOUT the scope
  // is refused at the meet, and the resolver is never consulted (the cheap
  // check always runs first — §3.2; the live layer never widens — R3).
  {
    const fx = await makeGovernedFixture({ auth })
    const res = await fx.router.handle(govReq(fx.path, 'other-scope-token'))
    const body = await res.text()
    const gx = gxOf(loaderJsonOf(body))
    if (gx?.reason) observedReasons.add(gx.reason)
    const correct =
      res.status === 403 &&
      gx?.reason === 'scope' &&
      fx.counts.resolve === 0 &&
      fx.counts.fetch === 0 &&
      sentinelLeaks(body).length === 0
    out.push(
      outcome(
        'c2: wrong-scope token → 403 SCOPE at the static meet; resolver never consulted',
        correct,
        'static meet refused before the live stage ran (ordering holds)',
        `status ${res.status}, reason '${gx?.reason}', resolve count ${fx.counts.resolve} — ` +
          'either the meet did not refuse, or the live resolver ran BEFORE (or instead of) ' +
          'the static meet',
      ),
    )
  }

  // c3 — the live delta: scope carried, resolver says no → 403 'entitlement'
  // (the case static scopes cannot express), provider still untouched.
  {
    const fx = await makeGovernedFixture({ auth })
    const res = await fx.router.handle(govReq(fx.path, 'lapsed-token'))
    const body = await res.text()
    const gx = gxOf(loaderJsonOf(body))
    if (gx?.reason) observedReasons.add(gx.reason)
    const correct =
      res.status === 403 &&
      gx?.reason === 'entitlement' &&
      fx.counts.resolve === 1 &&
      fx.counts.fetch === 0 &&
      sentinelLeaks(body).length === 0
    out.push(
      outcome(
        "c3: lapsed member → 403 'entitlement' from the live resolver; provider untouched",
        correct,
        'live entitlement refused after the meet passed; governed bytes never fetched',
        `status ${res.status}, reason '${gx?.reason}', resolve ${fx.counts.resolve}, fetch ` +
          `${fx.counts.fetch} — the live-resolver rung is not producing its fail-closed refusal`,
      ),
    )
  }

  // c4 — resolver outage: NEVER presented as a verdict — 503 + Retry-After,
  // reason 'unavailable' (§4.3), provider untouched.
  {
    const fx = await makeGovernedFixture({ auth, resolver: 'throw' })
    const res = await fx.router.handle(govReq(fx.path, 'member-token'))
    const body = await res.text()
    const gx = gxOf(loaderJsonOf(body))
    if (gx?.reason) observedReasons.add(gx.reason)
    const correct =
      res.status === 503 &&
      gx?.reason === 'unavailable' &&
      res.headers.get('Retry-After') !== null &&
      fx.counts.fetch === 0 &&
      sentinelLeaks(body).length === 0
    out.push(
      outcome(
        "c4: resolver outage → 503 + Retry-After, reason 'unavailable' (never a verdict)",
        correct,
        'an outage withholds honestly (503) instead of asserting an entitlement fact',
        `status ${res.status}, reason '${gx?.reason}', Retry-After ` +
          `${res.headers.get('Retry-After')} — an outage is being presented as a verdict, or ` +
          'is not failing closed',
      ),
    )
  }

  // c5 — positive control: the entitled member is served under the same auth.
  {
    const fx = await makeGovernedFixture({ auth })
    const res = await fx.router.handle(govReq(fx.path, 'member-token'))
    out.push(
      outcome(
        'c5: entitled member → 200 (the ladder is not "deny everything")',
        res.status === 200,
        'entitled principal served',
        `status ${res.status} — every rung denies; the ladder collapsed into one blanket rule`,
      ),
    )
  }

  // c6 — exhaustiveness: the four fail-closed withheld reasons were EACH
  // observed with their own status above. A ladder that collapses two rungs
  // (or loses one) cannot produce all four.
  {
    const expected = ['auth', 'scope', 'entitlement', 'unavailable']
    const missing = expected.filter((r) => !observedReasons.has(r))
    out.push(
      outcome(
        'c6: fail-closed reasons exhaustive (auth/scope/entitlement/unavailable)',
        missing.length === 0,
        'all four withheld reasons observed, each with its distinct status',
        `missing reason(s): [${missing.join(', ')}] — the refusal ladder no longer ` +
          'discriminates its rungs; a collapsed ladder hides which control refused',
      ),
    )
  }

  return out
}

// ─── G5a: bundle/static absence — governed bytes never reach dist ────────────

/**
 * @param regressed Self-test should-flag arm: scan a page composed the way an
 *   inlining regression would compose it — the same component, renderer, and
 *   template, with the governed loader's output fetched at build time and
 *   embedded into the written HTML. Simulated (not a live-code mutation)
 *   because the live `runPrerender` correctly has NO code path that invokes a
 *   governed loader — which is exactly the property under guard; the mutation
 *   that would reintroduce it is the composition probed here. Same posture as
 *   DA-d's regressed arm in check-dual-audience.
 */
async function runG5a(regressed: boolean): Promise<ProbeOutcome[]> {
  const { mkdir, mkdtemp, readdir, readFile, rm, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { runPrerender } = await import('../packages/app/src/prerender.ts')
  const { renderToString } = await import('@aihu/server')

  const component = await makeGovernedComponent()
  let buildTimeFetches = 0
  const governedLoader = {
    _brand: 'DefinedGovernedFetch' as const,
    fetch: async () => {
      buildTimeFetches++
      return { headword: GX_ENTITLED_HEADWORD, senses: [GX_SECRET] }
    },
  }

  const root = await mkdtemp(join(tmpdir(), 'aihu-g5a-'))
  try {
    const outDir = join(root, 'dist')
    await mkdir(join(root, 'pages'), { recursive: true })
    await mkdir(outDir, { recursive: true })
    const template =
      '<!doctype html><html><head><title>t</title></head><body><div id="outlet"></div></body></html>'
    await writeFile(join(outDir, 'index.html'), template)
    await writeFile(join(root, 'pages', 'index.ts'), '// governed route stub\n')

    await runPrerender({
      resolvedViteConfig: { root, build: { outDir: 'dist' } } as never,
      config: undefined,
      loadModule: async () => ({ default: component, loader: governedLoader as never }),
      warn: () => {},
    })

    // EVERY byte under dist/ — HTML, assets, anything the build wrote.
    const files: string[] = []
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name)
        if (entry.isDirectory()) await walk(p)
        else files.push(p)
      }
    }
    await walk(outDir)
    let corpus = (await Promise.all(files.map((f) => readFile(f, 'utf8')))).join('\n')

    if (regressed) {
      const data = await governedLoader.fetch()
      const rendered = await renderToString(
        () =>
          component({
            route: { params: { slug: 'logos' }, data: { ...data, $gx: { entitled: true } } },
          }),
        { hydratable: true },
      )
      corpus = template.replace(
        '<div id="outlet"></div>',
        `<div id="outlet">${rendered}</div>` +
          `<script type="application/json" id="__aihu_loader__">${JSON.stringify(data)}</script>`,
      )
    }

    const leaks = sentinelLeaks(corpus)
    const fetchesOk = regressed ? true : buildTimeFetches === 0
    return [
      outcome(
        `G5a: governed sentinels absent from all ${files.length} static build artifact(s)`,
        leaks.length === 0 && fetchesOk && files.length > 0,
        'no provider-sourced governed byte reached the static output; governed loader never ' +
          'invoked at build time',
        `leaked sentinel(s) [${leaks.join(', ') || 'none'}]; build-time governed fetches ` +
          `${buildTimeFetches} — governed data is being baked into client-shipped bytes, ` +
          'where no per-request gate can ever run again',
      ),
    ]
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

// ─── G5b: the E3 governed-data endpoint — same decisions, gated, not open ────

/**
 * @param regressed Self-test should-flag arm: the SAME assertion battery run
 *   against an always-200 OPEN endpoint stub (granted payload for everyone,
 *   every method, every path) — the "second, ungated data path" the endpoint
 *   must never become. A checker-discrimination control (the live endpoint
 *   has no real knob that opens it; that absence is the property).
 */
async function runG5b(regressed: boolean): Promise<ProbeOutcome[]> {
  const out: ProbeOutcome[] = []
  const fx = await makeGovernedFixture()
  const granted = JSON.stringify({
    headword: GX_ENTITLED_HEADWORD,
    senses: [GX_SECRET],
    $gx: { entitled: true },
  })
  const e3 = (req: Request): Promise<Response> =>
    regressed
      ? Promise.resolve(
          new Response(granted, { status: 200, headers: { 'Content-Type': 'application/json' } }),
        )
      : fx.router.handle(req)

  // b1 — anonymous: the gate's 401, withheld JSON shape only, byte-clean,
  // per-principal cache discipline.
  {
    const res = await e3(govReq(fx.dataPath))
    const body = await res.text()
    const leaks = sentinelLeaks(body)
    let keysOk = false
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>
      keysOk = Object.keys(parsed).every((k) => k === '$gx' || k === 'preview')
    } catch {
      keysOk = false
    }
    const correct =
      res.status === 401 &&
      leaks.length === 0 &&
      keysOk &&
      res.headers.get('Cache-Control') === 'private'
    out.push(
      outcome(
        'G5b/1: anonymous E3 fetch → 401, Withheld<T> shape only, private',
        correct,
        'endpoint withholds with the same fail-closed shape as SSR',
        `status ${res.status}, leaked [${leaks.join(', ') || 'none'}], withheld-shape ` +
          `${keysOk}, Cache-Control ${res.headers.get('Cache-Control')} — the governed-data ` +
          'endpoint serves anonymously (an open data path beside the gated SSR channel)',
      ),
    )
  }

  // b2 — entitled: the full granted payload rides the endpoint.
  {
    const res = await e3(govReq(fx.dataPath, 'member-token'))
    const body = await res.text()
    const gx = gxOf(JSON.parse(body))
    const correct = res.status === 200 && gx?.entitled === true && body.includes(GX_SECRET)
    out.push(
      outcome(
        'G5b/2: entitled E3 fetch → 200 granted payload',
        correct,
        'entitled principal receives the granted emission over the data transport',
        `status ${res.status}, $gx ${JSON.stringify(gx)} — the endpoint refuses (or truncates) ` +
          'what the gate granted',
      ),
    )
  }

  // b3 — transport parity: per principal, E3 status ≡ SSR status and the two
  // channels carry the SAME `$gx` decision (one contract, byte-equal
  // decisions — spec §3.3).
  {
    const mismatches: string[] = []
    for (const [label, jwt] of [
      ['anonymous', undefined],
      ['entitled', 'member-token'],
      ['lapsed', 'lapsed-token'],
    ] as const) {
      const ssrRes = await fx.router.handle(govReq(fx.path, jwt))
      const ssrGx = gxOf(loaderJsonOf(await ssrRes.text()))
      const e3Res = await e3(govReq(fx.dataPath, jwt))
      let e3Gx: unknown = null
      try {
        e3Gx = gxOf(JSON.parse(await e3Res.text()))
      } catch {
        e3Gx = null
      }
      if (ssrRes.status !== e3Res.status || JSON.stringify(ssrGx) !== JSON.stringify(e3Gx)) {
        mismatches.push(
          `${label}: SSR ${ssrRes.status}/${JSON.stringify(ssrGx)} vs E3 ` +
            `${e3Res.status}/${JSON.stringify(e3Gx)}`,
        )
      }
    }
    out.push(
      outcome(
        'G5b/3: transport parity — E3 serves the SAME gate decisions as SSR',
        mismatches.length === 0,
        'per-principal status and $gx agree across both transports',
        `decision drift between transports: ${mismatches.join('; ')} — the two channels are ` +
          'no longer one boundary',
      ),
    )
  }

  // b4 — non-GET refused; b5 — an ungoverned path is 404, indistinguishable
  // from absent (the endpoint never becomes a second open data path).
  {
    const post = await e3(new Request(`http://governed.probe${fx.dataPath}`, { method: 'POST' }))
    out.push(
      outcome(
        'G5b/4: non-GET on the data endpoint → 405',
        post.status === 405,
        'method discipline holds',
        `status ${post.status} — the endpoint accepts writes/other methods`,
      ),
    )
    const unknown = await e3(govReq('/__aihu/data/not-a-governed-route'))
    const unknownBody = await unknown.text()
    out.push(
      outcome(
        'G5b/5: ungoverned/unknown path on the endpoint → 404, byte-clean',
        unknown.status === 404 && sentinelLeaks(unknownBody).length === 0,
        'existence is never confirmed; nothing ungoverned is served here',
        `status ${unknown.status} — the governed-data endpoint answers for paths the gate ` +
          'does not govern',
      ),
    )
  }

  return out
}

// ─── G5c: entitled completeness (honest ceiling: #465) ───────────────────────

/**
 * @param regressed Self-test should-flag arm: the HISTORICAL pre-P4 seam,
 *   reproduced with real code — the render invoked WITHOUT the emission
 *   threaded as props (`renderToString(component)` bare), payload only in the
 *   JSON embed. That is byte-for-byte the regression the P4 integration fix
 *   closed (see the e2e header), so the probe discriminates on the exact edit
 *   that would reintroduce it.
 */
async function runG5c(regressed: boolean): Promise<ProbeOutcome[]> {
  const out: ProbeOutcome[] = []
  const fx = await makeGovernedFixture()
  const { renderToString } = await import('@aihu/server')
  const component = await makeGovernedComponent()

  let body: string
  if (regressed) {
    const payload = { headword: GX_ENTITLED_HEADWORD, senses: [GX_SECRET], $gx: { entitled: true } }
    const html = await renderToString(() => component(), { hydratable: true, governed: true })
    body = `${html}<script type="application/json" id="__aihu_loader__">${JSON.stringify(payload)}</script>`
  } else {
    const res = await fx.router.handle(govReq(fx.path, 'member-token'))
    body = await res.text()
  }
  const html = htmlOf(body)
  const loaderJson = loaderJsonOf(body) as {
    headword?: string
    senses?: string[]
    $gx?: { entitled?: boolean }
  } | null

  // Direct interpolations ARE server-rendered today — completeness is
  // load-bearing for them now.
  {
    const correct = html.includes(`>${GX_ENTITLED_HEADWORD}</h1>`) && html.includes('>logos</p>')
    out.push(
      outcome(
        'G5c/1: entitled HTML carries every direct-interpolation governed value',
        correct,
        'granted headword and route params are in the server HTML (reachable without JS)',
        'the entitled render is missing granted direct-interpolation content — the emission ' +
          'is not threaded into the render (the pre-P4 seam: payload rides only the JSON embed)',
      ),
    )
  }

  // The loader channel carries the FULL granted payload (the channel that is
  // load-bearing for `{#if}`-guarded content until #465 lands).
  {
    const correct =
      loaderJson?.$gx?.entitled === true &&
      loaderJson?.headword === GX_ENTITLED_HEADWORD &&
      Array.isArray(loaderJson?.senses) &&
      loaderJson.senses.includes(GX_SECRET)
    out.push(
      outcome(
        'G5c/2: entitled loader JSON carries the complete granted payload',
        correct,
        'everything the gate granted is in the response (loader channel)',
        `loader payload ${JSON.stringify(loaderJson)} — granted content the gate emitted is ` +
          'missing from the entitled response',
      ),
    )
  }

  // AUTO-TIGHTENING (#465 honest ceiling): structural `{#if}` renders EMPTY
  // server-side today, so entitled-only `$if` content is NOT required in the
  // HTML yet. The moment the structural-directive SSR walk lands, the
  // `gx-senses` boundary appears in entitled HTML — and this cell then
  // REQUIRES the sentinel in the HTML channel. Never assert the inverse
  // (absence), so landing the walk cannot turn this red.
  {
    const structuralLanded = html.includes('gx-senses')
    const correct = structuralLanded ? html.includes(GX_SECRET) : true
    out.push(
      outcome(
        structuralLanded
          ? 'G5c/3: structural SSR walk detected — $if-guarded governed content REQUIRED in HTML'
          : 'G5c/3: structural {#if} not server-rendered yet (#465) — HTML channel not load-bearing for $if content',
        correct,
        structuralLanded
          ? 'the structural walk landed and the entitled HTML carries the guarded content'
          : 'honest ceiling recorded; this cell tightens automatically when the walk lands',
        'the structural boundary renders server-side but the granted guarded content is ' +
          'missing from entitled HTML — completeness regressed at the promoted channel',
      ),
    )
  }

  // Withheld-side completeness: the DECLARED preview renders for a withheld
  // principal (locked-state content is part of the contract too).
  {
    const res = await fx.router.handle(govReq(fx.path))
    const withheldHtml = htmlOf(await res.text())
    out.push(
      outcome(
        'G5c/4: withheld HTML renders the declared preview fields',
        withheldHtml.includes(GX_PREVIEW_HEADWORD),
        'the declared-public preview is server-rendered in the locked state',
        'the withheld render lost the declared preview — the locked state ships less than ' +
          'the author declared public',
      ),
    )
  }

  return out
}

// ─── Self-test ───────────────────────────────────────────────────────────────

async function runSelfTest(): Promise<void> {
  // Should-NOT-flag half: the real, unmutated tree. GO1 and GO2 have landed, so
  // this must be clean — and it is the REAL server producing that, not a shim.
  const g1Live = await runG1(false)
  const g2Live = await runG2(false)
  const g3Live = await runG3(false)
  // Should-flag half: the same real code paths, regressed to their pre-fix
  // behaviour (permissive rate-limit plugin / substituted valid v2 handshake /
  // caller-echoing principal). The probes must still see the violations they
  // were written for.
  const g1Regressed = await runG1(true)
  const g2Regressed = await runG2(true)
  const g3Regressed = await runG3(true)

  // GX Phase 5 (#467): the governed-data-boundary families, same discipline —
  // live tree as the should-not-flag arm, regressions through real code (or,
  // where the live tree has no opening knob, a documented composition of the
  // exact regression shape) as the should-flag arm. Expected regressed counts
  // are EXACT: a probe that flags more or fewer cells than its regression
  // touches is mis-attributing, which is its own defect.
  const g4aLive = await runG4a(false)
  const g4bLive = await runG4b(false)
  const g4cLive = await runG4c(false)
  const g5aLive = await runG5a(false)
  const g5bLive = await runG5b(false)
  const g5cLive = await runG5c(false)
  const g4aRegressed = await runG4a(true)
  const g4bRegressed = await runG4b(true)
  const g4cRegressed = await runG4c(true)
  const g5aRegressed = await runG5a(true)
  const g5bRegressed = await runG5b(true)
  const g5cRegressed = await runG5c(true)

  selfTest(NAME, [
    {
      label: 'should-not-flag: fail-closed rate limiting (live tree, GO1 landed)',
      actual: g1Live.filter((o) => !o.correct).length,
      expected: 0,
    },
    {
      label: 'should-not-flag: verified handshake (live tree, GO2 landed)',
      actual: g2Live.filter((o) => !o.correct).length,
      expected: 0,
    },
    {
      label: 'should-not-flag: verified-principal rate-limit keys (live tree, #420 landed)',
      actual: g3Live.filter((o) => !o.correct).length,
      expected: 0,
    },
    {
      label: 'should-flag: rate-limit control that does not enforce (regressed)',
      actual: g1Regressed.filter((o) => !o.correct).length,
      expected: 1,
    },
    {
      label: 'should-flag: bridge sub-probes delegated unverified (regressed)',
      actual: g2Regressed.filter((o) => !o.correct).length,
      expected: 3,
    },
    {
      label: 'should-flag: caller-controlled rate-limit key (regressed)',
      actual: g3Regressed.filter((o) => !o.correct).length,
      expected: 1,
    },
    // G4/G5 — live arms (should-not-flag: the shipped Phase-4 tree).
    {
      label: 'should-not-flag: G4a ungated-emission probes (live tree, P4 landed)',
      actual: g4aLive.filter((o) => !o.correct).length,
      expected: 0,
    },
    {
      label: 'should-not-flag: G4b absent-auth fail-closed (live tree)',
      actual: g4bLive.filter((o) => !o.correct).length,
      expected: 0,
    },
    {
      label: 'should-not-flag: G4c verify/ordering/reason ladder (live tree)',
      actual: g4cLive.filter((o) => !o.correct).length,
      expected: 0,
    },
    {
      label: 'should-not-flag: G5a static-build absence (live prerender)',
      actual: g5aLive.filter((o) => !o.correct).length,
      expected: 0,
    },
    {
      label: 'should-not-flag: G5b E3 endpoint gated + parity (live tree)',
      actual: g5bLive.filter((o) => !o.correct).length,
      expected: 0,
    },
    {
      label: 'should-not-flag: G5c entitled completeness (live tree)',
      actual: g5cLive.filter((o) => !o.correct).length,
      expected: 0,
    },
    // G4/G5 — regressed arms (should-flag), with EXACT touched-cell counts.
    {
      label: 'should-flag: G4a census fan-out drop → ungated serving (a1, a3, a4)',
      actual: g4aRegressed.filter((o) => !o.correct).length,
      expected: 3,
    },
    {
      label: 'should-flag: G4b accept-anything verify serves governed bytes (b1)',
      actual: g4bRegressed.filter((o) => !o.correct).length,
      expected: 1,
    },
    {
      label: 'should-flag: G4c decode-only verify seats the forged principal (c1, c6)',
      actual: g4cRegressed.filter((o) => !o.correct).length,
      expected: 2,
    },
    {
      label: 'should-flag: G5a loader output inlined into static HTML',
      actual: g5aRegressed.filter((o) => !o.correct).length,
      expected: 1,
    },
    {
      label: 'should-flag: G5b open always-200 data endpoint (b1, b3, b4, b5)',
      actual: g5bRegressed.filter((o) => !o.correct).length,
      expected: 4,
    },
    {
      label: 'should-flag: G5c emission not threaded into the render (pre-P4 seam)',
      actual: g5cRegressed.filter((o) => !o.correct).length,
      expected: 1,
    },
  ])

  // ── Discrimination proof ───────────────────────────────────────────────────
  //
  // This used to read "$scope denies, $rate-limit does not", which was only
  // ever true while GO1's bug was. Post-fix BOTH deny, so that phrasing would
  // now be either failing or vacuous. It is re-based onto the axis the property
  // is actually about, which a broken gate cannot fake in either direction:
  //
  //   (a) both DECLARED controls deny when their plugin is absent — under-
  //       enforcement is caught; and
  //   (b) they deny with DIFFERENT codes (401 vs 429), proving two separate
  //       checks rather than one blanket "declared ⇒ deny" rule; and
  //   (c) the UNDECLARED cell still dispatches — over-enforcement is caught.
  //
  // A gate that denied everything fails (c). One that allowed everything fails
  // (a). One that collapsed the two controls into a single rule fails (b).
  const scopeCell = g1Live.find((o) => o.label.startsWith('$scope'))!
  const rateCell = g1Live.find((o) => o.label.startsWith('$rate-limit declared, rateLimitPlugin'))!
  const undeclaredCell = g1Live.find((o) => o.label.startsWith('no control declared'))!

  const problems: string[] = []
  if (!scopeCell.denied) problems.push('$scope with no authPlugin did NOT deny')
  if (!rateCell.denied) problems.push('$rate-limit with no rateLimitPlugin did NOT deny')
  if (scopeCell.code === rateCell.code) {
    problems.push(
      `both declared controls denied with the SAME code (${scopeCell.code}) — they must be ` +
        'distinguishable (401 for absent auth, 429 for absent rate limiting), or the gate is ' +
        'applying one blanket rule rather than enforcing each declaration',
    )
  }
  if (undeclaredCell.denied) {
    problems.push(
      `an UNDECLARED control was denied (code ${undeclaredCell.code}) — the gate has become ` +
        '"deny everything", which is not enforcement either',
    )
  }
  if (problems.length > 0) {
    console.error(
      `${NAME} — HARNESS/GATE BROKEN: no count from this run is trustworthy.\n  - ` +
        problems.join('\n  - '),
    )
    process.exit(1)
  }
  console.log(
    `${NAME} — discrimination ok: declared controls deny with distinct codes ` +
      `($scope ${scopeCell.code}, $rate-limit ${rateCell.code}); an undeclared control still ` +
      'dispatches.',
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────

await runSelfTest()
if (SELF_TEST) process.exit(0)

const g1 = await runG1(false)
const g2 = await runG2(false)
const g3 = await runG3(false)
const g4a = await runG4a(false)
const g4b = await runG4b(false)
const g4c = await runG4c(false)
const g5a = await runG5a(false)
const g5b = await runG5b(false)
const g5c = await runG5c(false)
refuseVacuous(
  [...g1, ...g2, ...g3, ...g4a, ...g4b, ...g4c, ...g5a, ...g5b, ...g5c],
  NAME,
  'governance probes',
)

const findings: Finding[] = []

// G1 — one finding per declared control that failed to deny.
for (const o of g1.filter((x) => !x.correct)) {
  findings.push({
    where: 'packages/agent-service/src/agent-service.ts:215',
    rule: 'G1',
    message: `${o.label} — ${o.detail}`,
  })
}

// G3 — one finding: one defect (key provenance), one finding.
for (const o of g3.filter((x) => !x.correct)) {
  findings.push({
    where: 'packages/agent-service/src/agent-service.ts',
    rule: 'G3',
    message: `${o.label} — ${o.detail}`,
  })
}

// G2 — ONE finding if ANY sub-probe violates the handshake boundary.
// Per-sub-probe findings would inflate the count for one broken boundary.
const g2Bad = g2.filter((x) => !x.correct)
if (g2Bad.length > 0) {
  findings.push({
    where: 'packages/agent-server/src/agent-server.ts:158',
    rule: 'G2',
    message:
      `bridge handshake boundary failed — ${g2Bad.length}/${g2.length} sub-probes ` +
      `violated their delegation expectation (${g2Bad.map((b) => b.label).join('; ')}).`,
  })
}

// G4/G5 (GX Phase 5, #467) — one finding per failed probe cell: each cell is
// a distinct behavioral property of the governed boundary with its own fix
// site, unlike G2's one-defect/many-symptoms bridge comparison.
const G45_WHERE: ReadonlyArray<[readonly ProbeOutcome[], string, string]> = [
  [g4a, 'G4a', 'packages/router/src/server.ts:211'],
  [g4b, 'G4b', 'packages/server/src/governed.ts:512'],
  [g4c, 'G4c', 'packages/server/src/governed.ts:505'],
  [g5a, 'G5a', 'packages/app/src/prerender.ts'],
  [g5b, 'G5b', 'packages/router/src/server.ts:151'],
  [g5c, 'G5c', 'packages/router/src/server.ts:236'],
]
for (const [outcomes, rule, where] of G45_WHERE) {
  for (const o of outcomes.filter((x) => !x.correct)) {
    findings.push({ where, rule, message: `${o.label} — ${o.detail}` })
  }
}

console.log(
  `${NAME} — ran ${g1.length} G1 cells, ${g2.length} G2 sub-probes, ${g3.length} G3 ` +
    `key-provenance probe(s), and ${
      g4a.length + g4b.length + g4c.length + g5a.length + g5b.length + g5c.length
    } G4/G5 governed-boundary cells (#467) over the compiled census ` +
    `(bench/compiler-conformance/route/04-governed-data.route.json).`,
)
expectCount(findings, expectedFrom(process.argv, 'governed'), NAME)
