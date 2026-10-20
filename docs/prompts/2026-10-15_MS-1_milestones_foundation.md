TIER 3 session. Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/2026-10-15_MS-1_milestones_foundation.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# MS-1 — Staff Milestones foundation — TIER 3

TIER 3: schema + new capability + new pages. Full audit → plan → STOP for
Gary's approval → build. Commit only. Never push. Never run a migration.

## What MS-1 delivers (plain English)
The on/off switch, the skeleton of the ADMIN setup page, a start date on
every staff member, tenure milestones the ADMIN can add/edit, and a
Milestones tab on /staff/[id] that shows tenure progress and achieved
tenure milestones. Attendance (MS-2), raise eligibility (MS-3), checklist
milestones, notifications and the Copy button (MS-4) and the report (MS-5)
are NOT in this session — leave clearly labelled empty sections only where
the design bundle shows them, nothing wired.

## Visual spec
Design bundle: /Users/garythomas/Claude_Projects/Froot/froot/docs/design/milestones/
Use it as the visual spec for the Milestones tab, the /staff/milestones
page shell and the /settings Milestones card. Use existing Froot
components only (shadcn/ui as already installed). Do not add components,
colors or classes. If the bundle is missing or empty, say so in the audit
report — do not invent a design; Gary decides at the STOP.

## Gary's rulings (2026-10-15) — draft into docs/DECISIONS.md verbatim
1. Toggle stays on /settings. Only ADMINs see the Milestone setup page.
2. The Raise Eligibility badge is visible to ADMIN and MANAGER only.
   STORE and STAFF never see it.
3. Notifications go to ADMINs and MANAGERs only. Froot never emails
   employees. Each milestone carries a suggested employee message with a
   Copy button; the manager pastes it into an existing email system
   (e.g. mail.keva.com).
4. Once a raise is completed, the Raise Eligibility badge goes away. An
   ADMIN sets a cooldown on the setup page (30 / 60 / 90 / 180 / custom
   days) before the employee can become eligible again.
5. The 100%-initial-compliance gate is an ADMIN toggle. Tenure milestones
   ALWAYS count from the start date, whatever the toggle says. The gate
   applies to raise eligibility only.
These are a draft until Gary ratifies them in the PRE-PUSH-CHECK session.

## Repo gate (one command at a time, paste each result)
pwd                → must end in Froot/froot
git status         → on staging, tree clean
git log --oneline -5
If any check fails: STOP and report. No `cd` unless the gate fails.

## Phase 1 — AUDIT (read-only, report each item)
A1. Settings toggle pattern: find the Calendar module toggle (card on
    /settings + its toggle API route + the Organization field). MS-1 copies
    that shape exactly. Report file paths.
A2. Staff start date: does the staff model already hold a hire/start date?
    Where does the Square team-member import write, and which Square field
    feeds it (expected: team member `created_at` only — Square has no hire
    date)? Report whether a re-sync would overwrite a hand-edited value.
A3. /staff/[id] tabs: how the Compliance tab is built and gated (roles,
    MANAGER store scope). Report the gate verbatim — the Milestones tab
    will mirror it.
A4. Who can edit staff fields today on /staff/[id] (roles, capability
    keys). The start-date edit will mirror it.
A5. Capability registry: ENFORCED_CAPABILITIES / GRANTABLE_CAPABILITIES
    location and the domain.resource.action convention. Confirm a key can
    be ADMIN-only and not grantable.
A6. Timezone helper: the store-local date helper used by CAL-2a. Tenure
    day counts use it (UTC trap — DB is UTC, stores are Pacific).
A7. /staff sub-page pattern: how a sub-route (e.g. /settings/labor,
    /settings/notifications) is laid out and linked. /staff/milestones
    follows it.
A8. Wage data: does Froot already store a team member's current wage from
    Square (table, field, sync job)? Is it behind COMP-1 confidentiality?
    Needed for fork F3.
A9. Rehire/terminated handling (HR-15b): which fields mark a terminated
    or rehired staff member.
A10. docs/ROADMAP.yaml: read the file (never assume the next free id).
     Report whether MS-1..MS-5 rows exist.
A11. Design bundle: list the files in
     /Users/garythomas/Claude_Projects/Froot/froot/docs/design/milestones/
A12. Dev DB: run `npx prisma migrate diff` (the only DB-touching command
     allowed) and report whether dev is level with the repo. If not
     level: STOP — Gary applies pending migrations to dev himself.

## Phase 2 — PLAN, then STOP
Write the plan to
/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/2026-10-15_MS-1_AUDIT.md
covering the audit findings, the schema below as you'd actually write it,
files to touch, and the forks below with your lean. Commit that one file
only (`git add` that path only). Then STOP and ask Gary to rule on the
forks. Do not build until he says go.

### Planned schema (additive only; adjust names to house style)
- Organization.milestonesEnabled Boolean NOT NULL DEFAULT false
- Staff start date: if A2 finds no field, add `startDate` as a date-only
  column (@db.Date) plus `startDateManual Boolean DEFAULT false`. Square
  import fills startDate only when startDateManual is false; a hand edit
  sets it true. Orgs without Square enter it by hand.
- TenureMilestone: id, organizationId, dayCount Int (>0), title,
  recognition (text), employeeMessage (text), archivedAt DateTime?,
  createdAt, updatedAt. No two active milestones in an org share a
  dayCount (enforce in code if a partial unique index isn't house style).
- No "achieved" table: achieved/upcoming tenure milestones are COMPUTED
  from startDate + dayCount in the store-local date, so a start-date
  correction re-flows instantly. (MS-4 adds whatever it needs to send a
  notification once.)

### Forks for Gary (state your lean for each)
F1. Milestones tab visibility: mirror the Compliance tab gate from A3
    (lean: ADMIN org-wide, MANAGER for assigned stores; STORE/STAFF none).
F2. Start-date editing: mirror A4's staff-edit permission (lean), or
    ADMIN only.
F3. Start wage snapshots now: Square returns only the current wage, so
    raise detection (MS-3) works only from the first snapshot forward.
    Lean YES — add a write-only WageSnapshot table to MS-1 and capture on
    every existing sync (only when the wage differs from the last
    snapshot), no UI, respecting COMP-1. Every week MS-1 ships before MS-3
    is a week of raise history gained. If A8 shows no wage is pulled
    today, lean NO and leave it to MS-3 (would change Square scope, which
    is frozen).
F4. Terminated staff: lean — the tab shows achieved milestones up to the
    termination date, no "next milestone"; rehire keeps the stored start
    date and an ADMIN edits it by hand.

## Phase 3 — BUILD (only after Gary's go)
1. Migration: generate with `npx prisma migrate diff` into a new
   migration folder. Then STOP. Gary applies it to dev with
   `npx prisma migrate deploy` and says go. Do not run the fixture or
   commit code before that.
2. Toggle: `milestonesEnabled` card on /settings matching the Calendar
   card; toggle route copies the calendar toggle route. ADMIN only.
   OFF = no Milestones tab, /staff/milestones not reachable, no link on
   /staff, milestone APIs return 404.
3. Capability `milestones.manage` — ADMIN-only, not grantable. Guards
   /staff/milestones and every write route.
4. /staff/milestones (ADMIN only): page shell per the bundle. Live
   section: tenure milestone list with add / edit / archive (dayCount,
   title, recognition, employee message). Placeholder sections only for
   Attendance, Raise eligibility, Checklists — labelled "Coming soon",
   no controls.
5. Start date: shown and editable on /staff/[id] per F2; Square import
   respects startDateManual. Empty state when no start date: "No start
   date — add one to track milestones."
6. Milestones tab on /staff/[id], next to Compliance, gated per F1:
   next milestone + days to go, progress bar, achieved tenure milestones
   each showing its recognition and employee message text. Empty states:
   no milestones set up yet (ADMIN sees a link to /staff/milestones,
   MANAGER sees "Ask an admin to set up milestones"); new employee with
   nothing achieved yet. Works at phone width (managers use Froot on
   phones).
7. F3 wage snapshots if ruled yes.
8. Fixture: scripts/verify-ms1.ts — day-count math across the Pacific
   date boundary, toggle-off hides tab and 404s APIs, MANAGER out of scope
   can't see the tab, STORE/STAFF denied, manual start date survives a
   simulated re-sync, archived milestone not counted, duplicate dayCount
   refused. Run it after Gary's dev apply; report pass count.
9. `npm run build` must pass (it runs prisma generate — note that, it's
   not a migration). Confirm no error line above any piped output.

## Commits (scope `git add` to the files you touched — never `git add -A`)
- Work commit: code + migration + fixture.
- Docs commit: docs/ROADMAP.yaml MS-1 row (status in_progress, work SHA
  as a quoted short SHA; file MS-2..MS-5 as planned rows if absent,
  preserve-and-mark), docs/DECISIONS.md draft of rulings 1–5 plus any
  fork rulings in Gary's words, docs/MIGRATIONS.md entry, CLAUDE.md only
  if a house rule changed.
No DEPLOY_LOG entry — PRE-PUSH-CHECK writes it.

## Out-of-scope findings
Classify each FIX NOW / RULING NOW / COMMENT / ROW before the report.
ROW is the last resort.

## Final report
- Commits (SHA + one line each), migration name, every prisma command run
  verbatim, fixture pass count, build result.
- What to look at on staging after Gary pushes: /settings toggle on/off,
  /staff/milestones add/edit/archive, a staff member's Milestones tab at
  desktop and phone width, Tommy (STORE) sees no tab, start-date edit
  persists.
- End with: "Done and committed. Next: PRE-PUSH-CHECK for MS-1." Do not
  push. Do not suggest further work.
