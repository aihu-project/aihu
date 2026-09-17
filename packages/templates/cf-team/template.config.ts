/**
 * @aihu/templates-cf-team — template manifest.
 *
 * Per arch-6 §2.3, this is the contract between `@aihu/cli` and this template
 * package. The CLI reads `config` (default export shape) at scaffold time and
 * uses it to drive prompts, conditional file inclusion, placeholder
 * substitution, post-install steps, and emitted `package.json` peer deps.
 *
 * §13 Q3 RESOLVED: `auth` is overridable across {better-auth, kinde, supabase}
 * with default `better-auth`. Each choice gates one config file under
 * `apps/web/src/auth/` and one `.env.example.<provider>`.
 *
 * §13 Q3 lock: `agentSurface` defaults to `'minimal'`; `.mcp.json` and
 * `apps/web/src/agent/aihu-expose.aihu` are emitted unless the user explicitly
 * opts out with `agentSurface: 'none'`.
 */

import type { TemplateManifest } from '@aihu/cli/template-manifest'

export const config = {
  name: '@aihu/templates-cf-team',
  displayName: 'Cloudflare · team-ready',
  description:
    'Cloudflare Workers + monorepo (bun workspaces + moon) + better-auth + Biome + commitlint + Vitest + agent-minimal',
  contractVersion: 1,
  // The CLI majors that can actually scaffold this template.
  //
  // Was `^0.2.0` — written when the CLI was 0.2.x and never revisited, so by
  // CLI 1.2.0 the only publishable template in the repo declared an
  // incompatibility with every CLI that could install it. It survived because
  // nothing compared the field to anything; `assertTemplateCompatibility()` in
  // scaffold-pipeline.ts now does, which is what turned this from dormant text
  // into a scaffold-blocking error and forced a real answer.
  //
  // `^1.0.0`, not a wider range, and not `*`: `scaffoldFromTemplatePackage` —
  // the shared driver BOTH `aihu app --template` and `create-aihu` run — landed
  // in @aihu/cli 1.0.1, so the 1.x line is the CLI that can reach this package
  // at all. The upper bound is real: a 2.0 CLI is free to break the manifest
  // contract, and this template should stop rather than half-scaffold.
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
      // §13 Q3 RESOLVED: 3 third-party auth providers as a runtime prompt.
      // @aihu/auth joins this list once RFC #56 ratifies — not in v0.2.0.
      choices: ['better-auth', 'kinde', 'supabase'],
      default: 'better-auth',
    },
    starter: { choices: ['live-counter', 'empty'], default: 'live-counter' },
    agentSurface: { choices: ['minimal', 'none'], default: 'minimal' },
    css: { choices: ['style-block'], default: 'style-block' }, // tailwind in v0.2.1
    initGit: { choices: [true, false], default: true },
  },
  conditionalFiles: [
    { path: 'apps/web/src/components/live-counter.aihu', when: 'starter === "live-counter"' },
    { path: '.mcp.json', when: 'agentSurface !== "none"' },
    { path: 'apps/web/src/agent/aihu-expose.aihu.tmpl', when: 'agentSurface !== "none"' },
    // Per-auth-provider conditional file sets (§13 Q3 propagation):
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
  // Aihu framework runtime peer deps.
  //
  // GENERATED — the RANGES in this block are written by
  // `scripts/sync-template-versions.ts` from each package's own workspace
  // version, and `check:template-versions` fails CI if they drift. Do not hand-
  // edit them. (Adding or removing a KEY is a real edit; run the generator
  // afterwards.) They sat at a hand-typed `^0.2.0` for the whole life of this
  // file, six majors behind `@aihu/runtime`, because nothing checked them.
  //
  // `appPeerDepsConditional` below is NOT generated: those are third-party auth
  // SDKs this repo does not publish.
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
} satisfies TemplateManifest

export default config
