# Template grammar v2 — build status

Live status of the prefix-less template redesign. Design of record: `40-spec.md`
(ratified, on `main`). Tracking epic: GitHub #483 / Linear FEL-336 (aihu project).

## The one rule (recap)
Naked control-flow keywords + naked HTML attributes (`{}` reactive / `""` static) +
`word:param` colon directives (`on:` `class:` `bind:` `attr:`) + naked framework
vocabulary; `{expr}` interpolation; `$` only in `@state` (until the @state arc removes it).

## Phases

| Phase | What | Status |
|---|---|---|
| Spec | normative design-of-record (`40-spec.md`) | ✅ #481 |
| SSR walk | `{#if}`/`{#each}` render server-side; closes the entitled dual-audience gap | ✅ #482 (#465) |
| Grammar compiler + migration | new grammar, C601–C611 retirements, `of` binder, `empty`, adjacency, `attr:`, `<a>` enhancement, kill `{{ }}`/`{@html}`; migrate every in-repo `.aihu` (atomic) | in progress #484 · `feat/grammar-v2` |
| TS-generator 1–3 | rewrite-before-lift + ast default; real `if/else` sidecar emission; `for…of` + `__aihu_each` inference | ✅ #485 (#490) |
| TS-generator 4–5 | attribute + component-prop typing (`--strict-templates`); unify editor + CLI on `compileSidecar` | landing #486 · `feat/ts-generator-4-5` |
| @state arc | reactive-declaration model (see below) | queued #487 |

## The verified problem the type lanes fix
aihu-tsc today **false-errors** on the documented authoring contract — a bare signal read
`{count > 0}` type-checks as *the getter function* — and skips narrowing, loop-item, and
attribute/prop typing; the editor and CLI run two different code paths. The industry
consensus (JSX/Vue-Volar/Svelte/Angular) is to emit real TS shapes (real `if/else`, real
`for…of`) and let tsc infer. The new grammar's `of` binder maps *verbatim* onto `for…of`,
which is the type-architecture unlock — this is why the grammar and the type fix ship together.

## The @state arc (queued — its own effort after the grammar lands)
Founder insight "a prop is const": `@state` declarations factor into **nature** (`const`
read-only / `let` mutable — the TS keyword, shared with `@template`) + **role**
(prop/computed/action, as metadata). A computed *is* `const name = <reactive expr>`.
Declarations become valid TS with compiler-recognized wrappers:

```
const city = prop<string>({ default: 'London', describe: '…', expose: 'read' })
const fetchForecast = action({ describe: '…', expose: 'public' }, async () => { … })
let loading = false
```

One signature `wrapper(config?, valueOrFn)` (config-first); wrappers only where metadata
exists; `expose: 'public'` desugars to the GX `{read, write}` shape. Naked wrappers retire
`$` from `@state` entirely. **Open fork:** bare `let x=0` auto-reactive vs explicit
`let x = state(0)` — resolve by surveying Svelte-5-runes / Solid / Vue-Vapor at kickoff.
Sits on the shipped GX `$extract`/`expose`/`$scope` machinery — sequenced after the grammar
so two core surfaces don't wobble at once.

## No external consumers
Every "breaking" step here affects only the in-repo corpus + fellwork-web, both ours to
fix. Old forms become hard compile errors with `fix:` hints — no deprecation runway. The
corpus building green is the compat test.
