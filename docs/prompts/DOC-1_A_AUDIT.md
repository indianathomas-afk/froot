# DOC-1 Phase A — Audit: document audience grants and the read-policy choke point

Session: DOC-1 Phase A (TIER 3, structural). Audit conducted 2026-08-12 against
local `staging` at `b853787`, with all four refs level (HEAD → staging,
origin/staging, origin/main, main) and zero unpushed commits. Session prompt:
`docs/prompts/DOC-1_phase_A_audience_grants_audit.md`.

Written at hard stop 1, before any plan was written and before any source file
was touched, on Gary's ruling R4 (2026-08-12). This file is a claim wholesale
and is never edited afterwards (CLAUDE.md § Where documents live). Corrections
to anything in it belong in whatever document supersedes it, not here.

---

## 1. What was audited, and what was not

**Audited.** Every site in `src/` that resolves an `HrDocument` row — pages,
API routes and library functions alike — plus the schema for `HrDocument`,
`HrDocumentVersion`, `HrDocumentStoreAssignment`, the acknowledgment and
checkpoint models, `HrSignedRecord`, and the staff/store/user models that any
audience rule would have to resolve through. The enumeration was produced by
grepping `prisma.hrDocument` across `src/` and reading every hit, not by
following links from the documents feature — several of the paths below are
reached from `/staff` and `/my`, not from `/hr/documents`, and a
feature-shaped sweep would have missed them.

**Measured.** One query, on dev branch `br-broad-wave-a6vpjdw0` (`neondb`),
recorded in §4.3 with the branch id selected in the same statement as the
counts (CLAUDE.md § Database Evidence, belt-and-braces).

**NOT measured, deliberately.** Staging (`br-square-feather`) and production
(`br-sparkling-block`) were not queried. Reading either from this machine
requires `vercel env pull`, which CLAUDE.md § Environment Variables bans
totally and without exception — the ban is the mitigation for
`DATABASE_URL_UNPOOLED` not being marked Sensitive, and it has no carve-out for
read-only work. Every claim in this document about staging or production data
is therefore an *inference from code*, and is labelled as such where it
appears. The production count that decides the backfill question is hard stop 4
of the session prompt and is Gary's to run in the Neon console.

**NOT audited.** The signed-record read tier (`canReadHrSignedRecord`,
`/api/hr/signed-records/[id]/download`, `/my/documents/records/[recordId]`) was
read for context but is not part of this phase: executed PDFs are governed by
their own policy function, which already exists and already has a per-record
rule. Training is out of scope except as the pattern being copied (§7).

---

## 2. The two findings that change the shape of Phase A

### 2.1 The choke point has exactly one caller

`canReadHrDocument` (`src/lib/hr-files.ts:243`) is called from **one** site in
the entire codebase: `src/app/api/hr/documents/[id]/download/route.ts:30`.

The comment above the function (`hr-files.ts:240-242`) reads:

> Document access policy, keyed on HrDocument.kind. The download route (and
> every future HR read path) must resolve version → document and ask this
> function — authorization is per document policy, never "any HR file".

Eleven read paths and two write paths have been built since that comment was
written. **None of them calls it.** Each resolves `HrDocument` with its own
inline `where` clause and applies whatever rule its author had in mind. The
instruction was correct, was written down in the right place, and did not
propagate.

The consequence for this phase is structural rather than cosmetic. Phase A was
scoped as "make the choke point audience-aware and update its call sites." The
call sites do not exist. What Phase A actually has to do is *establish* the
choke point across the paths that need it, and add grants to it in the same
motion.

### 2.2 An audience mechanism already exists, is already relied on, and has no writer

`HrDocument.appliesTo` (`prisma/schema.prisma:1593`, `String @default("all")`,
documented in-line as `all | selected (store assignments below)`) and
`HrDocumentStoreAssignment` (`prisma/schema.prisma:1610`, a
`(hrDocumentId, storeId)` join with `@@unique`) are a store-audience system
that shipped with the original HR data model.

Four read paths already filter on it (§4.2). **Nothing in the application ever
writes either one.** There is no route, page, server action, or seed that sets
`appliesTo`; the POST that creates documents
(`src/app/api/hr/documents/route.ts:92`) does not mention the column, so every
row takes the `"all"` default. `HrDocumentStoreAssignment` has no writer at
all — a grep for `hrDocumentStoreAssignment` across `src/` returns nothing
outside the generated Prisma client.

So the four call sites are filtering on a constant. Their
`OR: [{ appliesTo: "all" }, { storeAssignments: { some: … } }]` clause always
matches on its first disjunct, and the second has never once been evaluated
against a non-empty set.

This is a dormant, half-built version of the thing Phase A was asked to build,
sitting in the same table, already wired into four consumers.

---

## 3. The fifteen-path table

Every site that resolves an `HrDocument`, with its guard and whether it routes
through the choke point. "Inline" means the site applies its own `where` clause
and never asks a policy function.

| # | Path | File | Guard | Choke point |
|---|---|---|---|---|
| 1 | `GET /api/hr/documents/[id]/download` | `api/hr/documents/[id]/download/route.ts:20,30` | `requireHrDocumentAccess()` — any authenticated org member | **YES** — the only one |
| 2 | `/hr/documents` library page | `(app)/hr/documents/page.tsx:21` | HR availability + org toggle. **No role gate whatsoever** | inline |
| 3 | `/hr/documents/[id]` admin detail | `(app)/hr/documents/[id]/page.tsx:23` | `dbUser?.role !== "ADMIN"` → `notFound()` (`:21`) | inline |
| 4 | `/hr/acknowledge/[documentId]` — signing surface | `(app)/hr/acknowledge/[documentId]/page.tsx:34` | HR gates only; no role test on the self path | inline |
| 5 | `/my/documents` reference library | `(my)/my/documents/page.tsx:50` | `getActiveStaffSelf()` | inline |
| 6 | `/my/documents` required-signature rows | `(my)/my/documents/data.ts:26` | `getActiveStaffSelf()` | inline — **uses `appliesTo`** (`:32`) |
| 7 | `/my/documents/[documentId]` — signing surface | `(my)/my/documents/[documentId]/page.tsx:23` | `getActiveStaffSelf()` | inline |
| 8 | `/staff/[id]` Documents tab | `(app)/staff/[id]/page.tsx:170` | `canSeeHrTabs` | inline — **uses `appliesTo`** (`:176-179`) |
| 9 | `/staff/[id]` Agreements tab | `(app)/staff/[id]/page.tsx:257` | `canSeeHrTabs` | inline — **uses `appliesTo`** (`:262-265`) |
| 10 | Compliance rollup (org + per-store + per-staff) | `lib/hr-compliance.ts:159` | caller's gate (`hr.compliance.view`, MANAGE) | inline — **uses `appliesTo`** in JS (`:247-248`) |
| 11 | Compliance agreements panel | `lib/hr-compliance.ts:468` | caller's gate | inline — no audience filter of any kind |
| 12 | `POST /api/hr/documents/[id]/acknowledgments` — **the signature write** | `api/hr/documents/[id]/acknowledgments/route.ts:70` | `requireHrDocumentAccess()` — any org member | inline |
| 13 | `POST /api/hr/documents/[id]/signed-record` — record recovery | `api/hr/documents/[id]/signed-record/route.ts:28` | `requireHrDocumentAccess()` — any org member | inline |
| 14 | FillableForm surfaces (see §3.1 — **eleven query sites across seven files**, not four) | `(app)/hr/forms/*`, `api/hr/forms/*`, `lib/hr-forms.ts:96` | ADMIN, or ADMIN/MANAGER with store scope | inline |
| 15 | Admin mutation routes: PATCH, versions, checkpoints ×2, anchors ×2, upload-url, POST create | `api/hr/documents/**` | `requireHrDocumentAccess({ admin: true })` | n/a — write tier, correctly ADMIN |

### 3.1 Correction to the count reported at hard stop 1

The hard-stop-1 report described row #14 as "4 sites". That is wrong, and the
correct figure is recorded here rather than left to be rediscovered: the
FillableForm surfaces are **eleven `prisma.hrDocument` query sites across seven
files** — `(app)/hr/forms/page.tsx:20`, `(app)/hr/forms/[id]/page.tsx:18,31,43`,
`(app)/hr/forms/[id]/submit/page.tsx:42`, `api/hr/forms/[id]/route.ts:41,47`,
`api/hr/forms/[id]/submissions/route.ts:63`,
`api/hr/forms/[id]/link/route.ts:29,50`, and `lib/hr-forms.ts:96` (create).

The substance of the finding is unchanged — they are all ADMIN or
ADMIN/MANAGER-with-store-scope, which is why Gary ruled them out of Phase A's
scope (R1). The staff-facing one, `forms/[id]/submit/page.tsx`, refuses anyone
below MANAGER at `:25` and re-checks the manager's store scope against the
target staff member at `:37-39`. `canReadHrDocument`'s `FillableForm` branch
(`hr-files.ts:263`) agrees with all of them: `ADMIN || MANAGER`.

### 3.2 Per-path notes worth carrying forward

**#2, the library page, has no role gate at all.** It gates on HR availability
and the org's `activeModules`, then renders every `Reference` and
`Acknowledgment` document in the org to whoever asked. Its header comment
(`page.tsx:7-12`) states this as the design: "Both kinds are readable by every
authenticated org member (staff must be able to read what they are asked to
sign)." The `/hr` landing page renders the Document Library card **ungated**
(`(app)/hr/page.tsx:76-87`) while gating the Staff Directory, Compliance and
Forms cards by role — so a STORE login on a shared iPad and a STAFF login
arriving by URL both reach it today, by design.

**#4 and #7 are the signing surfaces and they trust the URL.** Both resolve the
document by id with `kind: "Acknowledgment", isActive: true` and nothing else,
then hand the checkpoints and the version's `fileHash` to the signing client.
Any authenticated org member (#4) or any active staff member (#7) can open any
acknowledgment document in the org and sign it. Today that is coherent, because
every document applies to everyone. The moment audiences exist it is the hole
Gary named in R1: *can't see it but can still sign it*.

**#12 is the write, and it is the one that matters most.** It re-resolves the
document (`:70`), resolves who is being signed for (`:83-111`), validates
entries against the checkpoint set (`:129-144`), and writes append-only
acknowledgment rows pinned to the version hash. At no point does it ask whether
this document applies to this staff member. `skipDuplicates` on the
`@@unique([checkpointId, hrDocumentVersionId, staffMemberId, signingCycle])`
constraint makes it idempotent, and completing the required set triggers
`ensureSignedRecord` (`:271`) — which produces a permanent, defensible legal
artifact. A signature accepted against a document the signer was never granted
is not recoverable by a later policy change; per ruling 4, signed records are
permanent.

**#10 and #11 are the compliance denominators.** #10 applies the `appliesTo`
rule in JavaScript at `:247-248` rather than in the query, over a document set
fetched without any audience filter (`:159-165`). #11 fetches every active
`FillableForm` in the org with no audience filter at all (`:468-472`). Under
ruling 7 (assignment = obligation to sign), these are the surfaces where
audience changes the *number*, not just the visibility — which is why Gary
ruled them into Phase C rather than Phase A.

---

## 4. The dormant mechanism, in detail

### 4.1 What is in the schema

```prisma
model HrDocument {
  ...
  appliesTo String @default("all") // all | selected (store assignments below)
  ...
  storeAssignments HrDocumentStoreAssignment[]
}

model HrDocumentStoreAssignment {
  id           String @id @default(cuid())
  hrDocumentId String
  storeId      String

  hrDocument HrDocument @relation(fields: [hrDocumentId], references: [id], onDelete: Cascade)
  store      Store      @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@unique([hrDocumentId, storeId])
}
```

`Store.hrDocumentAssignments` is the back-relation (`schema.prisma:172`). The
join is `onDelete: Cascade` on both sides — appropriate for a grant (a deleted
store's grants are meaningless) and notably *unlike* the acknowledgment and
signed-record models, which deliberately carry no cascade so that a legal record
blocks deletion of what it pins.

### 4.2 Who reads it

Four sites, all reading the same shape:

- `(my)/my/documents/data.ts:32` — `OR: [{ appliesTo: "all" }, { storeAssignments: { some: { storeId: { in: storeIds } } } }]`
- `(app)/staff/[id]/page.tsx:176-179` — same clause, Acknowledgment kind
- `(app)/staff/[id]/page.tsx:262-265` — same clause, FillableForm kind
- `lib/hr-compliance.ts:247-248` — the same rule expressed in JS over a
  pre-fetched `storeAssignments: { select: { storeId: true } }`

All four resolve through the **staff member's** roster
(`StoreStaffAssignment`), which is the correct side for a staff-facing
audience question and is exactly what ruling 1 (standing grants, resolved at
read time) asks for. The mechanism was built with the right resolution model;
it was never given a writer or a UI.

### 4.3 Measured state — dev branch `br-broad-wave-a6vpjdw0`

Single query, branch id selected alongside the counts so the label cannot drift
from the rows:

```
branch_id             br-broad-wave-a6vpjdw0     (dev)
db                    neondb
documents_total       3
applies_all           3
applies_other         0
doc_store_assignments 0
kind_reference        0
kind_acknowledgment   1
kind_fillableform     2
signed_records        1
```

Every document is `appliesTo = "all"`. The assignment table is empty. One
signed record exists on dev.

**Staging and production are unmeasured** (§1). The code guarantees the same
shape everywhere — with no writer for either column, no environment can hold a
row that differs — but that is an inference, and it is recorded as one. The
production `HrDocument` count specifically remains hard stop 4 of the session
prompt and decides whether the fresh-start ruling holds.

### 4.4 Why this matters to the migration

Under Gary's R2 ruling (extend, don't duplicate), the consequence is that the
*meaning* of the four existing call sites changes even though their code may
not. Today `appliesTo = "all"` reaches everyone and is the value of every row.
After Phase A, new uploads default to `"selected"` with zero assignment rows,
which reaches nobody but ADMIN. The three existing dev documents (and whatever
staging holds) keep `"all"` and keep reaching everyone — so the migration is
additive in the schema *and* in behaviour for existing rows, and the change of
default applies only to documents uploaded afterwards.

---

## 5. The attest-path gap

The session prompt asked specifically whose access is checked on the manager
attest path. The answer is: **the manager's scope over the staff member, and
nothing about the document.**

Two sites implement it, identically:

- `(app)/hr/acknowledge/[documentId]/page.tsx:71-74` — if the viewer is
  MANAGER, the target staff member must share a store with them, else
  `notFound()`.
- `api/hr/documents/[id]/acknowledgments/route.ts:105-110` — the same check,
  returning 404 rather than 403 so a foreign id reads as nonexistent.

`api/hr/documents/[id]/signed-record/route.ts:44-58` repeats it a third time for
the recovery path.

All three ask: *may this manager act for this staff member?* None asks: *does
this document apply to this staff member?* Under ruling 4's forward rule — the
staff member's grant governs, not the manager's — every one of these needs a
second check that has no analogue anywhere in the current code. It cannot be
derived from the existing manager-scope test, because a manager's store and a
document's audience are different sets: a manager may legitimately act for a
staff member the document does not reach.

This is the single largest piece of *new* logic in Phase A, as distinct from
rewiring existing logic.

---

## 6. Schema and identity facts the policy has to resolve through

**Two different store-assignment tables, and they are not interchangeable.**

- `StoreUserAssignment` (`schema.prisma:209`) — `(userId, storeId)`. The
  login's stores. `getUserStoreScope()` (`lib/auth.ts:169`) reads it, and
  ADMINs deliberately have **no rows at all** (`User.defaultStoreId`'s comment,
  `schema.prisma:94-101`), which is why every page writes
  `...(isAdmin ? {} : { id: { in: storeIds } })`.
- `StoreStaffAssignment` (`schema.prisma:307`) — `(staffMemberId, storeId)`
  plus `isPrimary`. The roster. This is the side the four existing audience
  call sites resolve through.

A STORE-role login is a `User` with `StoreUserAssignment` rows and, in the
general case, **no `StaffMember` at all** — the shared-iPad account is not a
person. So ruling 5's STORE-login branch must resolve from `dbUser.storeAssignments`,
not from the roster. Gary confirmed this in the R1–R4 ruling.

**Corporate staff carry a `StoreStaffAssignment` for every store.** Square has
no primary location; corporate staff are `ALL_CURRENT_AND_FUTURE_LOCATIONS`, and
the sync expands them to one assignment row per store
(`StaffMember.isCorporate` comment, `schema.prisma:273-289`). The training
module says so in as many words at
`api/hr/training/assignments/bulk/shared.ts:78-81`:

> Corporate staff carry a StoreStaffAssignment for every store … so a
> selected-scope module is always applicable to them — the corporate rule below
> is what governs whether they are reached, not this one.

and handles it with an explicit branch at
`api/hr/training/assignments/bulk/route.ts:187`
(`member.isCorporate && !explicit && !adminEverywhere → "corporate-excluded"`),
with the picker excluding them symmetrically at
`bulk/recipients/route.ts:91`.

**Therefore ruling 6 is not free.** A STORE grant resolved naively as "staff
whose roster store matches" sweeps every corporate member into every store
grant, silently and invisibly — the data looks correct at every step. The
policy function must carry the exclusion explicitly. Ratified by Gary as R3.

**Staff-to-login linkage** is `findStaffMemberForUser` (`lib/hr.ts:30`):
`StaffMember.userId` first, then an org-scoped email match. Ruling 5's STAFF
grant ("that staff member and their linked user") resolves through this.
`getActiveStaffSelf` (`lib/auth.ts:143`) wraps it with the ACTIVE requirement
and is the one gate for every `/my/*` surface.

**Signing cycles** (`StaffMember.signingCycle`, HR-15 Policy B) partition
acknowledgments and signed records by tenure. Nothing in Phase A touches this,
but any query that counts "who has signed" must keep carrying the cycle, and
ruling 4's permanence applies per cycle as it does today.

---

## 7. The pattern to copy: `lib/training.ts`

HR-24/HR-25/HR-26 built exactly the shape this phase needs, two days before it,
and the reasoning is written down in the file. Three properties to carry over:

1. **A pure policy function plus a query-shaped twin, kept physically
   adjacent.** `STORE_LIBRARY_WHERE` / `managerLibraryWhere()` (`training.ts:82,87`)
   are the Prisma fragments; `canReadTrainingModule` (`:115`) is the function.
   The file states the rule for why they live together: *both must move
   together — a server refusal without the UI half leaves visible links that
   404, and the UI half without the server refusal is not a gate* (`:13-18`).
   The list query narrows, and the result is then re-filtered through the
   function, so if the two ever disagree the stricter answer ships.
2. **The reader shape is required, not optional.** `ReadableTrainingModule`
   (`:101`) demands `appliesTo` and `storeAssignments` rather than accepting
   them as optional, with the reason given at `:97-100`: an optional field would
   silently answer "not applicable" for a module whose assignments simply were
   not selected. This is the failure mode a `(doc, grants, viewer)` signature
   must be built to make impossible.
3. **The guard tier is a separate function, not a widened one.**
   `requireHrTrainingReadAccess` (`api/hr/training/access.ts:68`) was added
   beside `requireHrTrainingAccess` rather than loosening it, so all 27 existing
   call sites kept refusing exactly where they had before, with zero deletions
   in the diff.

The `canManage` / `canAssign` seam ruling 3 cites is real and is at
`(app)/hr/training/page.tsx:52-53` — `canManage = role === "ADMIN"`,
`canAssign = role === "ADMIN" || role === "MANAGER"`, with the client asserting
nothing beyond those two booleans (`:31`). Widening assignment to MANAGER later
is a change to one expression.

---

## 8. Adjacent facts recorded but not acted on

- **`hr.documents.view` and `hr.documents.manage` exist in the permissions
  registry with zero call sites.** `lib/permissions.ts:245-246` grants them
  `ALL` and `ADMIN_ONLY` respectively; a grep across `src/` finds no consumer.
  Every documents surface tests role strings directly instead. This is
  consistent with PERM-5's call-site-by-call-site migration and is not a defect,
  but it means Phase A will be adding role logic to files that have a registry
  entry sitting unused. Not this phase's call.
- **`/hr/documents` is the only HR page with no role gate of its own.** Noted
  because HR-24 closed the analogous bounce for the Staff Directory card by
  gating the card, and this page was deliberately left open.
- **`documents-client.tsx:143`** renders the "Sign" link to
  `/hr/acknowledge/[id]` for every `Acknowledgment` document to every viewer;
  `:159-169` gate the admin affordances behind the `isAdmin` prop. When
  audiences land, the sign affordance and the server's willingness to accept the
  signature must move together (the `training.ts:13-18` rule).
- **The `@@unique([hrDocumentId, storeId])` on `HrDocumentStoreAssignment`**
  will need to accommodate STAFF-shaped rows under R2's extension. A composite
  uniqueness over nullable columns behaves differently in Postgres than the
  current two-column form — NULLs are distinct, so `(doc, NULL)` twice does not
  collide. This is a design point for the plan, not a finding.

---

## 9. What this audit did not establish

Recorded so nobody reads more confidence into the above than it earned.

- **No staging or production data was measured.** Everything said about those
  environments is inferred from the absence of a writer in code (§1, §4.3).
- **No browser observation was taken.** No claim here rests on what a STORE or
  STAFF login actually sees; the reach claims are read off the guards in source.
- **The FillableForm surfaces were read but not swept in depth** — they are out
  of Phase A's scope per R1, and §3.1 records their count and tier only.
- **`canReadHrSignedRecord` and the signed-record read paths were not audited**
  (§1). Ruling 4 says signed records are permanent regardless of grant changes;
  nothing in Phase A should touch that policy, and this audit did not verify its
  call sites the way it verified `canReadHrDocument`'s.
- **No performance work was done.** Grants resolved at read time (ruling 1) add
  a join or a second query to several list surfaces; whether any of them needs
  batching was not assessed.

---

## 10. The four RULING NOW items, as put and as ruled

Put to Gary at hard stop 1, 2026-08-12; ruled the same day. Recorded here in
full because the rulings are what the plan is built on.

**R1 — scope, given that 14 of 15 paths bypass the choke point.**
RULED: Phase A adopts the four already-audience-aware sites (#6, #8, #9 — and
#10's rule moves to Phase C), the two signing surfaces (#4, #7), the library
page (#2), **and the two signing write routes (#12, #13)** — the writes must ask
the policy function before accepting a signature, because *can't see it but can
still sign it* is a hole the moment audiences exist. Phase C takes the
compliance rollup and agreements panel (#10, #11). The FillableForm sites (#14)
are out of scope entirely — different animal, already gated.

**R2 — `appliesTo`/`HrDocumentStoreAssignment` versus a new `HrDocumentGrant`.**
RULED: extend the existing mechanism; do **not** create `HrDocumentGrant`.
`appliesTo: "all"` **is** the company-wide grant and needs no row; `"selected"`
means the assignment rows govern. Extend `HrDocumentStoreAssignment` additively
with `granteeType` (`STORE | STAFF`) and a nullable `staffMemberId`, with
integrity rules (STORE rows carry `storeId`, STAFF rows carry `staffMemberId`).
Existing rows are all STORE-shaped, so the migration is purely additive. New
uploads default to `"selected"` with zero rows — ADMIN-only until assigned. The
four existing `appliesTo` call sites stay correct rather than being orphaned.
One audience mechanism in the schema, no dormant twin.

**R3 — corporate staff and Square's every-store expansion.**
RULED as flagged. The policy function carries training's explicit
corporate-exclusion branch: STORE grants never reach corporate staff despite the
expansion. Copy `bulk/route.ts:187` in spirit.

**R4 — the audit artifact.**
RULED: write it now, as `docs/prompts/DOC-1_A_AUDIT.md`, capturing the
fifteen-path table, the dormant-mechanism finding with the measured dev numbers,
and the attest-path gap. That artifact is the only file writable before the plan
is approved.

Additional standing direction given with the rulings: follow `lib/training.ts`
— pure policy function plus query-shaped twin, kept adjacent, reader shape
required not optional; STORE logins resolve from `StoreUserAssignment`, not the
roster; signed records remain permanent regardless of grant changes.
