# @aihu/css-engine

## 0.7.0

### Minor Changes

- [#838](https://github.com/aihu-project/aihu/pull/838) [`a11112b`](https://github.com/aihu-project/aihu/commit/a11112bdcd4eadaa3fbb9a366c6b692e4e74ecea) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Add project-level theme controls for `@aihu/css-engine`.

  - `css.theme` on `viteAihuPlugin` takes a CSS file with an `@theme { … }` block (relative to the Vite root) or a `defineStylePack()` result. Its values replace the built-in `aihu-default` palette as the `var()` fallback values in every component, so components render the app palette without a per-file `@theme`, while tokens set at `:root` still win. The dev server restarts when the theme file changes.
  - `css.hostTokens: false` compiles token references to bare `var(--name)` with no fallback, for apps that always load their tokens at `:root`. Combining it with `css.theme` is a config error, since the theme would have no effect.
  - `compileSfc()` accepts these as a fourth `options` argument (`{ theme, hostTokens }`).

  Forwarding from `@aihu/app` needs an `@aihu/compiler` release with the matching `css` plugin option.

### Patch Changes

- [#803](https://github.com/aihu-project/aihu/pull/803) [`2bc58cf`](https://github.com/aihu-project/aihu/commit/2bc58cfaba2289fd39ef7cc55a1cffc8cffb5a3a) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Move dependency-free progressive positioning to `@aihu/arbor/progressive` so
  headless primitives no longer depend on the CSS provider. The CSS provider
  continues to export its existing positioning API as a compatibility façade.

- [#810](https://github.com/aihu-project/aihu/pull/810) [`37a0a2e`](https://github.com/aihu-project/aihu/commit/37a0a2e83611c7654c41e43dce1ac930a23698be) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Resolve compiler integrations through the published `@aihu/compiler` package instead of the monorepo source tree. `@aihu/app` now declares the compiler as a runtime dependency so its public Vite integration installs correctly for consumers.

- [#837](https://github.com/aihu-project/aihu/pull/837) [`ae74013`](https://github.com/aihu-project/aihu/commit/ae7401308c48dcb3283cb648c2f9651ac361b36f) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Let app themes reach shadow-scoped components. The scoped compiler no longer writes a `:host { --color-*: … }` block of built-in default tokens into every component, which overrode any theme pack or `:root` tokens the component inherited from the document. References to default tokens now carry the default as a fallback (`var(--color-muted-foreground, #8a8880)`), so the app theme wins at any nesting depth and a component rendered without one still gets the default palette. Tokens set by a component's own `@theme` block are still declared at its `:host` (or `:root` in light mode).

## 0.6.1

### Patch Changes

- [#779](https://github.com/fellwork/aihu/pull/779) [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Bound every `aihu-compile` / `aihu-css-compile` subprocess so a build can no
  longer hang forever with no output.

  An `apps/docs` vite build sat 10 minutes at 0.0% CPU with a wedged
  `aihu-css-compile --ast-json` child, and two `aihu-compile --stdin` children
  were found still alive after 2 days 13 hours. Reproduced under load and sampled
  both sides:

  - child — parked in `read()`, inside `io::stdin().read_to_string()`, waiting for
    an EOF on stdin that never arrives.
  - parent — parked in `node::SyncProcessRunner::TryInitializeAndRunLoop` →
    `uv_run` → `uv__io_poll` → `kevent`, still holding that pipe's write end.
    `lsof -U` confirmed the parent was the only holder, so this is not an
    fd-inheritance leak.

  The stall is on the parent side: `spawnSync`'s private uv loop never delivers
  the writable event that would finish `input` and close the write end. With no
  timer armed `uv__io_poll` calls `kevent` with **no deadline**, which is why
  these processes wait for days rather than minutes. Passing `timeout` arms a uv
  timer in that same loop, giving `kevent` a deadline, so the loop always wakes
  and reaps the child. It is not a pipe-buffer capacity problem — 20 MB of stdin
  against 200 KB each of stdout and stderr round-trips cleanly on both node and
  bun.

  Every spawn now carries a timeout, an explicit `maxBuffer` (node's inherited
  1 MiB default was its own latent `ENOBUFS` failure), and `killSignal: 'SIGKILL'`
  so nothing survives. The bound is a measured floor of 120 s — about 24,000x the
  measured 4-5 ms per-call cost, wide enough that a loaded CI runner cannot trip
  it — plus 2 ms per KB of stdin, so it scales for payloads far larger than
  anything this repo produces. Override with `AIHU_COMPILE_TIMEOUT_MS` /
  `AIHU_CSS_COMPILE_TIMEOUT_MS`; an override replaces the floor but keeps the
  per-byte allowance.

  When it fires the error names the binary, the args, the stdin size and the
  elapsed time, and says what to do next — the original hang produced no output at
  all, which is what let it cost ten minutes and two zombies survive two days.

- Updated dependencies [[`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88), [`11888ba`](https://github.com/fellwork/aihu/commit/11888ba342d04b49b18abc5f5b17da56f604a0a7), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`9e198d6`](https://github.com/fellwork/aihu/commit/9e198d6e5cc7211496335d47e1429f1f82f0a940), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`ac3affc`](https://github.com/fellwork/aihu/commit/ac3affc4cb27bae5af0ebbf84c1fd70b800d9ac8), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`ff58a1b`](https://github.com/fellwork/aihu/commit/ff58a1b8d9018f0198aa8879c359e90133266b2f), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88)]:
  - @aihu/compiler@1.3.0

## 0.6.0

### Minor Changes

- [#725](https://github.com/fellwork/aihu/pull/725) [`c38072f`](https://github.com/fellwork/aihu/commit/c38072f95ca4887c2968d7dabee176f577b44e6e) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Publish the light-DOM leaf-flip prep work landed in [#714](https://github.com/fellwork/aihu/issues/714) (`aba7e70d`), which
  shipped without a changeset: the `SfcAst` wire format gained a `tag` field
  and a `light_scope_id` field, `emit_sfc_scoped` split into 4 channels with
  mode-aware token emission (`:host` for shadow, `:root` for light -- fixes a
  live bug where a light-mode page emitted an inert `:host{}` block matching
  nothing), and the `@layer` preamble (`aihu.reset`/`tokens`/`components`/
  `utilities`) is now public API.

  The published `0.5.0` on npm predates all of this -- [#714](https://github.com/fellwork/aihu/issues/714) landed on `main`
  after `0.5.0`'s own release commit without bumping the package version, so
  the next publish would have silently shipped different code under an
  already-published version number. This changeset is that missing bump.

  Also refreshes the `aihu-css-compile` native binary (see the sibling
  platform-package version bumps in this same change): the currently
  published binary, `0.1.3`, predates the `tag` field above and fails to
  deserialize any AST the current compiler emits (`missing field 'tag'`),
  which silently degrades every `compileSfc()` call to a no-op -- utility-class
  CSS compilation stops working, with only a console warning as a symptom.

## 0.5.0

### Minor Changes

- [#608](https://github.com/fellwork/aihu/pull/608) [`3ac389f`](https://github.com/fellwork/aihu/commit/3ac389f55b9f8a2a956122d394639d3f9bf21bef) Thanks [@srmcguirt](https://github.com/srmcguirt)! - **Semantic state tokens for the daihui layer: `--color-info` / `--color-success` /
  `--color-warning` / `--color-neutral` (+ `-foreground` each), in both built-in packs,
  light and dark.**

  The daisyUI recipe set (Option 4, PR [#604](https://github.com/fellwork/aihu/issues/604) §3.4) references four colour roles aihu had no
  token for. Both founder escalations from that design doc are now ruled and implemented:

  - **E1** — `info`/`success`/`warning` are added as _state_ hues under an explicit
    amendment to the `.tastemaker/style-lock.md` single-accent rule: terracotta remains the
    only _identity_ hue; state tokens are confined to a closed list of oklch hue bands
    (terracotta 29–35, ochre 70–82, sage 153–158, graphite 245–267) with chroma strictly
    below the accent's. The rule widening is stated in the lock, not smuggled.
  - **E2** — `--color-neutral` is **added, not mapped to `--color-muted`** (a filled
    neutral surface is not a de-emphasis text colour). Its light value is graphite
    (`#363c47`) verbatim: neutral is the component-token realization of the graphite axis,
    the way `--color-accent` realizes terracotta — no brand meaning is repurposed.

  Values (aihu-default), all verified by the new contrast tool:

  | Token             | Light     | Dark      | Foreground (light / dark) |
  | ----------------- | --------- | --------- | ------------------------- |
  | `--color-info`    | `#3d5a75` | `#8fadc8` | `#faf8f4` / `#1a1d24`     |
  | `--color-success` | `#3f6f4f` | `#84b898` | `#faf8f4` / `#1a1d24`     |
  | `--color-warning` | `#945f0e` | `#d8a848` | `#faf8f4` / `#1a1d24`     |
  | `--color-neutral` | `#363c47` | `#636a72` | `#faf8f4` / `#faf8f4`     |

  Unlike terracotta (ui-safe only), the state trio is **text-safe both ways** in both modes
  (fill-on-bg and label-on-fill all ≥ 4.5; the sole ui-safe pairing is the dark neutral
  fill at 3.30/3.08 vs bg/surface, with a 5.16 text-safe label). `aihu-graphite` carries
  the same token names at chroma 0, per that pack's monochrome identity.

  Also ships `.tastemaker/check_contrast.py` — the WCAG 2.x contrast tool the style lock
  has mandated since it was written but which never existed. `--matrix` prints the full
  token matrix; `--pairings` recomputes every legal-pairing claim in the lock and exits
  non-zero if one no longer holds.

  Scope notes: this is the colour slice only — the Rust-side utility resolution
  (`is_brand_token` / `AIHU_BRAND_TOKENS`) and the non-colour daisyUI scalars
  (`--size-*`, `--border`, `--depth`, `--noise`) are PR [#604](https://github.com/fellwork/aihu/issues/604) slice 3, unchanged here. Only
  the two shipped pack bundles grow (16 declarations each); per-component emission is
  untouched, and no `.size-limit.json` row moves (packs are build-time).

- [#604](https://github.com/fellwork/aihu/pull/604) [`bba7e84`](https://github.com/fellwork/aihu/commit/bba7e8441a836b01a5927e5f7e3b8870b3d8c3ac) Thanks [@srmcguirt](https://github.com/srmcguirt)! - **`defineStylePack()` gains a named-theme dimension, and the dark block is dual-keyed on
  `.dark` and `[data-theme="dark"]`.**

  `StylePackInput` admitted exactly two themes: `tokens` (emitted at `:root`) and an optional
  `dark` (emitted at `.dark`). There was no way to express a third named theme at all, which is
  the dimension a swappable theme catalog needs. This is the first slice of the Option 4 design
  (`docs/plans/2026-07-26-option-4-daisyui-design.md`).

  **Named themes.** A pack may now declare `themes: Record<string, TokenMap>`; each entry emits
  its own `[data-theme="<name>"] { … }` block and is selected by putting `data-theme="<name>"` on
  an ancestor — per the founder-ratified convention, `<html>`.

  ```ts
  const pack = defineStylePack({
    name: "acme",
    tokens: { "color-primary": "#0a7" },
    dark: { "color-primary": "#3fc" },
    themes: { cupcake: { "color-primary": "#65c3c8" } },
  });
  pack.themeNames; // ['cupcake']
  ```

  A named theme is an **override layer over `tokens`**, not a standalone theme — only the names
  that differ need listing, exactly as `dark` already works. The descriptor exposes `themes` and
  `themeNames`.

  **Dual-keyed dark.** The dark block's selector changes from `.dark` to
  `.dark, [data-theme="dark"]` (exported as `DARK_SELECTOR`). One block, one comma-list, no
  duplicated declarations. This is additive: every existing `.dark` consumer is untouched, and
  `<html data-theme="dark">` now resolves correct token values for the first time.

  **One thing it does not yet do.** `dark:`-variant _utility rules_ are still gated on
  `:host([data-theme="dark"])` / `:root.dark` by the Rust emitter, neither of which matches
  `data-theme` on the document root. So a page on `data-theme="dark"` **alone** gets correct token
  values but not `dark:`-variant utilities until that follow-up lands. No shipped consumer is
  affected — nothing in the repo sets `data-theme` on a document root today; the only writer is
  the Storybook decorator, which stamps it on component hosts, the selector the emitter already
  handles. This is a partially-complete new capability, not a regression.

  **Emission order is load-bearing.** `:root`, `.dark`/`[data-theme="dark"]`, and each named theme
  all weigh (0,1,0), so the last matching block wins. Named themes are therefore emitted last:
  `<html class="dark" data-theme="cupcake">` resolves to cupcake, because an explicit selection
  should beat an inherited one. Pinned by test.

  Validation: `dark` is rejected as a named theme (it has its own dual-keyed selector); theme names
  must match `/^[a-z][a-z0-9-]*$/`, since they become attribute selectors; a theme declaring no
  tokens is rejected.

  `toCss()` now renders comma-separated selector lists one selector per line. That is not
  cosmetic: the generated bundles are byte-parity tested against `toCss()` _and_ biome-checked,
  and biome's CSS formatter splits comma lists — so emitting one on a single line would let the
  pre-commit hook reformat the generated file out from under the parity test. `formatSelectorList`
  is exported and the canonical form is pinned by a test.

  Neither shipped pack declares a named theme — `aihu-default.css` and `aihu-graphite.css` change
  by exactly one line each, the dark selector. A test pins that, so a catalog landing on the
  default pack is a visible diff rather than silent drift.

## 0.4.6

### Patch Changes

- Updated dependencies [[`c3381b9`](https://github.com/fellwork/aihu/commit/c3381b92c3d356d6f78f9db0e8130a9e7a466269), [`30ed2b5`](https://github.com/fellwork/aihu/commit/30ed2b51c215512f840b113afaa1636378e31407), [`2660a52`](https://github.com/fellwork/aihu/commit/2660a52223193eb724450e4b6e9dce32e15ae83b), [`9dd7654`](https://github.com/fellwork/aihu/commit/9dd7654678da1149705e21324f6b30e9baafcd4b), [`a195b80`](https://github.com/fellwork/aihu/commit/a195b8093e639c96b8471ea3567267ca8c11c269), [`dd8cfd6`](https://github.com/fellwork/aihu/commit/dd8cfd639f42ddb05468fe07b6d4f4420a80a8bf), [`80531dc`](https://github.com/fellwork/aihu/commit/80531dcc4dfc43bc9cd399bbb8ab4520efb8f15a), [`0db5827`](https://github.com/fellwork/aihu/commit/0db58275ecabf2d3e49431c810885e1ebfb5a9b6), [`bc0f289`](https://github.com/fellwork/aihu/commit/bc0f289ee38871cda8002e56fba3e3b8b7e34d84)]:
  - @aihu/compiler@1.0.0

## 0.4.5

### Patch Changes

- Updated dependencies [[`df40c34`](https://github.com/fellwork/aihu/commit/df40c34526e985ce656a6a5650ac1d83ebef3a80), [`b279f74`](https://github.com/fellwork/aihu/commit/b279f74b34cd4e901be1cfa5d70c212cf604dfc1), [`212e3e3`](https://github.com/fellwork/aihu/commit/212e3e38ae57de7e38c3211ef0223729ba1511e1), [`212e3e3`](https://github.com/fellwork/aihu/commit/212e3e38ae57de7e38c3211ef0223729ba1511e1), [`38652d5`](https://github.com/fellwork/aihu/commit/38652d544fd1001e42d505627de88976d69c1710)]:
  - @aihu/compiler@0.11.0

## 0.4.4

### Patch Changes

- Updated dependencies [[`8127925`](https://github.com/fellwork/aihu/commit/8127925482725c8394c03298a27b91cbbfc59418), [`8127925`](https://github.com/fellwork/aihu/commit/8127925482725c8394c03298a27b91cbbfc59418), [`8127925`](https://github.com/fellwork/aihu/commit/8127925482725c8394c03298a27b91cbbfc59418), [`250dbbf`](https://github.com/fellwork/aihu/commit/250dbbf4024f77ddfe41cf9d04b14ad5266ccfee), [`8127925`](https://github.com/fellwork/aihu/commit/8127925482725c8394c03298a27b91cbbfc59418)]:
  - @aihu/compiler@0.10.0

## 0.4.3

### Patch Changes

- [#331](https://github.com/fellwork/aihu/pull/331) [`cc24673`](https://github.com/fellwork/aihu/commit/cc246732d7dce820ee6abdc1dc86d391a228d7cf) Thanks [@srmcguirt](https://github.com/srmcguirt)! - `cn()`: register the Tailwind-v4 parity utility families in the conflict map so
  `cn()` de-dupes them last-wins — `size`, `aspect`, `order`, `blur`,
  `backdrop-blur`, `cursor`, `list`, `self`, `shrink`, `grow`, `object`, and the
  gradient stops `from`/`via`/`to`. Families that share a first-dash prefix with an
  existing entry (`font-serif`→`font`, `outline-offset`→`outline`,
  `text-pretty`→`text`, `bg-linear-to`→`bg`) were already covered. Follow-up to the
  utility-parity work in [#329](https://github.com/fellwork/aihu/issues/329).
- Updated dependencies [[`dbc0903`](https://github.com/fellwork/aihu/commit/dbc09031f22ee93d9e5c9a46fea2ca2409463e90)]:
  - @aihu/compiler@0.9.0

## 0.4.2

### Patch Changes

- Updated dependencies [[`fc5fa49`](https://github.com/fellwork/aihu/commit/fc5fa49688ee8aca8ad5de0a513dca1e648a00f3), [`fb436ac`](https://github.com/fellwork/aihu/commit/fb436ac2a1ecb6f9d570ccc05beeeab666c3ad6d)]:
  - @aihu/compiler@0.8.0

## 0.4.1

### Patch Changes

- Updated dependencies [[`eaadd45`](https://github.com/fellwork/aihu/commit/eaadd459118055e422e4ae025ceaa72be39ee17c)]:
  - @aihu/compiler@0.7.0

## 0.4.0

### Minor Changes

- [#329](https://github.com/fellwork/aihu/pull/329) [`8f56e88`](https://github.com/fellwork/aihu/commit/8f56e881e500df7c237f996c319f04dedab3cd7e) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Tailwind-v4 utility parity — render full Tailwind-authored pages on the engine.

  Expands the `aihu-css-core` utility table and fixes two correctness bugs so a
  marketing page authored against full Tailwind v4 compiles entirely on the engine
  (under shadow DOM), instead of silently dropping ~230 unsupported utilities.

  - **New families**: `size-*`, `aspect-*`, gradients (`bg-linear/gradient-to-*`,
    `from/via/to`), `mask-*`, `blur`/`backdrop-blur`, `isolate`, `transform-gpu`,
    outline width/offset, `shadow-xs/xl/2xl/inner`, `rounded-3xl/4xl`,
    `font-serif`, `text-6xl…9xl` + `text-<size>/<lh>` slash line-height,
    `text-wrap/pretty/balance`, `cursor-*`, `list-*`, `sr-only`, `self-*`,
    `shrink/grow`, `order-*`, negative margins, fractional positions, `-z-*`.
  - **Arbitrary color typing**: `border-[…]`/`outline-[…]`/`ring-[…]` are now
    color-vs-width typed by value (`border-[var(--c)]` → `border-color`, not the
    previous invalid `border-width`); `[color:]`/`[length:]` hints honored.
  - **`(--var)` shorthand**: `prefix-(--token)` resolves through the prefix's
    property type (`border-(--c)` is a color), with `/opacity` via color-mix.
  - **Palette**: the scoped emitter registers the Tailwind-v4 oklch value for each
    `--color-<family>-<shade>` a component references (used tokens only), so
    `bg-amber-500` etc. resolve at `:host`.
  - **Variants**: `open`, `first/last/only/odd/even/empty`, pseudo-elements
    `marker/placeholder/before/after/selection/file`, and `group-open`/`peer-open`.

  No JS API or CLI change — utility table + scoped emission only. The native
  `aihu-css-compile` binary is rebuilt from these sources by the existing
  `publish-css-native` release job.

### Patch Changes

- [#293](https://github.com/fellwork/aihu/pull/293) [`7e1f1fe`](https://github.com/fellwork/aihu/commit/7e1f1fe0ef1be17b5ea928727252d849f48c46ef) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Refresh native platform binaries to 0.1.3. The published `@aihu/css-engine-*`
  platform packages were frozen at 0.1.2 and predated the utility PRs [#268](https://github.com/fellwork/aihu/issues/268)–[#275](https://github.com/fellwork/aihu/issues/275)
  (space/grid/border-width families, divide-x/y, position+leading/tracking scales,
  ring widths, motion utilities, group:/peer: + aria-/data- variants, container
  queries) — consumers resolving the 0.1.2 binary compiled against a stale utility
  table. Bumped all four platform packages (`darwin-arm64`, `darwin-x64`,
  `linux-x64-gnu`, `win32-x64-msvc`) to 0.1.3 and updated the `optionalDependencies`
  pins so the next `v*` release rebuilds and republishes the binaries at current
  `main` (the `publish-css-native` job is idempotent and would otherwise skip
  0.1.2). No API or CLI change — binary content only.
- Updated dependencies [[`b85f400`](https://github.com/fellwork/aihu/commit/b85f4008c489a0dba9e36cbdfc48b635eeea375f), [`a54ca1b`](https://github.com/fellwork/aihu/commit/a54ca1b8874583a0301e84c91f2d25713908e41f), [`7ec7155`](https://github.com/fellwork/aihu/commit/7ec71553722eaa4e3f6814e79ec747db68b72451), [`1132357`](https://github.com/fellwork/aihu/commit/113235708bac1e8f9263d35feb865af8f8127f86)]:
  - @aihu/compiler@0.6.0

## 0.3.0

### Minor Changes

- [#268](https://github.com/fellwork/aihu/pull/268) [`1a3a857`](https://github.com/fellwork/aihu/commit/1a3a85792ef0f21611184ff6ea84a5a2a63d09af) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Add five Tailwind-v4 utility families to the css-engine token table:

  - `space-x-*` / `space-y-*` — emit the standard sibling-margin recipe
    (`& > * + * { margin-inline-start | margin-block-start: <scale>; }`).
  - `mx-auto` / `my-auto` (and `mt/mr/mb/ml-auto`) — `spacing_value` now
    accepts `auto`.
  - `max-w-*` named scale — `max-w-xs`…`max-w-7xl`, `max-w-prose`,
    `max-w-screen-*`, and the `none/full/min/max/fit` keywords.
  - Grid templating — `grid-cols-N` / `grid-rows-N` → `repeat(N, minmax(0, 1fr))`,
    `col-span-N` / `row-span-N` → `span N / span N`, plus the `none`/`full`/`auto`
    keyword forms.
  - Border widths — `border-{0,2,4,8}` and directional
    `border-x/y/t/r/b/l-{0,2,4,8}`.

  All compile at build time into per-component scoped CSS; no runtime cost and no
  change to browser-bundle size budgets (the new logic lives in the `aihu-css-core`
  Rust crate, which does not ship to the client).

- [#275](https://github.com/fellwork/aihu/pull/275) [`38a6dc5`](https://github.com/fellwork/aihu/commit/38a6dc5f9531d82b57081562d81a6b6c6d4cae21) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Add aria-_/data-_ attribute variants and container-query support.

  - `aria-checked:`, `aria-disabled:`, `aria-expanded:`, `aria-selected:`,
    `aria-pressed:` and the arbitrary `aria-[name=value]:` form compile to an
    attribute selector appended to the class (`[aria-expanded="true"]`).
  - `data-[state=open]:` (arbitrary `name=value`) and bare `data-active:`
    (presence) compile to `[data-state="open"]` / `[data-active]`.
  - `@container` (and named `@container/<name>`) mark a query container
    (`container-type: inline-size`); the `@sm:`/`@md:`/`@lg:`/`@xl:`/`@2xl:`
    container-query variants wrap the rule in an `@container (min-width: …)`
    at-rule on Tailwind's container-query scale.

- [#270](https://github.com/fellwork/aihu/pull/270) [`6322593`](https://github.com/fellwork/aihu/commit/63225938452ef14e4e5f86b56a252a2c9d526265) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Add the Tailwind-v4 `divide-x-*` / `divide-y-*` sibling-border utilities to the
  css-engine token table:

  - `divide-x` / `divide-y` — bare forms default to `1px`, emitting the nested
    sibling-border recipe (`& > * + * { border-inline-width | border-block-width: 1px; }`).
  - `divide-x-{0,2,4,8}` / `divide-y-{0,2,4,8}` — width scale →
    `& > * + * { border-inline-width | border-block-width: 0 / 2px / 4px / 8px; }`.
  - `divide-x-reverse` / `divide-y-reverse` — set the
    `--tw-divide-{x,y}-reverse` custom property for Tailwind API parity.

  These reuse the proven `space-x/y` nested `& > * + *` emission path, so they
  minify correctly to `.divide-y-2>*+*{border-block-width:2px}` in the production
  Vite/Lightning pipeline and survive the scoped CSS-nesting path. `cn()` last-wins
  conflict groups are registered per axis. All compile at build time into
  per-component scoped CSS; no runtime cost and no change to browser-bundle size
  budgets (the logic lives in the `aihu-css-core` Rust crate, which does not ship
  to the client).

- [#274](https://github.com/fellwork/aihu/pull/274) [`4b90dfa`](https://github.com/fellwork/aihu/commit/4b90dfa1c22243bc5de9c31cb6e406ab83381bfb) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Add Tailwind `group:` / `peer:` relational-element variants.

  The engine now recognizes the bare `group` / `peer` marker classes plus the
  `group-hover:`, `group-focus:`, `group-focus-visible:`, `group-active:`,
  `group-disabled:`, `peer-hover:`, `peer-focus:`, `peer-focus-visible:`,
  `peer-checked:`, and `peer-disabled:` variant prefixes. `group-*:` compiles to an
  ancestor descendant selector (`.group:hover .group-hover\:bg-primary`) and
  `peer-*:` to a previous-sibling selector (`.peer:checked ~ .peer-checked\:bg-primary`),
  both scoped inside the component's shadow root. The bare `group` / `peer` classes
  are emitted as no-op marker rules so they survive scanning and anchor the
  relationship.

- [#273](https://github.com/fellwork/aihu/pull/273) [`6a84dbb`](https://github.com/fellwork/aihu/commit/6a84dbb5298fd86d715d3ccbf0b88511803980d9) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Add the Tailwind-v4 motion utility family to the css-engine token table:

  - Transform: `transform` (identity baseline), `transform-none`.
  - Translate: `translate-x-N` / `translate-y-N` on the spacing scale, plus the
    negative forms `-translate-x-N` / `-translate-y-N` (a new leading-`-` parse
    path negates the emitted value).
  - Rotate: `rotate-N` / `-rotate-N` → `transform: rotate(±Ndeg)`.
  - Scale: `scale-N` / `scale-x-N` / `scale-y-N` (percentage → unit factor, e.g.
    `scale-105` → `1.05`).
  - Transition: `transition`, `transition-none`, `transition-all`,
    `transition-colors`, `transition-opacity`, `transition-transform`, each with
    the default `150ms` / `cubic-bezier(0.4, 0, 0.2, 1)` timing.
  - Duration: `duration-N` → `transition-duration: Nms`.
  - Easing: `ease-linear`, `ease-in`, `ease-out`, `ease-in-out`.
  - Animation: `animate-none`, `animate-spin`, `animate-ping`, `animate-pulse`,
    `animate-bounce`. Each keyframe-backed animation emits its `@keyframes` block
    as a hoisted top-level sibling rule alongside the class rule (keyframes
    cannot nest inside a selector body; re-emitting an identical block is
    idempotent in CSS).

  Each transform utility emits a single `transform:` declaration (no CSS-var
  composition), so the engine resolves them via the cascade and `cn()` last-wins
  groups (`translate`/`rotate`/`scale`). All compile at build time into
  per-component scoped CSS; no runtime cost and no browser-bundle size impact (the
  logic lives in the `aihu-css-core` Rust crate, which does not ship to the
  client).

- [#272](https://github.com/fellwork/aihu/pull/272) [`14f3a3e`](https://github.com/fellwork/aihu/commit/14f3a3e4b12a09d396cbe3a537ee67a5cc512049) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Add Tailwind-v4 ring width + ring-offset utilities to the css-engine token table:

  - `ring` (3px default) and `ring-{0,1,2,4,8}` — emit the Tailwind v4 focus-ring
    recipe: a `box-shadow` composed from `--tw-ring-*` custom properties
    (`--tw-ring-shadow: var(--tw-ring-inset) 0 0 0 calc(<n>px + var(--tw-ring-offset-width)) var(--tw-ring-color);`),
    so width, color, and offset compose independently and layer with `shadow-*`.
  - `ring-inset` — sets `--tw-ring-inset: inset;`.
  - `ring-offset-{0,1,2,4,8}` — sets `--tw-ring-offset-width: <n>px;`.

  The existing `ring-<color>` path is unchanged: `ring-blue-500`, `ring-primary`,
  `ring-ring`, etc. still emit `--tw-ring-color: var(--color-*)`. The bare `ring`
  keyword (a width) is matched before the color path so it never collides with a
  color token, and all `ring*` utilities already last-wins under the existing
  `ring` conflict-group prefix.

  Build-time only — the new logic lives in the `aihu-css-core` Rust crate, which
  does not ship to the client, so there is no browser-bundle size impact.

- [#271](https://github.com/fellwork/aihu/pull/271) [`3089577`](https://github.com/fellwork/aihu/commit/30895777d91823005805c66a2f06c2afcf443dde) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Add named/numeric scales for position and typography utilities to the
  css-engine token table (round 2 of tailwind-support):

  - Position scale — `top-N` / `right-N` / `bottom-N` / `left-N` / `inset-N` /
    `inset-x-N` / `inset-y-N` on the Tailwind spacing scale (`top-4` → `top: 1rem;`),
    plus the `auto` keyword (`top-auto`), `inset-0` → `inset: 0;`, the logical
    `inset-inline` / `inset-block` shorthands, and negative offsets via a leading
    `-` (`-left-2` → `left: -0.5rem;`).
  - Line-height scale — `leading-{none,tight,snug,normal,relaxed,loose}` (unitless
    multipliers) and numeric `leading-<n>` mapping to the spacing scale.
  - Letter-spacing scale — `tracking-{tighter,tight,normal,wide,wider,widest}`
    in `em` units.

  Each family registers a `conflict_groups()` entry so `cn()` resolves last-wins
  per property. The existing arbitrary-value forms (`top-[1rem]`, `leading-[1.4]`)
  are untouched. All compile at build time into per-component scoped CSS; the new
  logic lives in the `aihu-css-core` Rust crate, which does not ship to the
  client, so there is no browser-bundle size impact.

## 0.2.5

### Patch Changes

- [#258](https://github.com/fellwork/aihu/pull/258) [`74273e0`](https://github.com/fellwork/aihu/commit/74273e0a015805f3c878c9b2c7890ed0c80a23fd) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix Bug 6: utility CSS from `@aihu/css-engine` now lands in the bundled `dist/assets/*.css` asset when `viteAihuPlugin({ css: { shadowMode: 'none' } })` is set, so utility classes like `.flex`, `.gap-6`, `.text-lg` actually take effect in the document cascade.

  - `@aihu/compiler`: `aihuCompilerPlugin` now branches on `shadowMode === 'none'` and routes utility CSS through Vite's CSS pipeline via a `virtual:aihu-utility/<hash>.css` virtual import (resolved by the plugin's new `resolveId` + `load` hooks). The `'open' | 'closed'` shadow paths still fold into `host.adoptedStyleSheets` as before — only the no-shadow case changes. Also makes the compiler-binary path resolution lazy (call-time) so the `SCRIBE_COMPILE_BIN` handshake with `@aihu/css-engine`'s bundled `compileToAst` actually fires.
  - `@aihu/css-engine`: rebuild against the deferred compiler-bin resolver so `compileSfc()` no longer ENOENTs against the missing `packages/css-engine/bin/aihu-compile` on the first call (the SCRIBE_COMPILE_BIN env var is now read at every call, not captured at module load).

- [#261](https://github.com/fellwork/aihu/pull/261) [`c6860e0`](https://github.com/fellwork/aihu/commit/c6860e022a374b3c5e35aaf8775cbb6332b1b75d) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Externalize `@aihu/compiler` from the rolldown bundle so consumers always use the
  live compiler module (with its current binary-resolution logic) instead of a
  frozen embedded copy. Pre-fix the `compileToAst` from `@aihu/compiler` was
  inlined into `dist/index.js` at build time, freezing a module-scope `binPath`
  constant that resolved at import time to a non-existent
  `node_modules/@aihu/css-engine/bin/aihu-compile` path. Marking `@aihu/compiler`
  external means the bundle now does `import { compileToAst } from "@aihu/compiler"`
  so the consumer-installed compiler module — including any subsequent binary
  resolver fixes — is what runs. Also bumps the workspace dep range to
  `workspace:^` so publish rewrites to a caret range.

- [#259](https://github.com/fellwork/aihu/pull/259) [`5f21125`](https://github.com/fellwork/aihu/commit/5f211252c7500973c6976ca48f29b09ea8aa049b) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix publishing pipeline so `@aihu/css-engine-<platform>` tarballs ship `aihu-css-compile` with the executable bit set. `actions/download-artifact@v4` does not preserve POSIX mode bits, so the `chmod 0755` performed in `build-css-native` was lost in transit and the `publish-css-native` job published `-rw-r--r--` binaries. Consumers on Bun could not auto-repair this (postinstall scripts are blocked by default for untrusted deps), surfacing as a "binary not found" error from `resolveBinary()`. The next release will be the first to ship correctly-mode'd tarballs across all 4 platforms; existing releases stay broken and require the documented `chmod +x` workaround.

- Updated dependencies [[`74273e0`](https://github.com/fellwork/aihu/commit/74273e0a015805f3c878c9b2c7890ed0c80a23fd)]:
  - @aihu/compiler@0.5.4

## 0.2.4

### Patch Changes

- [#253](https://github.com/fellwork/aihu/pull/253) [`d42793b`](https://github.com/fellwork/aihu/commit/d42793b8258d723ae7c80179dcc82e2db8d0afc4) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Forward `shadowMode` through `viteAihuPlugin` for utility-class CSS frameworks.

  - **`@aihu/app`** — new `css.shadowMode` option on `AihuConfig`. When set, it
    forwards to the compiler's per-plugin `shadowMode` injection
    (`'open' | 'closed' | 'none'`). Required for consumers of
    `@aihu/css-engine` (and other cascade-dependent CSS frameworks) so the
    utility classes the compiler folds in are not trapped inside a shadow root.
    Default behaviour is unchanged.
  - **`@aihu/compiler`** — `_maybeCompileUtilityCss` now emits a one-shot
    `console.warn` when `@aihu/css-engine` resolves but `compileSfc()` throws
    (typically: the native `aihu-css-core` binary is unresolvable). Build is
    still non-fatal; previously this case was completely silent and users
    could not discover why their utility classes never emitted.
  - **`@aihu/css-engine`** — README now documents the canonical
    `viteAihuPlugin({ css: { shadowMode: 'none' } })` wiring and points to the
    new `examples/css-engine-utility/` end-to-end example.

- Updated dependencies [[`d42793b`](https://github.com/fellwork/aihu/commit/d42793b8258d723ae7c80179dcc82e2db8d0afc4), [`52a7ee6`](https://github.com/fellwork/aihu/commit/52a7ee600c1f94ac741c01d6d9c0a4a203fc0ef3)]:
  - @aihu/compiler@0.5.3

## 0.2.3

### Patch Changes

- Updated dependencies [[`6ed33f8`](https://github.com/fellwork/aihu/commit/6ed33f80bfdf193382e9fb1d192c0c1d4e6ef069), [`6ed33f8`](https://github.com/fellwork/aihu/commit/6ed33f80bfdf193382e9fb1d192c0c1d4e6ef069)]:
  - @aihu/compiler@0.5.2

## 0.2.2

### Patch Changes

- Updated dependencies [[`e31df0b`](https://github.com/fellwork/aihu/commit/e31df0bbf43cca38d55528bf31d00088897e5579)]:
  - @aihu/compiler@0.5.1

## 0.2.1

### Patch Changes

- [#226](https://github.com/fellwork/aihu/pull/226) [`71ca28e`](https://github.com/fellwork/aihu/commit/71ca28ece93dfcfdad4bd9edda2a2ead415d26f2) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Make `resolveBinary()` robust to a present-but-unusable per-platform stub.
  R6c added `@aihu/css-engine-<platform>` packages as `optionalDependencies`,
  and refreshing `bun.lock` made their in-source PLACEHOLDER `aihu-css-compile`
  resolvable inside the workspace. The old resolver accepted that candidate on
  `existsSync` alone, returned the non-executable placeholder, and then died with
  `EACCES` inside `execFileSync` — never reaching the dev `target/` fallback (CI
  `check` failures across `sfc-e2e`, `css-engine-hook`, and `style-pack`). The
  candidate is now gated on `isUsableExecutable()`: a zero-byte / non-executable
  stub is rejected (POSIX `accessSync(_, X_OK)`; on Windows, a non-empty regular
  file) so resolution falls THROUGH to the monorepo `target/release|debug/`
  binary. The structured "no binary" error is thrown only when BOTH a real
  platform executable AND the dev `target/` are absent. The published-consumer
  path is unchanged: a real per-platform executable is still used when installed.
- Updated dependencies []:
  - @aihu/compiler@0.5.0

## 0.2.0

### Minor Changes

- [#219](https://github.com/fellwork/aihu/pull/219) [`a866af7`](https://github.com/fellwork/aihu/commit/a866af78d41931e28c5b19084342e566ca47bdee) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Ship `@aihu/css-engine`'s native `aihu-css-compile` binary per-platform so the
  package is usable by any npm consumer — not just a monorepo dev clone with a
  Rust toolchain.

  `compile()` / `compileSfc()` shell out to the `aihu-css-compile` CLI executable
  (built from the `aihu-css-core` crate). Previously `resolveBinary()` only
  searched the monorepo's `target/release|debug/`, so a published `npm install
@aihu/css-engine` shipped no binary and `compile()` threw immediately.

  `resolveBinary()` now mirrors `@aihu/server`'s `detectPlatform()`: it maps
  `process.platform`+`process.arch` to a per-platform `optionalDependencies`
  package and resolves the executable's path via
  `createRequire(import.meta.url).resolve('<pkg>/package.json')`. Because the
  binary is invoked as a CLI subprocess (not a napi `.node` addon), the platform
  package ships a raw executable and we resolve its path rather than `require()`-ing
  it. The monorepo `target/` path is retained ONLY as a dev fallback. When the
  platform is supported but the package is absent, a structured error tells the
  user their `optionalDependencies` install was skipped (and how to reinstall);
  unsupported platforms get a build-from-source remedy.

  New per-platform `optionalDependencies` (initial `0.1.2`, binaries produced by
  CI on the release tag):

  - `@aihu/css-engine-darwin-arm64`
  - `@aihu/css-engine-darwin-x64`
  - `@aihu/css-engine-linux-x64-gnu` (glibc)
  - `@aihu/css-engine-win32-x64-msvc`

  Build-time-only package — zero browser-bundle impact, no `.size-limit.json` row.

- [#214](https://github.com/fellwork/aihu/pull/214) [`45b393c`](https://github.com/fellwork/aihu/commit/45b393c3f48758bf82c152bbe6088c63edaa68a6) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Make the two built-in style packs importable both ways. Previously only
  `defineStylePack()` was exported (from `.`); the shipped `styles/*.css` bundles
  were published as `files` but unreachable through `exports` (a bare
  `import '@aihu/css-engine/styles/aihu-default.css'` threw
  `ERR_PACKAGE_PATH_NOT_EXPORTED`).

  New `exports` entries:

  - `./packs` — `aihuDefault` and `aihuGraphite` as `StylePack` objects (the same
    `defineStylePack()` shape external orgs use) plus a `builtinPacks` registry.
    Read `.tokens` / `.dark` or emit `.toCss()`.
  - `./styles/aihu-default.css`, `./styles/aihu-graphite.css` (and a `./styles/*`
    glob) — the CSS bundles now resolve through `exports`, so Vite/bundlers inline
    them directly.

  The `./packs` objects are the SOURCE OF TRUTH for the `styles/*.css` bundles:
  each `.css` file is GENERATED from `pack.toCss()` (`bun run gen:style-packs`,
  wired into the package build + `prepublishOnly`), so the JS objects and the CSS
  files can never drift. A `style-pack.test.ts` parity test asserts
  `pack.toCss()` byte-equals each shipped file.

  Build/dev-time-only package — zero browser-bundle impact, no `.size-limit.json`
  row (the pure-data `./packs` entry rides on the existing `@aihu/css-engine`
  build-dev-only classification).

### Patch Changes

- Updated dependencies [[`574af6d`](https://github.com/fellwork/aihu/commit/574af6d4214889e9b3f7c407a42aa2e53252fddc), [`55298d5`](https://github.com/fellwork/aihu/commit/55298d51f9c6a3723a441d18a71b458e9f2cd035)]:
  - @aihu/compiler@0.5.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`55ce81c`](https://github.com/fellwork/aihu/commit/55ce81ca9ff6e63b0ba7d9eb878f175704096140)]:
  - @aihu/compiler@0.4.1

## 0.1.0

### Minor Changes

- [#187](https://github.com/fellwork/aihu/pull/187) [`31a37ef`](https://github.com/fellwork/aihu/commit/31a37eff5506f913c7081698745eac5092e04463) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Add the AST-consuming scanner and full compile pipeline to `@aihu/css-engine`.
  The scanner walks the compiler's exported SFC AST (via `compileToAst` / the
  `aihu-compile --ast-json` hook), extracting utility classes from static and
  macro forms and deferring reactive `$class={…}` bindings to runtime. Adds a full
  Tailwind v4 utility table (with arbitrary `[…]` bracket values), a scoped
  shadow-DOM emitter, WC-native variants (`host:`, `slotted:`, `slotted-img:`,
  `part-*:`, `host-context-dark:`) plus standard variants (`hover:`, `focus:`,
  `dark:`, `md:`, `[&>div]:`), a `@theme` token registry seeded with aihu brand
  tokens, and an AST-hashed incremental compilation cache. Build-time only — zero
  browser-bundle impact.

- [#185](https://github.com/fellwork/aihu/pull/185) [`eed6ce6`](https://github.com/fellwork/aihu/commit/eed6ce6d600c06d3fa22ea228f3f370c6cebb2dc) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Initial release of `@aihu/css-engine` — the build-time, compile-time CSS engine
  (Tailwind v4 hard-fork, WC-native scoped shadow-DOM output). This bootstrap
  release ships the `@aihu/css-engine` package + the `aihu-css-core` Rust crate
  with a `compile(classes)` entry point. Build-time-only: it adds zero to the
  browser bundle (no CSS-in-JS, no runtime row in `.size-limit.json`).

### Patch Changes

- Updated dependencies [[`faca280`](https://github.com/fellwork/aihu/commit/faca2804cf62c05ffc90ef867faa2058b5e267ad), [`173705b`](https://github.com/fellwork/aihu/commit/173705bde39bdd5b79b7e3665bb91719e0a74e63)]:
  - @aihu/compiler@0.4.0
