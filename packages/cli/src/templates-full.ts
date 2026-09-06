/**
 * `--template full` generators — the kitchen-sink template, redesigned as the
 * dual-experience demo (docs/plans/2026-07-26-scaffold-experience-design.md §3.3).
 *
 * The demo is a co-op five-letter word game in one component, played three ways
 * through the SAME two `$action`s:
 *   - a human, on the on-screen board;
 *   - an invited model — local (Ollama, no key) or BYOK — driven by a small
 *     player in server.ts that calls the same governed gate;
 *   - any external MCP agent (mcp.ts stdio, or POST /agent/call).
 *
 * Architecture is the agent template's proven two-process shape (#601): a Bun
 * capability-bridge server (:5208) owning the gate + the LIVE registry-derived
 * discovery surface, and Vite (:5108) proxying both. The `agent` template folds
 * into this one — its machinery is this template's server story.
 *
 * The no-key path is the product: the game must be excellent with nothing
 * configured. The model is an optional second player, never the entry fee.
 *
 * Per the repo's dep-free thesis: pure string generators, no runtime file reads.
 * Reuses the identical pieces from templates-agent.ts (package.json, tsconfig,
 * module shim) rather than forking them.
 */

import type { PkgManager } from './index.js'
import { agentModuleShim, agentPackageJson, agentTsConfig } from './templates-agent.js'
import {
  type AgentsMdFacts,
  agentToolingFiles,
  pnpmWorkspaceYaml,
  vscodeFiles,
} from './templates-tooling.js'

export { agentPackageJson as fullPackageJson, agentTsConfig as fullTsConfig }

const TAG = 'word-duet'
const SCOPE = 'game:play'
const RATE = '15'

// ─── Shared surface (server.ts and mcp.ts must agree with the component) ─────
// The `describe:` strings are not decoration: the MCP card's tool descriptions,
// the A2A skills, and llms.txt's `## Components` section all derive from this
// registry entry. They mirror the `describe:` on each `$action` in
// src/word-duet.aihu — keep the two in step.

const METADATA_ACTIONS = [
  "    guess: { describe: 'Submit a five-letter guess for the current game.', returns: {} },",
  "    newGame: { describe: 'Start a new game with a fresh word.', returns: {} },",
]
const METADATA_STATE = [
  "    board: 'Guesses so far, each letter marked correct | present | absent.',",
  "    status: \"'playing' | 'won' | 'lost'.\",",
  "    guessesLeft: 'Remaining guesses (a game is six).',",
]
const BINDING_ACTIONS = ['        guess: () => twinLen(),', '        newGame: () => twinLen(),']
const TWIN_READS =
  "      reads: { board: () => [], status: () => 'awaiting-browser', guessesLeft: () => 0 },"

const READINESS_DISPATCH = [
  '    // Discovery first: /llms.txt, /llms-full.txt, /robots.txt and the',
  '    // /.well-known/* cards — served from THIS process because this is where',
  '    // the @aihu/agent registry is populated, so the documents list the',
  '    // actions that are actually callable right now.',
  '    const readiness = await handleReadiness(req)',
  '    if (readiness) return readiness',
]

// ─── vite.config.ts ──────────────────────────────────────────────────────────

export function fullViteConfig(): string {
  const lines = [
    "import { aihuCompilerPlugin } from '@aihu/compiler'",
    "import { defineConfig } from 'vite'",
    '',
    '// The app is TWO processes behind one URL: Vite serves the page, the Bun',
    '// server (server.ts) serves the agent surface and the model player.',
    '// Everything an agent needs — the capability bridge AND the discovery',
    '// documents (/llms.txt, /.well-known/*) — is proxied, so an agent that has',
    "// only the app's URL finds all of it there.",
    "const BRIDGE = 'http://localhost:5208'",
    '',
    '// `changeOrigin: false` matters for the discovery documents: they embed',
    "// absolute URLs built from the request's Host header. At the proxy default",
    '// the Host is rewritten to the internal :5208, and an agent that fetched',
    '// /llms.txt from the app URL would be handed links to a port it was never',
    '// told about.',
    'const READINESS = { target: BRIDGE, changeOrigin: false }',
    '',
    'const AGENT_SURFACE = {',
    "  '/agent': BRIDGE,",
    "  '/model': BRIDGE,",
    "  '/bridge': { target: 'ws://localhost:5208', ws: true },",
    "  '/llms.txt': READINESS,",
    "  '/llms-full.txt': READINESS,",
    "  '/robots.txt': READINESS,",
    "  '/sitemap.xml': READINESS,",
    "  '/.well-known': READINESS,",
    '}',
    '',
    '// `target: client` ships the per-instance @agent dispatcher in the browser',
    '// bundle; src/main.ts takes it off the mounted element and runs the',
    '// capability-bridge client.',
    'export default defineConfig({',
    "  plugins: [aihuCompilerPlugin({ target: 'client' })],",
    '  server: { proxy: AGENT_SURFACE },',
    '  preview: { proxy: AGENT_SURFACE },',
    '})',
    '',
  ]
  return lines.join('\n')
}

// ─── src/word-duet.aihu — the game ───────────────────────────────────────────

export function fullComponentAihu(): string {
  return `@state {
  import { signal } from '@aihu/signals'

  // This is the demo. When you start your real app: delete this file, point
  // index.html at your own component, and keep server.ts + readiness.ts —
  // they are your agent surface, not demo code.

  // ~470 common answers, ~3 kB. Guesses accept ANY five letters — swapping in
  // a real dictionary is a good first change to make this yours.
  const ANSWERS = ('about,above,actor,adapt,agree,ahead,alarm,album,alert,alike,' +
    'alive,allow,alone,along,amber,anger,angle,apple,arena,argue,arise,armor,aroma,' +
    'aside,audio,avoid,awake,award,badge,baker,basic,beach,began,begin,bench,berry,' +
    'birth,black,blade,blame,blank,blaze,blend,bless,blind,block,bloom,board,boost,' +
    'brain,brave,bread,break,brick,bride,brief,bring,broad,brown,brush,build,cabin,' +
    'cable,candy,cargo,carry,catch,cause,chain,chair,chalk,charm,chase,cheap,check,' +
    'chess,chief,child,choir,civic,claim,clean,clear,climb,clock,cloud,coach,coast,' +
    'color,comet,coral,couch,count,court,cover,craft,crane,crash,cream,crisp,crowd,' +
    'crown,curve,cycle,daily,dance,depth,doubt,dozen,draft,dream,dress,drift,drink,' +
    'drive,eager,eagle,early,earth,eight,elbow,ember,empty,enjoy,enter,equal,error,' +
    'event,every,exact,fable,faith,fancy,feast,fence,field,fifty,fight,final,flame,' +
    'flash,fleet,floor,flour,fluid,focus,force,forge,forth,found,frame,fresh,front,' +
    'frost,fruit,giant,glass,globe,glory,grace,grain,grand,grant,grape,grasp,grass,' +
    'great,green,greet,group,guard,guest,guide,happy,heart,heavy,hedge,hello,honey,' +
    'horse,hotel,house,human,ideal,image,index,inner,input,irony,ivory,jelly,jewel,' +
    'joint,judge,juice,knife,knock,label,labor,lance,large,laugh,layer,learn,lemon,' +
    'level,light,limit,local,logic,loyal,lucky,lunar,lunch,magic,major,maple,march,' +
    'match,maybe,mayor,medal,media,merit,metal,meter,might,minor,model,money,' +
    'month,moral,motor,mount,mouse,mouth,music,naval,nerve,never,night,noble,noise,' +
    'north,novel,nurse,ocean,offer,olive,onion,orbit,order,other,ounce,outer,owner,' +
    'oxide,ozone,paint,panel,paper,party,peace,pearl,phase,phone,photo,piano,piece,' +
    'pilot,pitch,place,plain,plane,plant,plate,point,pound,power,press,price,pride,' +
    'prime,print,prize,proof,proud,prove,pulse,punch,pupil,queen,quick,quiet,quilt,' +
    'quote,radar,radio,raise,ranch,range,rapid,ratio,reach,ready,realm,rhyme,rider,' +
    'ridge,right,risky,river,roast,robin,rocky,roman,rough,round,route,royal,rural,' +
    'salad,scale,scene,scope,score,sense,serve,seven,shade,shape,share,sharp,sheep,' +
    'sheet,shelf,shell,shine,shirt,shore,short,sight,silly,since,skill,slate,sleep,' +
    'slice,small,smart,smile,smoke,solar,solid,solve,sound,south,space,spare,spark,' +
    'speak,speed,spell,spend,spice,spine,split,sport,stack,staff,stage,stand,start,' +
    'state,steam,steel,stick,still,stone,store,storm,story,stove,strap,straw,study,' +
    'style,sugar,suite,sunny,super,sweet,swift,table,taste,teach,thank,theme,thing,' +
    'think,third,tiger,tight,timer,title,toast,today,token,total,touch,tower,trace,' +
    'track,trade,trail,train,treat,trend,trial,tribe,trick,truck,trust,truth,twist,' +
    'uncle,under,union,unite,unity,upper,urban,usage,usual,valid,value,vapor,vault,' +
    'venue,verse,video,vigor,virus,visit,vital,vivid,vocal,voice,voter,wagon,waste,' +
    'watch,water,weave,wedge,whale,wheat,wheel,where,which,while,white,whole,woman,' +
    'world,worth,woven,wrist,write,wrong,yield,young,youth,zebra').split(',')

  const MAX = 6
  const pick = () => ANSWERS[Math.floor(Math.random() * ANSWERS.length)]

  const [answer, setAnswer] = signal(pick())
  // Each row: { id, cells: [{ ch, mark }] } where mark is correct|present|absent.
  const [board, setBoard] = signal([])
  const [status, setStatus] = signal('playing')
  const [draft, setDraft] = signal('')
  const [note, setNote] = signal('')

  // Standard two-pass marking (handles repeated letters).
  const markGuess = (guess, ans) => {
    const g = guess.split('')
    const a = ans.split('')
    const marks = new Array(5).fill('absent')
    const left = {}
    for (let i = 0; i < 5; i++) {
      if (g[i] === a[i]) marks[i] = 'correct'
      else left[a[i]] = (left[a[i]] ?? 0) + 1
    }
    for (let i = 0; i < 5; i++) {
      if (marks[i] !== 'correct' && (left[g[i]] ?? 0) > 0) {
        marks[i] = 'present'
        left[g[i]] -= 1
      }
    }
    return marks
  }

  // Your keyboard, the invited model, and any outside agent all end up HERE —
  // one function, one surface. That is the whole demo.
  const submitGuess = (raw) => {
    if (status() !== 'playing') return
    const word = String(raw ?? '').trim().toLowerCase()
    if (!/^[a-z]{5}$/.test(word)) {
      setNote('Guesses are five letters, a-z.')
      return
    }
    setNote('')
    const marks = markGuess(word, answer())
    const cells = word.split('').map((ch, i) => ({ ch, mark: marks[i] }))
    const next = [...board(), { id: board().length, cells }]
    setBoard(next)
    if (word === answer()) setStatus('won')
    else if (next.length >= MAX) setStatus('lost')
  }

  const startNew = () => {
    setAnswer(pick())
    setBoard([])
    setStatus('playing')
    setDraft('')
    setNote('')
  }

  const onDraft = (e) => setDraft(e.target.value)
  const guessFromInput = () => {
    submitGuess(draft())
    setDraft('')
  }

  $action: {
    guess: {
      describe: 'Submit a five-letter guess for the current game.',
      expose: { read: true },
      handler: (args) => submitGuess(typeof args?.[0] === 'string' ? args[0] : String(args?.[0] ?? '')),
    },
    newGame: {
      describe: 'Start a new game with a fresh word.',
      expose: { read: true },
      handler: () => startNew(),
    },
  }
}

@template {
  <section class="wd" data-status={status} data-guesses-left={6 - board.length}>
    <div class="wd-board">
      <div each={row of board} key={row.id} class="wd-row">
        <span each={cell, i of row.cells} key={i} class={'wd-tile ' + cell.mark} data-mark={cell.mark}>{cell.ch}</span>
      </div>
    </div>

    <p class="wd-note" if={note}>{note}</p>
    <p class="wd-status" if={status === 'won'}>Got it in {board.length}. </p>
    <p class="wd-status" if={status === 'lost'}>Out of guesses — it was "{answer}".</p>

    <div class="wd-entry" if={status === 'playing'}>
      <label class="wd-srlabel" for="wd-input">Your guess</label>
      <input
        id="wd-input"
        class="wd-input"
        maxlength="5"
        autocomplete="off"
        value={draft}
        on:input={onDraft}
        on:keydown={(e) => e.key === 'Enter' && guessFromInput()}
        placeholder="five letters, then Enter"
      />
      <button class="wd-btn wd-go" on:click={guessFromInput}>Guess</button>
    </div>
    <button class="wd-btn" if={status !== 'playing'} on:click={startNew}>Play again</button>
  </section>
}

@style {
  /* Warm paper + one terracotta accent (the human axis). Tile feedback uses
     aihu's semantic STATE tokens — success/warning/neutral — whose contrast
     pairings are measured, not eyeballed (.tastemaker/style-lock.md). State
     colours signal state; they are not a second brand hue. */
  .wd {
    --ink: #1a1d24;
    --border: #ece9e2;
    --muted: #5a5a55;
    --accent: #c8543a;
    --ok: #3f6f4f;      /* success — right letter, right spot */
    --near: #945f0e;    /* warning — in the word, wrong spot  */
    --miss: #363c47;    /* neutral — not in the word          */
    --on-state: #faf8f4;
    display: grid;
    gap: 1rem;
    justify-items: center;
    color: var(--ink);
    font-family: inherit;
  }
  @media (prefers-color-scheme: dark) {
    .wd {
      --ink: #ece9e2;
      --border: #2b3038;
      --muted: #a39a92;
      --accent: #e0674b;
      --ok: #84b898;
      --near: #d8a848;
      --miss: #636a72;
      --on-state: #1a1d24;
    }
  }
  .wd-board { display: grid; gap: 0.35rem; min-height: 0.35rem; }
  .wd-row { display: flex; gap: 0.35rem; }
  .wd-tile {
    width: 2.6rem;
    height: 2.6rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 1.3rem;
    font-weight: 700;
    text-transform: uppercase;
  }
  .wd-tile.correct { background: var(--ok); border-color: var(--ok); color: var(--on-state); }
  .wd-tile.present { background: var(--near); border-color: var(--near); color: var(--on-state); }
  .wd-tile.absent { background: var(--miss); border-color: var(--miss); color: var(--on-state); }
  .wd-note, .wd-status { margin: 0; color: var(--muted); }
  .wd-status { font-weight: 600; color: var(--ink); }
  .wd-entry { display: flex; gap: 0.5rem; }
  .wd-srlabel { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .wd-input {
    width: 12rem;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    font: inherit;
    letter-spacing: 0.15em;
    text-transform: lowercase;
    background: transparent;
    color: var(--ink);
  }
  .wd-btn {
    padding: 0.5rem 1rem;
    cursor: pointer;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: var(--ink);
    font: inherit;
  }
  .wd-go { background: var(--accent); border-color: var(--accent); color: #faf8f4; font-weight: 600; }
}

@agent {
  action guess()
  action newGame()
}
`
}

// ─── index.html ──────────────────────────────────────────────────────────────

export function fullIndexHtml(name: string): string {
  const lines = [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `    <title>${name}</title>`,
    '    <!-- Search & link previews. Serious per-page meta belongs in a router',
    "         template's @route { head: { … } }; this app has one page, so it lives here. -->",
    `    <meta name="description" content="${name} — a word game one aihu component plays three ways: you, a model you invite, and any MCP agent." />`,
    `    <meta property="og:title" content="${name}" />`,
    `    <meta property="og:description" content="A word game one aihu component plays three ways: you, a model you invite, and any MCP agent." />`,
    '    <meta property="og:type" content="website" />',
    '    <style>',
    '      :root {',
    '        --paper: #faf8f4; --ink: #1a1d24; --muted: #5a5a55; --border: #ece9e2;',
    '        --accent: #c8543a; --graphite: #363c47; --surface: #ffffff;',
    '      }',
    '      @media (prefers-color-scheme: dark) {',
    '        :root {',
    '          --paper: #14161c; --ink: #ece9e2; --muted: #a39a92; --border: #2b3038;',
    '          --accent: #e0674b; --graphite: #aab0bd; --surface: #1a1d24;',
    '        }',
    '      }',
    '      body { font-family: system-ui, -apple-system, sans-serif; background: var(--paper);',
    '        color: var(--ink); max-width: 42rem; margin: 2.5rem auto; padding: 0 1rem;',
    '        line-height: 1.55; }',
    '      h1 { font-size: 1.6rem; margin: 0 0 0.25rem; letter-spacing: -0.01em; }',
    '      h2 { font-size: 1.05rem; margin: 0 0 0.5rem; }',
    '      a { color: var(--accent); }',
    '      code { font-family: ui-monospace, monospace; font-size: 0.9em;',
    '        background: color-mix(in srgb, var(--border) 55%, transparent);',
    '        padding: 0.1rem 0.3rem; border-radius: 4px; }',
    '      .dot { display: inline-block; width: 0.55em; height: 0.55em; border-radius: 50%;',
    '        background: var(--accent); margin-right: 0.45em; }',
    '      .dot-g { background: var(--graphite); }',
    '      .lede { color: var(--muted); margin: 0 0 1.5rem; }',
    '      .panel { border: 1px solid var(--border); border-radius: 12px; background: var(--surface);',
    '        padding: 1.5rem; margin: 1.25rem 0; }',
    '      .panel p { margin: 0.25rem 0 0.75rem; color: var(--muted); font-size: 0.95rem; }',
    '      .panel button { padding: 0.5rem 1rem; cursor: pointer; border-radius: 8px; font: inherit;',
    '        border: 1px solid var(--graphite); background: transparent; color: var(--ink); }',
    '      .panel button:disabled { opacity: 0.45; cursor: default; }',
    '      .meta { color: var(--muted); font-size: 0.9rem; }',
    '      ul.next { padding-left: 1.2rem; margin: 0.5rem 0 0; }',
    '      ul.next li { margin: 0.3rem 0; }',
    '      @media (max-width: 420px) { body { margin: 1.25rem auto; } .panel { padding: 1rem; } }',
    '    </style>',
    '  </head>',
    '  <body>',
    `    <h1><span class="dot"></span>${name}</h1>`,
    '    <p class="lede">',
    '      One component, three players: you, a model you invite, and any MCP agent —',
    '      all through the same two actions. Guess the five-letter word.',
    '    </p>',
    '',
    '    <!-- The game. Human axis: terracotta. -->',
    `    <${TAG}></${TAG}>`,
    '',
    '    <!-- The agent axis: graphite. A model is just another governed caller. -->',
    '    <section class="panel">',
    '      <h2><span class="dot dot-g"></span>Invite a model</h2>',
    '      <p id="model-note">Checking for a model&hellip;</p>',
    '      <button id="model-move" disabled>Model plays the next guess</button>',
    '    </section>',
    '',
    '    <section class="panel">',
    '      <h2><span class="dot dot-g"></span>Or drive it from outside</h2>',
    '      <p>',
    '        Your app is already legible to agents — try',
    '        <code>curl localhost:5108/llms.txt</code>. The discovery surface',
    '        (<a href="/llms.txt">llms.txt</a> ·',
    '        <a href="/.well-known/mcp/server-card.json">MCP card</a> ·',
    '        <a href="/.well-known/agent-card.json">A2A card</a>) is derived from the',
    '        same registry the gate authorizes against, so it cannot advertise a tool',
    '        the gate would refuse.',
    '      </p>',
    '      <p class="meta">',
    "        <code>curl -XPOST localhost:5108/agent/call -H 'content-type: application/json' -d",
    `        '{"tool":"${TAG}/guess","params":["crane"],"userId":"you","jwt":"${SCOPE}"}'</code>`,
    '      </p>',
    '    </section>',
    '',
    '    <p class="meta">',
    `      To make this yours: edit <code>src/${TAG}.aihu</code> — save, and the board hot-reloads. Then:`,
    '    </p>',
    '    <ul class="next meta">',
    `      <li>Change how a correct tile looks — the <code>@style</code> block in <code>src/${TAG}.aihu</code>.</li>`,
    `      <li>Add a third action to <code>$action</code>, then <code>curl localhost:5108/llms.txt</code> — it shows up without you writing a line of card JSON.</li>`,
    '      <li>Swap the answer list for a real dictionary (top of the <code>@state</code> block).</li>',
    '    </ul>',
    `    <p class="meta">Done with the demo? README.md &rarr; "Make it yours" says exactly what to delete.</p>`,
    '',
    '    <script type="module" src="/src/main.ts"></script>',
    '  </body>',
    '</html>',
    '',
  ]
  return lines.join('\n')
}

// ─── src/main.ts ─────────────────────────────────────────────────────────────

export function fullMainTs(): string {
  const lines = [
    '/**',
    ' * Browser entry: registers <word-duet>, connects the capability bridge (so',
    ' * server-approved agent calls run against THIS on-screen instance), and wires',
    ' * the "invite a model" panel. The model itself runs server-side — no key ever',
    ' * reaches the browser.',
    ' */',
    "import { createBridgeClient } from '@aihu/agent-server'",
    "import type { BridgeChannel } from '@aihu/agent-server'",
    "import { _takeAgentDispatcher } from '@aihu/runtime'",
    '',
    '// Side-effect import: compiles + registers the custom element.',
    "import './word-duet.aihu'",
    '',
    `const TAG = '${TAG}'`,
    "const BRIDGE_URL = 'ws://' + location.hostname + ':5208/bridge'",
    '',
    'function wrapBrowserWs(ws: WebSocket): BridgeChannel {',
    '  return {',
    '    get connected() {',
    '      return ws.readyState === WebSocket.OPEN',
    '    },',
    '    send(data) {',
    '      ws.send(data)',
    '    },',
    '    onMessage(handler) {',
    '      const h = (e: MessageEvent): void => handler(String(e.data))',
    "      ws.addEventListener('message', h)",
    "      return () => ws.removeEventListener('message', h)",
    '    },',
    '    onClose(handler) {',
    "      ws.addEventListener('close', handler)",
    "      return () => ws.removeEventListener('close', handler)",
    '    },',
    '  }',
    '}',
    '',
    '/** The live board, read straight off the screen — this is what /agent/state',
    ' * returns and what the model is prompted with. */',
    'function serializeBoard(el: Element) {',
    '  const root = el.shadowRoot ?? el',
    "  const rows = [...root.querySelectorAll('.wd-row')].map((row) =>",
    "    [...row.querySelectorAll('.wd-tile')].map((tile) => ({",
    "      ch: tile.textContent ?? '',",
    "      mark: tile.getAttribute('data-mark') ?? 'absent',",
    '    })),',
    '  )',
    "  const host = root.querySelector('.wd')",
    '  return {',
    '    board: rows,',
    "    status: host?.getAttribute('data-status') ?? 'playing',",
    "    guessesLeft: Number(host?.getAttribute('data-guesses-left') ?? 6),",
    '  }',
    '}',
    '',
    'function connectBridge(): void {',
    '  const el = document.querySelector(TAG)',
    '  if (!el) {',
    "    console.error('[bridge] <' + TAG + '> not found')",
    '    return',
    '  }',
    '  const dispatcher = _takeAgentDispatcher(el)',
    '  if (!dispatcher) {',
    "    console.error('[bridge] no per-instance dispatcher — built for client+@agent?')",
    '    return',
    '  }',
    '  const ws = new WebSocket(BRIDGE_URL)',
    "  ws.addEventListener('open', () => {",
    '    createBridgeClient({',
    '      dispatcher,',
    '      channel: wrapBrowserWs(ws),',
    '      serialize: () => serializeBoard(el),',
    '    })',
    "    console.log('[bridge] connected — agents can now drive this board')",
    '  })',
    "  ws.addEventListener('error', () => {",
    "    console.warn('[bridge] could not reach ' + BRIDGE_URL + ' — is `bun run server` up?')",
    '  })',
    '}',
    '',
    '// ── The model panel. Status honesty: the button is enabled only when the',
    '// server can actually reach a model, and the reason is always on screen. ──',
    'async function refreshModelPanel(): Promise<void> {',
    "  const note = document.getElementById('model-note')",
    "  const btn = document.getElementById('model-move') as HTMLButtonElement | null",
    '  if (!note || !btn) return',
    '  try {',
    "    const status = await (await fetch('/model/status')).json()",
    '    if (status.reachable) {',
    '      btn.disabled = false',
    "      note.textContent = 'Model ready: ' + status.model + ' via ' + status.baseUrl",
    '    } else {',
    '      btn.disabled = true',
    '      note.textContent =',
    "        'No model reachable at ' + status.baseUrl + '. The game works fine without one — '",
    "        + 'to invite one, run Ollama locally, or copy .env.example to .env for a hosted key.'",
    '    }',
    '  } catch {',
    "    note.textContent = 'Model status unavailable — is `bun run server` up?'",
    '  }',
    '}',
    '',
    'function wireModelPanel(): void {',
    "  const note = document.getElementById('model-note')",
    "  const btn = document.getElementById('model-move') as HTMLButtonElement | null",
    '  if (!note || !btn) return',
    "  btn.addEventListener('click', async () => {",
    '    btn.disabled = true',
    "    note.textContent = 'Thinking…'",
    '    try {',
    "      const res = await fetch('/model/move', { method: 'POST' })",
    '      const out = await res.json()',
    '      // The board updates by itself: the guess arrived over the bridge.',
    '      note.textContent = out.word',
    "        ? 'Model guessed “' + out.word + '”.'",
    "        : 'Model could not move: ' + (out.detail ?? out.error ?? 'unknown error')",
    '    } catch {',
    "      note.textContent = 'Model call failed — is `bun run server` up?'",
    '    }',
    '    btn.disabled = false',
    '  })',
    '  void refreshModelPanel()',
    '}',
    '',
    'function start(): void {',
    '  connectBridge()',
    '  wireModelPanel()',
    '}',
    '',
    "if (document.readyState === 'loading') {",
    "  document.addEventListener('DOMContentLoaded', start)",
    '} else {',
    '  start()',
    '}',
    '',
  ]
  return lines.join('\n')
}

// ─── readiness.ts ────────────────────────────────────────────────────────────

export function fullReadinessTs(name: string): string {
  const lines = [
    '/**',
    ' * The machine-readable discovery surface: what an agent that has only this',
    " * app's URL reads to learn what the app is and how to drive it.",
    ' *',
    ' * Served LIVE by the same process that runs the gate, because that is the',
    ' * process whose @aihu/agent registry is populated — every document below is',
    ' * derived from it, so the advertised tools cannot drift from the callable',
    ' * ones. (A client-only `vite build` has an empty registry: a statically',
    ' * emitted card would advertise zero tools. That is also why this build',
    " * doesn't ship one.)",
    ' */',
    '',
    "import { createAgentReadinessRoutes, skillsFromRegistry } from '@aihu-plugin/agent-readiness'",
    '',
    `const NAME = '${name}'`,
    "const VERSION = '0.1.0'",
    'const SUMMARY =',
    "  'A co-op word game in one aihu component, played by a human on screen AND " +
      'drivable by agents: an approved guess executes against the same live ' +
      "on-screen board over a capability bridge.'",
    '',
    '/** pathname -> the handler that answers it. */',
    'const ROUTES = {',
    "  '/llms.txt': 'llmsTxt',",
    "  '/llms-full.txt': 'llmsFullTxt',",
    "  '/robots.txt': 'robotsTxt',",
    "  '/.well-known/mcp/server-card.json': 'mcpServerCard',",
    "  '/.well-known/agent-card.json': 'a2aCard',",
    '  // Deprecated A2A alias (pre-v0.3.0 path); served with a Deprecation header.',
    "  '/.well-known/agent.json': 'a2aCard',",
    "  '/.well-known/mcp.json': 'mcpDiscovery',",
    "  '/sitemap.xml': 'sitemapXml',",
    '} as const',
    '',
    'export const READINESS_PATHS: readonly string[] = Object.keys(ROUTES)',
    '',
    '// Routes are built for the origin the request actually arrived on: the',
    '// documents embed absolute URLs, and vite proxies these paths with',
    '// `changeOrigin: false`, so a fetch of :5108/llms.txt emits :5108 links.',
    'function routesFor(origin: string) {',
    '  return createAgentReadinessRoutes({',
    '    name: NAME,',
    '    version: VERSION,',
    '    summary: SUMMARY,',
    '    siteUrl: origin,',
    '    // Where the advertised tools are actually invoked. CAVEAT the card cannot',
    "    // state: transport.type says 'streamable-http', but /agent/call speaks",
    "    // aihu's { tool, params, userId, jwt } shape. A raw MCP client should",
    '    // spawn `bun mcp.ts` (stdio) instead — llms.txt says so below.',
    "    endpoint: origin + '/agent/call',",
    '    mcpDiscovery: true,',
    '    // One page, listed honestly: an UNSERVED /sitemap.xml would fall through',
    '    // to the SPA fallback and 200 with index.html.',
    "    sitemapPages: [{ url: origin + '/' }],",
    "    sitemap: origin + '/sitemap.xml',",
    '    // Hand the A2A card the registry-derived skills — `a2aCard: true` alone',
    '    // emits a card with NO skills (it does not read the registry itself).',
    '    a2aCard: { skills: skillsFromRegistry() },',
    '    llmsSections: [',
    '      {',
    "        title: 'Agent interface',",
    '        links: [',
    '          {',
    "            title: 'Call an action',",
    "            url: origin + '/agent/call',",
    '            description:',
    `              'POST application/json { "tool": "${TAG}/<action>", "params": [...], ` +
      `"jwt": "${SCOPE}" }. The transport status is always 200; READ THE BODY — ` +
      '{ "result": ... } or { "error", "code" } with 404 (undeclared tool), 401 ' +
      `(no credential), 403 (missing the ${SCOPE} scope) or 429 (past ${RATE} calls ` +
      "per verified subject). An approved guess lands on the live on-screen board.',",
    '          },',
    '          {',
    "            title: 'Read live state',",
    "            url: origin + '/agent/state',",
    "            description: 'GET — the board an approved guess would act on.',",
    '          },',
    '          {',
    "            title: 'MCP server card',",
    "            url: origin + '/.well-known/mcp/server-card.json',",
    "            description: 'The callable tools, derived from the live component registry.',",
    '          },',
    '          {',
    "            title: 'A2A agent card',",
    "            url: origin + '/.well-known/agent-card.json',",
    "            description: 'Agent-to-agent discovery card for the same surface.',",
    '          },',
    '        ],',
    '      },',
    '    ],',
    '    llmsOptional: [',
    '      {',
    "        title: 'MCP over stdio',",
    "        url: origin + '/.well-known/mcp.json',",
    '        description:',
    "          'This app serves MCP over STDIO: register `bun mcp.ts` with your MCP " +
      'client. /agent/call is not an MCP streamable-http endpoint — it speaks the ' +
      "aihu call shape documented there.',",
    '      },',
    '    ],',
    '  })',
    '}',
    '',
    '/** Answer a discovery request, or undefined when the path is not ours. */',
    'export async function handleReadiness(req: Request): Promise<Response | undefined> {',
    '  const url = new URL(req.url)',
    '  const key = ROUTES[url.pathname as keyof typeof ROUTES]',
    '  if (!key) return undefined',
    '  const res = await routesFor(url.origin)[key](req, { params: {}, url })',
    '  return res.status === 404 ? undefined : res',
    '}',
    '',
  ]
  return lines.join('\n')
}

// ─── server.ts ───────────────────────────────────────────────────────────────

export function fullServerTs(): string {
  const lines = [
    '/**',
    ' * Bun capability-bridge server: the GOVERNED entry, plus the model player.',
    ' *',
    ' *   CALLER --POST /agent/call--> createAgentServer (the 404→401→403→429 gate)',
    ' *                                    | approved { opaqueActionId, args }',
    ' *                                    v',
    ' *   BROWSER (ws /bridge) <-- the real <word-duet> executes; the board updates.',
    ' *',
    ' * The model player is deliberately NOT special: when asked for a move it reads',
    ' * the live board, prompts the configured model, and then calls the SAME gate',
    ` * with the same scope ('${SCOPE}') any outside agent needs. One surface,`,
    ' * every caller.',
    ' *',
    ' * SECURITY: the auth/rate-limit plugins are demo-grade (a real app uses',
    ' * @aihu/auth + a durable store), and the bridge itself is unauthenticated —',
    ' * local dev only; do not expose /agent or /bridge to untrusted networks.',
    ' */',
    '',
    "import { registerAgentMetadata } from '@aihu/agent'",
    "import type { BridgeChannel } from '@aihu/agent-server'",
    "import { createAgentServer } from '@aihu/agent-server'",
    "import { branch, leaf } from '@aihu/arbor'",
    "import { type Signal, signal } from '@aihu/signals'",
    "import { READINESS_PATHS, handleReadiness } from './readiness.ts'",
    '',
    `const TAG = '${TAG}'`,
    'const PORT = 5208',
    '',
    '// The agent surface the gate authorizes against (mirrors the component).',
    'registerAgentMetadata({',
    '  tag: TAG,',
    "  describes: 'A co-op five-letter word game: guess, get per-letter feedback.',",
    '  actions: {',
    ...METADATA_ACTIONS,
    '  },',
    '  state: {',
    ...METADATA_STATE,
    '  },',
    '})',
    '',
    '// ── Governance (demo-grade): a "jwt" here is a comma-list of granted scopes.',
    '// The gate refuses to serve scoped tools without a verifier, and the rate-',
    '// limit key comes from the VERIFIED subject — rotating userId buys nothing.',
    'const authPlugin = {',
    '  verify: async (jwt: string) => {',
    "    const scopes = jwt.split(',').map((s) => s.trim()).filter(Boolean)",
    '    if (scopes.length === 0) return null',
    "    return { sub: 'caller:' + scopes.join('+'), scope: scopes.join(' ') }",
    '  },',
    '  checkScope: (jwt: string, scope: string) =>',
    "    jwt.split(',').map((x) => x.trim()).includes(scope),",
    '}',
    'const _rl = new Map<string, number>()',
    'const rateLimitPlugin = {',
    '  checkRateLimit: (rateSpec: string, key: string) => {',
    `    const max = Number(rateSpec) || ${RATE}`,
    '    const n = (_rl.get(key) ?? 0) + 1',
    '    _rl.set(key, n)',
    '    return n <= max',
    '  },',
    '}',
    '',
    '// A server-mounted twin so the gate can resolve the tag before a browser',
    '// connects. Never executed while the bridge is attached — the visible',
    '// instance is authoritative.',
    'const [twinLen, setTwinLen] = signal(0)',
    "const twinNode = branch('div', { id: TAG + '-twin' }, [",
    '  leaf([twinLen, setTwinLen] as unknown as Signal<string>),',
    '])',
    'const server = createAgentServer({',
    '  target: {',
    '    node: twinNode,',
    '    agentBinding: {',
    '      tag: TAG,',
    '      actions: {',
    ...BINDING_ACTIONS,
    '      },',
    TWIN_READS,
    '      writes: {},',
    `      scope: '${SCOPE}',`,
    `      rateLimit: '${RATE}',`,
    '    },',
    '  },',
    '  authPlugin,',
    '  rateLimitPlugin,',
    '})',
    '',
    '// ── The model player. Local first: the defaults point at Ollama, which needs',
    '// no key. Any OpenAI-compatible /chat/completions endpoint works; a key (for',
    '// hosted providers) lives in .env — gitignored — and only ever in THIS process.',
    // A `\\/+$/`-anchored regex here would be a ReDoS on a pathological env
    // var (CodeQL js/polynomial-redos) — a plain trailing-slash trim instead.
    'function stripTrailingSlashes(s: string): string {',
    '  let end = s.length',
    "  while (end > 0 && s[end - 1] === '/') end--",
    '  return s.slice(0, end)',
    '}',
    "const MODEL_BASE_URL = stripTrailingSlashes(process.env.MODEL_BASE_URL ?? 'http://localhost:11434/v1')",
    "const MODEL_NAME = process.env.MODEL_NAME ?? 'llama3.2'",
    'const MODEL_API_KEY = process.env.MODEL_API_KEY',
    '',
    'const modelHeaders = (): Record<string, string> => ({',
    "  'content-type': 'application/json',",
    "  ...(MODEL_API_KEY ? { authorization: 'Bearer ' + MODEL_API_KEY } : {}),",
    '})',
    '',
    'async function modelStatus() {',
    '  const base = { baseUrl: MODEL_BASE_URL, model: MODEL_NAME, keyPresent: Boolean(MODEL_API_KEY) }',
    '  try {',
    "    const res = await fetch(MODEL_BASE_URL + '/models', {",
    '      headers: modelHeaders(),',
    '      signal: AbortSignal.timeout(1500),',
    '    })',
    '    return { ...base, reachable: res.ok }',
    '  } catch {',
    '    return { ...base, reachable: false }',
    '  }',
    '}',
    '',
    'type Cell = { ch: string; mark: string }',
    '',
    'function describeBoard(state: unknown): string {',
    '  const rows = (state as { board?: Cell[][] })?.board ?? []',
    "  if (rows.length === 0) return 'No guesses yet — open with a strong first word.'",
    '  return rows',
    '    .map((row) =>',
    "      row.map((c) => c.ch.toUpperCase() + '=' + c.mark).join(' '),",
    '    )',
    "    .join('\\n')",
    '}',
    '',
    'async function modelMove(): Promise<Record<string, unknown>> {',
    '  const state = server.serialize()',
    '  const messages = [',
    '    {',
    "      role: 'system',",
    '      content:',
    "        'You are playing a co-operative word game. The hidden word has exactly " +
      'five letters. Feedback per guessed letter: correct = right letter in the right ' +
      'position; present = in the word, different position; absent = not in the word. ' +
      "Choose the single best next guess. Reply with ONLY one five-letter word.',",
    '    },',
    '    {',
    "      role: 'user',",
    "      content: 'Board so far:\\n' + describeBoard(state) + '\\nYour guess:',",
    '    },',
    '  ]',
    '  let res: Response',
    '  try {',
    "    res = await fetch(MODEL_BASE_URL + '/chat/completions', {",
    "      method: 'POST',",
    '      headers: modelHeaders(),',
    '      body: JSON.stringify({ model: MODEL_NAME, messages, max_tokens: 300 }),',
    '      signal: AbortSignal.timeout(30000),',
    '    })',
    '  } catch {',
    "    return { error: 'model-unreachable', detail: 'no answer from ' + MODEL_BASE_URL }",
    '  }',
    '  if (!res.ok) {',
    "    return { error: 'model-error', detail: 'HTTP ' + res.status + ' from ' + MODEL_BASE_URL }",
    '  }',
    '  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }',
    "  const text = String(data.choices?.[0]?.message?.content ?? '')",
    '  // Take the LAST five-letter token: models that think out loud usually end',
    '  // with their answer.',
    '  const words = text.toLowerCase().match(/[a-z]{5}(?![a-z])/g)',
    '  const word = words?.[words.length - 1]',
    '  if (!word) {',
    "    return { error: 'no-word', detail: 'model replied without a five-letter word: ' + text.slice(0, 120) }",
    '  }',
    '  // Through the SAME gate as any outside agent — scope, rate limit and all.',
    "  const call = await server.callTool(TAG + '/guess', [word], {",
    "    userId: 'model-player',",
    `    jwt: '${SCOPE}',`,
    '  })',
    '  return { word, call }',
    '}',
    '',
    'type BunWs = { send(data: string): void; readyState: number }',
    'const messageHandlers = new Set<(data: string) => void>()',
    'const closeHandlers = new Set<() => void>()',
    '',
    'function bridgeChannelFor(ws: BunWs): BridgeChannel {',
    '  return {',
    '    get connected() {',
    '      return ws.readyState === 1',
    '    },',
    '    send(data) {',
    '      ws.send(data)',
    '    },',
    '    onMessage(handler) {',
    '      messageHandlers.add(handler)',
    '      return () => messageHandlers.delete(handler)',
    '    },',
    '    onClose(handler) {',
    '      closeHandlers.add(handler)',
    '      return () => closeHandlers.delete(handler)',
    '    },',
    '  }',
    '}',
    '',
    'let detachBridge: (() => void) | null = null',
    '',
    'Bun.serve<{ bridge: boolean }>({',
    '  port: PORT,',
    '  async fetch(req, srv): Promise<Response | undefined> {',
    '    const url = new URL(req.url)',
    "    if (url.pathname === '/bridge') {",
    '      if (srv.upgrade(req, { data: { bridge: true } })) return undefined',
    "      return new Response('expected websocket', { status: 426 })",
    '    }',
    ...READINESS_DISPATCH,
    "    if (url.pathname === '/agent/call' && req.method === 'POST') {",
    '      const body = (await req.json()) as {',
    '        tool: string',
    '        params?: unknown',
    '        userId?: string',
    '        jwt?: string',
    '      }',
    '      const result = await server.callTool(body.tool, body.params ?? [], {',
    "        userId: body.userId ?? 'agent',",
    "        jwt: body.jwt ?? '',",
    '      })',
    '      return Response.json(result)',
    '    }',
    "    if (url.pathname === '/agent/state') {",
    '      return Response.json(server.serialize())',
    '    }',
    "    if (url.pathname === '/model/status') {",
    '      return Response.json(await modelStatus())',
    '    }',
    "    if (url.pathname === '/model/move' && req.method === 'POST') {",
    '      const out = await modelMove()',
    '      return Response.json(out, { status: out.error ? 502 : 200 })',
    '    }',
    "    return new Response('not found', { status: 404 })",
    '  },',
    '  websocket: {',
    '    open(ws) {',
    '      detachBridge?.()',
    '      detachBridge = server.attachBridge(bridgeChannelFor(ws as unknown as BunWs))',
    "      console.log('[bridge] browser connected — the board on screen is now the executor')",
    '    },',
    '    message(_ws, message) {',
    "      const data = typeof message === 'string' ? message : message.toString()",
    '      for (const h of [...messageHandlers]) h(data)',
    '    },',
    '    close() {',
    '      for (const h of [...closeHandlers]) h()',
    '      messageHandlers.clear()',
    '      closeHandlers.clear()',
    '    },',
    '  },',
    '})',
    '',
    `console.log('[${TAG}] gate + bridge on http://localhost:' + PORT + ' (scope ${SCOPE}, ${RATE} calls/key)')`,
    "console.log('  POST /agent/call    { tool, params, userId, jwt }  drive the board')",
    "console.log('  GET  /agent/state                                  read the live board')",
    "console.log('  GET  /model/status  POST /model/move               the invited model')",
    "console.log('  WS   /bridge                                       browser capability bridge')",
    "console.log('  GET  ' + READINESS_PATHS.join(', '))",
    '',
  ]
  return lines.join('\n')
}

// ─── mcp.ts ──────────────────────────────────────────────────────────────────

export function fullMcpTs(): string {
  const lines = [
    '/**',
    ' * MCP stdio entry: your MCP client (Claude, Cursor) spawns this, discovers',
    ` * the ${TAG} tools, and plays the live board in front of you.`,
    ' *',
    ' * OPEN by design (no scope/rate limit) so an AI client can play with zero',
    ' * auth friction; server.ts is the governed entry that demonstrates the gate.',
    ' * stdout is the MCP JSON-RPC channel — all logging goes to stderr.',
    ' */',
    '',
    "import { getAllAgentMetadata, registerAgentMetadata } from '@aihu/agent'",
    "import type { BridgeChannel } from '@aihu/agent-server'",
    "import { createAgentServer, serveComponentMcp } from '@aihu/agent-server'",
    "import { branch, leaf } from '@aihu/arbor'",
    "import { type Signal, signal } from '@aihu/signals'",
    "import { handleReadiness } from './readiness.ts'",
    '',
    `const TAG = '${TAG}'`,
    'const PORT = 5208',
    '',
    'registerAgentMetadata({',
    '  tag: TAG,',
    "  describes: 'A co-op five-letter word game: guess, get per-letter feedback.',",
    '  actions: {',
    ...METADATA_ACTIONS,
    '  },',
    '  state: {',
    ...METADATA_STATE,
    '  },',
    '})',
    '',
    'const [twinLen, setTwinLen] = signal(0)',
    "const twinNode = branch('div', { id: TAG + '-twin' }, [",
    '  leaf([twinLen, setTwinLen] as unknown as Signal<string>),',
    '])',
    'const server = createAgentServer({',
    '  target: {',
    '    node: twinNode,',
    '    agentBinding: {',
    '      tag: TAG,',
    '      actions: {',
    ...BINDING_ACTIONS,
    '      },',
    TWIN_READS,
    '      writes: {},',
    '      scope: undefined,',
    '      rateLimit: undefined,',
    '    },',
    '  },',
    '})',
    '',
    'type BunWs = { send(data: string): void; readyState: number }',
    'const messageHandlers = new Set<(data: string) => void>()',
    'const closeHandlers = new Set<() => void>()',
    '',
    'function bridgeChannelFor(ws: BunWs): BridgeChannel {',
    '  return {',
    '    get connected() {',
    '      return ws.readyState === 1',
    '    },',
    '    send(data) {',
    '      ws.send(data)',
    '    },',
    '    onMessage(handler) {',
    '      messageHandlers.add(handler)',
    '      return () => messageHandlers.delete(handler)',
    '    },',
    '    onClose(handler) {',
    '      closeHandlers.add(handler)',
    '      return () => closeHandlers.delete(handler)',
    '    },',
    '  }',
    '}',
    '',
    'let detachBridge: (() => void) | null = null',
    '',
    '// WS bridge for the browser instance. stdout is MCP — log to stderr only.',
    'Bun.serve<{ bridge: boolean }>({',
    '  port: PORT,',
    '  async fetch(req, srv): Promise<Response | undefined> {',
    '    const url = new URL(req.url)',
    "    if (url.pathname === '/bridge') {",
    '      if (srv.upgrade(req, { data: { bridge: true } })) return undefined',
    "      return new Response('expected websocket', { status: 426 })",
    '    }',
    ...READINESS_DISPATCH,
    "    if (url.pathname === '/agent/state') return Response.json(server.serialize())",
    "    return new Response('not found', { status: 404 })",
    '  },',
    '  websocket: {',
    '    open(ws) {',
    '      detachBridge?.()',
    '      detachBridge = server.attachBridge(bridgeChannelFor(ws as unknown as BunWs))',
    "      console.error('[mcp] browser bridge connected')",
    '    },',
    '    message(_ws, message) {',
    "      const data = typeof message === 'string' ? message : message.toString()",
    '      for (const h of [...messageHandlers]) h(data)',
    '    },',
    '    close() {',
    '      for (const h of [...closeHandlers]) h()',
    '      messageHandlers.clear()',
    '      closeHandlers.clear()',
    '    },',
    '  },',
    '})',
    '',
    "console.error('[mcp] WS bridge on :' + PORT + ' — serving MCP over stdio')",
    '',
    "// Tool names are '<tag>/<action>', e.g. 'word-duet/guess'. When the browser",
    '// is connected, each tools/call executes on the visible board.',
    'await serveComponentMcp(server, getAllAgentMetadata())',
    '',
  ]
  return lines.join('\n')
}

// ─── .env.example / .gitignore ───────────────────────────────────────────────

export function fullEnvExample(): string {
  const lines = [
    '# The model player is OPTIONAL — the game is fully playable without any of this.',
    '#',
    '# Local, no key: install Ollama (https://ollama.com), `ollama pull llama3.2`,',
    '# and you are done — the defaults below are already what the server assumes.',
    '#MODEL_BASE_URL=http://localhost:11434/v1',
    '#MODEL_NAME=llama3.2',
    '#',
    '# Hosted (bring your own key): any OpenAI-compatible /chat/completions endpoint.',
    '# A key lives HERE and only here — .env is gitignored; never put one in source,',
    '# and it never reaches the browser (the model runs server-side).',
    '#MODEL_BASE_URL=https://api.openai.com/v1',
    '#MODEL_NAME=gpt-4o-mini',
    '#MODEL_API_KEY=',
    '',
  ]
  return lines.join('\n')
}

export function fullGitignore(): string {
  return ['node_modules', 'dist', '.env', '*.local', ''].join('\n')
}

// ─── README.md ───────────────────────────────────────────────────────────────

export function fullReadme(name: string): string {
  const lines = [
    `# ${name}`,
    '',
    'Built with [aihu](https://github.com/aihu-project/aihu) — Web Components that humans',
    'use and agents drive, from one source. This app is a co-op word game in one',
    `component (\`<${TAG}>\`) with exactly two actions — and three kinds of player.`,
    '',
    '## Run it',
    '',
    '```bash',
    'bun install',
    'bun run dev      # game on :5108, gate + model player on :5208 (proxied)',
    '```',
    '',
    '## Play it three ways',
    '',
    '1. **You** — open http://localhost:5108 and type a five-letter guess.',
    '2. **A model** — no key needed if [Ollama](https://ollama.com) is running',
    '   (`ollama pull llama3.2`); for a hosted model, `cp .env.example .env` and add',
    '   a key. Then press **"Model plays the next guess"** and watch the same board.',
    '3. **Any MCP agent** — register the stdio server with your MCP client:',
    '',
    '   ```bash',
    `   claude mcp add ${name} -- bun /ABSOLUTE/PATH/TO/${name}/mcp.ts`,
    '   ```',
    '',
    '   (Run `vite` for the page separately in that case — `mcp.ts` and `server.ts`',
    '   share port 5208, so run one or the other.) Or drive the governed HTTP gate',
    '   directly and watch every guardrail answer:',
    '',
    '   ```bash',
    '   # approved — the guess lands on the on-screen board:',
    "   curl -XPOST localhost:5108/agent/call -H 'content-type: application/json' \\",
    `     -d '{"tool":"${TAG}/guess","params":["crane"],"userId":"you","jwt":"${SCOPE}"}'`,
    '',
    `   # wrong scope -> 403 in the body; more than ${RATE} calls/subject -> 429.`,
    "   curl -XPOST localhost:5108/agent/call -H 'content-type: application/json' \\",
    `     -d '{"tool":"${TAG}/guess","params":["crane"],"userId":"you","jwt":"other:scope"}'`,
    '   ```',
    '',
    'All three go through the same `$action` surface declared in',
    `\`src/${TAG}.aihu\` — the input box, the model player and the curl call end in`,
    'the same function. That is the point of aihu.',
    '',
    '## Which file does what',
    '',
    '| You want to… | Edit |',
    '| --- | --- |',
    `| Change the game, board, or styles | \`src/${TAG}.aihu\` |`,
    `| Change what agents may call | the \`$action\` block in \`src/${TAG}.aihu\` — llms.txt and both cards follow automatically |`,
    '| Change the page around the game | `index.html` |',
    '| Gate or rate-limit agent calls | `server.ts` (`authPlugin` / `rateLimitPlugin`) |',
    '| Point at a different model | `.env` (never commit a key — `.gitignore` already covers `.env`) |',
    '| Change what agents discover | `readiness.ts` (the documents derive from the registry — edit the summary, not the tool list) |',
    '| Title / description / og tags | the `<head>` of `index.html` |',
    '',
    '## How this app is served (and what it may claim)',
    '',
    '- **`bun run dev` / a deployed server** — the page is static, and the Bun server',
    '  beside it answers agent calls live. In this mode "agents can drive it" is',
    '  true, and llms.txt + the MCP/A2A cards are generated from the live registry,',
    '  so they list exactly the callable tools.',
    '- **`bun run build` alone** — a static site any host can serve. The game still',
    '  works for humans; nothing is callable, so this build ships **no** llms.txt or',
    '  cards claiming otherwise. Deploying the static build and claiming agent',
    '  tools would be lying to every agent that reads it — the scaffold refuses to.',
    '',
    '## Deploy',
    '',
    '1. **The page** (static): `bun run build`, upload `dist/` anywhere.',
    '2. **The agent surface** (`server.ts`): needs a Bun-capable host (Railway, Fly,',
    '   a VPS) — or adapt to Cloudflare Workers with `@aihu/adapter-cloudflare`.',
    '3. Until the server is deployed, your public site has no agent surface — and',
    "   honestly says so. Don't ship the claim before the capability.",
    '',
    'Human steps a scaffold cannot do for you: create the host account, set its',
    'token/secrets, point DNS. Four steps, not zero — but each is a one-timer.',
    '',
    '## Make it yours',
    '',
    `Seasoned? Delete \`src/${TAG}.aihu\`, drop your own component into \`index.html\`,`,
    'and delete this README. **Keep** `server.ts`, `readiness.ts` and `mcp.ts` —',
    'they are your agent surface, not demo code: declare `$action`s on your own',
    'component, update the `registerAgentMetadata` block to match, and every',
    'discovery document follows.',
    '',
    '## Security',
    '',
    'The capability bridge is **unauthenticated** — local dev/demo only. Do not',
    'expose `/agent/call` or `/bridge` to untrusted networks without real auth',
    '(`@aihu/auth`) and origin checks. The server is the sole policy authority:',
    "only actions declared in the component's `@agent` block are callable, with",
    'the declared scope and rate limit.',
    '',
  ]
  return lines.join('\n')
}

// ─── AGENTS.md facts + the file set ──────────────────────────────────────────

export function fullAgentsFacts(name: string): AgentsMdFacts {
  return {
    name,
    commands: [
      ['bun run dev', 'Bridge server (:5208) + Vite (:5108) together'],
      ['bun run server', 'Just the Bun gate/bridge/model-player server'],
      [
        'bun run build',
        'Static production build to dist/ (page only — no agent surface, by design)',
      ],
      ['bun run typecheck', 'tsc --noEmit over server.ts, mcp.ts, readiness.ts, src/'],
    ],
    map: [
      [`src/${TAG}.aihu`, 'The game component — the demo to delete when you build your own'],
      ['src/main.ts', 'Browser entry: bridge client + model panel wiring'],
      ['server.ts', 'Governed gate (auth scope + rate limit) + the model player'],
      ['readiness.ts', 'llms.txt + MCP/A2A cards, derived live from the registry'],
      ['mcp.ts', 'MCP stdio entry for standard MCP clients'],
      ['index.html', 'The page shell and <head> defaults'],
    ],
  }
}

/**
 * The complete `full` template file set. `agentTooling` (default true) controls
 * ONLY the coding-assistant files (AGENTS.md / CLAUDE.md / .mcp.json) — the
 * app's own runtime agent surface is the template's point and is not optional.
 */
export function fullTemplateFiles(
  name: string,
  pm: PkgManager,
  opts?: { agentTooling?: boolean },
): Array<readonly [string, string]> {
  const files: Array<readonly [string, string]> = [
    ['package.json', agentPackageJson(name, pm)],
    // Same reason as the `minimal`/`docs` scaffold: pnpm reads its settings
    // from this file only, and without `allowBuilds` the first `pnpm install`
    // fails with ERR_PNPM_IGNORED_BUILDS. Emitted for
    // every package manager so the failure cannot depend on which one the
    // project was born with.
    ['pnpm-workspace.yaml', pnpmWorkspaceYaml()],
    ['vite.config.ts', fullViteConfig()],
    ['tsconfig.json', agentTsConfig()],
    ['index.html', fullIndexHtml(name)],
    ['server.ts', fullServerTs()],
    ['mcp.ts', fullMcpTs()],
    ['readiness.ts', fullReadinessTs(name)],
    ['.env.example', fullEnvExample()],
    ['.gitignore', fullGitignore()],
    ['src/main.ts', fullMainTs()],
    [`src/${TAG}.aihu`, fullComponentAihu()],
    ['src/aihu-modules.d.ts', agentModuleShim()],
    ['README.md', fullReadme(name)],
    ...vscodeFiles(),
  ]
  if (opts?.agentTooling !== false) {
    files.push(...agentToolingFiles(fullAgentsFacts(name)))
  }
  return files
}
