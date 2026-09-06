//! swarm-bus — Rust reimplementation of the portable core of `~/.swarm/bus.py`.
//!
//! WHY THIS EXISTS
//!   bus.py is the ORACLE: a thin Python CLI over one SQLite file
//!   (`~/.swarm/bus.db`, overridable via `SWARM_DB`) that lets swarm agents
//!   broadcast/pull messages and negotiate work via CONTRACTs (offer → claim
//!   → verdict → reconciled status). This crate is a drop-in, compiled
//!   reimplementation against the *same* schema and the *same* exit-code
//!   contract: an empty result must never read like a broken query.
//!
//! INSTALLING (C-SWARM-DEPLOY-GAP)
//!   `bun run swarm:install` — builds release and installs to
//!   `~/.swarm/bin/swarm-bus`, then prints the build stamp so the install
//!   verifies itself. MERGING A packages/swarm PR DOES NOT DEPLOY IT; run that
//!   command, or the bus keeps executing whatever was installed last. Ask a
//!   binary what it is with `swarm-bus --version`.
//!
//! EXIT CODES (matches the oracle)
//!   0  = ok (including a successful non-empty `pull`/`watch`)
//!   2  = broken input: missing/unknown role, missing required field, no
//!        such contract, a verdict with no --contract, a blocked with no
//!        --question, a verdict reporting --status done with no (or
//!        malformed) --claims, or an unknown --status value
//!   3  = genuinely empty (a `pull`/`watch` with nothing new — NOT an error)
//!   4  = conflict (claiming a contract someone else already owns)
//!   5  = IDENTITY MISMATCH (bound_identity: role is registered to a
//!        different workspace than the one this process is running in)
//!   64 = unknown command / no command given
//!   1  = unexpected internal error (DB I/O etc.) — the oracle has no
//!        distinct code for this either; an uncaught Python exception also
//!        exits 1.
//!
//! FULL COMMAND SURFACE (parity with bus.py)
//!   send offer claim ack attempt setstatus pull watch ready sync link
//!   verify-merged
//!   (`status`, the oracle's pretty-printed contract table, is intentionally
//!   not reproduced here — it's a human dashboard, not a coordination
//!   primitive, and every field it prints is already reachable via `pull`/
//!   direct DB read. Nothing in the brief asked for it. `link` and
//!   `verify-merged` have no oracle counterpart at all — they exist solely
//!   for this crate's Linear/GitHub accountability sync; see ACCOUNTABILITY
//!   SYNC below.)
//!
//! TYPED PAYLOADS (docs/typed-bus-payloads.md, agent-swarm@design/typed-bus-payloads)
//!   The actionable parts of a message are validated FIELDS, not prose to be
//!   regexed downstream by a consumer. Concretely:
//!     - `msg.contract` (already existed) — a `verdict` MUST set it; rejected
//!       at the boundary (exit 2) if absent, never silently accepted.
//!     - `msg.pr` (new, nullable INTEGER) / `msg.claims` (new, nullable TEXT,
//!       "verb:target,verb:target") — optional structured fields on `send`.
//!     - a `blocked` MUST set `--question` (exit 2 if absent) — the one
//!       thing a human must decide, not buried in `body`.
//!     - `contract.needs` (new, nullable TEXT, comma-separated contract ids)
//!       — the Graph/DAG edge. `ready --id C` reports whether every upstream
//!       need has reached a satisfied status.
//!     - `msg.vstatus` (new, nullable TEXT, one of `done`/`blocked`/
//!       `could-not-check`) — set via `send --status <value>`, mirroring the
//!       Verdict schema in the design doc. This is the FIELD, not prose,
//!       that answers "does this verdict report completion?" — the
//!       reconciler classifies a contract by checking a done-verdict's
//!       --claims against the agent's transcript, so a verdict that reports
//!       completion with nothing to check against is the same silent-failure
//!       class as a verdict with no --contract:
//!         - `--kind verdict --status done` (the default when `--status` is
//!           omitted, so pre-existing done-verdicts are still caught)
//!           REQUIRES a non-empty, well-formed `--claims` — rejected (exit 2)
//!           if absent.
//!         - `--kind verdict --status blocked` / `--status could-not-check`
//!           does NOT require `--claims` — there is legitimately nothing to
//!           claim.
//!         - an unknown `--status` value is rejected (exit 2), listing the
//!           three valid values.
//!     - `msg.claims` is VALIDATED, not merely required non-empty: it is a
//!       comma-separated list of `verb:target` pairs, where `verb` is one of
//!       `filed`, `pushed`, `merged`, `committed`, `ran`, `opened`, `closed`.
//!       An entry with no `:`, an unknown verb, or an empty target is
//!       rejected (exit 2) naming the offending entry — an unparseable claim
//!       is the same silent-failure class as no claim at all, so it is
//!       caught at the boundary rather than stored and discovered later.
//!
//! ACCOUNTABILITY SYNC (docs/typed-bus-payloads.md, "Accountability" section,
//! contract C-SWARM-SYNC) — binds the contract lifecycle to Linear + GitHub.
//! LINEAR IS THE PRIMARY TRACKER; GitHub issues are a MIRRORED SECONDARY
//! surface — the public one, not the source of truth. `contract` gains three
//! nullable columns: `linear` (a Linear identifier, e.g. "FEL-440"),
//! `github_issue`, `github_pr` (integers).
//!
//!   sync --pull                 reads Linear/GitHub, but DOES write locally
//!                                in two passes. (1) PULL: the real backlog
//!                                comes IN as candidate contracts — open
//!                                Linear FEL issues (state not Done/Canceled)
//!                                and open GitHub issues labelled `swarm`
//!                                each become a `status='offered',
//!                                owner=NULL` contract row carrying its
//!                                external id. Idempotent — matched and
//!                                deduped on the external id (`linear` /
//!                                `github_issue`), never re-inserted. NEVER
//!                                auto-assigns an owner — same rule as
//!                                onboarding: a pulled ticket carries no
//!                                role. (2) NORMALIZE: because Linear is
//!                                primary, no contract may permanently carry
//!                                only a GitHub-side id — every contract with
//!                                `github_issue` set and `linear` still NULL
//!                                gets a Linear task CREATED for it on team
//!                                FEL (title = the GitHub issue's title,
//!                                description points back at the GitHub
//!                                issue), the contract keeps BOTH ids (never
//!                                renamed), and the GitHub issue gets a
//!                                one-time marker comment naming the new
//!                                Linear identifier. Idempotent — a contract
//!                                with both ids is never selected again, so a
//!                                converged backlog re-normalizes 0. A failed
//!                                per-contract create/link prints
//!                                `could-not-sync` and the command still
//!                                exits nonzero, same posture as everywhere
//!                                else in sync.
//!   sync --push [--confirm]     mirrors contract state OUT. Defaults to a
//!                                DRY RUN: prints the plan computed purely
//!                                from local DB state and performs zero
//!                                network calls. `--confirm` is required to
//!                                perform any real read or write. THE
//!                                LOAD-BEARING RULE: external "Done" mirrors
//!                                `status == verified` ONLY — `submitted` (an
//!                                agent's own claim) never produces a Done
//!                                transition; that gate is structural (see
//!                                `classify`), not a flag checked at the last
//!                                moment. DISPUTED/unverified stay In
//!                                Progress and get a comment explaining why —
//!                                and if the contract's GitHub issue is
//!                                already CLOSED at that moment (e.g. a
//!                                DISPUTED verdict arriving after an earlier
//!                                `verified` had closed it), it is REOPENED
//!                                first, before the comment: a disputed
//!                                contract must not leave its public issue
//!                                looking resolved. Symmetric with the
//!                                Verified arm's close — logged as
//!                                `"reopened"` only when a reopen actually
//!                                happened. Every write is idempotent (a
//!                                marker HTML comment is checked before
//!                                posting; a state mutation is skipped if
//!                                already at target) and logged to the new
//!                                `activity` table so the mirror itself is
//!                                auditable. A failed per-contract sync
//!                                prints `could-not-sync` and the whole
//!                                command exits nonzero — it never assumes
//!                                success.
//!   verify-merged [--confirm]   closes the swarm's last accountability
//!                                gap: a MERGED pull request is the
//!                                strongest evidence a contract's work is
//!                                real (it passed CI and the three-clause
//!                                merge gate), yet merging one advances
//!                                NOTHING today — a contract sits at
//!                                claimed/building/submitted/no-claims
//!                                forever while the code is already on main
//!                                and the tracking issue stays open. For
//!                                every such contract (never one already
//!                                `verified` — the selecting query excludes
//!                                it), resolve a PR number in priority
//!                                order: (a) contract.github_pr, (b) the
//!                                typed `pr` column on the contract's most
//!                                recent verdict message, (c) a STRICT
//!                                prose parse of that verdict's body
//!                                (`parse_pr_ref` — only a full GitHub pull
//!                                URL or `PR #N` / `PR#N`; a bare `#N` is
//!                                NEVER a PR reference, on purpose — see
//!                                that function's doc comment). No PR
//!                                anywhere in that chain -> skip, reported
//!                                explicitly (`no PR reference — skipped`),
//!                                never guessed. Checked via `gh pr view
//!                                --json state,mergedAt,mergeCommit`: MERGED
//!                                with a non-null `mergedAt` is the ONLY
//!                                accepted evidence (`is_merged_evidence`) —
//!                                an open or closed-unmerged PR proves
//!                                nothing. On merged evidence the contract
//!                                is written through `write_contract_status`
//!                                — the SAME internal path `setstatus
//!                                --reconciled` uses, because this command
//!                                IS a reconcile pass, just gated by an
//!                                objective external fact instead of a
//!                                human's judgment call — and that shared
//!                                path is exactly what lets the existing
//!                                `sync --push` go on to mirror the
//!                                resulting `verified` status out to
//!                                Linear/GitHub as Done, which in turn
//!                                closes the GitHub issue. DRY RUN BY
//!                                DEFAULT, exactly like `sync --push`:
//!                                without --confirm this still performs the
//!                                `gh pr view` reads (so the printed plan
//!                                reflects real GitHub state) but writes
//!                                NOTHING locally; `--confirm` performs the
//!                                writes. A `gh` failure for one contract
//!                                prints `could-not-check: <id> <reason>`
//!                                and the loop continues to the next
//!                                contract — a failed query is NEVER treated
//!                                as "not merged". Idempotent: an
//!                                already-`verified` contract is excluded
//!                                by the selecting query, so re-running
//!                                writes nothing new.
//!   link --id C-X [--github-issue N] [--linear FEL-N]
//!                                manual, LOCAL-ONLY linkage for a human who
//!                                has recognized a contract and a pre-
//!                                existing Linear/GitHub item as the same
//!                                twin — no network calls. COALESCE
//!                                semantics: never overwrites a non-null
//!                                linkage. A field already set to a
//!                                DIFFERENT value dies (exit 2) naming both,
//!                                rather than silently picking one. A value
//!                                already claimed by ANOTHER contract dies
//!                                CONFLICT (exit 4) naming that contract —
//!                                one external issue, one owning contract.
//!
//! SECURITY (non-negotiable): the Linear API key lives ONLY in the macOS
//! keychain (`security find-generic-password -s LINEAR_API_KEY -w`), read at
//! call time. It is never printed, never logged, never written to a file,
//! and never appears in any child process's argv (so it is invisible to
//! `ps`). It reaches `curl` exclusively via that one child process's
//! environment — curl's own `--variable %LINEAR_API_KEY` / `--expand-header`
//! feature (curl >= 8.3) reads and substitutes it internally; this program
//! never assembles the header string itself. GitHub calls shell out to `gh`,
//! which manages its own separate, already-authenticated credential store —
//! this code never touches a GitHub token at all.
//!
//! DIVERGENCES FROM THE ORACLE (deliberate, logged per the brief)
//!   1. `offer` here does NOT require `--brief`. The oracle's cmd_offer
//!      requires issue/surface/must-pass/must-fail/brief/to; the spec this
//!      crate was built against only requires issue/to/surface/must-pass/
//!      must-fail. `--brief` is accepted and folded into the dispatched
//!      message body when present; omitted otherwise. Flagged explicitly —
//!      do not read this as full oracle parity on `offer`.
//!   2. `offer`'s `--to` is, exactly as in the oracle, only checked for
//!      *presence*, not validated against the known-role set (the oracle's
//!      cmd_offer never calls need_role on `to`). Reproduced faithfully,
//!      not accidentally.
//!   3. A `blocked` message here is only required to carry `--question`
//!      (per this crate's brief). The typed-payload design doc's `Blocked`
//!      Zod schema also makes `contract` required on a blocked payload;
//!      that extra constraint is NOT enforced here because it is outside
//!      this crate's stated acceptance surface and would silently reject
//!      pre-existing `--kind blocked` traffic that never set `--contract`.
//!      Logged, not silently dropped.
//!   4. `watch`'s timestamp column is formatted in UTC, not the oracle's
//!      `time.localtime`. Reproducing local-timezone formatting would pull
//!      in a chrono/time dependency for a cosmetic column; the ordering and
//!      content of every row are otherwise identical. If wall-clock-local
//!      display ever matters to a consumer, that's the moment to add the
//!      dependency — not preemptively.
//!   5. `status` (the oracle's pretty-printed contract table) is not
//!      implemented — see FULL COMMAND SURFACE above.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::env;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const ROLES: &[&str] = &[
    "orchestrator",
    "verifier",
    "architect",
    "historian",
    "builder",
    "builder-a",
    "builder-b",
    "investigator",
];

// Accountability sync targets (docs/typed-bus-payloads.md). Same team/repo
// scope `~/.agent-swarm/skills/swarm/swarm.ts` already uses for this project.
const LINEAR_TEAM_KEY: &str = "FEL";
const GITHUB_REPO: &str = "aihu-project/aihu";
/// Convention for "opted into the swarm backlog", not yet in use anywhere in
/// this repo as of this writing (checked via `gh label list`) — until an
/// orchestrator/architect creates and applies it, `sync --pull`'s GitHub
/// half is a real, correct empty, not a bug.
const GITHUB_SWARM_LABEL: &str = "swarm";

// ---------------------------------------------------------------------------
// Argument parsing: a per-arg `--k v` pairs parser, mirroring bus.py's hand
// rolled loop exactly (a bare `--flag` with no following non-flag token is a
// boolean flag, not a missing value).
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
enum ArgVal {
    Str(String),
    Flag,
}

type Args = HashMap<String, ArgVal>;

fn parse_args(raw: &[String]) -> Args {
    let mut args: Args = HashMap::new();
    let mut i = 0;
    while i < raw.len() {
        if let Some(k) = raw[i].strip_prefix("--") {
            if i + 1 < raw.len() && !raw[i + 1].starts_with("--") {
                args.insert(k.to_string(), ArgVal::Str(raw[i + 1].clone()));
                i += 2;
            } else {
                args.insert(k.to_string(), ArgVal::Flag);
                i += 1;
            }
        } else {
            i += 1;
        }
    }
    args
}

trait ArgsExt {
    fn get_str(&self, key: &str) -> Option<&str>;
    fn get_flag(&self, key: &str) -> bool;
}

impl ArgsExt for Args {
    fn get_str(&self, key: &str) -> Option<&str> {
        match self.get(key) {
            Some(ArgVal::Str(s)) => Some(s.as_str()),
            _ => None,
        }
    }
    fn get_flag(&self, key: &str) -> bool {
        self.contains_key(key)
    }
}

// ---------------------------------------------------------------------------
// Failure posture: every error prints a specific cause to stderr, never a
// silent empty result. `die` is the single choke point.
// ---------------------------------------------------------------------------

fn die(msg: &str, code: i32) -> ! {
    eprintln!("swarm-bus: {msg}");
    std::process::exit(code);
}

fn need_role(role: Option<&str>, what: &str) -> String {
    let r = match role {
        Some(s) if !s.is_empty() => s,
        _ => die(&format!("{what} is required"), 2),
    };
    if r != "all" && !ROLES.contains(&r) {
        let mut known: Vec<&str> = ROLES.to_vec();
        known.sort();
        die(
            &format!("unknown role '{r}'. Known: {}", known.join(", ")),
            2,
        );
    }
    r.to_string()
}

fn req_field<'a>(args: &'a Args, key: &str) -> &'a str {
    match args.get_str(key) {
        Some(v) if !v.is_empty() => v,
        _ => die(
            &format!(
                "--{key} is required. A contract without a bidirectional \
                 acceptance bar is a wish, not a contract."
            ),
            2,
        ),
    }
}

fn now_ts() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

// ---------------------------------------------------------------------------
// Identity: IDENTITY = (workspace, role). Matches bus.py's bound_identity()
// exactly. The registry at `~/.swarm/agents.json` (HOME-relative, so
// SWARM_DB-style overrides via a swapped HOME work for tests) maps
// role -> cwd and is written by the SUPERVISOR, never by agents — so a
// sender's claimed role is checked against where the process is actually
// running, rather than trusted because it said so. This is checkable, NOT
// cryptographic: an agent could `cd` before calling. Roles absent from the
// registry (human-driven, e.g. orchestrator) pass through untouched — the
// supervisor does not own them, so it cannot vouch for them.
// ---------------------------------------------------------------------------

fn agents_registry_path() -> PathBuf {
    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".swarm").join("agents.json")
}

/// realpath-ish: canonicalize when the path exists (resolves symlinks,
/// mirrors Python's os.path.realpath), else fall back to a plain absolute
/// join so a not-yet-created directory still compares sanely instead of
/// erroring.
fn realpath_like(p: &str) -> String {
    let path = PathBuf::from(p);
    if let Ok(canon) = std::fs::canonicalize(&path) {
        return canon.to_string_lossy().to_string();
    }
    if path.is_absolute() {
        return path.to_string_lossy().to_string();
    }
    match env::current_dir() {
        Ok(cwd) => cwd.join(path).to_string_lossy().to_string(),
        Err(_) => path.to_string_lossy().to_string(),
    }
}

fn bound_identity(role: &str) {
    let reg_path = agents_registry_path();
    if !reg_path.exists() {
        return;
    }
    let content = match std::fs::read_to_string(&reg_path) {
        Ok(c) => c,
        Err(e) => die(
            &format!("registry unreadable ({e}) — refusing to guess identity"),
            2,
        ),
    };
    let reg: Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(e) => die(
            &format!("registry unreadable ({e}) — refusing to guess identity"),
            2,
        ),
    };
    let entry = match reg.get(role) {
        Some(e) if e.is_object() => e,
        _ => return, // human-driven role; not supervisor-owned
    };
    let want_raw = match entry.get("cwd").and_then(Value::as_str) {
        Some(s) => s,
        None => return, // malformed entry; nothing to bind against
    };
    let want = realpath_like(want_raw);
    let here = realpath_like(
        &env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string()),
    );
    if here != want && !here.starts_with(&format!("{want}{}", std::path::MAIN_SEPARATOR)) {
        die(
            &format!(
                "IDENTITY MISMATCH: role '{role}' is bound to {want}, but this \
                 process is in {here}. A role is (workspace, role) — send from \
                 your own workspace or use your own role."
            ),
            5,
        );
    }
}

// ---------------------------------------------------------------------------
// DB: one SQLite file, schema created idempotently on every open (matches
// the oracle's db() exactly, including ALTER-if-missing columns so an
// existing bus.db is upgraded in place rather than rejected).
// ---------------------------------------------------------------------------

fn db_path() -> PathBuf {
    if let Ok(p) = env::var("SWARM_DB") {
        return PathBuf::from(p);
    }
    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".swarm").join("bus.db")
}

fn ensure_column(conn: &Connection, table: &str, column: &str, coltype: &str) -> rusqlite::Result<()> {
    let mut has_col = false;
    {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let name: String = row.get(1)?;
            if name == column {
                has_col = true;
                break;
            }
        }
    }
    if !has_col {
        // The PRAGMA check and the ALTER are two statements; every CLI
        // invocation runs this on open_db(), so two concurrent processes can
        // both see "missing" and race the ALTER. The loser's "duplicate
        // column name" is the race resolving correctly, not an error —
        // anything else still propagates.
        if let Err(e) = conn.execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {coltype}"),
            [],
        ) {
            if !e.to_string().contains("duplicate column name") {
                return Err(e);
            }
        }
    }
    Ok(())
}

fn open_db() -> rusqlite::Result<Connection> {
    let path = db_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let conn = Connection::open(&path)?;
    conn.busy_timeout(std::time::Duration::from_secs(10))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS msg(
           id TEXT PRIMARY KEY, ts REAL, sender TEXT, recipient TEXT,
           kind TEXT, body TEXT, contract TEXT);
         CREATE TABLE IF NOT EXISTS seen(role TEXT, msg TEXT, PRIMARY KEY(role,msg));
         CREATE TABLE IF NOT EXISTS attempt(role TEXT, msg TEXT, n INTEGER, PRIMARY KEY(role,msg));
         CREATE TABLE IF NOT EXISTS contract(
           id TEXT PRIMARY KEY, ts REAL, issue TEXT, owner TEXT, surface TEXT,
           must_pass TEXT, must_fail TEXT, status TEXT, note TEXT);
         CREATE TABLE IF NOT EXISTS activity(
           id TEXT PRIMARY KEY, ts REAL, contract TEXT, target TEXT,
           action TEXT, detail TEXT);",
    )?;
    // Idempotent ALTERs — same posture as the oracle's `recon` upgrade path,
    // extended for the typed-payload fields (docs/typed-bus-payloads.md).
    ensure_column(&conn, "contract", "recon", "TEXT")?;
    ensure_column(&conn, "contract", "needs", "TEXT")?;
    ensure_column(&conn, "msg", "pr", "INTEGER")?;
    ensure_column(&conn, "msg", "claims", "TEXT")?;
    // A verdict's completion status (done/blocked/could-not-check), same
    // idempotent-upgrade posture as every other typed-payload column above.
    ensure_column(&conn, "msg", "vstatus", "TEXT")?;
    // Accountability sync fields (docs/typed-bus-payloads.md, C-SWARM-SYNC):
    // the contract's Linear/GitHub home, all nullable — absent until a
    // `sync --pull` or an explicit `offer`/`setstatus` sets them.
    ensure_column(&conn, "contract", "linear", "TEXT")?;
    ensure_column(&conn, "contract", "github_issue", "INTEGER")?;
    ensure_column(&conn, "contract", "github_pr", "INTEGER")?;
    // R2 (C-SWARM-RECON-AUTHORITY): `github_pr` is a bare integer, but the swarm
    // runs contracts in more than one repo. Resolving a bare number against a
    // hardcoded GITHUB_REPO mints a FALSE receipt — `agent-swarm#1` is OPEN
    // while `aihu-project/aihu#1` is MERGED, so a cross-repo link would verify
    // against the wrong PR. The link must carry its repo. Backfill the
    // KNOWN-correct existing links to aihu-project/aihu EXPLICITLY: an explicit
    // backfill of known rows is not the same as an implicit fallback for
    // unknown ones — a future link with no repo is REFUSED for auto-verify
    // (see `resolve_pr`), never defaulted, because defaulting IS the collision.
    ensure_column(&conn, "contract", "github_repo", "TEXT")?;
    conn.execute(
        "UPDATE contract SET github_repo = ?1 \
         WHERE github_pr IS NOT NULL AND github_repo IS NULL",
        params![GITHUB_REPO],
    )?;
    Ok(conn)
}

// ---------------------------------------------------------------------------
// Verdict typed payload: a done-verdict must carry its evidence, enforced
// HERE at the bus boundary (docs/typed-bus-payloads.md). `VerdictStatus` is
// the closed 3-value enum behind `send --status`; `validate_claims` is the
// pure, DB-free parser behind `send --claims` — both unit-tested directly
// below, same posture as `decide_link`/`parse_pr_ref`/`is_merged_evidence`.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VerdictStatus {
    Done,
    Blocked,
    CouldNotCheck,
}

impl VerdictStatus {
    const ALL_NAMES: [&'static str; 3] = ["done", "blocked", "could-not-check"];

    fn parse(s: &str) -> Option<Self> {
        match s {
            "done" => Some(Self::Done),
            "blocked" => Some(Self::Blocked),
            "could-not-check" => Some(Self::CouldNotCheck),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Done => "done",
            Self::Blocked => "blocked",
            Self::CouldNotCheck => "could-not-check",
        }
    }
}

/// Claims are comma-separated `verb:target` pairs (e.g.
/// `pushed:PR#640,ran:cargo test`) — the reconciler's evidence that a
/// done-verdict is checkable, not a rubber stamp. Validated here, not just
/// checked non-empty: an unparseable claim (no `:`, an unknown verb, or an
/// empty target) is exit-2'd naming the offending entry, the same
/// silent-failure class as no claim at all.
/// The verbs recon knows how to trace mechanically. NOT a closed set — see
/// below. Kept for documentation and for the error text's example.
const CLAIM_VERBS: &[&str] = &["filed", "pushed", "merged", "committed", "ran", "opened", "closed"];

/// A verb must be a plausible identifier, not free prose. This is the line
/// between "structured enough to check" and "a sentence with a colon in it".
fn verb_is_wellformed(verb: &str) -> bool {
    !verb.is_empty()
        && verb.len() <= 24
        && verb.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn validate_claims(claims: &str) -> Result<(), String> {
    for entry in claims.split(',') {
        let entry = entry.trim();
        if entry.is_empty() {
            return Err(format!(
                "claim '{claims}' has an empty entry — claims are comma-separated \
                 verb:target pairs, e.g. 'pushed:PR#640,ran:cargo test'"
            ));
        }
        let (verb, target) = match entry.split_once(':') {
            Some((v, t)) => (v.trim(), t.trim()),
            None => {
                return Err(format!(
                    "claim '{entry}' has no ':' — claims are verb:target pairs, \
                     e.g. 'pushed:PR#640'"
                ))
            }
        };
        // OPEN verb set, deliberately. A closed enum was shipped first and
        // measured against real traffic before deploy: it rejected 5 of the 6
        // verbs agents actually write — `repro:`, `verified:`, `tested:`,
        // `impl:`, and `couldnotcheck:` — keeping only `ran:`. Deploying it
        // would have exit-2'd essentially every verdict and jammed the swarm.
        //
        // The anti-silent-failure property lives in the FORMAT (a colon, a
        // non-empty verb, a non-empty target), not in the vocabulary. And
        // `couldnotcheck:` is precisely the honest reporting this project
        // wants — a closed list would have punished the most valuable claim
        // an agent can make. Recon handles a verb it does not recognise; it
        // cannot handle a claim it cannot parse.
        if !verb_is_wellformed(verb) {
            return Err(format!(
                "claim '{entry}' has a malformed verb '{verb}' — a verb is a short \
                 identifier (letters, digits, - or _), e.g. {}. Free prose before \
                 the ':' is not a claim.",
                CLAIM_VERBS.join(", ")
            ));
        }
        if target.is_empty() {
            return Err(format!(
                "claim '{entry}' has an empty target — name what was {verb}"
            ));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

fn cmd_send(args: &Args) -> rusqlite::Result<()> {
    let from = need_role(args.get_str("from"), "--from");
    bound_identity(&from);
    let to = need_role(args.get_str("to"), "--to");
    let body = match args.get_str("body") {
        Some(b) if !b.is_empty() => b,
        _ => die("--body is required (an empty message is not a message)", 2),
    };
    let kind = args.get_str("kind").unwrap_or("note");
    let contract = args.get_str("contract");

    // Typed-payload boundary checks (docs/typed-bus-payloads.md): the
    // actionable parts of a verdict/blocked message are validated fields,
    // never prose a consumer has to regex out downstream. Reject here, not
    // silently accept and let a consumer discover the gap later.
    if kind == "verdict" {
        match contract {
            Some(c) if !c.is_empty() => {}
            _ => die("a verdict must name its contract", 2),
        }
    }
    if kind == "blocked" {
        match args.get_str("question") {
            Some(q) if !q.is_empty() => {}
            _ => die(
                "a blocked message must carry --question — the one thing a human must decide",
                2,
            ),
        }
    }

    let pr: Option<i64> = match args.get_str("pr") {
        Some(p) => match p.parse::<i64>() {
            Ok(v) => Some(v),
            Err(_) => die(&format!("--pr must be an integer, got '{p}'"), 2),
        },
        None => None,
    };
    let claims = args.get_str("claims");

    // `--status` is a closed 3-value enum, validated whenever it is given —
    // for any kind, not just `verdict` — so a typo is caught at the boundary
    // rather than stored verbatim and silently ignored.
    let status_arg = args.get_str("status");
    let parsed_status: Option<VerdictStatus> = match status_arg {
        Some(s) => match VerdictStatus::parse(s) {
            Some(v) => Some(v),
            None => die(
                &format!(
                    "unknown --status '{s}'. Valid: {}",
                    VerdictStatus::ALL_NAMES.join(", ")
                ),
                2,
            ),
        },
        None => None,
    };

    // A verdict declares completion via a FIELD, not prose the reconciler
    // has to sniff out of `body`: omitting --status on a verdict defaults to
    // `done` (so pre-existing done-verdicts with no --status are still
    // caught), and `done` REQUIRES evidence. `blocked`/`could-not-check`
    // legitimately have nothing to claim, so claims stay optional there —
    // but if claims ARE given anyway, they are validated all the same.
    let effective_status: Option<VerdictStatus> = if kind == "verdict" {
        Some(parsed_status.unwrap_or(VerdictStatus::Done))
    } else {
        parsed_status
    };

    if kind == "verdict" && effective_status == Some(VerdictStatus::Done) {
        match claims {
            Some(c) if !c.is_empty() => {
                if let Err(e) = validate_claims(c) {
                    die(&e, 2);
                }
            }
            _ => {
                let defaulted = if status_arg.is_none() {
                    " (--status was omitted, which defaults to 'done')"
                } else {
                    ""
                };
                die(
                    &format!(
                        "a verdict with --status done{defaulted} requires --claims — \
                         comma-separated verb:target pairs, e.g. \
                         'pushed:PR#640,ran:cargo test'. Pass --claims, or use \
                         --status blocked / --status could-not-check if there is \
                         genuinely nothing to claim."
                    ),
                    2,
                );
            }
        }
    } else if let Some(c) = claims {
        if !c.is_empty() {
            if let Err(e) = validate_claims(c) {
                die(&e, 2);
            }
        }
    }

    let conn = open_db()?;
    let mid = new_id();
    let ts = now_ts();
    let vstatus = effective_status.map(VerdictStatus::as_str);
    // Column-explicit insert: a positional VALUES(...) breaks the moment a
    // column is added and the writer isn't updated.
    conn.execute(
        "INSERT INTO msg (id, ts, sender, recipient, kind, body, contract, pr, claims, vstatus) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![mid, ts, from, to, kind, body, contract, pr, claims, vstatus],
    )?;
    // A verdict is the owner declaring done, not the supervisor reconciling
    // it: flip the contract to 'submitted', never 'verified'.
    if kind == "verdict" {
        if let Some(cid) = contract {
            conn.execute(
                "UPDATE contract SET status='submitted' \
                 WHERE id=?1 AND status IN ('claimed','building','offered')",
                params![cid],
            )?;
        }
    }
    println!("{mid}");
    Ok(())
}

fn cmd_pull(args: &Args) -> rusqlite::Result<()> {
    let role = need_role(args.get_str("role"), "--role");
    if role == "all" {
        die("--role all is not a reader; pull as a specific role", 2);
    }
    let peek = args.get_flag("peek");
    let conn = open_db()?;

    let mut out: Vec<Value> = Vec::new();
    let mut ids: Vec<String> = Vec::new();
    {
        let mut stmt = conn.prepare(
            "SELECT m.id, m.ts, m.sender, m.recipient, m.kind, m.body, m.contract, COALESCE(a.n, 0)
             FROM msg m LEFT JOIN attempt a ON a.msg = m.id AND a.role = ?1
             WHERE (m.recipient = ?2 OR m.recipient = 'all') AND m.sender != ?3
               AND m.id NOT IN (SELECT msg FROM seen WHERE role = ?4)
             ORDER BY m.ts",
        )?;

        let rows = stmt.query_map(params![role, role, role, role], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, i64>(7)?,
            ))
        })?;

        for r in rows {
            let (id, ts, from, to, kind, body, contract, attempts) = r?;
            ids.push(id.clone());
            let mut obj = Map::new();
            obj.insert("id".into(), json!(id));
            obj.insert("ts".into(), json!(ts));
            obj.insert("from".into(), json!(from));
            obj.insert("to".into(), json!(to));
            obj.insert("kind".into(), json!(kind));
            obj.insert("body".into(), json!(body));
            obj.insert(
                "contract".into(),
                contract.map(Value::from).unwrap_or(Value::Null),
            );
            obj.insert("attempts".into(), json!(attempts));
            out.push(Value::Object(obj));
        }
    }

    if !peek {
        for id in &ids {
            conn.execute(
                "INSERT OR IGNORE INTO seen VALUES (?1, ?2)",
                params![role, id],
            )?;
        }
    }

    println!(
        "{}",
        serde_json::to_string_pretty(&out).unwrap_or_else(|_| "[]".to_string())
    );
    // 0 = real messages, 3 = genuinely empty. Never conflate with an error.
    std::process::exit(if out.is_empty() { 3 } else { 0 });
}

fn cmd_offer(args: &Args) -> rusqlite::Result<()> {
    // Required per this crate's spec: issue/to/surface/must-pass/must-fail.
    // (See module doc divergence #1: the oracle also requires --brief.)
    let issue = req_field(args, "issue");
    let to = req_field(args, "to");
    let surface = req_field(args, "surface");
    let must_pass = req_field(args, "must-pass");
    let must_fail = req_field(args, "must-fail");
    let note = args.get_str("note").unwrap_or("");
    let brief = args.get_str("brief").unwrap_or("");
    let from = args.get_str("from").unwrap_or("orchestrator");
    // The Graph/DAG edge (docs/typed-bus-payloads.md): comma-separated
    // upstream contract ids this contract depends on. Optional — a contract
    // with no needs is trivially ready.
    let needs = args.get_str("needs");
    // Accountability linkage (docs/typed-bus-payloads.md "Accountability",
    // C-SWARM-SYNC): a contract can already know its Linear/GitHub home —
    // either because `sync --pull` created the candidate row first, or the
    // orchestrator is hand-authoring a contract for a ticket that already
    // exists. All optional; a bare `--issue` offer is unaffected.
    let linear = args.get_str("linear");
    let github_issue: Option<i64> = match args.get_str("github-issue") {
        Some(v) => match v.parse::<i64>() {
            Ok(n) => Some(n),
            Err(_) => die(&format!("--github-issue must be an integer, got '{v}'"), 2),
        },
        None => None,
    };
    let github_pr: Option<i64> = match args.get_str("github-pr") {
        Some(v) => match v.parse::<i64>() {
            Ok(n) => Some(n),
            Err(_) => die(&format!("--github-pr must be an integer, got '{v}'"), 2),
        },
        None => None,
    };
    let cid = args
        .get_str("id")
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("C-{issue}"));

    let conn = open_db()?;
    let ts = now_ts();
    // Upsert, NOT `INSERT OR REPLACE`: a plain REPLACE deletes-then-reinserts
    // the row, which would silently wipe `linear`/`github_issue`/`github_pr`
    // set by an earlier `sync --pull` the moment the contract is re-offered
    // (e.g. an architect filling in surface/must-pass/must-fail on a pulled
    // candidate) — destroying exactly the accountability link this exists to
    // preserve. COALESCE keeps the prior value when this call doesn't name a
    // new one. `needs` is deliberately NOT given this treatment — that is
    // unchanged, pre-existing behavior (a re-offer without `--needs` still
    // clears it), out of scope for this change.
    conn.execute(
        "INSERT INTO contract \
         (id, ts, issue, owner, surface, must_pass, must_fail, status, note, needs, \
          linear, github_issue, github_pr) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'offered', ?8, ?9, ?10, ?11, ?12) \
         ON CONFLICT(id) DO UPDATE SET \
           ts=excluded.ts, issue=excluded.issue, owner=excluded.owner, \
           surface=excluded.surface, must_pass=excluded.must_pass, \
           must_fail=excluded.must_fail, status='offered', note=excluded.note, \
           needs=excluded.needs, \
           linear=COALESCE(excluded.linear, contract.linear), \
           github_issue=COALESCE(excluded.github_issue, contract.github_issue), \
           github_pr=COALESCE(excluded.github_pr, contract.github_pr)",
        params![
            cid, ts, issue, to, surface, must_pass, must_fail, note, needs, linear, github_issue,
            github_pr
        ],
    )?;

    // Dispatch the brief atomically: no contract without a work order.
    let mid = new_id();
    let body = format!(
        "CONTRACT {cid} — claim it before you start:\n  \
         swarm-bus claim --id {cid} --role {to}\n\n\
         {brief}\n\n\
         MUST PASS: {must_pass}\n\
         MUST FAIL (run this direction too): {must_fail}\n\
         SURFACE (stay inside it): {surface}\n\n\
         Report with: swarm-bus send --from {to} --to orchestrator --kind verdict \
         --contract {cid} --body '...'"
    );
    conn.execute(
        "INSERT INTO msg (id, ts, sender, recipient, kind, body, contract) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![mid, ts, from, to, "dispatch", body, cid],
    )?;

    println!("{cid} offered + dispatched to {to}");
    Ok(())
}

fn cmd_claim(args: &Args) -> rusqlite::Result<()> {
    let who = need_role(args.get_str("role"), "--role");
    bound_identity(&who);
    let cid = match args.get_str("id") {
        Some(v) if !v.is_empty() => v,
        _ => die("--id is required", 2),
    };

    let conn = open_db()?;
    let row: Option<(Option<String>, String)> = conn
        .query_row(
            "SELECT owner, status FROM contract WHERE id = ?1",
            params![cid],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;

    let (owner, status) = match row {
        Some(v) => v,
        None => die(
            &format!("no contract '{cid}' — the QUESTION is wrong, not the answer"),
            2,
        ),
    };

    if let Some(o) = &owner {
        if o != &who && status != "offered" {
            die(
                &format!(
                    "CONFLICT: '{cid}' is already {status} by {o}. \
                     Counter or decline; do not co-own."
                ),
                4,
            );
        }
    }

    // The pre-check above gives a good error message, but two concurrent
    // claims can BOTH pass it (SELECT then UPDATE are separate autocommit
    // statements — a TOCTOU). The UPDATE therefore re-states the guard and
    // we check rows-affected: the race loser matches zero rows and gets the
    // same CONFLICT it would have gotten had it arrived a moment later.
    let n = conn.execute(
        "UPDATE contract SET owner = ?1, status = 'claimed' \
         WHERE id = ?2 AND (owner IS NULL OR owner = '' OR owner = ?1 OR status = 'offered')",
        params![who, cid],
    )?;
    if n == 0 {
        let (now_owner, now_status): (Option<String>, String) = conn
            .query_row(
                "SELECT owner, status FROM contract WHERE id = ?1",
                params![cid],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?
            .unwrap_or((None, "gone".into()));
        die(
            &format!(
                "CONFLICT: '{cid}' is already {now_status} by {}. \
                 Counter or decline; do not co-own.",
                now_owner.as_deref().unwrap_or("?")
            ),
            4,
        );
    }
    println!("{cid} claimed by {who}");
    Ok(())
}

fn cmd_ack(args: &Args) -> rusqlite::Result<()> {
    let role = need_role(args.get_str("role"), "--role");
    let ids_raw = args.get_str("ids").unwrap_or("");
    let ids: Vec<&str> = ids_raw.split(',').filter(|s| !s.is_empty()).collect();
    if ids.is_empty() {
        die(
            "--ids is required (comma-separated); acking nothing is not acking",
            2,
        );
    }
    let conn = open_db()?;
    for id in &ids {
        conn.execute(
            "INSERT OR IGNORE INTO seen VALUES (?1, ?2)",
            params![role, id],
        )?;
    }
    println!("acked {} for {role}", ids.len());
    Ok(())
}

fn cmd_attempt(args: &Args) -> rusqlite::Result<()> {
    // Record that delivery was ATTEMPTED (distinct from `ack`, which records
    // success). At-least-once redelivery is made visible as a count instead
    // of arriving as a fresh instruction the agent may already have obeyed.
    let role = need_role(args.get_str("role"), "--role");
    let ids_raw = args.get_str("ids").unwrap_or("");
    let ids: Vec<&str> = ids_raw.split(',').filter(|s| !s.is_empty()).collect();
    if ids.is_empty() {
        die("--ids is required", 2);
    }
    let conn = open_db()?;
    for id in &ids {
        conn.execute(
            "INSERT INTO attempt (role, msg, n) VALUES (?1, ?2, 1) \
             ON CONFLICT(role, msg) DO UPDATE SET n = n + 1",
            params![role, id],
        )?;
    }
    println!("attempted {} for {role}", ids.len());
    Ok(())
}

const CONTRACT_STATUSES: [&str; 9] = [
    "offered", "claimed", "building", "submitted", "verified",
    "no-claims", "DISPUTED", "unverified", "declined",
];

fn cmd_setstatus(args: &Args) -> rusqlite::Result<()> {
    let (cid, status) = match (args.get_str("id"), args.get_str("status")) {
        (Some(c), Some(s)) if !c.is_empty() && !s.is_empty() => (c, s),
        _ => die("--id and --status are required", 2),
    };
    // Closed enum, validated at the boundary. `classify()` matches these
    // exact strings; without this check a typo like "Verified" would be
    // stored verbatim and silently classify as NoOp — the sync would skip
    // the contract forever while the ledger looks fine.
    if !CONTRACT_STATUSES.contains(&status) {
        die(
            &format!(
                "unknown status '{status}'. Valid: {}",
                CONTRACT_STATUSES.join(", ")
            ),
            2,
        );
    }
    // `verified`/`no-claims` are the two statuses with EXTERNAL side effects
    // (sync mirrors them outward as Done). They require --reconciled: a
    // deliberate-action guard set by the supervisor's reconcile pass,
    // greppable in any transcript. Stated honestly (FEL-436 class): any
    // process CAN pass it — on a single-user machine cryptographic gating
    // does not exist — so this prevents mistakes and habit, not malice.
    // Founder ruling D1:B, 2026-07-27.
    if matches!(status, "verified" | "no-claims") {
        match args.get("reconciled") {
            Some(ArgVal::Flag) => {}
            Some(ArgVal::Str(v)) => {
                die(&format!("--reconciled takes no value (got '{v}')"), 2)
            }
            None => die(
                &format!(
                    "status '{status}' is a RECONCILE VERDICT and requires \
                     --reconciled — set by the reconcile pass after checking \
                     claims against the trace, not by hand out of habit. \
                     ('verified' additionally mirrors outward as Done; \
                     'no-claims' does not mirror, but is equally not a \
                     status any agent may assert about its own work.)"
                ),
                2,
            ),
        }
    }

    let conn = open_db()?;
    let exists: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM contract WHERE id = ?1",
            params![cid],
            |r| r.get(0),
        )
        .optional()?;
    if exists.is_none() {
        die(&format!("no contract '{cid}'"), 2);
    }

    let recon = args.get_str("recon").unwrap_or("");
    // Optional PR linkage (docs/typed-bus-payloads.md "Accountability"):
    // verification time is the natural moment a resolving PR becomes known,
    // e.g. `setstatus --id C-X --status verified --recon "..." --github-pr 640`.
    let github_pr: Option<i64> = match args.get_str("github-pr") {
        Some(v) => match v.parse::<i64>() {
            Ok(n) => Some(n),
            Err(_) => die(&format!("--github-pr must be an integer, got '{v}'"), 2),
        },
        None => None,
    };
    // R2: a link may carry its repo. `owner/repo` shape only — a bare word would
    // reintroduce the hardcoded-repo ambiguity `resolve_pr` refuses.
    let github_repo: Option<&str> = match args.get_str("github-repo") {
        Some(v) if v.contains('/') => Some(v),
        Some(v) => die(
            &format!("--github-repo must be owner/repo, got '{v}'"),
            2,
        ),
        None => None,
    };
    // Persist link fields FIRST so R1's `adjudicate_merged` (via `resolve_pr`)
    // reads the repo just set on this same call.
    if github_pr.is_some() || github_repo.is_some() {
        if let Err(e) = conn.execute(
            "UPDATE contract SET github_pr = COALESCE(?1, github_pr), \
             github_repo = COALESCE(?2, github_repo) WHERE id = ?3",
            params![github_pr, github_repo, cid],
        ) {
            die(&e.to_string(), 1);
        }
    }

    // R1 (C-SWARM-RECON-AUTHORITY): `verified` is NOT persisted on the
    // --reconciled flag alone (a flag any process can pass — FEL-436). It routes
    // through the SAME merged-evidence discipline `verify-merged` uses. A
    // proposal — a trace scan with no real merged same-repo receipt — lands
    // `unverified` (could-not-check), NEVER `verified`. `no-claims` is untouched
    // (STEP 2/3, the DAG reason); `verify-merged`'s own objective-evidence path
    // still writes `verified` directly.
    let row_pr: Option<i64> = conn
        .query_row(
            "SELECT github_pr FROM contract WHERE id = ?1",
            params![cid],
            |r| r.get::<_, Option<i64>>(0),
        )
        .optional()
        .ok()
        .flatten()
        .flatten();
    let (final_status, final_recon): (&str, String) = if status == "verified" {
        match adjudicate_merged(&conn, cid, row_pr) {
            Ok(receipt) => ("verified", receipt),
            Err(reason) => ("unverified", format!("could-not-check: {reason}")),
        }
    } else {
        (status, recon.to_string())
    };
    if let Err(e) = write_contract_status(&conn, cid, final_status, &final_recon, None) {
        die(&e, 1);
    }
    if final_status != status {
        eprintln!(
            "{cid}: '{status}' requested, but no merged same-repo receipt — \
             recorded '{final_status}' ({final_recon})"
        );
    }
    println!("{cid} -> {final_status}");
    Ok(())
}

/// The single write path for a contract status transition, shared by
/// `setstatus` (gated by a human's `--reconciled` flag) and `verify-merged`
/// (gated by an objectively merged PR) — both callers ARE the reconcile
/// pass, acting on different evidence. Re-validates the closed enum
/// unconditionally rather than trusting the caller already did: a status
/// outside `CONTRACT_STATUSES` reaching this function is a bug to report,
/// never a value to persist. `github_pr`, when given, is written alongside
/// the status in the same statement — same one-UPDATE-per-call shape
/// `cmd_setstatus` has always used, just factored out so a second caller
/// cannot silently diverge from it.
fn write_contract_status(
    conn: &Connection,
    cid: &str,
    status: &str,
    recon: &str,
    github_pr: Option<i64>,
) -> Result<(), String> {
    if !CONTRACT_STATUSES.contains(&status) {
        return Err(format!(
            "unknown status '{status}'. Valid: {}",
            CONTRACT_STATUSES.join(", ")
        ));
    }
    let res = if let Some(pr) = github_pr {
        conn.execute(
            "UPDATE contract SET status = ?1, recon = ?2, github_pr = ?3 WHERE id = ?4",
            params![status, recon, pr, cid],
        )
    } else {
        conn.execute(
            "UPDATE contract SET status = ?1, recon = ?2 WHERE id = ?3",
            params![status, recon, cid],
        )
    };
    res.map(|_| ()).map_err(|e| e.to_string())
}

/// UTC HH:MM:SS from a unix-epoch-seconds float — no timezone crate; see
/// module doc divergence #4.
fn format_hms_utc(ts: f64) -> String {
    let secs = ts as i64;
    let secs_of_day = secs.rem_euclid(86400);
    let h = secs_of_day / 3600;
    let m = (secs_of_day % 3600) / 60;
    let s = secs_of_day % 60;
    format!("{h:02}:{m:02}:{s:02}")
}

fn cmd_watch(args: &Args) -> rusqlite::Result<()> {
    // Every message, addressed or not — the cross-talk IS the value.
    // --role is required (matches the oracle) even though watch shows
    // everything regardless of who is watching.
    let _role = need_role(args.get_str("role"), "--role");
    let limit: i64 = args
        .get_str("limit")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(30);

    let conn = open_db()?;
    let mut stmt = conn.prepare(
        "SELECT ts, sender, recipient, kind, body FROM msg ORDER BY ts DESC LIMIT ?1",
    )?;
    let rows: Vec<(f64, String, String, String, String)> = stmt
        .query_map(params![limit], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    for (ts, sender, recipient, kind, body) in rows.iter().rev() {
        let trimmed: String = body.chars().take(160).collect();
        println!(
            "[{}] {sender} -> {recipient} ({kind}): {trimmed}",
            format_hms_utc(*ts)
        );
    }
    std::process::exit(if rows.is_empty() { 3 } else { 0 });
}

fn cmd_ready(args: &Args) -> rusqlite::Result<()> {
    // The read half of the Graph/DAG edge: is every upstream `needs` id
    // satisfied? A need is satisfied when its status is 'verified' or
    // 'no-claims' (docs/typed-bus-payloads.md Contract.status enum) — any
    // other existing status, or a needs-id that names no contract at all,
    // is unmet and named in the output.
    let cid = match args.get_str("id") {
        Some(v) if !v.is_empty() => v,
        _ => die("--id is required", 2),
    };

    let conn = open_db()?;
    let needs_row: Option<Option<String>> = conn
        .query_row(
            "SELECT needs FROM contract WHERE id = ?1",
            params![cid],
            |r| r.get::<_, Option<String>>(0),
        )
        .optional()?;
    let needs_str = match needs_row {
        Some(v) => v,
        None => die(&format!("no contract '{cid}'"), 2),
    };
    let needs: Vec<&str> = needs_str
        .as_deref()
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();

    if needs.is_empty() {
        println!("{cid} ready (no needs declared)");
        return Ok(());
    }

    let mut unmet: Vec<String> = Vec::new();
    for n in &needs {
        let status: Option<String> = conn
            .query_row("SELECT status FROM contract WHERE id = ?1", params![n], |r| r.get(0))
            .optional()?;
        match status.as_deref() {
            Some("verified") | Some("no-claims") => {}
            Some(s) => unmet.push(format!("{n} ({s})")),
            None => unmet.push(format!("{n} (no such contract)")),
        }
    }

    if unmet.is_empty() {
        println!("{cid} ready — needs satisfied: {}", needs.join(", "));
        Ok(())
    } else {
        println!("{cid} NOT ready — unmet needs: {}", unmet.join(", "));
        std::process::exit(1);
    }
}

// ---------------------------------------------------------------------------
// FEATURE 2 — `link`: manual, local-only external-id linkage. This is the
// tool for merging twins a human recognizes (a contract and a pre-existing
// Linear/GitHub item that are the same underlying work) when `sync --pull`'s
// automatic id-matching didn't already catch it. No network calls.
// ---------------------------------------------------------------------------

/// The outcome `link` should apply for ONE field, decided from purely local
/// values so it's unit-testable without a DB or a live Linear/GitHub call.
/// `other_owner` is the id of a DIFFERENT contract that already carries this
/// exact external value (the caller finds this via a `WHERE ... AND id !=
/// ?` query) — checked before the same-contract comparison, so a genuine
/// cross-contract collision is never masked by this contract's own
/// already-set value.
enum LinkDecision {
    /// The field was NULL on this contract: `link` should SET it.
    Set,
    /// The field already equals the requested value: no-op, still success.
    AlreadyMatches,
}

enum LinkConflict {
    /// Another contract already owns this exact value — CONFLICT, exit 4.
    Other(String),
    /// This contract already has a DIFFERENT value in this field — exit 2.
    Different(String),
}

fn decide_link(
    existing: Option<&str>,
    requested: &str,
    other_owner: Option<&str>,
) -> Result<LinkDecision, LinkConflict> {
    if let Some(owner) = other_owner {
        return Err(LinkConflict::Other(owner.to_string()));
    }
    match existing {
        None => Ok(LinkDecision::Set),
        Some(e) if e == requested => Ok(LinkDecision::AlreadyMatches),
        Some(e) => Err(LinkConflict::Different(e.to_string())),
    }
}

fn cmd_link(args: &Args) -> rusqlite::Result<()> {
    let cid = match args.get_str("id") {
        Some(v) if !v.is_empty() => v,
        _ => die("--id is required", 2),
    };
    let github_issue: Option<i64> = match args.get_str("github-issue") {
        Some(v) => match v.parse::<i64>() {
            Ok(n) => Some(n),
            Err(_) => die(&format!("--github-issue must be an integer, got '{v}'"), 2),
        },
        None => None,
    };
    let linear = args.get_str("linear");
    if github_issue.is_none() && linear.is_none() {
        die(
            "swarm-bus link requires at least one of --github-issue or --linear",
            2,
        );
    }

    let conn = open_db()?;
    let row: Option<(Option<String>, Option<i64>)> = conn
        .query_row(
            "SELECT linear, github_issue FROM contract WHERE id = ?1",
            params![cid],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let (cur_linear, cur_github) = match row {
        Some(v) => v,
        None => die(&format!("no contract '{cid}'"), 2),
    };

    if let Some(n) = github_issue {
        let n_str = n.to_string();
        let other: Option<String> = conn
            .query_row(
                "SELECT id FROM contract WHERE github_issue = ?1 AND id != ?2",
                params![n, cid],
                |r| r.get(0),
            )
            .optional()?;
        let cur = cur_github.map(|g| g.to_string());
        match decide_link(cur.as_deref(), &n_str, other.as_deref()) {
            Ok(_) => {}
            Err(LinkConflict::Other(o)) => die(
                &format!("CONFLICT: github_issue #{n} is already claimed by contract '{o}'"),
                4,
            ),
            Err(LinkConflict::Different(e)) => die(
                &format!(
                    "{cid} already has github_issue=#{e}, cannot also set #{n} — \
                     decide which is right and fix by hand"
                ),
                2,
            ),
        }
    }
    if let Some(l) = linear {
        let other: Option<String> = conn
            .query_row(
                "SELECT id FROM contract WHERE linear = ?1 AND id != ?2",
                params![l, cid],
                |r| r.get(0),
            )
            .optional()?;
        match decide_link(cur_linear.as_deref(), l, other.as_deref()) {
            Ok(_) => {}
            Err(LinkConflict::Other(o)) => die(
                &format!("CONFLICT: linear {l} is already claimed by contract '{o}'"),
                4,
            ),
            Err(LinkConflict::Different(e)) => die(
                &format!(
                    "{cid} already has linear={e}, cannot also set {l} — \
                     decide which is right and fix by hand"
                ),
                2,
            ),
        }
    }

    // Every conflict/mismatch above already `die`d, so both fields (if
    // requested) are either NULL locally or already match — a plain COALESCE
    // write is safe and cannot clobber anything.
    conn.execute(
        "UPDATE contract SET \
           github_issue = COALESCE(github_issue, ?1), \
           linear = COALESCE(linear, ?2) \
         WHERE id = ?3",
        params![github_issue, linear, cid],
    )?;

    let (final_linear, final_github): (Option<String>, Option<i64>) = conn.query_row(
        "SELECT linear, github_issue FROM contract WHERE id = ?1",
        params![cid],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    println!(
        "{cid} linked: linear={} github_issue={}",
        final_linear.as_deref().unwrap_or("(none)"),
        final_github
            .map(|n| format!("#{n}"))
            .unwrap_or_else(|| "(none)".to_string())
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Accountability sync (docs/typed-bus-payloads.md "Accountability",
// contract C-SWARM-SYNC): bind the contract lifecycle to Linear + GitHub.
// See the module doc comment at the top of this file for the command
// summary and the security posture for the Linear key.
// ---------------------------------------------------------------------------

/// Read the Linear API key from the macOS keychain. Never logged, never
/// echoed — the only thing done with the returned string is handing it to
/// one child process's environment (see `linear_call`).
fn linear_key() -> Result<String, String> {
    let out = std::process::Command::new("security")
        .args(["find-generic-password", "-s", "LINEAR_API_KEY", "-w"])
        .output()
        .map_err(|e| format!("could not invoke `security`: {e}"))?;
    if !out.status.success() {
        return Err("LINEAR_API_KEY not found in keychain (security exited non-zero)".to_string());
    }
    let key = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if key.is_empty() {
        return Err("LINEAR_API_KEY in keychain is empty".to_string());
    }
    Ok(key)
}

/// POST one GraphQL query/mutation to Linear.
///
/// SECURITY: the key is handed to `curl` exclusively via that one child
/// process's environment (`Command::env`, scoped to this single spawn — it
/// is not inherited by this program's own environment or by any other
/// child). curl's own `--variable %LINEAR_API_KEY` / `--expand-header`
/// feature (curl >= 8.3, confirmed present) reads and substitutes the value
/// INSIDE curl's process; this program never assembles the header string,
/// so the key never appears in curl's argv (invisible to `ps`), never in a
/// shell (no shell is spawned — `Command::new("curl")` execs it directly),
/// never in a file, and never in this function's own error strings (every
/// `Err` below is built from HTTP/JSON shape, never from `key`).
fn linear_call(query: &str, variables: &Value) -> Result<Value, String> {
    let key = linear_key()?;
    let body = json!({ "query": query, "variables": variables }).to_string();
    let output = std::process::Command::new("curl")
        .args([
            "-sS",
            "--max-time",
            "20",
            "--variable",
            "%LINEAR_API_KEY",
            "--expand-header",
            "Authorization: {{LINEAR_API_KEY}}",
            "-H",
            "Content-Type: application/json",
            "-X",
            "POST",
            "-d",
            &body,
            "https://api.linear.app/graphql",
        ])
        .env("LINEAR_API_KEY", &key)
        .output();
    // `key` is dropped at the end of this statement's scope either way; it
    // is not referenced again below.
    let out = output.map_err(|e| format!("could not invoke curl: {e}"))?;
    if !out.status.success() {
        return Err(format!("curl exited {}", out.status));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let v: Value =
        serde_json::from_str(&stdout).map_err(|e| format!("Linear returned non-JSON ({e})"))?;
    if let Some(errors) = v.get("errors") {
        return Err(format!("Linear API error: {errors}"));
    }
    match v.get("data") {
        Some(d) if !d.is_null() => Ok(d.clone()),
        _ => Err("Linear returned no data and no error".to_string()),
    }
}

/// All open (state.type not completed/canceled) issues on team FEL, paged.
/// Returns (identifier, title, url) triples, e.g. ("FEL-440", "...", "https://...").
fn linear_open_fel_issues() -> Result<Vec<(String, String, String)>, String> {
    let query = "query($first:Int!,$after:String,$team:String!){ \
         issues(first:$first, after:$after, filter:{ team:{key:{eq:$team}}, \
           state:{type:{nin:[\"completed\",\"canceled\"]}} }) { \
           nodes { identifier title url } \
           pageInfo { hasNextPage endCursor } \
         } }";
    let mut out = Vec::new();
    let mut after: Option<String> = None;
    loop {
        let vars = json!({ "first": 100, "after": after, "team": LINEAR_TEAM_KEY });
        let data = linear_call(query, &vars)?;
        let issues = data.get("issues").ok_or("Linear response missing 'issues'")?;
        let nodes = issues
            .get("nodes")
            .and_then(Value::as_array)
            .ok_or("Linear response missing 'issues.nodes'")?;
        for n in nodes {
            let identifier = n.get("identifier").and_then(Value::as_str).unwrap_or("");
            if identifier.is_empty() {
                continue;
            }
            let title = n.get("title").and_then(Value::as_str).unwrap_or("").to_string();
            let url = n.get("url").and_then(Value::as_str).unwrap_or("").to_string();
            out.push((identifier.to_string(), title, url));
        }
        let page_info = issues.get("pageInfo");
        let has_next = page_info
            .and_then(|p| p.get("hasNextPage"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let cursor = page_info
            .and_then(|p| p.get("endCursor"))
            .and_then(Value::as_str)
            .map(str::to_string);
        if !has_next || cursor.is_none() || out.len() >= 5000 {
            break;
        }
        after = cursor;
    }
    Ok(out)
}

/// Cache-free lookup of team FEL's workflow states (id, name).
fn linear_team_states() -> Result<Vec<(String, String)>, String> {
    let query = "query($team:String!){ teams(first:1, filter:{key:{eq:$team}}) { \
         nodes { states(first:25) { nodes { id name } } } } }";
    let data = linear_call(query, &json!({ "team": LINEAR_TEAM_KEY }))?;
    let nodes = data
        .pointer("/teams/nodes/0/states/nodes")
        .and_then(Value::as_array)
        .ok_or_else(|| "Linear: could not read team FEL's workflow states".to_string())?;
    Ok(nodes
        .iter()
        .filter_map(|n| {
            let id = n.get("id")?.as_str()?.to_string();
            let name = n.get("name")?.as_str()?.to_string();
            Some((id, name))
        })
        .collect())
}

/// Resolve a Linear identifier like "FEL-440" to (issueId, currentStateName).
fn linear_issue_lookup(identifier: &str) -> Result<(String, String), String> {
    let number: i64 = identifier
        .rsplit('-')
        .next()
        .and_then(|n| n.parse().ok())
        .ok_or_else(|| format!("malformed linear identifier '{identifier}'"))?;
    let query = "query($n:Float!,$team:String!){ issues(first:1, filter:{ team:{key:{eq:$team}}, \
         number:{eq:$n} }) { nodes { id state { name } } } }";
    let data = linear_call(query, &json!({ "n": number, "team": LINEAR_TEAM_KEY }))?;
    let node = data
        .pointer("/issues/nodes/0")
        .ok_or_else(|| format!("linear issue '{identifier}' not found"))?;
    let id = node
        .get("id")
        .and_then(Value::as_str)
        .ok_or("Linear: issue node missing id")?
        .to_string();
    let state = node.pointer("/state/name").and_then(Value::as_str).unwrap_or("").to_string();
    Ok((id, state))
}

/// Move a Linear issue to `target_name`, unless it is already there
/// (idempotent — a repeated push must not re-fire the same transition).
/// Returns Ok(true) when it actually CHANGED the state, Ok(false) when the
/// issue was already there. The caller logs that distinction: an audit trail
/// that records "moved to In Progress + comment" on a re-run where nothing
/// was written is the log overstating reality — the same overselling this
/// project keeps catching in panels, now in the ledger meant to prove it.
fn linear_ensure_state(identifier: &str, target_name: &str) -> Result<bool, String> {
    let (issue_id, current) = linear_issue_lookup(identifier)?;
    if current.eq_ignore_ascii_case(target_name) {
        return Ok(false);
    }
    let states = linear_team_states()?;
    let st = states
        .iter()
        .find(|(_, n)| n.eq_ignore_ascii_case(target_name))
        .ok_or_else(|| format!("no Linear workflow state named '{target_name}' on team FEL"))?;
    let mutation =
        "mutation($id:String!,$s:String!){ issueUpdate(id:$id, input:{stateId:$s}) { success } }";
    let data = linear_call(mutation, &json!({ "id": issue_id, "s": st.0 }))?;
    match data.pointer("/issueUpdate/success").and_then(Value::as_bool) {
        Some(true) => Ok(true),
        _ => Err(format!("Linear issueUpdate reported failure for {identifier}")),
    }
}

/// Post `body` as a comment on a Linear issue UNLESS an existing comment
/// already contains `marker` — the idempotency check the spec requires
/// ("check for the marker first").
/// Ok(true) = a comment was posted; Ok(false) = the marker was already there.
fn linear_comment_if_absent(identifier: &str, marker: &str, body: &str) -> Result<bool, String> {
    let (issue_id, _) = linear_issue_lookup(identifier)?;
    let query = "query($id:String!){ issue(id:$id){ comments(first:50){ nodes { body } } } }";
    let data = linear_call(query, &json!({ "id": issue_id }))?;
    let comments: Vec<Value> = data
        .pointer("/issue/comments/nodes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for cm in &comments {
        if cm.get("body").and_then(Value::as_str).is_some_and(|b| b.contains(marker)) {
            return Ok(false); // already posted
        }
    }
    let mutation =
        "mutation($id:String!,$body:String!){ commentCreate(input:{issueId:$id, body:$body}) { success } }";
    let data = linear_call(mutation, &json!({ "id": issue_id, "body": body }))?;
    match data.pointer("/commentCreate/success").and_then(Value::as_bool) {
        Some(true) => Ok(true),
        _ => Err(format!("Linear commentCreate reported failure for {identifier}")),
    }
}

/// Resolve team FEL's internal Linear id — `issueCreate`'s `teamId` input
/// wants the internal id, not the human-facing key, unlike the `key:{eq:..}`
/// filters used elsewhere in this file.
fn linear_team_id() -> Result<String, String> {
    let query = "query($team:String!){ teams(filter:{key:{eq:$team}}, first:1){ nodes { id } } }";
    let data = linear_call(query, &json!({ "team": LINEAR_TEAM_KEY }))?;
    data.pointer("/teams/nodes/0/id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("Linear: team '{LINEAR_TEAM_KEY}' not found"))
}

/// Create a new issue on team FEL. Returns the created issue's identifier
/// (e.g. "FEL-450"). Used only by `sync --pull`'s normalization pass
/// (FEATURE 1, "Linear is primary"): NOT idempotent by itself — calling it
/// twice creates two issues — so the caller must only ever invoke this once
/// per external id, gated by the `linear IS NULL` selection in
/// `cmd_sync_pull`.
fn linear_create_issue(title: &str, description: &str) -> Result<String, String> {
    let team_id = linear_team_id()?;
    let mutation = "mutation($team:String!,$title:String!,$desc:String!){ \
         issueCreate(input:{ teamId:$team, title:$title, description:$desc }) { \
         success issue { identifier } } }";
    let data = linear_call(
        mutation,
        &json!({ "team": team_id, "title": title, "desc": description }),
    )?;
    match data.pointer("/issueCreate/success").and_then(Value::as_bool) {
        Some(true) => {}
        _ => return Err("Linear issueCreate reported failure".to_string()),
    }
    data.pointer("/issueCreate/issue/identifier")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "Linear issueCreate succeeded but returned no identifier".to_string())
}

/// Run `gh` and return stdout, or an Err describing the failure (never
/// panics, never assumes success from a nonzero exit).
fn gh_run(args: &[&str]) -> Result<Vec<u8>, String> {
    let out = std::process::Command::new("gh")
        .args(args)
        .output()
        .map_err(|e| format!("could not invoke gh: {e}"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("gh exited {}: {}", out.status, stderr.trim()));
    }
    Ok(out.stdout)
}

fn gh_issue_view(number: i64, fields: &str) -> Result<Value, String> {
    let n = number.to_string();
    let out = gh_run(&["issue", "view", &n, "--repo", GITHUB_REPO, "--json", fields])?;
    serde_json::from_slice(&out).map_err(|e| format!("gh issue view returned non-JSON: {e}"))
}

/// `gh pr view` — used by `verify-merged` to ask GitHub, authoritatively,
/// whether a resolved PR number is merged. Read-only: this is safe to call
/// even in a `verify-merged` dry run.
fn gh_pr_view(repo: &str, number: i64) -> Result<Value, String> {
    let n = number.to_string();
    // `repo` is the LINK's own repo (from `resolve_pr`), never a hardcoded
    // default — R2, C-SWARM-RECON-AUTHORITY. Resolving #1 against `aihu-project/aihu`
    // when the work is `agent-swarm#1` is exactly the false-receipt collision.
    let out = gh_run(&[
        "pr",
        "view",
        &n,
        "--repo",
        repo,
        "--json",
        "state,mergedAt,mergeCommit",
    ])?;
    serde_json::from_slice(&out).map_err(|e| format!("gh pr view returned non-JSON: {e}"))
}

/// Open GitHub issues on GITHUB_REPO labelled GITHUB_SWARM_LABEL.
/// Returns (number, title, url) triples.
fn github_open_swarm_issues() -> Result<Vec<(i64, String, String)>, String> {
    let out = gh_run(&[
        "issue",
        "list",
        "--repo",
        GITHUB_REPO,
        "--label",
        GITHUB_SWARM_LABEL,
        "--state",
        "open",
        "--json",
        "number,title,url",
        "--limit",
        "500",
    ])?;
    let arr: Vec<Value> =
        serde_json::from_slice(&out).map_err(|e| format!("gh returned non-JSON: {e}"))?;
    Ok(arr
        .iter()
        .filter_map(|it| {
            let number = it.get("number").and_then(Value::as_i64)?;
            let title = it.get("title").and_then(Value::as_str).unwrap_or("").to_string();
            let url = it.get("url").and_then(Value::as_str).unwrap_or("").to_string();
            Some((number, title, url))
        })
        .collect())
}

/// Post `body` as a comment on a GitHub issue UNLESS an existing comment
/// already contains `marker` (same idempotency contract as the Linear side).
/// Ok(true) = a comment was posted; Ok(false) = the marker was already there.
fn gh_comment_if_absent(number: i64, marker: &str, body: &str) -> Result<bool, String> {
    let data = gh_issue_view(number, "comments")?;
    let comments: Vec<Value> = data.get("comments").and_then(Value::as_array).cloned().unwrap_or_default();
    for cm in &comments {
        if cm.get("body").and_then(Value::as_str).is_some_and(|b| b.contains(marker)) {
            return Ok(false); // already posted
        }
    }
    let n = number.to_string();
    gh_run(&["issue", "comment", &n, "--repo", GITHUB_REPO, "--body", body])?;
    Ok(true)
}

/// Close a GitHub issue unless it is already closed (idempotent).
fn gh_close_issue(number: i64) -> Result<(), String> {
    let data = gh_issue_view(number, "state")?;
    let state = data.get("state").and_then(Value::as_str).unwrap_or("");
    if state.eq_ignore_ascii_case("closed") {
        return Ok(());
    }
    let n = number.to_string();
    gh_run(&["issue", "close", &n, "--repo", GITHUB_REPO])?;
    Ok(())
}

/// Reopen a GitHub issue unless it is already open (idempotent) — the
/// FEATURE 3 reopen guard's primitive. Returns Ok(true) when it actually
/// reopened the issue, Ok(false) when it was already open: same
/// only-log-real-changes discipline as `changed_detail`/`linear_ensure_state`
/// elsewhere in this file.
fn gh_reopen_issue(number: i64) -> Result<bool, String> {
    let data = gh_issue_view(number, "state")?;
    let state = data.get("state").and_then(Value::as_str).unwrap_or("");
    if !state.eq_ignore_ascii_case("closed") {
        return Ok(false);
    }
    let n = number.to_string();
    gh_run(&["issue", "reopen", &n, "--repo", GITHUB_REPO])?;
    Ok(true)
}

/// Best-effort audit trail for every real external write `sync --push
/// --confirm` performs, per the spec ("log every external write ... so the
/// mirror itself is auditable"). Failing to log is not a reason to fail a
/// write that already succeeded, so this only warns.
fn log_activity(conn: &Connection, contract: &str, target: &str, action: &str, detail: &str) {
    let res = conn.execute(
        "INSERT INTO activity (id, ts, contract, target, action, detail) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![new_id(), now_ts(), contract, target, action, detail],
    );
    if let Err(e) = res {
        eprintln!("swarm-bus: warning: could not record activity entry for {contract}: {e}");
    }
}

fn cmd_sync(args: &Args) -> rusqlite::Result<()> {
    let pull = args.get_flag("pull");
    let push = args.get_flag("push");
    match (pull, push) {
        (true, true) => die("swarm-bus sync takes exactly one of --pull or --push, not both", 2),
        (true, false) => cmd_sync_pull(args),
        (false, true) => cmd_sync_push(args),
        (false, false) => die("swarm-bus sync requires --pull or --push", 2),
    }
}

/// PART 1 — INBOUND, the safe half: pull the real backlog in as candidate
/// contracts. Read-only against nothing local except an insert of brand new
/// rows; never mutates Linear or GitHub.
fn cmd_sync_pull(_args: &Args) -> rusqlite::Result<()> {
    let conn = open_db()?;
    let mut had_error = false;
    let mut pulled_ids: Vec<String> = Vec::new();
    let (mut linear_new, mut linear_skipped, mut linear_linked) = (0i64, 0i64, 0i64);
    let (mut github_new, mut github_skipped, mut github_linked) = (0i64, 0i64, 0i64);

    match linear_open_fel_issues() {
        Ok(issues) => {
            for (identifier, title, url) in issues {
                // Idempotency: match on the external id, never re-insert.
                let exists: Option<i64> = conn
                    .query_row(
                        "SELECT 1 FROM contract WHERE linear = ?1",
                        params![identifier],
                        |r| r.get(0),
                    )
                    .optional()?;
                if exists.is_some() {
                    linear_skipped += 1;
                    continue;
                }
                let cid = format!("C-{identifier}");
                // An `id` (not `linear`) collision means a hand-authored,
                // possibly in-flight contract already owns this id. The old
                // `INSERT OR IGNORE` silently no-opped there — which protected
                // status/owner but left the ACTIVE contract permanently
                // unlinked (push could never mirror it) and re-counted it
                // "+new" on every pull. Instead: attach the linkage, touch
                // nothing else, and report it as linked, not new.
                let id_exists: Option<i64> = conn
                    .query_row(
                        "SELECT 1 FROM contract WHERE id = ?1",
                        params![cid],
                        |r| r.get(0),
                    )
                    .optional()?;
                if id_exists.is_some() {
                    conn.execute(
                        "UPDATE contract SET linear = COALESCE(linear, ?1) WHERE id = ?2",
                        params![identifier, cid],
                    )?;
                    linear_linked += 1;
                    continue;
                }
                let ts = now_ts();
                let note = format!("{title}\n{url}");
                // owner is left NULL — offered to NOBODY; the
                // orchestrator/architect assigns.
                conn.execute(
                    "INSERT INTO contract \
                     (id, ts, issue, owner, surface, must_pass, must_fail, status, note, linear) \
                     VALUES (?1, ?2, ?3, NULL, '', '', '', 'offered', ?4, ?5)",
                    params![cid, ts, identifier, note, identifier],
                )?;
                linear_new += 1;
                pulled_ids.push(cid);
            }
        }
        Err(e) => {
            eprintln!("swarm-bus: could-not-sync (linear pull): {e}");
            had_error = true;
        }
    }

    match github_open_swarm_issues() {
        Ok(issues) => {
            for (number, title, url) in issues {
                let exists: Option<i64> = conn
                    .query_row(
                        "SELECT 1 FROM contract WHERE github_issue = ?1",
                        params![number],
                        |r| r.get(0),
                    )
                    .optional()?;
                if exists.is_some() {
                    github_skipped += 1;
                    continue;
                }
                let cid = format!("C-GH-{number}");
                // Same id-collision rule as the Linear side: attach the
                // linkage to an existing contract, never clobber it.
                let id_exists: Option<i64> = conn
                    .query_row(
                        "SELECT 1 FROM contract WHERE id = ?1",
                        params![cid],
                        |r| r.get(0),
                    )
                    .optional()?;
                if id_exists.is_some() {
                    conn.execute(
                        "UPDATE contract SET github_issue = COALESCE(github_issue, ?1) WHERE id = ?2",
                        params![number, cid],
                    )?;
                    github_linked += 1;
                    continue;
                }
                let ts = now_ts();
                let issue_label = format!("GH-{number}");
                let note = format!("{title}\n{url}");
                conn.execute(
                    "INSERT INTO contract \
                     (id, ts, issue, owner, surface, must_pass, must_fail, status, note, github_issue) \
                     VALUES (?1, ?2, ?3, NULL, '', '', '', 'offered', ?4, ?5)",
                    params![cid, ts, issue_label, note, number],
                )?;
                github_new += 1;
                pulled_ids.push(cid);
            }
        }
        Err(e) => {
            eprintln!("swarm-bus: could-not-sync (github pull): {e}");
            had_error = true;
        }
    }

    println!(
        "pull: linear +{linear_new} new / {linear_skipped} already known (skipped) / \
         {linear_linked} linked to existing contract; \
         github +{github_new} new / {github_skipped} already known (skipped) / \
         {github_linked} linked to existing contract"
    );
    for cid in &pulled_ids {
        println!("  {cid}");
    }

    // FEATURE 1 — NORMALIZE: Linear is the primary tracker (module doc,
    // ACCOUNTABILITY SYNC), so no contract may permanently carry only a
    // GitHub-side id. Re-queried fresh from the table (not `pulled_ids`
    // above) so this also heals contracts that predate this pass — e.g. one
    // hand-authored via `offer --github-issue` — not just rows this very
    // run just inserted. Selection on `linear IS NULL` is itself the
    // idempotency guard: once a contract carries both ids it is never
    // selected again, so re-running converges to 0.
    let mut normalize_targets: Vec<(String, i64)> = Vec::new();
    {
        let mut stmt = conn.prepare(
            "SELECT id, github_issue FROM contract \
             WHERE github_issue IS NOT NULL AND linear IS NULL ORDER BY id",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        for r in rows {
            normalize_targets.push(r?);
        }
    }
    let mut normalized = 0i64;
    let mut normalized_lines: Vec<String> = Vec::new();
    for (cid, number) in &normalize_targets {
        match normalize_github_only_contract(&conn, cid, *number) {
            Ok(identifier) => {
                normalized += 1;
                normalized_lines.push(format!("{cid} -> {identifier} (created from github:#{number})"));
            }
            Err(e) => {
                eprintln!("swarm-bus: could-not-sync (normalize {cid}): {e}");
                had_error = true;
            }
        }
    }
    println!("normalize: {normalized} github-only contract(s) given Linear twins");
    for line in &normalized_lines {
        println!("  {line}");
    }

    if had_error {
        std::process::exit(1);
    }
    Ok(())
}

/// FEATURE 1's per-contract action: CREATE a Linear twin for a contract that
/// so far only carries a `github_issue`, link it onto the same contract row
/// (both ids, id unchanged — contract ids are referenced elsewhere), and
/// leave a one-time marker comment on the GitHub issue naming the new
/// identifier. NOT internally idempotent (see `linear_create_issue`) — the
/// caller in `cmd_sync_pull` guarantees this runs at most once per contract
/// by only selecting rows where `linear IS NULL`.
fn normalize_github_only_contract(conn: &Connection, cid: &str, number: i64) -> Result<String, String> {
    let issue = gh_issue_view(number, "title,url")?;
    let title = issue.get("title").and_then(Value::as_str).unwrap_or("").to_string();
    let url = issue.get("url").and_then(Value::as_str).unwrap_or("").to_string();
    let description = format!(
        "Mirrors GitHub issue #{number} — {url}\n\n\
         Created by swarm-bus sync (Linear is the primary tracker; the GitHub \
         issue is the public surface)."
    );
    let identifier = linear_create_issue(&title, &description)?;

    // Link locally right away. If THIS fails, the contract is left with
    // `linear IS NULL` and will be re-selected next pull — which would
    // create a SECOND Linear issue. Surfaced loudly, with the manual escape
    // hatch (FEATURE 2) named explicitly, rather than silently retried.
    if let Err(e) = conn.execute(
        "UPDATE contract SET linear = ?1 WHERE id = ?2",
        params![identifier, cid],
    ) {
        return Err(format!(
            "created Linear {identifier} for {cid} but failed to link it locally ({e}) — \
             a re-run of `sync --pull` will create a DUPLICATE Linear issue for {cid}; \
             fix immediately with `swarm-bus link --id {cid} --linear {identifier}`"
        ));
    }

    let marker = "<!-- swarm-sync:linear-mirror -->";
    // The marker MUST be embedded in the posted body itself — the same
    // convention every other `gh_comment_if_absent`/`linear_comment_if_absent`
    // call site in this file follows (see `apply_sync_event`) — because that
    // marker string is exactly what the idempotency check on the next call
    // greps existing comments for. A marker that's only ever passed as the
    // check argument and never actually written is not idempotent, it's
    // decorative.
    let comment = format!(
        "{marker}\nTracked as {identifier} in Linear (primary tracker) by the aihu swarm."
    );
    gh_comment_if_absent(number, marker, &comment)?;

    log_activity(
        conn, cid, &format!("linear:{identifier}"), "normalized",
        &format!("created from github:#{number}"),
    );
    Ok(identifier)
}

/// The action a contract's current status maps to on the outward sync. The
/// LOAD-BEARING GATE lives here, structurally: `submitted` is not one of the
/// match arms that produces `Verified` — it is textually impossible for a
/// `submitted` contract to reach the Done-transition branch, not merely
/// checked-and-skipped at the last moment.
enum SyncEvent {
    /// claim/building/submitted — mirror "In Progress"; NEVER Done.
    ClaimAccepted,
    /// status == verified (reconciled + reviewed) — the ONLY path to Done.
    Verified,
    /// DISPUTED / unverified — stays In Progress, comment explains why.
    Flagged(String),
    /// offered / no-claims / declined / anything else — no event defined.
    NoOp,
}

fn classify(status: &str, recon: &str, note: &str) -> SyncEvent {
    match status {
        "claimed" | "building" | "submitted" => SyncEvent::ClaimAccepted,
        "verified" => SyncEvent::Verified,
        "DISPUTED" | "unverified" => {
            let why = if !recon.is_empty() {
                recon.to_string()
            } else if !note.is_empty() {
                note.to_string()
            } else {
                "no reason recorded".to_string()
            };
            SyncEvent::Flagged(why)
        }
        _ => SyncEvent::NoOp,
    }
}

struct SyncContract {
    id: String,
    status: String,
    owner: Option<String>,
    note: String,
    recon: String,
    linear: Option<String>,
    github_issue: Option<i64>,
    github_pr: Option<i64>,
}

fn load_sync_contracts(conn: &Connection) -> rusqlite::Result<Vec<SyncContract>> {
    let mut stmt = conn.prepare(
        "SELECT id, status, owner, note, COALESCE(recon,''), linear, github_issue, github_pr \
         FROM contract WHERE linear IS NOT NULL OR github_issue IS NOT NULL ORDER BY id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(SyncContract {
            id: r.get(0)?,
            status: r.get(1)?,
            owner: r.get(2)?,
            note: r.get(3)?,
            recon: r.get(4)?,
            linear: r.get(5)?,
            github_issue: r.get(6)?,
            github_pr: r.get(7)?,
        })
    })?;
    rows.collect()
}

/// Perform the real reads/writes for one contract's event. Only ever called
/// under `--confirm`. Every branch is idempotent (marker-checked comments,
/// state mutations skipped if already at target).
/// Describe ONLY what actually changed. A sync pass that re-runs over an
/// already-current issue must not write an audit line claiming it moved the
/// state and posted a comment — the ledger that exists to prove the mirror
/// is honest cannot itself oversell.
fn changed_detail(moved: bool, posted: bool, target: &str) -> String {
    match (moved, posted) {
        (true, true) => format!("{target} + comment"),
        (true, false) => format!("{target} (comment already present)"),
        (false, true) => format!("comment (already {target})"),
        (false, false) => "no change".to_string(),
    }
}

// ---------------------------------------------------------------------------
// Agent attribution labels (founder design, 2026-07-27).
//
// The Linear label `agent:<role>@<city>` carries the swarm's identity tuple —
// the same (workspace, role) the bus enforces at exit 5 — as FILTERABLE
// metadata: "everything builder@almaty owns" is a board filter, not an
// archaeology dig through comment bodies. The unique identifier is the AGENT
// IDENTITY, deliberately not the contract id: identity labels are a closed
// set bounded by the registry, per-contract labels would grow forever. The
// contract id keeps living in the marker comment and the `linear` column.
//
// Honest limit unchanged (FEL-436): the label is applied by the one shared
// credential, so it is checkable, not cryptographic. This upgrades
// attribution from buried to queryable — no further.
// ---------------------------------------------------------------------------

/// `agent:<role>@<city>`, or `agent:<role>` when the role has no registry
/// binding (human-driven roles the supervisor cannot vouch for).
fn agent_label_name(role: &str, city: Option<&str>) -> String {
    match city {
        Some(c) => format!("agent:{role}@{c}"),
        None => format!("agent:{role}"),
    }
}

/// The role's workspace city (basename of its registered cwd), from the same
/// registry `bound_identity` enforces against.
fn agent_city(role: &str) -> Option<String> {
    let raw = std::fs::read_to_string(agents_registry_path()).ok()?;
    let reg: Value = serde_json::from_str(&raw).ok()?;
    let cwd = reg.get(role)?.get("cwd")?.as_str()?;
    std::path::Path::new(cwd)
        .file_name()
        .map(|b| b.to_string_lossy().to_string())
}

/// Ensure the owner's identity label is on the issue and stale `agent:*`
/// labels are not (a contract has ONE owner; the bus refuses co-ownership,
/// so the labels must not imply it). Returns Ok(Some(label)) when the issue
/// actually changed, Ok(None) when it was already correct — the audit trail
/// records only real changes.
fn linear_ensure_agent_label(identifier: &str, role: &str) -> Result<Option<String>, String> {
    let want = agent_label_name(role, agent_city(role).as_deref());

    let number: i64 = identifier
        .rsplit('-')
        .next()
        .and_then(|n| n.parse().ok())
        .ok_or_else(|| format!("malformed linear identifier '{identifier}'"))?;
    let query = "query($n:Float!,$team:String!){ issues(first:1, filter:{ team:{key:{eq:$team}}, \
         number:{eq:$n} }) { nodes { id labels(first:50){ nodes { id name } } } } }";
    let data = linear_call(query, &json!({ "n": number, "team": LINEAR_TEAM_KEY }))?;
    let node = data
        .pointer("/issues/nodes/0")
        .ok_or_else(|| format!("linear issue '{identifier}' not found"))?;
    let issue_id = node
        .get("id")
        .and_then(Value::as_str)
        .ok_or("Linear: issue node missing id")?
        .to_string();
    let current: Vec<(String, String)> = node
        .pointer("/labels/nodes")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|l| {
                    Some((
                        l.get("id")?.as_str()?.to_string(),
                        l.get("name")?.as_str()?.to_string(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default();

    if current.iter().any(|(_, n)| n == &want)
        && !current.iter().any(|(_, n)| n.starts_with("agent:") && n != &want)
    {
        return Ok(None); // already correct — write nothing, log nothing
    }

    // Find or create the team label (lazily; the set is bounded by the
    // registry). Colour is the brand graphite — agents are the AI axis.
    let tq = "query($team:String!){ teams(filter:{key:{eq:$team}}, first:1){ nodes { id \
         labels(first:250){ nodes { id name } } } } }";
    let tdata = linear_call(tq, &json!({ "team": LINEAR_TEAM_KEY }))?;
    let tnode = tdata
        .pointer("/teams/nodes/0")
        .ok_or("Linear: team FEL not found")?;
    let team_id = tnode
        .get("id")
        .and_then(Value::as_str)
        .ok_or("Linear: team node missing id")?
        .to_string();
    let label_id = match tnode
        .pointer("/labels/nodes")
        .and_then(Value::as_array)
        .and_then(|a| {
            a.iter().find(|l| l.get("name").and_then(Value::as_str) == Some(want.as_str()))
        })
        .and_then(|l| l.get("id"))
        .and_then(Value::as_str)
    {
        Some(id) => id.to_string(),
        None => {
            let m = "mutation($name:String!,$team:String!){ issueLabelCreate(input:{ \
                 name:$name, teamId:$team, color:\"#636a72\" }) { issueLabel { id } } }";
            let d = linear_call(m, &json!({ "name": want, "team": team_id }))?;
            d.pointer("/issueLabelCreate/issueLabel/id")
                .and_then(Value::as_str)
                .ok_or_else(|| format!("Linear: could not create label '{want}'"))?
                .to_string()
        }
    };

    let mut ids: Vec<String> = current
        .iter()
        .filter(|(_, n)| !n.starts_with("agent:"))
        .map(|(i, _)| i.clone())
        .collect();
    ids.push(label_id);
    let m = "mutation($id:String!,$ids:[String!]!){ issueUpdate(id:$id, input:{labelIds:$ids}) { success } }";
    let d = linear_call(m, &json!({ "id": issue_id, "ids": ids }))?;
    match d.pointer("/issueUpdate/success").and_then(Value::as_bool) {
        Some(true) => Ok(Some(want)),
        _ => Err(format!("Linear issueUpdate(labels) reported failure for {identifier}")),
    }
}

fn apply_sync_event(conn: &Connection, c: &SyncContract, event: &SyncEvent) -> Result<(), String> {
    // Attribution runs for every OWNED, linked contract the sync touches.
    // Its failure must be visible (it is part of the accountability
    // contract), but it must not block the state mirror — both legs run,
    // both report.
    let mut attribution_err: Option<String> = None;
    if !matches!(event, SyncEvent::NoOp) {
        if let (Some(identifier), Some(owner)) = (&c.linear, &c.owner) {
            match linear_ensure_agent_label(identifier, owner) {
                Ok(Some(label)) => log_activity(
                    conn, &c.id, &format!("linear:{identifier}"), "attribution",
                    &format!("label {label}"),
                ),
                Ok(None) => {}
                Err(e) => attribution_err = Some(format!("linear-label: {e}")),
            }
        }
    }
    let result = match event {
        SyncEvent::NoOp => Ok(()),
        SyncEvent::ClaimAccepted => {
            let owner = c.owner.clone().unwrap_or_else(|| "unassigned".to_string());
            let marker = format!("<!-- swarm-sync:{}:claim -->", c.id);
            let body = format!(
                "{marker}\n**[{owner}]** claim accepted — contract `{}` in progress.",
                c.id
            );
            // The two legs are independent external systems: a Linear failure
            // must not silently skip a reachable GitHub (and vice versa).
            // Attempt both, then report every failure.
            let mut errs: Vec<String> = Vec::new();
            if let Some(identifier) = &c.linear {
                match (|| -> Result<(bool, bool), String> {
                    let moved = linear_ensure_state(identifier, "In Progress")?;
                    let posted = linear_comment_if_absent(identifier, &marker, &body)?;
                    Ok((moved, posted))
                })() {
                    Ok((moved, posted)) => {
                        if moved || posted {
                            log_activity(conn, &c.id, &format!("linear:{identifier}"), "claim-accepted", &changed_detail(moved, posted, "In Progress"))
                        }
                    }
                    Err(e) => errs.push(format!("linear: {e}")),
                }
            }
            if let Some(num) = c.github_issue {
                match gh_comment_if_absent(num, &marker, &body) {
                    Ok(true) => log_activity(conn, &c.id, &format!("github:#{num}"), "claim-accepted", "comment"),
                    Ok(false) => {}
                    Err(e) => errs.push(format!("github: {e}")),
                }
            }
            if errs.is_empty() { Ok(()) } else { Err(errs.join("; ")) }
        }
        SyncEvent::Verified => {
            let pr_part = c.github_pr.map(|p| format!("PR #{p}")).unwrap_or_else(|| "no PR recorded".to_string());
            let recon = if c.recon.is_empty() { "(no recon detail recorded)" } else { &c.recon };
            let marker = format!("<!-- swarm-sync:{}:verified -->", c.id);
            let body = format!("{marker}\nVerified. {pr_part}. recon: {recon}");
            let mut errs: Vec<String> = Vec::new();
            if let Some(identifier) = &c.linear {
                // THE gate: this branch is only reachable when `event` was
                // classified as `Verified`, which only happens for
                // `status == "verified"` — never for `submitted`.
                match (|| -> Result<(bool, bool), String> {
                    let moved = linear_ensure_state(identifier, "Done")?;
                    let posted = linear_comment_if_absent(identifier, &marker, &body)?;
                    Ok((moved, posted))
                })() {
                    Ok((moved, posted)) => {
                        if moved || posted {
                            log_activity(conn, &c.id, &format!("linear:{identifier}"), "verified-done", &changed_detail(moved, posted, "Done"))
                        }
                    }
                    Err(e) => errs.push(format!("linear: {e}")),
                }
            }
            if let Some(num) = c.github_issue {
                match (|| -> Result<bool, String> {
                    let posted = gh_comment_if_absent(num, &marker, &body)?;
                    gh_close_issue(num)?;
                    Ok(posted)
                })() {
                    Ok(posted) => log_activity(conn, &c.id, &format!("github:#{num}"), "verified-done", if posted { "close + comment" } else { "close (comment already present)" }),
                    Err(e) => errs.push(format!("github: {e}")),
                }
            }
            if errs.is_empty() { Ok(()) } else { Err(errs.join("; ")) }
        }
        SyncEvent::Flagged(why) => {
            let marker = format!("<!-- swarm-sync:{}:disputed -->", c.id);
            let body = format!("{marker}\nDISPUTED/unverified — stays In Progress. {why}");
            let mut errs: Vec<String> = Vec::new();
            if let Some(identifier) = &c.linear {
                match (|| -> Result<(bool, bool), String> {
                    let moved = linear_ensure_state(identifier, "In Progress")?; // never Done
                    let posted = linear_comment_if_absent(identifier, &marker, &body)?;
                    Ok((moved, posted))
                })() {
                    Ok((moved, posted)) => {
                        if moved || posted {
                            log_activity(conn, &c.id, &format!("linear:{identifier}"), "flagged", &changed_detail(moved, posted, "In Progress"))
                        }
                    }
                    Err(e) => errs.push(format!("linear: {e}")),
                }
            }
            if let Some(num) = c.github_issue {
                // Reopen guard (FEATURE 3, symmetric with the Verified arm's
                // close): a DISPUTED/unverified verdict arriving after an
                // earlier `verified` had already closed this issue must not
                // leave the public issue looking resolved. Reopen BEFORE
                // posting so the comment lands on the now-open issue, same
                // ordering as Verified's comment-then-close.
                match (|| -> Result<(bool, bool), String> {
                    let reopened = gh_reopen_issue(num)?;
                    let posted = gh_comment_if_absent(num, &marker, &body)?;
                    Ok((reopened, posted))
                })() {
                    Ok((reopened, posted)) => {
                        if reopened {
                            log_activity(
                                conn, &c.id, &format!("github:#{num}"), "reopened",
                                "DISPUTED/unverified after the issue had been closed",
                            );
                        }
                        if posted {
                            log_activity(conn, &c.id, &format!("github:#{num}"), "flagged", "comment");
                        }
                    }
                    Err(e) => errs.push(format!("github: {e}")),
                }
            }
            if errs.is_empty() { Ok(()) } else { Err(errs.join("; ")) }
        }
    };
    match (result, attribution_err) {
        (Ok(()), None) => Ok(()),
        (Ok(()), Some(a)) => Err(a),
        (Err(e), None) => Err(e),
        (Err(e), Some(a)) => Err(format!("{e}; {a}")),
    }
}

/// PART 2 — OUTBOUND, the gated half. Defaults to a dry run computed purely
/// from local DB state (zero network calls); `--confirm` is required for
/// any real read or write.
fn cmd_sync_push(args: &Args) -> rusqlite::Result<()> {
    // `--confirm` gates real external writes, so it must be VALUE-BLIND-proof:
    // the parser stores `--confirm false` as Str("false"), and a bare
    // presence check would treat that as confirmed — the exact "the flag said
    // no but the code heard yes" failure this codebase exists to prevent.
    let confirm = match args.get("confirm") {
        None => false,
        Some(ArgVal::Flag) => true,
        Some(ArgVal::Str(v)) => die(
            &format!(
                "--confirm takes no value (got '{v}'). Pass --confirm alone to \
                 perform real external writes, or omit it for a dry run."
            ),
            2,
        ),
    };
    let conn = open_db()?;
    let contracts = load_sync_contracts(&conn)?;

    if contracts.is_empty() {
        println!("sync --push: no contract carries a linear/github id yet — nothing to mirror.");
        return Ok(());
    }

    if confirm {
        println!("sync --push --confirm: applying plan for {} contract(s) with an external id:", contracts.len());
    } else {
        println!(
            "DRY RUN (pass --confirm to write) — plan for {} contract(s) with an external id. \
             Zero network calls are made in this mode.",
            contracts.len()
        );
    }

    let mut failures = 0usize;
    for c in &contracts {
        let event = classify(&c.status, &c.recon, &c.note);
        let target_desc = match (&c.linear, c.github_issue) {
            (Some(l), Some(g)) => format!("linear={l} github_issue=#{g}"),
            (Some(l), None) => format!("linear={l}"),
            (None, Some(g)) => format!("github_issue=#{g}"),
            (None, None) => "no external id".to_string(), // filtered out by the query above
        };

        match &event {
            SyncEvent::NoOp => {
                println!("  {} [{target_desc}] status={} -> no sync action defined, skipping", c.id, c.status);
                continue;
            }
            SyncEvent::ClaimAccepted => {
                let verb = if confirm { "moving" } else { "WOULD move" };
                println!(
                    "  {} [{target_desc}] status={} -> {verb} Linear/GitHub to In Progress + comment; NO Done transition",
                    c.id, c.status
                );
            }
            SyncEvent::Verified => {
                let verb = if confirm { "moving" } else { "WOULD move" };
                println!(
                    "  {} [{target_desc}] status=verified -> {verb} Linear to Done + close/comment on GitHub with PR + recon result",
                    c.id
                );
            }
            SyncEvent::Flagged(why) => {
                let trimmed: String = why.chars().take(120).collect();
                println!(
                    "  {} [{target_desc}] status={} -> stays In Progress (NOT Done) + comment flags: {trimmed}",
                    c.id, c.status
                );
            }
        }

        if !confirm {
            continue; // dry run: plan printed above, nothing external touched
        }

        if let Err(e) = apply_sync_event(&conn, c, &event) {
            eprintln!("swarm-bus: could-not-sync: {} — {e}", c.id);
            failures += 1;
        }
    }

    if !confirm {
        println!("DRY RUN complete — 0 external writes performed. Re-run with --confirm to apply.");
        return Ok(());
    }

    if failures > 0 {
        eprintln!("swarm-bus: sync --push completed with {failures} could-not-sync failure(s)");
        std::process::exit(1);
    }
    println!("sync --push: confirmed writes complete for {} contract(s)", contracts.len());
    Ok(())
}

// ---------------------------------------------------------------------------
// FEATURE 4 — `verify-merged`: closes the swarm's last accountability gap.
// See the module doc comment's `verify-merged` entry for the full contract;
// this section is the implementation.
// ---------------------------------------------------------------------------

/// STRICT PR reference parser (`verify-merged` PR resolution, priority (c)).
/// Only two shapes count as a PR reference:
///   - a full GitHub pull URL segment `github.com/<owner>/<repo>/pull/NNN`
///   - `PR #NNN` or `PR#NNN` (case-sensitive "PR", an optional single space
///     before the digits, "PR" itself not glued onto a preceding letter/
///     digit — so this never fires inside a longer word like "APPROVED#5")
///
/// A BARE `#NNN` — with no leading "PR" and no `github.com/.../pull/`
/// context — must NEVER match. That exact laxity once grabbed the PR that
/// CAUSED a bug, quoted as context in a verdict body, for a read-only audit
/// that had no PR of its own. No `regex` dependency: bodies are short prose/
/// URLs, so a hand-rolled byte scan is enough and adds nothing to the
/// dependency surface.
fn parse_pr_ref(body: &str) -> Option<i64> {
    let bytes = body.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    while i < len {
        if bytes[i..].starts_with(b"github.com/") {
            if let Some(n) = parse_github_pull_url(bytes, i + "github.com/".len()) {
                return Some(n);
            }
        }
        if bytes[i..].starts_with(b"PR") {
            let prev_ok = i == 0 || !bytes[i - 1].is_ascii_alphanumeric();
            if prev_ok {
                if let Some(n) = parse_pr_hash(bytes, i + 2) {
                    return Some(n);
                }
            }
        }
        i += 1;
    }
    None
}

/// The longest run of ASCII digits starting at `start`, parsed as an i64.
/// `None` when there is no digit at `start` at all — an empty digit run is
/// not a number, it's the absence of one.
fn parse_digits(bytes: &[u8], start: usize) -> Option<i64> {
    let mut end = start;
    while end < bytes.len() && bytes[end].is_ascii_digit() {
        end += 1;
    }
    if end == start {
        return None;
    }
    std::str::from_utf8(&bytes[start..end]).ok()?.parse::<i64>().ok()
}

/// From just past a matched `"PR"`, accept an optional single space then a
/// required `#` then digits. `"PR"` alone, `"PR "` alone, or `"PR "` (or
/// `"PR"`) followed by anything other than `#`+digit is not a match.
fn parse_pr_hash(bytes: &[u8], mut j: usize) -> Option<i64> {
    if j < bytes.len() && bytes[j] == b' ' {
        j += 1;
    }
    if j < bytes.len() && bytes[j] == b'#' {
        return parse_digits(bytes, j + 1);
    }
    None
}

/// From just past a matched `"github.com/"`, require `<owner>/<repo>/pull/`
/// (exactly `"pull"`, never `"issue"` or `"issues"`) followed by digits.
fn parse_github_pull_url(bytes: &[u8], start: usize) -> Option<i64> {
    let rest = &bytes[start..];
    let s = std::str::from_utf8(rest).ok()?;
    let segs: Vec<&str> = s.splitn(4, '/').collect();
    if segs.len() == 4 && segs[2] == "pull" {
        let digits: String = segs[3].chars().take_while(char::is_ascii_digit).collect();
        if !digits.is_empty() {
            return digits.parse::<i64>().ok();
        }
    }
    None
}

/// The merged-vs-not decision, isolated from any I/O so it's unit-testable
/// against every shape `gh pr view --json state,mergedAt` can hand back.
/// MERGED plus a non-empty `mergedAt` is the ONLY accepted combination — an
/// OPEN PR, a CLOSED-but-unmerged PR, and (defensively) a MERGED state with
/// a null/empty timestamp are all rejected as evidence.
fn is_merged_evidence(state: &str, merged_at: Option<&str>) -> bool {
    state == "MERGED" && merged_at.is_some_and(|s| !s.is_empty())
}

/// PR resolution for one contract, in priority order (module doc,
/// `verify-merged`): (a) `contract.github_pr` if the caller already has it,
/// (b) the typed `pr` column on the contract's most recent verdict message,
/// (c) a STRICT prose parse (`parse_pr_ref`) of that contract's most recent
/// verdict body. Returns `None` — never a guess — when nothing in that
/// chain resolves.
fn resolve_pr(
    conn: &Connection,
    cid: &str,
    contract_pr: Option<i64>,
) -> Result<Option<(String, i64)>, String> {
    // The `contract.github_pr` link (caller-provided or on the row) can name ANY
    // repo, so it MUST carry `github_repo`. A bare number with no repo is REFUSED
    // for auto-verify (Err → could-not-check by every caller), never defaulted to
    // GITHUB_REPO — defaulting IS the collision (R2, C-SWARM-RECON-AUTHORITY).
    if let Some(pr) = contract_pr {
        let github_repo: Option<String> = conn
            .query_row(
                "SELECT github_repo FROM contract WHERE id = ?1",
                params![cid],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .flatten();
        return match github_repo {
            Some(repo) => Ok(Some((repo, pr))),
            None => Err(format!(
                "contract has github_pr #{pr} but no github_repo — a cross-repo link \
                 must name its repo (set --github-repo); refusing to resolve #{pr} \
                 against {GITHUB_REPO}, which is how a false receipt is minted"
            )),
        };
    }
    // Fallbacks resolve the swarm's OWN verdict-message PR references, which are
    // aihu-project/aihu by construction — a KNOWN repo, not an unknown default.
    let from_column: Option<i64> = conn
        .query_row(
            "SELECT pr FROM msg WHERE contract = ?1 AND kind = 'verdict' AND pr IS NOT NULL \
             ORDER BY ts DESC LIMIT 1",
            params![cid],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(pr) = from_column {
        return Ok(Some((GITHUB_REPO.to_string(), pr)));
    }
    let latest_verdict_body: Option<String> = conn
        .query_row(
            "SELECT body FROM msg WHERE contract = ?1 AND kind = 'verdict' \
             ORDER BY ts DESC LIMIT 1",
            params![cid],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(latest_verdict_body
        .as_deref()
        .and_then(parse_pr_ref)
        .map(|pr| (GITHUB_REPO.to_string(), pr)))
}

/// R1 (C-SWARM-RECON-AUTHORITY): adjudicate whether a contract has a GENUINE
/// merged-PR receipt — the SAME discipline `verify-merged` applies, factored so
/// the `setstatus --status verified --reconciled` path cannot diverge from it.
/// Returns the MACHINE-GENERATED `merged: PR #N @ <sha> <ts>` receipt (a
/// transcript fragment can never wear its costume, because this code path, not
/// the caller, writes it), or an `Err(reason)` the caller turns into a
/// could-not-check `unverified`: no PR reference, unknown repo (refused by
/// `resolve_pr`), a failed query (NEVER read as "not merged"), or not merged.
fn adjudicate_merged(
    conn: &Connection,
    cid: &str,
    contract_pr: Option<i64>,
) -> Result<String, String> {
    let (repo, pr) = match resolve_pr(conn, cid, contract_pr)? {
        Some(rp) => rp,
        None => return Err("no PR reference".to_string()),
    };
    let data = gh_pr_view(&repo, pr).map_err(|e| format!("PR #{pr} ({repo}): {e}"))?;
    let state = data.get("state").and_then(Value::as_str).unwrap_or("");
    let merged_at = data.get("mergedAt").and_then(Value::as_str);
    if !is_merged_evidence(state, merged_at) {
        return Err(format!("PR #{pr} ({repo}) not merged (state={state})"));
    }
    let short: String = data
        .pointer("/mergeCommit/oid")
        .and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .take(8)
        .collect();
    Ok(format!("merged: PR #{pr} @ {short} {}", merged_at.unwrap_or("")))
}

/// `verify-merged`: for every contract not already `verified` and sitting
/// at claimed/building/submitted/no-claims, resolve a PR (`resolve_pr`),
/// ask GitHub whether it is genuinely merged (`is_merged_evidence`), and if
/// so promote the contract to `verified` through the exact same write path
/// (`write_contract_status`) `setstatus --reconciled` uses. See the module
/// doc comment for the full contract (dry-run default, `could-not-check`
/// posture, idempotency).
fn cmd_verify_merged(args: &Args) -> rusqlite::Result<()> {
    // Same value-blind-proofing as `sync --push`'s `--confirm` and
    // `setstatus`'s `--reconciled`: `--confirm false` must die, not be read
    // as "confirmed" because the flag was merely present.
    let confirm = match args.get("confirm") {
        None => false,
        Some(ArgVal::Flag) => true,
        Some(ArgVal::Str(v)) => die(
            &format!(
                "--confirm takes no value (got '{v}'). Pass --confirm alone to \
                 verify contracts from merged PRs, or omit it for a dry run."
            ),
            2,
        ),
    };

    let conn = open_db()?;
    let mut candidates: Vec<(String, Option<i64>)> = Vec::new();
    {
        // The status filter IS the "not already verified" + idempotency
        // guard: `verified` is deliberately absent from this list, so a
        // contract this command already promoted is never reselected.
        let mut stmt = conn.prepare(
            "SELECT id, github_pr FROM contract \
             WHERE status IN ('claimed','building','submitted','no-claims') \
             ORDER BY id",
        )?;
        let rows =
            stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<i64>>(1)?)))?;
        for r in rows {
            candidates.push(r?);
        }
    }

    if confirm {
        println!(
            "verify-merged --confirm: checking {} candidate contract(s):",
            candidates.len()
        );
    } else {
        println!(
            "DRY RUN (pass --confirm to write) — checking {} candidate contract(s). \
             `gh pr view` reads still run so the plan reflects real GitHub state; \
             nothing is written.",
            candidates.len()
        );
    }

    let mut verified = 0i64;
    let mut skipped_no_pr = 0i64;
    let mut could_not_check = 0i64;

    for (cid, contract_pr) in &candidates {
        let (repo, pr) = match resolve_pr(&conn, cid, *contract_pr) {
            Ok(Some(rp)) => rp,
            Ok(None) => {
                println!("  {cid}: no PR reference — skipped");
                skipped_no_pr += 1;
                continue;
            }
            Err(e) => {
                println!("  could-not-check: {cid} {e}");
                could_not_check += 1;
                continue;
            }
        };

        let data = match gh_pr_view(&repo, pr) {
            Ok(d) => d,
            Err(e) => {
                // A failed query is NEVER "not merged" — it's unknown, and
                // reported as such.
                println!("  could-not-check: {cid} PR #{pr} ({repo}): {e}");
                could_not_check += 1;
                continue;
            }
        };
        let state = data.get("state").and_then(Value::as_str).unwrap_or("");
        let merged_at = data.get("mergedAt").and_then(Value::as_str);
        if !is_merged_evidence(state, merged_at) {
            println!("  {cid}: PR #{pr} not merged (state={state}) — not verified");
            continue;
        }
        let merge_commit_oid = data
            .pointer("/mergeCommit/oid")
            .and_then(Value::as_str)
            .unwrap_or("");
        let short: String = merge_commit_oid.chars().take(8).collect();
        let merged_at_str = merged_at.unwrap_or("");
        let recon = format!("merged: PR #{pr} @ {short} {merged_at_str}");

        if confirm {
            // The SAME internal path as `setstatus --reconciled` — this IS
            // the reconcile pass, acting on objective evidence rather than
            // a human's --reconciled flag.
            match write_contract_status(&conn, cid, "verified", &recon, Some(pr)) {
                Ok(()) => {
                    verified += 1;
                    println!("  {cid}: verified — {recon}");
                }
                Err(e) => {
                    println!("  could-not-check: {cid} write failed: {e}");
                    could_not_check += 1;
                }
            }
        } else {
            verified += 1;
            println!("  {cid}: WOULD verify — {recon}");
        }
    }

    println!(
        "verify-merged: {verified} verified from merged PRs, {skipped_no_pr} skipped (no PR), \
         {could_not_check} could-not-check"
    );

    // Same posture as `sync --push`: a real failure exits nonzero even
    // though partial progress was made and printed.
    if could_not_check > 0 {
        std::process::exit(1);
    }
    Ok(())
}

// ---------------------------------------------------------------------------

/// `export --to <path>` — write a fully-materialised, read-safe snapshot of the
/// bus via `VACUUM INTO`. Unlike `cp ~/.swarm/bus.db` (which in WAL mode can
/// silently omit uncheckpointed writes, and is only correct with its -wal/-shm
/// sidecars), the result is a SINGLE standalone DB reflecting ALL committed
/// state — a consistent read-transaction snapshot that holds even when a
/// concurrent reader's held page-snapshot blocks a checkpoint from backfilling
/// the main file. This is the hazard-proof way to back up or hand-copy the
/// ledger; `md5 bus.db` unchanged is NOT evidence the bus was untouched, but a
/// diff of two `export`s is.
fn cmd_export(args: &Args) -> rusqlite::Result<()> {
    let to = match args.get_str("to") {
        Some(p) if !p.is_empty() => p,
        _ => die("export requires --to <path>", 64),
    };
    let conn = open_db()?;
    conn.execute("VACUUM INTO ?1", rusqlite::params![to])?;
    println!("exported authoritative snapshot -> {to}");
    Ok(())
}

/// The git sha this binary was compiled from, embedded by `build.rs`.
/// `"unknown"` when built outside a git checkout — see the staleness check.
const BUILD_SHA: &str = env!("SWARM_BUILD_SHA");

/// Prints what source this binary came from. The whole point of
/// C-SWARM-DEPLOY-GAP: before this, `--version` was `unknown command` (exit 64)
/// and there was no way to ask the running CLI what code it was.
fn cmd_version() {
    println!("swarm-bus {} ({})", env!("CARGO_PKG_VERSION"), BUILD_SHA);
    println!("rebuild + install:  bun run swarm:install");
}

/// LOUD when the installed binary predates the repo it is invoked in.
///
/// The failure this exists to catch is silent by nature: merging a
/// `packages/swarm` PR does not touch `~/.swarm/bin/swarm-bus`, so the bus goes
/// on running old code while everyone reads the merged diff and assumes
/// otherwise. Silence when stale is the bug; this prints to **stderr** so it
/// cannot corrupt stdout that another tool is parsing.
///
/// BEST-EFFORT, and every branch below returns rather than failing:
///   * no `git`, not a checkout, unknown/dirty stamp -> say nothing
///   * the invoking repo has no `packages/swarm` -> not our repo, say nothing
///   * build sha not an ancestor of HEAD -> a side branch or a rewritten
///     history, not evidence of staleness; saying "stale" there would be a
///     false alarm, and a warning that cries wolf gets filtered out mentally,
///     which costs more than the one it catches.
/// A missing repo context must NEVER break the CLI — the write already
/// succeeded by the time this runs.
fn warn_if_stale() {
    if BUILD_SHA == "unknown" || BUILD_SHA.ends_with("-dirty") {
        return;
    }
    let git = |args: &[&str]| -> Option<String> {
        let out = std::process::Command::new("git").args(args).output().ok()?;
        out.status
            .success()
            .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
    };

    // Only compare against a checkout that actually contains this crate.
    let root = match git(&["rev-parse", "--show-toplevel"]) {
        Some(r) if !r.is_empty() => r,
        _ => return,
    };
    if !std::path::Path::new(&root).join("packages/swarm").is_dir() {
        return;
    }
    // Is the built sha even in this history? If not, stay quiet (see above).
    if std::process::Command::new("git")
        .args(["merge-base", "--is-ancestor", BUILD_SHA, "HEAD"])
        .status()
        .map(|s| !s.success())
        .unwrap_or(true)
    {
        return;
    }
    // Count commits touching THIS crate since the build. Commits elsewhere in
    // the monorepo cannot make this binary stale, and warning on them would
    // fire on nearly every invocation.
    let behind = git(&[
        "rev-list",
        "--count",
        &format!("{BUILD_SHA}..HEAD"),
        "--",
        "packages/swarm",
    ])
    .and_then(|s| s.parse::<u32>().ok())
    .unwrap_or(0);
    if behind == 0 {
        return;
    }

    eprintln!(
        "swarm-bus: STALE BINARY — built from {}, but packages/swarm has moved {} commit(s) since.",
        &BUILD_SHA[..BUILD_SHA.len().min(8)],
        behind
    );
    eprintln!("swarm-bus: you are NOT running the merged code. Rebuild: bun run swarm:install");
}

fn main() {
    let raw_args: Vec<String> = env::args().collect();
    if raw_args.len() < 2 {
        die(
            "usage: swarm-bus <send|pull|offer|claim|ack|attempt|setstatus|watch|ready|sync|link|verify-merged|export|--version> [--k v ...]",
            64,
        );
    }
    let cmd = raw_args[1].clone();
    if cmd == "--version" || cmd == "-V" || cmd == "version" {
        cmd_version();
        return;
    }
    // Before the work, not after: if a command is about to write to the ledger
    // on stale code, the warning is only useful ahead of it.
    warn_if_stale();
    let args = parse_args(&raw_args[2..]);

    let result = match cmd.as_str() {
        "send" => cmd_send(&args),
        "pull" => cmd_pull(&args),
        "offer" => cmd_offer(&args),
        "claim" => cmd_claim(&args),
        "ack" => cmd_ack(&args),
        "attempt" => cmd_attempt(&args),
        "setstatus" => cmd_setstatus(&args),
        "watch" => cmd_watch(&args),
        "ready" => cmd_ready(&args),
        "sync" => cmd_sync(&args),
        "link" => cmd_link(&args),
        "verify-merged" => cmd_verify_merged(&args),
        "export" => cmd_export(&args),
        other => die(&format!("unknown command '{other}'"), 64),
    };

    if let Err(e) = result {
        eprintln!("swarm-bus: {e}");
        std::process::exit(1);
    }

    // C-SWARM-WAL-STALE: the DB is WAL-mode (open_db) and opened per-invocation,
    // so a committed write lands in `bus.db-wal`, not `bus.db`. Nothing ever
    // checkpointed, so the MAIN file lagged by every write since the last one —
    // a plain `cp bus.db` / backup / `md5 bus.db` reads a STALE ledger with no
    // signal that it is stale ("the bus is the record", and its most obvious
    // artifact was hours behind). After a successful WRITE, checkpoint the WAL
    // into the main file so `bus.db` alone is authoritative; TRUNCATE also stops
    // `bus.db-wal` growing without bound (it had reached ~4 MB).
    //
    // WAL STAYS ON (anti-row): this does not touch journal_mode — concurrent
    // agents still read via the WAL while one writes. The checkpoint is
    // BEST-EFFORT: under a concurrent reader/writer it returns SQLITE_BUSY and
    // copies only the frames it can, so we ignore its result — a committed write
    // is NEVER turned into a CLI error, and the next write flushes the rest. No
    // writer is serialised beyond the `busy_timeout` the connection already sets.
    if is_write_cmd(&cmd) {
        if let Ok(conn) = open_db() {
            let _ = conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_row| Ok(()));
        }
    }
}

/// Commands that mutate the DB (`msg`, `contract`, `seen`, `activity`, sync
/// state). Read-only commands (`watch`, `ready`) are excluded so a reader never
/// pays for a checkpoint. `pull` is a WRITE — it records `seen` rows.
fn is_write_cmd(cmd: &str) -> bool {
    matches!(
        cmd,
        "send"
            | "offer"
            | "claim"
            | "ack"
            | "attempt"
            | "setstatus"
            | "sync"
            | "link"
            | "verify-merged"
            | "pull"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// THE gate, exhaustively: external Done mirrors `verified` ONLY.
    /// Every status in the closed enum, plus the traps (case variants,
    /// whitespace, the empty string), asserting which SyncEvent each
    /// produces. If a refactor ever lets any non-"verified" status reach
    /// SyncEvent::Verified, this fails before it ships.
    #[test]
    fn classify_done_gate_is_exhaustive() {
        let verified = |s: &str| matches!(classify(s, "", ""), SyncEvent::Verified);

        assert!(verified("verified"), "verified must reach Verified");
        for s in [
            "offered", "claimed", "building", "submitted", "no-claims",
            "DISPUTED", "unverified", "declined",
            // the traps: case/whitespace variants and garbage must NEVER
            // produce a Done transition
            "Verified", "VERIFIED", " verified", "verified ", "", "done",
            "submitted-but-really-done",
        ] {
            assert!(!verified(s), "status '{s}' must NEVER classify as Verified");
        }
    }

    #[test]
    fn classify_in_progress_and_flagged_families() {
        for s in ["claimed", "building", "submitted"] {
            assert!(matches!(classify(s, "", ""), SyncEvent::ClaimAccepted));
        }
        for s in ["DISPUTED", "unverified"] {
            assert!(matches!(classify(s, "r", ""), SyncEvent::Flagged(_)));
        }
        // offered/declined and unknown strings are NoOp — never an external write
        for s in ["offered", "declined", "garbage", ""] {
            assert!(matches!(classify(s, "", ""), SyncEvent::NoOp));
        }
    }

    #[test]
    fn flagged_reason_prefers_recon_then_note() {
        match classify("DISPUTED", "recon-detail", "note-detail") {
            SyncEvent::Flagged(w) => assert_eq!(w, "recon-detail"),
            _ => panic!("expected Flagged"),
        }
        match classify("unverified", "", "note-detail") {
            SyncEvent::Flagged(w) => assert_eq!(w, "note-detail"),
            _ => panic!("expected Flagged"),
        }
        match classify("DISPUTED", "", "") {
            SyncEvent::Flagged(w) => assert_eq!(w, "no reason recorded"),
            _ => panic!("expected Flagged"),
        }
    }

    /// The setstatus boundary enum must stay in lockstep with classify():
    /// every status classify() handles specially is in the closed list.
    #[test]
    fn agent_label_carries_the_identity_tuple() {
        assert_eq!(agent_label_name("builder", Some("almaty")), "agent:builder@almaty");
        // No registry binding -> role-only label, never a fabricated city.
        assert_eq!(agent_label_name("orchestrator", None), "agent:orchestrator");
    }

    #[test]
    fn contract_statuses_cover_classify_arms() {
        for s in ["claimed", "building", "submitted", "verified", "DISPUTED", "unverified"] {
            assert!(CONTRACT_STATUSES.contains(&s), "'{s}' missing from CONTRACT_STATUSES");
        }
    }

    // FEATURE 2 (`link`) — decide_link is the pure core of the COALESCE +
    // conflict logic, exercised here without a DB or a live query.

    #[test]
    fn decide_link_sets_when_field_is_null() {
        assert!(matches!(decide_link(None, "FEL-1", None), Ok(LinkDecision::Set)));
    }

    #[test]
    fn decide_link_is_a_noop_when_already_matching() {
        assert!(matches!(
            decide_link(Some("FEL-1"), "FEL-1", None),
            Ok(LinkDecision::AlreadyMatches)
        ));
    }

    #[test]
    fn decide_link_dies_different_when_this_contract_disagrees() {
        match decide_link(Some("FEL-1"), "FEL-2", None) {
            Err(LinkConflict::Different(e)) => assert_eq!(e, "FEL-1"),
            _ => panic!("expected Different(\"FEL-1\")"),
        }
    }

    #[test]
    fn decide_link_conflict_takes_priority_over_same_contract_state() {
        // Even when this contract's own field already matches the request,
        // another contract owning the SAME value must still win as a
        // CONFLICT — one external id, one owning contract, no exceptions.
        match decide_link(Some("FEL-1"), "FEL-1", Some("C-OTHER")) {
            Err(LinkConflict::Other(o)) => assert_eq!(o, "C-OTHER"),
            _ => panic!("expected Other(\"C-OTHER\")"),
        }
    }

    #[test]
    fn decide_link_conflict_when_another_contract_owns_it_and_this_one_is_null() {
        match decide_link(None, "FEL-1", Some("C-OTHER")) {
            Err(LinkConflict::Other(o)) => assert_eq!(o, "C-OTHER"),
            _ => panic!("expected Other(\"C-OTHER\")"),
        }
    }

    // FEATURE 4 (`verify-merged`) — `parse_pr_ref` is the strict prose
    // parser; all six required shapes from the spec, exhaustively.

    #[test]
    fn parse_pr_ref_matches_full_github_pull_url() {
        assert_eq!(
            parse_pr_ref("merged as https://github.com/aihu-project/aihu/pull/641 today"),
            Some(641)
        );
    }

    #[test]
    fn parse_pr_ref_matches_pr_hash_with_space() {
        assert_eq!(parse_pr_ref("Verdict: closed via PR #641."), Some(641));
    }

    #[test]
    fn parse_pr_ref_matches_pr_hash_no_space() {
        assert_eq!(parse_pr_ref("Verdict: closed via PR#641."), Some(641));
    }

    #[test]
    fn parse_pr_ref_rejects_bare_hash() {
        // No leading "PR" and no github.com/.../pull/ context — a bare
        // `#NNN` must never be read as a PR reference.
        assert_eq!(parse_pr_ref("closes #641"), None);
    }

    #[test]
    fn parse_pr_ref_rejects_bare_hash_in_prose() {
        // The exact laxity that once grabbed the PR that CAUSED a bug,
        // quoted as context, for a read-only audit with no PR of its own.
        assert_eq!(
            parse_pr_ref("root-caused by the change in #12, verified as read-only"),
            None
        );
    }

    #[test]
    fn parse_pr_ref_rejects_issue_path() {
        assert_eq!(parse_pr_ref("see issue/641 for background"), None);
        // Also rejects the URL-shaped equivalent: an /issue/ path is not a
        // /pull/ path, even under github.com/.
        assert_eq!(
            parse_pr_ref("https://github.com/aihu-project/aihu/issue/641"),
            None
        );
    }

    #[test]
    fn parse_pr_ref_does_not_false_positive_on_pr_inside_a_word() {
        // "APPROVED#5" contains the substring "PR" at a non-word-boundary
        // position — must not be read as "PR#5".
        assert_eq!(parse_pr_ref("STATUS: APPROVED#5"), None);
    }

    // FEATURE 4 — `is_merged_evidence`: MERGED + non-null mergedAt is the
    // only accepted combination.

    #[test]
    fn is_merged_evidence_accepts_merged_with_timestamp() {
        assert!(is_merged_evidence("MERGED", Some("2026-07-27T18:38:35Z")));
    }

    #[test]
    fn is_merged_evidence_rejects_open() {
        assert!(!is_merged_evidence("OPEN", None));
    }

    #[test]
    fn is_merged_evidence_rejects_closed_unmerged() {
        assert!(!is_merged_evidence("CLOSED", None));
    }

    #[test]
    fn is_merged_evidence_rejects_merged_with_null_merged_at() {
        assert!(!is_merged_evidence("MERGED", None));
    }

    // FEATURE 5 (done-verdict-requires-claims) — `VerdictStatus` is the
    // closed 3-value enum behind `send --status`.

    #[test]
    fn verdict_status_parses_all_three_valid_values() {
        assert_eq!(VerdictStatus::parse("done"), Some(VerdictStatus::Done));
        assert_eq!(VerdictStatus::parse("blocked"), Some(VerdictStatus::Blocked));
        assert_eq!(
            VerdictStatus::parse("could-not-check"),
            Some(VerdictStatus::CouldNotCheck)
        );
    }

    #[test]
    fn verdict_status_rejects_unknown_values() {
        // Case variants and near-misses must NOT be silently accepted.
        for s in ["Done", "DONE", "done ", " done", "complete", "", "could_not_check"] {
            assert_eq!(VerdictStatus::parse(s), None, "'{s}' must not parse");
        }
    }

    // `validate_claims` — the pure parser behind `send --claims`. Claims are
    // comma-separated verb:target pairs; a malformed one is the same
    // silent-failure class as no claim at all, so it must be rejected, not
    // merely accepted because the string is non-empty.

    #[test]
    fn validate_claims_accepts_valid_multi_claim() {
        assert!(validate_claims("pushed:PR#640,ran:cargo test").is_ok());
    }

    /// REGRESSION: a closed verb enum rejected 5 of the 6 verbs agents
    /// actually write, measured against real bus traffic before deploy.
    /// These exact strings came off the live bus.
    #[test]
    fn validate_claims_accepts_the_verbs_agents_really_use() {
        for c in [
            "repro:moon check->app::missing_workspace",
            "verified:tsc runs in web+shared",
            "tested:arg-parse filter collects all 3 names",
            "impl:packages/swarm/src/main.rs",
            "couldnotcheck:full mutating scaffold",
            "already-resolved-by:merged #645",
        ] {
            assert!(validate_claims(c).is_ok(), "must accept real-world claim: {c}");
        }
    }

    /// The format guard must still bite: prose before the colon is not a verb.
    #[test]
    fn validate_claims_still_rejects_prose_verbs() {
        assert!(validate_claims("this is a sentence:target").is_err());
        assert!(validate_claims("has space:x").is_err());
    }

    #[test]
    fn validate_claims_accepts_every_valid_verb() {
        for verb in CLAIM_VERBS {
            let claim = format!("{verb}:target");
            assert!(validate_claims(&claim).is_ok(), "'{claim}' should be valid");
        }
    }

    #[test]
    fn validate_claims_rejects_missing_colon() {
        let err = validate_claims("PR640").unwrap_err();
        assert!(err.contains("PR640"), "error should name the offending entry: {err}");
    }

    #[test]
    fn validate_claims_accepts_an_unfamiliar_but_wellformed_verb() {
        // Was `rejects_unknown_verb`. That test encoded a CLOSED verb set,
        // which measurement against live traffic disproved: agents write
        // `repro:`, `verified:`, `couldnotcheck:` and similar, all of them
        // legitimate. An unfamiliar verb is fine; an unparseable claim is not.
        assert!(validate_claims("invented:X").is_ok());
        let err = validate_claims("invented X").unwrap_err();
        assert!(err.contains("invented X"), "error should name the offender: {err}");
    }

    #[test]
    fn validate_claims_rejects_empty_target() {
        let err = validate_claims("pushed:").unwrap_err();
        assert!(err.contains("pushed:"), "error should name the offender: {err}");
    }

    #[test]
    fn validate_claims_rejects_empty_string() {
        assert!(validate_claims("").is_err());
    }

    #[test]
    fn validate_claims_rejects_one_bad_entry_among_good_ones() {
        // A single malformed entry invalidates the whole claims string —
        // partial acceptance would be exactly the silent gap this exists to
        // close.
        let err = validate_claims("pushed:PR#640,garbage,ran:tests").unwrap_err();
        assert!(err.contains("garbage"), "error should name the offender: {err}");
    }

    // C-SWARM-RECON-AUTHORITY — the network-free MUST-FAIL directions. The
    // merged->verified MUST-PASS needs a live `gh pr view` and is driven
    // independently by verifier once #686 is green; here we prove the
    // could-not-check directions that need no network.

    fn recon_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE contract(id TEXT PRIMARY KEY, github_pr INTEGER, github_repo TEXT);
             CREATE TABLE msg(id TEXT, ts REAL, contract TEXT, kind TEXT, body TEXT, pr INTEGER);",
        )
        .unwrap();
        conn
    }

    #[test]
    fn resolve_pr_refuses_github_pr_with_unknown_repo() {
        // MUST-FAIL 2: a bare `github_pr` with no `github_repo` is REFUSED, never
        // resolved against the hardcoded GITHUB_REPO — that default IS the
        // agent-swarm#1-vs-aihu-project/aihu#1 collision.
        let conn = recon_conn();
        conn.execute(
            "INSERT INTO contract(id, github_pr, github_repo) VALUES ('C-X', 1, NULL)",
            [],
        )
        .unwrap();
        let r = resolve_pr(&conn, "C-X", Some(1));
        assert!(r.is_err(), "github_pr with NULL github_repo must refuse, got {r:?}");
        assert!(
            r.unwrap_err().contains("github_repo"),
            "the refusal must name the missing repo"
        );
    }

    #[test]
    fn resolve_pr_uses_the_links_own_repo_when_present() {
        // The dual of the above: an explicit cross-repo link resolves in ITS
        // repo, so `gh pr view` runs against agent-swarm, not aihu-project/aihu.
        let conn = recon_conn();
        conn.execute(
            "INSERT INTO contract VALUES ('C-X', 1, 'srmcguirt/agent-swarm')",
            [],
        )
        .unwrap();
        let (repo, pr) = resolve_pr(&conn, "C-X", Some(1)).unwrap().unwrap();
        assert_eq!(repo, "srmcguirt/agent-swarm");
        assert_eq!(pr, 1);
    }

    #[test]
    fn adjudicate_merged_is_could_not_check_with_no_pr_before_any_network() {
        // MUST-FAIL 1 (network-free half): the exact corrupt input that falsely
        // verified C-SWARM-P0 — a `verified` proposal with a transcript-fragment
        // recon and github_pr NULL — has NO PR reference, so adjudication returns
        // could-not-check (Err) BEFORE any `gh` call. The caller records
        // `unverified`, never `verified`.
        let conn = recon_conn();
        conn.execute(
            "INSERT INTO contract(id, github_pr, github_repo) VALUES ('C-P0', NULL, NULL)",
            [],
        )
        .unwrap();
        let r = adjudicate_merged(&conn, "C-P0", None);
        assert!(r.is_err(), "no PR reference must be could-not-check, got {r:?}");
        assert_eq!(r.unwrap_err(), "no PR reference");
    }
}
