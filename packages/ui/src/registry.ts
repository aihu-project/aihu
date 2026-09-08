/**
 * Public registry contract for `@aihu/ui`.
 *
 * The registry is source-distributed, but its catalog types are a public
 * integration surface for tools such as `@aihu/cli`. Keep consumers on this
 * subpath instead of reaching into the package's source tree.
 */
export type {
  Registry,
  RegistryFile,
  RegistryItem,
  RegistryItemType,
  VariantMap,
} from './schema.ts'
