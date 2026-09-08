/** Return the declaration target paired with a JavaScript export target. */
export function pairedDeclarationTarget(
  target: string,
  targets: ReadonlySet<string>,
): string | undefined {
  if (!target.endsWith('.js')) return undefined
  const declaration = target.replace(/\.js$/, '.d.ts')
  return targets.has(declaration) ? declaration : undefined
}
