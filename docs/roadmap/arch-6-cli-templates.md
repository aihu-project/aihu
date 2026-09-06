# Architecture Spec — CLI Templates v0.2.0

**Author:** Architect A6 · **Date:** 2026-05-05 · **Track:** `cli-templates`
**Inputs:**
- `state-cli-templates.md` (Topic Director round 001 — PR #76, in-flight)
- `.team/director-notes/cli-templates-001.md`
- `docs/roadmap/arch-3-plugins.md` (plugin matrix, `@aihu/auth` RFC #56 gate)
- `docs/roadmap/arch-4-dx-tools.md` §3 + §6.6 (CLI extensions, `.mcp.json` convention)
- `docs/roadmap/arch-5-sfc-primitives.md` (SFC primitives the templates emit)
- `packages/cli/src/{index,bin,create}.ts` (existing scaffolders — surface to extend)
- `.github/workflows/{release,release-pr,plan-a}.yml` (publish pipeline)
- `scripts/sync-readme.ts` from PR #75 (autogen pattern; tier map)

**User-locked decisions (immutable):**
- **Q1 (Deploy):** Cloudflare + Vercel + Fly are **distinct vendors in M1**. Each owns its full file set (wrangler.toml / vercel.json / Dockerfile + fly.toml). No shared base across vendors.
- **Q2 (Publish strategy):** Separate `@aihu/templates-*` family — one npm package per template. `@aihu/cli` dispatches by name.
- **Q3 (Agent surface default):** ON / Minimal. Every scaffolded template ships `.mcp.json` + at least one `@expose` block. "OFF" is an explicit opt-out flag, not the default.
- **Q4 (Persona):** Team-ready — promote into M1: monorepo (Bun workspaces + moon), a third-party auth scaffold prompt **{better-auth, kinde, supabase}** with `better-auth` as default (RESOLVED §13 Q3), stricter team CI defaults (commitlint hook + branch-protection cookbook reference). `@aihu/auth` (RFC #56) stays held; once RFC #56 ratifies it joins the auth prompt list — not in v0.2.0.

---

## §0 Orientation

`arch-6` specifies the CLI templates v0.2.0 milestone: a curated set of named npm packages under `@aihu/templates-*` that `@aihu/cli` invokes to produce a project that **compiles cleanly post-scaffold** (`bun install && bun run build` exits 0), is **agent-discoverable by default** (`.mcp.json` + `@expose` example shipped), and is **SOTA-on-par-or-better** with `create-next-app`, `create-svelte`, `create-t3-app`, `nuxi init` on every option dimension we offer.

**Consumed by:** Builders (3 rounds, §10) and Verifier (acceptance §8).

**This spec covers:**
- Curated template set (§1) — 5 templates in M1, justified cuts
- Per-template package layout (§2)
- Interactive `aihu app` / `bunx create-aihu` flow (§3)
- Option-matrix → final-files transformation pipeline (§4)
- Compile-after-scaffold CI harness (§5)
- Publish pipeline integration (§6) — single `bun run release` path, no new jobs
- Backward compatibility with existing `aihu app <name>` (§7)
- Acceptance criteria (§8) — runnable Bash checks
- Risks added on top of state §6 (§9)
- 3-round Builder implementation map (§10)
- IS-NOT-IN-V0.2.0 list (§11)
- Post-merge actions (§12)
- Surface-to-user (§13)

**This spec does NOT cover:**
- v0.2.1+ template additions (Tailwind variant, full-A2A-ACP variant, Drizzle variant, full-landing-page starter, Playwright E2E add-on)
- `aihu generate <kind>` per-route / per-component generators (drafted in arch-4 §3 — orthogonal)
- `aihu add <plugin>` post-scaffold codemods (drafted in arch-4 §3 — orthogonal)
- User-authored templates loaded by URL or git ref
- The `aihu page`, `aihu component`, `aihu plugin` legacy paths — they keep working as-is (§7)
- The `@aihu/auth` substantive integration (gates on RFC #56 RATIFY)

---

## §1 The v0.2.0 template package matrix

### §1.1 Math first — the curation problem

Naively, team-ready × {CF, Vercel, Fly} × {minimal, full-agent} × {single-package, monorepo+moon} = **12 cells**. Shipping 12 is combinatorial explosion: 12× the maintenance, 12× the smoke time, 12× the publish coordination, 12× the README drift surface.

**Locked rule (state-cli-templates §5):** every M1 template MUST compile after scaffold. We curate to a set we can keep green every PR.

### §1.2 The dimensional collapses I take

Three reductions get us from 12 → 5:

1. **Vendor × persona is fixed at the package level.** Each vendor template is committed to one persona. Mixing vendor-only choices into a per-vendor package's prompts re-introduces the matrix we just collapsed.
2. **Solo-vs-team is a coarse choice, not a per-vendor matrix.** Solo-dev gets exactly **one** escape-hatch template — Cloudflare-only, since CF is the framework's default vendor and the only one where the solo path is unambiguously "edge function with zero ops surface". Vercel-solo and Fly-solo defer (Vercel-solo overlaps too much with `create-next-app`; Fly-solo's value is container-shaped, which is inherently team territory).
3. **Full-agent is a CF-only canonical showcase in M1.** A2A + ACP scaffolds are protocol-churn-prone (state §6 R-CT-05). Picking one vendor (CF) keeps churn surface small until the protocols stabilize. Vercel-full-agent and Fly-full-agent enter v0.2.1 once the M1 showcase has shaken out.

### §1.3 The curated 5 (M1)

| Template package | Cells fixed | Cells overridden by prompt |
|---|---|---|
| **`@aihu/templates-cf-team`** **(✅ shipped v0.2.0 — PR #86)** | Vendor=CF, Persona=team, Repo=monorepo+moon, Auth=third-party prompt {better-auth/kinde/supabase}, default better-auth, Lint=Biome, CI=GitHub Actions+commitlint, Test=Vitest, Agent=minimal | App name; CSS (`@style`/Tailwind-deferred-to-v0.2.1 → for M1 only `@style`); starter (`<live-counter>` / empty); deploy-already-fixed; agent surface (minimal/none — full-agent users pick the dedicated template) |
| **`@aihu/templates-vercel-team`** **(deferred to B2 — v0.2.1+)** | Vendor=Vercel, Persona=team, Repo=monorepo+moon, Auth=third-party prompt {better-auth/kinde/supabase}, default better-auth, Lint=Biome, CI=GitHub Actions+commitlint, Test=Vitest, Agent=minimal | Same prompt set as `cf-team` |
| **`@aihu/templates-fly-team`** **(deferred to B2 — v0.2.1+)** | Vendor=Fly (Dockerfile + fly.toml emit), Persona=team, Repo=monorepo+moon, Auth=third-party prompt {better-auth/kinde/supabase}, default better-auth, Lint=Biome, CI=GitHub Actions+commitlint, Test=Vitest, Agent=minimal | Same prompt set as `cf-team` |
| **`@aihu/templates-cf-solo`** **(deferred to B2 — v0.2.1+)** | Vendor=CF, Persona=solo, Repo=single-package, Auth=none, Lint=Biome, CI=GitHub Actions (no commitlint), Test=Vitest (skippable), Agent=minimal | App name; CSS; starter (`<live-counter>` / empty); agent surface (minimal/none); test runner (vitest/none) |
| **`@aihu/templates-cf-full-agent`** **(deferred to B2 — v0.2.1+)** | Vendor=CF, Persona=team, Repo=monorepo+moon, Auth=third-party prompt {better-auth/kinde/supabase}, default better-auth, Lint=Biome, CI=GitHub Actions+commitlint, Test=Vitest, Agent=**FULL** (A2A + ACP scaffold + `@expose` + `$rate-limit` annotation) | App name; CSS; starter (always `<live-counter>` — the showcase) |

**Total = 5 templates in M1 design space; only `cf-team` ships in v0.2.0** per arch-6 §10's "Round-B1 deliberate scope cut: no other vendors. No solo template. No full-agent." The other 4 stamp out from the same pipeline shape in B2 (v0.2.1). All five are distinct enough that scaffolding one tells the user nothing about the others; combining any two into a flag-driven base would re-introduce the option-explosion the curation just removed.

> **B1.1 status (PR #79, merged 2026-05-05):** the `@aihu/cli`-side contract that every template package in this curated 5 conforms to (`TemplateManifest` type, scaffold pipeline, conditional-eval evaluator, prompts library, baked registry) is now in main. `cf-team` template content lands in B1.2.

### §1.4 What I considered and cut

- **Sixth template `@aihu/templates-cf-team-tailwind`** — cut because Tailwind 4 lands in v0.2.1 per state §3. Adding a Tailwind sibling now means publishing a package whose value prop arrives in a later milestone.
- **`@aihu/templates-vercel-full-agent` / `@aihu/templates-fly-full-agent`** — cut for v0.2.0 per §1.2 collapse #3. Promoted to v0.2.1 once protocol churn has shaken out against the CF showcase.
- **`@aihu/templates-vercel-solo` / `@aihu/templates-fly-solo`** — cut. Vercel-solo's value prop is dominated by `create-next-app`; Fly-solo's container-shape is inherently team-shaped.
- **A "landing page" persona variant** — deferred per state §3 (M3) and explicitly listed in §11.

### §1.5 Naming convention (locked)

`@aihu/templates-<vendor>-<persona-or-feature>` where:
- `<vendor>` ∈ `{cf, vercel, fly}` (3-letter abbreviations; matches `@aihu/adapter-cloudflare` short-form pattern users will see in `aihu deploy` output)
- `<persona-or-feature>` ∈ `{team, solo, full-agent}` for v0.2.0; v0.2.1 adds e.g. `tailwind-team`

Rejected alternatives:
- `@aihu/templates-<feature1>-<feature2>-<feature3>` (e.g. `@aihu/templates-cf-monorepo-better-auth`) — combinatorial naming is exactly the matrix we just collapsed
- `@aihu/template-*` (singular) — the family-of-templates is the noun; plural reads correctly as "the templates package whose name is cf-team"

### §1.6 Defending the curation against the SOTA bar

Every named competitor (`create-next-app`, `create-svelte`, `create-vue`, `create-vite`, `create-remix`, `create-astro`, `create-t3-app`, `nuxi init`, `bunx create-solid`) ships a single scaffolder that prompts the deploy target. Aihu shipping **5 vendor-distinct packages** is more shape than competitors — this is a deliberate consequence of Q1 (vendor-distinct templates own their full file set, no shared base). The trade-off bought is: **each template's emitted vendor configuration is hand-curated, not assembled** — wrangler.toml is wrangler.toml as a real CF user would write it, not as a transformer would generate it. That matches the state §4 SOTA bar ("the emitted file set looks like the template author's own production project, not a generator's average").

> ⚠ HOLD-applied note: §1 was paused mid-spec by the coordinator on user-walkback signal, then resumed with Q1 confirmed (vendor-distinct, one package per vendor × persona cell). The 5-template curation above is the post-resume cut. If user re-walks-back, downsize first by removing `cf-full-agent` (it's the most protocol-churn-prone), then `fly-team` (no `@aihu/adapter-fly` exists yet — see §9 R-CT-09).

---

## §2 Template package layout

Every `@aihu/templates-<name>` package has the same shape. Builders implement the shape once and stamp 5 instances.

### §2.1 Filesystem layout (under `packages/templates/<name>/`)

```
packages/templates/<name>/
  package.json                # name = @aihu/templates-<name>; bin field; files whitelist
  template.config.ts          # declarative manifest (§2.3)
  template/                   # source directory copied + placeholder-substituted
    package.json.tmpl         # placeholders: __APP_NAME__, __APP_VERSION__, __AIHU_VERSION__
    tsconfig.json
    README.md.tmpl
    aihu.config.ts.tmpl
    rolldown.config.ts.tmpl
    .mcp.json                 # always emitted (Q3 lock); locked content per §2.5
    .gitignore
    biome.json
    moon.yml.tmpl             # only present in monorepo+moon templates
    .github/workflows/ci.yml.tmpl
    src/
      main.ts.tmpl
      pages/
        index.aihu.tmpl
      components/
        live-counter.aihu     # only when starter=<live-counter>
    # vendor-specific files:
    wrangler.toml.tmpl        # cf-* templates
    vercel.json.tmpl          # vercel-* templates
    Dockerfile.tmpl           # fly-* templates
    fly.toml.tmpl             # fly-* templates
    # team-only files:
    apps/web/...              # monorepo+moon shape (cf-team, vercel-team, fly-team, cf-full-agent)
    packages/ui/...           # monorepo shape only
    .commitlintrc.json        # team templates only
    .husky/                   # team templates only
  README.md                   # auto-generated by sync-readme.ts (§6.3)
  CHANGELOG.md                # changesets-managed
```

### §2.2 `package.json` shape (per template)

Locked fields:
- `"name": "@aihu/templates-<name>"`
- `"version"` — independent SemVer; bumped via changesets in lockstep with `@aihu/cli` only when the cli's contract with templates changes
- `"bin"`: omitted. Templates are NOT directly invokable; `@aihu/cli` is the single entrypoint. (Rejected alternative: `"bin": { "aihu-template-cf-team": "./dist/cli.js" }` — adds 5 npm bins for no user-visible value, since users always run `bunx create-aihu` or `aihu app`.)
- `"files": ["template", "template.config.js", "dist"]`
- `"sideEffects": false`
- `"dependencies": {}` — templates have **zero runtime deps** (they are static-asset packages). The `template/` directory's emitted `package.json.tmpl` declares the app's runtime deps.
- `"devDependencies"` — only what's needed to build `template.config.ts` to `dist/template.config.js` (TypeScript)
- `"peerDependencies": { "@aihu/cli": "^0.2.0" }` — declares the CLI version range that knows how to consume this template's manifest

### §2.3 `template.config.ts` (the manifest the CLI reads)

This is the contract between `@aihu/cli` and the template. Locked TypeScript shape:

```ts
import type { TemplateManifest } from '@aihu/cli/template-manifest'

export default {
  name: '@aihu/templates-cf-team',
  displayName: 'Cloudflare · team-ready',
  description: 'Cloudflare Workers + monorepo (bun workspaces + moon) + better-auth + Biome + commitlint + Vitest + agent-minimal',
  // Major contract version — bumps when the CLI must adapt to consume.
  contractVersion: 1,
  // Aihu CLI version range that supports this manifest's contractVersion.
  cliRange: '^0.2.0',
  // Cells fixed by this template (not user-overridable).
  fixed: {
    vendor: 'cloudflare',
    persona: 'team',
    repo: 'monorepo-moon',
    lint: 'biome',
    ci: 'gh-actions-commitlint',
    test: 'vitest',
  },
  // Cells the user CAN override at scaffold time, with constraints.
  overridable: {
    css: { choices: ['style-block'], default: 'style-block' }, // tailwind in v0.2.1
    starter: { choices: ['live-counter', 'empty'], default: 'live-counter' },
    agentSurface: { choices: ['minimal', 'none'], default: 'minimal' },
    auth: {
      // §13 Q3 RESOLVED: 3 third-party auth providers as a runtime prompt.
      // @aihu/auth joins this list once RFC #56 ratifies — not in v0.2.0.
      choices: ['better-auth', 'kinde', 'supabase'],
      default: 'better-auth',
    },
    initGit: { choices: [true, false], default: true },
  },
  // Files in template/ are included unconditionally unless listed here.
  conditionalFiles: [
    { path: 'src/components/live-counter.aihu', when: 'starter === "live-counter"' },
    { path: '.mcp.json', when: 'agentSurface !== "none"' },
    { path: 'src/agent/expose.aihu', when: 'agentSurface !== "none"' },
    // Per-auth-provider conditional file sets (§13 Q3 propagation):
    { path: 'src/auth/better-auth.ts', when: 'auth === "better-auth"' },
    { path: 'src/auth/kinde.ts',       when: 'auth === "kinde"' },
    { path: 'src/auth/supabase.ts',    when: 'auth === "supabase"' },
    { path: '.env.example.better-auth', when: 'auth === "better-auth"' },
    { path: '.env.example.kinde',       when: 'auth === "kinde"' },
    { path: '.env.example.supabase',    when: 'auth === "supabase"' },
  ],
  // Placeholders the substitution pass replaces (full list locked in §4.3).
  placeholders: ['APP_NAME', 'APP_VERSION', 'AIHU_VERSION', 'APP_DESCRIPTION', 'TEMPLATE_NAME'],
  // Post-install steps (in order). The CLI runs them; templates declare them.
  postInstall: [
    { kind: 'pm-install' },                    // bun install (or detected pm)
    { kind: 'git-init', when: 'initGit' },     // git init + initial commit
    { kind: 'lint-fix', allowFailure: true },  // bun run check (best-effort)
  ],
  // Runtime peer dep set the emitted package.json must declare. Pinned to a
  // minor range; sync-readme renders this for the README.
  // Auth deps are conditional (per §13 Q3) — only the chosen provider's
  // dep gets emitted into the user's package.json.
  appPeerDeps: {
    '@aihu/runtime': '^0.2.0',
    '@aihu/arbor': '^0.2.0',
    '@aihu/signals': '^0.2.0',
    '@aihu/router': '^0.2.0',
    '@aihu/adapter-cloudflare': '^0.2.0',
  },
  appPeerDepsConditional: {
    'better-auth': { version: '^1.0.0', when: 'auth === "better-auth"' },
    '@kinde-oss/kinde-typescript-sdk': { version: '^2.0.0', when: 'auth === "kinde"' },
    '@supabase/supabase-js': { version: '^2.0.0', when: 'auth === "supabase"' },
  },
} satisfies TemplateManifest
```

`TemplateManifest` lives in `@aihu/cli/template-manifest` (a new public-typed export from the CLI package). Templates depend on `@aihu/cli` only as a **peer** dep so they can compile against types without forming a runtime cycle.

### §2.4 Placeholder syntax (locked: literal-string-replace)

**Decision:** literal `__PLACEHOLDER__` with double-underscores on both sides. Substitution is `String.prototype.replaceAll`. No expression evaluation, no nested placeholders, no escaping.

Defended:
- `create-next-app`, `create-vite`, `create-svelte`, `nuxi init` all use literal-string-replace. Aihu would be the outlier choosing Mustache/Handlebars.
- We have **zero new runtime deps** for the CLI (existing zero-dep contract — Learning #49).
- Mustache/Handlebars unlock conditional rendering of file *contents*. Our pipeline does conditionals at the **file-inclusion** layer (§2.3 `conditionalFiles`), which is sufficient for v0.2.0's surface.
- `__APP_NAME__` is an obvious-as-data string in source files; no risk of accidental match in real code.

Rejected:
- Mustache (`{{appName}}`) — adds runtime dep; `{{}}` collides with `.aihu` template-block expression syntax (`{{ count }}` in `@template`), creating a footgun where placeholder substitution would mangle real code.
- Handlebars (`{{#if}}{{/if}}`) — same collision; also encourages logic-in-templates which the file-inclusion layer should own.
- EJS (`<%= appName %>`) — adds dep; reads as foreign noise inside `.aihu` SFCs.

### §2.5 The locked `.mcp.json` content (Q3 lock)

Every M1 template emits this exact `.mcp.json` at the scaffolded app's root (or `apps/web/.mcp.json` for monorepo templates):

```json
{
  "mcpServers": {
    "aihu": {
      "command": "aihu",
      "args": ["mcp", "serve"],
      "cwd": "."
    }
  }
}
```

Source: arch-4 §6.6. This is identical across all 5 templates — there is no per-template `.mcp.json` variation in M1. Future variations (e.g. cloud-hosted MCP server) defer to v0.3.

### §2.6 The locked agent-surface example (Q3 lock)

> **v2 agent surface (compiler@0.4.0 / AMD-04).** The per-name agent surface is expressed via `describe:`/`expose:` keys on `@state` collection entries. The old `@agent { $expose / $describe }` macros are **C440 errors** in v2; the `@agent` block now holds only `$scope` / `$rate-limit`. The Q3 lock is therefore re-expressed as "at least one `@state` entry carries `expose:`".

Every M1 template that has `agentSurface !== 'none'` ships at minimum **one** `.aihu` SFC with an exposed `@state` entry. For templates with the `<live-counter>` starter, that's `src/components/live-counter.aihu`'s exposed `count` prop (already shipped in `examples/live-counter/`). For templates with `starter === 'empty'`, the CLI emits a tiny `src/agent/expose.aihu` shim:

```aihu
@state {
  $prop: {
    appName: {
      default: '__APP_NAME__',
      type: "string",
      describe: "The scaffolded application's display name",
      expose: { read: true },
    }
  }
}

@template {
  <span class="aihu-expose-stub">{appName}</span>
}
```

This guarantees the Q3 lock ("at least one exposed `@state` entry") even when the user picked the empty starter.

---

## §3 The `aihu app` interactive flow

### §3.1 Top-level CLI surface (locked argv shape)

```
aihu app <name> [--template <T>] [--no-interactive] [--use-defaults] [--options-json <path>] [--pm <bun|pnpm|npm|yarn>] [--no-git]
bunx create-aihu [<name>] [--template <T>] [--no-interactive] [--use-defaults] [--options-json <path>] [--pm <bun|pnpm|npm|yarn>] [--no-git]
```

`aihu app` and `bunx create-aihu` share an entrypoint via `packages/cli/src/create.ts` (existing). The new flow extends `create.ts`; the legacy template-name list (`minimal | full | docs`) is **renamed to a default fallback** — see §7.

### §3.2 Prompt sequence (default interactive path)

```
1. App name
   → CLI arg if present, else prompt; default = "my-aihu-app"

2. Template
   → Numbered list of registered templates with one-line descriptions:
     1) cf-team       Cloudflare Workers + team monorepo (recommended)
     2) vercel-team   Vercel + team monorepo
     3) fly-team      Fly.io + team monorepo
     4) cf-solo       Cloudflare Workers + single-package (escape hatch)
     5) cf-full-agent CF Workers + team + full agent surface (A2A + ACP)
   → Default = cf-team (matches the "Cloudflare is Aihu's default vendor" thesis)

3. "Use recommended defaults?" [Y/n]
   → Y: skip remaining prompts, use template defaults from template.config.ts
   → n: prompt the overridable cells (per template — varies by manifest)

4. Per-template overrides — only the overridable cells from §2.3
   - css                (where applicable; in M1 always 'style-block')
   - starter            (live-counter / empty)
   - agentSurface       (minimal / none) — Q3 lock means default is 'minimal'
   - initGit            (Y/n)

5. Package manager
   → Auto-detect (bun > pnpm > yarn > npm); confirm; default to detected

6. Confirmation summary + scaffold
```

### §3.3 Non-interactive surface (CI / test use)

`--no-interactive` requires `--template <T>` and either `--use-defaults` or `--options-json <path>`. Without one of those it errors with a clear message listing exactly which flags are missing.

`--options-json` schema:
```json
{
  "appName": "smoke-app",
  "template": "cf-team",
  "overrides": {
    "css": "style-block",
    "starter": "live-counter",
    "agentSurface": "minimal",
    "initGit": false
  },
  "pm": "bun"
}
```

The CLI validates this against `template.config.ts.overridable` before scaffolding; any unknown key or out-of-range value errors with the manifest's allowed choices listed.

### §3.4 Prompt library (locked: hand-rolled `node:readline`)

**Decision:** keep the existing `node:readline` + `process.stdout` pattern from `packages/cli/src/create.ts`. Extend, do not replace.

Defended:
- Adding a `prompts` or `enquirer` dep breaks the zero-dep contract (Learning #49). The current solo-mode `create.ts` is dep-free; teams expect the team-mode to inherit that property.
- `create-vite` is also dep-free; it uses a small in-tree `prompts` clone. We can ship the same — keep it inline in `packages/cli/src/prompts.ts` (new file, ~150 LOC).
- Rejected `prompts` (npm): +1 dep, +13 transitive deps as of 2026-05.
- Rejected `enquirer`: +1 dep, more visual polish but the cost-benefit doesn't pass when our user is already comfortable with `create-next-app`-tier UX.
- Rejected `@clack/prompts`: best-in-class UX but +1 dep and authored by a single maintainer (continuity risk).

Builders implement multi-select / arrow-keys via raw stdin escape codes (matches `create-vite`'s pattern). The number-list fallback (`1) cf-team`, type number) is the always-available alternative for non-TTY shells.

### §3.5 Where the CLI gets the template list from

**Decision (locked):** the CLI reads the npm registry via a hardcoded list of known template package names baked into the CLI binary at publish time — NOT a registry-search at runtime.

```ts
// packages/cli/src/templates-registry.ts
export const KNOWN_TEMPLATES = [
  '@aihu/templates-cf-team',
  '@aihu/templates-vercel-team',
  '@aihu/templates-fly-team',
  '@aihu/templates-cf-solo',
  '@aihu/templates-cf-full-agent',
] as const
```

Defended:
- Registry-search at runtime adds network latency to first prompt (~500-2000ms). `create-next-app` does not do this; neither should we.
- A baked list means each `@aihu/cli` minor publish stamps the supported template set. v0.2.0 ships with these 5; v0.2.1 bumps both `@aihu/cli` and adds the new template names to this list.
- User-authored templates (out of v0.2.0 scope per §11) would need a different lookup mechanism — when that lands, we extend with `--template <github-org/repo>` syntax, not registry-search.

The CLI then `import()`s `<template-pkg>/dist/template.config.js` dynamically once the user picks one. Templates are pulled via `bunx <template-pkg>@latest` style on-demand: when the user picks `cf-team`, `@aihu/cli` resolves the latest published `@aihu/templates-cf-team` and reads its `template.config.js` + `template/` directory from the resolved cache.

---

## §4 Option-matrix → final files transformation pipeline

### §4.1 Pipeline stages (locked, in order)

```
[1] resolveTemplate(name)
    → import('<pkg>/dist/template.config.js'); validate manifest schema
[2] mergeOptions(manifest, cliFlags, userPrompts)
    → resolved Options object: { appName, overrides, pm }
    → validate against manifest.fixed (no override allowed) and manifest.overridable
[3] enumerateFiles(manifest, options)
    → walk <pkg>/template/ recursively
    → for each path: if conditionalFiles entry exists, evaluate when expression
    → emit ordered list of (sourcePath, targetRelPath, isTemplate) tuples
[4] readSubstituteWrite(files, options, targetDir)
    → for each: read source file
    → if path ends in .tmpl: strip .tmpl from target, run placeholder substitution
    → if no .tmpl: copy verbatim (preserves binary safety; no string corruption)
    → mkdir -p targetDir; writeFile
[5] runPostInstall(manifest, options, targetDir)
    → for each step in manifest.postInstall: dispatch by kind
    → kinds: 'pm-install' | 'git-init' | 'lint-fix' | 'aihu-check'
[6] printNextSteps(options, targetDir)
    → cd <name> · bun run dev · docs link
```

### §4.2 Conditional-file inclusion (locked: manifest-declared, NOT filename-encoded)

Each template's `template.config.ts` lists `conditionalFiles: Array<{ path: string; when: string }>`. The `when` expression is a **strict subset of JavaScript**, evaluated by a hand-rolled mini-evaluator (NOT `eval`, NOT `Function`, NOT `vm`):

Allowed in `when`:
- Bare identifiers from the resolved options (`starter`, `agentSurface`, `initGit`)
- Literal strings (`'live-counter'`, `'none'`)
- Literal booleans (`true`, `false`)
- Operators: `===`, `!==`, `&&`, `||`, `!`
- Parentheses for grouping

Rejected: full JS expression evaluation. Reasons: zero-dep, supply-chain safety (a malicious template package could otherwise execute arbitrary code at scaffold time), test surface tractability.

The mini-evaluator lives in `packages/cli/src/conditional-eval.ts` (~100 LOC). Builder Round B1 implements + tests it.

**Why manifest-declared, not filename-suffix-encoded:**

- Filename encoding (`wrangler.toml.if-deploy-cloudflare`) leaks the option-matrix into filesystem semantics. Renaming a dimension means renaming files across all 5 templates. Renames + git history get noisy.
- Manifest-declared centralizes the "what depends on what" surface. A reader of the template can read `template.config.ts` and see all conditionality in one place.
- The cost: one extra indirection. Acceptable.

### §4.3 Placeholder substitution (locked set)

```
__APP_NAME__         → user-provided app name (validated: kebab-case, no leading digit)
__APP_DESCRIPTION__  → user-provided description; defaults to template's displayName
__APP_VERSION__      → "0.1.0" (always, until user runs first changeset)
__AIHU_VERSION__     → @aihu/runtime version range from manifest.appPeerDeps
__TEMPLATE_NAME__    → manifest.name (used in scaffolded README provenance line)
__SCAFFOLD_DATE__    → ISO date stamp for README "scaffolded on" line
```

Substitution order is undefined (string-replace over a small set; no placeholder is a substring of another, so order is irrelevant). The CLI validates this property at startup against the manifest's declared placeholder list.

### §4.4 Pure-function shape (preserves the existing `index.ts` pattern)

The pipeline is implemented as 6 pure functions in `packages/cli/src/scaffold-pipeline.ts`:

```ts
export function resolveTemplate(name: string): Promise<TemplateManifest>
export function mergeOptions(m: TemplateManifest, ...): ResolvedOptions
export function enumerateFiles(m: TemplateManifest, o: ResolvedOptions): FileTuple[]
export function readSubstituteWrite(tuples: FileTuple[], o: ResolvedOptions, dir: string): WrittenFiles
export function runPostInstall(m: TemplateManifest, o: ResolvedOptions, dir: string): PostInstallResult
export function printNextSteps(o: ResolvedOptions, dir: string): void
```

Each function is independently testable (mock filesystem, mock spawn). No global state. No I/O in `resolveTemplate`/`mergeOptions`/`enumerateFiles` (they're pure given the manifest object).

---

## §5 Compile-after-scaffold CI harness *(coordinator-released — covers the curated set)*

### §5.1 Where the test lives (locked)

`packages/cli/tests/scaffold-and-compile.test.ts` (Vitest). Adjacent to existing CLI tests; runs in the same `bun run test` job that already gates Plan A CI.

Rejected: a separate `tests/integration/templates.test.ts` cross-cutting directory — would force a new Vitest config and a new CI job. The unified-test-tree approach matches the existing `packages/<pkg>/tests/` convention.

### §5.2 Runner (locked: Vitest with extended timeout)

Vitest `--testTimeout=180000` (3 minutes per test case). `bun install --frozen-lockfile && bun run build` for a 5-template scaffold takes ~30-60s on CI; 3-minute headroom covers cold-cache start.

Rejected `bun test`: doesn't yet support multi-process test isolation as cleanly, and Vitest is the project's existing harness.

Rejected pure shell script: harder to integrate into the existing test report; harder to assert structured outcomes.

### §5.3 Coverage strategy (locked: representative sample, not combinatorial)

For each of the 5 templates, run **2 cases**:
- `default-everything` — all defaults
- `agent-surface-none` — explicit Q3 opt-out path

That's **10 cases total**. Each case scaffolds + installs + builds + typechecks. Estimated wall time: 10 × ~45s = ~7-8 minutes on CI.

Combinatorial coverage (every override × every template) is rejected for v0.2.0 per state §5 ("the minimal sufficient set"). When v0.2.1 adds more dimensions, this matrix grows; the harness scales linearly.

### §5.4 Per-case acceptance per fixture (locked, runnable Bash)

Each test case in Vitest invokes the same Bash flow:

```bash
TMP=$(mktemp -d)
cd "$TMP"
bunx --bun "@aihu/cli@workspace:*" app smoke-app \
  --template <template-name> --no-interactive --use-defaults --no-git
cd smoke-app
bun install --frozen-lockfile  # exit 0
bun run build                  # exit 0
bun run typecheck              # exit 0
bun run test                   # exit 0 (Vitest exits 0 even with zero tests)
test -f .mcp.json              # Q3 lock
grep -rE 'expose:' src/ > /dev/null  # Q3 lock — at least one exposed @state entry (v2 agent surface)
```

The Vitest harness wraps this in a `it.each(cases)` block with structured assertions (so failures report per-case, not as a single shell-script-died).

### §5.5 CI wiring (locked: extends existing `plan-a.yml` test job)

Add the `scaffold-and-compile.test.ts` to the existing `plan-a.yml` `check` job (which already runs `bun run test`). No new workflow; no new job.

The existing `paths-ignore` skip on `.team/**`, `docs/**`, `*.md` keeps the spec-only PRs fast. PRs that touch `packages/cli/**` or `packages/templates/**` invalidate the skip and run the harness.

---

## §6 Publish pipeline integration

### §6.1 The architectural simplification (locked)

`bun run release` (the existing root `package.json` script) calls `changeset publish`, which publishes **every package not in `.changeset/config.json`'s `ignore` list** that has a version-bump in its `package.json` from a Changesets Version PR.

**Decision:** add `packages/templates/<name>/` to bun workspaces (it already is via `packages/*` glob in root `package.json`). Each `@aihu/templates-<name>` is a normal workspace package. Changesets versions and publishes them via the existing path.

**Therefore: `release.yml` requires zero new jobs.** The `publish-packages` job (line 365) already runs `bun run release` post-tag-push. Templates ride that train.

### §6.2 Versioning policy (locked)

- Templates use **independent SemVer**, NOT linked-with-`@aihu/cli`.
- `@aihu/cli` declares `engines.aihu-templates-contract` (or equivalent) — the contract version it knows how to consume.
- Templates declare `peerDependencies["@aihu/cli"]: "^0.2.0"` — the CLI version range they're compatible with.
- A template can ship a **patch** independently (e.g. fix a typo in README, bump a peer dep version). The CLI doesn't need to know.
- A template's **major** bump means its `template.config.ts.contractVersion` changed; this requires a coordinated `@aihu/cli` release.

### §6.3 README autogen via `sync-readme.ts` (locked)

PR #75 (in-flight as of writing) adds `scripts/sync-readme.ts` with a `PACKAGE_TIERS` map. This spec proposes:

- New tier `'template'` (alongside `'A'`, `'B'`, `'C'`, `'D'`, `'E'`, `'platform'`)
- All 5 `@aihu/templates-*` packages mapped to `tier: 'template'`
- Tier `'template'` `seeAlso` links: `[ { label: 'arch-6 spec', href: '../../docs/roadmap/arch-6-cli-templates.md' }, { label: 'state', href: '../../state-cli-templates.md' } ]`
- The pre-commit hook from PR #75 ensures every template README stays synced to its `package.json` description + `template.config.ts` displayName.

This is a Builder Round B3 task (sync-readme.ts must have landed first; see §10).

### §6.4 What the Release PR looks like for templates

When a user adds a `.changeset/*.md` describing e.g. "feat(templates-cf-team): emit better-auth scaffold", the existing `release-pr.yml` workflow opens a Release PR that:
- Bumps `@aihu/templates-cf-team` from `0.2.0` → `0.2.1`
- Updates its CHANGELOG.md
- Does NOT bump `@aihu/cli` (no inter-version coupling)

On Release-PR merge, `release.yml` runs, builds, publishes — `@aihu/templates-cf-team@0.2.1` lands on npm. Existing scaffolded apps are unaffected; new `bunx create-aihu --template cf-team` invocations get the patched template.

### §6.5 Bun-publish vs npm-publish (locked: bun publish via changeset)

`release.yml` line 425 already runs `bun run release` (= `bun run build && changeset publish`). Changesets internally calls `bun publish` (since the workspace is bun-managed). This handles `workspace:*` deps correctly (rewrites them to the actual version on publish).

No change required.

---

## §7 Backward compatibility with existing `aihu app <name>`

### §7.1 The existing surface (from `packages/cli/src/index.ts` + `bin.ts`)

```
aihu app <name>                   → scaffolds via scaffoldApp(name) hardcoded files (~30 lines emitted)
aihu page <route>                 → unrelated; keeps working
aihu component <name>             → unrelated; keeps working
aihu plugin <name>                → unrelated; keeps working

bunx create-aihu [<name>]         → interactive flow with template ∈ {minimal, full, docs}
```

The `AppTemplate = 'minimal' | 'full' | 'docs'` type in `index.ts` is the legacy template set. None of these match the new `@aihu/templates-<vendor>-<persona>` names.

### §7.2 The contract (locked: extend, do NOT deprecate-warn in v0.2.0)

**Hard contract (state-cli-templates §6 R-CT-06):** `aihu app foo` (no flags, no interaction) must produce identical files to today's output.

**Implementation:**
- `aihu app <name>` with no `--template` flag → calls existing `scaffoldApp(name)` from `index.ts`. Unchanged. (This is the legacy `'minimal'` AppTemplate behavior.)
- `aihu app <name> --template <T>` → routes to the new pipeline (§4) when `T` matches a `@aihu/templates-*` registry entry; else falls through to legacy behavior with `T` interpreted as `AppTemplate`.
- `bunx create-aihu` with no flags → enters new interactive flow (§3); the legacy `'minimal' | 'full' | 'docs'` selection is replaced by the new template list because `bunx create-aihu` was always meant to be the SOTA-compete flow (per `create.ts` header docstring "SOTA npx create pattern").

### §7.3 The CI snapshot test (locked)

`packages/cli/tests/legacy-snapshot.test.ts` (new). On every PR:
1. Runs `aihu app legacy-snapshot --pm bun` against a fresh tmp dir.
2. Diffs the emitted file tree against a checked-in golden at `packages/cli/tests/legacy-snapshot.golden/`.
3. Fails the build if any byte differs (intentional changes require updating the golden in the same PR).

Runnable verifier check:

```bash
mkdir -p /tmp/legacy-cmp && cd /tmp/legacy-cmp
bunx --bun "@aihu/cli@workspace:*" app legacy-snapshot --pm bun
diff -r legacy-snapshot/ "$REPO/packages/cli/tests/legacy-snapshot.golden/"
# exit 0 = byte-identical
```

### §7.4 Deprecation glide path (NOT in v0.2.0)

In v0.3.0:
- `aihu app <name>` (no flag) prints a one-line tip: "tip: pick a template with --template; defaults to minimal scaffold today."
- The legacy `AppTemplate = 'minimal' | 'full' | 'docs'` set is renamed `LegacyAppTemplate` in code, with comments pointing at the migration.

In v0.4.0 (or later, gated on usage signal):
- The bare `aihu app <name>` flow either picks `cf-solo` as default (preserving solo-dev affordance) OR errors with a helpful message listing `--template` options.

**For v0.2.0:** the legacy path stays bit-identical. No warnings, no nudges.

---

## §8 Acceptance criteria *(coordinator-released — covers the curated 5)*

Verifier consumes this section. Each criterion has a single Bash check that exits 0 on pass.

### §8.1 Per-template existence

```bash
for t in cf-team vercel-team fly-team cf-solo cf-full-agent; do
  test -d "packages/templates/$t/template" || exit 1
  test -f "packages/templates/$t/template.config.ts" || exit 1
  test -f "packages/templates/$t/package.json" || exit 1
  jq -e ".name == \"@aihu/templates-$t\"" "packages/templates/$t/package.json" > /dev/null || exit 1
done
```

### §8.2 Per-template smoke compile

For each `t in {cf-team, vercel-team, fly-team, cf-solo, cf-full-agent}`:

```bash
TMP=$(mktemp -d) && cd "$TMP"
bunx --bun "@aihu/cli@workspace:*" app "smoke-$t" \
  --template "$t" --no-interactive --use-defaults --no-git
cd "smoke-$t"
bun install --frozen-lockfile
bun run build      # exit 0
bun run typecheck  # exit 0
bun run test       # exit 0 (vitest exits 0 even with zero tests)
```

### §8.3 Q3 lock — `.mcp.json` exists in every default scaffold

Continuing from §8.2:
```bash
test -f .mcp.json || test -f apps/web/.mcp.json
# i.e. exists at root for solo, at apps/web for monorepo+moon templates
jq -e '.mcpServers.aihu.command == "aihu"' .mcp.json apps/web/.mcp.json 2>/dev/null
```

### §8.4 Q3 lock — at least one exposed `@state` entry per default scaffold

> v2 agent surface: the Q3 lock is satisfied by a per-name `expose:` on a
> `@state` collection entry (e.g. `live-counter.aihu`'s `count` prop or the
> `expose.aihu` stub's `appName`). The legacy `@agent { $expose }` macro is a
> C440 error and is no longer emitted by any template.

```bash
grep -rE 'expose:' src/ apps/web/src/ 2>/dev/null | head -1 | grep -q .
# exit 0 if at least one match; exit 1 if zero
```

### §8.5 Q3 opt-out — `agentSurface=none` removes both

```bash
TMP=$(mktemp -d) && cd "$TMP"
bunx --bun "@aihu/cli@workspace:*" app "smoke-noagent" \
  --template cf-team --no-interactive \
  --options-json <(echo '{"appName":"smoke-noagent","template":"cf-team","overrides":{"agentSurface":"none"}}')
cd smoke-noagent
test ! -f .mcp.json && test ! -f apps/web/.mcp.json  # neither location
! grep -rqE 'expose:' src/ apps/web/src/ 2>/dev/null   # no exposed @state entry anywhere (v2 agent surface)
bun install --frozen-lockfile && bun run build         # still compiles
```

### §8.6 RFC-#56-blocked auth: scaffold compiles, runtime errors clearly

For templates whose default auth is `better-auth` (not `@aihu/auth`), this is automatic — `better-auth` works today. The Q4-locked behavior only applies if a future v0.2.1 prompt offers `@aihu/auth` and the user picks it. For v0.2.0:

- All M1 templates default to `better-auth`. No template offers `@aihu/auth` as a v0.2.0 prompt option.
- Acceptance: `grep -r '@aihu/auth' packages/templates/*/template/` returns zero matches in v0.2.0.

If a future template version does offer `@aihu/auth`, the runtime stub MUST throw on import:

```ts
// packages/templates/<name>/template/src/auth/aihu-auth-stub.ts.tmpl (future)
throw new Error(
  '@aihu/auth is not yet ratified (RFC #56). ' +
  'See https://github.com/aihu-project/aihu/discussions/56 for status. ' +
  'Use the better-auth template instead.'
)
```

### §8.7 Monorepo + moon: `moon run :build` exits 0

For team templates (cf-team, vercel-team, fly-team, cf-full-agent):
```bash
cd "smoke-$t"
test -f moon.yml
moon run :build  # exit 0
```

### §8.8 Backward-compat snapshot

```bash
mkdir -p /tmp/legacy-cmp && cd /tmp/legacy-cmp
bunx --bun "@aihu/cli@workspace:*" app legacy-snapshot --pm bun
diff -r legacy-snapshot/ "$REPO/packages/cli/tests/legacy-snapshot.golden/"
# exit 0 = byte-identical to today's output
```

### §8.9 No new runtime deps in `@aihu/cli`

```bash
jq '.dependencies // {}' packages/cli/package.json
# expected output: {} (still zero runtime deps)
```

### §8.10 Vendor file discipline (templates own their full file set)

```bash
test -f packages/templates/cf-team/template/wrangler.toml.tmpl
test -f packages/templates/vercel-team/template/vercel.json.tmpl
test -f packages/templates/fly-team/template/Dockerfile.tmpl
test -f packages/templates/fly-team/template/fly.toml.tmpl
# Each vendor template owns its deployment manifest. None share via $VENDOR_CONFIG indirection.
```

### §8.11 IS-NOT-IN-V0.2.0 verifier (negative tests)

```bash
# No Tailwind anywhere in v0.2.0 templates
! grep -rq 'tailwindcss' packages/templates/*/template/

# No Drizzle/Prisma scaffold in v0.2.0
! grep -rq 'drizzle-orm\|prisma' packages/templates/*/template/

# No GitLab CI emitter
! find packages/templates -name '.gitlab-ci.yml*' | grep -q .

# No Playwright install
! grep -rq '@playwright/test' packages/templates/*/template/

# No A2A or ACP scaffold in non-full-agent templates
for t in cf-team vercel-team fly-team cf-solo; do
  ! grep -rq '@aihu/agent-a2a\|@aihu/agent-acp' "packages/templates/$t/template/"
done
```

---

## §9 Risks (extending state §6)

State §6 enumerates 8 risks (R-CT-01..08). Architecture-level additions:

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R-CT-09 | **`@aihu/adapter-fly` does not exist**. The fly-team template is specified as emitting `Dockerfile + fly.toml` directly. There's no Aihu package to depend on for Fly-specific runtime adapters. | HIGH | Builder Round B2 must surface to user: do we ship a new `@aihu/adapter-fly` package (dep on `@aihu/server` + Fly-specific Node-on-container shim)? OR does fly-team emit pure Dockerfile + Node entry that imports `@aihu/server` directly (no dedicated adapter)? Architect's recommendation is the second: Fly is container-shaped, no edge-runtime adapter is needed; the existing `@aihu/server` package is the runtime, the Dockerfile + fly.toml are deploy metadata only. This avoids publishing a stub package whose only job is "import @aihu/server and re-export". Surface to user before B2 starts (§13 Q1). |
| R-CT-10 | **Changesets coping with N parallel publish jobs** | LOW | Changesets v2.x handles 100+ packages cleanly (Storybook ships 70+). Our 5 + existing ~17 = 22 packages is well under stress. No mitigation needed beyond standard. |
| R-CT-11 | **Template drift from arch-3 plugin breaking changes**. When `@aihu/router` or `@aihu/runtime` ships a v2 in some future release, every template's emitted `package.json.tmpl` peer-dep range needs updating. | MEDIUM | CI gate: a new `scripts/check-template-deps.ts` walks every `template.config.ts.appPeerDeps` and asserts each version range is `>=` the workspace's `packages/<dep>/package.json` `version`. Runs in plan-a.yml. PRs that bump a workspace package's major version fail until templates' appPeerDeps are bumped in the same PR. (This is a Builder Round B3 task; for B1+B2 we ship templates pinned to the v1.0 line and accept manual drift.) |
| R-CT-12 | **Mustache-vs-string-replace bikeshed locking late**. If post-Verifier reviewers want to revisit §2.4, every template's source files need the new placeholder syntax. | LOW | Locked in §2.4 with defended rationale. Reviewers wanting to relitigate must produce a use case the file-inclusion-conditional layer (§4.2) can't already cover. |
| R-CT-13 | **`bun publish` of template packages with binary files**. If a template's `template/` directory contains binaries (favicons, sample images), `bun publish` may handle them differently from `npm publish`. | LOW | v0.2.0 templates contain only text files (no binaries). When v0.2.1+ adds favicons or sample images, write a packed-tarball assertion in `scripts/check-template-tarball.ts`. |
| R-CT-14 | **`peerDependencies["@aihu/cli"]` resolution at scaffold time**. If a user has an old `@aihu/cli` globally and runs `bunx create-aihu --template cf-team`, the template's contractVersion may exceed what the CLI knows. | MEDIUM | The CLI reads `template.config.ts.contractVersion` and `template.config.ts.cliRange` first; if mismatch, prints "Template requires @aihu/cli ^X; you have Y. Run `bunx --bun @aihu/cli@latest app ...` instead" and exits 1. Locked in §3.5. |
| R-CT-15 | **Better-auth specifically as the chosen default vs. Clerk/Lucia**. Better-auth is newer (early 2025); long-term adoption uncertain. | MEDIUM | Surface to user (§13 Q4) — if user prefers Lucia or Clerk, swap default in `template.config.ts.fixed.auth` for all 4 team templates. Whichever is picked, the others land in v0.2.1 as alternative templates. |

---

## §10 Implementation map (Builder rounds) *(coordinator-released — locked to curated 5)*

### Round B1 — pipeline foundation + cf-team end-to-end (✅ B1.1 done · 2026-05-05) (✅ B1.2 done · 2026-05-05; PR #83 patches + #84 Verifier; F-1 + F-6 closed in B1.2.1) (✅ B1.3 done · 2026-05-05; PR #86 + #87 Verifier PASS; final round, v0.2.0 milestone engineering-complete)

**Scope:** prove the pipeline against ONE template before fanning out.

Build:
- `packages/cli/src/template-manifest.ts` — `TemplateManifest` type + JSON Schema validator
- `packages/cli/src/scaffold-pipeline.ts` — 6 pure functions (§4.4)
- `packages/cli/src/conditional-eval.ts` — mini-evaluator for `when` expressions (§4.2)
- `packages/cli/src/templates-registry.ts` — KNOWN_TEMPLATES list
- `packages/cli/src/prompts.ts` — hand-rolled prompts library (§3.4)
- Extend `packages/cli/src/create.ts` with the new flow; preserve legacy fallback (§7.2)
- Extend `packages/cli/src/bin.ts` to dispatch `aihu app --template <T>` to the new flow
- `packages/templates/cf-team/` — full template package (manifest + template/ dir)
- `packages/cli/tests/scaffold-and-compile.test.ts` — Vitest harness for cf-team only
- `packages/cli/tests/legacy-snapshot.test.ts` + golden — backward-compat freeze (§7.3)
- Initial changeset entry for `@aihu/cli@0.2.0` and `@aihu/templates-cf-team@0.2.0`

Verifier acceptance: §8.1, §8.2 (cf-team only), §8.3, §8.4, §8.7 (cf-team), §8.8, §8.9, §8.10 (cf-team only).

**Round-B1 deliberate scope cut:** no other vendors. No solo template. No full-agent. The pipeline must work for one template before we stamp the other 4.

### Round B2 — broaden to all 5 templates

**Scope:** stamp the pipeline 4 more times.

Build:
- `packages/templates/vercel-team/` — Vercel adapter, vercel.json
- `packages/templates/fly-team/` — Dockerfile + fly.toml; resolve §13 Q1 (`@aihu/adapter-fly` or pure-server pattern) before this template's manifest finalizes
- `packages/templates/cf-solo/` — single-package, no auth, no commitlint
- `packages/templates/cf-full-agent/` — A2A + ACP scaffold (per arch-3 §2.5 + arch-4 §6); must include `<live-counter>` starter with both `@expose` and a `@agent` block with `$rate-limit`
- Extend the harness (§5) to `it.each` over all 5 templates × 2 cases each = 10 cases

Verifier acceptance: §8.2 (all templates), §8.5, §8.6, §8.7 (all team templates), §8.10 (all vendors), §8.11.

**Round-B2 surface-to-user-first checkpoints:**
- §13 Q1 (Fly adapter package or pure-server pattern) — block fly-team start until resolved
- §13 Q4 (auth default) — if user changes from `better-auth`, all 4 team templates' `fixed.auth` updates in this round

### Round B3 — backward-compat hardening + README autogen + edge cases

**Scope:** polish + the longest-tail items.

Build:
- README autogen integration (§6.3) — depends on PR #75 having landed; new `tier: 'template'` row in `PACKAGE_TIERS`
- `scripts/check-template-deps.ts` (R-CT-11 mitigation) — wired into plan-a.yml
- Windows-specific scaffold path tests (CRLF line endings in `.tmpl` files; backslash path separators)
- `--no-git` flag handling end-to-end (currently exists as design; needs tests across all templates)
- Post-install retry semantics (`bun install` failure modes — network blip, registry 503; surface clear error vs. silent stub)
- Deprecation messaging plan for v0.3 (write the spec for the warning, do NOT yet emit it — §7.4)

Verifier acceptance: §8 §all + edge-case suite.

**Estimated round counts (Architect's projection):** 3 Builder rounds + 2 Verifier rounds (one mid-track at end of B2, one final at end of B3). If §13 surface-to-user answers diverge from defaults, add 0.5 round between B1 and B2 for re-spec.

---

## §11 IS-NOT-IN-V0.2.0 (explicit out-of-scope list)

This list is verbatim-binding (state-cli-templates §7 (f) requires it appear in arch-6).

**v0.2.0 does NOT ship:**

1. **Tailwind 4 variant template** — defers to v0.2.1 per state §3 phasing. v0.2.0 templates use vanilla SFC `@style` block as their CSS solution.
2. **Drizzle / Prisma data scaffolds** — defers to v0.2.1+ per state §3. v0.2.0 templates use in-memory `$resource` with no backing store.
3. **`@aihu/auth` integration** — gated on RFC #56 RATIFY. v0.2.0 templates default to `better-auth` (third-party). `@aihu/auth` re-evaluates for v0.2.1.
4. **`@aihu/magna` (GraphQL bridge) integration in templates** — magna engine is a sibling repo (per `state-cli-templates` §2 D3); v0.2.0 templates don't wire it.
5. **GitLab CI YAML emitter** — defers to M3 per state §2 D6. v0.2.0 templates emit GitHub Actions only.
6. **Playwright E2E add-on** — defers to v0.2.1 per state §2 D10. v0.2.0 templates ship Vitest only.
7. **Full landing-page starter** — defers to M3 per state §2 D11. v0.2.0 starters are `<live-counter>` or empty.
8. **Post-scaffold codemods (`aihu add <plugin>`)** — drafted in arch-4 §3; orthogonal and explicitly deferred.
9. **`aihu generate component|page|agent|plugin|composable`** — drafted in arch-4 §3; orthogonal. The existing `aihu component`, `aihu page`, `aihu plugin` paths keep working unchanged.
10. **User-authored / community templates loaded by URL or git ref** — `--template <github-org/repo>` syntax defers to v0.3.
11. **Vercel-full-agent and Fly-full-agent template variants** — only `cf-full-agent` ships in M1 (§1.2 collapse #3).
12. **Vercel-solo and Fly-solo template variants** — only `cf-solo` ships in M1 (§1.2 collapse #2).
13. **Tailwind/Drizzle/Playwright "secondary templates"** — these merge into M2 at the option-override level, not as new template packages.
14. **`bunx @aihu/cli upgrade`** — codemod-driven post-scaffold upgrades. Defers to v0.3.
15. **Registry-search-at-runtime for templates** — locked v0.2.0 uses a baked KNOWN_TEMPLATES list (§3.5).
16. **Arbitrary expression evaluation in `template.config.ts.conditionalFiles[].when`** — locked v0.2.0 uses a strict subset (§4.2). Full JS expr defers indefinitely.

If the Builder discovers any of these is required to make v0.2.0 acceptance criteria green, surface to user immediately — do NOT silently expand scope.

---

## §12 Post-merge actions

When this spec PR lands:

1. **Topic Director re-fires (round 002)** — blesses the §1 curation cut, the §13 surface-to-user answers, and the Builder map in §10. State file updates in place to reflect "Architect spec landed, Builder Round B1 dispatched."
2. **Builder Round B1 dispatch** — branch `feat/cli-templates-builder-001`, scope per §10 B1, verifier acceptance per the §10 B1 line.
3. **Synthesizer (after B1 + Verifier)** — updates `state-cli-templates.md` to absorb concrete decisions: lock the placeholder syntax, lock the prompts library choice, register cf-team's published version. Adds a GBrain page under `aihu/delta/cli-templates/` with the post-B1 surface (tagged `topic:cli-templates`, `layer:delta`).
4. **Builder Round B2 + B3** dispatch sequentially per §10. Final Verifier round before publish-tag.
5. **Coordination with PR #75** — sync-readme.ts must land before B3's README autogen task starts. If #75 stalls, B3's autogen sub-task slides to v0.2.1; the templates ship with hand-written READMEs in v0.2.0.

---

## §13 Surface to user

Per "surface domain unknowns" universal principle, the following are **not** decisions I have grounds to take inline. They need user input before Builder Round B2 starts (B1 is fully unblocked):

### Q1 — Fly.io template — RESOLVED 2026-05-05

**User decision:** pure-server pattern (option b). No `@aihu/adapter-fly` package.

The fly-team template emits `Dockerfile` + `fly.toml` + a Node entry point importing `@aihu/server` directly. Template README explains the asymmetry vs CF/Vercel adapters in 2 sentences.

### Q2 — Prompts library — RESOLVED 2026-05-05

**User decision:** hand-roll. Architect rec accepted. Dep-free thesis preserved; ~150 LOC of `node:readline` + raw stdin escape codes lands in `@aihu/cli`.

### Q3 — Auth default for v0.2.0 team templates — RESOLVED 2026-05-05

**User decision:** offer **three** auth providers as runtime-prompt choices, with `better-auth` as the default. Kinde and Supabase Auth ship as alternatives in the same M1 release — no deferral to v0.2.1.

**Resolution:**
- The `auth` cell of `template.config.ts.fixed` for the 4 team templates (cf-team, vercel-team, fly-team, cf-full-agent) becomes a `template.config.ts.overrides.auth` entry with three choices:
  - `better-auth` *(default — type-first, edge-portable, open-source)*
  - `kinde` *(hosted, multi-tenant, B2B-friendly; great for org-scoped apps)*
  - `supabase` *(combines naturally with Supabase data + storage if user picks Supabase later in v0.2.1)*
- The scaffold-time prompt asks: *"Auth provider: [better-auth, kinde, supabase]"* with `better-auth` selected on Enter.
- Each chosen provider gets its own conditional file set in the template (auth client wiring, env-var template, sign-in/sign-out scaffold). Conditional inclusion uses the `template.config.ts` manifest mechanism per §4.3.
- `peerDependencies` becomes a per-provider map; only the chosen provider's deps install.
- The `cf-solo` template keeps `auth: 'none'` (no auth scaffold) — auth is a team-persona feature.
- `@aihu/auth` (RFC #56-blocked) remains a future option — added to the prompt list once RFC #56 ratifies, NOT in v0.2.0.

**B1 implication:** the cf-team template ships scaffolding for all 3 providers behind the conditional. Smoke-test matrix doubles for cf-team: 3 auth-provider × cf-team = 3 scaffold-and-build runs (still well within CI budget per §5.4).

Updates this propagates to elsewhere in the spec:
- §1.3 — `auth` column in the table moves from "fixed: third-party (default `better-auth`)" to "overrides: auth ∈ {better-auth, kinde, supabase}; default better-auth"
- §3 — adds the auth-provider prompt to the per-template override sequence
- §4.3 — auth-conditional files manifested per `auth=<name>` value
- §5.2 — cf-team smoke matrix adds auth-provider dimension
- §10 B1 — explicitly includes wiring all 3 auth providers for cf-team (otherwise B2 carries a bigger uncovered surface)

### Q4 — Naming convention — RESOLVED 2026-05-05

**User decision:** abbreviations (`cf/vercel/fly`). Architect rec accepted. The 5 template package names in §1.3 are locked.

---

*End of arch-6-cli-templates.md*
