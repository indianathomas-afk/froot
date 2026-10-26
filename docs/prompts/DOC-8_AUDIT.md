# DOC-8 — Audit: document due dates (sign within N days, overdue in compliance)

**TIER 3.** Phase 1, read-only. Written 2026-10-26 by the DOC-8 session, before
any file outside `docs/prompts/` was touched. Nothing in this file was measured
against a database; every claim is from code at `2c07301` (staging = main =
origin/staging = origin/main at the time of writing — the gate initially failed
because `main` carried merge `2c07301` that `staging` lacked; Gary fast-forwarded
and pushed, and the re-run passed).

The draft rulings in the prompt are Gary's **leans, not rulings**. Nothing here
records them as ratified.

---

## 1. Schema

### 1a. `HrDocument` — `prisma/schema.prisma:2178`

- No due-date column of any kind. Confirms the SELF-1 row's note
  (`ComplianceDocItem` has no due date because `HrDocument` has none).
- `categoryId String?` (`:2196`) → `HrDocumentCategory`, `onDelete: Restrict`.
- `appliesTo String @default("selected")` (`:2206`) — `"all"` | `"selected"`.
  The default flipped 2026-08-12; old rows keep `"all"`.
- `kind` (`:2180`) — only `kind = "Acknowledgment"` AND `requiresAcknowledgment`
  AND `isActive` is a compliance document (`complianceDocumentWhere`,
  `src/lib/hr-compliance.ts:968`).
- `createdAt` / `updatedAt` only. **There is no timestamp for when `appliesTo`
  changed** (`updatedAt` moves on every edit).
- Precedent for a kind-restricted admin flag: `tracksReturn` (`:2264`), refused
  on non-Acknowledgment kinds by the PATCH route
  (`src/app/api/hr/documents/[id]/route.ts:89`).

### 1b. `HrDocumentCategory` — `prisma/schema.prisma:2294`

`id, organizationId, name, colorKey, sortOrder, createdAt, updatedAt`. No
behaviour columns at all today; a `defaultSignWithinDays` would be the first.
Shared by library documents AND FillableForm rows (DOC-5 F7).

### 1c. Versions — `HrDocumentVersion`, `prisma/schema.prisma:2374`

- `isCurrent Boolean`; one current per document (versions route flips the old
  one off, `src/app/api/hr/documents/[id]/versions/route.ts:88`).
- `requiresReacknowledgment Boolean @default(false)` — HR-11k Case A, read off
  the CURRENT version, frozen after the first acknowledgment.
- **No `publishedAt`.** The version's publish date is `createdAt` (`:2404`),
  written at upload, which is also when it becomes current.

### 1d. Signed records and acknowledgments

- `HrDocumentAcknowledgment` (`:2483`) — per checkpoint, carries `signingCycle`
  (`:2513`), `signedAt`.
- `HrSignedRecord` (`:2525`) — one per (version, staff, cycle), `completedAt`,
  `signingCycle`. Append-only. Only a record produces `complete` (R1, 2026-08-15).

### 1e. Signing cycles, hire date, rehire date — `StaffMember`, `:446`

- `signingCycle Int @default(1)` (`:480`) and `rehiredAt DateTime?` (`:481`).
  Written together by `src/app/api/staff/[id]/reactivate/route.ts:93-94`
  (`rehiredAt: new Date()`, `signingCycle: { increment: 1 }`). **Yes, there is
  a rehire date, and it is an instant.**
- **Hire date = `startDate DateTime? @db.Date` (`:505`)** — MS-1, a CALENDAR
  date, nullable. Square seeds it from the team member's `created_at`, which
  is when the Square PROFILE was made, not a hire date; a hand edit wins
  (`startDateManual`). So it can be years old, or null.
- `createdAt` (`:521`) — when Froot's row was made (import day for most staff).
- `status` ACTIVE | TERMINATED, `terminatedAt`.

---

## 2. "Began applying" — the fork most likely to need a ruling

Audience resolution is `grantedToStaff` (`src/lib/hr-documents-access.ts:106`),
the one policy predicate. Three audience paths, and what timestamp exists for
each **per person**:

| Audience | How it reaches a person | Per-person "began applying" timestamp |
|---|---|---|
| Company-wide (`appliesTo = "all"`) | Everyone, corporate included (`:107`) | **None.** `HrDocument.createdAt` is when the doc was made; a later switch `selected → all` leaves no trace. |
| STAFF grant | `HrDocumentGrant` row with that `staffMemberId` (`:109`) | **`HrDocumentGrant.createdAt` (`schema:2353`) — exact.** Grants are delta-saved (`api/hr/documents/[id]/audience/route.ts:361-364`: deleteMany only the removed ids, createMany only the new), so an unchanged grant keeps its `createdAt`. |
| STORE grant | Person has a `StoreStaffAssignment` for that store, and is not corporate (`:118-120`) | **Only half.** `HrDocumentGrant.createdAt` says when the STORE got the document. **When the PERSON joined the store is not recorded anywhere** — `StoreStaffAssignment` (`schema:543`) has no `createdAt`. |

**Why a `createdAt` on `StoreStaffAssignment` would not fix the store case.**
All three writers delete and recreate a member's whole assignment set:
`api/staff/sync-square/route.ts:109-110`, `api/staff/[id]/resync-square/route.ts:110-111`,
`api/staff/[id]/route.ts:153-154`. A timestamp there would read "last Square
sync", which would keep pushing the clock forward. Store grantees would then
**never** go overdue. That is a worse failure than the one it fixes, and it
fails silently.

**A per-person "first applied" table** (materializing who a document reaches)
would contradict DOC-1 ruling 1 ("standing grants, not snapshots",
`schema:2318-2321`). Out of the question without a new ruling.

### Proposed clock start, per person × document

Everything is converted to the member's display-zone CALENDAR DATE first
(§7), then:

```
clockStart = latest of:
  hireAnchor     = rehiredAt            if signingCycle > 1 and rehiredAt set   (ruling 6)
                   else startDate       (already a calendar date)
                   else StaffMember.createdAt
  appliesAnchor  = STAFF or STORE grant → createdAt of the EARLIEST grant that
                   currently reaches them
                   appliesTo "all"      → HrDocument.createdAt
  setAnchor      = HrDocument.signWithinDaysSetAt                               (ruling 3)
  [versionAnchor = current version's createdAt — only under Fork F3's lean]
dueDate = clockStart + N calendar days
```

**What this gets wrong, so it can be ruled on with eyes open:** a person
**transferred into** a store, where the store's grant is older than both their
hire date and N, starts the clock at their hire date and can be **overdue on
the first day they are in the audience**. A new hire is fine, because the hire
anchor covers them. Only a transfer (or adding a second store) has the problem.
`selected → all` on an old document has the same shape, but the set-anchor
blunts it whenever N was set after the switch.

---

## 3. New version requiring re-sign (HR-11k Case A)

Under R2 (2026-08-15), a non-Case-A version bump changes nobody's obligation:
an earlier-version signature this cycle stays `complete`. Only Case A
(`currentVersionRequiresReacknowledgment`, passed at `hr-compliance.ts:530`)
creates a NEW obligation for people who had already signed.

**Lean:** the clock restarts from the Case A version's `createdAt`, **only for
members whose open item comes from Case A**, meaning they hold a this-cycle
record on an earlier version (`priorSignedThisCycle`, `:491`). Someone who never
signed any version owed the document already, so their clock should not reset
just because a new file was uploaded. Doing that would let a fresh upload clear
every overdue flag on the document.

---

## 4. Compliance math and every consumer

`ComplianceDocItem` is built in `computeStaffComplianceDetails`
(`src/lib/hr-compliance.ts:258`, items at `:419-589`). Training items are built
at `:591-613`. Every number on every surface below is derived from `items` and
never queried a second time. **That makes this function the only place the
due-date rule needs to live.**

Verified consumer list (all importers of the module's exports, `grep` on
the function names, not on a guard): `hr/compliance/page.tsx`,
`hr/compliance/by-document-section.tsx`, `staff/page.tsx`, `staff/[id]/page.tsx`,
`(my)/my/page.tsx`, `api/dashboard/my-compliance/route.ts`,
`lib/raise-eligibility.ts`, plus five verify scripts. **7 app paths.**

The predicate that decides `overdue` for training, today:
`else if (a.dueDate && a.dueDate < now) status = "overdue"` (`:599`). It ranks
after `Completed` and ahead of in-progress/not-started. `overdue` is already in
`ComplianceItemStatus` (`:46`).

| Consumer | Today | Under rulings 4 + 5 (lean in Fork F4) |
|---|---|---|
| `/hr/compliance` KPI cards (`page.tsx:97-117`) | "Overdue Training" = `totals.overdueCount`; requiredTotal/pct over all items | Overdue count now includes documents, so the label **"Overdue Training" becomes wrong** and needs to read "Overdue". requiredTotal and pct are **unchanged** (ruling 5: not-yet-due is still owed). "Needs Re-sign" drops by any rehire whose re-sign is overdue (status moves needs-resign → overdue). |
| `/hr/compliance` per-staff table (`compliance-staff-table.tsx:144`) | `{n} overdue` badge from `overdueCount` | Includes documents automatically. |
| `/hr/compliance` By Store (`hr-compliance.ts:816-831`) | sums of per-member counts | Unchanged in mechanism; overdue sums include docs. |
| `/hr/compliance` By Document (`pivotComplianceByDocument`, `:1052`) | pivot of the SAME items; StatusBadge (`by-document-section.tsx:326`) **asserts docs never carry "overdue"** and its `default` branch renders "Not started" | **The DOC-2 invariant holds structurally**: status changes inside items, signedCount counts `complete` only, audienceCount counts items, and the pivot adds and drops no one. **The badge is a live defect if not touched**: an overdue doc would render as "Not started". It needs an `overdue` case plus "due in N days" wording. |
| `/dashboard` banner (`summarizeOwed :729`, `compliance-banner.tsx`) | openCount = non-complete items; overdueCount; `nearestDueDate` training-only | openCount unchanged (ruling 5). Overdue docs turn the banner red. `nearestDueDate` widened to include doc due dates, which retires the 2026-09-07 "no due-date clause" ruling **for documents that have an N** and keeps it for documents without one. |
| `/my` portal (`my/page.tsx:82,189,207-216`) | statusRank already puts overdue first; doc detail `"{a}/{r} checkpoints"`, training `"Due {date}"` | Doc detail gains the due clause; the overdue icon and badge already work. |
| `/staff/[id]` Compliance tab (`staff-compliance.tsx:47-92`) | doc detail has no date; training `"due …"` / `"was due …"` | Doc detail gains the same clause. The STATUS_LABELS/variant map already handles `overdue`. |
| `/staff` Compliance column + STAFF-3 sort (`staff/page.tsx:91-94,258`; `staff-roster-card.tsx:37-43`) | pct from `summariesFromDetails` | **Unchanged.** pct does not move under ruling 5, so the sort does not move either. |
| Milestones raise gate (`raise-eligibility.ts:239-257`, F2(b)) | blocks on overdue TRAINING or ANY unsigned DOCUMENT | **Unchanged in code.** A doc that becomes `overdue` still counts as "unsigned" (`status !== "complete"`), and the training filter is `kind === "training"`, so nothing is double-counted. |
| Required-documents raise criterion (`raise-eligibility.ts:312-325`) | "Not signed: …" when not complete | Unchanged. |

### The raise consequence Gary asked to see

**Yes: under ruling 5, a brand-new hire's not-yet-due document blocks a raise
when `raiseComplianceGate` is on.** That is **already true today**. F2(b) blocks
on any unsigned document, and DOC-8 does not change it. Nothing gets newly
worse.

What DOC-8 changes is the stated premise. F2(b)'s reason, recorded in the code
at `raise-eligibility.ts:31-32`, is "a document is owed from the day it
applies". For a document with an N, that stops being true. Training only fails
the gate when overdue. Once documents have due dates, the same rule could apply
to them, and that would be the symmetric choice. **This is Fork F6.** In
practice it rarely bites: a person hired days ago almost never passes the
hours and cooldown criteria anyway.

---

## 5. Training precedent (HR-13 / HR-22)

- **HR-13 is `planned` and title-plus-scheduling-note only**
  (`ROADMAP.yaml:4558`). Exclude-until-due is **not built**. **Today a
  not-yet-due training assignment counts in requiredTotal and is owed**, exactly
  like ruling 5. See §9(c).
- Storage: `TrainingAssignment.dueDate DateTime?` (`schema:2879`), an INSTANT.
  The bulk dialog builds it as `new Date(\`${dueDate}T12:00:00\`).toISOString()`
  (`hr/training/bulk-assign-dialog.tsx:164`), which is **noon in the
  admin's browser zone**. The routes take any ISO datetime
  (`api/hr/training/assignments/route.ts:10`, `bulk/route.ts:20`,
  `[id]/route.ts:24`).
- Decision: `dueDate < now`, a UTC instant comparison (`hr-compliance.ts:599`).
  **A training "due Jul 26" turns overdue at noon on Jul 26, not at the end of
  that day.**
- Display: `formatInstant(dueDate, detail.timeZone, …)`. The words are
  `"due {date}"` / `"was due {date}"` (`staff-compliance.tsx:89-91`),
  `"Due {Mon D}"` (`my/page.tsx:216`) and `"Nearest due {Mon D}"`
  (`compliance-banner.tsx:90`). **Training never says "due in N days"**. That
  relative form is new wording.
- The closest relative-wording precedent is the calendar (CAL-2b / DEBT-101):
  store-local calendar-day counting, `daysOverdue` (`lib/calendar.ts:380`), and
  **"Due today", never "0 days overdue"** (`components/calendar-due-banner.tsx:315-326`).
- Helpers to reuse rather than reinvent: `localDateStr(instant, tz)`
  (`lib/reports.ts:52`), `daysBetween` / `addDays` on `YYYY-MM-DD`
  (`lib/milestones.ts:90,95`, MS-1's store-local tenure maths, which already
  reads `startDate`), `displayTimeZone` (`lib/hr.ts`), already resolved per
  member as `detail.timeZone` (`hr-compliance.ts:635`).

---

## 6. Admin UI

- **Create:** `POST /api/hr/documents` (`src/app/api/hr/documents/route.ts`),
  with the body schemas at `:50` (file) and `:63` (link). Category resolved at `:130`
  (`resolveDocumentCategoryId`, `api/hr/documents/categories/shared.ts`).
  Acknowledgment branch at `:217`. The UI is the "Add Document" dialog in
  `hr/documents/documents-client.tsx:650-786`. **Category-default inheritance
  goes in the route** at creation, Acknowledgment kind only. FillableForms
  are created by `createFillableForm` (`lib/hr-forms.ts`) and are not
  compliance documents, so they do not inherit.
- **Edit:** `PATCH /api/hr/documents/[id]` (`route.ts:17-105`, the zod
  schema at `:17-40`). UI is `EditDocumentButton` (`documents-client.tsx:803-958`),
  where `tracksReturn` (`:825`, `:924-936`) is the shape to copy:
  Acknowledgment-only, ADMIN-only, refused server-side on other kinds.
- **Category:** `POST /api/hr/documents/categories` (`categories/route.ts`) and
  `PATCH /api/hr/documents/categories/[id]` (`categories/[id]/route.ts`). The UI is
  `hr/documents/document-category-manager-dialog.tsx` (DOC-5). Ruling 1 means
  editing the category default **never touches documents**. That is a
  route-level fact, and the fixture asserts it.

---

## 7. Timezones

- Every `DateTime` is `TIMESTAMP(3)` without zone, so the DB holds UTC.
  `startDate` is `@db.Date`, a calendar date with no zone.
- Training **decides** in UTC instants (`:599`) and **displays** in the
  member's display zone (`detail.timeZone`: primary store's zone, else the
  org's; DEBT-70b). The stored instant is browser-local noon (§5).
- **Lean for documents: whole calendar days in the member's display zone**
  (`detail.timeZone`, already in hand, no query):
  `start = localDateStr(anchor, tz)` for instant anchors, used as-is for
  `startDate`; `dueDate = addDays(start, N)`; overdue iff
  `localDateStr(now, tz) > dueDate`. The person has the **whole due day**. "Due
  in d days" means `d = daysBetween(today, dueDate)`, and `0` renders as "Due today".
- This is **deliberately not** the training rule, which flips at noon. The
  calendar's "the dates decide" is the better precedent for whole days. The
  training noon rule is out of scope and is triaged in §10.
- For the banner's `nearestDueDate` (an instant rendered `monthDay`), a doc due
  date is emitted as noon of that day in the member's zone. It sorts correctly
  against training and renders the same calendar day.

---

## 8. Launch day (ruling 3) needs only one timestamp

Ruling 3 says the clock starts at the later of go-live and the moment N is first set.
**N can only be set after the migration that adds it exists, so
"N first set" is never earlier than go-live.** The go-live half
adds nothing, so **one column, `HrDocument.signWithinDaysSetAt`**, implements
the whole ruling. It is stamped when N goes null → value, cleared when N →
null, and left alone on value → value (Fork F5). No per-environment go-live
constant, no backfill. Every existing row has N = null, which is today's
behaviour.

---

## 9. End of audit

### (a) Forks needing a ruling, each with a lean

- **F1. Store-grant clock start for transfers** (§2). *Lean:* accept it. The clock
  start is the latest of hire anchor, earliest-reaching grant `createdAt`, and
  `signWithinDaysSetAt`. A transfer into an old store grant can be overdue on
  arrival. Name this in the admin help text and file a ROW for a real
  store-join date. The alternatives are worse: an assignment timestamp that Square
  resets would mean store grantees never go overdue, and a materialized table
  contradicts DOC-1 ruling 1.
- **F2. Company-wide (`"all"`) documents.** *Lean:* use `HrDocument.createdAt` as the
  applies anchor. In practice, set-anchor and hire-anchor dominate.
- **F3. Case A re-sign** (§3). *Lean:* restart from the Case A version's
  `createdAt` **only** for members who signed an earlier version this cycle.
  Non-Case-A version bumps never touch the clock.
- **F4. How overdue is represented.** *Lean:* mirror training. The document item
  gains `dueDate: string | null` (`YYYY-MM-DD`, member zone) and
  `daysUntilDue: number | null`. `status` becomes `"overdue"` when past due and
  not complete, overriding not-started, in-progress **and needs-resign** (so a
  rehire's late re-sign is red, per ruling 6). **Exception: `recordMissing`
  is never overdue**, because the signer has done everything and the gap is an
  admin's (R1). The alternative is a separate boolean flag (the
  `recordMissing` precedent). That would leave `overdueCount`, the banner, the KPI
  and the By Store sums blind to documents unless each was edited, which means
  five places to keep in agreement instead of one.
- **F5. Changing N later.** *Lean:* value → value keeps `signWithinDaysSetAt`
  (shortening 30 → 3 can make people overdue immediately, which an admin
  doing that intends). Clearing N resets it, so re-setting starts a fresh
  grace period. Range 1–365 days, enforced by zod. No DB CHECK, because Prisma
  cannot express one and it would join the protected-index hazard list.
- **F6. Raise gate** (§4). *Lean:* **leave F2(b) unchanged in DOC-8.** Any
  unsigned document still blocks. Changing raise rules is its own ruling, and
  ruling 5's "not yet due is still owed" agrees with today's gate. Gary should
  rule explicitly, because the code comment's premise changes.
- **F7. Wording.** *Lean:* documents with N: `"Due in d days"`, `"Due
  tomorrow"`, `"Due today"` (the calendar's "never 0 days" rule), and overdue
  `"Was due {Mon D}"` (training's word, member zone). Documents without N keep
  today's text exactly. The KPI label "Overdue Training" → **"Overdue"**, sub "Past
  due date, not completed or signed".
- **F8. Category default scope.** *Lean:* inherited only by new
  **Acknowledgment** documents. N is refused on other kinds (the `tracksReturn`
  pattern). Editable in the category manager dialog. Never propagates to existing
  documents (ruling 1).
- **F9. `/my/documents` and the `/staff/[id]` Documents tab** use
  `documentCompletion` directly (`(my)/my/documents/data.ts`,
  `staff/[id]/page.tsx`), not the compliance items. *Lean:* **out of scope**.
  Showing a due date there means a second computation of the clock, which is
  DEBT-26's drift shape. Export the clock as one pure function from
  `hr-compliance.ts` now, and file a ROW to adopt it there.

### (b) Build plan

**Migration** `prisma/migrations/<timestamp>_doc8_document_due_dates/migration.sql`,
generated by `npx prisma migrate diff`, additive and nullable only. Expected shape:

```sql
ALTER TABLE "HrDocument" ADD COLUMN "signWithinDays" INTEGER,
ADD COLUMN "signWithinDaysSetAt" TIMESTAMP(3);
ALTER TABLE "HrDocumentCategory" ADD COLUMN "defaultSignWithinDays" INTEGER;
```

**Files to change**

- `prisma/schema.prisma`: three columns, with comments.
- `src/lib/hr-compliance.ts`: select the new columns and grant `createdAt` (a
  local include in this query; the shared `AUDIENCE_INCLUDE` stays as it is),
  member `startDate`/`rehiredAt`/`createdAt`/`signingCycle` (already loaded,
  since the fetch has no `select`), and the current version's `createdAt`. Add one exported
  pure `documentDueState()`. Widen `ComplianceDocItem` with `dueDate` and
  `daysUntilDue`. Add doc due dates to `summarizeOwed().nearestDueDate`. Update the
  header and `OwedSummary` comments (preserve-and-mark).
- `src/app/(app)/hr/compliance/page.tsx`: KPI label.
- `src/app/(app)/hr/compliance/by-document-section.tsx`: `overdue` badge case and due
  wording, plus correcting the "never reaches a document" comment.
- `src/app/(app)/staff/[id]/staff-compliance.tsx`: doc due clause.
- `src/app/(my)/my/page.tsx`: doc due clause.
- `src/app/(app)/dashboard/compliance-banner.tsx`: comment only (the
  no-clause ruling now applies to documents without N).
- `src/app/api/hr/documents/route.ts`: inherit the category default at create.
- `src/app/api/hr/documents/[id]/route.ts`: `signWithinDays`, Acknowledgment-only,
  stamping/clearing `signWithinDaysSetAt`.
- `src/app/api/hr/documents/categories/route.ts` and `categories/[id]/route.ts`:
  `defaultSignWithinDays`.
- `src/app/(app)/hr/documents/documents-client.tsx`: a field in the Edit and Add
  dialogs, and the doc type.
- `src/app/(app)/hr/documents/document-category-manager-dialog.tsx`: default field.
- `scripts/verify-doc8-due-dates.ts`: new.

**Fixture checks** (dev DB, principals named `DOC-8 Fixture …`):

1. N null: every status, count, pct and `nearestDueDate` is identical to the
   pre-change derivation, and `dueDate` is null.
2. N set and inside the window: `not-started` with "due in d" correct, and still counted in
   requiredTotal (ruling 5).
3. Past due: `overdue`, in `overdueCount`, banner overdue count.
4. Launch day: `signWithinDaysSetAt` later than hire and grant pushes the clock.
5. Rehire: cycle 2 with `rehiredAt` restarts the clock, and a late re-sign is `overdue`, not
   `needs-resign`.
6. `recordMissing` is never overdue.
7. STAFF grant `createdAt` later than hire pushes the clock. STORE grant takes the
   earliest-reaching grant.
8. Case A version: restarts only for earlier-version signers (F3).
9. Category default is inherited at create, and a category edit does not rewrite existing documents.
10. N refused on a non-Acknowledgment kind (route-level).
11. Timezone boundary: overdue flips at member-local midnight after the due
    date, not at a UTC midnight.
12. DOC-2 invariant: Σ audienceCount = doc items, and Σ signedCount = complete doc items,
    including overdue items.
13. Raise gate unchanged (F6): an overdue doc is "unsigned", and nothing is double-counted.

Also re-run `verify-doc2-by-document.ts`, `verify-hr8-compliance.ts`,
`verify-doc1c-compliance.ts` and `verify-self1-identity.ts` as regression.

Gates: `npm run build` green, plus scoped eslint on the changed files, plus the fixture green
**after** Gary applies the migration (CLAUDE.md § A migration STOPS the session).

### (c) Anything that contradicts a draft ruling

1. **Ruling 5's contrast with HR-13 is against an unbuilt rule.** HR-13
   (exclude-until-due) is `planned`. **Today, not-yet-due training is also owed
   and counted**, so ruling 5 matches current training behaviour rather than
   departing from it. If HR-13 later ships for training only, documents and
   training will diverge at that point.
2. **Ruling 3's "go-live" half adds nothing** (§8). It is not a contradiction, but
   the implementation has no go-live timestamp. Worth knowing before it is ratified in
   those words.
3. **Ruling 2 cannot be implemented exactly for STORE audiences** (§2): "the
   date the document began applying to them" is unrecorded for a person who
   joined a store after its grant. F1 is the consequence.
4. **"Displayed as 'due in N days'" is new wording**, not the training
   precedent the prompt asks DOC-8 to reuse. Training shows absolute dates. F7
   picks relative for upcoming dates and training's "was due {date}" for overdue.
5. **The 2026-09-07 SELF-1 ruling** ("document-only debt renders a count with no
   due-date clause") is premised on documents having no due date. Under DOC-8 it
   is narrowed to documents without N. Not reversed, but it is a recorded ruling
   being narrowed, so Gary should name it at ratification.
6. **The raise-gate F2(b) premise** (§4, F6). Same shape as item 5.

---

## 10. Out-of-scope findings (triage)

- **COMMENT.** Training due dates are stored as browser-local noon
  (`bulk-assign-dialog.tsx:164`) and turn overdue at that instant, not at the end of the
  day. An admin in another zone sets a different instant for the same picked
  date. No fix here. Note it beside the DOC-8 rule in `hr-compliance.ts` so the
  two rules are visibly different on purpose.
- **ROW (filed only if F9's lean is ratified).** Adopt `documentDueState()` on
  `/my/documents` and the `/staff/[id]` Documents tab.
- **ROW (filed only if F1's lean is ratified).** A store-join date that survives
  Square resync, so STORE-audience clocks can start at the transfer.
- **FIX NOW (inside DOC-8).** `by-document-section.tsx:326` would render an
  overdue document as "Not started". Fixed in the build, since DOC-8 is what creates the
  state.
