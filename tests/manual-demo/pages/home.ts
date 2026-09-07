import { leaf } from '@aihu/arbor'

export function HomePage() {
  return {
    kind: 'branch' as const,
    tag: 'main',
    attrs: {},
    children: [
      { kind: 'branch' as const, tag: 'h1', attrs: {}, children: [leaf('Aihu')] },
      {
        kind: 'branch' as const,
        tag: 'p',
        attrs: {},
        children: [leaf('A meta-framework for Web Components with runtime-first reactivity.')],
      },
      {
        kind: 'branch' as const,
        tag: 'nav',
        attrs: {},
        children: [
          {
            kind: 'branch' as const,
            tag: 'a',
            attrs: { href: '/about' },
            children: [leaf('About')],
          },
        ],
      },
    ],
  }
}
