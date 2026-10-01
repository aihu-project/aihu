/**
 * @aihu/templates-cf-solo — template manifest (compiled JS for Node.js compat).
 *
 * Authoritative source is template.config.ts. This file is the compiled
 * equivalent so that `loadTemplateConfig` can import it when running under
 * Node.js (which cannot import TypeScript natively). Bun prefers the .ts
 * file; Node.js falls through to this one.
 *
 * Keep in sync with template.config.ts — the two files must be semantically
 * identical. Only TypeScript-specific syntax is removed here.
 */

export const config = {
  name: '@aihu/templates-cf-solo',
  displayName: 'Cloudflare · solo',
  description: 'Cloudflare Workers, single-package solo stack + Biome + Vitest + agent-minimal',
  contractVersion: 1,
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
    // These paths are SOURCE paths under `template/` — they must carry the
    // `.tmpl` suffix the files actually have on disk (see cf-team's
    // `template.config.js` header note on the same gotcha: a Node-only path
    // whose conditionalFiles name the post-strip target instead of the
    // `.tmpl` source silently fires zero conditionals).
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
  // GENERATED ranges — see the same block in template.config.ts, and
  // scripts/sync-template-versions.ts.
  appPeerDeps: {
    '@aihu/runtime': '^6.1.1',
    '@aihu/arbor': '^4.1.2',
    '@aihu/signals': '^0.5.1',
    '@aihu/router': '^0.5.1',
    '@aihu/server': '^0.6.0',
    '@aihu/adapter-cloudflare': '^14.0.2',
  },
}

export default config
