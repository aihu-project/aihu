# @aihu/seo

> **Aihu** — agentic discovery and interaction, for human purpose.

aihu SEO plugin: sitemap.xml, robots.txt, llms.txt, JSON-LD injection via afterParse hook.

Held-private workspace package. Not yet published to npm.

> **Status:** Held private — not yet published to npm. See [v1.1 roadmap](../../docs/roadmap/SUMMARY.md) for ratification gating (e.g. RFC #56 live-binding for `@aihu/plugin` enforcement).

<!-- BEGIN_HANDWRITTEN: prose -->
> **Deprecated (v1.0.0, #430).** `@aihu/seo` is now a thin compatibility shim over
> `@aihu-plugin/agent-readiness` — use that package directly. The shim preserves this
> package's historical robots.txt default (absent `disallowAiBots` still blocks all AI
> bots, with a deprecation warning); the new tiered `aiAgents: 'allow-agents'` default
> lives in the new package. The sitemap now XML-escapes URLs via the shared generator.

aihu SEO plugin: sitemap.xml, robots.txt, llms.txt, JSON-LD.

```bash
bun add @aihu/seo
```

Full documentation: see `apps/docs/src/content/docs/packages/seo.md` (filed as A1 issue).
<!-- END_HANDWRITTEN: prose -->

## Install

<!-- BEGIN_AUTOGEN: install -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

```bash
npm install @aihu/seo
# or
bun add @aihu/seo
```

<sub><i>Auto-generated against `@aihu/seo@1.0.7`.</i></sub>

<!-- END_AUTOGEN: install -->

## Package facts

<!-- BEGIN_AUTOGEN: stats -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| | |
|---|---|
| **Version** | `1.0.7` |
| **Tier** | C — Agent surface — DEPRECATED shim over @aihu-plugin/agent-readiness |
| **Published files** | 4 entries |
| **License** | MIT |

<sub><i>Auto-generated against `@aihu/seo@1.0.7`.</i></sub>

<!-- END_AUTOGEN: stats -->

## Exports

<!-- BEGIN_AUTOGEN: exports -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| Subpath | ESM | CJS |
|---|---|---|
| `.` | `./dist/index.js` | `—` |

<sub><i>Auto-generated against `@aihu/seo@1.0.7`.</i></sub>

<!-- END_AUTOGEN: exports -->

## Dependencies

<!-- BEGIN_AUTOGEN: deps -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

**Dependencies:**

- `@aihu/plugin` — `workspace:*`
- `@aihu/server` — `workspace:*`
- `@aihu-plugin/agent-readiness` — `workspace:*`

<sub><i>Auto-generated against `@aihu/seo@1.0.7`.</i></sub>

<!-- END_AUTOGEN: deps -->

## See also

<!-- BEGIN_AUTOGEN: see-also -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

- [@aihu-plugin/agent-readiness](../plugin-agent-readiness)
- [Aihu framework root](../../README.md)

<sub><i>Auto-generated against `@aihu/seo@1.0.7`.</i></sub>

<!-- END_AUTOGEN: see-also -->

## License

<!-- BEGIN_AUTOGEN: license -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

MIT — see [LICENSE](../../LICENSE).

<sub><i>Auto-generated against `@aihu/seo@1.0.7`.</i></sub>

<!-- END_AUTOGEN: license -->
