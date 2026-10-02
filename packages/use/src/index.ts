/**
 * `@aihu/use` — utility/sensor/state composables for aihu
 * (docs/plans/2026-07-22-effect-scope-and-composables.md §5).
 *
 * Barrel entry. Prefer the per-composable subpaths
 * (`@aihu/use/useEventListener`, `@aihu/use/useMouse`, `@aihu/use/shared`)
 * in size-sensitive code — each is its own bundle entry with its own
 * `.size-limit.json` row.
 */

export type { CreateFocusTrapOptions, FocusTarget, FocusTrap } from './createFocusTrap/index.ts'
export { createFocusTrap } from './createFocusTrap/index.ts'
export type { MaybeElementGetter, MaybeGetter } from './shared/index.ts'
export {
  defaultDocument,
  defaultNavigator,
  defaultWindow,
  isClient,
  toValue,
  tryOnMounted,
  tryOnScopeDispose,
  unrefElement,
} from './shared/index.ts'
export type { UseActiveElementReturn } from './useActiveElement/index.ts'
export { useActiveElement } from './useActiveElement/index.ts'
export type { UseAsyncOptions, UseAsyncReturn } from './useAsync/index.ts'
export { useAsync } from './useAsync/index.ts'
export type {
  UseAsyncAbortableOptions,
  UseAsyncAbortableReturn,
} from './useAsyncAbortable/index.ts'
export { useAsyncAbortable } from './useAsyncAbortable/index.ts'
export type { Breakpoints, UseBreakpointsReturn } from './useBreakpoints/index.ts'
export { breakpointsDefault, useBreakpoints } from './useBreakpoints/index.ts'
export type {
  UseBrowserLanguageOptions,
  UseBrowserLanguageReturn,
} from './useBrowserLanguage/index.ts'
export { useBrowserLanguage } from './useBrowserLanguage/index.ts'
export type { UseClickOutsideOptions } from './useClickOutside/index.ts'
export { onClickOutside, useClickOutside } from './useClickOutside/index.ts'
export type { UseClipboardOptions, UseClipboardReturn } from './useClipboard/index.ts'
export { useClipboard } from './useClipboard/index.ts'
export type {
  ColorScheme,
  UseColorSchemeOptions,
  UseColorSchemeReturn,
} from './useColorScheme/index.ts'
export { useColorScheme } from './useColorScheme/index.ts'
export type { UseCountdownOptions, UseCountdownReturn } from './useCountdown/index.ts'
export { useCountdown } from './useCountdown/index.ts'
export type { UseCounterOptions, UseCounterReturn } from './useCounter/index.ts'
export { useCounter } from './useCounter/index.ts'
export type { UseDateFormatOptions, UseDateFormatReturn } from './useDateFormat/index.ts'
export { useDateFormat } from './useDateFormat/index.ts'
export type { UseDebouncedReturn } from './useDebounced/index.ts'
export { useDebounced } from './useDebounced/index.ts'
export type { UseDeviceMotionReturn } from './useDeviceMotion/index.ts'
export { useDeviceMotion } from './useDeviceMotion/index.ts'
export type { UseDeviceOrientationReturn } from './useDeviceOrientation/index.ts'
export { useDeviceOrientation } from './useDeviceOrientation/index.ts'
export type { UseDevicePixelRatioReturn } from './useDevicePixelRatio/index.ts'
export { useDevicePixelRatio } from './useDevicePixelRatio/index.ts'
export type { UseDocumentVisibilityReturn } from './useDocumentVisibility/index.ts'
export { useDocumentVisibility } from './useDocumentVisibility/index.ts'
export type { UseElementSizeOptions, UseElementSizeReturn } from './useElementSize/index.ts'
export { useElementSize } from './useElementSize/index.ts'
export type {
  UseElementVisibilityOptions,
  UseElementVisibilityReturn,
} from './useElementVisibility/index.ts'
export { useElementVisibility } from './useElementVisibility/index.ts'
export { useEventListener } from './useEventListener/index.ts'
export { useEventListenerMap } from './useEventListenerMap/index.ts'
export type { UseFocusWithinOptions, UseFocusWithinReturn } from './useFocusWithin/index.ts'
export { useFocusWithin } from './useFocusWithin/index.ts'
export type { UseHoverOptions, UseHoverReturn } from './useHover/index.ts'
export { useHover } from './useHover/index.ts'
export type { UseIdleOptions, UseIdleReturn } from './useIdle/index.ts'
export { useIdle } from './useIdle/index.ts'
export type {
  UseIntersectionObserverOptions,
  UseIntersectionObserverReturn,
} from './useIntersectionObserver/index.ts'
export { useIntersectionObserver } from './useIntersectionObserver/index.ts'
export type { UseIntervalOptions, UseIntervalReturn } from './useInterval/index.ts'
export { useInterval } from './useInterval/index.ts'
export type { UseIntervalFnOptions, UseIntervalFnReturn } from './useIntervalFn/index.ts'
export { useIntervalFn } from './useIntervalFn/index.ts'
export type { UseKeyedAsyncOptions, UseKeyedAsyncReturn } from './useKeyedAsync/index.ts'
export { useKeyedAsync } from './useKeyedAsync/index.ts'
export type { UseLocalStorageOptions, UseLocalStorageReturn } from './useLocalStorage/index.ts'
export { useLocalStorage } from './useLocalStorage/index.ts'
export type { UseMapReturn } from './useMap/index.ts'
export { useMap } from './useMap/index.ts'
export type { UseMeasureOptions, UseMeasureReturn } from './useMeasure/index.ts'
export { useMeasure } from './useMeasure/index.ts'
export type { UseMediaQueryOptions, UseMediaQueryReturn } from './useMediaQuery/index.ts'
export { useMediaQuery } from './useMediaQuery/index.ts'
export type { UseMouseCoordType, UseMouseOptions, UseMouseReturn } from './useMouse/index.ts'
export { useMouse } from './useMouse/index.ts'
export type {
  UseMouseInElementOptions,
  UseMouseInElementReturn,
} from './useMouseInElement/index.ts'
export { useMouseInElement } from './useMouseInElement/index.ts'
export type { UseMutationObserverReturn } from './useMutationObserver/index.ts'
export { useMutationObserver } from './useMutationObserver/index.ts'
export type { UseNetworkStateOptions, UseNetworkStateReturn } from './useNetworkState/index.ts'
export { useNetworkState } from './useNetworkState/index.ts'
export type { UseNowOptions, UseNowReturn } from './useNow/index.ts'
export { useNow } from './useNow/index.ts'
export type {
  UseOperatingSystemOptions,
  UseOperatingSystemReturn,
} from './useOperatingSystem/index.ts'
export { useOperatingSystem } from './useOperatingSystem/index.ts'
export type { UseOrientationReturn } from './useOrientation/index.ts'
export { useOrientation } from './useOrientation/index.ts'
export type { UsePageLeaveReturn } from './usePageLeave/index.ts'
export { usePageLeave } from './usePageLeave/index.ts'
export type { UsePerformanceObserverReturn } from './usePerformanceObserver/index.ts'
export { usePerformanceObserver } from './usePerformanceObserver/index.ts'
export type {
  UsePreferredContrastOptions,
  UsePreferredContrastReturn,
} from './usePreferredContrast/index.ts'
export { usePreferredContrast } from './usePreferredContrast/index.ts'
export type { UsePreferredDarkReturn } from './usePreferredDark/index.ts'
export { usePreferredDark } from './usePreferredDark/index.ts'
export type {
  UsePreferredLanguagesOptions,
  UsePreferredLanguagesReturn,
} from './usePreferredLanguages/index.ts'
export { usePreferredLanguages } from './usePreferredLanguages/index.ts'
export type {
  UsePreferredReducedMotionOptions,
  UsePreferredReducedMotionReturn,
} from './usePreferredReducedMotion/index.ts'
export { usePreferredReducedMotion } from './usePreferredReducedMotion/index.ts'
export type {
  UsePreferredReducedTransparencyOptions,
  UsePreferredReducedTransparencyReturn,
} from './usePreferredReducedTransparency/index.ts'
export { usePreferredReducedTransparency } from './usePreferredReducedTransparency/index.ts'
export type { UsePreviousReturn } from './usePrevious/index.ts'
export { usePrevious } from './usePrevious/index.ts'
export type {
  UseRafFnCallbackArgs,
  UseRafFnOptions,
  UseRafFnReturn,
} from './useRafFn/index.ts'
export { useRafFn } from './useRafFn/index.ts'
export type {
  UseResizeObserverOptions,
  UseResizeObserverReturn,
} from './useResizeObserver/index.ts'
export { useResizeObserver } from './useResizeObserver/index.ts'
export type { UseScrollOptions, UseScrollReturn } from './useScroll/index.ts'
export { useScroll } from './useScroll/index.ts'
export type { UseSetReturn } from './useSet/index.ts'
export { useSet } from './useSet/index.ts'
export type { UseStopwatchOptions, UseStopwatchReturn } from './useStopwatch/index.ts'
export { useStopwatch } from './useStopwatch/index.ts'
export type { UseSupportedReturn } from './useSupported/index.ts'
export { useSupported } from './useSupported/index.ts'
export type { UseTextDirectionOptions, UseTextDirectionReturn } from './useTextDirection/index.ts'
export { useTextDirection } from './useTextDirection/index.ts'
export type { UseThrottleReturn } from './useThrottle/index.ts'
export { useThrottle } from './useThrottle/index.ts'
export type { UseTimeAgoOptions, UseTimeAgoReturn } from './useTimeAgo/index.ts'
export { useTimeAgo } from './useTimeAgo/index.ts'
export type { UseTimeoutOptions, UseTimeoutReturn } from './useTimeout/index.ts'
export { useTimeout } from './useTimeout/index.ts'
export type { UseTimeoutFnOptions, UseTimeoutFnReturn } from './useTimeoutFn/index.ts'
export { useTimeoutFn } from './useTimeoutFn/index.ts'
export type { UseTimerOptions, UseTimerReturn } from './useTimer/index.ts'
export { useTimer } from './useTimer/index.ts'
export type { UseTimestampOptions, UseTimestampReturn } from './useTimestamp/index.ts'
export { useTimestamp } from './useTimestamp/index.ts'
export type { UseToggleFn, UseToggleReturn } from './useToggle/index.ts'
export { useToggle } from './useToggle/index.ts'
export type { UseWatchCallback, UseWatchOptions } from './useWatch/index.ts'
export { useWatch } from './useWatch/index.ts'
export type { UseWindowSizeOptions, UseWindowSizeReturn } from './useWindowSize/index.ts'
export { useWindowSize } from './useWindowSize/index.ts'
