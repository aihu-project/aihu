//! Snapshot coverage for scoped output + variants + @theme (Plan 2 Tasks 4–7).

use aihu_css_core::{compile_classes, compile_sfc_scoped, parse_ast};

fn ast(json: &str) -> aihu_css_core::SfcAst {
    parse_ast(json).unwrap()
}

fn sfc(classes: &str) -> aihu_css_core::SfcAst {
    ast(&format!(
        r#"{{"tag":"X","astVersion":1,"style":null,"meta":{{"name":"X"}},
        "template":[{{"kind":"element","tag":"div","attrs":[
          {{"kind":"static","name":"class","value":"{classes}"}}
        ],"children":[]}}]}}"#
    ))
}

#[test]
fn flat_output_for_class_list() {
    insta::assert_snapshot!(compile_classes(&[
        "bg-primary".to_string(),
        "p-4".to_string()
    ]));
}

#[test]
fn scoped_output_for_sfc() {
    insta::assert_snapshot!(compile_sfc_scoped(&sfc("bg-primary p-4 rounded-lg")).unwrap());
}

#[test]
fn scoped_with_authored_style_block() {
    let json = r#"{"tag":"Card","astVersion":1,
      "style":{"content":".inner { display: grid; gap: 1rem; }","scope":"scoped"},
      "meta":{"name":"Card"},
      "template":[{"kind":"element","tag":"div","attrs":[
        {"kind":"static","name":"class","value":"p-4 shadow-md"}],"children":[]}]}"#;
    insta::assert_snapshot!(compile_sfc_scoped(&ast(json)).unwrap());
}

#[test]
fn scoped_with_global_style_block() {
    let json = r#"{"tag":"X","astVersion":1,
      "style":{"content":"body { margin: 0; }","scope":"global"},
      "meta":{"name":"X"},"template":null}"#;
    insta::assert_snapshot!(compile_sfc_scoped(&ast(json)).unwrap());
}

#[test]
fn scoped_space_y_nested_rule() {
    // Locks in the nested `& > * + *` sibling-margin shape inside component
    // scope (Round 1: tailwind-support `space-x/y-*` family).
    insta::assert_snapshot!(compile_sfc_scoped(&sfc("space-y-4")).unwrap());
}

#[test]
fn scoped_divide_y_nested_rule() {
    // Locks in the nested `& > * + *` sibling-border shape inside component
    // scope (Round 2: tailwind-support `divide-x/y-*` family). Confirms the
    // nested rule survives the scoped CSS-nesting emission path, mirroring
    // `scoped_space_y_nested_rule`.
    insta::assert_snapshot!(compile_sfc_scoped(&sfc("divide-y-2")).unwrap());
}

#[test]
fn scoped_animate_spin_hoists_keyframes() {
    // Locks the `animate-*` emission shape: the scoped `.animate-spin` rule
    // followed by a hoisted top-level `@keyframes spin` sibling (Round 2:
    // tailwind-support `motion` track).
    insta::assert_snapshot!(compile_sfc_scoped(&sfc("animate-spin")).unwrap());
}

#[test]
fn scoped_transition_and_transform() {
    // Locks transition shorthand + a transform utility under component scope.
    insta::assert_snapshot!(compile_sfc_scoped(&sfc(
        "transition-transform duration-300 hover:scale-105"
    )).unwrap());
}

#[test]
fn wc_native_variants() {
    insta::assert_snapshot!(compile_sfc_scoped(&sfc(
        "host:bg-primary slotted:p-4 slotted-img:rounded-lg part-thumb:bg-accent host-context-dark:bg-surface"
    )).unwrap());
}

#[test]
fn standard_variants() {
    let css = compile_sfc_scoped(&sfc(
        "hover:bg-primary focus:text-accent dark:bg-surface md:p-8 [&>div]:text-primary md:hover:bg-primary"
    )).unwrap();
    // D4 §4 dual-keyed convention (Q: emit.rs's dark cascade must agree with
    // DARK_SELECTOR's `.dark, [data-theme="dark"]` on :root, not just :root.dark).
    assert!(css.contains(r#":root[data-theme="dark"]"#), "{css}");
    insta::assert_snapshot!(css);
}

#[test]
fn style_block_does_not_suppress_scanned_utilities() {
    // Regression for #278: an `@style` block must NOT make the utility-class
    // scanner mutually exclusive. Both the scanned template utilities AND the
    // authored `@style` content must land in the same scoped stylesheet.
    //
    // Repro: `<div class="text-3xl gap-4">` + `@style { .__probe__ { ... } }`.
    // Before the fix the sheet contained ONLY `.__probe__`; the utilities
    // vanished. Assert all three rules coexist (concatenated).
    let json = r#"{"tag":"Probe","astVersion":1,
      "style":{"content":".__probe__ { color: rgb(1,2,3); }","scope":"scoped"},
      "meta":{"name":"Probe"},
      "template":[{"kind":"element","tag":"div","attrs":[
        {"kind":"static","name":"class","value":"text-3xl gap-4"}],"children":[]}]}"#;
    // `.unwrap()` added in the PR-1 merge: compile_sfc_scoped now returns Result.
    let css = compile_sfc_scoped(&ast(json)).unwrap();

    // Scanned template utilities survive.
    assert!(
        css.contains(".text-3xl"),
        "scanned utility .text-3xl missing when @style present:\n{css}"
    );
    assert!(
        css.contains(".gap-4"),
        "scanned utility .gap-4 missing when @style present:\n{css}"
    );
    // Authored @style content survives. (PR-1 merge: authored @style is now
    // re-rendered through the shared @style parser to enable @apply, so it is
    // whitespace-normalized rather than byte-identical — assert the selector
    // and declaration are present, not the exact single-line form. The #278
    // regression intent (scanned utilities AND authored @style coexist) holds.)
    assert!(css.contains(".__probe__"), "authored @style selector missing:\n{css}");
    assert!(
        css.contains("color: rgb(1,2,3)"),
        "authored @style declaration missing:\n{css}"
    );
}

#[test]
fn theme_default_vs_override() {
    let default = compile_sfc_scoped(&sfc("bg-primary")).unwrap();
    let json = r#"{"tag":"X","astVersion":1,
      "style":{"content":"@theme { --color-primary: oklch(0.55 0.18 28); }","scope":"scoped"},
      "meta":{"name":"X"},
      "template":[{"kind":"element","tag":"div","attrs":[
        {"kind":"static","name":"class","value":"bg-primary"}],"children":[]}]}"#;
    let overridden = compile_sfc_scoped(&ast(json)).unwrap();
    insta::assert_snapshot!(format!(
        "--- default ---\n{default}\n--- override ---\n{overridden}"
    ));
}

// D4 §6, Slice 4 — the recipe channel wired end-to-end through the same
// `compile_sfc_scoped` entry every other class-scan test in this file uses.
#[test]
fn recipe_classes_fold_into_the_layer_aihu_components_channel() {
    let css = compile_sfc_scoped(&sfc("btn btn-primary p-8")).unwrap();
    assert!(css.contains("@layer aihu.components {"), "{css}");
    assert!(css.contains(".btn {"), "{css}");
    assert!(css.contains(".btn-primary {"), "{css}");
    // Never scanned — tree-shaken out, same discipline as tokens/utilities.
    assert!(!css.contains(".btn-ghost"), "{css}");
    // D4 Q5: the recipe's own `.btn` has no `padding` declaration to collide
    // with, but the unlayered `.p-8` utility rule must still be present and
    // OUTSIDE the `@layer aihu.components` block — that's what makes
    // `class="btn p-8"` resolve padding from the utility, not a recipe.
    assert!(css.contains(".p-8 { padding: 2rem; }"), "{css}");
    let open = css.find("@layer aihu.components {").unwrap();
    let brace_start = css[open..].find('{').unwrap() + open;
    let mut depth = 0i32;
    let mut close = None;
    for (i, b) in css.as_bytes()[brace_start..].iter().enumerate() {
        match b {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    close = Some(brace_start + i);
                    break;
                }
            }
            _ => {}
        }
    }
    let layer_close = close.expect("unbalanced @layer aihu.components block");
    assert!(
        css[layer_close..].contains(".p-8"),
        "the .p-8 utility rule must be emitted OUTSIDE the components layer:\n{css}"
    );
    assert!(
        !css[open..layer_close].contains(".p-8"),
        "the .p-8 utility rule must NOT be inside the components layer:\n{css}"
    );
}

#[test]
fn no_recipe_classes_used_emits_no_components_layer() {
    let css = compile_sfc_scoped(&sfc("flex p-4")).unwrap();
    assert!(!css.contains("aihu.components {"), "{css}");
}

#[test]
fn recipe_variant_has_its_own_hover_not_the_base_neutral_hover() {
    // Regression (Opus review of #187dbf57): `.btn:hover`'s (0,2,0)
    // specificity would otherwise beat `.btn-primary`'s (0,1,0) in the same
    // layer, so `class="btn btn-primary"` hovered as neutral instead of a
    // darker primary. Each variant now carries its own `&:hover`.
    let css = compile_sfc_scoped(&sfc("btn btn-primary")).unwrap();
    assert!(
        css.contains("color-mix(in oklab, var(--color-primary, #1a1d24) 90%, black)"),
        "btn-primary must darken ITS OWN color on hover, not the base neutral:\n{css}"
    );
}

#[test]
fn recipe_radius_tokens_resolve_without_a_pack() {
    // Regression (Opus review of #187dbf57): --radius-* previously existed
    // only in the shipped style-pack CSS, not the Rust ThemeRegistry, so a
    // component using `.btn`/`.card`/`.badge` with no pack loaded rendered
    // square-cornered with no signal anything was wrong.
    let css = compile_sfc_scoped(&sfc("btn")).unwrap();
    assert!(css.contains("var(--radius-md, 8px)"), "{css}");
}
