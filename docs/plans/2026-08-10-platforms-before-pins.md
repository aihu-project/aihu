# Publish platform packages before the pins that name them

**Status:** implemented for css-engine (2026-10-02); server phase deferred. Founder-approved approach 2026-08-10.
**Fixes, with one change:** the recurring `bun.lock` refresh chore **and** the
consumer-facing yarn install break. Same root cause.

---

## 1. The root cause, stated once

Under lockstep, a release writes a pin naming a version **that does not exist
yet**:

```
changeset version      ->  @aihu/compiler 1.3.0 -> 1.3.1
stamp-platform-versions ->  pins + platform manifests all say 1.3.1
bun install            ->  1.3.1 is unpublished, so bun DROPS all ten
                           optionalDependencies from bun.lock
merge                  ->  main now names versions npm does not have
   ... window ...
tag -> release.yml     ->  platform packages finally publish at 1.3.1
   ... window closes, but bun.lock is now stale in the other direction
```

Everything downstream is a symptom of that one inversion:

| symptom | who it hurts | observed |
|---|---|---|
| `bun.lock` missing entries, then stale once they publish | every PR — `main` goes red on `--frozen-lockfile` | #783 (v0.4.62), #794 (v0.4.64) |
| yarn hard-fails on an unresolvable `optionalDependency` | **consumers** running `npm create aihu` | #791: scaffold matrix 6/20 cells failed |
| release half-publishes | the release itself | v0.4.62 |

Phase 0 (#786) fixed the third by moving the frozen check off the racing path.
It did not, and could not, fix the first two — those need the *ordering* fixed.

**Do not automate the lockfile refresh.** It treats the symptom that hurts us
and leaves the one that hurts users. A post-release bot that opens a
`bun.lock` PR would have shipped every yarn break this session unnoticed.

---

## 2. The change

**Publish the platform packages at version N before anything on `main` pins
version N.**

Then the pin is written against a version that already exists: bun keeps the
entries, `bun.lock` never goes stale, and yarn never sees a dangling optional
dependency. One inversion removed, three symptoms gone.

### 2.1 The obstacle, measured

`release-pr.yml` builds **zero** binaries (verified: no `cargo build`, no napi
build, no matrix). Every platform-publish job in `release.yml` `needs:` a build
job — `publish-native` needs `build-native`, `publish-compiler-napi` needs
`build-compiler-napi`, and so on. The binaries only exist behind a `v*` tag.

So this is a **two-phase release**, not a workflow tweak. That is the real cost
and it should be stated plainly before anyone starts.

### 2.2 Shape: `workflow_call`, not a second top-level workflow

Extract the build + platform-publish jobs into `release-platforms.yml` with
`on: workflow_call`, invoked from two places:

1. **`release-pr.yml`**, after `release:version` computes the new version and
   `stamp-platform-versions.ts` writes it — publish the platform packages at
   that version, *then* run `bun install` so the lock resolves them, *then*
   commit. The Version PR now lands with a complete lockfile and pins that
   already resolve.
2. **`release.yml`**, unchanged in behaviour — its `npm view` skip makes the
   second call a no-op for anything phase 1 already published.

`workflow_call` rather than a separate top-level workflow, for the reason the
release plan already documents: `release.yml`'s `release` job downloads **all**
run artifacts with no `name:` filter, and `actions/download-artifact` is
run-scoped. Moving builds into a different run silently drops ten GitHub
Release assets, and the `staged >= artifact_dirs` assert would still pass
because it counts what it downloaded, not what it expected.

### 2.3 The honest downside

**Abandoning a Version PR leaves orphan platform versions on npm.** If the
Version PR is closed unmerged, `@aihu/compiler-darwin-arm64@1.3.1` exists while
`@aihu/compiler@1.3.1` never ships.

Assessed as acceptable: nothing resolves a platform package except through a
host pin, so an orphan is unreferenced and inert — the same state every
`0.1.48`–`0.1.53` platform version is in today, published by hand and never
pinned. It costs registry noise, not correctness. Worth stating in
`docs/RELEASING.md` so it is a known property rather than a surprise.

The alternative — publish only on merge — reintroduces the window it exists to
remove.

### 2.4 Cost

Version PRs become expensive: the full binary matrix on every changeset batch,
not once per release. Mitigations, in order:

1. **Only build when the platform version actually moves.** Most Version PRs
   touch no native source. Gate the `workflow_call` on the stamp having
   changed a platform manifest — cheap to detect, and it makes the common
   Version PR exactly as fast as today.
2. Reuse the existing per-target caches; the builds are already cached.

---

## 3. Verification

The failure modes here are all silent, so each needs a positive check:

- **`bun.lock` keeps the entries.** After the Version PR's `release:version`,
  assert the ten platform entries are present. Today they are dropped, so this
  assertion fails on the current pipeline — write it first and watch it fail.
- **Pins resolve at merge time.** `check-pins-published.ts --strict` on the
  Version PR branch. It should be green there, which it never is today.
- **The yarn cell recovers without a release.** Dispatch `scaffold-matrix` with
  `pm=yarn` against the merged Version PR *before* tagging. Under today's
  pipeline that is 5/5 red; under this change it must be 5/5 green. **This is
  the acceptance test** — it is the consumer-visible symptom.
- **No `bun.lock` PR is needed after the release.** Frozen install on `main`
  immediately post-release, which is the exact thing that failed twice.
- **Release assets still number 25.** Guards against the `download-artifact`
  run-scoping trap in § 2.2.

---

## 4. Sequencing

1. Land the `bun.lock`-keeps-entries assertion **first**, red, so the fix has a
   failing test to turn green.
2. Extract `release-platforms.yml` (`workflow_call`), invoked only from
   `release.yml`. Pure refactor — prove the asset count and publish behaviour
   are unchanged on a real release.
3. Add the `release-pr.yml` invocation with the "platform version moved" gate.
4. Exercise on one real release. Confirm all five checks in § 3.
5. **Only then** Phase 1b (css-engine + server lockstep). Doing 1b first
   triples the pin families that can trigger the symptoms this removes.

---

## 5. Relationship to the other open items

- **Phase 1b is blocked on this**, deliberately. It also still needs a
  `target/release` fallback for `packages/server/src/native.ts`, which unlike
  the compiler and css-engine loaders has none and fails loud with
  `AIHU_NATIVE_MISSING`.
- **The yarn-support question dissolves.** It only mattered because the window
  existed; with the ordering fixed there is nothing for yarn to be strict
  about, and no policy decision is required.
