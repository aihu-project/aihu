/**
 * @aihu/templates-cf-team — template manifest (compiled JS for Node.js compat).
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
  name: '@aihu/templates-cf-team',
  displayName: 'Cloudflare · team-ready',
  description:
    'Cloudflare Workers + monorepo (bun workspaces + moon) + better-auth + Biome + commitlint + Vitest + agent-minimal',
  contractVersion: 1,
  // See template.config.ts for why this is `^1.0.0` and not the stale `^0.2.0`
  // it replaced. Keep the two files in step — `loadTemplateConfig` picks the
  // .ts under Bun and this one under Node.js, so a divergence would make the
  // compatibility gate depend on which runtime the user's CLI happens to be.
  cliRange: '^1.0.0',
  fixed: {
    vendor: 'cloudflare',
    persona: 'team',
    repo: 'monorepo-moon',
    lint: 'biome',
    ci: 'gh-actions-commitlint',
    test: 'vitest',
  },
  overridable: {
    auth: {
      choices: ['better-auth', 'kinde', 'supabase'],
      default: 'better-auth',
    },
    starter: { choices: ['live-counter', 'empty'], default: 'live-counter' },
    agentSurface: { choices: ['minimal', 'none'], default: 'minimal' },
    css: { choices: ['style-block'], default: 'style-block' },
    initGit: { choices: [true, false], default: true },
  },
  conditionalFiles: [
    { path: 'apps/web/src/components/live-counter.aihu', when: 'starter === "live-counter"' },
    { path: '.mcp.json', when: 'agentSurface !== "none"' },
    // These paths are SOURCE paths under `template/` — they must carry the
    // `.tmpl` suffix the files actually have on disk. This copy had drifted to
    // the post-strip target names, which match nothing, so under Node.js
    // (where `loadTemplateConfig` falls through to THIS file) not one
    // conditional fired: every auth provider's file was written and no rename
    // was applied. See the parity test in packages/cli/tests/template-compat.test.ts.
    { path: 'apps/web/src/agent/aihu-expose.aihu.tmpl', when: 'agentSurface !== "none"' },
    { path: 'apps/web/src/auth/better-auth.ts.tmpl', when: 'auth === "better-auth"' },
    { path: 'apps/web/src/auth/kinde.ts.tmpl', when: 'auth === "kinde"' },
    { path: 'apps/web/src/auth/supabase.ts.tmpl', when: 'auth === "supabase"' },
    // F-5b: rename provider-specific .env.example files to .env.example so
    // .gitignore patterns work and developer expectations are met.
    {
      path: 'apps/web/.env.example.better-auth.tmpl',
      when: 'auth === "better-auth"',
      rename: '.env.example',
    },
    {
      path: 'apps/web/.env.example.kinde.tmpl',
      when: 'auth === "kinde"',
      rename: '.env.example',
    },
    {
      path: 'apps/web/.env.example.supabase.tmpl',
      when: 'auth === "supabase"',
      rename: '.env.example',
    },
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
    '@aihu/router': '^0.5.0',
    '@aihu/server': '^0.6.0',
    '@aihu/adapter-cloudflare': '^14.0.1',
  },
  appPeerDepsConditional: {
    'better-auth': { version: '^1.0.0', when: 'auth === "better-auth"' },
    '@kinde-oss/kinde-typescript-sdk': { version: '^2.0.0', when: 'auth === "kinde"' },
    '@supabase/supabase-js': { version: '^2.0.0', when: 'auth === "supabase"' },
  },
}

export default config
