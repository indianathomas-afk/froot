# TIER 2 — LABOR-0B: Complete the LABOR-0 survey + pin scope strings + version delta

**Session type: READ-ONLY SURVEY. Zero code changes. Zero schema changes. Zero
deploys.** This session produces exactly one artifact document and two commits.
Nothing else.

---

## Context (self-contained — do not rely on chat history)

Repo: `~/Claude_Projects/Froot/froot` (lowercase `froot` is the git root — the
capital-F parent directory is a known trap; `cd` into the lowercase one and
verify with `git rev-parse --show-toplevel` before anything else).

`docs/prompts/LABOR-0_shift_surface_grep.md` is an audit prompt filed in commit
`2e75029` that has NEVER fully run. A 2026-08-05 partial covered its Tasks 2–4
only. **Tasks 1c and 5 are still owed.** The L-2 row in `docs/ROADMAP.yaml`
lists this as a blocker: RUN IT BEFORE ANY BUILD.

This session completes those two tasks and adds two research riders ruled in
scope by Gary (2026-08-18, planning chat): pinning the exact Square OAuth
scope-name strings for the upcoming consent batch, and producing the changelog
delta for the planned `SQUARE_VERSION` bump. All four are read-only surveys on
the same track producing one combined artifact.

**Standing rulings that bind this session** (recorded or pending in
`docs/DECISIONS.md` — read the top entries first):
- Square labor integration is strictly optional; core labor stays
  forecast-driven (2026-08-05).
- Froot never writes to Square — app-wide, read-only by design, OAuth
  machinery excepted (2026-08-18, pending Gary's own wording — treat as
  binding).
- The L-2 build remains DEFERRED. This session is survey work, not the build.

## Hard rules

1. Do NOT modify `src/app/api/square/auth/route.ts`.
2. Do NOT modify `src/lib/square.ts`.
3. Do NOT add, remove, or rename any OAuth scope anywhere.
4. Do NOT change `SQUARE_VERSION` anywhere.
5. Do NOT edit `docs/prompts/LABOR-0_shift_surface_grep.md` — it is executed-
   prompt territory; addenda only, and this session's results file IS the
   addendum.
6. No `&&` command chains. One command per paste, read results before
   proceeding.
7. Do NOT query any database. Nothing here needs one.
8. If any task below cannot proceed (missing file, no web access, ambiguous
   original task text), STOP that task, record the stop reason in the results
   file, and continue with the remaining tasks. Do not improvise a
   substitute interpretation.

## Task 0 — Read the original prompt first

Open `docs/prompts/LABOR-0_shift_surface_grep.md` and read it in full. Its text
is AUTHORITATIVE for what Tasks 1c and 5 mean. If the file's definition of
either task conflicts with the one-line summaries below, the file wins and the
conflict gets recorded in the results.

## Task 1 — LABOR-0 Task 1c (construction-site count)

Execute Task 1c exactly as the original prompt defines it. Expected shape (from
the 2026-08-05 partial's framing): a count and listing of the sites in `src/`
(excluding `src/generated`) where the word "shift" is already spent or where
labor-surface code would be touched by the L-2 build. Record every file:line
with a one-line note on what lives there.

## Task 2 — LABOR-0 Task 5 (webhook inventory)

Execute Task 5 exactly as the original prompt defines it. At minimum the code
side must record:
- Every webhook event type the handler at `src/app/api/webhooks/square/`
  actually processes, with file:line references.
- Every place the subscription's event list or API version is referenced in
  code or docs.
- What the handler does on an event type it does not recognize.

NOTE: the Square Developer Dashboard half of the inventory (the subscription's
configured event types and its pinned API version as displayed in the
dashboard) requires Gary's login. Record it as **OWED — GARY** in the results
with the exact dashboard path for him to read from, and leave a labeled blank
for him to fill. Do not guess the dashboard values. Known prior claims, to be
CONFIRMED not assumed: subscription version `2024-01-18`, four event types,
endpoint `https://www.usefroot.com/api/webhooks/square`.

## Task 3 — Pin the exact OAuth scope strings (web research)

Fetch Square's current OAuth permissions reference (start at
`https://developer.squareup.com/docs/oauth-api/square-permissions` and follow
to the current equivalent if moved). Produce a table with EXACT scope-name
strings — copied, not paraphrased — for each need below:

| Need | Exact scope string | What it unlocks (endpoints) | Covered by an already-held scope? |
|---|---|---|---|
| Timecard reads (hours, breaks, declared cash tips) | | | |
| Break types + workweek config reads | | | |
| Scheduled-shift READS (never writes) | | | |
| Team wage / job / pay-rate reads | | | verify vs `EMPLOYEES_READ` |
| Reporting API beta | expected `REPORTING_READ` — confirm | | |

Already held (verify the literal string at `src/app/api/square/auth/route.ts:9`
by READING it, and quote the line verbatim in the results):
`MERCHANT_PROFILE_READ ITEMS_READ ORDERS_READ EMPLOYEES_READ`.

Also record, with a doc citation each:
- Whether scope grants are independent of the `Square-Version` header (the
  planning lean says yes; confirm or refute at source).
- Whether `EMPLOYEES_READ` is deprecated in favor of a Team-scoped permission,
  and if so what the migration guidance says.
- Any scope on the list that is itself beta, deprecated, or renamed since the
  Shift→Timecard rename (2025-05-21).

**Flag as RULING NOW in the results if:** any needed read capability turns out
to require a scope whose name contains WRITE, or requires a merchant-side
subscription (e.g. Shifts Plus) to return data. Do not resolve it; surface it.

If web access is unavailable in this session, STOP this task and record the
exact URLs Gary should open and paste back.

## Task 4 — SQUARE_VERSION changelog delta (web research)

Current pin: `src/lib/square.ts:4` → `SQUARE_VERSION = "2024-01-17"`. Verify by
reading the line and quote it verbatim. Proposed target (Gary's accepted lean,
2026-08-18): `2026-01-22`.

Fetch each dated changelog page below from
`https://developer.squareup.com/docs/changelog/connect-logs/<date>` and extract
EVERY change affecting the APIs Froot calls today — Orders, Catalog, Locations,
Team/Employees, Merchants, OAuth, Webhooks. Ignore APIs Froot does not call.

Dates: `2024-02-22`, `2024-04-17`, `2024-05-15`, `2024-08-21`, `2024-09-19`,
`2024-12-18`, `2025-01-23`, `2025-04-16`, `2025-05-21`, `2025-06-18`,
`2026-01-22`.

Output: a delta table — date · API · change · breaking? (yes/no/unclear) ·
which Froot call site it touches (file:line). An empty row set for a date is a
finding, not an omission — record "no changes to Froot-called APIs" explicitly.
Anything marked "unclear" is a question for Gary, not a judgment call to make
here.

If web access is unavailable, STOP this task and list the eleven URLs for Gary.

## Output and commits

Write ALL results to a single new file:
`docs/prompts/LABOR-0B_RESULTS.md` — dated, with each task's findings under its
own heading, stop reasons included verbatim where tasks could not complete.

Two-commit pattern:
1. Work commit: the results file only. Conventional Commits subject, e.g.
   `docs(labor): LABOR-0B survey results — Task 1c, Task 5, scope strings, version delta`.
2. Recorder commit: update the L-2 row's blocker text in `docs/ROADMAP.yaml`
   (preserve-and-mark — prepend, never delete) noting which LABOR-0 tasks are
   now complete, citing the work commit SHA measured with `git rev-parse HEAD`.

`npm run build` is NOT required — no source files change. Do NOT push. Gary
runs all pushes.

## Decisions that are NOT this session's to make (Gary's, pending)

- Final wording of the read-only ruling into DECISIONS.md.
- Lifting the L-2 build deferral.
- L-4's fate on the board (push half prohibited; Froot-only scheduler half
  keep-or-kill).
- Whether BUG-6 flips to shipped.
- Acting on ANY finding from this survey.

If a finding seems to demand immediate action, it is a RULING NOW entry in the
results file, and the session continues surveying.
