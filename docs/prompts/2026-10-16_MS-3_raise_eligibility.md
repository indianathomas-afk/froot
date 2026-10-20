TIER 3 session. Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/2026-10-16_MS-3_raise_eligibility.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# MS-3 — Raise Eligibility — TIER 3

TIER 3: schema + confidential pay data + a new badge. Full audit → plan →
STOP for Gary's approval → build. Commit only. Never push. Never run a
migration.

## What MS-3 delivers (plain English)
A red / yellow / green Raise Eligibility badge for each employee, seen
only by ADMINs and MANAGERs, built from settings an ADMIN controls on
/staff/milestones: compliance, hours per week over consecutive weeks,
on-time %, required trainings/documents, and a cooldown after a raise.
Froot detects a completed raise when it sees the Square wage go up.

NOT in MS-3: notifications and the Copy button (MS-4), the report (MS-5).
Froot stays read-only from Square.

## Context
- Staging carries MS-1, BUG-15 and MS-2, verified, not promoted. Build on
  top of them. The schedule cron (MS-2) only runs on production, so
  staging schedule history stays thin; plan for that (F9).
- Reuse, don't rebuild:
  - MS-2's on-time function (staffMemberId, date range) for the on-time
    criterion. One definition of on time.
  - MS-1's WageSnapshot table and writer (change-only, baseline row on
    the first sync). MS-1 recorded that nothing reads it yet and that
    the first reader must apply the existing pay permission, the
    viewer's store scope and the confidential-pay flag (COMP-1).
  - MS-2's MilestoneSettings row: raise settings go on the same record.
  - Store-time-zone helpers (BUG-15). No bare new Date() formatting.
- Gary's rulings 2, 4, 5 (2026-10-15) govern this phase:
  2. The Raise Eligibility badge is visible to ADMIN and MANAGER only.
     STORE and STAFF never see it.
  4. Once a raise is completed, the Raise Eligibility badge goes away. An
     ADMIN sets a cooldown on the setup page (30 / 60 / 90 / 180 /
     custom days) before the employee can become eligible again.
  5. The 100%-initial-compliance gate is an ADMIN toggle. Tenure
     milestones ALWAYS count from the start date, whatever the toggle
     says. The gate applies to raise eligibility only.

## Visual spec
No design bundle. Use the MS-2 badge (BADGE_PRESETS, status pill) for the
Raise badge in both sizes, and existing form components for settings.
Say which components you copied.

## Repo gate (one command at a time, paste each result)
pwd                → must end in Froot/froot (one cd allowed if it ends in Froot)
git status         → on staging, tree clean, up to date with origin
git log --oneline -5
If any check fails: STOP and report.

## Phase 1 — AUDIT (read-only, report each item)
A1. Wage data: SquareTeamMemberWage shape (one wage per job? hourly vs
    salary?), how WageSnapshot rows are written, and every trigger that
    syncs wages today (manual /settings/labor only? any cron?). How
    stale can a wage be before Froot sees a raise?
A2. COMP-1: the pay permission, the confidential-pay flag, and exactly
    which roles/scopes may see pay. Who may see the Raise badge vs who
    may see wage amounts or raise dates. Report any MANAGER who can't
    see pay under COMP-1.
A3. Compliance: what "outstanding compliance" and "initial compliance"
    mean in the code today (Compliance tab, compliance %). Are they the
    same thing or two different checks? (Brief says "any outstanding
    compliance = red"; ruling 5 says "100%-initial-compliance gate".)
A4. Hours: where weekly hours come from (timecards), the labor week
    definition (start day, store-local), overtime/breaks handling. Is
    there an existing weekly-hours helper?
A5. Trainings and Document Library: the models, what "completed" means
    for a training and for a document (signed? acknowledged?), and how
    to list them for checkboxes.
A6. MS-2 on-time function signature, and how it reports "not enough
    shifts" / "no schedule data" for an arbitrary range.
A7. Where the Raise badge plugs in: the Milestones tab and the /staff
    list beside the On-Time badge. Confirm the gate keeps STORE/STAFF out
    of both, and how COMP-1's confidential flag applies on each.
A8. docs/ROADMAP.yaml MS-3 row; DECISIONS entries for MS-1 and MS-2.
A9. Dev DB: `npx prisma migrate diff` (read-only) — is dev level? If
    not: STOP.
A10. Size: is this one session or two? If the audit shows it's too big
     to build and verify safely at once, propose a split (e.g. MS-3a:
     settings + criteria + badge; MS-3b: raise detection + cooldown)
     with the boundary and why.

## Phase 2 — PLAN, then STOP
Write the plan to
/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/2026-10-16_MS-3_AUDIT.md
(findings, schema, files, forks with your lean, any split). Commit that
one file only. Then STOP and ask Gary to rule. Lead the report with the
forks that need a business decision, in plain English.

### Planned schema (adjust to house style)
- Raise settings on MilestoneSettings: raiseComplianceGate Boolean,
  raiseMinHoursPerWeek Int, raiseConsecutiveWeeks Int,
  raiseMinOnTimePct Int, raiseCooldownDays Int (30/60/90/180 or custom),
  plus a join table for required trainings/documents.
- A raise record per detected raise (staffMemberId, detectedAt, from and
  to rate, snapshot ids), or derive raises from WageSnapshot on read.
  State the lean and why.
- Optional per F6: a manual "last raise date" on the staff member.

### Forks for Gary (state your lean for each)
F1. What each colour means. Lean: GREEN = every enabled criterion met
    and not in cooldown. RED = a hard blocker (compliance gate fails, or
    on-time below the minimum). YELLOW = no hard blocker, but at least
    one criterion still in progress (hours streak, trainings). Badge and
    tab list each criterion as met / not met.
F2. Compliance gate meaning (A3): lean, one ADMIN toggle that checks
    whatever A3 shows matches "initial compliance at 100%". If the code
    has two different checks, Gary picks.
F3. Hours: lean, the last Y COMPLETED labor weeks (not the current
    partial week), each ≥ X hours, store-local, all stores combined.
F4. On-time: lean, the MS-2 percentage over those same Y weeks, using
    the org's grace period. "Not enough shifts" in that range counts as
    criterion not met (yellow, not red).
F5. What counts as a raise: lean, any increase in an hourly rate on any
    of the member's jobs. A new job at a higher rate counts. A decrease
    doesn't reset anything. Salaried staff: lean, raise detection off,
    badge shows criteria only.
F6. Raises before Froot's first snapshot are invisible, so on day one
    everyone looks out of cooldown. Lean: an ADMIN-only "last raise
    date" field per member to cover pre-Froot raises.
F7. During cooldown (ruling 4: badge goes away). Lean: no badge on the
    /staff list; on the tab, ADMIN/MANAGER see "Recent raise — eligible
    again from <date>", with no amounts.
F8. Wage freshness (A1). Lean: add a daily wage sync to the existing
    timecard cron (read-only Square call) so raises are seen within a
    day. If it changes Square scope or cron cost materially, Gary rules.
F9. Thin staging data: lean, the badge is honest about missing data
    (criterion "not enough data", yellow), never green on missing data.
F10. COMP-1 (A2): lean, the colour is shown to every ADMIN/MANAGER who
     can see the member; wage amounts and raise dates only to those who
     can see that member's pay. API responses never include amounts for
     anyone else.

## Phase 3 — BUILD (only after Gary's go)
1. Migration: `npx prisma migrate diff` into a new folder, then STOP.
   Gary applies it to dev and says go.
2. One eligibility function: (staffMemberId, asOf) → status + each
   criterion's result. MS-4 notifications and MS-5's report will call it.
3. Raise detection from WageSnapshot (and F6's manual date), cooldown.
4. Raise section on /staff/milestones (ADMIN only): all settings, with
   training/document checkboxes; validation (positive numbers, sane
   ranges, custom cooldown).
5. Raise badge: full on the Milestones tab with the criteria list,
   compact on /staff beside On-Time. ADMIN + MANAGER only; toggle off =
   gone everywhere, APIs 404.
6. Phone width for all three surfaces.
7. Fixture: scripts/verify-ms3.ts — each colour; each criterion boundary
   (hours X-1/X, weeks Y-1/Y, on-time at the minimum); partial current
   week ignored; raise detected on increase only; cooldown boundaries
   (day before / day of); manual last-raise date; salaried member;
   compliance gate on/off; trainings/documents required vs not;
   thin-data yellow, never green; STORE/STAFF denied; out-of-scope
   MANAGER denied; a MANAGER without pay permission gets the colour but
   NO amounts or dates in any API response (assert on the raw JSON).
   Re-run verify-ms1 and verify-ms2. Run after Gary's dev apply.
8. `npm run build` passes, no error lines above piped output.

## Commits (scope `git add` to touched files — never `git add -A`)
- Work commit: code + migration + fixture.
- Docs commit: MS-3 ROADMAP row (in_progress, work SHA), DECISIONS draft
  of Gary's fork rulings in his words plus any choice you made that he
  didn't rule on, MIGRATIONS.md entry, this prompt and the audit file.
No DEPLOY_LOG entry — PRE-PUSH-CHECK writes it.

## Out-of-scope findings
Classify each FIX NOW / RULING NOW / COMMENT / ROW, in plain English with
your lean. ROW is the last resort.

## Final report
- Commits, migration name, every prisma command verbatim, fixture counts
  (MS-1, MS-2, MS-3), build result.
- Any choice you made that Gary didn't rule on, listed for ratification.
- Staging checklist for Gary: settings save and refuse bad input; one
  member per colour; a member in cooldown; a salaried member; toggle
  off; console checks on every new API as Tommy (switched to STORE) and
  gary@keva.com (MANAGER, Carson), including that no wage amounts appear
  in responses for a manager without pay permission; phone width.
- End with: "Done and committed. Next: PRE-PUSH-CHECK for MS-3." Do not
  push. Do not suggest further work.
