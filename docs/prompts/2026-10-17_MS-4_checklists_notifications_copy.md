TIER 3 session. Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/2026-10-17_MS-4_checklists_notifications_copy.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# MS-4 — Checklist milestones, notifications, Copy employee message — TIER 3

TIER 3: likely schema + emails. Full audit → plan → STOP for Gary's
rulings → build. Commit only. Never push. Never run a migration.

## What MS-4 delivers (plain English)
1. Checklist milestones: an ADMIN sets "N checklists completed" milestones
   on /staff/milestones; each has a recognition and an employee message,
   like tenure milestones.
2. Notifications: when an employee reaches a milestone, Froot emails the
   ADMINs and that employee's assigned MANAGERs, using the branded
   template (NOTIFY-2b), with one line per email type in the NOTIFY-2c
   per-user grid so an ADMIN can switch people off. Froot NEVER emails
   the employee.
3. Copy employee message: a Copy button beside each achieved milestone's
   suggested message on the Milestones tab, for the manager to paste into
   their own email system.

NOT in MS-4: the Milestone Report (MS-5).

## Context
- Staging carries MS-1, BUG-15, MS-2, MS-3a, MS-3b, MS-3c, all verified,
  none promoted. Build on top of them.
- Gary's ruling 3 (2026-10-15): "Notifications go to ADMINs and MANAGERs
  only. Froot never emails employees. Each milestone carries a suggested
  employee message with a Copy button; the manager pastes it into an
  existing email system (e.g. mail.keva.com)."
- MS-3c (2026-10-17): managers are directed to the Milestones tab; amber
  "Raise in progress" is tab-only. Notifications should link to the tab.
- Reuse: MS-1 tenure computation, MS-3 eligibility function, the
  NOTIFY-2b template, the NOTIFY-2c grid, existing cron(s), store-time-zone
  helpers. Crons run on production only.
- Open item: Tommy (MANAGER, Las Brisas only) may have seen a Southgate
  card on /staff. "Assigned MANAGERs" for emails must use the same store
  scope as everything else; A6 checks it.

## Repo gate (one command at a time, paste each result)
pwd                → must end in Froot/froot (one cd allowed if it ends in Froot)
git status         → on staging, tree clean, up to date with origin
git log --oneline -5
If any check fails: STOP and report.

## Phase 1 — AUDIT (read-only, report each item)
A1. Checklists: what "a checklist completed by an employee" means in the
    data. Is completion tied to a StaffMember, a Froot user, or a store?
    Do STAFF-level employees have their own completions, or does a
    manager complete on the store's behalf? If completions can't be
    attributed to a person reliably, say so plainly — it decides whether
    checklist milestones can work at all.
A2. NOTIFY-2b template and NOTIFY-2c grid: how a new email type is added,
    how recipients are resolved, how the grid switch-off is stored.
A3. Sending: what triggers existing notification emails (cron, event,
    request), retry and de-duplication behaviour, and what staging does
    with email. Does staging send real emails to real addresses? If yes,
    say exactly how MS-4 avoids emailing real Keva managers from staging.
A4. Back-fill risk: on the first run, many employees already passed
    milestones. Report how many tenure milestones are already "achieved"
    on staging, so Gary sees the size of an accidental flood.
A5. Raise eligibility as an email: is "became Raise eligible (green)" a
    notification Gary would want? List it as a fork, not a default.
A6. Recipients: how an employee's "assigned MANAGERs" are found, and
    that it matches the store scope /staff uses. Report anything that
    could send to an out-of-scope manager.
A7. The Copy button: existing clipboard pattern in Froot, and whether
    any placeholder substitution exists today.
A8. docs/ROADMAP.yaml MS-4 row; DECISIONS for MS-1..MS-3c.
A9. Dev DB: `npx prisma migrate diff` (read-only) — is dev level? If not:
    STOP.
A10. Size: one session or a split (e.g. MS-4a checklist milestones +
     Copy; MS-4b notifications)? Propose a split if it's safer.

## Phase 2 — PLAN, then STOP
Write the plan to
/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/2026-10-17_MS-4_AUDIT.md
and commit that one file only. Lead the report with the business forks in
plain English. Then STOP.

### Forks for Gary (state your lean for each)
F1. Checklist milestones: one N or a list (e.g. 10, 50, 100) like tenure.
    Lean: a list, same shape as tenure.
F2. Which events email: lean, tenure milestone reached and checklist
    milestone reached. Raise eligible: fork (A5), lean off unless Gary
    wants it, since managers are being directed to the tab.
F3. Back-fill: lean, on the first run (and whenever Milestones is
    switched on) everything already achieved is recorded as "known"
    without sending. Only milestones reached after that send.
F4. Timing: lean, a daily check inside an existing production cron,
    in each store's time zone, sending once per milestone per employee
    (a sent-once record, so reruns never duplicate).
F5. Staging: lean, emails are never sent from staging (per A3); an ADMIN
    "send a test to me" action or a dry-run log proves the content.
F6. Recipients: lean, ADMINs + the employee's assigned MANAGERs, never
    the employee themselves (a manager doesn't get an email about their
    own milestone), each subject to the NOTIFY-2c grid.
F7. Email content: lean, employee name, store, milestone, suggested
    recognition, the suggested employee message, and a link to the
    Milestones tab. No pay, raise dates or amounts ever.
F8. Copy button: lean, copies the message as written. Optional:
    support {firstName} only. Gary rules.
F9. Archived milestones and terminated staff: lean, no emails for
    either.

## Phase 3 — BUILD (only after Gary's go)
1. Migration (sent-once record, checklist milestones): `npx prisma migrate
   diff` into a new folder, then STOP. Gary applies it to dev with
   `npx prisma migrate deploy` and says go.
2. Checklist milestones on /staff/milestones and the Milestones tab.
3. Notification job and the new NOTIFY-2c grid lines.
4. Copy button on each achieved milestone's message.
5. Toggle off = no checklist milestones, no emails, no Copy button.
6. Phone width for every new surface.
7. Fixture: scripts/verify-ms4.ts — checklist counts at N-1/N; sent once
   (rerun sends nothing); back-fill sends nothing; grid switch-off
   respected; employee never a recipient; out-of-scope manager never a
   recipient; archived/terminated send nothing; toggle off sends
   nothing; email body has no pay, rate or raise date (assert on the
   rendered HTML); Copy text matches the stored message. Negative
   control: break one rule, confirm a check fails, restore. Re-run
   verify-ms1, ms2, ms3, ms3b.
8. `npm run build` passes, no error lines above piped output.

## Commits (scope `git add` — never `git add -A`)
- Work commit: code + migration + fixture.
- Docs commit: MS-4 ROADMAP row, DECISIONS draft with Gary's words exact
  and your own choices listed separately, MIGRATIONS entry, this prompt,
  the audit file.
No DEPLOY_LOG entry — PRE-PUSH-CHECK writes it.

## Final report
Commits, migration name, prisma commands verbatim, fixture counts, build,
choices for ratification, and a staging checklist (test-send to Gary only,
grid switch-off, Copy button, checklist milestone, 403s as Tommy switched
to STORE and gary@keva.com). End with: "Done and committed. Next:
PRE-PUSH-CHECK for MS-4." Do not push.
