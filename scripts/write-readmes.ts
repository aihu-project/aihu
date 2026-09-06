// One-shot: write minimal READMEs for tier A/B/C/D packages that don't have
// a substantive one already (size < 200 bytes). Idempotent — skips packages
// whose README is already > 200 bytes (signals, arbor).

import { existsSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type Spec = {
  name: string
  pkg: string // '@aihu/<x>'
  purpose: string
  usage: string
  extra?: string // appended after description (used for compiler binary note)
}

const SPECS: Spec[] = [
  {
    name: 'signals',
    pkg: '@aihu/signals',
    purpose: 'Tiny reactive signals — the reactive primitive at the core of aihu.',
    usage: `import { signal, computed, effect } from '@aihu/signals';

const count = signal(0);
const doubled = computed(() => count() * 2);
effect(() => console.log('count:', count(), 'doubled:', doubled()));
count.set(5); // logs: count: 5 doubled: 10`,
  },
  {
    name: 'arbor',
    pkg: '@aihu/arbor',
    purpose: 'Reactive component tree — the rendering layer that consumes @aihu/signals.',
    usage: `import { mount, h } from '@aihu/arbor';
import { signal } from '@aihu/signals';

const count = signal(0);
mount(document.body, () => h('button', { onClick: () => count.set(count() + 1) }, count()));`,
  },
  {
    name: 'runtime',
    pkg: '@aihu/runtime',
    purpose:
      'Single File Component (.aihu) runtime — registers custom elements compiled by @aihu/compiler.',
    usage: `// In a .aihu Single File Component the runtime is auto-imported.
// To register a compiled component manually:
import { defineComponent } from '@aihu/runtime';
import MyCounter from './my-counter.aihu';

defineComponent('my-counter', MyCounter);`,
  },
  {
    name: 'context',
    pkg: '@aihu/context',
    purpose: 'Async-context-friendly request/SSR context primitives for aihu.',
    usage: `import { createContext, useContext } from '@aihu/context';

const ThemeContext = createContext<'light' | 'dark'>('light');

// Provide a value for a subtree, then consume it with useContext.`,
  },
  {
    name: 'data',
    pkg: '@aihu-plugin/data',
    purpose: 'Reactive data loaders and resource primitives for aihu.',
    usage: `import { resource } from '@aihu-plugin/data';

const user = resource(async (id: string) => {
  const res = await fetch(\`/api/users/\${id}\`);
  return res.json();
});`,
  },
  {
    name: 'router',
    pkg: '@aihu/router',
    purpose: 'File-based router for the aihu meta-framework.',
    usage: `// vite.config.ts
import { defineConfig } from 'vite';
import { aihuRouter } from '@aihu/router/plugin';

export default defineConfig({ plugins: [aihuRouter()] });`,
  },
  {
    name: 'server',
    pkg: '@aihu/server',
    purpose: 'Server runtime + native renderer (napi-rs) for aihu SSR.',
    usage: `import { renderToString } from '@aihu/server';

const html = await renderToString(App, { url: req.url });`,
    extra:
      'Requires one of the platform-specific native packages: `@aihu/server-darwin-arm64`, `@aihu/server-darwin-x64`, `@aihu/server-linux-x64-gnu`, or `@aihu/server-win32-x64-msvc`. npm picks the right one automatically via `optionalDependencies`.',
  },
  {
    name: 'app',
    pkg: '@aihu/app',
    purpose: 'Top-level app integration — wires runtime, router, and adapters into a Vite app.',
    usage: `// vite.config.ts
import { defineConfig } from 'vite';
import { aihu } from '@aihu/app';

export default defineConfig({ plugins: [aihu()] });`,
  },
  {
    name: 'adapter-cloudflare',
    pkg: '@aihu/adapter-cloudflare',
    purpose: 'Cloudflare Workers/Pages deployment adapter for @aihu/app.',
    usage: `// vite.config.ts
import { defineConfig } from 'vite';
import { aihu } from '@aihu/app';
import cloudflare from '@aihu/adapter-cloudflare';

export default defineConfig({ plugins: [aihu({ adapter: cloudflare() })] });`,
  },
  {
    name: 'adapter-vercel',
    pkg: '@aihu/adapter-vercel',
    purpose: 'Vercel deployment adapter for @aihu/app.',
    usage: `// vite.config.ts
import { defineConfig } from 'vite';
import { aihu } from '@aihu/app';
import vercel from '@aihu/adapter-vercel';

export default defineConfig({ plugins: [aihu({ adapter: vercel() })] });`,
  },
  {
    name: 'agent',
    pkg: '@aihu/agent',
    purpose: 'Agent primitives — the foundation of aihu agent-readiness.',
    usage: `import { defineAgent } from '@aihu/agent';

export const myAgent = defineAgent({
  name: 'my-agent',
  description: 'Does the thing',
  // ...
});`,
  },
  {
    name: 'agent-service',
    pkg: '@aihu/agent-service',
    purpose: 'Service-side agent runtime — host @aihu/agent definitions over HTTP.',
    usage: `import { createAgentService } from '@aihu/agent-service';
import { myAgent } from './agents/my-agent';

const service = createAgentService({ agents: [myAgent] });
// Mount service.handler in your server framework of choice.`,
  },
  {
    name: 'agent-readiness',
    pkg: '@aihu-plugin/agent-readiness',
    purpose: 'Discovery + readiness manifest emitter so agents can introspect aihu apps.',
    usage: `import { readinessHandler } from '@aihu-plugin/agent-readiness';

// Mount at /.well-known/agent-readiness
app.get('/.well-known/agent-readiness', readinessHandler());`,
  },
  {
    name: 'agent-a2a',
    pkg: '@aihu/agent-a2a',
    purpose: 'A2A (Agent-to-Agent) protocol bindings for @aihu/agent-service.',
    usage: `import { a2aBinding } from '@aihu/agent-a2a';
import { createAgentService } from '@aihu/agent-service';

const service = createAgentService({ agents, bindings: [a2aBinding()] });`,
  },
  {
    name: 'agent-acp',
    pkg: '@aihu/agent-acp',
    purpose: 'DEPRECATED — use @aihu/agent-a2a (ACP merged into A2A, Aug 2025).',
    usage: `import { acpBinding } from '@aihu/agent-acp';
import { createAgentService } from '@aihu/agent-service';

const service = createAgentService({ agents, bindings: [acpBinding()] });`,
  },
  {
    name: 'compiler',
    pkg: '@aihu/compiler',
    purpose: 'Single File Component (.aihu) compiler — Rust binary + JS glue.',
    usage: `// vite.config.ts
import { defineConfig } from 'vite';
import { aihuCompiler } from '@aihu/compiler';

export default defineConfig({ plugins: [aihuCompiler()] });`,
    extra:
      '⚠ **Native binary required.** This package downloads a pre-built `aihu-compile` binary at install time via `js/postinstall.ts` (see [WASM.md](https://github.com/aihu-project/aihu/blob/main/packages/compiler/WASM.md)). Binaries are published per-platform from the `release.yml` workflow on every `v*` tag. SHA256-verified per arch-4 §4.3.',
  },
  {
    name: 'cli',
    pkg: '@aihu/cli',
    purpose: 'Aihu CLI (`aihu`, `create-aihu`) — scaffolding, dev, build commands.',
    usage: `# Scaffold a new aihu app
bun create aihu my-app
# or
npm create aihu my-app

# Inside the project
aihu dev      # start dev server
aihu build    # build for production`,
  },
  {
    name: 'plugin',
    pkg: '@aihu/plugin',
    purpose:
      'Plugin substrate shared by @aihu/server and the meta-framework — runtime hook surface.',
    usage: `import { definePlugin } from '@aihu/plugin';

export default definePlugin({
  name: 'my-plugin',
  // ...lifecycle hooks
});`,
  },
]

function template(s: Spec): string {
  const extraBlock = s.extra ? `\n${s.extra}\n` : ''
  return `# ${s.pkg}

> ${s.purpose}
${extraBlock}
Part of the [aihu](https://github.com/aihu-project/aihu) framework — agentic discovery and interaction, for human purpose.

## Install

\`\`\`bash
npm install ${s.pkg}
# or
bun add ${s.pkg}
\`\`\`

## Usage

\`\`\`typescript
${s.usage}
\`\`\`

## Status

Early access (\`0.1.x\`). API may evolve before v1.1 GA. See the [v1.1 roadmap](https://github.com/aihu-project/aihu/tree/main/docs/roadmap) for stability commitments.

## License

MIT — see [LICENSE](https://github.com/aihu-project/aihu/blob/main/LICENSE).
`
}

let written = 0
let skipped = 0
const skippedNames: string[] = []
const writtenNames: string[] = []

for (const spec of SPECS) {
  const path = join('packages', spec.name, 'README.md')
  let size = 0
  if (existsSync(path)) {
    size = statSync(path).size
  }
  if (size >= 200) {
    skipped++
    skippedNames.push(spec.name)
    continue
  }
  writeFileSync(path, template(spec))
  written++
  writtenNames.push(spec.name)
}

console.log(`READMEs written: ${written}`)
console.log(`  ${writtenNames.join(', ')}`)
console.log(`READMEs preserved (already substantive): ${skipped}`)
console.log(`  ${skippedNames.join(', ')}`)
