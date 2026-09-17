# @aihu/tsc

## 0.3.4

### Patch Changes

- [#810](https://github.com/aihu-project/aihu/pull/810) [`37a0a2e`](https://github.com/aihu-project/aihu/commit/37a0a2e83611c7654c41e43dce1ac930a23698be) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Resolve compiler integrations through the published `@aihu/compiler` package instead of the monorepo source tree. `@aihu/app` now declares the compiler as a runtime dependency so its public Vite integration installs correctly for consumers.

## 0.3.3

### Patch Changes

- Updated dependencies [[`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88), [`11888ba`](https://github.com/fellwork/aihu/commit/11888ba342d04b49b18abc5f5b17da56f604a0a7), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`9e198d6`](https://github.com/fellwork/aihu/commit/9e198d6e5cc7211496335d47e1429f1f82f0a940), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`ac3affc`](https://github.com/fellwork/aihu/commit/ac3affc4cb27bae5af0ebbf84c1fd70b800d9ac8), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`ff58a1b`](https://github.com/fellwork/aihu/commit/ff58a1b8d9018f0198aa8879c359e90133266b2f), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88)]:
  - @aihu/compiler@1.3.0

## 0.3.2

### Patch Changes

- Updated dependencies [[`7c3a654`](https://github.com/fellwork/aihu/commit/7c3a654fc7093f12d882c1c643022f0ec1ce8e4e), [`88bbdad`](https://github.com/fellwork/aihu/commit/88bbdad9f57364f160bda7f49c35facf44cf09aa), [`ac9c045`](https://github.com/fellwork/aihu/commit/ac9c04599b2fbf57c9f39a39e1c9db7fe1388028), [`ac9c045`](https://github.com/fellwork/aihu/commit/ac9c04599b2fbf57c9f39a39e1c9db7fe1388028)]:
  - @aihu/compiler@1.2.0

## 0.3.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [[`c972073`](https://github.com/fellwork/aihu/commit/c972073efcd9ad94e89923432b435ea1e8de0ffa)]:
  - @aihu/compiler@1.1.4

## 0.2.8

### Patch Changes

- Updated dependencies [[`9bba4bb`](https://github.com/fellwork/aihu/commit/9bba4bbf177bcd266502ab9181e91478f1710704)]:
  - @aihu/compiler@1.1.3

## 0.2.7

### Patch Changes

- Updated dependencies [[`4121604`](https://github.com/fellwork/aihu/commit/4121604dfc1dde1472fd81025f447cfe8ee804b9)]:
  - @aihu/compiler@1.1.2

## 0.2.6

### Patch Changes

- Updated dependencies [[`7190b9c`](https://github.com/fellwork/aihu/commit/7190b9c2abb6d7d75473c62b0cae5fe92d39fae3), [`0fe47a9`](https://github.com/fellwork/aihu/commit/0fe47a9e1f686b7da1b863b7b84e1be40501bee1), [`9346b61`](https://github.com/fellwork/aihu/commit/9346b61f3d266805156f93db1415cabbb1ade973), [`3790c91`](https://github.com/fellwork/aihu/commit/3790c91331fa7ecb15649213a66c83078e63dafe), [`c438669`](https://github.com/fellwork/aihu/commit/c4386693ebb1454e2e19094bab15a22157039745), [`549bfc5`](https://github.com/fellwork/aihu/commit/549bfc54020a01b2d10311c7c9b407ea695ef201), [`9d8a49d`](https://github.com/fellwork/aihu/commit/9d8a49db0c31e4a45757f0a645a8dc80c5e370fd)]:
  - @aihu/compiler@1.1.1

## 0.2.5

### Patch Changes

- Updated dependencies [[`68957ca`](https://github.com/fellwork/aihu/commit/68957caa33616b7eee7b05dc55ebd051e603a9fc), [`aac7624`](https://github.com/fellwork/aihu/commit/aac762460619d060e9d1030c86b52231dcb88df3), [`d56a1f5`](https://github.com/fellwork/aihu/commit/d56a1f5569982d30e1924bd48b8cdda8d4ad4e82), [`2ef2830`](https://github.com/fellwork/aihu/commit/2ef2830aa737906d09a5d870176da34a22f20b99), [`8924c51`](https://github.com/fellwork/aihu/commit/8924c51da6e6c25fb2664a7ab6fe9c628895161d), [`061eefb`](https://github.com/fellwork/aihu/commit/061eefb3e94fdbbe9e6f5d5301db3bcdd3fa3b22)]:
  - @aihu/compiler@1.1.0

## 0.2.4

### Patch Changes

- [#505](https://github.com/fellwork/aihu/pull/505) [`dd8cfd6`](https://github.com/fellwork/aihu/commit/dd8cfd639f42ddb05468fe07b6d4f4420a80a8bf) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix the codemod and sidecar defects surfaced by the v2 canary migration
  ([#502](https://github.com/fellwork/aihu/issues/502), [#503](https://github.com/fellwork/aihu/issues/503), [#504](https://github.com/fellwork/aihu/issues/504)).

  - `aihu migrate` (macro-simplification): consume a multi-line `import { … }`
    as a single statement so its members are no longer orphaned below the
    closing brace and single-line imports are no longer hoisted into the open
    brace (the import-scrambling defect).
  - `aihu migrate --state` (state-wrapper): de-call prop reads (`name()` →
    `name`) after `$prop` → `prop()`, since `prop()` returns a value in the
    wrapper model rather than a callable signal.
  - `aihu migrate --v2` (template-grammar): accept the dot spelling
    `$class.modifier` in addition to `$class:modifier`.
  - Type-check sidecar: `__aihu_each` over an `any` iterable now types loop
    bindings as `any` instead of `unknown` (one conditional-typed generic with
    an IsAny guard).
  - `aihu-tsc`: surface the first real compile error when a file cannot be
    compiled (a stale-compiler error immediately reveals a version mismatch),
    and document version-aligning `@aihu/tsc` with `@aihu/compiler`.

- Updated dependencies [[`c3381b9`](https://github.com/fellwork/aihu/commit/c3381b92c3d356d6f78f9db0e8130a9e7a466269), [`30ed2b5`](https://github.com/fellwork/aihu/commit/30ed2b51c215512f840b113afaa1636378e31407), [`2660a52`](https://github.com/fellwork/aihu/commit/2660a52223193eb724450e4b6e9dce32e15ae83b), [`9dd7654`](https://github.com/fellwork/aihu/commit/9dd7654678da1149705e21324f6b30e9baafcd4b), [`a195b80`](https://github.com/fellwork/aihu/commit/a195b8093e639c96b8471ea3567267ca8c11c269), [`dd8cfd6`](https://github.com/fellwork/aihu/commit/dd8cfd639f42ddb05468fe07b6d4f4420a80a8bf), [`80531dc`](https://github.com/fellwork/aihu/commit/80531dcc4dfc43bc9cd399bbb8ab4520efb8f15a), [`0db5827`](https://github.com/fellwork/aihu/commit/0db58275ecabf2d3e49431c810885e1ebfb5a9b6), [`bc0f289`](https://github.com/fellwork/aihu/commit/bc0f289ee38871cda8002e56fba3e3b8b7e34d84)]:
  - @aihu/compiler@1.0.0

## 0.2.3

### Patch Changes

- Updated dependencies [[`df40c34`](https://github.com/fellwork/aihu/commit/df40c34526e985ce656a6a5650ac1d83ebef3a80), [`b279f74`](https://github.com/fellwork/aihu/commit/b279f74b34cd4e901be1cfa5d70c212cf604dfc1), [`212e3e3`](https://github.com/fellwork/aihu/commit/212e3e38ae57de7e38c3211ef0223729ba1511e1), [`212e3e3`](https://github.com/fellwork/aihu/commit/212e3e38ae57de7e38c3211ef0223729ba1511e1), [`38652d5`](https://github.com/fellwork/aihu/commit/38652d544fd1001e42d505627de88976d69c1710)]:
  - @aihu/compiler@0.11.0

## 0.2.2

### Patch Changes

- Updated dependencies [[`6334637`](https://github.com/fellwork/aihu/commit/6334637c00e68dec8ba52c6633f229a79fae00a1)]:
  - @aihu/compiler@0.10.2

## 0.2.1

### Patch Changes

- Updated dependencies [[`d6c252f`](https://github.com/fellwork/aihu/commit/d6c252f0cc16ee494c303d83c6e4c19d60c5469a)]:
  - @aihu/compiler@0.10.1

## 0.2.0

### Minor Changes

- [#395](https://github.com/fellwork/aihu/pull/395) [`8127925`](https://github.com/fellwork/aihu/commit/8127925482725c8394c03298a27b91cbbfc59418) Thanks [@srmcguirt](https://github.com/srmcguirt)! - **`.aihu` files are now type-checked.** They were not before — at all.

  The type-check sidecar declared every template-referenced binding as an `any`
  parameter and never emitted the `@state` body, so TypeScript was handed a file
  that could not disagree with the author about anything. A `const x: number =
'a string'` inside `@state`, or a typo'd property, passed `tsc --noEmit` clean.
  The green check was over code TypeScript had never seen.

  Two things change:

  **`@aihu/compiler`** now inlines the `@state` body into the type-check surface, at
  its real source lines. Bindings carry their true types instead of `any`, imports
  resolve so call sites are checked, and a diagnostic inside `@state` cites the
  `.aihu` line the author wrote it on. Only loop aliases remain `any` — `{#each xs
as m}` binds `m` in the template, so there is no declaration to borrow a type
  from.

  **`@aihu/tsc`** (new) provides `aihu-tsc`, which projects each `.aihu` into the
  TypeScript program as a VIRTUAL file via Volar's `proxyCreateProgram`. No
  `.aihu.ts` sidecar is written to disk any more: the Vite plugin no longer emits
  them, and consumers can delete the ones they have and drop `*.aihu.ts` from
  `.gitignore`.

  **Migration.** Replace `tsc --noEmit` with `aihu-tsc` in your `typecheck` script
  (`@aihu/cli` now scaffolds this for new projects). Plain `tsc` cannot see inside a
  `.aihu` file, so it will keep reporting a clean pass over every SFC in your
  project without having checked one.

  Expect real diagnostics the first time you run it — this is code that has never
  been type-checked. Implicit-`any` inside `.aihu` files is suppressed by default,
  since no corpus has ever been annotated for it; `aihu-tsc --strict-templates`
  turns it on.

### Patch Changes

- Updated dependencies [[`8127925`](https://github.com/fellwork/aihu/commit/8127925482725c8394c03298a27b91cbbfc59418), [`8127925`](https://github.com/fellwork/aihu/commit/8127925482725c8394c03298a27b91cbbfc59418), [`8127925`](https://github.com/fellwork/aihu/commit/8127925482725c8394c03298a27b91cbbfc59418), [`250dbbf`](https://github.com/fellwork/aihu/commit/250dbbf4024f77ddfe41cf9d04b14ad5266ccfee), [`8127925`](https://github.com/fellwork/aihu/commit/8127925482725c8394c03298a27b91cbbfc59418)]:
  - @aihu/compiler@0.10.0
