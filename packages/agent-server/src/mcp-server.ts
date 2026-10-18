/**
 * `@aihu/agent-server` — MCP endpoint for component actions (T2, part 3).
 *
 * Exposes each mounted component's declared actions/state as MCP tools, backed
 * by {@link AgentServer.callTool} (which runs the agent-service security gate
 * and forwards approved invocations to the browser bridge).
 *
 * Reuses the existing stdio MCP-server pattern from `@aihu/mcp` (same SDK,
 * same `ListTools`/`CallTool` request-handler shape) rather than reinventing
 * the protocol layer. The SDK is imported HERE (not in `index.ts`) so consumers
 * that only want `createAgentServer` + the bridge don't pay for the SDK.
 */

import type { AgentMetadata, McpToolInputSchema } from '@aihu/agent'
import { deriveActionInputSchema, getAllAgentMetadata } from '@aihu/agent'
import type { RequestContext } from '@aihu/agent-service'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { AgentServer } from './types.ts'

/** A `tools/call` argument shape: positional args + optional auth context. */
interface ComponentToolArgs {
  /** Positional arguments forwarded to the action (legacy positional form). */
  args?: unknown[]
  /**
   * Optional auth context for scoped/rate-limited tools. ONLY the `jwt` is
   * honored (#420): it is a credential the gate signature-verifies before
   * use. Any `userId` (or other identity field) in here is caller-supplied
   * over an unauthenticated transport and is DROPPED, never forwarded as if
   * authoritative — the verified principal is the JWT's `sub` claim.
   */
  context?: RequestContext
}

/**
 * Reduce caller-supplied tool arguments to the ONLY part of the auth context
 * this transport may forward: the JWT credential. Everything else (notably
 * `userId`) is discarded — trusting it let a caller reset its own rate-limit
 * bucket by rotating the value (#420). Belt-and-braces: the agent-service
 * gate ignores caller `userId` too; this keeps the spoofed value from even
 * crossing the boundary.
 */
function credentialOnlyContext(raw: unknown): RequestContext | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const jwt = (raw as { jwt?: unknown }).jwt
  if (typeof jwt !== 'string' || jwt === '') return undefined
  return { userId: null, jwt }
}

/**
 * The declared parameter ORDER for each `"<tag>/<action>"` tool whose schema
 * was derived (DE5). Built from the compiler-emitted `params.properties` key
 * order, which is the authored parameter order. Tools without a derived schema
 * (legacy positional `args`) are absent.
 *
 * The runtime action is invoked positionally (`(args) => name(args)`), so when
 * an MCP client sends NAMED arguments against a derived schema, they must be
 * marshalled back into this order to preserve the dispatch convention — only
 * the schema changed, not how the handler is called.
 */
function buildParamOrder(metas: AgentMetadata[]): Map<string, string[]> {
  const order = new Map<string, string[]>()
  for (const meta of metas) {
    const actions = meta.actions ?? {}
    for (const action of Object.keys(actions)) {
      const params = actions[action]?.params
      if (params) {
        order.set(`${meta.tag}/${action}`, Object.keys(params.properties))
      }
    }
  }
  return order
}

/**
 * Build the MCP tool descriptors from registered `AgentMetadata`. One tool per
 * `<tag>/<action>`, named `"<tag>/<action>"` to match the agent-service tool
 * naming (so `callTool` routes correctly).
 */
function buildToolDefinitions(metas: AgentMetadata[]): Array<{
  name: string
  description: string
  inputSchema: McpToolInputSchema
}> {
  const tools: Array<{
    name: string
    description: string
    inputSchema: McpToolInputSchema
  }> = []
  for (const meta of metas) {
    const actions = meta.actions ?? {}
    for (const action of Object.keys(actions)) {
      // Prefer the authored `describe:` from the component's $action entry —
      // it is written for an LLM audience. Fall back to the synthesized string
      // only when the action carries no description.
      const schema = actions[action]
      const authored = schema?.describe
      // DE5 — the input schema is DERIVED from the handler signature when the
      // compiler could model it (`params` present): real parameter names and
      // types, so the LLM does not have to guess arity or shape. When absent
      // (unparseable handler, or a destructuring param the compiler could not
      // name), fall back to the legacy positional `args: { type: 'array' }`
      // shape — the runtime dispatch is identical either way. Shared with
      // `@aihu-plugin/agent-readiness`'s MCP server card via
      // `deriveActionInputSchema` so the two surfaces cannot drift.
      const inputSchema = deriveActionInputSchema(schema, action)
      tools.push({
        name: `${meta.tag}/${action}`,
        description:
          (authored && authored.length > 0
            ? authored
            : `Invoke the \`${action}\` action on a live <${meta.tag}> instance.`) +
          (meta.describes ? ` Component: ${meta.describes}` : ''),
        inputSchema,
      })
    }
    // Expose read-only state signals as zero-arg tools too (handleToolCall
    // falls through to getSignal when callAction reports "no action").
    const state = meta.state ?? {}
    for (const stateName of Object.keys(state)) {
      // The map VALUE is the authored `describe:` for that member (the compiler
      // emits '' when none was written). It was previously ignored entirely.
      const authored = state[stateName]
      tools.push({
        name: `${meta.tag}/${stateName}`,
        description:
          authored && authored.length > 0
            ? authored
            : `Read the \`${stateName}\` state of a live <${meta.tag}> instance.`,
        inputSchema: { type: 'object', properties: {} },
      })
    }
  }
  return tools
}

/**
 * Create an MCP `Server` whose tools are the mounted component's actions/state,
 * backed by `agentServer.callTool`. Does not connect a transport — call
 * {@link serveComponentMcp} (or wire your own transport) to go live.
 *
 * `metas` defaults to the global `getAllAgentMetadata()` snapshot, matching
 * what `createAgentServer` built its service from.
 */
export function createComponentMcpServer(
  agentServer: AgentServer,
  metas: AgentMetadata[] = getAllAgentMetadata(),
): Server {
  const server = new Server(
    { name: 'aihu-agent-server', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  const toolDefs = buildToolDefinitions(metas)
  const paramOrder = buildParamOrder(metas)

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefs }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params
    const input = (rawArgs ?? {}) as ComponentToolArgs & Record<string, unknown>

    // Marshal the tool arguments into the positional array the runtime dispatch
    // expects. Two shapes are accepted:
    //   • DERIVED schema (DE5): the client sends named arguments; reassemble
    //     them in the declared parameter order.
    //   • LEGACY schema: the client sends `{ args: [...] }` positionally.
    // A derived tool always has a param order entry (possibly empty), so it is
    // checked first; only tools without one read the positional `args` array.
    const order = paramOrder.get(name)
    const params =
      order !== undefined ? order.map((paramName) => input[paramName]) : (input.args ?? [])

    // Route through the gated callTool with a credential-only context: the
    // JWT is forwarded for the gate to verify; caller-supplied identity
    // (`context.userId`) is dropped at this boundary (#420).
    // The envelope is `{ result }` on success or `{ error, code, jsonrpc }`
    // on a gate rejection (404/401/403/429/503).
    const envelope = (await agentServer.callTool(
      name,
      params,
      credentialOnlyContext(input.context),
    )) as {
      result?: unknown
      error?: string
      code?: number
      authDiscoveryUrl?: string
    }

    if (typeof envelope.code === 'number') {
      // Gate rejection → MCP tool error. The code (404/401/403/429/503) is
      // surfaced in the message so the agent learns why it was denied, and a
      // 401 carries the auth-discovery URL (when configured) so the agent
      // learns where to obtain a credential.
      const discovery =
        typeof envelope.authDiscoveryUrl === 'string'
          ? ` (auth discovery: ${envelope.authDiscoveryUrl})`
          : ''
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `[${envelope.code}] ${envelope.error ?? 'denied'}${discovery}`,
          },
        ],
      }
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(envelope.result ?? null, null, 2),
        },
      ],
    }
  })

  return server
}

/**
 * Convenience: create the component MCP server and connect it over stdio (the
 * same transport `@aihu/mcp` uses). Stays alive until the MCP host disconnects.
 */
export async function serveComponentMcp(
  agentServer: AgentServer,
  metas?: AgentMetadata[],
): Promise<Server> {
  const server = createComponentMcpServer(agentServer, metas)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  return server
}
