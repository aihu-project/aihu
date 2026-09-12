# TODOS

Deferred items captured during plan reviews. Each has enough context to act on cold.

---

## TODO-001: GitHub Actions release workflow for pre-built aihu-compile binaries — DONE

**2026-09-10:** the compiler is now its own repo (`aihu-project/aihu-compiler`,
extracted since this was filed) and already has `release.yml`. No action
needed here; if the release matrix needs changes, file against that repo
directly.

<details><summary>Original item</summary>

**What:** Write `.github/workflows/release.yml` that cross-compiles `aihu-compile` for `mac-arm64`, `mac-x64`, `linux-x64`, `windows-x64` and publishes to GitHub Releases on version tags.

**Why:** Without pre-built binaries, `TTHW_UI` is gated behind `cargo build --release` (4-10 minutes). With binaries, the `@aihu/compiler` postinstall script downloads the correct binary in <30 seconds. This is the single biggest TTHW improvement for the compiler DX.

**Status:** MOVED TO Phase 1-DX SCOPE (build now, not defer). Captured here for tracking.

**How to start:** Use `cross` crate for cross-compilation. Target matrix: `aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-unknown-linux-gnu`, `x86_64-pc-windows-msvc`. Trigger on `push: tags: ['v*']`. Upload binaries to GitHub Release assets. Update `packages/compiler/js/index.ts` postinstall to download from `releases/latest/download/aihu-compile-{platform}`.

**Depends on:** Phase 1-compiler (binary must build successfully first).

</details>

---

## TODO-002: `batch()` wrapping for initial attribute parsing

**What:** Investigate whether the compiler-emitted `connectedCallback` should wrap initial attribute set operations in `batch()` from `@aihu/signals`.

**Why:** When a custom element with 5+ inputs connects to the DOM, the browser fires `attributeChangedCallback` once per attribute. Each callback calls a signal setter, which may trigger a reactive update. With 10 inputs, that's 10 individual updates before the element is fully initialized. `batch(() => { ... })` collapses them to one. Current benchmarks show this is not a problem for 1-3 inputs (Phase 1 examples), but it becomes measurable above 5.

**How to apply:** In Phase 2 performance review, benchmark a 10-input component with and without batch wrapping. If Δ > 10% on targeted-update bench, add `batch()` to the emitter's `connectedCallback` pattern.

**Depends on:** Phase 1-compiler complete. Phase 2 benchmark harness.

---

## TODO-003: `string!` required-attribute syntax

**What:** Design and implement `input label: string!` syntax for inputs that are required (no default, must always be provided by the HTML author or MCP caller).

**Why:** With the RC-3 reversal, `input label: string` without a default silently coerces to `''`. This is correct for optional inputs but ambiguous for truly required ones. A developer writing a label component genuinely wants `label` to always be provided — the current grammar gives no way to express this intent, and the empty string fallback will produce unexpected UI.

**Context:** RC-3 was reversed after outside voice challenge (D10). The `string!` syntax is the right long-term solution but was out-of-scope for Phase 1. The `''` fallback is the Phase 1 behavior; the canonical attribute-value contract now lives in `docs/superpowers/specs/2026-05-02-spec-template-attribute-syntax.md` (the `docs/grammar.md` file describing the v0 form has been removed).

**How to start:** Add `string!` as a new type in the agent-block grammar BNF. Emit: no fallback, no coercion — if attribute absent, SCR-C009 runtime warning (not error). The `!` communicates "caller must provide this."

**Depends on:** Phase 1-compiler grammar stable. Phase 2 grammar additions.
