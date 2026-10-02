/** Return whether npm already has a platform build for this exact native tree. */
export function shouldReuseCssEnginePlatformVersion(
  currentNativeSource: string,
  publishedNativeSource: string | undefined,
): boolean {
  return (
    currentNativeSource.length > 0 &&
    publishedNativeSource !== undefined &&
    publishedNativeSource.length > 0 &&
    publishedNativeSource === currentNativeSource
  )
}

if (import.meta.main) {
  const [, , currentNativeSource, publishedNativeSource] = process.argv
  if (currentNativeSource === undefined || process.argv.length !== 4) {
    console.error(
      'Usage: bun scripts/css-engine-platform-reuse.ts <current-source> <published-source>',
    )
    process.exit(2)
  }
  const reuse = shouldReuseCssEnginePlatformVersion(currentNativeSource, publishedNativeSource)
  console.log(`CSS_ENGINE_PLATFORM_REUSE=${reuse}`)
}
