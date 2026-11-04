# STAMP-745a1ee-SYNCSTATE — REGION-1 promotion stamp + dashboard sync-state race — TIER 2

TIER 2: a concurrency fix in the dashboard's Square labor/schedule refresh,
plus a docs-only promotion stamp. Plan-first with one STOP (no code before
Gary's go). Work commit, then docs commit citing it. `npm run build` gates
commits. Never commit on `main`. Never push. If the audit finds the fix needs
a schema change, it becomes TIER 3: say so at the STOP.

Saved as `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/STAMP-745a1ee-SYNCSTATE.md`.

## Repo gate (one command at a time)

`pwd` ends in `Froot/froot` (capital-F: STOP and tell Gary). `git status`: on
`staging`, clean apart from untracked prompts. HEAD `745a1ee`.
`git log --oneline -3`. Only this session writes to the repo.

## Part 1 — the bug

Vercel runtime logs (staging and production, 2026-11-03, before and after
REGION-1) show, on nearly every dashboard load, pairs of:

    /api/dashboard/summary  prisma:error Invalid `prisma.squareLaborSyncState.create()` …
                            Unique constraint failed on the fields: (`"storeId"`)
    /api/dashboard/summary  … `prisma.squareScheduleSyncState.create()` … (`"storeId"`)
    /api/dashboard/sales    (the same two)

`/api/dashboard/summary` and `/api/dashboard/sales` load in parallel, and both
appear to start the same per-store Square **labor actuals** and **labor
schedule** refresh (`[labor-actuals] …`, `[labor-schedule] …` log lines in the
same second). Each tries to `create()` the store's sync-state row; the loser
throws on the unique `storeId`. The dashboard still renders and the data is
written, so this is noise plus — likely — **a duplicated Square fetch** on
every first load, which is now the slow part of the dashboard (Square calls,
not the database, after REGION-1).

### Phase 1 — audit (read-only), then STOP

Write `docs/prompts/SYNCSTATE_AUDIT.md`.

A. Find every caller of `squareLaborSyncState.create` / `squareScheduleSyncState.create`
   (and any `findUnique`-then-`create` pattern around them), and every route
   that triggers the labor/schedule refresh (dashboard summary, sales, labor
   budget/coverage, crons). Confirm the race from the code.
B. Is the error **caught** today, and what happens after it (does the losing
   request still fetch Square? does it retry? does anything fail for the
   user)? Is the refresh actually run twice per dashboard load?
C. How the app already guards similar races (BUG-7's race-guarded sales write,
   `[sales-sync] … discarded 1 superseded by a newer fetch`) — reuse that
   pattern, don't invent a new one.
D. **Plan.** Lean:
   - row creation becomes race-safe (`upsert`, or create-if-missing that
     treats the unique conflict as "already exists"), so the error is gone;
   - **single-flight per store:** one request claims the refresh atomically
     (e.g. a conditional update on the state row — "start only if no refresh
     started in the last N seconds"); others serve what's cached and don't
     call Square again;
   - no change to what is fetched or written, how often data refreshes for a
     single user, or what the dashboard shows.
   Say whether this needs a new column (then TIER 3 + migration STOP).

**STOP** with the audit, the plan, and any RULING NOW (e.g. the N seconds).
No code before Gary's go.

### Phase 2 — build (after Gary's go)

- Implement as ruled.
- **Fixture** `scripts/verify-syncstate.ts`: two concurrent first-load calls
  for the same store produce **one** state row, **no** error, and **one**
  Square refresh (Square calls stubbed/counted — never hit real Square); a
  later call after the window refreshes again; different stores don't block
  each other.
- Re-run every fixture in `scripts/verify-*.ts`; report each file's own
  summary line. All must be green.
- `npm run build` before each commit; stage only touched files.

## Part 2 — promotion stamp for `745a1ee` (docs commit)

Gary promoted on 2026-11-03 (evening, Pacific): merge `745a1ee` (`--no-ff`),
main `3ea8112..745a1ee`, staging fast-forwarded. Carried the
STAMP-3ea8112-FIXTURES commits (`d4e6df2`, `59d5596`, `85a5b42`) and REGION-1
(`3592ee0`, `ab4acd4`, `82fe451`) — read the counts from git. No migration.

Evidence (Vercel runtime logs; the `[sales-items/sync]` writeMs is the
database-write time of a sync where all rows were unchanged):
- **Before (iad1):** staging unchanged re-run writeMs 2,544 (REGION-1 audit).
  Production dashboard routes ~0.6–1.5 s (summary 1.1–1.5 s, sales 0.8–1.2 s,
  labor budget 0.75–1.3 s, coverage 0.95–1.3 s, comms 0.6–0.9 s), same day.
- **After, staging (pdx1):** two unchanged syncs, writeMs **1,159** then
  **604**; warm dashboard loads summary 109 ms, sales 196 ms, labor budget
  102 ms, coverage 222–260 ms, comms 108 ms. First loads per store stayed
  ~1 s (they include Square fetches).
- **After, production:** unchanged sync writeMs **898**; first-load dashboard
  routes 0.8–1.3 s (Square fetches; warm production loads not yet captured).
- The production deployment's function region was **not** visually confirmed
  in the Vercel UI; pdx1 is inferred from the writeMs drop. Record it that way.
- eng1 (engagement route patterns) is now live with this promotion.

Follow `docs/WORKFLOW.md` § 2 and `docs/prompts/STAMP-3ea8112-FIXTURES.md`:
DEPLOY_LOG — stamp both UNPROMOTED entries (STAMP-3ea8112-FIXTURES and
REGION-1) as promoted in `745a1ee`, heading count unchanged; ROADMAP —
REGION-1 row → `shipped` with `745a1ee` and a dated rider; the five fixture
riders get "promoted in 745a1ee". Preserve-and-mark; nothing deleted.

## Docs commit

Also: a ROADMAP row (or BUG row — read the conventions) for the sync-state
race with the work SHA; DECISIONS — Gary's rulings in his words, DRAFT, if
any; commit this prompt and the audit.

## Report and stop

Work SHA, docs SHA, files touched, every fixture's own summary line, the
stamp diff summary, and a test plan: open the dashboard on staging for two
stores, check Vercel logs show **no** "Unique constraint failed" lines and
only **one** `[labor-actuals]` / `[labor-schedule]` line per store per load;
first-load times compared with before. Do not push.
