TIER 3 session. Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/2026-10-17_CHK-15_task_log_staff_guard.md and execute it. Repo gate first, one command at a time. Stop where it says stop. Include this prompt file in the docs commit.

# CHK-15 — the checklist task route must refuse a staff id it should not accept — TIER 3

TIER 3: a security fix on an API route that writes rows. No schema change.
Audit → STOP for Gary's go → build. Commit only. Never push. No migration.
Ruled by Gary 2026-10-17 as MS-4 fork F12: "treat the cross-company staff id
as a security fix" and "Ship it ahead of MS-4a as its own small phase, no
schema change."

## What CHK-15 delivers (plain English)
When a task is ticked on a checklist and a name is picked from "Who
completed this task?", Froot saves that person's id. Today it saves ANY id
the request sends, even one from another company. After CHK-15 it saves the
id only if the person is:
1. in this company,
2. ACTIVE (not terminated), and
3. assigned to the checklist's store, OR a corporate staff member
   (`StaffMember.isCorporate`) of this company.
Otherwise the tick is refused with a clear sentence on that task — never a
silent failure. "Team Member" and "Manager" still save no name, exactly as
today, so nobody is ever blocked from completing a task.
The picker also stops listing terminated staff.

## Why it matters now
MS-4a will count named tasks toward checklist milestones (F0, Gary
2026-10-17: "Count TASKS where the person is named"). A bad id inflates a
count. Today the only harm is that a planted id from company A makes company
B's staff member impossible to delete (`src/app/api/staff/[id]/route.ts:217`
refuses deletion while any TaskLog names them). No name is shown from the
id, so nothing leaks (`checklist-execution-client.tsx:169` maps ids through
the store's own list).

## Evidence already gathered (MS-4 session, 2026-10-17) — do not re-run
- The gap: introduced in `d930d44` (2026-06-28 10:01:49 PDT / 17:01:49 UTC),
  "Fix store view workflow: template filtering, checklist creation, staff
  selection". The checklist was org-scoped from that commit on; the staff id
  never was. Current code: `src/app/api/checklists/[id]/task-log/route.ts:103-124`.
  The calendar completion route already does this check —
  `src/app/api/calendar/occurrences/[id]/complete/route.ts:112-118` — read it
  as the in-repo precedent.
- Picker list with no ACTIVE filter:
  `src/app/(app)/store-view/checklist/[id]/page.tsx:47-54`.
- Existing rows (Gary ran these in the Neon console; read-only):
  ```
  production br-sparkling-block-a620qvg4  TaskLog naming another company's staff: 0 rows
  production br-sparkling-block-a620qvg4  same company, staff not at checklist's store: 28 rows, 0 after termination, 2026-06-30 17:31 UTC → 2026-08-13 22:09 UTC
  preview/staging br-square-feather-a63z92vz  naming another company's staff: 0 rows
  preview/staging br-square-feather-a63z92vz  same company, not at store: 12 rows, 0 after termination, 2026-07-22 17:20 UTC → 2026-08-08 20:36 UTC
  dev br-broad-wave-a6vpjdw0  naming another company's staff: 0 rows
  dev br-broad-wave-a6vpjdw0  same company, not at store: 23 rows, 0 after termination, all 2026-06-30
  ```
  `br-sparkling-block-a620qvg4` is recorded as production from the repo's
  own docs (CLAUDE.md § Browser Evidence, the 2026-08-06 correction;
  docs/DEPLOY_LOG.md, where production's Vercel build applied migrations
  to it). It was not checked against the Vercel Production endpoint, which
  this repo cannot read (`vercel env pull` is banned).
- **FORWARD-ONLY (Gary, 2026-10-17: "F12 is forward-only").** No existing
  row is changed or deleted. The "not at store" rows are staff who were
  moved after doing the work (none after termination); they keep their
  credit. The new rule applies when a task is SAVED, never to history.

## Will this break a real workflow? (MS-4 session's answer, for the audit to confirm)
- **Covering staff** (working at a store they aren't assigned to): the
  picker only lists staff assigned to the checklist's store, so they can't
  be picked TODAY either. They use "Team Member". Refusing them in the route
  changes nothing they can do through the app. The only way to hit the new
  message from the app is a screen opened BEFORE the person was unassigned
  or terminated.
  **This is a product gap, not a regression:** covering staff get no named
  credit, so under F0 they earn no checklist milestone for covered shifts.
  Report it; don't fix it here.
- **Corporate staff:** the Square sync gives a corporate member one store
  assignment PER STORE (StaffMember schema, DEBT-9 comment), so they already
  appear in every store's picker and already pass a store rule. Gary's lean
  "allow corporate staff" matters only for a member flagged corporate by
  hand with no assignments; the route allows them, the picker still does not
  list them (widening the picker is NOT in scope — say if you think it
  should be, as a fork).

## Repo gate (one command at a time, paste each result)
pwd                → must end in Froot/froot (one cd allowed if it ends in Froot)
git status         → on staging, tree clean (this prompt may be untracked), up to date with origin
git log --oneline -5
If any check fails: STOP and report.

## Phase 1 — AUDIT (read-only, short)
C1. Re-read the task route and the calendar precedent; confirm the line
    numbers above still hold. Name the exact place the check goes: AFTER the
    toggle-off branch (un-ticking must never be refused) and before the
    create.
C2. Every caller of the task route (CLAUDE.md § Verifying a guard covers
    every path: search the ROUTE PATH, not the field name). The MS-4 audit
    found one — the store-view execution client. Confirm or correct.
C3. How the client shows a refusal: `readError` + `setTaskError`
    (`checklist-execution-client.tsx:77-84, 270-273`) already put the
    route's `error` string on the task. Confirm the tick is rolled back on
    a non-2xx.
C4. Any other reader of `TaskLog.completedByStaffId` whose behaviour the
    rule changes (the MS-4 session found none that display it).
Then STOP with the plan and the exact messages below. Wait for Gary's go.

## Phase 2 — BUILD (only after Gary's go)
1. A small lib function (e.g. `src/lib/task-log-staff.ts`,
   `resolveTaskLogStaff({ organizationId, storeId, staffId })`) returning
   `{ ok: true, staffId: string | null }` or `{ ok: false, error }`. The
   route calls it; the fixture calls the same function.
   - null / "manager" → ok, null (unchanged).
   - not found IN THIS ORG → refuse. Message must not reveal that the id
     exists elsewhere: "That name can't be used on this checklist. Pick a
     name from the list, or choose Team Member."
   - TERMINATED → "<displayName> is no longer an active team member. Choose
     another name, or Team Member."
   - not assigned to the store and not corporate → "<displayName> isn't
     assigned to this store. Choose Team Member, or ask an admin to add them
     to this store."
   - Status 400 for all three (the client shows the string either way).
2. The route uses it, after the un-tick branch, before the create.
3. The picker query adds `status: "ACTIVE"`.
4. Fixture `scripts/verify-chk15.ts` against the DEV branch, every row under
   an org named "CHK-15 Fixture Org" (plus a second "CHK-15 Fixture Org B"
   for the foreign id), deleted in `finally`:
   - foreign-company staff id → refused, message names no company;
   - terminated → refused; unassigned same-company → refused;
   - corporate with no assignment → allowed; assigned active → allowed;
   - null and "manager" → allowed, saved as null;
   - structural: the route imports and calls the function, and the call
     sits after the un-tick branch (an un-tick of a log naming a since-
     terminated person must still succeed);
   - structural: the picker query filters ACTIVE;
   - negative control: break one rule, show a check fail, restore.
   Re-run verify-ms1, verify-ms2, verify-ms3, verify-ms3b (unchanged counts).
5. `npm run build` passes; scoped eslint over touched files.

## Commits (scope `git add` — never `git add -A`)
- Work commit: lib + route + picker + fixture.
- Docs commit: CHK-15 ROADMAP row to in_progress/staging per house style,
  DECISIONS draft (Gary's F12 words exact; your choices listed separately),
  this prompt. No MIGRATIONS entry (none). No DEPLOY_LOG entry —
  PRE-PUSH-CHECK writes it.

## Final report
Commits, fixture counts, build, choices for ratification, and a staging
checklist: tick a task naming an assigned active person (saves); terminate a
"CHK-15 Staff" fixture member with the checklist screen already open, then
pick them (clear message, tick rolls back); "Team Member" still works; the
terminated person is gone from the picker after reload. Name the org by id
on every observation. End with: "Done and committed. Next: PRE-PUSH-CHECK
for CHK-15, then MS-4a." Do not push.
