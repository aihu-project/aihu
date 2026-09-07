#!/usr/bin/env bun
/**
 * Wave-3 SSR string fast path — walker vs compiled-string microbench.
 *
 * Three shapes, per the keystone brief:
 *   1. small     — static-heavy card (~20 nodes, few holes)
 *   2. list      — list-heavy (~200 nodes across a keyed each)
 *   3. mixed     — a mixed page producing ~50KB of HTML
 *
 * Method: compile each fixture with the REAL binary (`--target server`),
 * import the artifact, then time `renderToString(walker-wrapped __ssr)` vs
 * `__ssrString` over N iterations after warmup. Every iteration re-runs the
 * component setup (fresh signals) in BOTH engines, so the delta isolates
 * tree-build + tree-walk vs string concatenation. Byte-identity is asserted
 * before timing — a bench over diverging output would be meaningless.
 *
 * Run:  bun bench/ssr-string/bench.ts
 * (requires target/release/aihu-compile — `cargo build --release -p aihu-compiler`)
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
process.env.AIHU_COMPILE_BIN ??= join(repoRoot, 'target/release/aihu-compile')

const { transform } = await import(`${repoRoot}/packages/compiler/js/index.ts`)
const { renderToString } = await import(`${repoRoot}/packages/server/src/ssr.ts`)

const SCRATCH = join(__dirname, '.scratch')

const small = `@state {
  const [user, setUser] = signal('Ada')
  const [n, setN] = signal(4)
}

@template {
  <article class="card">
    <header><h2>Welcome back, {user}</h2></header>
    <p class="sub">You have {n} unread notes.</p>
    <footer>
      <a href="/inbox" class="cta">Open inbox</a>
      <span class="fine">All caught up otherwise.</span>
    </footer>
  </article>
}
`

const list = `@state {
  const mkRow = (k) => { const r = { id: 'row-' + k, label: 'Item ' + k, active: k % 3 === 0 }; return r }
  const [rows, setRows] = signal(Array.from({ length: 200 }, (_, k) => mkRow(k)))
}

@template {
  <ul class="grid">
    <li each={r of rows()} key={r.id} class={r.active ? 'on' : 'off'} data-id={r.id}>{r.label}</li>
  </ul>
}
`

const mixed = `@state {
  const mkItem = (s, k) => { const it = { id: s + '.' + k, text: 'Paragraph body text for entry ' + k + ' in section ' + s + ' — enough prose to make the page realistic.' }; return it }
  const mkSection = (s) => { const sec = { id: 's' + s, title: 'Section ' + s, open: s % 2 === 0, items: Array.from({ length: 25 }, (_, k) => mkItem(s, k)) }; return sec }
  const [sections, setSections] = signal(Array.from({ length: 40 }, (_, s) => mkSection(s)))
  const [query, setQuery] = signal('')
}

@template {
  <main class="doc">
    <header><h1>Long mixed page</h1><input bind:value={query} placeholder="filter"></header>
    <section each={sec of sections()} key={sec.id} class="sec">
      <h2 id={sec.id}>{sec.title}</h2>
      <div if={sec.open}>
        <p each={it of sec.items} key={it.id} class="entry">{it.text}</p>
      </div>
      <p else class="closed">collapsed</p>
    </section>
  </main>
}
`

interface Mod {
  __ssr: () => unknown
  __ssrString: (p?: Record<string, unknown>, o?: { hydratable?: boolean }) => string
}

async function compile(name: string, source: string): Promise<Mod> {
  const { code } = transform(source, `src/pages/${name}.aihu`, { target: 'server' })
  mkdirSync(SCRATCH, { recursive: true })
  const file = join(SCRATCH, `${name}.ts`)
  writeFileSync(
    file,
    code
      .replaceAll("'@aihu/runtime/ssr'", `'${repoRoot}/packages/runtime/src/ssr-string.ts'`)
      .replaceAll("'@aihu/runtime'", `'${repoRoot}/packages/runtime/src/index.ts'`)
      .replaceAll("'@aihu/router'", `'${repoRoot}/packages/router/src/index.ts'`),
  )
  return (await import(file)) as unknown as Mod
}

function stats(samples: number[]): { median: number; p95: number } {
  const s = [...samples].sort((a, b) => a - b)
  return { median: s[Math.floor(s.length / 2)], p95: s[Math.floor(s.length * 0.95)] }
}

async function bench(name: string, source: string, iters: number) {
  const mod = await compile(name, source)
  const walker = () => renderToString(() => mod.__ssr(), { hydratable: true })
  const fast = () => mod.__ssrString({}, { hydratable: true })

  const w0 = await walker()
  const f0 = fast()
  if (w0 !== f0) throw new Error(`${name}: DIVERGENT OUTPUT — bench aborted`)
  const bytes = w0.length

  // Warmup
  for (let i = 0; i < Math.min(200, iters); i++) {
    await walker()
    fast()
  }

  const wSamples: number[] = []
  const fSamples: number[] = []
  const batch = 10
  for (let i = 0; i < iters / batch; i++) {
    let t = performance.now()
    for (let j = 0; j < batch; j++) await walker()
    wSamples.push((performance.now() - t) / batch)
    t = performance.now()
    for (let j = 0; j < batch; j++) fast()
    fSamples.push((performance.now() - t) / batch)
  }

  const gcAndHeap = () => {
    // @ts-expect-error Bun.gc exists under bun
    if (typeof Bun !== 'undefined' && Bun.gc) Bun.gc(true)
    return process.memoryUsage().heapUsed
  }
  // Allocation proxy: heap growth across 1k renders without intervening GC.
  const allocOf = async (fn: () => unknown, n: number) => {
    const before = gcAndHeap()
    for (let i = 0; i < n; i++) await fn()
    const after = process.memoryUsage().heapUsed
    return (after - before) / n
  }
  // Small N so a GC pause inside the window is unlikely — this is a heap
  // PROXY (in-process, no --expose-gc); treat sign noise as "unmeasurable".
  const allocN = 25
  const wAlloc = await allocOf(walker, allocN)
  const fAlloc = await allocOf(fast, allocN)

  const w = stats(wSamples)
  const f = stats(fSamples)
  const speedup = w.median / f.median
  console.log(
    `${name.padEnd(8)} ${String(bytes).padStart(7)}B  ` +
      `walker ${(w.median * 1000).toFixed(1)}µs/op (p95 ${(w.p95 * 1000).toFixed(1)})  ` +
      `string ${(f.median * 1000).toFixed(1)}µs/op (p95 ${(f.p95 * 1000).toFixed(1)})  ` +
      `speedup ${speedup.toFixed(1)}x  ` +
      `alloc ${(wAlloc / 1024).toFixed(1)}KB → ${(fAlloc / 1024).toFixed(1)}KB/op`,
  )
}

console.log('SSR walker vs compiled string renderer (hydratable output)')
await bench('small', small, 5000)
await bench('list', list, 2000)
await bench('mixed', mixed, 500)
rmSync(SCRATCH, { recursive: true, force: true })
