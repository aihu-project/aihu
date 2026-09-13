/**
 * Smoke tests for `aihu deploy` (arch-4 §3).
 *
 * Verifies wiring only — does not start a real deploy. Mirrors dev-build.test.ts:
 * `deploy.ts` calls `loadProjectConfig` directly (no injection seam), same as
 * `build.ts`/`dev.ts`, so behavior is exercised at the dispatcher-wiring level.
 */

import { describe, expect, it } from 'vitest'

describe('aihu deploy command', () => {
  it('exports a default async function', async () => {
    const mod = (await import('../src/commands/deploy.ts')) as {
      default: unknown
    }
    expect(typeof mod.default).toBe('function')
  })
})

describe('bin.ts dispatcher', () => {
  it('registers the deploy subcommand', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(__dirname, '..', 'src', 'bin.ts'), 'utf8')
    expect(src).toContain("if (cmd === 'deploy')")
    expect(src).toContain("await import('./commands/deploy.js')")
  })

  it('lists deploy in the top-level usage text', async () => {
    const { usageText } = await import('../src/usage.ts')
    expect(usageText()).toContain('deploy [options]')
  })
})
