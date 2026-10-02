# @aihu/use

## 2.1.0

### Minor Changes

- [#899](https://github.com/aihu-project/aihu/pull/899) [`0222a00`](https://github.com/aihu-project/aihu/commit/0222a00a76f57aa44548187a97afac89844cc398) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Add `createFocusTrap` for accessible dialog focus management, using the shared primitives focus trap.

## 2.0.0

### Patch Changes

- Updated dependencies [[`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88), [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88), [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce), [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88), [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88), [`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88)]:
  - @aihu/router@0.5.0

## 1.0.0

### Major Changes

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

- Updated dependencies []:
  - @aihu/router@0.4.4

## 0.5.1

### Patch Changes

- Updated dependencies [[`9bba4bb`](https://github.com/fellwork/aihu/commit/9bba4bbf177bcd266502ab9181e91478f1710704)]:
  - @aihu/router@0.4.3

## 0.5.0

### Minor Changes

- [#652](https://github.com/fellwork/aihu/pull/652) [`4121604`](https://github.com/fellwork/aihu/commit/4121604dfc1dde1472fd81025f447cfe8ee804b9) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Two compiler correctness fixes and the new `useSwarm` composable.

  **`@aihu/compiler` (patch)**

  - **FEL-440** — agent registration is now a codegen _input_ rather than
    post-hoc string surgery on the emitted JS. The old path matched a literal
    runtime-import string and silently returned the input unchanged when it did
    not match, so a component whose imports differed at all shipped with its
    agent surface quietly missing. A registration that cannot be applied is now
    a compile-time fact, not a silent no-op.
  - **FEL-441** — `$ref` `onMount` callbacks are hoisted ahead of `@state`
    `onMount` callbacks, so a `ref={}` read inside a `@state` mount handler is
    populated instead of `null`. The ordering was previously incidental.

  Both fixes require the platform binary packages, so `@aihu/compiler-*` moves to
  0.1.40 and `@aihu/compiler-native-*` to 0.1.5 in lockstep — the FEL-414 rule
  that an unbumped manifest is silently never published.

  **`@aihu/use` (minor)**

  - New `useSwarm()` composable: a reactive view over a Server-Sent Events
    stream, exposing `state`, `agents`, `contracts`, `yourMove`, `connected` and
    `close`. Follows the ratified named-getter convention and the `isClient`
    no-op invariant — under SSR it returns static defaults and **never**
    constructs an `EventSource`, which is covered by a paired must-fail test
    rather than asserted. Byte-budgeted at 610 B (measured 574 B gzipped).

## 0.4.0

### Minor Changes

- [#541](https://github.com/fellwork/aihu/pull/541) [`549bfc5`](https://github.com/fellwork/aihu/commit/549bfc54020a01b2d10311c7c9b407ea695ef201) Thanks [@srmcguirt](https://github.com/srmcguirt)! - feat(use): namespace subpaths (`/math`, `/motion`, `/integrations`, `/router`) + Wave 0 gate infrastructure

  `@aihu/use` becomes a namespace: the CORE surface (bare `@aihu/use` + its
  per-composable subpaths) stays dependency-free (signals-only), while new
  FAMILY subpaths may declare optional peer dependencies
  (`peerDependenciesMeta.optional`), isolated per-composable entry so a
  consumer who never imports a family never resolves its peers.

  New family subpaths (additive, purely opt-in):

  - `@aihu/use/math` — dep-free pure computed derivations (seeded by `useClamp`)
  - `@aihu/use/motion` — reduced-motion/spring-style primitives (seeded by
    `useReducedMotion`)
  - `@aihu/use/integrations` — third-party wrappers behind optional peers
    (seeded by `useJwt`, optional peer `jwt-decode`)
  - `@aihu/use/router` — router composables behind optional peers on
    `@aihu/router` + `@aihu/context` (seeded by `useRouteParams`)

  `packages/use/families.json` is the new single source of truth for family
  shape (aggregate/autoImport/size budgets/peer map), enforced by:

  - `scripts/dep-check.ts`'s `checkUseSubpathPurity` — walks each rolldown
    entry's reachable-file graph and proves CORE reaches `@aihu/signals` only
    (never a family file), and a family entry reaches only its own
    `families.json`-declared peers (never another family's files or an
    un-declared peer).
  - `scripts/check-use-registry-parity.ts` — family-aware six-touch-point
    parity (barrel export, package.json exports key, rolldown input,
    `.size-limit.json` row, `USE_COMPOSABLES` tuple where `autoImport: true`,
    aggregate-barrel invariants).
  - `scripts/gen-use.ts` — the scaffolder gains `--family` support, patching
    all of the above consistently for a new family member.

  `packages/compiler/src/codegen/use_registry.rs`'s `USE_COMPOSABLES` registry
  gains two auto-import entries for the `autoImport: true` family composables
  (`useClamp` -> `@aihu/use/math/useClamp`, `useReducedMotion` ->
  `@aihu/use/motion/useReducedMotion`), hence the compiler patch bump (and the
  matching platform-binary version bump under `packages/compiler/npm/*`, per
  `check:compiler-binary-bump`).

- [#550](https://github.com/fellwork/aihu/pull/550) [`9d8a49d`](https://github.com/fellwork/aihu/commit/9d8a49db0c31e4a45757f0a645a8dc80c5e370fd) Thanks [@srmcguirt](https://github.com/srmcguirt)! - feat(use): Wave 1a — 33 CORE composables (timers, preference-media, observers/sensors, async/collections)

  `@aihu/use` grows 33 new CORE composables (no `--family`, signals-only,
  `packages/use/families.json` unaffected):

  - **Timers**: `useTimestamp`, `useInterval`, `useTimeout`, `useTimer`,
    `useCountdown`, `useStopwatch`, `useDateFormat`, `useTimeAgo`.
  - **Preference/media**: `usePreferredReducedMotion` (now the canonical
    implementation — `@aihu/use/motion`'s `useReducedMotion` is refactored to
    a thin delegating wrapper, family -> core), `usePreferredContrast`,
    `usePreferredReducedTransparency`, `usePreferredLanguages`,
    `useBrowserLanguage`, `useOperatingSystem`, `useTextDirection`.
  - **Observers/sensors**: `useResizeObserver`, `useIntersectionObserver`,
    `useMutationObserver`, `usePerformanceObserver`, `useBreakpoints`,
    `useDevicePixelRatio`, `useOrientation`, `useDeviceOrientation`,
    `useDeviceMotion`, `usePageLeave`.
  - **Async/collections**: `useAsync`, `useAsyncAbortable`, `useNetworkState`,
    `useIdle`, `useMap`, `useSet`, `useMeasure`, `useFocusWithin`.

  All 33 follow the house composable contract: `isClient`-guard-first SSR
  no-ops, `tryOnScopeDispose` teardown for every timer/listener/observer, and
  CORE's signals-only dependency rule (verified by
  `scripts/dep-check.ts`'s `checkUseSubpathPurity`). 61 composables now pass
  `scripts/check-use-registry-parity.ts`'s family-aware six/seven-touch-point
  check (up from 28).

  `packages/compiler/src/codegen/use_registry.rs`'s `USE_COMPOSABLES` registry
  gains all 33 auto-import tuples for this wave, hence the compiler patch bump
  (and the matching platform-binary version bump under
  `packages/compiler/npm/*`, per `check:compiler-binary-bump`).

- [#574](https://github.com/fellwork/aihu/pull/574) [`0f55923`](https://github.com/fellwork/aihu/commit/0f5592322e216fb39df9a674d0889746473a25f5) Thanks [@srmcguirt](https://github.com/srmcguirt)! - feat(use): Wave 2 Elements — 4 shadow-DOM-correct CORE composables

  `@aihu/use` grows the four Elements composables that were blocked on the
  composed-tree event substrate (PR [#564](https://github.com/fellwork/aihu/issues/564),
  `docs/plans/2026-07-24-composed-tree-helper.md`):

  - **`useClickOutside`** (alias `onClickOutside`) — fires when a
    `pointerdown`/`pointerup` gesture both land outside the target (and outside
    every `ignore` entry). The pointerdown/pointerup pairing stores two
    **booleans**, never the raw events — `composedPath()` is only populated
    during an event's own dispatch, so re-reading a stashed event after it
    finishes silently degrades back to the broken `event.target` up-walk.
  - **`useActiveElement`** — a reactive `composedActiveElement`, drilled
    through open shadow roots to the truly-focused leaf (`document
.activeElement` alone stops at the outermost host).
  - **`useHover`** — `isEventInside` on `pointerover`/`pointerout`, with
    `relatedTarget` containment (via `composedContains`) to suppress
    descendant-to-descendant flicker, plus `delayEnter`/`delayLeave`.
  - **`useMouseInElement`** — mouse position relative to a target, with
    `isOutside` driven by `isEventInside` (not bounding-box geometry) and
    `scroll`/`resize` re-derivation between pointer moves.

  All four hit-test through `../shared/composed-tree.ts`'s
  `isEventInside`/`isEventInsideAny`/`composedContains`/`composedActiveElement`
  — never `Element.contains()` or a naive up-walk from `event.target`, both of
  which give the wrong answer once a click/hover genuinely originates inside a
  nested shadow element (`event.target` is retargeted UP to the outermost
  shadow host, so a container below that host is never on the up-walk).

  Every composable follows the house contract: `isClient`-guard-first SSR
  no-ops, `tryOnScopeDispose`/manual `stop()` teardown, and CORE's
  signals-only dependency rule (`scripts/dep-check.ts`). Tests exercise real
  `attachShadow` boundaries (single and two-level-nested), not mocks — per the
  repo's standing lesson that light-DOM-only tests have repeatedly passed
  while shadow-DOM behaviour was broken. `useClickOutside` additionally has a
  dedicated regression test for the "stores events, not booleans" bug class:
  a genuine click two shadow roots deep, dispatched as two separate
  `pointerdown`/`pointerup` events, only passes if pointerdown's hit-test
  result was captured as a boolean during ITS OWN dispatch rather than
  re-derived later from a stashed event whose `composedPath()` has since gone
  empty.

  `useContextMenu` (`@aihu/primitives`, same substrate, different package
  layer) is intentionally not part of this PR.

### Patch Changes

- [#562](https://github.com/fellwork/aihu/pull/562) [`3aa0ed4`](https://github.com/fellwork/aihu/commit/3aa0ed40017a445981571540414c84866aaaf1cd) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix `scripts/dep-check.ts` and `packages/use/rolldown.config.ts` so
  `@aihu/use`'s allowed-externals check and rolldown `external` option are
  subpath-aware instead of exact-string match.

  Both compared an import specifier against the allowed-package set with a
  plain `Set.has(spec)` / array membership check, so a subpath import like
  `@aihu/signals/lifecycle` (a real published subpath, added by [#549](https://github.com/fellwork/aihu/issues/549)) failed
  the allowed-package test even though `@aihu/signals` itself is permitted.
  `scripts/dep-check.ts`'s `checkUseSubpathPurity` would reject the import and
  fail `bun run check:deps`; `rolldown.config.ts`'s `external` array wouldn't
  externalize it either, so rolldown would silently inline the module into
  every consuming entry, inflating that entry's `.size-limit.json` row.

  Both now match on the package-name boundary — `spec === pkg ||
spec.startsWith(pkg + '/')` — so a declared package's subpaths pass while an
  unrelated package that merely shares a string prefix still does not.
  `@aihu/use` remains signals-only by policy: `@aihu/runtime` (and anything
  else not explicitly allowed) is still rejected by both checks.

  This unblocks the `@aihu/use` Wave work that adopts the new
  `@aihu/signals/lifecycle` contract (FEL-390, FEL-392, FEL-393).

- Updated dependencies [[`ad6921a`](https://github.com/fellwork/aihu/commit/ad6921a018ef4a479f6540278e549aa9a8cab387)]:
  - @aihu/signals@0.5.0
  - @aihu/router@0.4.2

## 0.3.0

### Minor Changes

- [#529](https://github.com/fellwork/aihu/pull/529) [`bc69d15`](https://github.com/fellwork/aihu/commit/bc69d15e595660026fca29a8a0003e166e5d01dd) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fan out `@aihu/use` with ~20 new signals-only composables, each with its own
  per-composable subpath entry (`@aihu/use/useX`) and `.size-limit.json` row.
  SSR-safety and scope-cleanup have been fable-reviewed across the set.

  New composables:

  - `useClipboard`
  - `useColorScheme`
  - `useCounter`
  - `useDebounced`
  - `useDocumentVisibility`
  - `useElementSize`
  - `useElementVisibility`
  - `useIntervalFn`
  - `useLocalStorage`
  - `useMediaQuery`
  - `useNow`
  - `usePreferredDark`
  - `usePrevious`
  - `useRafFn`
  - `useScroll`
  - `useSupported`
  - `useThrottle`
  - `useTimeoutFn`
  - `useToggle`
  - `useWindowSize`

## 0.2.0

### Minor Changes

- [#523](https://github.com/fellwork/aihu/pull/523) [`f80128f`](https://github.com/fellwork/aihu/commit/f80128f136beea220d455039121987c1120c246f) Thanks [@srmcguirt](https://github.com/srmcguirt)! - New package: `@aihu/use` — utility/sensor/state composables for aihu (the
  VueUse analog), built on `@aihu/signals` (signals + effect scope) as its sole
  dependency (effect-scope plan §5).

  This landing establishes the pattern for the curated ~25 set with the package
  scaffold, the shared substrate (`isClient`/`defaultWindow`/`defaultDocument`/
  `defaultNavigator`, `toValue` — no tuple detection, `unrefElement`,
  `tryOnScopeDispose`, `tryOnMounted`), and two reference composables, each its
  own subpath entry with its own size row:

  - `useEventListener(target, event, handler, options?) → stop()` — the
    foundational composable: manual `stop()` plus scope-owned auto-cleanup;
    getter targets rebind reactively via per-run effect cleanup; handler event
    types inferred from the DOM event maps for `Window`/`Document`/
    `HTMLElement` targets. Explicit `null` target means "nothing" — only an
    omitted target falls back to a default.
  - `useMouse(options?) → { x, y }` — the reference sensor: an object of named
    getters (the ratified return convention), batched per-mousemove updates.

  Conventions this package pins: composable returns are **objects of named
  getters read as `{x()}` in templates — parens required** (a bare `{x}`
  renders the getter's source text); and SSR-safety via the **`isClient` no-op
  invariant** — no composable creates a listener, effect, or timer when
  `isClient` is `false`, enforced by a table-driven SSR gate test that every
  future composable entry joins.

### Patch Changes

- Updated dependencies [[`18e5f6d`](https://github.com/fellwork/aihu/commit/18e5f6dda93772877690e88e8c217dcdcf4bddc2), [`ea8d2eb`](https://github.com/fellwork/aihu/commit/ea8d2ebb91c28132f399a708e2bd88877072d1db)]:
  - @aihu/signals@0.4.0
