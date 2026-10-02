# @aihu/seo

## 1.0.6

### Patch Changes

- Updated dependencies [[`a40aba7`](https://github.com/aihu-project/aihu/commit/a40aba75cd95539427e42a4cc0686c4f4e63c6e3), [`04da84c`](https://github.com/aihu-project/aihu/commit/04da84ca60390fb7198588afe3a5872ab134defe)]:
  - @aihu/plugin@0.1.2
  - @aihu/server@0.6.1
  - @aihu-plugin/agent-readiness@2.4.0

## 1.0.5

### Patch Changes

- Updated dependencies [[`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`788319c`](https://github.com/fellwork/aihu/commit/788319ca907d9a34ec83c7af655436555a42b4c0), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`ff58a1b`](https://github.com/fellwork/aihu/commit/ff58a1b8d9018f0198aa8879c359e90133266b2f), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88), [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf)]:
  - @aihu/server@0.6.0
  - @aihu-plugin/agent-readiness@2.3.0

## 1.0.4

### Patch Changes

- Updated dependencies [[`ac9c045`](https://github.com/fellwork/aihu/commit/ac9c04599b2fbf57c9f39a39e1c9db7fe1388028)]:
  - @aihu/server@0.5.0
  - @aihu-plugin/agent-readiness@2.2.3

## 1.0.3

### Patch Changes

- Updated dependencies []:
  - @aihu/server@0.4.1
  - @aihu-plugin/agent-readiness@2.2.2

## 1.0.2

### Patch Changes

- Updated dependencies [[`2ef2830`](https://github.com/fellwork/aihu/commit/2ef2830aa737906d09a5d870176da34a22f20b99), [`8924c51`](https://github.com/fellwork/aihu/commit/8924c51da6e6c25fb2664a7ab6fe9c628895161d), [`27a3268`](https://github.com/fellwork/aihu/commit/27a326826ee9a4d0a9b46bf50ca31686543848fe), [`061eefb`](https://github.com/fellwork/aihu/commit/061eefb3e94fdbbe9e6f5d5301db3bcdd3fa3b22)]:
  - @aihu/server@0.4.0
  - @aihu-plugin/agent-readiness@2.2.1

## 1.0.1

### Patch Changes

- Updated dependencies [[`549448c`](https://github.com/fellwork/aihu/commit/549448cd042ba89b94ddb291be741f015c3d0d9c), [`bc0f289`](https://github.com/fellwork/aihu/commit/bc0f289ee38871cda8002e56fba3e3b8b7e34d84)]:
  - @aihu-plugin/agent-readiness@2.2.0
  - @aihu/server@0.3.0

## 1.0.0

### Major Changes

- [#430](https://github.com/fellwork/aihu/issues/430) Consolidate `@aihu/seo` into `@aihu-plugin/agent-readiness`. This package is now a DEPRECATED thin shim (the name is kept for discoverability):
  - `createSeoRoutes` delegates to the sibling's generators — the sitemap now XML-escapes URLs (previously a path containing `&` produced invalid XML).
  - `seoLlmsSections` and the JSON-LD capability (`JsonLdPage`, `generateJsonLd`) are ported into `@aihu-plugin/agent-readiness`; `seoLlmsSections` and `JsonLdPage` are re-exported here.
  - BREAKING (behavioral): with `robotsOptions.disallowAiBots` ABSENT, `createSeoRoutes` still behaves as its historical block-all default (`deny-all`) — no silent robots.txt flip — but now emits a deprecation warning asking you to state your choice in the new `aiAgents` vocabulary. Explicit `disallowAiBots: true` → `'deny-all'` and `false` → `'allow-all'` map unchanged, forever.
  - All exports carry `@deprecated` JSDoc pointing at their `@aihu-plugin/agent-readiness` replacements.

### Patch Changes

- Updated dependencies:
  - @aihu-plugin/agent-readiness@2.1.0

## 0.2.1

### Patch Changes

- Updated dependencies [[`5a94938`](https://github.com/fellwork/aihu/commit/5a949381544afd8276a0f6f5dba10cc4561b1d1a)]:
  - @aihu/server@0.2.1
  - @aihu-plugin/agent-readiness@2.0.4

## 0.2.0

### Minor Changes

- [#240](https://github.com/fellwork/aihu/pull/240) [`9482565`](https://github.com/fellwork/aihu/commit/9482565293cb0998dcae15eb1f3c5b9aa20db9be) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Add @aihu/seo greenfield package: sitemap.xml, robots.txt, llms.txt, and JSON-LD injection via afterParse hook. Exports seoLlmsSections() for composition with @aihu-plugin/agent-readiness.
