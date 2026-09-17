# @aihu/mcp

## 0.2.1

### Patch Changes

- [#816](https://github.com/aihu-project/aihu/pull/816) [`50c87cb`](https://github.com/aihu-project/aihu/commit/50c87cb904f518d5ee69fba77940095964c73492) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Resolve the MCP validation compiler from the installed `@aihu/compiler` package while preserving the explicit `AIHU_COMPILE_BIN` override.

## 0.2.0

### Minor Changes

- [#512](https://github.com/fellwork/aihu/pull/512) [`7bf702f`](https://github.com/fellwork/aihu/commit/7bf702f6e7de8716ef51544944064a988fa3c38c) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Cookbook corpus unification — `@aihu/mcp` becomes publishable, its index becomes generated.

  - The `aihu_example` cookbook index is now GENERATED from the `cookbook/` corpus
    (`scripts/build-cookbook-index.ts` + `scripts/cookbook-lib.ts`): 20 entries in the
    current wrapper grammar, filenames mirroring `cookbook/*.aihu`, carrying the full
    `<!-- @cookbook -->` frontmatter schema (id/type/granularity/constructs/packages/
    concerns/since/playground/anti-patterns/related) plus derived retrieval tags.
    This replaces the pre-[#497](https://github.com/fellwork/aihu/issues/497) fossil index (21 `$action:`-collection-era entries whose
    filenames matched nothing on disk).
  - The builder FAILS LOUDLY (non-zero exit, all offenders listed) on any recipe with
    missing/invalid frontmatter, unknown construct/type/concern IDs, duplicate ids,
    or an empty scan — it can no longer emit a vacuous empty index.
  - Package flipped publish-ready (tier C — agent surface); publish rides the next
    release cut. CI staleness guard: `bun run check:cookbook` diffs the committed
    index (plus `llms-cookbook.txt` and the generated playground presets) against a
    fresh corpus build.

### Patch Changes

- [#519](https://github.com/fellwork/aihu/pull/519) [`2ef2830`](https://github.com/fellwork/aihu/commit/2ef2830aa737906d09a5d870176da34a22f20b99) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Rename the remaining legacy `SCRIBE_*` environment variables and markers to the
  `AIHU_*` family (following `SCRIBE_VERSION` → `AIHU_VERSION` in [#516](https://github.com/fellwork/aihu/issues/516)). No
  deprecated aliases — aihu has no external consumers.

  - `SCRIBE_NATIVE_SKIP` → `AIHU_NATIVE_SKIP` (documented SSR native-loader escape
    hatch), plus the internal `SCRIBE_NATIVE_MISSING` / `SCRIBE_NATIVE_LOAD_FAILED`
    diagnostic codes → `AIHU_NATIVE_MISSING` / `AIHU_NATIVE_LOAD_FAILED`.
  - `SCRIBE_COMPILE_BIN` → `AIHU_COMPILE_BIN`, **consolidated with** the existing
    `AIHU_COMPILE_BIN` drive-test override into a single variable. The sidecar
    `resolveBinPath()` / `resolveSpawnBinPath()` resolution and the drive/differential
    tests now both read one `AIHU_COMPILE_BIN`.
  - `SCRIBE_STATIC_ISLAND` audit marker → `AIHU_STATIC_ISLAND`.

## 0.1.1

### Patch Changes

- [#489](https://github.com/fellwork/aihu/pull/489) [`80531dc`](https://github.com/fellwork/aihu/commit/80531dcc4dfc43bc9cd399bbb8ab4520efb8f15a) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Template grammar v2 — the prefix-less template (founder-ratified 40-spec).

  One rule: naked keywords + naked HTML attributes + naked framework vocabulary;
  `{expr}` braces mean expression, quoted strings mean static; `$` retreats to
  `@state` macros only.

  **New grammar:** `if={…}`/`elseif={…}`/`else` attribute chains (adjacency-checked),
  the item-first `each={item, i of items}` `of`-binder with destructuring, `key={…}`,
  `empty` siblings, colon directives `on:<event>` (with `.prevent`/`.stop`/`.self`/`.once`
  modifiers), `bind:<prop>`, `class:<name>`, the `attr:<name>` literal escape hatch,
  naked `show`/`html`/`ref`/`once`/`memo`/`raw`, the NEW `<group>` fragment carrier,
  naked framework elements (`<slot>` is now THE projection form), and the enhanced
  `<a>` (SPA navigation, `prefetch`, `replace`, `aria-current`, auto-opt-out +
  explicit `reload`) replacing `<$link>`.

  **Retired (compile errors with fix hints):** `{#if}` C601, `{#each}` C602,
  `{@html}` C603, `{{ident}}` C604, `<$if>`/`<$else>` C605, `$if=`/`$each=`/`$let=`
  C606, every other `$`-attribute C607, `<$link>` C608, other `<$…>` elements C609,
  adjacency violations C610, unknown non-hyphenated elements C611. New lints:
  W601 (keyless stateful `each`), W602 (non-empty string on a boolean attribute).

  **Intended emission diffs:** internal `<a href>` links now lower to
  `createLinkBoundary` (the retired `<$link>` lowering) with a runtime
  origin/scheme auto-opt-out; everything else lowers through the same arbor
  structural calls as v1 (`when`/`each`/fragment branches).

  `aihu migrate --v2` now lands on this grammar (new final codemod pass:
  `compiler/js/codemods/template-grammar-v2`).
