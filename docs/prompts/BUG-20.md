# BUG-20 — Dashboard fetches today's Square sales twice — TIER 3

TIER 3: Square sync path, row writes, possibly a migration. Plan-first with
hard stops. Two-commit pattern (work, then docs citing the work SHA).
`npm run build` gates commits. Never commit on `main`. Never push. Claude
never connects to staging or production databases. Froot never writes to
Square.

Saved as `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/BUG-20.md`.

## Why

Filed by the STAMP-745a1ee-SYNCSTATE audit (`docs/prompts/SYNCSTATE_AUDIT.md`)
and the BUG-20 row in `docs/ROADMAP.yaml`: `/api/dashboard/summary` and
`/api/dashboard/sales` load in parallel and **each** call `syncSalesForStore`
for the same store and day — inline on the day's first load (both hold up
their responses) and in the background when the cache is stale. Square's
orders search runs twice; the BUG-7 guard keeps data correct by discarding the
older fetch (`[sales-sync] … discarded 1 superseded by a newer fetch`).

After REGION-1 (functions in pdx1 next to Neon), warm dashboard loads are fast
(staging: summary 77 ms, sales 55 ms) but **first loads per store stay
~0.6–1.4 s**. This duplicate is the likeliest share of that.

**Standing rule:** nothing is promoted to production until Gary confirms it
on staging.

## Phase 0 — repo gate (one command at a time)

`pwd` ends in `Froot/froot` (capital-F: STOP and tell Gary). `git status`: on
`staging`, clean apart from untracked prompts. HEAD `9933ad5`.
`git log --oneline -3`. Only this session writes to the repo.

## Phase 1 — audit (read-only), then STOP

Write `docs/prompts/BUG-20_AUDIT.md`.

A. **Every caller of `syncSalesForStore`** (dashboard summary, dashboard sales,
   Square webhook, `cron/sales-reconcile`, any others) — what each needs:
   must it have today's sales **before responding**, or can it serve cache?
B. **The BUG-7 guard** — how it works today, exactly, and what any new claim
   must not break (webhook and reconcile correctness come first).
C. **Measure the duplicate:** from the code, confirm both dashboard routes
   sync on a first load; estimate how much of a first load is the Square
   orders search vs database work (cite log lines Gary has pasted:
   staging 2026-11-03 20:32–20:33 PST).
D. **The hard part — the losing request on a first load.** If one request
   claims the sync, the other must **not** show zero/empty sales for today.
   Options, with trade-offs:
   - (a) **one owner:** only one dashboard route syncs; the other reads the
     cache (and waits briefly / is ordered after it) — no new state;
   - (b) **claim + short wait:** whichever claims first syncs; the loser polls
     the cache for up to N ms, then falls back to syncing itself;
   - (c) **client-side:** the dashboard page requests the sales data once and
     both panels use it.
   Recommend one; say if it needs a column (e.g. a "sync started at" on the
   daily cache, since `syncedAt` records when Square was read, not when a
   sync began) — then a migration STOP applies.
E. **Background refresh:** the same duplicate when the cache is stale — does
   the chosen fix cover it?

**Forks — chat's leans; Gary rules at the STOP:**

- **BUG20-F1:** lean — whichever of (a)/(b)/(c) the audit shows is simplest
  **and** never shows empty sales on a first load; prefer no new state.
- **BUG20-F2:** webhook and reconcile paths unchanged unless the audit shows
  they share the same duplicate.
- **BUG20-F3:** no change to what is fetched, stored, or shown; cooldowns
  unchanged.

**STOP** with the audit, the recommendation, timings, anything RULING NOW. No
code before Gary's go.

## Phase 2 — schema (only if ruled), then STOP

Migration per `docs/MIGRATIONS.md`; baseline `migrate diff` against dev first.
STOP after the migration file exists; Gary applies it to dev and says go.

## Phase 3 — build (after Gary's go)

- Implement as ruled.
- **Fixture** `scripts/verify-bug20.ts` (Square stubbed and counted — never
  real Square): two concurrent first-load dashboard calls for the same store
  and day cause **one** Square orders search, and **both** responses carry
  today's sales (never empty); a stale-cache background refresh runs once;
  webhook/reconcile behaviour and the BUG-7 "newer fetch wins" guard are
  unchanged; different stores don't block each other. Prove the fixture can
  fail by running it against the old code.
- Re-run every `scripts/verify-*.ts`; report each file's own summary line.
  All must be green.
- `npm run build` before each commit; stage only touched files.

## Part 2 — promotion stamp for `9933ad5` (docs commit)

Gary promoted BUG-19 on 2026-11-03 (evening, Pacific): merge `9933ad5`
(`--no-ff`), main `745a1ee..9933ad5`, staging fast-forwarded. Carried
`4ac82d0` (fix), `b459ffb` (docs), `ef05e0e` (check) — read counts from git.
No migration.

Staging evidence (Vercel runtime logs, Preview, 2026-11-03 ~20:32–20:33 PST):
no "Unique constraint failed" lines across two stores; one `[labor-actuals]`
and one `[labor-schedule]` per store per load; warm dashboard summary 77 ms,
sales 55 ms. Production evidence: **owed** — ask Gary at the PRE-PUSH-CHECK
whether production logs are clean; if not captured, record it as owed.

Follow `docs/WORKFLOW.md` § 2 and `docs/prompts/STAMP-745a1ee-SYNCSTATE.md`:
DEPLOY_LOG — stamp the UNPROMOTED BUG-19 entry as promoted in `9933ad5`;
ROADMAP — BUG-19 → `shipped` with `9933ad5` and a dated rider. Preserve-and-
mark; nothing deleted.

## Docs commit

ROADMAP: BUG-20 `in_progress` with the work SHA. DECISIONS: Gary's BUG-20
rulings in his words, DRAFT. MIGRATIONS entry if any. Commit this prompt and
the audit.

## Report and stop

Work SHA, docs SHA, migration name (if any), files touched, every fixture's
own summary line, and a staging test plan: open the dashboard for a store
whose sales weren't fetched yet today (or after the cache window), check
Vercel logs show **one** `[sales-sync]` per store per load and **no**
"superseded" discard, today's sales appear in both panels, and compare the
first-load `[api/dashboard/summary]` / `[api/dashboard/sales]` times with
before (0.6–1.4 s). Do not push.
