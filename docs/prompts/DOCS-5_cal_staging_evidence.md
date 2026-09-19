# DOCS-5 — Record 2026-09-18 staging evidence for the CAL track — TIER 1

Docs only. No code. One docs commit. You never push. Pick the row id by
verifying the next free DOCS-n (do not assume 5).

## Repo gate
pwd must end in Froot/froot. git status: on staging, clean, up to date
with origin/staging. Confirm HEAD is CAL-2a's check commit or later.

## Evidence (from Gary, in chat, 2026-09-18 — cite this message;
## every item below was observed on staging, org
## org_3G02wO4QlVVSWppi8aqlnSZnsDa, Clerk verified-snapper-7, except
## where a branch is named)

CAL-1
- Migration 20260917143000_cal1_calendar applied: dev br-broad-wave
  13:26Z (Gary, migrate deploy), staging br-square-feather (Vercel
  build), production br-sparkling-block (Vercel build, promotion
  53cb9ce); SQL calendar_tables = 4 on all three. Production
  orgs_enabled = 0.
- Cron curl (preview CRON_SECRET, length 64) 17:04Z: materialized 1,
  skippedDisabled 9. Second run 17:06Z: materialized 0, skippedFuture 1.
  Vercel cron does not fire on preview deployments — staging runs are
  manual curls; record this as a standing note on the CAL track.
- Banner on /dashboard as Tommy (MANAGER, Las Brisas): "1 reminder due ·
  3 days overdue" for a Sep 14 reminder; overdue counted from dueAt
  (store close / midnight), not the due date — ruling 8 literal.
  Complete cleared it. Stacks beneath the SELF-1 banner as a second red
  bar.
- Grant test and STORE-account completion: NOT yet observed (owed).

CAL-1a — first-row day click opens a centred dialog. Observed.
CAL-1b — Edit dialog opens pre-filled; save works. Observed.

CAL-2
- Migration 20260918180000_cal2_scheduled_checklists: dev
  br-broad-wave 19:50:06Z — applied DURING the CAL-2 build session,
  contradicting that session's report ("not run locally"). Correct the
  migration ledger entry: state who applied it and when, preserve the
  original claim marked. Staging br-square-feather 20:01:31Z (Vercel
  build after push).
- Template form copy updated; /calendar shows "CAL-2 test" with
  checklist glyph on every Friday. Observed.
- Cron curl 22:14Z: events 3, scanned 14, materialized 13,
  checklistsCreated 12, checklistFailed 0. The 12 = template applied to
  all stores (ruling 2). SQL on br-square-feather: CAL-2 test 12
  occurrences / 12 checklists; two reminders 1/0 each.
- Carson checklist opened via "Open checklist" from the calendar and
  submitted; calendar shows Completed. Observed.
- Day-close curl 00:34Z Sep 19: occurrencesMissed 0 — CORRECT, no
  store had closed Sep 18 yet. frequencyLeftOpen 0 across 23
  store-days; frequencyExcluded 25 (pre-existing litter, count still
  owed via §A7 SQL). Missed sweep, afterDate proof, litter count: owed.

CAL-2a
- Today marker on Fri 18 at 19:08 PDT (was Sat 19 before the fix).
- Second reminder created on the 18th via the day number; header + New
  works; empty-day click works. Two chips render on the 18th.

## Task 1 — ROADMAP.yaml (prepend-only riders, nothing deleted)
- CAL-1: rider listing the above as observed; the two remaining unrun
  checks named. Resolve the blockers the evidence satisfies (text
  preserved, marked resolved).
- CAL-1a, CAL-1b: rider "verified on staging 2026-09-18".
- CAL-2: rider with the cron/SQL/completion evidence; blockers for
  Missed sweep, afterDate proof, litter count stay live.
- CAL-2a: rider "verified on staging 2026-09-18 19:08 PDT"; status
  stays staging.
- New ROW candidates, filed as debt rows if not already present:
  (a) two stacked red banners on /dashboard when both compliance and
  calendar items are due — consider one bar; (b) "N days overdue"
  counts from dueAt, a human reads it from the due date — ruling 8
  question for Gary, not a bug; (c) Vercel cron never fires on preview
  — every staging protocol needs a manual curl; document in
  WORKFLOW.md's evidence section as a standing note rather than a row.

## Task 2 — MIGRATIONS.md
Correct the CAL-2 ledger entry per the 19:50Z finding. Preserve the
original sentence, marked.

## Task 3 — WORKFLOW.md
One paragraph under evidence: preview deployments have no Vercel cron;
staging cron evidence is a manual curl with the Preview-scope
CRON_SECRET via `read -s S`, `echo ${#S}` = 64.

## Gates and report
npm run build exit 0, no pipe. YAML parses. Report the SHA and the
phase/debt counts before and after. Stop.
