# CHK-3 (S3) — LIFECYCLE ENGINE: EXPECTED WINDOWS, OVERDUE ON READ, MISSED WRITTEN AT DAY CLOSE

**Repo:** `~/Claude_Projects/Froot/froot` — branch: `staging`

## WHAT THIS SESSION IS

S3 of the approved CHK phase — the engine session. The plan is **already
approved in full** (Gary's ruling 2026-08-09, `docs/prompts/CHK-1_PLAN.md`
§0-RULING). This session **executes S3 per the approved plan**; it does
not redesign it. Read the plan artifact and
`docs/prompts/CHK-1_SESSION_SKELETONS.md` (S3 block) in full before
touching anything. The CHK-3 row in `docs/ROADMAP.yaml` carries the
ships / proves / must-not-touch summary, its blocker (CHK-2 — now
shipped and verified: StoreHours has a writer), and the S1 integrity
finding parked here.

Ruled parameters that bind this session (do not reopen):
- **Overdue is evaluated on read** — no write, no scheduler; correct the
  instant an offset changes.
- **Missed and completed-late are written**, by an hourly cron
  (`0 * * * *`, `CRON_SECRET`, two-day lookback, pace-alerts as the
  shape). The write is day close, and only day close.
- **Day close = store close + `DAY_CLOSE_GRACE_HOURS = 3`** (a constant,
  not per-org). Store with no hours → store-local midnight + buffer.
  The two visible fallback signals (a note on `/stores`, a column on the
  report) are CHK-5/S4 surface work — the *engine* must expose the
  fallback state queryably.
- **A checklist nobody started has no row** (plan finding 1): day close
  **materializes** the miss — creates the row with status Missed — for
  Daily templates only.
- **Weekly/Monthly are NOT materialized** (plan §12.8; DEBT-61 is the
  fix, not this session). The exclusion is engine-level and stated.
- **Non-Compliant at day close → Missed** (plan §12.7).
- **No both-or-neither offset rule**: `startOffsetHours` governs
  upcoming, `endOffsetHours` governs overdue, independently. Blank end →
  can never be overdue, only completed or missed at day close.
- **Window end past day close → clamped** (the form-warning half is S4).
- **Blank offsets = no expected window** — such checklists cannot go
  overdue (R3); they still close to completed/missed at day close.
- **NO UI.** The CHK-3 row's must-not-touch is explicit: any rendering
  change means the split failed. Proof surfaces are SQL and the cron's
  response body.

## STEP 0 — LOCATION AND ANCHOR

```
cd ~/Claude_Projects/Froot/froot
pwd                        # must end .../Froot/froot
git branch --show-current  # staging
git status --short         # clean
git fetch origin           # then confirm level with origin/staging
git rev-parse HEAD         # expected: the S2-close docs commit or a descendant
```

STOP on any failure. Never push.

## STEP 1 — RE-VERIFY AT HEAD, AND THE PERISHABLE PRECHECK

Re-measure, do not cite:

- **The duplicate-checklist precheck is perishable and must be re-run
  before Migration B applies** (the plan's own standing instruction:
  the table grows daily by the exact path that can create the
  duplicate). Present the precheck query for Gary to run per live
  branch (dev, preview/staging, production — never the fossil). Zero
  everywhere → the unique index ships in Migration B. Non-zero →
  **drop the index from the migration, do not delay the migration**,
  and report the rows.
- Checklist creation paths (`api/checklists/route.ts` :130/:166 at S1
  time) — the `findFirst`-then-`create` race the index closes; confirm
  shape at HEAD.
- `submit/route.ts` completion counting and the task-log route's
  missing template check — **the S1 integrity finding parked on this
  row**; confirm at HEAD before fixing.
- `Store.timezone` presence and the Square-resync-overwrites-it note
  (S2 COMMENT 4) — day close depends on it; the engine must tolerate a
  timezone change after the fact (that is what `expectedStartAt`/
  `expectedEndAt` are for — verify the plan's reasoning holds against
  the schema as it exists).
- StoreHours read shape as S2 built it (no-row = unset; one-sided day
  unusable) — the engine's hours reader must treat one-sided and
  overnight windows explicitly. **S2 ROW (b) is acknowledged here**:
  labor silently falls back to inference for overnight hours while day
  close handles overnight explicitly — the engine does not fix labor
  (must-not-touch), but its hours interpretation must be documented at
  the single definition site so the two subsystems' disagreement is
  recorded, not discovered.
- `checklists/page.tsx:117` unmapped-status fallthrough (S1 COMMENT) —
  confirm it is still unreachable; **Missed must NOT ship unmapped**,
  but the mapping is S4's; this session proves the engine never leaks
  a status the UI cannot name into any *currently rendered* path
  (materialized Missed rows are expected to be invisible-but-safe
  until S4 — state exactly how each existing surface treats them).

If any assumption no longer holds, that is a finding: STOP and report
before editing. If all hold, proceed — the plan is the approval.

## STEP 2 — EXECUTE PER THE PLAN'S S3 SECTION

1. **Migration B** — exactly as approved (plan §2.2): `closedAt`,
   `completedLate`, `expectedStartAt`, `expectedEndAt`, the two
   indexes, **no backfill** (pre-existing rows keep NULLs — the
   lifecycle starts at deploy, and the report says so on its face).
   Plus, per rulings since the plan: the
   `Checklist_storeId_templateId_date_key` unique index (conditional
   on the precheck), and **`StoreHours` `@@unique([storeId,
   dayOfWeek])`** (S2 ROW (a), destined here — additive, enables
   upsert, and the S2 writer's replace-in-transaction remains
   correct with it). Hand-authored migration file, committed, **never
   run by you** — Gary runs dev-first; staging/production via
   `migrate deploy`. Verify structural SQL against
   `prisma migrate diff` as S1 did.
2. **`src/lib/checklist-lifecycle.ts`** — React- and Prisma-free.
   The five single-definition predicates (`isUpcoming` / `isActive` /
   `isOverdue` / `isMissed` / `isCompletedLate`), `expectedWindow()`
   (reads `operationalPhase` via `OPERATIONAL_PHASES` — the folded
   single list from S2; a fourth hand-copied list here would undo
   DEBT-32), `zonedInstant()` on Intl (no new deps), day-close
   computation (hours + grace, midnight fallback, overnight handled
   explicitly and documented). Every edge case the plan names:
   after-midnight closes, `isClosed` weekdays, DST both directions,
   clamping, timezone-changed-after-the-fact.
3. **The cron** — `GET /api/cron/checklist-day-close`, hourly,
   `CRON_SECRET`, two-day lookback, idempotent (a re-run changes
   nothing; a skipped hour self-heals). For each store past day close:
   existing open checklists → Completed-late accounting or Missed
   (Non-Compliant → Missed); unstarted Daily templates → materialized
   Missed rows (org/store/template/date, snapshot semantics per S1's
   as-executed rules — a materialized row has no task logs and no
   snapshot; state what it carries). Response body reports counts per
   store — that body is a proof surface. Cron outage beyond lookback:
   left open and logged, never swept silently. Register the schedule
   wherever pace-alerts' is registered (`vercel.json` or equivalent —
   match the house shape).
4. **The S1 integrity fix** (parked here by ruling): task-log route
   verifies `taskId` belongs to the checklist's template; `submit`
   counts distinct valid task logs against the template's tasks, and
   its rewrite for `completedLate` lands in the same pass. 409 on
   logging against a closed checklist (`closedAt` set) — the plan's
   "409 on closed" line.
5. **Weekly exclusion** stated in code at the materialization site,
   citing DEBT-61 — a comment with a pointer, not a re-derivation.

**MUST NOT TOUCH**: any rendering (no component, page, or copy
changes — S4 owns every pixel); labor-plan.ts; offsets fields or copy;
template-form.tsx; handoff notes; permissions.ts.

## STEP 3 — COMMITS AND GATES

Two-commit pattern:
- **Commit 1 — code + migration file.** Gate: scoped eslint (no pipes)
  + `npm run build`.
- **Commit 2 — docs.** CHK-3 row → `in_progress`, commit 1's short SHA
  quoted; the S1-integrity and S2-ROW items marked resolved-here with
  the SHA; DEBT-61's containment note updated if its text claims
  otherwise. Gate: `npm run build`.

Committed, **NOT pushed**.

## STEP 4 — REPORT (Gary's run order explicit)

1. SHAs; Step 1 drift table; **the precheck query first** — Gary runs
   it per live branch before anything else, results decide the unique
   index.
2. Migration B verbatim with run instructions (dev-first, the three
   commands, the `Froot/froot` trap note), then the per-branch
   verification query for the new columns/indexes (branch named,
   expected shape stated).
3. **Engine proof, no UI**: the SQL and cron-response evidence Gary
   collects on staging after push — e.g. trigger the cron manually
   (state how, with the secret handling — never print the secret),
   then the queries showing: an overdue-eligible checklist correctly
   NOT written (overdue is read-only), a stale open checklist closed
   Missed, an unstarted Daily materialized as Missed, a Weekly NOT
   materialized, idempotency (second run, zero changes), and
   pre-deploy rows untouched (NULLs intact). Each query with the
   branch-anchor columns.
4. **What Gary should NOT see**: no visible change anywhere in the
   app. State where materialized Missed rows technically appear (the
   admin /checklists list?) and confirm the fallthrough behaviour is
   safe-if-ugly, with S4 owning the styling.
5. Triage: FIX NOW / RULING NOW / COMMENT / ROW. **RULING NOW stops
   the session.** Report counts.

## HOUSE RULES

Everything in `CLAUDE.md`; never push; additive-only schema;
`npm run lint` is not a gate (DEBT-33); short SHAs quoted in YAML;
exclude `src/generated/` from greps and verify hits by reading; do not
touch `../froot_docs/`; audit-artifact rule applies if this session
ends audit-only; `preview/main` is a fossil — never query it; secrets
are never printed in reports or transcripts.
