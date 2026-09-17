//! `cache.rs` — AST-hashed per-SFC incremental compilation cache (Plan 2 Task 8).
//!
//! Keyed by a stable hash over `(SfcAst, ThemeRegistry version)`: a change to
//! either input invalidates the entry. The hash is a fast non-cryptographic
//! `DefaultHasher` — we want change detection, not security. The cache lives
//! in-process (the Vite plugin / `aihu css build` holds it across the dev
//! session) so an unchanged SFC recompiles in near-zero time (the `css-6`
//! perf gate later asserts < 30 ms across a 50-SFC fixture).

use std::collections::HashMap;
use std::hash::{Hash, Hasher};

use crate::ast::{SfcAst, SfcAttr, SfcNode, SfcStyleScope};
use crate::emit::{emit_sfc_scoped, CompileError};

/// An in-process compilation cache. Construct one per dev session / build run.
#[derive(Debug, Default)]
pub struct CssCache {
    entries: HashMap<u64, String>,
    /// Number of full recompiles performed — used by tests/benches to prove a
    /// cache hit skipped the compile path.
    recompiles: u64,
    /// Number of cache hits served.
    hits: u64,
}

impl CssCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// Compile an SFC, returning a cached result on an unchanged-input hit.
    /// `theme_version` participates in the key so a theme change invalidates
    /// every entry.
    ///
    /// On a compile error (R-RESULT) the error propagates and nothing is
    /// cached, so a later fixed input re-runs the full compile path.
    pub fn compile(&mut self, ast: &SfcAst, theme_version: u64) -> Result<String, CompileError> {
        let key = hash_ast(ast, theme_version);
        if let Some(cached) = self.entries.get(&key) {
            self.hits += 1;
            return Ok(cached.clone());
        }
        self.recompiles += 1;
        let css = emit_sfc_scoped(ast)?;
        self.entries.insert(key, css.clone());
        Ok(css)
    }

    /// Total full recompiles since construction.
    pub fn recompiles(&self) -> u64 {
        self.recompiles
    }

    /// Total cache hits since construction.
    pub fn hits(&self) -> u64 {
        self.hits
    }

    /// Number of distinct entries currently cached.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Drop all cached entries (keeps the hit/recompile counters).
    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

/// Compute a stable change-detection hash over the AST + theme version.
pub fn hash_ast(ast: &SfcAst, theme_version: u64) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    theme_version.hash(&mut h);
    hash_sfc(ast, &mut h);
    h.finish()
}

fn hash_sfc(ast: &SfcAst, h: &mut impl Hasher) {
    ast.tag.hash(h);
    ast.ast_version.hash(h);
    // Included pre-emptively: unused by `emit_sfc_scoped` today (light-DOM
    // leaf flip prep, LDF §10 step 1), but once the selector-rewrite pass
    // (step 3) branches on it, a stale cache entry keyed without it would
    // serve shadow-mode CSS for a component the compiler just flipped to
    // light, or vice versa.
    ast.light_scope_id.hash(h);
    // Both change the emitted CSS for an otherwise identical SFC.
    ast.theme.hash(h);
    ast.host_tokens.hash(h);
    match &ast.style {
        Some(s) => {
            1u8.hash(h);
            s.content.hash(h);
            matches!(s.scope, SfcStyleScope::Global).hash(h);
        }
        None => 0u8.hash(h),
    }
    match &ast.template {
        Some(nodes) => {
            1u8.hash(h);
            for n in nodes {
                hash_node(n, h);
            }
        }
        None => 0u8.hash(h),
    }
}

fn hash_node(node: &SfcNode, h: &mut impl Hasher) {
    match node {
        SfcNode::Element { tag, attrs, children } => {
            0u8.hash(h);
            tag.hash(h);
            for a in attrs {
                hash_attr(a, h);
            }
            for c in children {
                hash_node(c, h);
            }
        }
        SfcNode::MacroElement { name, attrs, children } => {
            1u8.hash(h);
            name.hash(h);
            for a in attrs {
                hash_attr(a, h);
            }
            for c in children {
                hash_node(c, h);
            }
        }
        SfcNode::Text { value } => {
            2u8.hash(h);
            value.hash(h);
        }
        SfcNode::Interpolation { expr } => {
            3u8.hash(h);
            expr.hash(h);
        }
        SfcNode::IfBlock { branches } => {
            4u8.hash(h);
            for b in branches {
                b.cond.hash(h);
                for c in &b.body {
                    hash_node(c, h);
                }
            }
        }
        SfcNode::EachBlock { list, item, idx, key, body, empty_body } => {
            5u8.hash(h);
            list.hash(h);
            item.hash(h);
            idx.hash(h);
            key.hash(h);
            for c in body {
                hash_node(c, h);
            }
            if let Some(eb) = empty_body {
                for c in eb {
                    hash_node(c, h);
                }
            }
        }
        SfcNode::HtmlBlock { expr } => {
            6u8.hash(h);
            expr.hash(h);
        }
    }
}

fn hash_attr(attr: &SfcAttr, h: &mut impl Hasher) {
    // Only the class-bearing attrs affect CSS output, but hashing all attrs is
    // cheap and keeps the key robust against future emit changes.
    match attr {
        SfcAttr::Static { name, value } => {
            0u8.hash(h);
            name.hash(h);
            value.hash(h);
        }
        SfcAttr::Binding { name, expr } => {
            1u8.hash(h);
            name.hash(h);
            expr.hash(h);
        }
        SfcAttr::Macro { name, .. } => {
            2u8.hash(h);
            name.hash(h);
        }
    }
}
