TIER 1 session. Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/2026-10-17_DOCS-CLOSEOUT_milestones_staging.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# DOCS-CLOSEOUT — Milestones core + BUG-15, staging verified — TIER 1

TIER 1: no code changes. ONE docs commit at most. Never push. Records
Gary's staging evidence (given in chat) and brings the living docs up to
date before promotion. Preserve-and-mark everywhere: never delete or
reword an earlier line; mark it superseded and add the new line.

## Repo gate (one command at a time, paste each result)
pwd                → must end in Froot/froot (one cd allowed if it ends in Froot)
git status         → on staging, tree clean, up to date with origin
git log --oneline -8
If any check fails: STOP and report.

## Staging evidence (Gary, in chat, 2026-10-15 → 2026-10-17)
Environment for all of it: staging, Neon branch br-square-feather-a63z92vz,
org cmr54z65v000105jxczpt72w1 (Clerk org org_3G02wO4QlVVSWppi8aqlnSZnsDa),
Clerk development instance (staging keys). Deployed SHA read from the page
footer each time.

- MS-1 — footer 7010995. Both MS-1 migrations finished 2026-10-16
  01:32 UTC, no rollback. Toggle on/off; add/edit/archive/restore;
  duplicate day count refused; start date "Manually set" with Square date
  warning, survives resync; tab next/achieved/progress, desktop + phone.
  Permissions: STORE (Tommy) no Staff access, APIs 403 on / 404 off;
  out-of-scope MANAGER (gary@keva.com, Carson) not-found + 403.
- BUG-15 — footer 147fa94. Incognito, console open, hard reload: no
  React #418 on Las Brisas at 20:54 PDT (UTC already next day). Southgate
  and All locations clean (checked 06:34 PDT, outside the bug window;
  fixture covers Denver).
- MS-2 — footer 06b5bba. Migration finished 2026-10-16 15:39 UTC. Settings
  save; red ≥ green refused; green / red / grey badges on real data;
  full badge "8 of 8 shifts"; toggle off hides all; 403s as STORE and
  out-of-scope MANAGER; phone width.
- MS-3a — footer 4cb60b0. Migration finished 2026-10-16 22:14 UTC. All
  checklist items confirmed by Gary.
- MS-3b — footer 029e4ba. Migration finished 2026-10-17 02:14 UTC.
  Manual last-raise 2026-08-04 → "Recent raise, eligible again from
  Nov 2, 2026", badge hidden on /staff; 2026-07-01 → cooldown met, badge
  back. Privacy: Deon Hazelton marked pay-confidential; Tommy (MANAGER,
  Las Brisas) saw cooldown but no dates on the tab and none in page
  source; ADMIN saw both dates (positive control). Test data cleaned up.

## Tasks
1. DEPLOY_LOG.md: in each of the five UNPROMOTED entries (MS-1, BUG-15,
   MS-2, MS-3a, MS-3b) add a "Staging evidence (Gary, chat)" block with
   the lines above. Keep every entry UNPROMOTED. In the MS-3a entry, mark
   its "not pushed" line superseded ("pushed 2026-10-16, deployed
   4cb60b0"). Write in chunks; report line and heading counts before and
   after; nothing removed.
2. DEPLOY_LOG.md DOC-11: its entry still says UNPROMOTED but it is on
   main via merge 0d51496. Mark it promoted (preserve-and-mark).
3. docs/ROADMAP.yaml: for MS-1, BUG-15, MS-2, MS-3 (MS-3a) and MS-3b,
   record "verified on staging" with the date and deployed SHA, using
   whatever status value or note the schema allows (read the schema; do
   not invent a status). Note on MS-3/MS-3b: promote together.
4. Open items: add each to the right place (existing row note, COMMENT,
   or a new ROW only if nothing fits), in plain English:
   a. Gary to confirm: Tommy (MANAGER, Las Brisas only) appeared to see
      a Southgate card on /staff and the Southgate dashboard on
      2026-10-16/17. Unconfirmed; if real, it's a store-scope bug.
   b. Pending ruling: should a MANAGER see their own Raise badge (Tommy
      sees "Raise blocked" on his own row)?
   c. Promotion pending: five Milestones migrations plus the schedule
      and wage crons, which only run on production. MS-3a must not reach
      main without MS-3b.
5. CLAUDE.md: confirm it already reflects migrate deploy (9917412). No
   other change unless a house rule is stale; if so, report, don't edit.
6. `npm run build`, then ONE docs commit scoped to the touched files.

## Stop
Report: the commit SHA, files touched with +/− counts, line/heading
counts for DEPLOY_LOG, anything you couldn't record and why.
"Committed, NOT pushed." Do not suggest further work.
