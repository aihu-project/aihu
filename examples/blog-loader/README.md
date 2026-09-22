# `examples/blog-loader`

A server-rendered post page demonstrating aihu's loader pattern, `@aihu/context`
as a parallel data channel, and an `@agent` block for agentic discoverability.

## What this teaches

- **`defineLoader`** — declare a per-route async data fetcher in a sibling
  `.loader.ts` file (`src/pages/posts/[slug].loader.ts`).
- **Server → SFC handoff** — the loader's return value is delivered to the
  SFC via the `route.data` prop. See the "Server loaders → SFC handoff"
  section of [the Data Fetching guide](../../apps/docs/src/data/guide-data-fetching.ts).
- **`<suspense>`** — the suspense boundary holds the fallback while the
  payload is in-flight (relevant during streaming SSR / client-side
  re-validation).
- **3-state resource pattern** — `route.data` follows the same
  `pending` / `value` / `error` shape as a `$resource` declaration.
- **`@aihu/context`** — demonstrates `@aihu/context` as a _parallel data channel_
  alongside `route.data`. The loader provides a `ReadingContext` value
  server-side (via `@aihu/context/ssr` `runWithContext` + `provide`); the SFC
  injects it client-side (via `inject` from `@aihu/context`) and renders a
  `context-badge` element — visually distinct from the `route.data` display.
- **`@agent` block** — exposes `getPost` (current post title/body/readingTimeMs)
  and `listPosts` (known post slugs) so any MCP-compatible agent can read and
  enumerate content without scraping the rendered HTML.

## Run

```bash
bun install
bun run dev
```

Then navigate to `/posts/hello`, `/posts/meta`, or `/posts/agents`.

## Files

| File | Role |
|---|---|
| `src/pages/posts/[slug].aihu` | SFC reading `route.data`, injecting `ReadingContext`, `@agent` block |
| `src/pages/posts/[slug].loader.ts` | Server-side `defineLoader` + `ReadingContext` provision via `@aihu/context/ssr` |
| `vite.config.ts` | Wires `viteRouterIntegration()` + SSR target |
| `tests/smoke.test.ts` | Source-text + registry smoke tests (8 tests, offline-safe) |

## How the handoff works

```
        ┌──────────────────────────────────┐
Request │  GET /posts/hello                │
        └────────────────┬─────────────────┘
                         │
                         ▼
        ┌──────────────────────────────────┐
        │ [slug].loader.ts → defineLoader  │   server-side
        │   ctx.params.slug = 'hello'      │
        │   returns { title, body, ... }   │
        └────────────────┬─────────────────┘
                         │
                         ▼
        ┌──────────────────────────────────┐
        │ [slug].aihu → @template        │   server + client
        │   $prop route: { data: T }       │
        │   <h1>{route.data.title}</h1>    │
        └──────────────────────────────────┘
```

## Compare with

- [Remix loader docs](https://remix.run/docs/en/main/route/loader)
- [SvelteKit `+page.server.ts` load function](https://kit.svelte.dev/docs/load)
