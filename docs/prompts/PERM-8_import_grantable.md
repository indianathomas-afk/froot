TIER 3

# PERM-8 — "Import team members from Square" grantable to specific managers

You are working in the Froot repo. REPO GATE before anything else: run `pwd`
and `git remote -v`; you must be in `~/Claude_Projects/Froot/froot` with
remote `indianathomas-afk/froot` (lowercase froot — the capital-F parent is a
known trap, and two COMP-1 sessions were scrapped for launching in a Bloomnet
worktree). If the gate fails, stop and say so. Read `CLAUDE.md` and
`docs/WORKFLOW.md`. This is a TIER 3 session: audit → plan → STOP → Gary's
explicit approval → build. You never push. Commits on `staging`. No `&&`
chains — one command at a time. `docs/prompts/` files are never edited after
execution — addenda only.

## Row

`PERM-8` — verify the ID is the next free PERM number in `docs/ROADMAP.yaml`
before recording anything; if taken, use the next free one and say so. The
row is written at the END from what was actually done. Deviation numbers are
read from the highest recorded entry in ROADMAP.yaml, never assigned here.
Cross-reference COMP-1 (which shipped `labor.access` and the confidentiality
flag this work must not disturb).

## Why this exists

On staging (`froot-git-staging-...vercel.app/users`), Edit User for a MANAGER
(observed on Tommy Thomas) shows "Import team members from Square" with a
lock icon and "Not granted by this role" — the capability sits above the
MANAGER baseline and the modal renders it immutable. Gary wants specific,
individually chosen managers to be able to run the import; the role baseline
stays ADMIN. This is the first per-user grant ABOVE baseline — everything the
override system has shipped so far is denial below baseline — so the
mechanism itself may not exist yet. Determining that is the audit's first
job, and it decides the size of this session.

## Ruling (Gary, 2026-08-29 in chat — confirm with him before writing)

Draft text for `docs/DECISIONS.md`, pending Gary's confirmation at session
start. Before the work commit, ask Gary to confirm this text verbatim (or
supply his edit). Do not write words into the decision log he has not
confirmed; do not hold the entire build hostage to it either — build, and
hold the work commit only if confirmation still hasn't arrived by commit
time:

> 2026-08-29 — Square import grantable to managers (PERM-8). Ruled by Gary:
> "Import team members from Square" remains ADMIN-baseline, but becomes
> per-user grantable — an admin can grant it to specific MANAGER accounts via
> Edit User. Grants are admin-only to write, per-person not role-wide, and
> revocable the same way. Enforcement is at the API route, not just the
> modal.

## Phase A — audit (read-only, then STOP)

Report with file:line references:

1. **The capability itself.** Its ID in the registry
   (`src/lib/permissions.ts`), its baseline tier, its area, and every
   enforcement call site — the import UI, the API route(s) the import hits,
   and whether enforcement is at the route or only in the modal/page. (COMP-1
   found `labor.view` claiming enforcement it didn't have; check this one for
   the same disease.)
2. **Does the grant direction exist?** How per-user overrides are stored and
   evaluated: denial-only, or does the data model and `can()` path already
   support granting above baseline? If grants are structurally new, the plan
   must say exactly what changes in the override model, the evaluation order
   (role baseline OR per-user grant, minus per-user denial — spell out the
   precedence), and what keeps STORE/STAFF from ever being grantable this
   capability if that's the intent (confirm with Gary: managers only, or any
   role?).
3. **The modal rendering.** How Edit User decides locked-with-padlock vs
   toggleable, and what it takes for an above-baseline capability to render
   as a grantable toggle for MANAGER rows only.
4. **What the import writes.** Trace the import end to end: which tables it
   creates/updates (StaffMember? SquareTeamMemberWage? anything else). If it
   touches SquareTeamMemberWage in ANY code path, verify `compConfidential`
   (and the other Froot-owned columns: weeklyHoursOverride, isSupervisory)
   survive it — the sync's DO UPDATE deliberately excludes them; the import
   must too, or a manager-triggered import silently unhides every
   confidential salary. If the import path is separate from the sync path,
   this check is mandatory evidence, not an assumption.
5. **Blast radius of a grant.** What else the capability unlocks besides the
   import button — if the capability gates more than the import itself,
   granting it hands managers all of it; enumerate so Gary approves the whole
   surface, not just the button.

Then present findings + build plan (files, override-model change if any,
modal change, enforcement additions) and STOP. Wait for Gary's explicit
approval. Do not proceed on silence. If item 2 reveals the grant mechanism is
structurally large, say so plainly — Gary may prefer a narrower interim
(e.g., a dedicated boolean) over generalizing the override system; give him
the lean and the tradeoff in plain English.

## Phase B — build (only after approval)

- Registry/override changes per the approved plan. Admin-only write on grant
  overrides (same guarantee as existing overrides — verify, don't assume).
- Enforcement at the API route(s) AND the UI. The acceptance test is the
  route refusing an ungranted manager with a 403, not a hidden button.
- If any schema change is needed for grants: additive only, hand-authored
  migration flow per CLAUDE.md (migrate diff → review → db execute → migrate
  resolve → generate).
- Preserve the COMP-1 fixture: run `scripts/verify-comp-confidential.ts` and
  include the result — if the import work touched anything near the wage
  table, this is the regression net.
- Build gate (`npm run build`). Two-commit pattern on staging. No push.

## Evidence

Branch literal on every DB result (dev is br-broad-wave; you have no direct
staging/production connection). Browser evidence names org
`org_3G02wO4QlVVSWppi8aqlnSZnsDa` and Clerk instance `verified-snapper-7`,
captured before testing. Staging-SHA precondition before any staging claim.
For every green check, state what a failure would have looked like. Dev
likely has no Square team-member data — an import that returns nothing on
dev is an absence of data, not a pass; say so and put the real test on
staging.

## Test steps for Gary (write concretely at session end)

At minimum: (1) as Karson/ADMIN — Edit User on a manager shows "Import team
members from Square" as a grantable toggle, not a padlock; grant it, save.
(2) as that manager — the import control appears and the import runs;
afterward, as ADMIN, verify a previously-flagged confidential person's flag
is STILL ON (failure: the import reset it — stop everything if so). (3) as a
different, ungranted manager — no import control, and a direct API call to
the import route returns 403 (failure: hidden button over a live route). (4)
revoke the grant; confirm the first manager loses it. (5) as STORE/STAFF
(Tommy) — still locked, not grantable (if that's the ruling on scope).

## End of session

Triage loose ends FIX NOW / RULING NOW / COMMENT / ROW (ROW last resort).
DEPLOY_LOG entry scaled to blast radius — permissions change, so a full
entry, composed via the heredoc-chunk flow with the `grep -c "^## "` count
check. ROADMAP row citing the work SHA, cross-referencing COMP-1. Hand Gary
the push-readiness summary. Do not push.

## Out of scope

F1 (the ungated defaultHourlyRate route). Any change to what the import
itself does. COMP-1 surfaces beyond the preservation checks above. Anything
else found gets written down, not done.
