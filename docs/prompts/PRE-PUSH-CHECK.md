# PRE-PUSH-CHECK — <PHASE-ID> — TIER 1

TIER 1: no code changes. At most one docs commit (reworded ruling or a fixed
doc). Verifies <PHASE-ID> is ready for Gary to push. Never pushes.

## Repo gate (one command at a time, paste results)
pwd                → must end in Froot/froot
git status         → on staging, tree clean

## Step 1 — rulings (hard STOP if any)
If <PHASE-ID> added or changed any docs/DECISIONS.md entry, print each
verbatim, then STOP and ask Gary: "Ratify as written, or give me your
wording." Record his exact reply. If he rewords: replace with his words
verbatim, npm run build, one docs commit. If the phase made no ruling,
say so and skip.

## Step 2 — docs sync audit (read-only; report a table: item / expected /
found / OK-or-DRIFT)
- docs/ROADMAP.yaml: the <PHASE-ID> row exists, status matches reality,
  preserve-and-mark intact (nothing deleted), no meta.updated key.
  THE DOCS SHA IS THIS CHECK'S JOB TO ADD, AND IT IS NOT DRIFT. The build
  session's row is written INSIDE the commit that records it, so the docs SHA
  does not exist yet when the row is composed — the two-commit pattern cannot
  record it, by construction. Missing docs SHA is therefore the EXPECTED state
  at this point and must not be reported as DRIFT. This check ADDS the docs
  SHA and its own SHA to the row as a normal step, in its own docs commit,
  naming its own SHA as "the commit immediately after <docs SHA>" since it is
  writing inside it. Only the WORK SHA being absent or wrong is drift.
  Ratified by Gary in chat, 2026-09-18, after three consecutive phases
  (CAL-1, CAL-1a, CAL-1b) each recorded the same gap as a defect in their own
  rows and none of them could close it.
- docs/DECISIONS.md: any ruling from this phase is present (per Step 1).
- docs/DEPLOY_LOG.md: THE ENTRY IS WRITTEN INTO THE FILE BY THIS CHECK, now,
  not handed to Gary as a pasteable heredoc to run at push time. Compose it
  sized to blast radius, head it `## UNPROMOTED — <date> — <title>`, and write
  it with CHUNKED VERIFIED WRITES — short chunks, `wc -l` after each, and
  `grep -c "^## "` before and after to prove no prior entry was clobbered.
  This is the UM-3 / CAL-1 shape. It commits unpromoted and is stamped with
  the merge SHA at promotion, on `main`, after the merge.
  Ratified by Gary in chat, 2026-09-18. The heredoc version made the entry
  depend on a human running a command in the right shell at the right moment;
  when the promotion template was run end to end on 2026-09-18 that moment was
  skipped, and two entries read "UNPROMOTED — staging only" while the code was
  live in production. An entry already in the file cannot be skipped.
- CLAUDE.md: if this phase changed a house rule or pattern, it's reflected;
  if not, confirm untouched.
- docs/prompts/: this phase's session prompt(s) are committed.
Any DRIFT: STOP, report, and propose the one-commit fix. Do not fix
without Gary's go-ahead.

## Step 3 — pre-push sanity
git log --oneline @{u}..   → list must match what the build session
                             reported (plus any Step 1/2 docs commit).
                             Anything unexpected: STOP.
npm run build              → must pass. Confirm no error line above any
                             piped/gated output.
git status                 → tree clean.

## Step 4 — report and stop
"Ready to push. N commits: <list>. Gary runs the push. Staging evidence
is next, in chat, after deploy." Do NOT push. Do not suggest further work.

**SET THE ROW'S `status: staging` IN THIS SAME PASS** — in `docs/ROADMAP.yaml`,
in the Step 1/2 docs commit, before the report. Per WORKFLOW.md session rule 4
the flip belongs to the session that moved the code, and this check is the last
thing that runs before Gary pushes, so it is the step that owns it. A debt row
declares the status explicitly; omission on a debt row reads as OPEN.

Added 2026-09-19 (DOCS-6). CAL-2b is why: it was pushed to staging and then
merged to `main` in `d2b8d79` while its row still read `in_progress`, because
nothing between the build session and the promotion had the job of flipping it.
