# aihu — cross-track topology and task list

**Purpose.** One place any agent in the swarm can read to learn what the project
is trying to do, what is in flight, who owns what, and what is blocked on a
human ruling. Written to survive context compaction: assume the reader has no
memory of the session that produced it.

**Last reconciled:** 2026-07-26, against `origin/main` @ `9286182f`.

**Where this lives.** `docs/TOPOLOGY.md`, committed. The repo's `state-<track>.md`
convention is gitignored — fine for one agent's scratch state, useless for a
shared record, because a file that is not committed cannot survive a cleared
context or reach another agent's checkout.

**How to use it.** Update the track you own; do not rewrite another track's
section. If you change ownership or claim an item, say so in Slack `#aihu`
(`C0BKR276YES`) as well — this file is the durable record, the channel is the
live one. When you finish something, move it to *Done* with its PR number
rather than deleting it; the trail is what lets the next agent avoid redoing it.

> **Verify before trusting.** Every claim below was true at the timestamp above.
> Tracker state in particular goes stale — see §6, where five Linear issues are
> recorded as Backlog while their fix is already merged. Check `git log` and the
> PR list before acting on any line here.

---

## 1. What the project is

A JavaScript/TypeScript meta-framework for Web Components with runtime-first
reactivity. `.aihu` SFCs compile (Rust) to vanilla custom elements, mounted with
sub-2 kB reactive primitives.

The governing thesis is the **dual experience**: one declaration serves a human
UI *and* an agent-callable surface, derived from the same source so they cannot
drift. Everything below is in service of that, or of being able to prove it.

**Standing constraints**

- Per-package size gates in `.size-limit.json` are the contract. Server-side and
  build-time-only packages must not add a row.
- Output is vanilla custom elements — no framework lock-in at the consumer
  boundary, no global context, no hydration step.
- llms.txt + MCP support is part of the contract, not optional.
- The Rust SFC compiler is the v0 → v1 gate.

---

## 2. Ownership map (blast radius)

Claim before you touch. Two agents in one file is how today produced a
three-revision merge-order argument.

| Area | Owner | Notes |
| --- | --- | --- |
| `packages/app/**` config surface, `load-config.ts` | docs-next | #609 |
| `packages/cli/src/index.ts` — `appViteConfig` / `appTsConfig` / page prose | docs-next | |
| `packages/cli/src/index.ts` — template deps, css/ui additions | team-lead | |
| `packages/cli/src/templates-agent.ts` | team-lead | via #601 |
| `.github/workflows/scaffold-matrix.yml`, `scaffold-matrix-e2e.ts` | team-lead | |
| `apps/docs-next/**`, `deploy-docs-next.yml` | docs-next | |
| `packages/css-engine/**`, `@aihu/ui`, daisyUI work | team-lead | |
| `bench/**`, `RESULTS.md` | perf track | regeneration STOPPED — §5 |
| `aihu-project/aihu-compiler` | standalone compiler owner | Publishes `@aihu/compiler` and compiler platform/WASM artifacts; root keeps consumer and release integration checks. |
| `.github/workflows/plan-a.yml` | shared — announce first | |

Primary checkout `/Users/smcguirt/conductor/repos/aihu` is currently on
`feat/config-in-vite-config` (docs-next). Post in channel before moving it.

---

## 3. Tracks

### T1 — Config surface: Vite config as the single home
**Owner:** docs-next · **Status:** in flight (#609) · **Linear:** FEL-424

**Goal.** One place to configure an aihu project, readable by everything that
needs it, growing as packages land without a central registry to maintain.

**Where it stands.** Config lives inline on `viteAihuPlugin({...})` in
`vite.config.ts`. There is deliberately no second config file: a separate
`aihu.config.ts` is justified only while something other than Vite needs the
config and cannot parse the Vite config — SvelteKit's 2022 reason for
`svelte.config.js`, which they removed once their language server could read
`vite.config.js` (language-tools#3031). SvelteKit 3 makes the Vite config the
required location. We built the same capability instead of the same workaround.

Landed on the branch:
- `aihu:config` marker plugin carrying the evaluated config on a public `api`
  handle (Qwik's pattern).
- `loadAihuConfig(root)` reads it back via Vite's own `loadConfigFromFile` — no
  build. Returns config, source path, Vite's dependency list, and every
  registered module's options.
- `declareAihuModule()` / `collectAihuModules()` — the contract by which a
  package becomes readable by the CLI and language server with **no change to
  `@aihu/app` or any consumer**. Deliberately not Nuxt's generated types: Nuxt
  registers modules by string, which erases the type, so it must regenerate it.
  We register by factory call, so options type from the function signature.
- `viteAihuPlugin()` now validates its inline argument. Only `defineConfig` did
  before, so the path every example uses was unvalidated. Unknown keys throw
  with a keypath and a did-you-mean.
- Options that previously required abandoning `viteAihuPlugin`: `dir.components`,
  `compiler.islands` (was hardcoded `false` with a comment telling readers to
  bypass the config), `compiler.target`, `build.bundler`, `dev.*`, `typecheck.*`.

**Next actions**
1. `aihu add` / `registry-resolve.ts` → shared loader (third private loader).
2. `packages/language-server` + `packages/vscode-aihu` → `loadAihuConfig()`.
3. Roll `declareAihuModule` across the 9 packages with real project-wide config:
   compiler, router, css-engine, ui, auth, agent-readiness, both adapters, store.
   `@aihu/auth` is the biggest win — its config is repeated at three call sites.
4. Deprecate `@aihu/server`'s `AihuConfig`. **Seven fields, none read by its own
   package.** Its `plugins` types against a contract whose dispatcher is a
   documented no-op. Two same-named interfaces is the root confusion.
5. Retire the `aihu.config.ts` fallback in `loadProjectConfig` once nothing
   depends on it. It is transitional, not permanent.

**Known gaps**
- `router.viewTransitions` and `ui.style` are declared and read by nothing. They
  now warn when set rather than lying silently. Wire or remove.
- `css.shadowMode` is project-wide, so `--shadow light` flips leaves too, contra
  DA4. The shape that fixes it is `{ pages, layouts, leaves }`, needing compiler
  vocabulary that does not exist. **Design the surface capable of it now**;
  retrofitting after it hardens is the expensive path.

---

### T2 — CSS / UI: daisyUI Option 4
**Owner:** team-lead · **Status:** in flight

**Goal.** A themeable design system that reaches component internals, so
recipes and primitives are visible at first impression instead of invisible.

- #604 landed slice 1: named-theme dimension + dual-keyed dark selector.
- #608 landed semantic state colours + the contrast tool.
- Shane's rulings: **E1** deconflict info/success/warning hues freely —
  template changes are expected; **E2** add `--color-neutral`. Both go through
  a tastemaker pass against `.tastemaker/style-lock.md` before landing.
- The Option 4 design pass — required by the ratified plan before implementation
  — had **never been written**; four `docs(plans):` commits, zero
  implementation. An architect is producing it now.
- `full` ships no `@aihu/css-engine`, `@aihu/ui`, or `@aihu/primitives`. Every
  recipe we ship is invisible at first impression. Template design work
  sequences behind the Option 4 doc.

---

### T3 — CLI / scaffold / templates
**Owner:** team-lead (deps, templates-agent) + docs-next (config, prose)

**Goal.** `npm create aihu` produces a current, safe, honest project on every
package manager — and the templates demonstrate the thesis rather than assert it.

**Recently landed:** #596 cf-team dep pins · #600 `--template` across both tiers
· #601 agent-template readiness surface · #603 `import.meta.resolve` (pnpm/yarn
were broken on **every** template) · #606 stop fabricating `shadowMode` ·
#612 agent tooling + honest build-target claims · #593 the DX matrix.

**Template taxonomy (Shane's definitions, not yet fully implemented)**

| template | intent |
| --- | --- |
| `minimal` | current, safe package profile wired to basic settings |
| `full` | kitchen sink of the ecosystem, cleanly composed config |
| `docs` | static, clean-cut, reactive islands for runnable examples |
| `agent` | **fold into `full`** — too narrow standalone; reuse #601's `server.ts`/`mcp.ts`/`readiness.ts` |

Neither of us restructures `packages/cli/src/index.ts` further until the shape
is agreed.

**Open:** #613 fixes the `agent` TS7006 regression (#595 fixed it, #601
reintroduced it at `templates-agent.ts:570`) and switches matrix PR runs to
`--mode local`.

---

### T4 — Agent readiness / compliance by construction
**Owner:** docs-next · **Linear:** FEL-423 · **Plan:** `docs/plans/2026-07-26-agent-readiness-external-parity.md`

**Goal.** Compiled output is compliant with the standards the project's config
declares, by construction, with safe defaults — a property of the *framework's
output for user projects*, not of our docs site.

**Two gaps.**

- **Gap A — no external oracle.** Every test in `tests/compliance/` imports our
  own generator and asserts against hand-transcribed rules. Proposed: L1 schema
  validation (`ajv`; MCP first, since `@modelcontextprotocol/sdk` is already a
  dependency), L2 parse-back with reference parsers (`google/robotstxt`,
  `llms_txt`), L3 live probe. Only L3 could have caught the SPA-fallback defect.
- **Gap B — the default emits nothing useful.** Fixed in part: the scaffold no
  longer publishes an MCP card it cannot serve, and no longer points `endpoint`
  at the card's own URL.

**BLOCKED on a product ruling from Shane.** `llms.txt` is still ~60 bytes with
no `## Components`, despite templates declaring three `$action` entries.
`elide_agent` (`packages/compiler/src/codegen/emit.rs:206`) strips
`registerAgentMetadata(...)` from **client-target builds entirely**. That is a
deliberate v0.6.6 decision, so changing it is a product change.

The question: **what should a static aihu build claim about itself?** The
components exist and are drivable in-page (`__agentDispatcher` *is* emitted);
what does not exist is an HTTP endpoint. Recommended posture — describe the
surface that exists, stop claiming the one that does not.

⚠️ **Do not verify this with `scaffold-default-e2e`.** It installs *published*
`@aihu/*`, so it builds with the published compiler and cannot see an unlanded
compiler change. Noted in the test itself.

---

### T5 — `use` composables + primitives (the wave work)
**Owner:** unassigned · **Linear:** FEL-357…FEL-394 (~38 issues)

**Goal.** A composable library covering the VueUse surface area, adapted to
aihu's composed-tree and governance model.

Wave 1a landed (#550): Time, User-preferences, Sensors/Observers, Tier-1.

**Three OPEN blockers gate large parts of the tree — these are rulings, not code:**
- **E1** (FEL-391) deep/structural reactivity ruling
- **E2** (FEL-392) the `@aihu/runtime` exception
- **E3** (FEL-393) `tryOnMounted` real lifecycle hook

FEL-377 (component lifecycle family) is mostly blocked on E2/E3; FEL-413 needs a
ruling on `useFetch`/`useCurrentElement` having no path through `LifecycleHost`.
FEL-364 is the policy question of adapting daisyUI behaviours into composables —
**couples T5 to T2**; sequence after the Option 4 doc.

Tooling debt: FEL-405 (`gen:use` drops the first name in a batch), FEL-390 and
FEL-402 (dep-check subpath purity evaded by computed dynamic imports).

---

### T6 — Compiler correctness
**Owner:** unassigned · **Status:** several in progress

- FEL-395 keyed `each()` stale rows — **in progress**
- FEL-396 DOM move destroys component state — **in progress** (both touched by #546)
- FEL-410 `@style $reactive()` emits effects above state declarations (TDZ)
- FEL-416 keyed-row freshness forces full row re-grow on derived lists
- #478 `<$slot>` fallback children discarded — content loss, all shadow modes
- #477 SSR/hydration: light-DOM slot projection not applied on hydrate
- #465 GX Phase 0 residual: SSR of compiled routes must render — gates the hard tier

**Trap, twice-burned:** aihu compiles via the **published napi addon** unless
`AIHU_COMPILE_BIN` is set. A Rust fix is invisible to its own CI without it.

---

### T7 — Performance truth
**Owner:** perf track · **Linear:** FEL-409 (in progress), FEL-404, FEL-417, FEL-421

**Goal.** Publish only numbers that measure something real.

- #607 resolved the 26x/8.8x discrepancy: **both were arithmetically correct and
  neither was a measurement** — same fabricated denominator, numerators from
  different machines (751 ns CI ubuntu vs 241 ns M5; the gap is the 3.11x
  hardware difference).
- The harness **could not measure `dist` at all**: `packages/arbor/tsconfig.json`
  paths rehijacked arbor-dist's signals import back to `src`, giving two module
  instances. The dead-binding fabrication reproduced **twice** and only a
  liveness probe caught it.
- Real number through shipped `dist`: **~185 ns, ~1.10x the true vanilla floor**
  (cached text node, 168 ns). The committed `vanilla` adapter — whose README
  calls itself "the theoretical minimum" — is **9.2x off that floor**.
- #610 landed a mandatory R0 dom-liveness gate + R8 counted-metric rows.
- **STOP on regenerating `RESULTS.md`** stands until the harness measures
  shipped artifacts.
- **Publishable set: counted metrics only** — 4-vs-1994 moves, 1 write/op, size
  rows. *A dead binding sends a count to zero, which screams; it sends a timing
  down, which flatters.*
- Both historical "successful" js-framework-benchmark runs benchmarked an
  **empty framework list** — all 0.00 ms, still green (FEL-417).

---

### T8 — CI / release health
**Owner:** shared · **Linear:** FEL-399, FEL-411, FEL-419, FEL-420

- **FEL-419** `bun run test --coverage` hangs silently. Hit again on #609:
  `loadAihuConfig` runs Vite's config bundler and the suite could not exit, so
  the job hit its 25-minute ceiling **with no failing assertion**. Mitigated by
  gating those tests behind `AIHU_CONFIG_LOADER_E2E` with a dedicated step.
  The underlying hang is unfixed.
- **FEL-411 / FEL-399** `typecheck` has no build-ordering guarantee. Bit twice
  today: a stale `packages/app/dist` made the CLI typecheck green locally and
  red in CI.
- **FEL-420** `@aihu/plugin` is 0.1.1 on npm, 0.1.0 in the repo — a published
  version with no source.
- `scaffold-matrix` merged red and **has never passed on any branch**, including
  its own. #613 switches PR runs to `--mode local` and skips cells that cannot
  run. Until then it is a red X that gates nothing.
- Known blind spots: `ci-ok` gates one job; the binary-bump guard misses
  `npm-native/`; `bench` produces both false positives and negatives.

---

## 4. Open questions needing a human ruling

| # | Question | Blocks |
| --- | --- | --- |
| Q1 | What should a **static** aihu build claim about itself? (FEL-423 remainder — reversing `elide_agent` for client targets is a product change) | T4 |
| Q2 | **E1** deep/structural reactivity ruling | large parts of T5 |
| Q3 | **E2** the `@aihu/runtime` exception | FEL-377, FEL-413 |
| Q4 | **E3** `tryOnMounted` real lifecycle hook | FEL-377, FEL-413 |
| Q5 | Does `full` become a **two-process** app to demonstrate the dual experience? | T3, T4 |
| Q6 | Retire the standalone `agent` template once folded into `full`? | T3 |

---

## 5. Cross-cutting failure modes found on 2026-07-26

Named because each recurred across unrelated subsystems in a single day. Treat
these as review checklists, not anecdotes.

**M1 — An absent value rendered as a real one.** Five instances: `llms.txt` at
84 bytes with zero tools; nine docs endpoints returning the SPA fallback at HTTP
200; `_no dist_` in a README; the `28.63 ns` bench row measuring a dead binding;
`endpoint` pointing at the card's own URL. *An `existsSync`/status-code check
passes on every one of them.* Assert on content.

**M2 — The thing being checked is not the thing that changed.** Three instances:
the bench harness measuring `src` instead of `dist`; `scaffold-default-e2e`
installing published packages; `scaffold-matrix` running `--mode npm` against a
published CLI on PRs. Ask what artifact the check actually loaded.

**M3 — A test that certifies the defect.** `vite-plugin.test.ts:67` asserts the
Components section is omitted when the registry is empty — passing in production
for the wrong reason. When you find a gap, **do not assert its absence**; that
goes green forever. Document it and leave the positive assertion for the fix.

**M4 — Local and CI disagree about what exists on disk.** Three instances today,
all build output: the golden fixture regenerated before a later edit; the CLI
typecheck resolving a stale `dist`; a test fixture importing an unbuilt package.
Delete the build output and re-run before trusting a green local check.

**M5 — A structure that outlived its constraint.** `svelte.config.js` existed
only because the language server could not parse the Vite config. The R-CT-06
freeze pinned the default scaffold to a v0.2.0 artifact that never worked. Ask
what made a structure necessary and whether that is still true.

---

## 6. Tracker reconciliation needed

Linear is stale. These are Backlog with the fix already merged:

| Issue | Reality |
| --- | --- |
| FEL-422 | Fixed by #597 |
| FEL-425 | Fixed by #606 |
| FEL-424 | **Superseded** — #609 puts config in `vite.config.ts`; there is no `aihu.config.ts` to emit. Close with a pointer, do not "fix". |
| FEL-423 | Partly fixed (#609: no bogus card, no self-referential endpoint). The compiler half is open and blocked on Q1. |
| FEL-419 | Still open and correct — mitigated on #609, not fixed. |

Also: `apps/docs/aihu.config.ts` is imported by nothing; `packages/language-server/src/core/hover.ts:462` references an `aihu.config.ts` `style.tokens` key that has never existed; `packages/_moved` holds dead re-export tombstones.

---

## 7. Done today (trail, so nobody redoes it)

`#546` keyed-list + DOM-move · `#550` Wave 1a composables · `#593` DX matrix ·
`#596` cf-team pins · `#597` npx docs fix (FEL-422) · `#598` compliance plan ·
`#599` missing changesets · `#600` `--template` both tiers · `#601` agent
readiness surface · `#603` `import.meta.resolve` · `#604` named themes ·
`#606` shadowMode fabrication (FEL-425) · `#607` arbor perf truth ·
`#608` semantic state colours · `#610` R0 liveness gate · `#612` agent tooling
