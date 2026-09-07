# @aihu/magna

> **Aihu** — agentic discovery and interaction, for human purpose.

aihu bridge for Magna GraphQL — dep-free fetch, resource composition, JWT relay

Held-private workspace package. Not yet published to npm.

> **Status:** Held private — not yet published to npm. See [v1.1 roadmap](../../docs/roadmap/SUMMARY.md) for ratification gating (e.g. RFC #56 live-binding for `@aihu/plugin` enforcement).

<!-- BEGIN_HANDWRITTEN: prose -->
Magna's optional build-time GraphQL parser is loaded dynamically and
gracefully skipped when absent. Install it explicitly when it becomes available:

```bash
bun add @aihu/magna-gqlmin
```

Full documentation: see `apps/docs/src/content/docs/packages/magna.md` (filed as A1 issue).
<!-- END_HANDWRITTEN: prose -->

## Install

<!-- BEGIN_AUTOGEN: install -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

```bash
npm install @aihu/magna
# or
bun add @aihu/magna
```

<sub><i>Auto-generated against `@aihu/magna@0.2.7`.</i></sub>

<!-- END_AUTOGEN: install -->

## Package facts

<!-- BEGIN_AUTOGEN: stats -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| | |
|---|---|
| **Version** | `0.2.7` |
| **Tier** | B — Meta-framework — dep-free Magna GraphQL bridge (resources + JWT relay) |
| **Bundle size** | 758 B (gz) — limit 1.8 KB |
| **Published files** | 2 entries |
| **License** | MIT |

<sub><i>Auto-generated against `@aihu/magna@0.2.7`.</i></sub>

<!-- END_AUTOGEN: stats -->

## Exports

<!-- BEGIN_AUTOGEN: exports -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| Subpath | ESM | CJS |
|---|---|---|
| `.` | `./dist/index.js` | `—` |
| `./codegen` | `./dist/codegen.js` | `—` |

<sub><i>Auto-generated against `@aihu/magna@0.2.7`.</i></sub>

<!-- END_AUTOGEN: exports -->

## Dependencies

<!-- BEGIN_AUTOGEN: deps -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

**Dependencies:**

- `@aihu/signals` — `^0.5.1`
- `@aihu/plugin` — `workspace:*`
- `@aihu/context` — `workspace:*`
- `@aihu-plugin/data` — `workspace:*`

<sub><i>Auto-generated against `@aihu/magna@0.2.7`.</i></sub>

<!-- END_AUTOGEN: deps -->

## See also

<!-- BEGIN_AUTOGEN: see-also -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

- [@aihu-plugin/data](../plugin-data)
- [@aihu/server](../server)
- [Aihu framework root](../../README.md)

<sub><i>Auto-generated against `@aihu/magna@0.2.7`.</i></sub>

<!-- END_AUTOGEN: see-also -->

## License

<!-- BEGIN_AUTOGEN: license -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

MIT — see [LICENSE](../../LICENSE).

<sub><i>Auto-generated against `@aihu/magna@0.2.7`.</i></sub>

<!-- END_AUTOGEN: license -->
