# N-5-SYNC — Square catalog sync times out at 60 s — TIER 2

TIER 2: performance fix to one route and its sync helpers; no schema, no
permission or behaviour change. Work commit, then docs commit citing it.
`npm run build` gates commits. Never push. Froot never writes to Square.

Saved as `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/N-5-SYNC.md`.

## Why

After N-5 reached staging (`e32e22c`), Gary clicked **Sales Items → Sync from
Square** on staging. The UI showed "Sync failed — check your connection".
Vercel runtime log (Preview), 2026-11-03 12:10:45:

    /api/square/sales-items/sync
    Vercel Runtime Timeout Error: Task timed out after 60 seconds

So Square answered; the function ran out of time. N-5 set
`maxDuration = 60` on this route (N-5 DECISIONS, implementation choices) and
added modifier writes after the **unchanged, row-at-a-time** item/variation
writes. Staging's last sync was ~4 months ago, so nearly every row updates.
Production has ~1,179 sales items plus modifiers — it would very likely fail
the same way. **N-5 must not be promoted until this is fixed.**

A timed-out run leaves `lastCatalogSyncAt` unstamped; partial writes are
upserts, so the next successful run catches up. Confirm this in the audit.

## Phase 0 — repo gate (one command at a time)

`pwd` ends in `Froot/froot` (capital-F: STOP and tell Gary). `git status`: on
`staging`, clean apart from untracked prompts. HEAD `e32e22c` or later.
`git log --oneline -3`.

## Phase 1 — measure and plan (read-only), then STOP

1. Read `src/app/api/square/sales-items/sync/route.ts` and
   `src/lib/square-modifier-sync.ts`: count the database round trips per item,
   per variation and per modifier; note what was the route's effective time
   limit **before** N-5 (no `maxDuration` → the project default) and what the
   Vercel plan allows (read the repo's Vercel config/docs; don't guess).
2. Estimate time for production size (~1,179 variations + modifiers) from the
   round-trip count.
3. Propose the fix. Lean, in order:
   - **Batch the item/variation writes** (bulk upsert in chunks, e.g. one
     `createMany` for new rows + chunked updates, or a single
     `INSERT … ON CONFLICT` per chunk) the same way N-5 batched modifiers, so
     the write is a handful of round trips instead of thousands;
   - **skip rows that haven't changed** (compare the fields the sync writes
     before updating), so a routine sync writes almost nothing;
   - set `maxDuration` to a value the plan allows with real headroom (e.g.
     300) as a safety net, not as the fix;
   - keep behaviour identical: same fields, same deleted-item handling, same
     modifier rules from N-5, `lastCatalogSyncAt` stamped only on full success.
4. Anything that would change what the sync writes is RULING NOW.

**STOP** with the measurements and the plan. No code before Gary's go.

## Phase 2 — build (after Gary's go)

- Implement as ruled.
- **Fixture** `scripts/verify-n5-sync.ts` (pure where possible): a canned
  catalog of ~1,200 variations + modifiers produces exactly the same rows as
  the old code path (new, changed, unchanged, deleted); unchanged rows cause
  no writes; the modifier results match N-5's fixture expectations. Re-run
  `verify-n5-modifiers.ts` and every earlier fixture.
- `npm run build` before each commit; stage only touched files.

## Commits

Work commit, then docs commit: dated rider on the N-5 row ("sync batched;
timeout fixed — from Gary's staging test 2026-11-03, Vercel log 'Task timed
out after 60 seconds'"), DEPLOY_LOG note under the UNPROMOTED N-5 entry, this
prompt. No DECISIONS entry unless something was ruled.

## Report and stop

Work SHA, docs SHA, files touched, the round-trip counts before and after, the
new `maxDuration`, fixture results. Staging test plan: Sync from Square on
staging completes, with the duration from the Vercel log; Recipes → Modifiers
lists add-ons; a second sync right after is fast. Do not push.
