# Releasing @aihu/compiler

The Rust `aihu-compile` binary ships pre-built via GitHub Releases. Consumers
do not need a Rust toolchain — `bun add @aihu/compiler` triggers the
postinstall hook in `js/postinstall.ts`, which downloads the binary that
matches their platform and arch.

## Tagging a release

1. `git tag v0.1.0`  (or appropriate semver)
2. `git push origin v0.1.0`
3. The `release.yml` workflow triggers automatically. It cross-compiles for
   mac-arm64, mac-x64, linux-x64, windows-x64 and creates a GitHub Release
   with all four binaries attached.
4. Once the release is live, `bun add @aihu/compiler` will trigger
   the postinstall hook, which downloads the matching binary.

## Dry run (no tag)

```bash
gh workflow run release.yml --field tag=v0.0.0-dryrun
```

This builds all 4 binaries as workflow artifacts but does NOT create a
GitHub Release. Useful for verifying matrix changes — the `release` job
only runs when the workflow is triggered by an actual `refs/tags/v*` push.

## Local development bypass

If you build from source, set `AIHU_COMPILE_BIN`:

```bash
export AIHU_COMPILE_BIN=$(pwd)/packages/compiler/target/release/aihu-compile
bun install
```

The postinstall hook copies that path to `packages/compiler/bin/aihu-compile`
instead of downloading. On Windows, point at the `.exe`:

```powershell
$env:AIHU_COMPILE_BIN = "$pwd\packages\compiler\target\release\aihu-compile.exe"
bun install
```

## Verifying a published binary

After a release lands:

```bash
curl -L -O https://github.com/aihu-project/aihu/releases/latest/download/aihu-compile-linux-x64
chmod +x aihu-compile-linux-x64
./aihu-compile-linux-x64 --help
```

## Asset naming

| Target           | Runner       | Rust target                  | Asset name                          |
| ---------------- | ------------ | ---------------------------- | ----------------------------------- |
| mac-arm64        | macos-14     | aarch64-apple-darwin         | aihu-compile-darwin-arm64         |
| mac-x64          | macos-13     | x86_64-apple-darwin          | aihu-compile-darwin-x64           |
| linux-x64        | ubuntu-22.04 | x86_64-unknown-linux-gnu     | aihu-compile-linux-x64            |
| windows-x64      | windows-2022 | x86_64-pc-windows-msvc       | aihu-compile-windows-x64.exe      |

## Failure modes

The postinstall script exits with code 1 (and a clear stderr message naming
the URL it attempted) on any of:

- Unsupported platform/arch combo
- Network error fetching the asset
- Non-2xx HTTP response from GitHub
- Empty download
- `AIHU_COMPILE_BIN` set to a path that does not exist

Silent failure is forbidden — a missing binary at install time becomes an
obvious failure during `bun add`, not a confusing error during `vite build`.

## Future work

- SHA256 sidecar verification (TODO in `js/postinstall.ts`). The release
  workflow should publish a `<asset>.sha256` next to each binary and the
  postinstall script should verify the digest before placing the binary
  on disk.
- npm-style `optionalDependencies` per-platform packages (current approach
  trades a slightly worse offline story for a much simpler release matrix).
