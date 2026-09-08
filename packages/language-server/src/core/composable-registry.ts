/**
 * packages/language-server/src/core/composable-registry.ts
 *
 * GENERATED — do not hand-edit. Source of truth:
 *   packages/use/src/<name>/index.ts (names, specifiers, and doc comments)
 *
 * Regenerate: bun scripts/gen-composable-hover-registry.ts
 * (FEL-342 / #427 follow-up — LSP composable-awareness)
 */

export interface ComposableRegistryEntry {
  /** Bare call name, e.g. `useMouse`. */
  name: string
  /** Module specifier the compiler auto-imports, e.g. `@aihu/use/useMouse`. */
  specifier: string
  /** One-line purpose, extracted from the composable's doc comment. */
  description: string
}

export const COMPOSABLE_REGISTRY: readonly ComposableRegistryEntry[] = [
  {
    name: 'useActiveElement',
    specifier: '@aihu/use/useActiveElement',
    description:
      'reactive `document.activeElement`, drilled through open shadow roots to the truly-focused leaf',
  },
  {
    name: 'useAsync',
    specifier: '@aihu/use/useAsync',
    description:
      'reactive state around a single async function: `data`, `error`, `isLoading`, `isFinished`, plus a manual `execute()` to (re)invoke it',
  },
  {
    name: 'useAsyncAbortable',
    specifier: '@aihu/use/useAsyncAbortable',
    description:
      '`useAsync` plus `AbortController` wiring: a new `execute()` call aborts the previous still-in-flight call, and the current controller is ...',
  },
  {
    name: 'useBreakpoints',
    specifier: '@aihu/use/useBreakpoints',
    description: 'named breakpoint media queries, built on {@link useMediaQuery}',
  },
  {
    name: 'useBrowserLanguage',
    specifier: '@aihu/use/useBrowserLanguage',
    description:
      "reactive `navigator.language` (the user's single primary language), updated on the `languagechange` event",
  },
  {
    name: 'useCanvasSurface',
    specifier: '@aihu/use/motion/useCanvasSurface',
    description: "own a decorative `<canvas>`'s sizing, DPI, visibility gating and rAF loop",
  },
  {
    name: 'useCharacterField',
    specifier: '@aihu/use/motion/useCharacterField',
    description: 'an animated grid of character glyphs on a managed canvas',
  },
  {
    name: 'useClamp',
    specifier: '@aihu/use/math/useClamp',
    description: 'reactive clamp of a number to `[min, max]`',
  },
  {
    name: 'useClickOutside',
    specifier: '@aihu/use/useClickOutside',
    description:
      'fire `handler` when a genuine click starts AND ends outside `target` (and outside every element in `ignore`), shadow-DOM-correct',
  },
  {
    name: 'useClipboard',
    specifier: '@aihu/use/useClipboard',
    description:
      'write to the system clipboard via the async Clipboard API, with a transient `copied` flag for "Copied!" UI',
  },
  {
    name: 'useColorScheme',
    specifier: '@aihu/use/useColorScheme',
    description:
      "reactive `'light' | 'dark' | 'auto'` color-scheme STATE, resolving `'auto'` against the OS preference via {@link usePreferredDark}",
  },
  {
    name: 'useCountdown',
    specifier: '@aihu/use/useCountdown',
    description:
      'a count-DOWN timer from a fixed `duration`, with pause/resume and an optional `onComplete` callback',
  },
  {
    name: 'useCounter',
    specifier: '@aihu/use/useCounter',
    description: 'a reactive numeric counter clamped to an optional `[min, max]` range',
  },
  {
    name: 'useCountTo',
    specifier: '@aihu/use/motion/useCountTo',
    description: 'tween a number to a target over a duration, eased',
  },
  {
    name: 'useDateFormat',
    specifier: '@aihu/use/useDateFormat',
    description: 'format a reactive `Date`/epoch-number/date-string via `Intl.DateTimeFormat`',
  },
  {
    name: 'useDebounced',
    specifier: '@aihu/use/useDebounced',
    description: 'derive a debounced signal from a reactive `source` getter',
  },
  {
    name: 'useDeviceMotion',
    specifier: '@aihu/use/useDeviceMotion',
    description:
      'reactive `devicemotion` readings (`acceleration`, `accelerationIncludingGravity`, `rotationRate`, `interval`)',
  },
  {
    name: 'useDeviceOrientation',
    specifier: '@aihu/use/useDeviceOrientation',
    description: 'reactive `deviceorientation` readings (`alpha`/`beta`/`gamma`/`absolute`)',
  },
  {
    name: 'useDevicePixelRatio',
    specifier: '@aihu/use/useDevicePixelRatio',
    description: 'reactive `window.devicePixelRatio`',
  },
  {
    name: 'useDocumentVisibility',
    specifier: '@aihu/use/useDocumentVisibility',
    description: 'reactive `document.visibilityState`',
  },
  {
    name: 'useElementSize',
    specifier: '@aihu/use/useElementSize',
    description: 'reactive content size of an element via `ResizeObserver`',
  },
  {
    name: 'useElementVisibility',
    specifier: '@aihu/use/useElementVisibility',
    description:
      'whether an element is intersecting its viewport (or a custom root) via `IntersectionObserver`',
  },
  {
    name: 'useEventListener',
    specifier: '@aihu/use/useEventListener',
    description:
      'the foundational `@aihu/use` composable: attach a DOM event listener with automatic cleanup and (for getter targets) reactive rebinding',
  },
  {
    name: 'useEventListenerMap',
    specifier: '@aihu/use/useEventListenerMap',
    description:
      "bind multiple `{event: handler}` pairs to one target with a SINGLE combined `stop()` (solid-primitives' `createEventListenerMap` pattern)",
  },
  {
    name: 'useFocusWithin',
    specifier: '@aihu/use/useFocusWithin',
    description:
      'whether focus currently lives inside a target element (self or any descendant), via `focusin`/`focusout`',
  },
  {
    name: 'useHover',
    specifier: '@aihu/use/useHover',
    description:
      'reactive "is the pointer currently over `target`?", shadow-DOM correct via `pointerover`/`pointerout` hit-testing',
  },
  {
    name: 'useIdle',
    specifier: '@aihu/use/useIdle',
    description:
      'whether the user has been inactive for `timeout` ms, reset by activity events (`mousemove`, `keydown`, `touchstart`, `scroll`) and by the...',
  },
  {
    name: 'useIntersectionObserver',
    specifier: '@aihu/use/useIntersectionObserver',
    description:
      'the general `IntersectionObserver` wrapper: observe a target element and run `callback` on every intersection change',
  },
  {
    name: 'useInterval',
    specifier: '@aihu/use/useInterval',
    description: 'reactive tick counter, incremented every `interval` ms',
  },
  {
    name: 'useIntervalFn',
    specifier: '@aihu/use/useIntervalFn',
    description: 'call `callback` every `interval` ms',
  },
  {
    name: 'useKeyedAsync',
    specifier: '@aihu/use/useKeyedAsync',
    description:
      "an async resource whose IDENTITY is a reactive `key`: changing the key clears `data` synchronously and cancels the previous key's in-flig...",
  },
  {
    name: 'useLocalStorage',
    specifier: '@aihu/use/useLocalStorage',
    description:
      'a reactive value backed by `localStorage`, synced across same-origin tabs via the `storage` event',
  },
  {
    name: 'useMap',
    specifier: '@aihu/use/useMap',
    description:
      'a reactive `Map` wrapper: signal-backed reads (`get`, `has`, `size`, and `entries`/`keys`/`values` snapshots) plus mutations (`set`, `del...',
  },
  {
    name: 'useMeasure',
    specifier: '@aihu/use/useMeasure',
    description:
      'full bounding-rect measurement of an element (`x`, `y`, `width`, `height`, `top`, `right`, `bottom`, `left`), re-measured on every resize...',
  },
  {
    name: 'useMediaQuery',
    specifier: '@aihu/use/useMediaQuery',
    description: 'reactive boolean for a CSS media-query string, tracked via `matchMedia`',
  },
  {
    name: 'useMouse',
    specifier: '@aihu/use/useMouse',
    description: 'reactive mouse position: the reference SENSOR composable',
  },
  {
    name: 'useMouseInElement',
    specifier: '@aihu/use/useMouseInElement',
    description:
      'mouse position relative to a target element, plus whether the pointer is currently over it, shadow-DOM correct',
  },
  {
    name: 'useMutationObserver',
    specifier: '@aihu/use/useMutationObserver',
    description:
      'observe DOM mutations (child list, attributes, character data) on a target element via `MutationObserver`',
  },
  {
    name: 'useNetworkState',
    specifier: '@aihu/use/useNetworkState',
    description:
      '`navigator.onLine` plus the (non-standard, Chromium/ Android-only) Network Information API (`effectiveType`, `downlink`, `rtt`, `saveData...',
  },
  { name: 'useNow', specifier: '@aihu/use/useNow', description: 'reactive current `Date`' },
  {
    name: 'useOperatingSystem',
    specifier: '@aihu/use/useOperatingSystem',
    description: 'best-effort OS detection',
  },
  {
    name: 'useOrientation',
    specifier: '@aihu/use/useOrientation',
    description:
      'reactive screen orientation (`angle` + `type`) via the Screen Orientation API, falling back to an `(orientation: portrait)` media query o...',
  },
  {
    name: 'usePageLeave',
    specifier: '@aihu/use/usePageLeave',
    description:
      'reactive boolean for whether the pointer has left the page/viewport, tracked via `mouseleave`/`mouseenter` on `document`',
  },
  {
    name: 'useParticleField',
    specifier: '@aihu/use/motion/useParticleField',
    description: 'an N-particle 2D drift simulation on a managed canvas',
  },
  {
    name: 'usePerformanceObserver',
    specifier: '@aihu/use/usePerformanceObserver',
    description:
      'subscribe to performance entries (`mark`, `measure`, `navigation`, `paint`, `resource`, ...) via `PerformanceObserver`',
  },
  {
    name: 'usePreferredContrast',
    specifier: '@aihu/use/usePreferredContrast',
    description:
      'reactive read of the OS/browser `prefers-contrast` preference, built on {@link useMediaQuery}',
  },
  {
    name: 'usePreferredDark',
    specifier: '@aihu/use/usePreferredDark',
    description:
      'reactive boolean for the OS/browser `prefers-color-scheme: dark` media feature, built on {@link useMediaQuery}',
  },
  {
    name: 'usePreferredLanguages',
    specifier: '@aihu/use/usePreferredLanguages',
    description: 'reactive `navigator.languages` array, updated on the `languagechange` event',
  },
  {
    name: 'usePreferredReducedMotion',
    specifier: '@aihu/use/usePreferredReducedMotion',
    description:
      'reactive read of the OS/browser `prefers-reduced-motion` preference, built on {@link useMediaQuery}',
  },
  {
    name: 'usePreferredReducedTransparency',
    specifier: '@aihu/use/usePreferredReducedTransparency',
    description:
      'reactive read of the OS/browser `prefers-reduced-transparency` preference, built on {@link useMediaQuery}',
  },
  {
    name: 'usePrevious',
    specifier: '@aihu/use/usePrevious',
    description: 'track the previous value of a reactive source',
  },
  {
    name: 'useRafFn',
    specifier: '@aihu/use/useRafFn',
    description: 'call `callback` on every `requestAnimationFrame` tick',
  },
  {
    name: 'useReducedMotion',
    specifier: '@aihu/use/motion/useReducedMotion',
    description: "reactive boolean read of the user's `prefers-reduced-motion` preference",
  },
  {
    name: 'useResizeObserver',
    specifier: '@aihu/use/useResizeObserver',
    description:
      'the general `ResizeObserver` wrapper: observe a target element and run `callback` on every resize',
  },
  {
    name: 'useScroll',
    specifier: '@aihu/use/useScroll',
    description: 'reactive scroll position of an element or `window`',
  },
  {
    name: 'useSequence',
    specifier: '@aihu/use/motion/useSequence',
    description: 'cycle through a list of items, holding on each for a fixed interval',
  },
  {
    name: 'useSet',
    specifier: '@aihu/use/useSet',
    description:
      'a reactive `Set` wrapper: signal-backed reads (`has`, `size`, a `values` snapshot) plus mutations (`add`, `delete`, `clear`)',
  },
  {
    name: 'useStopwatch',
    specifier: '@aihu/use/useStopwatch',
    description: 'a count-UP elapsed-time stopwatch with pause/resume and lap recording',
  },
  {
    name: 'useSupported',
    specifier: '@aihu/use/useSupported',
    description: 'wrap a feature-detection predicate into a reactive boolean getter',
  },
  {
    name: 'useTextDirection',
    specifier: '@aihu/use/useTextDirection',
    description:
      "reactive text direction (`'ltr' | 'rtl' | 'auto'`) read from a target element's `dir` attribute — default `document.documentElement` (the...",
  },
  {
    name: 'useThrottle',
    specifier: '@aihu/use/useThrottle',
    description: 'derive a throttled signal from a reactive `source` getter',
  },
  {
    name: 'useTimeAgo',
    specifier: '@aihu/use/useTimeAgo',
    description:
      'a reactive relative-time string ("3 minutes ago") for a `Date`/epoch-number/date-string, auto-updating on an adaptive cadence',
  },
  {
    name: 'useTimeout',
    specifier: '@aihu/use/useTimeout',
    description: 'reactive boolean that flips to `true`, `delay` ms after `start()`',
  },
  {
    name: 'useTimeoutFn',
    specifier: '@aihu/use/useTimeoutFn',
    description: 'call `callback` once, `delay` ms after `start()`',
  },
  {
    name: 'useTimer',
    specifier: '@aihu/use/useTimer',
    description: 'a count-UP elapsed-time timer with pause/resume',
  },
  {
    name: 'useTimestamp',
    specifier: '@aihu/use/useTimestamp',
    description: 'reactive current epoch-ms timestamp',
  },
  {
    name: 'useToggle',
    specifier: '@aihu/use/useToggle',
    description: 'a reactive boolean with a flip/set toggler',
  },
  {
    name: 'useTokenStream',
    specifier: '@aihu/use/motion/useTokenStream',
    description: 'reveal an array of tokens (words, chunks) one at a time, optionally looping',
  },
  {
    name: 'useTypewriter',
    specifier: '@aihu/use/motion/useTypewriter',
    description:
      'reveal a string one character at a time, optionally looping (type, hold, erase, retype)',
  },
  {
    name: 'useWatch',
    specifier: '@aihu/use/useWatch',
    description: 'run a callback when a reactive `source` getter CHANGES',
  },
  {
    name: 'useWindowSize',
    specifier: '@aihu/use/useWindowSize',
    description: 'reactive `window.innerWidth` / `innerHeight`',
  },
]
