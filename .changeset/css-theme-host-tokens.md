---
'@aihu/app': minor
'@aihu/css-engine': minor
---

Add project-level theme controls for `@aihu/css-engine`.

- `css.theme` on `viteAihuPlugin` takes a CSS file with an `@theme { … }` block (relative to the Vite root) or a `defineStylePack()` result. Its values replace the built-in `aihu-default` palette as the `var()` fallback values in every component, so components render the app palette without a per-file `@theme`, while tokens set at `:root` still win. The dev server restarts when the theme file changes.
- `css.hostTokens: false` compiles token references to bare `var(--name)` with no fallback, for apps that always load their tokens at `:root`. Combining it with `css.theme` is a config error, since the theme would have no effect.
- `compileSfc()` accepts these as a fourth `options` argument (`{ theme, hostTokens }`).

Forwarding from `@aihu/app` needs an `@aihu/compiler` release with the matching `css` plugin option.
