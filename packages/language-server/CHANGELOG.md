# @aihu/language-server

## 0.4.2

### Patch Changes

- [#810](https://github.com/aihu-project/aihu/pull/810) [`37a0a2e`](https://github.com/aihu-project/aihu/commit/37a0a2e83611c7654c41e43dce1ac930a23698be) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Resolve compiler integrations through the published `@aihu/compiler` package instead of the monorepo source tree. `@aihu/app` now declares the compiler as a runtime dependency so its public Vite integration installs correctly for consumers.

- Updated dependencies [[`37a0a2e`](https://github.com/aihu-project/aihu/commit/37a0a2e83611c7654c41e43dce1ac930a23698be)]:
  - @aihu/tsc@0.3.4

## 0.4.1

### Patch Changes

- Updated dependencies [[`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88), [`11888ba`](https://github.com/fellwork/aihu/commit/11888ba342d04b49b18abc5f5b17da56f604a0a7), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`9e198d6`](https://github.com/fellwork/aihu/commit/9e198d6e5cc7211496335d47e1429f1f82f0a940), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`ac3affc`](https://github.com/fellwork/aihu/commit/ac3affc4cb27bae5af0ebbf84c1fd70b800d9ac8), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`ff58a1b`](https://github.com/fellwork/aihu/commit/ff58a1b8d9018f0198aa8879c359e90133266b2f), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88)]:
  - @aihu/compiler@1.3.0
  - @aihu/tsc@0.3.3

## 0.4.0

### Minor Changes

- [#756](https://github.com/fellwork/aihu/pull/756) [`88bbdad`](https://github.com/fellwork/aihu/commit/88bbdad9f57364f160bda7f49c35facf44cf09aa) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Remove `useSwarm` and the `@aihu/use/useSwarm` subpath export.

  **Breaking for `@aihu/use`:** the `./useSwarm` entry point is gone, along with
  the `useSwarm` value export from the package root and its `SwarmRecord` /
  `SwarmState` / `SwarmYourMove` / `UseSwarmOptions` / `UseSwarmReturn` types.

  `useSwarm` was never a general-purpose composable. It spoke a private HTTP/SSE
  protocol on `http://127.0.0.1:8791` — the local swarm command-center bus — and
  carried 250 lines of schema validation for that one wire format. `@aihu/use` is
  the library of composables that apply to any aihu app; a client for one
  internal dev tool does not belong in it, and shipping it published a
  maintenance surface no external consumer could use.

  Its only consumer, `apps/swarm-console`, is removed in the same change. That app
  was private, had no moon project, and ran in no CI workflow.

  `@aihu/compiler` and `@aihu/language-server` drop their corresponding registry
  entries, so `useSwarm` no longer appears in auto-import resolution or editor
  hover. Both are minor rather than major: nothing they exported changed shape,
  one row left a lookup table.

### Patch Changes

- Updated dependencies [[`7c3a654`](https://github.com/fellwork/aihu/commit/7c3a654fc7093f12d882c1c643022f0ec1ce8e4e), [`88bbdad`](https://github.com/fellwork/aihu/commit/88bbdad9f57364f160bda7f49c35facf44cf09aa), [`ac9c045`](https://github.com/fellwork/aihu/commit/ac9c04599b2fbf57c9f39a39e1c9db7fe1388028), [`ac9c045`](https://github.com/fellwork/aihu/commit/ac9c04599b2fbf57c9f39a39e1c9db7fe1388028)]:
  - @aihu/compiler@1.2.0
  - @aihu/tsc@0.3.2

## 0.3.5

### Patch Changes

- [#719](https://github.com/fellwork/aihu/pull/719) [`c972073`](https://github.com/fellwork/aihu/commit/c972073efcd9ad94e89923432b435ea1e8de0ffa) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Eliminate the need for a scaffolded `src/main.ts` in the common case, and fix a real typecheck/build divergence uncovered along the way.

  - `@aihu/app`: `viteAihuPlugin()` gained an `aihu-entry` sub-plugin
    (`packages/app/src/entry.ts`) that serves `virtual:aihu-entry` — a
    byte-identical stand-in for the old boilerplate `src/main.ts`
    (`import { createApp } from '@aihu/app/client'; createApp()`) — and
    injects its `<script>` tag into `index.html` whenever no real
    `src/main.ts` exists on disk. A project that needs `createApp(options)`
    (`provide`, `outletId`, a non-default `head`) still writes a real
    `src/main.ts`, which makes the virtual entry step aside entirely (full
    eject, not a partial override — mirrors how framework-owned client entries
    work elsewhere, and keeps `provide` where comparable frameworks keep it:
    code, not declarative config, since it holds live values that can't be
    serialized into generated source).
  - `@aihu/cli`: `appMainTs`/`appIndexHtml` (the `minimal`/`docs` templates)
    stop emitting `src/main.ts` and its `<script>` tag — the virtual entry
    above covers it. `AGENTS.md`'s generated project-map table updated to
    match.
  - `@aihu/compiler`: `compileSidecar()` gained a `target` option
    (`'client' | 'server' | 'universal'`), mirroring what `transform()` already
    passes as `--target`. Previously the sidecar (the type-check surface
    `aihu-tsc` and the language server hand to TypeScript) always compiled
    against the binary's `universal` default regardless of what a project's
    `vite.config.ts` actually configured — a real divergence, since `--target`
    changes what the sidecar is derived from (e.g. a `target: 'client'` build
    elides server-only artifacts). `islands`/`shadowMode` are deliberately NOT
    added here: both are JS-side post-processing on the runtime JS output only
    and have no bearing on the sidecar's types.
  - `@aihu/tsc`: `run()`/`aihu-tsc` now read `AihuConfig.compiler.target` and
    `AihuConfig.typecheck.strictTemplates` from the project's `vite.config.ts`
    (new `loadTscProjectConfig()`, invoked from `bin/aihu-tsc.mjs` since
    `run()` itself stays synchronous) and thread `target` into `compileSidecar`
    — closing the gap above for the common `"typecheck": "aihu-tsc"` scaffold
    script, which is invoked with no flags and had no other way to see that
    config.
  - `@aihu/language-server`: reads the same `compiler.target` from the
    workspace root (best-effort — a client that gives no workspace root, or a
    project with no `vite.config.ts`, behaves exactly as before), so editor
    diagnostics match `aihu-tsc`'s and CI's.

- Updated dependencies [[`c972073`](https://github.com/fellwork/aihu/commit/c972073efcd9ad94e89923432b435ea1e8de0ffa)]:
  - @aihu/tsc@0.3.0
  - @aihu/compiler@1.1.4

## 0.3.4

### Patch Changes

- Updated dependencies [[`9bba4bb`](https://github.com/fellwork/aihu/commit/9bba4bbf177bcd266502ab9181e91478f1710704)]:
  - @aihu/compiler@1.1.3
  - @aihu/tsc@0.2.8

## 0.3.3

### Patch Changes

- Updated dependencies [[`4121604`](https://github.com/fellwork/aihu/commit/4121604dfc1dde1472fd81025f447cfe8ee804b9)]:
  - @aihu/compiler@1.1.2
  - @aihu/tsc@0.2.7

## 0.3.2

### Patch Changes

- Updated dependencies [[`7190b9c`](https://github.com/fellwork/aihu/commit/7190b9c2abb6d7d75473c62b0cae5fe92d39fae3), [`0fe47a9`](https://github.com/fellwork/aihu/commit/0fe47a9e1f686b7da1b863b7b84e1be40501bee1), [`9346b61`](https://github.com/fellwork/aihu/commit/9346b61f3d266805156f93db1415cabbb1ade973), [`3790c91`](https://github.com/fellwork/aihu/commit/3790c91331fa7ecb15649213a66c83078e63dafe), [`c438669`](https://github.com/fellwork/aihu/commit/c4386693ebb1454e2e19094bab15a22157039745), [`549bfc5`](https://github.com/fellwork/aihu/commit/549bfc54020a01b2d10311c7c9b407ea695ef201), [`9d8a49d`](https://github.com/fellwork/aihu/commit/9d8a49db0c31e4a45757f0a645a8dc80c5e370fd)]:
  - @aihu/compiler@1.1.1
  - @aihu/tsc@0.2.6

## 0.3.1

### Patch Changes

- [#515](https://github.com/fellwork/aihu/pull/515) [`8924c51`](https://github.com/fellwork/aihu/commit/8924c51da6e6c25fb2664a7ab6fe9c628895161d) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Retire the `$server` macro and its `createServerCall` client RPC bridge.

  The feature was half-wired and effectively broken: the compiler recognized
  `$server` only as a substring and, on a `--target client` build, emitted a
  `// [client build] $server macro reference elided` comment while leaving the
  `$server.*` reference untouched in the output — no server artifact and no
  `createServerCall` stub were ever generated, so any reference resolved to an
  undefined identifier. The whole surface is removed rather than finished:

  - `@aihu/server`: delete `createServerCall` (`src/client.ts`) and its barrel
    re-export.
  - `@aihu/compiler`: drop the `$server` client-build elision branch from
    `codegen/emit.rs`. A stray `$server` is no longer special-cased — it passes
    through as an ordinary (undefined) identifier and surfaces as a normal
    type-check / runtime error, instead of a misleading "elided" comment.
  - `@aihu/language-server`: remove the `$server` hover entry.
  - Spec: Macro Vocabulary §2.12 marked **RETIRED** (no drop-in replacement).

  Platform binary packages bumped 0.1.24 → 0.1.25 (Rust source changed).

- Updated dependencies [[`68957ca`](https://github.com/fellwork/aihu/commit/68957caa33616b7eee7b05dc55ebd051e603a9fc), [`aac7624`](https://github.com/fellwork/aihu/commit/aac762460619d060e9d1030c86b52231dcb88df3), [`d56a1f5`](https://github.com/fellwork/aihu/commit/d56a1f5569982d30e1924bd48b8cdda8d4ad4e82), [`2ef2830`](https://github.com/fellwork/aihu/commit/2ef2830aa737906d09a5d870176da34a22f20b99), [`8924c51`](https://github.com/fellwork/aihu/commit/8924c51da6e6c25fb2664a7ab6fe9c628895161d), [`061eefb`](https://github.com/fellwork/aihu/commit/061eefb3e94fdbbe9e6f5d5301db3bcdd3fa3b22)]:
  - @aihu/compiler@1.1.0
  - @aihu/tsc@0.2.5

## 0.3.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [[`c3381b9`](https://github.com/fellwork/aihu/commit/c3381b92c3d356d6f78f9db0e8130a9e7a466269), [`30ed2b5`](https://github.com/fellwork/aihu/commit/30ed2b51c215512f840b113afaa1636378e31407), [`2660a52`](https://github.com/fellwork/aihu/commit/2660a52223193eb724450e4b6e9dce32e15ae83b), [`9dd7654`](https://github.com/fellwork/aihu/commit/9dd7654678da1149705e21324f6b30e9baafcd4b), [`a195b80`](https://github.com/fellwork/aihu/commit/a195b8093e639c96b8471ea3567267ca8c11c269), [`dd8cfd6`](https://github.com/fellwork/aihu/commit/dd8cfd639f42ddb05468fe07b6d4f4420a80a8bf), [`80531dc`](https://github.com/fellwork/aihu/commit/80531dcc4dfc43bc9cd399bbb8ab4520efb8f15a), [`0db5827`](https://github.com/fellwork/aihu/commit/0db58275ecabf2d3e49431c810885e1ebfb5a9b6), [`bc0f289`](https://github.com/fellwork/aihu/commit/bc0f289ee38871cda8002e56fba3e3b8b7e34d84)]:
  - @aihu/compiler@1.0.0
  - @aihu/tsc@0.2.4

## 0.2.22

### Patch Changes

- Updated dependencies [[`df40c34`](https://github.com/fellwork/aihu/commit/df40c34526e985ce656a6a5650ac1d83ebef3a80), [`b279f74`](https://github.com/fellwork/aihu/commit/b279f74b34cd4e901be1cfa5d70c212cf604dfc1), [`212e3e3`](https://github.com/fellwork/aihu/commit/212e3e38ae57de7e38c3211ef0223729ba1511e1), [`212e3e3`](https://github.com/fellwork/aihu/commit/212e3e38ae57de7e38c3211ef0223729ba1511e1), [`38652d5`](https://github.com/fellwork/aihu/commit/38652d544fd1001e42d505627de88976d69c1710)]:
  - @aihu/compiler@0.11.0

## 0.2.21

### Patch Changes

- Updated dependencies [[`6334637`](https://github.com/fellwork/aihu/commit/6334637c00e68dec8ba52c6633f229a79fae00a1)]:
  - @aihu/compiler@0.10.2

## 0.2.20

### Patch Changes

- Updated dependencies [[`d6c252f`](https://github.com/fellwork/aihu/commit/d6c252f0cc16ee494c303d83c6e4c19d60c5469a)]:
  - @aihu/compiler@0.10.1

## 0.2.19

### Patch Changes

- Updated dependencies [[`8127925`](https://github.com/fellwork/aihu/commit/8127925482725c8394c03298a27b91cbbfc59418), [`8127925`](https://github.com/fellwork/aihu/commit/8127925482725c8394c03298a27b91cbbfc59418), [`8127925`](https://github.com/fellwork/aihu/commit/8127925482725c8394c03298a27b91cbbfc59418), [`250dbbf`](https://github.com/fellwork/aihu/commit/250dbbf4024f77ddfe41cf9d04b14ad5266ccfee), [`8127925`](https://github.com/fellwork/aihu/commit/8127925482725c8394c03298a27b91cbbfc59418)]:
  - @aihu/compiler@0.10.0

## 0.2.18

### Patch Changes

- Updated dependencies [[`6ff3759`](https://github.com/fellwork/aihu/commit/6ff375925256e5ac7be91a301bb01e9ce2c5e1c9)]:
  - @aihu/compiler@0.9.11

## 0.2.17

### Patch Changes

- Updated dependencies [[`444be87`](https://github.com/fellwork/aihu/commit/444be87ddbabd874fe4479dff260063f8bee8c95)]:
  - @aihu/compiler@0.9.10

## 0.2.16

### Patch Changes

- Updated dependencies [[`6f845bf`](https://github.com/fellwork/aihu/commit/6f845bf56784b188abf3a3cac1df4b6cc31e7c3b)]:
  - @aihu/compiler@0.9.9

## 0.2.15

### Patch Changes

- Updated dependencies [[`0ba842f`](https://github.com/fellwork/aihu/commit/0ba842fa22eb752e71460b369cc99e506f1b9ef0)]:
  - @aihu/compiler@0.9.7

## 0.2.14

### Patch Changes

- Updated dependencies [[`72596d3`](https://github.com/fellwork/aihu/commit/72596d3ae9757fd763bb428628aa594ca414b4a1)]:
  - @aihu/compiler@0.9.6

## 0.2.13

### Patch Changes

- Updated dependencies [[`0775478`](https://github.com/fellwork/aihu/commit/077547892ab14c9bfde96a102fbaab4c30d9dccc)]:
  - @aihu/compiler@0.9.5

## 0.2.12

### Patch Changes

- Updated dependencies [[`63fd311`](https://github.com/fellwork/aihu/commit/63fd3119947cbf0405a371afe099075bcbcac289)]:
  - @aihu/compiler@0.9.4

## 0.2.11

### Patch Changes

- Updated dependencies [[`08ba1a7`](https://github.com/fellwork/aihu/commit/08ba1a7a2fb5cba9f6ce1b4bfddf666264b45277)]:
  - @aihu/compiler@0.9.3

## 0.2.10

### Patch Changes

- Updated dependencies [[`fba3f04`](https://github.com/fellwork/aihu/commit/fba3f04eb986fa0540c1424296b81d75556794ad)]:
  - @aihu/compiler@0.9.2

## 0.2.9

### Patch Changes

- Updated dependencies [[`4306589`](https://github.com/fellwork/aihu/commit/4306589e75aab21d7f6ebc323abc3209091312ce)]:
  - @aihu/compiler@0.9.1

## 0.2.8

### Patch Changes

- Updated dependencies [[`dbc0903`](https://github.com/fellwork/aihu/commit/dbc09031f22ee93d9e5c9a46fea2ca2409463e90)]:
  - @aihu/compiler@0.9.0

## 0.2.7

### Patch Changes

- Updated dependencies [[`e2ba914`](https://github.com/fellwork/aihu/commit/e2ba9143f410196f84501f9386aa69b0729d158f)]:
  - @aihu/compiler@0.8.1

## 0.2.6

### Patch Changes

- Updated dependencies [[`fc5fa49`](https://github.com/fellwork/aihu/commit/fc5fa49688ee8aca8ad5de0a513dca1e648a00f3), [`fb436ac`](https://github.com/fellwork/aihu/commit/fb436ac2a1ecb6f9d570ccc05beeeab666c3ad6d)]:
  - @aihu/compiler@0.8.0

## 0.2.5

### Patch Changes

- Updated dependencies [[`62e2f97`](https://github.com/fellwork/aihu/commit/62e2f9738870e8c28af6221d65f674b259510478)]:
  - @aihu/compiler@0.7.1

## 0.2.4

### Patch Changes

- Updated dependencies [[`eaadd45`](https://github.com/fellwork/aihu/commit/eaadd459118055e422e4ae025ceaa72be39ee17c)]:
  - @aihu/compiler@0.7.0

## 0.2.3

### Patch Changes

- Updated dependencies [[`b85f400`](https://github.com/fellwork/aihu/commit/b85f4008c489a0dba9e36cbdfc48b635eeea375f), [`a54ca1b`](https://github.com/fellwork/aihu/commit/a54ca1b8874583a0301e84c91f2d25713908e41f), [`7ec7155`](https://github.com/fellwork/aihu/commit/7ec71553722eaa4e3f6814e79ec747db68b72451), [`1132357`](https://github.com/fellwork/aihu/commit/113235708bac1e8f9263d35feb865af8f8127f86)]:
  - @aihu/compiler@0.6.0

## 0.2.2

### Patch Changes

- Updated dependencies [[`74273e0`](https://github.com/fellwork/aihu/commit/74273e0a015805f3c878c9b2c7890ed0c80a23fd)]:
  - @aihu/compiler@0.5.4

## 0.2.1

### Patch Changes

- Updated dependencies [[`d42793b`](https://github.com/fellwork/aihu/commit/d42793b8258d723ae7c80179dcc82e2db8d0afc4), [`52a7ee6`](https://github.com/fellwork/aihu/commit/52a7ee600c1f94ac741c01d6d9c0a4a203fc0ef3)]:
  - @aihu/compiler@0.5.3

## 0.2.0

### Minor Changes

- [#239](https://github.com/fellwork/aihu/pull/239) [`60cd922`](https://github.com/fellwork/aihu/commit/60cd92294211596c2091ac7fa27646e553a2f31d) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Migrate language server from vscode-languageserver to @volar/language-server
  (v2.4.28). Adds virtual-file generator for @state block (12 macros), source-map
  module using @volar/source-map Mapping<CodeInformation>, and Volar plugin layer
  (AihuLanguagePlugin + AihuLanguageServicePlugin). All 124 prior tests preserved;
  adds volar-integration.test.ts.

### Patch Changes

- [#248](https://github.com/fellwork/aihu/pull/248) [`950ca3f`](https://github.com/fellwork/aihu/commit/950ca3fa80ae7934dd44075570ac2839a12ae1eb) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Remove unused vscode-languageserver direct deps; add hover-path latency CI gate (p95 < 100ms).

- [#237](https://github.com/fellwork/aihu/pull/237) [`d483902`](https://github.com/fellwork/aihu/commit/d48390269ad858bcd5e09d81ef9c6eec44a9f7d6) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Add hover content for 23 additional macros (final coverage: 36 resolver tokens
  covering all 39 spec forms via dotted-form folding). Extend getMacroAtPosition
  regex set (4 patterns) and getBlockContext to distinguish @style/@agent/@route.
  Add observational latency benchmark scaffold (non-gate).

  Note: $emit hover citation re-pointed to template-syntax-v2 §5; macro-vocabulary
  specs predate template-syntax-v2. Future M3 doc-track item to emit
  macro-vocabulary-v3 incorporating $emit.

- [#239](https://github.com/fellwork/aihu/pull/239) [`60cd922`](https://github.com/fellwork/aihu/commit/60cd92294211596c2091ac7fa27646e553a2f31d) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Wire provideCompletionItems, provideDiagnostics, provideCodeActions into Volar LanguageServicePlugin; add editor configs for Neovim and Helix.

- Updated dependencies [[`6ed33f8`](https://github.com/fellwork/aihu/commit/6ed33f80bfdf193382e9fb1d192c0c1d4e6ef069), [`6ed33f8`](https://github.com/fellwork/aihu/commit/6ed33f80bfdf193382e9fb1d192c0c1d4e6ef069)]:
  - @aihu/compiler@0.5.2

## 0.1.1

### Patch Changes

- Updated dependencies [[`e31df0b`](https://github.com/fellwork/aihu/commit/e31df0bbf43cca38d55528bf31d00088897e5579)]:
  - @aihu/compiler@0.5.1

## 0.1.0

### Minor Changes

- [#210](https://github.com/fellwork/aihu/pull/210) [`5a94420`](https://github.com/fellwork/aihu/commit/5a9442088aff463c287c56c8796c1def120d4441) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Stand up `@aihu/language-server` as a standalone package shipping the runnable
  `aihu-language-server` binary (cross-editor LSP over stdio, arch-4 §2.6). The
  language-server logic — diagnostics bridge (`aihu-compile --machine-errors`),
  the 13-keyword hover table, `$`/`@` completion items, and the C440–C444
  migrate-codemod quick-fix — moves out of the `vscode-aihu` extension into the
  new package, laid out with an editor-agnostic `src/core/` seam (clean adoption
  path for a future `@volar/language-core` layer; Volar itself is NOT adopted yet).

  The `vscode-aihu` extension is reduced to a thin `LanguageClient` that resolves
  and launches the `aihu-language-server` binary; it no longer hosts the server
  inline. Diagnostics/hover/completion/code-action behavior is preserved — the
  ported `lsp-server` test suite stays green. No new LSP features. Build-time /
  editor-tooling package — zero browser-bundle impact (no `.size-limit.json` row).

  Note: `vscode-aihu` is changeset-ignored (published to the VS Code marketplace,
  not npm), so its accompanying client-trim change is versioned manually at
  marketplace-publish time rather than through this changeset.

### Patch Changes

- Updated dependencies [[`574af6d`](https://github.com/fellwork/aihu/commit/574af6d4214889e9b3f7c407a42aa2e53252fddc), [`55298d5`](https://github.com/fellwork/aihu/commit/55298d51f9c6a3723a441d18a71b458e9f2cd035)]:
  - @aihu/compiler@0.5.0
