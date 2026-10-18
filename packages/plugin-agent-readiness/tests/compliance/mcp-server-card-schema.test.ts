import { describe, expect, it } from 'vitest'
import { generateMcpServerCard } from '../../src/mcp-server-card.ts'

const base = { name: 'Test', version: '1.0.0', endpoint: 'https://test.example.com/mcp' }

// Layer: L0 (self-referential) for the CARD WRAPPER itself ($schema, version,
// transport, …) — it validates aihu's OWN documented server-card shape, and
// intentionally does NOT claim conformance to any MCP spec: as of revision
// 2025-11-25 no `/.well-known/mcp` server-card is standardized — SEP-1649 is
// closed and SEP-2127 moved to the Extensions Track. See mcp-server-card.ts
// header. The `tools[]` ENTRIES, however, ARE a standardized MCP wire shape
// (the real `Tool` a client receives from `tools/list`) — those get a real
// L1 external-oracle check (the SDK's own `ToolSchema`) in
// mcp-server-card.test.ts's `L1 — tools[] entries validate against the real
// MCP ToolSchema` block, not here.
describe('MCP Server Card — documented aihu shape', () => {
  it('$schema is the exact required string', () => {
    expect(generateMcpServerCard(base).$schema).toBe(
      'https://modelcontextprotocol.io/schemas/server-card/v1.0',
    )
  })

  it('version is the exact string "1.0"', () => {
    expect(generateMcpServerCard(base).version).toBe('1.0')
  })

  it('protocolVersion matches YYYY-MM-DD format', () => {
    expect(generateMcpServerCard(base).protocolVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('serverInfo.name is a non-empty string', () => {
    const card = generateMcpServerCard(base)
    expect(typeof card.serverInfo.name).toBe('string')
    expect(card.serverInfo.name.length).toBeGreaterThan(0)
  })

  it('serverInfo.version is a non-empty string', () => {
    const card = generateMcpServerCard(base)
    expect(typeof card.serverInfo.version).toBe('string')
    expect(card.serverInfo.version.length).toBeGreaterThan(0)
  })

  it('transport.type is streamable-http or sse', () => {
    const card = generateMcpServerCard(base)
    expect(['streamable-http', 'sse']).toContain(card.transport.type)
  })

  it('transport.url is a valid URL', () => {
    const card = generateMcpServerCard(base)
    expect(() => new URL(card.transport.url)).not.toThrow()
  })

  it('capabilities has exactly tools, resources, prompts boolean fields', () => {
    const { capabilities } = generateMcpServerCard(base)
    expect(typeof capabilities.tools).toBe('boolean')
    expect(typeof capabilities.resources).toBe('boolean')
    expect(typeof capabilities.prompts).toBe('boolean')
    expect(Object.keys(capabilities)).toEqual(['tools', 'resources', 'prompts'])
  })

  it('tools[].name is a non-empty string when tools present', () => {
    const card = generateMcpServerCard({
      ...base,
      skills: [{ id: 'a', name: 'Greet', description: 'Says hi.' }],
    })
    expect(card.tools?.[0].name.length).toBeGreaterThan(0)
  })

  it('tools[].description is a non-empty string when tools present', () => {
    const card = generateMcpServerCard({
      ...base,
      skills: [{ id: 'a', name: 'Greet', description: 'Says hi.' }],
    })
    expect(card.tools?.[0].description.length).toBeGreaterThan(0)
  })

  it('auth.authorizationServer is a valid URL when auth present', () => {
    const card = generateMcpServerCard({
      ...base,
      auth: {
        type: 'oauth2',
        authorizationUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/token',
      },
    })
    expect(() => new URL(card.auth?.authorizationServer)).not.toThrow()
  })

  it('does not advertise unserved OAuth well-known documents', () => {
    // Fix #423.3: the card must never point at /.well-known/oauth-protected-resource
    // (RFC 9728) or /.well-known/oauth-authorization-server (RFC 8414) — neither is
    // served, and a dangling advertisement is worse than none.
    const card = generateMcpServerCard({
      ...base,
      auth: {
        type: 'oauth2',
        authorizationUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/token',
      },
    })
    const json = JSON.stringify(card)
    expect(json).not.toContain('/.well-known/oauth-protected-resource')
    expect(json).not.toContain('/.well-known/oauth-authorization-server')
    expect('resourceMetadata' in (card.auth ?? {})).toBe(false)
  })

  it('no credential keys anywhere in JSON output', () => {
    const card = generateMcpServerCard({
      ...base,
      auth: {
        type: 'oauth2',
        authorizationUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/token',
      },
    })
    const json = JSON.stringify(card)
    for (const forbidden of ['clientSecret', 'password', 'token', 'secret']) {
      expect(json.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })

  it('JSON.stringify round-trip produces no undefined values', () => {
    const card = generateMcpServerCard(base)
    const roundTripped = JSON.parse(JSON.stringify(card))
    expect(roundTripped.$schema).toBe(card.$schema)
    expect(roundTripped.version).toBe(card.version)
    expect(roundTripped.serverInfo.name).toBe(card.serverInfo.name)
  })
})
