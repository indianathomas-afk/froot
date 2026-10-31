TIER 3 session. Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/L-4a_assignment_data_model.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# L-4a — Labor assignment data model — TIER 3

## What this is (plain English)

The first build step of L-4. Froot gets a place to store "this person works
at this store, this day, these hours." Nothing reads it yet and nobody can
see it yet. That's L-4b (scheduler screen) and L-4d (chart band). This
session only builds the storage and proves it holds good data and refuses bad
data.

## Scope (approved in L-4-0, docs/LABOR.md § "L-4 · Assignment layer")

IN:
- One additive model, `LaborAssignment`: organization × store × StaffMember ×
  date, with store-local start and end minutes (same shape as
  `gmOnFloorStartMinutes`), `createdByUserId`, timestamps, and an index on
  (organizationId, storeId, date).
- One additive migration.
- One fixture script that proves the model.

OUT (each is a later phase or a ruled-out idea; do not drift into them):
- No UI, no API routes, no capability. Those are L-4b.
- No engine changes. Nothing in labor-plan, labor-coverage, labor-budget,
  labor-daily, labor-week or labor-forecast imports anything new (ruling 3).
- No days-off table (ruling 6c).
- No breaks (L-4c).
- No Square anything (ruling 1).
- Never the bare word `Shift` in any name (L-2 DON'T 2, re-measured in L-4-0).

## Repo gate (one command at a time, paste results)

```
pwd
```
→ must end in `Froot/froot`. If it ends in capital-F `Froot`, run
`cd /Users/garythomas/Claude_Projects/Froot/froot` and run `pwd` again.
Anything else: STOP.

```
git status
```
→ on `staging`, tree clean except this prompt file (untracked is expected).

```
git log --oneline -1
```
→ expect `da90d9e`. If different, say so before continuing.

## Phase A — read (read-only, report with file:line)

Read the files. Where this prompt conflicts with the file at HEAD, the file
wins and you say so.

A1. `docs/LABOR.md` § "L-4 · Assignment layer" and the 2026-10-30 L-4-0 entry
    in `docs/DECISIONS.md`. Quote the L-4a scope as recorded there.
A2. `prisma/schema.prisma`: the neighbouring labor models
    (`LaborSalariedPerson`, `LaborSalariedAllocation`, `StoreStaffAssignment`,
    the model holding `gmOnFloorStartMinutes`), plus `StaffMember` and `Store`.
    Report their conventions: id type, how org and store are related, `onDelete`
    choices, timestamp fields, how dates are typed, index naming.
A3. Migrations: the naming pattern in `prisma/migrations/`, whether any
    existing migration has hand-added SQL (CHECK constraints or similar), and
    the migration log format (`docs/MIGRATIONS.md`, or wherever DOC-7 logged
    its migration).
A4. Fixtures: how an earlier labor fixture was written and run (e.g.
    `scripts/verify-labor-actuals.ts`, 27 checks): which database it touches,
    how it guards against running in the wrong place, and how it cleans up.
A5. `CLAUDE.md`: the evidence rule for database output (the branch column) and
    the house steps for creating and applying a migration on dev. Quote them.
    Every later step follows them exactly.

## Phase B — plan (then HARD STOP)

B1. The exact Prisma model you'll add, following A2's conventions.
B2. The fixture's check list. At minimum, it must prove:
    - a valid row writes and reads back;
    - each rule from B3 holds (good rows pass, bad rows are refused at
      whatever layer B3 rules);
    - it runs only against dev `br-broad-wave` and refuses any other branch;
    - it leaves no rows behind.
B3. RULING NOW items. One sentence each, with your lean and a draft wording.
    I expect at least these:
    1. **Two shifts, one person, one day.** Can a person have more than one
       assignment per day? A split manager could do Las Brisas in the morning
       and UNR in the afternoon. Overlapping times are a separate question:
       refused by the database, or left to L-4b's write routes?
    2. **Overnight.** Must the end come after the start on the same day
       (no shifts past midnight in L-4)? Should the database enforce that and
       the 0–1440 range with a CHECK constraint, or should code? Base the
       answer on A3: does this codebase hand-add SQL to migrations?
    3. **Deleting things.** What happens to assignments when a StaffMember,
       Store or the creating User is deleted? Follow A2's neighbours unless
       there's a reason not to; staff are normally TERMINATED, not deleted.
    4. Anything else Phase A surfaced.
B4. Classify every out-of-scope finding FIX NOW / RULING NOW / COMMENT / ROW.
    FIX NOW here means only the L-4 row and this phase's own files.

### ═══ HARD STOP 1 ═══
Print B1–B4. For each ruling: "Ratify as written, or give me your wording."
Write nothing until Gary replies. Record his reply verbatim.

## Phase C — schema and migration file (then HARD STOP)

C1. Add the model to `prisma/schema.prisma` exactly as approved.
C2. Create the migration file WITHOUT applying it, using the house command
    from A5 (create-only). Name it by the house pattern with an `l4a_` label.
    Add any approved hand-written SQL.
C3. Print the full migration SQL. Confirm it is additive only: CREATE TABLE,
    CREATE INDEX, ADD CONSTRAINT on the new table. No ALTER or DROP on any
    existing table.

### ═══ HARD STOP 2 — MIGRATION ═══
Print the SQL and the target branch. Ask: "Apply to dev br-broad-wave?"
Nothing touches any database until Gary says go.

## Phase D — apply on dev, prove it, work commit

D1. Before applying, show which Neon branch your environment points at, with
    the branch column per A5. If it is not `br-broad-wave`: STOP.
D2. Apply to dev by the house command. Paste the output.
D3. Prove the table exists: a query showing the table and its columns, with
    the branch column in the same output.
D4. Run the fixture. Paste the full pass/fail list. Any failure: STOP, report,
    don't fix without Gary's go.
D5. Boundary check: grep the core engine files named in OUT for
    `LaborAssignment` / `laborAssignment`. Expect zero hits. Paste the command
    and the result.
D6. `npm run build` must pass with no error line above the summary.
D7. Stage only the schema, the migration folder and the fixture (no
    `git add -A`). Work commit:
    `feat(L-4a): LaborAssignment model, additive migration, fixture`

## Phase E — docs commit (cites the work SHA)

E1. `docs/ROADMAP.yaml`, L-4 row: prepend an L-4a block to notes (the way L-2
    tracked AL-1/AL-2/AL-3): what shipped, the work SHA quoted, the rulings by
    DECISIONS.md heading, and fixture results in one line. Add the work SHA to
    `commits`. Status goes `planned` → `in_progress`, because the work is
    committed and not pushed. No sub-rows. No `meta.updated` key.
E2. `docs/DECISIONS.md`: Gary's B3 rulings, in his words verbatim, as one
    dated entry at the top.
E3. Migration log: an entry in the house format from A3. Dev applied; staging
    and production pending.
E4. `docs/LABOR.md` § "L-4 · Assignment layer": add the final model and a
    pointer to the fixture.
E5. Placeholder check before and after; the count must not rise:
    ```
    grep -c '__' docs/ROADMAP.yaml
    ```
E6. `npm run build` passes. Stage only the docs you touched plus this prompt
    file. Docs commit:
    `docs(L-4a): row in_progress, rulings, migration log, prompt`
E7. `git status` shows a clean tree.

## Report and stop

Both SHAs, files changed, fixture result line, rulings ratified vs. open,
the migration's status on each branch (dev applied; staging and production
not). Do NOT push. Do NOT start L-4b. Next is Gary's PRE-PUSH-CHECK.
