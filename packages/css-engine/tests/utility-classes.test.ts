import { describe, expect, it } from 'vitest'
import { compileSfc } from '../src/index.ts'

// Round 1 (tailwind-support): one case per new utility family, asserting the
// public-API CSS output contains the expected declarations. Drives the same
// `compileSfc` path the production bridge uses, so a green case proves the
// class actually emits — not just that the Rust unit test passed.
describe('@aihu/css-engine — new utility families (Round 1)', () => {
  it('space-y-* emits the nested sibling-margin recipe', () => {
    const css = compileSfc(`@template { <ul class="space-y-4">x</ul> }`, 'Space.aihu')
    expect(css).toContain('space-y-4')
    expect(css).toContain('margin-block-start: 1rem')
  })

  it('space-x-* emits margin-inline-start on siblings', () => {
    const css = compileSfc(`@template { <div class="space-x-2">x</div> }`, 'SpaceX.aihu')
    expect(css).toContain('margin-inline-start: 0.5rem')
  })

  it('mx-auto resolves to margin-inline: auto', () => {
    const css = compileSfc(`@template { <div class="mx-auto">x</div> }`, 'Center.aihu')
    expect(css).toContain('mx-auto')
    expect(css).toContain('margin-inline: auto')
  })

  it('max-w-* named scale resolves (max-w-7xl → 80rem)', () => {
    const css = compileSfc(`@template { <div class="max-w-7xl">x</div> }`, 'MaxW.aihu')
    expect(css).toContain('max-w-7xl')
    expect(css).toContain('max-width: 80rem')
  })

  it('grid-cols-N emits a repeat() template', () => {
    const css = compileSfc(`@template { <div class="grid grid-cols-3">x</div> }`, 'Grid.aihu')
    expect(css).toContain('grid-cols-3')
    expect(css).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))')
  })

  it('col-span-N emits a grid-column span', () => {
    const css = compileSfc(`@template { <div class="col-span-2">x</div> }`, 'Span.aihu')
    expect(css).toContain('grid-column: span 2 / span 2')
  })

  it('border-{n} emits the matching border-width', () => {
    const css = compileSfc(`@template { <div class="border-2">x</div> }`, 'Border.aihu')
    expect(css).toContain('border-2')
    expect(css).toContain('border-width: 2px')
  })

  it('directional border-{n} emits the side-specific width', () => {
    const css = compileSfc(`@template { <div class="border-t-4">x</div> }`, 'BorderT.aihu')
    expect(css).toContain('border-top-width: 4px')
  })
})

// Round 2 (tailwind-support): divide-x / divide-y sibling borders. Reuse the
// proven `space-*` nested `& > * + *` recipe, so a green case proves the
// nested-rule shape survives the public compileSfc emission path end-to-end.
describe('@aihu/css-engine — divide-x / divide-y (Round 2)', () => {
  it('divide-y-* emits the nested sibling border-block-width', () => {
    const css = compileSfc(`@template { <ul class="divide-y-2">x</ul> }`, 'Divide.aihu')
    expect(css).toContain('divide-y-2')
    expect(css).toContain('border-block-width: 2px')
  })

  it('divide-x-* emits border-inline-width on siblings', () => {
    const css = compileSfc(`@template { <div class="divide-x-4">x</div> }`, 'DivideX.aihu')
    expect(css).toContain('border-inline-width: 4px')
  })

  it('bare divide-y defaults to 1px', () => {
    const css = compileSfc(`@template { <div class="divide-y">x</div> }`, 'DivideBare.aihu')
    expect(css).toContain('border-block-width: 1px')
  })

  it('divide-x-reverse sets the reverse custom property', () => {
    const css = compileSfc(`@template { <div class="divide-x-reverse">x</div> }`, 'DivideRev.aihu')
    expect(css).toContain('--tw-divide-x-reverse: 1')
  })
})

// Round 2 (tailwind-support — named scales): position scale
// (top/right/bottom/left/inset[-x|-y] + auto + negatives) and the named
// typography scales (leading-*, tracking-*). One case per family asserting the
// public-API emitted CSS.
describe('@aihu/css-engine — named scales (Round 2)', () => {
  it('top-<n> resolves to the spacing scale', () => {
    const css = compileSfc(`@template { <div class="absolute top-4 right-4">x</div> }`, 'Pos.aihu')
    expect(css).toContain('top-4')
    expect(css).toContain('top: 1rem')
    expect(css).toContain('right: 1rem')
  })

  it('inset-0 emits inset: 0 and inset-x/-y the logical shorthands', () => {
    expect(compileSfc(`@template { <div class="inset-0">x</div> }`, 'Inset.aihu')).toContain(
      'inset: 0',
    )
    expect(compileSfc(`@template { <div class="inset-x-2">x</div> }`, 'InsetX.aihu')).toContain(
      'inset-inline: 0.5rem',
    )
    expect(compileSfc(`@template { <div class="inset-y-4">x</div> }`, 'InsetY.aihu')).toContain(
      'inset-block: 1rem',
    )
  })

  it('negative position (-left-2) emits a negative offset', () => {
    const css = compileSfc(`@template { <div class="-left-2">x</div> }`, 'NegLeft.aihu')
    expect(css).toContain('left: -0.5rem')
  })

  it('top-auto emits top: auto', () => {
    const css = compileSfc(`@template { <div class="top-auto">x</div> }`, 'TopAuto.aihu')
    expect(css).toContain('top: auto')
  })

  it('leading-* named scale resolves (leading-relaxed → 1.625)', () => {
    const css = compileSfc(`@template { <p class="leading-relaxed">x</p> }`, 'Lead.aihu')
    expect(css).toContain('leading-relaxed')
    expect(css).toContain('line-height: 1.625')
  })

  it('leading-tight / leading-none resolve to unitless multipliers', () => {
    expect(compileSfc(`@template { <p class="leading-tight">x</p> }`, 'Lt.aihu')).toContain(
      'line-height: 1.25',
    )
    expect(compileSfc(`@template { <p class="leading-none">x</p> }`, 'Ln.aihu')).toContain(
      'line-height: 1',
    )
  })

  it('tracking-* named scale resolves (tracking-wide → 0.025em)', () => {
    const css = compileSfc(`@template { <h1 class="tracking-wide">x</h1> }`, 'Track.aihu')
    expect(css).toContain('tracking-wide')
    expect(css).toContain('letter-spacing: 0.025em')
  })

  it('tracking-tighter / tracking-widest resolve to the em extremes', () => {
    expect(compileSfc(`@template { <h1 class="tracking-tighter">x</h1> }`, 'Tt.aihu')).toContain(
      'letter-spacing: -0.05em',
    )
    expect(compileSfc(`@template { <h1 class="tracking-widest">x</h1> }`, 'Tw.aihu')).toContain(
      'letter-spacing: 0.1em',
    )
  })

  it('regression: arbitrary forms still work (arbitrary_prop untouched)', () => {
    expect(compileSfc(`@template { <div class="top-[3px]">x</div> }`, 'ArbTop.aihu')).toContain(
      'top: 3px',
    )
    expect(compileSfc(`@template { <p class="leading-[2]">x</p> }`, 'ArbLead.aihu')).toContain(
      'line-height: 2',
    )
  })
})

// Round 2 (tailwind-support): ring widths + ring-offset. `ring-{n}` emits the
// Tailwind v4 box-shadow ring composed from `--tw-ring-*` custom props;
// `ring-offset-{n}` sets `--tw-ring-offset-width`. A combined `ring-2
// ring-blue-500` case proves the WIDTH and COLOR sides coexist on one element.
describe('@aihu/css-engine — ring widths + offset (Round 2)', () => {
  it('ring-{n} emits the box-shadow ring from --tw-ring-* props', () => {
    const css = compileSfc(`@template { <div class="ring-2 ring-blue-500">x</div> }`, 'Ring.aihu')
    expect(css).toContain('ring-2')
    // The composed ring shadow at the requested width.
    expect(css).toContain('calc(2px + var(--tw-ring-offset-width))')
    expect(css).toContain('box-shadow: var(--tw-ring-offset-shadow), var(--tw-ring-shadow)')
    // Regression: the color side still emits --tw-ring-color on the same render.
    expect(css).toContain('--tw-ring-color: var(--color-blue-500, oklch(')
  })

  it('bare ring is the 3px default', () => {
    const css = compileSfc(`@template { <div class="ring">x</div> }`, 'RingDefault.aihu')
    expect(css).toContain('calc(3px + var(--tw-ring-offset-width))')
  })

  it('ring-offset-{n} sets --tw-ring-offset-width', () => {
    const css = compileSfc(`@template { <div class="ring-offset-2">x</div> }`, 'RingOffset.aihu')
    expect(css).toContain('--tw-ring-offset-width: 2px')
  })

  it('ring-inset flips the inset slot', () => {
    const css = compileSfc(`@template { <div class="ring-inset">x</div> }`, 'RingInset.aihu')
    expect(css).toContain('--tw-ring-inset: inset')
  })
})

// Round 2 (tailwind-support `motion` track): transform / translate / rotate /
// scale / transition / duration / ease / animate. One case per family proving
// the public-API CSS output emits the expected declarations — including the
// hoisted `@keyframes` for `animate-*`.
describe('@aihu/css-engine — motion utilities (Round 2)', () => {
  it('transition shorthand emits property + duration + timing', () => {
    const css = compileSfc(`@template { <div class="transition">x</div> }`, 'Transition.aihu')
    expect(css).toContain('transition-property')
    expect(css).toContain('transition-duration: 150ms')
    expect(css).toContain('transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1)')
  })

  it('transition-transform narrows to the transform property', () => {
    const css = compileSfc(
      `@template { <div class="transition-transform">x</div> }`,
      'TransitionTransform.aihu',
    )
    expect(css).toContain('transition-property: transform')
  })

  it('duration-N emits transition-duration in ms', () => {
    const css = compileSfc(`@template { <div class="duration-300">x</div> }`, 'Duration.aihu')
    expect(css).toContain('transition-duration: 300ms')
  })

  it('rotate-N emits a transform rotate', () => {
    const css = compileSfc(`@template { <div class="rotate-45">x</div> }`, 'Rotate.aihu')
    expect(css).toContain('transform: rotate(45deg)')
  })

  it('-translate-x-N emits a negative translateX', () => {
    const css = compileSfc(`@template { <div class="-translate-x-2">x</div> }`, 'NegTranslate.aihu')
    expect(css).toContain('transform: translateX(-0.5rem)')
  })

  it('scale-N maps the percentage to a unit factor', () => {
    const css = compileSfc(`@template { <div class="scale-105">x</div> }`, 'Scale.aihu')
    expect(css).toContain('transform: scale(1.05)')
  })

  it('ease-in-out emits the timing function', () => {
    const css = compileSfc(`@template { <div class="ease-in-out">x</div> }`, 'Ease.aihu')
    expect(css).toContain('transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1)')
  })

  it('animate-spin emits the animation shorthand AND the hoisted @keyframes', () => {
    const css = compileSfc(`@template { <div class="animate-spin">x</div> }`, 'Animate.aihu')
    expect(css).toContain('animation: spin 1s linear infinite')
    expect(css).toContain('@keyframes spin')
  })
})

// Public-API (AST → scoped CSS) coverage for the round-2 group/peer relational
// variants. These mirror the Rust `tests/emit.rs` assertions but exercise the
// full TS bridge (`compileToAst` → native binary → scoped CSS), the same path
// the Vite plugin uses. If the native binary is unavailable these will throw at
// `compileSfc`; the suite follows the existing sfc-e2e.test.ts convention of
// calling `compileSfc` directly (the workspace test run builds the binary).
describe('@aihu/css-engine — group/peer relational variants (round 2)', () => {
  it('group-hover: emits an ancestor `.group:hover` descendant selector', () => {
    const source = `@template {
  <div class="group">
    <span class="group-hover:bg-primary">x</span>
  </div>
}`
    const css = compileSfc(source, 'GroupHover.aihu')
    // `.group:hover .group-hover\:bg-primary { background-color: ... }`
    expect(css).toContain('.group:hover .group-hover\\:bg-primary')
    expect(css).toContain('background-color: var(--color-primary, #1a1d24)')
    // Bare `group` marker survives as an empty-body rule.
    expect(css).toContain('.group {')
  })

  it('peer-checked: emits a `.peer:checked ~` sibling selector', () => {
    const source = `@template {
  <input class="peer" type="checkbox" />
  <span class="peer-checked:bg-primary">x</span>
}`
    const css = compileSfc(source, 'PeerChecked.aihu')
    // `.peer:checked ~ .peer-checked\:bg-primary { background-color: ... }`
    expect(css).toContain('.peer:checked ~ .peer-checked\\:bg-primary')
    expect(css).toContain('background-color: var(--color-primary, #1a1d24)')
    expect(css).toContain('.peer {')
  })

  it('covers each group-* state', () => {
    const source = `@template {
  <div class="group-focus:bg-primary group-focus-visible:bg-primary group-active:bg-primary group-disabled:bg-primary">x</div>
}`
    const css = compileSfc(source, 'GroupStates.aihu')
    expect(css).toContain('.group:focus ')
    expect(css).toContain('.group:focus-visible ')
    expect(css).toContain('.group:active ')
    expect(css).toContain('.group:disabled ')
  })

  it('covers each peer-* state', () => {
    const source = `@template {
  <span class="peer-hover:bg-primary peer-focus:bg-primary peer-focus-visible:bg-primary peer-disabled:bg-primary">x</span>
}`
    const css = compileSfc(source, 'PeerStates.aihu')
    expect(css).toContain('.peer:hover ~ ')
    expect(css).toContain('.peer:focus ~ ')
    expect(css).toContain('.peer:focus-visible ~ ')
    expect(css).toContain('.peer:disabled ~ ')
  })
})

// Round 2 (tailwind-support / aria-data-container): aria-*/data-* attribute
// variants + container queries (@container). Each case drives the public
// `compileSfc` path so a green case proves the variant actually emits.
describe('@aihu/css-engine — aria/data variants + container queries (Round 2)', () => {
  it('aria-expanded: emits an attribute selector ([aria-expanded="true"])', () => {
    const css = compileSfc(
      `@template { <button class="aria-expanded:bg-accent">x</button> }`,
      'AriaExpanded.aihu',
    )
    expect(css).toContain('[aria-expanded="true"]')
    expect(css).toContain('background-color: var(--color-accent, #c8543a)')
  })

  it('data-[state=open]: emits a data-attribute selector', () => {
    const css = compileSfc(
      `@template { <div class="data-[state=open]:underline">x</div> }`,
      'DataState.aihu',
    )
    expect(css).toContain('[data-state="open"]')
    expect(css).toContain('text-decoration-line: underline')
  })

  it('@container marker + @md: child wrap in a container query', () => {
    // The proven user-visible pattern: a @container parent and an @md:flex child.
    const css = compileSfc(
      `@template { <div class="@container"><div class="@md:flex">x</div></div> }`,
      'Container.aihu',
    )
    expect(css).toContain('container-type: inline-size')
    expect(css).toContain('@container (min-width: 28rem)')
    expect(css).toContain('display: flex')
  })
})
