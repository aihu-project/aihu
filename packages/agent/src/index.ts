/**
 * `@aihu/agent` public surface (spec §1, §5).
 *
 * 4 value exports + 7 type-only exports = 11 total. `__resetRegistryForTesting`
 * is intentionally NOT re-exported here — it is internal to the package and
 * accessed only by tests via the registry module path.
 */
export type {
  ActionParamsSchema,
  ActionSchema,
  AgentMetadata,
  ExtractPolicy,
  ExtractScopePolicy,
  InputSchema,
  McpToolInputSchema,
} from './registry.ts'
export {
  deriveActionInputSchema,
  getAgentMetadata,
  getAllAgentMetadata,
  registerAgentMetadata,
} from './registry.ts'
