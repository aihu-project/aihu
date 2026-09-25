/**
 * Config validation combinators.
 *
 * Ported from SvelteKit's `packages/kit/src/core/config/options.js`, which is
 * the best-in-class implementation of this and is ~30 lines at its core. The
 * properties worth having, none of which we had before:
 *
 *   1. **Unknown keys throw, with a keypath and a targeted "did you mean".**
 *      `AihuConfigError`'s `UNKNOWN_FIELD` code was declared and never thrown;
 *      a typo'd key was silently ignored. That matters much more now that
 *      `aihu.config.ts` is scaffolded into every project and advertised as THE
 *      customization surface — a silently-dropped field reads as a broken
 *      feature.
 *
 *   2. **Key ownership derives from the schema**, not a hand-maintained list.
 *      `Object.keys(SCHEMA)` is the set of fields aihu owns; nothing can drift.
 *
 *   3. **A machine-readable deprecation lifecycle.** We are pre-1.0 with fields
 *      marked "RESERVED for v2" and "accepted but ignored" in prose only.
 *      `deprecated()` warns and passes through; `removed()` throws.
 *
 * Deliberate deviation from SvelteKit: their validators double as
 * default-appliers, so `validate({}, 'config')` returns a fully-defaulted
 * object. Ours **validate only and return the caller's object unchanged**.
 * `defineConfig` has always been an identity function and several call sites
 * rely on that (`viteAihuPlugin` reads `config?.dir?.pages ?? 'pages'` and
 * friends, applying its own defaults at point of use). Making defineConfig
 * start returning a different object is a behaviour change that belongs in its
 * own PR, not smuggled in with validation.
 *
 * Unknown keys THROW rather than warn. Next.js chose warn for its zod schema
 * and it visibly cost them — users learned to ignore the banner and at least
 * one popular config composer shipped broken because a warning wasn't loud
 * enough to stop it. We are pre-1.0; throw.
 */

import { AihuConfigError } from './config-error.ts'

/** Base URL for config documentation, appended to every error message. */
const DOCS = 'https://aihu.dev/docs/config'

/**
 * A validator: given a value and its keypath, throw if invalid.
 * Returns nothing — see the module comment on why we do not apply defaults.
 */
export type Validator = (value: unknown, keypath: string) => void

/** Build the `See <docs>` suffix for a keypath's error message. */
function seeDocs(anchor?: string): string {
  return ` See ${DOCS}${anchor ? `#${anchor}` : ''}`
}

function fail(message: string, code: AihuConfigError['code'], field: string): never {
  throw new AihuConfigError(message, code, field)
}

/**
 * Validate an object's known children and REJECT unknown keys.
 *
 * `suggest` maps an unknown key to a hint. This is where SvelteKit's
 * `(did you mean config.X?)` lives, and it earns its keep: it targets the
 * mistake users actually make rather than listing every legal key.
 */
export function object(
  children: Record<string, Validator>,
  suggest?: (key: string) => string | undefined,
): Validator {
  return (value, keypath) => {
    if (value === undefined) return
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      fail(`${keypath} should be an object.${seeDocs()}`, 'INVALID_TYPE', keypath)
    }
    for (const key of Object.keys(value as object)) {
      if (!(key in children)) {
        const hint = suggest?.(key)
        fail(
          `Unexpected option ${keypath}.${key}${hint ? ` (did you mean ${hint}?)` : ''}.${seeDocs()}`,
          'UNKNOWN_FIELD',
          `${keypath}.${key}`,
        )
      }
    }
    for (const key of Object.keys(children)) {
      children[key]?.((value as Record<string, unknown>)[key], `${keypath}.${key}`)
    }
  }
}

/** Accept any object shape — for passthrough fields whose keys we do not own. */
export const passthrough: Validator = (value, keypath) => {
  if (value === undefined) return
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${keypath} should be an object, if specified.${seeDocs()}`, 'INVALID_TYPE', keypath)
  }
}

/** Accept anything, including functions and class instances. */
export const anything: Validator = () => {}

export const string: Validator = (value, keypath) => {
  if (value === undefined) return
  if (typeof value !== 'string') {
    fail(`${keypath} should be a string, if specified.${seeDocs()}`, 'INVALID_TYPE', keypath)
  }
}

export const boolean: Validator = (value, keypath) => {
  if (value === undefined) return
  if (typeof value !== 'boolean') {
    fail(`${keypath} should be true or false, if specified.${seeDocs()}`, 'INVALID_TYPE', keypath)
  }
}

export const number: Validator = (value, keypath) => {
  if (value === undefined) return
  if (typeof value !== 'number' || Number.isNaN(value)) {
    fail(`${keypath} should be a number, if specified.${seeDocs()}`, 'INVALID_TYPE', keypath)
  }
}

export const array: Validator = (value, keypath) => {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    fail(`${keypath} should be an array, if specified.${seeDocs()}`, 'INVALID_TYPE', keypath)
  }
}

/**
 * One of a fixed set. Phrasing follows SvelteKit's: two options read
 * `either "a" or "b"`, three or more read `one of "a", "b" or "c"`.
 */
export function list(options: ReadonlyArray<string>, code: AihuConfigError['code']): Validator {
  return (value, keypath) => {
    if (value === undefined) return
    if (typeof value !== 'string' || !options.includes(value)) {
      const quoted = options.map((o) => `"${o}"`)
      const rendered =
        quoted.length === 2
          ? `either ${quoted[0]} or ${quoted[1]}`
          : `one of ${quoted.slice(0, -1).join(', ')} or ${quoted[quoted.length - 1]}`
      fail(
        `${keypath} should be ${rendered}, if specified (received ${JSON.stringify(value)}).${seeDocs()}`,
        code,
        keypath,
      )
    }
  }
}

/**
 * A string matching `re`, described by `shape` when it does not.
 *
 * `re` must be anchored and must not be `/g` — this calls `.test` on a shared
 * instance, and a global regex carries `lastIndex` between calls.
 */
export function pattern(re: RegExp, shape: string): Validator {
  return (value, keypath) => {
    if (value === undefined) return
    if (typeof value !== 'string') {
      fail(`${keypath} should be a string, if specified.${seeDocs()}`, 'INVALID_TYPE', keypath)
    }
    if (!re.test(value)) {
      fail(
        `${keypath} should be ${shape} (received ${JSON.stringify(value)}).${seeDocs()}`,
        'INVALID_TYPE',
        keypath,
      )
    }
  }
}

/** Allow `false` as a whole-block disable, else defer to `inner`. */
export function orFalse(inner: Validator): Validator {
  return (value, keypath) => {
    if (value === false) return
    inner(value, keypath)
  }
}

/**
 * Warn that a field is going away, then validate it normally.
 *
 * Emits at most once per key per process — a config is typically validated
 * several times in one build (dev server restart, prerender's second server),
 * and repeating the warning trains people to ignore it.
 */
const warned = new Set<string>()
export function deprecated(inner: Validator, message: (keypath: string) => string): Validator {
  return (value, keypath) => {
    if (value !== undefined && !warned.has(keypath)) {
      warned.add(keypath)
      console.warn(`[aihu] ${message(keypath)}`)
    }
    inner(value, keypath)
  }
}

/**
 * A field that is declared for typing but has NO consumer yet.
 *
 * This exists because the alternative is worse. `ui.style` is declared,
 * documented, and read by nothing — and once `aihu.config.ts` ships to every
 * scaffolded project, a field that silently does nothing is indistinguishable
 * from a broken feature. Warning at least tells the truth at the moment the
 * user sets it. (`router.viewTransitions` used to be the other example here;
 * it is wired now — see `createApp`'s `routeContext`.)
 */
export function notYetImplemented(inner: Validator, tracking: string): Validator {
  return deprecated(
    inner,
    (keypath) =>
      `${keypath} is declared but not yet wired up — setting it currently has no effect (${tracking}).`,
  )
}

/** Throw for a field that has been removed. */
export function removed(message: (keypath: string) => string): Validator {
  return (value, keypath) => {
    if (value !== undefined) fail(message(keypath), 'REMOVED_FIELD', keypath)
  }
}

/** Reset the deprecation-warning memo. Test-only. @internal */
export function __resetWarningsForTesting(): void {
  warned.clear()
}
