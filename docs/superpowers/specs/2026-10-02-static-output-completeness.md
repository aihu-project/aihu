# Static output completeness

`viteAihuPlugin({ output: 'static' })` must emit every renderable route from a
real content app using the resolved Vite plugin and transform settings. The
loader server disables dependency discovery to avoid esbuild prebundling the
framework's Vite virtual modules. Framework packages importing `virtual:aihu-*`
are excluded from client dependency optimization during development.

Page discovery excludes generated `*.aihu.ts` type-check sidecars. Shared
component registries accept one or more directories consistently in the
client, server, and static rendering paths. A route load or render failure
fails the build with the route and source file. Static HTML defaults to
directory paths such as `about/index.html`; `static.format: 'file'` opts into
`about.html`, while the root remains `index.html`.

Regression coverage uses a real Vite build with multiple routes, a layout, a
workspace component directory, a route sidecar, and light-DOM slot content.
