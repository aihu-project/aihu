# @aihu-plugin/kindly-note

> **Aihu** — agentic discovery and interaction, for human purpose.

Runtime syntax highlighting + markdown rendering for aihu — <aihu-code>/<aihu-markdown> custom elements + signal-aware highlight()/renderMarkdown() helpers, powered by published @kindly-note/* packages with lazy loading.


<!-- BEGIN_HANDWRITTEN: prose -->
Runtime syntax highlighting **and** markdown rendering for
[aihu](../../README.md), powered by the published
[`@kindly-note/*`](https://www.npmjs.com/org/kindly-note) packages. Ships two
custom elements and two signal-aware helpers, all rendered **in the browser, at
runtime**, with **lazy-loaded** peers:

- **Highlighting** — `<aihu-code>` + `highlight()` render scoped-span HTML, with
  per-language tokenizers fetched on demand (~1.5 kB gz each).
- **Markdown rendering** — `<aihu-markdown>` + `renderMarkdown()` render
  CommonMark to **safe** semantic HTML via `@kindly-note/render-markdown` (raw
  HTML escaped, `javascript:`/unsafe `data:` URLs neutralised, `on*` handlers
  never emitted — safe for `innerHTML`).

## Peer dependencies

The kindly-note engine + emitter + lazy loader are peer dependencies for the
highlighting half:

```bash
bun add @kindly-note/core @kindly-note/emitters-html @kindly-note/loader-dynamic-import
```

For the markdown half, add the one-call renderer (it pulls in
`@kindly-note/emitters-markdown` + `@kindly-note/lang-markdown` transitively):

```bash
bun add @kindly-note/render-markdown
```

Language tokenizers are fetched on demand via dynamic `import()`. Install the
ones you intend to use so the resolver can find them:

```bash
bun add @kindly-note/lang-typescript @kindly-note/lang-json @kindly-note/lang-markdown
```

Pair with a theme for the `kn-*` classes:

```ts
import '@kindly-note/themes-default/dark.css'
```

## Usage

### `<aihu-code>` element

```ts
import { defineCodeElement } from '@aihu-plugin/kindly-note'
defineCodeElement() // registers <aihu-code> (idempotent, SSR-safe)
```

```html
<aihu-code lang="typescript">const x: number = 1</aihu-code>
```

Signal-driven (re-highlights automatically when the signal changes):

```ts
import { signal } from '@aihu/signals'
const [code, setCode] = signal('const a = 1')

const el = document.createElement('aihu-code')
el.language = 'typescript' // JS property is `language` (native `lang` is reserved)
el.code = code // pass the signal reader → element subscribes
document.body.append(el)

setCode('let b = 2') // <aihu-code> re-highlights
```

### `highlight()` helper

```ts
import { highlight } from '@aihu-plugin/kindly-note'

const { html, language, fallback } = await highlight('{"a": 1}', 'json')
// html === '<span class="kn-punctuation">{</span>…'
```

`highlight()` never throws: an unknown language returns the HTML-escaped source
with `fallback: true`.

### `<aihu-markdown>` element

```ts
import { defineMarkdownElement } from '@aihu-plugin/kindly-note'
defineMarkdownElement() // registers <aihu-markdown> (idempotent, SSR-safe)
```

```html
<aihu-markdown># Hello

**bold** and a [link](https://example.com).</aihu-markdown>
```

Rendered markup lands in an open shadow root. Signal-driven (re-renders
automatically when the signal changes):

```ts
import { signal } from '@aihu/signals'
const [md, setMd] = signal('# First')

const el = document.createElement('aihu-markdown')
el.source = md // pass the signal reader → element subscribes (alias: `el.markdown`)
document.body.append(el)

setMd('## Second') // <aihu-markdown> re-renders
```

### `renderMarkdown()` helper

```ts
import { renderMarkdown } from '@aihu-plugin/kindly-note'

const html = await renderMarkdown('# Hi\n\n**bold**')
// html === '<h1>Hi</h1>\n<p><strong>bold</strong></p>' — safe for innerHTML
```

Security-first by default: raw HTML is escaped and dangerous URL schemes are
neutralised. Highlight code fences by passing language packs:

```ts
import json from '@kindly-note/lang-json'
const html = await renderMarkdown('```json\n{"a": 1}\n```', { languages: [json] })
```

GFM (tables / task-lists / strikethrough / autolinks) is intentionally not
supported — that lives in `@kindly-note/lang-markdown-gfm`.

### Plugin registration

```ts
// aihu.config.ts
import { kindlyNote } from '@aihu-plugin/kindly-note'
import { defineAihuConfig } from '@aihu/server'

export default defineAihuConfig({ plugins: [kindlyNote()] })
```

## Scope

This package ships **both** halves: syntax **highlighting** (`<aihu-code>` /
`highlight()`) and markdown **rendering** (`<aihu-markdown>` / `renderMarkdown`),
the latter via the published `@kindly-note/render-markdown`. CommonMark only —
GFM (tables / task-lists / strikethrough / autolinks) is out of scope and lives
in `@kindly-note/lang-markdown-gfm`.
<!-- END_HANDWRITTEN: prose -->

## Install

<!-- BEGIN_AUTOGEN: install -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

```bash
npm install @aihu-plugin/kindly-note
# or
bun add @aihu-plugin/kindly-note
```

<sub><i>Auto-generated against `@aihu-plugin/kindly-note@0.2.4`.</i></sub>

<!-- END_AUTOGEN: install -->

## Package facts

<!-- BEGIN_AUTOGEN: stats -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| | |
|---|---|
| **Version** | `0.2.4` |
| **Tier** | F — UI — runtime syntax highlighting + markdown custom elements |
| **Bundle size** | 1.65 kB (gz) — limit 1850 B |
| **Published files** | 3 entries |
| **License** | MIT |

<sub><i>Auto-generated against `@aihu-plugin/kindly-note@0.2.4`.</i></sub>

<!-- END_AUTOGEN: stats -->

## Exports

<!-- BEGIN_AUTOGEN: exports -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| Subpath | ESM | CJS |
|---|---|---|
| `.` | `./dist/index.js` | `—` |

<sub><i>Auto-generated against `@aihu-plugin/kindly-note@0.2.4`.</i></sub>

<!-- END_AUTOGEN: exports -->

## Dependencies

<!-- BEGIN_AUTOGEN: deps -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

**Dependencies:**

- `@aihu/signals` — `^0.5.1`

**Peer dependencies:**

- `@kindly-note/core` — `^0.2.0`
- `@kindly-note/emitters-html` — `^0.1.0`
- `@kindly-note/loader-dynamic-import` — `^0.1.0`
- `@kindly-note/render-markdown` — `^0.1.0`

<sub><i>Auto-generated against `@aihu-plugin/kindly-note@0.2.4`.</i></sub>

<!-- END_AUTOGEN: deps -->

## See also

<!-- BEGIN_AUTOGEN: see-also -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

- [@aihu/ui](../ui)
- [Aihu framework root](../../README.md)

<sub><i>Auto-generated against `@aihu-plugin/kindly-note@0.2.4`.</i></sub>

<!-- END_AUTOGEN: see-also -->

## License

<!-- BEGIN_AUTOGEN: license -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

MIT — see [LICENSE](../../LICENSE).

<sub><i>Auto-generated against `@aihu-plugin/kindly-note@0.2.4`.</i></sub>

<!-- END_AUTOGEN: license -->
