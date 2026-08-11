# TRAINING AUDIT — Categories + Bulk Assignment pre-phase

**Audit performed:** 2026-08-10
**Repo:** `~/Claude_Projects/Froot/froot`
**Branch:** `staging`
**HEAD at audit:** `f318d2e` (clean tree except the untracked session prompt, which rides this commit)
**Scope:** read-only audit of `TrainingModule` and `TrainingAssignment` — schema, every write path, every read path, the `/hr/training` page anatomy, the `/staff/[id]` assign path, and the compliance rollup's consumption — commissioned by `docs/prompts/2026-08-10_TRAINING_AUDIT_SESSION.md` to prepare the Training Categories + Bulk Assignment phase. No database was queried by this session. No code was changed by this session.

Modeled on `docs/prompts/TYPE-1_AUDIT.md`, which is also this audit's precedent
library: the phase this prepares is deliberately the fourth instance of the
taxonomy pattern TYPE-1 → TPL-1 → TPL-2 just finished proving.

It is a claim wholesale and is not edited afterwards.

---

## 0. Headline

Four sentences carry most of what the phase needs to know:

1. **`TrainingModule.subject` is the category-like field the session prompt
   asked about, and it is live** — an optional free-text input on the builder
   form (placeholder "e.g., Food Safety"), written by all four module write
   paths, rendered as an uncoloured chip on the admin cards, and riding the
   CSV export/import as `module_subject`. **The TPL-1a additive shape applies
   exactly:** new entity + nullable FK, `subject` kept as a mirror during the
   transition, retirement its own later step.

2. **`TrainingAssignment.dueDate` already exists end to end** — schema column,
   accepted by the single-assign POST, editable per-assignment via PATCH,
   rendered on the staff tab and on `/my/training`, and **already consumed by
   the compliance rollup**: past-due and not Completed computes as `overdue`,
   "the loudest gap state" (hr-compliance.ts:13-15). Part 3 is not a schema or
   plumbing job; it is carrying an existing field through a new fan-out — plus
   one semantic question that belongs to HR-13 (§5.3).

3. **There is no unique constraint on module × staff member.** Duplicate
   prevention is application-level skip logic in the single-assign route, and
   the schema's own comment calls an assignment "one staff member's **run**
   through a module" — the door to re-assignment-as-second-run was left
   deliberately ajar. R-b decides whether to close it (§2.2, §10.2).

4. **The bulk-assign entry point has a permission problem the prompt did not
   anticipate:** `/hr/training` — the page the button would live on — is
   **ADMIN-only at the page level**, while assignment creation is
   ADMIN + store-scoped MANAGER at the API level. A MANAGER can assign
   training today, but only from `/staff/[id]`; they cannot see the training
   library page at all. R-c is therefore two questions, not one (§6.2, §10.3).

---

## 1. TrainingModule

### 1.1 Schema at HEAD

`prisma/schema.prisma:1869-1888`:

```prisma
model TrainingModule {
  id             String   @id @default(cuid())
  organizationId String
  title          String
  subject        String?                              // ← the category-like field
  description    String?
  appliesTo      String   @default("all") // all | selected (store assignments below)
  isActive       Boolean  @default(true)
  isArchived     Boolean  @default(false)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  ...
  @@index([organizationId])
}
```

No index on `subject`, no unique constraint mentioning it, no enum, no
canonical list, no Zod enum — free text by omission, the same state
`Template.type` was in at TYPE-1, **with one structural difference that
matters for the entity design: `subject` is nullable and optional where
`Template.type` was `NOT NULL` with no default.** A module with no subject is
legal today and common in the UI (the chip simply doesn't render). TPL-1
shipped a *required* Type select because the column was required; a required
Category select here would be a policy change, not a faithful port — flagged
as a decision inside R-a (§10.1).

Satellite models:

- `TrainingModuleStoreAssignment` (:1890-1899) —
  `@@unique([trainingModuleId, storeId])`, cascade both ways. This is the
  `appliesTo: "selected"` mechanism.
- `TrainingLesson` / `TrainingResource` / `TrainingQuiz` (:1901-1935) —
  content; cascade from module.
- **No cascade from module to `TrainingAssignment`** (:1937-1938, comment:
  "completed/certified assignments are records") — module delete is blocked by
  the route once any assignment exists (§1.3, DELETE).

### 1.2 Every write path — five, mapped by reading each file

| # | Path | Guard | What it writes |
|---|---|---|---|
| 1 | `POST /api/hr/training` (route.ts:85-147) — builder create + Duplicate | ADMIN (`requireHrTrainingAccess`) | `subject: body.subject \|\| null` (:112); nested lessons/resources/quiz; `storeAssignments` from `body.storeIds` (:139-141) |
| 2 | `PATCH /api/hr/training` (route.ts:66-82) — bulk archive/activate | ADMIN | `isActive` / `isArchived` only, org-scoped `updateMany` |
| 3 | `PATCH /api/hr/training/[id]` ([id]/route.ts:57-168) — status flip or full builder save | ADMIN | `subject: data.subject \|\| null` (:150); lesson diff transaction; **wipe-and-recreate** store assignments (:123, :155-157) |
| 4 | `POST /api/hr/training/import` (import/route.ts:45-79) | ADMIN | `subject: m.subject` (:59) from CSV `module_subject` (csv.ts:194); arrives `isActive: false`, `appliesTo: "all"` (:61-62) |
| 5 | `DELETE /api/hr/training/[id]` ([id]/route.ts:172-192) | ADMIN | Delete, **blocked with a 409 once `trainingAssignment.count > 0`** (:180-188) — "archive it instead" |

Duplicate is not a separate path: `training-client.tsx:125-154` composes a
full POST body client-side, `subject` included (:132) — the same shape TYPE-1
§4 recorded for templates.

**Finding, recorded not fixed (triage §9): write paths 1 and 3 do not
validate `storeIds` against the org.** `route.ts:106` and `[id]/route.ts:86`
take `body.storeIds` and create `TrainingModuleStoreAssignment` rows from
them raw (:139-141, :155-157). PERM-7's rule — validate storeIds on every
write — was applied to staff/user/forecasting writes and never reached these
two. Blast radius is soft: both routes are ADMIN-only and the module row
itself is org-scoped, so the damage is a foreign or nonexistent store id
sitting in an org's applicability list — which silently shrinks the module's
reach (a "selected" module whose ids match nothing is offered to nobody via
the `/staff` assignable filter, §4.2) rather than leaking anything. But the
bulk-assign phase is about to make store ids first-class input on this very
surface, and PERM-6's lesson was to build the validation in on day one.

### 1.3 Every read path

| # | Site | What it reads |
|---|---|---|
| 1 | `GET /api/hr/training` (route.ts:53-63) | Full modules incl. lessons/resources/quiz/storeAssignments — feeds the entire `/hr/training` client (§3) |
| 2 | `GET /api/hr/training/[id]` ([id]/route.ts:40-51) | One full module — builder edit page loader (`[id]/edit/page.tsx:44` maps `subject`) |
| 3 | `/staff/[id]` assignable-modules query (staff page.tsx:391-403) | `isActive: true`, `isArchived: false`, `appliesTo: "all"` OR store-assignment overlap with the member — the **applicability filter** (§4.2) |
| 4 | `/my/training` (page.tsx:16-31) | Via assignment include; **selects `subject` (:22) and never renders it** — a wire-only carry, TYPE-1 §3.2's species exactly |
| 5 | `/my/training/[assignmentId]`, `/hr/training/[id]/preview` | Module content for the execution/preview renderer (HR-7/HR-17 — out of this phase's scope) |
| 6 | `GET /api/hr/training/export` (export/route.ts, csv.ts:52) | `module_subject` cell in the CSV |
| 7 | Compliance rollup (hr-compliance.ts:182-184) | `title` + lesson ids only — **the rollup never reads `subject`** |

Nothing anywhere filters, sorts, groups, or branches on `subject` — the
`/hr/training` page's only filters are the Active/Archived tabs
(training-client.tsx:88). Like `Template.type` at TYPE-1, the field's one job
today is printing a word — on exactly **one** screen (the admin card chip,
training-client.tsx:290-294), since `/my/training` selects it and drops it.

### 1.4 What the categories entity inherits from the satellites

`appliesTo`/`TrainingModuleStoreAssignment` is a *scoping* taxonomy that
already exists and must not be confused with the new *labeling* taxonomy.
A category says what kind of training a module is; `appliesTo` says which
stores' staff can be offered it. The card renders both chips side by side
today (subject chip + "N stores"/"All stores" chip, :289-298). Keep them
separate entities and separate chips.

---

## 2. TrainingAssignment

### 2.1 Schema at HEAD

`prisma/schema.prisma:1939-1966`:

```prisma
model TrainingAssignment {
  id                String    @id @default(cuid())
  trainingModuleId  String
  staffMemberId     String
  assignedByUserId  String
  trainerUserId     String?
  dueDate           DateTime?          // ← :1945 — ALREADY EXISTS
  status            String    @default("NotStarted") // NotStarted | InProgress | Completed
  hoursLogged       Float?
  certifiedAt       DateTime?
  certPdfPathname   String?
  certPdfHash       String?
  certifiedByUserId String?
  trainerTypedName  String?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  ...
  @@index([staffMemberId])
  @@index([trainingModuleId])
}
```

**Answering the session prompt's two direct questions:**

- **`dueDate` already exists** (:1945), nullable, no default — DEBT-59-clean
  by construction.
- **There is NO unique constraint on `(trainingModuleId, staffMemberId)`** —
  two plain indexes (:1964-1965), nothing compound. The schema comment
  (:1937-1938) frames a row as "one staff member's **run** through a module",
  which reads as deliberate room for a future second run. Nothing in the code
  creates one today (§2.2).

Capture satellites (HR-7, and HR-18's future surface):

- `TrainingLessonProgress` (:1968-1985) —
  `@@unique([trainingAssignmentId, trainingLessonId])`, `authMethod
  HrAuthMethod?` (`ClerkSession` | `ManagerAttested`), cascade from
  assignment. Append-only in practice.
- `TrainingQuizAttempt` (:1993-2012) — append-only by design comment
  ("after create, the only write ever allowed is the written-answer review
  block"), questions snapshot frozen at submit, **no cascade** — attempts are
  records.

**`TrainingAssignment` has no `signingCycle`.** The HR-15b cycle mechanism
exists only on the signing side (`StaffMember.signingCycle` :270,
`HrSignedRecord.signingCycle` :1723, consumed at hr-compliance.ts:214-231).
Training re-assignment on rehire was never modeled; the R-b packet carries
what that precedent does and does not transfer (§10.2).

### 2.2 Every write path — eight

| # | Path | Guard | What it writes |
|---|---|---|---|
| 1 | `POST /api/hr/training/assignments` (route.ts:17-66) — **the assign path** | ADMIN / scoped MANAGER (`requireHrTrainingManageAccess`) | `createMany` of (module, staff, assignedBy, trainer?, dueDate?) — full anatomy in §4.1 |
| 2 | `PATCH /api/hr/training/assignments/[id]` ([id]/route.ts:32-61) | same, per-assignment scope re-check | `trainerUserId`, **`dueDate`**, `hoursLogged` — metadata only; the comment bars progress/cert fields from this path |
| 3 | `DELETE /api/hr/training/assignments/[id]` ([id]/route.ts:66-88) | same | Delete, **409-blocked if any lessonProgress, quizAttempts, certifiedAt, or certPdfPathname exist** (:74-84) — "mistake correction only" |
| 4 | `POST .../[id]/certify` (certify/route.ts:54-64) | same | Race-guarded once-only `certifiedAt`/`certifiedByUserId`/`trainerTypedName` stamp; re-derives Completed before stamping (:41-47) |
| 5 | `ensureTrainingCertPdf` (hr-signed-pdf.ts:889-899) | called by 4 and the certificate download | Write-once `certPdfPathname`/`certPdfHash` pointer (HR-5 race rule) |
| 6 | `recalcAssignmentStatus` (lib/training.ts:10-36) | called by every capture route | Derives `status` from lessons + quiz; writes only on change |
| 7 | Capture routes, manager side — `.../[id]/lessons/[lessonId]`, `.../[id]/quiz-result`, `.../attempts/[attemptId]/review` | manage tier + per-member scope check | lessonProgress / quizAttempt rows (`ManagerAttested`), then recalc |
| 8 | Capture routes, self side — `/api/my/training/[assignmentId]/lessons/[lessonId]`, `/quiz` | `getActiveStaffSelf` (ACTIVE staff, own assignment only) | lessonProgress / quizAttempt rows (`ClerkSession`), then recalc |

**What a duplicate assign does today:** the POST loads existing assignments
for the member × requested modules (:48-51), skips any module already
assigned (:52-53), and reports `{ created, skipped }` (:65). Skip is
app-level only — with no compound unique constraint, `createMany` has no DB
backstop, and two concurrent requests for the same pair can both pass the
read and both insert. Nothing downstream breaks on a duplicate pair (the
staff tab and `/my` render lists; compliance maps each row to its own item)
— but each duplicate **inflates the member's compliance denominator** (§5.2),
so a race-made duplicate quietly lowers a person's percentage.

### 2.3 Every read path

| # | Site | What it reads |
|---|---|---|
| 1 | `/staff/[id]` Training tab loader (staff page.tsx:365-390, serialized :412-461) | Full assignments incl. progress, attempts, `dueDate` (:418) |
| 2 | `/staff/[id]` assignable filter (:462-463) | Assigned module ids — subtracts them from the offer list |
| 3 | `/my/training` list ((my)/my/training/page.tsx:16-31) | Own assignments; renders status badge, progress bar, `Due …` line (:77) |
| 4 | `/my/training/[assignmentId]` + `/my` home | Own single assignment for execution; `/my` home shows summary |
| 5 | Compliance rollup (hr-compliance.ts:176-188) | ALL assignments for the staff set, org-scoped through the module relation — §5 |
| 6 | Certificate download route (`.../[id]/certificate`) | cert pointer; dual-tier (manage OR self via `getActiveStaffSelf`) |
| 7 | `findManageableAssignment` (assignments/[id]/route.ts:8-20) | Scope resolver: assignment → module org + member store overlap |
| 8 | Module DELETE guard ([id]/route.ts:180-182) | `count` — the existence of any assignment freezes the module |

No API endpoint lists assignments **by module** today. The bulk-assign
dialog's natural read — "who already has this module?" — exists nowhere and
will be a new query (indexed: `@@index([trainingModuleId])` :1965 is already
there for it).

---

## 3. The /hr/training page anatomy

### 3.1 Server/client split

- `page.tsx` (21 lines) — server shell, gate stack only: Clerk auth →
  `hrModuleAvailable(orgId)` → `notFound()` (availability gate) →
  `activeModules.includes("hr")` → redirect `/hr` (per-org toggle) →
  **`dbUser?.role !== "ADMIN"` → redirect `/hr` (page.tsx:18)**. It fetches
  no data and passes no props.
- `training-client.tsx` (324 lines) — `"use client"`; fetches
  `GET /api/hr/training` in a `useEffect` (:76-86), holds ONE `modules` state
  array. Everything on screen derives from it.

**The one-data-source requirement for Part 4 is nearly free by construction:**
there is exactly one fetch and one state array; the card grid (:270-318) is
the only rendering of it. A list view is a second rendering of `visible`
(:88) — the derivation (`modules` → tab filter → `visible`) stays shared, and
DEBT-26-style drift (per the discipline recorded in CHK-1's row,
ROADMAP.yaml:1030-1035 — the id it cites is a non-resolving pointer, ruled
COMMENT NOT A ROW 2026-08-10; the principle's real evidence is
`src/lib/sections.ts` and TYPE-1's six-derivations story) has nowhere to
start **unless the list view fetches its own data. It must not.**

### 3.2 What exists on the page today

- **Tabs:** Active/Archived with counts (:180-191), filtering on
  `isArchived` alone (:88). The "Active" tab therefore shows Inactive
  (deactivated) modules — the DEBT-67 naming pattern, survivable here because
  each card wears an explicit Active/Inactive badge (:282-284). The Part 4
  session reworks this exact strip; note it, don't fix it now (§9).
- **Selection + bulk action bar** (:72, :90-121, :194-239): checkbox per
  card, Select All over the visible tab, bulk Deactivate/Activate/Archive
  (AlertDialog-confirmed) through `PATCH /api/hr/training`. **A bulk-action
  precedent already lives on this page** — the bulk-assign UI is not the
  page's first plural verb.
- **Card markup** (:271-318): checkbox + icon; Active badge; title;
  **subject chip (uncoloured, :290-294)** + applies-to chip (:295-297);
  lessons/quiz count line; Edit + Duplicate buttons. This block is what a
  list row must re-render 1:1 — same fields, same actions, plus whatever the
  phase adds.
- **Header actions:** Export, Import, Create Module (:168-177).
- **No search, no filter beyond the tabs, no pagination.** The full-include
  payload (lessons + resources + quiz + store assignments per module) is
  heavy for a list view's needs but is one request; leave the shape alone
  unless it measurably hurts.

### 3.3 Where the phase's pieces land

- **Category badges:** the subject chip's slot (:290-294), recoloured through
  `BADGE_PRESETS` (§7.1).
- **Filter chips:** between the tab strip and the grid; counts should be
  per-view (the TPL-1 ruling — chips count what clicking shows; the manage
  dialog counts org-wide + archived-inclusive because it governs deletion,
  ROADMAP.yaml TPL-1 row, "TWO COUNTS, DELIBERATELY DIFFERENT").
- **Manage Categories:** a dialog from the page header — the third instance
  of `category-manager-dialog.tsx` (ingredients) →
  `type-manager-dialog.tsx` (templates). Gary already ruled management lives
  WITH the list for templates; the session prompt says assume the same here.
- **View toggle:** beside the tabs; both views read `visible`; the Bulk
  Assign affordance renders in both card and row (Part 4's both-views rule).

---

## 4. The /staff/[id] assign path

### 4.1 The write, end to end

UI: `staff-training.tsx` Assign dialog — module checkbox set, optional
trainer select (:418), **optional due date** (`<Input type="date">` :433),
posted as noon-normalized ISO (`new Date(\`${dueDate}T12:00:00\`)` :156 — a
convention the bulk dialog should copy so a date means the same thing on both
paths).

API: `POST /api/hr/training/assignments` (assignments/route.ts):

1. **Guard** — `requireHrTrainingManageAccess()` (access.ts:43-76):
   availability gate → org toggle → `getCurrentUser()` → role must be ADMIN
   or MANAGER (:65). Returns `storeIds` from `dbUser.storeAssignments`
   (:74) — the same derivation `getUserStoreScope()` makes (lib/auth.ts:169-177);
   the helper is inlined, not bypassed.
2. **Body** — Zod: ONE `staffMemberId`, 1-100 `trainingModuleIds`, optional
   trainer, optional `dueDate` (:6-11). **The existing shape is one person ×
   many modules; bulk assign inverts it to one module × many people.**
3. **Target scope** — `findManageableStaffMember` (access.ts:81-94): org
   match, then MANAGER must share a store with the member (:90-92); null →
   404 ("don't leak existence").
4. **Terminated** — refused 409: "Cannot assign training to a terminated
   staff member" (:29-31).
5. **Module scope** — org-scoped `findMany`, `isArchived: false`; a foreign
   or archived id is **silently dropped** (:33-38).
6. **Trainer validation** — org-scoped ADMIN/MANAGER user or 400 (:40-46).
7. **Duplicates** — skipped app-side (:48-53); §2.2.
8. **Write** — `createMany` (:55-63); response `{ created, skipped }` (:65).

### 4.2 What the API does NOT enforce (the UI does it instead)

Two gaps between the offer list and the acceptance check, both relevant to
what the bulk route must decide to enforce:

- **`isActive` is not checked.** The page's assignable list requires
  `isActive: true` (staff page.tsx:394) and the archive dialog's copy
  promises "can no longer be assigned" only for *archived* — but the API
  accepts an id for an **inactive** module (only `isArchived: false` at :36).
  UI never offers it; API never refuses it.
- **Module applicability (`appliesTo`/store assignments) is not checked.**
  The offer list intersects module store-assignments with the member's stores
  (staff page.tsx:396-399); the API will happily attach a `selected`-scope
  module to a member at none of its stores.

Neither is exploitable beyond ADMIN/MANAGER doing odd things to their own
org, but the bulk route repeats these decisions at 150× volume: it must
either enforce active + applicability server-side (and report the exclusions)
or knowingly inherit the gap. §10.4 carries this into R-d.

### 4.3 The response-shape lesson, applied to the path that exists

`{ created, skipped }` reports two of the three things that happened —
modules dropped by the org/archive filter (:36) vanish without a trace:
`created + skipped ≠ requested` and nothing says why. This is precisely
CHK-3's counter lesson (ROADMAP.yaml CHK-3 row, defect rider 2026-08-10: **"A
FIELD'S NAME IS NOT EVIDENCE OF WHAT IT COUNTS"** — a response field that
counted a true and nearly useless thing let a check pass over twenty-four
fiction rows). The bulk response must sum to its input: assigned +
already-assigned + skipped-with-reason = requested, per recipient and in
total. The single-assign path's shape is the counter-example to copy *from*,
not to copy.

---

## 5. The compliance rollup's consumption

### 5.1 How HR-8 computes (hr-compliance.ts)

Live-computed on every read, no snapshots (:1-3). One query pulls ALL
assignments for the staff set, org-scoped through the module relation
(:176-188). Per member, per assignment (:299-303):

```ts
if (a.status === "Completed")            status = "complete"
else if (a.dueDate && a.dueDate < now)   status = "overdue"     // ← :301
else if (a.status === "InProgress")      status = "in-progress"
else                                     status = "not-started"
```

Then `items = [...docItems, ...trainingItems]`, `requiredTotal = items.length`,
`pct = completed/requiredTotal` (:317-333). Consumers: `/hr/compliance` page
(ADMIN + MANAGER, compliance page.tsx:25), the `/staff` list column, the
`/staff/[id]` Compliance tab, and the member's own `/my` home.

### 5.2 Where due-date semantics already land

`dueDate` is **already load-bearing in compliance**: it is the only input
that produces `overdue`, and `overdue` outranks `in-progress` (an in-progress
assignment past due reads overdue). What `dueDate` does NOT do today is gate
**membership in the denominator**: every assignment counts against
`requiredTotal` from the instant it is created (:317-318), due date or none,
due date future or past.

**Consequence the phase must surface before anyone presses the button:**
bulk-assigning one module to ~150 staff drops every affected member's
compliance percentage — and every store rollup and the org headline number —
at the moment of assignment, even with a due date three months out. Every
number on `/hr/compliance` moves at once. That is arguably correct ("assigned
means expected") and arguably terrible ("nobody is out of compliance on work
that isn't due"), and that argument has an owner already:

### 5.3 Whether Part 3 fires HR-13's trigger

HR-13 (`planned`, ROADMAP.yaml:2983-2987) is a **bare row** — title only:
"Compliance drill-down + exclude-until-due training semantics." No notes, no
spec; the semantics are reserved by name alone. The reading consistent with
the code: *exclude-until-due* = an assignment with a future `dueDate` stays
out of `requiredTotal` (or out of the gap states) until the date arrives.
That is a change to §5.1's status ladder and denominator — hr-compliance.ts,
HR-13's file — and **not one line of it is needed to ship bulk assignment.**

**Verdict for the ruling packet (§10.5): Part 3 as shipped scope stays
independent of HR-13 — the field exists, the fan-out carries it, compliance
already reads it. But Part 3 at Keva's scale is the event that makes HR-13's
question urgent**, because the one-at-a-time flow never moved 150 denominators
in one click. The phase should ship with eyes open: either Gary accepts the
day-one dip as correct, or HR-13 gets scheduled adjacent to the bulk session
— inside HR-13's row, not smuggled into this phase.

### 5.4 The HR-15b precedent, checked for R-b

Signing cycles key signature validity to the member's current tenure
(`versionId:staffId:cycle` maps, hr-compliance.ts:214-231; Policy B — rehires
re-sign). **The mechanism is entirely on the signing side; training has no
cycle column and the rollup never consults `signingCycle` for training
items.** What transfers is the *shape* — "a new obligation is a NEW ROW; old
rows stay auditable" — not any code. A future "re-assign after rehire /
annual re-certification" would mint a second assignment row (the schema's
"run" framing already permits it), at which point a compound unique
constraint on (module, staff) would be in the way. R-b's options price this
in (§10.2).

---

## 6. Permission surface at head

### 6.1 The inline pattern the new routes must match (R-e)

The training API's guards are shared helpers with inline role tests —
`requireHrTrainingAccess` (ADMIN, access.ts:32-34) and
`requireHrTrainingManageAccess` (ADMIN|MANAGER + storeIds, :64-75) — plus
`findManageableStaffMember` for per-target scope (:81-94). No `can()`
capability names any hr.* surface; HR-19 (planned, not started) owns that
migration. PERM-5C's boundary marker is verbatim at
`staff/[id]/page.tsx:102-107`: the HR tabs are "DELIBERATELY LEFT ON THE ROLE
CHECK … Migrating them onto hr.* capabilities here would start that phase in
the one file least likely to be reviewed as part of it."

**The bulk-assign route should be one more `requireHrTrainingManageAccess`
caller (or a sibling helper in the same access.ts), and the category CRUD
routes one more `requireHrTrainingAccess` caller — zero registry edits, zero
new capabilities.** The audit found no argument against R-e's presumption;
building inside access.ts means HR-19 later migrates one seam instead of
scattered checks.

### 6.2 Who can do what today (R-c's baseline)

| Surface | ADMIN | MANAGER | STORE | EMPLOYEE/self |
|---|---|---|---|---|
| `/hr/training` page | ✔ | ✘ redirect (page.tsx:18) | ✘ | ✘ |
| Module CRUD / import / export APIs | ✔ | ✘ 403 | ✘ | ✘ |
| Assign (POST assignments) | ✔ org-wide | ✔ own-store staff | ✘ 403 (access.ts:65) | ✘ |
| Assignment PATCH/DELETE, captures, certify | ✔ | ✔ scoped | ✘ | ✘ |
| `/hr/compliance` page | ✔ | ✔ (page :25) | ✘ | ✘ |
| `/my/training` execution | — | — | — | ✔ own, ACTIVE only |

So "match the existing single-assign path" for bulk assign = **ADMIN +
store-scoped MANAGER, STORE excluded** — which matches Gary's stated
instinct. But the *entry point* complicates it: the button lives on a page
MANAGER cannot open. HR-18's prompt is the tiebreaker-adjacent fact — it
plans STORE as a *supervising* identity for capture (prompt :30-33) while
never giving STORE assignment powers; the distinction between "can witness
training" and "can create training obligations" is already drawn there.
Options priced at §10.3.

---

## 7. Precedents to carry (settled — do not re-litigate)

1. **Colour = badge-preset KEY, never a class string.**
   `src/lib/badge-presets.ts` — eight presets, `unknownPreset()` neutral
   fallback; the file header restates the Tailwind-4 scanner argument and
   bans interpolation. TYPE-1 §7 is the underlying constraint. The category
   entity stores `colorKey String @default("gray")` exactly like
   `TemplateType` (schema.prisma TemplateType block, incl. the `active`
   no-writer comment — do not copy `active` here; it is TPL-1's open question,
   not a pattern).
2. **The entity shape** — fourth instance: `IngredientCategory`, `LossReason`,
   `TemplateType` (TYPE-1 §8). `@@unique([organizationId, name])`,
   `sortOrder`, org relation. FK on the categorized row: **nullable**,
   `ON DELETE RESTRICT` (TPL-1a's choice) with delete-blocked-while-in-use +
   reassign in the UI.
3. **Manage dialog with the list it categorises** —
   `inventory/ingredients/category-manager-dialog.tsx` →
   `templates/type-manager-dialog.tsx` (ruled for templates; assume here).
   Copy the newer of the pair: TPL-1 recorded that the older one 500s on
   malformed body and duplicate name where `api/template-types` uses
   safeParse + 409 (TPL-1 row, "THE PRECEDENT WAS COPIED BUT NOT WHOLESALE").
   Rename shows affected count first; delete blocked while in use with
   reassign offered (TPL-1 staging walkthrough items).
4. **Starter seed, the DEBT-59-clean way** — `src/lib/template-types.ts`:
   `STARTER_*` constant + idempotent `ensure*` called from both org-upsert
   webhook sites, plus the migration seeding existing zero-count orgs.
   "RENAMEABLE, DELETABLE DEFAULTS an operator can see and change" is the
   line that distinguishes it from the DEBT-59 failure mode. One deliberate
   divergence to decide in R-a: TPL-1's seed was *forced* by a required
   select; if Category stays optional, a starter set is a convenience, not a
   necessity — it can still ship, but its justification is different and an
   empty-category state must render sanely regardless.
5. **Two counts, deliberately different** — manage dialog counts org-wide +
   archived-inclusive (governs delete); filter chips count per-view (govern
   clicking). TPL-1 row, Gary Q1.
6. **Blast-radius reporting** — CHK-3's "a field's name is not evidence of
   what it counts"; response sums to its input (§4.3).
7. **Scope validation on day one** — PERM-6/PERM-7: every submitted staff or
   store id resolved against org AND caller scope server-side; prefer writes
   that report what they touched.
8. **The additive migration shape** — TPL-1a's migration
   (`20260808103000_tpl1a_template_type_entity`): create entity, index,
   nullable FK, seed starters for zero-count orgs, backfill links from the
   legacy string, keep writing the mirror. TPL-2 §§1-2 then end the mirror's
   readers; the drop is a third, separately-ruled step. `subject` follows the
   same arc with one wrinkle: it is optional, so "backfill" means seeding a
   category per distinct non-null `(org, subject)` and linking those rows —
   null-subject modules simply stay uncategorized (no invented value —
   DEBT-59).
9. **UX-2's localStorage caveat** — ROADMAP.yaml UX-2 row: localStorage is
   origin-scoped, outlives logout, worst on shared devices; "KEY IT BY USER
   ID (or clear on sign-out)" is that row's own remedy for real state. §10.6
   applies it to a cosmetic toggle honestly.

---

## 8. Blast-radius SQL — for Gary, per branch, before the schema session

Branch id selected inside each query per CLAUDE.md § Database Evidence. Run on
dev, staging, production; never `br-purple-rain`.

**8.1 The category seed source — distinct subjects per org:**

```sql
SELECT current_setting('neon.branch_id', true) AS branch,
       m."organizationId" AS org_id,
       m."subject",
       COUNT(*) AS modules
FROM "TrainingModule" m
GROUP BY 1, 2, 3
ORDER BY 2, 4 DESC;
```

Answers: how many category rows the backfill would mint per org (one per
distinct non-null subject), how many modules stay uncategorized (null rows),
and whether near-duplicate spellings exist ("Food Safety" vs "food safety" —
the DEBT-2 audit's btrim/lower comparison is worth adding if raw values look
suspicious).

**8.2 Duplicate assignment pairs (R-b's empirical base + constraint feasibility):**

```sql
SELECT current_setting('neon.branch_id', true) AS branch,
       a."trainingModuleId", a."staffMemberId", COUNT(*) AS rows
FROM "TrainingAssignment" a
GROUP BY 1, 2, 3
HAVING COUNT(*) > 1;
```

Expected zero (skip logic has no known bypass). Any hit is a race artifact —
and a blocker for adding a compound unique constraint without a cleanup step.

**8.3 dueDate usage in the wild (how real the overdue state is today):**

```sql
SELECT current_setting('neon.branch_id', true) AS branch,
       COUNT(*)                                          AS assignments,
       COUNT(*) FILTER (WHERE "dueDate" IS NOT NULL)     AS with_due,
       COUNT(*) FILTER (WHERE "dueDate" < now()
                          AND status <> 'Completed')     AS overdue_now
FROM "TrainingAssignment";
```

**8.4 Recipient-population shape (R-d's denominators):**

```sql
SELECT current_setting('neon.branch_id', true) AS branch,
       s."organizationId" AS org_id,
       COUNT(*)                                        AS active_staff,
       COUNT(*) FILTER (WHERE s."isCorporate")         AS corporate,
       COUNT(*) FILTER (WHERE s."userId" IS NULL)      AS no_login
FROM "StaffMember" s
WHERE s.status = 'ACTIVE'
GROUP BY 1, 2;
```

---

## 9. Out-of-scope findings — triage

Per the session prompt: nothing fixed this session; FIX NOW records intent
only.

| # | Finding | Evidence | Triage |
|---|---|---|---|
| 1 | Module POST/PATCH write `storeIds` into `TrainingModuleStoreAssignment` with no org validation — PERM-7's class, unreached by PERM-7 | api/hr/training/route.ts:106,139-141; [id]/route.ts:86,155-157; §1.2 | **ROW** — latent, ADMIN-only, self-harm-shaped; deserves a debt row so the class stays closed. Cheap to fix in the same session that adds category routes to these files, if Gary prefers a rider. |
| 2 | Assign API accepts INACTIVE modules the UI never offers (only `isArchived` filtered) | assignments/route.ts:36 vs staff page.tsx:394; §4.2 | **RULING NOW (folded into R-d/§10.4)** — the bulk route must pick a rule; the single path should then match it. Not a standalone row while the phase that decides it is being scoped. |
| 3 | Assign API ignores module `appliesTo` store scoping (UI enforces) | assignments/route.ts vs staff page.tsx:396-399; §4.2 | **RULING NOW (same packet)** — same reasoning as #2. |
| 4 | Single-assign response drops org-foreign/archived module ids from its own arithmetic (`created + skipped ≠ requested`) | assignments/route.ts:36,65; §4.3 | **COMMENT NOT A ROW** — the bulk session builds the correct shape; retrofitting the single path is a two-line follow-on there. |
| 5 | `/my/training` selects `subject` and never renders it (wire-only carry) | (my)/my/training/page.tsx:22; §1.3 | **COMMENT NOT A ROW** — the category phase touches this exact select; carry or cut it there. |
| 6 | `/hr/training` "Active" tab counts `!isArchived` (shows Inactive modules) — DEBT-67's naming pattern, mitigated by the per-card badge | training-client.tsx:88,188; §3.2 | **COMMENT NOT A ROW** — Part 4 reworks this strip; decide the tab semantics in that session. |
| 7 | No unique constraint backing the duplicate-skip; concurrent requests can double-insert and quietly deflate a member's compliance % | §2.2, §5.2 | **RULING NOW** — this IS R-b; not separately filed. |

---

## 10. Ruling packets (R-a — R-f) and the proposed split

*(Also delivered in the session report; recorded here so the transcript is
not the only home — DEBT-45's rule.)*

### 10.1 R-a — Phase ids and split

**Numbering evidence.** Training rows live inside HR- (HR-6, HR-7, HR-17,
HR-18); HR-19 took the last number. The labor track's lesson
(ROADMAP.yaml:3174-3180) is "never a third numbering of an existing thread" —
and a TRN- prefix would be a *second* numbering of a thread already numbered
HR-. HR-19's own note shows the house pattern for lineage: file under the
track's sequence, cite the lineage inside the row.

**Recommendation:** continue HR- — **HR-20, HR-21, HR-22** — one row per
session below, each row citing this audit.

**Proposed split (sizes in the board's S/M/L vocabulary):**

- **HR-20 — TrainingCategory entity + wiring (M).** Schema (fourth instance:
  `@@unique([organizationId, name])`, `colorKey`, `sortOrder`; nullable
  `TrainingModule.categoryId` FK, `ON DELETE RESTRICT`); hand-authored
  migration seeding per-org categories from distinct non-null `subject`
  values and linking modules (8.1's SQL runs first); starter seed for
  zero-category orgs (constant + `ensure*` + both webhook call sites, the
  template-types.ts shape); Category select on the builder form replacing the
  free-text subject input; `subject` kept written as the mirror (TPL-1a
  contract); CSV `module_subject` resolved by name case-insensitively,
  creating missing categories (TPL-1b Q4 behaviour). **Decision inside this
  ruling: does Category become REQUIRED on create/edit (the prompt's "a
  category is assigned" reading), or stay optional as `subject` is today?**
  Required forces a choice on every legacy edit of an uncategorized module
  and makes the starter seed load-bearing (TPL-1's situation); optional is
  the faithful port of the column's nullability and keeps DEBT-59 trivially
  satisfied. The audit takes no side; the form work is identical either way.
- **HR-21 — Category management + chips + card/list toggle (M).** Manage
  Categories dialog (create/rename-with-count/recolor/delete-blocked-with-
  reassign; org-wide archived-inclusive counts), filter chips (per-view
  counts, composing with the tabs), the list view + toggle (both views off
  the single `modules` state; every affordance in both). Rides together
  because all of it is one file's rework (training-client.tsx, 324 lines).
- **HR-22 — Bulk assign + due date (M).** New route (one module × many
  recipients; individual staff ids, store ids, or all-in-scope), every id
  validated against org AND caller scope server-side; terminated/corporate/
  duplicate/inactive/applicability handling per R-b/R-d rulings; response
  reporting assigned / already-assigned / skipped-with-reason summing to the
  request; dialog reachable from card AND list row; optional due date
  (noon-normalized, matching staff-training.tsx:156), no default. UI reuses
  the page's existing selection precedent.
- **Part 3 beyond the field: no session.** The dueDate column, write path,
  and compliance consumption all exist; what remains is HR-13's semantic
  question (§10.5), which is a ruling, not a build.

Dependency: HR-21 needs HR-20's entity. HR-22 needs neither (it can ship
against today's schema) — sequence it last anyway so its dialog can show
category badges, or run it second if the entity session slips; it is
genuinely independent.

### 10.2 R-b — Duplicate handling on bulk assign

**Facts:** No DB constraint (§2.1); single path skips app-side and reports
`{created, skipped}` (§2.2); a duplicate pair, if ever created, double-counts
in the compliance denominator (§5.2); DELETE refuses once progress exists;
progress/attempt rows are append-only records; HR-15b's cycle precedent is
signing-side only and its transferable shape is "new obligation = new row,
old rows stay auditable" (§5.4); HR-18 will hang supervised-capture evidence
off existing progress/attempt rows (prompt :67, :118).

**Options:**
- **(i) Skip, reported** — mirrors today's semantics at bulk scale;
  idempotent re-runs (assign to "everyone", run again next week, only new
  hires get rows). Cost: an operator cannot force a re-run through this flow.
- **(ii) Re-assign = create a second row** — the schema's "run" framing
  supports it; compliance counts both rows (old Completed one stays
  complete, new one starts NotStarted — % drops until redone), and every
  list surface shows two entries with no cycle label to tell them apart.
  Cost: surfaces need disambiguation work not scoped here; forecloses the
  compound unique constraint.
- **(iii) Reset progress** — deleting lessonProgress/quizAttempts collides
  head-on with the records architecture (append-only comments, DELETE
  guards) and with HR-18's evidentiary needs. The audit found no path to
  this that doesn't break a stated invariant.
- **Orthogonal hardening, compatible with (i) only:**
  `@@unique([trainingModuleId, staffMemberId])` + `skipDuplicates: true`
  closes the race in §2.2 — but permanently prices out (ii) unless a cycle
  column arrives with it. 8.2's SQL must return zero everywhere first.

**Recommendation:** (i) skip-and-report for this phase, and take the unique
constraint ONLY if Gary affirmatively rules that re-assignment, when it
comes, will be modeled with a cycle/sequence column rather than bare second
rows (the HR-15b shape). If he wants that door open cheaply, ship (i)
without the constraint and accept the race as recorded.

### 10.3 R-c — Who can bulk assign

**Facts:** API baseline is ADMIN org-wide + MANAGER store-scoped; STORE is
403 at the shared guard (access.ts:65); `/hr/training` — the entry-point page
— redirects MANAGER away (page.tsx:18); `/hr/compliance` already admits
MANAGER (its page :25); HR-18 plans STORE as a supervising identity for
capture, never as an assigner; a shared-iPad STORE session creating org-wide
training obligations has no precedent anywhere in the surface.

**Options:**
- **(i) ADMIN-only in practice** — ship the button on `/hr/training` as
  gated today. Zero page changes; MANAGER keeps the single-assign path.
  "Match" in its most literal form; costs managers the fan-out (a manager
  onboarding five hires still clicks five times).
- **(ii) ADMIN + MANAGER** — the API already supports scoped MANAGER writes,
  so the route tier is free; but the page gate must open for MANAGER
  (page.tsx:18 → admit MANAGER; module CRUD APIs stay ADMIN so the page
  becomes read + bulk-assign for them — the builder buttons need hiding).
  That is a real permission widening on a page HR-6 deliberately shipped
  ADMIN-only, decided here, recorded on the row.
  A middle path exists — MANAGER bulk-assigns from somewhere they already
  stand (`/staff` or `/hr/compliance`) — but it violates the prompt's "from
  the module itself" flow and adds a second entry point to keep in feature
  parity; the audit flags it only so its rejection is deliberate.
- **STORE: no.** Nothing in the surface argues otherwise, and HR-18's
  supervise-vs-assign distinction argues for keeping it that way.

**Recommendation:** decide (i) vs (ii) on operational reality (does Keva's
per-store onboarding run through managers?); the audit's only hard finding is
that (ii) is a page-gate change that must be named in the row, not slipped in
as UI.

### 10.4 R-d — Recipient edge cases

**Facts, each with its enforcement point:**
- **Terminated staff:** refused 409 at single-assign (route :29-31); rollup
  excludes them from percentages while keeping records (hr-compliance.ts
  definitions :16-17). Bulk: exclude, count under skipped-with-reason.
  A store-wide expansion should filter `status: "ACTIVE"` at expansion time.
- **Corporate staff — the trap:** `isCorporate` staff are *excluded from
  store-scoped compliance surfaces* by flag, **but their storeAssignments
  are expanded to every store** (DEBT-9: Square's ALL_CURRENT_AND_FUTURE
  becomes one row per store — StaffMember comment, schema :271-288). So a
  naive "entire store" expansion by `StoreStaffAssignment` **includes every
  corporate member at every store**, and `findManageableStaffMember` already
  lets any MANAGER manage them (access.ts:90-92 — store overlap always
  true). Bulk must decide: filter `isCorporate: false` from store-expansions
  (consistent with every other store-scoped surface) and reach corporate
  staff only via individual pick or ADMIN's "everyone"? Also note DEBT-49
  (open): no admin control sets the flag, so its data quality is SQL-set.
- **"Everything in scope":** ADMIN = all ACTIVE staff in org (corporate
  included — they're org members); MANAGER = ACTIVE staff with a store
  overlap (corporate excluded if the store-expansion rule above says so —
  the two rules must be stated together or they contradict).
- **Staff with no login:** `userId` null is the majority case by design
  (schema :262-266); assignment works, capture goes manager-attested or
  waits for HR-18's supervised path; compliance counts them identically.
  No special casing needed — but the due-date + no-login combination means
  obligations people cannot self-serve, worth one sentence in the dialog UI.
- **Module-side filters (findings #2/#3):** the bulk route should enforce
  `isActive: true` + `isArchived: false` and decide applicability: assigning
  a `selected`-store module to recipients outside its stores is possible
  today one-at-a-time only because the API never checks. Cleanest rule:
  bulk-assign respects module applicability and reports the excluded
  recipients ("skipped: module not applicable to their store") — and the
  single path inherits the same check later as finding #4's rider.

**Recommendation:** ACTIVE-only always; corporate excluded from store
expansion, reachable individually and via ADMIN org-wide; applicability
enforced and reported. Each exclusion a named count in the response.

### 10.5 R-e — Permission mechanics

**Finding: the audit agrees with the presumption; no counter-argument
found.** New routes call the existing shared guards in
`api/hr/training/access.ts` (§6.1) — the same file, the same inline tier,
zero registry edits. PERM-5C's edge comment (staff page.tsx:102-107) stays
untouched. HR-19 inherits one more caller of a seam it already has to
migrate, which is the cheapest possible shape to leave it. Nothing to rule
beyond confirming.

### 10.6 R-f — View-toggle persistence

**Facts:** UX-2's caveat is real and measured — localStorage is
origin-scoped and outlives logout; worst on shared devices; PERM-7
provisioned exactly such devices. But: the toggle is cosmetic (both views
render identical data and actions — Part 4's own rule guarantees it), and
`/hr/training` is unreachable from a STORE device session (page gate, §6.2)
under option R-c(i); under R-c(ii) it gains MANAGER, still not STORE.

**Options, priced:**
- **(i) Session-only** (React state or sessionStorage): zero footprint,
  resets per tab/visit. Cost: mild repeated annoyance for the daily user.
- **(ii) localStorage, per browser:** one key (suggest
  `froot.hr.training.view`), survives logout — which for a cosmetic toggle
  leaks nothing and misleads nobody; the UX-2 hazard was *store selection*
  masquerading as fresh state. Cheapest thing that behaves as users expect.
  State the caveat in the row and move on.
- **(iii) Keyed by user, server-side:** honest cross-device persistence;
  cost is a schema/API change for a cosmetic preference — and the UX-2-ruled
  `PATCH /api/users/me` shape deliberately accepts `defaultStoreId` ONLY
  (that row's own words), so extending it is a contract change owned by
  UX-2's phase, not this one.

**Recommendation:** (ii), caveat stated. (iii) only if Gary wants a general
per-user UI-prefs mechanism, which is a different decision than this toggle.

---

## 11. Summary table — the session prompt's questions, answered at f318d2e

| Question | Answer |
|---|---|
| Category-like field on TrainingModule? | **Yes — `subject String?`** (:1873), live on form/API/CSV/one chip; TPL-1a additive shape applies (§1) |
| `dueDate` already on TrainingAssignment? | **Yes** (:1945), written by both assign paths, rendered on 3 surfaces, consumed by compliance as `overdue` (§2, §5) |
| Unique constraint on module × staff? | **No** — app-level skip only; race-permeable; "run" framing suggests it was left open (§2.1-2.2) |
| /hr/training server/client split | 21-line server gate shell + 324-line client with ONE fetch/ONE state; card markup inline :270-318; Active/Archived tabs only; bulk-action bar already exists (§3) |
| What single-assign enforces | ADMIN/scoped-MANAGER, org + store scope on target, ACTIVE-only, org+non-archived modules (silently dropped otherwise), optional trainer/dueDate; duplicates skipped; **not** isActive, **not** applicability (§4) |
| Compliance consumption / HR-13 trigger | Every assignment counts from creation; dueDate already drives `overdue`; exclude-until-due would change the denominator — that is HR-13's row; bulk-assign makes the question urgent but does not require answering it to ship (§5) |
| Fit with HR-18 / HR-15b / HR-19 | HR-18 needs progress/attempt rows preserved (kills "reset"); HR-15b's transferable shape is new-row-per-obligation; HR-19 wants new routes on the existing access.ts seam (§5.4, §6, §10.2, §10.5) |

**Not measured here (needs Gary's Neon console):** live subject values,
duplicate pairs, dueDate usage, staff-population shapes — §8's four queries.
