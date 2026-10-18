import { ToolSchema } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it } from 'vitest'
import { __resetRegistryForTesting, registerAgentMetadata } from '../../agent/src/registry.ts'
import {
  agentMetadataToSkills,
  generateMcpServerCard,
  skillsFromRegistry,
} from '../src/mcp-server-card.ts'

describe('@aihu-plugin/agent-readiness mcp-server-card', () => {
  afterEach(() => {
    __resetRegistryForTesting()
  })

  it('AC-2: generateMcpServerCard produces valid MCP Server Card', () => {
    const card = generateMcpServerCard({
      name: 'Test MCP',
      version: '1.0.0',
      endpoint: 'https://test.example.com/mcp',
      skills: [{ id: 'greet', name: 'Greet', description: 'Says hello.' }],
    })
    expect(card.$schema).toBe('https://modelcontextprotocol.io/schemas/server-card/v1.0')
    expect(card.version).toBe('1.0')
    expect(card.serverInfo.name).toBe('Test MCP')
    expect(['streamable-http', 'sse']).toContain(card.transport.type)
    expect(card.transport.url).toBe('https://test.example.com/mcp')
    expect(card.tools?.[0]?.name).toBe('Greet')
    expect(card.auth).toBeUndefined()
    expect(() => JSON.stringify(card)).not.toThrow()
    const cardWithAuth = generateMcpServerCard({
      name: 'Protected',
      version: '1.0.0',
      endpoint: 'https://secure.example.com/mcp',
      auth: {
        type: 'oauth2',
        authorizationUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/token',
        scopes: ['mcp:read'],
      },
    })
    expect(cardWithAuth.auth?.type).toBe('oauth2')
    const authStr = JSON.stringify(cardWithAuth.auth)
    expect(authStr).not.toContain('clientSecret')
    expect(authStr).not.toContain('password')
  })

  it('agentMetadataToSkills derives skills from actions', () => {
    const skills = agentMetadataToSkills({
      tag: 'x-btn',
      actions: { click: { describe: 'Clicks' } },
    })
    expect(skills).toHaveLength(1)
    expect(skills[0]).toEqual({
      id: 'x-btn.click',
      name: 'click',
      description: 'Clicks',
      // No `params` on the action (compiler couldn't model the handler, or
      // this is hand-authored test metadata) — legacy positional fallback.
      inputSchema: {
        type: 'object',
        properties: {
          args: { type: 'array', description: 'Positional arguments for click.' },
        },
      },
    })
  })

  it('agentMetadataToSkills derives a real parameter inputSchema when the action has one (DE5)', () => {
    const skills = agentMetadataToSkills({
      tag: 'x-form',
      actions: {
        submit: {
          describe: 'Submits the form',
          params: { properties: { email: { type: 'string' } }, required: ['email'] },
        },
      },
    })
    expect(skills[0].inputSchema).toEqual({
      type: 'object',
      properties: { email: { type: 'string' } },
      required: ['email'],
    })
  })

  it('agentMetadataToSkills returns empty array when no actions', () => {
    const skills = agentMetadataToSkills({ tag: 'x-empty' })
    expect(skills).toEqual([])
  })

  it('DE1: server-card tools are DERIVED from the registry $action entries, not hand-edited', () => {
    // Simulate what the compiler emits from a component's `$action` block.
    registerAgentMetadata({
      tag: 'demo-root',
      actions: {
        increment: { returns: {}, describe: 'Add 1 to the value' },
        reset: { returns: {}, describe: 'Set the value to 0' },
      },
    })

    // No `skills` passed — the card must derive them from the live registry.
    const card = generateMcpServerCard({
      name: 'Demo',
      version: '0.1.0',
      endpoint: 'https://demo.example.com/mcp',
    })
    expect(card.tools?.map((t) => t.name).sort()).toEqual(['increment', 'reset'])
    expect(card.tools?.find((t) => t.name === 'increment')?.description).toBe('Add 1 to the value')

    // Remove an exposed action → the card changes WITHOUT touching config.
    __resetRegistryForTesting()
    registerAgentMetadata({
      tag: 'demo-root',
      actions: { increment: { returns: {}, describe: 'Add 1 to the value' } },
    })
    const after = generateMcpServerCard({
      name: 'Demo',
      version: '0.1.0',
      endpoint: 'https://demo.example.com/mcp',
    })
    expect(after.tools?.map((t) => t.name)).toEqual(['increment'])
  })

  it('DE1: an empty registry yields a card with no tools (no hand-written fallback)', () => {
    const card = generateMcpServerCard({
      name: 'Empty',
      version: '0.1.0',
      endpoint: 'https://empty.example.com/mcp',
    })
    expect(card.tools).toBeUndefined()
  })

  it('DE1: explicitly declared skills merge with registry-derived ones (deduped by id)', () => {
    registerAgentMetadata({
      tag: 'demo-root',
      actions: { increment: { returns: {}, describe: 'Add 1 to the value' } },
    })
    const card = generateMcpServerCard({
      name: 'Demo',
      version: '0.1.0',
      endpoint: 'https://demo.example.com/mcp',
      // A skill NOT in the registry is additive; a duplicate id defers to the
      // registry-derived source of truth.
      skills: [
        { id: 'demo-root.increment', name: 'increment', description: 'SHADOWED' },
        { id: 'other.thing', name: 'thing', description: 'A declared extra.' },
      ],
    })
    const names = card.tools?.map((t) => t.name)
    expect(names).toEqual(['increment', 'thing'])
    // registry description wins over the shadowing declared duplicate
    expect(card.tools?.find((t) => t.name === 'increment')?.description).toBe('Add 1 to the value')
  })

  it('skillsFromRegistry maps every registered component action to a skill', () => {
    registerAgentMetadata({ tag: 'a-one', actions: { go: { returns: {}, describe: 'Go' } } })
    registerAgentMetadata({ tag: 'b-two', actions: { stop: { returns: {}, describe: 'Stop' } } })
    const skills = skillsFromRegistry()
    expect(skills.map((s) => s.id).sort()).toEqual(['a-one.go', 'b-two.stop'])
  })

  it('generateMcpServerCard with description and homepage reflects in serverInfo', () => {
    const card = generateMcpServerCard({
      name: 'My App',
      version: '2.0.0',
      endpoint: 'https://example.com/mcp',
      description: 'A great app',
      homepage: 'https://example.com',
    })
    expect(card.serverInfo.description).toBe('A great app')
    expect(card.serverInfo.homepage).toBe('https://example.com')
  })

  it('generateMcpServerCard with transportType: sse uses sse transport', () => {
    const card = generateMcpServerCard({
      name: 'SSE App',
      version: '1.0.0',
      endpoint: 'https://example.com/mcp',
      transportType: 'sse',
    })
    expect(card.transport.type).toBe('sse')
  })

  it('generateMcpServerCard with protocolVersion overrides default', () => {
    const card = generateMcpServerCard({
      name: 'App',
      version: '1.0.0',
      endpoint: 'https://example.com/mcp',
      protocolVersion: '2025-01-01',
    })
    expect(card.protocolVersion).toBe('2025-01-01')
  })

  it('generateMcpServerCard default protocolVersion is 2025-06-18', () => {
    const card = generateMcpServerCard({
      name: 'App',
      version: '1.0.0',
      endpoint: 'https://example.com/mcp',
    })
    expect(card.protocolVersion).toBe('2025-06-18')
  })

  it('generateMcpServerCard auth block emits the AS issuer origin and no unserved well-knowns', () => {
    const card = generateMcpServerCard({
      name: 'Protected',
      version: '1.0.0',
      endpoint: 'https://api.example.com/mcp',
      auth: {
        type: 'oauth2',
        authorizationUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/v1/token',
        scopes: ['read'],
      },
    })
    // authorizationServer is the OAuth issuer identifier (token endpoint origin),
    // NOT a fabricated /.well-known metadata URL. Consumers do RFC 8414 discovery
    // against the issuer themselves.
    expect(card.auth?.authorizationServer).toBe('https://auth.example.com')
    // Fix #423.3: we no longer advertise these unserved documents.
    expect('resourceMetadata' in (card.auth ?? {})).toBe(false)
    const json = JSON.stringify(card)
    expect(json).not.toContain('/.well-known/oauth-protected-resource')
    expect(json).not.toContain('/.well-known/oauth-authorization-server')
  })

  // Gap A, L1 (docs/plans/2026-07-26-agent-readiness-external-parity.md §4,
  // §7 step 4): the card's own shape (`$schema`, `version`, …) still has no
  // standardized spec to validate against — see mcp-server-card-schema.test.ts's
  // header. But each entry of `tools[]` IS a real MCP wire-protocol `Tool`
  // (the shape a client actually receives from `tools/list`), and
  // `@modelcontextprotocol/sdk` ships that shape as a live Zod schema. These
  // tests validate against THAT schema directly — not our own transcription
  // of it — so a drift between what we emit and what the real protocol
  // requires fails here instead of only at a real client's hands.
  describe('L1 — tools[] entries validate against the real MCP ToolSchema', () => {
    it('a registry-derived tool (with a real parameter schema) round-trips through ToolSchema', () => {
      registerAgentMetadata({
        tag: 'x-form',
        actions: {
          submit: {
            returns: {},
            describe: 'Submits the form',
            params: { properties: { email: { type: 'string' } }, required: ['email'] },
          },
        },
      })
      const card = generateMcpServerCard({
        name: 'Demo',
        version: '1.0.0',
        endpoint: 'https://demo.example.com/mcp',
      })
      expect(card.tools).toBeDefined()
      for (const tool of card.tools ?? []) {
        expect(() => ToolSchema.parse(tool)).not.toThrow()
      }
    })

    it('a registry-derived tool with no modeled params (legacy positional fallback) still validates', () => {
      registerAgentMetadata({
        tag: 'x-btn',
        actions: { click: { returns: {}, describe: 'Clicks the button' } },
      })
      const card = generateMcpServerCard({
        name: 'Demo',
        version: '1.0.0',
        endpoint: 'https://demo.example.com/mcp',
      })
      for (const tool of card.tools ?? []) {
        expect(() => ToolSchema.parse(tool)).not.toThrow()
      }
    })

    it('a hand-declared config.skill with no inputSchema still validates (EMPTY_INPUT_SCHEMA fallback)', () => {
      const card = generateMcpServerCard({
        name: 'Demo',
        version: '1.0.0',
        endpoint: 'https://demo.example.com/mcp',
        skills: [{ id: 'greet', name: 'Greet', description: 'Says hello.' }],
      })
      expect(() => ToolSchema.parse(card.tools?.[0])).not.toThrow()
    })

    it('negative control: the oracle actually rejects a shape missing inputSchema', () => {
      // Proves the test above isn't vacuous — before this change, every tool
      // we emitted had exactly this (invalid) shape.
      expect(() => ToolSchema.parse({ name: 'x', description: 'y' })).toThrow()
    })

    it('negative control: the oracle rejects an inputSchema whose type is not "object"', () => {
      expect(() =>
        ToolSchema.parse({ name: 'x', description: 'y', inputSchema: { type: 'array' } }),
      ).toThrow()
    })
  })
})
