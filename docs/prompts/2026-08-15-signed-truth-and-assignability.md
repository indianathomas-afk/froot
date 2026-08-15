# Session prompt — Signed truth & assignability gate

**TIER 3 — structural.** Full ceremony. Audit first, present a plan, wait for
explicit approval before any edits.

**ROADMAP row:** _(Gary to assign before this prompt is committed.)_

**Save to:** `docs/prompts/2026-08-15-signed-truth-and-assignability.md`

---

## Precondition

Confirm all three before doing anything else. Stop and report if any fails.

1. Local `HEAD` on `staging` is `ba1f38b`.
2. `origin/staging` is `ba1f38b`.
3. Deployed staging SHA is `ba1f38b`.

Do not reason against any other branch state. `main` does not contain this work.

---

## Why this session exists

Two rulings, made 2026-08-15 after a full reproduction on staging
(`br-square-feather-a63z92vz` / `neondb`).

**R1 — Signed means the signed record exists.** A document is signed when an
`HrSignedRecord` row exists for that version, staff member, and signing cycle.
Not before. Completed checkpoints are progress, not completion. Every surface
that reports completion status reads the record.

**R4 — A document is not assignable until its fields are confirmed.** The guard
moves upstream from the ceremony to the grant. A document whose anchors are
unconfirmed cannot be granted to anyone. **This supersedes the HR-11d §2b
carve-out that deliberately left the grant/audience path untouched.**

### The evidence behind them

On 2026-08-14/15 a four-page test document ("Test - Handbook Regression",
`cmstv3r1s000004jxdcyhkbui`) reproduced the full failure chain:

- v1 uploaded, anchors confirmed, signed by Tommy Thomas — **stamped correctly,
  10 field marks.** The stamping engine is sound.
- v2 uploaded with different bytes (sha `1685fc241b1c…` vs v1 `1539cd866058…`),
  anchors left unconfirmed.
- A signer **entered the ceremony on v2 anyway** — the ceremony-level
  `isSigningBlocked` check did not fire. He reviewed 4 pages, initialed 4,
  signed 2.
- `ensureSignedRecord` **threw correctly** at mint. The third guard layer held.
- Database after: **0 `HrSignedRecord` rows, 7 `HrDocumentAcknowledgment` rows**
  for v2.
- The signer's portal then displayed **"Signed v2"** with a green badge under
  COMPLETED, and TO SIGN read "All caught up — nothing to sign."

The portal reported completion from checkpoint counts. No record existed. The
signer was told they were finished and would never be prompted again.

This is the same defect shape as the original blank-handbook bug: two predicates
reading different sources with different lifetimes, never required to agree.

**Production context:** HR is dark in production. Zero documents have ever been
granted to a real employee. There is no migration or backfill concern — these
rulings apply from day one and nothing pre-exists them.

---

## Scope

### Item 1 — Completion inventory (audit, report back, STOP)

Find **every** place in the codebase that computes or displays whether a
document is signed / complete / outstanding for a staff member. Known
candidates, non-exhaustive:

- the staff portal (`/my`, `/my/documents`, `/my/documents/[id]`)
- the staff detail page Documents tab
- compliance views
- reports
- any store sweep, operations report, or checklist surface that counts
  documents

For each, report: file path, what it currently reads, and whether it infers
completion from checkpoint counts or from `HrSignedRecord`.

**Stop here and present the list.** Do not edit anything until Gary approves
the inventory. A surface missed at this step is exactly where this defect
survives.

### Item 2 — R1: completion derives from the record

For every surface on the approved list, completion status must derive from the
existence of an `HrSignedRecord` for (`hrDocumentVersionId`, `staffMemberId`,
`signingCycle`).

- Checkpoint completion may still drive **progress** display ("2/7 checkpoints").
- Checkpoint completion must never produce a "Signed" / "Completed" state.
- A signer with acknowledgments but no record is **in progress**, not done, and
  the document stays in their TO SIGN list.

Copy for that state, verbatim:

> **In progress — ask your manager.**

Do this as one shared, exported, pure helper that every surface calls — the same
pattern as `isSigningBlocked`. Do not reimplement the predicate per surface.

### Item 3 — R4: assignability gate

A document with unconfirmed anchors cannot be granted. Gate the grant/audience
save path on the same `isSigningBlocked` predicate the ceremony and mint use.

Copy for the admin-facing block, verbatim:

> **Confirm this document's fields before assigning it.**

The block must be visible in the audience modal at save time, not a silent
no-op.

**Open question for Gary at the audit checkpoint — do not resolve this
yourself.** `isSigningBlocked` is `matched > 0 && confirmed == 0`. An image-only
PDF with no text layer produces `matched 0, confirmed 0` and is therefore **not**
blocked — by design, since image-only documents are legitimately
certificate-only. R4 as ruled says a document is not assignable "until all
fields have been validated," and separately that there should be "a warning if
the fields are not detected." Those two statements may or may not mean an
image-only document should also be blocked from assignment. Surface this
explicitly with a recommendation and let Gary rule.

### Item 4 — Ceremony-entry guard

R4 makes this rare but not impossible, so it still gets fixed.

Find why `isSigningBlocked` did not fire when the signer opened
`/my/documents/cmstv3r1s000004jxdcyhkbui` on unconfirmed v2. Map every entry
point into the ceremony (route handlers, server components, client navigation,
any direct link) against where the predicate is actually called. Report the gap
before fixing it.

---

## Constraints

- **No schema change is expected.** If you conclude one is required, stop and
  report before writing any migration. If one is genuinely needed it must be
  additive-only, with the SQL presented and the database host echoed before it
  runs.
- No `&&` chains in any command block. One command at a time.
- Commits stay on `staging`. **Commit only — never push.** Gary runs all pushes.
- Two-commit pattern: the work commit first, then a follow-up commit recording
  that SHA in the ROADMAP row.
- `next build` must pass before the work commit.
- Nothing is deleted from the board. Corrections prepend with dates.
- `vercel env pull` is banned.

---

## Verification

Re-measure. Do not cite the completion screen as proof of anything — that screen
is the thing that lied.

1. **R1 regression.** On the test document, a staff member with acknowledgments
   on v2 and no `HrSignedRecord` must show as in progress, with the document in
   TO SIGN. Confirm with a query, not a screenshot: signed-record count for that
   (version, staff, cycle) is 0 while the surface reports in progress.
2. **R1 positive.** Tommy Thomas's v1 record (which does exist, and stamped
   correctly) must still read as signed.
3. **R4.** Attempting to assign the test document while v2 is unconfirmed must
   be refused with the verbatim copy. Confirming v2's anchors must then make it
   assignable.
4. **Item 4.** With the guard fixed, opening the ceremony on an unconfirmed
   version must land on the refusal screen, not the reader.

Every database result must carry `neon.branch_id` and `current_database()` in
the same output. Branch identity is confirmed in-query, never assumed. Row IDs
do not identify a branch.

Browser evidence must name the org ID and Clerk instance captured before
testing.

---

## Out of scope

Filed, not built in this session:

- **R2** — two upload paths (new file vs. new version) and the re-signing
  consequences of each. Supersedes HR-11f. Needs its own design pass and will
  likely add a column to `HrDocumentVersion`.
- **R3** — compliance shows "signed, version noted"; a separate
  "who has acknowledged the current text" report.
- Certificate organization name rendering as "Microsoft".
- Initials input hardening (length cap, autocorrect/autocapitalize off).
- Certificate checkpoint table sorting by `signedAt` rather than `orderIndex`.
- Phantom page-1 Initial checkpoint minted with no anchor behind it.
- Initials button colliding with the page footer in the reader.
