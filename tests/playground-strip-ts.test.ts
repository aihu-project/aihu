/**
 * Verification test for Issue #554:
 * Compiles all playground presets and cookbook recipes with the compiler,
 * passes the output through `stripTs`, and asserts the resulting JS parses cleanly.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PRESETS } from '../apps/docs/playground/presets.ts'
import { stripTs } from '../apps/docs/playground/strip-ts.ts'
import { resolvePublishedCompilerBinary } from '../scripts/lib/compiler-binary.ts'

const REPO_ROOT = resolve(__dirname, '..')
const COMPILER = process.env.AIHU_COMPILE_BIN ?? resolvePublishedCompilerBinary()

describe('Issue #554 — Playground stripTs preview correctness', () => {
  it('every playground preset compiles and stripTs output parses without SyntaxError', () => {
    for (const preset of PRESETS) {
      const out = execFileSync(
        COMPILER,
        ['--stdin', '--tag', preset.id, '--path', `${preset.id}.aihu`, '--target', 'client'],
        {
          input: preset.source,
          encoding: 'utf8',
        },
      )
      const stripped = stripTs(out)
      // Assert that stripped code parses as valid JavaScript without throwing a SyntaxError.
      expect(() => {
        new Function(`
          var _a = { branch: () => {}, leaf: () => {}, signal: () => ({}), computed: () => ({}), defineComponent: () => {}, defineElement: () => {}, _setMount: () => {}, _setSignal: () => {}, registerAgentMetadata: () => {}, _registerAgentServerBinding: () => {}, contextKey: () => {}, provide: () => {}, inject: () => {} };
          var branch=_a.branch,leaf=_a.leaf,mount=_a.mount,slot=_a.slot,when=_a.when,each=_a.each;
          var signal=_a.signal,computed=_a.computed,effect=_a.effect,batch=_a.batch;
          var defineComponent=_a.defineComponent,defineElement=_a.defineElement;
          var _setMount=_a._setMount,_setSignal=_a._setSignal;
          var registerAgentMetadata=_a.registerAgentMetadata,_registerAgentServerBinding=_a._registerAgentServerBinding;
          var contextKey=_a.contextKey,provide=_a.provide,inject=_a.inject;
          ${stripped}
        `)
      }, `Preset "${preset.id}" stripped JS failed to parse`).not.toThrow()
    }
  })

  it('every cookbook recipe compiles and stripTs output parses cleanly', () => {
    const cookbookDir = resolve(REPO_ROOT, 'cookbook')
    if (!existsSync(cookbookDir)) return
    const files = readdirSync(cookbookDir).filter((f) => f.endsWith('.aihu'))
    for (const file of files) {
      const content = readFileSync(resolve(cookbookDir, file), 'utf8')
      const tag = file.replace(/\.aihu$/, '')
      const out = execFileSync(
        COMPILER,
        ['--stdin', '--tag', tag, '--path', file, '--target', 'client'],
        {
          input: content,
          encoding: 'utf8',
        },
      )
      const stripped = stripTs(out)
      expect(() => {
        new Function(`
          var _a = { branch: () => {}, leaf: () => {}, signal: () => ({}), computed: () => ({}), defineComponent: () => {}, defineElement: () => {}, _setMount: () => {}, _setSignal: () => {}, registerAgentMetadata: () => {}, _registerAgentServerBinding: () => {}, contextKey: () => {}, provide: () => {}, inject: () => {} };
          var branch=_a.branch,leaf=_a.leaf,mount=_a.mount,slot=_a.slot,when=_a.when,each=_a.each;
          var signal=_a.signal,computed=_a.computed,effect=_a.effect,batch=_a.batch;
          var defineComponent=_a.defineComponent,defineElement=_a.defineElement;
          var _setMount=_a._setMount,_setSignal=_a._setSignal;
          var registerAgentMetadata=_a.registerAgentMetadata,_registerAgentServerBinding=_a._registerAgentServerBinding;
          var contextKey=_a.contextKey,provide=_a.provide,inject=_a.inject;
          ${stripped}
        `)
      }, `Cookbook recipe "${file}" stripped JS failed to parse`).not.toThrow()
    }
  })
})
