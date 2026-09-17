//! Tailwind-v4 parity round: coverage for the utility families, the
//! `(--var)` shorthand, the arbitrary border-color typing fix, palette-token
//! injection, and the pseudo-class/element variants added to render a
//! full Tailwind-authored landing page on the engine.

use aihu_css_core::{compile_classes, compile_sfc_scoped, parse_ast};

fn css(classes: &[&str]) -> String {
    compile_classes(&classes.iter().map(|s| s.to_string()).collect::<Vec<_>>())
}

fn one(class: &str) -> String {
    compile_classes(&[class.to_string()])
}

fn sfc(classes: &str) -> aihu_css_core::SfcAst {
    let json = format!(
        r#"{{"tag":"X","astVersion":1,"style":null,"meta":{{"name":"X"}},
        "template":[{{"kind":"element","tag":"div","attrs":[
          {{"kind":"static","name":"class","value":"{classes}"}}
        ],"children":[]}}]}}"#
    );
    parse_ast(&json).unwrap()
}

// ── The root-cause fix: arbitrary border value typed as color, not width ─────

#[test]
fn arbitrary_border_value_is_color_typed_by_value() {
    // A color-looking value → border-color (previously always border-width).
    assert_eq!(
        one("border-[var(--border)]"),
        ".border-[var(--border)] { border-color: var(--border); }\n"
    );
    assert_eq!(
        one("border-[#abc]"),
        ".border-[#abc] { border-color: #abc; }\n"
    );
    // A length value still maps to width.
    assert_eq!(
        one("border-[2px]"),
        ".border-[2px] { border-width: 2px; }\n"
    );
    // Explicit data-type hints override the heuristic.
    assert_eq!(
        one("outline-[color:var(--x)]"),
        ".outline-[color:var(--x)] { outline-color: var(--x); }\n"
    );
}

// ── The CSS-variable shorthand `prefix-(--token)` ───────────────────────────

#[test]
fn var_shorthand_keeps_prefix_property_typing() {
    assert_eq!(
        one("bg-(--background)"),
        ".bg-(--background) { background-color: var(--background); }\n"
    );
    assert_eq!(
        one("text-(--muted-fg)"),
        ".text-(--muted-fg) { color: var(--muted-fg); }\n"
    );
    // border keeps COLOR typing (not width) through the shorthand.
    assert_eq!(
        one("border-(--border)"),
        ".border-(--border) { border-color: var(--border); }\n"
    );
}

#[test]
fn var_shorthand_opacity_modifier_color_mixes() {
    assert_eq!(
        one("bg-(--background)/90"),
        ".bg-(--background)/90 { background-color: color-mix(in oklab, var(--background) 90%, transparent); }\n"
    );
}

// ── Sizing / aspect / order / fractions ─────────────────────────────────────

#[test]
fn size_emits_width_and_height() {
    assert_eq!(one("size-16"), ".size-16 { width: 4rem; height: 4rem; }\n");
    assert_eq!(
        one("size-full"),
        ".size-full { width: 100%; height: 100%; }\n"
    );
}

#[test]
fn aspect_ratio_keywords_and_bare_ratio() {
    assert_eq!(
        one("aspect-square"),
        ".aspect-square { aspect-ratio: 1 / 1; }\n"
    );
    assert_eq!(
        one("aspect-video"),
        ".aspect-video { aspect-ratio: 16 / 9; }\n"
    );
    assert_eq!(
        one("aspect-1108/632"),
        ".aspect-1108/632 { aspect-ratio: 1108 / 632; }\n"
    );
}

#[test]
fn fractional_position_and_negative_translate() {
    assert_eq!(one("left-1/2"), ".left-1/2 { left: 50%; }\n");
    assert_eq!(one("top-1/2"), ".top-1/2 { top: 50%; }\n");
    assert_eq!(
        one("-translate-x-1/2"),
        ".-translate-x-1/2 { transform: translateX(-50%); }\n"
    );
}

#[test]
fn negative_margin_and_z_index() {
    assert_eq!(one("-ml-4"), ".-ml-4 { margin-left: -1rem; }\n");
    assert_eq!(one("-z-10"), ".-z-10 { z-index: -10; }\n");
    assert_eq!(one("order-2"), ".order-2 { order: 2; }\n");
}

// ── Gradients ───────────────────────────────────────────────────────────────

#[test]
fn linear_gradient_direction_and_stops() {
    assert_eq!(
        one("bg-linear-to-r"),
        ".bg-linear-to-r { background-image: linear-gradient(to right, var(--tw-gradient-stops)); }\n"
    );
    assert!(one("from-amber-200").contains("--tw-gradient-from: var(--color-amber-200)"));
    assert!(one("to-amber-600").contains("--tw-gradient-to: var(--color-amber-600)"));
    assert!(one("via-(--accent)").contains("var(--accent)"));
}

// ── Effects / typography long-tail ──────────────────────────────────────────

#[test]
fn blur_mask_shadow_outline_scales() {
    assert_eq!(one("blur-3xl"), ".blur-3xl { filter: blur(64px); }\n");
    assert!(one("backdrop-blur-sm").contains("backdrop-filter: blur(8px)"));
    assert!(one("mask-[radial-gradient(circle,white,transparent)]")
        .contains("mask-image: radial-gradient(circle,white,transparent)"));
    assert!(one("shadow-xl").contains("box-shadow:"));
    assert_eq!(
        one("outline-2"),
        ".outline-2 { outline-style: solid; outline-width: 2px; }\n"
    );
    assert_eq!(
        one("-outline-offset-1"),
        ".-outline-offset-1 { outline-offset: -1px; }\n"
    );
}

#[test]
fn type_scale_slash_line_height_and_family() {
    assert_eq!(
        one("text-7xl"),
        ".text-7xl { font-size: 4.5rem; line-height: 1; }\n"
    );
    assert_eq!(
        one("text-sm/6"),
        ".text-sm/6 { font-size: 0.875rem; line-height: 1.5rem; }\n"
    );
    assert_eq!(
        one("font-serif"),
        ".font-serif { font-family: var(--font-serif); }\n"
    );
    assert_eq!(one("text-pretty"), ".text-pretty { text-wrap: pretty; }\n");
}

#[test]
fn long_tail_fixed_utilities() {
    assert_eq!(one("isolate"), ".isolate { isolation: isolate; }\n");
    assert_eq!(
        one("cursor-pointer"),
        ".cursor-pointer { cursor: pointer; }\n"
    );
    assert_eq!(
        one("rounded-3xl"),
        ".rounded-3xl { border-radius: 1.5rem; }\n"
    );
    assert_eq!(one("list-none"), ".list-none { list-style-type: none; }\n");
    assert_eq!(one("shrink-0"), ".shrink-0 { flex-shrink: 0; }\n");
    assert_eq!(
        one("self-start"),
        ".self-start { align-self: flex-start; }\n"
    );
    assert!(one("sr-only").contains("position: absolute"));
}

// ── Palette injection: referenced palette tokens resolve via var() fallback ──

#[test]
fn scoped_injects_used_palette_tokens() {
    let out = compile_sfc_scoped(&sfc("bg-amber-500 text-stone-300")).unwrap();
    // The utility refs the palette token with its oklch value as the fallback,
    // so an app-level `--color-amber-500` still wins inside the component.
    assert!(out.contains("background-color: var(--color-amber-500, oklch("), "{out}");
    assert!(out.contains("color: var(--color-stone-300, oklch("), "{out}");
    assert!(!out.contains("--color-amber-500: oklch("), "{out}");
    // Only USED palette tokens are injected — an unrelated family is absent.
    assert!(!out.contains("--color-rose-500"));
}

// ── Variants: pseudo-classes, pseudo-elements, relational open ──────────────

#[test]
fn pseudo_class_variants_first_last_open() {
    let out = compile_sfc_scoped(&sfc("first:mt-0 last:mb-0 open:block")).unwrap();
    assert!(out.contains(":first-child"));
    assert!(out.contains(":last-child"));
    assert!(out.contains(":open"));
}

#[test]
fn pseudo_element_variants_marker_and_placeholder() {
    let out = compile_sfc_scoped(&sfc("marker:text-primary placeholder:text-stone-400")).unwrap();
    assert!(out.contains("::marker"));
    assert!(out.contains("::placeholder"));
}

#[test]
fn group_open_relational_variant() {
    let out = compile_sfc_scoped(&sfc("group-open:rotate-180")).unwrap();
    assert!(out.contains(".group:open"));
}

// ── A representative slice of the real landing compiles end to end ───────────

#[test]
fn landing_utility_slice_all_emit() {
    // Base (non-variant) utilities only — flat `compile_classes` does not emit
    // variant-prefixed classes (those are exercised by the variant tests above).
    let slice = [
        "relative",
        "isolate",
        "overflow-hidden",
        "bg-(--background)",
        "size-full",
        "mask-[radial-gradient(100%_100%_at_top_right,white,transparent)]",
        "stroke-(--border)",
        "fill-(--muted)",
        "aspect-1108/632",
        "bg-linear-to-r",
        "from-amber-200",
        "to-amber-600",
        "opacity-20",
        "max-w-7xl",
        "px-6",
        "text-7xl",
        "font-serif",
        "text-pretty",
        "text-(--foreground)",
        "text-lg/8",
        "rounded-md",
        "bg-(--primary)",
        "text-(--primary-fg)",
        "shadow-xs",
        "size-3",
        "rounded-full",
        "bg-red-400",
        "ring-1",
        "ring-gray-900/10",
    ];
    let out = css(&slice);
    // Every class in the slice must produce a rule (no silently-dropped utility).
    for class in slice {
        let sel = format!(".{class} {{");
        assert!(
            out.contains(&sel),
            "landing utility `{class}` produced no rule"
        );
    }
}
