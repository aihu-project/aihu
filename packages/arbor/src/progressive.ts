/**
 * Dependency-free DOM positioning for framework behavior packages.
 *
 * Styling providers may build on this utility, but it deliberately does not
 * select a style strategy or require a CSS implementation.
 */

/** Where to place a floating element relative to its anchor. */
export type Placement = 'top' | 'bottom' | 'left' | 'right'

export interface PositionOptions {
  /** Preferred side. Default `'bottom'`. */
  placement?: Placement
  /** Gap between anchor and floating element, in px. Default `4`. */
  offset?: number
  /** Flip to the opposite side when the preferred side overflows. Default `true`. */
  flip?: boolean
}

const OPPOSITE: Record<Placement, Placement> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
}

function computeXY(
  anchor: DOMRect,
  floating: { width: number; height: number },
  placement: Placement,
  offset: number,
): { x: number; y: number } {
  switch (placement) {
    case 'top':
      return {
        x: anchor.left + (anchor.width - floating.width) / 2,
        y: anchor.top - floating.height - offset,
      }
    case 'bottom':
      return {
        x: anchor.left + (anchor.width - floating.width) / 2,
        y: anchor.bottom + offset,
      }
    case 'left':
      return {
        x: anchor.left - floating.width - offset,
        y: anchor.top + (anchor.height - floating.height) / 2,
      }
    case 'right':
      return {
        x: anchor.right + offset,
        y: anchor.top + (anchor.height - floating.height) / 2,
      }
  }
}

function overflows(x: number, y: number, width: number, height: number): boolean {
  return x < 0 || y < 0 || x + width > window.innerWidth || y + height > window.innerHeight
}

/**
 * Position `floating` against `anchor` using fixed coordinates and return the
 * placement that was applied after collision flipping.
 */
export function position(
  anchor: Element,
  floating: HTMLElement,
  options: PositionOptions = {},
): Placement {
  const placement = options.placement ?? 'bottom'
  const offset = options.offset ?? 4
  const flip = options.flip ?? true
  const anchorRect = anchor.getBoundingClientRect()
  const floatingRect = { width: floating.offsetWidth, height: floating.offsetHeight }

  let resolved = placement
  let { x, y } = computeXY(anchorRect, floatingRect, resolved, offset)

  if (flip && overflows(x, y, floatingRect.width, floatingRect.height)) {
    const alternate = OPPOSITE[resolved]
    const alternateXY = computeXY(anchorRect, floatingRect, alternate, offset)
    if (!overflows(alternateXY.x, alternateXY.y, floatingRect.width, floatingRect.height)) {
      resolved = alternate
      x = alternateXY.x
      y = alternateXY.y
    }
  }

  floating.style.position = 'fixed'
  floating.style.left = `${Math.round(x)}px`
  floating.style.top = `${Math.round(y)}px`
  return resolved
}
