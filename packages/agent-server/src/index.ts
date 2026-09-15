/**
 * `@aihu/agent-server` — public API.
 *
 * Server-side glue (T2): mount an aihu component server-side, expose its actions
 * to an MCP client through the agent-service security gate, and forward approved
 * invocations to a browser capability bridge.
 *
 * - {@link createAgentServer} — the core factory (no MCP SDK import).
 * - {@link createComponentMcpServer} / {@link serveComponentMcp} — MCP endpoint
 *   (imports the SDK lazily; only loaded if you import from this barrel).
 * - All bridge message types + `BRIDGE_PROTOCOL_VERSION` — the WS contract the
 *   browser-bridge client (T3) implements against.
 */

export { BRIDGE_PROTOCOL_VERSION, createAgentServer } from './agent-server.ts'
export type { BridgeUpgradeVerdict, VerifyBridgeUpgradeOptions } from './bridge-auth.ts'
export { verifyBridgeUpgrade } from './bridge-auth.ts'
export type { AgentDispatcher, BridgeClient, BridgeClientOptions } from './bridge-client.ts'
export { createBridgeClient } from './bridge-client.ts'
export { createComponentMcpServer, serveComponentMcp } from './mcp-server.ts'
export { opaqueActionId, opaqueActionIdForTool, parseToolName } from './opaque-id.ts'
export type {
  AgentServer,
  AgentServerOptions,
  AgentServerTarget,
  BridgeChannel,
  BridgeClientMessage,
  BridgeErrorMessage,
  BridgeHelloMessage,
  BridgeInvokeMessage,
  BridgeResultMessage,
  BridgeServerMessage,
  BridgeSnapshotMessage,
} from './types.ts'
