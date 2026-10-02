import { describe, expect, it } from 'vitest'
import {
  AI_BOT_LIST,
  AI_TRAINING_CRAWLER_BOTS,
  AI_USER_FETCHER_BOTS,
  generateRobotsTxt,
} from '../src/index.ts'

describe('@aihu-plugin/agent-readiness robots', () => {
  it('AC-5: deny-all emits named bot Disallow entries and ends with wildcard Allow', () => {
    const output = generateRobotsTxt({ aiAgents: 'deny-all' })
    for (const bot of AI_BOT_LIST) {
      expect(output).toContain(`User-agent: ${bot}\nDisallow: /`)
    }
    expect(output).toContain('User-agent: *\nAllow: /')
    // S-3: must never emit a blanket wildcard deny (blocks humans)
    expect(output).not.toContain('User-agent: *\nDisallow: /')
  })

  it('allow-all (back-compat): emits only Allow directives, no Disallow', () => {
    const out = generateRobotsTxt({ aiAgents: 'allow-all' })
    expect(out).toContain('User-agent: *')
    expect(out).toContain('Allow: /')
    expect(out).not.toContain('Disallow:')
  })

  it('appends Sitemap line when sitemap is provided', () => {
    const out = generateRobotsTxt({
      aiAgents: 'allow-all',
      sitemap: 'https://aihu.dev/sitemap.xml',
    })
    expect(out).toMatch(/Sitemap: https:\/\/aihu\.dev\/sitemap\.xml$/)
  })

  it('appends Agentmap line (ARD) when agentMap is provided, after Sitemap', () => {
    const out = generateRobotsTxt({
      aiAgents: 'allow-all',
      sitemap: 'https://aihu.dev/sitemap.xml',
      agentMap: 'https://aihu.dev/.well-known/ai-catalog.json',
    })
    expect(out).toMatch(
      /Sitemap: https:\/\/aihu\.dev\/sitemap\.xml\n\nAgentmap: https:\/\/aihu\.dev\/\.well-known\/ai-catalog\.json$/,
    )
  })

  it('omits Agentmap line when agentMap is not provided', () => {
    const out = generateRobotsTxt({ aiAgents: 'allow-all' })
    expect(out).not.toContain('Agentmap:')
  })
})

describe('#430 — tiered default (allow-agents)', () => {
  it('the registry partitions all 13 bots into the two tiers', () => {
    expect(AI_BOT_LIST).toHaveLength(13)
    expect(AI_USER_FETCHER_BOTS).toHaveLength(4)
    expect(AI_TRAINING_CRAWLER_BOTS).toHaveLength(9)
    expect([...AI_USER_FETCHER_BOTS, ...AI_TRAINING_CRAWLER_BOTS].sort()).toEqual(
      [...AI_BOT_LIST].sort(),
    )
  })

  it('default config → allow-agents: per-bot fetchers allowed, trainers disallowed', () => {
    const out = generateRobotsTxt()
    // User-delegated fetchers / cited-search agents: allowed by default.
    expect(out).toContain('User-agent: ChatGPT-User\nAllow: /')
    expect(out).toContain('User-agent: OAI-SearchBot\nAllow: /')
    expect(out).toContain('User-agent: DuckAssistBot\nAllow: /')
    expect(out).toContain('User-agent: Applebot\nAllow: /')
    // Training/scraping crawlers: explicit opt-in — disallowed by default.
    expect(out).toContain('User-agent: GPTBot\nDisallow: /')
    expect(out).toContain('User-agent: ClaudeBot\nDisallow: /')
    expect(out).toContain('User-agent: PerplexityBot\nDisallow: /')
    expect(out).toContain('User-agent: Googlebot-Extended\nDisallow: /')
    expect(out).toContain('User-agent: CCBot\nDisallow: /')
    expect(out).toContain('User-agent: anthropic-ai\nDisallow: /')
    expect(out).toContain('User-agent: Google-Extended\nDisallow: /')
    expect(out).toContain('User-agent: Bytespider\nDisallow: /')
    expect(out).toContain('User-agent: cohere-ai\nDisallow: /')
    // Wildcard allow, never a wildcard deny.
    expect(out).toContain('User-agent: *\nAllow: /')
    expect(out).not.toContain('User-agent: *\nDisallow: /')
  })

  it("explicit aiAgents: 'allow-agents' matches the default output", () => {
    expect(generateRobotsTxt({ aiAgents: 'allow-agents' })).toBe(generateRobotsTxt())
  })

  it('rules[] back-compat: custom rules are rendered verbatim', () => {
    const out = generateRobotsTxt({
      aiAgents: [
        { userAgent: 'GPTBot', allow: ['/docs'], disallow: ['/'] },
        { userAgent: ['ClaudeBot', 'CCBot'], disallow: ['/private'], crawlDelay: 5 },
      ],
    })
    expect(out).toContain('User-agent: GPTBot\nDisallow: /\nAllow: /docs')
    expect(out).toContain(
      'User-agent: ClaudeBot\nUser-agent: CCBot\nDisallow: /private\nCrawl-delay: 5',
    )
  })
})

describe('#430 — aiAgents runtime value guard', () => {
  it("phantom docs value 'disallow-all' throws a helpful error naming valid options", () => {
    expect(() => generateRobotsTxt({ aiAgents: 'disallow-all' as never })).toThrowError(
      /'disallow-all'.*never implemented|Unknown aiAgents value "disallow-all"/s,
    )
    try {
      generateRobotsTxt({ aiAgents: 'disallow-all' as never })
    } catch (err) {
      const msg = (err as Error).message
      expect(msg).toContain("'allow-agents'")
      expect(msg).toContain("'allow-all'")
      expect(msg).toContain("'deny-all'")
    }
  })

  it("phantom docs value 'allow-verified' throws too", () => {
    expect(() => generateRobotsTxt({ aiAgents: 'allow-verified' as never })).toThrowError(
      /Unknown aiAgents value/,
    )
  })

  it('an unknown string never falls into the array branch (no per-character rules)', () => {
    // Pre-#430 an invalid string iterated its characters as rules; guard that
    // regression by asserting the throw happens before any output is built.
    expect(() => generateRobotsTxt({ aiAgents: 'x' as never })).toThrowError(
      /Unknown aiAgents value "x"/,
    )
  })
})

describe('#430 — wildcard block policy', () => {
  it('rules[] branch now also ends with the wildcard Allow block (predictable output)', () => {
    const out = generateRobotsTxt({ aiAgents: [{ userAgent: 'GPTBot', disallow: ['/'] }] })
    expect(out).toContain('User-agent: *\nAllow: /')
  })

  it('wildcard: false suppresses the trailing wildcard block', () => {
    const out = generateRobotsTxt({ aiAgents: 'deny-all', wildcard: false })
    expect(out).not.toContain('User-agent: *')
  })

  it('a user rule targeting * suppresses the automatic wildcard (no duplicate block)', () => {
    const out = generateRobotsTxt({
      aiAgents: [{ userAgent: '*', disallow: ['/drafts'] }],
    })
    expect(out).toContain('User-agent: *\nDisallow: /drafts')
    expect(out.match(/User-agent: \*/g)).toHaveLength(1)
  })

  it('a standard rule targeting * also suppresses the automatic wildcard', () => {
    const out = generateRobotsTxt({
      aiAgents: 'deny-all',
      standard: [{ userAgent: '*', allow: ['/'], disallow: ['/admin'] }],
    })
    expect(out.match(/User-agent: \*/g)).toHaveLength(1)
  })
})
