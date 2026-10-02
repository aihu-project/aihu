# @aihu-plugin/drizzle

## 0.1.8

### Patch Changes

- Updated dependencies []:
  - @aihu/server@0.6.2

## 0.1.7

### Patch Changes

- Updated dependencies [[`a40aba7`](https://github.com/aihu-project/aihu/commit/a40aba75cd95539427e42a4cc0686c4f4e63c6e3), [`04da84c`](https://github.com/aihu-project/aihu/commit/04da84ca60390fb7198588afe3a5872ab134defe)]:
  - @aihu/server@0.6.1

## 0.1.6

### Patch Changes

- Updated dependencies [[`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`788319c`](https://github.com/fellwork/aihu/commit/788319ca907d9a34ec83c7af655436555a42b4c0), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`ff58a1b`](https://github.com/fellwork/aihu/commit/ff58a1b8d9018f0198aa8879c359e90133266b2f), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf), [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88), [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88), [`9df850b`](https://github.com/fellwork/aihu/commit/9df850b3d0f93d1fa752cbbeb3038a831cf15edf)]:
  - @aihu/server@0.6.0

## 0.1.5

### Patch Changes

- Updated dependencies [[`ac9c045`](https://github.com/fellwork/aihu/commit/ac9c04599b2fbf57c9f39a39e1c9db7fe1388028)]:
  - @aihu/server@0.5.0

## 0.1.4

### Patch Changes

- Updated dependencies []:
  - @aihu/server@0.4.1

## 0.1.3

### Patch Changes

- Updated dependencies [[`2ef2830`](https://github.com/fellwork/aihu/commit/2ef2830aa737906d09a5d870176da34a22f20b99), [`8924c51`](https://github.com/fellwork/aihu/commit/8924c51da6e6c25fb2664a7ab6fe9c628895161d), [`27a3268`](https://github.com/fellwork/aihu/commit/27a326826ee9a4d0a9b46bf50ca31686543848fe), [`061eefb`](https://github.com/fellwork/aihu/commit/061eefb3e94fdbbe9e6f5d5301db3bcdd3fa3b22)]:
  - @aihu/server@0.4.0

## 0.1.2

### Patch Changes

- Updated dependencies [[`bc0f289`](https://github.com/fellwork/aihu/commit/bc0f289ee38871cda8002e56fba3e3b8b7e34d84)]:
  - @aihu/server@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`5a94938`](https://github.com/fellwork/aihu/commit/5a949381544afd8276a0f6f5dba10cc4561b1d1a)]:
  - @aihu/server@0.2.1

## 0.1.0

### Minor Changes

- [#208](https://github.com/fellwork/aihu/pull/208) [`f2f9b22`](https://github.com/fellwork/aihu/commit/f2f9b2249c7b8256016e61b4cbc091d87a57980f) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Add `@aihu-plugin/drizzle` — a server-only Drizzle ORM data adapter.

  `createDrizzleResource(db, queryFn, options?)` produces a
  `(key: string) => Promise<T>` fetcher compatible with `@aihu-plugin/data`'s
  `createResource`, and `drizzleLoader(db, queryFn)` produces a `DefinedLoader`
  for `@aihu/server`'s `defineLoader` / `defineRoute`. Works with Postgres,
  SQLite, and libSQL/Turso handles. `drizzle-orm` and its drivers are OPTIONAL
  peer dependencies referenced via `import type` only, so importing the package
  never breaks when no Drizzle peer is installed. Ships a no-op registration
  shim (`drizzle()` → `Plugin`, `serverOnly: true`) per the Plugin Contract.

### Patch Changes

- Updated dependencies [[`f2005e2`](https://github.com/fellwork/aihu/commit/f2005e222bc720a8cbc69ed81cfafa0cab8d8ced), [`90d3174`](https://github.com/fellwork/aihu/commit/90d3174896ee03cf1756f5b92d125be45d13983f)]:
  - @aihu/server@0.2.0
