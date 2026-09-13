/**
 * `aihu deploy [options]` — deploy the production build to the configured
 * platform adapter.
 *
 * Reads `config.adapter.name` (the same `AihuAdapter` set on `viteAihuPlugin`
 * via `adapter: cloudflare(...)` / `adapter: vercel()` in vite.config.ts) and
 * dispatches to that platform's own CLI:
 *   - 'cloudflare' → `wrangler deploy`
 *   - 'vercel'     → `vercel --prod`
 *
 * `@aihu/cli` does not depend on `@aihu/app`, wrangler, or vercel at build
 * time (zero non-Node-builtin deps) — the adapter name is read structurally
 * off the loaded config, and the platform CLI is resolved from the user's
 * own `node_modules`/PATH at run time, exactly like `aihu dev`/`aihu build`
 * resolve vite. arch-4 §3.
 *
 * Flags: --help
 */

import { spawn } from 'node:child_process'
import { loadProjectConfig } from '../load-project-config.js'

interface DeployAihuConfig {
  adapter?: { name?: string }
}

interface DeployFlags {
  help: boolean
}

function parseFlags(args: readonly string[]): DeployFlags {
  return { help: args.includes('--help') || args.includes('-h') }
}

function printHelp(): void {
  process.stdout.write(
    [
      'Usage: aihu deploy [options]',
      '',
      'Deploy the production build via the configured platform adapter.',
      '',
      'Options:',
      '  --help, -h    Show this help',
      '',
      'The adapter is read from vite.config.ts (adapter: cloudflare(...) | vercel()).',
      '  cloudflare → runs `wrangler deploy`',
      '  vercel     → runs `vercel --prod`',
      '',
    ].join('\n'),
  )
}

async function loadConfig(cwd: string): Promise<DeployAihuConfig | null> {
  const loaded = await loadProjectConfig(cwd)
  return loaded ? (loaded.config as DeployAihuConfig) : null
}

/** Spawn a platform CLI with inherited stdio, exiting with its own code. */
function runPlatformCli(bin: string, args: readonly string[], installHint: string): void {
  const child = spawn(bin, args, { stdio: 'inherit', shell: true })
  child.on('error', (err: Error) => {
    process.stderr.write(`${bin} failed to start: ${err.message}\n${installHint}\n`)
    process.exit(1)
  })
  child.on('exit', (code: number | null) => process.exit(code ?? 0))
}

/** Entry point for `aihu deploy`. */
export default async function deploy(args: readonly string[]): Promise<void> {
  const flags = parseFlags(args)
  if (flags.help) {
    printHelp()
    process.exit(0)
  }

  const cwd = process.cwd()
  const config = await loadConfig(cwd)
  if (config === null) {
    process.stderr.write(
      'No aihu.config.ts found in current directory.\n' +
        'Create a new project with:  aihu app <name>\n',
    )
    process.exit(1)
  }

  const adapterName = config.adapter?.name

  if (adapterName === 'cloudflare') {
    runPlatformCli('wrangler', ['deploy'], 'Install it with: bun add -d wrangler')
    return
  }
  if (adapterName === 'vercel') {
    runPlatformCli('vercel', ['--prod'], 'Install it with: bun add -d vercel')
    return
  }

  process.stderr.write(
    `${
      adapterName === undefined
        ? 'No adapter configured in vite.config.ts.'
        : `Unknown adapter "${adapterName}" in vite.config.ts.`
    }\n` +
      'aihu deploy supports:\n' +
      "  adapter: cloudflare(...)  from '@aihu/adapter-cloudflare'\n" +
      "  adapter: vercel(...)      from '@aihu/adapter-vercel'\n",
  )
  process.exit(1)
}
