import { describe, expect, it } from 'vitest'
import { compileSfc } from '../src/index.ts'

describe('@aihu/css-engine — compileSfc end-to-end (AST → scoped CSS)', () => {
  it('compiles a real .aihu SFC to scoped CSS for its static + macro classes', () => {
    // Form A static utilities + a Form C macro toggle whose class IS a real
    // utility (`rounded-lg`). The macro toggle's class is statically known.
    const source = `@template {
  <button class="bg-primary p-4" class:rounded-lg={busy}>Go</button>
}`
    const css = compileSfc(source, 'Button.aihu')

    // Static utilities resolved (Form A).
    expect(css).toContain('bg-primary')
    expect(css).toContain('background-color: var(--color-primary, #1a1d24)')
    expect(css).toContain('p-4')
    expect(css).toContain('padding: 1rem')

    // Macro toggle class resolved (Form C: class:rounded-lg → "rounded-lg").
    expect(css).toContain('rounded-lg')
    expect(css).toContain('border-radius: 0.5rem')

    // Default tokens ride along as var() fallbacks, never a :host block, so an
    // app theme inherited from the document wins inside the shadow root (#836).
    expect(css).not.toContain(':host {')
    expect(css).not.toContain('--color-primary:')
  })

  it('emits @theme tokens at :root instead of :host when compiled with a lightScopeId (LDF §10 step 2)', () => {
    const source = `@style {
  @theme { --color-primary: red; }
}
@template {
  <button class="bg-primary text-accent p-4">Go</button>
}`
    const css = compileSfc(source, 'Button.aihu', 'a1b2c3d4')
    expect(css).toContain('background-color: var(--color-primary)')
    expect(css).toContain(':root {\n  --color-primary: red;\n}')
    expect(css).toContain('color: var(--color-accent, #c8543a)')
    expect(css).not.toContain('--color-accent:')
    expect(css).not.toContain(':host {')
  })

  it('tree-shakes unreferenced brand tokens — no color utility means no token block at all', () => {
    const source = `@template {
  <div class="flex p-4"><span>hi</span></div>
}`
    const css = compileSfc(source, 'Plain.aihu')
    expect(css).not.toContain(':host {')
    expect(css).not.toContain('--color-primary')
  })

  it('defers (does not drop) reactive class bindings — extracts literals, flags identifiers', () => {
    // Form B: class={cn('shadow-md', size)} → the string literal 'shadow-md'
    // is a real utility and IS compiled; `size` is a runtime identifier that
    // must NOT be compiled (and must not crash the pipeline).
    const source = `@template {
  <span class="text-accent" class={cn('shadow-md', size)}>x</span>
}`
    const css = compileSfc(source, 'Tag.aihu')
    // Static class from Form A.
    expect(css).toContain('text-accent')
    expect(css).toContain('color: var(--color-accent, #c8543a)')
    // String literal inside the binding compiled (deferred binding, not dropped).
    expect(css).toContain('shadow-md')
    expect(css).toContain('box-shadow')
    // `size` is a runtime identifier, not a utility — must not appear as a rule.
    expect(css).not.toContain('.size {')
    expect(css).not.toContain('size {')
  })

  it('emits a host: variant as a :host rule', () => {
    const source = `@template { <div class="host:bg-primary">x</div> }`
    const css = compileSfc(source, 'Host.aihu')
    expect(css).toContain(':host(')
    expect(css).toContain('background-color: var(--color-primary, #1a1d24)')
  })

  it('emits a hover: variant as a :hover rule', () => {
    const source = `@template { <button class="hover:bg-accent">x</button> }`
    const css = compileSfc(source, 'Hover.aihu')
    expect(css).toContain(':hover')
    expect(css).toContain('background-color: var(--color-accent, #c8543a)')
  })

  it('registers an @theme token that a utility then references', () => {
    const source = `@style {
  @theme { --color-primary: oklch(0.55 0.18 28); }
}
@template { <div class="bg-primary">x</div> }`
    const css = compileSfc(source, 'Themed.aihu')
    expect(css).toContain('--color-primary: oklch(0.55 0.18 28)')
    expect(css).toContain('background-color: var(--color-primary)')
    expect(css).not.toContain('@theme') // directive consumed, not emitted raw
  })

  // R-RESULT: a binary emit error (non-zero exit) surfaces as a thrown Error
  // carrying the stderr message, not an opaque status failure.
  it('throws with the engine error message when emit hard-errors', () => {
    // `@theme` with no `{` body → CompileError::MalformedTheme in the binary.
    const source = `@style {
  @theme --color-primary: red;
}
@template { <div class="bg-primary">x</div> }`
    expect(() => compileSfc(source, 'Broken.aihu')).toThrow(/malformed @theme/)
  })
})
