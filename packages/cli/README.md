# @aihu/cli

> **Aihu** — agentic discovery and interaction, for human purpose.

Aihu CLI (`aihu`, `create-aihu`) — scaffolding, dev, build commands.

Part of the **compiler + toolchain** layer of Aihu. Build-time only — does not ship to the client. The compiler reads `.aihu` SFC source (per the [Block Structure spec](../../docs/superpowers/specs/2026-05-02-spec-block-structure.md)) and emits standards-compliant Web Components.

<!-- BEGIN_HANDWRITTEN: prose -->
The `aihu` CLI is the entry point to an Aihu project. It scaffolds new apps,
pages, components, and plugins, then runs the dev and build cycle — all from a
single binary with zero external npm dependencies (Node/Bun builtins only).

```bash
# Scaffold a new app
bunx @aihu/cli app my-app
cd my-app

# Inside the project
aihu page about         # add a page
aihu component Button   # add a component
aihu dev                # start the dev server
aihu build              # build for production
```

The CLI also ships `aihu migrate`, the mechanical codemod that rewrites legacy
v0.1.x `.aihu` source to the v1.0 canonical grammar (HTML-tag framing →
`@block {}`, Vue-shape and plain-curly attributes → `$`-prefixed bindings, and
the `@aihu/data` / `@aihu/agent-readiness` → `@aihu-plugin/*` renames). See
[docs/cli.md](../../docs/cli.md) for the full command reference.
<!-- END_HANDWRITTEN: prose -->

## Install

<!-- BEGIN_AUTOGEN: install -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

```bash
# Scaffold a new app
bunx @aihu/cli app my-app
# Or install globally
bun add -g @aihu/cli
```

<sub><i>Auto-generated against `@aihu/cli@1.3.0`.</i></sub>

<!-- END_AUTOGEN: install -->

## Package facts

<!-- BEGIN_AUTOGEN: stats -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| | |
|---|---|
| **Version** | `1.3.0` |
| **Tier** | D — Toolchain — `aihu` / `create-aihu` CLI |
| **Published files** | 3 entries |
| **License** | MIT |

<sub><i>Auto-generated against `@aihu/cli@1.3.0`.</i></sub>

<!-- END_AUTOGEN: stats -->

## Exports

<!-- BEGIN_AUTOGEN: exports -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| Subpath | ESM | CJS |
|---|---|---|
| `.` | `./dist/index.js` | `—` |
| `./template-manifest` | `./dist/template-manifest.js` | `—` |

<sub><i>Auto-generated against `@aihu/cli@1.3.0`.</i></sub>

<!-- END_AUTOGEN: exports -->

## Dependencies

<!-- BEGIN_AUTOGEN: deps -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

**Dependencies:**

- `@aihu/mcp` — `workspace:*`

<sub><i>Auto-generated against `@aihu/cli@1.3.0`.</i></sub>

<!-- END_AUTOGEN: deps -->

## See also

<!-- BEGIN_AUTOGEN: see-also -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

- [docs/cli.md](../../docs/cli.md)
- [@aihu/compiler](https://github.com/aihu-project/aihu-compiler)
- [Aihu framework root](../../README.md)

<sub><i>Auto-generated against `@aihu/cli@1.3.0`.</i></sub>

<!-- END_AUTOGEN: see-also -->

## License

<!-- BEGIN_AUTOGEN: license -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

MIT — see [LICENSE](../../LICENSE).

<sub><i>Auto-generated against `@aihu/cli@1.3.0`.</i></sub>

<!-- END_AUTOGEN: license -->
