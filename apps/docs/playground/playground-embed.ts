/**
 * <playground-embed> — the interactive .aihu playground.
 *
 * Ported from `apps/docs/playground/` (Directive 1, `docs/roadmap/
 * _user-directives.md`) so the docs-next → docs promotion keeps the
 * "Edit. Compile. Inspect. All in your browser" capability. The element
 * splits a CodeMirror source editor on the left from a sandboxed
 * live-preview iframe on the right; the WASM-built `aihu-compile` compiles
 * the user's source on every (debounced) edit and executes the compiled
 * component in the iframe.
 *
 * Acceptance criteria (Directive 1 §2-§3):
 *   - Compile latency < 200ms p50 for a 50-line `.aihu` fixture.
 *   - Initial JS bundle < 1 MB (CodeMirror + WASM are lazy chunks).
 *
 * Attributes:
 *   initial-source — starter source displayed in the editor on mount.
 *
 * SSR NOTE: this module defines custom-element classes at module scope
 * (`class … extends HTMLElement`), so it MUST NOT be imported statically
 * from a page's `@state` block — the docs app is an `output: 'static'` app and
 * the prerender pass would evaluate it under Node, where `HTMLElement` is
 * undefined. `/playground` imports it dynamically inside `onMount`, the same
 * island convention `search-box.aihu` uses, which also keeps CodeMirror and
 * `typescript` out of every other route's bundle.
 *
 * The WASM bundle is staged into `public/wasm/` before `vite build` by
 * `apps/docs/scripts/stage-wasm.ts` from `@aihu/compiler-wasm`
 * (version-pinned alongside `@aihu/compiler`); Vite copies `public/` to the
 * dist root verbatim. If the
 * bundle is unavailable (no wasm toolchain and no release), the playground
 * renders a clear fallback message.
 *
 * The preview iframe uses `sandbox="allow-scripts"` (no allow-same-origin).
 * Each compile resets `iframe.srcdoc` to a fresh HTML document containing:
 *   1. The aihu runtime IIFE (window.__aihu = { branch, leaf, … })
 *   2. The compiled component JS (with @aihu imports stripped and types erased)
 *   3. An <aihu-component> element mounted into a #root div
 *
 * Spec: docs/roadmap/_user-directives.md §Directive 1.
 */

import './code-editor.ts'
import { DEFAULT_PRESET_ID, getPreset, PRESETS } from './presets.ts'

const DEFAULT_SOURCE = getPreset(DEFAULT_PRESET_ID)?.source ?? PRESETS[0]!.source

/**
 * `typescript` is ~1 MB gzipped — importing it statically blows the docs
 * client-bundle budget (40 KB) even though only the playground page ever
 * calls `stripTs`. Load it as its own chunk, on demand, the first time a
 * preview actually renders.
 */
let stripTsPromise: Promise<typeof import('./strip-ts.ts')['stripTs']> | null = null
function loadStripTs(): Promise<typeof import('./strip-ts.ts')['stripTs']> {
  stripTsPromise ??= import('./strip-ts.ts').then((m) => m.stripTs)
  return stripTsPromise
}

/**
 * Upper bound for the auto-grow iframe height (Layer B). Matches the
 * `.playground` clamp max so a runaway preview document can't grow the
 * embed unbounded; beyond this the iframe's own document scrolls.
 */
const MAX_PREVIEW_HEIGHT = 720

const HOST_STYLES = `
:host {
  display: block;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg, #fff);
  color: var(--fg, #1a1a1a);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.playground {
  display: grid;
  grid-template-columns: 1fr 1fr;
  height: clamp(360px, 70vh, 720px);
  min-height: 0;
}
.pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.editor-pane { border-right: 1px solid var(--border, #e2e8f0); }
.pane > header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border, #e2e8f0);
  background: var(--code-bg, #f6f8fa);
  font-size: 12px;
  font-family: ui-monospace, Menlo, Consolas, monospace;
}
.label { color: var(--muted, #666); }
.latency {
  font-variant-numeric: tabular-nums;
  color: var(--accent, #7c3aed);
  font-weight: 600;
}
.latency.over-budget { color: #d97706; }
.presets {
  display: flex;
  gap: 2px;
  align-items: center;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border, #e2e8f0);
  background: var(--bg, #fff);
  overflow-x: auto;
}
.preset-tab {
  flex: 0 0 auto;
  padding: 4px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--muted, #666);
  font-size: 12px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  cursor: pointer;
  transition: background 0.1s ease, color 0.1s ease, border-color 0.1s ease;
}
.preset-tab:hover {
  background: var(--hover-bg, #f1f5f9);
  color: var(--fg, #1a1a1a);
}
.preset-tab[aria-pressed="true"] {
  background: var(--accent, #7c3aed);
  color: #fff;
  border-color: var(--accent, #7c3aed);
}
.preset-select {
  display: none;
  flex: 1;
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 6px;
  background: var(--bg, #fff);
  color: var(--fg, #1a1a1a);
  font-family: inherit;
}
.reset-btn {
  margin-left: auto;
  padding: 4px 8px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 6px;
  background: var(--bg, #fff);
  color: var(--muted, #666);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}
.reset-btn:hover { color: var(--fg, #1a1a1a); }
.reset-btn[hidden] { display: none; }
.editor-host { flex: 1; min-height: 0; min-width: 0; display: flex; overflow: hidden; }
code-editor { flex: 1; min-width: 0; }
.error {
  margin: 0;
  padding: 8px 12px;
  background: #fef2f2;
  color: #b91c1c;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  border-top: 1px solid #fecaca;
  max-height: 160px;
  overflow: auto;
}
iframe {
  flex: 1;
  width: 100%;
  min-height: 0;
  height: 100%;
  border: 0;
  background: #fff;
}
@media (max-width: 768px) {
  .playground {
    grid-template-columns: 1fr;
    /* Single-column stacks editor + preview; a fixed clamped height would
       compress both panes. Let the grid auto-size and give it a generous
       floor so each stacked pane keeps usable height (~300px+). */
    height: auto;
    min-height: clamp(360px, 140vh, 1200px);
  }
  .editor-pane { border-right: 0; border-bottom: 1px solid var(--border, #e2e8f0); }
}
@media (max-width: 640px) {
  .preset-tab { display: none; }
  .preset-select { display: block; }
}
`

interface CompileResult {
  js: string
  manifest_json: string
  route_json?: string | null
}

interface WasmModule {
  default: (
    input?: string | URL | Request | { module_or_path: string | URL | Request },
  ) => Promise<unknown>
  wasm_compile: (source: string) => CompileResult
  wasm_version: () => string
}

let wasmPromise: Promise<WasmModule | null> | null = null
let bundlePromise: Promise<string | null> | null = null

/**
 * Both assets are staged into `public/`, which Vite copies to the dist ROOT —
 * so they are always served from `/wasm/` and `/aihu-preview-bundle.js`
 * regardless of which route embeds this element.
 *
 * PORT NOTE: apps/docs used a document-RELATIVE `./wasm/` because it was a
 * single-page, hash-routed SPA served at the site root, where `./` was always
 * the root. the docs app is a file-routed SSG app: `/playground` prerenders to
 * `playground/index.html`, which Pages serves at BOTH `/playground` and
 * `/playground/`. Under the trailing-slash form `./wasm/` would resolve to
 * `/playground/wasm/` and 404 (falling back to the "WASM unavailable" notice),
 * so the defaults are root-absolute here. `data-wasm-base` still overrides.
 */
function wasmBaseUrl(host: PlaygroundEmbed): string {
  const override = host.getAttribute('data-wasm-base')
  if (override) return override.replace(/\/?$/, '/')
  return '/wasm/'
}

function bundleUrl(host: PlaygroundEmbed): string {
  // Bundle lives at the site root, one level above the wasm/ subdir.
  return `${wasmBaseUrl(host).replace(/wasm\/$/, '')}aihu-preview-bundle.js`
}

async function loadWasm(host: PlaygroundEmbed): Promise<WasmModule | null> {
  if (wasmPromise) return wasmPromise
  wasmPromise = (async () => {
    const base = wasmBaseUrl(host)
    try {
      const probe = await fetch(`${base}aihu_compiler.js`, { method: 'HEAD' })
      const ct = probe.headers.get('content-type') ?? ''
      if (!probe.ok || ct.includes('text/html')) return null
    } catch {
      return null
    }
    try {
      const mod = (await import(/* @vite-ignore */ `${base}aihu_compiler.js`)) as WasmModule
      await mod.default({ module_or_path: `${base}aihu_compiler_bg.wasm` })
      return mod
    } catch (err) {
      console.warn('[playground-embed] WASM load failed:', err)
      return null
    }
  })()
  return wasmPromise
}

async function loadBundle(host: PlaygroundEmbed): Promise<string | null> {
  if (bundlePromise) return bundlePromise
  bundlePromise = (async () => {
    try {
      const res = await fetch(bundleUrl(host))
      if (!res.ok) return null
      const ct = res.headers.get('content-type') ?? ''
      // Cloudflare Pages serves index.html for unknown paths in SPA mode.
      if (ct.includes('text/html')) return null
      return await res.text()
    } catch {
      return null
    }
  })()
  return bundlePromise
}

/**
 * Strip TypeScript-specific syntax from WASM compiler output so the JS is
 * valid for `eval`/script execution in a browser context.
 *
 * The compiler emits these TS-specific constructs:
 *   - `import type { Signal }` lines (type-only imports)
 *   - `as` type assertions, in three shapes: ` as ShadowRoot` (style-injection
 *     setup line), ` as any` (template expression reading a member off a value
 *     the compiler cannot type — `aihu-tabs` lowers `{selected.content}` to
 *     `leaf([() => (selected() as any).content, …])`), and the ` as unknown as
 *     <Type>` double-cast inside leaf()/binding calls, where <Type> is
 *     `Signal<string>` for plain signal leaves but `string`/`number` for
 *     computed leaves and `setTimeout` handles. One rule covers all three:
 *     an optional `unknown as` hop followed by a single type REFERENCE.
 *     Bounding the match to a type reference matters — the earlier
 *     `[^,;)\n]+` form was greedy across `}`, so `setTimeout(…, 300) as
 *     unknown as number });` in `search-debounce` lost the arrow body's
 *     closing brace and the script stopped parsing.
 *   - Parameter type annotations on the `function` declarations that `action()`
 *     lowers to — `function onInput(e: Event)` (`form-validation`),
 *     `function setTheme(t: 'light' | 'dark')` (`theme-toggle`). Nothing
 *     stripped these, so the whole `<script>` was a SyntaxError and the preview
 *     came up empty with no catchable error. See stripParamAnnotations.
 *   - `export const __agentBinding = {…}` from an `@agent` block. The preview
 *     runs the compiled code inside a non-module `<script>` IIFE, where an ESM
 *     `export` is a SyntaxError — the whole script fails to parse and nothing
 *     renders (the `agent-block` preset). The binding is unused in the
 *     standalone preview, so drop the `export` keyword (keep the harmless const).
 * All `import … from '@aihu/*'` lines are stripped because those packages are
 * already available via window.__aihu in the preview iframe.
 */

/**
 * Build the full srcdoc HTML for the preview iframe.
 *
 * Structure:
 *   1. IIFE bundle sets window.__aihu = { branch, leaf, signal, … }
 *   2. Wrapper script: destructs __aihu, wires _setMount/_setSignal,
 *      executes the compiled user code, then appends <aihu-component>.
 *   3. Errors are caught and rendered as a styled pre inside #root.
 *
 * The `</script>` sequence is escaped in both bundle and user code to
 * prevent premature HTML tag closure.
 *
 * A trailing height-handshake script (Layer B) observes the document and
 * posts `{type:'pe-height',height}` to the parent so the host iframe can
 * auto-grow to fit the rendered preview instead of clipping/scrolling. The
 * iframe is `sandbox="allow-scripts"` WITHOUT `allow-same-origin`, so
 * postMessage is the only channel and the parent validates by
 * `event.source`, not origin (origin is the literal string "null").
 */
const HEIGHT_HANDSHAKE_SCRIPT = [
  '(function(){',
  'function post(){',
  'try{',
  'var de=document.documentElement;',
  'var h=Math.max(de.scrollHeight, document.body?document.body.scrollHeight:0);',
  "parent.postMessage({type:'pe-height',height:h},'*');",
  '}catch(e){}',
  '}',
  'if(typeof ResizeObserver!=="undefined"){',
  'var ro=new ResizeObserver(function(){post();});',
  'ro.observe(document.documentElement);',
  'if(document.body)ro.observe(document.body);',
  '}',
  'window.addEventListener("load",post);',
  'post();',
  '})();',
].join('')

function buildPreviewDoc(bundle: string, userJs: string): string {
  const safeBundle = bundle.replace(/<\/script>/gi, '<\\/script>')
  const safeUserJs = userJs.replace(/<\/script>/gi, '<\\/script>')
  return [
    '<!DOCTYPE html><html><head>',
    '<meta charset="utf-8">',
    '<style>',
    'html,body{margin:0;padding:0;font-family:system-ui,sans-serif}',
    'body{padding:1rem}',
    '.pe-error{color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:12px;font-family:ui-monospace,monospace;font-size:12px;white-space:pre-wrap;margin:0}',
    '</style></head><body>',
    '<div id="root"></div>',
    '<script>',
    safeBundle,
    '</script>',
    '<script>',
    '(function(){',
    'try{',
    'var _a=window.__aihu;',
    'var branch=_a.branch,leaf=_a.leaf,mount=_a.mount,slot=_a.slot,when=_a.when,each=_a.each;',
    'var signal=_a.signal,computed=_a.computed,effect=_a.effect,batch=_a.batch;',
    'var defineComponent=_a.defineComponent,defineElement=_a.defineElement;',
    'var _setMount=_a._setMount,_setSignal=_a._setSignal;',
    'var onMount=_a.onMount,onCleanup=_a.onCleanup,onAdopt=_a.onAdopt,onAttributeChange=_a.onAttributeChange;',
    // Presets carrying an @agent surface (expose/describe) compile to
    // registerAgentMetadata() + _registerAgentServerBinding() calls, and
    // @context presets compile to contextKey/provide/inject. None of these
    // were destructured, so such a preset died with "<sym> is not defined"
    // (the agent-weather preset). Keep this list in sync with
    // preview-runtime.ts — the union of every symbol a compiled preset can
    // reference is what has to be in scope here.
    'var registerAgentMetadata=_a.registerAgentMetadata,_registerAgentServerBinding=_a._registerAgentServerBinding;',
    'var contextKey=_a.contextKey,provide=_a.provide,inject=_a.inject;',
    '_setMount(mount);_setSignal(signal);',
    safeUserJs,
    'var c=document.createElement("aihu-component");',
    'document.getElementById("root").appendChild(c);',
    '}catch(e){',
    'var p=document.createElement("pre");',
    'p.className="pe-error";',
    'p.textContent=String(e);',
    'document.getElementById("root").appendChild(p);',
    '}',
    '})();',
    '</script>',
    '<script>',
    HEIGHT_HANDSHAKE_SCRIPT,
    '</script>',
    '</body></html>',
  ].join('')
}

/**
 * Parse `location.search` into a preset id or arbitrary source.
 *
 * Supported query forms:
 *   ?preset=<id>            — load a named preset
 *   ?src=<encodeURIComponent(source)> — load arbitrary source
 *
 * Uses the query string (not the hash) so the hash stays free for in-page
 * anchors — in the docs app the router owns `location.pathname` and the hash
 * addresses headings within a page (`/examples#playground`).
 *
 * Returns null if no recognized param is present (caller falls back to default).
 */
function readHash(): { presetId: string; source: string } | null {
  if (typeof location === 'undefined') return null
  const params = new URLSearchParams(location.search)
  const presetId = params.get('preset')
  if (presetId) {
    const preset = getPreset(presetId)
    if (preset) return { presetId, source: preset.source }
  }
  const src = params.get('src')
  if (src) {
    // URLSearchParams already decoded once. The raw value is the source.
    return { presetId: '', source: src }
  }
  return null
}

/**
 * Write the playground state to `location.search` without triggering navigation.
 *
 * Active preset (unmodified) → `?preset=<id>` (omitted when id === default)
 * Diverged draft            → `?src=<encodeURIComponent(source)>`
 * Preserves the current pathname + hash so the router and in-page anchors
 * keep working.
 */
function writeHash(presetId: string, source: string): void {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(location.search)
  params.delete('preset')
  params.delete('src')
  if (presetId) {
    if (presetId !== DEFAULT_PRESET_ID) params.set('preset', presetId)
  } else {
    // URLSearchParams handles encoding; passing raw source avoids double-encode.
    params.set('src', source)
  }
  const query = params.toString()
  const next = `${location.pathname}${query ? `?${query}` : ''}${location.hash}`
  history.replaceState(null, '', next)
}

export class PlaygroundEmbed extends HTMLElement {
  static get observedAttributes(): readonly string[] {
    return ['initial-source']
  }

  private root: ShadowRoot
  private editor!: HTMLElement & { value: string }
  private iframe!: HTMLIFrameElement
  private latencyEl!: HTMLSpanElement
  private errorEl!: HTMLPreElement
  private presetBar!: HTMLDivElement
  private presetSelect!: HTMLSelectElement
  private resetBtn!: HTMLButtonElement
  private wasm: WasmModule | null = null
  private bundle: string | null = null
  private wasmReady = false
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private source = DEFAULT_SOURCE
  private activePresetId: string = DEFAULT_PRESET_ID
  private readonly onMessage = (ev: MessageEvent): void => this.handlePreviewMessage(ev)

  constructor() {
    super()
    this.root = this.attachShadow({ mode: 'open' })
  }

  connectedCallback(): void {
    if (this.hasAttribute('initial-source')) {
      this.source = this.getAttribute('initial-source') ?? DEFAULT_SOURCE
      this.activePresetId = ''
    } else if (this.hasAttribute('initialSource')) {
      this.source = this.getAttribute('initialSource') ?? DEFAULT_SOURCE
      this.activePresetId = ''
    } else if (typeof window !== 'undefined') {
      const fromHash = readHash()
      if (fromHash) {
        this.source = fromHash.source
        this.activePresetId = fromHash.presetId
      }
    }
    this.render()
    // Layer B: listen for height-handshake messages posted by the preview
    // iframe so it can auto-grow to fit rendered output. Removed in
    // disconnectedCallback to avoid leaking listeners across mount/unmount.
    window.addEventListener('message', this.onMessage)
    void this.boot()
  }

  attributeChangedCallback(name: string, _old: string | null, next: string | null): void {
    if (name === 'initial-source' && next !== null && this.editor) {
      this.source = next
      this.activePresetId = ''
      this.editor.value = next
      this.updatePresetUI()
    }
  }

  private render(): void {
    const style = document.createElement('style')
    style.textContent = HOST_STYLES
    this.root.appendChild(style)

    const playground = document.createElement('div')
    playground.className = 'playground'

    // Editor pane
    const editorPane = document.createElement('div')
    editorPane.className = 'pane editor-pane'

    const editorHeader = document.createElement('header')
    const editorLabel = document.createElement('span')
    editorLabel.className = 'label'
    editorLabel.textContent = '.aihu source'
    this.latencyEl = document.createElement('span')
    this.latencyEl.className = 'latency'
    this.latencyEl.hidden = true
    editorHeader.append(editorLabel, this.latencyEl)
    editorPane.appendChild(editorHeader)

    // Preset selector bar (segmented control + mobile dropdown + reset)
    this.presetBar = document.createElement('div')
    this.presetBar.className = 'presets'
    this.presetBar.setAttribute('role', 'tablist')
    this.presetBar.setAttribute('aria-label', 'Preset snippets')
    for (const preset of PRESETS) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'preset-tab'
      btn.dataset.presetId = preset.id
      btn.textContent = preset.label
      btn.setAttribute('role', 'tab')
      btn.setAttribute('aria-pressed', String(preset.id === this.activePresetId))
      btn.addEventListener('click', () => this.selectPreset(preset.id))
      this.presetBar.appendChild(btn)
    }
    this.presetSelect = document.createElement('select')
    this.presetSelect.className = 'preset-select'
    this.presetSelect.setAttribute('aria-label', 'Preset snippet')
    for (const preset of PRESETS) {
      const opt = document.createElement('option')
      opt.value = preset.id
      opt.textContent = preset.label
      if (preset.id === this.activePresetId) opt.selected = true
      this.presetSelect.appendChild(opt)
    }
    this.presetSelect.addEventListener('change', () => {
      this.selectPreset(this.presetSelect.value)
    })
    this.presetBar.appendChild(this.presetSelect)
    this.resetBtn = document.createElement('button')
    this.resetBtn.type = 'button'
    this.resetBtn.className = 'reset-btn'
    this.resetBtn.textContent = 'Reset'
    this.resetBtn.title = 'Restore the active preset source'
    this.resetBtn.hidden = true
    this.resetBtn.addEventListener('click', () => this.resetToPreset())
    this.presetBar.appendChild(this.resetBtn)
    editorPane.appendChild(this.presetBar)

    const editorHost = document.createElement('div')
    editorHost.className = 'editor-host'
    this.editor = document.createElement('code-editor') as HTMLElement & { value: string }
    this.editor.setAttribute('value', this.source)
    this.editor.addEventListener('change', (ev) => {
      const detail = (ev as CustomEvent<{ value: string }>).detail
      this.onSourceChange(detail.value)
    })
    editorHost.appendChild(this.editor)
    editorPane.appendChild(editorHost)

    this.errorEl = document.createElement('pre')
    this.errorEl.className = 'error'
    this.errorEl.hidden = true
    editorPane.appendChild(this.errorEl)

    playground.appendChild(editorPane)

    // Preview pane
    const previewPane = document.createElement('div')
    previewPane.className = 'pane preview-pane'

    const previewHeader = document.createElement('header')
    const previewLabel = document.createElement('span')
    previewLabel.className = 'label'
    previewLabel.textContent = 'preview'
    previewHeader.appendChild(previewLabel)
    previewPane.appendChild(previewHeader)

    this.iframe = document.createElement('iframe')
    this.iframe.setAttribute('sandbox', 'allow-scripts')
    this.iframe.setAttribute('title', 'aihu playground preview')
    previewPane.appendChild(this.iframe)

    playground.appendChild(previewPane)
    this.root.appendChild(playground)
  }

  private async boot(): Promise<void> {
    const [mod, bundle] = await Promise.all([loadWasm(this), loadBundle(this)])
    if (mod === null) {
      this.setError(
        'WASM bundle unavailable. Install dependencies with the matching @aihu/compiler-wasm release, then rebuild the docs app (bun run prebuild).',
      )
      return
    }
    this.wasm = mod
    this.bundle = bundle
    this.wasmReady = true
    this.compile(this.source)
  }

  private onSourceChange(value: string): void {
    this.source = value
    // If the new value matches the active preset verbatim, stay on the preset.
    // Otherwise the user has a divergent draft — switch URL to #src= form.
    const active = this.activePresetId ? getPreset(this.activePresetId) : undefined
    if (!active || active.source !== value) {
      this.activePresetId = ''
      this.updatePresetUI()
    }
    writeHash(this.activePresetId, value)
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => this.compile(value), 250)
  }

  private selectPreset(id: string): void {
    const preset = getPreset(id)
    if (!preset) return
    this.activePresetId = id
    this.source = preset.source
    this.editor.value = preset.source
    this.updatePresetUI()
    writeHash(id, preset.source)
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.compile(preset.source)
  }

  private resetToPreset(): void {
    // If no active preset, default back to the canonical first preset.
    const targetId = this.activePresetId || DEFAULT_PRESET_ID
    this.selectPreset(targetId)
  }

  private updatePresetUI(): void {
    if (!this.presetBar) return
    const tabs = this.presetBar.querySelectorAll<HTMLButtonElement>('.preset-tab')
    tabs.forEach((tab) => {
      const pressed = tab.dataset.presetId === this.activePresetId
      tab.setAttribute('aria-pressed', String(pressed))
    })
    if (this.presetSelect) {
      this.presetSelect.value = this.activePresetId || ''
    }
    if (this.resetBtn) {
      this.resetBtn.hidden = this.activePresetId !== ''
    }
  }

  private compile(source: string): void {
    if (!this.wasmReady || !this.wasm) return
    try {
      const start = performance.now()
      const result = this.wasm.wasm_compile(source)
      const elapsed = performance.now() - start
      this.setLatency(elapsed)
      this.setError(null)
      void this.postRender(result.js)
    } catch (err) {
      this.setError(err instanceof Error ? err.message : String(err))
    }
  }

  private async postRender(js: string): Promise<void> {
    if (!this.bundle) {
      // Bundle not available: show compiled JS as text fallback. This doc
      // ships no height handshake, so the iframe must fill+scroll its pane.
      this.iframe.style.height = '100%'
      const safeJs = js.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      this.iframe.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>pre{margin:0;padding:8px;font-family:monospace;font-size:12px;white-space:pre-wrap}</style></head><body><pre>${safeJs}</pre></body></html>`
      return
    }
    const stripTs = await loadStripTs()
    const processed = stripTs(js)
    this.iframe.srcdoc = buildPreviewDoc(this.bundle, processed)
  }

  /**
   * Layer B handler: apply the height posted by the preview iframe so the
   * frame auto-grows to fit its rendered content (no clipping).
   *
   * The iframe is `sandbox="allow-scripts"` WITHOUT `allow-same-origin`, so
   * `event.origin` is the literal string "null" and cannot be validated;
   * the message is validated by `event.source === this.iframe.contentWindow`
   * instead. The applied height is clamped to MAX_PREVIEW_HEIGHT (matching
   * the `.playground` max) so a runaway document can't grow the embed
   * unbounded — beyond the cap the iframe's own document scrolls.
   */
  private handlePreviewMessage(ev: MessageEvent): void {
    if (!this.iframe || ev.source !== this.iframe.contentWindow) return
    const data = ev.data as { type?: unknown; height?: unknown } | null
    if (!data || data.type !== 'pe-height') return
    const height = Number(data.height)
    if (!Number.isFinite(height) || height <= 0) return
    // When Layer B drives height, switch the iframe from `height:100%` to an
    // explicit pixel height; the `.playground` clamp still bounds the worst case.
    this.iframe.style.height = `${Math.min(height, MAX_PREVIEW_HEIGHT)}px`
  }

  private setLatency(ms: number): void {
    this.latencyEl.hidden = false
    this.latencyEl.textContent = `${ms.toFixed(0)}ms`
    this.latencyEl.classList.toggle('over-budget', ms >= 200)
  }

  private setError(msg: string | null): void {
    if (msg === null) {
      this.errorEl.hidden = true
      this.errorEl.textContent = ''
    } else {
      this.errorEl.hidden = false
      this.errorEl.textContent = msg
    }
  }

  disconnectedCallback(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    window.removeEventListener('message', this.onMessage)
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('playground-embed')) {
  customElements.define('playground-embed', PlaygroundEmbed)
}
