# @aihu/editor

> **Aihu** — agentic discovery and interaction, for human purpose.

Hand-rolled, dependency-free, GX-governed rich-text editor — JSON doc model, invertible transactions, markdown (web-v1 dialect) round-trip, contenteditable view with IME-safe read-back, agent read/suggest/write surface.

Held-private workspace package. Not yet published to npm.

> **Status:** Held private — not yet published to npm. See [v1.1 roadmap](../../docs/roadmap/SUMMARY.md) for ratification gating (e.g. RFC #56 live-binding for `@aihu/plugin` enforcement).

<!-- BEGIN_HANDWRITTEN: prose -->
## What this is

The editor from `docs/plans/editor/architecture.md` (Phase-0 amended): no ProseMirror, no Lexical, no third-party runtime dependencies — the whole pipeline is aihu's own. Three layers:

- **`EditorCore`** — DOM-free: the document model (paragraphs, headings 1–3, flat bullet/ordered lists, inline-only blockquote, hr; strong/em/code/link marks, at most one per run), serializable **invertible steps**, one `apply()` door (validate → mutate a clone → normalize → commit; never partial), and undo/redo with ~1 s typing coalescing. This is what a server or an agent test harness drives.
- **`EditorView`** — binds a core to one `contenteditable` root. `beforeinput`-primary (unknown inputTypes fail closed), composition is browser-owned with a synchronous `takeRecords()` drain on `compositionend` (Phase-0 amendment A1), uncontrolled DOM mutations recover through a **structure-aware read-back** that preserves marks (A2), all offsets are UTF-16 code units (A3), and commands resolve the live selection from the DOM at dispatch (A4).
- **`<aihu-editor>`** (`components/aihu-editor.aihu`) — the SFC: props/events, the `agentAccess` knob, the suggest-mode accept/reject bar, and a `mode: 'source'` markdown-textarea fallback sharing the same props/events. `<aihu-editor-toolbar>` is separate and talks only through `exec`/`can`.

```ts
import { EditorCore, EditorView, fromMarkdown, toMarkdown } from '@aihu/editor'

const core = new EditorCore(fromMarkdown('# Hello\n\nworld'))
const view = new EditorView(document.querySelector('#surface')!, core)
core.onTransaction((tr, doc) => console.log(tr.origin, toMarkdown(doc)))
```

## Markdown — the web-v1 dialect

`toMarkdown`/`fromMarkdown` are dialect-locked to fellwork/web's `journal/markdown.ts` **plus** the landed escape semantics of web#46: all-ASCII-punctuation backslash escapes, honored line-start escapes (`\#`, `\-`, `\>`, `1\.`, `\---`), verbatim code spans (backtick content gets a longer delimiter, never `\` inside a span), and no hard line breaks. The round-trip contract — `fromMarkdown(toMarkdown(d)) ≡ d` (mod ids) — is enforced by a vendored golden corpus (`tests/fixtures/golden.json`) and 1 000 fuzzed docs per run. Fenced code blocks and pipe tables are v2: they import as degraded paragraphs, and the editor never emits them.

## Security posture

No HTML sink anywhere — rendering is `createElement`/`createTextNode` only, enforced by a runnable grep gate (`tests/no-html-sink.test.ts`). Paste goes through an inert `DOMParser` allowlist walk that drops every attribute except `a[href]`, and hrefs pass `safeHref` (same contract as web; exported standalone as `@aihu/editor/safe-href`) **at model write time** — a `javascript:` href cannot exist in the doc, whether it arrives by paste, typing, or an agent's `applyMark`.

## The GX surface

The thesis-critical part: the keyboard and the agent share ONE transaction pipeline.

- **Read** (`expose: read`): `doc`, `docMarkdown`, `docOutline`, `selectionContext`.
- **Write** (`expose: read write`): `insertBlock`, `replaceRange`, `applyMark`, `applyTransaction` — all validated by the same `EditorCore.apply()` as keystrokes, all landing in the shared undo history with `origin: 'agent:<tool>'`. A human Ctrl-Z reverts an agent edit and vice versa.
- **`agentAccess` prop**: `'none' | 'read' | 'suggest' | 'write'`, default `'read'`, failing closed on unknown values. In `'suggest'` mode writes are validated but **staged** as accept/reject proposals — the human governs, the agent proposes through the same typed channel.

## Testing

- Unit (vitest/jsdom): core, steps/inversion, history, serializers + round-trip fuzz, input rules, commands, paste sanitization, position map, read-back, view, agent gateway, compile gate for the SFCs.
- Real browsers (Playwright, chromium+webkit+firefox): `bun run test:e2e` — typing/IME (real Chromium IME via CDP), paste, agent tiers, structure-aware read-back, selection survival. Playwright is a root devDependency.
<!-- END_HANDWRITTEN: prose -->

## Install

<!-- BEGIN_AUTOGEN: install -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

```bash
npm install @aihu/editor
# or
bun add @aihu/editor
```

<sub><i>Auto-generated against `@aihu/editor@0.1.2`.</i></sub>

<!-- END_AUTOGEN: install -->

## Package facts

<!-- BEGIN_AUTOGEN: stats -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| | |
|---|---|
| **Version** | `0.1.2` |
| **Tier** | G — Content — GX-governed rich-text editor (JSON doc model + transactions) |
| **Bundle size** | 13.56 kB (gz) — limit 14 KB |
| **Published files** | 4 entries |
| **License** | MIT |

<sub><i>Auto-generated against `@aihu/editor@0.1.2`.</i></sub>

<!-- END_AUTOGEN: stats -->

## Exports

<!-- BEGIN_AUTOGEN: exports -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| Subpath | ESM | CJS |
|---|---|---|
| `.` | `./dist/index.js` | `—` |
| `./safe-href` | `./dist/safe-href.js` | `—` |
| `./components/aihu-editor.aihu` | `./components/aihu-editor.aihu` | — |
| `./components/aihu-editor-toolbar.aihu` | `./components/aihu-editor-toolbar.aihu` | — |

<sub><i>Auto-generated against `@aihu/editor@0.1.2`.</i></sub>

<!-- END_AUTOGEN: exports -->

## Dependencies

<!-- BEGIN_AUTOGEN: deps -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

**Dependencies:**

- `@aihu/signals` — `^0.5.1`

<sub><i>Auto-generated against `@aihu/editor@0.1.2`.</i></sub>

<!-- END_AUTOGEN: deps -->

## See also

<!-- BEGIN_AUTOGEN: see-also -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

- [@aihu/agent](../agent)
- [@aihu/store](../store)
- [Aihu framework root](../../README.md)

<sub><i>Auto-generated against `@aihu/editor@0.1.2`.</i></sub>

<!-- END_AUTOGEN: see-also -->

## License

<!-- BEGIN_AUTOGEN: license -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

MIT — see [LICENSE](../../LICENSE).

<sub><i>Auto-generated against `@aihu/editor@0.1.2`.</i></sub>

<!-- END_AUTOGEN: license -->
