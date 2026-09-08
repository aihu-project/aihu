#!/usr/bin/env bash
# publish-all.sh — publish all @aihu/* packages to npm in dependency order.
# Run from the aihu workspace root.
#
# Strategy: `bun pm pack` rewrites `workspace:*` deps to real version ranges
# at pack time, then `npm publish <tarball>` uploads using npm's auth. This
# split sidesteps `bun publish` failing to read the ${NODE_AUTH_TOKEN}
# placeholder that actions/setup-node writes into ~/.npmrc — npm resolves
# that placeholder; bun does not.
#
# Prereqs:
#   1. npm login  (or NODE_AUTH_TOKEN env in CI via setup-node)
#   2. bun install
#   3. moon run :build  (or scripts/build-data-compiler.sh for missing pkgs)
#
# Usage:
#   ./scripts/publish-all.sh                        # live publish to `latest`
#   ./scripts/publish-all.sh --dry-run              # dry-run (no network write)
#   ./scripts/publish-all.sh --tag canary           # live publish to `canary` dist-tag
#   ./scripts/publish-all.sh --dry-run --tag canary # canary dry-run (pack + validate only)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Refresh bun.lock to match current package.json versions BEFORE packing.
# changesets/action bumps package.json files in the Release-PR but does not
# update bun.lock — so without this step, `bun pm pack` rewrites workspace:*
# peer deps using stale lock-resolved versions and bakes old version pins
# into the published artifact (observed: @aihu/app@0.1.5 shipped with
# `@aihu/router: 0.1.1` peer despite local router being at 0.1.2).
(cd "$ROOT" && bun install --ignore-scripts >/dev/null 2>&1)

# Topological order: dependencies before dependents.
#
# v1.0.9 (Naming Scheme A) note:
#   - `plugin-data` and `plugin-agent-readiness` are the new homes of the two
#     plugin-contract packages (now published as `@aihu-plugin/data` and
#     `@aihu-plugin/agent-readiness`).
#   - `_moved/data` and `_moved/agent-readiness` are the moved-stub packages
#     that still publish under the legacy `@aihu/data` / `@aihu/agent-readiness`
#     names at v1.0.0 with a single dependency on the new home; they MUST be
#     listed AFTER their new-home counterparts so the dep ref resolves at
#     publish time.
PKGS=(
  "use"                # @aihu/use — SSR-safe composables; peer-deps @aihu/signals
  "runtime"
  "agent"
  "plugin-agent-readiness"
  "agent-service"
  "agent-server"       # @aihu/agent-server — capability bridge (createAgentServer); depends on @aihu/agent + @aihu/agent-service + @aihu/arbor (must follow them). Powers `create-aihu --template agent`.
  "agent-a2a"
  "agent-acp"
  "auth"              # depends on agent-service + signals
  "scraping"          # leaf — middleware for agent services
  "mcp"               # leaf — MCP server, only external sdk dep
  "ai"                # leaf — peer deps only on external sdks
  "context"
  "store"              # @aihu/store — depends on @aihu/signals + @aihu/context (must follow them). Public + changeset-versioned but was missing from this manifest, so it never reached npm.
  "plugin-data"
  "plugin"
  "router"
  "server"
  "adapter-cloudflare"
  "adapter-vercel"
  "app"
  "seo"               # @aihu/seo SSR/meta helpers; depends on @aihu/plugin + @aihu/server + @aihu-plugin/agent-readiness (must follow them)
  "cli"
  "create-aihu"       # `npm create aihu` entry point; thin delegator — depends on @aihu/cli (must follow it)
  "templates/cf-team" # @aihu/templates-cf-team — RESTORED (#717 fixed FEL-431: cf-team
                       # can now dev/build/typecheck across all 4 package managers).
                       # Unset `private` alongside restoring this entry — see
                       # docs/lessons for the removal history.
  "css-engine"        # build-time CSS engine; consumes the published compiler
  "primitives"        # headless UI primitives; depends on css-engine + signals + arbor (must follow them)
  "ui"                # @aihu/ui styled-recipe registry; aihu add resolves it from npm (must follow primitives)
  "language-server"   # @aihu/language-server LSP; consumes the published compiler
  "tsc"               # @aihu/tsc — `aihu-tsc`; consumes the published compiler
  "plugin-drizzle"    # @aihu-plugin/drizzle; depends on @aihu/server + @aihu-plugin/data (must follow them)
  "plugin-kindly-note" # @aihu-plugin/kindly-note; depends on @aihu/signals (must follow it)
  "editor"             # @aihu/editor — depends on @aihu/signals only (must follow it). Public +
                       # changeset-versioned (reached 0.1.1) but was missing from this manifest,
                       # so it never reached npm — same silent gap that hit ui/seo/store.
  "magna"              # @aihu/magna — depends on @aihu/signals + @aihu/plugin + @aihu/context +
                       # @aihu-plugin/data (must follow them all). Same gap: reached 0.2.4 unpublished.
                       # Its unpublished @aihu/magna-gqlmin addon is dynamically loaded when consumers
                       # opt in; it must not be a manifest dependency because Yarn rejects its absence.
  "_moved/data"
  "_moved/agent-readiness"
)

# Args: --dry-run (no network write) and --tag <dist-tag> (default `latest`),
# in any order. The canary release path (release.yml workflow_dispatch with
# canary=true) publishes snapshot versions with `--tag canary` so the `latest`
# dist-tag — and therefore every plain `npm install @aihu/*` — is unaffected.
DRY_RUN=""
DIST_TAG="latest"
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN="--dry-run"; shift ;;
    --tag)
      [ $# -ge 2 ] || { echo "✗ --tag requires a value (e.g. --tag canary)" >&2; exit 1; }
      DIST_TAG="$2"; shift 2 ;;
    *) echo "✗ unknown argument: $1 (expected --dry-run and/or --tag <dist-tag>)" >&2; exit 1 ;;
  esac
done

NPM_FLAGS="--access public --tag $DIST_TAG"
[ "$DRY_RUN" = "--dry-run" ] && NPM_FLAGS="$NPM_FLAGS --dry-run"
echo "dist-tag: $DIST_TAG${DRY_RUN:+  (dry-run — no network write)}"

# Provenance allowlist — pass --provenance only for packages whose npmjs.com
# trusted-publisher config is in place. Setting NPM_PROVENANCE=1 enables it
# for ALL packages (use once every package's OIDC config is done).
# NPM_PROVENANCE_PKGS is a comma-separated list of short names (e.g.
# "signals,arbor,runtime"). Grow it tier-by-tier as you finish npmjs.com config.
PROVENANCE_PKGS=",${NPM_PROVENANCE_PKGS:-},"
PROVENANCE_ALL="${NPM_PROVENANCE:-}"

# Packages skipped for want of a publishable payload. Collected rather than
# fatal-on-first so one bad package does not hide the rest, then asserted at
# the end — a skip must never leave the job green.
FAILED_PKGS=""

for pkg in "${PKGS[@]}"; do
  PKG_DIR="$ROOT/packages/$pkg"
  # Resolve the real package name once for logging + idempotency checks.
  PKG_NAME="$(node -p "require('$PKG_DIR/package.json').name")"
  PKG_VERSION="$(node -p "require('$PKG_DIR/package.json').version")"

  # Guard: refuse to publish a package whose payload was never built.
  #
  # Most packages produce dist/index.js via rolldown; the moved-stub packages
  # ship a root-level index.js (no dist); @aihu/ui is SOURCE-distributed
  # (registry.json + .aihu recipe sources, no build); create-aihu ships a
  # single committed bin.mjs (no build).
  #
  # Those four hardcoded layouts are not exhaustive, and a package that
  # matches none of them is SKIPPED WITH THE JOB STILL GREEN — the same silent
  # class of failure that kept ui/seo/store/editor/magna off npm. So also
  # accept any package whose declared `main` entry exists on disk, which is
  # the condition npm itself cares about. @aihu/templates-cf-team is pure
  # content (template/ + template.config.js, nothing to build) and matches
  # ONLY via this check.
  PKG_MAIN="$(node -p "require('$PKG_DIR/package.json').main || ''" 2>/dev/null || echo '')"
  MAIN_PRESENT=0
  if [ -n "$PKG_MAIN" ] && [ -f "$PKG_DIR/$PKG_MAIN" ]; then MAIN_PRESENT=1; fi

  if [ ! -d "$PKG_DIR/dist" ] && [ ! -f "$PKG_DIR/index.js" ] && [ ! -f "$PKG_DIR/registry.json" ] && [ ! -f "$PKG_DIR/bin.mjs" ] && [ "$MAIN_PRESENT" = "0" ]; then
    echo "✗ ${PKG_NAME}: no publishable payload." >&2
    echo "  Looked for: dist/, index.js, registry.json, bin.mjs${PKG_MAIN:+, and main ($PKG_MAIN)}." >&2
    echo "  Run 'moon run :build' — or, if this package has nothing to build," >&2
    echo "  make sure its \"main\" points at a file that exists." >&2
    FAILED_PKGS="${FAILED_PKGS}${PKG_NAME} "
    continue
  fi
  echo ""
  echo "▶  publishing ${PKG_NAME}@${PKG_VERSION} → dist-tag ${DIST_TAG}${DRY_RUN:+ [dry-run]} ..."

  # Safety: a 0.0.0-* snapshot version must NEVER land on the `latest` dist-tag
  # — that would make every plain `npm install @aihu/*` resolve the canary.
  case "$PKG_VERSION" in
    0.0.0-*)
      if [ "$DIST_TAG" = "latest" ]; then
        echo "✗ ${PKG_NAME}@${PKG_VERSION} is a snapshot version but dist-tag is 'latest'." >&2
        echo "  Pass --tag canary (snapshot versions may not be published as latest)." >&2
        exit 1
      fi
      ;;
  esac

  # Idempotency: skip if the version already exists on npm. Mirrors the
  # publish-native pattern in release.yml so workflow re-runs are safe.
  if [ "$DRY_RUN" != "--dry-run" ]; then
    EXISTING=$(npm view "${PKG_NAME}@${PKG_VERSION}" version 2>/dev/null || true)
    if [ -n "$EXISTING" ]; then
      echo "↷  ${PKG_NAME}@${PKG_VERSION} already published — skipping"
      continue
    fi
  fi

  # Per-package provenance opt-in: pass --provenance only when the package
  # is in the allowlist (or NPM_PROVENANCE=1 is set globally). Skipping the
  # flag for unconfigured packages keeps mid-rollout publishes from failing.
  PROVENANCE_FLAG=""
  if [ "$PROVENANCE_ALL" = "1" ] || [[ "$PROVENANCE_PKGS" == *",$pkg,"* ]]; then
    PROVENANCE_FLAG="--provenance"
    echo "   (with --provenance via OIDC trusted publisher)"
  fi

  # create-aihu is a thin delegator that spawns @aihu/cli at runtime, so its
  # published @aihu/cli pin MUST resolve a cli that carries this release. We do
  # NOT trust `bun pm pack`'s workspace:* rewrite here: it reads bun.lock, which
  # the changesets Version-PR bumps package.json WITHOUT updating — so the pack
  # froze a stale exact pin (create-aihu@0.1.1 shipped `@aihu/cli: 0.7.0` while
  # cli was already at 0.8.0, leaving `npx create-aihu@latest --template agent`
  # pointing at a cli with no agent template). Stamp the pin explicitly from the
  # live cli package version as a caret so the delegator tracks cli patches.
  if [ "$pkg" = "create-aihu" ]; then
    CLI_VERSION="$(node -p "require('$ROOT/packages/cli/package.json').version")"
    node -e "const fs=require('fs');const f='$PKG_DIR/package.json';const p=require(f);p.dependencies['@aihu/cli']='^$CLI_VERSION';fs.writeFileSync(f, JSON.stringify(p, null, 2) + '\n')"
    echo "   stamped @aihu/cli => ^$CLI_VERSION (delegator pin)"
  fi

  # A package with an explicit npm range (rather than workspace:*) must not
  # be published until that range resolves in the registry. This makes the
  # compiler release a hard prerequisite for dependents that declare it, even
  # when they are shipped from a separate repository.
  node "$ROOT/scripts/verify-registry-dependencies.mjs" "$PKG_DIR"

  # bun pm pack rewrites workspace:* → real version range; npm publish
  # then uploads the tarball using npm's auth (which works in CI).
  PACK_DIR="$(mktemp -d)"
  (cd "$PKG_DIR" && bun pm pack --ignore-scripts --destination "$PACK_DIR" >/dev/null)
  TARBALL="$(ls "$PACK_DIR"/*.tgz | head -1)"
  npm publish "$TARBALL" $NPM_FLAGS $PROVENANCE_FLAG
  rm -rf "$PACK_DIR"
  echo "✔  ${PKG_NAME}@${PKG_VERSION} published"
done

if [ -n "$FAILED_PKGS" ]; then
  echo "" >&2
  echo "✗ Release incomplete — these packages had no publishable payload and were NOT published:" >&2
  for p in $FAILED_PKGS; do echo "    $p" >&2; done
  echo "" >&2
  echo "  Failing the job deliberately. Historically this was a warning and the" >&2
  echo "  release stayed green, so the only symptom was a 404 on npm days later." >&2
  echo "  Everything published above is already live; the publish step is" >&2
  echo "  idempotent, so fixing these and re-running the tag publishes only the" >&2
  echo "  missing packages." >&2
  exit 1
fi

echo ""
echo "Done. Verify at: https://www.npmjs.com/search?q=%40aihu"
