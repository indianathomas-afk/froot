# Addendum 01 — R2 / HR-11k Phase A

**Suggested repo path:** `docs/prompts/R2-HR11k-phase-a-addendum-01.md`
**Addends:** `docs/prompts/R2-HR11k-phase-a.md` — never edited; this addendum
is the correct way to add to it.
**Corrects:** `docs/R2-HR11k-DESIGN.md` §4 row 2, §6, §7. The spec receives a
dated preserve-and-mark correction in place; the original text stands.
**Occasioned by:** the Step 1 audit and its artifact
`R2-HR11k-PHASE-A_AUDIT.md`.

Gary's rulings, 2026-08-15. Everything in §1–3 below is ruled, not proposed.
The base prompt stands except where this addendum overrides it.

---

## 0. Why this addendum exists

The design spec's file list was written against `main`. R1 landed on `staging`
on 2026-08-14 (`32205a4`) and moved the precedence table into a single shared
predicate. Following the spec's §7 literally would write the R2 rule into three
files and reverse R1 one day after it shipped.

The audit caught this. Its reading is correct and is adopted.

This is the standing trap, and it fired exactly as documented: project
knowledge indexes `main` only, so staging-only work is invisible at planning
time. The spec said to confirm against staging. Doing so is what saved the
phase.

## 1. The shape of the work — ruled

**The precedence table changes once, in the predicate.** `documentCompletion`
in `src/lib/hr-completion.ts` is the single site where rows 4 and 5 are split.
The three call sites change only in which facts they gather and how they label
the result.

`src/lib/hr-completion.ts` is **added to the §7 file table**. The spec omitted
it.

Call sites, per the audit's enumeration:

- `src/lib/hr-compliance.ts:422`
- `src/app/(app)/staff/[id]/page.tsx:222`
- `src/app/(my)/my/documents/data.ts:91`

Fourth consumer, **no edit**: `src/app/(my)/my/page.tsx:73` filters
`status !== "complete"`, so a row-4 member drops off the employee dashboard
automatically. It is not a change site, but it **is** a verification site — see
§5.

### Before any edit: confirm the enumeration

Run a repo-wide grep on the exported symbol itself, not on the three filenames
the spec named, and report the full result. The audit reports the enumeration
as complete and it is probably right; it needs to be complete by measurement
rather than by inference, because a missed consumer of a predicate whose
meaning is changing is a silent defect.

In the same pass, answer one question explicitly:

> Is `documentCompletion` — or anything downstream of it — reachable from the
> HR-11j grant-blocking path?

HR-11j ruled that a document with unconfirmed anchors cannot be granted, and
that "signed" means an `HrSignedRecord` exists for that version, staff member
and cycle. R2 changes what satisfies the current version. If those two meet,
**stop and report**. That is a different conversation than this phase and it
does not get resolved inside this session.

## 2. Ruling on the three items you stopped on

### 2.1 Arm 2 — untouched, and it outranks row 4

The spec's §4 row 2 described pre-R1 behaviour, and its own "unchanged" note
is operative. Under R1, all required checkpoints acked with no signed record
produces `in-progress` + `recordMissing`, and that is correct: the fix there is
to generate the record, not to call it complete. **Arm 2 is untouched.**

New, and it belongs in the amendment because it is not obvious:

> **Arm 2 beats row 4.** A member who has fully acknowledged the current
> version is bound to the current version, even if they also hold a completed
> record on an earlier one. They did the newer work; honour it.

"Row 4 beats row 6" from the base prompt governs **partial** acknowledgments
only. Both orderings go into the `docs/DECISIONS.md` amendment in §4 below.

### 2.2 The notice links the download, not the ceremony

Adopted as recommended. `/my/documents/[documentId]` renders `SigningClient`
and computes `hasSignedRecord` against the current version, which a row-4
member does not have — so the ceremony would open. That is a signing
affordance offered to the exact person the ruling says must not be prompted:
the defect R2 exists to remove, reintroduced through the notice announcing it.

Link the audience-aware download route the Library already uses on that page.
Confirm the exact path and query form from the Library's own call site rather
than transcribing it from the audit.

A read-only mode on the ceremony route is **rejected** — more surface, and §8
puts that route out of scope.

### 2.3 The fixture is measured, never predicted

Verification step 3 does not run against a named person until staging has been
read in the **Neon console**. Identify whoever actually holds a completed
signed record on a **non-current** version in their **current** signing cycle.

- If that is Gdogg, use Gdogg.
- If it is somebody else, use them and say so.
- If it is **nobody**, the fixture must be built before verification means
  anything. Report that and stop; do not proceed to a screenshot.

A screen that reads green for a member who was never in row 4 is a completion
screen, not evidence.

## 3. The three additional findings — all adopted

1. **`src/app/(my)/my/documents/page.tsx:136`** hardcodes
   `Signed v{row.currentVersionNumber}` in the Completed section. Under R2 it
   tells a v4 signer they signed v6. Same defect as the label work, one file
   further out. Fix it.
2. **`src/app/api/hr/documents/[id]/versions/route.ts:96-97`** carries a second
   false HR-11f assertion. The base prompt named only the `:22` block.
   Correcting one and leaving its twin makes the survivor read as current and
   authoritative. **Fix both, same commit.** Comment-only; no behaviour change
   in that file.
3. **`staff-documents.tsx` `statusLabel()`** already reads
   `signedVersionNumber`. It needs only the `· current is vN` suffix — less
   work than the base prompt implied.

### 3.1 Ordering — corrected, plus one real gap

The spec was wrong that two sites inherit incidental ordering. All three
already specify `versionNumber: "desc"` explicitly
(`hr-compliance.ts:259`, `staff/[id]/page.tsx:186`, `data.ts:54`). **Nothing to
add.**

But `signedRecords` is **unordered** at both page sites and consumed as `[0]`.
Harmless today; load-bearing the moment row 4 selects a record. Give it an
explicit ordering.

## 4. Decision-log amendment — expanded

`docs/DECISIONS.md` gets the R2 amendment under the HR-8 block, preserve-and-
mark, per the base prompt. Add to it:

- Arm 2 beats row 4 (§2.1).
- Row 4 beats row 6, partial acknowledgments only.
- The precedence table lives once, in `documentCompletion` — R1's shape is
  load-bearing and Phase A deliberately did not recreate it.

## 5. Verification — amended

The base prompt's Step 6 stands. Changes:

- **Step 3** uses the measured fixture from §2.3, named in the evidence.
- **Step 4, the rehire regression, is now one test against one predicate.**
  That is the dividend of R1's shape — but it also means one wrong lookup
  breaks every surface at once, so exercise it deliberately. If it appears to
  pass without being exercised, treat it as unverified.
- **New:** confirm the row-4 member has dropped off `/my` (the employee
  dashboard, `my/page.tsx:73`) with no edit to that file. This is the cheapest
  available proof that the change landed in the predicate rather than in the
  labels.
- **New:** confirm the notice's link opens the document read-only and that no
  ceremony route is reachable from that row.

## 6. Blocker — not yours to resolve

Local `staging` and `origin/staging` have **diverged** (`ahead 1, behind 1`;
local `614dc8d`, remote `6e3b9eb`, common `7198f77`). Both record the same
HR-11o result with different messages.

**Do not resolve this.** Do not reset, rebase, force, or merge. Gary reconciles
it by hand — ROADMAP.yaml is append-only and will conflict, and `origin/staging`
is what is deployed.

Until it is reconciled, the staging-SHA precondition in Step 6 cannot pass.
Code work may proceed and commit locally; **staging verification may not
begin.** If reconciliation has not happened when you reach Step 6, stop there
and report.

## 7. Scope — unchanged

Everything in the base prompt's out-of-scope list still holds. No Prisma, no
migration, no writes to `HrSignedRecord` or `HrDocumentAcknowledgment`, no
touch to `signingCycle` semantics, retired checkpoints, audience logic, the
upload dialog, `HR_MODULE_AVAILABLE`, or HR-11n Phase B.

Added to that list by this addendum:

- The ceremony route `/my/documents/[documentId]` and `SigningClient` — §2.2
  removes the only reason to touch them.
- The branch divergence — §6.
- Anything reached through the HR-11j grant-blocking path — §1.

## 8. What to bring back

- The grep enumeration and the HR-11j reachability answer (§1).
- The measured fixture identity, with branch literal, org ID and Clerk
  instance in the same output (§2.3).
- The two short SHAs, two-commit pattern, `staging`, no push.
- Verification evidence including the two new checks in §5.
- Anything else you stopped on rather than guessed. The three you stopped on
  in Step 1 were all correct calls; keep doing that.
