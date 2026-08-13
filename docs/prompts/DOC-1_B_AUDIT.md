# DOC-1 Phase B — audit: the assign dialog, the visibility toggle, audience legibility

Session 2026-08-12. TIER 3. Starting state: `staging` at `3222188`, tree clean
apart from four untracked drafts in `docs/prompts/`.

**No database query and no browser observation was made during the audit
phase.** Everything in §§1–7 is derived from source. The measurements in §9 were
taken later, during verification, and carry their branch.

---

## 1. The pattern Phase B copies: HR-22 bulk assign

`GET /api/hr/training/assignments/bulk/recipients` is the model, and the thing
worth copying is not its markup but its **division of labour**. It returns

```
{ caller: { isAdmin },
  stores: [{ id, name, expandsTo }],
  staff:  [{ id, displayName, storeIds, isCorporate, hasLogin, eligibility }],
  trainers: [...] }
```

with every rule already decided server-side, and `bulk-assign-dialog.tsx`
renders what it is told. Its header states the rule in one line: *"EVERY RULE ON
DISPLAY HERE IS THE SERVER'S."*

Three details in that route are load-bearing and were carried across:

- **`expandsTo` is not `staffCount`.** It counts ACTIVE, non-corporate staff
  rostered to that store (`recipients/route.ts:87`). The comment cites CHK-3 —
  a field's name is not evidence of what it counts.
- **Stores are NOT filtered on `isActive`** (ruled 2026-08-11): deactivating a
  store does not un-employ the people rostered to it, and hiding it would
  strand them behind a picker that cannot reach them.
- **The dialog is keyed by subject id by its parent**, so a different subject
  gets a fresh mount. Resetting inside the effect body would be a synchronous
  `setState` in an effect, which `react-hooks/set-state-in-effect` rejects.

### 1.1 What documents must NOT copy

| HR-22 has | Documents | Why |
|---|---|---|
| `eligibility` per person | dropped | A grant is a standing rule, not a per-person row. "Already assigned" has no referent. |
| trainer, due date | dropped | No assignment record to attach them to. |
| the compliance-dip disclosure | dropped | See §5. |
| `mode: "all-in-scope"` | replaced | ADMIN-only means scope is always the org. "Everyone" is a *different thing* — `appliesTo = "all"`, not a sweep of today's roster. |
| a materialized assignment per person | replaced by grant rows | The structural difference between the two features. |

Training **materializes** (a snapshot of today's roster); documents write
**grants** (standing rules resolved through the roster at read time). A new hire
at a granted store picks the document up on their next page load with nothing
re-run. This is ruling 1 from Phase A and it is why the dialog edits an
*audience* rather than stamping rows.

---

## 2. Reach counts: exact reuse was available

`grantedToStaff(doc, staff)` is pure and synchronous, and `GrantedStaff` is
`{ id, isCorporate, storeAssignments: [{ storeId }] }` — precisely the select
the recipients query already makes. So a per-store reach count can be obtained
by calling **the policy function itself** against a document that would exist:

```ts
grantedToStaff(
  { organizationId, kind, appliesTo: "selected",
    grants: [{ granteeType: GRANTEE_STORE, storeId, staffMemberId: null }] },
  staffMember
)
```

**A `reachOfStoreGrant()` helper added beside `grantedToStaff` would have been
the wrong answer**, and this is the one design decision in the phase worth
restating. It reads as tidier. But it would be a *second expression of one
rule* — the exact thing `lib/hr-documents-access.ts`'s header says the module
exists to prevent, and the exact shape of drift the prompt names. The synthetic
document is how you ask the real function a hypothetical. The corporate
exclusion (R3) then cannot be forgotten in the dialog, because it is not
restated there.

### 2.1 The status divergence — RULED (a)

The policy has **no employment-status test anywhere**. `grantedToStaff` and
`staffAudienceWhere` both reach a TERMINATED staff member. HR-22's `expandsTo`
counts ACTIVE only.

Ruled by Gary 2026-08-12: reach counts load ACTIVE staff only, counted via
`grantedToStaff`, worded "reaches N" per HR-22. This is a **named divergence
between what the picker COUNTS and what the policy ADMITS**, not drift: it is
the right number for an operator, and every `/my/*` read requires an ACTIVE
profile server-side regardless.

**Carried to Phase C by the same ruling:** compliance denominators must count
ACTIVE staff only. Recorded on the DOC-1 row.

---

## 3. The `isActive` sweep — eleven of twelve clean

| Path | `isActive: true`? |
|---|---|
| `(app)/hr/documents/page.tsx:39` | yes |
| `api/hr/documents/[id]/download/route.ts:26` | yes |
| `(app)/hr/acknowledge/[documentId]/page.tsx:36` | yes |
| `(my)/my/documents/data.ts:38` | yes |
| `(my)/my/documents/page.tsx:60` | yes |
| `(my)/my/documents/[documentId]/page.tsx:25` | yes |
| `api/hr/documents/[id]/acknowledgments/route.ts:72` | yes |
| `(app)/staff/[id]/page.tsx:170` (Documents tab) | yes |
| `(app)/staff/[id]/page.tsx:257` (Agreements tab) | yes |
| `lib/hr-compliance.ts:162` | yes |
| `lib/hr-compliance.ts:483` | yes |
| **`api/hr/documents/[id]/signed-record/route.ts:30`** | **NO** |

### 3.1 The gap is correct — RULED (b)

`POST .../signed-record` is the recovery path: if the synchronous generator
failed after the last checkpoint was captured, this idempotently produces the
signed PDF. `ensureSignedRecord` refuses an incomplete checkpoint set, so
nothing can be minted early.

The obvious fix is the wrong one, and it was reported as a RULING NOW rather
than actioned as a FIX NOW for that reason. Adding the filter would mean: a
person signs everything → the PDF generator fails → an admin archives the
document → their completed signature can now **never** become its artifact.
That is the opposite of the ratified ruling that completed signed records are
permanent. Archiving is a visibility decision and must not reach backwards into
signatures already given.

Ruled by Gary 2026-08-12: the carve-out stays, with a comment stating it and its
reasoning. No code change. The comment shipped in `e18dd54`.

---

## 4. Archive was already one-way, and that is what item 2 actually was

The prompt scoped item 2 as "expose the existing `isActive` flag as an ADMIN
control". The audit found the control already half-exists and the missing half
is a defect, not a feature:

- `ArchiveDocumentButton` has shipped since HR-4 (`documents-client.tsx:419`).
- `PATCH /api/hr/documents/[id]` has always accepted `isActive: true`
  (`route.ts:11`) — the write half of restore was already there.
- But the library filtered `isActive: true` **unconditionally, including for
  ADMIN**, so archiving removed the row from the only surface that lists it.
- `/hr/documents/[id]` renders an "Archived" badge with no toggle, and is linked
  only for `kind: "Acknowledgment"`.

**Net: an archived Reference document was reachable only by typed URL.** "Hide,
never delete" (ruling 8) was in practice "hide forever". Phase B therefore had
to make ADMIN *see* inactive rows, not build a toggle.

---

## 5. Why the dialog shows no live total

HR-22 computes a `previewCount` in the browser and labels it advisory
(`bulk-assign-dialog.tsx:117-119`), which it can afford because its POST reports
the server's own figures afterwards. Copying that here would mean this file
holding a second copy of the corporate-exclusion rule — §2's mistake, one layer
out. So per-store "reaches N" is server-computed, and the aggregate is shown
only *after* the save, from the PUT response.

**The disclosure HR-22 needs also has no analogue here.** Its warning exists
because a training assignment enters the compliance denominator the instant it
is written and a due date does not hold that back — a permanent consequence at
the moment of the click. An audience edit is reversible and lossless by ruling.
A pre-commit warning would be claiming a consequence that does not exist.

---

## 6. Scenario 4 (freeze/resume) — verified, nothing to build

`HrDocumentAcknowledgment` rows are created and **never deleted anywhere in
`src/`**: one `createMany` at `acknowledgments/route.ts:278`, and the only
`deleteMany` calls live in `scripts/verify-hr8-compliance.ts` (fixture cleanup)
and `scripts/reset-signing.ts`. `HrSignedRecord` is likewise create-only. Grant
rows cascade *from* document/store/staff; nothing cascades *from* a grant.

So today, with no new code: removing a grant makes the acknowledge page
`notFound()` and the capture POST return 403, leaving partial rows intact and
frozen; restoring the grant resumes at the same checkpoint under the same
`signingCycle`. **The ratified ruling holds under current behaviour.** Phase B's
obligation was therefore purely negative — the audience writer touches no
acknowledgment row — and it does not.

*(A note on the search: `scripts/` is outside `src/`. Phase A's audit missed a
writer for exactly this reason and had to correct itself on the row. A sweep is
only as complete as the directory it searched, so this one names both.)*

---

## 7. RULING NOW, raised at hard stop 2 — Phase A closed the Agreements tab to every new form

`createFillableForm` (`lib/hr-forms.ts:96`) does not set `appliesTo`. Phase A
flipped the column DEFAULT from `"all"` to `"selected"` on 2026-08-12.
Therefore **every FillableForm built after that migration is born with an empty
audience.**

- `/hr/forms` never notices — `canReadHrDocument`'s FillableForm branch does not
  consult the audience at all (ADMIN/MANAGER, unchanged by Phase A).
- `lib/hr-compliance.ts:483`'s org-level Agreements panel never notices — no
  audience filter.
- **`/staff/[id]`'s Agreements tab does**, because Phase A ruled it IN
  (`page.tsx:267`, `staffAudienceWhere`) so both tabs of one page share one rule.
- And **nothing in the application can grant a form an audience**: the assign
  dialog is scoped to the document library, which excludes FillableForm by
  construction (`HR_DOCUMENT_KINDS`).

Net: new forms were invisible on every staff member's Agreements tab,
permanently and unfixably. Provable from source; no query was needed to
establish it.

**Options priced at the stop:** (i) `createFillableForm` sets `appliesTo: "all"`;
(ii) extend the dialog to `/hr/forms` — a much larger phase; (iii) drop the
audience filter from that tab — contradicts Phase A's ruling 1; (iv) file a row
and ship with the hole open.

**Ruled (i)** by Gary 2026-08-12, admitted into Phase B scope as a FIX NOW: a
Phase A regression repaired at one line, not a rider. `"all"` restores
pre-DOC-1 behaviour exactly — every form predating the migration carries it, and
the clause that tab used before Phase A *was* the `appliesTo: "all"` disjunct.
Forms stay out of the grant mechanism, which is the point of the value chosen.

A correction to Phase A's own claim follows from this and is recorded on the
DOC-1 row: **"NOTHING GOES DARK BETWEEN PHASES" was true for documents and false
for forms.**

---

## 8. What shipped

| File | Change |
|---|---|
| `api/hr/documents/[id]/audience/route.ts` | NEW. GET (picker population + current audience) and PUT (the write), both ADMIN. |
| `lib/hr-document-audience.ts` | NEW. `computeAudienceDelta` — pure, so a script can call the shipped function. |
| `(app)/hr/documents/assign-audience-dialog.tsx` | NEW. |
| `(app)/hr/documents/page.tsx` | ADMIN sees inactive rows; audience fields passed to the client. |
| `(app)/hr/documents/documents-client.tsx` | Chip, Assign action, archived disclosure, Restore, row extracted to `DocumentRow`, empty-state copy corrected. |
| `lib/hr-documents.ts` | `hrAudienceLabel` / `hrAudienceChipStyle`. |
| `lib/hr-forms.ts` | §7's one line. |
| `api/hr/documents/[id]/signed-record/route.ts` | §3.1's comment. |

Two design points worth keeping:

**Losslessness is a type, not a promise.** The PUT body is a Zod discriminated
union on `appliesTo`. The `"all"` branch carries no selection arrays at all, so
the route *physically cannot* delete a grant row on that path — the parser
refuses the fields that would let it.

**The picker offers terminated grant-holders.** With an ACTIVE-only population,
a delta write silently revokes anyone terminated since their grant was made:
they would be absent from the submitted set, so the delta would drop them.
Verified both ways on dev (§9) — the ACTIVE-only population produces exactly one
spurious removal on the fixture, the shipped population produces none.

**Chips count grant ROWS, not people.** Putting a reach count on every library
row would mean either a second read per render or a browser-side copy of the
corporate rule. "2 stores" is a fact the row already holds; "reaches 7" is the
dialog's job.

---

## 9. Verification — dev `br-broad-wave-a6vpjdw0` / `neondb`, 32/32

Organization row `cf888f2d-f234-48c7-8097-fd5b44b5b3dd`, `clerkOrgId`
`org_3FhYUR4l0ue7egug1I0Ig8wxOVn` (Keva Juice). **That is a production-ORIGINATED
Clerk org id sitting on a dev-branch row** — dev was forked from production and
inherited it (CLAUDE.md § Browser Evidence, correction of 2026-08-06). It is
named here as what it is; the branch label above is what makes the result
evidence.

Passed: new documents born `"selected"` · store-grant reach counts ACTIVE
non-corporate only (2, correctly excluding the corporate and the terminated
fixture) · store grant reaches that store and nobody else · corporate excluded
(R3) · dialog reach count equals measured policy reach · delta adds only what is
new · an individual corporate pick grants exactly that person · surviving rows
keep their original `createdAt` across an unrelated edit · Everyone reaches
everyone · **the Everyone flip deletes zero grant rows (3 → 3)** · narrowing back
restores the audience exactly · the ACTIVE-only picker *would* have revoked the
terminated grant and the shipped one does not · `hrdoc_grant_shape` CHECK rejects
a STORE row carrying a staff member (23514) · the partial unique index rejects a
duplicate STAFF grant (23505) · archived vanishes from the non-admin library
query and from the `/my` + `/staff` audience query, stays listed for ADMIN, and
returns for non-admins on restore · six chip states · fixtures removed and
removal asserted, grants cascaded.

All fixtures named `DOC-1B …`.

**`FillableForm` rows with `appliesTo = 'selected'` on dev: 0**
(branch `br-broad-wave-a6vpjdw0` in the same query output).

### 9.1 What was NOT verified, and why

**The HTTP route was not exercised end to end.** Reaching it needs an
authenticated ADMIN session, and signing in would mean entering credentials,
which is not something this session may do. What was verified instead: the
delta — the load-bearing part — was extracted precisely so a script could call
the *shipped* function rather than a re-typed copy, and the policy, the
constraints and the query fragments were measured directly against dev. The
untested surface is the HTTP shell: the guard, the Zod parse, the transaction
composition and the response shape.

The chips and the archived disclosure were rendered in a browser via a temporary
page under the public `/menu` route (removed before the work commit; no console
errors). All five active chip states and both archived rows rendered correctly,
with Sign/Download correctly suppressed on archived rows.

**Both gaps belong to the staging pass**, which also still owes Phase A's
STORE-login (shared iPad) walk-through.
