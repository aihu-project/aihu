//! Project-level theme input (`css.theme`) and the `css.hostTokens` switch,
//! both carried on the `--ast-json` payload (#836 follow-ups).

use aihu_css_core::{compile_sfc_scoped, hash_ast, parse_ast, SfcAst};

/// An SFC with `class="bg-primary text-accent"`, an optional `@style` body, and
/// extra top-level payload fields spliced in (`"theme": …`, `"hostTokens": …`).
fn sfc(style: Option<&str>, extra: &str) -> SfcAst {
    let style = match style {
        Some(content) => format!(r#"{{"content":"{content}","scope":"scoped"}}"#),
        None => "null".to_string(),
    };
    parse_ast(&format!(
        r#"{{"tag":"X","astVersion":1,"style":{style},"meta":{{"name":"X"}}{extra},
        "template":[{{"kind":"element","tag":"div","attrs":[
          {{"kind":"static","name":"class","value":"bg-primary text-accent"}}
        ],"children":[]}}]}}"#
    ))
    .unwrap()
}

#[test]
fn project_theme_replaces_default_fallback_values() {
    let css = compile_sfc_scoped(&sfc(
        None,
        r#","theme":"@theme { --color-primary: #0a7; }""#,
    ))
    .unwrap();
    assert!(css.contains("background-color: var(--color-primary, #0a7)"), "{css}");
    // Tokens the project theme leaves alone keep the built-in default.
    assert!(css.contains("color: var(--color-accent, #c8543a)"), "{css}");
    // Still fallbacks, never a :host declaration that would beat the document.
    assert!(!css.contains(":host {"), "{css}");
}

#[test]
fn project_theme_accepts_a_bare_declaration_list() {
    let css = compile_sfc_scoped(&sfc(None, r#","theme":"--color-primary: #0a7;""#)).unwrap();
    assert!(css.contains("background-color: var(--color-primary, #0a7)"), "{css}");
}

#[test]
fn sfc_theme_block_still_overrides_the_project_theme() {
    let css = compile_sfc_scoped(&sfc(
        Some("@theme { --color-primary: red; }"),
        r#","theme":"--color-primary: #0a7;""#,
    ))
    .unwrap();
    assert!(css.contains(":host {\n  --color-primary: red;\n}"), "{css}");
    assert!(css.contains("background-color: var(--color-primary);"), "{css}");
    assert!(!css.contains("#0a7"), "{css}");
}

#[test]
fn host_tokens_false_emits_bare_references() {
    let css = compile_sfc_scoped(&sfc(None, r#","hostTokens":false"#)).unwrap();
    assert!(css.contains("background-color: var(--color-primary);"), "{css}");
    assert!(css.contains("color: var(--color-accent);"), "{css}");
    assert!(!css.contains("#1a1d24") && !css.contains("#c8543a"), "{css}");
}

#[test]
fn host_tokens_false_keeps_sfc_theme_declarations() {
    let css = compile_sfc_scoped(&sfc(
        Some("@theme { --color-primary: red; }"),
        r#","hostTokens":false"#,
    ))
    .unwrap();
    assert!(css.contains(":host {\n  --color-primary: red;\n}"), "{css}");
    assert!(css.contains("color: var(--color-accent);"), "{css}");
}

#[test]
fn host_tokens_true_is_the_default() {
    let explicit = compile_sfc_scoped(&sfc(None, r#","hostTokens":true"#)).unwrap();
    let absent = compile_sfc_scoped(&sfc(None, "")).unwrap();
    assert_eq!(explicit, absent);
}

#[test]
fn cache_key_covers_theme_and_host_tokens() {
    let plain = hash_ast(&sfc(None, ""), 1);
    assert_ne!(plain, hash_ast(&sfc(None, r#","theme":"--color-primary: #0a7;""#), 1));
    assert_ne!(plain, hash_ast(&sfc(None, r#","hostTokens":false"#), 1));
}
