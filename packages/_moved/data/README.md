# @aihu/data

> **Aihu** — agentic discovery and interaction, for human purpose.

[MOVED] This package has moved to @aihu-plugin/data.

Held-private workspace package. Not yet published to npm.

> **Status:** Held private — not yet published to npm. See [v1.1 roadmap](../../../docs/roadmap/SUMMARY.md) for ratification gating (e.g. RFC #56 live-binding for `@aihu/plugin` enforcement).

<!-- BEGIN_HANDWRITTEN: prose -->
## `@aihu/data` — MOVED to `@aihu-plugin/data`

This package has moved to **`@aihu-plugin/data`** as part of the v1.0.9
Naming Scheme A cutover, which groups plugin-contract packages under the
`@aihu-plugin/*` npm scope while keeping framework-core packages under
`@aihu/*`.

### Install the new package

```sh
npm install @aihu-plugin/data
# or
bun add @aihu-plugin/data
```

The package's public API is unchanged — only the npm name has changed.

### Automatic migration

The aihu CLI's `migrate` command (v1.0.9+) updates package.json
`dependencies` blocks, `import` statements, dynamic `import()` calls, and
JSDoc URL references automatically:

```sh
bunx aihu migrate
```

### Why the rename?

Decision record `6c7aa75b-...` and v1.0.9 plan §400-416 cover the rationale:
`@aihu-plugin/*` scopes the plugin-contract surface, so framework-core and
plugin-contract packages can evolve at independent cadences.

This stub package re-exports `@aihu-plugin/data` so existing installs keep
working until consumers migrate.
<!-- END_HANDWRITTEN: prose -->

## Install

<!-- BEGIN_AUTOGEN: install -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

```bash
npm install @aihu/data
# or
bun add @aihu/data
```

<sub><i>Auto-generated against `@aihu/data@2.0.5`.</i></sub>

<!-- END_AUTOGEN: install -->

## Package facts

<!-- BEGIN_AUTOGEN: stats -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| | |
|---|---|
| **Version** | `2.0.5` |
| **Tier** | E — Held private (unmapped tier) |
| **Published files** | 4 entries |
| **License** | MIT |

<sub><i>Auto-generated against `@aihu/data@2.0.5`.</i></sub>

<!-- END_AUTOGEN: stats -->

## Exports

<!-- BEGIN_AUTOGEN: exports -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| Subpath | ESM | CJS |
|---|---|---|
| `.` | `./index.js` | `—` |

<sub><i>Auto-generated against `@aihu/data@2.0.5`.</i></sub>

<!-- END_AUTOGEN: exports -->

## Dependencies

<!-- BEGIN_AUTOGEN: deps -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

**Dependencies:**

- `@aihu-plugin/data` — `workspace:*`

<sub><i>Auto-generated against `@aihu/data@2.0.5`.</i></sub>

<!-- END_AUTOGEN: deps -->

## See also

<!-- BEGIN_AUTOGEN: see-also -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

- [Aihu framework root](../../../README.md)
- [v1.1 roadmap](../../../docs/roadmap/SUMMARY.md)

<sub><i>Auto-generated against `@aihu/data@2.0.5`.</i></sub>

<!-- END_AUTOGEN: see-also -->

## License

<!-- BEGIN_AUTOGEN: license -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

MIT — see [LICENSE](../../../LICENSE).

<sub><i>Auto-generated against `@aihu/data@2.0.5`.</i></sub>

<!-- END_AUTOGEN: license -->
