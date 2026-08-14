# HR-11d — signed-document stamping: Phase 0 audit

**Session:** HR-11d, TIER 3 (structural). Audit phase, read-only.
**Date:** 2026-08-14.
**Repo root:** `~/Claude_Projects/Froot/froot` (confirmed by `git rev-parse
--show-toplevel`). Branch `staging`, one unpushed commit (`06dc830`).
**Prompt of record:** `docs/prompts/HR-11d-stamping-regression.md`.

Nothing was fixed, no database was queried, no file outside this one was
written.

---

## 1. The question changed mid-audit, and that is the finding

The session was commissioned as a **regression** diagnosis: three behaviours
that "worked on 2026-07-24 and do not work now", evidenced by a signed record
stamped 7-24 with a rendered signature block on page 22 and a record completed
8-12 with page 22 blank.

Partway through, Gary confirmed from his side:

> I have never formalized a document in production. The 7-24 record is a
> dev/staging observation. This is NOT a regression — inline stamping has never
> run in production.

That withdraws the premise the entire hypothesis ladder was built on. There is
no 7-24 → 8-12 delta to explain, because there is no production 7-24 state. The
two artifacts are both non-production observations of the same system in two
different configurations: one where an admin had confirmed the version's field
anchors, one where nobody had.

**So the defect is not "what broke". The defect is what the system does when
nobody has confirmed anchors: it issues a record that says "completed",
appends a Certificate of Acknowledgment, and stamps nothing on the document
body — silently, with no signal at any point in the chain.** Gary's re-scoping
instruction names this directly:

> Treat that silent-hollow-artifact path as the defect, not just the
> unconfirmed anchors.

That is the frame the rest of this audit uses. R1 (re-issue of affected
records) is moot — there are no production signed records to re-issue.

This is also, on the evidence below, the **first real observation of a gap the
promotion of 2026-07-24 already knew about**. `docs/DEPLOY_LOG.md` for that
promotion carries, in its own words:

> **Open prod-verification items (carried from HR-11c blockers, not re-tested
> pre-promotion):** certificate org-name ("Microsoft") re-test in prod; mobile
> visual QA of lift offsets on /my signing.

HR-11b and HR-11c shipped to production and HR launched the same evening, with
the verification items open and no production smoke pass. The system then sat
for three weeks in a state nobody had exercised.

---

## 2. Method, and the limits on it

**Evidence rules observed.** No deployed-environment credential was written to
disk; `vercel env pull` was not run (CLAUDE.md bans it in this repo without
exception). No database was queried — this session had no production
connection by design, and the query pack it produced was handed to Gary to run
in the Neon console.

**What that means for this audit.** Every claim below rests on one of three
sources, and each claim names which:

1. **Git history and working-tree files** — measurable here, exactly.
2. **PDF artifacts on local disk** — measured with the repo's own code.
3. **Gary's direct confirmation** — for the production state, which is the only
   thing this session could not measure.

**What remains unmeasured, and is listed here so it is not mistaken for
settled:** the anchor rows behind the 8-12 artifact on whichever branch that
record lives. The mechanism is established from code and from a positive
control (§6), but the specific row count on that specific version was never
read. That is a Phase 2 staging measurement, not a Phase 0 blocker, and §11
records it as such.

---

## 3. Repo and history — the code did not regress

`59a6cdc` is the HR-11b/HR-11c production merge, `Merge branch 'staging'`,
2026-07-24 21:07:55 -0700.

### 3.1 The stamping libraries

```
git diff --stat 59a6cdc..HEAD -- src/lib/hr-signed-pdf.ts src/lib/hr-anchors.ts
 src/lib/hr-signed-pdf.ts | 11 +++++++++--
 1 file changed, 9 insertions(+), 2 deletions(-)
```

`src/lib/hr-anchors.ts` — **zero changes** since the production merge. The
detector, the vocabulary, the line reassembly, the fill-gate and the placement
resolver are byte-identical to what shipped on 7-24.

`src/lib/hr-signed-pdf.ts` — two changes, neither on the acknowledgment path:

- `89c70f7`, a `let` → `const` lint fix on the inline mark size (DEBT-33
  partial). No behaviour.
- `4adcb13` (DEBT-9), inside `ensureTrainingCertPdf` — a *different* exported
  function that generates training certificates. It replaces an inline
  `staff.storeAssignments[0]?.store.name` with `primaryStoreName(staff)` so a
  corporate trainee's certificate says "Corporate". `ensureSignedRecord` does
  not call it and is not affected.

**Stated plainly, as the prompt asks: the diff is empty of behaviour on this
path. The code did not regress. The cause is data and configuration — and,
per §1, not even a change in data, but a configuration that was never
established in the first place.**

### 3.2 The surrounding routes

Also byte-identical to `59a6cdc`:

- `src/app/api/hr/documents/[id]/versions/route.ts` (upload → detect)
- `src/app/api/hr/documents/[id]/anchors/route.ts` (admin confirm)
- `src/app/api/hr/documents/[id]/anchors/rescan/route.ts` (re-detect)

The HR document API did change since 7-24, but only in DOC-1's audience layer
and DEBT-9's corporate-staff resolution:

```
src/app/api/hr/documents/[id]/acknowledgments/route.ts   |  58 +++-
src/app/api/hr/documents/[id]/audience/route.ts          | 303 +++++ (new)
src/app/api/hr/documents/[id]/download/route.ts          |  17 +-
src/app/api/hr/documents/[id]/signed-record/route.ts     |  45 ++-
src/app/(app)/hr/acknowledge/[documentId]/signing-client.tsx | 24 +-
```

The `signing-client.tsx` diff was read in full: it hides the store picker for
corporate signers and is UX-only (the server ignores a submitted `storeId` for
those signers regardless). Nothing in it touches anchors, placement, or the
stamp block.

### 3.3 Schema history since 7-24

One HR-relevant migration: DOC-1 A's grant table (`d728da4`, 2026-08-12),
additive, `HrDocumentStoreAssignment` widened and renamed at the Prisma layer
via `@@map`. No column on `DocumentAnchor`, `HrDocumentVersion`,
`HrDocumentCheckpoint`, `HrDocumentAcknowledgment` or `HrSignedRecord` was
added, dropped or retyped.

### 3.4 Dependencies

`package-lock.json` since `59a6cdc` contains exactly one line mentioning any
PDF library, and it is a context line, not a change:

```
unpdf     1.6.2   (pinned, unchanged)
pdf-lib   1.17.1  (pinned, unchanged)
pdfjs-dist        (unchanged)
```

New dependencies in the window — `@tiptap/*` 3.30.0, `sanitize-html` 2.17.6,
`yaml` 2.9.0 — belong to HR-28's rich-text editor and the roadmap generator.
None is reachable from the stamping path. Vercel builds from the lockfile, so
the deployed versions are the pinned ones.

**Hypothesis F's dependency-drift arm is dead on this evidence.**

---

## 4. Schema — the real field names

The prompt warned that its column names came from documentation. Three were
wrong and were corrected silently in the query pack; they are recorded here so
the next reader does not re-derive them:

| Written in the prompt | Actually in `prisma/schema.prisma` |
|---|---|
| `v.<document fk>` | `HrDocumentVersion."hrDocumentId"` |
| `HrSignedRecord.createdAt` (implied) | `HrSignedRecord."generatedAt"` |
| checkpoint type as a relation | `HrDocumentAcknowledgment."checkpointType"` is a plain snapshot `String` |

Also load-bearing for the SQL: `DocumentAnchor."markType"` and
`DocumentAnchor.placement` are real Postgres enums (`HrAnchorMarkType`,
`HrAnchorPlacement`), created by
`prisma/migrations/20260723220118_hr11b_document_anchors/migration.sql`. Table
names equal model names throughout the HR module; `HrDocumentGrant` is the sole
`@@map`, onto the physical table `HrDocumentStoreAssignment`.

---

## 5. The code reading — where the hollow artifact comes from

### 5.1 The gate

`src/lib/hr-signed-pdf.ts:306-309`:

```ts
const anchors = await prisma.documentAnchor.findMany({
  where: { hrDocumentVersionId, confirmed: true },
})
if (anchors.length > 0) {
  // every inline stamp — SignatureStamp, Initial, PrintedName, Store,
  // DateStamp — lives inside this block
}
```

Zero confirmed anchors ⇒ the block no-ops. The page-1 completion banner is
drawn *before* it (`:274-298`) and the Certificate of Acknowledgment is
appended *after* it (`:417-524`), both unconditionally. So the output of a
zero-anchor run is a document that announces completion on page 1, carries a
full certificate at the back, and has nothing written on any signature line —
which is precisely the three reported symptoms, all three at once, from one
condition.

The comment above the block already says so, and calls it intended:

> Zero confirmed anchors (image-only PDFs, or documents never scanned/confirmed)
> => this block no-ops and the record is certificate-only, exactly the prior
> behavior. The certificate below is ALWAYS appended regardless.

That was a defensible HR-11b decision for **image-only PDFs**, where there is
no text layer and nothing could ever be stamped. It silently generalised to
**"documents never scanned/confirmed"**, which is a completely different
situation: a document that *can* be stamped, on a version that *should* have
been confirmed, and an operator who has no idea the step was missed.

### 5.2 The structural fault beneath it

Three predicates decide what a signed record is, and they read three different
sources with three different lifetimes:

| Predicate | Source | Lifetime |
|---|---|---|
| Is the signer done? | `HrDocument.checkpoints` (**document**-level) | carries forward across versions |
| What gets stamped? | `DocumentAnchor` where `confirmed` (**version**-level) | dies with the version |
| Where does it go? | `DocumentAnchor.x/y/placement/pageRotation` | dies with the version |

HR-11b ruling (a) made that split deliberately, and correctly: coordinates are
per-file, so anchors cannot carry forward; checkpoints are semantic, so they
can. But nothing reconciles the two halves afterwards. `ensureSignedRecord`
judges completion at `:249-252` against the document's checkpoints, finds
nothing missing, and mints the record — while the version's anchor set is
empty and the stamping block never runs.

**The completion predicate and the stamping predicate never have to agree, and
nothing anywhere notices when they don't.** That is the defect. "The admin
forgot to confirm" is the trigger; this is the reason the trigger is silent and
the reason the artifact still claims completion.

### 5.3 The corollary, and why it holds

`syncCheckpointsForConfirmedAnchors` (`hr-anchors.ts:448-495`) is the only
producer of `Signature` checkpoints: each confirmed `SignatureStamp` anchor
gets its own, so each signature is a distinct signer act with its own
timestamp. No confirmed `SignatureStamp` anchors ⇒ no `Signature` checkpoints
⇒ the ceremony never asks for a signature ⇒ the certificate's checkpoint table
shows no `Signature` rows.

So a hollow record is not merely unstamped. **The signer was never asked to
sign at all**, and the certificate — the part that is supposed to be the full
legal record — records that faithfully, while page 1 says "Completed by …".
The two halves of the same artifact disagree, and only the certificate is
telling the truth.

### 5.4 The two seams that create the condition

**Upload** — `src/app/api/hr/documents/[id]/versions/route.ts:90-92`:

```ts
if (isAcknowledgment && meta.bytes) {
  await detectAndStoreVersionAnchors(version.id, new Uint8Array(meta.bytes))
}
```

The return value is discarded entirely. `detectAndStoreVersionAnchors` was
built specifically so this could not happen — it returns a discriminated
`StoreAnchorsResult` (`stored`, `matched`, `pagesScanned`, `hadTextLayer`,
`error`) and its docstring says it "never collapses distinct outcomes into a
bare 0". The rescan route honours that and returns a 500 with the real message.
The upload route throws it on the floor. And when `meta.bytes` is falsy the
scan does not run at all, with no record that it was skipped.

Even on complete success this path leaves every anchor **unconfirmed**, because
confirmation is an admin act by design (HR-11b ruling (e)). So the normal,
non-error, everything-worked outcome of uploading a new version is a document
that will produce hollow records until somebody clicks confirm — and nothing
tells them to.

**Confirm** — `src/app/api/hr/documents/[id]/anchors/route.ts:63-76`: an
anchor submitted with `keep: false` is deleted, with no guard on whether it was
already `confirmed` or whether acknowledgments exist against the checkpoint it
generated. The G1 integrity rule protects *checkpoints* from deletion; nothing
protects confirmed *anchors*. A rescan-then-re-confirm pass that discards can
therefore strip a version that already has signed records against it.

---

## 6. Artifact measurement — the positive control

The 8-12 artifact is not obtainable from this session: the private `froot-hr`
Blob store needs `HR_BLOB_READ_WRITE_TOKEN`, and CLAUDE.md's ban on
`vercel env pull` has no read-only exception. What was on local disk:

| File | Bytes | sha256 |
|---|---|---|
| `froot_docs/hr_research/2026 Employee Handbook.pdf` | 15,252,557 | `d0860ff703be2f07b8dbe55d8c4b151c0e1337034cd55b79b905f012ea26e9a9` |
| `~/Downloads/2026-Employee-Handbook-KX77J1cmLWPV2p9U (1).pdf` | 15,252,557 | *identical to the above* |
| `~/Downloads/signed-Tommy-Thomas-v1-ORinqwXRZaTVCphI2wAFvMcA9PGEpD.pdf` | 15,132,252 | (7-23) |
| `~/Downloads/signed-Tommy-Thomas-v5-8gEPAuhr3R5xxAgV3XSOL5aIlQL6YJ.pdf` | 15,139,418 | (7-24) |

### 6.1 Detection, run with the repo's own code at HEAD

`detectAnchors` was executed against the source handbook — the module copied
verbatim minus its unused top-level `prisma` import, which `detectAnchors`
never touches:

```
28 pages, 3976 text items, 41 anchors
byMarkType:  Initial 27, DateStamp 5, PrintedName 4, SignatureStamp 4, Store 1
byPlacement: Right 35, Above 6
pagesWithAnchors: 1..28 (all)

page 1   PrintedName    Right  x=22.0   y=289.4  w=52.3  "Name:"
         DateStamp      Right  x=377.7  y=289.4  w=52.3  "Date:"
         Store          Right  x=22.0   y=223.4  w=61.9  "Store:"
page 22  SignatureStamp Above  x=36.0   y=118.1  w=96.7  "Employee’s Signature"
         DateStamp      Above  x=412.7  y=118.1  w=20.9  "Date"
         Initial        Right  x=484.6  y=38.8   w=43.0  "Initial:"
```

**Detection works on this handbook export, on today's code, including the
curly-apostrophe `Employee’s Signature` and the fill-gated bare `Date` on page
22.** Both were HR-11b ruling (l) refinements and both still fire.

### 6.2 The stamped output, and the arithmetic that ties it together

Page 22 of the v5 signed artifact:

```
[36.0,130.1]  "_____________________________________________________________________"
[412.7,130.1] "________________________________"
[36.0,118.1]  "Employee’s Signature"
[412.7,118.1] "Date"
[484.6,38.8]  "Initial:_________"
[36.0,131.1]  "Tommy Thomas"                                    ← stamp
[36.0,122.1]  "Signed electronically - 2026-07-24 13:55:29 UTC" ← stamp
[36.0,113.1]  "Record 3A44164CD69C"                             ← stamp
[412.7,129.1] "2026-07-24"                                      ← stamp
[531.6,38.8]  "GLT"                                             ← stamp
```

Page 1:

```
[22.0,289.4]  "Name:____________________________ Date:____________"
[22.0,223.4]  "Store:____________________________"
[78.3,289.4]  "Tommy Thomas"   ← 22.0 + 52.3 + 4 pad
[434.0,289.4] "2026-07-24"     ← 377.7 + 52.3 + 4 pad
[87.9,223.4]  "Las Brisas"     ← 22.0 + 61.9 + 4 pad
[207.8,772.5] "Completed by Tommy Thomas on 2026-07-24 13:55:29 UTC - Certificate of Acknowledgment appended"
```

Every stamped position is `computeStampPlacement` applied to the coordinates
§6.1 predicts, to the tenth of a point. The `Above` placements on page 22 sit
at `118.1 + 13` and `118.1 + 11`, matching the two line-height arguments in the
code (13 for the signature block, 11 for scalar fills).

**This is the positive control the diagnosis needs.** With confirmed anchors,
the whole chain — detect → confirm → generate checkpoints → capture → stamp —
works end to end and puts marks exactly where the detector said. Nothing in the
mechanism is broken. The variable is whether anyone confirmed.

### 6.3 Dating the v5 artifact

Two independent proofs place it **before** the production merge:

1. Its certificate labels the name row `Signer`. The dual `Name on record` /
   `Name as executed` rows were introduced by `232d568` at 2026-07-24 12:29:30
   -0700. The record's `completedAt` is 13:55:29 **UTC** = 06:55 PDT.
2. Its signature sub-lines stack *downward* from the stylized name (131.1 →
   122.1 → 113.1). The reader-**up** stacking for `Above` placements
   (`const up = placement === "Above"`) was introduced by `01c5ed9` at
   2026-07-24 07:50:25 -0700.

Both put generation before 07:50 PDT on 7-24; the production merge `59a6cdc`
landed at 21:07 PDT the same day. The artifact was produced by pre-HR-11c code,
roughly fourteen hours before HR existed in production.

**A third proof was drafted and is withdrawn.** The certificate prints
`Organization: Microsoft`, and this audit initially read that as evidence of a
non-Keva org. That inference is invalid: `DEPLOY_LOG.md` carries
`certificate org-name ("Microsoft") re-test in prod` as an **open** HR-11c
verification item, so the printed org name is a known-suspect field and cannot
be used to identify the org a record belongs to. Corrected by Gary, 2026-08-14.
The two proofs above do not depend on it.

The lesson generalises past this session and is the § Database Evidence failure
mode wearing different clothes: **a field with an open correctness bug against
it is not an identifier**, however plainly it reads. The org-name bug was
written down in the deploy log three weeks ago; it was still used as a filter
here because it appeared in a legal artifact and legal artifacts feel
authoritative.

---

## 7. Root cause

**`ensureSignedRecord` judges completion from document-level checkpoints and
drives stamping from version-level confirmed anchors, and when the second set
is empty it issues a record claiming completion with an appended certificate
and no marks on the document — with no signal at upload, at confirm time, at
the start of the ceremony, in the record, or in the artifact.** Inline stamping
has never been configured in production, so every production signing would have
produced that hollow artifact.

Proof, by source:

- The gate and its unconditional neighbours — `hr-signed-pdf.ts:274-309, 417`
  (working tree, HEAD).
- That the mechanism itself is sound — §6.2, measured, coordinates matching
  §6.1 to the tenth of a point.
- That production was never configured — Gary's confirmation, 2026-08-14.
- That the code did not change — §3.1, `git diff 59a6cdc..HEAD`.

No production database result is cited because none was taken; §2 and §11 say
so rather than implying coverage this audit does not have.

---

## 8. Hypotheses A–F

The ladder was built to explain a 7-24 → 8-12 delta. With the premise
withdrawn, most entries have no delta left to explain. Verdicts are given
against what the evidence actually supports, and "UNTESTED" is used honestly
rather than being quietly converted into "ruled out".

| # | Hypothesis | Verdict |
|---|---|---|
| — | **Leading:** zero confirmed anchors ⇒ silent certificate-only output | **CONFIRMED as the mechanism.** Code at `hr-signed-pdf.ts:306-309`; positive control §6.2 proves the converse. The specific anchor-row count behind the 8-12 artifact was not measured (§11). |
| A | New version uploaded since 7-24; anchors detected but never confirmed | **MOOT AS A REGRESSION, LIVE AS A STANDING RISK.** No production version was ever confirmed, so no upload needed to happen for the symptom to appear. The path remains exactly as described for every future upload — §5.4. |
| B | Same version; confirmed anchors discarded during rescan + re-confirm (`keep=false`) | **UNTESTED, and REPRESENTABLE.** `anchors/route.ts:63-76` deletes a `keep:false` anchor with no guard on `confirmed` or on existing acknowledgments. Whether it happened is a database question this session could not ask; that it *can* happen is measured, and is filed as an out-of-scope row (§10). |
| C | Detection ran and matched nothing — signature lines as graphics, not underscore runs (ruling (l) limitation) | **RULED OUT for this document.** §6.1: 41 anchors on the real handbook at HEAD, including the page-22 signature block. Ruling (l)'s graphics limitation does not bite this export. If production's current version is a different file, `Q5`'s `fileHash` comparison settles it; the fill-gate itself is not implicated. |
| D | `detectAndStoreVersionAnchors` failed silently at upload — best-effort, no error surfacing | **CONFIRMED as a code defect, independent of whether it fired.** `versions/route.ts:90-92` discards the discriminated result; the `meta.bytes` falsy branch skips detection with no record. This is R2 and it is real regardless of the regression question. |
| E | DOC-1 introduced a new version or document row as a side effect | **RULED OUT.** `d728da4`/`e18dd54`/`9133dcf` read in full: DOC-1 adds grant rows and read/write gates. It creates no `HrDocumentVersion` and no `HrDocument`. Its write gates *refuse* signatures for ungranted staff — which would prevent an artifact, not hollow one out. |
| F | Dependency drift (`unpdf` / `pdf-lib` / `pdfjs-dist`), `placement` change, `pageRotation` regression | **RULED OUT on the dependency arm** — §3.4, all three pinned and untouched in the lockfile. **RULED OUT on the code arm** — §3.1, `hr-anchors.ts` unchanged, `placement` and `pageRotation` handling identical. Whether any *stored* `placement` value is out of range is a data question, covered by `Q3a`. |

---

## 9. Blast radius

**Production: zero signed records affected, because zero exist.** Confirmed by
Gary, 2026-08-14. `Q6` and `Q7` in the query pack are retained as written
documentation of that state rather than as open questions.

The exposure is forward-looking, and it is total in the sense that matters:
**with the module live in production since 2026-07-24 and no document ever
anchor-confirmed there, every acknowledgment signed in production today would
produce a hollow artifact.** The reason none has is that none has been signed,
not that anything would have stopped it.

Non-production records exist on dev/staging (at least the 7-23 v1 and 7-24 v5
artifacts, plus whatever produced the 8-12 observation). They are test data;
HR-11b ruling (o) already establishes the precedent for scoped purges of
polluted staging signing data if that is wanted.

---

## 10. Proposed fix

No schema change is implied. **Stated explicitly, as the prompt requires: this
proposal touches no `prisma/schema.prisma` model and needs no migration.**
Every condition it tests is derivable from rows that already exist.

### 10.1 R3 — the structural fix, in three layers

**The trip-wire, and why it is Gary's condition rather than the broader one.**
The obvious guard — "refuse when the version has no confirmed anchors" — is
wrong, because it would also refuse the legitimate case HR-11b ruled
acceptable: image-only PDFs and pre-HR-11b documents that were always
certificate-only. The narrow condition Gary wrote in R3 is the correct one and
cannot be a legacy state:

> a document whose **current version has zero confirmed anchors** but whose
> **prior version had them**

That is a regression inside one document's own history. Nothing legitimate
produces it.

**(a) Detect it at the seam that creates it — upload.**
`versions/route.ts`, after `detectAndStoreVersionAnchors`: if the prior version
had confirmed anchors, the new version's state is "needs field re-confirmation"
and the upload response says so. This is where the operator is standing, in the
same minute they created the condition.

**(b) Refuse to *start* the ceremony, not to finish it.** The signing surfaces
(`/hr/acknowledge/[documentId]`, `/my/documents/[documentId]`) block with an
admin-actionable message when the current version is in that state. Failing at
`ensureSignedRecord` alone would refuse a signer who has just typed 27 sets of
initials — the worst possible place to fail. This layer is what protects the
person.

**(c) Refuse to mint, as the backstop.** `ensureSignedRecord` throws
`SignedRecordError` in that state. This is the layer that makes the invariant
true *by construction* instead of by everyone remembering, and it is the
assertion the Phase 1 fixture must carry.

**Two objections, both answered by the existing design.**

*Does (c) strand an in-flight signer when a version is uploaded mid-ceremony?*
No. Acknowledgment rows carry `hrDocumentVersionId`, and HR-11b ruling (a)
already settles that an in-flight signer finishes against the version's own
anchors. `ensureSignedRecord` is called with that older version id, which still
holds its confirmed anchors, so the guard does not fire on them.

*Is refusing too harsh, given records are append-only?* It is the opposite —
append-only is the argument **for** refusing. A refusal leaves the
acknowledgment rows untouched; re-confirming the anchors and calling
`ensureSignedRecord` again then mints a correct record, because completion is
judged on acks that already exist. **Refusing is reversible. Issuing a hollow
record is not — there is no regenerate path, by design.**

### 10.2 The silence, which is the part Gary singled out

The trip-wire above catches the narrow regression. It does not, on its own,
address what he actually named: that the system did this *quietly*. So,
separately from the refusal:

**No issue path may report a bare success.** Every place a signed record is
created or a version is scanned states which mode it ran in — stamped, or
certificate-only — at upload, on the admin document view, before the ceremony
begins, and in the server log. A certificate-only record remains legal and
remains issuable for documents that were always certificate-only; it stops
being *indistinguishable* from a stamped one.

That leaves one question this session will not decide, because it changes an
executed legal artifact and is therefore Gary's alone — it is raised as R3(ii)
in §11.

### 10.3 R2 — the upload path's swallowed result

`versions/route.ts:90-92` returns the scan outcome in the 201 body — `stored`,
`matched`, `hadTextLayer`, `pagesScanned`, `error` — and the upload dialog
surfaces it, exactly as the rescan route already does. The `meta.bytes` falsy
branch reports that detection was skipped rather than passing over in silence.

**Recommendation: fix now, in this phase, not as its own row.** It is roughly
ten lines in one route plus a dialog string, and it is the mechanism that hides
R3's condition from the operator. Shipping R3 without it lands a guard that
fires with no explanation of why.

### 10.4 Files touched

| File | Change |
|---|---|
| `src/lib/hr-signed-pdf.ts` | the R3(c) backstop in `ensureSignedRecord`; mode reported, never silent |
| `src/app/api/hr/documents/[id]/versions/route.ts` | R2: surface the scan result; R3(a): flag re-confirmation needed |
| `src/app/api/hr/documents/[id]/anchors/route.ts` | (only if the confirmed-anchor-discard row in §12 is pulled in) |
| `src/app/(app)/hr/acknowledge/[documentId]/page.tsx` | R3(b) pre-ceremony block |
| `src/app/(my)/my/documents/[documentId]/page.tsx` | R3(b) pre-ceremony block |
| the upload dialog component | R2 surfacing |
| `scripts/verify-hr-anchors.ts` or a companion | the regression assertion |

**Schema: none. Migration: none.**

---

## 11. Rulings needed from Gary

**R1 — moot.** No production signed records exist; there is nothing to
re-issue. Closed by Gary's confirmation, 2026-08-14.

**R2 — silent-failure gap on the upload path.** Fix now, or its own row?
*Recommendation: fix now* (§10.3).

**R3(i) — the guard.** Adopt the three-layer shape in §10.1, with (c) as the
non-negotiable backstop and the fixture assertion? *Recommendation: yes, all
three layers.*

**R3(ii) — does the certificate itself say so?** A certificate-only record
currently reads identically to a stamped one. A line on the Certificate of
Acknowledgment — to the effect that inline field stamping was not applied
because the version carries no confirmed field anchors — would make the
artifact self-describing rather than merely not-wrong. **This changes an
executed legal artifact and is Gary's call alone; this session makes no
recommendation and will not act on it either way.**

**Open measurement, not a ruling:** the anchor rows behind the 8-12 artifact
were never read (§2). If Phase 2 wants that closed, `Q2`/`Q3a`/`Q3b`/`Q4a` from
the query pack re-pointed at the staging branch will do it — with the branch
literal changed from `br-sparkling-block`, since a query carrying the wrong
branch label is worse than no query.

---

## 12. Out-of-scope findings — triaged

**ROW — confirmed anchors can be discarded with no guard.**
`anchors/route.ts:63-76` deletes any anchor submitted with `keep: false`,
including one already `confirmed` and already linked to a checkpoint that has
acknowledgment rows against it. G1 protects checkpoints from deletion; nothing
protects confirmed anchors. This is hypothesis B's mechanism and it can strip a
version that already carries signed records. Adjacent to R3 but a distinct
integrity gap with its own case to present. Not fixed here.

**COMMENT — `documentAnchor.findMany` in `ensureSignedRecord` has no
`orderBy`.** Draw order across anchors is therefore unspecified. Harmless
today: stamps do not overlap and each is positioned absolutely. Worth a line on
the row so nobody later assumes determinism that is not there.

**COMMENT — the "certificate-only, exactly the prior behavior" comment at
`hr-signed-pdf.ts:300-305` conflates two situations.** Image-only PDFs (nothing
*can* be stamped) and never-confirmed documents (nothing *was* stamped) are
described as one case. The comment is why the hollow path reads as intended
behaviour on inspection. Whatever R3 lands, that comment needs to stop saying
they are the same thing.

**Checked and NOT filed** — recorded so the next session does not re-derive
them:

- The `build` → `vercel-build` split (`6a77e68`, BUILD-1, 2026-07-26) moved
  `prisma migrate deploy` out of the local build. It looked like a silent
  migration hazard; it is not. ROADMAP.yaml:7086-7130 documents Vercel's
  `getScriptName(pkg, ["vercel-build", "now-build", "build"])` precedence and
  carries the empirical `Running "npm run vercel-build"` deploy line. Covered.
- `src/app/api/hr/documents/[id]/.DS_Store` is present on disk but **not
  tracked** by git. Nothing to file.

---

## 13. Status

Phase 0 closes here. No file in the repository was modified by this session
except this audit. Phase 1 does not begin without Gary's approval of §10 and
his rulings on R2, R3(i) and R3(ii).

Unpushed commits on `staging`: one — `06dc830`.
