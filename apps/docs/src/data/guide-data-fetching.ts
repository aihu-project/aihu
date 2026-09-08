/**
 * Data Fetching guide body. Adapted from the real
 * apps/docs/src/content/docs/guides/data-fetching.md, which is written
 * almost entirely against the retired `@state` v2 collection-form macro
 * dialect (`$prop: {...}`, `$resource: {...}`) — rewritten below to the
 * current wrapper intrinsics (`prop()`, `resource()`), matching
 * apps/docs/src/data/guide-authoring-components.ts. Two substantive
 * corrections beyond the dialect rewrite, both confirmed against source:
 *
 * 1. The `resource()` 3-state shape. The old doc (and, it turns out,
 *    guide-authoring-components.ts's own resource() section) describes
 *    `{ pending, value, error }`. The actual sidecar type and runtime
 *    (the standalone compiler sidecar emitter, packages/runtime/src/
 *    resource.ts) are `{ loading, data, error, refetch() }`. Documented
 *    correctly here; the authoring-components mismatch is a pre-existing
 *    issue in already-shipped content, out of scope for this port.
 * 2. Server loaders → SFC handoff. The old doc claims `route.data` is
 *    populated for ANY `defineLoader`. Per packages/router/src/server.ts,
 *    `route.data` is only threaded into the component for a GOVERNED route
 *    (one that declares `data: { type, preview }` in `@route` — aihu's
 *    entitlement-gated data system). A plain `defineLoader` with no `data:`
 *    declaration still runs, but the component receives no props from it —
 *    the result is only embedded as an inline `<script id="__aihu_loader__">`
 *    JSON blob, with no built-in client-side reader today. Rewritten below
 *    to describe both paths accurately instead of collapsing them into one.
 *
 * Also corrected: `defineStreamRoute`'s real signature is
 * `(req: Request) => Promise<ReadableStream<string>>` (return a stream, no
 * `ctx`/`stream.write` callback form), and the response-helper signatures
 * (`notFound()` takes no message, `methodNotAllowed(allowed)` takes the
 * allowed-methods array, not a message) — per packages/server/src/api.ts and
 * stream-route.ts. `$server`/`createServerCall` retirement claim double
 * checked (zero hits repo-wide) and still true. Fenced code uses the ~~~
 * delimiter and inline code uses <code> tags so the source carries no
 * backticks.
 */
export const DATA_FETCHING = `# Data Fetching

aihu provides several primitives for fetching data, ranging from reactive resource signals declared in <code>@state</code>, to a standalone resource utility for use outside SFCs, to server-side loaders for SSR routes.

## <code>resource()</code> in <code>@state</code>

<code>resource()</code> is one of the <code>@state</code> wrapper intrinsics (alongside <code>state()</code>, <code>prop()</code>, <code>derived()</code>, <code>action()</code>) — it binds an async fetcher to a reactive signal. Bare (no metadata) or wrapped (config object first):

~~~aihu
@state {
  let userId = prop<number>({ default: 1 })

  // bare — just the fetcher thunk
  const user = resource(() => fetchUser(userId))

  // wrapped — add describe/expose to surface to agents
  const recentPosts = resource(
    { describe: 'Posts by the current user', expose: 'read' },
    () => fetchPosts(userId),
  )
}

@template {
  <suspense fallback="Spinner">
    <div>{user.data?.name}</div>
  </suspense>
}
~~~

The resource variable is a 4-field loader object:

- <code>resource.loading</code> — <code>true</code> while the fetch is in-flight.
- <code>resource.data</code> — the resolved value (or <code>null</code> if loading/error).
- <code>resource.error</code> — the error (or <code>null</code> if loading/success).
- <code>resource.refetch()</code> — re-runs the fetcher on demand.

When any signal read inside the fetcher changes (e.g. <code>userId</code>), the resource re-fetches automatically.

### The loader-state pattern

All <code>resource()</code> data in aihu follows the same 4-field shape:

| State | <code>loading</code> | <code>data</code> | <code>error</code> |
|-------|-----------|---------|---------|
| Loading | <code>true</code> | <code>null</code> | <code>null</code> |
| Success | <code>false</code> | data | <code>null</code> |
| Error | <code>false</code> | <code>null</code> | Error |

<code>&lt;suspense fallback="..."&gt;</code> wraps a resource consumer to declare a loading fallback in the template:

~~~aihu
<suspense fallback="Spinner">
  <div>{user.data?.name}</div>
</suspense>
~~~

> **Current limitation.** <code>&lt;suspense&gt;</code> parses and validates today, but its runtime boundary is presently a pass-through stub — it always renders the wrapped content rather than gating on the resource's <code>loading</code> state. Branch on <code>resource.loading</code> directly (<code>if={user.loading}</code> / <code>else</code>) if you need a working loading state today; treat <code>&lt;suspense&gt;</code> as declaring intent ahead of the boundary becoming functional.

## <code>createResource</code> from <code>@aihu-plugin/data</code>

Use <code>createResource</code> directly in TypeScript outside of SFCs. Unlike the <code>@state</code> <code>resource()</code> intrinsic, this is a lower-level, standalone API with its own return shape:

~~~typescript
import { createResource } from '@aihu-plugin/data'
import { signal } from '@aihu/signals'

const userId = signal<string | null>('1')
const user = createResource(
  userId,                                                // key — a Signal; changes trigger refetch
  (id) => fetch(\`/api/users/\${id}\`).then(r => r.json()), // fetcher — receives the resolved key
)

// user.state is a Signal<DataState<T>>, a status-discriminated union:
//   { status: 'idle' | 'loading' | 'ready' | 'error' | 'streaming', ... }
user.refetch()
user.invalidate()
~~~

The key argument is a signal (not a thunk) holding the current key value; the resource automatically re-fetches when it changes. <code>user.state()</code> reads the current <code>DataState</code>; check <code>.status</code> to discriminate loading/ready/error/streaming.

### Resource store and SSR dehydration

For SSR, use a resource store to cache and dehydrate resources: <code>createResourceStore</code>, <code>createResourceSerializer</code>, and the <code>ResourceStoreToken</code> injection token are all exported from <code>@aihu-plugin/data</code> alongside <code>createResource</code>.

Register the data plugin in <code>aihu.config.ts</code>:

~~~typescript
import { defineAihuConfig } from '@aihu/server'
import { data } from '@aihu-plugin/data'

export default defineAihuConfig({
  plugins: [data()],
})
~~~

<code>aihu.config.ts</code>/<code>defineAihuConfig</code> is the legacy fallback for general app/build config (see the Deployment guide — the primary app config surface is now the inline <code>viteAihuPlugin({...})</code> in <code>vite.config.ts</code>), but it remains the live, current registration path specifically for <code>@aihu/plugin</code>-shaped compiler plugins like this one. <code>viteAihuPlugin({...})</code>'s own <code>plugins</code> field is a different thing — it takes Vite plugins, not <code>@aihu/plugin</code> plugins — so <code>data()</code> belongs in <code>defineAihuConfig</code>, not there. See the Authoring Plugins guide for the full registration model.

## Server loaders

Server loaders run on the server and provide data to SSR-rendered pages. Define a loader with <code>defineLoader</code> from <code>@aihu/server</code>:

~~~typescript
import { defineLoader } from '@aihu/server'

export const loader = defineLoader(async (ctx) => {
  const users = await db.users.findMany()
  return { users }
})
~~~

The loader receives a <code>LoaderContext</code> with the request, params, and URL. What happens to the return value next depends on whether the route is <b>governed</b>.

## Server loaders → SFC handoff

There are two distinct paths, and only one of them delivers a <code>route.data</code> prop.

### Governed routes — <code>route.data</code> prop

A route becomes governed by declaring a <code>data:</code> field in its <code>@route</code> block (<code>data: { type: 'TypeName', preview: [...] }</code>). This opts the route into aihu's entitlement-gated data system: the loader's result is evaluated against the request's principal, and the component receives the resolved value as the <code>data</code> field on its <code>route</code> prop — a fully entitled payload for an authorized caller, or a withheld/preview-only shape otherwise.

\`src/pages/posts/[slug].loader.ts\`:

~~~typescript
import { defineLoader } from '@aihu/server'

export const loader = defineLoader(async (ctx) => {
  return await db.posts.findOne({ slug: ctx.params.slug })
})
~~~

\`src/pages/posts/[slug].aihu\`:

~~~aihu
@route {
  path: "/posts/[slug]"
  ssr: true
  data: { type: "Post", preview: ["title"] }
}

@state {
  let route = prop<{ params: { slug: string }; data: { title: string; body: string } }>()
}

@template {
  <article>
    <h1>{route.data.title}</h1>
    <p>{route.data.body}</p>
  </article>
}
~~~

The full entitlement-gating semantics (what a non-authorized caller's <code>route.data</code> looks like, how <code>preview</code> fields are chosen) are beyond this guide's scope — this is the pattern to reach for when a page's data needs to vary by who's asking (paywalled/tiered content, per-user views).

### Plain routes — no props, inline JSON only

A route with <b>no</b> <code>data:</code> declaration still runs its <code>defineLoader</code>, but the SFC itself receives <b>no props</b> from it. The result is embedded in the response as an inline script tag:

~~~html
<script type="application/json" id="__aihu_loader__">{"users":[...]}</script>
~~~

There is currently no built-in client-side reader for this tag — if the component needs the value, read and <code>JSON.parse</code> it yourself (e.g. in an <code>onMount()</code>). Use a plain loader when you only need the data to influence the HTML aihu itself renders (e.g. via a top-level render function), not when the SFC needs it as a prop.

> **On-demand client→server calls.** aihu previously shipped a <code>$server</code> macro and a <code>createServerCall</code> client stub for calling server functions from the client over RPC. Both were <b>retired</b> — the feature never fully wired up (see the Macro Vocabulary spec §2.12) — with no drop-in replacement. For data that depends on post-load UI state, fetch from a server route (<code>defineApiRoute</code> / <code>defineStreamRoute</code> in <code>@aihu/server</code>) with a plain <code>fetch</code>, or drive it through a governed loader.

## Server response helpers

From <code>@aihu/server</code>:

| Helper | Description |
|--------|-------------|
| <code>json(data, status?)</code> | Return a JSON response |
| <code>notFound()</code> | Return a 404 response (no message argument) |
| <code>badRequest(message?)</code> | Return a 400 response |
| <code>serverError(err?)</code> | Return a 500 response (message suppressed unless <code>__DEV__</code>) |
| <code>methodNotAllowed(allowed)</code> | Return a 405 response for the given array of allowed <code>HttpMethod</code>s |
| <code>defineApiRoute(method, pattern, handler)</code> | Declare a method+pattern-matched API route |

## Streaming routes

For streaming HTTP responses (e.g. server-sent events), use <code>defineStreamRoute</code> from <code>@aihu/server</code>. The handler returns a <code>ReadableStream&lt;string&gt;</code> — there's no <code>ctx</code>/writer callback form:

~~~typescript
import { defineStreamRoute } from '@aihu/server'

export const events = defineStreamRoute(async (req) => {
  return new ReadableStream({
    start(controller) {
      controller.enqueue('event: connected\\ndata: {}\\n\\n')
      // ... enqueue further frames, then:
      controller.close()
    },
  })
})
~~~

<code>defineStreamRoute</code> sets streaming-appropriate response headers automatically.
`
