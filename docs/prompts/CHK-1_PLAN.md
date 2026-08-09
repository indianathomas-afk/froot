# CHK-1 — Checklist lifecycle: sections, expected windows, overdue→missed, operations report

**Audit and implementation plan. Written at HEAD `552a5e7`, branch `staging`,
clean tree, level with `origin/staging`. No code was written and no database was
queried in this session.**

This is the feature phase DEBT-36 and DEBT-48 were parked for. Gary ruled the
product design 2026-08-08 (R1–R5 in the session prompt). Those rulings are
inputs here, not questions — this document designs the implementation.

---

## 0-RULING. APPROVED BY GARY 2026-08-09 — this plan is the phase

**All five sessions, both migrations, and all eleven recommendations in §12 are
accepted as written**, explicitly including: grace buffer as a fixed 3-hour
constant; no-hours fallback to midnight + buffer WITH both visible signals;
the uniqueness index into Migration B carrying S3's re-measure-before-apply
instruction; no both-or-neither offset rule; `Non-Compliant` → `Missed` at day
close; Weekly/Monthly excluded from materialisation and labelled as such on the
report; `reports.view` as the report gate with no new capability; the window
clamp with a form warning; hourly cron with a two-day lookback.

**§12.4 and §12.5 ruled together: SNAPSHOT SCOPE IS NAMES ONLY, frozen on first
task log.** The full per-task snapshot is filed as its own row (§10), not
absorbed. Historical `TaskLog` rows get `sectionId` backfilled and **no
fabricated names**.

Nothing below this block is edited by the approval. §12 keeps its "open
questions" framing because that is what they were when written; they are closed
now, and this block is where that is recorded.

**S1 RUNS AS A FRESH SESSION. This session stops at the commit of these two
artifacts** (Gary, 2026-08-09) and begins no implementation.

---

## 0a. Measurement taken mid-session — appended, nothing below is edited

**The §2.3 duplicate precheck was run by Gary on 2026-08-09, while this document
was being written.** It is appended here rather than folded into §2.3 and §12.3,
per the convention DEBT-59 and DEBT-36 follow: the prose below records what was
believed when written, and it stands.

Each result names its branch, per CLAUDE.md § Database Evidence:

```
production       br-sparkling-block-a620qvg4   duplicate_groups 0
preview/staging  br-square-feather-a63z92vz    duplicate_groups 0
dev              br-broad-wave-a6vpjdw0        duplicate_groups 0
preview/main     br-purple-rain-a6m62xww       duplicate_groups 0
```

**Consequence 1 — §12.3 is answered.** Zero everywhere, so
`Checklist_storeId_templateId_date_key` **goes into Migration B**. §2.3's
fallback ("drop it if not") is now dead text; it is left standing because it
records the condition under which the decision would have gone the other way.

**RE-MEASURE BEFORE EXECUTING, DO NOT CITE THIS.** TPL-2's standing instruction,
and it applies harder here than there: this measurement was taken against a
table that grows every day a checklist is started, by a code path
(`api/checklists/route.ts`, `findFirst`-then-`create`) that can in principle
produce the very duplicate this index forbids. A clean result today is not a
clean result on the day S3 runs. **S3 re-runs the precheck on the three live
branches before the migration is applied.** A non-zero re-measure drops the
index; it does not delay the migration.

**Consequence 2 — A FOURTH BRANCH APPEARED, THIS DOCUMENT BRIEFLY BELIEVED IT
WAS LIVE, AND IT IS NOT. THREE STANDS.** The whole arc is recorded rather than
tidied away, because the wrong turn in it is this repo's most-documented failure
mode and it happened again in the space of one session.

*What happened.* The precheck returned a fourth row, `preview/main`
(`br-purple-rain-a6m62xww`), which appears nowhere in TPL-1's or TPL-2's
evidence blocks — both report dev / preview/staging / production and call that
"all three branches". This document had inherited that phrasing without checking
it, so the fourth row read as a correction to inherit-from-an-older-document
(TPL-2's own correction (a), happening again). Two verification instructions
were rewritten to say four branches, and one paragraph was added asserting —
**as labelled inference, not measurement** — that `preview/main` probably
receives `prisma migrate deploy` because a Vercel preview build on `main` runs
the same build script.

*What is true.* **`preview/main` IS INACTIVE. Measured by Gary 2026-08-09, not
inferred:** its `_prisma_migrations` tail ends at
`20260708100000_f1_goal_plans` (2026-07-08) — a month stale, with TPL-1a absent.
The branch stopped receiving deploys when `DATABASE_URL` was scoped
Production-only (BUILD-1), and it has been **archived since 2026-08-04**. The
duplicate_groups 0 it returned is therefore true and worthless: it measured a
fossil.

*What was corrected back.* The two verification instructions in §2.1 and §11-S1
now say **three** branches and name them — dev, preview/staging, production. The
inference paragraph is gone, replaced by this measurement. **No backfill
verification is owed on `preview/main`.**

*The lesson, which is not the one it looked like.* The reasoning that produced
the four-branch correction was sound in form — an older document's scope should
not be inherited unchecked — and it still reached a wrong answer, because a row
returning from a branch proves the branch EXISTS, not that it is LIVE. That is
CLAUDE.md § Database Evidence's "A ROW ID DOES NOT IDENTIFY A BRANCH" one turn
further on: **a branch answering a query does not identify a deploy target.** The
guard that caught it was a `_prisma_migrations` tail — a structural fact about
the branch, not a fact about the row — which is § Browser Evidence's corollary
("verify by a structural fact, not by its name") applied to a database branch.

*The fossil.* `br-purple-rain-a6m62xww` is a month-stale archived branch still
answering queries against a schema four migrations behind. It will keep
returning plausible, wrong answers to anyone who queries it — which is exactly
what it just did. **Gary's instruction 2026-08-09: note it for eventual
deletion.** Filed as a row at phase close (§10), not deleted here — this session
queried no database and deletes nothing.

---

## 0. Headline — five findings, and one of them changes the shape of the phase

1. **A checklist that nobody starts does not exist as a row.** `/store-view`
   lists *templates*, not checklists (`api/stores/[id]/templates/route.ts`), and
   a `Checklist` row is created on "Start Checklist"
   (`api/checklists/route.ts:130`) or by an admin's bulk generate (`:166`).
   So the thing R1 wants recorded as MISSED — a checklist the team never
   touched — has nothing to write the status onto. **Day close must
   MATERIALIZE the miss, not merely mark it.** This is the single largest
   consequence of the ruling and it is not visible from either parked row.

2. **`StoreHours` has no writer anywhere in the codebase.** The table exists in
   `20260627002005_init`; `prisma.storeHours` appears in exactly one file
   (`src/lib/labor-plan.ts:170`, a read) and `/stores` renders `hours` if
   present. `labor-plan.ts:172-174` states it outright: *"StoreHours is
   currently never populated, so inference is the normal path."* R2 makes day
   close StoreHours-driven — so this phase must ship the editor that populates
   it, or the ruled mechanism has no input. §3.

3. **`Template.frequency` is display-only.** Collected, exported, imported,
   rendered on `/templates/[id]:69` and `print/template/[id]:88` — and read by
   no generation path. Bulk generate creates a checklist for *every* active
   template *every* day. Materialising misses would therefore file a Weekly
   template as missed six days a week. §5.4.

4. **The as-executed hole is wider than section names.** Print and execution
   read LIVE `Task` rows (`print/checklist/[id]/page.tsx:30`), so editing a task
   description, or adding a task, also rewrites every historical checklist —
   not just renaming a section. DEBT-36's compliance argument is about
   headings; the same mechanism carries more. Proposed scope stays at headings,
   with the remainder named and filed. §2.4.

5. **DEBT-48's two open questions are answered by the rulings, and the third
   one it did not ask is the day boundary's *anchor*.** (a) "What does OVERDUE
   do across day boundaries" → R1: overdue is same-operational-day only; at day
   close it becomes COMPLETED or MISSED. (b) "What do the OFFSETS mean once the
   window is soft" → R3: expectations, never gates. Both are settled. What
   neither row asks, and what the code forces, is **what instant ends the
   operational day for a store with no hours configured** — see finding 2.

---

## 1. State at HEAD, so nobody re-derives it

### 1.1 Generation and lifecycle

| Fact | Site |
|---|---|
| Checklist rows are created on demand, per store × template × business day | `api/checklists/route.ts:130` (single), `:166` (bulk) |
| "Today" is the store's local business day via `businessDayWindow` | `src/lib/reports.ts:71` |
| `Checklist.date` is UTC-midnight of the store-local date | `reports.ts:57` `dbDate()` |
| Statuses in use | `Pending`, `In Progress`, `Completed`, `Non-Compliant` (`api/checklists/[id]/submit/route.ts:34-38`) |
| `Non-Compliant` renders on `/checklists` only | `checklists/page.tsx:14`; **absent** from `reports/page.tsx:31-33` and from `store-view-client.tsx:110-115` |
| No date gate on completion — a checklist of any age accepts task logs | `api/checklists/[id]/task-log/route.ts` (no date check) |
| Nav badge counts Pending+In Progress with **no date scope** | `(app)/layout.tsx:85` |
| Two Vercel crons already exist, `CRON_SECRET`-authed | `vercel.json`; `api/cron/pace-alerts/route.ts:16-22` is the precedent |
| No `date-fns-tz` — zoned arithmetic is hand-rolled on `Intl` | `package.json:42`; `reports.ts:51-54` |

### 1.2 Sections

Six sites derive sections from the free-text string, each independently:

| # | Site | What it does |
|---|---|---|
| 1 | `store-view/checklist/[id]/checklist-execution-client.tsx:85` | `Map` keyed on `sectionName \|\| "General"` |
| 2 | `templates/[id]/page.tsx:32` | same reduce |
| 3 | `print/checklist/[id]/page.tsx:45` | same reduce — **the compliance surface** |
| 4 | `print/template/[id]/page.tsx:27` | same reduce |
| 5 | `templates/template-form.tsx:482` | **order inferred from `orderIndex` adjacency** — DEBT-36's second defect |
| 6 | `api/templates/export/route.ts:122` | emits `task_section` |

Import resolves `task_section` to a string with `|| "General"`
(`api/templates/import/route.ts:191`). Duplicate carries `sectionName` through
the create payload (`templates-client.tsx:192`). Both write choke points reject
blank (`api/templates/route.ts:80`, `[id]/route.ts:58`).

`Checklist` stores only ids; `TaskLog` has no section column. DEBT-36's claim is
verified at HEAD.

### 1.3 Offsets and phases

`Template.startOffsetHours` / `endOffsetHours` are `Int?`, nullable since init,
blank by default since DEBT-59 (`2ccca7d`), read by nothing. The form's labels
already state the anchor semantics per phase
(`template-form.tsx:1040`, `:1044`):

| `operationalPhase` | start anchor | end anchor |
|---|---|---|
| Before Opening | opening − `startOffsetHours` | opening + `endOffsetHours` |
| During the Day | opening + `startOffsetHours` | closing − `endOffsetHours` |
| After Closing | closing − `startOffsetHours` | closing + `endOffsetHours` |

`availabilityType` is `StoreHours` \| `AllDay`; `AllDay` nulls the phase and both
offsets on save (`:832-834`).

Three phase lists exist: `OPERATIONAL_PHASES` (`src/lib/phases.ts:13`),
`PHASE_ORDER` (`src/lib/messages.ts:38`), and its hand-copied twin
(`handoff-notes.tsx:21`). That is DEBT-32.

---

## 2. Schema — additive only

Two migrations, one per schema-bearing session. **SQL is written for Gary to run
on dev first, per CLAUDE.md § Database. Claude runs nothing.** Both follow the
`20260808103000_tpl1a_template_type_entity` precedent: structural half and data
half in one transaction, idempotent, replayed on staging/production by
`prisma migrate deploy` in the Vercel build.

### 2.1 Migration A — `Section` entity (session S1)

```prisma
// CHK-1. Sections become first-class, PER TEMPLATE — the TemplateType precedent
// where it fits and not where it does not. TemplateType is per-ORG with its own
// management dialog because a type is a taxonomy shared across templates. A
// section is a heading INSIDE one template: it has no meaning outside it, two
// templates may both have "Restocking" and they are not the same thing, and it
// is edited where it is used. So this model takes TPL-1's @@unique-on-name,
// sortOrder and @@index conventions, and takes NO management surface.
model Section {
  id         String   @id @default(cuid())
  templateId String
  name       String
  sortOrder  Int      @default(0)
  createdAt  DateTime @default(now())

  template Template @relation(fields: [templateId], references: [id], onDelete: Cascade)
  tasks    Task[]

  @@unique([templateId, name])
  @@index([templateId])
}
```

`Task` gains `sectionId String?` + relation, `ON DELETE RESTRICT`.
`Task.sectionName` is **kept and kept written** — exactly TPL-1a's shape: the
legacy mirror stays until a later row retires it, so every read site can migrate
independently and a row with a null `sectionId` still renders.

`Checklist` gains the as-executed freeze:

```prisma
  // CHK-1. The as-executed record DEBT-36 says does not exist. Frozen ONCE —
  // on the first TaskLog write, or at day close for a checklist never started
  // — and NEVER rewritten. Shape: [{ "sectionId": "...", "name": "...",
  // "sortOrder": 0 }]. Print and history render headings from here when
  // present and fall back to the live join when null (rows completed before
  // this migration). Deliberately does NOT freeze task descriptions — see
  // docs/prompts/CHK-1_PLAN.md §2.4.
  sectionsSnapshot Json?
```

`TaskLog` gains `sectionId String?` (id only, no name — the name lives in the
snapshot, in one place, per DEBT-26's discipline).

```sql
-- CHK-1 Migration A — Sections become a first-class per-template entity.
--
-- ADDITIVE ONLY. Nothing is dropped and nothing is narrowed. "Task"."sectionName"
-- is untouched and keeps being written alongside "sectionId"; retiring it is a
-- later row, and only after this backfill is proven on all three branches.
-- See docs/prompts/CHK-1_PLAN.md §2.1.

CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Section_templateId_idx" ON "Section"("templateId");
CREATE UNIQUE INDEX "Section_templateId_name_key" ON "Section"("templateId", "name");

ALTER TABLE "Task"    ADD COLUMN "sectionId" TEXT;
ALTER TABLE "TaskLog" ADD COLUMN "sectionId" TEXT;
ALTER TABLE "Checklist" ADD COLUMN "sectionsSnapshot" JSONB;

CREATE INDEX "Task_sectionId_idx"    ON "Task"("sectionId");
CREATE INDEX "TaskLog_sectionId_idx" ON "TaskLog"("sectionId");

ALTER TABLE "Section" ADD CONSTRAINT "Section_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_sectionId_fkey"
    FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskLog" ADD CONSTRAINT "TaskLog_sectionId_fkey"
    FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- DATA MIGRATION — idempotent (ON CONFLICT DO NOTHING; backfill touches only
-- rows where "sectionId" IS NULL). Section ids are generated PER BRANCH and
-- will NOT match across dev/staging/production. Never paste one across
-- (CLAUDE.md § Database Evidence, inverted — the TPL-1a note applies verbatim).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. One Section per distinct (templateId, sectionName) already in use.
--    ORDER IS RECOVERED FROM THE DATA, not invented: sortOrder is the section's
--    smallest orderIndex, which is exactly what the adjacency render at
--    template-form.tsx:482 was approximating. A section whose tasks are
--    non-contiguous therefore collapses to ONE heading afterwards instead of
--    rendering twice — that is DEBT-36's second defect being fixed, and it is
--    the one visible change this migration makes.
INSERT INTO "Section" ("id", "templateId", "name", "sortOrder", "createdAt")
SELECT
    'sec' || replace(gen_random_uuid()::text, '-', ''),
    d."templateId",
    d."sectionName",
    d."minOrder",
    NOW()
FROM (
    SELECT "templateId", "sectionName", MIN("orderIndex") AS "minOrder"
    FROM "Task"
    WHERE btrim("sectionName") <> ''
    GROUP BY "templateId", "sectionName"
) d
ON CONFLICT ("templateId", "name") DO NOTHING;

-- 2. Backfill Task.sectionId by exact name match, within the same template.
UPDATE "Task" t
SET "sectionId" = s."id"
FROM "Section" s
WHERE s."templateId" = t."templateId"
  AND s."name" = t."sectionName"
  AND t."sectionId" IS NULL;

-- 3. Backfill TaskLog.sectionId from the task it logged. This is NOT an
--    as-executed record — it is the section the task belongs to TODAY, which is
--    the best that exists for rows written before this migration. The
--    as-executed record starts at the first snapshot written after deploy.
--    See §2.4 for why historical rows are deliberately not fabricated.
UPDATE "TaskLog" tl
SET "sectionId" = t."sectionId"
FROM "Task" t
WHERE t."id" = tl."taskId"
  AND tl."sectionId" IS NULL;
```

**Verification query for Gary, on the three LIVE branches** — dev
(`br-broad-wave-a6vpjdw0`), preview/staging (`br-square-feather-a63z92vz`) and
production (`br-sparkling-block-a620qvg4`), each result naming its branch on the
same line (CLAUDE.md § Database Evidence). **Three, matching TPL-1 and TPL-2.
`preview/main` (`br-purple-rain-a6m62xww`) is an archived fossil and is owed
nothing — §0a.**

```sql
SELECT current_setting('neon.branch_id', true) AS branch,
       (SELECT count(*) FROM "Task" WHERE "sectionId" IS NULL AND btrim("sectionName") <> '') AS unlinked_tasks,
       (SELECT count(*) FROM "Task") AS total_tasks,
       (SELECT count(*) FROM "Section") AS sections,
       (SELECT count(*) FROM "TaskLog" WHERE "sectionId" IS NULL) AS unlinked_logs;
```

`unlinked_tasks` must be 0. A non-zero result means a task carries a blank
`sectionName` past both choke points, and that row needs looking at before S1
ships — it is not a reason to loosen the backfill.

### 2.2 Migration B — Checklist lifecycle (session S3)

```prisma
  // CHK-1 lifecycle. Four columns, and the division between them is the point:
  //
  // OVERDUE IS NOT HERE. It is derived on read from the expected window and
  // "now" (src/lib/checklist-lifecycle.ts) — a live nagging state, correct the
  // instant an offset changes, with nothing to keep in sync. MISSED IS a stored
  // status, because R1 makes it a closed fact and a fact needs a writer.
  closedAt       DateTime?  // day-close instant; written once, by the cron
  completedLate  Boolean   @default(false)  // written by submit, when completedAt > expectedEndAt
  expectedStartAt DateTime? // the window this row was judged against, frozen at
  expectedEndAt   DateTime? // materialisation so a later offset edit cannot
                            // retroactively make a past miss look on-time
```

```sql
-- CHK-1 Migration B — Checklist lifecycle. ADDITIVE ONLY.
-- See docs/prompts/CHK-1_PLAN.md §2.2 and §5.

ALTER TABLE "Checklist" ADD COLUMN "closedAt"        TIMESTAMP(3);
ALTER TABLE "Checklist" ADD COLUMN "completedLate"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Checklist" ADD COLUMN "expectedStartAt" TIMESTAMP(3);
ALTER TABLE "Checklist" ADD COLUMN "expectedEndAt"   TIMESTAMP(3);

-- The day-close job scans by (storeId, date). Without this it is a seq scan on
-- the whole table every hour, forever.
CREATE INDEX "Checklist_storeId_date_idx" ON "Checklist"("storeId", "date");

-- Report surface: "missed, by day, across the org".
CREATE INDEX "Checklist_organizationId_date_status_idx"
    ON "Checklist"("organizationId", "date", "status");

-- NO BACKFILL. Every pre-existing row keeps closedAt NULL, completedLate false
-- and both expectations NULL. That is correct rather than lazy: no expected
-- window existed before this phase, so no historical row can be said to have
-- met or missed one, and inventing expectations for them would manufacture
-- exactly the retroactive data DEBT-59 spent a session preventing. The lifecycle
-- starts at deploy. The report says so on its face (§6.3).
```

### 2.3 The one optional item — a uniqueness constraint the cron would like

`api/checklists/route.ts` guards duplicate creation with `findFirst`-then-`create`,
which is race-prone today and will be raced by the cron tomorrow. The clean fix:

```sql
CREATE UNIQUE INDEX "Checklist_storeId_templateId_date_key"
    ON "Checklist"("storeId", "templateId", "date");
```

**This is the one statement in the plan that can fail on existing data**, so it
is separated out and gated on a precheck Gary runs first, per branch:

```sql
SELECT current_setting('neon.branch_id', true) AS branch,
       count(*) AS duplicate_groups
FROM (SELECT "storeId","templateId","date" FROM "Checklist"
      GROUP BY 1,2,3 HAVING count(*) > 1) d;
```

Zero on all three branches → include it in Migration B. Non-zero → **drop it**
and have the cron rely on its existing read-then-write guard; the failure mode
is a duplicate missed row in the report, which is visible and fixable, whereas a
failing migration blocks a Vercel build on every branch. Recommendation: run the
precheck, include if clean.

### 2.4 As-executed snapshot — scope, and what is knowingly left out

**Proposed scope: section names only.** `Checklist.sectionsSnapshot` freezes
`[{sectionId, name, sortOrder}]` once — on the first `TaskLog` write (the
`Pending → In Progress` transition already in
`task-log/route.ts:26-31`, so there is one existing write to extend), or at day
close for a checklist never started. Never rewritten.

Freezing at *first task log* rather than at completion or at day close is
deliberate: a checklist completed at 10am, renamed at 2pm and closed at 11pm
would otherwise snapshot the 2pm name, which is the exact defect DEBT-36
describes with an extra step in front of it. The headings a checklist was
executed under are the headings it *started* under.

**Knowingly out of scope, and this is finding 4:** task descriptions, task
additions and task flags are still resolved live at print time
(`print/checklist/[id]/page.tsx:30` loads `template.tasks` fresh). So a printed
closing checklist from last month still re-prints with a task added yesterday.
The argument for stopping at headings: DEBT-36's compliance case is stated
about headings specifically, a full per-task snapshot roughly doubles the schema
and the print rewrite, and the two can ship independently because the snapshot
column is additive to itself. **Proposal: file it as a CHK-track row at the end
of this phase rather than absorb it** — the fix shape is a second Json column
(`tasksSnapshot`) written by the same single writer, and it is a phase, not a
rider.

---

## 3. Day close — the mechanism, honestly weighed

R2 rules day close as store close + a grace buffer, driven by `StoreHours`.

### 3.1 The prerequisite nobody has: `StoreHours` is empty

Finding 2. There is no UI, no API and no seed that writes `StoreHours`. So R2's
mechanism has no input on any branch today.

**Proposal: this phase ships the `StoreHours` editor** (session S2) — a
seven-row per-day editor (open / close / closed-today) in the existing store
edit surface on `/stores`, ADMIN via `stores.manage`. It is the smallest thing
that makes the ruled mechanism real, and it is independently useful: labor's
`getWeeklyDayPlan` (`labor-plan.ts:195-205`) already prefers explicit
`StoreHours` over sales inference and has been falling back for its whole life.

**Fallback for a store with no hours set.** Three candidates:

| | Behaviour | Verdict |
|---|---|---|
| (i) | No hours → no day close; checklists never close | **No.** The pile grows forever — the exact outcome DEBT-48 scenario (2) is about |
| (ii) | No hours → close at store-local midnight + buffer | **Recommended.** Predictable, needs no other subsystem, states plainly that the day ended |
| (iii) | No hours → reuse labor's `inferOpenWindowsByWeekday` | No. Couples checklists to the labor module and to `SalesHourlyCache`; a store with no Square data gets nothing, silently |

Recommend **(ii)**, paired with two visible signals so it is never silent: an
inline note on `/stores` for any store with no hours ("Store hours not set —
checklists close at midnight"), and a column on the operations report marking
which stores ran on the fallback. Without those the whole feature can run for
months on a default nobody chose, which is DEBT-59's lesson at store scale.

### 3.2 The buffer

**Proposal: a fixed constant, `DAY_CLOSE_GRACE_HOURS = 3`, in
`src/lib/checklist-lifecycle.ts`. Not configurable in this phase.**

Ground: three hours after close covers a real closing crew finishing up and
still lands the close before the next opening for any plausible schedule.
`Organization.handoffNoteExpireDays` is precedent for a per-org grace, so the
door is open — but DEBT-59's line is *visible and editable versus silent and
persisted*, and a per-org column with no settings control is the silent side of
it. A constant is neither persisted nor claimed as chosen; it is one definition
in one file that the (i) explainer can quote. **If an operator ever asks for a
different buffer, that is a row: an `Organization.checklistDayCloseGraceHours`
column plus a Settings control, shipped together.**

### 3.3 The three mechanisms, weighed

| | How | Against |
|---|---|---|
| **Evaluated on read** | Status derived at query time from `StoreHours` + now | R1 requires MISSED to be *permanently recorded*. Derived-only means the record is recomputed from data that changes — an offset edit in March rewrites February's misses. And finding 1 kills it outright: a checklist nobody started has no row to derive anything about |
| **Generation-time sweep** | Tomorrow's spawn closes yesterday | There *is* no reliable spawn. Generation is on-demand (finding 1); bulk generate is an admin button nobody is obliged to press. A store that opens late closes yesterday late; a store closed today never closes yesterday at all |
| **Cron** | Scheduled job closes each store's day when its close+buffer has passed | Needs a job, needs `CRON_SECRET`, needs per-store timezone care. All three already exist in this repo |

**Recommendation: a hybrid, and the split follows R1's own language.**

- **Overdue is evaluated on read.** It is "a live nagging state" — no write, no
  scheduler, correct the instant an offset changes, and it needs no row that
  does not exist because it only applies to a checklist somebody started or
  which the store-view card is standing in for.
- **Missed and completed-late are written.** Missed is "a closed fact"; a fact
  has a writer. The writer is a cron.

This answers R2's parenthetical directly: *"evaluated-on-read … but
'permanently recorded' needs a write somewhere"* — the write is day close, and
only day close.

### 3.4 The job

`GET /api/cron/checklist-day-close`, registered in `vercel.json` at `0 * * * *`,
`CRON_SECRET` bearer auth, `maxDuration = 300` — `api/cron/pace-alerts/route.ts`
copied as the shape, including its per-store try/catch and its summary log line.

**Hourly, not daily.** A daily UTC cron fires at one instant for stores across
several timezones; hourly lets each store close on its own clock and makes a
skipped run self-healing.

Per active store, per business day in a two-day lookback window (yesterday and
the day before, so one skipped run repairs itself):

1. Skip if the day is already closed — **derived, no marker table**: every
   applicable template has a `Checklist` row for that day, and every row that is
   not `Completed` has `closedAt` set.
2. Skip if `now < dayCloseInstant(store, day)`.
3. For each applicable template (`isActive`, `isArchived = false`, `appliesTo`
   honoured, **and `frequency = "Daily"` — §5.4**):
   - Row exists, `Completed` → leave. `completedLate` was already set by submit.
   - Row exists, not `Completed` → `status = "Missed"`, `closedAt = now`,
     `completionRate` recomputed from its logs.
   - **No row → create one**: `status = "Missed"`, `closedAt = now`,
     `completionRate = 0`, `date = dbDate(day)`, `expectedStartAt` /
     `expectedEndAt` computed from the template's window as it stands at close.

`Non-Compliant` is treated as not-Completed and becomes `Missed` at close. It is
a submit-time verdict on a partial checklist; once the day is closed it is a
miss like any other, and keeping two closed-but-unfinished statuses would give
the report two answers to one question.

### 3.5 Timezone, overnight and DST — named, with the handling

There is no `date-fns-tz` in this repo (`package.json:42`), so zoned
construction is hand-rolled on `Intl`, extending the `localDateStr` idiom at
`reports.ts:51-54`. One new helper, `zonedInstant(dateStr, "HH:MM", tz)`, in
`src/lib/checklist-lifecycle.ts`.

| Edge | Handling |
|---|---|
| **Store closes after midnight** (`closingTime <= openingTime`, e.g. 02:00) | The close instant for business day D is D+1 at `closingTime`, then + buffer. Detected by comparing the two strings, not by any date arithmetic |
| **`isClosed` for that weekday** | No opening, no window. Any checklist row for that day closes at store-local midnight + buffer; nothing is materialised for a day the store was shut — **a store that is closed cannot miss a checklist** |
| **DST spring-forward** (a local wall time that does not exist) | `Intl`-based resolution lands on the next valid instant; the buffer absorbs the hour. Named so the first person to see a 3-hour-late close in March knows it is expected |
| **DST fall-back** (a wall time occurring twice) | The earlier instant is used. Close fires an hour "early" relative to the second occurrence; the buffer absorbs it |
| **A window end later than day close** (After Closing with `endOffsetHours` > buffer) | The window end is **clamped to day close**. Otherwise a checklist would be recorded MISSED while still inside its own expected window. The template form warns when `endOffsetHours` exceeds the buffer; the (i) explainer states the clamp |
| **Store timezone changed after the fact** | Past days are judged by `expectedStartAt`/`expectedEndAt`, frozen at materialisation. That is what those two columns are for |
| **Cron did not run for a day** | The two-day lookback closes it on the next run. A gap longer than two days is left open deliberately and logged — a silent retroactive sweep across an outage is worse than a visible hole |

---

## 4. State derivation — one definition, every surface reads it

New file `src/lib/checklist-lifecycle.ts`, free of React imports so client
components can use it (the `src/lib/phases.ts` precedent), Prisma types passed
in as plain shapes rather than imported.

```
type ChecklistState =
  | "upcoming"      // an expected window exists and has not started
  | "active"        // inside the expected window, or no window and day still open
  | "overdue"       // window end passed, day not yet closed, not completed
  | "completed"     // Completed (completedLate is a separate flag, not a state)
  | "missed"        // closedAt set, not completed — a closed fact
```

**The five predicates, stated once:**

- `expectedWindow(template, storeHours, day, tz)` → `{start, end} | null`.
  Returns `null` when `availabilityType === "AllDay"`, when `operationalPhase`
  is null, or when the store has no usable hours for that weekday. Anchors per
  the table in §1.3. **`start` is null when `startOffsetHours` is null; `end` is
  null when `endOffsetHours` is null.**
- `isUpcoming` — `window.start != null && now < window.start`
- `isActive` — not upcoming, not overdue, not closed
- **`isOverdue`** — `window.end != null && now >= window.end && closedAt == null
  && status != "Completed"`. **The `window.end != null` clause is R3 in code:
  blank offsets mean no expected window, and a checklist with no window end can
  never go overdue.**
- `isMissed` — `closedAt != null && status !== "Completed"`
- `isCompletedLate` — `completedLate` (stored; written once by submit)

**Why an expected window needs only `endOffsetHours`, and start is independent.**
Each field means exactly one thing and neither depends on the other:
`startOffsetHours` set → `upcoming` before it, absent → active from the start of
the day. `endOffsetHours` set → `overdue` after it, absent → never overdue. This
avoids a both-or-neither rule, which would either block saves (regressing
DEBT-59's optionality) or invent the missing half. **Recommendation: adopt it,
and say it in the (i) explainer in exactly those words.**

Per DEBT-26's discipline the definitions live here and nowhere else; every
comment elsewhere points at this file rather than restating the set — that is
the specific mistake DEBT-26 closed on.

---

## 5. Surfaces

### 5.1 Store view — what STAFF/STORE sees

`store-view-client.tsx` renders template cards with a status chip from
`statusLabel()` (`:110-115`), which today recognises only `Completed` and
`In Progress`. `api/stores/[id]/templates/route.ts` already fetches today's
checklists (`:45-54`) and already returns `existingStatus`.

Changes: the route additionally returns the derived state and the window; the
chip gains **Overdue** (warning colours, `--color-warning-bg` / `-text`) and
**Upcoming** (muted). The button text for an overdue card stays "Start
Checklist" / "Continue Checklist" — R1 and R3: nothing is hidden and nothing is
blocked.

**Missed never appears here** and this falls out for free rather than needing a
rule: the list is scoped to today's business day, and nothing is missed until
the day closes. The 11am employee in DEBT-48's scenario (2) sees "Opening —
Overdue", which is the answer that row asked for.

### 5.2 Execution page

`checklist-execution-client.tsx`: an overdue banner above the sections
("Overdue — this checklist was expected by 10:00 AM. It can still be
completed."), and for a missed checklist a read-only banner ("Missed — closed
Tue, Mar 4") with checkboxes disabled.

Enforcement is server-side, not merely visual: `POST
/api/checklists/[id]/task-log` and `POST /api/checklists/[id]/submit` return
409 when `closedAt != null` and the row is not `Completed`. That is R1's "closed,
not actionable" — and it is the only new refusal this phase adds. It is also the
first date-sensitive gate in either route; today they accept a task log against
a checklist of any age.

### 5.3 Print

`print/checklist/[id]/page.tsx:43-51` groups by live `sectionName`. It becomes:
headings from `sectionsSnapshot` when present, ordered by its `sortOrder`; the
live `Section` join when null (pre-migration rows); `"General"` for a task with
no section. A missed checklist prints with a "MISSED" stamp in the header
alongside the existing date and completion count.

`print/template/[id]/page.tsx` is a *template* print, not a record — it reads
live sections, correctly, and only its ordering source changes.

### 5.4 The frequency problem — finding 3

`Template.frequency` (`Daily` \| `Weekly` \| `Monthly`) is display-only. If the
day-close job materialises misses for every active template, a Weekly template
is filed missed six days a week and the operations report opens full of noise on
day one.

**Proposal: the job materialises misses only for `frequency = "Daily"`.** A
non-Daily template that *was* started still closes normally (Completed or
Missed) — only the create-a-row-for-a-checklist-nobody-started step is skipped.
Then file a CHK-track row for real frequency-aware generation. This is the
smallest honest handling: it does not pretend weekly scheduling exists, and it
does not fill the report with fiction. **The report states the exclusion on its
face** so nobody reads "no weekly misses" as "weekly checklists were all done".

### 5.5 Admin list, nav badge, reports counts

- `checklists/page.tsx:10-15` — add `Missed` to `STATUS_STYLES` and render the
  derived Overdue chip. Note that a status with no entry falls back to
  `Pending`'s "Not Started" styling (`:117`), so an unmapped `Missed` would
  render as *Not Started* — silently wrong, and the same fallthrough class as
  DEBT-37.
- `(app)/layout.tsx:85` — the STAFF nav badge counts `Pending`/`In Progress`
  with **no date scope**, so today it counts every unfinished checklist ever
  created. `Missed` is a new status and drops out automatically, which
  incidentally improves it. Verify rather than assume.
- `reports/page.tsx:31-33` — counts `Completed`/`In Progress`/`Pending` and
  already silently omits `Non-Compliant`. `Missed` must be added or the totals
  under-report again. This is a pre-existing defect this phase must not widen.

---

## 6. The template form, the (i) explainer, and section management

### 6.1 The (i) affordance (R3)

An `(i)` button beside the two offset inputs (`template-form.tsx:1038-1047`)
opening a `Popover` — the component is already imported in this file
(`:561-567`, the store-exclusions popover), so no new dependency. Proposed copy,
plain language, no jargon:

> **Expected window**
> These hours describe when this checklist is *meant* to be done. They never
> hide it — staff can always open and complete it.
>
> **Before the start time** it shows as *Upcoming*.
> **After the end time** it shows as *Overdue* — flagged, but still completable.
> **At the end of the day** (store close plus 3 hours) an overdue checklist is
> recorded as *Missed*, and a completed one is recorded as *completed late*.
>
> Leave the end time blank and this checklist can never be overdue — it is only
> ever completed or missed at day close. Leave both blank for no expected window
> at all.

### 6.2 The copy retirement (DEBT-59)

`template-form.tsx:1056` currently reads *"Optional. Recorded for reference —
not yet used to show or hide checklists. Leave blank if no window has been
decided."*

That sentence is earned honesty and it is retired **only by the session that
makes it false** — S4, the session that ships the surfaces. It becomes:

> Optional. Sets when this checklist is expected — it never hides it. Leave
> blank for no expected window.

The DEBT-29 comment block at `:1007-1009` and `:1048-1055` must be *prepended
to, not edited*, per the convention DEBT-59 and DEBT-36 follow.

`availabilityType`'s helper at `:1018` ("A label for staff — checklists stay
visible all day") stays exactly as written: it remains true, and it is the one
sentence in this box that never promised anything.

### 6.3 Section management UI

Sections already exist as free text with a datalist of existing names
(`:516`, `:419`) and ordering by drag. **What must not regress**: typing a new
section name in the row input, the datalist suggestions, bulk-assign section
(`:398-400`), the per-section select-all checkbox (`:490-496`), and blank
rejection at both API choke points.

What changes for the operator:

- The row input resolves to an existing `Section` by name within the template,
  or creates one. Free-text entry is preserved — DEBT-2b ruled sections
  deliberately free text and this phase does not overturn that; it gives the
  string a stable id behind it.
- A rename is now a *rename*: one edit, every task follows, and history does not
  move (because the snapshot froze it). **The AlertDialog-with-affected-count
  precedent from TPL-1b Q4 is not needed here** — that dialog exists because a
  TemplateType rename rewrites history; a Section rename no longer does. Say so
  in the row rather than copying the pattern reflexively.
- Section **order** becomes explicit (`sortOrder`) instead of inferred from
  adjacency. Reordering a section moves its tasks with it. This is the
  operator-visible half of DEBT-36's second defect.
- A section whose tasks are non-contiguous renders **one** heading, not two.

**`template-form.tsx` WILL be touched, in S1 and again in S4. The DEBT-59
nine-check re-run (`docs/prompts/DEBT-59_AUDIT.md` §7, checks 1–9) lands in the
regression plan of BOTH sessions** — S1 for the section work, S4 for the copy
and the (i) affordance.

### 6.4 CSV

Export (`api/templates/export/route.ts:122`) keeps emitting `task_section` as a
name — no header change, so files already on disk stay valid in both directions.
Import (`import/route.ts:191`) resolves the name to a `Section` within the
template being created, creating it if absent — the same by-name resolution
TPL-1b uses for types, and the reason the CSV needs no id column and no
environment coupling. Section `sortOrder` comes from first-appearance row order,
which is what the file already encodes.

---

## 7. The operations report (R4)

**Location:** `/reports/operations`, a sibling of the existing `/reports` page,
linked from it.

**Gate:** the existing `reports.view` capability — `MANAGE`, i.e. ADMIN +
MANAGER (`src/lib/permissions.ts:171`), store-scoped for MANAGER through
`getUserStoreScope()` exactly as `/checklists` does. **No new capability.** TPL-1
Q3's reasoning applies verbatim: a second check on a surface whose existing gate
already says the right thing can only ever disagree with it. PERM-5 can already
dial `reports.view` per user, so an operator who wants one manager excluded has
a control today.

**Three views over one query**, per R4 — by store, by day, by template — each
showing missed count, completed-late count, and completion rate, over a date
range. Completed-late is surfaced beside missed rather than buried, per R4.

**Three things the report must state on its face**, because each is a place a
reader would otherwise draw a wrong conclusion from a clean-looking number:

1. **The lifecycle starts at deploy.** Rows before Migration B have no
   expectations and are excluded, not counted as on-time (§2.2).
2. **Weekly and Monthly templates are not materialised** (§5.4). "No misses" for
   a weekly template means "not tracked", not "done".
3. **Which stores are running on the midnight fallback** because their hours are
   not set (§3.1).

---

## 8. DEBT-32 — in, and first

**In scope, as the opening move of S2.** DEBT-48 says the fold is "the natural
thing to do first if this is built, since a gate should read one list rather
than three", and this phase adds a **fourth** reader: `expectedWindow()` reads
`operationalPhase` to pick its anchor. Consolidating after that is consolidating
four lists instead of three.

It is genuinely small — delete the two `"During Hours"` alias lines
(`messages.ts:41`, `handoff-notes.tsx:24`), move `PHASE_ORDER` into
`src/lib/phases.ts`, import it from both. The row's own analysis says it is
behaviourally inert: `phaseOrder` falls back to `?? 1`, the same value the alias
maps to.

**Hazard, from the row:** `handoff-notes.tsx` carries one of DEBT-33's ten
baseline lint errors (`:70:25`). Whoever opens the file will see a scoped lint
failure that predates them. Per CLAUDE.md § Commit Gates, `npm run lint` is not
a gate; scoped `npx eslint` over the touched files is — and that scoped run will
fail on this file. **The S2 gate must scope eslint to the files it touches
excluding `handoff-notes.tsx`, and say so in the commit message**, rather than
appear to have fixed a DEBT-33 error it did not fix.

`src/lib/messages.ts` reads `operationalPhase` for handoff-note date resolution
(`resolvePostedForDate`, `phaseToShiftPhase`). **R3 must not disturb it** — the
expected window is a new, separate consumer of the same field; no write path for
`operationalPhase` changes in this phase, and the handoff regression checks in
§9 exist to prove it.

---

## 9. Regression — per session

**Standing, every session:** `npx eslint <touched files> && npm run build` as one
chained command with no pipes (CLAUDE.md § Commit Gates); staging SHA confirmed
against local HEAD before any staging observation (§ Staging Verification);
every DB result names its branch and every browser observation names the org id
and the Clerk instance.

**S1 — Section entity**
- Backfill query returns `unlinked_tasks = 0` on dev, then staging, then
  production before promotion (§2.1) — the TPL-1 three-branch precondition.
- All six section render sites (§1.2) show identical headings to pre-migration,
  **except** a non-contiguous section, which now renders one heading. Verify on
  a template deliberately given non-contiguous sections.
- Template save round-trips: add a task to a new section, save, reopen.
- Rename a section on a template with completed history → historical checklist
  and its print copy keep the old heading. **This is DEBT-36's trigger, fired
  deliberately for the first time, on staging.**
- Duplicate a template → sections duplicate with order (`templates-client.tsx:192`).
- CSV export → import round-trip preserves sections and their order.
- **DEBT-59 nine-check re-run** (`DEBT-59_AUDIT.md` §7).
- TPL-1/TPL-2 invariants: type badge still resolves through the join; the type
  rename cascade is still gone; export emits current type names.

**S2 — DEBT-32 fold + StoreHours editor**
- Handoff notes: "Post to Closing" at 7am lands today; "Post to Opening" at 10pm
  lands tomorrow; `shift_phase` unchanged on all three phases. This is the
  `messages.ts` behaviour the fold must not move.
- A template carrying the legacy `"During Hours"` string still orders as mid.
- Store hours save, reload, render on `/stores`; `isClosed` round-trips; Square
  resync does not overwrite them (`resync-square/route.ts:23` claims hours are
  Froot-native — verify it, do not cite it).
- Labor's weekly plan picks up explicit hours over inference for a store that
  now has them (`labor-plan.ts:195-205`) — a store with hours set is the first
  ever to take that branch.

**S3 — Lifecycle engine**
- Cron authorises only with `CRON_SECRET`; 401 without.
- A store past close+buffer with an unfinished checklist → `Missed`, `closedAt`
  set. Evidence: SQL naming the branch.
- A store past close+buffer with **no** checklist row for a Daily template → a
  `Missed` row is created.
- A Weekly template gets no materialised row (§5.4).
- Running the cron twice produces no second row and no second `closedAt`.
- A `Missed` checklist refuses `task-log` and `submit` with 409.
- A checklist completed after its window end has `completedLate = true`.
- A store with `isClosed` for that weekday gets nothing materialised.
- Existing `Pending`/`In Progress` rows from before the deploy are untouched.

**S4 — Surfaces**
- Overdue chip on `/store-view` for a template past its window end; the button
  still starts/continues it.
- Nothing is ever hidden by a window — the negative check, and the load-bearing
  one for R3.
- Blank offsets → never overdue.
- `AllDay` → never overdue.
- Execution page banners; print shows frozen headings after a rename.
- `/checklists` shows Missed with its own style, not "Not Started".
- `/reports` totals include Missed.
- STAFF nav badge does not count Missed.
- **DEBT-59 nine-check re-run** (`template-form.tsx` touched again).

**S5 — Operations report**
- Role gate: ADMIN sees all stores, MANAGER only in-scope stores, STORE and
  STAFF get 403/no nav entry.
- The three disclosure lines from §7 render.
- Counts reconcile against a direct SQL count on the same branch.

---

## 10. ROADMAP

- **New track `CHK`**, rows `CHK-1` … `CHK-5` matching the sessions below.
  `track:` is a free string on `PhaseItem` (`src/lib/roadmap.ts:98`); no type
  change.
- **DEBT-36 closes into CHK-1** — the Section entity is exactly its ruled
  direction. Its acceptance ("renames rewrite history, knowingly") is retired by
  the snapshot, and its latent trigger is fired deliberately in S1's regression
  plan.
- **DEBT-48 closes into CHK-3/CHK-4** — its own disconfirmation clause says so:
  *"Disconfirmed by: any availability filter keyed on operationalPhase or the
  offsets appearing in the codebase."* **Both of its recorded open questions are
  answered by the rulings — (a) by R1, (b) by R3 — and the row should say which
  ruling answered which**, rather than closing silently.
- **DEBT-32 closes into CHK-2.**
- **DEBT-59's "not yet used" copy retires in CHK-4**, and that row gets a rider
  saying so — the copy change is earned by the phase that makes it true, which
  is the same principle DEBT-59 itself was filed on.
- **Three new rows filed at the end of the phase**, not absorbed: full per-task
  as-executed snapshot (§2.4, ruled out of scope 2026-08-09), frequency-aware
  generation (§5.4), and **deletion of the archived `preview/main` Neon branch
  `br-purple-rain-a6m62xww`** (§0a — a month-stale fossil that still answers
  queries against a schema four migrations behind, and did so during this
  session's own precheck).
- TPL-1's note that `TemplateType.active` still has no writer is untouched by
  this phase and stays with TPL-2 step (3).

---

## 11. Size — and the session split

**This is the largest phase since HR.** It carries two migrations, a data
backfill, a new cron, a new library, a new report surface, a store-hours editor
that does not exist, and edits to `template-form.tsx` in two separate sessions.
Five sessions, one phase each, each independently verifiable on staging before
the next begins, schema and migration first.

### S1 — `CHK-1` · Section entity and the as-executed freeze
- **Ships:** Migration A; `Section` model; `Task.sectionId`, `TaskLog.sectionId`,
  `Checklist.sectionsSnapshot`; all six read sites migrated to the join with the
  string kept as fallback; snapshot written on first task log; section
  management in `template-form.tsx`; CSV by-name resolution.
- **Proves it worked:** `unlinked_tasks = 0` on all three live branches (§0a); a section
  rename on a template with completed history leaves the historical checklist
  and its print copy unchanged; non-contiguous sections render one heading;
  DEBT-59 nine checks pass.
- **Must not touch:** `Checklist.status`, generation, `StoreHours`, the offsets,
  any lifecycle behaviour. No cron. No copy change to the offsets box.

### S2 — `CHK-2` · Day-close inputs
- **Ships:** DEBT-32 fold (three phase lists → one); `StoreHours` editor on
  `/stores` behind `stores.manage`.
- **Proves it worked:** handoff-note date resolution unchanged across all three
  phases and the legacy alias; hours save, reload and render; labor's weekly
  plan takes the explicit-hours branch for a store that now has them.
- **Must not touch:** the checklist surfaces, the offsets, any schema.
  Smallest session of the five and deliberately so — it is the data
  prerequisite, and merging it into S3 would put a UI and a cron in one
  verification pass.

### S3 — `CHK-3` · Lifecycle engine
- **Ships:** Migration B; `src/lib/checklist-lifecycle.ts` (the five
  predicates); `GET /api/cron/checklist-day-close` + `vercel.json`; missed
  materialisation; `completedLate` written by submit; 409 refusal on a closed
  checklist.
- **Proves it worked:** verified through SQL and the cron's own response body,
  **not through UI** — no surface reads the new state yet, which is what makes
  this session verifiable on its own. Every check in §9's S3 block.
- **Must not touch:** any rendering. If a chip appears on a screen in this
  session, the split has failed.

### S4 — `CHK-4` · Lifecycle surfaces
- **Ships:** store-view chips; execution page banners and read-only missed
  state; `/checklists` Missed style; `/reports` counts; print as-executed
  headings and the MISSED stamp; the (i) explainer; DEBT-59's copy retirement.
- **Proves it worked:** §9's S4 block, including the negative — nothing is ever
  hidden by a window — and the DEBT-59 nine checks a second time.
- **Must not touch:** the cron, the predicates, the schema.

### S5 — `CHK-5` · Operations report
- **Ships:** `/reports/operations`, three views, `reports.view` gate, the three
  disclosure lines.
- **Proves it worked:** role gate at all four roles; counts reconcile against
  direct SQL on the same branch.
- **Must not touch:** anything upstream of it. Pure read surface.

**Five, not more — but S1 and S4 are the two that could overrun.** S1 carries a
migration *and* a form rewrite; S4 carries five surfaces *and* a copy change. If
either runs long the clean cut is S1 → (migration + read sites) / (form section
UI), and S4 → (store-facing) / (admin + print). That would make seven. The plan
does not pre-split them because both halves of each are verified by the same
walkthrough, and splitting a walkthrough across two staging passes costs more
than it saves.

---

## 12. Open implementation questions — each with a recommendation

Product questions are closed; R1–R5 are not open. These are implementation
calls, every one of them with a recommendation Gary can accept by silence.

1. **Grace buffer: constant or per-org column?** → **Constant,
   `DAY_CLOSE_GRACE_HOURS = 3`.** Per-org is a row with a Settings control,
   shipped together, if anyone asks. §3.2
2. **Store with no hours: what closes its day?** → **Store-local midnight +
   buffer**, with a visible note on `/stores` and a column on the report. §3.1
3. **The `Checklist` uniqueness index** → **precheck for duplicates per branch,
   include if clean, drop it if not.** §2.3
4. **Snapshot scope: names only, or fuller?** → **Names only**, frozen on first
   task log; the per-task snapshot is a filed row. §2.4
5. **Historical `TaskLog` rows: snapshot at migration or leave string-only?** →
   **Neither — backfill `sectionId` from the task's current section and
   fabricate no names.** A historical log's section is unknowable; writing
   today's name into an as-executed column would make a guess indistinguishable
   from a record, which is the defect DEBT-36 is about. The as-executed record
   starts at deploy and the report says so. §2.1 step 3, §7
6. **Does one offset alone make a window?** → **No both-or-neither rule.** Start
   governs *upcoming*, end governs *overdue*, independently. §4
7. **`Non-Compliant` at day close** → **becomes `Missed`.** Two closed-unfinished
   statuses would give the report two answers to one question. §3.4
8. **Weekly/Monthly templates** → **not materialised**, exclusion stated on the
   report, real scheduling filed as a row. §5.4
9. **New capability for the report?** → **No** — `reports.view` already says the
   right thing, per TPL-1 Q3. §7
10. **Window end past day close** → **clamped to day close**, with a form
    warning and a line in the explainer. §3.5
11. **Cron cadence** → **hourly**, two-day lookback, self-healing; a gap longer
    than two days is left open and logged rather than swept silently. §3.4

---

*Written 2026-08-09 at HEAD `552a5e7`. No code written, no database queried, no
commits made. Every line number cited was read at this HEAD, not carried from an
earlier audit — TPL-2's correction (a) is the reason that sentence is here.*
