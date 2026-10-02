// Browser runtime exports — must stay within the 1536 B size budget.
// Build-time plugin exports live in @aihu/router/plugin (src/plugin.ts).

// v0.7.1 — isomorphic router middleware primitives
export type { RouteMatchContext, RouterMiddleware, RouterResult } from './middleware.ts'
export { composeRouterMiddleware, defineRouterMiddleware } from './middleware.ts'
export type {
  AfterGuard,
  BeforeGuard,
  MatchResult,
  NextFn,
  RouteDefinition,
  RouteHead,
  RouteModule,
  Router,
  RouteSegment,
} from './router.ts'
export { createRouter } from './router.ts'

// arch-5 M1 — reactive routing primitives (RFC-A5-010 .. RFC-A5-016)
export type { NavigateOptions, PrefetchMode, RouteContextValue } from './runtime.ts'
export {
  __router_registerAfterGuard,
  __router_registerBeforeGuard,
  bindRouteSignalWriter,
  createPrefetcher,
  createRouteSignal,
  isActiveRouteLink,
  navigate,
  provideRouteContext,
  RouteContext,
  scrollAfterNavigation,
  shouldInterceptLinkClick,
  useRoute,
  useRouter,
} from './runtime.ts'
