# create-aihu

## 0.1.12

### Patch Changes

- Updated dependencies [[`b9c6afd`](https://github.com/aihu-project/aihu/commit/b9c6afda840b3e3426d2023ee603b92c3bfe1993), [`95bf123`](https://github.com/aihu-project/aihu/commit/95bf1232ce3df85a5b4b373b79d760aba098d46b)]:
  - @aihu/cli@1.3.1

## 0.1.11

### Patch Changes

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Export `@aihu/cli/template-manifest`, and declare the Node floor both bins require.

  `@aihu/templates-cf-team` imports `import type { TemplateManifest } from
'@aihu/cli/template-manifest'` — the documented contract between the CLI and
  every template package (arch-6 §2.3) — but `@aihu/cli`'s `exports` map had no
  such subpath. It only worked because cf-team's `tsconfig.json` hand-maps the
  specifier to the CLI's source file for local typechecking; a real npm consumer
  typechecking the published template package hit `ERR_PACKAGE_PATH_NOT_EXPORTED`.
  Compounding it, cf-team declared `"dependencies": {}` / `"devDependencies": {}`,
  so `@aihu/cli` was not a declared dependency at all.

  The subpath is now a real export backed by its own build entry
  (`dist/template-manifest.{js,d.ts}`), and cf-team declares `@aihu/cli` as a
  devDependency. The tsconfig `paths` mapping stays so in-repo `moon run :typecheck`
  does not require the CLI to be built first.

  Both `@aihu/cli` and `create-aihu` now declare `"engines": { "node": ">=20.6.0" }`.
  `scaffold-pipeline.ts` calls `import.meta.resolve` synchronously and
  `create-aihu/bin.mjs` calls it unconditionally — both Node 20.6+ only — and
  neither package said so, unlike `@aihu/agent-server`, `@aihu/language-server` and
  `@aihu/server`, which all carry an `engines` field.

  Also removes three dead modules — `src/commands/{page,component,plugin}.ts` —
  drifted duplicates of the live `scaffoldPage`/`scaffoldComponent`/`scaffoldPlugin`
  in `src/index.ts` that `bin.ts` actually imports. Nothing referenced them; they
  had different signatures and different output, so the risk was a future edit
  landing in the copy that never runs.

- Updated dependencies [[`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce)]:
  - @aihu/cli@1.3.0

## 0.1.10

### Patch Changes

- Updated dependencies [[`c972073`](https://github.com/fellwork/aihu/commit/c972073efcd9ad94e89923432b435ea1e8de0ffa)]:
  - @aihu/cli@1.2.0

## 0.1.9

### Patch Changes

- Updated dependencies [[`44698e0`](https://github.com/fellwork/aihu/commit/44698e0e7085bf40939a8543f4df751386bf7d2d), [`9bba4bb`](https://github.com/fellwork/aihu/commit/9bba4bbf177bcd266502ab9181e91478f1710704)]:
  - @aihu/cli@1.1.2

## 0.1.8

### Patch Changes

- Updated dependencies [[`65fac84`](https://github.com/fellwork/aihu/commit/65fac84c220c16f5d7488dca58651104dbd45180)]:
  - @aihu/cli@1.1.1

## 0.1.7

### Patch Changes

- [#603](https://github.com/fellwork/aihu/pull/603) [`37b1403`](https://github.com/fellwork/aihu/commit/37b14030de6111839ea2d509a1c5b23bf1a39517) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix `pnpm create aihu` and `yarn create aihu` failing on every template.

  `bin.mjs` resolved the delegate with `createRequire(import.meta.url).resolve('@aihu/cli')`
  — a CJS resolution against a package whose exports map declares only `types`
  and `import`. With no `require` condition, Node's CJS resolver cannot satisfy
  it:

  ```
  Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in
    .../create-aihu@0.1.6/node_modules/@aihu/cli/package.json
  ```

  Every pnpm and yarn scaffold hit this, including `--template minimal`. npm and
  bun happened to mask it through hoisting rather than avoid it.

  Switched to `import.meta.resolve()`, which honours the `import` condition. The
  file was already ESM and already used `import.meta.url`, so the native resolver
  was available the whole time.

  Verified minimally against a synthetic ESM-only exports map:
  `require.resolve()` exits 1 with ERR_PACKAGE_PATH_NOT_EXPORTED;
  `import.meta.resolve()` exits 0 and runs the delegate.

- Updated dependencies [[`5720298`](https://github.com/fellwork/aihu/commit/572029884dca3bc381f09936431afcd28ae989f3), [`8aa12dc`](https://github.com/fellwork/aihu/commit/8aa12dc1412125635880b09fe7b8f8a36fb6c7a4), [`2dff3b5`](https://github.com/fellwork/aihu/commit/2dff3b5df8d8cead0e14446e9c4bbbc0cbc9d747), [`c8c1d71`](https://github.com/fellwork/aihu/commit/c8c1d714a9a221708ab6db3399c1e6e13d63f7ab), [`2dff3b5`](https://github.com/fellwork/aihu/commit/2dff3b5df8d8cead0e14446e9c4bbbc0cbc9d747), [`bef4c66`](https://github.com/fellwork/aihu/commit/bef4c66fb59c8d9224d131e158106713cdb0da05), [`3ed4072`](https://github.com/fellwork/aihu/commit/3ed407299c68644cb522d919204b4f4a3f96025e), [`9286182`](https://github.com/fellwork/aihu/commit/9286182f38211a61344d46d9a38ef4821605bf93)]:
  - @aihu/cli@1.1.0

## 0.1.6

### Patch Changes

- Updated dependencies []:
  - @aihu/cli@1.0.1

## 0.1.5

### Patch Changes

- Updated dependencies [[`9dd7654`](https://github.com/fellwork/aihu/commit/9dd7654678da1149705e21324f6b30e9baafcd4b), [`dd8cfd6`](https://github.com/fellwork/aihu/commit/dd8cfd639f42ddb05468fe07b6d4f4420a80a8bf), [`80531dc`](https://github.com/fellwork/aihu/commit/80531dcc4dfc43bc9cd399bbb8ab4520efb8f15a)]:
  - @aihu/cli@1.0.0

## 0.1.4

### Patch Changes

- Updated dependencies [[`8127925`](https://github.com/fellwork/aihu/commit/8127925482725c8394c03298a27b91cbbfc59418)]:
  - @aihu/cli@0.8.3

## 0.1.3

### Patch Changes

- Updated dependencies [[`ce3b9a9`](https://github.com/fellwork/aihu/commit/ce3b9a9de72bc2439294df4089d430e8220fc388)]:
  - @aihu/cli@0.8.2

## 0.1.2

### Patch Changes

- [#376](https://github.com/fellwork/aihu/pull/376) [`d48a7ad`](https://github.com/fellwork/aihu/commit/d48a7ad12851ee30b869ee5f8f234038d97c9aff) Thanks [@srmcguirt](https://github.com/srmcguirt)! - fix(create-aihu): pin `@aihu/cli` to a caret that tracks this release

  `create-aihu@0.1.1` froze an exact `@aihu/cli@0.7.0` dependency — a stale
  `bun.lock`-resolved pin baked by `bun pm pack` at publish time (the changesets
  Version PR bumps `package.json` but not `bun.lock`). Because the `agent`
  template was added in `cli@0.8.0`, `npx create-aihu@latest --template agent`
  resolved a cli with no agent template and failed. `publish-all.sh` now stamps
  the `@aihu/cli` dependency from the live cli package version (`^x.y.z`) before
  packing, so the delegator always resolves a cli that carries the current
  templates regardless of lock state.

- Updated dependencies [[`d48a7ad`](https://github.com/fellwork/aihu/commit/d48a7ad12851ee30b869ee5f8f234038d97c9aff)]:
  - @aihu/cli@0.8.1

## 0.1.1

### Patch Changes

- Updated dependencies [[`6a0d8e4`](https://github.com/fellwork/aihu/commit/6a0d8e426fa2ab53c37fa5d1d4e6ae63ca671e0d), [`6a0d8e4`](https://github.com/fellwork/aihu/commit/6a0d8e426fa2ab53c37fa5d1d4e6ae63ca671e0d)]:
  - @aihu/cli@0.8.0

## 0.1.0

### Minor Changes

- [#371](https://github.com/fellwork/aihu/pull/371) [`e9ddb91`](https://github.com/fellwork/aihu/commit/e9ddb910422b5f14dbf5f8ecd7e449789f4cf30d) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Add the `create-aihu` entry-point package so `npm create aihu` / `npx create-aihu` / `bun create aihu` resolve on npm (previously 404). Thin delegator to @aihu/cli's scaffolder.
