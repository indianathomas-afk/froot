# Completion inventory — Item 1 audit

**Session prompt:** `docs/prompts/2026-08-15-signed-truth-and-assignability.md`
**Tier:** 3. Audit phase. No code edited. This file is the session's only write.
**Date:** 2026-08-15

---

## Precondition — PASSED

| Check | Expected | Measured |
|---|---|---|
| Local `HEAD`, branch `staging` | `ba1f38b` | `ba1f38be6dbb008e26af54636b359dd7ba5315e1` |
| `origin/staging` (after `git fetch origin staging`) | `ba1f38b` | `ba1f38be6dbb008e26af54636b359dd7ba5315e1` |
| Deployed staging | `ba1f38b` | alias `froot-git-staging-indianathomas-2483s-projects.vercel.app` → `dpl_GrfinMjYH1vThxEwyL7xUm23rZiL` (`froot-6hiodnnl4`, created 2026-08-14 17:37 PDT); `npx vercel ls --meta githubCommitSha=ba1f38be6dbb008e26af54636b359dd7ba5315e1` returns that same deployment |

Deployment identity matched by **deployment id**, not by URL similarity, per CLAUDE.md
§ Staging Verification. The `--meta` filter was given the full 40-character sha.

---

## Method

Static read of the working tree at `ba1f38b`. No database query and no browser
observation was taken — Item 1 asks which source each surface reads, which is a
property of the code. `src/generated/roadmap.ts` is excluded everywhere below: it is
generated prose, not a surface.

Four searches, each chosen to fail differently so a surface missed by one is caught by
another:

1. `HrSignedRecord` / `hrSignedRecord` references — finds everything reading the record.
2. `HrDocumentAcknowledgment` / `acknowledgment` references — finds everything reading
   checkpoints.
3. `allAcked` / `pending-record` / `ackedCount` — finds the derivation itself, which is
   what actually matters; a surface can render completion without naming either model.
4. Directory sweeps of `reports/`, `dashboard/`, `store-view/`, `api/dashboard/`,
   `components/hr/` for any HR-completion reference.

The point of (3) is that the defect is a *derivation*, not a query. Search 1 alone would
have reported `/my/documents/data.ts` as a signed-record reader — it does load
`signedRecords` — while missing that the same function then overrides that answer with a
checkpoint count.

---

## Summary

**Six independent expressions of "this document is signed."** Not one shared helper with
six callers — six separately written derivations, in six files, that must agree by
discipline and are not required to agree by construction. Every one of them treats a full
required-checkpoint set as completion.

Every user-visible completion surface in HR reduces to one of those six. There is **no**
surface that reports a document as signed by reading `HrSignedRecord` alone.

The reproduction on the test document exercised expressions **A2** (portal list) and
**A5** (ceremony resume) and produced exactly the reported symptom. **A1** and **A3**
would have produced the same claim on the admin side for the same signer, and were not
looked at during the reproduction.

---

## Tier A — the six predicate implementations

These are the sites that *decide*. Everything in Tier B renders what these return.

### A1 — `src/lib/hr-compliance.ts:361, 371`

```
const allAcked = requiredCount > 0 && d.checkpoints.every((c) => ackedIds.has(c.id))
…
if (currentRecord || allAcked) status = "complete"
```

**Reads:** both. `HrSignedRecord` at :243 (keyed version+staff+cycle, correct) **and**
`HrDocumentAcknowledgment` at :249 — then `||`s them, so the record is not required.

**Infers from checkpoints: YES.** This is the single highest-reach expression in the
codebase. It backs the `/staff` list percentage column, the `/staff/[id]` Compliance tab,
the whole `/hr/compliance` rollup (KPI cards, By Store, per-employee table), and `/my`'s
open-items list — four surfaces, one call, because DOC-1 Phase C deliberately reduced
them to it.

Note the header comment at :146–155, which states the intended contract and states it
including the defect: *"all required checkpoints acked → complete."* This is not drift
from a documented rule; the rule itself is the thing R1 overturns.

Consequence beyond a badge: `completedCount` (:423) feeds every percentage. A signer with
acknowledgments and no record makes a store read **100% compliant**.

### A2 — `src/app/(my)/my/documents/data.ts:74, 79`

```
const allAcked = requiredCount > 0 && d.checkpoints.every((c) => ackedIds.has(c.id))
…
if (currentRecord) status = "signed"
else if (allAcked) status = "pending-record"
```

**Reads:** both — `signedRecords` at :47, `acknowledgments` at :48.

**Infers from checkpoints: YES.** `pending-record` is a distinct status from `signed`
here, which reads like the defect is already handled. It is not: every consumer collapses
the two (see B1). **This is the surface that lied in the reproduction.**

### A3 — `src/app/(app)/staff/[id]/page.tsx:214, 219`

```
const allAcked = requiredCount > 0 && d.checkpoints.every((c) => ackedIds.has(c.id))
…
if (currentRecord) status = "signed"
else if (allAcked) status = "pending-record"
```

**Reads:** both.

**Infers from checkpoints: YES.** A line-for-line twin of A2 against a different subject
(the profile owner rather than the caller). Its own comment at :164–167 says it mirrors
the `/my` query "the same way" — accurate, and that is the problem: the copy was made
faithfully and now has to be corrected twice.

Additional defect in the same block, :231–237: `signedVersionNumber` is set to
`current.versionNumber` **when `allAcked`**, so the admin surface states a version number
for a signature that does not exist.

### A4 — `src/app/api/hr/documents/[id]/acknowledgments/route.ts:289`

```
const complete = doc.checkpoints.filter((c) => c.required).every((c) => ackedIds.has(c.id))
```

**Reads:** acknowledgments only (:284).

**Infers from checkpoints: YES.** Returned to both ceremony clients as `complete` at :325.
This is the capture route's own answer, computed before `ensureSignedRecord` is attempted
at :311 and **not revised by whether that attempt succeeded** — `signedRecordId` may be
`null` beside `complete: true`.

`signingUnavailable` (:308–321) narrows this for exactly one failure mode:
`UnconfirmedAnchorsError`. Any *other* generator failure — the `else` branch at :318,
which logs and continues — returns `complete: true, signedRecordId: null,
signingUnavailable: false`, and the client renders the executed screen. That path is the
same lie with a different cause, and R1 closes it where the anchor-specific flag does not.

### A5 — `src/app/(app)/hr/acknowledge/[documentId]/signing-client.tsx:94–95`

```
const [phase, setPhase] = useState<Phase>(() =>
  checkpoints.filter((c) => c.required && !c.done).length === 0 ? "done" : "consent"
)
```

**Reads:** the server-supplied per-checkpoint `done` flags, which are built from
acknowledgment rows (`/my/documents/[documentId]/page.tsx:43–51`, and the admin twin at
`hr/acknowledge/[documentId]/page.tsx:150–154`). No record is ever consulted.

**Infers from checkpoints: YES.** This is the *resume* path: the signer in the
reproduction, returning to the document, lands on the "done" screen — "a permanent record
including the date and time of each step you completed is kept" (:275) — with no record in
existence. Also reachable from the deep link on the portal list.

### A6 — `src/app/(app)/hr/acknowledge/[documentId]/acknowledge-client.tsx:74`

```
const alreadyComplete = pending.filter((c) => c.required).length === 0
…
if (finished || alreadyComplete) {  // :151 — renders "{doc.title} — complete"
```

**Reads:** the same `done` flags.

**Infers from checkpoints: YES.** The manager-attested twin of A5. `finished` comes from
A4's `complete` flag (:130), and the comment at :126 — *"'complete' is not 'recorded'"* —
shows the distinction was seen and then applied only to the `signingUnavailable` case at
:129.

---

## Tier B — renderers, all downstream of Tier A

No independent derivation; listed because each is a place the false claim is *stated*, and
each will need its copy changed even though its logic will not.

| # | File | What it renders | Source |
|---|---|---|---|
| B1 | `src/app/(my)/my/documents/page.tsx:17–29, 75–76, 89, 126` | Green **"Signed"** badge for `pending-record` (:21, same `case` arm as `signed`); buckets it under **Completed** (:76); shows **"All caught up — nothing to sign."** (:89) once the pending list empties; body text **"Signed v{n}"** (:126) | A2 |
| B2 | `src/app/(my)/my/page.tsx:72, 94–101` | Portal home open-items list; `filter(i => i.status !== "complete")` drops the member, then renders **"You're all caught up. Nothing needs your attention."** | A1 |
| B3 | `src/app/(app)/staff/[id]/staff-documents.tsx:34, 44–45, 112` | Documents tab: `pending-record` styled **green, identical to `signed`** (:34); label **"Signed v{n} · record pending"** (:45); a *Generate record* recovery button (:112) | A3 |
| B4 | `src/app/(app)/staff/[id]/staff-compliance.tsx:16, 25, 39–42` | Compliance tab: **"Complete"** badge, `success` variant; detail line **"All N checkpoints acknowledged (v{n}) · record pending"** | A1 |
| B5 | `src/app/(app)/staff/page.tsx:44, 63–76, 292/310/352/373` | Staff directory compliance **percentage** column | A1 |
| B6 | `src/app/(app)/hr/compliance/page.tsx:28` + `compliance-staff-table.tsx:154` | KPI cards, By Store rollup, per-employee table, **"No gaps — every tracked team member is fully compliant."** | A1 |
| B7 | `signing-client.tsx:262–282` | Executed screen — "a permanent record … is kept permanently" | A4, A5 |
| B8 | `acknowledge-client.tsx:151–160` | **"{title} — complete"** screen | A4, A6 |

B3 and B4 are the sharpest admin-side cases: an admin checking whether their team is
covered sees green, and B4 spells out in prose that the record does not exist while still
badging it Complete.

---

## Tier C — surfaces that already read the record, and need no change

Recorded so the next reader does not re-derive it, and so nothing here is disturbed by
Items 2–4.

| File | Reads |
|---|---|
| `src/app/(app)/hr/signed-records/page.tsx:21` | `hrSignedRecord.findMany` — a record list by construction; cannot show a phantom |
| `src/app/(my)/my/documents/page.tsx:41–50` | The **"Signed records"** section of the same page as B1 — records only. In the reproduction this section was correctly *empty* while the Completed section above it claimed a signature. Two halves of one page disagreeing, both rendered from the same request |
| `src/app/(my)/my/documents/records/[recordId]/page.tsx` | Single record view |
| `src/app/api/my/signed-records/[recordId]/route.ts` · `src/app/api/hr/signed-records/[id]/download/route.ts` | Record fetch / download |
| `src/lib/hr-signed-pdf.ts` — `ensureSignedRecord` | The mint. Layer (c), which held correctly in the reproduction and threw |
| `src/app/api/hr/documents/[id]/signed-record/route.ts:97–120` | Recovery mint; returns the ruled signer copy on `UnconfirmedAnchorsError` |

---

## Tier D — examined and ruled out, with the reason

| File | Why it is not a completion surface |
|---|---|
| `src/app/(app)/hr/documents/[id]/page.tsx:44, 79` → `document-detail-client.tsx:798` | `acknowledgmentCount` drives the checkpoint **edit/delete lock**, never rendered as a number. Explicitly ruled out by DOC-1 Phase C (Gary, 2026-08-12) and carrying a comment saying so |
| `src/app/api/staff/[id]/route.ts:205–206` | `count()` calls that **block deletion** of a staff member; no status derived |
| `src/app/(app)/hr/page.tsx` | Nav hub. Section headings only ("Signed Records", :149); no figures, no queries beyond org + role |
| `src/app/(app)/hr/documents/documents-client.tsx` | Library list. **No per-document completion counter exists anywhere in `src/`** — independently established by DOC-1 Phase C and re-confirmed here. This is why "3 of 5 have signed the handbook" is not a question any surface asks |
| `src/app/(app)/dashboard/**`, `src/app/(app)/store-view/**`, `src/app/api/dashboard/**` | Zero HR-compliance references (grep) |
| `src/app/(app)/reports/**` | Zero HR references except the word "Compliance" in the `/reports` page heading (`page.tsx:92`). `reports/operations` counts **checklists**, not documents |
| Training completion (`TrainingAssignment.status`, `hr-compliance.ts:403–407`) | A different predicate over a different model. It shares `ComplianceItemStatus` and the same badges, so it will be adjacent to every R1 edit, but no ruling here touches it |
| No store-sweep or checklist surface counts documents | Searched; the "sweep" hits in `src/` are all comments about *code* sweeps |

---

## Consequences for Item 2, stated but not decided

Item 2 asks for one shared, exported, pure helper on the `isSigningBlocked` pattern.
Two things about the six sites bear on that and are raised rather than resolved:

1. **A5 and A6 are client components** and never see a record — the server hands them
   `done` booleans only. A pure predicate cannot fix them by itself; whatever gates them
   has to be computed server-side and passed in, in both `page.tsx` files. That is a prop
   change in four files, not just a helper.

2. **A4 is an API contract**, not a display. `complete` is consumed by two clients. If the
   predicate moves the meaning of that field, both clients change with it — and the field
   currently means "the checkpoint set is full", which is a genuinely useful thing for the
   ceremony to know. It may want to stay and be *joined* by a record-derived field rather
   than be redefined. Flagging so the shape is chosen deliberately.

---

## Two questions for Gary at this checkpoint

### Q1 — Item 3's ruled question: image-only PDFs (raised by the prompt, § Item 3)

`isSigningBlocked` is `matched > 0 && confirmed == 0` (`src/lib/hr-anchors.ts:496`). An
image-only PDF with no text layer yields `matched 0, confirmed 0` and is therefore **not**
blocked — deliberately, per R3(i-a) as ratified 2026-08-14, because certificate-only
documents are legitimate.

R4 as ruled says a document is not assignable "until all fields have been validated", and
separately asks for "a warning if the fields are not detected." Those may or may not mean
an image-only document should also be blocked from assignment.

**Recommendation: do not block it; warn instead.** Reasons, in order of weight:

- Blocking it would make a legitimately certificate-only document permanently
  unassignable, with **no action an admin could take to clear the block** — there are no
  fields to confirm. That is a dead end, not a gate.
- It would silently overturn R3(i-a), which was ratified one day earlier and is the only
  definition of that trip-wire anywhere.
- The two statements in R4 are separable and the second one already names the right
  instrument: `matched == 0` is precisely "fields were not detected", so it is a
  **warning** condition, not a block condition. One predicate, two outcomes.

The cost of being wrong in this direction is an image-only document assigned with no field
marks — which is what a certificate-only document *is*. The cost in the other direction is
an admin unable to assign a valid document with no way to fix it.

### Q2 — R1's copy on admin surfaces (not raised by the prompt)

The verbatim R1 copy is **"In progress — ask your manager."** That is signer-facing and
correct on `/my` (B1, B2). Four of the eight Tier B surfaces are **admin-facing** — B3 and
B4 on `/staff/[id]`, B5 and B6 on `/staff` and `/hr/compliance` — where "ask your manager"
is addressed to the manager who is reading it.

This is the same collision HR-11d hit and ruled on: `hr/acknowledge/[documentId]/page.tsx`
:137–141 gives the ruled signer copy to signers and an actionable admin variant to
managers, and that divergence was flagged in the HR-11d row as one of two places the phase
went beyond the prompt's letter.

**I am not choosing this.** Options: (a) the verbatim string everywhere, accepting that
managers read it; (b) verbatim on `/my`, an admin variant on `/staff/[id]` (B5 and B6 are
percentages and badges with no sentence to change); (c) something else you word. If (b),
the admin variant needs your words — HR-11d established that copy on a legal-adjacent
surface is yours to rule, not mine to draft.

---

## Incidental finding — Item 4's gap, found while mapping the predicate

Not asked for at this checkpoint and **not a complete Item 4 answer** (every entry point
has not been enumerated). Recorded because it fell out of search 3 and is cheap to state.

`isSigningBlocked` has exactly one caller in `src/`: `getVersionAnchorReadiness`
(`hr-anchors.ts:501–508`). That function has exactly two callers:

- `src/app/(app)/hr/acknowledge/[documentId]/page.tsx:131` — the **admin/attested**
  ceremony route. Layer (b).
- `src/lib/hr-signed-pdf.ts:315` — inside `ensureSignedRecord`. Layer (c).

`src/app/(my)/my/documents/[documentId]/page.tsx` — the **staff portal ceremony**, the
route the signer actually opened — never calls it. It resolves the document, checks
`grantedToStaff` (:39), loads acknowledgments (:43) and confirmed anchors (:78), and
renders `SigningClient` (:95) with no readiness gate at any point.

So layer (b) was never bypassed in the sense of failing. **It was never present on that
path.** It was built on the admin route and not on its twin, and the comment at
`hr/acknowledge/[documentId]/page.tsx:122–125` states the guard "covers BOTH entry points"
— which is true of the two paths *through that file* (self and attested) and not of the
portal route in a different segment.

That same comment block, at :127–130, is the HR-11d §2b carve-out R4 supersedes: *"THE
GUARD IS AT THE CEREMONY, NEVER AT THE GRANT."*

Note the shape, which is the reusable part and the same shape as the DEBT-22 miss recorded
in that very file at :67–73: a guard added to one route and not to its copy in another
route group, where the grep that would find it (`isSigningBlocked`) returns a *clean*
result — one definition, one caller, all correct — because the missing call site has
nothing to match on. **Absence does not appear in a search for presence.**
