/** @internal */
/** @internal */

// arch-5 M1 a11y primitives — RFC-A5-017..021. Pure tree-shakable helpers;
// only consumed by SFCs that use <focusTrap> / $announce / sr-only / skip-link
// lowerings.
export { _ensureA11yStyles, announce, createFocusTrap } from './a11y.ts'
// T6 (go-public demo) — per-instance agent dispatcher registry. Closes the
// capability-bridge Step-0 gap: the compiler injects `_registerAgentDispatcher`
// inside setup; the browser bridge reads it via `_takeAgentDispatcher`.
export type {
  InstanceAgentDispatcher,
  InstanceAgentServerBinding,
} from './agent-dispatch.ts'
export {
  _registerAgentDispatcher,
  _registerAgentServerBinding,
  _takeAgentDispatcher,
  _takeAgentServerBinding,
} from './agent-dispatch.ts'
export {
  _hmrReplace,
  _onAdopt as onAdopt,
  _onAfterRender as onAfterRender,
  _onAttributeChange as onAttributeChange,
  _onCleanup as onCleanup,
  _onCommit as onCommit,
  _onMount as onMount,
  // @internal — reused by `@aihu/arbor`'s top-level hydrate walk (aihu-runtime#4)
  _projectLightDomSlot,
  _setHydrate,
  _setMount,
  _setSignal,
  _withOwnerContext,
  defineComponent,
} from './define-component.ts'
/** @internal */
export { defineElement } from './define-element.ts'
/** @internal */
export { _hydrateOnVisible } from './hydrate-on-visible.ts'
export type { ResourceHandle } from './resource.ts'
// createResource: async-resource primitive for the plain `$resource` collection.
export { createResource } from './resource.ts'
export type { StreamHandle, StreamStatus } from './stream.ts'
// v0.4.0 — createStream: lazy-attach streaming primitive for $stream collection.
export { createStream } from './stream.ts'
export type {
  ComponentOptions,
  DefineOptions,
  PropDef,
  PropSignal,
  PropsConfig,
  Setup,
  SetupContext,
  ShadowMode,
} from './types.ts'
// The one DOM `ShadowRootMode` aihu attaches with. Exported so the SSR
// emitter's `<template shadowrootmode="…">` value (`ssr-string.ts`) can import
// it directly rather than duplicate it as a bare literal — see its doc comment.
export { SHADOW_ROOT_MODE } from './types.ts'
