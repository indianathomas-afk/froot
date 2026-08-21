# Labor Day Inspector — S5 · Session Prompt

**Module:** Advanced Labor / troubleshooting surface (new page)
**TIER:** 2 with approval checkpoint — Stage 1 records Gary's scope
rulings (docs commit), then AUDIT → PLAN → STOP for approval → BUILD.
**Builds on:** S2–S4 + CRON-1 activation, all on staging. Design brief:
BUG-10 (phantom opens, the 26-minute gap) and the 2026-08-20 Las Brisas
investigation — the page exists so that hunt never needs Neon again.
**Session type:** One session: rulings, then the inspector page.
No schema changes, no sync changes, no new tables.

---

## STAGE 1 — record the rulings, commit before proceeding

NEW entry at the top of docs/DECISIONS.md (heading to house
convention; bullets VERBATIM):

## Labor Day Inspector, S5 scope — 2026-08-21 (Gary)
- A troubleshooting page exists for labor data: pick a store and a
  day, see every person's timecards on a timeline with scheduled
  shifts ghosted behind, and variance flags computed. Its purpose is
  diagnosing Square-vs-Froot labor variances without database access. (Gary)
- Manager/admin surface only — gated like /settings/labor
  (labor.manage), NOT STORE-visible. It shows names and times;
  wages, rates, tips, and pay data NEVER appear. notes never
  selected. (Gary)
- Read-only in every direction: the page fixes nothing, edits
  nothing, and never writes to Square (standing law). Corrections
  happen in Square; the page tells you where to look. (Gary)
- Break intervals are not rendered — Froot stores summed break
  minutes only (S1-measured). Timeline bars are clock-in to
  clock-out; no break segmentation is implied. (Gary)
- The page carries sync-freshness stamps for both timecard and
  schedule sync (computeHealth, 26h), so lag is never mistaken for
  truth. (Gary)

Commit "docs: S5 inspector scope rulings". Then proceed to Stage 2.

## STAGE 2 — audit (file:line), plan, STOP for approval, build.

### Binding constraints (beyond the Stage 1 rulings)
- Existing tables only: SquareTimecard (never selecting wage/tip
  columns or emitting squareTeamMemberId), SquareScheduledShift
  (effective columns, tombstones filtered), StaffMember for names
  (unresolvable → "Unnamed" + flagged), both sync-state tables.
- Import wall: page/reads land schedule-side or route-side; no core
  engine imports anything new.
- Pure assembly function for the timeline + flags (injected now +
  timezone), fixtured without DB — the house pattern.
- Suite condition: green except DEBT-76's exact nine (diffed sorted);
  DEBT-77 flake rule.

### Audit checklist (brief; quote file:line)
1. Where the page lands (/labor/inspector vs a sibling route) given
   the app's routing + nav structure; its guard, cloned from
   /settings/labor's (page.tsx:44 precedent).
2. Existing reads to reuse: assembleClockedInRoster, clockInLabelFor,
   computeScheduledCoverage/HoursByDay, computeHealth, resolveJobTitles,
   job colors — name what's reusable vs what needs a new pure function.
3. The day-window question: what "a day's timecards" means at the
   edges (cards spanning midnight, open cards from prior days) —
   propose the window, informed by BUG-10.
4. Chart/timeline rendering approach consistent with the design
   system (Recharts vs styled rows — propose; per-person horizontal
   bars are the goal, jobs colored via the S3 color map).

### The flags (build all; thresholds proposed in the plan)
- OPEN-STALE: open card whose startAt precedes store-local today
  (the BUG-10 phantom), labeled with its date.
- OPEN-LONG: open card exceeding a proposed hour threshold today.
- DOUBLE: two cards for one person overlapping in time (the
  Duncan pattern).
- UNMAPPED: team member with no StaffMember record (the Emmalea
  pattern) — named "Unnamed" and flagged, never dropped (D6 law).
- NO-SHOW: scheduled effective shift with no timecard overlapping it
  (schedule data present only — suppress at stores with no schedules,
  seam (c) honesty).
- UNSCHEDULED: timecard with no overlapping scheduled shift (same
  suppression rule).

### Plan then STOP
Files, route + guard, the pure assembly signature, timeline render
approach, flag thresholds, fixture list (must include: the two real
BUG-10 cards at their measured times producing OPEN-STALE; a Duncan
double producing DOUBLE; an Emmalea unmapped producing UNMAPPED;
midnight-spanning card; no-schedule store suppressing NO-SHOW/
UNSCHEDULED), and any deviations. WAIT FOR GARY'S APPROVAL.

### Build (after approval)
The page, the reads, the pure assembly, the flags, the freshness
stamps, fixtures. Build green; suite per condition; import wall grep.
Two commits (work; docs: OVL-S5 row + file this prompt). NOT pushed.
Findings triaged FIX NOW / RULING NOW / COMMENT / ROW.

### Out of scope
- Any fix action from the page (close card, edit, nudge) — read-only law.
- Multi-day/week views, exports, alerting — future rows if wanted.
- Deletion-blindness reconcile (still theoretical; own ruling).
- Emmalea's staff record (operational).
- Any Weekly Plan / dashboard-card changes.
