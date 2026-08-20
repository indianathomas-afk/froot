# Schedule/Actual Overlay — S2 Ingest Build · Session Prompt

**Module:** Advanced Labor / schedule overlay track (labor-schedule)
**TIER:** 3 — full ceremony: AUDIT → PLAN → GARY'S APPROVAL → BUILD.
Do not touch a file before the plan is approved in this session.
**Builds on:** S1 seam audit + S1b probe (462 observed payloads, measured
fetch protocol), rulings of 2026-08-20.
**Session type:** One session, one phase: ingest + tables + fixtures.
NO UI — the card/toggle is S3, the /labor comparison is S4.

---

## 0 · Preconditions (verify, quote, STOP if any fails)

1. docs/DECISIONS.md contains, all dated 2026-08-20:
   "Schedule/actual overlay, scope rulings" · "Schedule overlay, S1b
   rulings" · "Staging probe exception, schedule payload discovery".
2. Branch staging, clean tree, in sync with origin/staging.
3. npm run build green BEFORE any edit (baseline).

## 1 · Binding rulings (the design is decided; build to it)

- READ-ONLY toward Square; org-token-only via the house client pattern;
  shared SQUARE_VERSION constant. No _WRITE anything, ever.
- FETCH PROTOCOL IS LAW (S1b-measured): one location_id per request;
  windows sized to never paginate — weekly default, narrow if a response
  ever carries a cursor; NEVER follow the cursor as a completeness
  strategy; limit ≤ 50. A returned cursor means the window was too big.
- Effective shift = published ?? draft (denormalized effective columns).
- Deleted = is_deleted tombstone; sync the flag, filter on read.
- notes columns are synced but NEVER selected into any payload destined
  for the overlay/STORE surfaces — enforced by not fetching.
- SquareJobColor keyed (organizationId, squareJobId); deterministic
  default; settings-editable comes in S3 — this session only creates the
  table + the pure default-color function.
- Seam (b): nothing in labor-plan.ts / labor-coverage.ts / any core
  engine imports the new module. labor-schedule.ts lands on the
  labor-actuals side of the import wall.
- Seam (c): schedule sync gets its OWN SquareScheduleSyncState table
  (own storeId @unique). "No schedules" (200 {}) is distinguishable from
  "never synced" ONLY via this table — that is its purpose.
- Additive-only schema changes. No columns dropped, nothing destructive.

## 2 · AUDIT (read-only; quote file:line; then STOP and present the plan)

1. Re-verify the S1 seam map still holds at current HEAD: the timecard
   sync anatomy (claim/cooldown, state writers, guarded upsert, trigger
   sites), the import wall, and paidMinutesOf's unexported status.
2. Confirm the S1b table proposal (in the S1b report / DECISIONS
   rulings) against prisma/schema.prisma conventions at HEAD — naming,
   relation style, index style, Decimal/DateTime conventions.
3. Check migration surface: additive tables only; confirm no collision
   with existing names; note the migration filename plan.
4. Present THE PLAN: files to create/edit, the exact schema DDL, the
   sync module's function signatures, fixture list, and anything that
   deviates from this prompt (deviations need explicit flagging).
   THEN STOP AND WAIT FOR GARY'S EXPLICIT APPROVAL.

## 3 · BUILD (only after approval)

1. **Schema:** SquareScheduledShift per the S1b-observed design
   (draft/published/effective columns, tombstone flag, notes columns,
   org-scoped @@unique, [storeId, effectiveStartAt] index) +
   SquareScheduleSyncState (clone of SquareLaborSyncState, own table) +
   SquareJobColor. Migration additive-only. Schema doc-comments carry
   the OBSERVED provenance (n=462, 2026-08-20) as the S1b proposal wrote
   them.
2. **src/lib/labor-schedule.ts** (labor-actuals side of the wall):
   - syncScheduledShiftsForStore(org, store, startDate, endDate):
     per-location, per-week windows, cursor-returned → split window and
     re-query (never follow), limit 50, status carried in thrown errors
     (SQUARE_SCHEDULE_${status} convention), guarded upsert
     ON CONFLICT ... WHERE squareVersion <= EXCLUDED.squareVersion,
     dedup + id-sort before batch, effective-column computation at write
     time, store resolved from Square's location_id.
   - Window default: [-3 days, +28 days] (card horizon), weekly chunks.
   - State writers cloned: recordSyncStarted/Ok/Error semantics
     preserved exactly (Error never clears lastSyncOkAt).
   - Request construction EXACT — S1b proved unknown filter fields
     return 200 with wrong data. Build the filter object from typed
     constants, no spread of caller input.
   - Pure helper: deterministicJobColor(squareJobId) — stable hash into
     the badge-preset key set; zero imports; unit-testable.
4. **Trigger:** clone claimSync + scheduleLaborRefresh into the schedule
   variant (own cooldown constant, own MAX_SYNCS_PER_LOAD, own deferral
   logging) wired to the same dashboard trigger sites the timecard sync
   uses. Cron route mirroring cron/labor-timecards may be created but
   stays OUT of vercel.json (CRON precedent; activation is its own
   ruling).
5. **Fixtures** (verify-labor-schedule.ts, pure, injected clock):
   - effective = published ?? draft (incl. the differs case)
   - unassigned shift (null team member) still counts toward coverage
   - tombstoned shift excluded on read
   - cursor-in-response → window split behavior (mock, no network)
   - upsert idempotency: replay same shift lower/equal/higher version
   - deterministicJobColor stability
   - notes never present in the overlay-facing read function's output
     shape (type-level or runtime assertion)
6. **Read function for S3:** getScheduledCoverage(storeId, dateStr) →
   hour-bucketed counts by jobId (store-local buckets via the existing
   localParts convention), effective shifts only, tombstones filtered,
   notes not selected. Pure calculation over synced rows; no Square
   call in the read path.

## 4 · Definition of done

- Plan approved by Gary in-session before any edit.
- Build green; ALL verify scripts green (existing + new).
- Migration additive-only, applied to dev DB only (npx prisma migrate
  dev); staging/production migration rides the normal deploy path.
- Import wall intact: grep proves no core engine imports labor-schedule.
- Two commits (work, then docs: ROADMAP row for the S2 build, status
  per board vocabulary). NOT pushed.
- Out-of-scope findings triaged FIX NOW / RULING NOW / COMMENT / ROW.

## 5 · Out of scope

- Any UI (card toggle, colors rendering, settings editor) — S3.
- /labor comparison — S4.
- Cron registration in vercel.json.
- Any change to timecard sync, coverage engine, budget path.
- squareLaborEnabled gating decisions — S3 ruling territory.
