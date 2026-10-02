import { aihuCompilerPlugin } from '@aihu/compiler'
import { defineConfig } from 'vite'

// Client-only build: compiles the `.aihu` SFCs referenced from `index.html`
// into the static bundle served by Cloudflare's ASSETS binding. The Workers
// entry (`src/main.ts`) is bundled separately by wrangler itself (see `main`
// in `wrangler.toml`) — it has no `.aihu` imports, so it never needs this
// plugin.
export default defineConfig({
  plugins: [aihuCompilerPlugin()],
  build: {
    outDir: 'dist/client',
  },
})
