---
'@aihu/css-engine': patch
---

Let app themes reach shadow-scoped components. The scoped compiler no longer writes a `:host { --color-*: … }` block of built-in default tokens into every component, which overrode any theme pack or `:root` tokens the component inherited from the document. References to default tokens now carry the default as a fallback (`var(--color-muted-foreground, #8a8880)`), so the app theme wins at any nesting depth and a component rendered without one still gets the default palette. Tokens set by a component's own `@theme` block are still declared at its `:host` (or `:root` in light mode).
