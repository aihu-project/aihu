# Spec: vscode-aihu LSP Language Server

## Problem

The `vscode-aihu` extension today delivers only static TextMate syntax highlighting and snippet expansion — there is no `main` entry point, no LSP server, and no programmatic language intelligence. This means developers using `.aihu` SFCs get no in-editor diagnostics when they write v1-era macro syntax (`$prop name: Type`, `$expose`, `$describe`, etc.) that the compiler will reject with C440-C444 errors; they get no actionable code actions to migrate to v2 collection-form; they cannot hover over a `$if` directive to see what `branch(...)` call it compiles to; and completion candidates for the 6 v2 macro kinds require the user to remember the exact collection-form grammar. Closing this gap matters most for agent DX: agents generating `.aihu` source need reliable, machine-readable feedback in the editor loop, and the existing silent-fail-at-build-time model makes iterative generation expensive.

## Scope (this spec)

**In scope:**
- LSP server process wiring into `vscode-aihu` (activation, client/server lifecycle)
- Diagnostic provider: surface compiler errors as VSCode diagnostics with `{from, to, range}` payload aligned with Builder B's `--machine-errors` JSON format
- Code action provider: offer "Migrate to v2 (aihu codemod)" for any diagnostic whose `code` is C440, C441, C442, C443, or C444
- Hover provider: show desugared form for sugar tokens (`$if`, `$each`, `$html`, `$show`, `$on:*`, `$bind:*`, `$prop`, `$computed`, `$action`, `$resource`, `$effect`, `$lifecycle`)
- Completion provider: 6 v2 macro-kind collection-form snippets (`$prop`, `$computed`, `$action`, `$resource`, `$effect`, `$lifecycle`) as `CompletionItem` entries, complementing (not replacing) the existing static snippets in `aihu.code-snippets`

**Explicitly out of scope:**
- Source maps (deferred to v1, OQ-C8 — `transform()` currently returns `map: null`)
- Go-to-definition, find-references, rename symbol
- Type-checking TypeScript inside `@state` blocks (delegate to the embedded TS language server)
- Template expression type inference
- Per-component shadow-mode awareness
- WASM compiler distribution (addressed in v1 resolution notes in `packages/compiler/js/index.ts`)

## Architecture

### Language server process model

The LSP server runs **out-of-process as a Node.js child process**, activated by `vscode-languageclient` (the `vscode-languageclient` npm package on the extension side) and `vscode-languageserver` (on the server side).

Rationale: The compiler integration (see below) calls `execFileSync` on the Rust binary — a synchronous, blocking subprocess invocation. Running this in-process (extension host) would block VS Code's UI thread on every document-changed event. An out-of-process server isolates blocking I/O from the extension host, can be restarted independently on crash, and is the standard pattern used by the official TypeScript, ESLint, and Svelte language servers.

The extension activates when a `.aihu` file is opened (`onLanguage:aihu` activation event, to be added to `package.json`). The server binary entry point is `packages/vscode-aihu/server/index.ts`, compiled to `out/server.js`. The extension `main` entry point (`packages/vscode-aihu/src/extension.ts`) starts the server using `LanguageClient` with a `ServerOptions` of type `stdio`.

```
vscode-aihu extension host
  └── LanguageClient (vscode-languageclient)
        │  stdio
        └── Node child process: out/server.js
              ├── TextDocumentSyncKind.Incremental
              ├── DiagnosticsProvider   ─── invokes aihu-compile Rust binary
              ├── CodeActionProvider
              ├── HoverProvider
              └── CompletionProvider
```

### Compiler integration

**Recommendation: Option A — shell out to `aihu-compile --machine-errors`**

The three options:

**Option A (recommended):** Shell out to `aihu-compile --machine-errors` and parse structured JSON from stdout/stderr. This is consistent with how `transform()` already works (`execFileSync` in `packages/compiler/js/index.ts:374-383`). The `--machine-errors` flag (to be added to the Rust CLI) makes the compiler emit a JSON array of diagnostic objects instead of human-readable text on stderr when compilation fails, and returns exit code 1 on error. The LSP server reads stdout for compiled code (on success) or reads the JSON from stderr (on failure).

**Option B:** Import `transform()` from `@aihu/compiler` directly. This is ruled out for two reasons: (1) `transform()` returns `{ code: string; map: null }` and throws a plain `Error` on compilation failure — the error message is a flat string printed by the Rust binary to stderr, with no structured `{code, line, col}` fields accessible from JS without regex parsing. (2) The `execFileSync` call inside `transform()` is synchronous and blocking; used directly inside the LSP server's `onDidChangeTextDocument` handler it would stall the Node.js event loop.

**Option C:** WASM bundle. Ruled out — the Rust WASM target is not yet produced by the build system (noted as a v1 resolution item in `packages/compiler/js/index.ts`).

**`--machine-errors` JSON schema** (to be implemented in the Rust CLI, aligned with Builder B's design):

```json
[
  {
    "code": "C440",
    "message": "C440 — old-spec macro form rejected for `$prop`...",
    "hint": "v2 grammar: `$<macro>: { name: { ... }, ... }`",
    "fix": "see docs/superpowers/specs/2026-05-05-spec-macro-vocabulary-v2.md",
    "from": { "line": 4, "character": 2 },
    "to":   { "line": 4, "character": 18 },
    "range": { "start": { "line": 4, "character": 2 }, "end": { "line": 4, "character": 18 } }
  }
]
```

Fields `from` and `to` are the 0-based LSP `Position` objects. `range` is the LSP `Range` (redundant but included for consumers that expect the composite form). The Rust `CompileError` struct already carries `line` (1-based) and `col` (0-based); the CLI serializer converts to 0-based LSP positions (`line - 1`, `col`).

Until `--machine-errors` is available in the Rust binary, the LSP server falls back to regex-parsing the Rust binary's stderr text for the `code: Some("C440")` pattern, extracting `line` and `col` from the error message string. This fallback is explicitly temporary and annotated `// TODO: remove when --machine-errors lands`.

**Invocation from LSP server:**

```typescript
// packages/vscode-aihu/server/compiler.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface AihuDiagnostic {
  code: string
  message: string
  hint?: string
  fix?: string
  from: { line: number; character: number }
  to: { line: number; character: number }
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
}

export async function compileWithDiagnostics(
  source: string,
  filePath: string,
): Promise<{ code: string | null; diagnostics: AihuDiagnostic[] }> {
  try {
    const { stdout } = await execFileAsync(binPath, ['--stdin', '--tag', stem, '--path', filePath, '--machine-errors'], {
      input: source,
      encoding: 'utf8',
    })
    return { code: stdout, diagnostics: [] }
  } catch (err: unknown) {
    // On failure, parse JSON array from stderr
    const stderr = (err as { stderr?: string }).stderr ?? ''
    try {
      const diagnostics: AihuDiagnostic[] = JSON.parse(stderr)
      return { code: null, diagnostics }
    } catch {
      // Fallback: single synthetic diagnostic from plain-text error
      return { code: null, diagnostics: [parsePlainError(stderr, filePath)] }
    }
  }
}
```

The LSP server calls `compileWithDiagnostics` on every `textDocument/didChange` event (debounced 300 ms) and on `textDocument/didOpen`.

### Diagnostic → Code Action wiring

The LSP server's `onInitialize` registers `codeActionProvider: true`. On `textDocument/codeAction`, the server receives the diagnostic range and the list of diagnostics in that range (VS Code passes them in `context.diagnostics`).

For each diagnostic where `diagnostic.code` is one of `C440`, `C441`, `C442`, `C443`, `C444`:

1. The server reads the full file content from its in-memory document store (`TextDocuments`).
2. It calls `migrate(source)` imported from `packages/compiler/js/codemods/macro-simplification/migrate.ts`. `migrate()` returns `{ rewritten: string, warnings: string[] }`.
3. The server returns a `CodeAction` of kind `QuickFix` with a single `WorkspaceEdit` that replaces the entire document text with `rewritten`. Title: `"Migrate to v2 macro syntax (aihu codemod)"`.
4. If `warnings.length > 0`, the code action description appends `" (${warnings.length} warning(s) — see Output panel)"` and the server logs warnings to the LSP output channel.

The `migrate()` function is file-scoped (it rewrites the entire `@state`/`@agent` block), so the code action always applies to the full document rather than a sub-range. This is correct: C440 errors can cascade from a single v1 construct, and a partial fix would leave the file in an inconsistent state.

**No shell-out required for `migrate()`** — it is a pure TypeScript function with no native dependencies, importable directly into the server process. The server imports it at startup:

```typescript
import { migrate } from '../../../compiler/js/codemods/macro-simplification/migrate.js'
```

In the packaged extension, `migrate.ts` must be bundled into the server output (via esbuild or `tsc` project reference). The `packages/vscode-aihu/package.json` build step must include the codemod as a bundled source (not a peer dep).

### Hover provider

**Tokens that receive hover:**

The server registers `hoverProvider: true` on `.aihu` files. On `textDocument/hover`, it inspects the word and surrounding context at the cursor position using the raw document text (no TextMate scope query needed — the server works from the source directly).

Token matching is done by regex against the line text at the hover position:

| Pattern matched at cursor | Hover content |
|---|---|
| `$if` | `// compiles to: branch(condition, () => trueBranch)` |
| `$each` | `// compiles to: branch.each(items, (item) => leaf(...))` |
| `$html` | `// compiles to: leaf({ nodeValue: htmlContent })` with raw-HTML note |
| `$show` | `// compiles to: inline style display toggle via computed` |
| `$on:*` | `// compiles to: element.addEventListener('event', handler)` |
| `$bind:*` | `// compiles to: two-way binding via signal setter` |
| `$prop` (in `@state`) | `// compiles to: computed(() => ctx.attrs.name)` (v2 form) |
| `$computed` (in `@state`) | `// compiles to: const name = computed(() => expr)` |
| `$action` (in `@state`) | `// compiles to: function name(args) { return batch(() => { body }) }` |
| `$resource` (in `@state`) | `// compiles to: const name = createResource(() => expr)` |
| `$effect` (in `@state`) | `// compiles to: effect(() => { body })` |
| `$lifecycle` (in `@state`) | `// compiles to: onMount(() => {...}) / onCleanup(() => {...})` |

These desugared forms are derived directly from the `emit_collection_entry` and `emit_state_macros` functions in `packages/compiler/src/parser/state_macros.rs` and their equivalents in the lowering pipeline — they are **static, pre-baked strings** in the hover provider, not computed by invoking the compiler. The hover provider uses a simple lookup table keyed on the matched macro keyword.

To determine whether the cursor is inside `@state` vs `@template`, the server scans backwards from the cursor line for `@state {` or `@template {` to establish block context. This is a linear scan on the in-memory text — no grammar parse needed.

**Hover format (MarkupContent `markdown`):**

```markdown
**aihu macro: `$computed`**

Compiles to:
```typescript
const name = computed(() => expr)
```

[v2 collection-form spec](2026-05-05-spec-macro-vocabulary-v2.md)
```

### Completion provider

The server registers `completionProvider: { triggerCharacters: ['$', '@'] }`.

**`$` trigger (inside `@state` block):** Offer 6 `CompletionItem` entries for the v2 collection-form macros. Each item has:
- `kind: CompletionItemKind.Snippet`
- `insertTextFormat: InsertTextFormat.Snippet`
- `label`: the macro keyword (e.g., `$prop`)
- `detail`: one-line description (e.g., `"v2 collection-form prop declarations"`)
- `insertText`: the full v2 collection skeleton as a snippet string

Example for `$prop`:
```
$prop: {
  ${1:name}: { default: ${2:undefined}, describe: '${3:description}' },
}
```

Example for `$computed`:
```
$computed: {
  ${1:name}: () => ${2:expression},
}
```

Example for `$action`:
```
$action: {
  ${1:name}: (${2:args}) => { ${3:body} },
}
```

Example for `$effect` (anonymous form):
```
$effect: () => {
  ${1:body}
}
```

Example for `$resource`:
```
$resource: {
  ${1:name}: () => ${2:fetchExpr()},
}
```

Example for `$lifecycle`:
```
$lifecycle: {
  mount: () => { ${1:initBody} },
  dispose: () => { ${2:cleanupBody} },
}
```

**`@` trigger (top-level, outside any block):** Offer completions for `@state`, `@template`, `@style`, `@agent`, `@route`. These are lightweight (label only, delegating body expansion to the existing static snippets in `aihu.code-snippets`). This avoids duplicating the full component scaffold templates.

**Deduplication with existing snippets:** The static snippets in `aihu.code-snippets` fire via VS Code's snippet engine and appear in the completion list independently. The LSP completion items should set `sortText` with a prefix (e.g., `"0_$prop"`) to appear first in the list when the `$` prefix is typed, but must NOT suppress the static snippet entries (those remain registered under `contributes.snippets`).

## Acceptance criteria (for a future Builder)

1. AC1: Opening a `.aihu` file activates the extension (`onLanguage:aihu`); the LSP server process starts and the "Aihu Language Server" output channel appears in VS Code with the message `"Aihu LSP server started"`.

2. AC2: A `.aihu` file containing a v1 `$prop label: String` line inside `@state { }` shows a red squiggly under `$prop label: String` within 500 ms of the file opening, with diagnostic message containing `"C440"` and severity `Error`.

3. AC3: Right-clicking on the C440 diagnostic and selecting "Quick Fix" shows the action `"Migrate to v2 macro syntax (aihu codemod)"`. Applying it rewrites the `@state` block to `$prop: { label: { default: undefined } }` (or equivalent v2 form per `migrate()`'s output) and removes the diagnostic.

4. AC4: A `.aihu` file with two `$effect: () => { ... }` lines inside a single `@state { }` block shows a `C441` diagnostic. The Quick Fix action applies `migrate()` and leaves exactly one `$effect: () => { ... }` or converts to named-collection form per codemod rules.

5. AC5: Hovering over `$if` on a `<div $if={cond}>` line inside `@template { }` shows a hover popup containing the text `branch(` within 200 ms.

6. AC6: Hovering over `$computed` on the line `$computed: {` inside `@state { }` shows a hover popup containing the text `computed(() => expr)`.

7. AC7: Typing `$` inside an `@state { }` block produces a completion list containing at minimum `$prop`, `$computed`, `$action`, `$resource`, `$effect`, `$lifecycle` as LSP snippet completions. Selecting `$prop` inserts the v2 collection skeleton with tab stops.

8. AC8: Typing `@` at the top level of a `.aihu` file (outside any block) produces completion candidates for `@state`, `@template`, `@style`, `@agent`, `@route`.

9. AC9: A syntactically valid `.aihu` file with no v1 macro syntax produces zero diagnostics from the LSP server. Existing TypeScript diagnostics inside `@state` (from the embedded TS language server) are unaffected.

10. AC10: The compiler diagnostic includes `from`, `to`, and `range` fields. The squiggly in the editor covers the exact character range indicated by `from`/`to` (verified by checking that the highlighted range aligns with the rejected macro token, not the whole line).

11. AC11: The LSP server survives a malformed `.aihu` file (e.g., unclosed `@state {` brace) without crashing. The output channel must not show an unhandled exception; the server must continue responding to subsequent `textDocument/didChange` events.

12. AC12: `bun run test` in `packages/vscode-aihu/` passes a suite of at least 10 unit tests covering: diagnostic extraction from `--machine-errors` JSON, `migrate()` invocation via code action, hover table lookup for all 12 macro tokens, and completion item generation for all 6 macro kinds.

## Open questions

1. **`--machine-errors` CLI flag ownership:** Who implements the Rust-side `--machine-errors` JSON output? This spec assumes Builder B wires the flag. If Builder B's scope is only the JS codemod, the LSP builder must implement the fallback regex parser permanently or take on the Rust CLI change themselves. Needs Team Lead decision.

2. **Debounce and file-size gate:** The spec recommends 300 ms debounce on `textDocument/didChange`. For very large `.aihu` files (> 50 KB), should the LSP server skip diagnostics entirely or cap at a file-size limit? The current `execFileSync` in `transform()` has no timeout.

3. **Binary path in packaged extension:** The Rust binary at `bin/aihu-compile[.exe]` is written by `postinstall`. In a packaged `.vsix`, the postinstall hook does not run. The LSP server needs a strategy for binary bundling (pre-built platform binaries, similar to how `esbuild` or `@biomejs/biome` ship platform-specific binaries via optional deps). This is the same OQ as the v1 WASM/binary strategy in `packages/compiler/js/index.ts`.

4. **Hover for `$on:event` (namespaced directives):** The hover table above shows a generic entry for all `$on:*`. Should the hover show the specific event name (e.g., hovering `$on:click` shows `element.addEventListener('click', handler)` with `click` interpolated)? This requires extracting the event name from the token, not just matching `$on`.

5. **Code action scope — document vs. block:** `migrate()` rewrites the entire `@state` block. If a user has a C440 diagnostic in one of two `@state` blocks (future: multi-block files), the code action must scope correctly. The current `migrate()` implementation calls `findBlock(source, 'state')` which finds the first `@state` block only. Multi-block handling is an open question for the codemod, not this LSP spec.

## Alternatives considered

**Option B (import `transform()` directly):** Rejected because `transform()` returns `{ code: string; map: null }` — a bare compiled string with no structured diagnostic data. Errors manifest as thrown `Error` objects whose `.message` is the raw stderr string from the Rust process. Parsing structured `{code, line, col}` fields out of that string via regex is fragile and duplicates parsing logic. Additionally, `execFileSync` inside `transform()` blocks the Node.js event loop; using it in the LSP server's per-keystroke handler would freeze the editor.

**Option C (WASM):** Rejected for this spec cycle. The Rust WASM target is listed as a v1 resolution item (`packages/compiler/js/index.ts` build note); it does not exist today. Building the WASM target adds a non-trivial Rust build step and increases the extension bundle size. Option A (subprocess) is functionally equivalent and available immediately.

**In-process LSP (extension host):** Rejected because the compiler invocation is synchronous I/O. An in-process server on the extension host thread would block VS Code's UI on every `textDocument/didChange` event. The VS Code LSP client/server split exists precisely to avoid this.

**Scope-based hover (querying TextMate grammar):** The LSP server could query VS Code's `vscode.languages.getTokenInformationAtPosition` or parse the TextMate scopes to find macro tokens. Rejected in favor of direct regex matching against line text: the TextMate scope API is only available in the extension host (not the server process), requires an IPC round-trip, and adds coupling to VS Code internals. The macro token set is small and stable; regex matching on line text is simpler and testable without a VS Code instance.
