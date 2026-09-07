/**
 * @aihu/compiler — TypeScript wrapper around the aihu-compile Rust binary.
 *
 * Exports:
 *   transform(source, id)    — compile a single .aihu file to TypeScript
 *   aihuCompilerPlugin()   — Vite plugin that wires transform() into the build
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { _backendStampPath, _compileViaBackend } from './envelope.ts'
import { resolveCompilerBinary } from './resolve-binary.ts'
import { compileSpawnBounds, describeSpawnFailure } from './spawn-bounds.ts'
import { _memoizedSpawn, _seedMemo } from './transform-memo.ts'

export type { CompileEnvelope, CompileEnvelopeOptions } from './envelope.ts'

// Perf — in-process napi compile backend + single-parse envelope (see
// js/envelope.ts and js/native.ts). `transform()` / `compileToAst()` /
// `compileRouteMeta()` route memo → native addon → envelope CLI spawn →
// legacy per-output spawn. Re-exported as internals for tests/diagnostics.
export {
  _compileViaBackend,
  _resetCompileBackend,
  _resolveCompileBackend,
} from './envelope.ts'
export { _getCompilerNativeStateKind, _resetCompilerNative, loadCompilerNative } from './native.ts'
// Perf — content-addressed memo over the compile spawns (see transform-memo.ts).
// The SSG prerender re-runs every transform against a second Vite server with
// identical inputs; the memo turns that whole second pass (and css-engine's
// per-file `compileToAst` re-parse) into cache lookups instead of subprocess
// spawns. Re-exported as internals so tests can reset/observe the cache.
export {
  _clearTransformMemo,
  _MEMO_MAX_ENTRIES,
  _transformMemoStats,
} from './transform-memo.ts'

// Binary resolution: env var override, then the per-platform optionalDependency
// package (`@aihu/compiler-<platform>`) with a workspace `target/` dev fallback —
// see js/resolve-binary.ts (a clone of css-engine's resolver). The published
// @aihu/compiler tarball ships only the JS shim (bin/aihu-compile.mjs); the
// native binary arrives via the optionalDependency packages, so there is no
// `../bin/aihu-compile` relative path anymore.
//
// Bug 6 fix — resolveBinPath() is CALL-TIME, not module-load-time. The Vite
// plugin's `_maybeCompileUtilityCss` sets `process.env.AIHU_COMPILE_BIN` so
// that css-engine's bundled copy of `compileToAst` spawns THIS compiler's
// binary. Prior to this fix `binPath` was a module-scope const captured at
// import time, so the env-var assignment was always too late and `compileSfc`
// failed with ENOENT. Re-reading on every call is essentially free (an env
// lookup, then a memoized resolve) and makes the AIHU_COMPILE_BIN handshake
// actually work.
function resolveBinPath(): string {
  return process.env.AIHU_COMPILE_BIN ?? resolveCompilerBinary()
}

/*
 * ── Regex hardening: js/polynomial-redos (CWE-1333) ─────────────────────────
 *
 * Most of the regexes in this file run against COMPILED MODULE TEXT, and that
 * text carries authored `.aihu` bytes verbatim: a template text node becomes
 * `leaf('<text>')` (codegen/template_emit.rs) and an `@style` body becomes
 * ``__style__.replaceSync(`<css>`)`` (codegen/emit.rs). So the strings these
 * patterns scan ARE attacker-controllable by whoever authors the `.aihu` file
 * — an untrusted PR in a monorepo, a template shipped to other developers.
 * Treat them as untrusted input, not as our own generated output.
 *
 * Three ambiguity shapes were live in this file (17 CodeQL alerts), all
 * polynomial rather than exponential — the cost comes from re-scanning, not
 * from nested quantifiers:
 *
 *   A. Named-import matchers, `import\s*\{[^}]*\}\s*from '<mod>'`.
 *      `[^}]` does not exclude `{`, so every one of the N `import{` offsets in
 *      the subject restarts a scan that runs to the END of the string before
 *      failing → O(n²). Fixed by narrowing the specifier-list class to
 *      `[^{}]`, which bounds each scan to the next brace. An ES import
 *      specifier list can never contain `{`, so no legitimate input changes
 *      meaning — the class is strictly more correct as well as safer.
 *      (Measured: 224 KB of `import{` took 2.45 s before, 0.7 ms after.)
 *
 *   B. Literal prefix + lazy any-char scan, e.g.
 *      ``/(__style__\.replaceSync\(`)[^]*?(`\);)/``. Repeating the prefix
 *      gives N start offsets, each running a fresh O(n) lazy scan → O(n²).
 *      A regex cannot express "first prefix, then first terminator" without
 *      that re-scan, so these are restructured into literal `indexOf` scans
 *      (`_replaceDelimitedBody`, `_passivizeOutlet`, `_hasBaseRecipe`). The
 *      rewrite is exactly equivalent: `String.replace` takes the LEFTMOST
 *      match, and if no terminator follows the first prefix then none follows
 *      any later prefix either — so "first prefix + first terminator after it"
 *      is the same span the regex produced.
 *
 *   C. Greedy `.*` between two literals (`/import.*from\s*'@aihu\/signals'/`).
 *      Same re-scan blowup, one start offset per `import` on the line. Fixed
 *      by anchoring to a line start (`^` + `m`), which caps the offsets at one
 *      per line and makes the total linear.
 *
 * Adjacent unbounded `\s*` runs (`\s*;?\s*$`) are a second, independent pump:
 * the two runs can split a whitespace tail O(n) ways when `$` never holds.
 * Rewritten as `(?:\s*;)?\s*$`, which matches exactly the same spans with an
 * unambiguous decomposition. And `^\s*` under the `m` flag is a third: `\s`
 * matches `\n`, so every line start can scan the whole remaining file →
 * narrowed to `[^\S\r\n]*` (horizontal indentation), which is what "the import
 * line" actually means.
 *
 * `packages/compiler/tests/regex-redos.test.ts` pins both halves: old-vs-new
 * output equality on every real compiled shape, and a wall-clock budget on the
 * adversarial inputs.
 */

// Minimal VitePlugin interface — avoids importing from 'vite' at compile time.
// Structurally compatible with Vite's Plugin type.
interface VitePlugin {
  readonly name: string
  enforce?: 'pre' | 'post'
  resolveId?: (
    source: string,
    importer?: string,
  ) => string | null | undefined | Promise<string | null | undefined>
  load?: (id: string) => string | null | undefined | Promise<string | null | undefined>
  transform?: (
    code: string,
    id: string,
  ) => Promise<{ code: string; map: null }> | { code: string; map: null } | null | undefined
  /** GX Phase 1 (#437-GX) — end-of-build hook; prints the extract census. */
  buildEnd?: (error?: Error) => void | Promise<void>
}

/**
 * Options for `aihuCompilerPlugin()` (Plan 3.3 — Islands).
 */
export interface AihuCompilerPluginOptions {
  /**
   * When `true` (default), components the compiler classified as `'static'`
   * (read from the `// @aihu:island` marker via `_parseIslandMarker()`) are
   * emitted with a minimal HTML-only registration shim that ships **zero**
   * `@aihu/runtime` and `@aihu/signals` JS to the browser. Components
   * classified as `'interactive'` retain the full runtime path.
   *
   * Setting `islands: false` opts every component back into the unified
   * runtime path (Plan 3.2 baseline behaviour).
   */
  islands?: boolean

  /**
   * Project-wide rendering mode applied to every `.aihu` SFC compiled
   * by this plugin instance. When set, the plugin post-processes the
   * compiled JS to inject `, { shadowMode: '<mode>' }` as the third arg
   * to the emitted `defineElement(tag, defineComponent(...))` call.
   *
   * BINARY vocabulary (DA4 #437):
   * - `'shadow'` — shadow DOM (`attachShadow({ mode: 'open' })` internally;
   *               open is the only browser mode aihu's composition/hydration
   *               can use). `this.shadowRoot` is the non-null root.
   * - `'light'`  — **no shadow root.** The component mounts into its own
   *               element (`this.shadowRoot === null`). Required for global
   *               utility-class CSS frameworks like Tailwind, UnoCSS, Pico
   *               that rely on the cascade.
   *
   * Per-file override: the `$shadow: 'light' | 'shadow'` macro outranks this
   * config. Unset, pages/layouts default to `'light'` and leaves to
   * `'shadow'`.
   */
  shadowMode?: 'light' | 'shadow'

  /**
   * Build target threaded to the compiler binary (`--target`). Defaults to the
   * compiler's `universal` target (current behaviour). Set to `'client'` for a
   * browser bundle that must NOT ship the server `__agentBinding` (policy) and
   * instead gets the policy-free `@agent` opaque-ID dispatcher + the per-instance
   * `_registerAgentDispatcher` wiring the capability bridge reads after mount.
   * See `examples/agent-driven-demo`.
   */
  target?: 'client' | 'server' | 'universal'

  /**
   * Directory (relative to the project root) holding layout SFCs. Default:
   * `'src/layouts'`. Files under this directory are compiled in **layout mode**:
   * their custom element is registered under the namespaced tag
   * `aihu-layout-<stem>` (a layout stem like `app` is not a valid custom-element
   * name on its own), and their `<outlet>` lowers to a **passive**
   * `data-aihu-outlet` marker rather than the reactive route-driven boundary —
   * because `@aihu/app`'s client renderer fills the marker imperatively and the
   * reactive boundary would otherwise clear it on mount.
   *
   * Kept in sync with `@aihu/router`'s `layoutTagFor()` (`virtual:aihu-layouts`).
   */
  layoutsDir?: string
}

/**
 * Find the `)` matching the `(` at `open`, skipping string literals
 * (`'…'`/`"…"` with `\` escapes), template literals (including nested
 * `${ … }` interpolations, tracked with a frame stack), and `//`/`/* *​/`
 * comments. Returns -1 when no match is found before end of input.
 *
 * Why a lexer and not a bare paren count: on the client/universal targets the
 * ENTIRE setup body is inlined inside `defineComponent((ctx) => { … })`, and
 * that body carries user template text as string literals — `leaf('(')` for a
 * `(` text node, `{ title: '(unclosed' }` for an attribute — so a count that
 * reads parens inside strings drifts and the caller silently bails, costing
 * the component its `shadowMode`/`lightScopeId` injection entirely.
 *
 * Known miss, accepted: a regex literal in user `@state` code containing an
 * unbalanced paren (`/\(/`) reads as division + parens. The caller validates
 * the landing site and bails to a no-op rather than corrupting.
 */
function _matchParen(code: string, open: number): number {
  // Frames: 'code' (with its own `{}` depth, so a `}` inside a template
  // interpolation knows whether it closes the interpolation) or 'tpl'.
  const frames: Array<{ kind: 'code'; brace: number } | { kind: 'tpl' }> = [
    { kind: 'code', brace: 0 },
  ]
  let paren = 0
  for (let i = open; i < code.length; i++) {
    const top = frames[frames.length - 1]
    // Unreachable: the root frame never pops (a code-frame `}` pops only when
    // `frames.length > 1`, a tpl frame pops only itself) — checker appeasement.
    if (top === undefined) return -1
    const c = code[i]
    if (top.kind === 'tpl') {
      if (c === '\\') i++
      else if (c === '`') frames.pop()
      else if (c === '$' && code[i + 1] === '{') {
        frames.push({ kind: 'code', brace: 0 })
        i++
      }
      continue
    }
    if (c === "'" || c === '"') {
      i++
      while (i < code.length && code[i] !== c) {
        if (code[i] === '\\') i++
        i++
      }
    } else if (c === '`') {
      frames.push({ kind: 'tpl' })
    } else if (c === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i++
    } else if (c === '/' && code[i + 1] === '*') {
      i += 2
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++
      i++
    } else if (c === '(') {
      paren++
    } else if (c === ')') {
      paren--
      if (paren === 0) return i
    } else if (c === '{') {
      top.brace++
    } else if (c === '}') {
      if (top.brace === 0 && frames.length > 1) frames.pop()
      else top.brace--
    }
  }
  return -1
}

/**
 * Inject `shadowMode: '...'` (and, for light mode, `lightScopeId: '...'` in
 * the SAME options object) into the third argument of the emitted
 * `defineElement('tag', defineComponent(...))` call — appending the options
 * object when the call has two arguments, or merging the fields into an
 * existing third argument (`$form` emits `, { formAssociated: true }`).
 * Idempotent — leaves code untouched when the call is not in a recognized
 * shape or the options already carry a `shadowMode`.
 *
 * `lightScopeId` is folded into this SAME injection rather than a second
 * independent pass, deliberately: it is only ever set when `mode === 'light'`
 * (see the call site, `index.ts`'s `transform` hook), so every call that
 * needs it ALSO needs a shadowMode injection at the exact same spot — a
 * second pass would just re-match (and fight) the text this one already
 * rewrote. Stamps `data-a` on the root element at runtime (light-DOM leaf
 * flip, LDF §10 step 3) — `packages/runtime/src/define-element.ts`'s
 * `wrapClass` reads `options.lightScopeId`.
 *
 * History, because this anchor has now been wrong twice:
 *
 * 1. The original regex anchor (`defineComponent\([^]*\)\s*\)` — greedy, and
 *    `[^]` crosses newlines) ran past `defineElement` and matched the LAST
 *    `)\s*)` pair in the module. On a SERVER-target module the string
 *    renderer (`__ssrString`) is emitted AFTER the registration, so for any
 *    component with an `if=` the last such pair is the emitted condition,
 *    which became `if ((n() > 5), { shadowMode: 'light', … })` — the comma
 *    operator, always truthy, so a dead branch rendered (the SSR-child
 *    review's 33-nested-hosts measurement). Same corruption landed inside
 *    `__aihu_stext(...)` calls (a `(` in text content) and, on ALL targets,
 *    inside `$form`'s `setFormValue(...)`. The repro was missed at first
 *    because the probe regex `/if \([^)]*shadowMode/` cannot cross the `)`
 *    in `(n() > 5)` — evidence in light-scope-export.test.ts.
 *
 * 2. The first replacement — a bare balanced-paren count — read parens inside
 *    string literals (`leaf('(')`), drifted, and silently bailed on
 *    client/universal modules, stripping the injection those components need.
 *    Hence `_matchParen`'s lexer, and the tests that pin every shape above.
 *
 * @internal
 */
export function _injectShadowMode(
  code: string,
  mode: 'light' | 'shadow',
  lightScopeId?: string,
): string {
  const head = /defineElement\(\s*['"][^'"]+['"]\s*,\s*defineComponent\(/.exec(code)
  if (head == null) return code
  // Index of the `(` that opens defineComponent's argument list.
  const open = head.index + head[0].length - 1
  const close = _matchParen(code, open)
  if (close === -1) return code
  const fields = `shadowMode: '${mode}'${lightScopeId ? `, lightScopeId: '${lightScopeId}'` : ''}`
  const rest = code.slice(close + 1)
  // Two-argument call: `defineComponent(...)` followed directly by
  // defineElement's own `)`. Append the options object.
  if (/^\s*\)/.test(rest)) {
    return `${code.slice(0, close + 1)}, { ${fields} }${rest}`
  }
  // Existing third argument (`$form`'s `, { formAssociated: true }`): merge
  // the fields into it — unless a shadowMode is already present (idempotency).
  const existing = /^\s*,\s*\{/.exec(rest)
  if (existing && !/^\s*,\s*\{[^}]*\bshadowMode\b/.test(rest)) {
    const braceEnd = close + 1 + existing[0].length
    return `${code.slice(0, braceEnd)} ${fields},${code.slice(braceEnd)}`
  }
  // Unrecognized landing site (or already injected) — no-op rather than guess.
  return code
}

/**
 * Fill the Rust codegen's `__AIHU_LIGHT_SCOPE_ID__` placeholder with the
 * component's real light-DOM scope id (LDF §10 step 3).
 *
 * The server-target string renderer (`emit.rs`, wave-3) emits
 * `const __AIHU_LIGHT_SCOPE_ID__: string | undefined = undefined;` and merges
 * it into `__ssrString`'s options (`opts.lightScopeId ?? __AIHU_LIGHT_SCOPE_ID__`)
 * so a compiled light-DOM component can stamp `data-a` on its own rendered
 * root with NO caller cooperation. Whether the component actually resolves to
 * light mode is only known here in the JS layer (same reason
 * `_injectShadowMode` exists), so Rust emits the placeholder and this helper
 * replaces the literal when the mode resolved to light — exactly the wiring
 * the Rust-side comment names. Idempotent: no placeholder (client target,
 * bailed string renderer) → code returned untouched.
 *
 * @internal
 */
export function _injectLightScopeId(code: string, lightScopeId: string): string {
  return code.replace(
    'const __AIHU_LIGHT_SCOPE_ID__: string | undefined = undefined',
    `const __AIHU_LIGHT_SCOPE_ID__: string | undefined = '${lightScopeId}'`,
  )
}

/**
 * Light-DOM (`shadowMode:'light'`) recipes: redirect the authored `@style`
 * block's per-instance `host.adoptedStyleSheets = [__style__]` assignment to
 * `document.adoptedStyleSheets` so the recipe's class-scoped CSS reaches the
 * global cascade (a light-DOM host has no shadow root, making the original
 * setter a silent no-op). The module-level `__style__` is shared across
 * instances; the `includes` guard keeps the global adoption idempotent.
 *
 * @internal
 */
export function _globalizeAuthoredStyle(code: string): string {
  // The Rust codegen emits exactly: `(ctx.host as ShadowRoot).adoptedStyleSheets = [__style__];`
  const re = /\(ctx\.host as ShadowRoot\)\.adoptedStyleSheets\s*=\s*\[__style__\];?/
  return code.replace(
    re,
    'if (!document.adoptedStyleSheets.includes(__style__)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, __style__];',
  )
}

/**
 * Read the compiler's AUTHORITATIVE island classification from the
 * `// @aihu:island <kind>` marker the Rust codegen emits for every component
 * (`emit.rs`, wave 3c). A component is a **static** island (server-render
 * only, no client hydration) or an **interactive** island (needs the signals
 * reactivity runtime).
 *
 * This REPLACES the old `_classifyIsland` regex post-pass, which re-derived
 * the answer by scanning generated code for `signal(`/`computed(`/`effect(`/…
 * calls — a Derived-property VIOLATION (docs/plans/ssr-build-performance-
 * findings.md §5: "the compiler answered that question when it emitted the
 * code"). The compiler now computes the classification from the IR (the same
 * fact-set that decides which owner-context primitives to import) and records
 * it as this marker; the plugin merely reads it.
 *
 * Crucially the compiler classifies CONSERVATIVELY and knows things the regex
 * could not: e.g. a component whose own body is inert but which declares
 * `$prop`s is `interactive` (props are reactive inputs the parent drives, and
 * its options-form emit is one the static-island shim cannot lower) — the old
 * regex saw no `signal(` call and wrongly classified it `static`.
 *
 * Defaults to `'interactive'` if the marker is somehow absent (an old binary,
 * or a future emit shape): the safe default never strips the runtime out from
 * under a component that needs it.
 *
 * @internal
 */
export function _parseIslandMarker(compiledCode: string): 'static' | 'interactive' {
  const m = /^\/\/ @aihu:island (static|interactive)$/m.exec(compiledCode)
  return m?.[1] === 'static' ? 'static' : 'interactive'
}

/** Best-effort message text for an unknown thrown value. @internal */
export function _errMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  const m = (err as { message?: unknown } | null)?.message
  return typeof m === 'string' ? m : String(err)
}

/**
 * Is this `import('vite')` rejection the ONE legitimate "there is no Vite here"
 * case — a standalone `transform()` caller, a unit test, any non-Vite host?
 *
 * The distinction matters because the two outcomes are opposites: "no Vite"
 * must hand the TypeScript back untouched (the caller owns it and never asked
 * for a strip), while "Vite is here and something broke" must throw, because
 * un-stripped TypeScript returned into a Vite build is silent corruption that
 * only surfaces as an unrelated bundler `PARSE_ERROR` much later.
 *
 * The test is deliberately narrow: a module-resolution failure whose subject is
 * the `vite` specifier itself. Both Node and Bun report `ERR_MODULE_NOT_FOUND`
 * with a message naming the package (`Cannot find package 'vite' …`). A
 * resolution failure for something else — a broken transitive dependency of an
 * installed Vite, say — is NOT this case: Vite is present, the strip is
 * expected, and swallowing it would be the same silent corruption. So it is
 * loud.
 *
 * @internal
 */
export function _isViteMissing(err: unknown): boolean {
  const message = _errMessage(err)
  const code = (err as { code?: unknown } | null)?.code
  const isResolutionFailure =
    code === 'ERR_MODULE_NOT_FOUND' ||
    code === 'MODULE_NOT_FOUND' ||
    /cannot find (module|package)/i.test(message)
  if (!isResolutionFailure) return false
  // The unresolved specifier must be `vite` itself, quoted the way both
  // runtimes quote it, not merely a path that happens to contain "vite".
  return /['"`]vite['"`]/.test(message)
}

/**
 * The message for a strip that failed with Vite present — names the branch, the
 * Vite version, the environment and the file, and says why it is fatal rather
 * than swallowed.
 *
 * @internal
 */
export function _stripFailure(
  fn: 'transformWithOxc' | 'transformWithEsbuild',
  id: string,
  viteVersion: string,
  isServerEnv: boolean,
  err: unknown,
): string {
  return (
    `[@aihu/compiler] TypeScript strip failed for ${id} — ` +
    `vite ${viteVersion} \`${fn}\` (${isServerEnv ? 'server' : 'client'} environment) threw. ` +
    'Returning the un-stripped TypeScript would corrupt the build silently and ' +
    'resurface as an unrelated bundler PARSE_ERROR on this file, so it fails here instead. ' +
    `Underlying error: ${_errMessage(err)}`
  )
}

/** What the Vite plugin's `transform` hook hands back after the strip. */
export interface StripTypesResult {
  readonly code: string
  readonly map: null
  /** Rolldown-only hint; set ONLY on the last-resort no-transform branch. */
  readonly moduleType?: 'ts'
}

/**
 * The subset of the Vite module `_stripTypes` uses — the seam tests fake.
 *
 * The trailing parameters are `any` on purpose: Vite's real signatures carry
 * version-specific option/config/watcher types (and MORE parameters on some
 * versions), and a narrower type here would make the genuine module fail to
 * satisfy the interface. Only the first two parameters and `code` on the result
 * are actually depended on.
 */
export interface ViteStripApi {
  readonly version?: string
  readonly transformWithOxc?: (
    code: string,
    id: string,
    // biome-ignore lint/suspicious/noExplicitAny: variance seam — see doc comment
    ...rest: any[]
  ) => Promise<{ code: string }>
  readonly transformWithEsbuild?: (
    code: string,
    id: string,
    // biome-ignore lint/suspicious/noExplicitAny: variance seam — see doc comment
    ...rest: any[]
  ) => Promise<{ code: string }>
}

/**
 * Strip TypeScript from compiler output using whichever transform the resolved
 * Vite exposes. Takes the Vite module as a PARAMETER so the branch order and
 * the failure behaviour are testable without installing four Vite versions.
 *
 * Branch order, and why:
 *
 * 1. `transformWithOxc` — Vite's own transform, needing NO separate esbuild.
 *    Vite 8 made esbuild an OPTIONAL PEER while still *exporting* a
 *    `transformWithEsbuild` that throws "It is deprecated and it now requires
 *    esbuild to be installed separately … migrate to `transformWithOxc`" the
 *    moment it is called. So this branch is deliberately NOT gated on the
 *    environment: a fresh consumer install at vite 8 has no esbuild at all, and
 *    the esbuild branch would throw on the CLIENT build — which every output
 *    mode (`spa`, `static`, `ssr`) runs.
 * 2. `transformWithEsbuild` — vite 6 and 5, where `transformWithOxc` does not
 *    exist (`'transformWithOxc' in vite` is literally false on 6.4.3), so those
 *    versions keep taking this branch and their output is unchanged.
 * 3. Neither — hand the TypeScript to Rolldown with `moduleType: 'ts'`. A
 *    forward-compatibility escape hatch for a Vite that drops both.
 *
 * Preferring oxc on vite 8 is a DELIBERATE behaviour change, not a refactor:
 * oxc lowers class fields with `useDefineForClassFields: true` (the modern-TS
 * default) where esbuild used `false`, lowers enums to a different (equivalent)
 * IIFE shape, and does not constant-inline enum member reads. Invisible for
 * compiler-generated code, observable for user-authored classes in an `.aihu`
 * script block. Pinned by `tests/strip-branch.test.ts`.
 *
 * Failures here are LOUD. Both call sites are individually wrapped so the
 * thrown error names the branch, the Vite version, the environment and the
 * file. The alternative — the swallowing `catch` this replaced — returned
 * un-stripped TypeScript that only surfaced as an unrelated `PARSE_ERROR` from
 * the bundler two hundred lines of build output later.
 *
 * @internal
 */
export async function _stripTypes(
  vite: ViteStripApi,
  code: string,
  id: string,
  isServerEnv: boolean,
): Promise<StripTypesResult> {
  const viteVersion = vite.version ?? 'unknown'
  if (typeof vite.transformWithOxc === 'function') {
    try {
      const stripped = await vite.transformWithOxc(code, 'component.ts', {
        lang: 'ts',
        sourcemap: false,
      })
      return { code: stripped.code, map: null }
    } catch (err) {
      throw new Error(_stripFailure('transformWithOxc', id, viteVersion, isServerEnv, err), {
        cause: err,
      })
    }
  }
  if (typeof vite.transformWithEsbuild === 'function') {
    try {
      const stripped = await vite.transformWithEsbuild(code, 'component.ts', {
        target: 'esnext',
        sourcemap: false,
      })
      return { code: stripped.code, map: null }
    } catch (err) {
      throw new Error(_stripFailure('transformWithEsbuild', id, viteVersion, isServerEnv, err), {
        cause: err,
      })
    }
  }
  return { code, moduleType: 'ts', map: null }
}

/**
 * §22 — parse the `// @aihu:component-tags a,b,c` marker the Rust codegen emits
 * for every server/universal build, on the same channel as `@aihu:island` above.
 *
 * The list comes from `collect_component_tags` — the SAME walk that fills
 * `route.json`'s `components` array — so it is already sorted, de-duplicated and
 * kebab-normalized when it arrives here. Deliberately NOT re-sorted or
 * re-de-duplicated: a second normalization would be a second place the rule
 * lives, and the two would drift.
 *
 * Distinct from the `__aihu_child_tags__` derivation below: this is "tags the
 * template references AT ALL", not "tags the compiled renderer will look up".
 * See the comment on the `__aihu_referenced_tags__` export for why both exist.
 *
 * Returns `[]` when the marker is absent (an older binary, a client-target
 * compile, a future emit shape) — the caller treats that identically to "the
 * template references nothing".
 *
 * @internal
 */
export function _parseComponentTagsMarker(compiledCode: string): string[] {
  const m = /^\/\/ @aihu:component-tags (.+)$/m.exec(compiledCode)
  return m === null ? [] : (m[1] as string).split(',')
}

/**
 * Derive the `__aihu_child_tags__` set from SERVER-TARGET compiled code: the
 * tags the compiled string renderer will actually look up, read off the
 * `__aihu_schild('<tag>'` call sites the Rust codegen emitted. Deduped, sorted.
 *
 * THE one derivation, deliberately. There are two consumers:
 *
 *   1. `aihuCompilerPlugin`'s transform, which turns the result into the
 *      `export const __aihu_child_tags__` a compiled module carries.
 *   2. `@aihu/router`'s `genSC`, which needs the SAME edge set at CODEGEN
 *      time — before any module exists to read an export off — to walk from
 *      the pages out to the components the server bundle must actually carry.
 *
 * `genSC` reaching for this instead of re-deriving is the whole point. The
 * `__aihu_referenced_tags__` docblock below spends a paragraph arguing that
 * deriving the runtime edge set a second way would be "one rule written in two
 * places, and the halves would drift the first time a boundary moved" — and
 * that argument does not stop applying because the second site happens to live
 * in another package. `readAihuLayoutComponents` (the source regex) is a THIRD,
 * differently-defined set and is not a substitute: it counts references the
 * emitter DECLINES (an attribute, children, a dynamic path), which produce no
 * call site, so `__aihu_schild` can never look them up. Measured on a
 * three-way fixture, it bundled a module whose rendered output was empty.
 *
 * Takes compiled code, not a source string: a caller with only source runs
 * `transform(src, id, { target: 'server' }).code` first — which is memoized, so
 * a file already compiled in this process costs a map lookup. Client- and
 * universal-target output carries no `__aihu_schild` call sites at all and
 * yields `[]`, which is correct: there is no server render to feed.
 *
 * @internal
 */
export function _deriveChildTags(compiledCode: string): string[] {
  return [
    ...new Set(
      Array.from(compiledCode.matchAll(/__aihu_schild\('([^']+)'/g), (m) => m[1] as string),
    ),
  ].sort()
}

/**
 * GX Phase 1 (#437-GX) — parse the `// @aihu:extract read=<v> call=<v>` code
 * marker the Rust compiler emits for every server/universal build (the
 * resolved policy, the ratified default included). Phase 1 consumes it only
 * for the build census below; Phase 4 (E2) will read the SAME marker for
 * governed chunk routing.
 * @internal
 */
export function _parseExtractMarker(code: string): { read: string; call: string } | null {
  const m = /^\/\/ @aihu:extract read=(\S+) call=(\S+)$/m.exec(code)
  return m ? { read: m[1] as string, call: m[2] as string } : null
}

/**
 * GX Phase 1 (#437-GX) — format the per-value extract census (the DA-e census
 * pattern from #437: every build PRINTS the posture distribution, so the
 * default-vs-declared migration story stays visible rather than silent).
 * Returns the printable lines; pure so tests can assert the counts.
 * @internal
 */
export function _formatExtractCensus(
  census: ReadonlyMap<string, { read: string; call: string }>,
): string[] {
  if (census.size === 0) return []
  const readCounts = new Map<string, number>()
  const callCounts = new Map<string, number>()
  for (const { read, call } of census.values()) {
    readCounts.set(read, (readCounts.get(read) ?? 0) + 1)
    callCounts.set(call, (callCounts.get(call) ?? 0) + 1)
  }
  const lines = [`[aihu] extract census — ${census.size} surface(s)`]
  for (const [value, n] of [...readCounts.entries()].sort()) lines.push(`  read=${value}: ${n}`)
  for (const [value, n] of [...callCounts.entries()].sort()) lines.push(`  call=${value}: ${n}`)
  return lines
}

/**
 * Extract the custom element tag name from compiler-emitted code.
 * The compiler always emits `defineElement('tag-name', ...)` as the
 * first call — pull the first string literal argument.
 * Returns `null` if no `defineElement` call is found.
 * @internal
 */
function _extractElementTag(code: string): string | null {
  const m = /defineElement\(\s*['"]([^'"]+)['"]/m.exec(code)
  return m ? (m[1] ?? null) : null
}

/**
 * §9.4 — is this compiled module a base-extending recipe, i.e. does it call
 * `defineComponent({ … base: … })` with an options object rather than a bare
 * setup function? Such a component cannot take the static-island shim, which
 * inlines `class extends HTMLElement` and has no way to honour a base class.
 *
 * Shape B of the ReDoS note at the top of this file. Equivalent to the single
 * ``/defineComponent\(\s*\{[^]*?\bbase\s*:/`` this replaced: the head
 * sub-pattern is unchanged, and `base:` appearing after some LATER
 * `defineComponent({` implies it also appears after the first one — so testing
 * only the first head is the same predicate, without the lazy re-scan that
 * every repetition of the head literal used to restart.
 * @internal
 */
function _hasBaseRecipe(code: string): boolean {
  const head = /defineComponent\(\s*\{/.exec(code)
  if (head === null) return false
  const key = /\bbase\s*:/g
  key.lastIndex = head.index + head[0].length
  return key.test(code)
}

/** Strip trailing `/` characters via a plain scan, not a `\/+$/`-anchored
 * regex — that shape is vulnerable to catastrophic backtracking on a long
 * run of slashes with no match (CodeQL js/polynomial-redos): the greedy `+`
 * backtracks one character at a time at EVERY starting offset before
 * failing, an O(n²) blowup (measured: ~45s on 200k slashes). */
function trimTrailingSlashes(s: string): string {
  let end = s.length
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* '/' */) end--
  return s.slice(0, end)
}

/**
 * Is `rawId` a layout SFC (a `.aihu` file under the configured layouts dir)?
 * Root-independent: matches the `<layoutsDir>/` segment anywhere in the path,
 * which is sufficient because the layouts dir is a project-relative convention.
 * @internal
 */
export function _isLayoutFile(rawId: string, layoutsDir: string): boolean {
  const ld = trimTrailingSlashes(layoutsDir.replace(/\\/g, '/').replace(/^\.?\//, ''))
  if (!ld) return false
  return rawId.replace(/\\/g, '/').includes(`/${ld}/`)
}

/**
 * Layout custom-element tag for a filename stem. MUST match
 * `@aihu/router`'s `layoutTagFor()` so the generated `virtual:aihu-layouts`
 * map and the registered element agree on the tag.
 * @internal
 */
export function _layoutTag(stem: string): string {
  return `aihu-layout-${stem.toLowerCase()}`
}

/**
 * O1a (tag naming) — JS mirror of the Rust compiler's
 * `tags::kebab_component_tag` (packages/compiler/src/tags.rs). PascalCase→kebab,
 * else lowercase-verbatim: inserts '-' before an uppercase letter when the
 * previous char is lowercase/digit, OR (acronym boundary) the previous char is
 * uppercase and the next is lowercase; then lowercases all. Applied to the
 * file stem before it is passed as `--tag` so the JS driver's define-name
 * matches the Rust one (`UserCard.aihu` → `user-card`). Validation/erroring
 * (C450) is owned by the Rust compiler — this is the infallible transform only.
 * @internal
 */
export function kebabComponentTag(raw: string): string {
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    // charAt (not raw[i]) returns string, never string|undefined — satisfies
    // noUncheckedIndexedAccess; charAt(i+1) yields '' past the end, matching
    // the "no next char" case.
    const c = raw.charAt(i)
    if (i > 0 && c >= 'A' && c <= 'Z') {
      const prev = raw.charAt(i - 1)
      const next = raw.charAt(i + 1)
      const prevLower = prev >= 'a' && prev <= 'z'
      const prevDigit = prev >= '0' && prev <= '9'
      const prevUpper = prev >= 'A' && prev <= 'Z'
      const nextLower = next >= 'a' && next <= 'z'
      if (prevLower || prevDigit || (prevUpper && nextLower)) out += '-'
    }
    out += c.toLowerCase()
  }
  return out
}

const OUTLET_HEAD = 'const createOutletBoundary = () => {'
const OUTLET_PASSIVE = `const createOutletBoundary = () => branch('div', { 'data-aihu-outlet': '' }, []);`

/**
 * Collapse the reactive `<outlet>` boundary the Rust codegen emits into a
 * passive `data-aihu-outlet` marker. Layout SFCs are rendered by `@aihu/app`'s
 * imperative client renderer, which fills the marker itself; the default
 * boundary's mount-time `effect()` reads `useRoute()` (null under the imperative
 * path) and clears the marker, which would wipe the page the renderer inserts.
 *
 * Anchors on the exact `const createOutletBoundary = () => { … return host; };`
 * block the codegen emits (`packages/compiler/src/codegen/emit.rs`). No-op when
 * the layout declares no `<outlet>`.
 *
 * Shape B of the ReDoS note at the top of this file: the head is located with
 * `indexOf` and the tail scanned once from there, instead of one regex whose
 * lazy `[\s\S]*?` re-scanned the whole module at every repetition of the head
 * literal.
 * @internal
 */
export function _passivizeOutlet(code: string): string {
  const head = code.indexOf(OUTLET_HEAD)
  if (head === -1) return code
  // `[^\S\n]*\n` (horizontal whitespace, then the line break) rather than
  // `\s*\n`: the codegen emits `  return host;\n};` and `\s` matching `\n`
  // made the run ambiguous. Sticky-free `g` + an explicit `lastIndex` starts
  // the single tail scan immediately after the head.
  const tailRe = /return host;[^\S\n]*\n\};/g
  tailRe.lastIndex = head + OUTLET_HEAD.length
  const tail = tailRe.exec(code)
  if (tail === null) return code
  return code.slice(0, head) + OUTLET_PASSIVE + code.slice(tail.index + tail[0].length)
}

/**
 * Instrument a compiled `.aihu` module with HMR support.
 *
 * The compiler always emits:
 *
 *   import { defineComponent, defineElement } from '@aihu/runtime'
 *   defineElement('tag', defineComponent((_ctx) => { ... }))
 *
 * This function:
 *
 *  1. Adds `_hmrReplace` to the `@aihu/runtime` import.
 *  2. Prepends a module-level slot variable `__aihu_setup__`.
 *  3. Rewrites the single `defineComponent(` call so the setup function
 *     is captured via an assignment expression:
 *     `defineComponent(__aihu_setup__ = ` (valid JS; assignment has
 *     lower precedence than arrow fn, so `defineComponent` still
 *     receives the function as its argument).
 *  4. Appends `export { __aihu_setup__ as default }` so that Vite's
 *     `import.meta.hot.accept` callback receives the new setup via
 *     `newModule.default` on hot reload.
 *  5. Appends the `import.meta.hot.accept` block, gated on `__DEV__`.
 *
 * The `__DEV__` guard ensures production bundlers (where they replace
 * `__DEV__` with `false`) dead-code-eliminate the entire HMR block.
 *
 * @internal
 */
function _buildHmrCode(compiledCode: string, elementTag: string): string {
  // Step 1 — add _hmrReplace to the @aihu/runtime import.
  const withImport = compiledCode.replace(
    /import\s*\{([^{}]*)\}\s*from\s*'@aihu\/runtime'/,
    (_m, imports: string) => {
      const parts = imports
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (!parts.includes('_hmrReplace')) parts.push('_hmrReplace')
      return `import { ${parts.join(', ')} } from '@aihu/runtime'`
    },
  )

  // Step 2+3 — prepend slot variable and rewrite the defineComponent call.
  // Compiler emits exactly one `defineComponent(` followed by a function expr.
  // Rewrite: defineComponent(fn)  →  defineComponent(__aihu_setup__ = fn)
  // Assignment expression evaluates to `fn`, so defineComponent still
  // receives the setup function as its first argument unchanged.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const preamble = `let __aihu_setup__: ((ctx: any) => any) | undefined\n`

  const patchedBody = withImport.replace(/\bdefineComponent\(/, 'defineComponent(__aihu_setup__ = ')

  const tag = JSON.stringify(elementTag)
  // Step 4+5 — postamble with default export and HMR acceptance.
  const postamble = `
export { __aihu_setup__ as default }

if (typeof __DEV__ !== 'undefined' && __DEV__ && import.meta.hot) {
  import.meta.hot.accept((newModule) => {
    if (!newModule) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newSetup = (newModule as any)['default']
    if (typeof newSetup !== 'function') return
    document.querySelectorAll(${tag}).forEach((el) => {
      _hmrReplace(el as HTMLElement, newSetup)
    })
  })
}
`

  return preamble + patchedBody + postamble
}

/**
 * Rewrite an interactive-island module so its `connectedCallback` waits
 * for the element to scroll into view before mounting. Plan 3.3 — applied
 * only when the consumer adds `defer` to the custom element tag (e.g.
 * `<my-counter defer>`); the runtime helper checks the attribute and
 * either mounts immediately or registers an `IntersectionObserver`.
 *
 * Implementation: the helper is added as a `_hydrateOnVisible` import
 * from `@aihu/runtime`, and the compiler-emitted `defineElement(...)`
 * call is wrapped in a `defineElement` that intercepts `connectedCallback`
 * to honour the `defer` attribute.
 *
 * The whole indirection is tree-shaken when no `.aihu` module reaches
 * this branch, because `_hydrateOnVisible` is exported from its own
 * sibling module inside `@aihu/runtime`.
 *
 * @internal
 */
export function _buildDeferredHydration(compiledCode: string, elementTag: string): string {
  // Add _hydrateOnVisible to the @aihu/runtime import.
  const withImport = compiledCode.replace(
    /import\s*\{([^{}]*)\}\s*from\s*'@aihu\/runtime'/,
    (_m, imports: string) => {
      const parts = imports
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (!parts.includes('_hydrateOnVisible')) parts.push('_hydrateOnVisible')
      return `import { ${parts.join(', ')} } from '@aihu/runtime'`
    },
  )

  // Wrap the class returned by defineComponent BEFORE defineElement
  // consumes it. The HTML spec caches lifecycle callbacks at
  // customElements.define() time, so we MUST mutate the prototype
  // before that call — not after. We accomplish this with a synchronous
  // helper invoked between defineComponent and defineElement.
  //
  // Source pattern (compiler-emitted):
  //   defineElement('tag', defineComponent((_ctx) => { ... }))
  //
  // After this rewrite:
  //   defineElement('tag', __aihu_wrap_defer__(defineComponent((_ctx) => { ... })))
  //
  // …with __aihu_wrap_defer__ defined in the appended preamble.
  const patched = withImport.replace(
    /defineElement\(\s*('[^']+'|"[^"]+")\s*,\s*defineComponent\(/,
    (_m, tagLit: string) => `defineElement(${tagLit}, __aihu_wrap_defer__(defineComponent(`,
  )
  // Match the closing `))` of the defineElement call. The HMR pass may
  // have inserted `__aihu_setup__ = ` before the inner function, but
  // the trailing `))` shape is unchanged. Replace exactly one occurrence
  // by anchoring on end-of-string trim; bail if the shape does not match.
  if (patched === withImport) {
    // The expected `defineElement(<tag>, defineComponent(` shape was not
    // present (e.g. compiler output changed). Skip defer wrapping rather
    // than emit broken code.
    return compiledCode
  }
  // Add a trailing `)` to balance the extra `(` from __aihu_wrap_defer__.
  // Source shape after _buildHmrCode is:
  //   defineElement('tag', defineComponent(__aihu_setup__ = (_ctx) => {...}))
  //   export { __aihu_setup__ as default }
  //   if (typeof __DEV__ !== ...) { ... }
  // We must close BEFORE the export line. Match the first `))` followed
  // by a newline and `export` (or end-of-string for the unwrapped case).
  let balanced = patched.replace(/\)\s*\)\s*\nexport\s/, ')))\nexport ')
  if (balanced === patched) {
    // No HMR postamble — the `))` is at end-of-string.
    balanced = patched.replace(/\)\s*\)\s*$/, ')))\n')
  }
  if (balanced === patched) {
    // Could not find the matching `))` — bail out.
    return compiledCode
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const helper = `
// Plan 3.3 (Islands) — defer attribute support. Wraps the constructor
// returned by defineComponent so instances bearing the \`defer\` attribute
// hydrate lazily via IntersectionObserver. Bare instances retain the
// eager Plan 3.2 hydration path.
function __aihu_wrap_defer__<T extends typeof HTMLElement>(Ctor: T): T {
  const orig = (Ctor.prototype as unknown as { connectedCallback?: () => void }).connectedCallback
  if (typeof orig !== 'function') return Ctor
  ;(Ctor.prototype as unknown as { connectedCallback: () => void }).connectedCallback = function (this: HTMLElement) {
    if (this.hasAttribute('defer')) {
      _hydrateOnVisible(this, () => orig.call(this))
    } else {
      orig.call(this)
    }
  }
  return Ctor
}
`
  void elementTag
  return helper + balanced
}

/**
 * Build a static-island shim for a compiled module.
 *
 * The compiled module emitted by the Rust codegen has the shape:
 *
 *   import { branch, leaf, slot } from '@aihu/arbor'
 *   import { defineComponent, defineElement } from '@aihu/runtime'
 *   defineElement('tag', defineComponent((_ctx) => { return <tree> }))
 *
 * For a static island we know `<tree>` contains no `signal(`/`computed(`
 * calls. We can therefore:
 *
 *   1. Drop the `@aihu/runtime` import (saves ~600 B gz of defineComponent
 *      + defineElement + bootstrap glue).
 *   2. Replace `defineElement(tag, defineComponent(setup))` with a tiny
 *      inline class that mounts the tree directly via `mount()` (which the
 *      arbor barrel already exports).
 *   3. Tag the file with a `// AIHU_STATIC_ISLAND` comment so consumers
 *      can audit which routes shipped zero-JS-runtime.
 *
 * Falls back to the original code if the regex shape does not match
 * (defensive: a future compiler change must opt back into static-island
 * emission explicitly rather than silently break).
 *
 * @internal
 */
export function _buildStaticIsland(compiledCode: string, elementTag: string): string {
  // Confirm the shape we expect: a single defineElement(...) call wrapping
  // a single defineComponent(...) call. Bail out otherwise.
  const callRe = /defineElement\(\s*['"][^'"]+['"]\s*,\s*defineComponent\(/
  if (!callRe.test(compiledCode)) return compiledCode

  // Strip the `@aihu/runtime` import line entirely — static islands
  // don't reference defineComponent/defineElement after the rewrite.
  const withoutRuntimeImport = compiledCode.replace(
    /^[^\S\r\n]*import\s*\{[^{}]*\}\s*from\s*'@aihu\/runtime'(?:\s*;)?\s*$/m,
    '',
  )

  // Ensure `mount` is imported from @aihu/arbor (it already exposes
  // branch/leaf/slot, so we just append `mount` to the existing list).
  const withArborMount = withoutRuntimeImport.replace(
    /import\s*\{([^{}]*)\}\s*from\s*'@aihu\/arbor'/,
    (_m, imports: string) => {
      const parts = imports
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (!parts.includes('mount')) parts.push('mount')
      return `import { ${parts.join(', ')} } from '@aihu/arbor'`
    },
  )

  // Which tail shape this module ends in, and whether an island is safe.
  //
  // `_injectShadowMode` runs BEFORE this in the transform pipeline, so the
  // `defineElement(...)` call may already carry a third argument and no longer
  // end in `))`. Rewriting the head while the tail rewrite silently no-ops
  // produced a module with an unclosed class body and a dangling options
  // object — invalid JS, emitted with no error, which surfaced downstream as a
  // confusing `[PARSE_ERROR] … invalid JS syntax` naming the user's `.aihu`
  // file. Reachable today with `islands: true` + `shadowMode: 'shadow'`, on
  // vite 6 as well as 8.
  //
  // `shadowMode: 'shadow'` alone is safe to drop: the inline class attaches its
  // own `{ mode: 'open' }` shadow root, which is precisely what that option
  // asks for. ANY other option (`formAssociated`, `lightScopeId`, a future
  // field) carries behaviour this class does not implement, so the island is
  // DECLINED — the component keeps the ordinary `defineElement` path, exactly
  // as the "falls back to the original code" contract above promises.
  const TAIL_PLAIN = /\)\s*\)\s*$/
  // `_injectShadowMode`'s two-argument branch (line ~314) always emits this
  // EXACT literal shape — `, { shadowMode: 'shadow' }` with one space at each
  // junction, never a trailing comma — so the `\s*,?\s*` this used to have
  // around the optional comma was dead flexibility, never exercised by real
  // compiler output, and it was the ReDoS: two adjacent `\s*` groups with
  // only an optional zero-width `,?` between them let a long non-matching
  // whitespace run split across the pair in O(n) ways per position. A single
  // `\s*` per junction, none of them adjacent to another, matches the same
  // real input with no such ambiguity.
  const TAIL_WITH_SHADOW_ONLY = /\),\s*\{\s*shadowMode:\s*'shadow'\s*\}\)\s*$/
  const tail = TAIL_PLAIN.test(withArborMount)
    ? TAIL_PLAIN
    : TAIL_WITH_SHADOW_ONLY.test(withArborMount)
      ? TAIL_WITH_SHADOW_ONLY
      : null
  if (tail === null) return compiledCode

  // Replace `defineElement('tag', defineComponent((_ctx) => { ... }))`
  // with an inline `customElements.define` whose connectedCallback mounts
  // the static tree. The setup function is captured verbatim by replacing
  // the wrapping calls with anonymous-IIFE bookends.
  const tagJson = JSON.stringify(elementTag)
  const rewritten = withArborMount
    .replace(
      /defineElement\(\s*['"][^'"]+['"]\s*,\s*defineComponent\(/,
      `customElements.define(${tagJson}, class extends HTMLElement {\n  connectedCallback() {\n    const root = this.attachShadow({ mode: 'open' })\n    const __aihu_setup__ = (`,
    )
    .replace(tail, `)\n    mount(__aihu_setup__({ host: root, element: this }), root)\n  }\n})\n`)

  return `// AIHU_STATIC_ISLAND — zero @aihu/runtime references\n${rewritten}`
}

/**
 * Compile a .aihu source string to TypeScript.
 * map is null — source maps are deferred to v1 (OQ-C8)
 *
 * B3b — when `sidecarOut` is provided, also writes the per-SFC `.aihu.ts`
 * sidecar at that path. Callers (e.g. the Vite plugin) typically pass
 * `<source-id>.ts` so `tsc --noEmit` discovers per-SFC template expressions.
 */
export function transform(
  source: string,
  id: string,
  options?: {
    sidecarOut?: string
    target?: 'client' | 'server' | 'universal'
    /** Override the registered custom-element tag (default: file stem). Used for layouts. */
    tag?: string
    /**
     * #486 step 4 — emit the sidecar's attribute/component-prop type layer
     * (`--strict-templates`). Affects only the type-check surface written to
     * `sidecarOut`; the compiled JS is identical either way. Default off.
     */
    strictTemplates?: boolean
  },
): { code: string; map: null } {
  // O1a (tag naming): normalize the stem so the JS driver's define-name
  // matches the Rust compiler's (`UserCard.aihu` → `user-card`). When a
  // component-shaped (uppercase-first) stem normalizes to a hyphen-less name
  // (`Comment.aihu` → `comment`), pass the RAW stem instead so the Rust
  // compiler surfaces its C450 error — the JS never validates or errors, but
  // it must not mask the error by pre-lowercasing. An explicit `options.tag`
  // (e.g. `_layoutTag` for layouts) passes through untouched.
  const rawStem = basename(id, '.aihu')
  const kebabStem = kebabComponentTag(rawStem)
  const stem = /^[A-Z]/.test(rawStem) && !kebabStem.includes('-') ? rawStem : kebabStem
  const args = ['--stdin', '--tag', options?.tag ?? stem, '--path', id]
  if (options?.sidecarOut) {
    args.push('--sidecar-out', options.sidecarOut)
  }
  // T6 (go-public demo) — thread the build target so a client bundle gets the
  // policy-free `@agent` dispatcher (and the per-instance registration the
  // capability bridge needs) instead of the server `__agentBinding`. Defaults to
  // the compiler's `universal` target when omitted (existing behaviour).
  if (options?.target) {
    args.push('--target', options.target)
  }
  if (options?.strictTemplates) {
    args.push('--strict-templates')
  }
  // `sidecarOut` BYPASSES the memo AND the envelope backends: it makes the
  // spawn write a file on disk — a cache hit would silently skip that side
  // effect, and the envelope API deliberately has no file-writing emits. The
  // Vite build path never passes it, so the SSG double-compile still fully
  // hits.
  if (options?.sidecarOut) {
    // Bounded — an unbounded spawn here is the hang that left two
    // `aihu-compile --stdin` children alive for 2.5 days. See spawn-bounds.ts.
    const bin = resolveBinPath()
    const startedAt = Date.now()
    try {
      const code = execFileSync(bin, args, {
        input: source,
        encoding: 'utf8',
        ...compileSpawnBounds(source.length),
      })
      return { code, map: null }
    } catch (err) {
      const described = describeSpawnFailure(err, bin, args, source.length, Date.now() - startedAt)
      throw described ?? err
    }
  }
  // Memo key: everything that shapes the emitted code. `id` is hashed
  // separately; the fingerprint carries the explicit options (`tag` covers the
  // layout override — the default stem is a pure function of `id`). The stamp
  // is the ACTIVE backend's file identity (native addon `.node` path when
  // in-process, CLI binary path when spawning) — see js/envelope.ts.
  const stamp = _backendStampPath()
  const target = options?.target ?? 'universal'
  // Sibling-artifact seeding (the single-parse envelope win): one compile of
  // a file yields js + ast + route, and the ast/route strings are seeded into
  // the memo under the exact keys `compileToAst` / `compileRouteMeta` derive
  // for the same (source, id) — so css-engine's AST pass and the router's
  // route scan become cache hits instead of re-parses. Only sound when the
  // tag is NOT overridden: those callers derive their own stem from `id`, and
  // an explicit tag (layout mode) resolves to a different define-name.
  const seedSiblings = options?.tag === undefined
  const code = _memoizedSpawn(
    'transform',
    source,
    id,
    `target=${options?.target ?? ''}|tag=${options?.tag ?? ''}|strict=${options?.strictTemplates === true}`,
    stamp,
    () => {
      const reply = _compileViaBackend(source, args, {
        tag: options?.tag ?? stem,
        path: id,
        targets: [target],
        emits: seedSiblings ? ['js', 'ast', 'route'] : ['js'],
        ...(options?.strictTemplates ? { strictTemplates: true } : {}),
      })
      // Legacy reply — an older binary ignored `--envelope` and answered the
      // classic single-target request; its stdout IS the compiled JS.
      if (reply.kind === 'legacy') return reply.output
      const envelope = reply.envelope
      if (seedSiblings) {
        if (envelope.astJson !== undefined) {
          _seedMemo('ast', source, id, '', stamp, envelope.astJson)
        }
        _seedMemo('route', source, id, '', stamp, envelope.routeJson ?? 'null')
      }
      const js = envelope.targets[target]?.js
      if (js === undefined) {
        throw new Error(`[@aihu/compiler] envelope reply missing js for target '${target}'`)
      }
      return js
    },
  )
  return {
    code,
    map: null, // source maps deferred to v1 (OQ-C8)
  }
}

/**
 * Escape a CSS string for safe interpolation inside a JS template literal.
 * The Rust codegen places the authored `@style` body raw inside a backtick
 * literal, so it already assumes no backticks in `@style`. css-engine output
 * (theme tokens + utility rules) likewise never contains backticks, but we
 * escape `\`, `` ` `` and `${` defensively so a future token value can't
 * break out of the literal.
 *
 * @internal
 */
function _escapeForTemplateLiteral(css: string): string {
  return css.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
}

/**
 * Fold css-engine-produced scoped CSS into a compiled `.aihu` module.
 *
 * The Rust codegen emits the authored `@style` block (when present) as:
 *
 *   const __style__ = new CSSStyleSheet();
 *   __style__.replaceSync(`<authored css>`);
 *   defineElement('tag', defineComponent((ctx) => {
 *     (ctx.host as ShadowRoot).adoptedStyleSheets = [__style__];
 *     return ...
 *   }))
 *
 * css-engine's `compileSfc` output is the COMPLETE per-SFC stylesheet:
 * `:host` theme tokens, the variant-resolved utility-class rules, AND the
 * folded authored `@style` block (under an `authored @style` CSS comment).
 * So it is authoritative — we adopt it as the single shadow `<style>` and
 * the authored `@style` keeps emitting through it (acceptance: "@style still
 * emits correctly alongside").
 *
 * Two shapes are handled:
 *
 *  1. **SFC has an `@style` block** — the Rust codegen already declared
 *     `__style__` with the raw `@style` body. We REPLACE that body with the
 *     css-engine output (which already CONTAINS the `@style` block) so the
 *     `@style` rules are not duplicated. The existing `adoptedStyleSheets`
 *     assignment is reused unchanged.
 *
 *  2. **SFC has NO `@style` block** — there is no `__style__`. We inject a
 *     fresh `__style__` declaration after the last import and an
 *     `adoptedStyleSheets` assignment as the first statement of the setup
 *     function. The compiler emits the setup param as `_ctx` in this case;
 *     we rename it to `ctx` so the injected `ctx.host` reference resolves.
 *
 * Runs on the RAW compiled output BEFORE the island / HMR / auto-wiring
 * transforms so those passes operate on the folded module uniformly:
 *   - The static-island shim calls `__aihu_setup__({ host: root, ... })`
 *     where `root` is the shadow root, so `ctx.host` is valid there too.
 *   - The HMR / defer passes only touch the `defineElement(...)` wrapper and
 *     the runtime import; they do not disturb `__style__` or the setup body.
 *
 * No-ops (returns input unchanged) when `css` is empty/whitespace.
 *
 * @internal
 */
/**
 * Swap the text between the first `open` delimiter and the first `close`
 * delimiter that follows it, keeping both delimiters. Returns `null` when the
 * shape is absent so callers can fall through to their "no anchor" branch.
 *
 * Shape B of the ReDoS note at the top of this file. This is exactly what
 * ``/(<open>)[^]*?(<close>)/`` matched — `String.replace` takes the leftmost
 * match, and a `close` missing after the first `open` is missing after every
 * later one too — but as two `indexOf` scans it is linear instead of O(n²) in
 * the number of `open` repetitions an authored `@style` block can plant.
 */
function _replaceDelimitedBody(
  code: string,
  open: string,
  close: string,
  body: string,
): string | null {
  const start = code.indexOf(open)
  if (start === -1) return null
  const bodyStart = start + open.length
  const end = code.indexOf(close, bodyStart)
  if (end === -1) return null
  return code.slice(0, bodyStart) + body + code.slice(end)
}

/**
 * Fold css-engine utility CSS into the SERVER target's `__aihu_css__` export.
 *
 * The shadow-DOM sibling of `_foldCssEngineStyles`. That one rewrites the
 * client's `__style__.replaceSync(...)`; the server target has no `__style__`
 * (`CSSStyleSheet` is a DOM dependency and the Rust codegen elides it), it has
 * `export const __aihu_css__` — the string `__aihu_schild` inlines as `<style>`
 * inside a declarative shadow template.
 *
 * Without this, that template shipped the authored `@style` block ALONE: no
 * utility classes, no design tokens, no reset. A shadow child prerendered
 * partially unstyled and repainted once its chunk loaded — precisely the #754
 * failure the DSD `<style>` exists to prevent. (The step-4 scoping note claimed
 * no css-engine work was needed. That was true of the Rust emitter, which
 * applies no scoping transform, and wrong about the pipeline: the per-component
 * utility CSS is folded HERE, in the JS layer, and the server target was simply
 * never wired to it.)
 *
 * REPLACES rather than appends, for the same reason shape 1 above does: the
 * css-engine output already contains the authored `@style` rules, so appending
 * would duplicate them.
 *
 * Light-DOM components never reach this — their utilities go through the global
 * cascade via `_foldCssEngineStylesGlobal`, and their prerendered markup is
 * covered by the app stylesheet's `@scope([data-a=…])` blocks.
 */
export function _foldSsrCssExport(compiledCode: string, css: string): string {
  if (!css.trim()) return compiledCode
  const escaped = _escapeForTemplateLiteral(css)

  // Shape 1 — an authored @style block already produced the export.
  const replaced = _replaceDelimitedBody(
    compiledCode,
    'export const __aihu_css__ = `',
    '`',
    escaped,
  )
  if (replaced !== null) return replaced

  // Shape 2 — no authored @style, so the Rust codegen emitted no export at all.
  // The utility CSS still has to reach the shadow root, so declare it. Appended
  // at the end: the server artifact's exports are order-independent, and this
  // avoids guessing at an anchor the way shape 2 above has to.
  return `${compiledCode}\nexport const __aihu_css__ = \`${escaped}\`\n`
}

export function _foldCssEngineStyles(compiledCode: string, css: string): string {
  if (!css.trim()) return compiledCode
  const escaped = _escapeForTemplateLiteral(css)

  // Shape 1 — an authored @style block already declared __style__. css-engine
  // output already includes that @style block, so REPLACE the replaceSync body
  // (between the backticks) wholesale to avoid duplicating the @style rules.
  // The codegen emits `__style__.replaceSync(`<body>`);` as a single statement;
  // swap the body between the first open delimiter and the `);` that closes it.
  // `_replaceDelimitedBody` splices rather than calling `String.replace`, so a
  // `$` in the CSS can never be read as a replacement-pattern backreference.
  const replaced = _replaceDelimitedBody(compiledCode, '__style__.replaceSync(`', '`);', escaped)
  if (replaced !== null) return replaced

  // Shape 2 — no @style block. Inject a fresh stylesheet + adoption.
  // Bail (no-op) if the expected defineComponent setup shape is absent.
  // The setup param is NOT always `ctx`/`_ctx`: an agent component (one with an
  // exposed member) emits `(__aihu_ctx__)` so `_registerAgentServerBinding`
  // can read `__aihu_ctx__?.element`. Capture whatever the param is and inject
  // against it — a literal `(ctx)` anchor silently no-ops on agent components,
  // which shipped scoped utility CSS with no adopted stylesheet.
  const setupRe = /defineComponent\(\s*\((__?[A-Za-z0-9_]+)\)\s*=>\s*\{/
  const m = setupRe.exec(compiledCode)
  if (m == null) return compiledCode
  // `_ctx` is codegen's "unused ctx" marker; the injected adoption uses it, so
  // normalize to `ctx`. Any other name (`ctx`, `__aihu_ctx__`) is referenced
  // elsewhere in the setup body and MUST be preserved verbatim.
  const setupParam = m[1] === '_ctx' ? 'ctx' : m[1]

  // Inject the module-level stylesheet declaration after the last import line.
  const lines = compiledCode.split('\n')
  let lastImportIdx = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = (lines[i] ?? '').trim()
    if (t.startsWith('import ') || t.startsWith('import{')) {
      lastImportIdx = i
      break
    }
  }
  const decl = `const __style__ = new CSSStyleSheet();\n__style__.replaceSync(\`${escaped}\`);`
  if (lastImportIdx !== -1) {
    lines.splice(lastImportIdx + 1, 0, decl)
  } else {
    lines.unshift(decl)
  }
  let withDecl = lines.join('\n')

  // Inject the adoption as the first statement of the setup body, using the
  // ACTUAL setup param (`ctx` for a plain component, `__aihu_ctx__` for an
  // agent component). `_ctx` is normalized to `ctx` above since the injected
  // statement now references it.
  withDecl = withDecl.replace(
    setupRe,
    `defineComponent((${setupParam}) => {\n  (${setupParam}.host as ShadowRoot).adoptedStyleSheets = [__style__];`,
  )
  return withDecl
}

/**
 * Virtual-module prefix used by the `shadowMode === 'light'` branch to route
 * per-SFC utility CSS through Vite's built-in CSS pipeline. The plugin
 * (`aihuCompilerPlugin`) implements `resolveId` + `load` for ids matching
 * `VIRTUAL_UTILITY_PREFIX + '<hash>.css'`, returning the stored CSS body so
 * Vite hoists it into the bundle CSS asset (`dist/assets/*.css`) — NOT into
 * `host.adoptedStyleSheets`, which is a no-op when there is no shadow root.
 *
 * The trailing `.css` extension is mandatory: Vite's built-in CSS plugin keys
 * off the extension to know it should run the CSS pipeline on the module.
 *
 * @internal
 */
export const VIRTUAL_UTILITY_PREFIX = '\0virtual:aihu-utility/'

/**
 * djb2-style stable hash over a file id. Shared by `_hashIdForUtilityCss`
 * (virtual-CSS module keying) and `_lightScopeId` (the `data-a` scope id) so
 * the two id-derived-from-hash use sites can't drift onto different hash
 * functions.
 */
function _hashId(id: string): number {
  let h = 5381
  for (let i = 0; i < id.length; i++) {
    h = ((h * 33) ^ id.charCodeAt(i)) >>> 0
  }
  return h
}

/**
 * Stable short hash for keying the virtual-CSS module per source-SFC id.
 *
 * djb2-style; collisions are tolerable here because (a) each entry stores its
 * own CSS body, so a hash collision would only matter if two distinct SFCs
 * hashed to the same key AND were processed concurrently; (b) collisions are
 * recoverable — Vite would simply load the wrong CSS for one SFC; we still
 * keyed on the unhashed id internally to avoid that. The hash only appears in
 * the bundled asset URL.
 *
 * @internal
 */
export function _hashIdForUtilityCss(id: string): string {
  return _hashId(id).toString(36)
}

/**
 * Deterministic 8-hex-char scope id for a light-DOM component's `data-a`
 * attribute (light-DOM leaf flip, LDF §10 step 1 / step 3). Same underlying
 * hash as `_hashIdForUtilityCss`, reformatted to a fixed-width hex string —
 * the `[data-a="<id>"]` marker format LDF §11 Q4 ratifies is a hex string,
 * and a fixed width keeps every stamped attribute the same byte length.
 * Hashes the query-stripped file id (stable per file path across builds),
 * not file content — matches `_hashIdForUtilityCss`'s existing contract.
 *
 * @internal
 */
export function _lightScopeId(id: string): string {
  return _hashId(id).toString(16).padStart(8, '0')
}

/**
 * Bug 6 — `shadowMode === 'light'` branch.
 *
 * Routes utility CSS to Vite's CSS pipeline (which folds CSS imports into the
 * bundled `dist/assets/*.css` asset) instead of to `host.adoptedStyleSheets`
 * (a no-op on an element with no shadow root). Returns a prelude `import` that
 * the plugin's `resolveId` + `load` hooks resolve to the stored CSS body.
 *
 * The `__style__` shadow path is NOT invoked here — utility CSS for a
 * cascade-mode component MUST hit the global stylesheet, not a per-element
 * stylesheet that would be silently dropped by `HTMLElement`'s setter.
 *
 * Authored `@style` blocks still emit through the Rust codegen's `<style>`
 * node and are unaffected. (If a component opts into `shadowMode: 'light'` and
 * authors an `@style` block, the codegen still wires it through the
 * non-shadow path — that is the runtime's contract, not this hook's.)
 *
 * @internal
 */
export function _foldCssEngineStylesGlobal(
  compiledCode: string,
  css: string,
  id: string,
): { code: string; virtualId: string } | null {
  if (!css.trim()) return null
  const hash = _hashIdForUtilityCss(id)
  const virtualId = `${VIRTUAL_UTILITY_PREFIX}${hash}.css`
  // Prepend the CSS import as a side-effect-only import so Vite's CSS plugin
  // hoists it into the bundle. We use the NULL-byte virtual id form
  // (Rollup/Vite convention for "owned by this plugin"); other plugins will
  // skip it. The compiler's transform returns this prepended code, which the
  // downstream esbuild/oxc strip leaves untouched (it's just an import).
  const prelude = `import ${JSON.stringify(virtualId)};\n`
  return { code: prelude + compiledCode, virtualId }
}

// ─── v1.0.10a — compiler AST-export hook ─────────────────────────────────────
//
// Thin TS wrapper over the `aihu-compile --ast-json` flag. Returns the parsed
// `.aihu` SFC AST in a stable, serializable shape consumed by the CSS engine's
// AST scanner (`css-2-ast-scanner`). Mirrors the typed contract in
// `docs/superpowers/specs/compiler-ast-export-hook.md` §4.

/** Top-level AST export — one per .aihu SFC. */
export interface SfcAst {
  /** Resolved custom-element tag name (meta.name → route.name → file stem). */
  tag: string
  /** AST schema version — bumped on any breaking shape change (semver-tied). */
  astVersion: 1
  /** The @style block, if the SFC declared one. */
  style: SfcStyleBlock | null
  /** Parsed template tree. null when the SFC has no @template block. */
  template: SfcNode[] | null
  /** SFC-level metadata. */
  meta: SfcMeta
  /**
   * The compiler-assigned light-DOM scope id for this component's `data-a`
   * attribute, present only when it resolved to `shadowMode: 'light'`
   * (light-DOM leaf flip, LDF §10 step 1). Absent (not just `undefined`, the
   * key itself omitted on the wire) for shadow-mode components — additive,
   * mirrors `aihu-css-core`'s `SfcAst.light_scope_id: Option<String>`.
   */
  lightScopeId?: string
}

export interface SfcStyleBlock {
  /** Verbatim CSS body of the @style block (braces stripped, $global token removed). */
  content: string
  /** 'scoped' (default) or 'global' (@style { $global ... }). */
  scope: 'scoped' | 'global'
}

export interface SfcMeta {
  /** From @meta { name } / @route { name } / file stem — never null after resolution. */
  name: string
}

/** Discriminated union mirroring Rust `TemplateNode`. */
export type SfcNode =
  | { kind: 'element'; tag: string; attrs: SfcAttr[]; children: SfcNode[] }
  | { kind: 'macroElement'; name: string; attrs: SfcAttr[]; children: SfcNode[] }
  | { kind: 'text'; value: string }
  | { kind: 'interpolation'; expr: string }
  | { kind: 'ifBlock'; branches: Array<{ cond: string; body: SfcNode[] }> }
  | {
      kind: 'eachBlock'
      list: string
      item: string
      idx: string | null
      key: string | null
      body: SfcNode[]
      emptyBody: SfcNode[] | null
    }
  | { kind: 'htmlBlock'; expr: string }

/** Discriminated union mirroring Rust `Attr` — the three class-forms key on `kind`. */
export type SfcAttr =
  | { kind: 'static'; name: string; value: string } // Form A
  | { kind: 'binding'; name: string; expr: string } // Form B
  | { kind: 'macro'; name: string; value: SfcMacroValue } // Form C (and on:/bind:/emit:/if/each/…)

export type SfcMacroValue =
  | { form: 'quoted'; value: string }
  | { form: 'curly'; expr: string }
  | { form: 'boolean' }

/**
 * Parse a .aihu source string to its structured AST.
 *
 * Thin wrapper over the Rust binary (mirrors `transform()`): spawns
 * `aihu-compile --stdin --tag <stem> --ast-json`, feeds `source` on stdin, and
 * `JSON.parse`s stdout. `id` is optional and only used to derive the tag stem
 * and the `--path` arg (for `@route` C500 checks), identical to `transform()`.
 *
 * Throws on parse failure — the Rust binary exits non-zero and `execFileSync`
 * surfaces the diagnostic (same error path as `transform()`).
 */
/**
 * Compile an SFC to its TYPE-CHECK SURFACE and return it as a string — the
 * `.aihu.ts` sidecar's content, without writing a file.
 *
 * This is the in-memory path `aihu-tsc` uses to hand `.aihu` files to TypeScript
 * as virtual files. The surface is line-preserving: line N of the returned text
 * corresponds to line N of the `.aihu` source, which is what lets a `tsc`
 * diagnostic be mapped straight back to the line the author wrote.
 *
 * Returns `''` when the SFC has no `@template` (nothing to check).
 */
export function compileSidecar(
  source: string,
  id?: string,
  options?: {
    /**
     * #486 step 4 — emit the attribute/component-prop type layer
     * (`--strict-templates`). Default off: the surface stays byte-identical
     * to the pre-#486 sidecar.
     */
    strictTemplates?: boolean
    /**
     * Build target threaded to the compiler binary (`--target`), same flag
     * `transform()` passes. Defaults to the binary's own default
     * (`universal`) when omitted.
     *
     * This is NOT cosmetic: `--target` changes what `compile_full_with_options`
     * produces (packages/compiler/src/bin/main.rs), which `sidecar_ts` is
     * derived from — e.g. a `target: 'client'` build elides server-only
     * artifacts. A caller that never passes this always type-checks against
     * the `universal` surface regardless of the project's actual configured
     * target, which can pass tsc on code the real build would elide or
     * reject. `islands`/`shadowMode` are deliberately NOT parameters here:
     * both are applied as JS-side post-processing on the RUNTIME JS output
     * (see `transform()`), never touch `sidecar_ts`, and have no bearing on
     * type-check accuracy.
     */
    target?: 'client' | 'server' | 'universal'
  },
): string {
  const stem = id ? basename(id, '.aihu') : 'Component'
  const args = ['--stdin', '--tag', stem, '--sidecar-stdout']
  if (id) {
    args.push('--path', id)
  }
  if (options?.strictTemplates) {
    args.push('--strict-templates')
  }
  if (options?.target) {
    args.push('--target', options.target)
  }
  // Bounded — an unbounded spawn here is the hang that left two
  // `aihu-compile --stdin` children alive for 2.5 days. See spawn-bounds.ts.
  const bin = resolveBinPath()
  const startedAt = Date.now()
  try {
    return execFileSync(bin, args, {
      input: source,
      encoding: 'utf8',
      // Capture stderr rather than inheriting it: the compiler's warnings (unhyphenated
      // tag names, undeclared cross-block refs) belong to `aihu build`, and would
      // otherwise interleave with the type diagnostics a caller is trying to read.
      // A hard compile failure still throws, carrying the message with it.
      stdio: ['pipe', 'pipe', 'pipe'],
      ...compileSpawnBounds(source.length),
    })
  } catch (err) {
    throw describeSpawnFailure(err, bin, args, source.length, Date.now() - startedAt) ?? err
  }
}

export function compileToAst(source: string, id?: string): SfcAst {
  const stem = id ? basename(id, '.aihu') : 'Component'
  const args = ['--stdin', '--tag', stem, '--ast-json']
  if (id) {
    args.push('--path', id)
  }
  // Memoised (same key discipline as `transform()`): css-engine's `compileSfc`
  // re-derives the AST per file — with the memo, the second parse of an
  // unchanged file is a lookup, and a preceding `transform()` of the same
  // source has usually SEEDED this exact entry from its envelope (one parse
  // for js + ast + route). The cached value is the raw JSON string; parse per
  // call so callers can never mutate a shared AST object.
  const stamp = _backendStampPath()
  const json = _memoizedSpawn('ast', source, id ?? '', '', stamp, () => {
    const reply = _compileViaBackend(source, args, {
      tag: stem,
      ...(id ? { path: id } : {}),
      emits: ['ast'],
    })
    if (reply.kind === 'legacy') return reply.output
    const ast = reply.envelope.astJson
    if (ast === undefined) {
      throw new Error('[@aihu/compiler] envelope reply missing astJson')
    }
    return ast
  })
  return JSON.parse(json) as SfcAst
}

/**
 * Structured `@route` metadata (the `.route.json` sidecar shape). All fields
 * optional — only what the SFC's `@route` block declares is present. `head` is
 * left opaque here (the router owns its shape).
 */
export interface RouteMeta {
  pattern?: string
  name?: string
  layout?: string
  middleware?: string[]
  ssr?: boolean
  params?: string[]
  head?: unknown
  /**
   * GX Phase 1 fan-out (#437-GX): the resolved `extract` policy — always
   * present in the binary's route-json output since 0.1.12 (the default is
   * recorded, never implied by absence). Typed loose here: consumers
   * normalize fail-closed (`deriveReadPolicy` in `@aihu/server`).
   */
  extract?: { read?: unknown; call?: unknown }
  /**
   * GX Phase 4 fan-out (#466): the `data:` governed-resource declaration
   * (70-governed-data-access §2.1) — present only when the route declares one
   * (0.1.14+). `type` keys the server registry's provider; `preview` lists
   * the locked-state fields (omitted when none declared). Consumers: the
   * server runtime's boot validation + generated loader, and the router Vite
   * layer's C486 sibling-loader conflict check (§4.7).
   */
  data?: { type?: string; preview?: string[] }
}

/**
 * Parse a `.aihu` source string and return its `@route` metadata, or `null`
 * when the SFC declares no `@route` block.
 *
 * Thin wrapper over the Rust binary (mirrors {@link compileToAst}): spawns
 * `aihu-compile --stdin --tag <stem> --route-json`, feeds `source` on stdin,
 * and `JSON.parse`s stdout. This is how build tools recover full route
 * metadata (`head`/`middleware`/`params`/`ssr`/`layout`) for the SPA build
 * path, where no `.route.json` sidecar is written to disk.
 *
 * Throws on parse failure (same error path as `transform()`/`compileToAst()`).
 */
export function compileRouteMeta(source: string, id?: string): RouteMeta | null {
  const stem = id ? basename(id, '.aihu') : 'Component'
  const args = ['--stdin', '--tag', stem, '--route-json']
  if (id) {
    args.push('--path', id)
  }
  // Memoised (same key discipline as `transform()`): the router Vite plugin
  // calls this per route file per scan, and the SSG prerender's second server
  // triggers a full re-scan — and a preceding `transform()` of the same
  // source has usually SEEDED this entry from its envelope. Cache the raw
  // stdout; parse per call.
  const stamp = _backendStampPath()
  const out = _memoizedSpawn('route', source, id ?? '', '', stamp, () => {
    const reply = _compileViaBackend(source, args, {
      tag: stem,
      ...(id ? { path: id } : {}),
      emits: ['route'],
    })
    if (reply.kind === 'legacy') return reply.output
    return reply.envelope.routeJson ?? 'null'
  }).trim()
  if (out === '' || out === 'null') return null
  return JSON.parse(out) as RouteMeta
}

/**
 * Inject `_setMount(mount)` + `_setSignal(signal)` auto-wiring into a compiled
 * `.aihu` module. Adds the necessary symbols to existing imports and inserts
 * the boot calls right after the last `import` statement.
 *
 * @internal
 */
export function _injectAutoWiring(code: string): string {
  // 1. Add `mount` to the @aihu/arbor import (or create it).
  let result: string
  if (code.includes("from '@aihu/arbor'")) {
    result = code.replace(
      /import\s*\{([^{}]*)\}\s*from\s*'@aihu\/arbor'/,
      (_m: string, imports: string) => {
        const parts = imports
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        if (!parts.includes('mount')) parts.push('mount')
        return `import { ${parts.join(', ')} } from '@aihu/arbor'`
      },
    )
  } else {
    result = `import { mount } from '@aihu/arbor'\n${code}`
  }

  // 2. Add `signal` to the non-type @aihu/signals import (or create it).
  // Note: `import\s+\{` does NOT match `import type {` (the regex needs `{` immediately
  // after whitespace, whereas `import type {` has `type` in between).  No negation guard
  // is needed — the replace callback below already skips `import type` lines.
  if (/import\s+\{[^{}]*\}\s+from\s+'@aihu\/signals'/.test(result)) {
    // There IS a value import from signals — add `signal` if missing.
    result = result.replace(
      /import\s*\{([^{}]*)\}\s*from\s*'@aihu\/signals'/,
      (_m: string, imports: string) => {
        // Skip type-only imports
        if (_m.startsWith('import type')) return _m
        const parts = imports
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        if (!parts.includes('signal')) parts.push('signal')
        return `import { ${parts.join(', ')} } from '@aihu/signals'`
      },
    )
  } else if (!/^[^\S\n]*import\b[^\n]*from[^\S\n]*'@aihu\/signals'/m.test(result)) {
    // No signals import at all — insert after arbor import
    result = result.replace(
      /import\s*\{[^{}]*\}\s*from\s*'@aihu\/arbor'/,
      (m: string) => `${m}\nimport { signal } from '@aihu/signals'`,
    )
  }
  // If only `import type { Signal }` exists, insert value import after it
  else if (
    /import\s+type\s+\{[^{}]*\}\s+from\s+'@aihu\/signals'/.test(result) &&
    !result.match(/import\s+\{[^{}]*\}\s+from\s+'@aihu\/signals'/)
  ) {
    result = result.replace(
      /(import\s+type\s+\{[^{}]*\}\s+from\s+'@aihu\/signals')/,
      (_m: string, typeImport: string) => `${typeImport}\nimport { signal } from '@aihu/signals'`,
    )
  }

  // 3. Add `_setMount`, `_setSignal` to the @aihu/runtime import.
  result = result.replace(
    /import\s*\{([^{}]*)\}\s*from\s*'@aihu\/runtime'/,
    (_m: string, imports: string) => {
      const parts = imports
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (!parts.includes('_setMount')) parts.push('_setMount')
      if (!parts.includes('_setSignal')) parts.push('_setSignal')
      return `import { ${parts.join(', ')} } from '@aihu/runtime'`
    },
  )

  // 4. Insert boot calls after the last `import` statement.
  const lines = result.split('\n')
  let lastImportIdx = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = (lines[i] ?? '').trim()
    if (t.startsWith('import ') || t.startsWith('import{')) {
      lastImportIdx = i
      break
    }
  }
  if (lastImportIdx !== -1) {
    lines.splice(lastImportIdx + 1, 0, '_setMount(mount)', '_setSignal(signal)', '')
    result = lines.join('\n')
  }

  return result
}

/**
 * Vite plugin that compiles .aihu files to TypeScript during build and dev.
 *
 * Use `enforce: 'pre'` so the hook fires before Vite/Rollup's built-in
 * parsers attempt to process the raw .aihu content as JavaScript.
 *
 * @example
 * // vite.config.ts
 * import { aihuCompilerPlugin } from '@aihu/compiler'
 * export default { plugins: [aihuCompilerPlugin()] }
 *
 * **Known Limitation — Bun + Rollup4 ESM incompatibility (v0):**
 *
 * `bun vite build` fails in the `fixtures/vite-counter` fixture with two
 * cascading errors:
 *
 * 1. **Missing devDependency:** `vite` is declared only as an optional
 *    `peerDependency` in `packages/compiler/package.json`. Bun does not
 *    install optional peers automatically, so `bun vite build` exits
 *    immediately with `Cannot find package 'vite'`.
 *
 * 2. **Bun + Rollup4 bridge:** Even with Vite installed, Bun processes
 *    `vite.config.ts` through its own internal bundler before handing off
 *    to Rollup4. When `@aihu/compiler` is resolved from the workspace
 *    symlink (`dist/index.js`), Bun's ESM loader evaluates the module at
 *    config-load time. The subprocess call inside `transform()` depends on
 *    the Rust binary being at `../bin/aihu-compile` relative to `dist/`
 *    (written by the postinstall hook). In a dev workspace where postinstall
 *    has not run, this path does not exist and `execFileSync` throws. Bun surfaces
 *    the error as a config-load failure, not a per-file transform error,
 *    causing the entire build to abort before any `.aihu` file is
 *    processed.
 *
 * **Workaround (v0):** Use `bun run integrate.ts` directly from
 * `packages/compiler/fixtures/vite-counter/`. This script calls
 * `transform()` from `@aihu/compiler` without involving Vite or Rollup.
 * Preconditions: (1) `cargo build --release` in `packages/compiler/`,
 * (2) `bun install` at the repo root.
 *
 * **v1 resolution:** Add `vite` as a `devDependency` in
 * `packages/compiler/package.json`; add a WASM or pre-built binary
 * strategy so the Rust binary is bundled with the npm package and does not
 * require a separate `cargo build --release` step.
 */
/**
 * Minimal structural type for the `@aihu/css-engine` module surface this
 * plugin uses. Declared locally so the compiler never type-imports the
 * css-engine package (which would create a compile-time edge against an
 * optional peer that may be absent).
 *
 * @internal
 */
interface CssEngineModule {
  compileSfc(source: string, id?: string, lightScopeId?: string): string
}

// Memoised resolution of the optional `@aihu/css-engine` peer. `undefined`
// = not yet attempted; `null` = attempted and unavailable (no-op path);
// a module object = available. The dynamic import is attempted once per
// process — repeated absence does not re-pay the resolution cost.
let _cssEngine: CssEngineModule | null | undefined

// Whether we've already surfaced a one-shot warning that css-engine resolved
// but `compileSfc` threw (typically: native css-core binary unresolvable in
// the consumer's install — e.g. lockfile pins the per-platform placeholder
// version). The transform stays non-fatal, but going fully silent leaves users
// chasing "why did my utility classes never emit?". One warn per process.
let _cssEngineWarned = false

// The optional-peer module specifier, held in a VARIABLE so TypeScript never
// statically resolves `@aihu/css-engine`'s declarations at typecheck time.
// css-engine depends on @aihu/compiler for its AST, so the two form a
// circular package relationship; under CI's frozen install + moon build
// ordering, css-engine's `dist`/`.d.ts` are not guaranteed to exist when
// `compiler:typecheck` runs. A literal `import('@aihu/css-engine')` makes the
// compiler emit TS2307 in that window (the `as` cast affects the RESULT type
// only, not whether TS attempts module resolution). Resolving through this
// variable keeps the import fully dynamic — no compile-time edge on the peer.
const _CSS_ENGINE_SPECIFIER = '@aihu/css-engine'

/**
 * Resolve the optional CSS engine from the compiler package first, then from
 * the Vite consumer. Package managers commonly realpath a published plugin
 * into their store, where an optional peer is not a physical sibling even
 * though the application has installed it. The consumer fallback keeps the
 * integration opt-in while making published and workspace compiler builds
 * behave the same way.
 */
async function _loadCssEngine(): Promise<CssEngineModule | null> {
  try {
    return (await import(_CSS_ENGINE_SPECIFIER)) as unknown as CssEngineModule
  } catch {
    try {
      const fromConsumer = createRequire(join(process.cwd(), 'package.json'))
      const entry = fromConsumer.resolve(_CSS_ENGINE_SPECIFIER)
      return (await import(pathToFileURL(entry).href)) as unknown as CssEngineModule
    } catch {
      return null
    }
  }
}

/**
 * Lazily resolve `@aihu/css-engine` and compile a `.aihu` source's utility
 * classes to scoped CSS. Returns `''` when css-engine is not installed
 * (the optional-peer no-op path) or when compilation fails for any reason —
 * a CSS-engine failure MUST NOT break an otherwise-valid `.aihu` build.
 *
 * Sets `process.env.AIHU_COMPILE_BIN` to this plugin's resolved compiler
 * binary before calling `compileSfc`: css-engine re-derives the SFC AST via
 * its own bundled copy of `compileToAst`, whose binary path is resolved
 * relative to the css-engine package — which does NOT ship the compiler
 * binary. Pointing it at our `binPath` guarantees the AST css-engine parses
 * is produced by the exact same compiler this build uses.
 *
 * @internal
 */
async function _maybeCompileUtilityCss(
  source: string,
  id: string,
  lightScopeId?: string,
): Promise<string> {
  if (_cssEngine === null) return ''
  // Ensure css-engine's bundled `compileToAst` spawns the SAME compiler
  // binary this plugin uses (it has no compiler binary of its own). Set
  // this BEFORE the dynamic import so that any module-load-time evaluation
  // of `process.env.AIHU_COMPILE_BIN` in css-engine's bundled dist (older
  // bundles capture this into a module-scope const at line 8 of
  // `packages/css-engine/dist/index.js`) sees the correct value. After Bug 6,
  // the source `compileToAst` resolves the bin lazily on each call, so once
  // css-engine is rebuilt this set-before-import is belt-and-braces.
  if (process.env.AIHU_COMPILE_BIN == null) {
    try {
      process.env.AIHU_COMPILE_BIN = resolveBinPath()
    } catch {
      // No CLI binary resolvable (e.g. an addon-only install). css-engine's
      // NEWER bundles route compileToAst through the same native backend and
      // never read this var; older bundles will surface their own resolver
      // error, which the compileSfc try/catch below already treats as the
      // non-fatal no-op path.
    }
  }
  if (_cssEngine === undefined) {
    // Guarded, lazy, OPTIONAL — resolving through `_CSS_ENGINE_SPECIFIER`
    // keeps TypeScript from taking a compile-time dependency on css-engine.
    _cssEngine = await _loadCssEngine()
    if (_cssEngine === null) return ''
  }
  try {
    return _cssEngine.compileSfc(source, id, lightScopeId)
  } catch (err) {
    // A css-engine compile failure is non-fatal: fall back to the no-op
    // path (utility classes don't emit) rather than aborting the build.
    // BUT — silently swallowing this means a user who clearly intends
    // css-engine to be active (the peer resolved) will never know their
    // utility classes are inert. Surface a one-shot warning with the
    // underlying error + an install/upgrade hint. Idempotent per process.
    if (!_cssEngineWarned) {
      _cssEngineWarned = true
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(
        `[@aihu/compiler] @aihu/css-engine is installed but compileSfc() failed; ` +
          `utility classes will not emit. Original error: ${msg}\n` +
          `Hint: ensure the native css-core binary is installed ` +
          `(install/upgrade @aihu/css-engine + its per-platform optional dep, ` +
          `or run \`cargo build --release -p aihu-css-core\` in a dev clone).`,
      )
    }
    return ''
  }
}

export function aihuCompilerPlugin(options?: AihuCompilerPluginOptions): VitePlugin {
  const islandsEnabled = options?.islands !== false
  const shadowMode = options?.shadowMode
  const target = options?.target
  const layoutsDir = options?.layoutsDir ?? 'src/layouts'

  // Bug 6 — per-instance store of virtual utility-CSS modules. Keyed by the
  // full virtual id (NUL-prefixed). Populated by the transform hook when
  // `shadowMode === 'light'` produces utility CSS; drained by the `load` hook
  // when Vite's CSS pipeline asks for the module body. Lives on the plugin
  // instance so multiple `aihuCompilerPlugin()` calls in the same build don't
  // alias each other's css.
  const utilityCssStore = new Map<string, string>()

  // GX Phase 1 (#437-GX) — per-instance extract census. Keyed by rawId,
  // populated in transform from the compiler's `// @aihu:extract` marker;
  // printed per-value in buildEnd. Every build prints the posture
  // distribution (the DA-e census pattern from #437).
  const extractCensus = new Map<string, { read: string; call: string }>()

  return {
    name: 'aihu-compiler',
    enforce: 'pre',
    buildEnd() {
      for (const line of _formatExtractCensus(extractCensus)) console.info(line)
    },
    resolveId(source) {
      // Own all `\0virtual:aihu-utility/<hash>.css` ids so Vite's resolver
      // doesn't try to find them on disk. Returning the id verbatim is the
      // Rollup convention for "I'll handle the load."
      if (source.startsWith(VIRTUAL_UTILITY_PREFIX)) return source
      return null
    },
    load(id) {
      if (!id.startsWith(VIRTUAL_UTILITY_PREFIX)) return null
      // Vite's CSS pipeline runs on the returned source because the id ends
      // in `.css` — it parses, minifies (in build), and hoists into a CSS
      // asset chunk that lands in `dist/assets/<name>-<hash>.css`.
      return utilityCssStore.get(id) ?? null
    },
    transform(code, id) {
      // Strip Vite query strings (e.g. `?import`, `?t=...`) before checking the extension.
      const rawId = id.split('?')[0]!
      if (!rawId.endsWith('.aihu')) return
      // Server-environment detection (Vite Environment API). A `.aihu` loaded
      // through an SSR module runner — the `output: 'static'` prerender's
      // `ssrLoadModule` (packages/app/src/prerender.ts), or any `vite dev` SSR
      // consumer — must NOT get the client/universal target: that emits a
      // module-level `new CSSStyleSheet()` and an unguarded `customElements`
      // registration, both of which throw in the DOM-less SSR runner
      // (`CSSStyleSheet is not defined`) and silently degrade the prerender to
      // an empty SPA shell. The `server` target guards DOM registration behind
      // `typeof customElements` and exports `__ssr` (a host-less arbor factory)
      // plus the `__aihu_ssr_string__` compiled string fast path that
      // @aihu/server's `renderToString` prefers — a pure string concatenation
      // that needs no DOM. An explicit `target` option still wins (a caller
      // that pins a target owns the consequences); we only fill the SSR default
      // when none was configured. `this.environment` is absent on pre-Environment
      // -API Vite, in which case the prior universal default stands.
      const isServerEnv =
        (this as { environment?: { config?: { consumer?: string } } })?.environment?.config
          ?.consumer === 'server'
      const effectiveTarget = target ?? (isServerEnv ? 'server' : undefined)
      return (async () => {
        // No `.aihu.ts` sidecar is written any more. Type-checking goes through
        // `aihu-tsc`, which projects each `.aihu` into the TypeScript program as a
        // VIRTUAL file — so the type-check surface never lands on disk beside the
        // source, where authors saw it, editors indexed it, and `.gitignore` had to
        // hide it. A build has no business writing type-checker inputs at all.
        //
        // Layout SFCs (under the layouts dir) compile in layout mode: a
        // namespaced `aihu-layout-<stem>` tag + a passive <outlet> marker.
        const isLayout = _isLayoutFile(rawId, layoutsDir)
        const layoutTag = isLayout ? _layoutTag(basename(rawId, '.aihu')) : undefined
        const tOpts = {
          ...(effectiveTarget ? { target: effectiveTarget } : {}),
          ...(layoutTag ? { tag: layoutTag } : {}),
        }
        const result = transform(code, rawId, tOpts)
        // GX Phase 1 (#437-GX) — record this surface's resolved extract policy
        // for the build census (client-target builds carry no marker: policy
        // never reaches client artifacts).
        const extractMarker = _parseExtractMarker(result.code)
        if (extractMarker) extractCensus.set(rawId, extractMarker)
        // §9.4 per-file shadow override: the Rust `$shadow` macro emits a leading
        // `// @aihu:shadow <mode>` marker; it wins over the plugin's global
        // shadowMode and drives BOTH _injectShadowMode and the css fold branch.
        const perFileShadow = /^\/\/ @aihu:shadow (light|shadow)\b/m.exec(result.code)?.[1] as
          | 'light'
          | 'shadow'
          | undefined
        // DA4 (#437, the ratified flip) — the IMPLICIT page default: for an
        // `@route` unit with no `$shadow` pin the compiler emits the DISTINCT
        // default-marker token `// @aihu:shadow-default light`. Layout SFCs
        // (no `@route` block, so no compiler marker) get the same 'light'
        // default from `_isLayoutFile`. Precedence, ratified: `$shadow` pin >
        // plugin-global `shadowMode` config > page/layout default 'light' >
        // leaf default 'shadow' (the runtime's `?? 'shadow'` when nothing is
        // injected) — so an explicit plugin-global config still outranks the
        // implicit default, which is why this is not the pin marker.
        const perFileShadowDefault = /^\/\/ @aihu:shadow-default (light|shadow)\b/m.exec(
          result.code,
        )?.[1] as 'light' | 'shadow' | undefined
        const impliedShadowDefault = perFileShadowDefault ?? (isLayout ? 'light' : undefined)
        const effectiveShadow = perFileShadow ?? shadowMode ?? impliedShadowDefault

        // Light-DOM leaf flip prep (LDF §10 step 1/3): a deterministic scope
        // id for this component's `data-a` attribute, only when it actually
        // resolved to light mode. `undefined` in the shadow case — mirrors
        // `SfcAst.light_scope_id: Option<String>` being `None` on the Rust
        // side. Computed BEFORE the shadowMode injection below so it can
        // ride in the SAME injected options object (`_injectShadowMode`'s
        // doc comment explains why one merged injection, not two).
        const lightScopeId = effectiveShadow === 'light' ? _lightScopeId(rawId) : undefined

        let compiled =
          effectiveShadow != null
            ? _injectShadowMode(result.code, effectiveShadow, lightScopeId)
            : result.code
        // LDF §10 step 3, server side: fill the Rust codegen's
        // `__AIHU_LIGHT_SCOPE_ID__` placeholder so the compiled `__ssrString`
        // stamps `data-a` on its own root by default (no-op when the target
        // carries no string renderer).
        if (lightScopeId) compiled = _injectLightScopeId(compiled, lightScopeId)
        // Light-DOM: the authored `@style` block compiled to a per-instance
        // `host.adoptedStyleSheets` assignment, but a light-DOM host has no
        // shadow root so that setter is a no-op. Redirect the module-level
        // sheet to `document.adoptedStyleSheets` (idempotent) so authored recipe
        // CSS reaches the global cascade alongside the css-engine utility CSS.
        if (effectiveShadow === 'light') compiled = _globalizeAuthoredStyle(compiled)
        if (isLayout) compiled = _passivizeOutlet(compiled)

        // ── css-engine hook (optional, lazy, no circular dep) ──────────────
        // @aihu/css-engine depends on @aihu/compiler (for its AST), so the
        // compiler MUST NOT hard-depend on it. It is declared an OPTIONAL
        // peerDependency and pulled in ONLY via this guarded dynamic import:
        // when present, we compile the SFC's utility classes to scoped CSS
        // and fold it into the component's shadow `<style>`; when absent the
        // import throws and we no-op (utility classes simply don't emit —
        // the pre-hook behaviour). This keeps css-engine an opt-in enhancement
        // with zero dependency cycle.
        const utilityCss = await _maybeCompileUtilityCss(code, rawId, lightScopeId)
        if (utilityCss) {
          if (effectiveShadow === 'light') {
            // Bug 6 — no shadow root → `host.adoptedStyleSheets` is a no-op.
            // Route utility CSS through Vite's CSS pipeline via a virtual
            // `.css` import so it lands in `dist/assets/*.css` and reaches the
            // global cascade. The authored `@style` block (if any) still
            // emits via the Rust codegen's normal path and is unaffected.
            const folded = _foldCssEngineStylesGlobal(compiled, utilityCss, rawId)
            if (folded) {
              utilityCssStore.set(folded.virtualId, utilityCss)
              compiled = folded.code
            }
          } else {
            // `shadowMode: 'shadow'`: fold into the
            // per-component `CSSStyleSheet` adopted by the shadow root.
            compiled = _foldCssEngineStyles(compiled, utilityCss)
            // …and into the SERVER target's `__aihu_css__`, which carries the
            // same rules into the declarative shadow template. A shadow root is
            // style-isolated, so anything missing here paints unstyled until
            // the component's chunk loads.
            if (isServerEnv) compiled = _foldSsrCssExport(compiled, utilityCss)
          }
        }

        const elementTag = _extractElementTag(compiled)

        let out: string

        // §9.4 — a base-extending recipe (`defineComponent({ base: X, ... })`)
        // MUST take the full defineComponent/defineElement path: the static
        // island shim inlines `class extends HTMLElement` and cannot honor a
        // base class. Force-classify it interactive regardless of signal usage.
        const hasBase = _hasBaseRecipe(compiled)

        // Plan 3.3 — static-island fast path. Bypasses HMR injection because
        // a component with no signals has no setup state to hot-replace.
        // Static islands strip @aihu/runtime entirely — do NOT inject auto-wiring
        // (it would reference _setMount/_setSignal as undefined identifiers).
        //
        // DA4 (#437): like `hasBase`, a light-DOM component cannot take the
        // static-island shim — the shim inlines `attachShadow({ mode: 'open' })`
        // and cannot honor `shadowMode: 'light'` (and its tail rewrite does not
        // match the injected options argument). Keep the full runtime path so
        // the injected `{ shadowMode: 'light' }` reaches defineElement.
        if (isServerEnv) {
          // Server module-runner target (the SSG prerender's `ssrLoadModule`,
          // any dev-SSR consumer). The `server` compile target already exports
          // the host-less `__ssr` factory + the `__aihu_ssr_string__` string
          // fast path and guards its own custom-element registration behind
          // `typeof customElements`. The client-only instrumentation below is
          // wrong here: HMR (`_buildHmrCode`) prepends a `let __aihu_setup__`
          // slot that COLLIDES with the server target's named
          // `const __aihu_setup__` (duplicate declaration); the static-island
          // shim, `defer` hydration, and auto-wiring all inject browser mount
          // code the SSR render never runs. Emit the server target as-is; the
          // TS-strip below still applies.
          out = compiled
          // LDF §10 step 3, server side: expose the compiler-assigned light-DOM
          // scope id so an SSR/SSG caller (e.g. `@aihu/app`'s prerender) can
          // pass it to `renderToString` as `SsrOptions.lightScopeId` and stamp
          // `data-a` on the prerendered root. This is the SAME id the client
          // transform injects into `defineElement` options and the css fold
          // wrote into the emitted `@scope([data-a="…"])` blocks — exporting it
          // from the compiled module keeps a single source of truth (no
          // consumer ever re-derives the hash). Server target only: the client
          // runtime stamps at `connectedCallback` and needs no export.
          if (lightScopeId) {
            out += `\nexport const __aihu_light_scope__ = '${lightScopeId}'\n`
          }
          // The component's registered custom-element tag, exported for the
          // same reason and on the same channel as the scope id above.
          //
          // SSR renders a component's TEMPLATE, not the component: the output
          // is the template root (`<div class="dn-docs">`), while the client
          // builds `document.createElement('aihu-layout-docs')` and puts the
          // template inside it. The two shapes therefore never match, so the
          // client cannot adopt the prerendered subtree and replaces it
          // wholesale — measured on apps/docs: 0 of 391 prerendered nodes
          // survive hydration.
          //
          // Exporting the tag lets an SSG/SSR caller wrap the render in the
          // real host element (`SsrOptions.wrapTag`). It also puts `data-a`
          // where the client puts it: `define-element.ts` stamps the HOST in
          // its constructor, and its comment already asserts "a server-rendered
          // element already carries `data-a`" — which only becomes true once
          // the host exists in server output.
          if (elementTag !== null) {
            out += `\nexport const __aihu_tag__ = '${elementTag}'\n`
          }
          // The component's RESOLVED shadow mode, on the same channel and for
          // the same single-source reason as the two exports above.
          //
          // An SSR caller rendering a nested custom element has to emit two
          // different shapes: a light-DOM component's tree is the host's own
          // children, while a shadow component's tree belongs inside a
          // `<template shadowrootmode="open">` so the browser attaches a
          // declarative shadow root while parsing. Getting that wrong is not a
          // cosmetic error — light children under a host that later calls
          // `attachShadow` are discarded on upgrade ("adopt or discard, never
          // slot-project", define-component.ts), so the content would paint and
          // then vanish.
          //
          // `effectiveShadow` is the value that ALREADY drives both
          // `_injectShadowMode` and the css-fold branch, so exporting it keeps
          // one resolution (plugin config > per-file directive > page/layout
          // default) rather than letting a consumer re-derive from the presence
          // of `__aihu_light_scope__` — which is an inference, not a signal.
          //
          // Deliberately aihu's OWN vocabulary ('light' | 'shadow'), never the
          // DOM's ShadowRootMode ('open' | 'closed'). Those are different enums
          // that share the word "mode"; the translation to `shadowrootmode`
          // happens once, at serialization, in the renderer.
          // Guarded on non-null for the same reason `_injectShadowMode` is
          // (`effectiveShadow != null`, below): when no mode resolves there is
          // nothing to assert, and emitting the string 'undefined' would be a
          // lie a consumer would branch on.
          if (effectiveShadow != null) {
            out += `\nexport const __aihu_shadow__ = '${effectiveShadow}'\n`
          }
          // Every component tag this module's template references, on the same
          // channel as the three exports above. `buildChildRegistry`
          // (`@aihu/server`) reads it as the edge set for its cycle check over
          // the WHOLE discovered component graph — not a per-page transitive
          // walk; the caller indexes every discovered module once rather than
          // loading a subset by following these tags (see child-registry.ts's
          // module docblock for why). A cycle found there is reported, not
          // rejected: `__aihu_schild` bounds it with a depth cap and an output
          // budget, so a build no longer has to refuse a legal recursive shape
          // to stay safe.
          //
          // DERIVED FROM THE EMITTED CALLS, not re-computed from the template.
          // The set that matters is precisely the set of tags the compiled
          // renderer will look up at runtime, and reading the `__aihu_schild`
          // call sites IS that set. Deriving it a second way — walking the
          // template again and reapplying the emitter's v1 boundaries (no
          // attrs, no children, static non-root path) — would be one rule
          // written in two places, and the halves would drift the first time a
          // boundary moved. The parity test in
          // `packages/compiler/tests/light-scope-export.test.ts` (the
          // `__aihu_child_tags__ export` describe block) pins that the export
          // and the call sites agree.
          //
          // Omitted entirely when the template references no component, so a
          // consumer can treat "no export" and "empty" identically.
          //
          // This set answers ONE question — "what will the compiled renderer
          // look up?" — and `__aihu_referenced_tags__` below answers a different
          // one. The paragraph above argues against deriving THIS set a second
          // way; it is not an argument against a second, differently-defined
          // set, and the two must not be collapsed. See below.
          // ONE shared derivation — `_deriveChildTags`, which `@aihu/router`'s
          // `genSC` calls on the same channel to build the server-bundle
          // component registry at codegen time. See its docblock.
          const childTags = _deriveChildTags(out)
          if (childTags.length > 0) {
            out += `\nexport const __aihu_child_tags__ = ${JSON.stringify(childTags)}\n`
          }
          // §22 — every component tag this module's template REFERENCES, which
          // is a strictly larger set than `__aihu_child_tags__` above and exists
          // for a different consumer.
          //
          // `__aihu_child_tags__` is the runtime edge set: the tags the compiled
          // renderer will actually look up, which is why deriving it from the
          // emitted `__aihu_schild(` call sites is not just convenient but
          // CORRECT for its consumer (`buildChildRegistry`'s cycle check).
          //
          // But `@aihu/app`'s prerender reads a tag set for two DIAGNOSTICS —
          // "is this broken component referenced by anything?" and "is this tag
          // resolvable?" — and for those questions the call-site set is the
          // wrong one. A reference the emitter DECLINES under the v1 child
          // boundaries (an attribute, children, a root/dynamic path) produces no
          // call site and therefore no tag, so the component is judged
          // unreferenced and the diagnostic stays silent about a component that
          // genuinely cannot load. Observed: `apps/docs`'s `pages/index.aihu`
          // references `<weather-demo city="London">`, the attribute makes the
          // emitter decline it, the page compiles to ZERO `__aihu_schild` call
          // sites — and `weather-demo.aihu` really does fail to load under SSR
          // (`new CSSStyleSheet()` at module top level) with the build saying
          // nothing.
          //
          // So: two exports, two meanings, two derivations — NOT one rule
          // written twice. This one comes from the template AST, via the
          // `// @aihu:component-tags` marker `collect_component_tags` emits (the
          // same walk that fills `route.json`'s components array), so it is
          // independent of where the emitter's boundaries happen to sit and does
          // not move when they do.
          //
          // Parsed from `compiled`, NOT `out`: the marker is a comment the Rust
          // codegen emits, and the TS-strip at the end of this hook is free to
          // drop comments. `_parseIslandMarker(compiled)` reads the same channel
          // the same way for the same reason.
          //
          // Omitted entirely when the marker is absent or empty, so "no export"
          // and "empty" mean the same thing — the rule `__aihu_child_tags__`
          // already follows.
          const referencedTags = _parseComponentTagsMarker(compiled)
          if (referencedTags.length > 0) {
            out += `\nexport const __aihu_referenced_tags__ = ${JSON.stringify(referencedTags)}\n`
          }
        } else if (
          islandsEnabled &&
          elementTag !== null &&
          !hasBase &&
          effectiveShadow !== 'light' &&
          _parseIslandMarker(compiled) === 'static'
        ) {
          out = _buildStaticIsland(compiled, elementTag)
        } else if (elementTag !== null) {
          // Inject HMR instrumentation. The injected block is gated on
          // `typeof __DEV__ !== 'undefined' && __DEV__` so production
          // bundlers dead-code-eliminate it when they set __DEV__ = false.
          out = _buildHmrCode(compiled, elementTag)
          // Plan 3.3 — interactive islands also gain `defer` attribute
          // support so individual instances can opt into lazy hydration.
          out = _buildDeferredHydration(out, elementTag)
          // Inject auto-wiring so consumers don't need a manual main.ts bootstrap.
          out = _injectAutoWiring(out)
        } else {
          out = compiled
          // Inject auto-wiring so consumers don't need a manual main.ts bootstrap.
          out = _injectAutoWiring(out)
        }

        // The Rust compiler emits TypeScript (type casts, import type, etc.) and
        // the injected HMR / defer helpers also contain TS generics and casts.
        // Vite does NOT re-run its TS-strip step when a plugin returns code for a
        // non-.ts ID, so we must strip types ourselves before returning.
        //
        // TWO steps with SEPARATE failure handling, and the split is the whole
        // point. `import('vite')` is the ONLY one whose failure is legitimate —
        // a standalone `transform()` caller, a unit test, any host that is not a
        // Vite build has no Vite to strip with, and handing the TypeScript back
        // untouched is the correct answer there. Everything AFTER that import
        // runs with Vite proven present, so a failure there means the STRIP
        // broke, and swallowing it returns un-stripped TypeScript that
        // resurfaces hundreds of lines later as an unrelated bundler
        // `PARSE_ERROR` naming the user's `.aihu` file. One `catch` around both
        // did exactly that. `_isViteMissing` is how the two are told apart;
        // `_stripTypes` owns the branch order and the loud failures.
        let vite: typeof import('vite')
        try {
          vite = await import('vite')
        } catch (err) {
          if (_isViteMissing(err)) return { code: out, map: null }
          throw new Error(
            `[@aihu/compiler] Could not load \`vite\` to strip TypeScript from ${rawId}. ` +
              'Vite appears to be installed but failed to load, so this is NOT the ' +
              '"running outside Vite" case and the TypeScript must not be handed ' +
              `back un-stripped. Underlying error: ${_errMessage(err)}`,
            { cause: err },
          )
        }
        return await _stripTypes(vite, out, rawId, isServerEnv)
      })()
    },
  }
}
