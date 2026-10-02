# Router root resolution and link navigation

## Vite project root

The router resolves its default `pages`, `src/layouts`, and `src/components`
directories from Vite's resolved project root. Relative configured directories
use that same root. Build and dev behavior must not depend on the shell's
current working directory.

## Link behavior

The router link component exposes the active destination with
`aria-current="page"` and the `active` class. It delegates modified clicks,
non-primary clicks, non-self targets, downloads, external origins, unsupported
schemes, and same-page fragment clicks to the browser. SPA navigation to a
fragment scrolls to the matching element and moves focus to it.

## Config discovery

The router Vite plugin publishes `@aihu/router` and its resolved directory
options through the `declareAihuModule` plugin API shape consumed by the app
config loader.
