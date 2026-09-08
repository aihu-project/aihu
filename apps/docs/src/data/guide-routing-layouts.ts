/**
 * Routing & Layouts guide body. Adapted from the real
 * apps/docs/src/content/docs/guides/routing-layouts.md. Only one dialect fix
 * applied: the layout example's `<$slot />` (retired $-prefixed special
 * element) becomes `<slot />` — confirmed current in
 * the standalone compiler template parser (bare "slot", not "$slot") and in
 * the shipped apps/docs/src/layouts/docs.aihu (`<outlet>`, unprefixed).
 * Everything else in this guide (file-based routing, @route fields,
 * viteRouterIntegration, middleware) carries over unchanged. Fenced code
 * uses the ~~~ delimiter and inline code uses <code> tags so the source
 * carries no backticks.
 */
export const ROUTING_LAYOUTS = `# Routing and Layouts

aihu uses file-based routing. Pages live under <code>src/pages/</code> and automatically become routes when compiled.

## File-based routing

Any <code>.aihu</code> file under <code>src/pages/</code> that contains an <code>@route</code> block is treated as a page route. The file path determines the default URL pattern:

| File | Default pattern |
|------|----------------|
| <code>src/pages/index.aihu</code> | <code>/</code> |
| <code>src/pages/about.aihu</code> | <code>/about</code> |
| <code>src/pages/users/[id].aihu</code> | <code>/users/:id</code> |

### File-based routing tree example

~~~
src/
  pages/
    index.aihu          →  /
    about.aihu           →  /about
    users/
      index.aihu         →  /users
      [id].aihu          →  /users/:id
    admin/
      index.aihu         →  /admin
      users.aihu         →  /admin/users
  layouts/
    default.aihu         →  wraps all routes without an explicit layout
    admin.aihu            →  wraps routes with layout: admin
~~~

## The <code>@route</code> block

~~~
@route {
  path: /admin/users
  name: admin-users
  middleware: [auth, admin]
  ssr: true
  layout: admin
}
~~~

Fields:

- <b><code>path</code></b> — explicit URL path override. If omitted, the path is derived from the file location.
- <b><code>name</code></b> — route name used in programmatic navigation and the route manifest.
- <b><code>middleware</code></b> — array of middleware names applied to this route.
- <b><code>ssr</code></b> — boolean. <code>true</code> enables server-side rendering for this route.
- <b><code>layout</code></b> — layout name to wrap this route's content.

## <code>.route.json</code> sidecars

The compiler emits a <code>.route.json</code> file alongside each compiled SFC that has an <code>@route</code> block. Example:

~~~json
{
  "pattern": "/admin/users",
  "name": "admin-users",
  "middleware": ["auth", "admin"],
  "ssr": true,
  "layout": "admin"
}
~~~

Read a sidecar programmatically with <code>readRouteSidecar(path)</code> from <code>@aihu/router/plugin</code>.

## <code>viteRouterIntegration()</code>

<code>viteRouterIntegration()</code> is a Vite plugin (from <code>@aihu/router/plugin</code>) that scans <code>src/pages/</code> at build time, reads all <code>.route.json</code> sidecars, and assembles a virtual route manifest module:

~~~typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { viteRouterIntegration } from '@aihu/router/plugin'

export default defineConfig({
  plugins: [viteRouterIntegration()],
})
~~~

The virtual module <code>virtual:aihu-routes</code> exports the assembled <code>RouteDefinition[]</code> array. The runtime <code>createRouter</code> consumes it to handle navigation.

<code>viteRouterPlugin</code> is a deprecated alias removed at v1.0.

## <code>createRouter(routes)</code>

Creates a router instance from an array of route definitions. Typically you pass the virtual module directly:

~~~typescript
import { createRouter } from '@aihu/router'
import routes from 'virtual:aihu-routes'

const router = createRouter(routes)
~~~

## Layouts

Layouts live under <code>src/layouts/</code>. The default layout is <code>src/layouts/default.aihu</code>. A layout wraps the page's rendered output via <code>&lt;slot&gt;</code>:

~~~
@template {
  <header>My App</header>
  <main>
    <slot />
  </main>
  <footer>Footer</footer>
}
~~~

<code>scanLayouts(dir)</code> from <code>@aihu/router/plugin</code> returns all discovered layout names.

## Router middleware

Middleware is defined with <code>defineRouterMiddleware</code> and composed with <code>composeRouterMiddleware</code>:

~~~typescript
import { defineRouterMiddleware, composeRouterMiddleware } from '@aihu/router'

const authMiddleware = defineRouterMiddleware(async (ctx, next) => {
  if (!ctx.params.token) {
    return { kind: 'redirect', location: '/login', status: 302 }
  }
  return next()
})

const loggingMiddleware = defineRouterMiddleware(async (ctx, next) => {
  console.log('navigating to', ctx.url.pathname)
  return next()
})

export const composed = composeRouterMiddleware(loggingMiddleware, authMiddleware)
~~~

### Stage ordering

Middleware passed to <code>composeRouterMiddleware</code> are called in array order. Any middleware that returns a non-void result (e.g. <code>{ kind: 'redirect' }</code> or <code>{ kind: 'cancel' }</code>) short-circuits the chain — subsequent middleware and the route handler are not called.

Standard stage ordering convention:

1. Logging / tracing
2. Auth / session
3. Redirect rules
4. Render

## Reactive routing primitives

The router exposes reactive primitives for use in SFCs and TypeScript:

| Export | Description |
|--------|-------------|
| <code>useRoute()</code> | Reactive accessor returning the current route match |
| <code>useRouter()</code> | Access the router instance |
| <code>navigate(path, opts?)</code> | Programmatic navigation |
| <code>createRouteSignal(router)</code> | Signal bound to the current route |
| <code>createPrefetcher(router)</code> | Create a route prefetcher |
| <code>provideRouteContext(router)</code> | Provide route context to the component tree |
| <code>RouteContext</code> | Context token for the current route |
`
