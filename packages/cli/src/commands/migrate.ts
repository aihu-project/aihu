/**
 * `aihu migrate [files...]` — convert legacy v0.1.x SFC syntax to v1.0+ canonical forms.
 *
 * Block conversions (v1.0.7 — applied first):
 *   <script setup>...</script>  =>  @state { ... }
 *   <template>...</template>    =>  @template { ... }
 *   <style>...</style>          =>  @style { ... }
 *   <agent>...</agent>          =>  @agent { ... }
 *
 * Inline attribute conversions (v1.0.8 / Amendment 04 — applied second):
 *   :attr="x"        =>  $attr={x}             (C304 rewrite)
 *   @event="x"       =>  $on.event="x"         (C305 rewrite, dot-form per B3c)
 *   attr={x}         =>  $attr={x}             (C306 rewrite, always-$-prefix)
 *
 * Component prop-passing (`<UserCard user={u} />`) is preserved — the C306
 * rewrite uses a lowercase-tag-name lookbehind so JSX-style props on
 * capitalized component names are NOT rewritten. SVG/XML namespace prefixes
 * (`xmlns:`, `xlink:`) are also preserved via a leading-whitespace guard.
 *
 * Package-name conversions (v1.0.9 / Naming Scheme A — applied third):
 *   @aihu/data              =>  @aihu-plugin/data
 *   @aihu/agent-readiness   =>  @aihu-plugin/agent-readiness
 *
 * The v1.0.9 pass rewrites package.json `dependencies` / `devDependencies`
 * blocks, static `import` statements, dynamic `import()` calls, and JSDoc
 * URL references. It is bounded to whole-word boundaries so already-renamed
 * literals (`@aihu-plugin/data`) and unrelated names (`@aihu/data-store`)
 * are not double-rewritten or false-positively matched.
 *
 * Zero external dependencies -- uses only Node/Bun builtins (fs).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
// v1→v2 macro-vocabulary pass (#425). The compiler package owns this codemod;
// rolldown bundles the public entry point so the published CLI stays self-contained.
import { migrate as migrateMacrosV2 } from '@aihu/compiler/codemods/macro-simplification'
// #487 — the @state wrapper-model migration (state-model spec §7 waves 1+2):
// `$`-macros → wrappers/statement calls/directives, signal tuples → `state()`
// with call-site rewrites. Opt-in via `aihu migrate --state`.
import { migrateStateWrappers } from '@aihu/compiler/codemods/state-wrapper'
// Template grammar v2 (the prefix-less template): the `$` attribute layer,
// block tags, `<$…>` macro elements, and `{{…}}` all migrate to the naked
// grammar as the FINAL pass — the v0→v1 passes above stay byte-identical and
// keep producing v1 forms as their intermediate representation.
import { migrateTemplateGrammar } from '@aihu/compiler/codemods/template-grammar-v2'

type BlockConversion = {
  readonly open: RegExp
  readonly close: string
  readonly blockName: string
}

const CONVERSIONS: ReadonlyArray<BlockConversion> = [
  { open: /<script\s+setup\s*>/i, close: '</script>', blockName: '@state' },
  { open: /<template\s*>/i, close: '</template>', blockName: '@template' },
  { open: /<style\s*>/i, close: '</style>', blockName: '@style' },
  { open: /<agent\s*>/i, close: '</agent>', blockName: '@agent' },
]

/**
 * Inline attribute conversions for v1.0.8 / Amendment 04.
 *
 * Order matters: `:attr=`/`@event=` rewrites run BEFORE the plain-curly
 * rewrite so that an already-converted `$attr={…}` is not accidentally
 * matched by the C306 pass. The C306 regex also requires a lowercase tag
 * lookbehind to skip JSX-style component prop-passing.
 *
 * Reserved-attribute-name allowlist: the C306 plain-curly rewrite only fires
 * on a curated set of common HTML attribute names (class/href/id/src/alt/
 * value/checked/disabled/etc + aria-* + data-*). This matches the same set
 * used by R5.2b-3's workspace rewrite sed-script, and avoids accidentally
 * rewriting unknown identifiers that might be macro names.
 */
export function migrateInlineAttrs(content: string): string {
  let result = content

  // C304 — `:attr="x"` and `:attr='x'` → `$attr={x}`.
  // Leading-whitespace guard (`(\s)`) skips `xmlns:` / `xlink:` namespace
  // prefixes (which appear AFTER another attribute, never at start-of-tag
  // with a leading colon) and avoids matching e.g. `xmlns:xlink="…"`.
  result = result.replace(/(\s):([a-zA-Z][\w-]*)="([^"]*)"/g, '$1$$$2={$3}')
  result = result.replace(/(\s):([a-zA-Z][\w-]*)='([^']*)'/g, '$1$$$2={$3}')

  // C305 — `@event="x"`, `@event='x'`, `@event={x}` → `$on.event="x"` (etc.).
  // Quote style is preserved.
  result = result.replace(/(\s)@([a-zA-Z][\w-]*)=(["'])/g, '$1$$on.$2=$3')
  result = result.replace(/(\s)@([a-zA-Z][\w-]*)=\{/g, '$1$$on.$2={')

  // Defect fix (#425 b) — quoted `$let="expr"` / `$let='expr'` → `$let={expr}`.
  // The quoted `$`-prefixed form is reserved for built-in macros (C500 in v2);
  // `$let` passes a prop value and must use the curly form. Idempotent: the
  // curly form contains no quote after `=` so it never re-matches.
  result = result.replace(/\$let="([^"]*)"/g, '$$let={$1}')
  result = result.replace(/\$let='([^']*)'/g, '$$let={$1}')

  // C306 — plain `attr={x}` on lowercase HTML tags → `$attr={x}`.
  // Allowlist of common HTML attribute names. Component prop-passing
  // (`<UserCard user={u} />`) is preserved — the regex requires the rewrite
  // site to be preceded by whitespace AND the containing tag's opening
  // `<lowercase-name` to appear before any `>` since the rewrite point.
  //
  // Implementation approach: we cannot easily express "find this attribute
  // inside any lowercase-tag opener" with a single regex. Instead, we scan
  // tag openers (`<lowercase-name … >` or `… />`) and apply per-attribute
  // rewriting within their attribute lists. This is the dogfood-safe form.
  result = rewritePlainCurlyAttrsInHtmlTags(result)

  return result
}

/**
 * Scan all opening tags in `content` whose tag-name is lowercase (HTML
 * element, not a capitalized component name) and rewrite plain
 * `attr={expr}` attribute bindings to `$attr={expr}` (C306).
 *
 * - Component tags (capitalized first letter) are skipped to preserve
 *   JSX-style prop-passing.
 * - The allowlist is intentionally broad — class/href/id/src/alt/value/
 *   checked/disabled/min/max/step/name/title/role/tabindex/type/action/
 *   method/target/placeholder/for/rel + aria-* + data-* — covering the
 *   83 plain-curly sites in the workspace (per Investigator R5.1 §1.1).
 *   Authors with unusual attribute names can rerun migrate or hand-edit.
 * - Macro attributes (`$attr={…}`) and `$bind.X` / `$on.X` are already
 *   `$`-prefixed and are not matched (the per-attribute regex requires
 *   no leading `$`).
 */
function rewritePlainCurlyAttrsInHtmlTags(content: string): string {
  // Scan for `<lowercase-tag-name` openers and then walk forward to find
  // the *true* end of the opener — i.e. the `>` that is NOT inside a
  // balanced `{…}` attr-value or a quoted attr-value. A naive regex
  // (`<…([^>]*)>`) breaks on arrow functions and comparison operators
  // inside curly-form attr values (e.g. `$on.click={() => x()}`).
  let result = ''
  let i = 0
  while (i < content.length) {
    const ch = content[i]
    if (ch !== '<') {
      result += ch
      i++
      continue
    }
    // `<` — check next char to decide if this is a lowercase-tag opener.
    const next = content[i + 1]
    if (!next || !/[a-z]/.test(next)) {
      // Not a lowercase tag opener — copy verbatim.
      result += ch
      i++
      continue
    }
    // Walk forward to capture tag-name chars.
    let j = i + 1
    while (j < content.length && /[\w-]/.test(content[j] ?? '')) {
      j++
    }
    const tagName = content.slice(i + 1, j)
    // Now scan forward from `j` to find the matching `>` for THIS tag opener,
    // respecting balanced `{…}`, `"…"`, `'…'` regions.
    let k = j
    let curlyDepth = 0
    let inDouble = false
    let inSingle = false
    while (k < content.length) {
      const c = content[k]
      if (!inDouble && !inSingle) {
        if (c === '{') curlyDepth++
        else if (c === '}') curlyDepth--
        else if (c === '"') inDouble = true
        else if (c === "'") inSingle = true
        else if (c === '>' && curlyDepth === 0) break
      } else if (inDouble) {
        if (c === '"') inDouble = false
      } else if (inSingle) {
        if (c === "'") inSingle = false
      }
      k++
    }
    if (k >= content.length) {
      // Malformed — copy what's left verbatim.
      result += content.slice(i)
      i = content.length
      continue
    }
    // `k` is at the matching `>`. Attrs region is content[j..k].
    const attrsRegion = content.slice(j, k)
    const rewritten = rewriteAttrsInRegion(attrsRegion)
    result += `<${tagName}${rewritten}>`
    i = k + 1
  }
  return result
}

const C306_ATTR_ALLOWLIST = new Set<string>([
  // Common HTML attributes that frequently take reactive bindings.
  'class',
  'href',
  'id',
  'src',
  'alt',
  'placeholder',
  'value',
  'checked',
  'disabled',
  'readonly',
  'required',
  'selected',
  'hidden',
  'open',
  'min',
  'max',
  'step',
  'name',
  'title',
  'type',
  'role',
  'tabindex',
  'action',
  'method',
  'target',
  'rel',
  'for',
  'form',
  'lang',
  'dir',
  'autocomplete',
  'autofocus',
  'multiple',
  'pattern',
  'size',
  'maxlength',
  'minlength',
  'cols',
  'rows',
  'wrap',
  'accept',
  'enctype',
  'novalidate',
  'spellcheck',
  'translate',
  'draggable',
  'contenteditable',
  'srcset',
  'sizes',
  'loading',
  'decoding',
  'crossorigin',
  'controls',
  'autoplay',
  'loop',
  'muted',
  'preload',
  'poster',
  'colspan',
  'rowspan',
  'headers',
  'scope',
  'span',
  'start',
  'reversed',
  'datetime',
  'cite',
  'download',
  'media',
  'as',
])

/**
 * Defect fix (#425 c) — DOM event-handler attributes in curly form
 * (`onclick={expr}`, `oninput={expr}`, …) were missing from the C306 pass:
 * they hit the C306 compile error but the migrator left them untouched.
 * They are rewritten to the canonical event form `$on.<event>={expr}` (the
 * corpus dialect), not `$onclick={expr}`. Curated name set so that
 * non-event `on…`-shaped attributes are never misrewritten.
 */
const C306_EVENT_HANDLER_ATTRS = new Set<string>([
  'onclick',
  'ondblclick',
  'oninput',
  'onchange',
  'onsubmit',
  'onreset',
  'onkeydown',
  'onkeyup',
  'onkeypress',
  'onfocus',
  'onblur',
  'onmousedown',
  'onmouseup',
  'onmouseover',
  'onmouseout',
  'onmouseenter',
  'onmouseleave',
  'onmousemove',
  'oncontextmenu',
  'onwheel',
  'onscroll',
  'ondrag',
  'ondragstart',
  'ondragend',
  'ondragenter',
  'ondragleave',
  'ondragover',
  'ondrop',
  'ontouchstart',
  'ontouchend',
  'ontouchmove',
  'ontouchcancel',
  'onpointerdown',
  'onpointerup',
  'onpointermove',
  'onpointerenter',
  'onpointerleave',
  'onpointercancel',
  'onload',
  'onerror',
  'onabort',
  'oncanplay',
  'onplay',
  'onpause',
  'onended',
  'ontimeupdate',
  'onvolumechange',
  'onselect',
  'oncopy',
  'oncut',
  'onpaste',
  'ontoggle',
  'onclose',
  'oninvalid',
  'onanimationend',
  'onanimationstart',
  'onanimationiteration',
  'ontransitionend',
])

/**
 * Within a single opening tag's attribute region (e.g. ` class={cls} id="x" `),
 * rewrite each plain `attr={expr}` to `$attr={expr}` when `attr` is in the
 * C306 allowlist OR matches the `aria-*` / `data-*` family. Event-handler
 * names (`onclick` etc.) rewrite to `$on.<event>={expr}` instead (#425 c).
 */
function rewriteAttrsInRegion(attrsRegion: string): string {
  // Per-attribute regex: leading whitespace (or start of region), no `$`/`:`/`@`
  // prefix, identifier chars, `={`, expression (balanced — we use a greedy
  // match and `findBalancedClose` for safety).
  let result = ''
  let i = 0
  while (i < attrsRegion.length) {
    // Skip whitespace
    while (i < attrsRegion.length && /\s/.test(attrsRegion[i] ?? '')) {
      result += attrsRegion[i]
      i++
    }
    if (i >= attrsRegion.length) break

    // Check for already-prefixed attrs (skip): `$`, `:`, `@` start.
    // Copy verbatim until next whitespace OUTSIDE any balanced quote/curly
    // region — quoted attr values (e.g. `$each="visible as todo"`) and
    // curly-form attr values may contain internal spaces or newlines.
    const ch = attrsRegion[i]
    if (ch === '$' || ch === ':' || ch === '@' || ch === '/') {
      while (i < attrsRegion.length && !/\s/.test(attrsRegion[i] ?? '')) {
        const c = attrsRegion[i]
        result += c
        i++
        if (c === '"') {
          while (i < attrsRegion.length && attrsRegion[i] !== '"') {
            result += attrsRegion[i]
            i++
          }
          if (i < attrsRegion.length) {
            result += attrsRegion[i]
            i++
          }
        } else if (c === "'") {
          while (i < attrsRegion.length && attrsRegion[i] !== "'") {
            result += attrsRegion[i]
            i++
          }
          if (i < attrsRegion.length) {
            result += attrsRegion[i]
            i++
          }
        } else if (c === '{') {
          // Skip balanced curly region (so `$on.click={() => x()}` is
          // copied intact even with internal spaces).
          let depth = 1
          while (i < attrsRegion.length && depth > 0) {
            const cc = attrsRegion[i]
            result += cc
            i++
            if (cc === '{') depth++
            else if (cc === '}') depth--
          }
        }
      }
      continue
    }

    // Try to match `<attr-name>={...}` or `<attr-name>="..."` etc.
    const nameMatch = attrsRegion.slice(i).match(/^([a-zA-Z][\w-]*)/)
    if (!nameMatch) {
      // Unknown token — copy a single char and continue.
      result += attrsRegion[i]
      i++
      continue
    }
    const name = nameMatch[1] ?? ''
    const afterName = i + name.length

    // Check for `={` (curly-form attribute value).
    if (attrsRegion[afterName] === '=' && attrsRegion[afterName + 1] === '{') {
      const closeIdx = findBalancedCurlyClose(attrsRegion, afterName + 1)
      if (closeIdx === -1) {
        // Unbalanced — copy verbatim and bail.
        result += attrsRegion.slice(i)
        i = attrsRegion.length
        continue
      }
      const expr = attrsRegion.slice(afterName + 2, closeIdx)
      const isAllowed =
        C306_ATTR_ALLOWLIST.has(name) || /^aria-[a-z]+/.test(name) || /^data-[a-z]+/.test(name)
      if (C306_EVENT_HANDLER_ATTRS.has(name)) {
        // #425 c — event handlers take the canonical `$on.<event>` form.
        result += `$on.${name.slice(2)}={${expr}}`
      } else if (isAllowed) {
        result += `$${name}={${expr}}`
      } else {
        result += `${name}={${expr}}`
      }
      i = closeIdx + 1
      continue
    }

    // Non-curly form (`attr="x"`, `attr='x'`, bare `attr`) — copy until next ws.
    while (i < attrsRegion.length && !/\s/.test(attrsRegion[i] ?? '')) {
      const c = attrsRegion[i]
      result += c
      i++
      // Skip over balanced quoted regions to avoid splitting on internal ws.
      if (c === '"') {
        while (i < attrsRegion.length && attrsRegion[i] !== '"') {
          result += attrsRegion[i]
          i++
        }
        if (i < attrsRegion.length) {
          result += attrsRegion[i]
          i++
        }
      } else if (c === "'") {
        while (i < attrsRegion.length && attrsRegion[i] !== "'") {
          result += attrsRegion[i]
          i++
        }
        if (i < attrsRegion.length) {
          result += attrsRegion[i]
          i++
        }
      }
    }
  }
  return result
}

/**
 * Find the index of the closing `}` that balances the `{` at `openIdx`.
 * Returns -1 if no balanced close is found.
 */
function findBalancedCurlyClose(s: string, openIdx: number): number {
  if (s[openIdx] !== '{') return -1
  let depth = 0
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Package-name conversions for v1.0.9 / Naming Scheme A.
 *
 * Two plugin-contract packages move from the `@aihu/*` scope to the
 * `@aihu-plugin/*` scope so that framework-core and plugin-contract surfaces
 * can evolve at independent cadences:
 *
 *   - `@aihu/data`             → `@aihu-plugin/data`
 *   - `@aihu/agent-readiness`  → `@aihu-plugin/agent-readiness`
 *
 * Each row covers four call-sites:
 *   1. package.json `dependencies` / `devDependencies` / `peerDependencies` keys.
 *   2. Static `import … from '<pkg>'` and `export … from '<pkg>'` statements.
 *   3. Dynamic `import('<pkg>')` calls.
 *   4. JSDoc / Markdown URL references (e.g. tree links, npm URLs).
 *
 * Implementation: a single whole-word regex per row catches all four surfaces
 * because we anchor on the literal package name and require a non-`-` boundary
 * after it (so `@aihu/data-store` would not match — there is no such package
 * today, but the guard makes the rewrite safe for the future).
 */
type PackageRename = {
  readonly from: string
  readonly to: string
}

export const V1_0_9_PACKAGE_RENAMES: ReadonlyArray<PackageRename> = [
  { from: '@aihu/data', to: '@aihu-plugin/data' },
  { from: '@aihu/agent-readiness', to: '@aihu-plugin/agent-readiness' },
]

/**
 * Rewrite v1.0.9 package-name references in `content`.
 *
 * Idempotent: a file that already uses the new names is left unchanged.
 *
 * The regex requires a non-identifier boundary after the package name so:
 *   - `@aihu/data` matches (followed by a quote, slash, space, etc.)
 *   - `@aihu/data-store` does NOT match (followed by `-`, an identifier char)
 *   - `@aihu-plugin/data` does NOT match the `@aihu/data` rule (different prefix)
 *
 * Preserves the surrounding quote style — single, double, or backtick — and
 * any path suffix after the package name (e.g. `@aihu/data/internal` → `@aihu-plugin/data/internal`).
 */
export function migratePackageNames(content: string): string {
  let result = content
  for (const { from, to } of V1_0_9_PACKAGE_RENAMES) {
    // Escape the `/` in the package name for regex use.
    const escaped = from.replace(/[/\\]/g, '\\$&')
    // Negative-lookahead for a `-` or word char immediately after the package
    // name — this prevents matching `@aihu/data-store` and similar siblings.
    const re = new RegExp(`${escaped}(?![-\\w])`, 'g')
    result = result.replace(re, to)
  }
  return result
}

/**
 * Convert a single SFC file content from legacy syntax to v1.0+ canonical form.
 * Pure function -- does not perform any I/O.
 *
 * Runs in three passes:
 *   1. Block-tag conversions (v1.0.7).
 *   2. Inline attribute conversions (v1.0.8 / Amendment 04).
 *   3. Package-name conversions (v1.0.9 / Naming Scheme A).
 *
 * Idempotent — running twice produces the same output as running once.
 */
export function migrateFile(content: string): string {
  let result = content

  for (const { open, close, blockName } of CONVERSIONS) {
    let match: RegExpExecArray | null
    while ((match = open.exec(result)) !== null) {
      const openTag = match[0]
      const openIdx = match.index

      const closeIdx = result.indexOf(close, openIdx + openTag.length)
      if (closeIdx === -1) break

      const body = result.slice(openIdx + openTag.length, closeIdx)
      const replacement = `${blockName} {${body}}`

      result = result.slice(0, openIdx) + replacement + result.slice(closeIdx + close.length)
    }
  }

  result = migrateInlineAttrs(result)
  result = migratePackageNames(result)

  return result
}

/**
 * Convert a single SFC file from legacy syntax all the way to v2
 * macro-vocabulary form (#425): the three v0→v1 passes of `migrateFile`,
 * then the v1→v2 macro-simplification codemod (`@state` collection-form,
 * `@agent` $expose/$describe folding, $lifecycle collection).
 *
 * Pure function — does not perform any I/O. Idempotent.
 * Returns the rewritten content plus any codemod warnings (e.g. `@agent`
 * references that could not be resolved to an `@state` declaration).
 */
export function migrateFileV2(content: string): {
  readonly content: string
  readonly warnings: readonly string[]
} {
  const v1 = migrateFile(content)
  const { rewritten, warnings } = migrateMacrosV2(v1)
  // Grammar v2 — the prefix-less template (40-spec §4): retire the `$`
  // template-attribute layer, block tags, `<$…>` elements, and `{{…}}`.
  const { rewritten: v2 } = migrateTemplateGrammar(rewritten)
  return { content: v2, warnings }
}

/**
 * Read each file in `files`, convert it, then either write it back in-place
 * or print a diff-like preview if `dryRun` is true. When `v2` is true the
 * v1→v2 macro-simplification pass runs after the v0→v1 passes (#425);
 * default behavior (v0→v1 only) is unchanged.
 */
export function migrateFiles(
  files: ReadonlyArray<string>,
  dryRun: boolean,
  cwd: string,
  v2 = false,
  state = false,
): void {
  for (const file of files) {
    const filePath = isAbsolute(file) ? file : join(cwd, file)
    const original = readFileSync(filePath, 'utf8')
    let converted: string
    if (state) {
      // #487 — @state wrapper-model migration. Runs the state-wrapper codemod
      // alone (input is expected to already be v2 vocabulary; the codemod
      // aborts per-file on any form it cannot map losslessly).
      const res = migrateStateWrappers(original)
      converted = res.rewritten
      for (const w of res.warnings) {
        process.stderr.write(`  warn: ${file}: ${w}\n`)
      }
    } else if (v2) {
      const { content, warnings } = migrateFileV2(original)
      converted = content
      for (const w of warnings) {
        process.stderr.write(`  warn: ${file}: ${w}\n`)
      }
    } else {
      converted = migrateFile(original)
    }

    if (converted === original) {
      process.stdout.write(`  (unchanged) ${file}\n`)
      continue
    }

    if (dryRun) {
      process.stdout.write(`--- ${file} (original)\n+++ ${file} (converted)\n`)
      const origLines = original.split('\n')
      const convLines = converted.split('\n')
      const maxLen = Math.max(origLines.length, convLines.length)
      for (let i = 0; i < maxLen; i++) {
        const o = origLines[i]
        const c = convLines[i]
        if (o !== c) {
          if (o !== undefined) process.stdout.write(`- ${o}\n`)
          if (c !== undefined) process.stdout.write(`+ ${c}\n`)
        }
      }
    } else {
      writeFileSync(filePath, converted, 'utf8')
      process.stdout.write(`✓ Migrated ${file}\n`)
    }
  }
}
