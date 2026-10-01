# AI assistants working on this project

This is an aihu application. AI assistants working on `.aihu` SFC files should know the following rules. These rules reflect patterns that are commonly wrong in AI-generated code and must be followed exactly.

## 5 rules for .aihu files

1. **Signal mutation goes through the setter, never direct assignment**: Signals declared with `const [value, setValue] = signal(initial)` are read-only tuples. `value` is a getter function; `setValue` is the only way to update it. Never write `value = newVal` or reassign any part of the signal tuple. To update based on previous value, use the updater form: `setValue(prev => prev + 1)`. The same rule applies to `$prop` values — never assign `$prop.name = x` directly.

   ```ts
   // Wrong
   count = 5
   items = [...items, newItem]

   // Correct
   setCount(5)
   setItems(prev => [...prev, newItem])
   ```

2. **Use v2 collection-form macros in `@state`, not v1 statement macros**: The v1 syntax used top-level statements like `$action name() { }`, `$computed name = expr`, and `$lifecycle.mount(() => { })`. The current v2 syntax groups these into object-literal collection blocks: `$action: { name: () => { } }`, `$computed: { name: () => expr }`, and `$lifecycle: { mount: () => { } }`. Never generate v1-style statement macros. When in doubt, run `npx aihu migrate` to upgrade.

   ```ts
   // Wrong (v1)
   $action increment() { setCount(count() + 1) }
   $computed doubled = count() * 2
   $lifecycle.mount(() => { init() })

   // Correct (v2)
   $action: {
     increment: () => setCount(count() + 1),
   }
   $computed: {
     doubled: () => count() * 2,
   }
   $lifecycle: {
     mount: () => { init() },
   }
   ```

3. **Import from `@aihu/*`, not `@scribe/*`**: The framework was renamed from Scribe to aihu. All packages live under the `@aihu/` npm scope. There is no `@scribe/` scope. Generating any import from `@scribe/*` will cause a build failure.

   ```ts
   // Wrong
   import { signal } from '@scribe/signals'
   import { mount } from '@scribe/arbor'

   // Correct
   import { signal } from '@aihu/signals'
   import { branch, leaf, mount } from '@aihu/arbor'
   ```

4. **Read signals as function calls in script; use bare names in template expressions**: Inside `@state`, signals are getter functions — always call them with `()`: `count()`, `items()`. In `@template` expressions, the compiler automatically invokes signal getters, so use the bare name without `()`: `{count}`, `if={items.length > 0}`. Mixing these up causes either a stale render (bare name in script) or a rendered function reference (called signal in a template where the compiler re-wraps it).

   ```ts
   // @state — always call signal getters
   const doubled = computed(() => count() * 2)
   const isEmpty = computed(() => items().length === 0)
   ```

   ```html
   @template {
     <!-- @template — bare name, no () -->
     <h1>{count}</h1>
     <p if={isEmpty}>No items</p>
     <!-- Exception: inside inline JS expressions in templates, use () -->
     <button $on:click={() => setCount(count() + 1)}>+</button>
   }
   ```

5. **Template directives are prefix-less colon forms; `$` belongs to `@state` macros only**: In `@template`, event handlers use `on:click`, `on:input`, `on:keydown` (dotted modifiers allowed: `on:click.prevent`) and two-way binding uses `bind:value`. Control flow is naked attributes: `if={…}`, `elseif={…}`, `else`, `each={item, i of items}`, `key={…}`, with `empty` on the sibling after an `each`. Reactive attribute values are plain braces (`disabled={loading}`); quoted strings are static. `$`-prefixed names (`$emit.eventName`, `$lifecycle.mount`, `$prop`, …) appear only inside `@state` blocks. Generating `$on.click`, `$bind.value`, `$if=`, or `$each=` as template attributes is always wrong (compile errors C606/C607).

   ```html
   @template {
     <!-- Correct template directive syntax -->
     <input $bind:value="draft" $on:input={() => validate()} />
     <button $on:click="submit">Submit</button>
     <form $on:submit={(e) => { e.preventDefault(); submit() }}>

     <!-- Wrong — dot form is not valid in @template attributes -->
     <button on:click={submit}>Submit</button>
   }
   ```
