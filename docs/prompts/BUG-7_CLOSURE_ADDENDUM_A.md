# Addendum A — BUG-7 closure + DEPLOY_LOG reconciliation

Appended 2026-08-16, after the Section 0 audit and before Tasks 1–6.
The parent prompt (`BUG-7_CLOSURE_AND_DEPLOY_LOG_RECONCILIATION.md`) is not edited.
Where this addendum and the parent disagree, **this addendum governs.**

---

## A1 — Task 4 correction: the fifth promotion is Aug 14 morning

The parent asserts the reflog rhythm is "Aug 11 morning, Aug 11 afternoon, Aug 12 midday,
Aug 12 evening, Aug 13 evening." **The fifth is wrong.** It was written by reading
`06dc830`'s commit time as its promotion time — the Pacific/UTC trap `CLAUDE.md` names, and
the parent prompt's own Timestamps section warns about.

`git reflog show main --date=iso`, authoritative:

| tip | `main` moved (PT) | tip commit authored (PT) |
|---|---|---|
| `882d6c3` | 2026-08-11 10:24:36 | 2026-08-11 09:26:53 |
| `ec42265` | 2026-08-11 16:27:24 | 2026-08-11 16:11:02 |
| `b853787` | 2026-08-12 12:33:26 | 2026-08-12 11:58:03 |
| `ce036f9` | 2026-08-12 21:50:11 | 2026-08-12 21:01:07 |
| `06dc830` | **2026-08-14 08:05:16** | 2026-08-13 21:20:08 |

Write DEBT-38 as **four-plus-one**, not five: four promotions moved within an hour of their
last commit — end-of-work-block, the mechanism the parent describes and which stands — and
the fifth sat overnight and was promoted the following morning, ~10h45m later.

The mechanism claim is unchanged and the `--no-ff` violation count is unchanged at five.
Only the rhythm description changes. Record the correction and its cause in the row: a
commit time read as a promotion time.

## A2 — Task 1: carry the reflog lower bound alongside the business-date bracket

`main` moved at 2026-08-14 08:05:16 PT = **2026-08-14 15:05:16 UTC**. `00881dc` cannot have
been serving production traffic before that instant.

State it as a **lower bound, not a deploy instant** — the reflog records a local merge, not
the push and not the Vercel build. It is consistent with the id-format evidence rather than
a substitute for it: business date 2026-08-14's rows were created before that instant and
kept their cuids; business date 2026-08-15's are uuid.

If Gary supplies the Vercel production deployment timestamp for `00881dc`, that replaces
the bound with the exact instant, Pacific converted to UTC inline. If he does not, keep
both the bound and the business-date bracket, and label each as what it is.

## A3 — Task 3 correction: where the five entries go

The parent says "at the top of the file, newest first." **That instruction is wrong and
must not be followed literally.**

`docs/DEPLOY_LOG.md` is reverse-chronological. Its newest heading is the **2026-08-15
STAGING deploy** (line ~144), which is *newer* than all five promotions being recorded
(Aug 11 – Aug 14). Inserting an Aug 14 entry above an Aug 15 entry would break the file's
ordering — the same ordering whose misreading produced DEBT-23.

**Insert the five entries between the 2026-08-15 staging section and the 2026-08-10
(evening) production promotion section (line ~209), in reverse-chronological order among
themselves:** `06dc830` (Aug 14), `ce036f9` (Aug 12 evening), `b853787` (Aug 12 midday),
`ec42265` (Aug 11 afternoon), `882d6c3` (Aug 11 morning).

Each entry is headed by the date `main` **moved**, not the date its tip commit was
authored, with both stated and the conversion shown.

Match the existing fast-forward entry format at lines ~628–644 (`999cbdc`).

## A4 — Task 3: the standing-note list is longer than the parent names

The parent names `65abb74`, `f318d2e`, `0a745c3`, `a56c905` and the HR-24/25/26 chain.
The file's standing-note section (line ~7) also carries `bd63da7`, `cc75949`, `f5d2883`,
`0b1cf51`, `7048504`, plus the HR-11j list.

**Discharge from the file, not from the parent prompt's list.** Read the section, mark every
obligation it carries against the entry that now names it, and delete nothing.

## A5 — Task 1: BUG-7 closes on its own stated terms

The BUG-7 row already carries its closure condition at line ~9603: deploy `00881dc`, then
observe **either** the discard line **or** sustained concurrent load with no P2002.

The ~55 `discarded` lines of 2026-08-16 satisfy the first disjunct. Say so explicitly — the
row closes on the criterion it set for itself on 2026-08-13, not on a criterion invented
afterward. That is materially stronger than an after-the-fact justification and the record
should show it.

## A6 — Task 5: DEBT-69's precondition has been met

The DEBT-69 row (line ~9702) reads "REVISIT WHEN WEBHOOKS ARE LIVE… until then there is
nothing to measure." Webhooks are live (34,914 deliveries, production application
`sq0idp-UdjqLfkxl0hlbw7b30IiLA`) and the measurement now exists.

Append rather than replace: note that the precondition is discharged, then add the measured
rate from the parent's § 1e with its environment and window named.

## A7 — Scope and floor, unchanged

Everything in the parent's Section 3 still holds: no `src/`, no promotion, no cuid backfill,
no WORKFLOW.md gate (Gary's ruling to write), and the three files in `docs/test_docs/` are
left alone and flagged only.

Two commits, work then recorder. No push. Report the unpushed count against
`origin/staging`.
