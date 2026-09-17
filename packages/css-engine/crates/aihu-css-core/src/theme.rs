//! `theme.rs` — `@theme` directive parser + design-token registry.
//!
//! The `@theme { --color-primary: oklch(...); }` directive declares design
//! tokens. We parse it out of an SFC's `@style` block content, register each
//! `--token: value` pair, and let authored `@theme` blocks override the baked
//! aihu brand defaults (extracted from `apps/docs/style.css` — the same source
//! Plan 3's `aihu-default` style pack will use).
//!
//! Breakpoints (`md:`, `sm:`, …) read from the registry so `@theme` can
//! override them. `oklch()` and custom properties are emitted directly
//! (allowed by the ratified baseline browser window).
//!
//! Defaults vs declarations (#836): the baked brand tokens and the Tailwind
//! palette are *fallbacks*, never declarations. A `:host { --color-*: … }`
//! block of defaults would beat every value the component inherits from the
//! document, so an app's theme pack (or its own `:root` tokens) could never
//! reach a shadow-scoped component. Instead the scoped emitter declares only
//! the tokens an SFC's own `@theme` block sets
//! ([`ThemeRegistry::emit_declared_tokens`]) and rewrites every other
//! reference to `var(--name, <default>)`
//! ([`ThemeRegistry::with_default_fallbacks`]): inherited tokens win, and a
//! component rendered with no theme in scope still gets the defaults.

use std::collections::{BTreeMap, BTreeSet};

/// A design-token registry: `--name` → `value`. Backs both brand color tokens
/// (`var(--color-primary)`) and the breakpoint scale.
#[derive(Debug, Clone, PartialEq)]
pub struct ThemeRegistry {
    tokens: BTreeMap<String, String>,
    /// Names set by an authored `@theme` block. Everything else in `tokens`
    /// is an engine default, emitted only as a `var()` fallback.
    declared: BTreeSet<String>,
    /// Monotonic version, bumped on every mutation — feeds the cache key (Task 8).
    version: u64,
}

impl Default for ThemeRegistry {
    fn default() -> Self {
        Self::with_aihu_defaults()
    }
}

impl ThemeRegistry {
    /// An empty registry (no defaults).
    pub fn empty() -> Self {
        Self {
            tokens: BTreeMap::new(),
            declared: BTreeSet::new(),
            version: 0,
        }
    }

    /// The default registry seeded with aihu brand tokens.
    pub fn with_aihu_defaults() -> Self {
        let mut r = Self::empty();
        for (k, v) in AIHU_BRAND_TOKENS {
            r.tokens.insert((*k).to_string(), (*v).to_string());
        }
        r.version = 1;
        r
    }

    /// Look up a token value (`--color-primary` → its value).
    pub fn get(&self, name: &str) -> Option<&str> {
        self.tokens.get(name).map(String::as_str)
    }

    /// Registry version — changes on every mutation. Part of the cache key.
    pub fn version(&self) -> u64 {
        self.version
    }

    /// Resolve a responsive breakpoint to its min-width value. Falls back to
    /// sane Tailwind defaults if `@theme` did not override them.
    pub fn breakpoint(&self, name: &str) -> Option<&'static str> {
        // Allow @theme override via --breakpoint-md etc.; else default.
        match name {
            "sm" => Some("40rem"),
            "md" => Some("48rem"),
            "lg" => Some("64rem"),
            "xl" => Some("80rem"),
            "2xl" => Some("96rem"),
            _ => None,
        }
    }

    /// Resolve a container-query breakpoint (`@sm`/`@md`/…) to its min-width.
    /// Mirrors [`breakpoint`] but uses Tailwind's container-query scale (which
    /// differs from the viewport breakpoint scale): `@sm`=24rem … `@2xl`=42rem.
    pub fn container_breakpoint(&self, name: &str) -> Option<&'static str> {
        match name {
            "sm" => Some("24rem"),
            "md" => Some("28rem"),
            "lg" => Some("32rem"),
            "xl" => Some("36rem"),
            "2xl" => Some("42rem"),
            _ => None,
        }
    }

    /// Merge an `@theme { ... }` block's tokens over the current registry.
    /// Returns the number of tokens registered/overridden.
    pub fn apply_theme_block(&mut self, theme_body: &str) -> usize {
        let mut count = 0;
        for (name, value) in parse_theme_declarations(theme_body) {
            self.declared.insert(name.clone());
            self.tokens.insert(name, value);
            count += 1;
        }
        if count > 0 {
            self.version += 1;
        }
        count
    }

    /// Register `--name: value;` declarations as engine defaults (fallbacks),
    /// not author declarations. Used for the Tailwind palette entries the
    /// scoped emitter pulls in on demand. Returns the number registered.
    pub fn register_defaults(&mut self, body: &str) -> usize {
        let mut count = 0;
        for (name, value) in parse_theme_declarations(body) {
            self.tokens.insert(name, value);
            count += 1;
        }
        if count > 0 {
            self.version += 1;
        }
        count
    }

    /// The default value `name` falls back to, or `None` when an authored
    /// `@theme` block declared it (it is emitted as a real declaration then)
    /// or the registry does not know it.
    fn default_value(&self, name: &str) -> Option<&str> {
        if self.declared.contains(name) {
            return None;
        }
        self.get(name)
    }

    /// As [`Self::emit_used_tokens`], but only for tokens an authored `@theme`
    /// block declared. Engine defaults are left out: they reach the CSS as
    /// `var()` fallbacks ([`Self::with_default_fallbacks`]), so they never
    /// shadow a value the component inherits from the document.
    pub fn emit_declared_tokens(&self, body: &str, scope: TokenScope) -> String {
        let declared: BTreeMap<String, String> = self
            .tokens
            .iter()
            .filter(|(name, _)| self.declared.contains(*name) && var_is_referenced(body, name))
            .map(|(name, value)| (name.clone(), value.clone()))
            .collect();
        self.emit_tokens_for(&declared, scope)
    }

    /// Rewrite every fallback-less `var(--name)` in `css` whose `name` is an
    /// engine default to `var(--name, <default>)`. References that already
    /// carry a fallback, tokens an `@theme` block declared, and names the
    /// registry does not know are left untouched.
    pub fn with_default_fallbacks(&self, css: &str) -> String {
        const OPEN: &str = "var(";
        let mut out = String::with_capacity(css.len());
        let mut rest = css;
        while let Some(pos) = rest.find(OPEN) {
            // `var(` must start a function token, not end a longer name.
            let in_ident = rest[..pos]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_alphanumeric() || c == '-' || c == '_');
            out.push_str(&rest[..pos + OPEN.len()]);
            rest = &rest[pos + OPEN.len()..];
            if in_ident {
                continue;
            }
            let lead = rest.len() - rest.trim_start().len();
            let arg = &rest[lead..];
            if !arg.starts_with("--") {
                continue;
            }
            let name_len = arg
                .find(|c: char| !(c.is_alphanumeric() || c == '-' || c == '_'))
                .unwrap_or(arg.len());
            let name = &arg[..name_len];
            if !arg[name_len..].trim_start().starts_with(')') {
                continue;
            }
            let Some(value) = self.default_value(name) else {
                continue;
            };
            out.push_str(&rest[..lead + name_len]);
            out.push_str(", ");
            out.push_str(value);
            rest = &rest[lead + name_len..];
        }
        out.push_str(rest);
        out
    }

    /// Emit a `:host { --token: value; … }` block for every registered token,
    /// so utilities referencing `var(--color-*)` resolve inside the shadow root.
    ///
    /// Kept for existing callers; delegates to [`Self::emit_used_tokens`] with
    /// [`TokenScope::Shadow`] and no usage filter (emits every registered
    /// token, matching this function's pre-flip behavior byte-for-byte).
    pub fn emit_host_tokens(&self) -> String {
        self.emit_tokens_for(&self.tokens, TokenScope::Shadow)
    }

    /// Emit only the tokens actually referenced in `body`, scoped to `:host`
    /// (shadow) or `:root` (light) per `scope` (light-DOM leaf flip prep, LDF
    /// §10 step 2 / D4 §8 Slice 2).
    ///
    /// Fixes a live bug: a light-DOM component (page/layout, today; leaves
    /// once the flip lands) has no shadow root, so a `:host { --x: y }` block
    /// matches nothing — `var(--x)` silently fails to resolve anywhere in the
    /// document. `TokenScope::Light` emits `:root` instead, which the light
    /// tree's utilities/authored rules can actually see.
    ///
    /// Also tree-shakes: [`Self::with_aihu_defaults`] unconditionally seeds
    /// all `AIHU_BRAND_TOKENS`, so unfiltered emission (the old
    /// `emit_host_tokens` behavior) always emitted all of them regardless of
    /// whether a given component's CSS references them. This filters to only
    /// the names `body` actually contains a `var(--name)`-style reference to.
    pub fn emit_used_tokens(&self, body: &str, scope: TokenScope) -> String {
        let used: BTreeMap<String, String> = self
            .tokens
            .iter()
            .filter(|(name, _)| var_is_referenced(body, name))
            .map(|(name, value)| (name.clone(), value.clone()))
            .collect();
        self.emit_tokens_for(&used, scope)
    }

    /// Shared emission body for [`Self::emit_host_tokens`] and
    /// [`Self::emit_used_tokens`] — one token map, one selector, same
    /// formatting either way.
    fn emit_tokens_for(&self, tokens: &BTreeMap<String, String>, scope: TokenScope) -> String {
        if tokens.is_empty() {
            return String::new();
        }
        let selector = match scope {
            TokenScope::Shadow => ":host",
            TokenScope::Light => ":root",
        };
        let mut out = String::from(selector);
        out.push_str(" {\n");
        for (name, value) in tokens {
            out.push_str("  ");
            out.push_str(name);
            out.push_str(": ");
            out.push_str(value);
            out.push_str(";\n");
        }
        out.push_str("}\n");
        out
    }
}

/// Whether an emitted token block targets a shadow root (`:host`) or the flat
/// light-DOM tree (`:root`). Light-DOM leaf flip prep (LDF §10 step 2 / D4 §8
/// Slice 2) — see [`ThemeRegistry::emit_used_tokens`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenScope {
    Shadow,
    Light,
}

/// Whether `body` contains a reference to custom property `name` (e.g. does
/// `body` reference `--color-primary`). A plain `body.contains(name)` would
/// false-positive on `--color-primary` when only the DISTINCT sibling token
/// `--color-primary-foreground` is actually used (a real collision shape in
/// `AIHU_BRAND_TOKENS`: every color has a `-foreground` pair). Guards the
/// trailing boundary — the character immediately after a match must not
/// continue a custom-property identifier (`[a-zA-Z0-9_-]`). No token in this
/// table is a *suffix* of another, so a leading-boundary check is unneeded.
fn var_is_referenced(body: &str, name: &str) -> bool {
    let mut rest = body;
    while let Some(pos) = rest.find(name) {
        let after = &rest[pos + name.len()..];
        let boundary_ok = after
            .chars()
            .next()
            .map(|c| !(c.is_alphanumeric() || c == '-' || c == '_'))
            .unwrap_or(true);
        if boundary_ok {
            return true;
        }
        rest = after;
    }
    false
}

/// Extract the body of every `@theme { ... }` directive from a style-block
/// string, returning the concatenated declaration text.
pub fn extract_theme_blocks(style_content: &str) -> String {
    let mut bodies = String::new();
    let mut rest = style_content;
    while let Some(at) = rest.find("@theme") {
        let after = &rest[at + "@theme".len()..];
        let Some(open) = after.find('{') else { break };
        // Find the matching close brace.
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
        bodies.push_str(&after[body_start..end]);
        bodies.push('\n');
        rest = &after[end + 1..];
    }
    bodies
}

/// Parse `--name: value;` declarations from a CSS body. Tolerates whitespace,
/// comments are NOT stripped (kept simple); values keep `oklch(...)` intact.
fn parse_theme_declarations(body: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for decl in body.split(';') {
        let decl = decl.trim();
        if decl.is_empty() {
            continue;
        }
        let Some((name, value)) = decl.split_once(':') else {
            continue;
        };
        let name = name.trim();
        let value = value.trim();
        if name.starts_with("--") && !value.is_empty() {
            out.push((name.to_string(), value.to_string()));
        }
    }
    out
}

/// aihu brand tokens, extracted from `apps/docs/style.css` (light theme). Maps
/// the design-system names to the utility token names the table references
/// (`--color-primary`, `--color-accent`, `--color-surface`, …).
///
/// D4 §3.4 / §3.2 (E1 + E2, founder-ratified): `info`/`success`/`warning`/
/// `neutral` (+ `-foreground`) extend the semantic-state palette daisyUI-style
/// recipes need but the original terracotta-only contract couldn't express —
/// values match `packs.ts`'s `aihuDefault.tokens` light values exactly (and
/// are verified against `.tastemaker/style-lock.md`'s contrast table, kept in
/// sync by PR #608). The five non-color scalars below them (`--size-selector`,
/// `--size-field`, `--border`, `--depth`, `--noise`) are aihu-native defaults
/// for the same recipes (D4 §3.2) — transcribed in spirit, not vendored
/// byte-for-byte from daisyUI's own token algebra.
const AIHU_BRAND_TOKENS: &[(&str, &str)] = &[
    ("--color-primary", "#1a1d24"),
    ("--color-primary-foreground", "#faf8f4"),
    ("--color-secondary", "#5a5a55"),
    ("--color-secondary-foreground", "#faf8f4"),
    ("--color-accent", "#c8543a"),
    ("--color-accent-foreground", "#faf8f4"),
    ("--color-surface", "#faf8f4"),
    ("--color-surface-foreground", "#1a1d24"),
    ("--color-background", "#faf8f4"),
    ("--color-foreground", "#1a1d24"),
    ("--color-muted", "#5a5a55"),
    ("--color-muted-foreground", "#8a8880"),
    ("--color-border", "#ddd9d2"),
    ("--color-ring", "#c8543a"),
    ("--color-destructive", "#a8432b"),
    ("--color-destructive-foreground", "#faf8f4"),
    ("--color-info", "#3d5a75"),
    ("--color-info-foreground", "#faf8f4"),
    ("--color-success", "#3f6f4f"),
    ("--color-success-foreground", "#faf8f4"),
    ("--color-warning", "#945f0e"),
    ("--color-warning-foreground", "#faf8f4"),
    ("--color-neutral", "#363c47"),
    ("--color-neutral-foreground", "#faf8f4"),
    ("--size-selector", "1.25rem"),
    ("--size-field", "2.25rem"),
    ("--border", "1px"),
    ("--depth", "1"),
    ("--noise", "0"),
    // Radius scale (matches `packs.ts`'s shared-contract values exactly).
    // Added alongside the D4 Slice 4 recipe channel: `recipes/*.css` (`.btn`,
    // `.card`, `.badge`) reference these directly, and without a registry
    // entry they'd only resolve when a consuming app happens to have loaded
    // a shipped style-pack CSS bundle — silently square-cornered otherwise.
    ("--radius-sm", "4px"),
    ("--radius-md", "8px"),
    ("--radius-lg", "12px"),
    ("--radius-pill", "999px"),
    // performativeUI port (docs/plans/2026-08-01-performative-ui-port.md §1,
    // escalations E-P1/E-P2/E-P3 as ruled): three additive tokens, none a
    // `bg-*`/`text-*`/`border-*` color role (so `is_brand_token` is
    // untouched). `--gradient-brand` is ONE token holding a full
    // `linear-gradient()` value (not three separate stop tokens — E-P1),
    // derived from the existing accent/warning hues so the shipped identity
    // stays single-accent-derived. `--font-serif` fixes a live bug: the
    // `font-serif` utility (tokens.rs) has always referenced this name with
    // no pack defining it; the default is a system-serif stack, not a
    // specific webfont (E-P2). `--ease-brand` is the first easing custom
    // property in the engine (existing `ease-*` utilities are hardcoded
    // literals) — E-P3's glass-surface treatment is deliberately token-free
    // (derived per-recipe via `color-mix()`), so no glass token exists here.
    ("--gradient-brand", "linear-gradient(135deg, #c8543a 0%, #d97757 50%, #945f0e 100%)"),
    ("--font-serif", "ui-serif, Georgia, Cambria, \"Times New Roman\", serif"),
    ("--ease-brand", "cubic-bezier(0.22, 1, 0.36, 1)"),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn d4_scalar_tokens_are_seeded_and_tree_shake_like_colors() {
        let registry = ThemeRegistry::with_aihu_defaults();
        assert_eq!(registry.get("--border"), Some("1px"));
        assert_eq!(registry.get("--size-field"), Some("2.25rem"));

        // Only the scalar this recipe body actually references is emitted —
        // same tree-shake `emit_used_tokens` already applies to colors.
        let out =
            registry.emit_used_tokens(".btn { border: var(--border) solid; }", TokenScope::Light);
        assert!(
            out.contains("--border: 1px;"),
            "expected --border in:\n{out}"
        );
        assert!(
            !out.contains("--size-field"),
            "unreferenced token leaked:\n{out}"
        );
        assert!(
            !out.contains("--depth"),
            "unreferenced token leaked:\n{out}"
        );
    }

    #[test]
    fn d4_border_scalar_does_not_false_positive_on_color_border() {
        // `--color-border` does not actually contain `--border` as a
        // substring (only a single hyphen precedes "border" there), so this
        // pairing can't exercise `var_is_referenced`'s trailing-boundary
        // guard. What CAN produce a same-prefix collision is a longer
        // custom property that genuinely starts with the shorter name: e.g.
        // if `--border-radius` existed, unguarded `body.contains("--border")`
        // would false-positive on it. Exercise that directly.
        let registry = ThemeRegistry::with_aihu_defaults();
        let out = registry.emit_used_tokens(
            ".x { border-radius: var(--border-radius-does-not-exist); }",
            TokenScope::Light,
        );
        assert!(
            !out.contains("--border:"),
            "scalar --border falsely matched a longer name sharing its prefix:\n{out}"
        );

        // The positive case: a genuine `var(--border)` reference DOES emit it.
        let out2 =
            registry.emit_used_tokens(".x { border: var(--border) solid; }", TokenScope::Light);
        assert!(
            out2.contains("--border: 1px;"),
            "expected --border in:\n{out2}"
        );
    }

    #[test]
    fn performative_ui_tokens_tree_shake_like_every_other_scalar() {
        // docs/plans/2026-08-01-performative-ui-port.md §1: three additive
        // tokens (E-P1/E-P2/E-P3 as ruled). They must tree-shake exactly like
        // the D4 scalars above — referencing one must not pull in the other
        // two.
        let registry = ThemeRegistry::with_aihu_defaults();
        assert_eq!(
            registry.get("--gradient-brand"),
            Some("linear-gradient(135deg, #c8543a 0%, #d97757 50%, #945f0e 100%)")
        );
        assert_eq!(
            registry.get("--font-serif"),
            Some("ui-serif, Georgia, Cambria, \"Times New Roman\", serif")
        );
        assert_eq!(registry.get("--ease-brand"), Some("cubic-bezier(0.22, 1, 0.36, 1)"));

        let out = registry.emit_used_tokens(
            ".x { background-image: var(--gradient-brand); }",
            TokenScope::Light,
        );
        assert!(out.contains("--gradient-brand:"), "{out}");
        assert!(!out.contains("--font-serif"), "unreferenced token leaked:\n{out}");
        assert!(!out.contains("--ease-brand"), "unreferenced token leaked:\n{out}");
    }

    #[test]
    fn defaults_become_var_fallbacks_not_declarations() {
        // #836: a default declared at `:host` beats the inherited app theme.
        let registry = ThemeRegistry::with_aihu_defaults();
        let body = ".x { color: var(--color-muted-foreground); }";
        assert_eq!(registry.emit_declared_tokens(body, TokenScope::Shadow), "");
        assert_eq!(
            registry.with_default_fallbacks(body),
            ".x { color: var(--color-muted-foreground, #8a8880); }"
        );
    }

    #[test]
    fn declared_tokens_are_emitted_and_keep_bare_references() {
        let mut registry = ThemeRegistry::with_aihu_defaults();
        registry.apply_theme_block("--color-primary: red;");
        let body = ".x { color: var(--color-primary); background: var(--color-accent); }";
        assert_eq!(
            registry.emit_declared_tokens(body, TokenScope::Shadow),
            ":host {\n  --color-primary: red;\n}\n"
        );
        assert_eq!(
            registry.with_default_fallbacks(body),
            ".x { color: var(--color-primary); background: var(--color-accent, #c8543a); }"
        );
    }

    #[test]
    fn fallback_rewrite_leaves_existing_fallbacks_and_unknown_names_alone() {
        let mut registry = ThemeRegistry::with_aihu_defaults();
        registry.register_defaults("--color-red-500: oklch(63.7% 0.237 25.331);");
        let css = "a { color: var(--color-primary, blue); \
                   border: var(--tw-ring-color); \
                   fill: var( --color-red-500 ); \
                   b: color-mix(in oklab, var(--color-primary-foreground) 90%, black); \
                   c: somevar(--color-primary); }";
        assert_eq!(
            registry.with_default_fallbacks(css),
            "a { color: var(--color-primary, blue); \
             border: var(--tw-ring-color); \
             fill: var( --color-red-500, oklch(63.7% 0.237 25.331) ); \
             b: color-mix(in oklab, var(--color-primary-foreground, #faf8f4) 90%, black); \
             c: somevar(--color-primary); }"
        );
        // Palette entries register as defaults, so nothing is declared.
        assert_eq!(registry.emit_declared_tokens(css, TokenScope::Shadow), "");
    }
}
