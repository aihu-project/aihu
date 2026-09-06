/**
 * `@aihu/css-engine/runtime/progressive` — runtime fallbacks for the
 * `@supports`-gated progressive features (`anchor:`, `popover:`).
 *
 * This is the **separate** browser sub-export from `cn` (Plan 3 Risk #4
 * size-split): merging the two would blow `cn`'s 1 KB budget. This module
 * carries the heavier positioning code under its own 3 KB row.
 *
 * Core DOM positioning lives in `@aihu/arbor/progressive`. This compatibility
 * façade retains the CSS-provider fallback API for existing consumers while
 * allowing headless primitives to work with no CSS provider. Only loaded when
 * native CSS anchor positioning / the Popover API is unsupported (the engine emits a
 * `/* aihu:progressive-fallback ... *​/` marker the consumer wires to these).
 */

import { type Placement, type PositionOptions, position } from '@aihu/arbor/progressive'

export { type Placement, type PositionOptions, position }

/**
 * Fallback for the `anchor:` feature: position `floating` against `anchor`
 * with JS when native CSS anchor positioning is unsupported. Re-positions on
 * scroll/resize; returns a cleanup function that removes the listeners.
 */
export function anchorFallback(
  anchor: Element,
  floating: HTMLElement,
  opts: PositionOptions = {},
): () => void {
  const update = () => {
    position(anchor, floating, opts)
  }
  update()
  window.addEventListener('scroll', update, { passive: true, capture: true })
  window.addEventListener('resize', update, { passive: true })
  return () => {
    window.removeEventListener('scroll', update, { capture: true } as EventListenerOptions)
    window.removeEventListener('resize', update)
  }
}

/**
 * Portal `el` to a top-layer-emulating container appended to `<body>` with a
 * high z-index. Returns a restore function that moves `el` back to its original
 * parent and removes the container. Used by `popoverFallback` when the native
 * Popover API (and its real top layer) is unavailable.
 */
export function portal(el: HTMLElement): () => void {
  const originalParent = el.parentNode
  const originalNext = el.nextSibling
  const layer = document.createElement('div')
  layer.style.position = 'fixed'
  layer.style.left = '0'
  layer.style.top = '0'
  layer.style.zIndex = '2147483647'
  document.body.appendChild(layer)
  layer.appendChild(el)
  return () => {
    if (originalParent) {
      originalParent.insertBefore(el, originalNext)
    } else {
      el.remove()
    }
    layer.remove()
  }
}

/**
 * Fallback for the `popover:` feature: emulate the Popover API's top layer by
 * portaling `panel` out of the normal flow and positioning it against `anchor`
 * with the SHARED positioning shim (`position`, also used by `anchorFallback`).
 * Returns a cleanup function that tears down the portal + listeners.
 */
export function popoverFallback(
  anchor: Element,
  panel: HTMLElement,
  opts: PositionOptions = {},
): () => void {
  const restore = portal(panel)
  const update = () => {
    position(anchor, panel, opts)
  }
  update()
  window.addEventListener('scroll', update, { passive: true, capture: true })
  window.addEventListener('resize', update, { passive: true })
  return () => {
    window.removeEventListener('scroll', update, { capture: true } as EventListenerOptions)
    window.removeEventListener('resize', update)
    restore()
  }
}
