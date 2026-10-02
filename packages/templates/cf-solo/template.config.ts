/**
 * @aihu/templates-cf-solo — template manifest.
 *
 * Per arch-6 §1.3 "the curated 5": the solo-dev escape hatch. Cloudflare-only
 * (the one vendor where the solo path is unambiguously "edge function with
 * zero ops surface" — §1.2 collapse #2), single-package (no bun/moon
 * monorepo), no auth scaffold (auth is a team-persona feature per §13 Q3),
 * no commitlint/husky. Same pipeline shape as `@aihu/templates-cf-team`,
 * stamped out per §10 Round B2 — just a smaller fixed cell set and no
 * `apps/web` nesting.
 */

import type { TemplateManifest } from '@aihu/cli/template-manifest'

export const config = {
  name: '@aihu/templates-cf-solo',
  displayName: 'Cloudflare · solo',
  description: 'Cloudflare Workers, single-package solo stack + Biome + Vitest + agent-minimal',
  contractVersion: 1,
  // Same CLI line as cf-team: `scaffoldFromTemplatePackage` (both `aihu app
  // --template` and `create-aihu` run it) landed in @aihu/cli 1.0.1.
  cliRange: '^1.0.0',
  fixed: {
    vendor: 'cloudflare',
    persona: 'solo',
    repo: 'single-package',
    lint: 'biome',
    ci: 'gh-actions',
    test: 'vitest',
  },
  overridable: {
    starter: { choices: ['live-counter', 'empty'], default: 'live-counter' },
    agentSurface: { choices: ['minimal', 'none'], default: 'minimal' },
    css: { choices: ['style-block'], default: 'style-block' },
    initGit: { choices: [true, false], default: true },
  },
  conditionalFiles: [
    { path: 'src/components/live-counter.aihu', when: 'starter === "live-counter"' },
    { path: '.mcp.json', when: 'agentSurface !== "none"' },
    { path: 'src/agent/aihu-expose.aihu.tmpl', when: 'agentSurface !== "none"' },
  ],
  placeholders: [
    'APP_NAME',
    'APP_DESCRIPTION',
    'APP_VERSION',
    'AIHU_VERSION',
    'TEMPLATE_NAME',
    'SCAFFOLD_DATE',
  ],
  postInstall: [
    { kind: 'pm-install' },
    { kind: 'git-init', when: 'initGit' },
    { kind: 'lint-fix', allowFailure: true },
  ],
  // GENERATED ranges — see scripts/sync-template-versions.ts (now generalized
  // to walk every `packages/templates/*` package, not just cf-team). Do not
  // hand-edit; adding/removing a KEY is a real edit, run the generator after.
  appPeerDeps: {
    '@aihu/runtime': '^6.1.1',
    '@aihu/arbor': '^4.1.2',
    '@aihu/signals': '^0.5.1',
    '@aihu/router': '^0.5.3',
    '@aihu/server': '^0.6.1',
    '@aihu/adapter-cloudflare': '^15.0.1',
  },
} satisfies TemplateManifest

export default config
