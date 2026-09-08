# @aihu/use

> **Aihu** — agentic discovery and interaction, for human purpose.

aihu utility/sensor/state composables — SSR-safe, scope-aware, per-composable subpath entries.


<!-- BEGIN_HANDWRITTEN: prose -->
Utility, sensor, and state composables for aihu — the VueUse analog, built on
`@aihu/signals` (signals + effect scope) and nothing else. Each composable is
its own subpath entry (`@aihu/use/useMouse`) with its own size budget, and is
SSR-safe by construction.

```ts
import { useMouse } from '@aihu/use/useMouse'

const { x, y } = useMouse()
```

## Reading composable values in templates: call the getter — `{x()}`

Every composable returns **an object of named getters** (signals under the
hood). In `.aihu` templates they are read **with parens**:

```aihu
<span>{x()} / {y()}</span>   <!-- ✓ reactive -->
<span>{x} / {y}</span>       <!-- ✗ renders the getter's source text -->
```

This is different from `@state`-declared names, which read bare (`{count}`)
because the compiler tracks them. A destructured composable return is not in
that map, so the bare form lowers to `leaf(x)` — the leaf receives the getter
**function** itself and the DOM renders the function's **source text** (you
will literally see something like `() => ...` on the page). **`state()` reads
bare; imported-composable getters read `{x()}`.** This is the #1 gotcha —
when you see function source rendered in the DOM, add the parens.

## SSR safety: the `isClient` no-op invariant

A composable creates **no listener, effect, or timer when `isClient` is
`false`** — it returns static getters of its initial value and no-op handles
instead. aihu's SSR path runs the full setup body server-side with zero DOM,
so this invariant is what makes composables safe in SSR'd components without
any special casing on your side. The guards live in `@aihu/use/shared`
(`isClient`, `defaultWindow`, `defaultDocument`, `defaultNavigator`,
`tryOnScopeDispose`, `tryOnMounted`, `toValue`, `unrefElement`).

Note on `toValue`: it unwraps `T | (() => T)` and **never inspects arrays** —
a `[get, set]` signal tuple is structurally an array of functions and cannot
be discriminated from a legitimate array value. Pass the read half
(`tuple[0]`), and wrap a function-typed value in a getter (`() => fn`).

## Composables

| Entry | What it does |
| --- | --- |
| `useEventListener(target, event, handler, options?) → stop()` | Attach a listener with scope-owned auto-cleanup **and** a manual `stop()`. Getter targets (`$ref`, signal reads) rebind reactively — the old listener is removed, the new one added, whenever the target changes. Handler event types are inferred from the DOM event maps for `Window`/`Document`/`HTMLElement` targets. |
| `useMouse(options?) → { x, y }` | Reactive mouse position (`client`/`page`/`screen` coordinates, configurable target and initial value). |

Two target rules shared by all sensors:

- **`null` means "nothing"; only an omitted (`undefined`) target falls back
  to `window`.** An explicit `null` target registers no listener.
- **A getter target only rebinds if it reads a signal.** A getter like
  `() => document.getElementById('x')` runs once and never re-runs — it
  looks reactive but isn't.

More are coming — this landing establishes the pattern (packaging, per-entry
size rows, SSR safety, getter return shape) for the curated ~25 set; see
`docs/plans/2026-07-22-effect-scope-and-composables.md` §5.

### Registry contract for tooling

The published `./composable-registry.json` subpath contains the names,
subpath specifiers, and one-line descriptions for the composables that aihu's
compiler and language server may auto-import. It is a portable contract for
tooling in separate repositories; consumers must read this artifact instead
of depending on `packages/use/src` from the aihu monorepo. The file has a
`schemaVersion` so future registry changes can be introduced deliberately.
<!-- END_HANDWRITTEN: prose -->

## Install

<!-- BEGIN_AUTOGEN: install -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

```bash
npm install @aihu/use
# or
bun add @aihu/use
```

<sub><i>Auto-generated against `@aihu/use@2.0.0`.</i></sub>

<!-- END_AUTOGEN: install -->

## Package facts

<!-- BEGIN_AUTOGEN: stats -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| | |
|---|---|
| **Version** | `2.0.0` |
| **Tier** | G — Composables — VueUse-style sensor/state/browser utilities on aihu signals (SSR-safe, per-composable entries) |
| **Published files** | 4 entries |
| **License** | MIT |

<sub><i>Auto-generated against `@aihu/use@2.0.0`.</i></sub>

<!-- END_AUTOGEN: stats -->

## Exports

<!-- BEGIN_AUTOGEN: exports -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| Subpath | ESM | CJS |
|---|---|---|
| `.` | `./dist/index.js` | `—` |
| `./shared` | `./dist/shared.js` | `—` |
| `./composable-registry.json` | `./composable-registry.json` | — |
| `./useActiveElement` | `./dist/useActiveElement.js` | `—` |
| `./useAsync` | `./dist/useAsync.js` | `—` |
| `./useAsyncAbortable` | `./dist/useAsyncAbortable.js` | `—` |
| `./useBreakpoints` | `./dist/useBreakpoints.js` | `—` |
| `./useBrowserLanguage` | `./dist/useBrowserLanguage.js` | `—` |
| `./useClickOutside` | `./dist/useClickOutside.js` | `—` |
| `./useClipboard` | `./dist/useClipboard.js` | `—` |
| `./useColorScheme` | `./dist/useColorScheme.js` | `—` |
| `./useCountdown` | `./dist/useCountdown.js` | `—` |
| `./useCounter` | `./dist/useCounter.js` | `—` |
| `./useDateFormat` | `./dist/useDateFormat.js` | `—` |
| `./useDebounced` | `./dist/useDebounced.js` | `—` |
| `./useDeviceMotion` | `./dist/useDeviceMotion.js` | `—` |
| `./useDeviceOrientation` | `./dist/useDeviceOrientation.js` | `—` |
| `./useDevicePixelRatio` | `./dist/useDevicePixelRatio.js` | `—` |
| `./useDocumentVisibility` | `./dist/useDocumentVisibility.js` | `—` |
| `./useElementSize` | `./dist/useElementSize.js` | `—` |
| `./useElementVisibility` | `./dist/useElementVisibility.js` | `—` |
| `./useEventListener` | `./dist/useEventListener.js` | `—` |
| `./useEventListenerMap` | `./dist/useEventListenerMap.js` | `—` |
| `./useFocusWithin` | `./dist/useFocusWithin.js` | `—` |
| `./useHover` | `./dist/useHover.js` | `—` |
| `./useIdle` | `./dist/useIdle.js` | `—` |
| `./useIntersectionObserver` | `./dist/useIntersectionObserver.js` | `—` |
| `./useInterval` | `./dist/useInterval.js` | `—` |
| `./useIntervalFn` | `./dist/useIntervalFn.js` | `—` |
| `./useKeyedAsync` | `./dist/useKeyedAsync.js` | `—` |
| `./useLocalStorage` | `./dist/useLocalStorage.js` | `—` |
| `./useMap` | `./dist/useMap.js` | `—` |
| `./useMeasure` | `./dist/useMeasure.js` | `—` |
| `./useMediaQuery` | `./dist/useMediaQuery.js` | `—` |
| `./useMouse` | `./dist/useMouse.js` | `—` |
| `./useMouseInElement` | `./dist/useMouseInElement.js` | `—` |
| `./useMutationObserver` | `./dist/useMutationObserver.js` | `—` |
| `./useNetworkState` | `./dist/useNetworkState.js` | `—` |
| `./useNow` | `./dist/useNow.js` | `—` |
| `./useOperatingSystem` | `./dist/useOperatingSystem.js` | `—` |
| `./useOrientation` | `./dist/useOrientation.js` | `—` |
| `./usePageLeave` | `./dist/usePageLeave.js` | `—` |
| `./usePerformanceObserver` | `./dist/usePerformanceObserver.js` | `—` |
| `./usePreferredContrast` | `./dist/usePreferredContrast.js` | `—` |
| `./usePreferredDark` | `./dist/usePreferredDark.js` | `—` |
| `./usePreferredLanguages` | `./dist/usePreferredLanguages.js` | `—` |
| `./usePreferredReducedMotion` | `./dist/usePreferredReducedMotion.js` | `—` |
| `./usePreferredReducedTransparency` | `./dist/usePreferredReducedTransparency.js` | `—` |
| `./usePrevious` | `./dist/usePrevious.js` | `—` |
| `./useRafFn` | `./dist/useRafFn.js` | `—` |
| `./useResizeObserver` | `./dist/useResizeObserver.js` | `—` |
| `./useScroll` | `./dist/useScroll.js` | `—` |
| `./useSet` | `./dist/useSet.js` | `—` |
| `./useStopwatch` | `./dist/useStopwatch.js` | `—` |
| `./useSupported` | `./dist/useSupported.js` | `—` |
| `./useTextDirection` | `./dist/useTextDirection.js` | `—` |
| `./useThrottle` | `./dist/useThrottle.js` | `—` |
| `./useTimeAgo` | `./dist/useTimeAgo.js` | `—` |
| `./useTimeout` | `./dist/useTimeout.js` | `—` |
| `./useTimeoutFn` | `./dist/useTimeoutFn.js` | `—` |
| `./useTimer` | `./dist/useTimer.js` | `—` |
| `./useTimestamp` | `./dist/useTimestamp.js` | `—` |
| `./useToggle` | `./dist/useToggle.js` | `—` |
| `./useWatch` | `./dist/useWatch.js` | `—` |
| `./useWindowSize` | `./dist/useWindowSize.js` | `—` |
| `./integrations/useJwt` | `./dist/integrations/useJwt.js` | `—` |
| `./math` | `./dist/math.js` | `—` |
| `./math/useClamp` | `./dist/math/useClamp.js` | `—` |
| `./motion` | `./dist/motion.js` | `—` |
| `./motion/useCanvasSurface` | `./dist/motion/useCanvasSurface.js` | `—` |
| `./motion/useCharacterField` | `./dist/motion/useCharacterField.js` | `—` |
| `./motion/useCountTo` | `./dist/motion/useCountTo.js` | `—` |
| `./motion/useParticleField` | `./dist/motion/useParticleField.js` | `—` |
| `./motion/useReducedMotion` | `./dist/motion/useReducedMotion.js` | `—` |
| `./motion/useSequence` | `./dist/motion/useSequence.js` | `—` |
| `./motion/useTokenStream` | `./dist/motion/useTokenStream.js` | `—` |
| `./motion/useTypewriter` | `./dist/motion/useTypewriter.js` | `—` |
| `./router` | `./dist/router.js` | `—` |
| `./router/useRouteParams` | `./dist/router/useRouteParams.js` | `—` |

<sub><i>Auto-generated against `@aihu/use@2.0.0`.</i></sub>

<!-- END_AUTOGEN: exports -->

## Dependencies

<!-- BEGIN_AUTOGEN: deps -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

**Dependencies:**

- `@aihu/signals` — `^0.5.1`

**Peer dependencies:**

- `@aihu/context` — `^0.2.0`
- `@aihu/router` — `^0.5.0`
- `jwt-decode` — `>=4`

<sub><i>Auto-generated against `@aihu/use@2.0.0`.</i></sub>

<!-- END_AUTOGEN: deps -->

## See also

<!-- BEGIN_AUTOGEN: see-also -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

- [@aihu/signals](https://github.com/aihu-project/aihu-dom)
- [@aihu/primitives](../primitives)
- [Aihu framework root](../../README.md)

<sub><i>Auto-generated against `@aihu/use@2.0.0`.</i></sub>

<!-- END_AUTOGEN: see-also -->

## License

<!-- BEGIN_AUTOGEN: license -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

MIT — see [LICENSE](../../LICENSE).

<sub><i>Auto-generated against `@aihu/use@2.0.0`.</i></sub>

<!-- END_AUTOGEN: license -->
