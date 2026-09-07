# @aihu/server

> **Aihu** — agentic discovery and interaction, for human purpose.

Server runtime + native renderer (napi-rs) for aihu SSR.

Part of the **meta-framework** layer of Aihu. Provides whole-app capability — file-based routing, SSR, loaders, cookies — without the boilerplate other meta-frameworks impose. See [arch-1](../../docs/roadmap/arch-1-website.md) for the meta-framework contract.

<!-- BEGIN_HANDWRITTEN: prose -->
_(Hand-written prose lives in this block. Replace this placeholder; everything below is auto-generated.)_
<!-- END_HANDWRITTEN: prose -->

## Install

<!-- BEGIN_AUTOGEN: install -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

```bash
npm install @aihu/server
# or
bun add @aihu/server
```

<sub><i>Auto-generated against `@aihu/server@0.6.0`.</i></sub>

<!-- END_AUTOGEN: install -->

## Package facts

<!-- BEGIN_AUTOGEN: stats -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| | |
|---|---|
| **Version** | `0.6.0` |
| **Tier** | B — Meta-framework — SSR + native renderer (napi-rs) |
| **Published files** | 3 entries |
| **License** | MIT |

<sub><i>Auto-generated against `@aihu/server@0.6.0`.</i></sub>

<!-- END_AUTOGEN: stats -->

## Exports

<!-- BEGIN_AUTOGEN: exports -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| Subpath | ESM | CJS |
|---|---|---|
| `.` | `./dist/index.js` | `—` |
| `./native` | `./dist/native.js` | `—` |
| `./head-lowering` | `./dist/head-lowering.js` | `—` |

<sub><i>Auto-generated against `@aihu/server@0.6.0`.</i></sub>

<!-- END_AUTOGEN: exports -->

## Dependencies

<!-- BEGIN_AUTOGEN: deps -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

**Dependencies:**

- `@aihu/agent` — `workspace:*`
- `@aihu/agent-service` — `workspace:*`
- `@aihu/plugin` — `workspace:*`
- `@aihu/signals` — `^0.5.1`

**Optional dependencies (platform-specific):**

- `@aihu/server-darwin-arm64` — `0.1.2`
- `@aihu/server-darwin-x64` — `0.1.2`
- `@aihu/server-linux-x64-gnu` — `0.1.2`
- `@aihu/server-win32-x64-msvc` — `0.1.2`

<sub><i>Auto-generated against `@aihu/server@0.6.0`.</i></sub>

<!-- END_AUTOGEN: deps -->

## See also

<!-- BEGIN_AUTOGEN: see-also -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

- [arch-1 (website)](../../docs/roadmap/arch-1-website.md)
- [SSR & hydration guide](https://aihu.dev/guides/ssr-hydration)
- [@aihu/router](../router)
- [@aihu-plugin/agent-readiness](../plugin-agent-readiness)
- [Aihu framework root](../../README.md)

<sub><i>Auto-generated against `@aihu/server@0.6.0`.</i></sub>

<!-- END_AUTOGEN: see-also -->

## License

<!-- BEGIN_AUTOGEN: license -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

MIT — see [LICENSE](../../LICENSE).

<sub><i>Auto-generated against `@aihu/server@0.6.0`.</i></sub>

<!-- END_AUTOGEN: license -->
