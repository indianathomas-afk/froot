TIER 3 session. Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/2026-10-19_MS-5_milestone_report.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# MS-5 — Milestone Report — TIER 3

TIER 3 because it reads raise and pay-adjacent data across many people at
once. Audit → plan → STOP for Gary's rulings → build. Commit only. Never
push. Never run a migration (none is expected; if one is needed, STOP).

## What MS-5 delivers (plain English)
One report page that shows, for every employee a viewer may see:
- achieved milestones (tenure and, if switched on, checklist), with dates;
- upcoming milestones (the next tenure milestone and days to go; checklist
  progress toward the next threshold);
- the On-Time badge and the Raise Eligibility status;
filterable by store and by milestone type. ADMIN sees the whole org;
MANAGER sees only their stores. Gary's brief: "The report doubles as an
ongoing performance review."

NOT in MS-5: emails, new settings, schema changes, editing anything from
the report. It is read-only.

## Gary's rulings that govern this phase (quote them, don't reinterpret)
- Brief (2026-10-15): "Milestone Report on /staff/milestones: achieved and
  upcoming milestones per employee, filterable by store and type. ADMIN
  org-wide; MANAGER limited to their stores."
- Ruling 2 (2026-10-15): "The Raise Eligibility badge is visible to ADMIN
  and MANAGER only. STORE and STAFF never see it."
- F10 (MS-3): raise dates and amounts reach only viewers who can see that
  person's pay, stripped on the server.
- MS-3c (2026-10-17): amber "Raise in progress" is not shown on the /staff
  list; managers are directed to the Milestones tab.
- MS-4a F13: checklist milestones appear only while the "Checklist
  milestones" switch is on.
- Milestones module off = no report anywhere, routes 404.

## Repo gate (one command at a time, paste each result)
pwd                → must end in Froot/froot (one cd allowed if it ends in Froot)
git status         → on staging, tree clean, up to date with origin
git log --oneline -5
If any check fails: STOP and report.

## Phase 1 — AUDIT (read-only, report each item)
A1. Where the report can live. /staff/milestones is ADMIN-only (MS-1
    ruling 1), but managers must see the report. Report the options
    (e.g. a /staff/milestones/report route with its own gate, or a tab on
    /staff) and how each fits existing gates and nav.
A2. Existing batched readers: MS-1 tenure, MS-2 on-time, MS-3 eligibility
    (getRaiseEligibility + redactForViewer), MS-4a checklist counts. Can the
    report call them for N people without N×queries? Report expected query
    count for Keva's real size (count active staff on dev).
A3. Pay privacy on a multi-person page: confirm the report can only build
    raise data from redactForViewer output, the same way /staff and the tab
    do (MS-3b C10/C12). Any new server route must strip dates/amounts the
    same way.
A4. Store scope: how /staff resolves a MANAGER's stores and "also works
    here" members. The report must use the same rule.
A5. Terminated, archived, unlinked and corporate staff: how the existing
    pages treat each. The report must match.
A6. Upcoming dates: the store-local date helpers (BUG-15, MS-1) for "next
    milestone on <date>, N days to go".
A7. Export: is there an existing CSV/print pattern in Froot? Report it,
    and what a CSV would expose.
A8. docs/ROADMAP.yaml MS-5 row; DECISIONS for MS-1..MS-4b.
A9. Dev level check: `npx prisma migrate diff` (read-only). If not level:
    STOP.

## Phase 2 — PLAN, then STOP
Write docs/prompts/2026-10-19_MS-5_AUDIT.md and commit that one file only
(build-gated). Lead the report with the business forks in plain English,
each with your lean. Then STOP.

### Forks for Gary (state your lean)
F1. Where it lives (A1). Lean: /staff/milestones/report, gated ADMIN +
    MANAGER (own stores), linked from /staff and from the setup page.
F2. Columns. Lean: name, store, start date, tenure (days), last milestone
    reached + date, next milestone + date + days to go, checklist count and
    next threshold (only if switched on), On-Time badge, Raise status.
F3. Raise status on the report. Lean: show all colours here (green, amber,
    red, cooldown) because this is the review page managers are directed
    to (MS-3c); dates only for viewers with pay access (F10).
F4. Filters. Lean: store, milestone type (tenure / checklist / on-time /
    raise), "reached in the last 30 / 90 days", "coming up in the next
    30 days", and a status filter (e.g. raise green only).
F5. Terminated staff. Lean: hidden by default, with a "show terminated"
    toggle that shows their achieved history only.
F6. Export. Lean: CSV download for ADMIN only, built from the same
    redacted data (no pay, no raise dates unless the admin can see pay).
    MANAGER: no export in MS-5. Gary rules.
F7. Sorting. Lean: default by next milestone soonest; clickable columns.
F8. Phone. Lean: card list on phone width, table on desktop.

## Phase 3 — BUILD (only after Gary's go)
1. The report route and page per F1–F8, using the existing batched
   readers. No new schema.
2. Gates: ADMIN org-wide, MANAGER own stores, STORE/STAFF → redirect;
   Milestones off → 404.
3. Raise data only from redactForViewer output; export likewise (F6).
4. Links from /staff and /staff/milestones (admin) to the report.
5. Phone width.
6. Fixture: scripts/verify-ms5.ts — MANAGER sees only own stores (incl.
   "also works here" rules as /staff); STORE/STAFF denied; Milestones off
   404; checklist columns hidden while the switch is off; terminated hidden
   by default; upcoming date correct in a Pacific and a Denver store; a
   MANAGER without pay access gets raise colours but no raise dates in the
   raw page payload and in any CSV (assert on raw output); ADMIN with pay
   access does get them (positive control); filters return the right rows.
   Negative control: break the redaction, confirm the leak check fails,
   restore. Re-run verify-ms1, ms2, ms3, ms3b, ms4a, ms4b.
7. `npm run build` passes, no error lines above piped output.

## Commits (scope `git add` — never `git add -A`)
- Work commit: code + fixture.
- Docs commit: MS-5 ROADMAP row (in_progress, work SHA), DECISIONS draft
  with Gary's words exact and your own choices listed separately, this
  prompt and the audit file. No MIGRATIONS entry unless something changed.
No DEPLOY_LOG entry — PRE-PUSH-CHECK writes it.

## Final report
Commits, fixture counts, build, choices for ratification, and a staging
checklist naming branch br-square-feather-a63z92vz and org
cmr54z65v000105jxczpt72w1: ADMIN view; Tommy as MANAGER (Las Brisas only)
sees only Las Brisas; gary@keva.com (MANAGER, Carson) sees only Carson;
Tommy switched to STORE is redirected; filters; terminated toggle; CSV (if
built) checked by opening it; a pay-confidential member shows no raise
dates to a manager (view-source search); phone width; Milestones off →
404. End with: "Done and committed. Next: PRE-PUSH-CHECK for MS-5." Do not
push.
