/**
 * Plan 5 Task 5 — recipe-compile proof + @meta-variant (catalog) validation.
 *
 * This is the FIRST non-trivial `@style`/`.aihu` workload the css-engine
 * scanner consumes end-to-end. For each Phase 1 recipe we call
 * `@aihu/css-engine` `compileSfc(source, id)` and assert the emitted CSS is:
 *   (a) SCOPED shadow-DOM CSS (a `:host {` token block — not a global sheet);
 *   (b) referencing `var(--color-*)` for semantic tokens (NOT baked color
 *       literals) — protecting §6.9's swap-without-recompile promise (R4);
 *   (c) PACK-INVARIANT — see the note below for the verified engine reality.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * T5 PRECONDITION — VERIFIED ENGINE REALITY (flagged loudly per the plan):
 *
 * The plan's drafted Task 5 assumed (1) recipes carry a top-level `@meta` block,
 * (2) `@apply` inside `@style` is EXPANDED to `var()` rules, (3) `compileSfc`
 * takes a style-pack argument so output can be compiled under `aihu-default` vs
 * `aihu-graphite` and asserted byte-identical, and (4) the engine REJECTS an
 * undeclared `[data-variant]` (@meta-variant validation). VERIFY-FIRST probing
 * of the actual `@aihu/css-engine` / `@aihu/compiler` in this repo found:
 *
 *   1. `@aihu/compiler` does NOT recognize a top-level `@meta` block — the only
 *      blocks are `@state`, `@template`, `@style`, `@agent`, `@route`. A recipe
 *      with `@meta {…}` FAILS to compile. → Recipe metadata (variants, slots,
 *      dependencies) therefore lives in the registry catalog `meta.json`
 *      (where `aihu add` reads it anyway), NOT a `.aihu` `@meta` block.
 *
 *   2. `compileSfc` folds the authored `@style` block VERBATIM (minus `@theme`)
 *      — it does NOT expand `@apply` inside `@style`. Utility expansion to
 *      `var(--color-*)` rules happens only for the TEMPLATE `class=` scanner
 *      path (see packages/css-engine/tests/sfc-e2e.test.ts). So recipe variant
 *      rules are authored as real CSS using `var(--color-*)` directly; that is
 *      what makes assertion (b) true today. (`@apply` on the base utility line
 *      is preserved verbatim in output as authored source the consumer owns.)
 *
 *   3. `compileSfc(source, id?)` takes NO style-pack parameter — the `:host`
 *      token DEFINITIONS are always the binary's baked default pack, and there
 *      is no API path to compile under `aihu-graphite`. Pack-invariance (R4)
 *      is therefore TRIVIALLY true at this layer (the pack is not a compile
 *      input), and is asserted as "the same source compiles byte-identically on
 *      repeat" rather than across two non-selectable packs.
 *
 *   4. There is NO `@meta`-variant validation in the engine — an undeclared
 *      `[data-variant="bogus"]` is folded verbatim, not rejected. The
 *      variant-typo guard the plan wants is enforced HERE at the catalog layer:
 *      every `[data-variant|data-size|data-orientation="x"]` selector in a
 *      recipe's `@style` must match a value declared in that recipe's
 *      `meta.json` variants (the test below). That is the layer where the
 *      variant data actually lives in this implementation.
 *
 * These are engine-capability gaps (a real `@meta` block + `@apply`-in-`@style`
 * expansion + pluggable style packs are future css-engine work), NOT recipe
 * bugs. The recipes are authored to compile cleanly TODAY and to be the
 * source-of-truth artifacts `aihu add` copies.
 * ──────────────────────────────────────────────────────────────────────────
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compileSfc } from '@aihu/css-engine'
import { describe, expect, it } from 'vitest'
import type { VariantMap } from '../src/registry.ts'

const REGISTRY = join(__dirname, '..', 'registry')

function recipeSource(name: string): string {
  return readFileSync(join(REGISTRY, name, `${name}.aihu`), 'utf8')
}

function recipeMeta(name: string): { variants?: VariantMap } {
  return JSON.parse(readFileSync(join(REGISTRY, name, 'meta.json'), 'utf8'))
}

const RECIPES = ['button', 'card', 'badge', 'separator'] as const

describe('Plan 5 Task 5 — recipe-compile (scoped, var(), pack-invariant)', () => {
  for (const name of RECIPES) {
    describe(name, () => {
      it('compiles to SCOPED shadow-DOM CSS (a :host block, not a global sheet)', () => {
        const css = compileSfc(recipeSource(name), `${name}.aihu`)
        // Scoped emission emits theme tokens at :host so var(--color-*) resolves
        // inside the shadow root — there is no global utility stylesheet.
        expect(css).toContain(':host {')
        // Sanity: a global @layer / :root utility dump would signal a leak.
        expect(css).not.toContain(':root {')
      })

      it('references var(--color-*) semantic tokens, NOT baked color literals (R4)', () => {
        const css = compileSfc(recipeSource(name), `${name}.aihu`)
        // The variant/visual rules reference design tokens by var(), so swapping
        // the style pack at runtime restyles without recompiling (§6.9).
        expect(css).toContain('var(--color-')
        // No baked hex color in the AUTHORED rule bodies. (The :host block legitimately
        // defines the token VALUES as literals; the rules that USE them must not bake.)
        const authored = css.slice(css.indexOf('authored @style'))
        expect(authored).not.toMatch(/:\s*#[0-9a-fA-F]{3,8}\b/)
      })

      it('is pack-invariant: recompiling the same source is byte-identical (R4)', () => {
        // NOTE (T5): compileSfc takes no pack arg — the pack is not a compile
        // input, so output cannot differ across aihu-default/aihu-graphite. We
        // assert determinism (the strongest invariance reachable through the API).
        const a = compileSfc(recipeSource(name), `${name}.aihu`)
        const b = compileSfc(recipeSource(name), `${name}.aihu`)
        expect(a).toBe(b)
      })

      it('every declared variant value is matched by a [data-*] selector in @style', () => {
        const meta = recipeMeta(name)
        if (!meta.variants) return // presentational recipes without a matrix (card)
        const source = recipeSource(name)
        for (const [axis, values] of Object.entries(meta.variants)) {
          // axis 'variant' → data-variant, 'size' → data-size, 'orientation' → data-orientation
          const attr = `data-${axis}`
          for (const value of values) {
            expect(
              source.includes(`[${attr}="${value}"]`),
              `${name}: @style is missing a [${attr}="${value}"] rule for declared variant`,
            ).toBe(true)
          }
        }
      })

      it('@style declares NO [data-*="x"] selector that is undeclared in meta.json (variant-typo guard)', () => {
        // The catalog-layer replacement for the engine's absent @meta validation
        // (see T5 note #4): a [data-variant|data-size|data-orientation="x"] in
        // @style whose value is NOT in meta.json.variants is a recipe authoring
        // bug. This catches typo'd variants at the layer where the data lives.
        const meta = recipeMeta(name)
        const source = recipeSource(name)
        const declared = new Set<string>()
        for (const [axis, values] of Object.entries(meta.variants ?? {})) {
          for (const value of values) declared.add(`data-${axis}=${value}`)
        }
        const selectorRe = /\[(data-[a-z-]+)="([^"]+)"\]/g
        let m: RegExpExecArray | null
        // Only validate axes that the recipe actually declares (so unrelated
        // data-* attrs like data-slot are ignored).
        const declaredAxes = new Set(Object.keys(meta.variants ?? {}).map((a) => `data-${a}`))
        while ((m = selectorRe.exec(source)) !== null) {
          const [, attr, value] = m
          if (!declaredAxes.has(attr)) continue
          expect(
            declared.has(`${attr}=${value}`),
            `${name}: @style references undeclared ${attr}="${value}" (not in meta.json variants)`,
          ).toBe(true)
        }
      })
    })
  }

  it('all four Phase 1 recipes import NO primitive (the template carries the semantics)', () => {
    // This assertion used to read the other way for `button`: it required
    // `from '@aihu/primitives/button'` plus a `class AihuButtonRecipe extends
    // AihuButton` and a `customElements.define('aihu-button', …)` in the
    // source, on the strength of a §9.4 "class-extension model" claim. That
    // claim was never true of the shipped element — the compiler registers the
    // tag at module scope, so the recipe's own `define` could never fire and
    // `AihuButton` was never in the prototype chain. See
    // `.changeset/registry-dead-registration.md` and `tests/shadow-adoption.test.ts`.
    //
    // All four recipes render the semantic element in their `@template`
    // (`<button>`, `<div role="separator">`, …), which is the same shape
    // `input.aihu` / `textarea.aihu` / `label.aihu` document as the reason NOT
    // to extend a primitive. The class-extension model is alive and asserted
    // elsewhere — `checkbox.aihu`, `switch.aihu` and the dialog/popover/tooltip
    // pieces use the compiler's `$extends:` macro, which actually works.
    //
    // Matched as a real IMPORT rather than a bare substring so a header comment
    // may still discuss a primitive by name (separator's and button's both do,
    // to say why they don't extend one).
    const IMPORTS_PRIMITIVE = /^\s*import\s[^\n]*\sfrom\s+'@aihu\/primitives[^']*'/m
    for (const name of RECIPES) {
      const source = recipeSource(name)
      expect(source, `${name} imports a primitive it cannot actually extend`).not.toMatch(
        IMPORTS_PRIMITIVE,
      )
    }
  })

  it('no Phase 1 recipe hand-rolls element registration', () => {
    // The compiler owns registration (module scope, before any upgrade). A
    // `customElements.define` in `@state` is unreachable by construction.
    // `shadow-adoption.test.ts` proves that against the compiled module; this
    // is the cheap source-level restatement, next to the other catalog rules.
    for (const name of RECIPES) {
      expect(recipeSource(name), `${name} registers its own tag from @state`).not.toMatch(
        /customElements\s*\.\s*define/,
      )
    }
  })
})
