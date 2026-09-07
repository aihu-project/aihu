import { leaf } from '@aihu/arbor'

export function AboutPage() {
  return {
    kind: 'branch' as const,
    tag: 'main',
    attrs: {},
    children: [
      { kind: 'branch' as const, tag: 'h1', attrs: {}, children: [leaf('About Aihu')] },
      {
        kind: 'branch' as const,
        tag: 'p',
        attrs: {},
        children: [
          leaf('Aihu is a JavaScript/TypeScript meta-framework for building Web Components.'),
        ],
      },
      {
        kind: 'branch' as const,
        tag: 'nav',
        attrs: {},
        children: [
          { kind: 'branch' as const, tag: 'a', attrs: { href: '/' }, children: [leaf('Home')] },
        ],
      },
    ],
  }
}
