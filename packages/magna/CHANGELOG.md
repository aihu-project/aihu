# @aihu/magna

## 0.2.8

### Patch Changes

- [#804](https://github.com/aihu-project/aihu/pull/804) [`fc1b270`](https://github.com/aihu-project/aihu/commit/fc1b2705a5c4ff53ab692e83908be780dba8d3ea) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Pass `onX` callback props to child components without treating them as DOM event listeners.
  Make Magna's unpublished GraphQL parser an explicit opt-in so Yarn installs retain
  the documented graceful fallback.

## 0.2.7

### Patch Changes

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Close the prototype-pollution hole in `setBuildFlag()`.

  `setBuildFlag(outputDir, key, value)` splits `key` on `.` and walks the segments
  into `build-flags.json`, creating objects along the way. `key` is a parameter of
  an exported function on a published package. Every caller in this repo passes
  the literal `'magna.untyped'`, but the contract takes an arbitrary string — and
  `setBuildFlag(dir, '__proto__.polluted', v)` walked `cursor.__proto__` straight
  onto `Object.prototype` and assigned there. Verified: `({}).polluted` came back
  `'PWNED'` process-wide, for the rest of the build, for every object in it
  (CodeQL `js/prototype-pollution-utility`).

  The guard is now an inline `===` check on each segment as the walk reaches it,
  rather than an up-front `segments.some(set.has(...))` — same rejection, but it
  sits directly on the control flow that performs the assignment.

  Fixes a second, quieter bug in the same walk. `typeof cursor[seg]` reads
  INHERITED properties, so if anything else in the process had already polluted
  `Object.prototype.magna`, the old code found a truthy object there, declined to
  create an own `magna` key, and merged the flag onto the shared prototype object
  instead — `build-flags.json` was written as `{}` and the untyped flag silently
  never arrived. The descent now uses `Object.hasOwn`, so it stays on own
  properties.

  Also drops a duplicated path recomputation at the end of the function; the
  already-computed `filePath` is the same value.

- Updated dependencies []:
  - @aihu-plugin/data@2.0.5

## 0.2.6

### Patch Changes

- [#715](https://github.com/fellwork/aihu/pull/715) [`9bba4bb`](https://github.com/fellwork/aihu/commit/9bba4bbf177bcd266502ab9181e91478f1710704) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix ReDoS-vulnerable regex patterns and a prototype-pollution gap found by CodeQL code scanning.

  - `@aihu/app`: `applyHeadConfig`'s `<meta>`-tag matching no longer uses a
    `\s+[^>]*attr...[^>]*` nested-quantifier regex over the whole `index.html`
    string (catastrophic backtracking on pathological/repetitive input) — it
    now scans tag boundaries with one unambiguous pass, then tests the
    attribute within just that bounded tag.
  - `@aihu/router`: the file-router's segment builder no longer strips a
    route's extension with a `\.[^/]+$/`-anchored regex (same backtracking
    class) — a plain `lastIndexOf`-based split instead.
  - `@aihu/compiler`: `_isLayoutFile`'s trailing-slash trim no longer uses a
    `\/+$/`-anchored regex — measured 45s on a 200k-character pathological
    input before the fix, sub-millisecond after. The state-wrapper codemod
    (`migrate.ts`/`verify.ts`) also now fully escapes identifiers before
    embedding them into `RegExp` constructors (previously escaped only `$`).
  - `@aihu/cli`: the `full` template's scaffolded `server.ts` had the same
    trailing-slash ReDoS shape in a generated string — fixed so scaffolded
    apps don't inherit it.
  - `@aihu/magna`: `setBuildFlag` (a public function accepting an arbitrary
    dot-notation key) now rejects `__proto__`/`constructor`/`prototype`
    segments, closing a prototype-pollution gap in its public contract.

## 0.2.5

### Patch Changes

- Updated dependencies [[`ad6921a`](https://github.com/fellwork/aihu/commit/ad6921a018ef4a479f6540278e549aa9a8cab387)]:
  - @aihu/signals@0.5.0
  - @aihu-plugin/data@2.0.5

## 0.2.4

### Patch Changes

- Updated dependencies [[`18e5f6d`](https://github.com/fellwork/aihu/commit/18e5f6dda93772877690e88e8c217dcdcf4bddc2), [`ea8d2eb`](https://github.com/fellwork/aihu/commit/ea8d2ebb91c28132f399a708e2bd88877072d1db)]:
  - @aihu/signals@0.4.0
  - @aihu-plugin/data@2.0.4

## 0.2.3

### Patch Changes

- Updated dependencies [[`80531dc`](https://github.com/fellwork/aihu/commit/80531dcc4dfc43bc9cd399bbb8ab4520efb8f15a)]:
  - @aihu-plugin/data@2.0.3

## 0.2.2

### Patch Changes

- Updated dependencies [[`b279f74`](https://github.com/fellwork/aihu/commit/b279f74b34cd4e901be1cfa5d70c212cf604dfc1), [`8c80d98`](https://github.com/fellwork/aihu/commit/8c80d9844503c248ecf5fb2c0b3ec5ab06128d5e), [`514336d`](https://github.com/fellwork/aihu/commit/514336da5892c29e9e02d7a6391bb06c62d688c3)]:
  - @aihu/context@0.2.0
  - @aihu/signals@0.3.0
  - @aihu-plugin/data@2.0.2

## 0.2.1

### Patch Changes

- Updated dependencies [[`b85f400`](https://github.com/fellwork/aihu/commit/b85f4008c489a0dba9e36cbdfc48b635eeea375f)]:
  - @aihu/signals@0.2.0
  - @aihu-plugin/data@2.0.1

## 0.2.0

### Minor Changes

- [#241](https://github.com/fellwork/aihu/pull/241) [`ca3431c`](https://github.com/fellwork/aihu/commit/ca3431cd53fe6af284272f1c33ec845014a7baca) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Add @aihu/magna greenfield package skeleton: dep-free GraphQL fetch, resource composition over @aihu-plugin/data, JWT relay via getToken config, and a beforeCompile SDL pipeline with graceful skip when magna-gqlmin is absent.

  Add @aihu/auth size-limit row (pre-existing gap fix — v0.1.1 shipped browser code without a budget row).
