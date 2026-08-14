# HR-11d — Phase 1 build (hollow signed records)

**TIER 3 — Structural.** Phase 0 is closed; the audit lives at
`docs/prompts/HR-11d_AUDIT.md`. This session builds the fix. Do not re-litigate
the diagnosis.

---

## 0. Ground rules (universal floor)

- **Repo path:** `~/Claude_Projects/Froot/froot` — the **lowercase `froot`**
  folder is the git root; the capitalized parent `Froot/` is not the repo and has
  no `.git`. Confirm with `git rev-parse --show-toplevel` first.
- **Gary runs all pushes.** Never push.
- **Commits stay on `staging`.** Never commit to `main`.
- **No `&&` chains.** One command per block, read the result before the next.
- **No schema drops. Additive only.** This work should need **no schema change**
  and **no migration** — if you conclude otherwise, stop and present the case.
- **Echo the database host before any migration runs.** (There should be none.)
- **Evidence rules:** DB results carry the branch literal in the same SELECT;
  browser observations name the org ID and Clerk instance captured before
  testing; re-measure, never cite from memory.
- **Two-commit pattern:** work commit first, then a follow-up commit recording
  that SHA in the ROADMAP row. Never commit-then-amend.
- **Surface and stop.** Do not resolve ambiguity by picking the
  reasonable-looking option.

**Precondition:** the `HR-11d` row must already exist in `docs/ROADMAP.yaml` with
Gary's ratified rulings. If it does not, stop and say so — the rulings are the
spec for this build.

---

## 1. What is being fixed

`ensureSignedRecord` judges completion from **document-level checkpoints** and
drives stamping from **version-level confirmed anchors**. Those two predicates
read different sources with different lifetimes and never have to agree. When the
anchor set is empty the function mints a record claiming completion, draws the
page-1 banner, appends the full certificate, and stamps nothing — silently.

Observed on staging 2026-08-14 (org and Clerk instance to be recorded at
verification): the Keva Employee Handbook shows **"Detected fields (41 across 28
pages)"** with a live **"Confirm & generate (41)"** button — 41 proposals, zero
confirmed — while **Checkpoints (37)** are fully populated. Completion machinery
intact, stamping machinery empty. That is the defect on screen.

---

## 2. Scope — five items, no more

### 2a. R2 — upload route reports its scan result

`POST /api/hr/documents/[id]/versions` calls `detectAndStoreVersionAnchors` and
discards the discriminated `StoreAnchorsResult` entirely; the `meta.bytes` falsy
branch skips detection with no record at all. Apply the same distinct-reporting
rule already shipped on the rescan route (DECISIONS, HR-11b §k): the response
states which of three things happened — it errored, there was no text layer, or
it found N fields across M pages. Never a bare zero standing in for all three.

The upload dialog must end by telling the operator plainly what remains, e.g.
**"41 fields found. None are active yet — confirm them before anyone signs."**
This is a to-do handed to the person standing there, not a success message.

### 2b. R3 — the three-layer guard

**Condition (Gary's ruling, correcting the audit's proposal):** fire when
**detection matched fields and zero are confirmed** — `matched > 0 && confirmed
== 0`. Do **not** use "prior version had anchors and current has none": that test
misses a brand-new document whose first version was never confirmed. A version
reporting `matched == 0` (image-only, or pre-HR-11b and never scanned) is
legitimately certificate-only and must still be signable.

Three layers:

- **(a) Flag at upload** — where the operator is standing (folds into 2a).
- **(b) Refuse to start the ceremony** — the load-bearing layer. Failing at
  mint-time would refuse a signer who has just typed 27 sets of initials.
- **(c) `ensureSignedRecord` throws** — the backstop, non-negotiable. If this
  ever fires in production it means layer (b) failed; that is what the fixture
  asserts.

Refusing cannot strand an in-flight signer: acknowledgments carry
`hrDocumentVersionId` and HR-11b ruling (a) has them finishing against their own
version's anchors, which still exist. Append-only argues *for* refusing — a
refusal leaves acks intact, so re-confirming and re-calling mints correctly.
Refusing is reversible; issuing a hollow record is not.

### 2c. Refusal experience

Signer-facing copy, exact: **"This document isn't available yet — ask your
manager."** No raw error, nothing implying the employee did something wrong.

The refusal screen also offers a **Download / print** button so a new hire on a
shared iPad is not stuck mid-shift. Download only. Accepting a scanned
wet-signed copy back in is HR-11g and is **out of scope here**.

### 2d. Vocabulary additions

The real 2023 Keva handbook carries signature and identity fields the current
`ANCHOR_VOCABULARY` walks past. Add, with longest-match-wins and the existing
claimed-span mask:

| Token | Maps to | Note |
|---|---|---|
| `Signature:` | SignatureStamp | bare form, pp. 9 and 19 |
| `Store Location:` | Store | `Store:` will not match this |
| `Acceptance (PRINT):` | PrintedName | p. 9 |
| `Manager Signature:` | **see below — STOP** | p. 9 |
| `Employee:` | **see below — STOP** | p. 13 |

**Two stop-and-ask items. Do not guess either.**

1. **`Manager Signature:` must be in the vocabulary even though it is not a
   signer field.** If bare `Signature:` is added without it, the matcher hits the
   substring and stamps the *employee's* signature on the manager's line. It has
   to claim its own span so it can be excluded. Present the mechanism for
   excluding it (a mark type that stamps nothing, a discard flag, or omission of
   both tokens) and let Gary rule.
2. **`Employee:` on p. 13 is a signature line**, but `Employee Name` elsewhere is
   a printed name. Present the ambiguity and let Gary rule on the default; the
   admin can still override at confirm time.

Extend `scripts/verify-hr-anchors.ts` for every token added. Report the new pass
count against the current 28/28.

### 2e. Hash-match anchor carry-forward

> **DELETE THIS SECTION IF GARY RULED AGAINST IT.** Confirm before building.

Staging shows nine versions of the handbook (v1–v9, Jul 23 → Aug 12) all
carrying the **same sha256 prefix `7d60912ccf4b`** — the same bytes uploaded nine
times. The 8-12 signer signed a file byte-identical to the one that stamped
correctly, and got nothing, purely because the anchor rows did not travel.

When a new version's file hash equals the hash of the version it replaces, copy
the prior version's **confirmed** anchors forward as confirmed. Identical bytes
means identical coordinates — arithmetic, not inference — so there is no admin
judgment left to exercise. Pair it with a warning at upload: *"This file is
identical to the current version — upload anyway?"*

This changes **nothing** about who must re-acknowledge. Signed records stay bound
to the version signed and a new version still requires new acknowledgment
(Gary's ruling; HR-11f keeps current behavior). Carry-forward moves stamp
coordinates only. Do not touch compliance or re-signing logic.

---

## 3. Non-regression — read before writing code

**Bulk assign must keep working.** The audience modal ("Who is this document
for?" — everyone in company / choose stores or people, with per-store reach
counts) is DOC-1 and is untouched by this work. The guard blocks **signing**, not
**granting**. An admin must still be able to assign an unconfirmed document
company-wide or store-by-store; what they cannot do is have someone sign it.
Put the guard at the ceremony and mint layers, never at the grant layer. Verify
the modal still saves after the change.

Also do not disturb: HR-11c anchor dedup, affordance-at-line, identity chips, the
per-signature checkpoint model, the certificate writer, or `ensureTrainingCertPdf`
(a different function on a different path).

---

## 4. Explicitly out of scope

Filed as their own rows; do not start them, do not partially implement them.

- **HR-11e** — anchor coverage review, manual click-to-place, repositioning
  (still deferred per U1).
- **HR-11f** — version-change acknowledgment policy. **Ruled: current behavior
  stands** — a new version means everyone re-acknowledges; Gary handles the churn
  with a document disclaimer, not with code. No diff-signing, no
  minor/substantive classification.
- **HR-11g** — paper fallback (scanned wet-signature upload as a signed record).
- The `keep:false` deletion guard on `anchors/route.ts` (hypothesis B) — its own
  row.

---

## 5. Tests

- Regression fixture: **a version with matched-but-unconfirmed anchors must not
  mint a signed record.** That is the assertion that would have caught this.
  First determine whether `scripts/verify-hr-anchors.ts`'s existing synthetic
  PDFs can carry it or whether a real PDF fixture is needed — report which and
  why before standing up a second harness.
- Vocabulary coverage tests for every token added in 2d.
- If 2e is built: a test that a hash-matching re-upload carries confirmed anchors
  forward, and that a hash-*differing* re-upload does not.
- `next build` green after each step.

---

## 6. Deliverables and stop

- Commits on `staging`, two-commit pattern, ROADMAP row updated with the work SHA.
- A report covering: what shipped, the two stop-and-ask rulings from 2d and how
  they were resolved, fixture pass counts, whether 2e was built, and any
  out-of-scope findings classified **FIX NOW / RULING NOW / COMMENT / ROW**.
- **Do not push.** Do not promote. Phase 2 verification is a separate pass.

---

## 7. Phase 2 preview (not this session)

Staging SHA precondition, then org ID and Clerk instance (`verified-snapper-7`)
recorded before the browser pass. Walk the confirm screen on the handbook, sign
end-to-end, verify stamps land on every signature page positioned per placement
and that `Name:` / `Date:` / `Store:` populate. Close the audit's open loose end
by re-pointing Q2/Q3a/Q3b/Q4a at staging with the branch literal corrected off
`br-sparkling-block`. DEPLOY_LOG entry written **before** the push; `--no-ff`
merge only; the next real promotion's entry must name merge SHAs `65abb74` and
`f318d2e` for history reconciliation.
