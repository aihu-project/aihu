/**
 * Regression suite for a CodeQL js/polynomial-redos alert surfaced against
 * `applyHeadToHtml` (`packages/app/src/head-apply.ts`) during a full-diff
 * release review — not part of the earlier ReDoS hardening pass in this same
 * effort, which touched the standalone compiler plugin and
 * `packages/router/src/{server,vite-plugin}.ts` but never this file.
 *
 * Two things matter, same as the compiler/router passes:
 *  1. Behaviour preservation — the rewritten title/canonical-link matchers
 *     must find and replace exactly what the original combined regexes did.
 *  2. The fix itself — an adversarial `index.html` (the string these scan is
 *     the BUILD's own template, attacker-reachable the same way `.aihu`
 *     source is elsewhere in this repo, since `applyHeadToHtml` runs at
 *     prerender/build time against an untrusted PR's own committed files)
 *     must resolve well inside budget where the old regexes did not.
 */

import type { HeadConfig } from '@aihu/server/head-lowering'
import { describe, expect, it } from 'vitest'
import { applyHeadToHtml } from '../src/head-apply.ts'

function elapsed(fn: () => unknown): number {
  const t0 = performance.now()
  fn()
  return performance.now() - t0
}

const BUDGET_MS = 250
const PUMP_N = 20_000

describe('applyHeadToHtml — title tag replace/inject, behaviour preserved', () => {
  it('replaces an existing <title>...</title>', () => {
    const html = '<html><head><title>Old</title></head><body></body></html>'
    const out = applyHeadToHtml(html, { title: 'New' } as HeadConfig)
    expect(out).toContain('<title>New</title>')
    expect(out).not.toContain('Old')
  })

  it('replaces a <title> carrying attributes', () => {
    const html = '<html><head><title data-x="y">Old</title></head></html>'
    const out = applyHeadToHtml(html, { title: 'New' } as HeadConfig)
    expect(out).toContain('<title>New</title>')
  })

  it('replaces a multi-line <title>', () => {
    const html = '<html><head><title>\n  Old\n</title></head></html>'
    const out = applyHeadToHtml(html, { title: 'New' } as HeadConfig)
    expect(out).toContain('<title>New</title>')
  })

  it('is case-insensitive on the tag name', () => {
    const html = '<html><head><TITLE>Old</TITLE></head></html>'
    const out = applyHeadToHtml(html, { title: 'New' } as HeadConfig)
    expect(out).toContain('<title>New</title>')
  })

  it('injects a title when none exists', () => {
    const html = '<html><head></head><body></body></html>'
    const out = applyHeadToHtml(html, { title: 'New' } as HeadConfig)
    expect(out).toContain('<title>New</title>')
  })

  it('does not touch the html when title is undefined', () => {
    const html = '<html><head><title>Keep</title></head></html>'
    const out = applyHeadToHtml(html, {} as HeadConfig)
    expect(out).toBe(html)
  })

  it('leaves an unclosed <title with no matching </title> as an injection, not a replace', () => {
    const html = '<html><head><title>Unclosed</head></html>'
    const out = applyHeadToHtml(html, { title: 'New' } as HeadConfig)
    // No real </title> to anchor a replace on, so the new tag is injected
    // before </head> and the malformed original is left in place untouched.
    expect(out).toContain('<title>New</title>')
    expect(out).toContain('<title>Unclosed')
  })
})

describe('applyHeadToHtml — canonical link replace/inject, behaviour preserved', () => {
  it('replaces an existing rel="canonical" link', () => {
    const html = '<html><head><link rel="canonical" href="/old"></head></html>'
    const out = applyHeadToHtml(html, {
      links: [{ rel: 'canonical', href: '/new' }],
    } as HeadConfig)
    expect(out).toContain('href="/new"')
    expect(out).not.toContain('/old')
  })

  it('is case-insensitive on rel="canonical"', () => {
    const html = '<html><head><link REL="canonical" href="/old"></head></html>'
    const out = applyHeadToHtml(html, {
      links: [{ rel: 'canonical', href: '/new' }],
    } as HeadConfig)
    expect(out).toContain('href="/new"')
  })

  it('matches on the literal substring, same as the original regex (not true attribute parsing)', () => {
    // Both the original combined regex and this rewrite look for the literal
    // text `rel="canonical"` anywhere between `<link` and `>` — neither
    // parses real attribute boundaries. Confirmed independently: the ORIGINAL
    // /<link\s+[^>]*rel="canonical"[^>]*>/i also matches this tag. Preserving
    // that quirk exactly is correct for a ReDoS-only fix; changing it would be
    // a separate, unrelated behavior change.
    const html =
      '<html><head><link rel="stylesheet" data-note=\'rel="canonical" mentioned here\'></head></html>'
    const out = applyHeadToHtml(html, {
      links: [{ rel: 'canonical', href: '/new' }],
    } as HeadConfig)
    expect(out).toContain('href="/new"')
    expect(out).not.toContain('data-note')
  })

  it('injects a canonical link when none exists', () => {
    const html = '<html><head></head><body></body></html>'
    const out = applyHeadToHtml(html, {
      links: [{ rel: 'canonical', href: '/new' }],
    } as HeadConfig)
    expect(out).toContain('rel="canonical"')
    expect(out).toContain('href="/new"')
  })

  it('injects a non-canonical link unconditionally, never scanning for it', () => {
    const html = '<html><head></head></html>'
    const out = applyHeadToHtml(html, {
      links: [{ rel: 'stylesheet', href: '/a.css' }],
    } as HeadConfig)
    expect(out).toContain('rel="stylesheet"')
  })
})

describe('redos — applyHeadToHtml stays linear on adversarial index.html input', () => {
  it('title: many <title occurrences each already closed resolve well inside budget', () => {
    const html = `<html><head>${'<title>'.repeat(PUMP_N)}</head></html>`
    expect(elapsed(() => applyHeadToHtml(html, { title: 'New' } as HeadConfig))).toBeLessThan(
      BUDGET_MS,
    )
  })

  it('title: many <title occurrences with NO > anywhere resolve well inside budget', () => {
    // The genuinely adversarial shape for the open-tag half specifically. A
    // first fix split the combined regex into an open-tag `/<title[^>]*>/i`
    // exec followed by a separate `</title>` search — that closed the
    // lazy-suffix half, but CodeQL correctly re-flagged the open-tag half on
    // its own: with no `>` ANYWHERE, `.exec` (no `g` flag) still retries at
    // every `<title` occurrence, each retry rescanning the remainder.
    // Confirmed by direct timing before this second fix: 11ms/61ms/237ms at
    // 2k/5k/10k occurrences — quadratic. The PUMP_N=20_000-with-`>` case
    // above never exercised this path at all (every occurrence resolves on
    // the very first `<title`, `>` included).
    const html = `${'<title '.repeat(PUMP_N)}X`
    expect(elapsed(() => applyHeadToHtml(html, { title: 'New' } as HeadConfig))).toBeLessThan(
      BUDGET_MS,
    )
  })

  it('canonical link: many repeated, never-closed "<link rel=canonical" prefixes resolve well inside budget', () => {
    // The genuinely worst case for the old combined regex — confirmed by
    // direct timing before this fix: n=1000 took ~2.4s, n=2000 took ~22.9s
    // (worse than quadratic). Many occurrences of the full literal prefix,
    // with NO `>` anywhere, forces the old pattern to retry matching from
    // every occurrence before concluding failure.
    const html = `${'<link rel="canonical"'.repeat(PUMP_N)}X`
    expect(
      elapsed(() =>
        applyHeadToHtml(html, { links: [{ rel: 'canonical', href: '/new' }] } as HeadConfig),
      ),
    ).toBeLessThan(BUDGET_MS)
  })
})
