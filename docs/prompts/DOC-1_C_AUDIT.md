# DOC-1 Phase C — Audit: audience-scoped compliance counters

Written at hard stop 1, before the plan existed and before any source file was
touched. TIER 3. Session prompt: `docs/prompts/DOC-1_phase_C_compliance_counters.md`.

Phase A audit: `docs/prompts/DOC-1_A_AUDIT.md` (the fifteen-path table this one
extends). Phase B audit: `docs/prompts/DOC-1_B_AUDIT.md`.

---

## 0. The headline, first, because it changes what the phase is

**The question the prompt opens with — "3 of 5 Colorado people have signed the
handbook" — is not a question any surface in this application currently asks.**

There is no per-document completion counter anywhere in `src/`. Not on the
library, not on the admin document detail, not in an API route, not on a
dashboard. Every completion figure in the product is **per-STAFF-MEMBER**: for
each person, "how many of the items that apply to *you* are complete", summed
upward into store and org aggregates.

The one place a document's *population* is counted is the Phase B assign
dialog's `reaches` (`api/hr/documents/[id]/audience/route.ts:143,215`), and it
is already correct — ACTIVE-only, asked through `grantedToStaff`, per Gary's
ruling (a).

So Phase C, as scoped, is **not** "build the N-of-M denominator". It is: the
per-staff document set is currently chosen by a pre-DOC-1 rule that knows
nothing about STAFF grants and nothing about the corporate exclusion, and that
wrong set propagates into every aggregate the product renders. Fixing the rule
is what makes the aggregates answer the audience question.

Whether Gary *also* wants a per-document counter built is question **Q1** in §6.
It is a real in/out decision and this audit does not make it silently.

---

## 1. Scope of the audit

**Audited.** Every site in `src/` that renders, computes or returns a count,
percentage, ratio or denominator relating to HR document completion, signing
status, or the population a document applies to. Reached by: the Phase A
fifteen-path table; a `grep` for every counter identifier
(`ackedCount`, `requiredCount`, `docsDone`, `docsTotal`, `executedCount`,
`pendingCount`, `staffCount`, `fullyCompliant`, `requiredTotal`, `completedCount`,
`pct`, `_count`) across `(app)/hr/`, `(app)/staff/`, `(my)/`, `lib/hr-*`; a
`grep` for every `appliesTo` reference in `src/` outside `src/generated/`; a
`grep` for every `prisma.staffMember.findMany|count` in `src/`; and a directory
walk of `src/app/api/hr/**` and every HR page file.

**Not audited.** Training counters that do not pass through an `HrDocument`
(`lib/training.ts` and the `/hr/training` surfaces own their own audience rule
and are not in DOC-1's scope). Checklist/template `appliesTo`, which is an
unrelated column on unrelated models.

**Measured, dev branch `br-broad-wave-a6vpjdw0` / `neondb`** (branch id selected
in the same query output, CLAUDE.md § Database Evidence):

| branch | kind | appliesTo | isActive | docs |
|---|---|---|---|---|
| `br-broad-wave-a6vpjdw0` | Acknowledgment | all | true | 1 |
| `br-broad-wave-a6vpjdw0` | FillableForm | all | true | 2 |

`HrDocumentStoreAssignment` (the grant table): **0 rows, all granteeTypes.**
Zero-audience documents (`appliesTo <> 'all'` with no grant row): **0.**
`StaffMember`: **6 ACTIVE, 0 corporate, 0 TERMINATED** — all on
`br-broad-wave-a6vpjdw0`.

Two consequences carry into the plan. **(a)** Every defect below is latent on
dev today: with zero grant rows, `appliesTo = "all"` short-circuits every rule
and no wrong answer is currently reachable. The bugs become live the first time
an admin uses the Phase B dialog. **(b)** The verification fixture set must
CREATE a corporate staff member and a TERMINATED staff member — dev has neither,
so those two branches of the rule cannot be exercised against existing data.

---

## 2. Every counter surface, enumerated

Fifteen surfaces. The "Denominator today" column says what the number is
computed *over*, which is the thing Phase C either changes or deliberately does
not.

| # | Surface | File:line | What it renders | Denominator today | In/Out |
|---|---|---|---|---|---|
| C1 | `/hr/compliance` KPI — Overall Compliance | `(app)/hr/compliance/page.tsx:51-59` | `pct%`, sub-line `{completedCount} of {requiredTotal} required items complete` | sum over ACTIVE in-scope staff of *items that apply to them*, per the §3 rule | **IN** (via C-CORE) |
| C2 | `/hr/compliance` KPI — Fully Compliant | `page.tsx:60-69` | `{fullyCompliant}` of `{staffCount} active staff tracked` | same staff population | **IN** (via C-CORE) |
| C3 | `/hr/compliance` KPI — Needs Re-sign / Overdue | `page.tsx:70-89` | raw counts | same items | **IN** (via C-CORE) |
| C4 | `/hr/compliance` By Store table | `page.tsx:142-186`; rollup `lib/hr-compliance.ts:453-473` | `staffCount`, `{completedCount}/{requiredTotal}`, `{fullyCompliant} of {staffCount}`, `pct%` | staff grouped by primary store; items per §3 rule | **IN** (via C-CORE) |
| C5 | `/hr/compliance` per-employee table | `compliance-staff-table.tsx:126,132-140`; rows built `page.tsx:31-47` | `{docsDone}/{docsTotal}`, `pct%` | that member's document items per §3 rule | **IN** (via C-CORE) |
| C6 | `/hr/compliance` Agreements panel | `page.tsx:228-266`; rollup `lib/hr-compliance.ts:478-537` | per form: `executedCount`, `pendingCount`; plus a pending-countersign list | **no denominator at all** — raw submission counts over every active FillableForm in the org, no audience filter | **IN, but see §4 — it is a LIST question, not a denominator question** |
| C7 | `/staff` list compliance column | `(app)/staff/page.tsx:44-46,63-76,292,310,352,373`; `lib/hr-compliance.ts:359-374` | `pct%` per member | that member's items per §3 rule; TERMINATED forced to `null` | **IN** (via C-CORE) |
| C8 | `/staff/[id]` Compliance tab | `staff-compliance.tsx:37-49`; `lib/hr-compliance.ts:379-385` | per item: `{ackedCount} of {requiredCount} checkpoints`, `All {requiredCount} checkpoints acknowledged` | *checkpoints within one document* — per-person progress, not a population | **IN only via which documents appear** (the list is C-CORE's output); the checkpoint ratios themselves are untouched |
| C9 | `/staff/[id]` Documents tab | `(app)/staff/[id]/page.tsx:170-247`; `staff-documents.tsx:49` | `In progress · {ackedCount}/{requiredCount}` | checkpoints within one document; **document list already audience-filtered** (`staffAudienceWhere`, `:180`) | **OUT — adopted in Phase A** |
| C10 | `/staff/[id]` Agreements tab | `(app)/staff/[id]/page.tsx:257-322` | submission history per form, no counts | **document list already audience-filtered** (`staffAudienceWhere`, `:267`) | **OUT — adopted in Phase A** |
| C11 | `/my` open-items card | `(my)/my/page.tsx:46,71-74,194` | `{ackedCount}/{requiredCount} checkpoints` | checkpoints within one document; item list is C-CORE's output | **IN only via which documents appear** |
| C12 | `/my/documents` status badges | `(my)/my/documents/page.tsx:25`; `data.ts:34-56,92-93` | `In progress {ackedCount}/{requiredCount}` | **document list already audience-filtered** (`staffAudienceWhere`, `data.ts:40`) | **OUT — adopted in Phase A** |
| C13 | `/hr/documents/[id]` admin detail — per-checkpoint | `(app)/hr/documents/[id]/page.tsx:32,67`; `document-detail-client.tsx:718` | `acknowledgmentCount`, **never rendered as a number** — it drives the edit/delete lock only | every `HrDocumentAcknowledgment` on that checkpoint, all staff, all versions, all cycles, no filter | **OUT — and must STAY unfiltered, see §5.1** |
| C14 | `POST /api/hr/documents/[id]/acknowledgments` response | `acknowledgments/route.ts:305` | `{ complete, signedCheckpoints, signedRecordId }` | the submitting person's own checkpoints on one document | **OUT — per-person progress, no population** |
| C15 | `GET`/`PUT /api/hr/documents/[id]/audience` — `reaches` | `audience/route.ts:73,143,215,295` | "reaches N" in the assign dialog | ACTIVE staff, asked through `grantedToStaff` | **OUT — already correct. This is Phase C's PRECEDENT, not its work** |

Two more counters exist near this area and are named so the enumeration is
provably complete rather than merely long:

- `/hr/documents` library **audience chips** — `(app)/hr/documents/page.tsx:70-71`,
  `lib/hr-documents.ts:65-82`. Counts **grant ROWS, not people** ("2 stores").
  Phase B decided this deliberately: a per-row reach count would cost a second
  read per render or a browser-side copy of R3. **OUT.**
- `/hr/forms` builder **submissionCount** — `(app)/hr/forms/page.tsx:26,39`,
  `(app)/hr/forms/[id]/page.tsx:24,69,76`. FillableForm builder surfaces,
  explicitly out of scope by the session prompt. **OUT.**

**An enumerated ABSENCE.** The prompt names "acknowledgment-status routes
(HR-3)" as a place to look. **There is no such route.** A directory walk of
`src/app/api/hr/**` returns 49 files; none of them returns an acknowledgment
status list or count. Every status figure in the product is computed
server-side inside a page (`/staff/[id]`, `/my`, `/my/documents`) or inside
`lib/hr-compliance.ts`. C14 is the only acknowledgment-related API response
carrying a count, and it is one person's own progress. Nothing to adopt here.

**A second enumerated absence.** Neither `/dashboard` nor `/store-view`
references HR compliance in any form (`grep` for `hrDocument|hr-compliance|Compliance`
across both trees: zero hits). There are no dashboard compliance widgets.

---

## 3. C-CORE — the compliance rollup (Phase A site #10), in detail

`src/lib/hr-compliance.ts`. Everything marked IN above flows through this one
function, `computeStaffComplianceDetails` (`:139`). C1–C8 and C11 all reduce to
it; there is exactly one rule to change and it is at `:258-262`.

### 3.1 What it does today

```
:145  staff = StaffMember.findMany({ organizationId, ...(staffIds ? {id:{in:staffIds}} : {status:"ACTIVE"}) })
         include storeAssignments (ordered isPrimary desc) → store {id,name}
:159  docs  = HrDocument.findMany({ organizationId, kind:"Acknowledgment",
                                    isActive:true, requiresAcknowledgment:true })
         include checkpoints(required), versions, grants{granteeType, storeId}
:249  for each member:
:250    memberStoreIds = member.storeAssignments.map(a => a.storeId)
:258    applies = d.appliesTo === "all"
              || d.grants.some(g => g.granteeType === "STORE"
                                 && g.storeId !== null
                                 && memberStoreIds.includes(g.storeId))
:263    if (!applies) return []          ← the document is not in this person's items
```

The rest of the member loop (version pinning, signing cycle, checkpoint
completion, status derivation `:264-305`) is HR-4/HR-15 machinery and Phase C
does not touch a line of it.

### 3.2 The three defects in that rule

**(i) STAFF grants are invisible.** The disjunct only tests `granteeType ===
"STORE"`. A document granted to a named individual (the Phase B dialog's
"Choose stores or people" → people) **does not appear in that person's
compliance items at all** — not in their `requiredTotal`, not on their profile's
Compliance tab, not on `/my`, not in any store or org total. They owe it
(`grantedToStaff` says so, so `/my/documents` shows it and the signing write
accepts it) and compliance says they don't. C9/C12 and C-CORE would disagree
about the same person and the same document, which is exactly the fragment/
function drift `lib/hr-documents-access.ts`'s header exists to prevent.

**(ii) The corporate exclusion (R3) is absent.** `memberStoreIds` for a
corporate staff member is *every store in the org* — Square expands corporate
staff to a `StoreStaffAssignment` per store (`StaffMember` schema comment, and
the reason R3 was ruled). So the moment any STORE grant exists, every corporate
member is swept into it, and the document lands in their compliance items as an
obligation they can never discharge from a surface that will show it to them
(`/my/documents` uses `staffAudienceWhere`, which *does* exclude them at
`hr-documents-access.ts:213-215`). Their `pct` drops, permanently, for a
document they will never be shown.

**(iii) The rule is a second expression of the policy.** It is a hand-written
copy of one disjunct of `grantedToStaff`, sitting in a different module, with
no comment binding it to the original. Phase A left it deliberately and marked
it (`:168-175`, `:254-257`); this session is the adoption those comments name.

### 3.3 What ruling 2 (ACTIVE only) actually requires here

**The org rollup already filters ACTIVE, and it does so at the right layer.**
`getOrgComplianceRollup:398-417` selects `status: "ACTIVE"` before calling
`computeStaffComplianceDetails`. The policy module has no employment-status test
(`grantedToStaff` never reads `status`), which is the named divergence on the
DOC-1 row — and it stays that way. **Ruling 2 is therefore already satisfied for
every population denominator in the product**, and Phase C's job on this ruling
is to *preserve* it while changing the document rule, plus write the reasoning
down at the call site so the next reader does not add a status test to the
policy module.

One nuance the plan must state rather than trip over:
`computeStaffComplianceDetails` does **not** filter ACTIVE when `staffIds` is
passed (`:146`). That is correct and deliberate — `getStaffComplianceSummaries`
(`:359`) passes the whole `/staff` roster including TERMINATED members and zeroes
them afterwards (`:368-371`), and `getStaffComplianceDetail` (`:379`) passes one
id so a terminated person's own profile still shows their auditable records.
Ruling 2 governs **who is counted in a population**, not **whether a terminated
person's own history renders**. Phase C must not "fix" `:146`.

### 3.4 Ruling 4 (numerator from the same population) needs no separate work

Scenario 1 (Jamie transferred out of the audience): under the corrected rule the
document simply stops being in Jamie's items. `requiredTotal` −1 and
`completedCount` −1, together, in the same `.flatMap` — numerator and
denominator are structurally incapable of being drawn from different
populations, because in this architecture they are the same array
(`:331-333`). Jamie's `HrSignedRecord` and `HrDocumentAcknowledgment` rows are
untouched; nothing in `hr-compliance.ts` writes.

This is worth stating because it is the one ruling that could have implied a
numerator-side change and does not. The verification must still assert it
(Jamie's record survives *and* stops counting) — asserting a property the
architecture gives you for free is how you find out it stopped being free.

### 3.5 The shape of the fix — no new query, no N+1

`grantedToStaff` needs `GrantedStaff = { id, isCorporate, storeAssignments:[{storeId}] }`.
All three are already in memory: the `:145` fetch has no `select`, so every
scalar including `isCorporate` comes back (it is already read at `:340`), and
`storeAssignments` are already included with `storeId`.

`AudienceDocument` needs `{ organizationId, kind, appliesTo, grants }`. The
first three are already on the row. `grants` is loaded but **selects only
`granteeType` and `storeId`** (`:176`) — `staffMemberId` is missing, which is
defect (i)'s mechanical cause. `AUDIENCE_INCLUDE` (`hr-documents-access.ts:245`)
is the named shape that selects all three.

So the adoption is: swap the `:176` include for `AUDIENCE_INCLUDE`, and replace
the `:258-262` expression with a call to `grantedToStaff`. One query, one JS
pass, same batching, no per-staff read.

**The PREDICATE, not the fragment.** `staffAudienceWhere` is the query twin and
is the wrong tool here: it narrows *one query per staff member*, and this
function deliberately fetches the org's documents **once** and filters in JS for
every member (`:158-197` is a fixed set of batched queries, never per-staff —
the header at `:128-129` says so). Asking `grantedToStaff` per (doc, member)
keeps that property and satisfies the one-expression constraint. This mirrors
Phase B's decision to ask the real predicate a hypothetical rather than add a
helper.

---

## 4. C6 — the agreements panel (Phase A site #11), in detail

`lib/hr-compliance.ts:478-537`.

```
:482  forms       = HrDocument.findMany({ organizationId, kind:"FillableForm", isActive:true })
                      select {id, title}  — NO audience filter of any kind
:488  submissions = FormSubmission.findMany({ staffMemberId:{in: staff ids in scope}, ... })
:508  formRollups = one row per active form, executedCount 0 / pendingCount 0
:512  for each submission: bump executedCount (Completed) or pendingCount (PendingSupervisor)
:515    a submission whose form is NOT in formRollups (archived) ADDS the row back
```

**This surface has no denominator.** `executedCount` and `pendingCount` are raw
counts of submissions; nothing is rendered as "N of M". The panel's own header
says so — "Tracked separately — executions don't count toward compliance
percentages" (`page.tsx:204`) — and the module header records the reason
(`:11-13`): there is no assignment mechanism saying who is *supposed* to hold a
form. Both are ratified by `docs/DECISIONS.md` (Gary, 2026-07-22).

**Therefore "adopting the audience" here changes WHICH FORMS ARE LISTED and
changes no number.** That is a materially different act from C-CORE's, and it is
question **Q2** in §6.

What the change would actually do, measured rather than assumed:

- All FillableForm rows on dev are `appliesTo = "all"` (§1). `createFillableForm`
  sets `"all"` explicitly since Phase B (`lib/hr-forms.ts:124`), and the Phase A
  migration left pre-existing rows at `"all"`. So an audience filter on `:482`
  is a **no-op on dev today**.
- It is **not provably a no-op on staging.** Staging has had the Phase A default
  flip since Gary's push earlier on 2026-08-12, and the Phase B one-line fix
  landed after it. Any form created on staging in that window was born
  `appliesTo = "selected"` with zero grants — and nothing in the application can
  ever give a form a grant, because the assign dialog 404s FillableForm ids by
  construction. Such a form would **vanish from the agreements panel** under an
  audience filter, taking its execution history's *listing* with it (the
  submissions themselves would re-add the row at `:515` only if a submission
  exists). This is the outstanding staging query already recorded on the DOC-1
  row.
- The counts are already scoped by *staff*: submissions are limited to the staff
  in scope (`:490`), so a manager's panel already reflects their people.

The prompt's expected answer — "unchanged behavior, company-wide denominator" —
is achievable two ways, and the plan will recommend one at hard stop 2: filter
the form list through the same policy expression (correct-by-construction, but
can delist a `"selected"`-born form), or leave `:482` unfiltered with the
reasoning written down at the query (honest, zero risk, but leaves the panel the
one HR surface with no audience rule). §6 Q2 puts this to Gary.

---

## 5. Surfaces marked OUT, with the reason each

### 5.1 C13 — the admin detail's `acknowledgmentCount` must stay unfiltered

`(app)/hr/documents/[id]/page.tsx:32,67` counts every `HrDocumentAcknowledgment`
on a checkpoint — every staff member, every version, every signing cycle, no
filter. It is **never displayed as a number**. Its only consumer is
`document-detail-client.tsx:718`: `const locked = checkpoint.acknowledgmentCount > 0`,
which disables Delete with the tooltip "This checkpoint has been signed and is
part of the permanent record".

Filtering it by audience would be actively wrong. If the only person who ever
signed a checkpoint has since left the document's audience, an audience-filtered
count would read 0 and the checkpoint would become **deletable** — reaching
backwards into a signature already given, which is precisely what ruling 5
forbids and what the DOC-1 row's ruling (b) reasoning protects elsewhere. It is
a "has this ever been signed by anyone" question, and the unfiltered count is
the correct answer to it.

**Recommendation: leave the code alone, add a comment saying why**, so a future
reader sweeping for audience adoption does not treat it as a miss.

### 5.2 C9, C10, C12 — already adopted in Phase A

`(app)/staff/[id]/page.tsx:180` and `:267`, and `(my)/my/documents/data.ts:40`
all call `staffAudienceWhere(member)`. Their counters (`ackedCount/requiredCount`)
are checkpoint progress within one document — per-person, no population. No
Phase C work; the verification should still measure them before and after to
prove Phase C did not disturb them.

### 5.3 C14, C15 — per-person progress, and the precedent

C14 (`signedCheckpoints`) is the submitter's own count on one document. C15
(`reaches`) is already ACTIVE-only through `grantedToStaff` per ruling (a), and
its comment at `audience/route.ts:71-72` explicitly hands the other half to this
phase: *"Phase C owns the other half: compliance denominators must count ACTIVE
staff only."* C15 is the pattern C-CORE should read like when it is done.

### 5.4 Library chips and forms-builder counts

Grant-row counts and submission counts on ADMIN builder surfaces. Both decided
deliberately in earlier phases; both explicitly out by the session prompt.

---

## 6. Ambiguous — questions for Gary at hard stop 1

Per the prompt: *"anything ambiguous is a question at hard stop 1, not a silent
choice."*

**Q1 — Does Phase C build a per-document completion counter, or only correct the
existing per-staff ones?** §0: the "3 of 5 have signed the handbook" surface does
not exist. Phase C as scoped (sites #10 and #11) changes which documents each
person owes, which moves every aggregate — but no screen will ever say "3 of 5
for this document" unless one is built. Building one is new UI on a new query
and is a materially larger phase; not building it means the phase's motivating
sentence remains unanswerable in the product. **Recommendation: correct the
existing counters only (the prompt's literal scope), and file the per-document
counter as its own row.** Needs Gary's word either way.

**Q2 — Does the agreements panel (C6) get an audience filter at all?** §4: it has
no denominator, so a filter changes only which forms are listed, and the only
rows it can remove are `"selected"`-born forms that no application code can ever
un-strand. Options: **(a)** filter through the policy, accepting that a
staging-born `"selected"` form delists; **(b)** leave the query unfiltered with
the reasoning written at the call site, closing site #11 as "audited, ruled to
stay". **Recommendation: (b)** — it is the only option that cannot change a
number Gary has not asked to change, and the prompt's own expectation for forms
is "unchanged behavior". This is a RULING.

**Q3 — Is the corporate consequence understood and wanted?** Once R3 is applied
in C-CORE, a corporate staff member's compliance items will contain **only**
company-wide documents and their own individual STAFF grants — never a
store-granted one. On the ADMIN path corporate staff are in the org totals
(`:412-414` only excludes them when `scoped`), so org-wide `requiredTotal` will
drop relative to today the moment store grants exist. Today it moves nothing
(zero grant rows everywhere). Flagging it because it is a number moving for a
correct reason, which is the kind that gets reported as a bug. Not blocking —
R3 is already ratified and this audit assumes it applies.

**Q4 — Zero-audience documents.** The prompt defers this to hard stop 2 as a
RULING, so it is not a hard-stop-1 question. Recording the **measured current
behaviour** so the plan does not assume it: a zero-audience document
(`appliesTo = "selected"`, no grants) is **already excluded from every staff
member's items** — the `:258-262` expression evaluates false for everyone, and
so does `grantedToStaff`. The document therefore contributes 0 to every
denominator and appears on no compliance surface, while remaining visible to
ADMIN on the library with the "Unassigned" warning chip (Phase B). Adopting
`grantedToStaff` **preserves this exactly**. Any other treatment (0-of-0 row,
flagged) is net-new UI, not a refactor consequence.

**Q5 — Archived documents.** Also a plan-time statement, verified here by code
rather than assumed:
- C-CORE excludes them — `isActive: true` at `:164`. Archiving a document
  removes it from every compliance denominator immediately.
- C6's form list excludes them — `isActive: true` at `:483` — **but a submission
  against an archived form re-adds its row** at `:515-522` with the historical
  title, deliberately ("Submissions on archived forms are records too").
- Historical records are untouched in both cases: `hr-compliance.ts` performs no
  writes anywhere.
This matches the prompt's expectation ("excluded from active compliance,
historical records untouched") and needs no change.

---

## 7. Constraints this phase must not breach, checked against what it will touch

| Constraint | Status |
|---|---|
| No migration | **Confirmed unnecessary.** `HrDocument.appliesTo`, `HrDocumentGrant.granteeType/storeId/staffMemberId` and every index all exist (`prisma/schema.prisma:1588-1676`, DOC-1 A). The only shape change is a Prisma `select` widening — no SQL. |
| No policy-module semantic change | `lib/hr-documents-access.ts` is **read-only** for this phase. `grantedToStaff` gains no status test; ruling 2's ACTIVE filter stays in `hr-compliance.ts`. |
| No signing-flow change | `api/hr/documents/[id]/acknowledgments` and `signed-record` untouched. |
| No writes in counting paths | `hr-compliance.ts` contains zero write calls today and will contain zero after. |
| FillableForm builder untouched | `/hr/forms/**` and `lib/hr-forms.ts` untouched. C6 is the *compliance* panel, a different file. |
| `canReadHrSignedRecord` untouched | Lives in `lib/hr-files.ts`; not imported by anything in scope. |
| One expression of the audience rule | Satisfied by calling `grantedToStaff`, not by restating it (§3.5). |

---

## 8. What this audit did not establish

- **Nothing was verified in a browser.** Per the staging-SHA precondition, this
  work is not on staging; local HEAD is `0ebe4d4` and the deployed SHA was not
  checked because there is nothing yet to observe.
- **Staging's FillableForm `appliesTo` distribution is unmeasured** — the query
  recorded on the DOC-1 row from Phase B is still outstanding, and §4's risk
  assessment for C6 depends on it. It is a staging-pass item, not a blocker for
  the plan.
- **No count was re-derived from an independent expected set yet.** Every figure
  in §1 is a direct measurement; the "independently-computed expected set"
  discipline the prompt requires belongs to the verification, not to the audit.
- **The behaviour of C-CORE with grant rows present has never been observed
  anywhere**, on any branch, because no grant row has ever existed outside a
  fixture. Every defect in §3.2 is derived from reading the expression, not from
  seeing it produce a wrong number. The fixtures exist to make them produce one.

---

## 9. Carried checklist (restated, unchanged by this audit)

- STORE-login (shared iPad) staging walk-through — **still unobserved**, from Phase A.
- Live store-sweep assignment — **not yet observed on staging**, from Phase B.
- Staging query: FillableForm rows with `appliesTo = 'selected'`, branch column
  in the same output — **outstanding**, from Phase B; §4 above depends on it.
- **Hard stop 4 before any production promotion**: production `HrDocument` count
  on `br-sparkling-block`, branch column in the same output. Nonzero stops the
  promotion.
