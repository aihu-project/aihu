/**
 * The docs sidebar model. In this representative slice only the pages that
 * actually exist are wired live; the rest are shown as "soon" so the shape of
 * the full information architecture is judgeable. Full content migration
 * (docs/collapse-to-apps-docs unified corpus) is the next phase.
 */
export interface NavLink {
  readonly label: string
  readonly href: string
  /** true = a built page in this slice; false = placeholder in the IA. */
  readonly ready: boolean
}
export interface NavSection {
  readonly title: string
  readonly links: readonly NavLink[]
}

export const NAV: readonly NavSection[] = [
  {
    title: 'Guides',
    links: [
      { label: 'Getting Started', href: '/guides/getting-started', ready: true },
      { label: 'Installation', href: '/guides/installation', ready: true },
      { label: 'Reactivity', href: '/guides/reactivity', ready: true },
      { label: 'Authoring Components', href: '/guides/authoring-components', ready: true },
      { label: 'Composition & Injection', href: '/guides/composition', ready: true },
      { label: 'Authoring Agents', href: '/guides/authoring-agents', ready: true },
      { label: 'Styling', href: '/guides/styling', ready: true },
      { label: 'Theming', href: '/guides/theming', ready: true },
      { label: 'Utility Classes', href: '/guides/utility-classes', ready: true },
      { label: 'Primitives', href: '/guides/primitives', ready: true },
      { label: 'Routing & Layouts', href: '/guides/routing-layouts', ready: true },
      { label: 'Data Fetching', href: '/guides/data-fetching', ready: true },
      { label: 'SSR & Hydration', href: '/guides/ssr-hydration', ready: true },
      { label: 'Agent Discovery', href: '/guides/agent-discovery', ready: true },
      { label: 'Authoring Plugins', href: '/guides/authoring-plugins', ready: true },
      { label: 'Deployment', href: '/guides/deployment', ready: true },
      { label: 'Migration', href: '/guides/migration', ready: true },
    ],
  },
  // --- API (track A) ---
  // Generated datasheet (scripts/gen-api.ts): one page per documentable
  // package. All 37 are live; the sidebar surfaces the index + a curated
  // shortlist (the exemplar + the packages a getting-started reader hits
  // first) rather than all 37 rows.
  {
    title: 'API Reference',
    links: [
      { label: 'All 37 packages', href: '/api', ready: true },
      { label: '@aihu/signals', href: '/api/signals', ready: true },
      { label: '@aihu/store', href: '/api/store', ready: true },
      { label: '@aihu/runtime', href: '/api/runtime', ready: true },
      { label: '@aihu/router', href: '/api/router', ready: true },
      { label: '@aihu/server', href: '/api/server', ready: true },
      { label: '@aihu/app', href: '/api/app', ready: true },
    ],
  },
  // --- /API (track A) ---
  // --- Cookbook (track B) ---
  // Gallery data (scripts/gen-gallery.ts): 20 cookbook recipes + the 9
  // founder-ratified governed examples, derived from packages/mcp/src/
  // cookbook-index.json + examples/<name>/coverage.manifest.json. Every
  // recipe below is a real, prerendered /cookbook/<id> detail page, and the
  // in-browser WASM playground (ported from apps/docs) compiles the same
  // corpus live at /playground.
  {
    title: 'Registry',
    links: [
      { label: 'Components & extensions', href: '/registry', ready: true },
      { label: 'Machine-readable index', href: '/registry/index.json', ready: true },
    ],
  },
  {
    title: 'Examples',
    links: [
      { label: 'Gallery', href: '/examples', ready: true },
      { label: 'Governed set (9)', href: '/examples#governed', ready: true },
    ],
  },
  {
    title: 'Cookbook',
    links: [
      { label: 'All recipes (20)', href: '/cookbook', ready: true },
      { label: 'Live demo', href: '/examples#playground', ready: true },
    ],
  },
  // --- /Cookbook (track B) ---
  // --- Playground (WASM) ---
  // Its own top-level section rather than a row under Examples: it is a tool,
  // not a document, and it is the only route that ships the compiler itself
  // (the published aihu-compile WASM package) to the browser.
  {
    title: 'Playground',
    links: [{ label: 'Compile in-browser', href: '/playground', ready: true }],
  },
]
