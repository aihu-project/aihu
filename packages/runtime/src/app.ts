/**
 * Integration bridge for `@aihu/app`.
 *
 * The app bootstrap needs to wire the renderer and signal implementation into
 * the runtime, plus establish the app-root context owner. Keep that bridge in
 * a named subpath so the meta-framework integration depends on an explicit
 * contract instead of the runtime's entire public barrel.
 *
 * These functions remain underscored because they are not application API.
 * `@aihu/app` is the supported caller; the subpath exists to make that
 * ownership visible to package consumers and future repository extraction.
 */
export {
  _setHydrate,
  _setMount,
  _setSignal,
  _withOwnerContext,
} from './define-component.ts'
