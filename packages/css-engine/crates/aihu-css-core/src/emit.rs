//! `emit.rs` — scoped-output emitter (Plan 2 Tasks 4, 5, 6).
//!
//! Turns a scanned utility set into CSS. Two modes:
//!
//! - [`OutputMode::Flat`] — Plan 1 back-compat: `.class { … }` global-ish rules.
//! - [`OutputMode::Scoped`] — the new default for `compile_sfc`. Every rule
//!   lives inside the SFC's shadow root (the compiler folds the output into the
//!   component's `<style>`), so there is NO global utility stylesheet. Class
//!   selectors inside a shadow `<style>` only match that shadow tree — that IS
//!   the scoping mechanism (per spec §6.3). We also fold the authored `@style`
//!   block (scoped folded in; `$global` passed through) and the theme tokens.
//!
//! Variant resolution (Tasks 5/6) happens here: each scanned token is split via
//! `variants::split_variants`, the base utility is compiled via `tokens`, then
//! the variants wrap/append to the selector. Dark-mode variants (`dark:`,
//! `host-context-dark:`) emit a custom-property cascade — NEVER
//! `:host-context()` (Firefox workaround, `decision-firefox-host-context-workaround`).

use crate::ast::{SfcAst, SfcStyleScope};
use crate::progressive::ProgressiveRegistry;
use crate::scanner::{scan, ScanResult};
use crate::theme::{extract_theme_blocks, ThemeRegistry};
use crate::tokens::{animation_keyframes, utility_to_css};
use crate::variants::{split_variants, AttrMatch, Variant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputMode {
    Flat,
    Scoped,
}

/// A recoverable error raised while emitting CSS from an SFC AST.
///
/// This is the precursor error channel (R-RESULT): `emit_sfc_scoped` /
/// `compile_sfc_scoped` / the per-SFC cache return `Result<String, CompileError>`
/// so later passes (`@apply` unknown-utility, variant validation) can hard-error
/// instead of silently dropping. The `aihu-css-compile` binary prints the
/// `Display` message to stderr and exits non-zero; the TS bridge surfaces it as
/// a thrown `Error` carrying that message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CompileError {
    /// An authored `@style` block opened `@theme` with no `{ … }` body.
    MalformedTheme { detail: String },
    /// An `@apply` directive referenced a utility token whose base utility is
    /// not in the table (Task 1.4 — unknown utility hard-errors).
    UnknownApplyUtility { token: String },
    /// An `@apply` inside a `$global` `@style` block used a variant token that
    /// implies `&`/host/relational scoping (Task 1.4 — base utilities allowed in
    /// `$global`, scope-implying variants rejected).
    GlobalApplyVariant { token: String },
    /// A `@style` block failed to parse structurally (R-SHARED-PARSER).
    StyleParse { detail: String },
}

impl std::fmt::Display for CompileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CompileError::MalformedTheme { detail } => {
                write!(f, "malformed @theme block in authored @style: {detail}")
            }
            CompileError::UnknownApplyUtility { token } => {
                write!(f, "unknown utility in @apply: `{token}`")
            }
            CompileError::GlobalApplyVariant { token } => {
                write!(
                    f,
                    "@apply in a $global @style block may not use the scope-implying \
                     variant `{token}` (only base utilities are allowed in $global)"
                )
            }
            CompileError::StyleParse { detail } => {
                write!(f, "failed to parse @style block: {detail}")
            }
        }
    }
}

impl std::error::Error for CompileError {}

/// CSS-escape a class name for use in a selector (`bg-[#fff]` → `bg-\[\#fff\]`).
pub(crate) fn escape_class(class: &str) -> String {
    let mut out = String::with_capacity(class.len() + 4);
    for c in class.chars() {
        if matches!(
            c,
            '[' | ']' | '#' | '(' | ')' | '.' | '%' | '/' | ':' | ',' | '@' | '=' | '"'
        ) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// If `token`'s leading prefix names a registered progressive feature, return
/// its `(prefix, base)` split. `view-transition:slide` → `("view-transition",
/// "slide")`; `text-balance:` → `("text-balance", "")`.
fn progressive_split<'a>(token: &'a str, prog: &ProgressiveRegistry) -> Option<(&'a str, &'a str)> {
    let colon = token.find(':')?;
    let prefix = &token[..colon];
    if prog.is_feature(prefix) {
        Some((prefix, &token[colon + 1..]))
    } else {
        None
    }
}

/// Compile a single scanned token (which may carry variant prefixes) into a CSS
/// rule string, or `None` if the base utility is unknown.
///
/// Progressive-feature prefixes (`view-transition:`, `anchor:`, `popover:`,
/// `text-balance:`) are routed to the [`ProgressiveRegistry`] emitter (Plan 3
/// Task 4) instead of the standard selector path.
fn emit_token(token: &str, theme: &ThemeRegistry, prog: &ProgressiveRegistry) -> Option<String> {
    if let Some((prefix, base)) = progressive_split(token, prog) {
        return prog.emit(prefix, base);
    }

    let (variants, base) = split_variants(token);
    let body = utility_to_css(&base)?;
    let class_sel = format!(".{}", escape_class(token));

    // The base (innermost) selector and declaration body.
    let mut selector = class_sel;
    // Wrapping at-rule condition(s). `@media` producers (breakpoint, motion)
    // accumulate into `media_conditions` and get merged with `and` — a token
    // combining two of them (`md:motion-safe:animate-fade-in`) must keep BOTH
    // conditions, not silently drop whichever variant the loop below visits
    // last (the bug this replaced: a single `Option<String>` overwritten by
    // each `@media`-producing arm). `@container` stays its own slot — merging
    // a container condition into the same at-rule as a media condition isn't
    // valid CSS (they're different at-rule kinds); two container variants
    // stacking remains last-wins, same as before this change (not reachable
    // today — there's only one container-producing variant).
    let mut media_conditions: Vec<String> = Vec::new();
    let mut container_at_rule: Option<String> = None;
    let mut dark_cascade = false;

    for v in &variants {
        match v {
            Variant::Host => selector = format!(":host({selector})"),
            Variant::Slotted => selector = format!("::slotted({selector})"),
            Variant::SlottedTag(tag) => selector = format!("::slotted({tag}{selector})"),
            Variant::Part(name) => selector = format!("::part({name})"),
            Variant::Pseudo(pc) => selector = format!("{selector}:{pc}"),
            Variant::PseudoElement(pe) => selector = format!("{selector}::{pe}"),
            Variant::ArbitrarySelector(sel) => {
                // `[&>div]:` → substitute `&` for the base selector.
                selector = sel.replace('&', &selector);
            }
            Variant::Group(Some(state)) => {
                // `group-hover:bg-x` → `.group:hover .group-hover\:bg-x`.
                // Prepend a descendant-combinator ancestor selector: the rule
                // applies to the element bearing this class when an ancestor
                // marked `class="group"` is in `:<state>`. Within a shadow root
                // both the marker and the styled element live in the same tree,
                // so the class selectors match per spec §6.3 scoping.
                selector = format!(".group:{state} {selector}");
            }
            Variant::Peer(Some(state)) => {
                // `peer-checked:bg-x` → `.peer:checked ~ .peer-checked\:bg-x`.
                // Prepend a subsequent-sibling-combinator selector: the rule
                // applies when a PRIOR sibling marked `class="peer"` is in
                // `:<state>`. CSS can only look backward to earlier siblings,
                // so `peer` must appear before the styled element in source.
                selector = format!(".peer:{state} ~ {selector}");
            }
            // Bare `group`/`peer` never reach here (they are marker utilities,
            // not variant prefixes); a `None` state is unreachable but handled
            // defensively as a no-op so the base selector is emitted unchanged.
            Variant::Group(None) | Variant::Peer(None) => {}
            // aria-*/data-* attribute variants compile to an attribute selector
            // appended to the base: `aria-checked:` → `.cls[aria-checked="true"]`,
            // `data-[state=open]:` → `.cls[data-state="open"]`. A keyword data-*
            // (`data-active:`) emits a presence selector `[data-active]`.
            Variant::Aria(m) => selector = format!("{selector}{}", attr_selector("aria", m)),
            Variant::Data(m) => selector = format!("{selector}{}", attr_selector("data", m)),
            Variant::Breakpoint(bp) => {
                if let Some(min) = theme.breakpoint(bp) {
                    media_conditions.push(format!("(min-width: {min})"));
                }
            }
            // Container queries wrap the rule in an `@container` at-rule keyed on
            // the container breakpoint scale (mirrors `breakpoint()`).
            Variant::Container(bp) => {
                if let Some(min) = theme.container_breakpoint(bp) {
                    container_at_rule = Some(format!("@container (min-width: {min})"));
                }
            }
            Variant::Dark | Variant::HostContextDark => {
                dark_cascade = true;
            }
            Variant::Motion { reduce } => {
                media_conditions.push(format!(
                    "(prefers-reduced-motion: {})",
                    if *reduce { "reduce" } else { "no-preference" }
                ));
            }
        }
    }

    let rule = if dark_cascade {
        // Firefox-safe dark cascade: gate the rule on the consumer's dark flag
        // (a `data-theme="dark"` host attr, a `.dark` root class, or
        // `data-theme="dark"` on `:root` itself — D4 §4's dual-keyed
        // convention, `DARK_SELECTOR` in `define-style-pack.ts`) rather than
        // the host-context pseudo (unsupported in Firefox). Without the third
        // `:root[data-theme="dark"]` branch, an app that opts into the
        // shipped packs' OWN documented convention (`data-theme="dark"` on
        // `<html>`, no `.dark` class) would see its pack tokens correctly
        // flip but every `dark:` utility/`@apply dark:` variant silently stay
        // on its light value — the two dark-mode mechanisms would disagree.
        format!(
            "/* dark cascade (Firefox-safe; see decision-firefox-host-context-workaround) */\n\
             :host([data-theme=\"dark\"]) {selector}, \
             :root.dark {selector}, \
             :root[data-theme=\"dark\"] {selector} {{ {body} }}\n"
        )
    } else {
        format!("{selector} {{ {body} }}\n")
    };

    // Wrap innermost-first: @media (breakpoint/motion conditions merged with
    // `and`) then @container around that — nesting order between the two
    // kinds is semantically irrelevant (independent conditions), but must be
    // applied consistently.
    let rule = if media_conditions.is_empty() {
        rule
    } else {
        format!("@media {} {{\n{rule}}}\n", media_conditions.join(" and "))
    };
    let rule = match container_at_rule {
        Some(at) => format!("{at} {{\n{rule}}}\n"),
        None => rule,
    };

    // Hoist the @keyframes an `animate-*` utility depends on as a top-level
    // sibling rule (it cannot live nested inside the selector body). Re-emitting
    // an identical block is idempotent in CSS, so per-occurrence emission is
    // safe. `base` is the variant-stripped class (e.g. `animate-spin`).
    Some(match animation_keyframes(&base) {
        Some(kf) => format!("{rule}{kf}\n"),
        None => rule,
    })
}

/// Build an attribute-selector fragment for an `aria-*`/`data-*` variant.
///
/// `attr_selector("aria", Name{checked, true})` → `[aria-checked="true"]`;
/// `attr_selector("data", NameValue{state, open})` → `[data-state="open"]`;
/// `attr_selector("data", Name{active, false})` → `[data-active]` (presence).
pub(crate) fn attr_selector(family: &str, m: &AttrMatch) -> String {
    match m {
        AttrMatch::Name { name, imply_true } => {
            if *imply_true {
                format!("[{family}-{name}=\"true\"]")
            } else {
                format!("[{family}-{name}]")
            }
        }
        AttrMatch::NameValue { name, value } => {
            format!("[{family}-{name}=\"{value}\"]")
        }
    }
}

/// Emit CSS for a scanned utility set in the given mode.
pub fn emit(result: &ScanResult, theme: &ThemeRegistry, mode: OutputMode) -> String {
    emit_with_progressive(result, theme, &ProgressiveRegistry::with_builtins(), mode)
}

/// As [`emit`], but with an explicit [`ProgressiveRegistry`] (so callers can
/// share one registry across an SFC compile).
pub fn emit_with_progressive(
    result: &ScanResult,
    theme: &ThemeRegistry,
    prog: &ProgressiveRegistry,
    mode: OutputMode,
) -> String {
    let mut out = String::new();
    for token in &result.utilities {
        match mode {
            OutputMode::Flat => {
                // Flat back-compat: only plain utilities, no variant wrapping.
                if let Some(body) = utility_to_css(token) {
                    out.push_str(&format!(".{token} {{ {body} }}\n"));
                    if let Some(kf) = animation_keyframes(token) {
                        out.push_str(kf);
                        out.push('\n');
                    }
                }
            }
            OutputMode::Scoped => {
                if let Some(rule) = emit_token(token, theme, prog) {
                    out.push_str(&rule);
                }
            }
        }
    }
    if matches!(mode, OutputMode::Scoped) {
        // Reduced-motion safety net for the ported animation catalog
        // (tailwind-animations port doc §2, decision D-B·a) — every ported
        // animation actually used in this sheet is accessible by default,
        // with no author action required.
        let guard = crate::animations::reduced_motion_guard(&result.utilities);
        if !guard.is_empty() {
            out.push_str(&guard);
        }
    }
    out
}

/// The canonical `@layer` order, published as public API (LDF §4 / §11 Q5,
/// resolved in D4's favor): `aihu.components` sits below `aihu.utilities` in
/// the cascade, so a future `class="btn p-8"` resolves `padding` from the
/// utility, not the recipe (D4 §8 Slice 4 depends on this exact ordering).
///
/// Reset/tokens/utilities rules stay unlayered, which in the CSS cascade
/// always outranks ANY layered rule regardless of declaration order (spec:
/// unlayered beats layered, always). `aihu.components` is the one layer with
/// real content — the recipe channel (D4 Slice 4, [`crate::recipes`]) — so
/// `class="btn p-8"` resolves `padding` from the unlayered utility rule, not
/// the layered recipe rule, regardless of which one this preamble's `@layer`
/// statement or the emitted CSS lists first. Safe to repeat verbatim across
/// every component/shadow-root — identical `@layer` statement lists don't
/// reorder or conflict with each other.
pub const LAYER_PREAMBLE: &str = "@layer aihu.reset, aihu.tokens, aihu.components, aihu.utilities;\n";

/// The six independently-emittable channels of an SFC's compiled CSS
/// (light-DOM leaf flip prep, LDF §10 step 1-2 / D4 §8 Slice 2 and Slice 4).
/// Splitting these out lets later passes — mode-aware token emission (LDF
/// §10 step 2), the light-DOM selector-rewrite pass (LDF §10 step 3), the
/// recipe channel (D4 Slice 4) — operate on the right channel directly
/// instead of re-parsing a concatenated string.
///
/// [`ScopedCssChannels::concat`] reproduces today's single-string
/// concatenation order (plus the new leading `layer_preamble`, LDF §10
/// step 2) — the four pre-existing channels change no emitted CSS by
/// themselves.
#[derive(Debug, Clone, Default)]
pub struct ScopedCssChannels {
    /// The `@layer` order declaration — see [`LAYER_PREAMBLE`].
    pub layer_preamble: String,
    /// `:host`/`:root` theme custom-property block.
    pub tokens: String,
    /// The one-time preflight border reset.
    pub reset: String,
    /// The daisyUI-style recipe channel (D4 §6, Slice 4) — tree-shaken
    /// `.btn`/`.card`/`.badge`-style rules the scanned utility set actually
    /// references, wrapped in `@layer aihu.components`. See
    /// [`crate::recipes::compile_recipes`].
    pub components: String,
    /// Scanned utility-class rules (variant-resolved).
    pub utilities: String,
    /// The folded authored `@style` block (scoped + `$global`).
    pub authored: String,
}

impl ScopedCssChannels {
    /// Concatenate in emission order: layer preamble, tokens, reset,
    /// components, utilities, authored.
    pub fn concat(&self) -> String {
        let mut out = String::with_capacity(
            self.layer_preamble.len()
                + self.tokens.len()
                + self.reset.len()
                + self.components.len()
                + self.utilities.len()
                + self.authored.len(),
        );
        out.push_str(&self.layer_preamble);
        out.push_str(&self.tokens);
        out.push_str(&self.reset);
        out.push_str(&self.components);
        out.push_str(&self.utilities);
        out.push_str(&self.authored);
        out
    }
}

/// Compile a full SFC AST to its four CSS channels: theme tokens
/// (`:host`-level custom props), the preflight reset, scanned utility rules,
/// and the folded authored `@style` block.
///
/// `ast.light_scope_id` currently only selects the token channel's `:host`
/// vs. `:root` selector (LDF §10 step 2). Selector-level scoping of the
/// reset/utilities/authored channels themselves is the light-DOM
/// selector-rewrite pass's job (LDF §10 step 3) — not yet wired in here.
pub fn emit_sfc_scoped_channels(ast: &SfcAst) -> Result<ScopedCssChannels, CompileError> {
    let mut theme = ThemeRegistry::with_aihu_defaults();

    // Parse @theme directives from the authored style block first so utilities
    // and breakpoints see overrides.
    if let Some(style) = &ast.style {
        let theme_bodies = extract_theme_blocks(&style.content);
        if !theme_bodies.is_empty() {
            theme.apply_theme_block(&theme_bodies);
        }
    }

    let result = scan(ast);
    let prog = ProgressiveRegistry::with_builtins();

    // Preflight border reset (Tailwind v4 parity). Browsers default
    // `border-style: none`, so a bare `.border { border-width: 1px }` paints
    // nothing. Emit a single one-time rule so every border utility renders a
    // visible solid line. This is one rule per sheet (not per token), so the
    // size impact is negligible; the matching utility wins by specificity.
    let reset = "*, ::before, ::after { border-style: solid; border-width: 0; }\n".to_string();

    // Scanned utility rules (scoped) — progressive prefixes routed via `prog`.
    let utilities = emit_with_progressive(&result, &theme, &prog, OutputMode::Scoped);

    // Recipe channel (D4 §6, Slice 4) — tree-shaken against the same scanned
    // utility set (a recipe class like `btn` is scanned exactly like any
    // other class, per `scanner.rs`; `compile_recipes` just resolves it
    // against `recipes/*.css` instead of the Tailwind utility table).
    let components = crate::recipes::compile_recipes(&result.utilities, &theme)?;

    // Fold the authored @style block (minus @theme directives), expanding any
    // `@apply` directives first (Task 1.4). Base utilities inline as
    // declarations; variant tokens lift to nested `&…` rules on the recipe's
    // own selector. Unknown utilities / illegal `$global` variants hard-error.
    let mut authored = String::new();
    if let Some(style) = &ast.style {
        let stripped = strip_theme_blocks(&style.content)?;
        if !stripped.trim().is_empty() {
            // Always go through the AST (never the plain-string
            // `expand_apply`), on EVERY path — the `@keyframes $global name`
            // escape hatch (`light_scope::strip_global_keyframe_markers`)
            // must run regardless of mode/scope, or the marker survives as
            // literal (invalid) CSS text and the browser drops the whole
            // at-rule. Only `SfcStyleScope::Scoped` + light mode gets the
            // FULL rewrite (`:host`/`::slotted`/`::part`/`@scope` lowering,
            // which also handles its own keyframe stripping+renaming); every
            // other combination just strips the marker and renders as-is.
            let mut sheet = crate::apply::expand_apply_sheet(&stripped, style.scope, &theme)?;
            match style.scope {
                // Scoped: it already lives in the shadow <style>; pass through
                // (shadow mode) — or, in light mode, run the light-DOM
                // selector-rewrite pass (LDF §10 step 3) before folding, since
                // `:host`/`::slotted`/`::part`/plain-class isolation only work
                // inside a real shadow tree.
                SfcStyleScope::Scoped => {
                    let expanded = match &ast.light_scope_id {
                        Some(id) => crate::light_scope::scope_authored_sheet(
                            sheet,
                            crate::light_scope::ScopeId(id),
                        ),
                        None => {
                            crate::light_scope::strip_global_keyframe_markers(&mut sheet);
                            sheet.to_css()
                        }
                    };
                    let expanded = expanded.trim();
                    if !expanded.is_empty() {
                        authored.push_str("/* authored @style (scoped) */\n");
                        authored.push_str(expanded);
                        authored.push('\n');
                    }
                }
                // Global ($global): passed through unscoped (edge E6) in
                // EITHER mode — it already opts out of scoping, so the
                // light-DOM rewrite pass has nothing to do here. The compiler
                // hoists this out of the shadow root.
                SfcStyleScope::Global => {
                    crate::light_scope::strip_global_keyframe_markers(&mut sheet);
                    let expanded = sheet.to_css();
                    let expanded = expanded.trim();
                    if !expanded.is_empty() {
                        authored.push_str("/* authored @style ($global — unscoped) */\n");
                        authored.push_str(expanded);
                        authored.push('\n');
                    }
                }
            }
        }
    }

    // Register the palette tokens the reset+components+utilities+authored
    // channels reference (Tailwind ships the full palette in its default
    // theme) so `var(--color-amber-200)` resolves at `:host`/`:root`. Only
    // the referenced tokens are added — not all 286. `components` is
    // included here too: a recipe rule pulled in by this SFC (e.g.
    // `.badge-info` referencing `var(--color-info)`) must make that token
    // tree-shake IN for this component even if nothing else in its own body
    // references it.
    let mut referenced =
        String::with_capacity(reset.len() + components.len() + utilities.len() + authored.len());
    referenced.push_str(&reset);
    referenced.push_str(&components);
    referenced.push_str(&utilities);
    referenced.push_str(&authored);
    crate::tokens::register_used_palette(&referenced, &mut theme);

    // Only tokens this SFC's own `@theme` declares are emitted as
    // declarations, scoped to :host (shadow) or :root (light) per whether the
    // compiler resolved this SFC to light-DOM mode (LDF §10 step 2 — a
    // light-DOM host has no shadow root, so `:host {}` would match nothing).
    // Engine defaults (brand tokens, used palette) become `var()` fallbacks
    // below instead (#836): a `:host` declaration of a default would override
    // the app theme the component inherits from the document.
    let token_scope = if ast.light_scope_id.is_some() {
        crate::theme::TokenScope::Light
    } else {
        crate::theme::TokenScope::Shadow
    };
    let tokens = theme.emit_declared_tokens(&referenced, token_scope);
    let tokens = theme.with_default_fallbacks(&tokens);
    let components = theme.with_default_fallbacks(&components);
    let utilities = theme.with_default_fallbacks(&utilities);
    let authored = theme.with_default_fallbacks(&authored);
    // Light mode's `:root` token block competes in the SAME global cascade as
    // every app-authored `:root {}`/`.dark {}` rule (both are unlayered,
    // (0,1,0) specificity — the winner would otherwise come down to
    // stylesheet SOURCE ORDER, which is fragile and can silently flip which
    // value wins e.g. across a dark-mode toggle). Wrap in the `aihu.tokens`
    // layer (already declared in `LAYER_PREAMBLE`) so any unlayered
    // app-authored token declaration unconditionally wins regardless of
    // order. Shadow mode's `:host {}` has no such collision — it only ever
    // affects that one shadow tree — so it stays unlayered/unwrapped.
    let tokens = if matches!(token_scope, crate::theme::TokenScope::Light) && !tokens.is_empty() {
        format!("@layer aihu.tokens {{\n{tokens}}}\n")
    } else {
        tokens
    };

    Ok(ScopedCssChannels {
        layer_preamble: LAYER_PREAMBLE.to_string(),
        tokens,
        reset,
        components,
        utilities,
        authored,
    })
}

/// Compile a full SFC AST to scoped CSS: theme tokens (`:host`-level custom
/// props) + scanned utility rules + the folded authored `@style` block.
///
/// Thin wrapper over [`emit_sfc_scoped_channels`] that concatenates the four
/// channels in today's order — kept for existing callers that want one
/// string.
pub fn emit_sfc_scoped(ast: &SfcAst) -> Result<String, CompileError> {
    emit_sfc_scoped_channels(ast).map(|c| c.concat())
}

/// Remove `@theme { ... }` blocks from style content (they become host tokens,
/// not raw CSS).
///
/// An `@theme` opener with no `{ … }` body is a malformed authored block and
/// now hard-errors via [`CompileError`] (R-RESULT) instead of silently keeping
/// the broken text verbatim — the first real error this `Result` channel
/// surfaces. Later passes (`@apply`, variant validation) add more variants.
fn strip_theme_blocks(style_content: &str) -> Result<String, CompileError> {
    let mut out = String::new();
    let mut rest = style_content;
    while let Some(at) = rest.find("@theme") {
        out.push_str(&rest[..at]);
        let after = &rest[at + "@theme".len()..];
        let Some(open) = after.find('{') else {
            // Malformed: `@theme` with no `{` body. Hard-error rather than
            // emitting the broken text verbatim.
            return Err(CompileError::MalformedTheme {
                detail: "expected `{` after `@theme`".to_string(),
            });
        };
        let body_start = open + 1;
        let mut depth = 1u32;
        let mut end = body_start;
        for (i, c) in after[body_start..].char_indices() {
            match c {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = body_start + i;
                        break;
                    }
                }
                _ => {}
            }
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}
