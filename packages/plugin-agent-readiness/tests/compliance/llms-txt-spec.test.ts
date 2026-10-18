// Layer: L0 (self-referential) — asserts our own generator against rules
// transcribed from llmstxt.org, not against that spec's own reference parser.
// No external oracle yet (docs/plans/2026-07-26-agent-readiness-external-
// parity.md §4/§7 step 8 — llms.txt L2 round-trip via Answer.AI's `llms_txt`
// reference parser is scheduled, not landed: it is a Python dependency in
// the test path, a real cost the plan says to schedule rather than gate on).
import { describe, expect, it } from 'vitest'
import { generateLlmsFullTxt, generateLlmsTxt } from '../../src/llms-txt.ts'

describe('llms.txt spec compliance', () => {
  it('first non-blank line is # {name}', () => {
    const out = generateLlmsTxt({ name: 'My App', sections: [] })
    const firstNonBlank = out.split('\n').find((l) => l.trim().length > 0)
    expect(firstNonBlank).toBe('# My App')
  })

  it('summary block is > {text} when present', () => {
    const out = generateLlmsTxt({ name: 'App', summary: 'A great app.', sections: [] })
    expect(out).toMatch(/^# App\n\n> A great app\./)
  })

  it('each section opens with ## {title}', () => {
    const out = generateLlmsTxt({
      name: 'App',
      sections: [{ title: 'Docs', links: [{ title: 'API', url: '/api' }] }],
    })
    expect(out).toContain('## Docs')
  })

  it('## Optional section is last when present', () => {
    const out = generateLlmsTxt({
      name: 'App',
      sections: [
        { title: 'Guides', links: [{ title: 'Intro', url: '/intro' }] },
        { title: 'Ref', links: [{ title: 'API', url: '/api' }] },
      ],
      optional: [{ title: 'Blog', url: '/blog' }],
    })
    const h2s = out.split('\n').filter((l) => l.startsWith('## '))
    expect(h2s[h2s.length - 1]).toBe('## Optional')
  })

  it('link format is - [title](url) without description', () => {
    const out = generateLlmsTxt({
      name: 'App',
      sections: [{ title: 'S', links: [{ title: 'Page', url: '/page' }] }],
    })
    expect(out).toContain('- [Page](/page)')
    expect(out).not.toMatch(/- \[Page\]\(\/page\): $/)
  })

  it('link format is - [title](url): description when description present', () => {
    const out = generateLlmsTxt({
      name: 'App',
      sections: [{ title: 'S', links: [{ title: 'Page', url: '/page', description: 'A page' }] }],
    })
    expect(out).toContain('- [Page](/page): A page')
  })

  it('empty sections (zero links) are omitted', () => {
    const out = generateLlmsTxt({
      name: 'App',
      sections: [
        { title: 'Empty', links: [] },
        { title: 'Has Links', links: [{ title: 'X', url: '/x' }] },
      ],
    })
    expect(out).not.toContain('## Empty')
    expect(out).toContain('## Has Links')
  })

  it('no trailing whitespace on any line', () => {
    const out = generateLlmsTxt({
      name: 'App',
      summary: 'Summary.',
      sections: [{ title: 'Docs', links: [{ title: 'API', url: '/api' }] }],
      optional: [{ title: 'Blog', url: '/blog' }],
    })
    for (const line of out.split('\n')) {
      expect(line).toBe(line.trimEnd())
    }
  })

  it('## Components section appears after content sections and before ## Optional', () => {
    const out = generateLlmsTxt({
      name: 'App',
      sections: [{ title: 'Docs', links: [{ title: 'API', url: '/api' }] }],
      components: [{ tag: 'x-card', describes: 'Card.' }],
      optional: [{ title: 'Blog', url: '/blog' }],
    })
    const h2s = out.split('\n').filter((l) => l.startsWith('## '))
    expect(h2s).toEqual(['## Docs', '## Components', '## Optional'])
  })

  it('## Components section is omitted when there are zero components', () => {
    const out = generateLlmsTxt({
      name: 'App',
      sections: [{ title: 'Docs', links: [{ title: 'API', url: '/api' }] }],
      components: [],
    })
    expect(out).not.toContain('## Components')
  })

  it('component without describes/actions/state renders just its ### heading', () => {
    const out = generateLlmsTxt({
      name: 'App',
      sections: [],
      components: [{ tag: 'x-bare' }],
    })
    expect(out).toContain('### x-bare')
    expect(out).not.toContain('Actions:')
    expect(out).not.toContain('State:')
  })

  it('generateLlmsFullTxt does not contain ## Optional heading', () => {
    const out = generateLlmsFullTxt({
      name: 'App',
      sections: [{ title: 'Docs', links: [{ title: 'API', url: '/api' }] }],
      optional: [{ title: 'Blog', url: '/blog' }],
    })
    expect(out).not.toContain('## Optional')
    expect(out).toContain('## More')
  })
})
