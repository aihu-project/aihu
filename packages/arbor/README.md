# @aihu/arbor

> **Aihu** — agentic discovery and interaction, for human purpose.

Reactive component tree (the rendering layer that consumes @aihu/signals).

Part of the **runtime core** layer of the Aihu meta-framework. Shipped to the client; sized via `bun run size`. The runtime core is dep-free and stacks under `@aihu/runtime` → `@aihu/router` → `@aihu/server` → `@aihu/app`.

<!-- BEGIN_HANDWRITTEN: prose -->
DOM materialization primitives for the [aihu](../../README.md) project. Build a tree of `branch` / `leaf` nodes, hand it to `mount`, and the renderer wires every reactive binding once and tears it down LIFO when the scope disposes. No JSX runtime, no virtual DOM, no scheduler queue — just direct DOM operations against the live nodes.

**Status:** v0 surface frozen (Phase 3). Spec: [`.team/phase-3/spec-arbor.md`](../../.team/phase-3/spec-arbor.md). Bundle ≤ 2 kB gzipped.

## Hello mount

```ts
import { signal } from '@aihu/signals'
import { branch, leaf, mount } from '@aihu/arbor'

const [count, setCount] = signal(0)

const tree = branch('div', { class: 'counter' }, [
  leaf('Count: '),
  leaf([count, setCount]),    // signal as text content (reactive)
  branch('button', { onClick: () => setCount(c => c + 1) }, [
    leaf('+1'),
  ]),
])

const scope = mount(tree, document.body)
// later…
scope.dispose()  // removes the DOM and tears down every binding LIFO
```

## API

### `branch(tag, attrs?, children?): Branch`

Constructs a branch node. `tag` is the element tag name, or `null` for a fragment (children mount directly into the parent).

```ts
branch('section', { id: 'main' }, [ leaf('hi') ])
branch(null, null, [ leaf('a'), leaf('b') ])  // fragment
```

### `leaf(value): Leaf` / `leaf.element(tag, attrs?): Leaf`

Two shapes share one symbol:

- `leaf(value)` — text leaf. `value` is `string` (static) or a `Signal<string>` tuple (reactive).
- `leaf.element(tag, attrs?)` — terminal element leaf for `<img>`, `<br>`, `<input>`, `<hr>`, etc.

```ts
leaf('hi')                     // static text
leaf([greeting, setGreeting])  // reactive text
leaf.element('img', { src: '/logo.png' })
leaf.element('hr')
```

### `mount(node, host): MountScope`

Materializes `node` into `host` (an `Element` or `ShadowRoot`) synchronously. By the time `mount` returns, every reactive binding has run once and subscribed to its signal, every static attr is applied, and every DOM node is appended.

```ts
const scope = mount(tree, document.querySelector('#app')!)
scope.dispose()         // synchronous teardown, idempotent
scope.agent             // sub-project #7 stub (don't use in v0)
scope.serialize()       // throws ArborNotImplementedError in v0
```

## Attribute semantics

Inside `attrs`, each `[key, value]` pair is dispatched at mount time:

| Detection | Treatment |
|---|---|
| `key.startsWith('on')` AND value is a function | `el.addEventListener(key.slice(2).toLowerCase(), value)` |
| `Array.isArray(value)` (a Signal tuple `[Read, Write]`) | Wired through an effect — the DOM property/attribute tracks the signal. |
| `string` / `number` / `boolean` | Static. Set once at mount; never re-applied. |

Property vs attribute split: if `key in el` (e.g. `disabled`, `value`, `className`), the value is set as a DOM property; otherwise `setAttribute(key, String(value))`. See [`.team/phase-3/spec-arbor.md`](../../.team/phase-3/spec-arbor.md) §2.4.

> **Trust boundary.** `attrs` is the renderer's trust boundary. The compiler is responsible for never emitting attacker-controllable keys. If you call `branch()` / `leaf.element()` from hand-written code with user-controlled data, **do not** let user data flow into attribute *keys* — keys like `innerHTML`, `srcdoc`, `outerHTML` are real DOM properties and the runtime will assign them directly. Allow-list known-safe keys at your boundary.

## Disposal

`MountScope.dispose()` runs **LIFO**: deepest/latest effects first (so parent effects don't re-run against partially-cleaned children), then DOM root removal. Idempotent — calling twice is a no-op.

```ts
const a = mount(treeA, host)
const b = mount(treeB, host)
b.dispose()   // tears down b's effects then removes its roots
a.dispose()   // independent
```

## Coming in v1 (today: stubs that throw)

```ts
import { when, each } from '@aihu/arbor'
when(condition, () => branch(...))                     // ArborNotImplementedError in v0
each(list, item => item.id, item => branch(...))      // ArborNotImplementedError in v0
```

The signatures are locked; the v1 reconciler will swap the bodies.

## Pairing with non-`@aihu/signals` reactive systems

Arbor only requires the signal shape: a tuple `readonly [Read<T>, Write<T>]` where `Read<T> = () => T`. Anything that exposes that shape works. The runtime detects it via `Array.isArray(value)` (per the [Deviation #11 invariant](../../.team/phase-3/spec-arbor.md)).

## Tests

```bash
bunx vitest run packages/arbor
```

Includes an arbor microbench (`tests/bench.test.ts`) that mounts 10K static-leaf nodes in JSDOM.
<!-- END_HANDWRITTEN: prose -->

## Install

<!-- BEGIN_AUTOGEN: install -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

```bash
npm install @aihu/arbor
# or
bun add @aihu/arbor
```

<sub><i>Auto-generated against `@aihu/arbor@4.1.1`.</i></sub>

<!-- END_AUTOGEN: install -->

## Package facts

<!-- BEGIN_AUTOGEN: stats -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| | |
|---|---|
| **Version** | `4.1.1` |
| **Tier** | A — Reactive runtime core — DOM materialization layer |
| **Bundle size** | 3.10 kB (gz) — limit 3200 B |
| **Published files** | 3 entries |
| **License** | MIT |

<sub><i>Auto-generated against `@aihu/arbor@4.1.1`.</i></sub>

<!-- END_AUTOGEN: stats -->

## Exports

<!-- BEGIN_AUTOGEN: exports -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| Subpath | ESM | CJS |
|---|---|---|
| `.` | `./dist/index.js` | `—` |
| `./hydrate` | `./dist/hydrate.js` | `—` |
| `./progressive` | `./dist/progressive.js` | `—` |

<sub><i>Auto-generated against `@aihu/arbor@4.1.1`.</i></sub>

<!-- END_AUTOGEN: exports -->

## Dependencies

<!-- BEGIN_AUTOGEN: deps -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

**Peer dependencies:**

- `@aihu/signals` — `workspace:^`

<sub><i>Auto-generated against `@aihu/arbor@4.1.1`.</i></sub>

<!-- END_AUTOGEN: deps -->

## See also

<!-- BEGIN_AUTOGEN: see-also -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

- [Phase 3 spec (arbor)](../../.team/phase-3/spec-arbor.md)
- [bench/arbor](../../bench/arbor/RESULTS.md)
- [@aihu/signals](../signals)
- [@aihu/runtime](../runtime)
- [Aihu framework root](../../README.md)

<sub><i>Auto-generated against `@aihu/arbor@4.1.1`.</i></sub>

<!-- END_AUTOGEN: see-also -->

## License

<!-- BEGIN_AUTOGEN: license -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

MIT — see [LICENSE](../../LICENSE).

<sub><i>Auto-generated against `@aihu/arbor@4.1.1`.</i></sub>

<!-- END_AUTOGEN: license -->
