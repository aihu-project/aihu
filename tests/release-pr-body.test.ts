import { describe, expect, it } from 'vitest'
import { newestSection, renderBody } from '../scripts/release-pr-body.ts'

describe('release-pr-body', () => {
  it('takes only the newest version section', () => {
    const changelog =
      '# @aihu/app\n\n## 10.2.0\n\n### Minor Changes\n\n- new\n\n## 10.1.2\n\n- old\n'
    expect(newestSection(changelog)).toEqual({
      version: '10.2.0',
      body: '### Minor Changes\n\n- new',
    })
  })

  it('returns null for a changelog with no version heading', () => {
    expect(newestSection('# @aihu/app\n')).toBeNull()
  })

  it('names every package and version, sorted, after the intro', () => {
    const body = renderBody([
      { name: '@aihu/router', version: '0.5.3', body: '- b' },
      { name: '@aihu/app', version: '11.0.0', body: '- a' },
    ])
    expect(body.indexOf('## @aihu/app@11.0.0')).toBeGreaterThan(0)
    expect(body.indexOf('## @aihu/app@11.0.0')).toBeLessThan(body.indexOf('## @aihu/router@0.5.3'))
    expect(body.startsWith('Automated Changesets Version PR.')).toBe(true)
  })
})
