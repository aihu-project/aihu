import { describe, expect, it } from 'vitest'
import { createDemoSecurity } from '../demo-security'

const authorized = (token: string) =>
  new Request('http://localhost/agent/state', {
    headers: { authorization: `Bearer ${token}` },
  })

describe('demo host authorization', () => {
  it('fails closed without a configured credential or with a wrong credential', async () => {
    expect(await createDemoSecurity(undefined).authorizeSnapshot(authorized('anything'))).toEqual({
      allowed: false,
      code: 401,
      error: 'AUTH_REQUIRED',
    })
    expect(await createDemoSecurity('correct').authorizeSnapshot(authorized('wrong'))).toEqual({
      allowed: false,
      code: 401,
      error: 'AUTH_REQUIRED',
    })
  })

  it('resolves the demo actor and grants only its projected snapshot capability', async () => {
    const security = createDemoSecurity('correct')
    const request = authorized('correct')
    const caller = await security.authorizeRequest(request)
    expect(caller?.actor).toMatchObject({
      subject: 'demo-agent',
      organizationId: 'demo-room',
      grantVersion: '1',
    })
    expect(await security.authorizeSnapshot(request)).toEqual({
      allowed: true,
      projection: ['taskCount'],
    })
    expect(
      security.authorizeDataRead(caller!.principal, {
        capability: 'task-list.private',
        actor: caller!.actor,
      }),
    ).toEqual({ granted: false })
  })
})
