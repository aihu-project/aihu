# @aihu/cli

## 1.3.1

### Patch Changes

- [#818](https://github.com/aihu-project/aihu/pull/818) [`b9c6afd`](https://github.com/aihu-project/aihu/commit/b9c6afda840b3e3426d2023ee603b92c3bfe1993) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Bundle migration codemods from the public `@aihu/compiler` entry points instead of importing compiler source from the monorepo.

- [#821](https://github.com/aihu-project/aihu/pull/821) [`95bf123`](https://github.com/aihu-project/aihu/commit/95bf1232ce3df85a5b4b373b79d760aba098d46b) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Expose the UI registry catalog types from `@aihu/ui/registry` and make the CLI
  consume that public contract instead of importing the UI package's source tree.
- Updated dependencies [[`50c87cb`](https://github.com/aihu-project/aihu/commit/50c87cb904f518d5ee69fba77940095964c73492)]:
  - @aihu/mcp@0.2.1

## 1.3.0

### Minor Changes

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Give `aihu` a real command surface: `--help`, `--version`, and errors you can tell apart.

  `usage()` wrote the same block to **stderr** and exited **1** for all four of
  `--help`, `--version`, an unknown command, and no arguments at all. Every one of
  those produced byte-identical output on the same stream with the same exit code,
  so nothing — a person, a shell script, a CI job — could tell a typo from a
  request for help, and `aihu --help | less` showed an empty screen. There was no
  `--version` at all.

  Now:

  - `--help` / `-h` (and bare `aihu`) print usage to **stdout** and exit **0**,
    matching `create-aihu`'s existing convention.
  - `--version` / `-v` print the CLI's own version and exit **0**. The version is
    read from this package's `package.json` at build time, so it cannot disagree
    with the package it shipped in.
  - An unknown command says `unknown command '<x>'` on stderr and exits 1.
  - A missing positional says what is missing (`aihu app needs a project name`)
    instead of reprinting the whole usage block.

  Two accuracy fixes came with it. The help text now lists every flag the
  dispatcher actually reads: `--style` (a real `aihu add` flag), `aihu migrate
--state`, and the seven `aihu app` flags (`--pm`, `--no-git`, `--no-install`,
  `--options-json`, `--no-auto-install-template`) that previously existed only in a
  code comment and appeared in no user-facing help. And `aihu app`'s positional is
  now parsed with the same `firstPositional` helper `create-aihu` uses — reading
  `rest[0]` meant `aihu app --pm pnpm` scaffolded a complete project into a
  directory literally named `--pm` and exited 0.

  The legacy `aihu app` path's own output is brought in line with the other two
  scaffold paths. It stopped at `Done. N file(s) created.` with no cd/install/dev
  guidance, while both `dispatchTemplate` and `create-aihu` end with
  `printNextSteps()`; it now calls the same function, so the three cannot drift
  into three different sets of instructions. Its `created` lines are prefixed with
  the project directory too — `created  package.json` named a file that is not at
  `./package.json`. `page`/`component` are deliberately left unprefixed: they write
  into the _current_ project, so their paths were already correct.

  `--use-defaults` and `--no-interactive` are **removed**. They parsed into
  variables that were immediately `void`-discarded under a "Reserved for B2+
  wiring" comment, so a scripted `aihu app x --use-defaults` looked supported and
  did nothing. `aihu app` issues no prompts, so their documented behaviour ("use
  manifest defaults for unspecified overridable cells") is what `mergeOptions()`
  does unconditionally — they could not have changed the output even wired up.

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Export `@aihu/cli/template-manifest`, and declare the Node floor both bins require.

  `@aihu/templates-cf-team` imports `import type { TemplateManifest } from
'@aihu/cli/template-manifest'` — the documented contract between the CLI and
  every template package (arch-6 §2.3) — but `@aihu/cli`'s `exports` map had no
  such subpath. It only worked because cf-team's `tsconfig.json` hand-maps the
  specifier to the CLI's source file for local typechecking; a real npm consumer
  typechecking the published template package hit `ERR_PACKAGE_PATH_NOT_EXPORTED`.
  Compounding it, cf-team declared `"dependencies": {}` / `"devDependencies": {}`,
  so `@aihu/cli` was not a declared dependency at all.

  The subpath is now a real export backed by its own build entry
  (`dist/template-manifest.{js,d.ts}`), and cf-team declares `@aihu/cli` as a
  devDependency. The tsconfig `paths` mapping stays so in-repo `moon run :typecheck`
  does not require the CLI to be built first.

  Both `@aihu/cli` and `create-aihu` now declare `"engines": { "node": ">=20.6.0" }`.
  `scaffold-pipeline.ts` calls `import.meta.resolve` synchronously and
  `create-aihu/bin.mjs` calls it unconditionally — both Node 20.6+ only — and
  neither package said so, unlike `@aihu/agent-server`, `@aihu/language-server` and
  `@aihu/server`, which all carry an `engines` field.

  Also removes three dead modules — `src/commands/{page,component,plugin}.ts` —
  drifted duplicates of the live `scaffoldPage`/`scaffoldComponent`/`scaffoldPlugin`
  in `src/index.ts` that `bin.ts` actually imports. Nothing referenced them; they
  had different signatures and different output, so the risk was a future edit
  landing in the copy that never runs.

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Enforce a template's declared `cliRange` / `contractVersion` instead of parsing and ignoring them.

  `validateManifest()` read both fields off every `template.config.ts` and then
  compared them against nothing at all. Because nothing could be wrong, the
  declaration drifted: `@aihu/templates-cf-team` shipped `cliRange: '^0.2.0'`
  against a CLI at 1.2.x, so the only publishable template asserted an
  incompatibility with every CLI able to install it, for six minors, silently.

  `scaffoldFromTemplatePackage` — the single driver both `aihu app --template` and
  `create-aihu` run — now calls `assertTemplateCompatibility()` before any file is
  written or any package installed, and fails in the same loud style as the
  existing `unpublished`/`unknown` template cases: it names the template, both
  versions, and what to do about it. An **unreadable** range fails too; the point
  of enforcing the field is that an unenforceable declaration must not pass.

  The range check is a small hand-rolled module (`semver-range.ts`) rather than a
  new dependency: `@aihu/cli` carries exactly one runtime dependency, no package in
  this repo depends on `semver`, and this is one comparison. It implements the npm
  grammar a manifest realistically writes — caret (including the 0.x rules), tilde,
  comparators, partial/wildcard forms, `||` and space composition — plus the
  prerelease rule that stops `^1.0.0` from matching `2.0.0-beta.1`. A prerelease
  CLI is checked as its release core, so a canary build does not fail every
  template.

  `cf-team`'s range is corrected to `^1.0.0` — the CLI line that actually ships
  `scaffoldFromTemplatePackage` (added in 1.0.1), with a real upper bound so a 2.0
  CLI stops rather than half-scaffolding.

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Widen every template's `vite` pin from `^6.0.0` to `^6 || ^8`.

  Vite 8 was genuinely unsafe until the OXC strip fix that shipped alongside this:
  vite 8 made esbuild an **optional peer** while still _exporting_
  `transformWithEsbuild`, the compiler's strip chain tested only that the function
  existed, and a **fresh** `^8` install (which has no esbuild at all) therefore
  threw inside the strip and — through a swallowing `catch` — handed rolldown
  un-stripped TypeScript. Every output mode runs a client build, so `spa`,
  `static` and `ssr` all failed. That is fixed at the source rather than pinned
  around: `transformWithOxc` is used whenever present, and a failed strip is now
  fatal instead of silent. Vite 6 cannot regress — it does not export
  `transformWithOxc` at all, so it keeps taking the esbuild branch.

  Measured before widening, four **fresh** installs (no lockfile, no
  `node_modules` — the defect is invisible on an incremental `bun add vite@8`,
  where esbuild survives from the previous resolution), each driven past `build`:

  | template  | vite 6                                                | vite 8 |
  | --------- | ----------------------------------------------------- | ------ |
  | `minimal` | scaffold/install/typecheck/build/dev/preview all pass | same   |
  | `ssr`     | + the built `_worker.js` imports and answers 200      | same   |

  Vite 7 is deliberately **not** in the range. No cell of the scaffold matrix has
  ever installed it, so listing it would be a compatibility claim with nothing
  behind it. `^6 || ^8` names exactly the two majors `ci-ok`'s
  `scaffold-consistency` job builds on every PR.

  The range now lives in one place — `EXTERNAL_RANGES` in
  `scripts/sync-template-versions.ts` — rather than in the four manifests that
  each carried their own copy.

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Add a real `ssr` template — `npm create aihu -- --template ssr` scaffolds a
  Cloudflare Worker that server-renders.

  `output: 'ssr'` was reachable from **no** scaffold. The only consumer-shaped
  tree that exercised it was a post-scaffold patch inside the DX-matrix harness:
  scaffold `minimal`, then rewrite its `vite.config.ts` and inject
  `@aihu/adapter-cloudflare` before install. That was the right stopgap while the
  SSR build was being fixed — the gate needed a consumer tree, and designing the
  scaffold as a side effect of building a CI gate was the wrong order — but a
  harness patch is not a product surface. No user could ask for it, and nothing
  about it was typed or reviewable as a template.

  The template bakes in the three options `output: 'ssr'` actually requires, each
  commented in place because each fails differently:

  - `output: 'ssr'` — without it there is no server build and no `_worker.js`.
  - `css: { shadowMode: 'light' }` — **required**, not a style preference: a
    shadow leaf exports no `__aihu_shadow__`, so every nested component renders
    empty server-side. The build refuses rather than shipping blank children.
  - `adapter: cloudflare({ name })` — what makes the SSR bundle a Worker
    (`export default { fetch }` + the ASSETS fallthrough) instead of a bare node
    bundle. It also writes `wrangler.toml` on the first build (never overwriting
    one), so the next step is literally `npx wrangler deploy`.

  It ships **no `preview` script** and **no `wrangler` dependency**, both
  deliberate. `vite preview` serves the client `dist/` as static files, so under
  `output: 'ssr'` it answers 200 on a page the Worker never rendered — the wrong
  artifact reported as success; `npx wrangler dev` runs the real one, and the
  emitted README and AGENTS.md say so. `wrangler` stays out of `devDependencies`
  because `npx` runs it without adding ~100MB and a second native-binary delivery
  mechanism to every scaffold.

  Verified end to end, not asserted: scaffolded through `create-aihu`, installed
  fresh on bun against `npm pack` tarballs of this checkout, typechecked, built,
  and then the built `dist-server/_worker.js` **imported and called** with a
  stubbed `ASSETS` binding — 200 `text/html`, 2.4 kB, outlet rendered — on vite 6
  and vite 8. The import is bounded by a timeout, because the SSR defect this
  covers was a deadlock: a Worker that built green and could not be loaded at all.

  The harness's `minimal-ssr` pseudo-template, its `ssr-config` step and its
  config patcher are deleted; the row is now `{ id: 'ssr', kind: 'create' }`,
  exactly as that code's own docblock promised.

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Stop scaffolding `"latest"` — generate the dependency ranges at release time,
  and gate them.

  Every `@aihu/*` entry a scaffold emitted was the literal string `"latest"`, in
  four separate places (`appPackageJson`, `agentPackageJson`, the plugin scaffold,
  and cf-team's `apps/web/package.json.tmpl`). That is not a version, it is a
  promise to resolve later, and for a scaffolding tool it is three problems at
  once:

  - **Not reproducible.** A project scaffolded today and one scaffolded in six
    months have a byte-identical `package.json` and install two different
    dependency graphs. Neither manifest records which one it was.
  - **Not auditable.** `"latest"` is compatible with every future major, so a
    breaking `@aihu/runtime` publish reaches every existing scaffold on its
    owner's next `install` rather than on an upgrade they chose.
  - **Not reviewable.** No sync mechanism existed, so nothing could be wrong and
    nothing could be checked. Two hand-typed ranges were already dead on arrival
    and nobody had noticed: cf-team's `appPeerDeps` still said `^0.2.0` while
    `@aihu/runtime` was on 6.0.0, and the plugin scaffold's peer said `^0.8.0`
    while `@aihu/plugin` was on 0.1.0. Neither range resolves to anything.

  `scripts/sync-template-versions.ts` now derives one caret range per non-private
  workspace package from that package's own `package.json` and writes
  `packages/cli/src/dep-versions.ts` plus the three cf-team targets. There is no
  curated list to drift out of date: add a package and it appears; bump one and
  its range moves. It runs inside `release:version`, immediately after `changeset
version` sets the versions that release is about to publish — so the ranges a
  published `create-aihu` carries name versions that same release put on npm.

  `check:template-versions` (a new always-on `ci-ok` job) fails when any target
  disagrees with the workspace it was generated from, so a hand edit, or a version
  bump without the regen, cannot ship. Its red path is proven by a negative
  fixture in `check-gate-wiring`, red and green differing in exactly one version
  string.

  A caret rather than an exact pin, deliberately: a scaffold is a starting point,
  and `^6.0.0` lets a new project take `6.0.1` without editing a manifest while
  still refusing `7.0.0`. Prereleases are pinned exactly — `^1.0.0-rc.1` excludes
  `rc.2` but includes `1.0.0`, which is not what anyone means by it.

### Patch Changes

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - `create-aihu --options-json` was accepted and silently ignored.

  The flag was listed in `create.ts`'s `VALUE_FLAGS` — so its value was correctly
  skipped when parsing the project name — and then read by nobody: the
  `package`-kind scaffold call passed no `userOverrides`. So

  ```
  create-aihu app --template cf-team --options-json '{"auth":"supabase"}'
  ```

  scaffolded better-auth and exited 0. It was also absent from `create.ts`'s own
  `usageText()`.

  `bin.ts` had threaded the same flag, with real validation, the whole time, and
  `create-aihu` is the ONLY entry point npm users can reach (`npx @aihu/cli app`
  cannot work — npx infers the bin from the package name; see create.ts's own
  docblock). Nothing in the code, comments or tests suggested the omission was
  deliberate. So the flag is threaded through rather than dropped, reusing
  `bin.ts`'s parser — now extracted to `options-json.ts` so there is one
  implementation instead of two — and documented in `--help`.

  Overrides drive everything downstream of `mergeOptions`, so this also fixes
  conditional file selection and the F-3b conditional peer deps: with
  `{"auth":"supabase"}` the scaffold now emits `src/auth/supabase.ts` alone and
  adds `@supabase/supabase-js` rather than `better-auth`.

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - `create-aihu --version` printed no version and created a directory instead.

  ```
  $ node dist/create.js --version </dev/null
    ✓ Done!
    Next steps:
      cd my-aihu-app
  $ echo $?
  0
  ```

  `create.ts`'s argv handling special-cased `--help`/`-h` and nothing else, so
  `--version` fell through to the positional/non-interactive path, took the
  documented defaults, and scaffolded `my-aihu-app/`. A companion commit had added
  real `--version` support to `bin.ts` and never to `create.ts`.

  That is the worse of the two places to miss it. `create-aihu` is the only bin in
  this package npm users can actually reach — `npx @aihu/cli app my-app` cannot
  work, because npx infers the bin from the package name, as `create.ts`'s own
  docblock explains. So the advertised flag was unreachable exactly where it is
  advertised, and its invocation had a filesystem side effect rather than being
  the no-op an informational flag is supposed to be. Non-TTY stdin (any script,
  any CI job) is where this bites: with no prompt to stop at, nothing interrupts
  the fall-through.

  It now prints the version and exits 0, from the same build-time literal
  `bin.ts` uses, so the two bins in one package cannot report different versions
  of themselves. `--version` is also listed in `create-aihu --help`, which it
  was not.

  `aihu --version` had the mirror-image gap: it was tested against `argv[2]`
  alone while `--help` was recognised anywhere in argv, so `aihu app foo
--version` scaffolded a project — two flags documented side by side under
  "Global:", only one of which was. Both are now global.

  Also unified the two error dialects in `bin.ts`'s dispatcher: `aihu mcp` and
  `aihu migrate` with no arguments printed a bare usage block with no `ERROR:`
  marker and no pointer to `--help`, while every other malformed invocation in the
  same function routed through `failUsage`. They now use `failUsage` too, and
  `aihu mcp <typo>` names the subcommand it did not recognise.

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix two live bugs on the CLI surface found in a pre-release audit.

  `aihu app <name> --template <bad-value>` (and `--template` with no value)
  silently scaffolded a `minimal` app and exited 0. `create-aihu` already fixed
  this exact failure mode for its own entry point — its own docblock names it
  "the worst of the available failure modes... the run 'succeeds' and the user
  finds out much later" — but the legacy `aihu app` dispatcher in `bin.ts` never
  adopted the fix. Both cases now fail loudly with the template catalog and
  exit 1, matching `create-aihu`'s existing behavior.

  `aihu page '../../../../../ESCAPED'` wrote a file outside the project tree
  (`src/pages/../../../../../ESCAPED.aihu` resolves via `join()` like any other
  path) and exited 0. `scaffoldPage` split the route into segments but never
  rejected `.`/`..`, unlike the sibling `scaffoldComponent`, which already
  validates its input. Now throws before writing.

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Reject an unusable `--pm` instead of silently scaffolding a bun project.

  `aihu app x --pm garbage` and a bare trailing `--pm` both resolved to `'bun'`
  and said nothing:

  ```
  $ node dist/bin.js app demo --pm garbage && grep packageManager demo/package.json
    "packageManager": "bun@1.3.8"
  ```

  This is the exact failure `resolvePmFlag`'s own docblock was written about, one
  level up: the emitted `packageManager` field is enforced by corepack, so
  `pnpm install` — the command the CLI prints as the next step — refuses to run
  before resolving a single dependency (`ERROR: This project is configured to use
bun`). The previous release fixed `--pm` for _valid_ values and left every
  invalid one falling into the same trap, with no indication the flag had been
  discarded.

  `create-aihu` had the same hole with a different default: unknown values
  returned `undefined`, which meant "the user did not choose", so the _detected_
  package manager got pinned instead.

  Both now fail loudly and exit 1, naming the valid set — the same triage
  `--template` already got in the cleanup that wrote the docblock. `--pm` was the
  last silent one of the three (`--css`/`--shadow` at least warn to stderr), and
  the only one whose wrong value breaks the next command.

  The classifier is shared (`argv.ts`'s `classifyPmFlag`), so the two entry points
  cannot drift apart on this flag a third time. It distinguishes absent (default
  to bun) from present-but-unusable, which is why a dangling `--pm` is now an
  error rather than a default.

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Make `--pm` actually set `packageManager` — it was a no-op under the published binary.

  Three generators (`appPackageJson`, `agentPackageJson`, `ssrPackageJson`) each
  carried their own copy of:

  ```ts
  const bunVersion = globalThis.Bun?.version ?? process.versions.bun;
  const packageManager =
    pm === "bun" && bunVersion ? `bun@${bunVersion}` : undefined;
  ```

  Two things were wrong, and the second hid the first. `pm === 'bun' &&` meant
  `--pm pnpm` could only ever produce no field — the flag was threaded from argv
  into the generator and dropped. And the published binary's shebang is
  `#!/usr/bin/env node`, where neither `globalThis.Bun` nor `process.versions.bun`
  is set, so `--pm bun` produced no field either. Measured against the built
  `dist/bin.js`, `aihu app x --pm bun` and `aihu app x --pm pnpm` emitted
  **byte-identical** trees: `--pm` changed nothing at all on this path.

  One shared helper now resolves `<pm>@<version>` for all four package managers by
  asking the tool (`<pm> --version`, memoised per process), still preferring the
  in-process Bun version when the CLI is running under Bun. A version that cannot
  be established — the tool is not installed, or answers with something that is
  not a version — emits **no** field rather than a guess. The original comment
  already made that call for bun ("drop the field entirely rather than emit a
  malformed `bun@1` string") and it generalises: corepack enforces
  `packageManager` and refuses to run when it disagrees, so a wrong pin is worse
  than none.

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Stop `aihu app` and `aihu plugin` from scaffolding outside the project directory.

  `aihu app ../../ESCAPED` wrote a complete 11-file project two directories
  **above** the cwd and exited 0. Measured against the built `dist/bin.js`:

  ```
  $ node dist/bin.js app ../../ESCAPED
    Next steps:
      cd ../../ESCAPED
  $ echo $?
  0
  $ grep name ../../ESCAPED/package.json
    "name": "../../ESCAPED",
  ```

  Both halves are broken. The files land where the user did not ask for them, and
  `"name": "../../ESCAPED"` is not a legal npm package name — so `bun install`,
  the very next command the CLI prints, fails on the tree it just created.

  `scaffoldPage` had already grown a `.`/`..` guard for exactly this class of bug.
  It was never extended to its two siblings, both of which called
  `resolve(outDir ?? '.', name)` with no validation at all. Meanwhile the template
  pipeline (`mergeOptions`) had been enforcing `/^[a-z][a-z0-9-]*$/` since it was
  written — so the same string was a legal project name on one scaffold path and
  not on the other.

  That regex now lives in one place (`project-name.ts`) and all three paths use
  it. Illegal names are **rejected**, never sanitised: silently renaming what the
  author typed is the failure mode `scaffoldComponent`'s docblock already argues
  against, so the error suggests the kebab form rather than applying it.

  Three smaller things came out of the same pass:

  - `scaffoldPlugin` could not actually traverse — `toKebab` rewrites `/` and `.`
    to hyphens — but it accepted the garbage and scaffolded `aihu-plugin--x`
    while reporting `created ../../X/package.json`. It also interpolates the raw
    name into a single-quoted JS string literal in the generated `src/index.ts`,
    so an unvalidated name was an injection into the file the user is about to
    run.
  - `aihu plugin my-forms` reported `created  my-forms/package.json` for files
    written to `aihu-plugin-my-forms/` — the same wrong-path-in-the-listing defect
    the output prefixing was added to fix, one level further in.
  - `scaffoldPage`'s guard split on `/` only, so a Windows-style `..\..\x` was a
    single segment and walked through it. Harmless on POSIX, where `\` is an
    ordinary filename character; a real traversal on Win32, where `join()` treats
    it as a separator. It now rejects on every platform.

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix four correctness bugs in the hand-rolled semver range matcher, one fail-open.

  `semver-range.ts` exists so that `@aihu/cli` can enforce a template manifest's
  `cliRange` without taking a dependency to compare two version strings. That
  trade is only defensible if the implementation is right, and in four places it
  was not. All four were measured against the real `semver` package (7.8.5);
  the fixtures in `semver-range.test.ts` are those measurements, and the fix was
  validated against a 4,140-pair cross-product of operators × partial/wildcard
  cores × versions with zero remaining divergence.

  **1. Partial `>` and `<=` bounds did not promote.** The module claimed partial
  versions "resolve their wildcards to zero", which is true for `>=` and `<` and
  wrong for the other two — npm steps them past the whole range the partial
  names:

  | range   | npm resolves to | this module resolved to |
  | ------- | --------------- | ----------------------- |
  | `>1.2`  | `>=1.3.0`       | `>1.2.0`                |
  | `>1`    | `>=2.0.0`       | `>1.0.0`                |
  | `<=1.2` | `<1.3.0-0`      | `<=1.2.0`               |
  | `<=1`   | `<2.0.0-0`      | `<=1.0.0`               |

  **2. `>1` was fail-open, and so was `>*`.** `satisfiesRange('1.5.0', '>1')`
  returned `true` where npm returns `false`. `assertTemplateCompatibility` uses
  this to decide whether the running CLI may scaffold a template, so a template
  declaring `cliRange: '>1'` — meaning "2.x or newer" — was waved through by every
  1.x CLI. `>*` and `<x` were the same shape of bug: npm reads them as "nothing is
  allowed" (`<0.0.0-0`), this module read them as "anything is". A gate that fails
  open is not a gate.

  **3. A wildcard atom inside an AND-set discarded the set.** `>=1.0.0 * <2.0.0`
  threw away _both_ real comparators and matched anything, so 2.5.0 satisfied a
  range capped at 2.0.0. npm drops the wildcard and keeps the rest. Dropping
  constraints is the precise opposite of this module's stated fail-closed
  contract.

  **4. Syntax npm accepts was rejected, which BLOCKED good templates.** `>= 1.0.0`
  (space after the operator) and `v1.2.3` / `=v1.2.3` / `^v1.2.0` (the `v` prefix)
  both threw inside the tokenizer, and `assertTemplateCompatibility` turns a throw
  into "template declares an unusable cliRange" and refuses to scaffold. Failing
  closed is right for syntax that cannot be read; it is not right for syntax npm
  reads without complaint. Both forms are now tolerated — a bare operator with no
  operand (`>=`) still throws.

- [#780](https://github.com/fellwork/aihu/pull/780) [`abfaa6e`](https://github.com/fellwork/aihu/commit/abfaa6e0136cdf9d5f5ce77cc5f8e53c840fd4ce) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Correct the scaffold's `trustedDependencies` — it named the one package that no
  longer needs it, and omitted the one that does.

  Every scaffold emitted `trustedDependencies: ['@aihu/compiler']`, justified by a
  comment stating that `@aihu/compiler`'s postinstall downloads and arch-validates
  the native binary. Re-measured against the published tarball, that is no longer
  true: `npm view @aihu/compiler@1.2.0 scripts` lists `build`, `build:native`,
  `build:wasm`, `typecheck`, `prepublishOnly` and a codemod — **no install script
  of any kind**. It was deleted in [#370](https://github.com/fellwork/aihu/issues/370), which replaced the postinstall with
  per-platform `optionalDependencies`. The same holds for every published
  `@aihu/*` package and every platform artifact under `packages/*/npm/*`: none has
  `install`, `preinstall` or `postinstall`.

  `esbuild` is what a scaffold actually postinstalls, reached transitively through
  vite 6, and it was named only on the pnpm side (`pnpm-workspace.yaml`'s
  `allowBuilds`, where it is not optional — pnpm exits 1 with
  `ERR_PNPM_IGNORED_BUILDS` before the first build). It is now named on the bun
  side too, so the two files agree and the manifest states its own requirement
  rather than depending on bun's built-in allow-list — which does currently
  contain it (`bun pm default-trusted`, 367 entries, checked), but which is not
  visible in the project and not a promise to a reader. Under `vite ^8` there is
  no esbuild at all and the entry is simply unused; `^6 || ^8` means one manifest
  has to cover both installs.

  `@aihu/compiler` is kept as a forward guard, now labelled as one instead of
  carrying a false claim: that delivery mechanism has already changed once, and a
  blocked script does not fail at install time — it resurfaces much later as
  ENOEXEC inside `run build`.

  Also verified, because the whole change depends on it: naming packages in
  `trustedDependencies` does **not** disable bun's built-in list. A probe project
  depending on `esbuild@0.25.12` with `trustedDependencies: ['@aihu/compiler']`
  still ran esbuild's script — `bun pm untrusted` reported 0 untrusted, and the
  binary resolved.

## 1.2.0

### Minor Changes

- [#719](https://github.com/fellwork/aihu/pull/719) [`c972073`](https://github.com/fellwork/aihu/commit/c972073efcd9ad94e89923432b435ea1e8de0ffa) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Eliminate the need for a scaffolded `src/main.ts` in the common case, and fix a real typecheck/build divergence uncovered along the way.

  - `@aihu/app`: `viteAihuPlugin()` gained an `aihu-entry` sub-plugin
    (`packages/app/src/entry.ts`) that serves `virtual:aihu-entry` — a
    byte-identical stand-in for the old boilerplate `src/main.ts`
    (`import { createApp } from '@aihu/app/client'; createApp()`) — and
    injects its `<script>` tag into `index.html` whenever no real
    `src/main.ts` exists on disk. A project that needs `createApp(options)`
    (`provide`, `outletId`, a non-default `head`) still writes a real
    `src/main.ts`, which makes the virtual entry step aside entirely (full
    eject, not a partial override — mirrors how framework-owned client entries
    work elsewhere, and keeps `provide` where comparable frameworks keep it:
    code, not declarative config, since it holds live values that can't be
    serialized into generated source).
  - `@aihu/cli`: `appMainTs`/`appIndexHtml` (the `minimal`/`docs` templates)
    stop emitting `src/main.ts` and its `<script>` tag — the virtual entry
    above covers it. `AGENTS.md`'s generated project-map table updated to
    match.
  - `@aihu/compiler`: `compileSidecar()` gained a `target` option
    (`'client' | 'server' | 'universal'`), mirroring what `transform()` already
    passes as `--target`. Previously the sidecar (the type-check surface
    `aihu-tsc` and the language server hand to TypeScript) always compiled
    against the binary's `universal` default regardless of what a project's
    `vite.config.ts` actually configured — a real divergence, since `--target`
    changes what the sidecar is derived from (e.g. a `target: 'client'` build
    elides server-only artifacts). `islands`/`shadowMode` are deliberately NOT
    added here: both are JS-side post-processing on the runtime JS output only
    and have no bearing on the sidecar's types.
  - `@aihu/tsc`: `run()`/`aihu-tsc` now read `AihuConfig.compiler.target` and
    `AihuConfig.typecheck.strictTemplates` from the project's `vite.config.ts`
    (new `loadTscProjectConfig()`, invoked from `bin/aihu-tsc.mjs` since
    `run()` itself stays synchronous) and thread `target` into `compileSidecar`
    — closing the gap above for the common `"typecheck": "aihu-tsc"` scaffold
    script, which is invoked with no flags and had no other way to see that
    config.
  - `@aihu/language-server`: reads the same `compiler.target` from the
    workspace root (best-effort — a client that gives no workspace root, or a
    project with no `vite.config.ts`, behaves exactly as before), so editor
    diagnostics match `aihu-tsc`'s and CI's.

## 1.1.2

### Patch Changes

- [#717](https://github.com/fellwork/aihu/pull/717) [`44698e0`](https://github.com/fellwork/aihu/commit/44698e0e7085bf40939a8543f4df751386bf7d2d) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix four scaffold DX-matrix failures found via the CI matrix that exercises every built-in template across bun/npm/pnpm/yarn:

  - `cf-team`: several source files (`main.ts`, the auth provider modules, the
    `.env.example.*` files, both `.aihu` files, and the `shared` package's
    `index.ts`/`index.test.ts`) contained `__APP_NAME__`-style placeholders but
    weren't named `*.tmpl`, so the scaffold pipeline copied them verbatim
    instead of substituting — every scaffolded app failed typecheck with
    `Cannot find module '@__APP_NAME__/shared'`. Renamed to `.tmpl` so
    substitution runs.
  - `minimal`/`docs`: the compiler unconditionally emits `import {
registerAgentMetadata } from '@aihu/agent'` for any component with an
    `$action` block (the scaffolded counter always has one), but `@aihu/agent`
    was never listed in the scaffolded `package.json` — only reachable
    transitively via `@aihu/server`. bun/npm/yarn's hoisted `node_modules`
    papered over this; pnpm's strict resolution failed the build. Added
    `@aihu/agent` as a direct dependency.
  - `full`/`agent`: the `dev` script hardcoded `vite --port 5108` inside a
    `concurrently` sub-command with no argv forwarding, so
    `bun run dev -- --port N --strictPort` never reached vite and dev-server
    probes timed out. Switched to concurrently's `-P`/`{@}` passthrough-
    arguments mode so forwarded args reach the vite sub-command.
  - `full`/`agent`/`cf-team`: `pnpm run typecheck` failed with `error TS2688:
Cannot find type definition file for 'node'` — `@types/node` was missing
    from the scaffolded `devDependencies` (only reachable via hoisting under
    bun/npm/yarn). Added it directly to the `agent`/`full` template and to
    `cf-team`'s `apps/web` and `packages/shared` workspace members.
  - `cf-team`: fixing the placeholder substitution above unmasked several
    deeper, pre-existing gaps once typecheck could actually run —
    `@aihu-plugin/agent-readiness` was imported but never declared as a
    dependency; `packages/shared`'s moon task independently hardcoded
    `tsc --noEmit` (moon tasks bypass `package.json` scripts entirely), which
    silently skipped writing the `dist/index.d.ts` that `apps/web`'s project
    reference needs, and there was no `deps:` ordering between the two
    `typecheck` tasks so they could race even after that was fixed; and
    `apps/web` had no `vite.config.ts`, no `index.html`, and no `vite`
    dependency at all — the client build was never wired up. Added the missing
    dependency, fixed the moon task graph, added a client-only
    `vite.config.ts` + `index.html` (mirroring `examples/cf-adapter`'s
    working pattern), and pointed `wrangler.toml`'s `main` at the Workers
    entry's TS source directly (wrangler bundles it with its own esbuild step)
    instead of a `vite build`-produced file that nothing ever emitted. Removed
    a dead `import './aihu-app.aihu'` from the Workers entry — a `.aihu` file
    has no place in a wrangler-bundled server module, and the component is
    already mounted client-side via `index.html`.
  - The scaffold DX-matrix harness itself (`packages/cli/tests/
scaffold-matrix-e2e.ts`) passed `--port N --strictPort` to every package
    manager the same way, but pnpm forwards the literal `--` separator into
    the child process argv unlike npm/bun (confirmed empirically) — so vite
    saw `-- --port N` and kept its default port, timing out every
    `<template> × pnpm · dev` cell. Added pnpm to the existing yarn special
    case in `pmRunArgs`.

- [#715](https://github.com/fellwork/aihu/pull/715) [`9bba4bb`](https://github.com/fellwork/aihu/commit/9bba4bbf177bcd266502ab9181e91478f1710704) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix ReDoS-vulnerable regex patterns and a prototype-pollution gap found by CodeQL code scanning.

  - `@aihu/app`: `applyHeadConfig`'s `<meta>`-tag matching no longer uses a
    `\s+[^>]*attr...[^>]*` nested-quantifier regex over the whole `index.html`
    string (catastrophic backtracking on pathological/repetitive input) — it
    now scans tag boundaries with one unambiguous pass, then tests the
    attribute within just that bounded tag.
  - `@aihu/router`: the file-router's segment builder no longer strips a
    route's extension with a `\.[^/]+$/`-anchored regex (same backtracking
    class) — a plain `lastIndexOf`-based split instead.
  - `@aihu/compiler`: `_isLayoutFile`'s trailing-slash trim no longer uses a
    `\/+$/`-anchored regex — measured 45s on a 200k-character pathological
    input before the fix, sub-millisecond after. The state-wrapper codemod
    (`migrate.ts`/`verify.ts`) also now fully escapes identifiers before
    embedding them into `RegExp` constructors (previously escaped only `$`).
  - `@aihu/cli`: the `full` template's scaffolded `server.ts` had the same
    trailing-slash ReDoS shape in a generated string — fixed so scaffolded
    apps don't inherit it.
  - `@aihu/magna`: `setBuildFlag` (a public function accepting an arbitrary
    dot-notation key) now rejects `__proto__`/`constructor`/`prototype`
    segments, closing a prototype-pollution gap in its public contract.

## 1.1.1

### Patch Changes

- [#634](https://github.com/fellwork/aihu/pull/634) [`65fac84`](https://github.com/fellwork/aihu/commit/65fac84c220c16f5d7488dca58651104dbd45180) Thanks [@srmcguirt](https://github.com/srmcguirt)! - **`aihu app` left an unborn HEAD — the scaffold reported success and the repo had no commit.**

  `create.ts` has always run init + add + commit; `scaffold-pipeline.ts` ran `init`
  alone, because `commandFor` returned a single command and the shape could not
  express a sequence. One capability, two implementations, and only the untested
  one was broken.

  Before, on a fresh scaffold:

  ```
  aihu app demo --template cf-team --pm bun --no-install  -> exit 0
  git rev-parse HEAD                                      -> exit 128
  git rev-list --count --all                              -> 0
  ```

  Git identity is passed **explicitly** rather than read from ambient config.
  `git commit` fails outright with no resolvable `user.name`/`user.email`, which is
  the normal state of CI runners and fresh containers — using ambient config would
  have fixed this on a developer machine and left the unborn HEAD in exactly the
  environment the scaffold matrix runs in. Verified with `HOME` redirected and both
  `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` neutered.

  Fixes FEL-431 defect 5.

## 1.1.0

### Minor Changes

- [#601](https://github.com/fellwork/aihu/pull/601) [`5720298`](https://github.com/fellwork/aihu/commit/572029884dca3bc381f09936431afcd28ae989f3) Thanks [@srmcguirt](https://github.com/srmcguirt)! - **`--template agent`: give the agent template an agent-readiness surface, and fix its gate.**

  The template named for agents was the only one with no discovery surface — the generic
  `full` template had one, `agent` had none. An agent handed the app's URL could not find
  out what the app was or how to call it. It now serves the full surface, and two of its
  own headline flows that were broken are fixed.

  **Discovery, served live rather than emitted statically.** `readiness.ts` wires
  `@aihu-plugin/agent-readiness`'s `createAgentReadinessRoutes()` into `server.ts` and
  `mcp.ts`, and `vite.config.ts` proxies the paths so they answer on the app's own URL:

  | Path                                                                              | Content-Type       |
  | --------------------------------------------------------------------------------- | ------------------ |
  | `/llms.txt`, `/llms-full.txt`, `/robots.txt`                                      | `text/plain`       |
  | `/sitemap.xml`                                                                    | `application/xml`  |
  | `/.well-known/mcp/server-card.json`                                               | `application/json` |
  | `/.well-known/agent-card.json` (+ the deprecated `/.well-known/agent.json` alias) | `application/json` |
  | `/.well-known/mcp.json`                                                           | `application/json` |

  This template deliberately does not use `viteAgentReadinessIntegration()` the way
  `minimal`/`full`/`docs` do. That integration emits the documents from a browser-target
  build, where the `@aihu/agent` registry is empty — the files would exist and advertise
  zero tools. Serving them from the process that calls `registerAgentMetadata()` means the
  MCP card's tools, the A2A card's skills and llms.txt's `## Components` section are all
  derived from the same registry the `/agent/call` gate authorizes against, so the
  advertised surface cannot drift from the callable one.

  Also in this template:

  - **`/agent/call` was returning 401 `AUTH_UNVERIFIABLE` for every call**, authorized or
    not — the whole documented 404/401/403/429/200 ladder was dead. `@aihu/agent-service`
    will not serve a scoped or rate-limited tool through an auth plugin that cannot
    signature-verify a credential, and the template's demo plugin only implemented
    `checkScope`. It now implements `verify` as well.
  - **The A2A card was emitted with no skills**; it is now handed the registry-derived list,
    so both cards describe the same surface.
  - `registerAgentMetadata` actions carry their `describe:` text, so the MCP tool
    descriptions are populated instead of empty strings.
  - Documented that `/agent/call` always answers HTTP 200 with the outcome in the body's
    `code`, and that the rate-limit key is the verified subject — not the caller-supplied
    `userId`, which rotating does not reset the quota.

- [#609](https://github.com/fellwork/aihu/pull/609) [`bef4c66`](https://github.com/fellwork/aihu/commit/bef4c66fb59c8d9224d131e158106713cdb0da05) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Config lives in `vite.config.ts`; the CLI reads it from there

  The scaffold no longer emits a separate `aihu.config.ts`. Everything aihu is
  configured with goes inline on `viteAihuPlugin({...})` in `vite.config.ts`, and
  non-Vite consumers read it back from there.

  A second config file is justified exactly as long as something other than Vite
  needs the config and cannot parse the Vite config. That was SvelteKit's stated
  reason for `svelte.config.js` in 2022 — the language server had to know your
  preprocessors and does not run Vite. SvelteKit then removed the reason rather
  than living with it: once the language server could read `vite.config.js`, the
  second file became optional, and SvelteKit 3 makes the Vite config the required
  location.

  **New in `@aihu/app`:**

  - `viteAihuPlugin()` registers an `aihu:config` marker plugin carrying the
    evaluated config on a public `api` handle.
  - `loadAihuConfig(root)` reads it back through Vite's own `loadConfigFromFile`
    — no build. Returns the config, its source path, Vite's dependency list, and
    every registered aihu module's options.
  - `declareAihuModule()` + `collectAihuModules()`: the contract by which any
    package becomes readable by the CLI and the language server without a central
    registry to update.
  - `viteAihuPlugin()` now validates its inline argument. Only `defineConfig` did
    before, so the path every example uses was unvalidated. Unknown keys throw
    with a keypath and a did-you-mean.
  - New options that previously required abandoning `viteAihuPlugin` and wiring
    the underlying plugin by hand: `dir.components`, `compiler.islands`,
    `compiler.target`, `build.bundler`, `dev.*`, `typecheck.*`.

  **In `@aihu/cli`:** `aihu build` and `aihu dev` each had a private loader that
  dynamic-imported `aihu.config.ts` with its own local interface. They now share
  one loader that prefers `vite.config.ts` and falls back to `aihu.config.ts`, so
  existing projects keep working.

  **Also:** the scaffolded config declares no MCP `endpoint`. The previous one
  pointed `endpoint` at the server card's own URL, publishing a card that
  advertised zero tools and named the discovery document as its own transport.
  A static client build has no process to serve MCP, so no card is emitted.

- [#600](https://github.com/fellwork/aihu/pull/600) [`3ed4072`](https://github.com/fellwork/aihu/commit/3ed407299c68644cb522d919204b4f4a3f96025e) Thanks [@srmcguirt](https://github.com/srmcguirt)! - `create-aihu --template` now spans both template tiers.

  npm users could only ever reach the built-in templates. The npm-published
  `@aihu/templates-*` tier was reachable only through `aihu app --template <pkg>`,
  and that command cannot run under npx at all:

  ```
  $ npx -y @aihu/cli@latest app my-app --template cf-team
  npm error could not determine executable to run
  ```

  npx infers the executable from the package NAME — for `@aihu/cli` it looks for
  a bin called `cli`, and the bins are `aihu` and `create-aihu`. `bunx` resolves
  differently, so the failure was npm-only. `create-aihu` is the entry point npm
  users actually reach, so it is now the complete one:

  ```
  npm create aihu my-app -- --template cf-team
  npx create-aihu my-app --template cf-team
  ```

  Both tiers run the SAME scaffold pipeline, factored out of `bin.ts` into
  `scaffold-pipeline.ts` rather than reimplemented.

  Also fixes a silent-wrong-result path: `--template cf-team` previously fell
  through to scaffolding a `minimal` app. The run "succeeded" and the user found
  out later. Unknown, missing, and declared-but-unpublished template names now
  each fail with an explicit message that LISTS what is available, and exit 1.

  The catalogue distinguishes three states honestly — built-in, available from
  npm, and declared-but-not-yet-published (`vercel-team`, `fly-team`, `cf-solo`,
  `cf-full-agent` are in the registry but 404 on npm, and are shown as
  unselectable rather than offered or hidden).

- [#612](https://github.com/fellwork/aihu/pull/612) [`9286182`](https://github.com/fellwork/aihu/commit/9286182f38211a61344d46d9a38ef4821605bf93) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Scaffold experience: agent tooling, honest per-build-target claims, teaching voice.

  Adds `AGENTS.md`, `CLAUDE.md` (a one-line `@AGENTS.md` import, per Anthropic's
  guidance) and `.mcp.json` to scaffolded projects, gated behind
  `--no-agent-tooling` for users who want a clean tree. `.mcp.json` registers
  `npx aihu mcp serve` — the `@aihu/mcp` server exposing `aihu_validate`
  (compiles source, returns real diagnostics) and `aihu_example` (cookbook
  recipes), so an agent working in a scaffolded project can check its own work
  against the compiler instead of guessing at novel syntax.

  Previously only the cf-team template emitted any of this; the built-in
  templates shipped `.vscode/*` and nothing else.

  Also corrects what a static build claims about itself. The starter page said
  "These actions are exposed to AI agents as MCP tools" and linked an MCP server
  card — neither true for a client build, where `emit.rs`'s `elide_agent` strips
  agent metadata by design. It now distinguishes the declaration a static build
  genuinely publishes from the live, callable tools a server provides.

### Patch Changes

- [#613](https://github.com/fellwork/aihu/pull/613) [`8aa12dc`](https://github.com/fellwork/aihu/commit/8aa12dc1412125635880b09fe7b8f8a36fb6c7a4) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix the agent template's typecheck failing again on a fresh scaffold.

  `bun run typecheck` — the command the template's own next-steps prints —
  failed with TS7006 on the websocket `message` handler's parameters. Contextual
  typing from `Bun.serve`'s handler map does not reach them, so under the
  scaffolded project's `strict` they are implicit-any.

  This is a regression, not a new bug: [#595](https://github.com/fellwork/aihu/issues/595) fixed this class of error by adding
  `@types/bun` and `skipLibCheck`, and [#601](https://github.com/fellwork/aihu/issues/601) reintroduced it while wiring the
  readiness surface into `server.ts`. Both websocket handler blocks in the
  generator are fixed, and the reasoning is recorded inline so the next edit to
  that file does not undo it a third time.

  Verified on a real npm scaffold outside the monorepo: `typecheck` exits 0 with
  zero implicit-any errors.

- [#599](https://github.com/fellwork/aihu/pull/599) [`2dff3b5`](https://github.com/fellwork/aihu/commit/2dff3b5df8d8cead0e14446e9c4bbbc0cbc9d747) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix the agent template's own typecheck failing on a fresh scaffold.

  `npm create aihu --template agent` then `npm run typecheck` — the script the
  template emits, and the one its own next-steps output tells you to run —
  failed immediately with 12 errors:

  ```
  mcp.ts(72,1):     error TS2868: Cannot find name 'Bun'.
  server.ts(115,1): error TS2868: Cannot find name 'Bun'.
  mcp.ts(74,9):     error TS7006: Parameter 'req' implicitly has an 'any' type.
  ```

  The template emits `server.ts` and `mcp.ts` calling `Bun.serve()` while
  declaring `types: ['node']` with nothing providing Bun's globals. Under
  `strict: true` the missing namespace also made every callback parameter an
  implicit-any, so one missing dependency produced twelve errors.

  Adds `@types/bun` and `types: ['node', 'bun']`, plus `skipLibCheck` — required
  because `@types/bun` and vite declare `ImportMeta.hot` incompatibly (TS2430)
  with no user code involved.

  Verified on both package managers: typecheck and build exit 0.

- [#606](https://github.com/fellwork/aihu/pull/606) [`c8c1d71`](https://github.com/fellwork/aihu/commit/c8c1d714a9a221708ab6db3399c1e6e13d63f7ab) Thanks [@srmcguirt](https://github.com/srmcguirt)! - **Scaffold: `--css engine` no longer silently pins `shadowMode: 'shadow'` (FEL-425).**

  `create-aihu app --css engine` (and `aihu app --css engine`) emitted a plugin-global
  `css: { shadowMode: 'shadow' }` block even when the user never passed `--shadow` —
  fabricating a "choice" that outranks the DA4 page/layout light-DOM default and put
  the scaffolded page in shadow DOM, for exactly the scaffold that most needs global
  CSS to reach component internals.

  The shadow choice is now `ShadowChoice | undefined` end to end: the `css: { shadowMode }`
  block is written **only when the user explicitly chose** a mode (`--shadow light|shadow`
  or a deliberate wizard selection). With no choice, nothing is emitted and the framework
  defaults apply — pages and layouts light DOM, leaf components shadow DOM. A scaffold
  that pins the default freezes it.

  - `create-aihu app --css engine` → light-DOM page, utility CSS reaches the global cascade
  - `create-aihu app --css engine --shadow shadow` → still explicitly shadow (deliberate choice kept)
  - `create-aihu app --css engine --shadow light` → still explicitly light
  - The wizard's shadow-mode prompt gained a "default (framework defaults)" first option;
    pressing Enter is no longer treated as choosing `shadow`.
  - Invalid `--shadow` values are now ignored (framework defaults) instead of silently
    becoming `shadow`.

  Note: an explicit `--shadow` choice is still carried as the **project-wide** plugin
  config, so it also governs leaves and layouts (e.g. `--shadow light` flips leaves to
  light DOM too). That is the existing semantic of the flag; a per-file mechanism for
  the scaffolded page only would be a separate change.

- [#599](https://github.com/fellwork/aihu/pull/599) [`2dff3b5`](https://github.com/fellwork/aihu/commit/2dff3b5df8d8cead0e14446e9c4bbbc0cbc9d747) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Resolve auto-installed templates from the invoking project, not the CLI's cache.

  `aihu app --template <pkg>` could not work for any user outside the monorepo,
  on any package manager:

  ```
  $ bunx @aihu/cli@latest app testapp --template cf-team --pm bun
  Installing template package @aihu/templates-cf-team...
  Resolved, downloaded and extracted [2]        <- install SUCCEEDED
  ERROR: Failed to install template package     <- resolution FAILED
  ```

  `autoInstallTemplate()` runs `<pm> add <pkg>` in `process.cwd()`, so the
  template lands in the user's project. `resolveTemplatePackagePath()` then used
  `import.meta.resolve()`, which resolves relative to the CLI module — and under
  `bunx`/`npx` that module lives in a package-manager cache with no view of the
  user's project. Install and resolve were looking in different places; the
  package was on disk the whole time.

  The existing fallback only searched `packages/templates/<short>`, which exists
  only inside the aihu monorepo — so the one environment where this worked was
  the one no user is in.

  Adds a first-choice strategy that checks `<cwd>/node_modules/<pkg>`.

## 1.0.1

### Patch Changes

- Updated dependencies [[`7bf702f`](https://github.com/fellwork/aihu/commit/7bf702f6e7de8716ef51544944064a988fa3c38c), [`2ef2830`](https://github.com/fellwork/aihu/commit/2ef2830aa737906d09a5d870176da34a22f20b99)]:
  - @aihu/mcp@0.2.0

## 1.0.0

### Major Changes

- [#479](https://github.com/fellwork/aihu/pull/479) [`9dd7654`](https://github.com/fellwork/aihu/commit/9dd7654678da1149705e21324f6b30e9baafcd4b) Thanks [@srmcguirt](https://github.com/srmcguirt)! - DA4 ([#437](https://github.com/fellwork/aihu/issues/437)): the binary shadow API (`'light' | 'shadow'`) and light-DOM-by-default pages — one breaking change.

  **The API.** `ShadowMode` collapsed to a BINARY `'light' | 'shadow'`; the
  `'open'`, `'closed'`, and `'none'` tokens are retired everywhere (the
  `$shadow` macro, the plugin-global `shadowMode` config /
  `css: { shadowMode }`, the runtime `defineElement` options, and the CLI
  `--shadow` flag). `'shadow'` attaches an OPEN root internally — open is the
  only browser mode aihu's composition/hydration can use; `'closed'` was
  self-contradictory (a closed root nulls `this.shadowRoot`, so light-DOM
  detection misclassified it and content rendered into the host anyway).
  `'light'` attaches no root, so `this.shadowRoot === null` is an unambiguous
  detection. Migration: `'open'` → `'shadow'`, `'none'` → `'light'`,
  `'closed'` → `'shadow'`.

  **The defaults.** Page-level components — those with an `@route` block — and
  layout SFCs (files under the configured layouts dir, default `src/layouts/`)
  now default to `'light'`, so server-rendered page content is reachable by
  crawlers and agents that do not execute JavaScript. Leaf components (no
  `@route`) default to `'shadow'` (behaviorally the old `'open'` default).

  Precedence, in order: a per-file `$shadow` pin > an explicit plugin-global
  `shadowMode` config > the page/layout default `'light'` > the leaf default
  `'shadow'`. An unpinned page carries a new `// @aihu:shadow-default light`
  marker (distinct from the `$shadow` pin marker) so the implicit default ranks
  below an explicit plugin-global config.

  Breaking implications:

  - Retired tokens fail loudly: `$shadow` with an old token is a C471 compile
    error; `css.shadowMode` with one throws at config validation; `--shadow`
    with one warns and falls back to the default.
  - A `$shadow`-less `@route` page's `@style` block now joins the global
    cascade instead of being trapped in a shadow root — scope bare element
    selectors under a page root class (see the migration guide §8).
  - W472 (the phase-1 advisory that announced this flip) is retired.
  - The static-island fast path is skipped for light-DOM components — the shim
    cannot honor `shadowMode: 'light'`; such components keep the full runtime
    path.
  - css-engine scaffolds now always emit an explicit `css: { shadowMode }`
    block carrying the wizard's `--shadow` choice (default `'shadow'`), since
    the page default would otherwise override it.

### Minor Changes

- [#489](https://github.com/fellwork/aihu/pull/489) [`80531dc`](https://github.com/fellwork/aihu/commit/80531dcc4dfc43bc9cd399bbb8ab4520efb8f15a) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Template grammar v2 — the prefix-less template (founder-ratified 40-spec).

  One rule: naked keywords + naked HTML attributes + naked framework vocabulary;
  `{expr}` braces mean expression, quoted strings mean static; `$` retreats to
  `@state` macros only.

  **New grammar:** `if={…}`/`elseif={…}`/`else` attribute chains (adjacency-checked),
  the item-first `each={item, i of items}` `of`-binder with destructuring, `key={…}`,
  `empty` siblings, colon directives `on:<event>` (with `.prevent`/`.stop`/`.self`/`.once`
  modifiers), `bind:<prop>`, `class:<name>`, the `attr:<name>` literal escape hatch,
  naked `show`/`html`/`ref`/`once`/`memo`/`raw`, the NEW `<group>` fragment carrier,
  naked framework elements (`<slot>` is now THE projection form), and the enhanced
  `<a>` (SPA navigation, `prefetch`, `replace`, `aria-current`, auto-opt-out +
  explicit `reload`) replacing `<$link>`.

  **Retired (compile errors with fix hints):** `{#if}` C601, `{#each}` C602,
  `{@html}` C603, `{{ident}}` C604, `<$if>`/`<$else>` C605, `$if=`/`$each=`/`$let=`
  C606, every other `$`-attribute C607, `<$link>` C608, other `<$…>` elements C609,
  adjacency violations C610, unknown non-hyphenated elements C611. New lints:
  W601 (keyless stateful `each`), W602 (non-empty string on a boolean attribute).

  **Intended emission diffs:** internal `<a href>` links now lower to
  `createLinkBoundary` (the retired `<$link>` lowering) with a runtime
  origin/scheme auto-opt-out; everything else lowers through the same arbor
  structural calls as v1 (`when`/`each`/fragment branches).

  `aihu migrate --v2` now lands on this grammar (new final codemod pass:
  `compiler/js/codemods/template-grammar-v2`).

### Patch Changes

- [#505](https://github.com/fellwork/aihu/pull/505) [`dd8cfd6`](https://github.com/fellwork/aihu/commit/dd8cfd639f42ddb05468fe07b6d4f4420a80a8bf) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix the codemod and sidecar defects surfaced by the v2 canary migration
  ([#502](https://github.com/fellwork/aihu/issues/502), [#503](https://github.com/fellwork/aihu/issues/503), [#504](https://github.com/fellwork/aihu/issues/504)).

  - `aihu migrate` (macro-simplification): consume a multi-line `import { … }`
    as a single statement so its members are no longer orphaned below the
    closing brace and single-line imports are no longer hoisted into the open
    brace (the import-scrambling defect).
  - `aihu migrate --state` (state-wrapper): de-call prop reads (`name()` →
    `name`) after `$prop` → `prop()`, since `prop()` returns a value in the
    wrapper model rather than a callable signal.
  - `aihu migrate --v2` (template-grammar): accept the dot spelling
    `$class.modifier` in addition to `$class:modifier`.
  - Type-check sidecar: `__aihu_each` over an `any` iterable now types loop
    bindings as `any` instead of `unknown` (one conditional-typed generic with
    an IsAny guard).
  - `aihu-tsc`: surface the first real compile error when a file cannot be
    compiled (a stale-compiler error immediately reveals a version mismatch),
    and document version-aligning `@aihu/tsc` with `@aihu/compiler`.

- Updated dependencies [[`80531dc`](https://github.com/fellwork/aihu/commit/80531dcc4dfc43bc9cd399bbb8ab4520efb8f15a)]:
  - @aihu/mcp@0.1.1

## 0.8.3

### Patch Changes

- [#395](https://github.com/fellwork/aihu/pull/395) [`8127925`](https://github.com/fellwork/aihu/commit/8127925482725c8394c03298a27b91cbbfc59418) Thanks [@srmcguirt](https://github.com/srmcguirt)! - **`.aihu` files are now type-checked.** They were not before — at all.

  The type-check sidecar declared every template-referenced binding as an `any`
  parameter and never emitted the `@state` body, so TypeScript was handed a file
  that could not disagree with the author about anything. A `const x: number =
'a string'` inside `@state`, or a typo'd property, passed `tsc --noEmit` clean.
  The green check was over code TypeScript had never seen.

  Two things change:

  **`@aihu/compiler`** now inlines the `@state` body into the type-check surface, at
  its real source lines. Bindings carry their true types instead of `any`, imports
  resolve so call sites are checked, and a diagnostic inside `@state` cites the
  `.aihu` line the author wrote it on. Only loop aliases remain `any` — `{#each xs
as m}` binds `m` in the template, so there is no declaration to borrow a type
  from.

  **`@aihu/tsc`** (new) provides `aihu-tsc`, which projects each `.aihu` into the
  TypeScript program as a VIRTUAL file via Volar's `proxyCreateProgram`. No
  `.aihu.ts` sidecar is written to disk any more: the Vite plugin no longer emits
  them, and consumers can delete the ones they have and drop `*.aihu.ts` from
  `.gitignore`.

  **Migration.** Replace `tsc --noEmit` with `aihu-tsc` in your `typecheck` script
  (`@aihu/cli` now scaffolds this for new projects). Plain `tsc` cannot see inside a
  `.aihu` file, so it will keep reporting a clean pass over every SFC in your
  project without having checked one.

  Expect real diagnostics the first time you run it — this is code that has never
  been type-checked. Implicit-`any` inside `.aihu` files is suppressed by default,
  since no corpus has ever been annotated for it; `aihu-tsc --strict-templates`
  turns it on.

## 0.8.2

### Patch Changes

- [#378](https://github.com/fellwork/aihu/pull/378) [`ce3b9a9`](https://github.com/fellwork/aihu/commit/ce3b9a9de72bc2439294df4089d430e8220fc388) Thanks [@srmcguirt](https://github.com/srmcguirt)! - feat(cli): the `agent` template ships client-durable state

  The scaffolded `<task-list>` now hydrates its signals from `localStorage` on
  mount and writes back on every change, so the durable component **survives a
  page refresh** out of the box. Because the agent's bridge calls drive the same
  signals, an agent's reskin (label, variant, tasks) persists too. Browser-only
  and guarded, so build/SSR safely fall back to defaults. (For state shared across
  tabs/devices, move the source of truth server-side — e.g. a Durable Object / KV
  behind the agent gate.)

## 0.8.1

### Patch Changes

- [#376](https://github.com/fellwork/aihu/pull/376) [`d48a7ad`](https://github.com/fellwork/aihu/commit/d48a7ad12851ee30b869ee5f8f234038d97c9aff) Thanks [@srmcguirt](https://github.com/srmcguirt)! - fix(cli): agent template (`create-aihu --template agent`) now mounts

  The scaffolded `<task-list>` never registered as a custom element, so the page
  rendered blank. Two bugs in the `agent` template's `task-list.aihu`:

  - The reskin signal setters were named `setLabel`/`setVariant` — colliding with
    the `setLabel`/`setVariant` `$action`s, so the compiler emitted two top-level
    `const setLabel`/`const setVariant`. The dev transpile the vite plugin runs
    failed on the duplicate symbol, the plugin silently fell back to serving raw
    TS, and the element never defined. Renamed the setters to
    `writeLabel`/`writeVariant`.
  - `$class={['tl', variant]}` passed the signal _accessor_ (a function) into the
    class array, which the class helper drops as a non-string — so the agent's
    `setVariant` had no visible effect. The signal is now called:
    `$class={['tl', variant()]}`.

  Adds a `scaffold-compile-clean` regression guard that transpiles the agent
  template's compiled client output (the exact dev path) and fails on this bug
  class — the native compiler exits 0 on the duplicate `const`, so file-presence
  and native-compile checks alone passed it silently.

## 0.8.0

### Minor Changes

- [#374](https://github.com/fellwork/aihu/pull/374) [`6a0d8e4`](https://github.com/fellwork/aihu/commit/6a0d8e426fa2ab53c37fa5d1d4e6ae63ca671e0d) Thanks [@srmcguirt](https://github.com/srmcguirt)! - add `create-aihu --template agent` + publish `@aihu/agent-server`

  - **New opt-in `agent` template** (`create-aihu --template agent`, or option 4 in the
    wizard): the headline aihu thesis made runnable. A durable on-screen `<task-list>`
    Web Component that BOTH a human and an external AI agent drive — the agent reaches the
    same visible instance over `@aihu/agent-server`'s capability bridge (server = policy
    gate, browser = sole executor). Two-process app (Bun bridge server + Vite, client-target
    compiler). Verified end-to-end: typing in the input AND an external
    `curl /agent/call` both append to the same live instance; unexposed actions are rejected.
  - **`@aihu/agent-server` first publish** (added to the release allowlist). Includes the
    fix that lets `createAgentServer`'s `node` mount path stand up its own server-side DOM
    internally (no consumer jsdom/`createHost` glue) when the runtime has no `document`.

  The bridge in the template is unauthenticated (local dev/demo); the generated server
  warns against exposing it to untrusted networks.

- [#374](https://github.com/fellwork/aihu/pull/374) [`6a0d8e4`](https://github.com/fellwork/aihu/commit/6a0d8e426fa2ab53c37fa5d1d4e6ae63ca671e0d) Thanks [@srmcguirt](https://github.com/srmcguirt)! - create-aihu: fix `bun run dev` + ship the agent surface out of the box

  - **`bun run dev` no longer crashes.** The generated `vite.config.ts` now sets
    `optimizeDeps: { exclude: ['@aihu/app'] }` — esbuild's dep pre-bundle can't
    resolve the `virtual:aihu-routes` / `virtual:aihu-layouts` modules that
    `@aihu/app`'s client entry imports (the router plugin resolves them at request
    time), so excluding `@aihu/app` from pre-bundling is required for dev to boot.
  - **The default scaffold now delivers the agentic surface.** `vite.config.ts`
    wires `viteAgentReadinessIntegration` (imported directly from
    `@aihu-plugin/agent-readiness`, now a scaffolded devDependency), so
    `vite build` emits `llms.txt`, `llms-full.txt`, `robots.txt`, the MCP server
    card at `/.well-known/mcp/server-card.json`, and JSON-LD — all served in
    `vite dev` too. The hello-world page is now an agent-callable component: its
    counter exposes `increment` / `reset` as `$action` tools, mirrored into the
    card's `skills`. (A live, callable MCP endpoint still requires running
    `@aihu/server`; the static card is discovery metadata — noted in the config.)

## 0.7.0

### Minor Changes

- [#368](https://github.com/fellwork/aihu/pull/368) [`e237cf3`](https://github.com/fellwork/aihu/commit/e237cf3820180e2e98807af0dbc253eeb9afa2e0) Thanks [@srmcguirt](https://github.com/srmcguirt)! - fix create-aihu / `bun create aihu` public-release blockers

  - **P0 — scaffolded apps now declare `trustedDependencies: ["@aihu/compiler"]`.**
    Without it, `bun install` blocks `@aihu/compiler`'s postinstall (the step
    that arch-validates and downloads the correct native binary), so the
    wrong-arch binary baked into the published tarball stayed in place and
    `bun run build` failed with `ENOEXEC` (`Unknown system error -8`) on
    macOS/Windows. `npm install` was unaffected (npm runs postinstall by
    default); the break was bun-specific — and bun is the flagship path.
  - **Non-interactive / pipe-safe scaffolding.** New flags `--template`,
    `--pm`, `--yes` / `-y`, `--no-git`. When `--yes` is passed or stdin is not a
    TTY, the wizard runs fully non-interactively with documented defaults. This
    fixes the prior behavior where piped input silently created nothing and
    exited 0 (Node `readline.question` losing buffered lines at EOF), and
    unblocks CI/scripted use.
  - **Template selection now actually differentiates output.** `minimal`,
    `full`, and `docs` previously produced byte-identical scaffolds;
    `scaffoldApp` now honors the choice (`full` adds a default layout + a second
    page; `docs` ships a docs-flavored landing + guide page). Every variant
    scaffold → install → build is verified on both bun and npm.

## 0.6.0

### Minor Changes

- [#276](https://github.com/fellwork/aihu/pull/276) [`22234fa`](https://github.com/fellwork/aihu/commit/22234fa1d34e913d84bcdbcc9c2bcf1fb315186b) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Scaffold `@aihu/css-engine` out of the box, with a shadow-mode choice.

  `aihu app <name>` gains two flags on the legacy scaffold path:

  - `--css <engine|none>` (with `--css-engine` as a boolean alias for
    `--css engine`) — includes `@aihu/css-engine` in `dependencies` and emits a
    utility-class starter page (`flex gap-4 max-w-7xl mx-auto p-8`, `text-3xl
font-bold`, …) instead of the hand-written `@style` starter.
  - `--shadow <open|closed|none>` — the shadow mode threaded into the compiler
    when css-engine is on (default `open`). `--shadow` without `--css engine`
    warns and is ignored.

  The `create-aihu` interactive wizard asks the same two questions. The default
  css-engine mode is `open` (scoped shadow fold), which is the compiler default —
  so the default css-engine scaffold writes **no** `css` block; only
  `closed`/`none` emit an explicit `css: { shadowMode }`. The plain (no-flag)
  scaffold output is unchanged.

  `@aihu/app` patch: corrected the `CssConfig` JSDoc — `@aihu/css-engine` is
  scoped by design and works in any shadow mode (its utilities fold into each
  component's shadow style); `shadowMode: 'none'` is only needed for
  global-cascade frameworks (Tailwind/UnoCSS/Pico) or to style light-DOM /
  external (slotted) children. (Wording only; no type or validation change.)

## 0.5.3

### Patch Changes

- [#255](https://github.com/fellwork/aihu/pull/255) [`af25c7c`](https://github.com/fellwork/aihu/commit/af25c7cfa47d29112e4f8a017b59a0432031a32d) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Surface the `--template=cf-team` option in `aihu app` usage text and clarify in `llms-full.txt` that the no-flag `aihu app <name>` is a client-only Vite + router SPA while `--template=cf-team` scaffolds the deployable Cloudflare monorepo (workspaces, wrangler, auth, agent surface).

  Docs-only patch. The underlying scaffolder fix already shipped in `@aihu/cli@0.5.2` (PR [#247](https://github.com/fellwork/aihu/issues/247)); this addresses follow-up discoverability friction reported by users who expected an SPA-first scaffold and weren't aware of the `--template` flag.

## 0.5.2

### Patch Changes

- [#249](https://github.com/fellwork/aihu/pull/249) [`6ed33f8`](https://github.com/fellwork/aihu/commit/6ed33f80bfdf193382e9fb1d192c0c1d4e6ef069) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Default `bunx @aihu/cli app NAME` scaffold switches from rolldown to Vite + `viteAihuPlugin()`. The prior rolldown output was not runnable end-to-end — `createApp()` from `@aihu/app/client` imports `virtual:aihu-routes`, a Vite-plugin virtual module with no rolldown equivalent, so `bun run dev` produced an app that could not route. Mirrors `examples/blog-router`; matches the direction `apps/docs` already moved.

  Also: `index.html` now uses `<div id="outlet">` + `./src/main.ts` (matches `createApp()`'s default mount target — the prior `<demo-root>` custom element threw on boot); `@aihu/router` is now an explicit runtime dependency; the dead `commands/app.ts` divergent Vite scaffold and the unreachable `appRolldownConfig` / `appViteConfig` back-compat alias have been removed.

  Marked as `patch` rather than `minor`: the user-facing contract (`aihu app` command) is functionally additive (it now produces a runnable project instead of a broken one), and the removed JS exports (`appRolldownConfig`, `appViteConfig`) are not depended on by any in-repo consumer. Patch avoids cascading a major bump onto `@aihu/templates-cf-team`'s `^0.5.1` peer range.

## 0.5.1

### Patch Changes

- [#203](https://github.com/fellwork/aihu/pull/203) [`a6f9b53`](https://github.com/fellwork/aihu/commit/a6f9b536620115e0e3bed8551c165d4634aed7f8) Thanks [@srmcguirt](https://github.com/srmcguirt)! - fix(cli-templates): bring all scaffolder grammar to v1 (compiler@0.4.0) so a freshly scaffolded project compiles clean

  Every scaffold path previously emitted stale grammar that the v1 compiler rejects, so each new aihu project started broken:

  - `create-aihu` / `aihu app` (`packages/cli/src/index.ts`): `$on:click={…}` (C305) → `$on.click={…}`; `{{ count }}` → `{count}`.
  - `aihu app` legacy + `APP_INDEX_SCRIBE` (`commands/app.ts`, `templates/app.ts`): bare `$prop name: T = d` → collection-form `$prop: { name: { default, type } }`; `{{ name }}` → `{name}`.
  - `aihu component` (`index.ts`): comment-only `<div>` body ("expected tag name") → a real heading element.
  - `@aihu/templates-cf-team` (`live-counter.aihu`, `expose.aihu`, `app.aihu`): bare `@state` entries → collection-form `$prop`/`$action`; removed `@agent { $expose / $describe }` (C440) → per-entry `expose:` / `describe:` on `@state` macros (the v2 agent surface); `{{ … }}` → `{ … }`.

  Adds a scaffold-AND-compile guard (`scaffold-compile-clean.test.ts`) that scaffolds every path and runs the current `aihu-compile` on each emitted `.aihu`, asserting zero compile errors — the regression class the prior file-presence harness silently passed.

## 0.5.0

### Minor Changes

- [#196](https://github.com/fellwork/aihu/pull/196) [`faca280`](https://github.com/fellwork/aihu/commit/faca2804cf62c05ffc90ef867faa2058b5e267ad) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Wire up the `aihu migrate <files...>` command. The v0→v1 grammar codemod was
  fully implemented but never registered in the CLI entrypoint; it is now
  available and listed in `aihu --help`, which makes the `C304`/`C305`/`C306`
  compiler errors' "Run: npx aihu migrate" guidance accurate. Fixes upstream
  Bug 9c.

## 0.4.0

### Minor Changes

- [#171](https://github.com/fellwork/aihu/pull/171) [`7577bd1`](https://github.com/fellwork/aihu/commit/7577bd10f391b9f3996048371706c9be34b08e2e) Thanks [@srmcguirt](https://github.com/srmcguirt)! - v1.0.9 — Naming Scheme A: rename `@aihu/data` → `@aihu-plugin/data` and
  `@aihu/agent-readiness` → `@aihu-plugin/agent-readiness`.

  The two plugin-contract packages move from the framework-core `@aihu/*`
  scope into the new `@aihu-plugin/*` scope so that plugin-contract and
  framework-core surfaces can evolve at independent cadences. Decision
  record `6c7aa75b-...` (Amendment 04) ratified the scope on 2026-05-09 and
  v1.0.9 §400-416 of the v1 framework plan covers the cutover mechanics.

  **Per-package effect**

  - `@aihu-plugin/data` (new) — first publish at `1.0.0`. Same public API as
    `@aihu/data@0.1.0`; only the npm name changed.
  - `@aihu-plugin/agent-readiness` (new) — first publish at `1.0.0`. Same
    public API as `@aihu/agent-readiness@0.1.1`; only the npm name changed.
  - `@aihu/data@1.0.0` — published as a **moved stub**. The legacy name now
    installs a tiny package that re-exports `@aihu-plugin/data`. Carries
    `"deprecated"` metadata so npm surfaces the move on `npm install`.
  - `@aihu/agent-readiness@1.0.0` — same moved-stub treatment.
  - `@aihu/cli` — extends `aihu migrate` with a v1.0.9 pass that rewrites
    package.json `dependencies` blocks, static imports, dynamic imports, and
    JSDoc / Markdown URL references. Idempotent on already-renamed input.

  **Migration**

  Existing installs keep working via the deprecated stubs. To upgrade:

  ```sh
  bun add @aihu-plugin/data @aihu-plugin/agent-readiness
  bun remove @aihu/data @aihu/agent-readiness
  bunx aihu migrate
  ```

  `@aihu/agent-service` is explicitly **out of scope** for this rename and
  stays under the framework-core `@aihu/*` scope.

## 0.3.6

### Patch Changes

- [#163](https://github.com/fellwork/aihu/pull/163) [`38d3171`](https://github.com/fellwork/aihu/commit/38d3171f33a402fa3be954d2452677f9be026da8) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix mojibake in `package.json` description: `â€"` → `—` (em dash). The
  character was double-encoded somewhere in the original write; npm shows the
  mangled string on the package page. Doc-only.

  (This bump also serves as the verification release for npm OIDC trusted
  publishing — the previous smoke shipped before `NPM_PROVENANCE=1` was in repo
  variables, so its tarball lacks attestations.)

## 0.3.5

### Patch Changes

- [#161](https://github.com/fellwork/aihu/pull/161) [`025e7c7`](https://github.com/fellwork/aihu/commit/025e7c79fd859b5d214db6cbdd5b5dc66642c0b6) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Update `scaffoldApp` JSDoc to list the two `.vscode/` files it now emits.
  Doc-only; no behavior change. (Smoke release for npm OIDC trusted publishing
  - `--provenance`.)

## 0.3.4

### Patch Changes

- [#157](https://github.com/fellwork/aihu/pull/157) [`94425d7`](https://github.com/fellwork/aihu/commit/94425d70e94d07dd8b1401efe0cd0810a2920466) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix two scaffold-output bugs surfaced by the e2e harness:

  - `rolldown.config.ts`: quote the input key so kebab-case app names (`my-app`)
    don't produce a JS parse error. Was emitting `input: { my-app: 'src/main.ts' }`
    which fails at config load with "Expected , or } but found -".
  - `rolldown.config.ts`: import `aihuCompilerPlugin` from `@aihu/compiler` (the
    package's main export) instead of `@aihu/compiler/plugin` — the latter
    subpath doesn't exist in the published `exports` map.

  After this release, `bunx @aihu/cli app <name>` followed by `bun install` and
  `bun run build` succeeds end-to-end against fresh npm.

## 0.3.3

### Patch Changes

- [#153](https://github.com/fellwork/aihu/pull/153) [`f2421b1`](https://github.com/fellwork/aihu/commit/f2421b17a534d518c4f21c22d7f5e47a45c030da) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Scaffold install path fixes.

  `@aihu/cli`:

  - `aihu app <name>` now emits `package.json` with `latest` ranges for all `@aihu/*` deps instead of the aspirational `^1.0.0` (no 1.x exists on npm; the old pins broke `bun install` immediately).
  - Adds the missing `@aihu/app` (used by `src/main.ts`) and `@aihu/compiler` (used by `rolldown.config.ts`) to the generated dependency list.
  - Drops the malformed `bun@1` `packageManager` fallback — detects bun via `globalThis.Bun?.version`, omits the field when no real version is detectable.
  - Generates `.vscode/extensions.json` (recommends `fellwork.vscode-aihu`) and `.vscode/settings.json` (file association for `.aihu`) so new adopters get language support out of the box.

  `@aihu/router`, `@aihu/app`:

  - Republish so transitive pins point at clean versions. Previously `@aihu/router@0.1.1` pinned `@aihu/server@0.1.0` (carries the `workspace:*` leak) and `@aihu/app@0.1.4` peer-pinned `@aihu/router@0.1.0` (also leaked). Combined effect: `bun install` of any scaffolded app failed at the workspace-protocol resolution step. Both republish with deps targeting the post-leak versions.

## 0.3.2

### Patch Changes

- [#150](https://github.com/fellwork/aihu/pull/150) [`4ad09a4`](https://github.com/fellwork/aihu/commit/4ad09a4369bebaf6dffa49dfd726383651f06c0b) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Re-publish `@aihu/cli` without the broken `@aihu/mcp` workspace dependency.

  `@aihu/cli@0.3.1` shipped with `"@aihu/mcp": "workspace:*"` in its published
  manifest. The `workspace:*` protocol is monorepo-internal — outside the workspace
  it cannot resolve, so `bunx @aihu/cli ...` failed at install time with:

  ```
  error: Workspace dependency "@aihu/mcp" not found
  error: @aihu/mcp@workspace:* failed to resolve
  ```

  If you hit this on 0.3.1, pin to the previous good version as a workaround:

  ```
  bunx @aihu/cli@0.3.0 app my-app
  ```

  0.3.2 ships from a clean manifest (no `@aihu/mcp` runtime dep) and the release
  pipeline now publishes via `scripts/publish-all.sh`, which runs `bun publish`
  per-package. `bun publish` rewrites `workspace:*` to a real version range at
  pack time, so the protocol cannot leak into a published artifact again.

  0.3.1 has been deprecated on npm.

## 0.3.0

### Minor Changes

- [#86](https://github.com/fellwork/aihu/pull/86) [`86af1be`](https://github.com/fellwork/aihu/commit/86af1beb2b34cd0dc270fdd9ad8ba1de4d19de90) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Adds the `@aihu/templates-*` family as a separate package family (per arch-6 §13 Q2 RESOLVED). `@aihu/cli` ships the template-manifest contract, scaffold pipeline, conditional-eval evaluator, hand-rolled prompts library, and `KNOWN_TEMPLATES` baked registry. `@aihu/templates-cf-team` is the first published template — Cloudflare Workers + bun workspaces + moon + better-auth (default) | kinde | supabase. Backward-compatible: `aihu app foo` (no flags) produces byte-identical output to today.

### Patch Changes

- [#94](https://github.com/fellwork/aihu/pull/94) [`8e258e7`](https://github.com/fellwork/aihu/commit/8e258e7b12fbb1ad1a1942d42606fc889dc94f25) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Fix `bunx @aihu/cli --template cf-team` on Windows (Node.js runtime path).

  `bunx` resolves the `#!/usr/bin/env node` shebang and runs the CLI under Node.js,
  which cannot dynamically import `.ts` files. `loadTemplateConfig` was silently
  swallowing the import error and throwing a misleading "file not found" message even
  when `template.config.ts` was present on disk.

  - `@aihu/templates-cf-team`: ship compiled `template.config.js` alongside the
    TypeScript source so Node.js falls back to the JS module. Bun still prefers `.ts`.
  - `@aihu/cli`: surface the last import error in the `loadTemplateConfig` throw
    message so future failures are immediately diagnosable.
