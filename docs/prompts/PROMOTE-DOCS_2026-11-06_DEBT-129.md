# PROMOTE-DOCS — 2026-11-06 — DEBT-129 — TIER 1

TIER 1: docs only. One docs commit on STAGING. No code, no schema, no prisma
commands. Never push.

## Repo gate (one command at a time, paste each result)

pwd                      → must end in Froot/froot
git status               → on staging, tree clean (this prompt may be untracked)
git log --oneline -1     → must be de8e428 Merge branch 'staging'

## Facts to record (Gary's chat, 2026-11-06)

- Production merge de8e428 ("Merge branch 'staging'"), --no-ff, first parent
  54824e4. Carries b479b10, 8590610, fb6bcff. Timestamp from
  `git show -s --format=%ci de8e428` — do not invent one. No migration.
  Rollback: `git revert -m 1 de8e428`. All four tips level at de8e428.
- Staging evidence (Gary, browser, staging org org_3G02wO4QlVVSWppi8aqlnSZnsDa,
  instance verified-snapper-7 — Clerk "Development" instance in the dashboard):
  - Neon console br-square-feather: Gary has THREE User rows with email
    indianathomas@live.com, one per staging org, three different clerkUserIds.
    The active row (clerkUserId user_3G02wOBvMPSAne8fgbYcU4qhhpG) had name NULL
    and lastSeenAt 2026-11-07 06:10:15 UTC after the beacon ran.
  - Cause: that Clerk user had blank first and last name. The lazy fill worked
    as ruled — Clerk had no name, so Froot wrote none ("Froot never invents a
    name").
  - Gary set First "Gary", Last "Thomas" in Clerk; within a minute staging
    /messages showed "Gary Thomas" on his posts. Test (c), the user.updated
    webhook path, PROVEN on staging.
  - Lazy-fill path: proven by the fixture (23/23 on dev), not observed on
    staging. Record exactly that.
- Production: not yet checked after deploy. Gary's production account
  (gary@kevajuice.com) has the Clerk name "Keva Juice", so the lazy fill will
  label his production posts "Keva Juice" until he renames it in Clerk.
- Observation for a ROW only if none exists: most Clerk accounts in the staging
  instance have no first/last name, so after DEBT-129 names appear only where
  Clerk has them — names must be entered in Clerk. Do not file if an existing
  row covers it; say which.

## Edits (preserve-and-mark: prepend dated lines, delete nothing)

1. docs/DEPLOY_LOG.md — the UNPROMOTED DEBT-129 entry: stamp with de8e428 and
   the timestamp, as the 2026-11-06 NOTIFY-4 entry was. Heading count unchanged.
2. docs/ROADMAP.yaml — DEBT-129: status staging → shipped with the date and
   "de8e428" (quoted short SHA), plus a prepended dated note with the evidence
   above. No meta.updated key.
3. docs/MIGRATIONS.md — untouched (no migration).

## Commit

npm run build → must pass.
git add only the edited files plus
docs/prompts/PROMOTE-DOCS_2026-11-06_DEBT-129.md.
One commit: docs(PROMOTE): DEBT-129 shipped in merge de8e428

## Report and STOP

Commit SHA, files touched, heading counts before/after, DEBT-129's status as
it now reads, and whether a ROW was filed. Do not push.
