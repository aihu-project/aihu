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

// Deliberately STALE (missing useFixtureBeta) — the "should-flag" half of
// check-gate-wiring.ts's negative-fixture proof for check:composable-registry.
export const COMPOSABLE_REGISTRY: readonly ComposableRegistryEntry[] = [
  { name: 'useFixtureAlpha', specifier: '@aihu/use/useFixtureAlpha', description: '' },
]
