/**
 * FEL-434b — agent-readiness CONSUMES the compiler's agent-meta sidecars.
 *
 * PROOF METHOD IS PART OF THE BAR. Every assertion below runs against artifacts
 * produced by the published `aihu-compile` executable. This package is a
 * compiler consumer, so its CI must exercise the same released compiler that
 * an application receives instead of rebuilding compiler source in this repo.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { resolvePublishedCompilerBinary } from '../../../scripts/lib/compiler-binary.ts'
import { componentsFromManifestJson, readAgentManifestDir } from '../src/agent-manifest-sidecar.ts'
import { generateLlmsTxt } from '../src/llms-txt.ts'
import { createAgentReadinessRoutes } from '../src/vite-plugin.ts'

/**
 * This is deliberately the native executable from the published platform
 * package. Compiler-source behavior is tested and released in aihu-compiler;
 * this suite verifies the consumer contract.
 */
function compilerBinary(): string {
  return resolvePublishedCompilerBinary()
}

/**
 * A component that is PUBLICLY DISCOVERABLE but whose actions are gated behind
 * an authorization scope: `read: 'agents'` (explicit, so it wins over the
 * fail-closed `$scope → read` derivation) with `call: { scope: 'reports:read' }`.
 *
 * This is the shape that decides the contract. Its sidecar genuinely carries
 * `reports:read` — twice, as the top-level `scope` and inside `extract.call` —
 * so "the scope string is absent from llms.txt" is a real property of the
 * mapping, not an artifact of there being no policy to leak.
 */
const REPORTS_CARD = `@agent {
$scope "reports:read"
}
@state {
import { signal } from '@aihu/signals'

$extract: { read: 'agents', call: { scope: 'reports:read' } }

$prop: {
  title: { default: 'Q3', describe: 'Report title', expose: { read: true } },
}

$action: {
  refresh: { describe: 'Refresh the report', expose: { read: true }, handler: () => setN(n() + 1) },
}

const [n, setN] = signal(0)
}
@template {
  <div>{title}</div>
}
`

/** A second agent component, in the SAME output directory as the first. */
const AUDIT_CARD = `@state {
import { signal } from '@aihu/signals'

$action: {
  audit: { describe: 'Run an audit', expose: { read: true }, handler: () => setM(m() + 1) },
}

const [m, setM] = signal(0)
}
@template {
  <div>audit</div>
}
`

/** No \`@agent\` block, no exposed members → genuinely not an agent component. */
const PLAIN_CARD = `@state {
const label = 'hi'
}
@template {
  <div>{label}</div>
}
`

interface Built {
  readonly outDir: string
  readonly emptyOutDir: string
}

let built: Built

beforeAll(() => {
  const bin = compilerBinary()
  const root = mkdtempSync(join(tmpdir(), 'fel434b-'))
  const src = join(root, 'src')
  const outDir = join(root, 'out')
  const emptyOutDir = join(root, 'out-empty')
  for (const d of [src, outDir, emptyOutDir]) mkdirSync(d, { recursive: true })

  writeFileSync(join(src, 'reports-card.aihu'), REPORTS_CARD)
  writeFileSync(join(src, 'audit-card.aihu'), AUDIT_CARD)
  writeFileSync(join(src, 'plain-card.aihu'), PLAIN_CARD)

  // `--target client` is the build that used to list nothing: the compiler
  // elides `registerAgentMetadata` from client JS, so the live registry — the
  // former sole source of the `## Components` section — is empty.
  for (const name of ['reports-card', 'audit-card']) {
    execFileSync(bin, [join(src, `${name}.aihu`), '--out', outDir, '--target', 'client'], {
      encoding: 'utf8',
    })
  }
  execFileSync(bin, [join(src, 'plain-card.aihu'), '--out', emptyOutDir, '--target', 'client'], {
    encoding: 'utf8',
  })

  built = { outDir, emptyOutDir }
}, 60_000)

const llmsTxtFor = async (components: Awaited<ReturnType<typeof readAgentManifestDir>>) => {
  const routes = createAgentReadinessRoutes(
    { name: 'Test App', llmsSections: [] },
    { readComponents: () => components },
  )
  const url = new URL('https://test.example.com/llms.txt')
  return (await routes.llmsTxt(new Request(url), { params: {}, url })).text()
}

describe('FEL-434b: llms.txt from the compiler agent-meta sidecars', () => {
  it('a client-target build emits a per-tag sidecar for every agent component', () => {
    // Per-tag names, not one fixed `agent-manifest.json`: the fixed name meant
    // the second component in a directory clobbered the first.
    expect(existsSync(join(built.outDir, 'reports-card.agent-manifest.json'))).toBe(true)
    expect(existsSync(join(built.outDir, 'audit-card.agent-manifest.json'))).toBe(true)
  })

  it('lists ALL N agent components compiled into one output directory', async () => {
    const components = await readAgentManifestDir(built.outDir)
    expect(components.map((c) => c.tag)).toEqual(['audit-card', 'reports-card'])

    const body = await llmsTxtFor(components)
    expect(body).toContain('## Components')
    expect(body).toContain('### reports-card')
    expect(body).toContain('- `refresh()`')
    expect(body).toContain('### audit-card')
    expect(body).toContain('- `audit()`')
  })

  it('advertises the component and its action WHILE keeping its scope out of llms.txt', async () => {
    // Precondition — the policy really is in the artifact. Without this the
    // "scope is absent" half is vacuous.
    const sidecar = readFileSync(join(built.outDir, 'reports-card.agent-manifest.json'), 'utf8')
    expect(sidecar).toContain('"scope": "reports:read"')

    const components = await readAgentManifestDir(built.outDir)
    const body = await llmsTxtFor(components)

    // BOTH directions, one assertion: visible surface, invisible policy.
    expect(body).toContain('### reports-card')
    expect(body).toContain('- `refresh()`')
    expect(body).not.toContain('reports:read')

    // The same seam feeds every other served document. Audit them all — a leak
    // anywhere is the same disclosure.
    const routes = createAgentReadinessRoutes(
      { name: 'Test App', llmsSections: [], endpoint: 'https://test.example.com/mcp' },
      { readComponents: () => components },
    )
    for (const [path, handler] of [
      ['/llms-full.txt', routes.llmsFullTxt],
      ['/.well-known/mcp/server-card.json', routes.mcpServerCard],
    ] as const) {
      const url = new URL(`https://test.example.com${path}`)
      const served = await (await handler(new Request(url), { params: {}, url })).text()
      expect(served, `${path} must advertise the surface`).toContain('refresh')
      expect(served, `${path} must not leak the scope`).not.toContain('reports:read')
    }
  })

  it('omits the Components section when there are genuinely no agent components', async () => {
    const components = await readAgentManifestDir(built.emptyOutDir)
    expect(components).toEqual([])
    expect(await llmsTxtFor(components)).not.toContain('## Components')
  })

  it('reads zero components from a directory that does not exist', async () => {
    expect(await readAgentManifestDir(join(built.outDir, 'nope'))).toEqual([])
  })
})

describe('FEL-434b: the manifest → metadata mapping is an allowlist', () => {
  it('drops every policy member and keeps the rendered + filtering ones', () => {
    const [meta] = componentsFromManifestJson(
      JSON.stringify({
        tools: [
          {
            name: 'reports_card',
            tag: 'reports-card',
            inputs: { q: { type: 'string' } },
            actions: { refresh: { returns: {}, describe: 'Refresh' } },
            state: { title: 'Report title' },
            scope: 'reports:read',
            rateLimit: 30,
            streamOutput: 'chunk',
            extract: { read: 'agents', call: { scope: 'reports:read' } },
            somethingAddedLater: 'secret',
            // biome-ignore lint/suspicious/noExplicitAny: untyped raw manifest fixture
          } as any,
        ],
      }),
    )
    expect(Object.keys(meta as object).sort()).toEqual(['actions', 'extract', 'state', 'tag'])
  })

  it('carries `extract` forward so the fail-closed advertise filter still applies', () => {
    // A hard-tier read is NOT advertised. Dropping `extract` would silently
    // publish it, which is the failure mode this member exists to prevent.
    const components = componentsFromManifestJson(
      JSON.stringify({
        tools: [
          {
            tag: 'secret-card',
            actions: { peek: { returns: {} } },
            extract: { read: { scope: 'reports:read' }, call: 'anonymous' },
          },
        ],
      }),
    )
    const txt = generateLlmsTxt({ name: 'Test App', sections: [], components })
    expect(txt).not.toContain('## Components')
    expect(txt).not.toContain('secret-card')
  })

  it('never throws on malformed input', () => {
    expect(componentsFromManifestJson('not json')).toEqual([])
    expect(componentsFromManifestJson('{}')).toEqual([])
    expect(componentsFromManifestJson('{"tools":[{"noTag":1},null,7]}')).toEqual([])
  })
})
