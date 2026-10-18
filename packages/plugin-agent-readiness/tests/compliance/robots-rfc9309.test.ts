import robotsParser from 'robots-parser'
import { describe, expect, it } from 'vitest'
import {
  AI_BOT_LIST,
  AI_TRAINING_CRAWLER_BOTS,
  AI_USER_FETCHER_BOTS,
  generateRobotsTxt,
} from '../../src/robots.ts'

// The `describe` block below this one is Layer L0 (self-referential): every
// assertion here is a structural/string check against rules a human
// transcribed from RFC 9309, not against anything that actually implements
// it. See the `L2 — reference-parser behavioral conformance` block further
// down for the external-oracle layer (docs/plans/2026-07-26-agent-readiness-
// external-parity.md §4/§7 step 3).
describe('robots.txt RFC 9309 compliance', () => {
  it('User-agent lines appear before Allow/Disallow in each block', () => {
    const out = generateRobotsTxt({ aiAgents: 'allow-all' })
    const blocks = out.split('\n\n').filter((b) => b.trim().length > 0)
    for (const block of blocks) {
      const lines = block.split('\n')
      const firstAllowDisallow = lines.findIndex(
        (l) => l.startsWith('Allow:') || l.startsWith('Disallow:'),
      )
      const firstUserAgent = lines.findIndex((l) => l.startsWith('User-agent:'))
      if (firstAllowDisallow !== -1 && firstUserAgent !== -1) {
        expect(firstUserAgent).toBeLessThan(firstAllowDisallow)
      }
    }
  })

  it('no User-agent line has an empty value', () => {
    const out = generateRobotsTxt({ aiAgents: 'allow-all' })
    for (const line of out.split('\n')) {
      if (line.startsWith('User-agent:')) {
        expect(line.replace('User-agent:', '').trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('all Allow/Disallow paths start with /', () => {
    const out = generateRobotsTxt({
      standard: [{ userAgent: 'Googlebot', allow: ['/public'], disallow: ['/private'] }],
    })
    for (const line of out.split('\n')) {
      if (line.startsWith('Allow:') || line.startsWith('Disallow:')) {
        const path = line.split(':')[1]?.trim()
        if (path && path.length > 0) {
          expect(path).toMatch(/^\//)
        }
      }
    }
  })

  it('Sitemap appears after all User-agent records', () => {
    const out = generateRobotsTxt({ sitemap: 'https://example.com/sitemap.xml' })
    const sitemapIdx = out.indexOf('Sitemap:')
    const lastUserAgentIdx = out.lastIndexOf('User-agent:')
    expect(sitemapIdx).toBeGreaterThan(lastUserAgentIdx)
  })

  it('Crawl-delay value is a positive number when present', () => {
    const out = generateRobotsTxt({
      standard: [{ userAgent: 'Googlebot', allow: ['/'], crawlDelay: 10 }],
    })
    const cdLine = out.split('\n').find((l) => l.startsWith('Crawl-delay:'))
    expect(cdLine).toBeDefined()
    const val = Number(cdLine?.replace('Crawl-delay:', '').trim())
    expect(val).toBeGreaterThan(0)
  })

  it('deny-all covers all AI_BOT_LIST entries', () => {
    const out = generateRobotsTxt({ aiAgents: 'deny-all' })
    for (const bot of AI_BOT_LIST) {
      expect(out).toContain(`User-agent: ${bot}`)
    }
  })

  it('default config (no args) returns a non-empty string', () => {
    const out = generateRobotsTxt()
    expect(out.trim().length).toBeGreaterThan(0)
    expect(out).toContain('User-agent:')
  })
})

// Gap A, L2 (docs/plans/2026-07-26-agent-readiness-external-parity.md §4,
// §7 step 3): replaces hand-transcribed RFC 9309 assertions with the
// decisions `robots-parser` — a parser that actually implements the spec,
// not our transcription of it — reaches against our emitted text. The
// assertion is "the reference parser reaches the decision we claim", not
// "the text matches a pattern": this would catch a correct-looking robots.txt
// that a real parser nonetheless reads differently (e.g. group-combining,
// longest-match precedence, or wildcard semantics we got subtly wrong).
const BASE = 'https://example.com'
const robotsUrl = (path: string) => `${BASE}${path}`
const parse = (txt: string) => robotsParser(`${BASE}/robots.txt`, txt)

describe('robots.txt L2 — reference-parser behavioral conformance', () => {
  it("'allow-all' is allowed, for every known AI bot, per the reference parser", () => {
    const robots = parse(generateRobotsTxt({ aiAgents: 'allow-all' }))
    for (const bot of AI_BOT_LIST) {
      expect(robots.isAllowed(robotsUrl('/anything'), bot)).toBe(true)
    }
  })

  it("'deny-all' disallows every known AI bot but leaves a plain search crawler allowed, per the reference parser", () => {
    const robots = parse(generateRobotsTxt({ aiAgents: 'deny-all' }))
    for (const bot of AI_BOT_LIST) {
      expect(robots.isAllowed(robotsUrl('/anything'), bot)).toBe(false)
    }
    // Googlebot is a `searcher`, never in AI_BOT_LIST, and gets no dedicated
    // group under deny-all — it falls through to the wildcard `Allow: /`.
    expect(robots.isAllowed(robotsUrl('/anything'), 'Googlebot')).toBe(true)
  })

  it("the default ('allow-agents') tiered policy is honored behaviorally, not just by line presence", () => {
    const robots = parse(generateRobotsTxt())
    for (const bot of AI_USER_FETCHER_BOTS) {
      expect(robots.isAllowed(robotsUrl('/anything'), bot)).toBe(true)
    }
    for (const bot of AI_TRAINING_CRAWLER_BOTS) {
      expect(robots.isAllowed(robotsUrl('/anything'), bot)).toBe(false)
    }
  })

  it('a custom standard rule with per-path allow/disallow is honored by the reference parser', () => {
    const robots = parse(
      generateRobotsTxt({
        standard: [{ userAgent: 'Googlebot', allow: ['/public'], disallow: ['/private'] }],
      }),
    )
    expect(robots.isAllowed(robotsUrl('/public/x'), 'Googlebot')).toBe(true)
    expect(robots.isDisallowed(robotsUrl('/private/x'), 'Googlebot')).toBe(true)
  })

  it('Sitemap is recovered by the reference parser, not just string-present', () => {
    const robots = parse(generateRobotsTxt({ sitemap: 'https://example.com/sitemap.xml' }))
    expect(robots.getSitemaps()).toEqual(['https://example.com/sitemap.xml'])
  })

  it('Crawl-delay is recovered by the reference parser for the declared user agent', () => {
    const robots = parse(
      generateRobotsTxt({ standard: [{ userAgent: 'Googlebot', allow: ['/'], crawlDelay: 10 }] }),
    )
    expect(robots.getCrawlDelay('Googlebot')).toBe(10)
  })
})
