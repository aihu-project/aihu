/**
 * packages/language-server/tests/hover-coverage.test.ts
 *
 * Per-macro hover coverage regression-mask (M2 A4 round-0).
 *
 * Two parametrized contracts per director-note §3.8:
 *   1. `getHoverContent(name)` returns non-null for every name in the static
 *      list below.
 *   2. `getMacroAtPosition(line, ch)` resolves to the expected hover-table
 *      key when fed a canonical synthetic fixture line for that macro.
 *
 * IMPORTANT: the macro list is DEFINED STATICALLY in this file. It is NOT
 * imported from `hover.ts`. Per the dispatch brief, this is the explicit
 * defense against silent deletions in HOVER_TABLE — if a key disappears
 * from the table, this test must fail.
 *
 * Resolver-return contract (from director-note §3.8):
 *   - Bare forms (`$prop`, `$watch`, ...) → resolver returns the same bare key.
 *   - Dotted/namespaced forms (`$effect.on`, `$lifecycle.mount`, `$emit.foo`)
 *     → resolver returns the BARE prefix (`$effect`, `$lifecycle`, `$emit`).
 *     This is the v1 behavior preserved into v2.
 *   - Template-element forms (`<slot>`, ...) → resolver returns the angle-
 *     bracketed form `<slot>` (the table key).
 *
 * The fixture below uses canonical lines for each name and selects a
 * character position that lands inside the macro token.
 */
import { describe, expect, it } from 'vitest'
import { getHoverContent, getMacroAtPosition } from '../src/core/hover.ts'

// 35 resolver-token keys — STATIC, NOT imported from hover.ts.
// Order: existing 13 first, then 23 new in director-note §3.1 enumeration order
// (less `$server`, retired in chore/retire-server-macro).
const HOVER_KEYS: readonly string[] = [
  // Existing 13 (pre-A4)
  '$prop',
  '$computed',
  '$action',
  '$resource',
  '$effect',
  '$lifecycle',
  '$if',
  '$each',
  '$html',
  '$show',
  '$on',
  '$bind',
  '$emit',
  // @state additions (round-0)
  '$watch',
  '$expose',
  '$shared',
  '$cookie',
  '$meta',
  // @template additions (round-0)
  '$key',
  '$raw',
  '$once',
  '$memo',
  '<slot>',
  '<suspense>',
  '<shield>',
  '<guard>',
  '<warp>',
  // @style additions (round-0)
  '$reactive',
  '$container',
  '$prefers',
  '$global',
  '$media',
  '$when',
  // @agent additions (round-0)
  '$scope',
  '$rate-limit',
  '$describe',
]

describe('hover coverage — getHoverContent returns non-null for all 36 keys', () => {
  it.each(HOVER_KEYS)('has hover content for %s', (key) => {
    const content = getHoverContent(key)
    expect(content).toBeTruthy()
    expect(typeof content).toBe('string')
    expect(content!.length).toBeGreaterThan(20)
  })

  it('static key list contains exactly 36 entries (regression mask)', () => {
    expect(HOVER_KEYS).toHaveLength(36)
  })
})

/**
 * Fixture lines and probe positions for getMacroAtPosition.
 *
 * `expected` is what `getMacroAtPosition` should RETURN for the resolver
 * (which may differ from the hover-table key for dotted forms — see header).
 *
 * `hoverKey` is the HOVER_TABLE key that the returned resolver token should
 * route to via `getHoverContent`. For bare and element forms this equals
 * `expected`; for dotted forms it's the bare prefix.
 */
interface Probe {
  name: string
  line: string
  ch: number
  expected: string
  hoverKey: string
}

const PROBES: Probe[] = [
  // Existing 13
  { name: '$prop', line: '  $prop: {', ch: 3, expected: '$prop', hoverKey: '$prop' },
  {
    name: '$computed',
    line: '  $computed: { x: () => 1 }',
    ch: 3,
    expected: '$computed',
    hoverKey: '$computed',
  },
  {
    name: '$action',
    line: '  $action: { save: () => {} }',
    ch: 3,
    expected: '$action',
    hoverKey: '$action',
  },
  {
    name: '$resource',
    line: '  $resource: { post: () => fetch() }',
    ch: 3,
    expected: '$resource',
    hoverKey: '$resource',
  },
  {
    name: '$effect',
    line: '  $effect: () => { body }',
    ch: 3,
    expected: '$effect',
    hoverKey: '$effect',
  },
  {
    name: '$lifecycle',
    line: '  $lifecycle: { mount: () => {} }',
    ch: 3,
    expected: '$lifecycle',
    hoverKey: '$lifecycle',
  },
  { name: '$if', line: '  <div if={c > 0}>', ch: 8, expected: '$if', hoverKey: '$if' },
  {
    name: '$each',
    line: '  <li each={x of xs}>',
    ch: 8,
    expected: '$each',
    hoverKey: '$each',
  },
  { name: '$html', line: '  <div html={raw} />', ch: 9, expected: '$html', hoverKey: '$html' },
  { name: '$show', line: '  <div show={ok}>', ch: 9, expected: '$show', hoverKey: '$show' },
  {
    name: '$on',
    line: '  <button on:click={save}>',
    ch: 11,
    expected: '$on',
    hoverKey: '$on',
  },
  {
    name: '$bind',
    line: '  <input bind:value={n} />',
    ch: 10,
    expected: '$bind',
    hoverKey: '$bind',
  },
  {
    name: '$emit',
    line: '  on:click={() => $emit.dayjump({ day })}',
    ch: 19,
    expected: '$emit',
    hoverKey: '$emit',
  },
  // @state new
  {
    name: '$watch',
    line: '  $watch(count, (n, p) => log(n, p))',
    ch: 3,
    expected: '$watch',
    hoverKey: '$watch',
  },
  {
    name: '$expose',
    line: '  $expose count, label',
    ch: 3,
    expected: '$expose',
    hoverKey: '$expose',
  },
  {
    name: '$shared',
    line: '  $shared user: User | null = null',
    ch: 3,
    expected: '$shared',
    hoverKey: '$shared',
  },
  {
    name: '$cookie',
    line: '  $cookie token: string = ""',
    ch: 3,
    expected: '$cookie',
    hoverKey: '$cookie',
  },
  {
    name: '$meta',
    line: '  $meta { title: "Page" }',
    ch: 3,
    expected: '$meta',
    hoverKey: '$meta',
  },
  // @template new
  {
    name: '$key',
    line: '  <li each={x of xs} key={x.id}>',
    ch: 23,
    expected: '$key',
    hoverKey: '$key',
  },
  { name: '$raw', line: '  <pre raw>raw</pre>', ch: 8, expected: '$raw', hoverKey: '$raw' },
  {
    name: '$once',
    line: '  <header once>title</header>',
    ch: 11,
    expected: '$once',
    hoverKey: '$once',
  },
  {
    name: '$memo',
    line: '  <Chart memo={[a, b]} />',
    ch: 11,
    expected: '$memo',
    hoverKey: '$memo',
  },
  {
    name: '<slot>',
    line: '  <slot name="header" />',
    ch: 4,
    expected: '<slot>',
    hoverKey: '<slot>',
  },
  {
    name: '<suspense>',
    line: '  <suspense fallback="Skeleton">',
    ch: 4,
    expected: '<suspense>',
    hoverKey: '<suspense>',
  },
  {
    name: '<shield>',
    line: '  <shield fallback="ErrorMessage">',
    ch: 4,
    expected: '<shield>',
    hoverKey: '<shield>',
  },
  {
    name: '<guard>',
    line: '  <guard scope="authenticated">',
    ch: 4,
    expected: '<guard>',
    hoverKey: '<guard>',
  },
  {
    name: '<warp>',
    line: '  <warp to="#modal-root">',
    ch: 4,
    expected: '<warp>',
    hoverKey: '<warp>',
  },
  // @style new
  {
    name: '$reactive',
    line: '  h1 { color: $reactive(err ? "red" : "black") }',
    ch: 16,
    expected: '$reactive',
    hoverKey: '$reactive',
  },
  {
    name: '$container',
    line: '  $container(sidebar, min-width: 300px) { rules }',
    ch: 3,
    expected: '$container',
    hoverKey: '$container',
  },
  {
    name: '$prefers',
    line: '  $prefers(reduced-motion) { .anim { transition: none } }',
    ch: 3,
    expected: '$prefers',
    hoverKey: '$prefers',
  },
  {
    name: '$global',
    line: '  $global { body { margin: 0 } }',
    ch: 3,
    expected: '$global',
    hoverKey: '$global',
  },
  {
    name: '$media',
    line: '  $media(min-width: 768px) { rules }',
    ch: 3,
    expected: '$media',
    hoverKey: '$media',
  },
  {
    name: '$when',
    line: '  $when(loading) { root { opacity: 0.5 } }',
    ch: 3,
    expected: '$when',
    hoverKey: '$when',
  },
  // @agent new
  {
    name: '$scope',
    line: '  $scope authenticated',
    ch: 3,
    expected: '$scope',
    hoverKey: '$scope',
  },
  {
    name: '$rate-limit',
    line: '  $rate-limit "100/min"',
    ch: 3,
    expected: '$rate-limit',
    hoverKey: '$rate-limit',
  },
  {
    name: '$describe',
    line: '  $describe save "Persist edits"',
    ch: 3,
    expected: '$describe',
    hoverKey: '$describe',
  },
]

describe('hover coverage — getMacroAtPosition resolves canonical fixtures', () => {
  it('probe list has one entry per hover key', () => {
    expect(PROBES).toHaveLength(HOVER_KEYS.length)
    const probeNames = new Set(PROBES.map((p) => p.name))
    for (const k of HOVER_KEYS) expect(probeNames.has(k)).toBe(true)
  })

  it.each(PROBES)('resolves $name from canonical fixture', (probe) => {
    const resolved = getMacroAtPosition(probe.line, probe.ch)
    expect(resolved).toBe(probe.expected)
    // The resolver's return value MUST route to a valid hover entry.
    expect(getHoverContent(resolved!)).toBeTruthy()
  })
})
