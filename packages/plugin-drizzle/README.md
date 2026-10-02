# @aihu-plugin/drizzle

> **Aihu** — agentic discovery and interaction, for human purpose.

Drizzle ORM data adapter for aihu — typed createResource fetchers and defineLoader helpers (Postgres / SQLite / libSQL).

Part of the **meta-framework** layer of Aihu. Provides whole-app capability — file-based routing, SSR, loaders, cookies — without the boilerplate other meta-frameworks impose. See [arch-1](../../docs/roadmap/arch-1-website.md) for the meta-framework contract.

<!-- BEGIN_HANDWRITTEN: prose -->
Server-only. Wraps a Drizzle query into the two data-access shapes aihu uses:

```ts
import { drizzle } from 'drizzle-orm/libsql'
import { eq } from 'drizzle-orm'
import { createResource } from '@aihu-plugin/data'
import { defineRoute } from '@aihu/server'
import { createDrizzleResource, drizzleLoader } from '@aihu-plugin/drizzle'

const db = drizzle(client)

// 1. A createResource-compatible fetcher: (key: string) => Promise<T>
const fetchUser = createDrizzleResource(
  db,
  (db, id: number) => db.select().from(users).where(eq(users.id, id)),
  { parseKey: Number },
)
const user = createResource(idSignal, fetchUser)

// 2. A defineLoader for SSR routes
const userLoader = drizzleLoader(db, (db, ctx) =>
  db.select().from(users).where(eq(users.id, Number(ctx.params.id))),
)
export const userRoute = defineRoute('/users/:id', handler, { loader: userLoader })
```

`drizzle-orm` and its drivers (`postgres`, `@libsql/client`) are **optional peer dependencies** referenced via `import type` only — importing this package never breaks when no Drizzle peer is installed. You supply the `db` handle; the adapter only awaits the query.
<!-- END_HANDWRITTEN: prose -->

## Install

<!-- BEGIN_AUTOGEN: install -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

```bash
npm install @aihu-plugin/drizzle
# or
bun add @aihu-plugin/drizzle
```

<sub><i>Auto-generated against `@aihu-plugin/drizzle@0.1.8`.</i></sub>

<!-- END_AUTOGEN: install -->

## Package facts

<!-- BEGIN_AUTOGEN: stats -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| | |
|---|---|
| **Version** | `0.1.8` |
| **Tier** | B — Meta-framework — Drizzle ORM data adapter (typed resources + loaders) |
| **Published files** | 3 entries |
| **License** | MIT |

<sub><i>Auto-generated against `@aihu-plugin/drizzle@0.1.8`.</i></sub>

<!-- END_AUTOGEN: stats -->

## Exports

<!-- BEGIN_AUTOGEN: exports -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| Subpath | ESM | CJS |
|---|---|---|
| `.` | `./dist/index.js` | `—` |

<sub><i>Auto-generated against `@aihu-plugin/drizzle@0.1.8`.</i></sub>

<!-- END_AUTOGEN: exports -->

## Dependencies

<!-- BEGIN_AUTOGEN: deps -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

**Dependencies:**

- `@aihu/server` — `workspace:*`

**Peer dependencies:**

- `drizzle-orm` — `>=0.29.0`

<sub><i>Auto-generated against `@aihu-plugin/drizzle@0.1.8`.</i></sub>

<!-- END_AUTOGEN: deps -->

## See also

<!-- BEGIN_AUTOGEN: see-also -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

- [@aihu-plugin/data](../plugin-data)
- [Aihu framework root](../../README.md)

<sub><i>Auto-generated against `@aihu-plugin/drizzle@0.1.8`.</i></sub>

<!-- END_AUTOGEN: see-also -->

## License

<!-- BEGIN_AUTOGEN: license -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

MIT — see [LICENSE](../../LICENSE).

<sub><i>Auto-generated against `@aihu-plugin/drizzle@0.1.8`.</i></sub>

<!-- END_AUTOGEN: license -->
