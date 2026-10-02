# @aihu/templates-cf-solo

> **Aihu** — agentic discovery and interaction, for human purpose.

Cloudflare Workers single-package solo template for Aihu

Held-private workspace package. Not yet published to npm.

> **Status:** Held private — not yet published to npm, and not yet wired into
> `.github/workflows/scaffold-matrix.yml`'s real npm-registry matrix (that is
> a `.github/` edit outside this change's scope — see arch-6 §10 Round B2).

<!-- BEGIN_HANDWRITTEN: prose -->
Cloudflare Workers single-package solo template for Aihu — the solo-dev
escape hatch from arch-6 §1.3's curated 5.

This package is consumed by `@aihu/cli` at scaffold time. End users do not
install it directly — they run:

```bash
bunx create-aihu my-app --template cf-solo
```

## What this template ships

Fixed cells (not user-overridable):

- **Vendor** — Cloudflare Workers (`@aihu/adapter-cloudflare`)
- **Persona** — solo
- **Repo shape** — single package (no monorepo, no `moon`)
- **Auth** — none (auth is a team-persona feature, per §13 Q3)
- **Lint** — Biome
- **CI** — GitHub Actions (no commitlint)
- **Test** — Vitest

Overridable cells (prompted at scaffold time):

- **`starter`** — `live-counter` (default) | `empty`
- **`agentSurface`** — `minimal` (default; emits `.mcp.json` + an exposed `@state` entry) | `none`
- **`css`** — `style-block`
- **`initGit`** — `true` (default) | `false`

The full manifest lives in [`./template.config.ts`](./template.config.ts);
the source tree the CLI copies + substitutes into the user's project lives
under [`./template/`](./template/).

## Design notes

- Per arch-6 §1.2 collapse #2, Cloudflare is the only vendor with a solo
  escape-hatch template — the one vendor where the solo path is
  unambiguously "edge function with zero ops surface."
- Per §2.5, the template emits the same locked `.mcp.json` content every
  other M1 template does, unless `agentSurface === 'none'`.
- Stamped out from the same pipeline shape as `@aihu/templates-cf-team`
  (§10 Round B2) — same `template.config.ts` contract, flattened file tree
  (no `apps/web` nesting, no `packages/shared`, no auth provider files).

## See also

- [`@aihu/cli`](../../cli) — the scaffolder that consumes this package
- [`@aihu/templates-cf-team`](../cf-team) — the team-persona sibling this
  package mirrors the pipeline shape of
- [`docs/roadmap/arch-6-cli-templates.md`](../../../docs/roadmap/arch-6-cli-templates.md) — the architecture spec
<!-- END_HANDWRITTEN: prose -->

## Install

<!-- BEGIN_AUTOGEN: install -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

```bash
npm install @aihu/templates-cf-solo
# or
bun add @aihu/templates-cf-solo
```

<sub><i>Auto-generated against `@aihu/templates-cf-solo@0.2.0`.</i></sub>

<!-- END_AUTOGEN: install -->

## Package facts

<!-- BEGIN_AUTOGEN: stats -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| | |
|---|---|
| **Version** | `0.2.0` |
| **Tier** | E — Starter — Cloudflare Workers single-package solo template |
| **Published files** | 5 entries |
| **License** | MIT |

<sub><i>Auto-generated against `@aihu/templates-cf-solo@0.2.0`.</i></sub>

<!-- END_AUTOGEN: stats -->

## Exports

<!-- BEGIN_AUTOGEN: exports -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

_No `exports` field in `package.json`. Main entry: `./template.config.js`._

<sub><i>Auto-generated against `@aihu/templates-cf-solo@0.2.0`.</i></sub>

<!-- END_AUTOGEN: exports -->

## Dependencies

<!-- BEGIN_AUTOGEN: deps -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

_Zero runtime dependencies_ (per the [dep-free thesis](../../README.md#project-posture))_._

<sub><i>Auto-generated against `@aihu/templates-cf-solo@0.2.0`.</i></sub>

<!-- END_AUTOGEN: deps -->

## See also

<!-- BEGIN_AUTOGEN: see-also -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

- [@aihu/adapter-cloudflare](../adapter-cloudflare)
- [@aihu/cli](../cli)
- [Aihu framework root](../../../README.md)

<sub><i>Auto-generated against `@aihu/templates-cf-solo@0.2.0`.</i></sub>

<!-- END_AUTOGEN: see-also -->

## License

<!-- BEGIN_AUTOGEN: license -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

MIT — see [LICENSE](../../../LICENSE).

<sub><i>Auto-generated against `@aihu/templates-cf-solo@0.2.0`.</i></sub>

<!-- END_AUTOGEN: license -->
