import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/**
 * Resolve the executable that shipped with the published @aihu/compiler
 * package. Consumer checks deliberately use this rather than a binary built
 * from packages/compiler: compiler source now has its own repository and CI.
 */
export function resolvePublishedCompilerBinary(): string {
  const packageName = platformPackage()
  // Resolve from the consumer workspace. This deliberately selects the native
  // platform executable instead of the package's Node bin shim, avoiding one
  // Node/Proto process per compilation in corpus checks.
  const request = `${packageName}/package.json`
  const bun = (
    globalThis as typeof globalThis & {
      Bun?: { resolveSync(specifier: string, from: string): string }
    }
  ).Bun
  const manifest =
    bun !== undefined
      ? bun.resolveSync(request, process.cwd())
      : createRequire(join(process.cwd(), 'package.json')).resolve(request)
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
