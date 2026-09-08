# css-engine-utility

> Minimal example showing utility classes from **`@aihu/css-engine`**
> automatically compiled and folded into the build by
> **`viteAihuPlugin`** — no hand-rolled class list, no `predev` step.

## What this demonstrates

When `@aihu/css-engine` is installed (as a dependency or peer), the compiler
plugin that `viteAihuPlugin` composes will:

1. Scan every `.aihu` SFC for utility class names.
2. Call `@aihu/css-engine`'s `compileSfc()` to produce scoped CSS for those
   classes (this is the auto-fold path, shipped in v0.5.x).
3. Inject the result into the component.

By default the compiler emits components into a **shadow root** (`shadowMode:
'open'`) which encapsulates that CSS away from the document cascade. Utility
classes are global by design — so this example sets:

```ts
viteAihuPlugin({ css: { shadowMode: 'light' } })
```

…which forwards through to `aihuCompilerPlugin({ shadowMode: 'light' })` and
lets the utility CSS land in the document-level `<style>` (visible in
`dist/assets/index-*.css`).

## Run

```bash
cd examples/css-engine-utility
bun install
bun run build
bun run check:utility-css   # acceptance: greps dist for `.flex { display: flex }`
```

The acceptance script (`scripts/check-utility-css.ts`) is the executable
contract that the auto-fold path is wired correctly end-to-end.

## See also

- [`packages/css-engine`](../../packages/css-engine) — the engine itself.
- [`@aihu/compiler`](https://github.com/aihu-project/aihu-compiler) — the
  compiler plugin that provides the `_maybeCompileUtilityCss` +
  `_foldCssEngineStyles` hook.
- [`examples/css-engine-demo`](../css-engine-demo) — older example that
  manually invokes `compile()` against a hand-rolled class list and
  bypasses `viteAihuPlugin`. Kept for the `cn()` + progressive runtime
  demonstration; this example is the canonical wiring story.
