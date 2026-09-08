/**
 * B3 (per-route-`<head>` SEO arc) — pure lowering of a route's head metadata
 * into the server's renderable `HeadConfig`.
 *
 * This module is intentionally self-contained and side-effect free so that both
 * B4 (SSG prerender) and B5 (client-nav head updater) can import it. It performs
 * NO I/O, touches NO globals, and produces a plain `HeadConfig` that
 * `buildHead()` / `renderToString` already know how to render.
 *
 * ## Input type
 * The upstream `RouteHead` type is authored by the compiler (B1) and is intended
 * to be re-exported from `@aihu/router` (B2). At the time B3 landed, B2 had not
 * yet exposed that export, so adding a `@aihu/router` devDependency for a
 * type-only import would have introduced a phantom dependency (and broken
 * typecheck). We therefore RESTATE the structural shape here as `RouteHead`.
 * This is the clean option: the mapper stays dependency-free and pure, the
 * structural type is byte-for-byte compatible with the compiler's emitted
 * `.route.json` head object (see the standalone compiler's emitted `RouteHead` shape),
 * and `@aihu/router`'s eventual `RouteHead` is structurally assignable to this
 * one. When B2 lands, callers can pass a router `RouteHead` directly with no
 * change here.
 */

import type { HeadConfig, LinkTag, MetaTag, ScriptTag } from './ssr.ts'

// Re-export the renderable head types so consumers of the pure
// `@aihu/server/head-lowering` subpath (e.g. @aihu/app's browser client) can
// type their lowered configs WITHOUT importing the `@aihu/server` barrel —
// which would drag the native-loader graph into a browser bundle.
export type { HeadConfig, LinkTag, MetaTag, ScriptTag } from './ssr.ts'

/**
 * Per-route head metadata, as emitted by the compiler into `.route.json` and
 * (post-B2) re-exported from `@aihu/router`. Restated structurally here — see
 * the module doc comment for the rationale.
 */
export interface RouteHead {
  readonly title?: string
  readonly description?: string
  readonly canonical?: string
  readonly og?: {
    readonly title?: string
    readonly description?: string
    readonly image?: string
    readonly type?: string
    readonly url?: string
  }
  readonly twitter?: {
    readonly card?: string
    readonly title?: string
    readonly description?: string
    readonly image?: string
    readonly site?: string
  }
  /**
   * JSON-LD structured data. The compiler captures the `@route` `jsonld` block
   * VERBATIM as a raw JSON string, so this is typically a `string`. A
   * pre-parsed object/value is also accepted and will be `JSON.stringify`'d.
   */
  readonly jsonld?: unknown
}

export interface RouteHeadLowerOptions {
  /**
   * Absolute site base URL (e.g. `https://example.com`) used to resolve
   * relative `canonical` / `og.image` / `og.url` values into absolute URLs.
   * Supplied by the wiring Builder (from `AihuConfig.site.url`). When absent,
   * relative values are emitted as-is (documented, non-throwing).
   */
  readonly siteUrl?: string
  /**
   * Global head defaults (typically from `app.head`). Route fields override
   * global per field; `meta`/`links`/`scripts` arrays are key-merged with the
   * route winning on conflicts.
   */
  readonly globalHead?: HeadConfig
}

/**
 * Resolve a possibly-relative URL against `siteUrl`.
 *
 * - Absolute URLs (with a scheme, or protocol-relative `//host`) are returned
 *   untouched.
 * - A relative value with a `siteUrl` is resolved to an absolute URL.
 * - A relative value with NO `siteUrl` is returned unchanged (documented).
 */
function resolveUrl(value: string, siteUrl: string | undefined): string {
  // Already absolute: has a scheme (http:, https:, mailto:, etc.) or is
  // protocol-relative (//cdn.example.com/...). Leave untouched.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) return value
  if (!siteUrl) return value
  try {
    // `URL` is a web standard available in every target runtime (Workers, Deno,
    // Bun, Node ESM) — no node: import needed, keeping this module fully pure.
    return new URL(value, ensureTrailingSlash(siteUrl)).href
  } catch {
    // Malformed siteUrl — fall back to the raw value rather than throwing.
    return value
  }
}

/**
 * Ensure the base has a trailing slash so that `new URL('/about', base)` and
 * `new URL('about', base)` both resolve sensibly against a bare-origin base.
 */
function ensureTrailingSlash(base: string): string {
  return base.endsWith('/') ? base : `${base}/`
}

/** Stable key identifying a meta tag for array key-merging. */
function metaKey(tag: MetaTag): string {
  if (tag.name !== undefined) return `name:${tag.name}`
  if (tag.property !== undefined) return `property:${tag.property}`
  // Fall back to a content-based key for exotic meta (charset, http-equiv).
  if (typeof tag.charset === 'string') return 'charset'
  if (typeof tag['http-equiv'] === 'string') return `http-equiv:${tag['http-equiv']}`
  return `content:${tag.content}`
}

/** Stable key identifying a link tag for array key-merging. */
function linkKey(tag: LinkTag): string {
  // rel alone is the meaningful identity for the tags we emit (canonical, etc.).
  return `rel:${tag.rel}`
}

/**
 * Key-merge two arrays, with `override` entries winning over `base` entries that
 * share a key. Order: base entries first (in original order, replaced in place
 * by their override when present), then any override-only entries appended.
 */
function mergeByKey<T>(
  base: ReadonlyArray<T> | undefined,
  override: ReadonlyArray<T> | undefined,
  keyOf: (t: T) => string,
): ReadonlyArray<T> | undefined {
  if (!base || base.length === 0) return override
  if (!override || override.length === 0) return base
  const overrideByKey = new Map<string, T>()
  for (const o of override) overrideByKey.set(keyOf(o), o)
  const seen = new Set<string>()
  const out: T[] = []
  for (const b of base) {
    const k = keyOf(b)
    if (overrideByKey.has(k)) {
      out.push(overrideByKey.get(k) as T)
      seen.add(k)
    } else {
      out.push(b)
    }
  }
  for (const o of override) {
    const k = keyOf(o)
    if (!seen.has(k)) out.push(o)
  }
  return out
}

/** JSON-LD content is a verbatim string, or a value to be stringified. */
function jsonldToString(jsonld: unknown): string | undefined {
  if (jsonld === undefined || jsonld === null) return undefined
  if (typeof jsonld === 'string') {
    const trimmed = jsonld.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  try {
    return JSON.stringify(jsonld)
  } catch {
    return undefined
  }
}

/**
 * Lower a route's head metadata into a renderable `HeadConfig`, merged with an
 * optional global head.
 *
 * Pure. No I/O, no globals (other than the standard `URL`), no mutation of
 * inputs. Absent fields are omitted from the output.
 *
 * @param head    The route's head metadata (from `.route.json` / `RouteHead`).
 *                When `undefined`, the result is `opts.globalHead` unchanged (or
 *                an empty config) — backward compatible.
 * @param opts    `siteUrl` for absolute-URL resolution and `globalHead` defaults.
 */
export function routeHeadToSsrHead(
  head: RouteHead | undefined,
  opts: RouteHeadLowerOptions = {},
): HeadConfig {
  const { siteUrl, globalHead } = opts

  // No route head → return the global head unchanged (or an empty config).
  if (head === undefined) {
    return globalHead ?? {}
  }

  const meta: MetaTag[] = []
  const links: LinkTag[] = []
  const scripts: ScriptTag[] = []

  // description → <meta name="description">
  if (head.description !== undefined) {
    meta.push({ name: 'description', content: head.description })
  }

  // canonical → <link rel="canonical"> (resolved absolute)
  if (head.canonical !== undefined) {
    links.push({ rel: 'canonical', href: resolveUrl(head.canonical, siteUrl) })
  }

  // og.* → <meta property="og:*"> (image/url resolved absolute)
  const og = head.og
  if (og) {
    if (og.title !== undefined) meta.push({ property: 'og:title', content: og.title })
    if (og.description !== undefined)
      meta.push({ property: 'og:description', content: og.description })
    if (og.image !== undefined)
      meta.push({ property: 'og:image', content: resolveUrl(og.image, siteUrl) })
    if (og.type !== undefined) meta.push({ property: 'og:type', content: og.type })
    if (og.url !== undefined)
      meta.push({ property: 'og:url', content: resolveUrl(og.url, siteUrl) })
  }

  // twitter.* → <meta name="twitter:*">
  const tw = head.twitter
  if (tw) {
    if (tw.card !== undefined) meta.push({ name: 'twitter:card', content: tw.card })
    if (tw.title !== undefined) meta.push({ name: 'twitter:title', content: tw.title })
    if (tw.description !== undefined)
      meta.push({ name: 'twitter:description', content: tw.description })
    if (tw.image !== undefined)
      meta.push({ name: 'twitter:image', content: resolveUrl(tw.image, siteUrl) })
    if (tw.site !== undefined) meta.push({ name: 'twitter:site', content: tw.site })
  }

  // jsonld → <script type="application/ld+json">
  const jsonld = jsonldToString(head.jsonld)
  if (jsonld !== undefined) {
    scripts.push({ type: 'application/ld+json', content: jsonld })
  }

  // The route-derived config (before merge).
  const routeConfig: HeadConfig = {
    ...(head.title !== undefined ? { title: head.title } : {}),
    ...(meta.length > 0 ? { meta } : {}),
    ...(links.length > 0 ? { links } : {}),
    ...(scripts.length > 0 ? { scripts } : {}),
  }

  if (!globalHead) return routeConfig

  // Per-field merge: route wins for scalars; arrays key-merged (route wins on
  // key conflicts). Only include keys that have a value after merge.
  const mergedMeta = mergeByKey(globalHead.meta, routeConfig.meta, metaKey)
  const mergedLinks = mergeByKey(globalHead.links, routeConfig.links, linkKey)
  const mergedScripts = mergeByKey(globalHead.scripts, routeConfig.scripts, (s) => `type:${s.type}`)
  const mergedTitle = routeConfig.title ?? globalHead.title
  const mergedLang = globalHead.lang // lang is not part of RouteHead; preserve global.

  return {
    ...(mergedTitle !== undefined ? { title: mergedTitle } : {}),
    ...(mergedLang !== undefined ? { lang: mergedLang } : {}),
    ...(mergedMeta && mergedMeta.length > 0 ? { meta: mergedMeta } : {}),
    ...(mergedLinks && mergedLinks.length > 0 ? { links: mergedLinks } : {}),
    ...(mergedScripts && mergedScripts.length > 0 ? { scripts: mergedScripts } : {}),
  }
}
