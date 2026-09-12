//! Scoped-output, variant, and @theme emission tests (Plan 2 Tasks 4–7).

use aihu_css_core::{compile_sfc_scoped, parse_ast, CompileError};

fn ast(json: &str) -> aihu_css_core::SfcAst {
    parse_ast(json).unwrap()
}

/// Build a single-element SFC AST with a static class list.
fn sfc_with_classes(classes: &str) -> aihu_css_core::SfcAst {
    let json = format!(
        r#"{{"tag":"X","astVersion":1,"style":null,"meta":{{"name":"X"}},
        "template":[{{"kind":"element","tag":"div","attrs":[
          {{"kind":"static","name":"class","value":"{classes}"}}
        ],"children":[]}}]}}"#
    );
    ast(&json)
}

// ── Task 4: scoped output, no global stylesheet ──────────────────────────────

#[test]
fn scoped_output_has_no_bare_global_utility_sheet() {
    let css = compile_sfc_scoped(&sfc_with_classes("bg-primary p-4")).unwrap();
    // The utility rules are class selectors inside the shadow <style>; they are
    // scoped by living in the shadow root. There is no separate global sheet.
    assert!(css.contains(".bg-primary"));
    assert!(css.contains("padding: 1rem"));
    // Default tokens are var() fallbacks, not a :host block, so a theme the
    // component inherits from the document wins (#836).
    assert!(!css.contains(":host {"), "{css}");
    assert!(css.contains("background-color: var(--color-primary, #1a1d24)"), "{css}");
}

#[test]
fn scoped_folds_authored_style_block() {
    let json = r#"{"tag":"X","astVersion":1,
      "style":{"content":".extra { color: red; }","scope":"scoped"},
      "meta":{"name":"X"},
      "template":[{"kind":"element","tag":"div","attrs":[
        {"kind":"static","name":"class","value":"p-4"}],"children":[]}]}"#;
    let css = compile_sfc_scoped(&ast(json)).unwrap();
    assert!(css.contains(".p-4"));
    // Authored @style now flows through the shared parser (R-SHARED-PARSER) so
    // the verbatim text is re-rendered (whitespace-normalized). Assert the
    // selector + declaration survive rather than exact single-line formatting.
    assert!(css.contains(".extra"), "authored scoped @style folded in: {css}");
    assert!(css.contains("color: red;"), "authored declaration preserved: {css}");
}

#[test]
fn global_style_block_passes_through_edge_e6() {
    let json = r#"{"tag":"X","astVersion":1,
      "style":{"content":"body { margin: 0; }","scope":"global"},
      "meta":{"name":"X"},"template":null}"#;
    let css = compile_sfc_scoped(&ast(json)).unwrap();
    // Re-rendered through the shared parser (whitespace-normalized).
    assert!(css.contains("body"), "global block selector preserved: {css}");
    assert!(css.contains("margin: 0;"), "global declaration preserved: {css}");
    assert!(css.contains("unscoped"), "global block annotated as unscoped");
}

// ── Task 5: WC-native variants ───────────────────────────────────────────────

#[test]
fn host_variant_emits_host_rule() {
    let css = compile_sfc_scoped(&sfc_with_classes("host:bg-primary")).unwrap();
    assert!(css.contains(":host("), "host: → :host(...) selector: {css}");
    assert!(css.contains("background-color: var(--color-primary, #1a1d24)"));
}

#[test]
fn slotted_variants() {
    let css = compile_sfc_scoped(&sfc_with_classes("slotted:p-4 slotted-img:rounded-lg")).unwrap();
    assert!(css.contains("::slotted("));
    assert!(css.contains("::slotted(img"));
}

#[test]
fn part_variant_emits_part_selector() {
    let css = compile_sfc_scoped(&sfc_with_classes("part-thumb:bg-accent")).unwrap();
    assert!(css.contains("::part(thumb)"));
}

#[test]
fn host_context_dark_uses_cascade_not_host_context() {
    let css = compile_sfc_scoped(&sfc_with_classes("host-context-dark:bg-surface")).unwrap();
    assert!(
        !css.contains(":host-context("),
        "Firefox-safe: must NOT emit :host-context(): {css}"
    );
    assert!(css.contains("dark cascade"), "uses the documented cascade mechanism");
    assert!(css.contains(":root.dark"), "dark value gated on consumer .dark scope");
}

// ── Task 6: standard variants ────────────────────────────────────────────────

#[test]
fn hover_variant_appends_pseudo_class() {
    let css = compile_sfc_scoped(&sfc_with_classes("hover:bg-primary")).unwrap();
    assert!(css.contains(":hover"), "hover: → :hover pseudo-class: {css}");
}

#[test]
fn dark_variant_no_host_context() {
    let css = compile_sfc_scoped(&sfc_with_classes("dark:bg-surface")).unwrap();
    assert!(!css.contains(":host-context("), "dark: must NOT emit :host-context()");
    assert!(css.contains("dark cascade"));
}

#[test]
fn responsive_md_wraps_media_query() {
    let css = compile_sfc_scoped(&sfc_with_classes("md:p-8")).unwrap();
    assert!(css.contains("@media (min-width:"), "md: → @media: {css}");
    assert!(css.contains("padding: 2rem"));
}

#[test]
fn arbitrary_selector_variant() {
    let css = compile_sfc_scoped(&sfc_with_classes("[&>div]:text-primary")).unwrap();
    assert!(css.contains(">div"), "[&>div]: → child selector: {css}");
    assert!(css.contains("color: var(--color-primary, #1a1d24)"));
}

#[test]
fn stacked_variants_md_hover() {
    let css = compile_sfc_scoped(&sfc_with_classes("md:hover:bg-primary")).unwrap();
    assert!(css.contains("@media (min-width:"));
    assert!(css.contains(":hover"));
}

// ── Round 2: group / peer relational variants ────────────────────────────────

#[test]
fn group_hover_emits_ancestor_state_selector() {
    let css = compile_sfc_scoped(&sfc_with_classes("group-hover:bg-primary")).unwrap();
    // Ancestor descendant-combinator: `.group:hover .group-hover\:bg-primary`.
    assert!(
        css.contains(".group:hover .group-hover\\:bg-primary"),
        "group-hover: → `.group:hover <base>` ancestor selector: {css}"
    );
    assert!(css.contains("background-color: var(--color-primary, #1a1d24)"));
}

#[test]
fn group_focus_variants_emit_each_state() {
    for (cls, sel) in [
        ("group-focus:bg-primary", ".group:focus "),
        ("group-focus-visible:bg-primary", ".group:focus-visible "),
        ("group-active:bg-primary", ".group:active "),
        ("group-disabled:bg-primary", ".group:disabled "),
    ] {
        let css = compile_sfc_scoped(&sfc_with_classes(cls)).unwrap();
        assert!(css.contains(sel), "{cls} → `{sel}` prefix: {css}");
    }
}

#[test]
fn peer_checked_emits_sibling_state_selector() {
    let css = compile_sfc_scoped(&sfc_with_classes("peer-checked:bg-primary")).unwrap();
    // Subsequent-sibling combinator: `.peer:checked ~ .peer-checked\:bg-primary`.
    assert!(
        css.contains(".peer:checked ~ .peer-checked\\:bg-primary"),
        "peer-checked: → `.peer:checked ~ <base>` sibling selector: {css}"
    );
    assert!(css.contains("background-color: var(--color-primary, #1a1d24)"));
}

#[test]
fn peer_state_variants_emit_each_state() {
    for (cls, sel) in [
        ("peer-hover:bg-primary", ".peer:hover ~ "),
        ("peer-focus:bg-primary", ".peer:focus ~ "),
        ("peer-focus-visible:bg-primary", ".peer:focus-visible ~ "),
        ("peer-disabled:bg-primary", ".peer:disabled ~ "),
    ] {
        let css = compile_sfc_scoped(&sfc_with_classes(cls)).unwrap();
        assert!(css.contains(sel), "{cls} → `{sel}` prefix: {css}");
    }
}

#[test]
fn bare_group_and_peer_markers_emit_empty_rules() {
    let css = compile_sfc_scoped(&sfc_with_classes("group peer")).unwrap();
    // Markers survive as empty-body rules so the relational selectors resolve.
    assert!(css.contains(".group {"), "bare `group` marker kept: {css}");
    assert!(css.contains(".peer {"), "bare `peer` marker kept: {css}");
}

#[test]
fn group_peer_stack_with_responsive() {
    // `md:group-hover:bg-primary` — breakpoint wraps the relational rule.
    let css = compile_sfc_scoped(&sfc_with_classes("md:group-hover:bg-primary")).unwrap();
    assert!(css.contains("@media (min-width:"), "breakpoint wrapper: {css}");
    assert!(css.contains(".group:hover "), "relational selector inside media: {css}");
}

// ── Task 7: @theme directive ─────────────────────────────────────────────────

#[test]
fn theme_override_registers_token() {
    let json = r#"{"tag":"X","astVersion":1,
      "style":{"content":"@theme { --color-primary: oklch(0.7 0.2 30); }","scope":"scoped"},
      "meta":{"name":"X"},
      "template":[{"kind":"element","tag":"div","attrs":[
        {"kind":"static","name":"class","value":"bg-primary"}],"children":[]}]}"#;
    let css = compile_sfc_scoped(&ast(json)).unwrap();
    // The override value is registered as a :host token...
    assert!(css.contains("--color-primary: oklch(0.7 0.2 30)"), "@theme override registered: {css}");
    // ...and the utility references it.
    assert!(css.contains("background-color: var(--color-primary)"));
    // The @theme directive itself is NOT emitted as raw CSS.
    assert!(!css.contains("@theme"), "@theme directive stripped from raw output");
}

#[test]
fn default_aihu_brand_tokens_present() {
    let css = compile_sfc_scoped(&sfc_with_classes("bg-accent")).unwrap();
    // Default accent is the aihu terracotta, carried as the var() fallback.
    assert!(
        css.contains("background-color: var(--color-accent, #c8543a)"),
        "baked aihu brand default present: {css}"
    );
    assert!(!css.contains("--color-accent: #c8543a"), "default must not be declared: {css}");
}

#[test]
fn authored_style_rules_get_default_fallbacks_and_theme_tokens_stay_declared() {
    // #836: authored rules inherit document tokens exactly like utilities do,
    // while a token the SFC's own @theme sets is still declared at :host.
    let json = r#"{"tag":"X","astVersion":1,
      "style":{"content":"@theme { --color-accent: red; } .note { color: var(--color-muted-foreground); border-color: var(--color-accent); }","scope":"scoped"},
      "meta":{"name":"X"},"template":null}"#;
    let css = compile_sfc_scoped(&ast(json)).unwrap();
    assert!(css.contains("color: var(--color-muted-foreground, #8a8880)"), "{css}");
    assert!(css.contains(":host {\n  --color-accent: red;\n}"), "{css}");
    assert!(css.contains("border-color: var(--color-accent)"), "{css}");
    assert!(!css.contains("--color-muted-foreground:"), "{css}");
}

// ── Round 2: aria-* / data-* attribute variants ─────────────────────────────

#[test]
fn aria_keyword_variant_emits_true_attr_selector() {
    let css = compile_sfc_scoped(&sfc_with_classes("aria-checked:bg-accent")).unwrap();
    assert!(
        css.contains(r#"[aria-checked="true"]"#),
        "aria-checked: → [aria-checked=\"true\"] selector: {css}"
    );
    assert!(css.contains("background-color: var(--color-accent, #c8543a)"));
}

#[test]
fn aria_expanded_variant() {
    let css = compile_sfc_scoped(&sfc_with_classes("aria-expanded:underline")).unwrap();
    assert!(
        css.contains(r#"[aria-expanded="true"]"#),
        "aria-expanded: → [aria-expanded=\"true\"]: {css}"
    );
    assert!(css.contains("text-decoration-line: underline"));
}

#[test]
fn aria_disabled_selected_pressed_variants() {
    for (cls, attr) in [
        ("aria-disabled:opacity-50", r#"[aria-disabled="true"]"#),
        ("aria-selected:bg-primary", r#"[aria-selected="true"]"#),
        ("aria-pressed:bg-accent", r#"[aria-pressed="true"]"#),
    ] {
        let css = compile_sfc_scoped(&sfc_with_classes(cls)).unwrap();
        assert!(css.contains(attr), "{cls} → {attr}: {css}");
    }
}

#[test]
fn aria_arbitrary_value_variant() {
    let css = compile_sfc_scoped(&sfc_with_classes("aria-[expanded=false]:underline")).unwrap();
    assert!(
        css.contains(r#"[aria-expanded="false"]"#),
        "aria-[expanded=false]: → [aria-expanded=\"false\"]: {css}"
    );
}

#[test]
fn data_state_variant_emits_attr_selector() {
    let css = compile_sfc_scoped(&sfc_with_classes("data-[state=open]:bg-accent")).unwrap();
    assert!(
        css.contains(r#"[data-state="open"]"#),
        "data-[state=open]: → [data-state=\"open\"] selector: {css}"
    );
    assert!(css.contains("background-color: var(--color-accent, #c8543a)"));
}

#[test]
fn data_keyword_variant_is_presence_selector() {
    // Bare `data-active:` is a presence selector (no implicit ="true").
    let css = compile_sfc_scoped(&sfc_with_classes("data-active:underline")).unwrap();
    assert!(
        css.contains("[data-active]"),
        "data-active: → [data-active] presence selector: {css}"
    );
    assert!(!css.contains(r#"[data-active="true"]"#));
}

// ── Round 2: container queries (@container) ──────────────────────────────────

#[test]
fn container_marker_sets_container_type() {
    let css = compile_sfc_scoped(&sfc_with_classes("@container")).unwrap();
    assert!(
        css.contains("container-type: inline-size"),
        "@container marker → container-type: inline-size: {css}"
    );
}

#[test]
fn named_container_marker_sets_type_and_name() {
    let css = compile_sfc_scoped(&sfc_with_classes("@container/sidebar")).unwrap();
    assert!(css.contains("container-type: inline-size"), "{css}");
    assert!(
        css.contains("container-name: sidebar"),
        "@container/sidebar → container-name: sidebar: {css}"
    );
}

#[test]
fn container_md_wraps_rule_in_container_at_rule() {
    let css = compile_sfc_scoped(&sfc_with_classes("@md:flex")).unwrap();
    assert!(
        css.contains("@container (min-width:"),
        "@md: → @container (min-width: ...): {css}"
    );
    // Container scale differs from the viewport breakpoint scale (md = 28rem).
    assert!(css.contains("28rem"), "container @md = 28rem: {css}");
    assert!(css.contains("display: flex"));
    // Must NOT be an @media rule.
    assert!(!css.contains("@media"), "@md: is a container query, not @media: {css}");
}

#[test]
fn container_sm_lg_scale() {
    let sm = compile_sfc_scoped(&sfc_with_classes("@sm:block")).unwrap();
    assert!(sm.contains("@container (min-width: 24rem)"), "@sm = 24rem: {sm}");
    let lg = compile_sfc_scoped(&sfc_with_classes("@lg:hidden")).unwrap();
    assert!(lg.contains("@container (min-width: 32rem)"), "@lg = 32rem: {lg}");
}

#[test]
fn container_parent_and_child_pair() {
    // A @container parent + @md:flex child — the proven user-visible pattern.
    let json = r#"{"tag":"X","astVersion":1,"style":null,"meta":{"name":"X"},
      "template":[{"kind":"element","tag":"div","attrs":[
        {"kind":"static","name":"class","value":"@container"}],
        "children":[{"kind":"element","tag":"div","attrs":[
          {"kind":"static","name":"class","value":"@md:flex"}],"children":[]}]}]}"#;
    let css = compile_sfc_scoped(&ast(json)).unwrap();
    assert!(css.contains("container-type: inline-size"), "{css}");
    assert!(css.contains("@container (min-width: 28rem)"), "{css}");
}

// ── Over-implementation probe: no spurious rules for unknown base utilities ──

#[test]
fn aria_data_without_known_base_emits_nothing() {
    // Unknown base utility behind an aria/data variant must not emit a rule.
    let css = compile_sfc_scoped(&sfc_with_classes(
        "aria-checked:notathing data-[state=open]:alsonope @md:bogus",
    )).unwrap();
    assert!(
        !css.contains("[aria-checked"),
        "no aria selector for unknown base: {css}"
    );
    assert!(
        !css.contains("[data-state"),
        "no data selector for unknown base: {css}"
    );
    assert!(
        !css.contains("@container"),
        "no container at-rule for unknown base: {css}"
    );
}

// ── R-RESULT: emit returns Result; an induced emit error propagates ──────────

#[test]
fn malformed_theme_block_is_a_compile_error() {
    // An `@theme` opener with no `{` body is malformed; the emit path now
    // hard-errors (CompileError) instead of silently keeping the broken text.
    let json = r#"{"tag":"X","astVersion":1,
      "style":{"content":"@theme --color-primary: red;","scope":"scoped"},
      "meta":{"name":"X"},"template":null}"#;
    let err = compile_sfc_scoped(&ast(json)).unwrap_err();
    assert!(
        matches!(err, CompileError::MalformedTheme { .. }),
        "expected MalformedTheme, got {err:?}"
    );
    assert!(
        err.to_string().contains("malformed @theme"),
        "actionable message: {err}"
    );
}

#[test]
fn well_formed_theme_block_still_succeeds() {
    // Success path is byte-identical to before the Result conversion.
    let json = r#"{"tag":"X","astVersion":1,
      "style":{"content":"@theme { --color-primary: red; }","scope":"scoped"},
      "meta":{"name":"X"},
      "template":[{"kind":"element","tag":"div","attrs":[
        {"kind":"static","name":"class","value":"bg-primary"}],"children":[]}]}"#;
    let css = compile_sfc_scoped(&ast(json)).unwrap();
    assert!(css.contains("--color-primary: red"), "{css}");
    assert!(css.contains("background-color: var(--color-primary)"), "{css}");
    assert!(!css.contains("@theme"), "directive consumed, not emitted: {css}");
}

// ── Issue #280: Preflight border-style reset ─────────────────────────────────

#[test]
fn preflight_border_reset_precedes_utilities() {
    // `.unwrap()` added in the PR-1 merge: compile_sfc_scoped now returns Result.
    let css = compile_sfc_scoped(&sfc_with_classes("border")).unwrap();
    // Tailwind v4 Preflight: borders default to solid + zero width.
    assert!(
        css.contains("*, ::before, ::after { border-style: solid; border-width: 0; }"),
        "preflight border reset present: {css}"
    );
    // The `.border` utility still wins by specificity.
    assert!(css.contains(".border { border-width: 1px; }"), "border utility emitted: {css}");
    // Preflight must come before the utility rule so the utility cascades over it.
    let pre = css.find("border-style: solid").unwrap();
    let util = css.find(".border {").unwrap();
    assert!(pre < util, "preflight precedes utility rules: {css}");
}
