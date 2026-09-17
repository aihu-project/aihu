# create-aihu

> **Aihu** — agentic discovery and interaction, for human purpose.

Scaffold a new Aihu app — the `npm create aihu` / `npx create-aihu` entry point. Thin delegator to @aihu/cli.

Part of the **compiler + toolchain** layer of Aihu. Build-time only — does not ship to the client. The compiler reads `.aihu` SFC source (per the [Block Structure spec](../../docs/superpowers/specs/2026-05-02-spec-block-structure.md)) and emits standards-compliant Web Components.

<!-- BEGIN_HANDWRITTEN: prose -->
This is the public scaffolder entry point for Aihu. Running `npm create aihu`,
`npx create-aihu`, or `bun create aihu` resolves this UNSCOPED package, which is
a thin delegator: it forwards your arguments to [`@aihu/cli`](../cli)'s
scaffolder (the same logic exposed as the `create-aihu` bin of `@aihu/cli`),
inheriting stdio so both the interactive prompts and the non-interactive
(`--yes` / non-TTY) path work, then propagates the exit code.

```bash
npm create aihu@latest my-app
cd my-app
```

All scaffolding flags (`--yes`, `--template`, `--pm`, `--no-git`, …) are passed
straight through to `@aihu/cli`. See [`docs/cli.md`](../../docs/cli.md) for the
full option list.
<!-- END_HANDWRITTEN: prose -->

## Install

<!-- BEGIN_AUTOGEN: install -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

```bash
# Scaffold a new Aihu app (no install needed)
npm create aihu@latest my-app
# or
npx create-aihu my-app
# or
bun create aihu my-app
```

<sub><i>Auto-generated against `create-aihu@0.1.12`.</i></sub>

<!-- END_AUTOGEN: install -->

## Package facts

<!-- BEGIN_AUTOGEN: stats -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| | |
|---|---|
| **Version** | `0.1.12` |
| **Tier** | D — Toolchain — `npm create aihu` scaffolder entry point |
| **Published files** | 3 entries |
| **License** | MIT |

<sub><i>Auto-generated against `create-aihu@0.1.12`.</i></sub>

<!-- END_AUTOGEN: stats -->

## Exports

<!-- BEGIN_AUTOGEN: exports -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

_No `exports` field in `package.json`. Main entry: `unset`._

<sub><i>Auto-generated against `create-aihu@0.1.12`.</i></sub>

<!-- END_AUTOGEN: exports -->

## Dependencies

<!-- BEGIN_AUTOGEN: deps -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

**Dependencies:**

- `@aihu/cli` — `workspace:*`

<sub><i>Auto-generated against `create-aihu@0.1.12`.</i></sub>

<!-- END_AUTOGEN: deps -->

## See also

<!-- BEGIN_AUTOGEN: see-also -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

- [@aihu/cli](../cli)
- [docs/cli.md](../../docs/cli.md)
- [Aihu framework root](../../README.md)

<sub><i>Auto-generated against `create-aihu@0.1.12`.</i></sub>

<!-- END_AUTOGEN: see-also -->

## License

<!-- BEGIN_AUTOGEN: license -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

MIT — see [LICENSE](../../LICENSE).

<sub><i>Auto-generated against `create-aihu@0.1.12`.</i></sub>

<!-- END_AUTOGEN: license -->
