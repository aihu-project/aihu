import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Regression for the silent-hang class of bug (2026-08-07):
//
// An `apps/docs` vite build sat 10 minutes at 0.0% CPU. Sampling both sides
// showed the child `aihu-css-compile --ast-json` parked in read() waiting for
// an EOF on stdin that never arrived, while the parent sat in
// node::SyncProcessRunner -> uv_run -> uv__io_poll -> kevent, still holding
// that pipe's write end. With no `timeout`, spawnSync's private uv loop has no
// timer armed and calls kevent with no deadline — so it waits forever (two
// `aihu-compile --stdin` children were found still alive after 2.5 days).
//
// Input now comes from a positional temp-file argument, avoiding the stalled
// stdin write path. `timeout` and `maxBuffer` still bound compiler execution
// and output. These tests pin the bounds and file handoff.
//
// The fake binary stands in for the wedged child: it is switched by env vars
// that execFileSync passes through, because `resolveBinary()` memoizes the
// resolved path and one test file therefore only ever gets one binary.

const tmp = mkdtempSync(join(tmpdir(), 'aihu-css-bounds-'))
const fakeBin = join(tmp, 'fake-aihu-css-compile')

// Set BEFORE importing src/index.ts: resolveBinary() reads
// AIHU_CSS_COMPILE_BIN once and caches the result.
writeFileSync(
  fakeBin,
  [
    '#!/bin/sh',
    '# Compiler input is supplied as a file argument, never stdin.',
    'if [ -n "$FAKE_HANG" ]; then sleep 600; exit 0; fi',
    'if [ -n "$FAKE_FAIL" ]; then echo "fake compile failure" >&2; exit 7; fi',
    'if [ -n "$FAKE_ECHO_INPUT" ]; then cat "$1"; exit 0; fi',
    'if [ -n "$FAKE_BYTES" ]; then',
    "  head -c \"$FAKE_BYTES\" /dev/zero | tr '\\000' 'a'",
    '  exit 0',
    'fi',
    'echo ok',
  ].join('\n'),
)
chmodSync(fakeBin, 0o755)
process.env.AIHU_CSS_COMPILE_BIN = fakeBin

const { compile } = await import('../src/index.ts')

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
  delete process.env.AIHU_CSS_COMPILE_BIN
})

describe('@aihu/css-engine — runBinary is bounded', () => {
  describe('timeout', () => {
    beforeAll(() => {
      process.env.AIHU_CSS_COMPILE_TIMEOUT_MS = '1200'
      process.env.FAKE_HANG = '1'
    })
    afterAll(() => {
      // `process.env.X = undefined` stores the STRING "undefined" — which is
      // still truthy to the fake binary's `[ -n ]` test and still a non-empty
      // value to compileTimeoutMs(). Must actually delete.
      delete process.env.FAKE_HANG
      delete process.env.AIHU_CSS_COMPILE_TIMEOUT_MS
    })

    it('kills a child that never exits, instead of hanging forever', () => {
      const startedAt = Date.now()
      // Without `timeout` this call never returns and the test would die on
      // vitest's own timeout with no idea which binary was at fault.
      expect(() => compile(['bg-primary', 'p-4'])).toThrow(/TIMED OUT after 1200 ms/)
      // Bounded in real time, not just eventually.
      expect(Date.now() - startedAt).toBeLessThan(10_000)
    })

    it('names the binary, the args, the payload size and the elapsed time', () => {
      let message = ''
      try {
        compile(['bg-primary', 'p-4'])
      } catch (err) {
        message = (err as Error).message
      }
      expect(message).toContain(fakeBin)
      expect(message).toContain('args:')
      // 'bg-primary\np-4' — the exact payload byte count, so a reader can tell a
      // pathological payload from a wedged child.
      expect(message).toContain('input:    14 bytes from temporary file')
      expect(message).toMatch(/elapsed:\s+\d+ ms/)
      // And what to do next.
      expect(message).toContain('AIHU_CSS_COMPILE_TIMEOUT_MS')
      expect(message).toContain('cargo build --release -p aihu-css-core')
    })
  })

  describe('maxBuffer', () => {
    afterAll(() => {
      delete process.env.FAKE_BYTES
    })

    it('accepts output larger than node’s inherited 1 MiB default', () => {
      // Node's default maxBuffer is 1024 * 1024. Without the explicit cap this
      // 2 MiB stylesheet dies with an opaque `spawnSync ... ENOBUFS`.
      process.env.FAKE_BYTES = String(2 * 1024 * 1024)
      const out = compile(['bg-primary'])
      expect(out.length).toBeGreaterThan(1024 * 1024)
    })
  })

  describe('file input and diagnostics', () => {
    afterAll(() => {
      delete process.env.FAKE_ECHO_INPUT
      delete process.env.FAKE_FAIL
    })

    it('passes the complete payload through the CLI file argument', () => {
      process.env.FAKE_ECHO_INPUT = '1'
      expect(compile(['bg-primary', 'p-4'])).toBe('bg-primary\np-4')
    })

    it('includes the component path when CSS compilation fails', async () => {
      process.env.FAKE_FAIL = '1'
      const { compileSfc } = await import('../src/index.ts')
      expect(() => compileSfc('@template { <div /> }', 'src/components/Fail.aihu')).toThrow(
        /fake compile failure[\s\S]*component: src\/components\/Fail\.aihu/,
      )
    })
  })
})
