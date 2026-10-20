TIER 3 session. Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/2026-10-16_MS-2_attendance_on_time_badge.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# MS-2 — Attendance on-time % and On-Time badge — TIER 3

TIER 3: likely schema + new settings + a new badge on two screens. Full
audit → plan → STOP for Gary's approval → build. Commit only. Never push.
Never run a migration.

## What MS-2 delivers (plain English)
Froot works out each employee's on-time percentage (clock-in vs scheduled
start) and shows it as a red / yellow / green On-Time badge: full size on
the Milestones tab of /staff/[id], compact on the /staff list. An ADMIN
sets the color thresholds in a new Attendance section of /staff/milestones,
replacing MS-1's "Coming soon" placeholder there.

NOT in MS-2: Raise Eligibility (MS-3), checklists / notifications / Copy
button (MS-4), the report (MS-5). But MS-3 will need "on-time % for this
employee over weeks X–Y", so build the calculation as one reusable
function that takes a date range, not something hard-wired to the badge.

## Context
- Staging carries MS-1 and BUG-15, both verified, neither promoted to main.
  Build on top of them.
- BUG-15 added dashboardAnchorTimeZone / dashboardHeaderDate to
  src/lib/reports.ts. Use the existing store-time-zone helpers
  (localDateStr etc.) for every "which day / which window" decision. No
  bare new Date() formatting in anything server-rendered.
- MS-1 rulings that carry over: Milestones is part of HR (HR off =
  Milestones off); the module toggle off = no badge anywhere, APIs 404;
  Milestones tab visible to ADMIN org-wide and MANAGER for their stores,
  never STORE or STAFF.

## Visual spec
Design bundle: /Users/garythomas/Claude_Projects/Froot/froot/docs/design/milestones/
If it exists, use it for the badge (both sizes, all three colors) and the
Attendance section. If it doesn't, build from existing Froot badge/pill
components (e.g. the Compliance status badges, the "Manually set" badge,
pace-alert colors) and say which ones you copied. Existing components,
colors and classes only.

## Repo gate (one command at a time, paste each result)
pwd                → must end in Froot/froot (one cd allowed if it ends in Froot)
git status         → on staging, tree clean, up to date with origin
git log --oneline -5
If any check fails: STOP and report.

## Phase 1 — AUDIT (read-only, report each item)
A1. The /labor/inspector on-time logic: where it lives, how it defines
    "late" (grace minutes? early clock-in?), and how it pairs a timecard
    with a scheduled shift. MS-2 reuses that definition. There must be
    one definition of "on time" in Froot, not two.
A2. Data source: are Square scheduled shifts and timecards STORED in the
    Froot DB, or fetched live from Square per request? Report tables,
    sync jobs, how far back the data goes, and how often it refreshes.
    This decides whether a compact badge on every /staff row is cheap
    (DB query) or a Square rate-limit problem (live calls per employee).
A3. Square gate: which orgs/stores have scheduled shifts at all (Square
    labor add-on, scheduling enabled). What the badge must show where
    there's no schedule data.
A4. Edge cases in the existing data: scheduled shift with no timecard
    (no-show), timecard with no scheduled shift (unscheduled), one person
    with several shifts a day, shifts across midnight, shifts at more
    than one store. Report how the inspector treats each.
A5. The /staff list: how rows render, how the MS-1 tab gate and the
    module toggle are checked there, and where a compact badge would sit.
A6. The Milestones tab (MS-1) and /staff/milestones page: where the
    badge and the Attendance section plug in.
A7. Settings storage: MS-1 put milestonesEnabled on Organization. MS-3
    will add many more settings (hours/week, weeks, min on-time %,
    compliance gate, cooldown, eligible trainings/docs). Report the house
    pattern for module settings (e.g. how NOTIFY / pace-alert settings
    are stored).
A8. Wage snapshots: confirm MS-1's WageSnapshot writer is untouched by
    this phase.
A9. docs/ROADMAP.yaml: read the MS-2 row (filed as planned by MS-1).
A10. Design bundle: list the files in the folder above, or report it's
     absent.
A11. Dev DB: `npx prisma migrate diff` (read-only) — is dev level with
     the repo? If not level: STOP.

## Phase 2 — PLAN, then STOP
Write the plan to
/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/2026-10-16_MS-2_AUDIT.md
(audit findings, schema as you'd write it, files to touch, forks with your
lean). Commit that one file only. Then STOP and ask Gary to rule.

### Planned schema (adjust to house style and A7)
- A per-org milestone settings record (lean: a new MilestoneSettings
  model, one row per org, created on first save) holding, for MS-2:
  onTimeRedBelow Int (default 80), onTimeGreenAtOrAbove Int (default 90),
  onTimeLookbackDays Int (default 30), onTimeMinShifts Int (default 5).
  MS-3 adds its raise settings to the same record. If A7 shows a clear
  house pattern that differs, follow it and say so.
- No stored on-time results unless A2 forces it: compute from shift and
  timecard data on read, like MS-1's tenure.

### Forks for Gary (state your lean for each)
F1. Look-back window for the badge. Lean: rolling, ADMIN-set, default 30
    days, counted in the employee's store-local days.
F2. Grace period. Lean: whatever A1 shows the inspector uses, with no
    second setting. If the inspector has none, lean: add one ADMIN
    setting (default 0 minutes) that the inspector ALSO reads, so the
    two never disagree. Changing inspector behaviour is a ruling.
F3. No-shows. Lean: a scheduled shift with no timecard counts as NOT on
    time. Unscheduled timecards are left out entirely.
F4. Too few shifts. Lean: below onTimeMinShifts in the window, show a
    grey "Not enough shifts" badge, not red or green.
F5. No schedule data (A3). Lean: grey "No schedule data" badge, and the
    Attendance setup section explains it needs Square scheduled shifts.
F6. Who sees the On-Time badge. Lean: same gate as the Milestones tab
    (ADMIN org-wide, MANAGER for their stores). Unlike Raise Eligibility,
    it's not confidential, but STORE/STAFF don't see /staff anyway.
F7. Compact badge on /staff list. Lean: yes, if A2 shows the data is in
    the DB. If it would mean live Square calls per row, lean: leave the
    list badge out of MS-2 and file a ROW.
F8. Thresholds edge: lean red below the red number, green at or above
    the green number, yellow in between; the setup page refuses
    red ≥ green.

## Phase 3 — BUILD (only after Gary's go)
1. Migration (if any): generate with `npx prisma migrate diff` into a new
   migration folder, then STOP. Gary applies it to dev with
   `npx prisma migrate deploy` and says go.
2. One on-time function: (staffMemberId, date range) → { onTime, total,
   percent, status } using the A1 definition and store-local days. MS-3
   will call it with its own range.
3. Attendance section on /staff/milestones (ADMIN only, milestones.manage):
   thresholds, look-back days, minimum shifts (and grace if F2 says so).
   Validation per F8.
4. Full badge on the Milestones tab: percent, color, "on time in N of M
   shifts, last X days". Grey states per F4/F5.
5. Compact badge on /staff rows per F7, gated by the module toggle and
   the F6 gate.
6. Toggle off = no badge anywhere, attendance settings API 404.
7. Phone width for the tab, the list and the setup section.
8. Fixture: scripts/verify-ms2.ts — percent math; grace boundary;
   no-show counted late; unscheduled excluded; min-shifts grey; threshold
   boundaries (79/80/89/90); red ≥ green refused; look-back window edges
   in a Pacific and a Denver store; toggle-off 404; STORE/STAFF denied;
   out-of-scope MANAGER denied. Run after Gary's dev apply; report count.
9. `npm run build` passes, no error lines above piped output.

## Commits (scope `git add` to touched files — never `git add -A`)
- Work commit: code + migration + fixture.
- Docs commit: MS-2 ROADMAP row (in_progress, work SHA quoted short),
  DECISIONS.md draft of the fork rulings in Gary's words, MIGRATIONS.md
  entry if there's a migration, this prompt and the audit file,
  CLAUDE.md only if a house rule changed.
No DEPLOY_LOG entry — PRE-PUSH-CHECK writes it.

## Out-of-scope findings
Classify each FIX NOW / RULING NOW / COMMENT / ROW. ROW is the last resort.

## Final report
- Commits (SHA + one line), migration name, every prisma command run
  verbatim, fixture pass count, build result.
- Staging checklist for Gary: setup section saves and refuses bad
  thresholds; badge on a staff member with lots of shifts, one with few
  (grey), one at a store with no schedule data (grey); compact badges on
  /staff; toggle off hides all; the three console fetch checks for any new
  API as Tommy (STORE) and gary@keva.com (MANAGER, Carson).
- End with: "Done and committed. Next: PRE-PUSH-CHECK for MS-2." Do not
  push. Do not suggest further work.
