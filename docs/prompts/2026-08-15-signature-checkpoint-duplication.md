# Session prompt — Signature checkpoint duplication across versions

**TIER 2 — contained.** One function, no schema change, no grant path, no
completion path. Audit first because G1 constrains what can be done about
already-accumulated rows; proceed to implementation once the audit question
below is answered.

**ROADMAP row:** _(fill in before running — do not leave a placeholder.)_

**Save to:** `docs/prompts/2026-08-15-signature-checkpoint-duplication.md`

---

## Precondition

Confirm before doing anything else. Stop and report if it fails.

1. Local `HEAD` on `staging` matches `origin/staging`.
2. Deployed staging SHA matches `HEAD`.

---

## The defect, measured

On the test document "Test - Handbook Regression"
(`cmstv3r1s000004jxdcyhkbui`), staging `br-square-feather-a63z92vz` / `neondb`:

| Event | Total checkpoints |
|---|---|
| v1 confirmed | 7 |
| v2 confirmed | 9 |
| v3 confirmed | 11 |

Two added per version. Gdogg Thomas's v3 certificate, generated
2026-08-15 19:11:56 UTC, lists **six Signature checkpoints for two signature
lines** — "Page 3 signature" three times and "Page 4 signature" three times.
The four Initial checkpoints did not duplicate.

That asymmetry is the diagnosis. In `syncCheckpointsForConfirmedAnchors`
(`src/lib/hr-anchors.ts`):

- **Initial** reuses on `c.type === "Initial" && c.pageRef === a.page` — a
  document-level lookup that survives across versions.
- **SignatureStamp** reuses only when `a.generatedCheckpointId` already points
  at a checkpoint. That pointer lives on the **anchor**, and `DocumentAnchor` is
  version-scoped (HR-11b ruling a). A new version's anchors are fresh rows with
  that field null, so the lookup always misses and a new checkpoint is always
  created.

Same defect family as HR-11j: two objects with different lifetimes, and the
reuse key sitting on the one that dies.

**Consequence for signers.** Each orphaned Signature checkpoint is a ceremony
step with no anchor behind it — the signer is prompted to sign, and the capture
has nowhere to be stamped on the document body. Gary observed exactly this on
v2: extra signature and initial prompts in places the document has no signature
line.

**This is not fixed by R2.** R2 (HR-11k) stops existing signers from being
re-prompted on a new version, but checkpoints are minted at **anchor
confirmation**, which is an admin action independent of who signs. The document
still accumulates two per version. Under R2 the person who hits it is the next
new hire, who signs the current version and walks six signature prompts for two
lines.

---

## Item 1 — Audit and one question (report back, STOP)

Read `syncCheckpointsForConfirmedAnchors` and the surrounding creation path.
Then answer this before writing anything:

**What is the correct reuse key for a Signature checkpoint?**

`pageRef` alone mirrors Initial and fixes the measured case, where each page has
exactly one signature line. But it collapses two genuine signature lines on the
same page into one checkpoint — and the real Employee Handbook has signature
blocks on pages 11, 22, 24 and 28, which has not been checked for same-page
pairs.

Candidates to weigh, with a recommendation:

- `pageRef` alone
- `pageRef` plus an ordinal (e.g. index among SignatureStamp anchors on that
  page, ordered y-descending), which is stable across versions as long as the
  page's signature lines keep their relative order
- something else you find in the data

Do not resolve this by guessing. Present the options with a lean and let Gary
rule.

Also report: how many orphaned Signature checkpoints currently exist on the test
document and on the real Employee Handbook, and confirm whether any of them
carry acknowledgments.

---

## Item 2 — The fix (after the ruling)

Change Signature checkpoint reuse to the ruled key. Growth must stop: confirming
a further version adds zero new Signature checkpoints.

**Do not delete anything.** G1 stands — this path never deletes or modifies a
checkpoint. Existing orphans stay. State plainly in the report how many remain
on each affected document after the fix, and that removing them is a separate
admin action requiring its own ruling.

Note honestly: with reuse by page, one orphan per page per version gets adopted
on the next confirm and the rest remain. Growth stops; the backlog does not
clear itself.

---

## Constraints

- No schema change expected. Stop and report if you conclude one is needed.
- No `&&` chains. One command at a time.
- Commits stay on `staging`. Commit only — never push. Gary runs all pushes.
- Two-commit pattern: work commit, then a commit recording that SHA in the row.
- `next build` must pass before the work commit.
- Preserve-and-mark: corrections prepend with dates, nothing deleted.

---

## Verification

Unit assertions are not sufficient here — the defect only appears across
versions, which is precisely what the earlier fixture missed.

1. Assert the reuse logic directly against the shipped function.
2. Live acceptance on staging, after Gary pushes: upload a **v4** of the test
   document with different bytes, confirm its anchors, and re-count. Total
   checkpoints must stay at 11, not go to 13.
3. Report the orphan count on the test document and the Employee Handbook
   before and after.

Every database result carries `neon.branch_id` and `current_database()` in the
same output. Database reads for deployed environments go through the Neon
console — provide the SQL, do not run it locally.

---

## Out of scope

- Removing existing orphaned checkpoints (needs its own ruling under G1).
- R2 / HR-11k — two upload paths and re-signing policy.
- The phantom page-1 Initial checkpoint minted with no anchor behind it.
- Initials input hardening; certificate table sorting by `signedAt`.
- Initials button colliding with the page footer in the reader.
