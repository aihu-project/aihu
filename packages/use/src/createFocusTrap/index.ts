/**
 * `createFocusTrap` — accessible dialog focus lifecycle, backed by the
 * canonical composed-tree implementation in `@aihu/primitives`.
 */
import { createFocusTrap as createPrimitiveFocusTrap } from '@aihu/primitives/focus-trap'
import { isClient, tryOnScopeDispose } from '../shared/index.ts'

export type FocusTarget = HTMLElement | null | (() => HTMLElement | null)
export interface CreateFocusTrapOptions {
  initialFocus?: FocusTarget
  returnFocus?: FocusTarget
  inertTargets?: HTMLElement[]
  onEscape?: () => void
}
export interface FocusTrap {
  activate(): void
  deactivate(): void
}
type ContainerTarget = Element | null | (() => Element | null)

function resolve<T>(target: T | (() => T) | undefined): T | undefined {
  return typeof target === 'function' ? (target as () => T)() : target
}

export function createFocusTrap(
  container: ContainerTarget,
  options: CreateFocusTrapOptions = {},
): FocusTrap {
  let active = false
  let root: Element | null = null
  let previouslyFocused: HTMLElement | null = null
  let primitive: ReturnType<typeof createPrimitiveFocusTrap> | undefined
  let disconnectObserver: MutationObserver | undefined
  let inertBefore: Array<[HTMLElement, boolean]> = []

  const onKeydown = (event: KeyboardEvent): void => {
    if (active && event.key === 'Escape') options.onEscape?.()
  }

  const deactivate = (): void => {
    if (!active) return
    active = false
    document.removeEventListener('keydown', onKeydown, true)
    disconnectObserver?.disconnect()
    disconnectObserver = undefined
    primitive?.deactivate()
    primitive = undefined
    for (const [target, wasInert] of inertBefore) target.inert = wasInert
    inertBefore = []

    const explicit = resolve(options.returnFocus)
    const target = explicit?.isConnected
      ? explicit
      : previouslyFocused?.isConnected
        ? previouslyFocused
        : null
    if (target) target.focus()
    else if (root?.isConnected) {
      const fallback = root as HTMLElement
      if (!fallback.hasAttribute('tabindex')) fallback.tabIndex = -1
      fallback.focus()
    } else document.body?.focus()
    previouslyFocused = null
    root = null
  }

  const activate = (): void => {
    if (!isClient || active) return
    const resolved = resolve(container)
    if (!resolved) return
    active = true
    root = resolved
    previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    inertBefore = [...new Set(options.inertTargets ?? [])].map((target) => [target, target.inert])
    for (const [target] of inertBefore) target.inert = true

    // The primitives implementation owns composed-tree discovery and Tab
    // containment. Its own return behavior is disabled because this adapter
    // supports explicit fallback targets and restores inert state as well.
    primitive = createPrimitiveFocusTrap(resolved, { returnFocus: false })
    primitive.activate()
    resolve(options.initialFocus)?.focus()
    document.addEventListener('keydown', onKeydown, true)

    if (typeof MutationObserver !== 'undefined' && resolved.isConnected) {
      disconnectObserver = new MutationObserver(() => {
        if (!resolved.isConnected) deactivate()
      })
      disconnectObserver.observe(document, { childList: true, subtree: true })
    }
  }

  tryOnScopeDispose(deactivate)
  return { activate, deactivate }
}
