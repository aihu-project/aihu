#!/usr/bin/env bun
/**
 * scripts/tracker-cache/sync.ts — refresh the local tracker cache.
 *
 * Pulls GitHub issues, GitHub PRs (with check-run status), and Linear tasks
 * into .cache/tracker.db so routine lookups (`query.ts`) never need a live
 * API call or an MCP round-trip. Run on a schedule — see README.md for the
 * launchd setup — or by hand: `bun scripts/tracker-cache/sync.ts`.
 *
 * Each source is fetched and upserted independently: a Linear outage must
 * not block the GitHub refresh, and vice versa. sync_log records ok=0 with
 * the error for whichever source failed, so a stale-but-present row in
 * github_issues/linear_issues is never silently mistaken for "just synced".
 */
import { execFileSync } from 'node:child_process'
import { CACHE_DIR, DB_PATH, nowIso, openDb } from './db.ts'
import { fetchLinearIssues, hasLinearToken } from './linear.ts'

const REPO = 'aihu-project/aihu'

function gh(args: string[]): unknown {
  const out = execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return JSON.parse(out)
}

interface GhIssue {
  number: number
  title: string
  state: string
  stateReason: string | null
  labels: { name: string }[]
  assignees: { login: string }[]
  body: string
  url: string
  createdAt: string
  updatedAt: string
  closedAt: string | null
  closedByPullRequestsReferences: { number: number; url: string }[]
}

interface GhPr {
  number: number
  title: string
  state: string
  isDraft: boolean
  baseRefName: string
  headRefName: string
  mergeable: string
  statusCheckRollup: { name: string; status?: string; conclusion?: string; state?: string }[]
  url: string
  createdAt: string
  updatedAt: string
  mergedAt: string | null
  closedAt: string | null
}

function syncGithubIssues(db: ReturnType<typeof openDb>): { count: number } {
  const issues = gh([
    'issue',
    'list',
    '--repo',
    REPO,
    '--state',
    'all',
    '--limit',
    '1000',
    '--json',
    'number,title,state,stateReason,labels,assignees,body,url,createdAt,updatedAt,closedAt,closedByPullRequestsReferences',
  ]) as GhIssue[]

  const upsert = db.prepare(`
    INSERT INTO github_issues (number, title, state, state_reason, labels_json, assignees_json, body, url, created_at, updated_at, closed_at, closed_by_prs_json, synced_at)
    VALUES ($number, $title, $state, $state_reason, $labels_json, $assignees_json, $body, $url, $created_at, $updated_at, $closed_at, $closed_by_prs_json, $synced_at)
    ON CONFLICT(number) DO UPDATE SET
      title=excluded.title, state=excluded.state, state_reason=excluded.state_reason,
      labels_json=excluded.labels_json, assignees_json=excluded.assignees_json, body=excluded.body,
      url=excluded.url, created_at=excluded.created_at, updated_at=excluded.updated_at,
      closed_at=excluded.closed_at, closed_by_prs_json=excluded.closed_by_prs_json, synced_at=excluded.synced_at
  `)
  const synced_at = nowIso()
  const tx = db.transaction((rows: GhIssue[]) => {
    for (const i of rows) {
      upsert.run({
        $number: i.number,
        $title: i.title,
        $state: i.state,
        $state_reason: i.stateReason,
        $labels_json: JSON.stringify(i.labels.map((l) => l.name)),
        $assignees_json: JSON.stringify(i.assignees.map((a) => a.login)),
        $body: i.body,
        $url: i.url,
        $created_at: i.createdAt,
        $updated_at: i.updatedAt,
        $closed_at: i.closedAt,
        $closed_by_prs_json: JSON.stringify(i.closedByPullRequestsReferences),
        $synced_at: synced_at,
      })
    }
  })
  tx(issues)
  return { count: issues.length }
}

function syncGithubPrs(db: ReturnType<typeof openDb>): { count: number } {
  const prs = gh([
    'pr',
    'list',
    '--repo',
    REPO,
    '--state',
    'all',
    '--limit',
    '1000',
    '--json',
    'number,title,state,isDraft,baseRefName,headRefName,mergeable,statusCheckRollup,url,createdAt,updatedAt,mergedAt,closedAt',
  ]) as GhPr[]

  const upsert = db.prepare(`
    INSERT INTO github_prs (number, title, state, is_draft, base_ref, head_ref, mergeable, checks_json, url, created_at, updated_at, merged_at, closed_at, synced_at)
    VALUES ($number, $title, $state, $is_draft, $base_ref, $head_ref, $mergeable, $checks_json, $url, $created_at, $updated_at, $merged_at, $closed_at, $synced_at)
    ON CONFLICT(number) DO UPDATE SET
      title=excluded.title, state=excluded.state, is_draft=excluded.is_draft, base_ref=excluded.base_ref,
      head_ref=excluded.head_ref, mergeable=excluded.mergeable, checks_json=excluded.checks_json,
      url=excluded.url, created_at=excluded.created_at, updated_at=excluded.updated_at,
      merged_at=excluded.merged_at, closed_at=excluded.closed_at, synced_at=excluded.synced_at
  `)
  const synced_at = nowIso()
  const tx = db.transaction((rows: GhPr[]) => {
    for (const p of rows) {
      const state = p.state === 'MERGED' ? 'MERGED' : p.state
      upsert.run({
        $number: p.number,
        $title: p.title,
        $state: state,
        $is_draft: p.isDraft ? 1 : 0,
        $base_ref: p.baseRefName,
        $head_ref: p.headRefName,
        $mergeable: p.mergeable,
        $checks_json: JSON.stringify(
          (p.statusCheckRollup ?? []).map((c) => ({
            name: c.name,
            status: c.status ?? c.state ?? null,
            conclusion: c.conclusion ?? null,
          })),
        ),
        $url: p.url,
        $created_at: p.createdAt,
        $updated_at: p.updatedAt,
        $merged_at: p.mergedAt,
        $closed_at: p.closedAt,
        $synced_at: synced_at,
      })
    }
  })
  tx(prs)
  return { count: prs.length }
}

async function syncLinearIssues(db: ReturnType<typeof openDb>): Promise<{ count: number }> {
  if (!hasLinearToken())
    throw new Error('LINEAR_API_KEY not present in keychain — see swarm/README setup')
  const issues = await fetchLinearIssues()

  const upsert = db.prepare(`
    INSERT INTO linear_issues (identifier, title, state, project, assignee, labels_json, url, created_at, updated_at, synced_at)
    VALUES ($identifier, $title, $state, $project, $assignee, $labels_json, $url, $created_at, $updated_at, $synced_at)
    ON CONFLICT(identifier) DO UPDATE SET
      title=excluded.title, state=excluded.state, project=excluded.project, assignee=excluded.assignee,
      labels_json=excluded.labels_json, url=excluded.url, created_at=excluded.created_at,
      updated_at=excluded.updated_at, synced_at=excluded.synced_at
  `)
  const synced_at = nowIso()
  const tx = db.transaction((rows: typeof issues) => {
    for (const i of rows) {
      upsert.run({
        $identifier: i.identifier,
        $title: i.title,
        $state: i.state.name,
        $project: i.project?.name ?? null,
        $assignee: i.assignee?.name ?? null,
        $labels_json: JSON.stringify(i.labels.nodes.map((l) => l.name)),
        $url: i.url,
        $created_at: i.createdAt,
        $updated_at: i.updatedAt,
        $synced_at: synced_at,
      })
    }
  })
  tx(issues)
  return { count: issues.length }
}

function recordSyncResult(
  db: ReturnType<typeof openDb>,
  source: string,
  result: { count: number } | { error: string },
): void {
  const stmt = db.prepare(`
    INSERT INTO sync_log (source, last_synced_at, item_count, ok, error)
    VALUES ($source, $last_synced_at, $item_count, $ok, $error)
    ON CONFLICT(source) DO UPDATE SET
      last_synced_at=excluded.last_synced_at, item_count=excluded.item_count, ok=excluded.ok, error=excluded.error
  `)
  const ok = !('error' in result)
  stmt.run({
    $source: source,
    $last_synced_at: nowIso(),
    $item_count: ok ? (result as { count: number }).count : -1,
    $ok: ok ? 1 : 0,
    $error: ok ? null : (result as { error: string }).error,
  })
}

async function main(): Promise<void> {
  const db = openDb()
  console.log(`[tracker-cache] syncing into ${DB_PATH} (${CACHE_DIR})`)

  try {
    const r = syncGithubIssues(db)
    recordSyncResult(db, 'github_issues', r)
    console.log(`  github_issues: ${r.count} synced`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    recordSyncResult(db, 'github_issues', { error: msg })
    console.error(`  github_issues: FAILED — ${msg}`)
  }

  try {
    const r = syncGithubPrs(db)
    recordSyncResult(db, 'github_prs', r)
    console.log(`  github_prs: ${r.count} synced`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    recordSyncResult(db, 'github_prs', { error: msg })
    console.error(`  github_prs: FAILED — ${msg}`)
  }

  try {
    const r = await syncLinearIssues(db)
    recordSyncResult(db, 'linear_issues', r)
    console.log(`  linear_issues: ${r.count} synced`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    recordSyncResult(db, 'linear_issues', { error: msg })
    console.error(`  linear_issues: FAILED — ${msg}`)
  }

  db.close()
}

await main()
