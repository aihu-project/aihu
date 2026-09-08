import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/**
 * Resolve the executable that shipped with the published @aihu/compiler
 * package. Consumer checks deliberately use this rather than a binary built
 * from an in-tree compiler checkout: compiler source now has its own
 * repository and CI.
 */
export function resolvePublishedCompilerBinary(): string {
  const packageName = platformPackage()
  // Resolve from the consumer workspace. This deliberately selects the native
  // platform executable instead of the package's Node bin shim, avoiding one
  // Node/Proto process per compilation in corpus checks.
  const request = `${packageName}/package.json`
  const compilerManifest = join(process.cwd(), 'node_modules/@aihu/compiler/package.json')
  // Optional native packages are installed beside the published compiler
  // package. Resolve from that manifest so a consumer workspace does not need
  // to duplicate every platform package as a root dependency.
  let manifest: string
  try {
    manifest = createRequire(join(dirname(dirname(compilerManifest)), 'package.json')).resolve(
      request,
    )
  } catch {
    // Bun keeps optional platform packages beside the real package directory
    // in its content-addressed store; Node's resolver can miss that sibling
    // when the workspace link is traversed. Resolve the package's real scope
    // and address the platform manifest directly as a portable fallback.
    const scope = dirname(dirname(realpathSync(compilerManifest)))
    manifest = join(scope, packageName.slice('@aihu/'.length), 'package.json')
    if (!existsSync(manifest)) throw new Error(`Cannot resolve ${request}`)
  }
  const executable = join(
    dirname(manifest),
    process.platform === 'win32' ? 'aihu-compile.exe' : 'aihu-compile',
  )

  if (!existsSync(executable)) {
    throw new Error(
      `Published @aihu/compiler is installed but its executable is missing at ${executable}. ` +
        'Reinstall dependencies so the matching platform package is present.',
    )
  }

  return executable
}

function platformPackage(): string {
  switch (`${process.platform}-${process.arch}`) {
    case 'darwin-arm64':
      return '@aihu/compiler-darwin-arm64'
    case 'darwin-x64':
      return '@aihu/compiler-darwin-x64'
    case 'linux-arm64':
      return '@aihu/compiler-linux-arm64-gnu'
    case 'linux-x64':
      return '@aihu/compiler-linux-x64-gnu'
    case 'win32-x64':
      return '@aihu/compiler-win32-x64-msvc'
    default:
      throw new Error(
        `@aihu/compiler does not publish a binary for ${process.platform}-${process.arch}.`,
      )
  }
}
