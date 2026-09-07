import type { Dispose } from '@aihu/signals'
import type { AttrMap, ErrorHandler, EventHandler } from './types.ts'

export const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Compiler-only AttrMap key prefix for component properties whose names look
 * like DOM event handlers (for example `onSave`). Event handlers have the
 * explicit `on:<event>` template syntax, so these must bypass Arbor's `onX`
 * listener shortcut and be assigned to the custom element property verbatim.
 */
export const COMPONENT_PROP_PREFIX = '__aihu_prop:'

/**
 * Internal AttrMap binding per `.team/phase-3/spec-arbor.md` §1.2 + §2.4
 * + §2.7 (Task 15).
 *
 * Three detection paths run in this precedence order:
 *
 *   1. **Event handler** — `key.startsWith('on')` AND
 *      `typeof value === 'function'` AND `!Array.isArray(value)`.
 *      Wired via `el.addEventListener(key.slice(2).toLowerCase(),
 *      value)`. No dispose registered (spec §2.4 + §7 Q3: GC'd when
 *      DOM node is removed).
 *
 *   2. **Reactive signal** — `Array.isArray(value)`. `value[0]` is the
 *      getter (Signal is the tuple `readonly [Read<T>, Write<T>]`).
 *      Wired through `mountEffect` so the DOM property/attribute
 *      tracks the signal. The path key per §2.7 is
 *      `<pathBase>.attr:<key>` (e.g. `0.1.attr:class`).
 *
 *   3. **Static primitive** — `string | number | boolean`. Set once
 *      via `_setAttrOrProp` at mount; never re-applied.
 *
 * `_setAttrOrProp` resolves the property-vs-attribute split per spec
 * §2.4: `key in el` → `el[key] = value` (handles `disabled`,
 * `checked`, `value`, `className`, etc.); else
 * `el.setAttribute(key, String(value))`.
 *
 * **Dependency injection.** `mountEffect` is passed in as a parameter
 * rather than imported. The real `_mountEffect` lives in `mount.ts`
 * (Task 16); this module is testable in isolation against a mock spy
 * and stays free of circular imports between `attrs.ts` and
 * `mount.ts` once `_materialize` wires both together.
 *
 * Plan 3.2: optional `registry` parameter added. When provided, reactive
 * signal getters are registered by path key for `MountScope.serialize()`.
 */

/**
 * Signature of `_mountEffect` as `_applyAttrs` consumes it. The real
 * implementation lands in `mount.ts` (Task 16); a mock satisfies the
 * shape for unit tests in this batch.
 *
 * @internal
 */
export type MountEffectFn = (
  disposers: Dispose[],
  fn: () => void,
  path: string,
  errorHandler?: ErrorHandler,
) => void

/**
 * Apply an AttrMap to a freshly-created element. Walks each
 * `[key, value]` entry and dispatches to one of three detection paths
 * (event handler, reactive signal, static primitive).
 *
 * Per spec §2.7 each reactive binding's path key is constructed as
 * `<pathBase>.attr:<key>` so sub-projects #6 and #7 can address
 * subscriptions by stable identity later.
 *
 * `attrs === null` is the no-op shape-locked case (per spec §2.9 the
 * factories normalize omitted attrs to `null`, never `undefined`).
 *
 * Plan 3.2: optional `registry` parameter — when provided, reactive
 * signal getters are stored by path so `serialize()` can read them.
 *
 * @internal
 */
export function _applyAttrs(
  el: Element,
  attrs: AttrMap | null,
  disposers: Dispose[],
  pathBase: string,
  mountEffect: MountEffectFn,
  errorHandler?: ErrorHandler,
  registry?: Map<string, () => unknown>,
): void {
  if (!attrs) return
  for (const key in attrs) {
    const value = attrs[key]
    // Component properties named `onX` need an unambiguous path around the
    // event-handler heuristic below. This is emitted only by the compiler;
    // keep its reactive behavior identical to an ordinary property binding.
    if (key.startsWith(COMPONENT_PROP_PREFIX)) {
      const prop = key.slice(COMPONENT_PROP_PREFIX.length)
      if (Array.isArray(value)) {
        const get = value[0] as () => unknown
        const path = `${pathBase}.prop:${prop}`
        registry?.set(path, get)
        mountEffect(
          disposers,
          () => {
            ;(el as unknown as Record<string, unknown>)[prop] = get()
          },
          path,
          errorHandler,
        )
      } else {
        ;(el as unknown as Record<string, unknown>)[prop] = value
      }
      continue
    }
    // Path 1: event handler. Function values under `onX` keys win
    // ahead of the static-primitive path (which would `String()` the
    // function) and ahead of the array check (functions aren't
    // arrays anyway, so order vs path 2 doesn't matter).
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventHandler)
      continue
    }
    // Path 2: reactive signal. The Signal tuple `[Read, Write]`
    // discriminates via `Array.isArray` per Deviation #11.
    if (Array.isArray(value)) {
      const get = value[0] as () => unknown
      const path = `${pathBase}.attr:${key}`
      registry?.set(path, get)
      // Resolve the property-vs-attribute split ONCE at bind time — it is
      // determined by the element's prototype and namespace, which never
      // change. The effect body then does a bare assignment per update
      // instead of re-running the `namespaceURI` + `key in el` checks.
      const asProp = el.namespaceURI !== SVG_NS && key in el
      mountEffect(
        disposers,
        asProp
          ? () => {
              ;(el as unknown as Record<string, unknown>)[key] = get()
            }
          : () => el.setAttribute(key, String(get())),
        path,
        errorHandler,
      )
      continue
    }
    // Path 3: static primitive (string | number | boolean).
    _setAttrOrProp(el, key, value)
  }
}

/**
 * Property-vs-attribute split per spec §2.4. `key in el` covers DOM
 * properties like `disabled`, `checked`, `value`, `className`,
 * `selected`. Falling through to `setAttribute` covers `class`,
 * `data-*`, ARIA attributes, and any custom attribute the element
 * type doesn't expose as a property.
 *
 * The `String(value)` coercion on the attribute path lets numbers and
 * booleans round-trip through HTML attribute strings.
 *
 * @internal
 */
export function _setAttrOrProp(el: Element, key: string, value: unknown): void {
  // SVG elements expose properties like viewBox as SVGAnimated* objects which
  // are read-only. Always use setAttribute for SVG namespace elements.
  if (el.namespaceURI === SVG_NS) {
    el.setAttribute(key, String(value))
  } else if (key in el) {
    ;(el as unknown as Record<string, unknown>)[key] = value
  } else {
    el.setAttribute(key, String(value))
  }
}
