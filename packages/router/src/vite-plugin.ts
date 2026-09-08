import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { jsSourceLiteral } from './codegen.ts'
import type { RouteHead, RouteSegment } from './router.ts'

/** @internal */
interface VitePlugin {
  name: string
  resolveId?: (id: string) => string | null | undefined
  load?: (id: string) => string | null | undefined
  configureServer?: (server: {
    watcher: { add(p: string): void; on(e: string, cb: (p: string) => void): void }
    moduleGraph: {
      getModuleById(id: string): { id: string } | undefined
      invalidateModule(m: { id: string }): void
    }
  }) => void
}

const RR = '\0virtual:aihu-routes'
const LR = '\0virtual:aihu-layouts'
const CR = '\0virtual:aihu-components'
const SCR = '\0virtual:aihu-server-components'

export interface RouterPluginOptions {
  pagesDir?: string
  /** Directory to scan for layout files. Default: 'src/layouts' */
  layoutsDir?: string
  /** Directory to scan for component files. Default: 'src/components' */
  componentsDir?: string
  /**
   * Build-time route-metadata extractor — `@aihu/compiler`'s `compileRouteMeta`.
   * When provided, `genR` uses it to recover FULL `@route` metadata
   * (`head`/`middleware`/`params`/`ssr`/`layout`) for `.aihu` pages, since the
   * stdin compile path writes no `.route.json` sidecar to disk. Wired by
   * `@aihu/app` (which pairs the compiler + router plugins). When absent (e.g.
   * standalone `viteRouterIntegration` without the compiler), `genR` falls back
   * to reading `name`+`layout` from the `@route` block via regex.
   */
  compileRouteMeta?: (source: string, id: string) => RouteSidecar | null
  /**
   * Build-time child-tag derivation — `@aihu/compiler`'s `_deriveChildTags`
   * applied to the SERVER-target compile of an SFC. Wired by `@aihu/app`
   * (which pairs the compiler + router plugins), exactly like
   * `compileRouteMeta` above and for the same reason: the router keeps zero
   * compiler dependency.
   *
   * Consumed ONLY by `genSC` (`virtual:aihu-server-components`). When absent,
   * `genSC` cannot prune and falls back to the whole component directory with
   * a warning — see its docblock.
   */
  deriveChildTags?: (source: string, id: string) => string[]
}

/** Fields from a .route.json compiler sidecar (v0.6.3). */
export interface RouteSidecar {
  name?: string
  middleware?: string[]
  ssr?: boolean
  layout?: string
  /** Declared route param names, e.g. ["slug"]. Emitted by the Rust compiler from $prop declarations. */
  params?: string[]
  /**
   * B2: per-route `<head>` metadata (compiler `head:` block). Omitted entirely
   * when a route declares no `head:`. Threaded through to RouteDefinition.head
   * and the generated `virtual:aihu-routes` module.
   */
  head?: RouteHead
  /**
   * O1a: normalized custom-element tags this route's template references
   * (e.g. `["hn-comment", "user-card"]`). Emitted by the compiler's
   * `route.json`; threaded through to RouteDefinition.components so O1c can
   * register a route's components on navigation instead of eager imports.
   */
  components?: string[]
  /**
   * GX Phase 3 (#437-GX): the compiled `extract` policy (Phase 1 fan-out —
   * always present in a v0.1.12+ `.route.json`, the default recorded, never
   * implied by absence). Values stay `unknown` here: the compiler validated
   * them (C483), but sidecars can be hand-edited, so consumers normalize
   * fail-closed via `@aihu/server`'s `deriveReadPolicy`.
   */
  extract?: { read?: unknown; call?: unknown }
  /**
   * GX Phase 4 (#466): the compiled `data:` declaration — the governed
   * resource type binding (`type` keys the provider registry) and the
   * declared locked-state `preview:` fields. INTEGRATION SEAM (Builder A):
   * the Rust compiler parses the `@route` `data:` block and fans it into
   * `.route.json` beside `extract`; this field threads it (sidecar or
   * `compileRouteMeta`) into `RouteDefinition.data`, where
   * `createServerRouter` normalizes it fail-closed (`normalizeGovernedData`).
   */
  data?: { type?: string; preview?: string[] }
}

/** Layout name → absolute file path (v0.6.8). Build-time scan result. */
export interface LayoutMap {
  [name: string]: string
}

/**
 * Runtime layout namespace convention (v0.7.5). A layout SFC's filename stem is
 * not a valid custom-element name on its own (e.g. `app` has no hyphen), so the
 * compiler registers it under `aihu-layout-<stem>`. The generated
 * `virtual:aihu-layouts` module and `@aihu/app`'s client renderer both resolve
 * the tag through this helper, so the two sides can never drift.
 *
 * KEEP IN SYNC: the `@aihu/compiler` Vite plugin derives the same tag when it
 * compiles a file under the layouts dir in the standalone compiler package.
 */
export function layoutTagFor(name: string): string {
  return `aihu-layout-${name.toLowerCase()}`
}

/**
 * Normalize a component name to its custom-element tag (O1b). Multi-word
 * PascalCase becomes kebab (`UserCard` → `user-card`, `APIClient` →
 * `api-client`); already-hyphenated names pass through lowercased. A `-` is
 * inserted before an uppercase letter when the previous char is a lowercase
 * letter or digit, OR when the previous char is uppercase and the next is
 * lowercase (acronym boundary); the result is lowercased.
 *
 * KEEP IN SYNC with `@aihu/compiler` `kebabComponentTag`
 * (the standalone compiler's JS and Rust normalizers).
 * The router deliberately does not depend on `@aihu/compiler` (same precedent
 * as `layoutTagFor` above), so this is a local copy of the algorithm.
 */
export function componentTagFor(name: string): string {
  let out = ''
  for (let i = 0; i < name.length; i++) {
    // charAt (not name[i]) returns string, never string|undefined — satisfies
    // noUncheckedIndexedAccess; charAt(i+1) yields '' past the end, matching
    // the "no next char" case.
    const c = name.charAt(i)
    if (i > 0 && c >= 'A' && c <= 'Z') {
      const prev = name.charAt(i - 1)
      const next = name.charAt(i + 1)
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

/** Strip the file extension off the LAST path segment, e.g. `a/b.aihu` →
 * `a/b`. Plain string ops, not a `\.[^/]+$/`-style regex — that shape is
 * vulnerable to catastrophic backtracking on pathological input with no
 * matching extension (CodeQL js/polynomial-redos): the engine retries the
 * greedy `[^/]+` match at every position where `\.` could start. */
function stripExtension(rel: string): string {
  const lastSlash = Math.max(rel.lastIndexOf('/'), rel.lastIndexOf('\\'))
  const lastDot = rel.lastIndexOf('.')
  return lastDot > lastSlash ? rel.slice(0, lastDot) : rel
}

function segs(rel: string): RouteSegment[] {
  const parts = stripExtension(rel)
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map(
      (p): RouteSegment =>
        p.startsWith('[...') && p.endsWith(']')
          ? { kind: 'catchall' }
          : p.startsWith('[') && p.endsWith(']')
            ? { kind: 'param', name: p.slice(1, -1) }
            : { kind: 'static', path: p },
    )
  // File-router convention: trailing `index` segment is the parent directory's root.
  // e.g. src/pages/index.aihu → /,  src/pages/posts/index.aihu → /posts
  if (parts.length > 0) {
    const last = parts[parts.length - 1]!
    if (last.kind === 'static' && last.path === 'index') parts.pop()
  }
  return parts
}

/**
 * Extract simple scalar fields from an `@route { … }` block in a `.aihu` file.
 *
 * The Vite compiler plugin compiles `.aihu` files via stdin and does NOT write
 * a `.route.json` sidecar to disk, and even if it did, `genR` runs before the
 * pages are (lazily) transformed — so `readRouteSidecar` finds nothing during a
 * normal build. To keep file-router metadata flowing without a sidecar, we read
 * the handful of simple string fields straight from the source `@route` block.
 *
 * `name` is the component/custom-element tag; `layout` is the route's layout
 * (consumed at runtime by `@aihu/app` to wrap the page). Nested/structured
 * fields (`head`, `middleware`, `params`) are NOT recovered here — those still
 * require the sidecar (e.g. the SSG/file-mode path).
 */
function readAihuRouteMeta(f: string): { name?: string; layout?: string } | null {
  if (!f.endsWith('.aihu')) return null
  try {
    const content = readFileSync(f, 'utf8')
    const block = content.match(/@route\s*\{([^}]*)\}/)
    if (!block) return null
    const body = block[1]!
    const grab = (k: string): string | undefined => {
      const m = body.match(new RegExp(`\\b${k}\\s*:\\s*["']([^"']+)["']`))
      return m ? m[1] : undefined
    }
    const meta: { name?: string; layout?: string } = {}
    const name = grab('name')
    if (name !== undefined) meta.name = name
    const layout = grab('layout')
    if (layout !== undefined) meta.layout = layout
    return meta
  } catch {
    return null
  }
}

function pat(ss: RouteSegment[]): string {
  if (!ss.length) return '/'
  return ss
    .map((s) => (s.kind === 'static' ? s.path : s.kind === 'param' ? `:${s.name}` : '*'))
    .join('/')
    .replace(/^(?!\/)/, '/')
}

/** v0.6.3: Read sibling .route.json sidecar. Build-time only. */
export function readRouteSidecar(f: string): RouteSidecar | null {
  const p = join(dirname(f), `${basename(f).replace(/\.[^.]+$/, '')}.route.json`)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as RouteSidecar
  } catch {
    return null
  }
}

/** v0.6.8: Scan layouts dir for .aihu files. Build-time only. */
export function scanLayouts(d: string): LayoutMap {
  if (!existsSync(d)) return {}
  const m: LayoutMap = {}
  for (const e of readdirSync(d, { withFileTypes: true }))
    if (e.isFile() && e.name.endsWith('.aihu'))
      m[e.name.slice(0, -5)] = join(d, e.name).replace(/\\/g, '/')
  return m
}

/**
 * A syntactically valid custom-element tag: lowercase, starts with a letter,
 * contains at least one hyphen, and holds nothing but `[a-z0-9-]`.
 *
 * This is deliberately STRICTER than the HTML spec's `PotentialCustomElementName`
 * (which permits a large swathe of Unicode) and exactly matches the subset the
 * compiler will accept — C450 refuses to compile a component whose tag has no
 * hyphen, because `customElements.define` throws `SyntaxError` on one.
 *
 * `genC` uses it as a codegen boundary. The registry it emits is JavaScript
 * SOURCE built by string concatenation from names read out of `.aihu` files
 * (`@route { name }` / the file stem), so an unvalidated tag is an unvalidated
 * value reaching a code-construction sink. Anything failing this test could
 * never have registered as an element anyway, so dropping it costs no working
 * behaviour.
 *
 * This narrows what can ARRIVE; it is not the escaping. The emit itself goes
 * through `jsSourceLiteral` (`./codegen.ts`) — see `SAFE_MODULE_PATH` below
 * for the case where relying on the shape check alone was actually wrong.
 */
const CUSTOM_ELEMENT_TAG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/

/**
 * A module path safe to inline into a generated `import("…")` specifier.
 * Paths come from our own `readdirSync` walk, so this is a belt-and-braces
 * check on the same principle as `CUSTOM_ELEMENT_TAG`: reject anything holding
 * a quote, a backslash, or a line terminator (`\n`, `\r`, and the U+2028/U+2029
 * pair that `JSON.stringify` notably does NOT escape). A path like that cannot
 * survive a bundler's resolver regardless.
 *
 * NOT A SUBSTITUTE FOR ESCAPING, and this is the pattern's counterexample
 * rather than a hypothetical. Unlike `CUSTOM_ELEMENT_TAG`, which is an
 * allowlist, this is a denylist — and it says nothing about `<` or `>`, both
 * legal in a POSIX filename and both passed through untouched by
 * `JSON.stringify`. A component under a directory named `a</script>b` therefore
 * put a literal `</script>` into the generated registry while clearing every
 * check on this path. CodeQL flagged exactly that
 * (`js/bad-code-sanitization` #61/#86) and was right to. The emit now goes
 * through `jsSourceLiteral` (`./codegen.ts`); this regex stays as the
 * narrowing step, not as the guarantee.
 */
const SAFE_MODULE_PATH = /^[^"'\\\n\r\u2028\u2029]+$/

/**
 * O1b: Resolve the custom-element tag a component file registers under.
 * Name precedence mirrors the compiler: `@route { name }` → the file stem; the
 * winner is normalized via `componentTagFor`. Build-time only.
 *
 * `@meta { name }` is DELIBERATELY NOT CONSULTED. This function used to prefer
 * it over both other sources, and that was a bug rather than a feature: the
 * compiler never applies it. `@meta`'s parsed form has no `name` field at all —
 * the block
 * carries recipe-catalog data (`variants`/`slots`/`dependencies`/
 * `registryDependencies`) and the convention that it must not redefine the
 * component name is written down as R-META-COEXIST, asserted by
 * the standalone compiler's metadata tests and source invariants. So
 * `defineElement` — and therefore `__aihu_tag__`, and
 * therefore what the browser actually registers — resolves
 * `@route { name }` → file stem, and an SFC declaring `@meta { name: "x-y" }`
 * in `x-plain.aihu` still emits `defineElement('x-plain', …)`.
 *
 * A router that keyed such a component as `x-y` did not merely miss it during
 * SSR: `virtual:aihu-components` would register the loader under a tag no
 * module ever defines, so `<x-y>` never upgraded on the client either, while
 * the tag templates DO reference (`x-plain`) resolved to nothing. Dropping the
 * `@meta` leg makes one derivation instead of two. The alternative — teaching
 * the compiler to honour `@meta { name }` — is a language-semantics change
 * that would contradict R-META-COEXIST.
 *
 * KEEP IN SYNC with the compiler's define-name resolution: `resolve_tag` /
 * `bin/main.rs`'s OQ-C6 block (`@route { name }` → file stem) plus
 * `normalize_define_tag`. Note `@route` is itself only legal in a `pages/`
 * file (C500), so within a components directory this reduces to the stem in
 * practice; the leg is kept because `readAihuComponentTag` is also called on
 * paths outside that directory (`@aihu/app`'s prerender diagnostics).
 */
export function readAihuComponentTag(f: string): string {
  const stem = basename(f).replace(/\.[^.]+$/, '')
  try {
    const content = readFileSync(f, 'utf8')
    const block = content.match(/@route\s*\{([^}]*)\}/)
    const named = block ? block[1]!.match(/\bname\s*:\s*["']([^"']+)["']/) : null
    return componentTagFor(named?.[1] ?? stem)
  } catch {
    return componentTagFor(stem)
  }
}

/**
 * O1b: Recursively scan a components dir for `.aihu` files, mapping each
 * file's normalized custom-element tag → absolute POSIX path. Unlike the flat
 * `scanLayouts`, components commonly nest in subdirectories. Build-time only.
 *
 * TIE-BREAK: the whole file list is SORTED, and on a tag collision the FIRST
 * file wins. This used to be "the last file wins, over raw `readdirSync`
 * order", which was wrong twice over. `readdirSync` order is a filesystem
 * detail — APFS, ext4 and a CI container do not agree on it — so the winner
 * was not reproducible across machines for the same tree. And it disagreed
 * with the server: `@aihu/server`'s `buildChildRegistry` keeps the FIRST
 * claimant over the sorted list `@aihu/app`'s `discoverComponents` hands it.
 * Two sides disagreeing on the winner is not a cosmetic inconsistency — the
 * prerendered page ships one module's markup while the client registers the
 * other module under that tag and upgrades, so the content visibly swaps on
 * hydrate.
 *
 * Sorting the flat path list before the fold is exactly what
 * `discoverComponents` does (`const sorted = files.sort()`), over the same
 * key — absolute POSIX paths under a common prefix — so the two now select the
 * same winner from the same tree. `readAihuComponentTag` selecting the same
 * tag the compiler stamps into `__aihu_tag__` (see its docblock) is the other
 * half; both axes have to match or aligning either one alone means nothing.
 *
 * `listDir` is a seam, defaulting to the real `readdirSync`. A test cannot
 * otherwise choose the traversal order, and traversal order is precisely what
 * the sort exists to neutralize — a fixture-only test would assert the
 * tie-break while relying on luck to distinguish it from the old behaviour.
 */
export function scanComponents(
  d: string,
  listDir: (
    dir: string,
  ) => ReadonlyArray<{ name: string; isFile(): boolean; isDirectory(): boolean }> = (dir) =>
    readdirSync(dir, { withFileTypes: true }),
): Record<string, string> {
  const m: Record<string, string> = {}
  if (!existsSync(d)) return m
  const files: string[] = []
  const w = (dir: string): void => {
    for (const e of listDir(dir)) {
      const fp = join(dir, e.name)
      if (e.isDirectory()) w(fp)
      else if (e.isFile() && e.name.endsWith('.aihu')) files.push(fp.replace(/\\/g, '/'))
    }
  }
  w(d)
  for (const posix of files.sort()) {
    const tag = readAihuComponentTag(posix)
    const prev = m[tag]
    if (prev !== undefined && prev !== posix) {
      console.warn(
        `[aihu-router] component tag collision: "${tag}" is claimed by ${prev} and ${posix} — ` +
          `keeping ${prev} (first in sorted order, matching @aihu/server's child registry). ` +
          `${posix} is dropped; registering it would throw in customElements.define.`,
      )
      continue
    }
    m[tag] = posix
  }
  return m
}

/**
 * F2: extract the normalized component tags a layout SFC's `@template`
 * references, so `genL` can carry them on each `virtual:aihu-layouts` entry and
 * `@aihu/app` can register a layout's own children before the layout mounts —
 * mirroring the page path (route.json `components` → O1c).
 *
 * The `@template` block is located by a brace-balanced walk (templates nest
 * `{…}` freely — `@if { }`, interpolations — so the `readAihuRouteMeta`-style
 * `[^}]*` regex would truncate). Inside it, element OPENINGS are matched with
 * `/<([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])/g` — closing tags (`</x>`) and special
 * forms (`<outlet>`) never match because the char after `<` must be a letter.
 * A matched tag counts as a component when it contains a hyphen OR starts with
 * an ASCII uppercase letter; winners are normalized via `componentTagFor`,
 * deduped, and sorted (deterministic output). Build-time only.
 *
 * KEEP IN SYNC with the Rust compiler's classification + collection:
 * `is_component_tag` and `collect_component_tags` in the standalone compiler.
 * Like
 * `componentTagFor` above, this is a deliberate router-side mirror so the
 * router keeps zero compiler dependency.
 */
export function readAihuLayoutComponents(f: string): string[] {
  try {
    const content = readFileSync(f, 'utf8')
    const at = content.search(/@template\s*\{/)
    if (at === -1) return []
    const start = content.indexOf('{', at)
    let depth = 0
    let end = content.length
    for (let i = start; i < content.length; i++) {
      const c = content.charAt(i)
      if (c === '{') depth++
      else if (c === '}' && --depth === 0) {
        end = i
        break
      }
    }
    const body = content.slice(start + 1, end)
    const tags = new Set<string>()
    for (const m of body.matchAll(/<([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])/g)) {
      const raw = m[1]!
      const c0 = raw.charAt(0)
      if (raw.includes('-') || (c0 >= 'A' && c0 <= 'Z')) tags.add(componentTagFor(raw))
    }
    return [...tags].sort()
  } catch {
    return []
  }
}

const SK = [
  'name',
  'middleware',
  'ssr',
  'layout',
  'params',
  'head',
  'components',
  'extract',
  'data',
] as const

/**
 * GX Phase 4 (#466): locate a page file's sibling loader
 * (`<stem>.loader.ts|js|tsx|jsx`), the file `@aihu/router` picks up as the
 * route's loader registration. Build-time only.
 */
function findLoaderSibling(f: string): string | null {
  const stem = join(dirname(f), basename(f).replace(/\.[^.]+$/, ''))
  for (const ext of ['.loader.ts', '.loader.js', '.loader.tsx', '.loader.jsx']) {
    if (existsSync(stem + ext)) return stem + ext
  }
  return null
}

/** GX P4: is a compiled `read` value hard-tier? Mirrors `deriveReadPolicy`'s
 * tier break (kept dependency-free here, like `componentTagFor`): absent →
 * compliance default; the four anonymous values → compliance; everything
 * else — `'verified'`/`'human'`/`{ scope }`/malformed — hard (fail-closed). */
function isHardRead(read: unknown): boolean {
  if (read === undefined || read === null) return false
  return !(read === 'all' || read === 'agents' || read === 'search' || read === 'none')
}

/**
 * GX Phase 4 (#466, spec §4.7): the build-layer governed-loader conflict
 * checks — this is the layer that can SEE sibling files (the Rust compiler
 * cannot), so C486/W48x live here.
 *
 * - C486 (build ERROR): `data:` + a sibling loader that is not the
 *   `defineGovernedFetch` escape hatch — one data source per route; a
 *   declared contradiction fails the build (R2), never resolves by silent
 *   precedence.
 * - W487 (build WARNING): a plain loader on a hard-tier `read:` route with
 *   no `data:` — the generated ergonomics are declined; output falls back to
 *   route-level T4 withholding at runtime.
 *
 * Detection of the escape hatch is textual (`defineGovernedFetch` in the
 * sibling source): build-time, no module evaluation. Exported for tests.
 */
export function checkGovernedLoaderConflicts(f: string, meta: RouteSidecar | null): void {
  const sibling = findLoaderSibling(f)
  if (!sibling) return
  let source = ''
  try {
    source = readFileSync(sibling, 'utf8')
  } catch {
    return
  }
  const isEscapeHatch = source.includes('defineGovernedFetch')
  if (meta?.data !== undefined && !isEscapeHatch) {
    throw new Error(
      `[aihu-router] C486: route file '${f}' declares data: AND a sibling loader ` +
        `('${sibling}') — one data source per route. Remove the sibling loader (the ` +
        'framework generates the governed loader), or convert it to defineGovernedFetch ' +
        '(replaces the provider stage only, never the gate).',
    )
  }
  if (meta?.data === undefined && isHardRead(meta?.extract?.read) && !isEscapeHatch) {
    console.warn(
      `[aihu-router] W487: route file '${f}' has a hard-tier read: with a plain sibling ` +
        `loader ('${sibling}') — its output is route-level withheld (T4 fallback). ` +
        'Declare data: or use defineGovernedFetch for the per-field governed contract.',
    )
  }
}

function genR(
  files: string[],
  pd: string,
  middlewareByDir: Record<string, string> = {},
  compileRouteMeta?: (source: string, id: string) => RouteSidecar | null,
): string {
  return `// AUTO-GENERATED\nexport default [\n${files
    .map((f) => {
      const s = segs(f.replace(/\\/g, '/').replace(new RegExp(`^.*?${pd}/`), ''))
      // Metadata precedence: disk sidecar (SSG/file-mode build) → compiler
      // route-json (the SPA build path, full head/middleware/params/ssr) →
      // @route source regex (name+layout only, when no compiler is wired).
      let meta: RouteSidecar | null = readRouteSidecar(f)
      if (!meta && compileRouteMeta && f.endsWith('.aihu')) {
        try {
          meta = compileRouteMeta(readFileSync(f, 'utf8'), f)
        } catch {
          meta = null
        }
      }
      // GX P4 (#466): governed-loader conflict checks (C486 error / W487 warn).
      checkGovernedLoaderConflicts(f, meta)
      const aihuMeta = !meta?.name && f.endsWith('.aihu') ? readAihuRouteMeta(f) : null
      // `jsSourceLiteral`, not `JSON.stringify` — see `./codegen.ts`. Every
      // value below is read off disk (a sidecar's JSON, an `@route` block's
      // own source text, a filesystem path), and every one is concatenated
      // into JavaScript SOURCE. `JSON.stringify` escapes for the JSON grammar,
      // which leaves `<`, `>` and U+2028/9 intact — the characters that
      // terminate a `<script>` or a JS string literal.
      const x = meta
        ? SK.filter((k) => meta[k] !== undefined)
            .map((k) => `    ${k}: ${jsSourceLiteral(meta[k])},`)
            .join('\n')
        : aihuMeta
          ? [
              aihuMeta.name !== undefined ? `    name: ${jsSourceLiteral(aihuMeta.name)},` : '',
              aihuMeta.layout !== undefined
                ? `    layout: ${jsSourceLiteral(aihuMeta.layout)},`
                : '',
            ]
              .filter(Boolean)
              .join('\n')
          : ''
      // v0.7.2: embed _middleware file path for file-convention auto-wire
      const fileDir = dirname(f).replace(/\\/g, '/')
      const mwFile = middlewareByDir[fileDir]
      const mwLine = mwFile ? `\n    middlewareFile: ${jsSourceLiteral(mwFile)},` : ''
      return `  {\n    pattern: ${jsSourceLiteral(pat(s))},\n    segments: ${jsSourceLiteral(s)},\n    module: () => import(${jsSourceLiteral(f.replace(/\\/g, '/'))}),${x ? `\n${x}` : ''}${mwLine}\n  }`
    })
    .join(',\n')}\n];\n`
}

/**
 * v0.7.5: emit runtime-consumable entries — `{ tag, load, components }` — not
 * bare path strings. `load()` is a dynamic import so the layout SFC compiles +
 * registers its `aihu-layout-<name>` custom element on first use; `tag` lets
 * the client renderer `createElement` it without re-deriving the name;
 * `components` (F2) is the layout template's own referenced component tags
 * (`readAihuLayoutComponents`), so `@aihu/app` can register a layout's children
 * the same way it registers a page's. Exported for tests.
 */
export function genL(d: string): string {
  return `// AUTO-GENERATED\nexport default {\n${Object.entries(scanLayouts(d))
    .map(
      // `jsSourceLiteral` at every hole — same reason as `genR`: layout stems
      // and paths come off the filesystem, `components` comes from the
      // layout's own `@template` text.
      ([k, v]) =>
        `  ${jsSourceLiteral(k)}: { tag: ${jsSourceLiteral(layoutTagFor(k))}, load: () => import(${jsSourceLiteral(v)}), components: ${jsSourceLiteral(readAihuLayoutComponents(v))} },`,
    )
    .join('\n')}\n};\n`
}

/**
 * O1b: Generate the `virtual:aihu-components` module — the compile-time
 * tag → module registry. Keys are normalized custom-element tags; values are
 * `() => Promise` loaders (the key IS the tag, so no `{ tag, load }`
 * wrapper like `genL`). Keys are sorted so output is deterministic. Consumed
 * by O1c's route-scoped component registration. Exported for tests.
 *
 * TRANSITIVE by construction. A page's `route.json` `components` and a
 * layout's `genL` `components` each list only the tags THAT file's own
 * `@template` references — one level. But the compiler emits a child
 * component as a bare tag with NO import (`branch('search-box', …)` inside
 * site-header's output), so nothing else ever loads a nested component's
 * module: `<site-header>` would upgrade while the `<search-box>` inside it
 * stayed an inert unknown element. That gap is why apps end up hand-writing
 * `import './components/x.aihu'` side-effect lines in their client entry —
 * which defeats this registry entirely, since every such import drags every
 * island into the ENTRY chunk and every page then pays for every island.
 *
 * So each tag's loader here also loads that component's own transitive
 * children. The closure is computed at BUILD time (cycles broken by the
 * `seen` set, self-references dropped), so there is no runtime graph walk
 * and no possibility of a cyclic import hanging a page. Tags that resolve to
 * no registry entry are dropped rather than emitted as a dangling reference —
 * a template may legitimately name a globally-registered element the router
 * does not own.
 */
export function genC(d: string): string {
  const mods = scanComponents(d)

  // Validate at the codegen boundary. Everything below concatenates these two
  // values into JavaScript SOURCE, and both are read out of files on disk —
  // tags from a component's `@route { name }` (or its stem), paths from
  // the directory walk. Checking the shape here means the emitted module is
  // well-formed by construction rather than by trusting `JSON.stringify` to
  // escape whatever arrives. Neither drop loses working behaviour: a tag
  // failing CUSTOM_ELEMENT_TAG could never register (the compiler's own C450
  // refuses to build one), and a path failing SAFE_MODULE_PATH could never
  // resolve.
  const tags = Object.keys(mods)
    .filter((t) => {
      if (!CUSTOM_ELEMENT_TAG.test(t)) {
        console.warn(
          `[aihu-router] skipping component "${t}" (${mods[t]}): not a valid custom-element ` +
            `tag — must be lowercase [a-z0-9-] and contain a hyphen.`,
        )
        return false
      }
      if (!SAFE_MODULE_PATH.test(mods[t] as string)) {
        console.warn(
          `[aihu-router] skipping component "${t}": module path contains a quote, backslash, ` +
            `or line terminator (${JSON.stringify(mods[t])}).`,
        )
        return false
      }
      return true
    })
    .sort()

  // Direct child tags per component, restricted to tags this registry can load.
  //
  // "Can load" means PRESENT IN `__m`, i.e. a member of `tags` — not merely a
  // key of `mods`. The two differ: `mods` is the raw directory scan, `tags` is
  // what survived the codegen-boundary filter above. A single-word component
  // (`button.aihu` → tag `button`, no hyphen) is dropped from `tags` by
  // CUSTOM_ELEMENT_TAG but stays in `mods`, so filtering on `mods` emitted
  // `__m["button"]()` against a registry with no `button` key — `undefined()`,
  // a TypeError thrown out of the parent's loader at runtime, taking the
  // parent down with the child that was only ever meant to be skipped.
  // Found by tracing the value that reaches the `Promise.all` sink below.
  const registered = new Set(tags)
  const kids: Record<string, string[]> = {}
  for (const t of tags) {
    kids[t] = readAihuLayoutComponents(mods[t] as string).filter(
      (c) => c !== t && registered.has(c),
    )
  }

  /** Transitive children of `t`, excluding `t` itself. Cycle-safe. */
  const deps = (t: string): string[] => {
    const seen = new Set<string>()
    const stack = [...(kids[t] ?? [])]
    while (stack.length > 0) {
      const c = stack.pop() as string
      if (c === t || seen.has(c)) continue
      seen.add(c)
      stack.push(...(kids[c] ?? []))
    }
    return [...seen].sort()
  }

  // `jsSourceLiteral` at both holes. CUSTOM_ELEMENT_TAG already pins the tag
  // to `[a-z0-9-]`, but the PATH only has to clear SAFE_MODULE_PATH (no quote,
  // backslash or line terminator) — which permits `<` and `>`, so a component
  // living under a directory named `a</script>b` put a literal `</script>`
  // into this generated module. See `./codegen.ts`.
  const loaders = tags
    .map((t) => `  ${jsSourceLiteral(t)}: () => import(${jsSourceLiteral(mods[t])}),`)
    .join('\n')

  const entries = tags
    .map((t) => {
      const d = deps(t)
      if (d.length === 0) return `  ${jsSourceLiteral(t)}: __m[${jsSourceLiteral(t)}],`
      const all = [t, ...d].map((x) => `__m[${jsSourceLiteral(x)}]()`).join(', ')
      return `  ${jsSourceLiteral(t)}: () => Promise.all([${all}]),`
    })
    .join('\n')

  return `// AUTO-GENERATED\nconst __m = {\n${loaders}\n};\nexport default {\n${entries}\n};\n`
}

/**
 * Generate `virtual:aihu-server-components` — the SERVER-side child registry
 * source, for `output: 'ssr'` builds.
 *
 * A FLAT `{ tag: () => import(path) }` map, deliberately not `genC`'s shape.
 * `genC` emits a TRANSITIVE bundle per tag (`() => Promise.all([…])`) because
 * its consumer registers custom elements as a side effect and only needs "load
 * everything reachable from this one". The server consumer is
 * `buildChildRegistry`, which indexes tag → MODULE: it has to be able to name
 * every module individually, and a `Promise.all` of side-effect imports has no
 * tag to index by and no module to hand back.
 *
 * REACHABILITY, not "every component". The walk starts at the PAGES and follows
 * `__aihu_child_tags__` edges — the tags the compiled string renderer will
 * actually look up — via the injected `deriveChildTags`. Three derivations were
 * measured on a fixture that separates the sets (a leaf, a nested child, an
 * orphan no page reaches, and a reference the emitter DECLINES because it
 * carries an attribute):
 *
 *   | derivation                                    | modules bundled |
 *   |-----------------------------------------------|-----------------|
 *   | every component (what the SSG path does)       | 4               |
 *   | source regex (`readAihuLayoutComponents`)      | 3               |
 *   | `__aihu_child_tags__` render edges (this)      | 2               |
 *
 * The source regex pulls in the attribute-bearing component, which
 * `__aihu_schild` can never look up — confirmed empty in the rendered HTML
 * while its module was in the bundle. Upload weight for zero benefit, and
 * upload weight is the currency on a Worker.
 *
 * ACCEPTED TRADE, stated because it is real: a pruned registry sees only the
 * subgraph reachable from the pages, so `buildChildRegistry`'s cycle check
 * loses the GLOBAL view its docblock describes. A cycle among components no
 * page reaches goes unreported. That is the correct trade for a Worker — the
 * cycle report is advisory (`ChildCycle` documents at length why it warns
 * rather than throws), `__aihu_schild` is depth- and budget-bounded at render
 * time, and an unreachable cycle cannot affect a response. The SSG path still
 * loads everything and still gets the global check.
 *
 * `deriveChildTags` ABSENT (standalone `viteRouterIntegration` with no compiler
 * wired) falls back to the whole component directory and warns. Emitting an
 * empty registry instead would be the silently-empty-children failure again,
 * one layer up.
 *
 * Exported for tests.
 */
export function genSC(
  pageFiles: ReadonlyArray<string>,
  componentsDir: string,
  deriveChildTags?: (source: string, id: string) => string[],
  /**
   * Layout files, walked as ROOTS alongside the pages.
   *
   * Layouts are where a site's nav, header and footer live, and
   * `@aihu/router/server` now composes them into every live SSR response.
   * Rooting the walk at pages alone excluded every component a layout
   * references, so the shell would server-render with all of them as empty
   * elements — this module's own failure mode, relocated into the part of the
   * page that appears on EVERY route.
   *
   * Defaulted to empty so the pre-layout call shape keeps its exact behaviour.
   */
  layoutFiles: ReadonlyArray<string> = [],
): string {
  const mods = scanComponents(componentsDir)

  // Same codegen-boundary validation as `genC`: everything below is
  // concatenated into JavaScript SOURCE from values read off disk. See
  // CUSTOM_ELEMENT_TAG / SAFE_MODULE_PATH for why this is a shape check and
  // not a trust-the-escaping.
  const safe = (tag: string): boolean => {
    const path = mods[tag]
    if (path === undefined) return false
    if (!CUSTOM_ELEMENT_TAG.test(tag)) {
      console.warn(
        `[aihu-router] skipping server component "${tag}" (${path}): not a valid ` +
          `custom-element tag — must be lowercase [a-z0-9-] and contain a hyphen.`,
      )
      return false
    }
    if (!SAFE_MODULE_PATH.test(path)) {
      console.warn(
        `[aihu-router] skipping server component "${tag}": module path contains a quote, ` +
          `backslash, or line terminator (${JSON.stringify(path)}).`,
      )
      return false
    }
    return true
  }

  /** Child tags of one SFC file, or `[]` for a non-SFC route (a .ts page). */
  const edges = (file: string): ReadonlyArray<string> => {
    if (deriveChildTags === undefined || !file.endsWith('.aihu')) return []
    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      return []
    }
    // Deliberately NOT swallowed. A compile failure here is a compile failure
    // of a file the build is about to compile anyway; reporting it as "this
    // component has no children" would prune the registry silently, which is
    // the failure mode this module exists to avoid.
    return deriveChildTags(source, file)
  }

  let reachable: string[]
  if (deriveChildTags === undefined) {
    console.warn(
      '[aihu-router] virtual:aihu-server-components was generated WITHOUT a ' +
        '`deriveChildTags` option, so the reachable-subgraph walk cannot run — falling back ' +
        'to every component under the components dir. The server bundle will carry modules ' +
        'no page references. Wire the router through `viteAihuPlugin` (@aihu/app), which ' +
        'injects it from @aihu/compiler.',
    )
    reachable = Object.keys(mods).filter(safe).sort()
  } else {
    const seen = new Set<string>()
    // Roots are the PAGES and the LAYOUTS, not the components — rooting at the
    // components is what would keep an orphan; rooting only at the pages is
    // what would drop the site chrome.
    const stack: string[] = []
    for (const page of pageFiles) stack.push(...edges(page))
    for (const layout of layoutFiles) stack.push(...edges(layout))
    while (stack.length > 0) {
      const tag = stack.pop() as string
      if (seen.has(tag)) continue
      // A tag the components dir does not claim is an edge out of the graph —
      // a globally-registered third-party element, or a component living
      // elsewhere. Terminate rather than error: `__aihu_schild` already fails
      // closed on an unresolved tag.
      if (!safe(tag)) continue
      seen.add(tag)
      stack.push(...edges(mods[tag] as string))
    }
    reachable = [...seen].sort()
  }

  // Re-assert the shape AT THE SINK, on the same values that get emitted.
  //
  // `safe()` already checked every tag that reached `reachable`, so this cannot
  // drop anything in practice — but it is not redundant. `safe()` validates
  // `tag` and then the emit read `mods[t]` separately, so nothing tied the
  // checked value to the emitted one: a reader (and CodeQL's dataflow, which
  // flagged this as `js/bad-code-sanitization`) could not tell they were the
  // same string, and a future edit that mutated `mods` between the walk and the
  // emit would silently bypass the check.
  //
  // It matters more here than in `genC`. There the tags come from a directory
  // walk; here they come from `deriveChildTags`, i.e. from a REGEX OVER
  // COMPILED FILE CONTENT — an `.aihu` file's own text reaches this string
  // concatenation, which builds JavaScript source.
  //
  // The shape check is also not, on its own, the fix. It was written as one
  // ("the value cannot contain anything needing escaping"), and that claim
  // held for the TAG and not for the PATH: SAFE_MODULE_PATH bans quotes,
  // backslashes and line terminators but says nothing about `<` or `>`, both
  // of which are legal in a POSIX filename and both of which `JSON.stringify`
  // passes straight through. So the emit itself now goes through
  // `jsSourceLiteral` (see `./codegen.ts`) — the shape check narrows what can
  // arrive, the escaper makes what does arrive inert.
  const entries = reachable
    .flatMap((t) => {
      const path = mods[t]
      if (path === undefined || !CUSTOM_ELEMENT_TAG.test(t) || !SAFE_MODULE_PATH.test(path)) {
        return []
      }
      return [`  ${jsSourceLiteral(t)}: () => import(${jsSourceLiteral(path)}),`]
    })
    .join('\n')

  return `// AUTO-GENERATED\nexport default {\n${entries}\n};\n`
}

/** v0.7.2: File-convention middleware discovered alongside routes. */
export interface MiddlewareScan {
  /** Route files (non-underscore page files). */
  routes: string[]
  /**
   * Map from directory (absolute path) to its `_middleware.(ts|js)` file.
   * When the runtime composes a route, all middleware files from the route
   * file's ancestor directories (innermost first) should be applied.
   */
  middlewareByDir: Record<string, string>
}

export function scanPages(root: string, pd: string): MiddlewareScan {
  const d = resolve(root, pd)
  if (!existsSync(d)) return { routes: [], middlewareByDir: {} }
  const routes: string[] = []
  const middlewareByDir: Record<string, string> = {}
  const w = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const fp = join(dir, e.name)
      if (e.isDirectory()) {
        w(fp)
      } else if (e.isFile()) {
        // v0.7.2: capture _middleware.ts / _middleware.js / _middleware.tsx / _middleware.jsx
        if (/^_middleware\.(ts|js|tsx|jsx)$/.test(e.name)) {
          middlewareByDir[dir.replace(/\\/g, '/')] = fp.replace(/\\/g, '/')
        } else if (/\.(ts|js|tsx|jsx|aihu)$/.test(e.name) && !e.name.startsWith('_')) {
          routes.push(fp)
        }
      }
    }
  }
  w(d)
  return { routes: routes.sort(), middlewareByDir }
}

function _pages(root: string, pd: string): string[] {
  return scanPages(root, pd).routes
}

export function viteRouterPlugin(opts?: RouterPluginOptions): VitePlugin {
  const pd = opts?.pagesDir ?? 'pages',
    ld = opts?.layoutsDir ?? 'src/layouts',
    cd = opts?.componentsDir ?? 'src/components'
  let root = process.cwd(),
    cr: string | null = null,
    cl: string | null = null,
    cc: string | null = null,
    csc: string | null = null
  return {
    name: 'aihu-router',
    resolveId: (id) =>
      id === 'virtual:aihu-routes'
        ? RR
        : id === 'virtual:aihu-layouts'
          ? LR
          : id === 'virtual:aihu-components'
            ? CR
            : id === 'virtual:aihu-server-components'
              ? SCR
              : null,
    load(id) {
      if (id === RR) {
        if (!cr) {
          // v0.7.2: use scanPages to also pick up _middleware files
          const scan = scanPages(root, pd)
          cr = genR(scan.routes, pd, scan.middlewareByDir, opts?.compileRouteMeta)
        }
        return cr
      }
      if (id === LR) return (cl ??= genL(resolve(root, ld)))
      if (id === CR) return (cc ??= genC(resolve(root, cd)))
      if (id === SCR) {
        return (csc ??= genSC(
          scanPages(root, pd).routes,
          resolve(root, cd),
          opts?.deriveChildTags,
          // Layout FILES, not the tag map: `genSC` walks source for child-tag
          // edges, and the layouts are roots of that walk (see its docblock).
          Object.values(scanLayouts(resolve(root, ld))),
        ))
      }
      return null
    },
    configureServer(server) {
      const s = server as unknown as { config?: { root?: string } } & typeof server
      if (s.config?.root) root = s.config.root
      const pa = resolve(root, pd),
        la = resolve(root, ld),
        ca = resolve(root, cd)
      server.watcher.add(pa)
      server.watcher.add(la)
      server.watcher.add(ca)
      const mk = (abs: string, rst: () => void, rid: string) => (p: string) => {
        if (!p.replace(/\\/g, '/').includes(abs.replace(/\\/g, '/'))) return
        rst()
        const m = server.moduleGraph.getModuleById(rid)
        if (m) server.moduleGraph.invalidateModule(m)
      }
      const ir = mk(
          pa,
          () => {
            cr = null
          },
          RR,
        ),
        il = mk(
          la,
          () => {
            cl = null
          },
          LR,
        ),
        ic = mk(
          ca,
          () => {
            cc = null
          },
          CR,
        ),
        // `virtual:aihu-server-components` is reachability-walked from the
        // PAGES and the LAYOUTS over the COMPONENTS, so it is the one virtual
        // module a change in any of the three directories can invalidate —
        // hence three entries, not one.
        iscp = mk(
          pa,
          () => {
            csc = null
          },
          SCR,
        ),
        iscc = mk(
          ca,
          () => {
            csc = null
          },
          SCR,
        ),
        iscl = mk(
          la,
          () => {
            csc = null
          },
          SCR,
        )
      const invalidateAll = (p: string): void => {
        ir(p)
        il(p)
        ic(p)
        iscp(p)
        iscc(p)
        iscl(p)
      }
      server.watcher.on('add', invalidateAll)
      server.watcher.on('unlink', invalidateAll)
    },
  }
}

// ---------------------------------------------------------------------------
// v0.7.4 naming: viteRouterIntegration (preferred) + deprecated alias
// ---------------------------------------------------------------------------

/**
 * @aihu/router Vite integration (v0.7.4 rename of `viteRouterPlugin`).
 * Prefer this name going forward; `viteRouterPlugin` is kept as the original
 * function name (deprecated) until v1.0.
 */
export const viteRouterIntegration = viteRouterPlugin
