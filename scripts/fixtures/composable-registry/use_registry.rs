//! Fixture for check-gate-wiring.ts's negative-fixture proof of
//! `check:composable-registry` (FEL-342). Not real compiler source — a
//! two-entry stand-in for the standalone compiler registry's `USE_COMPOSABLES`,
//! small enough that a hand-edited "committed" registry
//! can be verified stale/fresh by eye.

pub(crate) const USE_COMPOSABLES: &[(&str, &str)] = &[
    ("useFixtureAlpha", "@aihu/use/useFixtureAlpha"),
    ("useFixtureBeta", "@aihu/use/useFixtureBeta"),
];
