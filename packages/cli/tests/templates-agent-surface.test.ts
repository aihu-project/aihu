/**
 * templates-agent-surface — the `agent` template's dual-audience contract.
 *
 * The template's whole claim is that ONE component instance serves a human and
 * an AI agent under DIFFERENT governance. That claim is spread across five
 * generated files that must agree, and nothing but a test keeps them in step:
 *
 *   src/task-list.aihu   declares the tier ladder (`expose:` per member) and
 *                        the gate (`$scope` / `$rate-limit`).
 *   server.ts            registers the surface the gate authorizes against.
 *   mcp.ts               registers the SAME surface for MCP clients.
 *   readiness.ts         derives llms.txt + the MCP/A2A cards from that registry.
 *   index.html           documents the calls a reader will actually paste.
 *
 * A drift between any two of them is not cosmetic. If an action is exposed in
 * the component but missing from the server registry the tool 404s; if it is in
 * the registry but NOT exposed in the component the card advertises something
 * that cannot run; and — the dangerous direction — if a TIER 3 human-only action
 * ever appears in the registry, an agent gains a capability the component
 * deliberately withheld.
 *
 * These are pure-generator assertions: no I/O, no scaffold, no compiler.
 * The behavioural end of this (does it actually compile, does the gate actually
 * refuse) belongs to scaffold-and-compile and the template's own smoke run.
 */

import { describe, expect, it } from 'vitest'
import {
  agentComponentAihu,
  agentIndexHtml,
  agentMainTs,
  agentMcpTs,
  agentPackageJson,
  agentServerTs,
  agentThemeCss,
  agentViteConfig,
} from '../src/templates-agent.ts'

const component = agentComponentAihu()
const server = agentServerTs()
const mcp = agentMcpTs()
const theme = agentThemeCss()
const vite = agentViteConfig()
const main = agentMainTs()

/**
 * The four TIER 2 actions: exposed to the agent, and gated.
 *
 * Kept as a literal rather than derived from the source, so adding an action in
 * one place and forgetting the others fails here instead of silently widening
 * the agent surface.
 */
const GOVERNED_ACTIONS = ['addTask', 'toggleTask', 'setLabel', 'setVariant'] as const

/** TIER 3: real actions on the component that must NEVER reach the agent. */
const HUMAN_ONLY_ACTIONS = ['clearAll', 'removeTask', 'setFilter', 'addFromInput'] as const

/** TIER 0 + TIER 1: the readable names. */
const READABLE_STATE = ['owner', 'remaining', 'total'] as const

/** Local state that is deliberately NOT readable by an agent. */
const PRIVATE_STATE = ['draft', 'filter', 'calls', 'visible', 'allDone', 'refused'] as const

// ── The tier ladder, as declared in the component ───────────────────────────

describe('agent template · tier ladder in src/task-list.aihu', () => {
  it('declares every governed action with the read-write expose tier', () => {
    for (const action of GOVERNED_ACTIONS) {
      // `const <name> = action(` followed, within the config bag, by the tier.
      const decl = component.slice(component.indexOf(`const ${action} = action(`))
      expect(decl, `${action} is not declared`).not.toBe('')
      const bag = decl.slice(0, decl.indexOf('},'))
      expect(bag, `${action} must be 'read write' — it mutates state`).toContain(
        "expose: 'read write'",
      )
    }
  })

  it('gives every governed action a describe: an agent reads it to choose', () => {
    for (const action of GOVERNED_ACTIONS) {
      const decl = component.slice(component.indexOf(`const ${action} = action(`))
      expect(decl.slice(0, decl.indexOf('},'))).toMatch(/describe: ['"]/)
    }
  })

  it('declares every human-only action with NO expose key at all', () => {
    for (const action of HUMAN_ONLY_ACTIONS) {
      const at = component.indexOf(`const ${action} = action(`)
      expect(at, `${action} is not declared`).toBeGreaterThan(-1)
      // Everything up to the end of that action's own declaration line region.
      const decl = component.slice(at, at + 240)
      expect(decl, `${action} must stay invisible to the agent`).not.toContain('expose:')
    }
  })

  it('exposes the readable state as read-only, never read write', () => {
    for (const name of READABLE_STATE) {
      const at = component.search(new RegExp(`(let|const) ${name} = (prop|derived)\\(`))
      expect(at, `${name} is not declared`).toBeGreaterThan(-1)
      const decl = component.slice(at, at + 320)
      expect(decl, `${name} should be exposed`).toContain("expose: 'read'")
      expect(decl, `${name} must not be writable by an agent`).not.toContain("expose: 'read write'")
    }
  })

  it('leaves private view state off the agent surface entirely', () => {
    for (const name of PRIVATE_STATE) {
      const at = component.search(new RegExp(`const ${name} = derived\\(|let ${name} = state`))
      expect(at, `${name} is not declared`).toBeGreaterThan(-1)
      expect(component.slice(at, at + 160)).not.toContain('expose:')
    }
  })
})

// ── The gate, as declared in the component ──────────────────────────────────

describe('agent template · the @agent gate', () => {
  it('declares a scope and a rate limit', () => {
    expect(component).toMatch(/\$scope "tasks:write"/)
    expect(component).toMatch(/\$rate-limit 60/)
  })

  it('carries no comment INSIDE the agent block', () => {
    // The block grammar accepts `input`, `state` and `action` statements plus
    // the two macros — a `/* … */` inside it is a hard C001 parse failure, so
    // the explanation has to live above the block. This caught a real break.
    const block = component.slice(component.indexOf('@agent {'))
    const body = block.slice(0, block.indexOf('\n}'))
    expect(body).not.toContain('/*')
    expect(body).not.toContain('//')
  })

  it('declares exactly one agent block', () => {
    // The block scanner is NOT comment-aware: an `@agent {` written inside an
    // HTML comment counts as a second block and fails with 'duplicate @agent
    // block'. The prose in this file therefore must never spell it that way.
    expect(component.match(/@agent\s*\{/g) ?? []).toHaveLength(1)
  })
})

// ── The mirrors: server.ts and mcp.ts must describe the same surface ────────

describe('agent template · component ↔ server ↔ mcp mirror', () => {
  it.each(GOVERNED_ACTIONS)('registers %s in both server and mcp', (action) => {
    expect(server, `server.ts is missing ${action}`).toContain(`${action}:`)
    expect(mcp, `mcp.ts is missing ${action}`).toContain(`${action}:`)
  })

  it.each(HUMAN_ONLY_ACTIONS)('never registers the human-only action %s', (action) => {
    // The strong claim: absence from the registry is what makes /agent/call
    // answer 404. If this ever fails, an agent has silently gained a capability.
    expect(server, `server.ts must not expose ${action}`).not.toContain(`${action}:`)
    expect(mcp, `mcp.ts must not expose ${action}`).not.toContain(`${action}:`)
  })

  it.each(READABLE_STATE)('mirrors the readable name %s into both registries', (name) => {
    expect(server).toContain(`${name}:`)
    expect(mcp).toContain(`${name}:`)
  })

  it('registers the same scope the component declares', () => {
    expect(server).toContain("scope: 'tasks:write'")
  })

  it('registers a rate limit in the shape the compiler lowers $rate-limit to', () => {
    // `$rate-limit 60` lowers to the string '60/min'. server.ts hand-registers
    // its own binding, so it must use the SAME shape or the two descriptions of
    // one limit disagree.
    expect(server).toContain("rateLimit: '60/min',")
  })

  it('parses the rate spec instead of Number()-ing it', () => {
    // Number('60/min') is NaN. A `|| fallback` would swallow that and silently
    // put every component on the default limit — a governance control that
    // fails open while still looking configured.
    expect(server).toContain('parseRate')
    expect(server).not.toMatch(/Number\(rateSpec\)/)
  })
})

// ── The status wrapper: gate verdict → the code the UI renders ──────────────

describe('agent template · gate verdict wrapper', () => {
  it('maps an approved call to 200 and a refusal to its own code', () => {
    expect(server).toContain('function verdict(')
    // The transport is always 200 and the verdict lives in the BODY, so the
    // wrapper must read the envelope rather than a response status.
    expect(server).toContain("if (e.error === undefined) return { code: 200, note: 'ok' }")
    expect(server).toContain("const code = typeof e.code === 'number' ? e.code : 400")
  })

  it('records the verdict before the response is returned', () => {
    // Ordering matters: the page polls the log, so a refusal must already be
    // recorded by the time the caller reads its own 403.
    const call = server.indexOf('record(body.tool, v.code, v.note)')
    const ret = server.indexOf('return Response.json(result)')
    expect(call).toBeGreaterThan(-1)
    expect(ret).toBeGreaterThan(call)
  })

  it('bounds the log so a long-running demo cannot grow without limit', () => {
    expect(server).toContain('const LOG_MAX = 25')
    expect(server).toContain('if (_log.length > LOG_MAX) _log.length = LOG_MAX')
  })

  it('serves the log read-only and unauthenticated', () => {
    expect(server).toContain("if (url.pathname === '/agent/log')")
    expect(server).toContain('return Response.json(_log)')
    // It must not be behind the gate — it carries verdicts, never credentials.
    expect(server).not.toContain("'/agent/log' && req.method === 'POST'")
  })
})

// ── The component's own status wrapper: what a human sees ───────────────────

describe('agent template · component call-log wrapper', () => {
  it('polls the log and cleans the timer up on dispose', () => {
    expect(component).toContain("fetch('/agent/log')")
    expect(component).toContain('onDispose(() => { clearInterval(pollTimer) })')
  })

  it('renders a human-readable reason for each refusal code', () => {
    for (const code of [404, 401, 403, 429]) {
      expect(component, `no copy for ${code}`).toContain(`call.code === ${code}`)
    }
  })

  it('separates approved from refused visually', () => {
    expect(component).toContain('class:ok={call.code < 400}')
    expect(component).toContain('refused')
  })

  it('survives the bridge server being down', () => {
    // A scaffold where `vite` alone shows a broken page is a bad first run.
    expect(component).toContain('.catch(')
  })
})

// ── Theme wiring ────────────────────────────────────────────────────────────

describe('agent template · theme.css', () => {
  it('declares an @theme block the css engine can read', () => {
    expect(theme).toMatch(/@theme\s*\{/)
  })

  it('has NO comment inside the @theme block', () => {
    // @aihu/css-engine 0.7.0 drops the ENTIRE theme when a comment appears
    // inside the braces — silently, with a build that still exits 0 and a page
    // that quietly renders the built-in palette. This guard is the only thing
    // between that bug and a scaffold that looks fine and is not themed.
    const open = theme.indexOf('@theme {')
    const body = theme.slice(open, theme.indexOf('\n}', open))
    expect(body).not.toContain('/*')
    expect(body).not.toContain('*/')
  })

  it('defines every token the component reaches for', () => {
    for (const token of [
      '--color-primary',
      '--color-primary-foreground',
      '--color-primary-subtle',
      '--color-foreground',
      '--color-card',
      '--color-input',
      '--color-border',
      '--color-ring',
      '--color-muted',
      '--color-muted-foreground',
      '--color-success',
      '--color-success-subtle',
      '--color-destructive',
      '--color-destructive-subtle',
      '--font-sans',
      '--font-mono',
    ]) {
      expect(theme, `${token} is missing`).toContain(`${token}:`)
    }
  })

  it('forwards the theme to the compiler and derives the runtime sheet from it', () => {
    expect(vite).toContain('css: { theme }')
    expect(vite).toContain("theme.replace(/@theme\\s*\\{/, ':root {')")
    expect(vite).toContain('themeRuntimePlugin')
  })

  it('imports the derived sheet, never the raw file', () => {
    // Importing src/theme.css directly ships the @theme block as dead bytes and
    // makes lightningcss warn 'Unknown at rule: @theme' on every single build.
    expect(main).toContain("import 'virtual:aihu-theme.css'")
    expect(main).not.toContain("import './theme.css'")
  })
})

// ── Utility vocabulary ──────────────────────────────────────────────────────

describe('agent template · css-engine utility vocabulary', () => {
  /**
   * Palette keywords the engine actually emits a rule for, probed against
   * @aihu/css-engine 0.7.0. The vocabulary is hand-curated, and an unsupported
   * class is NOT an error: the scanner emits nothing and the class string just
   * sits in the HTML doing nothing. `bg-card`, `bg-input` and the whole
   * `*-subtle` family fall in that hole, which is why the component reaches
   * those tokens through authored CSS instead.
   */
  const UNSUPPORTED = [
    'bg-card',
    'bg-input',
    'bg-primary-subtle',
    'bg-success-subtle',
    'bg-destructive-subtle',
  ]

  it('uses no palette utility the engine silently ignores', () => {
    const templateBlock = component.slice(
      component.indexOf('@template {'),
      component.indexOf('@style {'),
    )
    for (const cls of UNSUPPORTED) {
      expect(templateBlock, `${cls} emits no CSS — use authored CSS for that token`).not.toMatch(
        new RegExp(`\\b${cls}\\b`),
      )
    }
  })

  it('reaches the unsupported tokens through authored CSS instead', () => {
    const styleBlock = component.slice(component.indexOf('@style {'))
    expect(styleBlock).toContain('var(--color-card,')
    expect(styleBlock).toContain('var(--color-input,')
    expect(styleBlock).toContain('var(--color-destructive-subtle,')
  })
})

// ── Dependencies ────────────────────────────────────────────────────────────

describe('agent template · package.json', () => {
  const pkg = JSON.parse(agentPackageJson('demo', 'bun')) as {
    dependencies: Record<string, string>
  }

  it('depends on the css engine it compiles utility classes with', () => {
    expect(pkg.dependencies['@aihu/css-engine']).toBeDefined()
  })

  it('does NOT depend on @aihu/auth', () => {
    // Two independent reasons, either one disqualifying:
    //   1. @aihu/auth@6 peer-pins @aihu/signals to EXACTLY 0.5.0 while this
    //      template pins ^0.5.1, so `npm install` fails ERESOLVE on a fresh
    //      scaffold — the first command a new user runs.
    //   2. <guard> compiles to a bare `getScopeSignal(...)` call with no import
    //      emitted, so it is an unbound identifier at runtime regardless.
    expect(pkg.dependencies['@aihu/auth']).toBeUndefined()
  })
})

// ── Documentation must match the surface it documents ───────────────────────

describe('agent template · index.html examples', () => {
  const html = agentIndexHtml('demo')

  it('only demonstrates calls that exist', () => {
    for (const m of html.matchAll(/task-list\/(\w+)/g)) {
      const action = m[1] as string
      const known = [...GOVERNED_ACTIONS, ...HUMAN_ONLY_ACTIONS] as readonly string[]
      expect(known, `index.html references unknown action ${action}`).toContain(action)
    }
  })

  it('demonstrates a human-only action as the 404 case', () => {
    // Documenting the refusal is the point: it shows the reader that absence
    // from the registry — not a permission flag — is what stops the agent.
    expect(html).toContain('task-list/clearAll')
    expect(html).toContain('404')
  })

  it('documents every refusal the gate can produce', () => {
    for (const code of ['401', '403', '404', '429']) {
      expect(html, `index.html never mentions ${code}`).toContain(code)
    }
  })
})
