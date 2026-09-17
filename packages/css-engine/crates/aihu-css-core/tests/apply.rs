//! `@apply` expansion edge matrix (Task 1.4 — R-APPLY-PARSE, R-APPLY-TESTS).
//!
//! Drives `compile_sfc_scoped` with authored `@style` blocks containing `@apply`
//! directives and snapshots the folded output. The matrix (per R-APPLY-TESTS):
//! base; single variant → nested; multi-token `@apply a b c`; multiple `@apply`
//! per rule; `@apply` in a nested rule; arbitrary-value `bg-[#fff]`; unknown-
//! utility error; `$global` variant rejection.

use aihu_css_core::{compile_sfc_scoped, parse_ast, CompileError, SfcStyleScope};

/// Build an SFC AST with the given authored `@style` content + scope. No
/// template classes so the snapshot is JUST theme tokens + the folded `@style`,
/// isolating the `@apply` expansion.
fn sfc_style(content: &str, scope: &str) -> aihu_css_core::SfcAst {
    let json = format!(
        r#"{{"tag":"X","astVersion":1,
          "style":{{"content":{content},"scope":"{scope}"}},
          "meta":{{"name":"X"}},"template":null}}"#,
        content = serde_json::to_string(content).unwrap()
    );
    parse_ast(&json).unwrap()
}

fn scoped(content: &str) -> String {
    compile_sfc_scoped(&sfc_style(content, "scoped")).unwrap()
}

/// Compile via `expand_apply` directly (parser → expand → css) so the snapshot
/// is just the expanded `@style`, with no theme-token preamble.
fn expand(content: &str, scope: SfcStyleScope) -> Result<String, CompileError> {
    aihu_css_core::expand_apply(content, scope, &aihu_css_core::ThemeRegistry::with_aihu_defaults())
}

// ── base utility inline ──────────────────────────────────────────────────────

#[test]
fn base_utility_inlines_declarations() {
    let css = expand(".btn { @apply inline-flex items-center; }", SfcStyleScope::Scoped).unwrap();
    insta::assert_snapshot!(css);
}

// ── single variant → nested rule ─────────────────────────────────────────────

#[test]
fn single_variant_lifts_to_nested_rule() {
    // hover: → &:hover { … } on the recipe's OWN selector (NOT a
    // `.hover\:bg-accent:hover` class rule).
    let css = expand(".btn { @apply hover:bg-accent; }", SfcStyleScope::Scoped).unwrap();
    assert!(css.contains("&:hover"), "variant lifts to nested &:hover: {css}");
    assert!(
        !css.contains(r"\:"),
        "must NOT emit an escaped class selector: {css}"
    );
    insta::assert_snapshot!(css);
}

// ── multi-token @apply a b c ─────────────────────────────────────────────────

#[test]
fn multi_token_apply() {
    let css = expand(
        ".btn { @apply inline-flex items-center justify-center rounded-md; }",
        SfcStyleScope::Scoped,
    )
    .unwrap();
    insta::assert_snapshot!(css);
}

// ── multiple @apply per rule ─────────────────────────────────────────────────

#[test]
fn multiple_apply_directives_per_rule() {
    let css = expand(
        ".btn {\n  @apply inline-flex;\n  @apply rounded-md;\n  @apply hover:bg-accent;\n}",
        SfcStyleScope::Scoped,
    )
    .unwrap();
    insta::assert_snapshot!(css);
}

// ── @apply in a nested rule ──────────────────────────────────────────────────

#[test]
fn apply_inside_nested_rule() {
    let css = expand(
        ".card {\n  display: grid;\n  & .title { @apply font-medium; }\n}",
        SfcStyleScope::Scoped,
    )
    .unwrap();
    assert!(css.contains("font-weight: 500"), "nested @apply inlined: {css}");
    insta::assert_snapshot!(css);
}

// ── arbitrary-value utility ──────────────────────────────────────────────────

#[test]
fn arbitrary_value_utility_in_apply() {
    let css = expand(".swatch { @apply bg-[#fff]; }", SfcStyleScope::Scoped).unwrap();
    assert!(
        css.contains("background-color: #fff"),
        "arbitrary value inlined verbatim: {css}"
    );
    insta::assert_snapshot!(css);
}

#[test]
fn arbitrary_value_variant_in_apply() {
    let css = expand(".swatch { @apply hover:bg-[#fff]; }", SfcStyleScope::Scoped).unwrap();
    assert!(css.contains("&:hover"));
    assert!(css.contains("background-color: #fff"));
    insta::assert_snapshot!(css);
}

// ── responsive + data + group variants ───────────────────────────────────────

#[test]
fn responsive_variant_wraps_media() {
    let css = expand(".grid { @apply md:flex; }", SfcStyleScope::Scoped).unwrap();
    assert!(css.contains("@media (min-width:"), "md: wraps @media: {css}");
    insta::assert_snapshot!(css);
}

#[test]
fn data_attribute_variant() {
    let css = expand(
        r#".btn { @apply data-[state=open]:bg-accent; }"#,
        SfcStyleScope::Scoped,
    )
    .unwrap();
    assert!(css.contains(r#"&[data-state="open"]"#), "{css}");
    insta::assert_snapshot!(css);
}

#[test]
fn dark_variant_cascade_in_apply() {
    let css = expand(".panel { @apply dark:bg-surface; }", SfcStyleScope::Scoped).unwrap();
    assert!(
        !css.contains(":host-context("),
        "Firefox-safe: no :host-context(): {css}"
    );
    assert!(css.contains(r#":host([data-theme="dark"])"#), "{css}");
    assert!(css.contains(":root.dark"), "{css}");
    // D4 §4 dual-keyed convention (Founder decision #3, `DARK_SELECTOR` in
    // `define-style-pack.ts`) — an app that sets `data-theme="dark"` on
    // `<html>` with no `.dark` class must still activate `dark:` variants,
    // or the shipped packs' own tokens and this cascade would disagree.
    assert!(css.contains(r#":root[data-theme="dark"]"#), "{css}");
    insta::assert_snapshot!(css);
}

// ── unknown utility error ────────────────────────────────────────────────────

#[test]
fn unknown_utility_is_compile_error() {
    let err = expand(".btn { @apply totally-not-a-utility; }", SfcStyleScope::Scoped)
        .expect_err("unknown utility must hard-error");
    match err {
        CompileError::UnknownApplyUtility { ref token } => {
            assert_eq!(token, "totally-not-a-utility")
        }
        other => panic!("expected UnknownApplyUtility, got {other:?}"),
    }
    assert!(err.to_string().contains("unknown utility in @apply"));
}

#[test]
fn unknown_utility_propagates_through_compile_sfc_scoped() {
    let err = compile_sfc_scoped(&sfc_style(".btn { @apply nope-nope; }", "scoped"))
        .expect_err("must propagate");
    assert!(matches!(err, CompileError::UnknownApplyUtility { .. }));
}

// ── $global variant rejection ────────────────────────────────────────────────

#[test]
fn global_apply_rejects_scope_implying_variant() {
    let err = expand("body { @apply hover:bg-accent; }", SfcStyleScope::Global)
        .expect_err("$global may not use a scope-implying variant");
    match err {
        CompileError::GlobalApplyVariant { ref token } => assert_eq!(token, "hover:bg-accent"),
        other => panic!("expected GlobalApplyVariant, got {other:?}"),
    }
}

#[test]
fn global_apply_allows_base_utility() {
    // Base utilities are fine in $global — they inline as flat declarations.
    let css = expand("body { @apply inline-flex; }", SfcStyleScope::Global).unwrap();
    assert!(css.contains("display: inline-flex"), "{css}");
}

#[test]
fn global_apply_allows_media_variant() {
    // A breakpoint variant implies no host/`&` scope (it only wraps in @media),
    // so it is allowed in $global.
    let css = expand("body { @apply md:flex; }", SfcStyleScope::Global).unwrap();
    assert!(css.contains("@media (min-width:"), "{css}");
}

// ── end-to-end through compile_sfc_scoped (theme preamble included) ───────────

#[test]
fn end_to_end_scoped_with_theme_preamble() {
    let css = scoped(".btn { @apply inline-flex hover:bg-accent; }");
    assert!(css.contains("var(--color-accent, #c8543a)"), "default token fallback present: {css}");
    assert!(css.contains("display: inline-flex"));
    assert!(css.contains("&:hover"));
}
