# DEBT-72a — Board currency: a row declares `staging` in the session that pushes it

**TIER 0 — records only.**

Permitted: `docs/`, `docs/ROADMAP.yaml`, and creating the one new record named in §3.
Forbidden without stopping to ask: `src/`, `scripts/`, `prisma/`, `package.json`,
and editing any existing file in `docs/prompts/`.

Standing rules at every tier:
- Claude never pushes. Print the command; Gary runs it.
- No `&&` chains in any pasteable command or document produced. (The commit-gate
  chain required by `CLAUDE.md` § Commit Gates is exempt — that rule wins.)
- Preserve-and-mark: nothing is deleted from the board or the logs. Corrections
  prepend, dated.
- Two-commit pattern: the work commit, then the recorder commit.
- Nothing in `docs/prompts/` is ever edited after execution — addenda only.
- Evidence rules: re-measure rather than cite from memory; commit time, push time
  and deploy time are three different events.
- Exit condition: report back, do not push, list the commits made.

**Session date:** 2026-08-17
**Ruled by:** Gary, 2026-08-17, in chat.
**Repo:** `github.com/indianathomas-afk/froot` — local `~/Claude_Projects/Froot/froot`
(lowercase `froot` is the git root; the capitalized parent is not).
**Predecessor:** `docs/prompts/DEBT-72_promotion_gate.md` and its audit
`docs/prompts/DEBT-72_AUDIT.md` (commit `b809e03`). Read both before starting.

---

## 1. Why this exists — and why it comes before the gate

DEBT-72 was ruled as a promotion gate. Its audit found the gate could not be built
as specified, and in doing so surfaced something the ruling had not: **the failure
mode is not promotion, it is the board going stale after work lands, and then a
decision being made from it.**

Two documented instances, both within four days:

- **2026-08-16.** A session opened on the premise "BUG-7 is fixed on staging and
  needs promoting." It had been in production since 2026-08-14. The row was stale;
  the premise was false; the session became archaeology.
- **2026-08-17.** The `DEBT-72_promotion_gate.md` prompt asserted in its own §1 that
  `docs/WORKFLOW.md` §2 reads `git merge staging --no-edit`. It has read
  `--no-ff --no-edit` since 2026-08-07. The prompt's premise was stale on arrival.

**Neither would have been caught by a promotion gate.** Both are caused by a row not
being updated in the session that moved its code. That is what this prompt fixes.

The audit also measured live evidence of the same disease: **HR-11d, HR-11k and
HR-11n still read `in_progress`** days after shipping to production in `7e77ea6`.

DEBT-72b — the gate — is deliberately **out of scope here** and is sequenced after
this. A gate built against today's board would refuse every promotion on day one.

---

## 2. Part 1 — the rule

**Locate the session-completion rules first.** `CLAUDE.md` points at "Session
completion rules" in `docs/WORKFLOW.md`. Verify which file actually holds them and
**quote them verbatim in your report before editing.** Do not assume the pointer
resolves — a stale pointer is the exact class of defect this prompt exists to fix.

Add one rule, in the voice and format of the rules already there:

> A row whose code was pushed to `staging` during this session has its status set to
> `staging` **in the same session**, before the session ends. A row left at `planned`
> or `in_progress` after its code is on staging is a defect, not a pending decision.

Add the debt-row corollary, because debt rows behave differently:

> A debt row being shipped gains `status: staging` **explicitly**. A missing status
> on a debt row means OPEN by design (`DebtItem` in `src/lib/roadmap.ts`,
> `isResolvedDebt` in `roadmap-client.tsx`) — so a debt row that is shipping must
> declare itself rather than rely on omission.

Cross-reference DEBT-72 and DEBT-72a so a future reader knows why the rule exists.
Preserve-and-mark: add, do not rewrite the surrounding rules.

---

## 3. Part 2 — the backfill, measured and never assumed

This is an audit-then-correct. **No status is edited without an evidence line.**

### 3a. Measure

For every row across **all four collections** — `phases`, `bugs`, `debt`, `rulings`
(the audit established there are four, not three) — whose status is `planned`,
`in_progress`, or absent, determine where its code actually is:

- Rows carrying `commits:` — test each SHA with
  `git merge-base --is-ancestor <sha> origin/main`, then the same against
  `origin/staging`.
- Rows without `commits:` — resolve the row ID from commit subjects **unanchored**.
  The repo moved to Conventional Commits on 2026-08-15, so IDs sit after the
  `fix(hr):` / `docs(roadmap):` prefix and a `^`-anchored match is blind to them.
  This is a measurement convenience only and does **not** pre-empt Gary's open
  ruling on the gate's regex.

Run `git fetch origin` first. Compare against `origin/main` and `origin/staging`,
not local refs.

### 3b. Record before editing

Write the full table to **`docs/prompts/DEBT-72a_BACKFILL.md`** — ID, collection,
current status, the evidence (which SHA, which ancestry result), proposed status —
**before** touching `ROADMAP.yaml`. This file is the record of what was measured.

### 3c. Proposed statuses — no others

- Ancestor of `origin/main` → **`shipped`**. Not `verified`. Verification is Gary's
  call and none is recorded for these rows.
- Ancestor of `origin/staging` but not `origin/main` → **`staging`**.
- Neither → **leave alone.** The row is accurate.

Ambiguous cases go in the table with a proposal and are **not applied**. Report them.

### 3d. Apply

Prepend a dated correction to each changed row's `notes`, citing the evidence, per
preserve-and-mark. Do not delete existing notes. Known starting set from the audit:
**HR-11d, HR-11k, HR-11n** — but measure the whole board, do not stop at three.

---

## 4. Part 3 — the `7e77ea6` DEPLOY_LOG entry, still owed

Read two existing entries first and match their format. Write everything that can be
computed; leave `TODO:` markers for the prose only Gary can write.

Facts established and verified 2026-08-17 — cite them, and re-derive the ones marked
*(derive)* rather than trusting this list:

- Merge commit `7e77ea6`, `--no-ff`, two parents *(derive both)*. First promotion in
  seven to leave a revertable merge artifact, so
  `git revert -m 1 <full-sha>` applies again.
- Range `06dc830..7e77ea6` — **47 commits, not 48.** The audit corrected this.
- Three migrations, all additive with defaults, all applied to **production**:
  `20260815150000_hr11n_checkpoint_retirement`,
  `20260816120000_hr_document_version_requires_reacknowledgment`,
  `20260816180000_organization_timezone`.
- **Deploy time — the only one of the three timestamps that touched production:**
  `2026-08-17 02:50:05.387 / 02:50:05.776 / 02:50:06.152 UTC`, read from
  `_prisma_migrations` on the Neon `production` branch. Clustered inside 765 ms,
  which is the batch signature of one `migrate deploy`.
- **All `DEPLOY_LOG` timestamps are UTC and are labelled `UTC`.** The log is evidence.
  Record commit, push and deploy times separately where known; never conflate them.
- Note worth recording: `20260812171500_doc1a_document_audience_grants` was already
  in production from `2026-08-13 04:50:22 UTC` — so DOC-1's schema and the code that
  uses it reached production in **different** promotions. Additive, nothing broke.
- Note worth recording: this promotion carried signing-behaviour and access-control
  changes onto a **live** HR module. `HR_MODULE_AVAILABLE=true` has been in the Vercel
  Production scope since 2026-07-24; org `cf888f2d-f234-48c7-8097-fd5b44b5b3dd`
  (Keva Juice) runs `activeModules = {inventory,labor,hr}` with six non-admin
  principals. Any note claiming HR is dark in production is stale.
- Post-promotion check already run and clean: production `HrSignedRecord` holds five
  rows, **five distinct `staffMemberId` values**, all `signingCycle: 1`. Two were
  signed 2026-08-17 after the deploy — first-time signings by two different people,
  not re-acknowledgments. Nobody was sent back to re-sign.

---

## 5. Part 4 — one line into BUILD-1

Into BUILD-1's existing blocker, preserving everything already there. The reasoning
was worked out 2026-08-17 and should not have to be rediscovered:

> Fix when a second developer's first PR is expected. The Preview database must NOT
> be `preview/staging` — an unreviewed PR migration would apply to the branch used
> for promotion verification. Prefer a throwaway Neon branch forked from `dev`, not
> from `production`, so preview deploys never hold a copy of real customer data.

---

## 6. Out of scope — report, do not do

- **DEBT-72b, the gate.** Do not build it, do not scaffold it, do not propose a
  design. It is sequenced after this and after Gary has lived with the new rule
  through two or three promotions.
- The four open rulings from the audit — the regex, the `rulings` collection,
  status-less debt rows, and whether `in_progress` at promotion time is the defect.
  None are needed here.
- Marking any row `verified`.
- DEBT-73, the `needs-current` naming problem, DEBT-69, DEBT-70's client half.
- Anything under `src/`, `scripts/`, `prisma/`, or `package.json`.

---

## 7. Verification

- `npm run build` green before each commit. `scripts/generate-roadmap.mjs` parses
  `ROADMAP.yaml` at prebuild, so a YAML error fails the build — that is the gate.
- Every status change has a matching evidence line in `DEBT-72a_BACKFILL.md`.
- Re-run the §3a ancestry check **after** editing. Zero rows should remain
  contradicting git. Report the number.
- Confirm the new session-completion rule reads correctly in context by quoting the
  edited section back in full.

---

## 8. Report

- The session-completion rules exactly as they read **before** your edit, and which
  file actually held them.
- The backfill table: rows changed, rows left alone, rows flagged ambiguous.
- The post-edit ancestry re-check count.
- Anything you found that contradicts §1 of this prompt. Two of the three premises
  in the last prompt were stale; assume this one has one too, and go looking.
- Commits made. Do not push.
