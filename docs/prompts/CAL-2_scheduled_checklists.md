# CAL-2 — Scheduled checklists: "Add to Calendar", generation from occurrences, DEBT-61 closed — TIER 3

**Track:** CAL
**Branch:** staging
**Type:** Implementation — schema + generation path + template editor + lifecycle. TIER 3: audit → plan → STOP → Gary's explicit approval → build. You never push. No `&&` chains. `docs/prompts/` files are never edited after execution — addenda only.
**Depends on:** CAL-1 (production, `53cb9ce`), CAL-1a, CAL-1b (must be on staging before this starts — confirm).
**Created:** 2026-09-18 (planning chat)

## Repo gate
Run `pwd` — must be `/Users/garythomas/Claude_Projects/Froot/froot`. `git remote -v` — origin `indianathomas-afk/froot`. `git status` — on `staging`, clean, up to date. Read CLAUDE.md and docs/WORKFLOW.md. Confirm CAL-1b's commits are on `origin/staging`; if not, STOP. Confirm `CAL-2` exists as a `planned` row in ROADMAP.yaml (CAL-1's docs commit created it). Read DEBT-61 in full, including every rider. Read docs/prompts/CAL-1_calendar_reminders.md and its addenda, and docs/prompts/CAL-1_AUDIT.md.

## Why this exists
`Template.frequency` Weekly/Monthly has been a promise on a form since TPL-1: the value persists, prints, and nothing honours it. Bulk generate creates a Weekly template's checklist every day (litter); day close leaves those rows open forever (DEBT-61 rider, `frequencyLeftOpen`). CAL-1 built the projection helper and the occurrence engine. CAL-2 connects them: a non-Daily template gets a calendar rule, the calendar materialises the occurrence on the due day, and the occurrence creates the Checklist. That is DEBT-61's stated exit condition, and this phase closes the row with evidence.

## Rulings (Gary, planning chat 2026-09-18) — DRAFT for DECISIONS.md, ratified in PRE-PUSH-CHECK
> 2026-09-18 — Scheduled checklists (CAL-2). Ruled by Gary:
> 1. A non-Daily template generates a checklist ONLY through a calendar rule. Bulk generate and on-demand create skip templates whose frequency is not Daily. A Weekly/Monthly template with no calendar rule generates nothing, and /templates says so on the row ("Not scheduled — add to calendar").
> 2. "Add to Calendar" on the template editor creates a CalendarEvent with templateId set. Repeat is preset from Template.frequency (Weekly → Weekly, Monthly → Monthly) and can be changed; the start date is what the calendar collects — that is the day-of-week / day-of-month DEBT-61 says nobody collected. Category defaults to Store Ops. Stores follow the template's assignment.
> 3. A template-backed occurrence, when materialised, creates the Checklist row for (template, store, dueDate) through the existing create path, with expected window frozen per CHK-3. The Checklist carries the occurrence id. Completion of the occurrence IS the checklist's submit; there is no separate tick, and the calendar's Complete control opens the checklist instead.
> 4. A calendar-generated checklist follows the CHK-3 lifecycle in full: day close materialises Missed if nobody started it and closes it either way. The gate is the presence of an occurrence link on the Checklist row, not Template.frequency. Missed on the checklist marks the occurrence Missed, which is a terminal state for template-backed occurrences only — reminders keep ruling 4 of CAL-1 (never auto-closed). "One open at a time" holds: the next occurrence generates after Completed OR Missed.
> 5. Template.frequency stays as the label and the preset. It is not removed and it is not the scheduler.
> 6. Archiving a template-backed event does not archive the template; archiving a template archives its events and deletes their Open occurrences.

## Phase A — audit (read-only, then STOP)
Report with file:line at HEAD:
1. **Both checklist creation paths** in `api/checklists/route.ts` (single create, bulk loop) and their filters today. Where the CHK-3 expected-window freeze happens at create. What the minimum call is that creates one Checklist for (template, store, date) with the window frozen — is it a shared function or inline in the route? If inline, Phase B extracts it; do not duplicate it.
2. **Day-close cron** `materializesMisses()` and the closing-site gate — both places that branch on `Template.frequency` (DEBT-61's "Daily-only at BOTH sites"). Exactly what changes so the gate becomes "Daily OR has an occurrence link".
3. **CHK-5 operations report** — the "Only daily checklists are tracked…" exclusion text and the count it carries. What it must say once calendar-generated non-Daily checklists ARE tracked.
4. **Template editor** (`template-form.tsx`, `templates/[id]/page.tsx`) — where the button goes, what the form already knows about stores (appliesTo + assignments).
5. **CAL-1 surfaces** — `src/lib/calendar.ts` (`projectDueDates`, `nextDueDate`, `dueAtFor`), the materialise cron, the occurrence complete route, the banner feed, the detail dialog with its disabled Event tab. Name each seam CAL-2 touches.
6. **Template archive path** — what happens to checklists today when a template is archived; ruling 6 must sit beside it.
7. **Existing litter.** SQL, per live branch, run by Gary before Phase C (draft it): count of Pending checklists whose template frequency ≠ Daily, by branch. Those rows are DEBT-61's litter. Propose what to do with them (lean: leave them; the report already excludes them; file the count in the row). Do not delete data in this phase.
Classify FIX NOW / RULING NOW / COMMENT / ROW. **STOP.**

## Phase B — plan (append as addendum, then STOP)
Must cover:
- **Schema, one additive migration:** `CalendarEvent.templateId String?` + relation + index; `Checklist.calendarOccurrenceId String? @unique` + relation; no new status column — `CalendarOccurrence.status` gains the value `Missed`, validated in code. Precheck: none owed; say so.
- **Generation:** in the materialise cron, after creating a template-backed occurrence, create the Checklist via the A1 function, store the link, roll back the occurrence if checklist creation fails (unique-violation on an existing (store, template, date) row: link to it instead of failing — that row is pre-existing litter being adopted, count it in the body as `adoptedExisting`).
- **Bulk generate / on-demand:** skip non-Daily templates; body reports `skippedNonDaily`.
- **Day close:** gate widened per ruling 4; on Missed, update the linked occurrence to Missed. On Completed (submit route), update the occurrence to Completed with completedAt/by copied.
- **Calendar UI:** Event tab enabled in the create dialog — it lists active non-Daily templates for the selected store(s), and everything else mirrors the reminder form except notes/url/attachment (those live on the template). Detail dialog for a template-backed occurrence: "Open checklist" button in place of Complete; status shows Open / Completed / Missed. Grid chip carries a small checklist glyph.
- **Template editor:** "Add to Calendar" button, disabled with tooltip when frequency is Daily, opens the same Event form pre-filled. `/templates` list row shows "Scheduled: Weekly from Mon Sep 21" or "Not scheduled".
- **Reports:** CHK-5 text updated per A3; counts include calendar-generated rows.
- **Banner:** template-backed occurrence shows "Open checklist" inline.
- **DEBT-61:** the row closes in this phase's docs commit with the evidence named in the session report. Prepended closure per preserve-and-mark.
- **Docs:** CAL-2 row written at the end; DECISIONS draft above; DEPLOY_LOG unpromoted entry in the UM-3 shape; prompt + audit committed.
**STOP.** Wait for approval.

## Phase C — build
Two-commit pattern; scoped `git add`; `npm run build` gates both, read without a pipe; scoped eslint without a pipe. Migration hand-authored, diffed, NOT run locally. Deviations numbered from the highest recorded. Any change that would widen access or move a baseline: STOP.

## Session report
1. SHAs. 2. `git log --oneline @{u}..`. 3. Migration SQL in full. 4. Projection fixture unchanged and green; new fixture cases for occurrence→checklist linking and Missed propagation. 5. **Staging protocol, unrun**, per the browser-evidence standard (org `org_3G02wO4QlVVSWppi8aqlnSZnsDa`, Clerk `verified-snapper-7`, `br-square-feather` in every SQL result):
   - A Weekly template (create one named "CAL-2 test") with no calendar rule: bulk generate creates nothing for it; body shows `skippedNonDaily ≥ 1`.
   - "Add to Calendar" on it, start date today → event with templateId; grid shows it with the checklist glyph.
   - Cron curl (`$S`, length 64) → `materialized: 1`; SQL shows the occurrence AND a Checklist row linked to it, expected window non-null, branch visible.
   - Open the checklist from the calendar, complete it as a STORE account → Checklist Completed, occurrence Completed, banner clears.
   - Second event, backdated so day close sweeps it unstarted → Checklist Missed, occurrence Missed, next occurrence projected.
   - CHK-5 report shows the calendar-generated rows and the updated exclusion text.
6. The DEBT-61 closure text, verbatim, as it will appear in the row.
Then: "Built and committed. PRE-PUSH-CHECK is next." No further work.

---

# ADDENDUM A — Phase A audit result and Gary's rulings R1–R5

**Appended 2026-09-18. Nothing above this line is edited.** Full audit:
`docs/prompts/CAL-2_AUDIT.md`, taken at HEAD `484ead1` on `staging`.

Gate: `pwd` lowercase `froot`; origin `indianathomas-afk/froot`; on `staging`,
clean, up to date with `origin/staging` after an explicit `git fetch origin`.
CAL-1b's three commits (`9936610`, `00db87e`, `dfbfe6e`) are on
`origin/staging`. `CAL-2` is `planned` at `ROADMAP.yaml:16358`. DEBT-61 read in
full, all four riders. **Highest recorded deviation: S5-D77**, so CAL-2 numbers
from **S5-D78**.

The audit raised five questions. Gary ruled all five on 2026-09-18, in chat:

- **R1 — PROCEED. CAL-1's cron and completion checks ran on staging today and
  that blocker is retired.** Gary, in chat, 2026-09-18, quoted as the evidence
  of record: *"CAL-1's cron and completion checks ran on staging today — cron
  body materialized:1 at 17:04Z, banner showed overdue age, completion cleared
  it, second run materialized:0 skippedFuture:1 at 17:06Z, org
  cmr54z65v000105jxczpt72w1."* The grant test and STORE completion fold into
  CAL-2's own protocol rather than being run twice.
- **R2 — the actor comes from the SUBMIT SESSION. Missed uses day close's
  `closedAt` and records no actor.**
- **R3 — yes: 409 on submit against an occurrence-linked checklist that is
  already Completed. Reuse the closed-day guard's shape.**
- **R4 — two behaviours, and ruling 6 is reworded to say both.** Deactivate
  (`isActive = false`) is REVERSIBLE: the materialise cron skips inactive
  templates and reports `skippedInactiveTemplate`; nothing is archived and
  nothing is deleted; reactivation resumes. Archive (`isArchived = true`) is
  TERMINAL: cascade per ruling 6.
- **R5 — hide it.** A non-Daily template shows in the crew list only on a day it
  has a checklist.

### What the audit found that the brief did not anticipate

Four things, all recorded in `CAL-2_AUDIT.md` and all load-bearing below:

1. **`materializesMisses` does not exist.** It was renamed `dayCloseAppliesTo`
   by CHK-3's defect fix on 2026-08-10 and the rename was the fix, not tidying
   (`checklist-lifecycle.ts:511-521`). The brief names the old symbol.
2. **`Checklist` has no `completedBy` column** — attribution lives on `TaskLog`
   only. The brief's "completedAt/by copied" had no source until R2.
3. **`submit` is re-runnable and can move a checklist OUT of Completed**
   (`submit/route.ts:81-83`), which breaks "one open at a time" via an ordinary
   un-tick. R3 closes it.
4. **`/templates` cards do not render `frequency` at all.** Ruling 1's row text
   is a new line on the card, not an edit to an existing one.

### One access question the plan cannot settle — STOP item, carried to B11

Phase C says *"any change that would widen access or move a baseline: STOP."*
**This plan contains one, it is named in B11, and B11 is the only part of this
addendum that must be answered before Phase C begins.** It is raised here rather
than recorded as a deviation later, which is what that rule is for.

---

# ADDENDUM B — Phase B plan

Written against HEAD `484ead1`. Every file:line was read during Phase A.

## B0 What this plan does NOT touch

`Template`'s columns (no schema change to it at all), `Task`, `TaskLog`,
`TaskAttachment`, `Section`, `src/lib/permissions.ts` (**no new capability, no
baseline moved, no `GRANTABLE_CAPABILITIES` append**), `src/lib/calendar-access.ts`,
the attachment routes, the reminder half of the calendar, and
`dayCloseAppliesTo()` itself — the predicate keeps its exact body and its three
callers keep asking it the same question.

`Template.frequency` stays as the label and the preset (ruling 5). It is not
removed and it is not the scheduler.

---

## B1 Schema — one additive migration

`prisma/migrations/<YYYYMMDDHHMMSS>_cal2_scheduled_checklists/migration.sql`,
hand-authored per CLAUDE.md § Database, checked against `npx prisma migrate
diff`, **not run locally**. Gary runs it on dev; staging and production take it
through `migrate deploy` in the Vercel build.

### Prisma changes — two nullable columns, nothing else

On `CalendarEvent`:

```prisma
  /// CAL-2. Set when this event SCHEDULES A TEMPLATE rather than standing on
  /// its own. Null is a CAL-1 reminder and always will be — the two entity
  /// types of ruling 1 are distinguished by this column and by nothing else.
  ///
  /// onDelete: Restrict, stated because MIGRATIONS.md requires the choice to be
  /// deliberate. SetNull is Prisma's implied default for an optional relation
  /// and is WRONG here: it would leave an event whose whole meaning is "this
  /// template runs on Mondays" pointing at nothing, and the Event tab's
  /// invariant (templateId set ⇒ template-backed) would break silently. A
  /// scheduled template is archived, never deleted; Checklist.template is
  /// already Restrict by the same implied rule.
  templateId String?
  template   Template? @relation(fields: [templateId], references: [id], onDelete: Restrict)

  @@index([templateId])
```

On `Checklist`:

```prisma
  /// CAL-2. The occurrence that created this row, or null for every checklist
  /// bulk generate or /store-view made. THIS COLUMN IS THE DAY-CLOSE GATE
  /// (ruling 4): the question is no longer "is this template Daily" but "is
  /// this row Daily OR scheduled", and the answer is here rather than on
  /// Template.frequency.
  ///
  /// @unique because an occurrence produces exactly one checklist. Postgres
  /// permits unlimited NULLs in a unique index, so every existing row is fine.
  ///
  /// onDelete: SetNull is the FK SAFETY NET, not the policy. The policy is in
  /// PATCH /api/calendar/events/[id] (B4), which decides per row whether an
  /// Open occurrence may be dropped at all. SetNull exists so that a path
  /// nobody anticipated degrades to an untracked checklist rather than to a
  /// foreign-key error inside a cron.
  calendarOccurrenceId String?             @unique
  calendarOccurrence   CalendarOccurrence? @relation(fields: [calendarOccurrenceId], references: [id], onDelete: SetNull)
```

And the back-relation on `CalendarOccurrence`:

```prisma
  checklist Checklist?
```

**No new status column.** `CalendarOccurrence.status` gains the value `Missed`,
validated in code through `CALENDAR_STATUSES` in `src/lib/calendar.ts:49` — a
`const` tuple whose type flows into every reader, so the typecheck carries it.
The inline comment on the column (`schema.prisma`, `// Open | Completed`) is
updated to `// Open | Completed | Missed`.

**No `missedAt` column, and this is a decision rather than an omission.** R2
says *"Missed uses day-close `closedAt`, no actor"*, and `closedAt` already
exists on the Checklist the occurrence links to. Adding a second timestamp would
give one fact two authors, which is DEBT-26's discipline and the reason
`Checklist.completedLate` is written by exactly one route. The detail dialog
reads the instant through the back-relation, which it must load anyway to render
"Open checklist". `CalendarOccurrence.completedAt` stays null on a Missed row
and never holds a non-completion.

### Precheck: none owed, and here is why

Two nullable columns with no default, one unique index over a column that is
`NULL` on every existing row, one plain index, two foreign keys over columns
that are entirely null. **No existing row is read, rewritten or validated by
this migration, and no statement in it can fail on existing data.** Nothing to
count first.

### The migration SQL, in full

```sql
-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN     "templateId" TEXT;

-- AlterTable
ALTER TABLE "Checklist" ADD COLUMN     "calendarOccurrenceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Checklist_calendarOccurrenceId_key" ON "Checklist"("calendarOccurrenceId");

-- CreateIndex
CREATE INDEX "CalendarEvent_templateId_idx" ON "CalendarEvent"("templateId");

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checklist" ADD CONSTRAINT "Checklist_calendarOccurrenceId_fkey" FOREIGN KEY ("calendarOccurrenceId") REFERENCES "CalendarOccurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

---

## B2 The extracted creation function — `createChecklistForDate()`

**New export in `src/app/api/checklists/expectations.ts`**, which is already the
one shared bit of wiring between the two creation paths and already owns
`hoursByStore`/`freezeWindow`. It imports Prisma, so it stays out of
`src/lib/calendar.ts` (pure, client-importable).

```ts
/** The minimum call that creates one Checklist for (template, store, date) with
 *  the CHK-3 window frozen. Extracted by CAL-2 from the two INLINE copies in
 *  api/checklists/route.ts (:172 single create, :231 bulk) so the cron is a
 *  third CALLER and not a third copy. */
export async function createChecklistForDate(args: {
  organizationId: string
  storeId: string
  template: WindowTemplate
  dateStr: string            // "YYYY-MM-DD", store-local
  timeZone: string
  hours: HoursRow[]
  status?: string            // default "Pending"
  calendarOccurrenceId?: string | null
}): Promise<{ checklist: { id: string }; adopted: boolean }>
```

Behaviour:

- `date: dbDate(args.dateStr)` — the column value. The two existing callers
  today take it from `businessDayWindow(now, tz)`, which is
  `{ day, gte: dbDate(day), lt }`; `gte` and `day` are the same date expressed
  twice, so passing the string and deriving both inside is the identity. **The
  two existing callers keep using `businessDayWindow` and pass `w.day`** — their
  behaviour is unchanged, which is the point of extracting rather than
  rewriting.
- `...freezeWindow(args.template, args.hours, args.dateStr, args.timeZone)`.
- **`try/create` with a `P2002` catch on `@@unique([storeId, templateId, date])`**
  → re-read the existing row, write the link onto it if one was asked for, and
  return `{ adopted: true }`. Neither existing path catches `P2002` today (they
  guard with a read-then-skip); the catch is additive and makes the read-then-
  skip a fast path rather than the only guard. The day-close cron's
  `isUniqueViolation()` (`checklist-day-close/route.ts:54`) is lifted into this
  file rather than copied a third time.

**Adoption is a real write onto a pre-existing row and it is the one place this
phase touches DEBT-61's litter.** A Weekly template's Pending row for today,
created by bulk generate before this phase, becomes a tracked row the moment its
first occurrence lands on the same date. That is better than orphaning a second
row beside it, and it is counted as `adoptedExisting` so the number is visible
rather than inferred.

`api/checklists/route.ts` then calls this function at both sites and keeps every
one of its gates unchanged.

---

## B3 Generation — the materialise cron

`src/app/api/cron/calendar-materialize/route.ts`. The header comment's claim
**"THE ONLY WRITER OF A CalendarOccurrence ROW"** survives; a second sentence
records that it is now also a writer of `Checklist`, and why that is one author
and not two.

### Event load — R4's reversible half

The `findMany` at `:116-120` joins the template:

```ts
include: {
  storeAssignments: { select: { storeId: true } },
  template: { select: { id: true, isActive: true, isArchived: true, availabilityType: true,
                        operationalPhase: true, startOffsetHours: true, endOffsetHours: true } },
}
```

and before the store loop:

```ts
// R4 (Gary, 2026-09-18) — DEACTIVATE IS REVERSIBLE AND ARCHIVE IS TERMINAL, and
// this is the reversible half. An inactive template's event is SKIPPED, not
// archived and not deleted: reactivating the template resumes generation on the
// next run with the event, its schedule and its completion history intact.
// (Archive cascades — see the template archive route.) Measured 2026-08-10:
// Keva performs "archiving" with Deactivate, so this is the branch that fires.
if (event.templateId && (!event.template?.isActive || event.template.isArchived)) {
  result.skippedInactiveTemplate += applicable.length
  continue
}
```

### `afterDate` — the one real change to an existing line

`:150-156` reads the latest **Completed** occurrence. Under ruling 4, Missed is
terminal for a template-backed occurrence and the next one generates after
**Completed OR Missed** — so a missed week must advance the cycle or it blocks
the next one forever:

```ts
status: { in: ["Completed", "Missed"] }
```

This is safe for reminders because a reminder is never auto-closed as Missed
(CAL-1 ruling 4, unchanged), so no reminder row can ever carry that status.

**The `skippedOpen` check at `:137-144` needs no change** — it filters
`status: "Open"`, and a Missed row already fails to match. Recorded because it
looks like it needs one.

### The write — occurrence and checklist together

Replacing `:178-192`:

```ts
// ONE TRANSACTION, SO A HALF-MADE PAIR CANNOT EXIST. Ruling 3 makes the
// checklist the occurrence's whole point: an occurrence with no checklist is a
// row whose Complete control opens nothing, and it would be invisible until
// somebody tapped it. If the checklist cannot be made, the occurrence is not
// made either and the next run tries again.
const { occurrence, adopted } = await prisma.$transaction(async (tx) => { ... })
```

Inside: create the occurrence, then — **only when `event.templateId` is set** —
call `createChecklistForDate({ …, calendarOccurrenceId: occurrence.id })` on the
transaction client and set the link. A reminder event writes the occurrence
alone, exactly as today.

`P2002` on the occurrence's own `@@unique([eventId, storeId, dueDate])` stays
`raced++` and stays outside the transaction's failure path.

### New counters, added in BOTH places

`OrgResult` at `:51-60` **and** the summer at `:203-210`, because the comment at
`:202` says *"adding a counter can never mean adding one nobody totals"*:

`checklistsCreated`, `adoptedExisting`, `skippedInactiveTemplate`,
`checklistFailed`. All four join the `console.log` line at `:212-216` and the
response body at `:219-233`.

### One comment, no code — the cron collision

`vercel.json` runs `calendar-materialize` and `checklist-day-close` both at
`"0 * * * *"` and Vercel does not order crons. After this phase they share the
`Checklist` table. Neither order is wrong — day close only closes a row whose
day-close instant has passed, and a row materialised this hour has not reached
one — but the fact goes at the new write site rather than being rediscovered
from a Runtime Log.

---

## B4 Bulk generate, on-demand create, and the crew list

### Ruling 1 at both creation paths

`src/app/api/checklists/route.ts`:

- **Single create, `:153-163`** — `frequency` joins the template `select`, and
  after the 404:

  ```ts
  // RULING 1 (Gary, 2026-09-18). A non-Daily template generates a checklist
  // ONLY through a calendar rule. This is the refusal DEBT-61 has been missing
  // since it was filed: the control existed on the form and nothing honoured
  // it. 409 rather than 403 — the caller is allowed to do this, the TEMPLATE is
  // not eligible, and the message says where the eligibility comes from.
  if (!dayCloseAppliesTo(template.frequency)) {
    return NextResponse.json(
      { error: "This template runs weekly or monthly. Add it to the calendar to schedule it." },
      { status: 409 }
    )
  }
  ```

- **Bulk loop, `:220-243`** — the same predicate, `continue`, and
  `skippedNonDaily++`. The response at `:246` becomes
  `{ created: created.length, skippedNonDaily }`.

**The predicate is `dayCloseAppliesTo()`, reused, not re-derived.** It is
already the single expression of "is this a Daily template" at three sites
(`checklist-lifecycle.ts:556`), and a fourth site with its own `=== "Daily"`
would be exactly the quiet-disagreement failure CHK-3's defect is recorded
under. Its docblock gains a prepended CAL-2 note: the predicate is unchanged,
but the day-close CALLER now asks it alongside the occurrence link, and this
call site asks it alone.

### R5 — the crew list

`src/app/api/stores/[id]/templates/route.ts`. `frequency` joins the template
load, and the `applicable` filter at `:46-52` gains one clause **after** the
existing `existingToday` lookup is computed, so it can use it:

```ts
// R5 (Gary, 2026-09-18) — A NON-DAILY TEMPLATE APPEARS ONLY ON A DAY IT HAS A
// CHECKLIST. Ruling 1 makes the create path refuse it, so listing it on every
// other day would offer a Start button that now 409s. When the calendar HAS
// scheduled it for today the row exists, and it shows and opens normally.
//
// DEBT-65's "the three applicability filters read one rule" is preserved, and
// the rule is restated rather than broken: OFFER CREATION ONLY WHERE CREATION
// IS ALLOWED; SHOW WHAT EXISTS EITHER WAY.
if (!dayCloseAppliesTo(t.frequency)) return existingTodayByTemplate.has(t.id)
```

This requires reordering the route so `existingToday` is loaded before the
filter. It is the same query at the same cost; only its position moves.

---

## B5 Day close — ruling 4

`src/app/api/cron/checklist-day-close/route.ts`. **The closing site changes; the
materialisation site does not.**

1. **`:231-244`** — `calendarOccurrenceId: true` joins the `existing` select.
   The select is explicit, so the column does not arrive for free.
2. **`:273`** — the gate widens:

   ```ts
   // RULING 4 (Gary, 2026-09-18) — THE GATE IS THE OCCURRENCE LINK, NOT
   // Template.frequency. A calendar-generated checklist follows the CHK-3
   // lifecycle in full whatever its template's frequency says; a non-Daily row
   // with no link is still left open, which is the trade CHK-3 recorded and
   // CAL-2 does not disturb for pre-existing litter.
   if (!dayCloseAppliesTo(c.template.frequency) && c.calendarOccurrenceId == null) {
     dayResult.frequencyLeftOpen++
     continue
   }
   ```

   A Daily checklist with no link takes the identical path it takes today.
3. **`:296-302`** — after the `updateMany`, when `updated.count === 1` and the
   row carries a link:

   ```ts
   // R2: Missed records the DAY-CLOSE INSTANT and no actor. `now` is the same
   // value written to Checklist.closedAt one statement above, so the two
   // records of one event cannot disagree. There is no missedAt column: the
   // instant lives on the Checklist, which is the row day close already owns.
   await prisma.calendarOccurrence.updateMany({
     where: { id: c.calendarOccurrenceId, status: "Open" },
     data: { status: "Missed" },
   })
   dayResult.occurrencesMissed++
   ```

   `updateMany` filtered on `status: "Open"`, not `update` — the CHK-3
   idempotence shape, so a second run in the same hour matches nothing.
4. **`dayResult` at `:210-225`, the per-day summer and the top-level body** gain
   `occurrencesMissed` and `linkedClosed` (linked rows that closed, so a run
   that swept scheduled work and one that swept none do not read identically).
5. **The materialisation site at `:321-335` gains a comment and no code.** It
   must stay Daily-only: under ruling 1 a non-Daily template generates only
   through a calendar rule, so materialising one here would create the exact
   fiction the gate exists to prevent — and it would be unlinked besides. A
   future reader sweeping "make both sites agree" is the failure this comment
   is aimed at.

---

## B6 Submit — Completed propagation and R3's refusal

`src/app/api/checklists/[id]/submit/route.ts`.

**The refusal, R3.** After the closed-day guard at `:33-36` and in its shape:

```ts
// R3 (Gary, 2026-09-18). A COMPLETED OCCURRENCE IS A CLOSED FACT, the same way
// a closed day is. submit RECOMPUTES status on every call (:68-72) and can move
// a checklist OUT of Completed — ":81-83" says so — which would leave a
// Completed occurrence behind a checklist that is In Progress again, with the
// cron already moved on to the next occurrence. "One open at a time" would be
// broken by an ordinary un-tick. So the occurrence's completion is one-way, and
// this is where it is enforced.
if (checklist.calendarOccurrence?.status === "Completed") {
  return NextResponse.json(
    { error: "This scheduled checklist has already been submitted." },
    { status: 409 }
  )
}
```

**The propagation.** After the `prisma.checklist.update` at `:87-95`, when the
row carries a link **and** the computed `status === "Completed"`:

```ts
// R2: the actor comes from THE SUBMIT SESSION. Checklist has no completedBy
// column of any kind — attribution lives on TaskLog — so there is nothing to
// copy, and the person who pressed Submit is the honest answer and the same one
// api/calendar/occurrences/[id]/complete writes for a reminder (:93).
```

`updateMany` filtered on `status: "Open"`, setting `status: "Completed"`,
`completedAt` (the same instant written to `Checklist.completedAt`),
`completedByUserId` from `getUserStoreScope()`'s `dbUser`. `completedByStaffId`
stays null — submit has no staff-selection surface, and inventing one is out of
scope.

`Non-Compliant` and `In Progress` propagate nothing. The occurrence stays Open
and day close decides it, which is ruling 4.

### `POST /api/calendar/occurrences/[id]/complete` refuses a template-backed row

Ruling 3: *"Completion of the occurrence IS the checklist's submit; there is no
separate tick."* After the 404 at `:47` and **before** the store-scope check,
because it is a fact about the row and not about the actor:

```ts
if (occurrence.event.templateId) {
  return NextResponse.json(
    { error: "This is a scheduled checklist. Open the checklist to complete it.",
      checklistId: occurrence.checklist?.id ?? null },
    { status: 409 }
  )
}
```

The `checklistId` in the body is what lets a client that hit this route anyway
send the person somewhere useful. The standing "do not add a capability here"
comment at `:9-30` is untouched.

---

## B7 Calendar UI

**The Event tab is enabled.** `create-reminder-form.tsx:392-408`: the
`disabled`/`title` come off the trigger and the placeholder body at `:400-402`
is replaced by a new sibling component `create-event-form.tsx`.

**A sibling, not an eleventh prop on the reminder form.** That file's own
comment (`:16-22`) keeps the create and edit paths in one component because *"a
fork would put the eleven fields, their validation and their layout in two
files"* — which is an argument about the SAME field set. An Event has a
different one: it gains a template picker and **loses notes, url and
attachment**, which live on the template. The tab strip stays create-only
(`if (edit) return form`, `:386`); editing a scheduled event reuses the event
form the same way editing a reminder reuses the reminder form.

Event fields: template (required), category (default **Store Ops** per ruling
2), priority, store(s)/all, start date, time, repeat (**preset from
`Template.frequency`** — Weekly → Weekly, Monthly → Monthly — and changeable),
end date.

**Stores follow the template's assignment** (ruling 2). Picking a template
pre-fills `appliesTo` and the store set **from the template row**, not from any
form state — `template-form.tsx:1053` infers `appliesTo` from whether assignments
exist rather than reading the column, and a dialog that copied that inference
would inherit it (audit C3).

**New route** `GET /api/calendar/schedulable-templates?storeIds=`, gated
`requireCalendar("calendar.manage")`: active, non-archived, non-Daily templates
applicable to the selected stores, each with `frequency`, `appliesTo`, its
assignment list, and whether it already has an active event. A separate route
rather than a field on `GET /api/calendar/events` because that one is
`calendar.view` and is polled by the grid on every month change; this is read
once when a dialog opens.

**Detail dialog** (`occurrence-detail.tsx`): for a template-backed occurrence,
**"Open checklist"** replaces Complete — a link to
`/store-view/checklist/<id>` — and status renders Open / Completed / **Missed**.
`OccurrenceLike.status` is already a bare `string` (`:66`), so the third value
costs nothing structurally. Missed renders its instant from the linked
checklist's `closedAt`. Edit / Archive stay gated on `canManage` (`:340-360`).

**Grid chip** (`calendar-client.tsx:355-380`): one more conditional glyph beside
the Critical `Flag` at `:377`, driven by `templateId` on `EventRow` (`:36-45`),
which `GET /api/calendar/events` adds to its map at `:108-131`.

---

## B8 Template editor and `/templates`

**"Add to Calendar"** goes in the `isEdit` header block at
`template-form.tsx:1617-1645`, beside Delete — a template needs an id before an
event can point at it, and the create path has none. Disabled with a tooltip
when `frequency === "Daily"`; `frequency` is live state at `:1031`, so the
condition is already in hand. It opens the same Event form, pre-filled, in a
Dialog (CAL-1a's ruling: centred Dialog, never an anchored popover).

It renders only when `calendarEnabled` — the module being off means the control
does not exist (ruling 9), and the route 404s independently.

The `frequency` helper text at `:1704` ("Select how often this checklist should
be automatically created") becomes a half-truth for the two non-Daily values
under ruling 1 and is reworded: *"Daily templates generate automatically. Weekly
and monthly ones generate from the calendar — add this template to the calendar
after saving."*

**`/templates` list row.** `templates-client.tsx:379-393` gains a schedule line
beside the Type and Run badges — **a new line, because the card does not render
`frequency` at all today**:

- Daily → nothing (the card is unchanged for every Daily template).
- Non-Daily with an active event → `Scheduled: Weekly from Mon Sep 21`.
- Non-Daily with none → `Not scheduled — add to calendar`, muted, per ruling 1.

`GET /api/templates` joins the active non-archived `CalendarEvent` for each
template (`recurrence`, `startDate`) to feed it. The `Template` type at `:45-62`
gains one optional field.

---

## B9 Reports and the banner

**CHK-5** (`reports/operations/page.tsx`): the filter at `:215` takes the same
`&& c.calendarOccurrenceId == null` shape as the cron, which needs the column in
the page's checklist query. `excludedNonDaily` is **renamed
`excludedUnscheduled`** — it will be counting something its name no longer
describes, and *a name is not evidence of what it counts* is this file's own
recorded lesson. Copy at `:398-403`:

> **Only scheduled checklists are tracked.** Daily templates are tracked
> automatically; weekly and monthly ones are tracked once they are added to the
> calendar. A weekly or monthly template with no calendar entry is left out of
> every number above *(N checklists in this range)*. For those, "no misses"
> means "not scheduled yet" — not "all done".

Singular/plural and the count-0 omission at `:401` are preserved. No row ids on
screen (`:390-392`). Every calendar-generated row now counts in the tiles, the
per-store table and the per-template table, through the existing buckets — no
new bucket, because a scheduled checklist is a checklist.

**Banner** (`src/components/calendar-due-banner.tsx`, feed
`api/calendar/due/route.ts`): each item gains `templateId` and `checklistId`
from a `select` addition at `:56-59` and a field on the map at `:63-75`. A
template-backed item renders **"Open checklist"** inline in place of Complete.
The overdue/caught-up behaviour, the single pulse and the "renders nothing when
disabled" rule are untouched.

---

## B10 Fixture — `scripts/verify-cal2-generation.ts`

`verify-cal1-projection.ts` is **unchanged and must stay green** — a fixture
edit there would be the tell that projection behaviour moved, and CAL-2 changes
none of it.

The new fixture is PURE, the PERM-8 shape, `npx tsx`. **What it can pin** is the
two predicates this phase introduces, extracted so they are testable at all:

- `dayCloseApplies(frequency, calendarOccurrenceId)` — the ruling-4 gate.
  Cases: Daily + null → true (today's behaviour, byte-identical); Weekly + null
  → false; Weekly + linked → **true**; Daily + linked → true; null/blank/padded
  frequency behaving as `dayCloseAppliesTo` does.
- `isSchedulable(template)` — non-Daily, active, not archived. Cases covering
  R4's two behaviours: `isActive: false` → false, `isArchived: true` → false,
  and a Daily template → false however active.
- The recurrence preset map: `Template.frequency` Weekly → `Weekly`, Monthly →
  `Monthly`, Daily → not offered.

**What it cannot pin, said out loud** in the header the way CAL-1's fixture does
(`:27-32`): it does not prove the cron writes a linked pair, that a rollback
rolls back, that `adoptedExisting` adopts, that submit propagates, or that day
close marks an occurrence Missed. **Those are the staging protocol's**, and the
session report carries them unrun.

---

## B11 The one access question — STOP, answer before Phase C

**`calendar.manage` is `ADMIN_ONLY` baseline and grantable to `MANAGER`**
(`permissions.ts:202`, `:534`). **`POST /api/calendar/events` scopes stores to
the ORG, not to the actor's assignments** (`events/route.ts:165-175`) — so a
granted MANAGER can already create a reminder for every store in the org, and
that is CAL-1's shipped behaviour.

**CAL-2 changes what that reaches.** The same grant will now cause **Checklist
rows to be created at stores the MANAGER is not assigned to** — where
`checklists.create` (`OPERATIONAL`, so MANAGER holds it) refuses exactly that at
`api/checklists/route.ts:105`, and `checklists.create.bulk` is `ADMIN_ONLY`.

So the grant does not gain a new capability and moves no baseline, but it gains
a consequence that two existing capabilities are deliberately shaped to deny.
**That is the "widen access" trigger, and this plan does not settle it.** Three
options:

1. **Accept it and say so in the ruling.** Scheduling org-wide recurring work is
   what ruling 5 describes and what the grant exists for; a scheduled checklist
   is recurring work. The cost is that the store-scope bound on
   `checklists.create` becomes bypassable by a granted MANAGER through the
   calendar.
2. **Bound the Event half to the actor's store scope** — a granted MANAGER may
   schedule a template only at stores they are assigned to, while reminders keep
   CAL-1's org-wide behaviour. Defensible, but it makes two entity types on one
   calendar answer two different scoping rules, which is the kind of split that
   stops being remembered.
3. **Make the templateId write ADMIN-only** — `calendar.manage` opens the
   dialog, creating a template-backed event additionally requires `isAdmin`.
   Narrowest, and it leaves the MANAGER grant doing exactly what it does today.

**Recommendation: (1), stated in the ruling in plain words**, because ruling 5
already put scheduling in this capability and ruling 2 already put "Add to
Calendar" in this flow — (2) and (3) would each quietly undo a ruling Gary has
already made. But it is a widening, it is written here rather than discovered in
a diff, and Phase C does not begin until it is answered.

---

## B12 Rulings text for DECISIONS.md — ruling 6 reworded per R4

The Rulings block at the head of this prompt is the draft, **with ruling 6
replaced** per R4 and R1–R5 appended. Written as `DRAFT — pending
ratification`; Gary ratifies in PRE-PUSH-CHECK, and a committed draft is not a
ruling.

> 6. Deactivating a template (`isActive = false`) is REVERSIBLE and archiving
>    one (`isArchived = true`) is TERMINAL, and the calendar honours both.
>    Deactivate: the materialise cron skips that template's events and reports
>    `skippedInactiveTemplate`; nothing is archived, nothing is deleted, and
>    reactivation resumes generation on the next run. Archive: the template's
>    events are archived with it and their Open occurrences deleted. Archiving a
>    template-backed EVENT never archives the template. Un-archiving a template
>    does not un-archive its events — the occurrences are gone and the archive
>    was a decision.

---

## B13 Docs

- **`docs/ROADMAP.yaml`** — the `CAL-2` row rewritten at the END from what was
  actually done (`planned` → `staging`), with both SHAs, `blockers` and
  `deferred`. Per WORKFLOW.md § Session completion rules; not drafted in advance.
- **DEBT-61 CLOSES in this phase's docs commit**, prepended per
  preserve-and-mark, nothing below it edited. Its disconfirmation clause — *"any
  code path in api/checklists or the day-close cron branching on
  Template.frequency"* — has fired four times without closing the row, so the
  closure text does **not** lean on it. It names the exit condition the row
  itself states: *frequency-aware generation, a day-of-week and a day-of-month
  that nobody collects*, plus the two open items the 2026-08-10 rider named as
  all that remained (generation-time frequency awareness, and honest weekly
  lifecycle semantics), with the file:line of each and the litter counts from
  A7. Verbatim closure text is in the session report.
- **CAL-1's second blocker is retired**, citing Gary's message of 2026-09-18
  quoted in ADDENDUM A. The grant test and STORE completion move into CAL-2's
  protocol rather than being marked run.
- **`docs/DECISIONS.md`** — the rulings above as a draft.
- **`docs/MIGRATIONS.md`** — the new migration appended to the ledger, with the
  two `onDelete` choices stated as decisions per that file's own section.
- **`docs/DEPLOY_LOG.md`** — an UNPROMOTED entry in the UM-3 shape, written
  INTO the file by Claude in chunked verified writes with `wc -l` after each and
  `grep -c "^## "` before and after (CLAUDE.md § DEPLOY_LOG edits, as amended
  2026-09-18 by DOCS-4). Not handed over as a heredoc.
- **This prompt file with these addenda, and `docs/prompts/CAL-2_AUDIT.md`**,
  both committed in the docs commit.

---

## B14 Build order and the two commits

1. `prisma/schema.prisma` + the migration folder + `npx prisma generate`. **Not
   run locally.**
2. `expectations.ts` — `createChecklistForDate()`; `api/checklists/route.ts`
   rewired to call it, behaviour unchanged.
3. Ruling 1 at both creation paths + R5 at the crew list.
4. `calendar.ts` — `"Missed"` in `CALENDAR_STATUSES`; the two extracted
   predicates → `verify-cal2-generation.ts`.
5. The materialise cron.
6. Day close, then submit, then the occurrence complete refusal.
7. The template archive cascade (R4's terminal half).
8. Routes: `schedulable-templates`, the `events` GET/POST `templateId`, the
   `due` feed.
9. UI: Event tab + form, detail dialog, grid chip, template editor button,
   `/templates` row, CHK-5 copy, banner.

**Work commit** — `npx eslint <files this commit touches> && npm run build >
/tmp/build.log 2>&1 && git commit -F - <<'EOF'`, one chain, **no pipes**; the
log is read afterwards as a separate command. `git add` scoped to the files
touched, never `git add -A`. Lint is not a gate (DEBT-33).

**Docs commit second, citing the work SHA.** The recorded work commit is never
amended — that invalidates the SHA the row cites; amending the recorder is safe.
Both messages go through a heredoc (backticks in `-m` substitute).

`verify-cal1-projection.ts`, `verify-perm8-grants.ts`,
`verify-nav1-url-sets.ts` and `verify-store-hours-engine.ts` all run
**unchanged and green**. `SANCTIONED_ADDITIONS` is not touched — CAL-2 adds no
nav destination.

**Claude never pushes.** The report ends with the explicit unpushed-commits line.

## B15 Deviations

Numbered from **S5-D78** (S5-D77 is the highest recorded, CAL-1's `@db.Date`).
Anything taken is recorded in the ROADMAP row — and if a deviation would move a
baseline or widen access, the session STOPS and asks rather than recording it.
**B11 is that case, raised now rather than later.**

---

**STOP.** Phase B ends here. Awaiting Gary's approval of this plan, and his
answer to B11, before any file is touched.

---

# ADDENDUM C — Gary's B11 ruling, and plan approval

**Appended 2026-09-18. Nothing above this line is edited.**

Gary approved ADDENDUM B on 2026-09-18 with one change, in chat:

> **B11: Option — bound, not accept.** For non-ADMIN actors, POST and PATCH
> `/api/calendar/events` scope stores to the actor's assignments; "All stores"
> resolves to the actor's stores; ADMIN is org-wide as today. Applies to
> reminders and template-backed events alike — one rule. This does not widen
> anything and does not undo rulings 2 or 5. Record it as the B11 ruling and
> reword the form's "All stores" label for non-ADMIN.

**This is a NARROWING, and it narrows CAL-1's shipped behaviour, not just
CAL-2's new surface.** `POST /api/calendar/events` scopes stores to the org
today (`events/route.ts:165-175`), so a MANAGER holding the `calendar.manage`
grant can currently create a reminder for every store in the org. After this
ruling they cannot. Recorded plainly because a session reading the CAL-1 row
later will find behaviour that no longer matches it, and the reason is a ruling
rather than a regression.

**One rule, two entity types** — the scoping is applied before the template
branch, so a reminder and a template-backed event are bounded identically.
Rulings 2 and 5 are untouched: scheduling is still `calendar.manage`, and "Add
to Calendar" still creates a `CalendarEvent` with `templateId` set.

**`appliesTo: "all"` is RESOLVED AT WRITE TIME for a non-ADMIN**, not stored as
`"all"` and filtered later. The materialise cron fans `"all"` out to every
active store in the org (`calendar-materialize/route.ts:131-134`); an event
stored as `"all"` by a MANAGER would therefore reach stores the ruling excludes
on some later run, even though the form that made it was bounded. So a non-ADMIN
"All stores" is written as `appliesTo: "specific"` with their assigned store ids
enumerated. The bound is then a property of the ROW, not of the session that
made it.

Everything else in ADDENDUM B stands as written: no `missedAt` column;
`afterDate` reads Completed and Missed; the closing-site gate widens and the
materialisation site is untouched; R4's two behaviours; and DEBT-61 closes on
its stated exit condition rather than on its disconfirmation clause.

**Proceed to Phase C.** Two-commit pattern, scoped `git add`, no push, migration
not run locally.

---

# ADDENDUM D — PRE-PUSH-CHECK, 2026-09-18

**Appended 2026-09-18 by the PRE-PUSH-CHECK session (TIER 1). Nothing above this
line is edited.** Three facts this phase's artifact would otherwise not carry.

## 1. The rulings are RATIFIED

Gary, in chat, 2026-09-18: *"Ratify as written, including ruling 6 as reworded
and B11."* `docs/DECISIONS.md`'s CAL-2 entry is no longer a draft and is citable
as a ruling. Ruling 6 stands in its reworded form with the original quoted
beneath it unedited; B11 stands as a RULING rather than as a recommendation
Claude made and Gary agreed with — which matters on B11 specifically, because
Claude recommended the opposite and the log records that.

## 2. Deviation S5-D78, and one thing ruled NOT a deviation

**S5-D78 — the PATCH re-derive keeps an occurrence whose checklist somebody
started.** ADDENDUM B §B4 said only what CAL-1 already did: delete the event's
Open occurrences and let the cron re-derive. Correct for a reminder, whose Open
occurrence holds nothing; wrong for a scheduled one, which owns a Checklist that
may already carry task logs. The built behaviour splits them — started rows are
kept and reported as `keptStarted`, unstarted ones are deleted with their
checklist. Found during the build rather than in the audit. It widens no access
and moves no baseline, so it was recordable rather than a stop-and-ask. The next
phase numbers from **S5-D79**.

**The two-route archive cascade is NOT a deviation.** Gary, 2026-09-18: *"within
ruling 6 — a behaviour, not a route."* Recorded in the ROADMAP row as
implementation detail: ruling 6 says the template's events are archived with it
and names no route, so covering both writers of `isArchived` — `PATCH
/api/templates/[id]` and `PATCH /api/templates`, two different route files, the
second being the grid's bulk bar and the one operators actually use — is the
ruling honoured rather than exceeded. A cascade on the first alone would have
satisfied the sentence and failed the ruling.

## 3. The staging protocol gains a step — the `afterDate` proof

Added to the Session report's §5 protocol on Gary's instruction, and to the
CAL-2 row's first blocker, which is the list a later session will actually read:

> **After the Missed in step 5**, backdate that event so its next date is
> already due and run the cron again. **Expect `materialized: 1`.**

The cron counts forward from the latest occurrence in a TERMINAL state, and
CAL-2 changed that read from `status: "Completed"` to
`status: { in: ["Completed", "Missed"] }`. One line, and it is the line between
*a missed week costs you that week* and *a missed week kills the schedule
permanently*: under the old read the newest terminal row is a Missed one that
`nextDueDate()` is asked to advance past and cannot see, so the event never comes
due again — **and nothing errors**. `materialized: 0` here is that defect;
`materialized: 1` is the proof the cycle survives a miss. No fixture can reach
it: it is a database read, not arithmetic.
