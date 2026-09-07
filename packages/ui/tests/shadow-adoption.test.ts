/**
 * R2 (shadow CSS attachment) + registration ownership — against the REAL
 * compiled recipe, loaded in a DOM.
 *
 * ## What this file used to do, and why that was worse than no test
 *
 * The previous version re-declared `button.aihu`'s `@state` class BY HAND in
 * TypeScript (`class AihuButtonRecipe extends AihuButton { static sheet = … }`),
 * called `customElements.define` on it itself, and asserted the resulting
 * element adopted a shared sheet. Every assertion passed. None of them
 * described production:
 *
 *   1. The recipe's own class NEVER registers in a real build. The compiler
 *      emits `defineElement('aihu-button', …)` at MODULE scope; a `@state`
 *      block is emitted into the *setup* body, which the runtime calls only
 *      when an element UPGRADES — strictly afterwards. By then
 *      `customElements.get('aihu-button')` is already truthy, so the recipe's
 *      `if (!customElements.get(…)) customElements.define(…)` was skipped on
 *      every single instance, forever. The test registered the class that the
 *      shipped code path never registers.
 *   2. Its "shared stylesheet" was EMPTY. `static sheet = new CSSStyleSheet()`
 *      was never `replaceSync`'d with anything, so even in the fictional world
 *      where it registered, it adopted zero rules.
 *   3. jsdom 25 exposes a `CSSStyleSheet` constructor but implements neither
 *      `replaceSync` nor a real `adoptedStyleSheets` accessor — so
 *      `shadowRoot.adoptedStyleSheets = [sheet]` was a plain expando write and
 *      `toContain(sheet)` read it straight back. The assertion could not have
 *      failed.
 *
 * The dead `@state` blocks are gone (see `.changeset/registry-dead-registration.md`).
 * This file is rebuilt to assert what actually ships.
 *
 * ## What this file does now
 *
 * Compiles each of the four styled recipes with the REAL `aihu-compile` binary
 * at the REAL client target, loads the emitted module, upgrades two instances,
 * and asserts against those:
 *
 *   R2a  the shadow root adopts exactly one sheet, carrying the recipe's own
 *        compiled `@style` rules (checked by rule text, not by identity with
 *        something the test built);
 *   R2b  that sheet is the SAME object across two instances — module-scope
 *        single construction, not per-instance;
 *   REG  `customElements.define` is called exactly ONCE for the tag, by the
 *        compiler, at module evaluation — and upgrading instances adds no
 *        further registration.
 *
 * `CSSStyleSheet` is shimmed (jsdom has no usable one — see 3 above) but the
 * shim is a RECORDER, not a stand-in for the assertion: it stores the text the
 * compiled module passes to `replaceSync`, and the test asserts that text
 * contains the recipe's real selectors. Real-browser confirmation that those
 * rules actually paint is the Storybook + axe gate (`bun run check:a11y`),
 * which drives all four recipes in chromium.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { mount } from '@aihu/arbor'
import { _setMount, _setSignal } from '@aihu/runtime'
import { signal } from '@aihu/signals'
import { beforeAll, describe, expect, it } from 'vitest'
import { resolvePublishedCompilerBinary } from '../../../scripts/lib/compiler-binary.ts'

const __dir = dirname(new URL(import.meta.url).pathname)
const REPO = resolve(__dir, '../../..')
const REGISTRY = resolve(__dir, '../registry')
/** Emitted modules land inside the repo so vitest transforms + aliases them. */
const EMIT_DIR = resolve(__dir, '.client-emit')

const COMPILER = resolvePublishedCompilerBinary()

/** The four recipes that carried the dead registration block. */
const RECIPES = ['button', 'card', 'badge', 'separator'] as const

/** Selectors each recipe's compiled `@style` must actually deliver. */
const EXPECTED_RULES: Record<(typeof RECIPES)[number], string[]> = {
  button: [
    '.aihu-button',
    '.aihu-button[data-variant="destructive"]',
    '.aihu-button[data-size="lg"]',
  ],
  card: ['.aihu-card', '.aihu-card-header', '.aihu-card-footer'],
  badge: ['.aihu-badge', '.aihu-badge[data-variant="outline"]'],
  separator: ['.aihu-separator', '.aihu-separator[data-orientation="vertical"]'],
}

_setMount(mount as never)
_setSignal(signal)

/**
 * Recording stand-in for the Constructable StyleSheet jsdom does not
 * implement. Deliberately minimal: it captures what the COMPILED module does,
 * and nothing in this file asserts identity with a sheet the test authored.
 */
class RecordingStyleSheet {
  static constructed = 0
  cssText = ''
  constructor() {
    RecordingStyleSheet.constructed++
  }
  replaceSync(text: string): void {
    this.cssText = text
  }
}
;(globalThis as Record<string, unknown>).CSSStyleSheet = RecordingStyleSheet

/** Every `customElements.define` call made from module load onwards. */
const registrations: Array<{ tag: string; ctor: CustomElementConstructor }> = []
const _realDefine = customElements.define.bind(customElements)
customElements.define = (
  tag: string,
  ctor: CustomElementConstructor,
  options?: ElementDefinitionOptions,
): void => {
  registrations.push({ tag, ctor })
  _realDefine(tag, ctor, options)
}

function compile(name: string): string {
  const tag = `aihu-${name}`
  // The registry stores `button/button.aihu`, but the compiled tag derives from
  // the FILE STEM and a hyphen-less custom-element name is a hard C450 error.
  // `aihu add` (and apps/storybook's sync-recipes) both write the prefixed
  // stem, so compile under the name a consumer's project actually holds.
  const src = readFileSync(resolve(REGISTRY, name, `${name}.aihu`), 'utf8')
  const out = spawnSync(
    COMPILER,
    ['--stdin', '--tag', tag, '--path', `${tag}.aihu`, '--target', 'client'],
    { input: src, encoding: 'utf8' },
  )
  if (out.status !== 0) throw new Error(`aihu-compile failed for ${name}: ${out.stderr}`)
  const file = resolve(EMIT_DIR, `${tag}.ts`)
  // `@aihu/primitives/<sub>` has no vitest alias (only the barrel does); map any
  // such subpath to workspace source so a recipe that grows one still loads.
  writeFileSync(
    file,
    out.stdout.replace(
      /from '@aihu\/primitives\/([^']+)'/g,
      (_m, sub: string) => `from '${resolve(REPO, 'packages/primitives/src', sub, 'index.ts')}'`,
    ),
  )
  return file
}

/** tag -> the two upgraded instances, after module load. */
const instances = new Map<string, HTMLElement[]>()
/** tag -> CSSStyleSheet constructions caused by loading it + upgrading two instances. */
const sheetsBuilt = new Map<string, number>()

beforeAll(async () => {
  rmSync(EMIT_DIR, { recursive: true, force: true })
  mkdirSync(EMIT_DIR, { recursive: true })
  writeFileSync(resolve(EMIT_DIR, '.gitignore'), '*\n')

  for (const name of RECIPES) {
    const file = compile(name)
    const before = RecordingStyleSheet.constructed
    await import(/* @vite-ignore */ file)
    const tag = `aihu-${name}`
    document.body.insertAdjacentHTML('beforeend', `<${tag}>A</${tag}><${tag}>B</${tag}>`)
    instances.set(tag, Array.from(document.querySelectorAll(tag)) as HTMLElement[])
    sheetsBuilt.set(tag, RecordingStyleSheet.constructed - before)
  }
}, 120_000)

function adopted(el: HTMLElement): RecordingStyleSheet[] {
  const root = el.shadowRoot
  expect(root, `${el.tagName.toLowerCase()} attached no shadow root`).not.toBeNull()
  return (
    (root as unknown as { adoptedStyleSheets?: RecordingStyleSheet[] }).adoptedStyleSheets ?? []
  )
}

describe('R2 — the compiled recipe stylesheet is adopted into the shadow root', () => {
  for (const name of RECIPES) {
    const tag = `aihu-${name}`

    it(`${tag} adopts exactly one sheet, carrying its own compiled @style rules`, () => {
      const [a] = instances.get(tag) as HTMLElement[]
      const sheets = adopted(a)
      expect(sheets, `${tag} adopted ${sheets.length} sheets`).toHaveLength(1)
      // Not "a sheet exists" — the RULES exist. An empty Constructable
      // StyleSheet (what the deleted `@state` block adopted) fails here.
      expect(sheets[0]!.cssText.length).toBeGreaterThan(0)
      for (const selector of EXPECTED_RULES[name]) {
        expect(sheets[0]!.cssText, `${tag}'s adopted sheet is missing ${selector}`).toContain(
          selector,
        )
      }
    })

    it(`${tag}'s adopted sheet is SHARED across instances (module-scope, not per-instance)`, () => {
      const [a, b] = instances.get(tag) as HTMLElement[]
      expect(adopted(a)[0]).toBe(adopted(b)[0])
    })

    it(`${tag} constructs exactly ONE CSSStyleSheet, at module scope`, () => {
      // The falsifiable half of R2b, and the one thing the deleted block DID
      // cost at runtime. `static sheet = new CSSStyleSheet()` sat inside a
      // class declaration in `@state`, i.e. inside the setup body — so it was
      // re-evaluated on EVERY instance, allocating a fresh (and never
      // populated) sheet that was then thrown away with the class. Loading the
      // module and upgrading two instances used to cost 3 constructions; it
      // now costs 1.
      expect(sheetsBuilt.get(tag)).toBe(1)
    })

    it(`${tag} renders its template into the shadow root`, () => {
      // The corollary of "the compiler's class wins registration": the element
      // the browser instantiates is the one that RENDERS. Had the recipe's own
      // class ever won, it would have attached a bare shadow root and the
      // template would be nowhere.
      const [a] = instances.get(tag) as HTMLElement[]
      expect(a.shadowRoot?.querySelector(`[data-slot="${name}"]`)).toBeTruthy()
    })
  }
})

describe('registration ownership — the compiler registers the tag, the recipe does not', () => {
  for (const name of RECIPES) {
    const tag = `aihu-${name}`

    it(`${tag} is registered exactly ONCE, and not by the recipe`, () => {
      const mine = registrations.filter((r) => r.tag === tag)
      // Two elements of this tag have upgraded by now, so a `@state`-level
      // `customElements.define` would have had two chances to fire.
      expect(mine, `${tag} was registered ${mine.length} times`).toHaveLength(1)
      expect(customElements.get(tag)).toBe(mine[0]!.ctor)
    })
  }

  it('registration happens at MODULE scope, before any instance upgrades', () => {
    // Ordering, stated directly: all four tags were registered during the
    // import loop, so by the time any `@state` body ran, `customElements.get`
    // was already truthy for its own tag. That is the whole reason a recipe
    // cannot register itself, and why the four blocks were deleted rather than
    // "fixed".
    for (const name of RECIPES) expect(customElements.get(`aihu-${name}`)).toBeTruthy()
  })
})

describe('the shipped recipe sources no longer hand-roll registration or CSS attachment', () => {
  for (const name of RECIPES) {
    it(`${name}.aihu's @state neither registers nor adopts`, () => {
      const src = readFileSync(resolve(REGISTRY, name, `${name}.aihu`), 'utf8')
      const state = /@state\s*\{([\s\S]*?)\n\}/.exec(src)?.[1] ?? ''
      const code = state.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      expect(
        code,
        `${name} calls customElements.define from @state — it can never run`,
      ).not.toMatch(/customElements\s*\.\s*define/)
      expect(
        code,
        `${name} constructs its own CSSStyleSheet — the compiler already does`,
      ).not.toMatch(/new\s+CSSStyleSheet/)
      expect(code, `${name} assigns adoptedStyleSheets — the compiler already does`).not.toMatch(
        /adoptedStyleSheets/,
      )
    })
  }
})
