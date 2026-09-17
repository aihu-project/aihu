/**
 * Theme rendering (Plan 6 / master spec §10.1): a `pack` × `mode` toolbar.
 *
 *  - `pack`  — which style pack's `:root { --color-*, ... }` token CSS is
 *    active (aihu-default | aihu-graphite). Swapped live via a single
 *    <style id="aihu-style-pack"> element in <head>.
 *  - `mode`  — light | dark. The engine's dark-cascade variant emits DUAL
 *    selectors (`:host([data-theme="dark"]) …, :root.dark …` — see
 *    css-engine emit.rs), so the decorator drives BOTH consumer flags:
 *    `.dark` on documentElement (light-DOM / pack `.dark` overrides) and
 *    `data-theme="dark"` stamped on every custom-element host in the canvas.
 *
 * Pack-swap and dark token overrides reach shadow-DOM recipe internals: scoped
 * compile writes default tokens as `var()` fallbacks (`var(--color-*, <literal>)`)
 * rather than a `:host { … }` block, so the document-level pack tokens swapped
 * here are inherited into every shadow root (#836).
 *
 * Chromatic modes (spec §10.1 matrix): every story snapshots under the four
 * global pack × mode combinations. Per-story `viewports`/`modes` overrides are
 * deliberately ABSENT: Chromatic rejects mixing legacy `viewports` with
 * `modes`, and Storybook's deep parameter merge makes story-level `modes`
 * additive (not a pin). The spec's mobile-viewport axis comes later as
 * additional `{ viewport: … }` modes once the snapshot budget is confirmed.
 */

// Vite inlines the pack CSS (exported package subpaths).
// @ts-expect-error — ?inline is a Vite asset query, invisible to tsc.
import defaultPack from '@aihu/css-engine/styles/aihu-default.css?inline'
// @ts-expect-error — ?inline is a Vite asset query, invisible to tsc.
import graphitePack from '@aihu/css-engine/styles/aihu-graphite.css?inline'
import type { Preview } from '@storybook/web-components-vite'

const PACKS: Record<string, string> = {
  'aihu-default': defaultPack as string,
  'aihu-graphite': graphitePack as string,
}

function applyTheme(pack: string, mode: string): void {
  let el = document.getElementById('aihu-style-pack') as HTMLStyleElement | null
  if (el === null) {
    el = document.createElement('style')
    el.id = 'aihu-style-pack'
    document.head.append(el)
  }
  el.textContent = PACKS[pack] ?? PACKS['aihu-default']
  document.documentElement.classList.toggle('dark', mode === 'dark')
  // Make the active pack + mode visible on the canvas itself.
  document.documentElement.style.backgroundColor = 'var(--color-background)'
  document.documentElement.style.color = 'var(--color-foreground)'
  document.body.style.backgroundColor = 'var(--color-background)'
  document.body.style.color = 'var(--color-foreground)'
}

/** Shadow components gate dark rules on `:host([data-theme="dark"])` — stamp
 * every custom-element host in the rendered canvas. */
function stampHosts(root: HTMLElement | null, mode: string): void {
  if (root === null) return
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    if (!el.tagName.includes('-')) continue
    if (mode === 'dark') el.setAttribute('data-theme', 'dark')
    else el.removeAttribute('data-theme')
  }
}

const preview: Preview = {
  globalTypes: {
    pack: {
      description: 'aihu style pack',
      toolbar: {
        title: 'Pack',
        icon: 'paintbrush',
        items: ['aihu-default', 'aihu-graphite'],
        dynamicTitle: true,
      },
    },
    mode: {
      description: 'Theme mode',
      toolbar: {
        title: 'Mode',
        icon: 'circlehollow',
        items: ['light', 'dark'],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { pack: 'aihu-default', mode: 'light' },
  decorators: [
    (story, ctx) => {
      const pack = (ctx.globals.pack as string) ?? 'aihu-default'
      const mode = (ctx.globals.mode as string) ?? 'light'
      applyTheme(pack, mode)
      const result = story()
      // String renders land via innerHTML after the decorator returns — stamp
      // hosts on the next frame, once the canvas DOM exists.
      requestAnimationFrame(() => stampHosts(ctx.canvasElement as HTMLElement, mode))
      return result
    },
  ],
  parameters: {
    // Spec §10.3: axe violations block merge — fail the story, not just warn.
    a11y: { test: 'error' },
    // Spec §10.1 matrix: pack × mode (see header note on viewports).
    chromatic: {
      modes: {
        'default-light': { pack: 'aihu-default', mode: 'light' },
        'default-dark': { pack: 'aihu-default', mode: 'dark' },
        'graphite-light': { pack: 'aihu-graphite', mode: 'light' },
        'graphite-dark': { pack: 'aihu-graphite', mode: 'dark' },
      },
    },
  },
}

export default preview
