# R7-D — measure the blast radius, then write the DEPLOY_LOG entry

TIER 2 — contained. Measurement plus one docs file. No src/ changes.
Branch: staging. Commit only. NEVER push — Gary pushes.

Follows 1e7286b (the fix) and 6911469 (the recorder). Both are on
staging, unpushed, along with 1588d31. This session adds the third
commit and hands Gary a ready promotion.

## WHY THIS SESSION EXISTS

The fix is done and correct. What is NOT done is knowing its SIZE at
the store where it is large.

R7-D gates two lines in labor-coverage.ts so the salaried GM no longer
satisfies the floor of one body and no longer suppresses supervisorGap.
The prior session measured Las Brisas at +1 hour for the week (Sunday
only) and UNR at +20 — but the UNR figure is a DEV ARTIFACT and was
labelled as such: dev holds no salaried rows, so hasGm is false, the
gated path never runs, and UNR's hourlyHours is 0.0 all week there.

Las Brisas carries ~247 hourly hours a week and almost never had an
empty open hour for the GM to paper over. UNR carries 34. The hours the
GM was covering at UNR are probably most of its band. THAT number is
unmeasured and it is the one that matters.

Two things follow from this and both are in scope:

1. understaffedBudget is an ALERT MANAGERS ALREADY SEE. This change
   makes it fire more often at UNR. That is the D28 category — a change
   to existing behaviour rather than added capability — and D28 was
   handled with an explicit blast-radius note, not a quiet ship.
2. A number that moves onto a written prediction is a fix. A number
   that moves without one is a regression. Write it down first.

## PHASE 1 — MEASURE ON STAGING

Staging, not dev: dev cannot exercise R7-C at all (zero
LaborSalariedPerson rows), so it cannot exercise R7-D either.

CREDENTIAL RULE STANDS. vercel env pull is banned repo-wide for every
environment, and read-only is not an exception (CLAUDE.md § Environment
Variables). If the figures need a deployed database, produce the SQL or
the script and HAND IT TO GARY for the Neon console. Do not reach for a
deployed credential. State the branch in the same output as any figure.

Report, for Las Brisas and UNR, current week, BEFORE (HEAD~2, before
1e7286b) and AFTER (HEAD):

  1. suggestedHours, per day and week total
  2. understaffedBudget — which days it fires, before and after
  3. count of open hours where hourly was 0 and the GM band was on
     (the hours the fix actually reclaims)
  4. supervisorGap — its value before and after

Then ONE ADDITIONAL CHECK, cheap and it may shrink this whole entry:

  5. Is hasHourlySupervisor TRUE at both stores today? The :107 gate is
     now `!hasHourlySupervisor` outright. If the seeded position legend
     gives every org hourly ASM/Lead/Supervisor rows, that gate is
     INERT on present data and only :87 is live. Say which of the two
     gates actually changes behaviour today, with file:line and the
     measured value — do not assume from the seed file.

If the pure engine can produce 1–4 from committed inputs without a
deployed read, do that and say so. Prefer pure. If it cannot, say which
figures need Gary's console and give him the exact SQL.

## PHASE 2 — THE DEPLOY_LOG ENTRY

Write a promotion entry for docs/DEPLOY_LOG.md covering 1e7286b and
6911469. Leading format: `## <sha> — date — title` (recent entries lead
with SHA; five retroactive ones lead with date — that is known).

The SHA is AUTO-STAMPED from git, never hand-typed. Build the entry as
a pasteable heredoc terminal command, in short chunks, with wc -l and
a grep -c "^## " splice check. Do not hand-edit DEPLOY_LOG.md.

The merge SHA does not exist yet — the merge has not happened. Leave a
clearly marked placeholder that the promotion ritual fills, in the same
shape prior entries use. Do not invent a SHA.

The entry MUST carry, in this order:

- WHAT SHIPPED. Two gates in labor-coverage.ts: the floor-of-1 bump
  (:87) and supervisorGap (:107). points[].gm and :102 peak untouched.
  labor-plan.ts zero diff, verified byte-for-byte. verify-labor-budget
  output byte-identical.

- THIS CHANGES AN ALERT MANAGERS ALREADY SEE — its own heading, D28's
  precedent. Recommended coverage rises at Las Brisas and UNR during
  the GM band, and understaffedBudget begins firing where it did not.
  THAT IS THE FIX WORKING: the hours were always needed and the GM was
  papering over them. Name the measured per-store numbers from Phase 1.
  If UNR's flag flips most days, SAY SO IN THOSE WORDS — a manager
  opening /labor to a wall of red without warning is how a true signal
  gets dismissed as a bug.

- WHAT DOES NOT MOVE. No dollars. No hourly pool. No persisted hours
  figure. Coverage is display-only by call-site exhaustion — one
  production caller (computeDayCoverage, labor-plan.ts:411), two GET
  routes, no writes.

- suggestedHours RISES, AND THAT IS EXPECTED. The prior session's
  prompt predicted a zero delta and called non-zero a STOP. THE PROMPT
  WAS WRONG AND THE SESSION WAS RIGHT TO OVERRIDE IT: :98 is
  hourly + gm and reads the value :87 changes, so gating the floor
  necessarily raises Suggested. Recorded here so a later reader does
  not find the STOP condition and think it was ignored carelessly.
  Ratified by Gary 2026-08-23.

- WHAT WAS DELIBERATELY NOT FIXED. :98 headcount and :102 peak stay as
  they are. Gating them would move suggestedHours as a POLICY change
  and would leave Gary's 2026-08-20 whole-crew ruling with zero live
  cases, since both GM stores are under 100%. That is a ruling, still
  open, and it is not this promotion's.

- ROLLBACK. `git revert -m 1 <merge sha>`. No migration, no schema,
  nothing to un-drop. Reverting restores the GM satisfying the floor.

- KNOWN OPEN AT PROMOTION. DEBT-83 (GM on-floor window default is a
  hardcoded literal, unset at eleven of twelve stores, set only at
  Southgate where it is inert). The :98/:102 ruling. The coverage-shape
  half of R7 still blocked behind L-4. Plus whatever the ROADMAP shows
  still open — read it, do not copy this list forward blindly.

## PHASE 3 — HAND GARY THE PROMOTION

Give him the ritual as CONSOLIDATED PASTE BOXES, not one command per
box. Fixed-sequence commands with no branching go in ONE parenthesised
subshell block. Commands whose RESULT decides the next step stay alone.
Guard anything that can return empty with || echo "*** NO MATCH ***",
and the opening cd with || { echo "*** CD FAILED ***"; exit 1; }.

--no-ff only. --ff-only is banned — it leaves nothing for revert -m 1.
STOP BEFORE THE PUSH. Gary pushes.

Note in your report that scripts/promote.sh remains unbuilt and would
replace this ritual. Do not build it here.

## HOUSE RULES
No src/ changes in this session — if you find yourself editing one,
STOP and report. Additive only. Preserve-and-mark. Gate: bare
npm run build before the commit (no source files touched, so no eslint
scope). No bare npm run lint (DEBT-33). No && chains in anything handed
to Gary. Row ids come from ROADMAP.yaml's next free — S5-D numbers are
DEVIATIONS, not row ids, and they run to S5-D65. Never push.

Triage everything found and not fixed: FIX NOW / RULING NOW / COMMENT /
ROW. Default to the first three. Report the count in each bucket.
