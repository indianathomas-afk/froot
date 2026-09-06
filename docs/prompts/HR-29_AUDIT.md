# Phase 0 audit — "Linked document on a training lesson"

Session prompt: `docs/prompts/HR-29.md` (TIER 3, plan-first, hard stop).
Audited at local HEAD `9753a26` on branch `staging`, zero unpushed commits.
Baseline `npm run build` green before any planning (`✓ Compiled successfully`,
186/186 static pages).

**This file is named after the PROMPT, not after the row.** The prompt is
`HR-29.md` and nothing in `docs/prompts/` is ever renamed or edited. The row id
this work will actually carry is unresolved — see §1, which is the reason.

---

## 1 · BLOCKER — the row id `HR-29` is already taken, and so is the ruling heading

§7 of the prompt says: "Confirm it is free by **reading the file** … If HR-29 is
taken, stop and ask; do not silently pick another." It is taken.

- `docs/ROADMAP.yaml:5565` — `- id: HR-29`, `status: staging`,
  `commits: ["47dbb00", "a5799d3", "f70ae90"]`,
  title *"TrainingModule display order — orderIndex, an ADMIN reorder endpoint,
  and every consuming surface reading it"*. Shipped 2026-08-24.
- It is not a dormant row. Its code is live and cited in-tree by name:
  `prisma/schema.prisma:2209` (`// HR-29: display order within the org…`),
  `src/app/api/hr/training/route.ts:65`, `src/app/api/hr/training/export/route.ts:37`,
  `src/app/(app)/hr/training/training-client.tsx:339`.
- Two rows depend on it by that id — `docs/ROADMAP.yaml:5685` (HR-30) and
  `:5709` (HR-31, "SPLIT OUT OF HR-29 BY GARY").

`grep -n "^  - id: HR-" docs/ROADMAP.yaml` returns HR-0…HR-31 plus the `HR-7.5`,
`HR-11b…HR-11o` letter series. **The highest plain integer id is HR-31, so
`HR-32` is the next free one** — offered as a candidate only. Not adopted here.

**This is wider than the roadmap row, which is why it is a stop and not a note.**
§3 orders the DECISIONS.md heading written VERBATIM as
`## 2026-09-05 — HR-29: linked document on a training lesson`. Written as
instructed, the decision log would carry two unrelated `HR-29` entries and the
newer one would point at a shipped module-ordering row. §3 also forbids
rewording. Only Gary can resolve that: the heading is his wording and the id
inside it is wrong.

The prompt anticipated exactly this failure mode — "that note already claims
HR-28 is next free while HR-28 exists (DEBT-84 family)". The same class, one
level up: this time the *prompt itself* carries the stale id, not the note.

---

## 2 · Facts from `main` — every §4 line re-verified against HEAD

Verified line by line as instructed. **Five of the twelve rows are wrong at
HEAD**, and three of those five change the plan rather than merely correcting it.

### Rows that verify as written

| §4 claim | Verified at | Result |
|---|---|---|
| `TrainingLesson` shape | `prisma/schema.prisma:2245-2257` | EXACT. `id`, `trainingModuleId`, `title`, `info String?`, `videoUrl String?`, `orderIndex Int @default(0)`; relations `trainingModule`, `resources`, `progress`. |
| Nullable-FK precedent | `prisma/schema.prisma:2224` | EXACT. `category TrainingCategory? @relation(fields: [categoryId], references: [id], onDelete: Restrict)`, with `@@index([categoryId])` at `:2231`. |
| Link kind exists | `prisma/schema.prisma:1755` (`kind`), `:1801` (`externalUrl`), `:1817`/`:1818` (instructions) | EXACT. Migration `20260824193000_doc3_document_links_and_instructions` present. |
| Kind constant | `src/lib/hr-documents.ts:48` | EXACT — `["Reference", "Acknowledgment", "Link"]`. Note `FillableForm` is deliberately absent (`:29-31`); it is a real `kind` value in the column but never a library kind. |
| Write path 1 | `src/app/api/hr/training/route.ts:93` (POST) + `src/app/(app)/hr/training/training-client.tsx:548` (Duplicate) | EXACT. Duplicate composes a full POST body client-side at `:552-577`. |
| Write path 2 | `src/app/api/hr/training/[id]/route.ts:59` (PATCH) | EXACT. Lesson diff transaction at `:110-186`. |
| Read path — builder | `route.ts:58` GET, `[id]/route.ts:42` GET | EXACT. |

### Row 3 — write path 3 (import): CONFIRMED UNAFFECTED, with the reason

`src/app/api/hr/training/import/route.ts:109` creates lessons from
`m.lessons`, whose shape is fixed in the CSV parser: `src/app/api/hr/training/csv.ts:133`
declares `lessons: { title; info; videoUrl; orderIndex }[]` and `:173-179`
builds exactly those four fields from named CSV columns. The header list at
`csv.ts:21` is likewise a fixed literal.

So the import route cannot carry the new field and cannot be broken by it: a
nullable column it never names is written NULL by Prisma's default. **It needs no
edit and must not get one** — a fourth `row_type` is §2's excluded scope.

The same fixed-column argument is why §6's JSON-only rule is right, and it holds
in the other direction too: **a JSON export → import round trip will silently
drop the link**, because `import/route.ts` reads the CSV shape only. Named in the
plan, §8 item 4.

### Row 4 — "PERM-7 gap, do not repeat": STALE. The gap is already closed on both paths

The prompt states both routes "take `body.storeIds` raw and create
store-assignment rows without validating them against the org". Not true at HEAD:

- `src/app/api/hr/training/route.ts:116-126` — *"HR-20 rider (PERM-7's class,
  audit §9 item 1): every submitted store id must belong to this org"*, then a
  `store.count` against `organizationId` and a `Set`-size comparison → 400.
- `src/app/api/hr/training/[id]/route.ts:90-99` — the same block, same comment,
  before the wipe-and-recreate.

Both also org-validate `categoryId` (`route.ts:128-135`, `[id]/route.ts:101-108`).

**The instruction survives its own stale premise, and is strengthened by it.**
The new FK must be org-validated on both write paths — and there is now an exact
in-file precedent to copy, four lines above where the new check goes, rather than
a defect to avoid. The plan copies the `categoryId` block verbatim in shape.

### Row 5 — "one renderer, two modes (`preview` / `execute`)": WRONG. There are THREE

`src/components/hr/training-module-view.tsx:27-49` — `TrainingViewMode` is a
three-member union: `execute` (`:29`), `preview` (`:35`), and **`read` (`:49`,
added by HR-24)**. The `read` case is documented at `:36-48` as *"a STORE login
reading the library on the shared floor device"*.

This is the single most consequential correction in this audit, because §5c's
STORE rule is written on the assumption that STORE cannot reach the renderer.
See §3.

### Row 6 — "the mode trap … resource-link block (~:150-164) not conditioned on `mode` at all": STALE

That describes the **pre-HR-25** state. At HEAD:

- The resource block is at `:218-246`, not `:150-164`.
- It **is** gated — on `resourcesAvailable`, a **required** prop
  (`:79`, `:87`), and its false-branch copy branches on `mode.kind === "read"`
  (`:242`).
- The comment at `:65-72` records the fix and the reason: *"The link block below
  was previously conditioned on nothing but the resource count, so any tier added
  to this renderer silently gained downloads (training access audit, triage #6).
  … this prop is the UI half, never the gate."*

**The hazard the prompt names is real and the remedy in the file is better than
the one the prompt implies.** The prompt says "do not add a second block with the
same defect", which reads as *condition it on `mode`*. HR-25's actual answer was
stronger: **a required prop, so every call site must answer explicitly and a new
tier cannot inherit the block by default.** The plan adopts the required-prop
pattern (§5c below), not a `mode` conditional.

### Row 12 — page gates: answered in §3, and the answer is the opposite of the one §5c expects

---

## 3 · THE FINDING THAT MOVES THE PLAN — STORE reaches this renderer today

§5c says: *"state plainly, with `file:line`, whether STORE can reach any of these
surfaces at HEAD. If it cannot, say that: the suppression is a guard against a
widening that has been discussed, not a live path."*

**STORE can. It is a live, shipped, production path, not a discussed widening.**

`src/app/(app)/hr/training/[id]/preview/page.tsx`:

- `:68` — `if (role !== "ADMIN" && role !== "MANAGER" && role !== "STORE") redirect("/hr")`.
  STORE is admitted **by name**.
- `:72` — `const isReader = !isAdmin` — every non-ADMIN is a reader.
- `:88` — the STORE branch scopes the query with `STORE_LIBRARY_WHERE`
  (`src/lib/training.ts:82` — `{ isActive: true, isArchived: false }`), which is
  **org-wide and not narrowed by store applicability** (`:44-47`).
- `:105` — re-checked against `canReadTrainingModule` (`src/lib/training.ts:115`).
- `:160` — `mode={isReader ? { kind: "read" } : { kind: "preview" }}`.

The page's own header comment `:21-27` states the intent: *"A STORE login comes
here to READ — this is the library surface itself, the water-heater procedure on
the shared iPad."* And the in-app link exists: `training-client.tsx` renders the
list for ADMIN and STORE (`:55`), reading `/api/hr/training/library` for
non-managers (`:356`).

**Consequences for the plan, in order of importance:**

1. **The suppression is load-bearing.** It is not a hedge against a hypothetical.
   Getting it wrong leaks the linked document onto a shared floor iPad on day one.
2. **§5c's payload-level lean is right, and now for a stronger reason.** The
   suppression must sit in `preview/page.tsx`'s own query, not in the renderer.
3. **A third role now needs an answer the prompt never asked for: MANAGER.**
   HR-26 moved MANAGER from the preview side to the read side
   (`preview/page.tsx:29-41`), so ADMIN is the only previewer left. §5c's
   parenthetical — *"a manager previewing a module sees what the trainee sees"* —
   describes a tier that stopped existing on 2026-08-12. See §4.

**The near-miss worth recording.** Had §5c's "if it cannot, say that" branch been
taken on the prompt's own two-mode fact table, this row would have shipped a
client-side-free, payload-level suppression *aimed at the wrong surface* and
reported it as a guard against a non-existent path — while the live path leaked.
The prompt's instruction to re-verify every line is what caught it.

---

## 4 · The one question this audit cannot answer — MANAGER, and STORE-role trainees

Two decisions are genuinely Gary's, not derivable from the prompt or the code.

### 4a · What does MANAGER see?

MANAGER is a `read`-mode viewer at HEAD, not a previewer. The prompt's two named
rules cover ADMIN (`preview`, renders) and STORE (`read`, suppressed) — and
MANAGER now sits in the same *mode* as STORE while §5c's intent clearly includes
it ("a manager … sees what the trainee sees").

**Recommendation: `role !== "STORE"`, i.e. MANAGER sees it.** The in-file
precedent is exact and one line away:
`preview/page.tsx:74` — `const filesServed = role !== "STORE"`, with `:48-54`
recording the reasoning (STORE has no tier on the download route; MANAGER has had
manage-tier access since HR-17). A linked document is the same class of thing as
an attached file, so the new flag should mirror that line rather than invent a
second shape. Ruling `read`-mode-wide instead would take the linked document away
from MANAGER purely as a side effect of HR-26's mode reshuffle.

**This is a display decision, not an access decision, and that is why it is safe
to decide at approval.** A Link's target is an external URL; no server-side grant
is consulted to serve one (§3 of the prompt, and `canReadHrDocument` —
`src/lib/hr-documents-access.ts:129` — is not on any path here). Nothing is
enforced by this choice today.

### 4b · Does "STORE never sees this block" reach `/my/training`?

`src/app/(my)/my/training/[assignmentId]/page.tsx:30` gates on
`getActiveStaffSelf()` (`src/lib/auth.ts:178-199`), which checks the HR module,
the org, a linked `StaffMember` and `status === "ACTIVE"` — **and no role at
all.** A user whose `role` is `STORE` and who also has an active staff profile
and an assignment reaches `execute` mode.

Two readings of Gary's sentence:

- **(a) The STORE role never sees it anywhere.** Suppress on `/my/training` too
  when `dbUser.role === "STORE"`. This breaks the row's own driving case — the
  Day 1 I-9 lesson — for any trainee whose login happens to be STORE-role.
- **(b) The STORE *library read surface* never shows it.** `/my/training` keeps
  it, because there the viewer is a trainee working an assignment.

**Recommendation: (b), and the ruling's own wording settles it.** §3: *"grants
read on that document to anyone **assigned the module**, scoped to the lesson."*
At `/my/training` the viewer is assigned. In `read` mode there is no assignment
at all — `TrainingViewMode`'s `read` member carries no `assignmentId` and no
progress (`training-module-view.tsx:49`). The ruling draws the line exactly where
the mode union already draws it.

Under (b) the rule is one line and reads as one idea: **the block renders where
there is an assignment (`execute`) or an admin judging one (`preview`), and not
on the library read surface.**

---

## 5 · Plan

### 5a · Schema

```prisma
model TrainingLesson {
  …
  // HR-xx: the ONE document a lesson may point at, from the Document Library.
  // Link kind ONLY — the I-9 on uscis.gov, a state labor poster.
  //
  // THE KIND INVARIANT IS NOT IN THIS DATABASE AND CANNOT BE. The rule is
  // `linkedHrDocumentId → HrDocument WHERE kind = 'Link' AND isActive`, which
  // is CROSS-TABLE: no CHECK can state it at any price — the same wall DOC-3
  // hit with its zero-versions invariant (see HrDocument above, and
  // docs/MIGRATIONS.md § Protected indexes). It is held by the two write
  // routes and NOWHERE ELSE. If you are tempted to "complete" it with a
  // constraint, that is why you cannot.
  linkedHrDocumentId String?
  …
  linkedHrDocument HrDocument? @relation(fields: [linkedHrDocumentId], references: [id], onDelete: Restrict)
  @@index([linkedHrDocumentId])
}
```

Plus the back-relation on `HrDocument` (`schema.prisma:1820-1825` block):
`linkedLessons TrainingLesson[]`.

**`onDelete: Restrict` — confirmed, and the prompt's reasoning holds.** It
matches `TrainingModule.category` (`:2224`), the one nullable-FK precedent in
this file. It is inert in practice: DOC-1 ruling 8 hides documents via
`isActive`, never deletes them, and no route calls `hrDocument.delete` — verified.
If that ever changes, Restrict refuses rather than silently orphaning a lesson.

Two things worth stating that the prompt did not:

- **`@@index([linkedHrDocumentId])`** matches `@@index([categoryId])` at `:2231`.
  It is what makes `Restrict` cheap: without it, deleting any `HrDocument` scans
  `TrainingLesson`.
- **No `@@unique`.** One document may be linked from many lessons. "One document
  per lesson" is the FK's cardinality already (a scalar column); it is not a
  uniqueness claim about the document.

**Migration** — hand-authored per `docs/MIGRATIONS.md` §3 (`migrate dev` is
broken, P3018; `db push` retired 2026-07-06). Generated with
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o prisma/migrations/<YYYYMMDDHHMMSS>_hrxx_lesson_linked_document/migration.sql`,
then read before applying. Expected SQL:

```sql
ALTER TABLE "TrainingLesson" ADD COLUMN "linkedHrDocumentId" TEXT;
CREATE INDEX "TrainingLesson_linkedHrDocumentId_idx" ON "TrainingLesson"("linkedHrDocumentId");
ALTER TABLE "TrainingLesson" ADD CONSTRAINT "TrainingLesson_linkedHrDocumentId_fkey"
  FOREIGN KEY ("linkedHrDocumentId") REFERENCES "HrDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Additive only: one nullable column, one index, one FK. No drops, no backfill, no
rewrite — every existing row is valid with NULL.

**Applied to `dev` only, by hand.** `DATABASE_URL` in local `.env` points at the
`dev` Neon branch (`br-broad-wave-a6vpjdw0`, host `ep-late-water-a6k53nv2`),
routed through `DATABASE_URL_UNPOOLED` by BUG-3. Staging and production apply it
via `prisma migrate deploy` in the Vercel build — never by hand.

**Branch identity in the output**, per CLAUDE.md § Database Evidence: every
figure is reported from a query that emits the `ep-` host and
`neon.branch_id` on the same line as the result. `current_database()` proves
nothing and will not be used.

**Nothing is added to `docs/MIGRATIONS.md` § Protected indexes.** That table is
for objects the schema cannot express. All three objects here are schema-expressible
and will be regenerated correctly by a baseline squash, so listing them would
dilute a table whose value is that everything in it is genuinely at risk from
Hazard 1.

### 5b · Write routes

Shared helper, one definition, used by both paths (mirroring
`isValidExternalDocumentUrl`'s one-function-two-callers shape at
`src/lib/hr-documents.ts:90`). Placed in `src/app/api/hr/training/access.ts`,
beside `validateTrainingResourceMeta`, which is the existing home for exactly
this job.

```ts
// The kind invariant the database cannot hold (see TrainingLesson in
// schema.prisma). Both builder write paths call this; there is no third.
// Returns an error string or null, matching validateTrainingResourceMeta.
async function validateLessonLinks(lessons, orgDbId): Promise<string | null>
```

Rules, server-side, on **both** paths — resolves to an `HrDocument` with
`organizationId === orgDbId`, `kind === "Link"`, `isActive === true`; anything
else → **400, never a silent null**:

- `POST /api/hr/training` — `lessonSchema` (`route.ts:24-30`) gains
  `linkedHrDocumentId: z.string().nullish()`; the check goes after the
  `categoryId` block (`:135`), before `trainingModule.create`; the field is
  written in the `lessons.create` map (`:151-167`).
- `PATCH /api/hr/training/[id]` — `lessonSchema` (`[id]/route.ts:8-14`) gains the
  same field; the check goes after the `categoryId` block (`:108`), before the
  transaction. **`lessonData()` (`:126-131`) is used by both the update loop and
  the create list, so one line there covers both halves of the diff.**
- The PATCH quick-status branch (`[id]/route.ts:73`, `!("lessons" in body)`)
  never touches lessons and needs no change.

**One query, not one per lesson.** Collect the distinct non-null ids across all
lessons, then a single `findMany({ where: { id: { in: ids }, organizationId,
kind: "Link", isActive: true }, select: { id: true } })` and compare set sizes —
the same shape as the `store.count` rider at `route.ts:119-126`.

**Duplicate** (`training-client.tsx:548`): the `TrainingLesson` type at `:40-46`
gains `linkedHrDocumentId: string | null`, and the lesson map at `:562-575`
carries it. Same org by construction, so no org-crossing risk.

**Import** — unaffected, unedited. Reason in §2, row 3.

### 5c · Renderer

`training-module-view.tsx`:

- `TrainingViewLesson` (`:19-25`) gains
  `linkedDocument: { title: string; externalUrl: string } | null`.
  **The joined document, not the raw id** — which is what makes payload-level
  suppression structural: a page that does not `include` the relation has
  literally nothing to render, and the type forces every call site to say so.
- A new **required** prop `linkedDocumentsAvailable: boolean`, following HR-25's
  pattern at `:65-72` and `:79` rather than a `mode` conditional. Required is the
  point: a future fourth tier cannot inherit the block by default.
- One block per lesson, placed after the video block (`:216`) and before the
  resources block (`:218`): the document title, its hostname
  (`new URL(externalUrl).hostname`), and an **Open** action —
  `target="_blank"`, `rel="noopener noreferrer"`, `href = externalUrl`.

  Note the in-file anchors use bare `rel="noopener"` (`:210`, `:226`). §5c asks
  for `noopener noreferrer`; the plan follows §5c and does not touch the two
  existing anchors.
- **No `instructionsHtml`, no `instructionsVideoUrl`.** Per §5c. The lesson has
  its own body and its own video.
- **Inactive document → renders nothing.** Held at the payload: the page query
  filters `isActive: true` on the joined document, so an inactive one arrives as
  `null` and there is no client-side branch to get wrong.
- `externalUrl` is safe to treat as non-null for a Link: the `hrdoc_link_shape`
  CHECK (`docs/MIGRATIONS.md` § Protected indexes) enforces
  `("kind" = 'Link') = ("externalUrl" IS NOT NULL)`. The type still models it as
  a joined object so a NULL cannot reach an `href`.

**Suppression, at the payload:**

| Surface | `file:line` | Mode | Linked document |
|---|---|---|---|
| `/my/training/[assignmentId]` | `(my)/my/training/[assignmentId]/page.tsx:41` | `execute` | **rendered** — the viewer is assigned |
| `/hr/training/[id]/preview` — ADMIN | `(app)/hr/training/[id]/preview/page.tsx:160` | `preview` | **rendered** — §5c |
| `/hr/training/[id]/preview` — MANAGER | same | `read` | **§4a — Gary's call.** Recommend rendered |
| `/hr/training/[id]/preview` — STORE | same | `read` | **suppressed** — Gary, 2026-09-05 |

Implemented as one flag beside the existing one at `preview/page.tsx:74`:

```ts
const filesServed = role !== "STORE"          // existing, unchanged
const linkedDocsServed = role !== "STORE"     // new, §4a — same rule, same reason
```

…and the `include` at `:90-98` adds the joined document **only when
`linkedDocsServed`**, so a STORE payload never carries it. `/my/training`'s
`select` at `:38-47` adds it unconditionally.

### 5d · Builder UI

**Two forms, not one** — `training-form.tsx` has two lesson editors and the
prompt's "a select" is both of them:

- `lessonEditForm` — "Edit Lesson", Video URL at `:708`
- the New Lesson block — Video URL at `:923`

A "Linked document (optional)" `<select>` goes directly under each, listing
active `kind: "Link"` documents in the org.

**Sourced from the server components that already load the module** — no new API
route, per §5d. Both builder pages are ADMIN-only (`new/page.tsx:14`,
`[id]/edit/page.tsx:15`) and both already run a `Promise.all` of list queries
(`new/page.tsx:16-27`, `edit/page.tsx:17-39`); this is a fourth entry in each:

```ts
prisma.hrDocument.findMany({
  where: { organizationId: org.id, kind: "Link", isActive: true },
  select: { id: true, title: true },
  orderBy: { title: "asc" },
})
```

- **Empty library →** a single disabled option: *"No linked documents yet — add
  one at /hr/documents"*.
- **A deactivated linked document still shows, marked `(inactive)`,** rather than
  silently clearing. On the edit page the query is widened with an `OR` on the
  ids already linked by this module's lessons, so a since-deactivated document
  survives a round trip through the form. `initialData.lessons` (`edit/page.tsx:55-66`)
  carries `linkedHrDocumentId`.
- **Consequence to accept:** saving a lesson that still points at an inactive
  document will 400 under §5b's `isActive === true` rule. That is the correct,
  loud outcome — but see §7 item 1, because one caller swallows it.

### 5e · Gates

- `npm run build` before every commit; `npx eslint` scoped to the files each
  commit touches (DEBT-33 — no bare `npm run lint`). One chained command, **no
  pipes**, build output redirected to a file and read afterwards as a separate
  command.
- **Staging pass — SHA precondition first**, and it is not optional: Claude never
  pushes, so the default assumption is that staging does not have the work. Full
  40-char `git rev-parse HEAD`, `npx vercel inspect <staging-alias>`, and
  `npx vercel ls --meta githubCommitSha=<full-sha>` returning that same
  deployment id. Only then, as `karson@keva.com` (ADMIN): create a Link document,
  attach it to a lesson, confirm **Open** lands on the external host, confirm the
  preview renders it.
- **SQL on staging naming `br-square-feather` and the `ep-` host in the same
  output as the row**, proving the FK is populated and points at a `kind='Link'`
  row. Run in the **Neon console** — `vercel env pull` is banned repo-wide, with
  no staging carve-out (CLAUDE.md § Environment Variables).
- **The negative, fired not asserted:** a PATCH sending a non-Link document id
  must 400. Route-level, not a button check — a button cannot send an id the UI
  will not offer. Run signed in: `src/proxy.ts` wraps non-public routes in
  `auth.protect()`, which **404s** an unauthenticated request, and a signed-out
  probe returns the right answer for the wrong reason (DOC-3, 2026-08-24).
  Three ids, three 400s: a `Reference`, an inactive `Link`, and a `Link` from
  another org.
- **The STORE negative is the one this row turns on, and it must be a positive
  taken under the role.** DOC-3's lesson (`ROADMAP.yaml:5565` region): *a
  negative check cannot distinguish "correctly excluded" from "excluded because
  nobody can see it".* So: the same STORE login must **see the lesson and its
  video** at `/hr/training/[id]/preview` while **not** seeing the linked-document
  block. A blank page proves nothing.

### 5f · Staleness sweep — `docs/guide/`

`docs/guide/hr-training.md` covers `/hr/training/new` and `/hr/training/[id]/edit`
(front matter `:5-8`, `sections.authoring` `:19-24`).

**It does not go stale, and that is a finding rather than a relief.** The article
never enumerates the lesson editor's fields — "Video URL" appears nowhere in it —
so adding a field makes no sentence false. Two sentences become *incomplete*:
`:61` ("A module is a title, its material, and optionally a quiz") and `:54`
("the material in order, and the quiz"). Reported, not fixed. **COMMENT.**

`docs/guide/hr-documents.md:54` is a different matter and is a live defect — §7
item 2.

### 5g · Triage

In §7.

---

## 6 · JSON export (§6, Phase 3) — it is already done, and that is the problem

`src/app/api/hr/training/export/route.ts:45` is
`JSON.stringify(modules, null, 2)` over rows fetched with `include: { lessons: … }`.
**`linkedHrDocumentId` appears in the JSON export the moment the column exists.
Zero code required.**

But the bare cuid is the exact class of value this route says does not travel.
Its own comments: *"store cuids are env-specific"* (`:12-13`) and, at `:33-34`,
*"the CSV carries the category NAME (ids are branch-specific and never travel —
the import resolves by name within the target org)"*. A `linkedHrDocumentId`
exported alone is a dangling pointer into another environment's database.

**Recommendation:** add `linkedHrDocument: { select: { title: true, externalUrl: true } }`
to the export's `include` (`:27-30`), so the JSON carries something a human can
resolve — mirroring the resources precedent at `:13-14` (*"the JSON includes
their metadata for reference only"*). One line, in the route's own established
idiom. Flagged as a plan decision because §6 lists "JSON export" as work and this
converts it into a deliberate one-line addition rather than an accident.

---

## 7 · Triage — findings outside this row's scope

**Counts: FIX NOW 0 · RULING NOW 1 · COMMENT 3 · ROW 1.**

### RULING NOW — 1 (this stops the session; §4 items are plan decisions, not this)

**R1 · The row id `HR-29` is taken, and the verbatim DECISIONS.md heading carries
it.** Full detail in §1. Gary must decide the id (`HR-32` is the next free
integer) and whether the §3 heading changes with it — §3 forbids rewording, and
the id is inside the wording. Nothing in Phase 1 can be written until this is
answered, because the DECISIONS.md entry is Phase 1's own deliverable.

### COMMENT — 3

**C1 · `docs/guide/hr-documents.md:54` states something false about Links today.**
*"**Reference** and **Link** accept PDF, PNG, JPG, DOC or DOCX up to 25 MB."* A
Link has **no file at all** — DOC-3 ruling 1, the `hrdoc_link_shape` CHECK, and
zero `HrDocumentVersion` rows. Pre-existing (HELP-1b), not created here, but
squarely in this row's blast radius and it is shipped help copy that is simply
wrong. Not fixed inline: §5f says report, and a guide edit does not belong in a
commit about a schema column.

**C2 · `docs/guide/hr-training.md` becomes incomplete, not false.** §5f above.

**C3 · Two `rel="noopener"` anchors without `noreferrer`** —
`training-module-view.tsx:210` (lesson video) and `:226` (resource download).
The new block uses `noopener noreferrer` per §5c, which leaves the file
internally inconsistent by one token. Untouched deliberately: they are shipped
surfaces and this row does not open them.

Also carried forward, already ruled and deliberately untouched per §2 of the
prompt: `videoUrl` takes `z.string().nullish()` with no shape check
(`api/hr/training/route.ts:27`, `[id]/route.ts:12`) and is rendered straight into
an `href` (`training-module-view.tsx:206-215`). Ruled a COMMENT by Gary at DOC-3.
**Not re-filed** — re-filing a standing ruling as a new finding is how a closed
question reopens itself.

### ROW — 1

**W1 · `duplicate()` ignores its response.** `training-client.tsx:551-577` —
`await fetch("/api/hr/training", …)` with no `res.ok` check, then `await load()`.
A 400 produces a silent no-op: the list reloads, no copy appears, nothing is
said. Pre-existing, but **this row makes it newly reachable**: duplicating a
module whose linked document was deactivated after the page loaded will 400
under §5b. Every other 400 on that route is unreachable from a valid module, so
this is the first one a normal user can trigger.

Small enough to argue for FIX NOW; filed as a ROW because it is an error-handling
change to a shipped ADMIN surface in a commit about a schema column, which is the
exact shape DOC-3's amendment 1 declined. **If Gary prefers it inline, it is
three lines and the plan can absorb it** — flagging that rather than deciding it.

---

## 8 · Things a later session will want and would not otherwise find

1. **The kind invariant is held by two routes and nothing else.** No CHECK, no
   trigger, no FK predicate. Stated in the schema comment (§5a) and in the row
   notes, because the next person will look for a constraint and conclude one is
   missing.
2. **Widening to Reference is a route-tier change, not a schema change.** The FK
   already points at `HrDocument`; what Reference needs is a new tier on
   `GET /api/hr/documents/[id]/download`, whose gate `canReadHrDocument`
   (`src/lib/hr-documents-access.ts:129`) resolves library grants and knows
   nothing about lessons. That is the work, and it is why §2 excluded it.
3. **`canReadHrDocument`'s switch is a kind allow-list with no exhaustiveness
   check** (`hr-documents-access.ts:136-150`, and its own comment says so).
   Nothing in this row touches it — a Link is served as an external URL — but
   anyone widening to Reference lands there first.
4. **A JSON export → import round trip drops the link** (§2 row 3, §6). The
   import reads the CSV shape only.
5. **`/my/training` is role-blind** (`src/lib/auth.ts:178-199`). Any rule phrased
   as "role X never sees Y" needs §4b's answer before it can be implemented, and
   the answer is not derivable from the role table.
