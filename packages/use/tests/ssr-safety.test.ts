/**
 * SSR-safety GATE — plan-mandated enforcement of the `isClient` no-op
 * invariant (effect-scope plan §3: the library's sole SSR defense while the
 * platform `__ssr` scope wrap is deferred), TWO-TIER (namespace-wave0,
 * family-aware — `math`, `motion`, `router`, `integrations`):
 *
 * TIER 1 — AUTO-DISCOVERED, zero maintenance. Walks the real
 * `packages/use/src` tree (CORE composables + every family member, via
 * `packages/use/families.json`) and, for each one, imports its module under
 * stubbed-absent `window`/`document`/`navigator` and asserts NO side-effect
 * global (`addEventListener`/`setTimeout`/`setInterval`/
 * `requestAnimationFrame`) was touched merely by EVALUATING the module.
 * "Forgot a row" is structurally impossible for import-time safety — there
 * is no row to forget, the discovery reads the tree itself. This is what
 * makes the two-tier split affordable past composable #25: Tier 1 scales to
 * 150 composables for free.
 *
 * TIER 2 — hand-written, CALL-time assertions. A composable that has a
 * *meaningful* no-op return shape under SSR (e.g. `useCounter()` should
 * still return a working `count()` getter, `useMouse()` should default to
 * `{x:0,y:0}`) needs a human to write down what "correct" looks like when
 * called — Tier 1 only proves "doesn't crash on import", not "behaves
 * correctly when called". The parity gate (`check-use-registry-parity.ts`)
 * REQUIRES a Tier-2 row exactly when the composable's own source references
 * `isClient` (mechanically checkable — pure `/math` composables with no DOM
 * touch are auto-exempt); otherwise it's optional. `entry` is
 * slash-qualified for a family member (`'math/useClamp'`), matching every
 * other manifest's join key.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withSSR } from './_ssr.ts'

type AnyFn = (...args: unknown[]) => unknown

/** Spy the side-effect globals for the duration of `run`, asserting none
 * was called. (With `window` stubbed absent, jsdom's globals still exist on
 * `globalThis` — a leaking composable would reach them there.) */
function withGlobalSpies(run: () => void): void {
  const g = globalThis as unknown as Record<string, AnyFn>
  const names = ['addEventListener', 'setTimeout', 'setInterval', 'requestAnimationFrame']
  const spies = names.filter((n) => typeof g[n] === 'function').map((n) => vi.spyOn(g, n))
  try {
    run()
    for (const s of spies) expect(s).not.toHaveBeenCalled()
  } finally {
    for (const s of spies) s.mockRestore()
  }
}

// ---------------------------------------------------------------------------
// Tier 1 — auto-discovered import-time safety
// ---------------------------------------------------------------------------

interface FamilyDef {
  aggregate: boolean
  autoImport: boolean
  peers: Record<string, string[]>
}

const SRC_DIR = join(import.meta.dirname, '../src')
const FAMILIES_PATH = join(import.meta.dirname, '../families.json')

function loadFamilies(): Record<string, FamilyDef> {
  if (!existsSync(FAMILIES_PATH)) return {}
  const parsed = JSON.parse(readFileSync(FAMILIES_PATH, 'utf8')) as {
    families?: Record<string, FamilyDef>
  }
  return parsed.families ?? {}
}

interface DiscoveredEntry {
  /** Slash-qualified for a family member (`math/useClamp`), bare for CORE. */
  name: string
  /** Relative to THIS file, for the dynamic `import()` below. */
  relPath: string
}

/** Every composable entry under `packages/use/src` — CORE dirs (excluding
 * `shared`) plus one level inside each declared family directory. Mirrors
 * `scripts/check-use-registry-parity.ts`'s `discoverComposableDirs`, kept as
 * a local copy (this file has no reason to import a `scripts/` script). */
function discoverEntries(): DiscoveredEntry[] {
  const families = loadFamilies()
  const out: DiscoveredEntry[] = []
  for (const entry of readdirSync(SRC_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'shared') continue
    if (families[entry.name]) {
      const familyDir = join(SRC_DIR, entry.name)
      for (const member of readdirSync(familyDir, { withFileTypes: true })) {
        if (!member.isDirectory()) continue
        if (existsSync(join(familyDir, member.name, 'index.ts'))) {
          out.push({
            name: `${entry.name}/${member.name}`,
            relPath: `../src/${entry.name}/${member.name}/index.ts`,
          })
        }
      }
      continue
    }
    if (existsSync(join(SRC_DIR, entry.name, 'index.ts'))) {
      out.push({ name: entry.name, relPath: `../src/${entry.name}/index.ts` })
    }
  }
  return out
}

/** Spies span the dynamic `import()` itself (module EVALUATION), not just a
 * subsequent call — that's the whole point of Tier 1. */
async function assertImportTimeIsClean(relPath: string): Promise<void> {
  await withSSR(
    async () => {
      const g = globalThis as unknown as Record<string, AnyFn>
      const names = ['addEventListener', 'setTimeout', 'setInterval', 'requestAnimationFrame']
      const spies = names.filter((n) => typeof g[n] === 'function').map((n) => vi.spyOn(g, n))
      try {
        // @vite-ignore — `relPath` is intentionally computed (discovered
        // from the src tree, not a literal); this is Vite's documented
        // escape hatch for a dynamic specifier it cannot statically analyze.
        await import(/* @vite-ignore */ relPath)
        for (const s of spies) expect(s).not.toHaveBeenCalled()
      } finally {
        for (const s of spies) s.mockRestore()
      }
    },
    () => {},
  )
}

describe('@aihu/use — Tier 1: auto-discovered import-time SSR safety', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  for (const { name, relPath } of discoverEntries()) {
    it(`${name}: importing the module under SSR touches no side-effect global`, () =>
      assertImportTimeIsClean(relPath))
  }
})

// ---------------------------------------------------------------------------
// Tier 2 — hand-written, call-time assertions
// ---------------------------------------------------------------------------

/** One row per composable whose CALLED behavior needs a human-written
 * assertion. New CORE composables MUST add a row; family composables should
 * whenever the parity gate requires one (source references `isClient`). */
const entries: Array<{ entry: string; run: () => Promise<void> }> = [
  {
    entry: 'createFocusTrap',
    run: () =>
      withSSR(
        () => import('../src/createFocusTrap/index.ts'),
        ({ createFocusTrap }) => {
          const trap = createFocusTrap(null)
          expect(() => {
            trap.activate()
            trap.deactivate()
          }).not.toThrow()
        },
      ),
  },
  {
    entry: 'useEventListener',
    run: () =>
      withSSR(
        () => import('../src/useEventListener/index.ts'),
        ({ useEventListener }) => {
          withGlobalSpies(() => {
            const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() }
            const el = target as unknown as Element
            // Static AND getter targets: nothing registered, stop is a no-op
            // (the isClient gate precedes the typeof-function branch, so no
            // effect is created either).
            const stopStatic = useEventListener(el, 'click', () => {})
            const stopGetter = useEventListener(
              () => el,
              'click',
              () => {},
            )
            expect(() => {
              stopStatic()
              stopGetter()
            }).not.toThrow()
            expect(target.addEventListener).not.toHaveBeenCalled()
            expect(target.removeEventListener).not.toHaveBeenCalled()
          })
        },
      ),
  },
  {
    entry: 'useEventListenerMap',
    run: () =>
      withSSR(
        () => import('../src/useEventListenerMap/index.ts'),
        ({ useEventListenerMap }) => {
          withGlobalSpies(() => {
            const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() }
            const el = target as unknown as Element
            // Static AND getter targets, multi-entry map: nothing
            // registered, combined stop is a no-op (the isClient gate in
            // the underlying useEventListener precedes the typeof-function
            // branch, so no effect is created either).
            const stopStatic = useEventListenerMap(el, { click: () => {}, mouseover: () => {} })
            const stopGetter = useEventListenerMap(() => el, { click: () => {} })
            expect(() => {
              stopStatic()
              stopGetter()
            }).not.toThrow()
            expect(target.addEventListener).not.toHaveBeenCalled()
            expect(target.removeEventListener).not.toHaveBeenCalled()
          })
        },
      ),
  },
  {
    entry: 'useMouse',
    run: () =>
      withSSR(
        () => import('../src/useMouse/index.ts'),
        ({ useMouse }) => {
          withGlobalSpies(() => {
            const { x, y } = useMouse({ initialValue: { x: 3, y: 4 } })
            expect(x()).toBe(3)
            expect(y()).toBe(4)
            const zero = useMouse()
            expect(zero.x()).toBe(0)
            expect(zero.y()).toBe(0)
          })
        },
      ),
  },
  {
    entry: 'useToggle',
    run: () =>
      withSSR(
        () => import('../src/useToggle/index.ts'),
        ({ useToggle }) => {
          withGlobalSpies(() => {
            const [on, toggle] = useToggle(true)
            expect(on()).toBe(true)
            expect(() => toggle()).not.toThrow()
            expect(on()).toBe(true)
          })
        },
      ),
  },
  {
    entry: 'useCounter',
    run: () =>
      withSSR(
        () => import('../src/useCounter/index.ts'),
        ({ useCounter }) => {
          withGlobalSpies(() => {
            const { count, inc, dec, set, reset } = useCounter({ initial: 3 })
            expect(count()).toBe(3)
            inc()
            dec()
            set(9)
            reset()
            expect(count()).toBe(3)
          })
        },
      ),
  },
  {
    entry: 'usePrevious',
    run: () =>
      withSSR(
        () => import('../src/usePrevious/index.ts'),
        ({ usePrevious }) => {
          withGlobalSpies(() => {
            const source = vi.fn(() => 1)
            const previous = usePrevious(source)
            expect(previous()).toBeUndefined()
            expect(source).not.toHaveBeenCalled()
          })
        },
      ),
  },
  {
    entry: 'useSupported',
    run: () =>
      withSSR(
        () => import('../src/useSupported/index.ts'),
        ({ useSupported }) => {
          withGlobalSpies(() => {
            const predicate = vi.fn(() => true)
            const supported = useSupported(predicate)
            expect(supported()).toBe(false)
            expect(predicate).not.toHaveBeenCalled()
          })
        },
      ),
  },
  {
    entry: 'useIntervalFn',
    run: () =>
      withSSR(
        () => import('../src/useIntervalFn/index.ts'),
        ({ useIntervalFn }) => {
          withGlobalSpies(() => {
            const { isActive, pause, resume } = useIntervalFn(() => {}, 100)
            expect(isActive()).toBe(false)
            expect(() => {
              pause()
              resume()
            }).not.toThrow()
          })
        },
      ),
  },
  {
    entry: 'useTimeoutFn',
    run: () =>
      withSSR(
        () => import('../src/useTimeoutFn/index.ts'),
        ({ useTimeoutFn }) => {
          withGlobalSpies(() => {
            const { isPending, start, stop } = useTimeoutFn(() => {}, 100)
            expect(isPending()).toBe(false)
            expect(() => {
              start()
              stop()
            }).not.toThrow()
          })
        },
      ),
  },
  {
    entry: 'useRafFn',
    run: () =>
      withSSR(
        () => import('../src/useRafFn/index.ts'),
        ({ useRafFn }) => {
          withGlobalSpies(() => {
            const { isActive, pause, resume } = useRafFn(() => {})
            expect(isActive()).toBe(false)
            expect(() => {
              pause()
              resume()
            }).not.toThrow()
          })
        },
      ),
  },
  {
    entry: 'useNow',
    run: () =>
      withSSR(
        () => import('../src/useNow/index.ts'),
        ({ useNow }) => {
          withGlobalSpies(() => {
            const { now } = useNow()
            expect(now()).toBeInstanceOf(Date)
            expect(now()).toBe(now())
          })
        },
      ),
  },
  {
    entry: 'useTimestamp',
    run: () =>
      withSSR(
        () => import('../src/useTimestamp/index.ts'),
        ({ useTimestamp }) => {
          withGlobalSpies(() => {
            const { timestamp, pause, resume } = useTimestamp()
            expect(typeof timestamp()).toBe('number')
            expect(timestamp()).toBe(timestamp())
            expect(() => {
              pause()
              resume()
            }).not.toThrow()
          })
        },
      ),
  },
  {
    entry: 'useInterval',
    run: () =>
      withSSR(
        () => import('../src/useInterval/index.ts'),
        ({ useInterval }) => {
          withGlobalSpies(() => {
            const { counter, reset, pause, resume } = useInterval(100)
            expect(counter()).toBe(0)
            expect(() => {
              reset()
              pause()
              resume()
            }).not.toThrow()
          })
        },
      ),
  },
  {
    entry: 'useTimeout',
    run: () =>
      withSSR(
        () => import('../src/useTimeout/index.ts'),
        ({ useTimeout }) => {
          withGlobalSpies(() => {
            const { ready, start, stop } = useTimeout(100)
            expect(ready()).toBe(false)
            expect(() => {
              start()
              stop()
            }).not.toThrow()
          })
        },
      ),
  },
  {
    entry: 'useTimer',
    run: () =>
      withSSR(
        () => import('../src/useTimer/index.ts'),
        ({ useTimer }) => {
          withGlobalSpies(() => {
            const { elapsed, isRunning, start, pause, resume, reset } = useTimer()
            expect(elapsed()).toBe(0)
            expect(isRunning()).toBe(false)
            expect(() => {
              start()
              pause()
              resume()
              reset()
            }).not.toThrow()
          })
        },
      ),
  },
  {
    entry: 'useCountdown',
    run: () =>
      withSSR(
        () => import('../src/useCountdown/index.ts'),
        ({ useCountdown }) => {
          withGlobalSpies(() => {
            const { remaining, isRunning, isComplete, start, pause, resume, reset } =
              useCountdown(1000)
            expect(remaining()).toBe(1000)
            expect(isRunning()).toBe(false)
            expect(isComplete()).toBe(false)
            expect(() => {
              start()
              pause()
              resume()
              reset()
            }).not.toThrow()
          })
        },
      ),
  },
  {
    entry: 'useStopwatch',
    run: () =>
      withSSR(
        () => import('../src/useStopwatch/index.ts'),
        ({ useStopwatch }) => {
          withGlobalSpies(() => {
            const { elapsed, laps, isRunning, start, pause, resume, lap, reset } = useStopwatch()
            expect(elapsed()).toBe(0)
            expect(laps()).toEqual([])
            expect(isRunning()).toBe(false)
            expect(() => {
              start()
              pause()
              resume()
              lap()
              reset()
            }).not.toThrow()
          })
        },
      ),
  },
  {
    entry: 'useTimeAgo',
    run: () =>
      withSSR(
        () => import('../src/useTimeAgo/index.ts'),
        ({ useTimeAgo }) => {
          withGlobalSpies(() => {
            const { timeAgo, pause, resume } = useTimeAgo(Date.now() - 60_000)
            expect(typeof timeAgo()).toBe('string')
            expect(() => {
              pause()
              resume()
            }).not.toThrow()
          })
        },
      ),
  },
  {
    entry: 'useDebounced',
    run: () =>
      withSSR(
        () => import('../src/useDebounced/index.ts'),
        ({ useDebounced }) => {
          withGlobalSpies(() => {
            const { value } = useDebounced(() => 7, 100)
            expect(value()).toBe(7)
          })
        },
      ),
  },
  {
    entry: 'useThrottle',
    run: () =>
      withSSR(
        () => import('../src/useThrottle/index.ts'),
        ({ useThrottle }) => {
          withGlobalSpies(() => {
            const { value } = useThrottle(() => 9, 100)
            expect(value()).toBe(9)
          })
        },
      ),
  },
  {
    entry: 'useElementSize',
    run: () =>
      withSSR(
        () => import('../src/useElementSize/index.ts'),
        ({ useElementSize }) => {
          withGlobalSpies(() => {
            const { width, height } = useElementSize({ initialSize: { width: 3, height: 4 } })
            expect(width()).toBe(3)
            expect(height()).toBe(4)
            const zero = useElementSize()
            expect(zero.width()).toBe(0)
            expect(zero.height()).toBe(0)
          })
        },
      ),
  },
  {
    entry: 'useElementVisibility',
    run: () =>
      withSSR(
        () => import('../src/useElementVisibility/index.ts'),
        ({ useElementVisibility }) => {
          withGlobalSpies(() => {
            const { isVisible } = useElementVisibility()
            expect(isVisible()).toBe(false)
            const truthy = useElementVisibility({ initialValue: true })
            expect(truthy.isVisible()).toBe(true)
          })
        },
      ),
  },
  {
    entry: 'useResizeObserver',
    run: () =>
      withSSR(
        () => import('../src/useResizeObserver/index.ts'),
        ({ useResizeObserver }) => {
          withGlobalSpies(() => {
            const callback = vi.fn()
            const { stop } = useResizeObserver(null, callback)
            expect(callback).not.toHaveBeenCalled()
            expect(() => stop()).not.toThrow()
          })
        },
      ),
  },
  {
    entry: 'useIntersectionObserver',
    run: () =>
      withSSR(
        () => import('../src/useIntersectionObserver/index.ts'),
        ({ useIntersectionObserver }) => {
          withGlobalSpies(() => {
            const callback = vi.fn()
            const { isActive, pause, resume, stop } = useIntersectionObserver(null, callback)
            expect(isActive()).toBe(false)
            expect(callback).not.toHaveBeenCalled()
            expect(() => {
              pause()
              resume()
              stop()
            }).not.toThrow()
          })
        },
      ),
  },
  {
    entry: 'useMutationObserver',
    run: () =>
      withSSR(
        () => import('../src/useMutationObserver/index.ts'),
        ({ useMutationObserver }) => {
          withGlobalSpies(() => {
            const callback = vi.fn()
            const { stop, takeRecords } = useMutationObserver(null, callback, {
              childList: true,
            })
            expect(callback).not.toHaveBeenCalled()
            expect(takeRecords()).toEqual([])
            expect(() => stop()).not.toThrow()
          })
        },
      ),
  },
  {
    entry: 'usePerformanceObserver',
    run: () =>
      withSSR(
        () => import('../src/usePerformanceObserver/index.ts'),
        ({ usePerformanceObserver }) => {
          withGlobalSpies(() => {
            const callback = vi.fn()
            const { stop } = usePerformanceObserver(callback, { entryTypes: ['mark'] })
            expect(callback).not.toHaveBeenCalled()
            expect(() => stop()).not.toThrow()
          })
        },
      ),
  },
  {
    entry: 'useBreakpoints',
    run: () =>
      withSSR(
        () => import('../src/useBreakpoints/index.ts'),
        ({ useBreakpoints }) => {
          withGlobalSpies(() => {
            const bp = useBreakpoints({ sm: 100, md: 200 })
            expect(bp.sm()).toBe(false)
            expect(bp.current()).toEqual([])
          })
        },
      ),
  },
  {
    entry: 'useDevicePixelRatio',
    run: () =>
      withSSR(
        () => import('../src/useDevicePixelRatio/index.ts'),
        ({ useDevicePixelRatio }) => {
          withGlobalSpies(() => {
            const { pixelRatio } = useDevicePixelRatio()
            expect(pixelRatio()).toBe(1)
          })
        },
      ),
  },
  {
    entry: 'useOrientation',
    run: () =>
      withSSR(
        () => import('../src/useOrientation/index.ts'),
        ({ useOrientation }) => {
          withGlobalSpies(() => {
            const { angle, type } = useOrientation()
            expect(angle()).toBe(0)
            expect(type()).toBe('portrait-primary')
          })
        },
      ),
  },
  {
    entry: 'useDeviceOrientation',
    run: () =>
      withSSR(
        () => import('../src/useDeviceOrientation/index.ts'),
        ({ useDeviceOrientation }) => {
          withGlobalSpies(() => {
            const { isSupported, alpha, beta, gamma, absolute } = useDeviceOrientation()
            expect(isSupported()).toBe(false)
            expect(alpha()).toBeNull()
            expect(beta()).toBeNull()
            expect(gamma()).toBeNull()
            expect(absolute()).toBe(false)
          })
        },
      ),
  },
  {
    entry: 'useDeviceMotion',
    run: () =>
      withSSR(
        () => import('../src/useDeviceMotion/index.ts'),
        ({ useDeviceMotion }) => {
          withGlobalSpies(() => {
            const { isSupported, acceleration, rotationRate, interval } = useDeviceMotion()
            expect(isSupported()).toBe(false)
            expect(acceleration()).toBeNull()
            expect(rotationRate()).toBeNull()
            expect(interval()).toBe(0)
          })
        },
      ),
  },
  {
    entry: 'usePageLeave',
    run: () =>
      withSSR(
        () => import('../src/usePageLeave/index.ts'),
        ({ usePageLeave }) => {
          withGlobalSpies(() => {
            const isLeft = usePageLeave()
            expect(isLeft()).toBe(false)
          })
        },
      ),
  },
  {
    entry: 'useScroll',
    run: () =>
      withSSR(
        () => import('../src/useScroll/index.ts'),
        ({ useScroll }) => {
          withGlobalSpies(() => {
            const { x, y } = useScroll({ initialValue: { x: 3, y: 4 } })
            expect(x()).toBe(3)
            expect(y()).toBe(4)
          })
        },
      ),
  },
  {
    entry: 'useWindowSize',
    run: () =>
      withSSR(
        () => import('../src/useWindowSize/index.ts'),
        ({ useWindowSize }) => {
          withGlobalSpies(() => {
            const { width, height } = useWindowSize({ initialWidth: 3, initialHeight: 4 })
            expect(width()).toBe(3)
            expect(height()).toBe(4)
            const zero = useWindowSize()
            expect(zero.width()).toBe(0)
            expect(zero.height()).toBe(0)
          })
        },
      ),
  },
  {
    entry: 'useMediaQuery',
    run: () =>
      withSSR(
        () => import('../src/useMediaQuery/index.ts'),
        ({ useMediaQuery }) => {
          withGlobalSpies(() => {
            const { matches } = useMediaQuery('(prefers-color-scheme: dark)')
            expect(matches()).toBe(false)
          })
        },
      ),
  },
  {
    entry: 'usePreferredDark',
    run: () =>
      withSSR(
        () => import('../src/usePreferredDark/index.ts'),
        ({ usePreferredDark }) => {
          withGlobalSpies(() => {
            const { prefersDark } = usePreferredDark()
            expect(prefersDark()).toBe(false)
          })
        },
      ),
  },
  {
    entry: 'usePreferredReducedMotion',
    run: () =>
      withSSR(
        () => import('../src/usePreferredReducedMotion/index.ts'),
        ({ usePreferredReducedMotion }) => {
          withGlobalSpies(() => {
            const { preference } = usePreferredReducedMotion()
            expect(preference()).toBe('no-preference')
          })
        },
      ),
  },
  {
    entry: 'usePreferredContrast',
    run: () =>
      withSSR(
        () => import('../src/usePreferredContrast/index.ts'),
        ({ usePreferredContrast }) => {
          withGlobalSpies(() => {
            const { preference } = usePreferredContrast()
            expect(preference()).toBe('no-preference')
          })
        },
      ),
  },
  {
    entry: 'usePreferredReducedTransparency',
    run: () =>
      withSSR(
        () => import('../src/usePreferredReducedTransparency/index.ts'),
        ({ usePreferredReducedTransparency }) => {
          withGlobalSpies(() => {
            const { preference } = usePreferredReducedTransparency()
            expect(preference()).toBe('no-preference')
          })
        },
      ),
  },
  {
    entry: 'usePreferredLanguages',
    run: () =>
      withSSR(
        () => import('../src/usePreferredLanguages/index.ts'),
        ({ usePreferredLanguages }) => {
          withGlobalSpies(() => {
            const { languages } = usePreferredLanguages()
            expect(languages()).toEqual([])
          })
        },
      ),
  },
  {
    entry: 'useBrowserLanguage',
    run: () =>
      withSSR(
        () => import('../src/useBrowserLanguage/index.ts'),
        ({ useBrowserLanguage }) => {
          withGlobalSpies(() => {
            const { language } = useBrowserLanguage()
            expect(language()).toBeUndefined()
          })
        },
      ),
  },
  {
    entry: 'useOperatingSystem',
    run: () =>
      withSSR(
        () => import('../src/useOperatingSystem/index.ts'),
        ({ useOperatingSystem }) => {
          withGlobalSpies(() => {
            const { os } = useOperatingSystem()
            expect(os()).toBe('unknown')
          })
        },
      ),
  },
  {
    entry: 'useTextDirection',
    run: () =>
      withSSR(
        () => import('../src/useTextDirection/index.ts'),
        ({ useTextDirection }) => {
          withGlobalSpies(() => {
            const { direction } = useTextDirection()
            expect(direction()).toBe('ltr')
          })
        },
      ),
  },
  {
    entry: 'useColorScheme',
    run: () =>
      withSSR(
        () => import('../src/useColorScheme/index.ts'),
        ({ useColorScheme }) => {
          withGlobalSpies(() => {
            const { scheme, resolved } = useColorScheme()
            expect(scheme()).toBe('auto')
            expect(resolved()).toBe('light')
          })
        },
      ),
  },
  {
    entry: 'useDocumentVisibility',
    run: () =>
      withSSR(
        () => import('../src/useDocumentVisibility/index.ts'),
        ({ useDocumentVisibility }) => {
          withGlobalSpies(() => {
            const { visibility } = useDocumentVisibility()
            expect(visibility()).toBe('visible')
          })
        },
      ),
  },
  {
    entry: 'useLocalStorage',
    run: () =>
      withSSR(
        () => import('../src/useLocalStorage/index.ts'),
        ({ useLocalStorage }) => {
          withGlobalSpies(() => {
            const { value, setValue } = useLocalStorage('k', 7)
            expect(value()).toBe(7)
            expect(() => setValue(8)).not.toThrow()
            expect(value()).toBe(7) // SSR setValue is a documented no-op
          })
        },
      ),
  },
  {
    entry: 'useClipboard',
    run: () =>
      withSSR(
        () => import('../src/useClipboard/index.ts'),
        ({ useClipboard }) => {
          withGlobalSpies(() => {
            const { isSupported, copied } = useClipboard()
            expect(isSupported()).toBe(false)
            expect(copied()).toBe(false)
          })
        },
      ),
  },
  {
    entry: 'motion/useReducedMotion',
    run: () =>
      withSSR(
        () => import('../src/motion/useReducedMotion/index.ts'),
        ({ useReducedMotion }) => {
          withGlobalSpies(() => {
            const { prefersReduced } = useReducedMotion()
            expect(prefersReduced()).toBe(false)
          })
        },
      ),
  },
  {
    entry: 'motion/useTypewriter',
    run: () =>
      withSSR(
        () => import('../src/motion/useTypewriter/index.ts'),
        ({ useTypewriter }) => {
          withGlobalSpies(() => {
            const { text, isDone } = useTypewriter('hello')
            expect(text()).toBe('hello')
            expect(isDone()).toBe(true)
          })
        },
      ),
  },
  {
    entry: 'motion/useCountTo',
    run: () =>
      withSSR(
        () => import('../src/motion/useCountTo/index.ts'),
        ({ useCountTo }) => {
          withGlobalSpies(() => {
            const { value, isCounting } = useCountTo({ from: 5 })
            expect(value()).toBe(5)
            expect(isCounting()).toBe(false)
          })
        },
      ),
  },
  {
    entry: 'motion/useTokenStream',
    run: () =>
      withSSR(
        () => import('../src/motion/useTokenStream/index.ts'),
        ({ useTokenStream }) => {
          withGlobalSpies(() => {
            const { tokens, isDone } = useTokenStream(['a', 'b'])
            expect(tokens()).toEqual(['a', 'b'])
            expect(isDone()).toBe(true)
          })
        },
      ),
  },
  {
    entry: 'motion/useSequence',
    run: () =>
      withSSR(
        () => import('../src/motion/useSequence/index.ts'),
        ({ useSequence }) => {
          withGlobalSpies(() => {
            const { current, isRunning } = useSequence(['a', 'b'])
            expect(current()).toBe('a')
            expect(isRunning()).toBe(false)
          })
        },
      ),
  },
  {
    entry: 'motion/useCanvasSurface',
    run: () =>
      withSSR(
        () => import('../src/motion/useCanvasSurface/index.ts'),
        ({ useCanvasSurface }) => {
          withGlobalSpies(() => {
            // The draw callback must never fire server-side — there is no
            // context to hand it, and a draw callback that runs under SSR is
            // exactly the crash this gate exists to prevent.
            const onFrame = vi.fn(() => {
              throw new Error('onFrame must not run under SSR')
            })
            const surface = useCanvasSurface(null, { onFrame })
            expect(surface.canvas()).toBeNull()
            expect(surface.ctx()).toBeNull()
            expect(surface.width()).toBe(0)
            expect(surface.pixelRatio()).toBe(1)
            expect(surface.isRunning()).toBe(false)
            surface.start()
            surface.redraw()
            expect(onFrame).not.toHaveBeenCalled()
          })
        },
      ),
  },
  {
    entry: 'motion/useParticleField',
    run: () =>
      withSSR(
        () => import('../src/motion/useParticleField/index.ts'),
        ({ useParticleField }) => {
          withGlobalSpies(() => {
            const { particles, canvas, isRunning, start } = useParticleField(null, { count: 20 })
            expect(particles()).toEqual([])
            expect(canvas()).toBeNull()
            expect(isRunning()).toBe(false)
            start()
            expect(particles()).toEqual([])
          })
        },
      ),
  },
  {
    entry: 'motion/useCharacterField',
    run: () =>
      withSSR(
        () => import('../src/motion/useCharacterField/index.ts'),
        ({ useCharacterField }) => {
          withGlobalSpies(() => {
            const { cells, columns, rows, isRunning, start } = useCharacterField(null)
            expect(cells()).toEqual([])
            expect(columns()).toBe(0)
            expect(rows()).toBe(0)
            expect(isRunning()).toBe(false)
            start()
            expect(cells()).toEqual([])
          })
        },
      ),
  },
  {
    entry: 'useWatch',
    run: () =>
      withSSR(
        () => import('../src/useWatch/index.ts'),
        ({ useWatch }) => {
          withGlobalSpies(() => {
            const callback = vi.fn(() => {
              throw new Error('callback must not run under SSR')
            })
            let stop: (() => void) | undefined
            expect(() => {
              stop = useWatch(() => 1, callback, { immediate: true })
            }).not.toThrow()
            expect(callback).not.toHaveBeenCalled()
            expect(() => stop?.()).not.toThrow()
          })
        },
      ),
  },
  {
    entry: 'useAsync',
    run: () =>
      withSSR(
        () => import('../src/useAsync/index.ts'),
        ({ useAsync }) => {
          withGlobalSpies(() => {
            const fn = vi.fn(async () => 'x')
            const { data, error, isLoading, isFinished, execute } = useAsync(fn, {
              initialData: 'seed',
            })
            expect(data()).toBe('seed')
            expect(error()).toBeUndefined()
            expect(isLoading()).toBe(false)
            expect(isFinished()).toBe(false)
            expect(fn).not.toHaveBeenCalled() // immediate is a documented no-op under SSR
            return execute().then((result) => {
              expect(result).toBeUndefined()
              expect(fn).not.toHaveBeenCalled()
              expect(data()).toBe('seed')
            })
          })
        },
      ),
  },
  {
    entry: 'useAsyncAbortable',
    run: () =>
      withSSR(
        () => import('../src/useAsyncAbortable/index.ts'),
        ({ useAsyncAbortable }) => {
          withGlobalSpies(() => {
            const fn = vi.fn(async () => 'x')
            const { data, isLoading, execute, abort } = useAsyncAbortable(fn, {
              initialData: 'seed',
            })
            expect(data()).toBe('seed')
            expect(isLoading()).toBe(false)
            expect(fn).not.toHaveBeenCalled()
            expect(() => abort()).not.toThrow()
            return execute().then((result) => {
              expect(result).toBeUndefined()
              expect(fn).not.toHaveBeenCalled()
            })
          })
        },
      ),
  },
  {
    entry: 'useKeyedAsync',
    run: () =>
      withSSR(
        () => import('../src/useKeyedAsync/index.ts'),
        ({ useKeyedAsync }) => {
          withGlobalSpies(() => {
            const fn = vi.fn(async () => 'x')
            const { data, error, isLoading, isFinished, reload } = useKeyedAsync(() => 'a', fn, {
              initialData: 'seed',
            })
            expect(data()).toBe('seed')
            expect(error()).toBeUndefined()
            expect(isLoading()).toBe(false)
            expect(isFinished()).toBe(false)
            expect(fn).not.toHaveBeenCalled() // useWatch()'s immediate is a documented no-op under SSR
            expect(() => reload()).not.toThrow()
            expect(fn).not.toHaveBeenCalled()
          })
        },
      ),
  },
  {
    entry: 'useNetworkState',
    run: () =>
      withSSR(
        () => import('../src/useNetworkState/index.ts'),
        ({ useNetworkState }) => {
          withGlobalSpies(() => {
            const { isOnline, effectiveType, isSupported } = useNetworkState()
            expect(isOnline()).toBe(true)
            expect(effectiveType()).toBeUndefined()
            expect(isSupported()).toBe(false)
          })
        },
      ),
  },
  {
    entry: 'useIdle',
    run: () =>
      withSSR(
        () => import('../src/useIdle/index.ts'),
        ({ useIdle }) => {
          withGlobalSpies(() => {
            const { idle, lastActive, reset } = useIdle({ initialState: true })
            expect(idle()).toBe(true)
            expect(lastActive()).toBe(0)
            expect(() => reset()).not.toThrow()
            expect(idle()).toBe(true) // reset is a documented no-op under SSR
          })
        },
      ),
  },
  {
    entry: 'useMap',
    run: () =>
      withSSR(
        () => import('../src/useMap/index.ts'),
        ({ useMap }) => {
          withGlobalSpies(() => {
            const { size, get, has, set, delete: del } = useMap<string, number>([['a', 1]])
            expect(size()).toBe(1)
            expect(get('a')).toBe(1)
            expect(has('a')).toBe(true)
            set('b', 2)
            expect(size()).toBe(1) // SSR mutators are documented no-ops
            expect(del('a')).toBe(false)
          })
        },
      ),
  },
  {
    entry: 'useSet',
    run: () =>
      withSSR(
        () => import('../src/useSet/index.ts'),
        ({ useSet }) => {
          withGlobalSpies(() => {
            const { size, has, add, delete: del } = useSet<string>(['a'])
            expect(size()).toBe(1)
            expect(has('a')).toBe(true)
            add('b')
            expect(size()).toBe(1) // SSR mutators are documented no-ops
            expect(del('a')).toBe(false)
          })
        },
      ),
  },
  {
    entry: 'useMeasure',
    run: () =>
      withSSR(
        () => import('../src/useMeasure/index.ts'),
        ({ useMeasure }) => {
          withGlobalSpies(() => {
            const { x, width, height } = useMeasure({ initialRect: { x: 3, width: 4, height: 5 } })
            expect(x()).toBe(3)
            expect(width()).toBe(4)
            expect(height()).toBe(5)
            const zero = useMeasure()
            expect(zero.top()).toBe(0)
          })
        },
      ),
  },
  {
    entry: 'useFocusWithin',
    run: () =>
      withSSR(
        () => import('../src/useFocusWithin/index.ts'),
        ({ useFocusWithin }) => {
          withGlobalSpies(() => {
            const { focused } = useFocusWithin()
            expect(focused()).toBe(false)
          })
        },
      ),
  },
  {
    entry: 'useActiveElement',
    run: () =>
      withSSR(
        () => import('../src/useActiveElement/index.ts'),
        ({ useActiveElement }) => {
          withGlobalSpies(() => {
            const { activeElement } = useActiveElement()
            expect(activeElement()).toBeNull()
          })
        },
      ),
  },
  {
    entry: 'useClickOutside',
    run: () =>
      withSSR(
        () => import('../src/useClickOutside/index.ts'),
        ({ useClickOutside }) => {
          withGlobalSpies(() => {
            const handler = vi.fn()
            const stop = useClickOutside(null, handler)
            expect(() => stop()).not.toThrow()
            expect(handler).not.toHaveBeenCalled()
          })
        },
      ),
  },
  {
    entry: 'useHover',
    run: () =>
      withSSR(
        () => import('../src/useHover/index.ts'),
        ({ useHover }) => {
          withGlobalSpies(() => {
            const { isHovering } = useHover()
            expect(isHovering()).toBe(false)
          })
        },
      ),
  },
  {
    entry: 'useMouseInElement',
    run: () =>
      withSSR(
        () => import('../src/useMouseInElement/index.ts'),
        ({ useMouseInElement }) => {
          withGlobalSpies(() => {
            const { x, y, isOutside } = useMouseInElement()
            expect(x()).toBe(0)
            expect(y()).toBe(0)
            expect(isOutside()).toBe(true)
          })
        },
      ),
  },
]

describe('@aihu/use — Tier 2: hand-written call-time SSR safety (isClient no-op invariant)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  for (const { entry, run } of entries) {
    it(`${entry}: zero side effects under simulated SSR`, run)
  }

  it('shared: isClient is false and the default globals are undefined under SSR', () =>
    withSSR(
      () => import('../src/shared/index.ts'),
      (shared) => {
        expect(shared.isClient).toBe(false)
        expect(shared.defaultWindow).toBeUndefined()
        expect(shared.defaultDocument).toBeUndefined()
        expect(shared.defaultNavigator).toBeUndefined()
      },
    ))

  it('shared: tryOnMounted is a no-op under SSR', () =>
    withSSR(
      () => import('../src/shared/index.ts'),
      (shared) => {
        const fn = vi.fn()
        shared.tryOnMounted(fn)
        expect(fn).not.toHaveBeenCalled()
      },
    ))
})
