# @aihu/store

> **Aihu** — agentic discovery and interaction, for human purpose.

Pinia-style global stores on aihu signals — defineStore, SSR-safe per-request instances, registry-based serialize/hydrate, plugins.

Held-private workspace package. Not yet published to npm.

> **Status:** Held private — not yet published to npm. See [v1.1 roadmap](../../docs/roadmap/SUMMARY.md) for ratification gating (e.g. RFC #56 live-binding for `@aihu/plugin` enforcement).

<!-- BEGIN_HANDWRITTEN: prose -->
## defineStore

Setup-function style is primary — use `signal`/`computed`/plain functions and return the store shape. State is the set of `k`/`setK` read-write pairs:

```ts
import { computed, signal } from '@aihu/signals'
import { defineStore } from '@aihu/store'

export const useCart = defineStore('cart', () => {
  const [items, setItems] = signal<string[]>([])
  const size = computed(() => items().length)
  function add(item: string) {
    setItems((prev) => [...prev, item])
  }
  return { items, setItems, size, add }
})

const cart = useCart() // lazy singleton per id (per request on the server)
cart.add('apple')
cart.size() // 1
```

Options style lowers onto the same core — each `state()` key becomes a `k`/`setK` signal pair, getters become computeds over the state reads, actions get `this` bound to the store:

```ts
export const useCart = defineStore('cart', {
  state: () => ({ items: [] as string[] }),
  getters: { size: (s) => s.items().length },
  actions: {
    add(item: string) {
      this.setItems((prev) => [...prev, item])
    },
  },
})
```

Per-store custom options (consumed by plugins) go in the third argument for **both** styles: `defineStore(id, def, { persist: true })`.

### Instance surface

- `$id` — the store id.
- `$patch(objOrFn)` — several writes, one notification (object form writes state keys; function form receives the store).
- `$reset()` — options-style only: re-runs the `state()` factory. Setup stores throw (their initial values are arbitrary expressions inside the setup closure — there is no factory to re-run; write an explicit reset action instead).
- `$subscribe(cb)` — `cb(stateSnapshot)` after each state change (batch = one call). Returns dispose.
- `$onAction(cb)` — before/`after`/`onError` hooks around every action call. Returns dispose.
- `$dispose()` — tears down subscriptions and store-owned computeds, unregisters the instance (next `useStore()` re-instantiates).

### State detection (setup style)

A key `k` is **state** when the setup returns a read function under `k` and a setter under `set${Capitalize(k)}`. Computed reads are recognized by their `.dispose` property and are neither state nor actions; remaining returned functions are actions; plain values pass through untouched (and are not serialized). An unpaired signal read is treated as an action-shaped function — expose state as read+setter pairs.

## SSR

Server: wrap each request in `runWithContext(new Map(), render)` (from `@aihu/context`). Store instances then live per request — no cross-request leakage — and `serializeStores()` reads only the active request's registry. This path is **arbor-independent**: it never touches the arbor tree or `MountScope.serialize()`, so a compile-time SSR string renderer serializes stores identically.

Wire shape — `{ [storeId]: { [stateKey]: jsonValue } }`, `<script type="application/json">` compatible. Only state is serialized, never getters/actions:

```ts
// server, inside the request scope, after rendering
const json = JSON.stringify(serializeStores()).replace(/</g, '\\u003c')
html += `<script type="application/json" id="__AIHU_STORE_STATE__">${json}</script>`

// client entry, BEFORE mounting components
const el = document.getElementById('__AIHU_STORE_STATE__')
if (el) hydrateStores(JSON.parse(el.textContent!))
```

`hydrateStores` pre-seeds the registry: stores used later adopt their snapshot during instantiation (before any subscriber can observe defaults); snapshot entries for stores never used stay pending; client stores absent from the snapshot initialize fresh.

## Plugins

```ts
import { registerStorePlugin } from '@aihu/store'

const dispose = registerStorePlugin(({ store, id, options }) => {
  store.$onAction(({ name }) => console.log(`${id}.${name}`))
  return { $custom: true } // merged onto the instance
})
```

First-party: `persistPlugin` / `createPersistPlugin({ storage, prefix })` — localStorage write-through, opt-in via `{ persist: true | { key } }`, SSR-guarded (no window access on server), hydrate-from-storage on client init (local edits win over an SSR snapshot), writes coalesced per microtask.

## Dev

In dev builds (`process.env.NODE_ENV !== 'production'`, same convention as `@aihu/signals`) the client registry is exposed as `globalThis.__AIHU_STORES__` for console inspection.
<!-- END_HANDWRITTEN: prose -->

## Install

<!-- BEGIN_AUTOGEN: install -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

```bash
npm install @aihu/store
# or
bun add @aihu/store
```

<sub><i>Auto-generated against `@aihu/store@0.1.2`.</i></sub>

<!-- END_AUTOGEN: install -->

## Package facts

<!-- BEGIN_AUTOGEN: stats -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| | |
|---|---|
| **Version** | `0.1.2` |
| **Tier** | G — State — Pinia-style global stores on aihu signals (SSR-safe per-request) |
| **Bundle size** | 1.81 kB (gz) — limit 2.5 KB |
| **Published files** | 3 entries |
| **License** | MIT |

<sub><i>Auto-generated against `@aihu/store@0.1.2`.</i></sub>

<!-- END_AUTOGEN: stats -->

## Exports

<!-- BEGIN_AUTOGEN: exports -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| Subpath | ESM | CJS |
|---|---|---|
| `.` | `./dist/index.js` | `—` |

<sub><i>Auto-generated against `@aihu/store@0.1.2`.</i></sub>

<!-- END_AUTOGEN: exports -->

## Dependencies

<!-- BEGIN_AUTOGEN: deps -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

**Dependencies:**

- `@aihu/context` — `workspace:*`
- `@aihu/signals` — `^0.5.1`

<sub><i>Auto-generated against `@aihu/store@0.1.2`.</i></sub>

<!-- END_AUTOGEN: deps -->

## See also

<!-- BEGIN_AUTOGEN: see-also -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

- [@aihu/signals](https://github.com/aihu-project/aihu-dom)
- [@aihu/context](../context)
- [Aihu framework root](../../README.md)

<sub><i>Auto-generated against `@aihu/store@0.1.2`.</i></sub>

<!-- END_AUTOGEN: see-also -->

## License

<!-- BEGIN_AUTOGEN: license -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

MIT — see [LICENSE](../../LICENSE).

<sub><i>Auto-generated against `@aihu/store@0.1.2`.</i></sub>

<!-- END_AUTOGEN: license -->
