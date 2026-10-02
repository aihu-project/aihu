/** Local-only host policy for the example's HTTP agent and state endpoints. */
import type { AuthPlugin } from '@aihu/agent-service'
import {
  type ActorResolver,
  authorizeCapability,
  type CapabilityGrantResolver,
  resolvePrincipal,
} from '@aihu/agent-service'

const SUBJECT = 'demo-agent'
const ORGANIZATION = 'demo-room'

export function createDemoSecurity(token: string | undefined) {
  const authPlugin: AuthPlugin = {
    checkScope: (credential, scope) => credential === token && scope === 'tasks:read',
    verify: async (credential) =>
      token && credential === token ? { sub: SUBJECT, scope: 'tasks:read' } : null,
  }
  const actorResolver: ActorResolver = {
    resolveActor: (principal) =>
      token && principal.sub === SUBJECT
        ? {
            kind: 'machine',
            subject: SUBJECT,
            organizationId: ORGANIZATION,
            scopes: principal.scopes,
            issuer: null,
            audience: null,
            grantId: 'demo-agent',
            grantVersion: '1',
          }
        : null,
  }
  const authorizeDataRead: CapabilityGrantResolver = (_principal, request) =>
    request.capability === 'task-list.snapshot' &&
    request.actor?.subject === SUBJECT &&
    request.actor.organizationId === ORGANIZATION
      ? { granted: true, projection: ['taskCount'] }
      : { granted: false }

  async function authorizeRequest(req: Request) {
    const header = req.headers.get('authorization') ?? ''
    const credential = header.startsWith('Bearer ') ? header.slice(7) : ''
    const principal = await resolvePrincipal({ jwt: credential }, { authPlugin })
    if (principal.class === 'anonymous') return null
    const actor = await actorResolver.resolveActor(principal)
    return actor ? { principal, actor, credential } : null
  }

  async function authorizeSnapshot(req: Request) {
    const request = await authorizeRequest(req)
    if (!request) return { allowed: false as const, code: 401, error: 'AUTH_REQUIRED' }
    const verdict = await authorizeCapability(
      request.principal,
      { capability: 'task-list.snapshot', actor: request.actor },
      { resolve: authorizeDataRead },
    )
    return verdict.allow
      ? { allowed: true as const, projection: verdict.projection }
      : { allowed: false as const, code: verdict.code, error: verdict.message }
  }

  return { authPlugin, actorResolver, authorizeDataRead, authorizeRequest, authorizeSnapshot }
}
