# CAL-2 — Phase A audit

**Taken 2026-09-18 at HEAD `484ead1` on `staging`, clean but for the untracked
prompt.** Read-only: nothing in `src/`, `prisma/` or `docs/ROADMAP.yaml` was
edited by this phase. Every file:line below was read at that commit.

Artifact written per CLAUDE.md § Where documents live — *an observation that
lives only in a transcript does not exist*. The session report summarises this
file; it does not replace it.

## Repo gate

- `pwd` → `/Users/garythomas/Claude_Projects/Froot/froot` (lowercase `froot`).
- `git remote -v` → origin `https://github.com/indianathomas-afk/froot.git`.
- `git status` → on `staging`, up to date with `origin/staging` after an
  explicit `git fetch origin`; the only untracked path is this phase's prompt.
- **CAL-1b is on `origin/staging`** — `9936610` (work), `00db87e` (docs),
  `dfbfe6e` (PRE-PUSH-CHECK), all present in `git log origin/staging`.
- **`CAL-2` exists as `status: planned`** in `docs/ROADMAP.yaml:16358`.
- DEBT-61 read in full including all four riders (`ROADMAP.yaml:25019-25144`).
- CAL-1's prompt and both addenda, CAL-1_AUDIT.md, CAL-1a, CAL-1b and
  DOCS-CAL_promotion_catchup.md all read.
- **Highest recorded deviation: S5-D77** (CAL-1's `@db.Date` choice). CAL-2
  numbers from **S5-D78**.

---

## A1 — Both checklist creation paths, and the window freeze

`src/app/api/checklists/route.ts`, one `POST` handler with two branches.

### Path 1 — single create (on-demand), `:99-183`

Entered when the body carries **both** `templateId` and `storeId` (`:99`).
Gate chain in order:

| Step | Line | Refusal |
|---|---|---|
| `auth()` → `orgId` | `:85-86` | 401 |
| org by `clerkOrgId` | `:88-89` | 404 |
| `can(actor, "checklists.create")` | `:100-102` | 403 |
| store scope from `StoreUserAssignment`, never the body | `:105-107` | 403 |
| store scoped to org | `:109-113` | 404 |
| template scoped `{ organizationId, isActive: true, isArchived: false }` | `:153-163` | 404 |
| same-day row already exists | `:166-169` | 200 with the existing id |

**Filters on the template: `isActive`, `isArchived`, org. `frequency` is not
read.** That is DEBT-61's fact, unchanged, at a new line number — the row cites
`:130`, which comment growth has moved to `:153`.

**Its only caller is `/store-view`** — `src/app/(app)/store-view/store-view-client.tsx:80`,
`startChecklist()`. A repo-wide grep for `"/api/checklists"` returns that one
site.

### Path 2 — bulk generate, `:185-246`

`can(actor, "checklists.create.bulk")` at `:187`, then `stores × templates`
(`:207-210`) with `isActive: true` on stores and `isActive: true,
isArchived: false` on templates. Applicability is `appliesTo`/`storeAssignments`
only (`:221-225`). **`frequency` is not read here either.** This is the loop
that writes DEBT-61's litter: one Pending row per Weekly template per store per
day, forever.

### Where the CHK-3 expected-window freeze happens

**At create, in both paths, through one shared helper** —
`freezeWindow(template, hours, w.day, store.timezone)` spread into the `create`
data at `:179` (single) and `:238` (bulk). The helper is
`src/app/api/checklists/expectations.ts:39-47`; it delegates the actual rule to
`expectedWindow()` in `src/lib/checklist-lifecycle.ts` and "decides nothing"
(`expectations.ts:22-23`). `hoursByStore()` (`expectations.ts:28`) is the
batched `StoreHours` load.

### The minimum call that creates one Checklist for (template, store, date)

**It is INLINE in both paths, not a shared function.** Only `freezeWindow` and
`hoursByStore` are shared; the `prisma.checklist.create({...})` call itself is
written out twice (`:172-181` and `:231-240`) with identical data shape:

```
organizationId, storeId, templateId, date: <midnight-UTC of the store-local day>,
status: "Pending", ...freezeWindow(template, hours, dayStr, timezone)
```

**So Phase B extracts it, and must not duplicate it a third time.** The
extraction has one substantive difference from both existing callers: today the
date comes from `businessDayWindow(now, store.timezone)` (`src/lib/reports.ts:71-74`),
which is *today*. A calendar occurrence supplies an arbitrary `dueDate`, so the
extracted function takes a **date string** and uses `dbDate(dateStr)` for the
column and the same string for `freezeWindow`'s `dayStr` — `businessDayWindow`
is the today-shaped wrapper around exactly that pair, and the two callers keep
using it.

The template fields the freeze needs are the five selected at `:155-161`
(`id, availabilityType, operationalPhase, startOffsetHours, endOffsetHours`) —
`WindowTemplate` in `checklist-lifecycle.ts`.

### The uniqueness constraint the adopt-existing path will hit

`Checklist` carries `@@unique([storeId, templateId, date])`
(`prisma/schema.prisma:690`). Both existing paths guard it with a read-then-skip
(`findFirst` at `:166` and `:227`) and **neither catches `P2002`** — the
day-close cron is the only Checklist writer that does (`isUniqueViolation` at
`api/cron/checklist-day-close/route.ts:54`). The extracted function needs that
catch, because CAL-2's plan explicitly adopts the existing row on collision.

### Checklist has no `completedBy` column — a plan item cannot be satisfied as written

`prisma/schema.prisma:618-693`: `id, organizationId, templateId, storeId, date,
status, startedAt, completedAt, completionRate, sectionsSnapshot, closedAt,
completedLate, expectedStartAt, expectedEndAt`. **There is no
`completedByUserId` and no `completedByStaffId`.** Attribution lives on
`TaskLog` rows only (`TaskLog.completedByUserId` / `completedByStaffId`).

The CAL-2 prompt's Phase B says day close / submit should "update the occurrence
to Completed with completedAt/by copied". **There is no `by` on the source row
to copy.** See RULING NOW #2.

---

## A2 — Day close: the two sites that branch on `Template.frequency`

The predicate is **`dayCloseAppliesTo(frequency)`** —
`src/lib/checklist-lifecycle.ts:556`, body
`return (frequency ?? "Daily").trim() === "Daily"`. It was renamed from
`materializesMisses` by CHK-3's defect fix on 2026-08-10, and the 44-line
docblock above it (`:511-555`) says the rename *is the point*: a predicate
called `materializesMisses` asked at the CLOSING site "reads as a question about
creation and answers one about closing".

**`materializesMisses` no longer exists.** A repo-wide grep finds it only inside
that docblock. The CAL-2 prompt names it; the current symbol is
`dayCloseAppliesTo`.

### Site 1 — the CLOSING site, `api/cron/checklist-day-close/route.ts:273`

Inside `for (const c of existing)`, after the `Completed` and `closedAt`
short-circuits (`:247-255`):

```ts
if (!dayCloseAppliesTo(c.template.frequency)) {
  dayResult.frequencyLeftOpen++
  continue
}
```

`c.template.frequency` is joined explicitly in the `existing` query at
**`:242`** — `template: { select: { frequency: true, tasks: { select: { id: true } } } }`.
The surrounding comment (`:257-272`) calls this "THE LARGER HALF OF THE DEFECT"
and states the cost in terms CAL-2 inherits: *a non-Daily checklist somebody
genuinely started is now never closed, keeps `closedAt: null`, and reads
`overdue` indefinitely.*

### Site 2 — the MATERIALISATION site, `api/cron/checklist-day-close/route.ts:332`

Inside `for (const t of orgTemplates)`, after the `haveTemplate` short-circuit
(`:317-320`) and the `appliesTo` filter (`:321`):

```ts
if (!dayCloseAppliesTo(t.frequency)) {
  dayResult.frequencyExcluded++
  continue
}
```

Followed by the `createdAt` floor at `:369`.

### Exactly what changes so the gate becomes "Daily OR has an occurrence link"

**Site 1 (closing) is the one that must change, and it is a two-line change plus
one line in a `select`:**

1. `:231-244` — add `calendarOccurrenceId: true` to the `existing` select. The
   select is explicit, so the column will not arrive for free.
2. `:273` — `if (!dayCloseAppliesTo(c.template.frequency) && c.calendarOccurrenceId == null)`.
   Ruling 4's gate is *the presence of an occurrence link on the Checklist row,
   not `Template.frequency`* — so the link is the OR, and a Daily checklist with
   no link keeps today's behaviour byte-for-byte.
3. The counter at `:274` stays `frequencyLeftOpen` for rows that are non-Daily
   **and** unlinked. A linked row that becomes Missed needs its own counter so
   the two cases do not read identically in the response body — the CHK-3
   counter lesson, applied at `:210-225` where `dayResult` is built.
4. The `updateMany` at `:296-300` is where the occurrence propagation hangs: on
   `updated.count === 1` for a linked row, set that occurrence to `Missed`.

**Site 2 (materialisation) must NOT change.** It creates a Missed row for a
template nobody started, and under ruling 1 a non-Daily template generates
*only* through a calendar rule — so materialising one here would create the
exact fiction the gate exists to prevent, and it would be unlinked besides. Two
lines of comment at `:321-331` should say so, since a future reader sweeping
"make both sites agree" is the failure mode this audit can see coming.

**Predicate-level alternative, rejected:** widening `dayCloseAppliesTo` itself
to take a second argument. It is asked by three callers — the two above and
`reports/operations/page.tsx:215` — and the report's question ("is this row
tracked?") gets a different answer from the cron's ("should this row close?")
once a link exists. One predicate answering two questions is CHK-3's defect
exactly. Keep the predicate; add the link check at the call site.

---

## A3 — CHK-5 operations report: the exclusion text and its count

`src/app/(app)/reports/operations/page.tsx`.

- The filter: `:214-218` — `if (!dayCloseAppliesTo(c.template.frequency)) { excludedNonDaily++; continue }`, ahead of every bucket.
- The counter is declared at `:212` with the comment *"Rows the report will NOT
  judge, counted so the exclusion is a number on the page rather than an
  absence"*, passed through the payload at `:269`, destructured at `:290`.
- The copy, `:398-403`:

  > **Only daily checklists are tracked.** Weekly and monthly templates are not
  > yet scheduled or judged, so they are left out of every number above
  > *(N checklists in this range)*. For those templates, "no misses" means "not
  > tracked yet" — not "all done".

- Singular/plural handled at `:401`; the parenthetical is omitted entirely when
  the count is 0.
- The page's header comment (`:25-39`) pins the discipline: **every state comes
  from `src/lib/checklist-lifecycle.ts`**, `tracked at all → dayCloseAppliesTo(template.frequency)`,
  and *"no row ids on screen — DEBT-61 and Migration B are the engineering names
  for these, and an operator should not have to know them."*

### What it must say once calendar-generated non-Daily rows ARE tracked

The current sentence becomes **false in both halves** the moment one linked row
exists: "only daily checklists are tracked" and "weekly and monthly templates
are not yet scheduled" are each contradicted by a scheduled Weekly template.

The filter must change with it — `:215` becomes the same
`… && c.calendarOccurrenceId == null` shape as the cron, or the report will drop
the very rows CAL-2 exists to produce. That requires `calendarOccurrenceId` in
the page's checklist query.

Proposed replacement copy, for Gary rather than chosen here:

> **Only scheduled checklists are tracked.** Daily templates are tracked
> automatically; weekly and monthly ones are tracked once they are added to the
> calendar. A weekly or monthly template with no calendar entry is left out of
> every number above *(N checklists in this range)*. For those, "no misses"
> means "not scheduled yet" — not "all done".

The count keeps its meaning — rows the report refused to judge — and the name
`excludedNonDaily` becomes wrong for it. `excludedUnscheduled` matches what it
will actually count. **A name is not evidence of what it counts** is this file's
own recorded lesson (`checklist-lifecycle.ts:517-521`); renaming the variable is
the cheap half of not repeating it.

---

## A4 — Template editor: where the button goes, and what the form knows about stores

### `src/app/(app)/templates/[id]/page.tsx` — the read-only view

A server component. Screen-only control bar at `:44-56`: a "Back to Templates"
link, an **Edit** link to `/templates/[id]/edit` (`:49-53`), and `PrintButton`
(`:54`). `frequency` is rendered as a label at **`:68`** —
`Frequency: <strong>{template.frequency}</strong>`.

**This is the natural home for "Add to Calendar"**: it is a server component
that already has the template row, the control bar is three items, and the page
is where an admin lands after picking a template. It would need the store list
and `calendarEnabled` added to its query, plus a client island for the dialog.

### `src/app/(app)/templates/template-form.tsx` — the editor (2188 lines)

Serves both create and edit via `isEdit`. Header action bar at `:1600-1648`:
unsaved-changes text, save blockers, a **Delete** `AlertDialog` rendered only
when `isEdit` (`:1617-1645`), and **Save Template** (`:1646`).

**"Add to Calendar" belongs in that `isEdit` block beside Delete** — a template
must have an id before an event can point at it, and the create path has none.
Per the CAL-2 prompt it is disabled with a tooltip when `frequency === "Daily"`;
`frequency` is live state at `:1031` so the disabled condition is already in
hand.

The `frequency` control itself is at **`:1694-1705`** — label *"When should this
checklist be generated? *"*, a three-item `Select` (Daily / Weekly / Monthly),
helper text *"Select how often this checklist should be automatically created"*.
Under ruling 1 that helper text becomes a half-truth for the two non-Daily
values and should say so.

### What the form knows about stores

- `stores` prop — the org's stores, used for task exclusions and assignment.
- `appliesTo` state, `:1053-1055`: **derived from whether assignments exist**,
  `initialData?.storeAssignments?.length ? "selected" : "all"`.
- `selectedStoreIds`, `:1056-1058`: a `Set` seeded from
  `initialData?.storeAssignments?.map(a => a.storeId)`.
- `applicableStores`, `:1065`: `appliesTo === "selected" ? stores.filter(…) : stores`.
- Written back on save at `:1491-1492`: `appliesTo`, and
  `storeIds: appliesTo === "selected" ? Array.from(selectedStoreIds) : []`.
- The radio group renders at `:1931-1970`.

**So ruling 2's "stores follow the template's assignment" is directly
satisfiable** — `appliesTo` plus `selectedStoreIds` is exactly
`CalendarEvent.appliesTo` plus its `storeAssignments`, same vocabulary, same
values (`"all"` / `"selected"`).

**One quirk worth recording before anything copies it.** `initialData` declares
`appliesTo?: string` at `:73`, and `:1053` ignores it — the state is inferred
from the assignment list instead. A template saved with `appliesTo: "selected"`
and zero assignments reopens as `"all"`. It is not a live defect (the save at
`:1492` writes `[]` for `"all"`, so the two agree in the DB), but a CAL-2 dialog
that reads `appliesTo` from the form state rather than from the template row
inherits the inference. **Read the template row.**

### `/templates` list row — ruling 1's "Not scheduled — add to calendar"

`src/app/(app)/templates/templates-client.tsx`. The card renders, at `:366-398`:
a select checkbox, an Active/Inactive pill (`:374`), the name (`:378`), a
**Type:** badge (`:381-384`), a **Run:** badge (`:387-392`, `availabilityType`),
and the task count (`:395-397`).

**`frequency` is not rendered on this card at all.** It is on the `Template`
type (`:50`) and carried through the duplicate handler (`:184`), and that is its
only appearance. DEBT-61's claim that the value "prints back at them on the
template page" is true of `/templates/[id]:68` and of
`print/template/[id]/page.tsx`, **not** of this grid.

So ruling 1's row text is a **new line on the card**, not an edit to an existing
one — and the card will need `frequency` *and* the event's presence and schedule
to say "Scheduled: Weekly from Mon Sep 21". `GET /api/templates` does not join
`CalendarEvent` today.

---

## A5 — CAL-1 surfaces, and every seam CAL-2 touches

### `src/lib/calendar.ts` — pure, no Prisma import

- `CALENDAR_CATEGORIES` `:32` (five, each with a `--color-cal-*` token defined
  at `globals.css:54-58`), `CALENDAR_PRIORITIES` `:43`, `CALENDAR_RECURRENCES`
  `:46`, `CALENDAR_STATUSES` **`:49` — `["Open", "Completed"] as const`**.
- `normalizeCategory` `:62`, `normalizePriority` `:72`, `normalizeRecurrence`
  `:78` — the phases.ts pattern, reject-by-name.
- `ProjectableEvent` `:103-109` — `{ recurrence, startDate, endDate }`, all
  `"YYYY-MM-DD"` strings, and its comment says it is structural *"so CAL-2 can
  pass a Template-shaped object without this module learning about templates."*
- `projectDueDates(event, fromDate, toDate)` `:150`, `nextDueDate(event, afterDate)`
  `:232`, `dueAtFor(store, hoursRow, dueDate, dueTime)` `:266`,
  `daysOverdue(dueAt, now)` `:284`.

**Seam CAL-2 touches:** `CALENDAR_STATUSES` at `:49` gains `"Missed"`. It is a
`const` tuple whose type flows into the occurrence rows, so this is a one-line
edit with a typecheck behind it. **Nothing else in this file needs to change** —
a template-backed event is a `ProjectableEvent` already.

### The materialise cron — `src/app/api/cron/calendar-materialize/route.ts`

Header comment `:7-8`: **"THE ONLY WRITER OF A CalendarOccurrence ROW."**
Structure: secret check `:76-82` (un-trimmed, non-constant-time, copied on
Gary's ruling and covered by its own ROADMAP row — `:63-75` says so and says
*do not fix one route in isolation*); orgs where `calendarEnabled` `:86-89`;
`skippedDisabled` count `:95`; then per org → stores `:110-114` → events
`:116-120` → per (event, store) `:134-194`.

The per-pair loop, which is where CAL-2 lands:

| Line | Step |
|---|---|
| `:137-144` | `Open` occurrence exists → `skippedOpen++`, continue (ruling 3) |
| `:150-156` | latest `Completed` `dueDate` → `afterDate` |
| `:158-163` | `nextDueDate` → null means past `endDate` → `skippedFuture++` |
| `:167-171` | `next > localDateStr(now, store.timezone)` → `skippedFuture++` |
| `:176` | `dueAt = dueAtFor(store, hoursForDate(store.hours, next), next, event.dueTime)` |
| `:178-192` | `create`, `materialized++`, `P2002` → `raced++` |

**Seams CAL-2 touches, all four inside `:178-192`:**

1. `:137-144` — "the next occurrence is not materialised until the current one
   is completed" must become "…until it is **Completed or Missed**", per ruling
   4. Today the filter is `status: "Open"`, so a `Missed` row already fails to
   match and **this needs no change** — worth stating, because it looks like it
   does.
2. `:150-156` — `afterDate` reads the latest **Completed** `dueDate`. A
   template-backed occurrence that went **Missed** must also advance the cycle,
   or a missed week blocks the next one forever. **This is a real change:**
   `status: { in: ["Completed", "Missed"] }`.
3. `:178-192` — after `create`, call the A1 function to make the Checklist and
   write the link. The `try/catch` already distinguishes `P2002`; the new
   failure mode is *occurrence created, checklist failed*, which the plan says
   rolls the occurrence back. A `prisma.$transaction` around both is the shape
   the PATCH route already uses (`events/[id]/route.ts:97-136`).
4. The counters at `:51-60` and the summer at `:203-210` — `adoptedExisting`
   and any checklist-failure counter must be added in **both** places. The
   comment at `:202` (*"so adding a counter can never mean adding one nobody
   totals"*) is the rule being obeyed, not a decoration.

### The occurrence complete route — `src/app/api/calendar/occurrences/[id]/complete/route.ts`

- `requireCalendar()` **with no capability argument** `:39` — module gate only.
- Store scope `:52-55`, the task-log gate verbatim.
- 409 on already-Completed `:61-63`, and race-proof `updateMany` filtered on
  `status: "Open"` `:88-98`.
- `:105-108`: **"THE NEXT OCCURRENCE IS NOT CREATED HERE (ruling 3)."**
- `:9-30` is a standing instruction not to add `can(actor, "checklists.execute")`
  here.

**Seam:** ruling 3 says *"Completion of the occurrence IS the checklist's
submit; there is no separate tick, and the calendar's Complete control opens the
checklist instead."* So for a **template-backed** occurrence this route must
refuse — a 409-shaped "this reminder is a checklist, open it" — rather than
writing `Completed` and leaving the Checklist untouched. The refusal goes after
the 404 at `:47` and before the store-scope check, because it is a fact about
the row and not about the actor.

### The banner feed — `src/app/api/calendar/due/route.ts`

`requireCalendar("calendar.view")` `:26`; store scope `:34`; per-store "today"
cutoff `:42-46`; query `:48-61` filtered `status: "Open"`, `event: { isArchived: false }`;
response `:78-84` with `items`, `earliestDueAt`, `overdueCount`, `maxDaysOverdue`.

**Seam:** each item needs to carry whether it is template-backed and, if so, the
Checklist id, so the banner can render "Open checklist" as a link instead of an
inline Complete. That is a `select` addition at `:56-59` and a field on the map
at `:63-75` — no query-shape change.

### The detail dialog — `src/app/(app)/calendar/occurrence-detail.tsx`

`EventLike` `:46-61`, `OccurrenceLike` `:63-70`. `canManage` prop `:78`/`:89`.
Edit/Archive block at `:340-360`; the edit body swap at `:173-204`, reusing
`CreateReminderForm` in edit mode.

**Seam:** for a template-backed occurrence, "Open checklist" replaces Complete,
and status renders Open / Completed / **Missed**. `OccurrenceLike.status` is
already a bare `string` (`:66`), so the third value costs nothing structurally.

### The disabled Event tab — `src/app/(app)/calendar/create-reminder-form.tsx`

`:392-408`. `TabsTrigger value="event" disabled title="Coming in CAL-2"` at
`:395-397`, and a `TabsContent` body reading "Coming in CAL-2" at `:400-402`.
The header comment `:10-14` explains why it ships disabled rather than absent,
and `:23-25` records that **the tab pair is create-only** — edit mode renders
the form bare (`if (edit) return form`, `:386`).

**Seam:** enable the trigger, replace the placeholder body. The Event form needs
a template picker and **no** notes/url/attachment fields — those live on the
template. Per `:16-22`, the create form is deliberately *one* component because
"a fork would put the eleven fields, their validation and their layout in two
files". An Event form is a genuinely different field set, so it is a sibling
component under the same tab strip rather than an eleventh prop on this one.

### The grid chip — `src/app/(app)/calendar/calendar-client.tsx`

Chips render at `:355-380` inside the day cell; `completed` at `:356`, `overdue`
at `:357-358`, the Critical `Flag` at `:377`. **Seam:** one more conditional
glyph beside the flag, driven by a `templateId` on `EventRow` (`:36-45`).

### `GET /api/calendar/events` — `src/app/api/calendar/events/route.ts`

Returns `{ stores, events, occurrences }` (`:106-140`); `projectedDates` is
computed per event at `:129`. **Seam:** `templateId` on each event row, and the
Event tab needs a list of active non-Daily templates for the selected stores —
which no calendar route serves today.

### Module gate — `src/lib/calendar-access.ts`

`requireCalendar(capability?)` `:52`; denial reasons `:26`; `resolveStoreScope`
`:118`; 404 for `disabled` so *off means the API does not exist*. Unchanged by
CAL-2, but every new calendar route must go through it.

`/calendar` page guard: `src/app/(app)/calendar/page.tsx:22-40` — org →
`calendarEnabled` redirect `:29` → `getCurrentUser()` → `can(actor, "calendar.view")`.

### `vercel.json` — an ordering fact, not a defect

`calendar-materialize` and `checklist-day-close` are **both `"0 * * * *"`** and
will fire in the same minute. Vercel does not order crons. Today they share no
table; after CAL-2 they share `Checklist`. Neither ordering is wrong — day close
only closes a row whose day-close instant has passed, and a row materialised
this hour has not reached one — but it is worth a comment at the new write site
rather than being rediscovered from a Runtime Log.

---

## A6 — Template archive: what happens to checklists today

**Archiving a template does nothing to any Checklist row.** The write is
`src/app/api/templates/[id]/route.ts:30-32`:

```ts
if ("isArchived" in body && !("tasks" in body)) {
  const updated = await prisma.template.update({ where: { id }, data: { isArchived: body.isArchived } })
  return NextResponse.json(updated)
}
```

One column, nothing cascaded. `isActive` is the same shape at `:25-28`, and
**the two flags have separate controls** — `templates-client.tsx:314` writes
`isArchived` alone, `:308` writes `isActive` alone.

What archiving *does* achieve is stopping generation, and only because the three
applicability filters scope on both flags: `api/checklists/route.ts:154` and
`:209`, and `api/stores/[id]/templates/route.ts:36-37`. That is DEBT-65, ruled
by Gary 2026-08-10 — *"archiving stops generation entirely; archived templates
generate nothing, materialize nothing, and appear in no report going forward"* —
with the measured note that at Keva "archiving" is actually performed with
**Deactivate** (five templates `isActive=false`, zero `isArchived=true` on both
dev and staging, 2026-08-10).

Existing rows are untouched: a Pending checklist under a freshly archived
template stays Pending, stays visible, and — if non-Daily — is never closed.

`DELETE /api/templates/[id]:201-216` is a hard `prisma.template.delete`. The
`Checklist.template` relation (`schema.prisma:682`) declares no `onDelete`, so
Prisma's default for a **required** relation is `Restrict`: deleting a template
that has ever generated a checklist fails at the database. The route does not
catch it, so that surfaces as a 500.

### Ruling 6 beside it

> *Archiving a template-backed event does not archive the template; archiving a
> template archives its events and deletes their Open occurrences.*

The second half is **new behaviour at a site that has never cascaded anything**,
and it is asymmetric with the first half by design. Three things it must
reconcile:

1. **`isActive` is the flag Keva actually uses.** A cascade wired only to
   `isArchived` is aimed at the control nobody touches — the same mistake
   DEBT-65's first fix made and its second ruling corrected. Ruling 6 says
   "archiving"; the measured behaviour says Deactivate is what operators mean by
   it. **RULING NOW #4.**
2. The delete-Open-occurrences half already exists and can be reused verbatim:
   `events/[id]/route.ts:156-157` archives the event and
   `deleteMany({ where: { eventId: id, status: "Open" } })` in one
   `$transaction`.
3. **Un-archiving.** `isArchived` is a toggle, not a one-way door (`bulkAction`
   at `templates-client.tsx:320` restores it). Un-archiving a template cannot
   un-archive its events — the occurrences are gone and the archive was a
   decision. The cascade is therefore one-directional, and that asymmetry should
   be written at the site rather than discovered.

---

## A7 — Existing litter: the SQL, for Gary, before Phase C

**Not run by this session** — CLAUDE.md § Environment Variables bans
`vercel env pull` repo-wide, and deployed-branch reads go through the Neon
console. Run once per live branch: dev `br-broad-wave-a6vpjdw0`,
preview/staging `br-square-feather-a63z92vz`, production
`br-sparkling-block-a620qvg4`. **Do not run it on `preview/main`
`br-purple-rain-a6m62xww`** — archived, month-stale, and DEBT-62 records it
answering queries with clean, plausible, wrong results.

The query carries its own branch id per CLAUDE.md § Database Evidence
("belt and braces"), and names the org by ID, never by name.

```sql
-- CAL-2 A7. DEBT-61 litter: Pending checklists under a non-Daily template.
-- The frequency predicate mirrors dayCloseAppliesTo() in
-- src/lib/checklist-lifecycle.ts:556 exactly — coalesce + btrim, then <> 'Daily'.
SELECT current_setting('neon.branch_id', true)            AS branch,
       c."organizationId"                                  AS org_id,
       coalesce(btrim(t."frequency"), 'Daily')             AS frequency,
       count(*)                                            AS pending_rows,
       count(DISTINCT t.id)                                AS templates,
       count(DISTINCT c."storeId")                         AS stores,
       min(c."date")::date                                 AS earliest,
       max(c."date")::date                                 AS latest
FROM "Checklist" c
JOIN "Template" t ON t.id = c."templateId"
WHERE c."status" = 'Pending'
  AND coalesce(btrim(t."frequency"), 'Daily') <> 'Daily'
GROUP BY 1, 2, 3
ORDER BY 2, 3;
```

A second query, because the adoption path in Phase B collides on
`@@unique([storeId, templateId, date])` and only **today-or-later** rows can
collide with a newly materialised occurrence:

```sql
-- Same litter, split by whether a new occurrence could collide with it.
SELECT current_setting('neon.branch_id', true) AS branch,
       c."organizationId"                       AS org_id,
       CASE WHEN c."date" >= date_trunc('day', now()) THEN 'today-or-later'
            ELSE 'past' END                     AS bucket,
       count(*)                                 AS pending_rows
FROM "Checklist" c
JOIN "Template" t ON t.id = c."templateId"
WHERE c."status" = 'Pending'
  AND coalesce(btrim(t."frequency"), 'Daily') <> 'Daily'
GROUP BY 1, 2, 3
ORDER BY 2, 3;
```

### What to do with the rows — recommendation, not a decision

**Leave them. Delete nothing in this phase.** Reasons, in order of weight:

1. The operations report already excludes them (`:215`) and will keep excluding
   them after CAL-2, because they carry no `calendarOccurrenceId`. They are
   invisible where it matters.
2. **A deletion is a destructive write against three branches, and CLAUDE.md
   § Database Evidence records that a statement composed against one branch
   executes cleanly against its sibling** — the ids are shared, the org guard is
   inert, and there is no error to notice. Litter that harms nothing is not
   worth that exposure.
3. The counts belong in the DEBT-61 closure text as the measured size of what
   the row cost. A number in the row is the durable artifact; the rows
   themselves are not.
4. They become *more* legible after CAL-2, not less: an unlinked Pending
   non-Daily row is, by definition, pre-CAL-2 litter, and the link column is the
   discriminator that did not exist before.

The one thing CAL-2 **does** do with them is adopt on collision: if a
materialised occurrence's (store, template, date) already has a row, link to it
rather than failing, and count it as `adoptedExisting`. That converts a litter
row into a tracked row rather than orphaning a second one beside it.

---

## Scope triage

### FIX NOW

**None.** Nothing found is both broken today and inside this phase's blast
radius. The two things that look like candidates are not:

- The `appliesTo` inference at `template-form.tsx:1053` is latent and agrees
  with the DB today (A4); it is a COMMENT.
- `DELETE /api/templates/[id]` returning a 500 on a `Restrict` violation (A6)
  predates this phase, is unreachable from the archive control, and fixing it
  here would be scope no one asked for. It is a ROW.

### RULING NOW — five, and the first is blocking

**R1 — CAL-1's staging pass is still unrun, and CAL-2 builds directly on the six
unrun checks.** DEBT-61's own rider states the precondition: *"CAL-2 cannot
start until Gary has run CAL-1's migration and the CAL-1 staging pass has
actually happened."* Half is satisfied — `20260917143000_cal1_calendar` is
applied on all three live branches (CAL-1's first blocker, RESOLVED 2026-09-18
in DOCS-4, with evidence per branch). **The other half is not.** CAL-1's second
blocker is still live and DOCS-4's rider lists what remains unobserved: the cron
materialising an occurrence with `dueAt` at store close, the second run
reporting `skippedOpen`, the toggle-off refusals, the PERM-8 grant flipping a
MANAGER's day-click, a STORE account completing an occurrence, and the backdated
overdue banner.

**Three of those six are load-bearing for CAL-2 specifically**: the materialise
cron is where checklist generation is being added, `skippedOpen` is the
"one open at a time" invariant ruling 4 extends to Missed, and STORE completion
is the path ruling 3 replaces with "open the checklist". CAL-2 would be building
on an engine nobody has seen write a row.

This is Gary's call, and there are three honest options: run the CAL-1 pass
first; accept the risk and let CAL-2's own staging protocol cover both at once
(it exercises the cron, completion and the lifecycle end to end, so it
*subsumes* four of the six); or narrow CAL-2. **Recommendation: proceed, with
CAL-2's protocol explicitly covering CAL-1's unrun cron and completion checks,
and CAL-1's blocker retired by that pass rather than separately.** Two staging
passes over the same cron is ceremony; one pass that names both rows is not.
Recorded here rather than assumed, because DEBT-61's rider is the only place the
precondition is written down and a session that quietly walked past it would be
the fourth thing mistaken for progress on that row.

**R2 — `Checklist` has no `completedBy` column, so "completedAt/by copied" has
no source.** (A1.) Three ways out:
1. Copy `completedAt` only, and leave the occurrence's `completedByUserId` null
   for a template-backed row. Honest; the calendar detail view then shows a
   completion with no name.
2. Resolve the attributor from the checklist's `TaskLog` rows — the most recent
   log's `completedByUserId`/`completedByStaffId`. Defensible, and it is a
   *derivation*, so it can disagree with what a human would say (the person who
   ticked the last box is not necessarily the person who did the work).
3. Take the actor from the `submit` request's session. Simplest, truthful about
   who pressed Submit, and it is the same answer the reminder path already
   writes (`complete/route.ts:93`). **Recommended.**
Whichever, the Missed path has no actor at all — day close is a cron — so
`completedByUserId` stays null there and `completedAt` is meaningless. Ruling 4
calls Missed terminal; the occurrence needs a `Missed` timestamp or it reuses
`completedAt` for something that is not a completion. **Recommend a plain
`missedAt`, or reuse `completedAt` and say so loudly at the column.**

**R3 — `submit` is re-runnable and can move a checklist OUT of Completed.**
`api/checklists/[id]/submit/route.ts:68-72` recomputes status from
`completionRate` and critical-task coverage on **every** call, and `:81-83` says
so explicitly: *"un-toggling a task drops the row out of Completed."* So a
template-backed checklist can go Completed → occurrence Completed → cron
materialises the next occurrence → someone un-ticks a task → checklist is
`In Progress` with a Completed occurrence behind it and a second occurrence
open. **"One open at a time" is broken by an ordinary operator action.** Options:
(a) propagate both directions — Completed → Completed and anything-else →
back to Open, which fights the cron that may already have moved on; (b) make the
occurrence's completion **one-way**, matching `complete/route.ts`'s own 409
posture, and accept that un-ticking after submit does not reopen it; (c) refuse
`submit` on a checklist whose occurrence is already Completed (409), which is
the closed-day guard's shape at `:33-36` and the most consistent with CHK-3.
**Recommend (c).** It reuses a refusal the surface already knows how to render,
and it makes the occurrence the thing that closes, which is ruling 3's own
claim.

**R4 — ruling 6's cascade names `isArchived`, but Keva archives with
Deactivate.** (A6.) Measured 2026-08-10 on dev and staging: five templates
`isActive=false`, zero `isArchived=true`. A cascade wired to `isArchived` alone
is correct and inert — DEBT-65's first fix made exactly this mistake and Gary's
second ruling corrected it. Does Deactivate also archive the template's calendar
events? **Recommend: yes, both flags trigger it**, on the same reasoning Gary
gave for DEBT-65 — the three applicability filters read one rule, and a fourth
control that reads a different one is how they drift apart again.

**R5 — the crew list will offer a template the create path now refuses.**
`api/stores/[id]/templates/route.ts:36-52` filters on `isActive`, `isArchived`
and `appliesTo`, **not** `frequency`. Under ruling 1 the single-create path
starts refusing non-Daily templates, so `/store-view` would show a Weekly
template whose "Start" button now fails. **Recommend: the crew list hides a
non-Daily template on days it has no checklist, and shows it normally on days it
does** (the existing `existingToday` join at `:57-62` already provides that
discriminator). That keeps DEBT-65's "the three applicability filters read one
rule" true, restated as: *offer creation only where creation is allowed; show
what exists either way.*

### COMMENT — recorded at the site, no action

- **C1 — `materializesMisses` does not exist.** The CAL-2 prompt names it; the
  symbol has been `dayCloseAppliesTo` since 2026-08-10, and the rename is
  load-bearing rather than cosmetic (`checklist-lifecycle.ts:511-521`). Noted so
  the plan uses the real name.
- **C2 — the two crons share `"0 * * * *"`** and will share the `Checklist`
  table after CAL-2 (A5). Not a defect; a comment at the new write site.
- **C3 — `template-form.tsx:1053` infers `appliesTo` from the assignment list**
  rather than reading the column (A4). Latent, agrees with the DB today. A CAL-2
  dialog must read the template row, not the form state.
- **C4 — `excludedNonDaily` will be counting something its name does not
  describe** once scheduled non-Daily rows are tracked (A3). Rename with the
  copy change.
- **C5 — the `frequency` helper text at `template-form.tsx:1704`** ("Select how
  often this checklist should be automatically created") becomes a half-truth
  for Weekly and Monthly under ruling 1.
- **C6 — `CALENDAR_STATUSES` at `calendar.ts:49` is the single place `"Missed"`
  is added**, and it is a `const` tuple, so the typecheck carries it. No
  separate validation constant is needed.

### ROW — deferred, filed not fixed

- **ROW A — `DELETE /api/templates/[id]` 500s on a `Restrict` violation.**
  `:201-216` calls `prisma.template.delete` with no catch; `Checklist.template`
  defaults to `Restrict`, so deleting any template that ever generated a
  checklist throws a raw error. The operator sees a 500 where they should see
  "this template has history — archive it instead". Pre-existing, unreachable
  from the archive control, out of CAL-2's scope.
- **ROW B — the `appliesTo` inference (C3)** if Gary wants it corrected rather
  than worked around. One line, but it is a behaviour change on a 2188-line form
  at the end of a TIER 3 phase, which is the wrong time.

---

**STOP.** Phase A ends here. No file in `src/`, `prisma/` or `docs/ROADMAP.yaml`
was touched, nothing is committed, and Phase B waits on Gary's answers to
R1–R5 — R1 first, because it decides whether this phase runs at all.
