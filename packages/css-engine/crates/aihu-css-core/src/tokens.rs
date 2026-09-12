//! Tailwind v4 utility-class → CSS mapping.
//!
//! Strategy (Plan 2 Task 3, decision `decision-css-hard-fork-vs-upstream`):
//! we take *inspiration* from Tailwind v4, not a source merge. The table is a
//! hybrid:
//!
//! - **Regular grids** (spacing, the standard color palette, font-size, etc.)
//!   are generated algorithmically from compact data tables — no wall of
//!   literals, and the spacing scale derives from a single `* 0.25rem` rule.
//! - **The long tail** (display, flex, position, text-align, …) is a
//!   hand-written `match` of fixed property/value pairs.
//! - **Arbitrary values** (`bg-[#1a1d24]`, `w-[34ch]`, `text-[14px]`) are
//!   parsed by [`parse_arbitrary`] and emitted verbatim.
//!
//! Brand color tokens (`bg-primary`, `text-accent`, …) resolve to
//! `var(--color-*)` custom properties registered by the `@theme` registry
//! (`theme.rs`) so authored `@theme` overrides cascade through.

/// Emit the **conflict-group map**: `(class-prefix, group-key)` pairs derived
/// directly from the utility registry's own property maps (`spacing_prop`,
/// `sizing_prop`, `color_prop`, `arbitrary_prop`). Two utilities conflict (last
/// wins) when they share a group key — the group key is the CSS property the
/// prefix controls, so `p-2`/`p-4` (both `padding`) conflict, while `p-2`/`mx-4`
/// (`padding` vs `margin-inline`) do not.
///
/// This is the single source of truth the engine's build step serializes into
/// the TS `cn()` conflict map (Plan 3 Task 9) — so the runtime merge map NEVER
/// drifts from the compile-time utility table. Plus a few fixed-utility groups
/// (display, position) whose whole-class names share a property.
pub fn conflict_groups() -> Vec<(&'static str, &'static str)> {
    let mut out: Vec<(&'static str, &'static str)> = Vec::new();

    // Prefix-based utilities: prefix → its controlled CSS property (the group).
    const SPACING_PREFIXES: &[&str] = &[
        "p", "px", "py", "pt", "pr", "pb", "pl", "m", "mx", "my", "mt", "mr", "mb", "ml", "gap",
        "gap-x", "gap-y",
    ];
    for p in SPACING_PREFIXES {
        if let Some(group) = spacing_prop(p) {
            out.push((p, group));
        }
    }

    // `space-x-*` / `space-y-*` emit nested sibling-margin rules. The group
    // key is the inner declaration so `space-x-2` and `space-x-4` collide
    // (last wins), while `space-x-*` and `space-y-*` do not collide with
    // each other.
    out.push(("space-x", "space-x"));
    out.push(("space-y", "space-y"));

    // `divide-x-*` / `divide-y-*` emit nested sibling-border rules (reusing the
    // proven `space-*` nested path). The group key is the family so `divide-x-2`
    // and `divide-x-4` collide (last wins), while `divide-x-*` and `divide-y-*`
    // are independent axes that do not collide.
    out.push(("divide-x", "divide-x"));
    out.push(("divide-y", "divide-y"));

    // Grid templating prefixes — each maps to a single CSS property so the
    // `cn()` last-wins behaviour works per family.
    out.push(("grid-cols", "grid-template-columns"));
    out.push(("grid-rows", "grid-template-rows"));
    out.push(("col-span", "grid-column"));
    out.push(("row-span", "grid-row"));

    // Position-scale prefixes (top/right/bottom/left/inset[-x|-y]) — each maps
    // to the CSS property it controls so two values of the same family collide
    // (last wins), e.g. `top-4` vs `top-2`. `inset-x`/`inset-y` map to the
    // logical inline/block inset shorthands, distinct from the all-sides
    // `inset`. The negative forms (`-top-4`) share the same group as the
    // positive forms because they set the same property.
    const POSITION_PREFIXES: &[&str] = &[
        "top", "right", "bottom", "left", "inset", "inset-x", "inset-y",
    ];
    for p in POSITION_PREFIXES {
        if let Some(group) = position_prop(p) {
            out.push((p, group));
        }
    }

    // Named typography scales: `leading-*` (line-height) and `tracking-*`
    // (letter-spacing). Registering the prefix means `leading-tight` and
    // `leading-loose` collide last-wins.
    out.push(("leading", "line-height"));
    out.push(("tracking", "letter-spacing"));

    const SIZING_PREFIXES: &[&str] = &["w", "h", "min-w", "max-w", "min-h", "max-h"];
    for p in SIZING_PREFIXES {
        if let Some(group) = sizing_prop(p) {
            out.push((p, group));
        }
    }

    const COLOR_PREFIXES: &[&str] = &["bg", "text", "border", "fill", "stroke", "ring", "outline"];
    for p in COLOR_PREFIXES {
        if let Some(group) = color_prop(p) {
            out.push((p, group));
        }
    }

    // Ring WIDTH (`ring-{n}`) and ring-OFFSET width (`ring-offset-{n}`) both
    // share the `ring` class prefix (the runtime `cn()` `groupKey` splits on the
    // FIRST dash, so `ring-2`, `ring-blue-500`, and `ring-offset-2` all key to
    // prefix `ring`). The `ring` → `--tw-ring-color` entry pushed by the color
    // loop above ALREADY makes every `ring*` utility last-wins as one group, so
    // we deliberately do NOT push a second `("ring", …)` entry here — a duplicate
    // prefix key would collide in the generated `cn()` map. `ring-2` then
    // `ring-4` collapses to `ring-4`, which is the desired last-wins behaviour.

    // A handful of non-color/spacing parameterized prefixes with their own group.
    out.push(("z", "z-index"));
    out.push(("opacity", "opacity"));
    out.push(("rounded", "border-radius"));
    out.push(("shadow", "box-shadow"));
    out.push(("font", "font-weight"));

    // Motion families (Round 2: tailwind-support `motion` track). Every motion
    // transform utility emits a single `transform:` declaration, so the engine
    // resolves them via the CSS cascade (last declared wins). For `cn()`
    // last-wins we register one group key per family — translate/rotate/scale
    // dedupe within a family while leaving sibling families independent
    // (matching Tailwind's mental model). Combining families on one element
    // requires an arbitrary value (`transform-[...]`), see the docs note.
    out.push(("translate-x", "translate"));
    out.push(("translate-y", "translate"));
    out.push(("rotate", "rotate"));
    out.push(("scale", "scale"));
    out.push(("scale-x", "scale"));
    out.push(("scale-y", "scale"));
    // Transition / timing / animation each control a single property.
    out.push(("duration", "transition-duration"));

    // Parity round families. Each new prefix keys on its first dash, so the
    // entry makes same-family values last-wins (`size-4` vs `size-8`,
    // `aspect-square` vs `aspect-video`, `order-1` vs `order-2`). Families that
    // share a FIRST-dash prefix with an entry above are already covered and must
    // NOT be re-pushed (a duplicate prefix collides in the generated `cn()`
    // map): `font-serif`→`font`, `outline-offset`→`outline`, `text-pretty`→`text`,
    // `bg-linear-to`/`bg-gradient-to`→`bg`.
    out.push(("size", "size")); // width + height (NOTE: does not cross-dedupe vs w-*/h-*)
    out.push(("aspect", "aspect-ratio"));
    out.push(("order", "order"));
    out.push(("blur", "filter"));
    out.push(("backdrop", "backdrop-filter")); // backdrop-blur-*
    out.push(("cursor", "cursor"));
    out.push(("list", "list-style"));
    out.push(("self", "align-self"));
    out.push(("shrink", "flex-shrink"));
    out.push(("grow", "flex-grow"));
    out.push(("object", "object-fit"));
    // Gradient color stops — `from-*`/`via-*`/`to-*` dedupe within their slot.
    out.push(("from", "--tw-gradient-from"));
    out.push(("via", "--tw-gradient-via"));
    out.push(("to", "--tw-gradient-to"));

    // Ported animation catalog (animations.rs / tailwind-animations port doc
    // §4.5, step 4): every `animate-*` class — built-ins and ported alike —
    // sets the single `animation` shorthand, so `cn('animate-fade-in',
    // 'animate-shake')` must keep only the last one.
    out.push(("animate", "animation"));

    // tailwind-animations port, Slice 2 — modifier families, each its own
    // group so e.g. `animate-delay-100 animate-delay-500` collides but
    // `animate-delay-100 animate-duration-500` does not, and neither collides
    // with the base animation (`animate-fade-in animate-delay-100` must keep
    // BOTH — they set different CSS properties). This depends on `cn.ts`'s
    // `groupKey` doing genuine longest-dash-prefix matching against the
    // generated map (it tries `animate-delay` before falling back to
    // `animate`) — a plain first-segment-only lookup would collapse every
    // entry below into the blanket `animate` group above and silently drop
    // whichever of a base animation / modifier lost the last-wins race.
    out.push(("animate-delay", "animation-delay"));
    out.push(("animate-duration", "animation-duration"));
    out.push(("animate-iteration-count", "animation-iteration-count"));
    out.push(("animate-fill-mode", "animation-fill-mode"));
    out.push(("animate-direction", "animation-direction"));
    out.push(("animate-play", "animation-play-state"));

    // tailwind-animations port, Slice 12 — the dialog entry/exit family.
    //
    // `cn.ts`'s `groupKey` scans LONGEST dash-prefix first and starts at the
    // FULL class name, which is what makes the shape below work: every
    // start-offset preset is registered under its own EXACT class name, all
    // pointing at one shared group, so the six presets collide with each other
    // (`cn('animate-dialog-from-top', 'animate-dialog-zoom')` → the zoom) while
    // the base `animate-dialog` — registered separately, one entry earlier in
    // the scan's fallback chain — survives alongside any of them. Registering
    // the shared prefix `animate-dialog` for the presets instead would have
    // swallowed the base class into the same group and silently dropped it from
    // `cn('animate-dialog', 'animate-dialog-from-top')`, which is precisely the
    // failure the Slice-1 Opus review caught for the plain `animate-*` family.
    //
    // The base and the backdrop each get a self-named group for a second
    // reason: without an entry of their own they would fall through to the
    // blanket `("animate", "animation")` row above and collide with real
    // keyframe animations, even though neither declares `animation` at all.
    out.push(("animate-dialog", "animate-dialog"));
    out.push(("animate-dialog-backdrop", "animate-dialog-backdrop"));
    const DIALOG_START_PRESETS: &[&str] = &[
        "animate-dialog-from-top",
        "animate-dialog-from-bottom",
        "animate-dialog-from-left",
        "animate-dialog-from-right",
        "animate-dialog-fade",
        "animate-dialog-zoom",
    ];
    for p in DIALOG_START_PRESETS {
        out.push((p, "--aihu-anim-dialog-start"));
    }
    out.push(("animate-dialog-duration", "--aihu-anim-dialog-duration"));
    out.push(("animate-dialog-easing", "--aihu-anim-dialog-easing"));

    out
}

/// Map a single (already variant-stripped) utility class name to its CSS body
/// (declarations only, no selector). Returns `None` for unknown utilities.
pub fn utility_to_css(class_name: &str) -> Option<String> {
    // 0. Opacity modifier: `bg-accent/15`, `text-primary/50`, `border-red-500/30`.
    //    A trailing `/NN` (0..=100) applies the opacity to a COLOR utility via
    //    `color-mix(in oklab, <color> NN%, transparent)`. Only color-property
    //    utilities opt in, so sizing fractions (`w-1/2`) are left untouched.
    if let Some(css) = parse_color_opacity(class_name) {
        return Some(css);
    }

    // 1. Arbitrary-value bracket syntax: bg-[#1a1d24], w-[34ch], text-[14px].
    if let Some(css) = parse_arbitrary(class_name) {
        return Some(css);
    }

    // 1a. CSS-variable shorthand: `bg-(--brand)`, `text-(--muted-fg)`,
    //     `border-(--border)`. Tailwind v4 desugars `x-(--v)` to `x-[var(--v)]`
    //     but keeps the PREFIX's property typing (so `border-(--c)` is a COLOR,
    //     not a width). Routed before the generic `-` split so the parens aren't
    //     mistaken for a value segment.
    if let Some(css) = parse_var_shorthand(class_name) {
        return Some(css);
    }

    // 1c. Gradient stops: `from-amber-200`, `via-primary`, `to-(--accent)`.
    if let Some(css) = parse_gradient_stop(class_name) {
        return Some(css);
    }

    // 1b. Named container context: `@container/<name>` declares a *named* query
    // container so descendant `@<bp>/<name>:` variants can target it. Emits both
    // the container-type and the container-name. (The bare `@container` form is a
    // fixed utility below.)
    if let Some(name) = class_name.strip_prefix("@container/") {
        if !name.is_empty()
            && name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Some(format!(
                "container-type: inline-size; container-name: {name};"
            ));
        }
    }

    // 2. Fixed long-tail utilities (no value parameter).
    if let Some(css) = fixed_utility(class_name) {
        return Some(css.to_string());
    }

    // 2b. Ported animation catalog (animations.rs, tailwind-animations port
    //     doc §2 decision D-A). Placed AFTER fixed_utility so the four
    //     built-ins (animate-spin/ping/pulse/bounce) win deterministically —
    //     `animate-pulse` exists in both and is byte-identical, so the
    //     ordering is a no-op today but must not drift.
    if let Some(a) = crate::animations::lookup(class_name) {
        return Some(format!("animation: {};", a.shorthand));
    }

    // 3a. Negative motion utilities: `-translate-x-2`, `-rotate-45`. The leading
    // `-` is not part of any prefix, so we strip it, compile the positive form,
    // and negate the emitted numeric value. Only the negatable motion families
    // (`translate-*`, `rotate-*`) opt in via `negate_motion`.
    if let Some(rest) = class_name.strip_prefix('-') {
        if let Some(css) = negate_motion(rest) {
            return Some(css);
        }
    }

    // 3. Parameterized utilities split on the LAST `-` (prefix + value).
    if let Some(idx) = class_name.rfind('-') {
        let (prefix, value) = (&class_name[..idx], &class_name[idx + 1..]);
        if let Some(css) = parameterized_utility(prefix, value) {
            return Some(css);
        }
    }
    // Whole-token color utilities like `bg-primary` (value = brand token).
    if let Some(css) = brand_color_utility(class_name) {
        return Some(css);
    }

    None
}

/// Compile the negative form of a motion transform utility. `rest` is the class
/// name with its leading `-` already stripped (e.g. `translate-x-2`, `rotate-45`).
/// Returns the same `transform:` declaration with a negated value. Only
/// `translate-x/y-*` and `rotate-*` are negatable (Tailwind's `-` prefix set).
fn negate_motion(rest: &str) -> Option<String> {
    let idx = rest.rfind('-')?;
    let (prefix, value) = (&rest[..idx], &rest[idx + 1..]);
    match prefix {
        "translate-x" => {
            let len = translate_length(value)?;
            Some(format!("transform: translateX(-{len});"))
        }
        "translate-y" => {
            let len = translate_length(value)?;
            Some(format!("transform: translateY(-{len});"))
        }
        "rotate" => {
            let deg = positive_int(value)?;
            Some(format!("transform: rotate(-{deg}deg);"))
        }
        _ => None,
    }
}

/// Parse a trailing `/NN` opacity modifier on a color utility. `bg-accent/15`
/// resolves the base (`bg-accent` → `background-color: var(--color-accent);`)
/// and rewrites the value into a `color-mix(in oklab, <color> NN%, transparent)`
/// (Tailwind v4 parity). Returns `None` when there is no `/NN`, when the percent
/// is out of range, or when the base does not resolve to a single color
/// declaration (so sizing fractions like `w-1/2` are never touched).
pub fn parse_color_opacity(class_name: &str) -> Option<String> {
    let (base, pct) = class_name.rsplit_once('/')?;
    // The base must not itself contain a `/` (avoid `a/b/c`); pct is 0..=100.
    if base.contains('/') {
        return None;
    }
    if pct.is_empty() || !pct.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let n: u32 = pct.parse().ok()?;
    if n > 100 {
        return None;
    }
    // Resolve the base through the color path only. The prefix (split on the
    // FIRST `-`) must map to a color property, and the resolved body must be a
    // single `prop: <color>;` declaration.
    let idx = base.find('-')?;
    let prefix = &base[..idx];
    let prop = color_prop(prefix)?;
    let body = utility_to_css(base)?;
    let decl = format!("{prop}: ");
    let value = body.strip_prefix(&decl)?.strip_suffix(';')?;
    // Bail if the value is itself a multi-declaration body (defensive).
    if value.contains(';') {
        return None;
    }
    Some(format!(
        "{prop}: color-mix(in oklab, {value} {n}%, transparent);"
    ))
}

/// Parse `prefix-[value]` arbitrary-value syntax. The bracket content is
/// emitted verbatim into the mapped CSS property (edge E7).
///
/// Two refinements over a flat prefix→prop map:
/// - **Data-type hints** — `border-[length:2px]` / `text-[color:var(--x)]`
///   force the interpretation Tailwind v4 supports for ambiguous prefixes.
/// - **Color/length disambiguation** — for `border`/`outline`/`ring`/`divide`,
///   a value that *looks like a color* maps to the color property; otherwise to
///   the width property. (Previously `border-[…]` always meant width, so
///   `border-[var(--c)]` silently produced an invalid `border-width`.)
pub fn parse_arbitrary(class_name: &str) -> Option<String> {
    let open = class_name.find("-[")?;
    if !class_name.ends_with(']') {
        return None;
    }
    let prefix = &class_name[..open];
    let raw = &class_name[open + 2..class_name.len() - 1];
    // Optional `<type>:` data-type hint.
    let (hint, body) = match raw.split_once(':') {
        Some((h, v))
            if matches!(
                h,
                "color" | "length" | "angle" | "url" | "number" | "percentage" | "image"
            ) =>
        {
            (Some(h), v)
        }
        _ => (None, raw),
    };
    // Underscores in arbitrary values stand for spaces (Tailwind convention).
    let value = body.replace('_', " ");

    // Multi-declaration special cases.
    match prefix {
        "size" => return Some(format!("width: {value}; height: {value};")),
        "mask" | "mask-image" => {
            return Some(format!("-webkit-mask-image: {value}; mask-image: {value};"));
        }
        _ => {}
    }

    let is_color = hint == Some("color") || (hint.is_none() && looks_like_color(&value));
    let prop = match prefix {
        "border" => {
            if is_color {
                "border-color"
            } else {
                "border-width"
            }
        }
        "outline" => {
            if is_color {
                "outline-color"
            } else {
                "outline-width"
            }
        }
        "ring" => {
            if is_color {
                "--tw-ring-color"
            } else {
                "--tw-ring-width"
            }
        }
        _ => arbitrary_prop(prefix)?,
    };
    Some(format!("{prop}: {value};"))
}

/// Heuristic: does an arbitrary value denote a color (vs. a length)? Covers
/// hex, the CSS color functions, `var(--…)` (assumed a color in a color slot),
/// and the bare CSS named colors the engine already knows.
fn looks_like_color(v: &str) -> bool {
    let v = v.trim();
    v.starts_with('#')
        || v.starts_with("var(")
        || v.starts_with("rgb")
        || v.starts_with("hsl")
        || v.starts_with("oklch")
        || v.starts_with("oklab")
        || v.starts_with("color(")
        || matches!(v, "transparent" | "currentColor" | "white" | "black")
}

/// Map an arbitrary-value prefix to its CSS property.
fn arbitrary_prop(prefix: &str) -> Option<&'static str> {
    Some(match prefix {
        "bg" => "background-color",
        "text" => "color",
        "w" => "width",
        "h" => "height",
        "size" => "width",
        "min-w" => "min-width",
        "max-w" => "max-width",
        "min-h" => "min-height",
        "max-h" => "max-height",
        "p" => "padding",
        "px" => "padding-inline",
        "py" => "padding-block",
        "pt" => "padding-top",
        "pr" => "padding-right",
        "pb" => "padding-bottom",
        "pl" => "padding-left",
        "m" => "margin",
        "mx" => "margin-inline",
        "my" => "margin-block",
        "mt" => "margin-top",
        "mr" => "margin-right",
        "mb" => "margin-bottom",
        "ml" => "margin-left",
        "gap" => "gap",
        "gap-x" => "column-gap",
        "gap-y" => "row-gap",
        "rounded" => "border-radius",
        "border" => "border-width",
        "border-t" => "border-top-width",
        "border-r" => "border-right-width",
        "border-b" => "border-bottom-width",
        "border-l" => "border-left-width",
        "grid-cols" => "grid-template-columns",
        "grid-rows" => "grid-template-rows",
        "col-span" => "grid-column",
        "row-span" => "grid-row",
        "leading" => "line-height",
        "tracking" => "letter-spacing",
        "aspect" => "aspect-ratio",
        "basis" => "flex-basis",
        "z" => "z-index",
        "order" => "order",
        "top" => "top",
        "right" => "right",
        "bottom" => "bottom",
        "left" => "left",
        "inset" => "inset",
        "translate-x" => "translate",
        "fill" => "fill",
        "stroke" => "stroke",
        "shadow" => "box-shadow",
        "opacity" => "opacity",
        "blur" => "filter",
        "duration" => "transition-duration",
        "transition" => "transition-property",
        "font" => "font-family",
        "leading-trim" => "line-height",
        "outline-offset" => "outline-offset",
        // tailwind-animations port, Slice 3 — `animate-bezier-[.4,0,.2,1]` has
        // no closed value set (arbitrary cubic-bezier args), so it's arbitrary-
        // value-only, unlike the closed-keyword animate-ease* family above.
        "animate-bezier" => "animation-timing-function",
        // Slice 5 — `animate-slide-distance-[32px]` sets the custom property
        // the ported slide-* keyframes read via `var(--aihu-anim-slide-distance, 20px)`.
        "animate-slide-distance" => "--aihu-anim-slide-distance",
        // Slice 12 — the arbitrary-value forms of the dialog family's two
        // free-valued knobs. `animate-dialog-duration-[0.4s]` complements the
        // integer-millisecond `animate-dialog-duration-400` above (upstream's
        // `--value(…, [duration], [*])` third branch), and
        // `animate-dialog-easing-[cubic-bezier(...)]` exposes the easing custom
        // property that upstream reads but ships no utility for.
        "animate-dialog-duration" => "--aihu-anim-dialog-duration",
        "animate-dialog-easing" => "--aihu-anim-dialog-easing",
        // Slice 11 — arbitrary-value escape hatches for the four
        // scroll-driven-timeline families, e.g. `timeline-[--my-timeline]`,
        // `animate-range-[10%_50%]`. Named forms live in `fixed_utility`
        // above; `timeline-*`'s named forms carry upstream's `!important`,
        // but this generic arbitrary-value path (shared with every other
        // `[…]`-bracket utility) does not support appending it — a rarer,
        // acceptable inconsistency versus special-casing this one prefix.
        "timeline" => "animation-timeline",
        "scroll-timeline-axis" => "scroll-timeline-axis",
        "view-timeline-axis" => "view-timeline-axis",
        "animate-range" => "animation-range",
        _ => return None,
    })
}

/// Parse the Tailwind v4 CSS-variable shorthand `prefix-(--token)`. Desugars to
/// `prefix-[var(--token)]`, but resolves the property through the *prefix's*
/// type: color prefixes (`bg`/`text`/`border`/`fill`/`stroke`/`ring`/`outline`)
/// → the color property, `divide` → the sibling border-color recipe, gradient
/// prefixes → a gradient stop, everything else → the length/box property. An
/// optional trailing `/NN` is handled upstream by `parse_color_opacity` (which
/// re-resolves the base through here), so this function never sees the opacity.
pub fn parse_var_shorthand(class_name: &str) -> Option<String> {
    let open = class_name.find("-(")?;
    if !class_name.ends_with(')') {
        return None;
    }
    let prefix = &class_name[..open];
    let inner = &class_name[open + 2..class_name.len() - 1];
    if !inner.starts_with("--") {
        return None;
    }
    let value = format!("var({inner})");
    if let Some(prop) = color_prop(prefix) {
        return Some(format!("{prop}: {value};"));
    }
    if prefix == "divide" {
        return Some(format!("& > * + * {{ border-color: {value}; }}"));
    }
    if matches!(prefix, "from" | "via" | "to") {
        return gradient_stop(prefix, &value);
    }
    if let Some(prop) = arbitrary_prop(prefix) {
        return Some(format!("{prop}: {value};"));
    }
    None
}

/// Parse a gradient color-stop utility: `from-<color>`, `via-<color>`,
/// `to-<color>`. The color may be a brand/palette token, a bare keyword, an
/// arbitrary `[…]` value, or a `(--var)` shorthand.
fn parse_gradient_stop(class_name: &str) -> Option<String> {
    let (prefix, rest) = class_name.split_once('-')?;
    if !matches!(prefix, "from" | "via" | "to") {
        return None;
    }
    let color = if let Some(inner) = rest.strip_prefix('[').and_then(|r| r.strip_suffix(']')) {
        inner.replace('_', " ")
    } else if let Some(inner) = rest.strip_prefix('(').and_then(|r| r.strip_suffix(')')) {
        if !inner.starts_with("--") {
            return None;
        }
        format!("var({inner})")
    } else {
        resolve_color(rest)?
    };
    gradient_stop(prefix, &color)
}

/// Emit the `--tw-gradient-*` custom properties for a gradient color stop using
/// Tailwind's stop recipe. `bg-linear-to-*` / `bg-gradient-to-*` consume
/// `var(--tw-gradient-stops)`.
fn gradient_stop(prefix: &str, color: &str) -> Option<String> {
    Some(match prefix {
        "from" => format!(
            "--tw-gradient-from: {color}; --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to, rgb(0 0 0 / 0));"
        ),
        "via" => format!(
            "--tw-gradient-stops: var(--tw-gradient-from), {color}, var(--tw-gradient-to, rgb(0 0 0 / 0));"
        ),
        "to" => format!("--tw-gradient-to: {color};"),
        _ => return None,
    })
}

/// Scan emitted CSS for `var(--color-<family>-<shade>)` palette references and
/// register each one the theme does not already define with its Tailwind v4
/// oklch value. Palette utilities compile to `var(--color-*)` refs; Tailwind
/// ships the palette in its default theme, so the scoped emitter calls this to
/// give the referenced colors a `var()` fallback (only the ones a component
/// actually uses, not all 286). They register as defaults, not declarations,
/// so an app-level `--color-red-500` still wins inside the component.
pub fn register_used_palette(css: &str, theme: &mut crate::theme::ThemeRegistry) {
    const NEEDLE: &str = "var(--color-";
    let mut decls = String::new();
    let mut seen = std::collections::BTreeSet::new();
    let mut rest = css;
    while let Some(pos) = rest.find(NEEDLE) {
        let after = &rest[pos + NEEDLE.len()..];
        let Some(close) = after.find(')') else { break };
        let token = &after[..close];
        rest = &after[close..];
        // Only `<family>-<shade>` palette tokens (brand tokens like `primary`
        // are already registered and have no oklch table entry).
        if !seen.insert(token.to_string()) {
            continue;
        }
        let name = format!("--color-{token}");
        if theme.get(&name).is_none() {
            if let Some(value) = crate::palette::oklch(token) {
                decls.push_str(&format!("{name}: {value};\n"));
            }
        }
    }
    if !decls.is_empty() {
        theme.register_defaults(&decls);
    }
}

/// Resolve a color name (brand token, palette token, or bare keyword) to its
/// CSS value. Brand + palette tokens resolve to `var(--color-*)`.
fn resolve_color(name: &str) -> Option<String> {
    if is_brand_token(name) || is_palette_token(name) {
        return Some(format!("var(--color-{name})"));
    }
    named_keyword_color(name).map(str::to_string)
}

/// Map a gradient direction suffix (`bg-linear-to-<dir>`) to its `linear-gradient`
/// direction keyword.
fn gradient_dir(value: &str) -> Option<&'static str> {
    Some(match value {
        "t" => "to top",
        "tr" => "to top right",
        "r" => "to right",
        "br" => "to bottom right",
        "b" => "to bottom",
        "bl" => "to bottom left",
        "l" => "to left",
        "tl" => "to top left",
        _ => return None,
    })
}

/// Fixed long-tail utilities (display, flex, position, alignment, etc.).
fn fixed_utility(class_name: &str) -> Option<&'static str> {
    Some(match class_name {
        // Display
        "block" => "display: block;",
        "inline-block" => "display: inline-block;",
        "inline" => "display: inline;",
        "flex" => "display: flex;",
        "inline-flex" => "display: inline-flex;",
        "grid" => "display: grid;",
        "inline-grid" => "display: inline-grid;",
        "hidden" => "display: none;",
        "contents" => "display: contents;",

        // Container-query context. `@container` (and the named `@container/<name>`
        // form, normalized in `utility_to_css`) marks an element as a query
        // container so descendant `@sm:`/`@md:`/`@lg:` variants resolve against
        // its inline size. Tailwind's default container-type is `inline-size`.
        "@container" => "container-type: inline-size;",

        // Flexbox / grid alignment
        "flex-row" => "flex-direction: row;",
        "flex-col" => "flex-direction: column;",
        "flex-wrap" => "flex-wrap: wrap;",
        "flex-nowrap" => "flex-wrap: nowrap;",
        "flex-1" => "flex: 1 1 0%;",
        "flex-auto" => "flex: 1 1 auto;",
        "flex-none" => "flex: none;",
        "items-start" => "align-items: flex-start;",
        "items-center" => "align-items: center;",
        "items-end" => "align-items: flex-end;",
        "items-stretch" => "align-items: stretch;",
        "items-baseline" => "align-items: baseline;",
        "justify-start" => "justify-content: flex-start;",
        "justify-center" => "justify-content: center;",
        "justify-end" => "justify-content: flex-end;",
        "justify-between" => "justify-content: space-between;",
        "justify-around" => "justify-content: space-around;",
        "justify-evenly" => "justify-content: space-evenly;",

        // Interactivity
        "select-none" => "user-select: none;",
        "select-text" => "user-select: text;",
        "select-all" => "user-select: all;",
        "select-auto" => "user-select: auto;",
        "pointer-events-none" => "pointer-events: none;",
        "pointer-events-auto" => "pointer-events: auto;",

        // Position
        "static" => "position: static;",
        "relative" => "position: relative;",
        "absolute" => "position: absolute;",
        "fixed" => "position: fixed;",
        "sticky" => "position: sticky;",

        // Overflow
        "overflow-hidden" => "overflow: hidden;",
        "overflow-auto" => "overflow: auto;",
        "overflow-scroll" => "overflow: scroll;",
        "overflow-visible" => "overflow: visible;",

        // Typography
        "text-left" => "text-align: left;",
        "text-center" => "text-align: center;",
        "text-right" => "text-align: right;",
        "text-justify" => "text-align: justify;",
        "italic" => "font-style: italic;",
        "not-italic" => "font-style: normal;",
        "underline" => "text-decoration-line: underline;",
        "line-through" => "text-decoration-line: line-through;",
        "no-underline" => "text-decoration-line: none;",
        "uppercase" => "text-transform: uppercase;",
        "lowercase" => "text-transform: lowercase;",
        "capitalize" => "text-transform: capitalize;",
        "truncate" => "overflow: hidden; text-overflow: ellipsis; white-space: nowrap;",
        "font-thin" => "font-weight: 100;",
        "font-normal" => "font-weight: 400;",
        "font-medium" => "font-weight: 500;",
        "font-semibold" => "font-weight: 600;",
        "font-bold" => "font-weight: 700;",
        "font-black" => "font-weight: 900;",
        // Font-family families. Resolved as FIXED utilities (not parameterized)
        // so they don't muddy the `("font","font-weight")` conflict group key.
        // The `--font-sans`/`--font-mono` tokens are shipped by both packs.
        "font-sans" => "font-family: var(--font-sans);",
        "font-mono" => "font-family: var(--font-mono);",

        // Borders / effects
        "border" => "border-width: 1px;",
        "rounded" => "border-radius: 0.25rem;",
        "rounded-none" => "border-radius: 0;",
        "rounded-sm" => "border-radius: 0.125rem;",
        "rounded-md" => "border-radius: 0.375rem;",
        "rounded-lg" => "border-radius: 0.5rem;",
        "rounded-xl" => "border-radius: 0.75rem;",
        "rounded-2xl" => "border-radius: 1rem;",
        "rounded-full" => "border-radius: 9999px;",
        "shadow" => "box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1);",
        "shadow-sm" => "box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);",
        "shadow-md" => "box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);",
        "shadow-lg" => "box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);",
        "shadow-none" => "box-shadow: none;",

        // Border widths (fixed N values). Directional + arbitrary `border-N`
        // arms are also wired via `parameterized_utility` below.
        "border-0" => "border-width: 0;",
        "border-2" => "border-width: 2px;",
        "border-4" => "border-width: 4px;",
        "border-8" => "border-width: 8px;",
        "border-x-0" => "border-inline-width: 0;",
        "border-x-2" => "border-inline-width: 2px;",
        "border-x-4" => "border-inline-width: 4px;",
        "border-x-8" => "border-inline-width: 8px;",
        "border-y-0" => "border-block-width: 0;",
        "border-y-2" => "border-block-width: 2px;",
        "border-y-4" => "border-block-width: 4px;",
        "border-y-8" => "border-block-width: 8px;",

        // `divide-x` / `divide-y` — sibling borders between adjacent children.
        // Bare forms default to 1px (Tailwind parity). These reuse the proven
        // `space-*` nested-rule path: a `& > * + *` block survives the scoped
        // CSS-nesting emission path and minifies to `.divide-x>*+*{...}`.
        // Numeric forms (`divide-x-2`, …) and `-reverse` are handled in
        // `parameterized_utility` (split on the last `-`).
        "divide-x" => "& > * + * { border-inline-width: 1px; }",
        "divide-y" => "& > * + * { border-block-width: 1px; }",
        // Bare directional borders default to 1px (Tailwind parity). The numeric
        // forms (`border-t-2`, …) follow below. With the Preflight reset
        // (`*,::before,::after { border-style: solid }`) these render visibly.
        "border-t" => "border-top-width: 1px;",
        "border-r" => "border-right-width: 1px;",
        "border-b" => "border-bottom-width: 1px;",
        "border-l" => "border-left-width: 1px;",
        "border-x" => "border-inline-width: 1px;",
        "border-y" => "border-block-width: 1px;",
        "border-t-0" => "border-top-width: 0;",
        "border-t-2" => "border-top-width: 2px;",
        "border-t-4" => "border-top-width: 4px;",
        "border-t-8" => "border-top-width: 8px;",
        "border-r-0" => "border-right-width: 0;",
        "border-r-2" => "border-right-width: 2px;",
        "border-r-4" => "border-right-width: 4px;",
        "border-r-8" => "border-right-width: 8px;",
        "border-b-0" => "border-bottom-width: 0;",
        "border-b-2" => "border-bottom-width: 2px;",
        "border-b-4" => "border-bottom-width: 4px;",
        "border-b-8" => "border-bottom-width: 8px;",
        "border-l-0" => "border-left-width: 0;",
        "border-l-2" => "border-left-width: 2px;",
        "border-l-4" => "border-left-width: 4px;",
        "border-l-8" => "border-left-width: 8px;",

        // Relational marker classes. `group` / `peer` carry no styles of their
        // own — they mark an ancestor / previous-sibling so that `group-*:` /
        // `peer-*:` variant rules on other elements can target their state. We
        // emit an EMPTY-body rule (`.group {  }`) rather than returning `None`
        // so the scanner keeps the class in the utility set and the marker
        // survives into the shadow `<style>` (a dropped class would break the
        // relational selectors that reference `.group` / `.peer`).
        "group" => "",
        "peer" => "",

        // Width / height keywords
        "w-full" => "width: 100%;",
        "w-screen" => "width: 100vw;",
        "w-auto" => "width: auto;",
        "h-full" => "height: 100%;",
        "h-screen" => "height: 100vh;",
        "h-auto" => "height: auto;",

        // max-width named scale (Tailwind v4 defaults).
        "max-w-none" => "max-width: none;",
        "max-w-xs" => "max-width: 20rem;",
        "max-w-sm" => "max-width: 24rem;",
        "max-w-md" => "max-width: 28rem;",
        "max-w-lg" => "max-width: 32rem;",
        "max-w-xl" => "max-width: 36rem;",
        "max-w-2xl" => "max-width: 42rem;",
        "max-w-3xl" => "max-width: 48rem;",
        "max-w-4xl" => "max-width: 56rem;",
        "max-w-5xl" => "max-width: 64rem;",
        "max-w-6xl" => "max-width: 72rem;",
        "max-w-7xl" => "max-width: 80rem;",
        "max-w-full" => "max-width: 100%;",
        "max-w-prose" => "max-width: 65ch;",
        "max-w-min" => "max-width: min-content;",
        "max-w-max" => "max-width: max-content;",
        "max-w-fit" => "max-width: fit-content;",
        "max-w-screen-sm" => "max-width: 40rem;",
        "max-w-screen-md" => "max-width: 48rem;",
        "max-w-screen-lg" => "max-width: 64rem;",
        "max-w-screen-xl" => "max-width: 80rem;",
        "max-w-screen-2xl" => "max-width: 96rem;",

        // Grid template keyword forms (numeric forms handled by
        // `parameterized_utility`).
        "grid-cols-none" => "grid-template-columns: none;",
        "grid-rows-none" => "grid-template-rows: none;",
        "col-span-full" => "grid-column: 1 / -1;",
        "row-span-full" => "grid-row: 1 / -1;",
        "col-auto" => "grid-column: auto;",
        "row-auto" => "grid-row: auto;",

        // z-index keyword (numeric forms handled by `parameterized_utility`).
        "z-auto" => "z-index: auto;",

        // Ring (box-shadow) — default width is 3px (Tailwind v4). The numeric
        // `ring-{n}` forms are handled by `parameterized_utility`; `ring-inset`
        // flips the inset slot of the composed shadow. NOTE: the bare `ring`
        // keyword must be matched HERE (fixed) so it never collides with the
        // color path — `ring-<color>` still routes through `brand_color_utility`
        // because its value (`blue-500`, `primary`, …) is not a width.
        "ring" => RING_3,
        "ring-inset" => "--tw-ring-inset: inset;",

        // --- Motion (Round 2: tailwind-support `motion` track) -------------
        //
        // Transform: this engine emits direct `transform:` declarations per
        // family (no CSS-var composition), so `transform` is the GPU-friendly
        // identity baseline and `transform-none` disables it.
        "transform" => "transform: translate(0, 0) rotate(0) skewX(0) skewY(0) scaleX(1) scaleY(1);",
        "transform-none" => "transform: none;",

        // Transition shorthands. `transition` is Tailwind's default property
        // set; the property-scoped variants narrow it. All ship the default
        // 150ms / cubic-bezier timing so a bare `transition` animates.
        "transition" => "transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms;",
        "transition-none" => "transition-property: none;",
        "transition-all" => "transition-property: all; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms;",
        "transition-colors" => "transition-property: color, background-color, border-color, text-decoration-color, fill, stroke; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms;",
        "transition-opacity" => "transition-property: opacity; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms;",
        "transition-transform" => "transition-property: transform; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms;",

        // Timing functions (Tailwind v4 defaults).
        "ease-linear" => "transition-timing-function: linear;",
        "ease-in" => "transition-timing-function: cubic-bezier(0.4, 0, 1, 1);",
        "ease-out" => "transition-timing-function: cubic-bezier(0, 0, 0.2, 1);",
        "ease-in-out" => "transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);",

        // Animations. The `animation:` shorthand is emitted here; the matching
        // `@keyframes` block is hoisted as a sibling rule by the emitter via
        // `animation_keyframes()` (see emit.rs / lib.rs). `animate-none` clears
        // any running animation and needs no keyframes.
        "animate-none" => "animation: none;",
        "animate-spin" => "animation: spin 1s linear infinite;",
        "animate-ping" => "animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite;",
        "animate-pulse" => "animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;",
        "animate-bounce" => "animation: bounce 1s infinite;",

        // tailwind-animations port, Slice 2 (docs/plans/2026-08-01-tailwind-animations-port.md) —
        // closed-keyword modifier families for the ported catalog. Direction/
        // play-state/fill-mode are fixed sets (not parameterized); delay/
        // duration/iteration-count are parameterized (see parameterized_utility).
        "animate-direction-normal" => "animation-direction: normal;",
        "animate-direction-reverse" => "animation-direction: reverse;",
        "animate-direction-alternate" => "animation-direction: alternate;",
        "animate-direction-alternate-reverse" => "animation-direction: alternate-reverse;",
        "animate-play-running" => "animation-play-state: running;",
        "animate-play-paused" => "animation-play-state: paused;",
        "animate-fill-mode-none" => "animation-fill-mode: none;",
        "animate-fill-mode-forwards" => "animation-fill-mode: forwards;",
        "animate-fill-mode-backwards" => "animation-fill-mode: backwards;",
        "animate-fill-mode-both" => "animation-fill-mode: both;",

        // tailwind-animations port, Slice 3 — easing modifiers. Distinct
        // names from the existing `ease-*` utilities above, which set
        // `transition-timing-function`; these set `animation-timing-function`.
        "animate-ease" => "animation-timing-function: ease;",
        "animate-ease-in" => "animation-timing-function: ease-in;",
        "animate-ease-out" => "animation-timing-function: ease-out;",
        "animate-ease-in-out" => "animation-timing-function: ease-in-out;",
        "animate-linear" => "animation-timing-function: linear;",

        // tailwind-animations port, Slice 12 — dialog entry/exit MODIFIERS.
        // The base `animate-dialog` / `animate-dialog-backdrop` are a
        // three-rule state machine and therefore live in the recipe channel
        // (`recipes/dialog.css`, which carries the full decision record);
        // these six are single flat custom-property blocks, so they are
        // ordinary utilities exactly like every other modifier family above.
        // Being utilities is also what gets them `conflict_groups()` entries
        // and therefore `cn()` last-wins merging.
        //
        // Upstream packs the offset as one `--tw-anim-dialog-start-translate`
        // pair; aihu splits it into scalar `-start-x`/`-start-y` so a centered
        // panel can compose it into `calc(-50% + var(…))` alongside its own
        // centering translate — see `recipes/dialog.css` §"Token renaming"
        // and `packages/ui/registry/dialog/dialog-content.aihu`.
        //
        // `0px`, not `0`: these land inside a `calc()` in the registry
        // component, where a unitless zero added to a percentage is invalid.
        "animate-dialog-from-top" => {
            "--aihu-anim-dialog-start-x: 0px; --aihu-anim-dialog-start-y: -1.5rem;"
        }
        "animate-dialog-from-bottom" => {
            "--aihu-anim-dialog-start-x: 0px; --aihu-anim-dialog-start-y: 1.5rem;"
        }
        "animate-dialog-from-left" => {
            "--aihu-anim-dialog-start-x: -1.5rem; --aihu-anim-dialog-start-y: 0px;"
        }
        "animate-dialog-from-right" => {
            "--aihu-anim-dialog-start-x: 1.5rem; --aihu-anim-dialog-start-y: 0px;"
        }
        // The two named presets also pin `-start-scale`, since "fade" means
        // opacity ONLY and "zoom" means scale only — otherwise the family
        // default (0.96) would leak into both.
        "animate-dialog-fade" => {
            "--aihu-anim-dialog-start-x: 0px; --aihu-anim-dialog-start-y: 0px; --aihu-anim-dialog-start-scale: 1;"
        }
        "animate-dialog-zoom" => {
            "--aihu-anim-dialog-start-x: 0px; --aihu-anim-dialog-start-y: 0px; --aihu-anim-dialog-start-scale: 0.92;"
        }

        // tailwind-animations port, Slice 11 — scroll-driven timelines
        // (`timeline-*`, `scroll-timeline-axis-*`, `view-timeline-axis-*`,
        // `animate-range-*`). Each is a closed named-value set + an arbitrary
        // fallback (registered in `arbitrary_prop` below) — the same
        // named-lookup-plus-bracket-escape shape as `leading-*`/`aspect-*`,
        // not a variant, so this does NOT route through `ProgressiveRegistry`
        // (`progressive.rs`): that registry is for `prefix:` VARIANTS applied
        // to another utility and gated behind `@supports` (`view-transition:`,
        // `anchor:`, …); these are ordinary base utilities. The vendor CSS
        // itself emits them ungated (no `@supports` wrapper) — same graceful-
        // degradation posture as the rest of the animation catalog, so aihu
        // follows suit. `!important` on `animation-timeline` is transcribed
        // verbatim from upstream, not an aihu convention — kept for fidelity
        // even though `@layer aihu.utilities` already outranks recipe/base
        // layers without it.
        "timeline-none" => "animation-timeline: none !important;",
        "timeline-auto" => "animation-timeline: auto !important;",
        "timeline-scroll" => "animation-timeline: scroll() !important;",
        "timeline-scroll-x" => "animation-timeline: scroll(x) !important;",
        "timeline-scroll-y" => "animation-timeline: scroll(y) !important;",
        "timeline-scroll-block" => "animation-timeline: scroll(block) !important;",
        "timeline-scroll-inline" => "animation-timeline: scroll(inline) !important;",
        "timeline-view" => "animation-timeline: view() !important;",
        "timeline-view-x" => "animation-timeline: view(x) !important;",
        "timeline-view-y" => "animation-timeline: view(y) !important;",
        "timeline-view-block" => "animation-timeline: view(block) !important;",
        "timeline-view-inline" => "animation-timeline: view(inline) !important;",

        "scroll-timeline-axis-block" => "scroll-timeline-axis: block;",
        "scroll-timeline-axis-inline" => "scroll-timeline-axis: inline;",
        "scroll-timeline-axis-x" => "scroll-timeline-axis: x;",
        "scroll-timeline-axis-y" => "scroll-timeline-axis: y;",

        "view-timeline-axis-block" => "view-timeline-axis: block;",
        "view-timeline-axis-inline" => "view-timeline-axis: inline;",
        "view-timeline-axis-x" => "view-timeline-axis: x;",
        "view-timeline-axis-y" => "view-timeline-axis: y;",

        "animate-range-normal" => "animation-range: normal;",
        "animate-range-cover" => "animation-range: cover;",
        "animate-range-contain" => "animation-range: contain;",
        "animate-range-entry" => "animation-range: entry;",
        "animate-range-exit" => "animation-range: exit;",
        "animate-range-gradual" => "animation-range: 10% 90%;",
        "animate-range-moderate" => "animation-range: 20% 80%;",
        "animate-range-brisk" => "animation-range: 30% 70%;",
        "animate-range-rapid" => "animation-range: 40% 60%;",

        // --- Parity round: long-tail fixed utilities ----------------------

        // Font family (serif completes the sans/mono pair above).
        "font-serif" => "font-family: var(--font-serif);",

        // Border-radius scale extension (2xl handled above).
        "rounded-3xl" => "border-radius: 1.5rem;",
        "rounded-4xl" => "border-radius: 2rem;",

        // Box-shadow scale extension (sm/md/lg/none handled above).
        "shadow-xs" => "box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);",
        "shadow-xl" => "box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);",
        "shadow-2xl" => "box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.25);",
        "shadow-inner" => "box-shadow: inset 0 2px 4px 0 rgb(0 0 0 / 0.05);",

        // Stacking / isolation.
        "isolate" => "isolation: isolate;",
        "isolation-auto" => "isolation: auto;",

        // GPU compositing hint. This engine emits direct `transform`
        // declarations (no var composition), so `transform-gpu` is a benign
        // 3D-context promotion that doesn't clobber a sibling transform family.
        "transform-gpu" => "transform: translateZ(0);",

        // Text wrapping / balancing (Tailwind v4).
        "text-wrap" => "text-wrap: wrap;",
        "text-nowrap" => "text-wrap: nowrap;",
        "text-balance" => "text-wrap: balance;",
        "text-pretty" => "text-wrap: pretty;",
        "whitespace-nowrap" => "white-space: nowrap;",
        "whitespace-normal" => "white-space: normal;",
        "whitespace-pre" => "white-space: pre;",
        "break-words" => "overflow-wrap: break-word;",
        "break-all" => "word-break: break-all;",

        // Cursor.
        "cursor-auto" => "cursor: auto;",
        "cursor-default" => "cursor: default;",
        "cursor-pointer" => "cursor: pointer;",
        "cursor-wait" => "cursor: wait;",
        "cursor-text" => "cursor: text;",
        "cursor-move" => "cursor: move;",
        "cursor-help" => "cursor: help;",
        "cursor-not-allowed" => "cursor: not-allowed;",
        "cursor-grab" => "cursor: grab;",
        "cursor-grabbing" => "cursor: grabbing;",

        // List style.
        "list-none" => "list-style-type: none;",
        "list-disc" => "list-style-type: disc;",
        "list-decimal" => "list-style-type: decimal;",
        "list-inside" => "list-style-position: inside;",
        "list-outside" => "list-style-position: outside;",

        // Flex item growth/shrink keywords (numeric `grow-0`/`shrink-0` below).
        "grow" => "flex-grow: 1;",
        "grow-0" => "flex-grow: 0;",
        "shrink" => "flex-shrink: 1;",
        "shrink-0" => "flex-shrink: 0;",

        // Align-self.
        "self-auto" => "align-self: auto;",
        "self-start" => "align-self: flex-start;",
        "self-end" => "align-self: flex-end;",
        "self-center" => "align-self: center;",
        "self-stretch" => "align-self: stretch;",
        "self-baseline" => "align-self: baseline;",

        // Justify-self / place.
        "justify-items-start" => "justify-items: start;",
        "justify-items-center" => "justify-items: center;",
        "justify-items-end" => "justify-items: end;",
        "place-items-center" => "place-items: center;",
        "place-content-center" => "place-content: center;",

        // Order keywords (numeric `order-N` below).
        "order-first" => "order: -9999;",
        "order-last" => "order: 9999;",
        "order-none" => "order: 0;",

        // Object fit/position.
        "object-cover" => "object-fit: cover;",
        "object-contain" => "object-fit: contain;",
        "object-center" => "object-position: center;",

        // Overflow axes.
        "overflow-x-hidden" => "overflow-x: hidden;",
        "overflow-y-hidden" => "overflow-y: hidden;",
        "overflow-x-auto" => "overflow-x: auto;",
        "overflow-y-auto" => "overflow-y: auto;",

        // Outline keywords (numeric width/offset handled in
        // `parameterized_utility`). `outline-none` follows Tailwind v4 (a
        // transparent solid outline so high-contrast modes still show focus).
        "outline-none" => "outline: 2px solid transparent; outline-offset: 2px;",
        "outline-hidden" => "outline: 2px solid transparent; outline-offset: 2px;",
        "appearance-none" => "appearance: none;",

        // Generated-content reset (e.g. `marker:content-none`, `before:content-none`).
        "content-none" => "content: none;",

        // Width/height intrinsic keywords.
        "w-min" => "width: min-content;",
        "w-max" => "width: max-content;",
        "w-fit" => "width: fit-content;",
        "h-min" => "height: min-content;",
        "h-max" => "height: max-content;",
        "h-fit" => "height: fit-content;",
        "size-full" => "width: 100%; height: 100%;",
        "size-auto" => "width: auto; height: auto;",
        "size-min" => "width: min-content; height: min-content;",
        "size-max" => "width: max-content; height: max-content;",
        "size-fit" => "width: fit-content; height: fit-content;",

        // Backdrop blur (base keyword; numeric scale below).
        "backdrop-blur" => "backdrop-filter: blur(8px);",
        "blur" => "filter: blur(8px);",
        "blur-none" => "filter: none;",

        // Screen-reader-only (a11y). Visually hidden but accessible.
        "sr-only" => "position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border-width: 0;",
        "not-sr-only" => "position: static; width: auto; height: auto; padding: 0; margin: 0; overflow: visible; clip: auto; white-space: normal;",

        _ => return None,
    })
}

/// The Tailwind v4 ring recipe, parameterized on the ring width in pixels.
///
/// A ring is a `box-shadow` composed from `--tw-ring-*` custom properties so it
/// can layer with `--tw-ring-offset-*` (set by `ring-offset-{n}`) and an
/// inset flag (`ring-inset`), and still coexist with a regular `shadow-*`:
///
/// ```text
/// --tw-ring-offset-shadow: var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color);
/// --tw-ring-shadow:        var(--tw-ring-inset) 0 0 0 calc(<n>px + var(--tw-ring-offset-width)) var(--tw-ring-color);
/// box-shadow: var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow, 0 0 #0000);
/// ```
///
/// The ring spreads by `<n>px + offset-width`; the offset shadow paints the gap
/// between the element edge and the ring in `--tw-ring-offset-color`.
fn ring_shadow(width_px: u32) -> String {
    format!(
        "--tw-ring-offset-shadow: var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color); \
--tw-ring-shadow: var(--tw-ring-inset) 0 0 0 calc({width_px}px + var(--tw-ring-offset-width)) var(--tw-ring-color); \
box-shadow: var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow, 0 0 #0000);"
    )
}

/// Static body for the default `ring` (3px) so `fixed_utility` can return a
/// `&'static str`. Kept in sync with [`ring_shadow`]`(3)`.
const RING_3: &str = "--tw-ring-offset-shadow: var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color); --tw-ring-shadow: var(--tw-ring-inset) 0 0 0 calc(3px + var(--tw-ring-offset-width)) var(--tw-ring-color); box-shadow: var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow, 0 0 #0000);";

/// Parameterized utilities split on the last `-`: `p-4`, `text-lg`, `gap-2`,
/// `text-red-500` (handled via [`palette_color`]), `z-10`, etc.
fn parameterized_utility(prefix: &str, value: &str) -> Option<String> {
    // Spacing scale: p/px/py/pt/pr/pb/pl, m/mx/my/…, gap, space — value × 0.25rem.
    if let Some(prop) = spacing_prop(prefix) {
        if let Some(rem) = spacing_value(value) {
            return Some(format!("{prop}: {rem};"));
        }
    }

    // `space-x-*` / `space-y-*` — emit a nested sibling-margin rule (Tailwind's
    // standard recipe). Modern browsers support native CSS nesting; Vite's
    // Lightning CSS / esbuild minifier handle this in build output.
    if prefix == "space-x" {
        if let Some(rem) = spacing_value(value) {
            return Some(format!("& > * + * {{ margin-inline-start: {rem}; }}"));
        }
    }
    if prefix == "space-y" {
        if let Some(rem) = spacing_value(value) {
            return Some(format!("& > * + * {{ margin-block-start: {rem}; }}"));
        }
    }

    // `divide-x-*` / `divide-y-*` — sibling borders between adjacent children,
    // reusing the same nested `& > * + *` recipe as `space-*`. Widths are a
    // closed set (0/2/4/8 px); the `-reverse` token flips which sibling owns
    // the border via the Tailwind `--tw-divide-{x,y}-reverse` custom property
    // (kept for API parity even though the simplified `& > * + *` recipe paints
    // both inline/block edges of the trailing sibling).
    if prefix == "divide-x" {
        if value == "reverse" {
            return Some("& > * + * { --tw-divide-x-reverse: 1; }".to_string());
        }
        if let Some(px) = divide_width(value) {
            return Some(format!("& > * + * {{ border-inline-width: {px}; }}"));
        }
    }
    if prefix == "divide-y" {
        if value == "reverse" {
            return Some("& > * + * { --tw-divide-y-reverse: 1; }".to_string());
        }
        if let Some(px) = divide_width(value) {
            return Some(format!("& > * + * {{ border-block-width: {px}; }}"));
        }
    }

    // Grid templating: `grid-cols-N` / `grid-rows-N` / `col-span-N` / `row-span-N`.
    if prefix == "grid-cols" {
        if let Some(n) = positive_int(value) {
            return Some(format!(
                "grid-template-columns: repeat({n}, minmax(0, 1fr));"
            ));
        }
    }
    if prefix == "grid-rows" {
        if let Some(n) = positive_int(value) {
            return Some(format!("grid-template-rows: repeat({n}, minmax(0, 1fr));"));
        }
    }
    if prefix == "col-span" {
        if let Some(n) = positive_int(value) {
            return Some(format!("grid-column: span {n} / span {n};"));
        }
    }
    if prefix == "row-span" {
        if let Some(n) = positive_int(value) {
            return Some(format!("grid-row: span {n} / span {n};"));
        }
    }

    // Position scale: top/right/bottom/left/inset/inset-x/inset-y on the
    // spacing scale, plus `auto`. A leading `-` on the prefix (e.g. `-left-2`
    // arrives here as prefix `-left`) negates the spacing value — Tailwind's
    // negative-position syntax. `auto` is never negated.
    {
        let (neg, base_prefix) = match prefix.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, prefix),
        };
        if let Some(prop) = position_prop(base_prefix) {
            if let Some(v) = position_value(value) {
                if neg && v != "auto" && v != "0" {
                    return Some(format!("{prop}: -{v};"));
                }
                return Some(format!("{prop}: {v};"));
            }
        }
    }

    // Named line-height scale: `leading-none|tight|snug|normal|relaxed|loose`
    // (unitless multipliers) plus the numeric `leading-<n>` step which maps to
    // the spacing scale (`leading-6` → `1.5rem`), matching Tailwind v4.
    if prefix == "leading" {
        if let Some(lh) = leading_value(value) {
            return Some(format!("line-height: {lh};"));
        }
        if let Some(rem) = spacing_value(value) {
            return Some(format!("line-height: {rem};"));
        }
    }

    // Named letter-spacing scale: `tracking-tighter|tight|normal|wide|wider|
    // widest` in `em` units (Tailwind v4 defaults).
    if prefix == "tracking" {
        if let Some(ls) = tracking_value(value) {
            return Some(format!("letter-spacing: {ls};"));
        }
    }

    // Sizing: w-/h-/min-w-/max-w- with the spacing scale or fractions.
    if let Some(prop) = sizing_prop(prefix) {
        if let Some(v) = sizing_value(value) {
            return Some(format!("{prop}: {v};"));
        }
    }

    // Font size (with paired line-height, Tailwind defaults). The
    // `text-<size>/<lh>` slash form overrides the paired line-height with a
    // step from the spacing scale (`text-sm/6` → line-height 1.5rem).
    if prefix == "text" {
        if let Some((size, lh)) = value.split_once('/') {
            if let (Some((fs, _)), Some(lhv)) = (font_size_parts(size), spacing_value(lh)) {
                return Some(format!("font-size: {fs}; line-height: {lhv};"));
            }
        }
        if let Some((fs, lh)) = font_size_parts(value) {
            return Some(format!("font-size: {fs}; line-height: {lh};"));
        }
        // text-<color>-<shade> falls through to the color path below.
    }

    // --- Parity round: parameterized families -------------------------------

    // `size-N` → equal width + height on the spacing scale / fractions.
    if prefix == "size" {
        if let Some(v) = sizing_value(value) {
            return Some(format!("width: {v}; height: {v};"));
        }
    }

    // `aspect-<ratio>` — `aspect-square|video|auto` keywords plus bare ratios
    // (`aspect-16/9`, `aspect-1108/632`). The `/` ratio survives the last-`-`
    // split as the value, so it lands here intact.
    if prefix == "aspect" {
        let ratio = match value {
            "square" => "1 / 1",
            "video" => "16 / 9",
            "auto" => "auto",
            v if v.split_once('/').is_some_and(|(a, b)| {
                !a.is_empty()
                    && !b.is_empty()
                    && a.bytes().all(|c| c.is_ascii_digit())
                    && b.bytes().all(|c| c.is_ascii_digit())
            }) =>
            {
                return Some(format!("aspect-ratio: {};", v.replace('/', " / ")));
            }
            _ => return None,
        };
        return Some(format!("aspect-ratio: {ratio};"));
    }

    // `order-N` / `-order-N`.
    {
        let (neg, base) = match prefix.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, prefix),
        };
        if base == "order" {
            if let Some(n) = positive_int_or_zero(value) {
                return Some(format!("order: {}{n};", if neg { "-" } else { "" }));
            }
        }
    }

    // `blur-N` / `backdrop-blur-N` named filter scale.
    if prefix == "blur" {
        if let Some(px) = blur_radius(value) {
            return Some(format!("filter: blur({px});"));
        }
    }
    if prefix == "backdrop-blur" {
        if let Some(px) = blur_radius(value) {
            return Some(format!("backdrop-filter: blur({px});"));
        }
    }

    // `outline-N` width (+ `outline-style: solid` so it paints; the engine has
    // no per-element preflight for outline-style) and `outline-offset-N`
    // (negative form via the `-` prefix).
    if prefix == "outline" {
        if let Some(px) = ring_width(value) {
            return Some(format!("outline-style: solid; outline-width: {px}px;"));
        }
    }
    {
        let (neg, base) = match prefix.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, prefix),
        };
        if base == "outline-offset" {
            if let Some(px) = ring_width(value) {
                return Some(format!(
                    "outline-offset: {}{px}px;",
                    if neg { "-" } else { "" }
                ));
            }
        }
    }

    // Linear-gradient direction: `bg-linear-to-r`, `bg-gradient-to-br`.
    if prefix == "bg-linear-to" || prefix == "bg-gradient-to" {
        if let Some(dir) = gradient_dir(value) {
            return Some(format!(
                "background-image: linear-gradient({dir}, var(--tw-gradient-stops));"
            ));
        }
    }

    // Negative margins: `-m-4`, `-ml-1`. Only the margin family negates (padding
    // has no negative form); the positive forms are handled by the spacing path
    // at the top of this function.
    if let Some(base) = prefix.strip_prefix('-') {
        if base.starts_with('m') {
            if let Some(prop) = spacing_prop(base) {
                if let Some(v) = spacing_value(value) {
                    if v != "auto" && v != "0" {
                        return Some(format!("{prop}: -{v};"));
                    }
                    return Some(format!("{prop}: {v};"));
                }
            }
        }
    }

    // Border radius scale already covered by fixed_utility for named sizes.

    // z-index (`z-10`, `-z-10`).
    {
        let (neg, base) = match prefix.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, prefix),
        };
        if base == "z" && !value.is_empty() && value.chars().all(|c| c.is_ascii_digit()) {
            return Some(format!("z-index: {}{value};", if neg { "-" } else { "" }));
        }
    }

    // opacity.
    if prefix == "opacity" {
        if let Ok(n) = value.parse::<f32>() {
            return Some(format!("opacity: {};", n / 100.0));
        }
    }

    // Ring width: `ring-{0,1,2,4,8}` → the composed `box-shadow` recipe at the
    // given pixel width. Routed BEFORE the color path so a numeric value never
    // falls through to a color lookup; `ring-<color>` (e.g. `ring-blue-500`,
    // `ring-primary`) has a non-numeric value and is handled by
    // `brand_color_utility`, which still emits `--tw-ring-color`.
    if prefix == "ring" {
        if let Some(n) = ring_width(value) {
            return Some(ring_shadow(n));
        }
    }

    // Ring offset width: `ring-offset-{0,1,2,4,8}` → `--tw-ring-offset-width`.
    // (Color offsets like `ring-offset-blue-500` are out of scope; the width
    // value here is always numeric.)
    if prefix == "ring-offset" {
        if let Some(n) = ring_width(value) {
            return Some(format!("--tw-ring-offset-width: {n}px;"));
        }
    }

    // --- Motion (Round 2: tailwind-support `motion` track) -----------------
    //
    // Translate uses the spacing scale (`translate-x-2` → 0.5rem); negative
    // forms are routed through `negate_motion` in `utility_to_css`.
    if prefix == "translate-x" {
        if let Some(len) = translate_length(value) {
            return Some(format!("transform: translateX({len});"));
        }
    }
    if prefix == "translate-y" {
        if let Some(len) = translate_length(value) {
            return Some(format!("transform: translateY({len});"));
        }
    }
    // Rotate: integer degrees (`rotate-45` → 45deg).
    if prefix == "rotate" {
        if let Some(deg) = positive_int(value) {
            return Some(format!("transform: rotate({deg}deg);"));
        }
    }
    // Scale: percentage value mapped to a unit multiplier (`scale-105` → 1.05).
    if prefix == "scale" {
        if let Some(factor) = scale_factor(value) {
            return Some(format!("transform: scale({factor});"));
        }
    }
    if prefix == "scale-x" {
        if let Some(factor) = scale_factor(value) {
            return Some(format!("transform: scaleX({factor});"));
        }
    }
    if prefix == "scale-y" {
        if let Some(factor) = scale_factor(value) {
            return Some(format!("transform: scaleY({factor});"));
        }
    }
    // Transition duration: integer milliseconds (`duration-300` → 300ms).
    if prefix == "duration" {
        if let Some(ms) = positive_int_or_zero(value) {
            return Some(format!("transition-duration: {ms}ms;"));
        }
    }

    // tailwind-animations port, Slice 2 — parameterized animation modifiers.
    // Distinct prefixes from `duration`/`ease-*` above (those target
    // `transition-*`; these target `animation-*`).
    if prefix == "animate-delay" {
        if let Some(ms) = positive_int_or_zero(value) {
            return Some(format!("animation-delay: {ms}ms;"));
        }
    }
    if prefix == "animate-duration" {
        if let Some(ms) = positive_int_or_zero(value) {
            return Some(format!("animation-duration: {ms}ms;"));
        }
    }
    if prefix == "animate-iteration-count" {
        if value == "infinite" {
            return Some("animation-iteration-count: infinite;".to_string());
        }
        if let Some(n) = positive_int(value) {
            return Some(format!("animation-iteration-count: {n};"));
        }
    }
    // Slice 12 — `animate-dialog-duration-250` → the custom property the
    // `animate-dialog` recipe (and the dialog registry components) read for
    // every one of their transition durations/delays. Distinct from
    // `animate-duration` above: that sets `animation-duration` on a
    // keyframe-backed animation, this reconfigures a TRANSITION-driven family
    // that has no `animation` at all. Checked before `animate-duration` can
    // ever see it because `parameterized_utility` splits on the LAST `-`, so
    // the prefix is the full `animate-dialog-duration`.
    if prefix == "animate-dialog-duration" {
        if let Some(ms) = positive_int_or_zero(value) {
            return Some(format!("--aihu-anim-dialog-duration: {ms}ms;"));
        }
    }
    // Slice 3 — `animate-steps-4` → `steps(4)`. `animate-bezier-[...]` (the
    // arbitrary-value form) is registered via `arbitrary_prop` below, not
    // here, since it has no closed integer/keyword set.
    if prefix == "animate-steps" {
        if let Some(n) = positive_int(value) {
            return Some(format!("animation-timing-function: steps({n});"));
        }
    }

    // Palette colors: bg-red-500, text-slate-700, border-emerald-300.
    if let Some(prop) = color_prop(prefix) {
        // prefix already stripped to the color path; value is the shade only
        // when the full name was `prefix-color-shade`. We handle that in the
        // caller via the full-string brand path; here handle `prefix-keyword`.
        if let Some(color) = named_keyword_color(value) {
            return Some(format!("{prop}: {color};"));
        }
    }

    None
}

/// Whole-token brand + palette color utilities: `bg-primary`, `text-accent`,
/// `bg-red-500`. Brand tokens resolve to `var(--color-*)`; palette tokens to
/// concrete oklch values.
fn brand_color_utility(class_name: &str) -> Option<String> {
    // Split into <prefix>-<rest> where rest is the color name (may contain `-`).
    let idx = class_name.find('-')?;
    let (prefix, rest) = (&class_name[..idx], &class_name[idx + 1..]);
    let prop = color_prop(prefix)?;

    // Brand tokens: primary, secondary, accent, surface, muted, foreground, …
    if is_brand_token(rest) {
        return Some(format!("{prop}: var(--color-{rest});"));
    }
    // Palette: red-500, slate-700 → var(--color-red-500) (registered by theme).
    if is_palette_token(rest) {
        return Some(format!("{prop}: var(--color-{rest});"));
    }
    // Bare keyword colors: white/black/transparent/current.
    if let Some(color) = named_keyword_color(rest) {
        return Some(format!("{prop}: {color};"));
    }
    None
}

fn color_prop(prefix: &str) -> Option<&'static str> {
    Some(match prefix {
        "bg" => "background-color",
        "text" => "color",
        "border" => "border-color",
        "fill" => "fill",
        "stroke" => "stroke",
        "ring" => "--tw-ring-color",
        "outline" => "outline-color",
        _ => return None,
    })
}

fn is_brand_token(name: &str) -> bool {
    matches!(
        name,
        "primary"
            | "primary-foreground"
            | "secondary"
            | "secondary-foreground"
            | "accent"
            | "accent-foreground"
            | "surface"
            | "surface-foreground"
            | "background"
            | "foreground"
            | "muted"
            | "muted-foreground"
            | "border"
            | "ring"
            | "destructive"
            | "destructive-foreground"
            // D4 §3.4 (E1 + E2, founder-ratified) — semantic-state + filled-
            // surface tokens so `bg-info`/`text-success`/`border-neutral`/…
            // resolve. `neutral` is bare-word here (→ `var(--color-neutral)`);
            // the pre-existing `neutral-500`-style shade form is a DISTINCT
            // path through `is_palette_token`, not this function.
            | "info"
            | "info-foreground"
            | "success"
            | "success-foreground"
            | "warning"
            | "warning-foreground"
            | "neutral"
            | "neutral-foreground"
    )
}

/// `red-500`, `slate-700`, etc. — palette family + numeric shade.
fn is_palette_token(name: &str) -> bool {
    let Some((family, shade)) = name.rsplit_once('-') else {
        return false;
    };
    const FAMILIES: &[&str] = &[
        "slate", "gray", "zinc", "neutral", "stone", "red", "orange", "amber", "yellow", "lime",
        "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia",
        "pink", "rose",
    ];
    FAMILIES.contains(&family)
        && matches!(
            shade,
            "50" | "100" | "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900" | "950"
        )
}

fn named_keyword_color(name: &str) -> Option<&'static str> {
    Some(match name {
        "white" => "#fff",
        "black" => "#000",
        "transparent" => "transparent",
        "current" => "currentColor",
        "inherit" => "inherit",
        _ => return None,
    })
}

fn spacing_prop(prefix: &str) -> Option<&'static str> {
    Some(match prefix {
        "p" => "padding",
        "px" => "padding-inline",
        "py" => "padding-block",
        "pt" => "padding-top",
        "pr" => "padding-right",
        "pb" => "padding-bottom",
        "pl" => "padding-left",
        "m" => "margin",
        "mx" => "margin-inline",
        "my" => "margin-block",
        "mt" => "margin-top",
        "mr" => "margin-right",
        "mb" => "margin-bottom",
        "ml" => "margin-left",
        "gap" => "gap",
        "gap-x" => "column-gap",
        "gap-y" => "row-gap",
        _ => return None,
    })
}

/// Tailwind spacing scale: numeric → `n * 0.25rem`; `px` → `1px`; `0` → `0`;
/// `auto` → `auto` (so `mx-auto`, `my-auto`, `mt-auto`, etc. work).
fn spacing_value(value: &str) -> Option<String> {
    if value == "auto" {
        return Some("auto".to_string());
    }
    if value == "px" {
        return Some("1px".to_string());
    }
    if value == "0" {
        return Some("0".to_string());
    }
    // Fractional steps like `0.5`, `1.5`, `2.5`.
    let n: f32 = value.parse().ok()?;
    let rem = n * 0.25;
    Some(format!("{}rem", trim_float(rem)))
}

/// Map a `divide-{x,y}-N` width token to its CSS px value. Closed set matching
/// Tailwind's divide-width scale (`0/2/4/8`); the bare `divide-x`/`divide-y`
/// (1px default) is handled as a fixed utility.
fn divide_width(value: &str) -> Option<&'static str> {
    Some(match value {
        "0" => "0",
        "2" => "2px",
        "4" => "4px",
        "8" => "8px",
        _ => return None,
    })
}

/// Parse a positive integer (used by grid-cols-N, col-span-N, row-span-N).
fn positive_int(value: &str) -> Option<u32> {
    if value.is_empty() || !value.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let n: u32 = value.parse().ok()?;
    if n == 0 {
        return None;
    }
    Some(n)
}

/// Map a position-scale prefix to its CSS property. `inset` is the all-sides
/// shorthand; `inset-x`/`inset-y` are the logical inline/block shorthands.
/// (Arbitrary forms `top-[…]` etc. are handled separately by `arbitrary_prop`;
/// this is only the named/numeric spacing-scale path.)
fn position_prop(prefix: &str) -> Option<&'static str> {
    Some(match prefix {
        "top" => "top",
        "right" => "right",
        "bottom" => "bottom",
        "left" => "left",
        "inset" => "inset",
        "inset-x" => "inset-inline",
        "inset-y" => "inset-block",
        _ => return None,
    })
}

/// Named line-height scale (`leading-*`), Tailwind v4 defaults. Unitless for
/// `none`, otherwise unitless multipliers.
fn leading_value(value: &str) -> Option<&'static str> {
    Some(match value {
        "none" => "1",
        "tight" => "1.25",
        "snug" => "1.375",
        "normal" => "1.5",
        "relaxed" => "1.625",
        "loose" => "2",
        _ => return None,
    })
}

/// Named letter-spacing scale (`tracking-*`) in `em` units, Tailwind v4
/// defaults.
fn tracking_value(value: &str) -> Option<&'static str> {
    Some(match value {
        "tighter" => "-0.05em",
        "tight" => "-0.025em",
        "normal" => "0em",
        "wide" => "0.025em",
        "wider" => "0.05em",
        "widest" => "0.1em",
        _ => return None,
    })
}

/// Tailwind ring-width scale: `0`, `1`, `2`, `4`, `8` (px). Used by both
/// `ring-{n}` (ring spread) and `ring-offset-{n}` (offset width). Returns the
/// width in pixels, or `None` for any other value so non-width `ring-*` tokens
/// (colors, `inset`) fall through to their own handlers.
fn ring_width(value: &str) -> Option<u32> {
    match value {
        "0" => Some(0),
        "1" => Some(1),
        "2" => Some(2),
        "4" => Some(4),
        "8" => Some(8),
        _ => None,
    }
}

/// Parse a non-negative integer (`duration-0` is valid; `rotate-0` too).
fn positive_int_or_zero(value: &str) -> Option<u32> {
    if value.is_empty() || !value.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    value.parse().ok()
}

/// Translate length on the spacing scale, with `px`, fractional steps
/// (`translate-x-1/2` → 50%), and rejecting `auto`. Used by `translate-x/y-*`.
fn translate_length(value: &str) -> Option<String> {
    if value == "auto" {
        return None;
    }
    if let Some(pct) = fraction_percent(value) {
        return Some(pct);
    }
    spacing_value(value)
}

/// A `num/den` fraction as a percentage string (`1/2` → `50%`), or `None` if the
/// value is not a numeric fraction.
fn fraction_percent(value: &str) -> Option<String> {
    let (num, den) = value.split_once('/')?;
    let n: f32 = num.parse().ok()?;
    let d: f32 = den.parse().ok()?;
    if d == 0.0 {
        return None;
    }
    Some(format!("{}%", trim_float(n / d * 100.0)))
}

/// Position-scale value: fractions resolve to percentages (`left-1/2` → 50%),
/// otherwise the spacing scale (incl. `auto`, `px`, `0`).
fn position_value(value: &str) -> Option<String> {
    if let Some(pct) = fraction_percent(value) {
        return Some(pct);
    }
    spacing_value(value)
}

/// Named blur radius scale (`blur-*` / `backdrop-blur-*`), Tailwind v4 defaults.
fn blur_radius(value: &str) -> Option<&'static str> {
    Some(match value {
        "xs" => "4px",
        "sm" => "8px",
        "md" => "12px",
        "lg" => "16px",
        "xl" => "24px",
        "2xl" => "40px",
        "3xl" => "64px",
        _ => return None,
    })
}

/// Scale percentage → unit multiplier. `scale-105` → `1.05`, `scale-0` → `0`,
/// `scale-50` → `0.5`.
fn scale_factor(value: &str) -> Option<String> {
    let n = positive_int_or_zero(value)?;
    let factor = n as f32 / 100.0;
    Some(trim_float(factor))
}

/// The `@keyframes` block a given `animate-*` utility depends on, or `None` if
/// the class is not a keyframe-backed animation (`animate-none`, non-animation
/// classes). The emitter hoists this as a sibling rule so the `animation:`
/// shorthand has a definition. Re-emitting an identical `@keyframes` is
/// idempotent in CSS, so per-occurrence emission is safe.
pub fn animation_keyframes(class_name: &str) -> Option<&'static str> {
    Some(match class_name {
        "animate-spin" => {
            "@keyframes spin { to { transform: rotate(360deg); } }"
        }
        "animate-ping" => {
            "@keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }"
        }
        "animate-pulse" => {
            "@keyframes pulse { 50% { opacity: 0.5; } }"
        }
        "animate-bounce" => {
            "@keyframes bounce { 0%, 100% { transform: translateY(-25%); animation-timing-function: cubic-bezier(0.8, 0, 1, 1); } 50% { transform: none; animation-timing-function: cubic-bezier(0, 0, 0.2, 1); } }"
        }
        _ => return crate::animations::lookup(class_name).map(|a| a.keyframes),
    })
}

fn sizing_prop(prefix: &str) -> Option<&'static str> {
    Some(match prefix {
        "w" => "width",
        "h" => "height",
        "min-w" => "min-width",
        "max-w" => "max-width",
        "min-h" => "min-height",
        "max-h" => "max-height",
        _ => return None,
    })
}

fn sizing_value(value: &str) -> Option<String> {
    // Fractions: w-1/2 → 50%.
    if let Some((num, den)) = value.split_once('/') {
        let n: f32 = num.parse().ok()?;
        let d: f32 = den.parse().ok()?;
        if d != 0.0 {
            return Some(format!("{}%", trim_float(n / d * 100.0)));
        }
    }
    // Numeric spacing scale.
    spacing_value(value)
}

/// Font-size scale as `(size, line-height)` parts, Tailwind v4 defaults. The
/// caller pairs them into `font-size`/`line-height` declarations, or overrides
/// the line-height for the `text-<size>/<lh>` slash form.
fn font_size_parts(value: &str) -> Option<(&'static str, &'static str)> {
    Some(match value {
        "xs" => ("0.75rem", "1rem"),
        "sm" => ("0.875rem", "1.25rem"),
        "base" => ("1rem", "1.5rem"),
        "lg" => ("1.125rem", "1.75rem"),
        "xl" => ("1.25rem", "1.75rem"),
        "2xl" => ("1.5rem", "2rem"),
        "3xl" => ("1.875rem", "2.25rem"),
        "4xl" => ("2.25rem", "2.5rem"),
        "5xl" => ("3rem", "1"),
        "6xl" => ("3.75rem", "1"),
        "7xl" => ("4.5rem", "1"),
        "8xl" => ("6rem", "1"),
        "9xl" => ("8rem", "1"),
        _ => return None,
    })
}

/// Trim trailing `.0` from a float for clean CSS (`1.0rem` → `1rem`).
fn trim_float(n: f32) -> String {
    if n.fract() == 0.0 {
        format!("{}", n as i64)
    } else {
        let s = format!("{n}");
        s
    }
}
