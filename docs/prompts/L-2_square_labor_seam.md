# L-2 — optional Square labor integration: the seam design

**Written:** 2026-08-05. This file is the current instruction of record for the
Square labor thread. It supersedes `LABOR-1_row_draft.md`.

**This file is NOT a session prompt.** It is a scoping record. A session that
pastes it will treat the contents as instructions; the shipped design lives in
the `L-2` row of `docs/ROADMAP.yaml`, and that row is what a future build reads.

---

## What supersedes what, and why nothing was deleted

Two files were written on 2026-08-02 and never executed:

- **`LABOR-0_shift_surface_grep.md`** — a read-only audit prompt. **It has never
  run.** No results record exists in any roadmap row, decision entry or session
  brief. Both it and the draft below arrived in a single commit, `2e75029`
  ("DEBT-55 site 1/21: … file four prompts"), filed alongside unrelated work.
  **It is still owed. Run it before any build on this thread.**
- **`LABOR-1_row_draft.md`** — reference text for a roadmap row that was never
  filed.

Both stay **byte-untouched**. Per `CLAUDE.md` § Where documents live, nothing in
`docs/prompts/` is ever edited: a saved prompt is a claim *wholesale*, and
rewriting one rewrites what was instructed to match what is now true. The draft
was correct on 2026-08-02 for the scope it was given. It is superseded, not
wrong, and the difference is worth preserving.

Two things in it are superseded, both by Gary's 2026-08-05 ruling
(`docs/DECISIONS.md`, top entry):

1. **It proposed a new row under a `LABOR-` prefix.** That is a third numbering
   of one thread. The `L-` prefix has been current since the 2026-07-20 reset,
   and **`L-2` was already this row** — "Team/Labor API — actual worked hours +
   wages, actual-vs-budget, Nevada OT warning", planned, already noting the
   scope dependency. Its phase (d), schedule write-back, was already `L-4`. The
   content was folded into `L-2`; nothing is filed under `LABOR-`.
2. **Its phase (c) had coverage-from-actuals superseding the L-3 decision to
   keep coverage sales-inferred.** It does not. Actuals are an overlay on top of
   forecast-derived coverage, never a replacement — the replacement path is
   exactly the one that stops working when Square is off. **L-3 (a) stands.**

## The ruling in one paragraph

Keva Juice is migrating to Square Scheduling, all stores by September 2026. That
makes the integration worth building; it does not make it a dependency. Froot
serves businesses that do and do not use Square, so the integration is **per-org
toggleable, off by default, and architected so a broken or disconnected Square
labor integration can never break core labor** — budgeting, coverage and targets
stay forecast-driven and keep working with the integration off or failing. Build
is deferred. The seam is designed now so the future build slots in without
tearing anything down.

## The seam, in four parts

Full text lives in `L-2`'s `notes` in `docs/ROADMAP.yaml`. Summary:

- **(a) Toggle** — `Organization.squareLaborEnabled Boolean @default(false)`
  plus a `SQUARE_LABOR_AVAILABLE` env gate and `requireSquareLabor()` in
  `src/lib/labor-access.ts`. Instagram's species (a dedicated integration
  column), **not** `activeModules` — that list is the billable add-on set, and
  an entry there would advertise a data source as a separate purchase and
  permit `square-labor` without `labor`.
- **(b) Data boundary** — `SquareTimecard` / `SquareScheduledShift`, prefixed,
  with their own `syncedAt` / `syncState`. Core engines never read them; a new
  `labor-actuals.ts` adds the comparison layer. **The test: drop every
  Square-labor table and every existing labor surface must render
  byte-identically.**
- **(c) Failure posture** — three states only: off, on-but-unhealthy (degraded
  badge, core numbers unchanged), on-and-healthy. Never a crashed page, never an
  integration error surfacing as 401/403 (BUG-1, live today at
  `labor-access.ts:26-31`), never zeros presented as measurements.
- **(d) Scopes** — Froot requests `MERCHANT_PROFILE_READ ITEMS_READ ORDERS_READ
  EMPLOYEES_READ`. Every Labor API scope is missing, and adding one re-consents
  every existing merchant connection. `Square-Version` is pinned `2024-01-17`,
  below the `2025-05-21` floor. **This is the long pole, not the code.**

## Before any build on this thread

1. **Run LABOR-0 in full.** A partial pre-check on 2026-08-05 covered its Tasks
   2–4 only — read-only greps over `src/` excluding `src/generated`; Task 1c
   (construction-site count) and Task 5 (webhook inventory) were **not** done.
   Findings: zero hits for deprecated Shift endpoints or `labor.shift.*` events
   (surface clean — so per the draft's own conditional, no Shift-migration row
   is warranted), and zero hits for `Timecard` / `SearchTimecards` /
   `WorkweekConfig` / `TeamMemberWage` (no Square labor ingest exists today).
   Those answers are dated; re-derive rather than trust them if months pass.
2. **Settle the scope/re-consent rollout with Gary before writing code.** It is
   a merchant-facing step, not a deploy, and it gates everything.
3. **Re-verify Square's deprecation timeline and the `2025-05-21` floor.** This
   row may sit for months and those dates move.
