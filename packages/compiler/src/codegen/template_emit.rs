use std::cell::RefCell;

use crate::codegen::signals::{SignalMap, StateNames};
use crate::expr::ExprParserMode;
use crate::types::{Attr, MacroValue, TemplateNode};
use super::emit::decode_html_entities;
use super::sidecar_ts::{extract_pattern_idents, push_alias_bindings};

/// FEL-441 — ref/onMount ORDER context, threaded through the template emitter.
///
/// `$ref={sig}` writes the element node to `sig` from an `onMount`. That
/// registration was emitted INLINE in the `return <tree>` expression — i.e.
/// AFTER `macro_code`, where the author's `@state onMount` callbacks live. The
/// runtime dispatches mount callbacks in registration order (`for (t of e.m)`),
/// so a `@state onMount` that reads the ref ran BEFORE the setter and saw the
/// unset (null) value. Founder ruling (GH #637, option a): register the
/// ref-setting `onMount` BEFORE the `@state` callbacks.
///
/// To do that without the forbidden whole-body reorder (emit.rs Defect-A
/// invariant; signals.rs "reactive-correctness risk — user decision"), an
/// owner-scope `$ref` is HOISTED: its inline IIFE assigns the node descriptor
/// to a setup-scoped holder (`__aihu_ref_N`) at tree-build time, and a matching
/// `onMount` — collected in `sink` and spliced in BEFORE `macro_code` by
/// emit.rs — reads `holder.el` at mount. Because it registers first, it runs
/// first, so the ref is populated by the time any `@state onMount` runs.
///
/// `owner_scope` is true only where a hoisted `onMount` shares the component
/// setup owner with the `@state` callbacks — i.e. NOT inside an `each`/`if`/
/// `once`/`memo` factory or a block boundary (those re-run in their own owner,
/// where the current inline try/catch registration is retained unchanged).
#[derive(Clone, Copy)]
pub(crate) struct RefHoist<'a> {
    owner_scope: bool,
    sink: Option<&'a RefCell<Vec<String>>>,
}

impl<'a> RefHoist<'a> {
    /// The non-hoisting context — used everywhere a ref cannot share the
    /// component setup owner (block bodies, factory item subtrees, SSR).
    pub(crate) fn none() -> Self {
        RefHoist { owner_scope: false, sink: None }
    }

    /// The top-level owner context, created once by emit.rs with the sink that
    /// receives the hoisted registrations.
    pub(crate) fn owner(sink: &'a RefCell<Vec<String>>) -> Self {
        RefHoist { owner_scope: true, sink: Some(sink) }
    }

    /// Descend into a child subtree, staying in owner scope only while
    /// `still_owner` holds (false at an `each`/`if`/`once`/`memo` boundary).
    fn child(self, still_owner: bool) -> Self {
        RefHoist { owner_scope: self.owner_scope && still_owner, sink: self.sink }
    }
}

/// True when `attrs` carry a directive that wraps the element (and therefore
/// its `$ref`/children) in a re-running factory or reconcile boundary, so a
/// `$ref` on or under it does NOT share the component setup owner.
fn attrs_open_factory(attrs: &[Attr]) -> bool {
    attrs.iter().any(|a| {
        matches!(a, Attr::Macro { name, .. } if matches!(name.as_str(), "if" | "each" | "once" | "memo"))
    })
}
// ─── Template emission helpers ────────────────────────────────────────────────

pub(crate) fn emit_nodes(
    nodes: &[TemplateNode],
    signal_map: &SignalMap,
    state_names: &StateNames,
    child_indent: &str,
    mode: ExprParserMode,
    rh: RefHoist,
) -> String {
    let non_empty: Vec<String> = nodes
        .iter()
        .map(|n| emit_node(n, signal_map, state_names, child_indent, mode, rh))
        .filter(|s| !s.is_empty())
        .collect();

    match non_empty.len() {
        0 => "branch(null, undefined, [])".to_string(),
        1 => non_empty.into_iter().next().unwrap(),
        _ => {
            let parent_indent = &child_indent[..child_indent.len().saturating_sub(2)];
            let children = non_empty
                .iter()
                .enumerate()
                .map(|(i, s)| {
                    if i < non_empty.len() - 1 {
                        format!("{}{},", child_indent, s)
                    } else {
                        format!("{}{}", child_indent, s)
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            format!(
                "branch(null, undefined, [\n{}\n{}])",
                children, parent_indent
            )
        }
    }
}

/// The template-text whitespace model, shared VERBATIM by the tree emit
/// (`emit_node`'s Text arm) and the SSR string emitter
/// (`ssr_string_emit.rs`) so the two can never disagree about which text
/// nodes exist and what they contain.
pub(crate) enum NormalizedText {
    /// Whitespace-only run spanning lines — template-body indentation,
    /// dropped entirely (the node contributes NO child).
    Dropped,
    /// Whitespace-only single-line run containing a non-breaking space —
    /// collapses to exactly one U+00A0.
    Nbsp,
    /// The normalized text (JSX-style collapse; single-line whitespace-only
    /// runs collapse to `" "` and land here as a one-space string).
    Text(String),
}

pub(crate) fn normalize_text_node(s: &str) -> NormalizedText {
    // Decode entities first so &nbsp; etc. survive whitespace normalization.
    let raw = decode_html_entities(s);
    if raw.trim().is_empty() {
        // A whitespace-only text node. On a SINGLE line (no newline in the
        // run) it is a significant inline separator — the only space
        // between `{a}` and `{b}`, or between text and an inline element —
        // and collapses to one space, matching HTML's inline whitespace
        // model and rule 3 below (which only ran for mixed-content text).
        // Before this it was dropped outright, so `{a} {b}` rendered `ab`
        // (#400). A run that SPANS lines is template-body indentation
        // between block-level content and stays stripped (rule 4).
        if raw.contains('\n') {
            NormalizedText::Dropped
        } else if raw.contains('\u{00A0}') {
            // A non-breaking space is deliberate significant whitespace —
            // preserve it rather than folding to a plain space (the decode
            // above exists precisely so `&nbsp;` survives).
            NormalizedText::Nbsp
        } else {
            NormalizedText::Text(" ".to_string())
        }
    } else {
        // JSX-style whitespace handling for text adjacent to inline elements:
        //  1. Collapse runs of ASCII whitespace (incl. newlines) per-line.
        //  2. Lines that are only whitespace are dropped.
        //  3. Same-line leading/trailing whitespace (no `\n` in the leading/
        //     trailing run) is preserved as a single space — required to
        //     keep the gap between `<text>` and an inline `<element>` sibling.
        //  4. Multi-line surrounding whitespace (template body newlines) is
        //     stripped entirely (existing behavior).
        let leading_len = raw
            .as_bytes()
            .iter()
            .take_while(|b| b.is_ascii_whitespace())
            .count();
        let trailing_len = raw
            .as_bytes()
            .iter()
            .rev()
            .take_while(|b| b.is_ascii_whitespace())
            .count();
        let leading_run = &raw[..leading_len];
        let trailing_run = &raw[raw.len() - trailing_len..];
        let has_same_line_leading = !leading_run.is_empty() && !leading_run.contains('\n');
        let has_same_line_trailing = !trailing_run.is_empty() && !trailing_run.contains('\n');

        let core: String = raw
            .split('\n')
            .map(|ln| ln.trim())
            .filter(|ln| !ln.is_empty())
            .collect::<Vec<_>>()
            .join(" ");

        let mut normalized = String::with_capacity(core.len() + 2);
        if has_same_line_leading {
            normalized.push(' ');
        }
        normalized.push_str(&core);
        if has_same_line_trailing {
            normalized.push(' ');
        }
        NormalizedText::Text(normalized)
    }
}

pub(crate) fn emit_node(
    node: &TemplateNode,
    signal_map: &SignalMap,
    state_names: &StateNames,
    child_indent: &str,
    mode: ExprParserMode,
    rh: RefHoist,
) -> String {
    match node {
        TemplateNode::Text(s) => match normalize_text_node(s) {
            NormalizedText::Dropped => String::new(),
            // A non-breaking space is deliberate significant whitespace —
            // emitted as the ` ` JS escape (byte-stable emit; the raw
            // char would round-trip identically but change the artifact).
            NormalizedText::Nbsp => "leaf('\\u00A0')".to_string(),
            NormalizedText::Text(normalized) => {
                let escaped = normalized.replace('\\', "\\\\").replace('\'', "\\'");
                format!("leaf('{}')", escaped)
            }
        },
        TemplateNode::Interpolation(id) => {
            let trimmed = id.trim();
            let is_simple_ident = !trimmed.is_empty()
                && trimmed
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$');

            // 1. Bare registered signal/computed identifier → reactive tuple.
            if is_simple_ident {
                if let Some(setter) = signal_map.0.get(trimmed) {
                    if setter.is_empty() {
                        // Computed signal (read-only) — emit reactive getter.
                        return format!(
                            "leaf([() => {}() as unknown as string, () => {{}}] as unknown as Signal<string>)",
                            trimmed
                        );
                    }
                    return format!(
                        "leaf([{}, {}] as unknown as Signal<string>)",
                        trimmed, setter
                    );
                }
            }

            // 2. Dotted access whose BASE is a registered signal/computed →
            //    reactive member read (e.g. {user.name}, {route.params.slug}).
            //
            //    W3: under `--expr-parser ast` this fast path is restricted to
            //    PURE dotted ident paths. Legacy fires it for ANY expression
            //    whose text-before-the-first-dot is an identifier, copying the
            //    tail VERBATIM — so `{items.filter(i => i > count).length}`
            //    emitted `(items() as any).filter(i => i > count).length` with
            //    the arrow-body `count` unrewritten (plan d01, a silent
            //    miscompile). AST mode routes anything richer than
            //    `base.prop.path` through the scope-aware rewrite below.
            let dotted_fast_path = match mode {
                ExprParserMode::Legacy => true,
                ExprParserMode::Ast => is_pure_dotted_path(trimmed),
            };
            if !dotted_fast_path {
                // fall through to step 3
            } else if let Some(dot_pos) = trimmed.find('.') {
                let base = &trimmed[..dot_pos];
                let prop_path = &trimmed[dot_pos + 1..];
                let base_is_ident = !base.is_empty()
                    && base
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$');
                if base_is_ident {
                    if signal_map.is_computed(base) {
                        return format!(
                            "leaf([() => ({}() as any).{}, () => {{}}] as unknown as Signal<string>)",
                            base, prop_path
                        );
                    } else if let Some(setter) = signal_map.0.get(base) {
                        if !setter.is_empty() {
                            return format!(
                                "leaf([() => ({}() as any).{}, {}] as unknown as Signal<string>)",
                                base, prop_path, setter
                            );
                        }
                    }
                }
            }

            // 3. FEL-172/173: rewrite bare reads of registered getters to calls
            //    (`{count + 1}` → `count() + 1`, `{section.kind}` handled in
            //    step 2, but `{section.kind === 'x' ? a : b}` lands here).
            let rewritten = rewrite_template_expr(trimmed, signal_map, mode);

            // 4. FEL-228 / FEL-173: a complex interpolation that reads reactive
            //    state — a computed/getter CALL like `{selBookLabel()}`, an
            //    expression over an imported store, or a rewritten signal read
            //    from step 3. These previously fell through to an EAGER
            //    `leaf(expr)`: a static text node evaluated once that never
            //    re-rendered on signal change (the "sole text-leaf gap").
            //    Thunk-wrap so the leaf tracks its reads — the same reactivity
            //    contract attribute bindings get from `lower_attr_expr`. Pure
            //    projections of loop vars (`{item.title}` — no call) stay
            //    eager to avoid a needless per-row effect.
            //
            //    W3: AST mode ALSO thunks when the rewritten AST reads a
            //    signal even though no call-paren is visible to the legacy
            //    scanner — the template-literal class (plan a06/a24:
            //    `` {`Count: ${count}`} `` rewrote to `${count()}` INSIDE a
            //    backtick literal, which `interpolation_has_call` skips
            //    entirely, so it stayed an eager, never-updating leaf). The
            //    has-a-call heuristic is kept as an OR so expressions over
            //    imported stores the compiler can't see stay reactive,
            //    exactly as under legacy.
            if interpolation_has_call(&rewritten.source) || rewritten.reads_signal {
                return format!(
                    "leaf([() => ({}) as unknown as string, () => {{}}] as unknown as Signal<string>)",
                    rewritten.source
                );
            }

            // 5. Genuinely static (loop-var projection, plain const) → eager.
            format!("leaf({})", rewritten.source)
        }
        TemplateNode::Element {
            tag,
            attrs,
            children,
        } => {
            // §2.6 — enhanced <a>: internal links carry the SPA behaviors the
            // retired <$link> had (navigation, prefetch, replace, aria-current).
            // Auto-opt-out (target="_blank", download, external/non-http static
            // href) and explicit `reload` render a plain <a> instead.
            if tag == "a" && anchor_is_enhanced(attrs) {
                let base = emit_enhanced_anchor(
                    attrs, children, signal_map, state_names, child_indent, mode,
                );
                let effects =
                    emit_macro_effects(attrs, "el", &base, child_indent, signal_map, mode, rh);
                return if effects.is_empty() {
                    base
                } else {
                    effects.into_iter().next().unwrap_or(base)
                };
            }

            // Check for `raw` — if present, emit the element verbatim with no macro wrapping.
            let is_raw = attrs.iter().any(|a| matches!(a, Attr::Macro { name, value } if name == "raw" && *value == MacroValue::Boolean));

            // W3 d03 — an element-level `each` scopes its binders over the
            // element's own attrs, effects, and children (shadowing signals).
            let scoped = each_scoped_maps(attrs, signal_map, state_names, mode);
            let (inner_signal_map, inner_state_names): (&SignalMap, &StateNames) = match &scoped {
                Some((sm, sn)) => (sm, sn),
                None => (signal_map, state_names),
            };

            // A plain (opted-out) <a> must not render the framework-only
            // vocabulary words (`reload`, `prefetch`, `replace`) as DOM attrs.
            let filtered_anchor_attrs: Vec<Attr>;
            let attrs_for_emit: &[Attr] = if tag == "a" {
                filtered_anchor_attrs = attrs
                    .iter()
                    .filter(|a| !matches!(attr_name(a), "reload" | "prefetch" | "replace"))
                    .cloned()
                    .collect();
                &filtered_anchor_attrs
            } else {
                attrs
            };
            // Aihu component props and DOM event listeners share the `onX`
            // spelling.  Keep the distinction through codegen: `on:save` is
            // an event listener, whereas a plain `onSave={handler}` is a
            // component property and must reach the child's prop accessor.
            let is_component = crate::tags::is_component_tag(tag);
            let attrs_str = emit_attrs_for_element(
                attrs_for_emit,
                inner_state_names,
                inner_signal_map,
                mode,
                is_component,
            );
            let has_element_child = children
                .iter()
                .any(|c| matches!(c, TemplateNode::Element { .. }));
            let next_indent = format!("{}  ", child_indent);
            // FEL-441: children of a plain element stay in owner scope; an
            // element-level `each`/`if`/`once`/`memo` opens a factory boundary,
            // so its subtree drops out of owner scope (the `$ref` there keeps
            // the inline registration).
            let child_rh = rh.child(!attrs_open_factory(attrs));
            let non_empty_children: Vec<String> = if is_raw {
                // $raw: no child processing
                Vec::new()
            } else {
                children
                    .iter()
                    .map(|c| emit_node(c, inner_signal_map, inner_state_names, &next_indent, mode, child_rh))
                    .filter(|s| !s.is_empty())
                    .collect()
            };

            // O1a (tag naming): component references emit their NORMALIZED
            // custom-element name (`<UserCard>` → branch('user-card', …));
            // plain HTML/SVG tags pass through verbatim. `slot` and `<$macro>`
            // forms never reach here (handled above / in the MacroElement arm).
            let tag = if crate::tags::is_component_tag(tag) {
                crate::tags::kebab_component_tag(tag)
            } else {
                tag.clone()
            };

            let base = if non_empty_children.is_empty() {
                format!("branch('{}', {}, [])", tag, attrs_str)
            } else if has_element_child {
                let parent_indent = &child_indent[..child_indent.len().saturating_sub(2)];
                let children_str = non_empty_children
                    .iter()
                    .enumerate()
                    .map(|(i, s)| {
                        if i < non_empty_children.len() - 1 {
                            format!("{}{},", child_indent, s)
                        } else {
                            format!("{}{}", child_indent, s)
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                format!(
                    "branch('{}', {}, [\n{}\n{}])",
                    tag, attrs_str, children_str, parent_indent
                )
            } else {
                let inline = non_empty_children.join(", ");
                format!("branch('{}', {}, [{}])", tag, attrs_str, inline)
            };

            // Emit macro effects (wrapping/side-effect macros). Per-item
            // positions use the loop-scoped map; the each LIST uses the outer.
            let effects = emit_macro_effects_scoped(
                attrs, "el", &base, child_indent, inner_signal_map, signal_map, mode, rh,
            );
            if effects.is_empty() {
                base
            } else {
                // Return the first effect (boundary wraps supersede the base node).
                effects.into_iter().next().unwrap_or(base)
            }
        }
        TemplateNode::MacroElement { name, attrs, children } => {
            // W3 d03 — `each` on a framework element (`<group each={…}>`)
            // scopes its binders over the element's subtree.
            let scoped = each_scoped_maps(attrs, signal_map, state_names, mode);
            let (inner_signal_map, inner_state_names): (&SignalMap, &StateNames) = match &scoped {
                Some((sm, sn)) => (sm, sn),
                None => (signal_map, state_names),
            };
            let base = emit_macro_element(name, attrs, children, inner_signal_map, inner_state_names, child_indent, mode);
            // Apply structural/effect directives (each/if/key/show/class:)
            // that wrap or affect the element — same as the plain Element arm
            // above. Without this, directives on macro elements were silently
            // dropped (e.g. `each` left a dangling loop var).
            let effects = emit_macro_effects_scoped(
                attrs, "el", &base, child_indent, inner_signal_map, signal_map, mode, rh,
            );
            if effects.is_empty() {
                base
            } else {
                effects.into_iter().next().unwrap_or(base)
            }
        }
        // B3 — Variant B block-tag forms. Lower to the same runtime calls as
        // the v1 attribute-directives (`createIfBoundary` / `each`) so the
        // reactivity contract is preserved.
        TemplateNode::IfBlock { branches } => {
            emit_if_block(branches, signal_map, state_names, child_indent, mode)
        }
        TemplateNode::EachBlock {
            list_expr,
            item_alias,
            idx_alias,
            key_expr,
            body,
            empty_body,
        } => emit_each_block(
            list_expr,
            item_alias,
            idx_alias.as_deref(),
            key_expr.as_deref(),
            body,
            empty_body.as_deref(),
            signal_map,
            state_names,
            child_indent,
            mode,
        ),
        TemplateNode::HtmlBlock { expr } => emit_html_block(expr, child_indent),
    }
}

/// B3 — Lower an `{#if}/{:else if}/{:else}/{/if}` block to nested
/// `createIfBoundary` calls. Each branch becomes a fragment-list of children
/// wrapped in `branch('', undefined, [...])` so the runtime reconciles across
/// fragment boundaries the same way it does for attribute-form `$if`.
fn emit_if_block(
    branches: &[(String, Vec<TemplateNode>)],
    signal_map: &SignalMap,
    state_names: &StateNames,
    child_indent: &str,
    mode: ExprParserMode,
) -> String {
    fn emit_body(
        body: &[TemplateNode],
        signal_map: &SignalMap,
        state_names: &StateNames,
        child_indent: &str,
        mode: ExprParserMode,
    ) -> String {
        let next_indent = format!("{}  ", child_indent);
        let parts: Vec<String> = body
            .iter()
            .map(|c| emit_node(c, signal_map, state_names, &next_indent, mode, RefHoist::none()))
            .filter(|s| !s.is_empty())
            .collect();
        if parts.is_empty() {
            "branch('', undefined, [])".to_string()
        } else if parts.len() == 1 {
            // Wrap a single child in a fragment-style branch so the runtime
            // sees a uniform shape across branches.
            format!("branch('', undefined, [{}])", parts[0])
        } else {
            format!("branch('', undefined, [{}])", parts.join(", "))
        }
    }

    // Compose else-if chain by negating prior conditions. The runtime's
    // `when(cond, grow)` (via createIfBoundary) takes a single cond+grow pair —
    // no built-in else slot — so for `{:else if}` we synthesize a sibling
    // when() with the negated previous condition AND the new condition. The
    // {:else} (empty cond) becomes a when() with the negation of all prior
    // conditions.
    //
    // To preserve reactivity, the negation reads each cond expression directly
    // (cond is wrapped with [() => (expr)] same as the original).
    fn negate_chain_thunk(branches_so_far: &[String]) -> String {
        // Build `[() => !(c0) && !(c1) && ... && (cN)]` for chained else-if;
        // for plain else: `[() => !(c0) && !(c1) && ...]`.
        let parts: Vec<String> = branches_so_far
            .iter()
            .map(|c| format!("!({})", c))
            .collect();
        format!("[() => ({})]", parts.join(" && "))
    }

    fn build_chain(
        idx: usize,
        branches: &[(String, Vec<TemplateNode>)],
        prior_conds: &mut Vec<String>,
        signal_map: &SignalMap,
        state_names: &StateNames,
        child_indent: &str,
        mode: ExprParserMode,
    ) -> Vec<String> {
        // Returns a list of when() calls (siblings) for the branches starting
        // at idx. The caller wraps these into a fragment-branch.
        let mut out: Vec<String> = Vec::new();
        if idx >= branches.len() {
            return out;
        }
        let (cond, body) = &branches[idx];
        let body_str = emit_body(body, signal_map, state_names, child_indent, mode);

        // FEL-172: chain/negation thunks read cond expressions verbatim, so
        // bare getter reads must be rewritten to calls here too — otherwise
        // `{:else if count}` emits `(count)` (the function — always truthy).
        let rewritten_cond = rewrite_template_expr(cond, signal_map, mode).source;
        let cond_arg = if cond.is_empty() {
            // {:else} — fire when all prior conds are false
            negate_chain_thunk(prior_conds)
        } else if prior_conds.is_empty() {
            lower_if_cond(cond, signal_map, mode)
        } else {
            // {:else if}: !prior0 && !prior1 && ... && cond
            let mut parts: Vec<String> = prior_conds
                .iter()
                .map(|c| format!("!({})", c))
                .collect();
            parts.push(format!("({})", rewritten_cond));
            format!("[() => ({})]", parts.join(" && "))
        };

        out.push(format!(
            "createIfBoundary({}, () => {{ return {} }})",
            cond_arg, body_str
        ));

        if !cond.is_empty() {
            prior_conds.push(rewritten_cond);
            let rest = build_chain(idx + 1, branches, prior_conds, signal_map, state_names, child_indent, mode);
            out.extend(rest);
            prior_conds.pop();
        }
        out
    }

    let mut prior: Vec<String> = Vec::new();
    let when_calls = build_chain(0, branches, &mut prior, signal_map, state_names, child_indent, mode);
    if when_calls.len() == 1 {
        when_calls.into_iter().next().unwrap()
    } else {
        format!("branch('', undefined, [{}])", when_calls.join(", "))
    }
}

/// Lower a `{#if}` condition the same way the attribute-form `$if` does:
/// simple identifier of a registered signal → `[get, set]` tuple; otherwise a
/// thunk array.
fn lower_if_cond(cond: &str, signal_map: &SignalMap, mode: ExprParserMode) -> String {
    let trimmed = cond.trim();
    let is_simple_ident = !trimmed.is_empty()
        && trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$');
    if is_simple_ident && signal_map.is_reactive(trimmed) {
        if let Some(setter) = signal_map.0.get(trimmed) {
            if !setter.is_empty() {
                return format!("[{}, {}]", trimmed, setter);
            } else {
                return format!("[{}]", trimmed);
            }
        }
    }
    // FEL-172: complex conditions read getters by value.
    format!(
        "[() => ({})]",
        rewrite_template_expr(trimmed, signal_map, mode).source
    )
}

/// B3 — Lower an `{#each}` block to the existing `each(...)` runtime call.
pub(crate) fn emit_each_block(
    list_expr: &str,
    item_alias: &str,
    idx_alias: Option<&str>,
    key_expr: Option<&str>,
    body: &[TemplateNode],
    empty_body: Option<&[TemplateNode]>,
    signal_map: &SignalMap,
    state_names: &StateNames,
    child_indent: &str,
    mode: ExprParserMode,
) -> String {
    // W3 (plan d03/d04): the loop aliases are BINDINGS in scope for the body
    // and the key expr — an alias that shares a registered signal's name
    // shadows it. Legacy has no scope model, so `{#each items as count}`
    // emitted `leaf([count, setCount])` INSIDE the loop callback (the signal
    // tuple, not the row value). Under `--expr-parser ast` the body/key are
    // emitted against maps with the alias names REMOVED, so every downstream
    // decision (tuple fast paths, rewrites, thunk wrapping, nested blocks)
    // treats the alias as the plain loop variable it is. The LIST expression
    // (and the `{:empty}` length conds over it) evaluates OUTSIDE the alias
    // scope and keeps the original maps.
    //
    // Alias-name extraction reuses the sidecar's `extract_pattern_idents`
    // (destructuring-aware). The c10/c11 TORN patterns (`as [k, v]` split at
    // the comma into `[k` / `v]`) yield no idents and thus no filtering —
    // pattern aliases are W5's fix; until then they behave exactly as legacy.
    let mut alias_names = std::collections::BTreeSet::new();
    if mode == ExprParserMode::Ast {
        extract_pattern_idents(item_alias, &mut alias_names);
        if let Some(idx) = idx_alias {
            extract_pattern_idents(idx, &mut alias_names);
        }
    }
    let filtered_signal_map: SignalMap;
    let filtered_state_names: StateNames;
    let (body_signal_map, body_state_names): (&SignalMap, &StateNames) = if alias_names
        .iter()
        .any(|n| signal_map.0.contains_key(n) || state_names.contains(n))
    {
        filtered_signal_map = SignalMap(
            signal_map
                .0
                .iter()
                .filter(|(k, _)| !alias_names.contains(*k))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
        );
        filtered_state_names = StateNames(
            state_names
                .0
                .iter()
                .filter(|n| !alias_names.contains(*n))
                .cloned()
                .collect(),
        );
        (&filtered_signal_map, &filtered_state_names)
    } else {
        (signal_map, state_names)
    };

    let next_indent = format!("{}  ", child_indent);
    let body_parts: Vec<String> = body
        .iter()
        .map(|c| emit_node(c, body_signal_map, body_state_names, &next_indent, mode, RefHoist::none()))
        .filter(|s| !s.is_empty())
        .collect();
    let body_str = if body_parts.len() == 1 {
        body_parts.into_iter().next().unwrap()
    } else {
        format!("branch('', undefined, [{}])", body_parts.join(", "))
    };

    let idx = idx_alias.unwrap_or("i");
    let key_part = match key_expr {
        // FEL-172: key exprs may read getters by value. W3: the key runs with
        // the alias bound (`({alias}) => key`), so it uses the alias-filtered
        // map under AST mode.
        Some(k) => format!(
            "({}) => {}",
            item_alias,
            rewrite_template_expr(k, body_signal_map, mode).source
        ),
        None => "undefined".to_string(),
    };

    // FEL-172: complex list exprs read getters by value
    // (`{#each section.data as it}` → `section().data`).
    let rewritten_list = rewrite_template_expr(list_expr, signal_map, mode).source;
    let items_arg = if signal_map.is_reactive(list_expr) {
        if let Some(setter) = signal_map.0.get(list_expr) {
            if !setter.is_empty() {
                format!("[{}, {}]", list_expr, setter)
            } else {
                format!("[{}]", list_expr)
            }
        } else {
            format!("[() => ({})]", rewritten_list)
        }
    } else {
        // Complex expression — wrap in thunk array to take Path 2.
        format!("[() => ({})]", rewritten_list)
    };

    let each_call = if signal_map.is_reactive(list_expr) {
        format!(
            "each({}, {}, ({}, {}) => {{ return {} }})",
            items_arg, key_part, item_alias, idx, body_str
        )
    } else {
        format!(
            "createEachBoundary({}, {}, ({}, {}) => {{ return {} }})",
            items_arg, key_part, item_alias, idx, body_str
        )
    };

    // {:empty} fallback: emit two sibling when() boundaries — one for the
    // populated case (length > 0) and one for the empty case (length === 0).
    if let Some(eb) = empty_body {
        let empty_parts: Vec<String> = eb
            .iter()
            .map(|c| emit_node(c, signal_map, state_names, &next_indent, mode, RefHoist::none()))
            .filter(|s| !s.is_empty())
            .collect();
        let empty_str = if empty_parts.len() == 1 {
            empty_parts.into_iter().next().unwrap()
        } else {
            format!("branch('', undefined, [{}])", empty_parts.join(", "))
        };
        // Reactive length read uses thunk array. FEL-172: the cond thunks read
        // the list by value — a bare signal here would be a truthy function
        // with `.length === undefined`, so the populated branch would never fire.
        let cond_list = if signal_map.is_reactive(list_expr) {
            format!("{}()", list_expr)
        } else {
            rewritten_list.clone()
        };
        let populated_cond = format!("[() => (({}) && ({}).length > 0)]", cond_list, cond_list);
        let empty_cond = format!("[() => !(({}) && ({}).length > 0)]", cond_list, cond_list);
        return format!(
            "branch('', undefined, [createIfBoundary({}, () => {{ return {} }}), createIfBoundary({}, () => {{ return {} }})])",
            populated_cond, each_call, empty_cond, empty_str
        );
    }

    each_call
}

/// B3 — Lower a `{@html expr}` block to the same IIFE pattern as `$html`.
fn emit_html_block(expr: &str, indent: &str) -> String {
    // Mirror the `$html` attribute-form lowering: build a fragment branch with
    // a placeholder element whose content gets replaced reactively. The
    // `onMount` registration is try/catch-guarded for the same owner-less
    // contexts as `ElemEffect::wrap` (SSR render, loop item factories).
    // Same adoption-aware first run as `ElemEffect::Html` above: confirm
    // existing server children inside an adopted (`[data-aihu-ssr]`) subtree
    // rather than re-parse + replace them; subscriptions still form.
    format!(
        "(() => {{ const _n = branch('span', {{ 'data-aihu-html': '' }}, []); try {{ onMount(() => {{ const _el = _n && _n.el; if (!_el) return () => {{}}; let _a0 = true; const _s = effect(() => {{ const _h = ({}); const _skip = _a0 && _el.childNodes.length > 0 && _el.closest('[data-aihu-ssr]') !== null; _a0 = false; if (_skip) return; _el.replaceChildren(document.createRange().createContextualFragment(_h)); }}); return () => {{ _s && _s(); }}; }}); }} catch {{}} return _n; }})(){}",
        expr,
        if indent.is_empty() { "" } else { "" }
    )
}

// ─── v0.5 Macro element boundary emitters ────────────────────────────────────

/// Emit JS for a `<$element>` macro boundary node.
fn emit_macro_element(
    name: &str,
    attrs: &[crate::types::Attr],
    children: &[TemplateNode],
    signal_map: &SignalMap,
    state_names: &StateNames,
    child_indent: &str,
    mode: ExprParserMode,
) -> String {
    let next_indent = format!("{}  ", child_indent);

    match name {
        // ── <group> — §2.5 invisible fragment carrier ────────────────────────
        // Renders no DOM element of its own; exists to carry `each`/`key`/`if`
        // (and the other §2.4 words) over a multi-element body. The wrapping
        // directives are applied by the caller (emit_node's MacroElement arm)
        // via emit_macro_effects, exactly as for plain elements.
        "group" => {
            // emit_nodes already yields the leanest fragment shape: a single
            // child passes through; multiple children wrap in a fragment
            // branch; an empty group renders nothing.
            emit_nodes(children, signal_map, state_names, &next_indent, mode, RefHoist::none())
        }

        // ── <slot> ───────────────────────────────────────────────────────────
        "slot" => {
            let expose_list = find_static_attr(attrs, "expose");
            let name_attr = find_static_attr(attrs, "name");

            let expose_arr = if let Some(expose_str) = expose_list {
                let items: Vec<String> = expose_str
                    .split(',')
                    .map(|s| format!("'{}'", s.trim()))
                    .collect();
                format!("[{}]", items.join(", "))
            } else {
                "[]".to_string()
            };

            let children_subtree = if children.is_empty() {
                String::new()
            } else {
                emit_nodes(children, signal_map, state_names, &next_indent, mode, RefHoist::none())
            };

            let child_fn = if children_subtree.is_empty() {
                "() => { return branch(null, undefined, []) }".to_string()
            } else {
                format!("() => {{ return {} }}", children_subtree)
            };

            if let Some(slot_name) = name_attr {
                format!(
                    "createSlotBoundary({{ name: '{}', expose: {} }}, {})",
                    slot_name, expose_arr, child_fn
                )
            } else {
                format!(
                    "createSlotBoundary({{ expose: {} }}, {})",
                    expose_arr, child_fn
                )
            }
        }

        // ── <$suspense> ──────────────────────────────────────────────────────
        "suspense" => {
            let source = find_static_or_binding_attr(attrs, "source")
                .unwrap_or_else(|| "undefined".to_string());

            let (fallback_children, loaded_children) = split_slot_fallback(children);

            let fallback_subtree = emit_nodes(&fallback_children, signal_map, state_names, &next_indent, mode, RefHoist::none());
            let loaded_subtree = emit_nodes(&loaded_children, signal_map, state_names, &next_indent, mode, RefHoist::none());

            format!(
                "createSuspenseBoundary({}, () => {{ return {} }}, () => {{ return {} }})",
                source, fallback_subtree, loaded_subtree
            )
        }

        // ── <$shield> ────────────────────────────────────────────────────────
        "shield" => {
            let (fallback_children, main_children) = split_slot_fallback(children);

            let main_subtree = emit_nodes(&main_children, signal_map, state_names, &next_indent, mode, RefHoist::none());
            let fallback_subtree = emit_nodes(&fallback_children, signal_map, state_names, &next_indent, mode, RefHoist::none());

            format!(
                "createShieldBoundary(() => {{ return {} }}, (shield) => {{ return {} }})",
                main_subtree, fallback_subtree
            )
        }

        // ── <$guard> ─────────────────────────────────────────────────────────
        // v0.3.0: `scope="..."` attribute lowers to `when(getScopeSignal(scope), ...)`
        // per RFC §3 / Layer 3. `getScopeSignal` is imported from `@aihu/auth`.
        //
        // [SECURITY] Amendment 7 §6.11: always emit a [SECURITY] warning when
        // `scope` is used on `<$guard>` in v0.3.0 (option c — always-warn until
        // @aihu/auth build-graph detection lands in a future release). The warning
        // is at compile time; the runtime is fail-closed (no auth → no render).
        //
        // If `scope` attribute is absent, falls back to `check` attribute (legacy).
        "guard" => {
            // v0.3.0: detect `scope="..."` attribute (must be a string literal).
            let scope_attr = find_static_attr(attrs, "scope");

            if let Some(scope_name) = scope_attr {
                // [SECURITY] Amendment 7 §6.11 — always warn in v0.3.0.
                eprintln!(
                    "[SECURITY] <$guard scope=\"{}\">: @aihu/auth cannot be verified at compile \
                     time (v0.3.0). Ensure @aihu/auth is installed and configured before \
                     deploying to production. Runtime is fail-closed: if getScopeSignal returns \
                     falsy, nothing renders.",
                    scope_name
                );

                let main_subtree = emit_nodes(children, signal_map, state_names, &next_indent, mode, RefHoist::none());
                // Lower to: when(getScopeSignal('scope'), () => branch(...children...))
                // `getScopeSignal` is imported from `@aihu/auth` at consumer build time.
                // The guard_boundary helper is not used for scope-form; when() is used directly.
                format!(
                    "when(getScopeSignal('{}'), () => {{ return {} }})",
                    scope_name, main_subtree
                )
            } else {
                // Legacy `check` attribute form.
                let check_expr = find_static_or_binding_attr(attrs, "check")
                    .unwrap_or_else(|| "undefined".to_string());

                let (fallback_children, main_children) = split_slot_fallback(children);

                let main_subtree = emit_nodes(&main_children, signal_map, state_names, &next_indent, mode, RefHoist::none());
                let fallback_subtree = emit_nodes(&fallback_children, signal_map, state_names, &next_indent, mode, RefHoist::none());

                format!(
                    "createGuardBoundary({}, () => {{ return {} }}, (guard) => {{ return {} }})",
                    check_expr, main_subtree, fallback_subtree
                )
            }
        }

        // ── <$warp> ──────────────────────────────────────────────────────────
        // NOTE(v0.5-stub): createWarpBoundary requires arbor.mount to accept an arbitrary
        // host node. If arbor.mount only accepts a custom-element host, this boundary
        // is a stub pending an arbor mount API extension.
        "warp" => {
            let target_expr = find_static_or_binding_attr(attrs, "target")
                .unwrap_or_else(|| "undefined".to_string());

            let children_subtree = emit_nodes(children, signal_map, state_names, &next_indent, mode, RefHoist::none());
            let child_fn = format!("() => {{ return {} }}", children_subtree);

            format!(
                "createWarpBoundary({}, {})\n{}// NOTE(v0.5-stub): createWarpBoundary requires arbor.mount to accept an arbitrary\n{}// host node. If arbor.mount only accepts a custom-element host, this boundary\n{}// is a stub pending an arbor mount API extension.",
                target_expr,
                child_fn,
                child_indent,
                child_indent,
                child_indent
            )
        }

        // ── arch-5 M1 a11y primitives ────────────────────────────────────────

        // <$liveRegion politeness="polite|assertive" atomic={bool}> — RFC-A5-017.
        // Lowers to <div role="status" aria-live="..." aria-atomic="true">. Pure DOM,
        // no runtime helper.
        "liveRegion" => {
            let politeness = find_static_attr(attrs, "politeness").unwrap_or("polite");
            // Validate politeness: silently coerce unknown values to 'polite' rather
            // than failing the build — defensive for HMR/templating cases.
            let politeness = if politeness == "assertive" { "assertive" } else { "polite" };
            let atomic = find_static_attr(attrs, "atomic")
                .map(|v| v != "false")
                .unwrap_or(true);
            let atomic_str = if atomic { "true" } else { "false" };
            let children_subtree = emit_nodes(children, signal_map, state_names, &next_indent, mode, RefHoist::none());
            // children_subtree is the wrapped branch; we want its children only. Easiest:
            // emit a branch wrapping the existing subtree as a single fragment child.
            format!(
                "branch('div', {{ role: 'status', 'aria-live': '{}', 'aria-atomic': '{}' }}, [{}])",
                politeness, atomic_str, children_subtree
            )
        }

        // <$visuallyHidden> — RFC-A5-020. Pure CSS span; sr-only class injected
        // once at component mount via _ensureA11yStyles().
        "visuallyHidden" => {
            let children_subtree = emit_nodes(children, signal_map, state_names, &next_indent, mode, RefHoist::none());
            format!(
                "branch('span', {{ class: 'aihu-sr-only' }}, [{}])",
                children_subtree
            )
        }

        // <$skipLink target="#id"> — RFC-A5-019. Pure HTML/CSS anchor; class
        // injected once at component mount.
        "skipLink" => {
            let target = find_static_attr(attrs, "target").unwrap_or("#main");
            let children_subtree = emit_nodes(children, signal_map, state_names, &next_indent, mode, RefHoist::none());
            format!(
                "branch('a', {{ href: '{}', class: 'aihu-skip-link' }}, [{}])",
                target, children_subtree
            )
        }

        // <$focusTrap active={...} returnFocus initialFocus="..."> — RFC-A5-018.
        // `createFocusTrap` is imported from @aihu/runtime; lowering hands it
        // the active getter (signal-ref via `() => expr` for curly bindings),
        // returnFocus flag, optional initialFocus selector, and a child function.
        "focusTrap" => {
            // active: curly `active={expr}` lands as `Attr::Binding`;
            // static `active="isOpen"` lands as `Attr::Static`. Wrap both in
            // `() => (expr)` so the helper can re-read on focus changes.
            // Literal `"true"`/`"false"` pass through as booleans.
            let active_expr = match attrs.iter().find_map(|a| match a {
                crate::types::Attr::Binding { name, expr } if name == "active" => {
                    Some(format!("() => ({})", expr))
                }
                crate::types::Attr::Static { name, value } if name == "active" => {
                    if value == "true" || value == "false" {
                        Some(value.clone())
                    } else {
                        Some(format!("() => ({})", value))
                    }
                }
                _ => None,
            }) {
                Some(e) => e,
                None => "false".to_string(),
            };

            // returnFocus: void-style boolean attr (`returnFocus`), static
            // (`returnFocus="false"`), or curly (`returnFocus={expr}`). Default
            // is `true` per spec.
            let return_focus = attrs.iter().find_map(|a| match a {
                crate::types::Attr::Static { name, value } if name == "returnFocus" => {
                    if value.is_empty() {
                        Some("true".to_string())
                    } else if value == "false" {
                        Some("false".to_string())
                    } else {
                        Some("true".to_string())
                    }
                }
                crate::types::Attr::Binding { name, expr } if name == "returnFocus" => {
                    Some(expr.clone())
                }
                _ => None,
            }).unwrap_or_else(|| "true".to_string());

            let initial_focus = match find_static_attr(attrs, "initialFocus") {
                Some(s) => format!("'{}'", s),
                None => "null".to_string(),
            };

            let children_subtree = emit_nodes(children, signal_map, state_names, &next_indent, mode, RefHoist::none());
            format!(
                "createFocusTrap({}, {}, {}, () => {{ return {} }})",
                active_expr, return_focus, initial_focus, children_subtree
            )
        }

        // ── arch-5 M1 routing macro elements ─────────────────────────────────
        "router" => {
            // `<$router>` — RFC-A5-011. Provides RouteContext to descendants.
            // Optional attribute `router={expr}` — when omitted, falls back to
            // `createRouter(routes)` using the file-system routes virtual module.
            let router_expr = find_static_or_binding_attr(attrs, "router")
                .unwrap_or_else(|| "__aihuRouter.createRouter((globalThis.__aihu_routes ?? []))".to_string());
            let vt_expr = find_static_or_binding_attr(attrs, "viewTransitions")
                .unwrap_or_else(|| "false".to_string());
            let children_subtree = emit_nodes(children, signal_map, state_names, &next_indent, mode, RefHoist::none());
            format!(
                "createRouterBoundary({}, {}, () => {{ return {} }})",
                router_expr, vt_expr, children_subtree
            )
        }

        "link" => {
            // `<$link href prefetch replace>` — RFC-A5-012.
            // A DYNAMIC href (`href={expr}`) is passed as a THUNK so the
            // boundary can bind it reactively (mirroring a plain
            // `<a $href={…}>`); the old eager form evaluated the expr once at
            // the call site and baked the string into the <a>, so a selection
            // signal change never updated the link. A static href stays a
            // quoted string (no needless per-link effect).
            let href_expr =
                link_href_arg(attrs, signal_map, mode).unwrap_or_else(|| "'#'".to_string());
            let prefetch_expr = find_static_or_binding_attr(attrs, "prefetch")
                .unwrap_or_else(|| "'none'".to_string());
            let replace_expr = find_static_or_binding_attr(attrs, "replace")
                .unwrap_or_else(|| "false".to_string());
            // Forward the author's OTHER attributes onto the rendered <a>
            // (class, id, aria-*, $on:click, $bind:*) via the same path plain
            // elements use. The <$link> props (href/prefetch/replace) are passed
            // explicitly and excluded here. Structural/effect directives
            // ($each/$if/$key/$class:/$show) are NOT consumed here —
            // emit_macro_effects applies them at the call site (emit_node's
            // MacroElement arm), exactly as for plain elements.
            let forwarded: Vec<Attr> = attrs
                .iter()
                .filter(|a| {
                    let n = match a {
                        Attr::Static { name, .. } => name.as_str(),
                        Attr::Binding { name, .. } => name.as_str(),
                        Attr::Macro { name, .. } => name.as_str(),
                    };
                    !matches!(n, "href" | "prefetch" | "replace")
                })
                .cloned()
                .collect();
            let attrs_obj = emit_attrs(&forwarded, state_names, signal_map, mode);
            // Children render inside the <a>.
            let children_subtree = if children.is_empty() {
                "[]".to_string()
            } else {
                let inner = emit_nodes(children, signal_map, state_names, &next_indent, mode, RefHoist::none());
                format!("[{}]", inner)
            };
            format!(
                "createLinkBoundary({}, {}, {}, {}, {})",
                href_expr, prefetch_expr, replace_expr, attrs_obj, children_subtree
            )
        }

        "outlet" => {
            // `<$outlet>` — RFC-A5-013. No props.
            "createOutletBoundary()".to_string()
        }

        "navigate" => {
            // `<$navigate to replace />` — RFC-A5-014.
            let to_expr = find_static_or_binding_attr(attrs, "to")
                .unwrap_or_else(|| "'/'".to_string());
            let replace_expr = find_static_or_binding_attr(attrs, "replace")
                .unwrap_or_else(|| "false".to_string());
            format!("createNavigateBoundary({}, {})", to_expr, replace_expr)
        }

        // ── Unknown macro element ─────────────────────────────────────────────
        _ => {
            let children_subtree = emit_nodes(children, signal_map, state_names, &next_indent, mode, RefHoist::none());
            format!(
                "/* <${}> unknown macro element — passthrough */ {}",
                name, children_subtree
            )
        }
    }
}

/// Find a static attribute value by name.
pub(crate) fn find_static_attr<'a>(attrs: &'a [crate::types::Attr], attr_name: &str) -> Option<&'a str> {
    attrs.iter().find_map(|a| match a {
        crate::types::Attr::Static { name, value } if name == attr_name => Some(value.as_str()),
        _ => None,
    })
}

/// Find a static OR curly-binding attribute value by name.
/// `<$link href>` argument for `createLinkBoundary`. A dynamic href
/// (`href={expr}`) is wrapped in a thunk `() => (expr)` so the boundary binds
/// it reactively (the eager form baked the value once → links never tracked a
/// selection signal). A static href (`href="/x"`) stays a quoted string so
/// static links pay no per-link effect. Bare getter reads in the expr are
/// rewritten to calls (FEL-172) so prop/signal hrefs read values, not the
/// getter function.
fn link_href_arg(
    attrs: &[crate::types::Attr],
    signal_map: &SignalMap,
    mode: ExprParserMode,
) -> Option<String> {
    use crate::types::Attr;
    attrs.iter().find_map(|a| match a {
        Attr::Static { name, value } if name == "href" => Some(format!("'{}'", value)),
        Attr::Macro {
            name,
            value: MacroValue::Quoted(s),
        } if name == "href" => Some(format!("'{}'", s)),
        Attr::Binding { name, expr } if name == "href" => Some(format!(
            "() => ({})",
            rewrite_template_expr(expr, signal_map, mode).source
        )),
        Attr::Macro {
            name,
            value: MacroValue::Curly(expr),
        } if name == "href" => Some(format!(
            "() => ({})",
            rewrite_template_expr(expr, signal_map, mode).source
        )),
        _ => None,
    })
}

/// The surface name of an attribute, whatever its form.
pub(crate) fn attr_name(a: &Attr) -> &str {
    match a {
        Attr::Static { name, .. } => name.as_str(),
        Attr::Binding { name, .. } => name.as_str(),
        Attr::Macro { name, .. } => name.as_str(),
    }
}

/// §2.6 — is this `<a>` SPA-enhanced? True when it has an `href` and none of
/// the opt-outs apply: explicit `reload`, `download` present, static
/// `target="_blank"` (or a dynamic `target` — conservative), a static href
/// that is external-origin / non-http(s) / fragment-only. A dynamic href stays
/// enhanced — the runtime handler re-checks origin+scheme per click.
pub(crate) fn anchor_is_enhanced(attrs: &[Attr]) -> bool {
    let mut has_href = false;
    for a in attrs {
        match attr_name(a) {
            "reload" | "download" => return false,
            "target" => match a {
                Attr::Static { value, .. } if value == "_blank" => return false,
                Attr::Binding { .. } => return false,
                _ => {}
            },
            "href" => match a {
                Attr::Static { value, .. } => {
                    if !static_href_is_internal(value) {
                        return false;
                    }
                    has_href = true;
                }
                Attr::Binding { .. } => {
                    has_href = true;
                }
                _ => {}
            },
            _ => {}
        }
    }
    has_href
}

/// A static href is an internal SPA destination when it is a same-origin
/// path: rooted (`/x`, but not protocol-relative `//host`), explicit-relative
/// (`./x`, `../x`), or a bare relative segment. Absolute URLs (any scheme —
/// the origin is unknowable at compile time), `mailto:`/`tel:`, and
/// fragment-only hrefs are plain navigation.
fn static_href_is_internal(href: &str) -> bool {
    let h = href.trim();
    if h.is_empty() || h.starts_with('#') {
        return false;
    }
    if h.starts_with("//") {
        return false;
    }
    if h.starts_with('/') || h.starts_with("./") || h.starts_with("../") {
        return true;
    }
    for c in h.chars() {
        match c {
            ':' => return false,
            '/' | '?' | '#' => return true,
            _ => {}
        }
    }
    true
}

/// §2.6 — lower an enhanced `<a>` to the same `createLinkBoundary` call the
/// retired `<$link>` compiled to: the element the author writes and the
/// element the runtime renders are the same element.
fn emit_enhanced_anchor(
    attrs: &[Attr],
    children: &[TemplateNode],
    signal_map: &SignalMap,
    state_names: &StateNames,
    child_indent: &str,
    mode: ExprParserMode,
) -> String {
    let next_indent = format!("{}  ", child_indent);
    let href_expr = link_href_arg(attrs, signal_map, mode).unwrap_or_else(|| "'#'".to_string());
    let prefetch_expr = find_static_or_binding_attr(attrs, "prefetch")
        .unwrap_or_else(|| "'none'".to_string());
    // Bare `replace` means true (boolean-attribute semantics).
    let replace_expr = attrs
        .iter()
        .find_map(|a| match a {
            Attr::Static { name, value } if name == "replace" => Some(
                if value.is_empty() || value == "true" {
                    "true".to_string()
                } else {
                    "false".to_string()
                },
            ),
            Attr::Binding { name, expr } if name == "replace" => Some(expr.clone()),
            _ => None,
        })
        .unwrap_or_else(|| "false".to_string());
    // Forward the author's OTHER attributes onto the rendered <a> (class, id,
    // aria-*, on:click, bind:*) via the same path plain elements use.
    // Structural/effect directives (each/if/key/class:/show) are NOT consumed
    // here — emit_macro_effects applies them at the call site.
    let forwarded: Vec<Attr> = attrs
        .iter()
        .filter(|a| !matches!(attr_name(a), "href" | "prefetch" | "replace" | "reload"))
        .cloned()
        .collect();
    let attrs_obj = emit_attrs(&forwarded, state_names, signal_map, mode);
    // Children are emitted as a FLAT array — one entry per child, NOT the
    // `emit_nodes` collapse (which wraps 2+ children in a `branch(null, …)`
    // fragment). The fragment wrapper is invisible to client rendering but
    // NOT to hydration: the SSR string emitter (`ssr_string_emit.rs`'s
    // enhanced-anchor arm) numbers the anchor's children flat
    // (`<a data-aihu-path="P"><span data-aihu-path="P.0">…`), while a
    // fragment child shifts the client walk to `P.0.0` — every path lookup
    // under the anchor then misses and arbor's hydrate falls back to
    // `_materialize`, silently DUPLICATING the link's children beside the
    // server-rendered ones (observed on every prerendered pager link).
    let children_subtree = if children.is_empty() {
        "[]".to_string()
    } else {
        let parts: Vec<String> = children
            .iter()
            .map(|n| emit_node(n, signal_map, state_names, &next_indent, mode, RefHoist::none()))
            .filter(|s| !s.is_empty())
            .collect();
        format!("[{}]", parts.join(", "))
    };
    format!(
        "createLinkBoundary({}, {}, {}, {}, {})",
        href_expr, prefetch_expr, replace_expr, attrs_obj, children_subtree
    )
}

fn find_static_or_binding_attr(attrs: &[crate::types::Attr], attr_name: &str) -> Option<String> {
    attrs.iter().find_map(|a| match a {
        crate::types::Attr::Static { name, value } if name == attr_name => {
            Some(format!("'{}'", value))
        }
        // Plain bindings like `router={myRouter}` parsed as Attr::Binding.
        crate::types::Attr::Binding { name, expr } if name == attr_name => Some(expr.clone()),
        crate::types::Attr::Macro {
            name,
            value: MacroValue::Curly(expr),
        } if name == attr_name => Some(expr.clone()),
        crate::types::Attr::Macro {
            name,
            value: MacroValue::Quoted(s),
        } if name == attr_name => Some(s.clone()),
        _ => None,
    })
}

/// Partition children into (fallback_children, non_fallback_children).
fn split_slot_fallback(children: &[TemplateNode]) -> (Vec<TemplateNode>, Vec<TemplateNode>) {
    let mut fallback: Vec<TemplateNode> = Vec::new();
    let mut main: Vec<TemplateNode> = Vec::new();

    for child in children {
        let is_fallback = match child {
            TemplateNode::MacroElement { name, attrs, .. } if name == "slot" => {
                attrs.iter().any(|a| match a {
                    crate::types::Attr::Static { name, value } => {
                        name == "name" && value == "fallback"
                    }
                    _ => false,
                })
            }
            TemplateNode::Element { attrs, .. } => {
                attrs.iter().any(|a| match a {
                    crate::types::Attr::Static { name, value } => {
                        name == "slot" && value == "fallback"
                    }
                    _ => false,
                })
            }
            _ => false,
        };

        if is_fallback {
            match child {
                TemplateNode::MacroElement { children, .. } => {
                    fallback.extend(children.iter().cloned());
                }
                other => {
                    fallback.push(other.clone());
                }
            }
        } else {
            main.push(child.clone());
        }
    }

    (fallback, main)
}

pub(crate) fn emit_attrs(
    attrs: &[Attr],
    state_names: &StateNames,
    signal_map: &SignalMap,
    mode: ExprParserMode,
) -> String {
    emit_attrs_for_element(attrs, state_names, signal_map, mode, false)
}

/// Emit an element's attribute object. Every bound value on a component is a
/// property value; event listeners use the explicit `on:<event>` directive.
/// The internal key bypasses Arbor's DOM-attribute paths, including both its
/// `onX` event shortcut and custom-element upgrade timing.
fn emit_attrs_for_element(
    attrs: &[Attr],
    state_names: &StateNames,
    signal_map: &SignalMap,
    mode: ExprParserMode,
    component_props: bool,
) -> String {
    // Filter out macro attrs that aren't pure attribute expressions
    // (those are handled via emit_macro_effects instead).
    //
    // R2 (Defect B): when a Binding/`$bind:` value references any name
    // declared in `@state`, lower the value to a single-element tuple
    // `[() => (expr)]`. arbor's `_applyAttrs` discriminates via
    // `Array.isArray(value)`: an array enters the reactive path, where
    // `value[0]` is invoked as the getter. Wrapping in a thunk array
    // achieves three goals at once:
    //
    //   1. `events={events}` where state initialises to `[]` no longer
    //      tripwires `Array.isArray([]) === true → call value[0]() →
    //      "TypeError: c is not a function"` (the LIVE crash on /calendar).
    //   2. Non-reactive plain `let` state still produces the *current*
    //      value at mount because the thunk is invoked once via
    //      `mountEffect`.
    //   3. When the underlying state IS reactive (signal/computed), the
    //      thunk re-invokes on every read inside the effect, so DOM
    //      attributes track signal changes natively.
    //
    // Static literal attributes and event handlers stay as plain values:
    // event handlers go through arbor's Path 1 (typeof === 'function');
    // statics go through Path 3 (string/number/boolean).
    let passthrough: Vec<String> = attrs
        .iter()
        .filter_map(|a| match a {
            Attr::Static { name, value } => {
                // Hyphenated attribute names (e.g. aria-label, data-foo) must be
                // quoted as JS object keys, otherwise the hyphen is parsed as minus.
                if name.contains('-') {
                    Some(format!("'{}': '{}'", name, value))
                } else {
                    Some(format!("{}: '{}'", name, value))
                }
            }
            Attr::Binding { name, expr } => {
                // Event-handler bindings (`<button onclick={handler}>`) take the
                // runtime's Path 1 (typeof === 'function'). They MUST stay raw —
                // wrapping them in a thunk array would put a function value
                // inside an array and trigger Path 2 instead, breaking events.
                let is_event = !component_props && is_event_attr_name(name);
                // B3 — `class={[a, b && 'c']}` array form. When the binding is
                // `class` and the expression syntactically starts with `[`, wrap
                // the expression in `__aihu_cls([…])` so the runtime joins truthy
                // entries with spaces. Detection is conservative — only direct
                // bracket-literal at top level. Other class expressions
                // (`class={cond ? 'a' : 'b'}`) pass through unchanged.
                let lowered = if is_event {
                    // FEL-172: rewrite bare getter reads inside handler bodies
                    // (`$on.click={() => select(section)}` → `select(section())`).
                    // A bare-ident handler (`$on.click={increment}`) is left
                    // verbatim — it's the function itself, not a read.
                    let t = expr.trim();
                    let bare_ident = !t.is_empty()
                        && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$');
                    if bare_ident {
                        expr.to_string()
                    } else {
                        rewrite_template_expr(t, signal_map, mode).source
                    }
                } else if name == "class" && expr.trim_start().starts_with('[') {
                    // W3 (plan b04): legacy NEVER rewrote inside the class
                    // array, so `$class={[...items, 'x']}` spread the getter
                    // FUNCTION (silent runtime crash) and even plain signal
                    // reads (`[active ? 'on' : '']`) read the getter object.
                    // AST mode rewrites the array expression like any other
                    // binding; legacy copies it verbatim (byte-identical).
                    let inner = match mode {
                        ExprParserMode::Legacy => expr.trim().to_string(),
                        ExprParserMode::Ast => {
                            rewrite_template_expr(expr.trim(), signal_map, mode).source
                        }
                    };
                    // Wrap the array in a class-joining helper. The wrapped form
                    // becomes `[() => __aihu_cls([…])]` — a thunk-array reactive
                    // binding that still tracks signal updates via mountEffect.
                    format!("[() => __aihu_cls({})]", inner)
                } else {
                    lower_attr_expr(expr, state_names, signal_map, mode)
                };
                let key = if component_props {
                    format_attr_key(&format!("__aihu_prop:{}", name))
                } else {
                    format_attr_key(name)
                };
                Some(format!("{}: {}", key, lowered))
            }
            Attr::Macro { name, value } => {
                // $bind:prop and $on:event emit as direct attrs in the attrs object;
                // other macros ($if, $show, $each, etc.) are emitted as effects outside.
                if let Some(prop) = name.strip_prefix("bind:") {
                    let expr = macro_value_expr(value);
                    Some(format!(
                        "{}: {}",
                        format_attr_key(prop),
                        lower_attr_expr(&expr, state_names, signal_map, mode)
                    ))
                } else if let Some(event_full) = name.strip_prefix("on:") {
                    // §2.4 — dotted modifiers: `on:click.prevent`, `on:submit.once`.
                    let (event, mods): (&str, Vec<&str>) = match event_full.split_once('.') {
                        Some((e, m)) => (e, m.split('.').collect()),
                        None => (event_full, Vec::new()),
                    };
                    let handler = macro_value_expr(value);
                    // FEL-172: same handler-body rewrite as the Binding path.
                    let t = handler.trim();
                    let bare_ident = !t.is_empty()
                        && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$');
                    let lowered_handler = if bare_ident {
                        handler.clone()
                    } else {
                        rewrite_template_expr(t, signal_map, mode).source
                    };
                    let wrapped = wrap_event_modifiers(&lowered_handler, &mods);
                    Some(format!("on{}: {}", capitalize_first(event), wrapped))
                } else {
                    None
                }
            }
        })
        .collect();

    // R4 (Director r6 §3.R4): two-way `$bind:value` / `$bind:checked` write-side.
    // When a `$bind:` macro references a registered signal (i.e. has a setter
    // in `signal_map`), additionally emit an event listener that writes back
    // to the signal on user input. `oninput` for `value` (textboxes, ranges);
    // `onchange` for `checked` (checkboxes / radios). The userland-authored
    // `on:` handler (if any) is preserved verbatim above; the bind write-back
    // is composed alongside it.
    let mut bind_writebacks: Vec<String> = Vec::new();
    for a in attrs {
        if let Attr::Macro { name, value } = a {
            if let Some(prop) = name.strip_prefix("bind:") {
                let expr = macro_value_expr(value);
                let trimmed = expr.trim();
                let is_simple_ident = !trimmed.is_empty()
                    && trimmed
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$');
                if is_simple_ident {
                    if let Some(setter) = signal_map.0.get(trimmed) {
                        if !setter.is_empty() {
                            // Pick the event by bound prop. WHATWG: `value` mutates on
                            // `input`; `checked` mutates on `change`. Other props use
                            // `change` as a sane default (safe since custom elements
                            // dispatching custom events override this anyway).
                            let evt = match prop {
                                "checked" => "change",
                                _ => "input",
                            };
                            // B3 / R4 typed-conv (Director r7 §2 Surface 1):
                            // Mirror R1's `_convert` direction at the write site.
                            // The input event always gives back a string; if the
                            // bound signal currently holds a number/boolean, coerce.
                            // Compiler emits a small inline conversion helper:
                            //   __aihu_conv(currentValue, inputString)
                            // which inspects `typeof currentValue` and parses the
                            // input string accordingly. Falls back to identity for
                            // strings and unknown types.
                            //
                            // For `checked` (boolean by platform contract) we read
                            // e.target.checked directly — no conversion needed.
                            let read_expr = if prop == "checked" {
                                "e.target.checked".to_string()
                            } else {
                                // R4 typed-conv at $bind.value write site:
                                //   __aihu_conv(getter(), e.target.value)
                                format!("__aihu_conv({}(), e.target.value)", trimmed)
                            };
                            let evt_cap = capitalize_first(evt);
                            // Avoid clobbering an existing `on{Event}: ...` userland
                            // attribute in the same attrs object: detect in passthrough
                            // by scanning the rendered strings.
                            let on_key = format!("on{}", evt_cap);
                            let already_has_on = passthrough
                                .iter()
                                .any(|s| s.starts_with(&format!("{}:", on_key)));
                            if !already_has_on {
                                bind_writebacks.push(format!(
                                    "{}: (e) => {}({})",
                                    on_key, setter, read_expr
                                ));
                            }
                        }
                    }
                }
            }
        }
    }

    let mut all_attrs = passthrough;
    all_attrs.extend(bind_writebacks);

    if all_attrs.is_empty() {
        "undefined".to_string()
    } else {
        format!("{{ {} }}", all_attrs.join(", "))
    }
}

/// Quote attribute keys that aren't valid bare JS identifiers (hyphenated
/// names like `aria-label`, data keys, and compiler-only internal keys).
fn format_attr_key(name: &str) -> String {
    let mut chars = name.chars();
    let valid = chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_' || c == '$')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$');
    if !valid {
        format!("'{}'", name)
    } else {
        name.to_string()
    }
}

/// Return true if `name` is an event-handler attribute (`onclick`, `onSubmit`,
/// etc.). These take the runtime's Path 1 (typeof === 'function') so the
/// emitter must NOT wrap their values in `[() => expr]` thunk arrays.
pub(crate) fn is_event_attr_name(name: &str) -> bool {
    if !name.starts_with("on") || name.len() < 3 {
        return false;
    }
    // `on` followed by an uppercase letter (`onClick`, `onSubmit`) or a
    // lowercase letter that pairs with a known DOM event (heuristic: any
    // remaining char is alphabetic).
    name.as_bytes()[2].is_ascii_alphabetic()
}

/// Lower a binding expression for the runtime attr setter. When the expression
/// references any name declared in `@state`, wrap it in `[() => (expr)]` so
/// arbor's `_applyAttrs` takes the reactive Path 2 (Array.isArray + getter[0]).
/// Otherwise pass through unchanged so simple closed-over locals stay as
/// static primitives.
///
/// Identifier extraction is a lightweight token walk — sufficient for
/// well-formed JS expressions and indifferent to string-literal contents
/// because string contents would not match `@state` declarations.
fn lower_attr_expr(
    expr: &str,
    state_names: &StateNames,
    signal_map: &SignalMap,
    mode: ExprParserMode,
) -> String {
    let trimmed = expr.trim();
    // R5c: pass-through signal tuple when the expression is a simple
    // identifier that's a registered signal — matches the leaf-emission
    // shape and `when()` shape, avoids the `() => getter` wrap that yields
    // the function reference instead of the tracked value.
    let is_simple_ident = !trimmed.is_empty()
        && trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$');
    if is_simple_ident && signal_map.is_reactive(trimmed) {
        if let Some(setter) = signal_map.0.get(trimmed) {
            if !setter.is_empty() {
                return format!("[{}, {}]", trimmed, setter);
            }
            return format!("[{}]", trimmed);
        }
    }
    // Thunk-wrap any binding that references local @state OR is a complex
    // (non-simple-identifier) expression. The latter mirrors `$if`/`$show`,
    // which always wrap complex conditions: a dynamic attr expression may read
    // an imported/provided reactive getter the compiler can't see in
    // `state_names` (e.g. a layout's `$class={activeStudy() ? …}` over a store),
    // so wrapping keeps the binding reactive. Bare non-reactive identifiers stay
    // eager (the simple-ident path above already handled reactive ones).
    // FEL-172: bare getter reads inside the expression are rewritten to calls
    // (`$class={section.kind === 'prose' ? 'a' : 'b'}` → `section().kind …`)
    // so the thunk reads VALUES, not the signal function.
    if expr_references_state(expr, state_names) || !is_simple_ident {
        format!(
            "[() => ({})]",
            rewrite_template_expr(trimmed, signal_map, mode).source
        )
    } else {
        expr.to_string()
    }
}

/// FEL-228: decide whether a text interpolation must be lowered to a reactive
/// thunk-leaf. True when the expression contains a function call `(` outside
/// string literals — this catches computed/getter calls (`{selBookLabel()}`,
/// `{label()}`) and expressions over imported reactive stores the compiler
/// cannot resolve to a bare signal, which previously compiled to an EAGER,
/// never-re-rendering `leaf(expr)`. Bare registered signals/computeds and
/// reactive dotted reads are already handled by the tuple paths above; plain
/// consts and pure loop-var projections (`{message}`, `{item.title}`) contain
/// no call and stay eager, avoiding a needless per-node reactive effect.
///
/// FEL-172: collect arrow-function parameter names appearing in `expr`, so the
/// signal-read rewrite can skip identifiers shadowed by handler params (e.g.
/// the `e` in `(e) => …`, or a param that happens to share a signal's name).
/// Over-collects inside parenthesized param lists (defaults/destructuring also
/// contribute their identifiers) — conservative: a missed rewrite, never a
/// broken one.
fn collect_arrow_params(expr: &str) -> std::collections::BTreeSet<String> {
    let mut params = std::collections::BTreeSet::new();
    let bytes = expr.as_bytes();
    let mut i = 0usize;
    let mut in_str: Option<u8> = None;
    while i + 1 < bytes.len() {
        let c = bytes[i];
        if let Some(q) = in_str {
            if c == b'\\' {
                i += 2;
                continue;
            }
            if c == q {
                in_str = None;
            }
            i += 1;
            continue;
        }
        if c == b'\'' || c == b'"' || c == b'`' {
            in_str = Some(c);
            i += 1;
            continue;
        }
        if c == b'=' && bytes[i + 1] == b'>' {
            // Walk back over whitespace to the params.
            let mut j = i;
            while j > 0 && bytes[j - 1].is_ascii_whitespace() {
                j -= 1;
            }
            if j > 0 && bytes[j - 1] == b')' {
                // Parenthesized list — scan back to the matching '('.
                let mut depth = 1usize;
                let mut k = j - 1;
                while k > 0 {
                    k -= 1;
                    match bytes[k] {
                        b')' => depth += 1,
                        b'(' => {
                            depth -= 1;
                            if depth == 0 {
                                break;
                            }
                        }
                        _ => {}
                    }
                }
                if depth == 0 {
                    let inner = &expr[k + 1..j - 1];
                    let mut start: Option<usize> = None;
                    for (idx, ch) in inner.char_indices() {
                        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '$' {
                            if start.is_none() {
                                start = Some(idx);
                            }
                        } else if let Some(s) = start.take() {
                            params.insert(inner[s..idx].to_string());
                        }
                    }
                    if let Some(s) = start {
                        params.insert(inner[s..].to_string());
                    }
                }
            } else {
                // Single bare-ident param: `e => …`.
                let end = j;
                let mut k = j;
                while k > 0
                    && (bytes[k - 1].is_ascii_alphanumeric()
                        || bytes[k - 1] == b'_'
                        || bytes[k - 1] == b'$')
                {
                    k -= 1;
                }
                if k < end {
                    params.insert(expr[k..end].to_string());
                }
            }
            i += 2;
            continue;
        }
        i += 1;
    }
    params
}

/// W3 (advanced-js-template-expressions) — the mode-dispatched signal-read
/// rewrite every template-expression lowering site calls.
///
/// `Legacy` (the default): the token-scanner rewrite below, byte-identical to
/// pre-W3 output. `Ast` (`--expr-parser ast`): the scope-aware span-edit
/// rewrite over the oxc AST (`expr::rewrite_signal_reads`) — spread,
/// template-literal `${…}` holes, arrow bodies, param defaults, and object
/// shorthand all rewrite correctly, and `reads_signal` reports whether the
/// expression actually reads a signal (post-shadowing) for the reactivity
/// decision. An unparseable capture (already C320/C321-rejected before emit
/// when compiled through `compile_full_with_options`; reachable only by
/// direct `emit()` callers) falls back to the legacy rewrite so emit always
/// produces output.
pub(crate) struct RewrittenExpr {
    pub(crate) source: String,
    /// AST mode only: the expression reads a registered signal after
    /// shadowing is resolved. Always `false` under `Legacy` (legacy decision
    /// sites don't consult it).
    pub(crate) reads_signal: bool,
}

/// W3 — true when `s` is nothing but `ident.ident[.ident…]` (the shape the
/// Interpolation dotted-base fast path exists for: `{user.name}`,
/// `{route.params.slug}`). Anything richer — calls, operators, optional
/// chaining, arrows — must go through the full rewrite under AST mode.
pub(crate) fn is_pure_dotted_path(s: &str) -> bool {
    s.contains('.')
        && s.split('.').all(|seg| {
            !seg.is_empty()
                && seg
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
        })
}

pub(crate) fn rewrite_template_expr(
    expr: &str,
    signal_map: &SignalMap,
    mode: ExprParserMode,
) -> RewrittenExpr {
    if mode == ExprParserMode::Ast {
        if let Some(result) = crate::expr::rewrite_signal_reads(expr, signal_map) {
            return RewrittenExpr {
                source: result.source,
                reads_signal: result.reads_signal,
            };
        }
    }
    RewrittenExpr {
        source: rewrite_signal_reads_to_calls(expr, signal_map),
        reads_signal: false,
    }
}

/// FEL-172 / FEL-173: rewrite bare reads of registered reactive getters
/// (props, signals, computeds — the keys of `signal_map`) to getter CALLS
/// inside a template expression, so expressions emitted into thunks read
/// values instead of function objects. `$if={section.kind === 'prose'}`
/// becomes `section().kind === 'prose'` — previously `.kind` was read off the
/// signal FUNCTION → always undefined → the branch silently never rendered.
///
/// The rewrite is token-based and deliberately conservative; an identifier is
/// rewritten only when ALL of:
///   - it is a key of `signal_map` (a compiled getter)
///   - not a member access (`obj.section` — prev significant char is `.`)
///   - not already a call (`section(...)` — next significant char is `(`)
///   - not an object-literal key (`{ section: 1 }`) or shorthand (`{ section }`)
///     — guarded only inside object-literal braces, tracked via a bracket
///     stack that distinguishes arrow BLOCK bodies (`=> { … }`) from literals
///   - not shadowed by an arrow param in the same expression
/// String/template literals are copied verbatim (template `${}` interpolation
/// is conservatively not entered, matching `expr_references_state`).
fn rewrite_signal_reads_to_calls(expr: &str, signal_map: &SignalMap) -> String {
    if signal_map.0.is_empty() {
        return expr.to_string();
    }
    let shadowed = collect_arrow_params(expr);
    let bytes = expr.as_bytes();
    let mut out = String::with_capacity(expr.len() + 8);
    let mut i = 0usize;
    // Bytes [flush_from..) not yet copied to `out`. Copied as a single UTF-8
    // slice the next time output diverges from input (a getter `()` append) and
    // once at the end. This preserves multibyte UTF-8 verbatim — the old
    // byte-by-byte `out.push(b as char)` mangled Greek/Hebrew/glyphs in string
    // literals into latin-1 mojibake. All tokenizing decisions key on ASCII
    // bytes (quotes, identifiers, delimiters), so every flush boundary lands on
    // a char boundary; non-ASCII bytes simply pass through inside a slice.
    let mut flush_from = 0usize;
    let mut prev_significant: u8 = 0;
    // Bracket context: '(' | '[' | 'O' (object-literal brace) | 'B' (block brace).
    let mut stack: Vec<u8> = Vec::new();
    let mut arrow_pending = false;

    let next_significant = |from: usize| -> Option<u8> {
        bytes[from..]
            .iter()
            .copied()
            .find(|b| !b.is_ascii_whitespace())
    };

    while i < bytes.len() {
        let c = bytes[i];
        // String / template literals: skip over verbatim (stay in flush region).
        if c == b'\'' || c == b'"' || c == b'`' {
            let quote = c;
            i += 1;
            while i < bytes.len() {
                if bytes[i] == b'\\' && i + 1 < bytes.len() {
                    i += 2;
                    continue;
                }
                if bytes[i] == quote {
                    i += 1;
                    break;
                }
                i += 1;
            }
            prev_significant = quote;
            arrow_pending = false;
            continue;
        }
        // Identifier token (ASCII-led).
        if c.is_ascii_alphabetic() || c == b'_' || c == b'$' {
            let start = i;
            while i < bytes.len()
                && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_' || bytes[i] == b'$')
            {
                i += 1;
            }
            let ident = &expr[start..i];
            let next = next_significant(i);
            let in_object = stack.last() == Some(&b'O');
            let after_open_or_comma =
                prev_significant == b'{' || prev_significant == b',' || prev_significant == 0;
            // Spread (`...xs`) ends in a `.`, but the ident it precedes is a
            // VALUE read, not a member access — distinguish it from real member
            // access (`obj.xs`) by looking back over whitespace for a `...` run.
            let is_spread = {
                let mut k = start;
                while k > 0 && bytes[k - 1].is_ascii_whitespace() {
                    k -= 1;
                }
                k >= 3 && &bytes[k - 3..k] == b"..."
            };
            let is_member = prev_significant == b'.' && !is_spread;
            let is_call = next == Some(b'(');
            let is_obj_key = in_object && after_open_or_comma && next == Some(b':');
            let is_obj_shorthand = in_object
                && after_open_or_comma
                && matches!(next, Some(b'}') | Some(b','));
            if !is_member
                && !is_call
                && !is_obj_key
                && !is_obj_shorthand
                && signal_map.0.contains_key(ident)
                && !shadowed.contains(ident)
            {
                // Flush everything through the identifier, then append the call.
                out.push_str(&expr[flush_from..i]);
                out.push_str("()");
                flush_from = i;
            }
            prev_significant = bytes[i - 1];
            arrow_pending = false;
            continue;
        }
        // Any other byte (operator, whitespace, or a multibyte UTF-8 byte):
        // stays in the flush region, copied verbatim later as part of a slice.
        if !c.is_ascii_whitespace() {
            match c {
                b'(' | b'[' => stack.push(c),
                b'{' => {
                    stack.push(if arrow_pending { b'B' } else { b'O' });
                }
                b')' | b']' | b'}' => {
                    stack.pop();
                }
                _ => {}
            }
            arrow_pending = c == b'>' && prev_significant == b'=';
            prev_significant = c;
        }
        i += 1;
    }
    out.push_str(&expr[flush_from..]);
    out
}

/// NOTE: interpolations are REWRITTEN first (`rewrite_signal_reads_to_calls`,
/// FEL-172/173) — `{count + 1}` becomes `count() + 1`, which then carries a
/// call and gets wrapped here. So this predicate runs on the rewritten form.
pub(crate) fn interpolation_has_call(expr: &str) -> bool {
    let bytes = expr.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        let c = bytes[i];
        // Skip string / template literals so a `(` inside text doesn't count.
        if c == b'\'' || c == b'"' || c == b'`' {
            let quote = c;
            i += 1;
            while i < bytes.len() {
                if bytes[i] == b'\\' && i + 1 < bytes.len() {
                    i += 2;
                    continue;
                }
                if bytes[i] == quote {
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }
        if c == b'(' {
            return true;
        }
        i += 1;
    }
    false
}

/// Return true iff `expr` contains an identifier token that matches any name
/// in `state_names`. Skips identifiers inside string literals and after a `.`
/// (member access — `obj.foo` where `foo` shadows a state name in property
/// position is not a state reference).
pub(crate) fn expr_references_state(expr: &str, state_names: &StateNames) -> bool {
    if state_names.0.is_empty() {
        return false;
    }
    let bytes = expr.as_bytes();
    let mut i = 0usize;
    let mut prev_significant: u8 = 0;
    while i < bytes.len() {
        let c = bytes[i];
        // Skip string literals — single, double, and template (no interpolation
        // tracking for templates; conservative: also skip backtick strings).
        if c == b'\'' || c == b'"' || c == b'`' {
            let quote = c;
            i += 1;
            while i < bytes.len() {
                if bytes[i] == b'\\' && i + 1 < bytes.len() {
                    i += 2;
                    continue;
                }
                if bytes[i] == quote {
                    i += 1;
                    break;
                }
                i += 1;
            }
            prev_significant = quote;
            continue;
        }
        // Skip line / block comments.
        if c == b'/' && i + 1 < bytes.len() {
            if bytes[i + 1] == b'/' {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
                continue;
            }
            if bytes[i + 1] == b'*' {
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                if i + 1 < bytes.len() {
                    i += 2;
                }
                continue;
            }
        }
        // Identifier?
        if c.is_ascii_alphabetic() || c == b'_' || c == b'$' {
            let start = i;
            while i < bytes.len()
                && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_' || bytes[i] == b'$')
            {
                i += 1;
            }
            let ident = &expr[start..i];
            // Treat property-access positions (`.ident`, `?.ident`) as
            // non-references so `obj.events` doesn't match a state `events`.
            let is_member_access = prev_significant == b'.';
            if !is_member_access && state_names.contains(ident) {
                return true;
            }
            prev_significant = b'a'; // identifier marker
            continue;
        }
        if !c.is_ascii_whitespace() {
            prev_significant = c;
        }
        i += 1;
    }
    false
}

fn capitalize_first(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
    }
}

/// §2.4 — compose `on:<event>.<mods>` dotted modifiers around the handler.
/// `.prevent` → preventDefault; `.stop` → stopPropagation; `.self` → only when
/// the event target IS the element; `.once` → fire at most once.
fn wrap_event_modifiers(handler: &str, mods: &[&str]) -> String {
    if mods.is_empty() {
        return handler.to_string();
    }
    let mut prelude = String::new();
    if mods.contains(&"self") {
        prelude.push_str("if (_e.target !== _e.currentTarget) return; ");
    }
    if mods.contains(&"prevent") {
        prelude.push_str("_e.preventDefault(); ");
    }
    if mods.contains(&"stop") {
        prelude.push_str("_e.stopPropagation(); ");
    }
    let core = format!("(_e) => {{ {}return ({})(_e); }}", prelude, handler);
    if mods.contains(&"once") {
        format!(
            "((_h) => {{ let _fired = false; return (_e) => {{ if (_fired) return; _fired = true; return _h(_e); }}; }})({})",
            core
        )
    } else {
        core
    }
}

pub(crate) fn macro_value_expr(value: &MacroValue) -> String {
    match value {
        MacroValue::Quoted(s) => s.clone(),
        MacroValue::Curly(s) => s.clone(),
        MacroValue::Boolean => "true".to_string(),
    }
}

/// B3b — Collect `$event` collection-form entry names from the parsed @state
/// macros. Used for compile-time `$emit.<name>` resolution (C501) and sidecar
/// typed-payload generation.
pub(crate) fn collect_event_names(macros: &[crate::types::StateMacro]) -> std::collections::BTreeSet<String> {
    use crate::types::{CollectionKind, StateMacro};
    let mut out = std::collections::BTreeSet::new();
    for m in macros {
        if let StateMacro::Collection { kind: CollectionKind::Event, entries } = m {
            for e in entries {
                out.insert(e.name.clone());
            }
        }
    }
    out
}

/// B3b — Rewrite `$emit.<name>(payload)` → `this.dispatchEvent(new CustomEvent(...))`.
///
/// Scans `expr` for `$emit.<ident>` followed by `(args)`. Args may contain
/// arbitrary JS, so paren-balanced extraction is used (string-aware).
/// Per Architect spec §5.e: lowers to `dispatchEvent(new CustomEvent(name, {
///   detail: payload, bubbles: true, composed: false, cancelable: true }))`
/// on the host element. The host is `this` in the SFC's setup function,
/// matching the post-customelement constructor context.
///
/// `event_names` are the declared `$event:` collection entries; emissions
/// targeting an undeclared name surface stderr with C501.
///
/// Idempotency: if the call has already been rewritten (no `$emit.` markers),
/// the input is returned unchanged.
fn lower_emit_calls(expr: &str, event_names: &std::collections::BTreeSet<String>) -> String {
    let bytes = expr.as_bytes();
    let mut out = String::with_capacity(expr.len());
    let mut i = 0;
    // Bytes [flush_from..) pending verbatim copy — flushed as a single UTF-8
    // slice at each `$emit` rewrite and once at the end. Strings, comments, and
    // gaps stay in this region rather than being copied byte-by-byte (the old
    // `out.push(b as char)` mangled multibyte UTF-8 into latin-1 mojibake). All
    // tokenizing keys on ASCII, so flush boundaries are always char boundaries.
    let mut flush_from = 0usize;
    while i < bytes.len() {
        // Skip strings to avoid rewriting `$emit.x` inside a string literal.
        let c = bytes[i];
        if c == b'"' || c == b'\'' || c == b'`' {
            let q = c;
            i += 1;
            while i < bytes.len() {
                let b = bytes[i];
                if b == b'\\' && i + 1 < bytes.len() {
                    i += 2;
                    continue;
                }
                i += 1;
                if b == q {
                    break;
                }
            }
            continue;
        }
        // Skip line + block comments.
        if c == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'/' {
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if c == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            if i + 1 < bytes.len() {
                i += 2;
            }
            continue;
        }
        // Detect `$emit.<ident>(`.
        if expr[i..].starts_with("$emit.") {
            // Identifier scan.
            let name_start = i + 6;
            let mut name_end = name_start;
            while name_end < bytes.len() {
                let b = bytes[name_end];
                if b.is_ascii_alphanumeric() || b == b'_' || b == b'$' {
                    name_end += 1;
                } else {
                    break;
                }
            }
            // Skip whitespace.
            let mut p = name_end;
            while p < bytes.len() && (bytes[p] == b' ' || bytes[p] == b'\t') {
                p += 1;
            }
            if p < bytes.len() && bytes[p] == b'(' && name_end > name_start {
                let name = &expr[name_start..name_end];
                let close = match find_paren_close_local(expr, p) {
                    Some(k) => k,
                    None => {
                        // Malformed; leave verbatim (stays in the flush region).
                        i += 1;
                        continue;
                    }
                };
                let args = &expr[p + 1..close];
                let detail_arg = if args.trim().is_empty() {
                    "undefined".to_string()
                } else {
                    args.to_string()
                };
                // Compile-time validation: name must be in $event collection.
                if !event_names.is_empty() && !event_names.contains(name) {
                    eprintln!(
                        "C501: $emit.{} not declared — add `{}: {{ payload: <type> }}` to your @state $event collection",
                        name, name
                    );
                }
                out.push_str(&expr[flush_from..i]);
                out.push_str(&format!(
                    "this.dispatchEvent(new CustomEvent('{}', {{ detail: {}, bubbles: true, composed: false, cancelable: true }}))",
                    name, detail_arg
                ));
                i = close + 1;
                flush_from = i;
                continue;
            }
        }
        i += 1;
    }
    out.push_str(&expr[flush_from..]);
    out
}

/// B3b — Walk the template AST and apply `lower_emit_calls` to every
/// expression string (curly bindings, macro values, interpolations,
/// {#if}/{#each}/{@html} expressions). Mutates in place.
pub(crate) fn apply_emit_lowering_nodes(
    nodes: &mut [TemplateNode],
    event_names: &std::collections::BTreeSet<String>,
) {
    for node in nodes.iter_mut() {
        match node {
            TemplateNode::Element { attrs, children, .. }
            | TemplateNode::MacroElement { attrs, children, .. } => {
                for a in attrs.iter_mut() {
                    apply_emit_lowering_attr(a, event_names);
                }
                apply_emit_lowering_nodes(children, event_names);
            }
            TemplateNode::Interpolation(s) => {
                if s.contains("$emit.") {
                    *s = lower_emit_calls(s, event_names);
                }
            }
            TemplateNode::IfBlock { branches } => {
                for (cond, body) in branches.iter_mut() {
                    if cond.contains("$emit.") {
                        *cond = lower_emit_calls(cond, event_names);
                    }
                    apply_emit_lowering_nodes(body, event_names);
                }
            }
            TemplateNode::EachBlock { list_expr, key_expr, body, empty_body, .. } => {
                if list_expr.contains("$emit.") {
                    *list_expr = lower_emit_calls(list_expr, event_names);
                }
                if let Some(k) = key_expr {
                    if k.contains("$emit.") {
                        *k = lower_emit_calls(k, event_names);
                    }
                }
                apply_emit_lowering_nodes(body, event_names);
                if let Some(eb) = empty_body {
                    apply_emit_lowering_nodes(eb, event_names);
                }
            }
            TemplateNode::HtmlBlock { expr } => {
                if expr.contains("$emit.") {
                    *expr = lower_emit_calls(expr, event_names);
                }
            }
            TemplateNode::Text(_) => {}
        }
    }
}

fn apply_emit_lowering_attr(
    a: &mut Attr,
    event_names: &std::collections::BTreeSet<String>,
) {
    match a {
        Attr::Binding { expr, .. } => {
            if expr.contains("$emit.") {
                *expr = lower_emit_calls(expr, event_names);
            }
        }
        Attr::Macro { value, .. } => {
            if let MacroValue::Curly(s) = value {
                if s.contains("$emit.") {
                    *s = lower_emit_calls(s, event_names);
                }
            }
        }
        Attr::Static { .. } => {}
    }
}

/// #487 §4.3 — the HANDLER-position write rewrite: walk the template AST and
/// rewrite plain writes to wrapper-declared bindings inside event-handler
/// expressions (`onclick={() => count++}` → `() => __count_set(count() + 1)`).
///
/// Writes-ONLY mode: reads are left for the shipped template read-pass that
/// runs downstream (`rewrite_template_expr`), so nothing double-splices.
/// Non-handler template expressions are untouched — `expr/rewrite.rs`'s
/// refusal of write targets in read position stands. A no-op for old-dialect
/// files (empty targets never reach here).
pub(crate) fn apply_state_write_lowering_nodes(
    nodes: &mut [TemplateNode],
    targets: &crate::parser::state_wrappers::WrapperTargets,
    needs_state_helper: &mut bool,
    needs_prop_helper: &mut bool,
) {
    // Alias-shadow discipline (mirrors `emit_each_block`'s filtered maps): an
    // each alias that shares a wrapper binding's name shadows it for the loop
    // body and the element's own handlers.
    fn targets_minus(
        t: &crate::parser::state_wrappers::WrapperTargets,
        names: &std::collections::BTreeSet<String>,
    ) -> crate::parser::state_wrappers::WrapperTargets {
        let mut out = t.clone();
        for n in names {
            out.states.remove(n);
            out.prop_lets.remove(n);
            out.prop_consts.remove(n);
            out.reads.remove(n);
        }
        out
    }

    for node in nodes.iter_mut() {
        match node {
            TemplateNode::Element { attrs, children, .. }
            | TemplateNode::MacroElement { attrs, children, .. } => {
                // Element-level `each=` aliases shadow for this element's own
                // handlers and its children.
                let mut alias_bound = std::collections::BTreeSet::new();
                for a in attrs.iter() {
                    if let Attr::Macro { name, value } = a {
                        if name == "each" {
                            let clause = macro_value_expr(value);
                            if let Ok(head) =
                                crate::parser::directives::parse_each_of_head(&clause)
                            {
                                push_alias_bindings(
                                    &head.item,
                                    head.idx.as_deref(),
                                    &mut alias_bound,
                                );
                            }
                        }
                    }
                }
                let filtered_storage;
                let t: &crate::parser::state_wrappers::WrapperTargets = if alias_bound.is_empty() {
                    targets
                } else {
                    filtered_storage = targets_minus(targets, &alias_bound);
                    &filtered_storage
                };
                for a in attrs.iter_mut() {
                    let handler: Option<&mut String> = match a {
                        Attr::Binding { name, expr } if is_event_attr_name(name) => Some(expr),
                        Attr::Macro { name, value } if name.starts_with("on:") => {
                            if let MacroValue::Curly(s) = value {
                                Some(s)
                            } else {
                                None
                            }
                        }
                        _ => None,
                    };
                    if let Some(expr) = handler {
                        if let Ok(Some(r)) =
                            crate::expr::rewrite_state_body(expr, "", false, t, false)
                        {
                            if r.needs_state_update_helper {
                                *needs_state_helper = true;
                            }
                            if r.needs_prop_update_helper {
                                *needs_prop_helper = true;
                            }
                            *expr = r.source;
                        }
                    }
                }
                apply_state_write_lowering_nodes(children, t, needs_state_helper, needs_prop_helper);
            }
            TemplateNode::IfBlock { branches } => {
                for (_, body) in branches.iter_mut() {
                    apply_state_write_lowering_nodes(body, targets, needs_state_helper, needs_prop_helper);
                }
            }
            TemplateNode::EachBlock { item_alias, idx_alias, body, empty_body, .. } => {
                let mut alias_bound = std::collections::BTreeSet::new();
                push_alias_bindings(item_alias, idx_alias.as_deref(), &mut alias_bound);
                let filtered = targets_minus(targets, &alias_bound);
                apply_state_write_lowering_nodes(body, &filtered, needs_state_helper, needs_prop_helper);
                if let Some(eb) = empty_body {
                    apply_state_write_lowering_nodes(eb, targets, needs_state_helper, needs_prop_helper);
                }
            }
            TemplateNode::Interpolation(_) | TemplateNode::HtmlBlock { .. } | TemplateNode::Text(_) => {}
        }
    }
}

/// Local copy of paren-close finder (string/comment-aware) for use in
/// `lower_emit_calls`. Returns the position of the matching `)` for the `(`
/// at `i`, or `None` on imbalance.
fn find_paren_close_local(s: &str, i: usize) -> Option<usize> {
    let bytes = s.as_bytes();
    if i >= bytes.len() || bytes[i] != b'(' {
        return None;
    }
    let mut depth: i32 = 0;
    let mut j = i;
    while j < bytes.len() {
        let c = bytes[j];
        if c == b'"' || c == b'\'' || c == b'`' {
            let q = c;
            j += 1;
            while j < bytes.len() {
                let b = bytes[j];
                if b == b'\\' && j + 1 < bytes.len() {
                    j += 2;
                    continue;
                }
                j += 1;
                if b == q {
                    break;
                }
            }
            continue;
        }
        if c == b'/' && j + 1 < bytes.len() && bytes[j + 1] == b'/' {
            while j < bytes.len() && bytes[j] != b'\n' {
                j += 1;
            }
            continue;
        }
        if c == b'/' && j + 1 < bytes.len() && bytes[j + 1] == b'*' {
            j += 2;
            while j + 1 < bytes.len() && !(bytes[j] == b'*' && bytes[j + 1] == b'/') {
                j += 1;
            }
            if j + 1 < bytes.len() {
                j += 2;
            }
            continue;
        }
        if c == b'(' {
            depth += 1;
        } else if c == b')' {
            depth -= 1;
            if depth == 0 {
                return Some(j);
            }
        }
        j += 1;
    }
    None
}

/// Emit side-effectful JS for macro attributes ($if, $show, $each, $html, etc.)
/// attached to an element identified by `el_var`.
/// A per-element effect directive ($show/$html/$class:/$ref) that wraps the
/// element node in an IIFE registering an onMount effect. These read the
/// element's `.el`, so they must nest immediately around the base node, inside
/// any structural boundary ($if/$each).
enum ElemEffect {
    Show(String),
    Html(String),
    Class(String, String),
    Ref(String),
    /// FEL-441: an owner-scope `$ref` whose `onMount` was hoisted ahead of the
    /// `@state` callbacks. The IIFE only assigns the node descriptor to the
    /// named setup-scoped holder (`__aihu_ref_N`); the registration lives in the
    /// hoisted block emit.rs splices before `macro_code`.
    RefHoisted(String),
}

impl ElemEffect {
    /// Wrap `inner` (the node expression this effect operates on) in the IIFE.
    ///
    /// The `onMount` registration is guarded with `try/catch` (mirroring
    /// `createLinkBoundary`): outside a component-setup owner — a host-less
    /// SSR render (`__ssr()` / `__ssrString`), or an `each`/`if` item factory
    /// re-run during reconcile — `onMount` throws `SCR-R0010 no owner`, which
    /// previously CRASHED any server render (and any looped re-grow) of an
    /// element carrying `show`/`html`/`class:`/`ref`. The effect is a
    /// mount-time behavior; where there is no mount there is nothing to wire,
    /// so swallowing the registration failure is the correct semantic.
    fn wrap(&self, inner: &str, indent: &str) -> String {
        match self {
            ElemEffect::Show(expr) => format!(
                "{}(() => {{ const _n = {}; try {{ onMount(() => {{ const _el = _n && _n.el; if (!_el) return () => {{}}; const _s = effect(() => {{ _el.toggleAttribute('hidden', !({})) }}); return () => {{ _s && _s(); }}; }}); }} catch {{}} return _n; }})()",
                indent, inner, expr
            ),
            // First-render DOM adoption: the FIRST effect run over an element
            // that (a) already has server-rendered children and (b) sits
            // inside an adopted subtree (`[data-aihu-ssr]` host marker, see
            // @aihu/server ssr.ts) CONFIRMS the server's content instead of
            // re-parsing + replacing it — the same doctrine as arbor's signal
            // pre-seeding (the server rendered this expression from the same
            // initial state, so the bytes match by construction). The
            // expression is still READ first, so reactive subscriptions form
            // and every later run replaces normally. Client-created elements
            // start empty, so they take the replace path on the first run too.
            ElemEffect::Html(expr) => format!(
                "{}(() => {{ const _n = {}; try {{ onMount(() => {{ const _el = _n && _n.el; if (!_el) return () => {{}}; let _a0 = true; const _s = effect(() => {{ const _h = ({}); const _skip = _a0 && _el.childNodes.length > 0 && _el.closest('[data-aihu-ssr]') !== null; _a0 = false; if (_skip) return; _el.replaceChildren(document.createRange().createContextualFragment(_h)); }}); return () => {{ _s && _s(); }}; }}); }} catch {{}} return _n; }})()",
                indent, inner, expr
            ),
            ElemEffect::Class(class_name, expr) => format!(
                "{}(() => {{ const _n = {}; try {{ onMount(() => {{ const _el = _n && _n.el; if (!_el) return () => {{}}; const _s = effect(() => {{ _el.classList.toggle('{}', Boolean({})) }}); return () => {{ _s && _s(); }}; }}); }} catch {{}} return _n; }})()",
                indent, inner, class_name, expr
            ),
            ElemEffect::Ref(setter_call) => format!(
                "{}(() => {{ const _n = {}; try {{ onMount(() => {{ const _el = _n && _n.el; if (_el) {{ {} }}; return () => {{}}; }}); }} catch {{}} return _n; }})()",
                indent, inner, setter_call
            ),
            // FEL-441: no onMount here — the descriptor is assigned to the
            // hoisted holder synchronously at tree-build; the registration that
            // reads `holder.el` runs before macro_code (emit.rs).
            ElemEffect::RefHoisted(holder) => format!(
                "{}(() => {{ const _n = {}; {} = _n; return _n; }})()",
                indent, inner, holder
            ),
        }
    }
}

/// Compose all effect/structural directives on a single element into ONE nested
/// wrapper around `subtree`, returning it as a single-element Vec (or an empty
/// Vec when the element carries no such directives).
///
/// FEL-238: an element may carry MULTIPLE directives at once — e.g.
/// `<span $each=… $show=…>` or `<li $each=… $class:on=…>`. Each directive WRAPS
/// the node, so they must be COMPOSED (nested), not emitted as independent
/// siblings. Previously each directive built its own wrapper around the bare
/// `subtree` and the caller kept only the FIRST, silently dropping the rest.
/// When `$each` was the dropped one (it was always appended last), the element
/// rendered ONCE with the loop alias dangling, so descendant `$on` handlers —
/// and the element's own `$show`/`$class` thunks — closed over an undeclared
/// loop variable that never advanced per iteration (the production reader
/// opened verse 1's study for every tap).
///
/// Composition is innermost → outermost, independent of source order:
///   base node
///     → element effects ($show/$html/$class:/$ref — need the element's `.el`)
///       → $once / $memo / $if (structural boundaries)
///         → $each (iteration — OUTERMOST so its factory's loop alias scopes
///                  every inner wrapper and every descendant handler)
/// W3 d03 (grammar v2, attribute form) — when an element carries `each`, its
/// loop binders SHADOW same-named signals/state for everything evaluated
/// per-item (the element's own attrs, effects, `if`/`key` values, and its
/// children). Returns filtered map copies when a collision exists.
pub(crate) fn each_scoped_maps(
    attrs: &[Attr],
    signal_map: &SignalMap,
    state_names: &StateNames,
    mode: ExprParserMode,
) -> Option<(SignalMap, StateNames)> {
    if mode != ExprParserMode::Ast {
        return None;
    }
    let head = attrs.iter().find_map(|a| match a {
        Attr::Macro { name, value } if name == "each" => Some(macro_value_expr(value)),
        _ => None,
    })?;
    let head = crate::parser::directives::parse_each_of_head(&head).ok()?;
    let mut alias_names = std::collections::BTreeSet::new();
    extract_pattern_idents(&head.item, &mut alias_names);
    if let Some(ref idx) = head.idx {
        extract_pattern_idents(idx, &mut alias_names);
    }
    if !alias_names
        .iter()
        .any(|n| signal_map.0.contains_key(n) || state_names.contains(n))
    {
        return None;
    }
    let filtered_signal_map = SignalMap(
        signal_map
            .0
            .iter()
            .filter(|(k, _)| !alias_names.contains(*k))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
    );
    let filtered_state_names = StateNames(
        state_names
            .0
            .iter()
            .filter(|n| !alias_names.contains(*n))
            .cloned()
            .collect(),
    );
    Some((filtered_signal_map, filtered_state_names))
}

pub(crate) fn emit_macro_effects(
    attrs: &[Attr],
    _el_var: &str,
    subtree: &str,
    indent: &str,
    signal_map: &SignalMap,
    mode: ExprParserMode,
    rh: RefHoist,
) -> Vec<String> {
    emit_macro_effects_scoped(attrs, _el_var, subtree, indent, signal_map, signal_map, mode, rh)
}

/// `signal_map` scopes per-item positions (`if`/`key`/effects — loop binders
/// shadow); `list_signal_map` scopes the `each` LIST expression, which
/// evaluates in the OUTER scope (alias-shadows-iterable).
fn emit_macro_effects_scoped(
    attrs: &[Attr],
    _el_var: &str,
    subtree: &str,
    indent: &str,
    signal_map: &SignalMap,
    list_signal_map: &SignalMap,
    mode: ExprParserMode,
    rh: RefHoist,
) -> Vec<String> {
    // FEL-441: a `$ref` on THIS element is hoisted only when it shares the
    // component setup owner — i.e. the incoming scope is owner scope AND this
    // element does not itself open an `each`/`if`/`once`/`memo` factory (whose
    // boundary wraps the ref innermost, moving it into the factory's owner).
    let hoist_ref = rh.owner_scope && !attrs_open_factory(attrs);
    let mut elem_effects: Vec<ElemEffect> = Vec::new();
    let mut once = false;
    let mut memo_deps: Option<String> = None;
    let mut if_cond_arg: Option<String> = None;

    let mut has_each = false;
    let mut each_items = String::new();
    let mut key_fn = String::new();
    let mut item_alias = "item".to_string();
    let mut idx_alias = "i".to_string();

    for attr in attrs {
        let Attr::Macro { name, value } = attr else {
            continue;
        };
        match name.as_str() {
            "if" => {
                let cond = macro_value_expr(value);
                // R5c (Defect E follow-up): if cond is a simple identifier
                // that's a registered signal, pass the signal tuple directly
                // — `when()` reads `cond[0]()` reactively (matches the
                // leaf-emission shape for `{name}` interpolation). Wrapping
                // a signal in `[() => name]` would yield the getter function
                // (truthy), making the condition always true.
                let trimmed = cond.trim();
                let is_simple_ident = !trimmed.is_empty()
                    && trimmed
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$');
                let cond_arg = if is_simple_ident && signal_map.is_reactive(trimmed) {
                    if let Some(setter) = signal_map.0.get(trimmed) {
                        if !setter.is_empty() {
                            format!("[{}, {}]", trimmed, setter)
                        } else {
                            // computed signal — read-only getter, no setter
                            format!("[{}]", trimmed)
                        }
                    } else {
                        format!("[() => ({})]", trimmed)
                    }
                } else {
                    // complex expression — wrap in thunk. FEL-172: bare getter
                    // reads are rewritten to calls (`$if={section.kind === 'x'}`
                    // → `section().kind === 'x'`); previously `.kind` was read
                    // off the signal FUNCTION → always undefined → the branch
                    // silently never rendered.
                    format!(
                        "[() => ({})]",
                        rewrite_template_expr(trimmed, signal_map, mode).source
                    )
                };
                if_cond_arg = Some(cond_arg);
            }
            "show" => {
                // R3 (Director r6 §3.R3): lower $show to the platform `hidden`
                // attribute (NOT --show CSS custom property). `hidden` respects
                // user CSS [hidden] { display: none !important }; Shadow DOM
                // consumers can override via :host([hidden]) { display: ... }.
                // toggleAttribute is the WHATWG-canonical primitive: passing
                // `false` removes the attribute; `true` writes empty-string.
                // FEL-172: rewrite bare getter reads inside the effect body.
                elem_effects.push(ElemEffect::Show(
                    rewrite_template_expr(&macro_value_expr(value), signal_map, mode).source,
                ));
            }
            "each" => {
                has_each = true;
                let raw = macro_value_expr(value);
                // Grammar v2 — parse the `of` head: `<binder> [, <index>] of <list>`.
                match crate::parser::directives::parse_each_of_head(&raw) {
                    Ok(head) => {
                        each_items = head.list;
                        item_alias = head.item;
                        idx_alias = head.idx.unwrap_or_else(|| "i".to_string());
                    }
                    Err(_) => {
                        // Malformed heads are rejected at parse time; be safe.
                        each_items = raw;
                        item_alias = "item".to_string();
                        idx_alias = "i".to_string();
                    }
                }
            }
            "key" => {
                key_fn = macro_value_expr(value);
            }
            "html" => {
                // branch() returns a descriptor; .el is populated after arbor mounts it.
                // IIFE: capture node, wire reactive effect inside onMount, return node
                // so the parent children array receives the element (not a bare effect).
                // replaceChildren + createContextualFragment parses trusted build-time HTML.
                elem_effects.push(ElemEffect::Html(
                    rewrite_template_expr(&macro_value_expr(value), signal_map, mode).source,
                ));
            }
            "once" => {
                once = true;
            }
            "memo" => {
                memo_deps = Some(macro_value_expr(value));
            }
            n if n.starts_with("class:") => {
                let class_name = n["class:".len()..].to_string();
                // Same IIFE pattern as $show: capture node, wire reactive effect inside
                // onMount so .el is guaranteed to be set, return node to parent children.
                elem_effects.push(ElemEffect::Class(
                    class_name,
                    rewrite_template_expr(&macro_value_expr(value), signal_map, mode).source,
                ));
            }
            n if n.starts_with("bind:") || n.starts_with("on:") => {
                // These are already handled in emit_attrs — skip here.
            }
            "raw" => {
                // $raw: node is pass-through, no child processing — handled at node level
            }
            "ref" => {
                // B3 — `$ref={signal}` writes the element node to the signal at mount.
                // Mirror the IIFE pattern used by $show/$html to capture _n.el.
                let expr = macro_value_expr(value);
                let trimmed = expr.trim();
                // If signal is a registered $prop/signal, get its setter.
                let setter_call = if let Some(setter) = signal_map.0.get(trimmed) {
                    if !setter.is_empty() {
                        format!("{}(_el)", setter)
                    } else {
                        // computed/non-writable — best-effort, ignore.
                        "/* $ref to non-writable signal */".to_string()
                    }
                } else {
                    // Plain identifier reassignment in scope.
                    format!("{} = _el", trimmed)
                };
                // FEL-441: in owner scope, HOIST the ref-setter's onMount ahead
                // of the `@state` callbacks. The inline IIFE assigns the node
                // descriptor to a setup-scoped holder at tree-build time; the
                // hoisted onMount (spliced before macro_code by emit.rs) reads
                // `holder.el` at mount, so the ref is set before any `@state`
                // onMount runs. Outside owner scope (each/if/once/memo factory,
                // SSR), keep the inline try/catch registration unchanged.
                match rh.sink {
                    Some(sink) if hoist_ref => {
                        let holder = format!("__aihu_ref_{}", sink.borrow().len());
                        sink.borrow_mut().push(format!(
                            "let {holder} = null; try {{ onMount(() => {{ const _el = {holder} && {holder}.el; if (_el) {{ {setter_call} }}; return () => {{}}; }}); }} catch {{}}"
                        ));
                        elem_effects.push(ElemEffect::RefHoisted(holder));
                    }
                    _ => elem_effects.push(ElemEffect::Ref(setter_call)),
                }
            }
            // Risk-7 closure (spec-template-syntax-v2 §"Codegen hardening —
            // silent-drop fix"): the parser now rejects unreserved
            // `$<name>="quoted"` with a hard C500 at parse time, and
            // `$<name>={expr}` routes to `Attr::Binding` via Amendment 04
            // before reaching this match. This arm is therefore unreachable
            // for well-formed inputs — kept as a defensive stderr fallback in
            // case future AST-construction paths (codemods, plugin contracts)
            // leak an unknown directive name.
            other => {
                eprintln!(
                    "C500: unknown directive `${}` (template attribute) — ignored. \
                     This should have been caught at parse time; please file a bug.",
                    other
                );
            }
        }
    }

    // Nothing to wrap — caller uses the bare base node.
    if elem_effects.is_empty() && !once && memo_deps.is_none() && if_cond_arg.is_none() && !has_each {
        return Vec::new();
    }

    // --- compose innermost → outermost ---
    // Element effects sit closest to the node (they read `_n.el`). Only the
    // OUTERMOST wrapper carries the caller's `indent`; inner wrappers use no
    // extra indent so single-directive output is byte-identical to before.
    let mut current = subtree.to_string();
    for eff in &elem_effects {
        current = eff.wrap(&current, "");
    }

    if once {
        current = format!("createOnceBoundary(() => {{ return {} }})", current);
    }
    if let Some(deps) = &memo_deps {
        current = format!("createMemoBoundary({}, () => {{ return {} }})", deps, current);
    }
    if let Some(cond_arg) = &if_cond_arg {
        current = format!("createIfBoundary({}, () => {{ return {} }})", cond_arg, current);
    }

    if has_each {
        let key_part = if key_fn.is_empty() {
            "undefined".to_string()
        } else {
            // FEL-172: key exprs may read getters too ($key={section.id + b.ref}).
            format!(
                "({}) => {}",
                item_alias,
                rewrite_template_expr(&key_fn, signal_map, mode).source
            )
        };

        // Use arbor's reactive `each()` when the list is an authored signal.
        // arbor expects a Signal tuple `[getter, setter]` (it reads `items[0]()`),
        // so for `const [items, setItems] = signal(...)` we MUST pass
        // `[items, setItems]` — not the getter alone (which would make
        // `items[0]` an undefined string-indexed access on a function value).
        // For computed signals (no setter) pass `[items]` — index-0 read still works.
        // Plain class-property arrays (no signal) wrap in a `[() => list]` thunk.
        if list_signal_map.is_reactive(&each_items) {
            let items_arg = if let Some(setter) = list_signal_map.0.get(&each_items) {
                if !setter.is_empty() {
                    format!("[{}, {}]", each_items, setter)
                } else {
                    format!("[{}]", each_items)
                }
            } else {
                format!("[() => ({})]", each_items)
            };
            current = format!(
                "each({}, {}, ({}, {}) => {{ return {} }})",
                items_arg, key_part, item_alias, idx_alias, current
            );
        } else {
            // FEL-172: a complex list expr may read a prop/signal getter
            // (`each={it of section.data}` → `section().data`); without the
            // rewrite the thunk reads `.data` off the signal FUNCTION →
            // undefined → the loop renders nothing. The LIST evaluates in the
            // OUTER scope (loop binders do not shadow their own iterable).
            current = format!(
                "createEachBoundary([() => ({})], {}, ({}, {}) => {{ return {} }})",
                rewrite_template_expr(&each_items, list_signal_map, mode).source,
                key_part,
                item_alias,
                idx_alias,
                current
            );
        }
    }

    // Apply the caller's indent to the outermost wrapper.
    vec![format!("{}{}", indent, current)]
}
