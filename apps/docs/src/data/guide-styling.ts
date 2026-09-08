/**
 * Styling guide body. Ported from apps/docs/src/content/docs/guides/styling.md
 * and UPDATED — the original was written when shadow DOM was the only scoping
 * story it described in detail, and predates the `@scope`-based light-DOM
 * path that now carries pages, layouts, and (increasingly) leaves:
 *
 *   - Light-DOM scoping is a REAL isolation mechanism now, not "the escape
 *     hatch for global-cascade frameworks". `light_scope.rs` stamps
 *     `data-a="<id>"` on each component root and wraps the component's rules
 *     in `@scope ([data-a="<id>"]) to ([data-a])`, so a component's styles
 *     stop at the next component root without any shadow boundary. The old
 *     page described light DOM only as a knob you flip for external CSS.
 *   - It also documents the at-rule hoist: @keyframes / @property / @font-face
 *     cannot live inside `@scope` and are hoisted out (GLOBAL_ONLY_AT_RULES),
 *     which is the practical reason a light-DOM component's keyframes are
 *     document-global while its rules are not.
 *   - The stale `@aihu/css-engine@0.1.0` / "prebuilt binary in a later plan"
 *     status note is dropped; the binary ships.
 *
 * Verified against packages/css-engine/crates/aihu-css-core/src/light_scope.rs
 * and the standalone compiler plugin (the shadowMode precedence chain).
 */
export const STYLING = `# Styling

aihu styles components with <strong><code>@aihu/css-engine</code></strong> — a hard fork of Tailwind v4 re-targeted for Web Components. Instead of one global utility stylesheet, the engine scans your <code>.aihu</code> sources at build time and folds the utilities each component actually uses into that component's own scoped stylesheet.

There is no global utility sheet, no runtime CSS-in-JS, and for the static case nothing extra ships to the client.

> <strong>See also:</strong> [Utility Classes](/guides/utility-classes) — the authoritative index of every supported class, variant, and brand token.

## How it works

- <strong>Build-time scanning.</strong> The engine reads SFC source, walks the compiler AST, collects the utility classes each component references, and emits a per-component stylesheet.
- <strong>Scoped output, not global.</strong> Two components on the same page never share or leak utility rules — see [Scoping](#scoping) for the two mechanisms.
- <strong>Zero-bundle for the static case.</strong> Utilities resolve to plain CSS at compile time. The only runtime code is <code>cn()</code> and the progressive-feature fallbacks, and only if you import them.

## Scoping

The rendering mode is a <strong>binary choice</strong> — <code>shadowMode: 'light' | 'shadow'</code> — and it decides how the emitted CSS is isolated. Both modes isolate; they just do it differently.

### Shadow mode

The component's rules are folded into its shadow root's <code>&lt;style&gt;</code> alongside the authored <code>@style</code> block. The shadow boundary does the isolating. Design tokens still reach in, because custom properties inherit through the boundary — see [Theming](/guides/theming).

Only <em>open</em> shadow roots exist here. Open is the only mode aihu's composition and hydration can work with, which is why there is no <code>'closed'</code> value.

### Light mode

There is no boundary to hide behind, so the engine builds one out of CSS. Each component root is stamped with a generated <code>data-a="&lt;id&gt;"</code>, and the component's rules are wrapped in:

~~~css
@scope ([data-a="a1b2c3"]) to ([data-a]) {
  /* this component's rules */
}
~~~

The lower bound is the load-bearing half. <code>data-a</code> is stamped <strong>only on component roots</strong>, so <code>to ([data-a])</code> makes the scope stop descending the moment it reaches the next component — a parent's styles cannot bleed into a child, even though both are in the same tree.

<strong>Three at-rules are hoisted out</strong> of the <code>@scope</code> block: <code>@keyframes</code>, <code>@property</code>, and <code>@font-face</code>. They are not scopable constructs — a <code>@keyframes</code> inside <code>@scope</code> simply does not register — so they are emitted at the top level. The practical consequence: a light-DOM component's <em>rules</em> are scoped, but its <em>animation names</em> are document-global. Name them distinctly.

### Which mode you get

Precedence, highest first:

1. a <code>$shadow</code> pin in the file
2. the plugin-global <code>shadowMode</code> config
3. the implicit default — <code>'light'</code> for pages (<code>@route</code>) and layouts
4. the leaf default — <code>'shadow'</code>

Pages and layouts default to light so server-rendered content is reachable by non-JS crawlers. Leaves default to shadow.

Setting <code>css: { shadowMode: 'light' }</code> in <code>viteAihuPlugin()</code> puts <em>everything</em> in the light DOM — which is what this documentation site itself does, so its global token cascade reaches every component and SPA link interception works across the shell.

## WC-native variants

On top of the standard Tailwind variant set, the engine adds variants that only make sense around a shadow root:

| Variant | Targets | Example |
|---------|---------|---------|
| <code>host:</code> | the component's <code>:host</code> | <code>host:block</code> |
| <code>slotted:</code> | <code>::slotted(…)</code> projected children | <code>slotted:text-sm</code> |
| <code>part-*:</code> | a named <code>::part(…)</code> | <code>part-label:font-bold</code> |

## Relational variants

<code>group-*:</code> and <code>peer-*:</code> style an element based on the state of a <em>related</em> element — an ancestor (<code>group</code>) or an earlier sibling (<code>peer</code>). Mark the related element with the bare <code>group</code> or <code>peer</code> class, then prefix the styled element's utilities.

| Variant | Relationship | Compiles to |
|---------|--------------|-------------|
| <code>group-hover:</code> | ancestor marked <code>group</code> is hovered | <code>.group:hover .group-hover\\:&lt;u&gt;</code> |
| <code>group-focus:</code> / <code>-focus-visible:</code> / <code>-active:</code> / <code>-disabled:</code> | ancestor in that state | <code>.group:&lt;state&gt; …</code> |
| <code>peer-checked:</code> | earlier sibling marked <code>peer</code> is checked | <code>.peer:checked ~ …</code> |
| <code>peer-hover:</code> / <code>-focus:</code> / <code>-focus-visible:</code> / <code>-disabled:</code> | earlier sibling in that state | <code>.peer:&lt;state&gt; ~ …</code> |

The bare <code>group</code> / <code>peer</code> classes are <strong>markers</strong> — no styles of their own, they just anchor the relationship. Both elements must live in the same scope. <code>peer</code> only looks <strong>backward</strong>, since CSS has no forward sibling combinator, so the <code>peer</code> element must appear first in source order.

~~~html
<div class="group">
  <span class="group-hover:bg-primary">…</span>
</div>

<input class="peer" type="checkbox" />
<span class="peer-checked:bg-primary">…</span>
~~~

Variants stack left to right: <code>md:group-hover:bg-primary</code> wraps the relational rule in the <code>md</code> media query.

## <code>cn()</code> — runtime class merging

Utilities resolve at build time, but a component that accepts a caller-supplied <code>class</code> has to merge at runtime. <code>cn()</code> does conflict-aware merging — last wins <em>per utility group</em>, so <code>p-2</code> and <code>p-6</code> collapse instead of both landing:

~~~ts
import { cn } from '@aihu/css-engine/runtime/cn'

cn('rounded-lg p-2 bg-surface', userClassName)
~~~

This is the intended pairing for [primitives](/guides/primitives), which ship zero CSS by design.

## See also

- [Theming](/guides/theming) — tokens, style packs, named themes
- [Utility Classes](/guides/utility-classes) — the full index
- [@aihu/css-engine](/api/css-engine) — the export tables
`
