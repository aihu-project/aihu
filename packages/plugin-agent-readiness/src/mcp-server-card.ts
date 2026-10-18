/**
 * MCP Server Card generator.
 *
 * Emits aihu's OWN documented server-card shape — it is NOT a standardized MCP
 * artifact. As of MCP revision 2025-11-25 no `/.well-known/mcp` server-card is
 * specified: SEP-1649 (the original proposal) is CLOSED and SEP-2127 was moved
 * off the Standards Track onto the Extensions Track. Do not describe this card
 * as SEP-1649/spec compliant. The card is still useful for agents that know to
 * look for it; we serve it, we just don't claim conformance to a dead proposal.
 *
 * Discovery: GET /.well-known/mcp/server-card.json
 * protocolVersion default: 2025-06-18.
 */

import type { ActionParamsSchema, AgentMetadata } from '@aihu/agent'
import { deriveActionInputSchema, getAllAgentMetadata } from '@aihu/agent'
import { deriveReadPolicy, extractReadValue, isCallAdvertised } from '@aihu/server'
import type { McpAuthConfig } from './types.ts'

/** Minimal shape used for skill generation. Structurally compatible with @aihu/agent AgentMetadata. */
interface AgentMetadataLike {
  readonly tag: string
  readonly actions?: Record<string, { describe?: string; params?: ActionParamsSchema } | undefined>
}

/** Fallback for a hand-declared `AgentSkill` with no `inputSchema` of its own
 * (the registry-derived path always supplies one via `deriveActionInputSchema`).
 * Matches the real MCP `Tool.inputSchema` shape — `{ type: 'object' }` alone is
 * already valid JSON-Schema (no properties required). */
const EMPTY_INPUT_SCHEMA: Record<string, unknown> = { type: 'object', properties: {} }

export interface AgentSkill {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly inputSchema?: Record<string, unknown>
}

/**
 * MCP Server Card output object. Valid JSON when serialized.
 */
export interface McpServerCard {
  readonly $schema: 'https://modelcontextprotocol.io/schemas/server-card/v1.0'
  readonly version: '1.0'
  readonly protocolVersion: string
  readonly serverInfo: {
    readonly name: string
    readonly version: string
    readonly description?: string
    readonly homepage?: string
  }
  readonly transport: {
    readonly type: 'streamable-http' | 'sse'
    readonly url: string
  }
  readonly capabilities: {
    readonly tools: boolean
    readonly resources: boolean
    readonly prompts: boolean
  }
  readonly tools?: ReadonlyArray<{
    readonly name: string
    readonly description: string
    /** Real MCP wire-protocol field (`Tool.inputSchema`) — required by the
     * SDK's `ToolSchema`, not optional on the wire. */
    readonly inputSchema: Record<string, unknown>
  }>
  readonly auth?: {
    readonly type: 'oauth2'
    /**
     * OAuth 2.0 authorization-server issuer identifier (the origin of the
     * configured token endpoint). A consumer performs RFC 8414 metadata
     * discovery against the issuer itself — we do NOT synthesize or advertise a
     * `/.well-known/oauth-authorization-server` URL here: that document belongs
     * on the authorization server, not on this MCP server, and we don't serve it.
     */
    readonly authorizationServer: string
  }
}

export interface McpServerCardConfig {
  readonly name: string
  readonly version: string
  readonly endpoint: string
  readonly skills?: ReadonlyArray<AgentSkill>
  /**
   * Component metadata to derive skills from. Defaults to the live
   * `@aihu/agent` registry.
   *
   * FEL-434b: on a client-target build the registry is empty (the compiler
   * elides `registerAgentMetadata` from client JS), so the caller passes the
   * components read back from the on-disk agent-meta sidecars instead. Same
   * `extract` filtering applies either way — see `skillsFromRegistry`.
   */
  readonly components?: ReadonlyArray<AgentMetadata>
  readonly auth?: McpAuthConfig
  readonly description?: string
  readonly homepage?: string
  /** Default: '2025-06-18'. */
  readonly protocolVersion?: string
  /** Default: 'streamable-http'. */
  readonly transportType?: 'streamable-http' | 'sse'
}

/**
 * Generate an MCP Server Card object.
 *
 * The card's `tools` are DERIVED, not hand-maintained (thesis §2): the skills
 * come from the compiler-populated `@aihu/agent` registry — the same source
 * `@aihu/agent-server`'s `buildToolDefinitions` reads — via
 * {@link skillsFromRegistry}. Any skills declared explicitly in `config.skills`
 * are merged on top (deduped by id), honoring `AgentReadinessConfig`'s
 * documented "merged with auto-derived" contract. No hand-written skills
 * literal is required or expected; when both the registry and the config are
 * empty, `tools` is omitted.
 *
 * No I/O — reads an in-memory registry snapshot, exactly as the llms.txt path
 * does. Deterministic given the registry + config.
 *
 * `capabilities` is always `{ tools: true, resources: false, prompts: false }` in v0.
 *
 * SECURITY: auth output block must never contain client secrets, tokens, or
 * passwords. Only public URLs are emitted.
 */
export function generateMcpServerCard(config: McpServerCardConfig): McpServerCard {
  const derived =
    config.components !== undefined ? skillsFromRegistry(config.components) : skillsFromRegistry()
  const skills = mergeSkills(derived, config.skills ?? [])
  const tools =
    skills.length > 0
      ? skills.map((s) => ({
          name: s.name,
          description: s.description,
          inputSchema: s.inputSchema ?? EMPTY_INPUT_SCHEMA,
        }))
      : undefined

  let auth: McpServerCard['auth']
  if (config.auth) {
    // Emit only the authorization-server issuer identifier (the token endpoint
    // origin). We deliberately do NOT advertise `/.well-known/oauth-protected-
    // resource` (RFC 9728) or `/.well-known/oauth-authorization-server`
    // (RFC 8414): the former is this server's responsibility but we don't serve
    // it, and the latter belongs on the authorization server, not here. A
    // dangling advertisement of an unserved well-known is worse than none —
    // consumers do their own RFC 8414 discovery from the issuer below.
    const tokenUrl = new URL(config.auth.tokenUrl)
    auth = { type: 'oauth2', authorizationServer: tokenUrl.origin }
  }

  const serverInfo: McpServerCard['serverInfo'] = {
    name: config.name,
    version: config.version,
    ...(config.description !== undefined ? { description: config.description } : {}),
    ...(config.homepage !== undefined ? { homepage: config.homepage } : {}),
  }

  return {
    $schema: 'https://modelcontextprotocol.io/schemas/server-card/v1.0',
    version: '1.0',
    protocolVersion: config.protocolVersion ?? '2025-06-18',
    serverInfo,
    transport: {
      type: config.transportType ?? 'streamable-http',
      url: config.endpoint,
    },
    capabilities: { tools: true, resources: false, prompts: false },
    ...(tools !== undefined ? { tools } : {}),
    ...(auth !== undefined ? { auth } : {}),
  }
}

/**
 * Derive AgentSkill[] from AgentMetadata.actions.
 * id = "{meta.tag}.{actionName}", name = actionName, description = the action's
 * authored `describe:` text (sourced from the component's `$action` entry — the
 * same field `@aihu/agent-server` surfaces as the MCP tool description).
 * inputSchema = `deriveActionInputSchema(action, actionName)` — the same real
 * MCP `Tool.inputSchema` `@aihu/agent-server`'s `buildToolDefinitions` emits,
 * from the same shared helper (not a second hand-derivation of it).
 * @internal
 */
export function agentMetadataToSkills(meta: AgentMetadataLike): ReadonlyArray<AgentSkill> {
  if (!meta.actions) return []
  return Object.entries(meta.actions).map(([actionName, action]) => ({
    id: `${meta.tag}.${actionName}`,
    name: actionName,
    description: action?.describe ?? '',
    inputSchema: deriveActionInputSchema(action, actionName),
  }))
}

/**
 * Derive the full set of MCP skills from the live `@aihu/agent` registry.
 *
 * This is the single source of the agent surface: the compiler emits a
 * `registerAgentMetadata(...)` call for every `.aihu` component's `$action`
 * block, module evaluation populates the registry, and this reads it back —
 * so the server card can never drift from the components' declared actions.
 * Defaults to the global registry snapshot; accepts an explicit `metas` array
 * for testing.
 */
export function skillsFromRegistry(
  metas: readonly AgentMetadata[] = getAllAgentMetadata(),
): ReadonlyArray<AgentSkill> {
  // GX Phase 3 (#437-GX): the tool listing is filtered by each surface's
  // compiled `extract` policy (spec §8) — a surface whose `read` excludes
  // user-directed AI fetchers ('search'/'none'/any hard value) is absent from
  // this anonymous discovery document, and a `call: 'none'` (or malformed —
  // fail-closed) surface has no advertisable agent surface at all. Entries
  // without an `extract` member (the pre-GX registry shape) are advertised
  // exactly as before. COMPLIANCE-TIER: absence from the card hides nothing
  // from a caller that guesses tool names — the serving gate (Phase 2's call
  // axis) is the enforcement.
  return metas
    .filter(
      (m) =>
        deriveReadPolicy(extractReadValue(m.extract)).agentDiscovery && isCallAdvertised(m.extract),
    )
    .flatMap((m) => agentMetadataToSkills(m))
}

/**
 * Merge registry-derived skills with any explicitly declared ones. Derived
 * skills win on id collision (they are the source of truth); declared skills
 * with a fresh id are appended. Order: derived first, then extra declared.
 */
function mergeSkills(
  derived: ReadonlyArray<AgentSkill>,
  declared: ReadonlyArray<AgentSkill>,
): ReadonlyArray<AgentSkill> {
  if (declared.length === 0) return derived
  const seen = new Set(derived.map((s) => s.id))
  return [...derived, ...declared.filter((s) => !seen.has(s.id))]
}
