#!/usr/bin/env bun
/**
 * CI guard — grammar-v2 migration completeness (40-spec §8.4).
 *
 * The retired v1 template forms must return ZERO grep hits across the live
 * corpus: examples/ cookbook/ bench/ apps/ packages/ tests/. Declared-legacy
 * surfaces are excluded: the v1-rejections lane and the migration tooling's
 * input fixtures/tests exist to EXERCISE the old forms; CHANGELOGs and the
 * design-history docs are the archaeological record.
 *
 * Exit 0 = clean; 1 = a retired form is back in live code.
 */
import { spawnSync } from 'node:child_process'

const SCOPES = ['examples', 'cookbook', 'bench', 'apps', 'packages', 'tests']

/** Declared-legacy paths: allowed to contain old forms (they test them). */
const EXCLUDES = [
  'bench/compiler-conformance/v1-rejections/',
  'packages/cli/tests/migrate.test.ts',
  'packages/cli/src/commands/migrate.ts',
  // Guide prose documents the retired forms in its from-columns.
  'apps/docs/src/data/guide-migration.ts',
  'apps/docs/src/data/guide-routing-layouts.ts',
  // The playground's compiler WASM is a BUILD ARTIFACT. Retired spellings
  // inside it are diagnostic strings from the published compiler package.
  'apps/docs/public/wasm/',
  // AI-guidance files name the wrong forms explicitly (recognize-and-avoid).
  'AGENTS.md',
  // Hover-table keys are stable internal identifiers, not surface syntax.
  'packages/language-server/src/core/hover.ts',
  'packages/language-server/tests/hover-coverage.test.ts',
  'CHANGELOG.md',
  'node_modules',
  '/dist/', // build artifacts (rebuilt from migrated sources)
  '.map',
  '.golden.js', // regenerated artifacts — verified by conformance tests
]

/** The §6 grep set — every retired form. */
const PATTERNS: ReadonlyArray<[string, string]> = [
  ['C601 {#if}', String.raw`\{#if\s`],
  ['C602 {#each}', String.raw`\{#each\s`],
  ['C601/2 tails', String.raw`\{:else|\{:empty|\{/if\}|\{/each\}`],
  ['C603 {@html}', String.raw`\{@html`],
  ['C605 <$if>', String.raw`<\$if\b|<\$else\b`],
  ['C606 $if=', String.raw`\$if=`],
  ['C606 $each=', String.raw`\$each=`],
  ['C606 $let=', String.raw`\$let=`],
  ['C607 $on.*', String.raw`\$on\.`],
  ['C607 $bind.*', String.raw`\$bind\.`],
  ['C607 $class', String.raw`\$class[:=]`],
  ['C607 $key=', String.raw`\$key=`],
  ['C607 $html=', String.raw`\$html=`],
  ['C607 $show=', String.raw`\$show=`],
  ['C607 $ref=', String.raw`\$ref=`],
  ['C607 $once/$memo/$raw', String.raw`\$once\b|\$memo=|\$raw\b`],
  ['C607 generic $attr={', String.raw`\$[a-zA-Z][\w-]*=\{`],
  ['C608 <$link>', String.raw`<\$link\b`],
  [
    'C609 <$element>',
    String.raw`<\$slot\b|<\$suspense\b|<\$shield\b|<\$outlet\b|<\$router\b|<\$navigate\b|<\$guard\b|<\$warp\b`,
  ],
]

/**
 * The pre-#497 `@state` collection dialect ($prop:/$action:/$computed:/… bags)
 * is retired in the FLUENCY CORPUS — cookbook recipes, the generated MCP
 * index, and the playground presets teach agents idiomatic aihu, so they must
 * only carry the ratified wrapper dialect (state()/prop()/action()/…).
 * The compiler still accepts the old dialect elsewhere; these scopes are the
 * teaching surfaces, where the fossil index (21 pre-#497 entries served by
 * aihu_example until #P0) proved drift goes unnoticed without a guard.
 */
const CORPUS_SCOPES = ['cookbook', 'packages/mcp/src/cookbook-index.json', 'apps/docs/playground']

const CORPUS_STATE_PATTERNS: ReadonlyArray<[string, string]> = [
  [
    'retired @state collections',
    String.raw`\$(prop|computed|action|resource|effect|lifecycle|aria|form|context|controller|event|stream|extract)\s*:`,
  ],
]

let failed = false
for (const [label, pattern] of PATTERNS) {
  const res = spawnSync('grep', ['-rlE', pattern, ...SCOPES], { encoding: 'utf8' })
  const out = res.stdout ?? ''
  const hits = out
    .split('\n')
    .filter(Boolean)
    .filter((f) => !EXCLUDES.some((e) => f.includes(e)))
  if (hits.length > 0) {
    failed = true
    console.error(`✗ ${label} — retired form found in live code:`)
    for (const h of hits) console.error(`    ${h}`)
  }
}

for (const [label, pattern] of CORPUS_STATE_PATTERNS) {
  const res = spawnSync('grep', ['-rlE', pattern, ...CORPUS_SCOPES], { encoding: 'utf8' })
  const out = res.stdout ?? ''
  const hits = out
    .split('\n')
    .filter(Boolean)
    .filter((f) => !EXCLUDES.some((e) => f.includes(e)))
  if (hits.length > 0) {
    failed = true
    console.error(`✗ ${label} — pre-#497 collection dialect found in the fluency corpus:`)
    for (const h of hits) console.error(`    ${h}`)
  }
}

if (failed) {
  console.error(
    '\ncheck:grammar-v2 — retired v1 template forms found. ' +
      'Run `npx aihu migrate --v2 <file>` or rewrite per the C60x fix hints.',
  )
  process.exit(1)
}
console.log('check:grammar-v2 — corpus clean: zero retired-form grep hits (40-spec §8.4).')
