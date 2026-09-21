TIER 1 session. Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PROMOTE-DOCS_2026-09-21_CAL-2c.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# PROMOTE-DOCS — 2026-09-21 — CAL-2c to production — TIER 1

Docs only. No code. ONE commit, on `main`. You never push. No `&&` chains.
This is the step DEBT-104 says nobody owns: stamp the promotion and flip the
row, in the same commit.

## Repo gate
`pwd` must be `/Users/garythomas/Claude_Projects/Froot/froot`. `git status`:
on `main`, clean (the only untracked file allowed is this prompt), up to date
with `origin/main`. `git log --oneline -1` must read `d417543 Merge branch
'staging'`. `git log --oneline d417543^1..d417543^2` must list exactly
`786de83`, `35340ca`, `355496b`. Anything else: STOP and tell Gary.

## Facts (from Gary's terminal and the planning chat, 2026-09-21)
- Merge `d417543`, `--no-ff`, first parent `a9534ed`. Pushed to `origin/main`
  by Gary. Get the full SHA and the commit time from git, never hand-typed.
- Payload: CAL-2c only. One code file, `src/components/calendar-due-banner.tsx`.
  No migration, no env var, no new dependency.
- Rollback: `git revert -m 1 d417543` on main, push. No database step.
- The calendar module is OFF for every production org, so the banner renders
  nothing in production today. This promotion changes nothing a customer sees.

## Staging evidence — record exactly this, claim nothing more
Observed on `786de83-staging` (staging org, Clerk `verified-snapper-7`),
screenshots in planning chat 2026-09-21:
- Headline "1 item due · 1 overdue" / "4 days overdue"; chevron present;
  3-or-fewer default is expanded.
- Collapse and expand work for `indianathomas` (ADMIN) and for Tommy Thomas
  (STORE) — the "anyone who sees it" ruling observed for a STORE account. The
  collapsed row keeps the red surface, the counts and the days-overdue line.
NOT observed, and the entry must say so in these terms:
- The more-than-3 case has never been seen: starts collapsed, store chips,
  grouped list, chip filter, state surviving a reload, `/checklists` mount.
- OPEN QUESTION: a manual `calendar-materialize` curl at 2026-09-21T14:04:04Z
  returned `ok true, events 5, scanned 27, materialized 25, skippedOpen 1,
  skippedFuture 1, errors 0`, yet screenshots taken after it still read
  "1 item due" for both accounts. Either the pages were not reloaded or
  `GET /api/calendar/due` is not returning those occurrences. Not diagnosed.
- Gary promoted with this open, knowingly, because the module is off in
  production. CONDITION HE AGREED TO: both items above are settled on staging
  BEFORE the calendar is enabled for any production org.
- COMMENT: the chevron `title` reads "Hide reminders" / "Show reminders"
  while the headline says "items". The planning chat's prompt supplied that
  wording; one-word fix owed, not this session's.

## Task 1 — docs/DEPLOY_LOG.md
Find CAL-2c's existing entry (written UNPROMOTED by `786de83`). Stamp it, on
`main`, per the `c870ba7` / `f3f9d31` precedent: heading carries the merge
short SHA and date; **Merge SHA** full; promoted instant from git; parents;
payload table of the three commits; rollback line; the evidence section
above. Preserve-and-mark: the "UNPROMOTED" wording is marked superseded in
place, not deleted. Chunked verified writes; read back both seams; heading
count goes up by zero (this stamps an existing entry) — if the entry does not
exist, STOP.

## Task 2 — docs/ROADMAP.yaml
CAL-2c row: `status: shipped` plus the shipped date, in whatever shape the
CAL-2b row uses (read it; do not invent a key). Prepend a dated rider
carrying the two NOT-observed items and the condition, worded as a blocker on
ENABLING THE CALENDAR IN PRODUCTION, not on this row's status. Nothing
deleted. No `meta.updated`.

## Gates and commit
`npm run build` exit 0, no pipe. `git diff --numstat`: print every deletion
line and account for it. One commit, scoped add of the two docs files plus
this prompt:
`DEPLOY_LOG + ROADMAP: 2026-09-21 production promotion (CAL-2c — due banner rollup)`

## Report and stop
The SHA, the numstat, and this sentence verbatim: "Committed on main, NOT
pushed. Gary pushes main, then merges main back into staging and pushes
staging." Do not push. Do not suggest further work.
